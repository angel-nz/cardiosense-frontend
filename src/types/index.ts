// ─── Auth ────────────────────────────────────────────────────────────────────
export type UserRole = 'admin' | 'medico' | 'paciente'

export interface User {
  id: string
  // Z6-R1 — nullable: a doctor may register and authenticate with phone
  // only (medico.phone below), with no email at all. `null` is a real,
  // honest state here — never normalized to `undefined` the way Patient.
  // email is (see patientService.ts's normalizePatient) — this is the
  // login identity itself, not optional contact info, so "no email" must
  // stay a visible, deliberate fact wherever this type is consumed.
  email: string | null
  firstName: string
  lastName: string
  role: UserRole
  // Y3.1B — replaces the dead `avatarUrl?: string` (never populated by any
  // backend response, never read by any consumer — confirmed by exhaustive
  // grep during Y3.1A). This is the ONE frozen avatar metadata shape
  // (Y3.1A-FIX1 §13): presence of a row vs. `null` IS the "has an avatar"
  // signal — no separate boolean. This field is metadata only; the actual
  // image bytes are fetched separately and privately (see
  // services/avatarService.ts + context/AvatarContext.tsx) — never inline
  // here, never a public URL.
  avatar: { updatedAt: string } | null
  createdAt: string
  // Only present for role MEDICO — mirrors the wire shape login/register/
  // GET /auth/me/PATCH /users/:id/GET+PATCH /users/me/profile all share
  // (Y3 §14: one User shape regardless of source). `cedulaProfesional`
  // added in Y3 — previously silently dropped by every normalizer despite
  // already existing on the backend Medico model and already being sent
  // over the wire (Y1 finding). `especialidad`/`hospital` are `string |
  // null` (not `| undefined`) for the same reason: this is what
  // /users/me/profile actually speaks, and one shape must mean the same
  // thing everywhere.
  medico?: {
    id: string
    cedulaProfesional: string | null
    especialidad: string | null
    hospital: string | null
    // Z6 — optional doctor contact phone, persisted as E.164. `string |
    // null` (not `| undefined`) for the exact same reason as the three
    // fields above: this is what /users/me/profile actually speaks.
    phone: string | null
  }
}

// PATCH /api/users/:id — flat payload, exactly matching UpdateProfileDto
// (backend/src/modules/users/user.routes.ts). especialidad/hospital are
// only applied server-side when role === MEDICO. Unrelated to Y3's new
// /users/me/profile contract (ProfileMyUpdateRequest below) — this type/
// route is untouched, kept for any other existing caller of PATCH /:id.
export interface UpdateUserRequest {
  firstName?: string
  lastName?: string
  especialidad?: string
  hospital?: string
}

// GET/PATCH /api/users/me/profile (Y3) — the Settings self-service Profile
// contract. `null` on any professional field clears it; a field omitted
// from a PATCH payload is left unchanged server-side. role/id are never
// writable through this contract (backend-authoritative).
// PRE-R — `email` is new: previously read-only (Y3 §2/§36), it is now
// editable/clearable through this same contract for every role, subject to
// the backend's final-state "email != null OR phone != null" invariant
// (user.routes.ts's PATCH /me/profile) — omitted leaves it unchanged, null
// clears it, a string must be a normalized, valid email
// (NullableCanonicalEmailField, backend-enforced).
export interface ProfileMyUpdateRequest {
  firstName?: string
  lastName?: string
  email?: string | null
  cedulaProfesional?: string | null
  especialidad?: string | null
  hospital?: string | null
  // Z6 — omitted leaves it unchanged; null clears it; a string must be a
  // valid canonical E.164 phone (backend-enforced, CanonicalPhoneField).
  phone?: string | null
}

// GET/PATCH /api/users/me/notification-preferences (Bloque N-B, rebuilt in
// Y4). These three gate ONLY realtime `new_alert` delivery — they never
// affect Alert persistence, clinical history, or Prediction execution (Y4
// §1). Deliberately only these three: email/push/SMS/sound have no backend
// delivery channel, and weeklySummary was removed — none of those are part
// of this contract.
// Z5 — four additional independent realtime toggles, one per Configurable
// Information Alert event, following the exact same gating contract as the
// three above (realtime `new_alert` popup ONLY — never Alert persistence,
// never AlertsPage history, never `alerts_changed`).
// Z6-R2 §5 — the doctor-profile realtime toggle REMOVED: the one event it
// gated no longer exists as a product decision. Exactly three Z5
// information toggles remain.
export interface NotificationPreferences {
  highRiskRealtime: boolean
  moderateRiskRealtime: boolean
  anomalyRealtime: boolean
  patientCreatedRealtime: boolean
  patientUpdatedRealtime: boolean
  healthRecordCreatedRealtime: boolean
}

