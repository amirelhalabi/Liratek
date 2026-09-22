#!/usr/bin/env node
/**
 * Schema equivalence checker (WP0 — multi-tenancy migration v123).
 *
 * Guards the twice-bitten create_db.sql <-> migrations/index.ts drift:
 * builds two in-memory SQLite databases and diffs their final schema.
 *
 *   DB (A) "migrated": exec the OLD create_db.sql (as of the last commit,
 *   i.e. pre-this-change / v122) then run core's runMigrations() on it —
 *   this is what an existing desktop/backend DB looks like after upgrading.
 *
 *   DB (B) "fresh": exec the CURRENT create_db.sql in the working tree —
 *   this is what a brand new install looks like.
 *
 * The two must describe the same schema: same columns (name/type/notnull/
 * default), same primary key, same foreign keys, same indexes (unique
 * constraints included) — for every table. Column/constraint ORDER is not
 * compared (ALTER TABLE ADD COLUMN always appends at the end, so a migrated
 * DB's column order legitimately differs from a fresh CREATE TABLE's).
 *
 * schema_migrations' SHAPE (columns/PK) is compared like every other table,
 * via the same mechanism as above.
 *
 * schema_migrations' CONTENTS are ALSO compared (this is the specific check
 * that would have caught the v66-69/v78-79 name drift below): every
 * {version, name} pair in the live `MIGRATIONS` array must be seeded in the
 * CURRENT create_db.sql (DB B) under the SAME name, and every row
 * create_db.sql seeds must correspond to a real MIGRATIONS entry — a
 * mismatched name or an orphaned/missing seed row is reported as a diff.
 * `applied_at` timestamps are still ignored (never compared) since they are
 * never meant to agree.
 *
 * This intentionally checks DB (B) only, not DB (A): DB (A) starts from
 * git-HEAD's create_db.sql, which may ALREADY have (pre-existing, committed)
 * wrong names for versions runMigrations() then sees as "already applied"
 * (it keys on version, not name) and therefore never touches — so DB (A)'s
 * schema_migrations would just as happily reproduce a historical mistake.
 * DB (B) is the one place a wrong seed name is actually decidable: it is
 * built from nothing but the CURRENT create_db.sql in the working tree.
 *
 * Dist-vs-src note: this script reads the BUILT dist
 * (packages/core/dist/db/migrations/index.js), not the TypeScript source,
 * because it needs to actually EXECUTE runMigrations() to build DB (A) — a
 * text parse can't do that. The new content check reuses that same loaded
 * module's real `MIGRATIONS` export (not a second, hand-rolled regex parse
 * of index.ts) specifically so version 46 (`addSenderReceiverFieldsMigration`,
 * imported from a separate file and spread into the array at index.ts:1863)
 * is included automatically with no special-casing: it is a perfectly
 * ordinary element of the runtime array, even though it has no `version:`
 * literal inside index.ts itself for a text scan to find.
 *
 * The cost of reading dist is staleness: if packages/core hasn't been
 * rebuilt since the last source edit, this script would silently check
 * against yesterday's migration names — precisely the failure mode it
 * exists to catch, one layer up. `checkDistFreshness()` below guards that by
 * refusing to run (exit 1) when any file under packages/core/src (not just
 * db/migrations/ — index.ts also imports ../../utils/telecomCredit.ts) is
 * newer than the built dist's migrations output. In CI this never fires:
 * the "TypeScript check" step earlier in the same job already
 * rebuilds core's dist as a side effect (packages/core's `typecheck` script
 * IS `tsc -p tsconfig.json`, identical to `build`, with emit — see
 * package.json), and this script's own "Build core" step (see
 * .github/workflows/ci.yml) rebuilds it again immediately before this runs.
 * Locally, a developer who edits a migration and runs this script without
 * rebuilding gets a clear error instead of a silent false pass.
 *
 * Exit code 0 = no diffs. Exit code 1 = at least one diff (printed), or dist
 * is missing/stale.
 */

import Database from "better-sqlite3";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const CREATE_DB_SQL_PATH = path.join(repoRoot, "electron-app/create_db.sql");
const CORE_SRC_DIR = path.join(repoRoot, "packages/core/src");
const CORE_MIGRATIONS_DIST = path.join(
  repoRoot,
  "packages/core/dist/db/migrations/index.js",
);

