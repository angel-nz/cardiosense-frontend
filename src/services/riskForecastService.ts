import { api } from './api'
import type { CurrentRiskProjectionResponse, PaginatedResponse, RiskProjectionSet } from '@/types'

// NEW S2E — S2D read API for risk PROJECTIONS (never Predictions/Alerts).
// The backend serializer is already an allowlist; this service passes its
// response through typed, without adding or deriving any S state client-side
// (eligibility, generation, staleness and lifecycle are backend results).
export const riskForecastService = {
  // GET /api/risk-forecasts/patient/:patientId/current
  async getCurrent(patientId: string, opts: { signal?: AbortSignal } = {}): Promise<CurrentRiskProjectionResponse> {
    const { data } = await api.get<CurrentRiskProjectionResponse>(
      `/risk-forecasts/patient/${patientId}/current`,
      { signal: opts.signal },
    )
    return data
  },

  // GET /api/risk-forecasts/patient/:patientId/history — superseded sets.
  // Typed for future use only: A10 keeps forecast history API-only in v1,
  // so no S2E UI calls this.
  async getHistory(patientId: string, opts: { page?: number; limit?: number; signal?: AbortSignal } = {}): Promise<PaginatedResponse<RiskProjectionSet>> {
    const { page, limit, signal } = opts
    const { data } = await api.get<PaginatedResponse<RiskProjectionSet>>(
      `/risk-forecasts/patient/${patientId}/history`,
      { params: { ...(page ? { page } : {}), ...(limit ? { limit } : {}) }, signal },
    )
    return data
  },
}
