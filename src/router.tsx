import { createBrowserRouter, RouterProvider, Navigate, Outlet } from 'react-router-dom'

import { AppLayout }          from '@/components/layout/AppLayout'
import { ProtectedRoute }     from '@/components/layout/ProtectedRoute'
import { PublicRoute }        from '@/components/layout/PublicRoute'
import { ToastViewport }      from '@/components/toast/ToastViewport'

import LoginPage              from '@/pages/LoginPage'
import RegisterPage           from '@/pages/RegisterPage'
import NotFoundPage           from '@/pages/NotFoundPage'
import DashboardPage          from '@/pages/Dashboard/DashboardPage'
import PatientsPage           from '@/pages/Patients/PatientsPage'
import PatientDetailPage      from '@/pages/Patients/PatientDetailPage'
import PatientCreatePage      from '@/pages/Patients/PatientCreatePage'
import PredictionsPage        from '@/pages/Predictions/PredictionsPage'
import AlertsPage             from '@/pages/Alerts/AlertsPage'
import SettingsLayout         from '@/pages/Settings/SettingsLayout'
import ProfileSettings        from '@/pages/Settings/ProfileSettings'
import NotificationSettings   from '@/pages/Settings/NotificationSettings'
import SecuritySettings       from '@/pages/Settings/SecuritySettings'
import AppearanceSettings     from '@/pages/Settings/AppearanceSettings'
import PatientVisibilitySettings from '@/pages/Settings/PatientVisibilitySettings'

// Z5-FIX2 (Router Context / AlertToast crash) — root-level layout route.
// Root cause: <ToastViewport/> (which renders <AlertToast/>, and AlertToast
// calls react-router-dom's useNavigate()) used to be mounted in App.tsx as a
// sibling of <AppRouter/> — i.e. OUTSIDE the <RouterProvider/> this file
// creates. useNavigate() throws when called outside Router context; with no
// ErrorBoundary anywhere in this app, that throw unmounted the ENTIRE React
// tree, which is what actually tore down SocketProvider (its cleanup calling
// socket.disconnect()) and surfaced as the previously-reported "client
// namespace disconnect" — a React tree crash, not a Socket.IO bug.
//
// Fix: give the router a single root route, rendered above BOTH the public
// and protected branches (and the 404 route), whose element renders
// <Outlet/> (so routing is completely unaffected) plus <ToastViewport/> as a
// sibling. That makes ToastViewport a Router DESCENDANT — same visibility
// (every route, public and protected, same as before) but now inside
// RouterProvider's context, so AlertToast's useNavigate() call is valid.
// ToastProvider itself is untouched and stays in App.tsx, still global and
// still outside/above the router — only this presentation component moved.
// This does not add a second Router: createBrowserRouter/RouterProvider
// below are exactly as before, just with one extra wrapping route object.
function RootLayout() {
  return (
    <>
      <Outlet />
      <ToastViewport />
    </>
  )
}

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      // ─── Public routes ───────────────────────────────────────────────────
      // Y5.2-FIX2 — wrapped by PublicRoute (see that file for the full
      // root-cause explanation): LoginPage/RegisterPage no longer mount
      // directly — PublicRoute gates on AuthContext's real bootstrap
      // (isLoading/isAuthenticated) first, exactly mirroring how
      // ProtectedRoute below gates the authenticated subtree.
      {
        element: <PublicRoute />,
        children: [
          {
            path: '/login',
            element: <LoginPage />,
          },
          {
            path: '/register',
            element: <RegisterPage />,
          },
        ],
      },

      // ─── Protected routes ────────────────────────────────────────────────
      {
        element: <ProtectedRoute />,
        children: [
          {
            element: <AppLayout />,
            children: [
              // Default redirect
              { path: '/', element: <Navigate to="/dashboard" replace /> },

              // Dashboard
              { path: '/dashboard', element: <DashboardPage /> },

              // Patients
              { path: '/patients',          element: <PatientsPage /> },
              { path: '/patients/new',      element: <PatientCreatePage /> },
              { path: '/patients/:id',      element: <PatientDetailPage /> },

              // Predictions
              { path: '/predictions',              element: <PredictionsPage /> },
              { path: '/predictions/:patientId',   element: <PredictionsPage /> },

              // Alerts
              { path: '/alerts', element: <AlertsPage /> },

              // Settings — Y2: nested routes replace the old single flat
              // route + local `activeTab` state. The route itself is the
              // source of truth for the active section (no location.state,
              // no query param — Y1 §9/Y2 §1). `/settings` redirects to
              // `/settings/profile` with `replace` so no dead intermediate
              // history entry is left (Y2 §10).
              {
                path: '/settings',
                element: <SettingsLayout />,
                children: [
                  { index: true, element: <Navigate to="/settings/profile" replace /> },
                  { path: 'profile',       element: <ProfileSettings /> },
                  { path: 'notifications', element: <NotificationSettings /> },
                  { path: 'security',      element: <SecuritySettings /> },
                  { path: 'appearance',    element: <AppearanceSettings /> },
                  { path: 'patients',      element: <PatientVisibilitySettings /> },
                ],
              },
            ],
          },
        ],
      },

      // ─── 404 ─────────────────────────────────────────────────────────────
      {
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
