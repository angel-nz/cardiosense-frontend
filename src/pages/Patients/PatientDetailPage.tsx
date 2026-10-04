import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import {
  ArrowLeft, Activity, Heart, Phone, Calendar,
  User, FileText, AlertTriangle, Plus, Edit, Loader2, X,
  PowerOff, RotateCcw, EyeOff, Mail, Maximize2, Telescope, ArrowLeftCircle, History,
} from 'lucide-react'
import { isAxiosError } from 'axios'
import { RiskBadge } from '@/components/ui/RiskBadge'
import { RiskGauge } from '@/components/charts/RiskGauge'
import { FeatureImportanceBar } from '@/components/charts/FeatureImportanceBar'
import { PatientCalendar } from '@/components/patients/PatientCalendar'
import { NewRecordModal } from '@/components/patients/NewRecordModal'
import { RiskProjectionSection } from '@/components/forecasts/RiskProjectionSection'
import { RiskEvolutionChart } from '@/components/charts/RiskEvolutionChart'
import { useCurrentRiskForecast } from '@/hooks/useCurrentRiskForecast'
import { buildRiskEvolutionModel, selectCompactPredictions, type RiskPoint } from '@/lib/riskEvolution'
import { RiskPointFullDetail } from '@/components/charts/RiskPointFullDetail'
import { useFullPredictionHistory } from '@/hooks/useFullPredictionHistory'
import { getTodayBusinessDateKey } from '@/lib/businessDate'
import { EditPatientModal } from '@/components/patients/EditPatientModal'
import { cn, formatDate, formatRelativeBusinessDate, calcAge, sexLabel, timeAgo } from '@/lib/utils'
import { getPhoneDisplay } from '@/lib/phone'
import { patientService } from '@/services/patientService'
import { predictionService } from '@/services/predictionService'
import { useSocket } from '@/context/SocketContext'
import { useActionNotify } from '@/context/ToastContext'
import { Dialog } from '@/components/ui/Dialog'
import type { Patient, HealthRecord, Prediction, DashboardEventNavigationState, HistorySortBy, HistorySortOrder } from '@/types'
import { recordService } from '@/services/recordService'
import { clinicalTimeLabel, recordClinicalTime, formatClinicalDateTime, LEGACY_TIME_NOTE } from '@/lib/clinicalTime'

// Y6.3B §38 — Risk Evolution chart (Recharts) text sizing. PatientDetailPage
// is this chart's owning component (the chart is rendered inline here, not
// factored into its own component). `height={180}` and all chart
// geometry/colors are unchanged. Y6.4B — this used to scale with the
// (now-removed) interface density/visibility preset via useAppearance();
// these are simply the chart's permanent text sizes now (the former
// Comfortable values).
const CHART_TEXT_SIZES = { axisTick: 12, tooltip: 13, refLine: 11 }

interface InfoRowProps {
  label: string
  value: string | number | boolean
  unit?: string
  highlight?: boolean
}

function InfoRow({ label, value, unit, highlight }: InfoRowProps) {
  const display = typeof value === 'boolean' ? (value ? 'Sí' : 'No') : String(value)
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn('text-sm font-semibold', highlight ? 'text-red-600 dark:text-red-400' : 'text-foreground')}>
        {display}{unit && <span className="font-normal text-muted-foreground ml-1">{unit}</span>}
      </span>
    </div>
  )
}

// U4.2A — the old inline personal-info editor (EditFormState + its
// firstName/lastName/phone-only fields) is gone entirely — editing now
// happens via EditPatientModal, which covers curp/birthDate/sex/phone/
// firstName/lastName in one place.

// U3.2 — New Record form state/logic now lives entirely in
// NewRecordModal.tsx (extracted from the previous inline expandable
// section) — RecordFormState/RECORD_INITIAL removed from here, no longer
// duplicated.

