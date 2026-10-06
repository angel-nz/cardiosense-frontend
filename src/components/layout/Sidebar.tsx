import { useState, useRef, useEffect, type RefObject, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  Activity,
  Bell,
  Settings,
  ChevronLeft,
  ChevronRight,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { cn, userIdentifierLabel } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { useSocket } from '@/context/SocketContext'
import { useAppearance } from '@/context/AppearanceContext'
import { UserAvatar } from '@/components/ui/UserAvatar'

interface NavItem {
  to: string
  icon: React.ElementType
  label: string
  badge?: number
}

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  alertCount?: number
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard',    icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/patients',     icon: Users,           label: 'Pacientes' },
  { to: '/predictions',  icon: Activity,        label: 'Predicciones' },
  { to: '/alerts',       icon: Bell,            label: 'Alertas' },
]

const BOTTOM_ITEMS: NavItem[] = [
  { to: '/settings', icon: Settings, label: 'Configuración' },
]

// PRE-Y8 (Application Shell — Sidebar Collapsed Navigation & Topbar
// Alignment) — ROOT CAUSE of the collapsed horizontal-overflow defect:
// the old per-item tooltip was `position: absolute; left-full ml-3;
// whitespace-nowrap`, with its containing block being the `.sidebar-nav-
// item` row itself (`relative`), which lives INSIDE `<nav>` below. `<nav>`
// sets `overflow-y-auto` but never an explicit `overflow-x` — per the CSS
// Overflow spec, leaving one axis at its 'visible' default while the other
// is non-visible forces the browser to COMPUTE the visible one as 'auto'
// too (a well-known interop rule, not a bug in this app's CSS alone). The
// old tooltip was only `opacity`-hidden at rest, not `display:none` —
// opacity doesn't remove an element from layout — so its full,
// whitespace-nowrap-sized box (wide enough for "Predicciones", etc.) was
// ALWAYS part of `<nav>`'s scrollable content, regardless of hover state.
// The instant Sidebar collapsed to its ~68px rail, that oversized,
// permanently-laid-out (if invisible) box became horizontal overflow of
// `<nav>`'s now-`auto` x-axis — surfacing as the reported horizontal
// scrollbar/nav strip.
//
// A container's `overflow` clips (or scrolls) EVERY descendant in that
// axis regardless of the descendant's own `position`/z-index — so simply
// adding `overflow-x-hidden` to `<nav>` (the deterministic fix §4 calls
// for once the real cause is found) would stop the permanent overflow, but
// would ALSO clip the tooltip the moment it should actually appear on
// hover/focus, since its containing block is still inside that same
// clipped `<nav>`. The only way to have BOTH a vertically-scrollable nav
// AND an unclipped flyout tooltip is for the tooltip to not be a layout
// descendant of `<nav>` at all. `CollapsedTooltip` below does that with a
// `react-dom` portal to `document.body` (no new dependency), positioned
// from the trigger row's own `getBoundingClientRect()` — same flyout
// look/placement as before, just no longer inside the clipped/scrollable
// box. It also fixes a real pre-existing gap along the way: the old
// `group-hover:opacity-100` CSS never had a `group-focus-within` sibling,
// so keyboard focus never actually revealed these tooltips — this version
// tracks hover AND focus in React state, so both do.
//
// PRE-Y8 (Interface Size Preference) — this component's own coordinate math
// is exactly the "CollapsedTooltip portal" the block's spec calls out by
// name for a zoom-coordinate audit, and the audit found a real bug: `html`
// now carries a CSS `zoom` (index.css's `--ui-zoom`), and this tooltip is a
// portal to `document.body` — itself a descendant of the zoomed `html` —
// so it is ALSO subject to that zoom. `anchorEl.getBoundingClientRect()`
// already reports the anchor's final, on-screen (post-zoom) position, but
// assigning that value directly as this element's OWN `top`/`left` used to
// double-apply the zoom (the browser re-scales THIS element's own length
// values by the same ambient zoom), making the tooltip visibly drift away
// from its anchor — worse at a larger zoom factor. Verified directly
// against a real Chromium instance (screenshot + instrumented
// getBoundingClientRect comparison, not just reasoned about) before and
// after this fix — see the final report. Dividing by the current zoom
// factor before assigning cancels that re-scaling exactly.
//
// FIX1 — the zoom factor is read directly from the resolved CSS custom
// property (`getComputedStyle(document.documentElement).getPropertyValue
// ('--ui-zoom')`), NOT from a second, component-local
// InterfaceSizePreference → number map. index.css's
// `:root[data-ui-size="..."]` rules are the ONE place that mapping exists
// anywhere in the app (see that file and AppearanceContext.tsx's own
// comments) — this just reads back the number CSS already resolved, so it
// can never drift out of sync with it. `Number.parseFloat(...) || 1` is
// the defensive fallback for the (should-never-happen) case where the
// property is empty/unparseable — same "never let a bad value break
// rendering" discipline as this file's other defensive reads.
function CollapsedTooltip({
  show, anchorRef, children,
}: {
  show: boolean
  anchorRef: RefObject<HTMLElement>
  children: ReactNode
}) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  // Read only to force this effect to re-run when Interface Size changes
  // while a tooltip happens to already be showing (held hover/focus) — the
  // VALUE is never used to compute anything (that would be exactly the
  // reintroduced second map FIX1 removes); the actual factor always comes
  // from `getComputedStyle` below, which is already reactive to
  // `data-ui-size` by the time this effect body runs.
  const { interfaceSize } = useAppearance()

  useEffect(() => {
    if (!show) return
    const el = anchorRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const rawZoom = getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')
    const zoom = Number.parseFloat(rawZoom) || 1
    // The "+ 12" (the visual gap between the rail and the tooltip) is
    // deliberately added AFTER dividing rect.right by the zoom factor, not
    // before — this makes the gap itself scale proportionally with
    // Interface Size, matching every other spacing value in the zoomed UI,
    // rather than staying a fixed 12 physical px regardless of zoom
    // (confirmed against the same real-Chromium test referenced above).
    setCoords({
      top: (rect.top + rect.height / 2) / zoom,
      left: (rect.right / zoom) + 12,
    })
  }, [show, anchorRef, interfaceSize])

  if (!show || !coords) return null

  return createPortal(
    <div
      role="tooltip"
      className="fixed px-2 py-1 bg-gray-900 text-white text-xs rounded-md whitespace-nowrap z-50 shadow-lg pointer-events-none"
      style={{ top: coords.top, left: coords.left, transform: 'translateY(-50%)' }}
    >
      {children}
    </div>,
    document.body,
  )
}

