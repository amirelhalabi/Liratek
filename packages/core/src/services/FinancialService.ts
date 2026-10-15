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
  type SelfChargeTelecomItemData,
  type SelfChargeTelecomItemResult,
  getSupplierRepository,
} from "../repositories/index.js";
import { getItemCostService } from "./ItemCostService.js";
import { financialLogger } from "../utils/logger.js";
import { isAppError } from "../utils/errors.js";

// =============================================================================
// Types
// =============================================================================

/**
 * LIRA-322 (FR-017) — one account row's label from its settlement coverage:
 * voided → "voided"; stamped settled (or nothing owed) → "paid" in full;
 * otherwise paid so far = active coverage in the row's own currency
 * ("partial" while it is below what is owed). Same $0.005 / 0.5 LBP
 * tolerance the settlement closes rows with.
 */
function coverageFifoStatus(
  t: FinancialServiceEntity,
  covered: { covered_usd: number; covered_lbp: number } | undefined,
): { fifo_status: FifoStatus; fifo_paid_usd: number; fifo_paid_lbp: number } {
  const isLbp = t.currency === "LBP";
  const owed = Math.abs(t.supplier_owed ?? 0);
  const split = (paid: number) => ({
    fifo_paid_usd: isLbp ? 0 : paid,
    fifo_paid_lbp: isLbp ? paid : 0,
  });
  if (t.is_refunded) return { fifo_status: "voided", ...split(0) };
  if (t.settlement_id !== null || owed === 0) {
    return { fifo_status: "paid", ...split(owed) };
  }
  const paid = isLbp ? (covered?.covered_lbp ?? 0) : (covered?.covered_usd ?? 0);
  const eps = isLbp ? 0.5 : 0.005;
  if (paid >= owed - eps) return { fifo_status: "paid", ...split(paid) };
  if (paid > 0) return { fifo_status: "partial", ...split(paid) };
  return { fifo_status: "unpaid", ...split(0) };
}

/** "voided" (G40, LIRA-258): the row was voided/refunded — it owes nothing
 *  and never takes money from the manual-payment FIFO pool. */
export type FifoStatus = "paid" | "partial" | "unpaid" | "voided";

export interface TransactionWithFifoStatus extends FinancialServiceEntity {
  fifo_status: FifoStatus;
  fifo_paid_usd: number;
  /**
   * LIRA-322 (FR-017) — LBP paid so far. Set for OMT-account members, whose
   * labels come from settlement coverage per currency; absent for other
   * suppliers (their pool estimate is USD-only).
   */
  fifo_paid_lbp?: number;
}

export interface FinancialServiceResult {
  success: boolean;
  id?: number;
  error?: string;
  /**
   * Structured error contract. Set alongside `details` when the repository
   * throws an `AppError`, so both transports and the frontend share ONE
   * error-handling path that switches on `code`, never a message string
   * match. The flow that originally motivated this — a RECEIVE
   * insufficient-funds recovery panel backed by `InsufficientDrawerFundsError`
   * — is GONE (owner reversed decision 2026-08-01: no drawer operation is
   * ever blocked; a drawer may go negative, and negatives are surfaced in the
   * UI instead of pre-checked). The envelope property itself is still
   * load-bearing: `FinancialServiceRepository` throws a typed
   * `BusinessRuleError` when a FOR-partner transaction is attempted on the
   * secondary SYSTEM provider, and that `code` must carry through unchanged.
   * Collapsing the error to a bare `error` string here would silently lose
   * it, so this catch deliberately mirrors
   * `DrawerTopUpService.transferBetweenDrawers`.
   */
  code?: string;
  details?: unknown;
}

// =============================================================================
// Financial Service Class
// =============================================================================

export class FinancialService {
  private fsRepo: FinancialServiceRepository;

