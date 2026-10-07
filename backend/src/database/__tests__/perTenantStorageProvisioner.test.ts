/**
 * `createPerTenantStorageProvisioner()` — the per-tenant-mode
 * `TenantStorageProvisioner` implementation (Phase C, `docs/plans/
 * ongoing_plans/PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 12.2/12.3, table
 * rows #9/#10).
 *
 * Real `better-sqlite3` throughout (subpath import escapes the
 * `moduleNameMapper` mock, matching `wp5_wp6_admin_tenant.api.test.ts`), a
 * REAL temp directory, the REAL `electron-app/create_db.sql`, and the REAL
 * `runMigrations`/`TenantRepository`/`SubscriptionRepository`/
 * `TenantDatabasePool` from `@liratek/core` (which backend jest maps to
 * SOURCE, not a mock) — a mock of any of these would only prove this module
 * calls its dependencies, not that a real provisioning attempt produces a
 * correct, loadable shop file.
 *
 * This is brand-new capability (Phase C did not exist before this change),
 * so per CLAUDE.md rule 17 these are NOT "proven failing-first" against a
 * prior broken implementation — there is no prior implementation.
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
  type TenantEntity,
} from "@liratek/core";
import { createPerTenantStorageProvisioner } from "../perTenantStorageProvisioner.js";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../electron-app/create_db.sql"),
  "utf8",
);

function makeTmpTenantsDir(): string {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), "liratek-per-tenant-provisioner-"),
  );
}

function configureConnection(db: InstanceType<typeof DatabaseCtor>): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
}

describe("createPerTenantStorageProvisioner", () => {
  let tenantsDir: string;
  let platformDb: InstanceType<typeof DatabaseCtor>;
  let platformTenantRepo: TenantRepository;
  let platformSubscriptionRepo: SubscriptionRepository;
  let pool: TenantDatabasePool;
  let provisioner: ReturnType<typeof createPerTenantStorageProvisioner>;

  beforeEach(() => {
    tenantsDir = makeTmpTenantsDir();

    platformDb = new RealDatabase(":memory:");
    platformDb.pragma("foreign_keys = ON");
    platformDb.exec(CREATE_DB_SQL);
    // The platform db's own fresh-install seed (tenant 1 "Default") is
    // irrelevant noise for these tests but harmless to leave in place —
    // every assertion below targets the NEWLY provisioned tenant's own id.

    platformTenantRepo = new TenantRepository(platformDb);
    platformSubscriptionRepo = new SubscriptionRepository(platformDb);

    pool = new TenantDatabasePool({
      dir: tenantsDir,
      openDatabase: (fp) => new RealDatabase(fp) as unknown as DatabaseCtor,
      migrate: (db) => runMigrations(db as unknown as Parameters<typeof runMigrations>[0]),
    });

    provisioner = createPerTenantStorageProvisioner({
      tenantsDir,
      pool,
      openRawDatabase: (fp) => new RealDatabase(fp) as unknown as DatabaseCtor,
      configureConnection: (db) =>
        configureConnection(db as unknown as InstanceType<typeof DatabaseCtor>),
      runMigrations: (db) => runMigrations(db as unknown as Parameters<typeof runMigrations>[0]),
      createDbSql: CREATE_DB_SQL,
      platformTenantRepo,
      platformSubscriptionRepo,
      clock: () => new Date("2026-09-27T12:00:00.000Z"),
    });
  });

  afterEach(() => {
    pool.closeAll();
    platformDb.close();
    fs.rmSync(tenantsDir, { recursive: true, force: true });
  });

  describe("createTenant — the happy path", () => {
    it("builds a shop file with exactly one local tenants row, no tenant_subscriptions rows, and the admin seeded", () => {
      const created = provisioner.createTenant({
        name: "Corner Tech",
        slug: "cornertech",
        contactName: null,
        contactPhone: null,
        notes: null,
        adminUsername: "admin",
        passwordHash: "hashed-password-value",
      });

      expect(created.status).toBe("active");
      expect(created.slug).toBe("cornertech");

      const finalPath = path.join(tenantsDir, `${created.id}.db`);
      expect(fs.existsSync(finalPath)).toBe(true);
      // No stray temp file left behind.
      const entries = fs.readdirSync(tenantsDir);
      expect(entries).toEqual([`${created.id}.db`]);

      // The PLATFORM row is active, and the subscription row exists there.
      const platformRow = platformTenantRepo.getById(created.id);
      expect(platformRow?.status).toBe("active");
      const platformSub = platformSubscriptionRepo.getByTenantId(created.id);
      expect(platformSub).toBeTruthy();
      expect(platformSub?.status).toBe("active");

      const shopDb = new RealDatabase(finalPath, { readonly: true });
      try {
        const tenantRows = shopDb.prepare(`SELECT * FROM tenants`).all() as {
          id: number;
          name: string;
          slug: string;
          status: string;
        }[];
        expect(tenantRows).toHaveLength(1);
        expect(tenantRows[0].id).toBe(created.id);
        expect(tenantRows[0].name).toBe("Corner Tech");
        expect(tenantRows[0].slug).toBe("cornertech");
        expect(tenantRows[0].status).toBe("active");

        const subRows = shopDb.prepare(`SELECT * FROM tenant_subscriptions`).all();
        expect(subRows).toHaveLength(0);

        const users = shopDb.prepare(`SELECT * FROM users`).all() as {
          username: string;
          password_hash: string;
          role: string;
          tenant_id: number;
          is_active: number;
        }[];
        expect(users).toHaveLength(1);
        expect(users[0].username).toBe("admin");
        expect(users[0].password_hash).toBe("hashed-password-value");
        expect(users[0].role).toBe("admin");
        expect(users[0].tenant_id).toBe(created.id);
        expect(users[0].is_active).toBe(1);

        const fkViolations = shopDb.pragma("foreign_key_check");
        expect(fkViolations).toEqual([]);

        // seedConfig actually ran — spot-check one table it seeds.
        const currencies = shopDb
          .prepare(`SELECT COUNT(*) AS c FROM currencies WHERE tenant_id = ?`)
          .get(created.id) as { c: number };
        expect(currencies.c).toBeGreaterThan(0);
      } finally {
        shopDb.close();
      }
    });

    // LIRA-267. NOT proven failing-first (rule 17): the passthrough was
    // written in the same change as the core test that drove it, before this
    // backend case existed.
    it("stores contactEmail on the platform row AND the shop file's local tenants row", () => {
      const created = provisioner.createTenant({
        name: "Mail Shop",
        slug: "mailshop",
        contactName: null,
        contactPhone: null,
        notes: null,
        contactEmail: "owner@example.com",
        adminUsername: "admin",
        passwordHash: "hashed-password-value",
      });

      expect(platformTenantRepo.getById(created.id)?.contact_email).toBe(
        "owner@example.com",
      );
      const shopDb = new RealDatabase(
        path.join(tenantsDir, `${created.id}.db`),
        { readonly: true },
      );
      try {
        const row = shopDb
          .prepare(`SELECT contact_email FROM tenants WHERE id = ?`)
          .get(created.id) as { contact_email: string | null };
        expect(row.contact_email).toBe("owner@example.com");
      } finally {
        shopDb.close();
      }
    });

    // v197 (LIRA-280). NOT proven failing-first (rule 17): written after the
    // passthrough, in the integration pass, to cover the middle of the
    // route -> provisioner -> platform row chain the daily cap counts on.
    it("stores googleSignupAt on the PLATFORM row (what the public sign-up cap counts)", () => {
      const at = "2026-10-07T12:00:00.000Z";
      const google = provisioner.createTenant({
        name: "Google Shop",
        slug: "googleshop",
        contactName: null,
        contactPhone: null,
        notes: null,
        contactEmail: "g@example.com",
        googleSignupAt: at,
        adminUsername: "admin",
        passwordHash: "hashed-password-value",
      });
      const plain = provisioner.createTenant({
        name: "Plain Shop",
        slug: "plainshop",
        contactName: null,
        contactPhone: null,
        notes: null,
        adminUsername: "admin",
        passwordHash: "hashed-password-value",
      });
      expect(platformTenantRepo.getById(google.id)?.google_signup_at).toBe(at);
      expect(platformTenantRepo.getById(plain.id)?.google_signup_at).toBeNull();
    });

    it("links the shop file's admin user to the sign-up email, with the verified stamp (v196)", () => {
      const proven = "2026-10-07T12:00:00.000Z";
      const created = provisioner.createTenant({
        name: "Linked Shop",
        slug: "linkedshop",
        contactName: null,
        contactPhone: null,
        notes: null,
        contactEmail: "owner@example.com",
        adminEmailVerifiedAt: proven,
        adminUsername: "admin",
        passwordHash: "hashed-password-value",
      });
      const shopDb = new RealDatabase(
        path.join(tenantsDir, `${created.id}.db`),
        { readonly: true },
      );
      try {
        const row = shopDb
          .prepare(
            `SELECT email, email_verified_at FROM users WHERE tenant_id = ? AND username = 'admin'`,
          )
          .get(created.id) as { email: string | null; email_verified_at: string | null };
        expect(row).toEqual({
          email: "owner@example.com",
          email_verified_at: proven,
        });
      } finally {
        shopDb.close();
      }
    });

    it("refuses a duplicate contactEmail with EMAIL_ALREADY_HAS_SHOP and leaves no file or platform row", () => {
      provisioner.createTenant({
        name: "First",
        slug: "firstshop",
        contactName: null,
        contactPhone: null,
        notes: null,
        contactEmail: "owner@example.com",
        adminUsername: "admin",
        passwordHash: "hashed-password-value",
      });
      const filesBefore = fs.readdirSync(tenantsDir).sort();

      let caught: unknown;
      try {
        provisioner.createTenant({
          name: "Second",
          slug: "secondshop",
          contactName: null,
          contactPhone: null,
          notes: null,
          contactEmail: "owner@example.com",
          adminUsername: "admin",
          passwordHash: "hashed-password-value",
        });
      } catch (error) {
        caught = error;
      }
      expect((caught as { code?: string } | undefined)?.code).toBe(
        "EMAIL_ALREADY_HAS_SHOP",
      );
      expect(platformTenantRepo.getBySlug("secondshop")).toBeNull();
      expect(fs.readdirSync(tenantsDir).sort()).toEqual(filesBefore);
    });

    it("is idempotent-safe for the migration bookkeeping (schema_migrations fully populated)", () => {
      const created = provisioner.createTenant({
        name: "Second Shop",
        slug: "secondshop",
        contactName: null,
        contactPhone: null,
        notes: null,
        adminUsername: "admin2",
        passwordHash: "h2",
      });
      const finalPath = path.join(tenantsDir, `${created.id}.db`);
      const shopDb = new RealDatabase(finalPath, { readonly: true });
      try {
        const migrations = shopDb
          .prepare(`SELECT COUNT(*) AS c FROM schema_migrations`)
          .get() as { c: number };
        expect(migrations.c).toBeGreaterThan(0);
      } finally {
        shopDb.close();
      }
    });
  });

  describe("createTenant — failure cleans up completely", () => {
    it("leaves NO file and NO platform rows when the shop-file build fails", () => {
      const failingProvisioner = createPerTenantStorageProvisioner({
        tenantsDir,
        pool,
        openRawDatabase: (fp) => new RealDatabase(fp) as unknown as DatabaseCtor,
        configureConnection: (db) =>
          configureConnection(db as unknown as InstanceType<typeof DatabaseCtor>),
        runMigrations: () => {
          throw new Error("simulated migration failure");
        },
        createDbSql: CREATE_DB_SQL,
        platformTenantRepo,
        platformSubscriptionRepo,
      });

      expect(() =>
        failingProvisioner.createTenant({
          name: "Doomed Shop",
          slug: "doomedshop",
          contactName: null,
          contactPhone: null,
          notes: null,
          adminUsername: "admin",
          passwordHash: "h",
        }),
      ).toThrow(/simulated migration failure/);

      // Nothing on disk — neither a temp file nor a final one.
      expect(fs.readdirSync(tenantsDir)).toEqual([]);

      // Nothing in the platform registry either.
      expect(platformTenantRepo.getBySlug("doomedshop")).toBeNull();
      const orphanSubs = platformDb
        .prepare(
          `SELECT COUNT(*) AS c FROM tenant_subscriptions s
             WHERE NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = s.tenant_id)`,
        )
        .get() as { c: number };
      expect(orphanSubs.c).toBe(0);
    });

    it("also cleans up a rename that succeeded before a later failure", () => {
      // Simulates a crash between "renamed into place" and "status flipped
      // to active" — the update() call is what fails here.
      let updateCalls = 0;
      const flakyTenantRepo: typeof platformTenantRepo = Object.create(
        platformTenantRepo,
      );
      flakyTenantRepo.update = ((id: number, data: { status: string }) => {
        updateCalls += 1;
        if (data.status === "active") {
          throw new Error("simulated post-rename crash");
        }
        return platformTenantRepo.update(id, data as never);
      }) as typeof platformTenantRepo.update;

      const crashProvisioner = createPerTenantStorageProvisioner({
        tenantsDir,
        pool,
        openRawDatabase: (fp) => new RealDatabase(fp) as unknown as DatabaseCtor,
        configureConnection: (db) =>
          configureConnection(db as unknown as InstanceType<typeof DatabaseCtor>),
        runMigrations: (db) => runMigrations(db as unknown as Parameters<typeof runMigrations>[0]),
        createDbSql: CREATE_DB_SQL,
        platformTenantRepo: flakyTenantRepo,
        platformSubscriptionRepo,
      });

      expect(() =>
        crashProvisioner.createTenant({
          name: "Half Shop",
          slug: "halfshop",
          contactName: null,
          contactPhone: null,
          notes: null,
          adminUsername: "admin",
          passwordHash: "h",
        }),
      ).toThrow(/simulated post-rename crash/);

      expect(updateCalls).toBeGreaterThan(0);
      expect(fs.readdirSync(tenantsDir)).toEqual([]);
      expect(platformTenantRepo.getBySlug("halfshop")).toBeNull();
    });
  });

  describe("deleteTenant", () => {
    function createOne(slug: string): TenantEntity {
      return provisioner.createTenant({
        name: "To Delete",
        slug,
        contactName: null,
        contactPhone: null,
        notes: null,
        adminUsername: "admin",
        passwordHash: "h",
      });
    }

    it("archives the file and removes the platform rows", () => {
      const created = createOne("todelete");
      const finalPath = path.join(tenantsDir, `${created.id}.db`);
      expect(fs.existsSync(finalPath)).toBe(true);

      const result = provisioner.deleteTenant(created);

      expect(fs.existsSync(finalPath)).toBe(false);
      const archivePath = path.join(
        tenantsDir,
        "archive",
        `${created.id}-2026-09-27T12-00-00-000Z.db`,
      );
      expect(fs.existsSync(archivePath)).toBe(true);

      expect(platformTenantRepo.getById(created.id)).toBeNull();
      expect(platformSubscriptionRepo.getByTenantId(created.id)).toBeNull();

      expect(result.tablesCleared).toBeGreaterThan(0);
      expect(result.rowsDeleted).toBeGreaterThan(0);

      // The archived file itself must still be a valid, complete copy.
      const archived = new RealDatabase(archivePath, { readonly: true });
      try {
        const users = archived.prepare(`SELECT COUNT(*) AS c FROM users`).get() as {
          c: number;
        };
        expect(users.c).toBe(1);
      } finally {
        archived.close();
      }
    });

    it("throws (and touches NOTHING) when the tenant has no database file", () => {
      const fakeTenant: TenantEntity = {
        id: 999999,
        name: "Ghost",
        slug: "ghost",
        status: "active",
        contact_name: null,
        contact_phone: null,
        notes: null,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      };

      expect(() => provisioner.deleteTenant(fakeTenant)).toThrow(
        /no database file/i,
      );
      expect(fs.existsSync(path.join(tenantsDir, "archive"))).toBe(false);
    });

    it("evicts a pooled connection before archiving (no dangling handle survives)", () => {
      const created = createOne("evictme");
      // Force the pool to actually open (and cache) this tenant's connection.
      pool.get(created.id);
      expect(pool.openCount()).toBe(1);

      provisioner.deleteTenant(created);

      expect(pool.openCount()).toBe(0);
    });
  });
});
