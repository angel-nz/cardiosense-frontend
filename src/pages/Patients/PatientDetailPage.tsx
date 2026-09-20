import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import {
  ArrowLeft, Activity, Heart, Phone, Calendar,
  User, FileText, AlertTriangle, Plus, Edit, Loader2,
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
import { cn, formatDate, formatDateTime, calcAge, sexLabel, timeAgo } from '@/lib/utils'
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
          clearLastPrediction, clearLastHealthRecord, clearLastPatientUpdate } = useSocket()

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
  // U4-DEEPLINK — temporary: lets handleClearTimelineSelection's diagnostic
  // log read the current selection accurately, without adding either state
  // to its useCallback deps (deliberately `[]`/referentially stable — see
  // its own comment; adding deps there would be a functional change this
  // instrumentation-only block must not make). Kept in sync by the existing
  // RECORD_SELECTED_STATE/PREDICTION_SELECTED_STATE observation effects.
  const selectedHealthRecordIdRef = useRef<string | null>(null)
  const selectedPredictionIdRef = useRef<string | null>(null)
  // U4-DEEPLINK — temporary: holds the one-shot diagnostic timeout from
  // captureGeometry('RECORD_SCROLL_DELAYED') so it can be cleared on
  // unmount (see cleanup effect further below), never left dangling.
  const recordScrollDelayedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
  // U4-DEEPLINK — temporary: lets loadPatient's instrumentation read the
  // latest dashboardNav without adding it to loadPatient's own useCallback
  // deps (which would change its re-creation frequency — a functional
  // change this instrumentation-only block must not make). Kept in sync by
  // the DASHBOARD_NAV_READY observation effect below.
  const dashboardNavRef = useRef<DashboardEventNavigationState | null>(null)
  const navTargetAppliedRef = useRef(false)

  // U4-DEEPLINK — temporary: layout-phase transitions logged only for
  // completion (loading → not loading), so a scroll target that landed
  // correctly before one of these can be checked against whatever moved
  // afterward.
  useEffect(() => {
    if (patientLoading) return
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] LAYOUT_PHASE', { phase: 'patient-loaded', scrollY: window.scrollY, documentHeight: document.documentElement.scrollHeight })
  }, [patientLoading])

  useEffect(() => {
    if (recordsLoading) return
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] LAYOUT_PHASE', { phase: 'records-loaded', scrollY: window.scrollY, documentHeight: document.documentElement.scrollHeight })
  }, [recordsLoading])

  useEffect(() => {
    if (predictionsLoading) return
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] LAYOUT_PHASE', { phase: 'predictions-loaded', scrollY: window.scrollY, documentHeight: document.documentElement.scrollHeight })
  }, [predictionsLoading])

  // U4-DEEPLINK — temporary: clears the one-shot RECORD_SCROLL_DELAYED
  // diagnostic timeout if the component unmounts before it fires.
  useEffect(() => {
    return () => {
      if (recordScrollDelayedTimeoutRef.current) clearTimeout(recordScrollDelayedTimeoutRef.current)
    }
  }, [])

  // Patient switch (A→B): clear cross-navigation state — a highlighted
  // record/prediction from the previous patient must never survive.
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] RECORD_CLEAR', { reason: 'patient-switch', previousSelectedHealthRecordId: selectedHealthRecordId })
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] PREDICTION_CLEAR', { reason: 'patient-switch', previousSelectedPredictionId: selectedPredictionId })
    setSelectedHealthRecordId(null)
    setSelectedPredictionId(null)
    setTimelineFeedback(null)
    setDashboardNav(null)
    dashboardNavRef.current = null
    navTargetAppliedRef.current = false
  }, [id])

  // CLINICAL_RECORD click. `records` (loadHistory, GET /:id/history) is
  // unbounded — no page/limit — so in practice a Calendar clinical event
  // should always resolve here. Still checked explicitly rather than
  // assumed (section 24/25): a not-found record never highlights a
  // different, wrong row.
  const handleSelectHealthRecord = useCallback((healthRecordId: string) => {
    const matchingIndex = records.findIndex(r => r.id === healthRecordId)
    const exists = matchingIndex !== -1
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] RECORD_HANDLER_ENTER', {
      id: healthRecordId, recordsLength: records.length, found: exists, matchingIndex,
    })
    if (!exists) {
      // eslint-disable-next-line no-console
      console.log('[U4-DEEPLINK] RECORD_NOT_FOUND', { id: healthRecordId })
      setTimelineFeedback('Este registro no está incluido en el historial clínico actualmente visible.')
      return
    }
    setTimelineFeedback(null)
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] PREDICTION_CLEAR', { reason: 'record-select-exclusivity', healthRecordId })
    setSelectedPredictionId(null)
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] RECORD_SELECT_SET', { id: healthRecordId })
    setSelectedHealthRecordId(healthRecordId)
    const refFound = recordRowRefs.current.has(healthRecordId)
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] RECORD_REF_STATUS', { id: healthRecordId, refFound })

    // U4-DEEPLINK — temporary geometry probe, observation only (never
    // calls scrollIntoView again, never touches state). Captures the
    // target row's viewport position at 4 points in time to determine
    // whether a later layout shift moves it out of view after the
    // original scroll already completed.
    const captureGeometry = (tag: string) => {
      const el = recordRowRefs.current.get(healthRecordId)
      const rect = el?.getBoundingClientRect()
      const viewportHeight = window.innerHeight
      // eslint-disable-next-line no-console
      console.log(`[U4-DEEPLINK] ${tag}`, {
        id: healthRecordId,
        refFound: !!el,
        scrollY: window.scrollY,
        rectTop: rect?.top,
        rectBottom: rect?.bottom,
        viewportHeight,
        isInViewport: rect ? rect.bottom > 0 && rect.top < viewportHeight : null,
      })
    }
    captureGeometry('RECORD_SCROLL_BEFORE')
    requestAnimationFrame(() => {
      captureGeometry('RECORD_SCROLL_RAF1')
      requestAnimationFrame(() => captureGeometry('RECORD_SCROLL_RAF2'))
    })
    const delayedTimeout = setTimeout(() => captureGeometry('RECORD_SCROLL_DELAYED'), 400)
    recordScrollDelayedTimeoutRef.current = delayedTimeout

    const el = recordRowRefs.current.get(healthRecordId)
    if (el) {
      // eslint-disable-next-line no-console
      console.log('[U4-DEEPLINK] RECORD_HIGHLIGHT_DOM', {
        id: healthRecordId,
        hasExpectedHighlightClass: el.className.includes('ring-primary'),
        className: el.className,
      })
    }

    recordRowRefs.current.get(healthRecordId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [records])

  // PREDICTION / RISK_CHANGE click (RISK_CHANGE passes its
  // currentPredictionId here — same target, same mechanism, no duplicate
  // navigation flow). `predictions` (predictionService.getHistory) is
  // capped at the latest 20 — a Calendar month can legitimately reference
  // an older Prediction outside that window; that case is reported
  // honestly instead of guessing a nearby point.
  const handleSelectPrediction = useCallback((predictionId: string) => {
    const matchingIndex = predictions.findIndex(p => p.id === predictionId)
    const exists = matchingIndex !== -1
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] PREDICTION_HANDLER_ENTER', {
      id: predictionId, predictionsLength: predictions.length, found: exists, matchingIndex,
    })
    if (!exists) {
      // eslint-disable-next-line no-console
      console.log('[U4-DEEPLINK] PREDICTION_NOT_FOUND', { id: predictionId })
      setTimelineFeedback('Esta predicción no está incluida en la ventana actualmente visible del historial (últimas 20).')
      return
    }
    setTimelineFeedback(null)
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] RECORD_CLEAR', { reason: 'prediction-select-exclusivity', predictionId })
    setSelectedHealthRecordId(null)
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] PREDICTION_SELECT_SET', { id: predictionId })
    setSelectedPredictionId(predictionId)
    const riskEvolutionRefFound = riskEvolutionRef.current != null
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] PREDICTION_REF_STATUS', { id: predictionId, riskEvolutionRefFound })
    // U4-DEEPLINK — geometry probe before scroll, observation only.
    {
      const el = riskEvolutionRef.current
      const rect = el?.getBoundingClientRect()
      // eslint-disable-next-line no-console
      console.log('[U4-DEEPLINK] PREDICTION_SCROLL_BEFORE', {
        id: predictionId,
        refFound: !!el,
        scrollY: window.scrollY,
        rectTop: rect?.top,
        rectBottom: rect?.bottom,
      })
    }
    riskEvolutionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [predictions])

  // P4-FIX — called by PatientCalendar whenever its own temporal context
  // changes (day, month, "Hoy") in a way that invalidates whichever
  // external target a previous Calendar click had selected. Referentially
  // stable (useCallback, no deps) so it never causes PatientCalendar's
  // patient-switch effect to re-run for the wrong reason.
  const handleClearTimelineSelection = useCallback(() => {
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] CALENDAR_CLEAR_CALLBACK', {
      clearingSelectedHealthRecordId: selectedHealthRecordIdRef.current,
      clearingSelectedPredictionId: selectedPredictionIdRef.current,
    })
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] RECORD_CLEAR', { reason: 'calendar-context-change' })
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] PREDICTION_CLEAR', { reason: 'calendar-context-change' })
    setSelectedHealthRecordId(null)
    setSelectedPredictionId(null)
    setTimelineFeedback(null)
  }, [])

  // O3-FIX-4 — apply a Dashboard Calendar navigation target, if present,
  // reusing the exact same P4 selection handlers a PatientCalendar click
  // uses (same exact-ID matching, same exclusivity, same scroll/highlight,
  // same "not in currently visible window" feedback — no second
  // implementation). Waits for records/predictions to finish their own
  // fetch before attempting the match: matching against the still-empty
  // initial arrays would wrongly report a valid target as "not found"
  // before the real data ever had a chance to arrive (section 12).
  // Consumed at most once per patient visit (navTargetConsumedRef); the
  // history entry's own state is also cleared via `replace` so a later
  // refresh doesn't hand the same target back.
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
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] NAV_RECEIVED', {
      patientId: id,
      targetKind: nav.target.kind,
      targetId: nav.target.id,
      calendarEventId: nav.calendarEventId,
      eventDate: nav.eventDate,
    })
    setDashboardNav(nav)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.state, location.pathname, dashboardNav, navigate])

  // O3-FIX-4 — apply the EXTERNAL (History/Risk Evolution) side of a
  // Dashboard navigation target, reusing the exact same P4 selection
  // handlers a PatientCalendar click uses (same exact-ID matching, same
  // exclusivity, same scroll/highlight, same "not in currently visible
  // window" feedback — no second implementation). Waits for records/
  // predictions to finish their own fetch before attempting the match:
  // matching against the still-empty initial arrays would wrongly report a
  // valid target as "not found" before the real data ever had a chance to
  // arrive (section 12). Applied at most once per patient visit
  // (navTargetAppliedRef) — independent of whether/when PatientCalendar
  // itself finishes positioning on its own copy of `dashboardNav`.
  // U4-DEEPLINK — temporary observation-only effect (does not replace/alter
  // the existing dashboardNav lifecycle above); logs once whenever
  // dashboardNav transitions to non-null.
  useEffect(() => {
    if (!dashboardNav) return
    dashboardNavRef.current = dashboardNav
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] DASHBOARD_NAV_READY', {
      targetKind: dashboardNav.target.kind,
      targetId: dashboardNav.target.id,
      calendarEventId: dashboardNav.calendarEventId,
      eventDate: dashboardNav.eventDate,
      navTargetAppliedRefCurrent: navTargetAppliedRef.current,
    })
  }, [dashboardNav])

  // O3-FIX-4 — apply the EXTERNAL (History/Risk Evolution) side of a
  // Dashboard navigation target, reusing the exact same P4 selection
  // handlers a PatientCalendar click uses (same exact-ID matching, same
  // exclusivity, same scroll/highlight, same "not in currently visible
  // window" feedback — no second implementation). Waits for records/
  // predictions to finish their own fetch before attempting the match:
  // matching against the still-empty initial arrays would wrongly report a
  // valid target as "not found" before the real data ever had a chance to
  // arrive (section 12). Applied at most once per patient visit
  // (navTargetAppliedRef) — independent of whether/when PatientCalendar
  // itself finishes positioning on its own copy of `dashboardNav`.
  useEffect(() => {
    if (!dashboardNav) return
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] APPLY_EFFECT', {
      targetKind: dashboardNav.target.kind,
      targetId: dashboardNav.target.id,
      recordsLoading,
      predictionsLoading,
      recordsLength: records.length,
      predictionsLength: predictions.length,
      navTargetAppliedRefCurrent: navTargetAppliedRef.current,
    })
    if (navTargetAppliedRef.current) {
      // eslint-disable-next-line no-console
      console.log('[U4-DEEPLINK] APPLY_SKIP_ALREADY_APPLIED')
      return
    }
    if (recordsLoading) {
      // eslint-disable-next-line no-console
      console.log('[U4-DEEPLINK] APPLY_SKIP_RECORDS_LOADING')
      return
    }
    if (predictionsLoading) {
      // eslint-disable-next-line no-console
      console.log('[U4-DEEPLINK] APPLY_SKIP_PREDICTIONS_LOADING')
      return
    }
    const isHealthRecord = dashboardNav.target.kind === 'HEALTH_RECORD'
    const collectionContainsTarget = isHealthRecord
      ? records.some(r => r.id === dashboardNav.target.id)
      : predictions.some(p => p.id === dashboardNav.target.id)
    const matchingIndex = isHealthRecord
      ? records.findIndex(r => r.id === dashboardNav.target.id)
      : predictions.findIndex(p => p.id === dashboardNav.target.id)
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] MARK_APPLIED', {
      targetKind: dashboardNav.target.kind,
      targetId: dashboardNav.target.id,
      targetFoundInCollection: collectionContainsTarget,
    })
    navTargetAppliedRef.current = true
    if (isHealthRecord) {
      // eslint-disable-next-line no-console
      console.log('[U4-DEEPLINK] DISPATCH_RECORD_TARGET', {
        targetId: dashboardNav.target.id, collectionContainsTarget, matchingIndex,
      })
      handleSelectHealthRecord(dashboardNav.target.id)
    } else {
      // eslint-disable-next-line no-console
      console.log('[U4-DEEPLINK] DISPATCH_PREDICTION_TARGET', {
        targetId: dashboardNav.target.id, collectionContainsTarget, matchingIndex,
      })
      handleSelectPrediction(dashboardNav.target.id)
    }
  }, [dashboardNav, recordsLoading, predictionsLoading, handleSelectHealthRecord, handleSelectPrediction])

  // Edit patient
  // U4-DEEPLINK — temporary, read-only observation effects (no control-flow
  // changes anywhere else). Log whenever the selection state actually
  // commits, and whether the DOM/collection can actually support the
  // highlight at that moment.
  useEffect(() => {
    selectedHealthRecordIdRef.current = selectedHealthRecordId
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] RECORD_SELECTED_STATE', { selectedHealthRecordId })
  }, [selectedHealthRecordId])

  useEffect(() => {
    if (!selectedHealthRecordId) return
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] RECORD_RENDER_STATUS', {
      selectedHealthRecordId,
      recordExistsInCollection: records.some(r => r.id === selectedHealthRecordId),
      clinicalHistorySectionRendered: historyTotal > 1,
      refFound: recordRowRefs.current.has(selectedHealthRecordId),
    })
  }, [selectedHealthRecordId, records])

  useEffect(() => {
    selectedPredictionIdRef.current = selectedPredictionId
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] PREDICTION_SELECTED_STATE', { selectedPredictionId })
  }, [selectedPredictionId])

  useEffect(() => {
    if (!selectedPredictionId) return
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] PREDICTION_RENDER_STATUS', {
      selectedPredictionId,
      predictionExistsInCollection: predictions.some(p => p.id === selectedPredictionId),
      riskEvolutionRefFound: riskEvolutionRef.current != null,
      chartDataContainsPrediction: predictions.some(p => p.id === selectedPredictionId),
    })
    // eslint-disable-next-line no-console
    console.log('[U4-DEEPLINK] PREDICTION_HIGHLIGHT_COMMIT', {
      selectedPredictionId,
      chartDataContainsPrediction: predictions.some(p => p.id === selectedPredictionId),
      riskEvolutionRefFound: riskEvolutionRef.current != null,
    })
  }, [selectedPredictionId, predictions])

  // U4-DEEPLINK — temporary: tracks when the DOM node behind
  // riskEvolutionRef becomes available/unavailable, independent of
  // selection state. Answers whether the genuine PREDICTION_REF_STATUS
  // riskEvolutionRefFound:false observation was a timing issue (ref not
  // yet attached) or something else (ref never attaches at all for some
  // render path). Polled on a rAF loop purely for observation — never
  // writes application state, never affects rendering.
  useEffect(() => {
    let cancelled = false
    let wasAvailable = riskEvolutionRef.current != null
    const check = () => {
      if (cancelled) return
      const isAvailable = riskEvolutionRef.current != null
      if (isAvailable !== wasAvailable) {
        wasAvailable = isAvailable
        // eslint-disable-next-line no-console
        console.log(isAvailable ? '[U4-DEEPLINK] RISK_REF_AVAILABLE' : '[U4-DEEPLINK] RISK_REF_UNAVAILABLE', {
          selectedPredictionId,
        })
      }
      requestAnimationFrame(check)
    }
    const raf = requestAnimationFrame(check)
    return () => { cancelled = true; cancelAnimationFrame(raf) }
  }, [selectedPredictionId])


  // U4.2A — New Personal Information modal (replaces the previous inline
  // firstName/lastName/phone-only editor entirely — no editing/editForm/
  // editSaving/editError state remains; EditPatientModal owns its own
  // draft/saving/error state, prefilled directly from the canonical
  // `patient` object each time it opens).
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
      if (dashboardNavRef.current) {
        // eslint-disable-next-line no-console
        console.log('[U4-DEEPLINK] PATIENT_REFETCH_COMPLETE', {
          patientId: id, targetKind: dashboardNavRef.current.target.kind, targetId: dashboardNavRef.current.target.id,
        })
      }
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
      // eslint-disable-next-line no-console
      console.log('[U4-DEEPLINK] RECORDS_READY', { count: history.records.data.length, ids: history.records.data.map(r => r.id) })
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
  const loadPredictions = useCallback(async (silent = false) => {
    if (!id) return
    if (!silent) setPredictionsLoading(true)
    setPredictionsError(null)
    try {
      const result = await predictionService.getHistory(id)
      setPredictions(result.data)
      // eslint-disable-next-line no-console
      console.log('[U4-DEEPLINK] PREDICTIONS_READY', { count: result.data.length, ids: result.data.map(p => p.id) })
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
              {patient.phone && (
                <div className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
                  <span className="text-sm text-muted-foreground">Teléfono</span>
                  <a href={`tel:${patient.phone}`} className="text-sm font-semibold text-primary flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5" />
                    {patient.phone}
                  </a>
                </div>
              )}
              <InfoRow label="Registrado" value={formatDate(patient.createdAt)} />
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
                    ? `Últimas ${predictions.length} predicción${predictions.length === 1 ? '' : 'es'} · Score cardiovascular`
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
                  <Tooltip formatter={(v: number) => [`${(v * 100).toFixed(1)}%`, 'Score']} />
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
                  Último registro: {formatDateTime(latestRecord.recordedAt)}
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

          {/* Clinical history (INT-08) — past records from GET /:id/history */}
          {historyTotal > 1 && (
            <div className="bg-card rounded-xl border border-border p-5">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  Historial de registros clínicos
                </h3>
                <span className="text-xs text-muted-foreground">{historyTotal} registro{historyTotal === 1 ? '' : 's'}</span>
              </div>
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
                    {recordsLoading ? (
                      <tr><td colSpan={6} className="py-8 text-center">
                        <Loader2 className="w-5 h-5 text-primary animate-spin inline-block" />
                      </td></tr>
                    ) : recordsError ? (
                      <tr><td colSpan={6} className="py-4 text-center text-red-600">{recordsError}</td></tr>
                    ) : records.map(r => (
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
                        <td className="py-2 pr-4 text-muted-foreground">{formatDateTime(r.recordedAt)}</td>
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
            </div>
          )}

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
