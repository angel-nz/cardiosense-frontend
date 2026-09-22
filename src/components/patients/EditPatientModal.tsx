import { useState, useEffect, useRef } from 'react'
import { isAxiosError } from 'axios'
import { Dialog } from '@/components/ui/Dialog'
import { cn, calcAge, CURP_REGEX } from '@/lib/utils'
import { patientService } from '@/services/patientService'
import type { Patient, UpdatePatientRequest, Sex } from '@/types'

const inputClass = cn(
  'w-full px-3 py-2 text-sm rounded-lg border border-border bg-card',
  'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
  'transition-all placeholder:text-muted-foreground',
)

interface FormState {
  firstName: string
  lastName: string
  curp: string
  birthDate: string
  sex: '' | '0' | '1'
  phone: string
}

function draftFromPatient(patient: Patient): FormState {
  return {
    firstName: patient.firstName,
    lastName: patient.lastName,
    curp: patient.curp ?? '',
    birthDate: patient.birthDate,
    sex: String(patient.sex) as '0' | '1',
    phone: patient.phone ?? '',
  }
}

// U4.2A-FIX-3 — canonical, comparable shape for dirty-checking. Uses the
// EXACT same normalization rules the submit payload already applies (trim,
// CURP uppercase, empty→null for nullable fields, sex as a real 0|1) — by
// running both the baseline snapshot and the live draft through this one
// function, there is no way for the two to drift into two different
// normalization rules. birthDate is already canonical "YYYY-MM-DD" coming
// out of patientService (U4.2A-FIX-2), so no further transformation is
// needed here.
interface NormalizedPatientFields {
  firstName: string
  lastName: string
  curp: string | null
  birthDate: string
  sex: Sex | null
  phone: string | null
}

function normalizeForCompare(f: FormState): NormalizedPatientFields {
  return {
    firstName: f.firstName.trim(),
    lastName: f.lastName.trim(),
    curp: f.curp.trim().toUpperCase() || null,
    birthDate: f.birthDate,
    sex: f.sex === '' ? null : (Number(f.sex) as Sex),
    phone: f.phone.trim() || null,
  }
}

function fieldsEqual(a: NormalizedPatientFields, b: NormalizedPatientFields): boolean {
  return a.firstName === b.firstName
    && a.lastName === b.lastName
    && a.curp === b.curp
    && a.birthDate === b.birthDate
    && a.sex === b.sex
    && a.phone === b.phone
}

interface EditPatientModalProps {
  patient: Patient
  open: boolean
  onOpenChange: (open: boolean) => void
  // Reuses the same "creator updates itself from its own response" pattern
  // already validated for NewRecordModal/Q3 — this modal never owns Patient
  // state itself, it only hands the authoritative PUT response back.
  onUpdated: (patient: Patient) => void
}

