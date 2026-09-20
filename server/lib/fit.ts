/**
 * FIT decoding. Produces the summary fields the Activity table stores plus a
 * dense 1 Hz stream. Recording gaps are filled so the arrays stay aligned to
 * elapsed seconds, and those filled seconds are flagged as not moving rather
 * than being passed off as coasting.
 */
import FitParser from 'fit-file-parser'
import type { Activity, ActivityType } from '../../shared/types.js'
import type { StreamData } from './streams.js'
import { normalizedPower, round, streamKj } from './metrics.js'

type Row = Record<string, unknown>

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

const toMs = (v: unknown): number | null => {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : t
  }
  return null
}

export interface ParsedFitResult {
  summary: Omit<Activity, 'id' | 'created_at' | 'source' | 'raw_fit_path'>
  stream: StreamData
  warnings: string[]
  /** Fields present in the file, so the confirmation screen can show what was found. */
  found: string[]
}

const SPORT_TO_TYPE: Record<string, ActivityType> = {
  cycling: 'endurance',
  road: 'endurance',
  virtual_activity: 'endurance',
}

export async function parseFit(buffer: Buffer, fallbackName: string): Promise<ParsedFitResult> {
  const parser = new FitParser({
    force: true,
    speedUnit: 'm/s',
    lengthUnit: 'm',
    temperatureUnit: 'celsius',
    elapsedRecordField: true,
    mode: 'list',
  })

  // Copy into a plain ArrayBuffer: the parser's signature rejects Buffer<SharedArrayBuffer>.
  const bytes = new Uint8Array(buffer.byteLength)
  bytes.set(buffer)
  const data = await parser.parseAsync(bytes.buffer)
  const records = (data.records ?? []) as Row[]
  if (!records.length) throw new Error('This FIT file contains no record messages, so there is nothing to import.')

  const session = ((data.sessions ?? [])[0] ?? {}) as Row
  const warnings: string[] = []

  const timed = records
    .map((r) => ({ r, t: toMs(r.timestamp) }))
    .filter((x): x is { r: Row; t: number } => x.t != null)
    .sort((a, b) => a.t - b.t)
  if (!timed.length) throw new Error('No usable timestamps in the FIT records.')

  const startMs = timed[0].t
  const endMs = timed[timed.length - 1].t
  const span = Math.floor((endMs - startMs) / 1000) + 1
  if (span > 60 * 60 * 24) throw new Error('This file spans more than 24 hours; it does not look like a single ride.')

  const bySecond = new Map<number, Row>()
  for (const { r, t } of timed) bySecond.set(Math.floor((t - startMs) / 1000), r)

  const stream: StreamData = {
    second: [], power: [], hr: [], cadence: [], speed: [], altitude: [], distance: [], grade: [], moving: [],
  }

  let lastHr: number | null = null
  let lastAlt: number | null = null
  let lastDist: number | null = null
  let gapSeconds = 0

  for (let s = 0; s < span; s++) {
    const r = bySecond.get(s)
    stream.second.push(s)
    if (!r) {
      gapSeconds++
      stream.power.push(0)
      stream.hr.push(lastHr)
      stream.cadence.push(0)
      stream.speed.push(0)
      stream.altitude.push(lastAlt)
      stream.distance.push(lastDist)
      stream.grade.push(null)
      stream.moving.push(false)
      continue
    }
    const power = num(r.power)
    const speed = num(r.enhanced_speed) ?? num(r.speed)
    const hr = num(r.heart_rate)
    const cadence = num(r.cadence)
    const altitude = num(r.enhanced_altitude) ?? num(r.altitude)
    const distance = num(r.distance)
    const grade = num(r.grade)

    if (hr != null) lastHr = hr
    if (altitude != null) lastAlt = altitude
    if (distance != null) lastDist = distance

    stream.power.push(power)
    stream.hr.push(hr ?? lastHr)
    stream.cadence.push(cadence)
    stream.speed.push(speed)
    stream.altitude.push(altitude ?? lastAlt)
    stream.distance.push(distance ?? lastDist)
    stream.grade.push(grade)
    stream.moving.push((speed ?? 0) > 0.5 || (power ?? 0) > 0)
  }

  if (gapSeconds > 0) {
    warnings.push(`${gapSeconds} second${gapSeconds === 1 ? '' : 's'} of the elapsed time had no recorded data and were filled as stopped time.`)
  }

  const found: string[] = []
  const has = (key: keyof StreamData, label: string) => {
    if ((stream[key] as (number | null)[]).some((v) => v != null && v !== 0)) found.push(label)
    else warnings.push(`No ${label.toLowerCase()} data in this file.`)
  }
  has('power', 'Power')
  has('hr', 'Heart rate')
  has('cadence', 'Cadence')
  has('altitude', 'Altitude')
  has('speed', 'Speed')

  const movingSeconds = stream.moving.filter(Boolean).length
  const timerTime = num(session.total_timer_time)
  const durationMin = round((timerTime ?? movingSeconds) / 60, 1)

  const sessionDistanceM = num(session.total_distance)
  const distanceKm = sessionDistanceM != null
    ? round(sessionDistanceM / 1000, 2)
    : lastDist != null ? round(lastDist / 1000, 2) : null

  const powerSamples = stream.power.filter((v): v is number => v != null)
  const avgPowerFromStream = powerSamples.length
    ? Math.round(powerSamples.reduce((a, b) => a + b, 0) / powerSamples.length)
    : null
  const hrSamples = stream.hr.filter((v): v is number => v != null && v > 0)
  const cadSamples = stream.cadence.filter((v): v is number => v != null && v > 0)

  let ascent = num(session.total_ascent)
  if (ascent == null) {
    ascent = 0
    let prev: number | null = null
    for (const a of stream.altitude) {
      if (a == null) continue
      if (prev != null && a > prev) ascent += a - prev
      prev = a
    }
    ascent = round(ascent)
  }

  const sport = String(session.sport ?? '').toLowerCase()
  const startDate = new Date(startMs)
  const dateIso = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`

  const kj = streamKj(stream) ?? (num(session.total_work) != null ? round((num(session.total_work) as number) / 1000) : null)

  return {
    summary: {
      date: dateIso,
      name: fallbackName,
      type: SPORT_TO_TYPE[sport] ?? 'endurance',
      duration_min: durationMin,
      distance_km: distanceKm,
      elevation_m: ascent,
      avg_power: num(session.avg_power) ?? avgPowerFromStream,
      normalized_power: num(session.normalized_power) ?? normalizedPower(stream.power),
      max_power: num(session.max_power) ?? (powerSamples.length ? Math.max(...powerSamples) : null),
      avg_hr: num(session.avg_heart_rate) ?? (hrSamples.length ? Math.round(hrSamples.reduce((a, b) => a + b, 0) / hrSamples.length) : null),
      max_hr: num(session.max_heart_rate) ?? (hrSamples.length ? Math.max(...hrSamples) : null),
      avg_cadence: num(session.avg_cadence) ?? (cadSamples.length ? Math.round(cadSamples.reduce((a, b) => a + b, 0) / cadSamples.length) : null),
      kj,
      notes: null,
    },
    stream,
    warnings,
    found,
  }
}
