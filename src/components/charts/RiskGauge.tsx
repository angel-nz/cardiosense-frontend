import { cn, RISK_CONFIG, getRiskLevel, formatScore } from '@/lib/utils'

interface RiskGaugeProps {
  score: number
  size?: number
  showLabel?: boolean
  className?: string
}

export function RiskGauge({ score, size = 160, showLabel = true, className }: RiskGaugeProps) {
  const level = getRiskLevel(score)
  const cfg = RISK_CONFIG[level]

  // SVG arc math
  const r = 54
  const cx = 80
  const cy = 80
  const startAngle = -210
  const totalAngle = 240
  const angle = startAngle + totalAngle * score

  function polarToXY(angleDeg: number, radius: number) {
    const rad = (angleDeg * Math.PI) / 180
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
    }
  }

  function describeArc(startDeg: number, endDeg: number, radius: number) {
    const s = polarToXY(startDeg, radius)
    const e = polarToXY(endDeg, radius)
    const large = endDeg - startDeg > 180 ? 1 : 0
    return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${large} 1 ${e.x} ${e.y}`
  }

  const trackPath = describeArc(startAngle, startAngle + totalAngle, r)
  const fillPath  = describeArc(startAngle, Math.min(angle, startAngle + totalAngle - 0.01), r)

  const needle = polarToXY(angle, r - 10)

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <svg width={size} height={size * 0.8} viewBox="0 0 160 128">
        {/* Track */}
        <path
          d={trackPath}
          fill="none"
          stroke="#E5E7EB"
          strokeWidth={10}
          strokeLinecap="round"
        />
        {/* Colored fill */}
        <path
          d={fillPath}
          fill="none"
          stroke={cfg.color}
          strokeWidth={10}
          strokeLinecap="round"
          style={{ transition: 'stroke 0.4s ease' }}
        />
        {/* Needle dot */}
        <circle
          cx={needle.x}
          cy={needle.y}
          r={5}
          fill={cfg.color}
          style={{ transition: 'all 0.4s ease' }}
        />
        {/* Center score */}
        <text
          x={cx}
          y={cy + 4}
          textAnchor="middle"
          dominantBaseline="middle"
          className="font-mono font-bold"
          fontSize={20}
          fill={cfg.color}
        >
          {formatScore(score)}
        </text>
        {showLabel && (
          <text
            x={cx}
            y={cy + 22}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={10}
            fill="#6B7280"
          >
            riesgo {cfg.label.toLowerCase()}
          </text>
        )}
        {/* Min/Max labels */}
        <text x={14} y={108} fontSize={9} fill="#9CA3AF">0%</text>
        <text x={138} y={108} fontSize={9} fill="#9CA3AF" textAnchor="end">100%</text>
      </svg>
    </div>
  )
}
