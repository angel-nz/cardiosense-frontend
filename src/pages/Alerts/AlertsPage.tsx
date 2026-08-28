import { useState } from 'react'
import { Bell, CheckCheck, AlertTriangle, Info, Search, Loader2 } from 'lucide-react'
import { cn, SEVERITY_CONFIG, timeAgo, formatScore } from '@/lib/utils'
import type { AlertSeverity } from '@/types'
import { useNavigate } from 'react-router-dom'
import { useAlerts } from '@/context/AlertsContext'

const FILTER_OPTIONS: Array<{ value: AlertSeverity | 'all'; label: string; icon: React.ElementType }> = [
  { value: 'all',      label: 'Todas',       icon: Bell },
  { value: 'critical', label: 'Críticas',    icon: AlertTriangle },
  { value: 'warning',  label: 'Advertencias', icon: AlertTriangle },
  { value: 'info',     label: 'Información', icon: Info },
]

export default function AlertsPage() {
  const navigate = useNavigate()
  const { alerts, unreadCount, loading, error, refetch, markAsRead, markAllRead } = useAlerts()
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | 'all'>('all')
  const [readFilter, setReadFilter] = useState<'all' | 'unread' | 'read'>('all')
  const [search, setSearch] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const filtered = alerts.filter(a => {
    if (severityFilter !== 'all' && a.severity !== severityFilter) return false
    if (readFilter === 'unread' && a.isRead) return false
    if (readFilter === 'read' && !a.isRead) return false
    if (search && !a.patientName.toLowerCase().includes(search.toLowerCase()) &&
        !a.message.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const handleMarkAsRead = async (id: string) => {
    setActionError(null)
    try {
      await markAsRead(id)
    } catch {
      setActionError('No se pudo marcar la alerta como leída. Intenta de nuevo.')
    }
  }

  const handleMarkAllRead = async () => {
    setActionError(null)
    try {
      await markAllRead()
    } catch {
      setActionError('No se pudieron marcar todas las alertas como leídas. Intenta de nuevo.')
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin mb-3" />
        <p className="text-sm text-muted-foreground">Cargando alertas...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <AlertTriangle className="w-10 h-10 text-red-400 mb-3" />
        <p className="font-medium text-foreground">{error}</p>
        <button
          onClick={refetch}
          className="mt-4 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
        >
          Reintentar
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Centro de Alertas</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {unreadCount > 0
              ? <><span className="text-red-600 font-semibold">{unreadCount} alertas sin leer</span> · {alerts.length} en total</>
              : `${alerts.length} alertas · Todo al día`
            }
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-accent transition-colors"
          >
            <CheckCheck className="w-4 h-4" />
            Marcar todas como leídas
          </button>
        )}
      </div>

      {actionError && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
          <p className="text-xs text-red-700">{actionError}</p>
        </div>
      )}

      {/* Severity summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Críticas',     count: alerts.filter(a => a.severity === 'critical').length, color: 'text-red-600',   bg: 'bg-red-50',   border: 'border-red-200',   dot: 'bg-red-500' },
          { label: 'Advertencias', count: alerts.filter(a => a.severity === 'warning').length,  color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500' },
          { label: 'Informativas', count: alerts.filter(a => a.severity === 'info').length,     color: 'text-blue-600',  bg: 'bg-blue-50',  border: 'border-blue-200',  dot: 'bg-blue-500' },
          { label: 'Sin leer',     count: unreadCount,                                          color: 'text-foreground',bg: 'bg-card',     border: 'border-border',    dot: 'bg-gray-400' },
        ].map(item => (
          <div key={item.label} className={cn('rounded-xl border px-4 py-3 text-center', item.bg, item.border)}>
            <div className="flex items-center justify-center gap-1.5">
              <div className={cn('w-2 h-2 rounded-full', item.dot)} />
              <p className={cn('text-2xl font-bold', item.color)}>{item.count}</p>
            </div>
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
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por paciente o mensaje..."
            className="w-full pl-9 pr-4 py-2.5 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
          />
        </div>
        <div className="flex items-center gap-2">
          {FILTER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setSeverityFilter(opt.value)}
              className={cn(
                'px-3 py-2 text-xs font-medium rounded-lg border transition-colors',
                severityFilter === opt.value
                  ? 'bg-primary text-white border-primary'
                  : 'border-border text-muted-foreground hover:bg-accent',
              )}
            >
              {opt.label}
            </button>
          ))}
          <div className="w-px h-6 bg-border" />
          <select
            value={readFilter}
            onChange={e => setReadFilter(e.target.value as typeof readFilter)}
            className="py-2 px-3 text-xs rounded-lg border border-border bg-card focus:outline-none cursor-pointer"
          >
            <option value="all">Todas</option>
            <option value="unread">Sin leer</option>
            <option value="read">Leídas</option>
          </select>
        </div>
      </div>

      {/* Alert list */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Bell className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="font-medium text-foreground">Sin alertas</p>
            <p className="text-sm text-muted-foreground mt-1">No hay alertas que coincidan con los filtros seleccionados</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map(alert => {
              const cfg = SEVERITY_CONFIG[alert.severity]
              return (
                <div
                  key={alert.id}
                  className={cn(
                    'flex items-start gap-4 px-5 py-4 transition-colors',
                    !alert.isRead && 'bg-blue-50/30',
                    'hover:bg-accent/50 cursor-pointer',
                  )}
                  onClick={() => { handleMarkAsRead(alert.id); navigate(`/patients/${alert.patientId}`) }}
                >
                  {/* Severity indicator */}
                  <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5', cfg.bg, `border ${cfg.border}`)}>
                    <AlertTriangle className={cn('w-4 h-4', cfg.text)} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn('text-xs font-bold uppercase tracking-wide', cfg.text)}>
                        {cfg.label}
                      </span>
                      {!alert.isRead && (
                        <span className="w-2 h-2 rounded-full bg-blue-500" title="Sin leer" />
                      )}
                      {alert.riskScore !== undefined && (
                        <span className="text-xs text-muted-foreground font-mono">
                          Score: {formatScore(alert.riskScore)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-foreground mt-0.5">{alert.patientName}</p>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{alert.message}</p>
                    <p className="text-xs text-muted-foreground mt-2">{timeAgo(alert.createdAt)}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    {!alert.isRead && (
                      <button
                        onClick={e => { e.stopPropagation(); handleMarkAsRead(alert.id) }}
                        className="p-1.5 rounded-lg hover:bg-accent transition-colors"
                        title="Marcar como leída"
                      >
                        <CheckCheck className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {filtered.length > 0 && (
          <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground">
            Mostrando {filtered.length} de {alerts.length} alertas
          </div>
        )}
      </div>
    </div>
  )
}
