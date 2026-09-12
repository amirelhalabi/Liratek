import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import {
  isDrawerAffectingMethod,
  paymentMethodToDrawerName,
} from "../utils/payments.js";
import { maintenanceLogger } from "../utils/logger.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import {
  applyDrawerDelta,
  insertPaymentRow,
  bookClientDebtCharge,
} from "./moneyPosting.js";
import { BusinessRuleError } from "../utils/errors.js";
import { getStockBatchRepository } from "./StockBatchRepository.js";
import {
  restoreMaintenanceJobParts,
  recomputeMaintenancePartsTotals,
} from "./maintenancePartsStock.js";

/**
 * note 14 — caps an appended free-text detail (e.g. issue_description) so a
 * long note doesn't blow up the transactions summary column. Truncates on a
 * character boundary with an ellipsis; never throws on empty/short input.
 */
function truncateSummaryDetail(text: string, maxLength = 60): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * Whether a maintenance job has an ACTIVE unified transaction row for its
 * `source_id` (cash, debt, or session-linked). getBySourceId returns only
 * ACTIVE transactions, filtered by `status='ACTIVE'` with no `reverses_id`
 * filter and `ORDER BY id DESC LIMIT 1` — so this returns `true` in ALL of
 * these cases, not just "untouched, paid":
 *   - paid, never reversed: the original row itself is the match.
 *   - paid, then VOIDED: the original flips to VOIDED, but voidTransaction
 *     also inserts a reversal row with the SAME source_id and a permanent
 *     `status='ACTIVE'` (it can never itself be voided/refunded again) — that
 *     row is the match instead.
 *   - paid, then REFUNDED: refundTransaction never flips the original's
 *     status at all — it stays ACTIVE forever — and the new REFUND row is
 *     also ACTIVE with the same source_id.
 * In other words: once a job has ever had one transaction, this predicate can
 * never go back to `false` on its own. Callers that need "is this job STILL
 * locked as live money history" (as opposed to "has it ever had money
 * history") must additionally check `!is_refunded` — see
 * `isJobMoneyLocked` below, the actual gate predicate.
 */
function jobHasActiveTransaction(id: number): boolean {
  return getTransactionRepository().getBySourceId("maintenance", id) !== null;
}

/**
 * The ONE shared "is this job still locked as live money history" predicate
 * (CLAUDE.md rule 14) — used by BOTH the post-payment amount-edit gate
 * (`updateJob`) and the paid-job delete-block (`deleteJob`). A job is locked
 * only while it has an ACTIVE-and-unreversed transaction: `is_refunded` is
 * the tie-breaker `jobHasActiveTransaction` alone can't provide (see its doc
 * comment above). Once refunded/voided, the transaction/payment/profit rows
 * are frozen on `transactions` and never re-read from `maintenance`
 * (processPayments stamps them once, at checkout), so editing or deleting the
 * job afterward cannot desync anything — refund/void IS the unlock
 * (docs/FEATURE_GUIDE.md §9: "a paid job's delete is blocked — go through
 * refund/void"), not a second lock.
 *
 * `existing` must be the job row already fetched by the caller (avoids a
 * second `findById` round-trip); `null` (job not found) is never locked.
 *
 * MUST mirror the frontend's own signal in
 * frontend/src/features/maintenance/pages/Maintenance/index.tsx
 * (`isAmountLocked`) — if this predicate changes, that one must change too.
 */
function isJobMoneyLocked(
  existing: MaintenanceRow | null,
  id: number,
): boolean {
  return (
    existing != null && !existing.is_refunded && jobHasActiveTransaction(id)
  );
}

/**
 * Amount-bearing columns on a maintenance job. While a job has an
 * ACTIVE-and-unreversed unified transaction, none of these may change
 * in-place — the transaction row, drawer postings, and any frozen
 * daily-closing snapshot are never re-stamped, so an in-place amount edit
 * would silently desync revenue/cost (live on `maintenance`) from profit
 * (frozen on `transactions`). Correction goes through refund/void first
 * (owner decision) — once refunded/voided, editing the SAME job is safe
 * again (see `isJobMoneyLocked`'s doc comment), no re-creation required.
 *
 * `parts_cost_usd` / `parts_price_usd` (LIRA-176 phase 3) are included here
 * too, so the existing post-payment lock covers parts for free — no new
 * predicate needed. The actual line-level parts mutation path (`syncParts`)
 * has its own, separate lock check (see `MAINTENANCE_PARTS_EDIT_BLOCKED_ERROR`)
 * since it never goes through `updateJob`.
 */
const MAINTENANCE_AMOUNT_FIELDS = [
  "cost_usd",
  "price_usd",
  "cost_lbp",
  "price_lbp",
  "discount_usd",
  "final_amount_usd",
  "final_amount_lbp",
  "paid_usd",
  "paid_lbp",
  "parts_cost_usd",
  "parts_price_usd",
] as const satisfies ReadonlyArray<keyof MaintenanceJob & keyof MaintenanceRow>;

export const MAINTENANCE_AMOUNT_EDIT_BLOCKED_ERROR =
  "Cannot change the amount of a paid maintenance job while its transaction is still active — void or refund it first.";

