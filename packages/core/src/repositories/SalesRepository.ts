/**
 * Sales Repository
 *
 * Handles all database operations for sales and sale_items.
 * Extends BaseRepository for standard CRUD operations.
 */

import { BaseRepository } from "./BaseRepository.js";
import { DatabaseError, NotFoundError } from "../utils/errors.js";
import { salesLogger } from "../utils/logger.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";

// =============================================================================
// Types
// =============================================================================

export interface SaleEntity {
  id: number;
  client_id: number | null;
  total_amount_usd: number;
  discount_usd: number;
  final_amount_usd: number;
  paid_usd: number;
  paid_lbp: number;
  change_given_usd: number;
  change_given_lbp: number;
  exchange_rate_snapshot: number;
  drawer_name: string;
  status: "completed" | "draft" | "cancelled" | "refunded";
  note: string | null;
  created_at: string;
  created_by?: number;
}

export interface SaleItemEntity {
  id: number;
  sale_id: number;
  product_id: number;
  quantity: number;
  sold_price_usd: number;
  cost_price_snapshot_usd: number;
  is_refunded: number;
  refunded_quantity: number;
  imei: string | null;
}

export interface SaleWithClient extends SaleEntity {
  client_name: string | null;
  client_phone: string | null;
}

export interface SaleItemWithProduct extends SaleItemEntity {
  name: string;
  barcode: string;
}

export interface DraftSaleWithItems extends SaleWithClient {
  items: SaleItemWithProduct[];
}

import {
  type PaymentMethod,
  isDrawerAffectingMethod,
  paymentMethodToDrawerName,
} from "../utils/payments.js";

// Backward compatible payment method type (DB values)
// NOTE: exported for API typing.
export type { PaymentMethod };
export type PaymentCurrencyCode = string;

export interface PaymentLine {
  method: PaymentMethod;
  currency_code: string;
  amount: number;
}

export interface SaleRequest {
  client_id: number | null;
  client_name?: string;
  client_phone?: string;
  items: {
    product_id: number;
    quantity: number;
    price: number;
    imei?: string;
  }[];
  total_amount: number;
  discount: number;
  final_amount: number;
  // Legacy totals (kept for compatibility; will be derived from payments if provided)
  payment_usd: number;
  payment_lbp: number;
  payments?: PaymentLine[];
  change_given_usd?: number;
  change_given_lbp?: number;
  exchange_rate: number;
  drawer_name?: string;
  id?: number;
  status?: "completed" | "draft" | "cancelled";
  note?: string;
}

export interface DashboardStats {
  totalSalesUSD: number;
  totalSalesLBP: number;
  cashCollectedUSD: number;
  cashCollectedLBP: number;
  ordersCount: number;
  activeClients: number;
  lowStockCount: number;
}

export interface DrawerBalance {
  usd: number;
  lbp: number;
}

export interface DrawerBalances {
  generalDrawer: DrawerBalance;
  omtDrawer: DrawerBalance;
}

export interface TopProduct {
  name: string;
  total_quantity: number;
  total_revenue: number;
}

export interface RecentSale {
  id: number;
  client_name: string | null;
  paid_usd: number;
  paid_lbp: number;
  final_amount_usd: number;
  discount_usd: number;
  status: string;
  item_count: number;
  created_at: string;
}

export interface ChartDataPoint {
  date: string;
  usd?: number;
  lbp?: number;
  profit?: number;
}

// =============================================================================
// Repository
// =============================================================================

// Row DTOs for typed query results
type SaleWithClientRow = SaleEntity & {
  client_name: string | null;
  client_phone: string | null;
};
type SaleItemWithProductRow = SaleItemEntity & {
  name: string;
  barcode: string;
};
type SumRow = { total_usd: number; total_lbp: number };
type CountRow = { count: number };
type DateRow = { date: string };
type ProfitRow = { profit_date: string; profit: number };

export class SalesRepository extends BaseRepository<SaleEntity> {
  constructor() {
    super("sales", { softDelete: false });
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return "id, client_id, total_amount_usd, discount_usd, final_amount_usd, paid_usd, paid_lbp, change_given_usd, change_given_lbp, exchange_rate_snapshot, status, note, created_at, drawer_name";
  }

