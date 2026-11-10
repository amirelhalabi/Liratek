/**
 * Web "Download backup" (Settings › Backup) — the data access behind
 * `ShopBackupService` (rule 13): the shop's slug for the file name, and the
 * single-shop copy itself, made by the SAME builder as the offline copy
 * (`db/tenantSnapshot.ts`, rule 14) so a backup can never hold another
 * shop's rows in shared mode, nor sign-in material in either mode.
 *
 * The connection resolves live (`getDatabase()` at call time): inside
 * `runWithTenant` on the per-tenant server that is the shop's own file.
 * Server-only (`fs`, `better-sqlite3`): exported from `index.ts` only, never
 * `browser.ts` (rule 29).
 */
import Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { buildTenantBackupFile, type TenantBackupFile } from "../db/tenantSnapshot.js";

export interface ShopBackupRepositoryOptions {
  /** Injectable for backend jest, which maps `better-sqlite3` to a mock. */
  DatabaseCtor?: typeof Database;
}

export class ShopBackupRepository {
  private readonly _db?: Database.Database;
  private readonly DatabaseCtor?: typeof Database;

  /** `db` is an explicit override for tests only; default resolves live. */
  constructor(db?: Database.Database, opts: ShopBackupRepositoryOptions = {}) {
    this._db = db;
    this.DatabaseCtor = opts.DatabaseCtor;
  }

  private get db(): Database.Database {
    return this._db ?? getDatabase();
  }

  /** The shop's slug, or null when the shop row is missing. */
  getShopSlug(tenantId: number): string | null {
    const row = this.db.prepare(`SELECT slug FROM tenants WHERE id = ?`).get(tenantId) as
      | { slug: string | null }
      | undefined;
    return row?.slug ?? null;
  }

  /** Writes the shop's own copy to `destPath` (which must not exist). */
  writeShopCopy(tenantId: number, destPath: string): TenantBackupFile {
    return buildTenantBackupFile({
      tenantId,
      destPath,
      sourceDb: this.db,
      ...(this.DatabaseCtor ? { DatabaseCtor: this.DatabaseCtor } : {}),
    });
  }
}

let instance: ShopBackupRepository | null = null;

export function getShopBackupRepository(): ShopBackupRepository {
  if (!instance) instance = new ShopBackupRepository();
  return instance;
}

export function resetShopBackupRepository(): void {
  instance = null;
}
