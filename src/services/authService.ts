import { api } from './api'
import { normalizeUser, type BackendAuthPayload, type BackendUser } from '@/lib/normalizeUser'
import type { LoginRequest, LoginResponse, RegisterRequest, User } from '@/types'

// Y8D4 — the backend wire-shape interfaces (BackendUser/BackendAuthPayload)
// and normalizeUser() used to be private to this file. They moved to
// lib/normalizeUser.ts (unchanged in content) so lib/refreshCoordinator.ts
// could share the exact same mapping without this file becoming a
// dependency of that one (see refreshCoordinator.ts's own header comment
// for the full circular-dependency reasoning). Nothing about login/
// register/getCurrentUser below changed — they still return the same
// LoginResponse/User shapes as before.

export const authService = {
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const { data } = await api.post<BackendAuthPayload>('/auth/login', credentials)
    return { token: data.accessToken, user: normalizeUser(data.user) }
  },

  async getCurrentUser(): Promise<User> {
    const { data } = await api.get<BackendUser>('/auth/me')
    return normalizeUser(data)
  },

  // POST /api/auth/register.
  async register(payload: RegisterRequest): Promise<LoginResponse> {
    const { data } = await api.post<BackendAuthPayload>('/auth/register', payload)
    return { token: data.accessToken, user: normalizeUser(data.user) }
  },

  // Y8D4 — the independent `refresh()` bare-axios implementation that used
  // to live here was REMOVED, not merely rewritten: it was the second of
  // the two low-level `POST /auth/refresh` implementations Y8D4 §3
  // requires collapsing into one (lib/refreshCoordinator.ts is now that
  // one implementation). AuthContext.tsx's bootstrap effect — the only
  // caller of this method anywhere in the frontend (grep-confirmed) — now
  // calls the shared coordinator directly instead, per Y8D4 §26/§27
  // ("remove it if no caller remains"). No wrapper was kept here since
  // nothing outside AuthContext.tsx ever called this method.

  // Y5.2 — POST /api/auth/logout. No request body; idempotent server-side.
  // Uses the `api` instance (not bare axios) since a 401 here is harmless
  // and logout's own idempotent success response is what actually matters
  // — AuthContext.logout() clears local state unconditionally regardless of
  // this call's outcome (Y5.2 §"call backend logout, then unconditionally
  // clear memory state + socket regardless of network outcome").
  async logout(): Promise<void> {
    await api.post('/auth/logout')
  },
}
