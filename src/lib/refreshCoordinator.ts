// Y8D4 — the ONE shared cross-tab refresh coordinator, and the ONE
// remaining low-level implementation of `POST /auth/refresh` anywhere in
// the frontend. Before this block there were TWO independent bare-axios
// implementations (services/api.ts's private `performRefresh` and
// services/authService.ts's `refresh()`), each with its own, incompatible
// idea of what a refresh failure meant, and NEITHER understood the Y8D1
// backend contract's 409 REFRESH_CONFLICT outcome at all. This module
// replaces both.
//
// Consumed by exactly three callers, none of which retain an independent
// refresh implementation of their own:
//   - services/api.ts's response interceptor (401 recovery on a protected
//     request)
//   - context/AuthContext.tsx's bootstrap effect (session restoration on
//     load)
//   - context/SocketContext.tsx's connect_error handler (socket auth-
//     failure recovery)
//
// Deliberately placed under `lib/` (not `services/`): `lib/` modules here
// only ever import from other `lib/` modules (see lib/normalizeUser.ts),
// never from `services/`, which is what keeps this module free of a
// refreshCoordinator ↔ authService ↔ api circular dependency — services/
// api.ts and context/AuthContext.tsx/SocketContext.tsx both import FROM
// this module; this module imports from neither of them (Y8D4 §27).
import axios, { isAxiosError } from 'axios'
import { setAccessToken, clearAccessToken } from '@/lib/tokenStore'
import { normalizeUser, type BackendAuthPayload, type BackendUser } from '@/lib/normalizeUser'
import type { User } from '@/types'

// Same fallback literal already duplicated identically between api.ts and
// (pre-Y8D4) authService.ts — kept as an independent copy here rather than
// imported from api.ts specifically to avoid the circular-dependency risk
// noted above (api.ts needs to import FROM this module for its
// interceptor; this module must never import anything back from api.ts).
const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api'

// ─── Explicit constants (Y8D4 §35) ─────────────────────────────────────
// Centralized here rather than scattered as magic numbers across
// AuthContext/SocketContext/api.ts.

// Web Locks (§10) — one origin-scoped lock name covering a full refresh
// request/response lifecycle.
const WEB_LOCK_NAME = 'cardiosense-refresh'

// BroadcastChannel (§9) — low-latency "a successful refresh just
// completed" signal. Carries no token/PII; the durable localStorage
// generation below is what a listener that missed this re-reads.
const REFRESH_CHANNEL_NAME = 'cardiosense_refresh_channel'

// localStorage (§7/§8) — the durable, non-secret, origin-level "some tab
// completed a successful refresh rotation" counter. Deliberately NOT
// scoped per-sid (bootstrap may run before this tab has any sid-bearing
// access token at all — §7).
const REFRESH_GENERATION_KEY = 'cardiosense_successful_refresh_generation'

// No-Web-Locks fallback bounded conflict-recovery budget (§13/§15/§16):
// how long to wait, after a 409, for another tab's generation to advance
// before treating the conflict as non-progressing.
const CONFLICT_WAIT_MS = 1500
// Small random jitter (0..JITTER_MAX_MS) before a losing tab's next
// attempt, to avoid several tabs retrying in lockstep (§17 — herd control,
// not security).
const JITTER_MAX_MS = 250
// Bound on PROGRESSING conflicts within one burst (§14/§15) — genuine
// forward progress keeps being allowed up to this count, not just once.
const MAX_PROGRESSING_CONFLICTS = 5
// Total wall-clock budget for one coordinated refresh burst (§15) — chosen
// to be long enough to absorb several legitimate multi-tab races but short
// enough that the app never appears frozen for long.
const REFRESH_BURST_BUDGET_MS = 8000

// ─── Cross-tab EXPLICIT logout signal — distinct from refresh coordination
// (Y8D4 §30: "do not repurpose the logout key as refresh coordination; use
// separate refresh-coordination key/channel names" — done above). Moved
// here verbatim from services/api.ts, which no longer owns any refresh
// machinery to keep it beside. Still exported for AuthContext's own
// explicit user-initiated logout() and its `storage` listener.
export const CROSS_TAB_LOGOUT_KEY = 'cardiosense_logout_event'

