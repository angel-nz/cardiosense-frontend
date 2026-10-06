import { useState, useRef, useEffect, type ChangeEvent } from 'react'
import { isAxiosError } from 'axios'
import { Loader2, Upload, Trash2, AlertTriangle, RefreshCw, Camera, Save } from 'lucide-react'
import { SettingsSection } from '@/components/settings/SettingsSection'
import { Dialog } from '@/components/ui/Dialog'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { useAuth } from '@/context/AuthContext'
import { useAvatar } from '@/context/AvatarContext'
import { useActionNotify } from '@/context/ToastContext'
import { avatarService } from '@/services/avatarService'
import { fullName } from '@/lib/utils'
import { formatInternationalDisplay } from '@/lib/phone'

// PRE-R2A §A — neutral empty-state label for the presentation card's
// Especialidad/Correo/Teléfono rows, matching the exact string this
// codebase already uses elsewhere for "no value set" (ProfileSettings'
// email placeholder, RegisterPage's placeholders) — not a new convention.
//
// PRE-R2B-FIX1 §2/§3 — root cause of the Presentation Card regression: this
// constant had been changed to '' (empty string), so a missing
// Especialidad/Correo/Teléfono rendered as a blank line instead of the
// PRE-R2A-approved neutral text. Restored to the approved, non-empty
// "No registrado" — the authoritative contract this FIX block restates
// verbatim. Every other PRE-R2A-approved detail in this card (order:
// Especialidad, Nombre completo, Correo, Teléfono completo; one complete
// formatted phone value via formatInternationalDisplay; no collapsing
// email/phone into a single fallback identifier) was already correct and
// is left untouched.

// Y3.1B §31 — real avatar section for Profile, replacing nothing (Y3.1A's
// header comment explicitly excluded avatar upload; that exclusion is
// lifted here). Deliberately its OWN SettingsSection, rendered by
// ProfileSettings.tsx alongside — never inside — the text-profile form
// (Y3.1B §32: avatar actions are immediate/explicit, never part of the
// text form's draft/snapshot/dirty/useBlocker machinery).
//
// PRE-Y8 (Avatar Viewer & Management Modal) — the card no longer renders
// any permanent Change/Select/Delete buttons (§1/§10). The avatar itself is
// now the single entry point: a real <button> that opens ONE
// avatar-management Dialog. That Dialog has three internal CONTENT STAGES
// ('view' / 'confirmUpload' / 'confirmDelete') rather than three separate
// Dialogs — deliberately, per §12: mounting two independent
// RadixDialog.Root/Portal instances at once (the old confirmUploadOpen +
// confirmDeleteOpen booleans, each its own <Dialog>) would risk stacked
// focus-trap/Escape/overlay conflicts and z-index bugs (Dialog.tsx's
// overlay/content use fixed z-40/z-50, which only ever assumed ONE
// instance open at a time). A single Dialog whose title/description/
// children swap by stage sidesteps all of that entirely, while still
// preserving the exact same validate → confirm → mutate contract as
// before.

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024

// One fixed message per backend error code (Y3.1B §15's frozen contract) —
// never the raw backend error string verbatim.
const ERROR_MESSAGES: Record<string, string> = {
  FILE_TOO_LARGE: 'La imagen supera el tamaño máximo permitido (5 MB).',
  UNSUPPORTED_MEDIA_TYPE: 'Formato no compatible. Usa JPEG, PNG o WebP.',
  INVALID_IMAGE: 'El archivo no pudo procesarse como una imagen válida.',
  IMAGE_DIMENSIONS_EXCEEDED: 'Las dimensiones de la imagen son demasiado grandes.',
  ANIMATED_IMAGE_NOT_SUPPORTED: 'No se admiten imágenes animadas.',
  IMAGE_OUTPUT_TOO_LARGE: 'No fue posible comprimir la imagen lo suficiente. Prueba con otra.',
  RATE_LIMITED: 'Demasiados intentos. Intenta de nuevo en unos minutos.',
  PROCESSING_FAILED: 'No se pudo procesar la imagen. Intenta de nuevo.',
  STORAGE_UNAVAILABLE: 'No se pudo guardar la imagen. Intenta de nuevo más tarde.',
}
const DEFAULT_ERROR_MESSAGE = 'No se pudo subir la imagen. Intenta de nuevo.'
const DEFAULT_DELETE_ERROR_MESSAGE = 'No se pudo eliminar la imagen. Intenta de nuevo.'

