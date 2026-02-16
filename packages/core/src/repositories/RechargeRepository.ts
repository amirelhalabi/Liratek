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

        // Log to activity logs
        this.db
          .prepare(
            `INSERT INTO activity_logs (user_id, action, details_json, created_at)
             VALUES (1, 'Recharge Top Up', ?, CURRENT_TIMESTAMP)`,
          )
          .run(
            JSON.stringify({
              provider: data.provider,
              drawer: drawerName,
              amount: data.amount,
              currency,
            }),
          );
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
    saleId?: number;
    error?: string;
  } {
    try {
      const result = this.db.transaction(() => {
        // 1. Create Sale Record
        const note = `${data.provider} ${data.type} - ${data.phoneNumber || "No Number"}`;
        const insertSale = this.db.prepare(`
          INSERT INTO sales (
            total_amount_usd, final_amount_usd, paid_usd, status, note
          ) VALUES (?, ?, ?, 'completed', ?)
        `);
        const saleResult = insertSale.run(
          data.price,
          data.price,
          data.price,
          note,
        );
        const saleId = Number(saleResult.lastInsertRowid);

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
            source_type, source_id, method, drawer_name, currency_code, amount, note, created_by
          ) VALUES (
            'RECHARGE', ?, ?, ?, ?, ?, ?, ?
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
            saleId,
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
          saleId,
          data.provider === "MTC" ? "MTC" : "Alfa",
          providerDrawerName,
          currency,
          stockDelta,
          "Telecom balance sent",
          createdBy,
        );
        upsertBalanceDelta.run(providerDrawerName, currency, stockDelta);

        // 4. Log to activity logs
        this.db
          .prepare(
            `
          INSERT INTO activity_logs (user_id, action, details_json, created_at)
          VALUES (1, 'Recharge Transaction', ?, CURRENT_TIMESTAMP)
        `,
          )
          .run(
            JSON.stringify({
              drawer: `${providerDrawerName}_Drawer`,
              provider: data.provider,
              paid_by_method: paidBy,
              type: data.type,
              amount: data.amount,
              price: data.price,
              cost: data.cost,
            }),
          );

        return saleId;
      })();

      rechargeLogger.info(
        {
          saleId: result,
          provider: data.provider,
          type: data.type,
          amount: data.amount,
          price: data.price,
          paidBy: data.paid_by_method || "CASH",
        },
        `${data.provider} ${data.type}: ${data.amount} @ $${data.price}`,
      );

      return { success: true, saleId: result };
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
