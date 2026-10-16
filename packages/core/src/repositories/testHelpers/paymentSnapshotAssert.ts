/**
 * LIRA-329 T036 — the ONE check that a transaction's `payment_snapshot`
 * (the copy saved for reading) says the same thing as the `payments` rows
 * the flow actually booked (the source of truth for drawers).
 *
 * Compared as a multiset of `{ method, currency, amount, direction }`:
 *  - `payments.amount` is a signed DRAWER delta, while a snapshot line keeps
 *    the unsigned amount plus the flow direction (a payout leg is IN in the
 *    snapshot but negative in `payments`), so the sign says nothing about
 *    direction. Direction is read from the change marker instead: the shared
 *    end-of-transaction OUT loops note their rows "Change returned", and
 *    POS / Maintenance cash change is posted as "Change given".
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

const CHANGE_NOTE = /^Change (returned|given)\b/;

export interface PaymentRowForSnapshot {
  method: string;
  currency_code: string;
  amount: number;
  drawer_name: string;
  note: string | null;
}

export interface SnapshotPaymentsOptions {
  /** `payments` rows of the transaction that are NOT customer lines
   *  (internal bookkeeping) — each caller says which and why. */
  excludeRow?: (row: PaymentRowForSnapshot) => boolean;
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
    const raw = (JSON.parse(t.metadata_json) as Record<string, unknown>)
      .payment_snapshot;
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
      .filter((r) => !(opts.excludeRow?.(r) ?? false))
      .map((r) =>
        key({
          method: r.method,
          currency: r.currency_code,
          amount: Math.abs(r.amount),
          direction: CHANGE_NOTE.test(r.note ?? "") ? "OUT" : "IN",
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
