/**
 * How often each surface re-polls, per transport — defined ONCE.
 *
 * Three separate components had their own hardcoded interval, which is how the
 * session context ended up making roughly two requests per second on web
 * without anyone intending it. Naming the policy in one file means the next
 * poller inherits a considered number instead of inventing one.
 *
 * ── Why the two transports differ by so much ──
 *
 * Desktop reads a local SQLite file over IPC: microseconds, no network, so a
 * tight poll is nearly free and gives the counter staff instant cross-machine
 * updates on a shop LAN.
 *
 * Web is an HTTP round trip per call. The same cadence there is most of the
 * backend's traffic, for data that rarely changes.
 *
 * ── Why web can afford to be slow now ──
 *
 * The backend pushes `data:invalidate` after every successful write
 * (backend/src/middleware/invalidateOnMutation.ts), and `@/api/realtime`
 * delivers it, so a change made by another client lands in well under a
 * second. These intervals are a SAFETY NET for what push cannot guarantee — a
 * dropped socket, a slept laptop, a missed event — not the freshness
 * mechanism.
 *
 * They are deliberately NOT removed. Push without reconciliation diverges
 * silently, and a silently stale drawer figure is one someone acts on.
 */

import { isElectron } from "./backendApi";

const desktop = isElectron();

export const POLL_MS = {
  /** Active-session list, cart and session transactions. */
  sessionState: desktop ? 3_000 : 60_000,
  /** Active-session reconciliation — clears a session closed elsewhere. */
  sessionReconcile: desktop ? 7_000 : 120_000,
  /** Dashboard aggregates (sales, drawers, debts). */
  dashboard: desktop ? 30_000 : 120_000,
  /** Top bar drawer balances and threshold notifications. */
  topBar: desktop ? 60_000 : 180_000,
} as const;

/**
 * Never poll a backgrounded tab. A hidden tab polling forever is pure waste,
 * and it is the difference between a laptop left open overnight costing nothing
 * and it making ~200k requests. Always true outside a browser.
 */
export function isTabVisible(): boolean {
  return (
    typeof document === "undefined" || document.visibilityState !== "hidden"
  );
}
