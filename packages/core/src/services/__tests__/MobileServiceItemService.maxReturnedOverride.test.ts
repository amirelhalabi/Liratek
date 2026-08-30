/**
 * MobileServiceItemService — the v160 `max_returned_credits_usd` write guard.
 *
 * Owner decision (2026-08-30): a save that strands the override is REJECTED,
 * never silently auto-cleared, so a tuned number can never vanish behind the
 * operator's back.
 *
 * The trap this file exists for is the SECOND direction. Guarding the field
 * being written is obvious and gets built; the pairing also breaks when
 * `credits` is edited DOWNWARD underneath an override that was already stored,
 * and nothing about that update mentions the override at all. That is why
 * `update()` resolves the existing row and validates EFFECTIVE values rather
 * than the payload.
 *
 * Same harness as `MobileServiceItemService.splitGate.test.ts`: a real
 * in-memory SQLite DB and the real repository, so these exercise the true
 * create()/update() -> repo round trip.
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
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                INTEGER,
      provider                 TEXT NOT NULL,
      category                 TEXT NOT NULL,
      subcategory              TEXT NOT NULL,
      label                    TEXT NOT NULL,
      cost_lbp                 REAL NOT NULL DEFAULT 0,
      sell_lbp                 REAL NOT NULL DEFAULT 0,
      sort_order               INTEGER NOT NULL DEFAULT 0,
      is_active                INTEGER NOT NULL DEFAULT 1,
      validity_days            INTEGER,
      credits                  REAL,
      days_cost_lbp            REAL,
      sell_days_lbp            REAL,
      sell_credit_lbp          REAL,
      max_returned_credits_usd REAL,
      created_at               TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at               TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, provider, category, subcategory, label)
    );
  `);
  return db;
}

/** The owner's card. Computed max is 73.00; the override is 73.50. */
const CARD = {
  provider: "iPick",
  category: "alfa",
  subcategory: "Prepaid Cards",
  label: "77.28",
  cost_lbp: 7_728_000,
  sell_lbp: 8_000_000,
  credits: 77.28,
  validity_days: 365,
} as const;

describe("MobileServiceItemService — max_returned_credits_usd guard (v160)", () => {
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

  const create = (over?: Partial<Record<string, unknown>>) =>
    runWithTenant(1, () =>
      service.create({ ...CARD, ...over } as Parameters<
        typeof service.create
      >[0]),
    );

  describe("create()", () => {
    it("accepts the owner's 73.5 on the 77.28 card", () => {
      const result = create({ max_returned_credits_usd: 73.5 });
      expect(result.success).toBe(true);
      expect(result.data?.max_returned_credits_usd).toBe(73.5);
    });

    it("accepts no override at all — every card's default", () => {
      const result = create();
      expect(result.success).toBe(true);
      expect(result.data?.max_returned_credits_usd).toBeNull();
    });

    it("rejects an override above the cap, naming the legal range", () => {
      const result = create({ max_returned_credits_usd: 83 });
      expect(result.success).toBe(false);
      expect(result.error).toContain("73");
      expect(result.error).toContain("73.5");
    });

    it("rejects an override below the computed value", () => {
      const result = create({ max_returned_credits_usd: 70 });
      expect(result.success).toBe(false);
    });

    it("rejects an override on a card with no credits to bound it", () => {
      const result = create({ credits: null, max_returned_credits_usd: 73.5 });
      expect(result.success).toBe(false);
      expect(result.error).toContain("credits");
    });
  });

  describe("update()", () => {
    it("accepts setting a valid override on an existing card", () => {
      const created = create();
      const result = runWithTenant(1, () =>
        service.update(created.data!.id, { max_returned_credits_usd: 73.5 }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.max_returned_credits_usd).toBe(73.5);
    });

    it("rejects setting an override above the cap", () => {
      const created = create();
      const result = runWithTenant(1, () =>
        service.update(created.data!.id, { max_returned_credits_usd: 83 }),
      );
      expect(result.success).toBe(false);
    });

    it("allows clearing the override back to computed", () => {
      const created = create({ max_returned_credits_usd: 73.5 });
      const result = runWithTenant(1, () =>
        service.update(created.data!.id, { max_returned_credits_usd: null }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.max_returned_credits_usd).toBeNull();
    });

    // ---- the second direction: the one that ships as a bug ----

    it("BLOCKS editing credits so a STORED override no longer fits", () => {
      const created = create({ max_returned_credits_usd: 73.5 });

      // Nothing in this payload mentions the override. A guard that only
      // validates the field being written lets this through and strands 73.5
      // on a card whose computed max is now 47.
      const result = runWithTenant(1, () =>
        service.update(created.data!.id, { credits: 50 }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("max_returned_credits_usd");
    });

    it("leaves the stored row untouched when that edit is refused", () => {
      const created = create({ max_returned_credits_usd: 73.5 });

      runWithTenant(1, () => service.update(created.data!.id, { credits: 50 }));

      const after = runWithTenant(1, () => repo.getById(created.data!.id));
      expect(after?.credits).toBe(77.28);
      expect(after?.max_returned_credits_usd).toBe(73.5);
    });

    it("ALLOWS editing credits when the override still fits afterwards", () => {
      const created = create({ max_returned_credits_usd: 73.5 });

      // maxReturnableCredits(77.5) is 73.5, so the override remains exactly at
      // the computed value — legal, and it must not be collateral damage of a
      // guard that is too eager.
      const result = runWithTenant(1, () =>
        service.update(created.data!.id, { credits: 77.5 }),
      );

      expect(result.success).toBe(true);
      expect(result.data?.max_returned_credits_usd).toBe(73.5);
    });

    it("ALLOWS changing credits and the override together in one call", () => {
      const created = create({ max_returned_credits_usd: 73.5 });

      // Both are effective values from THIS payload; the stored pair is
      // irrelevant. maxReturnableCredits(22.73) = 21, so 21.5 is legal.
      const result = runWithTenant(1, () =>
        service.update(created.data!.id, {
          credits: 22.73,
          max_returned_credits_usd: 21.5,
        }),
      );

      expect(result.success).toBe(true);
      expect(result.data?.credits).toBe(22.73);
      expect(result.data?.max_returned_credits_usd).toBe(21.5);
    });

    it("rejects a paired edit where the new override is wrong for the new credits", () => {
      const created = create({ max_returned_credits_usd: 73.5 });
      const result = runWithTenant(1, () =>
        service.update(created.data!.id, {
          credits: 22.73,
          max_returned_credits_usd: 73.5,
        }),
      );
      expect(result.success).toBe(false);
    });

    it("leaves an unrelated edit alone on a card carrying an override", () => {
      const created = create({ max_returned_credits_usd: 73.5 });
      const result = runWithTenant(1, () =>
        service.update(created.data!.id, { sell_lbp: 8_100_000 }),
      );
      expect(result.success).toBe(true);
      expect(result.data?.max_returned_credits_usd).toBe(73.5);
    });
  });
});
