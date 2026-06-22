/**
 * Financial Service (OMT/WHISH/BOB) Service
 *
 * Business logic layer for money transfer operations.
 * Uses FinancialServiceRepository for data access.
 */

import {
  FinancialServiceRepository,
  getFinancialServiceRepository,
  type FinancialServiceEntity,
  type CreateFinancialServiceData,
  type FinancialServiceAnalytics,
  type UnsettledSummary,
  getSupplierRepository,
} from "../repositories/index.js";
import { getItemCostService } from "./ItemCostService.js";
import { DebtService, getDebtService } from "./DebtService.js";
import { sumCustomerAccountByCurrency } from "../utils/payments.js";
import { financialLogger } from "../utils/logger.js";

// =============================================================================
// Types
// =============================================================================

export type FifoStatus = "paid" | "partial" | "unpaid";

export interface TransactionWithFifoStatus extends FinancialServiceEntity {
  fifo_status: FifoStatus;
  fifo_paid_usd: number;
}

export interface FinancialServiceResult {
  success: boolean;
  id?: number;
  error?: string;
}

// =============================================================================
// Financial Service Class
// =============================================================================

export class FinancialService {
  private fsRepo: FinancialServiceRepository;
  private debtService: DebtService;

  constructor(fsRepo?: FinancialServiceRepository, debtService?: DebtService) {
    this.fsRepo = fsRepo ?? getFinancialServiceRepository();
    this.debtService = debtService ?? getDebtService();
  }

