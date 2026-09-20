import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AsyncBody, ConfirmButton, Empty, Field, Note, Panel, useAsync } from '../components/ui'
import { api, streamCoach } from '../lib/api'
import { hhmm, longDate, shortDate } from '../lib/format'

type Scope = 'latest' | 'activity' | 'last7' | 'last14'

const SCOPES: { id: Scope; label: string }[] = [
  { id: 'latest', label: 'Latest activity' },
  { id: 'activity', label: 'A specific activity' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last14', label: 'Last 14 days' },
]

/** Renders streamed text as paragraphs without waiting for the whole response. */
function Prose({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim())
  return (
    <div className="prose-feedback max-w-[68ch] text-[14px] leading-relaxed text-ink">
      {paragraphs.map((p, i) => (
        <p key={i}>{p.trim()}</p>
      ))}
    </div>
  )
}

export function FeedbackCoach() {
  const [params, setParams] = useSearchParams()
  const preselected = params.get('activity')

  const [scope, setScope] = useState<Scope>(preselected ? 'activity' : 'latest')
  const [activityId, setActivityId] = useState<string>(preselected ?? '')
  const [text, setText] = useState('')
  const [meta, setMeta] = useState<{ scope: string; ref: string; label: string } | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<number | null>(null)
  const abort = useRef<AbortController | null>(null)

  const coach = useAsync(() => api.coach.status(), [])
  const activities = useAsync(() => api.activities.list({ limit: 60 }), [])
  const history = useAsync(() => api.feedback.list(), [])

  useEffect(() => () => abort.current?.abort(), [])

  const run = async () => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setText('')
    setMeta(null)
    setError(null)
    setSavedId(null)
    setRunning(true)

    await streamCoach(
      '/coach/feedback',
      { scope, activity_id: scope === 'activity' && activityId ? Number(activityId) : undefined },
      {
        onMeta: setMeta,
        onDelta: (delta) => setText((t) => t + delta),
        onDone: (full) => {
          setText(full)
          setRunning(false)
        },
        onError: (message) => {
          setError(message)
          setRunning(false)
        },
      },
      controller.signal,
    )
    setRunning(false)
  }

  const save = async () => {
    if (!meta || !text.trim()) return
    const saved = await api.feedback.save({
      scope: meta.scope as 'activity' | 'block',
      ref: meta.ref,
      text: text.trim(),
    })
    setSavedId(saved.id)
    history.reload()
  }

  const canRun =
    !running && coach.data?.configured !== false && (scope !== 'activity' || Boolean(activityId))

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        <Panel title="Feedback on your training">
          <div className="space-y-3 p-3.5">
            {coach.data && !coach.data.configured && (
              <Note kind="warning">
                The coach needs an Anthropic API key on the server. Copy .env.example to .env, add ANTHROPIC_API_KEY and
                restart the API.
              </Note>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="What should be reviewed">
                <select
                  value={scope}
                  onChange={(e) => {
                    setScope(e.target.value as Scope)
                    if (e.target.value !== 'activity') {
                      params.delete('activity')
                      setParams(params, { replace: true })
                    }
                  }}
                >
                  {SCOPES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>

              {scope === 'activity' && (
                <Field label="Which activity">
                  <select value={activityId} onChange={(e) => setActivityId(e.target.value)}>
                    <option value="">Pick one…</option>
                    {(activities.data ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {shortDate(a.date)} — {a.name} ({hhmm(a.duration_min)})
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-primary" onClick={run} disabled={!canRun}>
                {running ? 'Writing…' : 'Ask for feedback'}
              </button>
              {running && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    abort.current?.abort()
                    setRunning(false)
                  }}
                >
                  Stop
                </button>
              )}
              {!running && text && !savedId && (
                <button type="button" className="btn" onClick={save}>
                  Save to history
                </button>
              )}
              {savedId && <span className="text-[12px] text-ink-3">Saved.</span>}
            </div>

            {error && <Note kind="error">{error}</Note>}
          </div>
        </Panel>

        {(text || running) && (
          <Panel
            title={meta?.label ?? 'Reading the data…'}
            right={running ? <span className="text-[11px] text-ink-3">writing…</span> : undefined}
          >
            <div className="p-3.5">
              {text ? (
                <Prose text={text} />
              ) : (
                <p className="text-[13px] text-ink-3">
                  Computing the derived metrics and sending them across. The text appears here as it is written.
                </p>
              )}
              {running && text && (
                <span aria-hidden className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-accent align-text-bottom" />
              )}
            </div>
          </Panel>
        )}

        {!text && !running && !error && (
          <Panel title="What you get">
            <div className="space-y-2 px-3.5 py-3 text-[13px] leading-relaxed text-ink-2">
              <p>
                The server computes the numbers first: variability index, intensity factor, heart rate decoupling,
                quarter splits, climb-by-climb power and cadence, whether you ran out of gears on the steep sections,
                best efforts, and what 90 g of carbohydrate an hour would have covered. Those go into the prompt, so
                the feedback argues from figures rather than guessing at them.
              </p>
              <p>
                Rides uploaded as FIT files get the full treatment. Manually entered rides only carry their summary,
                and the feedback will say so rather than inventing the rest.
              </p>
            </div>
          </Panel>
        )}
      </div>

      <Panel title="Saved feedback">
        <AsyncBody
          state={history}
          isEmpty={(d) => d.length === 0}
          empty={
            <Empty>
              Nothing saved yet. Ask for feedback, then save it here. The planning coach reads the most recent saved
              note when it builds your next block.
            </Empty>
          }
        >
          {(data) => (
            <ul className="divide-y divide-rule">
              {data.map((f) => (
                <li key={f.id} className="px-3.5 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px] font-medium">
                      {f.scope === 'activity' ? 'Activity' : 'Block'}{' '}
                      <span className="font-normal text-ink-3">
                        {f.scope === 'activity' ? `#${f.ref}` : f.ref.replace('..', ' to ')}
                      </span>
                    </span>
                    <span className="num text-[11px] text-ink-3">{longDate(f.created_at.slice(0, 10))}</span>
                  </div>
                  <p className="mt-1.5 line-clamp-4 text-[12px] leading-relaxed text-ink-2">{f.text}</p>
                  <div className="mt-2 flex items-center gap-2">
                    {f.scope === 'activity' && (
                      <Link className="btn btn-sm" to={`/activity/${f.ref}`}>
                        Open ride
                      </Link>
                    )}
                    <ConfirmButton
                      onConfirm={async () => {
                        await api.feedback.remove(f.id)
                        history.reload()
                      }}
                    >
                      Delete
                    </ConfirmButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </AsyncBody>
      </Panel>
    </div>
  )
}
