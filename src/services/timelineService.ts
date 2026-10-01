import { api } from './api'
import type {
  PatientTimelineEvent, ClinicalRecordTimelineEvent, PredictionTimelineEvent,
  RiskChangeTimelineEvent, RiskLevel,
} from '@/types'

// ─── Backend wire shape (patient.timeline.ts) ──────────────────────────────
// riskLevel/fromLevel/toLevel arrive uppercase from Prisma enums, same as
// every other prediction endpoint — normalized to lowercase here, exactly
// like predictionService.ts/alertService.ts already do.
// Z2 — 'ALERT' removed from eventType: no calendar/timeline endpoint
// produces Alert-model events anymore.
export interface BackendTimelineEvent {
  id: string
  patientId: string
  eventType: 'CLINICAL_RECORD' | 'PREDICTION' | 'RISK_CHANGE'
  eventDate: string
  metadata: Record<string, unknown>
  // W2.2 — derived, top-level (not nested in metadata), optional/nullable.
  groupId?: string | null
}

export function normalizeEvent(raw: BackendTimelineEvent): PatientTimelineEvent {
  // W2.2 — `groupId` carried through unchanged (never recomputed
  // client-side — lib/timelineGrouping.ts only ever reads it). `?? null`
  // normalizes an absent field the same way as an explicit null, so
  // callers never need to distinguish "omitted" from "null".
  const base = { id: raw.id, patientId: raw.patientId, eventDate: raw.eventDate, groupId: raw.groupId ?? null }
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
