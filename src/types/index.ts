// ─── Auth ────────────────────────────────────────────────────────────────────
export type UserRole = 'admin' | 'medico' | 'paciente'

export interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  role: UserRole
  avatarUrl?: string
  createdAt: string
  // Only present for role MEDICO — mirrors backend sanitizeUser()/PATCH
  // /users/:id response (medico: {id, especialidad, hospital}).
  medico?: {
    id: string
    especialidad?: string
    hospital?: string
  }
}

// PATCH /api/users/:id — flat payload, exactly matching UpdateProfileDto
// (backend/src/modules/users/user.routes.ts). especialidad/hospital are
// only applied server-side when role === MEDICO.
export interface UpdateUserRequest {
  firstName?: string
  lastName?: string
  especialidad?: string
  hospital?: string
}

// GET/PATCH /api/users/me/notification-preferences (Bloque N-B).
// Deliberately only these two: email/push/SMS/sound have no backend
// channel, so they are NOT persisted and are not part of this contract.
export interface NotificationPreferences {
  highRiskAlerts: boolean
  weeklySummary: boolean
}

export interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
}

export interface LoginRequest {
  email: string
  password: string
}

// Canonical contract per Matriz de Integración v1.0 — POST /api/auth/login
export interface LoginResponse {
  token: string
  user: User
}

// POST /api/auth/register — role defaults to MEDICO on the backend if omitted
export interface RegisterRequest {
  email: string
  password: string
  firstName: string
  lastName: string
  role?: 'MEDICO' | 'ADMIN'
  cedulaProfesional?: string
  especialidad?: string
  hospital?: string
}

// ─── Patient ─────────────────────────────────────────────────────────────────
export type Sex = 0 | 1 // 0 = Female, 1 = Male

export interface Patient {
  id: string
  medicoId: string
  firstName: string
  lastName: string
  birthDate: string
  sex: Sex
  curp?: string
  phone?: string
  isActive: boolean
  createdAt: string
  updatedAt: string
  // Computed
  age?: number
  latestRisk?: RiskLevel
  latestScore?: number
}

export interface CreatePatientRequest {
  firstName: string
  lastName: string
  birthDate: string // YYYY-MM-DD
  sex: Sex
  curp?: string
  phone?: string
}

// Backend only allows updating a limited subset of fields — see
// UpdatePatientDto (birthDate/sex/curp are not editable post-creation).
export interface UpdatePatientRequest {
  firstName?: string
  lastName?: string
  phone?: string
  isActive?: boolean
}

// ─── Health Record ────────────────────────────────────────────────────────────
// NOTE: the backend's HealthRecord model has no `sex` field (sex belongs to
// Patient, not to each clinical record) — omitted here to match the real
// contract; it was unused across the app.
export interface HealthRecord {
  id: string
  patientId: string
  recordedAt: string
  age: number
  currentSmoker: boolean
  cigsPerDay: number
  bpMeds: boolean
  diabetes: boolean
  totChol: number
  sysBP: number
  diaBP: number
  bmi: number
  heartRate: number
  glucose: number
  notes?: string
  createdBy: string
}

export interface CreateHealthRecordRequest {
  patientId: string
  age: number
  currentSmoker: boolean
  cigsPerDay: number
  bpMeds: boolean
  diabetes: boolean
  totChol: number
  sysBP: number
  diaBP: number
  bmi: number
  heartRate: number
  glucose: number
  notes?: string
}

// GET /api/patients/:id/history — the backend also returns recent
// Predictions in this payload; only `records` is consumed in this block
// (Predictions integration belongs to Bloque C).
export interface PatientHistoryResponse {
  records: HealthRecord[]
  predictions: unknown[]
}

// ─── Prediction ───────────────────────────────────────────────────────────────
export type RiskLevel = 'low' | 'moderate' | 'high'

