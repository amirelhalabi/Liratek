#!/usr/bin/env node
/**
 * LIRA-226 — guards `scripts/check-schema-equivalence.mjs`'s two gaps:
 *
 * (a) DB (A) used to always be built from `git show HEAD:electron-app/
 *     create_db.sql`. On `push: [main]` HEAD *is* the pushed commit, and on
 *     `pull_request` actions/checkout resolves HEAD to the merge ref —
 *     either way A's source file is byte-identical to B's (the CURRENT
 *     working-tree create_db.sql), so once every version is seeded,
 *     `runMigrations()` applies nothing and A === B **by construction**. A
 *     column added to create_db.sql with no matching migration (the classic
 *     rule-10 miss) produced zero diffs. The fix adds `SCHEMA_CHECK_BASE_REF`
 *     (`resolveBaseRef()`) so CI can point DB (A) at a commit that predates
 *     the change under test.
 *
 * (b) `diffMigrationSeedContents` built `new Map(migrations.map(m =>
 *     [m.version, m.name]))`, which silently keeps only the LAST of a
 *     duplicated `version:` — exactly the accident the LIRA-176 v167/v168
 *     renumber note in create_db.sql describes recovering from. The fix
 *     counts occurrences of each version BEFORE the Map is built and
 *     reports any count > 1 as a diff, naming the version.
 *
 * Every scenario below runs against FIXTURE data in a throwaway temp
 * directory — a real, isolated git repo for (a), in-memory arrays/DBs for
 * (b) — never against this repository's own electron-app/create_db.sql or
 * packages/core/src/db/migrations/index.ts (CLAUDE.md rule 17 as this batch
 * applies it: never edit finished repo files, even temporarily, to prove a
 * test).
 *
 * (a)'s fixture runs the REAL, CURRENT check-schema-equivalence.mjs — copied
 * byte-for-byte into the temp repo, not reimplemented — so what's proven is
 * the actual script's behavior, not a description of it.
 *
 * Run directly: node --test scripts/__tests__/checkSchemaEquivalence.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_SRC = path.resolve(__dirname, "..", "check-schema-equivalence.mjs");
const REAL_REPO_ROOT = path.resolve(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// (b) diffMigrationSeedContents / resolveBaseRef — pure-function fixtures
// ---------------------------------------------------------------------------

const mod = await import(`${pathToFileURL(SCRIPT_SRC).href}?t=${Date.now()}`);

test("importing the module does NOT trigger a real run (main() is guarded behind a direct-execution check)", () => {
  // If the entry guard were missing, importing this module for its pure
  // functions below would itself try to shell out to git / load a
  // (probably absent, in a bare `node --test` invocation) core dist and
  // call process.exit() — the mere fact this file's other tests get to run
  // at all is part of what this asserts, but pin the exported surface too.
  assert.equal(typeof mod.resolveBaseRef, "function");
  assert.equal(typeof mod.diffMigrationSeedContents, "function");
});

test("resolveBaseRef defaults to HEAD when SCHEMA_CHECK_BASE_REF is unset (local-dev default, unchanged)", () => {
  assert.equal(mod.resolveBaseRef({}), "HEAD");
});

test("resolveBaseRef returns the trimmed env value when set", () => {
  assert.equal(
    mod.resolveBaseRef({ SCHEMA_CHECK_BASE_REF: "  abcdef0123  " }),
    "abcdef0123",
  );
});

test("resolveBaseRef rejects a ref containing shell-unsafe characters", () => {
  assert.throws(
    () => mod.resolveBaseRef({ SCHEMA_CHECK_BASE_REF: "HEAD; rm -rf /" }),
    /conservative git-ref set/,
  );
});

function makeSchemaMigrationsDb(rows) {
  const db = new Database(":memory:");
  db.exec(
    `CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT)`,
  );
  const insert = db.prepare(
    `INSERT INTO schema_migrations (version, name) VALUES (?, ?)`,
  );
  for (const r of rows) insert.run(r.version, r.name);
  return db;
}

test("LIRA-226(b) reproduction: the OLD Map-collapse silently drops a duplicated version with NO diagnostic (contrast case)", () => {
  // The exact snippet named in the ticket, run against a fixture — not the
  // real create_db.sql/migrations/index.ts.
  const migrations = [
    { version: 2, name: "second_original" },
    { version: 2, name: "second_renamed_by_accident" },
  ];
  const oldMigByVersion = new Map(migrations.map((m) => [m.version, m.name]));
  assert.equal(oldMigByVersion.size, 1, "the collapse: two entries, one key");
  assert.equal(
    oldMigByVersion.get(2),
    "second_renamed_by_accident",
    "the earlier entry vanished with nothing to say so",
  );
});

test("diffMigrationSeedContents reports a duplicated MIGRATIONS version, naming the version and both names", () => {
  const db = makeSchemaMigrationsDb([
    { version: 1, name: "first" },
    { version: 2, name: "second_original" },
  ]);
  const migrations = [
    { version: 1, name: "first" },
    { version: 2, name: "second_original" },
    { version: 2, name: "second_renamed_by_accident" },
  ];
  const diffs = mod.diffMigrationSeedContents(db, migrations);
  const dup = diffs.find((d) => d.includes("declared 2 times"));
  assert.ok(
    dup,
    `expected a duplicate-version diagnostic, got: ${JSON.stringify(diffs)}`,
  );
  assert.match(dup, /version 2/);
  assert.match(dup, /second_original/);
  assert.match(dup, /second_renamed_by_accident/);
  db.close();
});

test("diffMigrationSeedContents: no false positive when every version is unique", () => {
  const db = makeSchemaMigrationsDb([
    { version: 1, name: "first" },
    { version: 2, name: "second" },
  ]);
  const migrations = [
    { version: 1, name: "first" },
    { version: 2, name: "second" },
  ];
  const diffs = mod.diffMigrationSeedContents(db, migrations);
  assert.deepEqual(diffs, []);
  db.close();
});

// ---------------------------------------------------------------------------
// (a) SCHEMA_CHECK_BASE_REF — isolated temp git repo, real copy of the script
// ---------------------------------------------------------------------------

function sh(cmd, cwd) {
  const result = spawnSync(cmd[0], cmd.slice(1), { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `command failed (${cmd.join(" ")}) in ${cwd}: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

/**
 * Builds a throwaway repo OUTSIDE this repository with the minimal shape
 * check-schema-equivalence.mjs needs (electron-app/create_db.sql,
 * packages/core/{package.json,src/,dist/db/migrations/index.js},
 * scripts/check-schema-equivalence.mjs — a byte-for-byte copy of the real,
 * current script). Two commits: an OLD one (a `foo` table with no
 * `new_col`, migration v1 only) and a NEW one that reproduces a classic
 * rule-10 miss — create_db.sql gains `new_col` AND a seeded v2 row, but the
 * v2 migration's `up()` is a no-op stub (the "forgot the column" bug shape)
 * — plus the migrations dist module updated to match. Returns paths/shas
 * the tests need; NOTHING here touches this repository's own files.
 */
