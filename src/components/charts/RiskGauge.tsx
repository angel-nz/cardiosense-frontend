import { cn, RISK_CONFIG, formatScore } from '@/lib/utils'
import type { RiskLevel } from '@/types'

// Y6.3B §37 — RiskGauge used to be one of the components explicitly
// permitted to call useAppearance() directly, so its SVG label text could
// scale with the (now-removed) interface density/visibility preset. Y6.4B —
// that axis is gone; these are simply the gauge's permanent label sizes
// (the former Comfortable values). GAUGE DIMENSIONS (viewBox, r/cx/cy,
// strokeWidth, needle radius, the arc geometry) are unchanged.
const GAUGE_TEXT_SIZES = { centerScore: 22, riesgoLabel: 11, minMax: 10 }

interface RiskGaugeProps {
  score: number
  // V4A — canonical semantic classification, exactly as persisted on
  // Prediction.riskLevel (backend-authoritative, itself sourced from the
  // AI's own risk_thresholds.json — see prediction.service.ts). RiskGauge
  // never derives this from `score` itself: `score` only positions the
  // needle/arc and renders the numeric readout — it is NOT reclassified
  // into LOW/MODERATE/HIGH here. This keeps RiskGauge in agreement with
  // RiskBadge (which already only ever used the persisted `level`) for the
  // same Prediction, including historical Predictions whose riskLevel may
  // have been classified under a different threshold configuration than
  // whatever Skorp-Beta-0.1 uses today — that provenance is preserved
  // exactly as persisted, never silently reinterpreted here.
  level: RiskLevel
  size?: number
  showLabel?: boolean
  className?: string
}

export function RiskGauge({ score, level, size = 160, showLabel = true, className }: RiskGaugeProps) {
  const cfg = RISK_CONFIG[level]
  const textSizes = GAUGE_TEXT_SIZES

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
        {/* Y6.2 — was a hardcoded #E5E7EB (a fixed light-gray track color).
            SVG presentation attributes resolve CSS custom properties
            through the cascade, so this now follows the same --border
            token every other generic border/track already uses — no JS
            `resolvedTheme` needed for a plain neutral track. */}
        <path
          d={trackPath}
          fill="none"
          stroke="hsl(var(--border))"
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
          fontSize={textSizes.centerScore}
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
            fontSize={textSizes.riesgoLabel}
            fill="hsl(var(--muted-foreground))"
          >
            riesgo {cfg.label.toLowerCase()}
          </text>
        )}
        {/* Min/Max labels — Y6.2: same muted-foreground token, was a
            hardcoded #9CA3AF. */}
        <text x={14} y={108} fontSize={textSizes.minMax} fill="hsl(var(--muted-foreground))">0%</text>
        <text x={138} y={108} fontSize={textSizes.minMax} fill="hsl(var(--muted-foreground))" textAnchor="end">100%</text>
      </svg>
    </div>
  )
}
