/**
 * Inventory product WRITE routes — category NAME → `products.category_id`
 * resolution over REST (dual-transport parity, rule 14/19b).
 *
 * The gap this guards: `inventory:create-product` / `inventory:update-product`
 * (electron-app/handlers/inventoryHandlers.ts) used to resolve the category
 * id themselves (`catRepo.getOrCreate(name)`) and hand the service a ready
 * `category_id`, while `POST/PUT /api/inventory/products` passed the NAME
 * straight through. A web-created product therefore had `category_id` NULL,
 * so `tracks_imei_units` (COALESCE'd off the joined category on EVERY
 * product read) was always 0 for it — and a web EDIT of a desktop-created
 * product actively NULLed a correct id, since `updateProductFull` writes
 * that column unconditionally. The resolution now lives ONE layer down, in
 * `InventoryService`, so both transports get it from the same call — the two
 * `catRepo.getOrCreate` blocks in the IPC handlers are gone (rule 14).
 *
 * Also pins the UPDATE contract this route is the only way to reach: a PUT
 * body with NO `category` leaves the product's stored category/category_id
 * untouched (`COALESCE(?, …)` with NULL bound), rather than NULLing them or
 * inventing a 'General' category.
 *
 * Pattern: the REAL router + the REAL core service singleton (only
 * ../../middleware/auth.js is faked, header-driven `x-test-role`, as in
 * inventoryProductList.api.test.ts). What differs is the instrument: these
 * cases are about the SQL the service emits, so instead of stubbing the
 * service this file drives the shared better-sqlite3 mock
 * (backend/src/__mocks__/better-sqlite3.ts — the same instrument
 * src/__tests__/inventory_stockstats_excludes_virtual.test.ts uses) and
 * asserts on the recorded statements and their bound parameters.
 *
 * Scope note: the backend jest env maps `better-sqlite3` to that mock, so
 * the end-to-end projection (`tracks_imei_units` = 1 on the product READ)
 * cannot be observed here — it is proven over a REAL in-memory DB in
 * packages/core/src/services/__tests__/InventoryService.categoryResolution.test.ts.
 */

import { jest } from "@jest/globals";

/**
 * NOT tenant 1 — deliberately. `backend/src/jest.setup.ts` calls
 * `initFixedTenantContext(1)` before every test, so a mock that only sets
 * `req.user.tenantId` and never scopes the request would make every tenant
 * assertion below pass off that fallback: the `1` in the bound params would
 * prove nothing, and REST tenant propagation could be entirely broken while
 * the suite stayed green. Driving a non-1 tenant through a real
 * `runWithTenant` (what the production middleware does — see
 * backend/src/middleware/auth.ts:210) is what makes those assertions able to
 * fail.
 */
const TEST_TENANT_ID = 4711;

jest.mock("../../middleware/auth.js", () => {
  // Required inside the factory (jest hoists this above the imports).
  const { runWithTenant } =
    require("@liratek/core") as typeof import("@liratek/core");
  const authenticateJWT = (req: any, res: any, next: any) => {
    const role = req.headers["x-test-role"];
    if (!role) {
      res.status(401).json({ success: false, error: "No token provided" });
      return;
    }
    req.user = {
      userId: 7,
      username: "tester",
      role,
      tenantId: TEST_TENANT_ID,
      sessionToken: "test-session",
    };
    // Mirrors the real middleware: bind the JWT's tenant to the whole
    // downstream chain. Every repository call in the request (all synchronous
    // better-sqlite3) then resolves getCurrentTenantId() to THIS tenant.
    runWithTenant(TEST_TENANT_ID, () => next());
  };
  const requireRole = (roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: "Not authenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    next();
  };
  return { authenticateJWT, requireAuth: authenticateJWT, requireRole };
});

import express, { type Express } from "express";
import request from "supertest";
import inventoryRouter from "../inventory.js";
import {
  mockDatabase,
  mockStatement,
  resetAllMocks,
} from "../../__mocks__/better-sqlite3";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/inventory", inventoryRouter);
  return app;
}

