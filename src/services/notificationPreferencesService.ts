import { api } from './api'
import type { NotificationPreferences } from '@/types'

// ─── Backend wire shape ───────────────────────────────────────────────────
// GET/PATCH /api/users/me/notification-preferences (Bloque N-B, rebuilt in
// Y4). Scoped to the authenticated user server-side (req.user.sub) — no id
// is ever sent from here. `updatedAt` is null when the user has never saved
// preferences and the backend is returning schema defaults.
//
// Y4 — old `highRiskAlerts`/`weeklySummary` fields are gone from this
// contract entirely, not kept as optional aliases: the old Settings UI that
// read them is already gone (retired in Y2), so nothing in the frontend
// still depends on the old shape.
interface BackendNotificationPreferences {
  highRiskRealtime: boolean
  moderateRiskRealtime: boolean
  anomalyRealtime: boolean
  // Z5 — three additional realtime toggles, same wire shape/casing as the
  // three above (no uppercase/lowercase remapping needed for any of these
  // six — unlike AlertSeverity, NotificationPreference's booleans are sent
  // with identical casing on both sides).
  //
  // Z6-R2 §5 — the doctor-profile realtime toggle REMOVED: the one event it
  // gated no longer exists as a product decision.
  patientCreatedRealtime: boolean
  patientUpdatedRealtime: boolean
  healthRecordCreatedRealtime: boolean
  updatedAt: string | null
}

function normalize(data: BackendNotificationPreferences): NotificationPreferences {
  return {
    highRiskRealtime: data.highRiskRealtime,
    moderateRiskRealtime: data.moderateRiskRealtime,
    anomalyRealtime: data.anomalyRealtime,
    patientCreatedRealtime: data.patientCreatedRealtime,
    patientUpdatedRealtime: data.patientUpdatedRealtime,
    healthRecordCreatedRealtime: data.healthRecordCreatedRealtime,
  }
}

export const notificationPreferencesService = {
  async getMyNotificationPreferences(): Promise<NotificationPreferences> {
    const { data } = await api.get<BackendNotificationPreferences>(
      '/users/me/notification-preferences',
    )
    return normalize(data)
  },

  // Partial update — all six fields optional; the backend rejects any
  // other key (Zod .strict()), including the obsolete highRiskAlerts/
  // weeklySummary/doctor-profile-realtime-toggle names.
  async updateMyNotificationPreferences(
    payload: Partial<NotificationPreferences>,
  ): Promise<NotificationPreferences> {
    const { data } = await api.patch<BackendNotificationPreferences>(
      '/users/me/notification-preferences',
      payload,
    )
    return normalize(data)
  },
}
