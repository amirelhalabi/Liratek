/**
 * LIRA-329 — the ONE builder of `metadata_json.payment_snapshot` (rule 14).
 *
 * A copy, for reading, of how the customer paid at the moment of saving:
 * every payment line (method, currency, amount, direction), the change
 * handed back, and the change the customer left with the shop. The
 * `payments` table stays the source of truth for drawers; this never posts
 * anything.
 *
 * Each line records the way the money ACTUALLY moved for the shop's drawer
 * (owner decision, shop-day 2026-10-16) — defined ONCE here, in
 * `snapshotLineDirection` (rule 14):
 *   - the flow's own legs move the flow's way: on an IN flow (the customer
 *     pays the shop) they are IN; on a PAYOUT flow (the shop pays out — a
 *     prize, a pickup, an expense, a supplier / partner payment, a debt
 *     cash-out, a transfer payout) they are OUT;
 *   - a change leg (`direction: "OUT"`, split by `partitionLegs`, the SAME
 *     rule every money repository books by, rule 16) moves the other way:
 *     change handed back on a sale is OUT, change a vendor / supplier hands
 *     back on a payout is IN;
 *   - a fee collected and what the customer hands over on a cash-out are
 *     always IN.
 * That is exactly the sign of the `payments` row each leg books.
 *
 * Pure, imports only pure leaves, so it stays browser-safe (rule 29).
 */
import { partitionLegs, type PaymentDirection } from "./paymentLegs.js";
import type { PaymentSnapshot } from "../validators/transactionDetails.js";

/**
 * Which way a flow's own legs move money for the shop's drawer:
 * - `IN`     — the customer (or counterparty) pays the shop;
 * - `PAYOUT` — the shop pays money out.
 */
export type PaymentFlow = "IN" | "PAYOUT";

/** A leg as the repositories receive it — camelCase (`currencyCode`) or
 *  snake_case (`currency_code`), both shapes exist on the wire. */
export interface PaymentSnapshotLegInput {
  method: string;
  amount: number;
  currencyCode?: string;
  currency_code?: string;
  /** `"OUT"` marks a change leg (it moves against the flow). */
  direction?: PaymentDirection;
  /** This leg's own flow, when one transaction carries legs of both flows
   *  (an account settlement paying in one currency and collecting in the
   *  other). Defaults to the input's `flow`. */
  flow?: PaymentFlow;
}

/**
 * The direction a snapshot line records: the flow's own leg moves the flow's
 * way, a change leg moves the other way. THE one definition (rule 14).
 */
export function snapshotLineDirection(
  flow: PaymentFlow,
  leg: { direction?: PaymentDirection },
): PaymentDirection {
  const own: PaymentDirection = flow === "PAYOUT" ? "OUT" : "IN";
  const back: PaymentDirection = own === "IN" ? "OUT" : "IN";
  return partitionLegs([leg]).outLegs.length > 0 ? back : own;
}

interface SnapshotLegsInput {
  /** Which way the flow's own legs move money (see `PaymentFlow`). */
  flow: PaymentFlow;
  /** The flow's payment legs, exactly as the repository books them. */
  payments?: ReadonlyArray<PaymentSnapshotLegInput> | null;
  /** Separate fee-collection legs (e.g. a fee-on-top RECEIVE). Always IN,
   *  kept with the note "fee". */
  feePayments?: ReadonlyArray<PaymentSnapshotLegInput> | null;
  /** LIRA-321 "Customer pays" lines on a wallet / crypto cash-out (what the
   *  customer handed over, next to the payout legs above). Always IN, kept
   *  with the note "customer pays". */
  customerPayments?: ReadonlyArray<PaymentSnapshotLegInput> | null;
  /** Change the customer left with the shop, per currency. */
  keptChange?: { usd?: number; lbp?: number } | null;
  /** Paid as part of a customer-session payment. */
  sessionId?: number | null;
}

/** No lines of its own (a session-basket item, a session sibling row): no
 *  flow to name. */
interface SnapshotNoLegsInput {
  flow?: undefined;
  payments?: undefined;
  feePayments?: undefined;
  customerPayments?: undefined;
  keptChange?: { usd?: number; lbp?: number } | null;
  sessionId?: number | null;
}

/** Any call that records lines must say which way its legs move (`flow`). */
export type BuildPaymentSnapshotInput = SnapshotLegsInput | SnapshotNoLegsInput;

type SnapshotLine = PaymentSnapshot["lines"][number];

function toLine(
  leg: PaymentSnapshotLegInput,
  direction: PaymentDirection,
  note?: string,
): SnapshotLine | null {
  const amount = Math.abs(leg.amount);
  const currency = leg.currencyCode ?? leg.currency_code;
  // A zero line moves nothing (the booking loops skip it too); a line with
  // no currency cannot be read back — omit both rather than invent values.
  if (!amount || !Number.isFinite(amount) || !currency || !leg.method) {
    return null;
  }
  return {
    method: leg.method,
    currency,
    amount,
    direction,
    ...(note ? { note } : {}),
  };
}

/**
 * Build the snapshot. Returns `undefined` when there is nothing to record
 * (no legs, no kept change, no session), so callers can spread it
 * conditionally and an absent snapshot keeps meaning "not recorded".
 */
export function buildPaymentSnapshot(
  input: BuildPaymentSnapshotInput,
): PaymentSnapshot | undefined {
  const { outLegs } = partitionLegs(input.payments ? [...input.payments] : []);
  const lines: SnapshotLine[] = [];
  // Keep the order the cashier entered the legs in.
  for (const leg of input.payments ?? []) {
    const flow = leg.flow ?? input.flow ?? "IN";
    const line = toLine(leg, snapshotLineDirection(flow, leg));
    if (line) lines.push(line);
  }
  for (const leg of input.feePayments ?? []) {
    const line = toLine(leg, "IN", "fee");
    if (line) lines.push(line);
  }
  for (const leg of input.customerPayments ?? []) {
    const line = toLine(leg, "IN", "customer pays");
    if (line) lines.push(line);
  }
  const changeReturned = outLegs
    .map((leg) => toLine(leg, "OUT"))
    .filter((l): l is SnapshotLine => l !== null)
    .map(({ method, currency, amount }) => ({ method, currency, amount }));

  const keptUsd = input.keptChange?.usd ?? 0;
  const keptLbp = input.keptChange?.lbp ?? 0;
  const kept =
    keptUsd > 0 || keptLbp > 0
      ? {
          ...(keptUsd > 0 ? { usd: keptUsd } : {}),
          ...(keptLbp > 0 ? { lbp: keptLbp } : {}),
        }
      : undefined;
  const sessionId =
    input.sessionId != null && input.sessionId > 0
      ? input.sessionId
      : undefined;

  if (lines.length === 0 && !kept && sessionId === undefined) return undefined;
  return {
    lines,
    ...(changeReturned.length > 0 ? { change_returned: changeReturned } : {}),
    ...(kept ? { kept } : {}),
    ...(sessionId !== undefined ? { session_id: sessionId } : {}),
  };
}
