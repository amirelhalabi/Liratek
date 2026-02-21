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
  discount_usd?: number;
  final_amount_usd?: number;
  paid_usd?: number;
  paid_lbp?: number;
  exchange_rate?: number;
  status?: string;
  paid_by?: string;
  note?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface MaintenanceRow {
  id: number;
  client_id: number | null;
  client_name: string | null;
  device_name: string;
  issue_description: string | null;
  cost_usd: number;
  price_usd: number;
  discount_usd: number;
  final_amount_usd: number;
  paid_usd: number;
  paid_lbp: number;
  exchange_rate: number;
  status: string;
  paid_by: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export class MaintenanceRepository extends BaseRepository<MaintenanceRow> {
  constructor() {
    super("maintenance");
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return "id, client_id, client_name, device_name, issue_description, cost_usd, price_usd, discount_usd, final_amount_usd, paid_usd, paid_lbp, exchange_rate, status, paid_by, note, created_at, updated_at";
  }

  /**
   * Create a new maintenance job
   */
  createJob(job: MaintenanceJob): number {
    const stmt = this.db.prepare(`
      INSERT INTO maintenance (
        client_id, client_name, device_name, issue_description,
        cost_usd, price_usd, discount_usd, final_amount_usd,
        paid_usd, paid_lbp, exchange_rate, status, paid_by, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      job.client_id ?? null,
      job.client_name ?? null,
      job.device_name,
      job.issue_description ?? null,
      job.cost_usd ?? 0,
      job.price_usd ?? 0,
      job.discount_usd ?? 0,
      job.final_amount_usd ?? 0,
      job.paid_usd ?? 0,
      job.paid_lbp ?? 0,
      job.exchange_rate ?? 0,
      job.status ?? "In Progress",
      job.paid_by ?? "CASH",
      job.note ?? null,
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
        cost_usd = ?, price_usd = ?, discount_usd = ?, final_amount_usd = ?,
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
      job.discount_usd ?? 0,
      job.final_amount_usd ?? 0,
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
      `SELECT ${this.getColumns()} FROM maintenance WHERE status != 'Voided' ORDER BY created_at DESC`,
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
      finalAmount: number;
      exchangeRate: number;
      clientId: number | null;
      changeUsd?: number;
      changeLbp?: number;
      note?: string | null;
    },
  ): void {
    const createdBy = 1;

    // Create unified transaction row
    const txnId = getTransactionRepository().createTransaction({
      type: TRANSACTION_TYPES.MAINTENANCE,
      source_table: "maintenance",
      source_id: jobId,
      user_id: createdBy,
      amount_usd: opts.finalAmount,
      client_id: opts.clientId ?? null,
      exchange_rate: opts.exchangeRate,
      summary: `Maintenance Job #${jobId}: $${opts.finalAmount}`,
      metadata_json: {
        final_amount: opts.finalAmount,
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

    // Insert each drawer-affecting payment line
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
    const totalPaidUsd = paidUsd + paidLbp / rate;
    const debtAmount = opts.finalAmount - totalPaidUsd;

    if (debtAmount > 0.05) {
      if (!opts.clientId) {
        throw new Error("Cannot create debt for anonymous client");
      }
      this.db
        .prepare(
          `INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, transaction_id, note, due_date)
           VALUES (?, ?, ?, ?, ?, datetime('now', '+30 days'))`,
        )
        .run(
          opts.clientId,
          "Maintenance Debt",
          debtAmount,
          txnId,
          "Balance from Maintenance",
        );
      maintenanceLogger.info(
        { jobId, clientId: opts.clientId, debtAmount },
        `Debt created for maintenance job #${jobId}: $${debtAmount.toFixed(2)}`,
      );
    }
  }

  /**
   * Delete a job by ID and void its transaction
   */
  deleteJob(id: number): void {
    this.db.transaction(() => {
      const txnRepo = getTransactionRepository();
      const originalTxn = txnRepo.getBySourceId("maintenance", id);
      if (originalTxn) {
        txnRepo.voidTransaction(originalTxn.id, 1);
      }
      // Soft-delete: mark as Voided instead of removing the record
      this.db
        .prepare("UPDATE maintenance SET status = 'Voided' WHERE id = ?")
        .run(id);
    })();
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
}
