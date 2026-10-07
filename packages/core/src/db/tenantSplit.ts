/**
 * Phase D split tool (`docs/plans/ongoing_plans/
 * PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 12.2/§ 12.3, "Phase D
 * (owner-scheduled)"). Turns ONE shared `liratek.db` into `platform.db` +
 * `tenants/<id>.db` per row in `tenants`.
 *
 * This module NEVER touches the live database and NEVER reads or writes
 * `TENANT_DB_MODE`. It takes a path (the operator's job to make sure that
 * path is a COPY, never the live file — see the CLI wrapper and the runbook
 * in the plan doc § 12) and an empty output directory, and only ever writes
 * new files there. Uses `fs`/`path` — exported from `index.ts` only, never
 * from `browser.ts` (rule 29).
 *
 * ## Algorithm
 *
 * For each tenant id in the source `tenants` table:
 *  1. `VACUUM INTO` a full copy of the source at `<outputDir>/tenants/<id>.db`.
 *  2. `foreign_keys = OFF` (this connection only — a fresh file, so nothing
 *     else could observe it mid-edit anyway).
 *  3. For every tenant-scoped table EXCEPT `tenants` and
 *     `tenant_subscriptions` (discovered via `PRAGMA table_info`, the same
 *     technique `TenantRepository.tenantScopedTables()` uses privately —
 *     that method isn't exported, so this file re-implements the identical
 *     query rather than reaching into a private repository method; if it
 *     ever needs to change, both copies need to change together, rule 14):
 *     delete every row whose `tenant_id` != this id OR IS NULL.
 *  4. Delete every `tenants` row except this id (leaving exactly one local
 *     mirror row, § 12.2's design default).
 *  5. Delete every `tenant_subscriptions` row unconditionally — subscriptions
 *     live in the platform file only. Step 3 skips this table rather than
 *     narrowing it to "just this tenant's row" first, since step 5 deletes
 *     everything regardless; the two are equivalent in the end state, this
 *     is just fewer statements.
 *  6. `PRAGMA foreign_key_check` must return zero rows, `PRAGMA
 *     integrity_check` must say `ok`, then `VACUUM`.
 *
 * For the platform file:
 *  1. `VACUUM INTO` a full copy of the source at `<outputDir>/platform.db`.
 *  2. For every tenant-scoped table EXCEPT `tenant_subscriptions` (which
 *     stays untouched — every row, tenant-scoped or not, belongs in the
 *     platform file): delete every row with `tenant_id IS NOT NULL`. This
 *     keeps `tenants`, `tenant_subscriptions` untouched, and only the
 *     `tenant_id IS NULL` rows of `users`/`sessions`/`audit_log` (super-admin
 *     accounts, their sessions, platform audit rows) and any other globally
 *     scoped table.
 *  3. Same FK/integrity/VACUUM checks as a tenant file.
 *
 * ## Verification
 *
 * Every count is taken from the SOURCE connection, which this module never
 * mutates (only ever reads from it, plus `VACUUM INTO` — which does not
 * modify the source database). For every tenant-scoped table (except
 * `tenant_subscriptions`, checked separately) and every tenant id:
 * `count(source WHERE tenant_id = id) == count(that tenant's file)`. For the
 * platform file: `count(source WHERE tenant_id IS NULL) == count(platform)`.
 * `tenant_subscriptions` is checked as a whole-table retention:
 * `count(source) == count(platform)`, and `0` in every tenant file.
 *
 * Any table (other than `users`/`sessions`/`audit_log`) that holds so much as
 * one `tenant_id IS NULL` row in the SOURCE is reported as an "unexpected
 * global row" finding — never silently dropped or silently kept, always
 * named in the report so a human decides what it means.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { dbLogger } from "../utils/logger.js";

/** Tables whose `tenant_id IS NULL` rows are expected and NOT reported as a
 * finding — the platform's own control-plane rows (§ 12.2). */
const EXPECTED_GLOBAL_TABLES = new Set(["users", "sessions", "audit_log"]);

/** Handled with dedicated rules above, never through the generic per-tenant
 * delete loop. */
const SPECIAL_CASED_TABLES = new Set(["tenants", "tenant_subscriptions"]);

/**
 * Prefix of Litestream's own replication-bookkeeping tables, created inside
 * EVERY database Litestream replicates (verified against Litestream's own
 * source, `db.go`, 2026-09-28): `_litestream_seq (id INTEGER PRIMARY KEY, seq
 * INTEGER)` — "to force writes to the WAL when empty" — and `_litestream_lock
 * (id INTEGER)` — "to force write locks during sync". Neither carries a
 * `tenant_id` and neither is shop data; a real production snapshot's dry run
 * came back `ok: false` over exactly these two tables before this exclusion
 * existed. Matched by PREFIX (not an exact-name set like
 * `KNOWN_TABLES_WITHOUT_TENANT_ID` above) since a future Litestream version
 * could add more `_litestream_*` tables and this must not need a new release
 * to keep recognizing them. These tables are never copied into an output
 * file: Litestream recreates them itself the moment it starts replicating
 * that file, so `buildTenantFile`/`buildPlatformFile` DROP them after the
 * `VACUUM INTO` copy (rule 14: one constant, checked at every site that cares
 * about these tables).
 */
