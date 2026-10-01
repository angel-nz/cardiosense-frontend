import React, { createContext, useContext, useCallback, useRef, useState } from 'react'
import type { SocketAlert } from '@/types'

// Z3 — Global Action Notification System.
//
// Z6-R2 §8/§9/§10/§12/§13 — REWRITTEN. The old Z3 design kept exactly ONE
// visible presentation slot at a time (`active`), with everything else
// held in a hidden hearts-of-FIFO queue behind it and CLINICAL_ALERT always
// preempting a showing ACTION toast. That "one visible toast" rule is
// CANCELLED: every notification generated in the same scenario must now be
// visible simultaneously, stacked — an operation that produces both an
// ActionNotification and an INFO AlertToast shows BOTH at once, never one
// queued behind the other, and no clinical-priority queue delays the
// ActionNotification anymore.
//
// Two kinds still share this presentation infrastructure but stay separate
// domains, deliberately never unified into one type:
//   - CLINICAL_ALERT — wraps an existing, already-persisted backend Alert
//     (realtime `new_alert`, SocketAlert). Clinical Alerts remain a
//     persistent product entity (AlertsPage, unread badge) regardless of
//     what happens to their toast — this coordinator only ever affects
//     whether/when they get a POPUP, never their underlying persistence.
//   - ACTION — ephemeral UI feedback for an operation's success/failure.
//     Never persisted, never added to AlertsPage, never touches any Alert
//     backend/socket API.
export type ActionVariant = 'success' | 'error' | 'warning' | 'info'

export interface ActionToastItem {
  id: string
  kind: 'ACTION'
  variant: ActionVariant
  title?: string
  message: string
  createdAt: number
}

export interface ClinicalToastItem {
  id: string
  kind: 'CLINICAL_ALERT'
  alert: SocketAlert
  createdAt: number
}

export type ToastItem = ActionToastItem | ClinicalToastItem

export interface NotifyOptions {
  title?: string
}

interface ToastContextValue {
  // Z6-R2 §8 — every currently-visible toast instance, in generation
  // (arrival) order. ToastViewport renders ALL of these concurrently — no
  // hidden queue sits behind this array; whatever is in here IS what's on
  // screen, in full, always (§9/§15 — never silently capped/discarded).
  activeToasts: ToastItem[]
  // Dismisses exactly one toast instance by its own stable id — manual
  // close (§10/K) and each instance's own independent auto-dismiss timer
  // (owned by the presenter component itself, see ActionToast/AlertToast)
  // both call this with their own id, never anyone else's.
  dismiss: (id: string) => void
  // Bridge-only: hands a realtime clinical Alert to the coordinator.
  enqueueClinicalAlert: (alert: SocketAlert) => void
  // Low-level entry point behind the notifySuccess/Error/Warning/Info
  // convenience API below.
  notify: (variant: ActionVariant, message: string, options?: NotifyOptions) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

// Z6-R2 §11 — ONE shared constant, the maximum any toast (ACTION or
// CLINICAL_ALERT alike) may stay on screen, measured from ITS OWN
// presentation time (never from when some other toast appeared, and never
// extended by hover — see ActionToast/AlertToast's own timer effects).
// Previously each variant had its own duration (success/info 4000ms,
// warning/error 6000ms, clinical alerts a flat 8000ms default) — all of
// those are now capped here instead.
export const TOAST_DISPLAY_MS = 5000

let actionIdSeq = 0
function nextActionId(): string {
  actionIdSeq += 1
  return `action-${Date.now()}-${actionIdSeq}`
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  // Z6-R2 §8 — replaces the old single `active`/hidden-`queueRef` pair with
  // one flat, fully-visible collection. Appending to the end on arrival and
  // never reordering it is what "preserve generation order" (§9) means in
  // practice — ToastViewport (and each kind's own stacking container) maps
  // this array in order, oldest first.
  const [activeToasts, setActiveToasts] = useState<ToastItem[]>([])

  // Clinical alerts are deduplicated by their backend Alert id for the life
  // of this provider (§7, carried over unchanged from the old design) — a
  // React rerender that leaves `lastAlert` pointing at the same alert, or
  // any other accidental re-delivery, must never add the same alert twice.
  // This is the authoritative guard; AlertToastBridge's own effect (keyed
  // by alert.id) is the first line of defense, this is the second. Z6-R2
  // §9 — this is the one, pre-existing, source-level dedup this block
  // explicitly permits keeping; nothing else is deduplicated.
  const seenClinicalIdsRef = useRef<Set<string>>(new Set())

  const dismiss = useCallback((id: string) => {
    setActiveToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const enqueueClinicalAlert = useCallback((alert: SocketAlert) => {
    if (seenClinicalIdsRef.current.has(alert.id)) return
    seenClinicalIdsRef.current.add(alert.id)
    setActiveToasts(prev => [
      ...prev,
      {
        id: `clinical-${alert.id}`,
        kind: 'CLINICAL_ALERT',
        alert,
        createdAt: Date.now(),
      },
    ])
  }, [])

  const notify = useCallback((variant: ActionVariant, message: string, options?: NotifyOptions) => {
    setActiveToasts(prev => [
      ...prev,
      {
        id: nextActionId(),
        kind: 'ACTION',
        variant,
        title: options?.title,
        message,
        createdAt: Date.now(),
      },
    ])
  }, [])

  return (
    <ToastContext.Provider value={{ activeToasts, dismiss, enqueueClinicalAlert, notify }}>
      {children}
    </ToastContext.Provider>
  )
}

// Low-level hook — the coordinator's full surface. Used by ToastViewport
// (reads `activeToasts`/`dismiss`) and AlertToastBridge (writes via
// `enqueueClinicalAlert`). Ordinary call sites should prefer
// useActionNotify() below instead — it never exposes clinical-alert
// concerns to a caller that only wants to report an operation result.
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}

// Public application API (§4). Small and typed — no timers, no visibility
// booleans, no local banner state for the caller to manage.
export function useActionNotify() {
  const { notify } = useToast()
  return {
    notifySuccess: (message: string, options?: NotifyOptions) => notify('success', message, options),
    notifyError:   (message: string, options?: NotifyOptions) => notify('error', message, options),
    notifyWarning: (message: string, options?: NotifyOptions) => notify('warning', message, options),
    notifyInfo:    (message: string, options?: NotifyOptions) => notify('info', message, options),
  }
}
