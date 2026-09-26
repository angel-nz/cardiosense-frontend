import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

interface StatCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon: LucideIcon
  iconColor?: string
  iconBg?: string
  trend?: {
    value: number
    label: string
    positive?: boolean
  }
  className?: string
  // X2 — optional click handler. When present, the card's root element
  // renders as a native <button type="button"> instead of a plain <div> —
  // real focus/hover/Enter-Space activation for free, the exact same
  // convention already used by the calendar event rows
  // (PatientCalendar.tsx/DashboardCalendar.tsx's EventRowShell/shell) —
  // rather than a clickable div with emulated role/tabIndex. Layout,
  // padding, and all existing title/value/subtitle/icon/trend rendering
  // are unchanged either way. Omitted → StatCard stays exactly as
  // non-interactive as before.
  onClick?: () => void
}

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = 'text-primary',
  iconBg = 'bg-primary/10',
  trend,
  className,
  onClick,
}: StatCardProps) {
  const content = (
    <div className="flex items-start justify-between">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-muted-foreground font-medium">{title}</p>
        <p className="text-3xl font-bold text-foreground mt-1 leading-none">{value}</p>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1.5">{subtitle}</p>
        )}
        {trend && (
          <div className="flex items-center gap-1 mt-2">
            <span
              className={cn(
                'text-xs font-medium',
                trend.positive ? 'text-teal-600' : 'text-red-600',
              )}
            >
              {trend.positive ? '+' : ''}{trend.value}%
            </span>
            <span className="text-xs text-muted-foreground">{trend.label}</span>
          </div>
        )}
      </div>
      <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0', iconBg)}>
        <Icon className={cn('w-6 h-6', iconColor)} />
      </div>
    </div>
  )

  // X2 — cursor/hover/focus affordance applied ONLY when the card is
  // actually interactive (onClick present); a non-interactive StatCard
  // keeps its exact pre-X2 appearance (base `.stat-card` class already
  // carries `hover:shadow-md` unconditionally — untouched, not new).
  const classes = cn(
    'stat-card w-full',
    onClick && 'text-left cursor-pointer hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 transition-colors',
    className,
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {content}
      </button>
    )
  }

  return <div className={classes}>{content}</div>
}
