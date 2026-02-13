/**
 * Recharge Repository
 *
 * Handles recharge-specific queries (virtual stock).
 * Uses products and sales tables.
 */

import { BaseRepository } from "./BaseRepository.js";

// =============================================================================
// Entity Types
// =============================================================================

export interface VirtualStock {
  mtc: number;
  alfa: number;
}

export type RechargePaidByMethod =
  | "CASH"
  | "DEBT"
  | "OMT"
  | "WHISH"
  | "BINANCE";

export interface RechargeData {
  provider: "MTC" | "Alfa";
  type: "CREDIT_TRANSFER" | "VOUCHER" | "DAYS";
  amount: number;
  cost: number;
  price: number;
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

  /**
   * Get virtual stock totals for MTC and Alfa from drawer balances
   * This reads from the drawer_balances table instead of products table
   */
  getVirtualStock(): VirtualStock {
    const mtc = this.db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'MTC' AND currency_code = 'USD'",
      )
      .get() as { balance: number | null };

    const alfa = this.db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'Alfa' AND currency_code = 'USD'",
      )
      .get() as { balance: number | null };

    return {
      mtc: mtc?.balance || 0,
      alfa: alfa?.balance || 0,
    };
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

        // 2. Deduct Virtual Stock (if applicable)
        if (data.type === "CREDIT_TRANSFER") {
          const itemType =
            data.provider === "MTC" ? "Virtual_MTC" : "Virtual_Alfa";

          // Find the virtual product or create if not exists
          let product = this.db
            .prepare("SELECT id FROM products WHERE item_type = ? LIMIT 1")
            .get(itemType) as { id: number } | undefined;

          if (!product) {
            // Auto-create virtual product bucket if missing
            const createProd = this.db.prepare(`
              INSERT INTO products (name, item_type, stock_quantity, cost_price_usd, selling_price_usd)
              VALUES (?, ?, ?, 1, 1)
            `);
            const res = createProd.run(
              `${data.provider} Virtual Credit`,
              itemType,
              1000,
            );
            product = { id: Number(res.lastInsertRowid) };
          }

          // Deduct stock
          this.db
            .prepare(
              "UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?",
            )
            .run(data.amount, product.id);

          // Link to Sale Items
          this.db
            .prepare(
              `
            INSERT INTO sale_items (sale_id, product_id, quantity, sold_price_usd, cost_price_snapshot_usd)
            VALUES (?, ?, ?, ?, ?)
          `,
            )
            .run(saleId, product.id, data.amount, data.price, data.cost);
        }

        // 3. Update running balances
        // - Customer payment increases the selected method drawer by the FULL price.
        // - Telecom balance (MTC/Alfa) decreases by the recharge `amount` (shop number balance sent).
        const paidBy = data.paid_by_method || "CASH";

        const methodDrawerName =
          paidBy === "CASH"
            ? "General"
            : paidBy === "DEBT"
              ? "General" // placeholder; DEBT does not move drawers
              : paidBy === "OMT"
                ? "OMT_System"
                : paidBy === "WHISH"
                  ? "Whish_App"
                  : "Binance";

        const providerDrawerName = data.provider === "MTC" ? "MTC" : "Alfa";
        const createdBy = 1;

        const insertPayment = this.db.prepare(`
          INSERT INTO payments (
            source_type, source_id, method, drawer_name, currency_code, amount, note, created_by
          ) VALUES (
            'RECHARGE', ?, ?, ?, 'USD', ?, ?, ?
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
        // DEBT means no drawer movement.
        if (paidBy !== "DEBT") {
          insertPayment.run(
            saleId,
            paidBy,
            methodDrawerName,
            Math.abs(data.price),
            note,
            createdBy,
          );
          upsertBalanceDelta.run(methodDrawerName, "USD", Math.abs(data.price));
        }

        // Telecom balance consumed (shop number stock)
        const stockDelta = -Math.abs(data.amount);
        insertPayment.run(
          saleId,
          data.provider === "MTC" ? "MTC" : "Alfa",
          providerDrawerName,
          stockDelta,
          "Telecom balance sent",
          createdBy,
        );
        upsertBalanceDelta.run(providerDrawerName, "USD", stockDelta);

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

      console.log(
        `[RECHARGE] ${data.provider} ${data.type}: ${data.amount} @ $${data.price} paid_by=${data.paid_by_method || "CASH"}`,
      );

      return { success: true, saleId: result };
    } catch (error) {
      console.error("Recharge failed:", error);
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
