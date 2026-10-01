import { useToast } from '@/context/ToastContext'
import { AlertToast } from '@/components/alerts/AlertToast'
import { ActionToast } from './ActionToast'

// Z3 §5 — the ONE global presentation surface. Mounted exactly once, at the
// application root (router.tsx's RootLayout, inside Router context — Z5-FIX2,
// unchanged by this block), so it covers public routes (Login/Register) and
// authenticated routes alike.
//
// Z6-R2 §8/§9/§12/§13/§15 — REWRITTEN. This used to read the coordinator's
// single `active` slot and render at most one toast, clinical or action,
// at a time. The "one visible toast" rule is cancelled: this component now
// renders EVERY currently-active toast instance concurrently, in generation
// (arrival) order, with no hidden queue and no artificial cap — an
// operation that produces both an ActionNotification and an INFO AlertToast
// shows both at once, and three or more notifications stack together
// without any being silently discarded.
//
// Anchored bottom-right (unchanged viewport anchor, per §14's "preserve
// current viewport anchor" instruction). Since the anchor is at the
// BOTTOM, new toasts stack UPWARD: appending to the end of `activeToasts`
// (ToastContext's own append-only order) and laying them out in plain
// top-to-bottom flex order means the newest instance sits nearest the
// bottom-right anchor and older instances are pushed upward as the stack
// grows (§14's "If anchored at bottom: stack upward").
//
// The outer container itself is not interactive (no background, no
// padding) — it only exists to anchor and space the real cards, so a
// `pointer-events-none` fallback is unnecessary: with no toasts the
// container isn't rendered at all, and with N toasts it's exactly as tall
// as their own stacked content, never covering unrelated page area.
//
// Z6-R2-FIX1 §1/§3 — `dismiss` (ToastContext's own `useCallback`, empty
// deps — referentially stable for the provider's entire lifetime) is now
// passed straight through to each presenter AS-IS, never wrapped in a
// fresh `() => dismiss(item.id)` arrow here. The old wrapped form created
// a BRAND NEW function identity on every render of this component — which
// happens whenever ANY toast is added to or removed from `activeToasts`,
// not just this one — and that new identity flowed into ActionToast's/
// AlertToast's own `useEffect([..., onClose])`, resetting an already-
// visible toast's dismissal timer every time a sibling toast arrived or
// left. Passing the stable `dismiss` reference directly, and having each
// presenter call `onClose(its own id)` internally, removes that identity
// churn entirely — see ActionToast.tsx/AlertToast.tsx for the receiving
// half of this fix.
//
// Z6-R2-FIX3 §4/§8 — `toastId={item.id}` is now passed EXPLICITLY to both
// presenters, alongside `onClose={dismiss}`, rather than letting either
// presenter derive its own dismissal id from its payload. This is the
// fix for a real runtime bug: `ClinicalToastItem.id` (ToastContext.tsx's
// `enqueueClinicalAlert`) is built as `` `clinical-${alert.id}` `` — a
// DIFFERENT string from the bare backend `alert.id` that AlertToast used
// to call `onClose` with. Since `ToastContext.dismiss` filters
// `activeToasts` by exact `t.id` equality, `onClose(alert.id)` never
// matched any item in the array, so every INFO/clinical toast's timer
// expiry, X button, and "Ver alerta →" were silently no-ops — the card
// stayed on screen indefinitely. `item.id` (this component's own,
// authoritative `ToastItem.id`, already used for the `key` below) is the
// one correct identifier for dismissal, for BOTH kinds, and is now the
// only thing either presenter ever calls `onClose` with — never a value
// read back out of `alert`/`item`'s own payload fields.
export function ToastViewport() {
  const { activeToasts, dismiss } = useToast()

  if (activeToasts.length === 0) return null

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 items-end">
      {activeToasts.map(item => (
        // `key={item.id}` guarantees a full remount whenever a genuinely
        // new item is inserted — belt-and-suspenders alongside each
        // presenter's own id-keyed timer effect (§10/§11), and the same
        // reasoning AlertToast's PRE-Y8 progress-bar remount already
        // relies on. Z6-R2-FIX3 — `toastId={item.id}` reuses this exact
        // same value, never a payload-derived one.
        <div key={item.id}>
          {item.kind === 'CLINICAL_ALERT'
            ? <AlertToast toastId={item.id} alert={item.alert} onClose={dismiss} />
            : <ActionToast toastId={item.id} item={item} onClose={dismiss} />}
        </div>
      ))}
    </div>
  )
}
