import { useEffect } from 'react'
import { X, AlertTriangle, Bell } from 'lucide-react'
import { cn, SEVERITY_CONFIG } from '@/lib/utils'
import type { SocketAlert } from '@/types'
import { useNavigate } from 'react-router-dom'

interface AlertToastProps {
  alert: SocketAlert
  onClose: () => void
  autoCloseDuration?: number
}

export function AlertToast({ alert, onClose, autoCloseDuration = 8000 }: AlertToastProps) {
  const navigate = useNavigate()
  const cfg = SEVERITY_CONFIG[alert.severity]

  useEffect(() => {
    if (autoCloseDuration <= 0) return
    const t = setTimeout(onClose, autoCloseDuration)
    return () => clearTimeout(t)
  }, [autoCloseDuration, onClose])

  return (
    <div
      className={cn(
        'fixed bottom-6 right-6 z-50 w-96 max-w-[calc(100vw-3rem)]',
        'rounded-xl border shadow-xl animate-slide-in',
        cfg.bg, cfg.border,
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', cfg.bg)}>
          {alert.severity === 'critical' ? (
            <AlertTriangle className={cn('w-4 h-4', cfg.text)} />
          ) : (
            <Bell className={cn('w-4 h-4', cfg.text)} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn('text-xs font-bold uppercase tracking-wide', cfg.text)}>
              {cfg.label}
            </span>
            <span className={cn('w-1.5 h-1.5 rounded-full', cfg.dot)} />
            <span className="text-xs text-muted-foreground">Tiempo real</span>
          </div>
          <p className="text-sm font-semibold text-foreground">{alert.patientName}</p>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{alert.message}</p>
          <button
            onClick={() => { navigate('/alerts'); onClose() }}
            className={cn('text-xs font-medium mt-2 hover:underline', cfg.text)}
          >
            Ver alerta →
          </button>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-black/5 transition-colors flex-shrink-0"
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>
      {/* Barra de progreso */}
      <div className="h-1 bg-black/10 rounded-b-xl overflow-hidden">
        <div
          className={cn('h-full', cfg.dot)}
          style={{ animation: `shrink ${autoCloseDuration}ms linear forwards` }}
        />
      </div>
      <style>{`@keyframes shrink { from { width: 100% } to { width: 0% } }`}</style>
    </div>
  )
}
