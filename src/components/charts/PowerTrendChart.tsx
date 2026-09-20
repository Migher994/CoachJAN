import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { shortDate } from '../../lib/format'
import { Legend, SERIES, TooltipCard, axisProps, gridProps, type ChartTooltipProps } from './kit'

export interface PowerTrendRow {
  id: number
  date: string
  name: string
  type: string
  avg_power: number | null
  normalized_power: number | null
}

/** Both series are watts, so they share one axis. Gaps are left as gaps. */
export function PowerTrendChart({ data }: { data: PowerTrendRow[] }) {
  const hasNp = data.some((d) => d.normalized_power != null)
  return (
    <div>
      <div className="h-56 px-2 pt-3 pb-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" tickFormatter={shortDate} interval="preserveStartEnd" minTickGap={24} {...axisProps} />
            <YAxis width={48} unit="" {...axisProps} />
            <Tooltip
              cursor={{ stroke: 'var(--c-rule-strong)', strokeWidth: 1 }}
              content={({ active, payload }: ChartTooltipProps) => {
                const row = payload?.[0]?.payload as unknown as PowerTrendRow | undefined
                if (!active || !row) return null
                return (
                  <TooltipCard
                    title={row.name}
                    rows={[
                      { label: 'Normalized', value: row.normalized_power == null ? 'not recorded' : `${row.normalized_power} W`, color: SERIES.s1 },
                      { label: 'Average', value: row.avg_power == null ? 'not recorded' : `${row.avg_power} W`, color: SERIES.s2 },
                    ]}
                    footer={shortDate(row.date)}
                  />
                )
              }}
            />
            <Line
              type="monotone"
              dataKey="normalized_power"
              stroke={SERIES.s1}
              strokeWidth={2}
              dot={{ r: 2.5, strokeWidth: 0, fill: SERIES.s1 }}
              activeDot={{ r: 4, stroke: 'var(--c-surface)', strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="avg_power"
              stroke={SERIES.s2}
              strokeWidth={2}
              dot={{ r: 2.5, strokeWidth: 0, fill: SERIES.s2 }}
              activeDot={{ r: 4, stroke: 'var(--c-surface)', strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="border-t border-rule px-3.5 py-2">
        <Legend
          items={[
            { label: 'Normalized power', color: SERIES.s1, note: hasNp ? undefined : '(none recorded yet)' },
            { label: 'Average power', color: SERIES.s2 },
          ]}
        />
      </div>
    </div>
  )
}