const LITESTREAM_TABLE_PREFIX = "_litestream_";

function isLitestreamTable(name: string): boolean {
  return name.startsWith(LITESTREAM_TABLE_PREFIX);
}

/**
 * The only tables allowed to have NO `tenant_id` column at all. Every one of
 * these is intentionally global (the tenant registry itself, or process-
 * level plumbing that never carries shop data). Any OTHER table discovered
 * without a `tenant_id` column is a hard-fail finding (ticket item 3a): today
 * such a table is invisible to `discoverTenantScopedTables()`, so it is never
 * narrowed by the per-tenant DELETE loop and `VACUUM INTO` carries every one
 * of its rows, unfiltered, into EVERY tenant's file — a real cross-shop leak.
 */
/**
 * Platform-only tables with NO `tenant_id` (LIRA-267, migration v195): the
 * transactional email outbox and the single-use sign-up invitations. They
 * belong to the platform, not to any shop — `signup_invitations.
 * used_by_tenant_id` records which shop an invite CREATED, it does not
 * scope the row. Kept whole in `platform.db` and DELETED from every
 * `tenants/<id>.db` (exactly like `tenant_subscriptions`), because `VACUUM
 * INTO` would otherwise copy every invitee's email address into every shop's
 * file. Both are optional in the source: a pre-v195 snapshot has neither.
 *
 * `sso_handoff_tokens` (v196, LIRA-280) joins them: the www -> shop sign-in
 * hand-off is minted and consumed under `runWithoutTenant`, so it lives in
 * the platform file. It names its shop with `target_tenant_id`, deliberately
 * NOT `tenant_id`, so `discoverTenantScopedTables()` and the platform-split
 * guard never count its rows as shop data. (The v196 TENANT-scoped tables —
 * user_invitations, password_reset_tokens, email_verification_tokens,
 * user_identities — carry `tenant_id` and are split like any other.)
 */
const PLATFORM_ONLY_TABLES: readonly string[] = [
  "signup_invitations",
  "email_outbox",
  "sso_handoff_tokens",
  // v199 (LIRA-287): www "email me a code" sign-in codes. A code belongs to
  // an email, not a shop, so it has no tenant_id and stays platform-level.
  "signin_codes",
];

const KNOWN_TABLES_WITHOUT_TENANT_ID = new Set([
  "tenants",
  "sync_queue",
  "sync_errors",
  "schema_migrations",
  ...PLATFORM_ONLY_TABLES,
]);

function tableExistsIn(db: Database.Database, table: string): boolean {
  return (
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(table) !== undefined
  );
}

export interface TenantSplitOptions {
  /** Path to the SOURCE database — MUST be a copy, never the live file. This
   * module only ever opens it for reads and `VACUUM INTO`, never a mutating
   * statement, but it does not verify the caller's claim; that is the CLI's
   * and the runbook's job. */
  sourceDbPath: string;
  /** Directory the split writes into. Refused unless empty/missing. */
  outputDir: string;
  /** Dry-run by default (report only, nothing written). Pass `true` to
   * actually produce `platform.db` and `tenants/<id>.db`. */
  write?: boolean;
}

export interface TableCountFinding {
  table: string;
  scope: string; // e.g. "tenant 5", "platform (tenant_id IS NULL)"
  expected: number;
  actual: number;
}

