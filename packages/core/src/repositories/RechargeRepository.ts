/**
 * Recharge Repository
 *
 * Handles recharge-specific queries (virtual stock).
 * Uses recharges and drawer_balances tables.
 */

import { BaseRepository } from "./BaseRepository.js";
import { rechargeLogger } from "../utils/logger.js";

import {
  paymentMethodToDrawerName,
  isDrawerAffectingMethod,
} from "../utils/payments.js";
import { getTransactionRepository } from "./TransactionRepository.js";
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
  currency?: string; // Defaults to "USD"
  paid_by_method?: RechargePaidByMethod;
  /** Multi-payment support: when provided, overrides paid_by_method */
  payments?: Array<{
    method: string;
    currencyCode: string;
    amount: number;
  }>;
  phoneNumber?: string;
  clientId?: number;
  clientName?: string;
  userId?: number;
}

export interface RechargeEntity {
  id: number;
  carrier: string;
  recharge_type: string;
  amount: number;
  cost: number;
  price: number;
  currency_code: string;
  paid_by: string;
  phone_number: string | null;
  client_id: number | null;
  client_name: string | null;
  note: string | null;
  created_at: string;
  created_by: number;
}

// =============================================================================
// Recharge Repository Class
// =============================================================================

export class RechargeRepository extends BaseRepository<RechargeEntity> {
  constructor() {
    super("recharges", { softDelete: false });
  }

  protected getColumns(): string {
    return "id, carrier, recharge_type, amount, cost, price, currency_code, paid_by, phone_number, client_id, client_name, note, created_at, created_by";
  }

  /**
   * Get recharge history for a specific provider
   */
  getHistory(provider: "MTC" | "Alfa"): RechargeEntity[] {
    const rows = this.db
      .prepare(
        `SELECT ${this.getColumns()}
         FROM recharges
         WHERE carrier = ?
         ORDER BY created_at DESC
         LIMIT 100`,
      )
      .all(provider) as RechargeEntity[];

    return rows;
  }

  /**
   * Get virtual stock totals for MTC and Alfa from drawer balances
   * This reads from the drawer_balances table instead of products table
   */
  getVirtualStock(currency = "USD"): VirtualStock {
    const mtc = this.db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'MTC' AND currency_code = ?",
      )
      .get(currency) as { balance: number | null };

