import { isAxiosError } from 'axios'
import { api } from './api'

// Y3.1A-FIX1's corrected retrieval architecture, implemented exactly as
// frozen (Y3.1B §22): every call here goes through the SAME shared,
// authenticated `api` Axios instance every other service in this app uses —
// no bare axios, no custom auth logic, no token in a query param or URL.
// That is what makes this transport automatically inherit the Bearer-header
// attachment and the coordinated single-flight 401-refresh-retry-once
// behavior (services/api.ts) with zero avatar-specific code duplicating any
// of it.

export interface AvatarUploadResponse {
  avatar: { updatedAt: string } | null
}

export const avatarService = {
  // GET /users/me/avatar as an authenticated Blob (never a plain <img src>
  // — see Y3.1A-FIX1 for why that cannot work under Y5.2's in-memory-token
  // model). A 404 NO_AVATAR is the ordinary "no avatar yet" steady state,
  // not an error condition — mapped to `null` here so callers (AvatarContext)
  // never need to special-case that status code themselves. Any OTHER
  // failure (network, 401 exhausted after refresh, 5xx) propagates as a
  // normal rejected promise, same as every other service in this app.
  async getMyAvatar(): Promise<Blob | null> {
    try {
      const { data } = await api.get<Blob>('/users/me/avatar', { responseType: 'blob' })
      return data
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 404) return null
      throw err
    }
  },

  // POST /users/me/avatar — multipart/form-data, field name `avatar`
  // (must match the backend's `avatarUpload.single('avatar')`). Returns the
  // new metadata only; the caller is responsible for merging it into
  // AuthContext via setUser (ProfileSettings.tsx) — this service never
  // touches auth state itself, same separation every other service in this
  // app already keeps.
  async uploadMyAvatar(file: File): Promise<AvatarUploadResponse> {
    const formData = new FormData()
    formData.append('avatar', file)
    const { data } = await api.post<AvatarUploadResponse>('/users/me/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },

  // DELETE /users/me/avatar — idempotent server-side; always resolves with
  // `{avatar: null}` on success, including when no avatar existed.
  async deleteMyAvatar(): Promise<AvatarUploadResponse> {
    const { data } = await api.delete<AvatarUploadResponse>('/users/me/avatar')
    return data
  },
}
