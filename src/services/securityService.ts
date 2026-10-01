import { api } from './api'
import type { Session, RevokeSessionResponse } from '@/types'

// Y5.1 — PATCH /users/me/password. Identity is derived server-side from the
// access JWT (req.user.sub) — no id/email/userId is ever sent from here.
// confirmPassword is frontend-only validation (SecuritySettings.tsx) and is
// deliberately never included in this payload (Y5.1 §4/§20).
export interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
}

// Y5.3 — extends the existing Y5.1 securityService rather than creating a
// second, overlapping account-security service (per this block's own
// preference). All three methods use the shared authenticated `api` axios
// instance exactly like changePassword above — no manual cookie/token
// handling here; Y5.2's interceptors/withCredentials already cover it.
export const securityService = {
  async changePassword(payload: ChangePasswordRequest): Promise<void> {
    await api.patch('/users/me/password', payload)
  },

  // GET /users/me/sessions — identity via req.user.sub server-side; no
  // params needed. Returns the exact flat array the backend sends (see
  // types/index.ts's Session for the field-by-field contract match).
  async getSessions(): Promise<Session[]> {
    const { data } = await api.get<Session[]>('/users/me/sessions')
    return data
  },

  // DELETE /users/me/sessions/:sessionId — revokes one specific session.
  // `currentRevoked` in the response tells the caller whether this was the
  // browser's own current session (backend already cleared the refresh
  // cookie in that case) — SecuritySettings.tsx branches on this, not on
  // its own local copy of `session.current`, since the backend's answer at
  // the moment of deletion is the only one that can't be stale.
  async revokeSession(sessionId: string): Promise<RevokeSessionResponse> {
    const { data } = await api.delete<RevokeSessionResponse>(`/users/me/sessions/${sessionId}`)
    return data
  },

  // DELETE /users/me/sessions/others — bulk-revokes every session except
  // the caller's current one, preserved server-side. Never looped
  // client-side over individual DELETEs (this block's explicit
  // requirement) — one real request for the whole operation.
  async revokeOtherSessions(): Promise<void> {
    await api.delete('/users/me/sessions/others')
  },
}
