import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { clampCivilDate, clampCivilDateToBounds, daysInMonth, parseCivilDate } from '@/lib/wheelDate'

const pad = (n: number) => String(n).padStart(2, '0')

type WheelValue = number

function WheelColumn({
  label, values, value, format = String, onChange,
}: {
  label: string
  values: WheelValue[]
  value: WheelValue
  format?: (value: WheelValue) => string
  onChange: (value: WheelValue) => void
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
        aria-activedescendant={`wheel-${columnId}-${value}`}
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
              id={`wheel-${columnId}-${item}`}
              key={item}
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

export interface WheelDatePickerProps {
  value: string
  onValueChange: (value: string) => void
  label: string
  id?: string
  min?: string
  max?: string
  minYear?: number
  maxYear?: number
  required?: boolean
  showRequiredIndicator?: boolean
  disabled?: boolean
  compact?: boolean
  hideLabel?: boolean
  className?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

/**
 * Targeted PRE-T-UX1-FIX-1 civil-date selector.
 *
 * It never constructs a Date from YYYY-MM-DD. The selected value remains a
 * literal civil date, preventing UTC/local timezone rollover for DOB and
 * filter contracts.
 */
export function WheelDatePicker({
  value, onValueChange, label, id, min, max, minYear, maxYear, required, showRequiredIndicator = true, disabled,
  compact, hideLabel, className, ...aria
}: WheelDatePickerProps) {
  const parsed = parseCivilDate(value)
  const maxParsed = max ? parseCivilDate(max) : null
  const minParsed = min ? parseCivilDate(min) : null
  const anchor = parsed ?? maxParsed ?? minParsed ?? { year: maxYear ?? minYear ?? new Date().getFullYear(), month: 1, day: 1 }
  const lower = Math.min(minYear ?? minParsed?.year ?? anchor.year - 100, parsed?.year ?? Number.POSITIVE_INFINITY)
  const upper = Math.max(maxYear ?? maxParsed?.year ?? anchor.year + 1, parsed?.year ?? Number.NEGATIVE_INFINITY)
  const years = useMemo(() => Array.from({ length: upper - lower + 1 }, (_, i) => lower + i), [lower, upper])

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(anchor)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (parsed) setDraft(parsed)
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const publish = (year: number, month: number, day: number) => {
    const candidate = clampCivilDateToBounds(clampCivilDate(year, month, day), min, max)
    const next = parseCivilDate(candidate)
    if (!next) return
    setDraft(next)
    onValueChange(candidate)
  }

  const selectedLabel = parsed ? `${pad(parsed.day)}/${pad(parsed.month)}/${parsed.year}` : 'Seleccionar fecha'
  const dayValues = Array.from({ length: daysInMonth(draft.year, draft.month) }, (_, i) => i + 1)
  const monthValues = Array.from({ length: 12 }, (_, i) => i + 1)

  return (
    <div ref={wrapperRef} id={id} className={cn('relative min-w-0', className)} aria-describedby={aria['aria-describedby']}>
      {!hideLabel && (
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {label}{required && showRequiredIndicator ? ' *' : ''}
        </label>
      )}
      <button
        type="button"
        disabled={disabled}
        aria-label={`${label}: abrir selector`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-invalid={aria['aria-invalid']}
        onClick={() => setOpen(current => !current)}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card text-foreground transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60',
          compact ? 'px-2.5 ui-secondary-control-density text-xs' : 'px-3 py-2 text-sm',
        )}
      >
        <span className={cn('truncate', !parsed && 'text-muted-foreground')}>{selectedLabel}</span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <CalendarDays className="h-4 w-4" />
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
        </span>
      </button>

      {open && (
        <div className="absolute left-0 z-[80] mt-1 w-[min(22rem,calc(100vw-2rem))] max-w-full rounded-xl border border-border bg-card p-3 shadow-xl">
          <div className="grid grid-cols-3 gap-2" aria-label={`${label}: Día Mes Año`}>
            <WheelColumn label="Día" values={dayValues} value={Math.min(draft.day, dayValues.length)}
              format={pad} onChange={day => publish(draft.year, draft.month, day)} />
            <WheelColumn label="Mes" values={monthValues} value={draft.month}
              format={pad} onChange={month => publish(draft.year, month, draft.day)} />
            <WheelColumn label="Año" values={years} value={draft.year}
              onChange={year => publish(year, draft.month, draft.day)} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            {!required ? (
              <button type="button" className="text-xs text-muted-foreground underline hover:text-foreground" onClick={() => { onValueChange(''); setOpen(false) }}>
                Limpiar
              </button>
            ) : <span />}
            <button type="button" className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white" onClick={() => setOpen(false)}>
              Listo
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
