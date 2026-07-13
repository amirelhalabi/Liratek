/**
 * Debt Service
 *
 * Business logic layer for debt operations.
 * Uses DebtRepository for data access.
 *
 * This service encapsulates:
 * - Debt queries and lookups
 * - Repayment processing
 * - Dashboard debt summaries
 */

import {
  DebtRepository,
  getDebtRepository,
  type DebtLedgerEntity,
  type DebtorSummary,
  type DebtSummary,
  type RepaymentPaymentLine,
} from "../repositories/index.js";
import { debtLogger } from "../utils/logger.js";

// =============================================================================
// Types
// =============================================================================

export interface RepaymentResult {
  success: boolean;
  id?: number;
  error?: string;
}

export interface RepaymentData {
  clientId: number;
  amountUSD: number;
  amountLBP: number;
  note?: string;
  userId: number;
  paidByMethod?: string;
  payments?: RepaymentPaymentLine[];
  /** T3 keep-change: kept (not returned) change per currency — profit stamp
   *  on the repayment transaction, never part of the debt reduction. */
  keptChangeUSD?: number;
  keptChangeLBP?: number;
  transaction_time?: string;
}

// =============================================================================
// Debt Service Class
// =============================================================================

export class DebtService {
  private debtRepo: DebtRepository;

  constructor(debtRepo?: DebtRepository) {
    this.debtRepo = debtRepo ?? getDebtRepository();
  }

  // ---------------------------------------------------------------------------
  // Debtor Queries
  // ---------------------------------------------------------------------------

  /**
   * Get all clients with outstanding debt
   */
  getDebtors(): DebtorSummary[] {
    return this.debtRepo.findAllDebtors();
  }

  /**
   * Get debt history for a specific client
   */
  getClientHistory(clientId: number): DebtLedgerEntity[] {
    if (!clientId) {
      return [];
    }
    return this.debtRepo.findClientHistory(clientId);
  }

  /**
   * Get total debt amount for a specific client
   */
  getClientTotal(clientId: number): number {
    if (!clientId) {
      return 0;
    }
    return this.debtRepo.getClientDebtTotal(clientId);
  }

  // ---------------------------------------------------------------------------
  // Repayment Operations
  // ---------------------------------------------------------------------------

  /**
   * Process a debt repayment
   */
  addRepayment(data: RepaymentData): RepaymentResult {
    const {
      clientId,
      amountUSD,
      amountLBP,
      note,
      userId,
      paidByMethod,
      payments,
      keptChangeUSD,
      keptChangeLBP,
      transaction_time,
    } = data;

    // Validate
    if (!clientId) {
      return { success: false, error: "Client ID is required" };
    }

    if (transaction_time) {
      const txTime = new Date(transaction_time);
      if (isNaN(txTime.getTime())) {
        return { success: false, error: "Invalid transaction_time format" };
      }
      if (txTime > new Date()) {
        return {
          success: false,
          error: "transaction_time cannot be in the future",
        };
      }
    }
    // When multi-payment legs are provided, validate their total > 0
    const hasLegs =
      payments && payments.length > 0 && payments.some((p) => p.amount > 0);
    if (!hasLegs && amountUSD <= 0 && amountLBP <= 0) {
      return {
        success: false,
        error: "Repayment amount must be greater than zero",
      };
    }

    // amountUSD/amountLBP are the DEBT REDUCTION; payments[] is the cash the
    // customer handed over. When the caller provides ANY explicit reduction,
    // trust both fields verbatim — the Debts page converts LBP legs into the
    // USD figure and sends amountLBP: 0, and re-deriving LBP from the legs
    // here double-counted the reduction (paid $30-worth, credited $30 + the
    // LBP legs again). Only derive from legs when BOTH amounts are absent
    // (legs-only callers).
    const callerProvidedAmounts = amountUSD > 0 || amountLBP > 0;
    const resolvedAmountUSD = callerProvidedAmounts
      ? amountUSD
      : (payments
          ?.filter((p) => p.currencyCode === "USD")
          .reduce((s, p) => s + p.amount, 0) ?? 0);
    const resolvedAmountLBP = callerProvidedAmounts
      ? amountLBP
      : (payments
          ?.filter((p) => p.currencyCode === "LBP")
          .reduce((s, p) => s + p.amount, 0) ?? 0);

    try {
      const result = this.debtRepo.addRepayment({
        client_id: clientId,
        amount_usd: resolvedAmountUSD,
        amount_lbp: resolvedAmountLBP,
        note: note || null,
        created_by: userId,
        paid_by_method: paidByMethod,
        payments,
        kept_change_usd: keptChangeUSD,
        kept_change_lbp: keptChangeLBP,
        transaction_time,
      });

      debtLogger.info(
        {
          clientId,
          amountUSD,
          amountLBP,
          repaymentId: result.id,
        },
        `Repayment of $${amountUSD} and ${amountLBP} LBP for client ${clientId}`,
      );

      return { success: true, id: result.id };
    } catch (error) {
      debtLogger.error(
        { error, clientId, amountUSD, amountLBP },
        "Failed to add repayment",
      );
      return { success: false, error: (error as Error).message };
    }
  }

