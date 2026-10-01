import type { User, UserRole } from '@/types'

// Y8D4 — moved here from services/authService.ts (where it was a private,
// unexported function) so both authService.ts and lib/refreshCoordinator.ts
// can share the exact same backend-wire-shape → frontend-User mapping,
// without refreshCoordinator.ts (a `lib/` module used by services/api.ts,
// context/AuthContext.tsx, and context/SocketContext.tsx alike) needing to
// import anything from `services/authService.ts` — that import direction
// would risk a circular dependency once authService.ts itself is rewritten
// to call the coordinator (Y8D4 §27). `lib/` modules import from `lib/`
// only, never from `services/`, so this is the correct shared home.
//
// Y5.2 — the backend no longer returns `refreshToken` in the JSON body at
// all (it travels exclusively as the HttpOnly `cardiosense_refresh` cookie).
// This is the wire shape all four of login/register/refresh/GET /auth/me
// share (Y3.1B §19/§25 — all funnel through the backend's shared
// sanitizeUser()).
export interface BackendUser {
  id: string
  // Z6-R1 — nullable: a phone-only doctor has no email at all. The backend
  // never normalizes this to `undefined` (unlike Paciente.email) — see
  // User.email's own comment in types/index.ts.
  email: string | null
  firstName: string
  lastName: string
  role: string
  isActive: boolean
  createdAt: string
  medico?: { id: string; cedulaProfesional: string | null; especialidad: string | null; hospital: string | null; phone?: string | null } | null
  avatar?: { updatedAt: string } | null
}

export interface BackendAuthPayload {
  user: BackendUser
  accessToken: string
}

// Y3 — shared normalizer so the same backend `medico` wire-shape always
// produces the same frontend `User.medico` shape, regardless of whether
// the data came from login, register, GET /auth/me, PATCH /users/:id, or
// the new GET/PATCH /users/me/profile. Previously each service
// (authService, userService) duplicated this mapping inline and used
// `?? undefined` for especialidad/hospital; this now standardizes on
// `?? null`, matching what /users/me/profile actually speaks (Y3 §14 — one
// User shape must mean the same thing everywhere).
export function normalizeMedico(
  medico:
    | { id: string; cedulaProfesional?: string | null; especialidad?: string | null; hospital?: string | null; phone?: string | null }
    | null
    | undefined,
): User['medico'] {
  if (!medico) return undefined
  return {
    id: medico.id,
    cedulaProfesional: medico.cedulaProfesional ?? null,
    especialidad: medico.especialidad ?? null,
    hospital: medico.hospital ?? null,
    // Z6 — same `?? null` normalization as the three fields above.
    phone: medico.phone ?? null,
  }
}

// Y3.1B §21/§26 — same one-shared-mapping rationale as normalizeMedico
// above: authService.ts and profileService.ts both receive the identical
// `avatar: {updatedAt}|null` wire shape (Y3.1A-FIX1 §13) and would
// otherwise each duplicate this exact one-line mapping. `undefined` is
// treated the same as `null` (a backend response that omits the field
// entirely — should never happen post-Y3.1B, but this stays defensive
// rather than producing `undefined` on User.avatar, which the type does not
// allow).
export function normalizeAvatar(
  avatar: { updatedAt: string } | null | undefined,
): User['avatar'] {
  return avatar ? { updatedAt: avatar.updatedAt } : null
}

// Y8D4 — moved verbatim from services/authService.ts's private function of
// the same name (role.toLowerCase() cast, medico/avatar delegated to the
// two normalizers above). Behavior is byte-identical to the function it
// replaces; only its location and export-ability changed.
export function normalizeUser(u: BackendUser): User {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role.toLowerCase() as UserRole,
    createdAt: u.createdAt,
    medico: normalizeMedico(u.medico),
    avatar: normalizeAvatar(u.avatar),
  }
}
