import { Bell, LogOut, User, ChevronDown, Menu } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { cn, fullName, initials } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'

interface TopbarProps {
  sidebarCollapsed: boolean
  onMobileMenuToggle: () => void
  alertCount?: number
  pageTitle?: string
}

export function Topbar({ sidebarCollapsed, onMobileMenuToggle, alertCount = 0, pageTitle }: TopbarProps) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <header
      className={cn(
        'fixed top-0 right-0 z-20 h-[68px] flex items-center gap-4 px-6',
        'bg-background/80 backdrop-blur-md border-b border-border',
        'transition-all duration-300',
      )}
      style={{
        left: sidebarCollapsed ? 'var(--sidebar-collapsed)' : 'var(--sidebar-width)',
      }}
    >
      {/* Mobile menu toggle */}
      <button
        className="lg:hidden p-2 rounded-lg hover:bg-accent transition-colors"
        onClick={onMobileMenuToggle}
      >
        <Menu className="w-5 h-5 text-muted-foreground" />
      </button>

      {/* Page title */}
      {pageTitle && (
        <h1 className="text-lg font-semibold text-foreground hidden sm:block">{pageTitle}</h1>
      )}

      <div className="ml-auto flex items-center gap-2">
        {/* Alert bell */}
        <button
          onClick={() => navigate('/alerts')}
          className="relative p-2.5 rounded-lg hover:bg-accent transition-colors"
          aria-label="Ver alertas"
        >
          <Bell className="w-5 h-5 text-muted-foreground" />
          {alertCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-background animate-pulse-ring" />
          )}
        </button>

        {/* Divider */}
        <div className="w-px h-6 bg-border mx-1" />

        {/* User dropdown */}
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(o => !o)}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-lg',
              'hover:bg-accent transition-colors',
              dropdownOpen && 'bg-accent',
            )}
          >
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
              {user ? initials(user.firstName, user.lastName) : 'DR'}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-sm font-medium text-foreground leading-none">
                {user ? `Dr. ${user.firstName}` : 'Doctor'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Médico</p>
            </div>
            <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', dropdownOpen && 'rotate-180')} />
          </button>

          {dropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setDropdownOpen(false)}
              />
              <div className={cn(
                'absolute right-0 top-full mt-2 w-56 z-40',
                'bg-popover rounded-xl border border-border shadow-lg',
                'py-1 animate-fade-in',
              )}>
                {user && (
                  <div className="px-4 py-3 border-b border-border">
                    <p className="text-sm font-semibold text-foreground">{fullName(user.firstName, user.lastName)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{user.email}</p>
                  </div>
                )}
                <button
                  onClick={() => { setDropdownOpen(false); navigate('/settings') }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-accent transition-colors"
                >
                  <User className="w-4 h-4 text-muted-foreground" />
                  Mi perfil
                </button>
                <div className="border-t border-border mt-1 pt-1">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Cerrar sesión
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
