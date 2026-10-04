import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function NotFoundPage() {
  const navigate = useNavigate()
  return (
    // PRE-Y8 (Interface Size Preference), FIX2 — was `min-h-screen`; see
    // AppLayout.tsx/index.css's `.ui-viewport-min-height` comment.
    <div className="ui-viewport-min-height flex flex-col items-center justify-center text-center px-4 bg-background">
      {/* Z1 — official chromatic CardioSense icon; alt="" (decorative —
          the "404"/"Página no encontrada" text right below already
          establishes the page context). */}
      <div className="flex items-center justify-center mb-6">
        <img src="/brand/cardiosense-icon.png" alt="" className="w-16 h-16 object-contain" />
      </div>
      <h1 className="text-6xl font-bold text-foreground">404</h1>
      <p className="text-xl font-semibold text-foreground mt-3">Página no encontrada</p>
      <p className="text-muted-foreground mt-2 max-w-sm">
        La ruta que buscas no existe en CardioSense.
      </p>
      <button
        onClick={() => navigate('/dashboard')}
        className="mt-8 flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Volver al dashboard
      </button>
    </div>
  )
}
