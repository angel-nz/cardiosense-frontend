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

// V3 — safely parses a "YYYY-MM-DD" business-date key for DISPLAY
// formatting. Anchored at UTC noon so that formatting the result with an
// explicit IANA `timeZone` (which every caller of this must do) can never
// roll the displayed calendar day backward or forward, regardless of the
// viewer's own browser/system timezone or the target zone's offset —
// midnight UTC would risk exactly that shift for a negative-offset zone
// like America/Mexico_City. This is the same noon-anchor pattern already
// used ad hoc elsewhere in the frontend (DashboardPage.tsx's
// shortWeekday(), PredictionsPage.tsx's monthLabel()/dayLabel()) —
// centralized here so V3's new formatLongDate() reuses one safe parsing
// rule instead of a fourth independent copy. This performs NO timezone
// conversion of the date-only value itself (§12) — it only chooses an
// instant that is unambiguous once formatted in an explicit zone.
export function parseBusinessDateKeyForDisplay(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00Z`)
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
// PREDICTION < RISK_CHANGE tie-break (Z2 removed ALERT) — this never
// re-sorts).
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

// W7 — pure "YYYY-MM-DD" business-day arithmetic, no timezone conversion
// involved (the key is already resolved to its business-timezone calendar
// day by whoever produced it — getBusinessDateKey or a literal key like
// PatientCalendar/DashboardCalendar's `selectedDateKey`). Uses Date.UTC
// purely as a calendar calculator: passing day 0 or day+1 beyond the
// month's length lets JS normalize the overflow, so month/year/leap-year
// boundaries (Oct 1 → Sep 30, Jan 1 → Dec 31, Mar 1 → Feb 29) are handled
// for free without any special-cased branch — same principle already used
// by calcAge()/backend lib/age.ts for calendar-based (not ms-based) date
// math. Never touches the wall-clock/timezone conversion step itself.
export function shiftBusinessDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const shifted = new Date(Date.UTC(y, m - 1, d + days))
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

// W7 — "today" resolved in the business timezone (never the browser's own
// local timezone or a raw UTC day comparison — see getBusinessDateKey's own
// comment on why `eventDate.slice(0, 10)` is unsafe near midnight; the same
// reasoning applies to comparing raw Date objects or `new Date().toISOString()`
// directly). Re-derived on each call rather than cached, so a session left
// open across a business-day boundary picks up the new day.
export function getTodayBusinessDateKey(): string {
  return getBusinessDateKey(new Date().toISOString())
}
