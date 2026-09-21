import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db.js'
import type { User } from '../../shared/types.js'
import { clearSessionCookie, requireAuth, setSessionCookie, verifyPassword } from '../lib/auth.js'
import { badRequest, body } from '../lib/http.js'

export const authRouter = Router()

interface UserRow extends User {
  password_hash: string
}

authRouter.post('/login', async (req, res) => {
  const { email, password } = body(
    req,
    z.object({ email: z.string().email(), password: z.string().min(1) }),
  )
  const user = await db.get<UserRow>('SELECT * FROM users WHERE email = ?', email.toLowerCase())
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    badRequest('Incorrect email or password.')
    return
  }
  setSessionCookie(res, user.id)
  res.json({ id: user.id, email: user.email, name: user.name, created_at: user.created_at } satisfies User)
})

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res)
  res.status(204).end()
})

authRouter.get('/me', requireAuth, (req, res) => {
  res.json(req.user)
})
