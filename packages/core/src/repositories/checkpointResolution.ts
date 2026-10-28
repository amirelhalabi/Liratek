/**
 * LIRA-335 — checkpoint open differences: the resolution engine.
 *
 * A checkpoint posts its counted correction (Over / Short) into the drawer's
 * expected balance and records it as an open difference
 * (`checkpoint_differences`, written by `ClosingRepository.createCheckpoint`).
 * When the owner later re-enters the missed transaction with Set custom time
 * (or an offline transaction is replayed with its event time), that money is
 * ALREADY inside the expected balance — moving the drawer again would count
 * it twice and make the next checkpoint show the opposite difference.
 *
 * `resolveBackTimedDrawerMovement` is called by every money flow at the end
 * of its own db transaction, after all its legs are posted. It:
 *
 *   1. reads the transaction's effective time (`transactions.created_at`:
 *      the custom time, or the offline event time — research R2);
 *   2. nets the transaction's drawer-affecting legs per drawer and currency
 *      (IN and change legs netted once — never a branch over return legs,
 *      rule 16), together with the legs of its auto expense siblings (rule 26:
 *      they are part of the same shop action and carry the same time);
 *   3. for each drawer/currency finds the FIRST checkpoint after that time
 *      that counted that drawer in that currency (research R2; keyed on
 *      `daily_closing_amounts`, so an all-drawers checkpoint counts per
 *      drawer). Only that checkpoint can absorb: later ones are never touched;
 *   4. if that checkpoint has a difference in the same direction (money IN ↔
 *      Over, money OUT ↔ Short) with something still open, posts an
 *      offsetting `CHECKPOINT_RESOLUTION` leg ON THE SAME TRANSACTION for the
 *      smaller of the two amounts (+ the same drawer delta) and records a
 *      resolution row. Anything above the open amount moves the drawer as
 *      today (FR-005);
 *   5. re-derives the Drawer shortage expense of a closed difference it
 *      touched (FR-016).
 *
 * Reversal owners (rule 20, data-model.md):
 *   - the offset leg: the generic void mirrors it (`_reversePayments` mode
 *     "void"); every refund skips it by design (FR-009);
 *   - the resolution row: none — it stops counting once its transaction is
 *     VOIDED (`ACTIVE_RESOLUTION_SQL`, derived, never stored);
 *   - the shortage expense: `syncShortageExpense`, called here and after a
 *     void of a resolving transaction (`resyncShortageAfterVoid`).
 *
 * Server-only: never reachable from `browser.ts` (rule 29).
 */
import type Database from "better-sqlite3";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { closingLogger } from "../utils/logger.js";
import { requestNow } from "../utils/requestNow.js";
import {
  CHECKPOINT_RESOLUTION_METHOD,
  checkpointDifferenceEpsilon,
} from "../constants/checkpointAdjustment.js";
import { applyDrawerDelta, insertPaymentRow } from "./moneyPosting.js";
import { drawerAffectingPayments } from "./ClosingRepository.js";
import { CARRIER_DRAWER_NAMES } from "./CarrierLineRepository.js";
import {
  getCheckpointDifferenceRepository,
  type CheckpointDifferenceView,
} from "./CheckpointDifferenceRepository.js";

export interface CheckpointResolutionResult {
  resolutions: {
    differenceId: number;
    drawer: string;
    currency: string;
    /** Magnitude resolved, signed like the difference (> 0 Over, < 0 Short). */
    amount: number;
  }[];
}

/**
 * Files (paths relative to `packages/core/src`) that save a transaction with
 * a caller-supplied time but do NOT call `resolveBackTimedDrawerMovement`,
 * each with the reason. The wiring guard
 * (`__tests__/checkpointResolution.wiring.guard.test.ts`) fails any other
 * repository that passes `transaction_time` into `createTransaction` without
 * calling the engine, and any entry here that no longer applies.
 */
export const CHECKPOINT_RESOLUTION_EXCLUSIONS: Readonly<
  Record<string, string>
> = {
  "repositories/DrawerCashoutRepository.ts":
    "Owner cash-out from a drawer, not a counter transaction; not in the FR-006 flow list. Follow-up for the owner, same question as top-ups.",
  "repositories/WalletExchangeRepository.ts":
    "Converts the shop's own wallet currency (both legs internal WALLET_EXCHANGE); not in the FR-006 flow list. Follow-up for the owner.",
  "services/SessionPaymentService.ts":
    "Session checkout (research R7): each basket item runs its own module's flow, which calls the engine for the item's own legs, but the customer's pooled payment legs sit on the session (session_id set, transaction_id NULL) — there is no transaction to carry an offset leg or a resolution row, and the basket reversal mirrors pooled legs the same way on void and refund. A back-timed session checkout therefore moves the drawer as today.",
};

