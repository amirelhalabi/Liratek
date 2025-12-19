/**
 * Recharge Repository
 * 
 * Handles recharge-specific queries (virtual stock).
 * Uses products and sales tables.
 */

import { BaseRepository } from './BaseRepository';

// =============================================================================
// Entity Types
// =============================================================================

export interface VirtualStock {
  mtc: number;
  alfa: number;
}

export interface RechargeData {
  provider: 'MTC' | 'Alfa';
  type: 'CREDIT_TRANSFER' | 'VOUCHER' | 'DAYS';
  amount: number;
  cost: number;
  price: number;
  phoneNumber?: string;
}

// =============================================================================
// Recharge Repository Class
// =============================================================================

export class RechargeRepository extends BaseRepository<{ id: number }> {
  constructor() {
    super('products', { softDelete: false });
  }

  /**
   * Get virtual stock totals for MTC and Alfa
   */
  getVirtualStock(): VirtualStock {
    const mtc = this.db.prepare(
      "SELECT SUM(stock_quantity) as total FROM products WHERE item_type = 'Virtual_MTC'"
    ).get() as { total: number | null };
    
    const alfa = this.db.prepare(
      "SELECT SUM(stock_quantity) as total FROM products WHERE item_type = 'Virtual_Alfa'"
    ).get() as { total: number | null };

    return {
      mtc: mtc?.total || 0,
      alfa: alfa?.total || 0
    };
  }

  /**
   * Process a recharge transaction (creates sale, deducts stock, logs activity)
   */
  processRecharge(data: RechargeData): { success: boolean; saleId?: number; error?: string } {
    try {
      const result = this.db.transaction(() => {
        // 1. Create Sale Record
        const note = `${data.provider} ${data.type} - ${data.phoneNumber || 'No Number'}`;
        const insertSale = this.db.prepare(`
          INSERT INTO sales (
            total_amount_usd, final_amount_usd, paid_usd, status, note
          ) VALUES (?, ?, ?, 'completed', ?)
        `);
        const saleResult = insertSale.run(data.price, data.price, data.price, note);
        const saleId = Number(saleResult.lastInsertRowid);

        // 2. Deduct Virtual Stock (if applicable)
        if (data.type === 'CREDIT_TRANSFER') {
          const itemType = data.provider === 'MTC' ? 'Virtual_MTC' : 'Virtual_Alfa';

          // Find the virtual product or create if not exists
          let product = this.db.prepare(
            'SELECT id FROM products WHERE item_type = ? LIMIT 1'
          ).get(itemType) as { id: number } | undefined;

          if (!product) {
            // Auto-create virtual product bucket if missing
            const createProd = this.db.prepare(`
              INSERT INTO products (name, item_type, stock_quantity, cost_price_usd, selling_price_usd)
              VALUES (?, ?, ?, 1, 1)
            `);
            const res = createProd.run(`${data.provider} Virtual Credit`, itemType, 1000);
            product = { id: Number(res.lastInsertRowid) };
          }

          // Deduct stock
          this.db.prepare(
            'UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?'
          ).run(data.amount, product.id);

          // Link to Sale Items
          this.db.prepare(`
            INSERT INTO sale_items (sale_id, product_id, quantity, sold_price_usd, cost_price_snapshot_usd)
            VALUES (?, ?, ?, ?, ?)
          `).run(saleId, product.id, data.amount, data.price, data.cost);
        }

        // 3. Log to activity logs
        this.db.prepare(`
          INSERT INTO activity_logs (user_id, action, details_json, created_at)
          VALUES (1, 'Recharge Transaction', ?, CURRENT_TIMESTAMP)
        `).run(JSON.stringify({
          drawer: 'General_Drawer_B',
          provider: data.provider,
          type: data.type,
          amount: data.amount,
          price: data.price,
          cost: data.cost
        }));

        return saleId;
      })();

      console.log(
        `[RECHARGE] ${data.provider} ${data.type}: ${data.amount} @ $${data.price} [Drawer B]`
      );

      return { success: true, saleId: result };
    } catch (error: any) {
      console.error('Recharge failed:', error);
      return { success: false, error: error.message };
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