export const MAINTENANCE_PARTS_EDIT_BLOCKED_ERROR =
  "Cannot change the parts of a paid maintenance job while its transaction is still active — void or refund it first.";

/**
 * Floor for float-noise between a resubmitted amount and the stored value.
 * The UI resubmits the whole form on every status change, so equal-value
 * resubmits (the common case) must NOT be rejected — only an actual change.
 */
const AMOUNT_EPSILON = 1e-6;

export interface MaintenancePaymentLine {
  method: string;
  currency_code: string;
  amount: number;
}

export interface MaintenanceJob {
  id?: number;
  client_id?: number | null;
  client_name?: string | null;
  device_name: string;
  issue_description?: string | null;
  cost_usd?: number;
  price_usd?: number;
  cost_lbp?: number;
  price_lbp?: number;
  discount_usd?: number;
  final_amount_usd?: number;
  final_amount_lbp?: number;
  /** Job pricing currency: "USD" or "LBP". Defaults to "USD". */
  currency?: string;
  paid_usd?: number;
  paid_lbp?: number;
  exchange_rate?: number;
  status?: string;
  paid_by?: string;
  note?: string | null;
  created_at?: string;
  updated_at?: string;
  transaction_time?: string;
  /** Denormalised sums over this job's `maintenance_parts` rows — always
   *  USD (products only carry USD cost/selling prices). Maintained by
   *  `syncParts` / `restoreMaintenanceJobParts`; never set directly by a
   *  caller except as a passthrough of the stored value. */
  parts_cost_usd?: number;
  parts_price_usd?: number;
}

export interface MaintenanceRow {
  id: number;
  client_id: number | null;
  client_name: string | null;
  device_name: string;
  issue_description: string | null;
  cost_usd: number;
  price_usd: number;
  cost_lbp: number;
  price_lbp: number;
  discount_usd: number;
  final_amount_usd: number;
  final_amount_lbp: number;
  currency: string;
  paid_usd: number;
  paid_lbp: number;
  exchange_rate: number;
  status: string;
  paid_by: string;
  note: string | null;
  created_at: string;
  updated_at: string;
  edited_by: string | null;
  edited_at: string | null;
  /** Set by TransactionRepository._markSourceRefunded on refund/void
   *  (migration v68). Drives the jobs-list and HistoryModal "Refunded"
   *  badges — dormant until getColumns() below carried it (note 21d
   *  follow-up). */
  is_refunded: number;
  refunded_at: string | null;
  parts_cost_usd: number;
  parts_price_usd: number;
}

export interface MaintenancePartInput {
  /** Present when editing an existing line; absent for a newly added one. */
  id?: number;
  product_id: number;
  quantity: number;
  /** Omitted -> the product's current selling_price_usd. */
  unit_price_usd?: number;
}

export interface MaintenancePartRow {
  id: number;
  maintenance_id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_cost_usd: number;
  unit_price_usd: number;
  stock_restored: number;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceStatusHistoryRow {
  id: number;
  maintenance_id: number;
  from_status: string | null;
  to_status: string;
  changed_by: number | null;
  note: string | null;
  created_at: string;
}

export class MaintenanceRepository extends BaseRepository<MaintenanceRow> {
  constructor() {
    super("maintenance");
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return "id, client_id, client_name, device_name, issue_description, cost_usd, price_usd, cost_lbp, price_lbp, discount_usd, final_amount_usd, final_amount_lbp, currency, paid_usd, paid_lbp, exchange_rate, status, paid_by, note, created_at, updated_at, edited_by, edited_at, is_refunded, refunded_at, parts_cost_usd, parts_price_usd";
  }

  /**
   * Create a new maintenance job
   */
  createJob(job: MaintenanceJob): number {
    const tenantId = getCurrentTenantId();
    // "In Progress" (with a space) was never a valid status — the real enum
    // value is `In_Progress`, so this literal could never match a status tab
    // and jobs silently fell into an unfilterable state. "Received" mirrors
    // the validator's own default.
    const status = job.status ?? "Received";
    const stmt = this.db.prepare(`
      INSERT INTO maintenance (
        tenant_id, client_id, client_name, device_name, issue_description,
        cost_usd, price_usd, cost_lbp, price_lbp,
        discount_usd, final_amount_usd, final_amount_lbp, currency,
        paid_usd, paid_lbp, exchange_rate, status, paid_by, note, created_at,
        parts_cost_usd, parts_price_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?)
    `);
    const result = stmt.run(
      tenantId,
      job.client_id ?? null,
      job.client_name ?? null,
      job.device_name,
      job.issue_description ?? null,
      job.cost_usd ?? 0,
      job.price_usd ?? 0,
      job.cost_lbp ?? 0,
      job.price_lbp ?? 0,
      job.discount_usd ?? 0,
      job.final_amount_usd ?? 0,
      job.final_amount_lbp ?? 0,
      job.currency ?? "USD",
      job.paid_usd ?? 0,
      job.paid_lbp ?? 0,
      job.exchange_rate ?? 0,
      status,
      job.paid_by ?? "CASH",
      job.note ?? null,
      job.transaction_time ?? null,
      job.parts_cost_usd ?? 0,
      job.parts_price_usd ?? 0,
    );
    const jobId = Number(result.lastInsertRowid);

    // First status-history row for the job (from_status NULL — this is the
    // job's creation, not a transition).
    this.recordStatusChange(jobId, null, status);

    return jobId;
  }

