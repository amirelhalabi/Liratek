import { BaseRepository } from "./BaseRepository.js";
import { DatabaseError } from "../utils/errors.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import {
  TRANSACTION_TYPES,
  type TransactionType,
} from "../constants/transactionTypes.js";
import {
  isDrawerAffectingMethod,
  paymentMethodToDrawerName,
} from "../utils/payments.js";

export interface SupplierEntity {
  id: number;
  name: string;
  contact_name: string | null;
  phone: string | null;
  note: string | null;
  is_active: number;
  module_key: string | null;
  provider: string | null;
  is_system: number;
  created_at: string;
}

export type SupplierLedgerEntryType =
  | "TOP_UP"
  /** Sale cost consumed from a provider balance (cost/price-flow SEND). Increases
   *  what the shop owes the supplier, like TOP_UP, but labeled distinctly so it can
   *  be reconciled as a real sale cost rather than a manual top-up. */
  | "SALE_COST"
  | "PAYMENT"
  | "ADJUSTMENT"
  | "SETTLEMENT"
  | "CASH_PRIZE"
  /** The supplier paid the shop (e.g. settling an overpayment they owed us).
   *  Positive ledger amount (mirror of PAYMENT) with cash CREDITED to the
   *  payment-method drawer. */
  | "SUPPLIER_PAYS_US";

export interface SupplierLedgerEntryEntity {
  id: number;
  supplier_id: number;
  entry_type: SupplierLedgerEntryType;
  amount_usd: number;
  amount_lbp: number;
  note: string | null;
  created_by: number | null;
  transaction_id: number | null;
  is_auto: number;
  created_at: string;
}

export interface SettleTransactionsData {
  supplier_id: number;
  /** IDs from financial_services to mark as settled */
  financial_service_ids: number[];
  /** Net amount paid to supplier (total owed minus commission) */
  amount_usd: number;
  amount_lbp: number;
  /** Total commission earned (will be credited to General drawer) */
  commission_usd: number;
  commission_lbp: number;
  /** Drawer cash is paid from (usually General) — ignored when payments[] is provided */
  drawer_name: string;
  note?: string;
  created_by: number;
  /** Multi-payment legs (optional; when provided, replaces drawer_name-based logic) */
  payments?: Array<{ method: string; currency_code: string; amount: number }>;
}

/**
 * Pay a supplier / record a supplier paying us, using real payment-method legs
 * (MultiPaymentInput) so the CORRECT drawer is debited/credited — not the
 * provider's own stock drawer. Works with zero pending transactions to settle
 * (pure balance pay-down / receipt).
 */
export interface SupplierCashflowData {
  supplier_id: number;
  /** PAY = shop pays the supplier (cash out, ledger −). RECEIVE = supplier pays
   *  the shop (cash in, ledger +). */
  direction: "PAY" | "RECEIVE";
  /** Payment-method legs; each routes to its method's drawer. */
  payments: Array<{ method: string; currency_code: string; amount: number }>;
  note?: string;
  created_by: number;
  /** Exchange rate (1 USD = X LBP) used to convert LBP legs to USD when
   *  applying FIFO coverage to supplier_purchases. Defaults to 89 000. */
  exchange_rate?: number;
}

export interface CreateSupplierData {
  name: string;
  contact_name?: string;
  phone?: string;
  note?: string;
  module_key?: string;
  provider?: string;
}

export interface CreateSupplierLedgerEntryData {
  supplier_id: number;
  entry_type: SupplierLedgerEntryType;
  amount_usd: number;
  amount_lbp: number;
  note?: string;
  created_by: number;
  drawer_name?: string;
  is_auto?: boolean;
}

export interface SupplierBalance {
  supplier_id: number;
  total_usd: number;
  total_lbp: number;
}

export class SupplierRepository extends BaseRepository<SupplierEntity> {
  constructor() {
    super("suppliers", { softDelete: false });
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return "id, name, contact_name, phone, note, is_active, module_key, provider, is_system, created_at";
  }

