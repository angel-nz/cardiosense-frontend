import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { io, type Socket } from 'socket.io-client'
import type { SocketAlert, SocketPrediction, SocketHealthRecord, SocketPatientUpdate, SocketDashboardActivity } from '@/types'
import { useAuth } from './AuthContext'

// Same host as the backend, without the /api prefix (Socket.IO attaches to
// the same HTTP server as Express but is not under /api — see
// backend/src/index.ts + socket/socketServer.ts). Already scaffolded in
// .env.example/.env.local as VITE_SOCKET_URL, just never consumed until now.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3001'

// How long to wait before actually emitting a subscribe/unsubscribe change.
// This is NOT a UX debounce — it exists purely to collapse React 18
// StrictMode's synchronous dev-only mount→cleanup→mount double-invoke of
// effects into a single net operation (see subscribeToPatient/
// unsubscribeFromPatient below for the full explanation). 0ms is enough
// because StrictMode's double-invoke is fully synchronous; a macrotask
// always runs after it settles.
const RECONCILE_DELAY_MS = 0

interface SocketContextValue {
  connected: boolean
  lastAlert: SocketAlert | null
  lastPrediction: SocketPrediction | null
  lastHealthRecord: SocketHealthRecord | null
  lastPatientUpdate: SocketPatientUpdate | null
  // O4.2 — dashboard_activity_changed, same user:{userId} room as lastAlert.
  // Invalidation-only: no timeline data, just "refetch your canonical
  // Dashboard Calendar state" for whichever consumer cares.
  lastDashboardActivity: SocketDashboardActivity | null
  subscribeToPatient: (patientId: string) => void
  unsubscribeFromPatient: (patientId: string) => void
  clearLastAlert: () => void
  clearLastPrediction: () => void
  clearLastHealthRecord: () => void
  clearLastPatientUpdate: () => void
  clearLastDashboardActivity: () => void
}

