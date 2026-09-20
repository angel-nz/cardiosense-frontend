// U3.2 — thin wrapper around @radix-ui/react-dialog (already installed,
// confirmed in package.json — no new dependency). First usage of this
// primitive in the project; everything below is Radix's own accessible
// behavior (focus trap, Escape-to-close, focus restoration to the trigger
// on close) — no custom/manual focus-trap logic was written.
import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
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
}

export function Dialog({ open, onOpenChange, title, description, children, preventClose }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={next => { if (!preventClose) onOpenChange(next) }}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/50 animate-fade-in" />
        <RadixDialog.Content
          onEscapeKeyDown={e => { if (preventClose) e.preventDefault() }}
          onPointerDownOutside={e => { if (preventClose) e.preventDefault() }}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2',
            'bg-card rounded-xl border border-border shadow-lg p-6',
            'max-h-[90vh] overflow-y-auto',
          )}
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
              className="p-1.5 rounded-lg hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
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
