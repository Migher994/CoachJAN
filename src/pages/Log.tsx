import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ActivityForm } from '../components/ActivityForm'
import { Empty, Note, Panel, Spinner, useAsync } from '../components/ui'
import { ApiError, api, type ActivityInput, type FitPreview, type PastedActivity } from '../lib/api'
import { hhmm, shortDate } from '../lib/format'

type Mode = 'fit' | 'paste' | 'manual'

const MODES: { id: Mode; label: string; blurb: string }[] = [
  { id: 'fit', label: 'Upload FIT', blurb: 'Full second-by-second data. Needed for the power curve and the deeper analysis.' },
  { id: 'paste', label: 'Paste summary', blurb: 'Drop in a Strava or TrainingPeaks summary and Claude turns it into fields for you to check.' },
  { id: 'manual', label: 'Type it in', blurb: 'Straight into the form.' },
]

export function Log() {
  const [mode, setMode] = useState<Mode>('fit')
  const navigate = useNavigate()
  const coach = useAsync(() => api.coach.status(), [])

  const [preview, setPreview] = useState<FitPreview | null>(null)
  const [parsed, setParsed] = useState<PastedActivity | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const reset = () => {
    setPreview(null)
    setParsed(null)
    setError(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  const handleFile = async (file: File) => {
    setBusy(true)
    setError(null)
    setSaved(null)
    try {
      setPreview(await api.activities.upload(file))
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const commitFit = async (a: ActivityInput) => {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      const activity = await api.activities.commitUpload(preview.token, a)
      reset()
      navigate(`/activity/${activity.id}`)
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const runParse = async () => {
    setBusy(true)
    setError(null)
    setSaved(null)
    try {
      setParsed(await api.coach.parseActivity(pasteText))
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const save = async (a: ActivityInput) => {
    setBusy(true)
    setError(null)
    try {
      const activity = await api.activities.create(a)
      reset()
      setPasteText('')
      setSaved(activity.name)
      navigate(`/activity/${activity.id}`)
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const active = MODES.find((m) => m.id === mode)

  return (
    <div className="space-y-3">
      <Panel
        title="Add an activity"
        right={
          <div className="flex gap-0.5">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`rounded-[2px] px-2.5 py-1 text-[12px] ${
                  mode === m.id ? 'bg-accent-wash font-medium text-accent-ink' : 'text-ink-2 hover:bg-surface-2'
                }`}
                onClick={() => {
                  setMode(m.id)
                  reset()
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        }
      >
        <p className="border-b border-rule px-3.5 py-2 text-[12px] text-ink-3">{active?.blurb}</p>

        {error && (
          <div className="p-3.5 pb-0">
            <Note kind="error">{error}</Note>
          </div>
        )}
        {saved && (
          <div className="p-3.5 pb-0">
            <Note>Saved “{saved}”.</Note>
          </div>
        )}

        {mode === 'fit' && !preview && (
          <div className="p-3.5">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 border border-dashed border-rule-strong px-4 py-10 text-center hover:bg-surface-2">
              <span className="text-[13px] font-medium">Choose a .fit file</span>
              <span className="max-w-sm text-[12px] leading-relaxed text-ink-3">
                Exported from a head unit or downloaded from Strava. Nothing is saved until you have checked the
                summary on the next screen.
              </span>
              <input
                ref={fileInput}
                type="file"
                accept=".fit"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleFile(file)
                }}
              />
            </label>
            {busy && <Spinner label="Decoding the file…" />}
          </div>
        )}

        {mode === 'fit' && preview && (
          <ActivityForm
            initial={preview.summary}
            submitLabel="Save activity and stream"
            busy={busy}
            onSubmit={commitFit}
            onCancel={async () => {
              await api.activities.discardUpload(preview.token).catch(() => {})
              reset()
            }}
            banner={
              <div className="space-y-2">
                <Note>
                  Read {preview.sample_count.toLocaleString('en-GB')} seconds of data, {hhmm(preview.moving_seconds / 60)}{' '}
                  of it moving. Channels found: {preview.found.join(', ') || 'none'}. Check the summary below, then save.
                </Note>
                {preview.warnings.map((w) => (
                  <Note key={w} kind="warning">
                    {w}
                  </Note>
                ))}
              </div>
            }
          />
        )}

        {mode === 'paste' && !parsed && (
          <div className="space-y-3 p-3.5">
            {coach.data && !coach.data.configured && (
              <Note kind="warning">
                Pasting needs an Anthropic API key on the server. Add ANTHROPIC_API_KEY to .env and restart the API, or
                use “Type it in”.
              </Note>
            )}
            <textarea
              rows={10}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={
                'Paste anything here. For example:\n\nMorning Ride\n2h 14m · 63.4 km · 412 m\nAvg 186 W · NP 204 W · Avg HR 138 · 1,498 kJ\nFelt heavy on the climbs, last hour was a slog.'
              }
              className="font-mono text-[12px]"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || pasteText.trim().length < 5 || coach.data?.configured === false}
                onClick={runParse}
              >
                {busy ? 'Reading…' : 'Read it'}
              </button>
              <span className="text-[11px] text-ink-3">You confirm every field before anything is saved.</span>
            </div>
            {busy && <Spinner label="Claude is pulling fields out of the text…" />}
          </div>
        )}

        {mode === 'paste' && parsed && (
          <ActivityForm
            initial={parsed as Partial<ActivityInput>}
            submitLabel="Save activity"
            busy={busy}
            onSubmit={save}
            onCancel={() => setParsed(null)}
            banner={
              <div className="space-y-2">
                <Note kind={parsed.confidence === 'low' ? 'warning' : 'info'}>
                  Parsed with {parsed.confidence} confidence. {parsed.parse_notes} Check every field before saving.
                </Note>
              </div>
            }
          />
        )}

        {mode === 'manual' && <ActivityForm initial={null} submitLabel="Save activity" busy={busy} onSubmit={save} />}
      </Panel>

      <RecentlyLogged />
    </div>
  )
}

function RecentlyLogged() {
  const recent = useAsync(() => api.activities.list({ limit: 8 }), [])
  return (
    <Panel title="Recently logged">
      {recent.loading && recent.data == null ? (
        <Spinner label="Loading…" />
      ) : recent.data && recent.data.length > 0 ? (
        <ul className="divide-y divide-rule">
          {recent.data.map((a) => (
            <li key={a.id} className="flex items-baseline justify-between gap-3 px-3.5 py-2">
              <Link className="min-w-0 truncate text-[13px] hover:text-accent-ink hover:underline underline-offset-2" to={`/activity/${a.id}`}>
                {a.name}
              </Link>
              <span className="num shrink-0 text-[12px] text-ink-3">
                {shortDate(a.date)} · {hhmm(a.duration_min)}
                {a.has_streams && ' · FIT'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>Nothing logged yet. The three ways in are above.</Empty>
      )}
    </Panel>
  )
}
