/**
 * E2E: LIRA-143 — phone IMEI units & warranty-from-sale
 * (current_sprint.md, owner-interviewed 2026-08-23; build decisions recorded
 * 2026-08-25, phases 1-6 committed).
 *
 * Drives the REAL UI end-to-end across Inventory, POS, and the Transactions
 * refund modal (layer-seam discipline — README "Known couplings & hazards" /
 * lira-142's precedent: hand-built IPC payloads can't see a frontend<->
 * repository seam bug the way the real form can):
 *
 *   a. Intake/drift — ProductForm's "Units / IMEIs" section (only rendered
 *      for an existing product whose CATEGORY tracks IMEI units, decision
 *      #9) shows the 2 self-provisioned IMEIs IN_STOCK plus a warn-only
 *      drift banner (2 registered vs stock 3); registering a 3rd IMEI
 *      through the real input+Add row (ImeiAddRow) clears the drift; re-registering an
 *      already-in-stock IMEI is rejected with the named "already registered
 *      ... product" error (decision #3), rendered inline (not a toast).
 *   b. Scan-sell — POS's product search auto-add path (decision #2): typing
 *      an IMEI into the search box resolves the model AND preselects that
 *      exact unit (`api.resolveScanCode`), landing a qty-1 cart line with no
 *      operator IMEI entry needed. Checking out in cash marks that unit
 *      SOLD, stamps `sale_items.imei`, and stamps `warranty_until` = sale
 *      date + the product's `warranty_months` (decision #4) — computed
 *      independently in this file via `addMonthsIso` (mirrors
 *      packages/core/src/utils/dates.ts) rather than trusted from a hardcoded
 *      figure.
 *   c. Strictness (decision #5) — adding the SAME product again via a plain
 *      click (not scan) always renders the unit-picker `<select>` (never the
 *      free-text `<input>`) once ANY unit is registered for it (cartGate.ts
 *      `resolveCartLineMode`), and the frontend places NO client-side gate
 *      on submitting with the picker left unselected — the real backstop is
 *      `SalesRepository`'s server-side strictness guard, surfaced here as a
 *      "Sale failed: ..." toast. This spec drives that exact honest path
 *      (never a plain-line construction the UI doesn't allow).
 *   d. Lookup (decision #7) — Inventory's search box, fed an IMEI, renders
 *      `ImeiStoryCard` with the product name, sold price, and a warranty
 *      badge computed from the SAME persisted `warranty_until` this file
 *      read back in (b) — never a hardcoded date string.
 *   e. Refund with extras (decisions #10/#11) — the Transactions page's real
 *      Refund button opens `RefundMethodModal`'s "Returned phones" section
 *      for a sale carrying a linked unit; checking Defective + setting a new
 *      warranty expiry rides the SAME `refundTransaction` call as the
 *      drawer-return legs (rule 16). Asserted as DELTAS around the unit
 *      status, stock, and the General USD drawer (rule 15) — never absolute
 *      totals.
 *   f. Re-sell (decision #12, confirmed default) — selling the SAME
 *      now-IN_STOCK unit again clears its refund-time warranty override and
 *      stamps a fresh sale-based warranty, while `is_defective` (informational,
 *      not a sale blocker) survives the re-sale.
 *   g. Management view — the shop-wide "Phone Units" register
 *      (`/inventory/units`), reached through Inventory's real entry button.
 *      Its server-side status filter + search box are driven for real: with
 *      `Sold` selected, THIS run's re-sold IMEI shows up carrying its product
 *      name, its buyer, and the SAME persisted warranty stamp step (f) read
 *      back; with `In stock` selected that same IMEI is gone from the result
 *      and one of this run's still-in-stock IMEIs is present instead. Every
 *      assertion keys on the exact IMEI (identity, rule 15) — never a row
 *      position, never a count, since the shared e2e DB accumulates units
 *      from every earlier spec that registered one.
 *
 * Assertion discipline (CLAUDE.md rule 15 / README): every identity is a
 * `Date.now()`-based RUN_ID marker unique to this run (category name is the
 * one deliberately shared/idempotent resource, same as "General"); every
 * money/stock/state number is a DELTA snapshotted immediately around its own
 * action and matched by IDENTITY (unique product name / IMEI / client
 * marker) — never `getRecent()[0]`, never an absolute drawer total.
 *
 * Rule 17 (prove the guard against the pre-fix code): the reversal-symmetry
 * half of step (e) is proven failing-first OUTSIDE this file, per the task's
 * own procedure — temporarily commenting out both
 * `TransactionRepository._reverseProductUnits` call sites, rebuilding core,
 * rerunning this spec (which must then fail exactly at the post-refund
 * IN_STOCK assertions), then reverting. That transcript lives in the task
 * report, not in this committed file.
 */

