import { api } from './api'
import type {
  PatientTimelineEvent, ClinicalRecordTimelineEvent, PredictionTimelineEvent,
  AlertTimelineEvent, RiskChangeTimelineEvent, RiskLevel, AlertSeverity,
} from '@/types'

// ─── Backend wire shape (patient.timeline.ts) ──────────────────────────────
// riskLevel/fromLevel/toLevel/severity arrive uppercase from Prisma enums,
// same as every other prediction/alert endpoint — normalized to lowercase
// here, exactly like predictionService.ts/alertService.ts already do.
interface BackendTimelineEvent {
  id: string
  patientId: string
  eventType: 'CLINICAL_RECORD' | 'PREDICTION' | 'ALERT' | 'RISK_CHANGE'
  eventDate: string
  metadata: Record<string, unknown>
}

function normalizeEvent(raw: BackendTimelineEvent): PatientTimelineEvent {
  const base = { id: raw.id, patientId: raw.patientId, eventDate: raw.eventDate }
  switch (raw.eventType) {
    case 'CLINICAL_RECORD':
      return {
        ...base,
        eventType: 'CLINICAL_RECORD',
        metadata: {
          healthRecordId: raw.metadata.healthRecordId as string,
          sysBP: Number(raw.metadata.sysBP),
          diaBP: Number(raw.metadata.diaBP),
        },
      } satisfies ClinicalRecordTimelineEvent
    case 'PREDICTION':
      return {
        ...base,
        eventType: 'PREDICTION',
        metadata: {
          predictionId: raw.metadata.predictionId as string,
          healthRecordId: (raw.metadata.healthRecordId as string | null) ?? null,
          riskScore: Number(raw.metadata.riskScore),
          riskLevel: (raw.metadata.riskLevel as string).toLowerCase() as RiskLevel,
          isAnomaly: Boolean(raw.metadata.isAnomaly),
          anomalyScore: raw.metadata.anomalyScore == null ? null : Number(raw.metadata.anomalyScore),
          modelVersion: (raw.metadata.modelVersion as string | null) ?? null,
        },
      } satisfies PredictionTimelineEvent
    case 'ALERT':
      return {
        ...base,
        eventType: 'ALERT',
        metadata: {
          alertId: raw.metadata.alertId as string,
          predictionId: (raw.metadata.predictionId as string | null) ?? null,
          severity: (raw.metadata.severity as string).toLowerCase() as AlertSeverity,
          message: raw.metadata.message as string,
          isRead: Boolean(raw.metadata.isRead),
        },
      } satisfies AlertTimelineEvent
    case 'RISK_CHANGE':
      return {
        ...base,
        eventType: 'RISK_CHANGE',
        metadata: {
          fromLevel: (raw.metadata.fromLevel as string).toLowerCase() as RiskLevel,
          toLevel: (raw.metadata.toLevel as string).toLowerCase() as RiskLevel,
          previousPredictionId: raw.metadata.previousPredictionId as string,
          currentPredictionId: raw.metadata.currentPredictionId as string,
        },
      } satisfies RiskChangeTimelineEvent
  }
}

export const timelineService = {
  // GET /api/patients/:patientId/timeline?from=YYYY-MM-DD&to=YYYY-MM-DD
  // from/to are plain calendar-date strings — the backend resolves them to
  // instant boundaries in America/Mexico_City (patient.timeline.dto.ts);
  // no timezone conversion happens on this side of the request.
  async getPatientTimeline(
    patientId: string,
    range: { from?: string; to?: string } = {},
  ): Promise<PatientTimelineEvent[]> {
    const { data } = await api.get<{ data: BackendTimelineEvent[] }>(
      `/patients/${patientId}/timeline`,
      { params: range },
    )
    return data.data.map(normalizeEvent)
  },
}
