import { useEffect } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TOAST_DISPLAY_MS } from '@/context/ToastContext'
import type { ActionToastItem, ActionVariant } from '@/context/ToastContext'

interface ActionToastProps {
  // Z6-R2-FIX3 §4/§8 — THE authoritative presentation/dismissal identifier,
  // passed down explicitly by ToastViewport (`item.id`) rather than derived
  // from `item` inside this component. For ACTION toasts `toastId` and
  // `item.id` happen to be the exact same field today (the full ToastItem
  // is what gets passed as `item`, so this kind was never actually broken —
  // see the Z6-R2-FIX3 audit, which found the real bug only in AlertToast's
  // `clinical-${alert.id}` vs bare `alert.id` mismatch), but this component
  // now reads `toastId` explicitly rather than `item.id` so the dismissal
  // identity is never again implicitly "whatever field happens to line up"
  // — it is the one, explicit presentation id, same contract as AlertToast.
  toastId: string
  item: ActionToastItem
  // Z6-R2-FIX1 §1/§3 — this is ToastContext's own stable `dismiss`
  // (referentially unchanged for the provider's lifetime), passed straight
  // through by ToastViewport — never a fresh per-render wrapper closure.
  // This component calls it with `toastId` wherever it needs to close
  // itself (timer expiry, manual close button).
  onClose: (id: string) => void
}

// Z3 §9/§11 — one dedicated per-variant config: icon and color tokens (same
// palette already used elsewhere in this app for the same meaning — teal
// for success, matching ProfileSettings' pre-existing "Cambios guardados."
// banner; red/amber/blue matching the existing error/warning banners and
// SEVERITY_CONFIG.info respectively).
//
// Z6-R2 §11 — per-variant `durationMs` REMOVED (success/info used to get
// 4000ms, warning/error 6000ms). Every toast now shares the same single
// TOAST_DISPLAY_MS ceiling (ToastContext.tsx) regardless of variant — the
// explicit product requirement is a maximum, not a palette of durations.
const VARIANT_CONFIG: Record<ActionVariant, {
  icon: typeof CheckCircle2
  bg: string
  border: string
  text: string
  dot: string
}> = {
  success: {
    icon: CheckCircle2,
    bg: 'bg-teal-50 dark:bg-teal-950/40',
    border: 'border-teal-200 dark:border-teal-800/60',
    text: 'text-teal-700 dark:text-teal-300',
    dot: 'bg-teal-500',
  },
  info: {
    icon: Info,
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    border: 'border-blue-200 dark:border-blue-800/60',
    text: 'text-blue-700 dark:text-blue-300',
    dot: 'bg-blue-500',
  },
  warning: {
    icon: AlertTriangle,
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    border: 'border-amber-200 dark:border-amber-800/60',
    text: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  error: {
    icon: XCircle,
    bg: 'bg-red-50 dark:bg-red-950/40',
    border: 'border-red-200 dark:border-red-800/60',
    text: 'text-red-700 dark:text-red-300',
    dot: 'bg-red-500',
  },
}

// Ephemeral, non-clinical operation-result feedback. role="status" +
// aria-live="polite" (§10) — this is deliberately NOT role="alert": that
// urgent semantic stays reserved for AlertToast's clinical realtime alerts
// (§8/§10). Never steals keyboard focus; close button is a real, focusable
// <button>; icon is always paired with variant-colored text, never the
// only signal of state (§10).
//
// Z6-R2 §8/§10/§16 — no longer positions itself with `fixed`/`bottom-6`/
// `right-6`: this card can now render alongside any number of sibling
// toasts, so ToastViewport's own stacking container owns the viewport
// anchor/positioning and this component is purely its content, one card
// among many. §10 — each instance keeps its OWN independent dismissal
// timer, keyed by `toastId` (Z6-R2-FIX3 — was `item.id`; see below).
//
// Z6-R2-FIX1 §1/§2/§3 — AUDITED AND FIXED. `onClose` is now ToastContext's
// own stable `dismiss` function (a `useCallback` with an empty dependency
// array — its identity never changes for the life of the provider), passed
// straight through by ToastViewport instead of being wrapped in a fresh
// `() => dismiss(item.id)` arrow on every one of ITS renders. Before this
// fix, that wrapper's identity changed whenever ANY toast was added to or
// removed from the shared `activeToasts` array — including a toast that
// had nothing to do with this one — which re-ran this effect (clearing the
// in-flight timer and starting a brand new full-duration one) purely
// because a SIBLING toast arrived or left.
//
// Z6-R2-FIX3 §4/§6 — keyed by the explicit `toastId` prop rather than
// `item.id` (see the component-level comment on `toastId` above for why
// this component now takes it explicitly instead of reaching into `item`).
// `[toastId, onClose]` only ever changes when `toastId` changes (a
// genuinely new toast instance — ToastViewport keys each card by this same
// value, so a new `toastId` always means a fresh mount anyway), since
// `onClose` (`dismiss`) is referentially stable — so a sibling toast's
// arrival/departure can no longer reset or extend this instance's deadline.
export function ActionToast({ toastId, item, onClose }: ActionToastProps) {
  const cfg = VARIANT_CONFIG[item.variant]
  const Icon = cfg.icon

  useEffect(() => {
    const t = setTimeout(() => onClose(toastId), TOAST_DISPLAY_MS)
    return () => clearTimeout(t)
  }, [toastId, onClose])

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'w-96 ui-toast-viewport-max-width',
        'rounded-lg border shadow-xl animate-slide-in',
        'bg-card', cfg.border,
      )}
    >
      <div className="flex items-start gap-2.5 p-3">
        <div className={cn('w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0', cfg.bg)}>
          <Icon className={cn('w-3.5 h-3.5', cfg.text)} />
        </div>
        <div className="flex-1 min-w-0">
          {item.title && (
            <p className="text-sm font-semibold text-foreground">{item.title}</p>
          )}
          <p className={cn('text-sm break-words', item.title ? 'text-muted-foreground mt-0.5' : 'text-foreground font-medium')}>
            {item.message}
          </p>
        </div>
        <button
          onClick={() => onClose(toastId)}
          aria-label="Cerrar notificación"
          className="p-1 rounded-md hover:bg-foreground/5 transition-colors flex-shrink-0"
        >
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>
      {/* Progress bar — keyed to toastId so every fresh instance starts its
          own animation in sync with the timer above. */}
      <div className="h-0.5 bg-foreground/10 rounded-b-lg overflow-hidden">
        <div
          key={toastId}
          className={cn('h-full', cfg.dot)}
          style={{ animation: `shrink ${TOAST_DISPLAY_MS}ms linear forwards` }}
        />
      </div>
      <style>{`@keyframes shrink { from { width: 100% } to { width: 0% } }`}</style>
    </div>
  )
}