// O3-FIX-4/5 — defensively validates react-router `location.state` before
// trusting it as a Dashboard Calendar navigation payload. `location.state`
// is `unknown` by nature (anything could have pushed a history entry with
// arbitrary state) — never cast it directly.
function readDashboardEventNav(state: unknown): DashboardEventNavigationState | null {
  if (!state || typeof state !== 'object') return null
  const nav = (state as Record<string, unknown>).dashboardEventNav
  if (!nav || typeof nav !== 'object') return null
  const { target, calendarEventId, eventDate } = nav as Record<string, unknown>
  if (typeof calendarEventId !== 'string' || typeof eventDate !== 'string') return null
  if (!target || typeof target !== 'object') return null
  const { kind, id } = target as Record<string, unknown>
  if (typeof id !== 'string') return null
  if (kind !== 'HEALTH_RECORD' && kind !== 'PREDICTION') return null
  return { target: { kind, id }, calendarEventId, eventDate }
}

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { subscribeToPatient, unsubscribeFromPatient, lastPrediction, lastHealthRecord, lastPatientUpdate,
          clearLastPrediction, clearLastHealthRecord, clearLastPatientUpdate,
          lastPredictionUnavailable, clearLastPredictionUnavailable,
          lastPredictionFailed, clearLastPredictionFailed,
          lastRiskForecastsChanged, clearLastRiskForecastsChanged } = useSocket()
  const chartTextSizes = CHART_TEXT_SIZES
  const { notifySuccess, notifyError } = useActionNotify()

  // INT-16/17 — join patient:{id} while viewing this patient's page, leave
  // on unmount or when navigating to a different patient (id changes).
  // Effect cleanup guarantees "Paciente A -> Paciente B" resolves to
  // unsubscribe(A) then subscribe(B), never both rooms held at once.
  useEffect(() => {
    if (!id) return
    subscribeToPatient(id)
    return () => unsubscribeFromPatient(id)
  }, [id, subscribeToPatient, unsubscribeFromPatient])

  const [patient, setPatient] = useState<Patient | null>(null)
  const [patientLoading, setPatientLoading] = useState(true)
  const [patientError, setPatientError] = useState<string | null>(null)

  // NEW S2E-FIX1 — the ONE CURRENT risk-projection load state for this page
  // (one fetch, one risk_forecasts_changed consumer). Shared by "Evolución
  // del riesgo" (projected series) and "Proyección de riesgo cardiovascular"
  // (detail cards). Generation + AbortController guards inside the hook;
  // patient navigation (id change) restarts it from 'loading'.
  const { state: forecastState } = useCurrentRiskForecast(id, {
    changeSignal: lastRiskForecastsChanged,
    ackChangeSignal: clearLastRiskForecastsChanged,
    patientIsActive: patient?.isActive,
  })

  // Z8 — lifecycle/visibility action state. `statusBusy` disables the
  // relevant buttons for the duration of one in-flight request (status or
  // visibility mutations are never fired concurrently with each other).
  // `confirmDeactivateOpen`/`confirmHideOpen` back the two confirmation
  // dialogs §21/§F require (hide) and the manual runtime matrix's own §F
  // requires (deactivate) — Reactivar has no confirmation requirement
  // anywhere in the brief, so it fires directly.
  const [statusBusy, setStatusBusy] = useState(false)
  const [confirmDeactivateOpen, setConfirmDeactivateOpen] = useState(false)
  const [confirmHideOpen, setConfirmHideOpen] = useState(false)

  const [records, setRecords] = useState<HealthRecord[]>([])
  const [recordsLoading, setRecordsLoading] = useState(true)
  const [recordsError, setRecordsError] = useState<string | null>(null)

  // U5.2 — server-side pagination/sorting state for Clinical History.
  // `records` above now holds only the CURRENT page's rows.
  const [historyPage, setHistoryPage] = useState(1)
  const [historyLimit, setHistoryLimit] = useState(10)
  // NEW S2E-FIX2 — default = effective clinical time DESC (newest clinical
  // measurement first), ordered server-side before pagination.
  const [historySortBy, setHistorySortBy] = useState<HistorySortBy>('clinicalTime')
  const [historySortOrder, setHistorySortOrder] = useState<HistorySortOrder>('desc')
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyTotalPages, setHistoryTotalPages] = useState(0)

  // U5.2 — canonical latest HealthRecord, independent of Clinical History's
  // page/sort state (GET /health-records/patient/:id/latest, the same
  // endpoint U3 introduced for NewRecordModal's prefill). "Indicadores
  // clínicos" must never again read `records[0]`, since that array no
  // longer reliably represents the most recent record once the user sorts
  // by a non-date column or navigates away from page 1.
  const [latestRecord, setLatestRecord] = useState<HealthRecord | null>(null)
  const [latestRecordLoading, setLatestRecordLoading] = useState(true)

  // GET /api/predictions/patient/:id (predictionService.getHistory — same
  // real infrastructure already used/validated by PredictionHistoryPage).
  // This section of the page no longer depends on any hardcoded/mock data.
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [predictionsLoading, setPredictionsLoading] = useState(true)
  const [predictionsError, setPredictionsError] = useState<string | null>(null)

  // P4 — Calendar → longitudinal-view cross-navigation. Exact-identity only
  // (record.id / prediction.id) — never matched by date/score proximity.
  const [selectedHealthRecordId, setSelectedHealthRecordId] = useState<string | null>(null)
  const [selectedPredictionId, setSelectedPredictionId] = useState<string | null>(null)
  const [timelineFeedback, setTimelineFeedback] = useState<string | null>(null)
  const recordRowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map())
  const riskEvolutionRef = useRef<HTMLDivElement>(null)

  // NEW S2E-FIX2 — ONE modal coordinator for the risk experience (a single
  // Dialog whose content switches; never stacked dialogs / nested focus
  // traps): 'full' = complete risk-evolution chart, 'projection' = CURRENT
  // projection detail. `projectionFrom` records whether the projection view
  // was opened from the full chart (then it offers "Volver a la gráfica
  // completa") or directly from the compact card.
  const [riskModal, setRiskModal] = useState<null | 'full' | 'projection'>(null)
  const [projectionFrom, setProjectionFrom] = useState<'page' | 'full'>('page')
  // Bumped on every REAL prediction_completed for this patient, so an open
  // full-history modal reconciles its complete Prediction list.
  const [fullHistoryReloadKey, setFullHistoryReloadKey] = useState(0)
  // The page-level button that opened the risk modal; focus returns to it on
  // close (deterministic in every browser).
  const riskModalTriggerRef = useRef<HTMLElement | null>(null)
  const openFullChart = useCallback((trigger?: HTMLElement | null) => {
    if (trigger !== undefined) riskModalTriggerRef.current = trigger
    setProjectionFrom('page'); setRiskModal('full')
  }, [])
  const openProjection = useCallback((from: 'page' | 'full', trigger?: HTMLElement | null) => {
    if (from === 'page') riskModalTriggerRef.current = trigger ?? null
    setProjectionFrom(from); setRiskModal('projection')
  }, [])
  const closeRiskModal = useCallback(() => { setRiskModal(null); setProjectionFrom('page') }, [])
  const restoreRiskModalFocus = useCallback((e: Event) => {
    const t = riskModalTriggerRef.current
    if (t && t.isConnected) { e.preventDefault(); t.focus() }
  }, [])
  // O3-FIX-4/5 — `dashboardNav` is the copy of location.state's payload,
  // read once and kept in React state for the rest of this patient visit
  // (independent of the router's own history-state lifecycle, which gets
  // cleared right after reading — section 19). `navTargetAppliedRef` guards
  // only the EXTERNAL (History/Risk Evolution) side of it; PatientCalendar
  // consumes `dashboardNav`'s calendar fields independently, on its own
  // timing (its own month may still be loading) — the two must not be
  // coupled into a single "done" flag (section 20).
  const [dashboardNav, setDashboardNav] = useState<DashboardEventNavigationState | null>(null)
  const navTargetAppliedRef = useRef(false)

  // U8.6C — ephemeral, page-local informational banner. Deliberately
  // separate from `timelineFeedback` (that one is Calendar deep-link
  // feedback, rendered inside PatientCalendar's day panel — a different
  // concern in a different location; sharing one state would let either
  // silently clobber the other). Cleared on patient switch below; not
  // persisted anywhere, so a missed event while offline/on another page is
  // not recoverable (see U8.6-DEBT-1..3 and the reconnect note below —
  // this notice is intentionally NOT replayed on reconnect).
  const [predictionUnavailableNotice, setPredictionUnavailableNotice] = useState<{
    healthRecordId: string
    modelVersion: string
    eligibleAgeRange: { min: number; max: number }
  } | null>(null)

  // Patient switch (A→B): clear cross-navigation state — a highlighted
  // record/prediction from the previous patient must never survive.
  useEffect(() => {
    setSelectedHealthRecordId(null)
    setSelectedPredictionId(null)
    setTimelineFeedback(null)
    setDashboardNav(null)
    navTargetAppliedRef.current = false
    setPredictionUnavailableNotice(null)
    // NEW S2E-FIX2 — a risk modal never survives a patient switch.
    setRiskModal(null)
    setProjectionFrom('page')
  }, [id])

  // U8.6C — prediction_unavailable, user:{userId} room (auto-joined, no
  // subscribe_patient needed — same as dashboard_activity_changed/
  // patient_created). Filtered locally by patientId, exactly like the
  // existing lastPrediction/lastHealthRecord/lastPatientUpdate effects
  // below. A second distinct event (a different healthRecordId) replaces
  // this notice with its own content — each arrival is independently
  // shown, never permanently suppressed. The only accepted limitation
  // (same one already documented for every "last event" scalar in
  // SocketContext) is that two events arriving before the doctor reads the
  // first would show only the second — not a queue.
  useEffect(() => {
    if (!id || !lastPredictionUnavailable || lastPredictionUnavailable.patientId !== id) return
    setPredictionUnavailableNotice({
      healthRecordId: lastPredictionUnavailable.healthRecordId,
      modelVersion: lastPredictionUnavailable.modelVersion,
      eligibleAgeRange: lastPredictionUnavailable.eligibleAgeRange,
    })
    clearLastPredictionUnavailable()
  }, [id, lastPredictionUnavailable, clearLastPredictionUnavailable])

  // U8.2B — CLINICAL_RECORD selection (PatientCalendar manual click, or the
  // Dashboard navigation target applied below). If the target is already
  // on the currently loaded Clinical History page, select/scroll to it
  // immediately — no network request. Otherwise, resolve its actual page
  // server-side (GET /patients/:id/history?targetId=..., preserving the
  // current sortBy/sortOrder/limit — U5's pagination/sorting is never
  // bypassed) and adopt that canonical page as the new current page,
  // never fabricating/inserting the row locally. A conclusively
  // unavailable target (foreign patient, nonexistent, or excluded by
  // active filters) surfaces the same single feedback message either way
  // — never distinguishing which case occurred.
  const handleSelectHealthRecord = useCallback(async (healthRecordId: string) => {
    if (records.some(r => r.id === healthRecordId)) {
      setTimelineFeedback(null)
      setSelectedPredictionId(null)
      setSelectedHealthRecordId(healthRecordId)
      recordRowRefs.current.get(healthRecordId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    if (!id) return
    const requestId = ++historyRequestIdRef.current
    try {
      const history = await patientService.getHistory(id, {
        page: historyPage, limit: historyLimit, sortBy: historySortBy, sortOrder: historySortOrder,
        targetId: healthRecordId,
      })
      if (requestId !== historyRequestIdRef.current) return
      if (!history.targetResolved) {
        setTimelineFeedback('Este registro no está incluido en el historial clínico actualmente visible.')
        return
      }
      setRecords(history.records.data)
      setHistoryTotal(history.records.total)
      setHistoryTotalPages(history.records.totalPages)
      setHistoryPage(history.records.page)
      setTimelineFeedback(null)
      setSelectedPredictionId(null)
      setSelectedHealthRecordId(healthRecordId)
      // The target's row ref only attaches once this new page's table body
      // actually renders — wait a frame before scrolling to it.
      requestAnimationFrame(() => {
        recordRowRefs.current.get(healthRecordId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    } catch {
      if (requestId !== historyRequestIdRef.current) return
      setTimelineFeedback('Este registro no está incluido en el historial clínico actualmente visible.')
    }
  }, [records, id, historyPage, historyLimit, historySortBy, historySortOrder])

  // U8.2B — PREDICTION / RISK_CHANGE selection (RISK_CHANGE passes its
  // currentPredictionId here — same target, same mechanism). If already in
  // the currently loaded window, select/scroll immediately. Otherwise,
  // resolve the canonical patient-prediction page that actually contains
  // it (GET /predictions/patient/:id?targetId=..., same limit — V5.1: 24,
  // matching loadPredictions above, kept coordinated so a resolved page is
  // the same size as the normal view) and REPLACE the entire chart
  // dataset with that genuine, contiguous page — never merged with the
  // previous latest-24 view, never a fabricated point. A later realtime
  // Prediction event may legitimately revert this to the normal latest-24
  // window once the target has already been applied (see loadPredictions's
  // own realtime effect, unchanged).
  // NEW S2E-FIX2 — the compact chart now always shows the latest 10 REAL
  // Predictions, so a target outside that window is no longer swapped into
  // the compact dataset (which would silently stop being "the latest 10").
  // Instead its existence is confirmed with the same targetId lookup and the
  // COMPLETE chart opens with it highlighted.
  const handleSelectPrediction = useCallback(async (predictionId: string) => {
    if (predictions.some(p => p.id === predictionId)) {
      setTimelineFeedback(null)
      setSelectedHealthRecordId(null)
      setSelectedPredictionId(predictionId)
      riskEvolutionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    if (!id) return
    try {
      const result = await predictionService.getHistory(id, { limit: 10, targetId: predictionId })
      if (!result.targetResolved) {
        setTimelineFeedback('Esta predicción no está disponible en el historial de este paciente.')
        return
      }
      setTimelineFeedback(null)
      setSelectedHealthRecordId(null)
      setSelectedPredictionId(predictionId)
      openFullChart(null)
    } catch {
      setTimelineFeedback('Esta predicción no está disponible en el historial de este paciente.')
    }
  }, [predictions, id, openFullChart])

  // P4-FIX — called by PatientCalendar whenever its own temporal context
  // changes (day, month, "Hoy") in a way that invalidates whichever
  // external target a previous Calendar click had selected. Referentially
  // stable (useCallback, no deps) so it never causes PatientCalendar's
  // patient-switch effect to re-run for the wrong reason.
  const handleClearTimelineSelection = useCallback(() => {
    setSelectedHealthRecordId(null)
    setSelectedPredictionId(null)
    setTimelineFeedback(null)
  }, [])

  // O3-FIX-4/5 — read the Dashboard Calendar navigation payload (if any)
  // from location.state exactly once per patient visit, into `dashboardNav`
  // (React state — persists independent of the router's own history-state
  // lifecycle). Clears the history entry's state right after copying it,
  // so a later refresh/back doesn't hand the same payload back — safe to
  // do immediately, since `dashboardNav` already holds everything both
  // consumers (external selection below, and PatientCalendar via its own
  // prop) need, on their own independent timing (section 19/20).
  useEffect(() => {
    if (dashboardNav) return
    const nav = readDashboardEventNav(location.state)
    if (!nav) return
    setDashboardNav(nav)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.state, location.pathname, dashboardNav, navigate])

  // O3-FIX-4 / U8.2B — apply the EXTERNAL (History/Risk Evolution) side of
  // a Dashboard navigation target, reusing the exact same P4 selection
  // handlers a PatientCalendar click uses. Waits for records/predictions
  // to finish their own initial fetch before attempting the match
  // (section 12 of O3-FIX-4). Consumed (navTargetAppliedRef set) only once
  // the handler's own resolution — synchronous fast path or the async
  // targeted-page fetch — has actually SETTLED (found-and-applied, or
  // conclusively unavailable) — never merely upon dispatch, which would
  // reintroduce the premature-consumption defect U8.2A diagnosed. The
  // `cancelled` guard prevents a resolution that outlives this effect
  // (e.g. the patient changed mid-resolution) from marking the WRONG
  // patient visit's target as already applied.
  useEffect(() => {
    if (!dashboardNav) return
    if (navTargetAppliedRef.current) return
    if (recordsLoading) return
    if (predictionsLoading) return
    let cancelled = false
    const target = dashboardNav.target
    const run = async () => {
      if (target.kind === 'HEALTH_RECORD') {
        await handleSelectHealthRecord(target.id)
      } else {
        await handleSelectPrediction(target.id)
      }
      if (!cancelled) navTargetAppliedRef.current = true
    }
    run()
    return () => { cancelled = true }
  }, [dashboardNav, recordsLoading, predictionsLoading, handleSelectHealthRecord, handleSelectPrediction])

  const [editPatientModalOpen, setEditPatientModalOpen] = useState(false)

  // U3.2 — New Record modal (replaces the previous inline expandable form
  // and its showRecordForm/recordForm/recordSavingRef/etc. state — all of
  // that now lives inside NewRecordModal.tsx, which owns its own submit/
  // double-submit-guard/error state; this page only needs to know whether
  // the dialog is open).
  const [newRecordModalOpen, setNewRecordModalOpen] = useState(false)

  const patientRequestIdRef = useRef(0)

  const loadPatient = useCallback(async (silent = false) => {
    if (!id) return
    const requestId = ++patientRequestIdRef.current
    if (!silent) setPatientLoading(true)
    setPatientError(null)
    try {
      const p = await patientService.getById(id)
      if (requestId !== patientRequestIdRef.current) return
      setPatient(p)
    } catch (err) {
      if (requestId !== patientRequestIdRef.current) return
      if (!silent) {
        setPatientError(
          isAxiosError(err) && err.response?.status === 404
            ? 'Paciente no encontrado'
            : 'No se pudo cargar la información del paciente',
        )
      }
    } finally {
      // PRE-Y8 (Alerts/Predictions/Navigation fix), Part C — root cause of
      // the "Cargando paciente" indefinite spinner. When a stale
      // `lastPrediction` socket event (left uncleared by a manual
      // prediction on this same patient — see PredictionsPage.tsx's own
      // correlation guard) is already pending at mount time, this
      // effect's silent `loadPatient(true)` call and the plain mount
      // effect's non-silent `loadPatient()` call both fire in the same
      // commit, in source declaration order. Because requestId only
      // increments, the silent call always ends up with the *higher*
      // requestId and so is the one whose result actually gets applied —
      // but the old `&& !silent` guard here meant its `finally` block
      // never cleared `patientLoading`, and the earlier non-silent call's
      // own `finally` no longer matches `patientRequestIdRef.current` by
      // the time it resolves, so neither call ever set it back to
      // `false`. `patient` was in fact set to correct fetched data by the
      // silent call — the bug was purely that the loading flag never
      // cleared, keeping the component pinned on the `patientLoading`
      // spinner branch. Dropping `&& !silent` here means whichever call
      // currently owns `requestId` always clears the flag when it
      // settles, regardless of whether that call happened to be silent —
      // preserving every other silent/non-silent distinction in this
      // function (setPatientLoading(true) is still skipped on entry for
      // silent calls, and setPatientError is still suppressed for silent
      // failures, so a silent background refresh still never flashes the
      // loading spinner or an error message; it now just correctly stops
      // being "loading" once it resolves either way — a silent failure
      // still falls through safely to the existing
      // `patientError ?? 'Paciente no encontrado'` UI below instead of
      // spinning forever).
      if (requestId === patientRequestIdRef.current) setPatientLoading(false)
    }
  }, [id])

  // GET /api/patients/:id/history — U5.2: `records` is now server-side
  // paginated/sorted (page/limit/sortBy/sortOrder); `predictions` in the
  // response remains unused here (Risk Evolution has its own independent
  // endpoint below). requestId-guarded: rapid sort/page/limit changes must
  // never let a stale response overwrite newer UI state.
  const historyRequestIdRef = useRef(0)
  const loadHistory = useCallback(async (silent = false) => {
    if (!id) return
    const requestId = ++historyRequestIdRef.current
    if (!silent) setRecordsLoading(true)
    setRecordsError(null)
    try {
      const history = await patientService.getHistory(id, {
        page: historyPage, limit: historyLimit, sortBy: historySortBy, sortOrder: historySortOrder,
      })
      if (requestId !== historyRequestIdRef.current) return
      setRecords(history.records.data)
      setHistoryTotal(history.records.total)
      setHistoryTotalPages(history.records.totalPages)
      // Out-of-range correction (U5.2 §3): the backend never clamps `page`
      // itself — an out-of-range page legitimately comes back with an
      // empty `data` array and the real total/totalPages. This page owns
      // correcting its own visual page state from that, exactly once
      // (idempotent: re-evaluating against the corrected page no longer
      // satisfies the condition, so this cannot loop).
      if (history.records.total > 0 && historyPage > history.records.totalPages) {
        setHistoryPage(history.records.totalPages)
      } else if (history.records.total === 0 && historyPage !== 1) {
        setHistoryPage(1)
      }
    } catch {
      if (requestId !== historyRequestIdRef.current) return
      if (!silent) setRecordsError('No se pudo cargar el historial clínico')
    } finally {
      // Y8B F2 — was `requestId === historyRequestIdRef.current && !silent`.
      // The CURRENT (most recently dispatched) request must always clear
      // `recordsLoading` when it settles, regardless of whether that
      // specific request happened to be silent — same ownership principle
      // already validated for loadPatient's own fix (PRE-Y8 Part C). Under
      // the old `&& !silent` guard, a silent refresh that ended up owning
      // `historyRequestIdRef.current` when it resolved would never clear
      // the flag (its own check failed on `!silent`), and the earlier
      // non-silent request that DID set the flag no longer matches the ref
      // by the time IT resolves — so neither call ever turned the spinner
      // back off, leaving this card spinning forever even though `records`
      // above was already updated correctly. Entry-time behavior is
      // unchanged: `if (!silent) setRecordsLoading(true)` above still means
      // a silent refresh never turns the spinner ON — this only changes
      // whether a silent request is allowed to turn an existing spinner
      // OFF once it becomes the current request.
      if (requestId === historyRequestIdRef.current) setRecordsLoading(false)
    }
  }, [id, historyPage, historyLimit, historySortBy, historySortOrder])

  // U5.2 — canonical latest record, independent of Clinical History's own
  // page/sort — reuses U3's dedicated endpoint (same one NewRecordModal
  // already uses), never `records[0]`.
  const latestRecordRequestIdRef = useRef(0)
  const loadLatestRecord = useCallback(async (silent = false) => {
    if (!id) return
    const requestId = ++latestRecordRequestIdRef.current
    if (!silent) setLatestRecordLoading(true)
    try {
      // NEW S2E-FIX3 — latest CLINICAL record (same helper as the record form
      // and Nueva predicción), not the latest entered one.
      const latest = await recordService.getLatestClinical(id)
      if (requestId !== latestRecordRequestIdRef.current) return
      setLatestRecord(latest)
    } catch {
      // Silent failure keeps whatever was last shown — same pattern used
      // elsewhere for background/realtime-triggered loaders in this file.
    } finally {
      // Y8B F3 — same ownership fix as loadHistory (F2) above, same root
      // cause: the CURRENT request must clear `latestRecordLoading` when it
      // settles regardless of its own `silent` flag, or a silent request
      // that wins ownership of `latestRecordRequestIdRef.current` could
      // leave this card's spinner stuck forever. Entry-time behavior is
      // unchanged — a silent refresh still never sets the flag to `true`.
      if (requestId === latestRecordRequestIdRef.current) setLatestRecordLoading(false)
    }
  }, [id])

  // GET /api/predictions/patient/:id — same service already used by
  // PredictionHistoryPage (Bloque C/F); backend orders most-recent-first,
  // so predictions[0] is the latest, no re-sort needed.
  //
  // V5.1 — explicit `{ limit: 24 }` (was: no options, i.e. the service's
  // own default of 20). This is the Risk Evolution display cap; changed
  // HERE, at this call site only, rather than in predictionService's
  // shared default — PredictionHistoryPage.tsx calls the exact same
  // getHistory(patientId) with no options and must keep seeing 20
  // (V5.1 §6: do not change Prediction History merely because it shares
  // the number 20). No backend change needed: 24 is well under the
  // existing PatientPredictionQueryDto max(100), and is sent explicitly,
  // so the backend's own default(20) (only used when no limit is sent)
  // never comes into play here.
  // Y8B F6 — added `predictionsRequestIdRef`, matching the requestId-guard
  // pattern `historyRequestIdRef`/`latestRecordRequestIdRef` already use.
  // Before this fix, loadPredictions had NO staleness guard at all: two
  // overlapping calls (e.g. the initial mount fetch and a `lastPrediction`-
  // triggered silent refetch below) resolved last-write-wins regardless of
  // DISPATCH order — a slower, earlier request resolving after a faster,
  // later one could overwrite fresher prediction data (and the Risk Gauge/
  // Risk Evolution chart built from it) with stale data. Only the request
  // that still owns the current `requestId` when it settles may now update
  // `predictions`/`predictionsError`, and that same current-request check
  // — not `!silent` — now governs `predictionsLoading` too, so a silent
  // winner can also correctly clear a spinner a non-silent request left on,
  // the same ownership principle just applied to loadHistory (F2) and
  // loadLatestRecord (F3) above.
  const predictionsRequestIdRef = useRef(0)
  const loadPredictions = useCallback(async (silent = false) => {
    if (!id) return
    const requestId = ++predictionsRequestIdRef.current
    if (!silent) setPredictionsLoading(true)
    setPredictionsError(null)
    try {
      // NEW S3 — compact window: the 10 CLINICALLY latest REAL Predictions
      // (backend sortBy=clinicalTime: source record effective time DESC,
      // recordedAt, id, predictedAt, id). predictions[0] is therefore the
      // current observed risk (clinically latest record's Prediction). The
      // complete history is loaded lazily only by the full-chart modal.
      const result = await predictionService.getHistory(id, { limit: 10 })
      if (requestId !== predictionsRequestIdRef.current) return
      setPredictions(result.data)
    } catch {
      // A stale request's failure must never overwrite a newer request's
      // already-applied success (or a newer request's own error, keeping
      // whichever is actually current).
      if (requestId !== predictionsRequestIdRef.current) return
      if (!silent) setPredictionsError('No se pudo cargar el historial de predicciones')
    } finally {
      if (requestId === predictionsRequestIdRef.current) setPredictionsLoading(false)
    }
  }, [id])

  useEffect(() => { loadPatient() }, [loadPatient])
  useEffect(() => { loadHistory() }, [loadHistory])
  useEffect(() => { loadLatestRecord() }, [loadLatestRecord])
  useEffect(() => { loadPredictions() }, [loadPredictions])

  // INT-19 — prediction_completed: refresh both the patient (latestRisk/
  // latestScore badge in the header, from patientService's embedded most
  // recent prediction) and the real predictions list this page now shows
  // (risk gauge / evolution chart / feature importance). Payload lacks
  // predictedAt/anomalyScore/modelVersion, not enough to build a full
  // Prediction safely, so both are silent refetches, not a direct merge.
  useEffect(() => {
    if (!id || !lastPrediction || lastPrediction.patientId !== id) return
    loadPatient(true)
    loadPredictions(true)
    setFullHistoryReloadKey(k => k + 1)   // NEW S2E-FIX2 — open full modal reconciles
    clearLastPrediction()
  }, [id, lastPrediction, loadPatient, loadPredictions, clearLastPrediction])

  // NEW S4 — prediction_failed now means "attempt failed, retrying
  // automatically" (durable task in RETRY_WAIT). Silent patient refetch so
  // the current-risk card shows "Reintentando predicción automática"; no
  // error banner, no manual retry, never an older risk.
  useEffect(() => {
    if (!id || !lastPredictionFailed || lastPredictionFailed.patientId !== id) return
    loadPatient(true)
    clearLastPredictionFailed()
  }, [id, lastPredictionFailed, loadPatient, clearLastPredictionFailed])


  // U5.2 — health_record_created. Server-side pagination/sorting means a
  // newly created row's position in the CURRENT page/sort view is
  // unknowable from the thin socket payload alone (unlike the pre-U5
  // "prepend to the top" assumption, valid only when the visible list was
  // always the full, always-recordedAt-desc collection). Canonical refetch
  // of the current page/limit/sort is the only correct response — coalesced
  // ~400ms (same window already validated elsewhere in this project) so a
  // creation's own POST success and its own realtime echo collapse into a
  // single pair of refreshes rather than two.
  const historyCoalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleHistoryRefresh = useCallback(() => {
    if (historyCoalesceTimerRef.current) clearTimeout(historyCoalesceTimerRef.current)
    historyCoalesceTimerRef.current = setTimeout(() => {
      historyCoalesceTimerRef.current = null
      loadHistory(true)
      loadLatestRecord(true)
      loadPatient(true)          // NEW S3 — latestClinicalAt ("Última actualización")
    }, 400)
  }, [loadHistory, loadLatestRecord, loadPatient])

  useEffect(() => {
    if (!id || !lastHealthRecord || lastHealthRecord.patientId !== id) return
    scheduleHistoryRefresh()
    clearLastHealthRecord()
  }, [id, lastHealthRecord, scheduleHistoryRefresh, clearLastHealthRecord])

  useEffect(() => {
    return () => {
      if (historyCoalesceTimerRef.current) clearTimeout(historyCoalesceTimerRef.current)
    }
  }, [])

  // U4.2A — patient_updated is invalidation-only (kept intentionally
  // lightweight — see EditPatientModal/patient.service.ts, no
  // curp/birthDate/sex/phone added to its payload). This effect no longer
  // merges fields manually from the socket payload (that only worked while
  // firstName/lastName/isActive were the only editable fields) — now that
  // curp/birthDate/sex are also editable, the canonical GET below is the
  // only correct source for the full Patient. The creator's own tab
  // updates immediately from its PUT response instead (see
  // handlePatientUpdated below) — this effect exists for OTHER tabs/
  // sessions to converge.
  useEffect(() => {
    if (!id || !lastPatientUpdate || lastPatientUpdate.patientId !== id) return
    loadPatient(true)
    clearLastPatientUpdate()
  }, [id, lastPatientUpdate, loadPatient, clearLastPatientUpdate])

  // U4.2A — passed as EditPatientModal's onUpdated. The PUT response is
  // already the authoritative, complete Patient — replace local state
  // directly with it (never wait for the socket echo, matching Q3's own
  // "creator updates itself from its own response" principle).
  const handlePatientUpdated = (updated: Patient) => {
    setPatient(updated)
  }

  // Z8 §7/§8/§9/§21/§22/§37 — lifecycle/visibility actions. Each uses the
  // exact same global ActionNotification system (Z3) already established —
  // no local success banner is reintroduced. `patient` is narrowed non-null
  // by the loading/error guards above these handlers are only reachable
  // from (the JSX below), so no extra null check is needed inside them.
  const handleDeactivate = async () => {
    if (!patient) return
    setStatusBusy(true)
    try {
      const updated = await patientService.setStatus(patient.id, false)
      setPatient(updated)
      setConfirmDeactivateOpen(false)
      notifySuccess('Paciente desactivado.')
    } catch (err) {
      if (isAxiosError(err) && err.response?.data?.error) {
        notifyError(err.response.data.error)
      } else {
        notifyError('No se pudo desactivar al paciente. Intenta de nuevo.')
      }
    } finally {
      setStatusBusy(false)
    }
  }

  // §9 — no confirmation: reversible, and nothing in the brief asks for one
  // here (unlike Desactivar/Ocultar, both explicitly confirmed above).
  const handleReactivate = async () => {
    if (!patient) return
    setStatusBusy(true)
    try {
      const updated = await patientService.setStatus(patient.id, true)
      setPatient(updated)
      notifySuccess('Paciente reactivado.')
    } catch (err) {
      if (isAxiosError(err) && err.response?.data?.error) {
        notifyError(err.response.data.error)
      } else {
        notifyError('No se pudo reactivar al paciente. Intenta de nuevo.')
      }
    } finally {
      setStatusBusy(false)
    }
  }

  // §21 — after a successful hide, navigate back to Patients (preferred):
  // this exact PatientDetailPage becomes inaccessible for a hidden patient
  // (§25/§26), so staying here would show a now-stale, soon-to-404 page.
  const handleHide = async () => {
    if (!patient) return
    setStatusBusy(true)
    try {
      await patientService.setVisibility(patient.id, true)
      setConfirmHideOpen(false)
      notifySuccess('Paciente ocultado. Podrás volver a mostrarlo desde Configuración.')
      navigate('/patients')
    } catch (err) {
      if (isAxiosError(err) && err.response?.data?.error) {
        notifyError(err.response.data.error)
      } else {
        notifyError('No se pudo ocultar al paciente. Intenta de nuevo.')
      }
      setStatusBusy(false)
    }
  }

  // U5.2 — passed as NewRecordModal's onCreated. The pre-U5 "prepend
  // locally" assumption (recordedAt-desc was always the visible order, and
  // records[] always held the FULL collection) no longer holds once
  // Clinical History is server-side paginated/sorted — the newly created
  // row's position within the current page/sort view can't be inferred
  // from the client alone. Canonical refetch of both concerns instead:
  // the current Clinical History page/limit/sort, and the independent
  // latest-record state that "Indicadores clínicos" reads.
  const handleRecordCreated = () => {
    loadHistory(true)
    loadLatestRecord(true)
    // NEW S4 — the record is saved once its transaction commits, whatever
    // the AI service's state; the automatic Prediction is a durable task
    // (pending / retrying shown by the current-risk card from the patient
    // payload). No manual retry action exists.
    loadPatient(true)
    notifySuccess('Registro clínico guardado. La predicción se generará automáticamente.')
  }

  // U5.2 — Clinical History sort/pagination interaction handlers.
  const handleSortClick = (field: HistorySortBy) => {
    if (historySortBy === field) {
      setHistorySortOrder(o => (o === 'asc' ? 'desc' : 'asc'))
    } else {
      setHistorySortBy(field)
      setHistorySortOrder('desc')
    }
    setHistoryPage(1)
  }
  const handleLimitChange = (limit: number) => {
    setHistoryLimit(limit)
    setHistoryPage(1)
  }

  // NEW S2E-FIX1 — "Evolución del riesgo" model on the CLINICAL time axis.
  // Pure composition of the REAL series (predictions → source HealthRecord
  // clinical time) and the CURRENT projected series; both filtered to `id`,
  // so a late response of another patient can never be mixed in.
  // NEW S2E-FIX2 — compact = latest 10 by Prediction recency, positioned by
  // clinical time; CURRENT projections (0–3) are added on top of that limit.
  const compactPredictions = useMemo(() => selectCompactPredictions(predictions), [predictions])
  const evolutionModel = useMemo(
    () => buildRiskEvolutionModel({ patientId: id ?? '', predictions: compactPredictions, forecastState, todayKey: getTodayBusinessDateKey() }),
    [id, compactPredictions, forecastState],
  )
  // NEW S2E-FIX2 — complete history, LAZY: only while the full chart (or the
  // projection view opened FROM it) is showing.
  const fullHistoryEnabled = riskModal === 'full' || (riskModal === 'projection' && projectionFrom === 'full')
  const fullHistory = useFullPredictionHistory(id, fullHistoryEnabled, fullHistoryReloadKey)
  const fullPredictions = fullHistory.phase === 'ready' ? fullHistory.predictions : null
  const fullModel = useMemo(
    () => buildRiskEvolutionModel({ patientId: id ?? '', predictions: fullPredictions ?? [], forecastState, todayKey: getTodayBusinessDateKey() }),
    [id, fullPredictions, forecastState],
  )
  // NEW S2E-FIX4 — the full modal's point description is the selected
  // point's FLOATING box (RiskEvolutionChart variant="full"); no permanent
  // detail section. A deep-linked Prediction is the chart's initial selection.
  const fullPredictionsById = useMemo(() => new Map((fullPredictions ?? []).map(p => [p.id, p])), [fullPredictions])
  const renderFullPointDetail = useCallback(
    (point: RiskPoint) => <RiskPointFullDetail point={point} predictionsById={fullPredictionsById} forecastState={forecastState} todayKey={getTodayBusinessDateKey()} />,
    [fullPredictionsById, forecastState],
  )

  // Deterministic focus when the single dialog switches views.
  useEffect(() => {
    if (!riskModal) return
    const raf = requestAnimationFrame(() => {
      (document.querySelector('[data-risk-modal-autofocus]') as HTMLElement | null)?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [riskModal])

  // ── Loading / error states for the patient fetch ──────────────────────
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

  // NEW S3-FIX2 — current observed risk comes ONLY from the canonical
  // backend field `patient.currentPrediction` (Prediction of the EXACT
  // clinically latest HealthRecord; predictedAt DESC, id DESC within it;
  // null ⇒ no current risk). It never searches the Prediction history
  // (`predictions` is the partial compact window for the evolution chart),
  // so page size, pagination, unlinked/legacy rows, chart loading or a
  // failed history request cannot change or erase the current state.
  const latestPrediction = patient.currentPrediction ?? undefined
  // NEW S4 — durable automatic-Prediction task of that exact record (only
  // while it has no Prediction yet): pending / retrying wording, never an
  // older risk. Null ⇒ no active task (completed, blocked or absent).
  const currentTask = !latestPrediction ? patient.currentPredictionTask ?? null : null
  // NEW S4 — ONE navigation to THIS patient's Prediction history, shared by
  // the compact card's "Historial" and the full-chart modal's "Historial".
  const openPredictionHistory = () => { setRiskModal(null); navigate(`/predictions/${patient.id}`) }
  // Clinical time of that exact record (it IS the latest clinical record).
  const currentRecordTime = patient.latestClinicalAt
    ? { recordedAt: patient.latestClinicalAt, measuredAt: patient.latestClinicalTimeSource === 'CLINICIAN_ENTERED' ? patient.latestClinicalAt : null, clinicalTimeSource: patient.latestClinicalTimeSource ?? 'LEGACY_ENTRY_TIME' }
    : null
  const age = calcAge(patient.birthDate)

  return (
    <div className="ui-section-stack-tight">
      {/* Header — PRE-R2E §11-§13 — sticky, the strongest sticky behavior
          this spec requires: the COMPLETE existing header/action section
          (Volver, name, risk badge, inactive pill, age/sex/last-update
          meta, and the active/inactive-specific action buttons) as ONE
          coherent region — nothing below this div (the inactive-patient
          explanation banner, dialogs, the model-ineligibility notice, the
          two-column content) is part of it, per §13/§18. The ACTIVE vs.
          INACTIVE_VISIBLE action sets below are completely unmodified —
          whichever the current patient state already renders is what
          sticks; no guard is bypassed, no action added or removed. See
          .ui-sticky-toolbar (index.css) for the offset/z-index rationale
          shared with every other PRE-R2E region.
          PRE-R2E-FIX3 — `bg-background` → `bg-background/80`, matching
          Topbar's translucent treatment; blur centralized in
          `.ui-sticky-toolbar`. Visual-only — none of the patient-state
          action-button logic above is touched. */}
      <div
        className="ui-sticky-toolbar flex items-center gap-3 bg-background/80 border-b border-border"
        style={{ paddingTop: 'var(--ui-secondary-control-padding-y)', paddingBottom: 'var(--ui-secondary-control-padding-y)' }}
      >
        <button
          onClick={() => navigate('/patients')}
          className="p-2 rounded-lg hover:bg-accent transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-foreground">
              {patient.firstName} {patient.lastName}
            </h1>
            {patient.latestRisk && (
              <RiskBadge level={patient.latestRisk} score={patient.latestScore} showScore size="md" />
            )}
            {!patient.isActive && (
              <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium bg-muted text-muted-foreground border border-border">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
                Inactivo
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            {/* NEW S3 — clinical time of the clinically latest HealthRecord;
                personal-info edits (Paciente.updatedAt) never move it. */}
            {age} años · {sexLabel(patient.sex)} · <span data-testid="patient-last-clinical">{patient.latestClinicalAt ? `Última actualización ${timeAgo(patient.latestClinicalAt)}` : 'Sin registros clínicos'}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
          {patient.isActive ? (
            <>
              <button
                onClick={() => setNewRecordModalOpen(true)}
                className="flex items-center gap-2 bg-primary text-white px-4 ui-compact-control-density rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Nuevo registro
              </button>
              {/* NEW S2E-FIX4 — "Nueva predicción" removed: saving a "Nuevo
                  registro" is the only way a Prediction is produced
                  (automatically). */}
              <button
                onClick={() => setEditPatientModalOpen(true)}
                className="p-2 rounded-lg border border-border hover:bg-accent transition-colors"
              >
                <Edit className="w-4 h-4 text-muted-foreground" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleReactivate}
                disabled={statusBusy}
                className="flex items-center gap-2 px-4 ui-compact-control-density rounded-lg text-sm font-medium border border-teal-700 dark:border-teal-800/60 text-teal-700 dark:text-teal-300 bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/15 dark:hover:bg-teal-950/60 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-4 h-4 text-teal-700 dark:text-teal-300" />
                Reactivar
              </button>
              <button
                onClick={() => setConfirmHideOpen(true)}
                disabled={statusBusy}
                className="flex items-center gap-2 px-4 ui-compact-control-density rounded-lg text-sm font-medium border border-amber-700 dark:border-amber-800/60 text-amber-700 dark:text-amber-300 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/15 dark:hover:bg-amber-950/60 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <EyeOff className="w-4 h-4 text-amber-700 dark:text-amber-300" />
                Ocultar
              </button>
            </>
          )}
        </div>
      </div>

      {/* Z8 §34 — concise explanation, backend-enforced regardless (the
          actions themselves are simply not rendered above for this state,
          per §25). */}
      {!patient.isActive && (
        <div className="flex items-start gap-3 bg-muted/50 border border-border rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
          <p className="flex-1 text-sm text-muted-foreground">
            El paciente está inactivo. Reactívalo para registrar nueva actividad clínica.
          </p>
        </div>
      )}

      {/* Z8 §21 — Desactivar confirmation. */}
      <Dialog
        open={confirmDeactivateOpen}
        onOpenChange={setConfirmDeactivateOpen}
        title="¿Desactivar paciente?"
        description="El paciente dejará de poder recibir nuevos registros clínicos o predicciones hasta que lo reactives. Su información e historial clínico se conservarán sin cambios."
        preventClose={statusBusy}
      >
        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={() => setConfirmDeactivateOpen(false)}
            disabled={statusBusy}
            className="px-4 ui-compact-control-density text-sm font-medium rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            onClick={handleDeactivate}
            disabled={statusBusy}
            className="flex items-center gap-2 px-4 ui-compact-control-density text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {statusBusy && <Loader2 className="w-4 h-4 animate-spin" />}
            Desactivar
          </button>
        </div>
      </Dialog>

      {/* Z8 §21 — Ocultar confirmation, exact suggested copy. */}
      <Dialog
        open={confirmHideOpen}
        onOpenChange={setConfirmHideOpen}
        title="¿Ocultar paciente?"
        description="Este paciente dejará de aparecer en las vistas normales de CardioSense. Su información y su historial clínico se conservarán y podrás volver a mostrarlo desde Configuración."
        preventClose={statusBusy}
      >
        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={() => setConfirmHideOpen(false)}
            disabled={statusBusy}
            className="px-4 ui-compact-control-density text-sm font-medium rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            onClick={handleHide}
            disabled={statusBusy}
            className="flex items-center gap-2 px-4 ui-compact-control-density text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {statusBusy && <Loader2 className="w-4 h-4 animate-spin" />}
            Ocultar
          </button>
        </div>
      </Dialog>

      {/* NEW S2E-FIX2 — risk modal coordinator: ONE Dialog, content switches
          between the complete risk-evolution chart and the CURRENT projection
          detail (no stacked dialogs → one focus trap, Escape/overlay/X close
          the whole flow, focus returns to the opening button). Both views
          read the page's single shared forecast state — opening them never
          fetches CURRENT again. */}
      <Dialog
        open={riskModal !== null}
        onOpenChange={open => { if (!open) closeRiskModal() }}
        title={riskModal === 'projection' ? 'Proyección de riesgo cardiovascular' : 'Evolución del riesgo — historial completo'}
        size="wide"
        onCloseAutoFocus={restoreRiskModalFocus}
      >
        {riskModal === 'full' && (
          <div className="ui-content-stack" data-testid="full-risk-modal">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <p className="text-xs text-muted-foreground" data-testid="full-evolution-subtitle">
                {fullHistory.phase === 'ready'
                  ? `${fullModel.real.length} predicci${fullModel.real.length === 1 ? 'ón' : 'ones'} (historial completo) · por fecha clínica`
                  : 'Historial completo de predicciones · por fecha clínica'}
                {fullModel.projected.length > 0 &&
                  ` · Proyección: ${fullModel.projected.length} fecha${fullModel.projected.length === 1 ? '' : 's'} objetivo`}
              </p>
              {/* NEW S4 — upper-right action group: Ver proyección + Historial
                  (same destination/handler as the compact card's button; wraps
                  on narrow widths, never squeezes the subtitle). */}
              <div className="ml-auto flex items-center justify-end gap-2 flex-wrap" data-testid="full-risk-modal-actions">
                <button
                  type="button"
                  data-risk-modal-autofocus
                  onClick={() => openProjection('full')}
                  className="flex items-center gap-1.5 px-3 ui-compact-control-density rounded-lg text-xs font-medium border border-primary/40 text-primary hover:bg-primary/5 transition-colors"
                >
                  <Telescope className="w-3.5 h-3.5" aria-hidden="true" />
                  Ver proyección
                </button>
                <button
                  type="button"
                  onClick={openPredictionHistory}
                  data-testid="full-modal-open-prediction-history"
                  title="Historial de predicciones de este paciente"
                  className="inline-flex items-center gap-1.5 px-3 ui-compact-control-density rounded-lg text-xs font-medium border border-border text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <History className="w-3.5 h-3.5" aria-hidden="true" />
                  Historial
                </button>
              </div>
            </div>
            {fullHistory.phase === 'loading' || fullHistory.phase === 'idle' ? (
              <div className="flex items-center justify-center py-16" role="status">
                <Loader2 className="w-5 h-5 text-primary animate-spin" aria-hidden="true" />
                <span className="sr-only">Cargando historial completo…</span>
              </div>
            ) : fullHistory.phase === 'error' ? (
              <p className="text-sm text-red-600 dark:text-red-400 text-center py-8">{fullHistory.message}</p>
            ) : fullModel.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Aún no hay historial de predicciones para mostrar la evolución.</p>
            ) : (
              <>
                <RiskEvolutionChart
                  model={fullModel} selectedPredictionId={selectedPredictionId} textSizes={chartTextSizes} height={380}
                  variant="full" chartLabel="Evolución del riesgo — historial completo"
                  initialSelectedKey={selectedPredictionId ? `r:${selectedPredictionId}` : null}
                  renderPointDetail={renderFullPointDetail}
                />
              </>
            )}
          </div>
        )}
        {riskModal === 'projection' && (
          <div className="ui-content-stack" data-testid="projection-risk-modal">
            {projectionFrom === 'full' && (
              <button
                type="button"
                data-risk-modal-autofocus
                onClick={() => setRiskModal('full')}
                className="self-start flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <ArrowLeftCircle className="w-3.5 h-3.5" aria-hidden="true" />
                Volver a la gráfica completa
              </button>
            )}
            <RiskProjectionSection state={forecastState} embedded />
          </div>
        )}
      </Dialog>

      <NewRecordModal
        patientId={patient.id}
        birthDate={patient.birthDate}
        open={newRecordModalOpen}
        onOpenChange={setNewRecordModalOpen}
        onCreated={handleRecordCreated}
      />

      <EditPatientModal
        patient={patient}
        open={editPatientModalOpen}
        onOpenChange={setEditPatientModalOpen}
        onUpdated={handlePatientUpdated}
      />

      {/* U8.6C — model-ineligibility notice. Same visual pattern already
          used for Calendar deep-link feedback (red warning banner,
          AlertTriangle icon), but its own separate state — never clinical:
          no risk label, no Alert, no Risk Evolution point. Dismissible;
          not persisted, so dismissing it (or navigating away) loses it for
          good — consistent with U8.6-DEBT-1..3's documented limitation. */}
      {predictionUnavailableNotice && (
        <div className="flex items-start gap-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm text-red-800 dark:text-red-300">
            <p>
              El registro clínico se guardó correctamente, pero no fue posible generar una predicción:
              la edad de este registro está fuera del rango de soporte de {predictionUnavailableNotice.modelVersion}{' '}
              (rango soportado: {predictionUnavailableNotice.eligibleAgeRange.min}-{predictionUnavailableNotice.eligibleAgeRange.max} años).
            </p>
          </div>
          <button
            onClick={() => setPredictionUnavailableNotice(null)}
            className="p-1 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors flex-shrink-0"
            aria-label="Cerrar aviso"
          >
            <X className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 ui-major-grid-gap">

        {/* ── Left column ──────────────────────────────────────────── */}
        <div className="ui-content-stack">

          {/* Risk gauge — real predictions (predictionService.getHistory) */}
          <div className="bg-card rounded-xl border border-border ui-card-density">
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <Heart className="w-4 h-4 text-red-500 dark:text-red-400" />
              Riesgo cardiovascular
            </h3>
            {/* NEW S3-FIX2 — no dependency on the history request's loading
                / error state: the current card renders from the patient
                payload alone (the evolution chart reports its own errors). */}
            {!latestPrediction && patient.latestClinicalRecordId && currentTask?.status === 'MODEL_INELIGIBLE' ? (
              // NEW S4-FIX2 — TERMINAL: the age recorded for the latest record
              // is outside the model's supported range. Truthful, no spinner,
              // no "pending"/"retrying" wording, no retry button, never an
              // older record's risk.
              <div className="text-center py-6" data-testid="current-risk-model-ineligible" data-task-status="MODEL_INELIGIBLE">
                <p className="text-sm font-medium text-foreground">
                  Predicción no generada: la edad registrada está fuera del rango soportado por el modelo.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  El registro clínico se guardó correctamente.
                </p>
                {patient.latestClinicalAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Registro clínico · {formatClinicalDateTime(patient.latestClinicalAt)}
                  </p>
                )}
              </div>
            ) : !latestPrediction && patient.latestClinicalRecordId && currentTask ? (
              // NEW S4 — the exact latest record's automatic Prediction is a
              // durable pending obligation (backend task). Pending / retrying
              // wording only — never an older record's risk, no manual retry.
              <div className="text-center py-6" data-testid="current-risk-pending" data-task-status={currentTask.status}>
                <Loader2 className="w-5 h-5 text-primary animate-spin mx-auto mb-2" aria-hidden="true" />
                <p className="text-sm font-medium text-foreground">
                  {currentTask.status === 'RETRY_WAIT' ? 'Reintentando predicción automática' : 'Predicción automática pendiente'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {currentTask.status === 'RETRY_WAIT'
                    ? 'El registro clínico se guardó. El servicio de predicción no respondió; se reintentará automáticamente.'
                    : 'El registro clínico se guardó. La predicción se generará automáticamente.'}
                </p>
                {patient.latestClinicalAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Registro clínico · {formatClinicalDateTime(patient.latestClinicalAt)}
                  </p>
                )}
              </div>
            ) : !latestPrediction && patient.latestClinicalRecordId ? (
              // NEW S3-FIX1 — the exact latest clinical record has no
              // Prediction: neutral, never an older record's risk.
              <div className="text-center py-6" data-testid="current-risk-unavailable">
                <p className="text-sm text-muted-foreground">Riesgo actual no disponible para el registro clínico más reciente.</p>
                {patient.latestClinicalAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Registro clínico · {formatClinicalDateTime(patient.latestClinicalAt)}
                  </p>
                )}
              </div>
            ) : !latestPrediction ? (
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground">Sin predicciones aún</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Este paciente no tiene predicciones registradas todavía.
                </p>
              </div>
            ) : (
              <>
                <div className="flex justify-center">
                  <RiskGauge
                    score={latestPrediction.riskScore}
                    level={latestPrediction.riskLevel}
                    size={180}
                    showLabel
                  />
                </div>
                {latestPrediction.isAnomaly && (
                  <div className="mt-3 flex items-center gap-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                    <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">
                      Anomalía detectada en indicadores
                    </p>
                  </div>
                )}
                <div className="mt-4 pt-4 border-t border-border text-center">
                  <p className="text-xs text-muted-foreground" data-testid="current-risk-clinical">
                    {currentRecordTime ? `Registro clínico · ${clinicalTimeLabel(currentRecordTime)}` : '—'}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Calculada {timeAgo(latestPrediction.predictedAt)}</p>
                  {latestPrediction.modelVersion && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Modelo {latestPrediction.modelVersion}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Patient info */}
          <div className="bg-card rounded-xl border border-border ui-card-density">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground" />
                Información personal
              </h3>
              {patient.isActive && (
                <button
                  type="button"
                  onClick={() => setEditPatientModalOpen(true)}
                  aria-label="Editar información personal"
                  title="Editar información personal"
                  className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors flex-shrink-0"
                >
                  <Edit className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div>
              {patient.curp && (
                <InfoRow label="CURP" value={patient.curp} />
              )}
              <InfoRow label="Fecha de nacimiento" value={formatDate(patient.birthDate)} />
              <InfoRow label="Edad" value={age} unit="años" />
              <InfoRow label="Sexo" value={sexLabel(patient.sex)} />
              {/* PRE-R2B §7/§8 — email now interactive, matching the exact
                  visual language the phone block immediately below already
                  uses (same row shell, same label treatment, same
                  text-sm font-semibold text-primary + icon link style) —
                  a plain semantic <a href="mailto:...">, no custom JS,
                  since a native anchor already gets click AND keyboard
                  (Enter) activation for free. Missing email (patient.email
                  falsy) renders nothing at all — the exact same neutral,
                  non-clickable omission this row already used before, and
                  the same convention CURP/phone already follow just below. */}
              {patient.email && (
                <div className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
                  <span className="text-sm text-muted-foreground">Email</span>
                  <a
                    href={`mailto:${patient.email}`}
                    className="text-sm font-semibold text-primary flex items-center gap-1"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    {patient.email}
                  </a>
                </div>
              )}
              {patient.phone && (() => {
                const { text, telHref } = getPhoneDisplay(patient.phone)
                return (
                  <div className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
                    <span className="text-sm text-muted-foreground">Teléfono</span>
                    {telHref ? (
                      <a href={telHref} className="text-sm font-semibold text-primary flex items-center gap-1">
                        <Phone className="w-3.5 h-3.5" />
                        {text}
                      </a>
                    ) : (
                      <span className="text-sm font-semibold text-foreground flex items-center gap-1">
                        <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                        {text}
                      </span>
                    )}
                  </div>
                )
              })()}
              <InfoRow label="Registrado" value={formatRelativeBusinessDate(patient.createdAt).label} />
            </div>
          </div>

          {/* Patient Calendar (P3-FIX) — left column, right below
              Información personal. Z8-FIX3 had moved this into the right
              column (to force a single global linear order with Historial/
              Lifecycle) without product authorization; Z8-FIX4 restores it
              to this exact pre-FIX3 structural position. Same component/
              props/logic as P3/P4 (no realtime — P5's responsibility;
              cross-navigation into Clinical History/Risk Evolution below;
              RISK_CHANGE handling) — untouched, only its location moved
              back. */}
          <PatientCalendar
            patientId={patient.id}
            onSelectHealthRecord={handleSelectHealthRecord}
            onSelectPrediction={handleSelectPrediction}
            onSelectionClear={handleClearTimelineSelection}
            feedback={timelineFeedback}
            navigationTarget={dashboardNav ? { eventId: dashboardNav.calendarEventId, eventDate: dashboardNav.eventDate } : null}
          />
        </div>

        {/* ── Right columns ─────────────────────────────────────────── */}
        <div className="lg:col-span-2 ui-content-stack">

          {/* Risk trend chart — real predictions (predictionService.getHistory),
              chronological (oldest→newest; backend returns newest-first) */}
          <div ref={riskEvolutionRef} className="bg-card rounded-xl border border-border ui-card-density">
            {/* NEW S3 — header: title/subtitle on the left; the action group
                (Ver proyección · Historial · expand) on the right. On narrow widths
                the group wraps below the title and stays right-aligned (the title is
                never squeezed). */}
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div className="flex-1 min-w-[12rem]">
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  <Activity className="w-4 h-4 text-muted-foreground" />
                  Evolución del riesgo
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5" data-testid="compact-evolution-subtitle">
                  {/* NEW S2E-FIX2 — compact window (latest ≤10 REAL Predictions)
                      on the clinical time axis; projected targets are counted
                      separately and never called Predictions. */}
                  {evolutionModel.real.length > 0
                    ? `Última${evolutionModel.real.length === 1 ? '' : 's'} ${evolutionModel.real.length} predicci${evolutionModel.real.length === 1 ? 'ón' : 'ones'} · por fecha clínica`
                    : 'Score cardiovascular · por fecha clínica'}
                  {evolutionModel.projected.length > 0 &&
                    ` · Proyección: ${evolutionModel.projected.length} fecha${evolutionModel.projected.length === 1 ? '' : 's'} objetivo`}
                </p>
              </div>
              {/* NEW S3 — right-side action area: "Ver proyección" (moved to
                  the right), "Historial" (THIS patient's Prediction history —
                  read-only, no creation control), then the icon-only full
                  chart button (unchanged, still last). */}
              <div className="ml-auto flex items-center justify-end gap-2 flex-wrap flex-shrink-0" data-testid="risk-evolution-actions">
                <button
                  type="button"
                  onClick={e => openProjection('page', e.currentTarget)}
                  data-testid="open-projection"
                  className="inline-flex items-center gap-1.5 px-3 ui-compact-control-density rounded-lg text-xs font-medium border border-primary/40 text-primary hover:bg-primary/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Telescope className="w-3.5 h-3.5" aria-hidden="true" />
                  Ver proyección
                </button>
                <button
                  type="button"
                  onClick={openPredictionHistory}
                  data-testid="open-prediction-history"
                  title="Historial de predicciones de este paciente"
                  className="inline-flex items-center gap-1.5 px-3 ui-compact-control-density rounded-lg text-xs font-medium border border-border text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <History className="w-3.5 h-3.5" aria-hidden="true" />
                  Historial
                </button>
                <button
                  type="button"
                  onClick={e => openFullChart(e.currentTarget)}
                  aria-label="Ver gráfica completa"
                  title="Ver gráfica completa"
                  data-testid="open-full-chart"
                  className="flex-shrink-0 p-2 rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                >
                  <Maximize2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            {predictionsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-primary animate-spin" />
              </div>
            ) : predictionsError ? (
              // NEW S3-FIX2 — the history error belongs to the chart only;
              // the current-risk card is unaffected.
              <p className="text-sm text-red-600 dark:text-red-400 text-center py-4" data-testid="evolution-history-error">{predictionsError}</p>
            ) : evolutionModel.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Aún no hay historial de predicciones para mostrar la evolución.
              </p>
            ) : (
              // NEW S2E-FIX1 — clinical-time chart composing two SEPARATE
              // series: REAL (solid, from `predictions` + their source
              // HealthRecord clinical time) and CURRENT projection (dashed,
              // from the shared forecast state). `predictions` is read only;
              // forecast points never enter it.
              <RiskEvolutionChart model={evolutionModel} selectedPredictionId={selectedPredictionId} textSizes={chartTextSizes} variant="compact" chartLabel="Evolución del riesgo" />
            )}
          </div>

          {/* NEW S2E-FIX2 — the projection detail is no longer a permanent
              block here: it lives in the risk modal (below), opened from the
              compact chart or from the full chart. CURRENT projected points
              stay visible in "Evolución del riesgo". */}

          {/* Clinical indicators — from the most recent real Health Record (INT-08/INT-10) */}
          <div className="bg-card rounded-xl border border-border ui-card-density">
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-muted-foreground" />
              Indicadores clínicos
            </h3>

            {latestRecordLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-primary animate-spin" />
              </div>
            ) : !latestRecord ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Este paciente aún no tiene registros clínicos.
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-3">
                  {/* NEW S2E — clinical (measured) time; legacy rows labelled as entry time. */}
                  Último registro · {clinicalTimeLabel(latestRecord)}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Presión sistólica',  value: latestRecord.sysBP,     unit: 'mmHg', high: latestRecord.sysBP > 140 },
                    { label: 'Presión diastólica', value: latestRecord.diaBP,     unit: 'mmHg', high: latestRecord.diaBP > 90 },
                    { label: 'Colesterol total',   value: latestRecord.totChol,   unit: 'mg/dL', high: latestRecord.totChol > 240 },
                    { label: 'Glucosa',            value: latestRecord.glucose,   unit: 'mg/dL', high: latestRecord.glucose > 126 },
                    { label: 'IMC',                value: latestRecord.bmi,       unit: 'kg/m²', high: latestRecord.bmi > 30 },
                    { label: 'Frec. cardíaca',     value: latestRecord.heartRate, unit: 'bpm',   high: latestRecord.heartRate > 100 },
                  ].map(item => (
                    <div key={item.label} className={cn(
                      'bg-card rounded-xl border p-4',
                      item.high ? 'border-red-200 dark:border-red-800/60 bg-red-50/50 dark:bg-red-950/40' : 'border-border',
                    )}>
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                      <p className={cn('text-2xl font-bold font-mono mt-1', item.high ? 'text-red-600 dark:text-red-400' : 'text-foreground')}>
                        {item.value}
                      </p>
                      <p className="text-xs text-muted-foreground">{item.unit}</p>
                      {item.high && (
                        <p className="text-[10px] text-red-600 dark:text-red-400 font-medium mt-1 flex items-center gap-1">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          Fuera de rango
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* New health record form (INT-09) */}
          </div>

          {/* Clinical history (INT-08) — past records from GET /:id/history.
              W3 — the card itself is now ALWAYS rendered (the previous
              `historyTotal > 1` gate hid the entire card — including its
              loading/error states — whenever a patient had 0 or exactly 1
              record, which was the defect W1 identified). Precedence inside
              the card body is now: loading → error → empty → records,
              evaluated once at the body level instead of only inside the
              table's <tbody> — this is what makes the loading/error states
              reachable again at 0/1 records, not just at >1. The table,
              pagination controls, sorting, and W7 relative-date formatting
              below are byte-for-byte the same JSX as before W3 (only their
              container changed, from "always-mounted table with conditional
              rows" to "one of four mutually exclusive body states"); no
              backend/API/pagination/sorting contract changed. */}
          <div className="bg-card rounded-xl border border-border ui-card-density">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                Historial de registros clínicos
              </h3>
              <span className="text-xs text-muted-foreground">{historyTotal} registro{historyTotal === 1 ? '' : 's'}</span>
            </div>

            {recordsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-primary animate-spin" />
              </div>
            ) : recordsError ? (
              <p className="text-sm text-red-600 dark:text-red-400 text-center py-4">{recordsError}</p>
            ) : historyTotal === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground">No hay registros clínicos todavía.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Los registros clínicos que agregues para este paciente aparecerán aquí.
                </p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground uppercase tracking-wide border-b border-border">
                        {([
                          ['clinicalTime', 'Fecha clínica'],
                          ['sysBP', 'Sistólica'],
                          ['diaBP', 'Diastólica'],
                          ['totChol', 'Colesterol'],
                          ['glucose', 'Glucosa'],
                          ['bmi', 'IMC'],
                        ] as [HistorySortBy, string][]).map(([field, label]) => (
                          <th key={field} className="ui-clinical-row pr-4">
                            <button
                              type="button"
                              onClick={() => handleSortClick(field)}
                              className="flex items-center gap-1 hover:text-foreground transition-colors"
                            >
                              {label}
                              {historySortBy === field && (
                                <span>{historySortOrder === 'asc' ? '▲' : '▼'}</span>
                              )}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {records.map(r => (
                        <tr
                          key={r.id}
                          ref={el => {
                            if (el) recordRowRefs.current.set(r.id, el)
                            else recordRowRefs.current.delete(r.id)
                          }}
                          className={cn(
                            'border-b border-border last:border-0 transition-colors',
                            r.id === selectedHealthRecordId && 'bg-primary/10 ring-1 ring-inset ring-primary',
                          )}
                        >
                          {/* NEW S2E — measured time; a legacy row shows its entry time
                              explicitly tagged "Captura" (no measurement time known). */}
                          <td className="ui-clinical-row pr-4 text-muted-foreground">
                            {(() => {
                              const t = recordClinicalTime(r)
                              return (
                                <>
                                  {formatClinicalDateTime(t.instant)}
                                  {t.source === 'LEGACY_ENTRY' && (
                                    <span
                                      className="ml-1.5 inline-block text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted text-muted-foreground"
                                      title={`Fecha de captura — ${LEGACY_TIME_NOTE}`}
                                    >
                                      Captura
                                    </span>
                                  )}
                                </>
                              )
                            })()}
                          </td>
                          <td className="ui-clinical-row pr-4">{r.sysBP}</td>
                          <td className="ui-clinical-row pr-4">{r.diaBP}</td>
                          <td className="ui-clinical-row pr-4">{r.totChol}</td>
                          <td className="ui-clinical-row pr-4">{r.glucose}</td>
                          <td className="ui-clinical-row">{r.bmi}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* U5.2 — pagination controls */}
                <div className="flex items-center justify-between flex-wrap gap-3 mt-4 pt-3 border-t border-border">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Mostrar</span>
                    <select
                      value={historyLimit}
                      onChange={e => handleLimitChange(Number(e.target.value))}
                      className="border border-border rounded-md px-2 py-1 bg-card cursor-pointer"
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                    </select>
                    <span>por página</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-muted-foreground">
                      Página {Math.min(historyPage, Math.max(historyTotalPages, 1))} de {Math.max(historyTotalPages, 1)}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                        disabled={historyPage <= 1}
                        className="px-2.5 py-1 rounded-md border border-border hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Anterior
                      </button>
                      <button
                        type="button"
                        onClick={() => setHistoryPage(p => Math.min(historyTotalPages, p + 1))}
                        disabled={historyPage >= historyTotalPages}
                        className="px-2.5 py-1 rounded-md border border-border hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Siguiente
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Z8-FIX4 §1/§4 — dedicated lifecycle/visibility management
              section. MUST sit immediately after Historial de registros
              clínicos (the card right above), in THIS right column's own
              JSX flow (not a CSS re-ordering), so that relationship holds
              at every breakpoint, including the single-column mobile
              stack. This placement is unchanged from Z8-FIX3 and is the
              one part of that fix the product confirmed as correct.
              PatientCalendar/"Actividad cardiovascular" is NOT required to
              be adjacent to this section — Z8-FIX3 had also relocated it
              into this column to force a single global linear order
              (Historial → Lifecycle → Calendar) that was never actually
              authorized; Z8-FIX4 restored PatientCalendar to its original,
              independent left-column position (see above) and this
              section no longer references or depends on where the
              calendar lives.
              Always rendered for every patient this page can be reached
              for — ACTIVE or INACTIVE_VISIBLE; an INACTIVE_HIDDEN patient
              never reaches this far (the fetch above 404s first, §15 of
              Z8-FIX2), so no "Mostrar" control is needed or rendered here
              — that action stays exclusively in Configuración → Pacientes.
              Reuses the EXACT SAME handlers/dialogs as the top-right quick
              actions above — handleDeactivate/handleReactivate/handleHide,
              confirmDeactivateOpen/confirmHideOpen, statusBusy — unchanged
              from Z8-FIX2, no new mutation path, no duplicated business
              logic. statusBusy is shared with the top-right buttons, so a
              click from either entry point disables both while the
              request is in flight. The INACTIVE_VISIBLE overlap with the
              top-right Reactivar/Ocultar remains intentional (Z8-FIX2
              §11) — fast actions up top, a persistent management area
              with explanatory context here. */}
          <div className="bg-card rounded-xl border border-border ui-card-density">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              {patient.isActive
                ? <Activity className="w-4 h-4 text-muted-foreground" />
                : <PowerOff className="w-4 h-4 text-muted-foreground" />}
              Estado y visibilidad del paciente
            </h3>

            <div className="flex items-center gap-2 mt-3 mb-4">
              <span className="text-sm text-muted-foreground">Estado:</span>
              <span className={cn(
                'inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium',
                patient.isActive
                  ? 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800/60'
                  : 'bg-muted text-muted-foreground border border-border',
              )}>
                <span className={cn('w-1.5 h-1.5 rounded-full', patient.isActive ? 'bg-teal-500' : 'bg-muted-foreground/50')} />
                {patient.isActive ? 'Activo' : 'Inactivo'}
              </span>
            </div>

            {patient.isActive ? (
              <>
                <p className="text-sm text-muted-foreground mb-4">
                  Al desactivar a este paciente, su información y su historial clínico se conservarán sin cambios,
                  pero no podrá recibir nuevos registros clínicos ni predicciones mientras esté inactivo. Podrás
                  reactivarlo en cualquier momento.
                </p>
                <button
                  onClick={() => setConfirmDeactivateOpen(true)}
                  disabled={statusBusy}
                  className="flex items-center gap-2 px-4 ui-compact-control-density rounded-lg text-sm font-medium border border-red-700 dark:border-red-800/60 text-red-700 dark:text-red-300 bg-red-50 hover:bg-red-100 dark:bg-red-950/15 dark:hover:bg-red-950/60 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <PowerOff className="w-4 h-4 text-muted-foreground text-red-700 dark:text-red-300" />
                  Desactivar
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground mb-4">
                  Este paciente está inactivo: su información y su historial clínico se conservan, pero no puede
                  recibir nueva actividad clínica. Reactívalo para que vuelva a estar disponible, u ocúltalo para
                  retirarlo de las vistas normales de CardioSense. Podrás volver a mostrarlo desde
                  Configuración → Pacientes.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleReactivate}
                    disabled={statusBusy}
                    className="flex items-center gap-2 px-4 ui-compact-control-density rounded-lg text-sm font-medium border border-teal-700 dark:border-teal-800/60 text-teal-700 dark:text-teal-300 bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/15 dark:hover:bg-teal-950/60 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <RotateCcw className="w-4 h-4 text-muted-foreground text-teal-700 dark:text-teal-300" />
                    Reactivar
                  </button>
                  <button
                    onClick={() => setConfirmHideOpen(true)}
                    disabled={statusBusy}
                    className="flex items-center gap-2 px-4 ui-compact-control-density rounded-lg text-sm font-medium border border-amber-700 dark:border-amber-800/60 text-amber-700 dark:text-amber-300 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/15 dark:hover:bg-amber-950/60 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <EyeOff className="w-4 h-4 text-muted-foreground text-amber-700 dark:text-amber-300" />
                    Ocultar
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Feature importance — real data only; the backend does not
              persist featureImportance on historical predictions (only the
              immediate POST /predictions response has it, per
              predictionService.ts), so this stays hidden until that changes
              upstream — never fabricated here. */}
          {latestPrediction?.featureImportance && (
            <div className="bg-card rounded-xl border border-border ui-card-density">
              <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                Factores de mayor impacto en la predicción
              </h3>
              <FeatureImportanceBar data={latestPrediction.featureImportance} maxItems={6} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
