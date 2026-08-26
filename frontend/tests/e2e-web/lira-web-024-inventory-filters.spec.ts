/**
 * lira-web-024 — inventory product-list SERVER-SIDE filters over REST
 * (dual-transport parity, rule 19). The REST twin of the desktop
 * lira-144-inventory-filters spec.
 *
 * Scope follows the house convention for this suite (lira-web-012/021/023):
 * `page.request` drives the backend directly, because the REST layer is what
 * needs proving — `GET /api/inventory/products` with the full filter query and
 * the new `GET /api/inventory/product-filter-options`, both landing on the
 * SAME `InventoryService` / `ProductRepository` the IPC channels use. One
 * browser-UI smoke at the end proves the toolbar actually speaks that query
 * string in web mode (the adapter's `ipcOrHttp` branch), which no request-level
 * assertion can.
 *
 * Covers:
 *   (a) repeated `category=` / `supplier=` params → the plural array filters,
 *       ANDed across groups, ORed within one;
 *   (b) numeric + date bounds parse into real types and filter, with the
 *       added-date range inclusive on both ends. A row's bucket is its LOCAL
 *       calendar day (`date(p.created_at, 'localtime')` vs a bare `date(?)`
 *       bound), the app-wide business-day convention; expected day keys are
 *       computed the same way from each seed's own stored instant
 *       (`localDayKeyOf`), so a regression to UTC bucketing fails this file;
 *   (c) the `cost = 0 AND retail > 0 => 100` profit rule (PROFIT_PCT_EXPR);
 *   (d) regression: a NO-PARAMS call still returns everything (the unfiltered
 *       path must stay byte-identical to what POS and every other consumer of
 *       this route relied on before filters existed);
 *   (e) empty-param handling — `?category=` is REJECTED (HTTP 200 +
 *       `{success:false}`, rule 19c), while an empty numeric/date value is
 *       accepted and treated as absent, never coerced to a real `0` bound;
 *   (f) `GET /api/inventory/product-filter-options` — envelope shape, the
 *       seeded values, distinctness, NOCASE ordering, and auth.
 *
 * Rule 15: the web DB ACCUMULATES ACROSS RUNS (tests/e2e-web/README.md), so
 * every identity here carries a `Date.now()` stamp, every row is matched by
 * the id the create call returned or by that stamped name, and no assertion
 * reads a whole-table count or a row position. The exact-set assertions that
 * do appear are scoped to a run-unique category/supplier value, which by
 * construction no other run or spec can be a member of.
 */

import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";
import type { Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Run-unique identities
// ---------------------------------------------------------------------------

const RUN = Date.now();
const CAT_A = `LW24CatA${RUN}`;
const CAT_B = `LW24CatB${RUN}`;
const SUP_X = `LW24SupX${RUN}`;
const SUP_Y = `LW24SupY${RUN}`;

const NAME_A = `LW24 Widget A ${RUN}`;
const NAME_B = `LW24 Widget B ${RUN}`;
const NAME_C = `LW24 Widget C ${RUN}`;

interface SeedSpec {
  name: string;
  category: string;
  supplier: string;
  cost: number;
  retail: number;
  stock: number;
}

/**
 * Same 3-product matrix as the desktop spec, so a divergence between the two
 * transports shows up as a different answer to the same question:
 *
 *   name | category | supplier | cost | retail | stock | profit %
 *    A   |  CatA    |  SupX    |   10 |     20 |     5 | 100
 *    B   |  CatA    |  SupY    |   40 |     44 |    50 | 10
 *    C   |  CatB    |  SupX    |    0 |     15 |     0 | 100  (cost = 0 rule)
 */
const SEED_SPECS: SeedSpec[] = [
  {
    name: NAME_A,
    category: CAT_A,
    supplier: SUP_X,
    cost: 10,
    retail: 20,
    stock: 5,
  },
  {
    name: NAME_B,
    category: CAT_A,
    supplier: SUP_Y,
    cost: 40,
    retail: 44,
    stock: 50,
  },
  {
    name: NAME_C,
    category: CAT_B,
    supplier: SUP_X,
    cost: 0,
    retail: 15,
    stock: 0,
  },
];

interface ProductRow {
  id: number;
  name: string;
  category: string;
  supplier: string | null;
  cost_price: number;
  retail_price: number;
  stock_quantity: number;
  created_at: string;
}

interface Seeds {
  ids: Record<string, number>;
  /**
   * `date(created_at, 'localtime')` day keys of the three seeds, ascending —
   * see `localDayKeyOf`.
   */
  dayKeys: string[];
}

let seeds: Seeds | null = null;

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------

async function authHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  if (!token) throw new Error("No JWT in localStorage after loginAsAdmin");
  return { Authorization: `Bearer ${token}` };
}