export interface TenantSplitReport {
  dryRun: boolean;
  tenantIds: number[];
  tenantScopedTables: string[];
  platformFile: string;
  tenantFiles: Record<number, string>;
  /** Count checks that PASSED — kept for a complete report, not just failures. */
  verifiedCounts: TableCountFinding[];
  /** Count checks that did NOT match. Non-empty ⇒ `ok: false`. */
  mismatches: TableCountFinding[];
  /** Tables (other than users/sessions/audit_log) holding `tenant_id IS
   * NULL` rows in the source — reported, never silently resolved either way. */
  unexpectedGlobalRows: { table: string; nullRowCount: number }[];
  /** Tables with no `tenant_id` column that are not on the known-global
   * allowlist (item 3a). Non-empty ⇒ `ok: false` and NOTHING is written —
   * such a table would otherwise be copied, unfiltered, into every tenant
   * file. */
  unexpectedTablesWithoutTenantId: string[];
  /** Table names `isSimpleIdentifier()` refuses (item 3b). Same
   * consequence as `unexpectedTablesWithoutTenantId`: non-empty ⇒
   * `ok: false`, nothing written. */
  unsafeTableNames: string[];
  /** Litestream's own replication-bookkeeping tables (`_litestream_seq`,
   * `_litestream_lock`, …) found in the source and DROPPED from every output
   * file after the `VACUUM INTO` copy — see `LITESTREAM_TABLE_PREFIX`. Empty
   * when the source was never replicated by Litestream. Reported so an
   * operator reviewing the split sees this happened rather than wondering
   * whether it was missed. */
  droppedReplicationTables: string[];
  /** `audit_log` rows written before 2026-09-27 (B-D3) whose
   * `impersonator_id` pointed at a PLATFORM user's id — rewritten to the
   * current shape (`impersonator_id NULL`, identity folded into `metadata`
   * under the same keys the current code uses) rather than left to fail
   * the split. See `LEGACY_IMPERSONATOR_TABLE` for the full story. Empty
   * when the source has no such row (the common case going forward — new
   * code never writes this shape). */
  rewrittenLegacyImpersonatorRows: RewrittenLegacyImpersonatorRow[];
  /** Per-file `PRAGMA foreign_key_check` / `integrity_check` results. */
  fileChecks: {
    file: string;
    /** Exact total — never truncated, unlike `foreignKeyViolationRows` below. */
    foreignKeyViolations: number;
    /** The first `MAX_REPORTED_FK_VIOLATION_ROWS` rows `PRAGMA
     * foreign_key_check` returned, so a human reviewing the report can see
     * WHICH row references WHAT without opening the file by hand. Capped
     * (not the full list) so one badly corrupted file can't blow up the
     * JSON; `foreignKeyViolations` above is always the exact count
     * regardless of how many rows are listed here. */
    foreignKeyViolationRows: ForeignKeyViolationRow[];
    integrityCheck: string;
  }[];
  ok: boolean;
}

/** One row of `PRAGMA foreign_key_check` output — a dangling reference in
 * `table` pointing at a missing row in `parent`, via the `fkid`-th FOREIGN
 * KEY constraint declared on `table` (`PRAGMA foreign_key_list(table)`'s own
 * `id` column indexes the same way). `rowid` is `null` when SQLite can't
 * report one (e.g. a `WITHOUT ROWID` table). */
export interface ForeignKeyViolationRow {
  table: string;
  rowid: number | null;
  parent: string;
  fkid: number;
}

/**
 * Legacy pre-B-D3 impersonation-audit shape (production finding, real dry
 * run 2026-09-28: shop 5's `audit_log` row 158, `IMPERSONATION_START`,
 * `tenant_id 5`, `impersonator_id = 4` — user 4 is a `super_admin` with
 * `tenant_id NULL`, a PLATFORM-only user). Before 2026-09-27, the
 * impersonation-start shop-note row put the platform user's id directly in
 * this tenant-scoped FK column (`audit_log.impersonator_id REFERENCES
 * users(id)`). Current code (`backend/src/api/admin.ts`,
 * `AuditService.ts`) never does this — it always writes `impersonator_id:
 * null` and folds the impersonator's identity into `metadata` instead.
 * Once split per-tenant, a legacy row's `impersonator_id` points at a user
 * that exists only in `platform.db`, never in the shop file, so it dangles.
 * Fixed, named constants (rule 14) — never discovered — because this
 * encodes one exact, dated shape, not a generic rule. */
const LEGACY_IMPERSONATOR_TABLE = "audit_log";
const LEGACY_IMPERSONATOR_COLUMN = "impersonator_id";

/** The SAME metadata keys the current B-D3 impersonation-start write uses
 * (`backend/src/api/admin.ts`, the shop-note `audit_log` row) — a rewritten
 * legacy row must be indistinguishable from one the current code wrote
 * directly, never a second, drifting definition of the same contract
 * (rule 14). */
const LEGACY_IMPERSONATOR_METADATA_KEYS = {
  impersonatedBy: "impersonatedBy",
  impersonatorUserId: "impersonatorUserId",
} as const;

/** One `audit_log` row rewritten from the legacy impersonator_id shape to
 * the current one, reported so a human reviewing a real split sees exactly
 * what changed instead of it happening silently. */
export interface RewrittenLegacyImpersonatorRow {
  file: string;
  table: string;
  rowid: number;
  impersonatorUserId: number;
}

/** Cap on how many violating rows a single file's `fileChecks` entry lists
 * verbatim (item 1 of the Phase D rehearsal follow-ups). A cross-tenant leak
 * that slipped through discovery could in principle produce thousands of
 * dangling references; the report must stay reviewable JSON, not become the
 * next thing that blows up. The exact total is always in
 * `foreignKeyViolations`, uncapped. */
