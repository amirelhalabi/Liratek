/**
 * Financial Service Repository
 *
 * Handles all financial_services table operations (OMT, WHISH, BOB, etc.).
 * Uses BaseRepository for common functionality.
 */

import { BaseRepository } from "./BaseRepository.js";
import {
  paymentMethodToDrawerName,
  isDrawerAffectingMethod,
} from "../utils/payments.js";
import { getSupplierRepository } from "./SupplierRepository.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";

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
  cost: number;
  price: number;
  paid_by: string | null;
  client_id: number | null;
  client_name: string | null;
  reference_number: string | null;
  item_key: string | null;
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
  cost?: number;
  price?: number;
  paidByMethod?: string;
  clientId?: number;
  clientName?: string;
  referenceNumber?: string;
  itemKey?: string;
  itemCategory?: string;
  note?: string;
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
    return "id, provider, service_type, amount, currency, commission, cost, price, paid_by, client_id, client_name, reference_number, item_key, note, created_at, created_by";
  }

  // ---------------------------------------------------------------------------
  // Transaction Operations
  // ---------------------------------------------------------------------------

  /**
   * Map provider to its system drawer name
   */
  private mapDrawerName(
    provider: CreateFinancialServiceData["provider"],
  ): string {
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
  }

  /**
   * Create a new financial service transaction.
   *
   * Two modes:
   * - **Cost/Price mode** (cost > 0): IPEC/Katch/WishApp/OMT_App with cost outflow,
   *   price inflow, optional DEBT, and real profit tracking.
   * - **Legacy mode** (no cost): OMT/WHISH/BOB/OTHER with signed amount + commission.
   */
  createTransaction(data: CreateFinancialServiceData): {
    id: number;
    drawer: string;
  } {
    const legacyDrawerLabel =
      data.provider === "OMT" ? "OMT_Drawer_A" : "General_Drawer_B";

    const useCostPriceFlow = data.cost !== undefined && data.cost > 0;

    return this.db.transaction(() => {
      const currency = data.currency ?? "USD";
      const cost = data.cost ?? 0;
      const price = data.price ?? 0;
      const paidBy = data.paidByMethod || "CASH";
      const commission = useCostPriceFlow ? price - cost : data.commission || 0;

      // 1. Insert the financial_services row
      const stmt = this.db.prepare(`
        INSERT INTO financial_services (
          provider, service_type, amount, currency,
          commission, cost, price, paid_by, client_id,
          client_name, reference_number, item_key, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        data.provider,
        data.serviceType,
        data.amount,
        currency,
        commission,
        cost,
        price,
        useCostPriceFlow ? paidBy : null,
        data.clientId || null,
        data.clientName || null,
        data.referenceNumber || null,
        data.itemKey || null,
        data.note || null,
      );

      const id = Number(result.lastInsertRowid);
      const createdBy = 1;
      const note = data.note || null;

      // Create unified transaction row
      const txnId = getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.FINANCIAL_SERVICE,
        source_table: "financial_services",
        source_id: id,
        user_id: createdBy,
        amount_usd: useCostPriceFlow
          ? currency === "USD"
            ? price
            : 0
          : currency === "USD"
            ? data.amount
            : 0,
        amount_lbp: useCostPriceFlow
          ? currency === "LBP"
            ? price
            : 0
          : currency === "LBP"
            ? data.amount
            : 0,
        client_id: data.clientId ?? null,
        summary: `${data.provider} ${data.serviceType}: ${data.amount} ${currency}`,
        metadata_json: {
          provider: data.provider,
          service_type: data.serviceType,
          amount: data.amount,
          currency,
          commission,
          cost,
          price,
          paid_by: paidBy,
          item_key: data.itemKey,
        },
      });

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

      if (useCostPriceFlow) {
        // ─── COST/PRICE FLOW (IPEC, KATCH, WISH_APP, OMT_APP) ───
        const providerDrawer = this.mapDrawerName(data.provider);

        // Cost outflow: shop pays the provider
        if (cost > 0) {
          insertPayment.run(
            txnId,
            data.provider,
            providerDrawer,
            currency,
            -Math.abs(cost),
            `Cost: ${data.provider}`,
            createdBy,
          );
          upsertBalanceDelta.run(providerDrawer, currency, -Math.abs(cost));
        }

        // Price inflow: customer pays the shop (skip for DEBT)
        if (price > 0 && isDrawerAffectingMethod(paidBy)) {
          const paidByDrawer = paymentMethodToDrawerName(paidBy);
          insertPayment.run(
            txnId,
            paidBy,
            paidByDrawer,
            currency,
            Math.abs(price),
            note,
            createdBy,
          );
          upsertBalanceDelta.run(paidByDrawer, currency, Math.abs(price));
        }

        // DEBT: create debt_ledger entry
        if (paidBy === "DEBT") {
          if (!data.clientId) {
            throw new Error("Cannot create debt without a client");
          }
          this.db
            .prepare(
              `INSERT INTO debt_ledger (
                client_id, transaction_type, amount_usd, amount_lbp, transaction_id, note, created_by, due_date
              ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+30 days'))`,
            )
            .run(
              data.clientId,
              "Service Debt",
              currency === "USD" ? price : 0,
              currency === "LBP" ? price : 0,
              txnId,
              `${data.provider} service${data.itemKey ? ` [${data.itemKey}]` : ""}`,
              createdBy,
            );
        }
      } else {
        // ─── LEGACY FLOW (OMT, WHISH, BOB, OTHER) ───
        const drawerName = data.paidByMethod
          ? paymentMethodToDrawerName(data.paidByMethod)
          : this.mapDrawerName(data.provider);
        const paymentMethod = data.paidByMethod || data.provider;
        const sign = data.serviceType === "SEND" ? -1 : 1;

        // Amount movement
        if (data.amount && data.amount !== 0) {
          const delta = sign * Math.abs(data.amount);
          insertPayment.run(
            txnId,
            paymentMethod,
            drawerName,
            currency,
            delta,
            note,
            createdBy,
          );
          upsertBalanceDelta.run(drawerName, currency, delta);
        }

        // Commission inflow (always positive)
        if (data.commission && data.commission !== 0) {
          const delta = Math.abs(data.commission);
          insertPayment.run(
            txnId,
            paymentMethod,
            drawerName,
            currency,
            delta,
            "Commission",
            createdBy,
          );
          upsertBalanceDelta.run(drawerName, currency, delta);
        }
      }

      // Auto-record supplier debt (both flows)
      try {
        const supplierRepo = getSupplierRepository();
        const supplier = supplierRepo.getByProvider(data.provider);
        if (supplier) {
          const ledgerAmount =
            useCostPriceFlow && cost > 0 ? cost : Math.abs(data.amount);
          supplierRepo.addLedgerEntry({
            supplier_id: supplier.id,
            entry_type: "TOP_UP",
            amount_usd: currency === "USD" ? ledgerAmount : 0,
            amount_lbp: currency === "LBP" ? ledgerAmount : 0,
            note: `Auto: ${data.serviceType} via ${data.provider}${data.itemKey ? ` [${data.itemKey}]` : ""}`,
            created_by: createdBy,
          });
        }
      } catch {
        // Supplier auto-record is non-critical; don't fail the transaction
      }

      return { id, drawer: legacyDrawerLabel };
    })();
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
