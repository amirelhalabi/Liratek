/**
 * GUARD — was an ADVERSARIAL repro for an id-reuse data-destruction bug in
 * `createPerTenantStorageProvisioner().createTenant()`
 * (`backend/src/database/perTenantStorageProvisioner.ts`), renamed after the
 * fix landed (CLAUDE.md rule 17: prove failing-first, never re-break
 * finished code to re-prove it).
 *
 * Original hypothesis (still the mechanism this guards): `tenants.id` is
 * `INTEGER PRIMARY KEY AUTOINCREMENT`, so the platform's OWN registry never
 * reuses an id on its own — but the runbook
 * (`PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 12.4) replicates the platform
 * database and the `tenants/` directory as TWO SEPARATE Litestream streams
 * (`backend/litestream.yml`'s platform replica vs its `dir` replica for
 * tenant files). A restore that only rolls back the PLATFORM file (a real,
 * documented operational action) resets `sqlite_sequence` for `tenants` to a
 * lower value while the `tenants/` DIRECTORY ON DISK is untouched and still
 * holds `<id>.db` files for ids the restored platform file no longer knows
 * about. Before the fix, the very next ordinary provisioning call reused one
 * of those ids and `fs.renameSync(tempPath, finalPath)`
 * (`perTenantStorageProvisioner.ts` ~L308) silently REPLACED the existing
 * destination file (verified directly on this Windows machine: a scratch
 * script renamed onto an existing file with no error and the destination's
 * bytes were fully replaced — matching POSIX `rename()` semantics, not
 * "refuse if exists").
 *
 * **Proven failing-first (rule 17):** this exact scenario, run against an
 * isolated copy of the pre-fix `perTenantStorageProvisioner.ts` (via `git
 * show :backend/src/database/perTenantStorageProvisioner.ts`, never by
 * reverting the working tree), PASSED as "BROKEN" — the old shop's real
 * client row was gone, silently replaced by the new tenant's empty seed, at
 * the SAME id, with no error surfaced anywhere. That scratch copy was
 * deleted immediately after capturing the failure; nothing in the working
 * tree was ever reverted to produce it.
 *
 * The fix, both layers (`PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 12.2):
 *
 *   1. `TenantRepository.raiseSequenceFloor(minId)` — called inside the SAME
 *      platform transaction that inserts the new `tenants` row, BEFORE that
 *      insert, with `minId` computed from a directory scan (every live
 *      `<id>.db` AND every archived `<id>-<timestamp>.db`). This makes the
 *      id `create()` is about to hand out already impossible to collide with
 *      anything on disk in the ordinary case — Test 1 below proves this: no
 *      throw, and the new tenant lands on a brand-new id above the old
 *      shop's, with the old shop completely untouched.
 *   2. An existence check immediately before `fs.renameSync` in
 *      `createTenant()` — belt-and-braces for if (1) is ever bypassed (a
 *      future bug, a race, a caller that skips it). Test 2 below proves this
 *      independently, by constructing a fake platform tenant repo whose
 *      `raiseSequenceFloor` is a deliberate no-op — i.e. simulating exactly
 *      that bypass — and showing the existence check still refuses to
 *      overwrite, throws, and leaves the platform rows and both files
 *      exactly as they were.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type DatabaseCtor from "better-sqlite3";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase = require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import {
  TenantRepository,
  SubscriptionRepository,
  TenantDatabasePool,
  runMigrations,
} from "@liratek/core";
import {
  createPerTenantStorageProvisioner,
  type PlatformTenantRepoLike,
} from "../database/perTenantStorageProvisioner.js";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../electron-app/create_db.sql"),
  "utf8",
);

function makeTmpTenantsDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "liratek-id-reuse-guard-"));
}

function configureConnection(db: InstanceType<typeof DatabaseCtor>): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
}

/**
 * Wraps a real `TenantRepository` but makes `raiseSequenceFloor` a no-op —
 * simulating the floor-raise fix being bypassed, so Test 2 can prove the
 * existence-check-before-rename guard is independently load-bearing and not
 * merely inert because the floor raise upstream already prevents collision.
 */
function bypassingFloorRaise(real: TenantRepository): PlatformTenantRepoLike {
  return {
    runInTransaction: (fn) => real.runInTransaction(fn),
    create: (data) => real.create(data),
    update: (id, data) => real.update(id, data),
    deleteRegistryRow: (id) => real.deleteRegistryRow(id),
    raiseSequenceFloor: () => {
      // Deliberately does nothing.
    },
  };
}

