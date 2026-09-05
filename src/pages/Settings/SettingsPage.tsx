import { useState } from 'react'
import {
  User, Bell, Shield, Palette, Save, Eye, EyeOff,
  CheckCircle, Camera, Mail, Phone, Building2, Loader2, AlertTriangle,
} from 'lucide-react'
import { isAxiosError } from 'axios'
import { cn, initials } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { userService } from '@/services/userService'

type Tab = 'profile' | 'notifications' | 'security' | 'appearance'

const TABS: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
  { id: 'profile',       label: 'Perfil',         icon: User },
  { id: 'notifications', label: 'Notificaciones',  icon: Bell },
  { id: 'security',      label: 'Seguridad',       icon: Shield },
  { id: 'appearance',    label: 'Apariencia',      icon: Palette },
]

const inputClass = cn(
  'w-full px-3 py-2.5 text-sm rounded-lg border border-border bg-background',
  'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all',
)

function SectionCard({ title, description, children }: {
  title: string; description?: string; children: React.ReactNode
}) {
  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-6 py-4 border-b border-border">
        <h3 className="font-semibold text-foreground">{title}</h3>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between cursor-pointer py-2">
      <span className="text-sm text-foreground">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative w-10 h-5 rounded-full transition-colors duration-200',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <span className={cn(
          'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )} />
      </button>
    </label>
  )
}

