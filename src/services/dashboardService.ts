import { api } from './api'
import { normalizeEvent, type BackendTimelineEvent } from './timelineService'
import type { DashboardMetrics, DashboardCalendarEvent } from '@/types'

interface BackendDashboardCalendarEvent extends BackendTimelineEvent {
  patientName: string
}

export const dashboardService = {
  // GET /api/dashboard/stats — single aggregated, medico-scoped endpoint
  // (Bloque I). Response shape already matches DashboardMetrics exactly
  // (no Decimal/enum-casing normalization needed — counts and plain
  // numbers only), so no transformation layer is required here.
  async getStats(): Promise<DashboardMetrics> {
    const { data } = await api.get<DashboardMetrics>('/dashboard/stats')
    return data
  },

  // O3 — GET /api/dashboard/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD (O2,
  // medico-scoped, multi-patient). Reuses timelineService's normalizeEvent
  // verbatim (identical CLINICAL_RECORD/PREDICTION/ALERT/RISK_CHANGE
  // metadata contract to Patient Timeline, per O2) — only patientName is
  // decorated on top here, exactly mirroring how the backend itself
  // decorates P2's mappers rather than duplicating the switch-case.
  async getCalendar(range: { from?: string; to?: string } = {}): Promise<DashboardCalendarEvent[]> {
    const { data } = await api.get<{ data: BackendDashboardCalendarEvent[] }>(
      '/dashboard/calendar',
      { params: range },
    )
    return data.data.map(raw => ({ ...normalizeEvent(raw), patientName: raw.patientName }))
  },
}