export function broadcastLogout(): void {
  try {
    localStorage.setItem(CROSS_TAB_LOGOUT_KEY, String(Date.now()))
  } catch {
    // Best-effort cross-tab convenience — must never block this tab's own
    // logout (private/incognito mode, quota exceeded, disabled by policy).
  }
}

// The one place that ends a session client-side for good on a GENUINE
// terminal failure: broadcasts the cross-tab logout signal, then a full
// page navigation (not a router push) so every piece of React state
// restarts clean. Moved here verbatim from services/api.ts. Exported
// (rather than kept private to this module's own TERMINAL branch) because
// services/api.ts's response interceptor still needs to call this directly
// for its own retry-already-exhausted guard (a request that already retried
// once after a successful refresh and got 401 AGAIN — a case that must
// short-circuit straight to terminal handling without invoking the
// coordinator a second time, see api.ts).
export function handleSessionExpired(): void {
  broadcastLogout()
  window.location.href = '/login'
}

// ─── Outcome model (Y8D4 §6) ───────────────────────────────────────────
// REFRESH_CONFLICT is handled entirely INSIDE the bounded burst below — it
// is never returned to a caller as its own outcome, only ever resolved
// into one of these four.
export type RefreshOutcome =
  | { status: 'SUCCESS'; accessToken: string; user: User }
  | { status: 'TERMINAL' }
  | { status: 'TRANSIENT' }
  | { status: 'EXHAUSTED' }

// ─── Low-level network call — THE ONE implementation (§3) ─────────────
// Bare axios (not the `api` instance): must never pass back through
// api.ts's own response interceptor (which itself calls into this module),
// so it cannot recurse into itself. No Authorization header is ever sent —
// the HttpOnly refresh cookie is the sole credential, attached
// automatically by the browser via `withCredentials`.
type Attempt =
  | { kind: 'SUCCESS'; accessToken: string; user: BackendUser }
  | { kind: 'TERMINAL' }
  | { kind: 'TRANSIENT' }
  | { kind: 'CONFLICT' }

async function attemptRawRefresh(): Promise<Attempt> {
  try {
    const { data } = await axios.post<BackendAuthPayload>(
      `${BASE_URL}/auth/refresh`,
      undefined,
      { withCredentials: true },
    )
    return { kind: 'SUCCESS', accessToken: data.accessToken, user: data.user }
  } catch (err) {
    if (!isAxiosError(err)) {
      // A non-Axios throw here is not a statement about credential/session
      // validity either — never conflate it with TERMINAL.
      return { kind: 'TRANSIENT' }
    }

    const status = err.response?.status
    // Y8D4 §20 — detect conflict ONLY via the structured
    // {status:409, data:{code:'REFRESH_CONFLICT'}} shape, never by parsing
    // a human-readable message string, so an unrelated 409 elsewhere can
    // never accidentally enter refresh recovery.
    const code = (err.response?.data as { code?: string } | undefined)?.code

    if (status === 409 && code === 'REFRESH_CONFLICT') return { kind: 'CONFLICT' }
    // Y8D1's contract: a genuine terminal refresh failure is 401.
    if (status === 401) return { kind: 'TERMINAL' }
    // Everything else — network error (no response at all), 5xx/503
    // operational failure, or any other unexpected status — is treated as
    // an operational/transient condition, never terminal (Y8D1 §12 already
    // guarantees the backend itself never conflates a DB outage with an
    // invalid credential; this mirrors that same discipline client-side).
    return { kind: 'TRANSIENT' }
  }
}

