/**
 * Mobile Service Item Service
 *
 * Business logic for the dynamic mobile services catalog.
 * Wraps MobileServiceItemRepository with error handling and logging.
 */

import {
  MobileServiceItemRepository,
  getMobileServiceItemRepository,
  type MobileServiceItemEntity,
  type CreateMobileServiceItemData,
  type UpdateMobileServiceItemData,
} from "../repositories/MobileServiceItemRepository.js";
import { isTelecomSplitComplete } from "../utils/telecomCredit.js";
import { financialLogger } from "../utils/logger.js";

// =============================================================================
// LIRA-090 — Only-Days split consistency gate (rule 14: one definition)
// =============================================================================

/**
 * The narrow slice of `isTelecomSplitComplete`'s five clauses this gate
 * enforces at write time (spec §5.1's precondition, restated for
 * create/update): "`days_cost_lbp` present must imply `days_cost_lbp > 0
 * && days_cost_lbp < cost_lbp`". An item is allowed to have NO split
 * configured at all (plan §3 decision 5 — columns start nullable and stay
 * that way for most catalog items), but the moment an admin supplies a
 * `days_cost_lbp` value, it must not be nonsensical relative to `cost_lbp` —
 * a value like 0, negative, or >= `cost_lbp` would make
 * `deriveItemEconomics` produce a negative/zero `creditCostLbp` and silently
 * corrupt the Only-Days economics.
 *
 * Reuses `isTelecomSplitComplete` rather than re-deriving the
 * `days_cost_lbp > 0 && days_cost_lbp < cost_lbp` arithmetic by hand (rule
 * 14). `isTelecomSplitComplete` also requires `credits > 0`, which is NOT
 * part of this narrower write-time rule — `credits` may legitimately still
 * be unset when only the days-cost half of the split is being entered (the
 * full-completeness gate that unlocks the computed Only-Days sale flow is
 * enforced separately, at sale time, by the money-path repository). So the
 * effective `credits` value is probed with a positive sentinel (`1`) when
 * it is not already a positive number, isolating this check to exactly the
 * `cost_lbp`/`days_cost_lbp` relationship the ticket specifies.
 */
function daysCostLbpConsistencyError(candidate: {
  cost_lbp: number | null | undefined;
  days_cost_lbp: number | null | undefined;
  credits: number | null | undefined;
}): string | null {
  if (
    candidate.days_cost_lbp === null ||
    candidate.days_cost_lbp === undefined
  ) {
    return null; // No split being configured — always valid (plan §3 decision 5).
  }

  const creditsForCheck =
    typeof candidate.credits === "number" && candidate.credits > 0
      ? candidate.credits
      : 1; // sentinel — see doc comment above

  const consistent = isTelecomSplitComplete({
    cost_lbp: candidate.cost_lbp,
    days_cost_lbp: candidate.days_cost_lbp,
    credits: creditsForCheck,
  });

  if (!consistent) {
    return (
      `days_cost_lbp must be a positive number less than cost_lbp ` +
      `(cost_lbp=${candidate.cost_lbp ?? "unset"}, days_cost_lbp=${candidate.days_cost_lbp})`
    );
  }

  return null;
}

// =============================================================================
// Types
// =============================================================================

export interface MobileServiceItemResult {
  success: boolean;
  data?: MobileServiceItemEntity;
  error?: string;
}

export interface MobileServiceItemBulkResult {
  success: boolean;
  count?: number;
  error?: string;
}

// =============================================================================
// Mobile Service Item Service Class
// =============================================================================

export class MobileServiceItemService {
  private repo: MobileServiceItemRepository;

  constructor(repo?: MobileServiceItemRepository) {
    this.repo = repo ?? getMobileServiceItemRepository();
  }

  /**
   * Get all active items
   */
  getAll(): MobileServiceItemEntity[] {
    try {
      return this.repo.getAll();
    } catch (error) {
      financialLogger.error({ error }, "Failed to get mobile service items");
      return [];
    }
  }

  /**
   * Get all items including inactive (for admin page)
   */
  getAllIncludingInactive(): MobileServiceItemEntity[] {
    try {
      return this.repo.getAllIncludingInactive();
    } catch (error) {
      financialLogger.error(
        { error },
        "Failed to get all mobile service items",
      );
      return [];
    }
  }

  /**
   * Get items for a specific provider
   */
  getByProvider(provider: string): MobileServiceItemEntity[] {
    try {
      return this.repo.getByProvider(provider);
    } catch (error) {
      financialLogger.error(
        { error, provider },
        "Failed to get items by provider",
      );
      return [];
    }
  }

