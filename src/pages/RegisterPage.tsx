import { useState, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Heart, Eye, EyeOff, Loader2, Activity, Shield, Zap, CheckCircle2 } from 'lucide-react'
import { isAxiosError } from 'axios'
import { cn } from '@/lib/utils'
import { authService } from '@/services/authService'

const FEATURES = [
  { icon: Activity, text: 'Predicción IA en tiempo real' },
  { icon: Shield,   text: 'Detección temprana de anomalías' },
  { icon: Zap,      text: 'Alertas preventivas automáticas' },
]

interface FormData {
  firstName: string
  lastName: string
  email: string
  password: string
  confirmPassword: string
  cedulaProfesional: string
  especialidad: string
  hospital: string
}

type FormErrors = Partial<Record<keyof FormData, string>>

const INITIAL: FormData = {
  firstName: '', lastName: '', email: '', password: '', confirmPassword: '',
  cedulaProfesional: '', especialidad: '', hospital: '',
}

// Mirrors backend RegisterDto exactly (auth.dto.ts): min 8 chars, at least
// one uppercase, at least one number — validated client-side for immediate
// feedback, but the backend remains the actual authority.
function validatePassword(pwd: string): string | null {
  if (pwd.length < 8) return 'Mínimo 8 caracteres'
  if (!/[A-Z]/.test(pwd)) return 'Debe incluir una mayúscula'
  if (!/[0-9]/.test(pwd)) return 'Debe incluir un número'
  return null
}

const inputClass = (hasError?: boolean) => cn(
  'w-full px-3 py-2.5 text-sm rounded-lg border bg-card',
  'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
  'transition-all',
  hasError ? 'border-red-400' : 'border-border',
)

// V2 — visual-only required marker. `aria-hidden` because the actual
// required semantics live on the <input> itself (required/aria-required
// below) — without this, a screen reader would announce "star" or
// "required" twice per field (once for the glyph, once for the input).
const RequiredMark = () => <span className="text-red-500" aria-hidden="true"> *</span>