/** A checkpoint difference can still take money while anything is open —
 *  OPEN, PARTLY_RESOLVED, and CLOSED (Short or Over) alike (spec FR-016 and
 *  the Closed · Over edge case). The ONE predicate the engine and the
 *  Transaction-time hint share (rule 14). `open` is already 0 within the
 *  currency's tolerance (`describeCheckpointDifference`). */
function canAbsorb(view: CheckpointDifferenceView): boolean {
  return view.open > 0;
}

/**
 * MTC / Alfa drawers are DERIVED from their SIM lines (drawer USD = Σ line
 * credits, verified by every checkpoint). A back-timed recharge moves both
 * the drawer and a line; offsetting only the drawer would break that sum and
 * make the next checkpoint refuse to save. Until an offset can also be
 * applied to the line the transaction used, these drawers resolve nothing
 * and move as today (reported as a follow-up; spec edge case "MTC and Alfa").
 */
function isLineDerivedDrawer(drawer: string, currency: string): boolean {
  return (
    currency === "USD" && Object.values(CARRIER_DRAWER_NAMES).includes(drawer)
  );
}

const tablesPresent = new WeakMap<Database.Database, boolean>();

/** Minimal test schemas (and databases older than v222) have no checkpoint
 *  tables: the engine is then a no-op, never a "no such table" error. */
