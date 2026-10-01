import { useEffect } from 'react'
import { X, AlertTriangle, Bell } from 'lucide-react'
import { cn, SEVERITY_CONFIG } from '@/lib/utils'
import { TOAST_DISPLAY_MS } from '@/context/ToastContext'
import type { SocketAlert } from '@/types'
import { useNavigate } from 'react-router-dom'

interface AlertToastProps {
  // Z6-R2-FIX3 §4/§8 — THE authoritative presentation/dismissal identifier:
  // ToastContext's own `ToastItem.id` for this instance, exactly as
  // ToastViewport holds it (`item.id`). This is NOT `alert.id`. For a
  // CLINICAL_ALERT, ToastContext.enqueueClinicalAlert builds the ToastItem
  // with `id: \`clinical-${alert.id}\`` — a DIFFERENT string from the bare
  // backend `alert.id` this component receives via the `alert` payload
  // below. Root cause of the Z6-R2-FIX3 runtime bug: this component used to
  // call `onClose(alert.id)` (the bare backend id), which never equals any
  // `t.id` in `activeToasts` (every one of which carries the `clinical-`
  // prefix for this kind) — so `ToastContext.dismiss`'s
  // `prev.filter(t => t.id !== id)` matched EVERY item, including this
  // one, and never actually removed it. Timer expiry, the X button, and
  // "Ver alerta →" were all silently no-ops. `toastId` fixes this by never
  // deriving a dismissal id from payload identity again — it is passed
  // down explicitly from ToastViewport and used for every dismissal call
  // in this component.
  toastId: string
  alert: SocketAlert
  // Z6-R2-FIX1 §1/§3 — this is ToastContext's own stable `dismiss`
  // (referentially unchanged for the provider's lifetime), passed straight
  // through by ToastViewport — never a fresh per-render wrapper closure.
  // This component calls it with `toastId` wherever it needs to close
  // itself (timer expiry, "Ver alerta →", manual close button) — never
  // with anything derived from `alert`.
  onClose: (id: string) => void
  // Z6-R2-FIX2 §2 — the overridable `autoCloseDuration` prop (Z6-R2 §11,
  // clamped-not-removed by Z6-R2-FIX1 §4/§7) is REMOVED entirely: it had
  // zero production callers (ToastViewport.tsx's one render site never
  // passed it) and zero test/story callers, so it was pure unused surface
  // area — and a `Math.min(requested, TOAST_DISPLAY_MS)` clamp alone still
  // let a caller-supplied `0` or a negative number slip through the
  // `effectiveDuration <= 0` guard into an indefinite (never auto-dismissing)
  // toast, violating the "every toast auto-dismisses within <= 5000ms"
  // invariant. With no real caller needing an override, removing the prop
  // (rather than clamping harder) deletes that whole edge-case class: this
  // component now always uses the single shared TOAST_DISPLAY_MS ceiling,
  // unconditionally.
}