// GET/PATCH /api/users/me/appearance (Bloque Y6.1). Frontend-facing values
// are lowercase — the exhaustive mapping to/from the backend's uppercase
// AppearanceTheme enum ('LIGHT'|'DARK'|'SYSTEM') lives entirely in
// appearanceService.ts, never duplicated or inlined elsewhere. 'system'
// means "follow the OS/browser color-scheme" and is a real, storable
// preference — not merely what's shown before a preference is loaded.
export type ThemePreference = 'light' | 'dark' | 'system'

// PRE-Y8 (Interface Size Preference) — a second, independent Appearance
// axis (GET/PATCH /api/users/me/appearance now carries both). Deliberately
// NOT the removed Y6.3B/Y6.4B interface-density/visibility PRESET axis
// (Density/InterfacePreset) — this is a single global scale factor, not a
// set of per-component token overrides. 'original' is the exact pre-
// existing baseline (scale 1.00) and a real, storable preference, same as
// 'system' is for ThemePreference — not merely "nothing chosen yet".
export type InterfaceSizePreference = 'original' | 'medium' | 'large'

export interface AppearancePreferenceResponse {
  theme: ThemePreference
  interfaceSize: InterfaceSizePreference
  updatedAt: string | null
}

// Y5.2 — no `token` field: the access token lives exclusively in
// lib/tokenStore.ts (in-memory, shared by api.ts and SocketContext.tsx), not
// duplicated into this React state. AuthContext still exposes an
// `isAuthenticated` boolean derived from whether that store currently holds
// a token, so existing consumers (ProtectedRoute, etc.) are unaffected.
export interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
}

// Z6-R1 — `identifier` replaces the old `email`-only field: it may be a
// trimmed email OR a canonical E.164 phone (LoginPage reuses
// CountryPhoneInput to produce the latter).
//
// Z6-R1-FIX1 §1/§3 — `method` makes the client's already-known identifier
// kind an explicit, required part of the wire contract — the backend no
// longer infers it from `identifier`'s shape (leading '+', '@', regex).
// LoginPage's existing Correo/Teléfono mode toggle is the source of truth
// for this field; it is derived directly from that mode, never guessed.
// Mirrors auth.dto.ts's LoginDto discriminated union (method: 'EMAIL' |
// 'PHONE') exactly — this is a backend contract change, not just a
// frontend relabeling.
export interface LoginRequest {
  method: 'EMAIL' | 'PHONE'
  identifier: string
  password: string
}

// Canonical contract per Matriz de Integración v1.0 — POST /api/auth/login
export interface LoginResponse {
  token: string
  user: User
}

