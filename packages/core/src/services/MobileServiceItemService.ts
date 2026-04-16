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
import { financialLogger } from "../utils/logger.js";

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
