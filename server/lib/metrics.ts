/**
 * Derived training metrics. Everything here is computed from stored data.
 * When an input is missing the function returns null and the caller records a
 * gap - nothing in this file invents a value to keep a chart or a prompt full.
 */
import type {
  Activity,
  BestEfforts,
  ClimbEffort,
  Decoupling,
  GearingSummary,
  PmcPoint,
  QuarterSplit,
  WeeklyLoad,
} from '../../shared/types.js'
import type { StreamData } from './streams.js'

/** 700x25c on a road bike. Only used to turn speed/cadence into a gear ratio. */
export const WHEEL_CIRCUMFERENCE_M = 2.105

const round = (v: number, dp = 1): number => {
  const f = 10 ** dp
  return Math.round(v * f) / f
}

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null

/* ------------------------------------------------------------------ */
/* Power maths                                                          */
/* ------------------------------------------------------------------ */

/** 30 second rolling average, raised to the fourth, averaged, fourth root. */
export function normalizedPower(power: (number | null)[]): number | null {
  const p = power.map((v) => v ?? 0)
  const win = 30
  if (p.length < win * 2) return null
  let sum = 0
  let acc = 0
  let n = 0
  for (let i = 0; i < p.length; i++) {
    sum += p[i]
    if (i >= win) sum -= p[i - win]
    if (i >= win - 1) {
      const m = sum / win
      acc += m * m * m * m
      n++
    }
  }
  if (!n) return null
  return Math.round((acc / n) ** 0.25)
}

/** Best rolling average power over `seconds`, in watts. */
export function bestEffort(power: (number | null)[], seconds: number): number | null {
  const p = power.map((v) => v ?? 0)
  if (p.length < seconds || seconds <= 0) return null
  let sum = 0
  let best = Number.NEGATIVE_INFINITY
  for (let i = 0; i < p.length; i++) {
    sum += p[i]
    if (i >= seconds) sum -= p[i - seconds]
    if (i >= seconds - 1) best = Math.max(best, sum / seconds)
  }
  return Number.isFinite(best) ? Math.round(best) : null
}

export const CURVE_DURATIONS = [
  1, 5, 10, 15, 30, 60, 120, 300, 480, 600, 1200, 1800, 2400, 3600, 5400,
] as const

export const HEADLINE_DURATIONS = [5, 60, 300, 1200, 3600] as const

export function bestEfforts(power: (number | null)[]): BestEfforts {
  return {
    s5: bestEffort(power, 5),
    s60: bestEffort(power, 60),
    s300: bestEffort(power, 300),
    s1200: bestEffort(power, 1200),
    s3600: bestEffort(power, 3600),
  }
}

/* ------------------------------------------------------------------ */
/* Training load                                                        */
/* ------------------------------------------------------------------ */

export interface LoadResult {
  tss: number | null
  basis: 'measured' | 'estimated' | null
  intensity_factor: number | null
}

/**
 * TSS from normalized power where it exists, average power otherwise.
 * `basis` tells the UI whether the number was measured or estimated; without
 * an FTP or any power at all there is no number to show.
 */
export function computeLoad(a: Pick<Activity, 'duration_min' | 'normalized_power' | 'avg_power'>, ftp: number | null): LoadResult {
  if (!ftp || ftp <= 0) return { tss: null, basis: null, intensity_factor: null }
  const watts = a.normalized_power ?? a.avg_power
  if (!watts || watts <= 0) return { tss: null, basis: null, intensity_factor: null }
  const hours = a.duration_min / 60
  const intensity = watts / ftp
  return {
    tss: round(hours * intensity * intensity * 100),
    basis: a.normalized_power ? 'measured' : 'estimated',
    intensity_factor: round(intensity, 3),
  }
}

export function variabilityIndex(np: number | null, avg: number | null): number | null {
  if (!np || !avg || avg <= 0) return null
  return round(np / avg, 3)
}

const dayMs = 86_400_000
const isoDay = (d: Date): string => d.toISOString().slice(0, 10)

