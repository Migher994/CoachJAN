import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db.js'
import type { ActivityRow, Feedback, Race } from '../../shared/types.js'
import {
  analyseActivity,
  analyseBlock,
  daysAgo,
  getProfile,
  isoDay,
  listActivities,
} from '../lib/analysis.js'
import { CoachUnavailable, coachConfigured, coachModel, describeError, parseJson, streamText } from '../lib/claude.js'
import { weeklyLoads } from '../lib/metrics.js'
import { badRequest, body } from '../lib/http.js'
import {
  ASK_SYSTEM,
  FEEDBACK_SYSTEM,
  PARSE_SYSTEM,
  PLAN_SYSTEM,
  renderActivityList,
  renderActivityReport,
  renderBlockReport,
  renderProfile,
  renderRaces,
  renderWeekly,
} from '../lib/prompts.js'

export const coachRouter = Router()

const today = (): string => isoDay(new Date())

coachRouter.get('/status', (_req, res) => {
  res.json({ configured: coachConfigured(), model: coachModel })
})

/* ------------------------------------------------------------------ */
/* Streaming helper: newline-delimited JSON so fetch can read it        */
/* ------------------------------------------------------------------ */

type Line =
  | { type: 'meta'; scope: string; ref: string; label: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string }

function openStream(res: import('express').Response): (line: Line) => void {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  return (line: Line) => {
    res.write(`${JSON.stringify(line)}\n`)
  }
}

/* ------------------------------------------------------------------ */
/* Feedback                                                             */
/* ------------------------------------------------------------------ */

const feedbackRequest = z.object({
  scope: z.enum(['latest', 'activity', 'last7', 'last14']),
  activity_id: z.number().int().positive().optional(),
})

interface FeedbackContext {
  scope: 'activity' | 'block'
  ref: string
  label: string
  report: string
}

function buildFeedbackContext(input: z.infer<typeof feedbackRequest>): FeedbackContext {
  const now = today()
  if (input.scope === 'latest' || input.scope === 'activity') {
    let id = input.activity_id
    if (input.scope === 'latest') {
      const latest = listActivities({ limit: 1 })[0]
      if (!latest) badRequest('No activities logged yet, so there is nothing to review. Add a ride first.')
      id = (latest as ActivityRow).id
    }
    if (!id) badRequest('Pick an activity to review.')
    const analysis = analyseActivity(id as number)
    if (!analysis) badRequest('No activity with that id.')
    const a = analysis!
    return {
      scope: 'activity',
      ref: String(id),
      label: `${a.activity.name} - ${a.activity.date}`,
      report: renderActivityReport(a),
    }
  }

  const days = input.scope === 'last7' ? 7 : 14
  const from = daysAgo(days - 1, now)
  const block = analyseBlock(from, now)
  if (!block.ride_count) {
    badRequest(`Nothing logged in the last ${days} days, so there is nothing to review.`)
  }
  return {
    scope: 'block',
    ref: `${from}..${now}`,
    label: `Last ${days} days (${from} to ${now})`,
    report: renderBlockReport(block),
  }
}

coachRouter.post('/feedback', async (req, res) => {
  const input = body(req, feedbackRequest)
  const profile = getProfile()
  const ctx = buildFeedbackContext(input)

  const user = [
    "Rider's profile:",
    renderProfile(profile),
    '',
    `Today is ${today()}.`,
    'Upcoming races:',
    renderRaces(db.prepare('SELECT * FROM race WHERE date >= ? ORDER BY date LIMIT 5').all(today()) as Race[], today()),
    '',
    ctx.scope === 'activity'
      ? 'Review this ride.'
      : 'Review this training window as a whole, then the individual sessions where they matter.',
    '',
    ctx.report,
  ].join('\n')

  const send = openStream(res)
  send({ type: 'meta', scope: ctx.scope, ref: ctx.ref, label: ctx.label })
  try {
    const text = await streamText({
      system: FEEDBACK_SYSTEM,
      user,
      onDelta: (delta) => send({ type: 'delta', text: delta }),
    })
    send({ type: 'done', text })
  } catch (error) {
    send({ type: 'error', message: describeError(error) })
  }
  res.end()
})

/* ------------------------------------------------------------------ */
/* Planning                                                             */
/* ------------------------------------------------------------------ */

const planSchema = z.object({
  name: z.string().describe('Short descriptive name for this block'),
  focus: z.string().describe('One sentence stating what this block is for'),
  weeks: z.array(
    z.object({
      week: z.number().int().describe('Week number within the block, starting at 1'),
      theme: z.string().describe('A few words on what this week does'),
      target_hours: z.number().describe('Total planned riding hours for the week'),
      sessions: z.array(
        z.object({
          day: z.string().describe('Day of the week, e.g. Monday'),
          type: z.string().describe('endurance, tempo, threshold, VO2, sprints, recovery, race or rest'),
          duration_min: z.number().describe('Session duration in minutes; 0 for a rest day'),
          intensity: z.string().describe('Where the effort sits, e.g. Z2, 88-93% FTP, race pace, easy'),
          description: z.string().describe('One concrete line: the actual interval structure'),
        }),
      ),
    }),
  ),
})

