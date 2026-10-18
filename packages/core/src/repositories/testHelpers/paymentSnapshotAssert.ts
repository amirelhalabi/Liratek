/**
 * LIRA-329 T036 — the ONE check that a transaction's `payment_snapshot`
 * (the copy saved for reading) says the same thing as the `payments` rows
 * the flow actually booked (the source of truth for drawers).
 *
 * Compared as a multiset of `{ method, currency, amount, direction }`:
 *  - `payments.amount` is a signed DRAWER delta, and a snapshot line keeps
 *    the unsigned amount plus the way the money moved for the shop's drawer
 *    (shop-day fix: a payout leg is OUT, change handed back on a sale is
 *    OUT, change a vendor/supplier hands back on a payout is IN). So the
 *    row's sign IS the line's direction: amount < 0 → OUT, otherwise IN.
 *  - Each caller names what it leaves out, with the reason, through the
 *    options: `payments` rows that are internal bookkeeping (not a line the
 *    customer saw), and snapshot methods this flow books without a
 *    `payments` row (e.g. CUSTOMER_ACCOUNT, which books a debt row).
 *
 * Every transaction in the database whose snapshot has at least one line is
 * checked, so an `afterEach` covers every case of a test file at once.
 * Test-only.
 */
import type Database from "better-sqlite3";
import { paymentSnapshotSchema } from "../../validators/transactionDetails";
import { CHECKPOINT_RESOLUTION_METHOD } from "../../constants/checkpointAdjustment";

export interface PaymentRowForSnapshot {
  method: string;
  currency_code: string;
  amount: number;
  drawer_name: string;
  note: string | null;
}

export interface SnapshotPaymentsOptions {
  /** `payments` rows of the transaction that are NOT customer lines
   *  (internal bookkeeping) — each caller says which and why. Gets the
   *  transaction too (its parsed `metadata_json`), for a rule that depends
   *  on the kind of transaction. */
  excludeRow?: (
    row: PaymentRowForSnapshot,
    txn: { id: number; metadata: Record<string, unknown> },
  ) => boolean;
  /** Snapshot line methods this flow records without a `payments` row. */
  unbookedMethods?: readonly string[];
}

/** Internal `payments` rows a Mobile Recharge / financial-service flow books
 *  next to the customer's lines, which are not lines the customer paid or
 *  received: the provider's own balance moving (its row's method is the
 *  provider drawer itself, e.g. method "Alfa" on drawer "Alfa", "WHISH_APP"
 *  on "Whish_App"), the commission row, the payment-method fee row (kept on
 *  the details as `paymentMethodFee`) and the validity-days cost row. */
const PROVIDER_BOOKKEEPING_METHODS: ReadonlySet<string> = new Set([
  "COMMISSION",
  "PM_FEE",
  "VALIDITY_DAYS_COST",
  // LIRA-335: the offset a back-timed transaction posts when it resolves a
  // checkpoint difference — the shop's own books, never a customer line.
  CHECKPOINT_RESOLUTION_METHOD,
]);
export function isProviderBookkeepingRow(row: PaymentRowForSnapshot): boolean {
  return (
    PROVIDER_BOOKKEEPING_METHODS.has(row.method) ||
    row.method.toUpperCase() === row.drawer_name.toUpperCase()
  );
}

interface Line {
  method: string;
  currency: string;
  amount: number;
  direction: "IN" | "OUT";
}

function key(l: Line): string {
  return `${l.direction}|${l.method}|${l.currency}|${Math.round(l.amount * 1e6) / 1e6}`;
}

/** Checks every snapshotted transaction; returns how many were checked. */
export function expectEverySnapshotMatchesPayments(
  db: Database.Database,
  opts: SnapshotPaymentsOptions = {},
): number {
  const txns = db
    /* tenant-exempt: test-only helper — single-tenant in-memory test database */
    .prepare(
      `SELECT id, metadata_json FROM transactions
        WHERE metadata_json LIKE '%"payment_snapshot"%'`,
    )
    .all() as Array<{ id: number; metadata_json: string }>;
  let checked = 0;
  for (const t of txns) {
    const metadata = JSON.parse(t.metadata_json) as Record<string, unknown>;
    const raw = metadata.payment_snapshot;
    const snap = paymentSnapshotSchema.parse(raw);
    if (snap.lines.length === 0) continue;
    const unbooked = new Set(opts.unbookedMethods ?? []);
    const fromSnapshot = snap.lines
      .filter((l) => !unbooked.has(l.method))
      .map((l) =>
        key({
          method: l.method,
          currency: l.currency,
          amount: l.amount,
          direction: l.direction,
        }),
      )
      .sort();
    const rows = db
      /* tenant-exempt: test-only helper — single-tenant in-memory test database */
      .prepare(
        `SELECT method, currency_code, amount, drawer_name, note
           FROM payments WHERE transaction_id = ? ORDER BY id`,
      )
      .all(t.id) as PaymentRowForSnapshot[];
    const fromPayments = rows
      // LIRA-335: a checkpoint-resolution offset is never on the snapshot
      // (it is added after the flow's legs, by the engine) — for every
      // flow, so it is left out here rather than by each caller.
      .filter((r) => r.method !== CHECKPOINT_RESOLUTION_METHOD)
      .filter((r) => !(opts.excludeRow?.(r, { id: t.id, metadata }) ?? false))
      .map((r) =>
        key({
          method: r.method,
          currency: r.currency_code,
          amount: Math.abs(r.amount),
          direction: r.amount < 0 ? "OUT" : "IN",
        }),
      )
      .sort();
    expect({ transaction: t.id, lines: fromSnapshot }).toEqual({
      transaction: t.id,
      lines: fromPayments,
    });
    checked++;
  }
  return checked;
}
