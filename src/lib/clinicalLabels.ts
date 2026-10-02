// R5 — single source of physician-facing labels/units for the 12 model
// feature keys exactly as they appear on the wire (AI feature_importance
// keys and longitudinal snapshot `features` keys). Display only: nothing
// here changes any stored value.

export const FEATURE_LABELS: Record<string, string> = {
  age:           'Edad',
  male:          'Sexo',
  currentSmoker: 'Tabaquismo actual',
  cigsPerDay:    'Cigarrillos por día',
  BPMeds:        'Medicación antihipertensiva',
  diabetes:      'Diabetes',
  totChol:       'Colesterol total',
  sysBP:         'Presión sistólica',
  diaBP:         'Presión diastólica',
  BMI:           'IMC',
  heartRate:     'Frecuencia cardíaca',
  glucose:       'Glucosa',
}

// Units follow the conventions already used in CardioSense
// (ClinicalSourceDisclosure / Indicadores clínicos): heart rate is 'bpm'.
export const FEATURE_UNITS: Record<string, string> = {
  totChol:    'mg/dL',
  glucose:    'mg/dL',
  sysBP:      'mmHg',
  diaBP:      'mmHg',
  BMI:        'kg/m²',
  heartRate:  'bpm',
  cigsPerDay: 'cigarrillos/día',
  age:        'años',
}

export function featureLabel(key: string): string {
  return FEATURE_LABELS[key] ?? key
}

export function featureUnit(key: string): string {
  return FEATURE_UNITS[key] ?? ''
}

// Slope is computed per calendar day between CardioSense records.
export function slopeUnit(key: string): string {
  const u = FEATURE_UNITS[key]
  if (!u || key === 'cigsPerDay') return ''
  return `${u}/día`
}

const nf = (max: number) => new Intl.NumberFormat('es-MX', { maximumFractionDigits: max, minimumFractionDigits: 0 })

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

// Plain measurement value, max 2 decimals. Missing → '—' (never coerced to 0).
export function formatMeasure(v: unknown, maxDecimals = 2): string {
  return isNum(v) ? nf(maxDecimals).format(v) : '—'
}

export function formatMeasureWithUnit(v: unknown, key: string, maxDecimals = 2): string {
  if (!isNum(v)) return '—'
  const u = featureUnit(key)
  return u ? `${formatMeasure(v, maxDecimals)} ${u}` : formatMeasure(v, maxDecimals)
}

// Signed difference: '+4', '−3,5', '0'. Uses the true minus sign for
// legibility. Never interprets direction as better/worse.
export function formatSigned(v: unknown, maxDecimals = 2): string {
  if (!isNum(v)) return '—'
  const rounded = Number(v.toFixed(maxDecimals))
  if (rounded === 0) return '0'
  const abs = nf(maxDecimals).format(Math.abs(rounded))
  return rounded > 0 ? `+${abs}` : `−${abs}`
}

export function formatSignedWithUnit(v: unknown, key: string, maxDecimals = 2): string {
  const s = formatSigned(v, maxDecimals)
  if (s === '—') return s
  const u = featureUnit(key)
  return u ? `${s} ${u}` : s
}

export function formatZ(v: unknown): string {
  return formatSigned(v, 1)
}

export function formatSlope(v: unknown, key: string): string {
  const s = formatSigned(v, 3)
  if (s === '—') return s
  const u = slopeUnit(key)
  return u ? `${s} ${u}` : s
}

export function formatDays(v: unknown): string {
  if (!isNum(v)) return '—'
  const n = Number(v.toFixed(1))
  const txt = nf(1).format(n)
  return n === 1 ? `${txt} día` : `${txt} días`
}

export function formatBinary(v: unknown): string {
  if (v === 1 || v === true) return 'Sí'
  if (v === 0 || v === false) return 'No'
  return '—'
}
