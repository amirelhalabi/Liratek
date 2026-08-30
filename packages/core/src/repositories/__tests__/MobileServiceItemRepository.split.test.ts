/**
 * MobileServiceItemRepository — Only-Days split columns (LIRA-090, v140).
 *
 * `MobileServiceItemRepository` had ZERO tests before this ticket (see
 * TELECOM_DAYS_VALIDITY_PLAN.md §7 Phase 3/7). This file covers:
 *
 *  - createItem() persists days_cost_lbp/sell_days_lbp/sell_credit_lbp and
 *    reads them back unchanged.
 *  - updateItem() patches a single split field without disturbing the
 *    others (partial split — plan §3 decision 5: columns are independently
 *    nullable), including explicitly clearing a field back to null.
 *  - Legacy rows created with NO split values read back with all three
 *    columns null and do not error (pre-v140 catalog rows are untouched by
 *    this migration).
 *  - Cross-tenant isolation: a second tenant's mirrored row (same
 *    provider/category/subcategory/label, different split numbers — the
 *    UNIQUE constraint is scoped per tenant_id so this is legal) is
 *    invisible to tenant 1 through getById/getAll/getAllIncludingInactive/
 *    getByProvider/getByProviderAndCategory.
 *
 * `MobileServiceItemRepository` overrides ALL of BaseRepository's generic
 * CRUD (see class doc) — every query hand-rolls `AND tenant_id = ?`, so
 * there is no free tenant scoping to fall back on. Per CLAUDE.md rule 17,
 * the cross-tenant isolation assertions in this file were verified to FAIL
 * when the `AND tenant_id = ?` predicate was temporarily removed from
 * `getById()` (tenant 1 started seeing tenant 2's mirrored row) — the
 * predicate was restored and the revert verified identical via `git diff`
 * before this file was finalized. See the task's final report for the
 * failing-run transcript.
 */

