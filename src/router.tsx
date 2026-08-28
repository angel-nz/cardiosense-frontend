import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'

import { AppLayout }          from '@/components/layout/AppLayout'
import { ProtectedRoute }     from '@/components/layout/ProtectedRoute'

import LoginPage              from '@/pages/LoginPage'
import RegisterPage           from '@/pages/RegisterPage'
import NotFoundPage           from '@/pages/NotFoundPage'
import DashboardPage          from '@/pages/Dashboard/DashboardPage'
import PatientsPage           from '@/pages/Patients/PatientsPage'
import PatientDetailPage      from '@/pages/Patients/PatientDetailPage'
import PatientCreatePage      from '@/pages/Patients/PatientCreatePage'
import PredictionsPage        from '@/pages/Predictions/PredictionsPage'
import AlertsPage             from '@/pages/Alerts/AlertsPage'
import SettingsPage           from '@/pages/Settings/SettingsPage'

const router = createBrowserRouter([
  // ─── Public routes ─────────────────────────────────────────────────────────
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/register',
    element: <RegisterPage />,
  },

  // ─── Protected routes ──────────────────────────────────────────────────────
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

          // Settings
          { path: '/settings', element: <SettingsPage /> },
        ],
      },
    ],
  },

  // ─── 404 ───────────────────────────────────────────────────────────────────
  {
    path: '*',
    element: <NotFoundPage />,
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
