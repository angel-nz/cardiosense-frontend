import { useState, useEffect, useMemo } from 'react'
import { Users, Bell, Activity, AlertTriangle, Heart, Loader2 } from 'lucide-react'
import { StatCard } from '@/components/ui/StatCard'
import { RiskBadge } from '@/components/ui/RiskBadge'
import { formatScore, timeAgo, SEVERITY_CONFIG, cn, calcAge } from '@/lib/utils'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { usePatients } from '@/hooks/usePatients'
import { useAlerts } from '@/context/AlertsContext'
import { dashboardService } from '@/services/dashboardService'
import type { DashboardMetrics } from '@/types'

// Bounded, single-page sample used only for the "high-risk patients"
// spotlight list below — NOT a global count. The KPI "Riesgo alto" and the
// "Distribución de riesgo" panel now use the real, médico-scoped aggregate
// from GET /api/dashboard/stats (Bloque I) instead.
const HIGH_RISK_SAMPLE_LIMIT = 20

const WEEKDAY_LABELS: Record<string, string> = {
  Mon: 'Lun', Tue: 'Mar', Wed: 'Mié', Thu: 'Jue', Fri: 'Vie', Sat: 'Sáb', Sun: 'Dom',
}

function shortWeekday(isoDate: string): string {
  // isoDate is YYYY-MM-DD as returned by the backend (local calendar date,
  // America/Mexico_City) — parsed as UTC noon to avoid any off-by-one from
  // the browser's own local timezone shifting it to the previous day.
  const d = new Date(`${isoDate}T12:00:00Z`)
  const short = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
  return WEEKDAY_LABELS[short] ?? short
}

