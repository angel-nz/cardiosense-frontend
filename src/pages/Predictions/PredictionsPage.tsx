import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import {
  ArrowLeft, Activity, AlertTriangle, CheckCircle, Loader2, Info, Edit,
  FileWarning, History, Sparkles, ChevronLeft, ChevronRight, Search,
} from 'lucide-react'
import { RiskGauge } from '@/components/charts/RiskGauge'
import { RiskBadge } from '@/components/ui/RiskBadge'
import { ClinicalSourceDisclosure } from '@/components/predictions/ClinicalSourceDisclosure'
import { FeatureImportanceBar } from '@/components/charts/FeatureImportanceBar'
import { NewRecordModal } from '@/components/patients/NewRecordModal'
import { cn, formatScore, formatTime, formatRelativeBusinessDate, formatRelativeBusinessDateTime } from '@/lib/utils'
import { getBusinessDateKey, BUSINESS_TIMEZONE } from '@/lib/businessDate'
import { patientService } from '@/services/patientService'
import { recordService } from '@/services/recordService'
import { predictionService } from '@/services/predictionService'
import { usePredictions } from '@/hooks/usePredictions'
import { useSocket } from '@/context/SocketContext'
import PredictionHistoryPage from './PredictionHistoryPage'
import type {
  Patient, HealthRecord, Prediction, PredictionRiskFilter, DashboardEventNavigationState,
  RiskLevel, SocketPredictionFailed,
} from '@/types'

const GLOBAL_PAGE_LIMIT = 20
const REALTIME_COALESCE_MS = 400

// W4.2 — the "Editar y crear nuevo registro" automatic-prediction pending
// window. After this many ms of still `prediction_pending`, the visible
// copy swaps to a cause-free "taking longer than expected" message — this
// is a message-only change, never a state transition (§16 of the W4.2
// block; §9/§28-d of the accepted W4.1 diagnosis, which recommended this
// exact 8s default as a starting point with no existing precedent to
// anchor it).
const AUTO_PREDICTION_DELAY_MS = 8000

// W4.2 — built directly from the (additive) prediction_completed socket
// payload, or from a persisted Prediction row recovered via reconnect
// (§21) — never from a fabricated/synthesized source. Deliberately does
// NOT include anomalyScore (magnitude), predictedAt, or featureImportance:
// none of those are present on the live socket payload, so showing them
// only for the reconnect-recovered path (where they WOULD be available on
// the persisted row) would make the auto-result panel's content depend on
// which recovery path was taken — instead this type/panel is kept
// deterministic across both paths, and simply never shows those fields for
// an automatically-triggered W4 result (see §9/§17 of the report).
interface AutoPredictionResult {
  predictionId: string
  healthRecordId: string
  riskScore: number
  riskLevel: RiskLevel
  isAnomaly: boolean
}

type AutoPredictionStatus = 'idle' | 'pending' | 'success' | 'unavailable' | 'failed'

