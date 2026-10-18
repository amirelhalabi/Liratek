/**
 * LIRA-309 — phone lines the shop holds FOR SALE.
 *
 * A for-sale line is an inventory product in a lines category (LIRA-207:
 * one product per number, the number stored normalised in `barcode`). This
 * repository owns its DETAILS row (`resale_lines`: carrier, credit, expiry),
 * kept apart from `carrier_lines` on purpose: carrier lines make up the
 * MTC/Alfa drawer, checkpoints, primary-line selection and buy-back
 * matching, and a for-sale line must reach none of them (spec FR-019,
 * research R1). The number is NOT copied here — it is the product's barcode
 * (rule 14).
 *
 * Every statement is scoped to the current tenant (`getCurrentTenantId()`).
 */
import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { requestNow } from "../utils/requestNow.js";
import {
  isPhoneLineCategoryName,
  isSameLebanesePhone,
} from "../utils/phoneNumber.js";
import { getUsdLbpSellRate } from "../utils/exchangeRate.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { getStockBatchRepository } from "./StockBatchRepository.js";
import { getCarrierLineRepository } from "./CarrierLineRepository.js";
import { getServiceProviderRepository } from "./ServiceProviderRepository.js";
import { getAlfaCreditCostRateLbp } from "./RechargeRepository.js";
import { applyDrawerDelta, insertPaymentRow } from "./moneyPosting.js";
import { getCarrierLineService } from "../services/CarrierLineService.js";

export type ResaleLineCarrier = "mtc" | "alfa";

export interface ResaleLineEntity {
  id: number;
  tenant_id: number;
  product_id: number;
  carrier: ResaleLineCarrier;
  credits: number;
  validity_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One row of the For sale list: the product (number, name, cost, price,
 * stock) LEFT JOINed with its details. A line product with no details row yet
 * (created before LIRA-309) comes back with `resale_line_id`/`carrier` null —
 * it shows as "No expiry set" until the owner saves its details.
 */
export interface ResaleLineRow {
  product_id: number;
  /** `products.barcode` — the line's number, normalised by LIRA-207. */
  phone_number: string | null;
  name: string;
  category: string | null;
  cost_price_usd: number;
  selling_price_usd: number;
  stock_quantity: number;
  /** 1 when the line is still in stock (see {@link UNSOLD_LINE_SQL}). */
  is_unsold: number;
  resale_line_id: number | null;
  carrier: ResaleLineCarrier | null;
  credits: number;
  validity_expires_at: string | null;
}

export interface RechargeCardItem {
  id: number;
  provider: string;
  category: string;
  label: string;
  cost_lbp: number;
  credits: number | null;
  validity_days: number | null;
}

export interface ResaleLineRechargeEntity {
  id: number;
  tenant_id: number;
  transaction_id: number;
  resale_line_id: number;
  product_id: number;
  source: "CARD" | "SHOP_LINE_CREDIT" | "DAYS";
  days_added: number;
  credits_added: number;
  cost_usd: number;
  source_carrier_line_id: number | null;
  mobile_service_item_id: number | null;
  prev_cost_usd: number;
  prev_price_usd: number;
  prev_validity_expires_at: string | null;
  prev_credits: number;
  batch_id: number | null;
  is_reversed: number;
  created_at: string;
  updated_at: string;
}

export interface RecordRechargeInput {
  productId: number;
  resaleLineId: number;
  source: "CARD" | "SHOP_LINE_CREDIT" | "DAYS";
  userId: number;
  costUsd: number;
  exchangeRate: number;
  today: string;
  summary: string;
  daysAdded: number;
  creditsAdded: number;
  prevCredits: number;
  prevExpiry: string | null;
  newCredits: number;
  newExpiry: string | null;
  mobileServiceItemId?: number;
  sourceCarrierLineId?: number;
  legs: Array<{
    method: string;
    drawerName: string;
    currency: "USD" | "LBP";
    amount: number;
    note: string;
  }>;
  sourceMovement?: {
    carrierLineId: number;
    creditsDelta: number;
    validityDaysDelta: number;
    reason: string;
  };
}

/** LIRA-337 — one give-back, the reversal record for LINE_CREDIT_GIVE_BACK. */
export interface ResaleLineGiveBackEntity {
  id: number;
  tenant_id: number;
  transaction_id: number;
  resale_line_id: number;
  product_id: number;
  carrier_line_id: number;
  credits_sent: number;
  sms_fee_usd: number;
  credit_sell_price_lbp: number;
  credit_cost_rate_lbp: number;
  exchange_rate: number;
  price_drop_usd: number;
  cost_drop_usd: number;
  prev_credits: number;
  batch_id: number | null;
  is_reversed: number;
  created_at: string;
  updated_at: string;
}

export interface RecordGiveBackInput {
  productId: number;
  resaleLineId: number;
  carrier: ResaleLineCarrier;
  carrierLineId: number;
  userId: number;
  today: string;
  summary: string;
  creditsSent: number;
  smsFeeUsd: number;
  creditSellPriceLbp: number;
  creditCostRateLbp: number;
  exchangeRate: number;
  priceDropUsd: number;
  costDropUsd: number;
  prevCredits: number;
  newCredits: number;
}

/** The refusal when an older recharge or give-back of a line is undone while
 *  a newer one is still active (one text for both, rule 14). */
export const NEWER_LINE_CHANGE_ERROR = "Undo the newer recharge of this line first.";

export interface ListResaleLinesOptions {
  carrier?: ResaleLineCarrier;
  includeSold?: boolean;
}

export interface UpsertResaleLineData {
  carrier: ResaleLineCarrier;
  credits?: number;
  validityExpiresAt?: string | null;
}

/**
 * "This line is still in stock" — defined ONCE (rule 14) and reused by the
 * list, by number detection, and (US4) by the customer-recharge guard. Reads
 * the `p.` alias of `products`.
 */
/** LIRA-309 US4 — the refusal for a customer recharge aimed at one of the
 *  shop's own lines held for sale (defined once, rule 14). */
export const RESALE_LINE_CUSTOMER_RECHARGE_ERROR =
  "This is your line for sale — use Recharge on the Phone Lines page (or the Recharge line panel on Mobile Recharge).";

export const UNSOLD_LINE_SQL =
  "(p.is_deleted = 0 AND p.is_active = 1 AND p.stock_quantity > 0)";

export class ResaleLineRepository extends BaseRepository<ResaleLineEntity> {
  constructor() {
    super("resale_lines", { softDelete: false });
  }

