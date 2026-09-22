import 'dotenv/config'
import { Pool, type QueryResultRow } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  // A bad DATABASE_URL (wrong Cloud SQL socket, missing --add-cloudsql-instances,
  // a stray newline in the secret) should fail fast and loudly on startup rather
  // than hang until Cloud Run's own health-check timeout gives up.
  connectionTimeoutMillis: 10_000,
})

/** Turns `?` placeholders into Postgres's `$1, $2, ...`. */
function toPgSql(sql: string): string {
  let i = 0
  return sql.replace(/\?/g, () => `$${++i}`)
}

export interface RunResult {
  changes: number
  lastInsertRowid: number | undefined
}

function makeRunner(query: <T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }>) {
  return {
    async get<T extends QueryResultRow = QueryResultRow>(sql: string, ...params: unknown[]): Promise<T | undefined> {
      const result = await query<T>(toPgSql(sql), params)
      return result.rows[0]
    },
    async all<T extends QueryResultRow = QueryResultRow>(sql: string, ...params: unknown[]): Promise<T[]> {
      const result = await query<T>(toPgSql(sql), params)
      return result.rows
    },
    async run(sql: string, ...params: unknown[]): Promise<RunResult> {
      const result = await query<{ id: number }>(toPgSql(sql), params)
      return {
        changes: result.rowCount ?? 0,
        lastInsertRowid: /returning\s+id/i.test(sql) ? result.rows[0]?.id : undefined,
      }
    },
  }
}

export const db = makeRunner((sql, params) => pool.query(sql, params))

/**
 * Runs `fn` against a single checked-out client wrapped in BEGIN/COMMIT, so a
 * caller that needs several statements to succeed or fail together (see
 * plans.ts activate) can get the same `get`/`all`/`run` shape as `db`.
 */
export async function withTransaction<T>(fn: (trx: ReturnType<typeof makeRunner>) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const trx = makeRunner((sql, params) => client.query(sql, params))
    const value = await fn(trx)
    await client.query('COMMIT')
    return value
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export function nowIso(): string {
  return new Date().toISOString()
}

export async function migrate(): Promise<void> {
  await pool.query(`
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile (
  user_id             INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ftp                 INTEGER,
  weight_kg           REAL,
  weekly_hours_target REAL,
  max_hr              INTEGER,
  notes               TEXT,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS race (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  date         TEXT NOT NULL,
  priority     TEXT NOT NULL CHECK (priority IN ('A','B','C')),
  course_notes TEXT,
  result_notes TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS race_date_idx ON race(date);
CREATE INDEX IF NOT EXISTS race_user_idx ON race(user_id);

CREATE TABLE IF NOT EXISTS activity (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date             TEXT NOT NULL,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('race','interval','endurance','recovery','commute','other')),
  duration_min     REAL NOT NULL,
  distance_km      REAL,
  elevation_m      REAL,
  avg_power        INTEGER,
  normalized_power INTEGER,
  max_power        INTEGER,
  avg_hr           INTEGER,
  max_hr           INTEGER,
  avg_cadence      INTEGER,
  kj               REAL,
  notes            TEXT,
  source           TEXT NOT NULL CHECK (source IN ('manual','pasted','fit')),
  raw_fit_path     TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_date_idx ON activity(date);
CREATE INDEX IF NOT EXISTS activity_user_idx ON activity(user_id);

-- One row per activity. Channels are stored as a single gzipped JSON blob of
-- parallel 1 Hz arrays, which keeps a four hour ride at a few hundred kB and
-- still gives the derived analysis random access to every channel.
CREATE TABLE IF NOT EXISTS activity_stream (
  activity_id INTEGER PRIMARY KEY REFERENCES activity(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  n_points    INTEGER NOT NULL,
  channels    TEXT NOT NULL,
  data        BYTEA NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_stream_user_idx ON activity_stream(user_id);

CREATE TABLE IF NOT EXISTS feedback (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope      TEXT NOT NULL CHECK (scope IN ('activity','block')),
  ref        TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_created_idx ON feedback(created_at);
CREATE INDEX IF NOT EXISTS feedback_user_idx ON feedback(user_id);

CREATE TABLE IF NOT EXISTS plan (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  focus      TEXT NOT NULL,
  weeks      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS plan_user_idx ON plan(user_id);
`)
}