const SocketContext = createContext<SocketContextValue | null>(null)

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, token } = useAuth()
  const [connected, setConnected] = useState(false)
  const [lastAlert, setLastAlert] = useState<SocketAlert | null>(null)
  // INT-19/20/21 — all three follow the exact same pattern as lastAlert:
  // a single scalar set by the corresponding listener below, read by
  // whichever page is currently subscribed to that patient, and cleared by
  // the consumer once processed (clearLast*). None of these are queues —
  // same documented limitation as lastAlert if multiple events of the same
  // kind arrive faster than a consumer processes them.
  const [lastPrediction, setLastPrediction] = useState<SocketPrediction | null>(null)
  const [lastHealthRecord, setLastHealthRecord] = useState<SocketHealthRecord | null>(null)
  const [lastPatientUpdate, setLastPatientUpdate] = useState<SocketPatientUpdate | null>(null)
  const [lastDashboardActivity, setLastDashboardActivity] = useState<SocketDashboardActivity | null>(null)
  const socketRef = useRef<Socket | null>(null)

  // ─── INT-16/17 subscription reconciliation ──────────────────────────────
  // Two refs model two different things:
  //   desiredPatientRef — what the currently-mounted page(s) WANT joined
  //                       (set synchronously by subscribeToPatient/
  //                       unsubscribeFromPatient; always reflects the
  //                       latest call immediately, no delay)
  //   activePatientRef  — what the server currently has us ACTUALLY joined
  //                       to (only updated when an emit really happens)
  // reconcile() is the only place that ever calls socket.emit for these
  // events. It's scheduled (debounced) by subscribe/unsubscribe calls, and
  // invoked directly (no delay) on 'connect'. Debouncing collapses bursts of
  // calls — in particular React 18 StrictMode's dev-only double-invoke of
  // the mounting effect (mount → cleanup → mount, all synchronous) — into a
  // single net emission, while still preserving exact ordering
  // (unsubscribe-old, then subscribe-new) for real navigation between
  // patients.
  const desiredPatientRef = useRef<string | null>(null)
  const activePatientRef = useRef<string | null>(null)
  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reconcile = useCallback(() => {
    reconcileTimerRef.current = null
    const socket = socketRef.current
    if (!socket?.connected) return // will be retried by the 'connect' handler below

    const desired = desiredPatientRef.current
    const active = activePatientRef.current
    if (desired === active) return // already correct — idempotent no-op

    if (active) socket.emit('unsubscribe_patient', active)
    if (desired) socket.emit('subscribe_patient', desired)
    activePatientRef.current = desired
  }, [])

  const scheduleReconcile = useCallback(() => {
    if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current)
    reconcileTimerRef.current = setTimeout(reconcile, RECONCILE_DELAY_MS)
  }, [reconcile])

  useEffect(() => {
    if (!isAuthenticated || !token) return

    // INT-15 — reconnection lifecycle. socket.io-client already reconnects
    // automatically with exponential backoff by default; these options are
    // set EXPLICITLY (rather than left implicit) so the decision is
    // documented, not accidental. Values mirror the library's own defaults
    // — no custom backoff/retry logic was written, per the instruction not
    // to reimplement what socket.io-client already provides.
    //
    // What was verified, not (re)implemented, during this audit:
    //  - Reconnection reuses the SAME Socket instance — `socket.on(...)`
    //    handlers registered once below stay valid across reconnects; no
    //    duplicate listeners accumulate from reconnection itself.
    //  - Exactly one socket exists at a time: this effect's cleanup always
    //    disconnects the previous socket before a new one is created
    //    (guaranteed by React's effect ordering on dependency change).
    //  - Logout already disconnects correctly: `isAuthenticated` becoming
    //    false is in this effect's dependency array, so its cleanup runs
    //    (disconnecting) with no separate logout-specific code needed.
    //  - `auth: { token }` is a static snapshot, not a function — that's
    //    intentional here: this app never rotates/refreshes a token while
    //    a session is live (no silent refresh exists — see AuthContext),
    //    so the token can only change via a full logout→login, which
    //    already tears down and recreates this effect (and thus the
    //    socket) with the new token. A function-based `auth` callback
    //    would add complexity with no scenario in this app to justify it.
    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    })

    socket.on('connect', () => {
      setConnected(true)
      // Room membership is per-connection state on the server —
      // socketServer.ts only auto-joins `user:{userId}` inside its
      // `connection` handler, so any `patient:{id}` room joined before a
      // disconnect is lost server-side. Treat "active" as reset and
      // reconcile immediately (not debounced) so the currently-desired
      // patient (if any) is rejoined exactly once. This is the minimal
      // reconnection behavior needed for INT-16/17; full reconnection
      // lifecycle (backoff, connection-status UI, etc.) is INT-15 and not
      // implemented here.
      activePatientRef.current = null
      reconcile()
    })
    socket.on('disconnect', () => {
      setConnected(false)
      // The server has already dropped our room memberships at this point.
      activePatientRef.current = null
    })
    socket.on('connect_error', () => setConnected(false))

    // INT-18 — new_alert → user:{userId} (personal room, always joined).
    socket.on('new_alert', (data: SocketAlert) => setLastAlert(data))

    // O4.2 — dashboard_activity_changed → same user:{userId} room, no
    // subscribe_patient needed. Same "last event" scalar pattern as the
    // other three below — not a queue (documented limitation already
    // accepted for lastAlert/lastPrediction/lastHealthRecord); for an
    // invalidation-only signal consumed via canonical refetch, a coalesced
    // burst collapsing into the latest value is harmless, not lossy.
    socket.on('dashboard_activity_changed', (data: SocketDashboardActivity) => setLastDashboardActivity(data))

    // INT-19/20/21 — all three are emitted to patient:{patientId} (see
    // socketServer.ts room joins via subscribe_patient/INT-16), so this
    // client only ever receives them for whichever patient is currently
    // subscribed via subscribeToPatient(). No per-event filtering needed
    // here — the room membership itself is the filter; consumers still
    // compare payload.patientId against their own route param before
    // acting, in case a stale event arrives just after navigating away.
    socket.on('prediction_completed', (data: SocketPrediction) => setLastPrediction(data))
    socket.on('health_record_created', (data: SocketHealthRecord) => setLastHealthRecord(data))
    socket.on('patient_updated', (data: SocketPatientUpdate) => setLastPatientUpdate(data))

    socketRef.current = socket

    return () => {
      socket.disconnect()
      socketRef.current = null
      if (reconcileTimerRef.current) {
        clearTimeout(reconcileTimerRef.current)
        reconcileTimerRef.current = null
      }
      // Only reset what the TRANSPORT owns (active = server-side room
      // state, which really is gone once this socket is torn down). Do
      // NOT reset desiredPatientRef here — that represents page-level
      // intent ("which patient is currently open"), a completely separate
      // lifecycle from the socket connection's own. Resetting it on every
      // connection-effect cleanup (including StrictMode's dev-only
      // mount→cleanup→mount of THIS effect) could wipe out a subscription
      // a page component just requested, independent of ordering between
      // the two effects.
      activePatientRef.current = null
      setConnected(false)
    }
  }, [isAuthenticated, token, reconcile])

  // INT-16 — join patient:{patientId}. Contract verified directly against
  // socketServer.ts: the handler is `socket.on('subscribe_patient',
  // (patientId: string) => ...)` — it expects the BARE STRING, not
  // `{ patientId }`. Emitting an object would silently no-op server-side
  // (`typeof patientId !== 'string'` guard). No ack/callback exists on the
  // backend handler, so this is fire-and-forget by design.
  //
  // Idempotent by construction: calling this twice in a row with the same
  // id just overwrites desiredPatientRef with the same value — reconcile()
  // sees desired === active (once settled) and emits nothing.
  const subscribeToPatient = useCallback((patientId: string) => {
    if (typeof patientId !== 'string' || !patientId.trim()) {
      console.warn('[Socket] subscribeToPatient: invalid patientId', patientId)
      return
    }
    desiredPatientRef.current = patientId
    scheduleReconcile()
  }, [scheduleReconcile])

  // INT-17 — leave patient:{patientId}. Same bare-string contract as above.
  // Never touches the `user:{userId}` room or any other listener.
  //
  // Only clears desiredPatientRef if it currently matches this patientId —
  // a stale/repeated unsubscribe call for a patient that's no longer the
  // desired one is a no-op (idempotent), so a fast subscribe(B) immediately
  // after unsubscribe(A) can never be undone by a late/duplicate
  // unsubscribe(A) call.
  const unsubscribeFromPatient = useCallback((patientId: string) => {
    if (typeof patientId !== 'string' || !patientId.trim()) {
      console.warn('[Socket] unsubscribeFromPatient: invalid patientId', patientId)
      return
    }
    if (desiredPatientRef.current !== patientId) return
    desiredPatientRef.current = null
    scheduleReconcile()
  }, [scheduleReconcile])

  const clearLastAlert = useCallback(() => setLastAlert(null), [])
  const clearLastPrediction = useCallback(() => setLastPrediction(null), [])
  const clearLastHealthRecord = useCallback(() => setLastHealthRecord(null), [])
  const clearLastPatientUpdate = useCallback(() => setLastPatientUpdate(null), [])
  const clearLastDashboardActivity = useCallback(() => setLastDashboardActivity(null), [])

  return (
    <SocketContext.Provider value={{
      connected,
      lastAlert,
      lastPrediction,
      lastHealthRecord,
      lastPatientUpdate,
      lastDashboardActivity,
      subscribeToPatient,
      unsubscribeFromPatient,
      clearLastAlert,
      clearLastPrediction,
      clearLastHealthRecord,
      clearLastPatientUpdate,
      clearLastDashboardActivity,
    }}>
      {children}
    </SocketContext.Provider>
  )
}

export function useSocket(): SocketContextValue {
  const ctx = useContext(SocketContext)
  if (!ctx) throw new Error('useSocket must be used inside SocketProvider')
  return ctx
}