/** `[["category","A"],["category","B"]]` → the repeated-param query string. */
function productsUrl(params: Array<[string, string]>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of params) qs.append(key, value);
  const query = qs.toString();
  return `${BACKEND_URL}/api/inventory/products${query ? `?${query}` : ""}`;
}

interface ProductsEnvelope {
  success: boolean;
  error?: string;
  data?: { products?: ProductRow[] };
}

async function fetchProducts(
  page: Page,
  headers: Record<string, string>,
  params: Array<[string, string]>,
): Promise<ProductsEnvelope> {
  const res = await page.request.get(productsUrl(params), { headers });
  expect(res.status(), "REST envelope parity: always HTTP 200").toBe(200);
  return (await res.json()) as ProductsEnvelope;
}

/** The seed NAMES the query returned, in no particular order (never position). */
async function namesFor(
  page: Page,
  headers: Record<string, string>,
  params: Array<[string, string]>,
): Promise<string[]> {
  const body = await fetchProducts(page, headers, params);
  expect(body.success, JSON.stringify(body)).toBeTruthy();
  const products = body.data?.products ?? [];
  const mine = new Set([NAME_A, NAME_B, NAME_C]);
  return products
    .map((p) => p.name)
    .filter((n) => mine.has(n))
    .sort();
}

function sorted(names: string[]): string[] {
  return [...names].sort();
}

async function createProduct(
  page: Page,
  headers: Record<string, string>,
  spec: SeedSpec,
): Promise<number> {
  const res = await page.request.post(`${BACKEND_URL}/api/inventory/products`, {
    headers,
    data: {
      name: spec.name,
      category: spec.category,
      supplier: spec.supplier,
      cost_price_usd: spec.cost,
      retail_price_usd: spec.retail,
      stock: spec.stock,
      min_stock_threshold: 0,
    },
  });
  const body = (await res.json()) as {
    success?: boolean;
    id?: number;
    data?: { id?: number };
    error?: string;
  };
  expect(body.success, JSON.stringify(body)).toBeTruthy();
  const id = body.data?.id ?? body.id;
  expect(id, "create must return the new product id").toBeTruthy();
  return id as number;
}

/**
 * The day bucket the filter puts a row in, derived from the row's OWN stored
 * `created_at` — never from the test machine's clock at assertion time.
 *
 * `products.created_at` is stamped by SQLite's `CURRENT_TIMESTAMP` (UTC) and
 * the filter compares `date(p.created_at, 'localtime')` against a bare
 * `date(?)` bound, so the bucket is the LOCAL calendar day of that UTC
 * instant. Reproduce exactly that: parse the stored value EXPLICITLY as UTC,
 * then read the LOCAL calendar components back out (the same `toLocalDay`
 * formatting the shared DateRangeFilter uses to produce a bound).
 *
 * Never `new Date(createdAt)`: JS reads the bare 'YYYY-MM-DD HH:MM:SS' form as
 * LOCAL, which would silently subtract the machine offset — the exact trap
 * `parseDbDate` and lira-100 exist for. Handles both storage forms the column
 * holds ('YYYY-MM-DD HH:MM:SS' and the ISO 'YYYY-MM-DDTHH:MM:SS.sssZ').
 *
 * Because every bound below is a pure function of a seed's own instant, this
 * has no hour-of-day dependency and no seed-vs-assert race. The one
 * assumption left is inherent to the feature: SQLite's `'localtime'` (the
 * backend process's OS timezone) and this test process resolve the same zone.
 */
