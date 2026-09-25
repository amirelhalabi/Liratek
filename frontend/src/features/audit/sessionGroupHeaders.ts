/**
 * LIRA-201b (owner note #11-B) — which ONE row of a customer-session basket
 * carries the pooled in/out + payment detail on screen and on export.
 *
 * Pre-fix, EVERY session member inherited the whole basket's pooled legs
 * into its own `row.payments` (TransactionRepository._attachPaymentLegs),
 * so a -400,000 LBP loto prize row and a 1,280,000 LBP ticket row printed
 * the identical pooled summary — the owner's reported "duplicate summary".
 * The backend now exposes the pool on EVERY member's `session_payments` /
 * `session_account_payments` (TransactionWithUser), and the viewer decides
 * which single member renders it, via this module.
 *
 * Pure and dependency-free (row-in/Map-out) so it is unit-testable without
 * rendering the table, same rationale as the other `../audit` modules.
 */
import type { TransactionRow } from "./hooks/useTransactionRows";

/** Whether `row` actually carries any of its session's pooled basket legs
 *  (cash or on-account) — see `TransactionRow.session_payments`'s doc. A
 *  session with NO pooled legs on any member (e.g. every item is on-account
 *  with nothing pooled, or the session was built purely via
 *  `session:linkTransaction` with no basket payment at all) must get no
 *  header at all: there is nothing to summarize once. */
function hasPooledLegs(row: TransactionRow): boolean {
  return (
    (row.session_payments?.length ?? 0) > 0 ||
    (row.session_account_payments?.length ?? 0) > 0
  );
}

/**
 * Map of session_id -> the id of the row chosen to render that session's
 * pooled header, computed from whatever rows are CURRENTLY VISIBLE (the
 * caller's already-filtered, already-fetched set — `TransactionsViewer`
 * passes its `filteredRows`, the same array `DataTable` is given as `data`).
 *
 * Deliberately computed from that pre-sort, pre-export set rather than from
 * DataTable's own sorted row order:
 *  - survives column sorting — sorting only changes WHERE a row renders,
 *    never its id, so the designated header id still designates the same
 *    row wherever it lands after a sort;
 *  - survives a type filter that hides some session members — recomputed
 *    from whatever subset is actually visible, so if today's header member
 *    gets filtered out, the lowest-id member still present picks it up
 *    instead of the pooled summary silently vanishing from the table;
 *  - survives the fetch/LIMIT window — same reasoning: only members that
 *    were actually returned are ever considered, and a single surviving
 *    member is automatically its own session's header;
 *  - survives Excel/PDF export — DataTable's export walks the SAME `data`
 *    array (ignoring only its own on-screen pagination, which this page
 *    doesn't use), via the SAME `exportRow`/`renderRow` closures, so the
 *    export sees an identical header choice to the screen.
 *
 * M2 (fix round) — a row is only a HEADER CANDIDATE if it actually carries
 * pooled legs (`hasPooledLegs`). Pre-fix, the header was picked from ALL
 * session members regardless, so a session with no pooled basket payment at
 * all (an all-on-account basket, or one built purely via
 * `session:linkTransaction`) still got a "pooled basket total" marker on a
 * row whose Summary line showed only its own (unrelated) legs. A session
 * with no pooled-leg-carrying member anywhere in the visible set therefore
 * gets NO entry in the returned map — every member renders as a plain row.
 *
 * m2 (fix round) — among candidates, a VOIDED row is skipped when a
 * non-voided candidate exists, so the pooled total doesn't render
 * struck-through by default; if every candidate happens to be voided, the
 * lowest-id one is still chosen rather than dropping the header entirely.
 *
 * The lowest transaction id (within the eligible pool) is the deterministic
 * tie-breaker — ids are assigned in insertion order, so this is also
 * "whichever eligible member was created first" — stable across reloads for
 * the same underlying data.
 */
export function computeSessionGroupHeaders(
  rows: readonly TransactionRow[],
): Map<number, number> {
  const candidatesBySession = new Map<number, TransactionRow[]>();
  for (const row of rows) {
    if (row.session_id == null || !hasPooledLegs(row)) continue;
    const list = candidatesBySession.get(row.session_id) ?? [];
    list.push(row);
    candidatesBySession.set(row.session_id, list);
  }

  const headerBySession = new Map<number, number>();
  for (const [sessionId, candidates] of candidatesBySession) {
    const nonVoided = candidates.filter((r) => r.status !== "VOIDED");
    const pool = nonVoided.length > 0 ? nonVoided : candidates;
    const headerId = pool.reduce(
      (min, r) => (r.id < min ? r.id : min),
      pool[0]!.id,
    );
    headerBySession.set(sessionId, headerId);
  }
  return headerBySession;
}

/** Whether `row` is the chosen header for its session, given a map already
 *  computed by `computeSessionGroupHeaders`. False for every non-session row. */
export function isSessionGroupHeader(
  row: Pick<TransactionRow, "id" | "session_id">,
  headerBySession: Map<number, number>,
): boolean {
  return (
    row.session_id != null && headerBySession.get(row.session_id) === row.id
  );
}
