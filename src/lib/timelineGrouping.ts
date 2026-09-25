// W2.2 — pure, presentation-layer partition of an ALREADY-SORTED event
// array into ordered render groups, based solely on each event's own
// (backend-derived, deterministic) `groupId` (patient.timeline.ts,
// buildHealthRecordGroupId). Used identically by PatientCalendar and
// DashboardCalendar — the single shared grouping rule, never duplicated.
//
// Deliberately does NOT:
//   - read eventDate, or re-sort anything — the caller's own existing
//     chronological order (already established by the backend's
//     sortTimelineEvents/sortDashboardCalendarEvents) is preserved exactly,
//     both across groups (first-appearance order) and within a group
//     (stable partition, original relative order);
//   - infer relationships from timestamps, titles, or any heuristic — the
//     only signal read is `groupId` itself;
//   - decide whether a bucket "looks like a group" — collapsing a
//     single-member non-null-groupId bucket into standalone presentation is
//     a rendering decision (see TimelineEventGroup, which checks
//     `events.length`), not something this data-shaping step should bake
//     in, so a caller can always see the real bucket membership.
export interface TimelineRenderGroup<T> {
  // The shared groupId for a real (non-null) group, or null for a
  // standalone (ungrouped) bucket. Informational only — callers decide
  // whether to show grouping chrome from `events.length`, not from this
  // field being non-null (a non-null groupId with exactly one visible
  // member must still render as standalone — see §5 of the W2.1 report).
  groupId: string | null
  events: T[]
}

export function groupTimelineEventsForRender<T extends { id: string; groupId?: string | null }>(
  events: T[],
): TimelineRenderGroup<T>[] {
  const groups: TimelineRenderGroup<T>[] = []
  const bucketByKey = new Map<string, TimelineRenderGroup<T>>()

  for (const event of events) {
    // A null/undefined groupId never merges with another null/undefined
    // groupId event, however many exist — each gets a unique internal key
    // keyed off its own id, so it always becomes a singleton bucket. This
    // internal key is a rendering-only bucketing convenience; it is never
    // exposed, never implies causal provenance, and is unrelated to the
    // `groupId` field itself (which stays `null` on the bucket).
    const key = event.groupId ? `group:${event.groupId}` : `event:${event.id}`
    const existing = bucketByKey.get(key)
    if (existing) {
      existing.events.push(event)
    } else {
      const bucket: TimelineRenderGroup<T> = { groupId: event.groupId ?? null, events: [event] }
      bucketByKey.set(key, bucket)
      groups.push(bucket)
    }
  }

  return groups
}
