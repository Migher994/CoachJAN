import { useState } from 'react'
import type { Race, RacePriority } from '../../shared/types'
import { AsyncBody, ConfirmButton, Empty, Field, Note, Panel, useAsync } from '../components/ui'
import { ApiError, api } from '../lib/api'
import { daysBetween, longDate, today } from '../lib/format'

type Draft = { name: string; date: string; priority: RacePriority; course_notes: string; result_notes: string }

const EMPTY: Draft = { name: '', date: today(), priority: 'B', course_notes: '', result_notes: '' }

const PRIORITY_HINT: Record<RacePriority, string> = {
  A: 'Peak for it. The plan builds towards A races inside eight weeks.',
  B: 'Ride it well, but without a full taper.',
  C: 'Training race. Ride it through.',
}

function RaceForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Race | null
  onSave: (d: Draft) => Promise<void>
  onCancel?: () => void
}) {
  const [draft, setDraft] = useState<Draft>(
    initial
      ? {
          name: initial.name,
          date: initial.date,
          priority: initial.priority,
          course_notes: initial.course_notes ?? '',
          result_notes: initial.result_notes ?? '',
        }
      : EMPTY,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof Draft, v: string) => setDraft((d) => ({ ...d, [k]: v }))

  return (
    <form
      className="space-y-3 p-3.5"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!draft.name.trim()) return setError('Give the race a name.')
        setBusy(true)
        setError(null)
        try {
          await onSave(draft)
          if (!initial) setDraft(EMPTY)
        } catch (err) {
          setError(err instanceof ApiError || err instanceof Error ? err.message : String(err))
        } finally {
          setBusy(false)
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <Field label="Race">
          <input value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Grand Prix Herning" required />
        </Field>
        <Field label="Date">
          <input type="date" value={draft.date} onChange={(e) => set('date', e.target.value)} required />
        </Field>
        <Field label="Priority" hint={PRIORITY_HINT[draft.priority]}>
          <select value={draft.priority} onChange={(e) => set('priority', e.target.value)}>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </Field>
      </div>
      <Field label="Course notes" hint="Terrain, length, what the race tends to come down to. The coach reads this.">
        <textarea rows={2} value={draft.course_notes} onChange={(e) => set('course_notes', e.target.value)} />
      </Field>
      {initial && (
        <Field label="Result">
          <textarea rows={2} value={draft.result_notes} onChange={(e) => set('result_notes', e.target.value)} />
        </Field>
      )}
      {error && <Note kind="error">{error}</Note>}
      <div className="flex items-center gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : initial ? 'Save changes' : 'Add race'}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

export function Races() {
  const races = useAsync(() => api.races.list(), [])
  const [editing, setEditing] = useState<number | null>(null)
  const now = today()

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Panel title="Add a race">
        <RaceForm
          initial={null}
          onSave={async (d) => {
            await api.races.create({
              name: d.name.trim(),
              date: d.date,
              priority: d.priority,
              course_notes: d.course_notes.trim() || null,
              result_notes: null,
            })
            races.reload()
          }}
        />
      </Panel>

      <Panel title="Calendar">
        <AsyncBody
          state={races}
          isEmpty={(d) => d.length === 0}
          empty={
            <Empty>
              No races yet. Add the ones you are pointing at, with a priority, so the countdown and the planning coach
              have something to work from.
            </Empty>
          }
        >
          {(data) => (
            <ul className="divide-y divide-rule">
              {data.map((r) => {
                const away = daysBetween(now, r.date)
                const past = away < 0
                return (
                  <li key={r.id} className={past ? 'opacity-70' : ''}>
                    {editing === r.id ? (
                      <RaceForm
                        initial={r}
                        onCancel={() => setEditing(null)}
                        onSave={async (d) => {
                          await api.races.update(r.id, {
                            name: d.name.trim(),
                            date: d.date,
                            priority: d.priority,
                            course_notes: d.course_notes.trim() || null,
                            result_notes: d.result_notes.trim() || null,
                          })
                          setEditing(null)
                          races.reload()
                        }}
                      />
                    ) : (
                      <div className="px-3.5 py-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-[13px] font-medium">{r.name}</span>
                          <span className="num text-[12px] text-ink-3">
                            {past ? `${Math.abs(away)} days ago` : away === 0 ? 'today' : `in ${away} days`}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
                          <span className="tag">Priority {r.priority}</span>
                          <span>{longDate(r.date)}</span>
                        </div>
                        {r.course_notes && <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">{r.course_notes}</p>}
                        {r.result_notes && (
                          <p className="mt-1.5 border-l-2 border-rule-strong pl-2 text-[12px] leading-relaxed text-ink-2">
                            {r.result_notes}
                          </p>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          <button type="button" className="btn btn-sm" onClick={() => setEditing(r.id)}>
                            {past && !r.result_notes ? 'Add result' : 'Edit'}
                          </button>
                          <ConfirmButton
                            onConfirm={async () => {
                              await api.races.remove(r.id)
                              races.reload()
                            }}
                          >
                            Delete
                          </ConfirmButton>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </AsyncBody>
      </Panel>
    </div>
  )
}
