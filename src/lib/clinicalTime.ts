// NEW S2E — explicit REAL clinical measurement time (measuredAt).
//
// Product rule (S1/S2A): the clinician's wall-clock date+time is ALWAYS
// interpreted in America/Mexico_City (BUSINESS_TIMEZONE), never in the
// browser's own timezone. `new Date(localInput)` is deliberately never used
// for that conversion — it would silently apply the viewer's machine zone.
//
// Only the native Intl API (IANA tz database) is used, same as
// businessDate.ts — no date library is added.
//
// Conversion rule for a wall time W in the canonical zone:
//   - every UTC instant whose wall time in the zone equals W exactly is a
//     candidate (the candidate offsets are the zone's offsets observed within
//     ±2 days of W, which covers every DST / historical offset transition);
//   - no candidate      → the wall time does not exist (DST gap) → rejected;
//   - several candidates → ambiguous (DST fall-back) → the EARLIER instant
//     (accepted S1 rule);
//   - output is always the exact millisecond UTC ISO form `…sssZ`.
import type { HealthRecord } from '@/types'
import { BUSINESS_TIMEZONE, getBusinessDateKey } from '@/lib/businessDate'
import { formatTime, formatRelativeBusinessDate } from '@/lib/utils'

export const CLINICAL_TIMEZONE = BUSINESS_TIMEZONE

// Same skew the backend accepts (record.service.ts MEASURED_AT_MAX_FUTURE_SKEW_MS).
// Client-side check only; the backend stays authoritative.
export const MEASURED_AT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000

const WALL_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: CLINICAL_TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
})

interface Wall { y: number; mo: number; d: number; h: number; mi: number; s: number }