  listSuppliers(search?: string, includeInactive?: boolean): SupplierEntity[] {
    try {
      // Hide the SECONDARY OMT/WHISH system: it has no direct supplier relationship
      // (its obligations live in partner_ledger), so it shouldn't appear on the
      // suppliers page. The shop's base system is the only legacy system shown.
      let sql = includeInactive
        ? `SELECT ${this.getColumns()} FROM suppliers WHERE 1=1`
        : `SELECT ${this.getColumns()} FROM suppliers WHERE is_active = 1
             AND NOT (provider IN ('OMT', 'WHISH')
                      AND provider <> COALESCE(
                        (SELECT value FROM system_settings WHERE key_name = 'shop_base_system'),
                        'OMT'))`;
      const params: string[] = [];
      if (search?.trim()) {
        sql += ` AND name LIKE ?`;
        params.push(`%${search.trim()}%`);
      }
      sql += ` ORDER BY name ASC`;
      return this.query<SupplierEntity>(sql, ...params);
    } catch (e) {
      throw new DatabaseError("Failed to list suppliers", { cause: e });
    }
  }

  createSupplier(data: CreateSupplierData): { id: number } {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO suppliers (name, contact_name, phone, note, module_key, provider, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      `);
      const res = stmt.run(
        data.name.trim(),
        data.contact_name ?? null,
        data.phone ?? null,
        data.note ?? null,
        data.module_key ?? null,
        data.provider ?? null,
      );
      return { id: Number(res.lastInsertRowid) };
    } catch (e) {
      throw new DatabaseError("Failed to create supplier", { cause: e });
    }
  }

  getByProvider(provider: string): SupplierEntity | undefined {
    try {
      const rows = this.query<SupplierEntity>(
        `SELECT ${this.getColumns()} FROM suppliers WHERE provider = ? AND is_active = 1 LIMIT 1`,
        provider,
      );
      return rows[0];
    } catch (e) {
      throw new DatabaseError("Failed to get supplier by provider", {
        cause: e,
      });
    }
  }

  getByModuleKey(moduleKey: string): SupplierEntity[] {
    try {
      return this.query<SupplierEntity>(
        `SELECT ${this.getColumns()} FROM suppliers WHERE module_key = ? AND is_active = 1 ORDER BY name ASC`,
        moduleKey,
      );
    } catch (e) {
      throw new DatabaseError("Failed to get suppliers by module", {
        cause: e,
      });
    }
  }

  addLedgerEntry(data: CreateSupplierLedgerEntryData): { id: number } {
    try {
      // Enforce sign convention: PAYMENT amounts stored as negative
      let amountUsd = data.amount_usd || 0;
      let amountLbp = data.amount_lbp || 0;
      if (data.entry_type === "PAYMENT") {
        amountUsd = -Math.abs(amountUsd);
        amountLbp = -Math.abs(amountLbp);
      }

      const stmt = this.db.prepare(`
        INSERT INTO supplier_ledger (
          supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, is_auto,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      const res = stmt.run(
        data.supplier_id,
        data.entry_type,
        amountUsd,
        amountLbp,
        data.note ?? null,
        data.created_by,
        data.is_auto ? 1 : 0,
      );
      const entryId = Number(res.lastInsertRowid);

      // If drawer_name is provided, update drawer_balances
      if (data.drawer_name) {
        const upsertBalanceDelta = this.db.prepare(`
          INSERT INTO drawer_balances (drawer_name, currency_code, balance)
          VALUES (?, ?, ?)
          ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
            balance = drawer_balances.balance + excluded.balance,
            updated_at = CURRENT_TIMESTAMP
        `);

        // Decrease drawer for PAYMENT, Increase for TOP_UP (refund style), or Adjustment
        // Logic: Debt is liability. Payment reduces liability and reduces asset (Cash).
        // TOP_UP increases liability and (theoretically) increases asset if we got stock?
        // Usually, payments are the ones affecting cash.
        if (data.entry_type === "PAYMENT") {
          // Create unified transaction row for supplier payment
          const txnId = getTransactionRepository().createTransaction({
            type: TRANSACTION_TYPES.SUPPLIER_PAYMENT,
            source_table: "supplier_ledger",
            source_id: entryId,
            user_id: data.created_by,
            amount_usd: Math.abs(amountUsd),
            amount_lbp: Math.abs(amountLbp),
            summary: `Supplier Payment: $${Math.abs(amountUsd)} + ${Math.abs(amountLbp)} LBP`,
            metadata_json: {
              supplier_id: data.supplier_id,
              drawer_name: data.drawer_name,
            },
          });

          // Link supplier_ledger row to unified transaction
          this.db
            .prepare(
              `UPDATE supplier_ledger SET transaction_id = ? WHERE id = ?`,
            )
            .run(txnId, entryId);

          if (amountUsd)
            upsertBalanceDelta.run(data.drawer_name, "USD", amountUsd);
          if (amountLbp)
            upsertBalanceDelta.run(data.drawer_name, "LBP", amountLbp);

          // Log to payments table
          this.db
            .prepare(
              `
            INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, note, created_by)
            VALUES (?, 'CASH', ?, ?, ?, ?, ?)
          `,
            )
            .run(
              txnId,
              data.drawer_name,
              amountUsd ? "USD" : "LBP",
              amountUsd || amountLbp,
              data.note || `Supplier Payment: ${data.supplier_id}`,
              data.created_by,
            );
        }
      } else {
        // No drawer_name: still create a transaction record for non-PAYMENT entries
        // (TOP_UP, SALE_COST, ADJUSTMENT, SUPPLIER_PAYS_US) so they appear in the
        // unified journal.
        if (data.entry_type !== "PAYMENT") {
          const typeMap: Record<string, string> = {
            TOP_UP: TRANSACTION_TYPES.SUPPLIER_PAYMENT,
            SALE_COST: TRANSACTION_TYPES.SUPPLIER_PAYMENT,
            ADJUSTMENT: TRANSACTION_TYPES.SUPPLIER_PAYMENT,
            SETTLEMENT: TRANSACTION_TYPES.SUPPLIER_SETTLEMENT,
          };
          const txnType =
            typeMap[data.entry_type] || TRANSACTION_TYPES.SUPPLIER_PAYMENT;

          // SUPPLIER_PAYS_US through this path is a *cashless credit* — the
          // supplier owes us (e.g. the fixed commission on an iPick/Katsh bill);
          // no drawer moves. The supplier_ledger keeps the signed amount
          // (negative = credit to us, so SUM stays a valid balance), but the
          // unified journal is an event log: store a positive magnitude and flag
          // it as a credit so the UI shows money owed to us, not a negative
          // "payment". (recordSupplierCashflow handles the real cash RECEIVE.)
          const isSupplierCredit = data.entry_type === "SUPPLIER_PAYS_US";
          const journalUsd = isSupplierCredit ? Math.abs(amountUsd) : amountUsd;
          const journalLbp = isSupplierCredit ? Math.abs(amountLbp) : amountLbp;

          let summary: string;
          if (isSupplierCredit) {
            const parts: string[] = [];
            if (journalUsd) parts.push(`$${journalUsd.toLocaleString()}`);
            if (journalLbp) parts.push(`${journalLbp.toLocaleString()} LBP`);
            summary = `Supplier credit: ${parts.join(" + ") || "$0"}`;
          } else {
            summary = `Supplier ${data.entry_type}: $${amountUsd} + ${amountLbp} LBP`;
          }

          const txnId = getTransactionRepository().createTransaction({
            type: txnType as TransactionType,
            source_table: "supplier_ledger",
            source_id: entryId,
            user_id: data.created_by,
            amount_usd: journalUsd,
            amount_lbp: journalLbp,
            summary,
            metadata_json: {
              supplier_id: data.supplier_id,
              entry_type: data.entry_type,
              ...(isSupplierCredit ? { is_credit: true } : {}),
            },
          });

          // Link supplier_ledger row to unified transaction
          this.db
            .prepare(
              `UPDATE supplier_ledger SET transaction_id = ? WHERE id = ?`,
            )
            .run(txnId, entryId);
        }
      }

      return { id: entryId };
    } catch (e) {
      throw new DatabaseError("Failed to add supplier ledger entry", {
        cause: e,
      });
    }
  }

  getSupplierLedger(
    supplierId: number,
    limit = 200,
  ): SupplierLedgerEntryEntity[] {
    try {
      return this.query<SupplierLedgerEntryEntity>(
        `SELECT id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id, is_auto, created_at FROM supplier_ledger WHERE supplier_id = ? ORDER BY created_at DESC LIMIT ?`,
        supplierId,
        limit,
      );
    } catch (e) {
      throw new DatabaseError("Failed to get supplier ledger", {
        cause: e,
        entityId: supplierId,
      });
    }
  }

  getManualPaymentPools(supplierId: number): {
    send_pool_usd: number;
    receive_pool_usd: number;
  } {
    try {
      const row = this.db
        .prepare(
          `SELECT
            ABS(COALESCE(SUM(CASE WHEN amount_usd < 0 THEN amount_usd ELSE 0 END), 0)) as send_pool_usd,
            COALESCE(SUM(CASE WHEN amount_usd > 0 THEN amount_usd ELSE 0 END), 0) as receive_pool_usd
          FROM supplier_ledger
          WHERE supplier_id = ? AND is_auto = 0`,
        )
        .get(supplierId) as
        | { send_pool_usd: number; receive_pool_usd: number }
        | undefined;
      return row ?? { send_pool_usd: 0, receive_pool_usd: 0 };
    } catch (e) {
      throw new DatabaseError("Failed to get manual payment pools", {
        cause: e,
      });
    }
  }

  /**
   * Balance for product suppliers: inventory cost minus payments.
   * inventory cost = Σ(p.quantity * p.cost) for products from this supplier.
   * payments = existing supplier_ledger entries (PAYMENT stored as negative).
   * Returns only is_system = 0 suppliers that have a linked product_suppliers row.
   */
  getProductSupplierBalances(): SupplierBalance[] {
    try {
      return this.query<SupplierBalance>(`
        SELECT
          s.id as supplier_id,
          ROUND(
            COALESCE(inv.inv_usd, 0) + COALESCE(SUM(l.amount_usd), 0),
            2
          ) as total_usd,
          0 as total_lbp
        FROM suppliers s
        JOIN product_suppliers ps ON ps.supplier_id = s.id
        LEFT JOIN (
          SELECT ps2.supplier_id,
                 SUM(p.stock_quantity * p.cost_price_usd) as inv_usd
          FROM product_suppliers ps2
          JOIN products p ON LOWER(p.supplier) = LOWER(ps2.name) AND p.is_active = 1
          WHERE ps2.supplier_id IS NOT NULL
          GROUP BY ps2.supplier_id
        ) inv ON inv.supplier_id = s.id
        LEFT JOIN supplier_ledger l ON l.supplier_id = s.id
        WHERE s.is_system = 0 AND s.is_active = 1
        GROUP BY s.id
        ORDER BY s.name ASC
      `);
    } catch (e) {
      throw new DatabaseError("Failed to get product supplier balances", {
        cause: e,
      });
    }
  }

  getSupplierBalances(includeInactive?: boolean): SupplierBalance[] {
    try {
      // Hide the SECONDARY OMT/WHISH system (obligations live in partner_ledger).
      const filter = includeInactive
        ? "1=1"
        : `s.is_active = 1
           AND NOT (s.provider IN ('OMT', 'WHISH')
                    AND s.provider <> COALESCE(
                      (SELECT value FROM system_settings WHERE key_name = 'shop_base_system'),
                      'OMT'))`;
      return this.query<SupplierBalance>(`
        SELECT
          s.id as supplier_id,
          COALESCE(SUM(l.amount_usd), 0) as total_usd,
          COALESCE(SUM(l.amount_lbp), 0) as total_lbp
        FROM suppliers s
        LEFT JOIN supplier_ledger l ON l.supplier_id = s.id
        WHERE ${filter}
        GROUP BY s.id
        ORDER BY s.name ASC
      `);
    } catch (e) {
      throw new DatabaseError("Failed to get supplier balances", { cause: e });
    }
  }

  /**
   * Atomically settle a batch of financial_services transactions with a supplier.
   *
   * In a single DB transaction:
   * 1. Insert a SETTLEMENT supplier_ledger entry (negative = shop paying out)
   * 2. Mark all specified financial_services rows as is_settled = 1
   * 3. Credit commission to General drawer (commission was pending until now)
   * 4. Debit net payment from drawer (shop pays OMT the net amount)
   * 5. Create unified transactions row for audit trail
   */
  settleTransactions(data: SettleTransactionsData): { id: number } {
    if (!data.financial_service_ids.length) {
      throw new DatabaseError("No transactions selected for settlement");
    }

    try {
      const settle = this.db.transaction(() => {
        // Timestamps are stamped by SQLite (datetime('now')) so they share the
        // 'YYYY-MM-DD HH:MM:SS' format of every CURRENT_TIMESTAMP column. A JS
        // toISOString() here ('...T...Z') string-sorts ABOVE all space-format
        // rows of the same day, pinning settlement rows to the top of every
        // ORDER BY created_at DESC list (A6).

        // ── 1. Insert SETTLEMENT ledger entry (net paid to supplier, stored negative) ──
        const netUsd = -Math.abs(data.amount_usd);
        const netLbp = -Math.abs(data.amount_lbp);
        const ledgerRes = this.db
          .prepare(
            `INSERT INTO supplier_ledger
               (supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, created_at)
             VALUES (?, 'SETTLEMENT', ?, ?, ?, ?, datetime('now'))`,
          )
          .run(
            data.supplier_id,
            netUsd,
            netLbp,
            data.note ?? null,
            data.created_by,
          );
        const ledgerEntryId = Number(ledgerRes.lastInsertRowid);

        // ── 2. Mark financial_services rows as settled ─────────────────────
        // Guard on settlement_id IS NULL (not is_settled = 0): OMT/WHISH commission
        // rows are is_settled = 0 while pending, but cost/price-flow SALE_COST rows are
        // is_settled = 1 at creation (profit realized immediately) yet still carry an
        // outstanding supplier debt until settlement_id is stamped here. Both share
        // settlement_id IS NULL as the "supplier debt outstanding" marker.
        const placeholders = data.financial_service_ids
          .map(() => "?")
          .join(",");
        this.db
          .prepare(
            `UPDATE financial_services
             SET is_settled = 1,
                 settled_at = datetime('now'),
                 settlement_id = ?
             WHERE id IN (${placeholders})
               AND settlement_id IS NULL`,
          )
          .run(ledgerEntryId, ...data.financial_service_ids);

        // ── 3. Credit commission to General drawer ─────────────────────────
        const upsertBalance = this.db.prepare(`
          INSERT INTO drawer_balances (drawer_name, currency_code, balance)
          VALUES (?, ?, ?)
          ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
            balance = drawer_balances.balance + excluded.balance,
            updated_at = CURRENT_TIMESTAMP
        `);

        if (data.commission_usd > 0) {
          upsertBalance.run("General", "USD", data.commission_usd);
        }
        if (data.commission_lbp > 0) {
          upsertBalance.run("General", "LBP", data.commission_lbp);
        }

        // ── 4. Create unified transaction for audit trail ──────────────────
        const txnRes = this.db
          .prepare(
            `INSERT INTO transactions
               (type, status, source_table, source_id, user_id,
                amount_usd, amount_lbp, summary, metadata_json, created_at)
             VALUES (?, 'ACTIVE', 'supplier_ledger', ?, ?, ?, ?, ?, ?, datetime('now'))`,
          )
          .run(
            TRANSACTION_TYPES.SUPPLIER_SETTLEMENT,
            ledgerEntryId,
            data.created_by,
            data.amount_usd,
            data.amount_lbp,
            `Settlement: ${data.financial_service_ids.length} txns, net $${data.amount_usd.toFixed(2)}`,
            JSON.stringify({
              supplier_id: data.supplier_id,
              financial_service_ids: data.financial_service_ids,
              commission_usd: data.commission_usd,
              commission_lbp: data.commission_lbp,
              drawer_name: data.drawer_name,
            }),
          );
        const txnId = Number(txnRes.lastInsertRowid);

        // Link ledger entry to unified transaction
        this.db
          .prepare(`UPDATE supplier_ledger SET transaction_id = ? WHERE id = ?`)
          .run(txnId, ledgerEntryId);

        // ── 5. Debit net payment from drawer(s) and insert payment rows ──
        if (data.payments && data.payments.length > 0) {
          const insertPayment = this.db.prepare(
            `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, note, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          );
          for (const p of data.payments) {
            if (!isDrawerAffectingMethod(p.method)) continue;
            const drawerName = paymentMethodToDrawerName(p.method);
            upsertBalance.run(drawerName, p.currency_code, -Math.abs(p.amount));
            insertPayment.run(
              txnId,
              p.method,
              drawerName,
              p.currency_code,
              -Math.abs(p.amount),
              data.note ?? "Settlement payment",
              data.created_by,
            );
          }
        } else {
          // Legacy: single drawer
          if (data.amount_usd > 0) {
            upsertBalance.run(data.drawer_name, "USD", -data.amount_usd);
          }
          if (data.amount_lbp > 0) {
            upsertBalance.run(data.drawer_name, "LBP", -data.amount_lbp);
          }

          // Insert legacy payment row
          if (data.amount_usd > 0) {
            this.db
              .prepare(
                `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, note, created_by)
                 VALUES (?, 'CASH', ?, 'USD', ?, ?, ?)`,
              )
              .run(
                txnId,
                data.drawer_name,
                -data.amount_usd,
                data.note ?? "Settlement payment",
                data.created_by,
              );
          }
        }

        return { id: ledgerEntryId };
      });

      return settle();
    } catch (e) {
      throw new DatabaseError("Failed to settle transactions", { cause: e });
    }
  }

  /**
   * Record a direct supplier cash flow that is NOT tied to settling specific
   * transactions — paying a supplier down, or a supplier paying us back.
   *
   * Uses real payment-method legs so the cash hits the CORRECT drawer (General
   * for CASH, the wallet drawer for WHISH/OMT, etc.) — never the provider's own
   * stock drawer. Works with zero pending transactions.
   *
   *   PAY     → ledger −amount (we owe less), drawer −amount (cash out)
   *   RECEIVE → ledger +amount (their debt to us settled), drawer +amount (cash in)
   */
  recordSupplierCashflow(data: SupplierCashflowData): { id: number } {
    if (!data.payments?.length) {
      throw new DatabaseError("No payment legs provided");
    }
    try {
      const run = this.db.transaction(() => {
        // SQLite-side timestamps — see settleTransactions (A6 ordering).
        const isPay = data.direction === "PAY";
        const entryType: SupplierLedgerEntryType = isPay
          ? "PAYMENT"
          : "SUPPLIER_PAYS_US";
        // PAY: cash out + reduce what we owe (−). RECEIVE: cash in + settle their
        // debt to us (+). Ledger and drawer share the same sign here.
        const sign = isPay ? -1 : 1;
        const rate =
          data.exchange_rate && data.exchange_rate > 0
            ? data.exchange_rate
            : 89000;

        let usd = 0;
        let lbp = 0;
        for (const p of data.payments) {
          const amt = Math.abs(p.amount);
          if (p.currency_code === "USD") usd += amt;
          else if (p.currency_code === "LBP") lbp += amt;
        }

        const ledgerRes = this.db
          .prepare(
            `INSERT INTO supplier_ledger
               (supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
          )
          .run(
            data.supplier_id,
            entryType,
            sign * usd,
            sign * lbp,
            data.note ?? null,
            data.created_by,
          );
        const ledgerEntryId = Number(ledgerRes.lastInsertRowid);

        const money = `$${usd.toFixed(2)}${lbp ? ` + ${lbp.toLocaleString()} LBP` : ""}`;
        const summary = isPay
          ? `Supplier Payment: ${money}`
          : `Supplier Payment Received: ${money}`;
        const txnRes = this.db
          .prepare(
            `INSERT INTO transactions
               (type, status, source_table, source_id, user_id,
                amount_usd, amount_lbp, summary, metadata_json, created_at)
             VALUES (?, 'ACTIVE', 'supplier_ledger', ?, ?, ?, ?, ?, ?, datetime('now'))`,
          )
          .run(
            TRANSACTION_TYPES.SUPPLIER_PAYMENT,
            ledgerEntryId,
            data.created_by,
            usd,
            lbp,
            summary,
            JSON.stringify({
              supplier_id: data.supplier_id,
              direction: data.direction,
              entry_type: entryType,
            }),
          );
        const txnId = Number(txnRes.lastInsertRowid);
        this.db
          .prepare(`UPDATE supplier_ledger SET transaction_id = ? WHERE id = ?`)
          .run(txnId, ledgerEntryId);

        const upsertBalance = this.db.prepare(`
          INSERT INTO drawer_balances (drawer_name, currency_code, balance)
          VALUES (?, ?, ?)
          ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
            balance = drawer_balances.balance + excluded.balance,
            updated_at = CURRENT_TIMESTAMP
        `);
        const insertPayment = this.db.prepare(
          `INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, note, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const p of data.payments) {
          if (!isDrawerAffectingMethod(p.method)) continue;
          const drawerName = paymentMethodToDrawerName(p.method);
          const delta = sign * Math.abs(p.amount);
          upsertBalance.run(drawerName, p.currency_code, delta);
          insertPayment.run(
            txnId,
            p.method,
            drawerName,
            p.currency_code,
            delta,
            data.note ?? summary,
            data.created_by,
          );
        }

        // Apply FIFO coverage to supplier_purchases for PAY direction.
        // LBP legs are converted to USD at the payment's exchange rate.
        if (isPay) {
          const totalUsdEquiv = usd + lbp / rate;
          if (totalUsdEquiv > 0) {
            const unpaid = this.db
              .prepare(
                `SELECT id, total_usd, paid_usd
                 FROM supplier_purchases
                 WHERE supplier_id = ? AND paid_usd < total_usd - 0.005
                 ORDER BY created_at ASC`,
              )
              .all(data.supplier_id) as {
              id: number;
              total_usd: number;
              paid_usd: number;
            }[];

            const updatePurchase = this.db.prepare(
              `UPDATE supplier_purchases
               SET paid_usd = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`,
            );

            let remaining = totalUsdEquiv;
            for (const row of unpaid) {
              if (remaining <= 0) break;
              const canAbsorb = row.total_usd - row.paid_usd;
              const applied = Math.min(remaining, canAbsorb);
              updatePurchase.run(
                Math.min(row.paid_usd + applied, row.total_usd),
                row.id,
              );
              remaining -= applied;
            }
          }
        }

        return { id: ledgerEntryId };
      });

      return run();
    } catch (e) {
      throw new DatabaseError("Failed to record supplier cashflow", {
        cause: e,
      });
    }
  }
}

let supplierRepositoryInstance: SupplierRepository | null = null;
export function getSupplierRepository(): SupplierRepository {
  if (!supplierRepositoryInstance)
    supplierRepositoryInstance = new SupplierRepository();
  return supplierRepositoryInstance;
}
export function resetSupplierRepository(): void {
  supplierRepositoryInstance = null;
}
