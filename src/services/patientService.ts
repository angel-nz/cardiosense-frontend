import { api } from './api'
import { normalizeHealthRecord } from './recordService'
import type {
  Patient, RiskLevel, PaginatedResponse,
  CreatePatientRequest, UpdatePatientRequest, PatientHistoryResponse,
} from '@/types'

// ─── Backend wire shape ───────────────────────────────────────────────────
// GET /api/patients and GET /api/patients/:id embed the most recent
// Prediction (riskLevel/riskScore) so latestRisk/latestScore can be derived
// here — the backend has no dedicated field for it. riskScore is a Decimal
// serialized as a string. riskLevel is uppercase (LOW/MODERATE/HIGH).
interface BackendPrediction {
  riskLevel: string
  riskScore: string | number
}

interface BackendPatient {
  id: string
  medicoId: string
  firstName: string
  lastName: string
  birthDate: string
  sex: 0 | 1
  curp?: string | null
  phone?: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  predictions?: BackendPrediction[]
}

interface BackendPaginated<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

function normalizePatient(p: BackendPatient): Patient {
  const latest = p.predictions?.[0]
  return {
    id: p.id,
    medicoId: p.medicoId,
    firstName: p.firstName,
    lastName: p.lastName,
    birthDate: p.birthDate,
    sex: p.sex,
    curp: p.curp ?? undefined,
    phone: p.phone ?? undefined,
    isActive: p.isActive,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    latestRisk: latest ? (latest.riskLevel.toLowerCase() as RiskLevel) : undefined,
    latestScore: latest ? Number(latest.riskScore) : undefined,
  }
}

export interface PatientListParams {
  page?: number
  limit?: number
  search?: string
}

export const patientService = {
  // GET /api/patients — backend also accepts a `risk` query param (schema
  // exists) but the service ignores it (see PatientService.list) — not sent
  // here, filtering by risk stays client-side on the loaded page. See report.
  async list(params: PatientListParams = {}): Promise<PaginatedResponse<Patient>> {
    const { data } = await api.get<BackendPaginated<BackendPatient>>('/patients', { params })
    return {
      data: data.data.map(normalizePatient),
      total: data.total,
      page: data.page,
      limit: data.limit,
      totalPages: data.totalPages,
    }
  },

  async getById(id: string): Promise<Patient> {
    const { data } = await api.get<BackendPatient>(`/patients/${id}`)
    return normalizePatient(data)
  },

  async create(payload: CreatePatientRequest): Promise<Patient> {
    const { data } = await api.post<BackendPatient>('/patients', payload)
    return normalizePatient(data)
  },

  // PUT /api/patients/:id — only firstName/lastName/phone/isActive are
  // accepted by the backend (UpdatePatientDto); birthDate/sex/curp cannot
  // be edited post-creation.
  async update(id: string, payload: UpdatePatientRequest): Promise<Patient> {
    const { data } = await api.put<BackendPatient>(`/patients/${id}`, payload)
    return normalizePatient(data)
  },

  // GET /api/patients/:id/history — only the `records` portion (Health
  // Records) is normalized/consumed; `predictions` is passed through
  // untouched and intentionally not rendered (out of scope — Bloque C).
  async getHistory(id: string): Promise<PatientHistoryResponse> {
    const { data } = await api.get<{
      records: Parameters<typeof normalizeHealthRecord>[0][]
      predictions: unknown[]
    }>(`/patients/${id}/history`)
    return {
      records: data.records.map(normalizeHealthRecord),
      predictions: data.predictions,
    }
  },
}
