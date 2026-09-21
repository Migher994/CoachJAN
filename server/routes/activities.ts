import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { db, nowIso } from '../db.js'
import type { Activity } from '../../shared/types.js'
import { analyseActivity, decorate, getProfile, listActivities } from '../lib/analysis.js'
import { parseFit } from '../lib/fit.js'
import { badRequest, body, intParam, notFound } from '../lib/http.js'
import { deleteUpload, saveUpload } from '../lib/storage.js'
import { deleteStream, saveStream, type StreamData } from '../lib/streams.js'

export const activitiesRouter = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
})

export const activityInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  name: z.string().min(1).max(200),
  type: z.enum(['race', 'interval', 'endurance', 'recovery', 'commute', 'other']),
  duration_min: z.number().positive().max(24 * 60),
  distance_km: z.number().min(0).max(1000).nullable().default(null),
  elevation_m: z.number().min(0).max(20000).nullable().default(null),
  avg_power: z.number().int().min(0).max(2000).nullable().default(null),
  normalized_power: z.number().int().min(0).max(2000).nullable().default(null),
  max_power: z.number().int().min(0).max(3000).nullable().default(null),
  avg_hr: z.number().int().min(0).max(260).nullable().default(null),
  max_hr: z.number().int().min(0).max(260).nullable().default(null),
  avg_cadence: z.number().int().min(0).max(200).nullable().default(null),
  kj: z.number().min(0).max(20000).nullable().default(null),
  notes: z.string().max(8000).nullable().default(null),
})

async function insertActivity(
  d: z.infer<typeof activityInput>,
  userId: number,
  source: Activity['source'],
  fitPath: string | null,
): Promise<Activity> {
  const info = await db.run(
    `INSERT INTO activity
      (user_id, date, name, type, duration_min, distance_km, elevation_m, avg_power, normalized_power,
       max_power, avg_hr, max_hr, avg_cadence, kj, notes, source, raw_fit_path, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     RETURNING id`,
    userId, d.date, d.name, d.type, d.duration_min, d.distance_km, d.elevation_m, d.avg_power,
    d.normalized_power, d.max_power, d.avg_hr, d.max_hr, d.avg_cadence, d.kj, d.notes,
    source, fitPath, nowIso(),
  )
  return (await db.get<Activity>('SELECT * FROM activity WHERE id = ?', info.lastInsertRowid)) as Activity
}

activitiesRouter.get('/', async (req, res) => {
  const userId = req.user!.id
  const from = typeof req.query.from === 'string' ? req.query.from : undefined
  const to = typeof req.query.to === 'string' ? req.query.to : undefined
  const limit = req.query.limit ? Number(req.query.limit) : undefined
  res.json(await listActivities(userId, { from, to, limit: Number.isFinite(limit) ? limit : undefined }))
})

activitiesRouter.post('/', async (req, res) => {
  const userId = req.user!.id
  const d = body(req, activityInput)
  const activity = await insertActivity(d, userId, 'manual', null)
  res.status(201).json(await decorate(activity, (await getProfile(userId)).ftp, userId))
})

activitiesRouter.get('/:id', async (req, res) => {
  const userId = req.user!.id
  const row = await db.get<Activity>('SELECT * FROM activity WHERE id = ? AND user_id = ?', intParam(req, 'id'), userId)
  if (!row) return notFound('No activity with that id.')
  res.json(await decorate(row, (await getProfile(userId)).ftp, userId))
})

activitiesRouter.get('/:id/analysis', async (req, res) => {
  const analysis = await analyseActivity(intParam(req, 'id'), req.user!.id)
  if (!analysis) return notFound('No activity with that id.')
  res.json(analysis)
})

