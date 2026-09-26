import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Search, Plus, Filter, Users, Download, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PatientRow } from '@/components/patients/PatientRow'
import { usePatients } from '@/hooks/usePatients'
import type { RiskLevel } from '@/types'

// X2 — defensive one-shot reader for the Dashboard "Riesgo alto" stat
// card's navigation intent (location.state), mirroring the established
// readDashboardEventNav precedent (PatientDetailPage.tsx, O3-FIX-4). Never
// blindly casts location.state — only ever recognizes its OWN relevant
// `kind`; any other/malformed payload is treated as absent. The intent
// carries no destination-internal filter representation itself (X1 §10) —
// this page maps it onto its own existing `riskFilter` state below.
function readPatientsStatNav(state: unknown): boolean {
  if (!state || typeof state !== 'object') return false
  const nav = (state as Record<string, unknown>).dashboardStatNav
  if (!nav || typeof nav !== 'object') return false
  return (nav as Record<string, unknown>).kind === 'PATIENTS_HIGH'
}

// X2 — maps the existing lowercase UI representation (RISK_FILTER_OPTIONS)
// to the backend's canonical uppercase Prisma RiskLevel enum
// (PatientQueryDto.risk) — never a second, independently-invented casing.
const CANONICAL_RISK: Record<RiskLevel, 'LOW' | 'MODERATE' | 'HIGH'> = {
  low: 'LOW', moderate: 'MODERATE', high: 'HIGH',
}

type SortKey = 'name' | 'age' | 'risk' | 'date'
type SortDir = 'asc' | 'desc'

const RISK_FILTER_OPTIONS: Array<{ value: RiskLevel | 'all'; label: string }> = [
  { value: 'all',      label: 'Todos los riesgos' },
  { value: 'high',     label: 'Alto' },
  { value: 'moderate', label: 'Moderado' },
  { value: 'low',      label: 'Bajo' },
]

const PAGE_LIMIT = 20

export default function PatientsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [riskFilter, setRiskFilter] = useState<RiskLevel | 'all'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(1)

  // Debounce search → backend GET /api/patients?search=...
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [searchInput])

  // X2 — risk filter is now genuinely applied server-side (dataset-wide,
  // before pagination — see patient.repository.ts), so a change must reset
  // pagination exactly like search already does above (X2-F28); previously
  // there was no such effect since the old client-side-only filter never
  // affected the backend's total/totalPages at all.
  useEffect(() => { setPage(1) }, [riskFilter])

  // X2 — consume the Dashboard "Riesgo alto" navigation intent exactly
  // once: applies to the SAME existing `riskFilter` state a doctor could
  // set manually, then immediately clears the history entry's state (same
  // one-shot precedent as PatientDetailPage's dashboardNav effect) so a
  // later refresh/back/normal re-visit never reapplies it.
  // statNavConsumedRef guards against reapplying on a later render even
  // before location.state finishes clearing.
  const statNavConsumedRef = useRef(false)
  useEffect(() => {
    if (statNavConsumedRef.current) return
    if (!readPatientsStatNav(location.state)) return
    statNavConsumedRef.current = true
    setRiskFilter('high')
    navigate(location.pathname, { replace: true, state: null })
  }, [location.state, location.pathname, navigate])

  const { patients, total, totalPages, loading, error, refetch } = usePatients({
    page, limit: PAGE_LIMIT, search: search || undefined,
    risk: riskFilter === 'all' ? undefined : CANONICAL_RISK[riskFilter],
  })

  // X2 — risk filtering is now genuinely applied server-side (dataset-wide,
  // before pagination, via usePatients({ risk }) above) — this no longer
  // re-applies a redundant client-side risk filter on top of an already
  // risk-filtered page. Sorting remains client-side/page-local, unchanged.
  const filtered = useMemo(() => {
    const list = [...patients]

    list.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'name':
          cmp = `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
          break
        case 'age':
          cmp = (a.age ?? 0) - (b.age ?? 0)
          break
        case 'risk': {
          const order: Record<string, number> = { high: 3, moderate: 2, low: 1 }
          cmp = (order[a.latestRisk ?? ''] ?? 0) - (order[b.latestRisk ?? ''] ?? 0)
          break
        }
        case 'date':
          cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return list
  }, [patients, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const SortIcon = ({ col }: { col: SortKey }) => (
    <span className={cn('ml-1 text-xs', sortKey === col ? 'text-primary' : 'text-muted-foreground')}>
      {sortKey === col ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  )

  const highRiskCount = patients.filter(p => p.latestRisk === 'high').length
  const noPredictionCount = patients.filter(p => !p.latestRisk).length

  return (
    <div className="space-y-5">
      {/* Stats strip — computed over the currently loaded page only,
          since the backend doesn't expose aggregate risk counts */}
      <div className="grid grid-cols-3 sm:grid-cols-3 gap-3">
        {[
          { label: 'Total', value: total, color: 'text-foreground' },
          { label: 'Riesgo alto', value: highRiskCount, color: 'text-red-600' },
          { label: 'Sin predicción', value: noPredictionCount, color: 'text-muted-foreground' },
        ].map(item => (
          <div key={item.label} className="bg-card rounded-xl border border-border px-4 py-3 text-center">
            <p className={cn('text-2xl font-bold', item.color)}>{item.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{item.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Buscar por nombre o CURP..."
            className="w-full pl-9 pr-4 py-2.5 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={riskFilter}
            onChange={e => setRiskFilter(e.target.value as RiskLevel | 'all')}
            className="py-2.5 px-3 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer"
          >
            {RISK_FILTER_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => navigate('/patients/new')}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Nuevo paciente
        </button>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Loader2 className="w-8 h-8 text-primary animate-spin mb-3" />
            <p className="text-sm text-muted-foreground">Cargando pacientes...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="font-medium text-red-600">No se pudo cargar la lista de pacientes</p>
            <p className="text-sm text-muted-foreground mt-1">{error}</p>
            <button
              onClick={refetch}
              className="mt-3 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
            >
              Reintentar
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="font-medium text-foreground">Sin resultados</p>
            <p className="text-sm text-muted-foreground mt-1">
              {search ? `No hay pacientes que coincidan con "${search}"` : 'No hay pacientes en esta categoría'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    <button onClick={() => toggleSort('name')} className="hover:text-foreground transition-colors">
                      Paciente <SortIcon col="name" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">
                    <button onClick={() => toggleSort('age')} className="hover:text-foreground transition-colors">
                      Edad <SortIcon col="age" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    <button onClick={() => toggleSort('risk')} className="hover:text-foreground transition-colors">
                      Nivel de riesgo <SortIcon col="risk" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">
                    <button onClick={() => toggleSort('date')} className="hover:text-foreground transition-colors">
                      Última actualización <SortIcon col="date" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden lg:table-cell">
                    Estado
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(patient => (
                  <PatientRow key={patient.id} patient={patient} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {/* Footer / pagination */}
        {!loading && !error && filtered.length > 0 && (
          <div className="px-4 py-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>Página {page} de {totalPages} · {total} pacientes en total</span>
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
