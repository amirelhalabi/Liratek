/**
 * InventoryService — phone-LINE number normalisation + duplicate guard
 * (LIRA-207, `docs/plans/ongoing_plans/OWNER_NOTES_REMAINING_BUILD.md` #13).
 *
 * NOT RUN — proven at the end-of-batch gate (owner process rule for this
 * build batch: implement + write tests now, run everything once at the end).
 *
 * Owner's model: each resold phone number is its OWN product (one item per
 * number, its own price, no per-number POS override, no expiry tracking).
 * The number lives in `products.barcode`. Build asked for exactly three
 * things: (1) a leaf core normaliser, (2) apply it on create/edit so the
 * same number typed two different ways can't be listed twice, (3) label the
 * field "Number" for a lines category (frontend — see ProductForm.tsx).
 *
 * Rule 17 note (prove against the buggy code): the guard in
 * `InventoryService.createProduct`/`updateProduct` is the
 * `isPhoneLineCategoryName(...)` + `normalizeLineNumber(...)` pair added
 * right before the `barcodeExists` check. Commenting out either call
 * reproduces the pre-fix behaviour and the "collides across formats" tests
 * below must fail — to be actually run at the end-of-batch gate, per the
 * owner's process rule for this batch (no jest during Build).
 *
 * House style: real ProductRepository over an in-memory SQLite DB via the
 * `__LIRATEK_TEST_DB__` hook, same fixture as
 * `InventoryService.categoryResolution.test.ts` (this file does NOT need a
 * CategoryRepository — the "Phone Lines" classification here is name-only,
 * no `product_categories` row is required for the guard to fire).
 */

