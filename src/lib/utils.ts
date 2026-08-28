import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, differenceInYears, parseISO } from 'date-fns'
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

export function calcAge(birthDate: string): number {
  return differenceInYears(new Date(), parseISO(birthDate))
}

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
