import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Save, User } from 'lucide-react'
import { cn, CURP_REGEX } from '@/lib/utils'
import { patientService } from '@/services/patientService'
import { isAxiosError } from 'axios'

interface FormData {
  firstName: string
  lastName: string
  birthDate: string
  sex: '0' | '1' | ''
  curp: string
  phone: string
}

// Separate from FormData: error messages are always strings, regardless of
// each field's own value type (fixes a pre-existing TS mismatch where
// errors.sex was typed as '0' | '1' | '' but held a message string).
type FormErrors = Partial<Record<keyof FormData, string>>

const INITIAL: FormData = {
  firstName: '',
  lastName: '',
  birthDate: '',
  sex: '',
  curp: '',
  phone: '',
}

function FormField({ label, required, error, children }: {
  label: string; required?: boolean; error?: string; children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

const inputClass = cn(
  'w-full px-3 py-2.5 text-sm rounded-lg border border-border bg-card',
  'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
  'transition-all placeholder:text-muted-foreground',
)

export default function PatientCreatePage() {
  const navigate = useNavigate()
  const [form, setForm] = useState<FormData>(INITIAL)
  const [errors, setErrors] = useState<FormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const set = (field: keyof FormData) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm(f => ({ ...f, [field]: e.target.value }))

  const validate = (): boolean => {
    const errs: FormErrors = {}
    if (!form.firstName.trim()) errs.firstName = 'El nombre es obligatorio'
    if (!form.lastName.trim()) errs.lastName = 'Los apellidos son obligatorios'
    if (!form.birthDate) errs.birthDate = 'La fecha de nacimiento es obligatoria'
    if (!form.sex) errs.sex = 'El sexo es obligatorio'
    if (form.curp && !CURP_REGEX.test(form.curp)) {
      errs.curp = 'CURP no válido'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (!validate()) return

    setSaving(true)
    try {
      await patientService.create({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        birthDate: form.birthDate,
        sex: Number(form.sex) as 0 | 1,
        curp: form.curp || undefined,
        phone: form.phone || undefined,
      })
      navigate('/patients')
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 400 && err.response.data?.details) {
        // Backend field-level validation errors (Zod, via validate middleware)
        const details = err.response.data.details as Record<string, string>
        setErrors(prev => ({ ...prev, ...details }))
      } else if (isAxiosError(err) && err.response?.data?.error) {
        setFormError(err.response.data.error)
      } else {
        setFormError('No se pudo guardar el paciente. Intenta de nuevo.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/patients')}
          className="p-2 rounded-lg hover:bg-accent transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Nuevo paciente</h1>
          <p className="text-sm text-muted-foreground mt-1">Registra los datos personales del paciente</p>
        </div>
      </div>

      {/* Form card */}
      <form onSubmit={handleSubmit} className="bg-card rounded-xl border border-border p-6 space-y-5">
        <div className="flex items-center gap-3 pb-4 border-b border-border">
          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center">
            <User className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h2 className="font-semibold text-foreground">Información personal</h2>
            <p className="text-xs text-muted-foreground">Campos marcados con * son obligatorios</p>
          </div>
        </div>

        {formError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm text-red-700">
            {formError}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Nombre(s)" required error={errors.firstName}>
            <input
              type="text"
              value={form.firstName}
              onChange={set('firstName')}
              placeholder="Juan Carlos"
              className={cn(inputClass, errors.firstName && 'border-red-400 focus:border-red-400')}
            />
          </FormField>

          <FormField label="Apellidos" required error={errors.lastName}>
            <input
              type="text"
              value={form.lastName}
              onChange={set('lastName')}
              placeholder="Ramírez Vega"
              className={cn(inputClass, errors.lastName && 'border-red-400 focus:border-red-400')}
            />
          </FormField>

          <FormField label="Fecha de nacimiento" required error={errors.birthDate}>
            <input
              type="date"
              value={form.birthDate}
              onChange={set('birthDate')}
              max={new Date().toISOString().split('T')[0]}
              className={cn(inputClass, errors.birthDate && 'border-red-400 focus:border-red-400')}
            />
          </FormField>

          <FormField label="Sexo biológico" required error={errors.sex}>
            <select
              value={form.sex}
              onChange={set('sex')}
              className={cn(inputClass, 'cursor-pointer', errors.sex && 'border-red-400 focus:border-red-400')}
            >
              <option value="">Seleccionar...</option>
              <option value="0">Femenino</option>
              <option value="1">Masculino</option>
            </select>
          </FormField>

          <FormField label="CURP" error={errors.curp}>
            <input
              type="text"
              value={form.curp}
              onChange={e => setForm(f => ({ ...f, curp: e.target.value.toUpperCase() }))}
              placeholder="RAVJ680514HMCRNS04"
              maxLength={18}
              className={cn(inputClass, 'font-mono uppercase', errors.curp && 'border-red-400 focus:border-red-400')}
            />
          </FormField>

          <FormField label="Teléfono" error={errors.phone}>
            <input
              type="tel"
              value={form.phone}
              onChange={set('phone')}
              placeholder="+52 33 1234 5678"
              className={inputClass}
            />
          </FormField>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <button
            type="button"
            onClick={() => navigate('/patients')}
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-primary text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors shadow-sm"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Guardando...' : 'Guardar paciente'}
          </button>
        </div>
      </form>
    </div>
  )
}
