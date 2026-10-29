import { useState, useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { cn } from '@/lib/utils'
import { AlertToastBridge } from './AlertToastBridge'
import { useAlerts } from '@/context/AlertsContext'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard':   'Dashboard',
  '/patients':    'Pacientes',
  '/predictions': 'Predicciones',
  '/alerts':      'Centro de Alertas',
  '/settings':    'Configuración',
}

// Mirrors Tailwind's `lg` breakpoint, where the sidebar becomes a fixed column.
const DESKTOP_QUERY = '(min-width: 1024px)'
const MENU_TRIGGER_ID = 'app-mobile-menu-trigger'
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches,
  )
  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY)
    const onChange = () => setIsDesktop(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return isDesktop
}

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const isDesktop = useIsDesktop()
  // The drawer is a modal only below `lg`; at `lg+` the sidebar is a plain column.
  const drawerOpen = mobileOpen && !isDesktop
  const sidebarWrapRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const { unreadCount } = useAlerts()

  const pageTitle = Object.entries(PAGE_TITLES).find(([path]) =>
    location.pathname.startsWith(path)
  )?.[1] ?? ''

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  // Reaching a desktop width must not leave (or later restore) an open drawer.
  useEffect(() => {
    if (isDesktop) setMobileOpen(false)
  }, [isDesktop])

  // Modal drawer lifecycle: scroll lock, inert background, focus entry,
  // Escape, Tab containment and focus restore. Fully undone on cleanup.
  useEffect(() => {
    if (!drawerOpen) return
    const wrap = sidebarWrapRef.current
    const content = contentRef.current
    const body = document.body
    const prevOverflow = body.style.overflow
    body.style.overflow = 'hidden'
    content?.setAttribute('inert', '')
    wrap?.querySelector<HTMLElement>('[data-drawer-close]')?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        setMobileOpen(false)
        return
      }
      if (e.key !== 'Tab' || !wrap) return
      const items = Array.from(wrap.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !wrap.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !wrap.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      body.style.overflow = prevOverflow
      content?.removeAttribute('inert')
      const trigger = document.getElementById(MENU_TRIGGER_ID)
      // Trigger is hidden at desktop widths; fall back to the sidebar so focus is not lost.
      if (trigger && trigger.getClientRects().length > 0) trigger.focus()
      else wrap?.querySelector<HTMLElement>('nav a[href]')?.focus()
    }
  }, [drawerOpen])

  return (
    // PRE-Y8 (Interface Size Preference), FIX2 — was `min-h-screen`
    // (`min-height: 100vh`): under this app's global `--ui-zoom` (see
    // index.css), a plain `vh` value is itself re-scaled by zoom, so an
    // uncompensated 100vh minimum would render as a physically taller
    // page at Medium/Large than at Original. `.ui-viewport-min-height`
    // (index.css) divides by the same `--ui-zoom` so the physically
    // rendered minimum stays pinned to the true viewport height at every
    // Interface Size — see that class's own comment for the full
    // rationale and the real-Chromium verification behind it.
    <div className="ui-viewport-min-height bg-background">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div ref={sidebarWrapRef} id="app-sidebar" className={cn('lg:block', mobileOpen ? 'block' : 'hidden lg:block')}>
        <Sidebar
          collapsed={collapsed}
          drawer={!isDesktop}
          onClose={() => setMobileOpen(false)}
          onToggle={() => setCollapsed(c => !c)}
          alertCount={unreadCount}
        />
      </div>

      {/* Main content area */}
      {/* PRE-Y8 (Interface Size Preference), FIX2 — same
          `.ui-viewport-min-height` swap as the page-root div above, and
          for the same reason: this div is a DESCENDANT of that root, so
          if only the outer wrapper were compensated while this one kept
          demanding an uncompensated `min-h-screen`, this inner div would
          still force the whole page tall — both occurrences in this file
          have to be fixed together for the compensation to actually take
          effect. */}
      <div
        ref={contentRef}
        // UI-MOBILE-B1 (UI-MOB-001/004) — the sidebar is hidden below `lg`,
        // so it must not reserve horizontal space there. The offset is
        // carried by `--shell-offset` (same value as before) and applied
        // only from `lg` up; below `lg` the margin is 0.
        className="transition-all duration-300 ui-viewport-min-height flex flex-col lg:ml-[var(--shell-offset)]"
        style={{
          ['--shell-offset' as string]: collapsed ? 'var(--sidebar-collapsed)' : 'var(--sidebar-width)',
        }}
      >
        <Topbar
          sidebarCollapsed={collapsed}
          mobileMenuOpen={mobileOpen}
          mobileMenuControlsId="app-sidebar"
          onMobileMenuToggle={() => setMobileOpen(o => !o)}
          alertCount={unreadCount}
          pageTitle={pageTitle}
        />

        {/* Page content. Y6.3B §29 — the 68px topbar offset (`pt-[68px]`)
            and the 1600px content-width cap are shell/layout invariants,
            left untouched across all presets. Page padding IS preset-
            sensitive: `--ui-section-gap`'s Classic value (1.5rem/24px)
            exactly matches the padding this div always had (`p-6`), so
            Classic renders pixel-identical while Compact/Comfortable/
            High Visibility now scale it (Y6.3B §45 spot-check: "AppLayout
            page padding"). */}
        <main className="flex-1 pt-[68px]">
          <div
            className="max-w-[1600px] mx-auto animate-fade-in"
            style={{ padding: 'var(--ui-section-gap)' }}
          >
            <Outlet />
          </div>
        </main>
      </div>

      {/* Z3 — real-time clinical alerts now flow through the global toast
          coordinator (App.tsx's <ToastViewport />) instead of being
          rendered directly here. This bridge only forwards `lastAlert`
          into that coordinator and renders nothing itself. */}
      <AlertToastBridge />
    </div>
  )
}
