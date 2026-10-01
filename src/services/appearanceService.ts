import { api } from './api'
import type { ThemePreference, InterfaceSizePreference, AppearancePreferenceResponse } from '@/types'

// ─── Backend wire shape ───────────────────────────────────────────────────
// GET/PATCH /api/users/me/appearance (Bloque Y6.1, extended PRE-Y8 with
// Interface Size). Scoped to the authenticated user server-side
// (req.user.sub) — no id is ever sent from here. `updatedAt` is null when
// the user has never saved a preference and the backend is returning its
// lazy SYSTEM/MEDIUM defaults (no row created by GET — interfaceSize's
// application-level default changed from ORIGINAL to MEDIUM in Z4; the
// underlying Prisma column default is unrelated and untouched — see
// user.routes.ts's own Z4 comments).
//
// The backend's enums are uppercase ('LIGHT'|'DARK'|'SYSTEM' and
// 'ORIGINAL'|'MEDIUM'|'LARGE'); everything on the frontend — AppearanceContext,
// AppearanceSettings, the pre-hydration script, localStorage — uses the
// lowercase unions exclusively. This file is the ONLY place that ever sees
// the uppercase wire values; each mapping is small and exhaustive (a switch
// with no default branch) so a future additional enum value fails to
// compile here rather than silently falling through.
interface BackendAppearancePreference {
  theme: 'LIGHT' | 'DARK' | 'SYSTEM'
  interfaceSize: 'ORIGINAL' | 'MEDIUM' | 'LARGE'
  updatedAt: string | null
}

function toFrontendTheme(theme: BackendAppearancePreference['theme']): ThemePreference {
  switch (theme) {
    case 'LIGHT':  return 'light'
    case 'DARK':   return 'dark'
    case 'SYSTEM': return 'system'
  }
}

function toBackendTheme(theme: ThemePreference): BackendAppearancePreference['theme'] {
  switch (theme) {
    case 'light':  return 'LIGHT'
    case 'dark':   return 'DARK'
    case 'system': return 'SYSTEM'
  }
}

function toFrontendInterfaceSize(size: BackendAppearancePreference['interfaceSize']): InterfaceSizePreference {
  switch (size) {
    case 'ORIGINAL': return 'original'
    case 'MEDIUM':   return 'medium'
    case 'LARGE':    return 'large'
  }
}

function toBackendInterfaceSize(size: InterfaceSizePreference): BackendAppearancePreference['interfaceSize'] {
  switch (size) {
    case 'original': return 'ORIGINAL'
    case 'medium':   return 'MEDIUM'
    case 'large':    return 'LARGE'
  }
}

function toFrontend(pref: BackendAppearancePreference): AppearancePreferenceResponse {
  return {
    theme: toFrontendTheme(pref.theme),
    interfaceSize: toFrontendInterfaceSize(pref.interfaceSize),
    updatedAt: pref.updatedAt,
  }
}

// PRE-Y8 (Interface Size Preference) — `updateMyAppearance` now takes a
// TRUE PARTIAL patch: exactly one of `theme`/`interfaceSize` (whichever the
// caller is actually changing), never both, and never a field the caller
// isn't touching. AppearanceContext.tsx's saveTheme()/saveInterfaceSize()
// are the only two callers, and each passes only its own field — this
// function does not merge in the other current value itself, so a
// concurrent theme-save and interfaceSize-save can never race over a
// shared request body (there isn't one; they are two independent PATCH
// calls). The backend DTO also accepts either field alone (both are
// `.optional()`), so this is a real, structural partial update, not a
// same-value round-trip of the untouched field.
export const appearanceService = {
  async getMyAppearance(): Promise<AppearancePreferenceResponse> {
    const { data } = await api.get<BackendAppearancePreference>('/users/me/appearance')
    return toFrontend(data)
  },

  async updateMyAppearance(
    next: { theme: ThemePreference } | { interfaceSize: InterfaceSizePreference },
  ): Promise<AppearancePreferenceResponse> {
    const body: Partial<Pick<BackendAppearancePreference, 'theme' | 'interfaceSize'>> = {}
    if ('theme' in next) body.theme = toBackendTheme(next.theme)
    if ('interfaceSize' in next) body.interfaceSize = toBackendInterfaceSize(next.interfaceSize)
    const { data } = await api.patch<BackendAppearancePreference>('/users/me/appearance', body)
    return toFrontend(data)
  },
}
