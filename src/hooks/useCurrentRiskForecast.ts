import { useCallback, useEffect, useRef, useState } from 'react'
import { isAxiosError } from 'axios'
import { riskForecastService } from '@/services/riskForecastService'
import type { CurrentRiskProjectionResponse, SocketRiskForecastsChanged } from '@/types'

// NEW S2E — CURRENT risk-projection state for ONE patient.
//
// Phases are deliberately distinct: an HTTP/transport failure is an
// 'error' phase — it is NEVER turned into an S domain state (HISTORY_INVALID,
// FAILED, BRIDGE_MISSING… only ever come from a successful backend response).
//
// Race protection (newest wins):
//   - every fetch takes a new generation id and aborts the previous request;
//   - a response is applied only if it still owns the current generation AND
//     its patientId equals the hook's patient (belt-and-braces against a late
//     Patient A response landing on Patient B);
//   - unmount / patient change bumps the generation and aborts in flight.
// The socket signal is invalidation-only: it triggers a refetch, never a
// local merge of rows from the payload.
export type ForecastLoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; response: CurrentRiskProjectionResponse; refreshing: boolean; refreshFailed: boolean }

export interface UseCurrentRiskForecastOptions {
  // Latest risk_forecasts_changed event (SocketContext scalar) and its ack.
  changeSignal?: SocketRiskForecastsChanged | null
  ackChangeSignal?: () => void
  // Lifecycle changes (deactivate/reactivate) are refetched even when no
  // CURRENT set existed (S2D emits no socket then).
  patientIsActive?: boolean
  // Test seam; defaults to the real service.
  fetchCurrent?: (patientId: string, opts: { signal?: AbortSignal }) => Promise<CurrentRiskProjectionResponse>
}

export function apiErrorMessage(err: unknown): string {
  if (isAxiosError(err) && err.response?.status === 404) return 'La proyección no está disponible para este paciente.'
  return 'No se pudo cargar la proyección de riesgo.'
}

export function useCurrentRiskForecast(patientId: string | undefined, opts: UseCurrentRiskForecastOptions = {}) {
  const { changeSignal, ackChangeSignal, patientIsActive } = opts
  const fetchCurrent = opts.fetchCurrent ?? riskForecastService.getCurrent
  const fetchRef = useRef(fetchCurrent)
  fetchRef.current = fetchCurrent

  const [state, setState] = useState<ForecastLoadState>({ phase: 'loading' })
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)

  const load = useCallback((mode: 'initial' | 'background') => {
    if (!patientId) return
    const generation = ++generationRef.current
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    if (mode === 'initial') setState({ phase: 'loading' })
    else setState(s => (s.phase === 'ready' ? { ...s, refreshing: true } : s))   // never blank visible content
    fetchRef.current(patientId, { signal: controller.signal })
      .then(response => {
        if (generation !== generationRef.current || response.patientId !== patientId) return
        setState({ phase: 'ready', response, refreshing: false, refreshFailed: false })
      })
      .catch(err => {
        if (generation !== generationRef.current || controller.signal.aborted) return
        // A failed BACKGROUND refresh keeps the last good content.
        setState(s => (s.phase === 'ready'
          ? { ...s, refreshing: false, refreshFailed: true }
          : { phase: 'error', message: apiErrorMessage(err) }))
      })
  }, [patientId])

  // Initial load per patient; cleanup invalidates and aborts (navigation/unmount).
  useEffect(() => {
    load('initial')
    return () => {
      generationRef.current++
      controllerRef.current?.abort()
      controllerRef.current = null
    }
  }, [load])

  // risk_forecasts_changed for THIS patient → background refetch. Events for
  // another patient are ignored (and left for their own consumer).
  useEffect(() => {
    if (!patientId || !changeSignal || changeSignal.patientId !== patientId) return
    load('background')
    ackChangeSignal?.()
  }, [patientId, changeSignal, ackChangeSignal, load])

  // Lifecycle flip on the SAME patient → background refetch.
  const lifecycleRef = useRef<{ patientId: string | undefined; active: boolean | undefined }>({ patientId, active: patientIsActive })
  useEffect(() => {
    const prev = lifecycleRef.current
    lifecycleRef.current = { patientId, active: patientIsActive }
    if (prev.patientId === patientId && prev.active !== undefined && patientIsActive !== undefined && prev.active !== patientIsActive) {
      load('background')
    }
  }, [patientId, patientIsActive, load])

  return { state, refetch: () => load('background') }
}