  /**
   * Update an existing maintenance job
   */
  updateJob(id: number, job: MaintenanceJob): void {
    // A job with a STILL-ACTIVE-and-unreversed transaction is live money
    // history — its amount fields are immutable while that's true. Once the
    // job has been refunded/voided (`is_refunded`), the historical
    // transaction/payment/profit rows are frozen on the `transactions` table
    // and never re-read from `maintenance` (processPayments stamps them once,
    // at checkout), so an amount edit afterward cannot desync anything —
    // refund/void IS the unlock (docs/FEATURE_GUIDE.md §9: "a paid job's
    // delete is blocked — go through refund/void"), not a second lock. Only
    // reject when an amount would ACTUALLY change while still locked; status,
    // notes, device/issue, client, and paid_by must keep flowing (that's the
    // normal lifecycle, including resubmits of the unchanged form on a status
    // transition).
    //
    // MUST mirror the frontend's own signal in
    // frontend/src/features/maintenance/pages/Maintenance/index.tsx
    // (`isAmountLocked`) — if this predicate changes, that one must change
    // too (CLAUDE.md rule 14: one signal, not two).
    const existing = this.findById(id);
    if (existing && isJobMoneyLocked(existing, id)) {
      for (const field of MAINTENANCE_AMOUNT_FIELDS) {
        const incoming = job[field] ?? 0;
        const stored = existing[field];
        if (Math.abs(incoming - stored) > AMOUNT_EPSILON) {
          throw new Error(MAINTENANCE_AMOUNT_EDIT_BLOCKED_ERROR);
        }
      }
    }

    // Same "In Progress" (space) bug as createJob — never a valid status;
    // "Received" is the validator's own default.
    const status = job.status ?? "Received";
    const tenantId = getCurrentTenantId();

    const stmt = this.db.prepare(`
      UPDATE maintenance SET
        client_id = ?, client_name = ?, device_name = ?, issue_description = ?,
        cost_usd = ?, price_usd = ?, cost_lbp = ?, price_lbp = ?,
        discount_usd = ?, final_amount_usd = ?, final_amount_lbp = ?, currency = ?,
        paid_usd = ?, paid_lbp = ?, exchange_rate = ?, status = ?, paid_by = ?, note = ?,
        parts_cost_usd = ?, parts_price_usd = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `);
    stmt.run(
      job.client_id ?? null,
      job.client_name ?? null,
      job.device_name,
      job.issue_description ?? null,
      job.cost_usd ?? 0,
      job.price_usd ?? 0,
      job.cost_lbp ?? 0,
      job.price_lbp ?? 0,
      job.discount_usd ?? 0,
      job.final_amount_usd ?? 0,
      job.final_amount_lbp ?? 0,
      job.currency ?? "USD",
      job.paid_usd ?? 0,
      job.paid_lbp ?? 0,
      job.exchange_rate ?? 0,
      status,
      job.paid_by ?? "CASH",
      job.note ?? null,
      job.parts_cost_usd ?? existing?.parts_cost_usd ?? 0,
      job.parts_price_usd ?? existing?.parts_price_usd ?? 0,
      id,
      tenantId,
    );

    // Status-history row only when the status actually changed — a
    // same-status resubmit (the UI resends the whole form on every save)
    // must not spam the history.
    if (existing && existing.status !== status) {
      this.recordStatusChange(id, existing.status, status);
    }
  }

  /**
   * Get jobs by status filter
   */
  getJobs(statusFilter?: string): MaintenanceRow[] {
    if (statusFilter && statusFilter !== "All") {
      const stmt = this.db.prepare(
        `SELECT ${this.getColumns()} FROM maintenance WHERE status = ? AND tenant_id = ? ORDER BY created_at DESC`,
      );
      return stmt.all(statusFilter, getCurrentTenantId()) as MaintenanceRow[];
    }
    const stmt = this.db.prepare(
      `SELECT ${this.getColumns()} FROM maintenance WHERE status NOT IN ('Voided', 'Deleted') AND tenant_id = ? ORDER BY created_at DESC`,
    );
    return stmt.all(getCurrentTenantId()) as MaintenanceRow[];
  }

