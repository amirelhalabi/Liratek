/**
 * Recharge Service
 *
 * Business logic layer for mobile recharge operations (MTC/Alfa).
 */

import {
  RechargeRepository,
  getRechargeRepository,
  type VirtualStock,
  type RechargeData,
  type RechargeEntity,
} from "../repositories/index.js";
import { rechargeLogger } from "../utils/logger.js";
import type { TopUpProvider } from "../constants/index.js";

// =============================================================================
// Types
// =============================================================================

export interface RechargeResult {
  success: boolean;
  id?: number;
  error?: string;
}

// =============================================================================
// Recharge Service Class
// =============================================================================

export class RechargeService {
  private rechargeRepo: RechargeRepository;

  constructor(rechargeRepo?: RechargeRepository) {
    this.rechargeRepo = rechargeRepo ?? getRechargeRepository();
  }

  /**
   * Get virtual stock for MTC and Alfa
   */
  getStock(): VirtualStock {
    try {
      return this.rechargeRepo.getVirtualStock();
    } catch (error) {
      rechargeLogger.error({ error }, "Failed to get recharge stock");
      return { mtc: 0, alfa: 0 };
    }
  }

  /**
   * Get recharge history for a provider
   */
  getHistory(provider: "MTC" | "Alfa"): RechargeEntity[] {
    try {
      return this.rechargeRepo.getHistory(provider);
    } catch (error) {
      rechargeLogger.error({ error }, "Failed to get recharge history");
      return [];
    }
  }

  /**
   * Process a recharge transaction
   */
  processRecharge(data: RechargeData): RechargeResult {
    if (data.transaction_time) {
      const txTime = new Date(data.transaction_time);
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
    return this.rechargeRepo.processRecharge(data);
  }

  /**
   * Top up provider drawer from another drawer
   */
  topUpApp(data: {
    provider: TopUpProvider;
    amount: number;
    currency: string;
    sourceDrawer: string;
    userId: number;
  }): { success: boolean; error?: string } {
    return this.rechargeRepo.topUpApp(data);
  }

  /**
   * Top up a Katsh, iPick, or OMT App provider drawer via supplier credit.
   * No source drawer is deducted — the supplier extends credit.
   *
   * LIRA-190 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §1 D2/D4): `"OMT_APP"` widened
   * onto this existing pass-through — the repository resolves the `'OMT
   * App'` supplier, which LIRA-187's migration parents under `'OMT'`, so the
   * booking lands in the OMT open-credit account with no new logic here.
   */
  topUpFromSupplier(data: {
    provider: "iPick" | "Katsh" | "OMT_APP";
    amount: number;
    currency: string;
    userId: number;
  }): { success: boolean; error?: string } {
    if (!(data.amount > 0)) {
      return { success: false, error: "Amount must be greater than 0" };
    }
    return this.rechargeRepo.topUpFromSupplier(data);
  }

  /**
   * "Cash Out to OMT" (LIRA-192, OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §8) — thin
   * pass-through to {@link RechargeRepository.cashoutToSupplier}, mirroring
   * {@link topUpFromSupplier} above. All money movement, the balance guard
   * (D15), and the commission computation live in the repository (rule 13);
   * this method adds no SQL and no business logic.
   */
  cashoutToSupplier(data: {
    provider: "OMT_APP";
    amount: number;
    currency: string;
    userId: number;
  }): { success: boolean; error?: string; commission?: number } {
    return this.rechargeRepo.cashoutToSupplier(data);
  }

  /**
   * Top up the Whish App drawer via a partner (partner extends credit).
   * No source drawer is deducted; a CREDIT partner_ledger entry is recorded.
   */
  topUpFromPartner(data: {
    provider: "WHISH_APP";
    partnerId: number;
    amount: number;
    currency: string;
    userId: number;
  }): { success: boolean; error?: string } {
    if (!(data.amount > 0)) {
      return { success: false, error: "Amount must be greater than 0" };
    }
    return this.rechargeRepo.topUpFromPartner(data);
  }

  /**
   * Top up the Whish App drawer with credits transferred by a client
   * (credits in, cash paid out of the shop's own drawers via real payout
   * legs — a follow-on from the owner's LIRA-194 session, not LIRA-195 —
   * that ticket is a separate, already-archived plan; see
   * `RechargeRepository.topUpFromClient`'s doc comment for the full money
   * model and the OUT-leg/drawer-affecting guards).
   */
  topUpFromClient(data: {
    amount: number;
    currency: string;
    payments: Array<{
      method: string;
      currencyCode: string;
      amount: number;
      direction?: "IN" | "OUT";
    }>;
    exchangeRate?: number;
    clientName?: string;
    clientId?: number;
    userId: number;
  }): { success: boolean; error?: string } {
    if (!(data.amount > 0)) {
      return { success: false, error: "Amount must be greater than 0" };
    }
    if (!data.payments || data.payments.length === 0) {
      return {
        success: false,
        error: "Payment legs are required for a client top-up payout",
      };
    }
    return this.rechargeRepo.topUpFromClient(data);
  }

  /**
   * Get all drawer balances
   */
  getDrawerBalances(): Array<{
    name: string;
    usdBalance: number;
    lbpBalance: number;
  }> {
    return this.rechargeRepo.getDrawerBalances();
  }

  /**
   * Update non-financial metadata on a recharge.
   * Records old/new values for audit trail.
   */
  updateRechargeMetadata(
    id: number,
    data: { phone_number?: string; client_name?: string; note?: string },
    editedBy: string,
  ): {
    success: boolean;
    entity?: RechargeEntity;
    oldValues?: Record<string, unknown>;
    error?: string;
  } {
    const existing = this.rechargeRepo.findById(id);
    if (!existing) {
      return { success: false, error: "Recharge not found" };
    }

    // Capture old values for audit
    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};

    if (
      data.phone_number !== undefined &&
      data.phone_number !== existing.phone_number
    ) {
      oldValues.phone_number = existing.phone_number;
      newValues.phone_number = data.phone_number;
    }
    if (
      data.client_name !== undefined &&
      data.client_name !== existing.client_name
    ) {
      oldValues.client_name = existing.client_name;
      newValues.client_name = data.client_name;
    }
    if (data.note !== undefined && data.note !== existing.note) {
      oldValues.note = existing.note;
      newValues.note = data.note;
    }

    if (Object.keys(newValues).length === 0) {
      return { success: true, entity: existing }; // No actual changes
    }

    const updated = this.rechargeRepo.updateMetadata(id, data, editedBy);
    if (!updated) {
      return { success: false, error: "Failed to update" };
    }

    rechargeLogger.info(
      { id, editedBy, oldValues, newValues },
      "Recharge metadata updated",
    );

    return { success: true, entity: updated, oldValues };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let rechargeServiceInstance: RechargeService | null = null;

export function getRechargeService(): RechargeService {
  if (!rechargeServiceInstance) {
    rechargeServiceInstance = new RechargeService();
  }
  return rechargeServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetRechargeService(): void {
  rechargeServiceInstance = null;
}
