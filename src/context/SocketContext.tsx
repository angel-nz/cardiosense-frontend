import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { io, type Socket } from 'socket.io-client'
import type { SocketAlert, SocketPrediction, SocketHealthRecord, SocketPatientUpdate, SocketDashboardActivity, SocketPatientCreated, SocketPredictionUnavailable, SocketPredictionFailed, SocketAlertsChanged, SocketRiskForecastsChanged } from '@/types'
import { useAuth } from './AuthContext'
import { getAccessToken, subscribeToAccessToken } from '@/lib/tokenStore'
import { coordinateRefresh, handleSessionExpired } from '@/lib/refreshCoordinator'

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

// Y8D3-FIX1 — how long to wait before a bounded manual socket.connect()
// retry after a SESSION_VALIDATION_UNAVAILABLE handshake rejection (see
// scheduleDbErrorRetry below). Deliberately in the same 1s–5s range as
// socket.io-client's own built-in reconnectionDelay/reconnectionDelayMax
// (used for ordinary transport-level reconnection below) — this is not a
// new backoff architecture, just a single bounded delay reusing the same
// order of magnitude, since a middleware-rejected handshake needs an
// explicit socket.connect() call and does not benefit from that built-in
// mechanism at all (see the connect_error handler for why).
const DB_ERROR_RETRY_DELAY_MS = 3000

// Y8D4-FIX1 — same order of magnitude as DB_ERROR_RETRY_DELAY_MS above, for
// the same reason: a modest, bounded delay before the ONE manual
// socket.connect() retry the auth-recovery path (see scheduleAuthRecoveryRetry
// below) schedules after the shared refresh coordinator returns
// TRANSIENT/EXHAUSTED for a socket auth failure. Not a new backoff
// architecture — this timer's MEANING is deliberately kept distinct from
// dbErrorRetryTimerRef's (Y8D3-FIX1's SESSION_VALIDATION_UNAVAILABLE path
// never calls the refresh coordinator at all; this path exists specifically
// because it does), even though the mechanics are intentionally similar.
const AUTH_RECOVERY_RETRY_DELAY_MS = 3000

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
  // U2.2 — patient_created, same user:{userId} room. Invalidation-only:
  // "Total pacientes" may have changed, receiver must GET /patients again.
  lastPatientCreated: SocketPatientCreated | null
  // U8.6C — prediction_unavailable, same user:{userId} room. Ephemeral
  // informational signal (no Prediction exists for this outcome).
  lastPredictionUnavailable: SocketPredictionUnavailable | null
  // W4.2 — prediction_failed, same user:{userId} room and same "last event"
  // scalar pattern. Ephemeral, technical-failure-only signal, distinct from
  // prediction_unavailable (see SocketPredictionFailed in types/index.ts).
  lastPredictionFailed: SocketPredictionFailed | null
  // Y4-FIX2 — alerts_changed, same user:{userId} room and same "last event"
  // scalar pattern as lastAlert. Deliberately independent of lastAlert: it
  // fires regardless of NotificationPreference, while lastAlert only fires
  // when the relevant category's realtime toggle is on (see AlertsContext).
  lastAlertsChanged: SocketAlertsChanged | null
  // NEW S2E — risk_forecasts_changed, patient:{patientId} room (same
  // subscribe_patient membership as prediction_completed). Invalidation-only
  // refetch signal for the CURRENT projection set — never an Alert, toast,
  // sound, unread badge or notification-center item.
  lastRiskForecastsChanged: SocketRiskForecastsChanged | null
  subscribeToPatient: (patientId: string) => void
  unsubscribeFromPatient: (patientId: string) => void
  clearLastAlert: () => void
  clearLastPrediction: () => void
  clearLastHealthRecord: () => void
  clearLastPatientUpdate: () => void
  clearLastDashboardActivity: () => void
  clearLastPatientCreated: () => void
  clearLastPredictionUnavailable: () => void
  clearLastPredictionFailed: () => void
  clearLastAlertsChanged: () => void
  clearLastRiskForecastsChanged: () => void
}

