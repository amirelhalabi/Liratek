import { BaseRepository } from "./BaseRepository.js";
import {
  isDrawerAffectingMethod,
  paymentMethodToDrawerName,
} from "../utils/payments.js";
import { maintenanceLogger } from "../utils/logger.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";

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
}

export class MaintenanceRepository extends BaseRepository<MaintenanceRow> {
  constructor() {
    super("maintenance");
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return "id, client_id, client_name, device_name, issue_description, cost_usd, price_usd, cost_lbp, price_lbp, discount_usd, final_amount_usd, final_amount_lbp, currency, paid_usd, paid_lbp, exchange_rate, status, paid_by, note, created_at, updated_at, edited_by, edited_at";
  }

  /**
   * Create a new maintenance job
   */
  createJob(job: MaintenanceJob): number {
    const stmt = this.db.prepare(`
      INSERT INTO maintenance (
        client_id, client_name, device_name, issue_description,
        cost_usd, price_usd, cost_lbp, price_lbp,
        discount_usd, final_amount_usd, final_amount_lbp, currency,
        paid_usd, paid_lbp, exchange_rate, status, paid_by, note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `);
    const result = stmt.run(
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
    const stmt = this.db.prepare(`
      UPDATE maintenance SET
        client_id = ?, client_name = ?, device_name = ?, issue_description = ?,
        cost_usd = ?, price_usd = ?, cost_lbp = ?, price_lbp = ?,
        discount_usd = ?, final_amount_usd = ?, final_amount_lbp = ?, currency = ?,
        paid_usd = ?, paid_lbp = ?, exchange_rate = ?, status = ?, paid_by = ?, note = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
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
    );
  }

  /**
   * Get jobs by status filter
   */
  getJobs(statusFilter?: string): MaintenanceRow[] {
    if (statusFilter && statusFilter !== "All") {
      const stmt = this.db.prepare(
        `SELECT ${this.getColumns()} FROM maintenance WHERE status = ? ORDER BY created_at DESC`,
      );
      return stmt.all(statusFilter) as MaintenanceRow[];
    }
    const stmt = this.db.prepare(
      `SELECT ${this.getColumns()} FROM maintenance WHERE status NOT IN ('Voided', 'Deleted') ORDER BY created_at DESC`,
    );
    return stmt.all() as MaintenanceRow[];
  }

  /**
   * Check if payments already exist for a maintenance job
   */
  hasPayments(jobId: number): boolean {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as cnt FROM payments WHERE transaction_id IN (SELECT id FROM transactions WHERE source_table = 'maintenance' AND source_id = ?)`,
      )
      .get(jobId) as { cnt: number };
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
      note?: string | null;
      /**
       * Session-basket deferred payment mode. When true, the unified transaction
       * row is still created (so it can be linked + paid-state back-filled by the
       * basket recorder) but the customer-cash drawer posting, change, and debt
       * are skipped — the basket recorder owns those.
       */
      defer?: boolean;
    },
  ): void {
    const createdBy = 1;
    const defer = opts.defer === true;
    const isLbp = opts.currency === "LBP";
    const profit = opts.profit ?? 0;
    const summary = isLbp
      ? `Maintenance Job #${jobId}: ${opts.finalAmount.toLocaleString()} LBP`
      : `Maintenance Job #${jobId}: $${opts.finalAmount}`;

    // Create unified transaction row — record the amount in the job's currency
    const txnId = getTransactionRepository().createTransaction({
      type: TRANSACTION_TYPES.MAINTENANCE,
      source_table: "maintenance",
      source_id: jobId,
      user_id: createdBy,
      amount_usd: isLbp ? 0 : opts.finalAmount,
      amount_lbp: isLbp ? opts.finalAmount : 0,
      profit_usd: isLbp ? 0 : profit,
      profit_lbp: isLbp ? profit : 0,
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
        `DELETE FROM payments WHERE transaction_id IN (SELECT id FROM transactions WHERE source_table = 'maintenance' AND source_id = ?)`,
      )
      .run(jobId);

    const insertPayment = this.db.prepare(`
      INSERT INTO payments (
        transaction_id, method, drawer_name, currency_code, amount, note, created_by
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?
      )
    `);

    const upsertBalanceDelta = this.db.prepare(`
      INSERT INTO drawer_balances (drawer_name, currency_code, balance)
      VALUES (?, ?, ?)
      ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
        balance = drawer_balances.balance + excluded.balance,
        updated_at = CURRENT_TIMESTAMP
    `);

    // Insert each drawer-affecting payment line.
    // Deferred (session basket): the basket recorder owns the customer-cash legs,
    // change, and debt — skip them all here (the unified transaction row above is
    // still created so it can be linked + paid-state back-filled).
    if (!defer) {
      for (const p of paymentLines) {
        if (!isDrawerAffectingMethod(p.method)) continue;
        const drawerName = paymentMethodToDrawerName(p.method);
        insertPayment.run(
          txnId,
          p.method,
          drawerName,
          p.currency_code,
          p.amount,
          opts.note ?? null,
          createdBy,
        );
        upsertBalanceDelta.run(drawerName, p.currency_code, p.amount);
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
        txnId,
        "CASH",
        "General",
        "USD",
        -changeUsd,
        "Change given",
        createdBy,
      );
      upsertBalanceDelta.run("General", "USD", -changeUsd);
    }
    if (changeLbp) {
      insertPayment.run(
        txnId,
        "CASH",
        "General",
        "LBP",
        -changeLbp,
        "Change given",
        createdBy,
      );
      upsertBalanceDelta.run("General", "LBP", -changeLbp);
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
      this.db
        .prepare(
          `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, transaction_id, note, due_date)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+30 days'))`,
        )
        .run(
          opts.clientId,
          "Maintenance Debt",
          isLbp ? 0 : debtAmount,
          isLbp ? debtAmount : 0,
          txnId,
          "Balance from Maintenance",
        );
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
    // A job with an ACTIVE unified transaction is money history (cash, debt,
    // or a session-linked entry) — it must be refunded/voided explicitly,
    // never deleted. Deleting an unpaid job is a PURE status change: no
    // transaction voiding, no reversal rows (owner feedback 2026-07-03 — the
    // old path voided the txn and emitted a confusing −amount reversal).
    // getBySourceId returns only ACTIVE transactions.
    const originalTxn = getTransactionRepository().getBySourceId(
      "maintenance",
      id,
    );
    if (originalTxn) {
      throw new Error(
        "This job has recorded payments — refund or void it instead of deleting.",
      );
    }
    this.db
      .prepare("UPDATE maintenance SET status = 'Deleted' WHERE id = ?")
      .run(id);
  }

  /**
   * Find or create a client by name
   */
  findOrCreateClient(name: string, phone?: string | null): number {
    const existing = this.db
      .prepare(`SELECT id FROM clients WHERE full_name = ?`)
      .get(name) as { id: number } | undefined;

    if (existing) return existing.id;

    const result = this.db
      .prepare(
        `INSERT INTO clients (full_name, phone_number, whatsapp_opt_in) VALUES (?, ?, 0)`,
      )
      .run(name, phone ?? null);
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

    this.db
      .prepare(`UPDATE maintenance SET ${fields.join(", ")} WHERE id = ?`)
      .run(...values);

    return this.findById(id);
  }
}
