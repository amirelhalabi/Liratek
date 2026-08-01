/**
 * MobileServiceItemService — Only-Days split consistency gate (LIRA-090).
 *
 * Spec: TELECOM_DAYS_VALIDITY_PLAN.md §5.1 precondition, restated at write
 * time: "days_cost_lbp present must imply days_cost_lbp > 0 && days_cost_lbp
 * < cost_lbp". An item is always allowed to have NO split configured at all
 * (plan §3 decision 5); the gate exists purely to stop an admin from saving
 * a `days_cost_lbp` value that is mathematically nonsensical relative to
 * `cost_lbp` (which would make `deriveItemEconomics` — utils/telecomCredit.ts
 * — silently produce a negative/zero `creditCostLbp`).
 *
 * Uses a real in-memory SQLite DB + the real `MobileServiceItemRepository`
 * (matching this codebase's service-test convention — see
 * `PartnerService.test.ts` — rather than a hand-rolled mock repo), so these
 * tests exercise the actual create()/update() → repo round trip, not just
 * the validation function in isolation.
 *
 * Per CLAUDE.md rule 17: the four "rejects ..." tests below were verified to
 * FAIL (the invalid payload wrongly returned `success: true`) when the
 * `daysCostLbpConsistencyError(...)` guard was temporarily commented out of
 * both `create()` and `update()` in MobileServiceItemService.ts — the guard
 * was then restored and the revert verified identical via `git diff` before
 * this file was finalized. See the task's final report for the failing-run
 * transcript.
 */

