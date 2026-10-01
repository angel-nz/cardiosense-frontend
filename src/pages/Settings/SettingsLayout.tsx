import type { ElementType } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { User, Bell, Shield, Palette, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SettingsNavItem {
  to: string
  label: string
  icon: ElementType
}

// Y2 — final Settings information architecture, frozen in Y1, later
// revised by Y7R: the Privacy & Data section (added and then removed
// entirely in Phase Y — see Y7R) is not part of the product.
// Z8 §15 — a fifth section, Pacientes, is added: the one normal
// Doctor-facing surface for managing hidden-patient visibility. Order
// matches the approved IA exactly, Pacientes appended last.
const SETTINGS_NAV: SettingsNavItem[] = [
  { to: '/settings/profile',       label: 'Perfil',         icon: User },
  { to: '/settings/notifications', label: 'Alertas', icon: Bell },
  { to: '/settings/security',      label: 'Seguridad',      icon: Shield },
  { to: '/settings/appearance',    label: 'Apariencia',     icon: Palette },
  { to: '/settings/patients',      label: 'Pacientes',      icon: Users },
]

// Y2 — Settings Shell & Navigation.
//
// This layout owns ONLY navigation/shell concerns: the page heading,
// section navigation, responsive structure, and the <Outlet /> that
// renders whichever section route is currently active. It must never own
// section business state (profile/notification/password/session/theme/
// privacy state, loading, or error state) — each section route owns its
// own data, per the Y1 contract. There is no local "activeTab" state
// anywhere in this file: the active section is derived entirely from the
// current URL via NavLink, which is the source of truth (Y1 §9/§40).
//
// Desktop/tablet: section nav sits to the left of the content (subordinate
// to the main app Sidebar — this is Settings-local navigation, not a
// second application Sidebar). Mobile: the same <nav> becomes a
// horizontally scrollable row above the content — no hamburger drawer,
// per the Y2 mobile contract.
export default function SettingsLayout() {
  return (
    <div className="ui-section-stack-tight max-w-4xl">
      {/* Y6.3B-FIX1 §13/§11 — nav↔content gap. Classic's current 20px is a
          genuine outlier from --ui-element-gap's own 16px, preserved via
          the shared .ui-major-grid-gap calc() offset rather than forced
          onto the standard token (§5/§11), while still scaling
          proportionally with it. */}
      <div className="flex flex-col sm:flex-row ui-major-grid-gap">
        {/* ── Section navigation ─────────────────────────────────────────
            Real routes via NavLink, not an in-page tab widget — no
            role="tab"/tablist semantics, per Y1 §9. NavLink itself applies
            aria-current="page" to the active link, and each item is a real
            <a> (keyboard-reachable, focusable, no clickable <div>s). */}
        <aside className="sm:w-52 flex-shrink-0 min-w-0">
          <nav
            aria-label="Configuración"
            className="bg-card rounded-xl border border-border p-2 flex sm:flex-col gap-0.5 overflow-x-auto sm:overflow-x-visible"
          >
            {SETTINGS_NAV.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => cn(
                  // Y6.3B-FIX1 §13 — nav item control height (py-2.5 already
                  // matched --ui-control-padding-y's Classic value exactly)
                  // and label typography now both participate: Compact
                  // never shrinks the label below Classic (--ui-font-body
                  // itself never drops below Classic per §25), Comfortable/
                  // High Visibility grow it, keeping the nav readable and
                  // non-colliding at larger presets.
                  'flex items-center gap-3 px-3 ui-control-density rounded-lg ui-text-body font-medium transition-colors text-left whitespace-nowrap flex-shrink-0',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  isActive
                    ? 'bg-primary text-white'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                )}
              >
                <item.icon className="w-4 h-4 flex-shrink-0" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* ── Section content ─────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
