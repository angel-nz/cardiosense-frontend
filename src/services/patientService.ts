import { api } from './api'
import { normalizeHealthRecord } from './recordService'
import type {
  Patient, RiskLevel, PaginatedResponse,
  CreatePatientRequest, UpdatePatientRequest, PatientHistoryResponse, HistoryQueryParams,
  PatientLifecycleFilter, HiddenPatientSummary, HiddenPatientQueryParams,
  PatientVisibilitySummary, BulkVisibilityResponse,
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
  // Z6 — optional patient contact email.
  email?: string | null
  isActive: boolean
  // Z8 — patient visibility axis, orthogonal to isActive. Always present on
  // every normal BackendPatient response (never sent for a hidden patient,
  // since those never reach normal endpoints at all).
  isHidden: boolean
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

// U4.2A-FIX-2 — Prisma's Paciente.birthDate (DateTime @db.Date) comes back
// from the backend as a full ISO datetime string ("2000-01-01T00:00:00.000Z")
// — Prisma returns a JS Date, and Express's res.json() serializes any Date
// via .toISOString(). The frontend Patient contract requires plain
// "YYYY-MM-DD" (consumed by <input type="date">, calcAge, and
// UpdatePatientDto's regex on the way back out). A simple prefix slice is
// the correct, timezone-safe extraction here: the ISO string always begins
// with the exact UTC calendar date the @db.Date column stores, so this
// never risks the local-timezone day-shift a `new Date(...)` round-trip
// through local getters could introduce (e.g. Guadalajara, UTC-6).
// Idempotent — an already-normalized "YYYY-MM-DD" input's first 10
// characters are itself, so this is safe to apply unconditionally to any
// Patient response, normalized or not.
function toDateOnly(value: string): string {
  return value.slice(0, 10)
}

function normalizePatient(p: BackendPatient): Patient {
  const latest = p.predictions?.[0]
  return {
    id: p.id,
    medicoId: p.medicoId,
    firstName: p.firstName,
    lastName: p.lastName,
    birthDate: toDateOnly(p.birthDate),
    sex: p.sex,
    curp: p.curp ?? undefined,
    phone: p.phone ?? undefined,
    email: p.email ?? undefined,
    isActive: p.isActive,
    isHidden: p.isHidden,
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
  // X2 — canonical uppercase risk-level filter (matches backend
  // PatientQueryDto.risk / Prisma RiskLevel), now genuinely applied
  // server-side (patient.service.ts → patient.repository.ts): the
  // patient's single MOST RECENT Prediction has this riskLevel — never
  // "ever had this riskLevel" — dataset-wide, before pagination. No longer
  // a validated-but-ignored no-op.
  risk?: 'LOW' | 'MODERATE' | 'HIGH'
  // Z8 §13/§24 — lifecycle filter, composes with search/risk. Omitted
  // defaults to ACTIVE server-side (patient.dto.ts's PatientStatusFilter).
  // Hidden patients are excluded from the result for every value — there is
  // no way to request them through this normal list endpoint.
  status?: PatientLifecycleFilter
}

export const patientService = {
  // GET /api/patients — `risk` (X2) is genuinely applied server-side now;
  // see PatientListParams above and patient.repository.ts for the exact
  // latest-Prediction-per-patient semantics. `status` (Z8) is forwarded the
  // same way.
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

  // PUT /api/patients/:id — accepts firstName/lastName/birthDate/sex/curp/
  // phone/email (UpdatePatientDto). Z8 — isActive is NO LONGER accepted
  // here; lifecycle state has its own dedicated endpoint (setStatus below).
  async update(id: string, payload: UpdatePatientRequest): Promise<Patient> {
    const { data } = await api.put<BackendPatient>(`/patients/${id}`, payload)
    return normalizePatient(data)
  },

  // Z8 §7 — PATCH /patients/:id/status. isActive:false deactivates,
  // isActive:true reactivates. Rejected (409 PATIENT_HIDDEN semantics —
  // surfaced as a plain error) if the patient is currently hidden and the
  // caller asks for isActive:true — a hidden patient must be shown first.
  async setStatus(id: string, isActive: boolean): Promise<Patient> {
    const { data } = await api.patch<BackendPatient>(`/patients/${id}/status`, { isActive })
    return normalizePatient(data)
  },

  // Z8 §10 — PATCH /patients/:id/visibility. isHidden:true hides (only
  // valid for an already-inactive patient — 409
  // PATIENT_MUST_BE_INACTIVE_TO_HIDE otherwise), isHidden:false shows
  // (never reactivates).
  async setVisibility(id: string, isHidden: boolean): Promise<Patient> {
    const { data } = await api.patch<BackendPatient>(`/patients/${id}/visibility`, { isHidden })
    return normalizePatient(data)
  },

  // Z8 §17 — GET /patients/visibility/hidden. The Settings -> Pacientes
  // hidden list. Minimal patient summary only — no clinical data.
  async listHidden(params: HiddenPatientQueryParams = {}): Promise<PaginatedResponse<HiddenPatientSummary>> {
    const { data } = await api.get<BackendPaginated<HiddenPatientSummary>>(
      '/patients/visibility/hidden', { params },
    )
    return data
  },

  // Z8 §18 — GET /patients/visibility/summary. Counts for Settings ->
  // Pacientes. Never reused as Dashboard patient counts.
  async getVisibilitySummary(): Promise<PatientVisibilitySummary> {
    const { data } = await api.get<PatientVisibilitySummary>('/patients/visibility/summary')
    return data
  },

  // Z8 §19 — PATCH /patients/inactive/visibility. Bulk hide-all-inactive /
  // show-all-hidden for the current doctor. Returns affectedCount — never
  // one notification per patient; the caller (Settings -> Pacientes) emits
  // exactly one ActionNotification per call.
  async bulkSetVisibility(isHidden: boolean): Promise<BulkVisibilityResponse> {
    const { data } = await api.patch<BulkVisibilityResponse>('/patients/inactive/visibility', { isHidden })
    return data
  },

  // GET /api/patients/:id/history — U5.2: `records` is now server-side
  // paginated/sorted; `predictions` continues to be passed through
  // untouched and intentionally not rendered (out of scope — Bloque C).
  async getHistory(id: string, params: HistoryQueryParams): Promise<PatientHistoryResponse> {
    const { data } = await api.get<{
      records: { data: Parameters<typeof normalizeHealthRecord>[0][]; total: number; page: number; limit: number; totalPages: number }
      predictions: unknown[]
      targetResolved?: boolean
    }>(`/patients/${id}/history`, { params })
    return {
      records: { ...data.records, data: data.records.data.map(normalizeHealthRecord) },
      predictions: data.predictions,
      ...(params.targetId ? { targetResolved: data.targetResolved } : {}),
    }
  },
}
