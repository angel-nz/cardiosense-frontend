import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { cn } from '@/lib/utils'
import { AlertToast } from '@/components/alerts/AlertToast'
import { useSocket } from '@/context/SocketContext'
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
  const { lastAlert, clearLastAlert } = useSocket()
  const { unreadCount } = useAlerts()

  const pageTitle = Object.entries(PAGE_TITLES).find(([path]) =>
    location.pathname.startsWith(path)
  )?.[1] ?? ''

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  return (
    <div className="min-h-screen bg-background">
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
      <div
        className="transition-all duration-300 min-h-screen flex flex-col"
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

        {/* Page content */}
        <main className="flex-1 pt-[68px]">
          <div className="p-6 max-w-[1600px] mx-auto animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Real-time alert toast */}
      {lastAlert && (
        <AlertToast alert={lastAlert} onClose={clearLastAlert} />
      )}
    </div>
  )
}
