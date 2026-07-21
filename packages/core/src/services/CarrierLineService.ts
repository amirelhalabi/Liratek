/**
 * Carrier Line Service (LIRA W6.a)
 *
 * Business logic wrapper around CarrierLineRepository. Informational only —
 * no drawer legs, no checkout/closing involvement.
 */

import {
  CarrierLineRepository,
  getCarrierLineRepository,
  type CarrierKey,
  type CarrierLineEntity,
  type CreateCarrierLineData,
  type UpdateCarrierLineData,
  type UpdateBalanceData,
} from "../repositories/CarrierLineRepository.js";
import { financialLogger } from "../utils/logger.js";

// =============================================================================
// Types
// =============================================================================

export interface CarrierLineResult {
  success: boolean;
  data?: CarrierLineEntity;
  error?: string;
}

// =============================================================================
// Service
// =============================================================================

export class CarrierLineService {
  private repo: CarrierLineRepository;

  constructor(repo?: CarrierLineRepository) {
    this.repo = repo ?? getCarrierLineRepository();
  }

  /** Active lines for one carrier — the Recharge-tab compact panel. */
  getActiveByCarrier(carrier: CarrierKey): CarrierLineEntity[] {
    try {
      return this.repo.getActiveByCarrier(carrier);
    } catch (error) {
      financialLogger.error(
        { error, carrier },
        "Failed to get active carrier lines",
      );
      return [];
    }
  }

  /** All active lines, every carrier. */
  getAllActive(): CarrierLineEntity[] {
    try {
      return this.repo.getAllActive();
    } catch (error) {
      financialLogger.error({ error }, "Failed to get active carrier lines");
      return [];
    }
  }

  /** Every line including archived — the Settings manager. */
  getAllIncludingInactive(): CarrierLineEntity[] {
    try {
      return this.repo.getAllIncludingInactive();
    } catch (error) {
      financialLogger.error({ error }, "Failed to get carrier lines");
      return [];
    }
  }

  create(data: CreateCarrierLineData): CarrierLineResult {
    try {
      if (!data.carrier || !data.phone_number) {
        return {
          success: false,
          error: "Carrier and phone number are required",
        };
      }
      const line = this.repo.createLine(data);
      financialLogger.info(
        { lineId: line.id, carrier: data.carrier },
        "Carrier line created",
      );
      return { success: true, data: line };
    } catch (error) {
      financialLogger.error({ error }, "Failed to create carrier line");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  update(id: number, data: UpdateCarrierLineData): CarrierLineResult {
    try {
      const line = this.repo.updateLine(id, data);
      if (!line) return { success: false, error: "Carrier line not found" };
      financialLogger.info({ lineId: id }, "Carrier line updated");
      return { success: true, data: line };
    } catch (error) {
      financialLogger.error({ error, id }, "Failed to update carrier line");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** The Recharge-tab inline quick-update: credits and/or a new expiry date. */
  updateBalance(id: number, data: UpdateBalanceData): CarrierLineResult {
    try {
      const line = this.repo.updateBalance(id, data);
      if (!line) return { success: false, error: "Carrier line not found" };
      financialLogger.info({ lineId: id }, "Carrier line balance updated");
      return { success: true, data: line };
    } catch (error) {
      financialLogger.error(
        { error, id },
        "Failed to update carrier line balance",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  archive(id: number): CarrierLineResult {
    try {
      const line = this.repo.archive(id);
      if (!line) return { success: false, error: "Carrier line not found" };
      financialLogger.info({ lineId: id }, "Carrier line archived");
      return { success: true, data: line };
    } catch (error) {
      financialLogger.error({ error, id }, "Failed to archive carrier line");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  toggleActive(id: number): CarrierLineResult {
    try {
      const line = this.repo.toggleActive(id);
      if (!line) return { success: false, error: "Carrier line not found" };
      financialLogger.info(
        { lineId: id, isActive: line.is_active },
        "Carrier line toggled",
      );
      return { success: true, data: line };
    } catch (error) {
      financialLogger.error({ error, id }, "Failed to toggle carrier line");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: CarrierLineService | null = null;

export function getCarrierLineService(): CarrierLineService {
  if (!instance) {
    instance = new CarrierLineService();
  }
  return instance;
}

export function resetCarrierLineService(): void {
  instance = null;
}
