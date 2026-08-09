/**
 * Shared money-posting helpers.
 *
 * Seed of CQ-3 (docs/plans/todo_plans/COUNTERPARTY_CONSOLIDATION_PLAN.md):
 * this file is the home for `insertPaymentRow` and `applyDrawerDelta` — the
 * shared posting primitives every money repository used to hand-roll as
 * local prepared-statement wrappers (a 36-copy drawer-balance upsert and a
 * ~27-copy payments-row INSERT). CQ-3 migrated every repository call site
 * onto these two helpers; repositories still own their SQL orchestration
 * (rule 13) — these are called BY repos, never reach around them. The file
 * was seeded one wave earlier (Payment-Legs Integrity plan, owner decision
 * S2) with `reconcileLegs`, the repo-layer hard-reject check, below.
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

import type Database from "better-sqlite3";
import {
  buildCounterpartyMetadata,
  type CounterpartyKind,
  type CounterpartyFlow,
} from "../validators/counterparty.js";
import { isDrawerAffectingMethod } from "../utils/payments.js";

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
   * The server rate-of-record for THIS reconciliation — normally the same
   * rate the caller stamps on `transactions.exchange_rate`
   * (`data.exchangeRate ?? getUsdLbpSellRate(db)`). Used as-is when
   * `tenderExchangeRate` is absent, and as the band anchor when it is
   * present (see `tenderExchangeRate` below). Never an independent/live
   * lookup performed by this function itself.
   */
  exchangeRate: number;
  /**
   * The rate the caller's OWN till/MultiPaymentInput actually converted the
   * customer's cross-currency tender at (e.g. the buy rate — the owner's
   * 2026-07-06 MPI-buy-rate decision — vs. `exchangeRate`, which is the
   * sell-side stamped rate-of-record for money-in flows). Payment-Legs
   * Integrity plan (Wave 9, lira-095 / the 2026-07-2x false-reject fix):
   * reconciliation must compare at the SAME rate the till used to compute
   * change, or a legitimate buy/sell-spread checkout with change
   * false-rejects even though the till's own math nets to zero.
   *
   * When present AND within `TENDER_RATE_BAND_PCT` of `exchangeRate`,
   * reconciliation converts cross-currency legs at THIS rate instead.
   * When present but OUTSIDE the band, throws a distinct error naming both
   * rates rather than silently accepting an implausible value or silently
   * falling back to `exchangeRate` — a tender rate that far off the day's
   * server rate is more likely a bug (wrong units, stale rate, a typo'd
   * operator edit) than a real spread, and quietly accepting it would let a
   * genuine leg mismatch launder itself as "just a rate difference".
   *
   * Omitted → current/legacy behavior, reconciles at `exchangeRate` alone.
   */
  tenderExchangeRate?: number;
  /** Human-readable label for the thrown error (e.g. "WHISH_APP SEND"). */
  context: string;
}

/** $0.05 USD-equivalent — roughly 5,000 LBP at typical (~90,000-100,000)
 *  USD/LBP sell rates. Owner-specified (S2). */
export const LEG_RECONCILIATION_EPSILON_USD = 0.05;

/**
 * ±10% sanity band for `tenderExchangeRate` against the server rate
 * (Payment-Legs Integrity plan, false-reject fix 2026-07-2x): a real
 * USD/LBP buy/sell spread runs ~1-2%, and an operator's manual edit of the
 * payment sheet's rate field is a small nudge around that (the owner's
 * repro: buy 89,000 vs. sell 90,000 — ~1.1%). A tender rate more than 10%
 * off the server's current rate is not a legitimate spread or edit — it's
 * either a bug (wrong units, a stale cached rate) or an attempt to launder
 * a real leg discrepancy as "just a rate difference". Outside the band,
 * reconciliation throws a distinct, clearly-labeled error instead of
 * silently accepting the value or silently falling back to the server
 * rate (either of which would hide the underlying problem).
 */
export const TENDER_RATE_BAND_PCT = 0.1;

/**
 * Resolves which rate `reconcileLegs` actually converts cross-currency legs
 * at: the tender rate when supplied and within `TENDER_RATE_BAND_PCT` of the
 * server rate, the server rate otherwise (when no tender rate was passed).
 * Throws when a supplied tender rate falls outside the band — see
 * `tenderExchangeRate`'s doc on `ReconcileLegsInput` for the rationale.
 */
