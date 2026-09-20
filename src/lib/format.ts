export const dash = '–'

export const num = (v: number | null | undefined, dp = 0): string =>
  v == null || Number.isNaN(v) ? dash : v.toFixed(dp)

export const int = (v: number | null | undefined): string =>
  v == null || Number.isNaN(v) ? dash : Math.round(v).toLocaleString('en-GB')

/** 135 -> "2h 15m" */
export const hhmm = (minutes: number | null | undefined): string => {
  if (minutes == null) return dash
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

export const mmss = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`

/** Elapsed clock time: mm:ss below an hour, h:mm:ss above it. */
export const elapsed = (seconds: number): string => {
  const s = Math.round(seconds)
  if (s < 3600) return mmss(s)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Display sign with a real minus, for values where direction is the point. */
export const signed = (v: number | null | undefined, dp = 1): string => {
  if (v == null || Number.isNaN(v)) return dash
  const rounded = Number(v.toFixed(dp))
  if (rounded === 0) return (0).toFixed(dp)
  return `${rounded > 0 ? '+' : '\u2212'}${Math.abs(rounded).toFixed(dp)}`
}

/** Axis labels on the power curve: 5s, 1m, 20m, 1h. */
export const duration = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const h = seconds / 3600
  return `${h % 1 === 0 ? h : h.toFixed(1)}h`
}

export const today = (): string => new Date().toISOString().slice(0, 10)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const shortDate = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const sameYear = new Date().getFullYear() === y
  return `${d} ${MONTHS[m - 1]}${sameYear ? '' : ` ${String(y).slice(2)}`}`
}

export const longDate = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const weekday = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })
  return `${weekday} ${d} ${MONTHS[m - 1]} ${y}`
}

export const daysBetween = (fromIso: string, toIso: string): number =>
  Math.round(
    (new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / 86_400_000,
  )

export const ACTIVITY_TYPES = ['race', 'interval', 'endurance', 'recovery', 'commute', 'other'] as const

export const typeLabel: Record<string, string> = {
  race: 'Race',
  interval: 'Intervals',
  endurance: 'Endurance',
  recovery: 'Recovery',
  commute: 'Commute',
  other: 'Other',
}
