// NEW S2E — pure presentation logic for CURRENT risk PROJECTIONS (S2D).
//
// Semantic boundary (frozen): a projection is computed from an ASSUMED future
// clinical state. It is never an observed event, a HealthRecord, a
// Prediction, a diagnosis, a certainty, a calibrated interval or an Alert.
// Every S state shown here is a backend result — nothing is derived or
// recomputed client-side (no eligibility inference, no reclassification of
// risk level from the displayed percentage, no regeneration request).
import type {
  CurrentRiskProjectionResponse, ForecastRiskLevel, RiskLevel, RiskProjection, RiskProjectionSet,
} from '@/types'
import { formatDayKeyShort } from '@/lib/clinicalTime'

export const PROJECTION_COPY = {
  sectionTitle: 'Proyección de riesgo cardiovascular',
  projectionTag: 'Proyección',
  intro: 'Estimación calculada de las predicciones del historial clínico. No es una predicción real registrada.',
  primaryLabel: 'Estimación',
  targetDateLabel: 'Fecha estimada',
  horizon: (i: number) => `Horizonte ${i}`,
  targetAge: (age: number) => `Edad: ${age} años`,
  pastTarget: 'Fecha vencida — sin nuevo registro real',
  todayTarget: 'Fecha objetivo: hoy — sigue siendo una proyección mientras no exista un registro real',
  // NEW S4 — S-FEAT-SEQUENTIAL-ROBUST-2 copy (current policy).
  sequential: 'Proyección simulada, no es un evento clínico observado ni una medición garantizada.',
  sequentialNoDate: 'Proyección simulada, no es un evento clínico observado ni una medición garantizada.',
  sequentialContext: (ctx: string[]) => ctx.length === 0
    ? 'Estimación con el historial clínico.'
    : `Estimación con el historial clínico + ${ctx.map(c => c.replace('F', 'H')).join(' y ')}.`,
  multimodalCadence: 'Frecuencia multimodal detectada.',
  intervals: (xs: number[]) => `Próximos intervalos estimados: ${xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}` : xs.join('')} días.`,
  // S3 — S-FEAT-ROBUST-TREND-1 copy (previous policy; old S-2 sets until re-evaluated).
  trend: (fecha: string) =>
    `Proyección, no un evento clínico observado ni una medición garantizada. Valores futuros estimados a partir de la tendencia robusta del historial clínico disponible (último registro real: ${fecha}).`,
  trendNoDate: 'Proyección, no un evento clínico observado ni una medición garantizada. Valores futuros estimados a partir de la tendencia robusta del historial clínico disponible.',
  carriedStates: 'Tabaquismo, medicación antihipertensiva y diabetes se conservan como en el último registro: no se supone ningún cambio no observado.',
  // Superseded policy (S-FEAT-LOCF-1) — shown ONLY for an old, version-stale
  // set until it is re-evaluated, so its copy stays truthful.
  locfLegacy: (fecha: string) =>
    `Proyección calculada con la política anterior: los valores se mantenían como en el último registro real del ${fecha}.`,
  locfLegacyNoDate: 'Proyección calculada con la política anterior: los valores se mantenían como en el último registro real.',
  cigsForcedZero: 'Cigarrillos por día se proyecta como 0 porque el estado de fumador proyectado es no fumador.',
  global: 'Calculado con el modelo cardiovascular global.',
  individualized: 'Calculado con el modelo cardiovascular e historial clínico personal.',
  interpretationTagGlobal: 'Modelo global',
  interpretationTagIndividualized: 'Análisis personal',
  globalBaseline: (pct: string) => `Referencia del modelo global: ${pct}`,
  uncertainty: 'No cuantificada.',
  cadence: (days: number) => `${days} ${days === 1 ? 'día' : 'días'} aprox.`,
  computedAt: (when: string) => `Calculada: ${when}`,
  partial: (n: number) =>
    `Solo ${n === 1 ? 'una fecha objetivo queda' : `${n} fechas objetivo quedan`} dentro del rango que soporta el modelo; las demás no se proyectan.`,
  stale: 'Esta proyección fue calculada con una versión anterior del modelo o de la política de proyección.',
  failed: 'La proyección no está disponible temporalmente.',
  noSet: 'Aún no hay una evaluación de proyección disponible.',
  inactive: 'Las proyecciones no están activas para un paciente inactivo.',
  unavailable: 'La proyección no está disponible.',
  apiError: 'No se pudo cargar la proyección de riesgo.',
  refreshing: 'Actualizando proyección…',
} as const

// GLOBAL fallback reasons → subtle, non-alarming informational copy. Never
// the raw enum, never "degraded accuracy". Unknown reasons show nothing.
const BRIDGE_REASON_INFO: Record<string, string> = {
  BRIDGE_MISSING: 'Aún no hay un estado individualizado disponible para el último registro real.',
  BRIDGE_STATE_INVALID: 'Aún no hay un estado individualizado disponible para el último registro real.',
  BRIDGE_ANCHOR_MISMATCH: 'El estado individualizado disponible no corresponde al corte del historial clínico usado en esta proyección.',
  R_TIME_AXIS_MISMATCH: 'El estado individualizado disponible no corresponde al corte del historial clínico usado en esta proyección.',
  BRIDGE_SEX_MISMATCH: 'Los datos demográficos del paciente cambiaron después del último estado individualizado.',
  BRIDGE_AGE_MISMATCH: 'Los datos demográficos del paciente cambiaron después del último estado individualizado.',
  BRIDGE_MODEL_VERSION_MISMATCH: 'El estado individualizado disponible corresponde a otra versión del modelo.',
  BRIDGE_PERSONALIZATION_VERSION_MISMATCH: 'El estado individualizado disponible corresponde a otra versión del modelo.',
  BRIDGE_VERSION_MISMATCH: 'El estado individualizado disponible corresponde a otra versión del modelo.',
}

// NEW S3 — assumption copy for a projection set, by its persisted feature
// policy (old S-FEAT-LOCF-1 sets keep a truthful "previous policy" note).
export function projectionAssumptionCopy(set: Pick<RiskProjectionSet, 'versions' | 'anchor'>, formatDay: (d: string) => string): string {
  const day = set.anchor?.cutoffLocalDay ?? null
  if (set.versions?.featurePolicyVersion === 'S-FEAT-LOCF-1') return day ? PROJECTION_COPY.locfLegacy(formatDay(day)) : PROJECTION_COPY.locfLegacyNoDate
  if (set.versions?.featurePolicyVersion === 'S-FEAT-ROBUST-TREND-1') return day ? PROJECTION_COPY.trend(formatDay(day)) : PROJECTION_COPY.trendNoDate
  return day ? PROJECTION_COPY.sequential : PROJECTION_COPY.sequentialNoDate
}

// NEW S4 — truthful cadence copy: a multimodal cadence never shows one fake
// interval; it shows the projected interval sequence. Unimodal keeps the
// single-frequency sentence. Returns null when there is nothing to show.
export function cadenceCopy(cadence: RiskProjectionSet['cadence']): string[] | null {
  if (cadence.multimodal && cadence.intervalsDays && cadence.intervalsDays.length > 0) {
    return [PROJECTION_COPY.multimodalCadence, PROJECTION_COPY.intervals(cadence.intervalsDays)]
  }
  if (cadence.deltaDays !== null) return [PROJECTION_COPY.cadence(cadence.deltaDays)]
  return null
}

// NEW S3 — per-feature provenance labels (user-facing).
export const FEATURE_PROVENANCE_LABEL: Record<string, string> = {
  SEQUENTIAL_ROBUST_TREND: 'Tendencia robusta secuencial',
  SEQUENTIAL_ROBUST_FLAT:  'Tendencia estable (sin cambio estimado)',
  ROBUST_TREND:      'Tendencia robusta',
  ROBUST_TREND_FLAT: 'Tendencia estable (sin cambio estimado)',
  DERIVED:           'Derivado (edad en la fecha objetivo)',
  CARRY_FORWARD:     'Estado actual conservado',
  CONDITIONAL:       'Condicional (según estado de fumador)',
  LOCF:              'Último valor real (política anterior)',
}

export function globalFallbackInfo(reason: string | null | undefined): string | null {
  return reason ? BRIDGE_REASON_INFO[reason] ?? null : null
}

export type TargetDateState = 'FUTURE' | 'TODAY' | 'PAST'

// Both are "YYYY-MM-DD" (target DATE vs today's Guadalajara calendar date);
// lexical order == calendar order.
export function targetDateState(targetDate: string, todayKey: string): TargetDateState {
  if (targetDate < todayKey) return 'PAST'
  if (targetDate === todayKey) return 'TODAY'
  return 'FUTURE'
}

export function toBadgeLevel(level: ForecastRiskLevel): RiskLevel {
  return level === 'LOW' ? 'low' : level === 'MODERATE' ? 'moderate' : 'high'
}

// Same human-readable percentage form the app already uses (formatScore),
// computed from the persisted finalRiskScore only.
export function formatProjectionPercent(score: number): string {
  return `${(score * 100).toFixed(1)}%`
}

const LONG_DAY = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

// "22 de septiembre de 2026" from a "YYYY-MM-DD" clinical day (no tz shift).
export function formatClinicalDay(dayKey: string): string {
  return LONG_DAY.format(new Date(`${dayKey}T12:00:00Z`))
}

// "12 oct 2026" — same short style as the rest of the patient page, but
// timezone-explicit (S2E-FIX1): a targetDate is an America/Mexico_City
// calendar date and must render as that date in every viewer timezone.
export function formatTargetDate(dayKey: string): string {
  return formatDayKeyShort(dayKey)
}

// ─── state model ─────────────────────────────────────────────────────────
export interface ProjectionMessage {
  title: string
  body: string[]
}

export type ProjectionPanelModel =
  | { kind: 'MESSAGE'; message: ProjectionMessage; versionStale: boolean }
  | { kind: 'PROJECTIONS'; set: RiskProjectionSet; projections: RiskProjection[]; versionStale: boolean }

const msg = (title: string, ...body: string[]): ProjectionMessage => ({ title, body })

function eligibilityMessage(set: RiskProjectionSet): ProjectionMessage | null {
  const reason = set.eligibility.reason
  switch (set.eligibility.status) {
    case 'HISTORY_ABSENT':
      return msg('Aún no hay historial clínico',
        'Este paciente todavía no tiene registros clínicos. La proyección se calcula a partir de registros clínicos reales.')
    case 'HISTORY_INVALID':
      return msg('El historial clínico actual no permite calcular una proyección',
        reason === 'LATEST_RECORD_OUT_OF_MODEL_DOMAIN'
          ? 'El registro clínico más reciente está fuera del rango que soporta el modelo.'
          : 'El registro clínico más reciente no puede utilizarse para una proyección.')
    case 'CLINICAL_HISTORY_INSUFFICIENT': {
      const body = ['La proyección requiere al menos cuatro visitas clínicas con fecha y hora de medición registradas explícitamente. Los registros anteriores sin hora de medición no cuentan como visitas medidas.']
      if (reason === 'NO_MEASURED_CLINICAL_TIME') body.unshift('Ningún registro clínico de este paciente tiene fecha y hora de medición registrada.')
      if (reason === 'ANCHOR_CLINICAL_TIME_NOT_MEASURED') body.unshift('El registro clínico más reciente no tiene fecha y hora de medición registrada.')
      return msg('Se necesitan más visitas clínicas con hora de medición', ...body)
    }
    case 'FREQUENCY_UNRELIABLE':
      // Same plain copy for every cadence reason (incl. MULTIMODAL_CADENCE) — no jargon.
      return msg('La frecuencia de las visitas no permite fijar fechas de proyección',
        'Las visitas clínicas no tienen una frecuencia lo bastante regular para estimar las fechas objetivo.')
    case 'FORECAST_ELIGIBLE':
      return null
    default:
      return msg(PROJECTION_COPY.unavailable)
  }
}

// Maps a successful CURRENT response to what the panel shows.
export function describeProjectionResponse(resp: CurrentRiskProjectionResponse): ProjectionPanelModel {
  const set = resp.data
  const stale = !!set?.versionStale
  if (resp.lifecycle === 'PATIENT_INACTIVE') return { kind: 'MESSAGE', message: msg(PROJECTION_COPY.inactive), versionStale: false }
  if (resp.lifecycle !== 'ACTIVE') return { kind: 'MESSAGE', message: msg(PROJECTION_COPY.unavailable), versionStale: false }
  if (!set) return { kind: 'MESSAGE', message: msg(PROJECTION_COPY.noSet), versionStale: false }
  const elig = eligibilityMessage(set)
  if (elig) return { kind: 'MESSAGE', message: elig, versionStale: stale }
  switch (set.generation.status) {
    case 'FAILED':
      return { kind: 'MESSAGE', message: msg(PROJECTION_COPY.failed), versionStale: stale }
    case 'NONE_ADMISSIBLE':
      return { kind: 'MESSAGE', versionStale: stale, message: msg('Sin fechas objetivo dentro del rango del modelo',
        'Las fechas objetivo estimadas quedan fuera del rango que soporta el modelo, por lo que no se generan proyecciones.') }
    case 'GENERATED_FULL':
    case 'GENERATED_PARTIAL': {
      const projections = [...set.projections].sort((a, b) => a.horizonIndex - b.horizonIndex).slice(0, 3)
      if (projections.length === 0) return { kind: 'MESSAGE', message: msg(PROJECTION_COPY.unavailable), versionStale: stale }
      return { kind: 'PROJECTIONS', set, projections, versionStale: stale }
    }
    default:
      return { kind: 'MESSAGE', message: msg(PROJECTION_COPY.unavailable), versionStale: stale }
  }
}
