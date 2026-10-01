import { AuthProvider }       from '@/context/AuthContext'
import { AppearanceProvider } from '@/context/AppearanceContext'
import { AvatarProvider }     from '@/context/AvatarContext'
import { SocketProvider }     from '@/context/SocketContext'
import { AlertsProvider }     from '@/context/AlertsContext'
import { ToastProvider }      from '@/context/ToastContext'
import { AppRouter }          from '@/router'

// Y6.1 — AppearanceProvider (the "Appearance" naming is kept even though
// theme is currently its only user-configurable axis — Y6.4B §8 — since it
// remains the correct product/domain name and leaves room for a future
// appearance axis without another rename) placed directly inside
// AuthProvider (and outside SocketProvider/AlertsProvider): it needs
// `useAuth()` to know when an authenticated user becomes available, and
// nothing below it needs to know about appearance.
//
// Y3.1B §3 — AvatarProvider inserted the same way, directly inside
// AuthProvider (its only dependency — `useAuth()` — same as
// AppearanceProvider's) and grouped next to it: both are "derived from the
// authenticated user, presentation-only" providers, ahead of the
// realtime-data providers (Socket/Alerts), which are unrelated to either.
// AvatarProvider does not depend on AppearanceContext, SocketContext, or
// AlertsContext, and nothing in those depends on it — the ordering between
// Appearance and Avatar themselves is not load-bearing (neither reads the
// other), this is simply where it's grouped.
//
// Z3 — ToastProvider is the OUTERMOST provider, ahead of AuthProvider:
// the global action-notification API has no auth dependency at all (public
// screens like Login/Register must be able to call it too), so it sits
// above everything else rather than nested inside the authenticated
// subtree.
//
// Z5-FIX2 — <ToastViewport/> (the one single presentation slot for the
// whole app) no longer renders here. It used to be mounted as a sibling of
// <AppRouter/> — i.e. OUTSIDE the Router context AppRouter establishes —
// which is why AlertToast's useNavigate() call crashed the whole
// (ErrorBoundary-less) tree on every clinical alert, tearing down
// SocketProvider along with it (see router.tsx's RootLayout for the full
// explanation and the fix). ToastViewport now renders from inside the
// router tree instead, in a root layout route that wraps every route —
// public and protected alike — so its visibility is unchanged; only WHERE
// it mounts moved. ToastProvider itself stays exactly here, global and
// above AuthProvider, so public screens (Login/Register) can still call
// useActionNotify().
export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AppearanceProvider>
          <AvatarProvider>
            <SocketProvider>
              <AlertsProvider>
                <AppRouter />
              </AlertsProvider>
            </SocketProvider>
          </AvatarProvider>
        </AppearanceProvider>
      </AuthProvider>
    </ToastProvider>
  )
}
