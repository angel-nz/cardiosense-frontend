import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import {
  ArrowLeft, Activity, Heart, Phone, Calendar,
  User, FileText, AlertTriangle, Plus, Edit, Loader2, X, Check,
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
import { cn, formatDate, formatDateTime, calcAge, sexLabel, timeAgo } from '@/lib/utils'
import { patientService } from '@/services/patientService'
import { predictionService } from '@/services/predictionService'
import { useSocket } from '@/context/SocketContext'
import type { Patient, HealthRecord, Prediction, UpdatePatientRequest, DashboardEventNavigationState } from '@/types'

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

const inputClass = cn(
  'w-full px-3 py-2 text-sm rounded-lg border border-border bg-card',
  'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
  'transition-all placeholder:text-muted-foreground',
)

// ─── Edit patient (INT-07) ────────────────────────────────────────────────
// Backend UpdatePatientDto only accepts firstName/lastName/phone/isActive —
// birthDate/sex/curp are not editable post-creation, so those fields are
// intentionally absent from this form.
interface EditFormState {
  firstName: string
  lastName: string
  phone: string
}

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

  // Patient switch (A→B): clear cross-navigation state — a highlighted
  // record/prediction from the previous patient must never survive.
  useEffect(() => {
    setSelectedHealthRecordId(null)
    setSelectedPredictionId(null)
    setTimelineFeedback(null)
    setDashboardNav(null)
    navTargetAppliedRef.current = false
  }, [id])

  // CLINICAL_RECORD click. `records` (loadHistory, GET /:id/history) is
  // unbounded — no page/limit — so in practice a Calendar clinical event
  // should always resolve here. Still checked explicitly rather than
  // assumed (section 24/25): a not-found record never highlights a
  // different, wrong row.
  const handleSelectHealthRecord = useCallback((healthRecordId: string) => {
    const exists = records.some(r => r.id === healthRecordId)
    if (!exists) {
      setTimelineFeedback('Este registro no está incluido en el historial clínico actualmente visible.')
      return
    }
    setTimelineFeedback(null)
    setSelectedPredictionId(null)
    setSelectedHealthRecordId(healthRecordId)
    recordRowRefs.current.get(healthRecordId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [records])

  // PREDICTION / RISK_CHANGE click (RISK_CHANGE passes its
  // currentPredictionId here — same target, same mechanism, no duplicate
  // navigation flow). `predictions` (predictionService.getHistory) is
  // capped at the latest 20 — a Calendar month can legitimately reference
  // an older Prediction outside that window; that case is reported
  // honestly instead of guessing a nearby point.
  const handleSelectPrediction = useCallback((predictionId: string) => {
    const exists = predictions.some(p => p.id === predictionId)
    if (!exists) {
      setTimelineFeedback('Esta predicción no está incluida en la ventana actualmente visible del historial (últimas 20).')
      return
    }
    setTimelineFeedback(null)
    setSelectedHealthRecordId(null)
    setSelectedPredictionId(predictionId)
    riskEvolutionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [predictions])

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
  useEffect(() => {
    if (!dashboardNav || navTargetAppliedRef.current) return
    if (recordsLoading || predictionsLoading) return
    navTargetAppliedRef.current = true
    if (dashboardNav.target.kind === 'HEALTH_RECORD') handleSelectHealthRecord(dashboardNav.target.id)
    else handleSelectPrediction(dashboardNav.target.id)
  }, [dashboardNav, recordsLoading, predictionsLoading, handleSelectHealthRecord, handleSelectPrediction])

  // Edit patient
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<EditFormState>({ firstName: '', lastName: '', phone: '' })
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // U3.2 — New Record modal (replaces the previous inline expandable form
  // and its showRecordForm/recordForm/recordSavingRef/etc. state — all of
  // that now lives inside NewRecordModal.tsx, which owns its own submit/
  // double-submit-guard/error state; this page only needs to know whether
  // the dialog is open).
  const [newRecordModalOpen, setNewRecordModalOpen] = useState(false)

  const loadPatient = useCallback(async (silent = false) => {
    if (!id) return
    if (!silent) setPatientLoading(true)
    setPatientError(null)
    try {
      const p = await patientService.getById(id)
      setPatient(p)
      // Don't clobber an in-progress edit with a background refresh.
      setEditForm(f => (editing ? f : { firstName: p.firstName, lastName: p.lastName, phone: p.phone ?? '' }))
    } catch (err) {
      if (!silent) {
        setPatientError(
          isAxiosError(err) && err.response?.status === 404
            ? 'Paciente no encontrado'
            : 'No se pudo cargar la información del paciente',
        )
      }
    } finally {
      if (!silent) setPatientLoading(false)
    }
  }, [id, editing])

  // GET /api/patients/:id/history (INT-08) — only `records` is consumed;
  // `predictions` in the response is intentionally not rendered here.
  const loadHistory = useCallback(async (silent = false) => {
    if (!id) return
    if (!silent) setRecordsLoading(true)
    setRecordsError(null)
    try {
      const history = await patientService.getHistory(id)
      setRecords(history.records)
    } catch {
      if (!silent) setRecordsError('No se pudo cargar el historial clínico')
    } finally {
      if (!silent) setRecordsLoading(false)
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
    } catch {
      if (!silent) setPredictionsError('No se pudo cargar el historial de predicciones')
    } finally {
      if (!silent) setPredictionsLoading(false)
    }
  }, [id])

  useEffect(() => { loadPatient() }, [loadPatient])
  useEffect(() => { loadHistory() }, [loadHistory])
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

  // INT-20 — health_record_created. Q3: dedup by record.id before deciding
  // whether to refetch. The payload is too thin (ids + recordedAt only) to
  // build a full HealthRecord, so when the record is genuinely new to this
  // client's local state, this still refetches the authoritative list
  // (same as before) — but when the creator's own POST already inserted it
  // (see submitRecord above), this becomes a no-op: no redundant GET, and
  // no dependency on event ordering between the HTTP response and the
  // socket delivery (whichever arrives first "wins" the insert; the other
  // sees it's already present and does nothing).
  useEffect(() => {
    if (!id || !lastHealthRecord || lastHealthRecord.patientId !== id) return
    let alreadyPresent = false
    setRecords(prev => {
      alreadyPresent = prev.some(r => r.id === lastHealthRecord.recordId)
      return prev
    })
    if (!alreadyPresent) loadHistory(true)
    clearLastHealthRecord()
  }, [id, lastHealthRecord, loadHistory, clearLastHealthRecord])

  // INT-21 — patient_updated: payload carries exactly firstName/lastName/
  // isActive (the only fields UpdatePatientDto/deactivate can change) — a
  // direct merge is safe and avoids an unnecessary refetch.
  useEffect(() => {
    if (!id || !lastPatientUpdate || lastPatientUpdate.patientId !== id) return
    setPatient(p => p ? {
      ...p,
      firstName: lastPatientUpdate.firstName,
      lastName:  lastPatientUpdate.lastName,
      isActive:  lastPatientUpdate.isActive,
    } : p)
    clearLastPatientUpdate()
  }, [id, lastPatientUpdate, clearLastPatientUpdate])

  const saveEdit = async () => {
    if (!id) return
    setEditSaving(true)
    setEditError(null)
    try {
      const payload: UpdatePatientRequest = {
        firstName: editForm.firstName.trim(),
        lastName: editForm.lastName.trim(),
        phone: editForm.phone.trim() || undefined,
      }
      const updated = await patientService.update(id, payload)
      setPatient(updated)
      setEditing(false)
    } catch (err) {
      setEditError(
        isAxiosError(err) && err.response?.data?.error
          ? err.response.data.error
          : 'No se pudo actualizar el paciente',
      )
    } finally {
      setEditSaving(false)
    }
  }

  // U3.2 — passed as NewRecordModal's onCreated. Reuses the EXACT Q3
  // insertion logic the previous inline form used (dedup by id, prepend —
  // recordedAt-desc is the same order GET /:id/history already returns) —
  // never reimplemented inside the modal, which only knows how to POST and
  // hand the result back.
  const handleRecordCreated = (created: HealthRecord) => {
    setRecords(prev => (prev.some(r => r.id === created.id) ? prev : [created, ...prev]))
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
  const latestRecord = records[0]
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
            onClick={() => setEditing(e => !e)}
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

            {editing ? (
              <div className="space-y-3">
                {editError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                    {editError}
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Nombre(s)</label>
                  <input
                    className={inputClass}
                    value={editForm.firstName}
                    onChange={e => setEditForm(f => ({ ...f, firstName: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Apellidos</label>
                  <input
                    className={inputClass}
                    value={editForm.lastName}
                    onChange={e => setEditForm(f => ({ ...f, lastName: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Teléfono</label>
                  <input
                    className={inputClass}
                    value={editForm.phone}
                    onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                  />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={saveEdit}
                    disabled={editSaving}
                    className="flex items-center gap-1.5 bg-primary text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {editSaving ? 'Guardando...' : 'Guardar'}
                  </button>
                  <button
                    onClick={() => { setEditing(false); setEditError(null) }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
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
            )}
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

            {recordsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-primary animate-spin" />
              </div>
            ) : recordsError ? (
              <p className="text-sm text-red-600 text-center py-4">{recordsError}</p>
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
          {records.length > 1 && (
            <div className="bg-card rounded-xl border border-border p-5">
              <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                Historial de registros clínicos
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground uppercase tracking-wide border-b border-border">
                      <th className="py-2 pr-4">Fecha</th>
                      <th className="py-2 pr-4">Sistólica</th>
                      <th className="py-2 pr-4">Diastólica</th>
                      <th className="py-2 pr-4">Colesterol</th>
                      <th className="py-2 pr-4">Glucosa</th>
                      <th className="py-2">IMC</th>
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
