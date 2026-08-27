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
 *   h. Model term vs. sale stamp (SECOND test in this file, owner-reported
 *      2026-08-26) — a model created with NO `warranty_months` gains 6
 *      through the REAL ProductForm; navigating back to /inventory/units the
 *      way the owner did, its IN_STOCK unit must show the MODEL's term
 *      ("6 mo — starts at sale", a promise about the next sale) instead of
 *      the misleading "No warranty", on BOTH the table and the expanded
 *      `ImeiStoryCard`. Doubles as the cache-freshness proof (both surfaces
 *      are read before the edit, inside the 30s default staleTime) and as
 *      the decision-#4 honesty proof: a unit sold BEFORE the edit stamped no
 *      `warranty_until`, so it keeps reading "No warranty" forever.
 *   i. Delete cascade (THIRD test, owner decision 2026-08-26 "zero-burden
 *      delete") — a model holding 2 IN_STOCK units plus 1 SOLD one is
 *      deleted through the REAL Inventory row-delete button. Its confirm
 *      dialog must NAME both in-stock IMEIs (and never the sold one), and
 *      after confirming: one of those freed IMEIs re-registers cleanly on a
 *      DIFFERENT model through the real ProductForm — the exact operation
 *      that used to fail with `IMEI … is already registered in stock on
 *      product "<the deleted model>"`, naming a product the operator could
 *      no longer open. The SOLD unit's history survives untouched in the
 *      Phone Units register (product name, buyer, warranty stamp), which is
 *      what makes the cascade's `status = 'IN_STOCK'` predicate load-bearing
 *      rather than an optimisation. The pre-delete half of that pair is
 *      asserted first (the same re-registration REFUSED while the model is
 *      alive) so the post-delete success cannot pass for the wrong reason.
 *   j. Whole-sale refund refused after a per-item refund (FOURTH test, the
 *      money bug fixed 2026-08-26) — driven on PLAIN (non-IMEI) products so
 *      it isolates the guard from every unit mechanism above. A 2-line cash
 *      sale, one line refunded through POS's real sale-detail per-item
 *      refund, then the Transactions page's real Refund button on the SALE
 *      row: the operator must see the NAMED refusal and the drawer must not
 *      move by a cent (the guard throws before any write). The remaining
 *      line is then refunded through the exact route that refusal names, and
 *      the drawer nets back to its pre-sale value — so the message is proven
 *      honest, not merely present.
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

// This spec asserts on toast visibility — opt out of the harness's 2ms
// notification-duration override and keep the real dismiss timing.
test.use({ notificationDurationMs: null });

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

// ─── Step (h) — the owner's 2026-08-26 repro: a model with NO warranty term
// that gains one through the real ProductForm. Its own product/IMEIs/client/
// price, all RUN_ID-unique, so nothing here can disturb steps (a)-(g). ─────

const PRODUCT_NAME_NW = `LIRA143 NoWarrPhone ${RUN_ID}`;
const IMEI_4 = `${IMEI_BASE}4`; // stays IN_STOCK — the repro subject
const IMEI_5 = `${IMEI_BASE}5`; // SOLD before the term exists (decision #4)
const CLIENT_3 = `L143-SELL3-${RUN_ID}`;
const NW_RETAIL_PRICE = 88.13;
const NW_STOCK_QUANTITY = 2;
/** The term set through the real form in step (h) — the model starts with
 *  none at all (`warranty_months` NULL). */
const NW_WARRANTY_MONTHS = 6;

// ─── Step (i) — the delete cascade. Two IN_STOCK units that must go with the
// model, one SOLD unit whose history must NOT, and a second live model to
// re-home a freed IMEI onto. Same IMEI-tracking CATEGORY_NAME (so the real
// ProductForm renders its Units section for both), own RUN_ID-unique names. ─

const PRODUCT_NAME_DEL = `LIRA143 DelPhone ${RUN_ID}`;
const PRODUCT_NAME_REHOME = `LIRA143 RehomePhone ${RUN_ID}`;
const IMEI_6 = `${IMEI_BASE}6`; // IN_STOCK, freed by the delete, then re-homed
const IMEI_7 = `${IMEI_BASE}7`; // IN_STOCK, expected gone from the register
const IMEI_8 = `${IMEI_BASE}8`; // SOLD before the delete — history must survive
const CLIENT_4 = `L143-SELL4-${RUN_ID}`;
const DEL_RETAIL_PRICE = 74.29;
const DEL_STOCK_QUANTITY = 3;

// ─── Step (j) — the partial-refund guard, on PLAIN products in their own
// non-IMEI category so nothing about units, pickers or warranties can
// influence the result. PLAIN_CATEGORY_NAME is the second deliberately
// shared/idempotent resource (auto-created by createProduct's getOrCreate,
// never flagged for IMEI tracking). ────────────────────────────────────────

const PLAIN_CATEGORY_NAME = "LIRA143 Plain";
const PLAIN_PRODUCT_A = `LIRA143 PlainA ${RUN_ID}`;
const PLAIN_PRODUCT_B = `LIRA143 PlainB ${RUN_ID}`;
const PLAIN_PRICE_A = 41.17;
const PLAIN_PRICE_B = 23.29;
/** Written out rather than computed so the sale total this spec matches rows
 *  by is a stated figure, re-derived against the two prices in the test. */
const PLAIN_SALE_TOTAL = 64.46;
const PLAIN_STOCK_QUANTITY = 5;
const CLIENT_5 = `L143-PART-${RUN_ID}`;

/** The Phone Units / story badge copy for an unsold unit of a model that HAS
 *  a term (`productUnitsLogic.warrantyDisplayBadge`) — the em dash is part of
 *  the string, so it is written once here rather than retyped per assertion. */
function termBadgeLabel(months: number): string {
  return `${months} mo — starts at sale`;
}

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
  expectedPrice: number = RETAIL_PRICE,
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
    { name: clientName, price: expectedPrice },
  );
  if (!sale) throw new Error(`Today's sale for client ${clientName} not found`);
  return sale.id;
}