/**
 * Daily TSS expanded into a continuous series, then a 42 day and 7 day
 * trailing mean over it. Days with no riding count as zero, which is what
 * makes the two averages comparable.
 */
export function pmcSeries(
  dated: { date: string; tss: number | null }[],
  today = isoDay(new Date()),
): PmcPoint[] {
  const withLoad = dated.filter((d) => d.tss != null)
  if (!withLoad.length) return []
  const perDay = new Map<string, number>()
  for (const d of withLoad) perDay.set(d.date, (perDay.get(d.date) ?? 0) + (d.tss as number))

  const dates = [...perDay.keys()].sort()
  const start = new Date(`${dates[0]}T00:00:00Z`).getTime()
  const end = Math.max(new Date(`${dates[dates.length - 1]}T00:00:00Z`).getTime(), new Date(`${today}T00:00:00Z`).getTime())

  const daily: { date: string; tss: number }[] = []
  for (let t = start; t <= end; t += dayMs) {
    const key = isoDay(new Date(t))
    daily.push({ date: key, tss: perDay.get(key) ?? 0 })
  }

  const trailingMean = (i: number, window: number): number => {
    const from = Math.max(0, i - window + 1)
    let sum = 0
    for (let k = from; k <= i; k++) sum += daily[k].tss
    return sum / window
  }

  return daily.map((d, i) => {
    const fitness = round(trailingMean(i, 42))
    const fatigue = round(trailingMean(i, 7))
    return { date: d.date, tss: round(d.tss), fitness, fatigue, form: round(fitness - fatigue) }
  })
}

/** Monday 00:00 of the week containing `iso`, as an ISO date. */
export function weekStart(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dow)
  return isoDay(d)
}

export function weeklyLoads(
  rows: { date: string; duration_min: number; tss: number | null }[],
  weeks: number,
  today = isoDay(new Date()),
): WeeklyLoad[] {
  const thisWeek = weekStart(today)
  const buckets = new Map<string, WeeklyLoad>()
  const start = new Date(`${thisWeek}T00:00:00Z`).getTime() - (weeks - 1) * 7 * dayMs
  for (let i = 0; i < weeks; i++) {
    const key = isoDay(new Date(start + i * 7 * dayMs))
    buckets.set(key, { week_start: key, tss: 0, hours: 0, activities: 0, incomplete: false })
  }
  for (const r of rows) {
    const key = weekStart(r.date)
    const bucket = buckets.get(key)
    if (!bucket) continue
    bucket.activities++
    bucket.hours = round(bucket.hours + r.duration_min / 60, 2)
    if (r.tss == null) bucket.incomplete = true
    else bucket.tss = round(bucket.tss + r.tss)
  }
  return [...buckets.values()]
}

/* ------------------------------------------------------------------ */
/* Stream analysis                                                      */
/* ------------------------------------------------------------------ */

const movingIdx = (s: StreamData): number[] => {
  const out: number[] = []
  for (let i = 0; i < s.moving.length; i++) if (s.moving[i]) out.push(i)
  return out
}

/**
 * NP:HR ratio in the first half against the second, over moving time.
 * Positive drift means power fell relative to heart rate, the usual reading of
 * aerobic decoupling.
 */
export function decoupling(s: StreamData): Decoupling | null {
  const idx = movingIdx(s)
  if (idx.length < 1200) return null
  const half = Math.floor(idx.length / 2)
  const slice = (from: number, to: number) => {
    const part = idx.slice(from, to)
    const np = normalizedPower(part.map((i) => s.power[i]))
    const hr = mean(part.map((i) => s.hr[i]).filter((v): v is number => v != null && v > 0))
    return { np, hr: hr == null ? null : round(hr) }
  }
  const a = slice(0, half)
  const b = slice(half, idx.length)
  if (!a.np || !a.hr || !b.np || !b.hr) {
    return { first_half_np: a.np, first_half_hr: a.hr, second_half_np: b.np, second_half_hr: b.hr, drift_pct: null }
  }
  const r1 = a.np / a.hr
  const r2 = b.np / b.hr
  return {
    first_half_np: a.np,
    first_half_hr: a.hr,
    second_half_np: b.np,
    second_half_hr: b.hr,
    drift_pct: round(((r1 - r2) / r1) * 100, 1),
  }
}