import Database from "better-sqlite3";
import {
  MobileServiceItemRepository,
  resetMobileServiceItemRepository,
} from "../../repositories/MobileServiceItemRepository.js";
import { MobileServiceItemService } from "../MobileServiceItemService.js";
import { runWithTenant } from "../../db/tenantContext.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE mobile_service_items (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id        INTEGER,
      provider         TEXT NOT NULL,
      category         TEXT NOT NULL,
      subcategory      TEXT NOT NULL,
      label            TEXT NOT NULL,
      cost_lbp         REAL NOT NULL DEFAULT 0,
      sell_lbp         REAL NOT NULL DEFAULT 0,
      sort_order       INTEGER NOT NULL DEFAULT 0,
      is_active        INTEGER NOT NULL DEFAULT 1,
      validity_days    INTEGER,
      credits          REAL,
      days_cost_lbp    REAL,
      sell_days_lbp    REAL,
      sell_credit_lbp  REAL,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at       TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, provider, category, subcategory, label)
    );
  `);
  return db;
}

describe("MobileServiceItemService — Only-Days split consistency gate (LIRA-090)", () => {
  let db: Database.Database;
  let repo: MobileServiceItemRepository;
  let service: MobileServiceItemService;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetMobileServiceItemRepository();
    repo = new MobileServiceItemRepository();
    service = new MobileServiceItemService(repo);
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetMobileServiceItemRepository();
  });

  // ---------------------------------------------------------------------
  // create()
  // ---------------------------------------------------------------------

  describe("create()", () => {
    it("accepts an item with no split configured at all (days_cost_lbp omitted)", () => {
      const result = runWithTenant(1, () =>
        service.create({
          provider: "iPick",
          category: "mtc",
          subcategory: "Cart",
          label: "Plain 77$ cart",
          cost_lbp: 7_600_000,
          sell_lbp: 7_800_000,
          credits: 77,
        }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.days_cost_lbp).toBeNull();
    });

    it("accepts a valid split (days_cost_lbp > 0 and < cost_lbp), even with credits unset", () => {
      const result = runWithTenant(1, () =>
        service.create({
          provider: "iPick",
          category: "mtc",
          subcategory: "Cart",
          label: "77$ cart with days cost",
          cost_lbp: 7_600_000,
          sell_lbp: 7_800_000,
          days_cost_lbp: 1_162_000,
          // credits deliberately omitted — the narrow write-time gate does
          // not require it (only the sale-time gate, isTelecomSplitComplete
          // in full, does).
        }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.days_cost_lbp).toBe(1_162_000);
    });

    it("rejects days_cost_lbp === 0", () => {
      const result = runWithTenant(1, () =>
        service.create({
          provider: "iPick",
          category: "mtc",
          subcategory: "Cart",
          label: "Bad cart",
          cost_lbp: 7_600_000,
          sell_lbp: 7_800_000,
          days_cost_lbp: 0,
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/days_cost_lbp/);
    });

    it("rejects days_cost_lbp equal to cost_lbp", () => {
      const result = runWithTenant(1, () =>
        service.create({
          provider: "iPick",
          category: "mtc",
          subcategory: "Cart",
          label: "Bad cart",
          cost_lbp: 7_600_000,
          sell_lbp: 7_800_000,
          days_cost_lbp: 7_600_000,
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/days_cost_lbp/);
    });

    it("rejects days_cost_lbp greater than cost_lbp", () => {
      const result = runWithTenant(1, () =>
        service.create({
          provider: "iPick",
          category: "mtc",
          subcategory: "Cart",
          label: "Bad cart",
          cost_lbp: 7_600_000,
          sell_lbp: 7_800_000,
          days_cost_lbp: 8_000_000,
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/days_cost_lbp/);
    });

    it("rejects a negative days_cost_lbp", () => {
      const result = runWithTenant(1, () =>
        service.create({
          provider: "iPick",
          category: "mtc",
          subcategory: "Cart",
          label: "Bad cart",
          cost_lbp: 7_600_000,
          sell_lbp: 7_800_000,
          days_cost_lbp: -1,
        }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/days_cost_lbp/);
    });

    it("a rejected create() never reaches the repository (no row is written)", () => {
      runWithTenant(1, () =>
        service.create({
          provider: "iPick",
          category: "mtc",
          subcategory: "Cart",
          label: "Bad cart",
          cost_lbp: 7_600_000,
          sell_lbp: 7_800_000,
          days_cost_lbp: 8_000_000,
        }),
      );
      expect(runWithTenant(1, () => service.getCount())).toBe(0);
    });
  });

  // ---------------------------------------------------------------------
  // update()
  // ---------------------------------------------------------------------

  describe("update()", () => {
    it("accepts clearing days_cost_lbp back to null", () => {
      const created = runWithTenant(1, () =>
        service.create({
          provider: "iPick",
          category: "mtc",
          subcategory: "Cart",
          label: "77$ cart",
          cost_lbp: 7_600_000,
          sell_lbp: 7_800_000,
          days_cost_lbp: 1_162_000,
          credits: 77,
        }),
      );
      const id = created.data!.id;

      const result = runWithTenant(1, () =>
        service.update(id, { days_cost_lbp: null }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.days_cost_lbp).toBeNull();
    });

    it("rejects setting days_cost_lbp >= the EXISTING cost_lbp when cost_lbp is not in this same call", () => {
      const created = runWithTenant(1, () =>
        service.create({
          provider: "iPick",
          category: "mtc",
          subcategory: "Cart",
          label: "77$ cart",
          cost_lbp: 7_600_000,
          sell_lbp: 7_800_000,
          credits: 77,
        }),
      );
      const id = created.data!.id;

      const result = runWithTenant(1, () =>
        service.update(id, { days_cost_lbp: 9_000_000 }), // >= existing cost_lbp
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/days_cost_lbp/);

      // And the row itself was never touched by the rejected update.
      const stillClean = runWithTenant(1, () => repo.getById(id));
      expect(stillClean?.days_cost_lbp).toBeNull();
    });

    it("accepts setting days_cost_lbp when cost_lbp is raised in the SAME call to accommodate it", () => {
      const created = runWithTenant(1, () =>
        service.create({
          provider: "iPick",
          category: "mtc",
          subcategory: "Cart",
          label: "77$ cart",
          cost_lbp: 7_600_000,
          sell_lbp: 7_800_000,
          credits: 77,
        }),
      );
      const id = created.data!.id;

      const result = runWithTenant(1, () =>
        service.update(id, { cost_lbp: 10_000_000, days_cost_lbp: 9_000_000 }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.days_cost_lbp).toBe(9_000_000);
      expect(result.data?.cost_lbp).toBe(10_000_000);
    });

    it("leaves an existing valid split untouched when the update doesn't mention days_cost_lbp", () => {
      const created = runWithTenant(1, () =>
        service.create({
          provider: "iPick",
          category: "mtc",
          subcategory: "Cart",
          label: "77$ cart",
          cost_lbp: 7_600_000,
          sell_lbp: 7_800_000,
          days_cost_lbp: 1_162_000,
          credits: 77,
        }),
      );
      const id = created.data!.id;

      const result = runWithTenant(1, () =>
        service.update(id, { label: "Renamed cart" }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.days_cost_lbp).toBe(1_162_000); // untouched
      expect(result.data?.label).toBe("Renamed cart");
    });

    it("returns 'Item not found' for a nonexistent id without ever calling the repository's update", () => {
      const result = runWithTenant(1, () =>
        service.update(9999, { days_cost_lbp: 1 }),
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe("Item not found");
    });
  });
});
