/**
 * LIRA-309 — phone lines the shop holds FOR SALE: their details (carrier,
 * credit, expiry). Orchestration only; all SQL lives in
 * `ResaleLineRepository` / `CarrierLineRepository` (rule 13).
 *
 * Spec: `specs/309-phone-lines-management/spec.md` (FR-001..FR-005).
 */
import {
  getResaleLineRepository,
  type ResaleLineEntity,
  type ResaleLineRepository,
  type ResaleLineRow,
} from "../repositories/ResaleLineRepository.js";
import {
  getCarrierLineRepository,
  type CarrierLineRepository,
} from "../repositories/CarrierLineRepository.js";
import {
  isPhoneLineCategoryName,
  isSameLebanesePhone,
} from "../utils/phoneNumber.js";
import { inventoryLogger } from "../utils/logger.js";
import type {
  ListResaleLinesQuery,
  SaveResaleLineData,
} from "../validators/resaleLine.js";

/** One message for both directions of FR-005 (a number can be a shop line
 *  or an unsold for-sale line, never both). */
export const LINE_NUMBER_TAKEN_ERROR =
  "This number is already one of your lines.";

export type ResaleLineResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export class ResaleLineService {
  private repo: ResaleLineRepository;
  private carrierRepo: CarrierLineRepository;

  constructor(repo?: ResaleLineRepository, carrierRepo?: CarrierLineRepository) {
    this.repo = repo ?? getResaleLineRepository();
    this.carrierRepo = carrierRepo ?? getCarrierLineRepository();
  }

  /** The For sale list (and, with `include_sold: false`, the numbers the
   *  Mobile Recharge page checks typed numbers against). */
  listLines(query: ListResaleLinesQuery): ResaleLineRow[] {
    return this.repo.listLines({
      carrier: query.carrier,
      includeSold: query.include_sold,
    });
  }

  /** Create or update a for-sale line's details (admin). */
  saveDetails(input: SaveResaleLineData): ResaleLineResult<ResaleLineEntity> {
    try {
      const product = this.repo.getLineProduct(input.product_id);
      if (!product) return { success: false, error: "Product not found." };
      if (!isPhoneLineCategoryName(product.category)) {
        return {
          success: false,
          error: "Only products in a phone lines category have line details.",
        };
      }
      const taken = this.carrierRepo
        .getAllActive()
        .some((l) => isSameLebanesePhone(l.phone_number, product.barcode));
      if (taken) return { success: false, error: LINE_NUMBER_TAKEN_ERROR };

      const saved = this.repo.upsertDetails(input.product_id, {
        carrier: input.carrier,
        credits: input.credits,
        validityExpiresAt: input.validity_expires_at,
      });
      inventoryLogger.info(
        { productId: input.product_id, carrier: input.carrier },
        "For-sale line details saved",
      );
      return { success: true, data: saved };
    } catch (error) {
      inventoryLogger.error(
        { error, productId: input.product_id },
        "Failed to save for-sale line details",
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

let resaleLineServiceInstance: ResaleLineService | null = null;

export function getResaleLineService(): ResaleLineService {
  if (!resaleLineServiceInstance) {
    resaleLineServiceInstance = new ResaleLineService();
  }
  return resaleLineServiceInstance;
}

export function resetResaleLineService(): void {
  resaleLineServiceInstance = null;
}
