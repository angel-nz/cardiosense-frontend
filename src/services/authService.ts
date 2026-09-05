import { api } from './api'
import type { LoginRequest, LoginResponse, RegisterRequest, User, UserRole } from '@/types'

// ─── Backend wire shapes ──────────────────────────────────────────────────
// The backend (auth.service.ts) currently returns { user, accessToken,
// refreshToken } — not the canonical { token, user } contract — and role as
// an uppercase enum ('MEDICO' | 'ADMIN'). We normalize at this boundary so
// the rest of the frontend only ever sees the contractual LoginResponse/User
// shape, per Matriz de Integración v1.0 (no accessToken leaking upward).
interface BackendUser {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  isActive: boolean
  createdAt: string
  medico?: { id: string; especialidad: string | null; hospital: string | null } | null
}

interface BackendAuthPayload {
  user: BackendUser
  accessToken: string
  refreshToken: string
}

function normalizeUser(u: BackendUser): User {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role.toLowerCase() as UserRole,
    createdAt: u.createdAt,
    medico: u.medico ? {
      id: u.medico.id,
      especialidad: u.medico.especialidad ?? undefined,
      hospital: u.medico.hospital ?? undefined,
    } : undefined,
  }
}

export const authService = {
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const { data } = await api.post<BackendAuthPayload>('/auth/login', credentials)
    return { token: data.accessToken, user: normalizeUser(data.user) }
  },

  async getCurrentUser(): Promise<User> {
    const { data } = await api.get<BackendUser>('/auth/me')
    return normalizeUser(data)
  },

  // POST /api/auth/register — backend endpoint exists and is operative.
  // No RegisterPage exists in the frontend yet (out of scope for this
  // block: only existing screens are integrated), so this is exposed at
  // the service layer for a future block/UI to consume.
  async register(payload: RegisterRequest): Promise<LoginResponse> {
    const { data } = await api.post<BackendAuthPayload>('/auth/register', payload)
    return { token: data.accessToken, user: normalizeUser(data.user) }
  },
}