  // ---------------------------------------------------------------------------
  // Full Transaction Processing
  // ---------------------------------------------------------------------------

  /**
   * Process a complete sale transaction (create/update with items, stock, debt)
   * This wraps all sale operations in a single transaction
   */
  processSale(sale: SaleRequest): {
    success: boolean;
    id?: number;
    error?: string;
  } {
    const db = this.db;
    const tableName = this.tableName;

    try {
      const processTransaction = db.transaction(() => {
        let finalClientId = sale.client_id;
        const status = sale.status || "completed";

        // Auto-create client if name provided but no ID
        if (!finalClientId && sale.client_name) {
          try {
            const createClient = db.prepare(`
              INSERT INTO clients (full_name, phone_number, whatsapp_opt_in)
              VALUES (?, ?, 0)
            `);
            const clientResult = createClient.run(
              sale.client_name,
              sale.client_phone || null,
            );
            finalClientId = clientResult.lastInsertRowid as number;
          } catch (e) {
            salesLogger.error(
              { error: e, clientName: sale.client_name },
              "Auto-create client failed",
            );
          }
        }

        const sumPayments = (lines: PaymentLine[] | undefined) => {
          const totals: Record<string, number> = {};
          for (const p of lines || []) {
            // DEBT lines represent unpaid amounts and must not count as paid.
            if (!isDrawerAffectingMethod(p.method)) continue;
            totals[p.currency_code] = (totals[p.currency_code] || 0) + p.amount;
          }
          return totals;
        };

        // If new payments[] provided, derive legacy totals from it
        const derived = sumPayments(sale.payments);
        const paymentUsd = sale.payments
          ? derived["USD"] || 0
          : sale.payment_usd;
        const paymentLbp = sale.payments
          ? derived["LBP"] || 0
          : sale.payment_lbp;

        let saleId = sale.id;

        if (saleId) {
          // UPDATE Existing Sale
          const updateStmt = db.prepare(`
            UPDATE ${tableName} SET 
              client_id = ?, total_amount_usd = ?, discount_usd = ?, final_amount_usd = ?, 
              paid_usd = ?, paid_lbp = ?, change_given_usd = ?, change_given_lbp = ?, 
              exchange_rate_snapshot = ?, drawer_name = ?, status = ?, note = ?
            WHERE id = ?
          `);
          updateStmt.run(
            finalClientId,
            sale.total_amount,
            sale.discount,
            sale.final_amount,
            sale.payment_usd,
            sale.payment_lbp,
            sale.change_given_usd || 0,
            sale.change_given_lbp || 0,
            sale.exchange_rate,
            sale.drawer_name || "General",
            status,
            sale.note || null,
            saleId,
          );

          // Clear old items to re-insert new ones
          db.prepare("DELETE FROM sale_items WHERE sale_id = ?").run(saleId);
        } else {
          // INSERT New Sale
          const saleStmt = db.prepare(`
            INSERT INTO ${tableName} (
              client_id, total_amount_usd, discount_usd, final_amount_usd, 
              paid_usd, paid_lbp, change_given_usd, change_given_lbp, exchange_rate_snapshot,
              drawer_name, status, note
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          const saleResult = saleStmt.run(
            finalClientId,
            sale.total_amount,
            sale.discount,
            sale.final_amount,
            sale.payment_usd,
            sale.payment_lbp,
            sale.change_given_usd || 0,
            sale.change_given_lbp || 0,
            sale.exchange_rate,
            sale.drawer_name || "General",
            status,
            sale.note || null,
          );
          saleId = saleResult.lastInsertRowid as number;
        }

        // Create unified transaction row
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.SALE,
          source_table: "sales",
          source_id: saleId,
          user_id: 1,
          amount_usd: sale.final_amount,
          amount_lbp: sale.payment_lbp || 0,
          exchange_rate: sale.exchange_rate,
          client_id: finalClientId ?? null,
          summary: `Sale #${saleId}: $${sale.final_amount}`,
          metadata_json: {
            total_amount: sale.total_amount,
            discount: sale.discount,
            final_amount: sale.final_amount,
            status,
            item_count: sale.items.length,
          },
        });

        // Persist payment lines + update running balances (drawer_balances)
        // - If sale.payments is not provided, we store inferred CASH lines from legacy totals.
        // - Change is treated as CASH (General drawer) outflow.
        const paymentLines: PaymentLine[] = sale.payments?.length
          ? sale.payments
          : [
              ...(paymentUsd
                ? [
                    {
                      method: "CASH" as const,
                      currency_code: "USD",
                      amount: paymentUsd,
                    },
                  ]
                : []),
              ...(paymentLbp
                ? [
                    {
                      method: "CASH" as const,
                      currency_code: "LBP",
                      amount: paymentLbp,
                    },
                  ]
                : []),
            ];

        db.prepare(
          `DELETE FROM payments WHERE transaction_id IN (SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ?)`,
        ).run(saleId);

        const insertPayment = db.prepare(`
          INSERT INTO payments (
            transaction_id, method, drawer_name, currency_code, amount, note, created_by
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?
          )
        `);

        const upsertBalanceDelta = db.prepare(`
          INSERT INTO drawer_balances (drawer_name, currency_code, balance)
          VALUES (?, ?, ?)
          ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
            balance = drawer_balances.balance + excluded.balance,
            updated_at = CURRENT_TIMESTAMP
        `);

        const createdBy = 1;
        const note = sale.note || null;

        for (const p of paymentLines) {
          // DEBT means no drawer movement and should not create a payments row.
          if (!isDrawerAffectingMethod(p.method)) continue;
          const drawerName = paymentMethodToDrawerName(p.method);
          insertPayment.run(
            txnId,
            p.method,
            drawerName,
            p.currency_code,
            p.amount,
            note,
            createdBy,
          );
          upsertBalanceDelta.run(drawerName, p.currency_code, p.amount);
        }

        const changeUsd = Math.abs(sale.change_given_usd || 0);
        const changeLbp = Math.abs(sale.change_given_lbp || 0);
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

        // Process Items & Update Stock
        const itemStmt = db.prepare(`
          INSERT INTO sale_items (
            sale_id, product_id, quantity, sold_price_usd, cost_price_snapshot_usd, imei
          ) VALUES (?, ?, ?, ?, (SELECT cost_price_usd FROM products WHERE id = ?), ?)
        `);

        const stockStmt = db.prepare(`
          UPDATE products 
          SET stock_quantity = stock_quantity - ? 
          WHERE id = ?
        `);

        for (const item of sale.items) {
          itemStmt.run(
            saleId,
            item.product_id,
            item.quantity,
            item.price,
            item.product_id,
            item.imei || null,
          );

          // Update Stock: ONLY IF COMPLETED
          if (status === "completed") {
            stockStmt.run(item.quantity, item.product_id);
          }
        }

        // Handle Debt (If Partial Payment AND Completed)
        if (status === "completed") {
          // Use derived payment totals (accounts for new payment lines structure)
          const totalPaidUSD = paymentUsd + paymentLbp / sale.exchange_rate;
          if (sale.final_amount - totalPaidUSD > 0.05) {
            if (!finalClientId) {
              throw new Error("Cannot create debt for anonymous client");
            }
            const debtAmount = sale.final_amount - totalPaidUSD;

            const debtStmt = db.prepare(`
              INSERT INTO debt_ledger (
                client_id, transaction_type, amount_usd, transaction_id, note, due_date
              ) VALUES (?, ?, ?, ?, ?, datetime('now', '+30 days'))
            `);
            // Use txnId (transactions table FK) per unified transaction architecture
            debtStmt.run(
              finalClientId,
              "Sale Debt",
              debtAmount,
              txnId,
              "Balance from Sale",
            );
          }
        }

        return { success: true, id: saleId };
      });

      return processTransaction();
    } catch (error) {
      salesLogger.error({ error, sale }, "Sale transaction failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Core Sales Operations
  // ---------------------------------------------------------------------------

  /**
   * Get all draft sales with client info and items
   */
  findDrafts(): DraftSaleWithItems[] {
    try {
      const drafts = this.query<SaleWithClientRow>(`
        SELECT s.*, c.full_name as client_name, c.phone_number as client_phone 
        FROM ${this.tableName} s 
        LEFT JOIN clients c ON s.client_id = c.id
        WHERE s.status = 'draft'
        ORDER BY s.created_at DESC
      `);

      return drafts.map((draft) => {
        const items = this.query<SaleItemWithProductRow>(
          `
          SELECT si.*, p.name, p.barcode 
          FROM sale_items si
          JOIN products p ON si.product_id = p.id
          WHERE si.sale_id = ?
        `,
          draft.id,
        );

        return { ...draft, items };
      });
    } catch (error) {
      throw new DatabaseError("Failed to get draft sales", { cause: error });
    }
  }

  /**
   * Create a new sale
   */
  createSale(data: {
    client_id: number | null;
    total_amount: number;
    discount: number;
    final_amount: number;
    payment_usd: number;
    payment_lbp: number;
    change_given_usd: number;
    change_given_lbp: number;
    exchange_rate: number;
    drawer_name: string;
    status: string;
    note: string | null;
  }): number {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO ${this.tableName} (
          client_id, total_amount_usd, discount_usd, final_amount_usd, 
          paid_usd, paid_lbp, change_given_usd, change_given_lbp, exchange_rate_snapshot,
          drawer_name, status, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        data.client_id,
        data.total_amount,
        data.discount,
        data.final_amount,
        data.payment_usd,
        data.payment_lbp,
        data.change_given_usd,
        data.change_given_lbp,
        data.exchange_rate,
        data.drawer_name,
        data.status,
        data.note,
      );

      return result.lastInsertRowid as number;
    } catch (error) {
      throw new DatabaseError("Failed to create sale", { cause: error });
    }
  }

  /**
   * Update an existing sale
   */
  updateSale(
    id: number,
    data: {
      client_id: number | null;
      total_amount: number;
      discount: number;
      final_amount: number;
      payment_usd: number;
      payment_lbp: number;
      change_given_usd: number;
      change_given_lbp: number;
      exchange_rate: number;
      drawer_name: string;
      status: string;
      note: string | null;
    },
  ): boolean {
    try {
      const stmt = this.db.prepare(`
        UPDATE ${this.tableName} SET 
          client_id = ?, total_amount_usd = ?, discount_usd = ?, final_amount_usd = ?, 
          paid_usd = ?, paid_lbp = ?, change_given_usd = ?, change_given_lbp = ?, 
          exchange_rate_snapshot = ?, drawer_name = ?, status = ?, note = ?
        WHERE id = ?
      `);

      const result = stmt.run(
        data.client_id,
        data.total_amount,
        data.discount,
        data.final_amount,
        data.payment_usd,
        data.payment_lbp,
        data.change_given_usd,
        data.change_given_lbp,
        data.exchange_rate,
        data.drawer_name,
        data.status,
        data.note,
        id,
      );

      return result.changes > 0;
    } catch (error) {
      throw new DatabaseError("Failed to update sale", {
        cause: error,
        entityId: id,
      });
    }
  }

  /**
   * Delete all items for a sale (used when updating drafts)
   */
  deleteSaleItems(saleId: number): void {
    try {
      this.execute("DELETE FROM sale_items WHERE sale_id = ?", saleId);
    } catch (error) {
      throw new DatabaseError("Failed to delete sale items", { cause: error });
    }
  }

  /**
   * Delete a draft sale and its items
   */
  deleteDraft(saleId: number): { success: boolean; error?: string } {
    try {
      // Only allow deleting drafts, not completed/cancelled sales
      const sale = this.findById(saleId);
      if (!sale) {
        return { success: false, error: "Draft not found" };
      }
      if (sale.status !== "draft") {
        return { success: false, error: "Only draft sales can be deleted" };
      }
      this.execute("DELETE FROM sale_items WHERE sale_id = ?", saleId);
      this.execute("DELETE FROM sales WHERE id = ?", saleId);
      return { success: true };
    } catch (error) {
      throw new DatabaseError("Failed to delete draft", { cause: error });
    }
  }

  /**
   * Add an item to a sale
   */
  addSaleItem(
    saleId: number,
    item: {
      product_id: number;
      quantity: number;
      price: number;
      imei?: string | null;
    },
  ): void {
    try {
      this.execute(
        `
        INSERT INTO sale_items (
          sale_id, product_id, quantity, sold_price_usd, cost_price_snapshot_usd, imei
        ) VALUES (?, ?, ?, ?, (SELECT cost_price_usd FROM products WHERE id = ?), ?)
      `,
        saleId,
        item.product_id,
        item.quantity,
        item.price,
        item.product_id,
        item.imei || null,
      );
    } catch (error) {
      throw new DatabaseError("Failed to add sale item", { cause: error });
    }
  }

  /**
   * Get sale items for a sale
   */
  getSaleItems(saleId: number): SaleItemWithProduct[] {
    try {
      return this.query<SaleItemWithProduct>(
        `
        SELECT si.*, p.name, p.barcode 
        FROM sale_items si
        JOIN products p ON si.product_id = p.id
        WHERE si.sale_id = ?
      `,
        saleId,
      );
    } catch (error) {
      throw new DatabaseError("Failed to get sale items", { cause: error });
    }
  }

  /**
   * Refund a specific item from a sale (partial or full quantity)
   * Returns the refund transaction ID
   */
  refundSaleItem(params: {
    saleId: number;
    saleItemId: number;
    refundQuantity: number;
    userId: number;
  }): number {
    const db = this.db;

    return this.transaction(() => {
      // 1. Get the sale item
      const item = db
        .prepare(`SELECT * FROM sale_items WHERE id = ? AND sale_id = ?`)
        .get(params.saleItemId, params.saleId) as SaleItemEntity | undefined;

      if (!item) {
        throw new NotFoundError("sale_item", params.saleItemId);
      }

      // 2. Validate quantity
      const alreadyRefunded = item.refunded_quantity ?? 0;
      const availableToRefund = item.quantity - alreadyRefunded;

      if (params.refundQuantity <= 0) {
        throw new DatabaseError("Refund quantity must be greater than 0");
      }
      if (params.refundQuantity > availableToRefund) {
        throw new DatabaseError(
          `Cannot refund ${params.refundQuantity} - only ${availableToRefund} available (already refunded ${alreadyRefunded})`,
        );
      }

      // 3. Get the parent sale
      const sale = db
        .prepare(`SELECT * FROM sales WHERE id = ?`)
        .get(params.saleId) as SaleEntity | undefined;

      if (!sale) {
        throw new NotFoundError("sale", params.saleId);
      }

      if (sale.status === "refunded") {
        throw new DatabaseError(
          "Cannot refund items from a fully refunded sale",
        );
      }

      // 4. Calculate refund amount (proportional)
      const refundAmount = item.sold_price_usd * params.refundQuantity;

      // 5. Get the original SALE transaction
      const originalTxn = db
        .prepare(
          `SELECT id, source_table, source_id, amount_usd, amount_lbp, exchange_rate, client_id, device_id 
           FROM transactions 
           WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`,
        )
        .get(params.saleId) as
        | {
            id: number;
            source_table: string;
            source_id: number;
            amount_usd: number;
            amount_lbp: number;
            exchange_rate: number;
            client_id: number | null;
            device_id: string | null;
          }
        | undefined;

      if (!originalTxn) {
        throw new DatabaseError("No SALE transaction found for this sale");
      }

      // 6. Create REFUND transaction for this item
      const refundTxnResult = db
        .prepare(
          `INSERT INTO transactions
            (type, status, source_table, source_id, user_id,
             amount_usd, amount_lbp, exchange_rate,
             client_id, reverses_id, summary, metadata_json, device_id)
            VALUES ('REFUND', 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          originalTxn.source_table,
          originalTxn.source_id,
          params.userId,
          -refundAmount,
          -(refundAmount * originalTxn.exchange_rate),
          originalTxn.exchange_rate,
          originalTxn.client_id,
          null,
          `ITEM REFUND: ${params.refundQuantity}x product ${item.product_id} from Sale #${params.saleId}`,
          JSON.stringify({
            refundType: "item",
            saleItemId: params.saleItemId,
            refundQuantity: params.refundQuantity,
            originalSaleId: params.saleId,
          }),
          originalTxn.device_id,
        );

      const refundTxnId = refundTxnResult.lastInsertRowid as number;

      // 7. Reverse payments proportionally
      const originalPayments = db
        .prepare(
          `SELECT method, drawer_name, currency_code, amount FROM payments WHERE transaction_id = ?`,
        )
        .all(originalTxn.id) as {
        method: string;
        drawer_name: string;
        currency_code: string;
        amount: number;
      }[];

      const refundRatio = refundAmount / originalTxn.amount_usd;

      const insertPayment = db.prepare(`
        INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, note, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const upsertBalance = db.prepare(`
        INSERT INTO drawer_balances (drawer_name, currency_code, balance)
        VALUES (?, ?, ?)
        ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
          balance = drawer_balances.balance + excluded.balance,
          updated_at = CURRENT_TIMESTAMP
      `);

      for (const payment of originalPayments) {
        const negatedAmount = -(payment.amount * refundRatio);
        insertPayment.run(
          refundTxnId,
          payment.method,
          payment.drawer_name,
          payment.currency_code,
          negatedAmount,
          `Item refund - ${params.refundQuantity}x product ${item.product_id}`,
          params.userId,
        );
        upsertBalance.run(
          payment.drawer_name,
          payment.currency_code,
          negatedAmount,
        );
      }

      // 8. Update sale_items.refunded_quantity
      db.prepare(
        `UPDATE sale_items SET refunded_quantity = refunded_quantity + ? WHERE id = ?`,
      ).run(params.refundQuantity, params.saleItemId);

      // 9. Restore stock for refunded quantity
      db.prepare(
        `UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?`,
      ).run(params.refundQuantity, item.product_id);

      // 10. If sale was on debt, cancel proportional debt
      if (originalTxn.client_id) {
        const debts = db
          .prepare(
            `SELECT id, client_id, amount_usd FROM debt_ledger WHERE transaction_id = ? AND transaction_type = 'Sale Debt'`,
          )
          .all(originalTxn.id) as {
          id: number;
          client_id: number;
          amount_usd: number;
        }[];

        const insertReversal = db.prepare(`
          INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, transaction_id, note, created_by)
          VALUES (?, 'Refund Reversal', ?, ?, 'Debt cancelled by item refund', ?)
        `);

        for (const debt of debts) {
          insertReversal.run(
            debt.client_id,
            -(debt.amount_usd * refundRatio),
            refundTxnId,
            params.userId,
          );
        }
      }

      // 11. Check if ALL items are fully refunded - mark sale as refunded
      const remainingItems = db
        .prepare(
          `SELECT COUNT(*) as count FROM sale_items 
           WHERE sale_id = ? AND (quantity - refunded_quantity) > 0`,
        )
        .get(params.saleId) as { count: number } | undefined;

      if (remainingItems?.count === 0) {
        db.prepare(`UPDATE sales SET status = 'refunded' WHERE id = ?`).run(
          params.saleId,
        );
      }

      return refundTxnId;
    });
  }

  // ---------------------------------------------------------------------------
  // Dashboard & Reporting Queries
  // ---------------------------------------------------------------------------

  /**
   * Get dashboard statistics for today
   */
  getDashboardStats(): DashboardStats {
    try {
      // Total Sales Today
      const salesResult = this.queryOne<SumRow>(`
        SELECT 
          SUM(paid_usd) as total_usd,
          SUM(paid_lbp) as total_lbp
        FROM ${this.tableName} 
        WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime') AND status = 'completed'
      `);

      // Total Repayments Today
      const repaymentResult = this.queryOne<SumRow>(`
        SELECT 
          SUM(ABS(amount_usd)) as total_usd,
          SUM(ABS(amount_lbp)) as total_lbp
        FROM debt_ledger
        WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime') AND transaction_type = 'Repayment'
      `);

      // Orders Count Today
      const ordersResult = this.queryOne<CountRow>(`
        SELECT COUNT(*) as count 
        FROM ${this.tableName} 
        WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime') AND status = 'completed'
      `);

      // Active Clients Count
      const clientsResult = this.queryOne<CountRow>(
        "SELECT COUNT(*) as count FROM clients",
      );

      // Low Stock Items Count
      const stockResult = this.queryOne<CountRow>(`
        SELECT COUNT(*) as count 
        FROM products 
        WHERE stock_quantity <= min_stock_level AND is_active = 1
      `);

      return {
        // Sales Revenue: Only sales created today (revenue recognition)
        totalSalesUSD: salesResult?.total_usd ?? 0,
        totalSalesLBP: salesResult?.total_lbp ?? 0,
        // Cash Collected: Sales + debt repayments received today (cash flow)
        cashCollectedUSD:
          (salesResult?.total_usd ?? 0) + (repaymentResult?.total_usd ?? 0),
        cashCollectedLBP:
          (salesResult?.total_lbp ?? 0) + (repaymentResult?.total_lbp ?? 0),
        ordersCount: ordersResult?.count ?? 0,
        activeClients: clientsResult?.count ?? 0,
        lowStockCount: stockResult?.count ?? 0,
      };
    } catch (error) {
      throw new DatabaseError("Failed to get dashboard stats", {
        cause: error,
      });
    }
  }

  /**
   * Get accumulated drawer balances (not filtered by date)
   * Reads from drawer_balances table which maintains running totals
   */
  getDrawerBalances(): DrawerBalances {
    try {
      // Read from drawer_balances table (running totals)
      const balances = this.query<{
        drawer_name: string;
        currency_code: string;
        balance: number;
      }>(`
        SELECT drawer_name, currency_code, balance 
        FROM drawer_balances 
        WHERE drawer_name IN ('General', 'OMT_System', 'OMT_App', 'Whish_App', 'Whish_System', 'Binance', 'Alfa', 'MTC', 'IPEC', 'Katch')
        ORDER BY drawer_name, currency_code
      `);

      // Transform to DrawerBalances format
      const result: DrawerBalances = {
        generalDrawer: { usd: 0, lbp: 0 },
        omtDrawer: { usd: 0, lbp: 0 },
      };

      for (const row of balances) {
        // General drawer
        if (row.drawer_name === "General") {
          if (row.currency_code === "USD") {
            result.generalDrawer.usd = row.balance;
          } else if (row.currency_code === "LBP") {
            result.generalDrawer.lbp = row.balance;
          }
        }
        // OMT drawers (OMT_System and OMT_App)
        else if (row.drawer_name.startsWith("OMT")) {
          if (row.currency_code === "USD") {
            result.omtDrawer.usd += row.balance;
          } else if (row.currency_code === "LBP") {
            result.omtDrawer.lbp += row.balance;
          }
        }
        // Other drawers can be added here as needed
      }

      return result;
    } catch (error) {
      throw new DatabaseError("Failed to get drawer balances", {
        cause: error,
      });
    }
  }

  /**
   * Get recent sales for a specific date (defaults to today)
   */
  getTodaysSales(limit: number = 50, date?: string): RecentSale[] {
    try {
      const targetDate = date ? date : "now";
      const dateFunc = date ? "?" : "DATE('now', 'localtime')";

      return this.query<RecentSale>(
        `
        SELECT 
          s.id,
          c.full_name as client_name,
          s.paid_usd,
          s.paid_lbp,
          s.final_amount_usd,
          s.discount_usd,
          s.status,
          (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) as item_count,
          s.created_at
        FROM ${this.tableName} s
        LEFT JOIN clients c ON s.client_id = c.id
        WHERE s.status IN ('completed', 'refunded') AND DATE(s.created_at, 'localtime') = ${dateFunc}
        ORDER BY s.created_at DESC
        LIMIT ?
      `,
        ...(date ? [targetDate, limit] : [limit]),
      );
    } catch (error) {
      throw new DatabaseError("Failed to get recent sales", { cause: error });
    }
  }

  /**
   * Get top selling products
   */
  getTopProducts(limit: number = 5): TopProduct[] {
    try {
      return this.query<TopProduct>(
        `
        SELECT 
          p.name,
          COALESCE(SUM(si.quantity), 0) as total_quantity,
          COALESCE(SUM(si.sold_price_usd * si.quantity), 0) as total_revenue
        FROM sale_items si
        JOIN products p ON si.product_id = p.id
        JOIN ${this.tableName} s ON si.sale_id = s.id
        WHERE s.status = 'completed'
        GROUP BY p.id
        ORDER BY total_quantity DESC
        LIMIT ?
      `,
        limit,
      );
    } catch (error) {
      throw new DatabaseError("Failed to get top products", { cause: error });
    }
  }

  /**
   * Get chart data for last 30 days - Sales or Profit
   */
  getChartData(type: "Sales" | "Profit"): ChartDataPoint[] {
    try {
      // Generate last 30 days
      const datesResult = this.query<DateRow>(`
        WITH RECURSIVE dates(date) AS (
          VALUES(date('now', 'localtime', '-29 days'))
          UNION ALL
          SELECT date(date, '+1 day')
          FROM dates
          WHERE date < date('now', 'localtime')
        )
        SELECT date FROM dates
      `);
      const dates = datesResult.map((r) => r.date);

      if (type === "Sales") {
        const salesData = this.query<{
          date: string;
          daily_usd: number;
          daily_lbp: number;
        }>(
          `
          SELECT 
            DATE(created_at, 'localtime') as date,
            SUM(paid_usd) as daily_usd,
            SUM(paid_lbp) as daily_lbp
          FROM ${this.tableName}
          WHERE status = 'completed' AND DATE(created_at, 'localtime') >= ?
          GROUP BY date
        `,
          dates[0],
        );

        const repaymentData = this.query<{
          date: string;
          daily_usd: number;
          daily_lbp: number;
        }>(
          `
          SELECT 
            DATE(created_at, 'localtime') as date,
            SUM(ABS(amount_usd)) as daily_usd,
            SUM(ABS(amount_lbp)) as daily_lbp
          FROM debt_ledger
          WHERE transaction_type = 'Repayment' AND DATE(created_at, 'localtime') >= ?
          GROUP BY date
        `,
          dates[0],
        );

        const combined = new Map<string, { usd: number; lbp: number }>();
        [...salesData, ...repaymentData].forEach((row) => {
          const entry = combined.get(row.date) || { usd: 0, lbp: 0 };
          entry.usd += row.daily_usd ?? 0;
          entry.lbp += row.daily_lbp ?? 0;
          combined.set(row.date, entry);
        });

        return dates.map((date) => ({
          date,
          usd: combined.get(date)?.usd ?? 0,
          lbp: combined.get(date)?.lbp ?? 0,
        }));
      }

      // Profit data
      const profitData = this.query<ProfitRow>(
        `
        SELECT
          DATE(s.created_at, 'localtime') as profit_date,
          SUM(si.sold_price_usd - si.cost_price_snapshot_usd) as profit
        FROM ${this.tableName} s
        JOIN sale_items si ON s.id = si.sale_id
        WHERE s.status = 'completed' 
          AND si.is_refunded = 0
          AND DATE(s.created_at, 'localtime') >= ?
        GROUP BY profit_date
      `,
        dates[0],
      );

      const profitMap = new Map<string, number>();
      profitData.forEach((row) => profitMap.set(row.profit_date, row.profit));

      return dates.map((date) => ({
        date,
        profit: profitMap.get(date) ?? 0,
      }));
    } catch (error) {
      throw new DatabaseError("Failed to get chart data", { cause: error });
    }
  }

  /**
   * Get sales by date range (completed + refunded, with item count)
   */
  findByDateRange(
    startDate: string,
    endDate: string,
  ): (SaleWithClient & { item_count: number })[] {
    try {
      return this.query<SaleWithClient & { item_count: number }>(
        `
        SELECT s.*, c.full_name as client_name, c.phone_number as client_phone,
               (SELECT COALESCE(SUM(si.quantity), 0) FROM sale_items si WHERE si.sale_id = s.id) as item_count
        FROM ${this.tableName} s
        LEFT JOIN clients c ON s.client_id = c.id
        WHERE DATE(s.created_at) BETWEEN ? AND ?
          AND s.status IN ('completed', 'refunded')
        ORDER BY s.created_at DESC
      `,
        startDate,
        endDate,
      );
    } catch (error) {
      throw new DatabaseError("Failed to find sales by date range", {
        cause: error,
      });
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let salesRepositoryInstance: SalesRepository | null = null;

export function getSalesRepository(): SalesRepository {
  if (!salesRepositoryInstance) {
    salesRepositoryInstance = new SalesRepository();
  }
  return salesRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetSalesRepository(): void {
  salesRepositoryInstance = null;
}
