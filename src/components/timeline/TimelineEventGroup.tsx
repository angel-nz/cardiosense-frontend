import type { ReactNode } from 'react'

interface TimelineEventGroupProps {
  memberCount: number
  children: ReactNode
}

// W2.2 — presentation-only grouping chrome, shared by PatientCalendar and
// DashboardCalendar. Renders its children (already-rendered
// TimelineEventRow / DashboardEventRow elements, in their existing order)
// either:
//   - unwrapped (memberCount < 2) — a standalone event keeps its exact
//     current appearance, no chrome at all ("one-event group should not
//     get misleading heavy group styling");
//   - inside a subtle shared container (memberCount >= 2) — tinted
//     background + left accent rail + tightened internal spacing, enough
//     to communicate "these belong to one clinical scenario" without
//     merging the individual rows into one synthetic card. Each row keeps
//     its own existing background/ring/icon/title/severity styling
//     untouched (see TimelineEventRow/DashboardEventRow — unmodified).
//
// The container is a plain, non-interactive <div>: no onClick, no
// role="button", no tabIndex — it is never a navigation target and is
// never keyboard-focusable (no existing pattern justifies a "scenario"
// destination). Each child event keeps its own real <button> (or
// non-interactive <div> for RISK_CHANGE) exactly as before — those stay
// siblings inside this wrapper, never nested inside another interactive
// element.
// `role="group"` + `aria-label` give screen readers the scenario context
// once, without duplicating each child row's own accessible name.
export function TimelineEventGroup({ memberCount, children }: TimelineEventGroupProps) {
  if (memberCount < 2) return <>{children}</>
  return (
    <div
      role="group"
      aria-label={`Escenario clínico: ${memberCount} eventos relacionados`}
      className="rounded-lg bg-accent/20 border-l-2 border-primary/30 pl-2 py-1 space-y-0.5"
    >
      {children}
    </div>
  )
}
