/**
 * Sales Repository
 *
 * Handles all database operations for sales and sale_items.
 * Extends BaseRepository for standard CRUD operations.
 */

import { BaseRepository } from "./BaseRepository.js";
import {
  DatabaseError,
  NotFoundError,
  BusinessRuleError,
} from "../utils/errors.js";
import { salesLogger } from "../utils/logger.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

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
  edited_by: string | null;
  edited_at: string | null;
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
  type PaymentDirection,
  isDrawerAffectingMethod,
  paymentMethodToDrawerName,
  partitionLegs,
} from "../utils/payments.js";
import { getVoucherRepository } from "./VoucherRepository.js";
import { getDebtService } from "../services/DebtService.js";

// Backward compatible payment method type (DB values)
// NOTE: exported for API typing.
export type { PaymentMethod };
export type PaymentCurrencyCode = string;

export interface PaymentLine {
  method: PaymentMethod;
  currency_code: string;
  amount: number;
  /** Set when method === 'GIFT_CARD' — the voucher code being redeemed. */
  voucher_code?: string;
  /** IN (customer pays, default) or OUT (shop returns change to customer). */
  direction?: PaymentDirection;
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
  transaction_time?: string;
  /**
   * Session-basket deferred payment mode. When true, the sale record + items +
   * stock are created but the customer-cash drawer post, change, gift-card
   * redemption, and per-sale debt are skipped — the basket recorder owns the
   * customer payment and back-fills paid_usd/paid_lbp/exchange_rate_snapshot.
   * Non-session callers leave this falsy → behavior is unchanged.
   */
  deferPayment?: boolean;
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

/**
 * Human-readable "what was sold" label built from a sale's resolved line
 * items, e.g. "2× iPhone Case, 1× Charger". Used on the unified transaction
 * summary and the debt-ledger note so both surface item names instead of a
 * bare sale id/amount (previously "Sale #3: $15" / "Balance from Sale").
 * Caps at 3 items then appends a "+N more" tail (mirrors the truncation
 * convention in the Debts client-history view,
 * frontend/src/features/debts/pages/Debts/index.tsx).
 */
function formatSaleItemsLabel(
  items: { name: string; quantity: number }[],
): string {
  const shown = items
    .slice(0, 3)
    .map((item) => `${item.quantity}× ${item.name}`)
    .join(", ");
  const extra = items.length - 3;
  return extra > 0 ? `${shown} +${extra} more` : shown;
}

/**
 * "discounted 90,000 LBP" tail for the transaction summary and debt note,
 * null when the sale carries no discount. The discount is stored in USD;
 * it is surfaced in the currency the customer paid with — the currency of
 * the first customer-paid (non-OUT) payment row (single payment: that row;
 * split payment: the first row), converted at the sale's exchange rate for
 * LBP. Falls back to USD when nothing was tendered (fully on-account sales
 * or legacy calls without payment rows).
 */
function formatDiscountLabel(sale: SaleRequest): string | null {
  if (!sale.discount || sale.discount <= 0) return null;
  let currency: string | undefined;
  if (sale.payments?.length) {
    currency = sale.payments.find((p) => p.direction !== "OUT")?.currency_code;
  } else if (sale.payment_usd > 0) {
    currency = "USD";
  } else if (sale.payment_lbp > 0) {
    currency = "LBP";
  }
  if (currency === "LBP") {
    const lbp = Math.round(sale.discount * sale.exchange_rate);
    return `discounted ${lbp.toLocaleString()} LBP`;
  }
  return `discounted $${sale.discount.toLocaleString()}`;
}

export class SalesRepository extends BaseRepository<SaleEntity> {
  constructor() {
    super("sales", { softDelete: false });
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return "id, client_id, total_amount_usd, discount_usd, final_amount_usd, paid_usd, paid_lbp, change_given_usd, change_given_lbp, exchange_rate_snapshot, status, note, created_at, drawer_name, edited_by, edited_at";
  }

  // ---------------------------------------------------------------------------
  // Full Transaction Processing
  // ---------------------------------------------------------------------------

