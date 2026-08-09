/**
 * LIRA-112 (COMMISSION_AT_SETTLEMENT_PLAN.md §6 D12) — `suppliers.
 * commission_eligible`/`commission_rate_currency` (v151) round-trip through
 * `listSuppliers()`, and `createSupplier()`'s provider-keyed default
 * (`defaultCommissionConfigForProvider`) — the mechanism that makes a
 * BRAND-NEW tenant's iPick/Katsh suppliers correct from the moment they're
 * added (checked: `TenantRepository.seedConfig` deliberately excludes the
 * sample suppliers rows as "sample data, not config", so `createSupplier`
 * is the only path that creates one for a fresh tenant).
 *
 * Mirrors `SupplierRepository.listSuppliersCommissionPreference.test.ts`'s
 * fixture shape/pattern (the D8 precedent for exactly this class of bug:
 * `SupplierEntity` documented a field `getColumns()` never selected).
 */

import Database from "better-sqlite3";
import {
  SupplierRepository,
  resetSupplierRepository,
  defaultCommissionConfigForProvider,
} from "../SupplierRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE suppliers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id    INTEGER NOT NULL DEFAULT 1,
      name         TEXT NOT NULL,
      contact_name TEXT,
      phone        TEXT,
      note         TEXT,
      provider     TEXT,
      is_system    INTEGER NOT NULL DEFAULT 0,
      is_active    INTEGER NOT NULL DEFAULT 1,
      module_key   TEXT,
      commission_entry_mode TEXT CHECK(commission_entry_mode IN ('LUMP', 'RATE')) DEFAULT 'LUMP',
      commission_rate REAL,
      commission_eligible INTEGER CHECK(commission_eligible IN (0, 1)),
      commission_rate_currency TEXT CHECK(commission_rate_currency IN ('USD', 'LBP')),
      created_at   TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE system_settings (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL DEFAULT 1,
      key_name  TEXT NOT NULL,
      value     TEXT
    );
  `);
  return db;
}

// Mirrors `FinancialServiceRepository.pendingSettlementPredicate.test.ts`'s
// `jest.mock("../../db/connection", ...)` shape — `SupplierRepository`
// itself reads via `getDatabase()`, not the `__LIRATEK_TEST_DB__` global
// used by the D8 precedent file (that one is an older convention this repo
// no longer wires up by default); `createSupplier`/`listSuppliers`
// exercised here both go through `this.db`, set via the mocked module.
jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("Test DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

describe("SupplierRepository — LIRA-112 commission_eligible/commission_rate_currency", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    initFixedTenantContext(1);
    resetSupplierRepository();
    repo = new SupplierRepository();
  });

  afterEach(() => {
    db.close();
    resetSupplierRepository();
    resetTenantContext();
  });

  describe("listSuppliers() round-trip", () => {
    it("round-trips a seeded ineligible iPick supplier", () => {
      db.prepare(
        `INSERT INTO suppliers (id, name, provider, commission_eligible, commission_rate_currency)
         VALUES (1, 'iPick', 'iPick', 0, 'USD')`,
      ).run();

      const supplier = repo.listSuppliers().find((s) => s.id === 1);
      expect(supplier).toBeDefined();
      expect(supplier!.commission_eligible).toBe(0);
      expect(supplier!.commission_rate_currency).toBe("USD");
    });

    it("round-trips a seeded eligible Katsh supplier (RATE/20000/LBP)", () => {
      db.prepare(
        `INSERT INTO suppliers (id, name, provider, commission_entry_mode, commission_rate, commission_eligible, commission_rate_currency)
         VALUES (2, 'Katsh', 'Katsh', 'RATE', 20000, 1, 'LBP')`,
      ).run();

      const supplier = repo.listSuppliers().find((s) => s.id === 2);
      expect(supplier).toBeDefined();
      expect(supplier!.commission_entry_mode).toBe("RATE");
      expect(supplier!.commission_rate).toBe(20000);
      expect(supplier!.commission_eligible).toBe(1);
      expect(supplier!.commission_rate_currency).toBe("LBP");
    });

    it("COALESCEs a NULL (pre-v151) commission_eligible to 1 and commission_rate_currency to 'USD'", () => {
      db.prepare(
        `INSERT INTO suppliers (id, name, provider, commission_eligible, commission_rate_currency)
         VALUES (3, 'OMT', 'OMT', NULL, NULL)`,
      ).run();

      const supplier = repo.listSuppliers().find((s) => s.id === 3);
      expect(supplier).toBeDefined();
      expect(supplier!.commission_eligible).toBe(1);
      expect(supplier!.commission_rate_currency).toBe("USD");
    });
  });

  describe("createSupplier() — provider-keyed defaults (LIRA-112 D12)", () => {
    it("a brand-new iPick supplier is created commission_eligible = 0 (no commission, ever)", () => {
      const { id } = repo.createSupplier({ name: "iPick", provider: "iPick" });
      const supplier = repo.listSuppliers().find((s) => s.id === id);
      expect(supplier!.commission_eligible).toBe(0);
      expect(supplier!.commission_entry_mode).toBe("LUMP");
      expect(supplier!.commission_rate).toBeNull();
      expect(supplier!.commission_rate_currency).toBe("USD");
    });

    it("a brand-new Katsh supplier is created commission_eligible = 1, RATE, 20000, LBP", () => {
      const { id } = repo.createSupplier({ name: "Katsh", provider: "Katsh" });
      const supplier = repo.listSuppliers().find((s) => s.id === id);
      expect(supplier!.commission_eligible).toBe(1);
      expect(supplier!.commission_entry_mode).toBe("RATE");
      expect(supplier!.commission_rate).toBe(20000);
      expect(supplier!.commission_rate_currency).toBe("LBP");
    });

    it("a brand-new supplier for any OTHER provider defaults to eligible/LUMP/no preset rate (v150's shipped default, unchanged)", () => {
      const { id } = repo.createSupplier({
        name: "Some New Provider",
        provider: "SOME_NEW_PROVIDER",
      });
      const supplier = repo.listSuppliers().find((s) => s.id === id);
      expect(supplier!.commission_eligible).toBe(1);
      expect(supplier!.commission_entry_mode).toBe("LUMP");
      expect(supplier!.commission_rate).toBeNull();
      expect(supplier!.commission_rate_currency).toBe("USD");
    });

    it("createSupplier() does not throw against a MINIMAL suppliers table (pre-v151 schema drift guard)", () => {
      const minimalDb = new Database(":memory:");
      minimalDb.exec(`
        CREATE TABLE suppliers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL DEFAULT 1,
          name TEXT NOT NULL,
          contact_name TEXT,
          phone TEXT,
          note TEXT,
          provider TEXT,
          is_system INTEGER NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 1,
          module_key TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `);
      setDb(minimalDb);
      resetSupplierRepository();
      const minimalRepo = new SupplierRepository();

      expect(() =>
        minimalRepo.createSupplier({ name: "iPick", provider: "iPick" }),
      ).not.toThrow();

      minimalDb.close();
    });
  });

  describe("defaultCommissionConfigForProvider — pure function (rule 14, the ONE definition)", () => {
    it("iPick -> ineligible, LUMP, no rate, USD", () => {
      expect(defaultCommissionConfigForProvider("iPick")).toEqual({
        commission_eligible: 0,
        commission_entry_mode: "LUMP",
        commission_rate: null,
        commission_rate_currency: "USD",
      });
    });

    it("Katsh -> eligible, RATE, 20000, LBP", () => {
      expect(defaultCommissionConfigForProvider("Katsh")).toEqual({
        commission_eligible: 1,
        commission_entry_mode: "RATE",
        commission_rate: 20000,
        commission_rate_currency: "LBP",
      });
    });

    it.each([undefined, null, "", "OMT", "WHISH", "SOME_FUTURE_PROVIDER"])(
      "%s -> the v150 shipped default (eligible, LUMP, no preset rate, USD)",
      (provider) => {
        expect(defaultCommissionConfigForProvider(provider)).toEqual({
          commission_eligible: 1,
          commission_entry_mode: "LUMP",
          commission_rate: null,
          commission_rate_currency: "USD",
        });
      },
    );
  });
});
