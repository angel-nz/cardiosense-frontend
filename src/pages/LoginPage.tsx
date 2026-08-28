import { useState, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Heart, Eye, EyeOff, Loader2, Activity, Shield, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'

const FEATURES = [
  { icon: Activity, text: 'Predicción IA en tiempo real' },
  { icon: Shield,   text: 'Detección temprana de anomalías' },
  { icon: Zap,      text: 'Alertas preventivas automáticas' },
]

export default function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [email,    setEmail]    = useState('dr.garcia@cardiosense.mx')
  const [password, setPassword] = useState('Demo1234!')
  const [showPwd,  setShowPwd]  = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email || !password) { setError('Completa todos los campos'); return }
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate('/dashboard')
    } catch {
      setError('Credenciales inválidas. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">

      {/* ── Left panel — branding ──────────────────────────────────── */}
      <div
        className="hidden lg:flex w-1/2 flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: 'hsl(var(--sidebar-bg))' }}
      >
        {/* Background decoration */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-blue-600/10" />
          <div className="absolute -bottom-24 -left-24 w-80 h-80 rounded-full bg-red-500/10" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full border border-white/5" />
        </div>

        {/* Logo */}
        <div className="flex items-center gap-3 relative z-10">
          <div className="w-10 h-10 rounded-xl bg-red-500/20 border border-red-400/30 flex items-center justify-center">
            <Heart className="w-5 h-5 text-red-400 fill-red-400/40" />
          </div>
          <div>
            <p className="text-white font-bold text-xl">CardioSense</p>
            <p className="text-white/40 text-xs">Sistema Cardiovascular Inteligente</p>
          </div>
        </div>

        {/* Hero text */}
        <div className="space-y-6 relative z-10">
          <div>
            <h1 className="text-4xl font-bold text-white leading-tight">
              Detecta riesgos<br />
              <span className="text-blue-400">antes de que ocurran</span>
            </h1>
            <p className="text-white/60 mt-4 text-base leading-relaxed max-w-sm">
              Plataforma inteligente de predicción cardiovascular basada en Machine Learning
              y el Framingham Heart Study.
            </p>
          </div>
          <div className="space-y-3">
            {FEATURES.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-blue-400" />
                </div>
                <span className="text-white/70 text-sm">{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="text-white/20 text-xs relative z-10">
          © 2026 CardioSense
        </p>
      </div>

      {/* ── Right panel — form ─────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-sm space-y-8">

          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-500/10 border border-red-200 flex items-center justify-center">
              <Heart className="w-5 h-5 text-red-500 fill-red-200" />
            </div>
            <p className="font-bold text-xl text-foreground">CardioSense</p>
          </div>

          {/* Heading */}
          <div>
            <h2 className="text-2xl font-bold text-foreground">Bienvenido</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Inicia sesión para continuar
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">
                Correo electrónico
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="dr.medico@hospital.mx"
                autoComplete="email"
                className={cn(
                  'w-full px-3 py-2.5 text-sm rounded-lg border bg-card',
                  'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
                  'transition-all',
                  error ? 'border-red-400' : 'border-border',
                )}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-foreground">Contraseña</label>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className={cn(
                    'w-full px-3 py-2.5 pr-10 text-sm rounded-lg border bg-card',
                    'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
                    'transition-all',
                    error ? 'border-red-400' : 'border-border',
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                <p className="text-xs text-red-700">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-primary text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-70 transition-colors shadow-sm"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Iniciando sesión...
                </>
              ) : (
                'Iniciar sesión'
              )}
            </button>
          </form>

          {/* Demo credentials hint */}
          <div className="bg-muted/50 border border-border rounded-xl p-4">
            <p className="text-xs font-semibold text-foreground mb-2">Credenciales de demostración</p>
            <div className="space-y-1 font-mono text-xs text-muted-foreground">
              <p>Email: <span className="text-foreground">dr.garcia@cardiosense.mx</span></p>
              <p>Pass:  <span className="text-foreground">Demo1234!</span></p>
            </div>
          </div>

          <p className="text-center text-sm text-muted-foreground">
            ¿No tienes una cuenta?{' '}
            <Link to="/register" className="text-primary font-medium hover:underline">
              Regístrate
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
