/**
 * Sales Repository
 * 
 * Handles all database operations for sales and sale_items.
 * Extends BaseRepository for standard CRUD operations.
 */

import { BaseRepository } from './BaseRepository';
import { DatabaseError } from '../../utils/errors';

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
  status: 'completed' | 'draft' | 'cancelled' | 'refunded';
  note: string | null;
  created_at: string;
  created_by?: number;
}

export interface SaleItemEntity {
  id: number;
  sale_id: number;
  product_id: number;
  quantity: number;
  sold_price_usd: number;
  cost_price_snapshot_usd: number;
  is_refunded: number;
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

export interface SaleRequest {
  client_id: number | null;
  client_name?: string;
  client_phone?: string;
  items: { product_id: number; quantity: number; price: number }[];
  total_amount: number;
  discount: number;
  final_amount: number;
  payment_usd: number;
  payment_lbp: number;
  change_given_usd?: number;
  change_given_lbp?: number;
  exchange_rate: number;
  drawer_name?: string;
  id?: number;
  status?: 'completed' | 'draft' | 'cancelled';
  note?: string;
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

export class SalesRepository extends BaseRepository<SaleEntity> {
  constructor() {
    super('sales', { softDelete: false });
  }

  // ---------------------------------------------------------------------------
  // Full Transaction Processing
  // ---------------------------------------------------------------------------