    const alfa = this.db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'Alfa' AND currency_code = ?",
      )
      .get(currency) as { balance: number | null };

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

      this.db.transaction(() => {
        // Record the top-up in recharges table
        const rechargeResult = this.db
          .prepare(
            `INSERT INTO recharges (carrier, recharge_type, amount, cost, price, currency_code, paid_by, note, created_by)
             VALUES (?, 'TOP_UP', ?, 0, 0, ?, 'CASH', ?, ?)`,
          )
          .run(
            data.provider,
            Math.abs(data.amount),
            currency,
            `${data.provider} top-up: +${data.amount} ${currency}`,
            data.userId,
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
            `INSERT INTO drawer_balances (drawer_name, currency_code, balance)
             VALUES (?, ?, ?)
             ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
               balance = drawer_balances.balance + excluded.balance,
               updated_at = CURRENT_TIMESTAMP`,
          )
          .run(drawerName, currency, Math.abs(data.amount));
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
      // Validate source drawer has sufficient balance
      const sourceBalanceRow = this.db
        .prepare(
          "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ?",
        )
        .get(data.sourceDrawer, currency) as { balance: number | null };

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
            `INSERT INTO recharges (carrier, recharge_type, amount, cost, price, currency_code, paid_by, note, created_by)
             VALUES (?, 'TOP_UP', ?, 0, 0, ?, ?, ?, ?)`,
          )
          .run(
            data.provider,
            amount,
            currency,
            data.sourceDrawer,
            `${data.provider === "OMT_APP" ? "OMT App" : "Whish App"} top-up from ${data.sourceDrawer}: +${amount} ${currency}`,
            data.userId,
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
             WHERE drawer_name = ? AND currency_code = ?`,
          )
          .run(amount, data.sourceDrawer, currency);

        // Add to destination drawer
        this.db
          .prepare(
            `INSERT INTO drawer_balances (drawer_name, currency_code, balance)
             VALUES (?, ?, ?)
             ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
               balance = drawer_balances.balance + excluded.balance,
               updated_at = CURRENT_TIMESTAMP`,
          )
          .run(destDrawer, currency, amount);
      })();

      const providerLabel = TOP_UP_PROVIDER_LABELS[data.provider];

      rechargeLogger.info(
        {
          provider: data.provider,
          amount: data.amount,
          currency,
          sourceDrawer: data.sourceDrawer,
          destDrawer,
        },
        `${providerLabel} top-up: ${data.sourceDrawer} → ${destDrawer}: ${amount} ${currency}`,
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
   * Get all drawer balances
   */
  getDrawerBalances(): Array<{
    name: string;
    usdBalance: number;
    lbpBalance: number;
  }> {
    try {
      const rows = this.db
        .prepare(
          `SELECT drawer_name, currency_code, balance 
           FROM drawer_balances 
           WHERE currency_code IN ('USD', 'LBP')
           ORDER BY drawer_name`,
        )
        .all() as Array<{
        drawer_name: string;
        currency_code: string;
        balance: number;
      }>;

      // Group by drawer name
      const drawerMap = new Map<
        string,
        { usdBalance: number; lbpBalance: number }
      >();

      for (const row of rows) {
        if (!drawerMap.has(row.drawer_name)) {
          drawerMap.set(row.drawer_name, { usdBalance: 0, lbpBalance: 0 });
        }
        const drawer = drawerMap.get(row.drawer_name)!;
        if (row.currency_code === "USD") {
          drawer.usdBalance = row.balance;
        } else if (row.currency_code === "LBP") {
          drawer.lbpBalance = row.balance;
        }
      }

      return Array.from(drawerMap.entries()).map(([name, balances]) => ({
        name,
        usdBalance: balances.usdBalance,
        lbpBalance: balances.lbpBalance,
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
        const note = `${data.provider} ${data.type} - ${data.phoneNumber || "No Number"}`;
        const paidBy = data.paid_by_method || "CASH";
        const currency = data.currency ?? "USD";
        const createdBy = data.userId ?? 1;

        // 1. Create Recharge Record (goes into recharges table, not sales)
        const clientName = data.clientId
          ? ((
              this.db
                .prepare("SELECT name FROM clients WHERE id = ?")
                .get(data.clientId) as { name: string } | undefined
            )?.name ??
            data.clientName ??
            null)
          : (data.clientName ?? null);

        const insertRecharge = this.db.prepare(`
          INSERT INTO recharges (
            carrier, recharge_type, amount, cost, price, currency_code,
            paid_by, phone_number, client_id, client_name, note, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const rechargeResult = insertRecharge.run(
          data.provider,
          data.type,
          data.amount,
          data.cost,
          data.price,
          currency,
          paidBy,
          data.phoneNumber || null,
          data.clientId || null,
          clientName,
          note,
          createdBy,
        );
        const rechargeId = Number(rechargeResult.lastInsertRowid);

        // 2. Create unified transaction row
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.RECHARGE,
          source_table: "recharges",
          source_id: rechargeId,
          user_id: createdBy,
          amount_usd: currency === "USD" ? data.price : 0,
          amount_lbp: currency === "LBP" ? data.price : 0,
          client_id: data.clientId ?? null,
          client_name: clientName ?? null,
          summary: `Recharge: ${data.provider} ${data.type} ${currency === "LBP" ? "" : "$"}${data.price.toLocaleString()} ${currency}`,
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
        });

        // 3. Update running balances
        const methodDrawerName = paymentMethodToDrawerName(paidBy);
        const providerDrawerName = data.provider === "MTC" ? "MTC" : "Alfa";

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

        // Customer payment (cash-like inflow)
        let hasDebt = false;
        if (data.payments && data.payments.length > 0) {
          // Multi-payment mode
          for (const p of data.payments) {
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

        // Debt: create ledger entry when paid by DEBT
        if (hasDebt) {
          if (!data.clientId) {
            throw new Error("Cannot create debt without a client");
          }
          const debtAmount =
            data.payments && data.payments.length > 0
              ? data.payments
                  .filter((p) => !isDrawerAffectingMethod(p.method))
                  .reduce((sum, p) => sum + Math.abs(p.amount), 0)
              : data.price;
          this.db
            .prepare(
              `INSERT INTO debt_ledger (
                client_id, transaction_type, amount_usd, transaction_id, note, created_by, due_date
              ) VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+30 days'))`,
            )
            .run(
              data.clientId,
              "Recharge Debt",
              debtAmount,
              txnId,
              note,
              createdBy,
            );
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
