import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PmcPoint } from '../../../shared/types'
import { shortDate } from '../../lib/format'
import { Legend, SERIES, TooltipCard, axisProps, gridProps, type ChartTooltipProps } from './kit'

/**
 * The three rolling averages behind the tiles, all in TSS per day, so they
 * share one axis. Form is the difference between the other two.
 */
export function LoadTrendChart({ data }: { data: PmcPoint[] }) {
  return (
    <div>
      <div className="h-52 px-2 pt-3 pb-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" tickFormatter={shortDate} interval="preserveStartEnd" minTickGap={40} {...axisProps} />
            <YAxis width={48} {...axisProps} />
            <ReferenceLine y={0} stroke="var(--c-rule-strong)" strokeWidth={1} />
            <Tooltip
              cursor={{ stroke: 'var(--c-rule-strong)', strokeWidth: 1 }}
              content={({ active, payload }: ChartTooltipProps) => {
                const p = payload?.[0]?.payload as unknown as PmcPoint | undefined
                if (!active || !p) return null
                return (
                  <TooltipCard
                    title={shortDate(p.date)}
                    rows={[
                      { label: 'Fitness (42d)', value: p.fitness, color: SERIES.s1 },
                      { label: 'Fatigue (7d)', value: p.fatigue, color: SERIES.s2 },
                      { label: 'Form', value: p.form, color: SERIES.s3 },
                    ]}
                    footer={`${p.tss} TSS that day`}
                  />
                )
              }}
            />
            <Line type="monotone" dataKey="fitness" stroke={SERIES.s1} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="fatigue" stroke={SERIES.s2} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="form" stroke={SERIES.s3} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="border-t border-rule px-3.5 py-2">
        <Legend
          items={[
            { label: 'Fitness', color: SERIES.s1, note: '42-day mean' },
            { label: 'Fatigue', color: SERIES.s2, note: '7-day mean' },
            { label: 'Form', color: SERIES.s3, note: 'fitness − fatigue' },
          ]}
        />
      </div>
    </div>
  )
}
