import { Link } from 'react-router-dom'
import type { DashboardSummary, Race } from '../../shared/types'
import { LoadTrendChart } from '../components/charts/LoadTrendChart'
import { PowerCurveChart } from '../components/charts/PowerCurveChart'
import { PowerTrendChart } from '../components/charts/PowerTrendChart'
import { WeeklyLoadChart } from '../components/charts/WeeklyLoadChart'
import { AsyncBody, Empty, Note, Panel, Stat, useAsync } from '../components/ui'
import { api } from '../lib/api'
import { dash, hhmm, int, longDate, num, shortDate, signed, typeLabel } from '../lib/format'

function RaceCountdown({ race }: { race: (Race & { days_away: number }) | null }) {
  if (!race) {
    return (
      <Panel title="Next race">
        <Empty action={<Link className="btn btn-sm" to="/races">Add a race</Link>}>
          Nothing on the calendar. Add the races you are pointing at so the plan and the countdown have
          something to build towards.
        </Empty>
      </Panel>
    )
  }
  const weeks = Math.floor(race.days_away / 7)
  return (
    <Panel title="Next race">
      <div className="px-3.5 py-3">
        <div className="flex items-baseline gap-2">
          <span className="num text-4xl leading-none text-accent-ink">{race.days_away}</span>
          <span className="text-[13px] text-ink-3">
            {race.days_away === 1 ? 'day' : 'days'}
            {weeks >= 1 && ` · ${weeks} full ${weeks === 1 ? 'week' : 'weeks'}`}
          </span>
        </div>
        <div className="mt-2.5 text-[14px] font-medium leading-snug">{race.name}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
          <span className="tag">Priority {race.priority}</span>
          <span>{longDate(race.date)}</span>
        </div>
        {race.course_notes && <p className="mt-2 text-[12px] leading-relaxed text-ink-2">{race.course_notes}</p>}
      </div>
    </Panel>
  )
}

function StatRow({ s }: { s: DashboardSummary }) {
  return (
    <div className="panel grid grid-cols-2 divide-x divide-y divide-rule sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-5">
      <Stat label="Activities logged" value={int(s.activity_count)} />
      <Stat
        label="Avg weekly load"
        value={s.avg_weekly_tss_4w == null ? dash : num(s.avg_weekly_tss_4w)}
        unit="TSS"
        note="Mean of the last 4 weeks"
      />
      <Stat label="Fitness" value={s.fitness == null ? dash : num(s.fitness, 1)} note="42-day mean daily TSS" />
      <Stat label="Fatigue" value={s.fatigue == null ? dash : num(s.fatigue, 1)} note="7-day mean daily TSS" />
      <Stat
        label="Form"
        value={signed(s.form)}
        tone={s.form == null ? 'default' : s.form < -15 ? 'warning' : 'default'}
        note="Fitness minus fatigue"
      />
    </div>
  )
}

