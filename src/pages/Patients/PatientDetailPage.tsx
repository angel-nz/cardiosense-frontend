import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import {
  ArrowLeft, Activity, Heart, Phone, Calendar,
  User, FileText, AlertTriangle, Plus, Edit, Loader2, X,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { isAxiosError } from 'axios'
import { RiskBadge } from '@/components/ui/RiskBadge'
import { RiskGauge } from '@/components/charts/RiskGauge'
import { FeatureImportanceBar } from '@/components/charts/FeatureImportanceBar'
import { PatientCalendar } from '@/components/patients/PatientCalendar'
import { NewRecordModal } from '@/components/patients/NewRecordModal'
import { EditPatientModal } from '@/components/patients/EditPatientModal'
import { cn, formatDate, formatRelativeBusinessDate, formatRelativeBusinessDateTime, calcAge, sexLabel, timeAgo } from '@/lib/utils'
import { getPhoneDisplay } from '@/lib/phone'
import { patientService } from '@/services/patientService'
import { predictionService } from '@/services/predictionService'
import { useSocket } from '@/context/SocketContext'
import type { Patient, HealthRecord, Prediction, DashboardEventNavigationState, HistorySortBy, HistorySortOrder } from '@/types'
import { recordService } from '@/services/recordService'

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
      <span className={cn('text-sm font-semibold', highlight ? 'text-red-600' : 'text-foreground')}>
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
          lastPredictionUnavailable, clearLastPredictionUnavailable } = useSocket()

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

  const [records, setRecords] = useState<HealthRecord[]>([])
  const [recordsLoading, setRecordsLoading] = useState(true)
  const [recordsError, setRecordsError] = useState<string | null>(null)

  // U5.2 — server-side pagination/sorting state for Clinical History.
  // `records` above now holds only the CURRENT page's rows.
  const [historyPage, setHistoryPage] = useState(1)
  const [historyLimit, setHistoryLimit] = useState(10)
  const [historySortBy, setHistorySortBy] = useState<HistorySortBy>('recordedAt')
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
      const result = await predictionService.getHistory(id, { limit: 24, targetId: predictionId })
      if (!result.targetResolved) {
        setTimelineFeedback('Esta predicción no está disponible en el historial de este paciente.')
        return
      }
      setPredictions(result.data)
      setTimelineFeedback(null)
      setSelectedHealthRecordId(null)
      setSelectedPredictionId(predictionId)
      requestAnimationFrame(() => {
        riskEvolutionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    } catch {
      setTimelineFeedback('Esta predicción no está disponible en el historial de este paciente.')
    }
  }, [predictions, id])

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
      if (requestId === patientRequestIdRef.current && !silent) setPatientLoading(false)
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
      if (requestId === historyRequestIdRef.current && !silent) setRecordsLoading(false)
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
      const latest = await recordService.getLatest(id)
      if (requestId !== latestRecordRequestIdRef.current) return
      setLatestRecord(latest)
    } catch {
      // Silent failure keeps whatever was last shown — same pattern used
      // elsewhere for background/realtime-triggered loaders in this file.
    } finally {
      if (requestId === latestRecordRequestIdRef.current && !silent) setLatestRecordLoading(false)
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
  const loadPredictions = useCallback(async (silent = false) => {
    if (!id) return
    if (!silent) setPredictionsLoading(true)
    setPredictionsError(null)
    try {
      const result = await predictionService.getHistory(id, { limit: 24 })
      setPredictions(result.data)
    } catch {
      if (!silent) setPredictionsError('No se pudo cargar el historial de predicciones')
    } finally {
      if (!silent) setPredictionsLoading(false)
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
    clearLastPrediction()
  }, [id, lastPrediction, loadPatient, loadPredictions, clearLastPrediction])

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
    }, 400)
  }, [loadHistory, loadLatestRecord])

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
          className="mt-4 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
        >
          Volver a pacientes
        </button>
      </div>
    )
  }

  const latestPrediction = predictions[0]
  const age = calcAge(patient.birthDate)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
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
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            {age} años · {sexLabel(patient.sex)} · Última actualización {timeAgo(patient.updatedAt)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
          {/* U3.2 — action order: Nuevo registro, Nueva predicción, Editar
              información (repositioned only — its inline-edit behavior is
              unchanged; U4 will replace it with the full personal-info
              modal). flex-wrap keeps this from overflowing horizontally on
              narrow viewports. */}
          <button
            onClick={() => setNewRecordModalOpen(true)}
            className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Nuevo registro
          </button>
          <button
            onClick={() => navigate(`/predictions/${patient.id}`)}
            className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Activity className="w-4 h-4" />
            Nueva predicción
          </button>
          <button
            onClick={() => setEditPatientModalOpen(true)}
            className="p-2 rounded-lg border border-border hover:bg-accent transition-colors"
          >
            <Edit className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </div>

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
          used for Calendar deep-link feedback (amber warning banner,
          AlertTriangle icon), but its own separate state — never clinical:
          no risk label, no Alert, no Risk Evolution point. Dismissible;
          not persisted, so dismissing it (or navigating away) loses it for
          good — consistent with U8.6-DEBT-1..3's documented limitation. */}
      {predictionUnavailableNotice && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm text-amber-800">
            <p>
              El registro clínico se guardó correctamente, pero no fue posible generar una predicción:
              la edad de este registro está fuera del rango de soporte de {predictionUnavailableNotice.modelVersion}{' '}
              (rango soportado: {predictionUnavailableNotice.eligibleAgeRange.min}-{predictionUnavailableNotice.eligibleAgeRange.max} años).
            </p>
          </div>
          <button
            onClick={() => setPredictionUnavailableNotice(null)}
            className="p-1 rounded-lg hover:bg-amber-100 transition-colors flex-shrink-0"
            aria-label="Cerrar aviso"
          >
            <X className="w-3.5 h-3.5 text-amber-600" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* ── Left column ──────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Risk gauge — real predictions (predictionService.getHistory) */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <Heart className="w-4 h-4 text-red-500" />
              Riesgo cardiovascular
            </h3>
            {predictionsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-primary animate-spin" />
              </div>
            ) : predictionsError ? (
              <p className="text-sm text-red-600 text-center py-4">{predictionsError}</p>
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
                  <div className="mt-3 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                    <p className="text-xs text-amber-700 font-medium">
                      Anomalía detectada en indicadores
                    </p>
                  </div>
                )}
                <div className="mt-4 pt-4 border-t border-border text-center">
                  <p className="text-xs text-muted-foreground">
                    Última predicción {timeAgo(latestPrediction.predictedAt)}
                  </p>
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
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground" />
                Información personal
              </h3>
              {/* W6 — second entry point into the SAME edit workflow as the
                  action-bar's "Editar información" button above (identical
                  onClick: setEditPatientModalOpen(true), the one and only
                  EditPatientModal-open state — no new state, no new handler,
                  no second modal instance). Visually secondary (smaller,
                  borderless, muted) so it doesn't compete with the action
                  bar's control; icon-only with an aria-label/title so it
                  stays a fixed-size, usable hit target at narrow widths
                  without ever wrapping the header. */}
              <button
                type="button"
                onClick={() => setEditPatientModalOpen(true)}
                aria-label="Editar información personal"
                title="Editar información personal"
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors flex-shrink-0"
              >
                <Edit className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* U4.2A — editing now happens exclusively via EditPatientModal
                (opened from the header action bar) — the old inline
                editing branch (editing/editForm/editSaving/editError/
                saveEdit) was removed entirely, not just hidden. This is
                always the read-only display. */}
            <div>
              {patient.curp && (
                <InfoRow label="CURP" value={patient.curp} />
              )}
              <InfoRow label="Fecha de nacimiento" value={formatDate(patient.birthDate)} />
              <InfoRow label="Edad" value={age} unit="años" />
              <InfoRow label="Sexo" value={sexLabel(patient.sex)} />
              {patient.phone && (() => {
                // V6.5 — display is intentionally more permissive than the
                // write contract (§5): a parseable value (canonical OR
                // legacy-but-safely-parseable) gets human-readable
                // formatting AND a real tel: link; an ambiguous/unparseable
                // legacy value is shown verbatim as plain, non-actionable
                // text — never given a fabricated tel: target (§3/§8). No
                // parsing logic here — getPhoneDisplay (lib/phone.ts,
                // reused from V6.2) is the single source of that decision.
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
              {/* W7 — "Registrado" is a date-only label/value row (no "el"/
                  "del" preposition to get wrong), so the relative result's
                  `label` alone ("Hoy"/"Ayer"/absolute) is exactly what this
                  row already displayed before W7. birthDate above and the
                  Risk Evolution X-axis below intentionally stay absolute
                  (§4 — date of birth, chart axis). */}
              <InfoRow label="Registrado" value={formatRelativeBusinessDate(patient.createdAt).label} />
            </div>
          </div>

          {/* Patient Calendar (P3-FIX) — moved into the left column, right
              below Información personal, instead of the previous
              full-width section after the whole grid. Same component/logic
              as P3 (no realtime — P5's responsibility), now with P4's
              cross-navigation into Clinical History/Risk Evolution below. */}
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
        <div className="lg:col-span-2 space-y-4">

          {/* Risk trend chart — real predictions (predictionService.getHistory),
              chronological (oldest→newest; backend returns newest-first) */}
          <div ref={riskEvolutionRef} className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-foreground">Evolución del riesgo</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {predictions.length > 0
                    ? `Última${predictions.length === 1 ? '' : 's'} ${predictions.length} predicci${predictions.length === 1 ? 'ón' : 'ones'}`
                    : 'Score cardiovascular'}
                </p>
              </div>
            </div>
            {predictionsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-primary animate-spin" />
              </div>
            ) : predictions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Aún no hay historial de predicciones para mostrar la evolución.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={[...predictions].reverse().map(p => ({
                  date: formatDate(p.predictedAt, 'dd MMM'),
                  score: p.riskScore,
                  predictionId: p.id,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                  <YAxis
                    domain={[0, 1]}
                    tickFormatter={v => `${(v * 100).toFixed(0)}%`}
                    tick={{ fontSize: 11, fill: '#9CA3AF' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip formatter={(v: number) => [`${(v * 100).toFixed(1)}%`, 'Riesgo']} />
                  <ReferenceLine y={0.65} stroke="#DC2626" strokeDasharray="4 4" label={{ value: 'Alto', fill: '#DC2626', fontSize: 10 }} />
                  <ReferenceLine y={0.35} stroke="#D97706" strokeDasharray="4 4" label={{ value: 'Moderado', fill: '#D97706', fontSize: 10 }} />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="#2563EB"
                    strokeWidth={2.5}
                    dot={(dotProps: { cx?: number; cy?: number; payload?: { predictionId: string } }) => {
                      const { cx, cy, payload } = dotProps
                      const isSelected = !!payload && payload.predictionId === selectedPredictionId
                      return (
                        <circle
                          key={payload?.predictionId ?? `${cx}-${cy}`}
                          cx={cx}
                          cy={cy}
                          r={isSelected ? 7 : 4}
                          fill={isSelected ? '#DC2626' : '#2563EB'}
                          stroke="#fff"
                          strokeWidth={isSelected ? 3 : 2}
                        />
                      )
                    }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Clinical indicators — from the most recent real Health Record (INT-08/INT-10) */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="font-semibold text-foreground mb-4">Indicadores clínicos</h3>

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
                  Último registro: {formatRelativeBusinessDateTime(latestRecord.recordedAt)}
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
                      item.high ? 'border-red-200 bg-red-50/50' : 'border-border',
                    )}>
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                      <p className={cn('text-2xl font-bold font-mono mt-1', item.high ? 'text-red-600' : 'text-foreground')}>
                        {item.value}
                      </p>
                      <p className="text-xs text-muted-foreground">{item.unit}</p>
                      {item.high && (
                        <p className="text-[10px] text-red-600 font-medium mt-1 flex items-center gap-1">
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
          <div className="bg-card rounded-xl border border-border p-5">
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
              <p className="text-sm text-red-600 text-center py-4">{recordsError}</p>
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
                          ['recordedAt', 'Fecha'],
                          ['sysBP', 'Sistólica'],
                          ['diaBP', 'Diastólica'],
                          ['totChol', 'Colesterol'],
                          ['glucose', 'Glucosa'],
                          ['bmi', 'IMC'],
                        ] as [HistorySortBy, string][]).map(([field, label]) => (
                          <th key={field} className="py-2 pr-4">
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
                          <td className="py-2 pr-4 text-muted-foreground">{formatRelativeBusinessDateTime(r.recordedAt)}</td>
                          <td className="py-2 pr-4">{r.sysBP}</td>
                          <td className="py-2 pr-4">{r.diaBP}</td>
                          <td className="py-2 pr-4">{r.totChol}</td>
                          <td className="py-2 pr-4">{r.glucose}</td>
                          <td className="py-2">{r.bmi}</td>
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

          {/* Feature importance — real data only; the backend does not
              persist featureImportance on historical predictions (only the
              immediate POST /predictions response has it, per
              predictionService.ts), so this stays hidden until that changes
              upstream — never fabricated here. */}
          {latestPrediction?.featureImportance && (
            <div className="bg-card rounded-xl border border-border p-5">
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
