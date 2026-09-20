import { api } from './api'
import type { Alert, AlertSeverity, AlertListResponse, AlertReadResponse } from '@/types'

// ─── Backend wire shape ───────────────────────────────────────────────────
// GET /api/alerts returns raw Prisma rows: severity is UPPERCASE
// ('INFO'|'WARNING'|'CRITICAL'), patient name comes nested as
// `patient: {firstName, lastName}`, and there is NO riskScore field on the
// Alert model at all (it only exists transiently on the Socket.IO
// `new_alert` payload — see SocketContext). Normalized here so the rest of
// the app only ever sees the existing `Alert` type.
interface BackendAlert {
  id: string
  patientId: string
  predictionId?: string | null
  severity: string
  message: string
  isRead: boolean
  createdAt: string
  patient?: { firstName: string; lastName: string }
}

interface BackendAlertList {
  data: BackendAlert[]
  total: number
  page: number
  limit: number
  totalPages: number
  unreadCount: number
}

function normalizeAlert(a: BackendAlert): Alert {
  return {
    id: a.id,
    patientId: a.patientId,
    patientName: a.patient ? `${a.patient.firstName} ${a.patient.lastName}` : '',
    predictionId: a.predictionId ?? undefined,
    severity: a.severity.toLowerCase() as AlertSeverity,
    message: a.message,
    isRead: a.isRead,
    createdAt: a.createdAt,
    riskScore: undefined,
  }
}

export interface AlertListParams {
  page?: number
  limit?: number
  unread?: boolean
  severity?: AlertSeverity
  // U7.2 — server-side search: patient CURP, patient name, or alert
  // message (see alert.repository.ts for the exact predicate).
  search?: string
}

export const alertService = {
  // GET /api/alerts — supports page/limit/unread/severity/search (severity
  // sent uppercase to match the backend's Zod enum).
  async list(params: AlertListParams = {}): Promise<AlertListResponse> {
    const query: Record<string, unknown> = {}
    if (params.page) query.page = params.page
    if (params.limit) query.limit = params.limit
    if (params.unread !== undefined) query.unread = params.unread
    if (params.severity) query.severity = params.severity.toUpperCase()
    if (params.search) query.search = params.search

    const { data } = await api.get<BackendAlertList>('/alerts', { params: query })
    return {
      data: data.data.map(normalizeAlert),
      total: data.total,
      page: data.page,
      limit: data.limit,
      totalPages: data.totalPages,
      unreadCount: data.unreadCount,
    }
  },

  // PATCH /api/alerts/:id/read
  async markRead(id: string): Promise<AlertReadResponse> {
    const { data } = await api.patch<BackendAlert>(`/alerts/${id}/read`)
    return normalizeAlert(data)
  },

  // PATCH /api/alerts/read-all
  async markAllRead(): Promise<{ success: boolean }> {
    const { data } = await api.patch<{ success: boolean }>('/alerts/read-all')
    return data
  },
}