function resolveReconciliationRate(
  exchangeRate: number,
  tenderExchangeRate: number | undefined,
  context: string,
): number {
  if (tenderExchangeRate == null) return exchangeRate;
  // No valid server rate to band against (e.g. a scripted caller passing 0)
  // — nothing to compare, so trust the caller's tender rate as-is.
  if (!(exchangeRate > 0)) return tenderExchangeRate;

  const deviation = Math.abs(tenderExchangeRate - exchangeRate) / exchangeRate;
  if (deviation > TENDER_RATE_BAND_PCT) {
    throw new Error(
      `${context}: tender exchange rate ${tenderExchangeRate} is outside the accepted ` +
        `±${(TENDER_RATE_BAND_PCT * 100).toFixed(0)}% band of the server rate ${exchangeRate} ` +
        `(diff ${(deviation * 100).toFixed(1)}%) — refusing to reconcile payment legs at an implausible rate`,
    );
  }
  return tenderExchangeRate;
}

/**
 * Non-throwing sibling of `resolveReconciliationRate`, for stamping
 * `transactions.exchange_rate` (owner decision, 2026-08-08: the stamp should
 * reflect what the operator actually tendered, when that's a plausible
 * edit — repro: buy 89,000 vs. sell 90,000). Reuses the SAME
 * `TENDER_RATE_BAND_PCT` band as `resolveReconciliationRate` (one threshold,
 * not two) but never throws: an absent or implausible (>10% off) tender rate
 * falls back to the server rate SILENTLY, because this function only decides
 * what gets written to a display/audit column, not whether the flow's money
 * math is valid. `reconcileLegs`/`postPayoutLegs` (unchanged) remain the ONLY
 * place an out-of-band tender rate causes a thrown error, and only for the
 * branches that actually call them today — `isForPartner`/`deferPayment`
 * branches skip reconciliation entirely and must keep doing so; this function
 * does not change that.
 */
export function resolveStampedExchangeRate(
  serverRate: number,
  tenderRate: number | undefined,
): number {
  if (tenderRate == null) return serverRate;
  if (!(serverRate > 0)) return tenderRate;
  const deviation = Math.abs(tenderRate - serverRate) / serverRate;
  return deviation > TENDER_RATE_BAND_PCT ? serverRate : tenderRate;
}

/**
 * Exported (CARRIER_LINES_VALIDITY_PLAN.md Phase 6) so a caller computing a
 * cross-currency profit figure (e.g. the telecom credit buy-back: USD
 * credits gained minus a cash payout that may be split USD+LBP) converts at
 * the SAME formula `reconcileLegs` uses internally, rather than re-deriving
 * an equivalent one that could silently disagree at the margins.
 */
