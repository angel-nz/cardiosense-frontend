// NEW S2E-FIX1 — "Evolución del riesgo" as a CLINICAL-TIME visualization.
//
// Two explicitly separate series, composed only at presentation time:
//   A. REAL — one point per persisted REAL Prediction, positioned at the
//      clinical time of its SOURCE HealthRecord (Prediction.healthRecord):
//        CLINICIAN_ENTERED + measuredAt → measuredAt
//        legacy (LEGACY_ENTRY_TIME)     → recordedAt, MARKED as entry-time fallback
//        no linked record               → predictedAt, MARKED as such
//      Never predictedAt/recordedAt as the primary time of a measured record.
//   B. PROJECTION — CURRENT RiskForecast targets (finalRiskScore at
//      targetDate). Only from an accepted CURRENT response for THIS patient
//      with a GENERATED_FULL/PARTIAL set; never superseded history.
//
// This module only READS the `predictions` array; it never adds forecast
// objects to it (forecasts are not Predictions). Nothing here feeds R: R's
// evidence/canonicalization/provenance and Prediction.predictedAt are
// untouched — this is presentation of clinical chronology only.
import type { ForecastRiskLevel, Prediction, PredictionOrigin, RiskLevel } from '@/types'
import type { ForecastLoadState } from '@/hooks/useCurrentRiskForecast'
import { recordClinicalTime, clinicalWallTimeToUtcIso } from '@/lib/clinicalTime'
import { describeProjectionResponse, targetDateState, type TargetDateState } from '@/lib/riskProjection'

export type RealPointSource = 'MEASURED' | 'LEGACY_ENTRY' | 'UNLINKED'

export interface RealRiskPoint {
  kind: 'REAL'
  predictionId: string
  t: number                 // chart X (ms) — effective clinical time
  instant: string           // ISO of that effective time
  source: RealPointSource
  score: number             // persisted Prediction.riskScore (final R value)
  level: RiskLevel          // persisted, authoritative
  origin: PredictionOrigin  // NEW S2E-FIX3 — metadata only (labelling)
}

export interface ProjectedRiskPoint {
  kind: 'PROJECTION'
  horizonIndex: number
  t: number                 // chart X (ms) — noon of targetDate in Guadalajara
  targetDate: string        // "YYYY-MM-DD" (America/Mexico_City calendar date)
  score: number             // finalRiskScore (never globalRiskScore)
  level: ForecastRiskLevel  // backend-authoritative
  interpretation: 'GLOBAL' | 'INDIVIDUALIZED_BRIDGE'
  dateState: TargetDateState
}

// One merged row per point; exactly one of `real`/`projected` is set, so
// each Recharts <Line> only ever draws its own series.
export interface RiskEvolutionRow {
  t: number
  real: number | null
  projected: number | null
  point: RealRiskPoint | ProjectedRiskPoint
}

export interface RiskEvolutionModel {
  real: RealRiskPoint[]
  projected: ProjectedRiskPoint[]
  rows: RiskEvolutionRow[]
  domain: [number, number] | null
}

// Calendar date "YYYY-MM-DD" → its Guadalajara noon instant. Noon keeps the
// point on that calendar day in the business timezone for every viewer.
export function targetDateToChartTime(targetDate: string): number {
  const c = clinicalWallTimeToUtcIso(`${targetDate}T12:00`)
  return c.ok ? Date.parse(c.iso) : Date.parse(`${targetDate}T18:00:00.000Z`)
}