  /**
   * Process a complete sale transaction (create/update with items, stock, debt)
   * This wraps all sale operations in a single transaction
   */
  processSale(
    sale: SaleRequest,
    userId: number,
    opts?: { allowOutOfStock?: boolean },
  ): {
    success: boolean;
    id?: number;
    error?: string;
  } {
    const db = this.db;
    const tableName = this.tableName;
    const tenantId = getCurrentTenantId();
    // When the shop allows out-of-stock sales, stock is decremented blindly
    // (may go negative); otherwise the guarded decrement blocks overselling.
    const allowOutOfStock = opts?.allowOutOfStock ?? false;

    try {
      const processTransaction = db.transaction(() => {
        let finalClientId = sale.client_id;
        const status = sale.status || "completed";

        // Auto-create client if name provided but no ID. FIND first (phone,
        // then exact name) — a blind INSERT hit UNIQUE constraints for repeat
        // customers and silently dropped the client association entirely
        // (lira-094 session sweep).
        if (!finalClientId && sale.client_name) {
          try {
            const existing =
              ((sale.client_phone
                ? db
                    .prepare(
                      `SELECT id FROM clients WHERE phone_number = ? AND tenant_id = ? LIMIT 1`,
                    )
                    .get(sale.client_phone, tenantId)
                : undefined) as { id: number } | undefined) ??
              (db
                .prepare(
                  `SELECT id FROM clients WHERE full_name = ? AND tenant_id = ? LIMIT 1`,
                )
                .get(sale.client_name, tenantId) as { id: number } | undefined);
            if (existing) {
              finalClientId = existing.id;
            } else {
              const createClient = db.prepare(`
                INSERT INTO clients (full_name, phone_number, whatsapp_opt_in, tenant_id)
                VALUES (?, ?, 0, ?)
              `);
              const clientResult = createClient.run(
                sale.client_name,
                sale.client_phone || null,
                tenantId,
              );
              finalClientId = clientResult.lastInsertRowid as number;
            }
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
            // OUT legs are returned change, not customer payment.
            if (p.direction === "OUT") continue;
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
            WHERE id = ? AND tenant_id = ?
          `);
          updateStmt.run(
            finalClientId,
            sale.total_amount,
            sale.discount,
            sale.final_amount,
            // Derived totals, NOT the raw legacy fields: paid_usd/paid_lbp mean
            // "actually paid" — the fully-paid profit gate reads them and debt
            // repayment backfills them. The raw client sums include DEBT /
            // on-account / gift-card lines, which made an unpaid on-account
            // sale look fully paid (profit counted early, repayment
            // double-added).
            paymentUsd,
            paymentLbp,
            sale.change_given_usd || 0,
            sale.change_given_lbp || 0,
            sale.exchange_rate,
            sale.drawer_name || "General",
            status,
            sale.note || null,
            saleId,
            tenantId,
          );

          // Clear old items to re-insert new ones
          db.prepare(
            "DELETE FROM sale_items WHERE sale_id = ? AND tenant_id = ?",
          ).run(saleId, tenantId);
        } else {
          // INSERT New Sale
          const saleStmt = db.prepare(`
            INSERT INTO ${tableName} (
              client_id, total_amount_usd, discount_usd, final_amount_usd,
              paid_usd, paid_lbp, change_given_usd, change_given_lbp, exchange_rate_snapshot,
              drawer_name, status, note, created_at, updated_at, tenant_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP), ?)
          `);

          const saleResult = saleStmt.run(
            finalClientId,
            sale.total_amount,
            sale.discount,
            sale.final_amount,
            // Derived totals — see the UPDATE branch note above.
            paymentUsd,
            paymentLbp,
            sale.change_given_usd || 0,
            sale.change_given_lbp || 0,
            sale.exchange_rate,
            sale.drawer_name || "General",
            status,
            sale.note || null,
            sale.transaction_time ?? null,
            sale.transaction_time ?? null,
            tenantId,
          );
          saleId = saleResult.lastInsertRowid as number;
        }

        // Create unified transaction row
        // Calculate profit from items (sold_price - cost_price) × quantity,
        // minus the sale-level discount — the discount comes straight out of
        // the shop's margin (final_amount = total − discount), so gross item
        // margins alone overstate profit on every discounted sale.
        let saleProfitUsd = 0;
        // Resolve each item's product name alongside its cost price (same
        // lookup, one query per item) so the transaction summary, metadata,
        // and debt note can name what was sold instead of a bare sale id.
        const saleItemDetails: { name: string; quantity: number }[] = [];
        for (const item of sale.items) {
          const productRow = db
            .prepare(
              "SELECT name, cost_price_usd FROM products WHERE id = ? AND tenant_id = ?",
            )
            .get(item.product_id, tenantId) as
            | { name?: string; cost_price_usd: number }
            | undefined;
          const costPrice = productRow?.cost_price_usd ?? 0;
          saleProfitUsd += (item.price - costPrice) * item.quantity;
          saleItemDetails.push({
            name: productRow?.name ?? "Unknown Product",
            quantity: item.quantity,
          });
        }
        saleProfitUsd -= sale.discount || 0;
        const itemsLabel = formatSaleItemsLabel(saleItemDetails);
        const discountLabel = formatDiscountLabel(sale);
        const discountTail = discountLabel ? ` (${discountLabel})` : "";
        // One label for the unified transaction summary AND the debt-ledger
        // note — the Debts history and the audit row must read identically.
        const saleLabel = `Sale #${saleId}: ${itemsLabel} — $${sale.final_amount}${discountTail}`;

        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.SALE,
          source_table: "sales",
          source_id: saleId,
          user_id: userId,
          // Unified-row amounts carry the sale's VALUE in its denominated
          // currency (sales are USD-priced), never the tender — the LBP the
          // customer handed over lives in the payment legs below. Stamping
          // payment_lbp here double-counted the sale ($5 + 450,000 LBP) in the
          // audit view and inflated revenue_lbp in profit/session reports.
          amount_usd: sale.final_amount,
          amount_lbp: 0,
          profit_usd: saleProfitUsd,
          exchange_rate: sale.exchange_rate,
          client_id: finalClientId ?? null,
          // Rule 11: keep the walk-in name/phone on the unified row even when
          // no clients row could be resolved (lira-094).
          client_name: sale.client_name ?? null,
          client_phone: sale.client_phone ?? null,
          summary: saleLabel,
          metadata_json: {
            total_amount: sale.total_amount,
            discount: sale.discount,
            final_amount: sale.final_amount,
            status,
            item_count: sale.items.length,
            items: saleItemDetails,
          },
          transaction_time: sale.transaction_time,
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
          `DELETE FROM payments WHERE tenant_id = ? AND transaction_id IN (SELECT id FROM transactions WHERE tenant_id = ? AND source_table = 'sales' AND source_id = ?)`,
        ).run(tenantId, tenantId, saleId);

        const insertPayment = db.prepare(`
          INSERT INTO payments (
            transaction_id, method, drawer_name, currency_code, amount, note, created_by, tenant_id
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?
          )
        `);

        const upsertBalanceDelta = db.prepare(`
          INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET
            balance = drawer_balances.balance + excluded.balance,
            updated_at = CURRENT_TIMESTAMP
        `);

        const createdBy = userId;
        const note = sale.note || null;
        const deferPayment = sale.deferPayment === true;

        // Split customer-paid (IN) legs from shop-returned change (OUT) legs.
        // Deferred (session basket): the basket recorder owns the customer-cash
        // legs, change, gift-card redemption, and debt — skip them all here.
        const { inLegs, outLegs } = partitionLegs(
          deferPayment ? [] : paymentLines,
        );

        for (const p of inLegs) {
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
            tenantId,
          );
          upsertBalanceDelta.run(
            tenantId,
            drawerName,
            p.currency_code,
            p.amount,
          );
        }

        // Redeem any gift-card / voucher legs atomically with the sale. The
        // voucher's full value is deposited to the owner's account; the sale's
        // GIFT_CARD leg is non-drawer, so the unpaid balance becomes a Sale Debt
        // that the deposited credit offsets.
        const voucherRepo = getVoucherRepository();
        for (const p of inLegs) {
          if (p.method !== "GIFT_CARD" || !p.voucher_code) continue;
          voucherRepo.redeemByCode({
            code: p.voucher_code,
            context: "sale",
            transactionId: txnId,
            userId: createdBy,
          });
        }

        // Return (OUT) legs: change handed back via a non-cash method or kept as
        // store credit. Cash change uses the change_given_usd/lbp path below.
        for (const r of outLegs) {
          const amt = Math.abs(r.amount);
          if (amt <= 0) continue;
          if (r.method === "CUSTOMER_ACCOUNT") {
            if (!sale.client_id) {
              throw new Error(
                "Client is required to return change as store credit",
              );
            }
            getDebtService().addCredit({
              clientId: sale.client_id,
              amountUsd: r.currency_code === "USD" ? amt : 0,
              amountLbp: r.currency_code === "LBP" ? amt : 0,
              note: "Change returned",
              userId: createdBy,
            });
          } else if (isDrawerAffectingMethod(r.method)) {
            const drawerName = paymentMethodToDrawerName(r.method);
            insertPayment.run(
              txnId,
              r.method,
              drawerName,
              r.currency_code,
              -amt,
              "Change returned",
              createdBy,
              tenantId,
            );
            upsertBalanceDelta.run(tenantId, drawerName, r.currency_code, -amt);
          }
        }

        const changeUsd = deferPayment
          ? 0
          : Math.abs(sale.change_given_usd || 0);
        const changeLbp = deferPayment
          ? 0
          : Math.abs(sale.change_given_lbp || 0);
        if (changeUsd) {
          insertPayment.run(
            txnId,
            "CASH",
            "General",
            "USD",
            -changeUsd,
            "Change given",
            createdBy,
            tenantId,
          );
          upsertBalanceDelta.run(tenantId, "General", "USD", -changeUsd);
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
            tenantId,
          );
          upsertBalanceDelta.run(tenantId, "General", "LBP", -changeLbp);
        }

        // Process Items & Update Stock
        const itemStmt = db.prepare(`
          INSERT INTO sale_items (
            sale_id, product_id, quantity, sold_price_usd, cost_price_snapshot_usd, imei, tenant_id
          ) VALUES (?, ?, ?, ?, (SELECT cost_price_usd FROM products WHERE id = ? AND tenant_id = ?), ?, ?)
        `);

        const stockStmt = db.prepare(
          allowOutOfStock
            ? `UPDATE products
               SET stock_quantity = stock_quantity - ?
               WHERE id = ? AND tenant_id = ?`
            : `UPDATE products
               SET stock_quantity = stock_quantity - ?
               WHERE id = ? AND tenant_id = ? AND stock_quantity >= ?`,
        );

        for (const item of sale.items) {
          itemStmt.run(
            saleId,
            item.product_id,
            item.quantity,
            item.price,
            item.product_id,
            tenantId,
            item.imei || null,
            tenantId,
          );

          // Update Stock: ONLY IF COMPLETED.
          if (status === "completed") {
            if (allowOutOfStock) {
              // Shop opted into out-of-stock sales: decrement blindly (stock may
              // go negative; the shortfall is surfaced in the Negative-Stock
              // report for reconciliation).
              stockStmt.run(item.quantity, item.product_id, tenantId);
            } else {
              // Guarded conditional write: the `stock_quantity >= ?` clause plus
              // the rows-affected check stop two concurrent sales from
              // overselling the last unit(s) into negative stock. If nothing
              // updated, stock is insufficient (or the product/tenant row is
              // gone) → abort the sale (the surrounding db.transaction
              // auto-rolls-back the whole sale).
              const stockRes = stockStmt.run(
                item.quantity,
                item.product_id,
                tenantId,
                item.quantity,
              );
              if (stockRes.changes === 0) {
                const p = db
                  .prepare(
                    `SELECT name, stock_quantity FROM products WHERE id = ? AND tenant_id = ?`,
                  )
                  .get(item.product_id, tenantId) as
                  | { name?: string; stock_quantity?: number }
                  | undefined;
                throw new BusinessRuleError(
                  `Not enough stock for "${p?.name ?? `product #${item.product_id}`}" (${p?.stock_quantity ?? 0} available)`,
                );
              }
            }
          }
        }

        // Handle Debt (If Partial Payment AND Completed)
        // Deferred (session basket): the basket recorder creates ONE debt entry
        // for the whole basket and back-fills this sale's paid state, so skip the
        // per-sale debt here (it would double-count and mis-attribute).
        if (status === "completed" && !deferPayment) {
          // Use derived payment totals (accounts for new payment lines structure)
          const totalPaidUSD = paymentUsd + paymentLbp / sale.exchange_rate;
          if (sale.final_amount - totalPaidUSD > 0.05) {
            if (!finalClientId) {
              throw new Error("Cannot create debt for anonymous client");
            }
            const debtAmount = sale.final_amount - totalPaidUSD;

            const debtStmt = db.prepare(`
              INSERT INTO debt_ledger (
                client_id, transaction_type, amount_usd, transaction_id, note, due_date, tenant_id
              ) VALUES (?, ?, ?, ?, ?, datetime('now', '+30 days'), ?)
            `);
            // Use txnId (transactions table FK) per unified transaction architecture
            debtStmt.run(
              finalClientId,
              "Sale Debt",
              debtAmount,
              txnId,
              saleLabel,
              tenantId,
            );
          }
        }

        return { success: true, id: saleId };
      });

