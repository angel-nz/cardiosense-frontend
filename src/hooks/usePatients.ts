import { useState, useEffect, useCallback, useRef } from 'react'
import type { Patient } from '@/types'
import { patientService } from '@/services/patientService'

interface UsePatientsParams {
  page?: number
  limit?: number
  search?: string
  // X2 — canonical uppercase risk-level filter, applied server-side
  // (dataset-wide, before pagination) via patientService.list. See
  // patient.repository.ts for the exact latest-Prediction-per-patient
  // semantics this must match.
  risk?: 'LOW' | 'MODERATE' | 'HIGH'
}

interface UsePatientsReturn {
  patients: Patient[]
  total: number
  page: number
  totalPages: number
  loading: boolean
  error: string | null
  refetch: () => void
}

export function usePatients(params: UsePatientsParams = {}): UsePatientsReturn {
  const { page = 1, limit = 20, search, risk } = params

  const [patients,   setPatients]   = useState<Patient[]>([])
  const [total,      setTotal]      = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)

  // X2-FIX1 — requestId staleness guard, the same project-established
  // pattern already used by AlertsPage/GlobalPredictionHistory/
  // PredictionHistoryPage (requestIdRef). Without this, two overlapping
  // requests can resolve in EITHER order — e.g. this hook's own mount
  // effect fires an initial request with whatever page/limit/search/risk
  // it was FIRST called with, and a synchronous post-mount filter change
  // (such as PatientsPage's PATIENTS_HIGH location.state-driven
  // `setRiskFilter('high')`, or simply changing the risk/search filter
  // while not already on page 1) immediately fires a second, newer request
  // with different params. If the earlier, now-stale request's response
  // happens to arrive after the newer one's, it would silently overwrite
  // the correct, newer result with the stale one — the exact X2-FIX1
  // defect (UI shows "Alto" selected, but the unfiltered list renders).
  // Only the response belonging to the MOST RECENTLY issued request is
  // ever applied to state; every earlier request's settlement (success or
  // error) is a no-op once superseded.
  const requestIdRef = useRef(0)

  const fetchPatients = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)
    try {
      const result = await patientService.list({ page, limit, search, risk })
      if (requestId !== requestIdRef.current) return
      setPatients(result.data)
      setTotal(result.total)
      setTotalPages(result.totalPages)
    } catch {
      if (requestId !== requestIdRef.current) return
      setError('No se pudo cargar la lista de pacientes')
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [page, limit, search, risk])

  useEffect(() => { fetchPatients() }, [fetchPatients])

  return { patients, total, page, totalPages, loading, error, refetch: fetchPatients }
}
