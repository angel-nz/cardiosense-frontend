import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { useAuth } from '@/context/AuthContext'
import { avatarService } from '@/services/avatarService'

// Y3.1B §23 — the shared authoritative-avatar cache. Needs ONLY useAuth()
// (to know which user, and when their avatar version changes); does not
// depend on ThemeContext, SocketContext, or AlertsContext, and nothing in
// those depends on this — see App.tsx for tree placement (Y3.1B §3).
//
// Responsibilities live entirely in this one file: fetch the authoritative
// Blob at most once per (userId, avatar.updatedAt) pair, turn it into one
// shared object URL, and manage that URL's whole lifecycle (create, replace,
// revoke) so Sidebar/Topbar/ProfileSettings never each run their own fetch
// or own their own URL.

interface AvatarContextValue {
  avatarUrl: string | null
  isLoading: boolean
  hasError: boolean
  // Manual retry after a failed fetch (Y3.1B §27/§33) — re-fetches the
  // CURRENT identity/version, does nothing if logged out or no avatar.
  retry: () => void
}

const AvatarContext = createContext<AvatarContextValue | null>(null)

// Y3.1B §24 — the single-flight key MUST include both userId and
// avatar.updatedAt: keying on userId alone would incorrectly reuse a stale
// in-flight/cached fetch across a replace-while-fetching race.
function computeKey(userId: string, updatedAt: string): string {
  return `${userId}:${updatedAt}`
}

export function AvatarProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [hasError, setHasError] = useState(false)

  // StrictMode-safe single-flight (mirrors AuthContext's own
  // bootstrapPromiseRef pattern, Y5.2-FIX3): a dev double-invoke of the
  // fetch effect below, for the SAME key, reuses this same in-flight
  // promise instead of firing a second Blob GET (Y3.1B §29).
  const inFlightRef = useRef<{ key: string; promise: Promise<Blob | null> } | null>(null)
  // The fetch key this provider is CURRENTLY authoritative for. A response
  // is applied only if this still matches at resolution time — the
  // account/version race guard (Y3.1B §25). Set SYNCHRONOUSLY the moment a
  // fetch starts (or the moment logout/no-avatar is detected), so a fast
  // account switch during an in-flight request can never let the stale
  // response win, even though the object URL for it is never created in
  // the first place (see the `.then()` branch below).
  const currentKeyRef = useRef<string | null>(null)
  // The object URL this provider currently owns — revoked exactly once, at
  // the right time (Y3.1B §26).
  const ownedUrlRef = useRef<string | null>(null)

  const revokeOwned = useCallback(() => {
    if (ownedUrlRef.current) {
      URL.revokeObjectURL(ownedUrlRef.current)
      ownedUrlRef.current = null
    }
  }, [])

  const runFetch = useCallback((key: string) => {
    currentKeyRef.current = key
    setIsLoading(true)
    setHasError(false)

    const existing = inFlightRef.current
    const entry = existing && existing.key === key
      ? existing
      : { key, promise: avatarService.getMyAvatar() }
    inFlightRef.current = entry

    entry.promise
      .then(blob => {
        // Superseded by a later account/version change while this request
        // was in flight — discard silently. No object URL was ever created
        // for it, so there is nothing to revoke either (Y3.1B §25).
        if (currentKeyRef.current !== key) return

        if (!blob) {
          // No avatar (404), or the version we asked for no longer exists —
          // render initials, no retry loop (Y3.1B §27).
          revokeOwned()
          setAvatarUrl(null)
          setIsLoading(false)
          return
        }

        // New-then-revoke ordering (Y3.1B §26): commit the new URL to state
        // FIRST, only revoke the previous one after — avoids a frame where
        // a consumer's <img src> points at an already-revoked URL.
        const newUrl = URL.createObjectURL(blob)
        const previous = ownedUrlRef.current
        ownedUrlRef.current = newUrl
        setAvatarUrl(newUrl)
        setIsLoading(false)
        if (previous) URL.revokeObjectURL(previous)
      })
      .catch(() => {
        if (currentKeyRef.current !== key) return
        // Fetch failure (network/5xx) — Y3.1B §27: keep whatever avatarUrl
        // is already showing rather than forcing a broken-image state;
        // just surface `hasError` so ProfileSettings can offer retry().
        // `user.avatar` metadata itself is never touched by a failed GET.
        setIsLoading(false)
        setHasError(true)
      })
      .finally(() => {
        if (inFlightRef.current?.key === key) inFlightRef.current = null
      })
  }, [revokeOwned])

  useEffect(() => {
    if (!user || !user.avatar) {
      // Logged out, or logged in with no avatar metadata — nothing to fetch
      // (Y3.1B §27: "No avatar metadata: do not GET"). Reset everything so
      // a subsequent login/upload always re-evaluates clean, and so any
      // still-in-flight request for a PREVIOUS identity is abandoned (its
      // `.then()` will see currentKeyRef.current === null and discard).
      currentKeyRef.current = null
      inFlightRef.current = null
      revokeOwned()
      setAvatarUrl(null)
      setIsLoading(false)
      setHasError(false)
      return
    }

    const key = computeKey(user.id, user.avatar.updatedAt)
    if (currentKeyRef.current === key) return // already have/are fetching this exact version

    runFetch(key)
  }, [user, runFetch, revokeOwned])

  // Provider unmount only — final safety net so this provider never leaks
  // the one object URL it owns if the app itself tears down (e.g. HMR in
  // dev). Deliberately a SEPARATE effect with an empty dependency array, not
  // folded into the fetch effect above: during React StrictMode's
  // synchronous dev-only mount→cleanup→mount, this cleanup fires too, but
  // the async fetch it might race against has not resolved yet at that
  // point (network I/O is never synchronous), so `ownedUrlRef.current` is
  // still null and this is a safe no-op — the real, live fetch's own
  // create-then-revoke logic above is what actually owns the URL's lifetime.
  useEffect(() => {
    return () => { revokeOwned() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retry = useCallback(() => {
    if (!user || !user.avatar) return
    const key = computeKey(user.id, user.avatar.updatedAt)
    // Force a fresh fetch even though the key is unchanged — drop any
    // cached (already-settled, e.g. failed) single-flight entry for this
    // exact key first, so runFetch issues a genuinely new request rather
    // than re-awaiting the promise that already rejected.
    if (inFlightRef.current?.key === key) inFlightRef.current = null
    runFetch(key)
  }, [user, runFetch])

  return (
    <AvatarContext.Provider value={{ avatarUrl, isLoading, hasError, retry }}>
      {children}
    </AvatarContext.Provider>
  )
}

export function useAvatar(): AvatarContextValue {
  const ctx = useContext(AvatarContext)
  if (!ctx) throw new Error('useAvatar must be used inside AvatarProvider')
  return ctx
}
