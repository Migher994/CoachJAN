import { Router } from 'express'
import { z } from 'zod'
import { db, nowIso } from '../db.js'
import type { Feedback } from '../../shared/types.js'
import { body, intParam, notFound } from '../lib/http.js'

export const feedbackRouter = Router()

feedbackRouter.get('/', async (req, res) => {
  res.json(await db.all<Feedback>('SELECT * FROM feedback WHERE user_id = ? ORDER BY created_at DESC, id DESC', req.user!.id))
})

feedbackRouter.post('/', async (req, res) => {
  const userId = req.user!.id
  const d = body(
    req,
    z.object({
      scope: z.enum(['activity', 'block']),
      ref: z.string().min(1).max(200),
      text: z.string().min(1).max(40_000),
    }),
  )
  const info = await db.run(
    'INSERT INTO feedback (user_id, scope, ref, text, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
    userId, d.scope, d.ref, d.text, nowIso(),
  )
  res.status(201).json(await db.get<Feedback>('SELECT * FROM feedback WHERE id = ?', info.lastInsertRowid))
})

feedbackRouter.delete('/:id', async (req, res) => {
  const info = await db.run('DELETE FROM feedback WHERE id = ? AND user_id = ?', intParam(req, 'id'), req.user!.id)
  if (!info.changes) return notFound('No saved feedback with that id.')
  res.status(204).end()
})
