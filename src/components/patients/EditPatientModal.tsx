import { useState, useEffect, useRef } from 'react'
import { Save } from 'lucide-react'
import { isAxiosError } from 'axios'
import { Dialog } from '@/components/ui/Dialog'
import { cn, calcAge, CURP_REGEX, EMAIL_REGEX } from '@/lib/utils'
import { getBusinessDateKey } from '@/lib/businessDate'
import { patientService } from '@/services/patientService'
import { CountryPhoneInput, type PhoneInputState } from '@/components/phone/CountryPhoneInput'
// Z6-FIX1 — resolveEditPhone now lives in lib/phoneInputState.ts (shared
// phone-input infrastructure), not defined in this feature component —
// ProfileSettings.tsx (Medico.phone) reuses the exact same function.
import { resolveEditPhone } from '@/lib/phoneInputState'
import { useActionNotify } from '@/context/ToastContext'
import type { Patient, UpdatePatientRequest, Sex } from '@/types'

const inputClass = cn(
  'w-full px-3 py-2 text-sm rounded-lg border border-border bg-card',
  'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
  'transition-all placeholder:text-muted-foreground',
)

// V6.4 — `phone` removed from FormState/draftFromPatient/dirty-checking:
// it no longer has a single plain-string draft. It's tracked separately
// below via `originalPhone` (the authoritative persisted value, resent
// verbatim until the user actually interacts with the phone control) and
// `phoneState` (CountryPhoneInput's own interaction state, `null` while
// untouched) — see resolveEditPhone.
interface FormState {
  firstName: string
  lastName: string
  curp: string
  birthDate: string
  sex: '' | '0' | '1'
  // Z6 — optional patient contact email. Plain string draft field (unlike
  // phone, which needs CountryPhoneInput's own stateful machinery) — folded
  // into the same dirty-checking/normalization path as firstName/lastName/
  // curp below.
  email: string
}

function draftFromPatient(patient: Patient): FormState {
  return {
    firstName: patient.firstName,
    lastName: patient.lastName,
    curp: patient.curp ?? '',
    birthDate: patient.birthDate,
    sex: String(patient.sex) as '0' | '1',
    email: patient.email ?? '',
  }
}

// U4.2A-FIX-3 — canonical, comparable shape for dirty-checking. Uses the
// EXACT same normalization rules the submit payload already applies (trim,
// CURP uppercase, empty→null for nullable fields, sex as a real 0|1) — by
// running both the baseline snapshot and the live draft through this one
// function, there is no way for the two to drift into two different
// normalization rules. birthDate is already canonical "YYYY-MM-DD" coming
// out of patientService (U4.2A-FIX-2), so no further transformation is
// needed here. Phone is intentionally NOT part of this shape any more —
// see resolveEditPhone's own `dirty` flag, combined separately below.
interface NormalizedPatientFields {
  firstName: string
  lastName: string
  curp: string | null
  birthDate: string
  sex: Sex | null
  // Z6 — lowercased here (not just trimmed) so dirty-checking compares the
  // exact same normalized shape the backend will actually persist (mirrors
  // PatientEmailField's own trim+lowercase+empty→null contract).
  email: string | null
}

function normalizeForCompare(f: FormState): NormalizedPatientFields {
  return {
    firstName: f.firstName.trim(),
    lastName: f.lastName.trim(),
    curp: f.curp.trim().toUpperCase() || null,
    birthDate: f.birthDate,
    sex: f.sex === '' ? null : (Number(f.sex) as Sex),
    email: f.email.trim().toLowerCase() || null,
  }
}

function fieldsEqual(a: NormalizedPatientFields, b: NormalizedPatientFields): boolean {
  return a.firstName === b.firstName
    && a.lastName === b.lastName
    && a.curp === b.curp
    && a.birthDate === b.birthDate
    && a.sex === b.sex
    && a.email === b.email
}