// PRE-Y8 (Avatar Viewer & Management Modal §7) — the enlarged presentation
// target (~180–240px on non-narrow screens, scaling down on narrow ones
// rather than a fixed value that could overflow a small viewport).
const LARGE_AVATAR_CLASS = 'w-40 h-40 sm:w-52 sm:h-52 text-4xl'

type ManagementStage = 'view' | 'confirmUpload' | 'confirmDelete'

export function AvatarUploadSection() {
  const { user: authUser, setUser } = useAuth()
  const { hasError: providerHasError, retry: retryProviderFetch } = useAvatar()
  const { notifySuccess, notifyError } = useActionNotify()

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  // Y3.1B §33 — a temporary preview URL that belongs to THIS component, not
  // AvatarProvider. Revoked on every path that ends its life: a new
  // selection, a successful upload, a cancelled/failed selection, a modal
  // dismissal, or unmount — never persisted anywhere.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [clientError, setClientError] = useState('')
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'deleting'>('idle')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // PRE-Y8 (Avatar Viewer & Management Modal) — `managementOpen` is whether
  // the single avatar-management Dialog is mounted at all; `stage` picks
  // which of its three content states it shows while mounted. Local
  // validation (type/size, in handleFileChange below) still runs BEFORE
  // `stage` can ever become 'confirmUpload' — same as before, this only
  // ever gates the actual mutation, never the native file picker or the
  // client-side checks (§11).
  const [managementOpen, setManagementOpen] = useState(false)
  const [stage, setStage] = useState<ManagementStage>('view')

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }
  }, [previewUrl])

  const hasAvatar = !!authUser?.avatar
  const busy = phase !== 'idle'

  const clearPreview = () => {
    setPreviewUrl(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setSelectedFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handlePick = () => fileInputRef.current?.click()

  // Client-side pre-check only (type/size) — a fast, friendly rejection.
  // Never authoritative: the backend re-validates everything from the
  // actual decoded bytes regardless of what this check allowed through
  // (Y3.1B §10). A VALID selection moves the modal straight to the
  // 'confirmUpload' stage (no separate button click needed, preserving
  // FIX1's auto-open contract); an INVALID selection shows the existing
  // client-side error and stays on 'view' — no stage change, no dialog.
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setClientError('Formato no compatible. Usa JPEG, PNG o WebP.')
      clearPreview()
      return
    }
    if (file.size > MAX_BYTES) {
      setClientError('La imagen supera el tamaño máximo permitido (5 MB).')
      clearPreview()
      return
    }

    setClientError('')
    setPreviewUrl(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
    setSelectedFile(file)
    setStage('confirmUpload')
  }

  // Y3.1B §34 — the full successful-upload flow: POST, then
  // setUser({...user, avatar: response.avatar}) — AvatarProvider picks up
  // the new `avatar.updatedAt` on its own (it watches `user` via
  // useAuth()), fetches once, and every consumer (Sidebar/Topbar/this
  // component's own UserAvatar) updates together. No reload, no manual
  // provider refresh call needed here.
  //
  // PRE-Y8 (§17) — on success, returns to the 'view' stage of the SAME
  // still-open modal (rather than closing it) so the person immediately
  // sees the new large avatar and can still reach Delete.
  const handleConfirmUpload = async () => {
    if (!selectedFile || !authUser) return
    setPhase('uploading')
    try {
      const { avatar } = await avatarService.uploadMyAvatar(selectedFile)
      setUser({ ...authUser, avatar })
      notifySuccess('Foto de perfil actualizada.')
      clearPreview()
      setStage('view')
    } catch (err) {
      // Y3.1B §35 — a failed upload changes NOTHING about the existing
      // authoritative avatar; the temporary preview/selection is kept so
      // the person can see what they picked and retry. FIX1 §3's
      // stay-open-on-failure behavior is preserved: the modal remains at
      // 'confirmUpload' so its own Confirm button can be used to retry
      // directly — Z3 only changed WHERE the failure is reported (global
      // action notification instead of an inline banner here), never this
      // retry-in-place behavior. Only Cancel or a successful upload moves
      // off this stage from here on.
      const code = isAxiosError(err) ? (err.response?.data?.code as string | undefined) : undefined
      notifyError((code && ERROR_MESSAGES[code]) || DEFAULT_ERROR_MESSAGE)
    } finally {
      setPhase('idle')
    }
  }

  const handleCancelUpload = () => {
    if (phase === 'uploading') return
    clearPreview()
    setStage('view')
  }

  // Y3.1B §36 — DELETE, then setUser({...user, avatar: null}).
  // AvatarProvider reacts on its own (revokes its object URL, clears to
  // null) and every consumer falls back to initials immediately — no GET
  // is issued after a delete.
  //
  // PRE-Y8 (§18) — on success, returns to 'view' (same modal stays open):
  // the enlarged display switches to the fallback avatar and the Delete
  // action disappears there (hasAvatar becomes false), Select remains.
  // On failure, unlike the old code (which closed the dialog and set an
  // error nothing on the page ever rendered), this stays on
  // 'confirmDelete' with the error shown right there — the same
  // retry-in-place pattern §17/FIX1 already established for uploads, now
  // applied consistently to delete since both mutations share this one
  // modal. This is a direct, minimal alignment of the exact lines being
  // rewritten for this block, not a fix to unrelated code.
  const handleDelete = async () => {
    if (!authUser) return
    setPhase('deleting')
    try {
      const { avatar } = await avatarService.deleteMyAvatar()
      setUser({ ...authUser, avatar })
      // Z3 — same exact banner text the old shared `showSaved` state used
      // for both upload and delete success, now via the global toast.
      notifySuccess('Foto de perfil actualizada.')
      setStage('view')
    } catch {
      notifyError(DEFAULT_DELETE_ERROR_MESSAGE)
    } finally {
      setPhase('idle')
    }
  }

  const handleCancelDelete = () => {
    if (phase === 'deleting') return
    setStage('view')
  }

  // §5/§29 — clicking the avatar (real image or fallback initials, either
  // way) opens the modal fresh, always on 'view'. Not destructive, no
  // confirmation needed to open it.
  const handleOpenManagement = () => {
    setStage('view')
    setClientError('')
    setManagementOpen(true)
  }

  // §19/§20/§32-A — every normal dismissal path (×, Escape, overlay click)
  // funnels through Dialog's onOpenChange, which Dialog.tsx itself already
  // refuses to call while `preventClose` (tied to `busy` below) is true —
  // so this only ever runs while idle. Closing while idle always leaves a
  // clean slate: no dangling object URL, no stale pending file, no leftover
  // stage other than 'view' the next time it opens.
  const handleManagementOpenChange = (open: boolean) => {
    if (!open) {
      clearPreview()
      setClientError('')
      setStage('view')
    }
    setManagementOpen(open)
  }

  if (!authUser) return null

  const modalTitle =
    stage === 'confirmUpload'
      ? (hasAvatar ? 'Cambiar imagen de perfil' : 'Confirmar imagen de perfil')
      : stage === 'confirmDelete'
        ? 'Eliminar imagen de perfil'
        : 'Imagen de perfil'

  const modalDescription =
    stage === 'confirmUpload'
      ? (hasAvatar
          ? '¿Deseas reemplazar tu imagen de perfil actual por la imagen seleccionada?'
          : '¿Deseas usar la imagen seleccionada como tu imagen de perfil?')
      : stage === 'confirmDelete'
        ? '¿Deseas eliminar tu imagen de perfil?'
        : undefined

  return (
    <>
      <SettingsSection title="Perfil">
        <div className="ui-content-stack">
          {providerHasError && (
            <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-lg px-3 py-2.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-300 flex-1">No se pudo cargar tu foto de perfil actual.</p>
              <button
                type="button"
                onClick={retryProviderFetch}
                className="text-xs font-medium text-amber-700 dark:text-amber-300 hover:underline flex items-center gap-1 flex-shrink-0"
              >
                <RefreshCw className="w-3 h-3" /> Reintentar
              </button>
            </div>
          )}

          <div className="flex items-center ui-element-gap flex-wrap">
            <button
              type="button"
              onClick={handleOpenManagement}
              aria-label="Ver y administrar imagen de perfil"
              className="group relative flex-shrink-0 rounded-full cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
            >
              <UserAvatar firstName={authUser.firstName} lastName={authUser.lastName} size="lg" />
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-full flex items-center justify-center bg-black/0 group-hover:bg-black/30 group-focus-visible:bg-black/30 transition-colors"
              >
                <Camera className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity" />
              </span>
            </button>

            <div className="min-w-0 flex-1">
              <p className="ui-text-meta text-muted-foreground truncate">
                {authUser.medico?.especialidad || ''}
              </p>
              <p className="text-sm font-semibold text-foreground truncate">
                Dr. {fullName(authUser.firstName, authUser.lastName)}
              </p>
              <p className="ui-text-meta text-muted-foreground truncate">
                {authUser.email || ''}
              </p>
              <p className="ui-text-meta text-muted-foreground truncate">
                {authUser.medico?.phone ? formatInternationalDisplay(authUser.medico.phone) : ''}
              </p>
            </div>
          </div>
        </div>
      </SettingsSection>

      {/* PRE-Y8 (Avatar Viewer & Management Modal) — the ONE management
          Dialog, staged by content rather than stacked as separate Dialog
          instances (§12, see file-header comment). `preventClose` is tied
          to `busy` (either mutation in flight) so the whole modal can't be
          unsafely dismissed mid-request, covering both the upload and
          delete cases with the single flag. */}
      <Dialog
        open={managementOpen}
        onOpenChange={handleManagementOpenChange}
        title={modalTitle}
        description={modalDescription}
        preventClose={busy}
      >
        {stage === 'view' && (
          <div className="ui-content-stack">
            {clientError && (
              <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-lg px-3 py-2.5">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                <p className="text-xs text-red-700 dark:text-red-300">{clientError}</p>
              </div>
            )}

            {/* §7/§8 — the enlarged representation: same UserAvatar
                component (no second fallback algorithm), just a much
                larger footprint via `className` (tailwind-merge in `cn`
                lets this override the base 'lg' size classes cleanly —
                UserAvatar itself is untouched, §35). A real, descriptive
                alt here since this is primary modal content, not a
                decorative trigger. */}
            <div className="flex justify-center py-2">
              <UserAvatar
                firstName={authUser.firstName}
                lastName={authUser.lastName}
                size="lg"
                alt="Foto de perfil actual"
                className={LARGE_AVATAR_CLASS}
              />
            </div>

            {/* §9/§11 — Change/Select below the preview; Delete only when
                an avatar actually exists (§9's "do not show a disabled
                Delete button for a nonexistent image"). */}
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={handlePick}
                disabled={busy}
                className="flex items-center justify-center gap-2 bg-primary text-white px-3.5 ui-compact-control-density rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Upload className="w-4 h-4" />
                {hasAvatar ? 'Cambiar imagen' : 'Subir imagen'}
              </button>
              {hasAvatar && (
                <button
                  type="button"
                  onClick={() => setStage('confirmDelete')}
                  disabled={busy}
                  className="flex items-center justify-center gap-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 px-3.5 ui-compact-control-density rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Eliminar imagen
                </button>
              )}
            </div>
            <p className="ui-text-meta text-muted-foreground text-center">
              JPEG, PNG o WebP · Máximo 5 MB.
            </p>
          </div>
        )}

        {stage === 'confirmUpload' && (
          <div>
            {previewUrl && (
              <div className="flex justify-center mb-3">
                <img
                  src={previewUrl}
                  alt="Vista previa de la nueva foto de perfil"
                  className={`${LARGE_AVATAR_CLASS} rounded-full object-cover`}
                />
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={handleCancelUpload}
                disabled={phase === 'uploading'}
                className="px-3 ui-secondary-control-density text-sm font-medium rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmUpload}
                disabled={phase === 'uploading'}
                className="flex items-center gap-2 px-3 ui-secondary-control-density text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {phase === 'uploading' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <Save className="w-4 h-4" />
                {hasAvatar ? 'Cambiar imagen' : 'Usar imagen'}
              </button>
            </div>
          </div>
        )}

        {stage === 'confirmDelete' && (
          <div>
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={handleCancelDelete}
                disabled={phase === 'deleting'}
                className="px-3 ui-secondary-control-density text-sm font-medium rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={phase === 'deleting'}
                className="flex items-center gap-2 px-3 ui-secondary-control-density text-sm font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {phase === 'deleting' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <Trash2 className="w-4 h-4" />
                Eliminar imagen
              </button>
            </div>
          </div>
        )}
      </Dialog>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
        className="sr-only"
        aria-label="Seleccionar imagen de perfil"
      />
    </>
  )
}
