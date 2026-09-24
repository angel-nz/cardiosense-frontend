import { useState, useCallback } from 'react'
import type { Prediction } from '@/types'
import { predictionService } from '@/services/predictionService'

interface UsePredictionsReturn {
  predicting: boolean
  error: string | null
  predict: (patientId: string, healthRecordId?: string) => Promise<Prediction | null>
  clearError: () => void
}

// Scoped to executing a single prediction (INT-11). History fetching lives in
// predictionService.getHistory, called directly by PredictionHistoryPage —
// this hook only owns the predict-request lifecycle (idle/loading/error).
export function usePredictions(): UsePredictionsReturn {
  const [predicting, setPredicting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const predict = useCallback(async (patientId: string, healthRecordId?: string): Promise<Prediction | null> => {
    setPredicting(true)
    setError(null)
    try {
      return await predictionService.predict({ patientId, healthRecordId })
    } catch (err) {
      setError(extractPredictError(err))
      return null
    } finally {
      setPredicting(false)
    }
  }, [])

  return { predicting, error, predict, clearError: () => setError(null) }
}

function extractPredictError(err: unknown): string {
  const anyErr = err as { response?: { status?: number; data?: { error?: string; code?: string; modelVersion?: string; eligibleAgeRange?: { min: number; max: number } } } }
  const status = anyErr?.response?.status
  const data = anyErr?.response?.data
  const serverMessage = data?.error

  if (status === 404) {
    return serverMessage ?? 'Este paciente no tiene registros clínicos. Crea uno antes de predecir.'
  }
  if (status === 422 && data?.code === 'MODEL_INELIGIBLE') {
    // U8.6C — the range/model identity come from the backend response
    // (which itself reads them from the model's own capabilities) —
    // NEVER hardcoded here.
    const range = data.eligibleAgeRange
    const rangeText = range ? ` (rango soportado: ${range.min}-${range.max} años)` : ''
    return `Predicción no disponible: la edad de este registro está fuera del rango de soporte de ${data.modelVersion ?? 'el modelo actual'}${rangeText}.`
  }
  if (status === 422 && data?.code === 'AI_INPUT_REJECTED') {
    return 'El servicio de IA rechazó los datos de este registro. Verifica los valores clínicos e intenta de nuevo.'
  }
  if (status === 503) {
    return 'El servicio de IA no está disponible en este momento. Intenta de nuevo más tarde.'
  }
  if (status === 502) {
    return 'Ocurrió un error técnico al ejecutar la predicción. Intenta de nuevo más tarde.'
  }
  return serverMessage ?? 'No se pudo ejecutar la predicción. Intenta de nuevo.'
}
