import { Router } from 'express'
import { z } from 'zod'
import { db, nowIso } from '../db.js'
import type { Race } from '../../shared/types.js'
import { body, intParam, notFound } from '../lib/http.js'

export const racesRouter = Router()

const raceSchema = z.object({
  name: z.string().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  priority: z.enum(['A', 'B', 'C']),
  course_notes: z.string().max(4000).nullable(),
  result_notes: z.string().max(4000).nullable(),
})

racesRouter.get('/', async (req, res) => {
  res.json(await db.all<Race>('SELECT * FROM race WHERE user_id = ? ORDER BY date', req.user!.id))
})

racesRouter.post('/', async (req, res) => {
  const userId = req.user!.id
  const d = body(req, raceSchema)
  const info = await db.run(
    `INSERT INTO race (user_id, name, date, priority, course_notes, result_notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    userId, d.name, d.date, d.priority, d.course_notes, d.result_notes, nowIso(),
  )
  res.status(201).json(await db.get<Race>('SELECT * FROM race WHERE id = ?', info.lastInsertRowid))
})

racesRouter.put('/:id', async (req, res) => {
  const userId = req.user!.id
  const id = intParam(req, 'id')
  const d = body(req, raceSchema)
  const info = await db.run(
    'UPDATE race SET name = ?, date = ?, priority = ?, course_notes = ?, result_notes = ? WHERE id = ? AND user_id = ?',
    d.name, d.date, d.priority, d.course_notes, d.result_notes, id, userId,
  )
  if (!info.changes) return notFound('No race with that id.')
  res.json(await db.get<Race>('SELECT * FROM race WHERE id = ?', id))
})

racesRouter.delete('/:id', async (req, res) => {
  const userId = req.user!.id
  const id = intParam(req, 'id')
  const info = await db.run('DELETE FROM race WHERE id = ? AND user_id = ?', id, userId)
  if (!info.changes) return notFound('No race with that id.')
  res.status(204).end()
})
