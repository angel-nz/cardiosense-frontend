# CardioSense — Frontend

Sistema Inteligente Distribuido para la Predicción Temprana de Riesgo Cardiovascular.

## Stack

- **React 18** + **TypeScript**
- **Vite 5**
- **Tailwind CSS 3**
- **shadcn/ui** + **Radix UI**
- **React Router v6**
- **Recharts** (gráficas)
- **Socket.IO Client** (tiempo real)
- **Axios**
- **date-fnsAlerts**
- **lucide-react**

## Estructura

```
src/
├── components/
│   ├── layout/       # AppLayout, Sidebar, Topbar, ProtectedRoute
│   ├── ui/           # RiskBadge, StatCard
│   ├── charts/       # RiskGauge, FeatureImportanceBar
│   ├── patients/     # PatientRow
│   └── alerts/       # AlertToast
├── context/          # AlertsContext, AuthContext, SocketContext
├── hooks/            # usePatients, usePredictions
├── lib/              # utils, mockData
├── pages/
│   ├── Dashboard/    # DashboardPage
│   ├── Patients/     # PatientsPage, PatientDetailPage, PatientCreatePage
│   ├── Predictions/  # PredictionsPage, PredictionHistoryPage
│   ├── Alerts/       # AlertsPage
│   ├── Settings/     # SettingsPage
│   ├── LoginPage.tsx
│   ├── NotFoundPage.tsx
│   └── RegisterPage.tsx
├── services/         # alertService, api, authService, dashboardService, patientService, predictionService, recordService
├── types/            # index.ts
├── App.tsx
├── index.css
├── main.tsx
├── router.tsx
└── vite-env.d.ts
```

## Instalación

```bash
# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env.local

# Iniciar en desarrollo
npm run dev

# Build para producción
npm run build
```

## Rutas

| Ruta                        | Página                | Auth     |
| --------------------------- | ---------------------- | -------- |
| `/login`                  | Login                  | Pública |
| `/dashboard`              | Dashboard principal    | Sí      |
| `/patients`               | Lista de pacientes     | Sí      |
| `/patients/new`           | Crear paciente         | Sí      |
| `/patients/:id`           | Perfil del paciente    | Sí      |
| `/predictions`            | Historial predicciones | Sí      |
| `/predictions/:patientId` | Nueva predicción      | Sí      |
| `/alerts`                 | Centro de alertas      | Sí      |
| `/settings`               | Configuración         | Sí      |

## Paleta de colores

| Token       | Hex         | Uso                            |
| ----------- | ----------- | ------------------------------ |
| `navy`    | `#0F2440` | Sidebar                        |
| `primary` | `#1D4ED8` | CTAs, links                    |
| `teal`    | `#0D9488` | Riesgo bajo                    |
| `amber`   | `#D97706` | Riesgo moderado                |
| `red`     | `#DC2626` | Riesgo alto, alertas críticas |

## Demo

Credenciales de prueba:

- **Email:** `dr.garcia@cardiosense.mx / dr.angelnz@hospital.mx`
- **Contraseña:** `Demo1234! / Demo2345!`

## Deploy

```bash
# Vercel
vercel --prod

# Conectar el repo en vercel.com
# Build command: npm run build
# Output dir: dist
```
