import { useState, useEffect, useCallback } from 'react'
import type { Patient } from '@/types'
import { patientService } from '@/services/patientService'

interface UsePatientsParams {
  page?: number
  limit?: number
  search?: string
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
  const { page = 1, limit = 20, search } = params

  const [patients,   setPatients]   = useState<Patient[]>([])
  const [total,      setTotal]      = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)

  const fetchPatients = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await patientService.list({ page, limit, search })
      setPatients(result.data)
      setTotal(result.total)
      setTotalPages(result.totalPages)
    } catch {
      setError('No se pudo cargar la lista de pacientes')
    } finally {
      setLoading(false)
    }
  }, [page, limit, search])

  useEffect(() => { fetchPatients() }, [fetchPatients])

  return { patients, total, page, totalPages, loading, error, refetch: fetchPatients }
}
