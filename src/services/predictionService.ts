import { api } from './api'
import { normalizeHealthRecord } from './recordService'
import type { BackendHealthRecord } from './recordService'
import type { Prediction, RiskLevel, PaginatedResponse, GlobalPredictionQueryParams, PredictionRiskFilter } from '@/types'

// ─── Backend wire shape ───────────────────────────────────────────────────
// Real routes (see prediction.routes.ts / app.ts) — READ-ONLY since
// NEW S2E-FIX4 (Predictions are created only automatically by the backend
// when a REAL HealthRecord is saved; there is no create call here):
//   GET  /api/predictions              — global, médico-scoped history
//   GET  /api/predictions/patient/:id  — NOT /api/predictions/:patientId; that
//                                         path instead resolves to GET /:id
//                                         (single prediction by its own id).
// riskScore/anomalyScore are Decimal → serialized as strings. riskLevel is
// uppercase (LOW/MODERATE/HIGH). featureImportance is not persisted on the
// Prediction row, so the current read-only prediction endpoints/history do
// not supply it. The optional field is retained only for additive wire
// compatibility; the frontend never fabricates it.
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
  // V7 — Prisma `include: { healthRecord: true }` on BOTH findByPatient and
  // listAll (prediction.repository.ts), so this is present on every
  // Prediction History response, not just one surface. `null` for a
  // legacy/unlinked Prediction (healthRecordId was null) — never omitted
  // from the wire shape, so normalizePrediction below can distinguish "no
  // linked record" from "field not sent".
  healthRecord?: BackendHealthRecord | null
  origin?: string
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
    // V7 — reuses recordService's own normalizeHealthRecord (same
    // Decimal-string→number handling already established there) rather
    // than a second implementation. `p.healthRecord` is `undefined` only if
    // a future caller of normalizePrediction omits it entirely; both real
    // cases (linked record object, or explicit `null`) are preserved as-is.
    healthRecord: p.healthRecord ? normalizeHealthRecord(p.healthRecord) : null,
    // NEW S2E-FIX3/FIX4 — anything but AUTOMATIC_HEALTH_RECORD → LEGACY_UNKNOWN
    // (never "automatic"; there is no manual origin).
    origin: p.origin === 'AUTOMATIC_HEALTH_RECORD' ? 'AUTOMATIC_HEALTH_RECORD' : 'LEGACY_UNKNOWN',
  }
}

export const predictionService = {
  // GET /api/predictions/patient/:patientId — U8.2B: optional `targetId`
  // deep-link resolution. When provided, the backend ignores `page` and
  // instead returns the canonical page that actually contains the target
  // Prediction, with `targetResolved` indicating whether it was found —
  // never a merged/fabricated dataset, always a genuine contiguous page.
  //
  // W5.2 — page/from/to/riskLevel added (additive; every existing caller —
  // PredictionsPage's reconnect-recovery call with only `{ limit: 5 }` —
  // keeps working unchanged, since every new field is optional and simply
  // omitted from `params` when not supplied). `from`/`to` are sent as plain
  // human "YYYY-MM-DD" strings, same convention already used by
  // GlobalPredictionQueryParams/listAll — the backend (boundaryField)
  // performs the actual business-timezone half-open [from, to) conversion;
  // no date math happens here. `riskLevel` is the canonical uppercase
  // value, never derived from riskScore.
  //
  // NEW S3 — `order` defaults to 'clinicalTime' (canonical clinical order:
  // source record effective clinical time DESC → recordedAt → id →
  // predictedAt → id; targetId pages and from/to use the same clinical axis).
  // 'predictedAt' exists ONLY for technical recovery (finding a freshly
  // calculated Prediction by calculation recency), never for display.
  async getHistory(patientId: string, opts: {
    page?: number; limit?: number; targetId?: string
    from?: string; to?: string; riskLevel?: PredictionRiskFilter
    signal?: AbortSignal
    order?: 'clinicalTime' | 'predictedAt'
  } = {}): Promise<PaginatedResponse<Prediction>> {
    const { page, limit = 20, targetId, from, to, riskLevel, signal, order = 'clinicalTime' } = opts
    const { data } = await api.get<BackendPaginated<BackendPrediction> & { targetResolved?: boolean }>(
      `/predictions/patient/${patientId}`,
      { params: {
          limit,
          sortBy: order,
          ...(page ? { page } : {}),
          ...(targetId ? { targetId } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          ...(riskLevel ? { riskLevel } : {}),
        },
        signal },
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

  // NEW S2E-FIX2 — the patient's COMPLETE readable Prediction history (for
  // the full risk-evolution modal only; loaded lazily). Walks the existing
  // paginated GET /predictions/patient/:id at its maximum page size (100,
  // PatientPredictionQueryDto) until `totalPages` is reached, deduplicating
  // by Prediction id. Each row keeps its source HealthRecord (clinical
  // time). Never sampled or truncated.
  async getAllForPatient(patientId: string, opts: { signal?: AbortSignal } = {}): Promise<Prediction[]> {
    const PAGE_SIZE = 100
    const seen = new Set<string>()
    const out: Prediction[] = []
    let page = 1
    let totalPages = 1
    do {
      const res = await predictionService.getHistory(patientId, { page, limit: PAGE_SIZE, signal: opts.signal })
      for (const p of res.data) if (!seen.has(p.id)) { seen.add(p.id); out.push(p) }
      totalPages = res.totalPages
      page++
    } while (page <= totalPages)
    return out
  },

  // GET /api/predictions — global history for the authenticated médico.
  // Backend scopes this by patient.medicoId; server-side paginated,
  // filtered (search/from/to/riskLevel — U6.2). NEW S3 — ordered (and
  // from/to-filtered) by CLINICAL time (sortBy=clinicalTime) — no client-side
  // re-sort, filter, or "fetch all" needed.
  async listAll(params: GlobalPredictionQueryParams): Promise<PaginatedResponse<Prediction>> {
    const { data } = await api.get<BackendPaginated<BackendPrediction>>(
      '/predictions',
      { params: { ...params, sortBy: 'clinicalTime' } },
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
