import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      // PRE-Y8 (Interface Size Preference), FIX2 — was `min-h-screen`; see
      // AppLayout.tsx/index.css's `.ui-viewport-min-height` comment for why
      // an uncompensated 100vh here would render physically taller than
      // the true viewport at Medium/Large.
      <div className="ui-viewport-min-height flex flex-col items-center justify-center gap-4 bg-background">
        {/* Z1 — official chromatic CardioSense icon; alt="" (decorative —
            the "Cargando CardioSense..." text right below already names
            the brand). */}
        <div className="w-12 h-12 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 flex items-center justify-center">
          <img src="/brand/cardiosense-icon.png" alt="" className="w-6 h-6 object-contain" />
        </div>
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Cargando CardioSense...</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <Outlet />
}