import Database from "better-sqlite3";
import {
  MobileServiceItemRepository,
  resetMobileServiceItemRepository,
  type CreateMobileServiceItemData,
} from "../MobileServiceItemRepository.js";
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
      max_returned_credits_usd REAL,
      created_at       TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at       TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, provider, category, subcategory, label)
    );
  `);
  return db;
}

/** The 77$ cart from the plan's worked example (§2.3). */
const CART_77: CreateMobileServiceItemData = {
  provider: "iPick",
  category: "mtc",
  subcategory: "Cart",
  label: "77$ Cart",
  cost_lbp: 7_600_000,
  sell_lbp: 7_800_000,
  credits: 77,
  days_cost_lbp: 1_162_000,
  sell_days_lbp: 1_300_000,
  sell_credit_lbp: 6_600_000,
};

describe("MobileServiceItemRepository — Only-Days split columns (LIRA-090)", () => {
  let db: Database.Database;
  let repo: MobileServiceItemRepository;

  beforeEach(() => {
    db = createTestDb();
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__ = db;
    resetMobileServiceItemRepository();
    repo = new MobileServiceItemRepository();
  });

  afterEach(() => {
    delete (
      globalThis as unknown as { __LIRATEK_TEST_DB__?: Database.Database }
    ).__LIRATEK_TEST_DB__;
    db.close();
    resetMobileServiceItemRepository();
  });

  // ---------------------------------------------------------------------
  // create-with-split
  // ---------------------------------------------------------------------

  it("createItem() persists all three split columns and reads them back", () => {
    const row = runWithTenant(1, () => repo.createItem(CART_77));

    expect(row.days_cost_lbp).toBe(1_162_000);
    expect(row.sell_days_lbp).toBe(1_300_000);
    expect(row.sell_credit_lbp).toBe(6_600_000);
    // Untouched pre-existing fields still round-trip.
    expect(row.credits).toBe(77);
    expect(row.cost_lbp).toBe(7_600_000);

    const reread = runWithTenant(1, () => repo.getById(row.id));
    expect(reread?.days_cost_lbp).toBe(1_162_000);
    expect(reread?.sell_days_lbp).toBe(1_300_000);
    expect(reread?.sell_credit_lbp).toBe(6_600_000);
  });

  it("createItem() defaults all three split columns to null when omitted", () => {
    const row = runWithTenant(1, () =>
      repo.createItem({
        provider: "Katsh",
        category: "alfa",
        subcategory: "Cart",
        label: "Plain item",
        cost_lbp: 500_000,
        sell_lbp: 550_000,
      }),
    );

    expect(row.days_cost_lbp).toBeNull();
    expect(row.sell_days_lbp).toBeNull();
    expect(row.sell_credit_lbp).toBeNull();
  });

  // ---------------------------------------------------------------------
  // update-partial-split
  // ---------------------------------------------------------------------

  it("updateItem() patches a single split field, leaving the others and non-split fields untouched", () => {
    const created = runWithTenant(1, () =>
      repo.createItem({
        ...CART_77,
        label: "Update target",
      }),
    );

    const updated = runWithTenant(1, () =>
      repo.updateItem(created.id, { days_cost_lbp: 1_200_000 }),
    );

    expect(updated?.days_cost_lbp).toBe(1_200_000); // changed
    expect(updated?.sell_days_lbp).toBe(1_300_000); // untouched
    expect(updated?.sell_credit_lbp).toBe(6_600_000); // untouched
    expect(updated?.credits).toBe(77); // untouched
    expect(updated?.cost_lbp).toBe(7_600_000); // untouched
    expect(updated?.label).toBe("Update target"); // untouched
  });

  it("updateItem() can explicitly clear a split field back to null", () => {
    const created = runWithTenant(1, () => repo.createItem(CART_77));

    const cleared = runWithTenant(1, () =>
      repo.updateItem(created.id, { sell_credit_lbp: null }),
    );

    expect(cleared?.sell_credit_lbp).toBeNull();
    expect(cleared?.days_cost_lbp).toBe(1_162_000); // untouched
    expect(cleared?.sell_days_lbp).toBe(1_300_000); // untouched
  });

  it("updateItem() building a split incrementally: two separate calls each patch only their field", () => {
    const created = runWithTenant(1, () =>
      repo.createItem({
        provider: "iPick",
        category: "mtc",
        subcategory: "Cart",
        label: "Incremental cart",
        cost_lbp: 7_600_000,
        sell_lbp: 7_800_000,
        credits: 77,
      }),
    );
    expect(created.days_cost_lbp).toBeNull();

    const afterFirst = runWithTenant(1, () =>
      repo.updateItem(created.id, { days_cost_lbp: 1_162_000 }),
    );
    expect(afterFirst?.days_cost_lbp).toBe(1_162_000);
    expect(afterFirst?.sell_days_lbp).toBeNull(); // still unset

    const afterSecond = runWithTenant(1, () =>
      repo.updateItem(created.id, { sell_days_lbp: 1_300_000 }),
    );
    expect(afterSecond?.days_cost_lbp).toBe(1_162_000); // preserved from the first call
    expect(afterSecond?.sell_days_lbp).toBe(1_300_000);
  });

  // ---------------------------------------------------------------------
  // legacy rows with NULL split
  // ---------------------------------------------------------------------

  it("reads a legacy row (inserted before v140, no split columns) with all three fields null", () => {
    // Simulates a pre-migration row: written directly with raw SQL, the way
    // an existing catalog row looks the instant v140 adds the columns
    // (defaultless ALTER TABLE ADD COLUMN — plan §7 Phase 1).
    db.prepare(
      `INSERT INTO mobile_service_items
         (tenant_id, provider, category, subcategory, label, cost_lbp, sell_lbp, validity_days, credits)
       VALUES (1, 'iPick', 'mtc', 'Legacy', 'Legacy Cart', 7600000, 7800000, 30, 77)`,
    ).run();

    const row = runWithTenant(1, () => repo.getAll())[0];
    expect(row).toBeDefined();
    expect(row.days_cost_lbp).toBeNull();
    expect(row.sell_days_lbp).toBeNull();
    expect(row.sell_credit_lbp).toBeNull();
    // Legacy structured fields still read fine alongside the new nulls.
    expect(row.validity_days).toBe(30);
    expect(row.credits).toBe(77);
  });

  // ---------------------------------------------------------------------
  // tenant isolation
  // ---------------------------------------------------------------------

  describe("tenant isolation", () => {
    function seedMirrored(): { t1Id: number; t2Id: number } {
      const t1 = runWithTenant(1, () => repo.createItem(CART_77));
      // Same provider/category/subcategory/label (legal — UNIQUE is scoped
      // per tenant_id), deliberately DIFFERENT split numbers so a leak
      // shows up as a wrong value, not just an extra row.
      const t2 = runWithTenant(2, () =>
        repo.createItem({
          ...CART_77,
          cost_lbp: 99_000_000,
          days_cost_lbp: 88_000_000,
          sell_days_lbp: 77_000_000,
          sell_credit_lbp: 66_000_000,
          credits: 999,
        }),
      );
      return { t1Id: t1.id, t2Id: t2.id };
    }

    it("getById(): tenant 1 cannot read tenant 2's mirrored row by id", () => {
      const { t2Id } = seedMirrored();

      const leaked = runWithTenant(1, () => repo.getById(t2Id));
      // getById()'s declared return type is `MobileServiceItemEntity | null`,
      // but a real miss returns better-sqlite3's raw `.get()` result, which
      // is `undefined` — a pre-existing quirk of this class (not introduced
      // by LIRA-090; every falsy-check caller already treats the two the
      // same way). Asserting falsy rather than strictly-null keeps this
      // test tied to the actual isolation guarantee instead of that
      // unrelated type/runtime mismatch.
      expect(leaked).toBeFalsy();

      const ownRow = runWithTenant(2, () => repo.getById(t2Id));
      expect(ownRow?.days_cost_lbp).toBe(88_000_000);
    });

    it("getAll(): tenant 1 sees ONLY its own row, with its own split values", () => {
      seedMirrored();

      const rowsT1 = runWithTenant(1, () => repo.getAll());
      expect(rowsT1).toHaveLength(1);
      expect(rowsT1[0]!.days_cost_lbp).toBe(1_162_000);

      const rowsT2 = runWithTenant(2, () => repo.getAll());
      expect(rowsT2).toHaveLength(1);
      expect(rowsT2[0]!.days_cost_lbp).toBe(88_000_000);
    });

    it("getAllIncludingInactive(): scoped per tenant even across active/inactive", () => {
      const { t1Id } = seedMirrored();
      runWithTenant(1, () => repo.toggleActive(t1Id)); // t1's row goes inactive

      const allT1 = runWithTenant(1, () => repo.getAllIncludingInactive());
      expect(allT1).toHaveLength(1);
      expect(allT1[0]!.is_active).toBe(0);

      const allT2 = runWithTenant(2, () => repo.getAllIncludingInactive());
      expect(allT2).toHaveLength(1);
      expect(allT2[0]!.is_active).toBe(1); // t2 untouched by t1's toggle
    });

    it("getByProvider()/getByProviderAndCategory(): tenant 2's mirrored row never leaks into tenant 1's list", () => {
      seedMirrored();

      const byProviderT1 = runWithTenant(1, () => repo.getByProvider("iPick"));
      expect(byProviderT1).toHaveLength(1);
      expect(byProviderT1[0]!.sell_credit_lbp).toBe(6_600_000);

      const byCategoryT1 = runWithTenant(1, () =>
        repo.getByProviderAndCategory("iPick", "mtc"),
      );
      expect(byCategoryT1).toHaveLength(1);
      expect(byCategoryT1[0]!.sell_credit_lbp).toBe(6_600_000);
    });

    it("updateItem(): tenant 1 cannot mutate tenant 2's row by guessing its id", () => {
      const { t2Id } = seedMirrored();

      const result = runWithTenant(1, () =>
        repo.updateItem(t2Id, { days_cost_lbp: 1 }),
      );
      // WHERE id = ? AND tenant_id = ? matches zero rows, then getById()
      // (also tenant-scoped) correctly reports not-found (falsy — see the
      // getById() test above for the null-vs-undefined note) rather than
      // returning tenant 2's now-unmodified row.
      expect(result).toBeFalsy();

      const stillIntact = runWithTenant(2, () => repo.getById(t2Id));
      expect(stillIntact?.days_cost_lbp).toBe(88_000_000);
    });

    it("getCount(): counts only the active tenant's rows", () => {
      seedMirrored();
      expect(runWithTenant(1, () => repo.getCount())).toBe(1);
      expect(runWithTenant(2, () => repo.getCount())).toBe(1);
    });
  });
});
