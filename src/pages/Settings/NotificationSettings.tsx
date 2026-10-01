import { useState, useEffect, useRef } from 'react'
import { isAxiosError } from 'axios'
import { Loader2, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SettingsSection } from '@/components/settings/SettingsSection'
import { useActionNotify } from '@/context/ToastContext'
import { notificationPreferencesService } from '@/services/notificationPreferencesService'
import type { NotificationPreferences } from '@/types'

// Bloque Y4 — real Notifications implementation, replacing the Y2 structural
// placeholder. Exactly three preferences (highRiskRealtime/
// moderateRiskRealtime/anomalyRealtime), each gating ONLY realtime `new_alert`
// delivery — never Alert persistence, patient history, or Prediction
// execution (enforced backend-side, see alerts/realtimeNotification.ts). No
// email/push/SMS/sound/weekly-summary rows — those channels don't exist.
//
// PRE-Y8 (Settings Interaction Policy Refinement) — this section moved from
// an explicit draft/dirty/Save/Discard model (Y4's original interaction
// model, mirrored from Profile) to an IMMEDIATE-PREFERENCE model per the new
// product policy: each toggle persists the instant it's flipped. There is no
// more local "draft" distinct from the confirmed server value — `prefs` IS
// the current confirmed value, optimistically updated the moment the user
// flips a switch. No confirmation dialog, no unsaved-change guard, no
// beforeunload handler — none of that applies to this category of action
// anymore.

type Category = keyof NotificationPreferences

const CATEGORIES: { key: Category; title: string; }[] = [
  {
    key: 'highRiskRealtime',
    title: 'Riesgo alto',
  },
  {
    key: 'moderateRiskRealtime',
    title: 'Riesgo moderado',
  },
  {
    key: 'anomalyRealtime',
    title: 'Anomalías',
  },
]

// Z5 — the Configurable Information Alert toggles, kept as a SEPARATE
// array (and rendered in their own SettingsSection below) rather than
// appended to CATEGORIES above. These gate a different, unrelated family of
// events (patient/record lifecycle notices, never clinical risk), so mixing
// them into one visual list under "Alertas" would blur that distinction for
// the doctor. They still share every mechanism CATEGORIES already uses —
// `Category` covers every NotificationPreferences key, and
// handleToggle/pendingKey/mutationInFlightRef below are already fully
// generic over `Category`, so no new state or persistence logic is needed
// here — only a second static list and a second section to render it in.
//
// Z6-R2 §5/§18 — the doctor-profile realtime toggle REMOVED from this list
// entirely (not merely disabled by default): the one event it gated no
// longer exists as a product decision. Exactly three information toggles
// remain.
const INFO_CATEGORIES: { key: Category; title: string; }[] = [
  {
    key: 'patientCreatedRealtime',
    title: 'Paciente creado',
  },
  {
    key: 'patientUpdatedRealtime',
    title: 'Información del paciente actualizada',
  },
  {
    key: 'healthRecordCreatedRealtime',
    title: 'Registro clínico creado',
  },
]

// Minimal accessible switch — real checkbox semantics (native `checked`,
// keyboard-operable, exposed to assistive tech) rather than a clickable div,
// visually styled as a toggle. No existing Toggle/Switch component exists
// in this codebase to reuse (confirmed by inspection), and three identical
// uses in this one file don't justify a new shared component file.
function PreferenceToggle({
  id, label, checked, onChange, disabled,
}: {
  id: string
  label: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <label htmlFor={id} className="relative inline-flex items-center cursor-pointer">
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        aria-label={label}
        className="peer sr-only"
      />
      {/* Y6.3B §34, updated Y6.4B — Class D: hardcoded pixel geometry, kept
          out of React/context entirely — pure CSS via the `--toggle-*`
          custom properties defined once in index.css (formerly one of
          several per-`[data-interface]` variants; now the single permanent
          track/thumb/travel geometry). Boolean state, keyboard behavior,
          click handler and transition semantics are all unchanged. */}
      <div
        aria-hidden="true"
        className={cn(
          'rounded-full transition-colors',
          'peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 peer-focus-visible:ring-offset-2',
          checked ? 'bg-primary' : 'bg-border',
          disabled && 'opacity-50',
        )}
        style={{ width: 'var(--toggle-track-w)', height: 'var(--toggle-track-h)' }}
      >
        <div
          className="rounded-full bg-white shadow-sm transition-transform"
          style={{
            width: 'var(--toggle-thumb)',
            height: 'var(--toggle-thumb)',
            marginTop: 'var(--toggle-inset)',
            transform: `translateX(${checked ? 'var(--toggle-travel)' : 'var(--toggle-inset)'})`,
          }}
        />
      </div>
    </label>
  )
}

