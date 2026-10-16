/**
 * Debt Repository
 *
 * Handles all debt_ledger table operations.
 * Uses BaseRepository for common functionality.
 */

import { requestNow } from "../utils/requestNow.js";
import { BaseRepository } from "./BaseRepository.js";
import { DatabaseError } from "../utils/errors.js";
import {
  paymentMethodToDrawerName,
  isNonCashDrawerMethod,
  isDrawerAffectingMethod,
  isPrimarySystemProvider,
  partitionLegs,
  resolveServiceCashDrawer,
  type BaseSystem,
} from "../utils/payments.js";
import { getSettingsRepository } from "./SettingsRepository.js";
import { primaryCashDrawerName } from "../constants/systemFloatDrawers.js";
import {
  allocateRepayment,
  earlierBalanceItem,
  isCashDrawerItem,
  type AllocationItem,
  type CoverageTake,
  type DebtItemRef,
  type OpenDebtItem,
} from "../utils/debtRepaymentAllocation.js";
import { coverBasketMember } from "./basketMemberCoverage.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { buildCounterpartyMetadata } from "../validators/counterparty.js";
import { allocateFifo } from "../utils/fifoCoverage.js";
import {
  COVERAGE_EPSILON_LBP,
  COVERAGE_EPSILON_USD,
  coverableChargeSql,
  coverageOpenSql,
  coverageOutstandingSql,
  memberOpenSql,
  memberOutstandingSql,
} from "./sessionDebtCoverage.js";
import { getUsdLbpSellRate } from "../utils/exchangeRate.js";
import { getEffectiveRate } from "../utils/effectiveRate.js";
import {
  applyDrawerDelta,
  insertPaymentRow,
  buildCounterpartyDiscountPosting,
  resolveStampedExchangeRate,
  usdEquivalent,
} from "./moneyPosting.js";
import { resolveKeptChange } from "./keptChange.js";
import { buildPaymentSnapshot } from "../utils/paymentSnapshot.js";
import {
  TRANSACTION_DETAILS_VERSION,
  type AccountEntryDetails,
} from "../validators/transactionDetails.js";

/**
 * LIRA-329 — the `account_entry` details on a debts / accounts transaction:
 * what kind of entry it is, the note exactly as typed (never the screen's
 * default wording), the debt items the cashier ticked, and a bundled
 * discount as typed (one currency, only when exactly one side is set).
 * The client's name and phone go to the row's own columns (filled from
 * `client_id` by createTransaction's resolver), not here. Pure.
 */
export function buildAccountEntryDetails(input: {
  action: AccountEntryDetails["action"];
  note?: string | null;
  targets?: ReadonlyArray<DebtItemRef> | null;
  discount?: { amount_usd?: number; amount_lbp?: number } | null;
}): AccountEntryDetails {
  const note =
    input.note != null && input.note.trim() !== "" ? input.note : undefined;
  const dUsd = Math.abs(input.discount?.amount_usd || 0);
  const dLbp = Math.abs(input.discount?.amount_lbp || 0);
  const discount =
    dUsd > 0 && dLbp === 0
      ? { amount: dUsd, currency: "USD" }
      : dLbp > 0 && dUsd === 0
        ? { amount: dLbp, currency: "LBP" }
        : undefined;
  return {
    v: TRANSACTION_DETAILS_VERSION,
    kind: "account_entry",
    action: input.action,
    ...(note ? { note } : {}),
    ...(input.targets && input.targets.length > 0
      ? { targets: input.targets.map((t) => ({ type: t.kind, id: t.id })) }
      : {}),
    ...(discount ? { discount } : {}),
  };
}

/** LIRA-308 answer 2 — the label of the "Earlier balance" line and the
 *  noise floor below which an uncovered balance is not shown as one. */
const EARLIER_BALANCE_LABEL = "Earlier balance (no items)";
const EARLIER_BALANCE_MIN_USD = 0.05;
const EARLIER_BALANCE_MIN_LBP = 5000;

/**
 * Exactly which rows a repayment's FIFO coverage landed on, recorded on the
 * DEBT_REPAYMENT transaction's `metadata_json[REPAYMENT_COVERAGE_KEY]` so a
 * void/refund (TransactionRepository._restoreRepaymentDebt — the rule-20
 * reversal owner) gives back THAT coverage and nothing else. Before this
 * record existed the give-back was re-derived newest-first from sales, which
 * un-paid sales the repayment never touched (incl. sales paid in cash at
 * checkout) whenever the coverage had gone to a module charge.
 */
export const REPAYMENT_COVERAGE_KEY = "coverage_applied";

export interface RepaymentCoverageRecord {
  /** `sales.paid_usd` bumped by `_markSalesPaidFIFO`. */
  sales: Array<{ id: number; usd: number }>;
  /** `debt_ledger.covered_usd/covered_lbp` bumped by `_coverServiceDebtsFIFO`. */
  charges: Array<{ id: number; usd: number; lbp: number }>;
  /** LIRA-304 — basket members paid: the member's `covered_*` and its basket
   *  row (`row_id`) were bumped together. Absent on older repayments. */
  members?: Array<{ id: number; row_id: number; usd: number; lbp: number }>;
}

/** Read a repayment's coverage record from its transaction metadata. Returns
 *  null when absent or malformed (repayments booked before the record
 *  existed) — the caller then falls back to the legacy re-derivation. */
export function readRepaymentCoverage(
  metadataJson: string | null | undefined,
): RepaymentCoverageRecord | null {
  if (!metadataJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadataJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const rec = (parsed as Record<string, unknown>)[REPAYMENT_COVERAGE_KEY];
  if (!rec || typeof rec !== "object") return null;
  const { sales, charges, members } = rec as Record<string, unknown>;
  if (!Array.isArray(sales) || !Array.isArray(charges)) return null;
  const num = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;
  return {
    sales: sales
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s) => ({ id: num(s.id), usd: num(s.usd) }))
      .filter((s) => s.id > 0),
    charges: charges
      .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
      .map((c) => ({ id: num(c.id), usd: num(c.usd), lbp: num(c.lbp) }))
      .filter((c) => c.id > 0),
    // Absent (undefined) on repayments booked before LIRA-304 — the void
    // then reopens a basket's items from the row-level record instead.
    members: Array.isArray(members)
      ? members
          .filter(
            (m): m is Record<string, unknown> => !!m && typeof m === "object",
          )
          .map((m) => ({
            id: num(m.id),
            row_id: num(m.row_id),
            usd: num(m.usd),
            lbp: num(m.lbp),
          }))
          .filter((m) => m.id > 0 && m.row_id > 0)
      : undefined,
  };
}

/** CQ-10 — a discount/write-off amount bundled with a settlement, or posted
 *  standalone. amount_usd/amount_lbp are the FORGIVEN amounts (always
 *  treated as positive magnitudes regardless of sign supplied). */
export interface CounterpartyDiscountData {
  amount_usd: number;
  amount_lbp: number;
  reason?: string;
}

/** A single payment leg for multi-payment repayments */
export interface RepaymentPaymentLine {
  method: string;
  currencyCode: string;
  amount: number;
  /** IN (customer pays, default) or OUT (shop returns change to customer). */
  direction?: "IN" | "OUT";
}

// =============================================================================
// Entity Types
// =============================================================================

export interface DebtLedgerEntity {
  id: number;
  client_id: number;
  transaction_id: number | null;
  transaction_type: string;
  amount_usd: number;
  amount_lbp: number;
  note: string | null;
  created_at: string;
  created_by: number | null;
  edited_by: string | null;
  edited_at: string | null;
  /** Set on 'Session Debt' rows — the basket this charge belongs to
   *  (customer_session_transactions.session_id). Null for every other type. */
  session_id: number | null;
  /** LIRA-131: set by `TransactionRepository._markSourceRefunded` when the
   *  unified transaction sourced from this row is voided/refunded —
   *  `debt_ledger` is in its supported-tables whitelist. Was written by the
   *  reversal path but never projected here, so the Debts page's existing
   *  "Refunded" badge (`debts/pages/Debts/index.tsx`, gated on
   *  `item.is_refunded`) stayed dormant. */
  is_refunded: number;
  refunded_at: string | null;
  /** LIRA-241 — display name of the user who recorded this ledger entry
   *  (`created_by` joined to `users.username`), the same shape
   *  `TransactionRepository.getRecent()` uses for the Transactions page's
   *  User column. Null when `created_by` is null (a system-authored row —
   *  see `moneyPosting.ts`'s `bookClientDebtCharge` doc) or the user was
   *  deleted. Only `findClientHistory()` joins `users` and populates this;
   *  `findById()`/`findAll()` (sharing `getColumns()`) leave it undefined. */
  created_by_username?: string | null;
}

export interface DebtorSummary {
  id: number;
  full_name: string;
  phone_number: string;
  total_debt: number;
  total_debt_usd: number;
  total_debt_lbp: number;
}

export interface TopDebtor {
  full_name: string;
  total_debt: number;
  total_debt_usd: number;
  total_debt_lbp: number;
}

export interface DebtSummary {
  totalDebt: number;
  totalDebtUsd: number;
  totalDebtLbp: number;
  topDebtors: TopDebtor[];
}

export interface CreateRepaymentData {
  client_id: number;
  amount_usd: number;
  amount_lbp: number;
  note?: string | null;
  created_by: number;
  paid_by_method?: string;
  /** Optional multi-payment legs. When provided, overrides paid_by_method for
   *  drawer routing. Each leg is processed independently with per-leg RESERVE
   *  routing for Service Debt (e.g. WHISH leg → Whish_App → Whish_System). */
  payments?: RepaymentPaymentLine[];
  /** T3 keep-change: kept (not returned) change per currency — the client's
   *  CLAIM. `addRepayment` checks it against the explicit payment lines with
   *  `resolveKeptChange` (payer "customer": IN − OUT − kept = amount_usd/
   *  amount_lbp) before stamping it as profit on the DEBT_REPAYMENT
   *  transaction (the generic void negates the stamp). The caller already
   *  excluded these from amount_usd/amount_lbp. */
  kept_change_usd?: number;
  kept_change_lbp?: number;
  transaction_time?: string;
  /** CQ-10 — bundled discount: "owed X, paid Y, discount Z". Posts its OWN
   *  'Debt Discount' ledger row + COUNTERPARTY_DISCOUNT transaction (see
   *  DebtRepository._postDebtDiscount) with the SAME FIFO coverage steps a
   *  repayment gets, applied to its own (separate) budget. */
  discount?: CounterpartyDiscountData;
  /**
   * The USD→LBP rate MultiPaymentInput actually converted the operator's
   * TENDER at (the payment sheet's editable rate field — same
   * `repayModalRate` state the Debts page feeds into both the repayment and
   * cash-out modals). Owner decision (2026-08-08, repro: buy 89,000 vs. sell
   * 90,000): used to stamp `transactions.exchange_rate` via
   * `resolveStampedExchangeRate` (moneyPosting.ts) — stamped EXACTLY as
   * typed (LIRA-240, 2026-09-28, retired the old ±15%-band fallback to the
   * server sell rate, `getUsdLbpSellRate`); falls back to the server rate
   * only when absent (never throws — this repository has no `reconcileLegs`
   * hard-reject for repayments/cash-outs to weaken). Omitted → unchanged
   * legacy behavior, stamps the server sell rate exactly as before.
   */
  tender_exchange_rate?: number;
  /** LIRA-304 — the open debt items the cashier ticked (optional). Picked
   *  items are paid first; the rest follows today's order. Re-checked
   *  server-side: every target must be this client's and still open. */
  targets?: DebtItemRef[];
}

// =============================================================================
// Debt Repository Class
// =============================================================================

