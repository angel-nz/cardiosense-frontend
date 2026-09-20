import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import type { RiskLevel, AlertSeverity } from '@/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
export function formatDate(date: string | Date, pattern = 'dd MMM yyyy') {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, pattern, { locale: es })
}

export function formatDateTime(date: string | Date) {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'dd MMM yyyy, HH:mm', { locale: es })
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

// ─── Risk helpers ─────────────────────────────────────────────────────────────
export function getRiskLevel(score: number): RiskLevel {
  if (score < 0.35) return 'low'
  if (score < 0.65) return 'moderate'
  return 'high'
}

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
    bg: 'bg-teal-50',
    border: 'border-teal-200',
    text: 'text-teal-700',
    icon: '↓',
  },
  moderate: {
    label: 'Moderado',
    color: '#D97706',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    icon: '→',
  },
  high: {
    label: 'Alto',
    color: '#DC2626',
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-700',
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
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-700',
    dot: 'bg-blue-500',
  },
  warning: {
    label: 'Advertencia',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    dot: 'bg-amber-500',
  },
  critical: {
    label: 'Crítico',
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-700',
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
