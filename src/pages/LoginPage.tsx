import { useState, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Eye, EyeOff, Loader2, Activity, Shield, Zap, Mail, Phone } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { CountryPhoneInput, type PhoneInputState } from '@/components/phone/CountryPhoneInput'

const FEATURES = [
  { icon: Activity, text: 'Predicción IA en tiempo real' },
  { icon: Shield,   text: 'Detección temprana de anomalías' },
  { icon: Zap,      text: 'Alertas preventivas automáticas' },
]

// V2 — same convention as RegisterPage's RequiredMark: visual-only,
// aria-hidden (the real required semantics live on the inputs below).
const RequiredMark = () => <span className="text-red-500 dark:text-red-400" aria-hidden="true"> *</span>

// Z6-R1 §11/§12/§22 — a doctor may now authenticate with EITHER identifier.
// Per the brief's explicit UX preference, this is a deliberate mode toggle
// (not a single free-text field that tries to guess email-vs-phone from
// arbitrary digits) — email mode keeps the plain email input; phone mode
// reuses the same CountryPhoneInput/canonical-E.164 machinery the rest of
// the app already uses, so the backend always receives either a trimmed
// email or an already-canonical phone, never a guess.
type IdentifierMode = 'email' | 'phone'

export default function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [mode, setMode] = useState<IdentifierMode>('email')
  const [email,    setEmail]    = useState('dr.garcia@cardiosense.mx')
  const [phoneState, setPhoneState] = useState<PhoneInputState | null>(null)
  const [password, setPassword] = useState('Demo1234!')
  const [showPwd,  setShowPwd]  = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  // Switching modes clears whatever the OTHER mode's field/error held —
  // never silently carries a stale email/phone value or error across the
  // switch.
  const switchMode = (next: IdentifierMode) => {
    if (next === mode) return
    setMode(next)
    setError('')
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password) { setError('Completa todos los campos'); return }

    let identifier: string
    if (mode === 'email') {
      if (!email.trim()) { setError('Completa todos los campos'); return }
      identifier = email.trim()
    } else {
      if (!phoneState || phoneState.status !== 'valid') {
        setError('Número de teléfono incompleto o no válido para el país seleccionado.')
        return
      }
      identifier = phoneState.canonical!
    }

    // Z6-R1-FIX1 §1 — `method` is derived directly from the already-explicit
    // `mode` state (the Correo/Teléfono toggle below), never inferred from
    // `identifier`'s shape — this is the one place that mapping happens.
    const method: 'EMAIL' | 'PHONE' = mode === 'email' ? 'EMAIL' : 'PHONE'

    setError('')
    setLoading(true)
    try {
      await login(method, identifier, password)
      navigate('/dashboard')
    } catch {
      // Z6-R1 §13 — deliberately the same generic message regardless of
      // identifier mode or which part of the credential was wrong (never
      // "this email/phone doesn't exist" vs "wrong password").
      setError('Credenciales inválidas. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    // PRE-Y8 (Interface Size Preference), FIX2 — was `min-h-screen`; see
    // AppLayout.tsx/index.css's `.ui-viewport-min-height` comment.
    <div className="ui-viewport-min-height flex">

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
          <img src="/brand/cardiosense-icon.png" alt="" className="w-20 h-20 object-contain" />
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
            <div className="flex items-center justify-center">
              <img src="/brand/cardiosense-icon.png" alt="" className="w-16 h-16 object-contain" />
            </div>
            <p className="font-bold text-xl text-foreground">CardioSense</p>
          </div>

          {/* Heading. Y6.3B — `.ui-heading-page` replaces `text-2xl`
              (Classic 1.5rem/24px, exact match — spot-check "Login
              input/button" family, §45). */}
          <div>
            <h2 className="ui-heading-page font-bold text-foreground">Bienvenido</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Inicia sesión para continuar
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="ui-content-stack">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-foreground">
                  {mode === 'email' ? 'Correo electrónico' : 'Teléfono'}<RequiredMark />
                </label>
                {/* Z6-R1 §12/§22 — compact mode toggle, consistent with the
                    rest of this form rather than a redesign. Reuses the
                    same "secondary control" visual weight the rest of the
                    app already uses for small inline switches. */}
                <div className="flex items-center gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => switchMode('email')}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded-md transition-colors',
                      mode === 'email' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Mail className="w-3 h-3" aria-hidden="true" />
                    Correo
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMode('phone')}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded-md transition-colors',
                      mode === 'phone' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Phone className="w-3 h-3" aria-hidden="true" />
                    Teléfono
                  </button>
                </div>
              </div>

              {mode === 'email' ? (
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  aria-required="true"
                  className={cn(
                    'w-full px-3 text-sm rounded-lg border bg-card',
                    'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
                    'transition-all',
                    error ? 'border-red-400 dark:border-red-500/70' : 'border-border',
                  )}
                  style={{ paddingTop: 'var(--ui-control-padding-y)', paddingBottom: 'var(--ui-control-padding-y)' }}
                />
              ) : (
                <CountryPhoneInput
                  key={mode}
                  value={null}
                  onChange={state => { setPhoneState(state); if (error) setError('') }}
                  label=""
                />
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-foreground">Contraseña<RequiredMark /></label>
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
                  required
                  aria-required="true"
                  className={cn(
                    'w-full px-3 pr-10 text-sm rounded-lg border bg-card',
                    'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
                    'transition-all',
                    error ? 'border-red-400 dark:border-red-500/70' : 'border-border',
                  )}
                  style={{ paddingTop: 'var(--ui-control-padding-y)', paddingBottom: 'var(--ui-control-padding-y)' }}
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
              <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-lg px-3 py-2.5">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-70 transition-colors shadow-sm"
              style={{ paddingTop: 'var(--ui-control-padding-y)', paddingBottom: 'var(--ui-control-padding-y)' }}
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
