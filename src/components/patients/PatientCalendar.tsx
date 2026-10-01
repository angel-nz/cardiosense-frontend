import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import {
  Activity, ChevronLeft, ChevronRight, FileText,
  ArrowRight, AlertTriangle, Loader2,
  Calendar,
} from 'lucide-react'
import { cn, formatScore, formatLongDate, formatTime, formatRelativeBusinessDate, RISK_CONFIG } from '@/lib/utils'
import { BUSINESS_TIMEZONE, getBusinessDateKey, getMonthRange, buildCalendarDays, groupEventsByBusinessDay } from '@/lib/businessDate'
import { timelineService } from '@/services/timelineService'
import { RiskBadge } from '@/components/ui/RiskBadge'
import { useSocket } from '@/context/SocketContext'
import { groupTimelineEventsForRender } from '@/lib/timelineGrouping'
import { TimelineEventGroup } from '@/components/timeline/TimelineEventGroup'
import type { PatientTimelineEvent } from '@/types'

// P5 — how long to wait before actually refetching after a realtime signal,
// purely to coalesce a rapid burst (health_record_created → prediction_completed
// → new_alert can all arrive within milliseconds of each other for the same
// action) into a single GET instead of one per event. NOT a wait for backend
// persistence — Q6 already guarantees persist-before-emit, so any signal is
// safe to act on immediately; this only debounces the *frontend request*,
// short enough to be imperceptible as a delay.
const REALTIME_COALESCE_MS = 400

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat('es-MX', {
  month: 'long', year: 'numeric', timeZone: BUSINESS_TIMEZONE,
})

interface PatientCalendarProps {
  patientId: string
  // P4 — cross-navigation into the longitudinal views already rendered by
  // PatientDetailPage.
  onSelectHealthRecord?: (healthRecordId: string) => void
  onSelectPrediction?: (predictionId: string) => void
  // P4-FIX — called whenever the Calendar's own temporal context changes
  // (day, month, "Hoy") in a way that invalidates whichever external
  // target (Clinical History row / Risk Evolution point) a previous
  // Calendar click had selected. PatientCalendar doesn't know or touch the
  // parent's selectedHealthRecordId/selectedPredictionId directly — it only
  // signals "the event I selected is no longer the current context";
  // PatientDetailPage decides how to clear its own state.
  onSelectionClear?: () => void
  // Feedback for a click whose target isn't in the currently-loaded
  // longitudinal window (e.g. a Prediction older than the last 20) — owned
  // by the parent, since only it knows what's actually loaded.
  feedback?: string | null
  // O3-FIX-5 — an external instruction to position and select a specific
  // timeline event on arrival (Dashboard Calendar → PatientDetailPage →
  // here). `eventId` is the Calendar event's own `.id` (for RISK_CHANGE
  // this is `risk-change:{currentPredictionId}`, NOT a Prediction id — see
  // PatientDetailPage/DashboardCalendar). `eventDate` resolves which
  // business month/day to open. PatientCalendar remains the sole owner of
  // its own viewYear/viewMonth/events/fetch — this is a one-shot "go here"
  // request, not a hand-over of control (section 10/11).
  navigationTarget?: { eventId: string; eventDate: string } | null
}

