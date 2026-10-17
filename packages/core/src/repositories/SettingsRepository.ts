import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import {
  DEFAULT_LANGUAGE,
  RECEIPT_LANGUAGE_SETTING_KEY,
  UI_DEFAULT_LANGUAGE_SETTING_KEY,
  type Language,
} from "../constants/languages.js";
import { isLanguage } from "../utils/effectiveLanguage.js";

export interface SettingEntity {
  id?: number;
  key_name: string;
  value: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Repository for system_settings table
 * Does not extend BaseRepository since it uses key_name as the primary identifier
 */
export class SettingsRepository {
  /** Explicit override for tests only; default resolves live (§ 11.2). */
  private readonly _db?: Database.Database;

  // Define explicit columns instead of SELECT *
  private readonly columns = "id, key_name, value, created_at, updated_at";

  constructor(db?: Database.Database) {
    this._db = db;
  }

  protected get db(): Database.Database {
    return this._db ?? getDatabase();
  }

  /**
   * Get all settings
   */
  getAllSettings(): SettingEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.columns} FROM system_settings WHERE tenant_id = ?`,
      )
      .all(getCurrentTenantId()) as SettingEntity[];
  }

  /**
   * Get a setting by key
   */
  getSetting(key: string): SettingEntity | undefined {
    return this.db
      .prepare(
        `SELECT ${this.columns} FROM system_settings WHERE key_name = ? AND tenant_id = ?`,
      )
      .get(key, getCurrentTenantId()) as SettingEntity | undefined;
  }

  /**
   * Get setting value by key
   */
  getSettingValue(key: string): string | undefined {
    const setting = this.db
      .prepare(
        "SELECT value FROM system_settings WHERE key_name = ? AND tenant_id = ?",
      )
      .get(key, getCurrentTenantId()) as { value: string } | undefined;
    return setting?.value;
  }

  /**
   * The shop's primary money-transfer system (`shop_base_system`), "OMT"
   * unless set to "WHISH" — the same default every reader uses. LIRA-304:
   * the one place new code reads it; four older inline copies remain
   * (FinancialServiceRepository, TransactionRepository, SalesRepository,
   * SessionPaymentRepository) and are known duplicates, not a pattern.
   */
  getShopBaseSystem(): "OMT" | "WHISH" {
    try {
      return this.getSettingValue("shop_base_system") === "WHISH"
        ? "WHISH"
        : "OMT";
    } catch {
      return "OMT";
    }
  }

  /**
   * LIRA-331: the shop's default UI language. No seed row: missing (or an
   * unknown value) reads as English (FR-005).
   */
  getUiDefaultLanguage(): Language {
    const value = this.getSettingValue(UI_DEFAULT_LANGUAGE_SETTING_KEY);
    return isLanguage(value) ? value : DEFAULT_LANGUAGE;
  }

  /**
   * LIRA-331: the language receipts print in, whatever the cashier's own
   * language (FR-021). Missing reads as English (FR-023).
   */
  getReceiptLanguage(): Language {
    const value = this.getSettingValue(RECEIPT_LANGUAGE_SETTING_KEY);
    return isLanguage(value) ? value : DEFAULT_LANGUAGE;
  }

  /**
   * Upsert a setting (insert or update)
   */
  upsertSetting(key: string, value: string): void {
    const tenantId = getCurrentTenantId();
    const stmt = this.db.prepare(`
      INSERT INTO system_settings (tenant_id, key_name, value)
      VALUES (?, ?, ?)
      ON CONFLICT(tenant_id, key_name)
      DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(tenantId, key, value, value);
  }
}

// Singleton instance
let settingsRepositoryInstance: SettingsRepository | null = null;

export function getSettingsRepository(): SettingsRepository {
  if (!settingsRepositoryInstance) {
    settingsRepositoryInstance = new SettingsRepository();
  }
  return settingsRepositoryInstance;
}

export function resetSettingsRepository(): void {
  settingsRepositoryInstance = null;
}
