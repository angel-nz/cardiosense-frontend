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
  const anyErr = err as { response?: { status?: number; data?: { error?: string } } }
  const status = anyErr?.response?.status
  const serverMessage = anyErr?.response?.data?.error

  if (status === 404) {
    return serverMessage ?? 'Este paciente no tiene registros clínicos. Crea uno antes de predecir.'
  }
  if (status === 503) {
    return 'El servicio de IA no está disponible en este momento. Intenta de nuevo más tarde.'
  }
  return serverMessage ?? 'No se pudo ejecutar la predicción. Intenta de nuevo.'
}
