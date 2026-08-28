import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api'

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
})

// ─── Request interceptor: attach JWT ─────────────────────────────────────────
api.interceptors.request.use(config => {
  const token = localStorage.getItem('cardiosense_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ─── Response interceptor: handle 401 ────────────────────────────────────────
// Auth endpoints (login/register) return 401/409 on bad credentials — that's
// an expected, in-place error the caller (AuthContext/LoginPage) must
// display, not a session expiry. Only force a redirect when an *authenticated*
// request's session has gone stale.
const AUTH_ENDPOINTS = ['/auth/login', '/auth/register']

api.interceptors.response.use(
  res => res,
  err => {
    const url = err.config?.url ?? ''
    const isAuthEndpoint = AUTH_ENDPOINTS.some(p => url.includes(p))
    if (err.response?.status === 401 && !isAuthEndpoint) {
      localStorage.removeItem('cardiosense_token')
      localStorage.removeItem('cardiosense_user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)

export default api
