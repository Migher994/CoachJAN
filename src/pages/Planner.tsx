import { useEffect, useRef, useState } from 'react'
import type { PlanBlock, PlanWeek } from '../../shared/types'
import { AsyncBody, ConfirmButton, Empty, Note, Panel, Spinner, useAsync } from '../components/ui'
import { ApiError, api, streamCoach } from '../lib/api'
import { hhmm, longDate, num } from '../lib/format'

const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

const sortDays = (sessions: PlanWeek['sessions']) =>
  [...sessions].sort((a, b) => {
    const ia = DAY_ORDER.indexOf(a.day.trim().toLowerCase())
    const ib = DAY_ORDER.indexOf(b.day.trim().toLowerCase())
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })

const isRest = (type: string, minutes: number) => minutes === 0 || type.trim().toLowerCase().startsWith('rest')

const isHard = (type: string, intensity: string) => {
  const t = `${type} ${intensity}`.toLowerCase()
  return /threshold|vo2|race|sprint|anaerobic|z4|z5|z6/.test(t)
}

function WeekView({ week }: { week: PlanWeek }) {
  const sessions = sortDays(week.sessions)
  const planned = sessions.reduce((sum, s) => sum + (s.duration_min || 0), 0)
  return (
    <div className="panel">
      <header className="panel-head">
        <h3 className="panel-title">
          Week {week.week} <span className="font-normal text-ink-2">· {week.theme}</span>
        </h3>
        <span className="num text-[12px] text-ink-3">
          {hhmm(planned)} planned
          {week.target_hours ? ` · target ${num(week.target_hours, 1)}h` : ''}
        </span>
      </header>
      <ul className="divide-y divide-rule">
        {sessions.map((s, i) => {
          const rest = isRest(s.type, s.duration_min)
          return (
            <li key={i} className={`flex gap-3 px-3.5 py-2.5 ${rest ? 'bg-surface-2' : ''}`}>
              <span className="w-[4.5rem] shrink-0 text-[12px] font-medium text-ink-2">{s.day}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[13px] font-medium">{s.type}</span>
                  {!rest && <span className="tag">{s.intensity}</span>}
                  {isHard(s.type, s.intensity) && !rest && (
                    <span className="text-[11px] text-warning">hard day</span>
                  )}
                </div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-ink-2">{s.description}</p>
              </div>
              <span className="num w-14 shrink-0 text-right text-[12px] text-ink-3">
                {rest ? '—' : hhmm(s.duration_min)}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function BlockView({ block, problems }: { block: PlanBlock; problems: string[] }) {
  return (
    <div className="space-y-3">
      {problems.length > 0 && (
        <Note kind="warning">
          The generated block breaks rules it was given: {problems.join(' ')} Regenerate, or adjust it yourself before
          you ride it.
        </Note>
      )}
      <div className="space-y-3">
        {block.weeks.map((w) => (
          <WeekView key={w.week} week={w} />
        ))}
      </div>
    </div>
  )
}

function AskBox() {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => () => abort.current?.abort(), [])

  const ask = async () => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setAnswer('')
    setError(null)
    setRunning(true)
    await streamCoach(
      '/coach/ask',
      { question },
      {
        onDelta: (d) => setAnswer((a) => a + d),
        onDone: (full) => {
          setAnswer(full)
          setRunning(false)
        },
        onError: (m) => {
          setError(m)
          setRunning(false)
        },
      },
      controller.signal,
    )
    setRunning(false)
  }

  return (
    <Panel title="Ask a planning question" right={<span className="text-[11px] text-ink-3">same data loaded</span>}>
      <div className="space-y-3 p-3.5">
        <textarea
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Should I ride the Saturday race or keep the long endurance ride? Am I doing enough threshold work for a flat A race in three weeks?"
        />
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-primary" onClick={ask} disabled={running || question.trim().length < 5}>
            {running ? 'Writing…' : 'Ask'}
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
        </div>
        {error && <Note kind="error">{error}</Note>}
        {answer && (
          <div className="prose-feedback max-w-[68ch] border-t border-rule pt-3 text-[13px] leading-relaxed">
            {answer
              .split(/\n{2,}/)
              .filter((p) => p.trim())
              .map((p, i) => (
                <p key={i}>{p.trim()}</p>
              ))}
          </div>
        )}
      </div>
    </Panel>
  )
}

export function Planner() {
  const [result, setResult] = useState<{ plan: PlanBlock; problems: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedName, setSavedName] = useState<string | null>(null)

  const coach = useAsync(() => api.coach.status(), [])
  const saved = useAsync(() => api.plans.list(), [])

  const generate = async () => {
    setBusy(true)
    setError(null)
    setSavedName(null)
    setResult(null)
    try {
      setResult(await api.coach.plan())
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!result) return
    const plan = await api.plans.save(result.plan)
    await api.plans.activate(plan.id)
    setSavedName(plan.name)
    saved.reload()
  }

  return (
    <div className="space-y-3">
      <Panel title="Next training block">
        <div className="space-y-3 p-3.5">
          {coach.data && !coach.data.configured && (
            <Note kind="warning">
              Planning needs an Anthropic API key on the server. Copy .env.example to .env, add ANTHROPIC_API_KEY and
              restart the API.
            </Note>
          )}
          <p className="max-w-[70ch] text-[13px] leading-relaxed text-ink-2">
            Builds three or four weeks from your profile, your race calendar, your last ten activities, your most
            recent saved feedback and your four-week load trend. The weekly hours target is a ceiling, every week gets
            a full rest day, and hard days are not stacked back to back. Anything the model gets wrong against those
            rules is flagged above the plan rather than quietly accepted.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={generate}
              disabled={busy || coach.data?.configured === false}
            >
              {busy ? 'Building…' : 'Generate a block'}
            </button>
            {result && !savedName && (
              <button type="button" className="btn" onClick={save}>
                Save and make active
              </button>
            )}
            {savedName && <span className="text-[12px] text-ink-3">Saved “{savedName}” as the active block.</span>}
          </div>
          {error && <Note kind="error">{error}</Note>}
          {busy && <Spinner label="Reading your training and drafting the block…" />}
        </div>
      </Panel>

      {result && (
        <>
          <Panel title={result.plan.name}>
            <p className="px-3.5 py-3 text-[13px] leading-relaxed">{result.plan.focus}</p>
          </Panel>
          <BlockView block={result.plan} problems={result.problems} />
        </>
      )}

      <AskBox />

      <Panel title="Saved blocks">
        <AsyncBody
          state={saved}
          isEmpty={(d) => d.length === 0}
          empty={<Empty>No blocks saved yet. Generate one above, then save it to keep it.</Empty>}
        >
          {(data) => (
            <ul className="divide-y divide-rule">
              {data.map((p) => (
                <li key={p.id} className="px-3.5 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium">
                      {p.name}
                      {p.active && <span className="tag ml-2 border-accent text-accent-ink">Active</span>}
                    </span>
                    <span className="num text-[11px] text-ink-3">{longDate(p.created_at.slice(0, 10))}</span>
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{p.focus}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setResult({ plan: { name: p.name, focus: p.focus, weeks: p.weeks }, problems: [] })}
                    >
                      View
                    </button>
                    {!p.active && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={async () => {
                          await api.plans.activate(p.id)
                          saved.reload()
                        }}
                      >
                        Make active
                      </button>
                    )}
                    <ConfirmButton
                      onConfirm={async () => {
                        await api.plans.remove(p.id)
                        saved.reload()
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
