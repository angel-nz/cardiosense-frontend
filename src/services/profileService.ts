import { api } from './api'
import { normalizeMedico, normalizeAvatar } from '@/lib/normalizeUser'
import type { ProfileMyUpdateRequest, User } from '@/types'

// ─── Backend wire shape ───────────────────────────────────────────────────
// GET/PATCH /api/users/me/profile (Bloque Y3). Scoped to the authenticated
// user server-side (req.user.sub) — no id is ever sent from here. `medico`
// is nested here exactly the way login/register/GET /auth/me/PATCH
// /users/:id already shape it, so the same shared normalizer applies to all
// of them (Y3 §14 — one User shape regardless of source).
interface BackendProfileResponse {
  id: string
  // Z6-R1 — nullable: a phone-only doctor has no email at all (see
  // User.email's own comment in types/index.ts).
  email: string | null
  firstName: string
  lastName: string
  role: string
  updatedAt?: string
  medico: { id: string; cedulaProfesional: string | null; especialidad: string | null; hospital: string | null; phone: string | null } | null
  // Y3.1B §19 — both GET and PATCH /users/me/profile now include this.
  avatar: { updatedAt: string } | null
}

// GET/PATCH /users/me/profile does not return `createdAt` — it isn't part of
// this contract's editable-or-displayed fields, and the backend genuinely
// doesn't send it (see user.routes.ts's `select`). Rather than fabricate a
// value, this service returns everything the backend actually said and lets
// the caller (ProfileSettings.tsx) merge it into the existing AuthContext
// user — which already has a real `createdAt` from login/GET /auth/me — so
// no field is ever invented and none is lost.
export type ProfileFields = Omit<User, 'createdAt'>

function normalizeProfile(data: BackendProfileResponse): ProfileFields {
  return {
    id: data.id,
    email: data.email,
    firstName: data.firstName,
    lastName: data.lastName,
    role: data.role.toLowerCase() as User['role'],
    medico: normalizeMedico(data.medico),
    avatar: normalizeAvatar(data.avatar),
  }
}

export const profileService = {
  async getMyProfile(): Promise<ProfileFields> {
    const { data } = await api.get<BackendProfileResponse>('/users/me/profile')
    return normalizeProfile(data)
  },

  // Partial update — every field optional; the backend rejects any other key
  // (Zod .strict()). A null value for cedulaProfesional/especialidad/hospital
  // explicitly clears that field server-side; an omitted key leaves it
  // untouched.
  async updateMyProfile(payload: ProfileMyUpdateRequest): Promise<ProfileFields> {
    const { data } = await api.patch<BackendProfileResponse>('/users/me/profile', payload)
    return normalizeProfile(data)
  },
}
