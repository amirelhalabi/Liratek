/**
 * Every shop must own the system suppliers (OMT, Whish, iPick, Katsh, the app
 * wallets, Loto Liban) — the modules look them up by `provider`, per tenant.
 *
 * Desktop installs and tenant 1 get them from electron-app/create_db.sql.
 * Web-provisioned tenants did not: `TenantRepository.seedConfig` skipped them
 * as "sample data", so a shop created on the web (test.liratek.shop, tenant 5)
 * opened with an empty Suppliers page and no OMT account to settle against.
 *
 * Two fixes, one definition:
 *   - `seedConfig` seeds them for every NEW tenant;
 *   - migration v191 backfills every EXISTING tenant that lacks them.
 *
 * The reference set is create_db.sql's own tenant-1 seed, read from the real
 * file, so the web seed cannot drift from the desktop one.
 *
 * Written failing-first (CLAUDE.md rule 17): run against the unfixed code
 * before the seed helper, the seedConfig call or v191 existed.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import { TenantRepository } from "../../repositories/TenantRepository.js";
import { MIGRATIONS } from "../migrations/index.js";

const SCHEMA = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "..",
    "electron-app",
    "create_db.sql",
  ),
  "utf-8",
);

interface SupplierShape {
  name: string;
  provider: string | null;
  module_key: string | null;
  is_system: number;
  is_active: number;
  commission_eligible: number;
  commission_entry_mode: string;
  commission_rate: number | null;
  commission_rate_currency: string;
  parent_provider: string | null;
}

function suppliersOf(db: Database.Database, tenantId: number): SupplierShape[] {
  return db
    .prepare(
      `SELECT s.name, s.provider, s.module_key, s.is_system, s.is_active,
              s.commission_eligible, s.commission_entry_mode,
              s.commission_rate, s.commission_rate_currency,
              p.provider AS parent_provider
         FROM suppliers s
         LEFT JOIN suppliers p ON p.id = s.account_supplier_id
        WHERE s.tenant_id = ?
        ORDER BY s.provider`,
    )
    .all(tenantId) as SupplierShape[];
}

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  db.pragma("foreign_keys = OFF");
  return db;
}

function addTenant(db: Database.Database, id: number, slug: string): void {
  db.prepare(
    `INSERT INTO tenants (id, name, slug, status) VALUES (?, ?, ?, 'active')`,
  ).run(id, slug, slug);
}

describe("system suppliers for a web-provisioned tenant", () => {
  it("seedConfig gives a new tenant exactly create_db.sql's tenant-1 suppliers", () => {
    const db = freshDb();
    addTenant(db, 5, "test");

    new TenantRepository(db).seedConfig(5, "Test");

    const reference = suppliersOf(db, 1);
    expect(reference.length).toBe(7); // sanity: the fixture is the real seed
    expect(suppliersOf(db, 5)).toEqual(reference);
    db.close();
  });

  it("links iPick and OMT App to the new tenant's OWN OMT row", () => {
    const db = freshDb();
    addTenant(db, 5, "test");

    new TenantRepository(db).seedConfig(5, "Test");

    const crossTenantLinks = db
      .prepare(
        `SELECT COUNT(*) AS c FROM suppliers s
           JOIN suppliers p ON p.id = s.account_supplier_id
          WHERE s.tenant_id <> p.tenant_id`,
      )
      .get() as { c: number };
    expect(crossTenantLinks.c).toBe(0);
    db.close();
  });
});

describe("migration v191 — backfill system suppliers", () => {
  const v191 = () => MIGRATIONS.find((m) => m.version === 191);

  it("exists", () => {
    expect(v191()).toBeDefined();
  });

  it("adds the missing suppliers to a tenant that has only some of them", () => {
    const db = freshDb();
    addTenant(db, 5, "test");
    // A real web tenant has its module rows (seedConfig.seedModules).
    db.prepare(
      `INSERT INTO modules (tenant_id, key, label, icon, route, sort_order, is_enabled, admin_only, is_system)
       SELECT 5, key, label, icon, route, sort_order, is_enabled, admin_only, is_system
         FROM modules WHERE tenant_id = 1`,
    ).run();
    // Tenant 5's real-world shape: Loto Liban created lazily by a Loto sale,
    // plus one supplier the owner added by hand.
    db.prepare(
      `INSERT INTO suppliers (tenant_id, name, provider, is_active, is_system)
       VALUES (5, 'Loto Liban', 'LOTO', 1, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO suppliers (tenant_id, name, is_active, is_system)
       VALUES (5, 'Phone wholesaler', 1, 0)`,
    ).run();

    v191()!.up(db);

    const tenant5 = suppliersOf(db, 5);
    const systemOnly = tenant5.filter((s) => s.provider !== null);
    expect(systemOnly).toEqual(suppliersOf(db, 1));
    // The hand-added supplier is untouched; Loto Liban is not duplicated.
    expect(tenant5.filter((s) => s.name === "Phone wholesaler")).toHaveLength(
      1,
    );
    expect(tenant5.filter((s) => s.provider === "LOTO")).toHaveLength(1);
    db.close();
  });

  it("leaves a tenant that already has them unchanged — a deactivated one, a detached child", () => {
    const db = freshDb();
    db.prepare(
      `UPDATE suppliers SET is_active = 0 WHERE tenant_id = 1 AND provider = 'WHISH'`,
    ).run();
    // An admin detached iPick from the OMT account (LIRA-191) — must stay so.
    db.prepare(
      `UPDATE suppliers SET account_supplier_id = NULL WHERE tenant_id = 1 AND provider = 'iPick'`,
    ).run();
    const before = suppliersOf(db, 1);

    v191()!.up(db);

    expect(suppliersOf(db, 1)).toEqual(before);
    db.close();
  });

  it("skips a provider whose NAME the tenant already uses, instead of crashing", () => {
    const db = freshDb();
    addTenant(db, 5, "test");
    // suppliers is UNIQUE (tenant_id, name): a hand-added "OMT" would make a
    // blind INSERT throw and take the boot-time migration down with it.
    db.prepare(
      `INSERT INTO suppliers (tenant_id, name, is_active, is_system) VALUES (5, 'OMT', 1, 0)`,
    ).run();

    expect(() => v191()!.up(db)).not.toThrow();

    const tenant5 = suppliersOf(db, 5);
    expect(tenant5.filter((s) => s.name.toLowerCase() === "omt")).toHaveLength(
      1,
    );
    expect(tenant5.filter((s) => s.provider !== null)).toHaveLength(6);
    db.close();
  });

  it("leaves module_key NULL when the tenant has no such module row (FK-safe)", () => {
    const db = freshDb();
    addTenant(db, 5, "test"); // no modules rows seeded for tenant 5
    db.pragma("foreign_keys = ON");

    v191()!.up(db);

    expect(db.pragma("foreign_key_check") as unknown[]).toEqual([]);
    expect(suppliersOf(db, 5).every((s) => s.module_key === null)).toBe(true);
    db.close();
  });

  it("is idempotent", () => {
    const db = freshDb();
    addTenant(db, 5, "test");

    v191()!.up(db);
    const once = suppliersOf(db, 5);
    v191()!.up(db);

    expect(suppliersOf(db, 5)).toEqual(once);
    expect(once.length).toBe(7);
    db.close();
  });
});
