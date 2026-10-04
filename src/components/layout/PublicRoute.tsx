import { Navigate, Outlet } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

// Y5.2-FIX2 — the structural fix for the startup-bootstrap / explicit-auth
// cookie race (see the FIX2 report for the full root-cause explanation).
//
// /login and /register (wrapped by this guard in router.tsx) simply do not
// mount LoginPage/RegisterPage at all — so their submit handlers cannot
// fire — until AuthContext's own startup bootstrap (its one
// POST /auth/refresh call on mount) has actually settled. That closes the
// race at its source: since an explicit login/register request can never
// begin while the bootstrap request is still in flight, the two requests
// can never be concurrent, so there is never a window where a late-arriving
// bootstrap response's Set-Cookie/Clear-Cookie could land AFTER an explicit
// login/register's own Set-Cookie already established a different session.
// This is stronger than disabling a submit button: there is no mounted
// form to submit in the first place.
//
// Deliberately reuses AuthContext's REAL `isLoading`/`isAuthenticated`
// state — no second bootstrap call, no fake timer, no polling.
//
// Mirrors ProtectedRoute.tsx's existing isLoading/isAuthenticated gate with
// the branches inverted: this is the "you must NOT already be
// authenticated" counterpart to that component's "you must be
// authenticated". Kept as its own small component (not folded into
// ProtectedRoute, and not duplicated as inline gating inside LoginPage.tsx/
// RegisterPage.tsx) so both public pages share exactly one implementation
// of this gate rather than two copies that could drift.
export function PublicRoute() {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return (
      // PRE-Y8 (Interface Size Preference), FIX2 — was `min-h-screen`;
      // same `.ui-viewport-min-height` swap and reasoning as
      // ProtectedRoute.tsx's identical loading screen.
      <div className="ui-viewport-min-height flex flex-col items-center justify-center gap-4 bg-background">
        {/* Z1 — official chromatic CardioSense icon; alt="" (decorative —
            the "Cargando CardioSense..." text right below already names
            the brand). */}
        <div className="flex items-center justify-center">
          <img src="/brand/cardiosense-icon.png" alt="" className="w-16 h-16 object-contain" />
        </div>
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Cargando CardioSense...</p>
      </div>
    )
  }

  // Bootstrap already resolved this tab as authenticated (e.g. a valid
  // refresh cookie already existed when /login or /register was loaded
  // directly). Letting the form render anyway would let the user fire
  // ANOTHER login/register against an account that already has a live
  // session — creating an unrelated second session, not doing anything
  // meaningful. Route to the normal authenticated landing page instead —
  // the same destination a successful login/register itself navigates to
  // — never an automatic logout and never a silent account switch.
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}
