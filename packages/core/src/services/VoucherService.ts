/**
 * Voucher Service
 *
 * Business logic layer for voucher (gift card) operations.
 * Uses VoucherRepository for data access and DebtRepository (via the repo) for
 * partial-redemption credit deposits.
 */

import {
  VoucherRepository,
  getVoucherRepository,
  type VoucherEntity,
  type VoucherFilters,
} from "../repositories/VoucherRepository.js";
import { getClientRepository } from "../repositories/ClientRepository.js";
import { voucherLogger } from "../utils/logger.js";

// =============================================================================
// Types
// =============================================================================

export interface CreateVoucherInput {
  clientId: number;
  amount: number;
  expiryDate?: string | null;
  note?: string | null;
}

export interface VoucherResult {
  success: boolean;
  voucher?: VoucherEntity;
  error?: string;
}

export interface VoucherListResult {
  success: boolean;
  vouchers?: VoucherEntity[];
  error?: string;
}

/** A GIFT_CARD payment leg to redeem against a transaction. */
export interface VoucherRedemptionLine {
  code: string;
  amount: number;
}

// =============================================================================
// Voucher Service Class
// =============================================================================

export class VoucherService {
  private repo: VoucherRepository;

  constructor(repo?: VoucherRepository) {
    this.repo = repo ?? getVoucherRepository();
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  createVoucher(input: CreateVoucherInput, createdBy: number): VoucherResult {
    try {
      if (!input.clientId) {
        return { success: false, error: "A client is required" };
      }
      if (!input.amount || input.amount <= 0) {
        return { success: false, error: "Amount must be greater than zero" };
      }

      const client = getClientRepository().findById(input.clientId);
      if (!client) {
        return { success: false, error: "Client not found" };
      }

      if (input.expiryDate) {
        const expiry = new Date(input.expiryDate);
        if (isNaN(expiry.getTime())) {
          return { success: false, error: "Invalid expiry date" };
        }
      }

      const code = this.repo.generateUniqueCode();
      const voucher = this.repo.createVoucher({
        code,
        client_id: client.id,
        client_name: client.full_name,
        client_phone: client.phone_number ?? null,
        amount: input.amount,
        expiry_date: input.expiryDate ?? null,
        note: input.note ?? null,
        created_by: createdBy,
      });

      voucherLogger.info(
        { voucherId: voucher.id, code: voucher.code, clientId: client.id },
        `Voucher ${voucher.code} created ($${voucher.amount})`,
      );
      return { success: true, voucher };
    } catch (error) {
      voucherLogger.error({ error, input }, "createVoucher failed");
      return { success: false, error: (error as Error).message };
    }
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  getVouchers(filters: VoucherFilters = {}): VoucherListResult {
    try {
      const vouchers = this.repo.getAll(filters);
      return { success: true, vouchers };
    } catch (error) {
      voucherLogger.error({ error, filters }, "getVouchers failed");
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Look up a voucher by code and report whether it can currently be redeemed.
   * Used by the checkout UI for live validation.
   */
  validateVoucher(code: string): VoucherResult {
    try {
      const normalized = (code || "").trim().toUpperCase();
      if (!normalized) {
        return { success: false, error: "Enter a voucher code" };
      }
      const voucher = this.repo.getByCode(normalized);
      if (!voucher) {
        return { success: false, error: "Voucher not found" };
      }
      if (voucher.status === "cancelled") {
        return { success: false, error: "Voucher has been cancelled" };
      }
      if (voucher.status === "redeemed") {
        return { success: false, error: "Voucher has already been redeemed" };
      }
      if (voucher.status === "expired") {
        return { success: false, error: "Voucher has expired" };
      }
      return { success: true, voucher };
    } catch (error) {
      voucherLogger.error({ error, code }, "validateVoucher failed");
      return { success: false, error: (error as Error).message };
    }
  }

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  cancelVoucher(id: number, cancelledBy: number): VoucherResult {
    try {
      const existing = this.repo.findById(id);
      if (!existing) {
        return { success: false, error: "Voucher not found" };
      }
      if (existing.status !== "pending") {
        return {
          success: false,
          error: `Only pending vouchers can be cancelled (this one is ${existing.status})`,
        };
      }
      const voucher = this.repo.cancel(id, cancelledBy);
      if (!voucher) {
        return { success: false, error: "Failed to cancel voucher" };
      }
      voucherLogger.info(
        { voucherId: id, cancelledBy },
        `Voucher ${voucher.code} cancelled`,
      );
      return { success: true, voucher };
    } catch (error) {
      voucherLogger.error({ error, id }, "cancelVoucher failed");
      return { success: false, error: (error as Error).message };
    }
  }
}

// =============================================================================
// Redemption helper (called inside transaction repositories)
// =============================================================================

/**
 * Redeem every GIFT_CARD payment leg against the given transaction.
 * MUST be called inside the parent db.transaction() so it rolls back together
 * with the originating sale / service / recharge / session.
 *
 * Throws on the first invalid voucher (caller's transaction rolls back).
 */
export function redeemVoucherLines(
  lines: VoucherRedemptionLine[],
  context: string,
  transactionId: number | null,
  userId: number,
): void {
  const repo = getVoucherRepository();
  for (const line of lines) {
    repo.redeemByCode({
      code: line.code.trim().toUpperCase(),
      context,
      transactionId,
      userId,
    });
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let voucherServiceInstance: VoucherService | null = null;

export function getVoucherService(): VoucherService {
  if (!voucherServiceInstance) {
    voucherServiceInstance = new VoucherService();
  }
  return voucherServiceInstance;
}

/** Reset the singleton (for testing) */
export function resetVoucherService(): void {
  voucherServiceInstance = null;
}
