/**
 * Hold Money Service
 *
 * Business logic layer for holding cash on behalf of clients. Validation and
 * orchestration only — all data access goes through HoldMoneyRepository.
 */

import {
  HoldMoneyRepository,
  getHoldMoneyRepository,
  type HoldMoneyEntity,
  type HoldMoneyStatus,
  type CreateHoldMoneyInput,
  type HoldMoneyResult,
} from "../repositories/HoldMoneyRepository.js";
import { customServiceLogger } from "../utils/logger.js";

export class HoldMoneyService {
  private repo: HoldMoneyRepository;

  constructor(repo?: HoldMoneyRepository) {
    this.repo = repo ?? getHoldMoneyRepository();
  }

  /**
   * Create a new hold (cash in → General drawer).
   */
  createHold(
    data: CreateHoldMoneyInput,
    createdBy: number = 1,
  ): HoldMoneyResult {
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
    return this.repo.createHold(data, createdBy);
  }

  /**
   * Collect (return) a held amount (cash out ← General drawer).
   */
  collectHold(
    id: number,
    collectedBy: number = 1,
  ): { success: boolean; error?: string } {
    return this.repo.collectHold(id, collectedBy);
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
