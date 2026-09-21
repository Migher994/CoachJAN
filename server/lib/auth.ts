import bcrypt from 'bcryptjs'
import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { db } from '../db.js'
import type { User } from '../../shared/types.js'
import { HttpError } from './http.js'

const COOKIE_NAME = 'coachjan_session'
const SESSION_DAYS = 30

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not set. Add it to .env.')
  return secret
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

function signSession(userId: number): string {
  return jwt.sign({ sub: String(userId) }, jwtSecret(), { expiresIn: `${SESSION_DAYS}d` })
}

export function setSessionCookie(res: Response, userId: number): void {
  res.cookie(COOKIE_NAME, signSession(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  })
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME)
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User
    }
  }
}

/** Reads the session cookie and sets `req.user` when it is valid. Never rejects the request. */
export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined
  if (!token) {
    next()
    return
  }
  try {
    const payload = jwt.verify(token, jwtSecret())
    const userId = typeof payload === 'object' ? Number(payload.sub) : NaN
    if (Number.isInteger(userId)) {
      const user = await db.get<User>('SELECT id, email, name, created_at FROM users WHERE id = ?', userId)
      if (user) req.user = user
    }
  } catch {
    // Invalid or expired token: proceed unauthenticated rather than rejecting.
  }
  next()
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new HttpError(401, 'Sign in to continue.'))
    return
  }
  next()
}
