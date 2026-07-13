/**
 * Recharge Repository
 *
 * Handles recharge-specific queries (virtual stock).
 * Uses recharges and drawer_balances tables.
 */

import { BaseRepository } from "./BaseRepository.js";
import { rechargeLogger } from "../utils/logger.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

import {
  paymentMethodToDrawerName,
  isDrawerAffectingMethod,
  partitionLegs,
} from "../utils/payments.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { getVoucherRepository } from "./VoucherRepository.js";
import { getDebtService } from "../services/DebtService.js";
import { getUsdLbpSellRate } from "../utils/exchangeRate.js";
import { getSupplierRepository } from "./SupplierRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import {
  type TopUpProvider,
  TOP_UP_PROVIDER_DRAWERS,
  TOP_UP_PROVIDER_LABELS,
} from "../constants/index.js";

// =============================================================================
// Entity Types
// =============================================================================

export interface VirtualStock {
  mtc: number;
  alfa: number;
}

export type RechargePaidByMethod = string;

export interface RechargeData {
  provider: "MTC" | "Alfa";
  type: "CREDIT_TRANSFER" | "VOUCHER" | "DAYS" | "TOP_UP" | "ALFA_GIFT";
  amount: number;
  cost: number;
  price: number;
  default_price_to_client?: number;
  currency?: string; // Defaults to "USD"
  paid_by_method?: RechargePaidByMethod;
  /** Multi-payment support: when provided, overrides paid_by_method */
  payments?: Array<{
    method: string;
    currencyCode: string;
    amount: number;
    /** Set when method === 'GIFT_CARD' — the voucher code being redeemed. */
    voucherCode?: string;
    /** IN (customer pays, default) or OUT (shop returns change to customer). */
    direction?: "IN" | "OUT";
  }>;
  phoneNumber?: string;
  clientId?: number;
  clientName?: string;
  userId?: number;
  transaction_time?: string;
  /** T3 keep-change (KC-3): kept (not returned) change per currency —
   *  added to the transaction's profit stamp (tender-native amounts). */
  kept_change_usd?: number;
  kept_change_lbp?: number;
  /**
   * Session-basket deferred payment mode. When true, the customer-cash inflow,
   * its debt, and any returned change are owned by the basket recorder; only the
   * telecom stock leg (and SMS cost) is written here. Non-session callers leave
   * this falsy → behavior is unchanged.
   */
  deferPayment?: boolean;
}

export interface RechargeEntity {
  id: number;
  carrier: string;
  recharge_type: string;
  amount: number;
  cost: number;
  price: number;
  default_price_to_client: number | null;
  currency_code: string;
  paid_by: string;
  phone_number: string | null;
  client_id: number | null;
  client_name: string | null;
  note: string | null;
  created_at: string;
  created_by: number;
  edited_by: string | null;
  edited_at: string | null;
}

// =============================================================================
// Summary/note formatting
// =============================================================================

const RECHARGE_TYPE_LABELS: Record<RechargeData["type"], string> = {
  CREDIT_TRANSFER: "Credits",
  VOUCHER: "Voucher",
  DAYS: "Days",
  TOP_UP: "Top-up",
  ALFA_GIFT: "Gift",
};

/**
 * Human-readable "what was actually recharged" detail, distinct from `price`
 * (what the customer was charged): DAYS is denominated in days, every other
 * type in the recharge's own dollar face value. Shown alongside price on the
 * unified transaction summary and the recharge/debt notes so an operator can
 * see both the quantity sold and the amount collected at a glance.
 */
