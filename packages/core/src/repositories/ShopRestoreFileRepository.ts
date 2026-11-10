/**
 * LIRA-377 (web shop restore) — the file-level facts `ShopRestoreService`
 * decides on (rule 13: SQL here, every refusal decision in the service).
 *
 * Every method opens ONE file BY PATH (an uploaded backup, a before-restore
 * copy, or a Litestream copy staged under the restore work directory) — never
 * through the tenant pool, never the live shop file. Reads are `readonly`.
 *
 *   - `hasSqliteHeader`   the 16-byte magic, so a random upload is refused
 *                         before SQLite ever parses it;
 *   - `inspect`           integrity check, whether the shop tables exist, the
 *                         `tenants` rows, the newest applied migration;
 *   - `ownShopProblem`    the backup builder's own "only this shop" verifier
 *                         (`verifyOnlyOwnShop`, rule 14 — no second copy);
 *   - `lastWriteAt`       the newest timestamp written anywhere in the file
 *                         (see the method for why it may over-estimate but
 *                         never under-estimate);
 *   - `schemaObjects` /   the `sqlite_master` objects of a file, and of a
 *     `buildReferenceSchema` fresh `create_db.sql` + migrations build.
 *
 * Every statement runs against one shop's own file, hence the scoping
 * checker's `tenant-exempt` markers. Server-only (`fs`, `better-sqlite3`):
 * exported from `index.ts` only, never `browser.ts` (rule 29).
 */
import fs from "node:fs";
import Database from "better-sqlite3";
import { isLitestreamTable, quoteIdent } from "../db/tenantSplit.js";
import { verifyOnlyOwnShop } from "../db/tenantSnapshot.js";
import { runMigrations } from "../db/migrations/index.js";

const SQLITE_MAGIC = "SQLite format 3\u0000";

export interface ShopFileTenantRow {
  id: number;
  name: string;
}

export interface ShopFileFacts {
  /** False when SQLite refused to open or read the file at all. */
  openable: boolean;
  /** `PRAGMA integrity_check` first line ("ok" when sound); null when not openable. */
  integrity: string | null;
  /** Both `tenants` and `schema_migrations` exist. */
  hasShopTables: boolean;
  tenants: ShopFileTenantRow[];
  /** MAX(schema_migrations.version), 0 when none. */
  maxMigration: number;
}

export interface SchemaObject {
  type: string;
  name: string;
}

export interface ShopRestoreFileRepositoryOptions {
  /** Injectable for backend jest, which maps `better-sqlite3` to a mock. */
  DatabaseCtor?: typeof Database;
}

/** Objects SQLite or Litestream create on their own — never a sign of tampering. */
function isEngineObject(o: SchemaObject): boolean {
  return o.name.startsWith("sqlite_") || (o.type === "table" && isLitestreamTable(o.name));
}

/** SQLite `YYYY-MM-DD HH:MM:SS[.fff]` and ISO `…T…[.fff]Z` both normalised to
 * `YYYY-MM-DD HH:MM:SS` (UTC), so the two formats compare correctly as text. */
const NORMALISED_TS_SQL = (col: string): string =>
  `substr(replace(replace(${col}, 'T', ' '), 'Z', ''), 1, 19)`;

/** Only values that look like a date-time take part (a free-text column
 * named `*_at` holding garbage must not win the MAX). */
const LOOKS_LIKE_TS_SQL = (col: string): string =>
  `${col} GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9][ T][0-2][0-9]:[0-5][0-9]:[0-5][0-9]*'`;

/** Columns that hold WHEN a row was written. Deliberately not "every
 * `*_at`": `expires_at`, `give_up_at`, `next_attempt_at` hold future
 * instants and would make every live file look written "later". */
const WRITE_TIME_COLUMNS: ReadonlySet<string> = new Set([
  "created_at",
  "updated_at",
  "last_activity_at",
  "last_seen_at",
]);

export class ShopRestoreFileRepository {
  private readonly DatabaseCtor: typeof Database;

  constructor(opts: ShopRestoreFileRepositoryOptions = {}) {
    this.DatabaseCtor = opts.DatabaseCtor ?? Database;
  }

  private openReadonly(filePath: string): Database.Database {
    return new this.DatabaseCtor(filePath, { readonly: true, fileMustExist: true });
  }

  hasSqliteHeader(filePath: string): boolean {
    let fd: number | null = null;
    try {
      fd = fs.openSync(filePath, "r");
      const buf = Buffer.alloc(16);
      const n = fs.readSync(fd, buf, 0, 16, 0);
      return n === 16 && buf.toString("latin1") === SQLITE_MAGIC;
    } catch {
      return false;
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }
  }