// Shared by NAV_ITEMS and BOTTOM_ITEMS — identical shape (icon, optional
// alert badge, label), so this replaces what was previously duplicated
// inline in two separate `.map()` blocks. Per-item hover/focus state and a
// row `ref` are needed for `CollapsedTooltip` (§ above), which can't live
// inside a `.map()` callback directly (rules of hooks) — hence the
// extraction into its own component instance per item.
export function SidebarNavLink({
  to, icon: Icon, label, collapsed, isActive, badgeCount,
}: {
  to: string
  icon: React.ElementType
  label: string
  collapsed: boolean
  isActive: boolean
  badgeCount?: number
}) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const hasBadge = !!badgeCount && badgeCount > 0

  return (
    // FIX1 §2 — the tooltip is a visual aid only, never the sole naming
    // mechanism (a screen reader user gets no hover/focus-driven DOM change
    // "for free" the way a sighted user gets the flyout). When collapsed,
    // the visible label span below isn't rendered at all, so the link
    // would otherwise have NO accessible name; `aria-label` restores it
    // directly from the same `label` this component already renders
    // everywhere else — no second route→label mapping. When expanded, the
    // rendered text content already names the link, so `aria-label` is
    // `undefined` there rather than duplicating it.
    <NavLink to={to} aria-label={badgeCount !== undefined ? `${label}, ${badgeCount} no leídas` : collapsed ? label : undefined}>
      <div
        ref={rowRef}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={cn(
          'sidebar-nav-item relative',
          isActive && 'active',
          collapsed && 'justify-center px-0',
        )}
      >
        <div className="relative flex-shrink-0">
          {/* FIX1 §5 — decorative in both states: expanded is named by the
              visible label span, collapsed by the `aria-label` above. */}
          <Icon className="w-5 h-5" aria-hidden="true" />
          {collapsed && hasBadge && (
            <span data-testid="sidebar-bell-badge" aria-hidden="true" className="absolute -top-1.5 -right-2 min-w-4 px-1 h-4 bg-red-500 dark:bg-destructive rounded-full text-white text-[9px] font-bold flex items-center justify-center">
              {badgeCount! > 99 ? '99+' : badgeCount}
            </span>
          )}
        </div>
        {!collapsed && <span className="truncate">{label}</span>}
        {!collapsed && hasBadge && (
          <span className="ml-auto bg-red-500 dark:bg-destructive text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
            {badgeCount! > 99 ? '99+' : badgeCount}
          </span>
        )}
      </div>
      <CollapsedTooltip show={collapsed && (hovered || focused)} anchorRef={rowRef}>
        {label}
        {hasBadge && (
          <span className="ml-1 bg-red-500 dark:bg-destructive px-1 rounded-sm">{badgeCount}</span>
        )}
      </CollapsedTooltip>
    </NavLink>
  )
}

