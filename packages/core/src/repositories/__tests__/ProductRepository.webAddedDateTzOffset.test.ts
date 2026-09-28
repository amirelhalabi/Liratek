/**
 * LIRA-237 wave 2 — `ProductRepository.buildFilterClauses()`'s inventory
 * "added between" filter used to hand-roll
 * `date(p.created_at, 'localtime') >= date(?)` /
 * `date(p.created_at, 'localtime') <= date(?)` on the COLUMN side only (the
 * bound itself is already the LOCAL `YYYY-MM-DD` day the user picked, so it
 * stays a bare `date(?)` — see the surrounding comment in
 * `ProductRepository.ts`, unchanged by this fix). On a Fly web host (UTC, no
 * `TZ` pinned — rule 27), the column-side `'localtime'` resolves in the
 * CONTAINER's day, so a product added between 00:00 and 03:00 Beirut (still
 * the previous UTC day) fell outside the day the operator actually picked.
 *
 * The fix (`localDayExpr()`, `reportingTimeFragments.ts`) shifts the COLUMN
 * side by the client's offset via `localtimeModifier()` instead — same
 * mechanism as `CustomerSessionRepository.getSessionsByDateRange()`'s
 * identical column-only asymmetry (`CustomerSessionRepository
 * .webTodayTzOffset.test.ts`).
 *
 * Runs under ANY machine timezone (including CI's `TZ=Asia/Beirut` — core's
 * real test script, `cross-env TZ=Asia/Beirut jest`). The `addedFrom`/
 * `addedTo` bounds here are fixed literal `YYYY-MM-DD` strings (not `'now'`),
 * so the fix/bug-reproduction tests are fully deterministic on any host once
 * they use explicit `clientTzOffsetMinutes` instead of SQLite's
 * host-dependent `'localtime'` string: a UTC Fly host with no client offset
 * behaves EXACTLY like an explicit `clientTzOffsetMinutes: 0`
 * (`localtimeModifier()`'s numeric-minutes branch never touches
 * `'localtime'`). The no-offset desktop-fallback test computes its
 * expectation from SQLite's own `'localtime'` on THIS runner instead of
 * hardcoding a UTC-only answer.
 *
 * Rule 17: written and run BEFORE `ProductRepository.ts` is touched — the
 * "fix" tests below are expected to FAIL on the current hardcoded-'localtime'
 * code (see the recorded red run in the task report). The first test proves
 * the OLD predicate's failure directly.
 *
 * Minimal schema matches `ProductRepository.listFilters.test.ts`'s house
 * fixture (products + product_categories + product_stock_batches — the
 * latter two are only referenced by `findAllProducts`'s JOIN/correlated
 * subquery and never need seeded rows, but SQLite validates them at PREPARE
 * time regardless of row count).
 */

import Database from "better-sqlite3";
import { ProductRepository } from "../ProductRepository.js";
import { runWithTenant } from "../../db/tenantContext.js";
import type { ProductListFilters } from "../../validators/product.js";

let db: Database.Database;
let repo: ProductRepository;

function createSchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE product_categories (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER,
      name               TEXT NOT NULL,
      tracks_imei_units  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE products (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER,
      barcode            TEXT,
      name               TEXT NOT NULL,
      item_type          TEXT NOT NULL DEFAULT 'Product',
      category           TEXT,
      category_id        INTEGER,
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

    CREATE TABLE product_stock_batches (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id          INTEGER DEFAULT 1,
      product_id         INTEGER NOT NULL,
      quantity_remaining INTEGER NOT NULL,
      unit_cost_usd      DECIMAL(10,2) NOT NULL DEFAULT 0
    );
  `);
}

// A product added at 01:30 Beirut (UTC+3) on 2026-09-28, stored as UTC.
const BOUNDARY_CREATED_AT_UTC = "2026-09-27 22:30:00";
const BEIRUT_DAY = "2026-09-28";
const BEIRUT_OFFSET_MINUTES = 180;

beforeEach(() => {
  db = new Database(":memory:");
  createSchema(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  db.prepare(
    `INSERT INTO products
       (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity, is_active, is_deleted, created_at)
     VALUES (1, 'Boundary Widget', 'Product', 10, 20, 5, 1, 0, ?)`,
  ).run(BOUNDARY_CREATED_AT_UTC);
  repo = new ProductRepository();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("LIRA-237 wave 2 — ProductRepository 'added between' filter, web day boundary", () => {
  it("a UTC Fly host with no client offset (== explicit offset 0) excludes the boundary product from the Beirut day the operator picked, while a Beirut client offset (180) includes it — the bug, reproduced without depending on this runner's OS timezone", () => {
    const filters: ProductListFilters = {
      addedFrom: BEIRUT_DAY,
      addedTo: BEIRUT_DAY,
    };
    const asUtcHost = runWithTenant(
      1,
      () => repo.findAllProducts(undefined, filters),
      { clientTzOffsetMinutes: 0 },
    ).map((p) => p.name);
    const asBeirutClient = runWithTenant(
      1,
      () => repo.findAllProducts(undefined, filters),
      { clientTzOffsetMinutes: BEIRUT_OFFSET_MINUTES },
    ).map((p) => p.name);
    expect(asUtcHost).toEqual([]);
    expect(asBeirutClient).toEqual(["Boundary Widget"]);
  });

  it("findAllProducts({ addedFrom, addedTo }) includes the boundary product when the request carries the client's (Beirut) offset (the fix)", () => {
    const filters: ProductListFilters = {
      addedFrom: BEIRUT_DAY,
      addedTo: BEIRUT_DAY,
    };
    const names = runWithTenant(1, () => repo.findAllProducts(undefined, filters), {
      clientTzOffsetMinutes: BEIRUT_OFFSET_MINUTES,
    }).map((p) => p.name);
    expect(names).toEqual(["Boundary Widget"]);
  });

  it("without a client offset, findAllProducts still uses the HOST's OWN OS day (SQLite 'localtime') — the fallback is inert, not a silent fix", () => {
    // Ground truth computed from SQLite's own 'localtime' on THIS runner
    // (whatever its OS timezone is), not a hardcoded UTC-only answer.
    const { included } = db
      .prepare(
        `SELECT (date(?, 'localtime') >= date(?) AND date(?, 'localtime') <= date(?)) AS included`,
      )
      .get(
        BOUNDARY_CREATED_AT_UTC,
        BEIRUT_DAY,
        BOUNDARY_CREATED_AT_UTC,
        BEIRUT_DAY,
      ) as { included: number };

    const filters: ProductListFilters = {
      addedFrom: BEIRUT_DAY,
      addedTo: BEIRUT_DAY,
    };
    const names = runWithTenant(1, () =>
      repo.findAllProducts(undefined, filters),
    ).map((p) => p.name);
    expect(names).toEqual(included ? ["Boundary Widget"] : []);
  });

  it("the bind-side param is untouched — a bare date(?), not shifted a second time", () => {
    // The OLD predicate's param side and the NEW one must accept the exact
    // same literal 'YYYY-MM-DD' the user typed; only the COLUMN side moved.
    // Proven by the fix test above using BEIRUT_DAY verbatim as both
    // addedFrom and addedTo with no offset arithmetic applied to it.
    const filters: ProductListFilters = {
      addedFrom: BEIRUT_DAY,
      addedTo: BEIRUT_DAY,
    };
    const [captured] = (() => {
      const target = db as unknown as {
        prepare: (sql: string) => { all: (...p: unknown[]) => unknown[] };
      };
      const originalPrepare = target.prepare.bind(db);
      const out: { sql: string; params: unknown[] }[] = [];
      target.prepare = (sql: string) => {
        const stmt = originalPrepare(sql);
        const originalAll = stmt.all.bind(stmt);
        stmt.all = (...params: unknown[]): unknown[] => {
          out.push({ sql, params });
          return originalAll(...params);
        };
        return stmt;
      };
      try {
        runWithTenant(1, () => repo.findAllProducts(undefined, filters), {
          clientTzOffsetMinutes: BEIRUT_OFFSET_MINUTES,
        });
      } finally {
        delete (target as unknown as Record<string, unknown>).prepare;
      }
      return out;
    })();
    expect(captured.params).toContain(BEIRUT_DAY);
    expect(captured.sql).toContain("date(?)");
  });
});