export function usdEquivalent(
  usd: number,
  lbp: number,
  exchangeRate: number,
): number {
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
  const {
    inLegs,
    outLegs,
    keptChange,
    expectedTotals,
    exchangeRate,
    tenderExchangeRate,
    context,
  } = input;
  if (!inLegs || inLegs.length === 0) return;

  const rate = resolveReconciliationRate(
    exchangeRate,
    tenderExchangeRate,
    context,
  );

  const inSums = sumLegsByCurrency(inLegs, context);
  const outSums =
    outLegs && outLegs.length > 0
      ? sumLegsByCurrency(outLegs, context)
      : { usd: 0, lbp: 0 };

  const inUsd = usdEquivalent(inSums.usd, inSums.lbp, rate);
  const outUsd = usdEquivalent(outSums.usd, outSums.lbp, rate);
  const keptUsd = usdEquivalent(
    keptChange?.usd ?? 0,
    keptChange?.lbp ?? 0,
    rate,
  );
  const expectedUsd = usdEquivalent(
    expectedTotals.usd,
    expectedTotals.lbp,
    rate,
  );

  const gotUsd = inUsd - outUsd - keptUsd;
  const diff = gotUsd - expectedUsd;

  if (Math.abs(diff) > LEG_RECONCILIATION_EPSILON_USD) {
    const money = (n: number) => n.toFixed(2);
    throw new Error(
      `${context}: payment legs do not reconcile — expected $${money(expectedUsd)} USD-equivalent ` +
        `($${money(expectedTotals.usd)} + ${Math.round(expectedTotals.lbp).toLocaleString()} LBP), ` +
        `got $${money(gotUsd)} USD-equivalent (IN $${money(inUsd)}, OUT $${money(outUsd)}, kept $${money(keptUsd)}), ` +
        `diff $${money(diff)} at rate ${rate}`,
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

// ─────────────────────────────────────────────────────────────────────────
// CQ-3: shared posting helpers (docs/plans/todo_plans/COUNTERPARTY_CONSOLIDATION_PLAN.md)
// ─────────────────────────────────────────────────────────────────────────

/**
 * The ONE `drawer_balances` upsert. Every money repository previously
 * hand-rolled this exact `INSERT ... ON CONFLICT(tenant_id, drawer_name,
 * currency_code) DO UPDATE SET balance = drawer_balances.balance +
 * excluded.balance` statement (36 copies, one per call site) — this is now
 * the single place that owns it.
 *
 * `delta` is signed: positive credits the drawer, negative debits it. This
 * ALWAYS creates the (tenant_id, drawer_name, currency_code) row if it does
 * not exist yet (net balance = delta) — matching every one of the 36
 * migrated call sites' existing behavior.
 *
 * NOT a replacement for the small number of sites that intentionally use a
 * plain `UPDATE drawer_balances SET balance = balance - ?` (no upsert) to
 * deduct from a drawer that must already exist and must NOT be silently
 * created by a typo'd/missing drawer name (CustomServiceRepository refund
 * reversal, RechargeRepository provider-transfer source-drawer debits,
 * DrawerTopUpRepository's transfer-out leg) — those sites were surveyed for
 * CQ-3 and deliberately left as-is; forcing them onto this always-create
 * helper would change their missing-drawer semantics.
 *
 * Runs on whatever `db` handle the caller passes — this never opens its own
 * transaction and never resolves the tenant itself, so it composes
 * correctly with a repo method that received a transaction-scoped `db` (e.g.
 * `SalesRepository`'s `db.transaction(...)` callback param) as well as
 * `this.db` on a plain repo method.
 */
export interface ApplyDrawerDeltaInput {
  drawerName: string;
  currencyCode: string;
  /** Signed amount: positive credits the drawer, negative debits it. */
  delta: number;
  tenantId: number;
}

export function applyDrawerDelta(
  db: Database.Database,
  input: ApplyDrawerDeltaInput,
): void {
  db.prepare(
    `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET
       balance = drawer_balances.balance + excluded.balance,
       updated_at = CURRENT_TIMESTAMP`,
  ).run(input.tenantId, input.drawerName, input.currencyCode, input.delta);
}

/**
 * The ONE `payments` row INSERT. Every money repository previously
 * hand-rolled this INSERT with a slightly different column subset/order
 * (~27 copies) — this is now the single place that owns it.
 *
 * Takes the superset of every call site's column set; each caller passes
 * exactly what it passed before and omits the rest. Optional fields bind as
 * SQL NULL when omitted (better-sqlite3 throws on a bound `undefined`, never
 * on `null`) — identical to the old behavior of a call site that never
 * included that column in its INSERT at all. `createdAt` is the one
 * exception: no existing call site overrode it, so `COALESCE(?,
 * CURRENT_TIMESTAMP)` with a null bind reproduces the schema's
 * `DEFAULT CURRENT_TIMESTAMP` exactly for every migrated site, while still
 * letting a future caller stamp an explicit value.
 *
 * A `payments` row belongs to EITHER a `transaction_id` OR a `session_id`,
 * never both (see `SessionPaymentRepository.insertSessionLeg`) — callers
 * simply omit whichever doesn't apply.
 *
 * Runs on whatever `db` handle the caller passes (see `applyDrawerDelta`
 * doc) — never opens its own transaction, never resolves the tenant itself.
 */
export interface InsertPaymentRowInput {
  transactionId?: number | null;
  sessionId?: number | null;
  method: string;
  drawerName: string;
  currencyCode: string;
  amount: number;
  note?: string | null;
  createdBy?: number | null;
  tenantId: number;
  createdAt?: string | null;
}

export function insertPaymentRow(
  db: Database.Database,
  input: InsertPaymentRowInput,
): void {
  db.prepare(
    `INSERT INTO payments (
       transaction_id, session_id, method, drawer_name, currency_code,
       amount, note, created_by, tenant_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
  ).run(
    input.transactionId ?? null,
    input.sessionId ?? null,
    input.method,
    input.drawerName,
    input.currencyCode,
    input.amount,
    input.note ?? null,
    input.createdBy ?? null,
    input.tenantId,
    input.createdAt ?? null,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// CQ-4: charge-routing guards + bookClientDebtCharge
// (docs/plans/todo_plans/COUNTERPARTY_CONSOLIDATION_PLAN.md)
// ─────────────────────────────────────────────────────────────────────────
//
// Survey (docs/COUNTERPARTY_LEDGERS.md §2/§3): a "for partner" branch in
// SalesRepository / RechargeRepository / LotoTicketRepository /
// FinancialServiceRepository gates on three things before routing the FULL
// amount to `partner_ledger` instead of the client's `debt_ledger`:
//
//   1. counterparty-required — `partnerId` must actually be selected.
//   2. counter-payment rejection — a FOR-partner flow takes NO counter cash
//      from a walk-in customer (PFT-R); any customer-paid IN leg is a
//      modeling error, reject rather than silently split the amount.
//   3. mutual exclusivity — a CUSTOMER_ACCOUNT leg is the client-debt
//      deferred-payment destination, contradictory with routing to a
//      partner instead.
//
// Post-CQ-7 the actual `partner_ledger` INSERT is already ONE shared call
// (`PartnerRepository.addLedgerEntry`) at every site — that part needed no
// further consolidation. What WAS duplicated is these three guards (6
// copies across 4 repos for #2 alone) — extracted below as small named
// functions. There is deliberately NO `bookPartnerCharge` companion here:
// wrapping `addLedgerEntry` in moneyPosting.ts would require importing
// PartnerRepository, which already imports FROM this file (applyDrawerDelta/
// insertPaymentRow) — a cycle for zero duplication removed, since every
// `addLedgerEntry` call site's parameters (transaction_type, amount,
// currency, direction) are irreducibly bespoke per provider/flow, not a
// repeated shape.
//
// `bookClientDebtCharge` IS the real consolidation target: 12 hand-rolled
// `INSERT INTO debt_ledger` call sites (SalesRepository ×1, RechargeRepository
// ×1, FinancialServiceRepository ×6 — cost/price multi-leg + single-leg,
// wallet-SEND multi-leg + single-leg, transfer-SEND multi-leg + single-leg —
// MaintenanceRepository ×1, CustomServiceRepository ×3, LotoTicketRepository
// ×1) collapse onto one INSERT text. The 12 sites differ only in which
// OPTIONAL columns they populated:
//   - every site: client_id, transaction_type, amount_usd, transaction_id,
//     note, tenant_id (always present, always a real value).
//   - amount_lbp: every site except SalesRepository's — Sales sells are
//     always USD-priced, and its original INSERT never included this column
//     at all (implicit SQL NULL, no DEFAULT clause on `debt_ledger.amount_lbp`
//     — see create_db.sql). Passing `amountLbp: null` reproduces that exact
//     NULL, not a `0` (arithmetically identical in every SUM()/COALESCE()
//     downstream today, but NULL is what the byte-identical row looked like
//     before this refactor, so that's what's preserved).
//   - created_by: every site except SalesRepository's and
//     MaintenanceRepository's — both omitted the column from their original
//     INSERT (implicit NULL). Passing `createdBy: null` at those two call
//     sites reproduces that.
//   - due_date: every site used the exact same `datetime('now', '+30 days')`
//     literal — no call site ever passed a different window, so it is baked
//     into this helper rather than parameterized.
// Since `debt_ledger.amount_lbp`/`created_by` are nullable with no DEFAULT
// (create_db.sql), omitting a column from an INSERT and explicitly binding
// SQL NULL for it are the same row on disk — this one INSERT text is
// behavior-identical to all 12 originals.

export interface BookClientDebtChargeInput {
  clientId: number;
  /** MUST stay a literal string at the call site — the reversal-symmetry
   *  guard (`moduleDebtTypes.guard.test.ts`) scans quoted `'<Module> Debt'`
   *  literals anywhere in core source, function-argument position included. */
  transactionType: string;
  amountUsd?: number | null;
  amountLbp?: number | null;
  transactionId: number;
  note?: string | null;
  createdBy?: number | null;
  tenantId: number;
}

export function bookClientDebtCharge(
  db: Database.Database,
  input: BookClientDebtChargeInput,
): void {
  db.prepare(
    `INSERT INTO debt_ledger (
       client_id, transaction_type, amount_usd, amount_lbp,
       transaction_id, note, created_by, tenant_id, due_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+30 days'))`,
  ).run(
    input.clientId,
    input.transactionType,
    input.amountUsd ?? null,
    input.amountLbp ?? null,
    input.transactionId,
    input.note ?? null,
    input.createdBy ?? null,
    input.tenantId,
  );
}

/**
 * Guard 1 — counterparty-required: routing a FOR-partner charge needs an
 * actual selected partner. Reused VERBATIM (identical literal message) by
 * SalesRepository, RechargeRepository, LotoTicketRepository — 3 previously
 * hand-rolled copies that were already byte-identical.
 *
 * FinancialServiceRepository does NOT call this: its own `isForPartner` is
 * computed as `!!(data.partnerId && data.partnerMode === "FOR")`, so a bare
 * `partnerMode: "FOR"` with no `partnerId` there silently falls through to
 * the normal walk-in dispatch instead of throwing. That's a pre-existing
 * asymmetry across the 4 repos, not introduced here — making FS throw too
 * would be a behavior change, out of scope for a behavior-identical refactor.
 */
export function assertPartnerIdRequired(
  partnerId: number | null | undefined,
): void {
  if (!partnerId) {
    throw new Error('partnerId is required when partnerMode is "FOR"');
  }
}

/**
 * Guard 2 — counter-payment rejection: a FOR-partner flow takes the FULL
 * amount, unconditionally — no counter cash/wallet/account leg from a
 * walk-in customer (PFT-R, "validated flow catalog"). `context` reproduces
 * each of the 5 existing per-module messages BYTE-IDENTICAL:
 *   "sale" (SalesRepository), "recharge" (RechargeRepository),
 *   "loto ticket" (LotoTicketRepository), "financial service"
 *   (FinancialServiceRepository), "custom service" (CustomServiceRepository).
 * e2e specs lira-113/115/116/118/119 assert `.toContain("no counter
 * payment")` / `.toMatch(/no counter payment/i)` — the substring survives
 * untouched for every context, and for all existing call sites the WHOLE
 * message is reproduced verbatim, not just the asserted substring.
 *
 * RechargeRepository's and LotoTicketRepository's "mutual exclusivity"
 * case (a CUSTOMER_ACCOUNT leg under `partnerMode: "FOR"`) is folded into
 * THIS same guard, not `assertNoCustomerAccountLeg` below — in both repos a
 * CUSTOMER_ACCOUNT leg is already counted as a counter-payment leg (Recharge:
 * it's an IN leg like any other; Loto: `hasLegacyCustomerAccount` is one
 * arm of the same compound condition), so today it already throws THIS
 * "no counter payment" message, never a distinct one. Only SalesRepository
 * and FinancialServiceRepository have a genuinely separate, differently-worded
 * guard for it (see `assertNoCustomerAccountLeg`).
 *
 * `legacyPaidBy` (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §3 — closing the
 * owner's LIRA-114 report): the caller's OWN legacy single-payment-method
 * field (`data.paid_by`, `paidByMethod`/`cashoutMethod`, `paid_by_method`,
 * …), taken as an EXPLICIT, REQUIRED parameter rather than folded into the
 * caller's own hand-computed `hasCounterPayment` boolean. That was the exact
 * gap: `CustomServiceRepository` computed `hasCounterPayment` from
 * `data.payments` only, so a for-partner submission carrying a stale
 * `paid_by: "CUSTOMER_ACCOUNT"` (or any other single-method leftover from
 * before the operator ticked the partner checkbox) sailed through — accepted,
 * no money moved, yet `metadata_json.paid_by` recorded a payment method that
 * never executed. Requiring this parameter means a future call site cannot
 * silently repeat that mistake by omission — TypeScript forces every caller
 * to make the legacy field an explicit decision. A call site with no such
 * field, or one that already folds its own equivalent check into
 * `hasCounterPayment` (LotoTicketRepository), passes `undefined` — this
 * function's own check on it then no-ops, so behavior there is unchanged.
 *
 * Any value OTHER than `"CASH"` — the app-wide neutral default every
 * `paid_by`-shaped field falls back to when the operator never explicitly
 * chose one (`data.paid_by ?? "CASH"`) — throws: `"CUSTOMER_ACCOUNT"` gets
 * its own clearly-worded rejection (the governing business rule: under
 * For-Partner there is no customer owing, the PARTNER owes, so
 * CUSTOMER_ACCOUNT can never be valid here, independent of whether it "had
 * an effect"); every other non-CASH value (e.g. a wallet method like "OMT")
 * falls through to the same generic "no counter payment" throw as a leaked
 * leg — a FOR-partner branch that calls this guard is, by construction, a
 * branch that posts NO counter payment through this field, so ANY other
 * explicit value is a dead claim that must not reach `metadata_json`.
 * Rejecting (rather than silently nulling the value before it's stamped) was
 * chosen deliberately: nulling would still let the submission succeed with a
 * DIFFERENT, quieter loss of information (the operator's now-meaningless
 * legacy selection just vanishes with no feedback), where rejecting surfaces
 * the stale value to the operator immediately, before anything is written —
 * consistent with every other PFT-R guard in this file, all of which reject
 * rather than silently coerce. This is intentionally NOT "ban every payment
 * method under FOR everywhere": a module whose FOR-partner branch
 * legitimately still disburses through a method field (a real payout, not a
 * counter-payment claim) simply should not route that field through THIS
 * parameter — only pass a value here when it represents "how the walk-in
 * counter customer paid", the concept this guard exists to reject entirely.
 */
export function assertNoCounterPayment(
  hasCounterPayment: boolean,
  legacyPaidBy: string | null | undefined,
  context: string,
): void {
  if (legacyPaidBy === "CUSTOMER_ACCOUNT") {
    throw new Error(
      `A partner ${context} cannot be paid by Customer Account — there is no customer owing, the partner owes`,
    );
  }
  const hasLegacyCounterPayment =
    legacyPaidBy != null && legacyPaidBy !== "CASH";
  if (hasCounterPayment || hasLegacyCounterPayment) {
    throw new Error(
      `A partner ${context} takes no counter payment — the full amount goes on the partner's tab`,
    );
  }
}

/**
 * Guard 3 — mutual exclusivity (the SalesRepository/FinancialServiceRepository
 * variant only): a CUSTOMER_ACCOUNT leg is the client-debt deferred-payment
 * destination, contradictory with routing to a partner instead. This helper
 * factors only the if/throw SHAPE, not the wording — the two existing call
 * sites keep their own bespoke `message` (neither is asserted by any test,
 * and they reject genuinely different scenarios: SalesRepository checks its
 * IN legs pre-emptively, before its own `assertNoCounterPayment` call, for a
 * friendlier error; FinancialServiceRepository checks its return/OUT legs,
 * AFTER its own `assertNoCounterPayment` call, for a distinct edge case).
 * Unifying the wording would erase that difference for no covered benefit.
 */
export function assertNoCustomerAccountLeg(
  hasCustomerAccountLeg: boolean,
  message: string,
): void {
  if (hasCustomerAccountLeg) {
    throw new Error(message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// CQ-5: counterparty discount posting
// (docs/plans/todo_plans/COUNTERPARTY_CONSOLIDATION_PLAN.md)
// ─────────────────────────────────────────────────────────────────────────
//
// Survey (CQ-5): DebtRepository._postDebtDiscount, SupplierRepository.
// _postSupplierDiscount, and PartnerRepository.recordDiscount were all
// written in the CQ-10 wave and are near-identical in ONE specific place —
// the D1 sign/flow decision (docs/plans/todo_plans/COUNTERPARTY_CONSOLIDATION_PLAN.md
// "Owner decisions" D1) and the `counterparty` metadata assembly. Everything
// AROUND that (the ledger-row INSERT — 'Debt Discount'/'DISCOUNT' must stay a
// literal at the Debt call site for `moduleDebtTypes.guard`; the `UPDATE …
// SET transaction_id` link; which FIFO coverage to run, if any) is genuinely
// per-repo (rule 13: repos own their SQL) and stays that way — only the
// signed-profit/flow/metadata SHAPE moves here, not the transaction write
// itself (that would need this file to call `getTransactionRepository()`,
// which itself imports `applyDrawerDelta`/`insertPaymentRow` FROM this file —
// the exact import-cycle CQ-4's comment above already declined to introduce
// for `bookPartnerCharge`, for the same reason).
//
// D1, one sentence: a discount is "forgiven" when the SHOP forgives a
// receivable (money owed TO it — a real cost, profit NEGATIVE, booked
// as-if-paid so flow is IN), and "received" when a COUNTERPARTY forgives a
// payable (money the shop owes THEM — a real gain, profit POSITIVE, flow
// OUT). Debt discounts are always "forgiven" (a client's debt to the shop);
// Supplier discounts are always "received" (a supplier forgives what the
// shop owes them); Partner's direction depends on `entry.direction`: CREDIT
// (partner owed the shop) → "forgiven", DEBIT (shop owed the partner) →
// "received" — see PartnerRepository.recordDiscount. Sign and flow always
// co-vary on this one axis for all three subsystems; centralizing that
// co-variance IS the consolidation — a flipped sign here fails
// DebtRepository.discount, SupplierRepository.discount, PartnerService.discount,
// AND ProfitService.transactionBased's discounts-bucket suites all at once,
// instead of each subsystem carrying its own (possibly independently wrong)
// copy of the D1 rule.

export interface CounterpartyDiscountPostingInput {
  /** Which ledger owns the discount — feeds `buildCounterpartyMetadata`'s
   *  `kind`. The caller's own `source_table` (debt_ledger/supplier_ledger/
   *  partner_ledger) is passed separately to `createTransaction`, not here. */
  kind: CounterpartyKind;
  /** The ALREADY-INSERTED discount ledger row's id (the repo's own INSERT —
   *  rule 13). Doubles as `buildCounterpartyMetadata`'s `ledgerEntryId`. */
  ledgerEntryId: number;
  counterpartyId: number;
  counterpartyName: string;
  /** Unsigned forgiven magnitude per currency. Debt/Supplier discounts can
   *  span both currencies in one call; Partner's ledger is one-currency-per-
   *  row, so its caller passes 0 for the currency it isn't using. */
  amountUsd: number;
  amountLbp: number;
  /** The D1 sign/flow axis — see file-header comment above. */
  discountDirection: "forgiven" | "received";
  reason?: string;
  /** Bespoke, non-counterparty metadata each repo already stamps today
   *  (`supplier_id`/`entry_type`, `partner_id`/`direction`, …) — passed
   *  through verbatim, never invented by this helper. */
  extraMetadata?: Record<string, unknown>;
}

export interface CounterpartyDiscountPosting {
  /** Signed per D1 — pass straight through to `createTransaction`'s
   *  `profit_usd`/`profit_lbp` (amount_usd/amount_lbp on that same call stay
   *  0 — no cash moves on a discount; every call site already does this). */
  profit_usd: number;
  profit_lbp: number;
  flow: CounterpartyFlow;
  /** `{ ...extraMetadata, counterparty: {...} }` — pass straight through to
   *  `createTransaction`'s `metadata_json`. */
  metadata_json: Record<string, unknown>;
}

/**
 * Builds the signed profit + `counterparty` metadata shape for a
 * COUNTERPARTY_DISCOUNT transaction. Does NOT call `createTransaction`
 * itself (see file-header comment) — the caller still owns `type:
 * TRANSACTION_TYPES.COUNTERPARTY_DISCOUNT`, `source_table`/`source_id`,
 * `user_id`, `summary`, and (Debt only) `client_id`/`transaction_time`.
 */
export function buildCounterpartyDiscountPosting(
  input: CounterpartyDiscountPostingInput,
): CounterpartyDiscountPosting {
  const sign = input.discountDirection === "forgiven" ? -1 : 1;
  const flow: CounterpartyFlow =
    input.discountDirection === "forgiven" ? "IN" : "OUT";

  return {
    profit_usd: sign * input.amountUsd,
    profit_lbp: sign * input.amountLbp,
    flow,
    metadata_json: {
      ...(input.extraMetadata ?? {}),
      counterparty: buildCounterpartyMetadata({
        kind: input.kind,
        id: input.counterpartyId,
        name: input.counterpartyName,
        flow,
        method: "LEDGER",
        ledgerEntryId: input.ledgerEntryId,
        discount: {
          amount_usd: input.amountUsd,
          amount_lbp: input.amountLbp,
          reason: input.reason,
        },
      }),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// CARRIER_LINES_VALIDITY_PLAN.md Phase 6 — shared payout-leg posting loop
// ─────────────────────────────────────────────────────────────────────────
//
// Lifted from the OMT/WHISH system RECEIVE cashout branch
// (FinancialServiceRepository — the "CASH cashout" arm that follows the
// `useSystemDrawerFlow` split-currency payout, per plan Phase 6's citation)
// so the new telecom credit buy-back (RechargeRepository) can reuse it
// rather than copy the ~95-line block (rule 14).
//
// The copied-from shape had a latent bug this extraction also fixes at its
// ORIGINAL site: it built `payoutLegs` by filtering `data.payments` down to
// `isDrawerAffectingMethod` BEFORE checking whether any legs remained, while
// `reconcileLegs` summed the UNFILTERED array. A mixed CASH + CUSTOMER_ACCOUNT
// split therefore reconciled successfully (the CUSTOMER_ACCOUNT leg counted
// toward the total) yet the account was never credited AND the full amount
// was then paid a second time by the "no legs" CASH fallback — a real
// double-payout, not just a missing credit. `postPayoutLegs` branches
// PER-LEG instead (modeled on the app-wallet payout loop in the same file,
// which already does this correctly), so a CUSTOMER_ACCOUNT leg is routed to
// `onCustomerAccountLeg` and every other drawer-affecting leg is posted
// individually — matching every OTHER payout branch in that file.
//
// Deliberately does NOT import `getDebtService` itself (staying a leaf
// module, same reasoning as the CQ-4 comment above declining a
// `bookPartnerCharge` companion): the caller already imports DebtService for
// its OWN CUSTOMER_ACCOUNT branches, so `onCustomerAccountLeg` is dependency-
// injected instead of creating a `moneyPosting.ts` -> `DebtService.ts` ->
// `DebtRepository.ts` -> `moneyPosting.ts` cycle (DebtRepository already
// imports `applyDrawerDelta`/`insertPaymentRow` FROM this file).

export interface PostPayoutLegsInput {
  db: Database.Database;
  /**
   * The flow's pre-partitioned IN legs (rule 16 — NEVER pass a raw,
   * un-partitioned `payments[]` that might still contain OUT/change legs;
   * every call site partitions once at the top of its own flow and reassigns
   * before reaching a payout branch). This is what the shop pays OUT to the
   * customer — reconciled against `payoutAmount`, then posted per-leg.
   */
  legs: ReconciliationLeg[] | undefined | null;
  /** The total the shop owes the customer (service-currency magnitude). */
  payoutAmount: number;
  /** Currency of `payoutAmount` — the expected-total currency AND the
   *  currency of the no-legs fallback posting. */
  currency: string;
  exchangeRate: number;
  tenderExchangeRate?: number;
  /** Label for `reconcileLegs`' thrown error (e.g. "OMT RECEIVE cashout",
   *  "MTC credit buy-back"). */
  context: string;
  txnId: number;
  tenantId: number;
  createdBy?: number | null;
  /** Resolve a drawer-affecting leg's method to the drawer it debits. */
  resolveDrawer: (method: string) => string;
  /** Note text stamped on every posted `payments` row (drawer-affecting
   *  legs AND the no-legs fallback). */
  note: string;
  /** Method used for the no-legs (legacy/scripted caller) fallback posting.
   *  Defaults to `"CASH"`, matching every existing payout branch. */
  fallbackMethod?: string;
  /**
   * Invoked once per CUSTOMER_ACCOUNT leg with its unsigned amount split by
   * currency (exactly one of the two is non-zero). The caller owns crediting
   * the client (typically `getDebtService().addCredit(...)`) and validating
   * a client was actually resolved — throwing here rolls back the whole
   * `db.transaction(...)` like any other throw. Omitting this while a
   * CUSTOMER_ACCOUNT leg is present throws inside `postPayoutLegs` itself.
   */
  onCustomerAccountLeg?: (legAmountUsd: number, legAmountLbp: number) => void;
}

export function postPayoutLegs(input: PostPayoutLegsInput): void {
  const {
    db,
    legs,
    payoutAmount,
    currency,
    exchangeRate,
    tenderExchangeRate,
    context,
    txnId,
    tenantId,
    createdBy,
    resolveDrawer,
    note,
    fallbackMethod = "CASH",
    onCustomerAccountLeg,
  } = input;

  // S2 hard-reject reconciliation (Payment-Legs Integrity plan) — no-ops on
  // an empty/absent `legs` (the no-legs fallback below is still correct for
  // a legacy/scripted caller).
  reconcileLegs({
    inLegs: legs,
    expectedTotals: expectedTotalIn(payoutAmount, currency),
    exchangeRate,
    tenderExchangeRate,
    context,
  });

  const payoutLegs = legs ?? [];
  if (payoutLegs.length > 0) {
    for (const leg of payoutLegs) {
      const legAmount = Math.abs(leg.amount);
      if (legAmount <= 0) continue;

      if (leg.method === "CUSTOMER_ACCOUNT") {
        if (!onCustomerAccountLeg) {
          throw new Error(
            `${context}: a CUSTOMER_ACCOUNT payout leg is not supported here`,
          );
        }
        onCustomerAccountLeg(
          leg.currencyCode === "USD" ? legAmount : 0,
          leg.currencyCode === "LBP" ? legAmount : 0,
        );
        continue;
      }

      // A leg that is neither CUSTOMER_ACCOUNT nor drawer-affecting (e.g.
      // GIFT_CARD, `affects_drawer=0`) must never be silently skipped here:
      // `reconcileLegs` above already summed it into the reconciled total
      // (it doesn't look at `method`), so silently dropping it would let the
      // caller's carrier-line/wallet credit go through while the leg itself
      // moves no drawer and credits no debt — a phantom payout, the exact
      // "money leak" bug class `bookFeeCollectionLegs`
      // (FinancialServiceRepository.ts) already hard-rejects for fee
      // collection. Mirrored here so it protects every `postPayoutLegs` call
      // site (the original RECEIVE payout AND the new CREDIT_BUYBACK path)
      // from one fix point (rule 14) instead of duplicating the guard per
      // call site.
      if (!isDrawerAffectingMethod(leg.method)) {
        throw new Error(
          `${context}: ${leg.method} is not a valid payout method — use a drawer-affecting method or CUSTOMER_ACCOUNT`,
        );
      }

      const legDrawer = resolveDrawer(leg.method);
      insertPaymentRow(db, {
        transactionId: txnId,
        method: leg.method,
        drawerName: legDrawer,
        currencyCode: leg.currencyCode,
        amount: -legAmount,
        note,
        createdBy,
        tenantId,
      });
      applyDrawerDelta(db, {
        drawerName: legDrawer,
        currencyCode: leg.currencyCode,
        delta: -legAmount,
        tenantId,
      });
    }
  } else {
    const fallbackDrawer = resolveDrawer(fallbackMethod);
    insertPaymentRow(db, {
      transactionId: txnId,
      method: fallbackMethod,
      drawerName: fallbackDrawer,
      currencyCode: currency,
      amount: -payoutAmount,
      note,
      createdBy,
      tenantId,
    });
    applyDrawerDelta(db, {
      drawerName: fallbackDrawer,
      currencyCode: currency,
      delta: -payoutAmount,
      tenantId,
    });
  }
}