export function Sidebar({ collapsed, onToggle, alertCount = 0 }: SidebarProps) {
  const { user } = useAuth()
  const { connected } = useSocket()
  const location = useLocation()

  // Profile row keeps its own hover/focus + ref (not part of the .map()
  // above — its visual content differs, avatar + two text lines rather
  // than an icon), reusing the same CollapsedTooltip portal.
  const [profileHovered, setProfileHovered] = useState(false)
  const [profileFocused, setProfileFocused] = useState(false)
  const profileRowRef = useRef<HTMLDivElement>(null)

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-full z-30 flex flex-col transition-all duration-300 ease-in-out select-none',
        'border-r border-white/10',
      )}
      style={{
        width: collapsed ? 'var(--sidebar-collapsed)' : 'var(--sidebar-width)',
        background: 'hsl(var(--sidebar-bg))',
      }}
    >
      {/* ─── Logo ──────────────────────────────────────────────────────── */}
      {/* PRE-Y8 (Application Shell) — ROOT CAUSE of the header/Topbar
          border misalignment: this was `py-5` (40px of vertical padding)
          with only a `min-h-[68px]` FLOOR, not a fixed height. Content here
          (the 36px logo icon box, or — expanded — the two-line
          "CardioSense"/"Sistema Cardiovascular" text block, itself ≈36px)
          plus 40px of padding totals ≈76px, which exceeds the 68px floor —
          so the floor never actually bound anything, and this header
          rendered ~8px taller than Topbar.tsx's own explicit, deliberately
          "frozen invariant" `h-[68px]` (see Topbar.tsx's own §8 comment,
          untouched here). Two different mechanisms (a min-height that
          loses to its own content vs. a hard height) produced two
          different real heights, so the two bottom borders landed 8px
          apart. Fix: reuse the SAME mechanism and the SAME value Topbar
          already established (`h-[68px]`, a real height, not a floor), and
          reduce the padding (`py-5` → `py-4`) so the 36px content
          genuinely fits inside it — 16px + 36px + 16px = 68px — rather
          than papering over the gap with a translate/margin offset. This
          value is unconditional (not gated on `collapsed`), so collapsing
          cannot change the header's height or shift the border, matching
          §18. */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-white/10 h-[68px]">
        <img
          src="/brand/cardiosense-icon.png"
          alt={collapsed ? 'CardioSense' : ''}
          className="w-9 h-9 object-contain"
        />
        {!collapsed && (
          <div className="overflow-hidden">
            <p className="text-white font-bold text-base leading-none tracking-tight">
              CardioSense
            </p>
          </div>
        )}
      </div>

      {/* ─── Primary Nav ───────────────────────────────────────────────── */}
      {/* PRE-Y8 — `overflow-x-hidden` added explicitly alongside the
          pre-existing `overflow-y-auto`. This is the deterministic
          safeguard §4 allows once the real cause (above) is fixed — with
          the tooltip now portaled out of this subtree, nothing left inside
          `<nav>` is wider than the collapsed rail, so this only guards
          against the CSS auto-computed-overflow-x quirk itself, it doesn't
          clip anything that needs to be visible. */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto overflow-x-hidden">
        {NAV_ITEMS.map(({ to, icon, label }) => (
          <SidebarNavLink
            key={to}
            to={to}
            icon={icon}
            label={label}
            collapsed={collapsed}
            isActive={location.pathname.startsWith(to)}
            badgeCount={to === '/alerts' ? alertCount : undefined}
          />
        ))}
      </nav>

      {/* ─── Bottom Section ────────────────────────────────────────────── */}
      <div className="px-3 py-4 border-t border-white/10 space-y-1">
        {BOTTOM_ITEMS.map(({ to, icon, label }) => (
          <SidebarNavLink
            key={to}
            to={to}
            icon={icon}
            label={label}
            collapsed={collapsed}
            isActive={location.pathname.startsWith(to)}
          />
        ))}

        {/* V8.2 — realtime Socket.IO channel status only (V8.1 §4/§14: this
            never implies PostgreSQL/REST/AI-service health). `connected`
            comes straight from useSocket() (SocketContext.tsx, unchanged —
            V8.1 already established its semantics exactly match
            Conectado/Desconectado). role="status" + aria-label carries the
            full accessible meaning on the container itself, in both
            collapsed and expanded modes; `title` gives the same text as a
            mouse-hover tooltip. The icon and the visible text span are
            aria-hidden so a screen reader announces the container's
            aria-label exactly once, never a duplicated/confusing readout of
            "Wifi icon, Conectado" on top of it. Not a navigation
            destination, so it's untouched by this block's tooltip/overflow
            fix (its own `title` attribute already covers hover, it doesn't
            render an oversized absolutely-positioned box, and it isn't
            inside the scrollable `<nav>`). */}
        <div
          role="status"
          aria-label={connected ? 'Canal de tiempo real conectado' : 'Canal de tiempo real desconectado'}
          title={connected ? 'Canal de tiempo real conectado' : 'Canal de tiempo real desconectado'}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-lg mt-1',
            collapsed && 'justify-center px-0',
          )}
        >
          {connected ? (
            <Wifi aria-hidden="true" className="w-3.5 h-3.5 text-teal-400 flex-shrink-0" />
          ) : (
            <WifiOff aria-hidden="true" className="w-3.5 h-3.5 text-white/30 flex-shrink-0" />
          )}
          {!collapsed && (
            <span aria-hidden="true" className={cn('text-xs', connected ? 'text-teal-400' : 'text-white/30')}>
              {connected ? 'Conectado' : 'Desconectado'}
            </span>
          )}
        </div>

        {/* V9.2R — the doctor profile block below the V8 connection status
            is the sole navigation target for "go to my Profile" (the
            Topbar's separate "Mi perfil" dropdown item is untouched and out
            of this block's scope — V9.1R). The entire existing block
            (avatar + name + email, content unchanged) is wrapped in one
            NavLink, reusing this file's own NAV_ITEMS/BOTTOM_ITEMS pattern
            rather than inventing a new interactive-element shape — a real
            <a>, natively focusable/keyboard-activatable, so no
            role="button"/tabIndex/manual key handler is needed.
            Y2 — navigates directly to the real /settings/profile route. */}
        <NavLink to="/settings/profile" aria-label="Ir a mi perfil">
          <div
            ref={profileRowRef}
            onMouseEnter={() => setProfileHovered(true)}
            onMouseLeave={() => setProfileHovered(false)}
            onFocus={() => setProfileFocused(true)}
            onBlur={() => setProfileFocused(false)}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg mt-1 cursor-pointer hover:bg-white/5 transition-colors relative',
              collapsed && 'justify-center px-0',
            )}
          >
            {/* Y3.1B §28/§33/§34 — shared UserAvatar: same 32×32 footprint
                as before (no layout shift), reads the one AvatarProvider
                fetch shared with Topbar/ProfileSettings, falls back to the
                exact same initials()-based rendering this block replaces
                when there is no avatar or the image fails to load. Sidebar
                already renders the doctor's name as text right next to
                this (a few lines below), so the image itself stays
                decorative (no alt) — Y3.1A-FIX1 §29. */}
            {user ? (
              <UserAvatar firstName={user.firstName} lastName={user.lastName} size="sm" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                DR
              </div>
            )}
            {!collapsed && user && (
              <div className="overflow-hidden">
                <p className="text-white text-xs font-medium truncate leading-none">
                  Dr. {user.firstName}
                </p>
                {/* Z6-R1 — a phone-only doctor has no email; falls back to
                    phone rather than rendering nothing/"null". */}
                <p className="text-white/40 text-[10px] truncate mt-0.5">{userIdentifierLabel(user)}</p>
              </div>
            )}
          </div>
          <CollapsedTooltip
            show={collapsed && (profileHovered || profileFocused)}
            anchorRef={profileRowRef}
          >
            Mi perfil
          </CollapsedTooltip>
        </NavLink>
      </div>

      {/* ─── Collapse Toggle ───────────────────────────────────────────── */}
      {/* Y6.2 — this button floats over the boundary with the main content
          area (not inside the fixed-dark navy sidebar body above), so unlike
          the sidebar's own tooltips/hover states it IS a generic app surface:
          was bg-white/hover:bg-gray-50/text-gray-500, now the same
          card/accent/muted-foreground tokens every other generic surface
          control in the app uses. */}
      <button
        onClick={onToggle}
        className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-card border border-border shadow-sm flex items-center justify-center hover:bg-accent transition-colors z-40"
        aria-label={collapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
      >
        {collapsed ? (
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
        ) : (
          <ChevronLeft className="w-3 h-3 text-muted-foreground" />
        )}
      </button>
    </aside>
  )
}
