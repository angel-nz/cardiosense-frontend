import { api } from './api'

// ─── Backend wire contract ─────────────────────────────────────────────────
// GET /api/users/me/data-export (Bloque Y7B). Scoped to the authenticated
// user server-side (req.user.sub) — no id/email/etc. is ever sent from here.
// Self-service account/profile/preference export only — see Y7A/Y7A-FIX1 for
// the full field-by-field contract. This service does not parse the response
// body itself: the download flow (PrivacyDataSettings.tsx) only needs the raw
// Blob to hand to the browser, never the parsed JSON, so there is no
// `DataExportResponse` type here (Y7B §34's stated preference — the service
// returns a Blob, not a typed document interface).
export const privacyService = {
  // `responseType: 'blob'` — this is a file download, not a JSON call the
  // rest of the app reads programmatically. Routed through the same shared
  // `api` instance every other authenticated call uses (never a separate
  // fetch/window.location), so it gets the existing Bearer-token attachment
  // and single-flight 401-refresh-and-retry-once behavior for free — this
  // endpoint is deliberately NOT added to AUTH_ENDPOINTS in api.ts, since it
  // is an ordinary authenticated read, not an auth endpoint.
  async downloadMyDataExport(): Promise<Blob> {
    const { data } = await api.get<Blob>('/users/me/data-export', {
      responseType: 'blob',
    })
    return data
  },
}
