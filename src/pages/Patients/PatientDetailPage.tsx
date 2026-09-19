import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
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
import { cn, formatDate, formatDateTime, calcAge, sexLabel, timeAgo } from '@/lib/utils'
import { patientService } from '@/services/patientService'
import { recordService } from '@/services/recordService'
import { predictionService } from '@/services/predictionService'
import { useSocket } from '@/context/SocketContext'
import type { Patient, HealthRecord, Prediction, UpdatePatientRequest, CreateHealthRecordRequest } from '@/types'

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

// ─── New health record (INT-09) ───────────────────────────────────────────
interface RecordFormState {
  age: string
  currentSmoker: boolean
  cigsPerDay: string
  bpMeds: boolean
  diabetes: boolean
  totChol: string
  sysBP: string
  diaBP: string
  bmi: string
  heartRate: string
  glucose: string
  notes: string
}

const RECORD_INITIAL: RecordFormState = {
  age: '', currentSmoker: false, cigsPerDay: '0', bpMeds: false, diabetes: false,
  totChol: '', sysBP: '', diaBP: '', bmi: '', heartRate: '', glucose: '', notes: '',
}

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
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

  // Patient switch (A→B): clear cross-navigation state — a highlighted
  // record/prediction from the previous patient must never survive.
  useEffect(() => {
    setSelectedHealthRecordId(null)
    setSelectedPredictionId(null)
    setTimelineFeedback(null)
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

  // Edit patient
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<EditFormState>({ firstName: '', lastName: '', phone: '' })
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // New health record
  const [showRecordForm, setShowRecordForm] = useState(false)
  const [recordForm, setRecordForm] = useState<RecordFormState>(RECORD_INITIAL)
  const [recordSaving, setRecordSaving] = useState(false)
  // Synchronous guard against double-submit (Q2): `disabled={recordSaving}`
  // on the button already existed, but a React state update only disables
  // the DOM after a re-render — two clicks close enough together can both
  // fire before that happens. A ref is read/written synchronously, so it
  // closes that race window completely.
  const recordSavingRef = useRef(false)
  const [recordFormError, setRecordFormError] = useState<string | null>(null)
  const [recordFieldErrors, setRecordFieldErrors] = useState<Record<string, string>>({})

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

  const submitRecord = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || recordSavingRef.current) return
    recordSavingRef.current = true
    setRecordFormError(null)
    setRecordFieldErrors({})
    setRecordSaving(true)
    try {
      const payload: CreateHealthRecordRequest = {
        patientId: id,
        age: Number(recordForm.age),
        currentSmoker: recordForm.currentSmoker,
        cigsPerDay: Number(recordForm.cigsPerDay || 0),
        bpMeds: recordForm.bpMeds,
        diabetes: recordForm.diabetes,
        totChol: Number(recordForm.totChol),
        sysBP: Number(recordForm.sysBP),
        diaBP: Number(recordForm.diaBP),
        bmi: Number(recordForm.bmi),
        heartRate: Number(recordForm.heartRate),
        glucose: Number(recordForm.glucose),
        notes: recordForm.notes.trim() || undefined,
      }
      const created = await recordService.create(payload)
      // Q3 — the creator updates its own local state directly from the
      // 201 response instead of waiting for health_record_created: an
      // operation this client just executed successfully shouldn't depend
      // on realtime delivery to be reflected locally (the bug Q3 fixes —
      // see the dedup-aware socket effect below for the other half of this).
      // recordedAt-desc is the same order GET /patients/:id/history already
      // returns (patient.repository.ts), so prepending keeps it correct.
      setRecords(prev => (prev.some(r => r.id === created.id) ? prev : [created, ...prev]))
      setRecordForm(RECORD_INITIAL)
      setShowRecordForm(false)
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 400 && err.response.data?.details) {
        setRecordFieldErrors(err.response.data.details as Record<string, string>)
      } else if (isAxiosError(err) && err.response?.data?.error) {
        setRecordFormError(err.response.data.error)
      } else {
        setRecordFormError('No se pudo guardar el registro clínico. Intenta de nuevo.')
      }
    } finally {
      setRecordSaving(false)
      recordSavingRef.current = false
    }
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
        <div className="flex items-center gap-2 flex-shrink-0">
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
                <p className="text-[11px] text-muted-foreground italic">
                  Fecha de nacimiento, sexo y CURP no son editables.
                </p>
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
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground">Indicadores clínicos</h3>
              <button
                onClick={() => setShowRecordForm(s => !s)}
                className="flex items-center gap-1.5 text-xs font-medium text-primary hover:bg-primary/10 px-2.5 py-1.5 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Nuevo registro
              </button>
            </div>

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
            {showRecordForm && (
              <form onSubmit={submitRecord} className="mt-5 pt-5 border-t border-border space-y-4">
                {recordFormError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                    {recordFormError}
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Edad</label>
                    <input type="number" min={18} max={120} required className={inputClass}
                      value={recordForm.age}
                      onChange={e => setRecordForm(f => ({ ...f, age: e.target.value }))} />
                    {recordFieldErrors.age && <p className="text-[11px] text-red-600">{recordFieldErrors.age}</p>}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Presión sistólica</label>
                    <input type="number" min={60} max={300} required className={inputClass}
                      value={recordForm.sysBP}
                      onChange={e => setRecordForm(f => ({ ...f, sysBP: e.target.value }))} />
                    {recordFieldErrors.sysBP && <p className="text-[11px] text-red-600">{recordFieldErrors.sysBP}</p>}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Presión diastólica</label>
                    <input type="number" min={40} max={200} required className={inputClass}
                      value={recordForm.diaBP}
                      onChange={e => setRecordForm(f => ({ ...f, diaBP: e.target.value }))} />
                    {recordFieldErrors.diaBP && <p className="text-[11px] text-red-600">{recordFieldErrors.diaBP}</p>}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Colesterol total</label>
                    <input type="number" min={50} max={800} required className={inputClass}
                      value={recordForm.totChol}
                      onChange={e => setRecordForm(f => ({ ...f, totChol: e.target.value }))} />
                    {recordFieldErrors.totChol && <p className="text-[11px] text-red-600">{recordFieldErrors.totChol}</p>}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">IMC</label>
                    <input type="number" step="0.1" min={10} max={80} required className={inputClass}
                      value={recordForm.bmi}
                      onChange={e => setRecordForm(f => ({ ...f, bmi: e.target.value }))} />
                    {recordFieldErrors.bmi && <p className="text-[11px] text-red-600">{recordFieldErrors.bmi}</p>}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Frec. cardíaca</label>
                    <input type="number" min={30} max={250} required className={inputClass}
                      value={recordForm.heartRate}
                      onChange={e => setRecordForm(f => ({ ...f, heartRate: e.target.value }))} />
                    {recordFieldErrors.heartRate && <p className="text-[11px] text-red-600">{recordFieldErrors.heartRate}</p>}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Glucosa</label>
                    <input type="number" min={30} max={500} required className={inputClass}
                      value={recordForm.glucose}
                      onChange={e => setRecordForm(f => ({ ...f, glucose: e.target.value }))} />
                    {recordFieldErrors.glucose && <p className="text-[11px] text-red-600">{recordFieldErrors.glucose}</p>}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Cigarrillos/día</label>
                    <input type="number" min={0} max={100} className={inputClass}
                      value={recordForm.cigsPerDay}
                      onChange={e => setRecordForm(f => ({ ...f, cigsPerDay: e.target.value }))} />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={recordForm.currentSmoker}
                      onChange={e => setRecordForm(f => ({ ...f, currentSmoker: e.target.checked }))} />
                    Fumador actual
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={recordForm.bpMeds}
                      onChange={e => setRecordForm(f => ({ ...f, bpMeds: e.target.checked }))} />
                    Medicamento para presión
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={recordForm.diabetes}
                      onChange={e => setRecordForm(f => ({ ...f, diabetes: e.target.checked }))} />
                    Diabetes
                  </label>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Notas</label>
                  <textarea rows={2} className={inputClass} maxLength={1000}
                    value={recordForm.notes}
                    onChange={e => setRecordForm(f => ({ ...f, notes: e.target.value }))} />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={recordSaving}
                    className="flex items-center gap-1.5 bg-primary text-white px-4 py-2 rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
                  >
                    {recordSaving ? 'Guardando...' : 'Guardar registro'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowRecordForm(false); setRecordFormError(null); setRecordFieldErrors({}) }}
                    className="px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-accent rounded-lg transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}
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
