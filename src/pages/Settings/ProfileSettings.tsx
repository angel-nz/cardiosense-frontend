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
// PRE-R2A §B — read-mode display helper: a single, complete, human-readable
// phone string (e.g. "+52 33 1234 5678"), never a fabricated reformat of an
// unparseable legacy value (returns the raw stored string unchanged in that
// case — see lib/phone.ts). Used ONLY for the non-editing presentation
// below; edit mode keeps using CountryPhoneInput's own country-selector +
// national-number architecture untouched.
import { formatInternationalDisplay } from '@/lib/phone'

// Bloque Y3 — real, end-to-end Profile section. Replaces the Y2 structural
// placeholder. Editable: firstName/lastName (all roles), cedulaProfesional/
// especialidad/hospital/phone (MEDICO only). No password confirmation for
// profile changes (still explicitly excluded by the Y3 contract). Avatar
// upload — excluded by Y3's original contract — is implemented in Y3.1B as
// its own independent section (AvatarUploadSection, rendered below) with
// its own immediate-action lifecycle, deliberately kept OUT of this
// component's draft/snapshot/dirty/useBlocker machinery (Y3.1B §32).
//
// PRE-R — email is no longer read-only (Y3 §2/§36 is superseded): it is now
// part of the editable draft, for every role, subject to the backend's
// final-state "email != null OR phone != null" invariant. See `validate`/
// `handleSubmit` below for the client-side mirror of that rule (defense in
// depth only — the backend remains authoritative, PRE-R §M).

// The editable draft shape. `email` joins it here (PRE-R) — a plain string,
// same convention as cedulaProfesional/especialidad/hospital below: '' on
// the wire means "no value", trimmed-and-nulled on save, never a separate
// stateful input machinery the way `phone` needs (CountryPhoneInput).
interface ProfileDraft {
  firstName: string
  lastName: string
  email: string
  cedulaProfesional: string
  especialidad: string
  hospital: string
}

type FieldErrors = Partial<Record<keyof ProfileDraft, string>>

// PRE-R — same inline format check RegisterPage.tsx already uses for this
// same field (client-side-only convenience; the backend's
// NullableCanonicalEmailField remains the real authority) — duplicated per
// this codebase's existing convention of a small per-page email regex
// rather than a shared import (see RegisterPage.tsx's own copy).
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function toDraft(profile: Pick<ProfileFields, 'firstName' | 'lastName' | 'email' | 'medico'>): ProfileDraft {
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email ?? '',
    cedulaProfesional: profile.medico?.cedulaProfesional ?? '',
    especialidad: profile.medico?.especialidad ?? '',
    hospital: profile.medico?.hospital ?? '',
  }
}

