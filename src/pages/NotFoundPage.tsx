import { useNavigate } from 'react-router-dom'
import { Heart, ArrowLeft } from 'lucide-react'

export default function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-4 bg-background">
      <div className="w-16 h-16 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center mb-6">
        <Heart className="w-8 h-8 text-red-400" />
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