export default function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  // GET /api/patients?page=1&limit=20 — `total` here is a real, backend-
  // computed global count (patientService.list -> paginate()), safe to use
  // as-is. The `patients` array itself is only the first page, used below
  // strictly as a bounded sample, never presented as "all patients".
  const { patients, total: totalPatients, loading: patientsLoading, error: patientsError } =
    usePatients({ limit: HIGH_RISK_SAMPLE_LIMIT })

  // Reuses the already-mounted global AlertsContext (fetched once at app
  // root) — visiting the Dashboard does NOT trigger an additional
  // GET /api/alerts request. unreadCount is backend-computed across ALL of
  // the doctor's alerts (not just the loaded page), safe to use directly.
  const { alerts, unreadCount, loading: alertsLoading, error: alertsError } = useAlerts()

  // GET /api/dashboard/stats (Bloque I) — predictionsToday, riskDistribution
  // (highRiskPatients included), predictionsThisWeek. Medico-scoped
  // server-side; a single request covers all four metrics.
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)
  const [metricsError, setMetricsError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setMetricsLoading(true)
    setMetricsError(null)
    dashboardService.getStats()
      .then(data => { if (!cancelled) setMetrics(data) })
      .catch(() => { if (!cancelled) setMetricsError('No se pudieron cargar las métricas.') })
      .finally(() => { if (!cancelled) setMetricsLoading(false) })
    return () => { cancelled = true }
  }, [])

  const highRiskSample = useMemo(
    () => patients.filter(p => p.latestRisk === 'high').slice(0, 5),
    [patients],
  )
  const recentAlerts = useMemo(() => alerts.slice(0, 3), [alerts])

  const weekMaxCount = useMemo(
    () => Math.max(1, ...(metrics?.predictionsThisWeek.map(d => d.count) ?? [0])),
    [metrics],
  )
  const riskTotal = metrics
    ? metrics.riskDistribution.high + metrics.riskDistribution.moderate + metrics.riskDistribution.low
    : 0

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches'

  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {greeting}, Dr. {user?.firstName ?? 'Doctor'}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Resumen de actividad cardiovascular de tus pacientes
          </p>
        </div>
        <button
          onClick={() => navigate('/patients/new')}
          className="hidden sm:flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Users className="w-4 h-4" />
          Nuevo paciente
        </button>
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total pacientes"
          value={patientsError ? '—' : totalPatients}
          subtitle={patientsError ? 'No se pudo cargar' : 'Bajo tu cuidado'}
          icon={Users}
          iconColor="text-blue-600"
          iconBg="bg-blue-50"
        />
        <StatCard
          title="Alertas activas"
          value={alertsError ? '—' : unreadCount}
          subtitle={alertsError ? 'No se pudo cargar' : 'Requieren atención'}
          icon={Bell}
          iconColor="text-red-600"
          iconBg="bg-red-50"
        />
        <StatCard
          title="Predicciones hoy"
          value={metricsLoading ? '…' : metricsError ? '—' : metrics!.predictionsToday}
          subtitle={metricsError ? 'No se pudo cargar' : 'Hoy'}
          icon={Activity}
          iconColor="text-teal-600"
          iconBg="bg-teal-50"
        />
        <StatCard
          title="Riesgo alto"
          value={metricsLoading ? '…' : metricsError ? '—' : metrics!.highRiskPatients}
          subtitle={metricsError ? 'No se pudo cargar' : 'Pacientes'}
          icon={AlertTriangle}
          iconColor="text-amber-600"
          iconBg="bg-amber-50"
        />
      </div>

      {/* ── Charts Row ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Weekly predictions — GET /api/dashboard/stats, medico-scoped,
            lunes–domingo en America/Mexico_City (Bloque I). */}
        <div className="lg:col-span-2 bg-card rounded-xl border border-border p-5">
          <div className="mb-4">
            <h3 className="font-semibold text-foreground">Predicciones esta semana</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Lunes a domingo</p>
          </div>
          {metricsLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
            </div>
          ) : metricsError ? (
            <p className="text-sm text-red-600 text-center py-10">{metricsError}</p>
          ) : (
            <div className="flex items-end justify-between gap-2 h-32 px-1">
              {metrics!.predictionsThisWeek.map(day => (
                <div key={day.date} className="flex-1 flex flex-col items-center gap-1.5">
                  <span className="text-xs font-mono text-muted-foreground">{day.count}</span>
                  <div
                    className={cn('w-full rounded-t-md', day.count > 0 ? 'bg-primary' : 'bg-border')}
                    style={{ height: `${Math.max(4, (day.count / weekMaxCount) * 88)}px` }}
                  />
                  <span className="text-[10px] text-muted-foreground">{shortWeekday(day.date)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Risk distribution — misma fuente que "Riesgo alto" (Bloque I):
            última Prediction de cada paciente del médico autenticado. */}
        <div className="bg-card rounded-xl border border-border p-5">
          <div className="mb-4">
            <h3 className="font-semibold text-foreground">Distribución de riesgo</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Pacientes con predicción</p>
          </div>
          {metricsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
            </div>
          ) : metricsError ? (
            <p className="text-sm text-red-600 text-center py-8">{metricsError}</p>
          ) : riskTotal === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Ningún paciente con predicción todavía.
            </p>
          ) : (
            <div className="space-y-3">
              {([
                { label: 'Alto',     count: metrics!.riskDistribution.high,     bar: 'bg-red-500' },
                { label: 'Moderado', count: metrics!.riskDistribution.moderate, bar: 'bg-amber-500' },
                { label: 'Bajo',     count: metrics!.riskDistribution.low,      bar: 'bg-teal-500' },
              ]).map(row => (
                <div key={row.label}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="font-mono font-medium text-foreground">{row.count}</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-border overflow-hidden">
                    <div
                      className={cn('h-full rounded-full', row.bar)}
                      style={{ width: `${(row.count / riskTotal) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom Row ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Recent alerts — real data from the shared AlertsContext */}
        <div className="bg-card rounded-xl border border-border">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <h3 className="font-semibold text-foreground">Alertas recientes</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Últimas notificaciones</p>
            </div>
            <button
              onClick={() => navigate('/alerts')}
              className="text-xs text-primary font-medium hover:underline"
            >
              Ver todas →
            </button>
          </div>
          {alertsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
            </div>
          ) : alertsError ? (
            <p className="text-sm text-red-600 text-center py-6">{alertsError}</p>
          ) : recentAlerts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No hay alertas recientes.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {recentAlerts.map(alert => {
                const cfg = SEVERITY_CONFIG[alert.severity]
                return (
                  <div
                    key={alert.id}
                    onClick={() => navigate('/alerts')}
                    className="flex items-start gap-3 px-5 py-3.5 hover:bg-accent/50 cursor-pointer transition-colors"
                  >
                    <div className={cn('w-2 h-2 rounded-full mt-1.5 flex-shrink-0', cfg.dot)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{alert.patientName}</p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{alert.message}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className={cn('text-[10px] font-bold uppercase', cfg.text)}>{cfg.label}</span>
                      <span className="text-[10px] text-muted-foreground">{timeAgo(alert.createdAt)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* High-risk patients — bounded sample from the first loaded page
            only (backend's `risk` filter is a documented no-op — see
            Bloque B report), explicitly NOT presented as exhaustive. */}
        <div className="bg-card rounded-xl border border-border">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <h3 className="font-semibold text-foreground">Pacientes de alto riesgo</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Entre los {HIGH_RISK_SAMPLE_LIMIT} pacientes más recientes
              </p>
            </div>
            <button
              onClick={() => navigate('/patients')}
              className="text-xs text-primary font-medium hover:underline"
            >
              Ver todos →
            </button>
          </div>
          {patientsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
            </div>
          ) : patientsError ? (
            <p className="text-sm text-red-600 text-center py-6">{patientsError}</p>
          ) : highRiskSample.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No se encontraron pacientes de alto riesgo entre los más recientes.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {highRiskSample.map(patient => (
                <div
                  key={patient.id}
                  onClick={() => navigate(`/patients/${patient.id}`)}
                  className="flex items-center gap-3 px-5 py-3.5 hover:bg-accent/50 cursor-pointer transition-colors group"
                >
                  <div className="w-9 h-9 rounded-full bg-red-50 border border-red-200 flex items-center justify-center flex-shrink-0">
                    <Heart className="w-4 h-4 text-red-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {patient.firstName} {patient.lastName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {patient.latestScore !== undefined && `${formatScore(patient.latestScore)} · `}
                      {patient.age ?? calcAge(patient.birthDate)} años
                    </p>
                  </div>
                  <RiskBadge level="high" size="sm" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
