import type { NextFunction, Request, Response } from 'express'
import type { ZodType } from 'zod'

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

export const badRequest = (message: string): never => {
  throw new HttpError(400, message)
}

export const notFound = (message: string): never => {
  throw new HttpError(404, message)
}

/** Parses a body against a schema and turns failures into a readable message. */
export function body<T extends ZodType>(req: Request, schema: T): ReturnType<T['parse']> {
  const result = schema.safeParse(req.body)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
      .join('; ')
    throw new HttpError(400, `Invalid request: ${issues}`)
  }
  return result.data as ReturnType<T['parse']>
}

export function intParam(req: Request, name: string): number {
  const value = Number(req.params[name])
  if (!Number.isInteger(value) || value <= 0) throw new HttpError(400, `Invalid ${name}.`)
  return value
}

export function errorHandler(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error)
    return
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  console.error('[api]', error)
  res.status(500).json({ error: message })
}
