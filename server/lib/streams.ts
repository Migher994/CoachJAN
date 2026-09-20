import { gunzipSync, gzipSync } from 'node:zlib'
import { db, nowIso } from '../db.js'

/**
 * A ride resampled to a dense 1 Hz grid. Every array has the same length;
 * `moving[i]` is false where the grid was filled across a recording gap or a
 * stop, so the analysis can exclude stopped time without guessing.
 */
export interface StreamData {
  second: number[]
  power: (number | null)[]
  hr: (number | null)[]
  cadence: (number | null)[]
  /** metres per second */
  speed: (number | null)[]
  /** metres */
  altitude: (number | null)[]
  /** cumulative metres */
  distance: (number | null)[]
  /** percent, derived from altitude and distance when the file does not carry it */
  grade: (number | null)[]
  moving: boolean[]
}

const CHANNELS: (keyof StreamData)[] = [
  'second', 'power', 'hr', 'cadence', 'speed', 'altitude', 'distance', 'grade', 'moving',
]

export function saveStream(activityId: number, stream: StreamData): void {
  const blob = gzipSync(Buffer.from(JSON.stringify(stream), 'utf8'))
  db.prepare(
    `INSERT INTO activity_stream (activity_id, n_points, channels, data, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(activity_id) DO UPDATE SET
       n_points = excluded.n_points,
       channels = excluded.channels,
       data = excluded.data,
       created_at = excluded.created_at`,
  ).run(activityId, stream.second.length, CHANNELS.join(','), blob, nowIso())
}

export function loadStream(activityId: number): StreamData | null {
  const row = db
    .prepare('SELECT data FROM activity_stream WHERE activity_id = ?')
    .get(activityId) as { data: Buffer } | undefined
  if (!row) return null
  return JSON.parse(gunzipSync(row.data).toString('utf8')) as StreamData
}

export function hasStream(activityId: number): boolean {
  const row = db
    .prepare('SELECT 1 AS present FROM activity_stream WHERE activity_id = ?')
    .get(activityId) as { present: number } | undefined
  return Boolean(row)
}

export function activityIdsWithStreams(): number[] {
  const rows = db
    .prepare('SELECT activity_id FROM activity_stream ORDER BY activity_id')
    .all() as { activity_id: number }[]
  return rows.map((r) => r.activity_id)
}

export function deleteStream(activityId: number): void {
  db.prepare('DELETE FROM activity_stream WHERE activity_id = ?').run(activityId)
}