  inspect(filePath: string): ShopFileFacts {
    const facts: ShopFileFacts = { openable: false, integrity: null, hasShopTables: false, tenants: [], maxMigration: 0 };
    let db: Database.Database | null = null;
    try {
      db = this.openReadonly(filePath);
      // Reading the schema is the first real parse of the file.
      const tables = new Set(
        (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((r) => r.name),
      );
      facts.openable = true;
      try {
        const rows = db.pragma("integrity_check") as { integrity_check: string }[];
        facts.integrity = rows[0]?.integrity_check ?? "no result";
      } catch (error) {
        facts.integrity = error instanceof Error ? error.message : String(error);
        return facts;
      }
      if (facts.integrity !== "ok") return facts;
      facts.hasShopTables = tables.has("tenants") && tables.has("schema_migrations");
      if (!facts.hasShopTables) return facts;
      facts.tenants = db
        .prepare(`SELECT id, name FROM tenants ORDER BY id` /* tenant-exempt: the shop's own file */)
        .all() as ShopFileTenantRow[];
      facts.maxMigration =
        (db.prepare(`SELECT MAX(version) AS v FROM schema_migrations`).get() as { v: number | null }).v ?? 0;
      return facts;
    } catch (error) {
      // "file is not a database", "database disk image is malformed", …:
      // when the schema itself cannot be read the file is not usable.
      if (facts.openable && facts.integrity === null) {
        facts.integrity = error instanceof Error ? error.message : String(error);
      }
      return facts;
    } finally {
      db?.close();
    }
  }

  /** The "only this shop's rows" verdict: null when clean, else the problems. */
  ownShopProblem(filePath: string, tenantId: number): string | null {
    const db = this.openReadonly(filePath);
    try {
      verifyOnlyOwnShop(db, tenantId);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    } finally {
      db.close();
    }
  }

  /**
   * The newest `*_at` timestamp in the whole file, as ISO `…Z`, or null.
   *
   * Every write-time column (`WRITE_TIME_COLUMNS`) in every table counts,
   * so any write that inserted or stamped a row moves it. It can over-estimate (a row stamped with a
   * future time) but, for the server-stamped `created_at`/`updated_at` that
   * nearly every write carries, it does not under-estimate — which is the
   * direction the restore's clamp check needs (a too-high value only makes
   * it refuse more often).
   */
  lastWriteAt(filePath: string): string | null {
    const db = this.openReadonly(filePath);
    try {
      const tables = (
        db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as {
          name: string;
        }[]
      ).map((r) => r.name);
      let best: string | null = null;
      for (const table of tables) {
        const cols = (db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as { name: string }[])
          .map((c) => c.name)
          .filter((c) => WRITE_TIME_COLUMNS.has(c));
        for (const col of cols) {
          const q = quoteIdent(col);
          const row = db
            .prepare(
              `SELECT MAX(${NORMALISED_TS_SQL(q)}) AS m FROM ${quoteIdent(table)} WHERE typeof(${q}) = 'text' AND ${LOOKS_LIKE_TS_SQL(q)}` /* tenant-exempt: the shop's own file */,
            )
            .get() as { m: string | null };
          if (row.m && (best === null || row.m > best)) best = row.m;
        }
      }
      return best ? `${best.replace(" ", "T")}Z` : null;
    } finally {
      db.close();
    }
  }

  /** Every user-visible `sqlite_master` object (engine/Litestream ones left out). */
  schemaObjects(filePath: string): SchemaObject[] {
    const db = this.openReadonly(filePath);
    try {
      return this.objectsOf(db);
    } finally {
      db.close();
    }
  }

  /** The objects of a FRESH shop build: `create_db.sql` then the migrations,
   * in memory — the same two steps every new shop file gets. */
  buildReferenceSchema(createDbSql: string): SchemaObject[] {
    const db = new this.DatabaseCtor(":memory:");
    try {
      db.exec(createDbSql);
      runMigrations(db);
      return this.objectsOf(db);
    } finally {
      db.close();
    }
  }

  private objectsOf(db: Database.Database): SchemaObject[] {
    return (db.prepare(`SELECT type, name FROM sqlite_master ORDER BY type, name`).all() as SchemaObject[]).filter(
      (o) => !isEngineObject(o),
    );
  }
}

let instance: ShopRestoreFileRepository | null = null;

export function getShopRestoreFileRepository(): ShopRestoreFileRepository {
  if (!instance) instance = new ShopRestoreFileRepository();
  return instance;
}

export function resetShopRestoreFileRepository(): void {
  instance = null;
}
