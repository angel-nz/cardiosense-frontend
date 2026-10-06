export type Meridiem = 'AM' | 'PM'

export interface Time12Value {
  hour: number
  minute: number
  period: Meridiem
}

const TIME_24_RE = /^(\d{2}):(\d{2})$/

export function parseTime24(value: string): Time12Value | null {
  const match = TIME_24_RE.exec(value.trim())
  if (!match) return null
  const hour24 = Number(match[1])
  const minute = Number(match[2])
  if (hour24 < 0 || hour24 > 23 || minute < 0 || minute > 59) return null
  return {
    hour: hour24 % 12 || 12,
    minute,
    period: hour24 < 12 ? 'AM' : 'PM',
  }
}

export function toTime24({ hour, minute, period }: Time12Value): string {
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return ''
  const hour24 = period === 'AM' ? hour % 12 : (hour % 12) + 12
  return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function formatTime12(value: string): string {
  const parsed = parseTime24(value)
  if (!parsed) return 'Seleccionar hora'
  return `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')} ${parsed.period === 'AM' ? 'a. m.' : 'p. m.'}`
}
