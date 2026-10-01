import { useState, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Eye, EyeOff, Loader2, Activity, Shield, Zap, ChevronDown, ChevronUp } from 'lucide-react'
import { isAxiosError } from 'axios'
import { cn } from '@/lib/utils'
import { authService } from '@/services/authService'
import { useAuth } from '@/context/AuthContext'
import { useActionNotify } from '@/context/ToastContext'
import { CountryPhoneInput, type PhoneInputState } from '@/components/phone/CountryPhoneInput'

const FEATURES = [
  { icon: Activity, text: 'Predicción IA en tiempo real' },
  { icon: Shield,   text: 'Detección temprana de anomalías' },
  { icon: Zap,      text: 'Alertas preventivas automáticas' },
]

// Z6-R1 §21 — email no longer required on its own; `phone` lives outside
// this plain-string FormData (tracked via its own `phoneState`, same
// pattern PatientCreatePage/EditPatientModal/ProfileSettings already use
// for CountryPhoneInput's stateful country/national-input machinery).
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

// Z6-R1 §21 — resolves the registration phone field, mirroring
// PatientCreatePage's own local `resolveCreatePhone` (a brand-new row, no
// persisted value to compare against — 'empty' is always a valid "not
// provided" state, never a legacy/untouched distinction). Deliberately a
// local, non-exported function: importing PatientCreatePage's own copy
// here would recreate the exact cross-feature-component coupling Z6-FIX1
// already removed elsewhere (ProfileSettings/EditPatientModal), and this
// one's semantics (brand-new Register row, not Profile's "resend persisted
// value unchanged") aren't quite the same shape either.
function resolveRegisterPhone(phoneState: PhoneInputState | null):
  | { ok: true; phone: string | undefined }
  | { ok: false } {
  if (!phoneState || phoneState.status === 'empty') return { ok: true, phone: undefined }
  if (phoneState.status === 'valid') return { ok: true, phone: phoneState.canonical! }
  return { ok: false }
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

// Y6.3B — `ui-control-density` replaces the hardcoded `py-2.5` (Classic
// 0.625rem/10px, exact match — spot-check "Login/Register input/button
// family", §45); horizontal padding (`px-3`) stays fixed.
const inputClass = (hasError?: boolean) => cn(
  'w-full px-3 text-sm rounded-lg border bg-card ui-control-density',
  'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
  'transition-all',
  hasError ? 'border-red-400 dark:border-red-500/70' : 'border-border',
)

// V2 — visual-only required marker. `aria-hidden` because the actual
// required semantics live on the <input> itself (required/aria-required
// below) — without this, a screen reader would announce "star" or
// "required" twice per field (once for the glyph, once for the input).
const RequiredMark = () => <span className="text-red-500 dark:text-red-400" aria-hidden="true"> *</span>

export default function RegisterPage() {
  const navigate = useNavigate()
  const { adoptSession } = useAuth()
  const { notifyError } = useActionNotify()
  const [form, setForm] = useState<FormData>(INITIAL)
  const [errors, setErrors] = useState<FormErrors>({})
  // Z6-R1 §21 — doctor registration phone, same stateful CountryPhoneInput
  // machinery PatientCreatePage already uses for a brand-new row (no
  // persisted value — `value` stays `null` for this whole page's lifetime).
  const [phoneState, setPhoneState] = useState<PhoneInputState | null>(null)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  // Z6-R1 §21 — the "at least one of email/phone" GROUP requirement.
  // Deliberately separate from `errors.email`/`phoneError` (which are each
  // field's OWN format validation) — this is shown once, next to both
  // fields, exactly when neither was provided.
  const [identifierError, setIdentifierError] = useState<string | null>(null)
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  // PRE-R §C — "Información profesional" collapsible subsection. Default
  // collapsed (Cédula profesional/Especialidad/Hospital are optional and
  // least often needed at signup); values live on `form` (above), not on
  // any state local to the collapsible section, so collapsing/expanding
  // never loses whatever was typed — these inputs are controlled from
  // `form.cedulaProfesional`/`especialidad`/`hospital` and are simply not
  // mounted while collapsed, exactly like ClinicalSourceDisclosure.tsx's
  // existing collapsible-disclosure pattern elsewhere in this app.
  const [professionalOpen, setProfessionalOpen] = useState(false)

  const set = (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

  const validate = (): boolean => {
    const errs: FormErrors = {}
    if (!form.firstName.trim()) errs.firstName = 'Requerido'
    if (!form.lastName.trim()) errs.lastName = 'Requerido'
    // Z6-R1 §21 — email is no longer unconditionally required; an empty
    // value is fine PROVIDED a phone was given instead (checked below,
    // after this field's own format check). Only a non-empty value is
    // checked for valid syntax here.
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errs.email = 'Correo no válido'
    }
    const pwdError = validatePassword(form.password)
    if (pwdError) errs.password = pwdError
    if (form.confirmPassword !== form.password) errs.confirmPassword = 'Las contraseñas no coinciden'

    const phoneResolution = resolveRegisterPhone(phoneState)
    if (!phoneResolution.ok) {
      setPhoneError('Número de teléfono incompleto o no válido para el país seleccionado.')
    } else {
      setPhoneError(null)
    }

    // Z6-R1 §8/§21 — the group requirement: neither an email NOR a phone
    // was provided at all. Only meaningful once each field's own format is
    // otherwise clean — an invalid phone/email already blocks submit via
    // its own error above, so this never piles a second, confusing message
    // on top of a format error.
    const noIdentifierAtAll = !form.email.trim() && phoneResolution.ok && !phoneResolution.phone
    if (noIdentifierAtAll) {
      setIdentifierError('Ingresa al menos un correo electrónico o un teléfono.')
    } else {
      setIdentifierError(null)
    }

    // PRE-R §C — auto-expand the "Información profesional" subsection if
    // submit validation fails on one of ITS fields (none of the three
    // currently has any format rule — see UpdateMyProfileDto/RegisterDto's
    // own comments on why no bound is invented here — but this keeps the
    // subsection's contract correct/structural rather than silently
    // relying on that absence; a future validation rule on any of these
    // three fields is covered automatically).
    if (errs.cedulaProfesional || errs.especialidad || errs.hospital) {
      setProfessionalOpen(true)
    }

    setErrors(errs)
    return Object.keys(errs).length === 0 && phoneResolution.ok && !noIdentifierAtAll
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return // avoid double submit
    if (!validate()) return

    // defense in depth — validate() above already returned false for this
    // case, so this can only be reached with a resolvable phone.
    const phoneResolution = resolveRegisterPhone(phoneState)
    if (!phoneResolution.ok) return

    setLoading(true)
    try {
      // role omitted — backend defaults to MEDICO (auth.dto.ts); this
      // registration flow is specifically for creating doctor accounts.
      //
      // Y5.2-FIX1 — POST /auth/register already creates a real, stable
      // server session and sets the HttpOnly refresh cookie, returning
      // exactly the same {token, user} shape login does. That response is
      // now the session the user actually continues using: adoptSession()
      // mirrors it into tokenStore/AuthContext directly (no second
      // POST /auth/login — that would create a redundant second session
      // row and orphan this one), then navigation goes straight to the
      // authenticated landing route, same destination as a successful
      // login (LoginPage.tsx).
      const { token, user } = await authService.register({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        // Z6-R1 §8/§21 — omitted (not an empty string) when blank, so the
        // backend's own RegisterDto normalization/superRefine is what
        // actually decides "not provided", matching every other optional
        // identifier field in this codebase (CreatePatientRequest.email,
        // ProfileMyUpdateRequest.phone).
        email: form.email.trim() || undefined,
        phone: phoneResolution.phone,
        password: form.password,
        cedulaProfesional: form.cedulaProfesional.trim() || undefined,
        especialidad: form.especialidad.trim() || undefined,
        hospital: form.hospital.trim() || undefined,
      })
      adoptSession(token, user)
      navigate('/dashboard')
    } catch (err) {
      // Z3 — generic registration-failure feedback (email-conflict and
      // other non-field-scoped errors) now goes through the global
      // action-notification toast instead of an inline banner. Field-level
      // errors (`details`) remain inline, unchanged.
      if (isAxiosError(err) && err.response?.status === 409) {
        // Z6-R1 §10 — the backend's ConflictError message already says
        // specifically which identifier conflicted ("Email already
        // registered" / "Phone already registered") — relayed as-is,
        // never replaced with a hardcoded email-only assumption.
        notifyError(err.response.data?.error ?? 'Este correo o teléfono ya está registrado.')
      } else if (isAxiosError(err) && err.response?.status === 400 && err.response.data?.details) {
        // Z6-R1 §21 — `phone` is routed to CountryPhoneInput's own error
        // presentation (phoneError), not the generic FieldErrors list
        // (which has no phone input to attach to) — same split
        // ProfileSettings/EditPatientModal already use for Paciente/Medico
        // phone. The backend's "at least one" superRefine issue is
        // attached to BOTH `email` and `phone` paths with the SAME shared
        // message (AT_LEAST_ONE_IDENTIFIER_MESSAGE, auth.dto.ts) — surfaced
        // exactly once via `identifierError`, never also duplicated as a
        // field-specific error under email/phone individually.
        const details = { ...(err.response!.data.details as Record<string, string>) }
        const isGroupMessage = (msg: string | undefined) => msg === 'Provide an email address or a phone number.'
        const isMissingBoth = isGroupMessage(details.email) || isGroupMessage(details.phone)
        if (isMissingBoth) {
          setIdentifierError('Ingresa al menos un correo electrónico o un teléfono.')
          delete details.email
          delete details.phone
        } else {
          setIdentifierError(null)
        }
        const { phone: phoneDetail, ...rest } = details
        setErrors(prev => ({ ...prev, ...(rest as FormErrors) }))
        if (phoneDetail) setPhoneError(phoneDetail)
        // PRE-R §C — same auto-expand rule as validate() above, for a
        // validation failure that only surfaces from the backend (a
        // cedulaProfesional/especialidad/hospital rule this DTO doesn't
        // have today, but the subsection's contract must hold regardless).
        if (rest.cedulaProfesional || rest.especialidad || rest.hospital) {
          setProfessionalOpen(true)
        }
      } else if (isAxiosError(err) && err.response?.data?.error) {
        notifyError(err.response.data.error)
      } else {
        notifyError('No se pudo crear la cuenta. Intenta de nuevo.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    // PRE-Y8 (Interface Size Preference), FIX2 — was `min-h-screen`; see
    // AppLayout.tsx/index.css's `.ui-viewport-min-height` comment.
    <div className="ui-viewport-min-height flex">

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
          <img src="/brand/cardiosense-icon.png" alt="" className="w-20 h-20 object-contain" />
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
            <div className="w-9 h-9 rounded-xl bg-red-500/10 border border-red-200 dark:border-red-800/60 flex items-center justify-center">
              <img src="/brand/cardiosense-icon.png" alt="" className="w-5 h-5 object-contain" />
            </div>
            <p className="font-bold text-xl text-foreground">CardioSense</p>
          </div>

          {/* Y5.2-FIX1 — the old success-then-redirect-to-/login screen is
              removed: a successful register now adopts the session and
              navigates straight to /dashboard (see handleSubmit), so this
              page unmounts on success rather than showing an interim
              "creada, redirigiendo..." state. */}
          <>
              <div>
                <h2 className="ui-heading-page font-bold text-foreground">Crear cuenta</h2>
                <p className="text-muted-foreground text-sm mt-1">
                  Regístrate como médico para empezar
                </p>
              </div>

              <form onSubmit={handleSubmit} className="ui-content-stack">
                {/* Z3 — the generic registration-failure banner previously
                    here now shows as a global action notification instead
                    (see handleSubmit's catch). Field-level errors (below)
                    remain inline. */}

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
                    {errors.firstName && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.firstName}</p>}
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
                    {errors.lastName && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.lastName}</p>}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground block mb-1.5">Correo electrónico</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={set('email')}
                    autoComplete="email"
                    className={inputClass(!!errors.email || !!identifierError)}
                  />
                  {errors.email && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.email}</p>}
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground block mb-1.5">Teléfono</label>
                  <CountryPhoneInput
                    value={null}
                    onChange={state => { setPhoneState(state); setPhoneError(null); setIdentifierError(null) }}
                    label=""
                    error={phoneError ?? undefined}
                  />
                </div>

                {identifierError && (
                  <p className="text-xs text-red-600 dark:text-red-400 -mt-1">{identifierError}</p>
                )}

                <div className="rounded-lg border border-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setProfessionalOpen(o => !o)}
                    aria-expanded={professionalOpen}
                    aria-controls="register-professional-info-panel"
                    className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium text-foreground hover:bg-accent transition-colors"
                  >
                    <span>Información profesional</span>
                    {professionalOpen
                      ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                      : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />}
                  </button>
                  {professionalOpen && (
                    <div id="register-professional-info-panel" className="px-3 pb-3 pt-1 space-y-3">
                      <div>
                        <label className="text-sm font-medium text-foreground block mb-1.5">Cédula profesional</label>
                        <input value={form.cedulaProfesional} onChange={set('cedulaProfesional')} className={inputClass(!!errors.cedulaProfesional)} />
                        {errors.cedulaProfesional && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.cedulaProfesional}</p>}
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground block mb-1.5">Especialidad</label>
                        <input value={form.especialidad} onChange={set('especialidad')} className={inputClass(!!errors.especialidad)} />
                        {errors.especialidad && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.especialidad}</p>}
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground block mb-1.5">Hospital/Institución</label>
                        <input value={form.hospital} onChange={set('hospital')} className={inputClass(!!errors.hospital)} />
                        {errors.hospital && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.hospital}</p>}
                      </div>
                    </div>
                  )}
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
                    ? <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.password}</p>
                    : <p className="text-xs text-muted-foreground mt-1">Mínimo 8 caracteres, una mayúscula y un número.</p>}
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
                  {errors.confirmPassword && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.confirmPassword}</p>}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-70 transition-colors shadow-sm ui-control-density"
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
        </div>
      </div>
    </div>
  )
}
