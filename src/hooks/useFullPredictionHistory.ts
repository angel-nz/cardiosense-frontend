import { useEffect, useRef, useState } from 'react'
import { predictionService } from '@/services/predictionService'
import type { Prediction } from '@/types'

// NEW S2E-FIX2 — complete Prediction history for the full risk-evolution
// modal. LAZY: nothing is fetched while `enabled` is false (normal patient
// page stays light). Every (re)load takes a new generation and aborts the
// previous request; a result is applied only if it still owns the
// generation AND every row belongs to the requested patient. Disabling
// (modal closed) or a patient change invalidates in-flight work and clears
// the data. `reloadKey` bumps (new REAL Prediction) refetch while enabled,
// keeping the previous rows visible meanwhile.
export type FullHistoryState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; patientId: string; predictions: Prediction[]; refreshing: boolean }

export function useFullPredictionHistory(
  patientId: string | undefined,
  enabled: boolean,
  reloadKey: number,
  fetchAll: (patientId: string, opts: { signal?: AbortSignal }) => Promise<Prediction[]> = predictionService.getAllForPatient,
) {
  const [state, setState] = useState<FullHistoryState>({ phase: 'idle' })
  const generationRef = useRef(0)
  const fetchRef = useRef(fetchAll)
  fetchRef.current = fetchAll

  useEffect(() => {
    if (!enabled || !patientId) {
      generationRef.current++
      setState({ phase: 'idle' })
      return
    }
    const generation = ++generationRef.current
    const controller = new AbortController()
    setState(s => (s.phase === 'ready' && s.patientId === patientId ? { ...s, refreshing: true } : { phase: 'loading' }))
    fetchRef.current(patientId, { signal: controller.signal })
      .then(predictions => {
        if (generation !== generationRef.current || predictions.some(p => p.patientId !== patientId)) return
        setState({ phase: 'ready', patientId, predictions, refreshing: false })
      })
      .catch(() => {
        if (generation !== generationRef.current || controller.signal.aborted) return
        setState(s => (s.phase === 'ready' && s.patientId === patientId ? { ...s, refreshing: false } : { phase: 'error', message: 'No se pudo cargar el historial completo de predicciones.' }))
      })
    return () => {
      generationRef.current++
      controller.abort()
    }
  }, [patientId, enabled, reloadKey])

  return state
}
