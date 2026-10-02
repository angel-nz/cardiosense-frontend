import { Bell, LogOut, User, ChevronDown, Menu, Loader2, CheckCheck, AlertTriangle, Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useState, useCallback, useEffect, useRef, type KeyboardEvent } from 'react'
import * as RadixDropdown from '@radix-ui/react-dropdown-menu'
import { cn, fullName, userIdentifierLabel, SEVERITY_CONFIG, timeAgo } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { useAlerts } from '@/context/AlertsContext'
import { useActionNotify } from '@/context/ToastContext'
import { alertService } from '@/services/alertService'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { Dialog } from '@/components/ui/Dialog'
import type { Alert } from '@/types'

// PRE-R2D-FIX1 — same 400ms coalescing window already established by
// AlertsContext (ALERTS_CHANGED_COALESCE_MS) and AlertsPage
// (REALTIME_COALESCE_MS) for exactly this kind of realtime-reaction
// debounce. Kept local rather than shared/exported, same precedent as
// those two.
const PREVIEW_COALESCE_MS = 400

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

  // PRE-R2D-FIX1 — unreadCount stays the ONE existing canonical total
  // (AlertsContext's own state, unchanged architecture per §5 of this
  // FIX) — still what both this popover's header text and the
  // `alertCount` prop (sourced identically by AppLayout) represent.
  //
  // The 5 preview rows are now a SEPARATE, authoritative query
  // (alertService.list({unread:true, page:1, limit:5})) rather than a
  // client-side filter/slice of AlertsContext's own general `alerts`
  // array. FIX1's root cause: that array is fetched with a flat limit:50
  // of the newest Alerts overall — when 50+ Alerts exist and the unread
  // ones are older than the 50 newest overall (e.g. a doctor with a long
  // read history plus some older still-unread rows), the "5 newest
  // unread" the product requires are not necessarily inside that
  // client-held 50 at all, silently under- or mis-representing the
  // preview (badge could show unreadCount=8 while the derived preview
  // showed 0). The existing GET /alerts endpoint already supports
  // unread/page/limit (alertService.ts, AlertListParams — audited, no
  // frontend service change needed), so this reuses that contract
  // directly instead of growing the general cache or adding a new
  // endpoint (§2/§3).
  const { unreadCount, markAsRead, markAllRead, applyAlertRead } = useAlerts()
  const { notifyError } = useActionNotify()
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [markingAllRead, setMarkingAllRead] = useState(false)

  // INDIVIDUAL MARK-AS-READ — per-row control state.
  //  - pendingIds (state) drives ONLY that row's control (disabled/spinner).
  //  - pendingRef (ref) is the synchronous duplicate-request guard: a rapid
  //    second click lands before React re-renders `disabled`, so state alone
  //    could not stop it.
  //  - selfAppliedReads offsets the unreadCount-reactive refresh below: a
  //    read this popover itself confirmed is already reflected in its list
  //    (row removed + silent refill), so it must not also trigger the
  //    spinner-and-refetch path that exists for EXTERNAL changes (a new
  //    realtime Alert, mark-all, a canonical refetch).
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set())
  const pendingRef = useRef<Set<string>>(new Set())
  const [selfAppliedReads, setSelfAppliedReads] = useState(0)
  const alertsOpenRef = useRef(false)
  alertsOpenRef.current = alertsOpen
  const contentRef = useRef<HTMLDivElement | null>(null)
  // Index (among the row controls) to re-focus after the activated row has
  // left the list, so keyboard users keep their place — null = do nothing.
  const restoreFocusIndexRef = useRef<number | null>(null)
  const rowControls = () =>
    Array.from(contentRef.current?.querySelectorAll<HTMLButtonElement>('button[data-mark-read]') ?? [])

  const [previewAlerts, setPreviewAlerts] = useState<Alert[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const previewRequestIdRef = useRef(0)
  const previewCoalesceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Latest-request-wins (same pattern as AlertsPage's own requestIdRef):
  // only the response whose id still matches the ref when it resolves is
  // committed. This is what makes the mark-all race below safe — an
  // earlier, pre-confirmation fetch can never clobber a later,
  // post-confirmation one, regardless of which network response actually
  // arrives first.
  //
  // `silent` (individual mark-as-read only): refresh the list IN PLACE —
  // no spinner, and a failure keeps the rows already on screen instead of
  // replacing them with an error (they are still valid; only the refill of
  // the freed slot is missed, and the next open/realtime refresh recovers
  // it). Same latest-request-wins guard, so a silent result can never
  // overwrite a newer one nor be committed after a newer request began.
  const fetchPreview = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    const requestId = ++previewRequestIdRef.current
    if (!silent) {
      setPreviewLoading(true)
      setPreviewError(null)
    }
    try {
      const result = await alertService.list({ unread: true, page: 1, limit: 5 })
      if (requestId !== previewRequestIdRef.current) return
      setPreviewAlerts(result.data)
      setPreviewError(null)
      setPreviewLoading(false)
    } catch {
      if (requestId !== previewRequestIdRef.current) return
      if (silent) return
      setPreviewError('No se pudieron cargar las alertas')
      setPreviewLoading(false)
    }
  }, [])

  // Authoritative refresh triggers, both gated on the popover actually
  // being open (never polls/fetches in the background):
  //  - `alertsOpen` flipping true — the popover was just opened.
  //  - `externalUnreadCount` changing while already open (unreadCount minus
  //    this popover's own confirmed individual reads, see selfAppliedReads)
  //    — a new persisted Alert
  //    arrived via realtime (new_alert/alerts_changed, both already
  //    reconciled upstream by AlertsContext before unreadCount changes,
  //    so the underlying row genuinely exists server-side by then — no
  //    race on that path).
  // Debounced by the same 400ms window AlertsContext/AlertsPage already
  // use for realtime reconciliation, so a burst of arrivals collapses
  // into one request rather than one per event. The loading flag is set
  // synchronously (outside the debounce) so the popover shows a spinner
  // instead of briefly rendering stale rows while a refresh is pending.
  const externalUnreadCount = unreadCount + selfAppliedReads
  useEffect(() => {
    if (!alertsOpen) return
    setPreviewLoading(true)
    setPreviewError(null)
    if (previewCoalesceRef.current) clearTimeout(previewCoalesceRef.current)
    previewCoalesceRef.current = setTimeout(() => {
      previewCoalesceRef.current = null
      fetchPreview()
    }, PREVIEW_COALESCE_MS)
    return () => {
      if (previewCoalesceRef.current) {
        clearTimeout(previewCoalesceRef.current)
        previewCoalesceRef.current = null
      }
    }
  }, [alertsOpen, externalUnreadCount, fetchPreview])

  useEffect(() => {
    const idx = restoreFocusIndexRef.current
    if (idx === null) return
    restoreFocusIndexRef.current = null
    const controls = rowControls()
    const target = controls[Math.min(idx, controls.length - 1)] ?? contentRef.current
    target?.focus()
  }, [previewAlerts])

  const handleMarkAllRead = async () => {
    if (markingAllRead || pendingRef.current.size > 0) return
    setMarkingAllRead(true)
    try {
      // §8 — reuses the existing canonical bulk operation (AlertsContext's
      // markAllRead → PATCH /alerts/read-all); no client-side per-Alert
      // loop. On success, AlertsContext's own state refreshes
      // unreadCount — this popover and AlertsPage both re-render from
      // that same source, no reload needed anywhere.
      await markAllRead()
    } catch {
      // §8 — "do not show success if backend operation failed": on
      // failure, AlertsContext has already rolled back its optimistic
      // unreadCount update, so the explicit fetchPreview() below simply
      // reconfirms the real (unchanged) server state rather than
      // pretending success. AlertsPage's own handleMarkAllRead already
      // surfaces this same failure via the global action-notification
      // toast when the doctor is on that page; Topbar doesn't duplicate
      // that toast call here to avoid coupling this shared layout chrome
      // to ToastContext for a single edge case.
    } finally {
      setMarkingAllRead(false)
      // FIX1 — explicit, deterministic re-fetch AFTER the mutation's own
      // promise has settled (success or failure), rather than relying
      // solely on the `unreadCount`-reactive effect above. That effect's
      // optimistic `unreadCount` update fires the instant AlertsContext
      // sets it — before this `await markAllRead()` necessarily reaches
      // the server — so a fetch triggered by it alone could race ahead of
      // the real PATCH /alerts/read-all and read stale still-unread rows,
      // with nothing left to correct it afterward (unreadCount doesn't
      // change again). This call's requestId is always issued after that
      // reactive one's, so the latest-wins guard in fetchPreview()
      // guarantees THIS authoritative, post-confirmation result is what
      // ends up committed.
      if (alertsOpen) fetchPreview()
    }
  }

  // §7 — replicates AlertsPage's own exact row-click contract verbatim
  // (AlertsPage.tsx: `handleMarkAsRead(alert.id); if (alert.patientId)
  // navigate(...)`) rather than inventing new interaction semantics. This
  // always closes the popover and (when patientId is present) navigates
  // away, so there is no visible preview left to reconcile in place — the
  // next time the popover opens, the `alertsOpen`-triggered effect above
  // re-fetches the authoritative five, which is what FIX1 §9's
  // "sixth fills the fifth position" property actually requires.
  const handleAlertRowClick = (alert: Alert) => {
    // If this Alert's own control request is still in flight, that request
    // is already marking it — firing the optimistic path as well would
    // decrement the shared counter twice.
    if (!pendingRef.current.has(alert.id)) {
      markAsRead(alert.id).catch(() => {
        // Same non-blocking-failure posture as above — the context has
        // already rolled back optimistic state on failure.
      })
    }
    setAlertsOpen(false)
    if (alert.patientId) navigate(`/patients/${alert.patientId}`)
  }

  // INDIVIDUAL MARK-AS-READ — the row's own icon control. Marks ONLY this
  // Alert as read through the existing PATCH /alerts/:id/read
  // (alertService.markRead), REQUEST-FIRST: nothing local changes until the
  // backend has confirmed read=true, so a failure needs no rollback and can
  // never leave a fake "read" state behind.
  //
  // On success, in ONE synchronous block (so React commits it together):
  //  1. the shared counter/cache is updated (applyAlertRead),
  //  2. the row leaves the preview list,
  //  3. the offset below absorbs the counter change so the unreadCount-
  //     reactive effect does NOT flash the spinner for it,
  //  4. a silent refetch is issued — it refills the freed slot with the
  //     next-oldest unread Alert (the list is "the 5 most recent unread",
  //     so an older unread one legitimately enters the window) and, being
  //     the newest request, supersedes any older in-flight preview fetch.
  // The popover stays open; nothing navigates.
  const handleMarkOneRead = async (alert: Alert, control: HTMLElement) => {
    const id = alert.id
    if (markingAllRead || pendingRef.current.has(id)) return
    pendingRef.current.add(id)
    setPendingIds(new Set(pendingRef.current))
    try {
      await alertService.markRead(id)
      // Keyboard continuity: the activated row is about to leave the list.
      // Only if focus is still on its control (the user did not move on
      // while the request was in flight) remember its position so focus can
      // land on the row that takes its place instead of being dropped to
      // <body>.
      if (alertsOpenRef.current && document.activeElement === control) {
        const idx = rowControls().indexOf(control as HTMLButtonElement)
        restoreFocusIndexRef.current = idx >= 0 ? idx : null
      }
      const decremented = applyAlertRead(id)
      if (decremented) setSelfAppliedReads(n => n + 1)
      setPreviewAlerts(prev => prev.filter(a => a.id !== id))
      if (alertsOpenRef.current) fetchPreview({ silent: true })
    } catch {
      // The Alert stays unread and visible; counter untouched. Same global
      // action-notification convention AlertsPage uses for this failure.
      notifyError('No se pudo marcar la alerta como leída. Intenta de nuevo.')
      // Reconcile in place in case the failure reflects server truth (e.g.
      // the Alert was removed/hidden meanwhile). A failed refetch changes
      // nothing on screen.
      if (alertsOpenRef.current) fetchPreview({ silent: true })
    } finally {
      pendingRef.current.delete(id)
      setPendingIds(new Set(pendingRef.current))
    }
  }

  // KEYBOARD — Radix's DropdownMenu content swallows Tab
  // (event.preventDefault() in its own keydown handler, because it expects
  // its children to be roving-focus menu items), and this popover's
  // controls are plain buttons, not menu items — so before this, NO control
  // inside it (rows, mark-all, settings, footer, the new per-row control)
  // could be reached with the keyboard at all. Handling Tab here, and
  // calling preventDefault ourselves, both moves focus across the real
  // buttons in DOM order (wrapping, Shift+Tab reverses — the same loop the
  // modal focus trap implies) and, because Radix composes its handler
  // after ours with checkForDefaultPrevented, makes it skip its own Tab
  // branch. Controls that are only aria-disabled (the pending per-row
  // control) stay in the sequence on purpose so focus is never dropped.
  // Every other key (Escape, Enter/Space on a focused button, arrows,
  // typeahead) is left entirely to the browser/Radix as before.
  const handlePopoverKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return
    const focusable = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)'))
    if (focusable.length === 0) return
    e.preventDefault()
    const i = focusable.indexOf(document.activeElement as HTMLElement)
    const next = e.shiftKey
      ? (i <= 0 ? focusable.length - 1 : i - 1)
      : (i < 0 || i === focusable.length - 1 ? 0 : i + 1)
    focusable[next].focus()
  }

  // §10 — reuses the EXACT existing DashboardStatNavigationIntent
  // convention (types/index.ts; consumed by AlertsPage.tsx's own
  // readAlertsStatNav/location.state effect) — confirmed by audit to be
  // the ONLY existing mechanism for "open Alerts pre-filtered to unread"
  // (AlertsPage has no URL-query-based filter at all). Not a new
  // `?status=unread` convention.
  const handleViewAllUnread = () => {
    setAlertsOpen(false)
    navigate('/alerts', { state: { dashboardStatNav: { kind: 'ALERTS_UNREAD' } } })
  }

  // PRE-R2D-FIX2 — settings shortcut. Confirmed from source
  // (SettingsLayout.tsx's SETTINGS_NAV array): the "Alertas" section inside
  // Configuración is a real, directly-addressable nested route,
  // `/settings/notifications` (the route segment is still `notifications`
  // from before this Alerts-popover work; `label: 'Alertas'` is what's
  // actually shown in the Settings nav — confirmed, not assumed, since
  // `/settings/alerts` does not exist anywhere in router.tsx). The active
  // section is derived purely from the URL via NavLink (SettingsLayout's
  // own comment: "no local activeTab state anywhere... the active section
  // is derived entirely from the current URL"), so navigating straight to
  // this path is the complete, correct contract — no extra state/query
  // needed. Never touches unread state — this is pure navigation.
  const handleOpenAlertSettings = () => {
    setAlertsOpen(false)
    navigate('/settings/notifications')
  }

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
        {/* PRE-R2D — Topbar persisted-alerts popover. Built on
            @radix-ui/react-dropdown-menu's Root/Trigger/Portal/Content
            (already installed, previously unused anywhere — avoids adding
            the not-installed @radix-ui/react-popover as a new dependency)
            purely for its accessible open/close mechanics (keyboard
            Enter/Space open, Escape close, outside-click/focus-trap,
            aria-expanded on the trigger) — mirrors how Dialog.tsx already
            wraps a Radix primitive in this codebase. Content below is
            fully custom (plain buttons, not DropdownMenu.Item), so each
            action controls close-on-click explicitly via `alertsOpen`
            rather than Radix's default "any selection closes the menu"
            Item behavior — e.g. "Marcar todas como leídas" deliberately
            does NOT close the popover (§8 — the doctor should see the
            list/badge update in place), while a row click or the footer
            link does (§7/§10 — both navigate away). */}
        <RadixDropdown.Root open={alertsOpen} onOpenChange={setAlertsOpen}>
          <RadixDropdown.Trigger asChild>
            {/* Y6.3B-FIX1 §8: p-2.5 (10px, all sides) matches
                --ui-control-padding-y's Classic value exactly, so this is a
                direct, non-outlier reuse, again via inline style for
                uniform 4-side padding. */}
            <button
              className="relative rounded-lg hover:bg-accent transition-colors"
              style={{ padding: 'var(--ui-control-padding-y)' }}
              aria-label="Ver alertas"
            >
              <Bell className="w-5 h-5 text-muted-foreground" />
              {alertCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-background animate-pulse-ring" />
              )}
            </button>
          </RadixDropdown.Trigger>
          <RadixDropdown.Portal>
            {/* PRE-R2D-FIX4 — correcting the ACTUAL positioned node.
                FIX2/FIX3 both targeted `RadixDropdown.Content` itself and
                were runtime-DISPROVEN (Angel: FIX3 produced "no visible
                improvement" at all over FIX2 — the geometry was unchanged).
                That result only makes sense if Content was never the node
                responsible for the drift — confirmed by reading the
                INSTALLED @radix-ui/react-popper source directly (not
                documentation): `PopperContent` (node_modules/@radix-ui/
                react-popper/dist/index.mjs) renders an UNDOCUMENTED extra
                DOM layer around whatever `DropdownMenu.Content` renders:

                  div[data-radix-popper-content-wrapper]
                    style = ...floatingStyles, transform, minWidth: "max-content"
                    -> Primitive.div (this is our actual Content, nested one level in)

                `floatingStyles` comes from `useFloating({ strategy: "fixed" })`
                (@floating-ui/react-dom) and resolves to `position: fixed;
                top: 0; left: 0; transform: translate(Xpx, Ypx)` — X/Y
                computed from real `getBoundingClientRect()` reads (already-
                correct physical pixels), THEN WRITTEN ONTO THIS WRAPPER, not
                onto the `Primitive.div` our own `className`/`style` props
                land on. The wrapper is a plain descendant of the zoomed
                `html` (index.css: zoom at the root deliberately includes
                "anything portaled to document.body"), so ITS transform is
                what gets re-multiplied by `--ui-zoom` a second time at
                paint — identical in kind to the `vh`-under-zoom bug
                (index.css) and to Sidebar.tsx's CollapsedTooltip (same
                getBoundingClientRect-under-zoom bug on its own
                document.body portal, fixed there by dividing the
                measured value by the current zoom factor before
                assigning it). Every previous attempt edited the INNER
                `Primitive.div` two layers below the actual transform —
                explaining, precisely, why none of it ever visibly moved
                the popover: the wrapper's own double-scaled transform was
                never touched.

                Fix: cancel zoom on the WRAPPER, not Content. Radix gives
                no prop/ref onto that generated wrapper, so it's targeted
                with a plain CSS rule in index.css, scoped via `:has()` to
                a marker THIS Content alone carries (`data-alerts-popover`,
                added below) — never a blind, app-wide
                `[data-radix-popper-content-wrapper]` rule (§9): see
                index.css for
                  [data-radix-popper-content-wrapper]:has([data-alerts-popover])
                  { zoom: calc(1 / var(--ui-zoom, 1)); }
                This cancels the wrapper's effective zoom to exactly 1 (at
                Original, --ui-zoom:1, this is `1/1` — a byte-equivalent
                no-op, so Original is untouched), so its own `transform`
                is no longer re-scaled — fixing BOTH X and Y with the same
                one declaration (§12), since translate's two components are
                subject to the identical rule.

                Because the wrapper's effective zoom is now 1, Content
                (its plain child, no zoom of its own previously) would
                inherit that 1 and stop scaling with Interface Size — so
                Content now explicitly re-applies `zoom: var(--ui-zoom, 1)`
                itself (restoring exactly the ambient density every other
                normal UI element already has, §14). This also means
                Content is back to being the ONE single visual node again
                (FIX2/FIX3's extra "inner presentation wrapper" div is
                removed — no longer needed once the correction lives on
                the real positioned node instead of being faked via nested
                opposing zoom here).

                Width: with Content's own effective zoom restored to
                `--ui-zoom`, a PLAIN rem-based `max-width` (24rem) now
                scales correctly and automatically with Interface Size —
                no special treatment needed, exactly like Dialog's own
                `max-w-lg`. Only the VIEWPORT-relative mobile clamp needs
                the established `vw`-under-zoom correction already proven
                in this file (Sidebar's own FIX4: dividing just the `vw`
                term by `--ui-zoom`, leaving the plain rem margin alone) —
                reused verbatim here, not re-derived: `calc((100vw /
                var(--ui-zoom, 1)) - 2rem)`, capped by `max-width: 24rem`,
                reproducing the original `w-[calc(100vw-2rem)] max-w-sm`
                pair exactly (and making the redundant `sm:w-96` — already
                provably a no-op against that same `max-width`, see FIX3 —
                unnecessary). `align`/`sideOffset`/`collisionPadding` stay
                unchanged (§10) — still never an alignment-configuration
                problem, and floating-ui's collision math compares against
                the real, zoom-unaffected viewport either way (§15). */}
            <RadixDropdown.Content
              ref={contentRef}
              onKeyDown={handlePopoverKeyDown}
              align="end"
              sideOffset={8}
              collisionPadding={12}
              data-alerts-popover=""
              className={cn(
                'z-50 bg-popover rounded-xl border border-border shadow-lg',
                'overflow-hidden animate-fade-in',
              )}
              style={{
                zoom: 'var(--ui-zoom, 1)',
                width: 'calc((100vw / var(--ui-zoom, 1)) - 2rem)',
                maxWidth: '24rem',
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">Alertas</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {unreadCount > 0 ? `${unreadCount} sin leer` : 'Todo al día'}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllRead}
                      disabled={markingAllRead || pendingIds.size > 0}
                      className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {markingAllRead ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCheck className="w-3.5 h-3.5" />
                      )}
                      Marcar todas como leídas
                    </button>
                  )}
                  {/* PRE-R2D-FIX2 §3/§4/§5 — settings shortcut. Pure
                      navigation: never marks anything read, never changes
                      unread state. Visually subordinate to the primary
                      mark-all action (icon-only, muted color), with its
                      own accessible name since it renders no visible
                      text. */}
                  <button
                    onClick={handleOpenAlertSettings}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
                    aria-label="Configurar alertas"
                    title="Configurar alertas"
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Body — up to 5 most recent unread Alerts, from the
                  authoritative unread=true&limit=5 query (§4/§5/§6) */}
              <div className="max-h-80 overflow-y-auto">
                {previewLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 text-primary animate-spin" />
                  </div>
                ) : previewError ? (
                  // §14 — a failed request is never shown as "zero unread".
                  <div className="px-4 py-6 text-center">
                    <p className="text-sm text-muted-foreground">{previewError}</p>
                  </div>
                ) : previewAlerts.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <Bell className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No tienes alertas sin leer.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {previewAlerts.map(alert => {
                      const cfg = SEVERITY_CONFIG[alert.severity]
                      const pending = pendingIds.has(alert.id)
                      return (
                        // INDIVIDUAL MARK-AS-READ — the control is a SIBLING of
                        // the row button, absolutely positioned over its
                        // reserved right gutter (pr-12), never nested inside
                        // it (a <button> in a <button> is invalid HTML and
                        // would make the click/keyboard target ambiguous).
                        // Being a sibling, its click can never reach the row's
                        // onClick; the row button still spans the full width,
                        // so a click anywhere else on the row behaves exactly
                        // as before. Fixed size + absolute position: the
                        // pending spinner swaps the glyph only — no layout
                        // jump, and the popover width is unchanged.
                        <div key={alert.id} className="relative hover:bg-accent/50 transition-colors">
                          <button
                            type="button"
                            onClick={() => handleAlertRowClick(alert)}
                            className="w-full flex items-start gap-3 pl-4 pr-12 py-3 text-left"
                          >
                            <span className={cn('w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0', cfg.bg, cfg.border)}>
                              <AlertTriangle className={cn('w-3.5 h-3.5', cfg.text)} />
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className={cn('block text-xs font-bold uppercase tracking-wide', cfg.text)}>
                                {cfg.label}
                              </span>
                              <span className="block text-sm font-medium text-foreground mt-0.5 truncate">
                                {alert.patientName || 'Notificación general'}
                              </span>
                              <span className="block text-sm text-muted-foreground mt-0.5 line-clamp-2">
                                {alert.message}
                              </span>
                              <span className="block text-xs text-muted-foreground mt-1">
                                {timeAgo(alert.createdAt)}
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); handleMarkOneRead(alert, e.currentTarget) }}
                            // aria-disabled, NOT the disabled attribute: a
                            // focused <button> that becomes disabled loses
                            // focus (to <body>), which would strand a
                            // keyboard user mid-popover. The handler itself
                            // ignores activation while pending.
                            aria-disabled={pending || markingAllRead || undefined}
                            data-mark-read=""
                            aria-label="Marcar alerta como leída"
                            aria-busy={pending || undefined}
                            title="Marcar como leída"
                            className={cn(
                              'absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-lg',
                              'text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                              'aria-disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground',
                            )}
                          >
                            {pending ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <CheckCheck className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Footer — §10 */}
              <div className="border-t border-border">
                <button
                  onClick={handleViewAllUnread}
                  className="w-full px-4 py-3 text-sm font-medium text-primary hover:bg-accent transition-colors text-center"
                >
                  Ver todas las alertas no leídas
                </button>
              </div>
            </RadixDropdown.Content>
          </RadixDropdown.Portal>
        </RadixDropdown.Root>

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