  /**
   * Validate that the client has enough credit balance to cover any
   * CUSTOMER_ACCOUNT portion of this transaction's payments.
   * Returns {success:true} when there's nothing to validate or the credit is sufficient.
   */
  private validateCustomerAccountPayment(
    data: CreateFinancialServiceData,
  ): { success: boolean; error?: string } {
    // Multi-payment array (preferred — comes from MultiPaymentInput in the UI)
    if (data.payments && data.payments.length > 0) {
      const { usd, lbp } = sumCustomerAccountByCurrency(data.payments);
      if (usd === 0 && lbp === 0) return { success: true };
      return this.debtService.validateCustomerAccountAvailability(
        data.clientId ?? null,
        usd,
        lbp,
      );
    }
    // Legacy single-method path
    if (data.paidByMethod === "CUSTOMER_ACCOUNT") {
      const amount = data.price ?? data.amount;
      const currency = data.currency ?? "USD";
      return this.debtService.validateCustomerAccountAvailability(
        data.clientId ?? null,
        currency === "USD" ? amount : 0,
        currency === "LBP" ? amount : 0,
      );
    }
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Transaction Operations
  // ---------------------------------------------------------------------------

  /**
   * Add a new financial service transaction (OMT, WHISH, BOB, etc.)
   */
  addTransaction(data: CreateFinancialServiceData): FinancialServiceResult {
    try {
      if (data.transaction_time) {
        const txTime = new Date(data.transaction_time);
        if (isNaN(txTime.getTime())) {
          throw new Error("Invalid transaction_time format");
        }
        if (txTime > new Date()) {
          throw new Error("transaction_time cannot be in the future");
        }
      }

      // In session-basket deferred mode the basket owns the customer-cash side
      // (including any CUSTOMER_ACCOUNT debt), so per-transaction credit
      // validation does not apply here — the basket recorder validates instead.
      if (!data.deferPayment) {
        const creditCheck = this.validateCustomerAccountPayment(data);
        if (!creditCheck.success) {
          return { success: false, error: creditCheck.error };
        }
      }

      const result = this.fsRepo.createTransaction(data);

      // Auto-save item cost for future reference
      if (data.itemKey && data.cost !== undefined && data.cost > 0) {
        try {
          const itemCostService = getItemCostService();
          itemCostService.autoSaveCost(
            data.provider,
            data.itemCategory ?? data.serviceType,
            data.itemKey,
            data.cost,
            data.currency ?? "USD",
          );
        } catch (costError) {
          financialLogger.warn(
            { error: costError, itemKey: data.itemKey },
            "Failed to auto-save item cost (non-critical)",
          );
        }
      }

      financialLogger.info(
        {
          provider: data.provider,
          serviceType: data.serviceType,
          amount: data.amount,
          currency: data.currency ?? "USD",
          commission: data.commission,
          drawer: result.drawer,
          id: result.id,
        },
        `${data.provider} - ${data.serviceType}: Amount ${data.amount} ${data.currency ?? "USD"}, Commission ${data.commission}`,
      );

      return { success: true, id: result.id };
    } catch (error) {
      financialLogger.error(
        { error, data },
        "Failed to add financial service transaction",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Query Operations
  // ---------------------------------------------------------------------------

  /**
   * Get transaction history, optionally filtered by provider
   */
  getHistory(provider?: string): FinancialServiceEntity[] {
    try {
      return this.fsRepo.getHistory(provider);
    } catch (error) {
      financialLogger.error(
        { error, provider },
        "Failed to get financial services history",
      );
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------

  /**
   * Get comprehensive analytics (today, month, by provider)
   * commission = realized (settled); pending_commission = pending settlement
   */
  getAnalytics(providers?: string[]): FinancialServiceAnalytics {
    try {
      return this.fsRepo.getAnalytics(providers);
    } catch (error) {
      financialLogger.error({ error }, "Failed to get analytics");
      return {
        today: {
          commission: 0,
          pending_commission: 0,
          count: 0,
          byCurrency: [],
        },
        month: {
          commission: 0,
          pending_commission: 0,
          count: 0,
          byCurrency: [],
        },
        byProvider: [],
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Settlement Queries
  // ---------------------------------------------------------------------------

  /**
   * Get all unsettled transactions for a given provider (e.g. "OMT", "WHISH").
   * These are RECEIVE rows where commission > 0 and is_settled = 0.
   */
  getUnsettledByProvider(provider: string): FinancialServiceEntity[] {
    try {
      return this.fsRepo.getUnsettledBySupplier(provider);
    } catch (error) {
      financialLogger.error(
        { error, provider },
        "Failed to get unsettled transactions",
      );
      return [];
    }
  }

  /**
   * Get all financial_services rows for a given provider, newest first,
   * annotated with FIFO payment status derived from manual supplier_ledger entries.
   * Powers the Transactions history tab in the Suppliers UI.
   */
  getAllByProvider(
    provider: string,
    limit?: number,
  ): TransactionWithFifoStatus[] {
    try {
      const transactions = this.fsRepo.getAllByProvider(provider, limit);

      const supplierRepo = getSupplierRepository();
      const supplier = supplierRepo.getByProvider(provider);

      if (!supplier) {
        return transactions.map((t) => ({
          ...t,
          fifo_status: "unpaid" as FifoStatus,
          fifo_paid_usd: 0,
        }));
      }

      const pools = supplierRepo.getManualPaymentPools(supplier.id);

      // Sort oldest-first to apply FIFO
      const sorted = [...transactions].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );

      let sendPool = pools.send_pool_usd;
      let receivePool = pools.receive_pool_usd;

      const statusMap = new Map<
        number,
        { fifo_status: FifoStatus; fifo_paid_usd: number }
      >();

      for (const txn of sorted) {
        // Batch-settled via old settle flow → always paid
        if (txn.settlement_id !== null) {
          const owed = txn.cost > 0 ? txn.cost : Math.abs(txn.amount);
          statusMap.set(txn.id, { fifo_status: "paid", fifo_paid_usd: owed });
          continue;
        }

        const isReceive = txn.service_type === "RECEIVE";
        const owed = isReceive
          ? Math.abs(txn.amount) + (txn.commission ?? 0)
          : txn.cost > 0
            ? txn.cost
            : Math.abs(txn.amount);

        if (owed === 0) {
          statusMap.set(txn.id, { fifo_status: "paid", fifo_paid_usd: 0 });
          continue;
        }

        const pool = isReceive ? receivePool : sendPool;

        if (pool >= owed) {
          statusMap.set(txn.id, { fifo_status: "paid", fifo_paid_usd: owed });
          if (isReceive) receivePool -= owed;
          else sendPool -= owed;
        } else if (pool > 0) {
          statusMap.set(txn.id, {
            fifo_status: "partial",
            fifo_paid_usd: pool,
          });
          if (isReceive) receivePool = 0;
          else sendPool = 0;
        } else {
          statusMap.set(txn.id, { fifo_status: "unpaid", fifo_paid_usd: 0 });
        }
      }

      // Return in original order (DESC by created_at for display)
      return transactions.map((t) => ({
        ...t,
        ...(statusMap.get(t.id) ?? {
          fifo_status: "unpaid" as FifoStatus,
          fifo_paid_usd: 0,
        }),
      }));
    } catch (error) {
      financialLogger.error(
        { error, provider },
        "Failed to get all transactions for provider",
      );
      return [];
    }
  }

  /**
   * Get a per-provider summary of unsettled commissions and amounts owed.
   * Used by Dashboard pending note and Profits pending tab.
   */
  getUnsettledSummary(): UnsettledSummary[] {
    try {
      return this.fsRepo.getUnsettledSummaryByProvider();
    } catch (error) {
      financialLogger.error({ error }, "Failed to get unsettled summary");
      return [];
    }
  }

  /**
   * Update non-financial metadata on a financial service record.
   * Records old/new values for audit trail.
   */
  updateFinancialServiceMetadata(
    id: number,
    data: {
      client_name?: string;
      phone_number?: string;
      sender_name?: string;
      sender_phone?: string;
      receiver_name?: string;
      receiver_phone?: string;
      note?: string;
    },
    editedBy: string,
  ): {
    success: boolean;
    entity?: FinancialServiceEntity;
    oldValues?: Record<string, unknown>;
    error?: string;
  } {
    const existing = this.fsRepo.findById(id);
    if (!existing) {
      return { success: false, error: "Financial service record not found" };
    }

    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};

    const fields = [
      "client_name",
      "phone_number",
      "sender_name",
      "sender_phone",
      "receiver_name",
      "receiver_phone",
      "note",
    ] as const;

    for (const field of fields) {
      if (data[field] !== undefined && data[field] !== existing[field]) {
        oldValues[field] = existing[field];
        newValues[field] = data[field];
      }
    }

    if (Object.keys(newValues).length === 0) {
      return { success: true, entity: existing };
    }

    const updated = this.fsRepo.updateMetadata(id, data, editedBy);
    if (!updated) {
      return { success: false, error: "Failed to update" };
    }

    financialLogger.info(
      { id, editedBy, oldValues, newValues },
      "Financial service metadata updated",
    );

    return { success: true, entity: updated, oldValues };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let financialServiceInstance: FinancialService | null = null;

export function getFinancialService(): FinancialService {
  if (!financialServiceInstance) {
    financialServiceInstance = new FinancialService();
  }
  return financialServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetFinancialService(): void {
  financialServiceInstance = null;
}
