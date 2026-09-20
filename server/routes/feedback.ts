import { Router } from 'express'
import { z } from 'zod'
import { db, nowIso } from '../db.js'
import type { Feedback } from '../../shared/types.js'
import { body, intParam, notFound } from '../lib/http.js'

export const feedbackRouter = Router()

feedbackRouter.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM feedback ORDER BY created_at DESC, id DESC').all() as Feedback[])
})

feedbackRouter.post('/', (req, res) => {
  const d = body(
    req,
    z.object({
      scope: z.enum(['activity', 'block']),
      ref: z.string().min(1).max(200),
      text: z.string().min(1).max(40_000),
    }),
  )
  const info = db
    .prepare('INSERT INTO feedback (scope, ref, text, created_at) VALUES (?, ?, ?, ?)')
    .run(d.scope, d.ref, d.text, nowIso())
  res.status(201).json(db.prepare('SELECT * FROM feedback WHERE id = ?').get(info.lastInsertRowid))
})

feedbackRouter.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM feedback WHERE id = ?').run(intParam(req, 'id'))
  if (!info.changes) notFound('No saved feedback with that id.')
  res.status(204).end()
})