// ─── Generation storage (§7/§8/§34) ────────────────────────────────────
function readGeneration(): number {
  try {
    const raw = localStorage.getItem(REFRESH_GENERATION_KEY)
    if (raw === null) return 0
    const n = parseInt(raw, 10)
    // Robust parsing (§8): missing/malformed/negative/non-finite → safe
    // baseline of 0. Corrupt localStorage must never break authentication.
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch {
    // localStorage unavailable (private mode, quota, policy) — degrade to
    // "no reliable progress signal" (§8/§19), never throw.
    return 0
  }
}

function bumpGeneration(): void {
  try {
    const next = readGeneration() + 1
    localStorage.setItem(REFRESH_GENERATION_KEY, String(next))
  } catch {
    // Best-effort only — a storage failure here degrades coordination for
    // OTHER tabs, but must never fail THIS tab's own already-successful
    // refresh (§8/§19).
  }
  postGenerationAdvanced()
}

function hasBroadcastChannel(): boolean {
  return typeof BroadcastChannel !== 'undefined'
}

// Payload carries no access token, refresh token, sid, or user PII (§9) —
// it is purely a low-latency "go re-read the durable generation" nudge.
function postGenerationAdvanced(): void {
  if (!hasBroadcastChannel()) return
  try {
    const ch = new BroadcastChannel(REFRESH_CHANNEL_NAME)
    ch.postMessage({ type: 'refresh-generation-advanced' })
    ch.close()
  } catch {
    // Best-effort signal only — the durable generation value is always
    // re-readable regardless (§9/§15).
  }
}

// Resolves `true` as soon as the persisted generation is observed to exceed
// `expected`, or `false` after `timeoutMs` with no such observation.
// Multiple redundant signals feed the same check so a missed event never
// strands a waiting tab (§18): an immediate re-read (covers the case where
// generation already advanced before this was even called), the
// `storage` event (fires in THIS tab whenever ANOTHER tab/document writes
// localStorage), and BroadcastChannel (lower latency, may fire even where
// `storage` is slow to propagate). Listener and timer cleanup always runs
// exactly once, however the promise settles (§18 — no leaks).
function waitForGenerationAdvance(expected: number, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false
    const cleanups: Array<() => void> = []

    const finish = (result: boolean) => {
      if (settled) return
      settled = true
      cleanups.forEach(fn => fn())
      resolve(result)
    }

    if (readGeneration() > expected) {
      finish(true)
      return
    }

    const check = () => {
      if (readGeneration() > expected) finish(true)
    }

    const onStorage = (e: StorageEvent) => {
      // `e.key === null` covers a wholesale localStorage.clear() — treat
      // it as "go re-check", harmless if generation didn't actually move.
      if (e.key === REFRESH_GENERATION_KEY || e.key === null) check()
    }
    window.addEventListener('storage', onStorage)
    cleanups.push(() => window.removeEventListener('storage', onStorage))

    if (hasBroadcastChannel()) {
      try {
        const channel = new BroadcastChannel(REFRESH_CHANNEL_NAME)
        channel.onmessage = check
        cleanups.push(() => channel.close())
      } catch {
        // BroadcastChannel unavailable/throws — storage-event + timeout
        // fallback below still functions (§9/§19).
      }
    }

    const timer = setTimeout(() => finish(false), timeoutMs)
    cleanups.push(() => clearTimeout(timer))
  })
}

function jitterDelay(): Promise<void> {
  const ms = Math.floor(Math.random() * JITTER_MAX_MS)
  return new Promise(resolve => setTimeout(resolve, ms))
}

function hasWebLocks(): boolean {
  return typeof navigator !== 'undefined' &&
    !!navigator.locks &&
    typeof navigator.locks.request === 'function'
}

