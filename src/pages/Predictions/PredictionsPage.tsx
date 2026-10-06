import { WheelDatePicker } from '@/components/ui/WheelDatePicker'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import {
  ArrowLeft, Activity, AlertTriangle, Loader2,
  History, ChevronLeft, ChevronRight, Search,
} from 'lucide-react'
import { RiskBadge } from '@/components/ui/RiskBadge'
import { ClinicalSourceDisclosure } from '@/components/predictions/ClinicalSourceDisclosure'
import { formatScore, formatRelativeBusinessDate, formatRelativeBusinessDateTime } from '@/lib/utils'
import { getBusinessDateKey, BUSINESS_TIMEZONE } from '@/lib/businessDate'
import { clinicalTimeLabel, predictionClinicalInstant } from '@/lib/clinicalTime'
import { patientService } from '@/services/patientService'
import { predictionService } from '@/services/predictionService'
import { useSocket } from '@/context/SocketContext'
import PredictionHistoryPage from './PredictionHistoryPage'
import type {
  Patient, Prediction, PredictionRiskFilter, DashboardEventNavigationState,
} from '@/types'

const GLOBAL_PAGE_LIMIT = 20
const REALTIME_COALESCE_MS = 400

const MONTH_FORMATTER = new Intl.DateTimeFormat('es-MX', { timeZone: BUSINESS_TIMEZONE, month: 'long', year: 'numeric' })
const DAY_FORMATTER   = new Intl.DateTimeFormat('es-MX', { timeZone: BUSINESS_TIMEZONE, weekday: 'long', day: 'numeric' })

function monthLabel(dateKey: string): string {
  const label = MONTH_FORMATTER.format(new Date(`${dateKey}T12:00:00Z`))
  return label.charAt(0).toUpperCase() + label.slice(1)
}
function dayLabel(dateKey: string): string {
  const label = DAY_FORMATTER.format(new Date(`${dateKey}T12:00:00Z`))
  return label.charAt(0).toUpperCase() + label.slice(1)
}