  /**
   * Check if payments already exist for a maintenance job
   */
  hasPayments(jobId: number): boolean {
    const tenantId = getCurrentTenantId();
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as cnt FROM payments WHERE transaction_id IN (SELECT id FROM transactions WHERE source_table = 'maintenance' AND source_id = ? AND tenant_id = ?) AND tenant_id = ?`,
      )
      .get(jobId, tenantId, tenantId) as { cnt: number };
    return row.cnt > 0;
  }

  /**
   * Process split-method payments for a maintenance job.
   * Mirrors the SalesRepository pattern: inserts payment rows,
   * updates drawer_balances, and creates debt if applicable.
   */
  processPayments(
    jobId: number,
    paymentLines: MaintenancePaymentLine[],
    opts: {
      /** Job pricing currency: "USD" or "LBP". Defaults to "USD". */
      currency?: string;
      /** LABOUR-only final amount due, expressed in the job's currency.
       *  Parts are billed separately — see partsPriceUsd. */
      finalAmount: number;
      /** LABOUR-only margin, expressed in the job's currency. */
      profit?: number;
      /** Parts price — ALWAYS USD (products only carry cost_price_usd /
       *  selling_price_usd; nothing here is ever converted). Defaults to 0
       *  for a job with no attached parts. */
      partsPriceUsd?: number;
      /** Parts margin (price - cost) — ALWAYS USD. Defaults to 0. */
      partsMarginUsd?: number;
      exchangeRate: number;
      clientId: number | null;
      changeUsd?: number;
      changeLbp?: number;
      /** T3 keep-change (KC-3): kept change per currency → profit stamp. */
      keptChangeUsd?: number;
      keptChangeLbp?: number;
      note?: string | null;
      /**
       * Session-basket deferred payment mode. When true, the unified transaction
       * row is still created (so it can be linked + paid-state back-filled by the
       * basket recorder) but the customer-cash drawer posting, change, and debt
       * are skipped — the basket recorder owns those.
       */
      defer?: boolean;
      /** note 14 — thin-summary enrichment: the job's device/issue, appended
       *  after the existing "Maintenance Job #N: $X" prefix so prefix-matching
       *  tests/e2e specs stay intact. */
      deviceName?: string | null;
      issueDescription?: string | null;
      /** PRICE-ONLY parts snapshot for the customer-facing receipt metadata
       *  — never cost or margin (the receipt must never leak the shop's
       *  cost). */
      parts?: { name: string; quantity: number; unit_price_usd: number }[];
    },
  ): void {
    const createdBy = this.resolveFallbackUserId();
    const tenantId = getCurrentTenantId();
    const defer = opts.defer === true;
    const isLbp = opts.currency === "LBP";
    const profit = opts.profit ?? 0;
    const partsPriceUsd = opts.partsPriceUsd ?? 0;
    const partsMarginUsd = opts.partsMarginUsd ?? 0;

    // Summary line. Existing specs match on the "Maintenance Job #" prefix —
    // keep that. A USD job folds parts straight into the "$" figure (both
    // sides are already USD); an LBP job keeps its "N LBP" figure unchanged
    // when there are no parts (byte-identical to before parts existed) and
    // appends "+ $M" only when parts are actually attached — this is the
    // first maintenance transaction whose summary/amounts can span both
    // currencies at once.
    // Rounded for DISPLAY ONLY — floating-point addition of two independent
    // USD figures (labour + parts) can render as "$50.00000000000001" on a
    // customer-visible summary; no stored/stamped amount is touched here.
    const displayUsdTotal =
      Math.round((opts.finalAmount + partsPriceUsd) * 100) / 100;
    const displayPartsUsd = Math.round(partsPriceUsd * 100) / 100;
    const displayLbpTotal = Math.round(opts.finalAmount);
    const prefix = isLbp
      ? partsPriceUsd > 0
        ? `Maintenance Job #${jobId}: ${displayLbpTotal.toLocaleString()} LBP + $${displayPartsUsd}`
        : `Maintenance Job #${jobId}: ${displayLbpTotal.toLocaleString()} LBP`
      : `Maintenance Job #${jobId}: $${displayUsdTotal}`;
    const deviceLabel = opts.deviceName?.trim()
      ? ` — ${opts.deviceName.trim()}`
      : "";
    const issueLabel = opts.issueDescription?.trim()
      ? ` — ${truncateSummaryDetail(opts.issueDescription.trim())}`
      : "";
    const summary = `${prefix}${deviceLabel}${issueLabel}`;

    // Create unified transaction row.
    //
    // Governing rule (owner decision 2026-09-07, "option 4"): parts are
    // ALWAYS USD (products only carry cost_price_usd / selling_price_usd;
    // nothing is ever converted), while labour keeps its existing
    // job-currency columns and meaning. `final_amount_<currency>` on the
    // unified transaction means "what the customer owes in that currency",
    // and — for the first time for a maintenance job — BOTH currency sides
    // may now be non-zero at once (an LBP-priced job with USD parts).
    const txnId = getTransactionRepository().createTransaction({
      type: TRANSACTION_TYPES.MAINTENANCE,
      source_table: "maintenance",
      source_id: jobId,
      user_id: createdBy,
      amount_usd: partsPriceUsd + (isLbp ? 0 : opts.finalAmount),
      amount_lbp: isLbp ? opts.finalAmount : 0,
      // Margin: parts margin (always USD) + labour margin (job currency) +
      // kept change per its own currency (T3).
      profit_usd:
        partsMarginUsd + (isLbp ? 0 : profit) + (opts.keptChangeUsd ?? 0),
      profit_lbp: (isLbp ? profit : 0) + (opts.keptChangeLbp ?? 0),
      client_id: opts.clientId ?? null,
      exchange_rate: opts.exchangeRate,
      summary,
      metadata_json: {
        // Labour-only — unaffected for jobs with no parts (pre-existing
        // meaning preserved). The receipt combines this with
        // parts_price_usd/parts for the customer-facing total.
        final_amount: opts.finalAmount,
        currency: opts.currency ?? "USD",
        payment_count: paymentLines.length,
        parts_price_usd: partsPriceUsd,
        // PRICE only — never cost/margin; the receipt is built from this
        // metadata and must never leak the shop's cost.
        parts: (opts.parts ?? []).map((p) => ({
          name: p.name,
          quantity: p.quantity,
          unit_price_usd: p.unit_price_usd,
        })),
      },
    });

    // Clear any old payment rows for this job (idempotent)
    this.db
      .prepare(
        `DELETE FROM payments WHERE transaction_id IN (SELECT id FROM transactions WHERE source_table = 'maintenance' AND source_id = ? AND tenant_id = ?) AND tenant_id = ?`,
      )
      .run(jobId, tenantId, tenantId);

    const insertPayment = {
      run: (
        tenant: number,
        transactionId: number,
        method: string,
        drawerName: string,
        currencyCode: string,
        amount: number,
        note: string | null,
        createdByUser: number,
      ) =>
        insertPaymentRow(this.db, {
          transactionId,
          method,
          drawerName,
          currencyCode,
          amount,
          note,
          createdBy: createdByUser,
          tenantId: tenant,
        }),
    };

    const upsertBalanceDelta = {
      run: (
        tenant: number,
        drawerName: string,
        currencyCode: string,
        delta: number,
      ) =>
        applyDrawerDelta(this.db, {
          drawerName,
          currencyCode,
          delta,
          tenantId: tenant,
        }),
    };

    // Insert each drawer-affecting payment line.
    // Deferred (session basket): the basket recorder owns the customer-cash legs,
    // change, and debt — skip them all here (the unified transaction row above is
    // still created so it can be linked + paid-state back-filled).
    if (!defer) {
      for (const p of paymentLines) {
        if (!isDrawerAffectingMethod(p.method)) continue;
        const drawerName = paymentMethodToDrawerName(p.method);
        insertPayment.run(
          tenantId,
          txnId,
          p.method,
          drawerName,
          p.currency_code,
          p.amount,
          opts.note ?? null,
          createdBy,
        );
        upsertBalanceDelta.run(tenantId, drawerName, p.currency_code, p.amount);
      }
    }

    if (defer) {
      // Basket owns customer cash; nothing more to post on this transaction.
      return;
    }

    // Handle change given (negative outflow from General drawer)
    const changeUsd = Math.abs(opts.changeUsd || 0);
    const changeLbp = Math.abs(opts.changeLbp || 0);
    if (changeUsd) {
      insertPayment.run(
        tenantId,
        txnId,
        "CASH",
        "General",
        "USD",
        -changeUsd,
        "Change given",
        createdBy,
      );
      upsertBalanceDelta.run(tenantId, "General", "USD", -changeUsd);
    }
    if (changeLbp) {
      insertPayment.run(
        tenantId,
        txnId,
        "CASH",
        "General",
        "LBP",
        -changeLbp,
        "Change given",
        createdBy,
      );
      upsertBalanceDelta.run(tenantId, "General", "LBP", -changeLbp);
    }

    // Handle debt (partial payment)
    // Sum drawer-affecting USD and LBP payments
    let paidUsd = 0;
    let paidLbp = 0;
    for (const p of paymentLines) {
      if (!isDrawerAffectingMethod(p.method)) continue;
      if (p.currency_code === "USD") paidUsd += p.amount;
      else if (p.currency_code === "LBP") paidLbp += p.amount;
    }
    const rate = opts.exchangeRate || 1;

    // USD-equivalent residual — algebraically identical to the old
    // job-currency-only computation when there are no parts (partsPriceUsd
    // === 0 folds out of owedUsdEquiv, leaving exactly the old formula).
    // Parts are always USD, so they can only be added in USD-equivalent
    // terms; labour is converted at the job's own exchange rate the same
    // way the old formula did.
    const owedUsdEquiv =
      partsPriceUsd + (isLbp ? opts.finalAmount / rate : opts.finalAmount);
    const paidUsdEquiv = paidUsd + paidLbp / rate;
    const residualUsd = owedUsdEquiv - paidUsdEquiv;
    // Threshold check in USD-equivalent (~5 cents) to ignore rounding dust.
    const debtUsdEquiv = residualUsd;

    if (debtUsdEquiv > 0.05) {
      if (!opts.clientId) {
        throw new Error("Cannot create debt for anonymous client");
      }
      // Book in the job's currency (parts' USD residual folded in via the
      // exchange rate for an LBP job) — same currency split the old
      // job-currency-only debt used.
      const debtAmount = isLbp ? residualUsd * rate : residualUsd;
      // createdBy stays null: the original hand-rolled INSERT here never
      // included that column (see moneyPosting.ts's bookClientDebtCharge doc).
      // Transaction type stays exactly "Maintenance Debt" — a new charge
      // type would need a new reversal owner (CLAUDE.md rule 20) and there
      // must not be one; parts residual rides the SAME charge type as
      // labour residual.
      bookClientDebtCharge(this.db, {
        clientId: opts.clientId,
        transactionType: "Maintenance Debt",
        amountUsd: isLbp ? 0 : residualUsd,
        amountLbp: isLbp ? debtAmount : 0,
        transactionId: txnId,
        note: "Balance from Maintenance",
        createdBy: null,
        tenantId,
      });
      maintenanceLogger.info(
        { jobId, clientId: opts.clientId, debtAmount, currency: opts.currency },
        `Debt created for maintenance job #${jobId}: ${debtAmount} ${opts.currency ?? "USD"}`,
      );
    }
  }