describe("GUARD: tenant id reuse after a platform-only restore", () => {
  let tenantsDir: string;
  let platformDb: InstanceType<typeof DatabaseCtor>;
  let platformTenantRepo: TenantRepository;
  let platformSubscriptionRepo: SubscriptionRepository;
  let pool: TenantDatabasePool;

  beforeEach(() => {
    tenantsDir = makeTmpTenantsDir();

    platformDb = new RealDatabase(":memory:");
    platformDb.pragma("foreign_keys = ON");
    platformDb.exec(CREATE_DB_SQL);

    platformTenantRepo = new TenantRepository(platformDb);
    platformSubscriptionRepo = new SubscriptionRepository(platformDb);

    pool = new TenantDatabasePool({
      dir: tenantsDir,
      openDatabase: (fp) => new RealDatabase(fp) as unknown as DatabaseCtor,
      migrate: (db) =>
        runMigrations(db as unknown as Parameters<typeof runMigrations>[0]),
    });
  });

  afterEach(() => {
    pool.closeAll();
    platformDb.close();
    fs.rmSync(tenantsDir, { recursive: true, force: true });
  });

  it("Test 1 (floor raise): reprovisioning after a platform-only restore does NOT destroy the old shop, and the new shop lands on a NEW id above every id on disk", () => {
    const provisioner = createPerTenantStorageProvisioner({
      tenantsDir,
      pool,
      openRawDatabase: (fp) => new RealDatabase(fp) as unknown as DatabaseCtor,
      configureConnection: (db) =>
        configureConnection(db as unknown as InstanceType<typeof DatabaseCtor>),
      runMigrations: (db) =>
        runMigrations(db as unknown as Parameters<typeof runMigrations>[0]),
      createDbSql: CREATE_DB_SQL,
      platformTenantRepo,
      platformSubscriptionRepo,
      clock: () => new Date("2026-09-27T12:00:00.000Z"),
    });

    // ---- Step 1: provision a REAL shop with real data in it ----
    const oldShop = provisioner.createTenant({
      name: "Real Paying Shop",
      slug: "real-paying-shop",
      contactName: null,
      contactPhone: null,
      notes: null,
      adminUsername: "shopadmin",
      passwordHash: "hashed-password-value",
    });
    const oldShopId = oldShop.id;
    const oldShopPath = path.join(tenantsDir, `${oldShopId}.db`);
    expect(fs.existsSync(oldShopPath)).toBe(true);

    // Give the old shop a distinguishing, real business row so we can prove
    // later whether it survived.
    {
      const shopDb = new RealDatabase(oldShopPath);
      shopDb.pragma("foreign_keys = ON");
      shopDb
        .prepare(
          `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (?, 'REAL CLIENT — DO NOT LOSE', '99999999')`,
        )
        .run(oldShopId);
      shopDb.close();
    }

    // ---- Step 2: simulate a PLATFORM-ONLY restore to a snapshot taken
    // before this shop existed. The `tenants/` directory (this test's
    // `tenantsDir`) is a separate store and is deliberately left untouched —
    // exactly mirroring the documented split-replica layout (§ 12.4). ----
    platformDb
      .prepare(`DELETE FROM tenant_subscriptions WHERE tenant_id = ?`)
      .run(oldShopId);
    platformDb.prepare(`DELETE FROM tenants WHERE id = ?`).run(oldShopId);
    platformDb
      .prepare(`UPDATE sqlite_sequence SET seq = ? WHERE name = 'tenants'`)
      .run(oldShopId - 1);
    expect(platformTenantRepo.getById(oldShopId)).toBeNull();

    // ---- Step 3: ordinary provisioning of a brand-new, unrelated tenant —
    // no special/malicious input, just the normal path an operator or a
    // signup flow drives every day. ----
    const newShop = provisioner.createTenant({
      name: "Totally Different New Shop",
      slug: "totally-different-new-shop",
      contactName: null,
      contactPhone: null,
      notes: null,
      adminUsername: "newadmin",
      passwordHash: "hashed-password-value-2",
    });

    // The fix: this succeeds (no destruction to refuse), but on a NEW id —
    // never the old shop's id, and always strictly above every id that has
    // a file on disk.
    expect(newShop.id).not.toBe(oldShopId);
    expect(newShop.id).toBeGreaterThan(oldShopId);

    // ---- Step 4: the old shop's file, read directly, is untouched. ----
    const survivorCheck = new RealDatabase(oldShopPath, { readonly: true });
    try {
      const stillThere = survivorCheck
        .prepare(
          `SELECT * FROM clients WHERE full_name = 'REAL CLIENT — DO NOT LOSE'`,
        )
        .get();
      const tenantsRow = survivorCheck.prepare(`SELECT * FROM tenants`).all();
      expect(stillThere).toBeTruthy();
      expect((tenantsRow[0] as { name: string }).name).toBe(
        "Real Paying Shop",
      );
    } finally {
      survivorCheck.close();
    }

    // And the new shop is a real, separate, loadable file at its own id.
    const newShopPath = path.join(tenantsDir, `${newShop.id}.db`);
    expect(fs.existsSync(newShopPath)).toBe(true);
  });

  it("Test 2 (existence-check guard, floor raise bypassed): provisioning refuses to overwrite an id that already has a file, throws, and leaves the platform rows and both files exactly as they were", () => {
    const realProvisioner = createPerTenantStorageProvisioner({
      tenantsDir,
      pool,
      openRawDatabase: (fp) => new RealDatabase(fp) as unknown as DatabaseCtor,
      configureConnection: (db) =>
        configureConnection(db as unknown as InstanceType<typeof DatabaseCtor>),
      runMigrations: (db) =>
        runMigrations(db as unknown as Parameters<typeof runMigrations>[0]),
      createDbSql: CREATE_DB_SQL,
      platformTenantRepo,
      platformSubscriptionRepo,
      clock: () => new Date("2026-09-27T12:00:00.000Z"),
    });

    // ---- Step 1: provision a real shop, same as Test 1. ----
    const oldShop = realProvisioner.createTenant({
      name: "Real Paying Shop 2",
      slug: "real-paying-shop-2",
      contactName: null,
      contactPhone: null,
      notes: null,
      adminUsername: "shopadmin2",
      passwordHash: "hashed-password-value",
    });
    const oldShopId = oldShop.id;
    const oldShopPath = path.join(tenantsDir, `${oldShopId}.db`);
    const oldShopBytesBefore = fs.readFileSync(oldShopPath);

    // ---- Step 2: same platform-only-restore simulation as Test 1. ----
    platformDb
      .prepare(`DELETE FROM tenant_subscriptions WHERE tenant_id = ?`)
      .run(oldShopId);
    platformDb.prepare(`DELETE FROM tenants WHERE id = ?`).run(oldShopId);
    platformDb
      .prepare(`UPDATE sqlite_sequence SET seq = ? WHERE name = 'tenants'`)
      .run(oldShopId - 1);

    // ---- Step 3: THIS TIME, provision through a provisioner whose platform
    // tenant repo silently skips the floor raise — simulating that half of
    // the fix being bypassed — so `create()` reissues `oldShopId` exactly
    // like the pre-fix bug. The existence check immediately before the
    // rename must be the thing that stops it. ----
    const bypassedProvisioner = createPerTenantStorageProvisioner({
      tenantsDir,
      pool,
      openRawDatabase: (fp) => new RealDatabase(fp) as unknown as DatabaseCtor,
      configureConnection: (db) =>
        configureConnection(db as unknown as InstanceType<typeof DatabaseCtor>),
      runMigrations: (db) =>
        runMigrations(db as unknown as Parameters<typeof runMigrations>[0]),
      createDbSql: CREATE_DB_SQL,
      platformTenantRepo: bypassingFloorRaise(platformTenantRepo),
      platformSubscriptionRepo,
      clock: () => new Date("2026-09-27T12:00:00.000Z"),
    });

    let thrown: unknown = null;
    try {
      bypassedProvisioner.createTenant({
        name: "Totally Different New Shop 2",
        slug: "totally-different-new-shop-2",
        contactName: null,
        contactPhone: null,
        notes: null,
        adminUsername: "newadmin2",
        passwordHash: "hashed-password-value-2",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/Refusing to provision tenant/);

    // The old shop's file: byte-identical, never touched by the failed
    // attempt (the cleanup path must not delete a file it didn't create).
    expect(fs.readFileSync(oldShopPath)).toEqual(oldShopBytesBefore);

    // No stray temp file left behind by the failed attempt (no `archive/`
    // dir either — nothing has ever been deleted/archived in this test).
    const entries = fs.readdirSync(tenantsDir);
    expect(entries.sort()).toEqual([`${oldShopId}.db`]);

    // The failed attempt's OWN platform rows were rolled back — the only
    // tenant left in the platform registry is the original (now
    // restore-deleted) `oldShopId` row's absence, i.e. nothing new landed.
    const allTenantIds = (
      platformDb.prepare(`SELECT id FROM tenants`).all() as { id: number }[]
    ).map((r) => r.id);
    expect(allTenantIds).not.toContain(oldShopId); // still "restored away"
    // And no OTHER row was left behind by the failed attempt either — the
    // only ids present are whatever pre-existed (tenant 1's desktop seed,
    // if create_db.sql seeded one) minus oldShopId.
    expect(
      allTenantIds.some((id) => id !== 1 && id !== oldShopId),
    ).toBe(false);
  });
});
