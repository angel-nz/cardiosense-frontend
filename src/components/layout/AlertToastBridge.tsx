import { useEffect } from 'react'
import { useSocket } from '@/context/SocketContext'
import { useToast } from '@/context/ToastContext'

// Z3 §2/§8 — forwards SocketContext's realtime `lastAlert` (INT-18) into
// the global toast coordinator. Rendered once, inside AppLayout
// (authenticated scope only — clinical alerts are only ever meaningful for
// a logged-in doctor), replacing AppLayout's previous direct
// `{lastAlert && <AlertToast .../>}` render. Renders nothing itself —
// purely a bridge component.
//
// Ownership: this is now the SOLE consumer that calls `clearLastAlert()`,
// exactly the same single-owner contract the old direct-render AppLayout
// code held (see AlertsContext.tsx / PatientCalendar.tsx / AlertsPage.tsx —
// each reads `lastAlert` independently and deliberately never clears it,
// deferring to what their own comments call "AppLayout's toast"; that role
// now belongs to this bridge instead, unchanged in every other respect).
//
// Keyed by `lastAlert` itself (object identity, set fresh on every
// `new_alert` — see SocketContext.tsx) so a React rerender that leaves
// `lastAlert` pointing at the SAME alert never re-enqueues it (Z3 §7); the
// coordinator's own `enqueueClinicalAlert` adds a second, id-based dedup
// guard on top of this.
//
// Clears `lastAlert` immediately after handing it to the coordinator,
// rather than only once its toast is later dismissed (which is effectively
// what the old direct-render version did, since it kept `lastAlert` truthy
// for the toast's entire ~8s visible lifetime). This shrinks — never
// changes — the pre-existing, documented "`lastAlert` is a scalar, not a
// queue" limitation (SocketContext.tsx): a second `new_alert` now only
// risks clobbering an unprocessed value for a single render tick, instead
// of for the toast's whole visible duration. `new_alert`/`alerts_changed`
// emission and Alert persistence themselves are untouched.
export function AlertToastBridge() {
  const { lastAlert, clearLastAlert } = useSocket()
  const { enqueueClinicalAlert } = useToast()

  useEffect(() => {
    if (!lastAlert) return
    enqueueClinicalAlert(lastAlert)
    clearLastAlert()
  }, [lastAlert, enqueueClinicalAlert, clearLastAlert])

  return null
}
