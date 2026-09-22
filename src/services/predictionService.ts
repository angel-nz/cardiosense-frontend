import { api } from './api'
import type { Prediction, RiskLevel, CreatePredictionRequest, PaginatedResponse, GlobalPredictionQueryParams } from '@/types'

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

  // GET /api/predictions/patient/:patientId — U8.2B: optional `targetId`
  // deep-link resolution. When provided, the backend ignores `page` and
  // instead returns the canonical page that actually contains the target
  // Prediction, with `targetResolved` indicating whether it was found —
  // never a merged/fabricated dataset, always a genuine contiguous page.
  async getHistory(patientId: string, opts: { limit?: number; targetId?: string } = {}): Promise<PaginatedResponse<Prediction>> {
    const { limit = 20, targetId } = opts
    const { data } = await api.get<BackendPaginated<BackendPrediction> & { targetResolved?: boolean }>(
      `/predictions/patient/${patientId}`,
      { params: { limit, ...(targetId ? { targetId } : {}) } },
    )
    return {
      data: data.data.map(normalizePrediction),
      total: data.total,
      page: data.page,
      limit: data.limit,
      totalPages: data.totalPages,
      ...(targetId ? { targetResolved: data.targetResolved } : {}),
    }
  },

  // GET /api/predictions — global history for the authenticated médico.
  // Backend scopes this by patient.medicoId; server-side paginated,
  // filtered (search/from/to/riskLevel — U6.2), ordered predictedAt desc —
  // no client-side re-sort, filter, or "fetch all" needed.
  async listAll(params: GlobalPredictionQueryParams): Promise<PaginatedResponse<Prediction>> {
    const { data } = await api.get<BackendPaginated<BackendPrediction>>(
      '/predictions',
      { params },
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