import { test, expect, navigateTo } from "./fixtures";
import { closeAllActiveSessions } from "./helpers/nav.js";
import type { Page, Locator } from "@playwright/test";

test.describe.configure({ retries: 0 });

// ─── Identity markers — unique per run; CATEGORY_NAME is the one
// deliberately shared/idempotent resource (read-first, provisioned once). ──

const RUN_ID = Date.now();
const CATEGORY_NAME = "LIRA143 Phones";
const PRODUCT_NAME = `LIRA143 UnitPhone ${RUN_ID}`;
const IMEI_BASE = `143${RUN_ID}`;
const IMEI_1 = `${IMEI_BASE}1`; // sold, refunded, re-sold
const IMEI_2 = `${IMEI_BASE}2`; // stays IN_STOCK throughout
const IMEI_3 = `${IMEI_BASE}3`; // registered through the real UI in step (a)
const CLIENT_1 = `L143-SELL1-${RUN_ID}`;
const CLIENT_2 = `L143-SELL2-${RUN_ID}`;

const RETAIL_PRICE = 137.31;
const COST_PRICE = 60;
const STOCK_QUANTITY = 3;
const WARRANTY_MONTHS = 6;

// ─── Ambient window.api types are narrower than what a couple of these IPC
// calls actually accept/return (createProduct's type omits warranty_months;
// getForProduct/getStory/getProduct already match) — same "cast once, right
// after the call" discipline lira-142's ensureEurActive() uses. ────────────

interface CreateProductWithWarrantyApi {
  createProduct: (data: {
    barcode: string;
    name: string;
    category: string;
    cost_price: number;
    retail_price: number;
    stock_quantity?: number;
    min_stock_level?: number;
    warranty_months?: number | null;
  }) => Promise<{ success: boolean; id?: number; error?: string }>;
}

interface ProductUnitRow {
  id: number;
  product_id: number;
  imei: string;
  status: "IN_STOCK" | "SOLD";
  sale_item_id: number | null;
  is_defective: number;
  warranty_override_until: string | null;
}

interface UnitStoryRow extends ProductUnitRow {
  product_name: string | null;
  sold_price_usd: number | null;
  warranty: {
    source: "OVERRIDE" | "REFUND" | "SALE" | null;
    until: string | null;
    state: "COVERED" | "EXPIRED" | "VOID" | "NONE";
  };
}

interface SaleItemRow {
  id: number;
  sale_id: number;
  product_id: number;
  imei: string | null;
  warranty_until: string | null;
}

// ─── Pure date helper — deliberately mirrors packages/core/src/utils/dates.ts
// `addMonthsIso` so this spec computes its OWN expected warranty stamp from
// first principles rather than trusting a backend figure verbatim. ─────────

function addMonthsIso(dateIso: string, months: number): string {
  const [yearStr, monthStr, dayStr] = dateIso.slice(0, 10).split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const totalMonths = month - 1 + months;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = (((totalMonths % 12) + 12) % 12) + 1;
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
  const clampedDay = Math.min(day, daysInMonth);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${targetYear}-${pad(targetMonth)}-${pad(clampedDay)}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── IPC read helpers (verification only — every ACTION below drives the
// real UI; these just read back persisted state). ──────────────────────────

async function generalUsd(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const balances = await window.api.dashboard.getDrawerBalances();
    return balances.generalDrawer.usd;
  });
}

async function unitsForProduct(
  page: Page,
  productId: number,
): Promise<ProductUnitRow[]> {
  return page.evaluate(async (id) => {
    const res = await window.api.productUnits.getForProduct(id);
    return (res.data ?? []) as unknown as ProductUnitRow[];
  }, productId);
}

async function unitByImei(
  page: Page,
  productId: number,
  imei: string,
): Promise<ProductUnitRow> {
  const units = await unitsForProduct(page, productId);
  const unit = units.find((u) => u.imei === imei);
  if (!unit) throw new Error(`Unit with imei ${imei} not found for product`);
  return unit;
}

async function storyFor(page: Page, imei: string): Promise<UnitStoryRow[]> {
  return page.evaluate(async (i) => {
    const res = await window.api.productUnits.getStory(i);
    return (res.data ?? []) as unknown as UnitStoryRow[];
  }, imei);
}

