/**
 * Financial Service Repository
 *
 * Handles all financial_services table operations (OMT, WHISH, BOB, etc.).
 * Uses BaseRepository for common functionality.
 */

import { BaseRepository } from "./BaseRepository.js";
import { paymentMethodToDrawerName } from "../utils/payments.js";
import { getSupplierRepository } from "./SupplierRepository.js";

// =============================================================================
// Entity Types
// =============================================================================

export interface FinancialServiceEntity {
  id: number;
  provider:
    | "OMT"
    | "WHISH"
    | "BOB"
    | "OTHER"
    | "IPEC"
    | "KATCH"
    | "WISH_APP"
    | "OMT_APP";
  service_type: "SEND" | "RECEIVE" | "BILL_PAYMENT";
  amount: number;
  currency: string;
  commission: number;
  client_name: string | null;
  reference_number: string | null;
  note: string | null;
  created_at: string;
  created_by: number | null;
}

export interface CreateFinancialServiceData {
  provider:
    | "OMT"
    | "WHISH"
    | "BOB"
    | "OTHER"
    | "IPEC"
    | "KATCH"
    | "WISH_APP"
    | "OMT_APP";
  serviceType: "SEND" | "RECEIVE" | "BILL_PAYMENT";
  amount: number;
  currency?: string;
  commission: number;
  clientName?: string;
  referenceNumber?: string;
  note?: string;
  paidByMethod?: string;
}

export interface ProviderStats {
  provider: string;
  commission: number;
  currency: string;
  count: number;
}

export interface CurrencyStats {
  currency: string;
  commission: number;
  count: number;
}

export interface FinancialServiceAnalytics {
  today: {
    commission: number;
    count: number;
    byCurrency: CurrencyStats[];
  };
  month: {
    commission: number;
    count: number;
    byCurrency: CurrencyStats[];
  };
  byProvider: ProviderStats[];
}

// =============================================================================
// Financial Service Repository Class
// =============================================================================

export class FinancialServiceRepository extends BaseRepository<FinancialServiceEntity> {
  constructor() {
    super("financial_services", { softDelete: false });
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return "id, provider, service_type, amount, currency, commission, client_name, reference_number, note, created_at, created_by";
  }

  // ---------------------------------------------------------------------------
  // Transaction Operations
  // ---------------------------------------------------------------------------

