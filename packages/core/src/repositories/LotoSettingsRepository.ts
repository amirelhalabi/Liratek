/**
 * Loto Settings Repository
 *
 * Handles all database operations for the loto_settings table.
 */

import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

export interface LotoSetting {
  key_name: string;
  value: string;
  description: string | null;
  updated_at: string;
}

export class LotoSettingsRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  getSettings(): Map<string, string> {
    const tenantId = getCurrentTenantId();
    const stmt = this.db.prepare(
      `SELECT * FROM loto_settings WHERE tenant_id = ?`,
    );
    const rows = stmt.all(tenantId) as LotoSetting[];
    const settings = new Map<string, string>();
    rows.forEach((row) => {
      settings.set(row.key_name, row.value);
    });
    return settings;
  }

  updateSetting(key: string, value: string): LotoSetting | null {
    const tenantId = getCurrentTenantId();
    // loto_settings' PRIMARY KEY is now (tenant_id, key_name) — the conflict
    // target for INSERT OR REPLACE MUST include tenant_id in both the column
    // list and the values, or every tenant's upsert collides on key_name alone
    // (or worse, silently stacks NULL-tenant rows that no tenant's scoped
    // read/write can ever see again).
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO loto_settings (tenant_id, key_name, value, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `);
    stmt.run(tenantId, key, value);

    const getStmt = this.db.prepare(
      `SELECT * FROM loto_settings WHERE tenant_id = ? AND key_name = ?`,
    );
    return getStmt.get(tenantId, key) as LotoSetting | null;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let instance: LotoSettingsRepository | null = null;

export function getLotoSettingsRepository(): LotoSettingsRepository {
  if (!instance) {
    instance = new LotoSettingsRepository(getDatabase());
  }
  return instance;
}

/** Reset the singleton (for testing) */
export function resetLotoSettingsRepository(): void {
  instance = null;
}

export default LotoSettingsRepository;
