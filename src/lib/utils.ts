import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import type { RiskLevel, AlertSeverity, User } from '@/types'
import {
  BUSINESS_TIMEZONE, parseBusinessDateKeyForDisplay,
  getBusinessDateKey, getTodayBusinessDateKey, shiftBusinessDateKey,
} from './businessDate'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
export function formatDate(date: string | Date, pattern = 'dd MMM yyyy') {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, pattern, { locale: es })
}

// V3 — canonical 12-hour, Spanish a.m./p.m. time presentation, shared by
// every user-visible clock time in the app (previously duplicated as
// `Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', ... })`
// in PatientCalendar/DashboardCalendar, which produces 24-hour output for
// the es-MX locale — the exact defect this replaces). Built on the 'en-US'
// locale specifically because it reliably yields plain "AM"/"PM" across
// ICU implementations; es-MX's own `dayPeriod` output is not deterministic
// across environments (can render "a. m."/"p. m." with a narrow no-break
// space, or "AM"/"PM" outright) — normalizing from a known-stable "AM"/"PM"
// source is safer than normalizing from an unpredictable one. `hour:
// 'numeric'` (not '2-digit') gives the no-leading-zero policy (§6):
// "9:05 a.m.", not "09:05 a.m."; minutes stay 2-digit via the formatter's
// own zero-padding.
//
// Two static instances: LOCAL leaves `timeZone` unset (matches the
// pre-V3 behavior of formatDateTime/formatDate, which always formatted in
// the viewer's own browser timezone via date-fns with no timeZone option —
// preserved here unchanged for every existing non-calendar consumer, so no
// displayed instant silently moves to a different clock time for a viewer
// outside America/Mexico_City). BUSINESS is only for the two Calendar
// components, which already explicitly pinned `timeZone: BUSINESS_TIMEZONE`
// for their own event-time formatting (grouped by business day) — this
// preserves that exact behavior, not a new one.
const TIME_FORMATTER_LOCAL = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric', minute: '2-digit', hour12: true,
})
const TIME_FORMATTER_BUSINESS = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric', minute: '2-digit', hour12: true, timeZone: BUSINESS_TIMEZONE,
})

function toSpanishMeridiem(formatted: string): string {
  // Only ever matches the formatter's own trailing " AM"/" PM" token — never
  // arbitrary text elsewhere in the string (§5's "avoid brittle
  // replacements" — this is anchored to the end of the string and to the
  // exact two literal tokens Intl's 'en-US' output can produce here).
  return formatted.replace(/ (AM|PM)$/, (_match, period: 'AM' | 'PM') =>
    period === 'AM' ? ' a.m.' : ' p.m.')
}

export interface FormatTimeOptions {
  // 'business' pins formatting to America/Mexico_City (BUSINESS_TIMEZONE);
  // omitted (default) formats in the viewer's own browser timezone, matching
  // every pre-V3 display consumer.
  timeZone?: 'business'
}

export function formatTime(date: string | Date, options?: FormatTimeOptions): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  const formatter = options?.timeZone === 'business' ? TIME_FORMATTER_BUSINESS : TIME_FORMATTER_LOCAL
  return toSpanishMeridiem(formatter.format(d))
}

export function formatDateTime(date: string | Date) {
  const d = typeof date === 'string' ? parseISO(date) : date
  // V3 — date portion unchanged (still date-fns, still viewer-local, same
  // 'dd MMM yyyy' shape as before); only the time portion changes, from
  // 'HH:mm' to the shared 12-hour a.m./p.m. formatter (§4: "Do not maintain
  // HH:mm presentation").
  return `${format(d, 'dd MMM yyyy', { locale: es })}, ${formatTime(d)}`
}

// V3 §7 — human-readable Spanish heading for a calendar selected-day
// section, e.g. "martes, 22 de septiembre de 2026" (deliberately NOT
// capitalized — Spanish weekday names are lowercase, and every current
// caller composes this mid-sentence: "Eventos del " + formatLongDate(...)).
// Takes a "YYYY-MM-DD" BUSINESS-date key (exactly what PatientCalendar/
// DashboardCalendar's `selectedDateKey` already is — see businessDate.ts),
// parsed via the same safe noon-anchor helper used elsewhere in the
// frontend, then formatted pinned to BUSINESS_TIMEZONE so the displayed
// weekday/day/month/year can never roll to an adjacent calendar day for a
// viewer outside America/Mexico_City (§7's "must not shift the displayed
// day").
const LONG_DATE_FORMATTER = new Intl.DateTimeFormat('es-MX', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: BUSINESS_TIMEZONE,
})