const MAX_REPORTED_FK_VIOLATION_ROWS = 50;

// Exported (not just used internally) so `platformSplitGuard.ts` can quote
// the SAME table names this module discovers via `discoverTenantScopedTables`
// without re-implementing the identifier check a second time (rule 14).
export function isSimpleIdentifier(name: string): boolean {
  // Table names here always come from `sqlite_master`, never from a caller,
  // but this is the same defensive check `TenantRepository` relies on
  // implicitly by only ever consuming `sqlite_master` output — made explicit
  // here since this module builds its OWN discovery query (rule 2: even a
  // "trusted" name gets validated before being spliced into SQL text).
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

export function quoteIdent(name: string): string {
  if (!isSimpleIdentifier(name)) {
    throw new Error(`Refusing to use unexpected table name in SQL: ${name}`);
  }
  return `"${name}"`;
}

function tableColumnNames(db: Database.Database, table: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as {
      name: string;
    }[]
  ).map((c) => c.name);
}

/**
 * Every table that carries a `tenant_id` column, discovered from the schema
 * — deliberately not hand-maintained (rule 14; same reasoning as
 * `TenantRepository.tenantScopedTables()`, which this re-implements because
 * that method is private and this module must not reach into a repository's
 * internals). Excludes `tenants` itself (registry, no `tenant_id` column).
 *
 * Silently drops any table whose name fails `isSimpleIdentifier()` — that is
 * fine for THIS function's own contract (nothing here mutates or requires an
 * exhaustive list), but callers must not treat "not in this list" as "safe to
 * leave alone": `discoverUnsafeAndUnscopedTables()` below is what actually
 * gates the split on such a table existing at all (item 3b).
 */