// W4.2 §17 — verbatim copy from the accepted W4.1 diagnosis, keyed by the
// exact SocketPredictionFailed['reason'] literal union. No stack traces, no
// Axios/internal details, no implied clinical conclusion.
const AI_FAILURE_MESSAGES: Record<SocketPredictionFailed['reason'], string> = {
  AI_UNAVAILABLE: 'El servicio de predicción no está disponible temporalmente.',
  AI_INPUT_REJECTED: 'El registro clínico no pudo procesarse para generar una predicción.',
  AI_FAILURE: 'No fue posible generar la predicción.',
}

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
// string (matching the existing <input type="date"> from/to contract
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
      eventDate: pred.predictedAt,
    }
    navigate(`/patients/${pred.patientId}`, { state: { dashboardEventNav: nav } })
  }

  // U6.2 — presentation-only grouping of the CURRENT page's already
  // chronologically-ordered predictions, by business month/day
  // (America/Mexico_City). A day/month may legitimately repeat on another
  // page if the page boundary splits it — never distorted to avoid that.
  const groups: { monthKey: string; dayKey: string; items: Prediction[] }[] = []
  for (const pred of predictions) {
    const dayKey = getBusinessDateKey(pred.predictedAt)
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
    <div className="max-w-2xl mx-auto mt-4 space-y-4">
      <div className="text-center">
        <Activity className="w-10 h-10 text-primary mx-auto mb-3" />
        <h1 className="text-xl font-bold text-foreground">Historial de predicciones</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {total > 0
            ? `· ${total} ·`
            : 'Selecciona un paciente en la lista para ver su detalle'}
        </p>
      </div>

      {/* U6.2 — filter controls */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre o CURP..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-border bg-card"
          />
          <span className="text-xs text-muted-foreground">a</span>
          <input
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-border bg-card"
          />
          <select
            value={riskLevel}
            onChange={e => setRiskLevel(e.target.value as PredictionRiskFilter | '')}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-border bg-card cursor-pointer"
          >
            <option value="">Todos los niveles</option>
            <option value="LOW">Bajo</option>
            <option value="MODERATE">Moderado</option>
            <option value="HIGH">Alto</option>
          </select>
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
            <p className="font-medium text-red-600">{error}</p>
            <button
              onClick={() => load()}
              className="mt-3 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
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
                    <div key={pred.id} className="px-4 py-3.5 hover:bg-accent/50 transition-colors">
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
                              <span className="text-purple-600 font-medium">⚠ Anomalía</span>
                            )}
                            <span>{formatRelativeBusinessDateTime(pred.predictedAt)}</span>
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

