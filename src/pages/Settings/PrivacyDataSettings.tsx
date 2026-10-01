import { useState } from 'react'
import { Loader2, CheckCircle2, AlertTriangle, Download, RotateCcw } from 'lucide-react'
import { SettingsSection } from '@/components/settings/SettingsSection'
import { privacyService } from '@/services/privacyService'

// Bloque Y7B — real Privacy & Data implementation, replacing the Y2
// structural placeholder. Scope is exactly the Y7 binding contract
// (Y7A / Y7A-FIX1 diagnosis, reviewed and frozen): a single authenticated
// export of the doctor's own account/profile/preference data as a JSON
// file. Deliberately, permanently NOT in scope, per that same contract:
// no account deletion, no account deactivation, no clinical-data export,
// no simulated/fake controls of any kind — their absence from this file is
// intentional and is not called out anywhere in the UI itself.
//
// This page does not duplicate anything another Settings page already
// owns: email is read-only in ProfileSettings, password/sessions live in
// SecuritySettings, avatar upload/replace/delete lives in ProfileSettings,
// and notification/appearance toggles live in their own pages — this page
// only ever reads a combined snapshot of that same data for download.

type DownloadState = 'idle' | 'loading' | 'success' | 'error'

function clientFilename(): string {
  // Y7A-FIX1 §A4/§19 — the frontend computes its own safe filename rather
  // than reading Content-Disposition (current CORS config does not expose
  // that header to JS, and this block does not touch CORS to add it). No
  // PII: a fixed prefix plus the client's own current UTC date.
  const date = new Date().toISOString().slice(0, 10)
  return `cardiosense-datos-cuenta-${date}.json`
}

export default function PrivacyDataSettings() {
  const [state, setState] = useState<DownloadState>('idle')

  const handleDownload = async () => {
    setState('loading')
    let url: string | null = null
    try {
      const blob = await privacyService.downloadMyDataExport()
      url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = clientFilename()
      document.body.appendChild(a)
      a.click()
      a.remove()
      setState('success')
    } catch {
      // Y7B §22 — `responseType: 'blob'` means an error response's body may
      // itself be a Blob, so this deliberately never tries to parse it for
      // a server-provided message. A generic message is used instead; 401
      // handling stays entirely status-driven in the existing global Axios
      // interceptor (api.ts), unchanged by this page.
      setState('error')
    } finally {
      // Revoke after the browser has had a chance to queue the download,
      // not synchronously in the same tick (Y7A-FIX1 §A5) — and only if a
      // URL was actually created.
      if (url) {
        const revokeUrl = url
        setTimeout(() => URL.revokeObjectURL(revokeUrl), 0)
      }
    }
  }

  const loading = state === 'loading'

  return (
    <SettingsSection title="Privacidad y datos">
      <div className="ui-content-stack">
        <p className="text-sm text-muted-foreground">
          Puedes descargar una copia de los datos de tu cuenta en CardioSense.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium text-foreground mb-1.5">Se incluye</h3>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>Tu información de cuenta (nombre, correo electrónico, rol)</li>
              <li>Tu perfil profesional (cédula, especialidad, hospital), si aplica</li>
              <li>Metadatos de tu imagen de perfil (no la imagen en sí)</li>
              <li>Tus preferencias de alertas y apariencia</li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground mb-1.5">No incluye</h3>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>Información clínica de pacientes</li>
              <li>Historiales médicos, predicciones o alertas</li>
              <li>Contraseñas, tokens de sesión ni otros datos de seguridad</li>
            </ul>
          </div>
        </div>

        {state === 'success' && (
          <div className="flex items-center gap-2 bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800/60 rounded-lg px-3 py-2.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 flex-shrink-0" />
            <p className="text-xs text-teal-700 dark:text-teal-300">La descarga se inició correctamente.</p>
          </div>
        )}

        {state === 'error' && (
          <div className="flex items-center justify-between gap-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-lg px-3 py-2.5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 flex-shrink-0" />
              <p className="text-xs text-red-700 dark:text-red-300">
                No se pudo descargar la información de tu cuenta. Inténtalo de nuevo.
              </p>
            </div>
            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-300 flex-shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reintentar
            </button>
          </div>
        )}

        <div className="pt-1">
          <button
            type="button"
            onClick={handleDownload}
            disabled={loading}
            aria-busy={loading}
            className="flex items-center justify-center gap-2 bg-primary text-white px-4 rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm ui-control-density"
          >
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Download className="w-4 h-4" />}
            {loading ? 'Preparando descarga...' : 'Descargar mis datos'}
          </button>
        </div>
      </div>
    </SettingsSection>
  )
}
