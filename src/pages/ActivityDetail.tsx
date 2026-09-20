import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { ActivityAnalysis } from '../../shared/types'
import { ActivityForm } from '../components/ActivityForm'
import { AsyncBody, ConfirmButton, Empty, Note, Panel, Stat, useAsync } from '../components/ui'
import { api, type ActivityInput } from '../lib/api'
import { dash, elapsed, hhmm, int, longDate, num, typeLabel } from '../lib/format'

function Derived({ a }: { a: ActivityAnalysis }) {
  const d = a.decoupling
  return (
    <div className="panel grid grid-cols-2 divide-x divide-y divide-rule sm:grid-cols-4 sm:divide-y-0">
      <Stat
        label="Training load"
        value={a.tss == null ? dash : num(a.tss)}
        unit="TSS"
        tone="accent"
        note={a.tss_basis === 'estimated' ? 'Estimated from average power' : a.tss_basis === 'measured' ? 'From normalized power' : 'No power data'}
      />
      <Stat
        label="Intensity factor"
        value={a.intensity_factor == null ? dash : num(a.intensity_factor, 2)}
        note={a.ftp ? `Against ${a.ftp} W FTP` : 'No FTP set'}
      />
      <Stat
        label="Variability index"
        value={a.variability_index == null ? dash : num(a.variability_index, 2)}
        note={
          a.variability_index == null
            ? 'Needs both average and normalized power'
            : a.variability_index > 1.2
              ? 'Surgy: made of accelerations'
              : a.variability_index < 1.06
                ? 'Steady throughout'
                : 'Moderately variable'
        }
      />
      <Stat
        label="Decoupling"
        value={d?.drift_pct == null ? dash : `${d.drift_pct > 0 ? '+' : ''}${num(d.drift_pct, 1)}`}
        unit={d?.drift_pct == null ? undefined : '%'}
        tone={d?.drift_pct != null && d.drift_pct > 5 ? 'warning' : 'default'}
        note={
          d?.drift_pct == null
            ? 'Needs a FIT file with heart rate'
            : d.drift_pct > 0
              ? 'Power fell relative to heart rate'
              : 'Power held or rose relative to heart rate'
        }
      />
    </div>
  )
}

