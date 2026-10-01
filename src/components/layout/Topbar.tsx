import { Bell, LogOut, User, ChevronDown, Menu, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { cn, fullName, userIdentifierLabel } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { Dialog } from '@/components/ui/Dialog'

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

  // PRE-Y8 (Settings Interaction Policy Refinement §21/§22) — closing the
  // CURRENT session is a CONFIRMED account action: clicking "Cerrar sesión"
  // no longer logs out directly, it opens this confirmation dialog first.
  // Cancelling leaves the session untouched — no logout request, no token
  // cleanup (§21). AuthContext's own logout() is still the one and only
  // place that clears local state/broadcasts cross-tab logout (Y5.2) — this
  // just gates WHEN it's called, it doesn't reimplement any of it.
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const handleConfirmLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await logout()
    } finally {
      setLoggingOut(false)
      setConfirmLogoutOpen(false)
      navigate('/login')
    }
  }

  return (
    <>
    <header
      className={cn(
        // Y6.3B-FIX1 §8 — height stays the frozen invariant (h-[68px]);
        // gap-4 (icon/title/actions rhythm) is horizontal-only and matches
        // --ui-element-gap's own Classic value exactly, so it safely
        // participates without any risk to the fixed shell height.
        'fixed top-0 right-0 z-20 h-[68px] flex items-center ui-element-gap px-6',
        'bg-background/80 backdrop-blur-md border-b border-border',
        'transition-all duration-300',
      )}
      style={{
        left: sidebarCollapsed ? 'var(--sidebar-collapsed)' : 'var(--sidebar-width)',
      }}
    >
      {/* Mobile menu toggle — Y6.3B-FIX1 §8: p-2 (8px) is "safe internal
          control sizing within the fixed height" (§8) — matches the same
          calc(--ui-control-padding-y - 2px) role used for compact controls
          elsewhere, applied here via inline style since it needs uniform
          padding on all 4 sides for a square icon button, not just Y. */}
      <button
        className="lg:hidden rounded-lg hover:bg-accent transition-colors"
        style={{ padding: 'calc(var(--ui-control-padding-y) - 0.125rem)' }}
        onClick={onMobileMenuToggle}
      >
        <Menu className="w-5 h-5 text-muted-foreground" />
      </button>

      {/* Page title — Y6.3B-FIX1 §8: deliberately left as an intentional
          invariant. It's a single-line item vertically centered inside the
          frozen 68px shell; with no browser available in this sandbox to
          visually confirm continued centering/no-overflow at a larger
          size, and given the page's own <h1> already restates this same
          title in the body content (already preset-aware via
          .ui-heading-page), the safer call is to leave this supplementary
          header echo untouched rather than risk an unverifiable overflow
          against the frozen shell height (§8: "do NOT break the shell"). */}
      {pageTitle && (
        <h1 className="text-lg font-semibold text-foreground hidden sm:block">{pageTitle}</h1>
      )}

      <div className="ml-auto flex items-center gap-2">
        {/* Alert bell — Y6.3B-FIX1 §8: p-2.5 (10px, all sides) matches
            --ui-control-padding-y's Classic value exactly, so this is a
            direct, non-outlier reuse, again via inline style for uniform
            4-side padding. */}
        <button
          onClick={() => navigate('/alerts')}
          className="relative rounded-lg hover:bg-accent transition-colors"
          style={{ padding: 'var(--ui-control-padding-y)' }}
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
              // Y6.3B-FIX1 §8 — py-2 (8px) is the same widely-used compact
              // control height already tokenized elsewhere in this block.
              'flex items-center gap-2.5 px-3 ui-compact-control-density rounded-lg',
              'hover:bg-accent transition-colors',
              dropdownOpen && 'bg-accent',
            )}
          >
            {/* Y3.1B §28/§34 — same shared UserAvatar as Sidebar, same
                32×32 footprint. Decorative (no alt): the dropdown trigger
                already renders the doctor's name as text right next to it. */}
            {user ? (
              <UserAvatar firstName={user.firstName} lastName={user.lastName} size="sm" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
                DR
              </div>
            )}
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
                    {/* Z6-R1 — a phone-only doctor has no email; falls back
                        to phone rather than rendering nothing/"null". */}
                    <p className="text-xs text-muted-foreground mt-0.5">{userIdentifierLabel(user)}</p>
                  </div>
                )}
                <button
                  onClick={() => { setDropdownOpen(false); navigate('/settings/profile') }}
                  className="w-full flex items-center gap-3 px-4 ui-control-density text-sm text-foreground hover:bg-accent transition-colors"
                >
                  <User className="w-4 h-4 text-muted-foreground" />
                  Mi perfil
                </button>
                <div className="border-t border-border mt-1 pt-1">
                  <button
                    onClick={() => { setDropdownOpen(false); setConfirmLogoutOpen(true) }}
                    className="w-full flex items-center gap-3 px-4 ui-control-density text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/60 transition-colors"
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

    {/* §21/§22 — current-session logout confirmation. Reuses the app's
        shared Dialog component, same as SecuritySettings' session dialogs;
        confirm uses the same destructive red treatment already established
        for closing a session there, since this is the same kind of action. */}
    <Dialog
      open={confirmLogoutOpen}
      onOpenChange={open => { if (!open) setConfirmLogoutOpen(false) }}
      title="Cerrar sesión"
      description="¿Deseas cerrar tu sesión actual?"
      preventClose={loggingOut}
    >
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={() => setConfirmLogoutOpen(false)}
          disabled={loggingOut}
          className="px-3 ui-secondary-control-density text-sm font-medium rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleConfirmLogout}
          disabled={loggingOut}
          className="flex items-center gap-2 px-3 ui-secondary-control-density text-sm font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loggingOut && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Cerrar sesión
        </button>
      </div>
    </Dialog>
    </>
  )
}
