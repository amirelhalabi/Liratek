import {
  SettingsRepository,
  SettingEntity,
  getSettingsRepository,
} from "../repositories/SettingsRepository.js";
import { settingsLogger } from "../utils/logger.js";

export interface SettingResult {
  success: boolean;
  error?: string;
}

export class SettingsService {
  private repo: SettingsRepository;

  constructor(repo?: SettingsRepository) {
    this.repo = repo ?? getSettingsRepository();
  }

  /**
   * Get all settings
   */
  getAllSettings(): SettingEntity[] {
    try {
      return this.repo.getAllSettings();
    } catch (error) {
      settingsLogger.error({ error }, "SettingsService.getAllSettings error");
      return [];
    }
  }

  /**
   * Get a setting by key
   */
  getSetting(key: string): SettingEntity | undefined {
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
   * Update a setting (upsert)
   */
  updateSetting(key: string, value: string): SettingResult {
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
