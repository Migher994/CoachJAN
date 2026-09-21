import { Router } from 'express'
import { db } from '../db.js'
import type { DashboardSummary, Race } from '../../shared/types.js'
import { daysAgo, getProfile, isoDay, listActivities, powerCurve } from '../lib/analysis.js'
import { pmcSeries, round, weeklyLoads } from '../lib/metrics.js'

export const dashboardRouter = Router()

const today = (): string => isoDay(new Date())

const daysBetween = (from: string, to: string): number =>
  Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000)

dashboardRouter.get('/', async (req, res) => {
  const userId = req.user!.id
  const now = today()
  const profile = await getProfile(userId)
  const all = await listActivities(userId)
  const upcoming = (await db.all<Race>('SELECT * FROM race WHERE user_id = ? AND date >= ? ORDER BY date', userId, now)).map(
    (r) => ({ ...r, days_away: daysBetween(now, r.date) }),
  )

  const pmc = pmcSeries(all.map((a) => ({ date: a.date, tss: a.tss })), now)
  const last = pmc.at(-1) ?? null

  const fourWeeks = weeklyLoads(all, 4, now)
  const weeksWithRiding = fourWeeks.filter((w) => w.activities > 0)
  const avgWeeklyTss = weeksWithRiding.length
    ? round(fourWeeks.reduce((sum, w) => sum + w.tss, 0) / 4)
    : null

  const summary: DashboardSummary = {
    next_race: upcoming[0] ?? null,
    upcoming_races: upcoming.slice(0, 6),
    activity_count: all.length,
    avg_weekly_tss_4w: avgWeeklyTss,
    fitness: last?.fitness ?? null,
    fatigue: last?.fatigue ?? null,
    form: last?.form ?? null,
    activities_missing_power: all.filter((a) => a.tss == null).length,
    ftp: profile.ftp,
    weekly_hours_target: profile.weekly_hours_target,
  }
  res.json(summary)
})

dashboardRouter.get('/pmc', async (req, res) => {
  const days = Number(req.query.days) || 180
  const all = await listActivities(req.user!.id)
  const series = pmcSeries(all.map((a) => ({ date: a.date, tss: a.tss })), today())
  res.json(series.slice(Math.max(0, series.length - days)))
})

dashboardRouter.get('/weekly', async (req, res) => {
  const weeks = Math.min(52, Math.max(4, Number(req.query.weeks) || 12))
  res.json(weeklyLoads(await listActivities(req.user!.id), weeks, today()))
})

dashboardRouter.get('/power-trend', async (req, res) => {
  const limit = Math.min(120, Math.max(5, Number(req.query.limit) || 30))
  const rows = (await listActivities(req.user!.id, { limit }))
    .filter((a) => a.avg_power != null || a.normalized_power != null)
    .reverse()
    .map((a) => ({
      id: a.id,
      date: a.date,
      name: a.name,
      type: a.type,
      avg_power: a.avg_power,
      normalized_power: a.normalized_power,
    }))
  res.json(rows)
})

dashboardRouter.get('/power-curve', async (req, res) => {
  const userId = req.user!.id
  const now = today()
  res.json({
    current: await powerCurve('Last 90 days', daysAgo(89, now), now, userId),
    previous: await powerCurve('Previous 90 days', daysAgo(179, now), daysAgo(90, now), userId),
  })
})