export function quarterSplits(s: StreamData): QuarterSplit[] | null {
  const idx = movingIdx(s)
  if (idx.length < 600) return null
  const size = Math.floor(idx.length / 4)
  const out: QuarterSplit[] = []
  for (let q = 0; q < 4; q++) {
    const part = idx.slice(q * size, q === 3 ? idx.length : (q + 1) * size)
    const hr = mean(part.map((i) => s.hr[i]).filter((v): v is number => v != null && v > 0))
    const cad = mean(part.map((i) => s.cadence[i]).filter((v): v is number => v != null && v > 0))
    const coasting = part.filter((i) => (s.power[i] ?? 0) <= 0).length
    out.push({
      quarter: (q + 1) as 1 | 2 | 3 | 4,
      normalized_power: normalizedPower(part.map((i) => s.power[i])),
      avg_hr: hr == null ? null : Math.round(hr),
      avg_cadence: cad == null ? null : Math.round(cad),
      coasting_pct: part.length ? round((coasting / part.length) * 100, 1) : null,
    })
  }
  return out
}

/** Rolling mean that keeps the array length, using a trailing window. */
function smooth(xs: (number | null)[], win: number): (number | null)[] {
  const out: (number | null)[] = new Array(xs.length).fill(null)
  let sum = 0
  let n = 0
  const q: number[] = []
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i]
    if (v != null) {
      q.push(v)
      sum += v
      n++
    } else {
      q.push(Number.NaN)
    }
    if (q.length > win) {
      const drop = q.shift() as number
      if (!Number.isNaN(drop)) {
        sum -= drop
        n--
      }
    }
    out[i] = n > 0 ? sum / n : null
  }
  return out
}

/**
 * Grade per second. Uses the file's own grade channel when present, otherwise
 * derives it from smoothed altitude over a trailing distance window, which
 * avoids the spikes you get from differencing raw barometric altitude.
 */
export function deriveGrade(s: StreamData): (number | null)[] {
  if (s.grade.some((g) => g != null)) return smooth(s.grade, 15)
  const alt = smooth(s.altitude, 15)
  const out: (number | null)[] = new Array(s.second.length).fill(null)
  for (let i = 0; i < out.length; i++) {
    let j = i
    // Walk back until at least 30 m of ground has been covered.
    while (j > 0) {
      const d0 = s.distance[j]
      const d1 = s.distance[i]
      if (d0 != null && d1 != null && d1 - d0 >= 30) break
      j--
    }
    const a0 = alt[j]
    const a1 = alt[i]
    const d0 = s.distance[j]
    const d1 = s.distance[i]
    if (a0 == null || a1 == null || d0 == null || d1 == null) continue
    const run = d1 - d0
    if (run < 20) continue
    out[i] = round(((a1 - a0) / run) * 100, 2)
  }
  return smooth(out, 10)
}

export interface GearRatios {
  /** Gear ratio per second, or null where the rider was not pedalling under load. */
  ratio: (number | null)[]
  summary: GearingSummary
  grade: (number | null)[]
}

/**
 * Gear ratio derived from speed and cadence. Only gears the rider actually
 * used are visible, so `lowest_ratio` is the lowest ratio *used*, estimated as
 * the smallest ratio holding at least 1% of pedalling time - a single noisy
 * sample should not define the bottom of the cassette.
 */
