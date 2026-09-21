import { useEffect, useState } from 'react'
import { AsyncBody, Field, Note, Panel, useAsync } from '../components/ui'
import { ApiError, api } from '../lib/api'
import { num } from '../lib/format'

type Draft = { ftp: string; weight_kg: string; weekly_hours_target: string; max_hr: string; notes: string }

const toNumber = (v: string): number | null => {
  const t = v.trim()
  if (!t) return null
  const parsed = Number(t)
  return Number.isFinite(parsed) ? parsed : null
}

export function Settings() {
  const profile = useAsync(() => api.profile.get(), [])
  const coach = useAsync(() => api.coach.status(), [])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!profile.data) return
    setDraft({
      ftp: profile.data.ftp?.toString() ?? '',
      weight_kg: profile.data.weight_kg?.toString() ?? '',
      weekly_hours_target: profile.data.weekly_hours_target?.toString() ?? '',
      max_hr: profile.data.max_hr?.toString() ?? '',
      notes: profile.data.notes ?? '',
    })
  }, [profile.data])

  const set = (k: keyof Draft, v: string) => {
    setDraft((d) => (d ? { ...d, [k]: v } : d))
    setSaved(false)
  }

  const wkg =
    draft && toNumber(draft.ftp) && toNumber(draft.weight_kg)
      ? (toNumber(draft.ftp) as number) / (toNumber(draft.weight_kg) as number)
      : null

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Panel title="Rider profile">
        <AsyncBody state={profile} empty={<div className="p-4 text-[13px]">No profile row.</div>}>
          {() =>
            draft && (
              <form
                className="space-y-3 p-3.5"
                onSubmit={async (e) => {
                  e.preventDefault()
                  setBusy(true)
                  setError(null)
                  try {
                    await api.profile.save({
                      ftp: toNumber(draft.ftp) == null ? null : Math.round(toNumber(draft.ftp) as number),
                      weight_kg: toNumber(draft.weight_kg),
                      weekly_hours_target: toNumber(draft.weekly_hours_target),
                      max_hr: toNumber(draft.max_hr) == null ? null : Math.round(toNumber(draft.max_hr) as number),
                      notes: draft.notes.trim() || null,
                    })
                    setSaved(true)
                    profile.reload()
                  } catch (err) {
                    setError(err instanceof ApiError || err instanceof Error ? err.message : String(err))
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="FTP (W)"
                    hint={wkg ? `${num(wkg, 2)} W/kg` : 'Training load and intensity cannot be computed without this'}
                  >
                    <input type="number" min="0" step="1" value={draft.ftp} onChange={(e) => set('ftp', e.target.value)} />
                  </Field>
                  <Field label="Weight (kg)">
                    <input type="number" min="0" step="0.1" value={draft.weight_kg} onChange={(e) => set('weight_kg', e.target.value)} />
                  </Field>
                  <Field label="Weekly hours target" hint="A ceiling for the planning coach, not a goal to hit">
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={draft.weekly_hours_target}
                      onChange={(e) => set('weekly_hours_target', e.target.value)}
                    />
                  </Field>
                  <Field label="Max heart rate (bpm)">
                    <input type="number" min="0" step="1" value={draft.max_hr} onChange={(e) => set('max_hr', e.target.value)} />
                  </Field>
                </div>
                <Field label="Notes" hint="Injuries, constraints, what you are bad at. Both coach features read this.">
                  <textarea rows={4} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
                </Field>
                {error && <Note kind="error">{error}</Note>}
                <div className="flex items-center gap-2">
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    {busy ? 'Saving…' : 'Save profile'}
                  </button>
                  {saved && <span className="text-[12px] text-ink-3">Saved.</span>}
                </div>
              </form>
            )
          }
        </AsyncBody>
      </Panel>

      <div className="space-y-3">
        <Panel title="Coach">
          <div className="space-y-2 px-3.5 py-3 text-[13px] leading-relaxed text-ink-2">
            {coach.data?.configured ? (
              <>
                <p>
                  Connected. Requests go through the CoachJan API using <span className="num">{coach.data.model}</span>.
                  The key stays on the server and is never sent to the browser.
                </p>
              </>
            ) : (
              <>
                <p>Not configured. The feedback coach, the planning coach and the paste parser are unavailable.</p>
                <p className="num text-[12px]">cp .env.example .env</p>
                <p>Add ANTHROPIC_API_KEY to that file and restart the API.</p>
              </>
            )}
          </div>
        </Panel>

        <Panel title="Where your data lives">
          <div className="space-y-2 px-3.5 py-3 text-[13px] leading-relaxed text-ink-2">
            <p>
              Everything is in Postgres, scoped to your account. Uploaded FIT files are kept in Cloud Storage (or a local
              <span className="num text-[12px]"> uploads/</span> folder in development), so a ride can be re-read later.
            </p>
            <p>Nothing leaves the server except the training summaries the two coach features send to Anthropic.</p>
          </div>
        </Panel>
      </div>
    </div>
  )
}
