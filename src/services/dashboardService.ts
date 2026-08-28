import { api } from './api'
import type { DashboardMetrics } from '@/types'

export const dashboardService = {
  // GET /api/dashboard/stats — single aggregated, medico-scoped endpoint
  // (Bloque I). Response shape already matches DashboardMetrics exactly
  // (no Decimal/enum-casing normalization needed — counts and plain
  // numbers only), so no transformation layer is required here.
  async getStats(): Promise<DashboardMetrics> {
    const { data } = await api.get<DashboardMetrics>('/dashboard/stats')
    return data
  },
}
