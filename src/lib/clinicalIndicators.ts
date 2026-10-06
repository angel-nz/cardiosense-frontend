import type { Sex } from '../types'

/** Presentation-only adult, non-pregnancy policy. Never a Prediction riskLevel.
 * Evidence and source-to-UI mapping: docs/PRE-T-C-CLINICAL-SOURCES.md.
 * Compare raw values; do not round, clamp, impute, persist or send to Skorp.
 */
export type ClinicalIndicatorBand = 'LOW' | 'NORMAL' | 'HIGH' | 'VERY_HIGH'
export type ClinicalIndicator = 'sysBP' | 'diaBP' | 'totChol' | 'BMI' | 'glucose'
type Cutoffs = readonly [normalStart: number, highStart: number, veryHighStart: number]
type RangeContract = Readonly<Record<ClinicalIndicator, Cutoffs>>

const ADULT_CUTOFFS: RangeContract = Object.freeze({
  sysBP: Object.freeze([90, 120, 140] as const),
  diaBP: Object.freeze([60, 80, 90] as const),
  totChol: Object.freeze([120, 200, 240] as const),
  BMI: Object.freeze([18.5, 25, 30] as const),
  glucose: Object.freeze([70, 126, 200] as const),
})

// Separate contracts, intentionally identical. Canonical Sex: 0=female, 1=male.
// No inferred sex and no fallback to MALE for an unknown value.
export const CLINICAL_RANGE_CONTRACTS = Object.freeze({
  MALE: Object.freeze({ ...ADULT_CUTOFFS }),
  FEMALE: Object.freeze({ ...ADULT_CUTOFFS }),
})

export const CLINICAL_INDICATORS = Object.freeze([
  { indicator: 'sysBP', field: 'sysBP', name: 'Presión sistólica', unit: 'mmHg' },
  { indicator: 'diaBP', field: 'diaBP', name: 'Presión diastólica', unit: 'mmHg' },
  { indicator: 'totChol', field: 'totChol', name: 'Colesterol total', unit: 'mg/dL' },
  { indicator: 'BMI', field: 'bmi', name: 'IMC', unit: 'kg/m²' },
  { indicator: 'glucose', field: 'glucose', name: 'Glucosa casual', unit: 'mg/dL' },
] as const)

export const CLINICAL_BAND_LABELS = Object.freeze({
  LOW: 'Bajo', NORMAL: 'Normal', HIGH: 'Alto', VERY_HIGH: 'Muy alto',
} as const)

export interface ClinicalIndicatorResult {
  indicator: ClinicalIndicator
  value: number
  unit: 'mmHg' | 'mg/dL' | 'kg/m²'
  band: ClinicalIndicatorBand
  label: typeof CLINICAL_BAND_LABELS[ClinicalIndicatorBand]
}

export function isClinicalValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function classifyClinicalIndicator(
  indicator: ClinicalIndicator, value: unknown, sex: Sex | null | undefined,
): ClinicalIndicatorResult | null {
  if (!isClinicalValue(value) || (sex !== 0 && sex !== 1)) return null
  const contract = sex === 0 ? CLINICAL_RANGE_CONTRACTS.FEMALE : CLINICAL_RANGE_CONTRACTS.MALE
  const definition = CLINICAL_INDICATORS.find(item => item.indicator === indicator)
  if (!definition) return null // Defensive boundary for untyped data; no binary indicators.
  const [normal, high, veryHigh] = contract[indicator]
  const band: ClinicalIndicatorBand = value < normal ? 'LOW'
    : value < high ? 'NORMAL' : value < veryHigh ? 'HIGH' : 'VERY_HIGH'
  return { indicator, value, unit: definition.unit, band, label: CLINICAL_BAND_LABELS[band] }
}
