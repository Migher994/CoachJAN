/**
 * Prompt construction. The derived numbers are computed in metrics.ts and
 * handed to the model as a rendered report, so the model reads values rather
 * than inferring them from raw data.
 */
import type {
  ActivityAnalysis,
  ActivityRow,
  BlockAnalysis,
  Profile,
  Race,
  WeeklyLoad,
} from '../../shared/types.js'

const n = (v: number | null | undefined, unit = '', dp?: number): string => {
  if (v == null) return 'not recorded'
  const value = dp == null ? v : Number(v.toFixed(dp))
  return `${value}${unit}`
}

const hhmm = (minutes: number): string => {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

/** mm:ss below an hour, h:mm:ss above it. */
const clock = (seconds: number): string => {
  const t = Math.round(seconds)
  const mm = `${Math.floor((t % 3600) / 60)}`.padStart(2, '0')
  const ss = `${t % 60}`.padStart(2, '0')
  return t < 3600 ? `${Math.floor(t / 60)}:${ss}` : `${Math.floor(t / 3600)}:${mm}:${ss}`
}

export const METRIC_CONVENTIONS = `Metric conventions used in the data below:
- TSS marked "measured" came from normalized power; "estimated" came from average power and is less reliable for variable rides.
- Intensity factor is normalized power divided by the rider's current FTP.
- Variability index is normalized power divided by average power. Around 1.05 or below is a steady ride; above 1.2 means the ride was made of surges.
- Decoupling drift is the NP-to-heart-rate ratio of the first half compared with the second. A positive number means power fell relative to heart rate over the ride. Above roughly 5% on a steady endurance ride suggests the duration exceeded current aerobic durability.
- Coasting percentage is the share of moving time at zero watts.
- Cadence averages exclude coasting, so they describe cadence while pedalling.
- Gear ratio is derived from speed and cadence and assumes a 2.105 m wheel circumference. Only gears the rider actually used are visible, so "lowest gear" means the lowest gear used, not necessarily the lowest fitted.
- Climbs are stretches above 3% grade held for 90 seconds or more, listed in the order they were ridden.`

export function renderActivityReport(a: ActivityAnalysis, index?: number): string {
  const act = a.activity
  const lines: string[] = []
  const heading = index ? `Activity ${index}: ` : 'Activity: '
  lines.push(`${heading}${act.name} (${act.date}, type: ${act.type})`)
  lines.push(
    `Duration ${hhmm(act.duration_min)}; distance ${n(act.distance_km, ' km')}; elevation ${n(act.elevation_m, ' m')}.`,
  )
  lines.push(
    `Average power ${n(act.avg_power, ' W')}; normalized power ${n(act.normalized_power, ' W')}; max power ${n(act.max_power, ' W')}.`,
  )
  lines.push(`Average HR ${n(act.avg_hr, ' bpm')}; max HR ${n(act.max_hr, ' bpm')}; average cadence ${n(act.avg_cadence, ' rpm')}.`)
  lines.push(
    `TSS ${n(a.tss)}${a.tss_basis ? ` (${a.tss_basis})` : ''}; intensity factor ${n(a.intensity_factor, '', 2)}; variability index ${n(a.variability_index, '', 2)}. FTP on file: ${n(a.ftp, ' W')}.`,
  )

  if (a.best_efforts) {
    const b = a.best_efforts
    lines.push(
      `Best power in this ride: 5s ${n(b.s5, ' W')}, 1min ${n(b.s60, ' W')}, 5min ${n(b.s300, ' W')}, 20min ${n(b.s1200, ' W')}, 60min ${n(b.s3600, ' W')}.`,
    )
  }

  if (a.decoupling) {
    const d = a.decoupling
    lines.push(
      `Decoupling: first half ${n(d.first_half_np, ' W')} at ${n(d.first_half_hr, ' bpm')}, second half ${n(d.second_half_np, ' W')} at ${n(d.second_half_hr, ' bpm')}, drift ${n(d.drift_pct, '%', 1)}.`,
    )
  }

  if (a.quarters) {
    lines.push('Quarter by quarter:')
    for (const q of a.quarters) {
      lines.push(
        `  Q${q.quarter}: NP ${n(q.normalized_power, ' W')}, HR ${n(q.avg_hr, ' bpm')}, cadence ${n(q.avg_cadence, ' rpm')}, coasting ${n(q.coasting_pct, '%', 1)}.`,
      )
    }
  }

  if (a.climbs?.length) {
    lines.push('Sustained climbs, in the order ridden:')
    for (const c of a.climbs) {
      lines.push(
        `  #${c.index} at ${clock(c.start_second)} into the ride: ${clock(c.duration_s)} at ${c.avg_grade_pct}% (${c.elevation_gain_m} m gain), ${n(c.avg_power, ' W')}, ${n(c.avg_cadence, ' rpm')}, ${n(c.avg_speed_kmh, ' km/h')}, ${n(c.lowest_gear_pct, '% of it in the lowest gear used')}.`,
      )
    }
  }

  if (a.gearing) {
    const g = a.gearing
    lines.push(
      `Gearing: lowest ratio used ${g.lowest_ratio == null ? 'not recorded' : g.lowest_ratio.toFixed(2)}, highest ${g.highest_ratio == null ? 'not recorded' : g.highest_ratio.toFixed(2)}. Time above 3% grade: ${clock(g.steep_seconds)}, of which ${n(g.steep_time_in_lowest_gear_pct, '%', 1)} was spent in the lowest gear used.`,
    )
  }

  const f = a.fuelling
  lines.push(
    `Work done ${n(f.kj, ' kJ')}${f.kj_basis ? ` (${f.kj_basis})` : ''}. At 90 g of carbohydrate per hour, which is the upper end of the guideline rather than a target for every ride, ${f.duration_hours} hours would mean ${Math.round(f.carb_target_g)} g, about ${Math.round(f.carb_target_kj)} kJ of intake${f.kj ? `, against ${Math.round(f.kj)} kJ of work done` : ''}.`,
  )

  if (act.notes) lines.push(`Rider's note: ${act.notes}`)
  if (a.gaps.length) lines.push(`Data gaps: ${a.gaps.join(' ')}`)

  return lines.join('\n')
}

export function renderWeekly(weeks: WeeklyLoad[]): string {
  return weeks
    .map(
      (w) =>
        `  week of ${w.week_start}: ${w.tss} TSS across ${w.activities} ${w.activities === 1 ? 'activity' : 'activities'}, ${w.hours} h${w.incomplete ? ' (understated, some rides had no power)' : ''}`,
    )
    .join('\n')
}

export function renderBlockReport(b: BlockAnalysis): string {
  const lines: string[] = []
  lines.push(`Window: ${b.from} to ${b.to} (${b.days} days).`)
  lines.push(
    `${b.ride_count} activities, ${b.total_hours} hours, ${b.total_distance_km} km, ${b.total_tss} TSS total, ${b.rest_days} days without a recorded activity.`,
  )
  lines.push('Weekly load:')
  lines.push(renderWeekly(b.weekly))
  if (b.gaps.length) lines.push(`Data gaps: ${b.gaps.join(' ')}`)
  lines.push('')
  b.activities.forEach((a, i) => {
    lines.push(renderActivityReport(a, i + 1))
    lines.push('')
  })
  return lines.join('\n')
}

export function renderProfile(p: Profile): string {
  return [
    `FTP ${n(p.ftp, ' W')}; weight ${n(p.weight_kg, ' kg')}${p.ftp && p.weight_kg ? ` (${(p.ftp / p.weight_kg).toFixed(2)} W/kg)` : ''}.`,
    `Weekly hours target ${n(p.weekly_hours_target, ' h')}; max heart rate ${n(p.max_hr, ' bpm')}.`,
    p.notes ? `Rider notes: ${p.notes}` : 'Rider notes: none.',
  ].join('\n')
}

export function renderRaces(races: Race[], today: string): string {
  if (!races.length) return 'No races on the calendar.'
  return races
    .map((r) => {
      const days = Math.round(
        (new Date(`${r.date}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000,
      )
      const when = days === 0 ? 'today' : days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`
      return `  ${r.date} (${when}), priority ${r.priority}: ${r.name}${r.course_notes ? ` - ${r.course_notes}` : ''}${r.result_notes ? ` [result: ${r.result_notes}]` : ''}`
    })
    .join('\n')
}

export function renderActivityList(rows: ActivityRow[]): string {
  if (!rows.length) return '  none logged'
  return rows
    .map(
      (r) =>
        `  ${r.date} ${r.name} (${r.type}): ${hhmm(r.duration_min)}, ${n(r.distance_km, ' km')}, NP ${n(r.normalized_power, ' W')}, avg ${n(r.avg_power, ' W')}, HR ${n(r.avg_hr, ' bpm')}, TSS ${n(r.tss)}${r.tss_basis === 'estimated' ? ' (estimated)' : ''}`,
    )
    .join('\n')
}

/* ------------------------------------------------------------------ */
/* System prompts                                                       */
/* ------------------------------------------------------------------ */

export const FEEDBACK_SYSTEM = `You are reviewing power and heart rate data for one amateur road cyclist who races through a Danish season. The rider trains four to six hours a week and wants to progress across several races rather than peak once.

Every number you need has already been computed and is given to you. Ground every claim in those numbers and name them when you make a point. Never invent a figure, and never estimate one that was not provided. Where the data notes a gap, either work around it or say plainly what would have to be recorded to answer the question.

Your job is to tell the rider what actually happened and what is wrong, not to encourage them. Say when a session did what it was supposed to do, briefly, and spend the rest of the words on what the data says is off: pacing that fell apart, intensity that landed in the wrong place, fuelling that did not cover the work, cadence or gearing that ran out on the climbs, heart rate drift that says the duration exceeded current durability. If the data looks fine, say so in one sentence and do not manufacture a problem.

Write 250 to 400 words as short prose paragraphs. No bullet lists, no headings, no bold text. Calm and matter-of-fact. No exclamation marks, no motivational language, no praise that is not tied to a number. Do not open with a summary of what the rider did; they know. Start with the thing that matters most.

${METRIC_CONVENTIONS}`

export const PLAN_SYSTEM = `You plan training blocks for one amateur road cyclist racing a Danish season. You will be given the rider's profile, their races, their recent training and the most recent written feedback.

Design the next block of three or four weeks. Hard rules, all of which must hold:
- Total planned hours in each week must be at or under the rider's weekly hours target. If a week needs to be lighter, make it lighter; never go over.
- If an A or B priority race falls within eight weeks, the block must build towards it, and the week containing or immediately preceding that race must be reduced.
- Every week contains at least one full rest day with no session at all.
- Never schedule two hard days back to back. A hard day is anything at threshold or above, or a race. Endurance and recovery days may follow each other freely.
- Use the rider's actual recent volume as the starting point. Do not jump the weekly load by more than about 10% from where they are now.

Session types should be plain words the rider will recognise: endurance, tempo, threshold, VO2, sprints, recovery, race, rest. Intensity should say where the effort sits, for example "Z2", "88-93% FTP", "race pace" or "easy". Descriptions are one line and concrete: the actual interval structure, not a slogan.

The focus is one sentence stating what this block is for. The block name is short and descriptive.`

export const ASK_SYSTEM = `You answer one amateur road cyclist's training questions using the data provided below. The rider trains four to six hours a week and races amateur road races in Denmark.

Answer the question asked, directly, in short prose paragraphs. Ground what you say in the rider's actual numbers where they are relevant, and say so when the data does not support an answer rather than filling the gap. Calm and matter-of-fact, no hype, no encouragement for its own sake. Keep it under 300 words unless the question genuinely needs more.

${METRIC_CONVENTIONS}`

export const PARSE_SYSTEM = `You extract structured training data from whatever the rider pasted in: a transcribed Strava screenshot, a TrainingPeaks summary, a text export or free-form notes.

Fill only the fields the text actually supports. Leave a field null when the text does not contain it; do not infer, convert loosely or invent. Specifically:
- Duration must be in minutes. Convert "1h 13m" to 73.
- Distance in kilometres, elevation in metres, power in watts, heart rate in bpm, cadence in rpm, kJ as given.
- If a date is written in a local format, normalise it to YYYY-MM-DD. If the year is missing, use the year given as "today" below. If there is no date at all, use today.
- Type must be one of race, interval, endurance, recovery, commute, other. Choose from what the text says about the session; when it is unclear, use other.
- The name is the rider's own title for the activity if there is one, otherwise a short plain description.
- Put anything that did not map to a field, such as how the rider felt or what the session was meant to be, into notes.

Set confidence to low when the text was vague or you had to make a judgement call about several fields, medium when most fields were explicit, high when the text was a clean structured summary. In parse_notes, list in one or two sentences anything you were unsure about, so the rider can check it before saving.`
