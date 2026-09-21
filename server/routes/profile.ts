import { Router } from 'express'
import { z } from 'zod'
import { db, nowIso } from '../db.js'
import { getProfile } from '../lib/analysis.js'
import { body } from '../lib/http.js'

export const profileRouter = Router()

const profileSchema = z.object({
  ftp: z.number().int().positive().max(700).nullable(),
  weight_kg: z.number().positive().max(250).nullable(),
  weekly_hours_target: z.number().positive().max(40).nullable(),
  max_hr: z.number().int().positive().max(260).nullable(),
  notes: z.string().max(4000).nullable(),
})

profileRouter.get('/', async (req, res) => {
  res.json(await getProfile(req.user!.id))
})

profileRouter.put('/', async (req, res) => {
  const userId = req.user!.id
  const data = body(req, profileSchema)
  await getProfile(userId)
  await db.run(
    `UPDATE profile SET ftp = ?, weight_kg = ?, weekly_hours_target = ?, max_hr = ?, notes = ?, updated_at = ?
     WHERE user_id = ?`,
    data.ftp, data.weight_kg, data.weekly_hours_target, data.max_hr, data.notes, nowIso(), userId,
  )
  res.json(await getProfile(userId))
})
