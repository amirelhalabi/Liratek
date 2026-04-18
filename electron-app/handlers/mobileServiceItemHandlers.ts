/**
 * Mobile Service Item IPC Handlers
 *
 * CRUD operations for the dynamic mobile services catalog.
 * Replaces the hardcoded mobileServices.ts with database-backed items.
 */

import { ipcMain } from "electron";
import {
  getMobileServiceItemService,
  type CreateMobileServiceItemData,
  type UpdateMobileServiceItemData,
} from "@liratek/core";
import { financialLogger } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";

export function registerMobileServiceItemHandlers(): void {
  const service = getMobileServiceItemService();

  // Get all active items
  ipcMain.handle("mobile-service-items:get-all", () => {
    try {
      const items = service.getAll();
      return { success: true, data: items };
    } catch (error) {
      financialLogger.error({ error }, "mobile-service-items:get-all failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get items",
      };
    }
  });

  // Get all items including inactive (for admin page)
  ipcMain.handle("mobile-service-items:get-all-admin", (e) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error);

      const items = service.getAllIncludingInactive();
      return { success: true, data: items };
    } catch (error) {
      financialLogger.error(
        { error },
        "mobile-service-items:get-all-admin failed",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get items",
      };
    }
  });

  // Get items by provider
  ipcMain.handle(
    "mobile-service-items:get-by-provider",
    (_event, provider: string) => {
      try {
        const items = service.getByProvider(provider);
        return { success: true, data: items };
      } catch (error) {
        financialLogger.error(
          { error },
          "mobile-service-items:get-by-provider failed",
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to get items",
        };
      }
    },
  );

  // Get items by provider + category
  ipcMain.handle(
    "mobile-service-items:get-by-provider-category",
    (_event, provider: string, category: string) => {
      try {
        const items = service.getByProviderAndCategory(provider, category);
        return { success: true, data: items };
      } catch (error) {
        financialLogger.error(
          { error },
          "mobile-service-items:get-by-provider-category failed",
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to get items",
        };
      }
    },
  );

  // Get categories for a provider
  ipcMain.handle(
    "mobile-service-items:get-categories",
    (_event, provider: string) => {
      try {
        const categories = service.getCategories(provider);
        return { success: true, data: categories };
      } catch (error) {
        financialLogger.error(
          { error },
          "mobile-service-items:get-categories failed",
        );
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to get categories",
        };
      }
    },
  );

  // Get subcategories for a provider + category
  ipcMain.handle(
    "mobile-service-items:get-subcategories",
    (_event, provider: string, category: string) => {
      try {
        const subcategories = service.getSubcategories(provider, category);
        return { success: true, data: subcategories };
      } catch (error) {
        financialLogger.error(
          { error },
          "mobile-service-items:get-subcategories failed",
        );
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to get subcategories",
        };
      }
    },
  );

  // Create a new item
  ipcMain.handle(
    "mobile-service-items:create",
    (e, data: CreateMobileServiceItemData) => {
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) throw new Error(auth.error);

        const result = service.create(data);
        audit(e.sender.id, {
          action: "create",
          entity_type: "mobile_service_item",
          summary: `Created mobile service item: ${data.label} (${data.provider})`,
        });
        return result;
      } catch (error) {
        financialLogger.error({ error }, "mobile-service-items:create failed");
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to create item",
        };
      }
    },
  );

  // Update an existing item
  ipcMain.handle(
    "mobile-service-items:update",
    (e, id: number, data: UpdateMobileServiceItemData) => {
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) throw new Error(auth.error);

        const result = service.update(id, data);
        audit(e.sender.id, {
          action: "update",
          entity_type: "mobile_service_item",
          entity_id: String(id),
          summary: `Updated mobile service item #${id}`,
        });
        return result;
      } catch (error) {
        financialLogger.error({ error }, "mobile-service-items:update failed");
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to update item",
        };
      }
    },
  );

  // Toggle active/inactive
  ipcMain.handle("mobile-service-items:toggle-active", (e, id: number) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error);

      const result = service.toggleActive(id);
      audit(e.sender.id, {
        action: "toggle",
        entity_type: "mobile_service_item",
        entity_id: String(id),
        summary: `Toggled mobile service item #${id}`,
      });
      return result;
    } catch (error) {
      financialLogger.error(
        { error },
        "mobile-service-items:toggle-active failed",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to toggle item",
      };
    }
  });

  // Delete an item
  ipcMain.handle("mobile-service-items:delete", (e, id: number) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error);

      const result = service.deleteItem(id);
      audit(e.sender.id, {
        action: "delete",
        entity_type: "mobile_service_item",
        entity_id: String(id),
        summary: `Deleted mobile service item #${id}`,
      });
      return result;
    } catch (error) {
      financialLogger.error({ error }, "mobile-service-items:delete failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete item",
      };
    }
  });

  // Seed from catalog data (only if table is empty)
  ipcMain.handle(
    "mobile-service-items:seed",
    (e, items: CreateMobileServiceItemData[]) => {
      try {
        const auth = requireRole(e.sender.id, ["admin", "staff"]);
        if (!auth.ok) throw new Error(auth.error);

        const result = service.seedFromCatalog(items);
        audit(e.sender.id, {
          action: "create",
          entity_type: "mobile_service_item",
          summary: `Seeded ${items.length} mobile service items from catalog`,
        });
        return result;
      } catch (error) {
        financialLogger.error({ error }, "mobile-service-items:seed failed");
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to seed items",
        };
      }
    },
  );

  // Get count
  ipcMain.handle("mobile-service-items:count", () => {
    try {
      const count = service.getCount();
      return { success: true, data: count };
    } catch (error) {
      financialLogger.error({ error }, "mobile-service-items:count failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to count items",
      };
    }
  });

  financialLogger.info("Mobile service item IPC handlers registered");
}
