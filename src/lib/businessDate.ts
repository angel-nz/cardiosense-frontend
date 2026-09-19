// Patient Calendar — business-timezone date utilities (P3).
//
// The project's business timezone is America/Mexico_City (same convention
// already established server-side in backend/src/lib/timezone.ts for
// Dashboard "today"/"this week"). date-fns-tz is NOT installed in this
// project and was deliberately not added for P3 — these functions use only
// the native Intl.DateTimeFormat API, which correctly computes wall-clock
// dates in an explicit IANA zone regardless of the viewer's own browser/
// system timezone.

export const BUSINESS_TIMEZONE = 'America/Mexico_City'

const KEY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
})

// Converts an ISO UTC instant (as returned by GET /timeline's eventDate)
// into a stable "YYYY-MM-DD" key representing its calendar day in
// America/Mexico_City. Deliberately NOT `eventDate.slice(0, 10)` — that
// would yield the UTC calendar day, which can differ from the business day
// near midnight (see P3-TZ-02). en-CA locale formats as YYYY-MM-DD directly.
export function getBusinessDateKey(eventDate: string): string {
  return KEY_FORMATTER.format(new Date(eventDate))
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// "YYYY-MM-DD" for the 1st of the given month (both 1-indexed: month 1-12),
// and the 1st of the following month — the exact pair the real backend
// contract (patient.timeline.dto.ts) expects for from/to: calendar dates
// resolved to day boundaries in America/Mexico_City server-side, with `to`
// exclusive. No timezone conversion happens here — these are plain literal
// date strings for the query, not instants.
export function getMonthRange(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${pad(month)}-01`
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  const to = `${nextYear}-${pad(nextMonth)}-01`
  return { from, to }
}

export interface CalendarDay {
  dateKey: string        // "YYYY-MM-DD" in the business timezone
  dayOfMonth: number
  isCurrentMonth: boolean
  isToday: boolean
}

// Builds a Monday-first grid for the given month, padded with adjacent-month
// days so every row has 7 entries (matches the project's México-based
// convention already used elsewhere — e.g. weekly Dashboard stats start
// Monday). `todayKey` should be getBusinessDateKey(new Date().toISOString())
// from the caller, so "today" is also determined in the business timezone,
// not the browser's.
export function buildCalendarDays(year: number, month: number, todayKey: string): CalendarDay[] {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1))
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  // getUTCDay(): 0=Sunday..6=Saturday → convert to Monday-first index (0=Mon..6=Sun)
  const firstWeekdayMonFirst = (firstOfMonth.getUTCDay() + 6) % 7

  const days: CalendarDay[] = []

  // Leading days from the previous month
  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear = month === 1 ? year - 1 : year
  const daysInPrevMonth = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate()
  for (let i = firstWeekdayMonFirst - 1; i >= 0; i--) {
    const dayOfMonth = daysInPrevMonth - i
    const dateKey = `${prevYear}-${pad(prevMonth)}-${pad(dayOfMonth)}`
    days.push({ dateKey, dayOfMonth, isCurrentMonth: false, isToday: dateKey === todayKey })
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${year}-${pad(month)}-${pad(d)}`
    days.push({ dateKey, dayOfMonth: d, isCurrentMonth: true, isToday: dateKey === todayKey })
  }

  // Trailing days from the next month, padding to a multiple of 7
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  let trailing = 1
  while (days.length % 7 !== 0) {
    const dateKey = `${nextYear}-${pad(nextMonth)}-${pad(trailing)}`
    days.push({ dateKey, dayOfMonth: trailing, isCurrentMonth: false, isToday: dateKey === todayKey })
    trailing++
  }

  return days
}

// Groups events by their business-timezone calendar day, preserving the
// order they arrived in within each day (the backend already returns a
// globally deterministic order — eventDate ASC with a CLINICAL_RECORD <
// PREDICTION < RISK_CHANGE < ALERT tie-break — this never re-sorts).
export function groupEventsByBusinessDay<T extends { eventDate: string }>(
  events: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const event of events) {
    const key = getBusinessDateKey(event.eventDate)
    const bucket = map.get(key)
    if (bucket) bucket.push(event)
    else map.set(key, [event])
  }
  return map
}
