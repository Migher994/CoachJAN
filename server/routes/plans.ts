import { Router } from 'express'
import { z } from 'zod'
import { db, nowIso } from '../db.js'
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

plansRouter.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM plan ORDER BY created_at DESC, id DESC').all() as PlanRow[]
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

plansRouter.post('/', (req, res) => {
  const d = body(req, planSchema)
  const info = db
    .prepare('INSERT INTO plan (name, focus, weeks, created_at, active) VALUES (?, ?, ?, ?, 0)')
    .run(d.name, d.focus, JSON.stringify(d.weeks), nowIso())
  res.status(201).json(hydrate(db.prepare('SELECT * FROM plan WHERE id = ?').get(info.lastInsertRowid) as PlanRow))
})

plansRouter.put('/:id/activate', (req, res) => {
  const id = intParam(req, 'id')
  const exists = db.prepare('SELECT 1 FROM plan WHERE id = ?').get(id)
  if (!exists) notFound('No plan with that id.')
  db.transaction(() => {
    db.prepare('UPDATE plan SET active = 0').run()
    db.prepare('UPDATE plan SET active = 1 WHERE id = ?').run(id)
  })()
  res.json(hydrate(db.prepare('SELECT * FROM plan WHERE id = ?').get(id) as PlanRow))
})

plansRouter.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM plan WHERE id = ?').run(intParam(req, 'id'))
  if (!info.changes) notFound('No plan with that id.')
  res.status(204).end()
})
