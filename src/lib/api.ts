import type {
  Activity,
  ActivityAnalysis,
  ActivityRow,
  DashboardSummary,
  Feedback,
  Plan,
  PlanBlock,
  PmcPoint,
  PowerCurve,
  Profile,
  Race,
  WeeklyLoad,
} from '../../shared/types'

export class ApiError extends Error {}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: init?.body instanceof FormData ? init?.headers : { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch {
    throw new ApiError('Could not reach the CoachJan API. Is it running? Start it with npm run dev.')
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    throw new ApiError(`The API returned something unreadable (HTTP ${res.status}).`)
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error
    throw new ApiError(message ?? `Request failed (HTTP ${res.status}).`)
  }
  return data as T
}

const get = <T>(path: string) => req<T>(path)
const post = <T>(path: string, body?: unknown) =>
  req<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const put = <T>(path: string, body?: unknown) =>
  req<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) })
const del = (path: string) => req<void>(path, { method: 'DELETE' })

export type ActivityInput = Omit<Activity, 'id' | 'created_at' | 'source' | 'raw_fit_path'>

export interface FitPreview {
  token: string
  summary: ActivityInput
  warnings: string[]
  found: string[]
  sample_count: number
  moving_seconds: number
}

export interface PastedActivity extends Partial<ActivityInput> {
  confidence: 'low' | 'medium' | 'high'
  parse_notes: string
}

export const api = {
  profile: {
    get: () => get<Profile>('/profile'),
    save: (p: Omit<Profile, 'id' | 'updated_at'>) => put<Profile>('/profile', p),
  },
  races: {
    list: () => get<Race[]>('/races'),
    create: (r: Omit<Race, 'id' | 'created_at'>) => post<Race>('/races', r),
    update: (id: number, r: Omit<Race, 'id' | 'created_at'>) => put<Race>(`/races/${id}`, r),
    remove: (id: number) => del(`/races/${id}`),
  },
  activities: {
    list: (params: { from?: string; to?: string; limit?: number } = {}) => {
      const q = new URLSearchParams()
      for (const [k, v] of Object.entries(params)) if (v != null) q.set(k, String(v))
      return get<ActivityRow[]>(`/activities${q.toString() ? `?${q}` : ''}`)
    },
    get: (id: number) => get<ActivityRow>(`/activities/${id}`),
    analysis: (id: number) => get<ActivityAnalysis>(`/activities/${id}/analysis`),
    create: (a: ActivityInput) => post<ActivityRow>('/activities', a),
    update: (id: number, a: ActivityInput) => put<ActivityRow>(`/activities/${id}`, a),
    remove: (id: number) => del(`/activities/${id}`),
    upload: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return req<FitPreview>('/activities/upload', { method: 'POST', body: form })
    },
    commitUpload: (token: string, a: ActivityInput) =>
      post<ActivityRow>(`/activities/upload/${token}/commit`, a),
    discardUpload: (token: string) => del(`/activities/upload/${token}`),
  },
  dashboard: {
    summary: () => get<DashboardSummary>('/dashboard'),
    weekly: (weeks = 12) => get<WeeklyLoad[]>(`/dashboard/weekly?weeks=${weeks}`),
    pmc: (days = 180) => get<PmcPoint[]>(`/dashboard/pmc?days=${days}`),
    powerTrend: (limit = 30) =>
      get<{ id: number; date: string; name: string; type: string; avg_power: number | null; normalized_power: number | null }[]>(
        `/dashboard/power-trend?limit=${limit}`,
      ),
    powerCurve: () => get<{ current: PowerCurve; previous: PowerCurve }>('/dashboard/power-curve'),
  },
  feedback: {
    list: () => get<Feedback[]>('/feedback'),
    save: (f: { scope: 'activity' | 'block'; ref: string; text: string }) => post<Feedback>('/feedback', f),
    remove: (id: number) => del(`/feedback/${id}`),
  },
  plans: {
    list: () => get<Plan[]>('/plans'),
    save: (p: PlanBlock) => post<Plan>('/plans', p),
    activate: (id: number) => put<Plan>(`/plans/${id}/activate`),
    remove: (id: number) => del(`/plans/${id}`),
  },
  coach: {
    status: () => get<{ configured: boolean; model: string }>('/coach/status'),
    plan: () => post<{ plan: PlanBlock; problems: string[] }>('/coach/plan'),
    parseActivity: (text: string) => post<PastedActivity>('/coach/parse-activity', { text }),
  },
}

/* ------------------------------------------------------------------ */
/* Streaming                                                            */
/* ------------------------------------------------------------------ */

export interface StreamHandlers {
  onMeta?: (meta: { scope: string; ref: string; label: string }) => void
  onDelta: (text: string) => void
  onDone: (text: string) => void
  onError: (message: string) => void
}

/**
 * Reads the newline-delimited JSON the coach endpoints write, so text appears
 * as it is generated instead of after the whole response lands.
 */
export async function streamCoach(
  path: string,
  body: unknown,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if ((error as Error).name === 'AbortError') return
    handlers.onError('Could not reach the CoachJan API. Is it running?')
    return
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    let message = `Request failed (HTTP ${res.status}).`
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? message
    } catch {
      /* keep the generic message */
    }
    handlers.onError(message)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let cut = buffer.indexOf('\n')
      while (cut >= 0) {
        const line = buffer.slice(0, cut).trim()
        buffer = buffer.slice(cut + 1)
        if (line) {
          const event = JSON.parse(line) as
            | { type: 'meta'; scope: string; ref: string; label: string }
            | { type: 'delta'; text: string }
            | { type: 'done'; text: string }
            | { type: 'error'; message: string }
          if (event.type === 'meta') handlers.onMeta?.(event)
          else if (event.type === 'delta') handlers.onDelta(event.text)
          else if (event.type === 'done') handlers.onDone(event.text)
          else handlers.onError(event.message)
        }
        cut = buffer.indexOf('\n')
      }
    }
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      handlers.onError('The connection dropped while the response was being written.')
    }
  }
}