function draftsEqual(a: ProfileDraft, b: ProfileDraft): boolean {
  return a.firstName === b.firstName
    && a.lastName === b.lastName
    && a.email === b.email
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

  // PRE-R — email no longer needs its own separate "authoritative original"
  // state (unlike `phone` below, which genuinely does — CountryPhoneInput
  // owns a stateful country/national-input machine that must be told the
  // persisted value independently of the plain draft). Email is a plain
  // string field, exactly like firstName/lastName: `snapshot.email`/
  // `draft.email` (below) already ARE its authoritative-value and
  // editable-value tracking — Y3-FIX1's old separate `email` state (sourced
  // from GET/PATCH /users/me/profile, never AuthContext) is superseded by
  // that, not replaced by an equivalent.

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
  // PRE-R §G/§M — the "at least one of email/phone" GROUP requirement,
  // shown separately from each field's own format error (fieldErrors.email/
  // phoneError), same split RegisterPage.tsx already uses for its own
  // identical group rule.
  const [identifierError, setIdentifierError] = useState<string | null>(null)
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
        // PRE-R — email's authoritative load value is `d.email` (via
        // `toDraft`/`setSnapshot`/`setDraft` above), same as every other
        // plain-string field — no separate state to set here any more (see
        // this component's own top-of-state comment on why).
        // Z6 — authoritative phone snapshot, same "only ever set from a
        // successful load" rule email itself used to need separately.
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
    // PRE-R — any edit to the draft (email included) can change whether the
    // group "at least one identifier" rule would still fail, so the stale
    // message is cleared here exactly like every other field-level error.
    setIdentifierError(null)
  }

  const validate = (d: ProfileDraft): FieldErrors => {
    const errs: FieldErrors = {}
    if (!d.firstName.trim()) errs.firstName = 'Requerido'
    if (!d.lastName.trim()) errs.lastName = 'Requerido'
    // PRE-R — format-only check, mirrors RegisterPage.tsx's own inline
    // email validation. An empty value is fine on its own (clearing email
    // is allowed, provided phone covers the account) — that group rule is
    // checked separately in handleSubmit, after this format check passes.
    if (d.email.trim() && !EMAIL_REGEX.test(d.email.trim())) {
      errs.email = 'Correo electrónico no válido'
    }
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
    setIdentifierError(null)

    // PRE-R §G — the prospective (post-save) email, same resolution rule
    // every other plain-string field here already uses: blank → null,
    // non-blank → the trimmed value.
    const prospectiveEmail = draft.email.trim() || null

    // Z6 — an actively invalid/incomplete phone blocks save entirely,
    // before the confirmation dialog ever opens — mirrors PatientCreatePage/
    // EditPatientModal's own validate()-before-dialog placement.
    if (role === 'medico') {
      const resolution = resolveEditPhone(originalPhone, phoneState)
      if (!resolution.ok) {
        setPhoneError('Número de teléfono incompleto o no válido para el país seleccionado.')
        return
      }
      // PRE-R §G — final-state identity invariant, frontend-side defense in
      // depth (mirrors the backend's LastLoginIdentifierError check
      // exactly): block only when BOTH the prospective email AND the
      // prospective phone would be null after this save — never when only
      // one is empty, and never by disabling either field ahead of time
      // (PRE-R §M — "do not disable a field merely because it is currently
      // the only identifier if the user is simultaneously providing the
      // other identifier in the same save").
      if (prospectiveEmail === null && resolution.phone === null) {
        setIdentifierError('Debes conservar al menos un correo electrónico o un número de teléfono para acceder a tu cuenta.')
        return
      }
    } else if (prospectiveEmail === null) {
      // A non-MEDICO account has no phone fallback at all (no Medico row),
      // so for that role email can never be cleared — same pre-existing
      // contract RegisterDto already enforces at registration for non-
      // MEDICO accounts (auth.dto.ts), just now reachable from this route
      // too since email only became editable here under PRE-R.
      setIdentifierError('Debes conservar al menos un correo electrónico para acceder a tu cuenta.')
      return
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
        // PRE-R — always resent, whether touched or not, same "always
        // resend" convention this form already uses for cedulaProfesional/
        // especialidad/hospital below (not an omit-if-unchanged field).
        email: draft.email.trim() || null,
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
      setIdentifierError(null)
      // Z3 — operation-result feedback ("Cambios guardados.") now goes
      // through the global action-notification toast instead of an inline
      // page banner.
      notifySuccess('Cambios guardados.')
      // Y3-FIX1 — the PATCH response is authoritative for this component's
      // own loaded state too, same as the initial GET. PRE-R — email's
      // canonical, server-returned value (never assumed from the request —
      // PRE-R §K) is already captured above via `savedDraft` (`toDraft(updated)`
      // → `setSnapshot`/`setDraft`), same as firstName/lastName.
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
      } else if (isAxiosError(err) && err.response?.data?.code === 'DUPLICATE_EMAIL') {
        // PRE-R §J — another account already owns this email
        // (DuplicateEmailError, 409). Same field-specific routing as
        // DUPLICATE_CEDULA above — reads next to the field that actually
        // caused it. Never identifies the other account; the backend
        // message itself doesn't either.
        setFieldErrors(prev => ({ ...prev, email: err.response!.data.error as string }))
      } else if (isAxiosError(err) && err.response?.data?.code === 'LAST_LOGIN_IDENTIFIER_REQUIRED') {
        // PRE-R §G — the backend's authoritative final-state-identity
        // rejection (LastLoginIdentifierError, replacing the old Z6-R1
        // PhoneLastIdentifierError/PHONE_REQUIRED_FOR_LOGIN). The frontend
        // guard in handleSubmit above should normally catch this first, but
        // the backend remains the real authority — e.g. if email/phone
        // became stale between load and save. Routed to the shared
        // identifierError, not a single field, since the rule is about the
        // combination of both.
        setIdentifierError(err.response!.data.error as string)
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
    setIdentifierError(null)
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
                  placeholder="No registrada"
                    readOnly={!isEditing}
                    className={inputClass(undefined, !isEditing)}
                  />
                </div>
                <div>
                  <FieldLabel icon={BadgeCheck}>Cédula profesional</FieldLabel>
                  <input
                    value={draft.cedulaProfesional}
                    onChange={set('cedulaProfesional')}
                  placeholder="No registrada"
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
                <FieldLabel icon={Building2}>Hospital/Institución</FieldLabel>
                <input
                  value={draft.hospital}
                  onChange={set('hospital')}
                  placeholder="No registrado"
                  readOnly={!isEditing}
                  className={inputClass(undefined, !isEditing)}
                />
              </div>

              
              <div>
                <FieldLabel icon={Mail}>Correo electrónico</FieldLabel>
                <input
                  type="email"
                  value={draft.email}
                  onChange={set('email')}
                  placeholder="No registrado"
                  autoComplete="email"
                  readOnly={!isEditing}
                  className={inputClass(!!fieldErrors.email, !isEditing)}
                />
                {fieldErrors.email && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.email}</p>}
              </div>

              <div>
                <FieldLabel icon={Phone}>Teléfono</FieldLabel>
                {isEditing ? (
                  <CountryPhoneInput
                    key={phoneResetNonce}
                    value={phoneValueForInput}
                    onChange={state => { setPhoneState(state); if (phoneError) setPhoneError(null); setIdentifierError(null) }}
                    label=""
                    error={phoneError ?? undefined}
                  />
                ) : (
                  <input
                    value={originalPhone ? formatInternationalDisplay(originalPhone) : ''}
                    placeholder="No registrado"
                    readOnly
                    className={inputClass(undefined, true)}
                  />
                )}
                {identifierError && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">{identifierError}</p>
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