import Database from "better-sqlite3";
import { ProductRepository } from "../../repositories/ProductRepository.js";
import { InventoryService } from "../InventoryService.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE tenants (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT NOT NULL,
      slug   TEXT NOT NULL UNIQUE
    );
    INSERT INTO tenants (id, name, slug) VALUES (1, 'One', 'one');

    CREATE TABLE product_categories (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER REFERENCES tenants(id),
      name               TEXT NOT NULL COLLATE NOCASE,
      sort_order         INTEGER NOT NULL DEFAULT 0,
      is_active          INTEGER NOT NULL DEFAULT 1,
      tracks_imei_units  INTEGER NOT NULL DEFAULT 0,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, name)
    );

    CREATE TABLE products (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER REFERENCES tenants(id),
      barcode            TEXT,
      name               TEXT NOT NULL,
      item_type          TEXT NOT NULL DEFAULT 'Product',
      category           TEXT,
      category_id        INTEGER,
      description        TEXT,
      cost_price_usd     REAL DEFAULT 0,
      selling_price_usd  REAL DEFAULT 0,
      min_stock_level    INTEGER DEFAULT 5,
      stock_quantity     INTEGER DEFAULT 0,
      imei               TEXT,
      color              TEXT,
      image_url          TEXT,
      supplier           TEXT,
      status             TEXT DEFAULT 'Active',
      warranty_months    INTEGER,
      is_active          INTEGER NOT NULL DEFAULT 1,
      is_deleted         INTEGER NOT NULL DEFAULT 0,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Referenced by ProductRepository.search's IMEI-match EXISTS subquery at
    -- PREPARE time regardless of row count — must exist even though no test
    -- here seeds a unit (same reasoning as product_stock_batches below).
    CREATE TABLE product_units (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id                INTEGER DEFAULT 1,
      product_id               INTEGER NOT NULL,
      imei                     TEXT,
      status                   TEXT NOT NULL DEFAULT 'IN_STOCK',
      sale_item_id             INTEGER,
      is_defective             INTEGER NOT NULL DEFAULT 0,
      warranty_override_until  TEXT,
      created_at               DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at               DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Referenced by ProductRepository's correlated cost_tiers subquery at
    -- PREPARE time regardless of row count (see categoryResolution.test.ts's
    -- matching comment) — must exist even though no test here seeds a batch.
    CREATE TABLE product_stock_batches (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER DEFAULT 1,
      product_id         INTEGER NOT NULL,
      supplier_id        INTEGER,
      quantity           INTEGER NOT NULL,
      quantity_remaining INTEGER NOT NULL,
      unit_cost_usd      DECIMAL(10,2) NOT NULL DEFAULT 0,
      books_debt         INTEGER NOT NULL DEFAULT 0,
      ledger_entry_id    INTEGER,
      transaction_id     INTEGER,
      is_opening         INTEGER NOT NULL DEFAULT 0,
      created_by         INTEGER,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

describe("InventoryService — phone-line number normalisation + duplicate guard", () => {
  let db: Database.Database;
  let service: InventoryService;

  beforeAll(() => {
    db = createTestDb();
    (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
    service = new InventoryService(new ProductRepository());
  });

  afterAll(() => {
    delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
    db.close();
  });

  beforeEach(() => {
    db.exec(`DELETE FROM products; DELETE FROM product_categories;`);
  });

  function barcodeOf(productId: number): string {
    return (
      db
        .prepare(`SELECT barcode FROM products WHERE id = ?`)
        .get(productId) as { barcode: string }
    ).barcode;
  }

  // Shared by "updateProduct" and "search / lookup normalisation" below.
  function createLine(barcode: string, category = "Phone Lines"): number {
    const created = service.createProduct({
      barcode,
      name: `Line ${barcode}`,
      category,
      cost_price: 5,
      retail_price: 15,
    });
    expect(created.success).toBe(true);
    return created.id as number;
  }

  describe("createProduct", () => {
    it("stores the canonical (normalized) number for a Phone Lines category product", () => {
      const result = service.createProduct({
        barcode: "+961 3 123 456",
        name: "MTC prepaid line",
        category: "Phone Lines",
        cost_price: 5,
        retail_price: 15,
      });

      expect(result.success).toBe(true);
      expect(barcodeOf(result.id as number)).toBe("03123456");
    });

    it("refuses a second number that is the SAME line typed in a different format", () => {
      const first = service.createProduct({
        barcode: "03 123 456",
        name: "MTC prepaid line #1",
        category: "Phone Lines",
        cost_price: 5,
        retail_price: 15,
      });
      expect(first.success).toBe(true);

      const second = service.createProduct({
        barcode: "+961 3 123 456", // same line, international format
        name: "MTC prepaid line #2",
        category: "Phone Lines",
        cost_price: 5,
        retail_price: 15,
      });

      expect(second.success).toBe(false);
      expect(second.code).toBe("DUPLICATE_BARCODE");
      // Only the first insert landed.
      expect(
        (db.prepare(`SELECT COUNT(*) AS n FROM products`).get() as {
          n: number;
        }).n,
      ).toBe(1);
    });

    it("still allows two DIFFERENT numbers in the same lines category", () => {
      const first = service.createProduct({
        barcode: "03 123 456",
        name: "MTC prepaid line #1",
        category: "Phone Lines",
        cost_price: 5,
        retail_price: 15,
      });
      const second = service.createProduct({
        barcode: "03 999 999",
        name: "MTC prepaid line #2",
        category: "Phone Lines",
        cost_price: 5,
        retail_price: 20,
      });

      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      expect(barcodeOf(second.id as number)).toBe("03999999");
    });

    it("does NOT normalize a barcode outside a lines category — Phones is untouched", () => {
      // A barcode-shaped string that happens to start with the international
      // access code digits must survive unmangled for a non-lines category —
      // this is the whole reason the guard is category-gated rather than
      // universal (a real EAN-13 could coincidentally start "00961...").
      const result = service.createProduct({
        barcode: "00961123456789",
        name: "Some accessory",
        category: "Accessories",
        cost_price: 5,
        retail_price: 15,
      });

      expect(result.success).toBe(true);
      expect(barcodeOf(result.id as number)).toBe("00961123456789");
    });

    it("category name matching is case-insensitive ('lines' anywhere in the name)", () => {
      const result = service.createProduct({
        barcode: "70 111 222",
        name: "Alfa prepaid line",
        category: "MTC/Alfa Lines",
        cost_price: 5,
        retail_price: 15,
      });

      expect(result.success).toBe(true);
      expect(barcodeOf(result.id as number)).toBe("70111222");
    });

    // Fix-round (N13-4): a bare `.includes("line")` used to also match
    // "Online Cards" and mangle a real barcode stored there. Prove against
    // the buggy predicate (rule 17): reverting isPhoneLineCategoryName to
    // `.includes("line")` makes this fail (barcodeOf would come back
    // "03123456" instead of the untouched original).
    //
    // N13-R2-3 (fix round 2): the original version of this test used an
    // 11-digit barcode ("96103123456"), which `normalizeLineNumber` returns
    // UNCHANGED regardless of category (its own length>8 guard, unrelated
    // to `isPhoneLineCategoryName`) — so the test passed even under the old
    // buggy `.includes("line")` predicate and proved nothing. Use a value
    // normalization WOULD actually change ("+961 3 123 456" -> "03123456")
    // so the assertion is load-bearing on the word-boundary predicate.
    it("does NOT treat 'Online Cards' as a lines category — its barcode is untouched", () => {
      const result = service.createProduct({
        barcode: "+961 3 123 456", // would normalize to "03123456" if mangled
        name: "Top-up card",
        category: "Online Cards",
        cost_price: 1,
        retail_price: 2,
      });

      expect(result.success).toBe(true);
      expect(barcodeOf(result.id as number)).toBe("+961 3 123 456");
    });

    // Fix-round (N13-2): a lines-category collision must not offer the
    // generic "Duplicate Barcode" one-click resubmit — that button sets the
    // field to the DUP-suffixed suggestion and resubmits successfully,
    // listing the SAME physical number twice. Prove against the buggy code
    // (rule 17): removing the `categoryIsLines` branch in
    // `InventoryService.createProduct`'s duplicate check makes this fail
    // (`suggested_barcode` would come back `"03123456DUP1"`).
    it("does NOT offer a suggested_barcode (DUP-suffix) on a lines-category collision", () => {
      const first = service.createProduct({
        barcode: "03 123 456",
        name: "MTC prepaid line #1",
        category: "Phone Lines",
        cost_price: 5,
        retail_price: 15,
      });
      expect(first.success).toBe(true);

      const second = service.createProduct({
        barcode: "+961 3 123 456",
        name: "MTC prepaid line #2",
        category: "Phone Lines",
        cost_price: 5,
        retail_price: 15,
      });

      expect(second.success).toBe(false);
      expect(second.code).toBe("DUPLICATE_BARCODE");
      expect(second.suggested_barcode).toBeUndefined();
      expect(second.error).toBe("This number is already listed");
    });

    // Fix-round (N13-5): normalisation must run BEFORE the blank-barcode
    // auto-generate step, so an isolated international-prefix fragment
    // ("+961" alone, which normalizes to "") falls through to a real
    // auto-generated barcode instead of being stored as-is or empty. Prove
    // against the buggy order (rule 17): auto-generating before
    // normalizing would store the literal "+961" (non-blank at that point)
    // instead of a generated 8-digit numeric barcode.
    it("falls through to auto-generation when the typed number normalizes to empty", () => {
      const result = service.createProduct({
        barcode: "+961",
        name: "Garbled line entry",
        category: "Phone Lines",
        cost_price: 5,
        retail_price: 15,
      });

      expect(result.success).toBe(true);
      const stored = barcodeOf(result.id as number);
      expect(stored).not.toBe("+961");
      expect(stored).not.toBe("");
      expect(stored).toMatch(/^\d{8}$/);
    });
  });

  describe("updateProduct", () => {
    it("normalizes an edited number the same way as create", () => {
      const productId = createLine("03 123 456");

      const result = service.updateProduct(productId, {
        barcode: "+961-3-123-456",
        name: "Line 03123456",
        category: "Phone Lines",
        cost_price: 5,
        retail_price: 15,
        min_stock_level: 1,
      });

      expect(result.success).toBe(true);
      expect(barcodeOf(productId)).toBe("03123456");
    });

    it("refuses an edit that collides with another line's number in a different format", () => {
      createLine("03 123 456");
      const other = createLine("03 999 999");

      const result = service.updateProduct(other, {
        barcode: "00961 3 123 456", // same as the FIRST line, international format
        name: "Line 03999999",
        category: "Phone Lines",
        cost_price: 5,
        retail_price: 15,
        min_stock_level: 1,
      });

      expect(result.success).toBe(false);
      expect(result.code).toBe("DUPLICATE_BARCODE");
      // The second product's number is unchanged.
      expect(barcodeOf(other)).toBe("03999999");
    });

    it("still applies the guard when the edit omits `category` (falls back to the stored category)", () => {
      const productId = createLine("03 123 456");
      const other = createLine("03 999 999");

      // No `category` in the payload — exactly what an unrelated field edit
      // over the unvalidated REST PUT can send (categoryResolution.test.ts's
      // "omitted entirely" case). The product's STORED category
      // ("Phone Lines") must still gate the normaliser.
      const result = service.updateProduct(other, {
        barcode: "+9613123456", // collides with the first line
        name: "Renamed, no category in payload",
        cost_price: 6,
        retail_price: 16,
        min_stock_level: 1,
      });

      expect(result.success).toBe(false);
      expect(result.code).toBe("DUPLICATE_BARCODE");
    });

    // Fix-round (N13-2), update-path counterpart of the create-path test
    // above — same guard, same reason (rule 14: not a second copy).
    it("does NOT offer a suggested_barcode on an update-path lines collision either", () => {
      createLine("03 123 456");
      const other = createLine("03 999 999");

      const result = service.updateProduct(other, {
        barcode: "00961 3 123 456", // same as the FIRST line
        name: "Line 03999999",
        category: "Phone Lines",
        cost_price: 5,
        retail_price: 15,
        min_stock_level: 1,
      });

      expect(result.success).toBe(false);
      expect(result.suggested_barcode).toBeUndefined();
      expect(result.error).toBe("This number is already listed");
    });
  });

  // Fix-round (N13-3) — the owner's answer names "item create/search": a
  // line stored in its canonical form must still be found when the
  // operator searches/looks it up in a different everyday format.
  describe("search / lookup normalisation", () => {
    it("searchProducts finds a canonically-stored line typed in a different format", () => {
      createLine("03 123 456"); // stored as "03123456"

      const bySameFormat = service.searchProducts("+961 3 123 456");
      expect(bySameFormat.some((p) => p.barcode === "03123456")).toBe(true);
    });

    it("searchProducts still returns [] for a term matching nothing, normalized or not", () => {
      createLine("03 123 456");
      expect(service.searchProducts("+961 9 999 999")).toEqual([]);
    });

    it("getProductByBarcode finds a canonically-stored line typed in a different format", () => {
      createLine("70 111 222"); // stored as "70111222"

      const found = service.getProductByBarcode("+961 70 111 222");
      expect(found?.barcode).toBe("70111222");
    });

    it("getProductByBarcode still returns null for a genuinely unknown number", () => {
      createLine("70 111 222");
      expect(service.getProductByBarcode("+961 88 888 888")).toBeNull();
    });

    // N13-R2-1 (fix round 2, MAJOR) — every real search box (Inventory list,
    // POS, Custom Services) calls `getProducts`, NOT `searchProducts` (that
    // method has no caller anywhere — no IPC channel, no REST route, no
    // frontend `api.searchProducts`). Prove the fallback against the path
    // that is actually reachable. Prove against the buggy code (rule 17):
    // before this fix `getProducts` called `productRepo.findAllProducts`
    // directly with no normalized-term fallback, so this test fails on
    // that code (empty array instead of the match).
    it("getProducts (the real search path) finds a canonically-stored line typed in a different format", () => {
      createLine("03 123 456"); // stored as "03123456"

      const bySameFormat = service.getProducts("+961 3 123 456");
      expect(bySameFormat.some((p) => p.barcode === "03123456")).toBe(true);
    });

    it("getProducts still returns [] for a term matching nothing, normalized or not", () => {
      createLine("03 123 456");
      expect(service.getProducts("+961 9 999 999")).toEqual([]);
    });

    it("getProducts merges the direct and normalized-term hits with no duplicates, kept in name order", () => {
      const lineId = createLine("03 123 456"); // "Line 03123456", barcode "03123456"
      const accessory = service.createProduct({
        barcode: "555555",
        // Literally CONTAINS the raw search term below, so the DIRECT
        // (unnormalized) search matches it by name.
        name: "Import +961 3 123 456 batch",
        category: "Accessories",
        cost_price: 1,
        retail_price: 3,
      });
      expect(accessory.success).toBe(true);

      // The raw term direct-matches the accessory's NAME; its normalized
      // form ("03123456") separately matches the line's barcode — no
      // overlap between the two hits, so this exercises the actual merge,
      // not just the fallback alone.
      const results = service.getProducts("+961 3 123 456");
      const ids = results.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length); // no duplicate rows
      expect(ids).toContain(lineId);
      expect(ids).toContain(accessory.id);
      // Ordered by name ASC ("Import..." sorts before "Line...").
      const names = results.map((p) => p.name);
      expect([...names].sort()).toEqual(names);
    });

    // N13-R2-2 (fix round 2, minor) — the normalized-term fallback must
    // only resolve to a product that is ITSELF in a lines category. A
    // non-lines product whose stored barcode is coincidentally identical
    // digits to some phone-shaped search term must not be handed back as
    // if it were the line being looked up. Prove against the buggy code
    // (rule 17): dropping the `isPhoneLineCategoryName(hit.category)` gate
    // in `getProductByBarcode` makes this return the accessory instead of
    // `null`.
    it("getProductByBarcode does NOT fall back to a non-lines product that coincidentally shares the normalized digits", () => {
      service.createProduct({
        barcode: "03123456", // literal digits, stored as-is (not a lines category)
        name: "Phone case (coincidental digit barcode)",
        category: "Accessories",
        cost_price: 1,
        retail_price: 3,
      });

      // "+961 3 123 456" normalizes to "03123456" — the SAME digits as the
      // accessory's literal barcode — but the accessory is not a line.
      expect(service.getProductByBarcode("+961 3 123 456")).toBeNull();
    });

    it("resolveScanCode does NOT fall back to a non-lines product that coincidentally shares the normalized digits", () => {
      service.createProduct({
        barcode: "03123456",
        name: "Phone case (coincidental digit barcode)",
        category: "Accessories",
        cost_price: 1,
        retail_price: 3,
      });

      expect(service.resolveScanCode("+961 3 123 456")).toBeNull();
    });

    it("resolveScanCode DOES resolve via the normalized fallback when the hit is actually a lines-category product", () => {
      createLine("03 123 456"); // stored as "03123456"

      const resolved = service.resolveScanCode("+961 3 123 456");
      expect(resolved?.product.barcode).toBe("03123456");
      expect(resolved?.matched_unit).toBeNull();
    });
  });

  // N13-R2-4 (fix round 2, minor) — update has no "fall through to
  // auto-generate" escape hatch (unlike create), so a typed number that
  // normalizes to '' must be a validation error, never a silently empty
  // stored barcode.
  describe("updateProduct — normalizes-to-empty guard", () => {
    it("refuses an edit whose lines-category number normalizes to empty, instead of storing a blank barcode", () => {
      const productId = createLine("03 123 456");

      const result = service.updateProduct(productId, {
        barcode: "+961", // isolated fragment -> normalizes to ""
        name: "Line 03123456",
        category: "Phone Lines",
        cost_price: 5,
        retail_price: 15,
        min_stock_level: 1,
      });

      expect(result.success).toBe(false);
      expect(result.code).toBe("INVALID_NUMBER");
      // The stored barcode is UNCHANGED, never blanked out.
      expect(barcodeOf(productId)).toBe("03123456");
    });
  });
});