  /**
   * Delete a job by ID and void its transaction
   */
  deleteJob(id: number): void {
    // A job with a STILL-ACTIVE-and-unreversed transaction is money history
    // (cash, debt, or a session-linked entry) — it must be refunded/voided
    // explicitly, never deleted. Once refunded/voided (`is_refunded`), the
    // same reasoning as updateJob's amount-edit gate applies: refund/void is
    // the unlock, so deletion is allowed again. Deleting an unpaid (or
    // already-reversed) job is a PURE status change: no transaction voiding,
    // no reversal rows (owner feedback 2026-07-03 — the old path voided the
    // txn and emitted a confusing −amount reversal).
    const existing = this.findById(id);
    if (isJobMoneyLocked(existing, id)) {
      throw new Error(
        "This job has recorded payments — refund or void it instead of deleting.",
      );
    }
    // The money-lock check above already ran and passed (a paid job is still
    // refused), so this is always an unpaid (or already-reversed) job —
    // safe to put its parts back on the shelf before the status flips to
    // 'Deleted'.
    restoreMaintenanceJobParts(this.db, {
      maintenanceId: id,
      tenantId: getCurrentTenantId(),
    });
    this.db
      .prepare(
        "UPDATE maintenance SET status = 'Deleted' WHERE id = ? AND tenant_id = ?",
      )
      .run(id, getCurrentTenantId());
  }