const SocketContext = createContext<SocketContextValue | null>(null)

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  // Y5.2 — the access token used for the socket handshake is read from
  // lib/tokenStore.ts (the SAME single in-memory source api.ts's axios
  // interceptor reads), mirrored into local state via subscribeToAccessToken
  // purely so this component re-renders/re-runs its connection effect when
  // the token changes (a plain module variable can't drive a React effect's
  // dependency array on its own). This is a mirror, not a second source of
  // truth: it is never written to directly, only ever set from what the
  // store already holds.
  const [token, setToken] = useState<string | null>(() => getAccessToken())
  useEffect(() => subscribeToAccessToken(setToken), [])
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
  const [lastPatientCreated, setLastPatientCreated] = useState<SocketPatientCreated | null>(null)
  const [lastPredictionUnavailable, setLastPredictionUnavailable] = useState<SocketPredictionUnavailable | null>(null)
  const [lastPredictionFailed, setLastPredictionFailed] = useState<SocketPredictionFailed | null>(null)
  // Y4-FIX2 — same "last event" scalar pattern as the rest.
  const [lastAlertsChanged, setLastAlertsChanged] = useState<SocketAlertsChanged | null>(null)
  // NEW S2E — same "last event" scalar pattern; a coalesced burst collapses
  // into the latest value, which is harmless for a refetch-only signal.
  const [lastRiskForecastsChanged, setLastRiskForecastsChanged] = useState<SocketRiskForecastsChanged | null>(null)
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

  // Y8D3-FIX1 — at most ONE pending manual reconnect timer for a
  // SESSION_VALIDATION_UNAVAILABLE handshake rejection (see
  // scheduleDbErrorRetry/cancelDbErrorRetry below and the connect_error
  // handler). A component-level ref (not a plain closure variable inside
  // the connection effect) so it can be reliably cancelled from every
  // place that needs to — a successful connect, the effect's own cleanup
  // (covers both logout, since `isAuthenticated` is in this effect's
  // dependency array, and provider unmount) — even though a fresh
  // connect_error handler closure is created on every run of that effect.
  const dbErrorRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelDbErrorRetry = useCallback(() => {
    if (dbErrorRetryTimerRef.current) {
      clearTimeout(dbErrorRetryTimerRef.current)
      dbErrorRetryTimerRef.current = null
    }
  }, [])

  // Schedules a single bounded socket.connect() retry. Never accumulates
  // parallel timers: a DB_ERROR connect_error that fires while one is
  // already pending is a no-op here (the existing timer is left to run).
  // Reads `socketRef.current` only at FIRE time (not at schedule time), so
  // if the socket was already torn down by then (logout/unmount/token
  // rotation swapping in a new socket instance) this safely does nothing —
  // belt-and-suspenders alongside the explicit cancellation below, which
  // is the primary mechanism ensuring a logged-out user's old socket is
  // never manually reconnected.
  const scheduleDbErrorRetry = useCallback(() => {
    if (dbErrorRetryTimerRef.current) return
    dbErrorRetryTimerRef.current = setTimeout(() => {
      dbErrorRetryTimerRef.current = null
      socketRef.current?.connect()
    }, DB_ERROR_RETRY_DELAY_MS)
  }, [])

  // Y8D4-FIX1 — at most ONE pending manual socket.connect() retry after the
  // shared refresh coordinator returns TRANSIENT/EXHAUSTED for a socket AUTH
  // failure (connect_error's `isAuthFailure` branch below). A DIFFERENT ref
  // from dbErrorRetryTimerRef above — deliberately not merged with it, so
  // Y8D3-FIX1's SESSION_VALIDATION_UNAVAILABLE path (which must never call
  // the refresh coordinator) and this path (which exists only because the
  // coordinator was called) can never be confused or cancel one another by
  // accident, even though both are "one bounded manual reconnect timer"
  // mechanically. Same component-level-ref rationale as dbErrorRetryTimerRef
  // — reliably cancellable from every place that needs to (a successful
  // connect, this effect's own cleanup) despite a fresh connect_error
  // handler closure being created on every run of this effect.
  const authRecoveryRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelAuthRecoveryRetry = useCallback(() => {
    if (authRecoveryRetryTimerRef.current) {
      clearTimeout(authRecoveryRetryTimerRef.current)
      authRecoveryRetryTimerRef.current = null
    }
  }, [])

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
    //  - Y5.2 — `auth: { token }` is still a plain object snapshot, not a
    //    function, but it is NO LONGER a static one: `token` here is local
    //    state mirrored from lib/tokenStore.ts (see the subscription
    //    above), so every access-token rotation (silent refresh via
    //    api.ts, or the connect_error-triggered refresh just below) updates
    //    this state, which re-runs this WHOLE effect — tearing down the old
    //    socket and opening a brand-new one with the freshly rotated token.
    //    Recreating the connection on each rotation (rather than a
    //    function-based `auth` callback that re-authenticates an existing
    //    connection in place) is a deliberate simplicity choice: rotation
    //    is infrequent (bounded by the access token's own lifetime,
    //    JWT_EXPIRES_IN — 1h by default), so the cost of a fresh handshake
    //    each time is negligible, and reusing the exact
    //    teardown-then-recreate mechanism this effect already had for
    //    login/logout means no second, parallel re-auth code path exists.
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
      // Y8D3-FIX1 — a successful connect means any pending DB_ERROR manual
      // reconnect retry is no longer needed (whether it just fired and
      // succeeded, or a transport-level/other reconnect got there first).
      cancelDbErrorRetry()
      // Y8D4-FIX1 (SX11) — same reasoning, for the auth-recovery retry: a
      // successful connect (whether from this retry firing, from the token
      // subscription's effect-rerun recreating the socket after a SUCCESS
      // refresh, or from ordinary transport reconnection) makes any pending
      // manual auth-recovery retry stale.
      cancelAuthRecoveryRetry()
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
    // Y5.2, rewired Y8D4 — the one realistic gap a purely axios-driven
    // refresh can't cover: the app is open and idle with only the socket
    // connection live (no HTTP request has fired since the access token
    // expired), so nothing would otherwise trigger a refresh.
    // socketServer.ts's auth middleware rejects an expired/invalid token
    // with `Error('Invalid token')`/`Error('Authentication token
    // required')` — socket.io-client surfaces that as `connect_error` and,
    // left alone, would keep retrying forever with the SAME now-stale token
    // (the `auth` object is only re-read when THIS effect reruns, not on
    // every reconnection attempt). On an auth-shaped connect_error,
    // proactively run the SAME shared coordinator every other refresh
    // consumer uses (Y8D4 §28 — never a second, independent refresh
    // implementation):
    //   SUCCESS   → the coordinator has already installed the new token
    //               into lib/tokenStore.ts; the subscription above mirrors
    //               it into `token` state, which reruns this WHOLE effect
    //               (tearing down this socket, opening a fresh one with the
    //               new token in its `auth` object — see the effect's own
    //               header comment for why a full teardown+recreate is used
    //               here rather than re-authenticating in place). No
    //               separate "update the socket's token" step is needed:
    //               there is only ever one live socket instance at a time
    //               (React's effect-cleanup-before-next-effect-body
    //               ordering guarantees the old one is already disconnected
    //               before the new one is created), so this can never
    //               create a second, competing socket (Y8D4 §29).
    //   TERMINAL  → session is genuinely gone; same "give up" path api.ts's
    //               own retry-once exhaustion uses, rather than retrying a
    //               dead connection forever.
    //   TRANSIENT/EXHAUSTED → Y8D4-FIX1 (superseding the original Y8D4
    //               report's assumption here — see that block's own defect
    //               writeup): a middleware-rejected handshake leaves
    //               `socket.active === false` (the exact same Socket.IO
    //               semantics Y8D3-FIX1 already established for
    //               SESSION_VALIDATION_UNAVAILABLE below), so it does NOT
    //               feed into socket.io-client's built-in automatic
    //               reconnection — left alone, the socket would stay
    //               disconnected indefinitely even after the transient
    //               condition (an operational hiccup, or an unresolved
    //               multi-tab refresh race) clears. Must still NOT
    //               terminal-logout and must NOT create an uncontrolled
    //               reconnect loop — handled by scheduleAuthRecoveryRetry
    //               below: exactly one bounded delayed manual
    //               socket.connect() retry, with `handledAuthFailure`
    //               re-armed just before it fires so a recurring auth
    //               failure can still start a fresh coordinator burst
    //               rather than being silently ignored forever.
    let handledAuthFailure = false

    // Y8D4-FIX1 — schedules the one pending manual reconnect after a
    // TRANSIENT/EXHAUSTED coordinator outcome for THIS auth failure. Local
    // to this effect invocation (not hoisted to a component-level
    // useCallback) specifically because it closes over and re-arms this
    // invocation's own `handledAuthFailure` — mirroring how connect_error's
    // handler itself is already redefined fresh on every run of this
    // effect, per the header comment above.
    const scheduleAuthRecoveryRetry = () => {
      if (authRecoveryRetryTimerRef.current) return // at most one pending (SX09)
      authRecoveryRetryTimerRef.current = setTimeout(() => {
        authRecoveryRetryTimerRef.current = null // cleared BEFORE connect() (SX10)
        // Re-arm BEFORE reconnecting (SX07): without this, a repeat
        // 'Invalid token'/'Authentication token required' from the retried
        // handshake would find `handledAuthFailure` still true and never
        // start a fresh coordinator burst, leaving the socket stuck.
        handledAuthFailure = false
        socketRef.current?.connect()
      }, AUTH_RECOVERY_RETRY_DELAY_MS)
    }

    socket.on('connect_error', (err: Error) => {
      setConnected(false)
      const isAuthFailure = err.message === 'Invalid token' || err.message === 'Authentication token required'
      if (isAuthFailure && !handledAuthFailure) {
        handledAuthFailure = true
        void coordinateRefresh().then(outcome => {
          if (outcome.status === 'TERMINAL') {
            // Terminal still wins (§11) — no further auth-recovery retries
            // are scheduled once terminal invalidity has been demonstrated.
            handleSessionExpired()
            return
          }
          if (outcome.status === 'SUCCESS') {
            // The coordinator already installed the new token into
            // lib/tokenStore.ts; the subscription above mirrors it into
            // `token` state, rerunning this whole effect (see the effect's
            // own header comment) — nothing further to do here.
            return
          }
          // TRANSIENT or EXHAUSTED — NOT logout (Y8D4 §22/§23, unchanged).
          // Schedule the one bounded delayed manual reconnect so a
          // middleware-rejected handshake gets a future chance to recover
          // instead of staying disconnected forever.
          scheduleAuthRecoveryRetry()
        })
        return
      }

      // Y8D3-FIX1 (Defect A) — SESSION_VALIDATION_UNAVAILABLE is a
      // deliberate server-side MIDDLEWARE denial (socketServer.ts's
      // io.use(...) calling next(err) with this code when
      // assertActiveSession hits a DB error), not a transport-level
      // failure. Per Socket.IO's actual client semantics, a
      // middleware-rejected handshake leaves `socket.active === false` —
      // unlike a low-level transport error, it does NOT feed into the
      // built-in automatic-reconnection loop (reconnectionAttempts:
      // Infinity below only governs transport-level reconnection). Left
      // unhandled, a transient DB outage would therefore leave this socket
      // permanently disconnected even after the DB recovers, with no
      // automatic path back — the original Y8D3 report's assumption that
      // the existing reconnection config already covered this case was
      // incorrect, and this is the narrow fix.
      //
      // This branch must NEVER refresh the access token, clear it, call
      // handleSessionExpired, or broadcast logout — the credential itself
      // is not in question here, only whether session-validation
      // infrastructure (the DB) is currently reachable (Y8D3 §4/§6,
      // Y8C-R1 §15). It only schedules a single bounded manual
      // socket.connect() retry (scheduleDbErrorRetry, §3 above) — never a
      // new general reconnection architecture, and never more than one
      // timer pending at a time.
      const code = (err as Error & { data?: { code?: string } }).data?.code
      if (code === 'SESSION_VALIDATION_UNAVAILABLE') {
        scheduleDbErrorRetry()
      }
    })

    // INT-18 — new_alert → user:{userId} (personal room, always joined).
    socket.on('new_alert', (data: SocketAlert) => {
      setLastAlert(data)
    })

    // Y4-FIX2 — alerts_changed → same user:{userId} room, always joined,
    // never gated by NotificationPreference (unlike new_alert above).
    socket.on('alerts_changed', (data: SocketAlertsChanged) => {
      setLastAlertsChanged(data)
    })

    // O4.2 — dashboard_activity_changed → same user:{userId} room, no
    // subscribe_patient needed. Same "last event" scalar pattern as the
    // other three below — not a queue (documented limitation already
    // accepted for lastAlert/lastPrediction/lastHealthRecord); for an
    // invalidation-only signal consumed via canonical refetch, a coalesced
    // burst collapsing into the latest value is harmless, not lossy.
    socket.on('dashboard_activity_changed', (data: SocketDashboardActivity) => setLastDashboardActivity(data))
    // U2.2 — same user:{userId} room, same "last event" scalar pattern.
    socket.on('patient_created', (data: SocketPatientCreated) => setLastPatientCreated(data))
    // U8.6C — same user:{userId} room, same "last event" scalar pattern.
    socket.on('prediction_unavailable', (data: SocketPredictionUnavailable) => setLastPredictionUnavailable(data))
    // W4.2 — same user:{userId} room, same "last event" scalar pattern.
    socket.on('prediction_failed', (data: SocketPredictionFailed) => setLastPredictionFailed(data))

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
    // NEW S2E — S2D projection invalidation (patient room). A fresh object
    // per event, so consecutive identical payloads still re-trigger.
    socket.on('risk_forecasts_changed', (data: SocketRiskForecastsChanged) => setLastRiskForecastsChanged({ ...data }))

    socketRef.current = socket

    return () => {
      socket.disconnect()
      socketRef.current = null
      if (reconcileTimerRef.current) {
        clearTimeout(reconcileTimerRef.current)
        reconcileTimerRef.current = null
      }
      // Y8D3-FIX1 — this cleanup runs whenever `isAuthenticated` flips to
      // false (logout) or on provider unmount (both are this effect's own
      // dependency-driven teardown), as well as on every ordinary token
      // rotation. Any pending DB_ERROR manual-reconnect timer must never
      // outlive the socket it would have reconnected — cancelling it here
      // (rather than relying solely on the `socketRef.current` null-check
      // inside scheduleDbErrorRetry's callback) ensures a logged-out user's
      // old socket is never manually reconnected, and that no dangling
      // timer survives a provider unmount.
      cancelDbErrorRetry()
      // Y8D4-FIX1 (SX12/SX13/SX14) — same reasoning, for the auth-recovery
      // retry: this cleanup runs on logout (`isAuthenticated` flipping
      // false), on every ordinary token rotation (a SUCCESS refresh —
      // superseding any still-pending retry from an earlier TRANSIENT/
      // EXHAUSTED outcome, per §9), and on provider unmount alike. Without
      // this, a stale timer could fire `socket.connect()` on a socket that
      // no longer represents the current session/token, or after logout
      // when no coordinator invocation should occur at all.
      cancelAuthRecoveryRetry()
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
  }, [isAuthenticated, token, reconcile, scheduleDbErrorRetry, cancelDbErrorRetry, cancelAuthRecoveryRetry])

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
  const clearLastPatientCreated = useCallback(() => setLastPatientCreated(null), [])
  const clearLastPredictionUnavailable = useCallback(() => setLastPredictionUnavailable(null), [])
  const clearLastPredictionFailed = useCallback(() => setLastPredictionFailed(null), [])
  const clearLastAlertsChanged = useCallback(() => setLastAlertsChanged(null), [])
  const clearLastRiskForecastsChanged = useCallback(() => setLastRiskForecastsChanged(null), [])

  return (
    <SocketContext.Provider value={{
      connected,
      lastAlert,
      lastPrediction,
      lastHealthRecord,
      lastPatientUpdate,
      lastDashboardActivity,
      lastPatientCreated,
      lastPredictionUnavailable,
      lastPredictionFailed,
      lastAlertsChanged,
      lastRiskForecastsChanged,
      subscribeToPatient,
      unsubscribeFromPatient,
      clearLastAlert,
      clearLastPrediction,
      clearLastHealthRecord,
      clearLastPatientUpdate,
      clearLastDashboardActivity,
      clearLastPatientCreated,
      clearLastPredictionUnavailable,
      clearLastPredictionFailed,
      clearLastAlertsChanged,
      clearLastRiskForecastsChanged,
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
