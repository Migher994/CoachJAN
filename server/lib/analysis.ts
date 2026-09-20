/** Assembles stored rows plus stream maths into the shapes the UI and the prompts use. */
import { db } from '../db.js'
import type {
  Activity,
  ActivityAnalysis,
  ActivityRow,
  BlockAnalysis,
  Fuelling,
  PowerCurve,
  PowerCurvePoint,
  Profile,
} from '../../shared/types.js'
import {
  CURVE_DURATIONS,
  bestEffort,
  bestEfforts,
  climbs,
  computeLoad,
  decoupling,
  deriveGrade,
  gearing,
  isoDay,
  normalizedPower,
  quarterSplits,
  round,
  streamKj,
  variabilityIndex,
  weeklyLoads,
} from './metrics.js'
import { hasStream, loadStream } from './streams.js'

export function getProfile(): Profile {
  return db.prepare('SELECT * FROM profile WHERE id = 1').get() as Profile
}

export function getActivity(id: number): Activity | null {
  return (db.prepare('SELECT * FROM activity WHERE id = ?').get(id) as Activity | undefined) ?? null
}

/** Attach load, intensity and stream presence to a stored activity. */
export function decorate(a: Activity, ftp: number | null): ActivityRow {
  const load = computeLoad(a, ftp)
  return {
    ...a,
    tss: load.tss,
    tss_basis: load.basis,
    intensity_factor: load.intensity_factor,
    has_streams: hasStream(a.id),
  }
}

