import { useState } from 'react'
import { ChevronDown, ChevronRight, FileText } from 'lucide-react'
import { cn, formatRelativeBusinessDateTime } from '@/lib/utils'
import type { HealthRecord } from '@/types'

// V7 — additive clinical-context panel for a historical Prediction: "the
// clinical source values that produced it" alongside the existing
// Prediction result, never replacing it. `healthRecord` is the EXACT
// linked HealthRecord (Prediction.healthRecordId → HealthRecord, loaded
// backend-side via Prisma `include` — see prediction.repository.ts) —
// `null` means either a legacy Prediction with no linked record, or a
// record that no longer resolves. Never receives the patient's
// latest/current record as a substitute; the caller must pass exactly
// what predictionService normalized onto `Prediction.healthRecord`.
//
// Deliberately does NOT render Sex: HealthRecord has no persisted `sex`
// column (sex is read from Patient at prediction time — aiClient.ts —
// and Patient.sex is editable afterward via EditPatientModal), so the
// exact historical sex used for an old Prediction is not recoverable from
// persisted data. Presenting current Patient.sex here would misrepresent
// it as the historical input, which V-AGE-FIX's provenance principle
// (historical display must describe the data actually associated with
// that Prediction) forbids. See the V7 report's provenance-limitation
// section — this is a known, documented gap, not an oversight.
interface ClinicalSourceDisclosureProps {
  healthRecord: HealthRecord | null
  className?: string
}

// Exported for the V7 focused test harness (V7-F09/F10/F13/F14) — lets the
// harness verify the exact field list/labels and the null/boolean
// rendering rule against the real implementation, without rendering React.
export interface FieldSpec {
  key: keyof HealthRecord
  label: string
  unit?: string
  kind: 'number' | 'boolean'
}

// V7 §4/§10 — the model feature contract, minus `sex` (see above). Units
// match what CardioSense already establishes elsewhere for these exact
// fields (NewRecordModal / PredictionsPage's "Registro clínico más
// reciente" panel) — none invented here.
export const FIELDS: FieldSpec[] = [
  { key: 'age',           label: 'Edad',                               unit: 'años', kind: 'number' },
  { key: 'currentSmoker', label: 'Fumador actual',                                   kind: 'boolean' },
  { key: 'cigsPerDay',    label: 'Cigarrillos/día',                                  kind: 'number' },
  { key: 'bpMeds',        label: 'Medicamento para presión arterial',                kind: 'boolean' },
  { key: 'diabetes',      label: 'Diabetes',                                         kind: 'boolean' },
  { key: 'totChol',       label: 'Colesterol total',      unit: 'mg/dL',             kind: 'number' },
  { key: 'sysBP',         label: 'Presión sistólica',      unit: 'mmHg',             kind: 'number' },
  { key: 'diaBP',         label: 'Presión diastólica',     unit: 'mmHg',             kind: 'number' },
  { key: 'bmi',           label: 'IMC',                    unit: 'kg/m²',            kind: 'number' },
  { key: 'heartRate',     label: 'Frecuencia cardíaca',    unit: 'bpm',              kind: 'number' },
  { key: 'glucose',       label: 'Glucosa',                unit: 'mg/dL',            kind: 'number' },
]

// V7 §13 — neutral placeholder for a missing value; never coerced to 0/false.
// The current HealthRecord schema has no nullable clinical field (only
// `notes` is optional, and it isn't part of this contract), so this path
// is not reachable with today's data — kept as defensive rendering rather
// than an assumption that will always hold.
export function displayValue(record: HealthRecord, field: FieldSpec): string {
  const raw = record[field.key] as number | boolean | undefined | null
  if (raw === null || raw === undefined) return '—'
  if (field.kind === 'boolean') return raw ? 'Sí' : 'No'
  return field.unit ? `${raw} ${field.unit}` : `${raw}`
}

export function ClinicalSourceDisclosure({ healthRecord, className }: ClinicalSourceDisclosureProps) {
  const [open, setOpen] = useState(false)

  // V7 §3 — legacy/null provenance: honest neutral state, never the
  // patient's current/latest values substituted in its place.
  if (!healthRecord) {
    return (
      <p className={cn('text-xs text-muted-foreground italic', className)}>
        Sin datos clínicos vinculados
      </p>
    )
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        Datos clínicos utilizados
      </button>
      {open && (
        <div className="mt-2 bg-accent/30 rounded-lg border border-border p-3">
          {/* V7 §11 — source-record identification via the V3 canonical
              12-hour formatter; never a raw ISO timestamp. */}
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-2.5">
            <FileText className="w-3 h-3 flex-shrink-0" />
            Registro clínico: {formatRelativeBusinessDateTime(healthRecord.recordedAt)}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-xs">
            {FIELDS.map(field => (
              <div key={String(field.key)} className="flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground">{field.label}</span>
                <span className="font-medium text-foreground font-mono">{displayValue(healthRecord, field)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
