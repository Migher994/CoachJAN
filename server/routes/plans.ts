import { Router } from 'express'
import { z } from 'zod'
import { db, nowIso, withTransaction } from '../db.js'
import type { Plan, PlanWeek } from '../../shared/types.js'
import { body, intParam, notFound } from '../lib/http.js'

export const plansRouter = Router()

interface PlanRow extends Omit<Plan, 'weeks' | 'active'> {
  weeks: string
  active: number
}

const hydrate = (row: PlanRow): Plan => ({
  ...row,
  weeks: JSON.parse(row.weeks) as PlanWeek[],
  active: Boolean(row.active),
})

plansRouter.get('/', async (req, res) => {
  const rows = await db.all<PlanRow>('SELECT * FROM plan WHERE user_id = ? ORDER BY created_at DESC, id DESC', req.user!.id)
  res.json(rows.map(hydrate))
})

const planSchema = z.object({
  name: z.string().min(1).max(200),
  focus: z.string().min(1).max(1000),
  weeks: z.array(
    z.object({
      week: z.number().int(),
      theme: z.string(),
      target_hours: z.number(),
      sessions: z.array(
        z.object({
          day: z.string(),
          type: z.string(),
          duration_min: z.number(),
          intensity: z.string(),
          description: z.string(),
        }),
      ),
    }),
  ),
})

plansRouter.post('/', async (req, res) => {
  const userId = req.user!.id
  const d = body(req, planSchema)
  const info = await db.run(
    'INSERT INTO plan (user_id, name, focus, weeks, created_at, active) VALUES (?, ?, ?, ?, ?, 0) RETURNING id',
    userId, d.name, d.focus, JSON.stringify(d.weeks), nowIso(),
  )
  res.status(201).json(hydrate((await db.get<PlanRow>('SELECT * FROM plan WHERE id = ?', info.lastInsertRowid)) as PlanRow))
})

plansRouter.put('/:id/activate', async (req, res) => {
  const userId = req.user!.id
  const id = intParam(req, 'id')
  const exists = await db.get('SELECT 1 FROM plan WHERE id = ? AND user_id = ?', id, userId)
  if (!exists) return notFound('No plan with that id.')
  await withTransaction(async (trx) => {
    await trx.run('UPDATE plan SET active = 0 WHERE user_id = ?', userId)
    await trx.run('UPDATE plan SET active = 1 WHERE id = ? AND user_id = ?', id, userId)
  })
  res.json(hydrate((await db.get<PlanRow>('SELECT * FROM plan WHERE id = ?', id)) as PlanRow))
})

plansRouter.delete('/:id', async (req, res) => {
  const info = await db.run('DELETE FROM plan WHERE id = ? AND user_id = ?', intParam(req, 'id'), req.user!.id)
  if (!info.changes) return notFound('No plan with that id.')
  res.status(204).end()
})
