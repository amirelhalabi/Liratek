/**
 * `setDatabaseResolver()` + `TenantDatabasePool` wired together the way
 * `backend/src/database/connection.ts` wires them in `per-tenant` mode
 * (`PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 11.3, tests 3 and 7).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  getDatabase,
  initDatabase,
  closeDatabase,
  setDatabaseResolver,
} from "../connection.js";
import {
  runWithTenant,
  runWithoutTenant,
  getCurrentTenantId,
  initFixedTenantContext,
  resetTenantContext,
} from "../tenantContext.js";
import { TenantDatabasePool } from "../tenantDatabasePool.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "liratek-tenant-routing-"));
}

function createTenantFile(dir: string, tenantId: number, label: string): void {
  const db = new Database(path.join(dir, `${tenantId}.db`));
  db.exec(
    `CREATE TABLE marker (label TEXT);
     INSERT INTO marker VALUES ('${label}');`,
  );
  db.close();
}

describe("§ 11.3 test 3 — interleaved async requests keep their own connection", () => {
  let dir: string;
  let pool: TenantDatabasePool;

  beforeEach(() => {
    dir = makeTmpDir();
    createTenantFile(dir, 1, "tenant1");
    createTenantFile(dir, 5, "tenant5");
    pool = new TenantDatabasePool({
      dir,
      openDatabase: (filePath) => new Database(filePath),
      migrate: () => {},
    });
    setDatabaseResolver(() => pool.get(getCurrentTenantId()));
  });

  afterEach(() => {
    setDatabaseResolver(null);
    pool.closeAll();
    resetTenantContext();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("never lets one request's await hand its connection to the other", async () => {
    async function readLabelTwice(tenantId: number): Promise<string[]> {
      return runWithTenant(tenantId, async () => {
        const first = (
          getDatabase().prepare("SELECT label FROM marker").get() as {
            label: string;
          }
        ).label;
        // Yield to the event loop — the other "request" runs its own
        // getDatabase() calls in here before we resume.
        await sleep(5);
        const second = (
          getDatabase().prepare("SELECT label FROM marker").get() as {
            label: string;
          }
        ).label;
        return [first, second];
      });
    }

    const [resultsFor1, resultsFor5] = await Promise.all([
      readLabelTwice(1),
      readLabelTwice(5),
    ]);

    expect(resultsFor1).toEqual(["tenant1", "tenant1"]);
    expect(resultsFor5).toEqual(["tenant5", "tenant5"]);
  });
});

describe("§ 11.3 test 7 — bypass/no scope, and no resolver installed", () => {
  const platformDb = new Database(":memory:");
  platformDb.exec(
    "CREATE TABLE marker (label TEXT); INSERT INTO marker VALUES ('platform');",
  );

  afterEach(() => {
    setDatabaseResolver(null);
    closeDatabase();
    resetTenantContext();
  });

  it("routes a bypass/no-tenant scope to the platform database when a resolver IS installed", () => {
    let dir = "";
    let pool: TenantDatabasePool | null = null;
    try {
      dir = makeTmpDir();
      createTenantFile(dir, 9, "tenant9");
      pool = new TenantDatabasePool({
        dir,
        openDatabase: (filePath) => new Database(filePath),
        migrate: () => {},
      });
      const activePool = pool;

      setDatabaseResolver(() => {
        try {
          const tenantId = getCurrentTenantId();
          return activePool.get(tenantId);
        } catch {
          // No active runWithTenant scope, or an explicit runWithoutTenant()
          // bypass — both mean "control-plane", i.e. the platform database.
          return platformDb;
        }
      });

      const tenantLabel = runWithTenant(9, () =>
        (
          getDatabase().prepare("SELECT label FROM marker").get() as {
            label: string;
          }
        ).label,
      );
      expect(tenantLabel).toBe("tenant9");

      const bypassLabel = runWithoutTenant(
        () =>
          (
            getDatabase().prepare("SELECT label FROM marker").get() as {
              label: string;
            }
          ).label,
      );
      expect(bypassLabel).toBe("platform");
    } finally {
      pool?.closeAll();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("with NO resolver installed and a fixed tenant (desktop), behaviour is byte-identical to today", () => {
    // Desktop never installs a resolver — initDatabase() + a fixed tenant id
    // is the whole story, same as before Phase A existed.
    initDatabase(platformDb);
    initFixedTenantContext(1);

    expect(getDatabase()).toBe(platformDb);
    // Switching "tenant" via runWithTenant changes nothing without a
    // resolver — there is only ever the one database, exactly like today.
    const label = runWithTenant(999, () =>
      (
        getDatabase().prepare("SELECT label FROM marker").get() as {
          label: string;
        }
      ).label,
    );
    expect(label).toBe("platform");
  });
});
