import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { User, AuthState } from '@/types'
import { authService } from '@/services/authService'
import { setAccessToken, clearAccessToken } from '@/lib/tokenStore'
import { CROSS_TAB_LOGOUT_KEY, broadcastLogout, coordinateRefresh } from '@/lib/refreshCoordinator'

interface AuthContextValue extends AuthState {
  // Z6-R1 — `identifier` may be an email or a canonical E.164 phone
  // (LoginPage resolves which one, see its own identifier-mode toggle).
  // Z6-R1-FIX1 §1/§3 — `method` is the explicit, required discriminant for
  // which kind `identifier` is (LoginPage's mode toggle is the source of
  // truth) — this just forwards whatever the caller already resolved to
  // authService.login, unchanged in every other respect.
  login: (method: 'EMAIL' | 'PHONE', identifier: string, password: string) => Promise<void>
  // Y5.2-FIX1 — adopts an already-established session (token + user already
  // returned by the backend, which has ALREADY created the session and set
  // the refresh cookie) without calling any backend endpoint itself. `login`
  // is built on top of this; RegisterPage calls it directly after a
  // successful POST /auth/register so registration does not need a second
  // POST /auth/login (which would create a SECOND, redundant session row —
  // exactly what this fix removes).
  adoptSession: (token: string, user: User) => void
  logout: () => Promise<void>
  setUser: (user: User) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Y5.2 — full rewrite. There is no more `cardiosense_token`/`cardiosense_user`
// localStorage authority: the access token lives only in lib/tokenStore.ts
// (in-memory), and the session itself is carried by the HttpOnly
// `cardiosense_refresh` cookie the backend sets — this file never reads or
// writes that cookie directly (browsers don't expose HttpOnly cookies to
// JS at all; that's the point). On every fresh load (including a hard
// reload), this Provider "bootstraps" by asking the backend to redeem
// whatever refresh cookie the browser already holds, rather than trusting
// any client-side cache of who was logged in.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
  })

  // Y5.2-FIX3 — StrictMode-safe single-flight bootstrap. React 18
  // StrictMode (main.tsx) synchronously mounts this component, runs this
  // effect, "unmounts" it (runs its cleanup), then "remounts" it (runs the
  // effect again) — all in the same tick, before any real async result has
  // come back. Two consequences follow, both found during this block's
  // required source inspection:
  //
  //  1. Without a single-flight guard, the effect's own body would call
  //     authService.refresh() TWICE, producing two real
  //     POST /auth/refresh network requests for one logical startup. The
  //     single-use refresh credential can only be rotated once — backend
  //     CAS/replay protection (session.ts::rotateSession) correctly lets
  //     exactly one of the two win; the loser gets its own failure
  //     response, which — if applied — could Clear-Cookie a session the
  //     winner just established. A ref that merely ignores a stale JS
  //     callback cannot undo that: the browser has already processed both
  //     requests' actual Set-Cookie/Clear-Cookie by the time any JS runs.
  //     The fix has to prevent the SECOND network request from ever being
  //     sent, not just discard its result — `bootstrapPromiseRef` below
  //     does that: the first effect invocation creates the one real
  //     request and stores its promise; the second invocation sees a
  //     promise already there and reuses it, so there is only ever one
  //     underlying HTTP call per logical startup.
  //
  //  2. Separately: this file previously used a shared `mountedRef` (set
  //     to `false` by an effect's cleanup, never reset back to `true`) to
  //     guard the bootstrap `.then()`/`.catch()` callbacks. That pattern is
  //     unsound under this same StrictMode double-invoke — its cleanup
  //     fires during the synthetic unmount and nothing ever sets it back
  //     to `true` on the synthetic remount, so EVERY later bootstrap
  //     result, even a correctly single-flighted one, would have been
  //     silently discarded, leaving `isLoading` stuck at `true` forever in
  //     development. That would violate this same block's required
  //     invariant that isLoading actually settles once the one logical
  //     bootstrap operation resolves, so it is corrected here as part of
  //     the same fix rather than left as separate, unrelated debt — it is
  //     the same StrictMode-double-invoke bug class this block exists to
  //     fix, just found in a second place. The replacement is the
  //     standard, StrictMode-safe pattern: a per-INVOCATION `ignore` flag,
  //     closured locally inside each effect call rather than shared — the
  //     first invocation's cleanup marks ITS OWN closure stale; the second
  //     invocation gets its own fresh flag and is unaffected, so the live
  //     invocation's result is applied exactly once.
  // Y8D4 — return type widened from `{token, user} | null` to the full
  // coordinator RefreshOutcome shape (see the rewritten effect body below):
  // bootstrap must now distinguish TERMINAL (genuinely no session) from
  // TRANSIENT/EXHAUSTED (unknown for now, NOT a statement that the session
  // is invalid — Y8D4 §26), which the old boolean-ish `null` could not
  // express.
  const bootstrapPromiseRef = useRef<ReturnType<typeof coordinateRefresh> | null>(null)

  // Y5.2-FIX1's `authSettledRef` (a shared latch marking "an explicit
  // adoptSession/logout already decided state, ignore any later bootstrap
  // result") is REMOVED in this block, not merely re-documented.
  // Source-level proof it is now fully redundant, per this block's own
  // required re-evaluation: `adoptSession` has exactly two references —
  // `login()` (called only from LoginPage) and RegisterPage.tsx directly;
  // `logout()` has exactly one external caller (Topbar.tsx) plus its own
  // definition here — grepped exhaustively this block, no other call sites
  // exist anywhere in the frontend. Every one of those callers sits inside
  // a component that can only mount once bootstrap has already settled:
  // LoginPage/RegisterPage are gated by PublicRoute (`isLoading:true` → no
  // `<Outlet/>`, so no mounted form to submit), and Topbar (and every
  // other authenticated component) is gated the same way by ProtectedRoute.
  // So the scenario authSettledRef existed to prevent — an explicit action
  // settling state, then a stale bootstrap result overwriting it — is
  // structurally impossible: first by FIX2's PublicRoute/ProtectedRoute
  // gating (no explicit action can even start while isLoading is true),
  // and now also by this effect's own single-flight + per-invocation
  // `ignore` flag, which makes the bootstrap effect's own
  // result-application exactly-once and StrictMode-correct regardless.
  // Keeping authSettledRef would have been dead weight attached to an
  // increasingly narrow, easy-to-get-wrong rationale — removed per this
  // block's explicit "keep the smallest safe solution" instruction.

  // ── Bootstrap: redeem the refresh cookie, if any, into a fresh access
  // token + user. `isLoading` stays true for this entire attempt — Y5.2
  // §"state starts bootstrapping, never flashes logged-out before
  // resolution" — ProtectedRoute/PublicRoute already render their own
  // loading state while isLoading is true, so no route decision is made on
  // a guess, and (per the authSettledRef note above) no explicit
  // login/register/logout can fire concurrently with this request.
  useEffect(() => {
    let ignore = false

    if (!bootstrapPromiseRef.current) {
      // Y8D4 §26 — the one real network call for this logical startup now
      // goes through the SAME shared coordinator every other refresh
      // consumer uses (lib/refreshCoordinator.ts), replacing the old
      // direct authService.refresh() call. The coordinator's own in-tab
      // single-flight (keyed module-wide, not per-caller) already collapses
      // this with any other concurrent refresh attempt in this tab; the
      // ref here additionally guards against issuing a second COORDINATED
      // call across StrictMode's synchronous double-invoke (see the long
      // comment above) — belt-and-suspenders, not a duplicate mechanism.
      bootstrapPromiseRef.current = coordinateRefresh()
    }

    bootstrapPromiseRef.current.then(outcome => {
      if (ignore) return

      if (outcome.status === 'SUCCESS') {
        // Token was already installed into tokenStore by the coordinator
        // itself (Y8D4 §31's ordering) — nothing to set here beyond React
        // state.
        setState({ user: outcome.user, isAuthenticated: true, isLoading: false })
        return
      }

      if (outcome.status === 'TERMINAL') {
        // No valid refresh session (never logged in, cookie expired,
        // cookie revoked elsewhere, etc.) — the ordinary logged-out
        // bootstrap outcome, not an error to surface. The coordinator
        // already cleared tokenStore for this outcome; deliberately NOT
        // calling broadcastLogout()/handleSessionExpired() here (bootstrap
        // never did, even before Y8D4) — announcing a cross-tab "logout"
        // for a tab that was never authenticated would be wrong.
        setState({ user: null, isAuthenticated: false, isLoading: false })
        return
      }

      // Y8D4 §26 — TRANSIENT or EXHAUSTED: an operational hiccup or an
      // unresolved multi-tab race during startup is explicitly NOT a
      // statement that credentials are definitively invalid. The
      // coordinator has NOT cleared any token for these outcomes. Smallest
      // coherent choice for this app's existing two-state
      // (isAuthenticated/isLoading) model, per §26's own stated preference:
      // end loading and land in the same unauthenticated-for-now state as
      // TERMINAL from the UI's point of view (ProtectedRoute sends the user
      // to /login, same as today), WITHOUT broadcasting a cross-tab logout
      // — a future protected request or explicit login attempt can still
      // recover normally; this bootstrap attempt simply couldn't prove
      // either way within its own coordinated burst. A richer "retry
      // bootstrap" or offline-auth state machine was deliberately not
      // built — out of scope per §26's own "do not invent a large new
      // offline-auth state machine" instruction.
      setState({ user: null, isAuthenticated: false, isLoading: false })
    })

    return () => { ignore = true }
  }, [])

  // ── Cross-tab logout: another tab wrote CROSS_TAB_LOGOUT_KEY (it called
  // logout() itself, or its own refresh attempt/retry-once cycle gave up).
  // `storage` only fires in OTHER tabs, never the tab that made the write,
  // so this can never loop back into re-broadcasting itself.
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== CROSS_TAB_LOGOUT_KEY) return
      clearAccessToken()
      setState({ user: null, isAuthenticated: false, isLoading: false })
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  // Y5.2-FIX1 — the one place that adopts an authenticated session into
  // local state. Never calls the backend itself: the caller (login below,
  // or RegisterPage directly) has already obtained {token, user} from a
  // backend call that ALREADY created the server-side session and set the
  // refresh cookie — this just mirrors that outcome into tokenStore +
  // AuthContext state. (Y5.2-FIX3 — no longer marks authSettledRef; that
  // ref is removed, see the note above the bootstrap effect.)
  const adoptSession = useCallback((token: string, user: User) => {
    setAccessToken(token)
    setState({ user, isAuthenticated: true, isLoading: false })
  }, [])

  const login = useCallback(async (method: 'EMAIL' | 'PHONE', identifier: string, password: string) => {
    const { token, user } = await authService.login({ method, identifier, password })
    adoptSession(token, user)
  }, [adoptSession])

  // Y5.2 — calls the real backend logout (revokes the session row server-
  // side and clears the refresh cookie), but clears LOCAL state
  // unconditionally regardless of whether that call succeeds — a network
  // failure here must never leave the user stuck "logged in" client-side
  // with no way to actually reach the backend (Y5.2 §"call backend logout,
  // then unconditionally clear memory state + socket regardless of network
  // outcome"). SocketContext reacts to `isAuthenticated` flipping to false
  // the same way it already did pre-Y5.2 (its connection effect tears down
  // on that dependency changing) — no separate logout-specific socket code
  // needed here.
  const logout = useCallback(async () => {
    try {
      await authService.logout()
    } catch {
      // Best-effort — see comment above. The local clear below always runs.
    } finally {
      // Y5.2-FIX3 — no longer marks authSettledRef; that ref is removed,
      // see the note above the bootstrap effect.
      clearAccessToken()
      setState({ user: null, isAuthenticated: false, isLoading: false })
      broadcastLogout()
    }
  }, [])

  const setUser = useCallback((user: User) => {
    setState(s => ({ ...s, user }))
  }, [])

  return (
    <AuthContext.Provider value={{ ...state, login, adoptSession, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