function loadOldCreateDbSql() {
  return execSync("git show HEAD:electron-app/create_db.sql", {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function loadNewCreateDbSql() {
  return fs.readFileSync(CREATE_DB_SQL_PATH, "utf8");
}

// Newest mtime of any file under `dir` (recursive, skips node_modules/dist
// if ever nested inside — not expected under src, but cheap to guard). Used
// to detect a dist that predates the source it's supposed to be compiled
// from. Scoped to the WHOLE of packages/core/src (not just db/migrations/)
// because index.ts imports from outside that directory too (e.g.
// ../../utils/telecomCredit.ts) — tsc compiles the whole project in one
// pass, so "is dist fresh" is really a whole-src-tree question.
function newestMtimeMs(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtimeMs(p));
    } else {
      newest = Math.max(newest, fs.statSync(p).mtimeMs);
    }
  }
  return newest;
}

function checkDistFreshness() {
  const srcNewest = newestMtimeMs(CORE_SRC_DIR);
  const distMtime = fs.statSync(CORE_MIGRATIONS_DIST).mtimeMs;
  if (srcNewest > distMtime) {
    console.error(
      `Built core migrations (${CORE_MIGRATIONS_DIST}) are OLDER than the ` +
        `newest file under ${CORE_SRC_DIR}. Running this check now would ` +
        `compare create_db.sql against a stale build and could silently ` +
        `miss real drift (or report false ones).\n` +
        `Rebuild first: cd packages/core && npm run build (or "yarn build:core" ` +
        `from the repo root), then re-run this check.`,
    );
    process.exit(1);
  }
}

async function loadMigrationsModule() {
  if (!fs.existsSync(CORE_MIGRATIONS_DIST)) {
    console.error(
      `Built core migrations not found at ${CORE_MIGRATIONS_DIST}.\n` +
        `Run "cd packages/core && npm run build" first.`,
    );
    process.exit(1);
  }
  checkDistFreshness();
  const mod = await import(pathToFileURL(CORE_MIGRATIONS_DIST).href);
  if (typeof mod.runMigrations !== "function") {
    console.error(
      `runMigrations is not exported from ${CORE_MIGRATIONS_DIST}.`,
    );
    process.exit(1);
  }
  if (!Array.isArray(mod.MIGRATIONS)) {
    console.error(`MIGRATIONS is not exported from ${CORE_MIGRATIONS_DIST}.`);
    process.exit(1);
  }
  return { runMigrations: mod.runMigrations, MIGRATIONS: mod.MIGRATIONS };
}

// ---------------------------------------------------------------------------
// Schema extraction (PRAGMA-based, NOT sqlite_master.sql text parsing — text
// parsing chokes on rebuild artifacts: quoting/IF-NOT-EXISTS/whitespace
// differences after a DROP+RENAME are cosmetic, not semantic. PRAGMAs report
// SQLite's own canonicalized understanding of the schema.)
// ---------------------------------------------------------------------------

function listUserTables(db) {
  return db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all()
    .map((r) => r.name);
}

function normalizeDefault(v) {
  if (v === null || v === undefined) return null;
  return String(v).trim().replace(/\s+/g, " ");
}