export default function RegisterPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState<FormData>(INITIAL)
  const [errors, setErrors] = useState<FormErrors>({})
  const [formError, setFormError] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const set = (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

  const validate = (): boolean => {
    const errs: FormErrors = {}
    if (!form.firstName.trim()) errs.firstName = 'Requerido'
    if (!form.lastName.trim()) errs.lastName = 'Requerido'
    if (!form.email.trim()) errs.email = 'Requerido'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Correo no válido'
    const pwdError = validatePassword(form.password)
    if (pwdError) errs.password = pwdError
    if (form.confirmPassword !== form.password) errs.confirmPassword = 'Las contraseñas no coinciden'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return // avoid double submit
    setFormError('')
    if (!validate()) return

    setLoading(true)
    try {
      // role omitted — backend defaults to MEDICO (auth.dto.ts); this
      // registration flow is specifically for creating doctor accounts.
      await authService.register({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        password: form.password,
        cedulaProfesional: form.cedulaProfesional.trim() || undefined,
        especialidad: form.especialidad.trim() || undefined,
        hospital: form.hospital.trim() || undefined,
      })
      // The backend already returns tokens on register (same shape as
      // login), but we deliberately don't auto-authenticate here — the
      // account is created, and the person confirms it works by logging
      // in explicitly, same as any other credential they'll use going
      // forward. Tokens from this response are simply not used.
      setSuccess(true)
      setTimeout(() => navigate('/login'), 1800)
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 409) {
        setFormError(err.response.data?.error ?? 'Este correo ya está registrado.')
      } else if (isAxiosError(err) && err.response?.status === 400 && err.response.data?.details) {
        setErrors(prev => ({ ...prev, ...(err.response!.data.details as Record<string, string>) }))
      } else if (isAxiosError(err) && err.response?.data?.error) {
        setFormError(err.response.data.error)
      } else {
        setFormError('No se pudo crear la cuenta. Intenta de nuevo.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">

      {/* ── Left panel — branding (same as LoginPage) ─────────────────── */}
      <div
        className="hidden lg:flex w-1/2 flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: 'hsl(var(--sidebar-bg))' }}
      >
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-blue-600/10" />
          <div className="absolute -bottom-24 -left-24 w-80 h-80 rounded-full bg-red-500/10" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full border border-white/5" />
        </div>

        <div className="flex items-center gap-3 relative z-10">
          <div className="w-10 h-10 rounded-xl bg-red-500/20 border border-red-400/30 flex items-center justify-center">
            <Heart className="w-5 h-5 text-red-400 fill-red-400/40" />
          </div>
          <div>
            <p className="text-white font-bold text-xl">CardioSense</p>
            <p className="text-white/40 text-xs">Sistema Cardiovascular Inteligente</p>
          </div>
        </div>

        <div className="space-y-6 relative z-10">
          <div>
            <h1 className="text-4xl font-bold text-white leading-tight">
              Únete como<br />
              <span className="text-blue-400">médico especialista</span>
            </h1>
            <p className="text-white/60 mt-4 text-base leading-relaxed max-w-sm">
              Crea tu cuenta para gestionar pacientes y predicciones de riesgo cardiovascular.
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

        <p className="text-white/20 text-xs relative z-10">
          © 2026 CardioSense
        </p>
      </div>

      {/* ── Right panel — form ─────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background overflow-y-auto">
        <div className="w-full max-w-sm space-y-6 py-8">

          <div className="lg:hidden flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-500/10 border border-red-200 flex items-center justify-center">
              <Heart className="w-5 h-5 text-red-500 fill-red-200" />
            </div>
            <p className="font-bold text-xl text-foreground">CardioSense</p>
          </div>

          {success ? (
            <div className="text-center space-y-3 py-8">
              <CheckCircle2 className="w-12 h-12 text-teal-600 mx-auto" />
              <h2 className="text-xl font-bold text-foreground">Cuenta creada</h2>
              <p className="text-sm text-muted-foreground">
                Redirigiendo a inicio de sesión...
              </p>
            </div>
          ) : (
            <>
              <div>
                <h2 className="text-2xl font-bold text-foreground">Crear cuenta</h2>
                <p className="text-muted-foreground text-sm mt-1">
                  Regístrate como médico para empezar
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {formError && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                    <p className="text-xs text-red-700">{formError}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-foreground block mb-1.5">Nombre(s)<RequiredMark /></label>
                    <input
                      value={form.firstName}
                      onChange={set('firstName')}
                      autoComplete="given-name"
                      required
                      aria-required="true"
                      className={inputClass(!!errors.firstName)}
                    />
                    {errors.firstName && <p className="text-xs text-red-600 mt-1">{errors.firstName}</p>}
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground block mb-1.5">Apellidos<RequiredMark /></label>
                    <input
                      value={form.lastName}
                      onChange={set('lastName')}
                      autoComplete="family-name"
                      required
                      aria-required="true"
                      className={inputClass(!!errors.lastName)}
                    />
                    {errors.lastName && <p className="text-xs text-red-600 mt-1">{errors.lastName}</p>}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground block mb-1.5">Correo electrónico<RequiredMark /></label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={set('email')}
                    placeholder="dr.medico@hospital.mx"
                    autoComplete="email"
                    required
                    aria-required="true"
                    className={inputClass(!!errors.email)}
                  />
                  {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email}</p>}
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground block mb-1.5">Contraseña<RequiredMark /></label>
                  <div className="relative">
                    <input
                      type={showPwd ? 'text' : 'password'}
                      value={form.password}
                      onChange={set('password')}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      required
                      aria-required="true"
                      className={cn(inputClass(!!errors.password), 'pr-10')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd(s => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {errors.password
                    ? <p className="text-xs text-red-600 mt-1">{errors.password}</p>
                    : <p className="text-xs text-muted-foreground mt-1">Mínimo 8 caracteres, una mayúscula y un número</p>}
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground block mb-1.5">Confirmar contraseña<RequiredMark /></label>
                  <input
                    type={showPwd ? 'text' : 'password'}
                    value={form.confirmPassword}
                    onChange={set('confirmPassword')}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    required
                    aria-required="true"
                    className={inputClass(!!errors.confirmPassword)}
                  />
                  {errors.confirmPassword && <p className="text-xs text-red-600 mt-1">{errors.confirmPassword}</p>}
                </div>

                {/* V2 — professional fields moved into the same main form
                    hierarchy as the required fields above (no more
                    <details>/collapsed section): same label typography,
                    input height, border/focus/error treatment via the
                    shared `inputClass`. Still optional — backend Medico
                    model allows all three as optional (schema.prisma) —
                    communicated ONLY by the absence of the red asterisk,
                    with no `required`/`aria-required` and no "(opcional)"
                    suffix (no existing convention in this codebase uses
                    that suffix elsewhere). */}
                <div>
                  <label className="text-sm font-medium text-foreground block mb-1.5">Cédula profesional</label>
                  <input value={form.cedulaProfesional} onChange={set('cedulaProfesional')} className={inputClass()} />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground block mb-1.5">Especialidad</label>
                  <input value={form.especialidad} onChange={set('especialidad')} className={inputClass()} />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground block mb-1.5">Hospital</label>
                  <input value={form.hospital} onChange={set('hospital')} className={inputClass()} />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 bg-primary text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-70 transition-colors shadow-sm"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creando cuenta...
                    </>
                  ) : (
                    'Crear cuenta'
                  )}
                </button>
              </form>

              <p className="text-center text-sm text-muted-foreground">
                ¿Ya tienes una cuenta?{' '}
                <Link to="/login" className="text-primary font-medium hover:underline">
                  Inicia sesión
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
