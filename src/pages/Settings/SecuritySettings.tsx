import { useState, useEffect, useCallback, type ChangeEvent, type FormEvent } from 'react'
import { useBlocker } from 'react-router-dom'
import { isAxiosError } from 'axios'
import { Loader2, AlertTriangle, Eye, EyeOff, Monitor, RotateCcw, ShieldAlert, Shield } from 'lucide-react'
import { cn, formatDateTime, timeAgo } from '@/lib/utils'
import { SettingsSection } from '@/components/settings/SettingsSection'
import { Dialog } from '@/components/ui/Dialog'
import { securityService } from '@/services/securityService'
import { parseUserAgent } from '@/lib/userAgent'
import { useAuth } from '@/context/AuthContext'
import { useActionNotify } from '@/context/ToastContext'
import type { Session } from '@/types'

// Bloque Y5.1 — real, end-to-end password change. Replaces the Y2
// structural placeholder. Exactly one feature: authenticated password
// change (currentPassword → newPassword, confirmed client-side).
//
// No initial GET — the form always starts empty (Y5.1 §22). Interaction
// model mirrors Y3/Y4 (server-authoritative save, explicit dirty tracking,
// unsaved-change SPA blocker + beforeunload, "Permanecer"/"Salir sin
// guardar"), implemented LOCALLY rather than extracted into a shared hook
// with ProfileSettings/NotificationSettings — deliberately duplicated, per
// Y5.1 §27, to avoid touching those already-validated components.
//
// Bloque Y5.3 — adds the real Active Sessions section below the password
// form (Y5.3 §4's explicit final structure: this file now renders TWO
// SettingsSection cards — "Cambiar contraseña" (this same Y5.1 form; only
// its card TITLE changed, from the page-level "Seguridad" to this more
// specific label, since the page now has two subsections to distinguish)
// and "Sesiones activas" (new). The two slices are deliberately kept
// independent: `dirty` below still means ONLY "password fields have
// unsaved text" (Y5.3 §31 — session loading/revocation must never trigger
// the unsaved-changes blocker), and the one required integration point
// (Y5.3 §30/§45 — a successful password change revokes every OTHER
// session server-side, so the visible session list must not go stale) is
// implemented as a single explicit `loadSessions()` call from inside the
// password form's own success path, not a shared/merged state slice.

interface FieldErrors {
  currentPassword?: string
  newPassword?: string
  confirmPassword?: string
}

// Y5.1 §6 — mirrors backend RegisterDto.shape.password EXACTLY (reused
// directly server-side in user.routes.ts's ChangePasswordDto): min 8 chars,
// at least one uppercase, at least one number. This is the same local-copy
// pattern RegisterPage.tsx already uses for the identical rule (no shared
// validation module exists in this codebase) — frontend validation here is
// UX only; the backend remains authoritative.
function validateNewPassword(pwd: string): string | null {
  if (pwd.length < 8) return 'Mínimo 8 caracteres'
  if (!/[A-Z]/.test(pwd)) return 'Debe incluir una mayúscula'
  if (!/[0-9]/.test(pwd)) return 'Debe incluir un número'
  return null
}

// Y6.3B — `ui-control-density` replaces `py-2.5` (Classic exact match, §45).
const inputClass = (hasError?: boolean) => cn(
  'w-full px-3 text-sm rounded-lg border bg-card pr-10 ui-control-density',
  'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
  'transition-all',
  hasError ? 'border-red-400 dark:border-red-500/70' : 'border-border',
)

const RequiredMark = () => <span className="text-red-500 dark:text-red-400" aria-hidden="true"> *</span>

