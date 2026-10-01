import { useState, useEffect, type ChangeEvent, type FormEvent } from 'react'
import { useBlocker } from 'react-router-dom'
import { isAxiosError } from 'axios'
import { Loader2, AlertTriangle, User as UserIcon, Mail, Building2, Stethoscope, BadgeCheck, Pencil, Save, Phone } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SettingsSection } from '@/components/settings/SettingsSection'
import { AvatarUploadSection } from '@/components/settings/AvatarUploadSection'
import { Dialog } from '@/components/ui/Dialog'
import { useAuth } from '@/context/AuthContext'
import { useActionNotify } from '@/context/ToastContext'
import { profileService } from '@/services/profileService'
import type { ProfileFields } from '@/services/profileService'
import type { ProfileMyUpdateRequest, User } from '@/types'
// Z6 — doctor phone reuses CountryPhoneInput (the same reusable component
// EditPatientModal/PatientCreatePage already use for Paciente.phone) and
// its exact "untouched → resend persisted value unchanged, empty → clear,
// valid → canonical" resolution function, rather than a second phone-input
// implementation or a second legacy-compatibility machinery.
// Z6-FIX1 — resolveEditPhone now imported from the shared lib/phoneInputState
// module, not from the EditPatientModal feature component (neither feature
// component should import implementation helpers from the other).
import { CountryPhoneInput, type PhoneInputState } from '@/components/phone/CountryPhoneInput'
import { resolveEditPhone } from '@/lib/phoneInputState'

// Bloque Y3 — real, end-to-end Profile section. Replaces the Y2 structural
// placeholder. Editable: firstName/lastName (all roles), cedulaProfesional/
// especialidad/hospital (MEDICO only). Read-only: email (Y3 §2/§36 — email
// editing is explicitly out of scope), role, id. No phone field, no
// password confirmation for profile changes (still explicitly excluded by
// the Y3 contract). Avatar upload — excluded by Y3's original contract — is
// implemented in Y3.1B as its own independent section
// (AvatarUploadSection, rendered below) with its own immediate-action
// lifecycle, deliberately kept OUT of this component's draft/snapshot/
// dirty/useBlocker machinery (Y3.1B §32).

// The editable draft shape. `email` is deliberately not part of it — it is
// rendered straight from the authenticated user and never enters the
// PATCH payload.
interface ProfileDraft {
  firstName: string
  lastName: string
  cedulaProfesional: string
  especialidad: string
  hospital: string
}

type FieldErrors = Partial<Record<keyof ProfileDraft, string>>

function toDraft(profile: Pick<ProfileFields, 'firstName' | 'lastName' | 'medico'>): ProfileDraft {
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    cedulaProfesional: profile.medico?.cedulaProfesional ?? '',
    especialidad: profile.medico?.especialidad ?? '',
    hospital: profile.medico?.hospital ?? '',
  }
}

function draftsEqual(a: ProfileDraft, b: ProfileDraft): boolean {
  return a.firstName === b.firstName
    && a.lastName === b.lastName
    && a.cedulaProfesional === b.cedulaProfesional
    && a.especialidad === b.especialidad
    && a.hospital === b.hospital
}

// Y6.3B — `ui-control-density` replaces `py-2.5` (Classic exact match, §45).
// PRE-Y8 (Profile Edit Mode §21) — added an optional `readOnlyState` arg.
// View-mode fields must read as "viewable, not currently editable" without
// looking broken/unavailable, so this deliberately does NOT reuse the
// email field's `opacity-60 cursor-not-allowed` treatment (that one signals
// "can never be edited, ever"). Instead it swaps in the existing semantic
// `bg-muted` token (already used elsewhere in the app, themed for both
// Light and Dark) and drops the focus ring, since nothing here is meant to
// invite a click. `hasError` still takes precedence when both are somehow
// true, though in practice field errors only exist while `isEditing`.
const inputClass = (hasError?: boolean, readOnlyState?: boolean) => cn(
  'w-full px-3 text-sm rounded-lg border bg-card ui-control-density',
  'transition-all',
  readOnlyState
    ? 'bg-muted/40 cursor-default focus:outline-none'
    : 'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
  hasError ? 'border-red-400 dark:border-red-500/70' : 'border-border',
)

