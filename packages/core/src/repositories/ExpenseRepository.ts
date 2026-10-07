import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import {
  paymentMethodToDrawerName,
  isDrawerAffectingMethod,
  partitionLegs,
} from "../utils/payments.js";
import { getUsdLbpSellRate } from "../utils/exchangeRate.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import {
  TRANSACTION_TYPES,
  STOCK_EXPENSE_CATALOG_PROVIDERS,
  STOCK_EXPENSE_TRANSACTION_TYPES,
  type StockExpenseSource,
  type TransactionType,
} from "../constants/transactionTypes.js";
import { TOP_UP_PROVIDER_DRAWERS } from "../constants/rechargeProviders.js";
import {
  applyDrawerDelta,
  cashierRateStamp,
  insertPaymentRow,
  resolveStampedExchangeRate,
  sumLegsByCurrency,
  usdEquivalent,
} from "./moneyPosting.js";
import { resolveKeptChange } from "./keptChange.js";
import { isToday } from "./reportingTimeFragments.js";
import { getStockBatchRepository } from "./StockBatchRepository.js";
import { getServiceProviderRepository } from "./ServiceProviderRepository.js";
import { BusinessRuleError } from "../utils/errors.js";
import type {
  CreateStockExpenseData,
  ExpensePaymentLeg,
} from "../validators/expense.js";

export interface ExpenseEntity {
  id: number;
  description: string;
  category: string;
  paid_by_method?: string;
  amount_usd: number;
  amount_lbp: number;
  expense_date: string;
  note: string | null;
  status?: string;
  created_at?: string;
  updated_at?: string;
  edited_by: string | null;
  edited_at: string | null;
  /** LIRA-131: set by `TransactionRepository._markSourceRefunded` when the
   *  unified transaction sourced from this row is voided/refunded —
   *  `expenses` is in its supported-tables whitelist. Was written by the
   *  reversal path but never projected here, so the Expenses history
   *  modal's existing "Refunded" badge (`expenses/pages/Expenses
   *  /components/HistoryModal.tsx`, gated on `expense.is_refunded`) stayed
   *  dormant. */
  is_refunded: number;
  refunded_at: string | null;
}

/**
 * Route this expense's single drawer leg to an EXPLICIT drawer/currency
 * instead of the one `paymentMethodToDrawerName(paid_by_method)` resolves
 * (LIRA-145 carrier-line usage).
 *
 * Exists because some expenses are paid out of a stock of value the shop
 * already holds in a PROVIDER drawer, not out of a payment method at all:
 * consuming an MTC/Alfa line's credits spends the carrier credit drawer
 * (`CARRIER_DRAWER_NAMES`), and the documented invariant
 * `drawer_balances[carrier].USD == getCarrierCreditsSum(carrier)` only holds
 * if that exact drawer is the one debited. `paid_by_method` stays the
 * audit/reporting label for HOW it was paid (`LINE_CREDIT`); this field says
 * WHERE the value left from.
 */
export interface ExpenseDrawerOverride {
  drawer_name: string;
  currency_code: "USD" | "LBP";
  /**
   * LIRA-262: the leg's `payments.note`. Defaults to `<category>: <description>`.
   * A stock-use expense passes `Cost: <provider>` — the SAME note a catalog
   * sale's provider cost leg carries — so `isInternalLegJs` classifies it as
   * an internal provider leg, never customer cash (a Whish_App leg would
   * otherwise read as a refundable customer-cash leg).
   */
  note?: string;
}

/**
 * LIRA-262 — the item a "shop used its own stock" expense consumed. Written
 * to `expenses.item_source/item_id/item_quantity` (v193). For `INVENTORY`,
 * `createExpense` itself FIFO-consumes the batches (owner column
 * `stock_batch_consumptions.expense_id`), books `amount_usd` = the FIFO cost
 * (overriding the caller's amount) and posts NO drawer leg at all. Set ONLY
 * by `createStockExpense`, which has already taken the units off
 * `products.stock_quantity`.
 */
export interface ExpenseStockItem {
  source: StockExpenseSource;
  item_id: number;
  quantity: number;
  /** INVENTORY only — prices units no batch covers (legacy stock), exactly
   *  like a sale's `fallbackUnitCostUsd`. */
  fallback_unit_cost_usd?: number;
}