export default function SettingsPage() {
  const { user, setUser } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('profile')
  const [saved, setSaved] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Profile form — only firstName/lastName/especialidad/hospital are real
  // (PATCH /api/users/:id). email/phone/cedula have no editable backend
  // contract in this block — kept read-only, never sent, never faked as
  // saved (see profileFieldsReadOnly below).
  const [profile, setProfile] = useState({
    firstName:   user?.firstName ?? '',
    lastName:    user?.lastName ?? '',
    especialidad: user?.medico?.especialidad ?? '',
    hospital:    user?.medico?.hospital ?? '',
  })
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [profileError, setProfileError] = useState('')

  // Notification prefs
  const [notifs, setNotifs] = useState({
    emailAlerts:    true,
    browserPush:    true,
    criticalOnly:   false,
    weeklyReport:   true,
    soundAlert:     false,
    smsAlerts:      false,
  })

  // Password form
  const [passwords, setPasswords] = useState({
    current: '', newPwd: '', confirm: '',
  })

  // Notificaciones/Seguridad remain simulated in this block — explicitly
  // out of scope (Bloque N-A only covers Perfil). Left untouched so their
  // pre-existing (already-diagnosed) behavior doesn't change.
  const handleSave = async () => {
    await new Promise(r => setTimeout(r, 700))
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  // PATCH /api/users/:id — real persistence for the four supported fields.
  // Ownership: userId comes from the authenticated session (AuthContext),
  // never typed/controlled by this form — the backend independently
  // enforces req.user.sub === :id regardless.
  const handleSaveProfile = async () => {
    if (!user || profileSaving) return
    setProfileSaving(true)
    setProfileError('')
    try {
      const updated = await userService.updateProfile(user.id, {
        firstName: profile.firstName.trim(),
        lastName: profile.lastName.trim(),
        especialidad: profile.especialidad.trim() || undefined,
        hospital: profile.hospital.trim() || undefined,
      })
      // Reuse AuthContext's existing setUser — keeps React state and the
      // localStorage session cache consistent, no second source of truth.
      setUser({ ...user, ...updated })
      setProfileSaved(true)
      setTimeout(() => setProfileSaved(false), 3000)
    } catch (err) {
      if (isAxiosError(err) && err.response?.data?.error) {
        setProfileError(err.response.data.error)
      } else {
        setProfileError('No se pudo guardar el perfil. Intenta de nuevo.')
      }
    } finally {
      setProfileSaving(false)
    }
  }

  // Session not resolved yet — never show editable fields with empty/stale
  // data while this is true (ProtectedRoute normally guarantees `user` is
  // already set by the time this page renders, but guard defensively).
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin mb-3" />
        <p className="text-sm text-muted-foreground">Cargando tu perfil...</p>
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configuración</h1>
        <p className="text-muted-foreground text-sm mt-1">Administra tu cuenta y preferencias del sistema</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-5">

        {/* ── Tab navigation ────────────────────────────────────────── */}
        <aside className="sm:w-52 flex-shrink-0">
          <nav className="bg-card rounded-xl border border-border p-2 space-y-0.5">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left',
                  activeTab === tab.id
                    ? 'bg-primary text-white'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                )}
              >
                <tab.icon className="w-4 h-4 flex-shrink-0" />
                {tab.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* ── Tab content ───────────────────────────────────────────── */}
        <div className="flex-1 space-y-4">

          {/* ── PROFILE ─────────────────────────────────────────────── */}
          {activeTab === 'profile' && (
            <>
              <SectionCard title="Foto de perfil" description="Se mostrará en el sidebar y el topbar">
                <div className="flex items-center gap-5">
                  <div className="relative">
                    <div className="w-20 h-20 rounded-full bg-blue-600 flex items-center justify-center text-white text-2xl font-bold">
                      {user ? initials(user.firstName, user.lastName) : 'DR'}
                    </div>
                    <button className="absolute -bottom-1 -right-1 w-7 h-7 bg-primary rounded-full flex items-center justify-center border-2 border-background">
                      <Camera className="w-3.5 h-3.5 text-white" />
                    </button>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Dr. {user?.firstName} {user?.lastName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{user?.email}</p>
                    <button className="mt-2 text-xs text-primary hover:underline">
                      Cambiar foto
                    </button>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Información personal" description="Tus datos de identificación profesional">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Editable — PATCH /api/users/:id */}
                  {[
                    { label: 'Nombre(s)',    field: 'firstName',    icon: User },
                    { label: 'Apellidos',    field: 'lastName',     icon: User },
                    { label: 'Especialidad', field: 'especialidad', icon: Building2 },
                  ].map(({ label, field, icon: Icon }) => (
                    <div key={field}>
                      <label className="text-xs font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                        {label}
                      </label>
                      <input
                        type="text"
                        value={profile[field as 'firstName' | 'lastName' | 'especialidad']}
                        onChange={e => setProfile(p => ({ ...p, [field]: e.target.value }))}
                        className={inputClass}
                      />
                    </div>
                  ))}
                  <div className="sm:col-span-2">
                    <label className="text-xs font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                      Hospital / Institución
                    </label>
                    <input
                      type="text"
                      value={profile.hospital}
                      onChange={e => setProfile(p => ({ ...p, hospital: e.target.value }))}
                      className={inputClass}
                    />
                  </div>

                  {/* Read-only — no editable backend contract in this block.
                      Never sent on save, never shown as "guardado". */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                      Correo <span className="text-[10px] font-normal">(no editable)</span>
                    </label>
                    <input type="email" value={user.email} disabled className={cn(inputClass, 'opacity-60 cursor-not-allowed')} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                      Teléfono <span className="text-[10px] font-normal">(no disponible)</span>
                    </label>
                    <input type="text" value="No disponible" disabled className={cn(inputClass, 'opacity-60 cursor-not-allowed')} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-muted-foreground" />
                      Cédula profesional <span className="text-[10px] font-normal">(no disponible)</span>
                    </label>
                    <input type="text" value="No disponible" disabled className={cn(inputClass, 'opacity-60 cursor-not-allowed')} />
                  </div>
                </div>

                {profileError && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 mt-4">
                    <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
                    <p className="text-xs text-red-700">{profileError}</p>
                  </div>
                )}

                <div className="flex justify-end mt-4 pt-4 border-t border-border">
                  <button
                    onClick={handleSaveProfile}
                    disabled={profileSaving}
                    className="flex items-center gap-2 bg-primary text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
                  >
                    {profileSaving
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : profileSaved ? <CheckCircle className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                    {profileSaving ? 'Guardando...' : profileSaved ? 'Guardado' : 'Guardar cambios'}
                  </button>
                </div>
              </SectionCard>
            </>
          )}

          {/* ── NOTIFICATIONS ────────────────────────────────────────── */}
          {activeTab === 'notifications' && (
            <SectionCard title="Preferencias de notificaciones" description="Controla cómo y cuándo recibes alertas">
              <div className="space-y-1 divide-y divide-border">
                {[
                  { key: 'emailAlerts',  label: 'Alertas por correo electrónico' },
                  { key: 'browserPush',  label: 'Notificaciones push en el navegador' },
                  { key: 'criticalOnly', label: 'Solo alertas críticas (riesgo alto)' },
                  { key: 'weeklyReport', label: 'Reporte semanal de pacientes' },
                  { key: 'soundAlert',   label: 'Sonido en alertas en tiempo real' },
                  { key: 'smsAlerts',    label: 'Alertas por SMS (requiere número verificado)' },
                ].map(({ key, label }) => (
                  <Toggle
                    key={key}
                    label={label}
                    checked={notifs[key as keyof typeof notifs]}
                    onChange={v => setNotifs(n => ({ ...n, [key]: v }))}
                  />
                ))}
              </div>
              <div className="flex justify-end mt-4 pt-4 border-t border-border">
                <button
                  onClick={handleSave}
                  className="flex items-center gap-2 bg-primary text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  {saved ? <CheckCircle className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                  {saved ? 'Guardado' : 'Guardar preferencias'}
                </button>
              </div>
            </SectionCard>
          )}

          {/* ── SECURITY ─────────────────────────────────────────────── */}
          {activeTab === 'security' && (
            <>
              <SectionCard title="Cambiar contraseña" description="Usa una contraseña fuerte de al menos 8 caracteres">
                <div className="space-y-4">
                  {[
                    { label: 'Contraseña actual',    field: 'current' },
                    { label: 'Nueva contraseña',     field: 'newPwd' },
                    { label: 'Confirmar contraseña', field: 'confirm' },
                  ].map(({ label, field }) => (
                    <div key={field}>
                      <label className="text-xs font-medium text-foreground mb-1.5 block">{label}</label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={passwords[field as keyof typeof passwords]}
                          onChange={e => setPasswords(p => ({ ...p, [field]: e.target.value }))}
                          placeholder="••••••••"
                          className={cn(inputClass, 'pr-10')}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(s => !s)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end mt-4 pt-4 border-t border-border">
                  <button
                    onClick={handleSave}
                    className="flex items-center gap-2 bg-primary text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                  >
                    {saved ? <CheckCircle className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
                    {saved ? 'Actualizada' : 'Actualizar contraseña'}
                  </button>
                </div>
              </SectionCard>

              <SectionCard title="Sesiones activas" description="Dispositivos con sesión iniciada">
                <div className="space-y-3">
                  {[
                    { device: 'Chrome · macOS', location: 'Guadalajara, MX', current: true,  time: 'Activa ahora' },
                    { device: 'Safari · iPhone', location: 'Guadalajara, MX', current: false, time: 'Hace 2 horas' },
                  ].map((s, i) => (
                    <div key={i} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
                      <div>
                        <p className="text-sm font-medium text-foreground flex items-center gap-2">
                          {s.device}
                          {s.current && (
                            <span className="text-[10px] bg-teal-50 text-teal-700 border border-teal-200 px-1.5 py-0.5 rounded-full font-semibold">
                              Esta sesión
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">{s.location} · {s.time}</p>
                      </div>
                      {!s.current && (
                        <button className="text-xs text-red-600 hover:underline font-medium">
                          Cerrar sesión
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </SectionCard>
            </>
          )}

          {/* ── APPEARANCE ───────────────────────────────────────────── */}
          {activeTab === 'appearance' && (
            <>
              <SectionCard title="Tema de la interfaz" description="Personaliza el aspecto visual de CardioSense">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: 'light', label: 'Claro',    preview: 'bg-white border-2 border-primary' },
                    { id: 'dark',  label: 'Oscuro',   preview: 'bg-gray-900' },
                    { id: 'auto',  label: 'Automático', preview: 'bg-gradient-to-r from-white to-gray-900' },
                  ].map(theme => (
                    <button
                      key={theme.id}
                      className={cn(
                        'rounded-xl border-2 p-3 text-center transition-all',
                        theme.id === 'light' ? 'border-primary' : 'border-border hover:border-muted-foreground',
                      )}
                    >
                      <div className={cn('h-16 rounded-lg mb-2', theme.preview)} />
                      <p className="text-xs font-medium text-foreground">{theme.label}</p>
                    </button>
                  ))}
                </div>
              </SectionCard>

              <SectionCard title="Densidad de la interfaz" description="Ajusta el espaciado de los elementos">
                <div className="space-y-2">
                  {[
                    { id: 'comfortable', label: 'Cómodo', desc: 'Más espacio entre elementos' },
                    { id: 'compact',     label: 'Compacto', desc: 'Más contenido visible' },
                  ].map(opt => (
                    <label key={opt.id} className="flex items-center gap-3 py-3 cursor-pointer border-b border-border last:border-0">
                      <input
                        type="radio"
                        name="density"
                        defaultChecked={opt.id === 'comfortable'}
                        className="w-4 h-4 text-primary accent-primary"
                      />
                      <div>
                        <p className="text-sm font-medium text-foreground">{opt.label}</p>
                        <p className="text-xs text-muted-foreground">{opt.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </SectionCard>
            </>
          )}

        </div>
      </div>
    </div>
  )
}