// POST /api/auth/register — role defaults to MEDICO on the backend if omitted.
// Z6-R1 — email and phone are BOTH optional now (a MEDICO registration
// needs at least one of the two — enforced server-side by RegisterDto's
// superRefine, auth.dto.ts); phone is new, reusing the same canonical
// E.164 contract CreatePatientRequest.phone/ProfileMyUpdateRequest.phone
// already use. Non-MEDICO (ADMIN) registration still requires email in
// practice (backend-enforced) — this type stays permissive since it
// describes the one shared wire shape, not a role-specific variant.
export interface RegisterRequest {
  email?: string
  phone?: string
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
  // Z6 — optional patient contact email. CONTACT INFORMATION only, no
  // relationship to login/auth. `undefined` when absent, matching curp/
  // phone's existing convention on this frontend-facing shape (the backend
  // itself speaks `null` — see normalizePatient in patientService.ts).
  email?: string
  isActive: boolean
  // Z8 — PATIENT LIFECYCLE & VISIBILITY MANAGEMENT. Orthogonal to isActive
  // — see backend schema.prisma's Paciente.isHidden comment for the full
  // three-state model (ACTIVE / INACTIVE_VISIBLE / INACTIVE_HIDDEN).
  // isActive=true && isHidden=true never legitimately occurs; the frontend
  // never constructs that combination either. A hidden patient is never
  // returned by any normal patient list/detail endpoint — this field is
  // only ever true for rows read through the dedicated Settings ->
  // Pacientes hidden-list/summary surface (see patientService.ts).
  isHidden: boolean
  createdAt: string
  // TECHNICAL audit timestamp only (personal-info edits). NEW S3 — never shown
  // as "Última actualización" and never used for ordering.
  updatedAt: string
  // NEW S3 — clinical-time-first read model (backend clinicalLatest.ts):
  // effective clinical time of the patient's clinically latest HealthRecord
  // (measuredAt, or recordedAt for legacy rows); null = no clinical records.
  latestClinicalAt: string | null
  latestClinicalTimeSource: ClinicalTimeSource | null
  // NEW S3-FIX1 — identity of that exact clinically latest HealthRecord
  // (backend source of truth; never recomputed from a partial history page).
  latestClinicalRecordId: string | null
  // NEW S3-FIX2 — CANONICAL current observed risk (backend currentPrediction):
  //   object = the Prediction of the EXACT clinically latest record
  //            (predictedAt DESC, id DESC within that record);
  //   null   = no current observed risk (no records, or that record has no
  //            Prediction). Never reconstructed from Prediction history.
  currentPrediction: CurrentPredictionSummary | null
  // NEW S4 — PUBLIC state of the durable automatic-Prediction task of that
  // exact latest record, present only while it has no Prediction yet
  // (PENDING / PROCESSING / RETRY_WAIT) or TERMINALLY MODEL_INELIGIBLE (S4-FIX2: the
  // record's recorded age is outside the model's range — no prediction will
  // ever be generated for it, no retry). null = no such task. Never an
  // error body or infrastructure detail.
  currentPredictionTask: CurrentPredictionTaskView | null
  // Computed from currentPrediction — current observed risk = Prediction of the EXACT clinically
  // latest record (S3-FIX1 strict rule). undefined = no current observed
  // risk (no records, or the latest record has no Prediction) — never an
  // older record's Prediction.
  age?: number
  latestRisk?: RiskLevel
  latestScore?: number
}

// NEW S3-FIX2 — public fields of the canonical current Prediction (only what
// the current-risk UI displays). featureImportance is never sent (not
// persisted); kept optional so the existing hidden panel stays type-safe.
export interface CurrentPredictionTaskView {
  status: 'PENDING' | 'PROCESSING' | 'RETRY_WAIT' | 'MODEL_INELIGIBLE'
  attemptCount: number
  lastAttemptAt: string | null
}

export interface CurrentPredictionSummary {
  id: string
  healthRecordId: string
  riskLevel: RiskLevel
  riskScore: number
  isAnomaly: boolean
  predictedAt: string
  modelVersion: string | null
  featureImportance?: Record<string, number>
}

export interface CreatePatientRequest {
  firstName: string
  lastName: string
  birthDate: string // YYYY-MM-DD
  sex: Sex
  curp?: string
  phone?: string
  // Z6 — omitted/blank → null server-side; invalid syntax is rejected.
  email?: string
}

// Backend only allows updating a limited subset of fields — see
// UpdatePatientDto (birthDate/sex/curp are not editable post-creation).
export interface UpdatePatientRequest {
  firstName?: string
  lastName?: string
  // U4.2A — extended: curp/birthDate/sex are now editable (all already
  // existed in Prisma/CreatePatientRequest — no schema change). curp/phone
  // use `| null` — an explicit null clears an existing value (both columns
  // are nullable in Prisma); omitting the field entirely means "don't
  // touch it". EditPatientModal is the only caller that sends these.
  curp?: string | null
  birthDate?: string
  sex?: Sex
  phone?: string | null
  // Z6 — same nullable-PATCH convention as curp/phone: omitted → don't
  // touch; null → clear; a string → normalized (trim + lowercase) and
  // validated server-side.
  email?: string | null
  // Z8 — `isActive` REMOVED from this contract. Lifecycle state is no
  // longer settable through PUT /patients/:id — it now has its own
  // dedicated endpoint (see PatientStatusRequest/patientService.setStatus
  // below), per Z8's "no endpoint should silently combine two product
  // actions" principle.
}

// Z8 §13/§24 — Patients-list lifecycle filter. Matches backend
// PatientStatusFilter exactly. ACTIVE is the default (today's implicit
// "doctor opens Patients and sees the active roster" expectation). Hidden
// patients are excluded from every one of these three values, always,
// server-side — there is deliberately no 'HIDDEN'/'INCLUDE_HIDDEN' value
// here; the only way to see a hidden patient is the dedicated hidden-
// patient management surface (Settings -> Pacientes).
export type PatientLifecycleFilter = 'ACTIVE' | 'INACTIVE' | 'ALL'

// PATCH /api/patients/:id/status — the one explicit lifecycle mutation.
export interface PatientStatusRequest {
  isActive: boolean
}

