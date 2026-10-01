// Y5.2 — the ONE in-memory place the current access token lives. Never
// localStorage, never any cookie the JS environment can read — the access
// token is deliberately NOT persisted anywhere that survives a reload; only
// the HttpOnly refresh cookie does, and AuthContext re-derives a fresh
// access token from it via POST /auth/refresh on every bootstrap.
//
// Both services/api.ts's axios interceptors and context/SocketContext.tsx
// read/react to the token exclusively through this module — there is no
// second copy of it (e.g. duplicated into React state) for either of them
// to drift from. AuthContext.tsx still mirrors the current token into its
// own render state (so components can re-render on auth changes through the
// normal useAuth() hook), but it does so BY writing through this store, not
// by owning a second independent copy.
type Listener = (token: string | null) => void

let currentToken: string | null = null
const listeners = new Set<Listener>()

export function getAccessToken(): string | null {
  return currentToken
}

export function setAccessToken(token: string | null): void {
  currentToken = token
  listeners.forEach(listener => listener(currentToken))
}

export function clearAccessToken(): void {
  setAccessToken(null)
}

// Used by SocketContext to know exactly when to reconnect/re-authenticate
// with a rotated token, without polling or relying on AuthContext render
// timing. Returns an unsubscribe function.
export function subscribeToAccessToken(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