// ─── Patient Timeline (P2/P3) ───────────────────────────────────────────────
// GET /api/patients/:patientId/timeline — discriminated union matching the
// real backend contract (patient.timeline.ts). Normalized casing
// (riskLevel/severity lowercase) is applied in timelineService.ts, same
// convention already used by predictionService.ts/alertService.ts.
export type TimelineEventType = 'CLINICAL_RECORD' | 'PREDICTION' | 'ALERT' | 'RISK_CHANGE'

export interface ClinicalRecordEventMetadata {
  healthRecordId: string
  sysBP: number
  diaBP: number
}

export interface PredictionEventMetadata {
  predictionId: string
  healthRecordId: string | null
  riskScore: number
  riskLevel: RiskLevel
  isAnomaly: boolean
  anomalyScore: number | null
  modelVersion: string | null
}

export interface AlertEventMetadata {
  alertId: string
  predictionId: string | null
  severity: AlertSeverity
  message: string
  isRead: boolean
}

export interface RiskChangeEventMetadata {
  fromLevel: RiskLevel
  toLevel: RiskLevel
  previousPredictionId: string
  currentPredictionId: string
}

interface TimelineEventBase {
  id: string
  patientId: string
  eventDate: string
}

export interface ClinicalRecordTimelineEvent extends TimelineEventBase {
  eventType: 'CLINICAL_RECORD'
  metadata: ClinicalRecordEventMetadata
}

export interface PredictionTimelineEvent extends TimelineEventBase {
  eventType: 'PREDICTION'
  metadata: PredictionEventMetadata
}

export interface AlertTimelineEvent extends TimelineEventBase {
  eventType: 'ALERT'
  metadata: AlertEventMetadata
}

export interface RiskChangeTimelineEvent extends TimelineEventBase {
  eventType: 'RISK_CHANGE'
  metadata: RiskChangeEventMetadata
}

export type PatientTimelineEvent =
  | ClinicalRecordTimelineEvent
  | PredictionTimelineEvent
  | AlertTimelineEvent
  | RiskChangeTimelineEvent

// GET /api/dashboard/calendar (O2) — same discriminated union as
// PatientTimelineEvent, decorated with patientName. Deliberately NOT added
// to PatientTimelineEvent itself: Patient Timeline is a single-patient
// context (P2/P3) and never needed it — same separation backend already
// applies (dashboard.calendar.ts intersection type, not a change to
// patient.timeline.ts).
export type DashboardCalendarEvent = PatientTimelineEvent & { patientName: string }

// O3-FIX-4 — carried via React Router navigation `state` (Dashboard
// Calendar → PatientDetailPage) so a click on a specific event can select
// the exact same target P4 already knows how to select/highlight, instead
// of just opening the patient's page with no selection. RISK_CHANGE maps
// to 'PREDICTION' with its currentPredictionId — never previousPredictionId
// — reusing the same mechanism rather than needing a third kind.
export type PatientDetailNavigationTarget =
  | { kind: 'HEALTH_RECORD'; id: string }
  | { kind: 'PREDICTION'; id: string }

// O3-FIX-5 — extends the above with what PatientCalendar itself needs to
// reposition/select on arrival: `calendarEventId` is the Dashboard timeline
// event's OWN `.id` — for RISK_CHANGE this is `risk-change:{currentPredictionId}`
// (P2's derived-event id format), which is NOT the same string as `target.id`
// above (that one is always a real Prediction/HealthRecord id, since
// RISK_CHANGE's external target is its currentPredictionId in Risk
// Evolution). `eventDate` resolves which business month/day to open.
export interface DashboardEventNavigationState {
  target: PatientDetailNavigationTarget
  calendarEventId: string
  eventDate: string
}

export interface CreatePredictionRequest {
  patientId: string
  healthRecordId?: string
}

