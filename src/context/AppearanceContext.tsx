import React, {
  createContext, useContext, useState, useCallback, useEffect, useRef,
} from 'react'
import { useAuth } from '@/context/AuthContext'
import { appearanceService } from '@/services/appearanceService'
import { isInterfaceSizePreference } from '@/lib/interfaceScale'
import type { ThemePreference, InterfaceSizePreference } from '@/types'

// Y6.1 — Appearance infrastructure (theme only).
//
// Y6.4B — the interface-density/visibility preset axis introduced in Y6.3B
// has been deimplemented (product decision: COMFORTABLE's values are now
// simply the CardioSense default design, not a user choice — see Y6.4A/
// Y6.4B). This file returns to its Y6.1 shape: ONE appearance axis (theme),
// ONE backend-authoritative GET/PATCH lifecycle. The "Appearance" naming
// (not "Theme") is kept deliberately (Y6.4A §8/§19 of this block's own
// spec) — it is still the correct product/domain name and leaves room for a
// future appearance axis (e.g. Text Size) without another rename; today it
// owns exactly one.
//
//  - `theme`/`resolvedTheme`: the stored CHOICE and what actually paints
//    ('system' resolves live against the OS/browser color-scheme).
//
// PRE-Y8 (Interface Size Preference) — that "future appearance axis" has
// now arrived: `interfaceSize`. It is a SEPARATE stored field on the same
// AppearancePreference row, with its OWN cache key
// (`cardiosense_interface_size` — never reusing the removed Y6.3B/Y6.4B
// `cardiosense_interface_preset` key), its OWN save path
// (`saveInterfaceSize`, independent from `saveTheme`), and its OWN
// generation-guarded race protection — so a Theme save and an Interface
// Size save in flight at the same time can never clobber each other's
// state, and a superseded response for one field can never roll back the
// other. This is explicitly NOT the removed Density/InterfacePreset system
// (which scaled many individual per-component tokens) — it is a single
// global CSS `zoom` factor applied at the document root.
//
// FIX1 — this Provider does NOT compute or expose a numeric scale value.
// It applies `interfaceSize` to the DOM the same way it applies
// `resolvedTheme` (a semantic value onto an attribute — see the
// `data-ui-size` effect below) and lets index.css's own
// `:root[data-ui-size="..."]` rules be the ONE place that turns that
// semantic value into an actual number (1 / 1.10 / 1.25). Any consumer
// that genuinely needs the numeric factor at runtime (today, only
// Sidebar.tsx's CollapsedTooltip) reads it back from the resolved CSS
// custom property itself (`getComputedStyle(...).getPropertyValue(...)`),
// not from this context — see that file's own comment.
//
// Persistence model, unchanged from Y6.1: `cardiosense_theme` is read
// SYNCHRONOUSLY, before React ever mounts, by the small inline script in
// index.html (FOUC prevention) — that script never talks to the backend and
// is never treated as authoritative here. `cardiosense_interface_size` is
// read the same way, by the same script, for the same reason (avoid a
// flash of un-scaled UI on a returning device). Once an authenticated user
// is known, this Provider fetches GET /users/me/appearance ONCE and
// silently reconciles both cached values to server truth together (one
// response carries both fields — there is no race between them at fetch
// time, only at save time, which per-field generation guards handle below).
export type ResolvedTheme = 'light' | 'dark'

// Kept in sync by hand with the identical literal in index.html's
// pre-hydration script (that script cannot `import` this constant — it runs
// before any module graph exists). Changing this string requires changing
// that literal too.
const THEME_STORAGE_KEY = 'cardiosense_theme'

// PRE-Y8 — same hand-sync requirement as THEME_STORAGE_KEY above: index.html's
// bootstrap script keeps its own literal copy of this key, since it runs
// before any module graph exists and cannot import either.
const INTERFACE_SIZE_STORAGE_KEY = 'cardiosense_interface_size'

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

function readCachedPreference(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (isThemePreference(raw)) return raw
  } catch {
    // localStorage can throw (private mode, disabled, quota) — fall back to
    // the logical default rather than letting theme resolution ever throw.
  }
  return 'system'
}

function writeCachedPreference(theme: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Best-effort only — a failed cache write must never break saving or
    // reconciling the real (in-memory/server) preference.
  }
}

