import { useState, useCallback } from 'react'
import type { Prediction } from '@/types'
import { predictionService } from '@/services/predictionService'

interface UsePredictionsReturn {
  predicting: boolean
  error: string | null
  // V-AGE-FIX-2 §6/§7 — the raw error code, alongside the human-readable
  // `error` message, so a consumer (PredictionsPage) can decide whether to
  // show the "create a new clinical record" CTA without re-parsing the
  // message string. `null` whenever `error` is `null`.
  errorCode: string | null
  predict: (patientId: string, healthRecordId?: string) => Promise<Prediction | null>
  clearError: () => void
}

// Scoped to executing a single prediction (INT-11). History fetching lives in
// predictionService.getHistory, called directly by PredictionHistoryPage —
// this hook only owns the predict-request lifecycle (idle/loading/error).
export function usePredictions(): UsePredictionsReturn {
  const [predicting, setPredicting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const predict = useCallback(async (patientId: string, healthRecordId?: string): Promise<Prediction | null> => {
    setPredicting(true)
    setError(null)
    setErrorCode(null)
    try {
      return await predictionService.predict({ patientId, healthRecordId })
    } catch (err) {
      const extracted = extractPredictError(err)
      setError(extracted.message)
      setErrorCode(extracted.code)
      return null
    } finally {
      setPredicting(false)
    }
  }, [])

  const clearError = useCallback(() => { setError(null); setErrorCode(null) }, [])

  return { predicting, error, errorCode, predict, clearError }
}

interface ExtractedPredictError {
  message: string
  code: string | null
}

function extractPredictError(err: unknown): ExtractedPredictError {
  const anyErr = err as { response?: { status?: number; data?: { error?: string; code?: string; modelVersion?: string; eligibleAgeRange?: { min: number; max: number } } } }
  const status = anyErr?.response?.status
  const data = anyErr?.response?.data
  const serverMessage = data?.error
  const code = data?.code ?? null

  if (status === 404) {
    return { message: serverMessage ?? 'Este paciente no tiene registros clínicos. Crea uno antes de predecir.', code }
  }
  if (status === 422 && data?.code === 'MODEL_INELIGIBLE') {
    // U8.6C / V-AGE-FIX-2 §6 — the range/model identity come from the
    // backend response (which itself reads them from the model's own
    // capabilities) — NEVER hardcoded here. The wording explicitly
    // distinguishes "the clinical record Prediction actually used" from
    // "the patient's current demographic information", since editing the
    // patient's birth date does NOT change the age already stored on that
    // record (V-AGE-FIX-1/2 — historical provenance is immutable), and
    // tells the doctor the concrete next step instead of implying the
    // patient themselves is permanently ineligible.
    const range = data.eligibleAgeRange
    const rangeText = range ? ` (rango soportado: ${range.min}-${range.max} años)` : ''
    return {
      message: `Predicción no disponible: el registro clínico utilizado para esta predicción fue creado con una edad fuera del rango que soporta ${data.modelVersion ?? 'el modelo actual'}${rangeText}. Si la información demográfica del paciente cambió desde entonces, crea un nuevo registro clínico para generar una predicción con los datos actualizados.`,
      code,
    }
  }
  if (status === 422 && data?.code === 'AI_INPUT_REJECTED') {
    return { message: 'El servicio de IA rechazó los datos de este registro. Verifica los valores clínicos e intenta de nuevo.', code }
  }
  if (status === 503) {
    return { message: 'El servicio de IA no está disponible en este momento. Intenta de nuevo más tarde.', code }
  }
  if (status === 502) {
    return { message: 'Ocurrió un error técnico al ejecutar la predicción. Intenta de nuevo más tarde.', code }
  }
  return { message: serverMessage ?? 'No se pudo ejecutar la predicción. Intenta de nuevo.', code }
}