export function realPointFor(p: Prediction): RealRiskPoint & { _recordedAt: string; _recordId: string } {
  const r = p.healthRecord
  if (r) {
    const ct = recordClinicalTime(r)
    return {
      kind: 'REAL', predictionId: p.id, t: Date.parse(ct.instant), instant: ct.instant, source: ct.source,
      score: p.riskScore, level: p.riskLevel, origin: p.origin, _recordedAt: r.recordedAt, _recordId: r.id,
    }
  }
  return {
    kind: 'REAL', predictionId: p.id, t: Date.parse(p.predictedAt), instant: p.predictedAt, source: 'UNLINKED',
    score: p.riskScore, level: p.riskLevel, origin: p.origin, _recordedAt: p.predictedAt, _recordId: '',
  }
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

// Deterministic: effective clinical time → HealthRecord.recordedAt →
// HealthRecord id → Prediction id.
export function buildRealSeries(patientId: string, predictions: readonly Prediction[]): RealRiskPoint[] {
  return predictions
    .filter(p => p.patientId === patientId)
    .map(realPointFor)
    .sort((a, b) => (a.t - b.t) || (Date.parse(a._recordedAt) - Date.parse(b._recordedAt)) || cmp(a._recordId, b._recordId) || cmp(a.predictionId, b.predictionId))
    .map(({ _recordedAt: _r, _recordId: _i, ...pt }) => pt)
}

export function buildProjectedSeries(patientId: string, state: ForecastLoadState, todayKey: string): ProjectedRiskPoint[] {
  if (state.phase !== 'ready' || state.response.patientId !== patientId) return []
  const model = describeProjectionResponse(state.response)
  if (model.kind !== 'PROJECTIONS') return []   // ineligible / NONE_ADMISSIBLE / FAILED / null / inactive → none
  const interpretation = model.set.riskInterpretation === 'INDIVIDUALIZED_BRIDGE' ? 'INDIVIDUALIZED_BRIDGE' : 'GLOBAL'
  return model.projections.map(p => ({
    kind: 'PROJECTION', horizonIndex: p.horizonIndex, t: targetDateToChartTime(p.targetDate), targetDate: p.targetDate,
    score: p.finalRiskScore, level: p.riskLevel, interpretation, dateState: targetDateState(p.targetDate, todayKey),
  }))
}

const DAY = 86_400_000

export function buildRiskEvolutionModel(args: {
  patientId: string; predictions: readonly Prediction[]; forecastState: ForecastLoadState; todayKey: string
}): RiskEvolutionModel {
  const real = buildRealSeries(args.patientId, args.predictions)
  const projected = buildProjectedSeries(args.patientId, args.forecastState, args.todayKey)
  const rows: RiskEvolutionRow[] = [
    ...real.map(p => ({ t: p.t, real: p.score, projected: null, point: p as RealRiskPoint | ProjectedRiskPoint })),
    ...projected.map(p => ({ t: p.t, real: null, projected: p.score, point: p as RealRiskPoint | ProjectedRiskPoint })),
  ].sort((a, b) => (a.t - b.t) || (a.point.kind === 'REAL' ? -1 : 1))
  if (rows.length === 0) return { real, projected, rows, domain: null }
  const min = rows[0].t, max = rows[rows.length - 1].t
  const pad = Math.max(DAY, (max - min) * 0.03)
  return { real, projected, rows, domain: [min - pad, max + pad] }
}

// ─── NEW S2E-FIX2 — compact selection ───────────────────────────────────
export const COMPACT_PREDICTION_LIMIT = 10

// NEW S3 — SELECTION = CLINICAL order (the 10 clinically latest
// Predictions): source record effective clinical time DESC → recordedAt DESC
// → record id DESC → predictedAt DESC → id DESC (unlinked: predictedAt). The
// selected rows are then POSITIONED by clinical time in buildRiskEvolutionModel.
// Forecast targets never count toward this limit.
export function compareClinicalDesc(a: Prediction, b: Prediction): number {
  const eff = (p: Prediction) => (p.healthRecord ? recordClinicalTime(p.healthRecord).instant : p.predictedAt)
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0)
  return (Date.parse(eff(b)) - Date.parse(eff(a)))
    || (Date.parse(b.healthRecord?.recordedAt ?? '') || 0) - (Date.parse(a.healthRecord?.recordedAt ?? '') || 0)
    || cmp(b.healthRecord?.id ?? '', a.healthRecord?.id ?? '')
    || (Date.parse(b.predictedAt) - Date.parse(a.predictedAt))
    || cmp(b.id, a.id)
}
export function selectCompactPredictions(predictions: readonly Prediction[], limit = COMPACT_PREDICTION_LIMIT): Prediction[] {
  return [...predictions].sort(compareClinicalDesc).slice(0, limit)
}

// ─── NEW S2E-FIX3 — point identity / origin copy ────────────────────────
export type RiskPoint = RealRiskPoint | ProjectedRiskPoint

// Stable key for focus/selection (REAL by Prediction id, projection by horizon).
export function pointKey(p: RiskPoint): string {
  return p.kind === 'REAL' ? `r:${p.predictionId}` : `p:${p.horizonIndex}`
}

export const ORIGIN_LABEL: Record<PredictionOrigin, string> = {
  AUTOMATIC_HEALTH_RECORD: 'Predicción',
  LEGACY_UNKNOWN: 'Origen no disponible',
}
