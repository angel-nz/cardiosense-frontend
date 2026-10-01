import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity, ChevronLeft, ChevronRight, FileText,
  ArrowRight, AlertTriangle, Loader2,
} from 'lucide-react'
import { cn, formatScore, formatLongDate, formatTime, formatRelativeBusinessDate, RISK_CONFIG } from '@/lib/utils'
import {
  BUSINESS_TIMEZONE, getBusinessDateKey, getMonthRange,
  buildCalendarDays, groupEventsByBusinessDay,
} from '@/lib/businessDate'
import { dashboardService } from '@/services/dashboardService'
import { RiskBadge } from '@/components/ui/RiskBadge'
import { useSocket } from '@/context/SocketContext'
import { groupTimelineEventsForRender } from '@/lib/timelineGrouping'
import { TimelineEventGroup } from '@/components/timeline/TimelineEventGroup'
import type { DashboardCalendarEvent, DashboardEventNavigationState, PatientDetailNavigationTarget } from '@/types'

// O4.2 — same coalescing window already validated for PatientCalendar (P5):
// purely to collapse a rapid HealthRecord→Prediction→Alert burst (each can
// emit its own dashboard_activity_changed) into a single GET, never a wait
// for backend persistence (O2/O4.1 already guarantee persist-before-emit).
const REALTIME_COALESCE_MS = 400

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat('es-MX', {
  month: 'long', year: 'numeric', timeZone: BUSINESS_TIMEZONE,
})