export function discoverTenantScopedTables(db: Database.Database): string[] {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name != 'tenants'`,
    )
    .all() as { name: string }[];

  return tables
    .filter((t) => isSimpleIdentifier(t.name))
    .filter((t) => tableColumnNames(db, t.name).includes("tenant_id"))
    .map((t) => t.name);
}

/**
 * The hard-fail scan (ticket items 3a/3b). Walks EVERY table in the schema
 * (not just the ones `discoverTenantScopedTables()` recognizes) and reports
 * two disjoint classes of table that must never be silently carried,
 * unfiltered, into every tenant file:
 *
 *  - `unexpectedTablesWithoutTenantId`: no `tenant_id` column, and not on the
 *    known-global allowlist. Could be a genuine bug (a table someone forgot
 *    to scope) or a legitimate new global table nobody added to the
 *    allowlist yet — either way, a human decides, the tool never guesses.
 *  - `unsafeTableNames`: a name `isSimpleIdentifier()` refuses. These are
 *    deliberately NOT inspected further (no `PRAGMA table_info` attempt) —
 *    even though `quoteIdent()`'s `"..."` quoting could technically read one
 *    safely, refusing outright is the point: an unexpected identifier gets a
 *    human's attention, not a best-effort guess.
 */
function discoverUnsafeAndUnscopedTables(db: Database.Database): {
  unsafeTableNames: string[];
  unexpectedTablesWithoutTenantId: string[];
} {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    )
    .all() as { name: string }[];

  const unsafeTableNames: string[] = [];
  const unexpectedTablesWithoutTenantId: string[] = [];

  for (const t of tables) {
    if (isLitestreamTable(t.name)) continue; // replication bookkeeping — dropped separately, never a finding
    if (!isSimpleIdentifier(t.name)) {
      unsafeTableNames.push(t.name);
      continue;
    }
    if (KNOWN_TABLES_WITHOUT_TENANT_ID.has(t.name)) continue;
    if (!tableColumnNames(db, t.name).includes("tenant_id")) {
      unexpectedTablesWithoutTenantId.push(t.name);
    }
  }

  return { unsafeTableNames, unexpectedTablesWithoutTenantId };
}

/**
 * Every `_litestream_*` table present in `db` (source or a freshly
 * `VACUUM INTO`-ed output file share the same schema, so discovering this
 * once against the source is enough for every output file). Filtered through
 * `isSimpleIdentifier()` for the same reason every other identifier here is
 * — Litestream's own naming is trusted, but nothing gets spliced into a
 * `DROP TABLE` statement unchecked (rule 2).
 */
function discoverLitestreamTables(db: Database.Database): string[] {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    )
    .all() as { name: string }[];
  return tables.map((t) => t.name).filter(isLitestreamTable).filter(isSimpleIdentifier);
}

/** Drops every table in `tables` from `file`, if present. Used to remove
 * Litestream's replication bookkeeping from a freshly copied output file —
 * see `LITESTREAM_TABLE_PREFIX` above for why these are never carried into a
 * shop or platform file. */
function dropTables(file: Database.Database, tables: string[]): void {
  for (const table of tables) {
    file.exec(`DROP TABLE IF EXISTS ${quoteIdent(table)}`);
  }
}

/**
 * Merges the legacy impersonator's identity into a row's existing
 * `metadata` JSON, under the SAME keys the current B-D3 write uses
 * (`LEGACY_IMPERSONATOR_METADATA_KEYS`). Never loses existing keys: a
 * NULL/missing metadata starts from `{}`; metadata that isn't valid JSON,
 * or is valid JSON but not a plain object (e.g. an array), is preserved
 * verbatim under `legacyMetadata` rather than dropped — a split must never
 * silently discard data it doesn't recognize.
 */
function mergeLegacyImpersonatorMetadata(
  existingMetadataJson: string | null,
  impersonatorUsername: string,
  impersonatorUserId: number,
): string {
  let existing: Record<string, unknown> = {};
  if (existingMetadataJson) {
    try {
      const parsed: unknown = JSON.parse(existingMetadataJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      } else {
        existing = { legacyMetadata: existingMetadataJson };
      }
    } catch {
      existing = { legacyMetadata: existingMetadataJson };
    }
  }

  return JSON.stringify({
    ...existing,
    [LEGACY_IMPERSONATOR_METADATA_KEYS.impersonatedBy]: impersonatorUsername,
    [LEGACY_IMPERSONATOR_METADATA_KEYS.impersonatorUserId]: impersonatorUserId,
  });
}

/**
 * Rewrites legacy pre-B-D3 impersonation rows in ONE freshly narrowed
 * tenant file (`file`) — must run AFTER the per-table tenant-narrowing
 * DELETEs (so only this tenant's own audit rows remain) and BEFORE the
 * FK check. `sourceDb` is read-only here (never mutated) purely to resolve
 * whether a referenced `impersonator_id` is a genuine platform user
 * (`tenant_id IS NULL`) — the file's own `users` table has already been
 * narrowed to this tenant, so it can no longer answer that question about
 * a platform user by itself.
 *
 * Only rewrites a row when `impersonator_id` resolves, in the SOURCE, to a
 * user with `tenant_id IS NULL` — the exact, and only, shape the old code
 * ever wrote. Any other non-NULL `impersonator_id` (pointing at a real
 * tenant user, or at nothing at all) is left untouched and falls through to
 * the ordinary FK check, which must still fail the split — that is a real
 * data problem, not this legacy shape, and rewriting it away would hide a
 * genuine corruption.
 */
function rewriteLegacyImpersonatorRows(
  file: Database.Database,
  sourceDb: Database.Database,
  destPath: string,
): RewrittenLegacyImpersonatorRow[] {
  if (
    !tableColumnNames(file, LEGACY_IMPERSONATOR_TABLE).includes(
      LEGACY_IMPERSONATOR_COLUMN,
    )
  ) {
    return []; // schema without this column at all — nothing to rewrite
  }

  const rows = file
    .prepare(
      `SELECT id, ${quoteIdent(LEGACY_IMPERSONATOR_COLUMN)} AS impersonator_id, metadata
         FROM ${quoteIdent(LEGACY_IMPERSONATOR_TABLE)}
        WHERE ${quoteIdent(LEGACY_IMPERSONATOR_COLUMN)} IS NOT NULL`,
    )
    .all() as { id: number; impersonator_id: number; metadata: string | null }[];

  const rewritten: RewrittenLegacyImpersonatorRow[] = [];

  for (const row of rows) {
    const platformUser = sourceDb
      .prepare(`SELECT username FROM users WHERE id = ? AND tenant_id IS NULL`)
      .get(row.impersonator_id) as { username: string } | undefined;

    if (!platformUser) continue; // not the legacy platform-user shape — leave for the FK check

    const mergedMetadata = mergeLegacyImpersonatorMetadata(
      row.metadata,
      platformUser.username,
      row.impersonator_id,
    );

    file
      .prepare(
        `UPDATE ${quoteIdent(LEGACY_IMPERSONATOR_TABLE)}
            SET ${quoteIdent(LEGACY_IMPERSONATOR_COLUMN)} = NULL, metadata = ?
          WHERE id = ?`,
      )
      .run(mergedMetadata, row.id);

    rewritten.push({
      file: destPath,
      table: LEGACY_IMPERSONATOR_TABLE,
      rowid: row.id,
      impersonatorUserId: row.impersonator_id,
    });
  }

  return rewritten;
}

function countWhere(
  db: Database.Database,
  table: string,
  where: string,
  params: unknown[] = [],
): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(table)} WHERE ${where}`)
    .get(...params) as { c: number };
  return row.c;
}

