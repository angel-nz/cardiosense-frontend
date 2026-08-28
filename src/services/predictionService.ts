import { api } from './api'
import type { Prediction, RiskLevel, CreatePredictionRequest, PaginatedResponse } from '@/types'

// ─── Backend wire shape ───────────────────────────────────────────────────
// Real routes (see prediction.routes.ts / app.ts):
//   POST /api/predictions              — NOT /api/predict as the matrix/spec
//                                         describe. /api/predict does not exist.
//   GET  /api/predictions/patient/:id  — NOT /api/predictions/:patientId; that
//                                         path instead resolves to GET /:id
//                                         (single prediction by its own id).
// riskScore/anomalyScore are Decimal → serialized as strings. riskLevel is
// uppercase (LOW/MODERATE/HIGH). featureImportance is only present on the
// response of POST /predictions (computed in-memory from the AI call) — it
// is NOT persisted on the Prediction row, so history entries never have it.
interface BackendPrediction {
  id: string
  patientId: string
  healthRecordId?: string | null
  riskScore: string | number
  riskLevel: string
  anomalyScore?: string | number | null
  isAnomaly: boolean
  modelVersion?: string | null
  predictedAt: string
  featureImportance?: Record<string, number>
  // Only present on GET /api/predictions (see prediction.repository.ts
  // listAll — include: { patient: { select: { firstName, lastName } } }).
  patient?: { firstName: string; lastName: string }
}

interface BackendPaginated<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

function normalizePrediction(p: BackendPrediction): Prediction {
  return {
    id: p.id,
    patientId: p.patientId,
    healthRecordId: p.healthRecordId ?? '',
    riskScore: Number(p.riskScore),
    riskLevel: p.riskLevel.toLowerCase() as RiskLevel,
    anomalyScore: p.anomalyScore != null ? Number(p.anomalyScore) : 0,
    isAnomaly: p.isAnomaly,
    modelVersion: p.modelVersion ?? '',
    predictedAt: p.predictedAt,
    featureImportance: p.featureImportance,
    patientName: p.patient ? `${p.patient.firstName} ${p.patient.lastName}` : undefined,
  }
}

export const predictionService = {
  // POST /api/predictions — backend uses the patient's latest Health Record
  // automatically when healthRecordId is omitted (no manual indicator entry
  // in the frontend; the backend is the source of truth for which record).
  async predict(payload: CreatePredictionRequest): Promise<Prediction> {
    const { data } = await api.post<BackendPrediction>('/predictions', {
      patientId: payload.patientId,
      healthRecordId: payload.healthRecordId,
    })
    return normalizePrediction(data)
  },

  // GET /api/predictions/patient/:patientId
  async getHistory(patientId: string, limit = 20): Promise<PaginatedResponse<Prediction>> {
    const { data } = await api.get<BackendPaginated<BackendPrediction>>(
      `/predictions/patient/${patientId}`,
      { params: { limit } },
    )
    return {
      data: data.data.map(normalizePrediction),
      total: data.total,
      page: data.page,
      limit: data.limit,
      totalPages: data.totalPages,
    }
  },

  // GET /api/predictions — global history for the authenticated médico.
  // Backend now scopes this by patient.medicoId (Bloque J security fix);
  // server-side paginated, ordered predictedAt desc — no client-side
  // re-sort or "fetch all" needed.
  async listAll(page = 1, limit = 20): Promise<PaginatedResponse<Prediction>> {
    const { data } = await api.get<BackendPaginated<BackendPrediction>>(
      '/predictions',
      { params: { page, limit } },
    )
    return {
      data: data.data.map(normalizePrediction),
      total: data.total,
      page: data.page,
      limit: data.limit,
      totalPages: data.totalPages,
    }
  },
}
