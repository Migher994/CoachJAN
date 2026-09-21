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

export async function saveStream(activityId: number, userId: number, stream: StreamData): Promise<void> {
  const blob = gzipSync(Buffer.from(JSON.stringify(stream), 'utf8'))
  await db.run(
    `INSERT INTO activity_stream (activity_id, user_id, n_points, channels, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(activity_id) DO UPDATE SET
       n_points = excluded.n_points,
       channels = excluded.channels,
       data = excluded.data,
       created_at = excluded.created_at`,
    activityId, userId, stream.second.length, CHANNELS.join(','), blob, nowIso(),
  )
}

export async function loadStream(activityId: number, userId: number): Promise<StreamData | null> {
  const row = await db.get<{ data: Buffer }>(
    'SELECT data FROM activity_stream WHERE activity_id = ? AND user_id = ?',
    activityId, userId,
  )
  if (!row) return null
  return JSON.parse(gunzipSync(row.data).toString('utf8')) as StreamData
}

export async function hasStream(activityId: number, userId: number): Promise<boolean> {
  const row = await db.get<{ present: number }>(
    'SELECT 1 AS present FROM activity_stream WHERE activity_id = ? AND user_id = ?',
    activityId, userId,
  )
  return Boolean(row)
}

export async function activityIdsWithStreams(userId: number): Promise<number[]> {
  const rows = await db.all<{ activity_id: number }>(
    'SELECT activity_id FROM activity_stream WHERE user_id = ? ORDER BY activity_id',
    userId,
  )
  return rows.map((r) => r.activity_id)
}

export async function deleteStream(activityId: number, userId: number): Promise<void> {
  await db.run('DELETE FROM activity_stream WHERE activity_id = ? AND user_id = ?', activityId, userId)
}
