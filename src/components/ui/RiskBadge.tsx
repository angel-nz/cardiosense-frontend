import { cn, RISK_CONFIG, formatScore } from '@/lib/utils'
import type { RiskLevel } from '@/types'
import { TrendingDown, TrendingUp, Minus } from 'lucide-react'

interface RiskBadgeProps {
  level: RiskLevel
  score?: number
  size?: 'sm' | 'md' | 'lg'
  showScore?: boolean
  className?: string
}

const ICONS: Record<RiskLevel, React.ElementType> = {
  low: TrendingDown,
  moderate: Minus,
  high: TrendingUp,
}

export function RiskBadge({ level, score, size = 'md', showScore = false, className }: RiskBadgeProps) {
  const cfg = RISK_CONFIG[level]
  const Icon = ICONS[level]

  const sizeClasses = {
    sm: 'text-[10px] px-2 py-0.5 gap-1',
    md: 'text-xs px-2.5 py-1 gap-1.5',
    lg: 'text-sm px-3 py-1.5 gap-2',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center font-semibold rounded-full border',
        cfg.bg, cfg.text, cfg.border,
        sizeClasses[size],
        className,
      )}
    >
      <Icon className={cn(size === 'sm' ? 'w-2.5 h-2.5' : 'w-3.5 h-3.5')} />
      {cfg.label}
      {showScore && score !== undefined && (
        <span className="font-mono">{formatScore(score)}</span>
      )}
    </span>
  )
}
