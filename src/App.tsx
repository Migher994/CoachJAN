import { useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import { ActivityDetail } from './pages/ActivityDetail'
import { Dashboard } from './pages/Dashboard'
import { FeedbackCoach } from './pages/FeedbackCoach'
import { Log } from './pages/Log'
import { Planner } from './pages/Planner'
import { Races } from './pages/Races'
import { Settings } from './pages/Settings'
import { applyTheme, readTheme, type Theme } from './lib/theme'

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/log', label: 'Log' },
  { to: '/coach', label: 'Feedback' },
  { to: '/plan', label: 'Plan' },
  { to: '/races', label: 'Races' },
  { to: '/settings', label: 'Settings' },
]

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme)
  const next: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
  const label: Record<Theme, string> = { system: 'Auto', light: 'Light', dark: 'Dark' }
  return (
    <button
      type="button"
      className="btn btn-sm"
      title="Switch between automatic, light and dark"
      onClick={() => {
        const value = next[theme]
        setTheme(value)
        applyTheme(value)
      }}
    >
      {label[theme]}
    </button>
  )
}

export default function App() {
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-rule bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-2.5">
          <span className="num shrink-0 text-[15px] font-semibold tracking-tight">Season</span>
          <nav className="-mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `shrink-0 rounded-[2px] px-2.5 py-1.5 text-[13px] ${
                    isActive
                      ? 'bg-accent-wash font-medium text-accent-ink'
                      : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-4 pb-16">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/log" element={<Log />} />
          <Route path="/coach" element={<FeedbackCoach />} />
          <Route path="/plan" element={<Planner />} />
          <Route path="/races" element={<Races />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/activity/:id" element={<ActivityDetail />} />
          <Route
            path="*"
            element={
              <p className="px-1 py-8 text-[13px] text-ink-2">
                That page does not exist. Use the navigation above.
              </p>
            }
          />
        </Routes>
      </main>
    </div>
  )
}