export default function PredictionsPage() {
  const { patientId } = useParams<{ patientId: string }>()
  const navigate = useNavigate()
  const {
    subscribeToPatient, unsubscribeFromPatient, connected,
    lastHealthRecord, clearLastHealthRecord,
    lastPrediction, clearLastPrediction,
    lastPredictionUnavailable, clearLastPredictionUnavailable,
    lastPredictionFailed, clearLastPredictionFailed,
  } = useSocket()

  // INT-16/17 — same pattern as PatientDetailPage: join patient:{patientId}
  // while this page is mounted, leave on unmount/id change. This is a
  // separate route from /patients/:id, so navigating between the two for
  // the same patient does one harmless unsubscribe+resubscribe of that
  // room — not optimized away here (would require cross-route shared
  // state, out of this block's scope).
  useEffect(() => {
    if (!patientId) return
    subscribeToPatient(patientId)
    return () => unsubscribeFromPatient(patientId)
  }, [patientId, subscribeToPatient, unsubscribeFromPatient])

  const [patient, setPatient] = useState<Patient | null>(null)
  // Initialized false when there's no patientId at all — without this, the
  // loading spinner below would spin forever, since loadPatient() (guarded
  // by `if (!patientId) return`) would never reach the `finally` that
  // turns it off. This was the exact root cause of the infinite-loading
  // report (H4): the Sidebar links to the bare /predictions route (no
  // :patientId), and loadPatient/loadLatestRecord never fire for it.
  const [patientLoading, setPatientLoading] = useState(!!patientId)
  const [patientError, setPatientError] = useState<string | null>(null)

  const [latestRecord, setLatestRecord] = useState<HealthRecord | null>(null)
  const [recordLoading, setRecordLoading] = useState(true)

  const [result, setResult] = useState<Prediction | null>(null)
  const [activeTab, setActiveTab] = useState<'form' | 'history'>('form')

  const { predicting, error, errorCode, predict, clearError } = usePredictions()

  // ── W4.2 — "Editar y crear nuevo registro" → automatic prediction ──────
  const [newRecordModalOpen, setNewRecordModalOpen] = useState(false)
  // §19 — a single scalar, not a map/set: the smallest design consistent
  // with this page showing one result panel for one current view. The
  // newest W4 save always wins (overwrites this), and every socket
  // correlation handler below requires an exact match against the CURRENT
  // value — a stale/superseded id can never re-apply.
  const [pendingHealthRecordId, setPendingHealthRecordId] = useState<string | null>(null)
  const [autoStatus, setAutoStatus] = useState<AutoPredictionStatus>('idle')
  const [autoDelayed, setAutoDelayed] = useState(false)
  const [autoResult, setAutoResult] = useState<AutoPredictionResult | null>(null)
  const [autoUnavailable, setAutoUnavailable] = useState<{ modelVersion: string; eligibleAgeRange: { min: number; max: number } } | null>(null)
  const [autoFailedReason, setAutoFailedReason] = useState<SocketPredictionFailed['reason'] | null>(null)
  const delayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Mirrors pendingHealthRecordId on every render so the reconnect-recovery
  // effect's async `.then()` (below) can check for staleness against the
  // CURRENT value at resolution time, not the value it closed over when the
  // fetch started (§20/§21 — a superseding action mid-fetch must win).
  const pendingHealthRecordIdRef = useRef(pendingHealthRecordId)
  pendingHealthRecordIdRef.current = pendingHealthRecordId

  const clearDelayTimer = useCallback(() => {
    if (delayTimerRef.current) { clearTimeout(delayTimerRef.current); delayTimerRef.current = null }
    setAutoDelayed(false)
  }, [])

  // §6 — invoked as NewRecordModal's onCreated for THIS page's own instance
  // only (PatientDetailPage's separate instance/handler is untouched).
  // Order follows the block's own numbered steps.
  const handleW4RecordCreated = useCallback((created: HealthRecord) => {
    // 3. clear any prior result/error/unavailable state belonging to the
    //    old record — both the manual-flow's own result/error AND any
    //    previous W4 auto outcome. A fresh save is always the newest
    //    action and takes over the result panel.
    clearError()
    setResult(null)
    clearDelayTimer()
    setAutoResult(null)
    setAutoUnavailable(null)
    setAutoFailedReason(null)
    // 1. + 2.
    setLatestRecord(created)
    setPendingHealthRecordId(created.id)
    // 4.
    setAutoStatus('pending')
    delayTimerRef.current = setTimeout(() => setAutoDelayed(true), AUTO_PREDICTION_DELAY_MS)
    // 5. — NewRecordModal already calls onOpenChange(false) itself right
    //      after invoking onCreated; nothing additional needed here.
    // Explicitly NOT calling predictionService.predict() — the backend's
    // automatic record→prediction path (already triggered server-side by
    // the record.service.ts::create call this onCreated is reacting to) is
    // the sole authority for generating this Prediction (§24/F09).
  }, [clearError, clearDelayTimer])

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

  const loadLatestRecord = useCallback(async (silent = false) => {
    if (!patientId) return
    if (!silent) setRecordLoading(true)
    try {
      const records = await recordService.getByPatientId(patientId, 1)
      setLatestRecord(records[0] ?? null)
    } catch {
      if (!silent) setLatestRecord(null)
    } finally {
      if (!silent) setRecordLoading(false)
    }
  }, [patientId])

  useEffect(() => { loadPatient() }, [loadPatient])
  useEffect(() => { loadLatestRecord() }, [loadLatestRecord])

  // INT-20 — health_record_created: refresh the "latest health record"
  // panel this page shows (source of truth for what Skorp will use).
  // Payload is ids + recordedAt only, so a refetch (not a direct merge) is
  // required — same reasoning as PatientDetailPage's equivalent effect.
  useEffect(() => {
    if (!patientId || !lastHealthRecord || lastHealthRecord.patientId !== patientId) return
    loadLatestRecord(true)
    clearLastHealthRecord()
  }, [patientId, lastHealthRecord, loadLatestRecord, clearLastHealthRecord])

  // §8 — success correlation. Accepted ONLY when patientId AND
  // healthRecordId both match the current pending target — never by
  // patientId alone (this also naturally ignores the prediction_completed
  // the MANUAL "Calcular riesgo" flow's own POST /predictions triggers,
  // since pendingHealthRecordId is null/unrelated whenever that flow is the
  // active one — see handlePredict below). An unmatched event is left
  // uncleared (mirrors the existing lastPrediction-consumption idiom
  // already used elsewhere in this codebase, e.g. PatientDetailPage) —
  // it will simply be superseded by whichever event arrives next.
  useEffect(() => {
    if (!patientId || !lastPrediction) return
    if (lastPrediction.patientId !== patientId) return
    if (!pendingHealthRecordId || lastPrediction.healthRecordId !== pendingHealthRecordId) return
    clearDelayTimer()
    setPendingHealthRecordId(null)
    setAutoStatus('success')
    setAutoResult({
      predictionId: lastPrediction.predictionId,
      healthRecordId: lastPrediction.healthRecordId,
      riskScore: lastPrediction.riskScore,
      riskLevel: lastPrediction.riskLevel,
      isAnomaly: lastPrediction.isAnomaly,
    })
    clearLastPrediction()
  }, [patientId, lastPrediction, pendingHealthRecordId, clearDelayTimer, clearLastPrediction])

  // §10 — MODEL_INELIGIBLE correlation. Same match rule as above. The saved
  // HealthRecord is left exactly as-is (already reflected in `latestRecord`
  // since step 1 of handleW4RecordCreated) — no fake Prediction is ever
  // shown for this outcome.
  useEffect(() => {
    if (!patientId || !lastPredictionUnavailable) return
    if (lastPredictionUnavailable.patientId !== patientId) return
    if (!pendingHealthRecordId || lastPredictionUnavailable.healthRecordId !== pendingHealthRecordId) return
    clearDelayTimer()
    setPendingHealthRecordId(null)
    setAutoStatus('unavailable')
    setAutoUnavailable({
      modelVersion: lastPredictionUnavailable.modelVersion,
      eligibleAgeRange: lastPredictionUnavailable.eligibleAgeRange,
    })
    clearLastPredictionUnavailable()
  }, [patientId, lastPredictionUnavailable, pendingHealthRecordId, clearDelayTimer, clearLastPredictionUnavailable])

  // §11-§13 — prediction_failed correlation. Same match rule; MODEL_INELIGIBLE
  // never reaches this handler (it's a distinct event, see above).
  useEffect(() => {
    if (!patientId || !lastPredictionFailed) return
    if (lastPredictionFailed.patientId !== patientId) return
    if (!pendingHealthRecordId || lastPredictionFailed.healthRecordId !== pendingHealthRecordId) return
    clearDelayTimer()
    setPendingHealthRecordId(null)
    setAutoStatus('failed')
    setAutoFailedReason(lastPredictionFailed.reason)
    clearLastPredictionFailed()
  }, [patientId, lastPredictionFailed, pendingHealthRecordId, clearDelayTimer, clearLastPredictionFailed])

  // §21 — reconnect/missed-event recovery. Skips the very first connection
  // (the mount-driven initial state already covers it — same
  // hasConnectedOnceRef pattern already validated in GlobalPredictionHistory
  // above), only does anything while a W4 attempt is still pending, and
  // requires NO new backend endpoint: predictionService.getHistory already
  // returns each Prediction's healthRecordId (types/index.ts), so a small
  // recent page is scanned client-side for the pending target. Success is
  // the only recoverable outcome — MODEL_INELIGIBLE and prediction_failed
  // are ephemeral/never persisted (accepted debt, W4.1 §17/§24); if no
  // match is found, this deliberately does nothing further and the panel
  // remains in its cause-free pending/delayed state — it never guesses.
  const hasConnectedOnceRef = useRef(false)
  useEffect(() => {
    if (!connected) return
    if (!hasConnectedOnceRef.current) { hasConnectedOnceRef.current = true; return }
    if (!patientId || !pendingHealthRecordId) return
    const targetId = pendingHealthRecordId
    predictionService.getHistory(patientId, { limit: 5 })
      .then(result => {
        // Stale-response guard: this attempt may have already been
        // superseded (a newer W4 save, a manual click, or already resolved
        // live) by the time this resolves — re-check against the CURRENT
        // value via the ref, not the value this closure captured.
        if (pendingHealthRecordIdRef.current !== targetId) return
        const found = result.data.find(p => p.healthRecordId === targetId)
        if (!found) return
        clearDelayTimer()
        setPendingHealthRecordId(null)
        setAutoStatus('success')
        setAutoResult({
          predictionId: found.id,
          healthRecordId: found.healthRecordId,
          riskScore: found.riskScore,
          riskLevel: found.riskLevel,
          isAnomaly: found.isAnomaly,
        })
      })
      .catch(() => { /* best-effort recovery only — stay pending/delayed, never guess */ })
  }, [connected, patientId, pendingHealthRecordId, clearDelayTimer])

  // Patient switch (A→B): a stale W4 correlation/timer from the previous
  // patient must never survive or apply to the new one (F28) — mirrors the
  // exact same reset-on-[patientId] pattern PatientDetailPage already uses
  // for its own cross-navigation state.
  useEffect(() => {
    clearDelayTimer()
    setPendingHealthRecordId(null)
    setAutoStatus('idle')
    setAutoResult(null)
    setAutoUnavailable(null)
    setAutoFailedReason(null)
    setResult(null)
    clearError()
  }, [patientId])

  useEffect(() => {
    return () => { if (delayTimerRef.current) clearTimeout(delayTimerRef.current) }
  }, [])

  const handlePredict = async () => {
    if (!patientId) return
    clearError()
    // §14/§24 — a manual click is a fresh, deliberate doctor action; it
    // takes over the result panel from any prior W4 automatic outcome.
    // Resetting pendingHealthRecordId to null here also guarantees the
    // correlation guards above ignore a later, unrelated automatic event if
    // one somehow is still in flight for an old record (never re-applied).
    clearDelayTimer()
    setPendingHealthRecordId(null)
    setAutoStatus('idle')
    setAutoResult(null)
    setAutoUnavailable(null)
    setAutoFailedReason(null)
    // POST /api/predictions — no health_record/indicator fields are sent;
    // the backend uses the patient's latest Health Record automatically.
    const prediction = await predict(patientId)
    if (prediction) setResult(prediction)
  }

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
          className="mt-4 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
        >
          Volver a pacientes
        </button>
      </div>
    )
  }

  const hasRecord = !recordLoading && !!latestRecord
  const showAlertNotice = result && (result.riskLevel !== 'low' || result.isAnomaly)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/patients/${patient.id}`)} className="p-2 rounded-lg hover:bg-accent transition-colors">
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">Predicción de riesgo</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Paciente: <span className="font-medium text-foreground">{patient.firstName} {patient.lastName}</span>
          </p>
        </div>
      </div>

      {/* W4.2 §5 — this page owns its OWN NewRecordModal instance/open-state
          (page-local `newRecordModalOpen`), entirely separate from
          PatientDetailPage's own instance — no shared/global modal manager,
          per the explicitly-approved W4.2 ownership contract. */}
      <NewRecordModal
        patientId={patient.id}
        birthDate={patient.birthDate}
        open={newRecordModalOpen}
        onOpenChange={setNewRecordModalOpen}
        onCreated={handleW4RecordCreated}
        prefillRecord={latestRecord}
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          { key: 'form' as const, label: 'Nueva predicción', icon: Sparkles },
          { key: 'history' as const, label: 'Historial', icon: History },
        ]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'history' ? (
        <PredictionHistoryPage />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

          {/* ── Latest health record + run panel ────────────────────── */}
          <div className="lg:col-span-3">
            <div className="bg-card rounded-xl border border-border p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <div>
                  <h3 className="font-semibold text-foreground">Registro clínico más reciente</h3>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-200 flex-shrink-0">
                  <Activity className="w-3.5 h-3.5" />
                  Skorp Beta 0.1
                </div>
              </div>

              {recordLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 text-primary animate-spin" />
                </div>
              ) : !latestRecord ? (
                <div className="flex flex-col items-center text-center py-8">
                  <FileWarning className="w-10 h-10 text-amber-400 mb-3" />
                  <p className="font-medium text-foreground">Sin registros clínicos</p>
                  <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                    Este paciente no tiene ningún registro clínico. Crea uno antes de ejecutar una predicción.
                  </p>
                  <button
                    onClick={() => navigate(`/patients/${patient.id}`)}
                    className="mt-4 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
                  >
                    Ir a la ficha del paciente
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-xs text-muted-foreground">
                      {/* W7 — "el"/no-preposition grammar: "Registrado el 23
                          sep 2026, 3:25 p.m." (absolute) vs "Registrado hoy,
                          3:25 p.m." (relative) — never "Registrado el Hoy". */}
                      {(() => {
                        const rel = formatRelativeBusinessDate(latestRecord.recordedAt)
                        const time = formatTime(latestRecord.recordedAt)
                        return rel.isRelative
                          ? `Registrado ${rel.label.toLowerCase()}, ${time}`
                          : `Registrado el ${rel.label}, ${time}`
                      })()}
                    </p>
                    {/* W4.2 §1/§4/§20 — NOT an in-place edit: opens
                        NewRecordModal prefilled from this exact record, and
                        saving always creates a brand-new HealthRecord (see
                        NewRecordModal's own submit handler — it never PATCHes
                        anything). Visually secondary (text-only, no border/
                        fill), icon + visible text for discoverability, native
                        button semantics. Intentionally NOT disabled during
                        W4 auto-pending — saving another record while a prior
                        automatic prediction is still resolving is an
                        explicitly-supported case (§16/Case B): the newest
                        save always supersedes the previous pending target. */}
                    <button
                      type="button"
                      onClick={() => setNewRecordModalOpen(true)}
                      className="flex items-center gap-1.5 text-xs font-medium text-primary hover:bg-primary/10 px-2.5 py-1.5 rounded-lg transition-colors flex-shrink-0"
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      { label: 'Presión sistólica', value: latestRecord.sysBP, unit: 'mmHg' },
                      { label: 'Presión diastólica', value: latestRecord.diaBP, unit: 'mmHg' },
                      { label: 'Colesterol total', value: latestRecord.totChol, unit: 'mg/dL' },
                      { label: 'Glucosa', value: latestRecord.glucose, unit: 'mg/dL' },
                      { label: 'IMC', value: latestRecord.bmi, unit: 'kg/m²' },
                      { label: 'Frec. cardíaca', value: latestRecord.heartRate, unit: 'bpm' },
                    ].map(item => (
                      <div key={item.label} className="bg-background rounded-lg border border-border p-3">
                        <p className="text-[11px] text-muted-foreground">{item.label}</p>
                        <p className="text-base font-bold font-mono text-foreground">{item.value}</p>
                        <p className="text-[10px] text-muted-foreground">{item.unit}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                  <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-xs text-red-700">{error}</p>
                    {/* V-AGE-FIX-2 §7 — CTA reuses the same navigation this
                        page already uses for the "no records" empty state
                        (below); it does not duplicate NewRecordModal's form,
                        it just takes the doctor to where that modal lives. */}
                    {errorCode === 'MODEL_INELIGIBLE' && (
                      <button
                        type="button"
                        onClick={() => navigate(`/patients/${patient.id}`)}
                        className="mt-2 text-xs font-medium text-red-700 underline hover:no-underline"
                      >
                        Ir a la ficha del paciente para crear un nuevo registro clínico
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-border">
                {/* W4.2 §18/§24 — disabled while a W4 automatic prediction is
                    pending for the current latestRecord (autoStatus ===
                    'pending' covers the whole pending window, including the
                    8s delayed-message period — never a separate check),
                    preventing a redundant second Prediction for the same
                    HealthRecord. Re-enabled the instant autoStatus reaches
                    any terminal outcome (success/unavailable/failed) or
                    returns to idle. Never auto-triggered by record creation
                    — this stays a separate, explicit doctor action. */}
                <button
                  onClick={handlePredict}
                  disabled={predicting || !hasRecord || autoStatus === 'pending'}
                  className="w-full flex items-center justify-center gap-2 bg-primary text-white py-3 rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  {predicting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Analizando con IA...
                    </>
                  ) : (
                    <>
                      <Activity className="w-4 h-4" />
                      Calcular riesgo cardiovascular
                    </>
                  )}
                </button>
                {autoStatus === 'pending' && (
                  <p className="text-[11px] text-muted-foreground text-center mt-2">
                    Deshabilitado mientras se genera la predicción automática del nuevo registro.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* ── Result Panel ──────────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">
            {/* W4.2 §9/§10/§12/§13/§15 — the automatic (W4) outcome takes
                precedence over the manual-flow's own `result`/empty state
                whenever it is active (pending or a terminal outcome not yet
                superseded by a newer manual click — handlePredict resets
                autoStatus to 'idle' the instant a manual run starts, so this
                branch only ever reflects the most recent action). */}
            {autoStatus === 'pending' ? (
              <div className="bg-card rounded-xl border border-border p-8 text-center">
                <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto mb-3" />
                <p className="font-medium text-foreground">
                  {/* §16 — message-only swap after 8s; NEVER a state change,
                      NEVER a claimed cause (not AI_UNAVAILABLE/AI_FAILURE/
                      MODEL_INELIGIBLE) — a late matching event still
                      resolves normally and replaces this immediately. */}
                  {autoDelayed ? 'La predicción está tardando más de lo esperado.' : 'Generando predicción...'}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  El nuevo registro clínico se guardó correctamente. Esperando el resultado automático.
                </p>
              </div>
            ) : autoStatus === 'unavailable' && autoUnavailable ? (
              // §12/§23 — established amber model-eligibility pattern,
              // reused verbatim (same copy/visual pattern as
              // PatientDetailPage's predictionUnavailableNotice). The saved
              // HealthRecord is untouched/still the visible latestRecord;
              // no fake Prediction, no riskScore 0, no LOW, no RiskGauge.
              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                  <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 text-sm text-amber-800">
                    <p>
                      El registro clínico se guardó correctamente, pero no fue posible generar una predicción:
                      la edad de este registro está fuera del rango de soporte de {autoUnavailable.modelVersion}{' '}
                      (rango soportado: {autoUnavailable.eligibleAgeRange.min}-{autoUnavailable.eligibleAgeRange.max} años).
                    </p>
                  </div>
                </div>
              </div>
            ) : autoStatus === 'failed' && autoFailedReason ? (
              // §17 — concise, cause-specific copy; no stack traces, no
              // Axios/internal details, no implied clinical conclusion.
              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                  <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">{AI_FAILURE_MESSAGES[autoFailedReason]}</p>
                </div>
              </div>
            ) : autoStatus === 'success' && autoResult ? (
              // §8/§9 — built only from the prediction_completed socket
              // payload (or the equivalent fields of a reconnect-recovered
              // persisted row, §21) — deliberately no anomaly-score
              // magnitude, no "Predicción generada..." timestamp line, and
              // no FeatureImportanceBar (none of those are available here;
              // see the AutoPredictionResult comment above — never
              // fabricated, per F31).
              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-foreground">Resultado</h3>
                  <RiskBadge level={autoResult.riskLevel} size="md" />
                </div>
                <div className="flex justify-center">
                  <RiskGauge score={autoResult.riskScore} level={autoResult.riskLevel} size={180} showLabel />
                </div>
                <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-border">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">Score de riesgo</p>
                    <p className="text-xl font-bold font-mono text-foreground mt-1">
                      {formatScore(autoResult.riskScore)}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">Anomalía</p>
                    <p className={cn('text-xl font-bold mt-1', autoResult.isAnomaly ? 'text-amber-600' : 'text-teal-600')}>
                      {autoResult.isAnomaly ? 'Sí' : 'No'}
                    </p>
                  </div>
                </div>
                {autoResult.isAnomaly && (
                  <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-amber-700">Anomalía detectada</p>
                      <p className="text-xs text-amber-600 mt-0.5">
                        Indicadores fuera del patrón normal en el nuevo registro.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : result ? (
              <>
                <div className="bg-card rounded-xl border border-border p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-foreground">Resultado</h3>
                    <RiskBadge level={result.riskLevel} size="md" />
                  </div>
                  <div className="flex justify-center">
                    <RiskGauge score={result.riskScore} level={result.riskLevel} size={180} showLabel />
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-border">
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">Score de riesgo</p>
                      <p className="text-xl font-bold font-mono text-foreground mt-1">
                        {formatScore(result.riskScore)}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">Anomalía</p>
                      <p className={cn('text-xl font-bold mt-1', result.isAnomaly ? 'text-amber-600' : 'text-teal-600')}>
                        {result.isAnomaly ? 'Sí' : 'No'}
                      </p>
                    </div>
                  </div>
                  {result.isAnomaly && (
                    <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                      <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-amber-700">Anomalía detectada</p>
                        <p className="text-xs text-amber-600 mt-0.5">
                          Indicadores fuera del patrón normal. Score: {result.anomalyScore.toFixed(4)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="bg-card rounded-xl border border-border p-8 text-center">
                <Activity className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="font-medium text-foreground">Sin predicción aún</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Ejecuta el análisis para obtener el riesgo cardiovascular del paciente
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