export default function SecuritySettings() {
  const { notifySuccess, notifyError } = useActionNotify()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  // PRE-Y8 (Settings Interaction Policy Refinement §19/§20) — password
  // change is a CONFIRMED account action. Submitting the form no longer
  // PATCHes directly: it validates first (no dialog on invalid input —
  // §26), and only opens this confirmation dialog once the form is valid.
  const [confirmPasswordOpen, setConfirmPasswordOpen] = useState(false)

  // Y5.1 §22 — dirty whenever ANY password field is non-empty.
  const dirty = currentPassword !== '' || newPassword !== '' || confirmPassword !== ''

  const newPasswordPolicyError = newPassword ? validateNewPassword(newPassword) : null
  const canSubmit =
    !saving &&
    currentPassword.trim().length > 0 &&
    newPassword.length > 0 &&
    !newPasswordPolicyError &&
    confirmPassword.length > 0 &&
    confirmPassword === newPassword &&
    newPassword !== currentPassword

  // ── Unsaved-change protection: SPA navigation ──────────────────────────
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

  // ─── Y5.3 — Active Sessions ───────────────────────────────────────────
  // `logout` reused directly from AuthContext (Y5.3 §17 — "prefer reusing
  // the existing AuthContext logout/finalization architecture" — no second,
  // parallel auth-cleanup implementation added here).
  const { logout } = useAuth()

  type SessionsState =
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'success'; sessions: Session[] }

  const [sessionsState, setSessionsState] = useState<SessionsState>({ status: 'loading' })
  // Page-level mutation lock (Y5.3 §22 — "a simple page-level mutation lock
  // is acceptable if cleaner"): null when idle, a sessionId while that one
  // row's revoke is in flight, or 'others' while the bulk revoke is in
  // flight. Every revoke control checks this to disable ALL session
  // actions during any single mutation, preventing overlapping/conflicting
  // requests — not just the one button that was clicked.
  const [mutatingTarget, setMutatingTarget] = useState<string | 'others' | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<Session | null>(null)
  const [confirmOthersOpen, setConfirmOthersOpen] = useState(false)

  const loadSessions = useCallback(async () => {
    setSessionsState({ status: 'loading' })
    try {
      const sessions = await securityService.getSessions()
      setSessionsState({ status: 'success', sessions })
    } catch {
      setSessionsState({ status: 'error' })
    }
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])

  // Y5.3 §8/§9 — presentation-only ordering: current session(s) first
  // (backend's own `current` flag decides which, never userAgent/order/
  // createdAt), remaining sessions by lastUsedAt descending, with a
  // deterministic id tie-breaker. Never mutates backend persistence order
  // (GET already orders by lastUsedAt desc server-side — this is a
  // separate, display-only re-sort).
  function sortForDisplay(sessions: Session[]): Session[] {
    return [...sessions].sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1
      const byLastUsed = new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime()
      if (byLastUsed !== 0) return byLastUsed
      return a.id.localeCompare(b.id)
    })
  }

  async function handleConfirmRevoke() {
    if (!confirmTarget) return
    const target = confirmTarget
    setMutatingTarget(target.id)
    try {
      const result = await securityService.revokeSession(target.id)
      setConfirmTarget(null)
      if (result.currentRevoked) {
        // Y5.3 §17/§44 — the backend has ALREADY revoked this session row
        // and cleared the refresh cookie by the time this response
        // returns. `logout()` is called so the frontend's in-memory
        // access-token/user state, the authenticated socket (torn down via
        // `isAuthenticated` flipping false), and the existing cross-tab
        // logout signal all follow the same real path any other logout
        // takes — ProtectedRoute then redirects to /login on its own once
        // `isAuthenticated` is false, so no manual navigate() is needed
        // here. This does send one extra POST /auth/logout beyond the
        // DELETE just made — confirmed safe/idempotent by inspecting
        // auth.service.ts's logout: it re-resolves the current session
        // (now none, since the cookie is already cleared), skips
        // revokeSession, and just clears the (already-cleared) cookie
        // again — documented in the Y5.3 report, not hidden.
        await logout()
        return
      }
      // Z3 — operation-result feedback now goes through the global
      // action-notification toast instead of an inline page banner.
      notifySuccess('Sesión cerrada correctamente.')
      await loadSessions()
    } catch (err) {
      setConfirmTarget(null)
      // Y5.3 §25 — the target may already have been revoked from another
      // browser (404) or (defensively) no longer belong to this user
      // (403); either way, never resurrect it locally — refetch and let
      // canonical backend state win.
      if (isAxiosError(err) && (err.response?.status === 404 || err.response?.status === 403)) {
        notifyError('Esa sesión ya no existe o ya había sido cerrada.')
      } else {
        notifyError('No se pudo cerrar la sesión. Intenta de nuevo.')
      }
      await loadSessions()
    } finally {
      setMutatingTarget(null)
    }
  }

  async function handleConfirmRevokeOthers() {
    setMutatingTarget('others')
    try {
      await securityService.revokeOtherSessions()
      setConfirmOthersOpen(false)
      notifySuccess('Se cerraron las demás sesiones.')
      await loadSessions()
    } catch {
      setConfirmOthersOpen(false)
      notifyError('No se pudieron cerrar las demás sesiones. Intenta de nuevo.')
    } finally {
      setMutatingTarget(null)
    }
  }

  function fieldChange(setter: (v: string) => void, field: keyof FieldErrors) {
    return (e: ChangeEvent<HTMLInputElement>) => {
      setter(e.target.value)
      setFieldErrors(prev => (prev[field] ? { ...prev, [field]: undefined } : prev))
    }
  }

  // §19/§26 — validation happens BEFORE confirmation, on the real submit.
  // An invalid form shows the normal field errors and never opens the
  // dialog; only a valid form opens it. No PATCH happens here — that only
  // happens from handleConfirmPasswordChange, after explicit confirmation.
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (saving) return

    // Client-side pre-check (UX only — Y5.1 §20). Never sends
    // confirmPassword to the backend.
    const errors: FieldErrors = {}
    if (!currentPassword.trim()) errors.currentPassword = 'La contraseña actual es requerida'
    const policyError = validateNewPassword(newPassword)
    if (policyError) errors.newPassword = policyError
    if (!confirmPassword) errors.confirmPassword = 'Confirma la nueva contraseña'
    else if (confirmPassword !== newPassword) errors.confirmPassword = 'Las contraseñas no coinciden'
    if (!policyError && newPassword && currentPassword && newPassword === currentPassword) {
      errors.newPassword = 'La nueva contraseña debe ser diferente de la actual'
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    setFieldErrors({})
    setConfirmPasswordOpen(true)
  }

  // §19 — the actual password-change flow, unchanged from before except
  // that it now runs only after explicit confirmation. Cancelling the
  // dialog never calls this — the typed fields are left exactly as they
  // were, with no API request (§19/§26 S03).
  const handleConfirmPasswordChange = async () => {
    if (saving) return
    setSaving(true)
    try {
      await securityService.changePassword({ currentPassword, newPassword })
      // Y5.1 §23 — only after real backend success: clear all three fields
      // (dirty becomes false as a direct consequence), show success feedback,
      // user remains logged in — no token/session handling here at all.
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      // Z3 — operation-result feedback ("Contraseña actualizada
      // correctamente.") now goes through the global action-notification
      // toast instead of an inline page banner.
      notifySuccess('Contraseña actualizada correctamente.')
      // Y5.3 §30/§45 (required integration) — Y5.2's password-change route
      // preserves this browser's own session but revokes every OTHER
      // session server-side. If the Sessions section below is already
      // loaded, it must not keep showing now-revoked other sessions as if
      // they were still active — refetch the canonical list right after a
      // successful change. Does not duplicate the password update itself
      // and does not change any backend semantics; a plain refetch of
      // already-existing GET /users/me/sessions.
      void loadSessions()
      // §25 — success closes the dialog.
      setConfirmPasswordOpen(false)
    } catch (err) {
      // §25 — failure also closes the dialog. Field-level errors stay
      // inline on the form itself (FIELD_VALIDATION); a generic failure
      // with nothing more specific to attach to a field is now reported
      // via the global action-notification toast (Z3) instead of an
      // inline page banner.
      setConfirmPasswordOpen(false)
      if (isAxiosError(err)) {
        const status = err.response?.status
        const code = err.response?.data?.code as string | undefined
        if (status === 401 && code === 'INVALID_CURRENT_PASSWORD') {
          // Y5.1 §24 — specific inline field error, no logout/redirect (the
          // narrow api.ts interceptor exception keeps the session intact).
          // Current password is cleared after this error (chosen UX,
          // reported as such) — the new/confirm fields are preserved so the
          // user doesn't have to retype them.
          setFieldErrors({ currentPassword: 'La contraseña actual es incorrecta.' })
          setCurrentPassword('')
        } else if (status === 400 && code === 'PASSWORD_UNCHANGED') {
          setFieldErrors({ newPassword: 'La nueva contraseña debe ser diferente de la actual.' })
        } else if (status === 400 && err.response?.data?.details) {
          const details = err.response.data.details as Record<string, string>
          const mapped: FieldErrors = {}
          if (details.currentPassword) mapped.currentPassword = details.currentPassword
          if (details.newPassword) mapped.newPassword = details.newPassword
          if (Object.keys(mapped).length > 0) setFieldErrors(mapped)
          else notifyError('No se pudo actualizar la contraseña. Verifica los datos.')
        } else if (status === 429) {
          notifyError('Demasiados intentos. Intenta de nuevo más tarde.')
        } else if (status === 401) {
          // Generic/expired-token 401 — the global api.ts interceptor is
          // already handling logout/redirect for this case; nothing
          // additional to show here.
        } else {
          notifyError('No se pudo actualizar la contraseña. Intenta de nuevo.')
        }
      } else {
        notifyError('No se pudo actualizar la contraseña. Intenta de nuevo.')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = () => {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setFieldErrors({})
  }

  // Y5.3 — derived, display-only session counts. `sessions` here is never a
  // second copy of canonical state; it's just a same-render alias for
  // whichever array is currently in `sessionsState` (empty otherwise).
  const sessions = sessionsState.status === 'success' ? sessionsState.sessions : []
  const currentSessionCount = sessions.filter(s => s.current).length
  const otherSessionsCount = sessions.filter(s => !s.current).length

  return (
    <>
      {/* Y5.3 §4 — card title changed from the page-level "Seguridad" (still
          the sidebar/nav label — SettingsLayout.tsx, unchanged) to this
          more specific one, now that the page has two distinct subsections
          to tell apart. Nothing else about this form changed. */}
      <SettingsSection title="Cambiar contraseña">
        <form onSubmit={handleSubmit} className="ui-content-stack" noValidate>
          <p className="text-sm text-muted-foreground">
            Para cambiar la contraseña de tu cuenta deberás ingresar tu contraseña actual.
          </p>

          {/* Z3 — the form-level result banner (generic failure /
              "Contraseña actualizada correctamente.") previously here now
              shows as a global action notification instead (see
              handleConfirmPasswordChange). Field-level errors
              (INVALID_CURRENT_PASSWORD, PASSWORD_UNCHANGED, `details`)
              remain inline below their own fields — unchanged. */}

          <div>
            <label htmlFor="current-password" className="text-sm font-medium text-foreground block mb-1.5">
              Contraseña actual<RequiredMark />
            </label>
            <div className="relative">
              <input
                id="current-password"
                type={showCurrent ? 'text' : 'password'}
                value={currentPassword}
                onChange={fieldChange(setCurrentPassword, 'currentPassword')}
                autoComplete="current-password"
                required
                aria-required="true"
                aria-invalid={!!fieldErrors.currentPassword}
                disabled={saving}
                className={inputClass(!!fieldErrors.currentPassword)}
              />
              <button
                type="button"
                onClick={() => setShowCurrent(s => !s)}
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showCurrent ? 'Ocultar contraseña actual' : 'Mostrar contraseña actual'}
              >
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {fieldErrors.currentPassword && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.currentPassword}</p>
            )}
          </div>

          <div>
            <label htmlFor="new-password" className="text-sm font-medium text-foreground block mb-1.5">
              Nueva contraseña<RequiredMark />
            </label>
            <div className="relative">
              <input
                id="new-password"
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={fieldChange(setNewPassword, 'newPassword')}
                autoComplete="new-password"
                required
                aria-required="true"
                aria-invalid={!!fieldErrors.newPassword}
                disabled={saving}
                className={inputClass(!!fieldErrors.newPassword)}
              />
              <button
                type="button"
                onClick={() => setShowNew(s => !s)}
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showNew ? 'Ocultar nueva contraseña' : 'Mostrar nueva contraseña'}
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {fieldErrors.newPassword
              ? <p className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.newPassword}</p>
              : <p className="text-xs text-muted-foreground mt-1">Mínimo 8 caracteres, una mayúscula y un número.</p>}
          </div>

          <div>
            <label htmlFor="confirm-password" className="text-sm font-medium text-foreground block mb-1.5">
              Confirmar nueva contraseña<RequiredMark />
            </label>
            <input
              id="confirm-password"
              type={showNew ? 'text' : 'password'}
              value={confirmPassword}
              onChange={fieldChange(setConfirmPassword, 'confirmPassword')}
              autoComplete="new-password"
              required
              aria-required="true"
              aria-invalid={!!fieldErrors.confirmPassword}
              disabled={saving}
              className={inputClass(!!fieldErrors.confirmPassword)}
            />
            {fieldErrors.confirmPassword && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.confirmPassword}</p>
            )}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex items-center justify-center gap-2 bg-primary text-white px-4 rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm ui-control-density"
            >
              {/* Pre-Y8 visual polish — button icon only, matching the
                  reference's shield-icon treatment. `Shield` is already this
                  app's established security icon (same one SettingsLayout
                  uses for the "Seguridad" nav item), reused here rather than
                  introducing a second shield variant next to the existing
                  `ShieldAlert` (which stays exactly where it already was,
                  in the session-revoke warning below — unrelated, untouched).
                  Loader2 still replaces it during the real submit request;
                  decorative (aria-hidden) since the button's text already
                  names the action. */}
              {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Shield className="w-4 h-4" aria-hidden="true" />}
              Cambiar contraseña
            </button>
            {dirty && !saving && (
              <button
                type="button"
                onClick={handleDiscard}
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Descartar cambios
              </button>
            )}
          </div>
        </form>
      </SettingsSection>

      {/* Y5.3 — Active Sessions. Fully independent from the password
          form's own state above: this section never reads/sets `dirty`,
          `saving`, or any password field (Y5.3 §31 — opening a
          confirmation dialog here, or loading/revoking a session, must
          never trigger the password form's unsaved-changes blocker). */}
      <SettingsSection title="Sesiones activas" className="mt-6">
        <div className="ui-content-stack">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <p className="text-sm text-muted-foreground max-w-md">
              Navegadores y dispositivos con tu cuenta con sesión activa.
            </p>
            {sessionsState.status === 'success' && (
              <button
                type="button"
                onClick={() => setConfirmOthersOpen(true)}
                disabled={mutatingTarget !== null || otherSessionsCount === 0}
                className="flex items-center justify-center gap-2 px-3 ui-secondary-control-density text-sm font-medium rounded-lg border border-red-200 dark:border-red-800/60 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/60 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors flex-shrink-0"
              >
                {mutatingTarget === 'others' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Cerrar todas las demás sesiones
              </button>
            )}
          </div>

          {/* Z3 — the revoke success/error banner (individual and bulk)
              previously here now shows as a global action notification
              instead (see handleConfirmRevoke / handleConfirmRevokeOthers).
              The load-failure banner just below (`sessionsState.status ===
              'error'`) is a PERSISTENT_STATE, not an action result — it
              stays inline, same as ProfileSettings' own `loadError`. */}

          {sessionsState.status === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Cargando sesiones...
            </div>
          )}

          {sessionsState.status === 'error' && (
            <div className="flex items-center justify-between gap-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-lg px-3 py-2.5">
              <p className="text-xs text-red-700 dark:text-red-300">No se pudieron cargar las sesiones activas.</p>
              <button
                type="button"
                onClick={() => loadSessions()}
                className="flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-300 flex-shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reintentar
              </button>
            </div>
          )}

          {sessionsState.status === 'success' && sessions.length === 0 && (
            <p className="text-sm text-muted-foreground py-4">No se encontraron sesiones activas.</p>
          )}

          {sessionsState.status === 'success' && sessions.length > 0 && (
            <>
              {/* Y5.3 §9 — never invented/resolved client-side: rendered
                  faithfully (every session the backend marks current gets
                  its own badge) with a purely observational notice, never a
                  blocking error. */}
              {currentSessionCount > 1 && (
                <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-lg px-3 py-2.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Se detectó más de una sesión marcada como la actual. Esto es inesperado.
                  </p>
                </div>
              )}
              <div>
                {sortForDisplay(sessions).map(session => {
                  const { label } = parseUserAgent(session.userAgent)
                  const isMutatingThis = mutatingTarget === session.id
                  const anyMutationInFlight = mutatingTarget !== null
                  return (
                    <div
                      key={session.id}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-3 border-b border-border last:border-b-0"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Monitor className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-foreground">{label}</p>
                            {session.current && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                                Esta sesión
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Sesión iniciada: {formatDateTime(session.createdAt)}
                          </p>
                          {/* Y5.3 §13 — never "Activo ahora": lastUsedAt is
                              only updated on refresh/session use, not on
                              every request, so a relative label ("hace X")
                              is honest about what this timestamp actually
                              tracks, for the current session too. */}
                          <p className="text-xs text-muted-foreground">
                            Última actividad: {timeAgo(session.lastUsedAt)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Expira: {formatDateTime(session.expiresAt)}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setConfirmTarget(session)}
                        disabled={anyMutationInFlight}
                        aria-label={`Cerrar sesión: ${label}${session.current ? ' (esta sesión)' : ''}`}
                        className="flex items-center justify-center gap-2 px-3 ui-secondary-control-density text-sm font-medium rounded-lg border border-red-700 dark:border-red-800/60 text-red-700 dark:text-red-300 bg-red-50 hover:bg-red-100 dark:bg-red-950/15 dark:hover:bg-red-950/60 transition-colors flex-shrink-0 self-start sm:self-center"
                      >
                        {isMutatingThis && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Cerrar sesión
                      </button>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </SettingsSection>

      {/* SPA-navigation unsaved-change confirmation — only appears when
          `dirty` is true (useBlocker(dirty) cannot enter 'blocked'
          otherwise). Never autosaves; leaving discards the in-memory
          password values naturally (component unmounts). */}
      {blocker.state === 'blocked' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-card border border-border rounded-xl shadow-lg max-w-sm w-full ui-card-density ui-content-stack">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-foreground text-sm">Tienes cambios sin guardar</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Si sales ahora, perderás los datos ingresados para cambiar tu contraseña.
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

      {/* Y5.3 §16/§18 — individual-session revoke confirmation. Copy
          branches on `confirmTarget.current` (never on list order or
          userAgent): the current-session variant is the explicit,
          distinguishable warning Y5.3 §18 requires. `preventClose` is tied
          to the mutation lock, not just this dialog's own state, so the
          user can't dismiss it mid-request. No password re-entry, matching
          Y5.3 §16. */}
      <Dialog
        open={confirmTarget !== null}
        onOpenChange={open => { if (!open) setConfirmTarget(null) }}
        title="¿Cerrar esta sesión?"
        description={
          confirmTarget?.current
            ? 'Se cerrará tu sesión actual y tendrás que iniciar sesión nuevamente.'
            : 'Ese navegador o dispositivo no podrá renovar su sesión y tendrá que iniciar sesión de nuevo.'
        }
        preventClose={mutatingTarget !== null}
      >
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => setConfirmTarget(null)}
            disabled={mutatingTarget !== null}
            className="px-3 ui-secondary-control-density text-sm font-medium rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirmRevoke}
            disabled={mutatingTarget !== null}
            className="flex items-center gap-2 px-3 ui-secondary-control-density text-sm font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {confirmTarget && mutatingTarget === confirmTarget.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Cerrar sesión
          </button>
        </div>
      </Dialog>

      {/* Y5.3 §21 — bulk revoke-others confirmation. Never implies precise
          physical devices — copy stays at "navegadores o dispositivos",
          matching what userAgent-derived labels can actually claim. */}
      <Dialog
        open={confirmOthersOpen}
        onOpenChange={open => { if (!open) setConfirmOthersOpen(false) }}
        title="¿Cerrar todas las demás sesiones?"
        description="Se cerrarán las sesiones de otros navegadores o dispositivos. Esta sesión permanecerá activa."
        preventClose={mutatingTarget !== null}
      >
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => setConfirmOthersOpen(false)}
            disabled={mutatingTarget !== null}
            className="px-3 ui-secondary-control-density text-sm font-medium rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirmRevokeOthers}
            disabled={mutatingTarget !== null}
            className="flex items-center gap-2 px-3 ui-secondary-control-density text-sm font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mutatingTarget === 'others' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Cerrar las demás sesiones
          </button>
        </div>
      </Dialog>

      {/* §19/§20 — password-change confirmation. No password value is ever
          rendered inside this dialog, per §20. Confirm uses primary
          styling, not destructive red — this is a confirmation, not a
          danger warning (§20). */}
      <Dialog
        open={confirmPasswordOpen}
        onOpenChange={open => { if (!open) setConfirmPasswordOpen(false) }}
        title="Confirmar cambio de contraseña"
        description="¿Deseas actualizar la contraseña de tu cuenta?"
        preventClose={saving}
      >
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => setConfirmPasswordOpen(false)}
            disabled={saving}
            className="px-3 ui-secondary-control-density text-sm font-medium rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirmPasswordChange}
            disabled={saving}
            className="flex items-center gap-2 px-3 ui-secondary-control-density text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Cambiar contraseña
          </button>
        </div>
      </Dialog>
    </>
  )
}
