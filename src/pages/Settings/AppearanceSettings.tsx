import { useState, useRef } from 'react'
import { isAxiosError } from 'axios'
import {
  Loader2, CheckCircle2, RotateCcw, Sun, Moon, Monitor, Type,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { SettingsSection } from '@/components/settings/SettingsSection'
import { useAppearance } from '@/context/AppearanceContext'
import { useActionNotify } from '@/context/ToastContext'
import type { ThemePreference, InterfaceSizePreference } from '@/types'

// Bloque Y6.1 — real Appearance implementation.
//
// Y6.4B — the interface density/visibility preset section (Y6.3B) has been
// removed: that axis is no longer user-configurable (product decision,
// Y6.4A/Y6.4B — COMFORTABLE's former values are now simply the CardioSense
// default design). This page is theme-only again, matching its pre-Y6.3
// shape.
//
// PRE-Y8 (Settings Interaction Policy Refinement) — Appearance moved from an
// explicit draft/dirty/Save/Discard model to an IMMEDIATE PREFERENCE model:
// selecting a tile applies and persists the theme right away. There is no
// more local `draftTheme` — this component renders `preference` straight
// from AppearanceContext, which is now itself responsible for the
// optimistic-apply + rollback-on-failure + request-sequencing behind that
// (see AppearanceContext.tsx's `saveTheme`). This component's only
// remaining job is to call it and surface a failure inline — the
// useBlocker/beforeunload guard and the Save/Discard buttons are gone
// entirely, since there is no more unsaved draft to protect.
//
// PRE-Y8 (Interface Size Preference) — a second, independent tile grid
// below the theme one, same immediate-apply model, same tile grammar
// (radiogroup of cards, decorative preview, checkmark/spinner on the
// selected tile). Its own local `saving`/generation-ref state is a
// deliberate full duplicate of the theme section's — NOT shared state —
// because the two axes are independent both on the backend (field-scoped
// partial updates) and here (a Theme save in flight must never disable or
// show a spinner on the Interface Size tiles, and vice versa). Z3 — the
// failure feedback for both axes now goes through the shared global
// action-notification toast instead of each axis's own local banner.

const THEME_OPTIONS: { value: ThemePreference; title: string; icon: typeof Sun }[] = [
  {
    value: 'light',
    title: 'Claro',
    icon: Sun,
  },
  {
    value: 'dark',
    title: 'Oscuro',
    icon: Moon,
  },
  {
    value: 'system',
    title: 'Sistema',
    icon: Monitor,
  },
]

// PRE-Y8 (Interface Size Preference) — same option-list shape as
// THEME_OPTIONS above; `description` states the calibrated target
// percentage (≈110% / ≈125%) per this block's own spec, matching the real
// scale factors defined centrally in index.css's
// `:root[data-ui-size="..."]` rules (1 / 1.10 / 1.25). This is human-facing
// product copy only (FIX1 §4/§15 explicitly allows "≈110%"/"≈125%" text
// here) — it is not itself a second implementation of the scale mapping;
// nothing in this file computes or applies a numeric factor.
const INTERFACE_SIZE_OPTIONS: { value: InterfaceSizePreference; title: string; }[] = [
  {
    value: 'original',
    title: 'Pequeño',
  },
  {
    value: 'medium',
    title: 'Mediano',
  },
  {
    value: 'large',
    title: 'Grande',
  },
]

export default function AppearanceSettings() {
  const {
    preference,
    interfaceSize,
    isLoading,
    error: loadError,
    saveTheme,
    saveInterfaceSize,
    reloadAppearance,
  } = useAppearance()

  const { notifyError } = useActionNotify()

  // Purely a local "a save is in flight" indicator for this component's own
  // feedback — never gates whether a tile CAN be clicked (§12: rapid
  // Light → Dark → System selection must stay possible; it's
  // AppearanceContext's own request-generation sequencing that keeps the
  // FINAL state correct, not a UI lock here). `localGenRef` mirrors that
  // same "only the latest call may touch state" rule for this component's
  // own `saving` indicator and its toast-based error feedback, so an
  // earlier, now-superseded click's `finally` can't hide the indicator (or
  // fire its error notification) for a still-in-flight later click.
  const [saving, setSaving] = useState(false)
  const localGenRef = useRef(0)

  // PRE-Y8 (Interface Size Preference) — a fully independent duplicate of
  // the theme section's own local feedback state immediately above (see
  // this file's top-of-component-doc comment for why it is not shared).
  const [savingSize, setSavingSize] = useState(false)
  const localSizeGenRef = useRef(0)

  const handleSelectTheme = async (value: ThemePreference) => {
    if (value === preference) return
    const myGeneration = ++localGenRef.current
    setSaving(true)
    try {
      // AppearanceContext applies the selection immediately (optimistic)
      // and only rolls back if this turns out to be the failing AND latest
      // request — this call may resolve without throwing even though the
      // selection was later superseded by a newer click; that's correct,
      // not a bug (§12).
      await saveTheme(value)
    } catch (err) {
      if (localGenRef.current !== myGeneration) return // superseded by a newer click — say nothing about this one
      // Z3 — mutation-failure feedback now goes through the global
      // action-notification toast instead of an inline page banner.
      if (isAxiosError(err) && err.response?.data?.error) {
        notifyError(err.response.data.error as string)
      } else {
        notifyError('No se pudo guardar el cambio. Intenta de nuevo.')
      }
    } finally {
      if (localGenRef.current === myGeneration) setSaving(false)
    }
  }

  // PRE-Y8 (Interface Size Preference) — exact structural mirror of
  // handleSelectTheme above, calling saveInterfaceSize instead and touching
  // only this section's own local state.
  const handleSelectInterfaceSize = async (value: InterfaceSizePreference) => {
    if (value === interfaceSize) return
    const myGeneration = ++localSizeGenRef.current
    setSavingSize(true)
    try {
      await saveInterfaceSize(value)
    } catch (err) {
      if (localSizeGenRef.current !== myGeneration) return
      // Z3 — mutation-failure feedback now goes through the global
      // action-notification toast instead of an inline page banner.
      if (isAxiosError(err) && err.response?.data?.error) {
        notifyError(err.response.data.error as string)
      } else {
        notifyError('No se pudo guardar el cambio. Intenta de nuevo.')
      }
    } finally {
      if (localSizeGenRef.current === myGeneration) setSavingSize(false)
    }
  }

  return (
    <SettingsSection title="Apariencia">
      <div className="ui-content-stack">
        {/* Pre-Y8 visual polish — nested header + subtitle for the theme
            card, matching the reference's "Tema" treatment. */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Tema</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Personaliza el aspecto visual.
            </p>
          </div>
          {(isLoading || saving) && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground flex-shrink-0">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {saving ? 'Guardando…' : 'Actualizando…'}
            </span>
          )}
        </div>

        {loadError && (
          <div className="flex items-center justify-between gap-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-lg px-3 py-2.5">
            <p className="text-xs text-red-700 dark:text-red-300">{loadError}</p>
            <button
              type="button"
              onClick={reloadAppearance}
              className="flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-300 flex-shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reintentar
            </button>
          </div>
        )}

        <div role="radiogroup" aria-label="Tema de apariencia" className="grid gap-3 sm:grid-cols-3">
          {THEME_OPTIONS.map(opt => {
            const Icon = opt.icon
            const checked = preference === opt.value
            return (
              <label
                key={opt.value}
                className={cn(
                  'relative flex flex-col gap-3 rounded-xl border-2 p-4 cursor-pointer transition-colors',
                  'hover:bg-accent',
                  checked ? 'border-primary ring-2 ring-primary/30 bg-accent' : 'border-border',
                )}
              >
                <input
                  type="radio"
                  name="theme-preference"
                  value={opt.value}
                  checked={checked}
                  onChange={() => handleSelectTheme(opt.value)}
                  className="peer sr-only"
                />

                {/* Pre-Y8 visual polish — decorative preview swatch
                    standing in for the actual page in each theme.
                    PRE-R2A §C — LIGHT/DARK now render as exactly ONE solid
                    representative color each (the old inner w-1/3 strip,
                    which made every tile show two colors at once, is
                    removed); SYSTEM is a gradient built from those same two
                    representative colors (bg-white / bg-slate-900) — not a
                    third, separately-chosen pair. Still purely decorative
                    (aria-hidden) and, with the extra inner element gone,
                    strictly less markup than before — no new
                    screen-reader-visible content. Nothing here touches
                    ThemePreference/AppearanceContext/persistence/Interface
                    Size — this is only the swatch's own markup. */}
                <div
                  aria-hidden="true"
                  className={cn(
                    'h-16 w-full rounded-lg border border-border overflow-hidden',
                    opt.value === 'light' && 'bg-white',
                    opt.value === 'dark' && 'bg-slate-900',
                    opt.value === 'system' && 'bg-gradient-to-r from-white to-slate-900',
                  )}
                />

                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-foreground flex-shrink-0" />
                  <span className="text-sm font-medium text-foreground">{opt.title}</span>
                  {checked && (
                    saving
                      ? <Loader2 className="w-4 h-4 animate-spin text-primary ml-auto flex-shrink-0" aria-hidden="true" />
                      : <CheckCircle2 className="w-4 h-4 text-primary ml-auto flex-shrink-0" aria-hidden="true" />
                  )}
                </div>
              </label>
            )
          })}
        </div>

        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Tamaño</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Ajusta el tamaño de textos y elementos.
            </p>
          </div>
          {(isLoading || savingSize) && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground flex-shrink-0">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {savingSize ? 'Guardando…' : 'Actualizando…'}
            </span>
          )}
        </div>

        <div role="radiogroup" aria-label="Tamaño de la interfaz" className="grid gap-3 sm:grid-cols-3">
          {INTERFACE_SIZE_OPTIONS.map(opt => {
            const checked = interfaceSize === opt.value
            return (
              <label
                key={opt.value}
                className={cn(
                  'relative flex flex-col gap-3 rounded-xl border-2 p-4 cursor-pointer transition-colors',
                  'hover:bg-accent',
                  checked ? 'border-primary ring-2 ring-primary/30 bg-accent' : 'border-border',
                )}
              >
                <input
                  type="radio"
                  name="interface-size-preference"
                  value={opt.value}
                  checked={checked}
                  onChange={() => handleSelectInterfaceSize(opt.value)}
                  className="peer sr-only"
                />

                <div
                  aria-hidden="true"
                  className="h-16 w-full rounded-lg border border-border overflow-hidden flex items-center justify-center bg-muted/40"
                >
                  <span
                    className="font-semibold text-foreground"
                    style={{
                      fontSize: opt.value === 'original' ? '1rem' : opt.value === 'medium' ? '1.25rem' : '1.5rem',
                    }}
                  >
                    Aa
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <Type className="w-4 h-4 text-foreground flex-shrink-0" />
                  <span className="text-sm font-medium text-foreground">{opt.title}</span>
                  {checked && (
                    savingSize
                      ? <Loader2 className="w-4 h-4 animate-spin text-primary ml-auto flex-shrink-0" aria-hidden="true" />
                      : <CheckCircle2 className="w-4 h-4 text-primary ml-auto flex-shrink-0" aria-hidden="true" />
                  )}
                </div>
              </label>
            )
          })}
        </div>
      </div>
    </SettingsSection>
  )
}
