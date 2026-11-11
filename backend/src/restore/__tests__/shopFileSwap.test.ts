/**
 * LIRA-377 T022–T024 — `createShopFileSwap()`: the backend implementation of
 * core's `ShopFilePort` (copy a prepared candidate INTO the live shop file,
 * research R3/R4/R5).
 *
 * Real `better-sqlite3` (the subpath import escapes backend jest's
 * `moduleNameMapper` stub, same as `perTenantStorageProvisioner.test.ts`),
 * real temp directories, the real `electron-app/create_db.sql`, and the real
 * `TenantDatabasePool` / `runMigrations` / `rollbackTo` from `@liratek/core`
 * (mapped to source). Brand-new capability: written before the
 * implementation and run red against a "not implemented" skeleton (rule 17).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type DatabaseCtor from "better-sqlite3";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase = require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import {
  MIGRATIONS,
  ShopRestoringError,
  TenantDatabasePool,
  assertServerIdsBelowOfflineRange,
  getCurrentVersion,
  rollbackTo,
  runMigrations,
} from "@liratek/core";
import { createShopFileSwap, type ShopFileSwapDeps } from "../shopFileSwap.js";

type Db = InstanceType<typeof DatabaseCtor>;

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../electron-app/create_db.sql"),
  "utf8",
);
const LATEST = MIGRATIONS[MIGRATIONS.length - 1].version;
const STAMP = "20261110T150000Z";

function openDb(fp: string): Db {
  const db = new RealDatabase(fp);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

function migrate(db: Db): void {
  runMigrations(db as unknown as Parameters<typeof runMigrations>[0]);
  assertServerIdsBelowOfflineRange(
    db as unknown as Parameters<typeof assertServerIdsBelowOfflineRange>[0],
  );
}

/** A full shop file at the latest schema with one marker row. */
function buildShopFile(fp: string, label: string): void {
  const db = openDb(fp);
  try {
    db.exec(CREATE_DB_SQL);
    migrate(db);
    db.exec(
      `CREATE TABLE IF NOT EXISTS restore_probe (id INTEGER PRIMARY KEY, label TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
    );
    db.prepare(`INSERT INTO restore_probe (label) VALUES (?)`).run(label);
    db.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
}

function probe(fp: string): string[] {
  const db = new RealDatabase(fp, { readonly: true });
  try {
    return (
      db.prepare(`SELECT label FROM restore_probe ORDER BY id`).all() as Array<{ label: string }>
    ).map((r) => r.label);
  } finally {
    db.close();
  }
}

describe("createShopFileSwap", () => {
  let root: string;
  let tenantsDir: string;
  let beforeDir: string;
  let workDir: string;
  let pool: TenantDatabasePool;
  let mergeRunning: boolean;
  let held: Set<number>;
  let events: string[];

  function deps(over: Partial<ShopFileSwapDeps> = {}): ShopFileSwapDeps {
    return {
      tenantsDir,
      pool: {
        block: (id) => {
          events.push(`block:${id}`);
          pool.block(id);
        },
        unblock: (id) => {
          events.push(`unblock:${id}`);
          pool.unblock(id);
        },
        resetPoisoned: (id) => {
          events.push(`resetPoisoned:${id}`);
          pool.resetPoisoned(id);
        },
      },
      openDatabase: (fp) => openDb(fp) as unknown as DatabaseCtor.Database,
      migrate: (db) => migrate(db as unknown as Db),
      merge: {
        hold: (id) => {
          events.push(`hold:${id}`);
          held.add(id);
        },
        release: (id) => {
          events.push(`release:${id}`);
          held.delete(id);
        },
        isRunning: () => mergeRunning,
      },
      sleep: async () => undefined,
      ...over,
    };
  }

  const live = (id: number) => path.join(tenantsDir, `${id}.db`);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-shop-swap-"));
    tenantsDir = path.join(root, "tenants");
    beforeDir = path.join(root, "restore-points");
    workDir = path.join(root, "restore-work");
    fs.mkdirSync(tenantsDir, { recursive: true });
    fs.mkdirSync(workDir, { recursive: true });
    buildShopFile(live(1), "live-1");
    buildShopFile(live(2), "live-2");
    pool = new TenantDatabasePool({
      dir: tenantsDir,
      openDatabase: (fp) => openDb(fp) as unknown as DatabaseCtor.Database,
      migrate: (db) => migrate(db as unknown as Db),
    });
    // Shop 1 has an open pooled connection with a pending WAL write, like
    // a shop that was just serving requests.
    pool.get(1).prepare(`INSERT INTO restore_probe (label) VALUES (?)`).run("live-1b");
    mergeRunning = false;
    held = new Set();
    events = [];
  });

  afterEach(() => {
    pool.closeAll();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("copies the candidate into the live file in place (same inode) and keeps a before-copy", async () => {
    const candidate = path.join(workDir, "1-7.candidate");
    buildShopFile(candidate, "restored");
    const inode = fs.statSync(live(1)).ino;

    const port = createShopFileSwap(deps());
    const { beforeCopyPath } = await port.swap({
      tenantId: 1,
      candidatePath: candidate,
      beforeCopyDir: beforeDir,
      stampUtc: STAMP,
    });

    expect(fs.statSync(live(1)).ino).toBe(inode);
    expect(probe(live(1))).toEqual(["restored"]);
    expect(beforeCopyPath).toBe(path.join(beforeDir, "1", `before-${STAMP}.sqlite`));
    expect(beforeCopyPath.endsWith(".db")).toBe(false);
    expect(probe(beforeCopyPath)).toEqual(["live-1", "live-1b"]);
    // Shop reopens with the new contents through the pool.
    expect(
      (pool.get(1).prepare(`SELECT label FROM restore_probe`).all() as Array<{ label: string }>).map(
        (r) => r.label,
      ),
    ).toEqual(["restored"]);
    expect(events).toEqual(["hold:1", "block:1", "resetPoisoned:1", "unblock:1", "release:1"]);
    expect(pool.isBlocked(1)).toBe(false);
    expect(held.has(1)).toBe(false);
  });

  it("pauses only the restoring shop while the copy runs", async () => {
    const candidate = path.join(workDir, "1-8.candidate");
    buildShopFile(candidate, "restored");
    const seen: string[] = [];
    const port = createShopFileSwap(
      deps({
        checkIntegrity: (db) => {
          expect(() => pool.get(1)).toThrow(ShopRestoringError);
          const other = pool.get(2).prepare(`SELECT label FROM restore_probe`).get() as {
            label: string;
          };
          seen.push(other.label);
          return String(db.pragma("integrity_check", { simple: true }));
        },
      }),
    );
    await port.swap({ tenantId: 1, candidatePath: candidate, beforeCopyDir: beforeDir, stampUtc: STAMP });
    expect(seen).toEqual(["live-2"]);
    expect(probe(live(1))).toEqual(["restored"]);
  });

  it("waits for a running merge round before blocking the shop", async () => {
    const candidate = path.join(workDir, "1-9.candidate");
    buildShopFile(candidate, "restored");
    let polls = 0;
    const port = createShopFileSwap(
      deps({
        sleep: async () => {
          polls += 1;
          events.push(`sleep`);
          if (polls === 2) mergeRunning = false;
        },
      }),
    );
    mergeRunning = true;
    await port.swap({ tenantId: 1, candidatePath: candidate, beforeCopyDir: beforeDir, stampUtc: STAMP });
    expect(events.slice(0, 4)).toEqual(["hold:1", "sleep", "sleep", "block:1"]);
    expect(probe(live(1))).toEqual(["restored"]);
  });

  it("gives up when the merge round never ends, live file untouched and nothing blocked", async () => {
    const candidate = path.join(workDir, "1-10.candidate");
    buildShopFile(candidate, "restored");
    mergeRunning = true;
    const port = createShopFileSwap(deps({ mergeWaitMaxPolls: 3 }));
    await expect(
      port.swap({ tenantId: 1, candidatePath: candidate, beforeCopyDir: beforeDir, stampUtc: STAMP }),
    ).rejects.toThrow(/merge/i);
    expect(events).not.toContain("block:1");
    expect(held.has(1)).toBe(false);
    expect(pool.isBlocked(1)).toBe(false);
    expect(probe(live(1))).toEqual(["live-1", "live-1b"]);
  });

  it("puts the original contents back when the integrity check fails after the copy", async () => {
    const candidate = path.join(workDir, "1-11.candidate");
    buildShopFile(candidate, "restored");
    const inode = fs.statSync(live(1)).ino;
    let calls = 0;
    const port = createShopFileSwap(
      deps({
        checkIntegrity: (db) => {
          calls += 1;
          // First check is the swap's own; later ones (after putting the
          // before-copy back) report the real result.
          return calls === 1 ? "page 3: btree corrupt" : String(db.pragma("integrity_check", { simple: true }));
        },
      }),
    );
    await expect(
      port.swap({ tenantId: 1, candidatePath: candidate, beforeCopyDir: beforeDir, stampUtc: STAMP }),
    ).rejects.toThrow(/integrity/i);
    expect(fs.statSync(live(1)).ino).toBe(inode);
    expect(probe(live(1))).toEqual(["live-1", "live-1b"]);
    expect(fs.existsSync(path.join(beforeDir, "1", `before-${STAMP}.sqlite`))).toBe(true);
    expect(pool.isBlocked(1)).toBe(false);
    expect(held.has(1)).toBe(false);
    expect(events).not.toContain("resetPoisoned:1");
    expect(() => pool.get(1)).not.toThrow();
  });

  it("leaves the live file unchanged when the candidate is not a database", async () => {
    const candidate = path.join(workDir, "1-12.candidate");
    fs.writeFileSync(candidate, Buffer.alloc(8192, 7));
    const port = createShopFileSwap(deps());
    // The rejection must be this realm's Error with our own message. Raw
    // better-sqlite3 errors come from whichever test file first loaded the
    // shared native addon in this jest worker (`setErrorConstructor` runs
    // once per process), so `instanceof Error` fails here and a bare
    // `.rejects.toThrow()` reports "did not throw" — only on CI, where
    // several real-sqlite suites share a worker.
    await expect(
      port.swap({ tenantId: 1, candidatePath: candidate, beforeCopyDir: beforeDir, stampUtc: STAMP }),
    ).rejects.toThrow(/candidate file for shop 1 is not a readable database.*not a database/i);
    expect(events).not.toContain("block:1");
    expect(probe(live(1))).toEqual(["live-1", "live-1b"]);
    expect(pool.isBlocked(1)).toBe(false);
    expect(held.has(1)).toBe(false);
  });

  it("migrateCandidate brings an older-schema file (v230) to the latest version", async () => {
    const candidate = path.join(workDir, "1-13.candidate");
    buildShopFile(candidate, "old");
    const db = openDb(candidate);
    rollbackTo(db as unknown as Parameters<typeof rollbackTo>[0], 230);
    expect(getCurrentVersion(db as unknown as Parameters<typeof getCurrentVersion>[0])).toBe(230);
    // ~11 MB of padding, the size of the largest production shop (T023).
    db.exec(`CREATE TABLE pad (id INTEGER PRIMARY KEY, b BLOB)`);
    const ins = db.prepare(`INSERT INTO pad (b) VALUES (?)`);
    db.transaction(() => {
      for (let i = 0; i < 176; i++) ins.run(Buffer.alloc(64 * 1024, i % 251));
    })();
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.close();
    expect(fs.statSync(candidate).size).toBeGreaterThan(11 * 1024 * 1024);

    const port = createShopFileSwap(deps());
    await port.migrateCandidate(candidate);

    const after = new RealDatabase(candidate, { readonly: true });
    try {
      expect(getCurrentVersion(after as unknown as Parameters<typeof getCurrentVersion>[0])).toBe(LATEST);
    } finally {
      after.close();
    }
    expect(probe(candidate)).toEqual(["old"]);
    // migrateCandidate never touches the pool or the live file.
    expect(events).toEqual([]);
  });
});
