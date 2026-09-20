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

racesRouter.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM race ORDER BY date').all() as Race[])
})

racesRouter.post('/', (req, res) => {
  const d = body(req, raceSchema)
  const info = db
    .prepare(
      `INSERT INTO race (name, date, priority, course_notes, result_notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(d.name, d.date, d.priority, d.course_notes, d.result_notes, nowIso())
  res.status(201).json(db.prepare('SELECT * FROM race WHERE id = ?').get(info.lastInsertRowid))
})

racesRouter.put('/:id', (req, res) => {
  const id = intParam(req, 'id')
  const d = body(req, raceSchema)
  const info = db
    .prepare(
      'UPDATE race SET name = ?, date = ?, priority = ?, course_notes = ?, result_notes = ? WHERE id = ?',
    )
    .run(d.name, d.date, d.priority, d.course_notes, d.result_notes, id)
  if (!info.changes) notFound('No race with that id.')
  res.json(db.prepare('SELECT * FROM race WHERE id = ?').get(id))
})

racesRouter.delete('/:id', (req, res) => {
  const id = intParam(req, 'id')
  const info = db.prepare('DELETE FROM race WHERE id = ?').run(id)
  if (!info.changes) notFound('No race with that id.')
  res.status(204).end()
})