// ─── Bounded conflict-recovery burst (§13/§14/§15/§16) ────────────────
// Shared by BOTH the Web Locks path and the no-Web-Locks fallback path
// (see runCoordinatedAttempt below) — an unexpected 409 under Web Locks is
// fed through this exact same machinery rather than a second one (§12),
// since normal same-browser contention should not produce a 409 under
// correct full-cycle Web Locks, but an external actor or a non-conforming
// context still could.
//
// A waiting tab ALWAYS performs its own attemptRawRefresh() first — this
// function never short-circuits on an observed generation advance instead
// of actually calling the endpoint (§11): the very first thing every
// invocation and every retry does is call attemptRawRefresh().
async function runBoundedBurst(): Promise<RefreshOutcome> {
  const burstStart = Date.now()
  let observedGeneration = readGeneration()
  let progressingConflicts = 0
  let usedDefensiveRetry = false

  for (;;) {
    const attempt = await attemptRawRefresh()

    if (attempt.kind === 'SUCCESS') {
      // Y8D4 §31 — deterministic order: HTTP success already received
      // (Set-Cookie already processed by the browser by the time `await`
      // resolves) → install this tab's own new in-memory access token →
      // bump the durable generation (+ best-effort broadcast) → resolve
      // SUCCESS. No other local consumer can observe "refresh completed"
      // in this tab before this tab has installed its own token.
      setAccessToken(attempt.accessToken)
      bumpGeneration()
      return { status: 'SUCCESS', accessToken: attempt.accessToken, user: normalizeUser(attempt.user) }
    }

    if (attempt.kind === 'TERMINAL') {
      // Y8D1's genuine terminal case. Clearing the in-memory token here is
      // universally correct for every caller (a dead credential should
      // never keep being offered) — whether that also means broadcasting
      // a cross-tab logout and navigating to /login is a per-CALLER
      // decision, not this module's (see handleSessionExpired's own call
      // sites in api.ts/SocketContext.tsx, and the deliberate bootstrap
      // exception documented in AuthContext.tsx — Y8D4 §21 vs §26).
      clearAccessToken()
      return { status: 'TERMINAL' }
    }

    if (attempt.kind === 'TRANSIENT') {
      // §22 — never clear the token, never broadcast logout, never
      // redirect solely because of an operational failure. The existing
      // access token (if any) is left exactly as it was.
      return { status: 'TRANSIENT' }
    }

    // attempt.kind === 'CONFLICT' — §6/§13/§14.
    if (Date.now() - burstStart > REFRESH_BURST_BUDGET_MS) {
      return { status: 'EXHAUSTED' }
    }

    const advanced = await waitForGenerationAdvance(observedGeneration, CONFLICT_WAIT_MS)
    const currentGeneration = readGeneration()

    if (advanced && currentGeneration > observedGeneration) {
      // PROGRESSING CONFLICT — another tab demonstrably completed a
      // successful refresh while we waited. Update our watermark and try
      // again (bounded by MAX_PROGRESSING_CONFLICTS, not just once — §14).
      progressingConflicts += 1
      observedGeneration = currentGeneration
      if (progressingConflicts > MAX_PROGRESSING_CONFLICTS) {
        return { status: 'EXHAUSTED' }
      }
      await jitterDelay()
      continue
    }

    // NON-PROGRESSING CONFLICT — no generation advance was observed within
    // the bounded wait. At most ONE defensive delayed retry per burst.
    if (usedDefensiveRetry) {
      return { status: 'EXHAUSTED' }
    }
    usedDefensiveRetry = true
    await jitterDelay()
    // continue — the defensive retry itself still respects the overall
    // wall-clock budget checked at the top of the next iteration.
  }
}

// Web Locks primary path (§10/§11/§12): the lock covers the COMPLETE
// request/response lifecycle of runBoundedBurst — including any bounded
// conflict recovery it needs — not just the bare HTTP call, so a losing
// tab's `navigator.locks.request` callback only starts once the winning
// tab has fully finished (successful Set-Cookie processed, its own token
// installed, generation bumped) and released the lock.
async function runWithWebLock(): Promise<RefreshOutcome> {
  // navigator.locks.request<T>'s TS typing infers T from the callback's
  // OWN declared return type (not its awaited value), so a callback
  // returning `Promise<RefreshOutcome>` makes this call's static type
  // `Promise<Promise<RefreshOutcome>>` even though the browser's actual
  // runtime behavior already awaits the callback before resolving. `await`
  // uses TypeScript's recursive `Awaited<T>` unwrapping, so awaiting here
  // (rather than returning the call directly) correctly narrows back down
  // to `RefreshOutcome` — this is a TS lib-typing quirk, not a behavior
  // change: the lock still fully covers runBoundedBurst()'s entire
  // request/response lifecycle exactly as intended (§10).
  return await navigator.locks.request(WEB_LOCK_NAME, () => runBoundedBurst())
}

// ─── In-tab single flight (§5) ─────────────────────────────────────────
// Wraps the WHOLE coordinated operation (lock acquisition + the entire
// bounded burst), not just one HTTP attempt — several simultaneous 401s
// (or a 401 racing a socket auth failure) in ONE tab must never each
// acquire their own Web Lock; they all await this SAME promise.
let inFlight: Promise<RefreshOutcome> | null = null

export function coordinateRefresh(): Promise<RefreshOutcome> {
  if (!inFlight) {
    const run = hasWebLocks() ? runWithWebLock() : runBoundedBurst()
    inFlight = run.finally(() => {
      inFlight = null
    })
  }
  return inFlight
}
