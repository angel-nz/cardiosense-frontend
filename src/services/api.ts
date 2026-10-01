import axios, { isAxiosError, type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { getAccessToken, clearAccessToken } from '@/lib/tokenStore'
import { coordinateRefresh, handleSessionExpired } from '@/lib/refreshCoordinator'

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api'

// Y5.2 — `withCredentials: true` so the browser attaches/accepts the
// HttpOnly `cardiosense_refresh` cookie on every request/response to this
// API. The access token itself never travels as a cookie — only via the
// Authorization header, attached below from in-memory storage.
export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

// ─── Request interceptor: attach the access token from memory ────────────
api.interceptors.request.use(config => {
  const token = getAccessToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ─── Response interceptor: 401 handling ──────────────────────────────────
// Auth endpoints (login/register/refresh) are the auth machinery itself —
// a 401 from one of these is either an expected in-place error (bad
// credentials on login/register — the caller displays it directly) or the
// refresh flow's own terminal failure. None of them may ever recurse back
// into the refresh-and-retry logic below (Y5.2 §"/auth/login,
// /auth/register,/auth/refresh must never recursively trigger
// auto-refresh").
//
// Y8D2b — `/auth/logout` is deliberately NOT in this list (it used to be).
// Logout's session identity now comes from the access JWT's own `sid`
// (backend auth.service.ts), so an expired/missing access token at logout
// time must recover via the SAME refresh-and-retry path every other
// protected endpoint already uses — excluding it here would make a logout
// attempted with an expired access token fail outright instead of
// transparently refreshing first (Y8C-R2 §9/§12).
const AUTH_ENDPOINTS = ['/auth/login', '/auth/register', '/auth/refresh']

// Y5.1 §9, preserved EXACTLY as before — PATCH /users/me/password
// intentionally returns 401 INVALID_CURRENT_PASSWORD when the supplied
// current password doesn't match. That is an in-place field error
// SecuritySettings shows inline — the caller's access token is still
// perfectly valid, so it must NOT trigger refresh/logout. This is the
// NARROWEST possible exception: only this endpoint AND only this exact
// structured code. A GENERIC 401 from this SAME endpoint (an actually
// expired/invalid access token) deliberately does NOT match this check and
// falls through to the normal refresh-and-retry flow below, exactly like
// any other protected endpoint (Y5.2 §"a generic 401 from the same password
// endpoint DOES follow normal refresh/session recovery under Y5.2").
const PASSWORD_ENDPOINT = '/users/me/password'
const INVALID_CURRENT_PASSWORD_CODE = 'INVALID_CURRENT_PASSWORD'

// Y8D4 — the cross-tab logout signal (CROSS_TAB_LOGOUT_KEY/broadcastLogout)
// and the single-flight refresh coordination that used to live here
// (refreshPromise/performRefresh/coordinatedRefresh) both moved to
// lib/refreshCoordinator.ts, which is now the ONE shared implementation
// used by this file, AuthContext.tsx, and SocketContext.tsx alike — see
// that module for the full single-flight/Web-Locks/cross-tab-conflict
// design. handleSessionExpired moved there too (still exported from there
// for this file's own retry-exhausted guard below, and re-used internally
// by the coordinator's own TERMINAL handling).

// Y5.2 — augments axios's own request-config type with a private marker
// field (rather than a separate side-table keyed by request identity) so
// the retry-once guard survives exactly as long as the request it belongs
// to and needs no cleanup of its own.
declare module 'axios' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface InternalAxiosRequestConfig {
    _y52RetriedAfterRefresh?: boolean
  }
}

api.interceptors.response.use(
  res => res,
  async (err: AxiosError) => {
    if (!isAxiosError(err)) return Promise.reject(err)

    const config = err.config
    const url = config?.url ?? ''
    const status = err.response?.status
    const isAuthEndpoint = AUTH_ENDPOINTS.some(p => url.includes(p))

    const isWrongCurrentPassword =
      status === 401 &&
      url.includes(PASSWORD_ENDPOINT) &&
      (err.response?.data as { code?: string } | undefined)?.code === INVALID_CURRENT_PASSWORD_CODE

    if (status !== 401 || isAuthEndpoint || isWrongCurrentPassword || !config) {
      return Promise.reject(err)
    }

    // Retry-once guard: a request that already went through one
    // refresh-and-retry cycle and STILL got a 401 has a genuinely dead
    // session (or the newly-issued token was rejected for some other
    // reason) — it must not retry forever. This short-circuits straight to
    // terminal handling WITHOUT invoking the coordinator again (Y8D4 §21 —
    // "avoid triggering terminal handling more than once for one same-tab
    // burst"; this is a different, later trigger than the coordinator's own
    // TERMINAL outcome below, not a duplicate of it).
    if (config._y52RetriedAfterRefresh) {
      clearAccessToken()
      handleSessionExpired()
      return Promise.reject(err)
    }

    // Y8D4 §24 — API interceptor integration via the shared coordinator.
    const outcome = await coordinateRefresh()

    if (outcome.status === 'SUCCESS') {
      config._y52RetriedAfterRefresh = true
      config.headers = config.headers ?? ({} as InternalAxiosRequestConfig['headers'])
      config.headers.Authorization = `Bearer ${outcome.accessToken}`
      return api(config)
    }

    if (outcome.status === 'TERMINAL') {
      // The coordinator already cleared the in-memory token (see
      // lib/refreshCoordinator.ts's TERMINAL branch); this caller is the
      // one responsible for the cross-tab broadcast + navigation for this
      // scenario (protected-request 401 recovery) — preserves the exact
      // pre-Y8D4 behavior for this path.
      handleSessionExpired()
      return Promise.reject(err)
    }

    // TRANSIENT or EXHAUSTED (Y8D4 §22/§23) — reject the original request
    // so the caller can fail/retry naturally, but do NOT terminal-logout:
    // an operational hiccup or an unresolved multi-tab race is not a
    // statement that the session itself is invalid.
    return Promise.reject(err)
  },
)

export default api