// PATCH /api/patients/:id/visibility and PATCH /api/patients/inactive/
// visibility (bulk) — the one explicit visibility mutation.
export interface PatientVisibilityRequest {
  isHidden: boolean
}

// GET /api/patients/visibility/hidden — minimal patient summary only (no
// clinical data), matching the backend's deliberately thin hidden-list
// projection (patient.repository.ts::findHidden).
export interface HiddenPatientSummary {
  id: string
  firstName: string
  lastName: string
  birthDate: string
  sex: Sex
  curp?: string
  updatedAt: string
}

export interface HiddenPatientQueryParams {
  page?: number
  limit?: number
  search?: string
}

// GET /api/patients/visibility/summary — counts for Settings -> Pacientes.
// Deliberately never reused as Dashboard patient counts (Z8 §18).
export interface PatientVisibilitySummary {
  visibleInactive: number
  hiddenInactive: number
}

// PATCH /api/patients/inactive/visibility response.
export interface BulkVisibilityResponse {
  affectedCount: number
}

// ─── Health Record ────────────────────────────────────────────────────────────
// NOTE: the backend's HealthRecord model has no `sex` field (sex belongs to
// Patient, not to each clinical record) — omitted here to match the real
// contract; it was unused across the app.
// NEW S2E — server-assigned clinical-time source (S2A). Legacy rows keep
// LEGACY_ENTRY_TIME and have no measuredAt.
export type ClinicalTimeSource = 'CLINICIAN_ENTERED' | 'LEGACY_ENTRY_TIME'

