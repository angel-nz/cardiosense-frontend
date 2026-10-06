import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Clock3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatTime12, parseTime24, toTime24, type Meridiem, type Time12Value } from '@/lib/wheelTime'

const HOUR_VALUES = Array.from({ length: 12 }, (_, index) => index + 1)
const MINUTE_VALUES = Array.from({ length: 60 }, (_, index) => index)
const PERIOD_VALUES: Meridiem[] = ['AM', 'PM']
const pad = (value: number) => String(value).padStart(2, '0')

function TimeWheelColumn<T extends number | Meridiem>({
  label,
  values,
  value,
  format,
  onChange,
}: {
  label: string
  values: T[]
  value: T
  format: (value: T) => string
  onChange: (value: T) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const selected = ref.current?.querySelector<HTMLElement>(`[data-wheel-value="${value}"]`)
    selected?.scrollIntoView?.({ block: 'center' })
  }, [value, values.length])

  const scrollByRows = (rows: number) => {
    ref.current?.scrollBy({ top: rows * 32, behavior: 'smooth' })
  }

  const scrollToEdge = (edge: 'start' | 'end') => {
    const root = ref.current
    if (!root) return
    root.scrollTo({ top: edge === 'start' ? 0 : root.scrollHeight, behavior: 'smooth' })
  }

  const columnId = label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        ref={ref}
        role="listbox"
        tabIndex={0}
        aria-label={label}
        aria-activedescendant={`time-wheel-${columnId}-${value}`}
        onKeyDown={event => {
          if (event.key === 'ArrowUp') { event.preventDefault(); scrollByRows(-1) }
          if (event.key === 'ArrowDown') { event.preventDefault(); scrollByRows(1) }
          if (event.key === 'PageUp') { event.preventDefault(); scrollByRows(-5) }
          if (event.key === 'PageDown') { event.preventDefault(); scrollByRows(5) }
          if (event.key === 'Home') { event.preventDefault(); scrollToEdge('start') }
          if (event.key === 'End') { event.preventDefault(); scrollToEdge('end') }
        }}
        className="h-36 overflow-y-auto rounded-lg border border-border bg-card px-1 py-10 text-center outline-none scroll-smooth snap-y snap-mandatory focus-visible:ring-2 focus-visible:ring-primary"
      >
        {values.map(item => {
          const selected = item === value
          return (
            <button
              id={`time-wheel-${columnId}-${item}`}
              key={String(item)}
              type="button"
              role="option"
              aria-selected={selected}
              data-wheel-value={item}
              tabIndex={-1}
              onClick={() => onChange(item)}
              className={cn(
                'block h-8 w-full snap-center rounded-md px-1 text-sm transition-colors',
                selected
                  ? 'bg-primary text-white font-semibold shadow-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {format(item)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export interface WheelTimePickerProps {
  value: string
  onValueChange: (value: string) => void
  label: string
  id?: string
  required?: boolean
  showRequiredIndicator?: boolean
  disabled?: boolean
  className?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

/**
 * PRE-T-UX1-FIX-3 12-hour wheel selector.
 *
 * Navigation is deliberately separate from committed selection: scrolling or
 * keyboard navigation never invokes onValueChange. A value is committed only
 * by an explicit click/tap on an hour, minute, or period option.
 */
export function WheelTimePicker({
  value,
  onValueChange,
  label,
  id,
  required,
  showRequiredIndicator = true,
  disabled,
  className,
  ...aria
}: WheelTimePickerProps) {
  const parsed = parseTime24(value)
  const anchor: Time12Value = parsed ?? { hour: 12, minute: 0, period: 'PM' }
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [open])

  const publish = (next: Time12Value) => {
    const value24 = toTime24(next)
    if (value24) onValueChange(value24)
  }

  return (
    <div ref={wrapperRef} id={id} className={cn('relative min-w-0', className)} aria-describedby={aria['aria-describedby']}>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}{required && showRequiredIndicator ? ' *' : ''}
      </label>
      <button
        type="button"
        disabled={disabled}
        aria-label={`${label}: abrir selector`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-invalid={aria['aria-invalid']}
        aria-required={required || undefined}
        onClick={() => setOpen(current => !current)}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors',
          'hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60',
        )}
      >
        <span className={cn('truncate', !parsed && 'text-muted-foreground')}>{formatTime12(value)}</span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <Clock3 className="h-4 w-4" />
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
        </span>
      </button>

      {open && (
        <div className="absolute right-0 z-[80] mt-1 w-[min(21rem,calc(100vw-2rem))] max-w-full rounded-xl border border-border bg-card p-3 shadow-xl">
          <div className="grid grid-cols-3 gap-2" aria-label={`${label}: Hora Minuto Período`}>
            <TimeWheelColumn label="Hora" values={HOUR_VALUES} value={anchor.hour}
              format={value => String(value)} onChange={hour => publish({ ...anchor, hour })} />
            <TimeWheelColumn label="Minuto" values={MINUTE_VALUES} value={anchor.minute}
              format={pad} onChange={minute => publish({ ...anchor, minute })} />
            <TimeWheelColumn label="Período" values={PERIOD_VALUES} value={anchor.period}
              format={period => period === 'AM' ? 'a. m.' : 'p. m.'} onChange={period => publish({ ...anchor, period })} />
          </div>
          <div className="mt-3 flex justify-end">
            <button type="button" className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white" onClick={() => setOpen(false)}>
              Listo
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