      // IMMEDIATE: take the write lock at BEGIN so the read-check-write is
      // atomic and a concurrent writer waits (busy_timeout) instead of racing.
      return processTransaction.immediate();
    } catch (error) {
      salesLogger.error({ error, sale }, "Sale transaction failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Back-fill the paid state of a sale that was created with deferPayment.
   *
   * The session-basket recorder calls this AFTER allocating the basket's
   * non-debt payment across the session's goods, so the sale's
   * paid_usd/paid_lbp/exchange_rate_snapshot reflect what the basket actually
   * settled. A fully-covered sale then passes the Profits "paid gate" and
   * realizes profit; an on-account sale stays pending (its debt lives on the
   * single basket debt entry, not here).
   *
   * No drawer movement and no debt entry here — those are owned by the basket
   * recorder. This only updates the sale row's paid columns.
   */
  markSalePaid(
    saleId: number,
    paidUsd: number,
    paidLbp: number,
    exchangeRate: number,
  ): void {
    this.db
      .prepare(
        `UPDATE ${this.tableName}
         SET paid_usd = ?, paid_lbp = ?, exchange_rate_snapshot = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND tenant_id = ?`,
      )
      .run(paidUsd, paidLbp, exchangeRate, saleId, getCurrentTenantId());
  }

  // ---------------------------------------------------------------------------
  // Core Sales Operations
  // ---------------------------------------------------------------------------

  /**
   * Get all draft sales with client info and items
   */
  findDrafts(): DraftSaleWithItems[] {
    try {
      const tenantId = getCurrentTenantId();
      const drafts = this.query<SaleWithClientRow>(
        `
        SELECT s.*, c.full_name as client_name, c.phone_number as client_phone
        FROM ${this.tableName} s
        LEFT JOIN clients c ON s.client_id = c.id AND c.tenant_id = ?
        WHERE s.status = 'draft' AND s.tenant_id = ?
        ORDER BY s.created_at DESC
      `,
        tenantId,
        tenantId,
      );

      return drafts.map((draft) => {
        const items = this.query<SaleItemWithProductRow>(
          `
          SELECT si.*, p.name, p.barcode
          FROM sale_items si
          JOIN products p ON si.product_id = p.id AND p.tenant_id = ?
          WHERE si.sale_id = ? AND si.tenant_id = ?
        `,
          tenantId,
          draft.id,
          tenantId,
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
          drawer_name, status, note, updated_at, tenant_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
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
        getCurrentTenantId(),
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
        WHERE id = ? AND tenant_id = ?
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
        getCurrentTenantId(),
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
      this.execute(
        "DELETE FROM sale_items WHERE sale_id = ? AND tenant_id = ?",
        saleId,
        getCurrentTenantId(),
      );
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
      const tenantId = getCurrentTenantId();
      this.execute(
        "DELETE FROM sale_items WHERE sale_id = ? AND tenant_id = ?",
        saleId,
        tenantId,
      );
      this.execute(
        "DELETE FROM sales WHERE id = ? AND tenant_id = ?",
        saleId,
        tenantId,
      );
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
      const tenantId = getCurrentTenantId();
      this.execute(
        `
        INSERT INTO sale_items (
          sale_id, product_id, quantity, sold_price_usd, cost_price_snapshot_usd, imei, tenant_id
        ) VALUES (?, ?, ?, ?, (SELECT cost_price_usd FROM products WHERE id = ? AND tenant_id = ?), ?, ?)
      `,
        saleId,
        item.product_id,
        item.quantity,
        item.price,
        item.product_id,
        tenantId,
        item.imei || null,
        tenantId,
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
      const tenantId = getCurrentTenantId();
      return this.query<SaleItemWithProduct>(
        `
        SELECT si.*, p.name, p.barcode
        FROM sale_items si
        JOIN products p ON si.product_id = p.id AND p.tenant_id = ?
        WHERE si.sale_id = ? AND si.tenant_id = ?
      `,
        tenantId,
        saleId,
        tenantId,
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
    const tenantId = getCurrentTenantId();

    return this.transaction(() => {
      // 1. Get the sale item
      const item = db
        .prepare(
          `SELECT * FROM sale_items WHERE id = ? AND sale_id = ? AND tenant_id = ?`,
        )
        .get(params.saleItemId, params.saleId, tenantId) as
        | SaleItemEntity
        | undefined;

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
        .prepare(`SELECT * FROM sales WHERE id = ? AND tenant_id = ?`)
        .get(params.saleId, tenantId) as SaleEntity | undefined;

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

      // 4b. Calculate the refunded profit so the REFUND transaction can stamp its
      //     NEGATIVE on transactions.profit_usd. SUM(profit) over a sale's
      //     SALE + REFUND rows then equals the net (post-refund) profit, attributed
      //     at the refund's date (accrual — intended).
      //
      //     The SALE stamps profit = Σ item margins − sale.discount (see
      //     processSale). So the refund of an item must give back its gross
      //     margin MINUS its pro-rata share of that sale-level discount, or a
      //     discounted sale never nets to zero when fully refunded (it would
      //     leave a phantom loss equal to the discount). Pro-rate by the item's
      //     share of the sale's pre-discount total.
      const grossMarginUsd =
        (item.sold_price_usd - item.cost_price_snapshot_usd) *
        params.refundQuantity;
      const saleTotalUsd = sale.total_amount_usd || 0;
      const discountShareUsd =
        saleTotalUsd > 0
          ? (sale.discount_usd || 0) * (refundAmount / saleTotalUsd)
          : 0;
      const refundProfitUsd = grossMarginUsd - discountShareUsd;

      // 5. Get the original SALE transaction
      const originalTxn = db
        .prepare(
          `SELECT id, source_table, source_id, amount_usd, amount_lbp, exchange_rate, client_id, device_id
           FROM transactions
           WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE' AND tenant_id = ?`,
        )
        .get(params.saleId, tenantId) as
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

      // 6. Create REFUND transaction for this item via TransactionRepository
      const txnRepo = getTransactionRepository();
      const refundTxnId = txnRepo.createTransaction({
        type: TRANSACTION_TYPES.REFUND,
        source_table: originalTxn.source_table,
        source_id: originalTxn.source_id,
        user_id: params.userId,
        // Same value-not-tender rule as the SALE stamp: the refund is a USD
        // value; writing its LBP conversion alongside double-counted every
        // refund in currency-split reports.
        amount_usd: -refundAmount,
        amount_lbp: 0,
        profit_usd: -refundProfitUsd,
        profit_lbp: 0,
        exchange_rate: originalTxn.exchange_rate,
        client_id: originalTxn.client_id,
        summary: `ITEM REFUND: ${params.refundQuantity}x product ${item.product_id} from Sale #${params.saleId}`,
        metadata_json: {
          refundType: "item",
          saleItemId: params.saleItemId,
          refundQuantity: params.refundQuantity,
          originalSaleId: params.saleId,
        },
        device_id: originalTxn.device_id ?? undefined,
      });

      // 7. Reverse payments proportionally
      const originalPayments = db
        .prepare(
          `SELECT method, drawer_name, currency_code, amount FROM payments WHERE transaction_id = ? AND tenant_id = ?`,
        )
        .all(originalTxn.id, tenantId) as {
        method: string;
        drawer_name: string;
        currency_code: string;
        amount: number;
      }[];

      const refundRatio = refundAmount / originalTxn.amount_usd;

      const insertPayment = db.prepare(`
        INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, note, created_by, tenant_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const upsertBalance = db.prepare(`
        INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET
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
          tenantId,
        );
        upsertBalance.run(
          tenantId,
          payment.drawer_name,
          payment.currency_code,
          negatedAmount,
        );
      }

      // 8. Update sale_items.refunded_quantity
      db.prepare(
        `UPDATE sale_items SET refunded_quantity = refunded_quantity + ? WHERE id = ? AND tenant_id = ?`,
      ).run(params.refundQuantity, params.saleItemId, tenantId);

      // 9. Restore stock for refunded quantity
      db.prepare(
        `UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ? AND tenant_id = ?`,
      ).run(params.refundQuantity, item.product_id, tenantId);

      // 10. If sale was on debt, cancel proportional debt
      if (originalTxn.client_id) {
        const debts = db
          .prepare(
            `SELECT id, client_id, amount_usd FROM debt_ledger WHERE transaction_id = ? AND transaction_type = 'Sale Debt' AND tenant_id = ?`,
          )
          .all(originalTxn.id, tenantId) as {
          id: number;
          client_id: number;
          amount_usd: number;
        }[];

        const insertReversal = db.prepare(`
          INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, transaction_id, note, created_by, tenant_id)
          VALUES (?, 'Refund Reversal', ?, ?, 'Debt cancelled by item refund', ?, ?)
        `);

        for (const debt of debts) {
          insertReversal.run(
            debt.client_id,
            -(debt.amount_usd * refundRatio),
            refundTxnId,
            params.userId,
            tenantId,
          );
        }
      }

      // 11. Check if ALL items are fully refunded - mark sale as refunded
      const remainingItems = db
        .prepare(
          `SELECT COUNT(*) as count FROM sale_items
           WHERE sale_id = ? AND (quantity - refunded_quantity) > 0 AND tenant_id = ?`,
        )
        .get(params.saleId, tenantId) as { count: number } | undefined;

      if (remainingItems?.count === 0) {
        db.prepare(
          `UPDATE sales SET status = 'refunded' WHERE id = ? AND tenant_id = ?`,
        ).run(params.saleId, tenantId);
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
      const tenantId = getCurrentTenantId();
      // Sales Revenue Today (actual sale value, NOT amount tendered)
      const salesResult = this.queryOne<SumRow>(
        `
        SELECT
          SUM(final_amount_usd) as total_usd,
          SUM(paid_lbp - COALESCE(change_given_lbp, 0)) as total_lbp
        FROM ${this.tableName}
        WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime') AND status = 'completed' AND tenant_id = ?
      `,
        tenantId,
      );

      // Cash Collected from Sales Today (net cash retained = tendered - change)
      const cashFromSalesResult = this.queryOne<SumRow>(
        `
        SELECT
          SUM(paid_usd - COALESCE(change_given_usd, 0)) as total_usd,
          SUM(paid_lbp - COALESCE(change_given_lbp, 0)) as total_lbp
        FROM ${this.tableName}
        WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime') AND status = 'completed' AND tenant_id = ?
      `,
        tenantId,
      );

      // Total Repayments Today
      const repaymentResult = this.queryOne<SumRow>(
        `
        SELECT
          SUM(ABS(amount_usd)) as total_usd,
          SUM(ABS(amount_lbp)) as total_lbp
        FROM debt_ledger
        WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime') AND transaction_type = 'Repayment' AND tenant_id = ?
      `,
        tenantId,
      );

      // Orders Count Today
      const ordersResult = this.queryOne<CountRow>(
        `
        SELECT COUNT(*) as count
        FROM ${this.tableName}
        WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime') AND status = 'completed' AND tenant_id = ?
      `,
        tenantId,
      );

      // Active Clients Count
      const clientsResult = this.queryOne<CountRow>(
        "SELECT COUNT(*) as count FROM clients WHERE tenant_id = ?",
        tenantId,
      );

      // Low Stock Items Count
      const stockResult = this.queryOne<CountRow>(
        `
        SELECT COUNT(*) as count
        FROM products
        WHERE stock_quantity <= min_stock_level AND is_active = 1 AND tenant_id = ?
      `,
        tenantId,
      );

      return {
        // Sales Revenue: actual sale value today (revenue recognition)
        totalSalesUSD: salesResult?.total_usd ?? 0,
        totalSalesLBP: salesResult?.total_lbp ?? 0,
        // Cash Collected: net cash from sales + debt repayments today (cash flow)
        cashCollectedUSD:
          (cashFromSalesResult?.total_usd ?? 0) +
          (repaymentResult?.total_usd ?? 0),
        cashCollectedLBP:
          (cashFromSalesResult?.total_lbp ?? 0) +
          (repaymentResult?.total_lbp ?? 0),
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
      }>(
        `
        SELECT drawer_name, currency_code, balance
        FROM drawer_balances
        WHERE drawer_name IN ('General', 'OMT_System', 'OMT_App', 'Whish_App', 'Whish_System', 'Binance', 'Alfa', 'MTC', 'iPick', 'Katsh')
          AND tenant_id = ?
        ORDER BY drawer_name, currency_code
      `,
        getCurrentTenantId(),
      );

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
      const tenantId = getCurrentTenantId();
      const targetDate = date ? date : "now";
      const dateFunc = date ? "?" : "DATE('now', 'localtime')";

      const queryParams: unknown[] = [tenantId, tenantId];
      if (date) queryParams.push(targetDate);
      queryParams.push(tenantId, limit);

      const result = this.query<RecentSale>(
        `
        SELECT
          s.id,
          c.full_name as client_name,
          s.paid_usd,
          s.paid_lbp,
          s.final_amount_usd,
          s.discount_usd,
          s.status,
          (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id AND si.tenant_id = ?) as item_count,
          s.created_at
        FROM ${this.tableName} s
        LEFT JOIN clients c ON s.client_id = c.id AND c.tenant_id = ?
        WHERE s.status IN ('completed', 'refunded') AND DATE(s.created_at, 'localtime') = ${dateFunc} AND s.tenant_id = ?
        ORDER BY s.created_at DESC
        LIMIT ?
      `,
        ...queryParams,
      );

      return result;
    } catch (error) {
      throw new DatabaseError("Failed to get recent sales", { cause: error });
    }
  }

  /**
   * Get top selling products
   */
  getTopProducts(limit: number = 5): TopProduct[] {
    try {
      const tenantId = getCurrentTenantId();
      return this.query<TopProduct>(
        `
        SELECT
          p.name,
          COALESCE(SUM(si.quantity), 0) as total_quantity,
          COALESCE(SUM(si.sold_price_usd * si.quantity), 0) as total_revenue
        FROM sale_items si
        JOIN products p ON si.product_id = p.id AND p.tenant_id = ?
        JOIN ${this.tableName} s ON si.sale_id = s.id AND s.tenant_id = ?
        WHERE s.status = 'completed' AND si.tenant_id = ?
        GROUP BY p.id
        ORDER BY total_quantity DESC
        LIMIT ?
      `,
        tenantId,
        tenantId,
        tenantId,
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
      const tenantId = getCurrentTenantId();

      if (type === "Sales") {
        // Chart shows USD and LBP transactions from three sources:
        // - Inventory sales (USD only, from sales table)
        // - Mobile recharges (MTC/Alfa, USD or LBP, from recharges table)
        // - Financial services (OMT/WHISH/iPick/Katsh, USD or LBP, from financial_services table)

        // Inventory sales (USD only)
        const salesData = this.query<{
          date: string;
          currency: string;
          daily_amount: number;
        }>(
          `
          SELECT
            DATE(created_at, 'localtime') as date,
            'USD' as currency,
            SUM(final_amount_usd) as daily_amount
          FROM ${this.tableName}
          WHERE status = 'completed' AND DATE(created_at, 'localtime') >= ? AND tenant_id = ?
          GROUP BY date
        `,
          dates[0],
          tenantId,
        );

        // Recharges (MTC/Alfa in USD or LBP)
        const rechargesData = this.query<{
          date: string;
          currency: string;
          daily_amount: number;
        }>(
          `
          SELECT
            DATE(created_at, 'localtime') as date,
            currency_code as currency,
            SUM(price) as daily_amount
          FROM recharges
          WHERE DATE(created_at, 'localtime') >= ? AND tenant_id = ?
          GROUP BY date, currency_code
        `,
          dates[0],
          tenantId,
        );

        // Financial services (OMT/WHISH/iPick/Katsh in USD or LBP)
        const financialData = this.query<{
          date: string;
          currency: string;
          daily_amount: number;
        }>(
          `
          SELECT
            DATE(created_at, 'localtime') as date,
            currency as currency,
            SUM(price) as daily_amount
          FROM financial_services
          WHERE DATE(created_at, 'localtime') >= ? AND tenant_id = ?
          GROUP BY date, currency
        `,
          dates[0],
          tenantId,
        );

        // Combine all sources by date and currency
        const combined = new Map<string, { usd: number; lbp: number }>();
        const allData = [...salesData, ...rechargesData, ...financialData];

        allData.forEach((row) => {
          const entry = combined.get(row.date) || { usd: 0, lbp: 0 };
          if (row.currency === "USD") {
            entry.usd += row.daily_amount ?? 0;
          } else if (row.currency === "LBP") {
            entry.lbp += row.daily_amount ?? 0;
          }
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
        JOIN sale_items si ON s.id = si.sale_id AND si.tenant_id = ?
        WHERE s.status = 'completed'
          AND si.is_refunded = 0
          AND DATE(s.created_at, 'localtime') >= ?
          AND s.tenant_id = ?
        GROUP BY profit_date
      `,
        tenantId,
        dates[0],
        tenantId,
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
      const tenantId = getCurrentTenantId();
      return this.query<SaleWithClient & { item_count: number }>(
        `
        SELECT s.*, c.full_name as client_name, c.phone_number as client_phone,
               (SELECT COALESCE(SUM(si.quantity), 0) FROM sale_items si WHERE si.sale_id = s.id AND si.tenant_id = ?) as item_count
        FROM ${this.tableName} s
        LEFT JOIN clients c ON s.client_id = c.id AND c.tenant_id = ?
        WHERE DATE(s.created_at) BETWEEN ? AND ?
          AND s.status IN ('completed', 'refunded')
          AND s.tenant_id = ?
        ORDER BY s.created_at DESC
      `,
        tenantId,
        tenantId,
        startDate,
        endDate,
        tenantId,
      );
    } catch (error) {
      throw new DatabaseError("Failed to find sales by date range", {
        cause: error,
      });
    }
  }

  /**
   * Update non-financial metadata on a sale record.
   * Only metadata fields are allowed — financial data is immutable.
   */
  updateMetadata(
    id: number,
    data: { note?: string },
    editedBy: string,
  ): SaleEntity | null {
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
        `UPDATE sales SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`,
      )
      .run(...values);

    return this.findById(id);
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
