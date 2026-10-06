import { RISK_CONFIG } from '@/lib/utils'
import { formatClinicalDateTime, recordClinicalTime, LEGACY_TIME_NOTE } from '@/lib/clinicalTime'
import { featureLabel, formatMeasureWithUnit, formatBinary } from '@/lib/clinicalLabels'
import { PROJECTION_COPY, formatClinicalDay, formatProjectionPercent, formatTargetDate, toBadgeLevel, describeProjectionResponse, projectionAssumptionCopy } from '@/lib/riskProjection'
import { ORIGIN_LABEL, type RiskPoint } from '@/lib/riskEvolution'
import type { ForecastLoadState } from '@/hooks/useCurrentRiskForecast'
import type { Prediction, RiskProjection, RiskProjectionSet } from '@/types'

// NEW S2E-FIX3 — persistent "Detalle del punto" for the full-history risk
// modal. Shows COMPLETE public data of the focused / hovered / selected point:
//   REAL       → the public Prediction contract + its source HealthRecord.
//   PROJECTION → the S2D allowlist projection fields (never called observed).
// Never shows appliedLogit, sexUsed bridge state, R provenance JSON or
// fingerprints (none of them exist in the frontend models).

export const POINT_DETAIL_PLACEHOLDER = 'Selecciona o enfoca un punto para ver el detalle completo.'

const PROVENANCE_LABEL: Record<string, string> = {
  DERIVED: 'Derivado (edad en la fecha objetivo)',
  CARRY_FORWARD: 'Último valor real',
  CONDITIONAL: 'Condicional (según estado de fumador proyectado)',
  LOCF: 'Último valor real (se mantiene)',
}

// Display order of the model feature keys (simulated state / provenance).
const FEATURE_ORDER = ['age', 'sex', 'currentSmoker', 'cigsPerDay', 'BPMeds', 'diabetes', 'totChol', 'sysBP', 'diaBP', 'BMI', 'glucose']
const BINARY = new Set(['currentSmoker', 'BPMeds', 'diabetes'])

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 border-b border-border last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xs font-medium text-foreground text-right">{value}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <h5 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{title}</h5>
      <dl>{children}</dl>
    </div>
  )
}

function featureValue(key: string, v: number): string {
  if (key === 'sex') return v === 1 ? 'Masculino' : v === 0 ? 'Femenino' : '—'
  if (BINARY.has(key)) return formatBinary(v)
  return formatMeasureWithUnit(v, key)
}

function RealDetail({ prediction }: { prediction: Prediction }) {
  const r = prediction.healthRecord
  const ct = r ? recordClinicalTime(r) : null
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-detail-kind="REAL">
      <Section title="Predicción">
        <Row label="Origen" value={ORIGIN_LABEL[prediction.origin]} />
        <Row label="Riesgo" value={formatProjectionPercent(prediction.riskScore)} />
        <Row label="Nivel de riesgo" value={RISK_CONFIG[prediction.riskLevel].label} />
        <Row label="Anomalía" value={prediction.isAnomaly ? 'Sí' : 'No'} />
        <Row label="Puntaje de anomalía" value={Number.isFinite(prediction.anomalyScore) ? prediction.anomalyScore.toFixed(4) : '—'} />
        <Row label="Modelo" value={prediction.modelVersion || '—'} />
        <Row label="Cálculo" value={formatClinicalDateTime(prediction.predictedAt)} />
      </Section>
      <Section title="Registro clínico">
        {!r || !ct ? (
          <Row label="Registro" value="Sin registro clínico vinculado" />
        ) : (
          <>
            {ct.source === 'MEASURED'
              ? <Row label="Medición" value={formatClinicalDateTime(ct.instant)} />
              : <Row label="Captura" value={`${formatClinicalDateTime(ct.instant)} — ${LEGACY_TIME_NOTE}`} />}
            {ct.source === 'MEASURED' && <Row label="Capturado en el sistema" value={formatClinicalDateTime(r.recordedAt)} />}
            <Row label="Edad" value={`${r.age} años`} />
            <Row label="Fumador actual" value={formatBinary(r.currentSmoker)} />
            <Row label="Cigarrillos por día" value={formatMeasureWithUnit(r.cigsPerDay, 'cigsPerDay')} />
            <Row label="Medicación antihipertensiva" value={formatBinary(r.bpMeds)} />
            <Row label="Diabetes" value={formatBinary(r.diabetes)} />
            <Row label="Colesterol total" value={formatMeasureWithUnit(r.totChol, 'totChol')} />
            <Row label="Presión sistólica" value={formatMeasureWithUnit(r.sysBP, 'sysBP')} />
            <Row label="Presión diastólica" value={formatMeasureWithUnit(r.diaBP, 'diaBP')} />
            <Row label="IMC" value={formatMeasureWithUnit(r.bmi, 'BMI')} />
            <Row label="Glucosa" value={formatMeasureWithUnit(r.glucose, 'glucose')} />
          </>
        )}
      </Section>
    </div>
  )
}