export function DashboardCalendar() {
  const navigate = useNavigate()
  // O4.2 — passive listener only: this component never calls
  // subscribe_patient/unsubscribe_patient — dashboard_activity_changed (like
  // new_alert) already arrives via the user:{userId} room every
  // authenticated socket auto-joins on connect (no per-patient subscription
  // needed, per O4.1's explicit rejection of Alternative A).
  const {
    connected, lastDashboardActivity, clearLastDashboardActivity,
  } = useSocket()

  // O3-FIX-4/5 — carries the exact target as router navigation state, so
  // PatientDetailPage can select/highlight the same record (P4) AND
  // PatientCalendar can open the matching month/day/event, instead of just
  // opening the patient's page with nothing positioned.
  const navigateToPatientTarget = useCallback((path: string, nav?: DashboardEventNavigationState) => {
    navigate(path, nav ? { state: { dashboardEventNav: nav } } : undefined)
  }, [navigate])
  const now = new Date()
  const todayKey = useMemo(() => getBusinessDateKey(new Date().toISOString()), [])

  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1) // 1-12
  const [events, setEvents] = useState<DashboardCalendarEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Same validated behavior as Patient Calendar (P4-FIX): opening the
  // calendar selects *today* immediately — no extra click needed to see
  // the day's activity.
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(todayKey)
  const requestIdRef = useRef(0)
  const coalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasConnectedOnceRef = useRef(false)

  // silent=true (realtime/reconnect-triggered): fetch and replace `events`
  // exactly as normal, but never toggle the loading spinner and never
  // surface a fetch error — a background sync failing shouldn't blank out
  // an already-valid, already-visible calendar. The user's own explicit
  // actions (month nav, Retry) always call this non-silent.
  const loadMonth = useCallback(async (silent = false) => {
    const requestId = ++requestIdRef.current
    if (!silent) { setLoading(true); setError('') }
    try {
      const { from, to } = getMonthRange(viewYear, viewMonth)
      const result = await dashboardService.getCalendar({ from, to })
      // Ignore stale responses — Sep → Oct navigated quickly must never let
      // a slow Sep response overwrite Oct's already-rendered data.
      if (requestId !== requestIdRef.current) return
      setEvents(result)
    } catch {
      if (requestId !== requestIdRef.current || silent) return
      setError('No se pudo cargar la actividad cardiovascular de este periodo.')
    } finally {
      if (requestId === requestIdRef.current && !silent) setLoading(false)
    }
  }, [viewYear, viewMonth])

  useEffect(() => { loadMonth() }, [loadMonth])

  // O4.2 — coalesced background refresh, shared by both the realtime
  // invalidation signal and reconnect resync below. Debounced purely to
  // collapse a rapid burst of dashboard_activity_changed signals from the
  // same clinical action into one GET — never a wait for persistence.
  const scheduleCoalescedRefresh = useCallback(() => {
    if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current)
    coalesceTimerRef.current = setTimeout(() => {
      coalesceTimerRef.current = null
      loadMonth(true)
    }, REALTIME_COALESCE_MS)
  }, [loadMonth])

  // Cleanup pending timer on unmount — no setState after this component is
  // gone.
  useEffect(() => {
    return () => {
      if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current)
    }
  }, [])

  // dashboard_activity_changed — canonical refetch only, never a hand-built
  // CLINICAL_RECORD/PREDICTION/RISK_CHANGE from the (intentionally
  // minimal) socket payload. No patientId filtering needed here (unlike
  // PatientCalendar's per-patient events): this signal already means "some
  // patient of yours changed", and the canonical GET already scopes to the
  // authenticated médico — there is no narrower filter to apply. Does not
  // check whether the event's month matches the currently visible one
  // (O4.1's explicit, deliberate simplification, same as P5) — refetches
  // the visible month unconditionally; a mismatch just means the refetch's
  // result doesn't visibly change anything.
  useEffect(() => {
    if (!lastDashboardActivity) return
    scheduleCoalescedRefresh()
    clearLastDashboardActivity()
  }, [lastDashboardActivity, scheduleCoalescedRefresh, clearLastDashboardActivity])

  // Reconnect resync. `connected` also becomes true on the very first
  // successful connection — skip exactly that one occurrence, since the
  // mount-driven `loadMonth()` effect above already covers it; every
  // SUBSEQUENT true is a genuine reconnect, during which any
  // dashboard_activity_changed emitted while offline was simply lost
  // (Socket.IO does not replay it) — a canonical resync is the only way to
  // converge.
  useEffect(() => {
    if (!connected) return
    if (!hasConnectedOnceRef.current) {
      hasConnectedOnceRef.current = true
      return
    }
    scheduleCoalescedRefresh()
  }, [connected, scheduleCoalescedRefresh])

  const days = useMemo(() => buildCalendarDays(viewYear, viewMonth, todayKey), [viewYear, viewMonth, todayKey])
  const eventsByDay = useMemo(() => groupEventsByBusinessDay(events), [events])
  const monthLabel = useMemo(
    () => MONTH_LABEL_FORMATTER.format(new Date(Date.UTC(viewYear, viewMonth - 1, 15))),
    [viewYear, viewMonth],
  )

  const goToPrevMonth = () => {
    setSelectedDateKey(null)
    if (viewMonth === 1) { setViewMonth(12); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  const goToNextMonth = () => {
    setSelectedDateKey(null)
    if (viewMonth === 12) { setViewMonth(1); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }
  const goToToday = () => {
    setViewYear(now.getFullYear())
    setViewMonth(now.getMonth() + 1)
    setSelectedDateKey(todayKey)
  }

  const selectedEvents = selectedDateKey ? (eventsByDay.get(selectedDateKey) ?? []) : []
  const hasAnyEventsThisMonth = events.length > 0

  if (error) {
    return (
      <div className="bg-card rounded-xl border border-border ui-card-density">
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
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      {/* LEFT — Calendar pane. `items-start` on the grid (above) stops the
          default CSS Grid stretch behavior that was forcing this card to
          match RIGHT's height whenever RIGHT had many events — that
          stretched, mostly-empty card is exactly what produced the large
          blank area below the calendar during scroll. `lg:sticky` then
          keeps this card visible while the user scrolls through RIGHT's
          (now genuinely taller) content; native CSS sticky positions
          relative to this div's containing block (the grid above), so it
          naturally stops following once the grid's own bottom edge (set by
          RIGHT, the taller column) scrolls past — no JS scroll tracking,
          no fixed positioning, and no need to bound it manually. Only
          active at `lg:` (the same breakpoint the two-column layout itself
          uses) — on narrower viewports the columns stack and sticky does
          not apply. top-[76px] = the app's real fixed Topbar height
          (68px, confirmed in Topbar.tsx/AppLayout.tsx's own `pt-[68px]`
          page-content offset) plus 8px of breathing room, so the sticky
          card settles just below the Topbar rather than touching it. */}
      <div className="bg-card rounded-xl border border-border ui-card-density lg:sticky lg:top-[76px]">
        <div className="mb-4">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            Actividad cardiovascular
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Historial de registros clínicos, predicciones y cambios de riesgo de tus pacientes.
          </p>
        </div>

        {/* Month navigation */}
        <div className="flex items-center justify-between mb-3 gap-1">
          <button
            type="button"
            onClick={goToPrevMonth}
            aria-label="Mes anterior"
            className="p-1.5 rounded-lg border border-border hover:bg-accent transition-colors flex-shrink-0"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground capitalize">{monthLabel}</span>
            {loading && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
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
              className="p-1.5 rounded-lg border border-border hover:bg-accent transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Weekday header */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAY_LABELS.map(label => (
            <div key={label} className="ui-calendar-micro text-center font-medium text-muted-foreground uppercase py-1">
              {label}
            </div>
          ))}
        </div>

        {/* Day grid — density: a single compact count badge per cell
            (not per-type dots) — Dashboard days can carry activity from
            many patients at once, so a number scales better than
            multiple dots which could overflow a small cell. */}
        <div className="grid grid-cols-7 gap-1">
          {days.map(day => {
            const dayEvents = eventsByDay.get(day.dateKey) ?? []
            const isSelected = day.dateKey === selectedDateKey
            return (
              <button
                key={day.dateKey}
                type="button"
                onClick={() => setSelectedDateKey(day.dateKey)}
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
                  <span className="ui-calendar-count font-semibold text-primary leading-none">
                    {dayEvents.length}
                  </span>
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
      </div>

      {/* RIGHT — Selected-Day Events pane. Always rendered (never hidden
          based on selectedDateKey/events) — section 18/19/25 of O3-FIX-2:
          three distinct states below (no day selected / day selected with
          no events / day selected with events), never a silent empty
          column. Takes the space "Pacientes de alto riesgo" used to
          occupy. Error is handled above as a single full-section replacement
          (matches the original single-card component's behavior) rather
          than duplicated independently in this pane. */}
      <div className="bg-card rounded-xl border border-border ui-card-density">
        <div className="mb-4">
          <h3 className="font-semibold text-foreground">
            {/* W7 — same "de Hoy"/"de Ayer" vs "del <fecha>" grammar as
                PatientCalendar's equivalent heading; the no-selection
                fallback ('Eventos del día') is unrelated to W7 and stays
                unchanged. */}
            {selectedDateKey
              ? (() => {
                  const rel = formatRelativeBusinessDate(selectedDateKey, d => formatLongDate(String(d)))
                  return rel.isRelative ? `Eventos de ${rel.label}` : `Eventos del ${rel.label}`
                })()
              : 'Eventos del día'}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {selectedDateKey
              ? `${selectedEvents.length} evento${selectedEvents.length === 1 ? '' : 's'}`
              : 'Selecciona un día en el calendario'}
          </p>
        </div>

        {!selectedDateKey ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Selecciona un día para ver sus eventos.
          </p>
        ) : selectedEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No hay actividad para este día.
          </p>
        ) : (
          // W2.2 — same shared grouping utility/wrapper as PatientCalendar
          // (§14/§15 of the W2.1 report). groupId is already namespaced by
          // patientId (patient.timeline.ts::buildHealthRecordGroupId), so
          // two different patients' events can never land in the same
          // bucket here, even defensively.
          <div className="space-y-2">
            {groupTimelineEventsForRender(selectedEvents).map(group => (
              <TimelineEventGroup key={group.events[0].id} memberCount={group.events.length}>
                {group.events.map(event => (
                  <DashboardEventRow key={event.id} event={event} onNavigateToPatient={navigateToPatientTarget} />
                ))}
              </TimelineEventGroup>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function DashboardEventRow({
  event, onNavigateToPatient,
}: { event: DashboardCalendarEvent; onNavigateToPatient: (path: string, nav?: DashboardEventNavigationState) => void }) {
  // V3 §8 — replaces the previously duplicated Intl.DateTimeFormat call
  // (which produced 24-hour output for the es-MX locale) with the shared,
  // canonical 12-hour formatter, pinned to the business timezone exactly as
  // this call already was.
  const time = formatTime(event.eventDate, { timeZone: 'business' })

  // Navigation classification (O1/O1-FIX, unchanged): CLINICAL_RECORD/
  // PREDICTION/RISK_CHANGE → B (exact patient reachable via /patients/:id,
  // but no deep-link to the specific record/prediction — P4 keeps that
  // selection as local React state with no URL encoding). Z2 removed the
  // ALERT → C classification (no /alerts/:id route exists) along with the
  // Alert-model calendar event itself.
  //
  // O3-FIX-4/5 — B is now a *little* more exact: the specific record/
  // prediction ID (for History/Risk Evolution) AND this Dashboard event's
  // own `.id` + `eventDate` (for PatientCalendar's own month/day/event
  // positioning) travel as router navigation state (never query params/
  // hashes — no public deep-link contract is being introduced). RISK_CHANGE
  // maps its EXTERNAL target to currentPredictionId — never
  // previousPredictionId — but its CALENDAR target stays `event.id` itself
  // (P2's `risk-change:{currentPredictionId}` derived-event id), which is a
  // different string: Risk Evolution highlights the Prediction, but
  // PatientCalendar highlights the RISK_CHANGE event, not a Prediction.
  const goToPatient = () => {
    const target: PatientDetailNavigationTarget | undefined =
      event.eventType === 'CLINICAL_RECORD' ? { kind: 'HEALTH_RECORD', id: event.metadata.healthRecordId } :
      event.eventType === 'PREDICTION' ? { kind: 'PREDICTION', id: event.metadata.predictionId } :
      event.eventType === 'RISK_CHANGE' ? { kind: 'PREDICTION', id: event.metadata.currentPredictionId } :
      undefined
    const nav: DashboardEventNavigationState | undefined = target
      ? { target, calendarEventId: event.id, eventDate: event.eventDate }
      : undefined
    onNavigateToPatient(`/patients/${event.patientId}`, nav)
  }

  const shell = (interactive: boolean, children: React.ReactNode) => {
    const classes = 'w-full flex items-start gap-3 p-3 rounded-lg text-left bg-accent/40 transition-colors'
    if (!interactive) return <div className={classes}>{children}</div>
    return (
      <button type="button" onClick={goToPatient} className={cn(classes, 'hover:bg-accent/70')}>
        {children}
      </button>
    )
  }

  if (event.eventType === 'CLINICAL_RECORD') {
    return shell(true, (
      <>
        <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{event.patientName}</p>
          <p className="text-xs text-muted-foreground">
            Registro clínico · {event.metadata.sysBP}/{event.metadata.diaBP} mmHg
          </p>
        </div>
        <span className="ui-calendar-micro text-muted-foreground flex-shrink-0">{time}</span>
      </>
    ))
  }

  if (event.eventType === 'PREDICTION') {
    const cfg = RISK_CONFIG[event.metadata.riskLevel]
    return shell(true, (
      <>
        <Activity className={cn('w-4 h-4 mt-0.5 flex-shrink-0', cfg.text)} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{event.patientName}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <RiskBadge level={event.metadata.riskLevel} size="sm" />
            <span className="text-xs text-muted-foreground">{formatScore(event.metadata.riskScore)}</span>
          </div>
          {event.metadata.isAnomaly && (
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-1">⚠ Anomalía detectada</p>
          )}
        </div>
        <span className="ui-calendar-micro text-muted-foreground flex-shrink-0">{time}</span>
      </>
    ))
  }

  // event.eventType === 'RISK_CHANGE' — the only remaining case (Z2 removed
  // the ALERT branch that previously followed as an unconditional fallback
  // here).
  const fromCfg = RISK_CONFIG[event.metadata.fromLevel]
  const toCfg = RISK_CONFIG[event.metadata.toLevel]
  // X3 — RISK_CHANGE is deliberately noninteractive (product requirement):
  // no navigation, no goToPatient invocation. shell(false, ...) renders a
  // plain <div> with no onClick wired at all. goToPatient's own RISK_CHANGE
  // branch (still present, unchanged) is therefore never reached for this
  // event — left in place rather than removed, since it's shared by the
  // same function used by CLINICAL_RECORD/PREDICTION and touching it isn't
  // required to satisfy this requirement.
  return shell(false, (
    <>
      <ArrowRight className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{event.patientName}</p>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-xs text-muted-foreground">Cambio de riesgo:</span>
          <span className={cn('text-xs font-medium', fromCfg.text)}>{fromCfg.label}</span>
          <ArrowRight className="w-3 h-3 text-muted-foreground" />
          <span className={cn('text-xs font-medium', toCfg.text)}>{toCfg.label}</span>
        </div>
      </div>
      <span className="ui-calendar-micro text-muted-foreground flex-shrink-0">{time}</span>
    </>
  ))
}
