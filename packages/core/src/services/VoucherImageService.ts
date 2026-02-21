/**
 * Voucher Image Service
 *
 * Business logic for per-item voucher image associations.
 */

import {
  VoucherImageRepository,
  getVoucherImageRepository,
  type VoucherImageEntity,
} from "../repositories/VoucherImageRepository.js";
import { financialLogger } from "../utils/logger.js";

// =============================================================================
// Types
// =============================================================================

export interface VoucherImageResult {
  success: boolean;
  error?: string;
}

// =============================================================================
// Voucher Image Service Class
// =============================================================================

export class VoucherImageService {
  private repo: VoucherImageRepository;

  constructor(repo?: VoucherImageRepository) {
    this.repo = repo ?? getVoucherImageRepository();
  }

  getAllImages(): VoucherImageEntity[] {
    try {
      return this.repo.getAllImages();
    } catch (error) {
      financialLogger.error({ error }, "Failed to get voucher images");
      return [];
    }
  }

  getImage(
    provider: string,
    category: string,
    itemKey: string,
  ): VoucherImageEntity | null {
    try {
      return this.repo.getImage(provider, category, itemKey);
    } catch (error) {
      financialLogger.error({ error }, "Failed to get voucher image");
      return null;
    }
  }

  setImage(
    provider: string,
    category: string,
    itemKey: string,
    imagePath: string,
  ): VoucherImageResult {
    try {
      this.repo.setImage(provider, category, itemKey, imagePath);
      financialLogger.info(
        { provider, category, itemKey, imagePath },
        "Voucher image saved",
      );
      return { success: true };
    } catch (error) {
      financialLogger.error({ error }, "Failed to set voucher image");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  deleteImage(id: number): VoucherImageResult {
    try {
      const deleted = this.repo.deleteImage(id);
      if (!deleted) {
        return { success: false, error: "Image not found" };
      }
      return { success: true };
    } catch (error) {
      financialLogger.error({ error }, "Failed to delete voucher image");
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

let voucherImageServiceInstance: VoucherImageService | null = null;

export function getVoucherImageService(): VoucherImageService {
  if (!voucherImageServiceInstance) {
    voucherImageServiceInstance = new VoucherImageService();
  }
  return voucherImageServiceInstance;
}

export function resetVoucherImageService(): void {
  voucherImageServiceInstance = null;
}
