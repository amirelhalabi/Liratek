/**
 * Service Provider IPC Handlers
 *
 * Registers the Electron IPC read path for `service_providers`
 * (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 4a) — the Partners
 * "System Association" dropdown consumes this to offer the real, tenant-
 * scoped provider list instead of a hardcoded `{None, <shop's non-owned
 * system>}` pair.
 *
 * No `requireRole` gate: mirrors `payment-methods:list-active`
 * (paymentMethodHandlers.ts) and `partners:get-all` (partnerHandlers.ts) —
 * both config-table/list reads open to any authenticated role, matching the
 * `/partners` route itself (no role restriction beyond being logged in,
 * frontend/src/app/App.tsx's `ProtectedRoute`).
 */

import { ipcMain } from "electron";
import { getServiceProviderService, settingsLogger } from "@liratek/core";

const log = settingsLogger.child({ sub: "serviceProviderHandlers" });

export function registerServiceProviderHandlers(): void {
  const service = getServiceProviderService();

  log.info("Registering Service Provider IPC handlers");

  // List active service providers only (any role)
  ipcMain.handle("service-providers:list-active", () => {
    return service.listActive();
  });

  log.info("Service Provider IPC handlers registered");
}
