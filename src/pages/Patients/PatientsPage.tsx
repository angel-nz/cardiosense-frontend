import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, Plus, Users, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PatientRow } from '@/components/patients/PatientRow'
import { usePatients } from '@/hooks/usePatients'
import type { RiskLevel, PatientLifecycleFilter } from '@/types'

// X2 — maps the existing lowercase UI representation (RISK_FILTER_OPTIONS)
// to the backend's canonical uppercase Prisma RiskLevel enum
// (PatientQueryDto.risk) — never a second, independently-invented casing.
const CANONICAL_RISK: Record<RiskLevel, 'LOW' | 'MODERATE' | 'HIGH'> = {
  low: 'LOW', moderate: 'MODERATE', high: 'HIGH',
}

// Z8-FIX2 §3/§4/§5 — status/risk are now backed directly by the URL's own
// search params (`useSearchParams`) instead of plain useState initialized
// once and separately synced from Dashboard's old location.state intent.
// This is the single source of truth required by §5: no duplicate
// competing filter state, the initial value already reflects an incoming
// Dashboard deep link on first render (no effect/flash that could
// overwrite it, §4), and — unlike location.state — a real query string
// survives a browser refresh of the Dashboard-generated URL (§21-D).
// Values are validated against exactly the same enums STATUS_FILTER_OPTIONS/
// RISK_FILTER_OPTIONS already use below — no new enum/casing invented
// anywhere in this change.
function parseStatusParam(raw: string | null): PatientLifecycleFilter {
  return raw === 'ACTIVE' || raw === 'INACTIVE' || raw === 'ALL' ? raw : 'ALL'
}
function parseRiskParam(raw: string | null): RiskLevel | 'all' {
  return raw === 'low' || raw === 'moderate' || raw === 'high' ? raw : 'all'
}

type SortKey = 'name' | 'age' | 'risk' | 'date'
type SortDir = 'asc' | 'desc'

const RISK_FILTER_OPTIONS: Array<{ value: RiskLevel | 'all'; label: string }> = [
  { value: 'all',      label: 'Todos los riesgos' },
  { value: 'high',     label: 'Alto' },
  { value: 'moderate', label: 'Moderado' },
  { value: 'low',      label: 'Bajo' },
]

// Z8-FIX2 §3 — compact lifecycle filter. Default changed from ACTIVE to
// ALL ("Todos"): opening /patients with no explicit `status` param now
// shows active + inactive-visible patients (hidden patients stay excluded
// server-side regardless of this value, same as before). `status=ALL` is
// sent explicitly to the backend rather than merely omitted — the backend
// contract itself accepts 'ALL' as a real enum value, not just "absent"
// (patient.dto.ts's PatientStatusFilter), so this is not a new value.
const STATUS_FILTER_OPTIONS: Array<{ value: PatientLifecycleFilter; label: string }> = [
  { value: 'ACTIVE',   label: 'Activos' },
  { value: 'INACTIVE', label: 'Inactivos' },
  { value: 'ALL',      label: 'Todos' },
]

const PAGE_LIMIT = 20

