import { api } from './api'
import type { HealthRecord, CreateHealthRecordRequest } from '@/types'

// ─── Backend wire shape ───────────────────────────────────────────────────
// Real route is GET /api/health-records/patient/:patientId (not
// /health-records/:patientId as sketched in the matrix) — see record.routes.ts.
// Prisma Decimal fields (totChol/sysBP/diaBP/bmi/glucose) serialize to JSON
// as strings, so they're normalized to number here. There is no `sex` field
// on the backend HealthRecord model (see types/index.ts note).
// V7 — exported so predictionService.ts can type the nested `healthRecord`
// field on the backend wire shape of Prediction and reuse normalizeHealthRecord
// below, instead of a second duplicate Decimal-normalization implementation.
export interface BackendHealthRecord {
  id: string
  patientId: string
  recordedAt: string
  // NEW S2E — S2A clinical time. Optional on the wire type only so a
  // response from a pre-S2A backend still normalizes safely (treated as
  // legacy entry time — never as a known measurement time).
  measuredAt?: string | null
  clinicalTimeSource?: 'CLINICIAN_ENTERED' | 'LEGACY_ENTRY_TIME'
  age: number
  currentSmoker: boolean
  cigsPerDay: number
  bpMeds: boolean
  diabetes: boolean
  totChol: string | number
  sysBP: string | number
  diaBP: string | number
  bmi: string | number
  glucose: string | number
  notes?: string | null
  createdBy: string
}

export function normalizeHealthRecord(r: BackendHealthRecord): HealthRecord {
  return {
    id: r.id,
    patientId: r.patientId,
    recordedAt: r.recordedAt,
    measuredAt: r.measuredAt ?? null,
    clinicalTimeSource: r.clinicalTimeSource === 'CLINICIAN_ENTERED' && r.measuredAt ? 'CLINICIAN_ENTERED' : 'LEGACY_ENTRY_TIME',
    age: r.age,
    currentSmoker: r.currentSmoker,
    cigsPerDay: r.cigsPerDay,
    bpMeds: r.bpMeds,
    diabetes: r.diabetes,
    totChol: Number(r.totChol),
    sysBP: Number(r.sysBP),
    diaBP: Number(r.diaBP),
    bmi: Number(r.bmi),
    glucose: Number(r.glucose),
    notes: r.notes ?? undefined,
    createdBy: r.createdBy,
  }
}

export const recordService = {
  // GET /api/health-records/patient/:patientId — returns a plain array,
  // not a paginated envelope (backend caps via `limit`, default 50).
  async getByPatientId(patientId: string, limit?: number): Promise<HealthRecord[]> {
    const { data } = await api.get<BackendHealthRecord[]>(
      `/health-records/patient/${patientId}`,
      { params: limit ? { limit } : undefined },
    )
    return data.map(normalizeHealthRecord)
  },

  async create(payload: CreateHealthRecordRequest): Promise<HealthRecord> {
    const { data } = await api.post<BackendHealthRecord>('/health-records', payload)
    return normalizeHealthRecord(data)
  },

  // U3.2 — GET /health-records/patient/:patientId/latest. Canonical prefill
  // source for NewRecordModal — never `records[0]` from a possibly-paginated
  // Clinical History list (U5 will paginate that list; this endpoint won't
  // be affected). Returns `null` when the patient has no prior HealthRecord
  // — a normal state, not an error.
  // NEW S2E-FIX3 — the ONE "latest clinical record" for UI defaults
  // (Nuevo registro prefill, Nueva predicción, Indicadores clínicos): the
  // first row of the accepted S2E-FIX2 clinical history contract
  // (GET /patients/:id/history, sortBy=clinicalTime, sortOrder=desc, limit=1)
  // — effective clinical time DESC, recordedAt DESC, id DESC, server-side. No
  // new endpoint. The entry-time `getLatest` below is left untouched.
  async getLatestClinical(patientId: string): Promise<HealthRecord | null> {
    const { data } = await api.get<{ records: { data: BackendHealthRecord[] } }>(
      `/patients/${patientId}/history`,
      { params: { page: 1, limit: 1, sortBy: 'clinicalTime', sortOrder: 'desc' } },
    )
    const first = data.records?.data?.[0]
    return first ? normalizeHealthRecord(first) : null
  },

  async getLatest(patientId: string): Promise<HealthRecord | null> {
    const { data } = await api.get<BackendHealthRecord | null>(
      `/health-records/patient/${patientId}/latest`,
    )
    return data ? normalizeHealthRecord(data) : null
  },
}
