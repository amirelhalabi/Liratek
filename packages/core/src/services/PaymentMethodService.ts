/**
 * Payment Method Service
 *
 * Business logic for managing payment methods and resolving
 * method codes to drawer names.
 */

import {
  PaymentMethodRepository,
  getPaymentMethodRepository,
} from "../repositories/PaymentMethodRepository.js";
import type {
  PaymentMethodEntity,
  CreatePaymentMethodData,
  UpdatePaymentMethodData,
} from "../repositories/PaymentMethodRepository.js";
import { settingsLogger } from "../utils/logger.js";

const log = settingsLogger.child({ sub: "paymentMethods" });

export interface PaymentMethodResult {
  success: boolean;
  id?: number;
  error?: string;
}

export class PaymentMethodService {
  private repo: PaymentMethodRepository;

  constructor(repo?: PaymentMethodRepository) {
    this.repo = repo ?? getPaymentMethodRepository();
  }

  /** List all payment methods (including inactive) */
  listAll(): PaymentMethodEntity[] {
    try {
      return this.repo.getAll();
    } catch (error) {
      log.error({ error }, "PaymentMethodService.listAll error");
      return [];
    }
  }

  /** List only active payment methods */
  listActive(): PaymentMethodEntity[] {
    try {
      return this.repo.getActive();
    } catch (error) {
      log.error({ error }, "PaymentMethodService.listActive error");
      return [];
    }
  }

  /** Resolve a payment method code to its drawer name */
  resolveDrawerName(code: string): string {
    try {
      return this.repo.resolveDrawerName(code);
    } catch (error) {
      log.error(
        { error, code },
        "PaymentMethodService.resolveDrawerName error",
      );
      return "General";
    }
  }

  /** Check if a payment method affects a drawer (true for everything except DEBT) */
  isDrawerAffecting(code: string): boolean {
    try {
      return this.repo.isDrawerAffecting(code);
    } catch (error) {
      log.error(
        { error, code },
        "PaymentMethodService.isDrawerAffecting error",
      );
      return code !== "DEBT";
    }
  }

  /** Create a new payment method */
  create(data: CreatePaymentMethodData): PaymentMethodResult {
    try {
      if (!data.code || !data.label || !data.drawer_name) {
        return {
          success: false,
          error: "code, label, and drawer_name are required",
        };
      }
      const result = this.repo.create(data);
      if (result.success) {
        log.info(
          { code: data.code, drawer: data.drawer_name },
          "Payment method created",
        );
      }
      return result;
    } catch (error) {
      log.error({ error, data }, "PaymentMethodService.create error");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Update an existing payment method */
  update(id: number, data: UpdatePaymentMethodData): PaymentMethodResult {
    try {
      const result = this.repo.update(id, data);
      if (result.success) {
        log.info({ id, data }, "Payment method updated");
      }
      return result;
    } catch (error) {
      log.error({ error, id, data }, "PaymentMethodService.update error");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Delete a non-system payment method */
  delete(id: number): PaymentMethodResult {
    try {
      const result = this.repo.delete(id);
      if (result.success) {
        log.info({ id }, "Payment method deleted");
      }
      return result;
    } catch (error) {
      log.error({ error, id }, "PaymentMethodService.delete error");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Reorder payment methods by ID array */
  reorder(ids: number[]): PaymentMethodResult {
    try {
      if (!Array.isArray(ids) || ids.length === 0) {
        return { success: false, error: "ids must be a non-empty array" };
      }
      const result = this.repo.reorder(ids);
      if (result.success) {
        log.info({ ids }, "Payment methods reordered");
      }
      return result;
    } catch (error) {
      log.error({ error, ids }, "PaymentMethodService.reorder error");
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

let paymentMethodServiceInstance: PaymentMethodService | null = null;

export function getPaymentMethodService(): PaymentMethodService {
  if (!paymentMethodServiceInstance) {
    paymentMethodServiceInstance = new PaymentMethodService();
  }
  return paymentMethodServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetPaymentMethodService(): void {
  paymentMethodServiceInstance = null;
}
