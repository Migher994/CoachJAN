export type Theme = 'system' | 'light' | 'dark'

const KEY = 'coachjan.theme'

export function readTheme(): Theme {
  const stored = localStorage.getItem(KEY)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') {
    root.removeAttribute('data-theme')
    localStorage.removeItem(KEY)
  } else {
    root.setAttribute('data-theme', theme)
    localStorage.setItem(KEY, theme)
  }
}