function countAll(db: Database.Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(table)}`).get() as {
    c: number;
  };
  return row.c;
}

/** `VACUUM INTO` a full snapshot of `db` at `destPath`. Parameterized (rule
 * 2) — modern SQLite (this project's better-sqlite3 build) accepts a bound
 * parameter as the `VACUUM INTO` target. */
function vacuumInto(db: Database.Database, destPath: string): void {
  db.prepare("VACUUM INTO ?").run(destPath);
}

function checkFileIntegrity(filePath: string): {
  file: string;
  foreignKeyViolations: number;
  foreignKeyViolationRows: ForeignKeyViolationRow[];
  integrityCheck: string;
} {
  const db = new Database(filePath);
  try {
    const violations = db.pragma("foreign_key_check") as ForeignKeyViolationRow[];
    const integrityRows = db.pragma("integrity_check") as { integrity_check: string }[];
    const integrityCheck = integrityRows[0]?.integrity_check ?? "unknown";
    return {
      file: filePath,
      foreignKeyViolations: violations.length,
      foreignKeyViolationRows: violations.slice(0, MAX_REPORTED_FK_VIOLATION_ROWS),
      integrityCheck,
    };
  } finally {
    db.close();
  }
}

function vacuumFile(filePath: string): void {
  const db = new Database(filePath);
  try {
    db.exec("VACUUM");
  } finally {
    db.close();
  }
}

/**
 * Builds a shop database file at `destPath` from a `VACUUM INTO` snapshot of
 * `sourceDb`, narrowed to tenant `tenantId` per the algorithm above.
 */
function buildTenantFile(
  sourceDb: Database.Database,
  tenantScopedTables: string[],
  litestreamTables: string[],
  tenantId: number,
  destPath: string,
): RewrittenLegacyImpersonatorRow[] {
  vacuumInto(sourceDb, destPath);

  const file = new Database(destPath);
  let rewrittenLegacyImpersonatorRows: RewrittenLegacyImpersonatorRow[] = [];
  try {
    file.pragma("foreign_keys = OFF");
    file.transaction(() => {
      for (const table of tenantScopedTables) {
        if (SPECIAL_CASED_TABLES.has(table)) continue;
        file
          .prepare(
            `DELETE FROM ${quoteIdent(table)} WHERE tenant_id IS NULL OR tenant_id != ?`,
          )
          .run(tenantId);
      }
      file.prepare(`DELETE FROM tenants WHERE id != ?`).run(tenantId);
      file.exec(`DELETE FROM tenant_subscriptions`);
      for (const table of PLATFORM_ONLY_TABLES) {
        if (tableExistsIn(file, table)) {
          file.exec(`DELETE FROM ${quoteIdent(table)}`);
        }
      }
      // Rewrite legacy impersonator rows AFTER narrowing (only this
      // tenant's own audit rows remain) and BEFORE dropping the Litestream
      // tables / this function's caller running the FK check.
      rewrittenLegacyImpersonatorRows = rewriteLegacyImpersonatorRows(
        file,
        sourceDb,
        destPath,
      );
      dropTables(file, litestreamTables);
    })();
  } finally {
    file.close();
  }
  vacuumFile(destPath);
  return rewrittenLegacyImpersonatorRows;
}

/** Builds the platform file: every tenant-scoped table (except
 * `tenant_subscriptions`) loses its `tenant_id IS NOT NULL` rows. */
function buildPlatformFile(
  sourceDb: Database.Database,
  tenantScopedTables: string[],
  litestreamTables: string[],
  destPath: string,
): void {
  vacuumInto(sourceDb, destPath);

  const file = new Database(destPath);
  try {
    file.pragma("foreign_keys = OFF");
    file.transaction(() => {
      for (const table of tenantScopedTables) {
        if (table === "tenant_subscriptions") continue;
        file.prepare(`DELETE FROM ${quoteIdent(table)} WHERE tenant_id IS NOT NULL`).run();
      }
      dropTables(file, litestreamTables);
    })();
  } finally {
    file.close();
  }
  vacuumFile(destPath);
}

/**
 * Runs the split. Dry-run (`write` false/omitted) computes and returns the
 * full verification report WITHOUT writing anything to `outputDir` — every
 * count check runs against a real in-memory/temp reconstruction is NOT done;
 * a dry run instead reports what WOULD be checked (tenant ids, tables,
 * expected counts) so an operator can review the plan before spending disk
 * and time on a real split. Only `write: true` actually produces files and
 * runs the full per-file FK/integrity verification.
 */
export function splitTenantDatabase(options: TenantSplitOptions): TenantSplitReport {
  const { sourceDbPath, outputDir, write = false } = options;

  if (!fs.existsSync(sourceDbPath)) {
    throw new Error(`Source database not found: ${sourceDbPath}`);
  }

  if (fs.existsSync(outputDir)) {
    const entries = fs.readdirSync(outputDir);
    if (entries.length > 0) {
      throw new Error(
        `Refusing to write into a non-empty output directory: ${outputDir} (contains ${entries.length} entr${entries.length === 1 ? "y" : "ies"})`,
      );
    }
  }

  // Always opened read-write: `VACUUM INTO` only ever READS the source and
  // writes a brand-new destination file, so nothing here can mutate
  // `sourceDbPath` regardless of this flag — but SQLite's `VACUUM` family of
  // statements is refused outright on a connection opened with the
  // `readonly` flag, which would break `VACUUM INTO` even though it never
  // touches this file. The caller's own contract ("a copy, never the live
  // file") is what actually protects the source, not this flag.
  const sourceDb = new Database(sourceDbPath);
  try {
    const tenantIds = (
      sourceDb.prepare(`SELECT id FROM tenants ORDER BY id`).all() as { id: number }[]
    ).map((r) => r.id);

    const tenantScopedTables = discoverTenantScopedTables(sourceDb);
    const { unsafeTableNames, unexpectedTablesWithoutTenantId } =
      discoverUnsafeAndUnscopedTables(sourceDb);
    const droppedReplicationTables = discoverLitestreamTables(sourceDb);

    // Unexpected-global-rows finding: computed regardless of dry-run, since
    // it needs only reads against the source.
    const unexpectedGlobalRows: { table: string; nullRowCount: number }[] = [];
    for (const table of tenantScopedTables) {
      if (EXPECTED_GLOBAL_TABLES.has(table) || table === "tenant_subscriptions") continue;
      const nullCount = countWhere(sourceDb, table, "tenant_id IS NULL");
      if (nullCount > 0) {
        unexpectedGlobalRows.push({ table, nullRowCount: nullCount });
      }
    }

    const platformFile = path.join(outputDir, "platform.db");
    const tenantFiles: Record<number, string> = {};
    for (const id of tenantIds) {
      tenantFiles[id] = path.join(outputDir, "tenants", `${id}.db`);
    }

    // Hard fail (items 3a/3b): either finding means a table would be copied
    // wholesale, unfiltered, into every output file if we proceeded. Checked
    // BEFORE the dry-run early return and BEFORE `write` creates anything on
    // disk, so this refuses in both modes and never produces a leaking file.
    if (unsafeTableNames.length > 0 || unexpectedTablesWithoutTenantId.length > 0) {
      dbLogger.error(
        {
          sourceDbPath,
          outputDir,
          unsafeTableNames,
          unexpectedTablesWithoutTenantId,
        },
        "tenantSplit: refusing to proceed — found a table that would be copied unfiltered into every output file",
      );
      return {
        dryRun: !write,
        tenantIds,
        tenantScopedTables,
        platformFile,
        tenantFiles,
        verifiedCounts: [],
        mismatches: [],
        unexpectedGlobalRows,
        unexpectedTablesWithoutTenantId,
        unsafeTableNames,
        droppedReplicationTables,
        rewrittenLegacyImpersonatorRows: [],
        fileChecks: [],
        ok: false,
      };
    }

    if (!write) {
      dbLogger.info(
        { sourceDbPath, outputDir, tenantIds, unexpectedGlobalRows },
        "tenantSplit: dry run — nothing written",
      );
      return {
        dryRun: true,
        tenantIds,
        tenantScopedTables,
        platformFile,
        tenantFiles,
        verifiedCounts: [],
        mismatches: [],
        unexpectedGlobalRows,
        unexpectedTablesWithoutTenantId,
        unsafeTableNames,
        droppedReplicationTables,
        rewrittenLegacyImpersonatorRows: [],
        fileChecks: [],
        ok: unexpectedGlobalRows.length === 0,
      };
    }

    fs.mkdirSync(path.join(outputDir, "tenants"), { recursive: true });

    const rewrittenLegacyImpersonatorRows: RewrittenLegacyImpersonatorRow[] = [];
    for (const id of tenantIds) {
      rewrittenLegacyImpersonatorRows.push(
        ...buildTenantFile(
          sourceDb,
          tenantScopedTables,
          droppedReplicationTables,
          id,
          tenantFiles[id],
        ),
      );
    }
    // The platform file needs no rewrite: it keeps only `tenant_id IS NULL`
    // rows, so it never contains a tenant-scoped audit_log row in the first
    // place (the legacy shape only ever showed up in a SHOP file).
    buildPlatformFile(sourceDb, tenantScopedTables, droppedReplicationTables, platformFile);

    const verifiedCounts: TableCountFinding[] = [];
    const mismatches: TableCountFinding[] = [];

    const record = (finding: TableCountFinding) => {
      if (finding.expected === finding.actual) verifiedCounts.push(finding);
      else mismatches.push(finding);
    };

    for (const table of tenantScopedTables) {
      if (table === "tenant_subscriptions") continue;

      for (const id of tenantIds) {
        const expected = countWhere(sourceDb, table, "tenant_id = ?", [id]);
        const tenantFileDb = new Database(tenantFiles[id], { readonly: true });
        try {
          const actual = countAll(tenantFileDb, table);
          record({ table, scope: `tenant ${id}`, expected, actual });
        } finally {
          tenantFileDb.close();
        }
      }

      const expectedPlatform = countWhere(sourceDb, table, "tenant_id IS NULL");
      const platformDb = new Database(platformFile, { readonly: true });
      try {
        const actualPlatform = countAll(platformDb, table);
        record({
          table,
          scope: "platform (tenant_id IS NULL)",
          expected: expectedPlatform,
          actual: actualPlatform,
        });
      } finally {
        platformDb.close();
      }
    }

    // tenant_subscriptions: whole-table retention in platform, zero in every
    // tenant file.
    {
      const expectedTotal = countAll(sourceDb, "tenant_subscriptions");
      const platformDb = new Database(platformFile, { readonly: true });
      try {
        const actualPlatform = countAll(platformDb, "tenant_subscriptions");
        record({
          table: "tenant_subscriptions",
          scope: "platform (full retention)",
          expected: expectedTotal,
          actual: actualPlatform,
        });
      } finally {
        platformDb.close();
      }
      for (const id of tenantIds) {
        const tenantFileDb = new Database(tenantFiles[id], { readonly: true });
        try {
          const actual = countAll(tenantFileDb, "tenant_subscriptions");
          record({ table: "tenant_subscriptions", scope: `tenant ${id} (must be 0)`, expected: 0, actual });
        } finally {
          tenantFileDb.close();
        }
      }
    }

    // Platform-only tables (LIRA-267): whole-table retention in platform,
    // zero in every tenant file — same rule as tenant_subscriptions above.
    for (const table of PLATFORM_ONLY_TABLES) {
      if (!tableExistsIn(sourceDb, table)) continue;
      const expectedTotal = countAll(sourceDb, table);
      const platformDb = new Database(platformFile, { readonly: true });
      try {
        record({
          table,
          scope: "platform (full retention)",
          expected: expectedTotal,
          actual: countAll(platformDb, table),
        });
      } finally {
        platformDb.close();
      }
      for (const id of tenantIds) {
        const tenantFileDb = new Database(tenantFiles[id], { readonly: true });
        try {
          record({
            table,
            scope: `tenant ${id} (must be 0)`,
            expected: 0,
            actual: countAll(tenantFileDb, table),
          });
        } finally {
          tenantFileDb.close();
        }
      }
    }

    // tenants table: platform keeps every row; each tenant file keeps
    // exactly its own.
    {
      const expectedTotal = countAll(sourceDb, "tenants");
      const platformDb = new Database(platformFile, { readonly: true });
      try {
        record({
          table: "tenants",
          scope: "platform (full retention)",
          expected: expectedTotal,
          actual: countAll(platformDb, "tenants"),
        });
      } finally {
        platformDb.close();
      }
      for (const id of tenantIds) {
        const tenantFileDb = new Database(tenantFiles[id], { readonly: true });
        try {
          record({
            table: "tenants",
            scope: `tenant ${id} (local mirror, exactly 1 row)`,
            expected: 1,
            actual: countAll(tenantFileDb, "tenants"),
          });
        } finally {
          tenantFileDb.close();
        }
      }
    }

    const fileChecks = [platformFile, ...Object.values(tenantFiles)].map(checkFileIntegrity);
    const integrityFailures = fileChecks.filter(
      (c) => c.foreignKeyViolations > 0 || c.integrityCheck !== "ok",
    );

    // unsafeTableNames/unexpectedTablesWithoutTenantId are guaranteed empty
    // here — the hard-fail check above already returned early otherwise —
    // but they're still folded into `ok` so this can never silently regress
    // if that check is ever reordered.
    const ok =
      mismatches.length === 0 &&
      unexpectedGlobalRows.length === 0 &&
      integrityFailures.length === 0 &&
      unsafeTableNames.length === 0 &&
      unexpectedTablesWithoutTenantId.length === 0;

    dbLogger.info(
      {
        tenantIds,
        mismatchCount: mismatches.length,
        unexpectedGlobalRowsCount: unexpectedGlobalRows.length,
        integrityFailureCount: integrityFailures.length,
        ok,
      },
      "tenantSplit: split complete",
    );

    return {
      dryRun: false,
      tenantIds,
      tenantScopedTables,
      platformFile,
      tenantFiles,
      verifiedCounts,
      mismatches,
      unexpectedGlobalRows,
      unexpectedTablesWithoutTenantId,
      unsafeTableNames,
      droppedReplicationTables,
      rewrittenLegacyImpersonatorRows,
      fileChecks,
      ok,
    };
  } finally {
    sourceDb.close();
  }
}
