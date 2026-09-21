/** Types shared by the Express API and the React client. */

export type ActivityType =
  | 'race'
  | 'interval'
  | 'endurance'
  | 'recovery'
  | 'commute'
  | 'other'

export type ActivitySource = 'manual' | 'pasted' | 'fit'

export type RacePriority = 'A' | 'B' | 'C'

export interface User {
  id: number
  email: string
  name: string | null
  created_at: string
}

export interface Profile {
  user_id: number
  ftp: number | null
  weight_kg: number | null
  weekly_hours_target: number | null
  max_hr: number | null
  notes: string | null
  updated_at: string
}

export interface Race {
  id: number
  name: string
  date: string
  priority: RacePriority
  course_notes: string | null
  result_notes: string | null
  created_at: string
}

export interface Activity {
  id: number
  date: string
  name: string
  type: ActivityType
  duration_min: number
  distance_km: number | null
  elevation_m: number | null
  avg_power: number | null
  normalized_power: number | null
  max_power: number | null
  avg_hr: number | null
  max_hr: number | null
  avg_cadence: number | null
  kj: number | null
  notes: string | null
  source: ActivitySource
  raw_fit_path: string | null
  created_at: string
}

/** Activity as the list endpoints return it: joined with load and stream presence. */
export interface ActivityRow extends Activity {
  tss: number | null
  /** 'measured' = from normalized power, 'estimated' = from average power, null = no power data. */
  tss_basis: 'measured' | 'estimated' | null
  intensity_factor: number | null
  has_streams: boolean
}

export type FeedbackScope = 'activity' | 'block'

export interface Feedback {
  id: number
  scope: FeedbackScope
  ref: string
  text: string
  created_at: string
}

export interface PlanSession {
  day: string
  type: string
  duration_min: number
  intensity: string
  description: string
}

export interface PlanWeek {
  week: number
  theme: string
  target_hours: number
  sessions: PlanSession[]
}

export interface PlanBlock {
  name: string
  focus: string
  weeks: PlanWeek[]
}

export interface Plan {
  id: number
  name: string
  focus: string
  weeks: PlanWeek[]
  created_at: string
  active: boolean
}

/* ------------------------------------------------------------------ */
/* Derived analysis                                                     */
/* ------------------------------------------------------------------ */

export interface PmcPoint {
  date: string
  tss: number
  /** 42-day trailing mean of daily TSS. */
  fitness: number
  /** 7-day trailing mean of daily TSS. */
  fatigue: number
  /** fitness - fatigue */
  form: number
}

export interface WeeklyLoad {
  /** Monday of the week, ISO date. */
  week_start: string
  tss: number
  hours: number
  activities: number
  /** True when at least one activity that week had no power data, so the bar understates the week. */
  incomplete: boolean
}

export interface PowerCurvePoint {
  seconds: number
  watts: number
  /** Activity the best effort came from. */
  activity_id: number
  date: string
}

export interface PowerCurve {
  label: string
  from: string
  to: string
  points: PowerCurvePoint[]
  /** Activities with streams inside the window. */
  sample_size: number
}

export interface QuarterSplit {
  quarter: 1 | 2 | 3 | 4
  normalized_power: number | null
  avg_hr: number | null
  avg_cadence: number | null
  coasting_pct: number | null
}

export interface ClimbEffort {
  index: number
  start_second: number
  duration_s: number
  avg_grade_pct: number
  elevation_gain_m: number
  avg_power: number | null
  avg_cadence: number | null
  avg_speed_kmh: number | null
  /** Share of this climb spent within 3% of the lowest gear ratio seen on the ride. */
  lowest_gear_pct: number | null
}

export interface GearingSummary {
  lowest_ratio: number | null
  highest_ratio: number | null
  /** Percentage of time above 3% grade spent in (or within 3% of) the lowest ratio observed. */
  steep_time_in_lowest_gear_pct: number | null
  steep_seconds: number
  assumed_wheel_circumference_m: number
}

export interface Decoupling {
  first_half_np: number | null
  first_half_hr: number | null
  second_half_np: number | null
  second_half_hr: number | null
  /** Percentage drift of the NP:HR ratio, second half against first. */
  drift_pct: number | null
}

export interface BestEfforts {
  s5: number | null
  s60: number | null
  s300: number | null
  s1200: number | null
  s3600: number | null
}

export interface Fuelling {
  kj: number | null
  kj_basis: 'stream' | 'logged' | 'estimated' | null
  duration_hours: number
  carb_target_g: number
  /** kJ covered by the 90 g/h target, assuming 4 kcal/g and 1 kcal = 4.184 kJ. */
  carb_target_kj: number
}

export interface ActivityAnalysis {
  activity: ActivityRow
  ftp: number | null
  has_streams: boolean
  variability_index: number | null
  intensity_factor: number | null
  tss: number | null
  tss_basis: 'measured' | 'estimated' | null
  decoupling: Decoupling | null
  quarters: QuarterSplit[] | null
  climbs: ClimbEffort[] | null
  gearing: GearingSummary | null
  best_efforts: BestEfforts | null
  fuelling: Fuelling
  /** Things the analysis could not compute, and why. Shown in the UI, sent to the model. */
  gaps: string[]
}

export interface BlockAnalysis {
  from: string
  to: string
  days: number
  activities: ActivityAnalysis[]
  total_tss: number
  total_hours: number
  total_distance_km: number
  ride_count: number
  rest_days: number
  weekly: WeeklyLoad[]
  gaps: string[]
}

export interface DashboardSummary {
  next_race: (Race & { days_away: number }) | null
  upcoming_races: (Race & { days_away: number })[]
  activity_count: number
  avg_weekly_tss_4w: number | null
  fitness: number | null
  fatigue: number | null
  form: number | null
  activities_missing_power: number
  ftp: number | null
  weekly_hours_target: number | null
}
