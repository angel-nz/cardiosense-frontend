import type { InterfaceSizePreference } from '@/types'

// PRE-Y8 (Interface Size Preference), FIX1 — this file NO LONGER carries a
// numeric scale-value map (the original INTERFACE_SIZE_SCALE constant was a
// duplicate of the real, canonical mapping and has been removed per FIX1
// §1/§4). The ONE place that defines 1 / 1.10 / 1.25 anywhere in the app is
// now index.css's `:root[data-ui-size="..."]` rules. Everything else works
// with the semantic string only:
//   - index.html's bootstrap script and AppearanceContext.tsx both just
//     mirror the current InterfaceSizePreference onto the
//     `data-ui-size` DOM attribute (unchanged, no lookup) — CSS resolves
//     the number from that.
//   - Sidebar.tsx's CollapsedTooltip, the one place that genuinely needs
//     the numeric factor at runtime (to compensate its own
//     getBoundingClientRect()-derived fixed-position math — see that
//     file's comment), reads it back via
//     `getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')`
//     rather than maintaining a second map — it is reading the SAME value
//     CSS just resolved, not re-deriving it.
//
// This module now only keeps the one small piece of logic every one of
// those call sites still needs in common: validating that an arbitrary
// cached/received string is actually one of the three known preference
// values, so an invalid or corrupted value can never reach `data-ui-size`
// (and, from there, never reach `--ui-zoom` as anything but a real number)
export function isInterfaceSizePreference(value: unknown): value is InterfaceSizePreference {
  return value === 'original' || value === 'medium' || value === 'large'
}