function describeRechargeAmount(
  type: RechargeData["type"],
  amount: number,
): string {
  if (type === "DAYS") return `${amount} days`;
  if (type === "TOP_UP") return "";
  return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function rechargeDetailLabel(
  type: RechargeData["type"],
  amount: number,
): string {
  const label = RECHARGE_TYPE_LABELS[type] ?? type;
  const amountDetail = describeRechargeAmount(type, amount);
  return amountDetail ? `${label} ${amountDetail}` : label;
}

// =============================================================================
// Recharge Repository Class
// =============================================================================

export class RechargeRepository extends BaseRepository<RechargeEntity> {
  constructor() {
    super("recharges", { softDelete: false });
  }

  protected getColumns(): string {
    return "id, carrier, recharge_type, amount, cost, price, default_price_to_client, currency_code, paid_by, phone_number, client_id, client_name, note, created_at, created_by, edited_by, edited_at";
  }

  /**
   * Get recharge history for a specific provider
   */
  getHistory(provider: "MTC" | "Alfa"): RechargeEntity[] {
    const rows = this.db
      .prepare(
        `SELECT ${this.getColumns()}
         FROM recharges
         WHERE carrier = ? AND tenant_id = ?
         ORDER BY created_at DESC
         LIMIT 100`,
      )
      .all(provider, getCurrentTenantId()) as RechargeEntity[];

    return rows;
  }

  /**
   * Get virtual stock totals for MTC and Alfa from drawer balances
   * This reads from the drawer_balances table instead of products table
   */
  getVirtualStock(currency = "USD"): VirtualStock {
    const tenantId = getCurrentTenantId();
    const mtc = this.db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'MTC' AND currency_code = ? AND tenant_id = ?",
      )
      .get(currency, tenantId) as { balance: number | null };

    const alfa = this.db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'Alfa' AND currency_code = ? AND tenant_id = ?",
      )
      .get(currency, tenantId) as { balance: number | null };

    return {
      mtc: mtc?.balance || 0,
      alfa: alfa?.balance || 0,
    };
  }

  /**
   * Top up the MTC or Alfa drawer balance.
   * This is used when the shop owner loads credits onto their telecom account.
   * Records a TOP_UP entry in the recharges table.
   */
  topUp(data: {
    provider: "MTC" | "Alfa";
    amount: number;
    currency?: string;
    userId: number;
  }): { success: boolean; error?: string } {
    try {
      const drawerName = data.provider === "MTC" ? "MTC" : "Alfa";
      const currency = data.currency ?? "USD";
      const tenantId = getCurrentTenantId();

      this.db.transaction(() => {
        // Record the top-up in recharges table
        const rechargeResult = this.db
          .prepare(
            `INSERT INTO recharges (carrier, recharge_type, amount, cost, price, currency_code, paid_by, note, created_by, tenant_id)
             VALUES (?, 'TOP_UP', ?, 0, 0, ?, 'CASH', ?, ?, ?)`,
          )
          .run(
            data.provider,
            Math.abs(data.amount),
            currency,
            `${data.provider} top-up: +${data.amount} ${currency}`,
            data.userId,
            tenantId,
          );

        const rechargeId = Number(rechargeResult.lastInsertRowid);

        // Create unified transaction record
        getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.RECHARGE_TOPUP,
          source_table: "recharges",
          source_id: rechargeId,
          user_id: data.userId,
          amount_usd: currency === "USD" ? Math.abs(data.amount) : 0,
          amount_lbp: currency === "LBP" ? Math.abs(data.amount) : 0,
          summary: `${data.provider} top-up: +${Math.abs(data.amount)} ${currency}`,
          metadata_json: {
            provider: data.provider,
            amount: Math.abs(data.amount),
            currency,
            drawer: drawerName,
          },
        });

        // Increase the provider drawer balance
        this.db
          .prepare(
            `INSERT INTO drawer_balances (drawer_name, currency_code, balance, tenant_id)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET
               balance = drawer_balances.balance + excluded.balance,
               updated_at = CURRENT_TIMESTAMP`,
          )
          .run(drawerName, currency, Math.abs(data.amount), tenantId);
      })();

      rechargeLogger.info(
        { provider: data.provider, amount: data.amount, currency },
        `${data.provider} top-up: +${data.amount} ${currency}`,
      );

      return { success: true };
    } catch (error) {
      rechargeLogger.error({ error, data }, "Top-up failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Top up provider drawer from another drawer.
   * This is a drawer-to-drawer transfer with no fees or commission.
   * Records a TOP_UP entry in the recharges table.
   */
  topUpApp(data: {
    provider: TopUpProvider;
    amount: number;
    currency: string;
    sourceDrawer: string;
    userId: number;
  }): { success: boolean; error?: string } {
    try {
      const destDrawer = TOP_UP_PROVIDER_DRAWERS[data.provider];
      const currency = data.currency;
      const amount = Math.abs(data.amount);
      const tenantId = getCurrentTenantId();

      // Validate source drawer has sufficient balance
      const sourceBalanceRow = this.db
        .prepare(
          "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ? AND tenant_id = ?",
        )
        .get(data.sourceDrawer, currency, tenantId) as {
        balance: number | null;
      };

      const sourceBalance = sourceBalanceRow?.balance ?? 0;
      if (sourceBalance < amount) {
        return {
          success: false,
          error: `Insufficient balance in ${data.sourceDrawer}. Available: ${sourceBalance} ${currency}`,
        };
      }

      this.db.transaction(() => {
        // Record the top-up in recharges table
        const rechargeResult = this.db
          .prepare(
            `INSERT INTO recharges (carrier, recharge_type, amount, cost, price, currency_code, paid_by, note, created_by, tenant_id)
             VALUES (?, 'TOP_UP', ?, 0, 0, ?, ?, ?, ?, ?)`,
          )
          .run(
            data.provider,
            amount,
            currency,
            data.sourceDrawer,
            `${TOP_UP_PROVIDER_LABELS[data.provider]} top-up from ${data.sourceDrawer}: +${amount} ${currency}`,
            data.userId,
            tenantId,
          );

        const rechargeId = Number(rechargeResult.lastInsertRowid);

        // Create unified transaction record
        getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.RECHARGE_TOPUP,
          source_table: "recharges",
          source_id: rechargeId,
          user_id: data.userId,
          amount_usd: currency === "USD" ? amount : 0,
          amount_lbp: currency === "LBP" ? amount : 0,
          summary: `${TOP_UP_PROVIDER_LABELS[data.provider]} top-up: ${data.sourceDrawer} → ${destDrawer}: ${amount} ${currency}`,
          metadata_json: {
            provider: data.provider,
            amount,
            currency,
            sourceDrawer: data.sourceDrawer,
            destDrawer,
          },
        });

        // Deduct from source drawer
        this.db
          .prepare(
            `UPDATE drawer_balances SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP
             WHERE drawer_name = ? AND currency_code = ? AND tenant_id = ?`,
          )
          .run(amount, data.sourceDrawer, currency, tenantId);

        // Add to destination drawer
        this.db
          .prepare(
            `INSERT INTO drawer_balances (drawer_name, currency_code, balance, tenant_id)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET
               balance = drawer_balances.balance + excluded.balance,
               updated_at = CURRENT_TIMESTAMP`,
          )
          .run(destDrawer, currency, amount, tenantId);
      })();

      rechargeLogger.info(
        {
          provider: data.provider,
          amount: data.amount,
          currency,
          sourceDrawer: data.sourceDrawer,
          destDrawer,
        },
        `${TOP_UP_PROVIDER_LABELS[data.provider]} top-up: ${data.sourceDrawer} → ${destDrawer}: ${amount} ${currency}`,
      );

      return { success: true };
    } catch (error) {
      rechargeLogger.error({ error, data }, "App top-up failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Top up a provider drawer from an external cash source (no source drawer deduction).
   */
  topUpAppExternal(data: {
    provider: TopUpProvider;
    amount: number;
    currency: string;
    userId: number;
  }): { success: boolean; error?: string } {
    try {
      const destDrawer = TOP_UP_PROVIDER_DRAWERS[data.provider];
      const currency = data.currency;
      const amount = Math.abs(data.amount);
      const tenantId = getCurrentTenantId();

      this.db.transaction(() => {
        const rechargeResult = this.db
          .prepare(
            `INSERT INTO recharges (carrier, recharge_type, amount, cost, price, currency_code, paid_by, note, created_by, tenant_id)
             VALUES (?, 'TOP_UP', ?, 0, 0, ?, 'EXTERNAL', ?, ?, ?)`,
          )
          .run(
            data.provider,
            amount,
            currency,
            `${TOP_UP_PROVIDER_LABELS[data.provider]} external top-up: +${amount} ${currency}`,
            data.userId,
            tenantId,
          );

        const rechargeId = Number(rechargeResult.lastInsertRowid);

        getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.RECHARGE_TOPUP,
          source_table: "recharges",
          source_id: rechargeId,
          user_id: data.userId,
          amount_usd: currency === "USD" ? amount : 0,
          amount_lbp: currency === "LBP" ? amount : 0,
          summary: `${TOP_UP_PROVIDER_LABELS[data.provider]} external top-up → ${destDrawer}: ${amount} ${currency}`,
          metadata_json: {
            provider: data.provider,
            amount,
            currency,
            sourceDrawer: "EXTERNAL",
            destDrawer,
          },
        });

        this.db
          .prepare(
            `INSERT INTO drawer_balances (drawer_name, currency_code, balance, tenant_id)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET
               balance = drawer_balances.balance + excluded.balance,
               updated_at = CURRENT_TIMESTAMP`,
          )
          .run(destDrawer, currency, amount, tenantId);
      })();

      rechargeLogger.info(
        { provider: data.provider, amount, currency, destDrawer },
        `${TOP_UP_PROVIDER_LABELS[data.provider]} external top-up → ${destDrawer}: ${amount} ${currency}`,
      );

      return { success: true };
    } catch (error) {
      rechargeLogger.error({ error, data }, "External app top-up failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Top up the MTC/Alfa drawer with credits bought from a customer.
   * The customer transfers credits to the shop's line and is paid cash out of
   * the General drawer. Credits stock is always tracked in USD.
   * Books price = credits received and cost = cash paid, so the margin
   * (credits - cash) shows up as recharge profit at acquisition time.
   */
  topUpFromCustomer(data: {
    provider: "MTC" | "Alfa";
    creditsAmount: number;
    cashPaid: number;
    cashPaidCurrency: "USD" | "LBP";
    userId: number;
  }): { success: boolean; error?: string } {
    try {
      const destDrawer = TOP_UP_PROVIDER_DRAWERS[data.provider];
      const credits = Math.abs(data.creditsAmount);
      const cashPaid = Math.abs(data.cashPaid);
      const cashCurrency = data.cashPaidCurrency;
      const tenantId = getCurrentTenantId();

      if (credits <= 0) {
        return {
          success: false,
          error: "Credits amount must be greater than 0",
        };
      }

      // Validate the General drawer can cover the cash paid to the customer
      const generalRow = this.db
        .prepare(
          "SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = ? AND tenant_id = ?",
        )
        .get(cashCurrency, tenantId) as { balance: number | null } | undefined;

      const generalBalance = generalRow?.balance ?? 0;
      if (generalBalance < cashPaid) {
        return {
          success: false,
          error: `Insufficient balance in General drawer. Available: ${generalBalance} ${cashCurrency}`,
        };
      }

      this.db.transaction(() => {
        // Record the top-up in recharges table
        const rechargeResult = this.db
          .prepare(
            `INSERT INTO recharges (carrier, recharge_type, amount, cost, price, currency_code, paid_by, note, created_by, tenant_id)
             VALUES (?, 'TOP_UP', ?, ?, ?, 'USD', 'CUSTOMER', ?, ?, ?)`,
          )
          .run(
            data.provider,
            credits,
            cashPaid,
            credits,
            `${data.provider} top-up from customer: +${credits} credits, paid ${cashPaid} ${cashCurrency} cash`,
            data.userId,
            tenantId,
          );

        const rechargeId = Number(rechargeResult.lastInsertRowid);

        // Create unified transaction record
        getTransactionRepository().createTransaction({
          type:
            data.provider === "MTC"
              ? TRANSACTION_TYPES.MTC_TOPUP
              : TRANSACTION_TYPES.ALFA_TOPUP,
          source_table: "recharges",
          source_id: rechargeId,
          user_id: data.userId,
          amount_usd: credits,
          amount_lbp: 0,
          // Profit is tracked in USD only (the gained asset — credits — is
          // always USD). LBP cash paid out is converted at the sell rate and
          // subtracted here; splitting it as +credits USD / −cash LBP inflated
          // the USD profit bucket and dumped a phantom negative on LBP.
          profit_usd:
            credits -
            (cashCurrency === "LBP"
              ? cashPaid / getUsdLbpSellRate(this.db)
              : cashPaid),
          profit_lbp: 0,
          summary: `${data.provider} top-up from customer: +${credits} credits, -${cashPaid} ${cashCurrency} cash`,
          metadata_json: {
            provider: data.provider,
            creditsAmount: credits,
            cashPaid,
            cashPaidCurrency: cashCurrency,
            sourceDrawer: "General",
            destDrawer,
          },
        });

        // Pay the customer from the General drawer (in the chosen currency)
        if (cashPaid > 0) {
          this.db
            .prepare(
              `UPDATE drawer_balances SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP
               WHERE drawer_name = 'General' AND currency_code = ? AND tenant_id = ?`,
            )
            .run(cashPaid, cashCurrency, tenantId);
        }

        // Add the received credits to the provider drawer
        this.db
          .prepare(
            `INSERT INTO drawer_balances (drawer_name, currency_code, balance, tenant_id)
             VALUES (?, 'USD', ?, ?)
             ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET
               balance = drawer_balances.balance + excluded.balance,
               updated_at = CURRENT_TIMESTAMP`,
          )
          .run(destDrawer, credits, tenantId);
      })();

      rechargeLogger.info(
        {
          provider: data.provider,
          credits,
          cashPaid,
          cashCurrency,
          destDrawer,
        },
        `${data.provider} top-up from customer: +${credits} credits, -${cashPaid} ${cashCurrency} cash`,
      );

      return { success: true };
    } catch (error) {
      rechargeLogger.error({ error, data }, "Customer top-up failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get all drawer balances
   */
  getDrawerBalances(): Array<{
    name: string;
    usdBalance: number;
    lbpBalance: number;
    usdtBalance: number;
  }> {
    try {
      const rows = this.db
        .prepare(
          `SELECT drawer_name, currency_code, balance
           FROM drawer_balances
           WHERE currency_code IN ('USD', 'LBP', 'USDT') AND tenant_id = ?
           ORDER BY drawer_name`,
        )
        .all(getCurrentTenantId()) as Array<{
        drawer_name: string;
        currency_code: string;
        balance: number;
      }>;

      const drawerMap = new Map<
        string,
        { usdBalance: number; lbpBalance: number; usdtBalance: number }
      >();

      for (const row of rows) {
        if (!drawerMap.has(row.drawer_name)) {
          drawerMap.set(row.drawer_name, {
            usdBalance: 0,
            lbpBalance: 0,
            usdtBalance: 0,
          });
        }
        const drawer = drawerMap.get(row.drawer_name)!;
        if (row.currency_code === "USD") drawer.usdBalance = row.balance;
        else if (row.currency_code === "LBP") drawer.lbpBalance = row.balance;
        else if (row.currency_code === "USDT") drawer.usdtBalance = row.balance;
      }

      return Array.from(drawerMap.entries()).map(([name, balances]) => ({
        name,
        usdBalance: balances.usdBalance,
        lbpBalance: balances.lbpBalance,
        usdtBalance: balances.usdtBalance,
      }));
    } catch (error) {
      rechargeLogger.error({ error }, "Failed to get drawer balances");
      return [];
    }
  }

  /**
   * Process a recharge transaction (creates recharges row, updates drawers, logs activity)
   */
  processRecharge(data: RechargeData): {
    success: boolean;
    id?: number;
    error?: string;
  } {
    try {
      const result = this.db.transaction(() => {
        const detail = rechargeDetailLabel(data.type, data.amount);
        const note = `${data.provider} ${detail}${data.phoneNumber ? ` - ${data.phoneNumber}` : ""}`;
        const paidBy = data.paid_by_method || "CASH";
        const currency = data.currency ?? "USD";
        const createdBy = data.userId ?? 1;
        const tenantId = getCurrentTenantId();

        // 1. Create Recharge Record (goes into recharges table, not sales)
        const clientName = data.clientId
          ? ((
              this.db
                .prepare(
                  "SELECT full_name FROM clients WHERE id = ? AND tenant_id = ?",
                )
                .get(data.clientId, tenantId) as
                | { full_name: string }
                | undefined
            )?.full_name ??
            data.clientName ??
            null)
          : (data.clientName ?? null);

        const insertRecharge = this.db.prepare(`
          INSERT INTO recharges (
            carrier, recharge_type, amount, cost, price, default_price_to_client, currency_code,
            paid_by, phone_number, client_id, client_name, note, created_by, tenant_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
        `);
        const rechargeResult = insertRecharge.run(
          data.provider,
          data.type,
          data.amount,
          data.cost,
          data.price,
          data.default_price_to_client ?? null,
          currency,
          paidBy,
          data.phoneNumber || null,
          data.clientId || null,
          clientName,
          note,
          createdBy,
          tenantId,
          data.transaction_time ?? null,
        );
        const rechargeId = Number(rechargeResult.lastInsertRowid);

        // 2. Create unified transaction row
        // rechargeCommission is denominated in the SALE currency (price and
        // cost share it), but the SMS cost is a USD figure — for LBP-priced
        // transfers it must be converted before subtracting, otherwise ~$0.32
        // is shaved off an LBP amount (currency mixing).
        const rechargeCommission = data.price - data.cost;
        const SMS_COST_PER_SMS_USD = 0.16;
        const MAX_USD_PER_SMS = 3;
        const smsCount =
          data.type === "CREDIT_TRANSFER"
            ? Math.ceil(data.amount / MAX_USD_PER_SMS)
            : 0;
        const smsCostUsd = smsCount * SMS_COST_PER_SMS_USD;
        const sellRate = getUsdLbpSellRate(this.db);
        const smsCostInSaleCurrency =
          currency === "LBP" ? smsCostUsd * sellRate : smsCostUsd;
        const netRechargeCommission =
          rechargeCommission - smsCostInSaleCurrency;
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.RECHARGE,
          source_table: "recharges",
          source_id: rechargeId,
          user_id: createdBy,
          amount_usd: currency === "USD" ? data.price : 0,
          amount_lbp: currency === "LBP" ? data.price : 0,
          // Net commission (sale currency) + kept change (T3, tender-native).
          profit_usd:
            (currency === "USD" ? netRechargeCommission : 0) +
            (data.kept_change_usd ?? 0),
          profit_lbp:
            (currency === "LBP" ? netRechargeCommission : 0) +
            (data.kept_change_lbp ?? 0),
          client_id: data.clientId ?? null,
          client_name: clientName ?? null,
          summary: `Recharge: ${data.provider} ${detail} — ${currency === "LBP" ? "" : "$"}${data.price.toLocaleString()} ${currency}`,
          metadata_json: {
            provider: data.provider,
            type: data.type,
            amount: data.amount,
            cost: data.cost,
            price: data.price,
            currency,
            paid_by: paidBy,
            phone: data.phoneNumber,
          },
          exchange_rate: sellRate,
          transaction_time: data.transaction_time,
        });

        // 3. Update running balances
        const methodDrawerName = paymentMethodToDrawerName(paidBy);
        const providerDrawerName = data.provider === "MTC" ? "MTC" : "Alfa";

        // insertPayment / upsertBalanceDelta are shared prepared statements
        // used by several call sites below. Wrapped (rather than threading
        // tenant_id through every call site) so the existing `.run(...)`
        // call sites — all money-flow control logic, untouched — transparently
        // carry the current tenant. Predicates/columns only, per WP3b scope.
        const insertPaymentStmt = this.db.prepare(`
          INSERT INTO payments (
            transaction_id, method, drawer_name, currency_code, amount, note, created_by, tenant_id
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?
          )
        `);
        const insertPayment = {
          run: (
            transactionId: number,
            method: string,
            drawerName: string,
            currencyCode: string,
            amount: number,
            note: string | null,
            createdBy: number,
          ) =>
            insertPaymentStmt.run(
              transactionId,
              method,
              drawerName,
              currencyCode,
              amount,
              note,
              createdBy,
              tenantId,
            ),
        };

        // drawer_balances' PK is now (tenant_id, drawer_name, currency_code) —
        // the ON CONFLICT target must match it exactly or SQLite throws at
        // prepare time.
        const upsertBalanceDeltaStmt = this.db.prepare(`
          INSERT INTO drawer_balances (drawer_name, currency_code, balance, tenant_id)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET
            balance = drawer_balances.balance + excluded.balance,
            updated_at = CURRENT_TIMESTAMP
        `);
        const upsertBalanceDelta = {
          run: (drawerName: string, currencyCode: string, balance: number) =>
            upsertBalanceDeltaStmt.run(
              drawerName,
              currencyCode,
              balance,
              tenantId,
            ),
        };

        // Customer payment (cash-like inflow). Split returned-change (OUT) legs
        // out so the inflow loop and debt calc only see customer-paid (IN) legs.
        const { inLegs: inPayments, outLegs: returnLegs } = partitionLegs(
          data.payments,
        );
        const deferPayment = data.deferPayment === true;
        let hasDebt = false;
        if (deferPayment) {
          // Session basket owns the customer-cash inflow + debt + change.
          // Only the telecom stock leg (below) is recorded on this transaction.
        } else if (inPayments.length > 0) {
          // Multi-payment mode
          for (const p of inPayments) {
            if (p.method === "GIFT_CARD") {
              // Voucher leg — deposit the voucher's full value to the owner's
              // account; the charge is then consumed from that account as debt.
              getVoucherRepository().redeemByCode({
                code: (p.voucherCode ?? "").trim().toUpperCase(),
                context: "recharge",
                transactionId: txnId,
                userId: createdBy,
              });
              hasDebt = true;
              continue;
            }
            if (!isDrawerAffectingMethod(p.method)) {
              hasDebt = true;
              continue;
            }
            const drawer = paymentMethodToDrawerName(p.method);
            insertPayment.run(
              txnId,
              p.method,
              drawer,
              p.currencyCode,
              Math.abs(p.amount),
              note,
              createdBy,
            );
            upsertBalanceDelta.run(drawer, p.currencyCode, Math.abs(p.amount));
          }
        } else if (isDrawerAffectingMethod(paidBy)) {
          // Single payment (backwards-compatible)
          insertPayment.run(
            txnId,
            paidBy,
            methodDrawerName,
            currency,
            Math.abs(data.price),
            note,
            createdBy,
          );
          upsertBalanceDelta.run(
            methodDrawerName,
            currency,
            Math.abs(data.price),
          );
        } else {
          hasDebt = true;
        }

        // Telecom balance consumed (shop number stock — always in USD credits)
        const stockDelta = -Math.abs(data.amount);
        insertPayment.run(
          txnId,
          data.provider === "MTC" ? "MTC" : "Alfa",
          providerDrawerName,
          "USD",
          stockDelta,
          "Telecom balance sent",
          createdBy,
        );
        upsertBalanceDelta.run(providerDrawerName, "USD", stockDelta);

        // SMS cost deduction: each CREDIT_TRANSFER requires SMSes to send credits
        if (data.type === "CREDIT_TRANSFER" && smsCostUsd > 0) {
          insertPayment.run(
            txnId,
            "SMS_COST",
            providerDrawerName,
            "USD",
            -smsCostUsd,
            `SMS cost: ${smsCount} × $${SMS_COST_PER_SMS_USD}`,
            createdBy,
          );
          upsertBalanceDelta.run(providerDrawerName, "USD", -smsCostUsd);
        }

        // Debt: create ledger entry when paid by DEBT
        if (hasDebt) {
          if (!data.clientId) {
            throw new Error("Cannot create debt without a client");
          }
          const debtAmount =
            inPayments.length > 0
              ? inPayments
                  .filter((p) => !isDrawerAffectingMethod(p.method))
                  .reduce((sum, p) => sum + Math.abs(p.amount), 0)
              : data.price;
          this.db
            .prepare(
              `INSERT INTO debt_ledger (
                client_id, transaction_type, amount_usd, amount_lbp, transaction_id, note, created_by, tenant_id, due_date
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+30 days'))`,
            )
            .run(
              data.clientId,
              "Recharge Debt",
              currency === "USD" ? debtAmount : 0,
              currency === "LBP" ? debtAmount : 0,
              txnId,
              note,
              createdBy,
              tenantId,
            );
        }

        // Return (OUT) legs: change handed back via a chosen method or kept as
        // store credit. Debits the method's drawer, or deposits client credit.
        // Deferred (session basket): change is owned by the basket recorder.
        for (const r of deferPayment ? [] : returnLegs) {
          const amt = Math.abs(r.amount);
          if (amt <= 0) continue;
          if (r.method === "CUSTOMER_ACCOUNT") {
            if (!data.clientId) {
              throw new Error(
                "Client is required to return change as store credit",
              );
            }
            getDebtService().addCredit({
              clientId: data.clientId,
              amountUsd: r.currencyCode === "USD" ? amt : 0,
              amountLbp: r.currencyCode === "LBP" ? amt : 0,
              note: "Change returned",
              userId: createdBy,
            });
          } else if (isDrawerAffectingMethod(r.method)) {
            const drawer = paymentMethodToDrawerName(r.method);
            insertPayment.run(
              txnId,
              r.method,
              drawer,
              r.currencyCode,
              -amt,
              "Change returned",
              createdBy,
            );
            upsertBalanceDelta.run(drawer, r.currencyCode, -amt);
          }
        }

        return rechargeId;
      })();

      rechargeLogger.info(
        {
          id: result,
          provider: data.provider,
          type: data.type,
          amount: data.amount,
          price: data.price,
          paidBy: data.paid_by_method || "CASH",
        },
        `${data.provider} ${data.type}: ${data.amount} credits @ ${data.price.toLocaleString()} ${data.currency ?? "USD"}`,
      );

      return { success: true, id: result };
    } catch (error) {
      rechargeLogger.error({ error, data }, "Recharge failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Top up a Katsh or iPick provider drawer via supplier credit.
   * The supplier extends credit — no source drawer is deducted.
   * Records a TOP_UP entry in supplier_ledger (we now owe the supplier).
   */
  topUpFromSupplier(data: {
    provider: "iPick" | "Katsh";
    amount: number;
    currency: string;
    userId: number;
  }): { success: boolean; error?: string } {
    try {
      const destDrawer = TOP_UP_PROVIDER_DRAWERS[data.provider];
      const currency = data.currency;
      const amount = Math.abs(data.amount);
      const tenantId = getCurrentTenantId();

      // Find matching active supplier for this provider
      const supplier = getSupplierRepository().getByProvider(data.provider);

      this.db.transaction(() => {
        // Insert TOP_UP recharge record (no paid_by drawer — funded by supplier)
        const rechargeResult = this.db
          .prepare(
            `INSERT INTO recharges (carrier, recharge_type, amount, cost, price, currency_code, paid_by, note, created_by, tenant_id)
             VALUES (?, 'TOP_UP', ?, 0, 0, ?, 'SUPPLIER', ?, ?, ?)`,
          )
          .run(
            data.provider,
            amount,
            currency,
            `${TOP_UP_PROVIDER_LABELS[data.provider]} supplier top-up: +${amount} ${currency}`,
            data.userId,
            tenantId,
          );

        const rechargeId = Number(rechargeResult.lastInsertRowid);

        // Create unified transaction record
        getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.RECHARGE_TOPUP,
          source_table: "recharges",
          source_id: rechargeId,
          user_id: data.userId,
          amount_usd: currency === "USD" ? amount : 0,
          amount_lbp: currency === "LBP" ? amount : 0,
          summary: `${TOP_UP_PROVIDER_LABELS[data.provider]} supplier top-up → ${destDrawer}: ${amount} ${currency}`,
          metadata_json: {
            provider: data.provider,
            amount,
            currency,
            sourceDrawer: "SUPPLIER",
            destDrawer,
          },
        });

        // Record supplier ledger TOP_UP entry (liability — we now owe the supplier)
        if (supplier) {
          this.db
            .prepare(
              `INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, tenant_id, created_at)
               VALUES (?, 'TOP_UP', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            )
            .run(
              supplier.id,
              currency === "USD" ? amount : 0,
              currency === "LBP" ? amount : 0,
              `${TOP_UP_PROVIDER_LABELS[data.provider]} supplier top-up: +${amount} ${currency}`,
              data.userId,
              tenantId,
            );
        }

        // Increase the provider drawer balance
        this.db
          .prepare(
            `INSERT INTO drawer_balances (drawer_name, currency_code, balance, tenant_id)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET
               balance = drawer_balances.balance + excluded.balance,
               updated_at = CURRENT_TIMESTAMP`,
          )
          .run(destDrawer, currency, amount, tenantId);
      })();

      rechargeLogger.info(
        {
          provider: data.provider,
          amount,
          currency,
          destDrawer,
          supplierId: supplier?.id ?? null,
        },
        `${TOP_UP_PROVIDER_LABELS[data.provider]} supplier top-up → ${destDrawer}: ${amount} ${currency}`,
      );

      return { success: true };
    } catch (error) {
      rechargeLogger.error({ error, data }, "Supplier top-up failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Top up the Whish App drawer via a partner.
   * The partner extends credit — no source drawer is deducted.
   * Records a WHISH_TOPUP partner_ledger entry with direction CREDIT
   * (we now owe the partner).
   */
  topUpFromPartner(data: {
    provider: "WHISH_APP";
    partnerId: number;
    amount: number;
    currency: string;
    userId: number;
  }): { success: boolean; error?: string } {
    try {
      const destDrawer = TOP_UP_PROVIDER_DRAWERS[data.provider];
      const currency = data.currency;
      const amount = Math.abs(data.amount);
      const tenantId = getCurrentTenantId();

      // Validate the partner exists and is active
      const partner = this.db
        .prepare(
          "SELECT id FROM partners WHERE id = ? AND is_active = 1 AND tenant_id = ?",
        )
        .get(data.partnerId, tenantId) as { id: number } | undefined;
      if (!partner) {
        return { success: false, error: "Partner not found" };
      }

      this.db.transaction(() => {
        // Insert TOP_UP recharge record (funded by partner)
        const rechargeResult = this.db
          .prepare(
            `INSERT INTO recharges (carrier, recharge_type, amount, cost, price, currency_code, paid_by, note, created_by, tenant_id)
             VALUES ('WHISH_APP', 'TOP_UP', ?, 0, 0, ?, 'PARTNER', ?, ?, ?)`,
          )
          .run(
            amount,
            currency,
            `${TOP_UP_PROVIDER_LABELS[data.provider]} top-up via partner: +${amount} ${currency}`,
            data.userId,
            tenantId,
          );

        const rechargeId = Number(rechargeResult.lastInsertRowid);

        // Record partner ledger CREDIT entry (we now owe the partner).
        // Inlined here (not via addLedgerEntry) to stay in this transaction.
        this.db
          .prepare(
            `INSERT INTO partner_ledger (partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, user_id, tenant_id, created_at)
             VALUES (?, 'WHISH_TOPUP', 'recharges', ?, ?, ?, 'CREDIT', ?, ?, CURRENT_TIMESTAMP)`,
          )
          .run(
            data.partnerId,
            rechargeId,
            amount,
            currency,
            data.userId,
            tenantId,
          );

        // Create unified transaction record
        getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.RECHARGE_TOPUP,
          source_table: "recharges",
          source_id: rechargeId,
          user_id: data.userId,
          amount_usd: currency === "USD" ? amount : 0,
          amount_lbp: currency === "LBP" ? amount : 0,
          summary: `Whish App top-up via partner: +${amount} ${currency}`,
          metadata_json: {
            provider: data.provider,
            partnerId: data.partnerId,
            amount,
            currency,
            destDrawer,
          },
        });

        // Increase the Whish App drawer balance
        this.db
          .prepare(
            `INSERT INTO drawer_balances (drawer_name, currency_code, balance, tenant_id)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET
               balance = drawer_balances.balance + excluded.balance,
               updated_at = CURRENT_TIMESTAMP`,
          )
          .run(destDrawer, currency, amount, tenantId);
      })();

      rechargeLogger.info(
        {
          provider: data.provider,
          partnerId: data.partnerId,
          amount,
          currency,
          destDrawer,
        },
        `Whish App top-up via partner: +${amount} ${currency}`,
      );

      return { success: true };
    } catch (error) {
      rechargeLogger.error({ error, data }, "Partner top-up failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Top up the Whish App drawer with credits transferred by a client.
   * The client transfers Whish credits to the shop and is paid cash out of
   * the General drawer. Both legs share the same currency. The shop's cut
   * (credits received − cash paid) is booked as profit at acquisition time.
   */
  topUpFromClient(data: {
    amount: number;
    cashPaid: number;
    currency: string;
    clientName?: string;
    clientId?: number;
    userId: number;
  }): { success: boolean; error?: string } {
    try {
      const destDrawer = TOP_UP_PROVIDER_DRAWERS.WHISH_APP;
      const currency = data.currency;
      const amount = Math.abs(data.amount);
      const cashPaid = Math.abs(data.cashPaid);
      const tenantId = getCurrentTenantId();

      if (amount <= 0) {
        return { success: false, error: "Amount must be greater than 0" };
      }

      // Validate the General drawer can cover the cash paid to the client
      const generalRow = this.db
        .prepare(
          "SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = ? AND tenant_id = ?",
        )
        .get(currency, tenantId) as { balance: number | null } | undefined;

      const generalBalance = generalRow?.balance ?? 0;
      if (generalBalance < cashPaid) {
        return {
          success: false,
          error: `Insufficient balance in General drawer. Available: ${generalBalance} ${currency}`,
        };
      }

      const profit = amount - cashPaid;

      this.db.transaction(() => {
        // Record the top-up in recharges table
        const rechargeResult = this.db
          .prepare(
            `INSERT INTO recharges (carrier, recharge_type, amount, cost, price, currency_code, paid_by, note, created_by, tenant_id)
             VALUES ('WHISH_APP', 'TOP_UP', ?, ?, ?, ?, 'CLIENT', ?, ?, ?)`,
          )
          .run(
            amount,
            cashPaid,
            amount,
            currency,
            `Whish App top-up from client: +${amount} credits, paid ${cashPaid} ${currency} cash`,
            data.userId,
            tenantId,
          );

        const rechargeId = Number(rechargeResult.lastInsertRowid);

        // Create unified transaction record
        getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.RECHARGE_TOPUP,
          source_table: "recharges",
          source_id: rechargeId,
          user_id: data.userId,
          amount_usd: currency === "USD" ? amount : 0,
          amount_lbp: currency === "LBP" ? amount : 0,
          profit_usd: currency === "USD" ? profit : 0,
          profit_lbp: currency === "LBP" ? profit : 0,
          client_id: data.clientId ?? null,
          client_name: data.clientName ?? null,
          summary: `Whish App top-up from client: +${amount} credits, -${cashPaid} ${currency} cash`,
          metadata_json: {
            provider: "WHISH_APP",
            amount,
            cashPaid,
            currency,
            clientId: data.clientId ?? null,
            clientName: data.clientName ?? null,
            sourceDrawer: "General",
            destDrawer,
          },
        });

        // Pay the client from the General drawer (same currency)
        if (cashPaid > 0) {
          this.db
            .prepare(
              `UPDATE drawer_balances SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP
               WHERE drawer_name = 'General' AND currency_code = ? AND tenant_id = ?`,
            )
            .run(cashPaid, currency, tenantId);
        }

        // Add the received credits to the Whish App drawer
        this.db
          .prepare(
            `INSERT INTO drawer_balances (drawer_name, currency_code, balance, tenant_id)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET
               balance = drawer_balances.balance + excluded.balance,
               updated_at = CURRENT_TIMESTAMP`,
          )
          .run(destDrawer, currency, amount, tenantId);
      })();

      rechargeLogger.info(
        {
          amount,
          cashPaid,
          currency,
          clientId: data.clientId ?? null,
          destDrawer,
        },
        `Whish App top-up from client: +${amount} credits, -${cashPaid} ${currency} cash`,
      );

      return { success: true };
    } catch (error) {
      rechargeLogger.error({ error, data }, "Client top-up failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Update non-financial metadata on a recharge record.
   * Only metadata fields are allowed — financial data is immutable.
   */
  updateMetadata(
    id: number,
    data: { phone_number?: string; client_name?: string; note?: string },
    editedBy: string,
  ): RechargeEntity | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.phone_number !== undefined) {
      fields.push("phone_number = ?");
      values.push(data.phone_number);
    }
    if (data.client_name !== undefined) {
      fields.push("client_name = ?");
      values.push(data.client_name);
    }
    if (data.note !== undefined) {
      fields.push("note = ?");
      values.push(data.note);
    }

    if (fields.length === 0) return existing;

    fields.push("edited_by = ?", "edited_at = CURRENT_TIMESTAMP");
    values.push(editedBy);
    values.push(id, getCurrentTenantId());

    this.db
      .prepare(
        `UPDATE recharges SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`,
      )
      .run(...values);

    return this.findById(id);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let rechargeRepositoryInstance: RechargeRepository | null = null;

export function getRechargeRepository(): RechargeRepository {
  if (!rechargeRepositoryInstance) {
    rechargeRepositoryInstance = new RechargeRepository();
  }
  return rechargeRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetRechargeRepository(): void {
  rechargeRepositoryInstance = null;
}
