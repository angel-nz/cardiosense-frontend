import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Activity, Calendar, Cpu, Loader2, History } from 'lucide-react'
import { RiskBadge } from '@/components/ui/RiskBadge'
import { RiskGauge } from '@/components/charts/RiskGauge'
import { ClinicalSourceDisclosure } from '@/components/predictions/ClinicalSourceDisclosure'
import { cn, formatRelativeBusinessDateTime, formatScore } from '@/lib/utils'
import { predictionService } from '@/services/predictionService'
import { useSocket } from '@/context/SocketContext'
import type { Prediction } from '@/types'

// Rendered inside PredictionsPage's "Historial" tab, so it reads :patientId
// from the same matched route (/predictions/:patientId) — no separate route
// needed. GET /api/predictions/patient/:patientId (INT-12).
export default function PredictionHistoryPage() {
  const { patientId } = useParams<{ patientId: string }>()
  const { lastPrediction, clearLastPrediction } = useSocket()

  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!patientId) return
    if (!silent) setLoading(true)
    setError(null)
    try {
      const result = await predictionService.getHistory(patientId)
      // Backend already orders by predictedAt desc; no re-sort needed.
      setPredictions(result.data)
    } catch {
      if (!silent) setError('No se pudo cargar el historial de predicciones')
      // A silent background refresh failing quietly is acceptable here —
      // the list just stays as-is; the user can still navigate away/back
      // or the next real fetch will retry. Surfacing an error banner for a
      // background refresh they didn't ask for would be more disruptive
      // than helpful.
    } finally {
      if (!silent) setLoading(false)
    }
  }, [patientId])

  useEffect(() => { load() }, [load])

  // INT-19 — prediction_completed: refresh the history list in place
  // (silent — no loading spinner) rather than fabricate a Prediction from
  // the event's partial payload. Scoped to the currently open patient only.
  useEffect(() => {
    if (!patientId || !lastPrediction || lastPrediction.patientId !== patientId) return
    load(true)
    clearLastPrediction()
  }, [patientId, lastPrediction, load, clearLastPrediction])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Loader2 className="w-7 h-7 text-primary animate-spin mb-3" />
        <p className="text-sm text-muted-foreground">Cargando historial...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="font-medium text-red-600">{error}</p>
        <button
          onClick={() => load()}
          className="mt-3 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
        >
          Reintentar
        </button>
      </div>
    )
  }

  if (predictions.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-8 text-center">
        <History className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
        <p className="font-medium text-foreground">Sin predicciones aún</p>
        <p className="text-sm text-muted-foreground mt-1">
          Este paciente no tiene predicciones registradas todavía
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Stats row — computed over the loaded history (capped at `limit`) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total',       value: predictions.length,                                       color: 'text-foreground' },
          { label: 'Alto riesgo', value: predictions.filter(p => p.riskLevel === 'high').length,    color: 'text-red-600' },
          { label: 'Moderado',    value: predictions.filter(p => p.riskLevel === 'moderate').length, color: 'text-amber-600' },
          { label: 'Anomalías',   value: predictions.filter(p => p.isAnomaly).length,                color: 'text-purple-600' },
        ].map(s => (
          <div key={s.label} className="bg-card rounded-xl border border-border px-4 py-3 text-center">
            <p className={cn('text-2xl font-bold', s.color)}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {predictions.map(pred => (
        <div key={pred.id} className="bg-card rounded-xl border border-border p-5">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 hidden sm:block">
              <RiskGauge score={pred.riskScore} level={pred.riskLevel} size={80} showLabel={false} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <RiskBadge level={pred.riskLevel} showScore />
                {pred.isAnomaly && (
                  <span className="text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full">
                    ⚠ Anomalía
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground flex-wrap">
                {pred.modelVersion && (
                  <span className="flex items-center gap-1">
                    <Cpu className="w-3.5 h-3.5" />
                    Modelo {pred.modelVersion}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {formatRelativeBusinessDateTime(pred.predictedAt)}
                </span>
              </div>
              {/* featureImportance isn't persisted on the Prediction row, so
                  it's never present on historical entries — no fallback data
                  is fabricated here (see report, INT-12 divergence). */}

              {/* V7 — additive clinical-source context, visually
                  subordinate to the result above (collapsed by default,
                  smaller type, muted border-top separator). */}
              <ClinicalSourceDisclosure
                healthRecord={pred.healthRecord}
                className="mt-3 pt-3 border-t border-border"
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
