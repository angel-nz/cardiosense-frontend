// V6.3 — reusable, standalone international phone input. Built and
// verified in isolation per the block's explicit scope: NOT wired into
// PatientCreatePage/EditPatientModal/PatientDetailPage yet (that's V6.4/
// V6.5). All numbering-plan logic lives in lib/phone.ts (V6.2) and
// lib/phoneInputState.ts (this block's pure derivation/transition rules,
// directly unit-tested) — this file only renders and wires DOM events to
// those functions. No libphonenumber-js object is ever exposed through
// this component's public props/state (CountryCode is a plain string
// literal type, not a class instance).
import { useEffect, useRef, useState, useId } from 'react'
import { ChevronDown, Search, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getCountryOptions, searchCountries, type CountryOption } from '@/lib/countries'
import {
  initializePhoneInput, applyNationalInput, applyCountryChange,
  type PhoneInputState,
} from '@/lib/phoneInputState'
import type { CountryCode } from '@/lib/phone'

export type { PhoneInputState, PhoneInputStatus } from '@/lib/phoneInputState'
export type { CountryCode } from '@/lib/phone'

export interface CountryPhoneInputProps {
  // The currently PERSISTED phone value (or null/undefined for none) —
  // consulted only to (re)initialize the control (V6.3 §10/§12/§19), never
  // continuously reconciled against local typing state.
  value: string | null | undefined
  // Fires on every actual user interaction (typing, country change,
  // clearing) — never on mount/reinit from a new `value` (V6.3 §12/§18).
  onChange: (state: PhoneInputState) => void
  id?: string
  label?: string
  // External (e.g. backend) validation error — rendered alongside the
  // component's own INVALID/legacy-unresolved presentation (V6.3 §14).
  error?: string
  disabled?: boolean
  className?: string
}

const baseFieldClass = (hasError?: boolean) => cn(
  'w-full px-3 py-2.5 text-sm rounded-lg border bg-card',
  'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
  'transition-all disabled:opacity-60 disabled:cursor-not-allowed',
  hasError ? 'border-red-400' : 'border-border',
)

