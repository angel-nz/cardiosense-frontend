import { RISK_CONFIG } from '@/lib/utils'
import { formatClinicalDateTime, recordClinicalTime, LEGACY_TIME_NOTE } from '@/lib/clinicalTime'
import { featureLabel, formatMeasureWithUnit, formatBinary } from '@/lib/clinicalLabels'
import { PROJECTION_COPY, FEATURE_PROVENANCE_LABEL, projectionAssumptionCopy, cadenceCopy, formatClinicalDay, formatProjectionPercent, formatTargetDate, toBadgeLevel, describeProjectionResponse } from '@/lib/riskProjection'
import { ORIGIN_LABEL, type RiskPoint } from '@/lib/riskEvolution'
import type { ForecastLoadState } from '@/hooks/useCurrentRiskForecast'
import type { Prediction, RiskProjection, RiskProjectionSet } from '@/types'

// NEW S2E-FIX3 → FIX4 — COMPLETE public description of one risk-chart point,
// rendered INSIDE the selected point's floating box of the full-history modal
// (FIX4 removed the permanent "Detalle del punto" section below the chart):
//   REAL       → the public Prediction contract + its source HealthRecord.
//   PROJECTION → the S2D allowlist projection fields (never called observed).
// Never shows appliedLogit, sexUsed bridge state, R provenance JSON or
// fingerprints (none of them exist in the frontend models).

// NEW S3 — provenance labels shared with the projection copy.
const PROVENANCE_LABEL = FEATURE_PROVENANCE_LABEL

// Display order of the model feature keys (simulated state / provenance).
const FEATURE_ORDER = ['age', 'sex', 'currentSmoker', 'cigsPerDay', 'BPMeds', 'diabetes', 'totChol', 'sysBP', 'diaBP', 'BMI', 'heartRate', 'glucose']
const BINARY = new Set(['currentSmoker', 'BPMeds', 'diabetes'])

// Two columns when the floating box is wide enough, one otherwise.
const AUTO_COLUMNS: React.CSSProperties = { gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))' }

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
    <div className="grid gap-3" style={AUTO_COLUMNS} data-detail-kind="REAL">
      <Section title="Predicción (registro real)">
        <Row label="Origen" value={ORIGIN_LABEL[prediction.origin]} />
        <Row label="Riesgo" value={formatProjectionPercent(prediction.riskScore)} />
        <Row label="Nivel de riesgo" value={RISK_CONFIG[prediction.riskLevel].label} />
        <Row label="Anomalía" value={prediction.isAnomaly ? 'Sí' : 'No'} />
        <Row label="Puntaje de anomalía" value={Number.isFinite(prediction.anomalyScore) ? prediction.anomalyScore.toFixed(4) : '—'} />
        <Row label="Modelo" value={prediction.modelVersion || '—'} />
        <Row label="Calculada (hora de cálculo)" value={formatClinicalDateTime(prediction.predictedAt)} />
      </Section>
      <Section title="Registro clínico de origen">
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
            <Row label="Frecuencia cardíaca" value={formatMeasureWithUnit(r.heartRate, 'heartRate')} />
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
      <div className="grid gap-3" style={AUTO_COLUMNS}>
        <Section title="Proyección">
          <Row label="Horizonte" value={projection.horizonIndex} />
          <Row label={PROJECTION_COPY.targetDateLabel} value={formatTargetDate(projection.targetDate)} />
          {passed && <Row label="Estado" value={PROJECTION_COPY.pastTarget} />}
          {today && <Row label="Estado" value="Fecha objetivo: hoy — sigue siendo una proyección" />}
          <Row label="Edad en la fecha objetivo" value={`${projection.targetAge} años`} />
          <Row label={PROJECTION_COPY.primaryLabel} value={formatProjectionPercent(projection.finalRiskScore)} />
          <Row label="Referencia del modelo global" value={formatProjectionPercent(projection.globalRiskScore)} />
          <Row label="Nivel de riesgo" value={RISK_CONFIG[toBadgeLevel(projection.riskLevel)].label} />
          <Row label="Interpretación" value={individualized ? PROJECTION_COPY.individualized : PROJECTION_COPY.global} />
          <Row label="Incertidumbre" value={PROJECTION_COPY.uncertainty} />
          <Row label="Modelo" value={set.versions?.modelVersion ?? '—'} />
          {set.versions && <Row label="Política de proyección" value={`${set.versions.sVersion} · ${set.versions.featurePolicyVersion} · ${set.versions.cadencePolicyVersion}`} />}
          {/* NEW S4 — which simulated horizons of the same run informed this one */}
          {projection.sequentialContext && <Row label="Contexto de la estimación" value={PROJECTION_COPY.sequentialContext(projection.sequentialContext.simulatedContext)} />}
          {cadenceCopy(set.cadence) && <Row label="Frecuencia de visitas" value={cadenceCopy(set.cadence)!.join(' ')} />}
          {set.versionStale && <Row label="Versión" value={PROJECTION_COPY.stale} />}
        </Section>
        <Section title="Estado clínico futuro estimado (simulado)">
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
        {set.versions?.featurePolicyVersion !== 'S-FEAT-LOCF-1' && <Row label="Estados discretos" value={PROJECTION_COPY.carriedStates} />}
      </Section>
    </div>
  )
}

export function RiskPointFullDetail({ point, predictionsById, forecastState, todayKey }: {
  point: RiskPoint
  predictionsById: Map<string, Prediction>
  forecastState: ForecastLoadState
  todayKey: string
}): React.ReactElement | null {
  if (point.kind === 'REAL') {
    const pred = predictionsById.get(point.predictionId)
    return pred ? <RealDetail prediction={pred} /> : null
  }
  if (forecastState.phase !== 'ready') return null
  const model = describeProjectionResponse(forecastState.response)
  const proj = model.kind === 'PROJECTIONS' ? model.projections.find(p => p.horizonIndex === point.horizonIndex) : undefined
  return model.kind === 'PROJECTIONS' && proj ? <ProjectionDetail set={model.set} projection={proj} todayKey={todayKey} /> : null
}