export function gearing(s: StreamData, grade: (number | null)[]): GearRatios {
  const ratio: (number | null)[] = new Array(s.second.length).fill(null)
  const histogram = new Map<number, number>()
  let pedalling = 0
  for (let i = 0; i < s.second.length; i++) {
    const cad = s.cadence[i]
    const spd = s.speed[i]
    if (!s.moving[i] || cad == null || spd == null || cad < 30 || spd < 2) continue
    const r = (spd * 60) / cad / WHEEL_CIRCUMFERENCE_M
    if (r < 0.7 || r > 6) continue
    ratio[i] = round(r, 3)
    const bucket = Math.round(r * 20) / 20
    histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1)
    pedalling++
  }

  let lowest: number | null = null
  let highest: number | null = null
  if (pedalling > 60) {
    const buckets = [...histogram.entries()].sort((a, b) => a[0] - b[0])
    const floor = pedalling * 0.01
    lowest = buckets.find(([, n]) => n >= floor)?.[0] ?? null
    highest = [...buckets].reverse().find(([, n]) => n >= floor)?.[0] ?? null
  }

  let steepSeconds = 0
  let steepInLowest = 0
  for (let i = 0; i < s.second.length; i++) {
    const g = grade[i]
    if (g == null || g <= 3 || !s.moving[i]) continue
    steepSeconds++
    const r = ratio[i]
    if (lowest != null && r != null && r <= lowest * 1.03) steepInLowest++
  }

  return {
    ratio,
    grade,
    summary: {
      lowest_ratio: lowest,
      highest_ratio: highest,
      steep_seconds: steepSeconds,
      steep_time_in_lowest_gear_pct: steepSeconds >= 60 ? round((steepInLowest / steepSeconds) * 100, 1) : null,
      assumed_wheel_circumference_m: WHEEL_CIRCUMFERENCE_M,
    },
  }
}

/**
 * Sustained climbs: grade above 3% held for 90 seconds or more, in the order
 * they were ridden so fade across the ride is visible.
 */
export function climbs(
  s: StreamData,
  grade: (number | null)[],
  ratio: (number | null)[],
  lowestRatio: number | null,
): ClimbEffort[] {
  const runs: { from: number; to: number }[] = []
  let start = -1
  let belowFor = 0
  for (let i = 0; i < grade.length; i++) {
    const g = grade[i]
    const steep = g != null && g > 3 && s.moving[i]
    if (steep) {
      if (start < 0) start = i
      belowFor = 0
    } else if (start >= 0) {
      belowFor++
      // Tolerate a short false flat inside a climb before calling it over.
      if (belowFor > 15) {
        runs.push({ from: start, to: i - belowFor })
        start = -1
        belowFor = 0
      }
    }
  }
  if (start >= 0) runs.push({ from: start, to: grade.length - 1 })

  return runs
    .filter((r) => r.to - r.from + 1 >= 90)
    .map((r, n) => {
      const range: number[] = []
      for (let i = r.from; i <= r.to; i++) range.push(i)
      const power = mean(range.map((i) => s.power[i]).filter((v): v is number => v != null))
      const cad = mean(range.map((i) => s.cadence[i]).filter((v): v is number => v != null && v > 0))
      const spd = mean(range.map((i) => s.speed[i]).filter((v): v is number => v != null))
      const g = mean(range.map((i) => grade[i]).filter((v): v is number => v != null))
      const a0 = s.altitude[r.from]
      const a1 = s.altitude[r.to]
      const inLowest = lowestRatio == null
        ? null
        : range.filter((i) => ratio[i] != null && (ratio[i] as number) <= lowestRatio * 1.03).length
      return {
        index: n + 1,
        start_second: s.second[r.from],
        duration_s: r.to - r.from + 1,
        avg_grade_pct: g == null ? 0 : round(g, 1),
        elevation_gain_m: a0 != null && a1 != null ? round(a1 - a0) : 0,
        avg_power: power == null ? null : Math.round(power),
        avg_cadence: cad == null ? null : Math.round(cad),
        avg_speed_kmh: spd == null ? null : round(spd * 3.6, 1),
        lowest_gear_pct: inLowest == null ? null : round((inLowest / range.length) * 100, 1),
      }
    })
}

export function streamKj(s: StreamData): number | null {
  let joules = 0
  let samples = 0
  for (let i = 0; i < s.power.length; i++) {
    const p = s.power[i]
    if (p != null) {
      joules += p
      samples++
    }
  }
  return samples > 60 ? round(joules / 1000) : null
}

export { round, mean, isoDay }
