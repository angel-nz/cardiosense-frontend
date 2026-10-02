import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { alertService } from '@/services/alertService'
import type { Alert } from '@/types'
import { useAuth } from './AuthContext'
import { useSocket } from './SocketContext'

// Y4-FIX2 — same 400ms coalescing window AlertsPage already uses for its own
// canonical refetch on realtime events (REALTIME_COALESCE_MS there). Kept as
// a local constant here rather than shared/exported, to avoid coupling this
// context to that page's module.
const ALERTS_CHANGED_COALESCE_MS = 400

interface AlertsContextValue {
  alerts: Alert[]
  total: number
  unreadCount: number
  loading: boolean
  error: string | null
  refetch: () => void
  markAsRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  // Individual mark-as-read, REQUEST-FIRST (Topbar preview's per-row
  // control). Unlike markAsRead above (optimistic, rolled back on failure),
  // the caller first awaits the real PATCH /alerts/:id/read and only then
  // calls this — so there is no local "read" state that could ever need a
  // rollback. Synchronous on purpose: the caller applies its own local
  // state (preview list) in the SAME synchronous block, which is what lets
  // React commit both together. Returns whether unreadCount was actually
  // decremented (false when the shared cache already knew the alert was
  // read, or the counter was already 0 — never goes negative).
  applyAlertRead: (id: string) => boolean
  // Increments every time an individual read confirmed elsewhere (the Topbar
  // preview) has been applied. AlertsPage owns its own paginated/filtered
  // list (U7.2) that this context cannot patch, so it watches this scalar
  // to reconcile with a canonical refetch — the same "invalidate, then
  // GET" pattern it already uses for realtime events.
  alertReadSeq: number
}

const AlertsContext = createContext<AlertsContextValue | null>(null)

