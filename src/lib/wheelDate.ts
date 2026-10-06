const pad = (n: number) => String(n).padStart(2, '0')

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

export function buildCivilDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`
}

export function clampCivilDate(year: number, month: number, day: number): string {
  return buildCivilDate(year, month, Math.min(Math.max(day, 1), daysInMonth(year, month)))
}

export function parseCivilDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null
  return { year, month, day }
}

export function clampCivilDateToBounds(value: string, min?: string, max?: string): string {
  if (min && value < min) return min
  if (max && value > max) return max
  return value
}
