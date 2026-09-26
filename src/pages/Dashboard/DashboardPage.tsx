import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Users, Bell, Activity, AlertTriangle, Loader2 } from 'lucide-react'
import { StatCard } from '@/components/ui/StatCard'
import { cn } from '@/lib/utils'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { usePatients } from '@/hooks/usePatients'
import { useAlerts } from '@/context/AlertsContext'
import { dashboardService } from '@/services/dashboardService'
import { patientService } from '@/services/patientService'
import { DashboardCalendar } from '@/components/dashboard/DashboardCalendar'
import { useSocket } from '@/context/SocketContext'
import { getTodayBusinessDateKey } from '@/lib/businessDate'
import type { DashboardMetrics, DashboardStatNavigationIntent } from '@/types'

// U2.2 — same coalescing window already validated for DashboardCalendar
// (O4.2)/PatientCalendar (P5). Independent timers per U2.1's explicit
// requirement: dashboard_activity_changed (stats) and patient_created
// (patient total) are unrelated signals with unrelated canonical sources —
// coalescing one must never delay or drop the other.
const REALTIME_COALESCE_MS = 400

// Bounded, single-page sample used only for the "high-risk patients"
// spotlight list below — NOT a global count. The KPI "Riesgo alto" and the
// "Distribución de riesgo" panel now use the real, médico-scoped aggregate
// from GET /api/dashboard/stats (Bloque I) instead.
// (HIGH_RISK_SAMPLE_LIMIT removed — O3-FIX-2 removed the "Pacientes de
// alto riesgo" spotlight card that used it; only `total`/`error` from
// usePatients() are still needed, for the "Total pacientes" KPI below.)

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

  // GET /api/patients — `total` here is a real, backend-computed global
  // count (patientService.list -> paginate()), safe to use as-is for the
  // INITIAL "Total pacientes" KPI value. The `patients` array/loading flag
  // are no longer consumed here (O3-FIX-2 removed the "Pacientes de alto
  // riesgo" card that used them) — default params, since only
  // `total`/`error` matter now. Left completely unmodified/unextended
  // (U2.2 Option B) — realtime silent refreshes below use their own
  // minimal loader instead, so this hook's existing behavior/callers
  // elsewhere are never at risk of regressing.
  const { total: initialTotalPatients, error: patientsError } = usePatients()

  // U2.2 — mirrors usePatients()'s initial value, then independently
  // updated by loadPatientTotal(silent) below on patient_created/reconnect.
  const [totalPatients, setTotalPatients] = useState(0)
  useEffect(() => { setTotalPatients(initialTotalPatients) }, [initialTotalPatients])

  // Reuses the already-mounted global AlertsContext (fetched once at app
  // root) — visiting the Dashboard does NOT trigger an additional
  // GET /api/alerts request. unreadCount is backend-computed across ALL of
  // the doctor's alerts (not just the loaded page), safe to use directly.
  // Already fully realtime via lastAlert (U2.1) — untouched by U2.2.
  const { unreadCount, error: alertsError } = useAlerts()

  // U2.2 — passive listener only: this page never calls subscribe_patient.
  // dashboard_activity_changed/patient_created both already arrive via the
  // user:{userId} room every authenticated socket auto-joins on connect.
  const { connected, lastDashboardActivity, clearLastDashboardActivity, lastPatientCreated, clearLastPatientCreated } = useSocket()

  // GET /api/dashboard/stats (Bloque I) — predictionsToday, riskDistribution
  // (highRiskPatients included), predictionsThisWeek. Medico-scoped
  // server-side; a single request covers all four metrics.
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)
  const [metricsError, setMetricsError] = useState<string | null>(null)
  const statsRequestIdRef = useRef(0)
  const statsCoalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statsHasConnectedOnceRef = useRef(false)

  // silent=true (realtime/reconnect-triggered): fetch and replace `metrics`
  // exactly as normal, but never toggle the loading spinner and never
  // surface a fetch error — a background sync failing shouldn't blank out
  // already-valid, already-visible KPI cards. The initial mount load below
  // always calls this non-silent.
  const loadStats = useCallback(async (silent = false) => {
    const requestId = ++statsRequestIdRef.current
    if (!silent) { setMetricsLoading(true); setMetricsError(null) }
    try {
      const data = await dashboardService.getStats()
      if (requestId !== statsRequestIdRef.current) return
      setMetrics(data)
    } catch {
      if (requestId !== statsRequestIdRef.current || silent) return
      setMetricsError('No se pudieron cargar las métricas.')
    } finally {
      if (requestId === statsRequestIdRef.current && !silent) setMetricsLoading(false)
    }
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  const scheduleStatsRefresh = useCallback(() => {
    if (statsCoalesceTimerRef.current) clearTimeout(statsCoalesceTimerRef.current)
    statsCoalesceTimerRef.current = setTimeout(() => {
      statsCoalesceTimerRef.current = null
      loadStats(true)
    }, REALTIME_COALESCE_MS)
  }, [loadStats])

  // dashboard_activity_changed — canonical refetch only, never a manually
  // recomputed predictionsToday/riskDistribution/etc. from the (intentionally
  // minimal) socket payload.
  useEffect(() => {
    if (!lastDashboardActivity) return
    scheduleStatsRefresh()
    clearLastDashboardActivity()
  }, [lastDashboardActivity, scheduleStatsRefresh, clearLastDashboardActivity])

  // U2.2 — Total pacientes realtime. Independent, minimal canonical loader
  // (Option B from U2.1/section 12) — deliberately NOT usePatients().refetch(),
  // which has no silent mode and would flicker the KPI's loading state.
  // limit:1 keeps the request minimal; `total` is backend-computed
  // independent of `limit`.
  const patientTotalRequestIdRef = useRef(0)
  const patientTotalCoalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const patientsHasConnectedOnceRef = useRef(false)

  const loadPatientTotal = useCallback(async () => {
    const requestId = ++patientTotalRequestIdRef.current
    try {
      const result = await patientService.list({ limit: 1 })
      if (requestId !== patientTotalRequestIdRef.current) return
      setTotalPatients(result.total)
    } catch {
      // Silent failure only (this loader is never called non-silently —
      // the initial value already comes from usePatients() above) — keep
      // whatever total is currently shown.
    }
  }, [])

  const schedulePatientTotalRefresh = useCallback(() => {
    if (patientTotalCoalesceTimerRef.current) clearTimeout(patientTotalCoalesceTimerRef.current)
    patientTotalCoalesceTimerRef.current = setTimeout(() => {
      patientTotalCoalesceTimerRef.current = null
      loadPatientTotal()
    }, REALTIME_COALESCE_MS)
  }, [loadPatientTotal])

  // patient_created — canonical refetch only, never a manual `total + 1`.
  useEffect(() => {
    if (!lastPatientCreated) return
    schedulePatientTotalRefresh()
    clearLastPatientCreated()
  }, [lastPatientCreated, schedulePatientTotalRefresh, clearLastPatientCreated])

  // Reconnect resync — independent hasConnectedOnceRef per signal (stats vs
  // patient total), same reasoning as DashboardCalendar/PatientCalendar:
  // `connected` also becomes true on the very first successful connection —
  // skip exactly that one occurrence (the mount-driven loads above already
  // cover it); every SUBSEQUENT true is a genuine reconnect, during which
  // any dashboard_activity_changed/patient_created emitted while offline
  // was simply lost (Socket.IO does not replay it) — silent canonical
  // resync of BOTH is the only way to converge.
  useEffect(() => {
    if (!connected) return
    if (!statsHasConnectedOnceRef.current) { statsHasConnectedOnceRef.current = true }
    else scheduleStatsRefresh()
    if (!patientsHasConnectedOnceRef.current) { patientsHasConnectedOnceRef.current = true }
    else schedulePatientTotalRefresh()
  }, [connected, scheduleStatsRefresh, schedulePatientTotalRefresh])

  // Cleanup pending timers on unmount — no setState after this page is gone.
  useEffect(() => {
    return () => {
      if (statsCoalesceTimerRef.current) clearTimeout(statsCoalesceTimerRef.current)
      if (patientTotalCoalesceTimerRef.current) clearTimeout(patientTotalCoalesceTimerRef.current)
    }
  }, [])

  // (highRiskSample removed — O3-FIX-2 removed the "Pacientes de alto
  // riesgo" spotlight card. KPI cards/charts above are untouched.)
  // (Recent Alerts derived list removed — O3-FIX replaced that Dashboard
  // section with DashboardCalendar. AlertsContext/alertService/AlertsPage
  // and the "Alertas activas" KPI above are untouched.)

  const weekMaxCount = useMemo(
    () => Math.max(1, ...(metrics?.predictionsThisWeek.map(d => d.count) ?? [0])),
    [metrics],
  )
  const riskTotal = metrics
    ? metrics.riskDistribution.high + metrics.riskDistribution.moderate + metrics.riskDistribution.low
    : 0

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches'

  // X2 — keeps the `{ state: { dashboardStatNav } }` shape in exactly one
  // place, mirroring DashboardCalendar's own navigateToPatientTarget
  // helper (O3-FIX-4) for the analogous DashboardEventNavigationState
  // convention. Intent is omitted entirely for the plain Patients card
  // (no filter requested — a bare navigate, never a stale/empty payload).
  const goToWithStatNav = useCallback((path: string, intent?: DashboardStatNavigationIntent) => {
    navigate(path, intent ? { state: { dashboardStatNav: intent } } : undefined)
  }, [navigate])

  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {greeting}, Dr. {user?.firstName ?? 'Doctor'}
          </h1>
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
          title="Pacientes"
          value={patientsError ? '—' : totalPatients}
          subtitle={patientsError ? 'No se pudo cargar' : 'Bajo tu cuidado'}
          icon={Users}
          iconColor="text-blue-600"
          iconBg="bg-blue-50"
          onClick={() => goToWithStatNav('/patients')}
        />
        <StatCard
          title="Notificaciones"
          value={alertsError ? '—' : unreadCount}
          subtitle={alertsError ? 'No se pudo cargar' : 'Pendientes'}
          icon={Bell}
          iconColor="text-red-600"
          iconBg="bg-red-50"
          onClick={() => goToWithStatNav('/alerts', { kind: 'ALERTS_UNREAD' })}
        />
        <StatCard
          title="Predicciones"
          value={metricsLoading ? '…' : metricsError ? '—' : metrics!.predictionsToday}
          subtitle={metricsError ? 'No se pudo cargar' : 'Hoy'}
          icon={Activity}
          iconColor="text-teal-600"
          iconBg="bg-teal-50"
          onClick={() => goToWithStatNav('/predictions', {
            kind: 'PREDICTIONS_TODAY',
            businessDateKey: getTodayBusinessDateKey(),
          })}
        />
        <StatCard
          title="Riesgo alto"
          value={metricsLoading ? '…' : metricsError ? '—' : metrics!.highRiskPatients}
          subtitle={metricsError ? 'No se pudo cargar' : 'Pacientes'}
          icon={AlertTriangle}
          iconColor="text-amber-600"
          iconBg="bg-amber-50"
          onClick={() => goToWithStatNav('/patients', { kind: 'PATIENTS_HIGH' })}
        />
      </div>

      {/* ── Charts Row ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Weekly predictions — GET /api/dashboard/stats, medico-scoped,
            lunes–domingo en America/Mexico_City (Bloque I). */}
        <div className="lg:col-span-2 bg-card rounded-xl border border-border p-5">
          <div className="mb-4">
            <h3 className="font-semibold text-foreground">Predicciones de la semana</h3>
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
            <h3 className="font-semibold text-foreground">Pacientes con riesgo</h3>
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

      {/* Dashboard Calendar (O3-FIX-2) — now the entire longitudinal
          section: DashboardCalendar owns its own internal two-column
          layout (calendar pane + selected-day events pane), replacing
          both the old single-card placement (O3-FIX) and the removed
          "Pacientes de alto riesgo" card entirely. No realtime/polling
          added (O4 still pending). */}
      <DashboardCalendar />
    </div>
  )
}