  constructor(fsRepo?: FinancialServiceRepository) {
    this.fsRepo = fsRepo ?? getFinancialServiceRepository();
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

      // CUSTOMER_ACCOUNT is an open-debt payment method here (same model as
      // POS/telecom/etc.): the repository below books the unpaid portion as a
      // debt_ledger row regardless of the client's prior balance — no
      // pre-check against existing credit.
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
      // Preserve code/details so a typed AppError (e.g. the FOR-partner
      // secondary-system BusinessRuleError) reaches the UI as a structured
      // error over BOTH transports, instead of collapsing to an opaque
      // message. (No drawer-overdraw guard exists on this path — reversed
      // 2026-08-01; see DrawerTopUpResult's `code` JSDoc for the history.)
      if (isAppError(error)) {
        return {
          success: false,
          error: error.message,
          code: error.code,
          details: error.details,
        };
      }
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
  getHistory(
    provider?: string,
    limit: number | null = 50,
  ): FinancialServiceEntity[] {
    try {
      return this.fsRepo.getHistory(provider, limit);
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
          awaiting_settlement_count: 0,
          byCurrency: [],
        },
        month: {
          commission: 0,
          pending_commission: 0,
          count: 0,
          awaiting_settlement_count: 0,
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
   * "Unsettled" is the ONE pending-supplier-settlement predicate
   * (`pendingSettlementSql`, COMMISSION_AT_SETTLEMENT_PLAN.md D2): new-model
   * (`commission_model = 1`) OMT/WHISH SEND/RECEIVE rows and commission-
   * eligible BILLs, plus legacy (`commission_model = 0`) OMT/WHISH rows with
   * a commission — not yet settled and not voided/refunded.
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

      // LIRA-322 (FR-017) — an OMT-account member's labels come from what
      // settlements actually recorded (coverage), per currency.
      if (supplierRepo.isAccountMember(supplier.id)) {
        const coverage = supplierRepo.getRowCoverage(
          "FINANCIAL_SERVICE",
          transactions
            .filter((t) => !t.is_refunded && t.settlement_id === null)
            .map((t) => t.id),
        );
        return transactions.map((t) =>
          ({ ...t, ...coverageFifoStatus(t, coverage.get(t.id)) }),
        );
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
        // G40 (LIRA-258): a voided/refunded row owes nothing. It must not
        // consume the payment pool (that made a LATER real row read
        // "Unpaid") and is labelled "voided", not "Unpaid".
        if (txn.is_refunded) {
          statusMap.set(txn.id, { fifo_status: "voided", fifo_paid_usd: 0 });
          continue;
        }

        // Batch-settled via old settle flow → always paid
        if (txn.settlement_id !== null) {
          statusMap.set(txn.id, {
            fifo_status: "paid",
            fifo_paid_usd: txn.supplier_owed,
          });
          continue;
        }

        // supplier_owed is the repository's ONE owed-per-row definition
        // (SUPPLIER_OWED_EXPR): 0 for wallet-provider transfers (prepaid
        // balance — nothing to pay the supplier, Fix B), cost for a LEGACY
        // cost-flow row (`supplier_debt_booked = 1`) and 0 for a post-C5 one
        // (LIRA-122 — the debt already lives in the TOP_UP entry booked at
        // top-up time, so nothing is owed on the sale row itself), and for
        // for OMT/WHISH the GROSS amount owed the provider, read per row
        // with the formula that wrote it (commission at settlement,
        // COMMISSION_AT_SETTLEMENT_PLAN.md D1/D3): a new-model row
        // (`commission_model = 1`) owes SEND `x + f` / RECEIVE `−x` (or
        // `−(x − f)` for a row written before the receive-fee cutover) — the
        // shop's commission is entered separately at settlement; a legacy row
        // (`commission_model = 0`) keeps the netted `x + f − c` /
        // `−(x − f + c)`. When `owed === 0` below, the row is treated as
        // already "paid" (nothing outstanding) — the Suppliers page then
        // renders it as "—" (see the `settlement_id == null` guard there),
        // the same "nothing owed" treatment wallet-provider rows already get.
        const isReceive = txn.service_type === "RECEIVE";
        const owed = txn.supplier_owed;

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

  // ---------------------------------------------------------------------------
  // Self-charge (LIRA-090 spec §5.2)
  // ---------------------------------------------------------------------------

  /**
   * Service-layer wrapper around
   * `FinancialServiceRepository.selfChargeTelecomItem` — the ONLY entry
   * point for write paths (REST or IPC) that need to charge a telecom catalog
   * item to the shop's own carrier line rather than a walk-in customer.
   *
   * Kept thin: all the economic logic (cost-LBP derivation, primary-line
   * lookup, carrier-line movement, payment rows) lives in the repository
   * (rule 13 — services orchestrate, repositories query/write). This wrapper
   * adds error handling, logging, and the `{ success, ... }` envelope expected
   * by both transports (rule 19c).
   */
  selfChargeTelecomItem(data: SelfChargeTelecomItemData): {
    success: boolean;
    data?: SelfChargeTelecomItemResult;
    error?: string;
  } {
    try {
      const result = this.fsRepo.selfChargeTelecomItem(data);
      financialLogger.info(
        {
          mobileServiceItemId: data.mobileServiceItemId,
          carrierLineId: result.carrierLineId,
          costLbp: result.costLbp,
          creditsAdded: result.creditsAdded,
          validityDaysAdded: result.validityDaysAdded,
          transactionId: result.transactionId,
        },
        "Telecom self-charge applied",
      );
      return { success: true, data: result };
    } catch (error) {
      financialLogger.error(
        { error, mobileServiceItemId: data.mobileServiceItemId },
        "Telecom self-charge failed",
      );
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
