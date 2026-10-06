/**
 * Sales Repository
 *
 * Handles all database operations for sales and sale_items.
 * Extends BaseRepository for standard CRUD operations.
 */

import type Database from "better-sqlite3";
import { BaseRepository } from "./BaseRepository.js";
import {
  DatabaseError,
  NotFoundError,
  BusinessRuleError,
} from "../utils/errors.js";
import { salesLogger } from "../utils/logger.js";
import { lineGrossMarginUsd } from "../utils/saleMargin.js";
import {
  getTransactionRepository,
  isOverridableLeg,
  overridableNetByCurrency,
  refundLegReversalSign,
  paymentRowsToLegs,
  resolveBookedRate,
  validateRefundLegOverrideAmounts,
  validateRefundUnitExtras,
  type RefundLegOverride,
  type RefundUnitExtra,
  type TransactionPaymentLeg,
} from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import { MOBILE_SERVICE_PROVIDERS_SQL_LIST } from "../constants/mobileServiceProviders.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
// LIRA-237: imported from the LEAF fragment module, not ProfitRepository.js
// directly — ProfitRepository.js imports TransactionRepository.js, which
// imports THIS file, so a direct SalesRepository -> ProfitRepository import
// would close a require cycle (reportingTimeFragments.ts's own doc comment
// has the full chain).
import { isToday, localDayExpr } from "./reportingTimeFragments.js";
import {
  applyDrawerDelta,
  insertPaymentRow,
  bookClientDebtCharge,
  assertPartnerIdRequired,
  assertNoCounterPayment,
  assertNoCustomerAccountLeg,
} from "./moneyPosting.js";

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
  type BaseSystem,
  isDrawerAffectingMethod,
  paymentMethodToDrawerName,
  partitionLegs,
} from "../utils/payments.js";
import {
  PRIMARY_CASH_DRAWER_NAMES,
  primaryCashDrawerName,
} from "../constants/systemFloatDrawers.js";
import { getVoucherRepository } from "./VoucherRepository.js";
import { getDebtService } from "../services/DebtService.js";
import { getPartnerRepository } from "./PartnerRepository.js";
import { getSettingsRepository } from "./SettingsRepository.js";
import {
  getProductUnitRepository,
  type ProductUnitEntity,
} from "./ProductUnitRepository.js";
import { addMonthsIso } from "../utils/dates.js";
import { getStockBatchRepository } from "./StockBatchRepository.js";

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
    /** LIRA-143 phase 4: the specific IN_STOCK `product_units` row being
     *  sold on this line. Optional — a product with no registered units
     *  sells exactly as before; when the product DOES have registered
     *  IN_STOCK units, omitting this on a `completed` sale is rejected (see
     *  `processSale`'s strictness check) rather than silently guessing
     *  which physical unit left the shop. */
    product_unit_id?: number;
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
  /** T3 keep-change: per-currency amounts the shop keeps instead of returning
   *  as change (no OUT legs accompany them). Added to the sale transaction's
   *  profit stamp — the generic full void negates the stamp, so the kept
   *  amounts reverse with it; per-item refunds deliberately keep it (a
   *  partial return does not hand the kept change back). */
  kept_change_usd?: number;
  kept_change_lbp?: number;
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
  /**
   * PFT-R (Partner FOR-Transactions, validated flow catalog): when set
   * together with `partnerMode === "FOR"`, there is NO walk-in customer —
   * no counter cash/wallet payment leg is accepted (rejected), and the FULL
   * `final_amount` books to `partner_ledger` (FOR_POS DEBIT) against this
   * partner instead of a client's `debt_ledger`. Stock decrement and profit
   * stamping stay normal.
   */
  partnerId?: number;
  /** Only "FOR" is valid for POS — the partner analog of CUSTOMER_ACCOUNT. */
  partnerMode?: "FOR";
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
  /**
   * The PRIMARY CASH DRAWER only (exact match on whichever of
   * `OMT_System`/`Whish_System` is primary per `shop_base_system`) —
   * PRIMARY_CASH_DRAWER_PLAN.md §1/§8.1. No longer a `startsWith("OMT")`
   * fold: that used to sum `OMT_System` (now countable physical cash) with
   * `OMT_App` (a wallet balance) into one number, and silently dropped
   * `Whish_System`/`Whish_App` entirely when Whish was primary.
   */
  omtDrawer: DrawerBalance;
  /**
   * Combined app-wallet balance (`OMT_App` + `Whish_App`) — decision #5:
   * app wallets keep their own drawer, never merged into the PCD or
   * General. Kept as its own key instead of folding into `omtDrawer`
   * (PRIMARY_CASH_DRAWER_PLAN.md §1, Phase C/`SalesRepository` note).
   */
  appWalletDrawer: DrawerBalance;
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

