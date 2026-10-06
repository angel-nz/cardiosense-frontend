import type { HealthRecord, Sex } from '../../types'
import {
  CLINICAL_INDICATORS, classifyClinicalIndicator, isClinicalValue,
  type ClinicalIndicatorBand,
} from '../../lib/clinicalIndicators'

// Existing Tailwind palette and foreground/border tokens, with readable text in both themes.
export const CLINICAL_BAND_STYLES: Record<ClinicalIndicatorBand, { tone: string; className: string; statusClassName: string }> = {
  LOW: { tone: 'info', className: 'border-blue-500 dark:border-blue-400', statusClassName: 'text-blue-800 dark:text-blue-300' },
  NORMAL: { tone: 'neutral', className: 'border-border', statusClassName: 'text-foreground' },
  HIGH: { tone: 'warning', className: 'border-amber-500 dark:border-amber-400', statusClassName: 'text-amber-800 dark:text-amber-300' },
  VERY_HIGH: { tone: 'danger', className: 'border-red-500 dark:border-red-400', statusClassName: 'text-red-800 dark:text-red-300' },
}

type IndicatorRecord = Partial<Pick<HealthRecord, 'sysBP' | 'diaBP' | 'totChol' | 'bmi' | 'glucose'>>

export function ClinicalIndicators({ record, sex }: {
  record: IndicatorRecord | null | undefined
  sex: Sex | null | undefined
}) {
  return <>
    <dl className="grid grid-cols-2 gap-3" aria-label="Rangos de indicadores clínicos">
      {CLINICAL_INDICATORS.map(item => {
        const value = record?.[item.field]
        const result = classifyClinicalIndicator(item.indicator, value, sex)
        const style = result ? CLINICAL_BAND_STYLES[result.band] : CLINICAL_BAND_STYLES.NORMAL
        return <div key={item.indicator} data-indicator={item.indicator}
          data-band={result?.band} data-tone={style.tone}
          data-surface="neutral" className={`rounded-xl border bg-card text-foreground p-4 ${style.className}`}>
          <dt className="text-xs font-medium">{item.name}</dt>
          <dd className="text-2xl font-bold font-mono mt-1">
            {isClinicalValue(value) ? value : '—'}
            <span className="block text-xs font-normal font-sans mt-1">{item.unit}</span>
          </dd>
          <dd className={`text-xs font-semibold mt-2 ${style.statusClassName}`}>
            {result?.label ?? (isClinicalValue(value) ? 'Rango no disponible' : 'Sin datos')}
          </dd>
        </div>
      })}
    </dl>
  </>
}
