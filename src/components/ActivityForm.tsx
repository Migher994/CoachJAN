import { useEffect, useState, type ReactNode } from 'react'
import type { ActivityType } from '../../shared/types'
import type { ActivityInput } from '../lib/api'
import { ACTIVITY_TYPES, today, typeLabel } from '../lib/format'
import { Field, Note } from './ui'

type Draft = Record<keyof ActivityInput, string>

const EMPTY: Draft = {
  date: today(),
  name: '',
  type: 'endurance',
  duration_min: '',
  distance_km: '',
  elevation_m: '',
  avg_power: '',
  normalized_power: '',
  max_power: '',
  avg_hr: '',
  max_hr: '',
  avg_cadence: '',
  kj: '',
  notes: '',
}

const str = (v: unknown): string => (v == null || v === '' ? '' : String(v))

export function toDraft(a: Partial<ActivityInput> | null): Draft {
  if (!a) return { ...EMPTY }
  return {
    date: str(a.date) || today(),
    name: str(a.name),
    type: str(a.type) || 'endurance',
    duration_min: str(a.duration_min),
    distance_km: str(a.distance_km),
    elevation_m: str(a.elevation_m),
    avg_power: str(a.avg_power),
    normalized_power: str(a.normalized_power),
    max_power: str(a.max_power),
    avg_hr: str(a.avg_hr),
    max_hr: str(a.max_hr),
    avg_cadence: str(a.avg_cadence),
    kj: str(a.kj),
    notes: str(a.notes),
  }
}

const numberOrNull = (v: string): number | null => {
  const t = v.trim()
  if (!t) return null
  const parsed = Number(t)
  return Number.isFinite(parsed) ? parsed : null
}

const NUMERIC: { key: keyof Draft; label: string; unit?: string; step?: string; hint?: string }[] = [
  { key: 'distance_km', label: 'Distance', unit: 'km', step: '0.01' },
  { key: 'elevation_m', label: 'Elevation', unit: 'm', step: '1' },
  { key: 'avg_power', label: 'Average power', unit: 'W', step: '1' },
  { key: 'normalized_power', label: 'Normalized power', unit: 'W', step: '1', hint: 'Load is measured rather than estimated when this is set' },
  { key: 'max_power', label: 'Max power', unit: 'W', step: '1' },
  { key: 'avg_hr', label: 'Average HR', unit: 'bpm', step: '1' },
  { key: 'max_hr', label: 'Max HR', unit: 'bpm', step: '1' },
  { key: 'avg_cadence', label: 'Average cadence', unit: 'rpm', step: '1' },
  { key: 'kj', label: 'Work', unit: 'kJ', step: '1' },
]

/** The one form behind manual entry, FIT confirmation and paste confirmation. */
export function ActivityForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  banner,
  busy,
}: {
  initial: Partial<ActivityInput> | null
  submitLabel: string
  onSubmit: (a: ActivityInput) => Promise<void> | void
  onCancel?: () => void
  banner?: ReactNode
  busy?: boolean
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(toDraft(initial))
    setError(null)
  }, [initial])

  const set = (key: keyof Draft, value: string) => setDraft((d) => ({ ...d, [key]: value }))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const duration = numberOrNull(draft.duration_min)
    if (!draft.name.trim()) return setError('Give the activity a name.')
    if (!duration || duration <= 0) return setError('Duration is required, in minutes.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return setError('Date must be a real date.')
    setError(null)

    await onSubmit({
      date: draft.date,
      name: draft.name.trim(),
      type: draft.type as ActivityType,
      duration_min: duration,
      distance_km: numberOrNull(draft.distance_km),
      elevation_m: numberOrNull(draft.elevation_m),
      avg_power: numberOrNull(draft.avg_power),
      normalized_power: numberOrNull(draft.normalized_power),
      max_power: numberOrNull(draft.max_power),
      avg_hr: numberOrNull(draft.avg_hr),
      max_hr: numberOrNull(draft.max_hr),
      avg_cadence: numberOrNull(draft.avg_cadence),
      kj: numberOrNull(draft.kj),
      notes: draft.notes.trim() || null,
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3 p-3.5">
      {banner}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Date">
          <input type="date" value={draft.date} onChange={(e) => set('date', e.target.value)} required />
        </Field>
        <Field label="Name" className="sm:col-span-2">
          <input
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Threshold 3x12"
            required
          />
        </Field>
        <Field label="Type">
          <select value={draft.type} onChange={(e) => set('type', e.target.value)}>
            {ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {typeLabel[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Duration (min)">
          <input
            type="number"
            step="0.1"
            min="0"
            value={draft.duration_min}
            onChange={(e) => set('duration_min', e.target.value)}
            required
          />
        </Field>
        {NUMERIC.map((f) => (
          <Field key={f.key} label={`${f.label}${f.unit ? ` (${f.unit})` : ''}`} hint={f.hint}>
            <input
              type="number"
              step={f.step}
              min="0"
              value={draft[f.key]}
              onChange={(e) => set(f.key, e.target.value)}
              placeholder="—"
            />
          </Field>
        ))}
      </div>

      <Field label="Notes" hint="How it felt, what the session was meant to be. The coach reads this.">
        <textarea rows={3} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>

      {error && <Note kind="error">{error}</Note>}

      <div className="flex items-center gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        <span className="text-[11px] text-ink-3">Leave a field blank when you do not have the number.</span>
      </div>
    </form>
  )
}