  /**
   * Get items for a specific provider + category
   */
  getByProviderAndCategory(
    provider: string,
    category: string,
  ): MobileServiceItemEntity[] {
    try {
      return this.repo.getByProviderAndCategory(provider, category);
    } catch (error) {
      financialLogger.error(
        { error, provider, category },
        "Failed to get items by provider and category",
      );
      return [];
    }
  }

  /**
   * Get distinct categories for a provider
   */
  getCategories(provider: string): string[] {
    try {
      return this.repo.getCategories(provider);
    } catch (error) {
      financialLogger.error({ error, provider }, "Failed to get categories");
      return [];
    }
  }

  /**
   * Get distinct subcategories for a provider + category
   */
  getSubcategories(provider: string, category: string): string[] {
    try {
      return this.repo.getSubcategories(provider, category);
    } catch (error) {
      financialLogger.error(
        { error, provider, category },
        "Failed to get subcategories",
      );
      return [];
    }
  }

  /**
   * Create a new item
   */
  create(data: CreateMobileServiceItemData): MobileServiceItemResult {
    try {
      if (
        !data.provider ||
        !data.category ||
        !data.subcategory ||
        !data.label
      ) {
        return {
          success: false,
          error: "Provider, category, subcategory, and label are required",
        };
      }

      const splitError = daysCostLbpConsistencyError({
        cost_lbp: data.cost_lbp,
        days_cost_lbp: data.days_cost_lbp,
        credits: data.credits,
      });
      if (splitError) {
        return { success: false, error: splitError };
      }

      const item = this.repo.createItem(data);
      financialLogger.info(
        { itemId: item.id, provider: data.provider, label: data.label },
        "Mobile service item created",
      );
      return { success: true, data: item };
    } catch (error) {
      financialLogger.error({ error }, "Failed to create mobile service item");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Update an existing item
   */
  update(
    id: number,
    data: UpdateMobileServiceItemData,
  ): MobileServiceItemResult {
    try {
      // LIRA-090: fetch the existing row first — split-consistency validation
      // needs the EFFECTIVE cost_lbp/credits (this call's value if the caller
      // sent one, else whatever is already stored) whenever days_cost_lbp is
      // being set without cost_lbp/credits in the same call.
      const existing = this.repo.getById(id);
      if (!existing) {
        return { success: false, error: "Item not found" };
      }

      const splitError = daysCostLbpConsistencyError({
        cost_lbp:
          data.cost_lbp !== undefined ? data.cost_lbp : existing.cost_lbp,
        days_cost_lbp: data.days_cost_lbp,
        credits: data.credits !== undefined ? data.credits : existing.credits,
      });
      if (splitError) {
        return { success: false, error: splitError };
      }

      const item = this.repo.updateItem(id, data);
      if (!item) {
        return { success: false, error: "Item not found" };
      }
      financialLogger.info({ itemId: id }, "Mobile service item updated");
      return { success: true, data: item };
    } catch (error) {
      financialLogger.error(
        { error, id },
        "Failed to update mobile service item",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Toggle active/inactive status
   */
  toggleActive(id: number): MobileServiceItemResult {
    try {
      const item = this.repo.toggleActive(id);
      if (!item) {
        return { success: false, error: "Item not found" };
      }
      financialLogger.info(
        { itemId: id, isActive: item.is_active },
        "Mobile service item toggled",
      );
      return { success: true, data: item };
    } catch (error) {
      financialLogger.error(
        { error, id },
        "Failed to toggle mobile service item",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Hard delete an item
   */
  deleteItem(id: number): { success: boolean; error?: string } {
    try {
      this.repo.deleteItem(id);
      financialLogger.info({ itemId: id }, "Mobile service item deleted");
      return { success: true };
    } catch (error) {
      financialLogger.error(
        { error, id },
        "Failed to delete mobile service item",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Seed items from catalog data (only if table is empty)
   */
  seedFromCatalog(
    items: CreateMobileServiceItemData[],
  ): MobileServiceItemBulkResult {
    try {
      const existingCount = this.repo.getCount();
      if (existingCount > 0) {
        financialLogger.info(
          { existingCount },
          "Mobile service items already seeded, skipping",
        );
        return { success: true, count: 0 };
      }

      const count = this.repo.bulkCreate(items);
      financialLogger.info(
        { count },
        "Mobile service items seeded from catalog",
      );
      return { success: true, count };
    } catch (error) {
      financialLogger.error({ error }, "Failed to seed mobile service items");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get total count of items
   */
  getCount(): number {
    try {
      return this.repo.getCount();
    } catch (error) {
      financialLogger.error({ error }, "Failed to count mobile service items");
      return 0;
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let instance: MobileServiceItemService | null = null;

export function getMobileServiceItemService(): MobileServiceItemService {
  if (!instance) {
    instance = new MobileServiceItemService();
  }
  return instance;
}

export function resetMobileServiceItemService(): void {
  instance = null;
}
