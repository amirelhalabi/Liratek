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
  return (
    getTransactionRepository().getBySourceId("maintenance", id) !== null
  );
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
] as const satisfies ReadonlyArray<keyof MaintenanceJob & keyof MaintenanceRow>;

export const MAINTENANCE_AMOUNT_EDIT_BLOCKED_ERROR =
  "Cannot change the amount of a paid maintenance job while its transaction is still active — void or refund it first.";

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
}

export class MaintenanceRepository extends BaseRepository<MaintenanceRow> {
  constructor() {
    super("maintenance");
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return "id, client_id, client_name, device_name, issue_description, cost_usd, price_usd, cost_lbp, price_lbp, discount_usd, final_amount_usd, final_amount_lbp, currency, paid_usd, paid_lbp, exchange_rate, status, paid_by, note, created_at, updated_at, edited_by, edited_at, is_refunded, refunded_at";
  }

  /**
   * Create a new maintenance job
   */
  createJob(job: MaintenanceJob): number {
    const stmt = this.db.prepare(`
      INSERT INTO maintenance (
        tenant_id, client_id, client_name, device_name, issue_description,
        cost_usd, price_usd, cost_lbp, price_lbp,
        discount_usd, final_amount_usd, final_amount_lbp, currency,
        paid_usd, paid_lbp, exchange_rate, status, paid_by, note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `);
    const result = stmt.run(
      getCurrentTenantId(),
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
      job.status ?? "In Progress",
      job.paid_by ?? "CASH",
      job.note ?? null,
      job.transaction_time ?? null,
    );
    return Number(result.lastInsertRowid);
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

    const stmt = this.db.prepare(`
      UPDATE maintenance SET
        client_id = ?, client_name = ?, device_name = ?, issue_description = ?,
        cost_usd = ?, price_usd = ?, cost_lbp = ?, price_lbp = ?,
        discount_usd = ?, final_amount_usd = ?, final_amount_lbp = ?, currency = ?,
        paid_usd = ?, paid_lbp = ?, exchange_rate = ?, status = ?, paid_by = ?, note = ?,
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
      job.status ?? "In Progress",
      job.paid_by ?? "CASH",
      job.note ?? null,
      id,
      getCurrentTenantId(),
    );
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
      /** Final amount due, expressed in the job's currency. */
      finalAmount: number;
      /** Profit, expressed in the job's currency. */
      profit?: number;
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
    },
  ): void {
    const createdBy = 1;
    const tenantId = getCurrentTenantId();
    const defer = opts.defer === true;
    const isLbp = opts.currency === "LBP";
    const profit = opts.profit ?? 0;
    const prefix = isLbp
      ? `Maintenance Job #${jobId}: ${opts.finalAmount.toLocaleString()} LBP`
      : `Maintenance Job #${jobId}: $${opts.finalAmount}`;
    const deviceLabel = opts.deviceName?.trim()
      ? ` — ${opts.deviceName.trim()}`
      : "";
    const issueLabel = opts.issueDescription?.trim()
      ? ` — ${truncateSummaryDetail(opts.issueDescription.trim())}`
      : "";
    const summary = `${prefix}${deviceLabel}${issueLabel}`;

    // Create unified transaction row — record the amount in the job's currency
    const txnId = getTransactionRepository().createTransaction({
      type: TRANSACTION_TYPES.MAINTENANCE,
      source_table: "maintenance",
      source_id: jobId,
      user_id: createdBy,
      amount_usd: isLbp ? 0 : opts.finalAmount,
      amount_lbp: isLbp ? opts.finalAmount : 0,
      // Margin (job currency) plus kept change per its own currency (T3).
      profit_usd: (isLbp ? 0 : profit) + (opts.keptChangeUsd ?? 0),
      profit_lbp: (isLbp ? profit : 0) + (opts.keptChangeLbp ?? 0),
      client_id: opts.clientId ?? null,
      exchange_rate: opts.exchangeRate,
      summary,
      metadata_json: {
        final_amount: opts.finalAmount,
        currency: opts.currency ?? "USD",
        payment_count: paymentLines.length,
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
    // Compute the outstanding balance in the job's currency.
    const debtAmount = isLbp
      ? opts.finalAmount - (paidLbp + paidUsd * rate)
      : opts.finalAmount - (paidUsd + paidLbp / rate);
    // Threshold check in USD-equivalent (~5 cents) to ignore rounding dust.
    const debtUsdEquiv = isLbp ? debtAmount / rate : debtAmount;

    if (debtUsdEquiv > 0.05) {
      if (!opts.clientId) {
        throw new Error("Cannot create debt for anonymous client");
      }
      // createdBy stays null: the original hand-rolled INSERT here never
      // included that column (see moneyPosting.ts's bookClientDebtCharge doc).
      bookClientDebtCharge(this.db, {
        clientId: opts.clientId,
        transactionType: "Maintenance Debt",
        amountUsd: isLbp ? 0 : debtAmount,
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
    this.db
      .prepare(
        "UPDATE maintenance SET status = 'Deleted' WHERE id = ? AND tenant_id = ?",
      )
      .run(id, getCurrentTenantId());
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