function Analysis({ a }: { a: ActivityAnalysis }) {
  const act = a.activity
  const f = a.fuelling

  return (
    <div className="space-y-3">
      <Derived a={a} />

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Recorded">
          <table className="tbl">
            <tbody>
              {[
                ['Duration', hhmm(act.duration_min)],
                ['Distance', act.distance_km == null ? dash : `${num(act.distance_km, 1)} km`],
                ['Elevation', act.elevation_m == null ? dash : `${int(act.elevation_m)} m`],
                ['Average power', act.avg_power == null ? dash : `${act.avg_power} W`],
                ['Normalized power', act.normalized_power == null ? dash : `${act.normalized_power} W`],
                ['Max power', act.max_power == null ? dash : `${act.max_power} W`],
                ['Average HR', act.avg_hr == null ? dash : `${act.avg_hr} bpm`],
                ['Max HR', act.max_hr == null ? dash : `${act.max_hr} bpm`],
                ['Average cadence', act.avg_cadence == null ? dash : `${act.avg_cadence} rpm`],
              ].map(([label, value]) => (
                <tr key={label}>
                  <td className="text-[12px] text-ink-2">{label}</td>
                  <td className="num r">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Best power in this ride">
          {a.best_efforts ? (
            <table className="tbl">
              <tbody>
                {(
                  [
                    ['5 seconds', a.best_efforts.s5],
                    ['1 minute', a.best_efforts.s60],
                    ['5 minutes', a.best_efforts.s300],
                    ['20 minutes', a.best_efforts.s1200],
                    ['60 minutes', a.best_efforts.s3600],
                  ] as [string, number | null][]
                ).map(([label, watts]) => (
                  <tr key={label}>
                    <td className="text-[12px] text-ink-2">{label}</td>
                    <td className="num r">
                      {watts == null ? <span className="text-ink-3">not long enough</span> : `${watts} W`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>
              Best efforts come from second-by-second data. Upload this ride as a FIT file to see them.
            </Empty>
          )}
        </Panel>
      </div>

      {a.quarters && (
        <Panel title="Quarter by quarter" right={<span className="text-[11px] text-ink-3">moving time, split in four</span>}>
          <div className="overflow-x-auto">
            <table className="tbl tbl-tight">
              <thead>
                <tr>
                  <th>Quarter</th>
                  <th className="r">NP</th>
                  <th className="r">HR</th>
                  <th className="r">Cadence</th>
                  <th className="r">Coasting</th>
                </tr>
              </thead>
              <tbody>
                {a.quarters.map((q) => (
                  <tr key={q.quarter}>
                    <td className="text-[12px] text-ink-2">Q{q.quarter}</td>
                    <td className="num r">{q.normalized_power == null ? dash : `${q.normalized_power} W`}</td>
                    <td className="num r">{q.avg_hr == null ? dash : `${q.avg_hr} bpm`}</td>
                    <td className="num r">{q.avg_cadence == null ? dash : `${q.avg_cadence} rpm`}</td>
                    <td className="num r">{q.coasting_pct == null ? dash : `${num(q.coasting_pct, 1)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {a.climbs && a.climbs.length > 0 && (
        <Panel
          title="Sustained climbs"
          right={<span className="text-[11px] text-ink-3">above 3% for 90 seconds or more, in the order ridden</span>}
        >
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Started</th>
                  <th className="r">Length</th>
                  <th className="r">Grade</th>
                  <th className="r">Gain</th>
                  <th className="r">Power</th>
                  <th className="r">Cadence</th>
                  <th className="r">In lowest gear</th>
                </tr>
              </thead>
              <tbody>
                {a.climbs.map((c) => (
                  <tr key={c.index}>
                    <td className="num text-ink-2">{c.index}</td>
                    <td className="num text-[12px] text-ink-2">{elapsed(c.start_second)}</td>
                    <td className="num r">{elapsed(c.duration_s)}</td>
                    <td className="num r">{num(c.avg_grade_pct, 1)}%</td>
                    <td className="num r">{int(c.elevation_gain_m)} m</td>
                    <td className="num r">{c.avg_power == null ? dash : `${c.avg_power} W`}</td>
                    <td className="num r">{c.avg_cadence == null ? dash : `${c.avg_cadence} rpm`}</td>
                    <td className="num r">{c.lowest_gear_pct == null ? dash : `${num(c.lowest_gear_pct, 0)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {a.gearing && (
          <Panel title="Gearing" right={<span className="text-[11px] text-ink-3">derived from speed and cadence</span>}>
            <table className="tbl">
              <tbody>
                <tr>
                  <td className="text-[12px] text-ink-2">Lowest gear used</td>
                  <td className="num r">{a.gearing.lowest_ratio == null ? dash : `${num(a.gearing.lowest_ratio, 2)}:1`}</td>
                </tr>
                <tr>
                  <td className="text-[12px] text-ink-2">Highest gear used</td>
                  <td className="num r">{a.gearing.highest_ratio == null ? dash : `${num(a.gearing.highest_ratio, 2)}:1`}</td>
                </tr>
                <tr>
                  <td className="text-[12px] text-ink-2">Time above 3% grade</td>
                  <td className="num r">{elapsed(a.gearing.steep_seconds)}</td>
                </tr>
                <tr>
                  <td className="text-[12px] text-ink-2">Of that, in the lowest gear</td>
                  <td className="num r">
                    {a.gearing.steep_time_in_lowest_gear_pct == null
                      ? dash
                      : `${num(a.gearing.steep_time_in_lowest_gear_pct, 0)}%`}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="border-t border-rule px-3.5 py-2 text-[11px] leading-relaxed text-ink-3">
              Only gears actually used are visible in the data, so “lowest” means the lowest gear used on this ride.
              Assumes a {a.gearing.assumed_wheel_circumference_m} m wheel circumference. A high figure on the last row
              means you were out of gears on the steep sections.
            </p>
          </Panel>
        )}

        <Panel title="Work and fuelling">
          <table className="tbl">
            <tbody>
              <tr>
                <td className="text-[12px] text-ink-2">Work done</td>
                <td className="num r">{f.kj == null ? dash : `${int(f.kj)} kJ`}</td>
              </tr>
              <tr>
                <td className="text-[12px] text-ink-2">Carbohydrate at 90 g/h</td>
                <td className="num r">{int(f.carb_target_g)} g</td>
              </tr>
              <tr>
                <td className="text-[12px] text-ink-2">That intake as energy</td>
                <td className="num r">{int(f.carb_target_kj)} kJ</td>
              </tr>
              {f.kj != null && f.kj > 0 && (
                <tr>
                  <td className="text-[12px] text-ink-2">Coverage of the work</td>
                  <td className="num r">{num((f.carb_target_kj / f.kj) * 100, 0)}%</td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="border-t border-rule px-3.5 py-2 text-[11px] leading-relaxed text-ink-3">
            {f.kj_basis === 'stream'
              ? 'Work summed from the power stream.'
              : f.kj_basis === 'logged'
                ? 'Work as logged with the activity.'
                : f.kj_basis === 'estimated'
                  ? 'Work estimated from average power and duration.'
                  : 'No power data, so the work done is unknown.'}{' '}
            Coverage above 100% does not mean you should eat that much; it is the ceiling the 90 g/h guideline sets
            against the work actually done.
          </p>
        </Panel>
      </div>

      {act.notes && (
        <Panel title="Your note">
          <p className="whitespace-pre-wrap px-3.5 py-3 text-[13px] leading-relaxed text-ink-2">{act.notes}</p>
        </Panel>
      )}

      {a.gaps.length > 0 && (
        <Panel title="What the data does not cover">
          <ul className="space-y-1.5 px-3.5 py-3 text-[12px] leading-relaxed text-ink-2">
            {a.gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}

export function ActivityDetail() {
  const { id } = useParams()
  const activityId = Number(id)
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const state = useAsync(() => api.activities.analysis(activityId), [activityId])

  const save = async (input: ActivityInput) => {
    setBusy(true)
    try {
      await api.activities.update(activityId, input)
      setEditing(false)
      state.reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <AsyncBody state={state} empty={<Empty>No activity with that id.</Empty>}>
        {(a) => (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-[18px] font-semibold leading-tight">{a.activity.name}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
                  <span>{longDate(a.activity.date)}</span>
                  <span className="tag">{typeLabel[a.activity.type] ?? a.activity.type}</span>
                  <span className="tag">
                    {a.activity.source === 'fit' ? 'FIT upload' : a.activity.source === 'pasted' ? 'Pasted' : 'Manual'}
                  </span>
                  {!a.has_streams && <span className="text-ink-3">summary only</span>}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Link className="btn btn-sm" to={`/coach?activity=${a.activity.id}`}>
                  Get feedback
                </Link>
                <button type="button" className="btn btn-sm" onClick={() => setEditing((v) => !v)}>
                  {editing ? 'Stop editing' : 'Edit'}
                </button>
                <ConfirmButton
                  onConfirm={async () => {
                    await api.activities.remove(a.activity.id)
                    navigate('/')
                  }}
                >
                  Delete
                </ConfirmButton>
              </div>
            </div>

            {editing ? (
              <Panel title="Edit activity">
                <ActivityForm
                  initial={a.activity}
                  submitLabel="Save changes"
                  busy={busy}
                  onSubmit={save}
                  onCancel={() => setEditing(false)}
                  banner={
                    a.has_streams ? (
                      <Note kind="warning">
                        Editing the summary does not change the uploaded stream, so the derived analysis below keeps
                        using the original file.
                      </Note>
                    ) : undefined
                  }
                />
              </Panel>
            ) : (
              <Analysis a={a} />
            )}
          </>
        )}
      </AsyncBody>
    </div>
  )
}
