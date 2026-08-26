/**
 * E2E: LIRA-144 — inventory product-list SERVER-SIDE filters
 * (implementation: b84c67b8 core SQL + 44eb2d17 IPC/REST/toolbar UI).
 *
 * Drives the REAL /products toolbar — the category/supplier MultiSelects, the
 * Added date range, the numeric "Filters" popover, the chips and "Clear all" —
 * never a hand-built IPC payload. That is the whole point: the filtering is
 * done in SQL (`ProductRepository.buildFilterClauses`), so the only thing an
 * IPC-level test could prove is that the repository does what its own jest
 * suite already pins. What is NOT covered anywhere else is the seam:
 * toolbar state → `buildProductListFilters` → `useApi().getProducts(search,
 * filters)` → `inventory:get-products` → Zod → service → SQL → rendered rows.
 *
 * Guards:
 *  - Category multi-select: one value narrows the list, a second value WIDENS
 *    it (OR within the group), deselecting narrows it back, and the group's
 *    chip ✕ clears exactly that group.
 *  - Supplier ANDs with category (a product must satisfy BOTH groups).
 *  - Every filter ANDs with the free-text search box, which "Clear all"
 *    deliberately does NOT reset.
 *  - Numeric popover: cost / profit% / stock bounds, the button's active-count
 *    badge, the per-group chips, and the popover's own Reset.
 *  - The `cost = 0 AND retail > 0 => 100%` profit rule (PROFIT_PCT_EXPR) is
 *    proven by a DISCRIMINATING assertion: the zero-cost product must be
 *    RETURNED by `profitPctMin = 100`. A regression to NULL/skip for zero-cost
 *    rows would drop it (`NULL >= 100` is not true) while every "excluded"
 *    assertion in this file would still pass.
 *  - Added date range: inclusive on BOTH ends, and each bound is a real bound
 *    (from = day+1 and to = day-1 each empty the list on their own). A row's
 *    bucket is its LOCAL calendar day — `date(p.created_at, 'localtime')`
 *    against a bare `date(?)` bound — matching the app-wide business-day
 *    convention lira-102/lira-103 guard for money. Expected day keys are
 *    computed the same way, from each seed's own stored instant
 *    (`localDayKeyOf`), so a regression to UTC bucketing fails this file on
 *    any machine with a non-zero offset for part of every 24h.
 *  - The dropdowns are fed by the new `inventory:get-product-filter-options`
 *    channel: distinct, non-empty, NOCASE-ordered.
 *
 * Rule 15 (ONE accumulating DB, specs run in order, alphabetically):
 *  - NOTHING here asserts row position, "newest row", or a whole-table count.
 *    Every assertion is `toHaveCount(1)` / `toHaveCount(0)` on a row matched by
 *    a NAME that exists nowhere else in the suite (`L144 Widget A|B|C`), and
 *    the categories/suppliers filtered on (`L144CatA/B`, `L144SupX/Y`) are
 *    likewise grepped-unique to this file — so filtering by them cannot pick
 *    up another spec's residue, and the visible-row sets below are exact.
 *  - The `L144` prefix is used unstamped (no `Date.now()`): the per-worker DB
 *    is created FRESH at worker start (fixtures.ts unlinks TEST_DB_PATH), the
 *    prefix appears in no other file, and `retries: 0` means no test body ever
 *    runs twice — so the three seeds are created exactly once per run.
 *  - Seeds are memoized in `ensureSeeds` and shared by all six tests; each test
 *    re-navigates to /products, which forces a genuine remount (navigateTo's
 *    same-route bounce) and therefore a clean, empty filter state.
 *
 * Rule 17 (failing-first procedure for the verifier): in
 * `packages/core/src/repositories/ProductRepository.ts`, make
 * `buildFilterClauses` return `{ sql: "", params: [] }` unconditionally
 * (leave the search clause alone), rebuild core + sync into
 * `node_modules/@liratek/core`, re-run. Every "filtered out" assertion in
 * this file fails (the excluded rows stay listed) while the search-scoped
 * "all three visible" assertions still pass — i.e. the file fails for the
 * right reason. Restore afterward. For the profit rule specifically, change
 * PROFIT_PCT_EXPR's `WHEN p.selling_price_usd > 0 THEN 100` branch to
 * `THEN NULL`: only the `profitPctMin = 100` assertion on "L144 Widget C"
 * flips.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

// ---------------------------------------------------------------------------
// Spec-scoped identities (see the rule-15 note above)
// ---------------------------------------------------------------------------

const CAT_A = "L144CatA";
const CAT_B = "L144CatB";
const SUP_X = "L144SupX";
const SUP_Y = "L144SupY";

const NAME_A = "L144 Widget A";
const NAME_B = "L144 Widget B";
const NAME_C = "L144 Widget C";

/** Free-text term that matches all three seeds and nothing else in the suite. */
const SEARCH_SCOPE = "L144";

