import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { alertService } from '@/services/alertService'
import type { Alert } from '@/types'
import { useAuth } from './AuthContext'
import { useSocket } from './SocketContext'

interface AlertsContextValue {
  alerts: Alert[]
  total: number
  unreadCount: number
  loading: boolean
  error: string | null
  refetch: () => void
  markAsRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
}

const AlertsContext = createContext<AlertsContextValue | null>(null)

// Shared so the sidebar/topbar badge (INT-13's unreadCount) and AlertsPage's
// full list (INT-13/14) always reflect the same real backend state — and so
// a new_alert event (INT-18) updates both without a reload.
export function AlertsProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  const { lastAlert } = useSocket()

  const [alerts, setAlerts] = useState<Alert[]>([])
  const [total, setTotal] = useState(0)
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
        patientName: lastAlert.patientName,
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
      refetch: fetchAlerts, markAsRead, markAllRead,
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
