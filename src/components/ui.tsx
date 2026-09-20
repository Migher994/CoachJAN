import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '../lib/api'

export function Panel({
  title,
  right,
  children,
  className = '',
  bodyClass = '',
}: {
  title?: ReactNode
  right?: ReactNode
  children: ReactNode
  className?: string
  bodyClass?: string
}) {
  return (
    <section className={`panel min-w-0 ${className}`}>
      {title != null && (
        <header className="panel-head">
          <h2 className="panel-title">{title}</h2>
          {right}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  )
}

/**
 * A single readout. `note` carries the caveat (estimated, missing data) so the
 * number itself is never quietly wrong.
 */
export function Stat({
  label,
  value,
  unit,
  note,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  unit?: string
  note?: ReactNode
  tone?: 'default' | 'accent' | 'warning'
}) {
  const color =
    tone === 'accent' ? 'text-accent-ink' : tone === 'warning' ? 'text-warning' : 'text-ink'
  return (
    <div className="px-3.5 py-3">
      <div className="text-[11px] font-medium text-ink-3">{label}</div>
      <div className={`num mt-1 text-2xl leading-none ${color}`}>
        {value}
        {unit && <span className="ml-1 text-[13px] text-ink-3">{unit}</span>}
      </div>
      {note && <div className="mt-1.5 text-[11px] leading-snug text-ink-3">{note}</div>}
    </div>
  )
}

/** Empty states name the next action rather than reporting emptiness. */
export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="mx-auto max-w-md text-[13px] leading-relaxed text-ink-2">{children}</p>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  )
}

export function Note({ kind = 'info', children }: { kind?: 'info' | 'warning' | 'error'; children: ReactNode }) {
  const border =
    kind === 'error' ? 'border-l-critical' : kind === 'warning' ? 'border-l-warning' : 'border-l-rule-strong'
  const text = kind === 'error' ? 'text-critical' : kind === 'warning' ? 'text-warning' : 'text-ink-2'
  return (
    <div className={`border-l-2 bg-surface-2 px-3 py-2 text-[12px] leading-relaxed ${border} ${text}`} role={kind === 'error' ? 'alert' : undefined}>
      {children}
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[11px] font-medium text-ink-3">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-ink-3">{hint}</span>}
    </label>
  )
}

/** Two-step delete. Nothing is removed on a single click. */
export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = 'Delete for good',
  className = 'btn btn-sm btn-danger',
}: {
  onConfirm: () => void | Promise<void>
  children: ReactNode
  confirmLabel?: string
  className?: string
}) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  if (!armed) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => {
          setArmed(true)
          timer.current = window.setTimeout(() => setArmed(false), 6000)
        }}
      >
        {children}
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        className="btn btn-sm btn-danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await onConfirm()
          } finally {
            setBusy(false)
            setArmed(false)
          }
        }}
      >
        {busy ? 'Deleting…' : confirmLabel}
      </button>
      <button type="button" className="btn btn-sm" onClick={() => setArmed(false)} disabled={busy}>
        Keep
      </button>
    </span>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-6 text-[12px] text-ink-3">
      <span
        aria-hidden
        className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-rule-strong border-t-accent"
      />
      {label}
    </div>
  )
}

export interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
}

/** Small data-loading hook: keeps the last good data and surfaces the message. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let live = true
    setLoading(true)
    fnRef
      .current()
      .then((value) => {
        if (!live) return
        setData(value)
        setError(null)
      })
      .catch((e: unknown) => {
        if (!live) return
        setError(e instanceof ApiError || e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data, error, loading, reload }
}

/** Wraps a panel body: one of loading, error, empty or content. Never a blank box. */
export function AsyncBody<T>({
  state,
  empty,
  loadingLabel = 'Loading…',
  isEmpty,
  children,
}: {
  state: AsyncState<T>
  empty: ReactNode
  loadingLabel?: string
  isEmpty?: (data: T) => boolean
  children: (data: T) => ReactNode
}) {
  if (state.loading && state.data == null) return <Spinner label={loadingLabel} />
  if (state.error) {
    return (
      <div className="p-3">
        <Note kind="error">
          {state.error}{' '}
          <button type="button" className="underline underline-offset-2" onClick={state.reload}>
            Try again
          </button>
        </Note>
      </div>
    )
  }
  if (state.data == null) return <>{empty}</>
  if (isEmpty?.(state.data)) return <>{empty}</>
  return <>{children(state.data)}</>
}
