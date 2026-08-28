import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Activity, AlertTriangle, CheckCircle, Loader2, Info,
  FileWarning, History, Sparkles, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { RiskGauge } from '@/components/charts/RiskGauge'
import { RiskBadge } from '@/components/ui/RiskBadge'
import { FeatureImportanceBar } from '@/components/charts/FeatureImportanceBar'
import { cn, formatScore, formatDateTime } from '@/lib/utils'
import { patientService } from '@/services/patientService'
import { recordService } from '@/services/recordService'
import { predictionService } from '@/services/predictionService'
import { usePredictions } from '@/hooks/usePredictions'
import { useSocket } from '@/context/SocketContext'
import PredictionHistoryPage from './PredictionHistoryPage'
import type { Patient, HealthRecord, Prediction } from '@/types'

const GLOBAL_PAGE_LIMIT = 20

// Reached when the route has no :patientId (e.g. the Sidebar links to the
// bare /predictions — see router.tsx). Shows the médico's own global
// prediction history — GET /api/predictions, scoped server-side by
// patient.medicoId (Bloque J security fix) — instead of the Bloque I
// patient picker, which duplicated PatientsPage's own search. Real
// server-side pagination; no "fetch all and paginate client-side".
function GlobalPredictionHistory() {
  const navigate = useNavigate()
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await predictionService.listAll(page, GLOBAL_PAGE_LIMIT)
      setPredictions(result.data)
      setTotal(result.total)
      setTotalPages(result.totalPages)
    } catch {
      setError('No se pudo cargar el historial de predicciones')
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => { load() }, [load])

  return (
    <div className="max-w-2xl mx-auto mt-4 space-y-4">
      <div className="text-center">
        <Activity className="w-10 h-10 text-primary mx-auto mb-3" />
        <h1 className="text-xl font-bold text-foreground">Historial de predicciones</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {total > 0
            ? `${total} predicción${total === 1 ? '' : 'es'} registrada${total === 1 ? '' : 's'}`
            : 'Selecciona un paciente en la lista para ver su detalle'}
        </p>
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
              onClick={load}
              className="mt-3 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
            >
              Reintentar
            </button>
          </div>
        ) : predictions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <History className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="font-medium text-foreground">Aún no tienes predicciones registradas.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {predictions.map(pred => (
              <button
                key={pred.id}
                onClick={() => navigate(`/predictions/${pred.patientId}`)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-accent/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {pred.patientName ?? pred.patientId}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                    <span className="font-mono">Score: {formatScore(pred.riskScore)}</span>
                    {pred.isAnomaly && (
                      <span className="text-purple-600 font-medium">⚠ Anomalía</span>
                    )}
                    <span>{formatDateTime(pred.predictedAt)}</span>
                  </div>
                </div>
                <RiskBadge level={pred.riskLevel} size="sm" />
              </button>
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
  const { subscribeToPatient, unsubscribeFromPatient, lastHealthRecord, clearLastHealthRecord } = useSocket()

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

  const { predicting, error, predict, clearError } = usePredictions()

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

  const handlePredict = async () => {
    if (!patientId) return
    clearError()
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
                  <p className="text-xs text-muted-foreground mt-0.5">
                    El modelo utiliza automáticamente el último registro del paciente
                  </p>
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
                  <p className="text-xs text-muted-foreground">
                    Registrado el {formatDateTime(latestRecord.recordedAt)}
                  </p>
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
                  <p className="text-xs text-red-700">{error}</p>
                </div>
              )}

              <div className="pt-3 border-t border-border">
                <button
                  onClick={handlePredict}
                  disabled={predicting || !hasRecord}
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
              </div>
            </div>
          </div>

          {/* ── Result Panel ──────────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">
            {result ? (
              <>
                <div className="bg-card rounded-xl border border-border p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-foreground">Resultado</h3>
                    <RiskBadge level={result.riskLevel} size="md" />
                  </div>
                  <div className="flex justify-center">
                    <RiskGauge score={result.riskScore} size={180} showLabel />
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
                  <div className="mt-3 flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                    <Info className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                    <p className="text-xs text-blue-600">
                      Predicción generada el {formatDateTime(result.predictedAt)}
                    </p>
                  </div>
                </div>

                {/* Feature importance — only present right after running a
                    new prediction; not persisted, so absent in history */}
                {result.featureImportance && (
                  <div className="bg-card rounded-xl border border-border p-5">
                    <h3 className="font-semibold text-foreground mb-4">Factores determinantes</h3>
                    <FeatureImportanceBar data={result.featureImportance} maxItems={6} />
                  </div>
                )}

                {showAlertNotice && (
                  <div className="flex items-center gap-2 p-3 bg-teal-50 border border-teal-200 rounded-xl">
                    <CheckCircle className="w-4 h-4 text-teal-600 flex-shrink-0" />
                    <p className="text-xs text-teal-700 font-medium">
                      Predicción guardada. El backend genera una alerta automáticamente para este nivel de riesgo.
                    </p>
                  </div>
                )}
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