function localDayKeyOf(createdAt: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(
    createdAt,
  );
  if (!parts) {
    throw new Error(
      `lira-web-024: unrecognised created_at format "${createdAt}"`,
    );
  }
  const [, year, month, day, hour, minute, second] = parts;
  const at = new Date(
    Date.UTC(+year, +month - 1, +day, +hour, +minute, +second),
  );
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * Seed once per file run and reuse across tests — the backend and its DB are
 * shared by every test in this suite, even though each test gets its own
 * browser page and JWT.
 */
async function ensureSeeds(
  page: Page,
  headers: Record<string, string>,
): Promise<Seeds> {
  if (seeds) return seeds;

  const ids: Record<string, number> = {};
  for (const spec of SEED_SPECS) {
    ids[spec.name] = await createProduct(page, headers, spec);
  }

  // Read the rows back through the route under test, scoped by the run-unique
  // categories, and derive each row's local-day bucket from its own instant.
  const body = await fetchProducts(page, headers, [
    ["category", CAT_A],
    ["category", CAT_B],
  ]);
  expect(body.success, JSON.stringify(body)).toBeTruthy();
  const rows = body.data?.products ?? [];
  const dayKeys = SEED_SPECS.map((spec) => {
    const row = rows.find((r) => r.id === ids[spec.name]);
    if (!row?.created_at) {
      throw new Error(`lira-web-024: seed "${spec.name}" has no created_at`);
    }
    return localDayKeyOf(row.created_at);
  }).sort();

  seeds = { ids, dayKeys };
  return seeds;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("LIRA-144 — inventory product-list filters over REST", () => {
  test("(a) repeated category/supplier params filter, OR within a group and AND across groups", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const headers = await authHeaders(page);
    await ensureSeeds(page, headers);

    // One run-unique category — the result set is exactly A and B, so this is
    // an exact assertion without ever touching a global count.
    expect(await namesFor(page, headers, [["category", CAT_A]])).toEqual(
      sorted([NAME_A, NAME_B]),
    );

    // Two categories — OR within the group.
    expect(
      await namesFor(page, headers, [
        ["category", CAT_A],
        ["category", CAT_B],
      ]),
    ).toEqual(sorted([NAME_A, NAME_B, NAME_C]));

    // Supplier alone: SupX is A and C.
    expect(await namesFor(page, headers, [["supplier", SUP_X]])).toEqual(
      sorted([NAME_A, NAME_C]),
    );

    // ANDed across groups: CatA ∩ SupX = A only.
    expect(
      await namesFor(page, headers, [
        ["category", CAT_A],
        ["supplier", SUP_X],
      ]),
    ).toEqual([NAME_A]);

    // …and it ANDs with the free-text search too.
    expect(
      await namesFor(page, headers, [
        ["category", CAT_A],
        ["search", "Widget B"],
      ]),
    ).toEqual([NAME_B]);
  });

  test("(b) numeric and date bounds parse and filter; the added range is inclusive both ends", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const headers = await authHeaders(page);
    const { dayKeys } = await ensureSeeds(page, headers);
    const firstDay = dayKeys[0];
    const lastDay = dayKeys[dayKeys.length - 1];
    const bothCategories: Array<[string, string]> = [
      ["category", CAT_A],
      ["category", CAT_B],
    ];

    // costMin — a string "30" reaching the binder would compare as text.
    expect(
      await namesFor(page, headers, [...bothCategories, ["costMin", "30"]]),
    ).toEqual([NAME_B]);

    // stockMax=0 — a real bound, not a dropped falsy value.
    expect(
      await namesFor(page, headers, [...bothCategories, ["stockMax", "0"]]),
    ).toEqual([NAME_C]);

    expect(
      await namesFor(page, headers, [...bothCategories, ["retailMax", "20"]]),
    ).toEqual(sorted([NAME_A, NAME_C]));

    // Inclusive on BOTH ends: the seeds sit exactly on the bounds.
    expect(
      await namesFor(page, headers, [
        ...bothCategories,
        ["addedFrom", firstDay],
        ["addedTo", lastDay],
      ]),
    ).toEqual(sorted([NAME_A, NAME_B, NAME_C]));

    // Each bound is a real bound on its own.
    expect(
      await namesFor(page, headers, [
        ...bothCategories,
        ["addedFrom", shiftDay(lastDay, 1)],
      ]),
    ).toEqual([]);
    expect(
      await namesFor(page, headers, [
        ...bothCategories,
        ["addedTo", shiftDay(firstDay, -1)],
      ]),
    ).toEqual([]);
  });

  test("(c) profit % uses the displayed formula: cost 0 with retail > 0 counts as 100", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const headers = await authHeaders(page);
    await ensureSeeds(page, headers);
    const bothCategories: Array<[string, string]> = [
      ["category", CAT_A],
      ["category", CAT_B],
    ];

    // C (cost 0, retail 15) MUST come back — the discriminating assertion for
    // PROFIT_PCT_EXPR's zero-cost branch. A NULL/skip there would drop it
    // (`NULL >= 100` is not true) while every exclusion assertion still passed.
    expect(
      await namesFor(page, headers, [
        ...bothCategories,
        ["profitPctMin", "100"],
      ]),
    ).toEqual(sorted([NAME_A, NAME_C]));

    expect(
      await namesFor(page, headers, [
        ...bothCategories,
        ["profitPctMax", "50"],
      ]),
    ).toEqual([NAME_B]);
  });

  test("(d) a no-params call still returns the seeds — the unfiltered path is unchanged", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const headers = await authHeaders(page);
    await ensureSeeds(page, headers);

    // No query string AT ALL (not even an empty one) — the pre-filter contract.
    const body = await fetchProducts(page, headers, []);
    expect(body.success, JSON.stringify(body)).toBeTruthy();
    const names = new Set((body.data?.products ?? []).map((p) => p.name));
    for (const name of [NAME_A, NAME_B, NAME_C]) {
      expect(names.has(name), `${name} must be in the unfiltered list`).toBe(
        true,
      );
    }
  });

  test("(e) an empty ?category= is rejected; empty numeric/date params are treated as absent", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const headers = await authHeaders(page);
    await ensureSeeds(page, headers);

    // Rule 19c: validation failure = HTTP 200 + a string error, never a 4xx.
    const rejected = await fetchProducts(page, headers, [["category", ""]]);
    expect(rejected.success).toBe(false);
    expect(typeof rejected.error).toBe("string");
    expect(rejected.data).toBeUndefined();

    const rejectedSupplier = await fetchProducts(page, headers, [
      ["supplier", ""],
    ]);
    expect(rejectedSupplier.success).toBe(false);

    // A cleared <input type="number"> submits ''. Coercing it to 0 would turn
    // these three MAX bounds into `<= 0` and empty the result — getting A and
    // B back is what proves '' was dropped rather than coerced.
    expect(
      await namesFor(page, headers, [
        ["category", CAT_A],
        ["costMax", ""],
        ["retailMax", ""],
        ["stockMax", ""],
        ["addedFrom", ""],
        ["addedTo", ""],
      ]),
    ).toEqual(sorted([NAME_A, NAME_B]));

    // A non-numeric bound is a rejection, not a silent NaN in the SQL.
    const nonNumeric = await fetchProducts(page, headers, [["costMin", "abc"]]);
    expect(nonNumeric.success).toBe(false);
    expect(typeof nonNumeric.error).toBe("string");
  });

  test("(f) GET /api/inventory/product-filter-options: shape, values, ordering, auth", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const headers = await authHeaders(page);
    await ensureSeeds(page, headers);

    const res = await page.request.get(
      `${BACKEND_URL}/api/inventory/product-filter-options`,
      { headers },
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data?: { categories?: string[]; suppliers?: string[] };
    };
    expect(body.success, JSON.stringify(body)).toBeTruthy();
    const categories = body.data?.categories;
    const suppliers = body.data?.suppliers;
    expect(Array.isArray(categories)).toBe(true);
    expect(Array.isArray(suppliers)).toBe(true);

    for (const value of [CAT_A, CAT_B]) expect(categories).toContain(value);
    for (const value of [SUP_X, SUP_Y]) expect(suppliers).toContain(value);

    // Distinct and non-empty (properties, never absolute counts — the DB
    // accumulates across runs).
    expect(categories).not.toContain("");
    expect(suppliers).not.toContain("");
    expect(new Set(categories).size).toBe(categories!.length);
    expect(new Set(suppliers).size).toBe(suppliers!.length);

    // NOCASE ordering, asserted only across values this run owns.
    expect(categories!.indexOf(CAT_A)).toBeLessThan(categories!.indexOf(CAT_B));
    expect(suppliers!.indexOf(SUP_X)).toBeLessThan(suppliers!.indexOf(SUP_Y));

    // Authentication is required (router-level authenticateJWT).
    const anon = await page.request.get(
      `${BACKEND_URL}/api/inventory/product-filter-options`,
    );
    expect(anon.status()).toBe(401);
    const anonBody = (await anon.json()) as { success?: boolean };
    expect(anonBody.success).not.toBe(true);
  });

  test("(g) UI smoke: the /products toolbar filters over REST in the browser", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const headers = await authHeaders(page);
    await ensureSeeds(page, headers);

    await page.goto("/#/products");
    await expect(page.getByRole("button", { name: "Add Product" })).toBeVisible(
      { timeout: 20_000 },
    );

    const row = (name: string) =>
      page.locator("tbody tr").filter({ hasText: name });

    // Scope the list to THIS run's three products first. The table paginates
    // at 20 rows and this DB accumulates across runs, so an unscoped list
    // could push a seed onto page 2 and make an absence assertion vacuous.
    await page.getByPlaceholder(/search by name, barcode/i).fill(String(RUN));
    for (const name of [NAME_A, NAME_B, NAME_C]) {
      await expect(row(name)).toHaveCount(1, { timeout: 20_000 });
    }

    // The dropdown is fed by GET /api/inventory/product-filter-options over
    // HTTP — the run-unique category can only be there if that call succeeded.
    await page.getByTestId("inventory-filter-category").click();
    await page.getByTestId(`inventory-filter-category-option-${CAT_A}`).click();
    await page.getByTestId("inventory-filter-category").click(); // close panel

    // Server-side filtering through the browser's own GET: A and B in, C out.
    // toHaveCount auto-retries, which covers the 300 ms debounce + reload.
    await expect(row(NAME_C), `${NAME_C} must be filtered OUT`).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(row(NAME_A)).toHaveCount(1, { timeout: 20_000 });
    await expect(row(NAME_B)).toHaveCount(1, { timeout: 20_000 });
    await expect(
      page.getByTestId("inventory-filter-chip-categories"),
    ).toContainText(CAT_A);

    // "Clear all" drops the filter but NOT the search box, so the list goes
    // back to exactly the three seeds — C returning proves the reload is
    // re-issued server-side rather than filtered away in the renderer.
    await page.getByTestId("inventory-filters-clear").click();
    await expect(
      page.getByTestId("inventory-filter-chip-categories"),
    ).toHaveCount(0);
    await expect(row(NAME_C)).toHaveCount(1, { timeout: 20_000 });
    await expect(row(NAME_A)).toHaveCount(1);
    await expect(row(NAME_B)).toHaveCount(1);
  });
});

/**
 * Shift a `YYYY-MM-DD` day key by whole calendar days. Pure arithmetic on the
 * key itself — the UTC constructor is used precisely so a DST transition in
 * the local zone cannot make "+1 day" land on the same or a skipped date.
 */
function shiftDay(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