export function formatLongDate(businessDateKey: string): string {
  return LONG_DATE_FORMATTER.format(parseBusinessDateKeyForDisplay(businessDateKey))
}

// W7 — relative business-date presentation ("Hoy"/"Ayer"), display-only.
// Never used for form inputs, DTO payloads, query params, grouping/sort
// keys, or storage values — those keep using getBusinessDateKey/raw ISO
// exactly as before this block.
export interface RelativeBusinessDateResult {
  isRelative: boolean
  // "Hoy" | "Ayer" when isRelative, otherwise the caller's absolute
  // formatting (whatever style that surface already used before W7).
  label: string
}

// Accepts either a full ISO instant (Date or string with a time component —
// e.g. patient.createdAt, prediction.predictedAt) OR an already-resolved
// "YYYY-MM-DD" business-date key (e.g. PatientCalendar/DashboardCalendar's
// `selectedDateKey`). A bare key is compared directly, with NO Date
// reparsing — reparsing a date-only key as UTC midnight and then
// re-deriving its business day would itself reintroduce the exact
// near-midnight rollover bug getBusinessDateKey's own comment warns about,
// for a negative-offset zone like America/Mexico_City (a bare "YYYY-MM-DD"
// has no unambiguous UTC instant; parseBusinessDateKeyForDisplay's
// noon-anchor trick exists only for formatting an already-resolved key, not
// for re-deriving one). "Today"/"Yesterday" are always computed via
// getTodayBusinessDateKey()/shiftBusinessDateKey() — CardioSense business
// timezone, never the browser's local date or a raw UTC comparison.
function resolveBusinessDateKey(input: string | Date): string {
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input
  const iso = typeof input === 'string' ? input : input.toISOString()
  return getBusinessDateKey(iso)
}

export function formatRelativeBusinessDate(
  input: string | Date,
  absoluteFormatter: (input: string | Date) => string = formatDate,
): RelativeBusinessDateResult {
  const key = resolveBusinessDateKey(input)
  const todayKey = getTodayBusinessDateKey()
  if (key === todayKey) return { isRelative: true, label: 'Hoy' }
  if (key === shiftBusinessDateKey(todayKey, -1)) return { isRelative: true, label: 'Ayer' }
  return { isRelative: false, label: absoluteFormatter(input) }
}

// Date + time convenience wrapper for the many surfaces that previously
// called formatDateTime() directly. The TIME portion is deliberately
// unchanged from formatDateTime's existing behavior (viewer-local timezone,
// same 12-hour a.m./p.m. formatter) — W7 only changes how the DATE portion
// is chosen (business-date "Hoy"/"Ayer" vs. the prior absolute style), not
// which clock the time itself is displayed in (avoiding an unrelated
// visual/timezone change to every date+time surface in the app).
export function formatRelativeBusinessDateTime(input: string | Date): string {
  const { label } = formatRelativeBusinessDate(input)
  return `${label}, ${formatTime(input)}`
}

export function timeAgo(date: string | Date) {
  const d = typeof date === 'string' ? parseISO(date) : date
  return formatDistanceToNow(d, { addSuffix: true, locale: es })
}

// U4.2A — shared, canonical frontend age calculation (was previously
// date-fns-based, browser-local-timezone semantics — replaced here to match
// the backend's calendar-based approach, and to unify what had become 3
// divergent implementations: this one, backend lib/age.ts, and
// NewRecordModal's own local copy, now removed). `birthDate` is a
// date-only "YYYY-MM-DD" string (Paciente.birthDate, @db.Date on the
// backend) — parsed and compared by UTC calendar components only (never
// local Date methods), so the result never shifts by a day depending on
// the viewer's own timezone offset (e.g. Guadalajara, UTC-6). Reference
// point is always "now" — every current consumer (PatientDetailPage,
// PatientRow, NewRecordModal, EditPatientModal) displays CURRENT age, none
// need an arbitrary reference date. Feb 29 handled naturally by the same
// year/month/day calendar comparison the backend uses — a non-leap-year
// reference date increments on March 1, with no special-cased rule.
export function calcAge(birthDate: string): number {
  const [y, m, d] = birthDate.split('-').map(Number)
  const now = new Date()
  let age = now.getUTCFullYear() - y
  const monthDiff = (now.getUTCMonth() + 1) - m
  const dayDiff = now.getUTCDate() - d
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age--
  return age
}

// U4.2A — extracted from PatientCreatePage (its original, and still only,
// source) so PatientCreatePage and EditPatientModal validate CURP against
// the exact same official pattern instead of drifting into two regexes.
export const CURP_REGEX = /^[A-Z]{4}\d{6}[HM][A-Z]{5}\d{2}$/