interface SeedSpec {
  name: string;
  category: string;
  supplier: string;
  cost: number;
  retail: number;
  stock: number;
}

/**
 * Three products spanning every filter dimension at once:
 *
 *   name | category | supplier | cost | retail | stock | profit %
 *   -----|----------|----------|------|--------|-------|---------
 *    A   |  CatA    |  SupX    |   10 |     20 |     5 | 100
 *    B   |  CatA    |  SupY    |   40 |     44 |    50 | 10
 *    C   |  CatB    |  SupX    |    0 |     15 |     0 | 100  (cost = 0 rule)
 *
 * Chosen so that EVERY bound used below splits the set 1-vs-2 or 2-vs-1 — a
 * filter that silently did nothing would leave all three listed and fail.
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

const ALL_NAMES = [NAME_A, NAME_B, NAME_C];

interface SeededProduct {
  id: number;
  name: string;
  /**
   * `date(created_at, 'localtime')` as SQLite itself computes it — see
   * `localDayKeyOf` and `ensureSeeds`.
   */
  dayKey: string;
}

let seeded: SeededProduct[] | null = null;

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
 * assumption left is inherent to the feature: SQLite's `'localtime'` and this
 * process resolve the same OS timezone (they are the same machine).
 */
function localDayKeyOf(createdAt: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(
    createdAt,
  );
  if (!parts) {
    throw new Error(`LIRA-144: unrecognised created_at format "${createdAt}"`);
  }
  const [, year, month, day, hour, minute, second] = parts;
  const at = new Date(
    Date.UTC(+year, +month - 1, +day, +hour, +minute, +second),
  );
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * Create the three products once per run (IPC — this is seeding, not the
 * behaviour under test) and read each one back for its stored `created_at`.
 */
async function ensureSeeds(appPage: Page): Promise<SeededProduct[]> {
  if (seeded) return seeded;

  const rows: SeededProduct[] = [];
  for (const spec of SEED_SPECS) {
    const created = await appPage.evaluate(
      (p) =>
        window.api.inventory.createProduct({
          barcode: "",
          name: p.name,
          category: p.category,
          cost_price: p.cost,
          retail_price: p.retail,
          stock_quantity: p.stock,
          min_stock_level: 0,
          supplier: p.supplier,
        }),
      spec,
    );
    if (!created.success || created.id == null) {
      throw new Error(
        `LIRA-144 seed "${spec.name}" failed: ${created.error ?? "no id returned"}`,
      );
    }

    const row = await appPage.evaluate(
      (id) => window.api.inventory.getProduct(id),
      created.id,
    );
    if (!row?.created_at) {
      throw new Error(`LIRA-144 seed "${spec.name}" has no created_at`);
    }
    rows.push({
      id: created.id,
      name: spec.name,
      dayKey: localDayKeyOf(row.created_at),
    });
  }

  seeded = rows;
  return seeded;
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/** One table row, matched by a product NAME unique to this spec (rule 15). */
function productRow(appPage: Page, name: string) {
  return appPage.locator("tbody tr").filter({ hasText: name });
}

/**
 * Assert exactly which seeds the server returned.
 *
 * `toHaveCount` auto-retries, which is how every filter change here waits out
 * the 300 ms debounce + reload — no fixed sleeps anywhere in this file. The
 * "filtered out" side is asserted FIRST because it is the assertion that must
 * outlive the pending reload; checking a still-listed row first would pass
 * against the stale list.
 */
async function expectListed(
  appPage: Page,
  listed: string[],
  filteredOut: string[],
): Promise<void> {
  for (const name of filteredOut) {
    await expect(
      productRow(appPage, name),
      `${name} must be filtered OUT`,
    ).toHaveCount(0, { timeout: 15_000 });
  }
  for (const name of listed) {
    await expect(
      productRow(appPage, name),
      `${name} must be listed`,
    ).toHaveCount(1, { timeout: 15_000 });
  }
}

function searchBox(appPage: Page) {
  return appPage.getByPlaceholder(/search by name, barcode/i);
}

/** Narrow the list to this spec's three seeds before exercising a filter. */
async function scopeToSeeds(appPage: Page): Promise<void> {
  await searchBox(appPage).fill(SEARCH_SCOPE);
  await expectListed(appPage, ALL_NAMES, []);
}

/**
 * Toggle one value in a MultiSelect. The Headless UI Listbox is `multiple`, so
 * the panel stays open after a pick and clicking the button again closes it —
 * which matters because the portalled panel is anchored directly over the chip
 * row and would otherwise intercept a chip click.
 */
async function toggleMultiSelect(
  appPage: Page,
  testId: string,
  value: string,
): Promise<void> {
  await appPage.getByTestId(testId).click();
  await appPage.getByTestId(`${testId}-option-${value}`).click();
  await appPage.getByTestId(testId).click();
  // Confirm the panel actually went away. Without this, a panel that stayed
  // open would surface much later as an opaque "element intercepts pointer
  // events" on an unrelated chip click.
  await expect(appPage.getByTestId(`${testId}-option-${value}`)).toHaveCount(0);
}

function chip(appPage: Page, key: string) {
  return appPage.getByTestId(`inventory-filter-chip-${key}`);
}

/** Click a chip's ✕ — clears exactly that filter GROUP. */
async function clearChip(appPage: Page, key: string): Promise<void> {
  await chip(appPage, key).locator("button").click();
  await expect(chip(appPage, key)).toHaveCount(0);
}

async function openFiltersPopover(appPage: Page): Promise<void> {
  await appPage.getByTestId("inventory-filters-button").click();
  await expect(appPage.getByTestId("inventory-filter-cost-min")).toBeVisible();
}

async function closeFiltersPopover(appPage: Page): Promise<void> {
  await appPage.getByTestId("inventory-filters-button").click();
  await expect(appPage.getByTestId("inventory-filter-cost-min")).toHaveCount(0);
}

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("LIRA-144 — inventory product-list server-side filters", () => {
  test("category multi-select: narrows, widens with a second value, chip clears the group", async ({
    appPage,
  }) => {
    await ensureSeeds(appPage);
    await navigateTo(appPage, "/products");
    await scopeToSeeds(appPage);

    // One category — A and B are in CatA, C is not.
    await toggleMultiSelect(appPage, "inventory-filter-category", CAT_A);
    await expectListed(appPage, [NAME_A, NAME_B], [NAME_C]);
    await expect(chip(appPage, "categories")).toContainText(
      `Category: ${CAT_A}`,
    );

    // A second value WIDENS the group (OR within a group, AND across groups).
    await toggleMultiSelect(appPage, "inventory-filter-category", CAT_B);
    await expectListed(appPage, ALL_NAMES, []);
    await expect(chip(appPage, "categories")).toContainText(CAT_B);

    // Deselecting the second value narrows it back — proves the payload is
    // rebuilt from the live selection, not appended to.
    await toggleMultiSelect(appPage, "inventory-filter-category", CAT_B);
    await expectListed(appPage, [NAME_A, NAME_B], [NAME_C]);

    // The chip's ✕ clears the whole group, so C comes back.
    await clearChip(appPage, "categories");
    await expectListed(appPage, ALL_NAMES, []);
  });

  test("supplier filter ANDs with the category filter", async ({ appPage }) => {
    await ensureSeeds(appPage);
    await navigateTo(appPage, "/products");
    await scopeToSeeds(appPage);

    await toggleMultiSelect(appPage, "inventory-filter-category", CAT_A);
    await expectListed(appPage, [NAME_A, NAME_B], [NAME_C]);

    // SupX alone would match A and C; CatA alone matches A and B. ANDed, only
    // A survives — so a broken AND (either group ignored, or the groups ORed)
    // leaves an extra row and fails.
    await toggleMultiSelect(appPage, "inventory-filter-supplier", SUP_X);
    await expectListed(appPage, [NAME_A], [NAME_B, NAME_C]);
    await expect(chip(appPage, "suppliers")).toContainText(
      `Supplier: ${SUP_X}`,
    );
    await expect(chip(appPage, "categories")).toBeVisible();

    // Clearing ONE group leaves the other one applied.
    await clearChip(appPage, "suppliers");
    await expectListed(appPage, [NAME_A, NAME_B], [NAME_C]);
    await expect(chip(appPage, "categories")).toBeVisible();
  });

  test("numeric popover: cost / stock bounds, active-count badge, chips and Reset", async ({
    appPage,
  }) => {
    await ensureSeeds(appPage);
    await navigateTo(appPage, "/products");
    await scopeToSeeds(appPage);

    // Cost >= 30 — only B ($40). A ($10) and C ($0) drop out.
    await openFiltersPopover(appPage);
    await appPage.getByTestId("inventory-filter-cost-min").fill("30");
    await closeFiltersPopover(appPage);
    await expectListed(appPage, [NAME_B], [NAME_A, NAME_C]);
    await expect(chip(appPage, "cost")).toContainText("Cost: ≥ $30");
    await expect(appPage.getByTestId("inventory-filters-button")).toHaveText(
      /Filters\s*1/,
    );

    // The popover's own Reset blanks every numeric bound (and nothing else).
    await openFiltersPopover(appPage);
    await appPage.getByTestId("inventory-filters-reset").click();
    await closeFiltersPopover(appPage);
    await expectListed(appPage, ALL_NAMES, []);
    await expect(chip(appPage, "cost")).toHaveCount(0);
    await expect(appPage.getByTestId("inventory-filters-button")).toHaveText(
      /^\s*Filters\s*$/,
    );

    // Stock <= 0 — only C. Proves a `0` bound is a REAL bound and not dropped
    // as falsy on its way through buildProductListFilters.
    await openFiltersPopover(appPage);
    await appPage.getByTestId("inventory-filter-stock-max").fill("0");
    await closeFiltersPopover(appPage);
    await expectListed(appPage, [NAME_C], [NAME_A, NAME_B]);
    await expect(chip(appPage, "stock")).toContainText("Stock: ≤ 0");

    await clearChip(appPage, "stock");
    await expectListed(appPage, ALL_NAMES, []);
  });

  test("profit % bounds use the displayed formula, including the cost-0 ⇒ 100 rule", async ({
    appPage,
  }) => {
    await ensureSeeds(appPage);
    await navigateTo(appPage, "/products");
    await scopeToSeeds(appPage);

    // Profit <= 50% — only B (10%). A is 100%, C is 100 by the cost-0 rule.
    await openFiltersPopover(appPage);
    await appPage.getByTestId("inventory-filter-profit-max").fill("50");
    await closeFiltersPopover(appPage);
    await expectListed(appPage, [NAME_B], [NAME_A, NAME_C]);
    await expect(chip(appPage, "profit")).toContainText("Profit: ≤ 50%");

    await openFiltersPopover(appPage);
    await appPage.getByTestId("inventory-filters-reset").click();

    // Profit >= 100% — A ((20-10)/10 = 100) AND C (cost 0, retail 15 => 100).
    // C's PRESENCE here is the discriminating assertion for PROFIT_PCT_EXPR's
    // zero-cost branch: with a NULL/skip instead of 100, C would be missing.
    await appPage.getByTestId("inventory-filter-profit-min").fill("100");
    await closeFiltersPopover(appPage);
    await expectListed(appPage, [NAME_A, NAME_C], [NAME_B]);
    await expect(chip(appPage, "profit")).toContainText("Profit: ≥ 100%");

    await clearChip(appPage, "profit");
    await expectListed(appPage, ALL_NAMES, []);
  });

  test("Added date range is inclusive on both ends, and each bound really bounds", async ({
    appPage,
  }) => {
    const seeds = await ensureSeeds(appPage);
    const dayKeys = seeds.map((s) => s.dayKey).sort();
    const firstDay = dayKeys[0];
    const lastDay = dayKeys[dayKeys.length - 1];

    await navigateTo(appPage, "/products");
    await scopeToSeeds(appPage);

    // [firstDay, lastDay] — the seeds sit exactly ON the bounds, so anything
    // less than fully-inclusive comparison drops at least one of them.
    await appPage.getByTestId("date-range-from").fill(firstDay);
    await appPage.getByTestId("date-range-to").fill(lastDay);
    await expectListed(appPage, ALL_NAMES, []);
    await expect(chip(appPage, "added")).toContainText(
      `Added: ${firstDay} → ${lastDay}`,
    );

    // `from` alone, one day past the newest seed — everything drops.
    await appPage.getByTestId("date-range-to").fill("");
    await appPage.getByTestId("date-range-from").fill(shiftDay(lastDay, 1));
    await expectListed(appPage, [], ALL_NAMES);
    await expect(chip(appPage, "added")).toContainText("Added: from");

    // `to` alone, one day before the oldest seed — everything drops again.
    await appPage.getByTestId("date-range-from").fill("");
    await appPage.getByTestId("date-range-to").fill(shiftDay(firstDay, -1));
    await expectListed(appPage, [], ALL_NAMES);
    await expect(chip(appPage, "added")).toContainText("Added: until");

    await clearChip(appPage, "added");
    await expectListed(appPage, ALL_NAMES, []);
    await expect(appPage.getByTestId("date-range-from")).toHaveValue("");
    await expect(appPage.getByTestId("date-range-to")).toHaveValue("");
  });

  test("Clear all drops every filter group at once and leaves the search box alone", async ({
    appPage,
  }) => {
    const seeds = await ensureSeeds(appPage);
    const firstDay = seeds.map((s) => s.dayKey).sort()[0];

    await navigateTo(appPage, "/products");
    await scopeToSeeds(appPage);

    // Three groups at once, each contributing a different clause.
    await toggleMultiSelect(appPage, "inventory-filter-category", CAT_A);
    await appPage.getByTestId("date-range-from").fill(firstDay);
    await openFiltersPopover(appPage);
    await appPage.getByTestId("inventory-filter-cost-min").fill("30");
    await closeFiltersPopover(appPage);

    await expectListed(appPage, [NAME_B], [NAME_A, NAME_C]);
    await expect(chip(appPage, "categories")).toBeVisible();
    await expect(chip(appPage, "added")).toBeVisible();
    await expect(chip(appPage, "cost")).toBeVisible();

    await appPage.getByTestId("inventory-filters-clear").click();

    for (const key of ["categories", "added", "cost"]) {
      await expect(chip(appPage, key)).toHaveCount(0);
    }
    await expect(appPage.getByTestId("inventory-filters-clear")).toHaveCount(0);
    // Filters are cleared; the free-text search is NOT — the list is still
    // scoped to the three seeds rather than the whole catalogue.
    await expect(searchBox(appPage)).toHaveValue(SEARCH_SCOPE);
    await expectListed(appPage, ALL_NAMES, []);
  });

  test("the dropdown options come from inventory:get-product-filter-options", async ({
    appPage,
  }) => {
    await ensureSeeds(appPage);
    await navigateTo(appPage, "/products");

    // The seeded values are offered as options in the real dropdowns…
    await appPage.getByTestId("inventory-filter-category").click();
    for (const value of [CAT_A, CAT_B]) {
      await expect(
        appPage.getByTestId(`inventory-filter-category-option-${value}`),
      ).toHaveCount(1);
    }
    await appPage.getByTestId("inventory-filter-category").click();

    await appPage.getByTestId("inventory-filter-supplier").click();
    for (const value of [SUP_X, SUP_Y]) {
      await expect(
        appPage.getByTestId(`inventory-filter-supplier-option-${value}`),
      ).toHaveCount(1);
    }
    await appPage.getByTestId("inventory-filter-supplier").click();

    // …and the channel behind them keeps its contract: distinct, non-empty.
    // Membership + shape only — never a total count (rule 15: other specs
    // seed products into this same DB).
    const options = await appPage.evaluate(() =>
      window.api.inventory.getProductFilterOptions(),
    );
    for (const value of [CAT_A, CAT_B]) {
      expect(options.categories).toContain(value);
    }
    for (const value of [SUP_X, SUP_Y]) {
      expect(options.suppliers).toContain(value);
    }
    expect(options.categories).not.toContain("");
    expect(options.suppliers).not.toContain("");
    expect(new Set(options.categories).size).toBe(options.categories.length);
    expect(new Set(options.suppliers).size).toBe(options.suppliers.length);
    // NOCASE ordering, asserted only across values this spec owns so foreign
    // rows in the shared DB cannot make it flaky.
    expect(options.categories.indexOf(CAT_A)).toBeLessThan(
      options.categories.indexOf(CAT_B),
    );
    expect(options.suppliers.indexOf(SUP_X)).toBeLessThan(
      options.suppliers.indexOf(SUP_Y),
    );
  });
});
