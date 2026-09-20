import 'dotenv/config'
import express from 'express'
import { errorHandler } from './lib/http.js'
import { activitiesRouter } from './routes/activities.js'
import { coachRouter } from './routes/coach.js'
import { dashboardRouter } from './routes/dashboard.js'
import { feedbackRouter } from './routes/feedback.js'
import { plansRouter } from './routes/plans.js'
import { profileRouter } from './routes/profile.js'
import { racesRouter } from './routes/races.js'
import './db.js'

const app = express()
app.use(express.json({ limit: '2mb' }))

app.use('/api/profile', profileRouter)
app.use('/api/races', racesRouter)
app.use('/api/activities', activitiesRouter)
app.use('/api/dashboard', dashboardRouter)
app.use('/api/feedback', feedbackRouter)
app.use('/api/plans', plansRouter)
app.use('/api/coach', coachRouter)

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'No such endpoint.' })
})

app.use(errorHandler)

const port = Number(process.env.PORT) || 5174
app.listen(port, () => {
  console.log(`[coachjan] api listening on http://localhost:${port}`)
})
