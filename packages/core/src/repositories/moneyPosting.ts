/**
 * Shared money-posting helpers.
 *
 * Seed of CQ-3 (docs/plans/todo_plans/COUNTERPARTY_CONSOLIDATION_PLAN.md):
 * this file is the eventual home for `insertPaymentRow(db, tenantId, {...})`
 * and `applyDrawerDelta(db, tenantId, drawer, currency, delta)` — the shared
 * posting primitives every money repository currently hand-rolls as local
 * prepared-statement wrappers. That migration is future work; this wave
 * (Payment-Legs Integrity plan, owner decision S2) seeds the file with
 * `reconcileLegs`, the repo-layer hard-reject check.
 *
 * ─── The invariant (S2) ──────────────────────────────────────────────────
 *
 *   sum(IN legs) − sum(OUT change legs) − kept_change = expected total
 *
 * evaluated at the transaction's stamped exchange rate, epsilon $0.05
 * USD-equivalent (~5,000 LBP at typical rates). IN legs include EVERY
 * tender kind a flow accepts — cash/method legs, CUSTOMER_ACCOUNT legs (the
 * on-account remainder counts toward the total; the name+phone identity
 * requirement for account legs is enforced elsewhere, not here), and
 * voucher/GIFT_CARD legs where the flow supports them. OUT legs are the
 * change handed back to the customer (`partitionLegs` direction OUT).
 * `kept_change` (T3) is tender the shop keeps as profit instead of
 * returning — flows that don't support it simply never pass it (treated as
 * 0). A mismatch throws BEFORE any row is written, provided the caller
 * invokes this at the top of a flow's leg-processing, inside the same
 * `db.transaction(...)` the flow already runs in — a throw there unwinds
 * every statement the transaction executed so far (nothing partial
 * persists). Callers with NO legs at all (legacy/scripted callers using a
 * bare `paidByMethod`/`cashoutMethod`) never reach this check — it no-ops
 * on an empty/undefined `inLegs`.
 *
 * `reconcileLegs` deliberately does NOT re-run `partitionLegs` itself —
 * every call site already partitions once at the top of its flow (rule 16)
 * and threads the IN/OUT arrays through; passing the pre-partitioned arrays
 * here avoids a second partitioning pass disagreeing with the first.
 */

/** Minimal leg shape this module needs — a structural subset of every
 *  repo's own `payments[]` leg type (CreateFinancialServiceData, RechargeData, …). */
export interface ReconciliationLeg {
  method: string;
  currencyCode: string;
  amount: number;
  direction?: "IN" | "OUT";
}

/** T3 kept-change: tender the shop keeps as profit instead of returning.
 *  Flows that don't support kept-change simply never pass this (defaults
 *  to 0 in both currencies). */
export interface KeptChange {
  usd?: number;
  lbp?: number;
}

/** The customer's required total for this transaction, split by currency.
 *  Always derive this from the flow's OWN math (see call sites for the
 *  per-branch derivation) — never invent an independent notion of "total". */
export interface ExpectedTotals {
  usd: number;
  lbp: number;
}

export interface ReconcileLegsInput {
  /**
   * Customer-tender legs: any kind (cash/method, CUSTOMER_ACCOUNT, voucher).
   * Pass the flow's OWN pre-partitioned IN-leg array (rule 16) — NOT the raw
   * `data.payments` if the flow has already stripped OUT legs into a
   * separate variable (most repos reassign `data.payments` to the IN-only
   * set at the top of `createTransaction`/`processRecharge`; pass that same
   * reference here).
   */
  inLegs: ReconciliationLeg[] | undefined | null;
  /**
   * Change/return legs that reduce what the IN legs need to cover. Omit (or
   * pass an empty array) for flows where an OUT leg is NOT part of this
   * total — e.g. a RECEIVE payout, where the shop pays the customer and any
   * OUT-tagged leg is a distinct, separately-processed mechanism rather than
   * "change" on a customer payment.
   */
  outLegs?: ReconciliationLeg[] | undefined | null;
  keptChange?: KeptChange;
  expectedTotals: ExpectedTotals;
  /**
   * The rate to convert cross-currency legs at for THIS reconciliation —
   * normally the same rate the caller stamps on `transactions.exchange_rate`
   * (`data.exchangeRate ?? getUsdLbpSellRate(db)`). Payment-Legs Integrity
   * plan (Wave 9, lira-095): a caller MAY instead pass the rate its own
   * till/MultiPaymentInput actually converted the customer's tender at
   * (`tender_exchange_rate`), when that differs from the stamped
   * rate-of-record — reconciliation must compare at the SAME rate the till
   * used, or a legitimate buy/sell-spread checkout false-rejects. Either way,
   * never an independent/live lookup performed by this function itself.
   */
  exchangeRate: number;
  /** Human-readable label for the thrown error (e.g. "WHISH_APP SEND"). */
  context: string;
}