export function EditPatientModal({ patient, open, onOpenChange, onUpdated }: EditPatientModalProps) {
  const [form, setForm] = useState<FormState>(() => draftFromPatient(patient))
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [curpError, setCurpError] = useState<string | null>(null)
  const savingRef = useRef(false)
  // U4.2A-FIX-3 — baseline snapshot captured once per opening (same effect
  // as the draft init below), never re-derived from a later `patient` prop
  // change while the modal stays open — a realtime update to `patient` from
  // another tab while this one is mid-edit must not silently move the
  // dirty-comparison target out from under the doctor's own in-progress
  // edits (U4.2A's own principle: this modal's draft is stable while open).
  const initialSnapshotRef = useRef<NormalizedPatientFields>(normalizeForCompare(draftFromPatient(patient)))

  // U8.3-FIX-2 — always holds the newest canonical patient, including
  // same-patient refetches (prediction_completed / patient_updated) that
  // arrive while the modal is open. Only read by the init effect below, so
  // those refetches never touch the in-progress draft.
  // MUST stay declared BEFORE the init effect: effects run in declaration
  // order, so on the opening render this syncs first and init reads it.
  const latestPatientRef = useRef(patient)
  useEffect(() => {
    latestPatientRef.current = patient
  })

  // U4.2A — unlike NewRecordModal, no GET here: `patient` is already the
  // canonical PatientDetail state (kept current via its own patient_updated
  // → canonical refetch effect), so re-fetching just to open this modal
  // would be redundant. Initializes the draft AND the dirty baseline only on
  // closed→open, or if a different patient is supplied — never on a
  // same-patient refetch while open. Do NOT add `patient` to these deps.
  useEffect(() => {
    if (!open) return
    const draft = draftFromPatient(latestPatientRef.current)
    setForm(draft)
    initialSnapshotRef.current = normalizeForCompare(draft)
    setFormError(null)
    setCurpError(null)
  }, [open, patient.id])

  // U4.2A-FIX-3 — recomputed every render (cheap primitive-field
  // comparison); Save is enabled only once the normalized draft actually
  // differs from the baseline captured when the modal opened. Changing a
  // field and then restoring its exact original value correctly returns
  // this to false — it compares final normalized state, never "was
  // anything touched".
  const isDirty = !fieldsEqual(normalizeForCompare(form), initialSnapshotRef.current)

  const handleClose = () => {
    if (savingRef.current) return
    onOpenChange(false)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    // U4.2A-FIX-3 — defense in depth: the Save button is already disabled
    // when there's nothing to persist, but a submit could still reach here
    // via Enter-to-submit or a programmatic dispatch. No effective change
    // means no PUT, no patient_updated, no updatedAt mutation — checked
    // before the double-submit guard below, since there's nothing to guard
    // against issuing here in the first place.
    if (!isDirty) return
    if (savingRef.current) return

    const trimmedCurp = form.curp.trim().toUpperCase()
    if (trimmedCurp && !CURP_REGEX.test(trimmedCurp)) {
      setCurpError('CURP no válido')
      return
    }

    savingRef.current = true
    setSaving(true)
    setFormError(null)
    setCurpError(null)
    try {
      // U4.2A — `| null` clears an existing curp/phone (both nullable in
      // Prisma); an empty string is never sent — omission would mean "don't
      // touch this field", which can't express "remove the existing value".
      const payload: UpdatePatientRequest = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        curp: trimmedCurp || null,
        birthDate: form.birthDate,
        sex: Number(form.sex) as Sex,
        phone: form.phone.trim() || null,
      }
      const updated = await patientService.update(patient.id, payload)
      onUpdated(updated)
      onOpenChange(false)
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 409) {
        // errorHandler.ts already names the conflicting field(s) in the
        // message (Prisma P2002 `meta.target`) — CURP is the only unique
        // column this modal can touch, so any 409 here is a CURP conflict.
        setCurpError('Este CURP ya está registrado para otro paciente.')
      } else if (isAxiosError(err) && err.response?.data?.error) {
        setFormError(err.response.data.error)
      } else {
        setFormError('No se pudo actualizar la información del paciente. Intenta de nuevo.')
      }
    } finally {
      setSaving(false)
      savingRef.current = false
    }
  }

  // Live preview only — backend persists birthDate, never a client-supplied
  // age (U3 principle, unchanged here). Falls back gracefully if the draft
  // birthDate is momentarily incomplete/invalid while typing.
  const previewAge = /^\d{4}-\d{2}-\d{2}$/.test(form.birthDate) ? calcAge(form.birthDate) : null

  return (
    <Dialog
      open={open}
      onOpenChange={next => { if (!next) handleClose() }}
      title="Editar información personal"
      description="Los cambios no afectan registros clínicos ni predicciones históricas."
      preventClose={saving}
    >
      <form onSubmit={submit} className="space-y-4">
        {formError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
            {formError}
          </div>
        )}

        <fieldset disabled={saving} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Nombre(s)</label>
              <input required className={inputClass}
                value={form.firstName}
                onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Apellidos</label>
              <input required className={inputClass}
                value={form.lastName}
                onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">CURP</label>
            <input className={cn(inputClass, 'font-mono uppercase')}
              value={form.curp}
              onChange={e => { setForm(f => ({ ...f, curp: e.target.value.toUpperCase() })); setCurpError(null) }} />
            {curpError && <p className="text-[11px] text-red-600">{curpError}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Fecha de nacimiento</label>
              <input type="date" required className={inputClass}
                value={form.birthDate}
                onChange={e => setForm(f => ({ ...f, birthDate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Sexo biológico</label>
              <select required className={cn(inputClass, 'cursor-pointer')}
                value={form.sex}
                onChange={e => setForm(f => ({ ...f, sex: e.target.value as '0' | '1' }))}
              >
                <option value="">Seleccionar...</option>
                <option value="0">Femenino</option>
                <option value="1">Masculino</option>
              </select>
            </div>
          </div>

          {/* Edad — read-only information, never an input. Live preview
              from the draft birthDate; the backend remains the sole
              authority and never receives an `age` field. */}
          <div className="text-sm text-muted-foreground">
            Edad: <span className="font-medium text-foreground">
              {previewAge !== null ? `${previewAge} años` : '—'}
            </span>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Teléfono</label>
            <input className={inputClass}
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </div>
        </fieldset>

        <div className="flex items-center gap-2 pt-2">
          <button
            type="submit"
            disabled={saving || !isDirty}
            className="flex items-center gap-1.5 bg-primary text-white px-4 py-2 rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
          >
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-accent rounded-lg transition-colors disabled:opacity-60"
          >
            Cancelar
          </button>
        </div>
      </form>
    </Dialog>
  )
}