  /**
   * Process a complete sale transaction (create/update with items, stock, debt)
   * This wraps all sale operations in a single transaction
   */
  processSale(sale: SaleRequest): { success: boolean; saleId?: number; error?: string } {
    const db = this.db;
    const tableName = this.tableName;

    try {
      const processTransaction = db.transaction(() => {
        let finalClientId = sale.client_id;
        const status = sale.status || 'completed';

        // Auto-create client if name provided but no ID
        if (!finalClientId && sale.client_name) {
          try {
            const createClient = db.prepare(`
              INSERT INTO clients (full_name, phone_number, whatsapp_opt_in)
              VALUES (?, ?, 0)
            `);
            const clientResult = createClient.run(
              sale.client_name,
              sale.client_phone || null
            );
            finalClientId = clientResult.lastInsertRowid as number;
          } catch (e) {
            console.error('Auto-create client failed', e);
          }
        }

        let saleId = sale.id;

        if (saleId) {
          // UPDATE Existing Sale
          const updateStmt = db.prepare(`
            UPDATE ${tableName} SET 
              client_id = ?, total_amount_usd = ?, discount_usd = ?, final_amount_usd = ?, 
              paid_usd = ?, paid_lbp = ?, change_given_usd = ?, change_given_lbp = ?, 
              exchange_rate_snapshot = ?, drawer_name = ?, status = ?, note = ?
            WHERE id = ?
          `);
          updateStmt.run(
            finalClientId,
            sale.total_amount,
            sale.discount,
            sale.final_amount,
            sale.payment_usd,
            sale.payment_lbp,
            sale.change_given_usd || 0,
            sale.change_given_lbp || 0,
            sale.exchange_rate,
            sale.drawer_name || 'General_Drawer_B',
            status,
            sale.note || null,
            saleId
          );

          // Clear old items to re-insert new ones
          db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(saleId);
        } else {
          // INSERT New Sale
          const saleStmt = db.prepare(`
            INSERT INTO ${tableName} (
              client_id, total_amount_usd, discount_usd, final_amount_usd, 
              paid_usd, paid_lbp, change_given_usd, change_given_lbp, exchange_rate_snapshot,
              drawer_name, status, note
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          const saleResult = saleStmt.run(
            finalClientId,
            sale.total_amount,
            sale.discount,
            sale.final_amount,
            sale.payment_usd,
            sale.payment_lbp,
            sale.change_given_usd || 0,
            sale.change_given_lbp || 0,
            sale.exchange_rate,
            sale.drawer_name || 'General_Drawer_B',
            status,
            sale.note || null
          );
          saleId = saleResult.lastInsertRowid as number;
        }

        // Process Items & Update Stock
        const itemStmt = db.prepare(`
          INSERT INTO sale_items (
            sale_id, product_id, quantity, sold_price_usd, cost_price_snapshot_usd
          ) VALUES (?, ?, ?, ?, (SELECT cost_price_usd FROM products WHERE id = ?))
        `);

        const stockStmt = db.prepare(`
          UPDATE products 
          SET stock_quantity = stock_quantity - ? 
          WHERE id = ?
        `);

        for (const item of sale.items) {
          itemStmt.run(saleId, item.product_id, item.quantity, item.price, item.product_id);

          // Update Stock: ONLY IF COMPLETED
          if (status === 'completed') {
            stockStmt.run(item.quantity, item.product_id);
          }
        }

        // Handle Debt (If Partial Payment AND Completed)
        if (status === 'completed') {
          const totalPaidUSD = sale.payment_usd + (sale.payment_lbp / sale.exchange_rate);
          if (sale.final_amount - totalPaidUSD > 0.05) {
            if (!finalClientId) {
              throw new Error('Cannot create debt for anonymous client');
            }
            const debtAmount = sale.final_amount - totalPaidUSD;

            const debtStmt = db.prepare(`
              INSERT INTO debt_ledger (
                client_id, transaction_type, amount_usd, sale_id, note
              ) VALUES (?, 'Sale Debt', ?, ?, 'Balance from Sale')
            `);
            debtStmt.run(finalClientId, debtAmount, saleId);
          }
        }

        // Log the activity
        const logStmt = db.prepare(`
          INSERT INTO activity_logs (user_id, action, table_name, record_id, details_json)
          VALUES (?, ?, 'sales', ?, ?)
        `);
        logStmt.run(
          1, // Default user ID
          'SALE',
          saleId,
          JSON.stringify({
            drawer: sale.drawer_name || 'General_Drawer_B',
            amount_usd: sale.payment_usd,
            amount_lbp: sale.payment_lbp,
            status
          })
        );

        return { success: true, saleId };
      });

      return processTransaction();
    } catch (error: any) {
      console.error('Sale transaction failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ---------------------------------------------------------------------------
  // Core Sales Operations
  // ---------------------------------------------------------------------------

  /**
   * Get all draft sales with client info and items
   */
  findDrafts(): DraftSaleWithItems[] {
    try {
      const drafts = this.query<SaleWithClient>(`
        SELECT s.*, c.full_name as client_name, c.phone_number as client_phone 
        FROM ${this.tableName} s 
        LEFT JOIN clients c ON s.client_id = c.id
        WHERE s.status = 'draft'
        ORDER BY s.created_at DESC
      `);

      return drafts.map((draft) => {
        const items = this.query<SaleItemWithProduct>(`
          SELECT si.*, p.name, p.barcode 
          FROM sale_items si
          JOIN products p ON si.product_id = p.id
          WHERE si.sale_id = ?
        `, draft.id);

        return { ...draft, items };
      });
    } catch (error) {
      throw new DatabaseError('Failed to get draft sales', { cause: error });
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
          drawer_name, status, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      );

      return result.lastInsertRowid as number;
    } catch (error) {
      throw new DatabaseError('Failed to create sale', { cause: error });
    }
  }

  /**
   * Update an existing sale
   */
  updateSale(id: number, data: {
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
  }): boolean {
    try {
      const stmt = this.db.prepare(`
        UPDATE ${this.tableName} SET 
          client_id = ?, total_amount_usd = ?, discount_usd = ?, final_amount_usd = ?, 
          paid_usd = ?, paid_lbp = ?, change_given_usd = ?, change_given_lbp = ?, 
          exchange_rate_snapshot = ?, drawer_name = ?, status = ?, note = ?
        WHERE id = ?
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
      );

      return result.changes > 0;
    } catch (error) {
      throw new DatabaseError('Failed to update sale', { cause: error, entityId: id });
    }
  }

  /**
   * Delete all items for a sale (used when updating drafts)
   */
  deleteSaleItems(saleId: number): void {
    try {
      this.execute('DELETE FROM sale_items WHERE sale_id = ?', saleId);
    } catch (error) {
      throw new DatabaseError('Failed to delete sale items', { cause: error });
    }
  }

  /**
   * Add an item to a sale
   */
  addSaleItem(saleId: number, item: { product_id: number; quantity: number; price: number }): void {
    try {
      this.execute(`
        INSERT INTO sale_items (
          sale_id, product_id, quantity, sold_price_usd, cost_price_snapshot_usd
        ) VALUES (?, ?, ?, ?, (SELECT cost_price_usd FROM products WHERE id = ?))
      `, saleId, item.product_id, item.quantity, item.price, item.product_id);
    } catch (error) {
      throw new DatabaseError('Failed to add sale item', { cause: error });
    }
  }

  /**
   * Get sale items for a sale
   */
  getSaleItems(saleId: number): SaleItemWithProduct[] {
    try {
      return this.query<SaleItemWithProduct>(`
        SELECT si.*, p.name, p.barcode 
        FROM sale_items si
        JOIN products p ON si.product_id = p.id
        WHERE si.sale_id = ?
      `, saleId);
    } catch (error) {
      throw new DatabaseError('Failed to get sale items', { cause: error });
    }
  }

  // ---------------------------------------------------------------------------
  // Dashboard & Reporting Queries
  // ---------------------------------------------------------------------------

  /**
   * Get dashboard statistics for today
   */
  getDashboardStats(): DashboardStats {
    try {
      // Total Sales Today
      const salesResult = this.queryOne<{ total_usd: number; total_lbp: number }>(`
        SELECT 
          SUM(paid_usd) as total_usd,
          SUM(paid_lbp) as total_lbp
        FROM ${this.tableName} 
        WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime') AND status = 'completed'
      `);

      // Total Repayments Today
      const repaymentResult = this.queryOne<{ total_usd: number; total_lbp: number }>(`
        SELECT 
          SUM(ABS(amount_usd)) as total_usd,
          SUM(ABS(amount_lbp)) as total_lbp
        FROM debt_ledger
        WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime') AND transaction_type = 'Repayment'
      `);

      // Orders Count Today
      const ordersResult = this.queryOne<{ count: number }>(`
        SELECT COUNT(*) as count 
        FROM ${this.tableName} 
        WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime') AND status = 'completed'
      `);

      // Active Clients Count
      const clientsResult = this.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM clients');

      // Low Stock Items Count
      const stockResult = this.queryOne<{ count: number }>(`
        SELECT COUNT(*) as count 
        FROM products 
        WHERE stock_quantity <= min_stock_level AND is_active = 1
      `);

      return {
        // Sales Revenue: Only sales created today (revenue recognition)
        totalSalesUSD: salesResult?.total_usd ?? 0,
        totalSalesLBP: salesResult?.total_lbp ?? 0,
        // Cash Collected: Sales + debt repayments received today (cash flow)
        cashCollectedUSD: (salesResult?.total_usd ?? 0) + (repaymentResult?.total_usd ?? 0),
        cashCollectedLBP: (salesResult?.total_lbp ?? 0) + (repaymentResult?.total_lbp ?? 0),
        ordersCount: ordersResult?.count ?? 0,
        activeClients: clientsResult?.count ?? 0,
        lowStockCount: stockResult?.count ?? 0,
      };
    } catch (error) {
      throw new DatabaseError('Failed to get dashboard stats', { cause: error });
    }
  }

  /**
   * Get drawer balances for today
   */
  getDrawerBalances(): DrawerBalances {
    try {
      const today = new Date().toISOString().split('T')[0];

      // General Drawer B sales
      const generalSales = this.queryOne<{ total_usd: number; total_lbp: number }>(`
        SELECT 
          SUM(paid_usd) as total_usd, 
          SUM(paid_lbp) as total_lbp 
        FROM ${this.tableName} 
        WHERE DATE(created_at) = ? AND status = 'completed' AND drawer_name = 'General_Drawer_B'
      `, today);

      // General Drawer expenses
      const generalExpenses = this.queryOne<{ total_usd: number; total_lbp: number }>(`
        SELECT 
          SUM(amount_usd) as total_usd, 
          SUM(amount_lbp) as total_lbp 
        FROM expenses 
        WHERE DATE(expense_date) = ?
      `, today);

      // OMT Drawer A inflows
      const omtInflows = this.queryOne<{ total_usd: number; total_lbp: number }>(`
        SELECT 
          SUM(amount_usd) as total_usd, 
          SUM(amount_lbp) as total_lbp 
        FROM financial_services 
        WHERE DATE(created_at) = ? AND provider = 'OMT' AND service_type = 'RECEIVE'
      `, today);

      // OMT Drawer A outflows
      const omtOutflows = this.queryOne<{ total_usd: number; total_lbp: number }>(`
        SELECT 
          SUM(amount_usd) as total_usd, 
          SUM(amount_lbp) as total_lbp 
        FROM financial_services 
        WHERE DATE(created_at) = ? AND provider = 'OMT' AND service_type = 'SEND'
      `, today);

      return {
        generalDrawer: {
          usd: (generalSales?.total_usd ?? 0) - (generalExpenses?.total_usd ?? 0),
          lbp: (generalSales?.total_lbp ?? 0) - (generalExpenses?.total_lbp ?? 0),
        },
        omtDrawer: {
          usd: (omtInflows?.total_usd ?? 0) - (omtOutflows?.total_usd ?? 0),
          lbp: (omtInflows?.total_lbp ?? 0) - (omtOutflows?.total_lbp ?? 0),
        },
      };
    } catch (error) {
      throw new DatabaseError('Failed to get drawer balances', { cause: error });
    }
  }

  /**
   * Get today's recent sales for dashboard
   */
  getTodaysSales(limit: number = 5): RecentSale[] {
    try {
      return this.query<RecentSale>(`
        SELECT 
          s.id,
          c.full_name as client_name,
          s.paid_usd,
          s.paid_lbp,
          s.created_at
        FROM ${this.tableName} s
        LEFT JOIN clients c ON s.client_id = c.id
        WHERE s.status = 'completed' AND DATE(s.created_at, 'localtime') = DATE('now', 'localtime')
        ORDER BY s.created_at DESC
        LIMIT ?
      `, limit);
    } catch (error) {
      throw new DatabaseError('Failed to get today\'s sales', { cause: error });
    }
  }

  /**
   * Get top selling products
   */
  getTopProducts(limit: number = 5): TopProduct[] {
    try {
      return this.query<TopProduct>(`
        SELECT 
          p.name,
          COALESCE(SUM(si.quantity), 0) as total_quantity,
          COALESCE(SUM(si.sold_price_usd * si.quantity), 0) as total_revenue
        FROM sale_items si
        JOIN products p ON si.product_id = p.id
        JOIN ${this.tableName} s ON si.sale_id = s.id
        WHERE s.status = 'completed'
        GROUP BY p.id
        ORDER BY total_quantity DESC
        LIMIT ?
      `, limit);
    } catch (error) {
      throw new DatabaseError('Failed to get top products', { cause: error });
    }
  }

  /**
   * Get chart data for last 30 days - Sales or Profit
   */
  getChartData(type: 'Sales' | 'Profit'): ChartDataPoint[] {
    try {
      // Generate last 30 days
      const datesResult = this.query<{ date: string }>(`
        WITH RECURSIVE dates(date) AS (
          VALUES(date('now', 'localtime', '-29 days'))
          UNION ALL
          SELECT date(date, '+1 day')
          FROM dates
          WHERE date < date('now', 'localtime')
        )
        SELECT date FROM dates
      `);
      const dates = datesResult.map(r => r.date);

      if (type === 'Sales') {
        const salesData = this.query<{ date: string; daily_usd: number; daily_lbp: number }>(`
          SELECT 
            DATE(created_at, 'localtime') as date,
            SUM(paid_usd) as daily_usd,
            SUM(paid_lbp) as daily_lbp
          FROM ${this.tableName}
          WHERE status = 'completed' AND DATE(created_at, 'localtime') >= ?
          GROUP BY date
        `, dates[0]);

        const repaymentData = this.query<{ date: string; daily_usd: number; daily_lbp: number }>(`
          SELECT 
            DATE(created_at, 'localtime') as date,
            SUM(ABS(amount_usd)) as daily_usd,
            SUM(ABS(amount_lbp)) as daily_lbp
          FROM debt_ledger
          WHERE transaction_type = 'Repayment' AND DATE(created_at, 'localtime') >= ?
          GROUP BY date
        `, dates[0]);

        const combined = new Map<string, { usd: number; lbp: number }>();
        [...salesData, ...repaymentData].forEach((row) => {
          const entry = combined.get(row.date) || { usd: 0, lbp: 0 };
          entry.usd += row.daily_usd ?? 0;
          entry.lbp += row.daily_lbp ?? 0;
          combined.set(row.date, entry);
        });

        return dates.map(date => ({
          date,
          usd: combined.get(date)?.usd ?? 0,
          lbp: combined.get(date)?.lbp ?? 0,
        }));
      }

      // Profit data
      const profitData = this.query<{ profit_date: string; profit: number }>(`
        SELECT
          DATE(s.created_at, 'localtime') as profit_date,
          SUM(si.sold_price_usd - si.cost_price_snapshot_usd) as profit
        FROM ${this.tableName} s
        JOIN sale_items si ON s.id = si.sale_id
        WHERE s.status = 'completed' 
          AND (s.paid_usd + (s.paid_lbp / s.exchange_rate_snapshot)) >= s.final_amount_usd
          AND DATE(s.created_at, 'localtime') >= ?
        GROUP BY profit_date
      `, dates[0]);

      const profitMap = new Map<string, number>();
      profitData.forEach(row => profitMap.set(row.profit_date, row.profit));

      return dates.map(date => ({
        date,
        profit: profitMap.get(date) ?? 0,
      }));
    } catch (error) {
      throw new DatabaseError('Failed to get chart data', { cause: error });
    }
  }

  /**
   * Get sales by date range
   */
  findByDateRange(startDate: string, endDate: string): SaleWithClient[] {
    try {
      return this.query<SaleWithClient>(`
        SELECT s.*, c.full_name as client_name, c.phone_number as client_phone
        FROM ${this.tableName} s
        LEFT JOIN clients c ON s.client_id = c.id
        WHERE DATE(s.created_at) BETWEEN ? AND ? AND s.status = 'completed'
        ORDER BY s.created_at DESC
      `, startDate, endDate);
    } catch (error) {
      throw new DatabaseError('Failed to find sales by date range', { cause: error });
    }
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