function wallOf(ms: number): Wall {
  const parts: Record<string, string> = {}
  for (const p of WALL_FORMATTER.formatToParts(new Date(ms))) parts[p.type] = p.value
  return {
    y: Number(parts.year), mo: Number(parts.month), d: Number(parts.day),
    h: Number(parts.hour) % 24, mi: Number(parts.minute), s: Number(parts.second),
  }
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

// Zone offset (ms, wall − UTC) in force at the instant `ms` (whole seconds).
function offsetAt(ms: number): number {
  const w = wallOf(ms)
  const secondFloor = Math.floor(ms / 1000) * 1000
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - secondFloor
}

const LOCAL_INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

export type ClinicalTimeConversion =
  | { ok: true; iso: string }
  | { ok: false; error: 'MALFORMED' | 'NONEXISTENT' }

// "YYYY-MM-DDTHH:mm" (the <input type="datetime-local"> value) or with
// ":ss" → exact UTC instant. Independent of the browser/process timezone.
export function clinicalWallTimeToUtcIso(localInput: string): ClinicalTimeConversion {
  const m = LOCAL_INPUT_RE.exec(localInput.trim())
  if (!m) return { ok: false, error: 'MALFORMED' }
  const [y, mo, d, h, mi] = [1, 2, 3, 4, 5].map(i => Number(m[i]))
  const s = m[6] === undefined ? 0 : Number(m[6])
  if (y < 1000 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return { ok: false, error: 'MALFORMED' }
  // Calendar validity (rejects 2026-02-30, 2025-02-29, …) via UTC round-trip.
  const naive = Date.UTC(y, mo - 1, d, h, mi, s)
  const check = new Date(naive)
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return { ok: false, error: 'MALFORMED' }
  }
  const DAY = 86_400_000
  const offsets = new Set<number>()
  for (const delta of [-2 * DAY, -DAY, -DAY / 2, 0, DAY / 2, DAY, 2 * DAY]) offsets.add(offsetAt(naive + delta))
  const candidates: number[] = []
  for (const off of offsets) {
    const t = naive - off
    const w = wallOf(t)
    if (w.y === y && w.mo === mo && w.d === d && w.h === h && w.mi === mi && w.s === s) candidates.push(t)
  }
  if (candidates.length === 0) return { ok: false, error: 'NONEXISTENT' }
  return { ok: true, iso: new Date(Math.min(...candidates)).toISOString() }
}

// Current wall clock in the canonical zone, as a datetime-local value
// ("YYYY-MM-DDTHH:mm"). Used to initialize the form at open time.
export function nowClinicalLocalInput(now: Date = new Date()): string {
  const w = wallOf(now.getTime())
  return `${pad(w.y, 4)}-${pad(w.mo)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}`
}

export type MeasuredAtIssue =
  | 'REQUIRED'
  | 'MALFORMED'
  | 'NONEXISTENT'
  | 'MEASURED_AT_IN_FUTURE'
  | 'MEASURED_AT_BEFORE_BIRTH'

// Client-side checks that mirror the backend bounds (never a substitute for
// them). Never clamps or rewrites the clinician's value.
export function validateMeasuredAtInput(
  localInput: string, birthDate: string, now: Date = new Date(),
): { ok: true; iso: string } | { ok: false; issue: MeasuredAtIssue } {
  if (!localInput || !localInput.trim()) return { ok: false, issue: 'REQUIRED' }
  const conv = clinicalWallTimeToUtcIso(localInput)
  if (!conv.ok) return { ok: false, issue: conv.error }
  if (Date.parse(conv.iso) > now.getTime() + MEASURED_AT_MAX_FUTURE_SKEW_MS) return { ok: false, issue: 'MEASURED_AT_IN_FUTURE' }
  // Local clinical DAY vs birth date (date-only, "YYYY-MM-DD…").
  if (getBusinessDateKey(conv.iso) < birthDate.slice(0, 10)) return { ok: false, issue: 'MEASURED_AT_BEFORE_BIRTH' }
  return { ok: true, iso: conv.iso }
}

export const MEASURED_AT_MESSAGES: Record<MeasuredAtIssue, string> = {
  REQUIRED: 'Indica la fecha y hora de la medición.',
  MALFORMED: 'La fecha y hora de la medición no es válida.',
  NONEXISTENT: 'Esa hora no existe en la zona horaria de Guadalajara (cambio de horario). Elige otra hora.',
  MEASURED_AT_IN_FUTURE: 'La fecha y hora de la medición no puede estar en el futuro.',
  MEASURED_AT_BEFORE_BIRTH: 'La fecha de la medición no puede ser anterior a la fecha de nacimiento del paciente.',
}

// ─── Display of a record's clinical time ────────────────────────────────
// CLINICIAN_ENTERED → the explicit measured time. LEGACY_ENTRY_TIME → the
// entry time, ALWAYS labelled as such (never presented as a known
// measurement time).
export type RecordTimeSource = 'MEASURED' | 'LEGACY_ENTRY'

export function recordClinicalTime(
  r: Pick<HealthRecord, 'recordedAt' | 'measuredAt' | 'clinicalTimeSource'>,
): { instant: string; source: RecordTimeSource } {
  if (r.clinicalTimeSource === 'CLINICIAN_ENTERED' && r.measuredAt) return { instant: r.measuredAt, source: 'MEASURED' }
  return { instant: r.recordedAt, source: 'LEGACY_ENTRY' }
}

// "Hoy, 9:05 a.m." / "23 sep 2026, 9:05 a.m." — date AND time both resolved
// in the canonical clinical zone.
// S2E-FIX1 — "10 oct 2026" for a "YYYY-MM-DD" calendar day, formatted with an
// EXPLICIT zone (UTC on a noon-UTC anchor of a date-only value), so the day
// can never shift with the viewer's own timezone (date-fns `format` uses the
// browser zone and showed the next day at UTC+14).
const DAY_SHORT_FORMATTER = new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' })
export function formatDayKeyShort(dayKey: string): string {
  const parts = DAY_SHORT_FORMATTER.formatToParts(new Date(`${dayKey.slice(0, 10)}T12:00:00Z`))
  const get = (t: string) => parts.find(x => x.type === t)?.value ?? ''
  return `${get('day')} ${get('month').replace('.', '')} ${get('year')}`
}

export function formatClinicalDateTime(instant: string): string {
  const absolute = (input: string | Date) =>
    formatDayKeyShort(getBusinessDateKey(typeof input === 'string' ? input : input.toISOString()))
  const { label } = formatRelativeBusinessDate(instant, absolute)
  return `${label}, ${formatTime(instant, { timeZone: 'business' })}`
}

export const LEGACY_TIME_NOTE = 'sin hora de medición registrada'

// Single sentence-style label used where a record's time is shown.
export function clinicalTimeLabel(r: Pick<HealthRecord, 'recordedAt' | 'measuredAt' | 'clinicalTimeSource'>): string {
  const t = recordClinicalTime(r)
  return t.source === 'MEASURED'
    ? `Medición: ${formatClinicalDateTime(t.instant)}`
    : `Captura: ${formatClinicalDateTime(t.instant)} (${LEGACY_TIME_NOTE})`
}

// NEW S3 — clinical instant of a Prediction for ordering/grouping/calendar
// navigation: its SOURCE record's effective clinical time (measuredAt, or
// recordedAt for legacy rows); an unlinked Prediction falls back to its
// calculation time. predictedAt itself is only ever shown as "Calculada".
export function predictionClinicalInstant(p: { predictedAt: string; healthRecord: Pick<HealthRecord, 'recordedAt' | 'measuredAt' | 'clinicalTimeSource'> | null }): string {
  return p.healthRecord ? recordClinicalTime(p.healthRecord).instant : p.predictedAt
}