// Z6 — shared between PatientCreatePage and EditPatientModal, same
// rationale as CURP_REGEX above: one quick client-side syntax check, not a
// second validation architecture. The backend (patient.dto.ts's
// PatientEmailField) remains the sole authority on what is actually
// accepted/normalized — this only gives immediate inline feedback.
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ─── Risk helpers ─────────────────────────────────────────────────────────────
// V4A — getRiskLevel(score) removed. It was a second, independent
// score→level classifier (thresholds ~0.35/0.65) that disagreed with the
// AI's real, canonical thresholds (0.20/0.35, in risk_thresholds.json) —
// its only consumer, RiskGauge, now receives the persisted Prediction.riskLevel
// directly instead. No frontend code may reclassify a semantic risk level
// from a numeric score; Prediction.riskLevel is the sole source of truth.
export const RISK_CONFIG: Record<RiskLevel, {
  label: string
  color: string
  bg: string
  border: string
  text: string
  icon: string
}> = {
  low: {
    label: 'Bajo',
    color: '#0D9488',
    bg: 'bg-teal-50 dark:bg-teal-950/40',
    border: 'border-teal-200 dark:border-teal-800/60',
    text: 'text-teal-700 dark:text-teal-300',
    icon: '↓',
  },
  moderate: {
    label: 'Moderado',
    color: '#D97706',
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    border: 'border-amber-200 dark:border-amber-800/60',
    text: 'text-amber-700 dark:text-amber-300',
    icon: '→',
  },
  high: {
    label: 'Alto',
    // Y6.2-FIX2 — was a static '#DC2626' (theme-invariant). RiskGauge
    // passes this straight through as an SVG stroke/fill attribute, which
    // already resolves CSS custom properties through the cascade (same
    // technique Y6.2 used for --border/--muted-foreground in this same
    // component) — so referencing the app's own --destructive token here
    // makes the HIGH-risk gauge automatically pick up a dark-tuned red
    // under .dark, with no new CSS var and no useTheme(). --destructive's
    // LIGHT value (hsl(0 72% 51%) ≈ #DC2828) is visually equivalent to the
    // previous static #DC2626 — not a light-mode change in practice. Only
    // `high` changes; `low`/`moderate` colors are untouched (out of
    // Y6.2-FIX2's scope). This is the SAME token used for the Dashboard
    // "Alto" bar and the Sidebar alert counter in Y6.2-FIX2, so all three
    // now share one canonical dark critical red.
    color: 'hsl(var(--destructive))',
    bg: 'bg-red-50 dark:bg-red-950/40',
    border: 'border-red-200 dark:border-red-800/60',
    text: 'text-red-700 dark:text-red-300',
    icon: '↑',
  },
}

export const SEVERITY_CONFIG: Record<AlertSeverity, {
  label: string
  bg: string
  border: string
  text: string
  dot: string
}> = {
  info: {
    label: 'Información',
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    border: 'border-blue-200 dark:border-blue-800/60',
    text: 'text-blue-700 dark:text-blue-300',
    dot: 'bg-blue-500',
  },
  warning: {
    label: 'Advertencia',
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    border: 'border-amber-200 dark:border-amber-800/60',
    text: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  critical: {
    label: 'Crítico',
    bg: 'bg-red-50 dark:bg-red-950/40',
    border: 'border-red-200 dark:border-red-800/60',
    text: 'text-red-700 dark:text-red-300',
    dot: 'bg-red-500',
  },
}

// ─── Number helpers ───────────────────────────────────────────────────────────
export function formatScore(score: number): string {
  return `${(score * 100).toFixed(1)}%`
}

export function formatNumber(n: number, decimals = 1): string {
  return n.toFixed(decimals)
}

// ─── Sex label ────────────────────────────────────────────────────────────────
export function sexLabel(sex: 0 | 1): string {
  return sex === 1 ? 'Masculino' : 'Femenino'
}

// ─── Full name ────────────────────────────────────────────────────────────────
export function fullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`
}

export function initials(firstName: string, lastName: string): string {
  return `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase()
}

// Z6-R1 §18 — small identity-block subtitle shared by Topbar/Sidebar/
// AvatarUploadSection (all three previously rendered `user.email` directly,
// which is no longer always present — a phone-only doctor has
// `email: null`). Never renders a literal "null"/"undefined": falls back
// to the account's other login identifier (Medico.phone) when email is
// absent, and to an empty string only if genuinely neither is set (a state
// the backend invariant should prevent, but this stays defensive rather
// than ever showing placeholder text as though it were real data).
export function userIdentifierLabel(user: Pick<User, 'email' | 'medico'>): string {
  return user.email ?? user.medico?.phone ?? ''
}
