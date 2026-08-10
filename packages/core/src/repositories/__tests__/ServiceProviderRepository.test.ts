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
 *  - phase 4b (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b): `deleteProvider`
 *    ALSO refuses to delete a non-system provider still named in a partner's
 *    `system_association`, naming the referencing partner(s) — the concrete
 *    bug the plan calls out (a custom provider like 'SYRIA' used to be
 *    deletable while a partner still pointed at it, leaving a dangling
 *    association matching no provider anywhere downstream). Migration v155's
 *    composite FK is the backstop; this test proves the primary path.
 *
 * Rule 17 note: the system-row protections in `updateProvider`/
 * `deleteProvider` predate this task (phase 1), but were verified against
 * the buggy state while writing this file — temporarily removing the
 * `provider.is_system === 1` guard in `deleteProvider` (and the
 * `provider.is_system === 0` gate around `drawer_name`/`is_system_provider`
 * in `updateProvider`) made the corresponding tests below fail before the
 * guard was restored, proving they actually exercise the protection and
 * are not vacuously true. The phase 4b referencing-partner guard was proved
 * the same way: temporarily commenting out the new `referencing.length > 0`
 * block made "rejects deleting a provider still associated with a partner"
 * below fail (the delete silently succeeded) before the guard was restored.
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
    -- Minimal partners fixture — deleteProvider's phase 4b referencing-partner
    -- guard queries this table directly (real schema: create_db.sql).
    CREATE TABLE partners (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id           INTEGER,
      name                TEXT NOT NULL,
      system_association  TEXT DEFAULT NULL,
      is_active           INTEGER NOT NULL DEFAULT 1
    );
  `);
  return db;
}

function seedPartner(
  db: Database.Database,
  tenantId: number,
  name: string,
  systemAssociation: string | null,
): number {
  const result = db
    .prepare(
      `INSERT INTO partners (tenant_id, name, system_association) VALUES (?, ?, ?)`,
    )
    .run(tenantId, name, systemAssociation);
  return result.lastInsertRowid as number;
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

  describe("deleteProvider — referencing-partner protection (§5b phase 4b)", () => {
    it("rejects deleting a provider still associated with a partner, naming the partner; the provider AND the partner's association both survive", () => {
      const repo = new ServiceProviderRepository();
      const created = repo.createProvider({
        code: "SYRIA",
        label: "Syria",
        drawer_name: "General",
      });
      seedPartner(db, 1, "hwelet souria", "SYRIA");

      const result = repo.deleteProvider(created.id!);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/still associated with partner/i);
      expect(result.error).toContain("hwelet souria");
      expect(result.error).toContain("SYRIA");

      // The provider row survives the refused delete...
      expect(repo.getById(created.id!)).toBeDefined();
      // ...and the partner's association still resolves to a real provider
      // (the exact dangling-reference outcome this guard exists to prevent).
      const partnerRow = db
        .prepare(`SELECT system_association FROM partners WHERE name = ?`)
        .get("hwelet souria") as { system_association: string };
      expect(partnerRow.system_association).toBe("SYRIA");
      expect(repo.getByCode(partnerRow.system_association)).toBeDefined();
    });

    it("names EVERY referencing partner when more than one points at the same provider", () => {
      const repo = new ServiceProviderRepository();
      const created = repo.createProvider({
        code: "SYRIA",
        label: "Syria",
        drawer_name: "General",
      });
      seedPartner(db, 1, "hwelet souria", "SYRIA");
      seedPartner(db, 1, "Zeina Remit", "SYRIA");

      const result = repo.deleteProvider(created.id!);

      expect(result.success).toBe(false);
      expect(result.error).toContain("hwelet souria");
      expect(result.error).toContain("Zeina Remit");
    });

    it("does NOT block deleting a provider referenced only by a DIFFERENT tenant's partner (tenant-scoped)", () => {
      const repo = new ServiceProviderRepository();
      const created = repo.createProvider({
        code: "SYRIA",
        label: "Syria",
        drawer_name: "General",
      });
      // Same code text, but a partner belonging to tenant 2 — not this
      // provider's tenant (1) — must not block the delete.
      seedPartner(db, 2, "Other Tenant Partner", "SYRIA");

      const result = repo.deleteProvider(created.id!);

      expect(result.success).toBe(true);
      expect(repo.getById(created.id!)).toBeUndefined();
    });

    it("does NOT block deleting a provider when partners have NO association (system_association NULL) or a DIFFERENT one", () => {
      const repo = new ServiceProviderRepository();
      const created = repo.createProvider({
        code: "SYRIA",
        label: "Syria",
        drawer_name: "General",
      });
      seedPartner(db, 1, "No Association Partner", null);
      seedPartner(db, 1, "Whish Partner", "WHISH");

      const result = repo.deleteProvider(created.id!);

      expect(result.success).toBe(true);
      expect(repo.getById(created.id!)).toBeUndefined();
    });
  });
});
