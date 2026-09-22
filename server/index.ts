import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import 'dotenv/config'
import cookieParser from 'cookie-parser'
import express from 'express'
import { migrate } from './db.js'
import { attachUser, requireAuth } from './lib/auth.js'
import { errorHandler } from './lib/http.js'
import { activitiesRouter } from './routes/activities.js'
import { authRouter } from './routes/auth.js'
import { coachRouter } from './routes/coach.js'
import { dashboardRouter } from './routes/dashboard.js'
import { feedbackRouter } from './routes/feedback.js'
import { plansRouter } from './routes/plans.js'
import { profileRouter } from './routes/profile.js'
import { racesRouter } from './routes/races.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = express()
app.use(express.json({ limit: '2mb' }))
app.use(cookieParser())
app.use(attachUser)

app.use('/api/auth', authRouter)
app.use('/api/profile', requireAuth, profileRouter)
app.use('/api/races', requireAuth, racesRouter)
app.use('/api/activities', requireAuth, activitiesRouter)
app.use('/api/dashboard', requireAuth, dashboardRouter)
app.use('/api/feedback', requireAuth, feedbackRouter)
app.use('/api/plans', requireAuth, plansRouter)
app.use('/api/coach', requireAuth, coachRouter)

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'No such endpoint.' })
})

if (process.env.NODE_ENV === 'production') {
  const distDir = resolve(__dirname, '../dist')
  app.use(express.static(distDir))
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(resolve(distDir, 'index.html'))
  })
}

app.use(errorHandler)

async function main(): Promise<void> {
  const port = Number(process.env.PORT) || 5174
  // Bind before running migrations, so Cloud Run's health check sees the port
  // open immediately - a slow database shows up as a clear error in the logs
  // afterward instead of a startup-timeout with no explanation.
  app.listen(port, '0.0.0.0', () => {
    console.log(`[coachjan] api listening on http://0.0.0.0:${port}`)
  })
  try {
    await migrate()
    console.log('[coachjan] database migration complete')
  } catch (error) {
    // Do not exit here: the process already has the port open and Cloud Run is
    // routing traffic to it. Exiting now would crash-loop the whole container
    // (killing even static asset requests) every time the database is briefly
    // unreachable, instead of surfacing one clear, retryable error.
    console.error('[coachjan] database migration failed - requests that touch the database will fail until this is fixed:', error)
  }
}

main().catch((error) => {
  console.error('[coachjan] failed to start:', error)
  process.exit(1)
})