export interface Prediction {
  id: string
  patientId: string
  healthRecordId: string
  riskScore: number        // 0.0 – 1.0
  riskLevel: RiskLevel
  anomalyScore: number
  isAnomaly: boolean
  modelVersion: string
  predictedAt: string
  featureImportance?: Record<string, number>
  // Only present on GET /api/predictions (global, medico-scoped history) —
  // the backend embeds patient.firstName/lastName there. Absent on
  // patient-scoped responses (predict()/getHistory()), which don't need it
  // since the patient is already known from the route.
  patientName?: string
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
// GET /api/dashboard/stats (Bloque I) — medico-scoped aggregate metrics.
// Named DashboardMetrics (not DashboardStats) to avoid colliding with the
// pre-existing DashboardStats interface further below (dead code tied to
// the old MOCK_DASHBOARD_STATS mock — out of scope to touch in this block).
export interface DashboardMetrics {
  predictionsToday: number
  predictionsThisWeek: Array<{ date: string; count: number }>
  highRiskPatients: number
  riskDistribution: { high: number; moderate: number; low: number }
}

// ─── Alert ───────────────────────────────────────────────────────────────────
export type AlertSeverity = 'info' | 'warning' | 'critical'

export interface Alert {
  id: string
  patientId: string
  patientName: string
  predictionId?: string
  severity: AlertSeverity
  message: string
  isRead: boolean
  createdAt: string
  riskScore?: number
}

// GET /api/alerts — the backend Alert model has no persisted riskScore field
// (only the transient Socket.IO new_alert payload carries one); real REST
// list responses always have riskScore=undefined per item.
export interface AlertListResponse {
  data: Alert[]
  total: number
  page: number
  limit: number
  totalPages: number
  unreadCount: number
}

// PATCH /api/alerts/:id/read — backend returns the updated Alert row itself
// (not a generic {success:true} envelope, unlike PATCH /alerts/read-all).
export type AlertReadResponse = Alert

// ─── Stats ───────────────────────────────────────────────────────────────────
export interface ModelStats {
  accuracy: number
  precision: number
  recall: number
  f1Score: number
  aucRoc: number
  modelVersion: string
  trainedAt: string
  totalPredictions: number
}

export interface DashboardStats {
  totalPatients: number
  activeAlerts: number
  predictionsToday: number
  highRiskPatients: number
  weeklyPredictions: Array<{ date: string; count: number }>
  riskDistribution: Array<{ name: string; value: number; color: string }>
  recentAlerts: Alert[]
}

// ─── Socket Events ────────────────────────────────────────────────────────────
export interface SocketAlert {
  id: string
  patientId: string
  patientName: string
  severity: AlertSeverity
  message: string
  riskScore: number
  createdAt: string
}

export interface SocketPrediction {
  predictionId: string
  patientId: string
  riskScore: number
  riskLevel: RiskLevel
  isAnomaly: boolean
}

// INT-20 — health_record_created. Payload is intentionally minimal (ids +
// timestamp only, mirrors prediction_completed's lean style) — it does NOT
// carry the clinical fields, so consumers must refetch via recordService
// rather than construct a HealthRecord from this alone.
export interface SocketHealthRecord {
  recordId: string
  patientId: string
  recordedAt: string
}

// INT-21 — patient_updated. Payload carries exactly the fields
// UpdatePatientDto/deactivate can change (see patient.service.ts) — enough
// to merge directly into an already-loaded Patient without a refetch.
export interface SocketPatientUpdate {
  patientId: string
  firstName: string
  lastName: string
  isActive: boolean
}

// O4.2 — dashboard_activity_changed. Invalidation-only signal (user:{userId}
// room, no subscribe_patient needed) for Dashboard Calendar — deliberately
// NOT a timeline event: no eventType, no patientName, no risk data. Receivers
// must always do a canonical GET /api/dashboard/calendar refetch, never
// build/insert a CLINICAL_RECORD/PREDICTION/RISK_CHANGE/ALERT from this.
export interface SocketDashboardActivity {
  patientId: string
  eventDate: string
}

// ─── API ─────────────────────────────────────────────────────────────────────
export interface ApiResponse<T> {
  data: T
  message?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface ApiError {
  error: string
  statusCode: number
  details?: Record<string, string>
}
