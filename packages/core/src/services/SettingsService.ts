import {
  SettingsRepository,
  SettingEntity,
  getSettingsRepository,
} from "../repositories/SettingsRepository.js";
import { PROFITS_PASSWORD_SETTING_KEY } from "../constants/profitsAccess.js";
import { settingsLogger } from "../utils/logger.js";

export interface SettingResult {
  success: boolean;
  error?: string;
}

/**
 * Setting keys that must NEVER round-trip through the generic settings pipe.
 *
 * `GET /api/settings` (backend/src/api/settings.ts) is DELIBERATELY
 * unauthenticated, and the IPC channels `settings:get-all` / `db:get-settings`
 * / `db:get-setting` (electron-app/handlers/dbHandlers.ts) carry no role
 * check — so anything stored in `system_settings` is effectively
 * world-readable through those surfaces. A secret stored under a plain
 * key_name (e.g. the profits password hash) would leak through them.
 *
 * `PROFITS_PASSWORD_SETTING_KEY` is redacted from every read below and its
 * writes are rejected here — the password is set ONLY through
 * `ProfitsAccessService`, which talks to `SettingsRepository` directly.
 * `PUT /api/settings/:key` also currently has `authenticateJWT` but NO
 * `requireRole`, so without the write-guard any authenticated staff user
 * could overwrite the hash through the generic endpoint.
 *
 * Do not remove a key from this set without adding an authenticated,
 * role-gated replacement read/write path for it first.
 */
const SENSITIVE_SETTING_KEYS = new Set<string>([PROFITS_PASSWORD_SETTING_KEY]);

export class SettingsService {
  private repo: SettingsRepository;

  constructor(repo?: SettingsRepository) {
    this.repo = repo ?? getSettingsRepository();
  }

  /**
   * Get all settings
   */
  /**
   * Every setting for the current tenant.
   *
   * THROWS rather than returning an empty array on failure, deliberately.
   * Swallowing the error is what made a real bug invisible: called with no
   * tenant context this logged and returned [], the route answered 200,
   * and the UI rendered blank fields that looked like unsaved data. An
   * empty list is a valid ANSWER; it must not double as an error signal.
   */
  getAllSettings(): SettingEntity[] {
    return this.repo
      .getAllSettings()
      .filter((setting) => !SENSITIVE_SETTING_KEYS.has(setting.key_name));
  }

  /**
   * Get a setting by key
   */
  getSetting(key: string): SettingEntity | undefined {
    if (SENSITIVE_SETTING_KEYS.has(key)) return undefined;
    try {
      return this.repo.getSetting(key);
    } catch (error) {
      settingsLogger.error({ error, key }, "SettingsService.getSetting error");
      return undefined;
    }
  }

  /**
   * Get setting value by key
   */
  getSettingValue(key: string): { value: string } | undefined {
    if (SENSITIVE_SETTING_KEYS.has(key)) return undefined;
    try {
      const value = this.repo.getSettingValue(key);
      return value !== undefined ? { value } : undefined;
    } catch (error) {
      settingsLogger.error(
        { error, key },
        "SettingsService.getSettingValue error",
      );
      return undefined;
    }
  }

  /**
   * Check if the setup wizard has been completed
   */
  isSetupComplete(): boolean {
    try {
      const value = this.repo.getSettingValue("setup_complete");
      return value === "1";
    } catch {
      return false;
    }
  }

  /**
   * Mark setup as complete
   */
  markSetupComplete(): SettingResult {
    return this.updateSetting("setup_complete", "1");
  }

  /**
   * Reset setup (for factory-reset / demo scenarios)
   */
  resetSetup(): SettingResult {
    return this.updateSetting("setup_complete", "0");
  }

  /**
   * Get a feature flag value ('enabled' | 'disabled')
   */
  getFeatureFlag(key: string): "enabled" | "disabled" {
    try {
      const value = this.repo.getSettingValue(key);
      return value === "disabled" ? "disabled" : "enabled";
    } catch {
      return "enabled";
    }
  }

  /**
   * Get the shop's base system (OMT or WHISH)
   */
  getShopBaseSystem(): "OMT" | "WHISH" {
    try {
      const value = this.repo.getSettingValue("shop_base_system");
      return value === "WHISH" ? "WHISH" : "OMT";
    } catch {
      return "OMT";
    }
  }

  /**
   * Get the partner system (opposite of base)
   */
  getPartnerSystem(): "OMT" | "WHISH" {
    return this.getShopBaseSystem() === "OMT" ? "WHISH" : "OMT";
  }

  /**
   * Update a setting (upsert)
   */
  updateSetting(key: string, value: string): SettingResult {
    if (SENSITIVE_SETTING_KEYS.has(key)) {
      settingsLogger.warn(
        { key },
        "SettingsService.updateSetting rejected write to a sensitive key",
      );
      return {
        success: false,
        error: `Setting '${key}' cannot be written through the generic settings pipe`,
      };
    }
    try {
      this.repo.upsertSetting(key, value);
      return { success: true };
    } catch (error) {
      settingsLogger.error(
        { error, key, value },
        "SettingsService.updateSetting error",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// Singleton instance
let settingsServiceInstance: SettingsService | null = null;

export function getSettingsService(): SettingsService {
  if (!settingsServiceInstance) {
    settingsServiceInstance = new SettingsService();
  }
  return settingsServiceInstance;
}

export function resetSettingsService(): void {
  settingsServiceInstance = null;
}