function planContext(): string {
  const now = today()
  const profile = getProfile()
  const recent = listActivities({ limit: 10 })
  const lastFeedback = db
    .prepare('SELECT * FROM feedback ORDER BY created_at DESC, id DESC LIMIT 1')
    .get() as Feedback | undefined
  const weekly = weeklyLoads(listActivities({ from: daysAgo(27, now) }), 4, now)
  const races = db.prepare('SELECT * FROM race WHERE date >= ? ORDER BY date LIMIT 8').all(now) as Race[]

  return [
    `Today is ${now}.`,
    '',
    "Rider's profile:",
    renderProfile(profile),
    '',
    'Races on the calendar:',
    renderRaces(races, now),
    '',
    'Load over the last four weeks:',
    renderWeekly(weekly),
    '',
    'Last 10 activities, newest first:',
    renderActivityList(recent),
    '',
    lastFeedback
      ? `Most recent saved feedback (${lastFeedback.created_at.slice(0, 10)}, scope ${lastFeedback.scope}):\n${lastFeedback.text}`
      : 'No saved feedback yet.',
  ].join('\n')
}

coachRouter.post('/plan', async (_req, res) => {
  try {
    const plan = await parseJson({
      schema: planSchema,
      system: PLAN_SYSTEM,
      user: `${planContext()}\n\nProduce the next block of three or four weeks.`,
    })
    const problems: string[] = []
    if (plan.weeks.length < 3 || plan.weeks.length > 4) {
      problems.push(`The model returned ${plan.weeks.length} weeks rather than three or four.`)
    }
    const target = getProfile().weekly_hours_target
    if (target) {
      for (const w of plan.weeks) {
        const planned = w.sessions.reduce((sum, s) => sum + (s.duration_min || 0), 0) / 60
        if (planned > target + 0.25) {
          problems.push(`Week ${w.week} plans ${planned.toFixed(1)} h against a ${target} h target.`)
        }
      }
    }
    for (const w of plan.weeks) {
      if (!w.sessions.some((s) => s.type.toLowerCase().includes('rest') || s.duration_min === 0)) {
        problems.push(`Week ${w.week} has no full rest day.`)
      }
    }
    res.json({ plan, problems })
  } catch (error) {
    const status = error instanceof CoachUnavailable ? 503 : 502
    res.status(status).json({ error: describeError(error) })
  }
})

coachRouter.post('/ask', async (req, res) => {
  const { question } = body(req, z.object({ question: z.string().min(3).max(2000) }))
  const send = openStream(res)
  try {
    const text = await streamText({
      system: ASK_SYSTEM,
      user: `${planContext()}\n\nThe rider asks: ${question}`,
      onDelta: (delta) => send({ type: 'delta', text: delta }),
    })
    send({ type: 'done', text })
  } catch (error) {
    send({ type: 'error', message: describeError(error) })
  }
  res.end()
})

/* ------------------------------------------------------------------ */
/* Paste and parse                                                      */
/* ------------------------------------------------------------------ */

const pastedSchema = z.object({
  date: z.string().nullable().describe('YYYY-MM-DD'),
  name: z.string(),
  type: z.enum(['race', 'interval', 'endurance', 'recovery', 'commute', 'other']),
  duration_min: z.number().nullable(),
  distance_km: z.number().nullable(),
  elevation_m: z.number().nullable(),
  avg_power: z.number().nullable(),
  normalized_power: z.number().nullable(),
  max_power: z.number().nullable(),
  avg_hr: z.number().nullable(),
  max_hr: z.number().nullable(),
  avg_cadence: z.number().nullable(),
  kj: z.number().nullable(),
  notes: z.string().nullable(),
  confidence: z.enum(['low', 'medium', 'high']),
  parse_notes: z.string().describe('What you were unsure about, one or two sentences'),
})

coachRouter.post('/parse-activity', async (req, res) => {
  const { text } = body(req, z.object({ text: z.string().min(5).max(20_000) }))
  try {
    const parsed = await parseJson({
      schema: pastedSchema,
      system: PARSE_SYSTEM,
      effort: 'low',
      user: `Today is ${today()}.\n\nPasted text:\n"""\n${text}\n"""`,
    })
    res.json(parsed)
  } catch (error) {
    const status = error instanceof CoachUnavailable ? 503 : 502
    res.status(status).json({ error: describeError(error) })
  }
})