export function Dashboard() {
  const summary = useAsync(() => api.dashboard.summary(), [])
  const weekly = useAsync(() => api.dashboard.weekly(12), [])
  const pmc = useAsync(() => api.dashboard.pmc(180), [])
  const trend = useAsync(() => api.dashboard.powerTrend(30), [])
  const curve = useAsync(() => api.dashboard.powerCurve(), [])
  const recent = useAsync(() => api.activities.list({ limit: 12 }), [])

  const s = summary.data
  const noData = s != null && s.activity_count === 0
  const understated = (weekly.data ?? []).filter((w) => w.incomplete).length

  return (
    <div className="space-y-3">
      {noData && (
        <Note>
          Nothing logged yet. Add a ride from <Link className="underline underline-offset-2" to="/log">Log</Link>: upload
          a FIT file, paste a summary from Strava or TrainingPeaks, or type it in. The charts below fill in as data
          arrives.
        </Note>
      )}

      {s && !s.ftp && (
        <Note kind="warning">
          No FTP set, so training load and intensity cannot be computed. Set it in{' '}
          <Link className="underline underline-offset-2" to="/settings">Settings</Link>.
        </Note>
      )}

      {s && s.activities_missing_power > 0 && (
        <Note kind="warning">
          {s.activities_missing_power} {s.activities_missing_power === 1 ? 'activity has' : 'activities have'} no power
          data, so they contribute nothing to the load figures. The weeks holding them are real totals that understate
          the week; the weekly load panel says how many.
        </Note>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)]">
        <AsyncBody state={summary} empty={<Empty>No summary available.</Empty>}>
          {(data) => <RaceCountdown race={data.next_race} />}
        </AsyncBody>
        <AsyncBody state={summary} empty={<Empty>No summary available.</Empty>}>
          {(data) => <StatRow s={data} />}
        </AsyncBody>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel
          title="Weekly load"
          right={
            <span className="text-[11px] text-ink-3">
              last 12 weeks, TSS
              {understated > 0 && ` · ${understated} understated`}
            </span>
          }
        >
          <AsyncBody
            state={weekly}
            isEmpty={(d) => d.every((w) => w.activities === 0)}
            empty={
              <Empty action={<Link className="btn btn-sm" to="/log">Log a ride</Link>}>
                No activities in the last 12 weeks, so there is no load to plot.
              </Empty>
            }
          >
            {(data) => <WeeklyLoadChart data={data} />}
          </AsyncBody>
        </Panel>

        <Panel title="Fitness, fatigue and form" right={<span className="text-[11px] text-ink-3">TSS per day</span>}>
          <AsyncBody
            state={pmc}
            isEmpty={(d) => d.length < 2}
            empty={
              <Empty>
                At least two days of logged riding with power are needed before the rolling averages mean anything.
              </Empty>
            }
          >
            {(data) => <LoadTrendChart data={data} />}
          </AsyncBody>
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Power trend" right={<span className="text-[11px] text-ink-3">last 30 activities, watts</span>}>
          <AsyncBody
            state={trend}
            isEmpty={(d) => d.length === 0}
            empty={
              <Empty action={<Link className="btn btn-sm" to="/log">Log a ride</Link>}>
                No activities with power recorded yet. Once rides carry average or normalized power, the trend appears
                here.
              </Empty>
            }
          >
            {(data) => <PowerTrendChart data={data} />}
          </AsyncBody>
        </Panel>

        <Panel title="Power duration curve" right={<span className="text-[11px] text-ink-3">best efforts, log scale</span>}>
          <AsyncBody
            state={curve}
            isEmpty={(d) => d.current.points.length === 0 && d.previous.points.length === 0}
            empty={
              <Empty action={<Link className="btn btn-sm" to="/log">Upload a FIT file</Link>}>
                The curve is built from second-by-second data, which only comes from uploaded FIT files. Manually
                entered rides cannot produce one.
              </Empty>
            }
          >
            {(data) => <PowerCurveChart current={data.current} previous={data.previous} />}
          </AsyncBody>
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
        <Panel
          title="Recent activities"
          right={<Link className="text-[12px] text-accent-ink underline underline-offset-2" to="/log">Add</Link>}
        >
          <AsyncBody
            state={recent}
            isEmpty={(d) => d.length === 0}
            empty={
              <Empty action={<Link className="btn btn-sm btn-primary" to="/log">Log your first ride</Link>}>
                Nothing logged yet.
              </Empty>
            }
          >
            {(data) => (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Activity</th>
                      <th className="r">Time</th>
                      <th className="r">km</th>
                      <th className="r">NP</th>
                      <th className="r">HR</th>
                      <th className="r">TSS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((a) => (
                      <tr key={a.id}>
                        <td className="num whitespace-nowrap text-[12px] text-ink-2">{shortDate(a.date)}</td>
                        <td>
                          <Link className="hover:text-accent-ink hover:underline underline-offset-2" to={`/activity/${a.id}`}>
                            {a.name}
                          </Link>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-3">
                            <span>{typeLabel[a.type] ?? a.type}</span>
                            {a.has_streams && <span className="tag">FIT</span>}
                          </div>
                        </td>
                        <td className="num r whitespace-nowrap">{hhmm(a.duration_min)}</td>
                        <td className="num r">{a.distance_km == null ? dash : num(a.distance_km, 1)}</td>
                        <td className="num r">{a.normalized_power ?? a.avg_power ?? dash}</td>
                        <td className="num r">{a.avg_hr ?? dash}</td>
                        <td className="num r">
                          {a.tss == null ? (
                            <span className="text-ink-3" title="No power data, so no load could be computed">{dash}</span>
                          ) : (
                            <span title={a.tss_basis === 'estimated' ? 'Estimated from average power' : 'From normalized power'}>
                              {num(a.tss)}
                              {a.tss_basis === 'estimated' && <span className="text-ink-3">*</span>}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="border-t border-rule px-3.5 py-2 text-[11px] text-ink-3">
                  * load estimated from average power rather than normalized power.
                </p>
              </div>
            )}
          </AsyncBody>
        </Panel>

        <Panel title="Upcoming races">
          <AsyncBody
            state={summary}
            isEmpty={(d) => d.upcoming_races.length === 0}
            empty={
              <Empty action={<Link className="btn btn-sm" to="/races">Add a race</Link>}>
                No races on the calendar yet.
              </Empty>
            }
          >
            {(data) => (
              <ul className="divide-y divide-rule">
                {data.upcoming_races.map((r) => (
                  <li key={r.id} className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-[13px]">{r.name}</div>
                      <div className="mt-0.5 text-[11px] text-ink-3">{shortDate(r.date)}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="tag">{r.priority}</span>
                      <span className="num text-[13px] text-ink-2">{r.days_away}d</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </AsyncBody>
        </Panel>
      </div>
    </div>
  )
}
