import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const dbPath = resolve(process.env.DB_PATH ?? './data/season.db')
mkdirSync(dirname(dbPath), { recursive: true })

export const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS profile (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  ftp                 INTEGER,
  weight_kg           REAL,
  weekly_hours_target REAL,
  max_hr              INTEGER,
  notes               TEXT,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS race (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  date         TEXT NOT NULL,
  priority     TEXT NOT NULL CHECK (priority IN ('A','B','C')),
  course_notes TEXT,
  result_notes TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS race_date_idx ON race(date);

CREATE TABLE IF NOT EXISTS activity (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
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

-- One row per activity. Channels are stored as a single gzipped JSON blob of
-- parallel 1 Hz arrays, which keeps a four hour ride at a few hundred kB and
-- still gives the derived analysis random access to every channel.
CREATE TABLE IF NOT EXISTS activity_stream (
  activity_id INTEGER PRIMARY KEY REFERENCES activity(id) ON DELETE CASCADE,
  n_points    INTEGER NOT NULL,
  channels    TEXT NOT NULL,
  data        BLOB NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  scope      TEXT NOT NULL CHECK (scope IN ('activity','block')),
  ref        TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_created_idx ON feedback(created_at);

CREATE TABLE IF NOT EXISTS plan (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  focus      TEXT NOT NULL,
  weeks      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO profile (id, ftp, weight_kg, weekly_hours_target, max_hr, notes, updated_at)
VALUES (1, NULL, NULL, 5, NULL, NULL, datetime('now'));
`)

export function nowIso(): string {
  return new Date().toISOString()
}