// Pre-Y8 visual polish — small contextual icon beside each field label,
// matching the reference's label treatment. Purely presentational (no new
// field, no new validation, no new data): `icon` is decorative and marked
// aria-hidden since the label text next to it already names the field for
// assistive tech.
function FieldLabel({ icon: Icon, children }: { icon: typeof UserIcon; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-sm font-medium text-foreground mb-1.5">
      <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" aria-hidden="true" />
      {children}
    </label>
  )
}

export default function ProfileSettings() {
  const { user: authUser, setUser } = useAuth()
  const { notifySuccess, notifyError } = useActionNotify()

  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [loadError, setLoadError] = useState('')

  // Role isn't part of the editable draft (it's never writable), but the
  // professional fields only render/save for MEDICO — tracked separately.
  const [role, setRole] = useState<User['role'] | null>(null)

  // Y3-FIX1 — email is part of the authoritative loaded Profile snapshot,
  // sourced from GET/PATCH /users/me/profile, NOT from AuthContext. The old
  // Y3 code rendered `authUser?.email` here, which violated the "GET
  // /me/profile is authoritative for this form" contract. AuthContext may
  // still hold app-wide identity for the rest of the app, but it is no
  // longer read anywhere in this component. `null` (not '') distinguishes
  // "not loaded yet" from "loaded and genuinely empty" — though the latter
  // never actually happens for email.
  const [email, setEmail] = useState<string | null>(null)

  const [snapshot, setSnapshot] = useState<ProfileDraft | null>(null)
  const [draft, setDraft] = useState<ProfileDraft | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)

  // Z6 — doctor phone, tracked separately from `draft` for the exact same
  // reason EditPatientModal keeps Paciente.phone out of its own plain-string
  // FormState: CountryPhoneInput owns its own country/national-input state
  // machine, and `value` must stay a stable per-load/per-edit-session
  // snapshot rather than being re-driven from every emitted onChange state
  // (V6.3 §11/§12). `originalPhone`/`phoneValueForInput` are the
  // authoritative persisted value; `phoneState` is `null` while untouched.
  const [originalPhone, setOriginalPhone] = useState<string | null>(null)
  const [phoneValueForInput, setPhoneValueForInput] = useState<string | null>(null)
  const [phoneState, setPhoneState] = useState<PhoneInputState | null>(null)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  // Forces a fresh CountryPhoneInput mount whenever the authoritative phone
  // value changes underneath it (load, cancel-edit, successful save) — same
  // "explicit reset identity" strategy EditPatientModal uses (V6.4 §12).
  const [phoneResetNonce, setPhoneResetNonce] = useState(0)
  // PRE-Y8 (Settings Interaction Policy Refinement §14) — Profile save is a
  // CONFIRMED account action, not an immediate preference: clicking
  // "Guardar cambios" no longer PATCHes directly. It validates first (no
  // dialog on invalid input — §26), and only opens this confirmation
  // dialog once the draft is valid; the actual PATCH only happens if the
  // user confirms.
  const [confirmOpen, setConfirmOpen] = useState(false)

  // PRE-Y8 (Profile Edit Mode) — the section starts read-only. `isEditing`
  // gates whether the personal-information fields are interactive and
  // whether "Guardar cambios" is rendered at all (§9); it does NOT gate
  // `dirty` itself. Entering edit mode never touches `draft`, so `dirty`
  // stays false the instant edit mode opens (§16's invariant: no path where
  // `isEditing === false && dirty === true`) — it only becomes true once
  // the user actually changes a value away from `snapshot`.
  const [isEditing, setIsEditing] = useState(false)

  // Z6 — phone dirtiness is folded in separately via resolveEditPhone's own
  // `dirty` flag, same composition EditPatientModal uses: untouched / same-
  // canonical-as-original / cleared-when-already-null all correctly read as
  // NOT dirty; an actively invalid edit correctly reads as dirty (Save
  // becomes enabled) even though handleSubmit below still blocks it.
  const phoneResolution = resolveEditPhone(originalPhone, phoneState)
  const dirty = (!!snapshot && !!draft && !draftsEqual(snapshot, draft)) || (role === 'medico' && phoneResolution.dirty)

  // ── Server-authoritative initial load ──────────────────────────────────
  // No invented blank defaults while loading — the form doesn't render
  // until the real GET /users/me/profile response is in hand (or an error
  // is shown instead).
  useEffect(() => {
    let cancelled = false
    setLoadState('loading')
    setLoadError('')
    profileService.getMyProfile()
      .then(profile => {
        if (cancelled) return
        const d = toDraft(profile)
        setSnapshot(d)
        setDraft(d)
        setRole(profile.role)
        // Authoritative: this is the ONLY place `email` is ever set from a
        // successful load. On failure (below), it is deliberately left
        // untouched (still `null` on first mount) — a cached AuthContext
        // value never substitutes for a real, successful GET response
        // (Y3-FIX1 §1/§FIX1-F04).
        setEmail(profile.email)
        // Z6 — authoritative phone snapshot, same "only ever set from a
        // successful load" rule as `email` immediately above.
        const loadedPhone = profile.medico?.phone ?? null
        setOriginalPhone(loadedPhone)
        setPhoneValueForInput(loadedPhone)
        setPhoneState(null)
        setPhoneResetNonce(n => n + 1)
        setLoadState('ready')
      })
      .catch(() => {
        if (cancelled) return
        setLoadError('No se pudo cargar tu perfil. Intenta de nuevo más tarde.')
        setLoadState('error')
      })
    return () => { cancelled = true }
  }, [])

  const set = (field: keyof ProfileDraft) => (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setDraft(d => (d ? { ...d, [field]: value } : d))
    setFieldErrors(prev => ({ ...prev, [field]: undefined }))
  }

  const validate = (d: ProfileDraft): FieldErrors => {
    const errs: FieldErrors = {}
    if (!d.firstName.trim()) errs.firstName = 'Requerido'
    if (!d.lastName.trim()) errs.lastName = 'Requerido'
    return errs
  }

  // ── Unsaved-change protection: SPA navigation ──────────────────────────
  // React Router's own supported `useBlocker` (stable since 6.6, available
  // here because the app already uses createBrowserRouter/RouterProvider —
  // a data router). Gated strictly on `dirty` — a clean form never blocks,
  // and nothing here auto-saves on navigation.
  const blocker = useBlocker(dirty)

  // ── Unsaved-change protection: tab close / refresh / external nav ──────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  // §14/§26 — validation happens BEFORE confirmation, on the real "Guardar
  // cambios" click. An invalid draft shows the normal field errors and never
  // opens the dialog; only a valid draft opens it. No PATCH happens here —
  // that only happens from handleConfirmSave, after the user explicitly
  // confirms.
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    // PRE-Y8 (Profile Edit Mode) — defense in depth: the Save button is
    // only ever rendered while `isEditing`, and fields are `readOnly`
    // otherwise, so this path shouldn't be reachable outside edit mode —
    // but a `readOnly` (not `disabled`) input can still submit its form on
    // Enter in most browsers, and this guard is what actually stops that
    // from opening a confirmation dialog over an unchanged, non-dirty view.
    if (!isEditing || !draft || saving) return
    const errs = validate(draft)
    setFieldErrors(errs)
    if (Object.keys(errs).length > 0) return

    // Z6 — an actively invalid/incomplete phone blocks save entirely,
    // before the confirmation dialog ever opens — mirrors PatientCreatePage/
    // EditPatientModal's own validate()-before-dialog placement.
    if (role === 'medico') {
      const resolution = resolveEditPhone(originalPhone, phoneState)
      if (!resolution.ok) {
        setPhoneError('Número de teléfono incompleto o no válido para el país seleccionado.')
        return
      }
      // Z6-R1 §2/§17 — lockout protection, frontend-side defense in depth:
      // the backend (PATCH /me/profile) is authoritative and rejects this
      // exact case regardless (PhoneLastIdentifierError, caught below), but
      // blocking it here too avoids a round-trip and a confirmation dialog
      // over a save that can never succeed. `email === null` means phone is
      // this account's ONLY login identifier right now.
      if (email === null && resolution.phone === null) {
        setPhoneError('No puedes eliminar tu teléfono: es tu único método de inicio de sesión. Agrega un correo electrónico primero.')
        return
      }
    }

    setConfirmOpen(true)
  }

  // §14 — the actual save flow, unchanged from before except that it now
  // runs only after explicit confirmation rather than directly from submit.
  // Cancelling the dialog never calls this — the draft is left exactly as
  // the user typed it, with no API request (§14/§26 P04/P05).
  const handleConfirmSave = async () => {
    if (!draft || saving) return
    setSaving(true)
    try {
      const payload: ProfileMyUpdateRequest = {
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
      }
      // especialidad/hospital/cedulaProfesional only apply to MEDICO
      // accounts server-side — sending them for a non-MEDICO role would be
      // silently ignored by the backend anyway, but they're kept out of the
      // payload entirely here to match what's actually rendered/editable.
      if (role === 'medico') {
        payload.cedulaProfesional = draft.cedulaProfesional.trim() || null
        payload.especialidad = draft.especialidad.trim() || null
        payload.hospital = draft.hospital.trim() || null
        // Z6 — same "always resend, whether touched or not" convention
        // this form already uses for cedulaProfesional/especialidad/
        // hospital above; resolveEditPhone resolves untouched → the
        // original value unchanged, so this never accidentally clears a
        // phone the doctor never touched.
        const resolution = resolveEditPhone(originalPhone, phoneState)
        if (!resolution.ok) return // defense in depth — handleSubmit already blocked this case
        payload.phone = resolution.phone
      }

      const updated = await profileService.updateMyProfile(payload)
      const savedDraft = toDraft(updated)
      setSnapshot(savedDraft)
      setDraft(savedDraft)
      setFieldErrors({})
      // Z3 — operation-result feedback ("Cambios guardados.") now goes
      // through the global action-notification toast instead of an inline
      // page banner.
      notifySuccess('Cambios guardados.')
      // Y3-FIX1 — the PATCH response is authoritative for this component's
      // own loaded state too, same as the initial GET. Email is read-only
      // and this contract never changes it, but re-deriving it from the
      // response (rather than leaving the old value alone) keeps this
      // component's state honest about where it came from.
      setEmail(updated.email)
      // Z6 — same authoritative-response reconciliation for phone: the
      // PATCH response becomes the new snapshot, CountryPhoneInput is
      // forced to remount from it (phoneResetNonce), and phoneState resets
      // to "untouched" — mirrors how `savedDraft` reconciles every other
      // field above.
      const savedPhone = updated.medico?.phone ?? null
      setOriginalPhone(savedPhone)
      setPhoneValueForInput(savedPhone)
      setPhoneState(null)
      setPhoneError(null)
      setPhoneResetNonce(n => n + 1)

      // Global identity (AuthContext) is updated ONLY here, after backend
      // success — never optimistically before the request resolves.
      // Y3-FIX1: `updated` (the backend response) is spread AFTER
      // `authUser` specifically so its fields — email included — always
      // win over whatever AuthContext/localStorage held before; a stale
      // cached email can never survive this merge. Fields this contract
      // doesn't return (e.g. createdAt) are preserved from `authUser`
      // rather than fabricated or dropped. If the request throws, this
      // line never runs and AuthContext stays exactly as it was.
      if (authUser) {
        setUser({ ...authUser, ...updated, email: updated.email })
      }
      // §25 — success closes the dialog; the "Cambios guardados." banner
      // then shows on the underlying page, same place it always has.
      setConfirmOpen(false)
      // PRE-Y8 (Profile Edit Mode §13) — a successful confirmed save exits
      // edit mode automatically; the user doesn't need a second action.
      // `snapshot`/`draft` are already reconciled to `savedDraft` above, so
      // `dirty` is false the instant this runs — no re-render can ever show
      // `isEditing === false` alongside a dirty form.
      setIsEditing(false)
    } catch (err) {
      // §25/§14 — mirrors the same pattern this app already uses for its
      // other confirmation dialogs (SecuritySettings' session-revoke
      // dialogs): close the dialog and report the error on the page itself,
      // rather than leaving the modal open with an error inside it.
      setConfirmOpen(false)
      if (isAxiosError(err) && err.response?.data?.code === 'DUPLICATE_CEDULA') {
        setFieldErrors(prev => ({ ...prev, cedulaProfesional: err.response!.data.error as string }))
      } else if (isAxiosError(err) && err.response?.data?.code === 'PHONE_REQUIRED_FOR_LOGIN') {
        // Z6-R1 §2/§17 — the backend's authoritative lockout rejection
        // (PhoneLastIdentifierError). The frontend guard in handleSubmit
        // above should normally catch this first, but the backend remains
        // the real authority — e.g. if `email` became stale between load
        // and save. Routed to phoneError, same as every other phone-field
        // business error.
        setPhoneError(err.response!.data.error as string)
      } else if (isAxiosError(err) && err.response?.data?.code === 'DUPLICATE_PHONE') {
        // Z6-R1-FIX1 §4/§5 — another Medico already owns this canonical
        // phone (DuplicatePhoneError, 409). Same field-specific routing as
        // DUPLICATE_CEDULA above and PHONE_REQUIRED_FOR_LOGIN just above —
        // phoneError is CountryPhoneInput's own error presentation, not a
        // generic page-level toast, so the conflict reads next to the field
        // that actually caused it. Never identifies the other doctor; the
        // backend message itself doesn't either.
        setPhoneError(err.response!.data.error as string)
      } else if (isAxiosError(err) && err.response?.status === 400 && err.response.data?.details) {
        // Z6 — `phone` is routed to CountryPhoneInput's own error
        // presentation (phoneError), not the generic FieldErrors list
        // (which has no phone input to attach to) — same split
        // PatientCreatePage/EditPatientModal already use for Paciente.phone.
        const { phone: phoneDetail, ...rest } = err.response!.data.details as Record<string, string>
        setFieldErrors(prev => ({ ...prev, ...(rest as FieldErrors) }))
        if (phoneDetail) setPhoneError(phoneDetail)
      } else if (isAxiosError(err) && err.response?.data?.error) {
        notifyError(err.response.data.error as string)
      } else {
        notifyError('No se pudieron guardar los cambios. Intenta de nuevo.')
      }
    } finally {
      setSaving(false)
    }
  }

  // PRE-Y8 (Profile Edit Mode §15) — this is the single exit-without-save
  // control for edit mode, reusing the exact same discard logic the old
  // "Descartar cambios" button used (restore `draft` to `snapshot`, clear
  // errors/banners), plus leaving edit mode. Per §15's "exactly one clear
  // exit-without-save action" requirement, the old bottom "Descartar
  // cambios" button — which discarded but stayed in edit mode — is removed
  // rather than kept alongside this one; see the final report's §15 for the
  // presentation choice. No backend request, no confirmation modal (§15/§23).
  const handleCancelEdit = () => {
    if (snapshot) setDraft(snapshot)
    setFieldErrors({})
    // Z6 — revert any in-progress phone edit back to the authoritative
    // persisted value, same discard semantics as every other field here.
    setPhoneValueForInput(originalPhone)
    setPhoneState(null)
    setPhoneError(null)
    setPhoneResetNonce(n => n + 1)
    setIsEditing(false)
  }

  // PRE-Y8 (Profile Edit Mode §5/§23) — entering edit mode is not
  // destructive and needs no confirmation. It never touches `draft`, so it
  // can never by itself make the form dirty (§16).
  const handleEnterEdit = () => {
    setIsEditing(true)
  }

  // Y3.1B §32 — AvatarUploadSection reads the authenticated user straight
  // from AuthContext (available immediately on mount), never from this
  // component's own GET /me/profile load state — so it renders in every
  // branch below, including while the text-profile form is still loading
  // or failed to load, rather than being gated behind it.

  if (loadState === 'loading') {
    return (
      <>
        <AvatarUploadSection />
        <SettingsSection title="Información personal" className="mt-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            Cargando perfil...
          </div>
        </SettingsSection>
      </>
    )
  }

  if (loadState === 'error' || !draft) {
    return (
      <>
        <AvatarUploadSection />
        <SettingsSection title="Información personal" className="mt-6">
          <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-lg px-3 py-2.5">
            <p className="text-xs text-red-700 dark:text-red-300">{loadError}</p>
          </div>
        </SettingsSection>
      </>
    )
  }

  return (
    <>
      <AvatarUploadSection />
      <SettingsSection
        title="Información personal"
        className="mt-6"
        headerAction={
          // PRE-Y8 (Profile Edit Mode §5/§15/§20) — single header action,
          // swapping between "Editar" (view mode) and "Cancelar edición"
          // (edit mode, the section's one exit-without-save control).
          isEditing ? (
            <button
              type="button"
              onClick={handleCancelEdit}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 ui-secondary-control-density text-sm font-medium rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            >
              Cancelar edición
            </button>
          ) : (
            <button
              type="button"
              onClick={handleEnterEdit}
              className="flex items-center gap-1.5 px-3 ui-secondary-control-density text-sm font-medium rounded-lg border border-border hover:bg-accent transition-colors flex-shrink-0"
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              Editar
            </button>
          )
        }
      >
        <form onSubmit={handleSubmit} className="ui-content-stack" noValidate>
          {/* Z3 — the save-result banner (success "Cambios guardados." /
              failure) previously here now shows as a global action
              notification instead (see handleConfirmSave). */}

          {/* Y3 §2/§36 — email is read-only always (never gated behind
              `isEditing`): editing it is explicitly out of scope, unlike the
              fields below which only become editable in edit mode. Sourced
              from this component's own authoritative GET /me/profile load
              (`email` state), never from AuthContext (see that state's own
              comment above).
              Z6-R1 §24 — a phone-only doctor has `email === null`; shows a
              neutral "No registrado" state rather than a blank field (never
              a literal "null"). */}
          <div>
            <FieldLabel icon={Mail}>Correo electrónico</FieldLabel>
            <input
              value={email ?? 'No registrado'}
              readOnly
              disabled
              autoComplete="email"
              className={inputClass(undefined, true)}
            />
          </div>

          {/* Pre-Y8 visual polish — Row 1: Nombre(s) / Apellidos. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel icon={UserIcon}>Nombre(s)</FieldLabel>
              <input
                value={draft.firstName}
                onChange={set('firstName')}
                autoComplete="given-name"
                readOnly={!isEditing}
                className={inputClass(!!fieldErrors.firstName, !isEditing)}
              />
              {fieldErrors.firstName && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.firstName}</p>}
            </div>
            <div>
              <FieldLabel icon={UserIcon}>Apellidos</FieldLabel>
              <input
                value={draft.lastName}
                onChange={set('lastName')}
                autoComplete="family-name"
                readOnly={!isEditing}
                className={inputClass(!!fieldErrors.lastName, !isEditing)}
              />
              {fieldErrors.lastName && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.lastName}</p>}
            </div>
          </div>

          {role === 'medico' && (
            <>
              {/* Pre-Y8 visual polish — Row 2 (medico-only): Especialidad
                  left, Cédula profesional right — swapped from this field's
                  previous left/right order to match the reference layout.
                  No field added or removed, no validation changed. */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel icon={Stethoscope}>Especialidad</FieldLabel>
                  <input
                    value={draft.especialidad}
                    onChange={set('especialidad')}
                    readOnly={!isEditing}
                    className={inputClass(undefined, !isEditing)}
                  />
                </div>
                <div>
                  <FieldLabel icon={BadgeCheck}>Cédula profesional</FieldLabel>
                  <input
                    value={draft.cedulaProfesional}
                    onChange={set('cedulaProfesional')}
                    readOnly={!isEditing}
                    className={inputClass(!!fieldErrors.cedulaProfesional, !isEditing)}
                  />
                  {fieldErrors.cedulaProfesional && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.cedulaProfesional}</p>
                  )}
                </div>
              </div>

              {/* Row 3 (medico-only): Hospital — full width. */}
              <div>
                <FieldLabel icon={Building2}>Hospital</FieldLabel>
                <input
                  value={draft.hospital}
                  onChange={set('hospital')}
                  readOnly={!isEditing}
                  className={inputClass(undefined, !isEditing)}
                />
              </div>

              {/* Z6 — doctor phone, same reusable CountryPhoneInput the
                  patient forms use. `disabled={!isEditing}` is this
                  component's own gating mechanism (it has no `readOnly`
                  prop), matching every other field in this section only
                  becoming interactive in edit mode. `value` is the stable
                  per-load/per-edit-session snapshot (`phoneValueForInput`),
                  never re-driven from every emitted onChange state (V6.3
                  §11/§12); `key` ties to `phoneResetNonce` so the control
                  always fully remounts and re-derives its display whenever
                  the authoritative value changes underneath it (load,
                  cancel, save). */}
              <div>
                <FieldLabel icon={Phone}>Teléfono</FieldLabel>
                <CountryPhoneInput
                  key={phoneResetNonce}
                  value={phoneValueForInput}
                  onChange={state => { setPhoneState(state); if (phoneError) setPhoneError(null) }}
                  label=""
                  disabled={!isEditing}
                  error={phoneError ?? undefined}
                />
                {/* Z6-R1 §17 — makes the lockout rule understandable BEFORE
                    the doctor tries to clear the field and gets blocked,
                    rather than only reacting after a rejected save. Shown
                    only while editing (view mode never needs it) and only
                    when there's no other error already occupying this
                    space. */}
                {isEditing && email === null && !phoneError && (
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Este es tu único método de inicio de sesión (no tienes un correo electrónico registrado); no puede quedar vacío.
                  </p>
                )}
              </div>
            </>
          )}

          {/* PRE-Y8 (Profile Edit Mode §9) — the Save button (and this whole
              row) only exists while `isEditing`; view mode never renders an
              always-visible disabled Save button. The old "Descartar
              cambios" text link is gone — "Cancelar edición" in the header
              (handleCancelEdit) is now the section's one exit-without-save
              control (§15), so keeping a second discard action here would
              violate that "exactly one" requirement. */}
          {isEditing && (
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="submit"
                disabled={!dirty || saving}
                className="flex items-center justify-center gap-2 bg-primary text-white px-4 rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm ui-control-density"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                <Save className="w-4 h-4" />
                Guardar cambios
              </button>
            </div>
          )}
        </form>
      </SettingsSection>

      {/* §14/§15/§25 — confirm-before-save dialog. Reuses the app's shared
          Dialog component (same one SecuritySettings already uses for its
          session-revoke confirmations) rather than a second modal
          implementation. `preventClose` is tied to `saving` so the request
          can't be dismissed mid-flight; the confirm button itself also
          disables while saving so it can't be clicked twice. */}
      <Dialog
        open={confirmOpen}
        onOpenChange={open => { if (!open) setConfirmOpen(false) }}
        title="Confirmar cambios"
        description="¿Deseas guardar los cambios realizados en tu información personal?"
        preventClose={saving}
      >
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => setConfirmOpen(false)}
            disabled={saving}
            className="px-3 ui-secondary-control-density text-sm font-medium rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirmSave}
            disabled={saving}
            className="flex items-center gap-2 px-3 ui-secondary-control-density text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <Save className="w-4 h-4" />
            Guardar cambios
          </button>
        </div>
      </Dialog>

      {/* SPA-navigation unsaved-change confirmation — only ever appears
          when `dirty` is true, since `useBlocker(dirty)` cannot enter the
          'blocked' state otherwise. Never auto-saves; always the person's
          explicit choice. */}
      {blocker.state === 'blocked' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-card border border-border rounded-xl shadow-lg max-w-sm w-full ui-card-density ui-content-stack">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-foreground text-sm">Tienes cambios sin guardar</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Si sales ahora, perderás los cambios que hiciste en tu perfil.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => blocker.reset()}
                className="px-3 ui-secondary-control-density text-sm font-medium rounded-lg border border-border hover:bg-accent transition-colors"
              >
                Permanecer
              </button>
              <button
                type="button"
                onClick={() => blocker.proceed()}
                className="px-3 ui-secondary-control-density text-sm font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                Salir sin guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