function getColumns(db, table) {
  return db
    .prepare(`PRAGMA table_info("${table}")`)
    .all()
    .map((c) => ({
      name: c.name,
      type: String(c.type || "")
        .toUpperCase()
        .replace(/\s+/g, " ")
        .trim(),
      notnull: c.notnull,
      dflt: normalizeDefault(c.dflt_value),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getPrimaryKey(db, table) {
  return db
    .prepare(`PRAGMA table_info("${table}")`)
    .all()
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
}

function getForeignKeys(db, table) {
  const rows = db.prepare(`PRAGMA foreign_key_list("${table}")`).all();
  // Composite FKs produce multiple rows sharing the same `id`; group them,
  // ordered by `seq`, into one logical FK with column-tuples.
  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.id)) {
      byId.set(r.id, { table: r.table, on_delete: r.on_delete, cols: [] });
    }
    byId.get(r.id).cols.push({ seq: r.seq, from: r.from, to: r.to });
  }
  return [...byId.values()]
    .map((fk) => {
      const cols = fk.cols.sort((a, b) => a.seq - b.seq);
      return {
        table: fk.table,
        on_delete: fk.on_delete,
        from: cols.map((c) => c.from).join(","),
        to: cols.map((c) => c.to).join(","),
      };
    })
    .sort((a, b) =>
      `${a.table}|${a.from}|${a.to}`.localeCompare(
        `${b.table}|${b.from}|${b.to}`,
      ),
    );
}

function getIndexes(db, table) {
  const list = db.prepare(`PRAGMA index_list("${table}")`).all();
  const named = [];
  const autoSignatures = [];
  for (const idx of list) {
    const cols = db
      .prepare(`PRAGMA index_info("${idx.name}")`)
      .all()
      .sort((a, b) => a.seqno - b.seqno)
      .map((c) => c.name);
    if (idx.name.startsWith("sqlite_autoindex_")) {
      // Autoindexes back inline UNIQUE/PK constraints. Their auto-generated
      // name/number is not semantic — compare by (unique, column-set) only.
      autoSignatures.push(`${idx.unique}:${[...cols].sort().join(",")}`);
    } else {
      named.push({ name: idx.name, unique: idx.unique, columns: cols });
    }
  }
  named.sort((a, b) => a.name.localeCompare(b.name));
  autoSignatures.sort();
  return { named, autoSignatures };
}

function getTableSchema(db, table) {
  return {
    columns: getColumns(db, table),
    primaryKey: getPrimaryKey(db, table),
    foreignKeys: getForeignKeys(db, table),
    indexes: getIndexes(db, table),
  };
}

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

function diffTableSchemas(a, b) {
  const diffs = [];

  // Columns (order-independent; already sorted by name)
  const aCols = new Map(a.columns.map((c) => [c.name, c]));
  const bCols = new Map(b.columns.map((c) => [c.name, c]));
  for (const name of new Set([...aCols.keys(), ...bCols.keys()])) {
    const ca = aCols.get(name);
    const cb = bCols.get(name);
    if (!ca) {
      diffs.push(
        `column "${name}" missing in migrated DB (A), present in fresh DB (B)`,
      );
      continue;
    }
    if (!cb) {
      diffs.push(
        `column "${name}" missing in fresh DB (B), present in migrated DB (A)`,
      );
      continue;
    }
    if (ca.type !== cb.type) {
      diffs.push(
        `column "${name}" type differs: A="${ca.type}" B="${cb.type}"`,
      );
    }
    if (ca.notnull !== cb.notnull) {
      diffs.push(
        `column "${name}" notnull differs: A=${ca.notnull} B=${cb.notnull}`,
      );
    }
    if (ca.dflt !== cb.dflt) {
      diffs.push(
        `column "${name}" default differs: A="${ca.dflt}" B="${cb.dflt}"`,
      );
    }
  }

  // Primary key (order matters — PK column order is part of the declared
  // constraint, e.g. PRIMARY KEY (tenant_id, key))
  if (a.primaryKey.join(",") !== b.primaryKey.join(",")) {
    diffs.push(
      `primary key differs: A=(${a.primaryKey.join(", ")}) B=(${b.primaryKey.join(", ")})`,
    );
  }

  // Foreign keys (set comparison)
  const aFks = a.foreignKeys.map((fk) => JSON.stringify(fk));
  const bFks = b.foreignKeys.map((fk) => JSON.stringify(fk));
  const aFkSet = new Set(aFks);
  const bFkSet = new Set(bFks);
  for (const fk of aFks) {
    if (!bFkSet.has(fk)) diffs.push(`foreign key in A but not B: ${fk}`);
  }
  for (const fk of bFks) {
    if (!aFkSet.has(fk)) diffs.push(`foreign key in B but not A: ${fk}`);
  }

  // Named indexes (by name)
  const aIdx = new Map(a.indexes.named.map((i) => [i.name, i]));
  const bIdx = new Map(b.indexes.named.map((i) => [i.name, i]));
  for (const name of new Set([...aIdx.keys(), ...bIdx.keys()])) {
    const ia = aIdx.get(name);
    const ib = bIdx.get(name);
    if (!ia) {
      diffs.push(`index "${name}" missing in migrated DB (A)`);
      continue;
    }
    if (!ib) {
      diffs.push(`index "${name}" missing in fresh DB (B)`);
      continue;
    }
    if (ia.unique !== ib.unique) {
      diffs.push(
        `index "${name}" unique flag differs: A=${ia.unique} B=${ib.unique}`,
      );
    }
    if (ia.columns.join(",") !== ib.columns.join(",")) {
      diffs.push(
        `index "${name}" columns differ: A=(${ia.columns.join(", ")}) B=(${ib.columns.join(", ")})`,
      );
    }
  }

  // Autoindexes (backing inline UNIQUE/PK constraints) — set comparison
  const aAuto = new Set(a.indexes.autoSignatures);
  const bAuto = new Set(b.indexes.autoSignatures);
  for (const sig of aAuto) {
    if (!bAuto.has(sig)) {
      diffs.push(`unique constraint in A but not B (signature: ${sig})`);
    }
  }
  for (const sig of bAuto) {
    if (!aAuto.has(sig)) {
      diffs.push(`unique constraint in B but not A (signature: ${sig})`);
    }
  }

  return diffs;
}

// ---------------------------------------------------------------------------
// schema_migrations CONTENTS diff (fresh DB (B) only — see file header for
// why DB (A) is not a useful oracle for this specific check).
// ---------------------------------------------------------------------------

function diffMigrationSeedContents(dbB, migrations) {
  const seedRows = dbB
    .prepare(`SELECT version, name FROM schema_migrations ORDER BY version`)
    .all();
  const seedByVersion = new Map(seedRows.map((r) => [r.version, r.name]));
  const migByVersion = new Map(migrations.map((m) => [m.version, m.name]));

  const diffs = [];

  for (const [version, name] of migByVersion) {
    const seededName = seedByVersion.get(version);
    if (seededName === undefined) {
      diffs.push(
        `version ${version} ('${name}') exists in MIGRATIONS but has NO seed row in create_db.sql`,
      );
    } else if (seededName !== name) {
      diffs.push(
        `version ${version} name mismatch: MIGRATIONS="${name}" create_db.sql="${seededName}"`,
      );
    }
  }

  for (const [version, seededName] of seedByVersion) {
    if (!migByVersion.has(version)) {
      diffs.push(
        `version ${version} ('${seededName}') is seeded in create_db.sql but has NO matching entry in MIGRATIONS (stale/orphaned seed row)`,
      );
    }
  }

  return diffs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { runMigrations, MIGRATIONS } = await loadMigrationsModule();

  console.log("Building DB (A): old create_db.sql (HEAD) + runMigrations()...");
  const dbA = new Database(":memory:");
  dbA.pragma("foreign_keys = ON");
  dbA.exec(loadOldCreateDbSql());
  runMigrations(dbA);

  console.log("Building DB (B): current create_db.sql...");
  const dbB = new Database(":memory:");
  dbB.pragma("foreign_keys = ON");
  dbB.exec(loadNewCreateDbSql());

  const tablesA = listUserTables(dbA);
  const tablesB = listUserTables(dbB);
  const allTables = [...new Set([...tablesA, ...tablesB])].sort();

  let totalDiffs = 0;
  const report = [];

  for (const table of allTables) {
    // schema_migrations goes through this same shape diff (columns/PK/FK/
    // indexes) like every other table; its CONTENTS are compared separately
    // below via diffMigrationSeedContents, not here.
    if (!tablesA.includes(table)) {
      report.push(`TABLE "${table}": missing in migrated DB (A)`);
      totalDiffs++;
      continue;
    }
    if (!tablesB.includes(table)) {
      report.push(`TABLE "${table}": missing in fresh DB (B)`);
      totalDiffs++;
      continue;
    }
    const schemaA = getTableSchema(dbA, table);
    const schemaB = getTableSchema(dbB, table);
    const diffs = diffTableSchemas(schemaA, schemaB);
    if (diffs.length > 0) {
      report.push(`TABLE "${table}":`);
      for (const d of diffs) report.push(`  - ${d}`);
      totalDiffs += diffs.length;
    }
  }

  const seedDiffs = diffMigrationSeedContents(dbB, MIGRATIONS);
  if (seedDiffs.length > 0) {
    report.push(`schema_migrations CONTENTS (create_db.sql vs MIGRATIONS):`);
    for (const d of seedDiffs) report.push(`  - ${d}`);
    totalDiffs += seedDiffs.length;
  }

  console.log("");
  if (totalDiffs === 0) {
    console.log(
      `OK: schema equivalence verified across ${allTables.length} tables ` +
        `(including schema_migrations seed contents, ${MIGRATIONS.length} ` +
        `migrations). Zero diffs.`,
    );
    process.exit(0);
  } else {
    console.log(
      `FOUND ${totalDiffs} diff(s) across ${allTables.length} tables:\n`,
    );
    console.log(report.join("\n"));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("check-schema-equivalence.mjs failed:", err);
  process.exit(1);
});
