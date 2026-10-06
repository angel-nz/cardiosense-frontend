import { RISK_CONFIG, formatScore } from '@/lib/utils'
import { formatClinicalDateTime, LEGACY_TIME_NOTE } from '@/lib/clinicalTime'
import type { ClinicalRecordEventMetadata, PredictionEventMetadata, RiskChangeEventMetadata } from '@/types'

// NEW S2E-FIX3/FIX4 — shared by EVERY calendar surface (PatientCalendar,
// DashboardCalendar). Events are already placed by the backend at the record's
// effective clinical time (clinicalCalendar.ts); these lines only disclose
// provenance. Rendered as <span> blocks: rows can be <button>s.

// Under a CLINICAL_RECORD row: "Medición" vs "Captura — sin hora de medición
// registrada", plus the record's historical LEGACY_UNKNOWN predictions
// (neutral label, never "automatic"), each with its CALCULATION time, newest
// first. They are never independent calendar events. NEW S2E-FIX4 — manual
// reanalysis no longer exists, so nothing else is listed here.
export function RecordProvenance({ metadata }: { metadata: ClinicalRecordEventMetadata }) {
  return (
    <>
      <span className="block text-[11px] text-muted-foreground" data-provenance={metadata.clinicalTimeSource}>
        {metadata.clinicalTimeSource === 'CLINICIAN_ENTERED' ? 'Medición' : `Captura — ${LEGACY_TIME_NOTE}`}
      </span>
      {metadata.historicalPredictions.length > 0 && (
        <span className="block mt-1 space-y-0.5" data-testid="record-historical-predictions">
          {metadata.historicalPredictions.map(r => (
            <span key={r.predictionId} className="block text-[11px] text-muted-foreground" data-origin={r.origin}>
              Predicción histórica — origen no disponible
              {' · '}{formatScore(r.riskScore)} {RISK_CONFIG[r.riskLevel].label}
              {' · '}Calculada {formatClinicalDateTime(r.predictedAt)}
            </span>
          ))}
        </span>
      )}
    </>
  )
}

// Under a PREDICTION row (AUTOMATIC only): it belongs to its source record's
// clinical event; predictedAt is shown only as calculation time.
export function AutomaticPredictionProvenance({ metadata }: { metadata: PredictionEventMetadata }) {
  if (metadata.origin !== 'AUTOMATIC_HEALTH_RECORD') return null
  return (
    <span className="block text-[11px] text-muted-foreground mt-1" data-origin="AUTOMATIC_HEALTH_RECORD">
      Predicción automática del registro
      {metadata.predictedAt && <> · Calculada {formatClinicalDateTime(metadata.predictedAt)}</>}
    </span>
  )
}

// PRE-T-UX1 — placed at source measuredAt; calculation time is audit context.
export function RiskChangeProvenance({ metadata }: { metadata: RiskChangeEventMetadata }) {
  const generated = metadata.generatedAt ?? metadata.currentPredictedAt
  if (!metadata.clinicalAt && !generated) return null
  const kind = metadata.clinicalTimeSource === 'LEGACY_ENTRY_TIME' ? ` (captura — ${LEGACY_TIME_NOTE})` : ''
  return (
    <span className="block text-[11px] text-muted-foreground mt-1" data-testid="risk-change-provenance" data-provenance={metadata.clinicalTimeSource ?? undefined}>
      {generated && <span className="block">Cambio detectado: {formatClinicalDateTime(generated)}</span>}
      {metadata.clinicalAt && <span className="block">Fecha clínica del registro: {formatClinicalDateTime(metadata.clinicalAt)}{kind}</span>}
    </span>
  )
}