async function productStock(page: Page, productId: number): Promise<number> {
  return page.evaluate(async (id) => {
    const p = await window.api.inventory.getProduct(id);
    return (p as { stock_quantity: number } | null)?.stock_quantity ?? -1;
  }, productId);
}

/** Match today's sale by identity (client marker + this run's unique price),
 *  never by row position (rule 15) — `getTodaysSales` is used elsewhere in
 *  the app (ProductSearch's own "today's sales" panel) keyed the same way. */
async function findTodaysSaleId(
  page: Page,
  clientName: string,
): Promise<number> {
  const sale = await page.evaluate(
    async ({ name, price }) => {
      const sales = await window.api.sales.getTodaysSales();
      return (
        sales.find(
          (s) =>
            s.client_name === name &&
            Math.abs(s.final_amount_usd - price) < 0.01,
        ) ?? null
      );
    },
    { name: clientName, price: RETAIL_PRICE },
  );
  if (!sale) throw new Error(`Today's sale for client ${clientName} not found`);
  return sale.id;
}

async function saleItemsFor(page: Page, saleId: number): Promise<SaleItemRow[]> {
  return page.evaluate(
    (id) => window.api.sales.getItems(id) as unknown as Promise<SaleItemRow[]>,
    saleId,
  );
}

// ─── Self-provisioning (idempotent read -> provision-if-missing, same shape
// as lira-142's ensureEurActive) — CATEGORY_NAME is the one shared resource;
// the product and its 2 initial units are fresh every run (RUN_ID-unique),
// so no read-first check is needed for them. ───────────────────────────────

async function ensureImeiCategory(page: Page): Promise<number> {
  const existing = await page.evaluate(async (name) => {
    const cats = await window.api.inventory.getCategoriesFull();
    return cats.find((c) => c.name === name) ?? null;
  }, CATEGORY_NAME);

  if (existing && existing.tracks_imei_units === 1) return existing.id;

  if (existing) {
    const upd = await page.evaluate(
      (id) =>
        window.api.inventory.updateCategory(id, { tracks_imei_units: true }),
      existing.id,
    );
    if (!upd.success) {
      throw new Error(`Failed to flag existing category: ${upd.error}`);
    }
    return existing.id;
  }

  const created = await page.evaluate(
    (name) => window.api.inventory.createCategory(name),
    CATEGORY_NAME,
  );
  if (!created.success || created.id == null) {
    throw new Error(`Failed to create category: ${created.error}`);
  }
  const upd = await page.evaluate(
    (id) => window.api.inventory.updateCategory(id, { tracks_imei_units: true }),
    created.id,
  );
  if (!upd.success) {
    throw new Error(`Failed to flag new category: ${upd.error}`);
  }
  return created.id;
}

async function provisionProduct(page: Page): Promise<number> {
  const result = await page.evaluate(
    ({ name, category, cost, retail, stock, warrantyMonths }) => {
      const api = window.api.inventory as unknown as CreateProductWithWarrantyApi;
      return api.createProduct({
        barcode: "",
        name,
        category,
        cost_price: cost,
        retail_price: retail,
        stock_quantity: stock,
        min_stock_level: 0,
        warranty_months: warrantyMonths,
      });
    },
    {
      name: PRODUCT_NAME,
      category: CATEGORY_NAME,
      cost: COST_PRICE,
      retail: RETAIL_PRICE,
      stock: STOCK_QUANTITY,
      warrantyMonths: WARRANTY_MONTHS,
    },
  );
  if (!result.success || result.id == null) {
    throw new Error(`Failed to provision product: ${result.error}`);
  }
  return result.id;
}

async function registerImeisViaIpc(
  page: Page,
  productId: number,
  imeis: string[],
): Promise<void> {
  const result = await page.evaluate(
    ({ productId, imeis }) =>
      window.api.productUnits.register({ product_id: productId, imeis }),
    { productId, imeis },
  );
  if (!result.success) {
    throw new Error(`Failed to register units: ${result.error}`);
  }
}

// ─── UI locator helpers ─────────────────────────────────────────────────────

/** ProductForm's header holds Minimize then Close (`<X/>`) — the SAME
 *  sibling-xpath pattern lira-142's fromBox/toBox use, since neither icon
 *  button carries a data-testid. */