// V6.4 §4/§5/§6/§7/§8/§9 — the phone legacy-compatibility contract, mirrored
// from CountryPhoneInput's own state machine (V6.3) onto the Update payload.
// Z6-FIX1 — `resolveEditPhone` itself has moved to lib/phoneInputState.ts
// (imported above) so it's shared, generic phone-input infrastructure rather
// than something defined inside this one feature component; see its own doc
// comment there for the full untouched/empty/valid/invalid contract.

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
  const { notifyError } = useActionNotify()
  const [form, setForm] = useState<FormState>(() => draftFromPatient(patient))
  const [saving, setSaving] = useState(false)
  const [curpError, setCurpError] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)
  const savingRef = useRef(false)

  // V6.4 §3/§4 — the authoritative persisted phone, kept separate from any
  // in-progress edit. `phoneValueForInput` is what's passed as
  // CountryPhoneInput's `value` prop — it only changes on open/patient
  // switch (the reset effect below), never on every keystroke (V6.3 §11/
  // §12: driving `value` from every emitted state would fight the
  // component's own local editing state and risk cursor jumps). `phoneState`
  // is `null` while untouched — CountryPhoneInput never calls onChange on
  // mount/reinit (V6.3 §12/§18), so `null` here is NOT "no callback
  // happened yet by accident", it's the deliberate signal that nothing has
  // changed since `originalPhone` (V6.4 §2).
  const [originalPhone, setOriginalPhone] = useState<string | null>(() => patient.phone ?? null)
  const [phoneValueForInput, setPhoneValueForInput] = useState<string | null>(() => patient.phone ?? null)
  const [phoneState, setPhoneState] = useState<PhoneInputState | null>(null)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  // V6.4 §12 — forces a fresh CountryPhoneInput mount every time the modal
  // opens (even for the SAME patient after an unsaved-then-discarded phone
  // edit, where `phoneValueForInput` would otherwise be an unchanged string
  // and CountryPhoneInput's own value-change reinit wouldn't fire). This is
  // the "explicit reset identity" strategy the block calls for, rather than
  // relying on an unverified assumption about whether the surrounding Radix
  // Dialog unmounts its content on close (no browser available to confirm
  // that in this environment).
  const [resetNonce, setResetNonce] = useState(0)
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
    const op = latestPatientRef.current.phone ?? null
    setOriginalPhone(op)
    setPhoneValueForInput(op)
    setPhoneState(null)
    setPhoneError(null)
    setResetNonce(n => n + 1)
    setCurpError(null)
    setEmailError(null)
  }, [open, patient.id])

  // U4.2A-FIX-3 — recomputed every render (cheap primitive-field
  // comparison); Save is enabled only once the normalized draft actually
  // differs from the baseline captured when the modal opened. Changing a
  // field and then restoring its exact original value correctly returns
  // this to false — it compares final normalized state, never "was
  // anything touched". V6.4 §9 — phone dirtiness is folded in separately
  // via resolveEditPhone's own `dirty` flag (untouched / same-canonical-
  // as-original / cleared-when-already-null all correctly read as NOT
  // dirty; an actively invalid edit correctly reads as dirty so Save
  // becomes enabled, even though submit() below still blocks it).
  const phoneResolution = resolveEditPhone(originalPhone, phoneState)
  const isDirty = !fieldsEqual(normalizeForCompare(form), initialSnapshotRef.current) || phoneResolution.dirty

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

    // Z6 — optional: blank clears it (allowed through), only an actively-
    // entered malformed address blocks save.
    const trimmedEmail = form.email.trim().toLowerCase()
    if (trimmedEmail && !EMAIL_REGEX.test(trimmedEmail)) {
      setEmailError('Correo electrónico no válido')
      return
    }

    // V6.4 §3/§5/§6/§7/§9 — an actively invalid/incomplete phone blocks
    // save entirely (never sent, never silently dropped in favor of the
    // original). Untouched, cleared, or a resolved valid edit all fall
    // through to `ok: true` with the exact payload value to send.
    const resolvedPhone = resolveEditPhone(originalPhone, phoneState)
    if (!resolvedPhone.ok) {
      setPhoneError('Número de teléfono incompleto o no válido para el país seleccionado.')
      return
    }

    savingRef.current = true
    setSaving(true)
    setCurpError(null)
    setPhoneError(null)
    setEmailError(null)
    try {
      // U4.2A — `| null` clears an existing curp (nullable in Prisma); an
      // empty string is never sent — omission would mean "don't touch this
      // field", which can't express "remove the existing value". Phone
      // follows the same `| null` convention for an explicit clear, but its
      // value now always comes from resolveEditPhone — never a raw
      // `form.phone` string — so an untouched legacy value is resent
      // byte-for-byte (V6.4 §4), never reformatted/normalized as a side
      // effect of saving an unrelated field.
      const payload: UpdatePatientRequest = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        curp: trimmedCurp || null,
        birthDate: form.birthDate,
        sex: Number(form.sex) as Sex,
        phone: resolvedPhone.phone,
        // Z6 — `| null` clears an existing email (nullable in Prisma), same
        // convention as curp/phone above; an empty string is never sent.
        email: trimmedEmail || null,
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
      } else if (isAxiosError(err) && err.response?.status === 400 && err.response.data?.details?.email) {
        // Z6 — UpdatePatientDto's email field DOES go through Zod (unlike
        // phone's own service-layer legacy-compat exception), so a
        // field-scoped detail is reliably available here, routed to this
        // field's own inline error rather than the generic banner.
        setEmailError(err.response.data.details.email as string)
      } else if (isAxiosError(err) && err.response?.data?.error) {
        // V6.4 §10 — Update's phone rejection (patient.service.ts's
        // service-layer ValidationError, V6.2) is a plain {error, code}
        // response with no field-scoped `details` — unlike Create's DTO-
        // level rejection, there is no reliable signal here that this
        // particular 400 was about phone specifically (the same `code`
        // covers every Update validation failure). This is an accepted,
        // documented boundary of the existing error architecture (V6.4
        // §10's "where the existing error architecture allows") — the
        // message still reaches the doctor via the global action
        // notification (Z3) rather than being lost, just not attached to
        // CountryPhoneInput itself.
        notifyError(err.response.data.error)
      } else {
        notifyError('No se pudo actualizar la información del paciente. Intenta de nuevo.')
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
      preventClose={saving}
    >
      <form onSubmit={submit} className="ui-content-stack">
        {/* Z3 — the generic update-failure banner previously here now shows
            as a global action notification instead (see submit's catch).
            Field-level errors (CURP, phone) remain inline below their own
            inputs. No success notice is migrated here — none existed
            before (the modal simply closes on success), so none is
            introduced now. */}

        <fieldset disabled={saving} className="ui-content-stack">
          <div className="ui-field-grid">
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
            {curpError && <p className="text-[11px] text-red-600 dark:text-red-400">{curpError}</p>}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Correo electrónico</label>
            <input type="email" className={inputClass}
              value={form.email}
              onChange={e => { setForm(f => ({ ...f, email: e.target.value })); setEmailError(null) }} />
            {emailError && <p className="text-[11px] text-red-600 dark:text-red-400">{emailError}</p>}
          </div>

          <div className="ui-field-grid">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Fecha de nacimiento</label>
              <input type="date" required className={inputClass}
                max={getBusinessDateKey(new Date().toISOString())}
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

          {/* V6.4 §4/§12 — `value` is the stable per-open snapshot
              (`phoneValueForInput`), never re-driven from every emitted
              onChange state (V6.3 §11/§12: that would fight the component's
              own local editing state and risk cursor jumps). `key` is tied
              to `resetNonce` (bumped on every open, including a same-patient
              reopen) so CountryPhoneInput always fully remounts — and
              therefore always re-derives its initial display from the fresh
              `phoneValueForInput` — rather than relying on an unverified
              assumption about whether the surrounding Dialog unmounts its
              content on close. */}
          <CountryPhoneInput
            key={`${patient.id}-${resetNonce}`}
            value={phoneValueForInput}
            onChange={state => { setPhoneState(state); if (phoneError) setPhoneError(null) }}
            label="Teléfono"
            error={phoneError ?? undefined}
          />
        </fieldset>

        <div className="flex items-center gap-2 pt-2">
          <button
            type="submit"
            disabled={saving || !isDirty}
            className="flex items-center gap-1.5 bg-primary text-white px-4 ui-compact-control-density rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="px-4 ui-compact-control-density text-xs font-medium text-muted-foreground hover:bg-accent rounded-lg transition-colors disabled:opacity-60"
          >
            Cancelar
          </button>
        </div>
      </form>
    </Dialog>
  )
}