export interface HealthRecord {
  id: string
  patientId: string
  // Entry time (server `now()` at creation) — NOT the clinical measurement
  // time for CLINICIAN_ENTERED records; see lib/clinicalTime.ts.
  recordedAt: string
  // NEW S2E — explicit REAL measurement instant (UTC ISO) for
  // CLINICIAN_ENTERED records; null for legacy rows.
  measuredAt: string | null
  clinicalTimeSource: ClinicalTimeSource
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
  // NEW S2E — REQUIRED exact UTC instant "YYYY-MM-DDTHH:mm:ss.SSSZ" of the
  // REAL measurement (Guadalajara wall time converted by
  // lib/clinicalTime.ts). `age`, `recordedAt` and `clinicalTimeSource` are
  // backend-authoritative and are deliberately NOT part of this type (the
  // former optional `age` was removed: no caller sent it since U3.2).
  measuredAt: string
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
// U5.2 — `records` is now server-side paginated/sorted; `predictions`
// remains unused by this block (Risk Evolution has its own independent
// endpoint) — kept only for API backward compatibility, unchanged shape.
export interface PaginatedHealthRecords {
  data: HealthRecord[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface PatientHistoryResponse {
  records: PaginatedHealthRecords
  predictions: unknown[]
  // U8.2B — only present when `targetId` was supplied in the request.
  targetResolved?: boolean
}

// NEW S2E-FIX2 — 'clinicalTime' = effective clinical time (measuredAt, or
// recordedAt for legacy rows), sorted server-side; it is the default.
export type HistorySortBy = 'clinicalTime' | 'recordedAt' | 'sysBP' | 'diaBP' | 'totChol' | 'glucose' | 'bmi'
export type HistorySortOrder = 'asc' | 'desc'

export interface HistoryQueryParams {
  page: number
  limit: number
  sortBy: HistorySortBy
  sortOrder: HistorySortOrder
  // U8.2B — optional deep-link target resolution (see
  // patient.repository.ts::getHistory). Omitted for every ordinary call.
  targetId?: string
}

// ─── Prediction ───────────────────────────────────────────────────────────────
export type RiskLevel = 'low' | 'moderate' | 'high'

// ─── Patient Timeline (P2/P3) ───────────────────────────────────────────────
// GET /api/patients/:patientId/timeline — discriminated union matching the
// real backend contract (patient.timeline.ts). Normalized casing
// (riskLevel/severity lowercase) is applied in timelineService.ts, same
// convention already used by predictionService.ts/alertService.ts.
// Z2 — 'ALERT' removed: no calendar/timeline endpoint produces Alert-model
// events anymore (calendar-specific; the Alerts subsystem's own `Alert`
// type below is untouched).
export type TimelineEventType = 'CLINICAL_RECORD' | 'PREDICTION' | 'RISK_CHANGE'

// NEW S2E-FIX3 — why a Prediction exists (server-assigned; never sent by the client).
// NEW S2E-FIX4 — automatic-only workflow: no MANUAL origin exists any more.
export type PredictionOrigin = 'AUTOMATIC_HEALTH_RECORD' | 'LEGACY_UNKNOWN'

// NEW S2E-FIX4 — historical (LEGACY_UNKNOWN, origin not provable) predictions
// of a record: listed inside the record's calendar detail, never own events,
// never labelled automatic.
export interface CalendarHistoricalPrediction {
  predictionId: string
  origin: 'LEGACY_UNKNOWN'
  predictedAt: string        // calculation time
  riskScore: number
  riskLevel: RiskLevel
  modelVersion: string | null
}

export interface ClinicalRecordEventMetadata {
  healthRecordId: string
  sysBP: number
  diaBP: number
  // NEW S2E-FIX3 — event placed at the record's effective clinical time.
  clinicalTimeSource: ClinicalTimeSource
  recordedAt: string | null
  historicalPredictions: CalendarHistoricalPrediction[]
}

export interface PredictionEventMetadata {
  predictionId: string
  healthRecordId: string | null
  riskScore: number
  riskLevel: RiskLevel
  isAnomaly: boolean
  anomalyScore: number | null
  modelVersion: string | null
  // NEW S2E-FIX3 — calendar PREDICTION events are AUTOMATIC only, placed at
  // the source record's clinical time; predictedAt = calculation time.
  origin: PredictionOrigin
  predictedAt: string | null
  clinicalTimeSource: ClinicalTimeSource | null
}

export interface RiskChangeEventMetadata {
  fromLevel: RiskLevel
  toLevel: RiskLevel
  previousPredictionId: string
  currentPredictionId: string
  // NEW S3 — eventDate is the GENERATED time; clinicalAt is the source
  // record's clinical time (context only).
  clinicalAt: string | null
  generatedAt: string | null
  // NEW S2E-FIX4 — the event is dated at the CURRENT automatic Prediction's
  // source-record clinical time; these only disclose that provenance.
  clinicalTimeSource: ClinicalTimeSource | null
  currentPredictedAt: string | null
}

interface TimelineEventBase {
  id: string
  patientId: string
  eventDate: string
  // W2.2 — derived, API-only field (backend patient.timeline.ts). `null`/
  // omitted means no deterministic HealthRecord-anchored scenario could be
  // established for this event — it still renders individually. Never
  // persisted, never computed client-side (see lib/timelineGrouping.ts,
  // which only ever READS this field).
  groupId?: string | null
}

export interface ClinicalRecordTimelineEvent extends TimelineEventBase {
  eventType: 'CLINICAL_RECORD'
  metadata: ClinicalRecordEventMetadata
}

export interface PredictionTimelineEvent extends TimelineEventBase {
  eventType: 'PREDICTION'
  metadata: PredictionEventMetadata
}

export interface RiskChangeTimelineEvent extends TimelineEventBase {
  eventType: 'RISK_CHANGE'
  metadata: RiskChangeEventMetadata
}

export type PatientTimelineEvent =
  | ClinicalRecordTimelineEvent
  | PredictionTimelineEvent
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

// X2 — Dashboard stat-card navigation intent, carried via React Router
// `location.state` under the `dashboardStatNav` key, following the exact
// one-shot precedent established by DashboardEventNavigationState above
// (produced once by DashboardPage's stat cards, defensively validated and
// consumed exactly once by the destination page, then cleared from the
// history entry via `navigate(location.pathname, { replace: true, state:
// null })`). This type intentionally carries only WHAT Dashboard
// requested — never a destination-internal filter representation (no
// 'high'/'HIGH' casing choice, no unread boolean, no from/to instant) —
// each destination maps the intent onto its own existing filter state.
//
// Z8-FIX2 §1/§2/§5 — the two Patients stat cards ("Pacientes bajo tu
// cuidado"/"Riesgo alto") no longer use this location.state mechanism:
// PatientsPage's status/risk filters are now real `?status=/&risk=`
// URLSearchParams (see PatientsPage.tsx), which is the only representation
// that survives a browser refresh of the Dashboard-generated URL (§5/§21-D)
// — location.state does not reliably satisfy that requirement. The former
// 'PATIENTS_HIGH' member is removed accordingly; Dashboard now navigates
// those two cards with `navigate('/patients?status=...')` directly.
export type DashboardStatNavigationIntent =
  | { kind: 'ALERTS_UNREAD' }
  | { kind: 'PREDICTIONS_TODAY'; businessDateKey: string }

export interface DashboardStatNavigationState {
  dashboardStatNav: DashboardStatNavigationIntent
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
  // patient-scoped responses (getHistory()), which don't need it
  // since the patient is already known from the route.
  patientName?: string
  // V7 — the EXACT HealthRecord this Prediction actually used (Prediction ↔
  // HealthRecord, loaded via Prisma `include`, not a latest-record lookup).
  // `null` for a legacy/unlinked Prediction (healthRecordId was null at
  // creation, or the linked record no longer resolves) — the UI must show
  // an honest "no linked data" state for that case, never substitute the
  // patient's current/latest record. Sex is deliberately NOT part of this
  // object: HealthRecord has no persisted `sex` column (sex comes from
  // Patient at prediction time — see aiClient.ts), so the exact historical
  // sex used for an old Prediction is not recoverable from persisted data
  // and must not be presented here (see V7 report, provenance limitation).
  healthRecord: HealthRecord | null
  // NEW S2E-FIX3/FIX4 — AUTOMATIC_HEALTH_RECORD | LEGACY_UNKNOWN (rows that
  // predate origin persistence, never guessed).
  origin: PredictionOrigin
}

// U6.2 — GET /api/predictions (global history) query contract. riskLevel is
// the exact wire-level enum (uppercase, matching Prisma's RiskLevel) — not
// the lowercase display RiskLevel type used elsewhere in this file.
export type PredictionRiskFilter = 'LOW' | 'MODERATE' | 'HIGH'

export interface GlobalPredictionQueryParams {
  page: number
  limit: number
  search?: string
  from?: string
  to?: string
  riskLevel?: PredictionRiskFilter
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

// Z5 — the explicit cause of a Configurable Information Alert. Undefined
// for every prediction-generated Alert (HIGH/MODERATE/ANOMALY risk) — those
// continue to have no `type` at all, exactly mirroring the backend's
// nullable AlertType column (schema.prisma). Casing matches the backend
// enum member names exactly — never re-cased on the wire (unlike
// AlertSeverity, which the backend sends uppercase and this frontend
// normalizes to lowercase; AlertType has no such normalization step).
//
// Z6-R2 §1/§2/§6/§7 — the doctor-profile information alert type REMOVED,
// no replacement added. Exactly three values remain.
export type AlertType =
  | 'INFO_PATIENT_CREATED'
  | 'INFO_PATIENT_UPDATED'
  | 'INFO_HEALTH_RECORD_CREATED'

export interface Alert {
  id: string
  // Z5 — nullable: doctor-scoped Alert ownership has no patient at all
  // (see backend schema.prisma Alert model comment). Z6-R2 — no current
  // AlertType value ever produces a doctor-scoped Alert anymore (its one
  // producer, the doctor-profile information alert, was removed), but `patientId`
  // stays nullable as generic infrastructure rather than being narrowed
  // back to non-null. Every live Alert today (prediction-generated,
  // INFO_PATIENT_*, INFO_HEALTH_RECORD_CREATED) always carries a real
  // patientId.
  patientId: string | null
  patientName: string
  predictionId?: string
  type?: AlertType
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
// Z5 — patientId/patientName/riskScore are no longer unconditionally
// present: a doctor-scoped `new_alert` payload would carry patientId: null,
// no patientName, and no riskScore at all (the backend's
// createInformationAlert never includes a riskScore key — that field only
// ever exists on a prediction-generated Alert's payload). Z6-R2 — the one
// event that ever produced such a payload (the doctor-profile information
// alert) was removed, so every live payload today always sends real
// patientId/patientName — these fields stay optional/nullable as generic
// infrastructure, not narrowed back, for the same reason Alert.patientId
// above does.
export interface SocketAlert {
  id: string
  patientId: string | null
  patientName?: string
  type?: AlertType
  severity: AlertSeverity
  message: string
  riskScore?: number
  createdAt: string
}

// W4.2 — healthRecordId added (additive; every other field unchanged). Always
// a real, non-null id in the current backend contract — the emitting
// predict() call always has a concrete, already-resolved HealthRecord by the
// time it emits (see prediction.service.ts) — so this is typed as a required
// `string`, matching how SocketPredictionUnavailable below already types its
// own healthRecordId, not `string | null`/optional.
export interface SocketPrediction {
  predictionId: string
  patientId: string
  healthRecordId: string
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
// build/insert a CLINICAL_RECORD/PREDICTION/RISK_CHANGE from this.
export interface SocketDashboardActivity {
  patientId: string
  eventDate: string
}

// U8.6C — prediction_unavailable, same user:{userId} room. Informational
// only — no Prediction was created for this HealthRecord (the model
// doesn't support its age). Never merge with SocketPrediction: this is NOT
// a completed prediction, it has no riskScore/riskLevel/predictionId.
// Ephemeral — a missed event while offline is not later recoverable (no
// persistence backs this notification).
export interface SocketPredictionUnavailable {
  patientId: string
  healthRecordId: string
  reason: 'MODEL_INELIGIBLE'
  modelVersion: string
  eligibleAgeRange: { min: number; max: number }
}

// W4.2 — prediction_failed, same user:{userId} room as prediction_unavailable
// and emitted from the exact same place (record.service.ts's automatic-path
// catch) — but a DISTINCT, technical-failure-only outcome: the model WOULD
// have supported this record, but the AI call itself could not complete.
// MODEL_INELIGIBLE is deliberately excluded from `reason` — that domain
// outcome stays on SocketPredictionUnavailable above, never folded in here.
// Like SocketPredictionUnavailable, this is ephemeral/socket-only — nothing
// is persisted for a failed prediction attempt, so a missed event while
// offline is not later recoverable from history (see PredictionsPage's
// reconnect-recovery comment, which covers success only).
export interface SocketPredictionFailed {
  patientId: string
  healthRecordId: string
  reason: 'AI_UNAVAILABLE' | 'AI_INPUT_REJECTED' | 'AI_FAILURE'
}

// U2.2 — patient_created. Invalidation-only, user:{userId} room — signals
// "Total pacientes" may have changed. Deliberately minimal: no
// patientName/CURP/clinical data, since the canonical source is always a
// GET /patients refetch, never this payload.
export interface SocketPatientCreated {
  patientId: string
}

// Y4-FIX2 — alerts_changed, same user:{userId} room as new_alert, but
// deliberately NEVER gated by NotificationPreference (unlike new_alert —
// see SocketAlert above). Pure invalidation signal for the canonical Alerts
// collection/total, same minimal style as SocketPatientCreated/
// SocketDashboardActivity: no severity/message/patientName/riskScore.
// Consumers must always refetch via alertService, never fabricate an Alert
// from this payload, and must never use it to drive toast/popup
// presentation (that remains new_alert/SocketAlert's job exclusively).
export interface SocketAlertsChanged {
  alertId: string
  patientId: string
}

// ─── Sessions (Y5.3) ───────────────────────────────────────────────────────────
// Mirrors GET /users/me/sessions' response EXACTLY, one field at a time,
// after direct inspection of backend/src/modules/users/user.routes.ts
// (`res.json(sessions.map(s => ({ id, current, userAgent, createdAt,
// lastUsedAt, expiresAt })))`) — a flat array, no wrapper object. `id` is
// the RefreshToken row's stable `sid` (Y5.2), used only as the DELETE
// path parameter to revoke this specific session — never displayed
// prominently in the UI. Deliberately excludes anything the backend does
// not and must not return: tokenHash, the raw refresh JWT/cookie value, the
// access token, or any password/passwordHash — this type is the frontend's
// own safety net against ever widening the session contract to carry one of
// those, even if a future backend change accidentally did.
export interface Session {
  id: string
  // Authoritative from the backend's own resolveCurrentSession (derived
  // from the caller's actual refresh cookie/sid) — never re-derived on the
  // frontend from userAgent equality, list order, or createdAt.
  current: boolean
  userAgent: string | null
  createdAt: string
  lastUsedAt: string
  expiresAt: string
}

// DELETE /users/me/sessions/:sessionId's response shape — `currentRevoked`
// tells the frontend whether the session just deleted was the caller's own
// current one (the backend already cleared the refresh cookie server-side
// in that case), so the frontend knows to run its local logout
// finalization instead of just refetching the list.
export interface RevokeSessionResponse {
  success: true
  currentRevoked: boolean
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
  // U8.2B — only present when a `targetId` deep-link resolution was
  // requested; absent (undefined) for every ordinary paginated call.
  targetResolved?: boolean
}

export interface ApiError {
  error: string
  statusCode: number
  details?: Record<string, string>
}

// ─── NEW S2E — Risk projections (S2D read API) ─────────────────────────────
// GET /api/risk-forecasts/patient/:patientId/current. Mirrors the S2D
// allowlist serializer (forecast.serializer.ts) — bridge internals
// (appliedLogit, sexUsed, bridge ids), the input fingerprint and R
// provenance are never on the wire and are deliberately not typed here.
// A PROJECTION is never an observed event, a HealthRecord, a Prediction or
// an Alert.
export type ForecastLifecycle = 'ACTIVE' | 'PATIENT_INACTIVE'
export type ForecastEligibilityStatus =
  | 'HISTORY_ABSENT' | 'HISTORY_INVALID' | 'CLINICAL_HISTORY_INSUFFICIENT'
  | 'FREQUENCY_UNRELIABLE' | 'FORECAST_ELIGIBLE'
export type ForecastGenerationStatus =
  | 'NOT_APPLICABLE' | 'GENERATED_FULL' | 'GENERATED_PARTIAL' | 'NONE_ADMISSIBLE' | 'FAILED'
export type ForecastRiskInterpretation = 'GLOBAL' | 'INDIVIDUALIZED_BRIDGE'
// Forecast risk level is LOW/MODERATE/HIGH only — CRITICAL is an Alert
// severity, never a projection level.
export type ForecastRiskLevel = 'LOW' | 'MODERATE' | 'HIGH'
export type ForecastBridgeReason =
  | 'BRIDGE_MISSING' | 'BRIDGE_ANCHOR_MISMATCH' | 'BRIDGE_STATE_INVALID'
  | 'BRIDGE_MODEL_VERSION_MISMATCH' | 'BRIDGE_PERSONALIZATION_VERSION_MISMATCH'
  | 'BRIDGE_VERSION_MISMATCH' | 'BRIDGE_SEX_MISMATCH' | 'BRIDGE_AGE_MISMATCH'
  | 'R_TIME_AXIS_MISMATCH'

export interface ForecastAssumptionFlags {
  cigsForcedZero: boolean
  ageChangedFromAnchor: boolean
}

export interface RiskProjection {
  horizonIndex: number
  targetDate: string            // "YYYY-MM-DD" — a DATE, not an appointment time
  targetAge: number
  simulatedState: Record<string, number>
  featureProvenance: Record<string, string>
  assumptionFlags: ForecastAssumptionFlags
  // NEW S4 — S-FEAT-SEQUENTIAL-ROBUST-1 per-horizon context (null on pre-S4 sets):
  // which earlier simulated horizons of the same run fed this horizon's trend.
  sequentialContext?: {
    realRecordCount: number | null
    simulatedContext: string[]
    weights: { ordinaryReal: number; latestReal: number; simulated: number } | null
    features: Record<string, { rawSlope: number; trendConsistency: number; effectiveSlope: number }> | null
  } | null
  globalRiskScore: number       // 0–1
  finalRiskScore: number        // 0–1 — primary displayed value
  riskLevel: ForecastRiskLevel  // authoritative; never re-derived client-side
}

export interface RiskProjectionSet {
  kind: 'RISK_PROJECTION_SET'
  id: string
  isCurrent: boolean
  trigger: string
  createdAt: string
  eligibility: { status: ForecastEligibilityStatus; reason: string | null; counts: unknown }
  generation: { status: ForecastGenerationStatus; reason: string | null }
  anchor: {
    healthRecordId: string
    knowledgeCutoff: string | null
    cutoffLocalDay: string | null   // "YYYY-MM-DD" — last REAL record's clinical day
    clinicalTimeSource: ClinicalTimeSource | null
  } | null
  cadence: {
    deltaDaysRaw: number | null
    deltaDays: number | null
    method: string | null
    reason: string | null
    evidence: unknown
    // NEW S4 — S-CAD-3: exact horizon intervals (cumulative target dates);
    // multimodal = two-mode cadence (no single cadence value).
    intervalsDays?: number[]
    multimodal?: { modes: Array<{ label: string; valueDays: number }>; latestMode: string | null; sequence: string[] } | null
  }
  riskInterpretation: ForecastRiskInterpretation | null
  rBridgeReason: ForecastBridgeReason | string | null
  versions: {
    sVersion: string
    featurePolicyVersion: string
    clinicalTimePolicyVersion: string
    cadencePolicyVersion: string
    modelVersion: string
  }
  versionStale: boolean
  modelContractVerified: boolean
  uncertainty: 'NOT_QUANTIFIED'
  projections: RiskProjection[]
}

export interface CurrentRiskProjectionResponse {
  patientId: string
  lifecycle: ForecastLifecycle | string
  data: RiskProjectionSet | null
}

// risk_forecasts_changed → patient:{patientId} room. Invalidation-only:
// receivers refetch CURRENT, never build state from this payload. Not an
// Alert, not a notification, no unread effect.
export interface SocketRiskForecastsChanged {
  patientId: string
  currentSetId: string | null
  cause: string
}
