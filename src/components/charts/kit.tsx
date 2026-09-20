import type { ReactNode } from 'react'
import type { TooltipContentProps } from 'recharts'

/** Validated categorical slots 1-3, plus a recessive neutral for context marks. */
export const SERIES: Record<'s1' | 's2' | 's3' | 'neutral' | 'accent', string> = {
  s1: 'var(--s1)',
  s2: 'var(--s2)',
  s3: 'var(--s3)',
  neutral: 'var(--s-neutral)',
  accent: 'var(--c-accent)',
}

export const axisProps = {
  tickLine: false,
  axisLine: { stroke: 'var(--c-rule)' },
  tick: { fill: 'var(--c-ink-3)', fontSize: 11 },
} as const

export const gridProps = {
  stroke: 'var(--c-grid)',
  strokeDasharray: '0',
  vertical: false,
} as const

export function TooltipCard({ title, rows, footer }: { title: string; rows: { label: string; value: ReactNode; color?: string }[]; footer?: ReactNode }) {
  return (
    <div className="panel min-w-40 px-2.5 py-2 text-[12px] shadow-sm">
      <div className="mb-1 font-medium text-ink">{title}</div>
      <dl className="space-y-0.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-4">
            <dt className="flex items-center gap-1.5 text-ink-2">
              {r.color && (
                <span aria-hidden className="inline-block h-2 w-2 rounded-[1px]" style={{ background: r.color }} />
              )}
              {r.label}
            </dt>
            <dd className="num text-ink">{r.value}</dd>
          </div>
        ))}
      </dl>
      {footer && <div className="mt-1.5 border-t border-rule pt-1.5 text-[11px] text-ink-3">{footer}</div>}
    </div>
  )
}

/** Legend rendered as text with a colour chip, so identity is never colour alone. */
export function Legend({ items }: { items: { label: string; color: string; note?: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-2">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2 w-2 rounded-[1px]" style={{ background: i.color }} />
          {i.label}
          {i.note && <span className="text-ink-3">{i.note}</span>}
        </li>
      ))}
    </ul>
  )
}

/** Recharts' own content-prop shape, so custom tooltips type-check against it. */
export type ChartTooltipProps = TooltipContentProps
