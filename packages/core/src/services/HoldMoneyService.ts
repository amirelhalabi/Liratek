/**
 * Hold Money Service
 *
 * Business logic layer for holding cash on behalf of clients. Validation and
 * orchestration only — all data access goes through HoldMoneyRepository
 * (rule 13).
 */

import {
  HoldMoneyRepository,
  getHoldMoneyRepository,
  type HoldMoneyEntity,
  type HoldMoneyStatus,
  type CreateHoldMoneyInput,
  type HoldMoneyResult,
  type HoldMoneyPickupEntity,
} from "../repositories/HoldMoneyRepository.js";
import type { HoldMoneyCollectInput } from "../validators/holdMoney.js";
import { customServiceLogger } from "../utils/logger.js";

/** Shared "is this ISO datetime valid and not in the future" guard — both
 *  write paths (create/collect) accept a client-supplied `transaction_time`
 *  (rule 27) and must reject the same malformed/future value the same way
 *  (rule 14 — one check, not two copies that could drift). */
function validateTransactionTime(
  transactionTime: string | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!transactionTime) return { ok: true };
  const txTime = new Date(transactionTime);
  if (isNaN(txTime.getTime())) {
    return { ok: false, error: "Invalid transaction_time format" };
  }
  if (txTime > new Date()) {
    return { ok: false, error: "transaction_time cannot be in the future" };
  }
  return { ok: true };
}

export class HoldMoneyService {
  private repo: HoldMoneyRepository;

  constructor(repo?: HoldMoneyRepository) {
    this.repo = repo ?? getHoldMoneyRepository();
  }

  /**
   * Create a new hold (cash in, posted per its payment legs).
   */
  createHold(
    data: CreateHoldMoneyInput,
    createdBy: number = 1,
  ): HoldMoneyResult {
    const timeCheck = validateTransactionTime(data.transaction_time);
    if (!timeCheck.ok) return { success: false, error: timeCheck.error };
    return this.repo.createHold(data, createdBy);
  }

  /**
   * Collect (return) part or all of a held amount (LIRA-214, migration
   * v183 — partial pickup). `data.usd_amount`/`data.lbp_amount` default to
   * the hold's full remaining balance when omitted.
   */
  collectHold(
    data: HoldMoneyCollectInput,
    collectedBy: number = 1,
  ): HoldMoneyResult {
    const timeCheck = validateTransactionTime(data.transaction_time);
    if (!timeCheck.ok) return { success: false, error: timeCheck.error };
    return this.repo.collectHold(data, collectedBy);
  }

  /**
   * Void (reverse) ONE pickup event — rule-20 reversal owner for a pickup
   * recorded in error.
   */
  voidPickup(pickupId: number, voidedBy: number = 1): HoldMoneyResult {
    return this.repo.voidPickup(pickupId, voidedBy);
  }

  /**
   * Every pickup event for one hold — the Active Holds detail view and the
   * void action's source list.
   */
  getPickups(holdMoneyId: number): HoldMoneyPickupEntity[] {
    try {
      return this.repo.getPickups(holdMoneyId);
    } catch (error) {
      customServiceLogger.error(
        { error, holdMoneyId },
        "Failed to get hold pickups",
      );
      return [];
    }
  }

  /**
   * Active (uncollected) holds — used by the Dashboard notification cards.
   */
  getActiveHolds(): HoldMoneyEntity[] {
    try {
      return this.repo.getActiveHolds();
    } catch (error) {
      customServiceLogger.error({ error }, "Failed to get active holds");
      return [];
    }
  }

  /**
   * All holds, optionally filtered by status.
   */
  getHolds(filter?: { status?: HoldMoneyStatus }): HoldMoneyEntity[] {
    try {
      return this.repo.getAll(filter);
    } catch (error) {
      customServiceLogger.error({ error }, "Failed to get holds");
      return [];
    }
  }

  /**
   * Single hold by ID.
   */
  getHoldById(id: number): HoldMoneyEntity | null {
    try {
      return this.repo.getById(id);
    } catch (error) {
      customServiceLogger.error({ error, id }, "Failed to get hold");
      return null;
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let holdMoneyServiceInstance: HoldMoneyService | null = null;

export function getHoldMoneyService(): HoldMoneyService {
  if (!holdMoneyServiceInstance) {
    holdMoneyServiceInstance = new HoldMoneyService();
  }
  return holdMoneyServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetHoldMoneyService(): void {
  holdMoneyServiceInstance = null;
}
