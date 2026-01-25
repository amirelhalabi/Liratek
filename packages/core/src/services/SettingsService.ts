import {
  SettingsRepository,
  SettingEntity,
  getSettingsRepository,
} from "../repositories/SettingsRepository.js";

export interface SettingResult {
  success: boolean;
  error?: string;
}

export class SettingsService {
  private repo: SettingsRepository;

  constructor() {
    this.repo = getSettingsRepository();
  }

  /**
   * Get all settings
   */
  getAllSettings(): SettingEntity[] {
    try {
      return this.repo.getAllSettings();
    } catch (error) {
      console.error("SettingsService.getAllSettings error:", error);
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
      console.error("SettingsService.getSetting error:", error);
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
      console.error("SettingsService.getSettingValue error:", error);
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
      console.error("SettingsService.updateSetting error:", error);
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