async function closeProductForm(page: Page): Promise<void> {
  const heading = page.getByRole("heading", { name: /^(Edit|New) Product$/ });
  await expect(heading).toBeVisible({ timeout: 5_000 });
  // The header's button-group div is a direct SIBLING of the <h2> (both
  // children of the same "flex justify-between" header row) — same
  // sibling-xpath pattern lira-142's fromBox/toBox use for an unlabeled div.
  const headerButtons = heading
    .locator("xpath=following-sibling::div[1]")
    .getByRole("button");
  // dispatchEvent, not click() — the modal box grows taller than the
  // viewport once the Units/IMEIs section has several rows (the
  // fixed-positioned overlay has no scroll container and centers itself,
  // pushing the header off the TOP of the viewport by half the overflow).
  // A real mouse click needs an in-viewport point (even with force:true);
  // dispatching the DOM event directly still fires React's onClick.
  await headerButtons.last().dispatchEvent("click");
  await expect(heading).not.toBeVisible({ timeout: 5_000 });
}

async function openEditProduct(page: Page): Promise<void> {
  await navigateTo(page, "/products");
  const searchBox = page.getByPlaceholder("Search by name, barcode...");
  await expect(searchBox).toBeVisible({ timeout: 10_000 });
  await searchBox.fill(PRODUCT_NAME);
  const row = page.locator("tbody tr").filter({ hasText: PRODUCT_NAME });
  await expect(row).toBeVisible({ timeout: 10_000 });
  // Row's action cell renders exactly 3 icon buttons in this fixed JSX
  // order: [0] Adjust stock, [1] Edit, [2] Delete (ProductList.tsx).
  await row.getByRole("button").nth(1).click();
  await expect(
    page.getByRole("heading", { name: "Edit Product" }),
  ).toBeVisible({ timeout: 5_000 });
}

/** The Units/IMEIs section's single-IMEI input + Add button (ImeiAddRow,
 *  embedded in ProductUnitsSection) — owner-requested rework replacing the
 *  old multi-line textarea. Enter submits too (scanner-friendly); this
 *  helper drives that same path since it's what a real scan sends. */
function unitsSection(page: Page): Locator {
  return page.getByTestId("product-units-section");
}

async function registerImeiViaUi(page: Page, imei: string): Promise<void> {
  const section = unitsSection(page);
  const input = section.getByTestId("imei-add-input");
  await input.fill(imei);
  await input.press("Enter");
}

/** Cart line for PRODUCT_NAME — CartLineRow's own container class. */
function cartLineFor(page: Page): Locator {
  return page
    .locator("h4", { hasText: PRODUCT_NAME })
    .locator("xpath=ancestor::div[contains(@class,'bg-slate-700/30')][1]");
}

async function fillClientName(page: Page, name: string): Promise<void> {
  await page.getByTestId("client-autocomplete-field").fill(name);
}

async function completeCashSale(page: Page): Promise<void> {
  const completeBtn = page.getByTestId("checkout-complete-btn");
  await expect(completeBtn).toBeEnabled({ timeout: 5_000 });
  await completeBtn.click();
  await expect(page.getByTestId("checkout-modal")).not.toBeVisible({
    timeout: 15_000,
  });
}

// ─── Phone Units management view (step g) helpers ───────────────────────────

/** Reach `/inventory/units` the way an operator does — Inventory's own
 *  "Phone Units" header button (there is deliberately NO sidebar entry, so
 *  `navigateTo`'s NavLink path doesn't apply to this route). */
async function openPhoneUnitsPage(page: Page): Promise<Locator> {
  await navigateTo(page, "/products");
  const entry = page.getByTestId("phone-units-entry");
  await expect(entry).toBeVisible({ timeout: 10_000 });
  await entry.click();
  const pageRoot = page.getByTestId("phone-units-page");
  await expect(pageRoot).toBeVisible({ timeout: 10_000 });
  return pageRoot;
}

/**
 * The page's status filter is the house `Select` (@headlessui Listbox), not a
 * native `<select>`: its trigger is the only `aria-haspopup="listbox"` button
 * on the page (DataTable's own column picker declares `aria-haspopup="true"`),
 * and its options are portaled to `<body>` — hence `page.getByRole("option")`
 * rather than a descendant of the page root. Same two-step drive
 * lira-114 / lira-services-for-partner use for the partner picker.
 */