function ProjectionDetail({ set, projection, todayKey }: { set: RiskProjectionSet; projection: RiskProjection; todayKey: string }) {
  const individualized = set.riskInterpretation === 'INDIVIDUALIZED_BRIDGE'
  const passed = projection.targetDate < todayKey
  const today = projection.targetDate === todayKey
  const keys = FEATURE_ORDER.filter(k => k in (projection.simulatedState ?? {}))
  return (
    <div className="space-y-3" data-detail-kind="PROJECTION">
      <p className="text-xs text-foreground bg-muted/50 border border-border rounded-lg px-3 py-2">
        {projectionAssumptionCopy(set, formatClinicalDay)}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="Proyección">
          <Row label="Horizonte" value={projection.horizonIndex} />
          <Row label={PROJECTION_COPY.targetDateLabel} value={formatTargetDate(projection.targetDate)} />
          {passed && <Row label="Estado" value={PROJECTION_COPY.pastTarget} />}
          {today && <Row label="Estado" value="Fecha objetivo: hoy — sigue siendo una proyección" />}
          <Row label="Edad" value={`${projection.targetAge} años`} />
          <Row label={PROJECTION_COPY.primaryLabel} value={formatProjectionPercent(projection.finalRiskScore)} />
          <Row label="Referencia del modelo global" value={formatProjectionPercent(projection.globalRiskScore)} />
          <Row label="Nivel de riesgo" value={RISK_CONFIG[toBadgeLevel(projection.riskLevel)].label} />
          <Row label="Interpretación" value={individualized ? PROJECTION_COPY.individualized : PROJECTION_COPY.global} />
          <Row label="Incertidumbre" value={PROJECTION_COPY.uncertainty} />
          <Row label="Modelo" value={set.versions?.modelVersion ?? '—'} />
          {set.versionStale && <Row label="Versión" value={PROJECTION_COPY.stale} />}
        </Section>
        <Section title="Estado clínico supuesto (simulado)">
          {keys.map(k => (
            <Row key={k} label={k === 'sex' ? 'Sexo' : featureLabel(k)} value={
              <span>{featureValue(k, Number(projection.simulatedState[k]))}
                {projection.featureProvenance?.[k] && <span className="block text-[10px] font-normal text-muted-foreground">{PROVENANCE_LABEL[projection.featureProvenance[k]] ?? '—'}</span>}
              </span>
            } />
          ))}
        </Section>
      </div>
      <Section title="Supuestos">
        <Row label="Cigarrillos por día forzados a 0" value={projection.assumptionFlags?.cigsForcedZero ? `Sí — ${PROJECTION_COPY.cigsForcedZero}` : 'No'} />
        <Row label="Edad recalculada para la fecha objetivo" value={projection.assumptionFlags?.ageChangedFromAnchor ? 'Sí' : 'No'} />
      </Section>
    </div>
  )
}

export function RiskPointDetail({ point, predictionsById, forecastState, todayKey }: {
  point: RiskPoint | null
  predictionsById: Map<string, Prediction>
  forecastState: ForecastLoadState
  todayKey: string
}) {
  let body: React.ReactNode = <p className="text-xs text-muted-foreground" data-detail-kind="NONE">{POINT_DETAIL_PLACEHOLDER}</p>
  if (point?.kind === 'REAL') {
    const pred = predictionsById.get(point.predictionId)
    if (pred) body = <RealDetail prediction={pred} />
  } else if (point?.kind === 'PROJECTION' && forecastState.phase === 'ready') {
    const model = describeProjectionResponse(forecastState.response)
    const proj = model.kind === 'PROJECTIONS' ? model.projections.find(p => p.horizonIndex === point.horizonIndex) : undefined
    if (model.kind === 'PROJECTIONS' && proj) body = <ProjectionDetail set={model.set} projection={proj} todayKey={todayKey} />
  }
  return (
    <section aria-label="Detalle del punto" aria-live="polite" className="rounded-xl border border-border p-3" data-testid="risk-point-detail">
      <h4 className="text-sm font-semibold text-foreground mb-2">Detalle del punto</h4>
      {body}
    </section>
  )
}
