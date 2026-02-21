/**
 * Recharge Repository
 *
 * Handles recharge-specific queries (virtual stock).
 * Uses products and sales tables.
 */

import { BaseRepository } from "./BaseRepository.js";
import { rechargeLogger } from "../utils/logger.js";

import {
  paymentMethodToDrawerName,
  isDrawerAffectingMethod,
} from "../utils/payments.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";

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
  type: "CREDIT_TRANSFER" | "VOUCHER" | "DAYS";
  amount: number;
  cost: number;
  price: number;
  currency?: string; // Defaults to "USD"
  paid_by_method?: RechargePaidByMethod;
  phoneNumber?: string;
  clientId?: number;
}

// =============================================================================
// Recharge Repository Class
// =============================================================================

export class RechargeRepository extends BaseRepository<{ id: number }> {
  constructor() {
    super("products", { softDelete: false });
  }

  // Override getColumns() - This repository uses drawer_balances for virtual stock, not products directly
  protected getColumns(): string {
    return "id, barcode, name, item_type, category, description, cost_price_usd, selling_price_usd, min_stock_level, stock_quantity, imei, color, image_url, warranty_expiry, status, is_active, created_at, is_deleted, updated_at";
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
   */
  topUp(data: {
    provider: "MTC" | "Alfa";
    amount: number;
    currency?: string;
  }): { success: boolean; error?: string } {
    try {
      const drawerName = data.provider === "MTC" ? "MTC" : "Alfa";
      const currency = data.currency ?? "USD";

      this.db.transaction(() => {
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
   * Process a recharge transaction (creates sale, deducts stock, logs activity)
   */
  processRecharge(data: RechargeData): {
    success: boolean;
    id?: number;
    error?: string;
  } {
    try {
      const result = this.db.transaction(() => {
        // 1. Create Sale Record
        const note = `${data.provider} ${data.type} - ${data.phoneNumber || "No Number"}`;
        const insertSale = this.db.prepare(`
          INSERT INTO sales (
            client_id, total_amount_usd, final_amount_usd, paid_usd, status, note
          ) VALUES (?, ?, ?, ?, 'completed', ?)
        `);
        const saleResult = insertSale.run(
          data.clientId || null,
          data.price,
          data.price,
          data.paid_by_method === "DEBT" ? 0 : data.price,
          note,
        );
        const saleId = Number(saleResult.lastInsertRowid);

        // Create unified transaction row
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.RECHARGE,
          source_table: "sales",
          source_id: saleId,
          user_id: 1,
          amount_usd: data.price,
          client_id: data.clientId ?? null,
          summary: `Recharge: ${data.provider} ${data.type} $${data.price}`,
          metadata_json: {
            provider: data.provider,
            type: data.type,
            amount: data.amount,
            cost: data.cost,
            price: data.price,
            paid_by: data.paid_by_method ?? "CASH",
            phone: data.phoneNumber,
          },
        });

        // 2. Update running balances
        // - Customer payment increases the selected method drawer by the FULL price.
        // - Telecom balance (MTC/Alfa) decreases by the recharge `amount` (shop number balance sent).
        const paidBy = data.paid_by_method || "CASH";

        const methodDrawerName = paymentMethodToDrawerName(paidBy);

        const providerDrawerName = data.provider === "MTC" ? "MTC" : "Alfa";
        const currency = data.currency ?? "USD";
        const createdBy = 1;

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
        // Non-drawer-affecting methods (DEBT) skip drawer movement.
        if (isDrawerAffectingMethod(paidBy)) {
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
        }

        // Telecom balance consumed (shop number stock)
        const stockDelta = -Math.abs(data.amount);
        insertPayment.run(
          txnId,
          data.provider === "MTC" ? "MTC" : "Alfa",
          providerDrawerName,
          currency,
          stockDelta,
          "Telecom balance sent",
          createdBy,
        );
        upsertBalanceDelta.run(providerDrawerName, currency, stockDelta);

        // Debt: create ledger entry when paid by DEBT
        if (paidBy === "DEBT") {
          if (!data.clientId) {
            throw new Error("Cannot create debt without a client");
          }
          this.db
            .prepare(
              `INSERT INTO debt_ledger (
                client_id, transaction_type, amount_usd, transaction_id, note, created_by, due_date
              ) VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+30 days'))`,
            )
            .run(
              data.clientId,
              "Recharge Debt",
              data.price,
              txnId,
              note,
              createdBy,
            );
        }

        return saleId;
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
        `${data.provider} ${data.type}: ${data.amount} @ $${data.price}`,
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