export class DebtRepository extends BaseRepository<DebtLedgerEntity> {
  constructor() {
    super("debt_ledger", { softDelete: false });
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  // LIRA-131: is_refunded/refunded_at are written by
  // TransactionRepository._markSourceRefunded on void/refund but were never
  // projected here, so a refunded debt_ledger row silently read back as an
  // ordinary live row. findClientHistory()/findById()/findAll() all share
  // this one method (used by both the IPC `debt:get-client-history` handler
  // and the REST `GET /api/debts/clients/:clientId/history` route via
  // DebtService.getClientHistory -> repo.findClientHistory), so this one
  // change fixes the read path identically for desktop and web (rule 19).
  protected getColumns(): string {
    return "id, client_id, transaction_type, amount_usd, amount_lbp, transaction_id, note, created_at, created_by, edited_by, edited_at, session_id, is_refunded, refunded_at";
  }

  // ---------------------------------------------------------------------------
  // Debtor Queries
  // ---------------------------------------------------------------------------

  /**
   * Get the current exchange rate for USD→LBP conversions.
   * Computes effective sell rate using sell_rate column directly.
   * Falls back to 89500 if no rate found (logs warning instead of throwing).
   */
  private getExchangeRate(fromCode = "USD", toCode = "LBP"): number {
    // LIRA-306 (FR-021a): one getter — the replay's recorded rate, else the
    // configured row (no raw exchange_rates read here any more).
    const rateResult = getEffectiveRate(toCode);

    if (!rateResult) {
      console.warn(
        `No exchange rate found for ${fromCode}→${toCode}, falling back to 89500`,
      );
      return 89500;
    }

    // Use sell_rate (customer gives us this rate)
    return rateResult.sell_rate;
  }

  /**
   * CQ-8: cheap client-name lookup for the `counterparty` metadata contract
   * (every counterparty money transaction stamps a human-readable name).
   * Falls back to a placeholder rather than throwing — a missing/deleted
   * client must never block a repayment/cash-entry write.
   */
  private _getClientName(clientId: number): string {
    const row = this.db
      .prepare(`SELECT full_name FROM clients WHERE id = ? AND tenant_id = ?`)
      .get(clientId, getCurrentTenantId()) as { full_name: string } | undefined;
    return row?.full_name ?? `Client #${clientId}`;
  }

  /**
   * Get all clients with their debt totals (grouped)
   */
  findAllDebtors(): DebtorSummary[] {
    // Use exchange rate to convert LBP portion into USD for consistent totals
    const rate = this.getExchangeRate("USD", "LBP");
    const tenantId = getCurrentTenantId();

    const stmt = this.db.prepare(`
      SELECT
        c.id,
        c.full_name,
        c.phone_number,
        ROUND(COALESCE(SUM(dl.amount_usd), 0) + (COALESCE(SUM(dl.amount_lbp), 0) / ?), 2) as total_debt,
        ROUND(COALESCE(SUM(dl.amount_usd), 0), 2) as total_debt_usd,
        ROUND(COALESCE(SUM(dl.amount_lbp), 0), 2) as total_debt_lbp
      FROM debt_ledger dl
      JOIN clients c ON dl.client_id = c.id AND c.tenant_id = dl.tenant_id
      WHERE dl.tenant_id = ?
      GROUP BY c.id
      ORDER BY total_debt DESC
    `);
    return stmt.all(rate, tenantId) as DebtorSummary[];
  }

  /**
   * Get debt history for a specific client
   * Default: most recent first (DESC)
   *
   * LIRA-232 round-3 adversarial review, finding #7 (LOW) — a 0/0
   * 'Refund Reversal' row (`TransactionRepository._cancelSessionDebt`'s
   * idempotency marker, written even when a Session Debt row's own net is
   * fully attributed away by a prior item refund — see round-2 finding #4)
   * carries no money and nothing for the owner to act on; showing it on the
   * Debts page history is noise. The row itself MUST stay in the table (it
   * is `_assertSessionBasketReversible`'s only idempotency marker for that
   * case) — this filters it from the READ only, never from storage.
   *
   * Round-4 review, finding L1 — widened from an EXACT `= 0` match to a
   * tolerant `< half a unit` one. `TransactionRepository._cancelSessionDebt`
   * now rounds its own net at the write site (so a NEW zero-net row lands on
   * exact 0), but an exact filter is still the wrong invariant to depend on:
   * IEEE-754 subtraction of two float dollar amounts can legitimately land a
   * few femtocents off zero (measured pre-fix: 10.10 + 20.20 charged on
   * account netted to `-3.552713678800501e-15`, which this filter's old
   * exact `= 0` silently let through as a visible "−$0.00" row).
   */
  findClientHistory(clientId: number): DebtLedgerEntity[] {
    // LIRA-241 — own SELECT (not the shared `getColumns()`) because this is
    // the one read path that also needs `created_by_username`: a `dl.`-
    // qualified column list plus a `users` LEFT JOIN. findById()/findAll()
    // keep using getColumns() unqualified against the bare table, so this
    // must not touch that shared method (it has no JOIN to alias against).
    const stmt = this.db.prepare(`
      SELECT dl.id, dl.client_id, dl.transaction_type, dl.amount_usd, dl.amount_lbp,
             dl.transaction_id, dl.note, dl.created_at, dl.created_by, dl.edited_by,
             dl.edited_at, dl.session_id, dl.is_refunded, dl.refunded_at,
             u.username AS created_by_username
      FROM debt_ledger dl
      LEFT JOIN users u ON u.id = dl.created_by AND u.tenant_id = dl.tenant_id
      WHERE dl.client_id = ? AND dl.tenant_id = ?
        AND NOT (
          dl.transaction_type = 'Refund Reversal'
          AND ABS(dl.amount_usd) < 0.005
          AND ABS(dl.amount_lbp) < 0.5
        )
      ORDER BY dl.created_at DESC
    `);
    return stmt.all(clientId, getCurrentTenantId()) as DebtLedgerEntity[];
  }

  /**
   * Get total debt for a specific client
   */
  getClientDebtTotal(clientId: number): number {
    const rate = this.getExchangeRate("USD", "LBP");

    const stmt = this.db.prepare(
      `SELECT ROUND(COALESCE(SUM(amount_usd), 0) + (COALESCE(SUM(amount_lbp), 0) / ?), 2) as total
       FROM debt_ledger
       WHERE client_id = ? AND tenant_id = ?`,
    );
    const result = stmt.get(rate, clientId, getCurrentTenantId()) as {
      total: number | null;
    };
    return result?.total || 0;
  }

  // ---------------------------------------------------------------------------
  // Repayment Operations
  // ---------------------------------------------------------------------------

  /**
   * Add a repayment entry (stored as negative values to reduce debt)
   * Wrapped in transaction to ensure atomicity with payments and drawer updates
   */
  addRepayment(data: CreateRepaymentData): { id: number } {
    const tenantId = getCurrentTenantId();
    return this.transaction(() => {
      // 0. Kept change (owner decision 2026-10-07, POSTING_MAP G42): the
      //    client only CLAIMS a kept extra — check it against the explicit
      //    payment lines BEFORE any write, so a refusal rolls nothing back.
      //    Customer pays the shop: IN − OUT − kept = the debt reduction.
      //    Only when a kept amount is claimed: a repayment with nothing kept
      //    keeps today's behaviour (no reconcile — the smart-rounding LBP
      //    rule can legitimately leave more than the $0.05 epsilon over, see
      //    README → Business Logic). Synthesized legacy legs are NOT passed:
      //    a kept claim without real payment lines is refused outright.
      const claimedKept = {
        usd: data.kept_change_usd ?? 0,
        lbp: data.kept_change_lbp ?? 0,
      };
      const kept =
        claimedKept.usd !== 0 || claimedKept.lbp !== 0
          ? (() => {
              const explicit = partitionLegs(data.payments);
              return resolveKeptChange({
                payer: "customer",
                expected: { usd: data.amount_usd, lbp: data.amount_lbp },
                inLegs: explicit.inLegs,
                outLegs: explicit.outLegs,
                claimedKept,
                exchangeRate: getUsdLbpSellRate(this.db),
                ...(data.tender_exchange_rate !== undefined
                  ? { tenderExchangeRate: data.tender_exchange_rate }
                  : {}),
                context: "Debt repayment",
              });
            })()
          : { keptUsd: 0, keptLbp: 0 };

      // 1. Insert debt ledger entry
      const stmt = this.db.prepare(`
        INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by, tenant_id, created_at)
        VALUES (?, 'Repayment', ?, ?, ?, ?, ?, ?)
      `);

      // Store as negative values to signify a reduction in debt
      const result = stmt.run(
        data.client_id,
        -data.amount_usd,
        -data.amount_lbp,
        data.note || null,
        data.created_by,
        tenantId,
        // LIRA-306 FR-021: the event time on an offline replay.
        data.transaction_time ?? requestNow(),
      );

      const repaymentId = Number(result.lastInsertRowid);

      // Build payment legs: if multi-payment provided, use them; otherwise fall
      // back to the legacy single-method path using amount_usd / amount_lbp.
      const paymentLegs: RepaymentPaymentLine[] =
        data.payments && data.payments.length > 0
          ? data.payments
          : [
              ...(data.amount_usd > 0
                ? [
                    {
                      method: data.paid_by_method || "CASH",
                      currencyCode: "USD",
                      amount: data.amount_usd,
                    },
                  ]
                : []),
              ...(data.amount_lbp > 0
                ? [
                    {
                      method: data.paid_by_method || "CASH",
                      currencyCode: "LBP",
                      amount: data.amount_lbp,
                    },
                  ]
                : []),
            ];

      // Split customer-paid (IN) legs from shop-returned change (OUT) legs.
      const { inLegs, outLegs: returnLegs } = partitionLegs(paymentLegs);

      // Compute NET total (IN − OUT) per currency for transaction summary &
      // FIFO attribution — overpaid change is not applied to the debt.
      const sumByCurrency = (
        legs: RepaymentPaymentLine[],
        ccy: string,
      ): number =>
        legs
          .filter((l) => l.currencyCode === ccy)
          .reduce((s, l) => s + Math.abs(l.amount), 0);
      const totalUSD =
        sumByCurrency(inLegs, "USD") - sumByCurrency(returnLegs, "USD");
      const totalLBP =
        sumByCurrency(inLegs, "LBP") - sumByCurrency(returnLegs, "LBP");

      // Derive primary method label for metadata (first leg, or SPLIT)
      const uniqueMethods = [...new Set(inLegs.map((l) => l.method))];
      const primaryMethod =
        uniqueMethods.length === 1 ? uniqueMethods[0] : "SPLIT";

      // Owner decision (2026-08-08, repro: buy 89,000 vs. sell 90,000): the
      // `transactions.exchange_rate` stamp reflects what the operator
      // actually tendered, EXACTLY as typed (LIRA-240, 2026-09-28, retired
      // the old ±15%-band fallback to the server sell rate). Falls back to
      // the server rate only when absent (never throws — see
      // `CreateRepaymentData.tender_exchange_rate`'s doc). This repository has
      // no `reconcileLegs` anchor to preserve for repayments — nothing else
      // depends on this rate here.
      const recordExchangeRate = resolveStampedExchangeRate(
        getUsdLbpSellRate(this.db),
        data.tender_exchange_rate,
      );

      // G44 — the amount actually APPLIED to the debt, per TENDER currency:
      // the net tender (IN − OUT) minus the verified kept extra. The kept
      // extra is shop profit, not repayment budget, so it must not be routed
      // into a provider's cash drawer (the ledger reduction above already
      // excludes it). Used only for the PCD routing cap below (cash routing,
      // per tender currency); FIFO coverage uses the ledger reduction itself
      // (step 4), which is the same applied amount expressed in the DEBT's
      // currencies. A currency's remainder
      // may go negative when the kept extra sits in the other currency's
      // tender — settled against the other side at the stamped rate before
      // clamping (same netting as the page's computeRepaymentReduction).
      // Nothing kept → exactly the old figures (byte-for-byte behaviour).
      let appliedUSD = totalUSD;
      let appliedLBP = totalLBP;
      if (kept.keptUsd > 0 || kept.keptLbp > 0) {
        appliedUSD -= kept.keptUsd;
        appliedLBP -= kept.keptLbp;
        if (appliedUSD < 0) {
          appliedLBP += appliedUSD * recordExchangeRate;
          appliedUSD = 0;
        }
        if (appliedLBP < 0) {
          appliedUSD += appliedLBP / recordExchangeRate;
          appliedLBP = 0;
        }
        appliedUSD = Math.max(0, appliedUSD);
        appliedLBP = Math.max(0, appliedLBP);
      }

      // Create unified transaction row
      const clientName = this._getClientName(data.client_id);
      const txnId = getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.DEBT_REPAYMENT,
        source_table: "debt_ledger",
        source_id: repaymentId,
        user_id: data.created_by,
        amount_usd: data.amount_usd,
        amount_lbp: data.amount_lbp,
        // T3 keep-change: the kept extra is the ONLY profit a repayment books
        // ("Other / kept change" profits line). Stamped at create time so the
        // generic void's stamp negation reverses it symmetrically. Always the
        // VERIFIED figure from resolveKeptChange, never the raw claim.
        profit_usd: kept.keptUsd,
        profit_lbp: kept.keptLbp,
        client_id: data.client_id,
        // note 14 — thin-summary enrichment: client's name appended after
        // the existing "Debt Repayment: $X + Y LBP" prefix.
        summary: `Debt Repayment: $${data.amount_usd} + ${data.amount_lbp} LBP — ${clientName}`,
        exchange_rate: recordExchangeRate,
        metadata_json: {
          paid_by: primaryMethod,
          legs: paymentLegs.length > 1 ? paymentLegs : undefined,
          // CQ-8 counterparty contract: a repayment is the customer handing
          // cash INTO the shop. CQ-10: a bundled discount is annotated onto
          // this SAME transaction's metadata (informational — the money-and-
          // profit effect lives on the separate COUNTERPARTY_DISCOUNT row
          // posted below).
          counterparty: buildCounterpartyMetadata({
            kind: "client",
            id: data.client_id,
            name: clientName,
            flow: "IN",
            method: primaryMethod,
            ledgerEntryId: repaymentId,
            discount: data.discount
              ? {
                  amount_usd: Math.abs(data.discount.amount_usd || 0),
                  amount_lbp: Math.abs(data.discount.amount_lbp || 0),
                  reason: data.discount.reason,
                }
              : undefined,
          }),
        },
        // LIRA-329: the note, the ticked items, the discount as typed, and
        // the legs as booked with the verified kept change.
        details: buildAccountEntryDetails({
          action: "REPAYMENT",
          note: data.note,
          targets: data.targets,
          discount: data.discount,
        }),
        payment_snapshot: buildPaymentSnapshot({
          flow: "IN",
          payments: paymentLegs,
          keptChange: { usd: kept.keptUsd, lbp: kept.keptLbp },
        }),
        transaction_time: data.transaction_time,
      });

      // Link debt_ledger row to unified transaction
      this.db
        .prepare(
          `UPDATE debt_ledger SET transaction_id = ? WHERE id = ? AND tenant_id = ?`,
        )
        .run(txnId, repaymentId, tenantId);

      // 2. Record payment entries for drawer tracking / 3. Update drawer
      // balances — via the shared moneyPosting helpers (CQ-3).
      const insertPayment = {
        run: (
          transactionId: number,
          method: string,
          drawerName: string,
          currencyCode: string,
          amount: number,
          note: string | null,
          createdBy: number,
          tenant: number,
        ) =>
          insertPaymentRow(this.db, {
            transactionId,
            method,
            drawerName,
            currencyCode,
            amount,
            note,
            createdBy,
            tenantId: tenant,
          }),
      };
      const upsertBalance = {
        run: (
          drawerName: string,
          currencyCode: string,
          delta: number,
          tenant: number,
        ) =>
          applyDrawerDelta(this.db, {
            drawerName,
            currencyCode,
            delta,
            tenantId: tenant,
          }),
      };

      // LIRA-304 — ONE calculation (`allocateRepayment`, shared with the
      // repayment screen's preview) decides what this repayment pays and how
      // much of its cash goes to the shop's primary cash drawer
      // (specs/304-debt-item-picking/research.md D3/D6):
      //  - only the PRIMARY system's transfers are routed (OMT_System in an
      //    OMT shop, Whish_System in a Whish shop) — never the secondary
      //    system, never a wallet app (OMT App / Whish App / Binance);
      //  - only CASH is routed (a leg the primary-system resolver would send
      //    to the cash drawer), in the currency it was paid in;
      //  - ticked items first (a ticked transfer's share is routed, a ticked
      //    item of any other kind is not), then "OMT drawer first";
      //  - capped per transfer at its amount minus what earlier repayments
      //    already routed for it, valued in the transfer's own currency at
      //    each repayment's own rate — basket members and separate visits
      //    alike.
      // The routed share is written as an internal RESERVE pair (out of the
      // paying drawer, into the cash drawer): internal legs are always
      // mirrored exactly by a void/refund, even one that overrides the
      // refund method (research D4).
      const baseSystem = getSettingsRepository().getShopBaseSystem();
      const pcdDrawer = primaryCashDrawerName(baseSystem);
      const isRoutableCash = (method: string): boolean =>
        method !== "GIFT_CARD" &&
        isDrawerAffectingMethod(method) &&
        resolveServiceCashDrawer(method, {
          provider: baseSystem,
          baseSystem,
        }) === pcdDrawer;
      const openItems = this._loadAllocationItems(data.client_id, baseSystem);
      // LIRA-308 answer 2 — the "Earlier balance (no items)" line, measured
      // WITHOUT this repayment's own ledger row (already inserted above).
      const balanceItem = this._earlierBalanceItem(
        data.client_id,
        openItems,
        repaymentId,
      );
      if (balanceItem) openItems.push(balanceItem);
      this._assertTargetsOpen(data.targets ?? [], openItems);
      const routableCash = (ccy: string): number =>
        inLegs
          .filter(
            (l) =>
              l.currencyCode === ccy &&
              l.amount > 0 &&
              isRoutableCash(l.method),
          )
          .reduce((sum, l) => sum + l.amount, 0);
      const allocation = allocateRepayment({
        items: openItems,
        targets: data.targets,
        reductionUsd: data.amount_usd,
        reductionLbp: data.amount_lbp,
        appliedUsd: Math.max(0, appliedUSD),
        appliedLbp: Math.max(0, appliedLBP),
        cashUsd: Math.min(routableCash("USD"), Math.max(0, appliedUSD)),
        cashLbp: Math.min(routableCash("LBP"), Math.max(0, appliedLBP)),
        rate: recordExchangeRate,
      });

      // Customer-paid (IN) legs land in their own method's drawer.
      const legNote = data.note || "Debt repayment";
      for (const leg of inLegs) {
        if (leg.amount <= 0) continue;
        const legDrawer = paymentMethodToDrawerName(leg.method);
        insertPayment.run(
          txnId,
          leg.method,
          legDrawer,
          leg.currencyCode,
          leg.amount,
          legNote,
          data.created_by,
          tenantId,
        );
        upsertBalance.run(legDrawer, leg.currencyCode, leg.amount, tenantId);
      }

      // The routed share moves from the paying cash leg(s) into the primary
      // cash drawer, in the tender currency the calculation chose.
      const routableLeft = inLegs.map((l) =>
        l.amount > 0 && isRoutableCash(l.method) ? l.amount : 0,
      );
      const routedLegs: Array<{ currency: string; amount: number }> = [];
      for (const r of allocation.routing) {
        let need = r.tenderAmount;
        inLegs.forEach((leg, i) => {
          if (need <= 1e-9 || leg.currencyCode !== r.tenderCurrency) return;
          const x = Math.min(need, routableLeft[i]);
          if (x <= 1e-9) return;
          routableLeft[i] -= x;
          need -= x;
          const legDrawer = paymentMethodToDrawerName(leg.method);
          insertPayment.run(
            txnId,
            "RESERVE",
            legDrawer,
            leg.currencyCode,
            -x,
            `Move to ${pcdDrawer} cash drawer (${baseSystem} transfer debt)`,
            data.created_by,
            tenantId,
          );
          upsertBalance.run(legDrawer, leg.currencyCode, -x, tenantId);
          insertPayment.run(
            txnId,
            "RESERVE",
            pcdDrawer,
            leg.currencyCode,
            x,
            `Debt repayment: cash into ${pcdDrawer}`,
            data.created_by,
            tenantId,
          );
          upsertBalance.run(pcdDrawer, leg.currencyCode, x, tenantId);
          routedLegs.push({ currency: leg.currencyCode, amount: x });
        });
      }

      // Return (OUT) legs: overpaid change handed back via a chosen method, or
      // kept as store credit. Debits the method's drawer, or deposits credit.
      for (const r of returnLegs) {
        const amt = Math.abs(r.amount);
        if (amt <= 0) continue;
        if (r.method === "CUSTOMER_ACCOUNT") {
          this.addCredit({
            clientId: data.client_id,
            amountUsd: r.currencyCode === "USD" ? amt : 0,
            amountLbp: r.currencyCode === "LBP" ? amt : 0,
            // LIRA-313 — this change was NOT handed back; it stays on the
            // client's account as credit.
            note: "Overpayment kept as credit",
            createdBy: String(data.created_by),
            transactionId: txnId,
            ...(data.transaction_time
              ? { transactionTime: data.transaction_time }
              : {}),
          });
        } else if (isDrawerAffectingMethod(r.method)) {
          const drawer = paymentMethodToDrawerName(r.method);
          insertPayment.run(
            txnId,
            r.method,
            drawer,
            r.currencyCode,
            -amt,
            "Change returned",
            data.created_by,
            tenantId,
          );
          upsertBalance.run(drawer, r.currencyCode, -amt, tenantId);
        }
      }

      // 4. Coverage — what this repayment paid, item by item (sales on
      //    `sales.paid_usd`, charges on their row, basket items on their own
      //    share and the basket row together), decided by the calculation
      //    above: ticked items first, then today's order (sales first, then
      //    oldest first). Coverage budget = the ledger reduction itself, in
      //    the debt's own currencies (IN − OUT − kept, already netted by the
      //    caller). Recorded so the void gives back exactly this
      //    (TransactionRepository._restoreRepaymentDebt).
      const coverage = this._applyCoverage(allocation.coverage, openItems);
      this._recordRepaymentCoverage(txnId, coverage, {
        ...(allocation.routing.length > 0
          ? {
              routed: {
                provider: baseSystem,
                drawer: pcdDrawer,
                by_transfer: allocation.routing.map((r) => ({
                  ref: { kind: r.kind, id: r.id },
                  debt_currency: r.debtCurrency,
                  value: r.value,
                })),
                legs: routedLegs,
              },
            }
          : {
              routed: {
                provider: baseSystem,
                drawer: pcdDrawer,
                by_transfer: [],
                legs: [],
              },
            }),
        ...(data.targets && data.targets.length > 0
          ? { targets: data.targets }
          : {}),
      });

      // CQ-10 — bundled discount: posted AFTER the repayment's own coverage
      // so the discount's FIFO budget only touches whatever the cash portion
      // left open (same open rows, a second/remaining pass — never the same
      // dollars applied twice).
      if (
        data.discount &&
        (data.discount.amount_usd > 0 || data.discount.amount_lbp > 0)
      ) {
        this._postDebtDiscount(
          data.client_id,
          data.discount,
          data.created_by,
          data.transaction_time,
          // LIRA-308 decision 8: payment and discount together pay the
          // ticked items, in the same order (the discount walks on from
          // where the cash stopped — the same split as one combined walk).
          data.targets,
          // LIRA-308 answer 2: what is left of the earlier balance after
          // this repayment's cash (measured here, before its change-to-
          // account credit row could blur it).
          balanceItem
            ? (() => {
                const took = allocation.coverage.find(
                  (c) => c.kind === "balance",
                ) ?? { usd: 0, lbp: 0 };
                return {
                  usd: balanceItem.openUsd - took.usd,
                  lbp: balanceItem.openLbp - took.lbp,
                };
              })()
            : undefined,
        );
      }

      return { id: repaymentId };
    });
  }

  /**
   * CQ-10 — post ONE COUNTERPARTY_DISCOUNT transaction (+ its owning
   * 'Debt Discount' debt_ledger row) for a client whose debt is partly or
   * fully forgiven. Used by BOTH entry paths: bundled (called from inside
   * addRepayment's transaction) and standalone (writeOffDebt, its own
   * transaction). Mirrors addRepayment's own post-ledger coverage steps
   * (_markSalesPaidFIFO then _coverServiceDebtsFIFO) so a discount opens the
   * SAME profit-recognition gates a cash repayment would.
   *
   * amount_usd/amount_lbp = 0 (no cash moved — keeps cash-flow reports
   * clean); profit_usd/profit_lbp = NEGATIVE the forgiven amount (D1: the
   * shop forgives a receivable, a real cost).
   */
  private _postDebtDiscount(
    clientId: number,
    discount: CounterpartyDiscountData,
    createdBy: number,
    transactionTime?: string,
    /** LIRA-308 decision 8 — the bundled repayment's targets; absent for a
     *  standalone write-off (today's order). */
    targets?: DebtItemRef[],
    /** LIRA-308 answer 2 — the earlier balance still open after the bundled
     *  repayment's cash; only read when `targets` tick it. */
    balanceOpen?: { usd: number; lbp: number },
  ): number {
    const tenantId = getCurrentTenantId();
    const amountUsd = Math.abs(discount.amount_usd || 0);
    const amountLbp = Math.abs(discount.amount_lbp || 0);

    const stmt = this.db.prepare(`
      INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by, tenant_id, created_at)
      VALUES (?, 'Debt Discount', ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      clientId,
      -amountUsd,
      -amountLbp,
      discount.reason || null,
      createdBy,
      tenantId,
      // LIRA-306 FR-021: the event time on an offline replay.
      transactionTime ?? requestNow(),
    );
    const ledgerId = Number(result.lastInsertRowid);

    const clientName = this._getClientName(clientId);
    // CQ-5: the signed profit + counterparty metadata shape (D1 — forgiving
    // a receivable is booked "as if paid", flow IN) is now the ONE shared
    // helper every counterparty discount posts through (see moneyPosting.ts).
    const posting = buildCounterpartyDiscountPosting({
      kind: "client",
      ledgerEntryId: ledgerId,
      counterpartyId: clientId,
      counterpartyName: clientName,
      amountUsd,
      amountLbp,
      discountDirection: "forgiven",
      reason: discount.reason,
    });
    const txnId = getTransactionRepository().createTransaction({
      type: TRANSACTION_TYPES.COUNTERPARTY_DISCOUNT,
      source_table: "debt_ledger",
      source_id: ledgerId,
      user_id: createdBy,
      amount_usd: 0,
      amount_lbp: 0,
      profit_usd: posting.profit_usd,
      profit_lbp: posting.profit_lbp,
      client_id: clientId,
      summary: `Discount: $${amountUsd.toFixed(2)}${amountLbp ? ` + ${amountLbp.toLocaleString()} LBP` : ""} forgiven — ${clientName}`,
      metadata_json: posting.metadata_json,
      // LIRA-329: a write-off keeps its reason (as the note) and, when
      // bundled with a repayment, the items the cashier ticked.
      details: buildAccountEntryDetails({
        action: "WRITE_OFF",
        note: discount.reason,
        targets,
      }),
      transaction_time: transactionTime,
    });

    this.db
      .prepare(
        `UPDATE debt_ledger SET transaction_id = ? WHERE id = ? AND tenant_id = ?`,
      )
      .run(txnId, ledgerId, tenantId);

    // Same coverage shape as a repayment (DBT-1): sales absorb first via
    // _markSalesPaidFIFO, the remainder covers module-debt charge rows via
    // _coverServiceDebtsFIFO — otherwise a forgiven balance would leave
    // deferred profit stuck behind an uncovered charge row forever.
    // LIRA-304: the same calculation and coverage writer as a repayment
    // (ticked items first when bundled with a ticked repayment — LIRA-308
    // decision 8 — else today's order; a discount moves no cash, so nothing
    // is routed). A target the repayment's own cash already cleared is no
    // longer open and simply drops out. Its
    // coverage is recorded on the discount's own metadata for audit —
    // COUNTERPARTY_DISCOUNT stays non-reversible.
    const baseSystem = getSettingsRepository().getShopBaseSystem();
    const openItems = this._loadAllocationItems(clientId, baseSystem);
    if (balanceOpen) {
      const b = earlierBalanceItem(balanceOpen);
      if (
        b.openUsd > COVERAGE_EPSILON_USD ||
        b.openLbp > COVERAGE_EPSILON_LBP
      ) {
        openItems.push(b);
      }
    }
    const openTargets = (targets ?? []).filter((t) =>
      openItems.some((it) => it.kind === t.kind && it.id === t.id),
    );
    const allocation = allocateRepayment({
      items: openItems,
      ...(openTargets.length > 0 ? { targets: openTargets } : {}),
      reductionUsd: amountUsd,
      reductionLbp: amountLbp,
      appliedUsd: 0,
      appliedLbp: 0,
      cashUsd: 0,
      cashLbp: 0,
      rate: getUsdLbpSellRate(this.db),
    });
    const coverage = this._applyCoverage(allocation.coverage, openItems);
    this._recordRepaymentCoverage(txnId, coverage);

    return txnId;
  }

  /**
   * CQ-10 (D4: admin-only, enforced by the caller) — standalone write-off: no
   * settlement attached, just forgive part of what a client owes. Validation
   * (positive amount, does not exceed the outstanding balance per currency)
   * lives in DebtService.writeOffDebt — this method only posts the row.
   */
  writeOffDebt(data: {
    client_id: number;
    amount_usd: number;
    amount_lbp: number;
    reason?: string;
    created_by: number;
    transaction_time?: string;
  }): { id: number } {
    return this.transaction(() => {
      const txnId = this._postDebtDiscount(
        data.client_id,
        {
          amount_usd: data.amount_usd,
          amount_lbp: data.amount_lbp,
          reason: data.reason,
        },
        data.created_by,
        data.transaction_time,
      );
      return { id: txnId };
    });
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * LIRA-304 — every open debt item of the client, in the shape the shared
   * allocation (`allocateRepayment`) reads:
   *
   *  - "sale":   an unpaid sale (standalone or in a basket), covered on
   *              `sales.paid_usd` — same open-sale rule as before;
   *  - "charge": a coverable module charge row (`'Service Debt'`, `'Loto
   *              Debt'`, …) that is not a basket;
   *  - "member": one non-sale item of an open basket (`'Session Debt'`
   *              row), with its own open share (invariant I1).
   *
   * An open primary-system transfer (charge or member) also carries its
   * routing cap: its amount minus what earlier, still-standing repayments
   * already routed for it, in its own currency (research D3/D5).
   * 'Manual Debt' and other non-coverable rows are never listed.
   */
  private _loadAllocationItems(
    clientId: number,
    baseSystem: BaseSystem,
  ): AllocationItem[] {
    const tenantId = getCurrentTenantId();
    const items: AllocationItem[] = [];
    // A database from before v209, or a hand-rolled test schema, may lack
    // the basket member shares or the financial_services table: baskets are
    // then coverable as a whole and no transfer is routed (pre-LIRA-304).
    const hasFs = this._hasTable("financial_services");
    const hasMemberShares =
      this._hasTable("customer_session_transactions") &&
      this._hasColumn("customer_session_transactions", "owed_usd");
    const fsJoin = (alias: string, txn: string): string =>
      hasFs
        ? `LEFT JOIN financial_services ${alias} ON ${txn}.source_table = 'financial_services'
           AND ${alias}.id = ${txn}.source_id AND ${alias}.tenant_id = ${txn}.tenant_id`
        : "";
    const fsProvider = hasFs ? "fs.provider" : "NULL";

    const sales = this.db
      .prepare(
        `SELECT DISTINCT s.id, s.created_at,
                s.final_amount_usd - (s.paid_usd + COALESCE(s.paid_lbp, 0) / COALESCE(NULLIF(s.exchange_rate_snapshot, 0), 1)) AS open_usd
         FROM sales s
         JOIN transactions t ON t.source_table = 'sales' AND t.source_id = s.id
           AND t.tenant_id = s.tenant_id
         WHERE t.client_id = ? AND s.status = 'completed'
           AND (s.paid_usd + COALESCE(s.paid_lbp, 0) / COALESCE(NULLIF(s.exchange_rate_snapshot, 0), 1)) < s.final_amount_usd - 0.05
           AND s.tenant_id = ?`,
      )
      .all(clientId, tenantId) as Array<{
      id: number;
      created_at: string;
      open_usd: number;
    }>;
    for (const r of sales) {
      items.push({
        kind: "sale",
        id: r.id,
        rowId: r.id,
        createdAt: r.created_at,
        openUsd: Math.max(0, r.open_usd),
        openLbp: 0,
      });
    }

    const charges = this.db
      .prepare(
        `SELECT dl.id, dl.created_at, dl.transaction_type, ${fsProvider} AS provider,
                t.status AS txn_status,
                ${coverageOutstandingSql("dl", "usd")} AS open_usd,
                ${coverageOutstandingSql("dl", "lbp")} AS open_lbp,
                dl.amount_usd + COALESCE((SELECT SUM(rr.amount_usd) FROM debt_ledger rr
                  WHERE rr.transaction_id = dl.transaction_id AND rr.tenant_id = dl.tenant_id
                    AND rr.transaction_type = 'Refund Reversal'), 0) AS owed_usd,
                dl.amount_lbp + COALESCE((SELECT SUM(rr.amount_lbp) FROM debt_ledger rr
                  WHERE rr.transaction_id = dl.transaction_id AND rr.tenant_id = dl.tenant_id
                    AND rr.transaction_type = 'Refund Reversal'), 0) AS owed_lbp
         FROM debt_ledger dl
         LEFT JOIN transactions t ON t.id = dl.transaction_id AND t.tenant_id = dl.tenant_id
         ${fsJoin("fs", "t")}
         WHERE dl.client_id = ? AND dl.tenant_id = ?
           AND dl.transaction_type <> 'Session Debt'
           AND ${coverableChargeSql("dl")}
           AND ${coverageOpenSql("dl")}`,
      )
      .all(clientId, tenantId) as Array<{
      id: number;
      created_at: string;
      transaction_type: string;
      provider: string | null;
      txn_status: string | null;
      open_usd: number;
      open_lbp: number;
      owed_usd: number;
      owed_lbp: number;
    }>;

    const members = !hasMemberShares
      ? []
      : (this.db
          .prepare(
            `SELECT cst.id, dl.id AS row_id, dl.created_at, ${fsProvider} AS provider,
                ${memberOutstandingSql("cst", "usd")} AS open_usd,
                ${memberOutstandingSql("cst", "lbp")} AS open_lbp,
                ${memberOutstandingSql("cst", "usd")} + cst.covered_usd AS owed_usd,
                ${memberOutstandingSql("cst", "lbp")} + cst.covered_lbp AS owed_lbp
         FROM debt_ledger dl
         JOIN customer_session_transactions cst ON cst.session_id = dl.session_id
           AND cst.tenant_id = dl.tenant_id
         JOIN transactions t ON t.id = cst.unified_transaction_id AND t.tenant_id = cst.tenant_id
         ${fsJoin("fs", "t")}
         WHERE dl.client_id = ? AND dl.tenant_id = ?
           AND dl.transaction_type = 'Session Debt'
           AND ${coverableChargeSql("dl")}
           AND cst.transaction_type <> 'session_item_refund'
           AND t.type <> 'SALE'
           AND ${memberOpenSql("cst")}`,
          )
          .all(clientId, tenantId) as Array<{
          id: number;
          row_id: number;
          created_at: string;
          provider: string | null;
          open_usd: number;
          open_lbp: number;
          owed_usd: number;
          owed_lbp: number;
        }>);

    // A basket row whose outstanding its members do not account for (a
    // basket booked without member shares) stays coverable as a whole.
    const baskets = this.db
      .prepare(
        `SELECT dl.id, dl.created_at,
                ${coverageOutstandingSql("dl", "usd")} AS open_usd,
                ${coverageOutstandingSql("dl", "lbp")} AS open_lbp
         FROM debt_ledger dl
         WHERE dl.client_id = ? AND dl.tenant_id = ?
           AND dl.transaction_type = 'Session Debt'
           AND ${coverableChargeSql("dl")}
           AND ${coverageOpenSql("dl")}`,
      )
      .all(clientId, tenantId) as Array<{
      id: number;
      created_at: string;
      open_usd: number;
      open_lbp: number;
    }>;
    for (const b of baskets) {
      const mine = members.filter((m) => m.row_id === b.id);
      const gapUsd = b.open_usd - mine.reduce((s2, m) => s2 + m.open_usd, 0);
      const gapLbp = b.open_lbp - mine.reduce((s2, m) => s2 + m.open_lbp, 0);
      if (gapUsd > COVERAGE_EPSILON_USD || gapLbp > COVERAGE_EPSILON_LBP) {
        items.push({
          kind: "charge",
          id: b.id,
          rowId: b.id,
          createdAt: b.created_at,
          openUsd: Math.max(0, gapUsd),
          openLbp: Math.max(0, gapLbp),
        });
      }
    }

    const routed = this._readRoutedByTransfer(clientId, baseSystem, charges);
    for (const c of charges) {
      const isTransfer =
        c.transaction_type === "Service Debt" &&
        c.txn_status === "ACTIVE" &&
        isPrimarySystemProvider(c.provider, baseSystem);
      const r = routed.get(`charge:${c.id}`) ?? { usd: 0, lbp: 0 };
      items.push({
        kind: "charge",
        id: c.id,
        rowId: c.id,
        createdAt: c.created_at,
        openUsd: Math.max(0, c.open_usd),
        openLbp: Math.max(0, c.open_lbp),
        routingCap: isTransfer
          ? {
              usd: Math.max(0, c.owed_usd - r.usd),
              lbp: Math.max(0, c.owed_lbp - r.lbp),
            }
          : null,
      });
    }
    for (const m of members) {
      const isTransfer = isPrimarySystemProvider(m.provider, baseSystem);
      const r = routed.get(`member:${m.id}`) ?? { usd: 0, lbp: 0 };
      items.push({
        kind: "member",
        id: m.id,
        rowId: m.row_id,
        createdAt: m.created_at,
        openUsd: Math.max(0, m.open_usd),
        openLbp: Math.max(0, m.open_lbp),
        routingCap: isTransfer
          ? {
              usd: Math.max(0, m.owed_usd - r.usd),
              lbp: Math.max(0, m.owed_lbp - r.lbp),
            }
          : null,
      });
    }
    return items;
  }

  /**
   * LIRA-304 — how much earlier repayments already routed to the primary
   * cash drawer, per transfer and debt currency. Counts only repayments
   * still standing: not voided AND not reversed by a refund (a refund can
   * leave the original ACTIVE — research D5). Repayments booked before
   * LIRA-304 carry no per-transfer record; their positive cash-drawer rows
   * are attributed to the client's primary-system transfer charges, oldest
   * first, in the same currency (that routing was strictly per currency).
   */
  private _readRoutedByTransfer(
    clientId: number,
    baseSystem: BaseSystem,
    charges: Array<{
      id: number;
      created_at: string;
      transaction_type: string;
      provider: string | null;
      owed_usd: number;
      owed_lbp: number;
    }>,
  ): Map<string, { usd: number; lbp: number }> {
    const tenantId = getCurrentTenantId();
    const out = new Map<string, { usd: number; lbp: number }>();
    const add = (k: string, ccy: string, v: number): void => {
      const cur = out.get(k) ?? { usd: 0, lbp: 0 };
      if (ccy === "USD") cur.usd += v;
      else if (ccy === "LBP") cur.lbp += v;
      out.set(k, cur);
    };
    const standing = this.db
      .prepare(
        `SELECT t.id, t.metadata_json FROM transactions t
         WHERE t.client_id = ? AND t.tenant_id = ? AND t.type = ?
           AND t.status = 'ACTIVE'
           AND NOT EXISTS (SELECT 1 FROM transactions rv
                           WHERE rv.reverses_id = t.id AND rv.tenant_id = t.tenant_id)`,
      )
      .all(clientId, tenantId, TRANSACTION_TYPES.DEBT_REPAYMENT) as Array<{
      id: number;
      metadata_json: string | null;
    }>;
    const pcdDrawer = primaryCashDrawerName(baseSystem);
    const legacyIds: number[] = [];
    for (const row of standing) {
      let routed: unknown = undefined;
      try {
        routed = row.metadata_json
          ? (JSON.parse(row.metadata_json) as Record<string, unknown>).routed
          : undefined;
      } catch {
        routed = undefined;
      }
      const byTransfer =
        routed && typeof routed === "object"
          ? (routed as { by_transfer?: unknown }).by_transfer
          : undefined;
      if (!Array.isArray(byTransfer)) {
        legacyIds.push(row.id);
        continue;
      }
      for (const e of byTransfer as Array<{
        ref?: { kind?: string; id?: number };
        debt_currency?: string;
        value?: number;
      }>) {
        if (!e?.ref?.kind || typeof e.ref.id !== "number") continue;
        add(
          `${e.ref.kind}:${e.ref.id}`,
          e.debt_currency ?? "USD",
          typeof e.value === "number" ? e.value : 0,
        );
      }
    }
    if (legacyIds.length > 0) {
      const placeholders = legacyIds.map(() => "?").join(", ");
      const legacy = this.db
        .prepare(
          `SELECT currency_code, COALESCE(SUM(amount), 0) AS routed
           FROM payments
           WHERE transaction_id IN (${placeholders}) AND tenant_id = ?
             AND drawer_name = ? AND amount > 0
           GROUP BY currency_code`,
        )
        .all(...legacyIds, tenantId, pcdDrawer) as Array<{
        currency_code: string;
        routed: number;
      }>;
      const transfers = charges
        .filter(
          (c) =>
            c.transaction_type === "Service Debt" &&
            isPrimarySystemProvider(c.provider, baseSystem),
        )
        .sort((a, b) =>
          a.created_at === b.created_at
            ? a.id - b.id
            : a.created_at < b.created_at
              ? -1
              : 1,
        );
      for (const l of legacy) {
        let left = l.routed;
        for (const c of transfers) {
          if (left <= 0) break;
          const owed = l.currency_code === "USD" ? c.owed_usd : c.owed_lbp;
          const take = Math.min(left, Math.max(0, owed));
          if (take > 0) add(`charge:${c.id}`, l.currency_code, take);
          left -= take;
        }
      }
    }
    return out;
  }

  private _hasTable(name: string): boolean {
    return !!this.db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name);
  }

  private _hasColumn(table: string, column: string): boolean {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;
    return cols.some((c) => c.name === column);
  }

  /**
   * LIRA-304 — every open debt item of a client, as the repayment screen's
   * picker lists it (and as its "Goes to" preview feeds the shared
   * allocation): the allocation fields plus each item's own transaction
   * summary, type and basket. Oldest first.
   */
  findOpenDebtItems(clientId: number): OpenDebtItem[] {
    const tenantId = getCurrentTenantId();
    const baseSystem = getSettingsRepository().getShopBaseSystem();
    const items = this._loadAllocationItems(clientId, baseSystem);
    const hasCst = this._hasTable("customer_session_transactions");
    const saleInfo = this.db.prepare(
      `SELECT t.summary, t.type${
        hasCst
          ? `,
              (SELECT cst.session_id FROM customer_session_transactions cst
                WHERE cst.unified_transaction_id = t.id AND cst.tenant_id = t.tenant_id
                LIMIT 1) AS session_id`
          : ", NULL AS session_id"
      }
       FROM transactions t
       WHERE t.source_table = 'sales' AND t.source_id = ? AND t.tenant_id = ?
         AND t.type = 'SALE'
       ORDER BY t.id ASC LIMIT 1`,
    );
    const chargeInfo = this.db.prepare(
      `SELECT COALESCE(t.summary, dl.note, dl.transaction_type) AS summary,
              t.type, dl.session_id
       FROM debt_ledger dl
       LEFT JOIN transactions t ON t.id = dl.transaction_id AND t.tenant_id = dl.tenant_id
       WHERE dl.id = ? AND dl.tenant_id = ?`,
    );
    const memberInfo = hasCst
      ? this.db.prepare(
          `SELECT t.summary, t.type, cst.session_id
           FROM customer_session_transactions cst
           JOIN transactions t ON t.id = cst.unified_transaction_id AND t.tenant_id = cst.tenant_id
           WHERE cst.id = ? AND cst.tenant_id = ?`,
        )
      : null;
    type Info = {
      summary: string | null;
      type: string | null;
      session_id: number | null;
    };
    // LIRA-308 answer 2 — the part of the balance no listed item accounts
    // for, as its own line, so ticking everything = the whole balance. Only
    // next to listed items: a client with nothing but such debt keeps the
    // plain (no-picker) repayment.
    const balanceItem =
      items.length > 0 ? this._earlierBalanceItem(clientId, items) : null;
    const balanceLine: OpenDebtItem[] = balanceItem
      ? [
          {
            ...balanceItem,
            label: EARLIER_BALANCE_LABEL,
            type: null,
            sessionId: null,
            isPrimary: false,
            primaryDrawer: null,
          },
        ]
      : [];
    return [
      ...balanceLine,
      ...items
        .map((it): OpenDebtItem => {
          const info = (
            it.kind === "sale"
              ? saleInfo.get(it.id, tenantId)
              : it.kind === "charge"
                ? chargeInfo.get(it.id, tenantId)
                : memberInfo?.get(it.id, tenantId)
          ) as Info | undefined;
          return {
            ...it,
            label: info?.summary ?? `${it.kind} #${it.id}`,
            type: info?.type ?? null,
            sessionId: info?.session_id ?? null,
            isPrimary: isCashDrawerItem(it),
            primaryDrawer: isCashDrawerItem(it)
              ? primaryCashDrawerName(baseSystem)
              : null,
          };
        })
        .sort((a, b) =>
          a.createdAt === b.createdAt
            ? a.rowId - b.rowId || a.id - b.id
            : a.createdAt < b.createdAt
              ? -1
              : 1,
        ),
    ];
  }

  /**
   * LIRA-308 answer 2 (2026-10-11) — the client's balance that no open item
   * accounts for (manual / imported / opening debt), as the
   * "Earlier balance (no items)" allocation item, or null when there is
   * none. Ledger balance minus the items' open amounts, per currency; a
   * shortfall in one currency (e.g. an LBP credit) is netted against the
   * other at the sell rate. `excludeLedgerId` leaves out a row the caller
   * has just inserted (addRepayment's own Repayment row), so the gap is the
   * one the cashier saw. Below 5¢ / 5,000 LBP it is rounding noise, not a
   * line.
   */
  private _earlierBalanceItem(
    clientId: number,
    items: AllocationItem[],
    excludeLedgerId?: number,
  ): AllocationItem | null {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
         FROM debt_ledger
         WHERE client_id = ? AND tenant_id = ? AND id <> ?`,
      )
      .get(clientId, getCurrentTenantId(), excludeLedgerId ?? -1) as {
      usd: number;
      lbp: number;
    };
    let gapUsd = row.usd - items.reduce((s, it) => s + it.openUsd, 0);
    let gapLbp = row.lbp - items.reduce((s, it) => s + it.openLbp, 0);
    const rate = getUsdLbpSellRate(this.db) || 1;
    if (gapUsd < 0 && gapLbp > 0) {
      gapLbp = Math.max(0, gapLbp + gapUsd * rate);
      gapUsd = 0;
    } else if (gapLbp < 0 && gapUsd > 0) {
      gapUsd = Math.max(0, gapUsd + gapLbp / rate);
      gapLbp = 0;
    }
    gapUsd = Math.round(Math.max(0, gapUsd) * 100) / 100;
    gapLbp = Math.round(Math.max(0, gapLbp));
    if (
      gapUsd <= EARLIER_BALANCE_MIN_USD &&
      gapLbp <= EARLIER_BALANCE_MIN_LBP
    ) {
      return null;
    }
    return earlierBalanceItem({
      usd: gapUsd > EARLIER_BALANCE_MIN_USD ? gapUsd : 0,
      lbp: gapLbp > EARLIER_BALANCE_MIN_LBP ? gapLbp : 0,
    });
  }

  /** LIRA-304 — refuse (before any write) a ticked item that is not one of
   *  this client's open items: closed, refunded, someone else's, or a kind
   *  that cannot be paid item by item ('Manual Debt'). */
  private _assertTargetsOpen(
    targets: DebtItemRef[],
    items: AllocationItem[],
  ): void {
    for (const t of targets) {
      if (!items.some((it) => it.kind === t.kind && it.id === t.id)) {
        throw new DatabaseError(
          "One of the ticked items is no longer open for this customer — reload and try again.",
        );
      }
    }
  }

  /**
   * LIRA-304 — the ONE writer of a repayment's / discount's coverage:
   * `sales.paid_usd` for sales, the charge row's `covered_*` for charges,
   * and a basket member's `covered_*` together with its basket row for
   * members (`coverBasketMember`, which also refuses to over-cover an item
   * two cashiers raced for). Returns the record the void reads back.
   */
  private _applyCoverage(
    takes: CoverageTake[],
    items: AllocationItem[],
  ): RepaymentCoverageRecord {
    const tenantId = getCurrentTenantId();
    const record: RepaymentCoverageRecord = {
      sales: [],
      charges: [],
      members: [],
    };
    const updSale = this.db.prepare(
      `UPDATE sales SET paid_usd = paid_usd + ? WHERE id = ? AND tenant_id = ?`,
    );
    const updCharge = this.db.prepare(
      `UPDATE debt_ledger SET covered_usd = covered_usd + ?, covered_lbp = covered_lbp + ?
       WHERE id = ? AND tenant_id = ?`,
    );
    for (const t of takes) {
      if (t.usd <= 0 && t.lbp <= 0) continue;
      // LIRA-308 answer 2 — the earlier-balance line has no row to cover:
      // the repayment's own ledger row is the whole effect (and its void
      // the reversal owner).
      if (t.kind === "balance") continue;
      if (t.kind === "sale") {
        updSale.run(t.usd, t.id, tenantId);
        record.sales.push({ id: t.id, usd: t.usd });
      } else if (t.kind === "charge") {
        updCharge.run(t.usd, t.lbp, t.id, tenantId);
        record.charges.push({ id: t.id, usd: t.usd, lbp: t.lbp });
      } else {
        const item = items.find((i) => i.kind === "member" && i.id === t.id);
        const { rowId } = coverBasketMember(
          this.db,
          tenantId,
          t.id,
          t.usd,
          t.lbp,
        );
        record.members!.push({
          id: t.id,
          row_id: item?.rowId ?? rowId,
          usd: t.usd,
          lbp: t.lbp,
        });
      }
    }
    return record;
  }

  /**
   * Stamp a repayment's coverage record onto its DEBT_REPAYMENT transaction
   * (see REPAYMENT_COVERAGE_KEY). Merged into the existing metadata — every
   * other key is left exactly as createTransaction wrote it.
   */
  private _recordRepaymentCoverage(
    txnId: number,
    coverage: RepaymentCoverageRecord,
    extra: Record<string, unknown> = {},
  ): void {
    const tenantId = getCurrentTenantId();
    const row = this.db
      .prepare(
        `SELECT metadata_json FROM transactions WHERE id = ? AND tenant_id = ?`,
      )
      .get(txnId, tenantId) as { metadata_json: string | null } | undefined;
    if (!row) return;
    let meta: Record<string, unknown> = {};
    if (row.metadata_json) {
      try {
        const parsed: unknown = JSON.parse(row.metadata_json);
        if (!parsed || typeof parsed !== "object") return;
        meta = parsed as Record<string, unknown>;
      } catch {
        // Never clobber metadata we cannot read; the void then falls back
        // to the legacy re-derivation for this one repayment.
        return;
      }
    }
    meta[REPAYMENT_COVERAGE_KEY] = coverage;
    Object.assign(meta, extra);
    this.db
      .prepare(
        `UPDATE transactions SET metadata_json = ? WHERE id = ? AND tenant_id = ?`,
      )
      .run(JSON.stringify(meta), txnId, tenantId);
  }

  // ---------------------------------------------------------------------------
  // Credit Operations
  // ---------------------------------------------------------------------------

  /**
   * Add a credit entry (shop owes customer). Stored as NEGATIVE amounts.
   *
   * Rule 20: when this credit is a side effect of an enclosing unified
   * transaction (change returned as store credit, a RECEIVE cashed out to
   * CUSTOMER_ACCOUNT, a Binance/app-wallet payout kept on account, etc.),
   * callers MUST pass `transactionId` — the same convention
   * `bookClientDebtCharge` (moneyPosting.ts) uses for module-charge rows.
   * Without it, `TransactionRepository._cancelDebt` has no way to find and
   * reverse this row on void/refund, and the customer keeps the credit for
   * free (owner-reported real-money leak). Standalone/manual credits (the
   * Debts-page "add credit" action, voucher redemption with no originating
   * transaction) correctly omit it — they have no transaction to link to and
   * are never touched by the generic reversal.
   */
  addCredit(data: {
    clientId: number;
    amountUsd: number;
    amountLbp: number;
    note: string;
    createdBy: string;
    transactionTime?: string;
    /** Set when the credit belongs to a customer-session basket (e.g. a
     *  cash-out settled to the customer's account). Drives the Debts-page
     *  eye button that opens the basket breakdown; null for every other
     *  credit. */
    sessionId?: number;
    /** The unified transaction this credit is a side effect of (see method
     *  doc). Omit for standalone/manual credits with no originating
     *  transaction. */
    transactionId?: number;
  }): { id: number } {
    const stmt = this.db.prepare(`
      INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, transaction_id, note, created_by, session_id, tenant_id, created_at)
      VALUES (?, 'CREDIT_DEPOSIT', ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      data.clientId,
      -Math.abs(data.amountUsd),
      -Math.abs(data.amountLbp),
      data.transactionId ?? null,
      data.note || null,
      data.createdBy,
      data.sessionId ?? null,
      getCurrentTenantId(),
      // LIRA-306 FR-021: the event time on an offline replay.
      data.transactionTime ?? requestNow(),
    );
    return { id: Number(result.lastInsertRowid) };
  }

  /**
   * Use credit (consume credit balance). Stored as POSITIVE amounts.
   */
  useCredit(data: {
    clientId: number;
    amountUsd: number;
    amountLbp: number;
    note: string;
    createdBy: string;
    transactionTime?: string;
  }): { id: number } {
    const stmt = this.db.prepare(`
      INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by, tenant_id, created_at)
      VALUES (?, 'CREDIT_USED', ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      data.clientId,
      Math.abs(data.amountUsd),
      Math.abs(data.amountLbp),
      data.note || null,
      data.createdBy,
      getCurrentTenantId(),
      // LIRA-306 FR-021: the event time on an offline replay.
      data.transactionTime ?? requestNow(),
    );
    return { id: Number(result.lastInsertRowid) };
  }

  /**
   * Cash out a client's credit: the shop PAYS the customer their credit.
   * Books a POSITIVE CREDIT_USED ledger row (brings the negative balance
   * toward zero), a CREDIT_CASH_OUT unified transaction, and DEBITS each
   * payout leg's drawer in its own currency — the mirror image of a
   * repayment. amount_usd/amount_lbp are the credit reduction (LBP legs
   * pre-converted by the caller); payments[] are the physical payout legs.
   *
   * Kept change (payer "payout", owner decision 2026-10-07): the shop may
   * hand out slightly LESS than the credit (e.g. $101 of $101.12). The credit
   * still clears by the full reduction and the shortfall is shop profit,
   * stamped on the CREDIT_CASH_OUT row's own profit. `resolveKeptChange`
   * checks every cash-out before any write: payout lines = reduction − kept
   * (S2 epsilon), kept within PAYOUT_KEEP_CHANGE_MAX ($5 / 450,000 LBP, inclusive) in the credit's own
   * currency, and NO OUT legs (a payout has no change — the old loop debited
   * an OUT leg as if it were more cash handed out). A mixed USD + LBP credit
   * cannot keep change (the helper owes in one currency). Every payout line
   * must move a drawer: a CUSTOMER_ACCOUNT/GIFT_CARD line used to be skipped
   * silently, reducing the credit with no money leaving the shop.
   */
  cashOutCredit(data: {
    client_id: number;
    amount_usd: number;
    amount_lbp: number;
    payments?: RepaymentPaymentLine[];
    note?: string | null;
    created_by: number;
    transaction_time?: string;
    /** See `CreateRepaymentData.tender_exchange_rate`'s doc — same
     *  payment-sheet rate concept, same `resolveStampedExchangeRate` stamp
     *  rule, applied here for CREDIT_CASH_OUT. Also the rate the payout
     *  lines are reconciled at (rule 27). */
    tender_exchange_rate?: number;
    /** Kept change CLAIM (shortfall the shop keeps as profit) — verified by
     *  resolveKeptChange, never trusted as sent. Same names as the
     *  repayment's (`kept_change_usd`/`kept_change_lbp`). */
    kept_change_usd?: number;
    kept_change_lbp?: number;
    /** LIRA-313 — the part of `amount_*` paid out BEYOND the client's
     *  credit (computed by DebtService.cashOut, per currency). It is booked
     *  as a separate 'Manual Debt' row in the SAME transaction: the client
     *  now owes it. Default 0 = the whole amount clears credit. */
    debt_excess_usd?: number;
    debt_excess_lbp?: number;
  }): { id: number } {
    const tenantId = getCurrentTenantId();
    return this.transaction(() => {
      const reductionUsd = Math.abs(data.amount_usd);
      const reductionLbp = Math.abs(data.amount_lbp);
      const excessUsd = Math.min(
        reductionUsd,
        Math.max(0, data.debt_excess_usd ?? 0),
      );
      const excessLbp = Math.min(
        reductionLbp,
        Math.max(0, data.debt_excess_lbp ?? 0),
      );

      // Payout legs: default to CASH legs matching the reduction PER
      // CURRENCY. A USD-only default silently skipped the drawer debit on an
      // LBP cash-out with no explicit legs (credit reduced, till untouched).
      const legs: RepaymentPaymentLine[] =
        data.payments && data.payments.length > 0
          ? data.payments
          : [
              ...(reductionUsd > 0
                ? [
                    {
                      method: "CASH",
                      currencyCode: "USD",
                      amount: reductionUsd,
                    },
                  ]
                : []),
              ...(reductionLbp > 0
                ? [
                    {
                      method: "CASH",
                      currencyCode: "LBP",
                      amount: reductionLbp,
                    },
                  ]
                : []),
            ];

      // Server rate-of-record; the stamp and the reconcile both prefer the
      // till's tender rate (see addRepayment's identical comment).
      const serverRate = getUsdLbpSellRate(this.db);
      const recordExchangeRate = resolveStampedExchangeRate(
        serverRate,
        data.tender_exchange_rate,
      );

      // Verify the payout BEFORE any write. The helper owes in ONE currency:
      // an LBP-only credit owes LBP; otherwise USD (a mixed credit's LBP side
      // converted at the same rate the reconcile uses — exact, no drift).
      const claimedKept = {
        usd: data.kept_change_usd ?? 0,
        lbp: data.kept_change_lbp ?? 0,
      };
      if (
        (claimedKept.usd > 0 || claimedKept.lbp > 0) &&
        reductionUsd > 0 &&
        reductionLbp > 0
      ) {
        throw new Error(
          "Credit cash out: keeping change needs a credit in one currency — pay a mixed USD + LBP credit out exactly",
        );
      }
      const owedCurrency =
        reductionUsd === 0 && reductionLbp > 0 ? "LBP" : "USD";
      const kept = resolveKeptChange({
        payer: "payout",
        owed:
          owedCurrency === "LBP"
            ? reductionLbp
            : usdEquivalent(reductionUsd, reductionLbp, recordExchangeRate),
        owedCurrency,
        payoutLegs: legs,
        claimedKept,
        exchangeRate: serverRate,
        ...(data.tender_exchange_rate !== undefined
          ? { tenderExchangeRate: data.tender_exchange_rate }
          : {}),
        context: "Credit cash out",
      });
      for (const leg of legs) {
        if (Math.abs(leg.amount) > 0 && !isDrawerAffectingMethod(leg.method)) {
          throw new Error(
            `Credit cash out: ${leg.method} cannot pay out a credit — choose a method that takes money out of a drawer`,
          );
        }
      }

      const stmt = this.db.prepare(`
        INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by, tenant_id, created_at)
        VALUES (?, 'CREDIT_USED', ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(
        data.client_id,
        reductionUsd - excessUsd,
        reductionLbp - excessLbp,
        data.note || "Credit cash out",
        data.created_by,
        tenantId,
        // LIRA-306 FR-021: the event time on an offline replay.
        data.transaction_time ?? requestNow(),
      );
      const ledgerId = Number(result.lastInsertRowid);
      // LIRA-313 — paid out beyond the credit: the client now owes the
      // excess. Same 'Manual Debt' row (and sign) a cash advance books, so
      // it is repaid like any other account debt. CREDIT_CASH_OUT is
      // NON_REVERSIBLE (transactionTypes.ts), so this row — linked to the
      // same transaction below — has no void path to own (rule 20).
      let excessLedgerId: number | null = null;
      if (excessUsd > 0 || excessLbp > 0) {
        const excessRes = this.db
          .prepare(
            `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by, tenant_id, created_at)
             VALUES (?, 'Manual Debt', ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            data.client_id,
            excessUsd,
            excessLbp,
            "Paid out beyond credit",
            data.created_by,
            tenantId,
            data.transaction_time ?? requestNow(),
          );
        excessLedgerId = Number(excessRes.lastInsertRowid);
      }

      const txnId = getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.CREDIT_CASH_OUT,
        source_table: "debt_ledger",
        source_id: ledgerId,
        user_id: data.created_by,
        amount_usd: Math.abs(data.amount_usd),
        amount_lbp: Math.abs(data.amount_lbp),
        // Kept change (verified above) is the ONLY profit a cash-out books —
        // in the transaction's own stamp, per currency, never converted.
        // CREDIT_CASH_OUT is NON_REVERSIBLE (see transactionTypes.ts), so no
        // generic void can negate it.
        profit_usd: kept.keptUsd,
        profit_lbp: kept.keptLbp,
        client_id: data.client_id,
        summary: `Credit Cash Out: $${Math.abs(data.amount_usd)} + ${Math.abs(
          data.amount_lbp,
        )} LBP${
          excessUsd > 0 || excessLbp > 0
            ? ` (beyond credit, now owed: $${excessUsd} + ${excessLbp} LBP)`
            : ""
        }`,
        exchange_rate: recordExchangeRate,
        metadata_json: {
          legs: legs.length > 1 ? legs : undefined,
          paid_by: legs.length === 1 ? legs[0].method : "SPLIT",
          // CQ-8 counterparty contract: the shop pays the customer their
          // held credit OUT of the drawer.
          counterparty: buildCounterpartyMetadata({
            kind: "client",
            id: data.client_id,
            name: this._getClientName(data.client_id),
            flow: "OUT",
            method: legs.length === 1 ? legs[0].method : "SPLIT",
            ledgerEntryId: ledgerId,
          }),
        },
        // LIRA-329: the note as typed and the payout legs with any verified
        // kept change.
        details: buildAccountEntryDetails({
          action: "CREDIT_CASH_OUT",
          note: data.note,
        }),
        payment_snapshot: buildPaymentSnapshot({
          flow: "PAYOUT",
          payments: legs,
          keptChange: { usd: kept.keptUsd, lbp: kept.keptLbp },
        }),
        transaction_time: data.transaction_time,
      });

      this.db
        .prepare(
          `UPDATE debt_ledger SET transaction_id = ? WHERE id = ? AND tenant_id = ?`,
        )
        .run(txnId, ledgerId, tenantId);
      if (excessLedgerId !== null) {
        this.db
          .prepare(
            `UPDATE debt_ledger SET transaction_id = ? WHERE id = ? AND tenant_id = ?`,
          )
          .run(txnId, excessLedgerId, tenantId);
      }

      const insertPayment = {
        run: (
          transactionId: number,
          method: string,
          drawerName: string,
          currencyCode: string,
          amount: number,
          note: string | null,
          createdBy: number,
          tenant: number,
        ) =>
          insertPaymentRow(this.db, {
            transactionId,
            method,
            drawerName,
            currencyCode,
            amount,
            note,
            createdBy,
            tenantId: tenant,
          }),
      };
      const upsertBalance = {
        run: (
          drawerName: string,
          currencyCode: string,
          delta: number,
          tenant: number,
        ) =>
          applyDrawerDelta(this.db, {
            drawerName,
            currencyCode,
            delta,
            tenantId: tenant,
          }),
      };

      for (const leg of legs) {
        const amt = Math.abs(leg.amount);
        // Every leg here is an IN-direction, drawer-affecting payout line —
        // resolveKeptChange refused OUT legs and the check above refused
        // non-drawer methods, both before any write.
        if (amt <= 0) continue;
        const drawer = paymentMethodToDrawerName(leg.method);
        insertPayment.run(
          txnId,
          leg.method,
          drawer,
          leg.currencyCode,
          -amt,
          data.note || "Credit cash out",
          data.created_by,
          tenantId,
        );
        upsertBalance.run(drawer, leg.currencyCode, -amt, tenantId);
      }

      return { id: ledgerId };
    });
  }

  /**
   * Manual account cash entry from the Accounts (Debts) page — the till-moving
   * counterpart of the old, till-less addCredit.
   *
   *  - direction "credit": the customer HANDS the shop cash → drawer(s) IN, a
   *    NEGATIVE 'CREDIT_DEPOSIT' debt_ledger row (shop owes customer), and a
   *    CREDIT_CASH_IN unified transaction.
   *  - direction "debt": the shop GIVES the customer cash (a cash advance) →
   *    drawer(s) OUT, a POSITIVE 'Manual Debt' debt_ledger row (customer owes
   *    shop), and a DEBT_CASH_OUT unified transaction.
   *
   * The unified transaction amount is always positive/abs for both directions —
   * direction lives in the IN/OUT badge, never the amount sign (matches
   * DEBT_REPAYMENT / CREDIT_CASH_OUT). No profit is stamped (pure liability
   * movement). This is NOT a repayment, so _markSalesPaidFIFO is deliberately
   * NOT called.
   *
   * LIRA-080 — `move_cash` (default true, preserving the above byte-for-byte
   * when the caller omits it): false posts a PAPER entry — the SAME
   * debt_ledger row (CREDIT_DEPOSIT/Manual Debt, same sign), but the wrapping
   * transaction is ACCOUNT_ADJUSTMENT with NO payments row / drawer delta
   * (mirrors PartnerRepository.recordAdjustmentTransaction's PARTNER_ADJUSTMENT
   * — same "visible, no-cash" contract, same signed-amount convention for
   * report-readability since there's no IN/OUT badge to carry direction).
   * `data.payments` is ignored on the paper path — a toggle-off entry never
   * moves cash regardless of what legs the caller supplies.
   *
   * Do NOT fold this into addCredit: that method is a pure ledger write reused
   * by internal change-returned-as-credit callers whose parent transaction
   * already booked the cash — moving the drawer there would double-count.
   */
  addAccountCashEntry(data: {
    direction: "credit" | "debt";
    client_id: number;
    amount_usd: number;
    amount_lbp: number;
    payments?: RepaymentPaymentLine[];
    note?: string | null;
    created_by: number;
    transaction_time?: string;
    move_cash?: boolean;
  }): { id: number } {
    const tenantId = getCurrentTenantId();
    const isCredit = data.direction === "credit";
    const moveCash = data.move_cash !== false;
    const ledgerSign = isCredit ? -1 : 1;
    const drawerSign = isCredit ? 1 : -1;
    const ledgerType = isCredit ? "CREDIT_DEPOSIT" : "Manual Debt";
    const defaultNote = isCredit ? "Account credit" : "Cash advance (debt)";
    return this.transaction(() => {
      const stmt = this.db.prepare(`
        INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by, tenant_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(
        data.client_id,
        ledgerType,
        ledgerSign * Math.abs(data.amount_usd),
        ledgerSign * Math.abs(data.amount_lbp),
        data.note || defaultNote,
        data.created_by,
        tenantId,
        // LIRA-306 FR-021: the event time on an offline replay.
        data.transaction_time ?? requestNow(),
      );
      const ledgerId = Number(result.lastInsertRowid);

      // Default to CASH legs matching the entry PER CURRENCY when none given.
      // A USD-only default would silently skip the LBP drawer movement.
      // Never consulted on the paper (move_cash: false) path.
      const legs: RepaymentPaymentLine[] =
        data.payments && data.payments.length > 0
          ? data.payments
          : [
              ...(Math.abs(data.amount_usd) > 0
                ? [
                    {
                      method: "CASH",
                      currencyCode: "USD",
                      amount: Math.abs(data.amount_usd),
                    },
                  ]
                : []),
              ...(Math.abs(data.amount_lbp) > 0
                ? [
                    {
                      method: "CASH",
                      currencyCode: "LBP",
                      amount: Math.abs(data.amount_lbp),
                    },
                  ]
                : []),
            ];

      const txnId = getTransactionRepository().createTransaction({
        type: moveCash
          ? isCredit
            ? TRANSACTION_TYPES.CREDIT_CASH_IN
            : TRANSACTION_TYPES.DEBT_CASH_OUT
          : TRANSACTION_TYPES.ACCOUNT_ADJUSTMENT,
        source_table: "debt_ledger",
        source_id: ledgerId,
        user_id: data.created_by,
        // Cash-moved: always positive/abs, direction lives in the type.
        // Paper: SIGNED (ledgerSign) so the report stays readable even though
        // there's no IN/OUT badge to carry direction (matches
        // PARTNER_ADJUSTMENT's convention).
        amount_usd: moveCash
          ? Math.abs(data.amount_usd)
          : ledgerSign * Math.abs(data.amount_usd),
        amount_lbp: moveCash
          ? Math.abs(data.amount_lbp)
          : ledgerSign * Math.abs(data.amount_lbp),
        client_id: data.client_id,
        summary: moveCash
          ? isCredit
            ? `Account Credit: $${Math.abs(data.amount_usd)} + ${Math.abs(
                data.amount_lbp,
              )} LBP`
            : `Cash Advance (Debt): $${Math.abs(
                data.amount_usd,
              )} + ${Math.abs(data.amount_lbp)} LBP`
          : isCredit
            ? `Account Credit (paper, no cash moved): $${Math.abs(
                data.amount_usd,
              )} + ${Math.abs(data.amount_lbp)} LBP`
            : `Cash Advance (Debt, paper, no cash moved): $${Math.abs(
                data.amount_usd,
              )} + ${Math.abs(data.amount_lbp)} LBP`,
        metadata_json: {
          legs: moveCash && legs.length > 1 ? legs : undefined,
          paid_by: moveCash
            ? legs.length === 1
              ? legs[0].method
              : "SPLIT"
            : undefined,
          // CQ-8 counterparty contract: "credit" = customer hands the shop
          // cash (IN); "debt" = shop hands the customer a cash advance (OUT).
          // Paper entries keep the same flow direction (no cash moved either
          // way) — method: 'LEDGER' is the documented journal-only marker
          // (no payments leg), same as PARTNER_ADJUSTMENT.
          counterparty: buildCounterpartyMetadata({
            kind: "client",
            id: data.client_id,
            name: this._getClientName(data.client_id),
            flow: isCredit ? "IN" : "OUT",
            method: moveCash
              ? legs.length === 1
                ? legs[0].method
                : "SPLIT"
              : "LEDGER",
            ledgerEntryId: ledgerId,
          }),
        },
        // LIRA-329: the entry kind, the note as typed, and — when cash moved
        // — the legs that move a drawer (exactly the ones booked below).
        details: buildAccountEntryDetails({
          action: moveCash
            ? isCredit
              ? "CREDIT_CASH_IN"
              : "DEBT_CASH_OUT"
            : "ADJUSTMENT",
          note: data.note,
        }),
        payment_snapshot: moveCash
          ? buildPaymentSnapshot({
              // Credit: the customer hands the shop cash; debt: the shop
              // hands the customer a cash advance.
              flow: isCredit ? "IN" : "PAYOUT",
              payments: legs.filter((l) => isDrawerAffectingMethod(l.method)),
            })
          : undefined,
        transaction_time: data.transaction_time,
      });

      this.db
        .prepare(
          `UPDATE debt_ledger SET transaction_id = ? WHERE id = ? AND tenant_id = ?`,
        )
        .run(txnId, ledgerId, tenantId);

      // Paper path: no payments row, no drawer delta — stop here.
      if (!moveCash) {
        return { id: ledgerId };
      }

      const insertPayment = {
        run: (
          transactionId: number,
          method: string,
          drawerName: string,
          currencyCode: string,
          amount: number,
          note: string | null,
          createdBy: number,
          tenant: number,
        ) =>
          insertPaymentRow(this.db, {
            transactionId,
            method,
            drawerName,
            currencyCode,
            amount,
            note,
            createdBy,
            tenantId: tenant,
          }),
      };
      const upsertBalance = {
        run: (
          drawerName: string,
          currencyCode: string,
          delta: number,
          tenant: number,
        ) =>
          applyDrawerDelta(this.db, {
            drawerName,
            currencyCode,
            delta,
            tenantId: tenant,
          }),
      };

      for (const leg of legs) {
        const amt = Math.abs(leg.amount);
        if (amt <= 0 || !isDrawerAffectingMethod(leg.method)) continue;
        const drawer = paymentMethodToDrawerName(leg.method);
        insertPayment.run(
          txnId,
          leg.method,
          drawer,
          leg.currencyCode,
          drawerSign * amt,
          data.note || defaultNote,
          data.created_by,
          tenantId,
        );
        upsertBalance.run(drawer, leg.currencyCode, drawerSign * amt, tenantId);
      }

      return { id: ledgerId };
    });
  }

  /**
   * Get net balance for a client.
   * Positive = client owes shop (debt). Negative = shop owes client (credit).
   */
  getClientBalance(clientId: number): {
    balance_usd: number;
    balance_lbp: number;
  } {
    const stmt = this.db.prepare(`
      SELECT
        ROUND(COALESCE(SUM(amount_usd), 0), 2) as balance_usd,
        ROUND(COALESCE(SUM(amount_lbp), 0), 2) as balance_lbp
      FROM debt_ledger
      WHERE client_id = ? AND tenant_id = ?
    `);
    const result = stmt.get(clientId, getCurrentTenantId()) as
      | { balance_usd: number; balance_lbp: number }
      | undefined;
    return {
      balance_usd: result?.balance_usd ?? 0,
      balance_lbp: result?.balance_lbp ?? 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Bulk Import
  // ---------------------------------------------------------------------------

  /**
   * Insert a raw debt_ledger entry (for Excel import).
   * No drawer logic, no transaction row — just the ledger entry.
   */
  insertRawEntry(data: {
    client_id: number;
    transaction_type: string;
    amount_usd: number;
    amount_lbp: number;
    note: string | null;
    created_by: number;
    created_at?: string;
  }): number {
    // Normalize any ISO caller date ('2024-01-05T00:00:00.000Z') to the
    // CURRENT_TIMESTAMP format ('YYYY-MM-DD HH:MM:SS') — ISO strings sort
    // above every space-format row of the same day (A6). For an already
    // SQLite-format string the SUBSTR+REPLACE is a no-op.
    const stmt = this.db.prepare(`
      INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, note, created_by, tenant_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, REPLACE(SUBSTR(?, 1, 19), 'T', ' '))
    `);
    const result = stmt.run(
      data.client_id,
      data.transaction_type,
      data.amount_usd,
      data.amount_lbp,
      data.note,
      data.created_by,
      getCurrentTenantId(),
      // LIRA-306 FR-021: the event time on an offline replay.
      data.created_at ?? requestNow(),
    );
    return Number(result.lastInsertRowid);
  }

  /**
   * How many identical imported rows already exist — same client, type,
   * amounts, note, and (normalized) date. Used to make the Excel debt import
   * idempotent with MULTISET semantics: a file can legitimately contain N
   * identical entries (e.g. two Alfa cards at 600,000 LBP on the same day),
   * so re-imports must skip exactly as many occurrences as already exist and
   * import any surplus — a boolean exists-check would under-import.
   */
  countIdenticalRawEntries(data: {
    client_id: number;
    transaction_type: string;
    amount_usd: number;
    amount_lbp: number;
    note: string | null;
    created_at?: string;
  }): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as n FROM debt_ledger
          WHERE client_id = ?
            AND transaction_type = ?
            AND amount_usd = ?
            AND amount_lbp = ?
            AND COALESCE(note, '') = COALESCE(?, '')
            AND (? IS NULL OR created_at = REPLACE(SUBSTR(?, 1, 19), 'T', ' '))
            AND tenant_id = ?`,
      )
      .get(
        data.client_id,
        data.transaction_type,
        data.amount_usd,
        data.amount_lbp,
        data.note,
        data.created_at ?? null,
        data.created_at ?? null,
        getCurrentTenantId(),
      ) as { n: number };
    return row.n;
  }

  // ---------------------------------------------------------------------------
  // Dashboard Queries
  // ---------------------------------------------------------------------------

  /**
   * Get debt summary for dashboard (total debt + top debtors)
   */
  getDebtSummary(topN: number = 5): DebtSummary {
    // Total debt receivable
    const rate = this.getExchangeRate("USD", "LBP");
    const tenantId = getCurrentTenantId();

    const totalDebtResult = this.db
      .prepare(
        `
      SELECT
        ROUND(COALESCE(SUM(amount_usd), 0) + (COALESCE(SUM(amount_lbp), 0) / ?), 2) as totalDebt,
        ROUND(COALESCE(SUM(amount_usd), 0), 2) as totalDebtUsd,
        ROUND(COALESCE(SUM(amount_lbp), 0), 2) as totalDebtLbp
      FROM debt_ledger
      WHERE tenant_id = ?
    `,
      )
      .get(rate, tenantId) as {
      totalDebt: number | null;
      totalDebtUsd: number | null;
      totalDebtLbp: number | null;
    };

    // Top N debtors (only those with positive debt)
    const topDebtors = this.db
      .prepare(
        `
      SELECT
        c.full_name,
        ROUND(COALESCE(SUM(dl.amount_usd), 0) + (COALESCE(SUM(dl.amount_lbp), 0) / ?), 2) as total_debt,
        ROUND(COALESCE(SUM(dl.amount_usd), 0), 2) as total_debt_usd,
        ROUND(COALESCE(SUM(dl.amount_lbp), 0), 2) as total_debt_lbp
      FROM debt_ledger dl
      JOIN clients c ON dl.client_id = c.id AND c.tenant_id = dl.tenant_id
      WHERE dl.tenant_id = ?
      GROUP BY dl.client_id
      HAVING total_debt > 0.01
      ORDER BY total_debt DESC
      LIMIT ?
    `,
      )
      .all(rate, tenantId, topN) as TopDebtor[];

    return {
      totalDebt: totalDebtResult?.totalDebt || 0,
      totalDebtUsd: totalDebtResult?.totalDebtUsd || 0,
      totalDebtLbp: totalDebtResult?.totalDebtLbp || 0,
      topDebtors,
    };
  }

  /**
   * Update non-financial metadata on a debt ledger entry.
   * Only metadata fields are allowed — financial data is immutable.
   */
  updateMetadata(
    id: number,
    data: { note?: string },
    editedBy: string,
  ): DebtLedgerEntity | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.note !== undefined) {
      fields.push("note = ?");
      values.push(data.note);
    }

    if (fields.length === 0) return existing;

    fields.push("edited_by = ?", "edited_at = CURRENT_TIMESTAMP");
    values.push(editedBy);
    values.push(id);
    values.push(getCurrentTenantId());

    this.db
      .prepare(
        `UPDATE debt_ledger SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`,
      )
      .run(...values);

    return this.findById(id);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let debtRepositoryInstance: DebtRepository | null = null;

export function getDebtRepository(): DebtRepository {
  if (!debtRepositoryInstance) {
    debtRepositoryInstance = new DebtRepository();
  }
  return debtRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetDebtRepository(): void {
  debtRepositoryInstance = null;
}