// Shared so the sidebar/topbar badge (INT-13's unreadCount) and AlertsPage's
// full list (INT-13/14) always reflect the same real backend state — and so
// a new_alert event (INT-18) updates both without a reload.
export function AlertsProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  const { lastAlert, lastAlertsChanged } = useSocket()

  const [alerts, setAlerts] = useState<Alert[]>([])
  const [total, setTotal] = useState(0)
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [alertReadSeq, setAlertReadSeq] = useState(0)

  // Latest committed values for applyAlertRead's synchronous "was it unread?"
  // decision (a plain closure over state would be stale for a handler that
  // captured an earlier render, e.g. a PATCH that resolves after a rerender).
  const alertsRef = useRef<Alert[]>(alerts)
  const unreadCountRef = useRef(unreadCount)
  alertsRef.current = alerts
  unreadCountRef.current = unreadCount

  const fetchAlerts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await alertService.list({ limit: 50 })
      setAlerts(result.data)
      setTotal(result.total)
      setUnreadCount(result.unreadCount)
    } catch {
      setError('No se pudieron cargar las alertas')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isAuthenticated) fetchAlerts()
  }, [isAuthenticated, fetchAlerts])

  // INT-18 — merge new_alert into shared state without reload. Deduplicated
  // by id so a later GET /alerts (e.g. AlertsPage remount) never doubles it
  // up. Does NOT call clearLastAlert() — AppLayout's toast owns that
  // lifecycle (auto-close / manual dismiss); clearing it here too would
  // race the toast's own render.
  useEffect(() => {
    if (!lastAlert) return
    setAlerts(prev => {
      if (prev.some(a => a.id === lastAlert.id)) return prev
      const merged: Alert = {
        id: lastAlert.id,
        patientId: lastAlert.patientId,
        // Z5 — SocketAlert.patientName is optional (a doctor-scoped
        // payload would omit it entirely, since there is no patient to
        // name — Z6-R2 removed the doctor-profile information alert, the
        // one AlertType that ever produced such a payload), but
        // Alert.patientName stays a required string for every existing
        // consumer (AlertsPage/AlertToast) that already renders it
        // unconditionally. '' is the same "nothing to show" fallback those
        // consumers already treat patientId === null as a signal for —
        // never a fabricated name.
        patientName: lastAlert.patientName ?? '',
        type: lastAlert.type,
        severity: lastAlert.severity,
        message: lastAlert.message,
        isRead: false,
        createdAt: lastAlert.createdAt,
        riskScore: lastAlert.riskScore,
      }
      return [merged, ...prev]
    })
    setTotal(t => t + 1)
    setUnreadCount(c => c + 1)
  }, [lastAlert])

  // Y4-FIX2 — alerts_changed: the UNGATED canonical-data-invalidation signal
  // (see SocketContext.tsx / backend alert.service.ts). Unlike the lastAlert
  // handler above, this NEVER fabricates an Alert from the socket payload
  // (the payload is intentionally minimal — {alertId, patientId} only, no
  // severity/message/patientName/riskScore) — it triggers the existing,
  // unmodified fetchAlerts() canonical GET instead, so the Alerts
  // collection/total/unreadCount stay correct even when a category's
  // realtime toggle is OFF and lastAlert never fires at all.
  //
  // Why this can't double-count or duplicate, regardless of whether
  // lastAlert also fires for the same Alert (preference ON case) and
  // regardless of Socket.IO arrival order: fetchAlerts() performs a
  // wholesale setAlerts(result.data)/setTotal/setUnreadCount replacement
  // from the authoritative backend response, not an incremental merge —
  // so once it resolves, state is exactly what the database says,
  // overwriting (never adding to) whatever the optimistic lastAlert effect
  // above already did. The 400ms coalesce mirrors AlertsPage's own pattern
  // (scheduleRefresh) so a lastAlert-triggered fetchAlerts() and an
  // alerts_changed-triggered one arriving within the same window collapse
  // into a single request rather than firing twice.
  //
  // Not cleared here, same reasoning as lastAlert above: AlertsPage is a
  // second, independent consumer of this same scalar (see its own
  // lastAlertsChanged effect) — clearing it in either consumer would race
  // the other's effect.
  const alertsChangedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!lastAlertsChanged) return
    if (alertsChangedTimerRef.current) clearTimeout(alertsChangedTimerRef.current)
    alertsChangedTimerRef.current = setTimeout(() => {
      alertsChangedTimerRef.current = null
      fetchAlerts()
    }, ALERTS_CHANGED_COALESCE_MS)
  }, [lastAlertsChanged, fetchAlerts])

  useEffect(() => {
    return () => { if (alertsChangedTimerRef.current) clearTimeout(alertsChangedTimerRef.current) }
  }, [])

  const markAsRead = useCallback(async (id: string) => {
    const target = alerts.find(a => a.id === id)
    if (!target || target.isRead) return

    const snapshot = alerts
    // Optimistic update — UI reflects it immediately...
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, isRead: true } : a))
    setUnreadCount(c => Math.max(0, c - 1))
    try {
      // ...but persistence is confirmed against the real backend.
      await alertService.markRead(id)
    } catch (err) {
      // Roll back — never leave the user believing it persisted if it didn't.
      setAlerts(snapshot)
      setUnreadCount(c => c + 1)
      throw err
    }
  }, [alerts])

  const applyAlertRead = useCallback((id: string): boolean => {
    const cached = alertsRef.current.find(a => a.id === id)
    // The backend has already confirmed read=true. The shared cache holds
    // only the newest 50 Alerts, so an Alert the Topbar preview surfaced
    // from further back is simply absent here — that is not "already read";
    // the preview only lists Alerts the server reported as unread.
    const wasUnread = cached ? !cached.isRead : true
    const decrement = wasUnread && unreadCountRef.current > 0
    setAlertReadSeq(n => n + 1)
    if (cached && !cached.isRead) {
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, isRead: true } : a))
    }
    if (decrement) {
      // Mirror the ref immediately so a second apply in the same tick sees it.
      unreadCountRef.current -= 1
      setUnreadCount(c => Math.max(0, c - 1))
    }
    return decrement
  }, [])

  const markAllRead = useCallback(async () => {
    const snapshot = alerts
    const snapshotUnread = unreadCount
    setAlerts(prev => prev.map(a => ({ ...a, isRead: true })))
    setUnreadCount(0)
    try {
      await alertService.markAllRead()
    } catch (err) {
      setAlerts(snapshot)
      setUnreadCount(snapshotUnread)
      throw err
    }
  }, [alerts, unreadCount])

  return (
    <AlertsContext.Provider value={{
      alerts, total, unreadCount, loading, error,
      refetch: fetchAlerts, markAsRead, markAllRead, applyAlertRead, alertReadSeq,
    }}>
      {children}
    </AlertsContext.Provider>
  )
}

export function useAlerts(): AlertsContextValue {
  const ctx = useContext(AlertsContext)
  if (!ctx) throw new Error('useAlerts must be used inside AlertsProvider')
  return ctx
}
