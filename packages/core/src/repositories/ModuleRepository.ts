/**
 * Module Repository
 *
 * Handles all operations for the `modules` table, which controls sidebar
 * navigation and feature-level enable/disable toggles.
 */

import { getDatabase } from "../db/connection.js";
import type Database from "better-sqlite3";

// =============================================================================
// Entity Types
// =============================================================================

export interface ModuleEntity {
  key: string;
  label: string;
  icon: string;
  route: string;
  sort_order: number;
  is_enabled: number; // 0 or 1
  admin_only: number; // 0 or 1
  is_system: number; // 0 or 1
}

// =============================================================================
// Module Repository Class
// =============================================================================

export class ModuleRepository {
  private db: Database.Database;

  constructor() {
    this.db = getDatabase();
  }

  /** Get all modules ordered by sort_order */
  getAll(): ModuleEntity[] {
    return this.db
      .prepare(`SELECT * FROM modules ORDER BY sort_order`)
      .all() as ModuleEntity[];
  }

  /** Get only enabled modules (for sidebar rendering) */
  getEnabledModules(): ModuleEntity[] {
    return this.db
      .prepare(`SELECT * FROM modules WHERE is_enabled = 1 ORDER BY sort_order`)
      .all() as ModuleEntity[];
  }

  /** Get toggleable modules (non-system) for the Settings > Modules UI */
  getToggleableModules(): ModuleEntity[] {
    return this.db
      .prepare(`SELECT * FROM modules WHERE is_system = 0 ORDER BY sort_order`)
      .all() as ModuleEntity[];
  }

  /** Get a single module by key */
  getByKey(key: string): ModuleEntity | undefined {
    return this.db.prepare(`SELECT * FROM modules WHERE key = ?`).get(key) as
      | ModuleEntity
      | undefined;
  }

  /** Enable or disable a module (only non-system modules) */
  setEnabled(key: string, enabled: boolean): void {
    this.db
      .prepare(
        `UPDATE modules SET is_enabled = ? WHERE key = ? AND is_system = 0`,
      )
      .run(enabled ? 1 : 0, key);
  }

  /** Bulk update enabled state */
  bulkSetEnabled(updates: { key: string; is_enabled: boolean }[]): void {
    this.db.transaction(() => {
      const stmt = this.db.prepare(
        `UPDATE modules SET is_enabled = ? WHERE key = ? AND is_system = 0`,
      );
      for (const u of updates) {
        stmt.run(u.is_enabled ? 1 : 0, u.key);
      }
    })();
  }

  /** Update sort order */
  updateSortOrder(key: string, sortOrder: number): void {
    this.db
      .prepare(`UPDATE modules SET sort_order = ? WHERE key = ?`)
      .run(sortOrder, key);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let moduleRepositoryInstance: ModuleRepository | null = null;

export function getModuleRepository(): ModuleRepository {
  if (!moduleRepositoryInstance) {
    moduleRepositoryInstance = new ModuleRepository();
  }
  return moduleRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetModuleRepository(): void {
  moduleRepositoryInstance = null;
}