/** $0.05 USD-equivalent — roughly 5,000 LBP at typical (~90,000-100,000)
 *  USD/LBP sell rates. Owner-specified (S2). */
export const LEG_RECONCILIATION_EPSILON_USD = 0.05;

function usdEquivalent(usd: number, lbp: number, exchangeRate: number): number {
  return usd + (exchangeRate > 0 ? lbp / exchangeRate : 0);
}

function sumLegsByCurrency(
  legs: ReconciliationLeg[],
  context: string,
): { usd: number; lbp: number } {
  let usd = 0;
  let lbp = 0;
  for (const leg of legs) {
    const amt = Math.abs(leg.amount);
    if (amt === 0) continue;
    if (leg.currencyCode === "USD") usd += amt;
    else if (leg.currencyCode === "LBP") lbp += amt;
    else {
      throw new Error(
        `${context}: payment leg currency "${leg.currencyCode}" is not USD or LBP — cannot reconcile`,
      );
    }
  }
  return { usd, lbp };
}

/**
 * Hard-reject leg reconciliation (Payment-Legs Integrity plan, owner
 * decision S2). See the file header for the full invariant. No-op when
 * `inLegs` is empty/undefined/null — legacy/scripted callers with no
 * structured legs at all (the single-payment `paidByMethod`/`cashoutMethod`
 * fallback) are never checked, by design.
 *
 * Throws a descriptive Error naming the expected vs. actual USD-equivalent
 * totals (and the per-currency breakdown) on mismatch. Callers MUST invoke
 * this inside the same `db.transaction(...)` the flow runs in, before
 * writing any leg/drawer/debt row for this branch, so a thrown mismatch
 * rolls back the whole write atomically.
 */
export function reconcileLegs(input: ReconcileLegsInput): void {
  const { inLegs, outLegs, keptChange, expectedTotals, exchangeRate, context } =
    input;
  if (!inLegs || inLegs.length === 0) return;

  const inSums = sumLegsByCurrency(inLegs, context);
  const outSums =
    outLegs && outLegs.length > 0
      ? sumLegsByCurrency(outLegs, context)
      : { usd: 0, lbp: 0 };

  const inUsd = usdEquivalent(inSums.usd, inSums.lbp, exchangeRate);
  const outUsd = usdEquivalent(outSums.usd, outSums.lbp, exchangeRate);
  const keptUsd = usdEquivalent(
    keptChange?.usd ?? 0,
    keptChange?.lbp ?? 0,
    exchangeRate,
  );
  const expectedUsd = usdEquivalent(
    expectedTotals.usd,
    expectedTotals.lbp,
    exchangeRate,
  );

  const gotUsd = inUsd - outUsd - keptUsd;
  const diff = gotUsd - expectedUsd;

  if (Math.abs(diff) > LEG_RECONCILIATION_EPSILON_USD) {
    const money = (n: number) => n.toFixed(2);
    throw new Error(
      `${context}: payment legs do not reconcile — expected $${money(expectedUsd)} USD-equivalent ` +
        `($${money(expectedTotals.usd)} + ${Math.round(expectedTotals.lbp).toLocaleString()} LBP), ` +
        `got $${money(gotUsd)} USD-equivalent (IN $${money(inUsd)}, OUT $${money(outUsd)}, kept $${money(keptUsd)}), ` +
        `diff $${money(diff)} at rate ${exchangeRate}`,
    );
  }
}

/**
 * Build an `ExpectedTotals` from a single amount+currency pair. Every call
 * site's "required total" is denominated in ONE currency (the service/sale
 * currency) at the source — never split across both there.
 */
export function expectedTotalIn(
  amount: number,
  currency: string,
): ExpectedTotals {
  return currency === "LBP" ? { usd: 0, lbp: amount } : { usd: amount, lbp: 0 };
}