  /**
   * Create a new financial service transaction
   */
  createTransaction(data: CreateFinancialServiceData): {
    id: number;
    drawer: string;
  } {
    const mapDrawerName = (
      provider: CreateFinancialServiceData["provider"],
    ): string => {
      switch (provider) {
        case "OMT":
          return "OMT_System";
        case "WHISH":
          return "Whish_System";
        case "IPEC":
          return "IPEC";
        case "KATCH":
          return "Katch";
        case "WISH_APP":
          return "Whish_App";
        case "OMT_APP":
          return "OMT_App";
        case "BOB":
        case "OTHER":
        default:
          return "General";
      }
    };

    // Keep returning the legacy drawer labels for UI/log compatibility
    const legacyDrawerLabel =
      data.provider === "OMT" ? "OMT_Drawer_A" : "General_Drawer_B";

    return this.db.transaction(() => {
      const currency = data.currency ?? "USD";
      const stmt = this.db.prepare(`
        INSERT INTO financial_services (
          provider, service_type, amount, currency,
          commission, client_name, reference_number, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        data.provider,
        data.serviceType,
        data.amount,
        currency,
        data.commission || 0,
        data.clientName || null,
        data.referenceNumber || null,
        data.note || null,
      );

      const id = Number(result.lastInsertRowid);

      const drawerName = data.paidByMethod
        ? paymentMethodToDrawerName(data.paidByMethod)
        : mapDrawerName(data.provider);
      const paymentMethod = data.paidByMethod || data.provider;
      const createdBy = 1;
      const note = data.note || null;

      // Signed delta: RECEIVE adds to drawer, SEND subtracts
      const sign = data.serviceType === "SEND" ? -1 : 1;

      const insertPayment = this.db.prepare(`
        INSERT INTO payments (
          source_type, source_id, method, drawer_name, currency_code, amount, note, created_by
        ) VALUES (
          'FINANCIAL_SERVICE', ?, ?, ?, ?, ?, ?, ?
        )
      `);

      const upsertBalanceDelta = this.db.prepare(`
        INSERT INTO drawer_balances (drawer_name, currency_code, balance)
        VALUES (?, ?, ?)
        ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
          balance = drawer_balances.balance + excluded.balance,
          updated_at = CURRENT_TIMESTAMP
      `);

      // Amount movement affects drawer balances
      if (data.amount && data.amount !== 0) {
        const delta = sign * Math.abs(data.amount);
        insertPayment.run(
          id,
          paymentMethod,
          drawerName,
          currency,
          delta,
          note,
          createdBy,
        );
        upsertBalanceDelta.run(drawerName, currency, delta);
      }

      // Commission is assumed to be retained in the same drawer as an inflow (always +)
      if (data.commission && data.commission !== 0) {
        const delta = Math.abs(data.commission);
        insertPayment.run(
          id,
          paymentMethod,
          drawerName,
          currency,
          delta,
          "Commission",
          createdBy,
        );
        upsertBalanceDelta.run(drawerName, currency, delta);
      }

      // Auto-record supplier debt if a supplier is linked to this provider
      try {
        const supplierRepo = getSupplierRepository();
        const supplier = supplierRepo.getByProvider(data.provider);
        if (supplier) {
          supplierRepo.addLedgerEntry({
            supplier_id: supplier.id,
            entry_type: "TOP_UP",
            amount_usd: currency === "USD" ? Math.abs(data.amount) : 0,
            amount_lbp: currency === "LBP" ? Math.abs(data.amount) : 0,
            note: `Auto: ${data.serviceType} via ${data.provider}`,
            transaction_id: id,
            transaction_type: "FINANCIAL_SERVICE",
            created_by: createdBy,
          });
        }
      } catch {
        // Supplier auto-record is non-critical; don't fail the transaction
      }

      return { id, drawer: legacyDrawerLabel };
    })();
  }

  /**
   * Log the financial service activity
   */
  logActivity(data: CreateFinancialServiceData, drawer: string): void {
    const logStmt = this.db.prepare(`
      INSERT INTO activity_logs (user_id, action, details_json, created_at)
      VALUES (1, 'Financial Service Transaction', ?, CURRENT_TIMESTAMP)
    `);
    logStmt.run(
      JSON.stringify({
        drawer,
        provider: data.provider,
        serviceType: data.serviceType,
        amount: data.amount,
        currency: data.currency ?? "USD",
        commission: data.commission,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Query Operations
  // ---------------------------------------------------------------------------

  /**
   * Get transaction history, optionally filtered by provider
   */
  getHistory(provider?: string, limit: number = 50): FinancialServiceEntity[] {
    let query = `SELECT ${this.getColumns()} FROM financial_services`;
    const params: (string | number)[] = [];

    if (provider) {
      query += " WHERE provider = ?";
      params.push(provider);
    }

    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    return this.db.prepare(query).all(...params) as FinancialServiceEntity[];
  }

  // ---------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------

  /**
   * Get comprehensive analytics for financial services (all currencies)
   */
  getAnalytics(): FinancialServiceAnalytics {
    // Today's totals
    const todayStats = this.db
      .prepare(
        `
      SELECT 
        COALESCE(SUM(commission), 0) as today_commission,
        COUNT(*) as today_count
      FROM financial_services 
      WHERE DATE(created_at) = DATE('now', 'localtime')
    `,
      )
      .get() as {
      today_commission: number;
      today_count: number;
    };

    // Today's breakdown by currency
    const todayByCurrency = this.db
      .prepare(
        `
      SELECT 
        currency,
        COALESCE(SUM(commission), 0) as commission,
        COUNT(*) as count
      FROM financial_services 
      WHERE DATE(created_at) = DATE('now', 'localtime')
      GROUP BY currency
    `,
      )
      .all() as CurrencyStats[];

    // This month's totals
    const monthStats = this.db
      .prepare(
        `
      SELECT 
        COALESCE(SUM(commission), 0) as month_commission,
        COUNT(*) as month_count
      FROM financial_services 
      WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
    `,
      )
      .get() as {
      month_commission: number;
      month_count: number;
    };

    // This month's breakdown by currency
    const monthByCurrency = this.db
      .prepare(
        `
      SELECT 
        currency,
        COALESCE(SUM(commission), 0) as commission,
        COUNT(*) as count
      FROM financial_services 
      WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
      GROUP BY currency
    `,
      )
      .all() as CurrencyStats[];

    // By Provider Today (all currencies)
    const byProvider = this.db
      .prepare(
        `
      SELECT 
        provider,
        COALESCE(SUM(commission), 0) as commission,
        currency,
        COUNT(*) as count
      FROM financial_services 
      WHERE DATE(created_at) = DATE('now', 'localtime')
      GROUP BY provider, currency
    `,
      )
      .all() as ProviderStats[];

    return {
      today: {
        commission: todayStats.today_commission,
        count: todayStats.today_count,
        byCurrency: todayByCurrency,
      },
      month: {
        commission: monthStats.month_commission,
        count: monthStats.month_count,
        byCurrency: monthByCurrency,
      },
      byProvider,
    };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let financialServiceRepositoryInstance: FinancialServiceRepository | null =
  null;

export function getFinancialServiceRepository(): FinancialServiceRepository {
  if (!financialServiceRepositoryInstance) {
    financialServiceRepositoryInstance = new FinancialServiceRepository();
  }
  return financialServiceRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetFinancialServiceRepository(): void {
  financialServiceRepositoryInstance = null;
}