async function saleItemsFor(
  page: Page,
  saleId: number,
): Promise<SaleItemRow[]> {
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
    (id) =>
      window.api.inventory.updateCategory(id, { tracks_imei_units: true }),
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
      const api = window.api
        .inventory as unknown as CreateProductWithWarrantyApi;
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

/**
 * Step (h)'s subject: the SAME IMEI-tracking category, but a model created
 * with NO warranty term at all (`warranty_months: null`) — the exact state
 * the owner's "test phone" was in before they set 6 months in the form. Its
 * own name/price/stock keep it independent of the step (a)-(g) product.
 */
async function provisionNoWarrantyProduct(page: Page): Promise<number> {
  const result = await page.evaluate(
    ({ name, category, cost, retail, stock }) => {
      const api = window.api
        .inventory as unknown as CreateProductWithWarrantyApi;
      return api.createProduct({
        barcode: "",
        name,
        category,
        cost_price: cost,
        retail_price: retail,
        stock_quantity: stock,
        min_stock_level: 0,
        warranty_months: null,
      });
    },
    {
      name: PRODUCT_NAME_NW,
      category: CATEGORY_NAME,
      cost: COST_PRICE,
      retail: NW_RETAIL_PRICE,
      stock: NW_STOCK_QUANTITY,
    },
  );
  if (!result.success || result.id == null) {
    throw new Error(`Failed to provision no-warranty product: ${result.error}`);
  }
  return result.id;
}

/**
 * Parameterised twin of the two provisioners above, for steps (i)/(j) —
 * which each need several models (and one of them a NON-IMEI category), so a
 * name-per-product helper would be four near-identical copies. The two
 * originals are left exactly as they are: they are referenced by the first
 * two tests and carry their own step-specific doc comments.
 */
async function provisionCategoryProduct(
  page: Page,
  opts: {
    name: string;
    category: string;
    cost: number;
    retail: number;
    stock: number;
    warrantyMonths: number | null;
  },
): Promise<number> {
  const result = await page.evaluate((o) => {
    const api = window.api.inventory as unknown as CreateProductWithWarrantyApi;
    return api.createProduct({
      barcode: "",
      name: o.name,
      category: o.category,
      cost_price: o.cost,
      retail_price: o.retail,
      stock_quantity: o.stock,
      min_stock_level: 0,
      warranty_months: o.warrantyMonths,
    });
  }, opts);
  if (!result.success || result.id == null) {
    throw new Error(
      `Failed to provision product ${opts.name}: ${result.error}`,
    );
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

async function openEditProduct(
  page: Page,
  productName: string = PRODUCT_NAME,
): Promise<void> {
  await navigateTo(page, "/products");
  const searchBox = page.getByPlaceholder("Search by name, barcode...");
  await expect(searchBox).toBeVisible({ timeout: 10_000 });
  await searchBox.fill(productName);
  const row = page.locator("tbody tr").filter({ hasText: productName });
  await expect(row).toBeVisible({ timeout: 10_000 });
  // Row's action cell renders exactly 3 icon buttons in this fixed JSX
  // order: [0] Adjust stock, [1] Edit, [2] Delete (ProductList.tsx).
  await row.getByRole("button").nth(1).click();
  await expect(page.getByRole("heading", { name: "Edit Product" })).toBeVisible(
    { timeout: 5_000 },
  );
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

/** Cart line for a product by name (PRODUCT_NAME unless told otherwise) —
 *  CartLineRow's own container class. */
function cartLineFor(page: Page, productName: string = PRODUCT_NAME): Locator {
  return page
    .locator("h4", { hasText: productName })
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

// ─── Step (h) helpers ───────────────────────────────────────────────────────

/** The Warranty (months) field of the real ProductForm, then Save. Drives the
 *  operator's exact path (type a term into the form, submit it) — never an
 *  `inventory.updateProduct` IPC shortcut, since the whole point of step (h)
 *  is that the value reaches the units view after a REAL form save. */
async function setProductWarrantyMonthsViaForm(
  page: Page,
  months: number,
): Promise<void> {
  const field = page.locator("#product-warranty-months");
  await expect(field).toBeVisible({ timeout: 5_000 });
  await field.fill(String(months));
  await page.getByRole("button", { name: /Save Product/ }).click();
  await expect(
    page.getByRole("heading", { name: "Edit Product" }),
  ).not.toBeVisible({ timeout: 10_000 });
}

/**
 * `products.warranty_months` as persisted — read back so a later badge
 * assertion can never be blamed on a form save that silently failed.
 *
 * Deliberately the DTO LIST read (`inventory.getProducts`, filtered by this
 * run's unique product name and then matched by id), not
 * `inventory.getProduct`: the latter goes through `findById`, whose raw
 * entity column projection (`ProductRepository.getColumns()`) does NOT
 * include `warranty_months`, so it reports `undefined` for every product no
 * matter what is stored. Using it here produced a false "the form save
 * dropped the term" failure during this spec's own development.
 */
async function productWarrantyMonths(
  page: Page,
  productId: number,
  productName: string,
): Promise<number | null> {
  return page.evaluate(
    async ({ id, name }) => {
      const products = (await window.api.inventory.getProducts(
        name,
      )) as unknown as Array<{ id: number; warranty_months?: number | null }>;
      return products.find((p) => p.id === id)?.warranty_months ?? null;
    },
    { id: productId, name: productName },
  );
}

/** The Warranty cell of one unit's row on the Phone Units page. */
function phoneUnitWarrantyBadge(page: Page, unitId: number): Locator {
  return page
    .getByTestId(`phone-unit-row-${unitId}`)
    .getByTestId(`phone-unit-warranty-${unitId}`);
}

/** Expand a unit's row and return its `ImeiStoryCard` warranty badge — the
 *  SECOND surface that renders a warranty verdict, kept consistent with the
 *  table by the same pure mapping. */
async function expandedStoryWarrantyBadge(
  page: Page,
  unitId: number,
): Promise<Locator> {
  await page.getByTestId(`phone-unit-row-${unitId}`).click();
  const panel = page.getByTestId("phone-units-story-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  return panel.getByTestId("imei-story-warranty-badge").first();
}

// ─── Step (i) helpers — the real Inventory row-delete flow ─────────────────

/** Land on the real Inventory list filtered to ONE product by this run's
 *  unique name, and return that row. */
async function findProductRow(
  page: Page,
  productName: string,
): Promise<Locator> {
  await navigateTo(page, "/products");
  const searchBox = page.getByPlaceholder("Search by name, barcode...");
  await expect(searchBox).toBeVisible({ timeout: 10_000 });
  await searchBox.fill(productName);
  const row = page.locator("tbody tr").filter({ hasText: productName });
  await expect(row).toHaveCount(1, { timeout: 10_000 });
  return row;
}

/**
 * Click the row's real Delete icon and return the `ConfirmModal` once its
 * IMEI disclosure has finished loading.
 *
 * The confirm opens IMMEDIATELY and fills the IMEI paragraph in from an
 * async per-product read, labelling its button "Checking…" until that
 * resolves (ProductList's `requestDelete`/`composeDeleteMessage`). Waiting
 * for the label to settle back to "Confirm" is what makes the disclosure
 * assertions below load-bearing: asserted against the in-flight state, a
 * "does not mention the SOLD IMEI" check would pass on an empty message.
 */
async function openProductDeleteConfirm(
  page: Page,
  productId: number,
  productName: string,
): Promise<Locator> {
  await findProductRow(page, productName);
  await page.getByTestId(`inventory-delete-${productId}`).click();
  const modal = page.getByTestId("confirm-modal");
  await expect(modal).toBeVisible({ timeout: 5_000 });
  await expect(
    modal.getByRole("button", { name: "Confirm", exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  return modal;
}

// ─── Step (j) helpers — plain-product checkout and the per-item refund ─────

/** Add a plain (non-IMEI) product to the POS cart the way an operator does:
 *  type its name, click the result. */
async function addPlainProductToCart(
  page: Page,
  productName: string,
): Promise<void> {
  const posSearch = page.getByPlaceholder(
    "Search products by name or barcode...",
  );
  await expect(posSearch).toBeVisible({ timeout: 10_000 });
  await posSearch.fill(productName);
  await page.getByText(productName, { exact: true }).first().click();
  await expect(cartLineFor(page, productName)).toBeVisible({ timeout: 5_000 });
}

/**
 * Open one sale's detail modal from POS's own today's-sales panel — the ONLY
 * surface carrying the per-item refund the guard's message points the
 * operator to.
 *
 * That panel has two layouts (a card grid by default, a `DataTable` once the
 * operator turns product images off — `pos_show_images` in localStorage,
 * which is per-profile and therefore not this spec's to assume), so the
 * entry is matched as "whatever clickable element carries this run's client
 * marker" rather than by layout. The returned locator is the modal box
 * itself, reached by the same ancestor-xpath discipline `closeProductForm`
 * uses; the modal is identified by `Sale #<id>` — the id this spec resolved
 * by identity, never a row position (rule 15).
 */
async function openSaleDetail(
  page: Page,
  saleId: number,
  clientName: string,
): Promise<Locator> {
  await navigateTo(page, "/pos");
  const posSearch = page.getByPlaceholder(
    "Search products by name or barcode...",
  );
  await expect(posSearch).toBeVisible({ timeout: 10_000 });
  // The sales panel only renders while the search box is empty.
  await posSearch.fill("");
  await page
    .locator("button, tbody tr")
    .filter({ hasText: clientName })
    .first()
    .click();
  const heading = page.getByRole("heading", { name: `Sale #${saleId}` });
  await expect(heading).toBeVisible({ timeout: 10_000 });
  return heading.locator("xpath=ancestor::div[contains(@class,'max-w-lg')][1]");
}

/** Refund exactly 1 of one line through the sale-detail modal's real
 *  per-item Refund button + its quantity step. */
async function refundOneItemViaSaleDetail(
  page: Page,
  modal: Locator,
  itemName: string,
): Promise<void> {
  const itemRow = modal
    .getByText(itemName, { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'justify-between')][1]");
  await expect(itemRow).toBeVisible({ timeout: 5_000 });
  await itemRow.locator('button[title="Refund item"]').click();

  const qtyHeading = page.getByRole("heading", {
    name: "Refund Item Quantity",
  });
  await expect(qtyHeading).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: /^Refund 1x$/ }).click();
  await expect(qtyHeading).not.toBeVisible({ timeout: 15_000 });
}

/** `sales.status` as persisted — the "did the per-item route actually finish
 *  the reversal" read for step (j). */
async function saleStatus(page: Page, saleId: number): Promise<string | null> {
  return page.evaluate(async (id) => {
    const sale = (await window.api.sales.get(id)) as unknown as {
      status?: string;
    } | null;
    return sale?.status ?? null;
  }, saleId);
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
    await expect(section.getByText(IMEI_3, { exact: false })).toBeVisible({
      timeout: 5_000,
    });
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
    await expect(
      cartLine1.locator('input[placeholder="Enter IMEI / Serial"]'),
    ).toHaveCount(0);

    await appPage.getByRole("button", { name: "Proceed to Checkout" }).click();
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
    expect(expectedWarrantyToleratingMidnight).toContain(
      sale1Item.warranty_until,
    );

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

    await appPage.getByRole("button", { name: "Proceed to Checkout" }).click();
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
    await expect(strictnessAlert).toContainText("identify the unit being sold");
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

    await appPage.getByRole("button", { name: "Proceed to Checkout" }).click();
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
    // was never sold, so it carries no warranty STAMP at all — and since
    // 2026-08-26 its cell states the MODEL's term instead of a misleading
    // "No warranty", because this product was created with
    // `warranty_months: 6`; the warranty-less case is covered by test (h)'s
    // own product, which has none). IMEI_3 — the
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
    ).toHaveText(termBadgeLabel(WARRANTY_MONTHS));
    await expect(appPage.getByTestId(`phone-unit-row-${unit3.id}`)).toHaveCount(
      0,
    );
  });

  /**
   * (h) The owner's exact repro (reported 2026-08-26): a model whose
   * `warranty_months` was NULL gains a 6-month term through the real
   * ProductForm; its IN_STOCK units must stop reading "No warranty" the
   * moment the operator navigates back to /inventory/units.
   *
   * Its own test rather than a further step on the first one: this drives a
   * second full POS sale plus four page navigations, which would push the
   * single test past the 90s config timeout. It self-provisions everything it
   * touches (own product name, own IMEIs, own client, own price — only
   * CATEGORY_NAME is shared and that read is idempotent), so it neither
   * depends on nor disturbs steps (a)-(g), and the shared accumulating DB is
   * only ever queried through this run's own identities (rule 15).
   *
   * The two halves are deliberately opposed, because the fix must NOT be
   * "show a warranty everywhere":
   *   - IMEI_4 is IN_STOCK: after the edit it shows the MODEL's term
   *     ("6 mo — starts at sale") — a statement about what the buyer will
   *     get, not a coverage claim.
   *   - IMEI_5 was SOLD BEFORE the edit, so its sale line stamped no
   *     `warranty_until` at all: it keeps reading "No warranty" forever
   *     (decision #4 — the clock starts at the sale and is never
   *     retro-stamped). If a change ever makes the term leak onto sold
   *     units, this half fails.
   *
   * It is also the cache-freshness proof: both surfaces (the table and the
   * expanded `ImeiStoryCard`) are READ before the edit, so their TanStack
   * entries are warm inside the 30s default `staleTime` — without the
   * product-save invalidation the post-edit assertions get served the stale
   * pre-edit term.
   */
  test("model term appears on in-stock units after a real ProductForm warranty edit, never on a unit sold before it", async ({
    appPage,
  }) => {
    await closeAllActiveSessions(appPage);

    // ─── Provision: same IMEI-tracking category, model with NO term ───────
    await ensureImeiCategory(appPage);
    const nwProductId = await provisionNoWarrantyProduct(appPage);
    expect(
      await productWarrantyMonths(appPage, nwProductId, PRODUCT_NAME_NW),
    ).toBeNull();
    await registerImeisViaIpc(appPage, nwProductId, [IMEI_4, IMEI_5]);
    const unit4 = await unitByImei(appPage, nwProductId, IMEI_4);
    const unit5 = await unitByImei(appPage, nwProductId, IMEI_5);

    // ─── Sell IMEI_5 while the model still has NO warranty term ───────────
    await navigateTo(appPage, "/pos");
    const posSearch = appPage.getByPlaceholder(
      "Search products by name or barcode...",
    );
    await expect(posSearch).toBeVisible({ timeout: 10_000 });
    await posSearch.fill(IMEI_5);
    await expect(posSearch).toHaveValue("", { timeout: 10_000 });

    const nwCartLine = cartLineFor(appPage, PRODUCT_NAME_NW);
    await expect(nwCartLine).toBeVisible({ timeout: 5_000 });
    await expect(nwCartLine.locator("select")).toHaveValue(String(unit5.id));

    await appPage.getByRole("button", { name: "Proceed to Checkout" }).click();
    await expect(appPage.getByTestId("checkout-modal")).toBeVisible({
      timeout: 5_000,
    });
    await fillClientName(appPage, CLIENT_3);
    await completeCashSale(appPage);

    const unit5AfterSale = await unitByImei(appPage, nwProductId, IMEI_5);
    expect(unit5AfterSale.status).toBe("SOLD");

    // The sale line stamped NOTHING — there was no term to stamp. This is
    // what makes the later "still No warranty" assertion meaningful rather
    // than a tautology about the badge.
    const nwSaleId = await findTodaysSaleId(appPage, CLIENT_3, NW_RETAIL_PRICE);
    const nwSaleItems = await saleItemsFor(appPage, nwSaleId);
    const nwSaleItem = nwSaleItems.find((it) => it.product_id === nwProductId);
    if (!nwSaleItem)
      throw new Error("Sale item for the no-warranty sale not found");
    expect(nwSaleItem.imei).toBe(IMEI_5);
    expect(nwSaleItem.warranty_until).toBeNull();

    // ─── Before the edit: both units read as warranty-less ────────────────
    await openPhoneUnitsPage(appPage);

    await searchPhoneUnits(appPage, IMEI_4);
    await expect(appPage.getByTestId(`phone-unit-row-${unit4.id}`)).toBeVisible(
      {
        timeout: 10_000,
      },
    );
    await expect(phoneUnitWarrantyBadge(appPage, unit4.id)).toHaveText(
      "No warranty",
    );

    await searchPhoneUnits(appPage, IMEI_5);
    await expect(appPage.getByTestId(`phone-unit-row-${unit5.id}`)).toBeVisible(
      {
        timeout: 10_000,
      },
    );
    await expect(phoneUnitWarrantyBadge(appPage, unit5.id)).toHaveText(
      "No warranty",
    );

    // Warm the story cache for IMEI_4 too — the second surface.
    await searchPhoneUnits(appPage, IMEI_4);
    await expect(appPage.getByTestId(`phone-unit-row-${unit4.id}`)).toBeVisible(
      {
        timeout: 10_000,
      },
    );
    await expect(
      await expandedStoryWarrantyBadge(appPage, unit4.id),
    ).toHaveText("No warranty");

    // ─── The owner's edit: Warranty (months) = 6 in the REAL ProductForm ──
    await openEditProduct(appPage, PRODUCT_NAME_NW);
    await setProductWarrantyMonthsViaForm(appPage, NW_WARRANTY_MONTHS);
    // Persisted — so a stale badge below is a display/cache defect and can
    // never be a silently-failed save.
    expect(
      await productWarrantyMonths(appPage, nwProductId, PRODUCT_NAME_NW),
    ).toBe(NW_WARRANTY_MONTHS);

    // ─── The owner's exact navigation: back to /inventory/units ───────────
    await openPhoneUnitsPage(appPage);
    await searchPhoneUnits(appPage, IMEI_4);
    await expect(appPage.getByTestId(`phone-unit-row-${unit4.id}`)).toBeVisible(
      {
        timeout: 10_000,
      },
    );
    await expect(phoneUnitWarrantyBadge(appPage, unit4.id)).toHaveText(
      termBadgeLabel(NW_WARRANTY_MONTHS),
      { timeout: 10_000 },
    );

    // Decision #4 honesty: the unit sold BEFORE the term existed keeps none.
    await searchPhoneUnits(appPage, IMEI_5);
    await expect(appPage.getByTestId(`phone-unit-row-${unit5.id}`)).toBeVisible(
      {
        timeout: 10_000,
      },
    );
    await expect(phoneUnitWarrantyBadge(appPage, unit5.id)).toHaveText(
      "No warranty",
    );

    // Both surfaces agree — the expanded story card shows the term too.
    await searchPhoneUnits(appPage, IMEI_4);
    await expect(appPage.getByTestId(`phone-unit-row-${unit4.id}`)).toBeVisible(
      {
        timeout: 10_000,
      },
    );
    await expect(
      await expandedStoryWarrantyBadge(appPage, unit4.id),
    ).toHaveText(termBadgeLabel(NW_WARRANTY_MONTHS), { timeout: 10_000 });
  });

  /**
   * Step (i) — the delete cascade (owner decision 2026-08-26, "zero-burden
   * delete"; `ProductUnitRepository.deleteInStockForProducts` +
   * `InventoryService.deleteProduct`, disclosed by ProductList's confirm).
   *
   * Three things have to be true at once, and each is asserted on the
   * surface the operator actually sees:
   *
   *   1. The confirm NAMES the in-stock IMEIs it is about to destroy, and
   *      names ONLY those — the SOLD unit must not appear, because it is not
   *      going anywhere.
   *   2. The delete FREES those IMEIs. Proven as a pair: the same
   *      re-registration is REFUSED first (while the model is alive, with
   *      the named "already registered … product" error), then ACCEPTED
   *      after. Without the refusal half, a success afterwards could just
   *      mean the IMEI was never locked — a green test proving nothing.
   *   3. The SOLD unit's history SURVIVES the model's deletion, complete
   *      with the deleted model's name, the buyer, and the sale's warranty
   *      stamp — the Phone Units register's `LEFT JOIN products` carries no
   *      `is_deleted` filter, which is exactly what keeps a customer's
   *      warranty story readable after the shop stops stocking the model.
   *
   * Rule 15: every product/IMEI/client here is RUN_ID-unique and every
   * register assertion is keyed on an exact IMEI or unit id, never a row
   * position or a count — the shared e2e DB accumulates units from every
   * earlier spec (including the two tests above).
   */
  test("deleting a product removes its in-stock units, frees their IMEIs, and keeps the sold unit's history", async ({
    appPage,
  }) => {
    await closeAllActiveSessions(appPage);

    // ─── Provision: the doomed model (2 in-stock + 1 to sell) and a live
    // second model in the same IMEI-tracking category to re-home onto ─────
    await ensureImeiCategory(appPage);
    const delProductId = await provisionCategoryProduct(appPage, {
      name: PRODUCT_NAME_DEL,
      category: CATEGORY_NAME,
      cost: COST_PRICE,
      retail: DEL_RETAIL_PRICE,
      stock: DEL_STOCK_QUANTITY,
      warrantyMonths: WARRANTY_MONTHS,
    });
    const rehomeProductId = await provisionCategoryProduct(appPage, {
      name: PRODUCT_NAME_REHOME,
      category: CATEGORY_NAME,
      cost: COST_PRICE,
      retail: DEL_RETAIL_PRICE,
      stock: 1,
      warrantyMonths: WARRANTY_MONTHS,
    });
    await registerImeisViaIpc(appPage, delProductId, [IMEI_6, IMEI_7, IMEI_8]);
    const unit6 = await unitByImei(appPage, delProductId, IMEI_6);
    const unit7 = await unitByImei(appPage, delProductId, IMEI_7);
    const unit8 = await unitByImei(appPage, delProductId, IMEI_8);

    // ─── Sell IMEI_8 through the real POS scan path, so the surviving unit
    // is a genuine sale with a stamped warranty (not a hand-set row) ──────
    await navigateTo(appPage, "/pos");
    const delPosSearch = appPage.getByPlaceholder(
      "Search products by name or barcode...",
    );
    await expect(delPosSearch).toBeVisible({ timeout: 10_000 });
    await delPosSearch.fill(IMEI_8);
    await expect(delPosSearch).toHaveValue("", { timeout: 10_000 });

    const delCartLine = cartLineFor(appPage, PRODUCT_NAME_DEL);
    await expect(delCartLine).toBeVisible({ timeout: 5_000 });
    await expect(delCartLine.locator("select")).toHaveValue(String(unit8.id));

    await appPage.getByRole("button", { name: "Proceed to Checkout" }).click();
    await expect(appPage.getByTestId("checkout-modal")).toBeVisible({
      timeout: 5_000,
    });
    await fillClientName(appPage, CLIENT_4);
    await completeCashSale(appPage);

    const unit8AfterSale = await unitByImei(appPage, delProductId, IMEI_8);
    expect(unit8AfterSale.status).toBe("SOLD");
    const story8 = await storyFor(appPage, IMEI_8);
    const soldWarrantyUntil = story8[0]?.warranty.until;
    if (!soldWarrantyUntil) {
      throw new Error("Expected a stamped warranty on the sold unit");
    }

    // ─── The lock, BEFORE the delete: re-registering IMEI_6 on the OTHER
    // live model is refused, naming the model that holds it (decision #3).
    // This is the half that makes the post-delete success meaningful. ─────
    await openEditProduct(appPage, PRODUCT_NAME_REHOME);
    const rehomeSection = unitsSection(appPage);
    await expect(rehomeSection).toBeVisible({ timeout: 5_000 });
    await registerImeiViaUi(appPage, IMEI_6);
    await expect(
      rehomeSection.getByText(
        new RegExp(
          `IMEI ${escapeRegExp(IMEI_6)} is already registered in stock on product "${escapeRegExp(PRODUCT_NAME_DEL)}"`,
        ),
      ),
    ).toBeVisible({ timeout: 5_000 });
    // The refusal wrote nothing — the rehome model still has no units.
    expect(await unitsForProduct(appPage, rehomeProductId)).toHaveLength(0);
    await closeProductForm(appPage);

    // ─── Delete the model through the REAL Inventory row-delete button ────
    const deleteConfirm = await openProductDeleteConfirm(
      appPage,
      delProductId,
      PRODUCT_NAME_DEL,
    );
    // Today's base copy is untouched…
    await expect(deleteConfirm).toContainText("This action cannot be undone.");
    // …plus the disclosure of exactly what else goes.
    await expect(deleteConfirm).toContainText(
      "also removes 2 registered in-stock IMEIs",
    );
    await expect(deleteConfirm).toContainText(IMEI_6);
    await expect(deleteConfirm).toContainText(IMEI_7);
    // The SOLD unit is NOT part of the cascade and must not be threatened.
    await expect(deleteConfirm).not.toContainText(IMEI_8);

    await deleteConfirm
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect(deleteConfirm).not.toBeVisible({ timeout: 10_000 });

    // The product is gone from the list it was deleted from…
    await navigateTo(appPage, "/products");
    const invSearchAfterDelete = appPage.getByPlaceholder(
      "Search by name, barcode...",
    );
    await expect(invSearchAfterDelete).toBeVisible({ timeout: 10_000 });
    await invSearchAfterDelete.fill(PRODUCT_NAME_DEL);
    await expect(
      appPage.locator("tbody tr").filter({ hasText: PRODUCT_NAME_DEL }),
    ).toHaveCount(0, { timeout: 10_000 });

    // …and so are its two IN_STOCK units, while the SOLD one is still there.
    const unitsAfterDelete = await unitsForProduct(appPage, delProductId);
    expect(unitsAfterDelete.map((u) => u.imei)).toEqual([IMEI_8]);
    expect(unitsAfterDelete[0]?.status).toBe("SOLD");
    expect(unitsAfterDelete[0]?.id).toBe(unit8.id);
    expect(unitsAfterDelete.map((u) => u.id)).not.toContain(unit6.id);
    expect(unitsAfterDelete.map((u) => u.id)).not.toContain(unit7.id);

    // ─── The lock is FREED: the same re-registration now succeeds through
    // the same real ProductForm path that refused it above ────────────────
    await openEditProduct(appPage, PRODUCT_NAME_REHOME);
    const rehomeSection2 = unitsSection(appPage);
    await expect(rehomeSection2).toBeVisible({ timeout: 5_000 });
    await registerImeiViaUi(appPage, IMEI_6);
    await expect(
      rehomeSection2.getByText(IMEI_6, { exact: false }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      rehomeSection2.getByText(/is already registered in stock on product/),
    ).toHaveCount(0);
    await closeProductForm(appPage);

    const rehomedUnits = await unitsForProduct(appPage, rehomeProductId);
    expect(rehomedUnits.map((u) => u.imei)).toEqual([IMEI_6]);
    expect(rehomedUnits[0]?.status).toBe("IN_STOCK");
    // A NEW row on the NEW model — never the old one relabelled.
    expect(rehomedUnits[0]?.id).not.toBe(unit6.id);
    expect(rehomedUnits[0]?.product_id).toBe(rehomeProductId);

    // ─── The sold unit's history survives in the shop-wide register ───────
    await openPhoneUnitsPage(appPage);
    await searchPhoneUnits(appPage, IMEI_8);
    const soldRow = appPage.getByTestId(`phone-unit-row-${unit8.id}`);
    await expect(soldRow).toBeVisible({ timeout: 10_000 });
    // The DELETED model's name is still readable on the row, together with
    // the buyer and the warranty the sale stamped.
    await expect(soldRow).toContainText(PRODUCT_NAME_DEL);
    await expect(soldRow).toContainText(CLIENT_4);
    await expect(soldRow).toContainText("SOLD");
    await expect(phoneUnitWarrantyBadge(appPage, unit8.id)).toHaveText(
      `Covered (until ${soldWarrantyUntil})`,
    );

    // The deleted in-stock unit is gone from that same register.
    await searchPhoneUnits(appPage, IMEI_7);
    await expect(appPage.getByTestId(`phone-unit-row-${unit7.id}`)).toHaveCount(
      0,
      { timeout: 10_000 },
    );
  });

  /**
   * Step (j) — a whole-sale refund/void is refused once ANY line of that
   * sale has already been refunded individually
   * (`TransactionRepository._assertNoPartialItemRefunds`, owner decision
   * 2026-08-26).
   *
   * The bug it closes was money-shaped: `refundSaleItem` pro-rates the
   * original tender and debits the drawers by that share, but writes a
   * standalone REFUND row with NO `reverses_id` — so the double-refund guard
   * never saw item refunds, and a whole-sale refund afterwards mirrored the
   * FULL legs, handing back the share already returned (probe-proven: $40 out
   * of the drawer for a $30 sale).
   *
   * Deliberately driven on PLAIN, non-IMEI products: the guard is about
   * payment legs, and using phone units here would entangle it with the
   * unit/warranty mechanisms the tests above own.
   *
   * Rule 15 throughout: the sale is found by its client marker plus this
   * run's unique total, the audit row is filtered by both (never a row
   * position), and every money figure is a DELTA snapshotted immediately
   * around its own action.
   */
  test("a whole-sale refund is refused after a per-item refund, and the drawer never moves", async ({
    appPage,
  }) => {
    await closeAllActiveSessions(appPage);

    // Re-derive the stated total from its two parts, so a later edit to one
    // price can't leave this spec matching audit rows by a stale figure.
    expect(PLAIN_PRICE_A + PLAIN_PRICE_B).toBeCloseTo(PLAIN_SALE_TOTAL, 2);

    for (const [name, price] of [
      [PLAIN_PRODUCT_A, PLAIN_PRICE_A],
      [PLAIN_PRODUCT_B, PLAIN_PRICE_B],
    ] as const) {
      await provisionCategoryProduct(appPage, {
        name,
        category: PLAIN_CATEGORY_NAME,
        cost: 10,
        retail: price,
        stock: PLAIN_STOCK_QUANTITY,
        warrantyMonths: null,
      });
    }

    // ─── The 2-line cash sale ─────────────────────────────────────────────
    const drawerBeforeSale = await generalUsd(appPage);

    await navigateTo(appPage, "/pos");
    await addPlainProductToCart(appPage, PLAIN_PRODUCT_A);
    await addPlainProductToCart(appPage, PLAIN_PRODUCT_B);

    await appPage.getByRole("button", { name: "Proceed to Checkout" }).click();
    await expect(appPage.getByTestId("checkout-modal")).toBeVisible({
      timeout: 5_000,
    });
    await fillClientName(appPage, CLIENT_5);
    await completeCashSale(appPage);

    await expect
      .poll(async () => generalUsd(appPage), { timeout: 8_000 })
      .toBeCloseTo(drawerBeforeSale + PLAIN_SALE_TOTAL, 2);

    const partialSaleId = await findTodaysSaleId(
      appPage,
      CLIENT_5,
      PLAIN_SALE_TOTAL,
    );

    // ─── Refund ONE line through POS's real per-item refund ───────────────
    const saleDetail = await openSaleDetail(appPage, partialSaleId, CLIENT_5);
    await refundOneItemViaSaleDetail(appPage, saleDetail, PLAIN_PRODUCT_A);

    await expect
      .poll(async () => generalUsd(appPage), { timeout: 8_000 })
      .toBeCloseTo(drawerBeforeSale + PLAIN_PRICE_B, 2);
    // The sale is NOT finished — one line is still live, which is precisely
    // the state that used to offer a double-refunding one-click reversal.
    expect(await saleStatus(appPage, partialSaleId)).not.toBe("refunded");

    // ─── The whole-sale refund on the Transactions page is REFUSED ────────
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/audit");

    const partialSaleRow = appPage
      .locator("tbody tr")
      .filter({ hasText: CLIENT_5 })
      .filter({ hasText: PLAIN_SALE_TOTAL.toFixed(2) });
    await expect(partialSaleRow).toHaveCount(1, { timeout: 10_000 });
    await partialSaleRow.scrollIntoViewIfNeeded();

    // TransactionsViewer surfaces a rejected refund through `alert("Failed:
    // " + error)`. The fixture auto-accepts dialogs globally; this listener
    // only records what the operator was shown (lira-142's precedent).
    const dialogLog: string[] = [];
    appPage.on("dialog", (d) => dialogLog.push(d.message()));

    const refundBtn = partialSaleRow.getByRole("button", { name: /^Refund$/ });
    await expect(refundBtn).toBeVisible();
    await refundBtn.click();

    // A cash sale has payment legs, so the real refund-method modal opens
    // (no confirm() on this branch) — the guard has to fire from inside the
    // repository, after the operator committed to the action.
    const refundModal = appPage.getByTestId("counterparty-settle-modal");
    await expect(refundModal).toBeVisible({ timeout: 10_000 });
    const confirmRefundBtn = appPage.getByRole("button", {
      name: "Confirm Refund",
    });
    await expect(confirmRefundBtn).toBeEnabled({ timeout: 10_000 });

    const drawerBeforeBlocked = await generalUsd(appPage);
    const seen = dialogLog.length;
    await confirmRefundBtn.click();
    await expect
      .poll(() => dialogLog.length, { timeout: 10_000 })
      .toBeGreaterThan(seen);

    const blockedMsg = dialogLog[seen] ?? "";
    expect(blockedMsg).toMatch(/^Failed:/);
    expect(blockedMsg).toContain("This sale was partially refunded");
    expect(blockedMsg).toContain("refund the remaining items individually");

    // The guard throws BEFORE any write — not a cent moved, and the sale is
    // untouched. This is the assertion the money bug fails.
    expect(await generalUsd(appPage)).toBeCloseTo(drawerBeforeBlocked, 2);
    expect(await saleStatus(appPage, partialSaleId)).not.toBe("refunded");

    // ─── The route the refusal NAMES actually completes the reversal ──────
    // Without this, the guard would only be proven to block; the message
    // ("refund the remaining items individually from the sale detail") is
    // what makes it a redirect rather than a dead end.
    const saleDetail2 = await openSaleDetail(appPage, partialSaleId, CLIENT_5);
    await refundOneItemViaSaleDetail(appPage, saleDetail2, PLAIN_PRODUCT_B);

    await expect
      .poll(async () => generalUsd(appPage), { timeout: 8_000 })
      .toBeCloseTo(drawerBeforeSale, 2);
    await expect
      .poll(async () => saleStatus(appPage, partialSaleId), { timeout: 8_000 })
      .toBe("refunded");
  });
});
