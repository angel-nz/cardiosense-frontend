import { useState, useEffect, useCallback, useRef } from 'react'
import { Bell, CheckCheck, AlertTriangle, Info, Search, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn, SEVERITY_CONFIG, timeAgo, formatScore } from '@/lib/utils'
import type { AlertSeverity, Alert } from '@/types'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAlerts } from '@/context/AlertsContext'
import { useSocket } from '@/context/SocketContext'
import { useActionNotify } from '@/context/ToastContext'
import { alertService } from '@/services/alertService'

// X2 — defensive one-shot reader for the Dashboard "Alertas" stat
// card's navigation intent (location.state), mirroring the established
// readDashboardEventNav precedent (PatientDetailPage.tsx, O3-FIX-4). Never
// blindly casts location.state — only ever recognizes its OWN relevant
// `kind`; any other/malformed payload is treated as absent. The intent
// carries no destination-internal filter value itself (X1 §10) — this page
// maps it onto its own existing `readFilter` representation below.
function readAlertsStatNav(state: unknown): boolean {
  if (!state || typeof state !== 'object') return false
  const nav = (state as Record<string, unknown>).dashboardStatNav
  if (!nav || typeof nav !== 'object') return false
  return (nav as Record<string, unknown>).kind === 'ALERTS_UNREAD'
}

const FILTER_OPTIONS: Array<{ value: AlertSeverity | 'all'; label: string; icon: React.ElementType }> = [
  { value: 'all',      label: 'Todas',       icon: Bell },
  { value: 'critical', label: 'Críticas',    icon: AlertTriangle },
  { value: 'warning',  label: 'Advertencias', icon: AlertTriangle },
  { value: 'info',     label: 'Información', icon: Info },
]

const LIMIT_OPTIONS = [10, 25, 50] as const
const REALTIME_COALESCE_MS = 400