  /**
   * All parts attached to one job, ordered by id (insertion order).
   */
  getParts(jobId: number): MaintenancePartRow[] {
    const tenantId = getCurrentTenantId();
    return this.db
      .prepare(
        `SELECT id, maintenance_id, product_id, product_name, quantity, unit_cost_usd, unit_price_usd,
                stock_restored, created_at, updated_at
         FROM maintenance_parts
         WHERE maintenance_id = ? AND tenant_id = ?
         ORDER BY id ASC`,
      )
      .all(jobId, tenantId) as MaintenancePartRow[];
  }

  /**
   * Parts for many jobs in ONE query (no N+1 for a jobs-list view) — a
   * parameterised `IN (...)` list built from placeholders, grouped in
   * memory by `maintenance_id`. Returns an empty Map without touching the
   * DB for an empty input array.
   */
  getPartsForJobs(jobIds: number[]): Map<number, MaintenancePartRow[]> {
    const result = new Map<number, MaintenancePartRow[]>();
    if (jobIds.length === 0) return result;

    const tenantId = getCurrentTenantId();
    const placeholders = jobIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT id, maintenance_id, product_id, product_name, quantity, unit_cost_usd, unit_price_usd,
                stock_restored, created_at, updated_at
         FROM maintenance_parts
         WHERE maintenance_id IN (${placeholders}) AND tenant_id = ?
         ORDER BY id ASC`,
      )
      .all(...jobIds, tenantId) as MaintenancePartRow[];

    for (const row of rows) {
      const existing = result.get(row.maintenance_id);
      if (existing) existing.push(row);
      else result.set(row.maintenance_id, [row]);
    }
    return result;
  }

  /**
   * Full status transition history for one job, chronological (oldest
   * first).
   */
  getStatusHistory(jobId: number): MaintenanceStatusHistoryRow[] {
    const tenantId = getCurrentTenantId();
    return this.db
      .prepare(
        `SELECT id, maintenance_id, from_status, to_status, changed_by, note, created_at
         FROM maintenance_status_history
         WHERE maintenance_id = ? AND tenant_id = ?
         ORDER BY id ASC`,
      )
      .all(jobId, tenantId) as MaintenanceStatusHistoryRow[];
  }

  /**
   * Append one status-transition row. `fromStatus` is NULL for a job's very
   * first row (its creation, not a transition).
   */
  recordStatusChange(
    jobId: number,
    fromStatus: string | null,
    toStatus: string,
    userId?: number | null,
    note?: string | null,
  ): void {
    const tenantId = getCurrentTenantId();
    this.db
      .prepare(
        `INSERT INTO maintenance_status_history
           (tenant_id, maintenance_id, from_status, to_status, changed_by, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .run(tenantId, jobId, fromStatus, toStatus, userId ?? null, note ?? null);
  }

  /**
   * Reconcile a job's attached parts against an incoming array — the SINGLE
   * mutation entry point for `maintenance_parts` (draw/return stock, keep the
   * FIFO batch ledger and the job's denormalised parts_cost_usd/
   * parts_price_usd in step).
   *
   * `parts === undefined` means "leave the parts list untouched" and returns
   * immediately WITHOUT touching the DB. This is load-bearing: the job form
   * resubmits the WHOLE job on every status transition without a `parts`
   * key, so treating a missing key as "delete all" would silently wipe a
   * job's parts and leak stock back on every unrelated save. Only an
   * explicit array (including an explicit `[]`, which removes every line)
   * reconciles. Never add a default value anywhere that defeats this.
   */
  syncParts(
    jobId: number,
    parts: MaintenancePartInput[] | undefined,
    opts?: { allowOutOfStock?: boolean },
  ): void {
    if (parts === undefined) return;

    const tenantId = getCurrentTenantId();
    const allowOutOfStock = opts?.allowOutOfStock === true;

    const existingJob = this.findById(jobId);
    if (isJobMoneyLocked(existingJob, jobId)) {
      throw new Error(MAINTENANCE_PARTS_EDIT_BLOCKED_ERROR);
    }

    const storedRows = this.getParts(jobId);
    const storedById = new Map(storedRows.map((r) => [r.id, r]));
    const incomingIds = new Set(
      parts.filter((p) => p.id != null).map((p) => p.id as number),
    );

    // Draw `qty` MORE units for an ALREADY-EXISTING part line (the
    // quantity-increase branch below). Guards stock the same shape as
    // CustomServiceRepository's draw, then keeps the FIFO batch ledger in
    // step via `consume()` (linked to the existing `partId`) so
    // `stock_batch_consumptions`/`product_stock_batches` stay in sync with
    // `products.stock_quantity`. Per the brief, `unit_cost_usd` is an
    // attach-time snapshot and is deliberately NOT touched here — the
    // resolved FIFO cost of this extra draw is discarded, same as a custom
    // service's non-cost-bearing consume call.
    const drawMoreStock = (
      productId: number,
      partId: number,
      qty: number,
    ): void => {
      const product = this.db
        .prepare(
          `SELECT name, cost_price_usd, stock_quantity
           FROM products WHERE id = ? AND tenant_id = ?`,
        )
        .get(productId, tenantId) as
        | { name?: string; cost_price_usd?: number; stock_quantity?: number }
        | undefined;

      const stockStmt = this.db.prepare(
        allowOutOfStock
          ? `UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND tenant_id = ?`
          : `UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND tenant_id = ? AND stock_quantity >= ?`,
      );
      const stockRes = allowOutOfStock
        ? stockStmt.run(qty, productId, tenantId)
        : stockStmt.run(qty, productId, tenantId, qty);
      if (!allowOutOfStock && stockRes.changes === 0) {
        throw new BusinessRuleError(
          `Not enough stock for "${product?.name ?? `product #${productId}`}" (${product?.stock_quantity ?? 0} available)`,
        );
      }

      getStockBatchRepository().consume(productId, qty, {
        reason: "SERVICE",
        fallbackUnitCostUsd: product?.cost_price_usd ?? 0,
        maintenancePartId: partId,
      });
    };

    // Stock movement is driven PER ROW by `stock_restored`, not just by the
    // reconciliation branch:
    //   - `stock_restored = 0` — the row holds a live claim of `quantity`
    //     units. Deltas (draw more / return some / return all-then-delete)
    //     apply exactly as written below.
    //   - `stock_restored = 1` — a job-level restore (refund/void/delete)
    //     already put this row's units back on the shelf and marked it
    //     historical. It holds NO stock claim any more, so NO edit to it —
    //     removing it, shrinking it, or growing it — may move stock in
    //     EITHER direction. Editing such a row is a bookkeeping correction
    //     (fixing the historical record), never a stock movement. Without
    //     this guard, removing/shrinking an already-restored row would
    //     double-return units that were already returned (products.stock_
    //     quantity drifts above what the FIFO ledger says is real), and
    //     growing one would silently re-consume stock against a transaction
    //     that is already reversed.
    // A NEWLY ADDED line on a refunded job is NOT covered by this guard —
    // it has no stored row (so it goes through the "insert new" branch
    // below), starts at `stock_restored = 0`, and DOES draw stock, correctly
    // — it is a genuinely new consumption, not an edit to a reversed one.
    // Do not "simplify" this away.

    // 1. Stored rows absent from the incoming array — restore full quantity
    // and delete the row.
    for (const stored of storedRows) {
      if (!incomingIds.has(stored.id)) {
        // Idempotent regardless of stock_restored (see StockBatchRepository
        // — it only touches not-yet-restored consumption rows), so it's
        // always safe to call.
        getStockBatchRepository().restoreForMaintenancePart(stored.id);
        if (stored.stock_restored === 0) {
          this.db
            .prepare(
              `UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ? AND tenant_id = ?`,
            )
            .run(stored.quantity, stored.product_id, tenantId);
        }
        this.db
          .prepare(
            `DELETE FROM maintenance_parts WHERE id = ? AND tenant_id = ?`,
          )
          .run(stored.id, tenantId);
      }
    }

    // 2. Incoming lines: update-in-place (matched by id) or insert new.
    for (const input of parts) {
      const stored = input.id != null ? storedById.get(input.id) : undefined;

      if (stored) {
        const delta = input.quantity - stored.quantity;
        if (stored.stock_restored === 1) {
          // Already-restored row: no stock movement in either direction —
          // see the guard comment above. Quantity/price still update below
          // (bookkeeping correction on the historical record).
        } else if (delta > 0) {
          drawMoreStock(stored.product_id, stored.id, delta);
        } else if (delta < 0) {
          // Partial, in-life restore — the row survives with a smaller
          // quantity, so `stock_restored` must NOT be touched here (that
          // flag means "this row's stock has been fully returned", the
          // job-level restore/delete/void/refund path's guard). Only the
          // job-level `restoreMaintenanceJobParts` sets it.
          this.db
            .prepare(
              `UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ? AND tenant_id = ?`,
            )
            .run(-delta, stored.product_id, tenantId);
          getStockBatchRepository().restoreForMaintenancePart(
            stored.id,
            -delta,
          );
        }
        this.db
          .prepare(
            `UPDATE maintenance_parts
             SET quantity = ?, unit_price_usd = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND tenant_id = ?`,
          )
          .run(
            input.quantity,
            input.unit_price_usd ?? stored.unit_price_usd,
            stored.id,
            tenantId,
          );
      } else {
        const product = this.db
          .prepare(
            `SELECT name, cost_price_usd, selling_price_usd, stock_quantity
             FROM products WHERE id = ? AND tenant_id = ?`,
          )
          .get(input.product_id, tenantId) as
          | {
              name?: string;
              cost_price_usd?: number;
              selling_price_usd?: number;
              stock_quantity?: number;
            }
          | undefined;

        // Insert first with a provisional cost (product's current
        // cost_price_usd) — `consume()` needs the part row's id
        // (`maintenancePartId`) to attribute the FIFO consumption, so the
        // row must exist before we can resolve the true weighted cost.
        const insertResult = this.db
          .prepare(
            `INSERT INTO maintenance_parts
               (tenant_id, maintenance_id, product_id, product_name, quantity,
                unit_cost_usd, unit_price_usd, stock_restored, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          )
          .run(
            tenantId,
            jobId,
            input.product_id,
            product?.name ?? `product #${input.product_id}`,
            input.quantity,
            product?.cost_price_usd ?? 0,
            input.unit_price_usd ?? product?.selling_price_usd ?? 0,
          );
        const partId = Number(insertResult.lastInsertRowid);

        // Draw stock (guarded, unless allowOutOfStock) — same guard shape as
        // CustomServiceRepository's inventory-backed service draw
        // (packages/core/src/repositories/CustomServiceRepository.ts:190-212),
        // generalised from 1 unit to `qty`.
        const stockStmt = this.db.prepare(
          allowOutOfStock
            ? `UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND tenant_id = ?`
            : `UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND tenant_id = ? AND stock_quantity >= ?`,
        );
        const stockRes = allowOutOfStock
          ? stockStmt.run(input.quantity, input.product_id, tenantId)
          : stockStmt.run(
              input.quantity,
              input.product_id,
              tenantId,
              input.quantity,
            );
        if (!allowOutOfStock && stockRes.changes === 0) {
          throw new BusinessRuleError(
            `Not enough stock for "${product?.name ?? `product #${input.product_id}`}" (${product?.stock_quantity ?? 0} available)`,
          );
        }

        // Keep the FIFO batch ledger in step (mirrors
        // CustomServiceRepository's identical call). `reason: "SERVICE"`
        // stays deliberate — the CHECK constraint on that column only
        // allows SALE/ADJUSTMENT/SERVICE and changing it would need a full
        // SQLite table rebuild, while `maintenance_part_id` already
        // identifies the source.
        const res = getStockBatchRepository().consume(
          input.product_id,
          input.quantity,
          {
            reason: "SERVICE",
            fallbackUnitCostUsd: product?.cost_price_usd ?? 0,
            maintenancePartId: partId,
          },
        );

        // Cost snapshot: the weighted FIFO cost when fully covered by
        // batches, otherwise the product's current cost_price_usd (legacy
        // stock with no batches, or an allowed out-of-stock draw). Unlike a
        // custom service (no column to hold this), maintenance_parts DOES
        // have unit_cost_usd, so this is not discarded.
        const unitCostUsd =
          res.uncoveredQuantity === 0
            ? res.weightedUnitCostUsd
            : (product?.cost_price_usd ?? 0);

        this.db
          .prepare(
            `UPDATE maintenance_parts SET unit_cost_usd = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND tenant_id = ?`,
          )
          .run(unitCostUsd, partId, tenantId);
      }
    }

    recomputeMaintenancePartsTotals(this.db, jobId, tenantId);
  }

  /**
   * Find or create a client by name
   */
  findOrCreateClient(name: string, phone?: string | null): number {
    const tenantId = getCurrentTenantId();
    const existing = this.db
      .prepare(`SELECT id FROM clients WHERE full_name = ? AND tenant_id = ?`)
      .get(name, tenantId) as { id: number } | undefined;

    if (existing) return existing.id;

    const result = this.db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number, whatsapp_opt_in) VALUES (?, ?, ?, 0)`,
      )
      .run(tenantId, name, phone ?? null);
    return Number(result.lastInsertRowid);
  }

  /**
   * Execute a function within a transaction
   */
  withTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Update non-financial metadata on a maintenance job.
   * Only metadata fields are allowed — financial data is immutable.
   */
  updateMetadata(
    id: number,
    data: {
      client_name?: string;
      device_name?: string;
      issue_description?: string;
      note?: string;
    },
    editedBy: string,
  ): MaintenanceRow | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.client_name !== undefined) {
      fields.push("client_name = ?");
      values.push(data.client_name);
    }
    if (data.device_name !== undefined) {
      fields.push("device_name = ?");
      values.push(data.device_name);
    }
    if (data.issue_description !== undefined) {
      fields.push("issue_description = ?");
      values.push(data.issue_description);
    }
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
        `UPDATE maintenance SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`,
      )
      .run(...values);

    return this.findById(id);
  }
}