// X2 — defensive one-shot reader for the Dashboard "Predicciones" stat
// card's navigation intent (location.state), mirroring the established
// readDashboardEventNav precedent (PatientDetailPage.tsx, O3-FIX-4). Never
// blindly casts location.state — only ever recognizes its OWN relevant
// `kind`, and only a `businessDateKey` shaped like a real "YYYY-MM-DD" date
// string (matching the existing wheel-date from/to contract
// already used by this component's own filter controls below). Any other/
// malformed payload is treated as absent.
function readPredictionsStatNav(state: unknown): string | null {
  if (!state || typeof state !== 'object') return null
  const nav = (state as Record<string, unknown>).dashboardStatNav
  if (!nav || typeof nav !== 'object') return null
  const { kind, businessDateKey } = nav as Record<string, unknown>
  if (kind !== 'PREDICTIONS_TODAY') return null
  if (typeof businessDateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(businessDateKey)) return null
  return businessDateKey
}
// Reached when the route has no :patientId (e.g. the Sidebar links to the
// bare /predictions — see router.tsx). Shows the médico's own global
// prediction history — GET /api/predictions, scoped server-side by
// patient.medicoId — instead of the Bloque I patient picker, which
// duplicated PatientsPage's own search. Real server-side pagination,
// search, date/risk filtering (U6.2); no "fetch all and filter/paginate
// client-side".
function GlobalPredictionHistory() {
  const navigate = useNavigate()
  const location = useLocation()
  const { connected, lastDashboardActivity, clearLastDashboardActivity } = useSocket()
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // U6.2 — filters. `search` is the raw input (updates every keystroke);
  // `debouncedSearch` is what's actually sent, ~350ms after the user stops
  // typing. Date/risk controls fetch immediately (discrete actions, not a
  // typing stream).
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [riskLevel, setRiskLevel] = useState<PredictionRiskFilter | ''>('')
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350)
    return () => clearTimeout(timer)
  }, [search])
  // Any filter change resets to page 1 — mirrors the U5 principle.
  useEffect(() => { setPage(1) }, [debouncedSearch, from, to, riskLevel])
  // X2 — consume the Dashboard "Predicciones" navigation intent exactly
  // once: applies to the SAME existing from/to date-input state a doctor
  // could set manually (never a parallel filter mechanism), then
  // immediately clears the history entry's state (same one-shot precedent
  // as PatientDetailPage's dashboardNav effect) so a later refresh/back/
  // normal re-visit never reapplies it. `from`/`to` both equal to today's
  // business-date key is exactly "today" under the existing backend
  // boundaryField [from, to) half-open convention already used by this
  // component's own filters (X1 §8). Setting from/to here is picked up by
  // the page-reset effect above — no separate setPage(1) needed.
  // statNavConsumedRef guards against reapplying on a later render even
  // before location.state finishes clearing.
  const statNavConsumedRef = useRef(false)
  useEffect(() => {
    if (statNavConsumedRef.current) return
    const businessDateKey = readPredictionsStatNav(location.state)
    if (!businessDateKey) return
    statNavConsumedRef.current = true
    setFrom(businessDateKey)
    setTo(businessDateKey)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.state, location.pathname, navigate])
  const requestIdRef = useRef(0)
  const load = useCallback(async (silent = false) => {
    const requestId = ++requestIdRef.current
    if (!silent) setLoading(true)
    setError(null)
    try {
      const result = await predictionService.listAll({
        page, limit: GLOBAL_PAGE_LIMIT,
        search: debouncedSearch || undefined,
        from: from || undefined,
        to: to || undefined,
        riskLevel: riskLevel || undefined,
      })
      if (requestId !== requestIdRef.current) return
      setPredictions(result.data)
      setTotal(result.total)
      setTotalPages(result.totalPages)
      // Out-of-range correction (same principle as U5): backend never
      // clamps `page` itself.
      if (result.total > 0 && page > result.totalPages) {
        setPage(result.totalPages)
      } else if (result.total === 0 && page !== 1) {
        setPage(1)
      }
    } catch {
      if (requestId !== requestIdRef.current) return
      if (!silent) setError('No se pudo cargar el historial de predicciones')
    } finally {
      if (requestId === requestIdRef.current && !silent) setLoading(false)
    }
  }, [page, debouncedSearch, from, to, riskLevel])
  useEffect(() => { load() }, [load])
  // U6.2 — dashboard_activity_changed is reused as-is (already emitted to
  // user:{userId} after every persisted Prediction, no new event, no
  // per-patient subscription needed for a doctor-scoped global view).
  // Treated strictly as invalidation: never infer from the payload whether
  // a new Prediction matches the active filters — canonical HTTP always
  // decides. Coalesced ~400ms so a burst of nearby activity collapses into
  // one refetch.
  const coalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleRefresh = useCallback(() => {
    if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current)
    coalesceTimerRef.current = setTimeout(() => {
      coalesceTimerRef.current = null
      load(true)
    }, REALTIME_COALESCE_MS)
  }, [load])
  useEffect(() => {
    if (!lastDashboardActivity) return
    scheduleRefresh()
    clearLastDashboardActivity()
  }, [lastDashboardActivity, scheduleRefresh, clearLastDashboardActivity])
  // Reconnect resync — same pattern already validated in O4.2/U2: skip the
  // very first connection (the mount-driven load above already covers it),
  // treat any subsequent `connected` transition as a genuine reconnect.
  const hasConnectedOnceRef = useRef(false)
  useEffect(() => {
    if (!connected) return
    if (!hasConnectedOnceRef.current) { hasConnectedOnceRef.current = true; return }
    scheduleRefresh()
  }, [connected, scheduleRefresh])
  useEffect(() => {
    return () => { if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current) }
  }, [])
  // U6.2 §13 — binding decision: reuse the existing DashboardEventNavigationState
  // mechanism (O3-FIX-4/5) rather than the old `/predictions/:patientId`
  // navigation. Known, documented limitation (not solved here): if this
  // Prediction is outside PatientDetail's currently-loaded Risk Evolution
  // window, exact highlighting may not apply — deferred to U8.
  const goToPrediction = (pred: Prediction) => {
    const nav: DashboardEventNavigationState = {
      target: { kind: 'PREDICTION', id: pred.id },
      calendarEventId: pred.id,
      // NEW S3 — the calendar places an automatic Prediction at its source
      // record's clinical time; navigate to that day.
      eventDate: predictionClinicalInstant(pred),
    }
    navigate(`/patients/${pred.patientId}`, { state: { dashboardEventNav: nav } })
  }
  // U6.2 — presentation-only grouping of the CURRENT page's already
  // chronologically-ordered predictions, by business month/day
  // (America/Mexico_City). A day/month may legitimately repeat on another
  // page if the page boundary splits it — never distorted to avoid that.
  const groups: { monthKey: string; dayKey: string; items: Prediction[] }[] = []
  for (const pred of predictions) {
    const dayKey = getBusinessDateKey(predictionClinicalInstant(pred))   // NEW S3 — clinical day
    const monthKey = dayKey.slice(0, 7)
    const last = groups[groups.length - 1]
    if (last && last.dayKey === dayKey) {
      last.items.push(pred)
    } else {
      groups.push({ monthKey, dayKey, items: [pred] })
    }
  }
  const clearFilters = () => { setSearch(''); setFrom(''); setTo('') ; setRiskLevel('') }
  const hasActiveFilters = debouncedSearch || from || to || riskLevel
  return (
    <div className="max-w-2xl mx-auto mt-4 ui-content-stack">
      <div className="text-center">
        <Activity className="w-10 h-10 text-primary mx-auto mb-3" />
        <h1 className="text-xl font-bold text-foreground">Historial de predicciones</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {total > 0
            ? `· ${total} ·`
            : 'Selecciona un paciente en la lista para ver su detalle'}
        </p>
      </div>

      {/* U6.2 — filter controls. PRE-R2E §8 — sticky: this is the Predicciones
          search+filters toolbar the spec refers to (search/from/to/risk
          level/"Limpiar filtros"), rendered only in this no-:patientId
          global history view — the separate per-patient /predictions/:id
          view below (own form + tabs, no search/filter toolbar) is
          untouched. Already has its own bg-card/border/padding, so only
          the sticky offset/z-index (.ui-sticky-toolbar) is added — its
          existing full `border` + `bg-card` already satisfy the "stays
          readable while scrolling" rule (PRE-R2E §14) with no further
          visual change needed.
          PRE-R2E-FIX3 — `bg-card` → `bg-card/80`, matching Topbar's
          translucent treatment (same alpha, same token family as this
          card's own existing color); blur centralized in
          `.ui-sticky-toolbar`. This remains the one floating-card-styled
          region among the six (full `border`, not just `border-b`) — that
          pre-existing shape is untouched, only its opacity changes. */}
      <div className="ui-sticky-toolbar bg-card/80 rounded-xl border border-border p-4 space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre o CURP..."
            className="w-full pl-9 pr-3 ui-compact-control-density text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
          />
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <WheelDatePicker label="Desde"
            compact
            className="w-full max-w-full flex-none sm:w-56"
            value={from}
            maxYear={Number(getBusinessDateKey(new Date().toISOString()).slice(0, 4))}
            max={to || undefined}
            onValueChange={setFrom}
          />
          <span className="flex h-[34px] items-center text-xs text-muted-foreground">a</span>
          <WheelDatePicker label="Hasta"
            compact
            className="w-full max-w-full flex-none sm:w-56"
            value={to}
            maxYear={Number(getBusinessDateKey(new Date().toISOString()).slice(0, 4))}
            min={from || undefined}
            onValueChange={setTo}
          />
          <div className="w-36 max-w-full flex-none">
            <label htmlFor="global-history-risk" className="mb-1 block text-xs font-medium text-muted-foreground">Nivel de riesgo</label>
            <select
              id="global-history-risk"
              value={riskLevel}
              onChange={e => setRiskLevel(e.target.value as PredictionRiskFilter | '')}
              className="w-full px-2.5 ui-secondary-control-density text-xs rounded-lg border border-border bg-card cursor-pointer"
            >
            <option value="">Todos los niveles</option>
            <option value="LOW">Bajo</option>
            <option value="MODERATE">Moderado</option>
              <option value="HIGH">Alto</option>
            </select>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-primary hover:underline ml-auto"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Loader2 className="w-7 h-7 text-primary animate-spin mb-3" />
            <p className="text-sm text-muted-foreground">Cargando historial de predicciones...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="font-medium text-red-600 dark:text-red-400">{error}</p>
            <button
              onClick={() => load()}
              className="mt-3 px-4 ui-compact-control-density text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
            >
              Reintentar
            </button>
          </div>
        ) : predictions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <History className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="font-medium text-foreground">
              {hasActiveFilters ? 'Ningún resultado para estos filtros.' : 'Aún no tienes predicciones registradas.'}
            </p>
          </div>
        ) : (
          <div>
            {groups.map(group => (
              <div key={group.dayKey}>
                {(groups.indexOf(group) === 0 || groups[groups.indexOf(group) - 1].monthKey !== group.monthKey) && (
                  <div className="px-4 pt-3 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide bg-accent/30">
                    {monthLabel(group.monthKey + '-01')}
                  </div>
                )}
                <div className="px-4 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">
                  {/* W7 — day-group heading: "Hoy"/"Ayer" for the current/
                      previous business day, otherwise the existing
                      weekday+day style (dayLabel) unchanged. The month
                      heading above stays absolute always (§4 — calendar/
                      section month headers are excluded from W7). */}
                  {formatRelativeBusinessDate(group.dayKey, d => dayLabel(String(d))).label}
                </div>
                <div className="divide-y divide-border">
                  {/* V7 — was a single <button> wrapping the whole row;
                      split into an outer <div> (no longer itself
                      interactive) containing the original clickable
                      summary area (still the exact same navigation
                      behavior/styling) plus the new clinical-source
                      disclosure below it, since a toggle button can't
                      nest inside another button. */}
                  {group.items.map(pred => (
                    <div key={pred.id} className="px-4 ui-row-density hover:bg-accent/50 transition-colors">
                      <button
                        type="button"
                        onClick={() => goToPrediction(pred)}
                        className="w-full flex items-center gap-3 text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {pred.patientName ?? pred.patientId}
                          </p>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                            <span className="font-mono">Riesgo: {formatScore(pred.riskScore)}</span>
                            {pred.isAnomaly && (
                              <span className="text-amber-600 dark:text-amber-400 font-medium">⚠ Anomalía</span>
                            )}
                            <span data-testid="prediction-clinical-time">{pred.healthRecord ? clinicalTimeLabel(pred.healthRecord) : formatRelativeBusinessDateTime(pred.predictedAt)}</span>
                            <span>Calculada {formatRelativeBusinessDateTime(pred.predictedAt)}</span>
                          </div>
                        </div>
                        <RiskBadge level={pred.riskLevel} size="sm" />
                      </button>
                      <ClinicalSourceDisclosure healthRecord={pred.healthRecord} className="mt-2" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && !error && predictions.length > 0 && (
          <div className="px-4 py-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>Página {page} de {totalPages}</span>
            <div className="flex items-center gap-2">
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
  )
}

// NEW S4 — the per-patient view is ONLY this patient's Prediction history
// ("Historial de predicciones"). The former "Resumen" section (latest record
// panel, record re-entry modal and the transient automatic-result panel) is
// removed together with its tab mechanics: the history renders directly,
// with no tablist. Current observed risk stays on PatientDetail
// (canonical currentPrediction); this page is chronological clinical history.
// PatientDetail's "Historial" (compact card and full-chart modal) links here;
// a legacy `?vista=historial` query is harmless and ignored.
export default function PredictionsPage() {
  const { patientId } = useParams<{ patientId: string }>()
  const navigate = useNavigate()
  const { subscribeToPatient, unsubscribeFromPatient } = useSocket()

  // INT-16/17 — join patient:{patientId} while mounted (live history refresh
  // on prediction_completed is handled by PredictionHistoryPage itself).
  useEffect(() => {
    if (!patientId) return
    subscribeToPatient(patientId)
    return () => unsubscribeFromPatient(patientId)
  }, [patientId, subscribeToPatient, unsubscribeFromPatient])

  const [patient, setPatient] = useState<Patient | null>(null)
  // false without a patientId — the bare /predictions route renders the
  // global history and never loads a patient (H4).
  const [patientLoading, setPatientLoading] = useState(!!patientId)
  const [patientError, setPatientError] = useState<string | null>(null)

  const loadPatient = useCallback(async () => {
    if (!patientId) return
    setPatientLoading(true)
    setPatientError(null)
    try {
      setPatient(await patientService.getById(patientId))
    } catch {
      setPatientError('No se pudo cargar la información del paciente')
    } finally {
      setPatientLoading(false)
    }
  }, [patientId])
  useEffect(() => { loadPatient() }, [loadPatient])

  if (!patientId) {
    return <GlobalPredictionHistory />
  }

  if (patientLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin mb-3" />
        <p className="text-sm text-muted-foreground">Cargando paciente...</p>
      </div>
    )
  }

  if (patientError || !patient) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <AlertTriangle className="w-10 h-10 text-red-400 mb-3" />
        <p className="font-medium text-foreground">{patientError ?? 'Paciente no encontrado'}</p>
        <button
          onClick={() => navigate('/patients')}
          className="mt-4 px-4 ui-compact-control-density text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
        >
          Volver a pacientes
        </button>
      </div>
    )
  }

  return (
    <div className="ui-section-stack-tight" data-testid="patient-prediction-history-page">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/patients/${patient.id}`)} aria-label="Volver al paciente" className="p-2 rounded-lg hover:bg-accent transition-colors">
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <History className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
            Historial de predicciones
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Paciente: <span className="font-medium text-foreground">{patient.firstName} {patient.lastName}</span>
          </p>
        </div>
      </div>

      <PredictionHistoryPage />
    </div>
  )
}
