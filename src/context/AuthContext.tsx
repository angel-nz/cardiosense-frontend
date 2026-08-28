import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import type { User, AuthState } from '@/types'
import { authService } from '@/services/authService'

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  setUser: (user: User) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const TOKEN_KEY = 'cardiosense_token'
const USER_KEY = 'cardiosense_user'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: true,
  })

  // Hydrate from localStorage on mount, then confirm/refresh via GET /api/auth/me
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)

    if (!token) {
      setState(s => ({ ...s, isLoading: false }))
      return
    }

    // Optimistic hydrate from cache so the UI doesn't flash the login screen
    // while GET /api/auth/me confirms the session.
    const cachedUserJson = localStorage.getItem(USER_KEY)
    if (cachedUserJson) {
      try {
        const cachedUser = JSON.parse(cachedUserJson) as User
        setState({ user: cachedUser, token, isAuthenticated: true, isLoading: true })
      } catch {
        // ignore malformed cache, fall through to backend confirmation
      }
    }

    authService.getCurrentUser()
      .then(user => {
        localStorage.setItem(USER_KEY, JSON.stringify(user))
        setState({ user, token, isAuthenticated: true, isLoading: false })
      })
      .catch(() => {
        // Token invalid/expired — clear session, let ProtectedRoute redirect
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(USER_KEY)
        setState({ user: null, token: null, isAuthenticated: false, isLoading: false })
      })
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const { token, user } = await authService.login({ email, password })

    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))

    setState({ user, token, isAuthenticated: true, isLoading: false })
  }, [])

  const logout = useCallback(() => {
    // Backend exposes POST /api/auth/logout, but it operates on a
    // refreshToken that this block's contract (token + user only) does not
    // persist — refresh-token rotation is out of scope here. Logout stays
    // client-side: clear the session state, matching the existing strategy.
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setState({ user: null, token: null, isAuthenticated: false, isLoading: false })
  }, [])

  const setUser = useCallback((user: User) => {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
    setState(s => ({ ...s, user }))
  }, [])

  return (
    <AuthContext.Provider value={{ ...state, login, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