  protected getColumns(): string {
    return [
      "id",
      "tenant_id",
      "product_id",
      "carrier",
      "credits",
      "validity_expires_at",
      "created_at",
      "updated_at",
    ].join(", ");
  }

  /** Run `fn` in ONE database transaction. */
  withTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Every line product of the tenant with its details. The SQL narrows to
   * categories containing "line" (cheap pre-filter); the exact rule is the
   * shared {@link isPhoneLineCategoryName} predicate (whole word, so
   * "Online Cards" is not a lines category), applied here once.
   */
  listLines(options: ListResaleLinesOptions = {}): ResaleLineRow[] {
    const tenantId = getCurrentTenantId();
    // Bind order follows the SQL text: JOIN tenant, WHERE tenant, carrier.
    const params: unknown[] = [tenantId, tenantId];
    let where = `p.tenant_id = ? AND p.is_deleted = 0 AND p.category LIKE '%line%'`;
    if (!options.includeSold) where += ` AND ${UNSOLD_LINE_SQL}`;
    if (options.carrier) {
      where += ` AND rl.carrier = ?`;
      params.push(options.carrier);
    }
    const rows = this.db
      .prepare(
        `SELECT p.id AS product_id,
                p.barcode AS phone_number,
                p.name,
                p.category,
                COALESCE(p.cost_price_usd, 0) AS cost_price_usd,
                COALESCE(p.selling_price_usd, 0) AS selling_price_usd,
                COALESCE(p.stock_quantity, 0) AS stock_quantity,
                CASE WHEN ${UNSOLD_LINE_SQL} THEN 1 ELSE 0 END AS is_unsold,
                rl.id AS resale_line_id,
                rl.carrier,
                COALESCE(rl.credits, 0) AS credits,
                rl.validity_expires_at
           FROM products p
           LEFT JOIN resale_lines rl
             ON rl.product_id = p.id AND rl.tenant_id = ?
          WHERE ${where}
          ORDER BY p.name`,
      )
      .all(...params) as ResaleLineRow[];
    return rows.filter((r) => isPhoneLineCategoryName(r.category));
  }