interface Recorded {
  sql: string;
  args: unknown[];
  /** `lastInsertRowid` this statement handed back (writes only). */
  rowid?: number;
}

/** Statement `this` as the shared mock builds it (`{...mockStatement, _sql}`). */
interface StatementThis {
  _sql: string;
}

const CATEGORY_LOOKUP_MARKER = "FROM product_categories";
const CATEGORY_INSERT_MARKER = "INSERT INTO product_categories";
const PRODUCT_INSERT_MARKER = "INSERT INTO products";
const PRODUCT_UPDATE_MARKER = "UPDATE products SET";

describe("Inventory product write routes — category_id resolution", () => {
  let app: Express;
  let runs: Recorded[];
  let reads: Recorded[];
  let nextRowId: number;
  /** What the tenant-scoped category lookup finds (undefined = not there). */
  let existingCategory: { id: number } | undefined;

  beforeEach(() => {
    app = buildApp();
    resetAllMocks();
    runs = [];
    reads = [];
    nextRowId = 500;
    existingCategory = undefined;
    (
      globalThis as unknown as { __LIRATEK_TEST_DB__: unknown }
    ).__LIRATEK_TEST_DB__ = mockDatabase;

    mockStatement.run.mockImplementation(function (
      this: StatementThis,
      ...args: unknown[]
    ) {
      const rowid = nextRowId++;
      runs.push({ sql: this._sql, args, rowid });
      return { changes: 1, lastInsertRowid: rowid };
    });

    mockStatement.get.mockImplementation(function (
      this: StatementThis,
      ...args: unknown[]
    ) {
      const sql = this._sql;
      reads.push({ sql, args });
      if (sql.includes(CATEGORY_LOOKUP_MARKER)) return existingCategory;
      // `exists(id)` — the product being updated is there.
      if (sql.includes("SELECT 1 FROM products WHERE id =")) return { 1: 1 };
      // Everything else (barcodeExists, findById for the audit snapshot)
      // reports "nothing found".
      return undefined;
    });
  });

  function find(marker: string): Recorded | undefined {
    return runs.find((r) => r.sql.includes(marker));
  }

  describe("POST /api/inventory/products", () => {
    const body = {
      name: "L143 REST Phone",
      category: "Phones-ish new name",
      barcode: "REST-1111",
      cost_price_usd: 100,
      retail_price_usd: 200,
      stock: 2,
      min_stock_threshold: 1,
      warranty_months: 12,
    };

    it("resolves the category NAME (find-or-create, tenant-scoped) and stamps the id on the product", async () => {
      const res = await request(app)
        .post("/api/inventory/products")
        .set("x-test-role", "admin")
        .send(body);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      // (1) the tenant-scoped, case-insensitive lookup happened at all…
      const lookup = reads.find((r) => r.sql.includes(CATEGORY_LOOKUP_MARKER));
      expect(lookup).toBeDefined();
      expect(lookup!.sql).toContain("COLLATE NOCASE");
      expect(lookup!.sql).toContain("tenant_id = ?");
      // …bound to the JWT's tenant, not to the desktop fixed fallback.
      expect(lookup!.args).toEqual(["Phones-ish new name", TEST_TENANT_ID]);

      // (2) …it missed, so the category was created…
      const categoryInsert = find(CATEGORY_INSERT_MARKER);
      expect(categoryInsert).toBeDefined();
      expect(categoryInsert!.args[0]).toBe("Phones-ish new name");

      // (3) …and the product carries THAT id, not NULL.
      const productInsert = find(PRODUCT_INSERT_MARKER);
      expect(productInsert).toBeDefined();
      // INSERT column order: barcode, name, category, category_id, …
      expect(productInsert!.args[2]).toBe("Phones-ish new name");
      expect(productInsert!.args[3]).toBe(categoryInsert!.rowid);
    });

    it("reuses an existing category case-insensitively — no duplicate row", async () => {
      existingCategory = { id: 4242 };

      const res = await request(app)
        .post("/api/inventory/products")
        .set("x-test-role", "admin")
        .send({ ...body, category: "PHONES-ISH NEW NAME" });

      expect(res.status).toBe(201);
      expect(find(CATEGORY_INSERT_MARKER)).toBeUndefined();
      const productInsert = find(PRODUCT_INSERT_MARKER);
      expect(productInsert!.args[3]).toBe(4242);
    });

    it("still enforces the admin gate — no role, no SQL", async () => {
      const res = await request(app).post("/api/inventory/products").send(body);

      expect(res.status).toBe(401);
      expect(mockDatabase.prepare).not.toHaveBeenCalled();
    });
  });

  describe("PUT /api/inventory/products/:id", () => {
    // The web edit form posts the IPC-shaped payload (see
    // frontend/src/api/backendApi.ts `updateProduct`), which is why this
    // route hands req.body to the service as-is.
    const body = {
      barcode: "REST-2222",
      name: "L143 REST Phone (edited)",
      category: "Phones",
      cost_price: 110,
      retail_price: 220,
      min_stock_level: 5,
      stock_quantity: 3,
      warranty_months: 12,
    };

    it("re-resolves category_id instead of NULLing it out", async () => {
      existingCategory = { id: 4242 };

      const res = await request(app)
        .put("/api/inventory/products/77")
        .set("x-test-role", "admin")
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const lookup = reads.find((r) => r.sql.includes(CATEGORY_LOOKUP_MARKER));
      expect(lookup?.args).toEqual(["Phones", TEST_TENANT_ID]);

      const update = find(PRODUCT_UPDATE_MARKER);
      expect(update).toBeDefined();
      // SET order: barcode, name, category, category_id, …
      expect(update!.args[2]).toBe("Phones");
      expect(update!.args[3]).toBe(4242);
    });

    it("creates the category on update when the name is new", async () => {
      const res = await request(app)
        .put("/api/inventory/products/77")
        .set("x-test-role", "admin")
        .send({ ...body, category: "Phones-ish new name" });

      expect(res.status).toBe(200);
      const categoryInsert = find(CATEGORY_INSERT_MARKER);
      expect(categoryInsert).toBeDefined();
      expect(categoryInsert!.args[0]).toBe("Phones-ish new name");
      const update = find(PRODUCT_UPDATE_MARKER);
      expect(update!.args[3]).toBe(categoryInsert!.rowid);
    });

    it("keeps the stored category when the body names none (this route has no schema)", async () => {
      // The one transport that can reach this: `PUT /products/:id` has no
      // `validateRequest`, so `category` really can be absent (the IPC twin
      // is rejected by ProductUpdateSchema). Contract: omitted = UNCHANGED —
      // not NULLed (HEAD) and not reclassified into an invented 'General'.
      const res = await request(app)
        .put("/api/inventory/products/77")
        .set("x-test-role", "admin")
        .send({
          barcode: "REST-3333",
          name: "L143 REST Phone (no category in body)",
          cost_price: 110,
          retail_price: 220,
          min_stock_level: 5,
          stock_quantity: 3,
          warranty_months: 12,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // No find-or-create ran at all…
      expect(
        reads.find((r) => r.sql.includes(CATEGORY_LOOKUP_MARKER)),
      ).toBeUndefined();
      expect(find(CATEGORY_INSERT_MARKER)).toBeUndefined();
      // …and the UPDATE binds NULL into both COALESCEs, i.e. keeps the row's
      // current category/category_id.
      const update = find(PRODUCT_UPDATE_MARKER);
      expect(update).toBeDefined();
      expect(update!.sql).toContain("category = COALESCE(?, category)");
      expect(update!.sql).toContain("category_id = COALESCE(?, category_id)");
      expect(update!.args[2]).toBeNull();
      expect(update!.args[3]).toBeNull();
    });
  });
});
