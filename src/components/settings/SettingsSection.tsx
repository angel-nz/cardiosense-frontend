import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SettingsSectionProps {
  title: string
  children: ReactNode
  className?: string
  // PRE-Y8 (Profile Edit Mode) — optional content rendered at the right of
  // the header row, alongside `title`. Added here (rather than inside a
  // section's own body) because it's a tiny, generic layout adjustment any
  // section could use, not Profile-specific markup — no existing section
  // passes it today, so this is a purely additive, non-breaking change:
  // `justify-between` on a single child (no `headerAction`) lays out
  // exactly as before.
  headerAction?: ReactNode
  // PRE-R2E — `overflow-hidden` below (needed to clip a section's content
  // to its own `rounded-xl` corners) is, by the CSS positioning spec, also
  // a scroll container: it would silently defeat `position: sticky` on any
  // descendant, confining it to this card's own intrinsic height instead
  // of the page's real (window-level) scroll — the element would never
  // visibly "stick" at all. PatientVisibilitySettings' hidden-patient
  // search bar is the one section body that needs a sticky descendant
  // (PRE-R2E §10), so this prop lets ONLY that call site opt out of the
  // clip; every other section keeps the exact same `overflow-hidden` as
  // before (default false — zero behavior change anywhere else). Nothing
  // in this component's own content touches the card's edge, so dropping
  // the clip here has no visible effect beyond re-enabling sticky.
  allowOverflow?: boolean
}

// Y2 — shared card wrapper for a Settings section's content. Purely
// presentational (mirrors the SectionCard pattern the old, now-retired
// SettingsPage.tsx used) — carries no business logic and no state. Created
// now because Y2 itself needs it (all five structural placeholders use it),
// not speculatively — later Y blocks may keep using it for their real
// section content, but this file does not pre-build anything beyond what
// Y2 requires (no SaveBar/DangerZone/SettingsToggle/SettingsField here).
// Y6.3B — body vertical padding (`py-5`) responds to --ui-card-padding
// (Classic 1.25rem/20px, exact match — spot-check "SettingsSection padding",
// §45). Header padding (`py-4`/16px) is a genuine, deliberately different
// pre-existing value from the body's — per §21 ("do NOT harmonize a
// legitimate outlier"), it is left invariant rather than forced onto the
// same token, which would silently change Classic. Both horizontal
// paddings (`px-6`) stay fixed, same rationale already applied to table row
// padding elsewhere (§32). The heading now responds to --ui-font-section-
// title (Classic 1rem/16px — the same size this un-sized `<h2>` already
// rendered at via inheritance, so Classic is unaffected; Comfortable/High
// Visibility can now grow it).
export function SettingsSection({ title, children, className, headerAction, allowOverflow = false }: SettingsSectionProps) {
  return (
    <div className={cn('bg-card rounded-xl border border-border', !allowOverflow && 'overflow-hidden', className)}>
      <div className="px-6 py-4 border-b border-border flex items-center justify-between gap-3">
        <h2 className="ui-heading-section font-semibold text-foreground">{title}</h2>
        {headerAction}
      </div>
      <div className="px-6" style={{ paddingTop: 'var(--ui-card-padding)', paddingBottom: 'var(--ui-card-padding)' }}>
        {children}
      </div>
    </div>
  )
}