export function CountryPhoneInput({
  value, onChange, id, label = 'Teléfono', error, disabled, className,
}: CountryPhoneInputProps) {
  const reactId = useId()
  const inputId = id ?? `phone-${reactId}`

  const init = useRef(initializePhoneInput(value)).current
  const [country, setCountry] = useState<CountryCode | null>(init.country)
  const [nationalText, setNationalText] = useState(init.nationalText)
  const [localStatus, setLocalStatus] = useState(init.state.status)
  // Tracks the raw legacy string across a country change, before the user
  // has produced a valid number — so "unresolved legacy" styling can stay
  // accurate even after a country is picked but the reinterpreted text is
  // still invalid/incomplete (V6.3 §11/§17).
  const [isUnresolvedLegacy, setIsUnresolvedLegacy] = useState(init.state.status === 'legacy' && init.country === null)

  // V6.3 §10/§19 — reinitialize ONLY when the external `value` prop
  // actually changes to something different (e.g. a different patient
  // loaded into EditPatientModal) — never on every re-render, and never by
  // reconciling against this component's own onChange output (the parent
  // is not expected to feed that back into `value` synchronously, so there
  // is no parent-value → local-state → onChange → parent-value loop here).
  const lastValueRef = useRef(value)
  useEffect(() => {
    if (value === lastValueRef.current) return
    lastValueRef.current = value
    const reinit = initializePhoneInput(value)
    setCountry(reinit.country)
    setNationalText(reinit.nationalText)
    setLocalStatus(reinit.state.status)
    setIsUnresolvedLegacy(reinit.state.status === 'legacy' && reinit.country === null)
    closeSelector()
    // Deliberately NOT calling onChange here — re-deriving display state
    // from a new persisted value is not a user edit (V6.3 §12/§18).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // ── Country selector (searchable combobox, no new dependency — V6.3 §4/§22) ──
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const options: CountryOption[] = selectorOpen ? searchCountries(query) : []
  const selectedOption = country ? getCountryOptions().find(o => o.code === country) ?? null : null

  function closeSelector() {
    setSelectorOpen(false)
    setQuery('')
    setHighlight(0)
  }

  function openSelector() {
    if (disabled) return
    setSelectorOpen(true)
    setHighlight(0)
    // Focus moves into the search box once it mounts.
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }

  function selectCountry(code: CountryCode) {
    const result = applyCountryChange(code, nationalText)
    setCountry(code)
    setNationalText(result.nationalText)
    setLocalStatus(result.state.status)
    setIsUnresolvedLegacy(false) // an explicit country pick always resolves the "unresolved" flag, even if the reinterpreted number is still invalid/incomplete — the AMBIGUITY is resolved, editing continues from here
    onChange(result.state)
    closeSelector()
    triggerRef.current?.focus()
  }

  function handleSelectorKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { closeSelector(); triggerRef.current?.focus(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, options.length - 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      const opt = options[highlight]
      if (opt) selectCountry(opt.code)
    }
  }

  // ── National number field ──
  function handleNationalChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!country) return // guarded — field is disabled until a country is resolved (see render below)
    const result = applyNationalInput(country, e.target.value)
    setNationalText(result.nationalText)
    setLocalStatus(result.state.status)
    onChange(result.state)
  }

  const showInvalid = localStatus === 'invalid' || isUnresolvedLegacy
  const hasExternalError = !!error
  const errorId = (hasExternalError || showInvalid) ? `${inputId}-error` : undefined

  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-foreground block mb-1.5">
          {label}
        </label>
      )}

      <div className="flex gap-2">
        {/* Country selector trigger */}
        <div className="relative">
          <button
            ref={triggerRef}
            type="button"
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={selectorOpen}
            aria-label="País"
            onClick={() => (selectorOpen ? closeSelector() : openSelector())}
            className={cn(
              baseFieldClass(showInvalid || hasExternalError),
              'flex items-center gap-1.5 whitespace-nowrap',
              selectedOption ? 'w-auto' : 'w-auto text-muted-foreground',
            )}
          >
            {selectedOption ? (
              <>
                <span aria-hidden="true">{selectedOption.flag}</span>
                <span>+{selectedOption.callingCode}</span>
              </>
            ) : (
              <span>{isUnresolvedLegacy ? 'País no resuelto' : 'País'}</span>
            )}
            <ChevronDown className="w-3.5 h-3.5" />
          </button>

          {selectorOpen && (
            <div
              className="absolute z-50 mt-1 w-64 bg-card border border-border rounded-lg shadow-lg overflow-hidden"
              onKeyDown={handleSelectorKeyDown}
            >
              <div className="flex items-center gap-2 px-2.5 py-2 border-b border-border">
                <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={query}
                  onChange={e => { setQuery(e.target.value); setHighlight(0) }}
                  aria-label="Buscar país"
                  placeholder="Buscar país o código..."
                  className="w-full text-sm bg-transparent focus:outline-none"
                />
              </div>
              <ul role="listbox" aria-label="Países" className="max-h-56 overflow-y-auto py-1">
                {options.length === 0 && (
                  <li className="px-3 py-2 text-xs text-muted-foreground">Sin resultados</li>
                )}
                {options.map((opt, i) => (
                  <li
                    key={opt.code}
                    role="option"
                    aria-selected={opt.code === country}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => selectCountry(opt.code)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer',
                      i === highlight ? 'bg-accent' : 'hover:bg-accent/60',
                    )}
                  >
                    <span aria-hidden="true">{opt.flag}</span>
                    <span className="flex-1 truncate">{opt.name}</span>
                    <span className="text-muted-foreground text-xs">+{opt.callingCode}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* National number */}
        <input
          id={inputId}
          type="tel"
          inputMode="tel"
          value={nationalText}
          onChange={handleNationalChange}
          disabled={disabled || !country}
          placeholder={country ? undefined : 'Selecciona un país para editar'}
          aria-invalid={showInvalid || hasExternalError}
          aria-describedby={errorId}
          className={cn(baseFieldClass(showInvalid || hasExternalError), 'flex-1', !country && 'text-muted-foreground')}
        />
      </div>

      {isUnresolvedLegacy && (
        <p className="flex items-center gap-1.5 text-xs text-amber-600 mt-1.5">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          Este número existente no pudo interpretarse automáticamente. Selecciona el país correcto para confirmarlo o corregirlo.
        </p>
      )}
      {!isUnresolvedLegacy && localStatus === 'invalid' && !hasExternalError && (
        <p id={errorId} className="text-xs text-red-600 mt-1.5">
          El número no está completo o no es válido para el país seleccionado.
        </p>
      )}
      {hasExternalError && (
        <p id={errorId} className="text-xs text-red-600 mt-1.5">{error}</p>
      )}
    </div>
  )
}
