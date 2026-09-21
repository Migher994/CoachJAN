import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { User } from '../../shared/types'
import { api, onUnauthorized } from './api'

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    onUnauthorized(() => setUser(null))
  }, [])

  useEffect(() => {
    let live = true
    api.auth
      .me()
      .then((u) => {
        if (live) setUser(u)
      })
      .catch(() => {
        if (live) setUser(null)
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [])

  const login = async (email: string, password: string) => {
    const u = await api.auth.login(email, password)
    setUser(u)
  }

  const logout = async () => {
    await api.auth.logout()
    setUser(null)
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider.')
  return ctx
}