function hasCheckpointTables(db: Database.Database): boolean {
  const cached = tablesPresent.get(db);
  if (cached !== undefined) return cached;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('checkpoint_differences', 'checkpoint_difference_resolutions', 'daily_closing_amounts')`,
    )
    .get() as { n: number };
  const present = row.n === 3;
  tablesPresent.set(db, present);
  return present;
}

function hasExpenseSourceRef(db: Database.Database): boolean {
  const cols = db.prepare(`PRAGMA table_info(expenses)`).all() as {
    name: string;
  }[];
  return (
    cols.some((c) => c.name === "source_ref_table") &&
    cols.some((c) => c.name === "source_ref_id")
  );
}

interface FirstCheckpointRow {
  drawer_name: string;
  currency_code: string;
  closing_id: number;
}

/**
 * The ONE definition (rule 14) of "the first checkpoint after `at`", per
 * drawer and currency it counted. Ties on the same instant break by id.
 * Timestamps compare through julianday(): both `YYYY-MM-DD HH:MM:SS` and ISO
 * `…Z` text are stored. Optional drawer/currency narrow it for the engine.
 */
function firstCheckpointsAfter(
  db: Database.Database,
  tenantId: number,
  at: string,
  only?: { drawer: string; currency: string },
): FirstCheckpointRow[] {
  const narrow = only
    ? `AND dca.drawer_name = ? AND dca.currency_code = ?`
    : "";
  const params: (string | number)[] = [tenantId, at];
  if (only) params.push(only.drawer, only.currency);
  params.push(at);
  return db
    .prepare(
      `SELECT dca.drawer_name, dca.currency_code, dc.id AS closing_id
         FROM daily_closing_amounts dca
         JOIN daily_closings dc
           ON dc.id = dca.closing_id AND dc.tenant_id = dca.tenant_id
        WHERE dca.tenant_id = ?
          AND julianday(dc.created_at) > julianday(?)
          ${narrow}
          AND NOT EXISTS (
            SELECT 1
              FROM daily_closing_amounts dca2
              JOIN daily_closings dc2
                ON dc2.id = dca2.closing_id AND dc2.tenant_id = dca2.tenant_id
             WHERE dca2.tenant_id = dca.tenant_id
               AND dca2.drawer_name = dca.drawer_name
               AND dca2.currency_code = dca.currency_code
               AND julianday(dc2.created_at) > julianday(?)
               AND (julianday(dc2.created_at) < julianday(dc.created_at)
                    OR (julianday(dc2.created_at) = julianday(dc.created_at)
                        AND dc2.id < dc.id))
          )`,
    )
    .all(...params) as FirstCheckpointRow[];
}

/** Is there any recorded difference on a checkpoint after `at`? The cheap
 *  gate that keeps the engine a single lookup for every ordinary save. */
function anyDifferenceAfter(
  db: Database.Database,
  tenantId: number,
  at: string,
): boolean {
  return !!db
    .prepare(
      `SELECT 1
         FROM checkpoint_differences d
         JOIN daily_closings dc
           ON dc.id = d.closing_id AND dc.tenant_id = d.tenant_id
        WHERE d.tenant_id = ? AND julianday(dc.created_at) > julianday(?)
        LIMIT 1`,
    )
    .get(tenantId, at);
}

/** The view of `closingId`'s difference on this drawer and currency. */
function differenceOf(
  closingId: number,
  drawer: string,
  currency: string,
): CheckpointDifferenceView | undefined {
  const views =
    getCheckpointDifferenceRepository()
      .listForClosings([closingId])
      .get(closingId) ?? [];
  return views.find(
    (v) => v.drawer_name === drawer && v.currency_code === currency,
  );
}

/**
 * Call at the end of a flow's db transaction, after all its legs are
 * posted, on the user-visible (parent) transaction. No-op unless a
 * checkpoint of a touched drawer exists after the transaction's
 * `created_at`. Returns what it did.
 */
export function resolveBackTimedDrawerMovement(
  db: Database.Database,
  input: { transactionId: number; userId: number },
): CheckpointResolutionResult {
  const result: CheckpointResolutionResult = { resolutions: [] };
  if (!hasCheckpointTables(db)) return result;
  const tenantId = getCurrentTenantId();

  const txn = db
    .prepare(
      `SELECT id, created_at, status, reverses_id, source_table, source_id
         FROM transactions WHERE id = ? AND tenant_id = ?`,
    )
    .get(input.transactionId, tenantId) as
    | {
        id: number;
        created_at: string;
        status: string;
        reverses_id: number | null;
        source_table: string | null;
        source_id: number | null;
      }
    | undefined;
  if (!txn || txn.status !== "ACTIVE" || txn.reverses_id != null) {
    return result;
  }
  const at = txn.created_at;
  if (!anyDifferenceAfter(db, tenantId, at)) return result;

  // The parent's own legs plus its auto expense siblings' legs (the same
  // link `_cascadeExpenseSiblingVoid` follows, so a void of the parent
  // reverses both): one shop action, netted once.
  const txnIds: number[] = [txn.id];
  if (txn.source_table && txn.source_id != null && hasExpenseSourceRef(db)) {
    const siblings = db
      .prepare(
        `SELECT t.id
           FROM expenses e
           JOIN transactions t
             ON t.source_table = 'expenses' AND t.source_id = e.id
            AND t.tenant_id = e.tenant_id
          WHERE e.tenant_id = ? AND e.source_ref_table = ? AND e.source_ref_id = ?
            AND t.status = 'ACTIVE' AND t.reverses_id IS NULL`,
      )
      .all(tenantId, txn.source_table, txn.source_id) as { id: number }[];
    for (const s of siblings) txnIds.push(s.id);
  }

  const moved = drawerAffectingPayments();
  const nets = db
    .prepare(
      `SELECT drawer_name, currency_code, SUM(amount) AS net
         FROM payments
        WHERE tenant_id = ?
          AND transaction_id IN (${txnIds.map(() => "?").join(", ")})
          AND ${moved.sql}
          AND method != ?
        GROUP BY drawer_name, currency_code`,
    )
    .all(
      tenantId,
      ...txnIds,
      ...moved.params,
      CHECKPOINT_RESOLUTION_METHOD,
    ) as {
    drawer_name: string;
    currency_code: string;
    net: number;
  }[];

  const touchedClosed = new Set<number>();
  const insertResolution = db.prepare(
    `INSERT INTO checkpoint_difference_resolutions
       (tenant_id, difference_id, transaction_id, amount, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  for (const n of nets) {
    // Float dust from netting IN and change legs (e.g. 13.37 − 13.37) is no
    // movement: within the currency's tolerance nothing is resolved.
    if (Math.abs(n.net) <= checkpointDifferenceEpsilon(n.currency_code)) {
      continue;
    }
    if (isLineDerivedDrawer(n.drawer_name, n.currency_code)) continue;
    const [first] = firstCheckpointsAfter(db, tenantId, at, {
      drawer: n.drawer_name,
      currency: n.currency_code,
    });
    if (!first) continue;
    const diff = differenceOf(first.closing_id, n.drawer_name, n.currency_code);
    if (!diff || !canAbsorb(diff)) continue;
    const direction = n.net > 0 ? "OVER" : "SHORT";
    if (diff.direction !== direction) continue;

    const resolved = Math.min(Math.abs(n.net), diff.open);
    const sign = n.net > 0 ? 1 : -1;
    const offset = -sign * resolved;
    insertPaymentRow(db, {
      transactionId: txn.id,
      method: CHECKPOINT_RESOLUTION_METHOD,
      drawerName: n.drawer_name,
      currencyCode: n.currency_code,
      amount: offset,
      note: `Resolves checkpoint #${first.closing_id} (${n.drawer_name})`,
      createdBy: input.userId,
      tenantId,
    });
    applyDrawerDelta(db, {
      drawerName: n.drawer_name,
      currencyCode: n.currency_code,
      delta: offset,
      tenantId,
    });
    const now = requestNow();
    insertResolution.run(tenantId, diff.id, txn.id, sign * resolved, now, now);
    if (diff.closed_at) touchedClosed.add(diff.id);
    result.resolutions.push({
      differenceId: diff.id,
      drawer: n.drawer_name,
      currency: n.currency_code,
      amount: sign * resolved,
    });
  }

  for (const differenceId of touchedClosed) {
    syncShortageExpense(db, { differenceId, userId: input.userId });
  }
  if (result.resolutions.length > 0) {
    closingLogger.info(
      { transactionId: txn.id, at, resolutions: result.resolutions },
      "Back-timed transaction resolved checkpoint difference(s)",
    );
  }
  return result;
}

/** Re-derive a closed SHORT difference's Drawer shortage expense (void +
 *  recreate). Idempotent. The ONE writer is the repository method. */
export function syncShortageExpense(
  _db: Database.Database,
  input: { differenceId: number; userId: number },
): void {
  getCheckpointDifferenceRepository().syncShortageExpense(
    input.differenceId,
    input.userId,
  );
}

/**
 * After a resolving transaction is VOIDED: its resolutions stop counting
 * (derived), so a closed Short's shortage expense grows back (FR-016).
 * Called by `TransactionRepository._voidTransactionInternal` inside the
 * void's own db transaction, after the status flip. No-op otherwise.
 */
export function resyncShortageAfterVoid(
  db: Database.Database,
  input: { transactionId: number; userId: number },
): void {
  if (!hasCheckpointTables(db)) return;
  const rows = db
    .prepare(
      `SELECT DISTINCT r.difference_id AS id
         FROM checkpoint_difference_resolutions r
         JOIN checkpoint_differences d
           ON d.id = r.difference_id AND d.tenant_id = r.tenant_id
        WHERE r.tenant_id = ? AND r.transaction_id = ? AND d.closed_at IS NOT NULL`,
    )
    .all(getCurrentTenantId(), input.transactionId) as { id: number }[];
  for (const r of rows) {
    syncShortageExpense(db, { differenceId: r.id, userId: input.userId });
  }
}

/**
 * Differences that money saved at `at` could still resolve: for every drawer
 * and currency, the first checkpoint after `at` — when its difference has
 * something open (`canAbsorb`, the engine's own predicate). Feeds the hint
 * under Transaction time.
 */
export function getOpenDifferencesAfter(
  db: Database.Database,
  input: { at: string },
): CheckpointDifferenceView[] {
  if (!hasCheckpointTables(db)) return [];
  const tenantId = getCurrentTenantId();
  if (!anyDifferenceAfter(db, tenantId, input.at)) return [];
  const firsts = firstCheckpointsAfter(db, tenantId, input.at);
  if (firsts.length === 0) return [];
  const closingIds = [...new Set(firsts.map((f) => f.closing_id))];
  const byClosing =
    getCheckpointDifferenceRepository().listForClosings(closingIds);
  const out: CheckpointDifferenceView[] = [];
  for (const f of firsts) {
    const view = (byClosing.get(f.closing_id) ?? []).find(
      (v) =>
        v.drawer_name === f.drawer_name && v.currency_code === f.currency_code,
    );
    if (
      view &&
      canAbsorb(view) &&
      !isLineDerivedDrawer(f.drawer_name, f.currency_code)
    ) {
      out.push(view);
    }
  }
  return out;
}