async function setPhoneUnitsStatus(page: Page, label: string): Promise<void> {
  const picker = page
    .getByTestId("phone-units-page")
    .locator('button[aria-haspopup="listbox"]');
  await picker.click();
  await page.getByRole("option", { name: label, exact: true }).click();
  // The trigger renders the SELECTED option's label — asserting it here is
  // what makes every "…and now it's filtered" claim below load-bearing. A
  // silently-missed click would otherwise leave the filter on "All statuses",
  // where a row expected to be present is still present and the assertion
  // passes for the wrong reason.
  await expect(picker).toContainText(label, { timeout: 5_000 });
}

/** Type an exact IMEI into the page's search box (300ms debounce, then a
 *  server-side `LIKE` on imei OR product name) — the identity key every
 *  assertion in step (g) is scoped by. */
async function searchPhoneUnits(page: Page, term: string): Promise<void> {
  await page.getByTestId("phone-units-search").fill(term);
}

// ─── The spec ───────────────────────────────────────────────────────────────

test.describe("LIRA-143 — phone IMEI units & warranty, driven through the real UI", () => {
  test("intake/drift -> scan-sell -> strictness -> lookup -> refund extras -> re-sell", async ({
    appPage,
  }) => {
    await closeAllActiveSessions(appPage);

    // ─── Provision (idempotent category; fresh product+units this run) ────
    await ensureImeiCategory(appPage);
    const productId = await provisionProduct(appPage);
    await registerImeisViaIpc(appPage, productId, [IMEI_1, IMEI_2]);
    const unit1Initial = await unitByImei(appPage, productId, IMEI_1);
    const unit2Initial = await unitByImei(appPage, productId, IMEI_2);

    // ─── (a) Intake/drift ───────────────────────────────────────────────────
    await openEditProduct(appPage);

    const section = unitsSection(appPage);
    await expect(section).toBeVisible({ timeout: 5_000 });
    await expect(
      section.getByTestId(`product-unit-${unit1Initial.id}`),
    ).toBeVisible();
    await expect(
      section.getByTestId(`product-unit-${unit2Initial.id}`),
    ).toBeVisible();
    await expect(
      section.getByTestId(`product-unit-${unit1Initial.id}`),
    ).toContainText("IN_STOCK");

    // Drift: 2 registered IN_STOCK vs stock_quantity 3 — warn-only.
    const drift = section.getByTestId("unit-drift-warning");
    await expect(drift).toBeVisible({ timeout: 5_000 });
    await expect(drift).toContainText("2 units registered in-stock");
    await expect(drift).toContainText("stock quantity is 3");

    // Register the 3rd unit through the real input+Add row — drift clears.
    await registerImeiViaUi(appPage, IMEI_3);
    await expect(
      section.getByText(IMEI_3, { exact: false }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(drift).not.toBeVisible({ timeout: 5_000 });

    // Duplicate IMEI (still IN_STOCK) — named error, inline (not a toast).
    await registerImeiViaUi(appPage, IMEI_1);
    await expect(
      section.getByText(
        new RegExp(
          `IMEI ${escapeRegExp(IMEI_1)} is already registered in stock on product "${escapeRegExp(PRODUCT_NAME)}"`,
        ),
      ),
    ).toBeVisible({ timeout: 5_000 });
    // The rejected duplicate wrote nothing — drift stays cleared (3 == 3).
    await expect(drift).not.toBeVisible();

    await closeProductForm(appPage);

    // ─── (b) Scan-sell ──────────────────────────────────────────────────────
    await navigateTo(appPage, "/pos");
    const posSearch = appPage.getByPlaceholder(
      "Search products by name or barcode...",
    );
    await expect(posSearch).toBeVisible({ timeout: 10_000 });

    const drawerBeforeFirstSale = await generalUsd(appPage);
    const saleDateBeforeCheckout = todayIso();

    await posSearch.fill(IMEI_1);
    // Auto-add fires ~800ms after the debounced search resolves
    // (ProductSearch.tsx) — the search box clears on a successful add.
    await expect(posSearch).toHaveValue("", { timeout: 10_000 });

    const cartLine1 = cartLineFor(appPage);
    await expect(cartLine1).toBeVisible({ timeout: 5_000 });
    // The scan path preselects the exact unit — the picker's value is unit1's
    // own id (CartLineRow's <select value={item.product_unit_id}>).
    await expect(cartLine1.locator("select")).toHaveValue(
      String(unit1Initial.id),
    );
    await expect(cartLine1.locator('input[placeholder="Enter IMEI / Serial"]')).toHaveCount(0);

    await appPage
      .getByRole("button", { name: "Proceed to Checkout" })
      .click();
    await expect(appPage.getByTestId("checkout-modal")).toBeVisible({
      timeout: 5_000,
    });
    await fillClientName(appPage, CLIENT_1);
    await completeCashSale(appPage);

    // Assert via IPC: unit SOLD, sale_items.imei stamped, warranty computed
    // independently (addMonthsIso mirrors packages/core/src/utils/dates.ts).
    const unit1AfterSale = await unitByImei(appPage, productId, IMEI_1);
    expect(unit1AfterSale.status).toBe("SOLD");
    expect(unit1AfterSale.sale_item_id).not.toBeNull();

    const sale1Id = await findTodaysSaleId(appPage, CLIENT_1);
    const sale1Items = await saleItemsFor(appPage, sale1Id);
    const sale1Item = sale1Items.find((it) => it.product_id === productId);
    if (!sale1Item) throw new Error("Sale item for first sale not found");
    expect(sale1Item.imei).toBe(IMEI_1);
    const expectedWarranty1 = addMonthsIso(
      saleDateBeforeCheckout,
      WARRANTY_MONTHS,
    );
    // Accept either side of a UTC-midnight boundary crossed between
    // capturing saleDateBeforeCheckout and the main process's own "now" —
    // documented, same tolerance class other date-boundary specs (lira-100/
    // 102/103) call out explicitly, never silently widened further.
    const expectedWarrantyToleratingMidnight = [
      expectedWarranty1,
      addMonthsIso(todayIso(), WARRANTY_MONTHS),
    ];
    expect(expectedWarrantyToleratingMidnight).toContain(sale1Item.warranty_until);

    // ─── (c) Strictness ─────────────────────────────────────────────────────
    // Add the SAME product again via a plain click (not scan) — 2 units
    // remain IN_STOCK (IMEI_2, IMEI_3), so cartGate always renders the
    // unit-picker (never free-text) for this line.
    await posSearch.fill(PRODUCT_NAME);
    await appPage.getByText(PRODUCT_NAME, { exact: true }).first().click();

    const cartLine2 = cartLineFor(appPage);
    await expect(cartLine2).toBeVisible({ timeout: 5_000 });
    await expect(cartLine2.locator("select")).toBeVisible();
    await expect(
      cartLine2.locator('input[placeholder="Enter IMEI / Serial"]'),
    ).toHaveCount(0);
    // Left deliberately unselected — the UI places no client-side gate here
    // (Cart.tsx / CheckoutModal's Complete Sale is disabled only by
    // isLoading); the real backstop is the backend's strictness check.
    await expect(cartLine2.locator("select")).toHaveValue("");

    const inStockBeforeAttempt = (
      await unitsForProduct(appPage, productId)
    ).filter((u) => u.status === "IN_STOCK").length;

    await appPage
      .getByRole("button", { name: "Proceed to Checkout" })
      .click();
    await expect(appPage.getByTestId("checkout-modal")).toBeVisible({
      timeout: 5_000,
    });
    await appPage.getByTestId("checkout-complete-btn").click();

    const strictnessAlert = appPage
      .getByRole("alert")
      .filter({ hasText: "IMEI-registered unit" });
    await expect(strictnessAlert).toBeVisible({ timeout: 8_000 });
    await expect(strictnessAlert).toContainText(
      `${inStockBeforeAttempt} IMEI-registered unit(s) in stock`,
    );
    await expect(strictnessAlert).toContainText(
      "identify the unit being sold",
    );
    // The modal stayed open (rejected sale, no state change) — clean up.
    await appPage.locator('button[title="Cancel Order"]').click();
    await expect(appPage.getByTestId("checkout-modal")).not.toBeVisible({
      timeout: 5_000,
    });

    // ─── (d) Lookup ─────────────────────────────────────────────────────────
    await navigateTo(appPage, "/products");
    const invSearch = appPage.getByPlaceholder("Search by name, barcode...");
    await expect(invSearch).toBeVisible({ timeout: 10_000 });
    await invSearch.fill(IMEI_1);

    const storyCard = appPage.getByTestId("imei-story-card");
    await expect(storyCard).toBeVisible({ timeout: 8_000 });
    await expect(storyCard).toContainText(PRODUCT_NAME);
    await expect(storyCard).toContainText(IMEI_1);
    await expect(storyCard).toContainText(`$${RETAIL_PRICE.toFixed(2)}`);

    const story1 = await storyFor(appPage, IMEI_1);
    const coveredUntil1 = story1[0]?.warranty.until;
    if (!coveredUntil1) throw new Error("Expected a stamped warranty until");
    await expect(storyCard.getByTestId("imei-story-warranty-badge")).toHaveText(
      `Covered (until ${coveredUntil1})`,
    );

    // ─── (e) Refund with extras ─────────────────────────────────────────────
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/audit");

    const saleRow = appPage
      .locator("tbody tr")
      .filter({ hasText: "SALE" })
      .filter({ hasText: RETAIL_PRICE.toFixed(2) })
      .filter({ hasText: CLIENT_1 });
    await expect(saleRow).toBeVisible({ timeout: 10_000 });
    await saleRow.scrollIntoViewIfNeeded();
    const refundBtn = saleRow.getByRole("button", { name: /^Refund$/ });
    await expect(refundBtn).toBeVisible();
    await refundBtn.click();

    const refundModal = appPage.getByTestId("counterparty-settle-modal");
    await expect(refundModal).toBeVisible({ timeout: 10_000 });

    const unitRow = appPage.getByTestId(`refund-unit-${unit1AfterSale.id}`);
    await expect(unitRow).toBeVisible({ timeout: 5_000 });
    await unitRow.locator('input[type="checkbox"]').check();
    const overrideDate = new Date();
    overrideDate.setDate(overrideDate.getDate() + 60);
    const overrideDateIso = overrideDate.toISOString().slice(0, 10);
    await unitRow.locator('input[type="date"]').fill(overrideDateIso);

    const confirmRefundBtn = appPage.getByRole("button", {
      name: "Confirm Refund",
    });
    await expect(confirmRefundBtn).toBeEnabled({ timeout: 10_000 });
    await confirmRefundBtn.click();
    await expect(refundModal).not.toBeVisible({ timeout: 15_000 });

    // Deltas: unit back IN_STOCK w/ extras, stock restored, drawer netted.
    const unit1AfterRefund = await unitByImei(appPage, productId, IMEI_1);
    expect(unit1AfterRefund.status).toBe("IN_STOCK");
    expect(unit1AfterRefund.is_defective).toBe(1);
    expect(unit1AfterRefund.warranty_override_until).toBe(overrideDateIso);

    await expect
      .poll(async () => productStock(appPage, productId), { timeout: 8_000 })
      .toBe(STOCK_QUANTITY);

    await expect
      .poll(async () => generalUsd(appPage), { timeout: 8_000 })
      .toBeCloseTo(drawerBeforeFirstSale, 2);

    const story1AfterRefund = await storyFor(appPage, IMEI_1);
    expect(story1AfterRefund[0]?.warranty.source).toBe("OVERRIDE");
    expect(story1AfterRefund[0]?.warranty.state).toBe("COVERED");
    expect(story1AfterRefund[0]?.warranty.until).toBe(overrideDateIso);

    // ─── (f) Re-sell ────────────────────────────────────────────────────────
    await navigateTo(appPage, "/pos");
    const posSearch2 = appPage.getByPlaceholder(
      "Search products by name or barcode...",
    );
    await expect(posSearch2).toBeVisible({ timeout: 10_000 });

    const saleDateBeforeResale = todayIso();
    await posSearch2.fill(IMEI_1);
    await expect(posSearch2).toHaveValue("", { timeout: 10_000 });

    const cartLine3 = cartLineFor(appPage);
    await expect(cartLine3).toBeVisible({ timeout: 5_000 });
    await expect(cartLine3.locator("select")).toHaveValue(
      String(unit1AfterRefund.id),
    );

    await appPage
      .getByRole("button", { name: "Proceed to Checkout" })
      .click();
    await expect(appPage.getByTestId("checkout-modal")).toBeVisible({
      timeout: 5_000,
    });
    await fillClientName(appPage, CLIENT_2);
    await completeCashSale(appPage);

    const unit1AfterResale = await unitByImei(appPage, productId, IMEI_1);
    expect(unit1AfterResale.status).toBe("SOLD");
    // Override cleared by markSold (decision #12, confirmed default);
    // is_defective survives the re-sale (informational, kept across resale).
    expect(unit1AfterResale.warranty_override_until).toBeNull();
    expect(unit1AfterResale.is_defective).toBe(1);

    const sale2Id = await findTodaysSaleId(appPage, CLIENT_2);
    const sale2Items = await saleItemsFor(appPage, sale2Id);
    const sale2Item = sale2Items.find((it) => it.product_id === productId);
    if (!sale2Item) throw new Error("Sale item for re-sale not found");
    const expectedWarranty2 = [
      addMonthsIso(saleDateBeforeResale, WARRANTY_MONTHS),
      addMonthsIso(todayIso(), WARRANTY_MONTHS),
    ];
    expect(expectedWarranty2).toContain(sale2Item.warranty_until);

    const story1AfterResale = await storyFor(appPage, IMEI_1);
    expect(story1AfterResale[0]?.warranty.source).toBe("SALE");
    expect(story1AfterResale[0]?.warranty.state).toBe("COVERED");
    expect(story1AfterResale[0]?.warranty.until).toBe(sale2Item.warranty_until);

    // ─── (g) Management view (/inventory/units) ─────────────────────────────
    // The shop-wide register, reached through Inventory's real entry button.
    // The e2e DB accumulates units across specs, so EVERY assertion below is
    // keyed on this run's own IMEIs (rule 15) — the row locators are the
    // unit ids read back above, and the search box is fed the exact IMEI.
    await openPhoneUnitsPage(appPage);

    const unit1AfterResaleRow = appPage.getByTestId(
      `phone-unit-row-${unit1AfterResale.id}`,
    );
    const unit2Row = appPage.getByTestId(`phone-unit-row-${unit2Initial.id}`);

    // Status=Sold, searched by this run's unique PRODUCT NAME (the search
    // LIKE-matches imei OR product name, so all three of this run's units
    // are candidates): only the SOLD one comes back. Asserting the IN_STOCK
    // sibling's ABSENCE in the same result is what proves the status filter
    // is really applied server-side rather than the row merely being present
    // for unrelated reasons — and it stays scoped to this run's own unit ids,
    // so no other spec's units can decide the outcome (rule 15).
    await setPhoneUnitsStatus(appPage, "Sold");
    await searchPhoneUnits(appPage, PRODUCT_NAME);
    await expect(unit1AfterResaleRow).toBeVisible({ timeout: 10_000 });
    await expect(unit2Row).toHaveCount(0);

    // Now the exact IMEI as the identity key — the unit re-sold in (f), with
    // its product name, its buyer (proving the sale_items -> sales -> clients
    // join), and the SAME persisted warranty stamp (f) read back out of
    // `sale_items.warranty_until` — never a hardcoded date.
    await searchPhoneUnits(appPage, IMEI_1);

    await expect(unit1AfterResaleRow).toBeVisible({ timeout: 10_000 });
    await expect(unit1AfterResaleRow).toContainText(IMEI_1);
    await expect(unit1AfterResaleRow).toContainText(PRODUCT_NAME);
    await expect(unit1AfterResaleRow).toContainText("SOLD");
    await expect(unit1AfterResaleRow).toContainText(CLIENT_2);
    await expect(
      unit1AfterResaleRow.getByTestId(
        `phone-unit-warranty-${unit1AfterResale.id}`,
      ),
    ).toHaveText(`Covered (until ${sale2Item.warranty_until})`);

    // Same search term, In stock: the SOLD unit drops out of the result —
    // an absence scoped to this run's own IMEI, so no other spec's units can
    // make it pass or fail.
    await setPhoneUnitsStatus(appPage, "In stock");
    await expect(unit1AfterResaleRow).toHaveCount(0, { timeout: 10_000 });

    // …and one of this run's still-IN_STOCK IMEIs is there instead (IMEI_2
    // was never sold, so it carries no warranty stamp at all). IMEI_3 — the
    // unit registered through the real UI in (a), same product, ALSO
    // IN_STOCK — must be absent from this same result: the two differ by
    // nothing except the IMEI typed into the box, so its absence is what
    // proves the search term itself narrowed the query (and not merely the
    // status filter re-running).
    const unit3 = await unitByImei(appPage, productId, IMEI_3);
    await searchPhoneUnits(appPage, IMEI_2);
    await expect(unit2Row).toBeVisible({ timeout: 10_000 });
    await expect(unit2Row).toContainText(IMEI_2);
    await expect(unit2Row).toContainText(PRODUCT_NAME);
    await expect(unit2Row).toContainText("IN_STOCK");
    await expect(
      unit2Row.getByTestId(`phone-unit-warranty-${unit2Initial.id}`),
    ).toHaveText("No warranty");
    await expect(
      appPage.getByTestId(`phone-unit-row-${unit3.id}`),
    ).toHaveCount(0);
  });
});