export interface CreateExpenseData {
  description: string;
  category: string;
  paid_by_method?: string;
  amount_usd: number;
  amount_lbp: number;
  expense_date: string;
  transaction_time?: string;
  /**
   * When set, `createExpense` posts EXACTLY ONE leg — the override
   * drawer/currency, for that currency's amount, negated — and skips the
   * whole `paid_by_method` → drawer mapping (including the BINANCE/USDT
   * special case), so an override can never double-post. See
   * {@link ExpenseDrawerOverride}.
   */
  drawer_override?: ExpenseDrawerOverride;
  /**
   * Extra keys merged into the unified transaction's `metadata_json`. The
   * canonical `category`/`paid_by`/`expense_date` keys are written AFTER
   * this spread and always win — an override can add context, never rewrite
   * the row's own identity.
   */
  extra_metadata?: Record<string, unknown>;
  /**
   * Generic back-link (migration v166, same shape as
   * `supplier_ledger.source_ref_table`/`source_ref_id` from v136) to the
   * PARENT unified transaction's own source row — e.g. `'recharges'`/<recharge
   * id> for the SMS transfer fee expense a CREDIT_TRANSFER recharge books.
   * Lets `TransactionRepository` find and cascade-void this expense when the
   * parent transaction is voided/refunded (rule 20). Omit for a
   * stand-alone expense with no owning transaction (e.g. LIRA-145 line
   * usage, whose reversal owner is the generic void path on the expense
   * itself).
   */
  source_ref_table?: string;
  source_ref_id?: number;
  /**
   * LIRA-262: the unified transaction's type. Defaults to `EXPENSE`. Only
   * internal writers set it (`createStockExpense` passes the per-source
   * `EXPENSE_INVENTORY`/`EXPENSE_KATSH`/…); no transport schema carries it,
   * so a client can never choose it.
   */
  transaction_type?: TransactionType;
  /** LIRA-262 — see {@link ExpenseStockItem}. */
  stock_item?: ExpenseStockItem;
  /**
   * Manual expense cash lines (owner decision 2026-10-07, payer "shop").
   * When present (and non-empty), `amount_usd`/`amount_lbp` are read as the
   * BILL, and the stored cost + drawer legs are derived from these lines:
   * IN (no direction) = cash handed to the vendor, OUT = change the vendor
   * handed back into the drawer. See {@link ExpenseRepository.createExpense}.
   * Internal writers (SMS fee, line usage, stock use) never pass it.
   */
  payments?: ExpensePaymentLeg[];
  /** Client's claim of change the vendor did NOT return (added to the
   *  cost). Checked by `resolveKeptChange`, never trusted. */
  kept_change_usd?: number;
  kept_change_lbp?: number;
  /** The rate the till converted at (rule 27). */
  tender_exchange_rate?: number;
}

/**
 * What a manual expense's cash lines resolve to (payer "shop"): the stored
 * cost, the gross cash handed per currency (drawer debit) and the change
 * legs that came back (drawer credit). See `_resolveManualCash`.
 */