export function PatientCalendar({
  patientId, onSelectHealthRecord, onSelectPrediction, onSelectionClear, feedback, navigationTarget,
}: PatientCalendarProps) {
  const now = new Date()
  // P5 — passive listener only: reads the already-flowing signals from the
  // SAME subscription PatientDetailPage already owns (subscribeToPatient/
  // unsubscribeFromPatient) for this exact patientId. Never calls
  // subscribe/unsubscribe itself — doing so here too would be a duplicate,
  // redundant subscription for the same room (section 36).
  const {
    connected, lastHealthRecord, lastPrediction, lastAlert,
    clearLastHealthRecord, clearLastPrediction,
  } = useSocket()
  const todayKey = useMemo(() => getBusinessDateKey(new Date().toISOString()), [])
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1) // 1-12
  const [events, setEvents] = useState<PatientTimelineEvent[]>([])
  // O3-FIX-5A — which month `events` currently represents ("YYYY-MM"),
  // set atomically together with setEvents inside loadMonth. This is the
  // ground-truth readiness signal for the navigationTarget effect below —
  // `loading` alone is NOT reliable for that purpose: within the SAME
  // commit where the mount effect (`useEffect(() => { loadMonth() },
  // [loadMonth])`, declared earlier) calls loadMonth() and synchronously
  // sets loading=true, an effect declared later in this component (the
  // navigationTarget one) still sees that render's STALE loading=false —
  // state updates from an earlier effect in the same flush aren't visible
  // to a later effect until the next render. That stale read is exactly
  // what let a same-month target be marked "consumed" against a still-
  // empty `events` before the real fetch had a chance to resolve.
  const [loadedMonthKey, setLoadedMonthKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // P3-02 UX fix: initializes to *today*, not null — opening the calendar
  // (mount, or switching patients below) shows today's activity immediately,
  // with no extra click. Manual selection (any day click) and month
  // navigation (which nulls this — see goToPrevMonth/goToNextMonth) are the
  // only other ways this changes; only the explicit "Hoy" button re-selects
  // today deliberately.
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(todayKey)
  // Which event row (by its own timeline id) is currently highlighted
  // inside the day panel — distinct from selectedDateKey (which *day* is
  // open) and from the parent's selectedHealthRecordId/selectedPredictionId
  // (which *external* target is highlighted in History/Risk Evolution).
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const coalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasConnectedOnceRef = useRef(false)
  // P4-FIX — single explicit cleanup point, called directly from every
  // action that changes the Calendar's temporal context (day click, month
  // nav, "Hoy", patient switch) rather than reactively from a `useEffect`
  // watching selectedDateKey. This matters concretely for "Hoy": if the
  // user is already viewing today with an event selected and presses "Hoy"
  // again, `setSelectedDateKey(todayKey)` sets the *same* string value —
  // React bails out of that state update entirely, so an effect keyed on
  // selectedDateKey would never re-run and the stale selection would
  // survive. Calling this explicitly at the action site has no such gap,
  // and also avoids any effect→parent-state→child-render→effect loop
  // (section 11) since it's never triggered reactively.
  const clearEventSelection = useCallback(() => {
    setSelectedEventId(null)
    onSelectionClear?.()
  }, [onSelectionClear])

  // Switching patients (A → B): reset to the current month and clear the
  // selection/events synchronously, before the new patient's data ever
  // arrives — otherwise Patient A's events could remain visible, briefly
  // mislabeled as Patient B's, for the duration of the first request.
  // Reselects *today* (not null) — opening a different patient's calendar
  // is, semantically, the same "initial entry" moment as Case A.
  // (PatientDetailPage already clears its own external selection
  // independently on patientId change — calling onSelectionClear here too
  // is redundant but harmless, kept for symmetry/defense-in-depth.)
  useEffect(() => {
    const today = new Date()
    setViewYear(today.getFullYear())
    setViewMonth(today.getMonth() + 1)
    setSelectedDateKey(todayKey)
    setSelectedEventId(null)
    setEvents([])
    setLoadedMonthKey(null)
    setError('')
    onSelectionClear?.()
    // A Dashboard navigation target belongs to whichever patient it named —
    // switching patients must not let a stale, already-consumed (or
    // not-yet-consumed) target from Patient A apply itself to Patient B.
    navTargetConsumedIdRef.current = null
    // A pending coalesced refresh belongs to whichever patient scheduled
    // it — switching patients must not let a stale timer for the PREVIOUS
    // patient later overwrite this component's (now Patient B's) events
    // (section 22).
    if (coalesceTimerRef.current) {
      clearTimeout(coalesceTimerRef.current)
      coalesceTimerRef.current = null
    }
  }, [patientId, todayKey, onSelectionClear])

  // silent=true (realtime/reconnect-triggered): fetch and replace `events`
  // exactly as normal, but never toggle the loading spinner and never
  // surface a fetch error — a background sync failing shouldn't blank out
  // an already-valid, already-visible calendar (section 30/31). The user's
  // own explicit actions (month nav, Retry) always call this non-silent.
  const loadMonth = useCallback(async (silent = false) => {
    const requestId = ++requestIdRef.current
    if (!silent) { setLoading(true); setError('') }
    try {
      const { from, to } = getMonthRange(viewYear, viewMonth)
      const result = await timelineService.getPatientTimeline(patientId, { from, to })
      // Ignore stale responses — e.g. Sep → Oct → Nov navigated quickly;
      // a slow Sep response must never overwrite Nov's already-rendered data.
      if (requestId !== requestIdRef.current) return
      setEvents(result)
      setLoadedMonthKey(`${viewYear}-${String(viewMonth).padStart(2, '0')}`)
    } catch {
      if (requestId !== requestIdRef.current || silent) return
      setError('No se pudo cargar la actividad cardiovascular de este periodo.')
    } finally {
      if (requestId === requestIdRef.current && !silent) setLoading(false)
    }
  }, [patientId, viewYear, viewMonth])

  useEffect(() => { loadMonth() }, [loadMonth])

  // P5 — coalesced background refresh, shared by both realtime signals and
  // reconnect resync below. Debounced (not instant) purely to collapse a
  // rapid health_record_created → prediction_completed → new_alert burst
  // from the same action into one GET — never to wait for persistence
  // (Q6 already guarantees persist-before-emit).
  const scheduleCoalescedRefresh = useCallback(() => {
    if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current)
    coalesceTimerRef.current = setTimeout(() => {
      coalesceTimerRef.current = null
      loadMonth(true)
    }, REALTIME_COALESCE_MS)
  }, [loadMonth])

  // Cleanup pending timer on unmount (section: no update/warning after
  // Calendar is gone).
  useEffect(() => {
    return () => {
      if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current)
    }
  }, [])

  // health_record_created / prediction_completed / new_alert — canonical
  // refetch, never a hand-built TimelineEvent from the (intentionally
  // minimal) socket payload. Filtered by patientId even though the patient
  // room already scopes delivery, matching the same defensive pattern
  // PatientDetailPage already uses for prediction_completed. A matched
  // event's date isn't checked against the currently-visible month before
  // deciding to refetch (section 28) — simpler and always correct, at the
  // cost of an occasional refetch whose result doesn't visibly change
  // anything if the event actually falls outside the visible range.
  useEffect(() => {
    const relevant =
      lastHealthRecord?.patientId === patientId ||
      lastPrediction?.patientId === patientId ||
      lastAlert?.patientId === patientId
    if (!relevant) return
    scheduleCoalescedRefresh()
    if (lastHealthRecord?.patientId === patientId) clearLastHealthRecord()
    if (lastPrediction?.patientId === patientId) clearLastPrediction()
    // PRE-Y8 FIX1 (Alert Toast Gap) — `lastAlert` is READ here only as a
    // "refresh my calendar" signal (via `relevant` above); it is
    // deliberately never cleared/consumed by this component. Its
    // lifecycle belongs exclusively to AppLayout/AlertToast (AppLayout
    // renders `<AlertToast alert={lastAlert} onClose={clearLastAlert} />`
    // and only THAT `onClose` — auto-close or manual dismiss — is allowed
    // to clear it; see AlertsContext.tsx's own comment: "AppLayout's
    // toast owns that lifecycle"). This component previously also called
    // clearLastAlert() here, which raced AppLayout's toast render
    // whenever both were mounted for the same patient (i.e. whenever the
    // doctor was viewing this patient's own detail page when a qualifying
    // automatic prediction fired) — the toast could be torn down again
    // before it was ever seen. Removed; `lastHealthRecord`/`lastPrediction`
    // are untouched — THEIR clearing here is unrelated, pre-existing,
    // intentional ownership that this fix does not touch.
  }, [
    patientId, lastHealthRecord, lastPrediction, lastAlert, scheduleCoalescedRefresh,
    clearLastHealthRecord, clearLastPrediction,
  ])

  // Reconnect resync (sections 33-35). `connected` also becomes true on the
  // very first successful connection — skip exactly that one occurrence,
  // since the mount-driven `loadMonth()` effect above already covers it;
  // every SUBSEQUENT true is a genuine reconnect. By the time this effect
  // runs, SocketContext's own `connect` handler has already synchronously
  // re-emitted subscribe_patient for whatever PatientDetailPage currently
  // desires — so the ordering (reconnect → resubscribe → resync) holds
  // without any extra coordination here.
  useEffect(() => {
    if (!connected) return
    if (!hasConnectedOnceRef.current) {
      hasConnectedOnceRef.current = true
      return
    }
    scheduleCoalescedRefresh()
  }, [connected, scheduleCoalescedRefresh])

  // After ANY refetch (realtime, reconnect, or a normal month/day action),
  // a previously-selected event might no longer be present in the
  // canonical data (defensive — current sources are effectively
  // append-only, so this should rarely trigger in practice). Never leave
  // an orphaned highlight pointing at data that no longer confirms it.
  useEffect(() => {
    if (!selectedEventId) return
    if (!events.some(e => e.id === selectedEventId)) {
      setSelectedEventId(null)
      onSelectionClear?.()
    }
  }, [events, selectedEventId, onSelectionClear])

  // O3-FIX-5/5A — external navigation target (Dashboard Calendar → this
  // patient's Calendar). Consumed at most once per distinct target
  // (navTargetConsumedIdRef, compared by eventId — robust to the parent
  // passing a fresh object each render, since only the underlying id is
  // compared, not object identity). Three phases:
  //   1. Target's business month differs from the one currently shown →
  //      switch viewYear/viewMonth directly (NOT goToPrevMonth/
  //      goToNextMonth — those call clearEventSelection(), which would
  //      wrongly clear the EXTERNAL selection PatientDetailPage just
  //      applied from the very same navigation). loadMonth's own reactive
  //      effect (keyed on viewYear/viewMonth) fetches the new month; this
  //      effect re-runs again once that resolves.
  //   2. `loadedMonthKey` (set atomically with `events` inside loadMonth —
  //      see its declaration) doesn't yet match the target's month → wait.
  //      This is the O3-FIX-5A correction: the previous version gated on
  //      `loading` instead, which is unreliable in the exact same-render
  //      case demonstrated in that report (a same-month target could see
  //      loading's stale pre-fetch value in the same commit the mount
  //      effect kicked off the request, and get marked "consumed" against
  //      a still-empty `events`). `loadedMonthKey` has no such staleness
  //      window: it's set in the same state batch as the `events` it
  //      describes, so "does it match the target's month" is always an
  //      accurate answer to "is `events` the canonical data I need".
  //   3. Correct month's data is in → select the business day always
  //      (useful context even if the specific event turns out to be
  //      missing), and select/highlight the event ONLY if its exact id is
  //      present — never an approximate match (section 18 of FIX-5).
  const navTargetConsumedIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!navigationTarget) return
    if (navTargetConsumedIdRef.current === navigationTarget.eventId) return

    const targetDateKey = getBusinessDateKey(navigationTarget.eventDate)
    const [targetYear, targetMonth] = targetDateKey.split('-').map(Number)
    const targetMonthKey = `${targetYear}-${String(targetMonth).padStart(2, '0')}`

    if (targetYear !== viewYear || targetMonth !== viewMonth) {
      setSelectedEventId(null)
      setViewYear(targetYear)
      setViewMonth(targetMonth)
      return
    }
    if (loadedMonthKey !== targetMonthKey) return

    navTargetConsumedIdRef.current = navigationTarget.eventId
    setSelectedDateKey(targetDateKey)
    if (events.some(e => e.id === navigationTarget.eventId)) {
      setSelectedEventId(navigationTarget.eventId)
    }
    // else: day is still selected as useful context, but no event is
    // highlighted — this month's canonical timeline simply doesn't
    // contain that id (e.g. a real gap, not something to guess around).
    // Marked consumed regardless (section 7 of FIX-5A) — a genuinely
    // missing event must resolve once, not retry indefinitely; if the
    // fetch itself had FAILED instead (not just "not found"), loadedMonthKey
    // would simply never reach targetMonthKey and this effect keeps
    // waiting harmlessly (no automatic retry loop, no polling) until the
    // user's own Retry succeeds.
  }, [navigationTarget, viewYear, viewMonth, loadedMonthKey, events])

  const days = useMemo(() => buildCalendarDays(viewYear, viewMonth, todayKey), [viewYear, viewMonth, todayKey])
  const eventsByDay = useMemo(() => groupEventsByBusinessDay(events), [events])
  const monthLabel = useMemo(
    () => MONTH_LABEL_FORMATTER.format(new Date(Date.UTC(viewYear, viewMonth - 1, 15))),
    [viewYear, viewMonth],
  )

  const goToPrevMonth = () => {
    clearEventSelection()
    setSelectedDateKey(null)
    if (viewMonth === 1) { setViewMonth(12); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  const goToNextMonth = () => {
    clearEventSelection()
    setSelectedDateKey(null)
    if (viewMonth === 12) { setViewMonth(1); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }
  const goToToday = () => {
    clearEventSelection()
    const today = new Date()
    setViewYear(today.getFullYear())
    setViewMonth(today.getMonth() + 1)
    setSelectedDateKey(todayKey)
  }

  const selectedEvents = selectedDateKey ? (eventsByDay.get(selectedDateKey) ?? []) : []
  const hasAnyEventsThisMonth = events.length > 0

  return (
    <div className="bg-card rounded-xl border border-border ui-card-density">
      <div className="mb-4">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          Actividad cardiovascular
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Historial temporal de registros clínicos, predicciones y cambios de riesgo.
        </p>
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3 gap-1">
        <button
          type="button"
          onClick={goToPrevMonth}
          aria-label="Mes anterior"
          className="p-1 rounded-lg border border-border hover:bg-accent transition-colors flex-shrink-0"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-medium text-foreground capitalize truncate">{monthLabel}</span>
          {loading && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin flex-shrink-0" />}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={goToToday}
            className="text-xs font-medium text-primary hover:underline px-1"
          >
            Hoy
          </button>
          <button
            type="button"
            onClick={goToNextMonth}
            aria-label="Mes siguiente"
            className="p-1 rounded-lg border border-border hover:bg-accent transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <AlertTriangle className="w-7 h-7 text-red-400 mb-2" />
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <button
            onClick={() => loadMonth()}
            className="mt-3 px-4 ui-compact-control-density text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            Reintentar
          </button>
        </div>
      ) : (
        <>
          {/* Weekday header */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAY_LABELS.map(label => (
              <div key={label} className="ui-calendar-micro text-center font-medium text-muted-foreground uppercase py-1">
                {label}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-1">
            {days.map(day => {
              const dayEvents = eventsByDay.get(day.dateKey) ?? []
              const isSelected = day.dateKey === selectedDateKey
              return (
                <button
                  key={day.dateKey}
                  type="button"
                  onClick={() => { clearEventSelection(); setSelectedDateKey(day.dateKey) }}
                  aria-label={`${day.dayOfMonth}${dayEvents.length ? `, ${dayEvents.length} evento(s)` : ', sin actividad'}`}
                  className={cn(
                    'aspect-square rounded-lg border text-xs flex flex-col items-center justify-center gap-0.5 transition-colors',
                    day.isCurrentMonth ? 'text-foreground' : 'text-muted-foreground/40',
                    isSelected ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-accent',
                    day.isToday && !isSelected && 'border-border bg-accent/50',
                  )}
                >
                  <span>{day.dayOfMonth}</span>
                  {dayEvents.length > 0 && (
                    <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  )}
                </button>
              )
            })}
          </div>

          {!loading && !hasAnyEventsThisMonth && (
            <p className="text-xs text-muted-foreground text-center mt-3">
              Sin actividad cardiovascular registrada en este periodo.
            </p>
          )}

          {/* Selected day panel */}
          {selectedDateKey && (
            <div className="mt-4 pt-4 border-t border-border">
              <h4 className="text-sm font-medium text-foreground mb-2">
                {/* W7 — "de Hoy"/"de Ayer" vs "del <weekday, día de mes de
                    año>" (formatLongDate, unchanged for older days) — never
                    "del Hoy". selectedDateKey is already a business-date
                    key, compared directly with no Date reparsing. */}
                {(() => {
                  const rel = formatRelativeBusinessDate(selectedDateKey, d => formatLongDate(String(d)))
                  return rel.isRelative ? `Eventos de ${rel.label}` : `Eventos del ${rel.label}`
                })()}
              </h4>
              {feedback && (
                <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-lg px-3 py-2 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 dark:text-amber-300">{feedback}</p>
                </div>
              )}
              {selectedEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hay actividad cardiovascular registrada para este día.
                </p>
              ) : (
                // W2.2 — the day's events, already in their canonical
                // chronological order, partitioned into render groups by
                // the shared timelineGrouping utility. Grouping/ordering is
                // purely a display concern here: it never touches
                // `events`/`selectedEvents` themselves, never re-sorts, and
                // never changes which callback fires on a click — only how
                // the rows are visually clustered.
                <div className="space-y-2">
                  {groupTimelineEventsForRender(selectedEvents).map(group => (
                    <TimelineEventGroup key={group.events[0].id} memberCount={group.events.length}>
                      {group.events.map(event => (
                        <TimelineEventRow
                          key={event.id}
                          event={event}
                          isSelected={event.id === selectedEventId}
                          onSelectHealthRecord={onSelectHealthRecord}
                          onSelectPrediction={onSelectPrediction}
                          onRowClick={() => setSelectedEventId(event.id)}
                        />
                      ))}
                    </TimelineEventGroup>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

interface TimelineEventRowProps {
  event: PatientTimelineEvent
  isSelected: boolean
  onSelectHealthRecord?: (healthRecordId: string) => void
  onSelectPrediction?: (predictionId: string) => void
  onRowClick: () => void
}

// Shared shell for the row: a <button> when the event type has an exact,
// unambiguous longitudinal destination (Classification A — CLINICAL_RECORD/
// PREDICTION), a plain non-interactive <div> otherwise (RISK_CHANGE, always
// noninteractive by product requirement — see X3 below). Using a real
// <button> (not a styled div) gives focus/hover/Enter-Space activation for
// free, and never makes a non-actionable row look clickable.
function EventRowShell({
  interactive, isSelected, onClick, children,
}: { interactive: boolean; isSelected: boolean; onClick?: () => void; children: ReactNode }) {
  const classes = cn(
    'w-full flex items-start gap-3 p-3 rounded-lg text-left transition-colors',
    isSelected ? 'bg-primary/10 ring-1 ring-inset ring-primary' : 'bg-accent/40',
    interactive && !isSelected && 'hover:bg-accent/70',
  )
  if (!interactive) return <div className={classes}>{children}</div>
  return (
    <button type="button" onClick={onClick} className={classes}>
      {children}
    </button>
  )
}

function TimelineEventRow({ event, isSelected, onSelectHealthRecord, onSelectPrediction, onRowClick }: TimelineEventRowProps) {
  // V3 §8 — replaces the previously duplicated Intl.DateTimeFormat call
  // (which produced 24-hour output for the es-MX locale) with the shared,
  // canonical 12-hour formatter, pinned to the business timezone exactly as
  // this call already was.
  const time = formatTime(event.eventDate, { timeZone: 'business' })

  if (event.eventType === 'CLINICAL_RECORD') {
    const { healthRecordId } = event.metadata
    return (
      <EventRowShell
        interactive
        isSelected={isSelected}
        onClick={() => { onRowClick(); onSelectHealthRecord?.(healthRecordId) }}
      >
        <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Registro clínico</p>
          <p className="text-xs text-muted-foreground">
            Presión arterial: {event.metadata.sysBP}/{event.metadata.diaBP} mmHg
          </p>
        </div>
        <span className="ui-calendar-micro text-muted-foreground flex-shrink-0">{time}</span>
      </EventRowShell>
    )
  }

  if (event.eventType === 'PREDICTION') {
    const cfg = RISK_CONFIG[event.metadata.riskLevel]
    const { predictionId } = event.metadata
    return (
      <EventRowShell
        interactive
        isSelected={isSelected}
        onClick={() => { onRowClick(); onSelectPrediction?.(predictionId) }}
      >
        <Activity className={cn('w-4 h-4 mt-0.5 flex-shrink-0', cfg.text)} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Predicción cardiovascular</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <RiskBadge level={event.metadata.riskLevel} size="sm" />
            <span className="text-xs text-muted-foreground">{formatScore(event.metadata.riskScore)}</span>
            {event.metadata.modelVersion && (
              <span className="ui-calendar-micro text-muted-foreground">Modelo {event.metadata.modelVersion}</span>
            )}
          </div>
          {event.metadata.isAnomaly && (
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-1">⚠ Anomalía detectada</p>
          )}
        </div>
        <span className="ui-calendar-micro text-muted-foreground flex-shrink-0">{time}</span>
      </EventRowShell>
    )
  }

  // event.eventType === 'RISK_CHANGE' — the only remaining case (Z2 removed
  // the ALERT branch that previously followed as an unconditional fallback
  // here).
  const fromCfg = RISK_CONFIG[event.metadata.fromLevel]
  const toCfg = RISK_CONFIG[event.metadata.toLevel]
  // X3 — RISK_CHANGE is deliberately noninteractive (product requirement):
  // it must remain visible and keep its W2 causal-group membership, but no
  // longer selects/scrolls to its associated prediction. currentPredictionId
  // (event.metadata) is no longer read here — it was only ever used to
  // drive the onSelectPrediction call this block removes; the timeline
  // event contract itself is untouched (still present on `event.metadata`
  // for any other consumer).
  return (
    <EventRowShell
      interactive={false}
      isSelected={false}
    >
      <ArrowRight className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">Cambio de riesgo</p>
        <div className="flex items-center gap-1.5 mt-1">
          <span className={cn('text-xs font-medium', fromCfg.text)}>{fromCfg.label}</span>
          <ArrowRight className="w-3 h-3 text-muted-foreground" />
          <span className={cn('text-xs font-medium', toCfg.text)}>{toCfg.label}</span>
        </div>
      </div>
      <span className="ui-calendar-micro text-muted-foreground flex-shrink-0">{time}</span>
    </EventRowShell>
  )
}