export default function PatientsPage() {
  const navigate = useNavigate()
  // Z8-FIX2 §3/§4/§5 — status/risk now live in the URL itself (see
  // parseStatusParam/parseRiskParam above). searchParams is read directly
  // on every render — no separate useState to keep manually in sync, so
  // there is exactly one source of truth and a Dashboard deep link
  // (`/patients?status=ACTIVE[&risk=high]`) is honored on the very first
  // render, never overwritten by a default-then-correct effect.
  const [searchParams, setSearchParams] = useSearchParams()
  const statusFilter = parseStatusParam(searchParams.get('status'))
  const riskFilter = parseRiskParam(searchParams.get('risk'))

  const setStatusFilter = (value: PatientLifecycleFilter) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (value === 'ALL') next.delete('status')
      else next.set('status', value)
      return next
    }, { replace: true })
  }
  const setRiskFilter = (value: RiskLevel | 'all') => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (value === 'all') next.delete('risk')
      else next.set('risk', value)
      return next
    }, { replace: true })
  }

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
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

  // Z8 §24 — changing the lifecycle filter resets pagination exactly like
  // risk/search already do above — this is a genuine server-side filter
  // (patient.repository.ts::findAll's baseWhere), never a locally-faked
  // one, so the previous page number could otherwise land past the new
  // filter's actual totalPages. Search is deliberately preserved (not
  // cleared) — same "preserve search if UX supports it" instruction as §24.
  useEffect(() => { setPage(1) }, [statusFilter])

  const { patients, total, totalPages, loading, error, refetch } = usePatients({
    page, limit: PAGE_LIMIT, search: search || undefined,
    risk: riskFilter === 'all' ? undefined : CANONICAL_RISK[riskFilter],
    status: statusFilter,
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
    <div className="ui-section-stack-tight">
      {/* Stats strip — computed over the currently loaded page only,
          since the backend doesn't expose aggregate risk counts */}
      <div className="grid grid-cols-3 sm:grid-cols-3 gap-3">
        {[
          { label: 'Total', value: total, color: 'text-foreground' },
          { label: 'Riesgo alto', value: highRiskCount, color: 'text-red-600 dark:text-red-400' },
          { label: 'Sin predicción', value: noPredictionCount, color: 'text-muted-foreground' },
        ].map(item => (
          <div key={item.label} className="bg-card rounded-xl border border-border px-4 ui-table-header-density text-center">
            <p className={cn('text-2xl font-bold', item.color)}>{item.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{item.label}</p>
          </div>
        ))}
      </div>

      {/* Filters — PRE-R2E §7 — sticky. Search/status/risk filters and
          "Nuevo paciente" all currently live in this ONE flex container, so
          the whole row sticks together rather than splitting related
          controls across layers (PRE-R2E §7/§16). See .ui-sticky-toolbar
          (index.css) for the offset/z-index rationale; background/border/
          padding added here for the same "stays readable while content
          scrolls behind it" reason as Dashboard's header.
          PRE-R2E-FIX3 — `bg-background` → `bg-background/80`, matching
          Topbar's translucent treatment exactly; blur is centralized in
          `.ui-sticky-toolbar`. Visual-only. */}
      <div
        className="ui-sticky-toolbar flex flex-col sm:flex-row gap-3 bg-background/80 border-b border-border"
        style={{ paddingTop: 'var(--ui-secondary-control-padding-y)', paddingBottom: 'var(--ui-secondary-control-padding-y)' }}
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Buscar por nombre o CURP..."
            className="w-full pl-9 pr-4 ui-control-density text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
          />
        </div>
        <div className="flex items-center gap-2">
          {/* Z8 §24 — compact lifecycle filter, same select styling as the
              existing risk filter beside it. */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as PatientLifecycleFilter)}
            className="ui-control-density px-3 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer"
          >
            {STATUS_FILTER_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={riskFilter}
            onChange={e => setRiskFilter(e.target.value as RiskLevel | 'all')}
            className="ui-control-density px-3 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer"
          >
            {RISK_FILTER_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => navigate('/patients/new')}
          className="flex items-center gap-2 bg-primary text-white px-4 ui-compact-control-density rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
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
            <p className="font-medium text-red-600 dark:text-red-400">No se pudo cargar la lista de pacientes</p>
            <p className="text-sm text-muted-foreground mt-1">{error}</p>
            <button
              onClick={refetch}
              className="mt-3 px-4 ui-compact-control-density text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
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
                  <th className="px-4 ui-table-header-density text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    <button onClick={() => toggleSort('name')} className="hover:text-foreground transition-colors">
                      Paciente <SortIcon col="name" />
                    </button>
                  </th>
                  <th className="px-4 ui-table-header-density text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">
                    <button onClick={() => toggleSort('age')} className="hover:text-foreground transition-colors">
                      Edad <SortIcon col="age" />
                    </button>
                  </th>
                  <th className="px-4 ui-table-header-density text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    <button onClick={() => toggleSort('risk')} className="hover:text-foreground transition-colors">
                      Nivel de riesgo <SortIcon col="risk" />
                    </button>
                  </th>
                  <th className="px-4 ui-table-header-density text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">
                    <button onClick={() => toggleSort('date')} className="hover:text-foreground transition-colors">
                      Última actualización <SortIcon col="date" />
                    </button>
                  </th>
                  <th className="px-4 ui-table-header-density text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden lg:table-cell">
                    Estado
                  </th>
                  <th className="px-4 ui-table-header-density" />
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
          <div className="px-4 ui-table-header-density border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>Página {page} de {totalPages} · {total} pacientes en total</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ padding: 'var(--ui-secondary-control-padding-y)' }}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ padding: 'var(--ui-secondary-control-padding-y)' }}
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