interface ManualExpenseCash {
  costUsd: number;
  costLbp: number;
  handedUsd: number;
  handedLbp: number;
  returned: ExpensePaymentLeg[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export class ExpenseRepository extends BaseRepository<ExpenseEntity> {
  constructor() {
    super("expenses");
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  // LIRA-131: is_refunded/refunded_at are written by
  // TransactionRepository._markSourceRefunded on void/refund but were never
  // projected here, so a refunded expense silently read back as an
  // ordinary live row. getTodayExpenses()/findById()/findAll() all share
  // this one method (used by both the IPC handlers in dbHandlers.ts and the
  // REST routes in backend/src/api/expenses.ts via ExpenseService), so this
  // one change fixes the read path identically for desktop and web (rule
  // 19).
  protected getColumns(): string {
    return "id, description, category, amount_usd, amount_lbp, expense_date, paid_by_method, note, status, edited_by, edited_at, is_refunded, refunded_at";
  }

  /**
   * True when the connected `expenses` table already carries the v166
   * source_ref_table/source_ref_id columns. Mirrors
   * `SupplierRepository._supplierLedgerHasSourceRefColumns` exactly: many
   * `packages/core` jest specs hand-roll a fresh in-memory schema per file
   * that predates this migration, and an INSERT referencing a column the
   * connected schema doesn't have would throw. Checked once per call (PRAGMA
   * is cheap; this is not a hot path) rather than cached.
   */
  private _expensesHasSourceRefColumns(): boolean {
    const cols = this.db.prepare(`PRAGMA table_info(expenses)`).all() as {
      name: string;
    }[];
    return (
      cols.some((c) => c.name === "source_ref_table") &&
      cols.some((c) => c.name === "source_ref_id")
    );
  }

  /**
   * Create a new expense
   */
  createExpense(data: CreateExpenseData, userId: number): number {
    const paidBy = data.paid_by_method || "CASH";
    const drawerName = paymentMethodToDrawerName(paidBy);
    const tenantId = getCurrentTenantId();
    const hasSourceRef = this._expensesHasSourceRefColumns();
    const hasCashLines =
      !data.stock_item &&
      !data.drawer_override &&
      (data.payments?.length ?? 0) > 0;

    return this.db.transaction(() => {
      // LIRA-262: a stock-use expense is only ever written on a v193 schema
      // (it is reached through createStockExpense alone), which also has the
      // v166 source-ref columns — so it gets its own fixed INSERT.
      if (data.stock_item) {
        const result = this.db
          .prepare(
            `INSERT INTO expenses (tenant_id, description, category, paid_by_method, amount_usd, amount_lbp, expense_date, item_source, item_id, item_quantity, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
          )
          .run(
            tenantId,
            data.description,
            data.category,
            paidBy,
            data.amount_usd,
            data.amount_lbp,
            data.expense_date,
            data.stock_item.source,
            data.stock_item.item_id,
            data.stock_item.quantity,
            data.transaction_time ?? null,
          );
        return this._bookExpense(
          Number(result.lastInsertRowid),
          data,
          paidBy,
          drawerName,
          userId,
          tenantId,
        );
      }
      // Manual expense with cash lines: check the lines against the bill and
      // store the REAL cost (handed − returned) — Profits and closing sum
      // `expenses.amount_*`, so the bill alone would understate a vendor
      // who kept the change. Throws before any write.
      const cash = hasCashLines ? this._resolveManualCash(data, paidBy) : null;
      if (cash) {
        data = { ...data, amount_usd: cash.costUsd, amount_lbp: cash.costLbp };
      }
      const stmt = hasSourceRef
        ? this.db.prepare(`
        INSERT INTO expenses (tenant_id, description, category, paid_by_method, amount_usd, amount_lbp, expense_date, source_ref_table, source_ref_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
      `)
        : this.db.prepare(`
        INSERT INTO expenses (tenant_id, description, category, paid_by_method, amount_usd, amount_lbp, expense_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
      `);
      const result = hasSourceRef
        ? stmt.run(
            tenantId,
            data.description,
            data.category,
            paidBy,
            data.amount_usd,
            data.amount_lbp,
            data.expense_date,
            data.source_ref_table ?? null,
            data.source_ref_id ?? null,
            data.transaction_time ?? null,
          )
        : stmt.run(
            tenantId,
            data.description,
            data.category,
            paidBy,
            data.amount_usd,
            data.amount_lbp,
            data.expense_date,
            data.transaction_time ?? null,
          );
      return this._bookExpense(
        Number(result.lastInsertRowid),
        data,
        paidBy,
        drawerName,
        userId,
        tenantId,
        cash ?? undefined,
      );
    })();
  }

  /**
   * Manual expense, payer "shop" (owner decision 2026-10-07): the operator
   * typed the BILL (`amount_usd`/`amount_lbp`) and the cash HANDED (IN
   * legs); change the vendor handed back is OUT legs; the client claims the
   * change NOT returned as `kept_change_*`. `resolveKeptChange` checks
   * handed − returned − notReturned = bill (and refuses a claim above the
   * real excess), so nothing here trusts the client's figures.
   *
   * Stored cost = handed − returned per currency. When the change came back
   * in the OTHER currency one side goes negative (e.g. $20 handed, 100,000
   * LBP back); an expense row / EXPENSE transaction never carries a negative
   * amount (it would flip the OUT badge, show a negative total on the
   * Expenses page and fail the nonnegative schemas), so that case is folded
   * into the bill's currency at the same rate the reconcile used. The
   * drawers still move per physical currency (gross legs).
   */
  private _resolveManualCash(
    data: CreateExpenseData,
    paidBy: string,
  ): ManualExpenseCash {
    const context = "Expense";
    const { inLegs: handed, outLegs: returned } = partitionLegs(data.payments);
    const billUsd = data.amount_usd || 0;
    const billLbp = data.amount_lbp || 0;
    if (billUsd <= 0 && billLbp <= 0) {
      throw new BusinessRuleError(`${context}: enter the bill amount`);
    }
    if (handed.length === 0) {
      throw new BusinessRuleError(
        `${context}: enter the cash handed to the vendor`,
      );
    }
    for (const leg of [...handed, ...returned]) {
      if (leg.currencyCode !== "USD" && leg.currencyCode !== "LBP") {
        throw new BusinessRuleError(
          `${context}: only USD and LBP lines are supported`,
        );
      }
    }
    for (const leg of handed) {
      if (leg.method !== paidBy) {
        throw new BusinessRuleError(
          `${context}: every line must be paid with ${paidBy}`,
        );
      }
    }
    const isUsdtWallet = paidBy === "BINANCE";
    if (isUsdtWallet && handed.some((l) => l.currencyCode !== "USD")) {
      throw new BusinessRuleError(
        `${context}: a Binance payment is in dollars only`,
      );
    }
    const claimsChange =
      returned.length > 0 ||
      (data.kept_change_usd ?? 0) > 0 ||
      (data.kept_change_lbp ?? 0) > 0;
    if (claimsChange && (isUsdtWallet || !isDrawerAffectingMethod(paidBy))) {
      throw new BusinessRuleError(
        `${context}: change back from the vendor can only be recorded for a payment out of a cash drawer — pay the exact bill`,
      );
    }
    for (const leg of returned) {
      if (!isDrawerAffectingMethod(leg.method)) {
        throw new BusinessRuleError(
          `${context}: change from the vendor must come back into a drawer`,
        );
      }
    }

    const exchangeRate = getUsdLbpSellRate(this.db);
    const resolved = resolveKeptChange({
      payer: "shop",
      bill: { usd: billUsd, lbp: billLbp },
      handedLegs: handed,
      returnedLegs: returned,
      claimedKept: {
        usd: data.kept_change_usd ?? 0,
        lbp: data.kept_change_lbp ?? 0,
      },
      exchangeRate,
      ...(data.tender_exchange_rate !== undefined
        ? { tenderExchangeRate: data.tender_exchange_rate }
        : {}),
      context,
    });

    let costUsd = round2(resolved.costUsd);
    let costLbp = round2(resolved.costLbp);
    if (costUsd < 0 || costLbp < 0) {
      const rate = resolveStampedExchangeRate(
        exchangeRate,
        data.tender_exchange_rate,
      );
      const costInUsd = usdEquivalent(costUsd, costLbp, rate);
      if (!(costInUsd > 0)) {
        throw new BusinessRuleError(
          `${context}: the change back is more than the cash handed`,
        );
      }
      if (billUsd > 0) {
        costUsd = round2(costInUsd);
        costLbp = 0;
      } else {
        costUsd = 0;
        costLbp = Math.round(costInUsd * rate);
      }
    }

    const h = sumLegsByCurrency(handed, context);
    return {
      costUsd,
      costLbp,
      handedUsd: h.usd,
      handedLbp: h.lbp,
      returned,
    };
  }

  /**
   * Everything `createExpense` does after the `expenses` INSERT: inventory
   * consumption (LIRA-262), the unified transaction and the drawer leg(s).
   * Runs inside `createExpense`'s db transaction; split out only so both
   * INSERT shapes share ONE booking path (rule 14).
   */
  private _bookExpense(
    expenseId: number,
    data: CreateExpenseData,
    paidBy: string,
    drawerName: string,
    userId: number,
    tenantId: number,
    /** Manual expense with cash lines — post the gross handed amounts and
     *  the change-back legs instead of the stored cost. */
    cash?: ManualExpenseCash,
  ): number {
    let amountUsd = data.amount_usd || 0;
    let amountLbp = data.amount_lbp || 0;

    // LIRA-262 — inventory stock use: FIFO-consume the batches like a sale
    // and book the REAL cost they came at (USD — products only carry USD
    // cost). The units already left products.stock_quantity in
    // createStockExpense; this is the costing/valuation side.
    const isInventoryUse = data.stock_item?.source === "INVENTORY";
    if (isInventoryUse && data.stock_item) {
      const { totalCostUsd } = getStockBatchRepository().consume(
        data.stock_item.item_id,
        data.stock_item.quantity,
        {
          expenseId,
          reason: "ADJUSTMENT",
          fallbackUnitCostUsd: data.stock_item.fallback_unit_cost_usd ?? 0,
        },
      );
      amountUsd = Math.round(totalCostUsd * 100) / 100;
      amountLbp = 0;
      this.db
        .prepare(
          `UPDATE expenses SET amount_usd = ?, amount_lbp = 0 WHERE id = ? AND tenant_id = ?`,
        )
        .run(amountUsd, expenseId, tenantId);
    }

    // Create unified transaction row
    const txnId = getTransactionRepository().createTransaction({
      type: data.transaction_type ?? TRANSACTION_TYPES.EXPENSE,
      source_table: "expenses",
      source_id: expenseId,
      user_id: userId,
      amount_usd: -amountUsd,
      amount_lbp: -amountLbp,
      // Owner decision 2026-10-07: the row saves the rate the cashier
      // actually used — the Expenses form's `tender_exchange_rate`. Writers
      // that send none (SMS_Transfer_Fee, Line_Usage) keep the market-rate
      // snapshot createTransaction takes on its own.
      ...cashierRateStamp(data.tender_exchange_rate),
      summary: `Expense: ${data.category} - ${data.description}`,
      metadata_json: {
        ...(data.extra_metadata ?? {}),
        category: data.category,
        paid_by: paidBy,
        expense_date: data.expense_date,
        // Derived — never caller-supplied. Mirrors the SUPPLIER_PAYMENT
        // precedent (CQ-8/D2, migration v130): a system-generated sibling
        // row is flagged so the Transactions table can hide it by default
        // without hiding a manual expense entry. Sourced from
        // `source_ref_table` (v166), the generic parent link a sibling
        // carries — derived once here rather than passed by each call
        // site, so a future auto writer gets it for free and none can
        // drift. Today the ONLY writer that passes it is
        // RechargeRepository's `SMS_Transfer_Fee` (parent: the recharge).
        // The other two callers are deliberately NOT auto (rule 26 —
        // operator-initiated, no parent to link): ExpenseService (manual
        // expense) and CarrierLineRepository.recordUsage (`Line_Usage`,
        // the operator records a SIM balance they read; LIRA-258 G30).
        // Assigned AFTER the extra_metadata spread (like
        // category/paid_by/expense_date above) so a caller's own
        // extra_metadata can never override it either way; `undefined` is
        // dropped by JSON.stringify, so a manual expense's metadata_json
        // has no `is_auto` key at all, same as before this change.
        is_auto: data.source_ref_table ? true : undefined,
      },
      transaction_time: data.transaction_time,
    });

    const note = `${data.category}: ${data.description}`;
    const createdBy = userId;

    // LIRA-262: the shop used its own inventory — no drawer moves at all.
    if (isInventoryUse) {
      return expenseId;
    }

    const postOutflow = (
      currency: string,
      amount: number,
      targetDrawer: string,
    ) => {
      const delta = -Math.abs(amount);
      insertPaymentRow(this.db, {
        transactionId: txnId,
        method: paidBy,
        drawerName: targetDrawer,
        currencyCode: currency,
        amount: delta,
        note: data.drawer_override?.note ?? note,
        createdBy,
        tenantId,
      });
      applyDrawerDelta(this.db, {
        drawerName: targetDrawer,
        currencyCode: currency,
        delta,
        tenantId,
      });
    };

    // Explicit drawer override (LIRA-145): ONE leg, on the caller's drawer
    // and currency, and NONE of the paid-by-method mapping below — a
    // second post here would double-debit and break the carrier-credit sum
    // invariant this override exists to preserve. `isDrawerAffectingMethod`
    // is deliberately NOT consulted: the override IS the statement that a
    // drawer moves, and `LINE_CREDIT` is not a registered payment method.
    if (data.drawer_override) {
      const { drawer_name, currency_code } = data.drawer_override;
      const amount = currency_code === "USD" ? amountUsd : amountLbp;
      if (amount) {
        postOutflow(currency_code, amount, drawer_name);
      }
      return expenseId;
    }

    // Cash lines: the drawer moves by what was physically HANDED (the cost
    // may include change the vendor kept, which never came back).
    const outUsd = cash ? cash.handedUsd : amountUsd;
    const outLbp = cash ? cash.handedLbp : amountLbp;

    // All expenses affect drawer balances (unless paid by non-drawer-affecting method)
    if (isDrawerAffectingMethod(paidBy)) {
      // Binance is a USDT-denominated wallet: the shop pays the expense out
      // of its USDT balance. USDT is tracked 1:1 with USD across the app
      // (see FinancialServiceRepository wallet path / lira-098), so the
      // dollar value lives in amount_usd for reporting and the drawer leg
      // moves that many USDT. The generic void restores by the leg's
      // currency_code, so the USDT balance nets back on void.
      const isUsdtWallet = paidBy === "BINANCE";

      if (isUsdtWallet) {
        if (outUsd !== 0) {
          postOutflow("USDT", outUsd, drawerName);
        }
      } else {
        // USD outflow
        if (outUsd !== 0) {
          postOutflow("USD", outUsd, drawerName);
        }
        // LBP outflow
        if (outLbp !== 0) {
          postOutflow("LBP", outLbp, drawerName);
        }
      }
    }

    // Change the vendor handed back comes INTO its drawer, on the SAME
    // transaction — so the generic void (`_reversePayments`, which negates
    // every payments row) takes it back out. `_resolveManualCash` already
    // refused a return leg on a non-drawer method or a Binance payment.
    for (const leg of cash?.returned ?? []) {
      const backDrawer = paymentMethodToDrawerName(leg.method);
      const delta = Math.abs(leg.amount);
      insertPaymentRow(this.db, {
        transactionId: txnId,
        method: leg.method,
        drawerName: backDrawer,
        currencyCode: leg.currencyCode,
        amount: delta,
        note: `Change returned: ${note}`,
        createdBy,
        tenantId,
      });
      applyDrawerDelta(this.db, {
        drawerName: backDrawer,
        currencyCode: leg.currencyCode,
        delta,
        tenantId,
      });
    }

    return expenseId;
  }

  /**
   * LIRA-262 (owner decision 2026-10-06) — record that the shop USED one of
   * its own items, as an expense AT COST, with NO cash leaving any cash
   * drawer. One transaction type per source
   * (`STOCK_EXPENSE_TRANSACTION_TYPES`).
   *
   *   - INVENTORY: guarded `stock_quantity −qty` (refuses more than is on
   *     hand, and products with IMEI-registered units in stock — the operator
   *     would have to say which phone), then `createExpense` FIFO-consumes
   *     the batches and books amount_usd = the FIFO cost. No payments row.
   *   - KATSH / IPICK / WHISH_APP: cost = `mobile_service_items.cost_lbp ×
   *     qty` (the cost KatchForm/FinancialForm send for a catalog sale), in
   *     LBP; ONE leg debiting the provider's prepaid drawer, noted
   *     `Cost: <provider>` like the catalog sale's own cost leg. The item
   *     must belong to that provider, be active, and have a cost.
   *
   * Everything goes through `createExpense` (the one expense writer). Never
   * passes `source_ref_*`: this expense is operator-initiated, not an auto
   * sibling (rule 26), and its reversal owner is the generic void/refund
   * on its OWN transaction — `_reversePayments` (provider leg),
   * `_markSourceRefunded` (expense soft-void) and `restoreExpenseStock`
   * (inventory).
   */
  createStockExpense(data: CreateStockExpenseData, userId: number): number {
    const tenantId = getCurrentTenantId();
    const transactionType = STOCK_EXPENSE_TRANSACTION_TYPES[data.source];
    const description = data.description?.trim();

    return this.db.transaction(() => {
      if (data.source === "INVENTORY") {
        const product = this.db
          .prepare(
            `SELECT id, name, cost_price_usd, stock_quantity FROM products
             WHERE id = ? AND tenant_id = ? AND COALESCE(is_deleted, 0) = 0`,
          )
          .get(data.item_id, tenantId) as
          | {
              id: number;
              name: string;
              cost_price_usd: number | null;
              stock_quantity: number | null;
            }
          | undefined;
        if (!product) {
          throw new BusinessRuleError(`Product #${data.item_id} not found`);
        }

        if (this._productUnitsTableExists()) {
          const units = this.db
            .prepare(
              `SELECT COUNT(*) AS count FROM product_units
               WHERE tenant_id = ? AND product_id = ? AND status = 'IN_STOCK'`,
            )
            .get(tenantId, product.id) as { count: number };
          if (units.count > 0) {
            throw new BusinessRuleError(
              `"${product.name}" has ${units.count} IMEI-registered unit(s) in stock — record its use from the POS instead, where the unit can be picked`,
            );
          }
        }

        const taken = this.db
          .prepare(
            `UPDATE products SET stock_quantity = stock_quantity - ?
             WHERE id = ? AND tenant_id = ? AND stock_quantity >= ?`,
          )
          .run(data.quantity, product.id, tenantId, data.quantity);
        if (taken.changes === 0) {
          throw new BusinessRuleError(
            `Not enough stock for "${product.name}" (${product.stock_quantity ?? 0} available)`,
          );
        }

        return this.createExpense(
          {
            description: description || `${data.quantity} × ${product.name}`,
            category: data.category,
            paid_by_method: "STOCK",
            // Replaced by the FIFO cost inside createExpense.
            amount_usd: 0,
            amount_lbp: 0,
            expense_date: data.expense_date,
            transaction_time: data.transaction_time,
            transaction_type: transactionType,
            stock_item: {
              source: "INVENTORY",
              item_id: product.id,
              quantity: data.quantity,
              fallback_unit_cost_usd: Number(product.cost_price_usd) || 0,
            },
            extra_metadata: {
              item_source: "INVENTORY",
              product_id: product.id,
              item_name: product.name,
              quantity: data.quantity,
            },
          },
          userId,
        );
      }

      const provider = STOCK_EXPENSE_CATALOG_PROVIDERS[data.source];
      const item = this.db
        .prepare(
          `SELECT id, label, category, subcategory, cost_lbp FROM mobile_service_items
           WHERE id = ? AND provider = ? AND is_active = 1 AND tenant_id = ?`,
        )
        .get(data.item_id, provider, tenantId) as
        | {
            id: number;
            label: string;
            category: string;
            subcategory: string;
            cost_lbp: number | null;
          }
        | undefined;
      if (!item) {
        throw new BusinessRuleError(
          `${provider} item #${data.item_id} not found`,
        );
      }
      const unitCostLbp = Number(item.cost_lbp) || 0;
      if (unitCostLbp <= 0) {
        throw new BusinessRuleError(
          `${provider} item "${item.label}" has no cost set — set its cost in Settings first`,
        );
      }
      const costLbp = unitCostLbp * data.quantity;

      return this.createExpense(
        {
          description:
            description || `${data.quantity} × ${provider} ${item.label}`,
          category: data.category,
          paid_by_method: provider,
          amount_usd: 0,
          amount_lbp: costLbp,
          expense_date: data.expense_date,
          transaction_time: data.transaction_time,
          transaction_type: transactionType,
          drawer_override: {
            drawer_name: this._providerDrawerName(provider),
            currency_code: "LBP",
            note: `Cost: ${provider}`,
          },
          stock_item: {
            source: data.source,
            item_id: item.id,
            quantity: data.quantity,
          },
          extra_metadata: {
            item_source: data.source,
            mobile_service_item_id: item.id,
            item_name: item.label,
            provider,
            quantity: data.quantity,
            unit_cost_lbp: unitCostLbp,
          },
        },
        userId,
      );
    })();
  }

  /**
   * The provider's prepaid drawer — the shop's configured
   * `service_providers.drawer_name` first (what a catalog sale's cost leg
   * uses), then the canonical `TOP_UP_PROVIDER_DRAWERS` map.
   */
  private _providerDrawerName(provider: string): string {
    try {
      const sp = getServiceProviderRepository().getByCode(provider);
      if (sp?.drawer_name) return sp.drawer_name;
    } catch {
      // service_providers missing on this connection — canonical map below.
    }
    const fallback = (TOP_UP_PROVIDER_DRAWERS as Record<string, string>)[
      provider
    ];
    if (!fallback) {
      throw new BusinessRuleError(`No drawer configured for ${provider}`);
    }
    return fallback;
  }

  private _productUnitsTableExists(): boolean {
    return !!this.db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'product_units'`,
      )
      .get();
  }

  /**
   * Get today's expenses.
   *
   * LIRA-196: used to hand-roll `DATE(expense_date) = DATE('now')` — bare
   * UTC on both sides, no `'localtime'` shift at all. On the Fly web host
   * (UTC, no `TZ` pinned — rule 27) an expense logged between 00:00 and
   * 03:00 Beirut (still "today" in the shop's own calendar) failed this
   * predicate until the container's own UTC day caught up, silently
   * dropping it from the "Today's Expenses" list for up to 3 hours a
   * night. `isToday()` (`reportingTimeFragments.ts`, rule 14) shifts both
   * sides by the request's `clientTzOffsetMinutes` instead — the browser's
   * offset on web, SQLite's own `'localtime'` (the shop's own machine) on
   * desktop, so desktop behavior is unchanged.
   */
  getTodayExpenses(): ExpenseEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM expenses
         WHERE ${isToday("expense_date")} AND status != 'voided' AND tenant_id = ?
         ORDER BY expense_date DESC`,
      )
      .all(getCurrentTenantId()) as ExpenseEntity[];
  }

  /**
   * Get expense by ID
   */
  getExpenseById(id: number): ExpenseEntity | undefined {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM expenses WHERE id = ? AND tenant_id = ?`,
      )
      .get(id, getCurrentTenantId()) as ExpenseEntity | undefined;
  }

  /**
   * Delete an expense by ID and void its transaction
   */
  deleteExpense(id: number, userId: number): void {
    this.db.transaction(() => {
      // Void the unified transaction (if exists)
      const txnRepo = getTransactionRepository();
      const originalTxn = txnRepo.getBySourceId("expenses", id);
      if (originalTxn) {
        txnRepo.voidTransaction(originalTxn.id, userId);
      }
      // Soft-delete: mark as voided instead of removing the record
      this.db
        .prepare(
          "UPDATE expenses SET status = 'voided' WHERE id = ? AND tenant_id = ?",
        )
        .run(id, getCurrentTenantId());
    })();
  }

  /**
   * Update non-financial metadata on an expense record.
   * Only metadata fields are allowed — financial data is immutable.
   */
  updateMetadata(
    id: number,
    data: { description?: string; category?: string; note?: string },
    editedBy: string,
  ): ExpenseEntity | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.description !== undefined) {
      fields.push("description = ?");
      values.push(data.description);
    }
    if (data.category !== undefined) {
      fields.push("category = ?");
      values.push(data.category);
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
        `UPDATE expenses SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`,
      )
      .run(...values);

    return this.findById(id);
  }
}

// Singleton instance
let expenseRepositoryInstance: ExpenseRepository | null = null;

export function getExpenseRepository(): ExpenseRepository {
  if (!expenseRepositoryInstance) {
    expenseRepositoryInstance = new ExpenseRepository();
  }
  return expenseRepositoryInstance;
}

export function resetExpenseRepository(): void {
  expenseRepositoryInstance = null;
}
