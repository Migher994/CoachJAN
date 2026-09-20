import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PowerCurve } from '../../../shared/types'
import { duration, shortDate } from '../../lib/format'
import { Legend, SERIES, TooltipCard, axisProps, gridProps, type ChartTooltipProps } from './kit'

const TICKS = [5, 30, 60, 300, 1200, 3600]

interface Merged {
  seconds: number
  current: number | null
  previous: number | null
  currentDate?: string
  previousDate?: string
}

function merge(current: PowerCurve, previous: PowerCurve): Merged[] {
  const seconds = [...new Set([...current.points, ...previous.points].map((p) => p.seconds))].sort((a, b) => a - b)
  return seconds.map((s) => {
    const c = current.points.find((p) => p.seconds === s)
    const p = previous.points.find((q) => q.seconds === s)
    return {
      seconds: s,
      current: c?.watts ?? null,
      previous: p?.watts ?? null,
      currentDate: c?.date,
      previousDate: p?.date,
    }
  })
}

/**
 * Best power against duration on a log time axis. The curve stops where the
 * data stops: a duration longer than the longest ride simply has no point.
 */
export function PowerCurveChart({ current, previous }: { current: PowerCurve; previous: PowerCurve }) {
  const data = merge(current, previous)
  const hasPrevious = previous.points.length > 0
  const ticks = TICKS.filter((t) => t >= (data[0]?.seconds ?? 1) && t <= (data.at(-1)?.seconds ?? 3600))

  return (
    <div>
      <div className="h-60 px-2 pt-3 pb-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis
              dataKey="seconds"
              type="number"
              scale="log"
              domain={['dataMin', 'dataMax']}
              ticks={ticks}
              tickFormatter={duration}
              {...axisProps}
            />
            <YAxis width={48} {...axisProps} />
            <Tooltip
              cursor={{ stroke: 'var(--c-rule-strong)', strokeWidth: 1 }}
              content={({ active, payload }: ChartTooltipProps) => {
                const row = payload?.[0]?.payload as unknown as Merged | undefined
                if (!active || !row) return null
                const rows = [
                  {
                    label: current.label,
                    value: row.current == null ? 'no effort this long' : `${row.current} W`,
                    color: SERIES.s1,
                  },
                ]
                if (hasPrevious) {
                  rows.push({
                    label: previous.label,
                    value: row.previous == null ? 'no effort this long' : `${row.previous} W`,
                    color: SERIES.s2,
                  })
                }
                return (
                  <TooltipCard
                    title={`Best ${duration(row.seconds)}`}
                    rows={rows}
                    footer={row.currentDate ? `Set on ${shortDate(row.currentDate)}` : undefined}
                  />
                )
              }}
            />
            {hasPrevious && (
              <Line
                type="monotone"
                dataKey="previous"
                stroke={SERIES.s2}
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={false}
                activeDot={{ r: 4, stroke: 'var(--c-surface)', strokeWidth: 2 }}
                connectNulls
                isAnimationActive={false}
              />
            )}
            <Line
              type="monotone"
              dataKey="current"
              stroke={SERIES.s1}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: 'var(--c-surface)', strokeWidth: 2 }}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="border-t border-rule px-3.5 py-2">
        <Legend
          items={[
            { label: current.label, color: SERIES.s1, note: `${current.sample_size} ride${current.sample_size === 1 ? '' : 's'}` },
            ...(hasPrevious
              ? [{ label: previous.label, color: SERIES.s2, note: `${previous.sample_size} ride${previous.sample_size === 1 ? '' : 's'}` }]
              : []),
          ]}
        />
      </div>
    </div>
  )
}
