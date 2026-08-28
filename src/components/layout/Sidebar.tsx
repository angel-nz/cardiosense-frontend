import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  Activity,
  Bell,
  Settings,
  Heart,
  ChevronLeft,
  ChevronRight,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { cn, initials, fullName } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { useSocket } from '@/context/SocketContext'

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

export function Sidebar({ collapsed, onToggle, alertCount = 0 }: SidebarProps) {
  const { user } = useAuth()
  const { connected } = useSocket()
  const location = useLocation()

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
      <div className="flex items-center gap-3 px-4 py-5 border-b border-white/10 min-h-[68px]">
        <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-red-500/20 border border-red-400/30 flex items-center justify-center">
          <Heart className="w-5 h-5 text-red-400 fill-red-400/30" />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <p className="text-white font-bold text-base leading-none tracking-tight">
              CardioSense
            </p>
            <p className="text-white/40 text-xs mt-0.5">Sistema Cardiovascular</p>
          </div>
        )}
      </div>

      {/* ─── Primary Nav ───────────────────────────────────────────────── */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {!collapsed && (
          <p className="text-white/30 text-[10px] font-semibold uppercase tracking-widest px-3 mb-3">
            Principal
          </p>
        )}

        {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
          const isAlerts = to === '/alerts'
          const isActive = location.pathname.startsWith(to)

          return (
            <NavLink key={to} to={to}>
              <div
                className={cn(
                  'sidebar-nav-item group relative',
                  isActive && 'active',
                  collapsed && 'justify-center px-0',
                )}
              >
                <div className="relative flex-shrink-0">
                  <Icon className="w-5 h-5" />
                  {isAlerts && alertCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full text-white text-[9px] font-bold flex items-center justify-center">
                      {alertCount > 9 ? '9+' : alertCount}
                    </span>
                  )}
                </div>
                {!collapsed && <span className="truncate">{label}</span>}
                {!collapsed && isAlerts && alertCount > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    {alertCount}
                  </span>
                )}
                {/* Tooltip on collapsed */}
                {collapsed && (
                  <div className="absolute left-full ml-3 px-2 py-1 bg-gray-900 text-white text-xs rounded-md opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 shadow-lg">
                    {label}
                    {isAlerts && alertCount > 0 && (
                      <span className="ml-1 bg-red-500 px-1 rounded-sm">{alertCount}</span>
                    )}
                  </div>
                )}
              </div>
            </NavLink>
          )
        })}
      </nav>

      {/* ─── Bottom Section ────────────────────────────────────────────── */}
      <div className="px-3 py-4 border-t border-white/10 space-y-1">
        {BOTTOM_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to}>
            <div
              className={cn(
                'sidebar-nav-item group relative',
                location.pathname.startsWith(to) && 'active',
                collapsed && 'justify-center px-0',
              )}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
              {collapsed && (
                <div className="absolute left-full ml-3 px-2 py-1 bg-gray-900 text-white text-xs rounded-md opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 shadow-lg">
                  {label}
                </div>
              )}
            </div>
          </NavLink>
        ))}

        {/* Connection status */}
        <div
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-lg mt-1',
            collapsed && 'justify-center px-0',
          )}
        >
          {connected ? (
            <Wifi className="w-3.5 h-3.5 text-teal-400 flex-shrink-0" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-white/30 flex-shrink-0" />
          )}
          {!collapsed && (
            <span className={cn('text-xs', connected ? 'text-teal-400' : 'text-white/30')}>
              {connected ? 'Tiempo real activo' : 'Sin conexión'}
            </span>
          )}
        </div>

        {/* User profile */}
        <div
          className={cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-lg mt-1 cursor-pointer hover:bg-white/5 transition-colors',
            collapsed && 'justify-center px-0',
          )}
        >
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {user ? initials(user.firstName, user.lastName) : 'DR'}
          </div>
          {!collapsed && user && (
            <div className="overflow-hidden">
              <p className="text-white text-xs font-medium truncate leading-none">
                Dr. {user.firstName}
              </p>
              <p className="text-white/40 text-[10px] truncate mt-0.5">{user.email}</p>
            </div>
          )}
        </div>
      </div>

      {/* ─── Collapse Toggle ───────────────────────────────────────────── */}
      <button
        onClick={onToggle}
        className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-white border border-border shadow-sm flex items-center justify-center hover:bg-gray-50 transition-colors z-40"
        aria-label={collapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
      >
        {collapsed ? (
          <ChevronRight className="w-3 h-3 text-gray-500" />
        ) : (
          <ChevronLeft className="w-3 h-3 text-gray-500" />
        )}
      </button>
    </aside>
  )
}