/**
 * One dashboard-chart day. The `usd`/`lbp`/`profit` fields are shared by
 * BOTH chart types (`SalesRepository.getChartData("Sales")` and
 * `SalesService.getChartData("Profit", …)`), which is why `lbp` means two
 * different things depending on which series produced the row: for "Sales"
 * it's the day's LBP-denominated sales; for "Profit" (DC-10) it's the day's
 * LBP gross profit — `SalesService.getChartData`'s own doc comment on the
 * "Profit" branch. `profit` is USD-only (Sales' USD figure lives in `usd`).
 */
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

  /**
   * LIRA-143 phase 4 — memoized `product_units` table-existence guard.
   * Every processSale/refundSaleItem read/write against `product_units` is
   * gated behind this so the MANY existing tests that hand-build a sales
   * schema without that table (predating phase 1/migration v157) stay
   * byte-identical. Mirrors `TransactionRepository._productUnitsTableExists`'
   * shape (same `sqlite_master` check), but cached per-instance — this
   * repository is a long-lived singleton and the schema shape never changes
   * once the process is up, so there is no reason to re-query on every sale.
   */
  private _productUnitsTableExistsCache: boolean | null = null;
  private _productUnitsTableExists(): boolean {
    if (this._productUnitsTableExistsCache === null) {
      const row = this.db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'product_units'`,
        )
        .get();
      this._productUnitsTableExistsCache = row !== undefined;
    }
    return this._productUnitsTableExistsCache;
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
        // LIRA-258 / G6: a for-partner sale cannot ride a customer-session
        // basket. Under deferPayment the partner branch below never runs,
        // so the partner would owe nothing. The session UI never produces
        // this (POS "Add to session cart" carries no partner fields and the
        // session checkout has no partner toggle) — refuse it outright.
        if (sale.deferPayment && sale.partnerMode === "FOR") {
          throw new BusinessRuleError(
            "A partner sale can't be added to a customer session basket — complete it from the POS checkout instead.",
          );
        }

        // LIRA-258 / G12: an existing sale id may only be a DRAFT being
        // resaved or completed. Re-running this method on a completed sale
        // used to re-book stock, FIFO, Sale Debt, FOR_POS and credits
        // (only the payment legs were reversed) and delete the sold lines;
        // no real flow needs it (edits go through updateSaleMetadata).
        if (sale.id) {
          const existing = db
            .prepare(`SELECT status FROM sales WHERE id = ? AND tenant_id = ?`)
            .get(sale.id, tenantId) as { status: string } | undefined;
          if (!existing) {
            throw new NotFoundError("sale", sale.id);
          }
          if (existing.status !== "draft") {
            throw new BusinessRuleError(
              `Sale #${sale.id} is already ${existing.status} — it can't be saved or completed again.`,
            );
          }
        }

        let finalClientId = sale.client_id;
        const status = sale.status || "completed";

        // Auto-create client if name provided but no ID. FIND first (phone,
        // then exact name) — a blind INSERT hit UNIQUE constraints for repeat
        // customers and silently dropped the client association entirely
        // (lira-094 session sweep).
        //
        // Session-basket exception: `deferPayment: true` is the session
        // checkout's own marker (stamped on every cart item by
        // `processCartItem`, SessionCheckoutService.ts) — never set by
        // standalone POS. The SESSION already resolved client identity
        // (exact match only, no fuzzy name-match/auto-create — see
        // SessionCheckoutService's client-injection block); a sale routed
        // through a session basket must carry exactly what the session
        // resolved, not re-run this standalone-POS heuristic. Without this
        // gate, a name-only walk-in whose session found no client would
        // create a brand-new client row (or silently attach to an unrelated
        // existing client who happens to share the name) purely because the
        // session's client injection also stamps `client_name` for display.
        if (!sale.deferPayment && !finalClientId && sale.client_name) {
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

        // Seed the unified transaction row's profit stamp. This is only the
        // PROVISIONAL figure — item processing further below (FIFO batch
        // consumption) corrects it with each line's real cost before
        // createTransaction actually writes the row, because this loop runs
        // before any sale_item exists and has no batch to weight against.
        // Calculate profit from items (sold_price - cost_price) × quantity,
        // minus the sale-level discount — the discount comes straight out of
        // the shop's margin (final_amount = total − discount), so gross item
        // margins alone overstate profit on every discounted sale.
        let saleProfitUsd = 0;
        // Resolve each item's product name alongside its cost price (same
        // lookup, one query per item) so the transaction summary, metadata,
        // and debt note can name what was sold instead of a bare sale id.
        // Also grabs `warranty_months` (LIRA-143 phase 4, owner decision #4)
        // in the SAME query — one extra column, not a second per-item
        // lookup — for the warranty stamp below and the unit-strictness
        // error message's product name.
        const saleItemDetails: { name: string; quantity: number }[] = [];
        const productMetaByIndex: {
          name: string;
          warrantyMonths: number | null;
          costPriceUsd: number;
        }[] = [];
        for (const item of sale.items) {
          const productRow = db
            .prepare(
              "SELECT name, cost_price_usd, warranty_months FROM products WHERE id = ? AND tenant_id = ?",
            )
            .get(item.product_id, tenantId) as
            | {
                name?: string;
                cost_price_usd: number;
                warranty_months: number | null;
              }
            | undefined;
          const costPrice = productRow?.cost_price_usd ?? 0;
          saleProfitUsd += lineGrossMarginUsd(
            item.price,
            costPrice,
            item.quantity,
          );
          const name = productRow?.name ?? "Unknown Product";
          saleItemDetails.push({ name, quantity: item.quantity });
          productMetaByIndex.push({
            name,
            warrantyMonths: productRow?.warranty_months ?? null,
            costPriceUsd: costPrice,
          });
        }
        saleProfitUsd -= sale.discount || 0;
        const itemsLabel = formatSaleItemsLabel(saleItemDetails);
        const discountLabel = formatDiscountLabel(sale);
        const discountTail = discountLabel ? ` (${discountLabel})` : "";
        // One label for the unified transaction summary AND the debt-ledger
        // note — the Debts history and the audit row must read identically.
        const saleLabel = `Sale #${saleId}: ${itemsLabel} — $${sale.final_amount}${discountTail}`;

        // Process Items & Update Stock. This now runs BEFORE the unified
        // transaction row is created (below): FIFO consumption inside this
        // block computes each line's REAL cost and must correct
        // saleProfitUsd with it before that stamp is written — see the
        // comment inside the completed-sale FIFO branch for why the early
        // loop above couldn't get this right on its own.
        const itemStmt = db.prepare(`
          INSERT INTO sale_items (
            sale_id, product_id, quantity, sold_price_usd, cost_price_snapshot_usd, imei, warranty_until, tenant_id
          ) VALUES (?, ?, ?, ?, (SELECT cost_price_usd FROM products WHERE id = ? AND tenant_id = ?), ?, ?, ?)
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

        // LIRA-143 phase 4 (owner decision #5 + drift rule #6): unit
        // consumption + the registered-stock strictness check only apply to
        // a COMPLETED sale on a connection that actually has product_units
        // (guards every hand-built test schema predating this phase, and
        // every draft — a draft never moves stock either).
        const productUnitsActive =
          status === "completed" && this._productUnitsTableExists();

        // Adversarial-review finding 1 fix: the strictness exclusion below
        // must be scoped to every unit id referenced ANYWHERE in this
        // request, not just the ones an earlier forEach iteration happened
        // to reach first — otherwise the exact same payload passes or fails
        // depending on cart line order (a plain surplus line placed AHEAD
        // of its sibling unit lines saw an empty exclusion set and was
        // wrongly rejected). Collected in one pass over `sale.items` before
        // any line is processed. A duplicate claim is caught and rejected
        // HERE too — this replaces the old per-line `claimedUnitIds.has(...)`
        // check inside the loop, same message, just detected up front.
        const requestUnitIds = new Set<number>();
        if (productUnitsActive) {
          for (const item of sale.items) {
            if (item.product_unit_id == null) continue;
            if (requestUnitIds.has(item.product_unit_id)) {
              throw new BusinessRuleError(
                `Product unit #${item.product_unit_id} is claimed by more than one line in this sale`,
              );
            }
            requestUnitIds.add(item.product_unit_id);
          }
        }

        const findUnitStmt = productUnitsActive
          ? db.prepare(
              `SELECT id, tenant_id, product_id, imei, status, sale_item_id, is_defective, warranty_override_until, created_at, updated_at
               FROM product_units WHERE id = ? AND tenant_id = ?`,
            )
          : null;

        // The sale-wide business date the warranty clock starts from (owner
        // decision #4): backdated `transaction_time` when set, else "now" —
        // the same convention the sale/transaction rows themselves use.
        const saleDateIso = (
          sale.transaction_time ?? new Date().toISOString()
        ).slice(0, 10);

        sale.items.forEach((item, index) => {
          let imeiToWrite = item.imei || null;
          let matchedUnit: ProductUnitEntity | null = null;

          if (productUnitsActive) {
            if (item.product_unit_id != null) {
              // Duplicate-claim detection now happens up front (see
              // `requestUnitIds` above) — reaching here means this id is
              // unique across the request.
              const unit = findUnitStmt!.get(item.product_unit_id, tenantId) as
                | ProductUnitEntity
                | undefined;
              const productName = productMetaByIndex[index].name;
              if (!unit) {
                throw new BusinessRuleError(
                  `Product unit #${item.product_unit_id} not found`,
                );
              }
              if (unit.status !== "IN_STOCK") {
                throw new BusinessRuleError(
                  `Product unit #${item.product_unit_id} on "${productName}" is not in stock (status: ${unit.status})`,
                );
              }
              if (unit.product_id !== item.product_id) {
                throw new BusinessRuleError(
                  `Product unit #${item.product_unit_id} does not belong to "${productName}"`,
                );
              }
              if (item.quantity !== 1) {
                throw new BusinessRuleError(
                  `"${productName}": unit-tracked lines are one-unit-per-line — sell ${item.quantity} phones as ${item.quantity} separate lines`,
                );
              }
              matchedUnit = unit;
              imeiToWrite = unit.imei;
            } else {
              // Strictness (owner decision #5 + drift rule #6): if this
              // product has any IN_STOCK registered units NOT referenced by
              // ANY line anywhere in this same request (request-scoped, not
              // iteration-order-scoped — adversarial-review finding 1), the
              // operator must identify which unit is being sold — never
              // silently guess. Zero unclaimed registered units (none ever
              // registered, or all referenced by some line in this
              // request) proceeds exactly as today, including surplus
              // unregistered stock (drift).
              const excludeList = [...requestUnitIds];
              const excludeClause =
                excludeList.length > 0
                  ? `AND id NOT IN (${excludeList.map(() => "?").join(", ")})`
                  : "";
              const countRow = db
                .prepare(
                  `SELECT COUNT(*) AS count FROM product_units
                   WHERE tenant_id = ? AND product_id = ? AND status = 'IN_STOCK' ${excludeClause}`,
                )
                .get(tenantId, item.product_id, ...excludeList) as {
                count: number;
              };
              if (countRow.count > 0) {
                const productName = productMetaByIndex[index].name;
                throw new BusinessRuleError(
                  `"${productName}" has ${countRow.count} IMEI-registered unit(s) in stock — identify the unit being sold (scan its IMEI or pick it on the cart line)`,
                );
              }
            }
          }

          // Warranty stamp (owner decision #4): ANY product with
          // warranty_months stamps sale date + months, unit-tracked or not.
          // Only on a completed sale — a draft's date isn't the sale date,
          // and the completed re-submit stamps fresh.
          const warrantyMonths = productMetaByIndex[index].warrantyMonths;
          const warrantyUntil =
            status === "completed" && warrantyMonths
              ? addMonthsIso(saleDateIso, warrantyMonths)
              : null;

          const itemResult = itemStmt.run(
            saleId,
            item.product_id,
            item.quantity,
            item.price,
            item.product_id,
            tenantId,
            imeiToWrite,
            warrantyUntil,
            tenantId,
          );

          if (matchedUnit) {
            getProductUnitRepository().markSold(
              matchedUnit.id,
              Number(itemResult.lastInsertRowid),
            );
          }

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

          // FIFO batch consumption (Supplier Stock Intake, rule: profit
          // never changes — this is the ONLY integration point). This must
          // run AFTER the sale_items INSERT above because `consume()` wants
          // this line's `sale_item_id` to attribute the consumption rows it
          // writes (so a later refund can find and reverse exactly this
          // line's draw-down); it must ALSO run inside this SAME db
          // transaction as the rest of the sale so a genuine DB failure in
          // `consume()` rolls the whole sale back rather than leaving stock
          // decremented with no matching batch draw-down. Only for a
          // COMPLETED sale — a draft moves no stock (guarded above) and
          // must consume no batches either, or a later completion would
          // double-consume. The resulting weighted unit cost OVERWRITES the
          // product's-current-cost_price_usd value the INSERT above
          // stamped via its subquery, replacing it with what this line
          // actually cost based on the batches it was drawn from;
          // uncovered units (legacy stock with no batches, or an
          // allowOutOfStock oversell) fall back to that same
          // current-cost_price_usd value via `fallbackUnitCostUsd`, so
          // behaviour for a product with no batch history is unchanged.
          if (status === "completed") {
            const saleItemId = Number(itemResult.lastInsertRowid);
            const { weightedUnitCostUsd } = getStockBatchRepository().consume(
              item.product_id,
              item.quantity,
              {
                saleItemId,
                reason: "SALE",
                fallbackUnitCostUsd: productMetaByIndex[index].costPriceUsd,
              },
            );
            db.prepare(
              `UPDATE sale_items SET cost_price_snapshot_usd = ? WHERE id = ? AND tenant_id = ?`,
            ).run(weightedUnitCostUsd, saleItemId, tenantId);

            // Correct saleProfitUsd with this line's REAL cost. The early
            // loop above ran before this sale_item existed, so it had no
            // FIFO batch to weight against and could only price this line
            // at the product's CURRENT cost_price_usd — captured as
            // productMetaByIndex[index].costPriceUsd. That figure drifts
            // from what this line actually cost once a later restock moves
            // the product's price. Undo that provisional cost's
            // contribution and replace it with the real FIFO-weighted cost,
            // scaled by this line's own quantity. This must happen here,
            // before createTransaction runs (below) — the stamp has to be
            // right on the first write, or it and sale_items.
            // cost_price_snapshot_usd (just corrected above) permanently
            // disagree, and the Profits page (which reads the transaction
            // stamp) shows the wrong number for a sale that sale_items
            // itself already has right.
            const provisionalCostUsd = productMetaByIndex[index].costPriceUsd;
            saleProfitUsd +=
              (provisionalCostUsd - weightedUnitCostUsd) * item.quantity;
          }
        });

        // LIRA-229: the unified `transactions` money-ledger row — and every
        // payment leg, drawer delta, gift-card redemption, debt charge and
        // partner-ledger entry that follows from it — is written for a sale
        // ONLY when it is `completed`. A draft never reaches this block:
        // the `sales`/`sale_items` write above already carries whatever the
        // draft's current paid_usd/paid_lbp/items are (so resuming a draft
        // restores the checkout form), but NO money moves and NO
        // `transactions` row exists until the sale is completed. Cancelling
        // a draft (`deleteDraft`) therefore has nothing to reverse.
        //
        // Pre-fix, this whole block ran unconditionally on every
        // processSale call — draft autosave, draft resave, AND completion
        // alike — so a sale saved N times before completion ended up with
        // N ACTIVE `type = 'SALE'` rows (no status gate, nothing voiding
        // the earlier ones): every Profits query that doesn't defend
        // against it (unlike refundOriginalJoin's MIN(o.id)) over-counted
        // revenue/profit by up to Nx, and a draft saved on one day and
        // completed on another split its profit across both periods. It
        // also meant the DELETE-then-reinsert of `payments` a few lines
        // below dropped old rows without ever reversing the drawer delta
        // they had applied, so a draft resaved with a $5 pre-payment 3
        // times then completed for $8 credited the drawer
        // $5+$5+$5+$8 instead of $8.
        //
        // The invariant this repairs: a sale has AT MOST ONE ACTIVE,
        // non-reversal SALE transaction row, written exactly once, on
        // completion. Re-completing an already-completed sale (a
        // retry/double-submit) is refused at the top of this method
        // (LIRA-258 / G12), so this block runs at most once per sale.
        if (status === "completed") {
          const txnFields = {
            user_id: userId,
            // Unified-row amounts carry the sale's VALUE in its denominated
            // currency (sales are USD-priced), never the tender — the LBP the
            // customer handed over lives in the payment legs below. Stamping
            // payment_lbp here double-counted the sale ($5 + 450,000 LBP) in the
            // audit view and inflated revenue_lbp in profit/session reports.
            amount_usd: sale.final_amount,
            amount_lbp: 0,
            // Item margins − discount, plus any change the operator kept as
            // profit (T3 keep-change) — stamped per currency at create time so
            // the generic void's stamp negation reverses it symmetrically. By
            // this point saleProfitUsd already carries the FIFO correction
            // applied in the item-processing loop above, so this is the
            // sale's REAL margin, never the early loop's provisional one.
            profit_usd: saleProfitUsd + (sale.kept_change_usd || 0),
            profit_lbp: sale.kept_change_lbp || 0,
            exchange_rate: sale.exchange_rate,
            client_id: finalClientId ?? null,
            // Rule 11: keep the walk-in name/phone on the unified row even when
            // no clients row could be resolved (lira-094). For-partner sales
            // label the row with the partner instead (owner ask: the
            // transactions table shows "<partner> [partner]").
            client_name:
              sale.partnerMode === "FOR" && sale.partnerId
                ? `${getPartnerRepository().getById(sale.partnerId)?.name ?? `#${sale.partnerId}`} [partner]`
                : (sale.client_name ?? null),
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
          };

          const txnId = getTransactionRepository().createTransaction({
            ...txnFields,
            type: TRANSACTION_TYPES.SALE,
            source_table: "sales",
            source_id: saleId,
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
              insertPaymentRow(db, {
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

          const upsertBalanceDelta = {
            run: (
              tenant: number,
              drawerName: string,
              currencyCode: string,
              delta: number,
            ) =>
              applyDrawerDelta(db, {
                drawerName,
                currencyCode,
                delta,
                tenantId: tenant,
              }),
          };

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
              // Throwing variant: a failed credit write must roll the whole
              // sale back, never commit it without the customer's credit
              // (LIRA-258 / G13).
              getDebtService().addCreditOrThrow({
                clientId: sale.client_id,
                amountUsd: r.currency_code === "USD" ? amt : 0,
                amountLbp: r.currency_code === "LBP" ? amt : 0,
                note: "Change returned",
                userId: createdBy,
                transactionId: txnId,
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
              upsertBalanceDelta.run(
                tenantId,
                drawerName,
                r.currency_code,
                -amt,
              );
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

          // Handle Debt (If Partial Payment) — deferred (session basket): the
          // basket recorder creates ONE debt entry for the whole basket and
          // back-fills this sale's paid state, so skip the per-sale debt
          // here (it would double-count and mis-attribute).
          //
          // PFT-R (Partner FOR-Transactions, validated flow catalog — supersedes
          // the PFT-2 "walk-in pays cash, remainder to partner" model): a
          // FOR-partner sale has NO walk-in customer in between. No counter
          // cash/wallet payment is taken at all — the partner owes the FULL
          // sale amount, settled later on the Partners page. Routing is
          // mutually exclusive with client debt_ledger — never both on one
          // transaction.
          if (!deferPayment) {
            const isForPartner = sale.partnerMode === "FOR";

            if (isForPartner) {
              // A CUSTOMER_ACCOUNT leg is the client-debt deferred-payment
              // destination — contradictory with routing the amount to the
              // partner instead. Reject rather than silently pick one.
              assertNoCustomerAccountLeg(
                inLegs.some((p) => p.method === "CUSTOMER_ACCOUNT"),
                "Cannot combine a partner FOR-sale with a CUSTOMER_ACCOUNT payment leg — the remainder can only route to one deferred-payment destination",
              );
              // PFT-R: a partner sale takes no counter payment at all — any
              // customer-paid IN leg (cash, wallet, gift card, ...) means a
              // walk-in customer is in the loop, which contradicts the
              // validated FOR-partner model (full amount, no counter cash).
              // FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §3 slice 2 decision:
              // `legacyPaidBy` deliberately STAYS `undefined` here — unlike
              // Financial Services/Recharge/Custom Services, Sales has no
              // separate legacy METHOD field to wire in. `sale.payment_usd`/
              // `sale.payment_lbp` are legacy AMOUNTS, not a method code
              // ("CUSTOMER_ACCOUNT" cannot appear there), and — the part that
              // matters — they are already structurally absorbed into `inLegs`
              // above (this method's `paymentLines` synthesizes a `"CASH"` leg
              // from them whenever `sale.payments` is empty/absent — see
              // `paymentLines`'s own comment), which is EVERY case that
              // reaches this branch (a non-empty `sale.payments` array takes
              // precedence and makes the legacy amounts inert everywhere in
              // this repo, not just under FOR — that is pre-existing,
              // partner-mode-independent behavior, not a hole this plan
              // opened). So `inLegs.length > 0` above ALREADY reflects a
              // non-zero legacy `payment_usd`/`payment_lbp` and this guard
              // already rejects it — proven by
              // `SalesRepository.forPartnerLegacyAmounts.test.ts`, which pins
              // exactly that combination (no `payments`, non-zero
              // `payment_usd`) as REJECTED on the CURRENT, unmodified code.
              // There is nothing to wire: passing `undefined` here is not a
              // placeholder, it's the correct value — Sales has no legacy
              // field this guard's second parameter is FOR.
              assertNoCounterPayment(inLegs.length > 0, undefined, "sale");
              assertPartnerIdRequired(sale.partnerId);

              // PFT-R: the partner owes the FULL sale amount unconditionally —
              // never a "remainder after cash" figure, and never gated on the
              // sale.final_amount vs. paid-now threshold below (there is no
              // paid-now leg in partner mode). Native to the sale's currency
              // (POS sales are always USD-priced).
              getPartnerRepository().addLedgerEntry({
                partner_id: sale.partnerId as number,
                transaction_type: "FOR_POS",
                reference_table: "sales",
                reference_id: saleId,
                amount: sale.final_amount,
                currency: "USD",
                direction: "DEBIT",
                user_id: createdBy,
                notes: saleLabel,
              });
            } else {
              // Use derived payment totals (accounts for new payment lines structure)
              const totalPaidUSD =
                paymentUsd + paymentLbp / sale.exchange_rate;
              if (sale.final_amount - totalPaidUSD > 0.05) {
                const remainder = sale.final_amount - totalPaidUSD;

                if (!finalClientId) {
                  throw new Error("Cannot create debt for anonymous client");
                }

                // Use txnId (transactions table FK) per unified transaction
                // architecture. amountLbp stays null: the original
                // hand-rolled INSERT here never included that column (POS
                // sales are always USD-priced) — see moneyPosting.ts's
                // bookClientDebtCharge doc for why null reproduces that
                // exactly. createdBy IS the sale's own actor (LIRA-241) —
                // already resolved a few lines above for the partner-ledger
                // branch (`user_id: createdBy`); the original hand-rolled
                // INSERT just never threaded it through, leaving every Sale
                // Debt row unattributed on the Debts page's User column.
                bookClientDebtCharge(db, {
                  clientId: finalClientId,
                  transactionType: "Sale Debt",
                  amountUsd: remainder,
                  amountLbp: null,
                  transactionId: txnId,
                  note: saleLabel,
                  createdBy,
                  tenantId,
                });
              }
            }
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
      // LIRA-229: a draft never writes a `transactions` row (money only
      // posts once, on completion — see the `status === "completed"` gate
      // in processSale), so cancelling one here is a plain delete with
      // nothing to reverse: no payments, no drawer delta, no debt/partner
      // ledger row and no stock movement ever existed for it.
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
   * ONE definition (rule 14) of "this item's fractional share of the sale's
   * PRE-discount total" — used by BOTH the real refund (`refundSaleItem`, to
   * pro-rate profit/tender/debt-cancellation) and the read-only preview
   * (`getItemRefundPreview`, to pre-fill RefundMethodModal with EXACTLY what
   * confirming with no override would do), so the preview can never drift
   * from what the real refund actually applies. See `refundSaleItem`'s
   * inline doc (money contract) for why the denominator is the pre-discount
   * total, not the post-discount final.
   */
  private _computeLineShareOfSale(
    item: Pick<SaleItemEntity, "sold_price_usd">,
    sale: Pick<SaleEntity, "total_amount_usd">,
    refundQuantity: number,
  ): number {
    const refundAmount = item.sold_price_usd * refundQuantity;
    const saleTotalUsd = sale.total_amount_usd || 0;
    return saleTotalUsd > 0 ? refundAmount / saleTotalUsd : 0;
  }

  /**
   * LIRA-231 — POS refund preview for one line item: this item's
   * PROPORTIONAL share of the sale's own customer-facing payment legs (same
   * `TransactionPaymentLeg[]` shape RefundMethodModal already consumes on the
   * Transactions page), scaled by the SAME fraction `refundSaleItem` itself
   * applies (`_computeLineShareOfSale`, rule 14 — never a second formula),
   * plus whether the sale is session-linked (blocks the "Refund item" button
   * too, same detection as `refundSaleItem`'s own guard). Read-only — no
   * write, no transaction.
   *
   * LIRA-232 round-3 adversarial review, finding #1 (BLOCKER) — also carries
   * `sessionId`/`sessionTransactionId` for a session-linked sale, mirroring
   * `TransactionRepository.getSaleRefundPreview`'s own fields (round-2
   * finding #11) via the SAME shared resolver (`getSessionLinkage`, rule 14)
   * so the two previews can never drift. Before this fix, the POS "Refund
   * item" button had no session ids to hand to `refundSessionBasketItem` and
   * every attempt on a session-paid sale failed.
   */
  getItemRefundPreview(params: {
    saleId: number;
    saleItemId: number;
    refundQuantity: number;
  }): {
    legs: TransactionPaymentLeg[];
    sessionLinked: boolean;
    sessionId?: number;
    sessionTransactionId?: number;
    /** LIRA-236 — this sale's own `exchange_rate_snapshot` (source "sale"),
     *  else the day's fallback. */
    bookedRate: number;
    bookedRateSource: "sale" | "transaction" | "fallback";
  } {
    const db = this.db;
    const tenantId = getCurrentTenantId();

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

    const availableToRefund = item.quantity - (item.refunded_quantity ?? 0);
    if (
      params.refundQuantity <= 0 ||
      params.refundQuantity > availableToRefund
    ) {
      throw new DatabaseError(
        `Cannot refund ${params.refundQuantity} - only ${availableToRefund} available (already refunded ${item.refunded_quantity ?? 0})`,
      );
    }

    const sale = db
      .prepare(`SELECT * FROM sales WHERE id = ? AND tenant_id = ?`)
      .get(params.saleId, tenantId) as SaleEntity | undefined;
    if (!sale) {
      throw new NotFoundError("sale", params.saleId);
    }

    const txnRepo = getTransactionRepository();
    const txnId = txnRepo.getActiveSaleTransactionId(params.saleId);
    if (txnId == null) {
      throw new DatabaseError("No SALE transaction found for this sale");
    }

    const lineShareOfSale = this._computeLineShareOfSale(
      item,
      sale,
      params.refundQuantity,
    );
    const linkage = txnRepo.getSessionLinkage(txnId);
    const { bookedRate, bookedRateSource } = resolveBookedRate(
      sale.exchange_rate_snapshot,
      "sale",
    );
    return {
      legs: paymentRowsToLegs(
        txnRepo.getPaymentsByTransactionId(txnId),
        lineShareOfSale,
      ),
      sessionLinked: linkage != null,
      ...(linkage ?? {}),
      bookedRate,
      bookedRateSource,
    };
  }

  /**
   * Refund a specific item from a sale (partial or full quantity)
   * Returns the refund transaction ID
   *
   * LIRA-231: `params.refundLegs` gives this the SAME operator-chosen
   * return-method override contract `TransactionRepository.refundTransaction`
   * uses (LIRA-078) — validated against THIS ITEM's own proportional share of
   * the sale's customer-facing net (`overridableNetByCurrency` +
   * `validateRefundLegOverrideAmounts`, imported from TransactionRepository —
   * rule 14, never a second copy of that predicate). Omitting `refundLegs`
   * reproduces today's exact proportional-mirror reversal, unchanged.
   *
   * A session-basket sale is refused up front, before any row is written —
   * same discipline `_refundTransactionInternal`/`_validateRefundLegOverride`
   * follow for the whole-transaction override — with the owner's POS-specific
   * message (same detection as `TransactionRepository.refundBySaleId`'s
   * identical guard on the whole-sale button — rule 14).
   *
   * 2026-09-26 owner decision: `params.unitExtras` gives the POS "Refund
   * item" button the SAME "Returned phones" per-unit defective/warranty-
   * override flagging the Transactions page's whole-refund flow has always
   * had — validated against THIS ITEM's own linked unit(s) only (never the
   * whole sale's — a sibling line's unit is rejected, see
   * `validateRefundUnitExtras`), BEFORE any row is written, same discipline
   * as `refundLegs` above. Applied via `ProductUnitRepository.markInStock`
   * as the unit(s) flip back to IN_STOCK (see step 9b below).
   */
  refundSaleItem(params: {
    saleId: number;
    saleItemId: number;
    refundQuantity: number;
    userId: number;
    refundLegs?: RefundLegOverride[];
    unitExtras?: RefundUnitExtra[];
    /** LIRA-236 — the cashier-typed exchange rate (LBP per 1 USD), driving
     *  `refundLegs`' value-based validation (cross-currency legs allowed)
     *  and stamped onto the REFUND row's own metadata_json. Omitted:
     *  today's per-currency exact-match behavior, unchanged. */
    exchangeRate?: number;
  }): number {
    const db = this.db;
    const tenantId = getCurrentTenantId();
    const txnRepo = getTransactionRepository();

    // ---- Pre-transaction guards & reads (mirrors _refundTransactionInternal's
    // "validate before this.transaction() opens" discipline — nothing is
    // written by any of the checks below). --------------------------------

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

    // 5. Get the original SALE transaction
    // `amount_usd`/`amount_lbp` are deliberately NOT selected: the SALE row's
    // amount is the POST-discount final, and it was the wrong denominator for
    // this function's pro-rating (see `lineShareOfSale`). Keeping it out of
    // reach is the point — nothing here needs it.
    const originalTxn = db
      .prepare(
        `SELECT id, source_table, source_id, exchange_rate, client_id, device_id
         FROM transactions
         WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE' AND tenant_id = ?`,
      )
      .get(params.saleId, tenantId) as
      | {
          id: number;
          source_table: string;
          source_id: number;
          exchange_rate: number;
          client_id: number | null;
          device_id: string | null;
        }
      | undefined;

    if (!originalTxn) {
      throw new DatabaseError("No SALE transaction found for this sale");
    }

    // LIRA-231 owner decision: a session-basket sale's pooled payment is
    // invisible to a transaction_id-keyed query (payments/debt_ledger keyed
    // by session_id, transaction_id NULL) — block up front, same detection
    // `refundBySaleId` uses for the whole-sale button.
    if (txnRepo.isTransactionSessionLinked(originalTxn.id)) {
      throw new DatabaseError(
        "This sale was paid through a customer session — refund it from the session basket.",
      );
    }

    // ONE pro-rata base for this entire refund (rule 14): the line's share of
    // the sale's PRE-DISCOUNT total. See `_computeLineShareOfSale`'s doc and
    // `discountItemRefundTender.test.ts` for why this is the correct
    // denominator (not `originalTxn.amount_usd`, the POST-discount final).
    const lineShareOfSale = this._computeLineShareOfSale(
      item,
      sale,
      params.refundQuantity,
    );

    // LIRA-231: validate the operator's chosen return legs (if any) against
    // THIS ITEM's proportional share of the sale's customer-facing net,
    // BEFORE any row is written.
    const refundLegs = params.refundLegs;
    let itemNetByCurrency: Record<string, number> | undefined;
    if (refundLegs && refundLegs.length > 0) {
      const originalPaymentRows = txnRepo.getPaymentsByTransactionId(
        originalTxn.id,
      );
      const saleNet = overridableNetByCurrency(originalPaymentRows);
      itemNetByCurrency = {};
      for (const [currency, amount] of Object.entries(saleNet)) {
        itemNetByCurrency[currency] = amount * lineShareOfSale;
      }
      validateRefundLegOverrideAmounts(
        itemNetByCurrency,
        refundLegs,
        params.saleItemId,
        params.exchangeRate,
      );
    }

    // 2026-09-26: validate the operator's chosen unit extras (if any) BEFORE
    // any row is written — every unit_id must belong to THIS ITEM's own
    // linked-unit set, never a sibling line's or another sale's unit
    // (operator error, not data to half-apply — same discipline as
    // `refundLegs` above). A no-op when the `product_units` table doesn't
    // exist on this connection, matching step 9b's own guard below.
    const unitExtras = params.unitExtras;
    if (unitExtras && unitExtras.length > 0 && this._productUnitsTableExists()) {
      const linkedUnitIds = new Set(
        getProductUnitRepository()
          .findBySaleItemIds([params.saleItemId])
          .map((u) => u.id),
      );
      validateRefundUnitExtras(
        linkedUnitIds,
        unitExtras,
        params.saleItemId,
        "sale item",
      );
    }

    return this.transaction(() => {
      // LIRA-232 phase 1 (rule 14): amounts are a pure calculation, shared
      // with `refundSessionBasketItem` via `_computeSaleItemRefundAmounts` —
      // see that method's doc for why the discount pro-ration uses
      // `lineShareOfSale` rather than `originalTxn.amount_usd`.
      const { refundAmount, refundProfitUsd } =
        this._computeSaleItemRefundAmounts(
          item,
          sale,
          lineShareOfSale,
          params.refundQuantity,
        );

      // 6. Create REFUND transaction for this item via TransactionRepository
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
          // LIRA-236, contract item 6 — the rate this refund used (the
          // cashier's typed rate when given, else the sale's own booked
          // rate — see `refundSaleItem`'s doc). F12 (round-3 review): the
          // fallback was missing — this comment claimed it existed, but the
          // code only ever stamped the typed rate, silently omitting the
          // field on every untouched (no-override) refund.
          ...((params.exchangeRate ?? originalTxn.exchange_rate) != null
            ? { exchangeRate: params.exchangeRate ?? originalTxn.exchange_rate }
            : {}),
        },
        device_id: originalTxn.device_id ?? undefined,
      });

      // 7. ITEM side (stock/batches/units/refunded_quantity/own-debt/sale
      // status) — shared with `refundSessionBasketItem` (rule 14), which
      // reuses this EXACT reversal but skips the MONEY side below (a
      // session-linked sale's own `payments` rows are empty — the basket's
      // pooled leg is reversed by the session flow's dedicated account-first
      // + leg logic instead).
      const { restoredUnitIds } = this._applySaleItemReversal({
        saleId: params.saleId,
        saleItemId: params.saleItemId,
        productId: item.product_id,
        refundQuantity: params.refundQuantity,
        userId: params.userId,
        refundTxnId,
        originalSaleTxnId: originalTxn.id,
        clientId: originalTxn.client_id,
        lineShareOfSale,
        unitExtras,
      });

      // LIRA-147 — stamp exactly which product_units this refund flipped
      // IN_STOCK, so `undoSaleItemRefund` can tell "this specific unit is
      // still where the refund left it" from "it moved on" (a count-only
      // check can't distinguish those once a resold unit's `sale_item_id`
      // has been reassigned away from this line by `markSold`). A no-op
      // (empty array) for a non-unit-tracked line, same as every other
      // unit-flip step above.
      if (restoredUnitIds.length > 0) {
        db.prepare(
          `UPDATE transactions SET metadata_json = json_set(metadata_json, '$.restoredUnitIds', json(?)) WHERE id = ? AND tenant_id = ?`,
        ).run(JSON.stringify(restoredUnitIds), refundTxnId, tenantId);
      }

      // 8. MONEY side — reverse this item's proportional share of the sale's
      // OWN payments (or the operator's chosen override). A no-op for a
      // session-linked sale (blocked above before this.transaction() opens)
      // — kept here only for the standalone POS "Refund item" caller.
      this._applySaleItemMoneyBack({
        originalTxnId: originalTxn.id,
        refundTxnId,
        productId: item.product_id,
        refundQuantity: params.refundQuantity,
        lineShareOfSale,
        userId: params.userId,
        refundLegs,
        itemNetByCurrency,
        exchangeRate: params.exchangeRate,
      });

      // 9. COUNTERPARTY side (LIRA-258 / G5 + G21) — this item's share of
      // the partner's FOR_POS charge and of the change kept as store
      // credit. Stamped onto the refund row so `undoSaleItemRefund`
      // re-posts exactly what was written here.
      const { partnerReversals, creditReversalIds } =
        this._applySaleItemCounterpartyShares({
          saleId: params.saleId,
          originalTxnId: originalTxn.id,
          refundTxnId,
          lineShareOfSale,
          userId: params.userId,
        });
      if (partnerReversals.length > 0 || creditReversalIds.length > 0) {
        db.prepare(
          `UPDATE transactions
              SET metadata_json = json_set(COALESCE(metadata_json, '{}'),
                    '$.partnerReversals', json(?),
                    '$.creditReversalIds', json(?))
            WHERE id = ? AND tenant_id = ?`,
        ).run(
          JSON.stringify(partnerReversals),
          JSON.stringify(creditReversalIds),
          refundTxnId,
          tenantId,
        );
      }

      return refundTxnId;
    });
  }

  /**
   * LIRA-258 — the counterparty shares of a standalone per-item refund.
   *
   * G5: a for-partner sale booked its FULL price to the partner as ONE
   * `FOR_POS` DEBIT (`processSale`). Refunding an item writes the item's
   * pro-rata share back in the generic reversal shape
   * (`TransactionRepository._reversePartnerLedger`, rule 14): same
   * `transaction_type` (so the FOR_% balance bucket nets), OPPOSITE
   * direction, same currency. `lineShareOfSale` is the same base the debt
   * and payment arms use, so refunding every line nets the partner to 0.
   *
   * ONE deliberate difference from the generic shape: the row references the
   * REFUND transaction (`reference_table='transactions'`, `reference_id =
   * refundTxnId`), not the sale. Every partner-coverage reader keys on the
   * sale's reference and treats each FOR_% row as an obligation to be
   * covered — the profit gates (`notPartnerPending`, `partnerCoverageRatio`)
   * and the settlement FIFO (`PartnerRepository.applySettlementCoverage`).
   * A partial CREDIT row under the sale's reference would sit uncovered
   * forever and block the sale's profit; under the refund's reference those
   * readers see exactly what they saw before this fix. The whole-sale void
   * (`_reversePartnerLedger`) still finds only the original row, and a
   * refund + undo pair nets to zero on its own. The original is the only
   * FOR_POS DEBIT that references the sale.
   *
   * G21: change kept as store credit is a CREDIT_DEPOSIT linked to the
   * sale's transaction. The money side above hands back the item's share of
   * the gross IN legs, which include that overpayment, so the same share of
   * the credit is cancelled here (both currencies) — otherwise item-by-item
   * refunds pay the overpayment out twice. Voucher deposits are excluded on
   * purpose: the voucher already became account credit when redeemed, and
   * the item's 'Sale Debt' share cancellation (`_applySaleItemReversal`)
   * gives its value back as account credit.
   *
   * Standalone refunds only. A session-linked sale is refused by
   * `refundSaleItem` up front, and the whole-basket path reverses a member's
   * partner/credit rows through the generic and session reversals.
   * Must run inside the caller's db.transaction().
   */
  private _applySaleItemCounterpartyShares(params: {
    saleId: number;
    originalTxnId: number;
    refundTxnId: number;
    lineShareOfSale: number;
    userId: number;
  }): {
    partnerReversals: { partner_id: number; amount: number; currency: string }[];
    creditReversalIds: number[];
  } {
    const db = this.db;
    const tenantId = getCurrentTenantId();
    const partnerReversals: {
      partner_id: number;
      amount: number;
      currency: string;
    }[] = [];
    const creditReversalIds: number[] = [];

    if (this._tableExists("partner_ledger")) {
      const original = db
        .prepare(
          `SELECT partner_id, amount, currency FROM partner_ledger
            WHERE reference_table = 'sales' AND reference_id = ?
              AND transaction_type = 'FOR_POS' AND direction = 'DEBIT'
              AND tenant_id = ?
            ORDER BY id ASC LIMIT 1`,
        )
        .get(params.saleId, tenantId) as
        | { partner_id: number; amount: number; currency: string }
        | undefined;
      const share = original ? original.amount * params.lineShareOfSale : 0;
      if (original && share > 0.000001) {
        getPartnerRepository().addLedgerEntry({
          partner_id: original.partner_id,
          transaction_type: "FOR_POS",
          reference_table: "transactions",
          reference_id: params.refundTxnId,
          amount: share,
          currency: original.currency,
          direction: "CREDIT",
          user_id: params.userId,
          notes: `Item refund (txn #${params.refundTxnId}) — Sale #${params.saleId}`,
        });
        partnerReversals.push({
          partner_id: original.partner_id,
          amount: share,
          currency: original.currency,
        });
      }
    }

    const changeCredits = this._saleChangeCreditRows(params.originalTxnId);
    const insertReversal =
      changeCredits.length > 0
        ? db.prepare(`
      INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, transaction_id, note, created_by, tenant_id)
      VALUES (?, 'Refund Reversal', ?, ?, ?, 'Store credit cancelled by item refund', ?, ?)
    `)
        : null;
    for (const credit of changeCredits) {
      const usd = -(credit.amount_usd || 0) * params.lineShareOfSale;
      const lbp = -(credit.amount_lbp || 0) * params.lineShareOfSale;
      if (Math.abs(usd) < 0.000001 && Math.abs(lbp) < 0.000001) continue;
      const res = insertReversal!.run(
        credit.client_id,
        usd,
        lbp,
        params.refundTxnId,
        params.userId,
        tenantId,
      );
      creditReversalIds.push(Number(res.lastInsertRowid));
    }

    return { partnerReversals, creditReversalIds };
  }

  /**
   * The CREDIT_DEPOSIT rows a completed sale wrote for change kept as store
   * credit — every CREDIT_DEPOSIT linked to the sale's transaction EXCEPT the
   * voucher deposits (`VoucherRepository.redeemByCode`, matched through
   * `vouchers.redeemed_transaction_id` by owner, currency and amount, one row
   * per voucher — never by note text).
   */
  private _saleChangeCreditRows(originalTxnId: number): {
    id: number;
    client_id: number;
    amount_usd: number;
    amount_lbp: number;
  }[] {
    const db = this.db;
    const tenantId = getCurrentTenantId();
    const credits = db
      .prepare(
        `SELECT id, client_id, amount_usd, amount_lbp FROM debt_ledger
          WHERE transaction_id = ? AND transaction_type = 'CREDIT_DEPOSIT' AND tenant_id = ?
          ORDER BY id`,
      )
      .all(originalTxnId, tenantId) as {
      id: number;
      client_id: number;
      amount_usd: number;
      amount_lbp: number;
    }[];
    if (credits.length === 0 || !this._tableExists("vouchers")) return credits;

    const vouchers = db
      .prepare(
        `SELECT client_id, amount, currency_code FROM vouchers
          WHERE redeemed_transaction_id = ? AND tenant_id = ?`,
      )
      .all(originalTxnId, tenantId) as {
      client_id: number;
      amount: number;
      currency_code: string;
    }[];
    const near = (x: number | null, y: number) =>
      Math.abs((x || 0) - y) < 0.005;
    const remaining = [...credits];
    for (const v of vouchers) {
      const isLbp = v.currency_code === "LBP";
      const idx = remaining.findIndex(
        (c) =>
          c.client_id === v.client_id &&
          (isLbp
            ? near(c.amount_lbp, -v.amount) && near(c.amount_usd, 0)
            : near(c.amount_usd, -v.amount) && near(c.amount_lbp, 0)),
      );
      if (idx >= 0) remaining.splice(idx, 1);
    }
    return remaining;
  }

  private _tableExistsCache = new Map<string, boolean>();
  private _tableExists(table: string): boolean {
    let exists = this._tableExistsCache.get(table);
    if (exists === undefined) {
      exists =
        this.db
          .prepare(
            `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
          )
          .get(table) !== undefined;
      this._tableExistsCache.set(table, exists);
    }
    return exists;
  }

  /**
   * LIRA-147 — admin-only "Undo refund" for a STANDALONE per-item refund
   * (`refundSaleItem`'s own REFUND row, `metadata_json.refundType ===
   * "item"`). Deliberately does NOT cover a session-basket item refund
   * (`TransactionRepository.refundSessionBasketItem`,
   * `metadata_json.refundType === "sessionItem"`) — that flow pools money
   * against the session's shared account/legs across potentially several
   * prior item-refund calls, a materially different (and materially
   * riskier to reverse generically) shape; `metadata_json.refundType` check
   * below refuses it outright with a named reason rather than attempting a
   * wrong reversal.
   *
   * Restores exactly what `refundSaleItem` changed, by inverting each row IT
   * wrote (rule 14 — never re-derive the business math a second time):
   *   - `payments` rows the refund posted under its own transaction id are
   *     re-posted on the new UNDO transaction with the NEGATED amount, with
   *     the matching drawer delta — this is an exact inverse regardless of
   *     whether the refund used plain pro-rata legs or an operator override
   *     (LIRA-231 `refundLegs`), since both end up as concrete `payments`
   *     rows either way.
   *   - `debt_ledger` 'Refund Reversal' rows the refund wrote (crediting the
   *     client) are re-posted as 'Sale Debt' rows with the negated (i.e.
   *     positive, re-charging) amount — literally re-establishing the exact
   *     charge the refund cancelled.
   *   - `profit_usd`/`profit_lbp` on the new row are the refund's own stamp
   *     negated (the refund's was already negative, so this is positive —
   *     restoring the sale's original profit; see `PROFIT_TXN_TYPES` in
   *     ProfitRepository.ts, which now includes REFUND_UNDO for exactly
   *     this).
   *   - stock/FIFO batches: `StockBatchRepository.unrestoreForSaleItem`
   *     (the traced inverse of `restoreForSaleItem`; refuses — see its own
   *     doc — if the capacity the refund gave back has since been consumed
   *     by something else, or can't be precisely traced).
   *   - `product_units`: units the refund flipped IN_STOCK are flipped back
   *     SOLD via the SAME `markSold` the original sale used (which already
   *     clears `warranty_override_until` and deliberately keeps
   *     `is_defective` — see that method's own doc) — refused if fewer than
   *     `refundQuantity` of them are still IN_STOCK under this sale_item
   *     (i.e. one was sold again under a DIFFERENT sale since the refund —
   *     `markSold` reassigns `sale_item_id` on resale, so this is a direct,
   *     reliable signal).
   *   - `sale_items.refunded_quantity` decrements by `refundQuantity`, and
   *     `sales.status` flips back from 'refunded' to 'completed' if this
   *     undo leaves any quantity un-refunded again.
   *
   * Idempotency: refuses if an ACTIVE REFUND_UNDO row already references
   * this `refundTransactionId` ("already undone").
   */
  undoSaleItemRefund(params: {
    refundTransactionId: number;
    userId: number;
  }): number {
    const db = this.db;
    const tenantId = getCurrentTenantId();
    const txnRepo = getTransactionRepository();

    // ---- Pre-transaction guards & reads ----------------------------------
    const refundTxn = db
      .prepare(
        `SELECT id, type, status, source_table, source_id, amount_usd,
                profit_usd, exchange_rate, client_id, device_id, metadata_json
         FROM transactions WHERE id = ? AND tenant_id = ?`,
      )
      .get(params.refundTransactionId, tenantId) as
      | {
          id: number;
          type: string;
          status: string;
          source_table: string;
          source_id: number;
          amount_usd: number;
          profit_usd: number | null;
          exchange_rate: number | null;
          client_id: number | null;
          device_id: string | null;
          metadata_json: string | null;
        }
      | undefined;

    if (!refundTxn) {
      throw new NotFoundError("transaction", params.refundTransactionId);
    }
    if (refundTxn.type !== TRANSACTION_TYPES.REFUND) {
      throw new DatabaseError(
        "Undo refund only applies to a REFUND transaction.",
      );
    }
    if (refundTxn.status !== "ACTIVE") {
      throw new DatabaseError("This refund is not active — nothing to undo.");
    }

    let metadata: Record<string, unknown> = {};
    try {
      metadata = refundTxn.metadata_json
        ? (JSON.parse(refundTxn.metadata_json) as Record<string, unknown>)
        : {};
    } catch {
      metadata = {};
    }
    // LIRA-253 — a session-basket item refund (`refundType === "sessionItem"`)
    // dispatches to its own counterpart. One shared entry point
    // (SalesService.undoItemRefund → here) for BOTH shapes, decided
    // server-side from the refund's own metadata — exactly like LIRA-147's
    // own doc already promises ("everything else is read back server-side
    // from that row's own metadata"). No new IPC channel/REST route/schema
    // needed; the dual-transport wiring LIRA-147 already shipped covers
    // this for free.
    if (metadata.refundType === "sessionItem") {
      return txnRepo.undoSessionBasketItemRefund(params);
    }
    if (metadata.refundType !== "item") {
      throw new DatabaseError(
        "Undo refund only applies to a per-item refund made from a sale.",
      );
    }

    const saleItemId = Number(metadata.saleItemId);
    const refundQuantity = Number(metadata.refundQuantity);
    const originalSaleId = Number(metadata.originalSaleId);
    if (!saleItemId || !refundQuantity || !originalSaleId) {
      throw new DatabaseError(
        "This refund's record is missing the detail undo needs (saleItemId/refundQuantity/originalSaleId) — cannot undo it safely.",
      );
    }

    // Already undone? — one ACTIVE REFUND_UNDO row may reference this
    // refund; a second one would double-restore every ledger above.
    const existingUndos = db
      .prepare(
        `SELECT id, metadata_json FROM transactions
         WHERE type = ? AND status = 'ACTIVE' AND tenant_id = ?`,
      )
      .all(TRANSACTION_TYPES.REFUND_UNDO, tenantId) as {
      id: number;
      metadata_json: string | null;
    }[];
    for (const row of existingUndos) {
      try {
        const m = row.metadata_json
          ? (JSON.parse(row.metadata_json) as Record<string, unknown>)
          : {};
        if (Number(m.refundTransactionId) === params.refundTransactionId) {
          throw new DatabaseError("This refund has already been undone.");
        }
      } catch (e) {
        if (e instanceof DatabaseError) throw e;
        // Malformed metadata on an unrelated row — ignore, not this refund.
      }
    }

    const item = db
      .prepare(`SELECT * FROM sale_items WHERE id = ? AND tenant_id = ?`)
      .get(saleItemId, tenantId) as SaleItemEntity | undefined;
    if (!item) {
      throw new NotFoundError("sale_item", saleItemId);
    }
    if ((item.refunded_quantity ?? 0) < refundQuantity) {
      throw new DatabaseError(
        "This item's refunded quantity no longer matches this refund — cannot undo it safely.",
      );
    }

    // Dependent-activity guard: has a refunded unit already been sold again
    // under a DIFFERENT sale? `markSold` REASSIGNS `sale_item_id` to the new
    // sale's line on resale, so a resold unit is no longer findable by the
    // ORIGINAL saleItemId at all — a bare "is anything still linked"
    // count can't tell "never unit-tracked" (0 before, 0 after — fine) from
    // "every returned unit already moved on" (nonzero before, 0 after —
    // must refuse). `restoredUnitIds` (stamped onto the refund's own
    // metadata at refund time, see `refundSaleItem`) resolves this exactly:
    // check each specific unit id the refund itself flipped, by id, not by
    // a count. Falls back to the less precise saleItemId-count heuristic
    // only for a refund made before this stamp existed (no
    // `restoredUnitIds` in its metadata) — still safe-direction (refuses
    // rather than risks a double-restore) even though it can't perfectly
    // distinguish "never tracked" from "all moved on" for legacy data.
    if (this._productUnitsTableExists()) {
      const restoredUnitIdsRaw = metadata.restoredUnitIds;
      if (Array.isArray(restoredUnitIdsRaw) && restoredUnitIdsRaw.length > 0) {
        const placeholders = restoredUnitIdsRaw.map(() => "?").join(",");
        const stillAvailable = db
          .prepare(
            `SELECT COUNT(*) AS cnt FROM product_units
             WHERE id IN (${placeholders}) AND sale_item_id = ? AND status = 'IN_STOCK' AND tenant_id = ?`,
          )
          .get(...restoredUnitIdsRaw, saleItemId, tenantId) as { cnt: number };
        if (stillAvailable.cnt < restoredUnitIdsRaw.length) {
          throw new DatabaseError(
            "This refund can't be undone — one or more of its returned units have already been sold again.",
          );
        }
      } else if (!("restoredUnitIds" in metadata)) {
        const everLinked = db
          .prepare(
            `SELECT COUNT(*) AS cnt FROM product_units
             WHERE sale_item_id = ? AND tenant_id = ?`,
          )
          .get(saleItemId, tenantId) as { cnt: number };
        if (everLinked.cnt > 0) {
          const available = db
            .prepare(
              `SELECT COUNT(*) AS cnt FROM product_units
               WHERE sale_item_id = ? AND status = 'IN_STOCK' AND tenant_id = ?`,
            )
            .get(saleItemId, tenantId) as { cnt: number };
          if (available.cnt < refundQuantity) {
            throw new DatabaseError(
              "This refund can't be undone — one or more of its returned units have already been sold again.",
            );
          }
        }
      }
    }

    // Dependent-activity guard: has the restored stock capacity already been
    // consumed by something else since?
    const stockBatchRepo = getStockBatchRepository();
    if (!stockBatchRepo.canUnrestoreForSaleItem(saleItemId, refundQuantity)) {
      throw new DatabaseError(
        "This refund can't be undone — the stock it restored has already been consumed by other activity since.",
      );
    }

    return this.transaction(() => {
      // 1. Create the REFUND_UNDO transaction — profit/amount are the
      //    refund's own stamp negated (rule 14, see doc above).
      const undoTxnId = txnRepo.createTransaction({
        type: TRANSACTION_TYPES.REFUND_UNDO,
        source_table: refundTxn.source_table,
        source_id: refundTxn.source_id,
        user_id: params.userId,
        amount_usd: -refundTxn.amount_usd,
        amount_lbp: 0,
        profit_usd: refundTxn.profit_usd != null ? -refundTxn.profit_usd : 0,
        profit_lbp: 0,
        exchange_rate: refundTxn.exchange_rate,
        client_id: refundTxn.client_id,
        summary: `UNDO REFUND: ${refundQuantity}x product ${item.product_id} from Sale #${originalSaleId} (undoes refund #${params.refundTransactionId})`,
        metadata_json: {
          undoType: "item",
          refundTransactionId: params.refundTransactionId,
          saleItemId,
          refundQuantity,
          originalSaleId,
        },
        device_id: refundTxn.device_id ?? undefined,
      });

      // 2-4. sale_items.refunded_quantity, products.stock_quantity, FIFO
      // batches, product_units — shared with `undoSessionBasketItemRefund`
      // (LIRA-253, rule 14): see `unapplySaleItemReversal`'s own doc.
      {
        const restoredUnitIdsRaw = metadata.restoredUnitIds;
        this.unapplySaleItemReversal({
          saleItemId,
          refundQuantity,
          restoredUnitIds:
            Array.isArray(restoredUnitIdsRaw) && restoredUnitIdsRaw.length > 0
              ? (restoredUnitIdsRaw as number[])
              : undefined,
        });
      }

      // 5. debt_ledger — re-charge exactly what the refund credited back.
      // LIRA-258 / G21: rows the refund wrote to cancel a share of the
      // change kept as store credit (`creditReversalIds` stamp) are
      // restored as the credit they were — CREDIT_DEPOSIT, both
      // currencies — never as a negative 'Sale Debt'.
      const creditReversalIds = new Set(
        Array.isArray(metadata.creditReversalIds)
          ? (metadata.creditReversalIds as unknown[]).map(Number)
          : [],
      );
      const allReversalRows = db
        .prepare(
          `SELECT id, client_id, amount_usd FROM debt_ledger
           WHERE transaction_id = ? AND transaction_type = 'Refund Reversal' AND tenant_id = ?`,
        )
        .all(params.refundTransactionId, tenantId) as {
        id: number;
        client_id: number;
        amount_usd: number;
      }[];
      const reversalRows = allReversalRows.filter(
        (r) => !creditReversalIds.has(r.id),
      );
      if (creditReversalIds.size > 0) {
        const creditRows = db
          .prepare(
            `SELECT id, client_id, amount_usd, amount_lbp FROM debt_ledger
             WHERE transaction_id = ? AND transaction_type = 'Refund Reversal' AND tenant_id = ?`,
          )
          .all(params.refundTransactionId, tenantId) as {
          id: number;
          client_id: number;
          amount_usd: number | null;
          amount_lbp: number | null;
        }[];
        const insertCredit = db.prepare(`
          INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, amount_lbp, transaction_id, note, created_by, tenant_id)
          VALUES (?, 'CREDIT_DEPOSIT', ?, ?, ?, 'Store credit restored by undo refund', ?, ?)
        `);
        for (const r of creditRows) {
          if (!creditReversalIds.has(r.id)) continue;
          insertCredit.run(
            r.client_id,
            -(r.amount_usd || 0),
            -(r.amount_lbp || 0),
            undoTxnId,
            params.userId,
            tenantId,
          );
        }
      }
      const insertRecharge = db.prepare(`
        INSERT INTO debt_ledger (client_id, transaction_type, amount_usd, transaction_id, note, created_by, tenant_id)
        VALUES (?, 'Sale Debt', ?, ?, 'Debt re-charged by undo refund', ?, ?)
      `);
      for (const r of reversalRows) {
        insertRecharge.run(
          r.client_id,
          -r.amount_usd,
          undoTxnId,
          params.userId,
          tenantId,
        );
      }

      // 6. payments/drawers — exact negated inverse of whatever the refund
      //    itself posted (handles both plain pro-rata legs and an operator
      //    refundLegs override identically — see doc above).
      const refundPayments = db
        .prepare(
          `SELECT method, drawer_name, currency_code, amount, note FROM payments WHERE transaction_id = ? AND tenant_id = ?`,
        )
        .all(params.refundTransactionId, tenantId) as {
        method: string;
        drawer_name: string;
        currency_code: string;
        amount: number;
        note: string | null;
      }[];
      for (const payment of refundPayments) {
        const negatedAmount = -payment.amount;
        insertPaymentRow(db, {
          transactionId: undoTxnId,
          method: payment.method,
          drawerName: payment.drawer_name,
          currencyCode: payment.currency_code,
          amount: negatedAmount,
          note: `Undo refund #${params.refundTransactionId}`,
          createdBy: params.userId,
          tenantId,
        });
        applyDrawerDelta(db, {
          drawerName: payment.drawer_name,
          currencyCode: payment.currency_code,
          delta: negatedAmount,
          tenantId,
        });
      }

      // 6b. partner_ledger — LIRA-258 / G5: re-charge the partner exactly
      //     the FOR_POS share the refund reversed (`partnerReversals`
      //     stamp), same type/currency, direction back to DEBIT, referencing
      //     this UNDO transaction (see `_applySaleItemCounterpartyShares`
      //     for why these rows never reference the sale).
      //     A refund made before this stamp existed reversed nothing, so
      //     there is nothing to re-post.
      if (Array.isArray(metadata.partnerReversals)) {
        for (const raw of metadata.partnerReversals as unknown[]) {
          const pr = raw as {
            partner_id?: unknown;
            amount?: unknown;
            currency?: unknown;
          };
          const amount = Number(pr.amount);
          if (!Number(pr.partner_id) || !(amount > 0)) continue;
          getPartnerRepository().addLedgerEntry({
            partner_id: Number(pr.partner_id),
            transaction_type: "FOR_POS",
            reference_table: "transactions",
            reference_id: undoTxnId,
            amount,
            currency: String(pr.currency ?? "USD"),
            direction: "DEBIT",
            user_id: params.userId,
            notes: `Undo refund #${params.refundTransactionId} — Sale #${originalSaleId}`,
          });
        }
      }

      // 7. sale status — flip back from 'refunded' if this undo leaves
      //    anything un-refunded again.
      const sale = db
        .prepare(`SELECT status FROM sales WHERE id = ? AND tenant_id = ?`)
        .get(originalSaleId, tenantId) as { status: string } | undefined;
      if (sale?.status === "refunded") {
        const remaining = db
          .prepare(
            `SELECT COUNT(*) as count FROM sale_items
             WHERE sale_id = ? AND (quantity - refunded_quantity) > 0 AND tenant_id = ?`,
          )
          .get(originalSaleId, tenantId) as { count: number } | undefined;
        if ((remaining?.count ?? 0) > 0) {
          db.prepare(
            `UPDATE sales SET status = 'completed' WHERE id = ? AND tenant_id = ?`,
          ).run(originalSaleId, tenantId);
        }
      }

      return undoTxnId;
    });
  }

  /**
   * LIRA-232 phase 1 (rule 14): pure calculation of "this refund's amount and
   * profit delta" — no I/O, no writes. Shared by the standalone `refundSaleItem`
   * and `refundSessionBasketItem` so the discount-pro-ration math (see the
   * original inline doc, preserved below) can never drift between the two
   * callers.
   *
   * The SALE stamps profit = Σ item margins − sale.discount (see processSale).
   * So refunding an item must give back its gross margin MINUS its pro-rata
   * share of that sale-level discount, or a discounted sale never nets to
   * zero when fully refunded (it would leave a phantom loss equal to the
   * discount). Pro-rate by the item's share of the sale's PRE-discount total
   * (`lineShareOfSale`, from `_computeLineShareOfSale` — same base the
   * payment/debt arms use).
   */
  private _computeSaleItemRefundAmounts(
    item: Pick<SaleItemEntity, "sold_price_usd" | "cost_price_snapshot_usd">,
    sale: Pick<SaleEntity, "discount_usd">,
    lineShareOfSale: number,
    refundQuantity: number,
  ): { refundAmount: number; refundProfitUsd: number } {
    // Adversarial-review fix (SESSION_ITEM_REFUND_PLAN.md finding #1,
    // BLOCKER): `refundAmount` used to be the GROSS pre-discount line value
    // (`sold_price_usd × qty`), while `refundProfitUsd` below already
    // correctly netted the line's pro-rata discount share. That's the same
    // "A" this file's profit arm nets — reusing `discountShareUsd` (rule 14,
    // not a second copy) closes the same gap `SalesRepository
    // .discountItemRefundTender.test.ts` already proved for the standalone
    // refund's MONEY step (there it flows through `lineShareOfSale` applied
    // to the sale's own payment legs, so it was silently correct by a
    // different path; here `refundAmount` IS "A" that
    // `refundSessionBasketItem` treats as cash-equivalent for account-first
    // + cash-back, so the discount MUST be netted at the source). Measured
    // pre-fix (2x $50 lines, $10 discount, $90 tendered): two item refunds
    // summed to $100 handed back on a $90 tender — see
    // TransactionRepository.refundSessionBasketItem.test.ts's
    // "finding #1" case for the failing-first proof.
    const discountShareUsd = (sale.discount_usd || 0) * lineShareOfSale;
    const refundAmount = item.sold_price_usd * refundQuantity - discountShareUsd;
    const grossMarginUsd = lineGrossMarginUsd(
      item.sold_price_usd,
      item.cost_price_snapshot_usd,
      refundQuantity,
    );
    const refundProfitUsd = grossMarginUsd - discountShareUsd;
    return { refundAmount, refundProfitUsd };
  }

  /**
   * LIRA-232 phase 1 (rule 14) — the ITEM side of a sale-line refund: stock
   * restore, FIFO batch give-back, product-unit flip (with the operator's
   * defective/warranty extras), `sale_items.refunded_quantity`, the item's
   * pro-rata share of any 'Sale Debt' booked against the SALE's own
   * transaction, and marking the sale fully 'refunded' once nothing remains.
   * Deliberately excludes MONEY (the sale's own `payments` reversal) — see
   * `_applySaleItemMoneyBack`. Must run inside the caller's db.transaction();
   * this method opens none of its own. Reused by `refundSaleItem` (standalone
   * POS refund) and `TransactionRepository.refundSessionBasketItem` (session
   * basket item refund) — rule 14, one item-reversal, two money paths.
   */
  private _applySaleItemReversal(params: {
    saleId: number;
    saleItemId: number;
    productId: number;
    refundQuantity: number;
    userId: number;
    /** The (caller-created) REFUND transactions row this reversal's own-debt
     *  cancellation links to via `debt_ledger.transaction_id`. */
    refundTxnId: number;
    /** The member's own unified transaction id — `originalTxn.id` — used to
     *  find any 'Sale Debt' row booked directly against THIS sale (never the
     *  pooled session 'Session Debt', which the session flow cancels itself). */
    originalSaleTxnId: number;
    clientId: number | null;
    lineShareOfSale: number;
    unitExtras?: RefundUnitExtra[];
  }): { restoredUnitIds: number[] } {
    const db = this.db;
    const tenantId = getCurrentTenantId();
    const restoredUnitIds: number[] = [];

    // Update sale_items.refunded_quantity
    db.prepare(
      `UPDATE sale_items SET refunded_quantity = refunded_quantity + ? WHERE id = ? AND tenant_id = ?`,
    ).run(params.refundQuantity, params.saleItemId, tenantId);

    // Restore stock for refunded quantity
    db.prepare(
      `UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ? AND tenant_id = ?`,
    ).run(params.refundQuantity, params.productId, tenantId);

    // Give the refunded units back to the batches they were FIFO-consumed
    // from (newest-consumption-first — see StockBatchRepository
    // .restoreForSaleItem), so `stock_quantity` and batch cover stay in step
    // after an item refund exactly like they do after processSale's
    // consumption.
    getStockBatchRepository().restoreForSaleItem(
      params.saleItemId,
      params.refundQuantity,
    );

    // LIRA-143 phase 4 — flip up to `refundQuantity` SOLD product_units
    // linked to THIS sale_item back to IN_STOCK, applying the operator's
    // is_defective/warranty_override_until extras at the same moment.
    // `markInStock` is idempotent (no-ops a unit that isn't currently SOLD),
    // so re-running this on an already-flipped unit is harmless.
    if (this._productUnitsTableExists()) {
      const productUnitRepo = getProductUnitRepository();
      const linkedUnits = productUnitRepo
        .findBySaleItemIds([params.saleItemId])
        .filter((u) => u.status === "SOLD")
        .sort((a, b) => a.id - b.id)
        .slice(0, params.refundQuantity);
      const extrasByUnitId = new Map<number, RefundUnitExtra>();
      for (const extra of params.unitExtras ?? []) {
        extrasByUnitId.set(extra.unit_id, extra);
      }
      for (const unit of linkedUnits) {
        const extra = extrasByUnitId.get(unit.id);
        productUnitRepo.markInStock(unit.id, {
          isDefective: extra?.is_defective,
          warrantyOverrideUntil: extra?.warranty_override_until,
        });
        restoredUnitIds.push(unit.id);
      }
    }

    // If the sale was on its OWN debt (never the session's pooled debt),
    // cancel this line's proportional share.
    if (params.clientId) {
      const debts = db
        .prepare(
          `SELECT id, client_id, amount_usd FROM debt_ledger WHERE transaction_id = ? AND transaction_type = 'Sale Debt' AND tenant_id = ?`,
        )
        .all(params.originalSaleTxnId, tenantId) as {
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
          -(debt.amount_usd * params.lineShareOfSale),
          params.refundTxnId,
          params.userId,
          tenantId,
        );
      }
    }

    // Check if ALL items are fully refunded - mark sale as refunded
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

    return { restoredUnitIds };
  }

  /**
   * LIRA-232 phase 1 (rule 14) — the MONEY side of a sale-line refund:
   * reverses this item's proportional share of the sale's OWN `payments`
   * rows (or, for the operator's chosen return method(s), replaces the
   * overridable legs entirely — LIRA-231, mirrors
   * `TransactionRepository._reversePayments` exactly, just scaled to this
   * item's share via `lineShareOfSale` instead of 1:1). A session-linked
   * sale has no OWN `payments` rows (its money lives on the basket's pooled
   * leg), so this is a no-op for `refundSessionBasketItem` — which is why
   * that caller never invokes it and routes money back through the
   * session's account-first + leg-override flow instead.
   */
  private _applySaleItemMoneyBack(params: {
    originalTxnId: number;
    refundTxnId: number;
    productId: number;
    refundQuantity: number;
    lineShareOfSale: number;
    userId: number;
    refundLegs?: RefundLegOverride[];
    itemNetByCurrency?: Record<string, number>;
    /** LIRA-236 — see `TransactionRepository._reversePayments`'s identical
     *  param; threaded through to `refundLegReversalSign` (rule 14). */
    exchangeRate?: number;
  }): void {
    const db = this.db;
    const tenantId = getCurrentTenantId();

    const originalPayments = db
      .prepare(
        `SELECT method, drawer_name, currency_code, amount, note FROM payments WHERE transaction_id = ? AND tenant_id = ?`,
      )
      .all(params.originalTxnId, tenantId) as {
      method: string;
      drawer_name: string;
      currency_code: string;
      amount: number;
      note: string | null;
    }[];

    const hasOverride = !!params.refundLegs && params.refundLegs.length > 0;

    // Pro-rate the tender by the SAME base the profit arm uses — see
    // `lineShareOfSale`. Every OTHER (internal bookkeeping) leg still
    // mirrors exactly as before, regardless of the override — only
    // overridable (customer-facing, drawer-affecting) legs are replaced.
    for (const payment of originalPayments) {
      if (hasOverride && isOverridableLeg(payment)) continue;
      const negatedAmount = -(payment.amount * params.lineShareOfSale);
      insertPaymentRow(db, {
        transactionId: params.refundTxnId,
        method: payment.method,
        drawerName: payment.drawer_name,
        currencyCode: payment.currency_code,
        amount: negatedAmount,
        note: `Item refund - ${params.refundQuantity}x product ${params.productId}`,
        createdBy: params.userId,
        tenantId,
      });
      applyDrawerDelta(db, {
        drawerName: payment.drawer_name,
        currencyCode: payment.currency_code,
        delta: negatedAmount,
        tenantId,
      });
    }

    if (hasOverride) {
      // The override leg carries a positive MAGNITUDE only (validated
      // before this.transaction() opened) — the DIRECTION it posts in comes
      // from the SAME `refundLegReversalSign` helper
      // `TransactionRepository._reversePayments` uses (rule 14), fed THIS
      // ITEM's own overridable net (`itemNetByCurrency`) and the cashier's
      // typed rate. Sales are never `financial_services` rows, so there is
      // no primary-cash-drawer routing context to resolve here — plain
      // `paymentMethodToDrawerName` is correct for every POS refund.
      for (const leg of params.refundLegs!) {
        const drawerName = paymentMethodToDrawerName(leg.method);
        const reversalSign = refundLegReversalSign(
          params.itemNetByCurrency ?? {},
          leg.currencyCode,
          params.exchangeRate,
        );
        const signedAmount = reversalSign * leg.amount;
        insertPaymentRow(db, {
          transactionId: params.refundTxnId,
          method: leg.method,
          drawerName,
          currencyCode: leg.currencyCode,
          amount: signedAmount,
          note: "Refund (method override)",
          createdBy: params.userId,
          tenantId,
        });
        applyDrawerDelta(db, {
          drawerName,
          currencyCode: leg.currencyCode,
          delta: signedAmount,
          tenantId,
        });
      }
    }
  }

  /**
   * LIRA-232 phase 1 (rule 14) — pure, read-only sizing for ONE sale line's
   * refund: no writes, no `transactions` row. Used both by
   * `TransactionRepository.getSessionItemRefundPreview` (read-only UI
   * preview) and by `refundSessionBasketItem`'s pre-write sizing pass (it
   * must know the TOTAL amount/profit across every line it will touch
   * BEFORE creating the one aggregate REFUND row that carries that total —
   * see `applySaleItemReversalForSession` for the write half).
   */
  previewSaleItemRefundAmount(params: {
    saleId: number;
    saleItemId: number;
    refundQuantity: number;
  }): {
    refundAmountUsd: number;
    refundProfitUsd: number;
    productId: number;
    clientId: number | null;
    originalSaleTxnId: number;
  } {
    const db = this.db;
    const tenantId = getCurrentTenantId();

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

    const sale = db
      .prepare(`SELECT * FROM sales WHERE id = ? AND tenant_id = ?`)
      .get(params.saleId, tenantId) as SaleEntity | undefined;
    if (!sale) {
      throw new NotFoundError("sale", params.saleId);
    }
    // Round-2 finding #2 (HIGH) — `refundSaleItem` (the standalone POS
    // path) already refuses `sale.status === 'refunded'`; this read-only
    // sizing method — the one `TransactionRepository._planSessionItemRefund`
    // actually calls — did not, so it only ever capped by
    // `refunded_quantity`. That column stays 0 for the WHOLE-basket refund
    // path (`_applyGenericItemReversal` stamps `sales.status = 'refunded'`
    // and blanket `sale_items.is_refunded = 1` without ever touching
    // `refunded_quantity` per line), so a second item-refund attempt on an
    // already whole-refunded sale read a full `quantity` still "available"
    // and succeeded a second time — measured: stock restored twice, two
    // REFUND rows, profit double-negated. See this file's
    // TransactionRepository.refundSessionBasketItem.test.ts "round-2
    // finding #2" test.
    if (sale.status === "refunded") {
      throw new DatabaseError(
        "This sale has already been fully refunded — nothing remains to refund.",
      );
    }

    const originalTxn = db
      .prepare(
        `SELECT id, client_id FROM transactions
         WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE' AND tenant_id = ?`,
      )
      .get(params.saleId, tenantId) as
      | { id: number; client_id: number | null }
      | undefined;
    if (!originalTxn) {
      throw new DatabaseError("No SALE transaction found for this sale");
    }

    const lineShareOfSale = this._computeLineShareOfSale(
      item,
      sale,
      params.refundQuantity,
    );
    const { refundAmount, refundProfitUsd } =
      this._computeSaleItemRefundAmounts(
        item,
        sale,
        lineShareOfSale,
        params.refundQuantity,
      );

    return {
      refundAmountUsd: refundAmount,
      refundProfitUsd,
      productId: item.product_id,
      clientId: originalTxn.client_id,
      originalSaleTxnId: originalTxn.id,
    };
  }

  /**
   * LIRA-232 phase 1 (rule 14) — the WRITE half of
   * `previewSaleItemRefundAmount`: applies the item-side reversal
   * (`_applySaleItemReversal` — stock, batches, units, refunded_quantity,
   * the line's own 'Sale Debt' cancellation, mark-sale-refunded) against a
   * REFUND transaction row the CALLER already created (`refundTxnId`) —
   * `TransactionRepository.refundSessionBasketItem`, which sizes ONE
   * aggregate row from the sum of every line's `previewSaleItemRefundAmount`
   * BEFORE calling this. Deliberately does not create a row and does not
   * touch `payments` — money for a session member goes through the
   * session's own account-first + leg logic (rule 14 — one item reversal,
   * reused by both the standalone `refundSaleItem` and this session path).
   * Must run inside the caller's db.transaction(); opens none of its own.
   */
  applySaleItemReversalForSession(params: {
    saleId: number;
    saleItemId: number;
    refundQuantity: number;
    userId: number;
    refundTxnId: number;
    unitExtras?: RefundUnitExtra[];
  }): { restoredUnitIds: number[] } {
    const db = this.db;
    const tenantId = getCurrentTenantId();

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
    const sale = db
      .prepare(`SELECT * FROM sales WHERE id = ? AND tenant_id = ?`)
      .get(params.saleId, tenantId) as SaleEntity | undefined;
    if (!sale) {
      throw new NotFoundError("sale", params.saleId);
    }
    const originalTxn = db
      .prepare(
        `SELECT id, client_id FROM transactions
         WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE' AND tenant_id = ?`,
      )
      .get(params.saleId, tenantId) as
      | { id: number; client_id: number | null }
      | undefined;
    if (!originalTxn) {
      throw new DatabaseError("No SALE transaction found for this sale");
    }

    if (
      params.unitExtras &&
      params.unitExtras.length > 0 &&
      this._productUnitsTableExists()
    ) {
      const linkedUnitIds = new Set(
        getProductUnitRepository()
          .findBySaleItemIds([params.saleItemId])
          .map((u) => u.id),
      );
      validateRefundUnitExtras(
        linkedUnitIds,
        params.unitExtras,
        params.saleItemId,
        "sale item",
      );
    }

    const lineShareOfSale = this._computeLineShareOfSale(
      item,
      sale,
      params.refundQuantity,
    );

    return this._applySaleItemReversal({
      saleId: params.saleId,
      saleItemId: params.saleItemId,
      productId: item.product_id,
      refundQuantity: params.refundQuantity,
      userId: params.userId,
      refundTxnId: params.refundTxnId,
      originalSaleTxnId: originalTxn.id,
      clientId: originalTxn.client_id,
      lineShareOfSale,
      unitExtras: params.unitExtras,
    });
  }

  /**
   * LIRA-253 (rule 14) — the item-side INVERSE of `_applySaleItemReversal`/
   * `applySaleItemReversalForSession`: restores `sale_items.refunded_quantity`,
   * `products.stock_quantity`, FIFO batch capacity, and flips any specific
   * `product_units` this refund restored back to SOLD under the same
   * sale_item — byte-identical to the item-side steps of `undoSaleItemRefund`
   * (steps 2-4 there), factored out so BOTH the standalone per-item undo and
   * `TransactionRepository.undoSessionBasketItemRefund` (session-basket item
   * refund undo) share ONE reversal routine instead of two copies drifting.
   * Must run inside the caller's db.transaction(); opens none of its own.
   */
  unapplySaleItemReversal(params: {
    saleItemId: number;
    refundQuantity: number;
    /** The refund's own `restoredUnitIds` stamp (preferred, exact) — when
     *  omitted/empty, falls back to the lowest-id-first IN_STOCK heuristic,
     *  same as `undoSaleItemRefund`'s own legacy fallback. */
    restoredUnitIds?: number[];
  }): void {
    const db = this.db;
    const tenantId = getCurrentTenantId();

    const item = db
      .prepare(`SELECT * FROM sale_items WHERE id = ? AND tenant_id = ?`)
      .get(params.saleItemId, tenantId) as SaleItemEntity | undefined;
    if (!item) {
      throw new NotFoundError("sale_item", params.saleItemId);
    }

    db.prepare(
      `UPDATE sale_items SET refunded_quantity = refunded_quantity - ? WHERE id = ? AND tenant_id = ?`,
    ).run(params.refundQuantity, params.saleItemId, tenantId);
    db.prepare(
      `UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND tenant_id = ?`,
    ).run(params.refundQuantity, item.product_id, tenantId);

    getStockBatchRepository().unrestoreForSaleItem(
      params.saleItemId,
      params.refundQuantity,
    );

    if (this._productUnitsTableExists()) {
      const productUnitRepo = getProductUnitRepository();
      const restoredUnitIdsRaw = params.restoredUnitIds ?? [];
      const targetUnits =
        restoredUnitIdsRaw.length > 0
          ? productUnitRepo
              .findBySaleItemIds([params.saleItemId])
              .filter(
                (u) => u.status === "IN_STOCK" && restoredUnitIdsRaw.includes(u.id),
              )
          : productUnitRepo
              .findBySaleItemIds([params.saleItemId])
              .filter((u) => u.status === "IN_STOCK")
              .sort((a, b) => a.id - b.id)
              .slice(0, params.refundQuantity);
      for (const unit of targetUnits) {
        productUnitRepo.markSold(unit.id, params.saleItemId);
      }
    }
  }

  /**
   * LIRA-231 — POS refund preview for the WHOLE sale: thin delegation to
   * `TransactionRepository.getSaleRefundPreview` (rule 13 — SalesService only
   * depends on `salesRepo`, so this keeps that single-dependency shape
   * instead of the service reaching into a second repository directly).
   */
  getSaleRefundPreview(saleId: number): {
    legs: TransactionPaymentLeg[];
    sessionLinked: boolean;
    sessionId?: number;
    sessionTransactionId?: number;
  } {
    return getTransactionRepository().getSaleRefundPreview(saleId);
  }

  /**
   * Round-2 finding #3 (HIGH) — routes a MULTI-LINE refund's shared
   * `unitExtras` array to the line each `unit_id` is actually linked to.
   * `refundSessionBasketItem`'s Q2 branch ("saleItemId omitted → every
   * remaining line") used to pass the WHOLE array to EVERY line's
   * `applySaleItemReversalForSession`, whose own `validateRefundUnitExtras`
   * call is scoped to THAT line's own linked units only (by design — a
   * sibling line's unit must never be silently accepted). The result: a
   * unit linked to line A, passed alongside a refund of lines A and B, got
   * rejected the moment line B's own (unrelated) validation ran against it
   * — measured: "product unit #1 is not linked to sale item #2" on a
   * phone+charger refund where the charger has no linked units at all.
   *
   * ONE query (rule 14) resolves every given line's linked units at once,
   * then groups `unitExtras` by the line each `unit_id` actually belongs
   * to. A `unit_id` linked to NONE of the given lines is refused up front
   * — operator error, not data to half-apply (same discipline as
   * `validateRefundUnitExtras` itself).
   */
  routeUnitExtrasByLine(
    saleItemIds: number[],
    unitExtras: RefundUnitExtra[],
  ): Map<number, RefundUnitExtra[]> {
    const byLine = new Map<number, RefundUnitExtra[]>();
    if (unitExtras.length === 0) return byLine;
    const units = getProductUnitRepository().findBySaleItemIds(saleItemIds);
    const lineByUnitId = new Map<number, number>();
    for (const u of units) {
      if (u.sale_item_id != null) lineByUnitId.set(u.id, u.sale_item_id);
    }
    for (const extra of unitExtras) {
      const lineId = lineByUnitId.get(extra.unit_id);
      if (lineId == null) {
        throw new DatabaseError(
          `Refund unit extras: product unit #${extra.unit_id} is not linked to any of the refunded sale items`,
        );
      }
      const arr = byLine.get(lineId) ?? [];
      arr.push(extra);
      byLine.set(lineId, arr);
    }
    return byLine;
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
        WHERE ${isToday("created_at")} AND status = 'completed' AND tenant_id = ?
      `,
        tenantId,
      );

      // Cash Collected from Sales Today (net cash retained = tendered - change).
      //
      // LIRA-244 fix: sourced from the sale's OWN `payments` rows (drawer-
      // affecting legs only, posted once at sale creation and NEVER touched
      // again) instead of `sales.paid_usd`/`change_given_*`. Those two
      // columns look immutable but are NOT: `DebtRepository.addRepayment` →
      // `_markSalesPaidFIFO` does `UPDATE sales SET paid_usd = paid_usd + ?`
      // on this same row whenever the client later pays off the sale's
      // debt — with no record of when. `payments` rows are immutable audit
      // trail (a repayment posts against ITS OWN transaction, never the
      // original sale's), so summing them instead structurally cannot
      // double-count a repayment (`repaymentResult` below covers it once).
      //
      // Round-2 fix (coordinator correction, 2026-09-28) — a regression the
      // FIRST LIRA-244 follow-up (same day) introduced: this query used to
      // join `sales` and filter `isToday(s.created_at) AND s.status =
      // 'completed'`, bucketing every leg by the SALE's own creation day
      // and hiding it entirely once every item was refunded (status flips
      // to 'refunded'). That happened to net to the right answer for a
      // NON-session sale refunded the SAME day (both the original IN leg
      // and the refund's OUT leg live on transactions tied to this same
      // sale, so excluding both together still nets to 0) — but it broke
      // the moment `cashFromSessionsResult` below started counting a
      // session's pooled IN leg unconditionally (no link to `sales.status`
      // at all): a session sale fully refunded the same day showed its
      // cash IN but not the refund's cash OUT, overstating the total. It
      // was also wrong for ANY cross-day case even before that: a sale
      // refunded on a LATER day than it was created had its refund's real,
      // same-day cash outflow attributed to the (non-"today") sale day
      // instead, silently invisible.
      //
      // Fix: bucket by the PAYMENT LEG's own `created_at`
      // (`isToday('p.created_at')`, rule 27) and drop the `sales`
      // join/status filter entirely — every leg tied to a `source_table =
      // 'sales'` transaction (the original SALE, a later REFUND, or a
      // VOID's reversal — `_voidTransactionInternal`/`_createRefundRow`
      // both copy `source_table`/`source_id` from the original) counts on
      // the day it actually posted, matching `cashFromSessionsResult`'s
      // (already leg-day-scoped, already status-blind) design — one rule
      // (rule 14) applied the same way to both sale-linked and
      // session-pooled legs. Proven against the full matrix (every IN/OUT
      // shape, same-day and cross-day) in
      // `SalesRepository.dashboardCashCollected.matrix.test.ts`.
      const cashFromSalesResult = this.queryOne<SumRow>(
        `
        SELECT
          COALESCE(SUM(CASE WHEN p.currency_code = 'USD' THEN p.amount ELSE 0 END), 0) as total_usd,
          COALESCE(SUM(CASE WHEN p.currency_code = 'LBP' THEN p.amount ELSE 0 END), 0) as total_lbp
        FROM payments p
        JOIN transactions t ON t.id = p.transaction_id AND t.tenant_id = p.tenant_id
        WHERE t.source_table = 'sales' AND ${isToday("p.created_at")} AND p.tenant_id = ?
      `,
        tenantId,
      );

      // Cash Collected from SESSION-BASKET checkouts today (LIRA-244
      // follow-up).
      //
      // `cashFromSalesResult` above can only ever match a `payments` row
      // whose `transaction_id` points at a transaction — a session-basket
      // sale (`deferPayment: true`, `SalesRepository.processSale`) writes
      // NO such row: `partitionLegs(deferPayment ? [] : paymentLines)`
      // empties both leg arrays, so the sale's own transaction gets no
      // `payments` row at all. The cash the customer actually paid is
      // instead posted ONCE, pooled, by
      // `SessionPaymentService.recordBasketPayment` →
      // `SessionPaymentRepository.insertSessionLeg`, whose own doc comment
      // states the convention: "`transaction_id` is left NULL — a payment
      // row belongs to EITHER a transaction OR a session basket, never
      // both." That NULL is exactly why `cashFromSalesResult`'s INNER JOIN
      // can never see it, regardless of what the basket contained — so a
      // session checkout's cash silently dropped out of this stat entirely
      // (not just for sales: a recharge/service/loto item paid the same way
      // has the identical gap).
      //
      // `insertSessionLeg` is called ONLY for drawer-affecting cash/wallet
      // legs (CASH, wallet methods) — CUSTOMER_ACCOUNT/GIFT_CARD legs never
      // reach it (they book to `debt_ledger`/a voucher redemption instead,
      // `SessionPaymentService.recordBasketPayment`'s non-drawer branch),
      // so every row this query sums is real drawer movement, never debt.
      // `transaction_id IS NULL` also makes this query's rows structurally
      // disjoint from `cashFromSalesResult`'s (which requires a non-NULL
      // match) — summing both can never double-count the same leg. Scoped
      // by the leg's OWN `created_at` (the moment cash was actually taken
      // at checkout, rule 27) rather than any linked sale's creation day —
      // the two can differ when a session stays open across a day
      // boundary, and it's the drawer-movement day that this stat means to
      // reconcile against.
      const cashFromSessionsResult = this.queryOne<SumRow>(
        `
        SELECT
          COALESCE(SUM(CASE WHEN p.currency_code = 'USD' THEN p.amount ELSE 0 END), 0) as total_usd,
          COALESCE(SUM(CASE WHEN p.currency_code = 'LBP' THEN p.amount ELSE 0 END), 0) as total_lbp
        FROM payments p
        WHERE p.transaction_id IS NULL AND p.session_id IS NOT NULL
          AND ${isToday("p.created_at")} AND p.tenant_id = ?
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
        WHERE ${isToday("created_at")} AND transaction_type = 'Repayment' AND tenant_id = ?
      `,
        tenantId,
      );

      // Orders Count Today
      const ordersResult = this.queryOne<CountRow>(
        `
        SELECT COUNT(*) as count
        FROM ${this.tableName}
        WHERE ${isToday("created_at")} AND status = 'completed' AND tenant_id = ?
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
        // Cash Collected: net cash from plain sales + session-basket
        // checkouts + debt repayments today (cash flow) — see
        // `cashFromSessionsResult`'s doc comment for why a session checkout
        // needs its own disjoint query rather than folding into
        // `cashFromSalesResult`.
        cashCollectedUSD:
          (cashFromSalesResult?.total_usd ?? 0) +
          (cashFromSessionsResult?.total_usd ?? 0) +
          (repaymentResult?.total_usd ?? 0),
        cashCollectedLBP:
          (cashFromSalesResult?.total_lbp ?? 0) +
          (cashFromSessionsResult?.total_lbp ?? 0) +
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
      const tenantId = getCurrentTenantId();

      // PRIMARY_CASH_DRAWER_PLAN.md §1/§8.1: the dashboard's "omt" figure
      // must be the ACTIVE primary cash drawer only — whichever of
      // OMT_System/Whish_System is primary per `shop_base_system` — never
      // both drawers summed together (the old `startsWith("OMT")` fold did
      // that, and it also silently dropped Whish_System/Whish_App whenever
      // Whish was primary). Defaults to OMT the same way
      // FinancialServiceRepository's inline read does: `system_settings` may
      // be absent in minimal/test schemas.
      let baseSystem: BaseSystem = "OMT";
      try {
        const value =
          getSettingsRepository().getSettingValue("shop_base_system");
        if (value === "WHISH") baseSystem = "WHISH";
      } catch {
        // system_settings may be absent in minimal/test schemas — default to OMT.
      }
      const pcd = primaryCashDrawerName(baseSystem);

      // Explicit, tenant-scoped drawer allow-list. Kept as a static list
      // (rather than deriving it from `currency_drawers`/`modules` via a
      // join) so the WHERE clause binds directly against the table's
      // `(tenant_id, drawer_name, currency_code)` primary key with plain
      // parameters — no join, no extra index needed — and so the dashboard's
      // curated drawer set stays explicit and reviewable here. The PCD pair
      // is spread from the shared constant instead of re-typed as literals,
      // so this list can never drift from `resolveServiceCashDrawer`'s own
      // source of truth.
      const drawerNames: readonly string[] = [
        "General",
        ...PRIMARY_CASH_DRAWER_NAMES, // OMT_System, Whish_System
        "OMT_App",
        "Whish_App",
        "Binance",
        "Alfa",
        "MTC",
        "iPick",
        "Katsh",
      ];
      const placeholders = drawerNames.map(() => "?").join(", ");

      // Read from drawer_balances table (running totals)
      const balances = this.query<{
        drawer_name: string;
        currency_code: string;
        balance: number;
      }>(
        `
        SELECT drawer_name, currency_code, balance
        FROM drawer_balances
        WHERE drawer_name IN (${placeholders})
          AND tenant_id = ?
        ORDER BY drawer_name, currency_code
      `,
        ...drawerNames,
        tenantId,
      );

      // Transform to DrawerBalances format
      const result: DrawerBalances = {
        generalDrawer: { usd: 0, lbp: 0 },
        omtDrawer: { usd: 0, lbp: 0 },
        appWalletDrawer: { usd: 0, lbp: 0 },
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
        // The ACTIVE primary cash drawer only — exact match, no fold. The
        // dormant secondary system's drawer (e.g. Whish_System while OMT is
        // primary) is deliberately excluded, not summed in (plan §1's
        // per-case table only ever routes cash to the ONE active PCD).
        else if (row.drawer_name === pcd) {
          if (row.currency_code === "USD") {
            result.omtDrawer.usd = row.balance;
          } else if (row.currency_code === "LBP") {
            result.omtDrawer.lbp = row.balance;
          }
        }
        // Combined app-wallet balance (OMT_App + Whish_App) — decision #5:
        // app wallets keep their own drawer, never merged into the PCD or
        // General, so this is its own key rather than folded into omtDrawer.
        else if (
          row.drawer_name === "OMT_App" ||
          row.drawer_name === "Whish_App"
        ) {
          if (row.currency_code === "USD") {
            result.appWalletDrawer.usd += row.balance;
          } else if (row.currency_code === "LBP") {
            result.appWalletDrawer.lbp += row.balance;
          }
        }
        // Other drawers (Binance, Alfa, MTC, iPick, Katsh) intentionally
        // excluded from this summary, as before.
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
      const dateFunc = date ? "?" : localDayExpr("'now'");

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
        WHERE s.status IN ('completed', 'refunded') AND ${localDayExpr("s.created_at")} = ${dateFunc} AND s.tenant_id = ?
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
   * Get dashboard chart data for the rolling past 30 days — "Sales" ONLY.
   *
   * DC-10 (OWNER_NOTES_2026-09-21.md §7.2) moved the "Profit" series OUT of
   * this repository entirely: it used to run its own per-unit
   * `SUM(si.sold_price_usd - si.cost_price_snapshot_usd)` query here — never
   * × quantity, no discount, no partial refund, no non-product module, no
   * LBP — a SECOND, divergent profit definition from the Profits page's own
   * By Date figures (rule 14). `SalesService.getChartData` now composes the
   * Profit series in the SERVICE layer from `ProfitService.getByDate`
   * instead (rule 13 — no re-texted profit SQL in a repository). This
   * method keeps only the "Sales" (product & telecom) series, which DC-1..
   * DC-4 already fixed and which is unaffected by DC-10.
   *
   * Owner decisions (OWNER_NOTES_2026-09-21.md §7, 2026-09-24):
   *  1. "Sales" = PRODUCT AND TELECOM SALES ONLY (DC-1..DC-4 below), never
   *     all revenue.
   *  2. The series covers the rolling past 30 days (today inclusive).
   *
   * `endDay` is the SAME client calendar day (`YYYY-MM-DD`) the "Profit"
   * series windows on (`SalesService.getChartData`, DC-10, rule 27) — that
   * service method resolves it ONCE (`endDay ?? clientDay()`) and passes the
   * identical value to both series, so this repository never resolves a
   * second, independent "today" via SQLite `date('now','localtime')`. On
   * web, between 00:00 and 03:00 Beirut, the server's own `'now'` is still
   * the PREVIOUS Beirut day — binding it here (rather than letting SQLite
   * compute it) is what keeps the Sales and Profit series covering the same
   * 30 calendar days.
   */
  getChartData(type: "Sales", endDay: string): ChartDataPoint[] {
    try {
      // Generate the 30 days ending on `endDay` (inclusive).
      const datesResult = this.query<DateRow>(
        `
        WITH RECURSIVE dates(date) AS (
          VALUES(date(?, '-29 days'))
          UNION ALL
          SELECT date(date, '+1 day')
          FROM dates
          WHERE date < date(?)
        )
        SELECT date FROM dates
      `,
        endDay,
        endDay,
      );
      const dates = datesResult.map((r) => r.date);
      const tenantId = getCurrentTenantId();

      if (type === "Sales") {
        // "Product & telecom sales" (DC-4, OWNER_NOTES_2026-09-21.md §7.1,
        // owner decision 2026-09-24: "Sales" = product + telecom sales only,
        // never all revenue). Three sources, each excluding voided/refunded
        // rows and non-sale money movement:
        //   - Inventory sales (USD only, from `sales`) — DC-3 subtracts the
        //     refunded share of an item-refunded (still 'completed') sale.
        //   - MTC/Alfa telecom recharges (USD or LBP, from `recharges`) —
        //     DC-1 excludes is_refunded rows; DC-2 excludes TOP_UP (drawer/
        //     client-wallet top-ups, `price` = credits loaded, not cash
        //     revenue) and CREDIT_BUYBACK (`price` = cash paid OUT to the
        //     customer) by joining `transactions` on type = 'RECHARGE' —
        //     every real customer-facing recharge sale (CREDIT_TRANSFER/
        //     VOUCHER/DAYS/ALFA_GIFT) is stamped with that type; TOP_UP and
        //     CREDIT_BUYBACK are stamped RECHARGE_TOPUP / TELECOM_CREDIT_
        //     BUYBACK respectively (constants/transactionTypes.ts), so this
        //     join expresses "a real sale" without hand-listing
        //     recharge_type values that would drift if a new internal type
        //     is ever added (rule 14 — mirrors the Profits page's own
        //     `ProfitRepository.getRechargesByCurrency` exclusion).
        //   - iPick/Katsh/BOB telecom mobile-service ITEM sales (USD or
        //     LBP, from `financial_services`) — DC-1 excludes is_refunded
        //     rows; DC-4 restricts to the cost/price "mobile services"
        //     provider family (`constants/mobileServiceProviders.ts`'s doc
        //     comment: iPick/Katsh/BOB profit is a MARGIN, never a
        //     commission — OMT/WHISH/OMT_APP/WHISH_APP/BINANCE are never in
        //     this family) and excludes service_type = 'BILL' (a bill
        //     payment is not a telecom item sale). This is narrower than
        //     `ProfitRepository.getMobileServicesByCurrency`'s "Mobile
        //     Services" bucket, which deliberately still includes bills —
        //     a DIFFERENT, broader definition for a different report.

        // Inventory sales (USD only), less the refunded share of any
        // item-refunded line (DC-3). `sale_items.sold_price_usd *
        // refunded_quantity` is the PRE-discount value of the refunded
        // units — the same numerator `refundSaleItem` computes as
        // `refundAmount` above in this file. Dividing by the sale's
        // PRE-discount `total_amount_usd` (the same `lineShareOfSale`
        // denominator `refundSaleItem` uses) and applying that ratio to the
        // POST-discount `final_amount_usd` gives the refunded share of what
        // actually stayed on the books — the same ratio `refundSaleItem`
        // already applies to each payment leg it reverses. Guarded against
        // a zero/absent total (no division unless there's an actual
        // refund AND a positive pre-discount total) so a degenerate row
        // contributes its full final_amount_usd instead of silently
        // dropping out of the SUM via a NULL term.
        const salesData = this.query<{
          date: string;
          currency: string;
          daily_amount: number;
        }>(
          `
          SELECT
            ${localDayExpr("s.created_at")} as date,
            'USD' as currency,
            SUM(
              CASE
                WHEN COALESCE(ri.refunded_pre_discount_usd, 0) > 0
                     AND s.total_amount_usd > 0
                  THEN s.final_amount_usd - (s.final_amount_usd * ri.refunded_pre_discount_usd / s.total_amount_usd)
                ELSE s.final_amount_usd
              END
            ) as daily_amount
          FROM ${this.tableName} s
          LEFT JOIN (
            SELECT sale_id, SUM(sold_price_usd * refunded_quantity) as refunded_pre_discount_usd
            FROM sale_items
            WHERE tenant_id = ?
            GROUP BY sale_id
          ) ri ON ri.sale_id = s.id
          WHERE s.status = 'completed' AND ${localDayExpr("s.created_at")} >= ? AND s.tenant_id = ?
          GROUP BY date
        `,
          tenantId,
          dates[0],
          tenantId,
        );

        // MTC/Alfa telecom recharges (USD or LBP) — real sales only, see
        // doc comment above.
        const rechargesData = this.query<{
          date: string;
          currency: string;
          daily_amount: number;
        }>(
          `
          SELECT
            ${localDayExpr("r.created_at")} as date,
            r.currency_code as currency,
            SUM(r.price) as daily_amount
          FROM recharges r
          JOIN transactions t ON t.source_table = 'recharges' AND t.source_id = r.id AND t.type = 'RECHARGE'
          WHERE t.status = 'ACTIVE'
            AND COALESCE(r.is_refunded, 0) = 0
            AND ${localDayExpr("r.created_at")} >= ?
            AND r.tenant_id = ? AND t.tenant_id = ?
          GROUP BY date, r.currency_code
        `,
          dates[0],
          tenantId,
          tenantId,
        );

        // iPick/Katsh/BOB telecom mobile-service item sales (USD or LBP) —
        // not bills, not OMT/WHISH transfers, not app wallets, see doc
        // comment above.
        const financialData = this.query<{
          date: string;
          currency: string;
          daily_amount: number;
        }>(
          `
          SELECT
            ${localDayExpr("fs.created_at")} as date,
            fs.currency as currency,
            SUM(fs.price) as daily_amount
          FROM financial_services fs
          WHERE fs.provider IN (${MOBILE_SERVICE_PROVIDERS_SQL_LIST})
            AND fs.service_type != 'BILL'
            AND COALESCE(fs.is_refunded, 0) = 0
            AND ${localDayExpr("fs.created_at")} >= ?
            AND fs.tenant_id = ?
          GROUP BY date, fs.currency
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

      // Unreachable: `type` is narrowed to the literal "Sales" above, and
      // the branch returns unconditionally when it matches. Kept as an
      // explicit throw (not a silent fallthrough) so a future caller that
      // widens the parameter type again fails loudly here instead of
      // reintroducing a re-texted profit query (see this method's own doc
      // comment — DC-10 moved "Profit" to `SalesService.getChartData`).
      throw new Error(`SalesRepository.getChartData: unsupported type "${type}"`);
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
   * A sale enriched with its display customer: the linked client's name/phone
   * when client_id is set, otherwise the walk-in name/phone stored on the
   * sale's unified transaction (rule 11 — walk-in names live on `transactions`,
   * never on `sales`). Read + rename (updateMetadata) hit the SAME field so a
   * reprint reflects an edit (RCP-1).
   */
  getSaleWithCustomer(
    saleId: number,
  ):
    | (SaleEntity & { client_name: string | null; client_phone: string | null })
    | null {
    const tenantId = getCurrentTenantId();
    const rows = this.query<
      SaleEntity & { client_name: string | null; client_phone: string | null }
    >(
      `SELECT s.*,
              COALESCE(c.full_name, t.client_name) AS client_name,
              COALESCE(c.phone_number, t.client_phone) AS client_phone
       FROM ${this.tableName} s
       LEFT JOIN clients c ON s.client_id = c.id AND c.tenant_id = ?
       LEFT JOIN transactions t
         ON t.source_table = 'sales' AND t.source_id = s.id
        AND t.type = 'SALE' AND t.tenant_id = ?
       WHERE s.id = ? AND s.tenant_id = ?
       LIMIT 1`,
      tenantId,
      tenantId,
      saleId,
      tenantId,
    );
    return rows[0] ?? null;
  }

  /**
   * Update non-financial metadata on a sale record.
   * Only metadata fields are allowed — financial data is immutable.
   *
   * `note` writes to the sale row. `client_name`/`client_phone` (RCP-1
   * walk-in rename) write to the sale's unified TRANSACTION row — there is no
   * client_name column on `sales`, and rule 11 keeps the walk-in name on the
   * transaction. The caller (service) gates this to walk-in sales.
   */
  updateMetadata(
    id: number,
    data: { note?: string; client_name?: string; client_phone?: string },
    editedBy: string,
  ): SaleEntity | null {
    const existing = this.findById(id);
    if (!existing) return null;
    const tenantId = getCurrentTenantId();

    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.note !== undefined) {
      fields.push("note = ?");
      values.push(data.note);
    }

    if (fields.length > 0) {
      fields.push("edited_by = ?", "edited_at = CURRENT_TIMESTAMP");
      values.push(editedBy);
      values.push(id);
      values.push(tenantId);
      this.db
        .prepare(
          `UPDATE sales SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`,
        )
        .run(...values);
    }

    // Walk-in rename → the unified transaction row (rule 11).
    if (data.client_name !== undefined || data.client_phone !== undefined) {
      const tFields: string[] = [];
      const tValues: unknown[] = [];
      if (data.client_name !== undefined) {
        tFields.push("client_name = ?");
        tValues.push(data.client_name || null);
      }
      if (data.client_phone !== undefined) {
        tFields.push("client_phone = ?");
        tValues.push(data.client_phone || null);
      }
      tValues.push(id, tenantId);
      this.db
        .prepare(
          `UPDATE transactions SET ${tFields.join(", ")}
           WHERE source_table = 'sales' AND source_id = ?
             AND type = 'SALE' AND tenant_id = ?`,
        )
        .run(...tValues);
    }

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
