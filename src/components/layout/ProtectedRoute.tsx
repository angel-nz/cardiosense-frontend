import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Loader2, Heart } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
        <div className="w-12 h-12 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center">
          <Heart className="w-6 h-6 text-red-400 fill-red-100" />
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
