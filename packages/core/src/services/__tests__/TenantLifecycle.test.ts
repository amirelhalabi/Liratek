/**
 * Deleting and renaming a tenant.
 *
 * This is the only operation in the product with no undo, so the tests are
 * weighted towards what must NOT happen:
 *
 *   - tenant 1 is undeletable, full stop;
 *   - a wrong (or absent) confirmation slug deletes nothing;
 *   - a delete is all-or-nothing and leaves no rows behind in ANY table;
 *   - one tenant's delete never touches another's data.
 *
 * A real in-memory database, because the behaviour under test IS the SQL: the
 * dynamic table discovery, `defer_foreign_keys`, and the transaction. Mocks
 * would only confirm I called my own methods.
 */

import Database from "better-sqlite3";
import { TenantRepository } from "../../repositories/TenantRepository.js";
import { UserRepository } from "../../repositories/UserRepository.js";
import { SubscriptionRepository } from "../../repositories/SubscriptionRepository.js";
import { TenantProvisioningService } from "../TenantProvisioningService.js";

/**
 * A miniature of the real schema: two tenant-scoped tables that reference each
 * other, so `defer_foreign_keys` is actually exercised rather than assumed.
 */
function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      contact_name TEXT, contact_phone TEXT, notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id),
      name TEXT
    );
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id),
      -- The circular-ish reference that makes delete ORDER impossible to get
      -- right by hand, and defer_foreign_keys necessary.
      client_id INTEGER REFERENCES clients(id),
      amount REAL
    );
    CREATE TABLE tenant_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id),
      plan TEXT, status TEXT, current_period_end DATETIME,
      grace_ends_at DATETIME, license_key TEXT, entitled_modules TEXT,
      notes TEXT, created_at DATETIME, updated_at DATETIME
    );
    -- NOT tenant-scoped: must survive untouched.
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT);

    INSERT INTO tenants (id, name, slug) VALUES
      (1, 'Default', 'default'),
      (2, 'Doomed Shop', 'doomed'),
      (3, 'Innocent Shop', 'innocent');
    INSERT INTO clients (tenant_id, name) VALUES (2,'A'), (2,'B'), (3,'C');
    INSERT INTO transactions (tenant_id, client_id, amount) VALUES
      (2, 1, 10), (2, 2, 20), (3, 3, 30);
    INSERT INTO tenant_subscriptions (tenant_id, plan, status) VALUES
      (2,'standard','active'), (3,'standard','active');
    INSERT INTO schema_migrations (version, name) VALUES (1,'init');
  `);
  return db;
}

let db: Database.Database;
let tenants: TenantRepository;
let service: TenantProvisioningService;

const count = (table: string, tenantId?: number): number => {
  const sql =
    tenantId === undefined
      ? `SELECT COUNT(*) AS c FROM ${table}`
      : `SELECT COUNT(*) AS c FROM ${table} WHERE tenant_id = ${tenantId}`;
  return (db.prepare(sql).get() as { c: number }).c;
};

beforeEach(() => {
  db = createTestDb();
  tenants = new TenantRepository(db);
  service = new TenantProvisioningService(
    tenants,
    // Never reached on these paths; UserRepository resolves its own connection
    // and cannot be pointed at this database.
    {} as unknown as UserRepository,
    new SubscriptionRepository(db),
  );
});

afterEach(() => db.close());

describe("guards — what must NOT be possible", () => {
  it("REFUSES to delete tenant 1, even with the right slug", () => {
    expect(() => service.deleteTenant(1, "default")).toThrow(/cannot be deleted/i);
    expect(count("tenants")).toBe(3);
  });

  it("refuses a wrong confirmation slug and deletes nothing", () => {
    expect(() => service.deleteTenant(2, "wrong")).toThrow(/does not match/i);
    expect(count("tenants")).toBe(3);
    expect(count("clients", 2)).toBe(2);
  });

  it("refuses an EMPTY confirmation", () => {
    expect(() => service.deleteTenant(2, "")).toThrow(/does not match/i);
    expect(count("tenants")).toBe(3);
  });

  it("refuses a tenant that does not exist", () => {
    expect(() => service.deleteTenant(999, "whatever")).toThrow(/No tenant/i);
  });

  it("the confirmation is case-sensitive — no near misses", () => {
    expect(() => service.deleteTenant(2, "DOOMED")).toThrow(/does not match/i);
    expect(count("tenants")).toBe(3);
  });
});

describe("a real delete", () => {
  it("removes the tenant and every row it owned", () => {
    const result = service.deleteTenant(2, "doomed");

    expect(count("tenants")).toBe(2);
    expect(count("clients", 2)).toBe(0);
    expect(count("transactions", 2)).toBe(0);
    expect(count("tenant_subscriptions", 2)).toBe(0);
    expect(result.rowsDeleted).toBe(5); // 2 clients + 2 transactions + 1 sub
  });

  it("leaves OTHER tenants completely untouched", () => {
    service.deleteTenant(2, "doomed");

    expect(count("clients", 3)).toBe(1);
    expect(count("transactions", 3)).toBe(1);
    expect(count("tenant_subscriptions", 3)).toBe(1);
    expect(tenants.getById(3)?.slug).toBe("innocent");
    expect(tenants.getById(1)?.slug).toBe("default");
  });

  it("does not touch tables without a tenant_id", () => {
    service.deleteTenant(2, "doomed");
    // schema_migrations is not tenant data; wiping it would be catastrophic
    // and completely silent.
    expect(count("schema_migrations")).toBe(1);
  });

  it("discovers the scoped tables from the SCHEMA, not a list", () => {
    // A table added later must be cleaned without anyone remembering to
    // update a constant — this is the whole reason discovery is dynamic.
    db.exec(`
      CREATE TABLE brand_new_feature (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        value TEXT
      );
      INSERT INTO brand_new_feature (tenant_id, value) VALUES (2,'x'), (3,'y');
    `);

    service.deleteTenant(2, "doomed");

    expect(count("brand_new_feature", 2)).toBe(0);
    expect(count("brand_new_feature", 3)).toBe(1);
  });

  it("survives foreign keys being ON", () => {
    // clients <- transactions means no single delete order works; the pragma
    // defers the checks to COMMIT. Without it this throws FOREIGN KEY.
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(() => service.deleteTenant(2, "doomed")).not.toThrow();
  });

  it("restores FK enforcement afterwards", () => {
    service.deleteTenant(2, "doomed");
    // defer_foreign_keys is transaction-scoped; if it leaked, later writes
    // would silently accept dangling references.
    expect(() =>
      db.prepare("INSERT INTO clients (tenant_id, name) VALUES (999, 'z')").run(),
    ).toThrow(/FOREIGN KEY/i);
  });
});

describe("renaming a slug", () => {
  it("changes it and leaves everything else alone", () => {
    const updated = service.changeTenantSlug(2, "doomed-renamed");

    expect(updated.slug).toBe("doomed-renamed");
    expect(updated.name).toBe("Doomed Shop");
    expect(count("clients", 2)).toBe(2);
  });

  it("normalises case and whitespace", () => {
    expect(service.changeTenantSlug(2, "  MixedCase  ").slug).toBe("mixedcase");
  });

  it("refuses a slug another tenant already has", () => {
    expect(() => service.changeTenantSlug(2, "innocent")).toThrow(/already taken/i);
    expect(tenants.getById(2)?.slug).toBe("doomed");
  });

  it("refuses a RESERVED slug — a rename must not claim what signup cannot", () => {
    expect(() => service.changeTenantSlug(2, "admin")).toThrow();
    expect(tenants.getById(2)?.slug).toBe("doomed");
  });

  it("refuses an invalid charset", () => {
    expect(() => service.changeTenantSlug(2, "Not A Slug!")).toThrow();
  });

  it("renaming to the SAME slug is a no-op, not a conflict", () => {
    // Otherwise the uniqueness check would reject the tenant's own slug.
    expect(service.changeTenantSlug(2, "doomed").slug).toBe("doomed");
  });

  it("refuses a tenant that does not exist", () => {
    expect(() => service.changeTenantSlug(999, "whatever")).toThrow(/No tenant/i);
  });
});
