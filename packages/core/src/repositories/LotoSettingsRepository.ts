/**
 * Loto Settings Repository
 *
 * Handles all database operations for the loto_settings table.
 */

import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";

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
    const stmt = this.db.prepare(`SELECT * FROM loto_settings`);
    const rows = stmt.all() as LotoSetting[];
    const settings = new Map<string, string>();
    rows.forEach((row) => {
      settings.set(row.key_name, row.value);
    });
    return settings;
  }

  updateSetting(key: string, value: string): LotoSetting | null {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO loto_settings (key_name, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `);
    stmt.run(key, value);

    const getStmt = this.db.prepare(
      `SELECT * FROM loto_settings WHERE key_name = ?`,
    );
    return getStmt.get(key) as LotoSetting | null;
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
