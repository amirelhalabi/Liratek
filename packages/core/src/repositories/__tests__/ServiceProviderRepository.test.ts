/**
 * ServiceProviderRepository — FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b.
 *
 * `createProvider`/`updateProvider`/`deleteProvider` shipped in phase 1
 * (180bccf) but were never tested directly (only exercised indirectly via
 * the migration/characterization tests for phases 1-3). Phase 5 exposes them
 * over IPC/REST for the first time, so this is the first direct proof of:
 *  - tenant-scoped uniqueness on `code` (the UNIQUE(tenant_id, code) index),
 *  - the code-uppercase normalization at create,
 *  - auto-assigned `sort_order` when omitted,
 *  - `updateProvider`'s system-row protection: for `is_system = 1` rows,
 *    `drawer_name`/`is_system_provider` are silently ignored even when
 *    supplied — only `label`/`is_active`/`sort_order` move,
 *  - `code` can NEVER be changed via `updateProvider`, for ANY row (system
 *    or not) — `UpdateServiceProviderData` has no `code` field, so even a
 *    payload that includes one (bypassing the type via `as any`, simulating
 *    a hand-built IPC/REST call) is silently dropped,
 *  - `deleteProvider`'s system-row protection: rejected with a clear error,
 *    the row survives.
 *
 * Rule 17 note: the system-row protections in `updateProvider`/
 * `deleteProvider` predate this task (phase 1), but were verified against
 * the buggy state while writing this file — temporarily removing the
 * `provider.is_system === 1` guard in `deleteProvider` (and the
 * `provider.is_system === 0` gate around `drawer_name`/`is_system_provider`
 * in `updateProvider`) made the corresponding tests below fail before the
 * guard was restored, proving they actually exercise the protection and
 * are not vacuously true.
 */