export function listActivities(opts: { from?: string; to?: string; limit?: number } = {}): ActivityRow[] {
  const ftp = getProfile().ftp
  const clauses: string[] = []
  const params: unknown[] = []
  if (opts.from) {
    clauses.push('date >= ?')
    params.push(opts.from)
  }
  if (opts.to) {
    clauses.push('date <= ?')
    params.push(opts.to)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const limit = opts.limit ? 'LIMIT ?' : ''
  if (opts.limit) params.push(opts.limit)
  const rows = db
    .prepare(`SELECT * FROM activity ${where} ORDER BY date DESC, id DESC ${limit}`)
    .all(...params) as Activity[]
  return rows.map((a) => decorate(a, ftp))
}

const FUEL_KJ_PER_G_CARB = 4 * 4.184

function fuelling(a: Activity, streamKjValue: number | null): Fuelling {
  const hours = a.duration_min / 60
  let kj: number | null = streamKjValue
  let basis: Fuelling['kj_basis'] = streamKjValue != null ? 'stream' : null
  if (kj == null && a.kj != null) {
    kj = a.kj
    basis = 'logged'
  }
  if (kj == null && a.avg_power != null) {
    kj = round((a.avg_power * a.duration_min * 60) / 1000)
    basis = 'estimated'
  }
  const carbTarget = round(hours * 90)
  return {
    kj,
    kj_basis: basis,
    duration_hours: round(hours, 2),
    carb_target_g: carbTarget,
    carb_target_kj: round(carbTarget * FUEL_KJ_PER_G_CARB),
  }
}

/** Everything the feedback prompt needs about one ride. */
export function analyseActivity(id: number): ActivityAnalysis | null {
  const activity = getActivity(id)
  if (!activity) return null
  const profile = getProfile()
  const row = decorate(activity, profile.ftp)
  const stream = loadStream(id)
  const gaps: string[] = []

  if (!profile.ftp) gaps.push('No FTP set, so TSS and intensity factor could not be computed.')
  if (!activity.normalized_power && !stream) {
    gaps.push('No normalized power recorded; load is estimated from average power.')
  }
  if (!stream) {
    gaps.push('No FIT file uploaded for this ride, so decoupling, quarter splits, climb analysis, gearing and the power curve are unavailable.')
  }

  let np = activity.normalized_power
  let best = null as ReturnType<typeof bestEfforts> | null
  let quarters = null
  let climbList = null
  let gearSummary = null
  let drift = null
  let kjFromStream: number | null = null

  if (stream) {
    np = np ?? normalizedPower(stream.power)
    best = bestEfforts(stream.power)
    quarters = quarterSplits(stream)
    drift = decoupling(stream)
    kjFromStream = streamKj(stream)
    const grade = deriveGrade(stream)
    const gears = gearing(stream, grade)
    gearSummary = gears.summary
    climbList = climbs(stream, grade, gears.ratio, gears.summary.lowest_ratio)
    if (!climbList.length) {
      gaps.push('No sustained climbs (above 3% for 90 seconds or more) in this ride.')
    }
    if (gearSummary.steep_time_in_lowest_gear_pct == null) {
      gaps.push('Too little steep time to judge whether the rider ran out of gears.')
    }
    if (!stream.hr.some((v) => v != null)) gaps.push('No heart rate in the file, so decoupling is unavailable.')
    if (!stream.cadence.some((v) => v != null)) gaps.push('No cadence in the file, so gearing analysis is unavailable.')
  }

  const load = computeLoad({ ...activity, normalized_power: np }, profile.ftp)

  return {
    activity: { ...row, normalized_power: np },
    ftp: profile.ftp,
    has_streams: Boolean(stream),
    variability_index: variabilityIndex(np, activity.avg_power),
    intensity_factor: load.intensity_factor,
    tss: load.tss,
    tss_basis: load.basis,
    decoupling: drift,
    quarters,
    climbs: climbList,
    gearing: gearSummary,
    best_efforts: best,
    fuelling: fuelling(activity, kjFromStream),
    gaps,
  }
}

export function analyseBlock(from: string, to: string): BlockAnalysis {
  const rows = listActivities({ from, to })
  const analyses = rows
    .map((r) => analyseActivity(r.id))
    .filter((a): a is ActivityAnalysis => a != null)
    .reverse()

  const days = Math.max(
    1,
    Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000) + 1,
  )
  const riddenDays = new Set(rows.map((r) => r.date))
  const weeks = Math.max(1, Math.ceil(days / 7))
  const gaps: string[] = []
  if (rows.some((r) => r.tss == null)) {
    gaps.push(`${rows.filter((r) => r.tss == null).length} of ${rows.length} activities in this window have no power data, so the load totals understate the block.`)
  }

  return {
    from,
    to,
    days,
    activities: analyses,
    total_tss: round(rows.reduce((sum, r) => sum + (r.tss ?? 0), 0)),
    total_hours: round(rows.reduce((sum, r) => sum + r.duration_min, 0) / 60, 1),
    total_distance_km: round(rows.reduce((sum, r) => sum + (r.distance_km ?? 0), 0), 1),
    ride_count: rows.length,
    rest_days: days - riddenDays.size,
    weekly: weeklyLoads(rows, weeks, to),
    gaps,
  }
}

/**
 * Best power at each duration across every activity with a stream in the
 * window. Durations longer than the longest ride are simply absent - the curve
 * stops where the data stops rather than being extrapolated.
 */
export function powerCurve(label: string, from: string, to: string): PowerCurve {
  const ids = db
    .prepare(
      `SELECT a.id, a.date FROM activity a
       JOIN activity_stream s ON s.activity_id = a.id
       WHERE a.date >= ? AND a.date <= ?
       ORDER BY a.date`,
    )
    .all(from, to) as { id: number; date: string }[]

  const best = new Map<number, PowerCurvePoint>()
  for (const { id, date } of ids) {
    const stream = loadStream(id)
    if (!stream) continue
    for (const seconds of CURVE_DURATIONS) {
      const watts = bestEffort(stream.power, seconds)
      if (watts == null) continue
      const current = best.get(seconds)
      if (!current || watts > current.watts) best.set(seconds, { seconds, watts, activity_id: id, date })
    }
  }

  return {
    label,
    from,
    to,
    sample_size: ids.length,
    points: [...best.values()].sort((a, b) => a.seconds - b.seconds),
  }
}

export function daysAgo(n: number, today = isoDay(new Date())): string {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return isoDay(d)
}

export { isoDay }
