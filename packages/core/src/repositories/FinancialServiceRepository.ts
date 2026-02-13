/**
 * Financial Service Repository
 *
 * Handles all financial_services table operations (OMT, WHISH, BOB, etc.).
 * Uses BaseRepository for common functionality.
 */

import { BaseRepository } from "./BaseRepository.js";

// =============================================================================
// Entity Types
// =============================================================================

export interface FinancialServiceEntity {
  id: number;
  provider: "OMT" | "WHISH" | "BOB" | "OTHER";
  service_type: "SEND" | "RECEIVE" | "BILL_PAYMENT";
  amount_usd: number;
  amount_lbp: number;
  commission_usd: number;
  commission_lbp: number;
  client_name: string | null;
  reference_number: string | null;
  note: string | null;
  created_at: string;
  created_by: number | null;
}

export interface CreateFinancialServiceData {
  provider: "OMT" | "WHISH" | "BOB" | "OTHER";
  serviceType: "SEND" | "RECEIVE" | "BILL_PAYMENT";
  amountUSD: number;
  amountLBP: number;
  commissionUSD: number;
  commissionLBP: number;
  clientName?: string;
  referenceNumber?: string;
  note?: string;
}

export interface ProviderStats {
  provider: string;
  commission_usd: number;
  commission_lbp: number;
  count: number;
}

export interface FinancialServiceAnalytics {
  today: {
    commissionUSD: number;
    commissionLBP: number;
    count: number;
  };
  month: {
    commissionUSD: number;
    commissionLBP: number;
    count: number;
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
          return "Whish_App";
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
      const stmt = this.db.prepare(`
        INSERT INTO financial_services (
          provider, service_type, amount_usd, amount_lbp,
          commission_usd, commission_lbp, client_name, reference_number, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        data.provider,
        data.serviceType,
        data.amountUSD || 0,
        data.amountLBP || 0,
        data.commissionUSD || 0,
        data.commissionLBP || 0,
        data.clientName || null,
        data.referenceNumber || null,
        data.note || null,
      );

      const id = Number(result.lastInsertRowid);

      const drawerName = mapDrawerName(data.provider);
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
      if (data.amountUSD && data.amountUSD !== 0) {
        const delta = sign * Math.abs(data.amountUSD);
        // method: align with provider for now (OMT/WHISH), otherwise OTHER
        insertPayment.run(
          id,
          data.provider,
          drawerName,
          "USD",
          delta,
          note,
          createdBy,
        );
        upsertBalanceDelta.run(drawerName, "USD", delta);
      }

      if (data.amountLBP && data.amountLBP !== 0) {
        const delta = sign * Math.abs(data.amountLBP);
        insertPayment.run(
          id,
          data.provider,
          drawerName,
          "LBP",
          delta,
          note,
          createdBy,
        );
        upsertBalanceDelta.run(drawerName, "LBP", delta);
      }

      // Commission is assumed to be retained in the same drawer as an inflow (always +)
      // If in your business model commission is paid out separately, we can revise.
      if (data.commissionUSD && data.commissionUSD !== 0) {
        const delta = Math.abs(data.commissionUSD);
        insertPayment.run(
          id,
          data.provider,
          drawerName,
          "USD",
          delta,
          "Commission",
          createdBy,
        );
        upsertBalanceDelta.run(drawerName, "USD", delta);
      }

      if (data.commissionLBP && data.commissionLBP !== 0) {
        const delta = Math.abs(data.commissionLBP);
        insertPayment.run(
          id,
          data.provider,
          drawerName,
          "LBP",
          delta,
          "Commission",
          createdBy,
        );
        upsertBalanceDelta.run(drawerName, "LBP", delta);
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
        commission_usd: data.commissionUSD,
        commission_lbp: data.commissionLBP,
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
    let query = "SELECT * FROM financial_services";
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
   * Get comprehensive analytics for financial services
   */
  getAnalytics(): FinancialServiceAnalytics {
    // Today's commission
    const todayStats = this.db
      .prepare(
        `
      SELECT 
        COALESCE(SUM(commission_usd), 0) as today_commission_usd,
        COALESCE(SUM(commission_lbp), 0) as today_commission_lbp,
        COUNT(*) as today_count
      FROM financial_services 
      WHERE DATE(created_at) = DATE('now', 'localtime')
    `,
      )
      .get() as {
      today_commission_usd: number;
      today_commission_lbp: number;
      today_count: number;
    };

    // This month's commission
    const monthStats = this.db
      .prepare(
        `
      SELECT 
        COALESCE(SUM(commission_usd), 0) as month_commission_usd,
        COALESCE(SUM(commission_lbp), 0) as month_commission_lbp,
        COUNT(*) as month_count
      FROM financial_services 
      WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
    `,
      )
      .get() as {
      month_commission_usd: number;
      month_commission_lbp: number;
      month_count: number;
    };

    // By Provider Today
    const byProvider = this.db
      .prepare(
        `
      SELECT 
        provider,
        COALESCE(SUM(commission_usd), 0) as commission_usd,
        COALESCE(SUM(commission_lbp), 0) as commission_lbp,
        COUNT(*) as count
      FROM financial_services 
      WHERE DATE(created_at) = DATE('now', 'localtime')
      GROUP BY provider
    `,
      )
      .all() as ProviderStats[];

    return {
      today: {
        commissionUSD: todayStats.today_commission_usd,
        commissionLBP: todayStats.today_commission_lbp,
        count: todayStats.today_count,
      },
      month: {
        commissionUSD: monthStats.month_commission_usd,
        commissionLBP: monthStats.month_commission_lbp,
        count: monthStats.month_count,
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