  // ---------------------------------------------------------------------------
  // Credit Operations
  // ---------------------------------------------------------------------------

  /**
   * Add credit to a client's account (shop owes customer)
   */
  addCredit(data: {
    clientId: number;
    amountUsd: number;
    amountLbp: number;
    note?: string;
    userId: number;
    transactionTime?: string;
    /** Session basket this credit belongs to (session cash-out → account). */
    sessionId?: number;
  }): { success: boolean; id?: number; error?: string } {
    const {
      clientId,
      amountUsd,
      amountLbp,
      note,
      userId,
      transactionTime,
      sessionId,
    } = data;

    if (!clientId) {
      return { success: false, error: "Client ID is required" };
    }
    if ((amountUsd ?? 0) <= 0 && (amountLbp ?? 0) <= 0) {
      return {
        success: false,
        error: "At least one amount must be greater than 0",
      };
    }

    try {
      const result = this.debtRepo.addCredit({
        clientId,
        amountUsd: amountUsd ?? 0,
        amountLbp: amountLbp ?? 0,
        note: note || "",
        createdBy: String(userId),
        transactionTime,
        sessionId,
      });

      debtLogger.info(
        { clientId, amountUsd, amountLbp, creditId: result.id },
        `Credit of $${amountUsd} and ${amountLbp} LBP added for client ${clientId}`,
      );

      return { success: true, id: result.id };
    } catch (error) {
      debtLogger.error(
        { error, clientId, amountUsd, amountLbp },
        "Failed to add credit",
      );
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Cash out a client's credit: the shop PAYS the customer. amountUSD is the
   * credit reduction (LBP legs pre-converted by the caller, like repayments);
   * payments[] are the physical payout legs that debit the drawers.
   */
  cashOut(data: {
    clientId: number;
    amountUSD: number;
    amountLBP: number;
    payments?: RepaymentPaymentLine[];
    note?: string;
    userId: number;
    transaction_time?: string;
  }): RepaymentResult {
    const { clientId, amountUSD, amountLBP } = data;

    if (!clientId) {
      return { success: false, error: "Client ID is required" };
    }
    if ((amountUSD ?? 0) <= 0 && (amountLBP ?? 0) <= 0) {
      return {
        success: false,
        error: "Cash out amount must be greater than zero",
      };
    }

    // The payout may not exceed the client's credit PER CURRENCY — the excess
    // would turn into NEW client debt, which a cash-out must never create.
    // (A mixed position — USD credit + LBP debt — nets to ~0 converted, so
    // the check must be per currency, never on the converted total.)
    const balance = this.debtRepo.getClientBalance(clientId);
    const creditUsd = Math.max(0, -balance.balance_usd);
    const creditLbp = Math.max(0, -balance.balance_lbp);
    if (creditUsd <= 0 && creditLbp <= 0) {
      return { success: false, error: "Client has no credit to cash out" };
    }
    if (amountUSD > creditUsd + 0.05) {
      return {
        success: false,
        error: `Cash out ($${amountUSD.toFixed(2)}) exceeds the client's USD credit ($${creditUsd.toFixed(2)})`,
      };
    }
    if ((amountLBP ?? 0) > creditLbp + 1000) {
      return {
        success: false,
        error: `Cash out (${(amountLBP ?? 0).toLocaleString()} LBP) exceeds the client's LBP credit (${creditLbp.toLocaleString()} LBP)`,
      };
    }

    try {
      const result = this.debtRepo.cashOutCredit({
        client_id: clientId,
        amount_usd: amountUSD,
        amount_lbp: amountLBP ?? 0,
        payments: data.payments,
        note: data.note || null,
        created_by: data.userId,
        transaction_time: data.transaction_time,
      });

      debtLogger.info(
        { clientId, amountUSD, amountLBP, cashOutId: result.id },
        `Credit cash out of $${amountUSD} for client ${clientId}`,
      );

      return { success: true, id: result.id };
    } catch (error) {
      debtLogger.error(
        { error, clientId, amountUSD, amountLBP },
        "Failed to cash out credit",
      );
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Manual, till-moving account entry from the Accounts (Debts) page.
   *  - direction "credit": customer hands the shop cash → drawer IN, shop owes
   *    customer (negative ledger row).
   *  - direction "debt": shop gives the customer cash (a cash advance) → drawer
   *    OUT, customer owes shop (positive ledger row).
   * Unlike cashOut, the debt side has NO sufficiency guard — it deliberately
   * creates fresh debt (that is the whole point). The drawer may go negative,
   * consistent with cashOutCredit.
   */
  addAccountCashEntry(data: {
    direction: "credit" | "debt";
    clientId: number;
    amountUSD: number;
    amountLBP: number;
    payments?: RepaymentPaymentLine[];
    note?: string;
    userId: number;
    transaction_time?: string;
  }): RepaymentResult {
    const { direction, clientId, amountUSD, amountLBP, transaction_time } =
      data;

    if (!clientId) {
      return { success: false, error: "Client ID is required" };
    }
    if ((amountUSD ?? 0) <= 0 && (amountLBP ?? 0) <= 0) {
      return {
        success: false,
        error: "At least one amount must be greater than 0",
      };
    }
    if (transaction_time) {
      const txTime = new Date(transaction_time);
      if (isNaN(txTime.getTime())) {
        return { success: false, error: "Invalid transaction_time format" };
      }
      if (txTime > new Date()) {
        return {
          success: false,
          error: "transaction_time cannot be in the future",
        };
      }
    }

    try {
      const result = this.debtRepo.addAccountCashEntry({
        direction,
        client_id: clientId,
        amount_usd: amountUSD ?? 0,
        amount_lbp: amountLBP ?? 0,
        payments: data.payments,
        note: data.note || null,
        created_by: data.userId,
        transaction_time,
      });

      debtLogger.info(
        { direction, clientId, amountUSD, amountLBP, entryId: result.id },
        `Account ${direction} of $${amountUSD} and ${amountLBP} LBP for client ${clientId}`,
      );

      return { success: true, id: result.id };
    } catch (error) {
      debtLogger.error(
        { error, direction, clientId, amountUSD, amountLBP },
        "Failed to add account cash entry",
      );
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Use credit from a client's account (reduce credit balance)
   */
  useCredit(data: {
    clientId: number;
    amountUsd: number;
    amountLbp: number;
    note?: string;
    userId: number;
    transactionTime?: string;
  }): { success: boolean; id?: number; error?: string } {
    const { clientId, amountUsd, amountLbp, note, userId, transactionTime } =
      data;

    if (!clientId) {
      return { success: false, error: "Client ID is required" };
    }
    if ((amountUsd ?? 0) <= 0 && (amountLbp ?? 0) <= 0) {
      return {
        success: false,
        error: "At least one amount must be greater than 0",
      };
    }

    // Validate available credit (balance must be negative = has credit)
    const balance = this.debtRepo.getClientBalance(clientId);
    // Credit available = negative balance means shop owes customer
    // If balance_usd is -50 and they want to use $60, reject
    if (amountUsd > 0 && balance.balance_usd > -amountUsd + 0.01) {
      // balance_usd should be <= -amountUsd (i.e. they have enough credit)
      // balance_usd = -50 means $50 credit. Using $60 → -50 > -60+0.01 = -59.99 → -50 > -59.99 → true → reject
      // Actually: available credit USD = -balance_usd (when negative). If balance_usd >= 0, no credit.
      const availableUsd = balance.balance_usd < 0 ? -balance.balance_usd : 0;
      if (amountUsd > availableUsd + 0.01) {
        return {
          success: false,
          error: `Insufficient USD credit. Available: $${availableUsd.toFixed(2)}`,
        };
      }
    }
    if (amountLbp > 0) {
      const availableLbp = balance.balance_lbp < 0 ? -balance.balance_lbp : 0;
      if (amountLbp > availableLbp + 0.01) {
        return {
          success: false,
          error: `Insufficient LBP credit. Available: ${availableLbp.toFixed(0)} LBP`,
        };
      }
    }

    try {
      const result = this.debtRepo.useCredit({
        clientId,
        amountUsd: amountUsd ?? 0,
        amountLbp: amountLbp ?? 0,
        note: note || "",
        createdBy: String(userId),
        transactionTime,
      });

      debtLogger.info(
        { clientId, amountUsd, amountLbp, creditUsedId: result.id },
        `Credit of $${amountUsd} and ${amountLbp} LBP used for client ${clientId}`,
      );

      return { success: true, id: result.id };
    } catch (error) {
      debtLogger.error(
        { error, clientId, amountUsd, amountLbp },
        "Failed to use credit",
      );
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get net balance for a client.
   * Positive = owes shop. Negative = shop owes customer (has credit).
   */
  getClientBalance(clientId: number): {
    balance_usd: number;
    balance_lbp: number;
  } {
    if (!clientId) {
      return { balance_usd: 0, balance_lbp: 0 };
    }
    return this.debtRepo.getClientBalance(clientId);
  }

  // ---------------------------------------------------------------------------
  // Dashboard Queries
  // ---------------------------------------------------------------------------

  /**
   * Get debt summary for dashboard display
   */
  getDebtSummary(): DebtSummary {
    return this.debtRepo.getDebtSummary(5);
  }

  /**
   * Update non-financial metadata on a debt ledger entry.
   * Records old/new values for audit trail.
   */
  updateDebtMetadata(
    id: number,
    data: { note?: string },
    editedBy: string,
  ): {
    success: boolean;
    entity?: DebtLedgerEntity;
    oldValues?: Record<string, unknown>;
    error?: string;
  } {
    const existing = this.debtRepo.findById(id);
    if (!existing) {
      return { success: false, error: "Debt entry not found" };
    }

    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};

    if (data.note !== undefined && data.note !== existing.note) {
      oldValues.note = existing.note;
      newValues.note = data.note;
    }

    if (Object.keys(newValues).length === 0) {
      return { success: true, entity: existing };
    }

    const updated = this.debtRepo.updateMetadata(id, data, editedBy);
    if (!updated) {
      return { success: false, error: "Failed to update" };
    }

    debtLogger.info(
      { id, editedBy, oldValues, newValues },
      "Debt entry metadata updated",
    );

    return { success: true, entity: updated, oldValues };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let debtServiceInstance: DebtService | null = null;

export function getDebtService(): DebtService {
  if (!debtServiceInstance) {
    debtServiceInstance = new DebtService();
  }
  return debtServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetDebtService(): void {
  debtServiceInstance = null;
}