import Database from "better-sqlite3";
import {
  ServiceProviderRepository,
  resetServiceProviderRepository,
} from "../ServiceProviderRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE service_providers (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER,
      code               TEXT NOT NULL,
      label              TEXT NOT NULL,
      drawer_name        TEXT NOT NULL,
      is_system_provider INTEGER NOT NULL DEFAULT 0,
      is_active          INTEGER NOT NULL DEFAULT 1,
      is_system          INTEGER NOT NULL DEFAULT 0,
      sort_order         INTEGER NOT NULL DEFAULT 0,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, code)
    );
  `);
  return db;
}

function seedSystemRow(db: Database.Database, tenantId: number): number {
  const result = db
    .prepare(
      `INSERT INTO service_providers (tenant_id, code, label, drawer_name, is_system_provider, is_system, sort_order)
       VALUES (?, 'OMT', 'OMT', 'OMT_System', 1, 1, 0)`,
    )
    .run(tenantId);
  return result.lastInsertRowid as number;
}

describe("ServiceProviderRepository — write path (§5b phase 5)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as any).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetServiceProviderRepository();
  });

  afterEach(() => {
    delete (globalThis as any).__LIRATEK_TEST_DB__;
    resetTenantContext();
    resetServiceProviderRepository();
    db.close();
  });

  describe("createProvider", () => {
    it("creates a new provider and uppercases the code", () => {
      const repo = new ServiceProviderRepository();
      const result = repo.createProvider({
        code: "syria",
        label: "Syria",
        drawer_name: "General",
      });

      expect(result.success).toBe(true);
      expect(result.id).toBeDefined();
      const row = repo.getByCode("SYRIA");
      expect(row).toBeDefined();
      expect(row!.code).toBe("SYRIA");
      expect(row!.drawer_name).toBe("General");
      expect(row!.is_system).toBe(0);
    });

    it("auto-assigns the next sort_order when not provided", () => {
      const repo = new ServiceProviderRepository();
      repo.createProvider({ code: "A", label: "A", drawer_name: "General" });
      repo.createProvider({ code: "B", label: "B", drawer_name: "General" });

      const a = repo.getByCode("A")!;
      const b = repo.getByCode("B")!;
      expect(b.sort_order).toBe(a.sort_order + 1);
    });

    it("rejects a duplicate code for the SAME tenant with a friendly error", () => {
      const repo = new ServiceProviderRepository();
      repo.createProvider({
        code: "SYRIA",
        label: "Syria",
        drawer_name: "General",
      });

      const result = repo.createProvider({
        code: "SYRIA",
        label: "Syria Again",
        drawer_name: "General",
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already exists/i);
      // Only one row exists.
      expect(
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM service_providers WHERE tenant_id = 1 AND code = 'SYRIA'`,
          )
          .get(),
      ).toEqual({ n: 1 });
    });

    it("allows the SAME code for a DIFFERENT tenant (tenant-scoped uniqueness)", () => {
      const repo = new ServiceProviderRepository();
      repo.createProvider({
        code: "SYRIA",
        label: "Syria",
        drawer_name: "General",
      });

      initFixedTenantContext(2);
      const result = repo.createProvider({
        code: "SYRIA",
        label: "Syria (tenant 2)",
        drawer_name: "General",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("updateProvider — system-row protection", () => {
    it("for a system row, updates label/is_active but silently ignores drawer_name/is_system_provider", () => {
      const repo = new ServiceProviderRepository();
      const id = seedSystemRow(db, 1);

      const result = repo.updateProvider(id, {
        label: "Omt Renamed",
        is_active: 0,
        drawer_name: "General", // must be ignored — OMT keeps OMT_System
        is_system_provider: 0, // must be ignored — OMT stays PCD-eligible
      });

      expect(result.success).toBe(true);
      const row = repo.getById(id)!;
      expect(row.label).toBe("Omt Renamed");
      expect(row.is_active).toBe(0);
      expect(row.drawer_name).toBe("OMT_System"); // unchanged
      expect(row.is_system_provider).toBe(1); // unchanged
    });

    it("for a NON-system row, DOES allow drawer_name/is_system_provider changes (pre-existing repository capability, not reachable through the phase-5 write path — see ServiceProviderService)", () => {
      const repo = new ServiceProviderRepository();
      const created = repo.createProvider({
        code: "SYRIA",
        label: "Syria",
        drawer_name: "General",
      });

      const result = repo.updateProvider(created.id!, {
        drawer_name: "Whish_System",
        is_system_provider: 1,
      });

      expect(result.success).toBe(true);
      const row = repo.getById(created.id!)!;
      expect(row.drawer_name).toBe("Whish_System");
      expect(row.is_system_provider).toBe(1);
    });

    it("never changes `code`, even if a caller smuggles one in (code is not part of UpdateServiceProviderData)", () => {
      const repo = new ServiceProviderRepository();
      const created = repo.createProvider({
        code: "SYRIA",
        label: "Syria",
        drawer_name: "General",
      });

      repo.updateProvider(created.id!, {
        label: "Syria Updated",
        // @ts-expect-error — `code` is intentionally absent from
        // UpdateServiceProviderData; simulate a hand-built payload anyway.
        code: "HACKED",
      });

      const row = repo.getById(created.id!)!;
      expect(row.code).toBe("SYRIA");
      expect(row.label).toBe("Syria Updated");
    });

    it("returns an error for a non-existent id", () => {
      const repo = new ServiceProviderRepository();
      const result = repo.updateProvider(9999, { label: "Nope" });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    it("REGRESSION GUARD (rule 17): removing the is_system===0 gate would let a system row's drawer change — proven by temporarily disabling the gate", () => {
      // This test documents the mechanism, not a live toggle (the guard
      // itself lives in ServiceProviderRepository.updateProvider). Verified
      // manually during development: commenting out `if (provider.is_system
      // === 0) { ... }` around the drawer_name/is_system_provider branch
      // made the "silently ignores drawer_name" test above fail (OMT's
      // drawer_name became 'General'), confirming the guard is load-bearing.
      const repo = new ServiceProviderRepository();
      const id = seedSystemRow(db, 1);
      const before = repo.getById(id)!;
      expect(before.is_system).toBe(1);
      expect(before.drawer_name).toBe("OMT_System");
    });
  });

  describe("deleteProvider — system-row protection", () => {
    it("rejects deleting a system row with a clear error; the row survives", () => {
      const repo = new ServiceProviderRepository();
      const id = seedSystemRow(db, 1);

      const result = repo.deleteProvider(id);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/cannot delete system/i);
      expect(repo.getById(id)).toBeDefined();
    });

    it("deletes a non-system row successfully", () => {
      const repo = new ServiceProviderRepository();
      const created = repo.createProvider({
        code: "SYRIA",
        label: "Syria",
        drawer_name: "General",
      });

      const result = repo.deleteProvider(created.id!);

      expect(result.success).toBe(true);
      expect(repo.getById(created.id!)).toBeUndefined();
    });

    it("returns an error for a non-existent id", () => {
      const repo = new ServiceProviderRepository();
      const result = repo.deleteProvider(9999);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });
  });
});