export function AlertToast({ toastId, alert, onClose }: AlertToastProps) {
  const navigate = useNavigate()
  const cfg = SEVERITY_CONFIG[alert.severity]

  // PRE-Y8 — TIMER FIX, carried over under Z6-R2's stacked model.
  //
  // Z6-R2-FIX1 §1/§2/§3 — AUDITED AND FIXED. `onClose` is now
  // ToastContext's own stable `dismiss` function (a `useCallback` with an
  // empty dependency array — its identity never changes for the life of
  // the provider), passed straight through by ToastViewport instead of
  // being wrapped in a fresh `() => dismiss(item.id)` arrow on every one of
  // ITS renders. Before this fix, that wrapper's identity changed whenever
  // ANY toast was added to or removed from the shared `activeToasts` array
  // — including a toast that had nothing to do with this one — which
  // re-ran this effect (clearing the in-flight timer and starting a brand
  // new full-duration one) purely because a SIBLING toast arrived or left.
  //
  // Z6-R2-FIX2 §2/§3 — `effectiveDuration` and its `<= 0` early-return guard
  // are GONE along with the prop that made them necessary: there is no
  // longer any caller-suppliable number to clamp or validate, so there is no
  // indefinite-duration path to guard against. `TOAST_DISPLAY_MS` is a
  // module-level constant (not a prop).
  //
  // Z6-R2-FIX3 §4/§6/§8 — keyed on `toastId`, not `alert.id`: this is the
  // one correction this fix makes. `[toastId, onClose]` only changes when
  // `toastId` changes (a genuinely new toast instance — ToastViewport keys
  // each card by this same value, so a new `toastId` always means a fresh
  // mount anyway), since `onClose` (`dismiss`) is referentially stable. A
  // sibling toast's arrival/departure still cannot reset or extend this
  // instance's deadline — that FIX1 guarantee is unchanged by this fix.
  useEffect(() => {
    const t = setTimeout(() => onClose(toastId), TOAST_DISPLAY_MS)
    return () => clearTimeout(t)
  }, [toastId, onClose])

  return (
    // PRE-Y8 (Interface Size Preference), FIX3/FIX4 — was
    // `max-w-[calc(100vw-3rem)]`: under this app's global `--ui-zoom`, that
    // `vw` term is re-scaled by zoom exactly like `vh` was (FIX1/FIX2),
    // which real-Chromium testing confirmed let this toast render up to
    // ~64px off the left edge of a narrow (375px) viewport at Large (FIX3).
    // FIX4 recalibrated the compensation formula itself so this safety
    // margin tracks native browser zoom (Interface Size's own product
    // contract: Original/Medium/Large ≈ native zoom 100%/110%/125%) instead
    // of merely staying a constant physical size. See
    // `.ui-toast-viewport-max-width` in index.css for the derived,
    // empirically-verified formula and reasoning. `w-96` is unchanged —
    // an ordinary fixed dimension that is supposed to scale with Interface
    // Size, only the viewport-relative safety bound needed correcting.
    //
    // Z6-R2 §8/§16 — no longer positions itself with `fixed`/`bottom-6`/
    // `right-6`/`z-50`: this card can now render alongside any number of
    // sibling toasts (clinical and action alike), so ToastViewport's own
    // stacking container owns the viewport anchor/positioning/z-index —
    // this component is purely its content, one card among many.
    //
    // PRE-Y8 (Alerts/Predictions/Navigation fix), Part A — the outer
    // surface previously used `cfg.bg` (SEVERITY_CONFIG's per-severity
    // background), whose dark-mode values carry a Tailwind alpha
    // modifier (e.g. `dark:bg-red-950/40`). That is the confirmed root
    // cause of this toast reading as translucent in dark mode — the
    // 40%-opacity fill lets whatever page content sits behind the fixed
    // toast show through. `bg-card` is this codebase's existing, already
    // widely-used fully-opaque surface token (`hsl(var(--card))`, no
    // alpha channel, in both themes — see index.css), so swapping only
    // the OUTER surface to it makes the toast body fully opaque without
    // touching `SEVERITY_CONFIG` itself (shared with AlertsPage/
    // DashboardCalendar/PatientCalendar, out of scope here). Severity is
    // still conveyed exactly as before via the icon accent (`cfg.bg` on
    // the small icon circle below, unchanged), `cfg.border`, and the
    // label/dot colors — only the body fill is now severity-neutral and
    // opaque, per the "preserve icon/border/badge/text distinctions"
    // requirement.
    //
    // Z6-R2 §14 — moderate compacting pass (padding/icon/gap reduced) to
    // keep a multi-toast stack from saturating the screen, while every
    // severity cue (icon, border, label color, dot), the message text, and
    // the close/navigate controls stay exactly as legible and present as
    // before.
    <div
      className={cn(
        'w-96 ui-toast-viewport-max-width',
        'rounded-lg border shadow-xl animate-slide-in',
        'bg-card', cfg.border,
      )}
    >
      <div className="flex items-start gap-2.5 p-3">
        <div className={cn('w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0', cfg.bg)}>
          {alert.severity === 'critical' ? (
            <AlertTriangle className={cn('w-3.5 h-3.5', cfg.text)} />
          ) : (
            <Bell className={cn('w-3.5 h-3.5', cfg.text)} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={cn('text-xs font-bold uppercase tracking-wide', cfg.text)}>
              {cfg.label}
            </span>
            <span className={cn('w-1.5 h-1.5 rounded-full', cfg.dot)} />
            <span className="text-xs text-muted-foreground">Tiempo real</span>
          </div>
          {/* Z5 — alert.patientName is optional: a doctor-scoped Alert has
              no patient at all (no live AlertType produces one today — see
              Z6-R2). Falling back to a neutral label (never leaving this
              blank or rendering `undefined`) keeps this line meaningful for
              a patientless alert without inventing a fake patient name. */}
          <p className="text-sm font-semibold text-foreground">
            {alert.patientName || 'Notificación general'}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{alert.message}</p>
          <button
            onClick={() => { navigate('/alerts'); onClose(toastId) }}
            className={cn('text-xs font-medium mt-1.5 hover:underline', cfg.text)}
          >
            Ver alerta →
          </button>
        </div>
        <button
          onClick={() => onClose(toastId)}
          // Y6.2 — was hover:bg-black/5, a fixed dark-tint overlay that
          // would read as a near-invisible smudge over this toast's already
          // dark severity background in dark mode. bg-foreground/5 tints
          // toward whichever color the theme's own body text currently is
          // (near-black in light mode, near-white in dark mode), so the
          // hover overlay stays a subtle, visible darken/lighten in both.
          className="p-1 rounded-md hover:bg-foreground/5 transition-colors flex-shrink-0"
        >
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>
      {/* Barra de progreso — same reasoning as the hover overlay above: was
          bg-black/10, now bg-foreground/10 so the track stays visible
          against the toast's own severity background in both themes. */}
      {/* PRE-Y8 — TIMER FIX — `key={toastId}` here (not on the whole
          AlertToast) is the smallest fix that restarts this bar's CSS
          animation in sync with the new timer above. `style.animation` is
          normally the same string across an Alert A -> B prop update
          (`TOAST_DISPLAY_MS` is a fixed module-level constant), so without a
          key React's diff is a no-op and the browser keeps the OLD animation
          instance — already finished (`forwards`, width 0) from A's run —
          instead of restarting it for B. Keying only this inner div forces
          just this node to remount, restarting its animation, while the
          rest of the toast (icon, text, buttons, outer surface) stays the
          same instance and is unaffected.
          Z6-R2-FIX1 §5 / Z6-R2-FIX2 §3 — driven by `TOAST_DISPLAY_MS`
          directly (there is no longer any per-instance duration to clamp —
          see Z6-R2-FIX2's removal of `autoCloseDuration`/`effectiveDuration`
          above), so the visual countdown always matches the ACTUAL timer
          above and can never imply more than TOAST_DISPLAY_MS on screen.
          Z6-R2-FIX3 — keyed on `toastId`, not `alert.id` (see the timer
          effect above for why those two are not the same string). */}
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
