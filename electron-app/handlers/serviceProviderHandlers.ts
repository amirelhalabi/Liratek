/**
 * Service Provider IPC Handlers
 *
 * Phase 4a (reads): the Electron IPC read path for `service_providers` — the
 * Partners "System Association" dropdown consumes this to offer the real,
 * tenant-scoped provider list instead of a hardcoded `{None, <shop's
 * non-owned system>}` pair.
 *
 * Phase 5 (this addition, FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b): the
 * write path — `ServiceProviderRepository.createProvider/updateProvider/
 * deleteProvider` existed since phase 1 but nothing exposed them. Mirrors
 * `paymentMethodHandlers.ts` shape-for-shape (`requireRole(["admin"])` on
 * every write, `validatePayload` before touching the service, `audit()`
 * after). See `ServiceProviderService`'s own doc comment for the two
 * money-safety invariants enforced there (new providers always settle to
 * `General`, `code` is never editable).
 *
 * Reads (`list`, `list-active`) have NO `requireRole` gate: mirrors
 * `payment-methods:list`/`:list-active` (paymentMethodHandlers.ts) and
 * `partners:get-all` (partnerHandlers.ts) — config-table/list reads open to
 * any authenticated role, matching the `/partners` route itself (no role
 * restriction beyond being logged in, frontend/src/app/App.tsx's
 * `ProtectedRoute`).
 */

import { ipcMain } from "electron";
import { getServiceProviderService, settingsLogger } from "@liratek/core";
import { requireRole } from "../session.js";
import {
  validatePayload,
  CreateServiceProviderSchema,
  UpdateServiceProviderSchema,
} from "../schemas/index.js";
import { audit } from "./auditHelper.js";

const log = settingsLogger.child({ sub: "serviceProviderHandlers" });

export function registerServiceProviderHandlers(): void {
  const service = getServiceProviderService();

  log.info("Registering Service Provider IPC handlers");

  // List ALL service providers (including inactive/system) — the Settings
  // management UI. Any role (see doc comment above).
  ipcMain.handle("service-providers:list", () => {
    return service.listAll();
  });

  // List active service providers only (any role)
  ipcMain.handle("service-providers:list-active", () => {
    return service.listActive();
  });

  // Create a new service provider (admin only). §5b phase 5 — drawer_name is
  // ALWAYS forced to 'General' by ServiceProviderService; this endpoint has
  // no way to route a provider's cash anywhere else (owner decision).
  ipcMain.handle(
    "service-providers:create",
    (e, data: { code: string; label: string }) => {
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) return { success: false, error: auth.error };

        const v = validatePayload(CreateServiceProviderSchema, data);
        if (!v.ok) return { success: false, error: v.error };

        log.info({ code: v.data.code }, "Creating service provider");
        const result = service.createProvider(v.data);
        audit(e.sender.id, {
          action: "create",
          entity_type: "service_provider",
          summary: `Created service provider "${v.data.code}"`,
        });
        return result;
      } catch (error) {
        log.error({ error }, "service-providers:create failed");
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to create",
        };
      }
    },
  );

  // Update a service provider (admin only). Only label/is_active are ever
  // forwarded to the repository — see ServiceProviderService's doc comment.
  ipcMain.handle(
    "service-providers:update",
    (e, id: number, data: { label?: string; is_active?: number }) => {
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) return { success: false, error: auth.error };

        const v = validatePayload(UpdateServiceProviderSchema, data);
        if (!v.ok) return { success: false, error: v.error };

        log.info({ id, data: v.data }, "Updating service provider");
        const result = service.updateProvider(id, v.data);
        audit(e.sender.id, {
          action: "update",
          entity_type: "service_provider",
          entity_id: String(id),
          summary: `Updated service provider #${id}`,
        });
        return result;
      } catch (error) {
        log.error({ error }, "service-providers:update failed");
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to update",
        };
      }
    },
  );

  // Delete a service provider (admin only, non-system only — the repository
  // rejects deleting one of the 9 seeded rows with a clear error).
  ipcMain.handle("service-providers:delete", (e, id: number) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      log.info({ id }, "Deleting service provider");
      const result = service.deleteProvider(id);
      audit(e.sender.id, {
        action: "delete",
        entity_type: "service_provider",
        entity_id: String(id),
        summary: `Deleted service provider #${id}`,
      });
      return result;
    } catch (error) {
      log.error({ error }, "service-providers:delete failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete",
      };
    }
  });

  log.info("Service Provider IPC handlers registered");
}
