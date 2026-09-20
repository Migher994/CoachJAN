import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { WeeklyLoad } from '../../../shared/types'
import { hhmm, shortDate } from '../../lib/format'
import { SERIES, TooltipCard, axisProps, gridProps, type ChartTooltipProps } from './kit'

/**
 * One series, so one colour, with the current week as the only emphasis. Weeks
 * holding a ride without power are real totals that understate the week, so the
 * caveat rides in the tooltip rather than changing how the bar is drawn.
 */
export function WeeklyLoadChart({ data }: { data: WeeklyLoad[] }) {
  const currentWeek = data.at(-1)?.week_start

  return (
    <div className="h-56 px-2 pt-3 pb-1">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="week_start" tickFormatter={shortDate} interval="preserveStartEnd" minTickGap={18} {...axisProps} />
          <YAxis width={48} {...axisProps} />
          <Tooltip
            cursor={{ fill: 'var(--c-surface-3)' }}
            content={({ active, payload }: ChartTooltipProps) => {
              const w = payload?.[0]?.payload as unknown as WeeklyLoad | undefined
              if (!active || !w) return null
              return (
                <TooltipCard
                  title={`Week of ${shortDate(w.week_start)}`}
                  rows={[
                    { label: 'Load', value: `${w.tss} TSS`, color: w.week_start === currentWeek ? SERIES.accent : SERIES.neutral },
                    { label: 'Time', value: hhmm(w.hours * 60) },
                    { label: 'Activities', value: w.activities },
                  ]}
                  footer={w.incomplete ? 'Understated: some rides that week had no power data.' : undefined}
                />
              )
            }}
          />
          <Bar dataKey="tss" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((w) => (
              <Cell key={w.week_start} fill={w.week_start === currentWeek ? SERIES.accent : SERIES.neutral} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