export default function NotificationSettings() {
  const { notifyError } = useActionNotify()

  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [loadError, setLoadError] = useState('')

  // The single confirmed-value state. There is no separate "draft" anymore —
  // every toggle both updates this optimistically AND fires the persist
  // request in the same action (§5/§6 of this block).
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null)

  // FIX2 — two DELIBERATELY SEPARATE mechanisms, not one doing double duty:
  //
  //   `pendingKey` (React state) is UI-ONLY — which row shows the spinner,
  //   and (via `pendingKey !== null`) whether the toggles render disabled.
  //   It is never read as the concurrency guard anymore.
  //
  //   `mutationInFlightRef` (a plain ref, below) is the actual concurrency
  //   mutex. A ref mutation (`.current = true`) takes effect the instant
  //   the line runs — unlike `setPendingKey`, which only schedules a
  //   state update for a future render and is not guaranteed to have been
  //   applied yet by the time another synchronous call into this handler
  //   could occur. FIX1's report claimed the state alone was a structural
  //   guarantee; that claim didn't hold, since React state's read value
  //   inside a closure is a snapshot from render time, not a live variable
  //   `handleToggle` mutates and immediately re-reads. The ref has no such
  //   gap, since `.current` is read and written as an ordinary synchronous
  //   object property.
  const [pendingKey, setPendingKey] = useState<Category | null>(null)
  const mutationInFlightRef = useRef(false)

  const load = () => {
    let cancelled = false
    setLoadState('loading')
    setLoadError('')
    notificationPreferencesService.getMyNotificationPreferences()
      .then(p => {
        if (cancelled) return
        setPrefs(p)
        setLoadState('ready')
      })
      .catch(() => {
        if (cancelled) return
        setLoadError('No se pudieron cargar tus preferencias de alertas.')
        setLoadState('error')
      })
    return () => { cancelled = true }
  }

  // ── Server-authoritative initial load ──────────────────────────────────
  // No invented toggle values while loading or on error — the controls only
  // render once the real GET response is in hand.
  useEffect(load, [])

  // FIX2 §3/§9 — the ref is checked and acquired FIRST, synchronously,
  // before any state setter and before the `await`. Walking through why
  // this is airtight where the plain-state version wasn't:
  //
  //   Initial: mutationInFlightRef.current === false.
  //   First call: reads false → immediately writes true → proceeds.
  //   A second call arriving before the next render (e.g. two toggles
  //     fired from the same synchronous event-handling pass, or a
  //     programmatic double-invoke): reads `.current`, which is ALREADY
  //     true (the first call's write already happened, synchronously,
  //     with no render in between needed) → returns immediately.
  //   A second call arriving after the next render: the control it would
  //     have come from is rendered `disabled` (pendingKey !== null), so it
  //     can't normally fire — but even if invoked directly, the ref check
  //     still rejects it, independent of whatever the UI happened to show.
  //   Only the `finally` block below ever sets `.current = false` again —
  //     after the request has fully settled, success or failure.
  //
  // This is the "structural proof" §9 asks for: it holds regardless of
  // React's batching/scheduling, because nothing here depends on a render
  // having occurred.
  const handleToggle = async (key: Category, next: boolean) => {
    if (!prefs || mutationInFlightRef.current) return
    mutationInFlightRef.current = true
    const previousSnapshot = prefs

    setPrefs(p => (p ? { ...p, [key]: next } : p))
    // `pendingKey` is set AFTER acquiring the ref lock — it is derived UI
    // state describing what the (already-acquired) lock looks like, never
    // the thing that decides whether the lock was acquired.
    setPendingKey(key)

    try {
      const updated = await notificationPreferencesService.updateMyNotificationPreferences({ [key]: next })
      setPrefs(updated)
    } catch (err) {
      setPrefs(previousSnapshot)
      // Z3 — mutation-failure feedback now goes through the global
      // action-notification toast instead of an inline page banner.
      if (isAxiosError(err) && err.response?.data?.error) {
        notifyError(err.response.data.error as string)
      } else {
        notifyError('No se pudo guardar el cambio. Intenta de nuevo.')
      }
    } finally {
      // §4 — released unconditionally, success or failure, so the section
      // can never end up permanently locked after an exception.
      mutationInFlightRef.current = false
      setPendingKey(null)
    }
  }

  if (loadState === 'loading') {
    return (
      <SettingsSection title="Alertas">
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Cargando preferencias...
        </div>
      </SettingsSection>
    )
  }

  if (loadState === 'error' || !prefs) {
    return (
      <SettingsSection title="Alertas">
        <div className="flex items-center justify-between gap-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-lg px-3 py-2.5">
          <p className="text-xs text-red-700 dark:text-red-300">{loadError}</p>
          <button
            type="button"
            onClick={load}
            className="flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-300 flex-shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reintentar
          </button>
        </div>
      </SettingsSection>
    )
  }

  return (
    <>
      <SettingsSection title="Alertas">
        <div className="ui-content-stack">
          <p className="text-sm text-muted-foreground">
            Controla qué alertas clínicas quieres recibir.
          </p>

          {/* Z3 — the mutation-failure banner previously here now shows as a
              global action notification instead (see handleToggle's catch). */}

          <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
            {CATEGORIES.map(cat => (
              <div key={cat.key} className="flex items-center justify-between ui-element-gap px-4 ui-row-density">
                <div className="min-w-0">
                  <label htmlFor={`pref-${cat.key}`} className="text-sm font-medium text-foreground block">
                    {cat.title}
                  </label>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {pendingKey === cat.key && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" aria-hidden="true" />}
                  {/* FIX1 §8 — ALL controls across BOTH sections disable
                      while ANY one is pending (`pendingKey !== null`), not
                      just the row being changed — this is the visual half
                      of the global lock, and it now spans the Información
                      section below too since they share the same
                      mutationInFlightRef/pendingKey state. */}
                  <PreferenceToggle
                    id={`pref-${cat.key}`}
                    label={cat.title}
                    checked={prefs[cat.key]}
                    onChange={next => handleToggle(cat.key, next)}
                    disabled={pendingKey !== null}
                  />
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Las alertas clínicas seguirán registrándose en el historial de CardioSense.
          </p>
        </div>
      </SettingsSection>

      {/* Z5 — a second, clearly-separated section for the four Configurable
          Information Alert toggles. These gate ONLY the realtime `new_alert`
          popup for their event (never Alert persistence/history — disabling
          one still leaves that Alert queryable in "Alertas" > history, it
          just arrives without the popup). Same immediate-persist mechanism,
          same Z3-toast failure feedback, same disabled-while-pending
          lockstep as the clinical section above — reusing handleToggle/
          PreferenceToggle/pendingKey as-is. */}
      <SettingsSection title="Información" className="mt-6">
        <div className="ui-content-stack">
          <p className="text-sm text-muted-foreground">
            Controla qué avisos informativos quieres recibir.
          </p>

          <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
            {INFO_CATEGORIES.map(cat => (
              <div key={cat.key} className="flex items-center justify-between ui-element-gap px-4 ui-row-density">
                <div className="min-w-0">
                  <label htmlFor={`pref-${cat.key}`} className="text-sm font-medium text-foreground block">
                    {cat.title}
                  </label>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {pendingKey === cat.key && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" aria-hidden="true" />}
                  <PreferenceToggle
                    id={`pref-${cat.key}`}
                    label={cat.title}
                    checked={prefs[cat.key]}
                    onChange={next => handleToggle(cat.key, next)}
                    disabled={pendingKey !== null}
                  />
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Los avisos seguirán registrándose en el historial de CardioSense.
          </p>
        </div>
      </SettingsSection>
    </>
  )
}
