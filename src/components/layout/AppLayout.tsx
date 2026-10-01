import { useState, useEffect } from 'react'
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

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const { unreadCount } = useAlerts()

  const pageTitle = Object.entries(PAGE_TITLES).find(([path]) =>
    location.pathname.startsWith(path)
  )?.[1] ?? ''

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

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
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={cn('lg:block', mobileOpen ? 'block' : 'hidden lg:block')}>
        <Sidebar
          collapsed={collapsed}
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
        className="transition-all duration-300 ui-viewport-min-height flex flex-col"
        style={{
          marginLeft: collapsed ? 'var(--sidebar-collapsed)' : 'var(--sidebar-width)',
        }}
      >
        <Topbar
          sidebarCollapsed={collapsed}
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