export default function AlertsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  // U7.2 — global concerns (badge/topbar unreadCount, markAsRead/
  // markAllRead mutations) stay sourced from the shared AlertsContext,
  // untouched. The VISIBLE, paginated list below is now this page's own
  // independent canonical HTTP state — no longer `useAlerts().alerts`.
  const { unreadCount, markAsRead, markAllRead, alertReadSeq } = useAlerts()
  const { connected, lastAlert, lastAlertsChanged } = useSocket()
  const { notifyError } = useActionNotify()

  const [alerts, setAlerts] = useState<Alert[]>([])
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | 'all'>('all')
  const [readFilter, setReadFilter] = useState<'all' | 'unread' | 'read'>('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350)
    return () => clearTimeout(timer)
  }, [search])

  // Any filter/search/limit change resets to page 1 (U5/U6 principle).
  useEffect(() => { setPage(1) }, [debouncedSearch, severityFilter, readFilter, limit])

  // X2 — consume the Dashboard "Alertas" navigation intent exactly
  // once: applies to the SAME existing `readFilter` state a doctor could
  // set manually (never a second, parallel unread flag), then immediately
  // clears the history entry's state (same one-shot precedent as
  // PatientDetailPage's dashboardNav effect) so a later refresh/back/normal
  // re-visit never reapplies it. statNavConsumedRef guards against
  // reapplying on a later render even before location.state finishes
  // clearing. Setting readFilter here is picked up by the existing
  // page-reset effect above — no separate setPage(1) needed.
  const statNavConsumedRef = useRef(false)
  useEffect(() => {
    if (statNavConsumedRef.current) return
    if (!readAlertsStatNav(location.state)) return
    statNavConsumedRef.current = true
    setReadFilter('unread')
    navigate(location.pathname, { replace: true, state: null })
  }, [location.state, location.pathname, navigate])

  const requestIdRef = useRef(0)
  // U7.2-FIX-2 — pure lifecycle bookkeeping (never read directly by JSX —
  // only used inside load() to decide whether THIS settling request may
  // touch the visible loading/error state; the actual visible state stays
  // ordinary React state via setLoading/setError, satisfying "don't derive
  // render from a ref"). Separates two previously-conflated concerns:
  // requestIdRef answers "is this response still current enough to update
  // canonical data", while initialLoadDoneRef answers "has the page ever
  // successfully established its canonical UI". A newer request's `silent`
  // flag must never be able to strand an older request's loading=true —
  // under React.StrictMode's intentional double-invoke of this mount
  // effect (see below), the SECOND invocation starts a `silent` request
  // before the first one resolves, which used to bump requestIdRef and
  // make the original non-silent request stale by the time it settled —
  // with neither request left able to clear `loading` (the stale one is
  // skipped by the requestId check, the silent one skipped clearing by
  // design). Gating on initialLoadDoneRef instead of `silent` fixes this:
  // whichever request is actually current when it settles clears the
  // spinner/surfaces the error, regardless of which flag it happened to
  // carry.
  const initialLoadDoneRef = useRef(false)
  // `_silent` is kept as a parameter purely so call sites can still
  // document their own intent (a background/realtime/mutation refresh vs.
  // a deliberate foreground one) — it is deliberately NOT consulted below;
  // initialLoadDoneRef alone decides whether this settling request may
  // touch loading/error, which is the whole point of this fix.
  const load = useCallback(async (_silent = false) => {
    const requestId = ++requestIdRef.current
    if (!initialLoadDoneRef.current) setLoading(true)
    setError(null)
    try {
      const result = await alertService.list({
        page, limit,
        search: debouncedSearch || undefined,
        severity: severityFilter === 'all' ? undefined : severityFilter,
        // "unread"/"read" map to the existing boolean API meaning exactly
        // (unread=true → isRead:false server-side); "all" omits it.
        unread: readFilter === 'all' ? undefined : readFilter === 'unread',
      })
      if (requestId !== requestIdRef.current) return
      setAlerts(result.data)
      setTotal(result.total)
      setTotalPages(result.totalPages)
      // Out-of-range correction (U5/U6 principle) — backend never clamps
      // `page` itself; especially relevant right after mark-read mutations
      // under readFilter === 'unread'.
      if (result.total > 0 && page > result.totalPages) {
        setPage(result.totalPages)
      } else if (result.total === 0 && page !== 1) {
        setPage(1)
      }
      // First successful settlement of the current request establishes
      // canonical UI and clears the spinner — unconditionally, whether or
      // not THIS call was invoked with silent=true (StrictMode can make
      // the authoritative settling request a silent one). Once
      // established, later calls (all genuinely silent — search/filter/
      // realtime/reconnect/mutations) never touch loading/error again,
      // regardless of their own `silent` value.
      if (!initialLoadDoneRef.current) {
        initialLoadDoneRef.current = true
        setLoading(false)
      }
    } catch {
      if (requestId !== requestIdRef.current) return
      // Before initial establishment, the current request's failure must
      // surface the error and end loading even if it happened to be
      // invoked as silent — otherwise the page is stuck on a spinner with
      // no way to reach the error/retry UI at all. After establishment, a
      // failed background refresh must NOT destroy already-visible
      // canonical rows with a full-page error — silently keep the
      // existing `alerts` as-is.
      if (!initialLoadDoneRef.current) {
        setError('No se pudieron cargar las alertas')
        setLoading(false)
      }
    }
  }, [page, limit, debouncedSearch, severityFilter, readFilter])

  // U7.2-FIX-1 — reactively reloads on every filter/search/page/limit
  // change (all in `load`'s own useCallback deps above). Whether THIS
  // particular invocation shows the full-page spinner or silently
  // refreshes is now decided entirely inside load() via
  // initialLoadDoneRef, not by which of load()/load(true) is called here
  // — so this effect no longer needs its own first-vs-subsequent
  // bookkeeping (the previous hasLoadedOnceRef branching is gone; it
  // could itself be double-invoked identically under StrictMode without
  // reintroducing the stranded-loading bug, since load()'s own internal
  // gate is what actually matters).
  useEffect(() => { load() }, [load])

  // U7.2 — new_alert is consumed here independently of AlertsContext's own
  // (unchanged) handling — multiple independent consumers of the same
  // SocketContext scalar is an already-established pattern (P5/O4.2).
  // Never locally prepended into this page's canonical collection — HTTP
  // always decides whether/where a new Alert fits the active page/filters.
  const coalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleRefresh = useCallback(() => {
    if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current)
    coalesceTimerRef.current = setTimeout(() => {
      coalesceTimerRef.current = null
      load(true)
    }, REALTIME_COALESCE_MS)
  }, [load])

  useEffect(() => {
    if (!lastAlert) return
    scheduleRefresh()
    // Deliberately NOT calling clearLastAlert() here — AlertsContext's own
    // effect already consumes/clears it for the global badge; this page is
    // a passive second observer of the same signal.
  }, [lastAlert, scheduleRefresh])

  // Y4-FIX2 — alerts_changed is the UNGATED canonical-data-invalidation
  // signal (backend: alert.service.ts, emitted for every persisted Alert
  // regardless of NotificationPreference). This is deliberately a SEPARATE
  // effect from the lastAlert one above, not a merged condition — the two
  // scalars are independent SocketContext "last event" values that can
  // arrive in either order (or only one of them, when the relevant
  // category's realtime toggle is off) for the same underlying Alert. Both
  // funnel into the exact same existing scheduleRefresh()/load(true)
  // mechanism, so whichever fires first schedules the coalesced refetch and
  // a second arrival within the 400ms window just resets the same timer —
  // no new debounce logic, no duplicate requests, and the canonical GET
  // result is what ultimately reconciles state regardless of arrival order.
  // Mirrors lastAlert's own handling: never cleared here — like lastAlert,
  // lastAlertsChanged has multiple independent consumers (AlertsContext and
  // this page), so clearing it in either would race the other's effect.
  useEffect(() => {
    if (!lastAlertsChanged) return
    scheduleRefresh()
  }, [lastAlertsChanged, scheduleRefresh])

  // An Alert marked read individually from the Topbar popover may be on
  // this page's current (filtered/paginated) collection — reconcile through
  // the same coalesced canonical refetch realtime events use. The ref makes
  // it fire only for a NEW sequence value, never on mount or when
  // scheduleRefresh's identity changes with a filter/page change.
  const handledReadSeqRef = useRef(alertReadSeq)
  useEffect(() => {
    if (alertReadSeq === handledReadSeqRef.current) return
    handledReadSeqRef.current = alertReadSeq
    scheduleRefresh()
  }, [alertReadSeq, scheduleRefresh])

  const hasConnectedOnceRef = useRef(false)
  useEffect(() => {
    if (!connected) return
    if (!hasConnectedOnceRef.current) { hasConnectedOnceRef.current = true; return }
    scheduleRefresh()
  }, [connected, scheduleRefresh])

  useEffect(() => {
    return () => { if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current) }
  }, [])

  // U7.2 — mark-read/mark-all-read: the existing AlertsContext action
  // persists + updates its OWN global state as before (unreadCount/badge).
  // This page never mutates its own paginated `alerts` as the source of
  // truth — it always converges via a canonical refetch afterward, since
  // the marked Alert(s) may no longer belong to the active filtered
  // collection (e.g. readFilter === 'unread').
  const handleMarkAsRead = async (id: string) => {
    try {
      await markAsRead(id)
      load(true)
    } catch {
      // Z3 — mutation-failure feedback now goes through the global
      // action-notification toast instead of an inline page banner.
      notifyError('No se pudo marcar la alerta como leída. Intenta de nuevo.')
    }
  }

  const handleMarkAllRead = async () => {
    try {
      await markAllRead()
      load(true)
    } catch {
      notifyError('No se pudieron marcar todas las alertas como leídas. Intenta de nuevo.')
    }
  }

  const handleLimitChange = (next: number) => setLimit(next)

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin mb-3" />
        <p className="text-sm text-muted-foreground">Cargando alertas...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <AlertTriangle className="w-10 h-10 text-red-400 mb-3" />
        <p className="font-medium text-foreground">{error}</p>
        <button
          onClick={() => load()}
          className="mt-4 px-4 ui-compact-control-density text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
        >
          Reintentar
        </button>
      </div>
    )
  }

  return (
    <div className="ui-section-stack-tight">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-muted-foreground text-sm mt-1">
            {unreadCount > 0
              ? <><span className="text-red-600 dark:text-red-400 font-semibold">{unreadCount} alertas sin leer</span> · {total}</>
              : `${total} alertas · Todo al día`
            }
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="flex items-center gap-2 px-4 ui-compact-control-density text-sm font-medium text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-accent transition-colors"
          >
            <CheckCheck className="w-4 h-4" />
            Marcar todas como leídas
          </button>
        )}
      </div>

      {/* Z3 — the mark-read/mark-all-read mutation-failure banner
          previously here now shows as a global action notification instead
          (see handleMarkAsRead / handleMarkAllRead). The full-page load
          error above (`error`, with its own Reintentar) is a
          PERSISTENT_LOAD_ERROR, not an action result — untouched. */}

      {/* Filters — PRE-R2E §9 — sticky. Scope is the search+severity+read/
          unread toolbar specifically (matching the Patients/Predicciones
          "search+filters" pattern) — the "Marcar todas como leídas" header
          above is a separate, non-sticky block (PRE-R2E §18: smallest
          coherent functional region), its own behavior untouched either
          way. z-index 10 (.ui-sticky-toolbar) sits well below the Topbar
          Alerts popover's z-50, so it can never collide with/cover it
          (PRE-R2E §9/§22).
          PRE-R2E-FIX3 — `bg-background` → `bg-background/80`, matching
          Topbar's translucent treatment; blur centralized in
          `.ui-sticky-toolbar`. This toolbar's own z-index/stacking is
          unchanged by that addition (see index.css comment) — the Alerts
          popover above still renders unconditionally above it. */}
      <div
        className="ui-sticky-toolbar flex flex-col sm:flex-row gap-3 bg-background/80 border-b border-border"
        style={{ paddingTop: 'var(--ui-secondary-control-padding-y)', paddingBottom: 'var(--ui-secondary-control-padding-y)' }}
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por paciente, CURP o mensaje..."
            className="w-full pl-9 pr-4 py-2.5 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {FILTER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setSeverityFilter(opt.value)}
              className={cn(
                'px-3 py-2 text-xs font-medium rounded-lg border transition-colors',
                severityFilter === opt.value
                  ? 'bg-primary text-white border-primary'
                  : 'border-border text-muted-foreground hover:bg-accent',
              )}
            >
              {opt.label}
            </button>
          ))}
          <div className="w-px h-6 bg-border" />
          <select
            value={readFilter}
            onChange={e => setReadFilter(e.target.value as typeof readFilter)}
            className="ui-compact-control-density px-3 text-xs rounded-lg border border-border bg-card focus:outline-none cursor-pointer"
          >
            <option value="all">Todas</option>
            <option value="unread">Sin leer</option>
            <option value="read">Leídas</option>
          </select>
        </div>
      </div>

      {/* Alert list */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Bell className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="font-medium text-foreground">Sin alertas</p>
            <p className="text-sm text-muted-foreground mt-1">No hay alertas que coincidan con los filtros seleccionados</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {alerts.map(alert => {
              const cfg = SEVERITY_CONFIG[alert.severity]
              return (
                <div
                  key={alert.id}
                  className={cn(
                    'flex items-start ui-element-gap px-5 transition-colors',
                    !alert.isRead && 'hover:bg-blue-50/30 dark:hover:bg-blue-950/40',
                    'hover:bg-accent/50 cursor-pointer',
                  )}
                  // Y6.3B — this row's original `py-4` (16px) is 2px above
                  // --ui-row-padding-y's Classic value (14px), a genuine
                  // pre-existing outlier (Y6.3A §36/§21) — preserved exactly
                  // via a fixed +2px offset from the token rather than
                  // forced onto the same literal, so Classic is byte-exact
                  // while Compact/Comfortable/High Visibility still scale
                  // this row proportionally.
                  style={{ paddingTop: 'calc(var(--ui-row-padding-y) + 0.125rem)', paddingBottom: 'calc(var(--ui-row-padding-y) + 0.125rem)' }}
                  // Z5 — a doctor-scoped alert has no patientId at all.
                  // Marking it read is still valid (every Alert supports
                  // that regardless of ownership), but there is no patient
                  // record to navigate to, so the navigate() call is skipped
                  // entirely rather than sending the doctor to
                  // `/patients/null`. Z6-R2 — the one event that ever
                  // produced a doctor-scoped alert (INFO_DOCTOR_PROFILE_
                  // UPDATED) was removed, so this null-check is currently
                  // defensive/generic rather than live-exercised — kept as
                  // the general-purpose `alert.patientId` guard it already
                  // was (Alert.patientId's type is still nullable), not
                  // code that existed solely for the removed alert.
                  onClick={() => {
                    handleMarkAsRead(alert.id)
                    if (alert.patientId) navigate(`/patients/${alert.patientId}`)
                  }}
                >
                  {/* Severity indicator */}
                  <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5', cfg.bg, `border ${cfg.border}`)}>
                    <AlertTriangle className={cn('w-4 h-4', cfg.text)} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn('text-xs font-bold uppercase tracking-wide', cfg.text)}>
                        {cfg.label}
                      </span>
                      {!alert.isRead && (
                        <span className="w-2 h-2 rounded-full bg-blue-500" title="Sin leer" />
                      )}
                      {alert.riskScore !== undefined && (
                        <span className="text-xs text-muted-foreground font-mono">
                          Score: {formatScore(alert.riskScore)}
                        </span>
                      )}
                    </div>
                    {/* Z5 — same patientless fallback as AlertToast.tsx:
                        alert.patientName is '' (never undefined/"undefined")
                        for a doctor-scoped alert — see AlertsContext.tsx's
                        lastAlert merge and the backend's createInformationAlert,
                        which never sends patientName when medicoId ownership
                        is used. */}
                    <p className="text-sm font-semibold text-foreground mt-0.5">
                      {alert.patientName || 'Notificación general'}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{alert.message}</p>
                    <p className="text-xs text-muted-foreground mt-2">{timeAgo(alert.createdAt)}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    {!alert.isRead && (
                      <button
                        onClick={e => { e.stopPropagation(); handleMarkAsRead(alert.id) }}
                        className="p-1.5 rounded-lg hover:bg-accent transition-colors"
                        title="Marcar como leída"
                      >
                        <CheckCheck className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* U7.2 — pagination controls */}
        <div className="flex items-center justify-between flex-wrap gap-3 px-5 py-3 border-t border-border text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Mostrar</span>
            <select
              value={limit}
              onChange={e => handleLimitChange(Number(e.target.value))}
              className="border border-border rounded-md px-2 py-1 bg-card cursor-pointer"
            >
              {LIMIT_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
            <span>por página · {total} alerta{total === 1 ? '' : 's'}</span>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-3">
              <span>Página {page} de {totalPages}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-1.5 rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
