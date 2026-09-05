import { api } from './api'
import type { User, UpdateUserRequest } from '@/types'

// ─── Backend wire shape ───────────────────────────────────────────────────
// PATCH /api/users/:id response (user.routes.ts) — note this is a SMALLER
// shape than the login/me response: no createdAt, no isActive, only
// updatedAt. Callers must merge this into the existing user, not replace it
// wholesale, or those fields would be lost.
interface BackendUserPatchResponse {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  updatedAt: string
  medico?: { id: string; especialidad: string | null; hospital: string | null } | null
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
      medico: data.medico ? {
        id: data.medico.id,
        especialidad: data.medico.especialidad ?? undefined,
        hospital: data.medico.hospital ?? undefined,
      } : undefined,
    }
  },
}
