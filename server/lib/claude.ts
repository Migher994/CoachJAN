/**
 * Every call to Claude goes through this module, which runs server side only.
 * The API key is read from the environment and never reaches the client.
 */
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { z } from 'zod'

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5'

let client: Anthropic | null = null

export class CoachUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CoachUnavailable'
  }
}

export function coachConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

function getClient(): Anthropic {
  if (!coachConfigured()) {
    throw new CoachUnavailable(
      'ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key, then restart the API.',
    )
  }
  client ??= new Anthropic()
  return client
}

/** Turns SDK errors into a sentence worth showing in the UI. */
export function describeError(error: unknown): string {
  if (error instanceof CoachUnavailable) return error.message
  if (error instanceof Anthropic.AuthenticationError) {
    return 'The Anthropic API rejected the key. Check ANTHROPIC_API_KEY in .env.'
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Rate limited by the Anthropic API. Wait a moment and try again.'
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `The request was rejected: ${error.message}`
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'Could not reach the Anthropic API. Check the network connection.'
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic API error ${error.status ?? ''}: ${error.message}`.trim()
  }
  return error instanceof Error ? error.message : String(error)
}

export interface StreamOptions {
  system: string
  user: string
  maxTokens?: number
  onDelta: (text: string) => void
}

/** Streams a prose answer, calling `onDelta` as text arrives. Returns the full text. */
export async function streamText({ system, user, maxTokens = 32_000, onDelta }: StreamOptions): Promise<string> {
  const stream = getClient().messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  })

  let full = ''
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      full += event.delta.text
      onDelta(event.delta.text)
    }
  }

  const final = await stream.finalMessage()
  if (final.stop_reason === 'refusal') {
    throw new CoachUnavailable('The model declined to answer this request.')
  }
  if (final.stop_reason === 'max_tokens') {
    full += '\n\n[Response was cut off at the token limit.]'
  }
  return full
}

/**
 * Structured output with one retry. The SDK's parse helper validates against
 * the schema; if the response still does not fit, the second attempt says so
 * explicitly rather than silently returning a half-filled object.
 */
export async function parseJson<T extends z.ZodType>(opts: {
  schema: T
  system: string
  user: string
  effort?: 'low' | 'medium' | 'high'
  maxTokens?: number
}): Promise<z.infer<T>> {
  const { schema, system, user, effort = 'high', maxTokens = 16_000 } = opts
  const attempt = async (extra: string): Promise<z.infer<T> | null> => {
    const response = await getClient().messages.parse({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: extra ? `${user}\n\n${extra}` : user }],
      output_config: {
        effort,
        format: zodOutputFormat(schema),
      },
    })
    if (response.stop_reason === 'refusal') {
      throw new CoachUnavailable('The model declined to answer this request.')
    }
    return (response.parsed_output as z.infer<T> | null) ?? null
  }

  const first = await attempt('')
  if (first) return first

  const second = await attempt(
    'Your previous response did not match the required schema. Return only data that fits the schema exactly, with no commentary.',
  )
  if (second) return second

  throw new CoachUnavailable(
    'The model returned a response that could not be read as structured data, twice. Try again, or enter the data by hand.',
  )
}

export const coachModel = MODEL
