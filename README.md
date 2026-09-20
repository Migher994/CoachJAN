# CoachJan

A local-first training tracker for one road cyclist racing a season. It keeps the
season's races, the training behind them, and two Claude-backed features: written
feedback on recent work, and a generated training block for the weeks ahead.

Single user, runs on your own machine. Nothing leaves it except the training
summaries the two coach features send to Anthropic.

## Running it

```shell
npm install
cp .env.example .env     # add ANTHROPIC_API_KEY for the coach features
npm run dev
```

`npm run dev` starts both halves: the Express API on port 5174 and the Vite client
on port 5173. Open http://localhost:5173.

The two coach features and the paste parser need `ANTHROPIC_API_KEY`. Everything
else works without it, and the UI says so where a feature is unavailable rather
than failing silently.

## Where the data lives

SQLite, at `data/coachjan.db` by default (override with `DB_PATH`). Uploaded FIT
files are kept in `uploads/` so a ride can be re-read later. Both are gitignored.
Nothing is kept in browser storage, so the database file is the whole system of
record: back it up and you have backed up everything.

## What is in it

**Dashboard.** Countdown to the next race, the rolling load figures, weekly load
over twelve weeks, a power trend across recent activities, a power duration curve
built from uploaded FIT files, and the recent activity and race lists.

**Log.** Three ways to add a ride: upload a FIT file, paste a summary from Strava
or TrainingPeaks and have Claude turn it into fields, or type it in. The first two
show you what was read and wait for you to confirm before anything is saved.

**Feedback.** Pick the latest activity, a specific activity, the last 7 days or the
last 14. The server computes the derived metrics, sends them to Claude and streams
the answer back as it is written. Feedback can be saved, and the planning coach
reads the most recent saved note.

**Plan.** Generates the next three or four weeks from your profile, races, recent
training and last saved feedback. There is also a free-text box for one-off
planning questions with the same context loaded.

**Races** and **Settings** cover the calendar and the rider profile.

## How the numbers are computed

Training load is `duration_hours × (NP / FTP)² × 100` where normalized power
exists, falling back to average power. Which of the two was used is shown
everywhere the number appears: rides without any power contribute nothing, and the
UI says how many those are rather than quietly dropping them.

Fitness is the 42-day trailing mean of daily TSS, fatigue the 7-day mean, form the
difference. Days without riding count as zero, which is what makes the two
comparable.

Uploaded FIT files are resampled to a dense 1 Hz grid and stored as one gzipped
blob per activity. Seconds filled across a recording gap are flagged as not
moving, so stopped time is excluded from the analysis instead of being counted as
coasting. From that grid the app derives:

- normalized power, and best power at 5s, 1min, 5min, 20min and 60min
- heart rate decoupling: the NP-to-HR ratio of the first half against the second
- quarter splits: NP, heart rate, pedalling cadence and coasting share
- sustained climbs: above 3% grade for 90 seconds or more, listed in the order
  ridden, with power and cadence for each, so fade across a ride is visible
- gearing: the gear ratio implied by speed and cadence, and how much of the steep
  climbing was spent in the lowest gear used, which is what tells you whether you
  ran out of gears

Grade comes from the file when it carries one, otherwise from smoothed altitude
over a trailing 30 m of distance. Gear ratios assume a 2.105 m wheel
circumference, and only gears actually used are visible in the data, so "lowest
gear" means the lowest one used on that ride.

Where an input is missing the app returns nothing rather than a guess, and says
what is missing. No chart is filled with invented data.

## Layout

```
server/         Express API
  db.ts         SQLite schema and connection
  lib/
    metrics.ts  the maths: load, rolling means, NP, decoupling, climbs, gearing
    analysis.ts assembles stored rows and stream maths into API shapes
    streams.ts  gzipped 1 Hz stream storage
    fit.ts      FIT decoding and resampling
    claude.ts   the only place the Anthropic SDK is called
    prompts.ts  prompt construction and the rendered metric reports
  routes/       one router per area
src/            React client
shared/types.ts types used by both halves
```

## Not in this version

Automated import from Strava or intervals.icu. FIT upload and the paste parser
cover the same ground for now.