activitiesRouter.put('/:id', async (req, res) => {
  const userId = req.user!.id
  const id = intParam(req, 'id')
  const d = body(req, activityInput)
  const info = await db.run(
    `UPDATE activity SET date=?, name=?, type=?, duration_min=?, distance_km=?, elevation_m=?,
       avg_power=?, normalized_power=?, max_power=?, avg_hr=?, max_hr=?, avg_cadence=?, kj=?, notes=?
     WHERE id = ? AND user_id = ?`,
    d.date, d.name, d.type, d.duration_min, d.distance_km, d.elevation_m, d.avg_power,
    d.normalized_power, d.max_power, d.avg_hr, d.max_hr, d.avg_cadence, d.kj, d.notes, id, userId,
  )
  if (!info.changes) return notFound('No activity with that id.')
  const row = (await db.get<Activity>('SELECT * FROM activity WHERE id = ?', id)) as Activity
  res.json(await decorate(row, (await getProfile(userId)).ftp, userId))
})

activitiesRouter.delete('/:id', async (req, res) => {
  const userId = req.user!.id
  const id = intParam(req, 'id')
  const row = await db.get<{ raw_fit_path: string | null }>(
    'SELECT raw_fit_path FROM activity WHERE id = ? AND user_id = ?', id, userId,
  )
  if (!row) return notFound('No activity with that id.')
  await deleteStream(id, userId)
  await db.run('DELETE FROM activity WHERE id = ? AND user_id = ?', id, userId)
  if (row.raw_fit_path) await deleteUpload(row.raw_fit_path)
  res.status(204).end()
})

/* ------------------------------------------------------------------ */
/* FIT upload: parse, show for confirmation, then commit               */
/* ------------------------------------------------------------------ */

interface Pending {
  userId: number
  summary: z.infer<typeof activityInput>
  stream: StreamData
  buffer: Buffer
  warnings: string[]
  found: string[]
  at: number
}

const pending = new Map<string, Pending>()
const PENDING_TTL_MS = 30 * 60 * 1000

function sweep(): void {
  const cutoff = Date.now() - PENDING_TTL_MS
  for (const [token, p] of pending) {
    if (p.at < cutoff) pending.delete(token)
  }
}

activitiesRouter.post('/upload', upload.single('file'), async (req, res) => {
  sweep()
  const file = req.file
  if (!file) return badRequest('No file was uploaded. Attach a .fit file under the field name "file".')
  if (!/\.fit$/i.test(file.originalname)) return badRequest('That is not a .fit file.')

  let parsed
  try {
    parsed = await parseFit(file.buffer, file.originalname.replace(/\.fit$/i, ''))
  } catch (error) {
    return badRequest(`Could not read that FIT file: ${error instanceof Error ? error.message : String(error)}`)
  }

  const token = randomUUID()
  pending.set(token, {
    userId: req.user!.id,
    summary: parsed.summary,
    stream: parsed.stream,
    buffer: file.buffer,
    warnings: parsed.warnings,
    found: parsed.found,
    at: Date.now(),
  })

  res.json({
    token,
    summary: parsed.summary,
    warnings: parsed.warnings,
    found: parsed.found,
    sample_count: parsed.stream.second.length,
    moving_seconds: parsed.stream.moving.filter(Boolean).length,
  })
})

activitiesRouter.post('/upload/:token/commit', async (req, res) => {
  const userId = req.user!.id
  const token = req.params.token
  const p = pending.get(token)
  if (!p || p.userId !== userId) return badRequest('That upload has expired or was already saved. Upload the file again.')
  const d = body(req, activityInput)
  const objectPath = `${userId}/${randomUUID()}.fit`
  await saveUpload(objectPath, p.buffer)
  const activity = await insertActivity(d, userId, 'fit', objectPath)
  await saveStream(activity.id, userId, p.stream)
  pending.delete(token)
  res.status(201).json(await decorate(activity, (await getProfile(userId)).ftp, userId))
})

activitiesRouter.delete('/upload/:token', (req, res) => {
  const p = pending.get(req.params.token)
  if (p && p.userId === req.user!.id) pending.delete(req.params.token)
  res.status(204).end()
})