// PRE-Y8 — same shape/rationale as readCachedPreference/writeCachedPreference
// above, for the new independent field.
//
// Z4 — the no-valid-cache fallback is 'medium', not 'original'. This ONLY
// changes what a user who has NEVER explicitly chosen a size sees (no cache
// key present, or a malformed/unsupported cached value) — any valid cached
// value (including an explicitly-chosen 'original') is still returned
// verbatim above and is never touched by this fallback. Kept in sync by
// hand with index.html's pre-hydration bootstrap script's own copy of this
// same fallback (see that script's own Z4 comment) — same hand-sync
// requirement THEME_STORAGE_KEY/INTERFACE_SIZE_STORAGE_KEY already document
// for the storage keys themselves.
function readCachedInterfaceSize(): InterfaceSizePreference {
  try {
    const raw = window.localStorage.getItem(INTERFACE_SIZE_STORAGE_KEY)
    if (isInterfaceSizePreference(raw)) return raw
  } catch {
    // Same failure mode as theme's cache read — never let this throw.
  }
  return 'medium'
}

function writeCachedInterfaceSize(size: InterfaceSizePreference): void {
  try {
    window.localStorage.setItem(INTERFACE_SIZE_STORAGE_KEY, size)
  } catch {
    // Best-effort only, same as writeCachedPreference.
  }
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

function resolve(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
}

interface AppearanceContextValue {
  preference: ThemePreference
  resolvedTheme: ResolvedTheme
  // PRE-Y8 (Interface Size Preference) — semantic value only; FIX1 removed
  // the numeric `interfaceScale` this context used to also expose (see
  // this file's own top-of-file comment on why).
  interfaceSize: InterfaceSizePreference
  // True only while the AUTHENTICATED, server-authoritative appearance is
  // being fetched/reconciled — never true for the synchronous cache read
  // that seeds initial state, so login/register pages never show a
  // "loading appearance" state.
  isLoading: boolean
  error: string
  saveTheme: (next: ThemePreference) => Promise<void>
  saveInterfaceSize: (next: InterfaceSizePreference) => Promise<void>
  reloadAppearance: () => void
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null)

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading: authIsLoading } = useAuth()

  // Seeded synchronously from the cache — never from a hardcoded default
  // while a cached value exists — so there is no visible state change
  // between the pre-hydration script's guess and this Provider's first
  // render for a returning device.
  const [preference, setPreference] = useState<ThemePreference>(readCachedPreference)
  const [interfaceSize, setInterfaceSize] = useState<InterfaceSizePreference>(readCachedInterfaceSize)
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // Account-race guard: identifies which authenticated user id the LAST
  // fetch was issued for. A response is only applied if this still matches
  // the id it was fetched for at the moment the response arrives — so a
  // fast logout/login (or login as a different user) that happens while an
  // earlier GET is still in flight can never let that stale response
  // clobber the newly-adopted user's theme/interfaceSize/cache. Also
  // doubles as the "have we already fetched for this identity" guard.
  const fetchedForUserIdRef = useRef<string | null>(null)

  // PRE-Y8 (Settings Interaction Policy Refinement) — mirrors `preference`
  // so `saveTheme` can read the "previous confirmed value" and issue a
  // rollback synchronously without a stale-closure read (this callback is
  // `useCallback`-memoized with an empty dep array, same as before).
  const preferenceRef = useRef<ThemePreference>(preference)
  useEffect(() => { preferenceRef.current = preference }, [preference])

  // PRE-Y8 (Interface Size Preference) — identical mirror-ref pattern as
  // preferenceRef above, for the new independent field.
  const interfaceSizeRef = useRef<InterfaceSizePreference>(interfaceSize)
  useEffect(() => { interfaceSizeRef.current = interfaceSize }, [interfaceSize])

  // PRE-Y8 — save-request sequencing ("latest request wins", §12 of the
  // original Settings Interaction Policy Refinement block): every
  // saveTheme()/saveInterfaceSize() call gets the next generation number
  // FOR ITS OWN FIELD. A response (success OR failure) is only applied to
  // state if its generation is still the most recent one issued for THAT
  // field — a superseded response is silently discarded rather than rolling
  // back over, or double-applying on top of, whatever the newer call has
  // already done. Two SEPARATE counters (PRE-Y8, Interface Size Preference
  // §"field-scoped race protection") are what make a concurrent Theme
  // change and Interface Size change fully independent: each field's
  // generation counter only ever advances on its OWN saves, so a save to
  // one field can never supersede — or be superseded by — a save to the
  // other.
  const themeSaveGenerationRef = useRef(0)
  const interfaceSizeSaveGenerationRef = useRef(0)

  const fetchForUser = useCallback((userId: string) => {
    fetchedForUserIdRef.current = userId
    setIsLoading(true)
    setError('')
    appearanceService.getMyAppearance()
      .then(({ theme, interfaceSize: fetchedInterfaceSize }) => {
        if (fetchedForUserIdRef.current !== userId) return // superseded — discard
        setPreference(theme)
        writeCachedPreference(theme)
        setInterfaceSize(fetchedInterfaceSize)
        writeCachedInterfaceSize(fetchedInterfaceSize)
        setIsLoading(false)
      })
      .catch(() => {
        if (fetchedForUserIdRef.current !== userId) return
        setError('No se pudo cargar tu preferencia de apariencia guardada. Se usará la última disponible en este dispositivo.')
        setIsLoading(false)
        // `preference`/`interfaceSize` are deliberately left untouched here
        // — the cache-derived values already in state stay in effect
        // rather than being silently replaced by a hardcoded default on
        // error.
      })
  }, [])

  // ── Fetch trigger: authenticated-identity changes only ──────────────────
  // Waits for AuthContext's own bootstrap to settle (authIsLoading), then
  // fetches once per distinct authenticated user id — never on every
  // render, never on a token rotation (which never changes user.id), and
  // never while logged out (there is nothing authoritative to fetch; the
  // cached/local value is used as-is).
  useEffect(() => {
    if (authIsLoading) return

    if (!isAuthenticated || !user) {
      // Logged out (or never logged in this session) — reset the guard so
      // a subsequent login always re-fetches for the newly authenticated
      // identity, and stop any stale loading indicator. The cache itself is
      // deliberately NOT cleared here (Y6.1 §25: the cache survives logout;
      // PRE-Y8 — the interface-size cache survives logout for the exact
      // same reason, symmetrically).
      fetchedForUserIdRef.current = null
      setIsLoading(false)
      return
    }

    if (fetchedForUserIdRef.current === user.id) return // already have this identity's value
    fetchForUser(user.id)
  }, [authIsLoading, isAuthenticated, user, fetchForUser])

  // ── 'system' resolution: live-tracks the OS/browser color-scheme ────────
  useEffect(() => {
    if (preference !== 'system') return

    let mql: MediaQueryList
    try {
      mql = window.matchMedia('(prefers-color-scheme: dark)')
    } catch {
      return
    }

    // Resync immediately — the value may have changed while no listener was
    // attached (e.g. while `preference` was 'light'/'dark').
    setSystemDark(mql.matches)

    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [preference])

  const resolvedTheme = resolve(preference, systemDark)

  // ── Apply theme to the document ──────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', resolvedTheme === 'dark')
    // Aligns native form controls / scrollbars with the resolved theme.
    root.style.colorScheme = resolvedTheme
  }, [resolvedTheme])

  // ── Apply interface size to the document ──────────────────────────────
  // PRE-Y8 (Interface Size Preference), FIX1 — writes the SEMANTIC value
  // only (`data-ui-size="original"|"medium"|"large"`, the exact
  // InterfaceSizePreference string — no numeric lookup here). index.css's
  // `:root[data-ui-size="..."]` rules are what turn this attribute into the
  // actual `--ui-zoom` factor that `html { zoom: var(--ui-zoom); }`
  // consumes; this effect never computes or writes that number itself.
  // Mirrors the theme-apply effect immediately above in shape (one
  // `useEffect`, one DOM write, no other side effects) and, like it, is
  // deliberately just a semantic mirror of state, not scale-computation
  // logic.
  useEffect(() => {
    document.documentElement.dataset.uiSize = interfaceSize
  }, [interfaceSize])

  // ── Cross-tab sync ────────────────────────────────────────────────────
  // Another tab already PATCHed and wrote its own new value to this key —
  // this tab just adopts it locally. Never re-PATCHes in response to this
  // event (that would be redundant — the value is already saved).
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY && isThemePreference(e.newValue)) {
        setPreference(e.newValue)
      }
      // PRE-Y8 — identical cross-tab adoption for the independent
      // interface-size key. Deliberately a second `if`, not an `else if`:
      // a single storage event only ever carries one key/newValue pair
      // (per the native StorageEvent contract), so there is no real
      // ambiguity — this just keeps the two fields' handling visibly
      // symmetric and independent, matching how their save paths are
      // independent.
      if (e.key === INTERFACE_SIZE_STORAGE_KEY && isInterfaceSizePreference(e.newValue)) {
        setInterfaceSize(e.newValue)
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  // PRE-Y8 — Appearance is now an IMMEDIATE preference (Settings Interaction
  // Policy Refinement §9-13): the resolved theme must change the instant the
  // user picks a tile, not only once the PATCH resolves. This function now
  // applies the selection optimistically (before the network call), and
  // only rolls back to the previous confirmed value if that specific
  // request turns out to be both the LATEST one issued and a failure —
  // matching §11's recommended model exactly (remember previous → apply
  // immediately → persist → roll back + surface error on failure) while
  // §12's generation guard prevents a stale, superseded response from ever
  // undoing a newer selection.
  //
  // Still throws on failure (same public contract as before) so the caller
  // (AppearanceSettings.tsx) can show its own inline error — but only when
  // this call is still the most recent one; a superseded call resolves
  // silently instead, since a newer call already owns the outcome.
  //
  // PRE-Y8 (Interface Size Preference) — renamed from the original
  // `saveAppearance({ theme })` to `saveTheme(theme)` now that there are two
  // independent fields, each with its own save function (see
  // `saveInterfaceSize` immediately below) — AppearanceSettings.tsx is the
  // only consumer and is updated accordingly. The body sent to
  // appearanceService.updateMyAppearance is a single-field partial
  // (`{ theme }`), never merged with the current interfaceSize — see that
  // service's own comment.
  const saveTheme = useCallback(async (next: ThemePreference) => {
    const myGeneration = ++themeSaveGenerationRef.current
    const previous = preferenceRef.current

    setPreference(next)
    writeCachedPreference(next)

    try {
      const saved = await appearanceService.updateMyAppearance({ theme: next })
      if (themeSaveGenerationRef.current !== myGeneration) return // superseded — a newer selection already owns state
      setPreference(saved.theme)
      writeCachedPreference(saved.theme)
    } catch (err) {
      if (themeSaveGenerationRef.current !== myGeneration) return // superseded — never roll back over a newer selection
      setPreference(previous)
      writeCachedPreference(previous)
      throw err
    }
  }, [])

  // PRE-Y8 (Interface Size Preference) — exact structural mirror of
  // saveTheme above (optimistic apply → persist → generation-guarded
  // reconcile-or-rollback), operating on the independent `interfaceSize`
  // field with its OWN generation counter (`interfaceSizeSaveGenerationRef`)
  // and its OWN previous-value ref (`interfaceSizeRef`) — a Theme save in
  // flight at the same moment neither blocks nor is affected by this one,
  // and vice versa.
  const saveInterfaceSize = useCallback(async (next: InterfaceSizePreference) => {
    const myGeneration = ++interfaceSizeSaveGenerationRef.current
    const previous = interfaceSizeRef.current

    setInterfaceSize(next)
    writeCachedInterfaceSize(next)

    try {
      const saved = await appearanceService.updateMyAppearance({ interfaceSize: next })
      if (interfaceSizeSaveGenerationRef.current !== myGeneration) return
      setInterfaceSize(saved.interfaceSize)
      writeCachedInterfaceSize(saved.interfaceSize)
    } catch (err) {
      if (interfaceSizeSaveGenerationRef.current !== myGeneration) return
      setInterfaceSize(previous)
      writeCachedInterfaceSize(previous)
      throw err
    }
  }, [])

  // Manual retry after a failed authenticated fetch — re-fetches for the
  // current identity if one exists.
  const reloadAppearance = useCallback(() => {
    if (!isAuthenticated || !user) return
    fetchForUser(user.id)
  }, [isAuthenticated, user, fetchForUser])

  return (
    <AppearanceContext.Provider
      value={{
        preference, resolvedTheme,
        interfaceSize,
        isLoading, error,
        saveTheme, saveInterfaceSize,
        reloadAppearance,
      }}
    >
      {children}
    </AppearanceContext.Provider>
  )
}

export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext)
  if (!ctx) throw new Error('useAppearance must be used inside AppearanceProvider')
  return ctx
}
