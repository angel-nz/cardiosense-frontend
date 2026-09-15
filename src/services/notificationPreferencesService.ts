import { api } from './api'
import type { NotificationPreferences } from '@/types'

// ─── Backend wire shape ───────────────────────────────────────────────────
// GET/PATCH /api/users/me/notification-preferences. Scoped to the
// authenticated user server-side (req.user.sub) — no id is ever sent from
// here. `updatedAt` is null when the user has never saved preferences and
// the backend is returning schema defaults.
interface BackendNotificationPreferences {
  highRiskAlerts: boolean
  weeklySummary: boolean
  updatedAt: string | null
}

export const notificationPreferencesService = {
  async getPreferences(): Promise<NotificationPreferences> {
    const { data } = await api.get<BackendNotificationPreferences>(
      '/users/me/notification-preferences',
    )
    return {
      highRiskAlerts: data.highRiskAlerts,
      weeklySummary: data.weeklySummary,
    }
  },

  // Partial update — both fields optional; the backend rejects any other key
  // (Zod .strict()).
  async updatePreferences(
    payload: Partial<NotificationPreferences>,
  ): Promise<NotificationPreferences> {
    const { data } = await api.patch<BackendNotificationPreferences>(
      '/users/me/notification-preferences',
      payload,
    )
    return {
      highRiskAlerts: data.highRiskAlerts,
      weeklySummary: data.weeklySummary,
    }
  },
}
