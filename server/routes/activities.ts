import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { db, nowIso } from '../db.js'
import type { Activity } from '../../shared/types.js'
import { analyseActivity, decorate, getProfile, listActivities } from '../lib/analysis.js'
import { parseFit } from '../lib/fit.js'
import { badRequest, body, intParam, notFound } from '../lib/http.js'
import { deleteStream, saveStream, type StreamData } from '../lib/streams.js'

export const activitiesRouter = Router()

const UPLOAD_DIR = resolve('./uploads')
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}-${file.originalname.replace(/[^\w.-]/g, '_')}`),
  }),
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

function insertActivity(
  d: z.infer<typeof activityInput>,
  source: Activity['source'],
  fitPath: string | null,
): Activity {
  const info = db
    .prepare(
      `INSERT INTO activity
        (date, name, type, duration_min, distance_km, elevation_m, avg_power, normalized_power,
         max_power, avg_hr, max_hr, avg_cadence, kj, notes, source, raw_fit_path, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      d.date, d.name, d.type, d.duration_min, d.distance_km, d.elevation_m, d.avg_power,
      d.normalized_power, d.max_power, d.avg_hr, d.max_hr, d.avg_cadence, d.kj, d.notes,
      source, fitPath, nowIso(),
    )
  return db.prepare('SELECT * FROM activity WHERE id = ?').get(info.lastInsertRowid) as Activity
}

activitiesRouter.get('/', (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : undefined
  const to = typeof req.query.to === 'string' ? req.query.to : undefined
  const limit = req.query.limit ? Number(req.query.limit) : undefined
  res.json(listActivities({ from, to, limit: Number.isFinite(limit) ? limit : undefined }))
})

activitiesRouter.post('/', (req, res) => {
  const d = body(req, activityInput)
  res.status(201).json(decorate(insertActivity(d, 'manual', null), getProfile().ftp))
})

activitiesRouter.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM activity WHERE id = ?').get(intParam(req, 'id')) as Activity | undefined
  if (!row) notFound('No activity with that id.')
  res.json(decorate(row as Activity, getProfile().ftp))
})

activitiesRouter.get('/:id/analysis', (req, res) => {
  const analysis = analyseActivity(intParam(req, 'id'))
  if (!analysis) notFound('No activity with that id.')
  res.json(analysis)
})

activitiesRouter.put('/:id', (req, res) => {
  const id = intParam(req, 'id')
  const d = body(req, activityInput)
  const info = db
    .prepare(
      `UPDATE activity SET date=?, name=?, type=?, duration_min=?, distance_km=?, elevation_m=?,
         avg_power=?, normalized_power=?, max_power=?, avg_hr=?, max_hr=?, avg_cadence=?, kj=?, notes=?
       WHERE id = ?`,
    )
    .run(
      d.date, d.name, d.type, d.duration_min, d.distance_km, d.elevation_m, d.avg_power,
      d.normalized_power, d.max_power, d.avg_hr, d.max_hr, d.avg_cadence, d.kj, d.notes, id,
    )
  if (!info.changes) notFound('No activity with that id.')
  res.json(decorate(db.prepare('SELECT * FROM activity WHERE id = ?').get(id) as Activity, getProfile().ftp))
})

activitiesRouter.delete('/:id', async (req, res) => {
  const id = intParam(req, 'id')
  const row = db.prepare('SELECT raw_fit_path FROM activity WHERE id = ?').get(id) as { raw_fit_path: string | null } | undefined
  if (!row) notFound('No activity with that id.')
  deleteStream(id)
  db.prepare('DELETE FROM activity WHERE id = ?').run(id)
  if (row?.raw_fit_path) await unlink(row.raw_fit_path).catch(() => {})
  res.status(204).end()
})

/* ------------------------------------------------------------------ */
/* FIT upload: parse, show for confirmation, then commit               */
/* ------------------------------------------------------------------ */

interface Pending {
  summary: z.infer<typeof activityInput>
  stream: StreamData
  path: string
  warnings: string[]
  found: string[]
  at: number
}

const pending = new Map<string, Pending>()
const PENDING_TTL_MS = 30 * 60 * 1000

function sweep(): void {
  const cutoff = Date.now() - PENDING_TTL_MS
  for (const [token, p] of pending) {
    if (p.at < cutoff) {
      pending.delete(token)
      void unlink(p.path).catch(() => {})
    }
  }
}

activitiesRouter.post('/upload', upload.single('file'), async (req, res) => {
  sweep()
  const file = req.file
  if (!file) badRequest('No file was uploaded. Attach a .fit file under the field name "file".')
  const f = file as Express.Multer.File
  if (!/\.fit$/i.test(f.originalname)) {
    await unlink(f.path).catch(() => {})
    badRequest('That is not a .fit file.')
  }

  let parsed
  try {
    const { readFile } = await import('node:fs/promises')
    parsed = await parseFit(await readFile(f.path), f.originalname.replace(/\.fit$/i, ''))
  } catch (error) {
    await unlink(f.path).catch(() => {})
    badRequest(`Could not read that FIT file: ${error instanceof Error ? error.message : String(error)}`)
    return
  }

  const token = randomUUID()
  pending.set(token, {
    summary: parsed.summary,
    stream: parsed.stream,
    path: f.path,
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

activitiesRouter.post('/upload/:token/commit', (req, res) => {
  const token = req.params.token
  const p = pending.get(token)
  if (!p) badRequest('That upload has expired or was already saved. Upload the file again.')
  const d = body(req, activityInput)
  const activity = insertActivity(d, 'fit', (p as Pending).path)
  saveStream(activity.id, (p as Pending).stream)
  pending.delete(token)
  res.status(201).json(decorate(activity, getProfile().ftp))
})

activitiesRouter.delete('/upload/:token', async (req, res) => {
  const p = pending.get(req.params.token)
  if (p) {
    pending.delete(req.params.token)
    await unlink(p.path).catch(() => {})
  }
  res.status(204).end()
})