  /** The unsold line held for sale whose number matches `phone` in any
   *  format (spaces, dashes, +961 / 00961), or null. */
  findUnsoldByNumber(phone: string | null | undefined): ResaleLineRow | null {
    if (!phone) return null;
    // Same guard as ExpenseRepository._productUnitsTableExists: every real
    // schema has both tables (create_db.sql + v211), but narrow test
    // fixtures for other modules build a database without them.
    if (!this.tableExists("resale_lines") || !this.tableExists("products")) {
      return null;
    }
    return (
      this.listLines({ includeSold: false }).find((l) =>
        isSameLebanesePhone(l.phone_number, phone),
      ) ?? null
    );
  }

  getByProductId(productId: number): ResaleLineEntity | null {
    const tenantId = getCurrentTenantId();
    return (
      (this.db
        .prepare(
          `SELECT ${this.getColumns()} FROM resale_lines
            WHERE tenant_id = ? AND product_id = ?`,
        )
        .get(tenantId, productId) as ResaleLineEntity | undefined) ?? null
    );
  }

  /** The product row a details save is validated against. */
  getLineProduct(
    productId: number,
  ): { id: number; barcode: string | null; category: string | null } | null {
    const tenantId = getCurrentTenantId();
    return (
      (this.db
        .prepare(
          `SELECT id, barcode, category FROM products
            WHERE tenant_id = ? AND id = ? AND is_deleted = 0`,
        )
        .get(tenantId, productId) as
        | { id: number; barcode: string | null; category: string | null }
        | undefined) ?? null
    );
  }

