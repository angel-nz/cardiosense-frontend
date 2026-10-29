// U3.2 — thin wrapper around @radix-ui/react-dialog (already installed,
// confirmed in package.json — no new dependency). First usage of this
// primitive in the project; everything below is Radix's own accessible
// behavior (focus trap, Escape-to-close, focus restoration to the trigger
// on close) — no custom/manual focus-trap logic was written.
import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCallback, useRef } from 'react'
import type { ReactNode } from 'react'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  // Radix requires Escape/overlay-click to be preventable while an async
  // action (e.g. saving) is in flight — same "don't lose work mid-submit"
  // principle already used elsewhere in this app.
  preventClose?: boolean
  // NEW S2E-FIX2 — additive. 'wide' gives large content (full risk chart,
  // projection detail) a desktop-sized box while staying full-width (minus
  // a 16px gutter) on phones. Omitted → exactly the previous max-w-lg box.
  size?: 'default' | 'wide'
  // NEW S2E-FIX2 — additive passthrough of Radix's close-auto-focus hook, so
  // a caller can return focus to a specific trigger deterministically (some
  // browsers, e.g. Safari, never focus a mouse-clicked button, which would
  // otherwise leave focus on <body>). Omitted → Radix default, unchanged.
  onCloseAutoFocus?: (event: Event) => void
}

// Below lg, keeps the dialog inside the *visible* viewport. CSS alone
// (vw/dvh) fixes the size and the base center, but when a horizontally
// overflowing page lets the visual viewport pan inside the expanded layout
// viewport, only its offset (visualViewport.offsetLeft/Top) can re-anchor a
// position:fixed box. Published as --vv-x/--vv-y (CSS px, zoom-corrected).
function useVisualViewportAnchor() {
  const cleanup = useRef<(() => void) | null>(null)
  return useCallback((node: HTMLElement | null) => {
    cleanup.current?.()
    cleanup.current = null
    const vv = window.visualViewport
    if (!node || !vv) return
    const mq = window.matchMedia('(max-width: 1023px)')
    const update = () => {
      if (!mq.matches) {
        node.style.removeProperty('--vv-x')
        node.style.removeProperty('--vv-y')
        return
      }
      const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1
      node.style.setProperty('--vv-x', `${vv.offsetLeft / zoom}px`)
      node.style.setProperty('--vv-y', `${vv.offsetTop / zoom}px`)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    cleanup.current = () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
}

export function Dialog({ open, onOpenChange, title, description, children, preventClose, size = 'default', onCloseAutoFocus }: DialogProps) {
  const anchorRef = useVisualViewportAnchor()
  return (
    <RadixDialog.Root open={open} onOpenChange={next => { if (!preventClose) onOpenChange(next) }}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/50 animate-fade-in" />
        {/* Y6.3B §35 — outer shape (`max-w-lg`, max-height 90% of viewport,
            `overflow-y-auto`) is an explicit invariant across all presets.
            Only padding responds to --ui-modal-padding (Classic 1.5rem/24px,
            exact match to the original `p-6` — spot-check "Dialog padding",
            §45).

            PRE-Y8 (Interface Size Preference) — the height cap moved from
            the Tailwind class `max-h-[90vh]` to this inline
            `calc(90vh / var(--ui-zoom, 1))`. Centering itself
            (left-1/2/top-1/2 + -translate-x/y-1/2, both percentage/
            transform-based) needs NO change — verified against a real
            Chromium instance to stay perfectly centered at every tested
            zoom factor (1 / 1.10 / 1.25), since percentage-of-containing-
            block and transform are not subject to the bug below.
            `vh`/`vw` units ARE subject to it, though: this Content element
            is a descendant of the zoomed `html` root (Radix portals to
            document.body, itself a child of html), so a plain `90vh` here
            is re-scaled by the ambient zoom on top of already being 90% of
            an already-zoom-inflated viewport-height reading — verified
            empirically (a 50vh probe element measured 350px/385px/437.5px
            at zoom 1/1.10/1.25 instead of a constant 350px) — meaning an
            uncompensated `max-h-[90vh]` would let a tall dialog's box grow
            taller than the true physical viewport at Medium/Large, with no
            way to scroll to its cut-off top/bottom edge (`overflow-y-auto`
            only scrolls the dialog's own inner content, not the fixed-
            positioned box itself). Dividing by the same `--ui-zoom` custom
            property the root's own zoom reads from cancels that
            re-scaling — confirmed empirically to render a constant,
            correct height regardless of zoom (see final report). */}
        <RadixDialog.Content
          ref={anchorRef}
          onEscapeKeyDown={e => { if (preventClose) e.preventDefault() }}
          onPointerDownOutside={e => { if (preventClose) e.preventDefault() }}
          onCloseAutoFocus={onCloseAutoFocus}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            // Below lg, size and center against the device viewport (vw/dvh)
            // instead of %, which resolves against the layout viewport that a
            // horizontally overflowing page expands. Divided by --ui-zoom to
            // cancel the root zoom.
            'max-lg:left-[calc(50vw/var(--ui-zoom,1)_+_var(--vv-x,0px))] max-lg:top-[calc(50dvh/var(--ui-zoom,1)_+_var(--vv-y,0px))] max-lg:!max-h-[calc(90dvh/var(--ui-zoom,1))]',
            size === 'wide'
              ? 'w-[calc(100%-2rem)] max-w-5xl max-lg:w-[calc(100vw/var(--ui-zoom,1)_-_2rem)]'
              : 'w-full max-w-lg max-lg:w-[calc(100vw/var(--ui-zoom,1)_-_2rem)]',
            'bg-card rounded-xl border border-border shadow-lg',
            'overflow-y-auto max-sm:!p-4',
          )}
          style={{ padding: 'var(--ui-modal-padding)', maxHeight: 'calc(90vh / var(--ui-zoom, 1))' }}
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <RadixDialog.Title className="text-lg font-semibold text-foreground">
                {title}
              </RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="text-sm text-muted-foreground mt-1">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close
              disabled={preventClose}
              aria-label="Cerrar"
              className="p-1.5 rounded-lg hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0 touch-target-box"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </RadixDialog.Close>
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
