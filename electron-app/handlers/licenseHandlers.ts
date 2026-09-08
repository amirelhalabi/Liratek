/**
 * Licence IPC — the desktop side of subscription management.
 *
 * Three channels, all admin-only, all read/write against the LOCAL database:
 * report what the local subscription row says, save the owner-issued key, and
 * force a sync now.
 *
 * Nothing here decides entitlement. `ModuleService` does that, from the same
 * row, for both transports — these channels only move the key in and the
 * server's answer back (rules 13/19).
 */

import { ipcMain } from "electron";
import { getSettingsService } from "@liratek/core";
import { requireRole } from "../session.js";
import {
  syncLicense,
  localLicenseStatus,
  LICENSE_KEY_SETTING,
  LICENSE_SERVER_SETTING,
} from "../licenseSync.js";

/**
 * A key is never sent back to the renderer in full.
 *
 * The Settings screen needs to show that a key IS configured, not what it is.
 * Echoing it would put a credential into renderer memory, the React devtools
 * and any screenshot of the settings page, for no gain — the person who typed
 * it already has it, and the owner can always reissue.
 */
function maskKey(key: string | undefined): string | null {
  if (!key) return null;
  return key.length <= 8 ? "********" : `${key.slice(0, 8)}...`;
}

export function registerLicenseHandlers(): void {
  // license:status — what the LOCAL row says, plus whether a key is set.
  // Never hits the network, so it is instant and works offline.
  ipcMain.handle("license:status", (event) => {
    const auth = requireRole(event.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };

    try {
      const key = getSettingsService()
        .getSettingValue(LICENSE_KEY_SETTING)
        ?.value?.trim();
      const server = getSettingsService()
        .getSettingValue(LICENSE_SERVER_SETTING)
        ?.value?.trim();

      return {
        success: true,
        data: {
          licenseKeyMasked: maskKey(key),
          hasLicenseKey: Boolean(key),
          serverUrl: server ?? null,
          subscription: localLicenseStatus(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to read licence",
      };
    }
  });

  // license:setKey — store the owner-issued key (or clear it), then sync.
  //
  // Syncing immediately is the point: the person typing the key wants to know
  // NOW whether it worked, and a wrong key that silently does nothing for four
  // hours is indistinguishable from a broken feature.
  ipcMain.handle(
    "license:setKey",
    async (event, data: { licenseKey?: string | null }) => {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      try {
        const next = data?.licenseKey?.trim() ?? "";
        getSettingsService().updateSetting(LICENSE_KEY_SETTING, next);

        // Clearing the key does NOT re-restrict anything: with no key the app
        // is unlicensed, and unlicensed means unrestricted. But the stale
        // allowlist left in the local row would keep applying, so wipe it.
        if (!next) {
          const { getSubscriptionRepository } = await import("@liratek/core");
          getSubscriptionRepository().update(1, { entitled_modules: null });
          return {
            success: true,
            data: { checked: false, detail: "Licence key cleared" },
          };
        }

        const outcome = await syncLicense();
        return { success: true, data: outcome };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to save",
        };
      }
    },
  );

  // license:check — the "check now" button, for talking a customer through a
  // plan change over the phone instead of waiting for the timer.
  ipcMain.handle("license:check", async (event) => {
    const auth = requireRole(event.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };

    const outcome = await syncLicense();
    return { success: true, data: outcome };
  });
}
