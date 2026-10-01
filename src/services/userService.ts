import { api } from './api'
import { normalizeMedico } from '@/lib/normalizeUser'
import type { User, UpdateUserRequest } from '@/types'

// ─── Backend wire shape ───────────────────────────────────────────────────
// PATCH /api/users/:id response (user.routes.ts) — note this is a SMALLER
// shape than the login/me response: no createdAt, no isActive, only
// updatedAt. Callers must merge this into the existing user, not replace it
// wholesale, or those fields would be lost.
//
// Y3 — this route/function is no longer called from anywhere in the
// frontend (Settings now uses profileService's /users/me/profile instead),
// but the backend route remains operational per Y3 §30 and this file is
// kept for type consistency (Y3 §14) rather than deleted. `cedulaProfesional`
// added here too, and the medico mapping now uses the shared normalizer, so
// this orphaned function still produces the same one-true User shape if
// anything ever calls it again.
interface BackendUserPatchResponse {
  id: string
  // Z6-R1 — nullable, matching every other User.email wire-shape in this
  // codebase now (see types/index.ts's own comment on User.email).
  email: string | null
  firstName: string
  lastName: string
  role: string
  updatedAt: string
  medico?: { id: string; cedulaProfesional: string | null; especialidad: string | null; hospital: string | null } | null
}

export const userService = {
  // PATCH /api/users/:id — ownership is enforced server-side (req.user.sub
  // must equal :id, or role ADMIN); the id passed here should always be the
  // authenticated user's own id (AuthContext.user.id), never an arbitrary one.
  async updateProfile(userId: string, payload: UpdateUserRequest): Promise<Partial<User>> {
    const { data } = await api.patch<BackendUserPatchResponse>(`/users/${userId}`, payload)
    return {
      id: data.id,
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      role: data.role.toLowerCase() as User['role'],
      medico: normalizeMedico(data.medico),
    }
  },
}