function makeFixtureRepo() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "liratek-schema-equiv-test-"),
  );

  fs.mkdirSync(path.join(root, "electron-app"), { recursive: true });
  fs.mkdirSync(path.join(root, "packages", "core", "src"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(root, "packages", "core", "dist", "db", "migrations"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });

  // ESM marker so the fake dist/*.js resolves as a module, matching the
  // real packages/core/package.json's "type": "module".
  fs.writeFileSync(
    path.join(root, "packages", "core", "package.json"),
    JSON.stringify({ name: "fixture-core", type: "module" }, null, 2),
  );

  fs.copyFileSync(
    SCRIPT_SRC,
    path.join(root, "scripts", "check-schema-equivalence.mjs"),
  );

  const createDbOld = `
CREATE TABLE IF NOT EXISTS foo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO schema_migrations (version, name) VALUES
    (1, 'create_foo');
`;

  const createDbNew = `
CREATE TABLE IF NOT EXISTS foo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    new_col TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO schema_migrations (version, name) VALUES
    (1, 'create_foo'),
    (2, 'add_new_col_to_foo');
`;

  const migrationsDistV1 = `
export const MIGRATIONS = [
  {
    version: 1,
    name: "create_foo",
    up(db) {},
    down(db) {},
  },
];

export function runMigrations(db) {
  db.exec(\`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT DEFAULT CURRENT_TIMESTAMP
  )\`);
  const applied = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map((r) => r.version),
  );
  const pending = MIGRATIONS.filter((m) => !applied.has(m.version));
  console.log(\`[MIGRATIONS] Running \${pending.length} migration(s)...\`);
  for (const m of pending) {
    m.up(db);
    db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
      m.version,
      m.name,
    );
  }
}
`;

  // The bug under test: v2 is a REAL entry in MIGRATIONS (so it's applied
  // exactly once against an "old" DB that hasn't seen it yet), but its
  // up() forgets the ALTER — the classic rule-10 miss the shape check
  // exists to catch.
  const migrationsDistV2 = `
export const MIGRATIONS = [
  {
    version: 1,
    name: "create_foo",
    up(db) {},
    down(db) {},
  },
  {
    version: 2,
    name: "add_new_col_to_foo",
    up(db) {
      // BUG: forgot \`ALTER TABLE foo ADD COLUMN new_col TEXT\` here.
    },
    down(db) {},
  },
];

export function runMigrations(db) {
  db.exec(\`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT DEFAULT CURRENT_TIMESTAMP
  )\`);
  const applied = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map((r) => r.version),
  );
  const pending = MIGRATIONS.filter((m) => !applied.has(m.version));
  console.log(\`[MIGRATIONS] Running \${pending.length} migration(s)...\`);
  for (const m of pending) {
    m.up(db);
    db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
      m.version,
      m.name,
    );
  }
}
`;

  const createDbPath = path.join(root, "electron-app", "create_db.sql");
  const migrationsDistPath = path.join(
    root,
    "packages",
    "core",
    "dist",
    "db",
    "migrations",
    "index.js",
  );

  // --- OLD commit ---
  fs.writeFileSync(createDbPath, createDbOld);
  fs.writeFileSync(migrationsDistPath, migrationsDistV1);

  sh(["git", "init", "-q"], root);
  sh(["git", "config", "user.email", "fixture@example.test"], root);
  sh(["git", "config", "user.name", "Fixture"], root);
  // node_modules doesn't exist yet at commit time (added below, AFTER both
  // commits) — belt-and-braces so a future edit that reorders these steps
  // can't accidentally `git add` a symlinked node_modules into the fixture.
  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules\n");
  sh(["git", "add", "-A"], root);
  sh(["git", "commit", "-q", "-m", "old: create_foo only"], root);
  const oldSha = sh(["git", "rev-parse", "HEAD"], root).trim();

  // --- NEW commit (the rule-10 miss under test) ---
  fs.writeFileSync(createDbPath, createDbNew);
  fs.writeFileSync(migrationsDistPath, migrationsDistV2);
  sh(["git", "add", "-A"], root);
  sh(["git", "commit", "-q", "-m", "new: adds new_col + a no-op v2 migration"], root);

  // The copied script `import`s "better-sqlite3" — ESM resolution ignores
  // NODE_PATH, so the only way to hand it that dependency without a real
  // `yarn install` in the throwaway repo is a node_modules symlink back to
  // THIS repo's already-installed copy. Created AFTER both commits (see the
  // .gitignore note above) so git never has a reason to walk into it.
  // "junction" needs no elevated privileges on Windows; ignored (any
  // symlink works) on POSIX.
  fs.symlinkSync(
    path.join(REAL_REPO_ROOT, "node_modules"),
    path.join(root, "node_modules"),
    "junction",
  );

  return { root, oldSha };
}

function runScript(root, env) {
  const scriptPath = path.join(root, "scripts", "check-schema-equivalence.mjs");
  return spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("LIRA-226(a): with no SCHEMA_CHECK_BASE_REF (the pre-fix/default behavior), the rule-10 miss is NOT caught — reproduces the vacuous pass", () => {
  const { root } = makeFixtureRepo();
  try {
    const result = runScript(root, { SCHEMA_CHECK_BASE_REF: "" });
    assert.equal(
      result.status,
      0,
      `expected the vacuous exit 0, got ${result.status}. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    assert.match(result.stdout, /Zero diffs/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("LIRA-226(a): with SCHEMA_CHECK_BASE_REF pointed at a commit that predates the change, the rule-10 miss IS caught", () => {
  const { root, oldSha } = makeFixtureRepo();
  try {
    const result = runScript(root, { SCHEMA_CHECK_BASE_REF: oldSha });
    assert.equal(
      result.status,
      1,
      `expected exit 1 (drift caught), got ${result.status}. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    assert.match(result.stdout, /new_col/);
    assert.match(result.stdout, /missing in migrated DB \(A\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
