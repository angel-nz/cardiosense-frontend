import { cn } from '@/lib/utils'

interface FeatureImportanceBarProps {
  data: Record<string, number>
  className?: string
  maxItems?: number
}

const FEATURE_LABELS: Record<string, string> = {
  age:           'Edad',
  sysBP:         'Presión sistólica',
  totChol:       'Colesterol total',
  BMI:           'Índice de masa corporal',
  glucose:       'Glucosa',
  currentSmoker: 'Fumador activo',
  diaBP:         'Presión diastólica',
  cigsPerDay:    'Cigarrillos/día',
  BPMeds:        'Medicación HTA',
  diabetes:      'Diabetes',
  male:           'Sexo masculino',
}

const BAR_COLORS = [
  'bg-blue-500',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-purple-500',
  'bg-fuchsia-500',
  'bg-pink-500',
  'bg-rose-500',
  'bg-teal-500',
]

export function FeatureImportanceBar({ data, className, maxItems = 11 }: FeatureImportanceBarProps) {
  const sorted = Object.entries(data)
    .sort(([, a], [, b]) => b - a)
    .slice(0, maxItems)

  const max = sorted[0]?.[1] ?? 0

  return (
    <div className={cn('space-y-3', className)}>
      {sorted.map(([key, value], i) => {
        const pct = max > 0 ? (value / max) * 100 : 0
        const label = FEATURE_LABELS[key] ?? key

        return (
          <div key={key} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground font-medium">{label}</span>
              <span className="font-mono font-semibold text-foreground">
                {value.toFixed(1)}%
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all duration-700', BAR_COLORS[i % BAR_COLORS.length])}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