  /** Create the details row, or update it in place. Fields left undefined
   *  keep their stored value on update. */
  upsertDetails(
    productId: number,
    data: UpsertResaleLineData,
  ): ResaleLineEntity {
    const tenantId = getCurrentTenantId();
    const now = requestNow();
    const existing = this.getByProductId(productId);
    if (existing) {
      this.db
        .prepare(
          `UPDATE resale_lines
              SET carrier = ?, credits = ?, validity_expires_at = ?, updated_at = ?
            WHERE tenant_id = ? AND id = ?`,
        )
        .run(
          data.carrier,
          data.credits ?? existing.credits,
          data.validityExpiresAt === undefined
            ? existing.validity_expires_at
            : data.validityExpiresAt,
          now,
          tenantId,
          existing.id,
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO resale_lines
             (tenant_id, product_id, carrier, credits, validity_expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          tenantId,
          productId,
          data.carrier,
          data.credits ?? 0,
          data.validityExpiresAt ?? null,
          now,
          now,
        );
    }
    return this.getByProductId(productId)!;
  }

  // ---------------------------------------------------------------------------
  // LIRA-309 US3 — internal recharge of a line held for sale
  // ---------------------------------------------------------------------------

  /** The shop's USD→LBP sell rate (fallback when the cashier sent none). */
  getUsdSellRate(): number {
    return getUsdLbpSellRate(this.db);
  }

  /** What $1 of transferred credit costs the shop, in LBP (the same setting a
   *  credit sale's cost uses — `RechargeRepository.getAlfaCreditCostRateLbp`). */
  getCreditCostRateLbp(): number {
    return getAlfaCreditCostRateLbp(this.db, getCurrentTenantId());
  }

  /** An active iPick/Katsh MTC/Alfa card from the catalog. */
  getCard(itemId: number): RechargeCardItem | null {
    const tenantId = getCurrentTenantId();
    return (
      (this.db
        .prepare(
          `SELECT id, provider, category, label, cost_lbp, credits, validity_days
             FROM mobile_service_items
            WHERE tenant_id = ? AND id = ? AND is_active = 1`,
        )
        .get(tenantId, itemId) as RechargeCardItem | undefined) ?? null
    );
  }

  /** The newest recharge of a line that has not been undone. */
  getLatestActiveRecharge(resaleLineId: number): ResaleLineRechargeEntity | null {
    const tenantId = getCurrentTenantId();
    return (
      (this.db
        .prepare(
          `SELECT * FROM resale_line_recharges
            WHERE tenant_id = ? AND resale_line_id = ? AND is_reversed = 0
            ORDER BY id DESC LIMIT 1`,
        )
        .get(tenantId, resaleLineId) as ResaleLineRechargeEntity | undefined) ??
      null
    );
  }

  getRechargeByTransactionId(transactionId: number): ResaleLineRechargeEntity | null {
    const tenantId = getCurrentTenantId();
    return (
      (this.db
        .prepare(
          `SELECT * FROM resale_line_recharges
            WHERE tenant_id = ? AND transaction_id = ?`,
        )
        .get(tenantId, transactionId) as ResaleLineRechargeEntity | undefined) ??
      null
    );
  }

  /**
   * Write one internal recharge. Runs inside the caller's DB transaction
   * (`withTransaction`). The service has already validated and computed the
   * capitalized cost `costUsd`; this only posts what it was told:
   *
   * - one `LINE_RECHARGE` transaction (profit 0, no client);
   * - the source's drawer legs, each a payments row tied to that transaction
   *   so the generic `_reversePayments` undoes it;
   * - for DAYS / SHOP_LINE_CREDIT, a movement on the source shop line tied to
   *   the transaction (`_reverseCarrierLineMovements` undoes it);
   * - `+costUsd` on the product's cost, price and open batch unit cost;
   * - the line's new credits / expiry;
   * - the `resale_line_recharges` row `_reverseResaleLineRecharge` reads.
   */
  recordRecharge(input: RecordRechargeInput): { transactionId: number; rechargeId: number } {
    const tenantId = getCurrentTenantId();
    const product = this.db
      .prepare(
        `SELECT cost_price_usd, selling_price_usd FROM products WHERE tenant_id = ? AND id = ?`,
      )
      .get(tenantId, input.productId) as
      | { cost_price_usd: number; selling_price_usd: number }
      | undefined;
    if (!product) throw new Error("This line is not in stock.");

    const transactionId = getTransactionRepository().createTransaction({
      type: TRANSACTION_TYPES.LINE_RECHARGE,
      source_table: "resale_lines",
      source_id: input.resaleLineId,
      user_id: input.userId,
      amount_usd: -input.costUsd,
      amount_lbp: 0,
      profit_usd: 0,
      profit_lbp: 0,
      exchange_rate: input.exchangeRate,
      summary: input.summary,
      metadata_json: {
        source: input.source,
        product_id: input.productId,
        cost_usd: input.costUsd,
        days_added: input.daysAdded,
        credits_added: input.creditsAdded,
        ...(input.sourceCarrierLineId
          ? { source_carrier_line_id: input.sourceCarrierLineId }
          : {}),
        ...(input.mobileServiceItemId
          ? { mobile_service_item_id: input.mobileServiceItemId }
          : {}),
      },
    });

    for (const leg of input.legs) {
      insertPaymentRow(this.db, {
        transactionId,
        method: leg.method,
        drawerName: leg.drawerName,
        currencyCode: leg.currency,
        amount: leg.amount,
        note: leg.note,
        createdBy: input.userId,
        tenantId,
      });
      applyDrawerDelta(this.db, {
        drawerName: leg.drawerName,
        currencyCode: leg.currency,
        delta: leg.amount,
        tenantId,
      });
    }

    if (input.sourceMovement) {
      const moved = getCarrierLineService().applyMovement({
        carrierLineId: input.sourceMovement.carrierLineId,
        creditsDelta: input.sourceMovement.creditsDelta,
        validityDaysDelta: input.sourceMovement.validityDaysDelta,
        reason: input.sourceMovement.reason,
        transactionId,
        today: input.today,
      });
      if (!moved.success) {
        throw new Error(moved.error ?? "Could not update the shop line.");
      }
    }

    this.applyCapitalization(input.productId, input.costUsd);
    const batchId = getStockBatchRepository().addToOpenBatchUnitCost(
      input.productId,
      input.costUsd,
    );

    this.db
      .prepare(
        `UPDATE resale_lines
            SET credits = ?, validity_expires_at = ?, updated_at = ?
          WHERE tenant_id = ? AND id = ?`,
      )
      .run(
        input.newCredits,
        input.newExpiry,
        requestNow(),
        tenantId,
        input.resaleLineId,
      );

    const now = requestNow();
    const rechargeId = Number(
      this.db
        .prepare(
          `INSERT INTO resale_line_recharges (
             tenant_id, transaction_id, resale_line_id, product_id, source,
             days_added, credits_added, cost_usd, source_carrier_line_id,
             mobile_service_item_id, prev_cost_usd, prev_price_usd,
             prev_validity_expires_at, prev_credits, batch_id, is_reversed,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(
          tenantId,
          transactionId,
          input.resaleLineId,
          input.productId,
          input.source,
          input.daysAdded,
          input.creditsAdded,
          input.costUsd,
          input.sourceMovement?.carrierLineId ?? null,
          input.mobileServiceItemId ?? null,
          product.cost_price_usd,
          product.selling_price_usd,
          input.prevExpiry,
          input.prevCredits,
          batchId,
          now,
          now,
        ).lastInsertRowid,
    );
    return { transactionId, rechargeId };
  }

  /** `+deltaUsd` on a product's cost AND selling price (−delta to undo). */
  private applyCapitalization(productId: number, deltaUsd: number): void {
    this.applyPriceCostDelta(productId, deltaUsd, deltaUsd);
  }

  /** `+costDelta` on a product's cost and `+priceDelta` on its selling price. */
  private applyPriceCostDelta(productId: number, costDelta: number, priceDelta: number): void {
    const res = this.db
      .prepare(
        `UPDATE products
            SET cost_price_usd = ROUND(COALESCE(cost_price_usd, 0) + ?, 2),
                selling_price_usd = ROUND(COALESCE(selling_price_usd, 0) + ?, 2),
                updated_at = ?
          WHERE tenant_id = ? AND id = ?`,
      )
      .run(costDelta, priceDelta, requestNow(), getCurrentTenantId(), productId);
    if (res.changes !== 1) throw new Error("This line is not in stock.");
  }

  /** Refuse (throw) once the line is sold: its cost is in a sale's cost of
   *  goods, so a recharge or give-back of it can no longer be undone. */
  private assertLineNotSold(productId: number, batchId: number | null): void {
    const tenantId = getCurrentTenantId();
    const stock = this.db
      .prepare(`SELECT stock_quantity FROM products WHERE tenant_id = ? AND id = ?`)
      .get(tenantId, productId) as { stock_quantity: number } | undefined;
    const batch = batchId
      ? (this.db
          .prepare(
            `SELECT quantity_remaining FROM product_stock_batches WHERE tenant_id = ? AND id = ?`,
          )
          .get(tenantId, batchId) as { quantity_remaining: number } | undefined)
      : undefined;
    const sold =
      !stock ||
      (stock.stock_quantity ?? 0) <= 0 ||
      (batchId !== null && (!batch || batch.quantity_remaining <= 0));
    if (sold) throw new Error("Refund the sale of this line first.");
  }

  /**
   * Newest first (LIRA-337 research R7): the line's recharges and give-backs
   * are undone in reverse order, across BOTH tables. Transaction ids grow
   * with time, so the active row with the highest one is the newest.
   */
  getLatestActiveLineChangeTransactionId(resaleLineId: number): number | null {
    const tenantId = getCurrentTenantId();
    const hasGiveBacks = this.tableExists("resale_line_give_backs");
    const row = this.db
      .prepare(
        `SELECT MAX(transaction_id) AS tid FROM (
           SELECT transaction_id FROM resale_line_recharges
            WHERE tenant_id = ? AND resale_line_id = ? AND is_reversed = 0
           ${
             hasGiveBacks
               ? `UNION ALL
           SELECT transaction_id FROM resale_line_give_backs
            WHERE tenant_id = ? AND resale_line_id = ? AND is_reversed = 0`
               : ""
           }
         )`,
      )
      .get(
        ...(hasGiveBacks
          ? [tenantId, resaleLineId, tenantId, resaleLineId]
          : [tenantId, resaleLineId]),
      ) as { tid: number | null } | undefined;
    return row?.tid ?? null;
  }

  private assertNewestLineChange(resaleLineId: number, transactionId: number): void {
    const latest = this.getLatestActiveLineChangeTransactionId(resaleLineId);
    if (latest !== null && latest !== transactionId) {
      throw new Error(NEWER_LINE_CHANGE_ERROR);
    }
  }

  // ---------------------------------------------------------------------------
  // LIRA-337 — give part of a line's credit back to a shop line
  // ---------------------------------------------------------------------------

  getGiveBackByTransactionId(transactionId: number): ResaleLineGiveBackEntity | null {
    if (!this.tableExists("resale_line_give_backs")) return null;
    return (
      (this.db
        .prepare(
          `SELECT * FROM resale_line_give_backs
            WHERE tenant_id = ? AND transaction_id = ?`,
        )
        .get(getCurrentTenantId(), transactionId) as ResaleLineGiveBackEntity | undefined) ??
      null
    );
  }

  /**
   * Write one give-back, inside the caller's DB transaction. The service has
   * validated it and computed the figures (`planLineGiveBack`); this posts:
   *
   * - one `LINE_CREDIT_GIVE_BACK` transaction (amount +X, profit 0);
   * - a `+X` USD leg on the carrier drawer (`_reversePayments` undoes it);
   * - `+X` credits on the shop line, tied to the transaction
   *   (`_reverseCarrierLineMovements` undoes it);
   * - `−priceDrop` on the price, `−costDrop` on the cost and open batch;
   * - the line's new credit, and the `resale_line_give_backs` row
   *   `_reverseResaleLineGiveBack` reads.
   */
  recordGiveBack(input: RecordGiveBackInput): { transactionId: number; giveBackId: number } {
    const tenantId = getCurrentTenantId();
    const drawer = input.carrier === "mtc" ? "MTC" : "Alfa";
    const x = input.creditsSent;

    const transactionId = getTransactionRepository().createTransaction({
      type: TRANSACTION_TYPES.LINE_CREDIT_GIVE_BACK,
      source_table: "resale_lines",
      source_id: input.resaleLineId,
      user_id: input.userId,
      amount_usd: x,
      amount_lbp: 0,
      profit_usd: 0,
      profit_lbp: 0,
      exchange_rate: input.exchangeRate,
      summary: input.summary,
      metadata_json: {
        product_id: input.productId,
        carrier_line_id: input.carrierLineId,
        credits_sent: x,
        sms_fee_usd: input.smsFeeUsd,
        credit_sell_price_lbp: input.creditSellPriceLbp,
        price_drop_usd: input.priceDropUsd,
        cost_drop_usd: input.costDropUsd,
      },
    });

    insertPaymentRow(this.db, {
      transactionId,
      method: drawer,
      drawerName: drawer,
      currencyCode: "USD",
      amount: x,
      note: "Credit given back (line for sale)",
      createdBy: input.userId,
      tenantId,
    });
    applyDrawerDelta(this.db, { drawerName: drawer, currencyCode: "USD", delta: x, tenantId });

    const moved = getCarrierLineService().applyMovement({
      carrierLineId: input.carrierLineId,
      creditsDelta: x,
      validityDaysDelta: 0,
      reason: "RESALE_GIVE_BACK",
      transactionId,
      today: input.today,
    });
    if (!moved.success) {
      throw new Error(moved.error ?? "Could not update the shop line.");
    }

    this.applyPriceCostDelta(input.productId, -input.costDropUsd, -input.priceDropUsd);
    const batchId = getStockBatchRepository().addToOpenBatchUnitCost(
      input.productId,
      -input.costDropUsd,
    );

    const now = requestNow();
    this.db
      .prepare(
        `UPDATE resale_lines SET credits = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`,
      )
      .run(input.newCredits, now, tenantId, input.resaleLineId);

    const giveBackId = Number(
      this.db
        .prepare(
          `INSERT INTO resale_line_give_backs (
             tenant_id, transaction_id, resale_line_id, product_id, carrier_line_id,
             credits_sent, sms_fee_usd, credit_sell_price_lbp, credit_cost_rate_lbp,
             exchange_rate, price_drop_usd, cost_drop_usd, prev_credits, batch_id,
             is_reversed, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(
          tenantId,
          transactionId,
          input.resaleLineId,
          input.productId,
          input.carrierLineId,
          x,
          input.smsFeeUsd,
          input.creditSellPriceLbp,
          input.creditCostRateLbp,
          input.exchangeRate,
          input.priceDropUsd,
          input.costDropUsd,
          input.prevCredits,
          batchId,
          now,
          now,
        ).lastInsertRowid,
    );
    return { transactionId, giveBackId };
  }

  /**
   * Rule-20 reversal owner for a `LINE_CREDIT_GIVE_BACK`'s own effects
   * (called by `TransactionRepository._reverseResaleLineGiveBack`, inside the
   * void's DB transaction). Refuses — throwing, so the whole void rolls back
   * — once the line is sold or while a newer recharge/give-back is active.
   * Otherwise adds the price and cost drops back (by DELTA, so a later manual
   * price edit is kept) and restores the line's credit. The drawer leg and
   * the shop-line credit are undone by the generic void steps.
   */
  reverseGiveBack(transactionId: number): void {
    const row = this.getGiveBackByTransactionId(transactionId);
    if (!row || row.is_reversed) return;
    const tenantId = getCurrentTenantId();

    this.assertLineNotSold(row.product_id, row.batch_id);
    this.assertNewestLineChange(row.resale_line_id, row.transaction_id);

    this.applyPriceCostDelta(row.product_id, row.cost_drop_usd, row.price_drop_usd);
    if (row.batch_id !== null) {
      this.db
        .prepare(
          `UPDATE product_stock_batches
              SET unit_cost_usd = ROUND(unit_cost_usd + ?, 2)
            WHERE tenant_id = ? AND id = ?`,
        )
        .run(row.cost_drop_usd, tenantId, row.batch_id);
    }
    const now = requestNow();
    this.db
      .prepare(`UPDATE resale_lines SET credits = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`)
      .run(row.prev_credits, now, tenantId, row.resale_line_id);
    this.db
      .prepare(
        `UPDATE resale_line_give_backs SET is_reversed = 1, updated_at = ?
          WHERE tenant_id = ? AND id = ?`,
      )
      .run(now, tenantId, row.id);
  }

  /**
   * Rule-20 reversal owner for a `LINE_RECHARGE` (called by
   * `TransactionRepository._reverseResaleLineRecharge`, inside the void's DB
   * transaction). Refuses — throwing, so the whole void rolls back — when the
   * line has been sold (its cost is now in a sale's cost of goods) or when a
   * newer recharge of the same line is still active. Otherwise subtracts the
   * recharge cost from cost, price and batch (by DELTA, so a later manual
   * price edit is kept) and restores the line's credits / expiry.
   */
  reverseRecharge(transactionId: number): void {
    const row = this.getRechargeByTransactionId(transactionId);
    if (!row || row.is_reversed) return;
    const tenantId = getCurrentTenantId();

    this.assertLineNotSold(row.product_id, row.batch_id);

    this.assertNewestLineChange(row.resale_line_id, row.transaction_id);

    this.applyCapitalization(row.product_id, -row.cost_usd);
    if (row.batch_id !== null) {
      this.db
        .prepare(
          `UPDATE product_stock_batches
              SET unit_cost_usd = ROUND(unit_cost_usd - ?, 2)
            WHERE tenant_id = ? AND id = ?`,
        )
        .run(row.cost_usd, tenantId, row.batch_id);
    }
    const now = requestNow();
    this.db
      .prepare(
        `UPDATE resale_lines
            SET credits = ?, validity_expires_at = ?, updated_at = ?
          WHERE tenant_id = ? AND id = ?`,
      )
      .run(row.prev_credits, row.prev_validity_expires_at, now, tenantId, row.resale_line_id);
    this.db
      .prepare(
        `UPDATE resale_line_recharges SET is_reversed = 1, updated_at = ?
          WHERE tenant_id = ? AND id = ?`,
      )
      .run(now, tenantId, row.id);
  }

  /** The drawer an iPick/Katsh card's cost leaves (service-provider table,
   *  with the historic names as fallback). */
  providerDrawerName(provider: string): string {
    try {
      const sp = getServiceProviderRepository().getByCode(provider as never);
      if (sp) return sp.drawer_name;
    } catch {
      // service_providers unavailable — fall back to the historic names.
    }
    return provider === "Katsh" ? "Katsh" : "iPick";
  }

  /** An active shop line of a carrier: the given one, else the primary. */
  getSourceShopLine(
    carrier: ResaleLineCarrier,
    carrierLineId?: number,
  ): { id: number; carrier: string; phone_number: string; credits: number; validity_expires_at: string | null; is_active: number } | null {
    const repo = getCarrierLineRepository();
    const line = carrierLineId ? repo.getById(carrierLineId) : repo.getPrimary(carrier);
    return line ?? null;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let resaleLineRepositoryInstance: ResaleLineRepository | null = null;

export function getResaleLineRepository(): ResaleLineRepository {
  if (!resaleLineRepositoryInstance) {
    resaleLineRepositoryInstance = new ResaleLineRepository();
  }
  return resaleLineRepositoryInstance;
}

export function resetResaleLineRepository(): void {
  resaleLineRepositoryInstance = null;
}
