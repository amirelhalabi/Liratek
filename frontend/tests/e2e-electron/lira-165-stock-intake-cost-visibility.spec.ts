/**
 * E2E: LIRA-165 — stock-intake cost visibility (migration v165, owner report
 * 2026-09-07).
 *
 * The owner received 2 iPhones at $1,300 on top of 2 already held at $1,200.
 * The data booked correctly (two FIFO cost batches, four units total) but the
 * UI showed neither the new cost in the adjustment history nor any sign of
 * the second batch — `stock_adjustments` had no cost column at all. Migration
 * v165 adds a nullable `unit_cost_usd` column there (only
 * `ProductRepository.receiveStock` — a real delivery — ever writes it; the
 * plain adjustStock/adjustStockDelta/decreaseStockForAdjustment correction
 * paths keep writing NULL, since no cost applies to a count correction or
 * shrinkage), and `AdjustStockModal.tsx` renders it in two places:
 *
 *   - "Adjustment History": `{+|-}{delta}{ @ $cost.toFixed(2) — only when
 *     unit_cost_usd is not null} ({old} → {new})`
 *   - "Cost Batches" (gated on `batches.length >= 2` — a single batch says
 *     nothing the "Current stock" row above doesn't): one line per batch,
 *     `{quantity_remaining} units @ ${unit_cost_usd.toFixed(2)}`.
 *
 * Nothing before this spec drove either surface through the real dialog —
 * `AdjustStockModal.test.tsx` mocks the API layer, which pins the component's
 * own logic but not that a REAL `receiveStock` round-trip (real IPC, real SQL,
 * real re-fetch) renders correctly end to end. This file drives the REAL
 * Inventory UI for every money-relevant step: the "Adjust stock" button on
 * the real /products row, the real AdjustStockModal form (mode toggle, unit
 * cost, reason), and reads its assertions off the rendered dialog — never a
 * hand-built IPC payload for the receipts/correction themselves, since a
 * hand-built payload is exactly what would NOT have caught this bug (the data
 * was already booked correctly; only the rendering was broken). Only the
 * product itself is seeded via IPC (setup, not the behaviour under test),
 * the same latitude lira-144's seeds take.
 *
 * Selector strategy (deliberately NOT a "scope everything to one modal root"
 * helper): AdjustStockModal has no root testid, and its outermost element is
 * a plain `<div>` — every ANCESTOR div all the way up to the app's own root
 * element also technically "contains" the modal's heading text, so a
 * `page.locator("div").filter({hasText: "Adjust Stock"}).first()` trick would
 * actually resolve to the outermost app-shell div, not the modal, and could
 * silently widen every "inside the modal" query to the whole page. Instead:
 *   - Every button/placeholder/heading targeted below (`Adjust Stock`,
 *     `Cost Batches`, `Apply Adjustment`, `Add / remove (+/-)`, the
 *     `+10 or -5` / reason placeholders) is grepped-unique to
 *     AdjustStockModal.tsx across all of frontend/src — safe to query
 *     unscoped, and only one product's modal is ever open at a time (only
 *     one `adjustingProduct` in ProductList's state).
 *   - The unit cost field has neither a placeholder nor a `for`/`id`-linked
 *     label, so it's targeted via its own visible label text through XPath
 *     (`//label[contains(., "Unit cost")]/following-sibling::div//input`) —
 *     precise by construction, no ambiguity about "which div is the modal".
 *   - The one negative assertion that genuinely needs a bounded container
 *     (assertion 3 — "this specific row has no cost annotation", when OTHER
 *     rows in the same list DO) is scoped via the reason `<p>`'s own direct
 *     parent (`locator("p").filter({hasText}).locator("xpath=..")`) —
 *     `<p>` elements don't nest, so filtering on `p` is unambiguous, and
 *     "one parent up" is precise (that parent IS the per-adjustment entry
 *     div; see AdjustStockModal.tsx's `adjustments.map` block).
 *
 * Isolation (rule 15 — shared accumulating DB, specs run in order):
 *  - The product name/category are unique strings never used elsewhere in
 *    the suite (grepped), and `getStockAdjustments`/`getOpenStockBatches` are
 *    themselves scoped by this product's own id — every assertion below is
 *    already isolated by identity, with no need for delta math.
 *  - The category name is brand-new, so `product_categories.tracks_imei_units`
 *    lands on its schema DEFAULT of 0 (v157) — this product never tracks
 *    IMEI units, so a successful increase always closes the modal
 *    immediately instead of advancing to the serial-scanning "intake" step
 *    (AdjustStockModal.tsx's `step === "intake"` branch), which would hide
 *    the very history/batches UI this file needs to read.
 *  - No supplier is set on the product, so `receiveStock` never books a
 *    supplier_ledger row/transaction for either receipt
 *    (`ProductRepository.bookIntakeAndBatch`'s `if (supplierName && …)`
 *    guard) — the "don't snapshot transactions/ledger totals around a
 *    supplier-attached intake" discipline doesn't apply here because there
 *    is no supplier to attach.
 *  - The product starts at `stock_quantity: 0`, so `createProduct()` itself
 *    never runs its own opening-stock booking path either (`openingQuantity
 *    > 0` is false) — the two batches asserted below are created ONLY by the
 *    two real Adjust Stock submissions in this test, never by seeding.
 *
 * Rule 17 (failing-first procedure for whoever verifies this spec before
 * merge — not run as part of writing this file): in
 * `frontend/src/features/inventory/components/AdjustStockModal.tsx`, (a)
 * delete the `adj.unit_cost_usd != null && \` @ $${...}\`` conjunct from the
 * history line (leave the rest) and (b) change the Cost Batches section's
 * `batches.length >= 2` guard to `false`. Re-run this file: both history-row
 * cost assertions and the entire Cost Batches block fail, while the
 * old→new/reason/no-cost-annotation assertions for the plain correction
 * still pass — i.e. it fails for the right reason. Revert both changes
 * afterward.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

// ---------------------------------------------------------------------------
// Spec-scoped identities
// ---------------------------------------------------------------------------

const PRODUCT_NAME = "L165 iPhone Batch";
/** Brand-new category name => `tracks_imei_units` DEFAULTs to 0 (v157) — see
 *  the header note on why that matters for this flow. */
const CATEGORY = "L165 Phones";

const FIRST_QTY = 2;
const FIRST_COST = 1200;
const FIRST_REASON = "Received 2 iPhones at $1200";

const SECOND_QTY = 2;
const SECOND_COST = 1300;
const SECOND_REASON = "Received 2 iPhones at $1300";

const CORRECTION_DELTA = -1;
const CORRECTION_REASON = "Shrinkage correction, no cost recorded";

// ---------------------------------------------------------------------------
// Setup (IPC — seeding, not the behaviour under test)
// ---------------------------------------------------------------------------

async function seedProduct(appPage: Page): Promise<void> {
  const created = await appPage.evaluate(
    (p) =>
      window.api.inventory.createProduct({
        barcode: "",
        name: p.name,
        category: p.category,
        cost_price: 0,
        retail_price: 1999,
        stock_quantity: 0,
        min_stock_level: 0,
      }),
    { name: PRODUCT_NAME, category: CATEGORY },
  );
  if (!created.success || created.id == null) {
    throw new Error(
      `LIRA-165 seed "${PRODUCT_NAME}" failed: ${created.error ?? "no id returned"}`,
    );
  }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/** One table row, matched by a product NAME unique to this spec (rule 15) —
 *  `<tr>` elements never nest, so filtering by `hasText` is unambiguous. */
function productRow(appPage: Page): Locator {
  return appPage.locator("tbody tr").filter({ hasText: PRODUCT_NAME });
}

function searchBox(appPage: Page): Locator {
  return appPage.getByPlaceholder(/search by name, barcode/i);
}

/** The modal's "Unit cost ($) *" field has no placeholder and no
 *  `for`/`id`-linked label, so it's found via its own visible label text
 *  instead of position — see the header note on why this beats trying to
 *  scope a "modal root" div. */
function unitCostInput(appPage: Page): Locator {
  return appPage.locator(
    'xpath=//label[contains(., "Unit cost")]/following-sibling::div//input[@type="number"]',
  );
}

async function openAdjustModal(appPage: Page): Promise<void> {
  await productRow(appPage).getByTitle("Adjust stock").click();
  await expect(
    appPage.getByRole("heading", { name: "Adjust Stock" }),
  ).toBeVisible();
}

/**
 * Submits ONE stock change through the real form and waits for the modal to
 * close. Always uses delta ("Add / remove") mode — the modal remounts fresh
 * every time it's opened, so mode resets to "set" and is re-selected on
 * every call. `unitCost` is supplied only for an increase; the field isn't
 * in the DOM at all otherwise (AdjustStockModal.tsx's `isIncrease` gate), so
 * this never tries to fill a field that doesn't exist.
 */
async function submitAdjustment(
  appPage: Page,
  opts: { delta: number; unitCost?: number; reason: string },
): Promise<void> {
  await appPage.getByRole("button", { name: "Add / remove (+/-)" }).click();
  await appPage.getByPlaceholder("+10 or -5").fill(String(opts.delta));
  if (opts.unitCost != null) {
    await unitCostInput(appPage).fill(String(opts.unitCost));
  }
  await appPage
    .getByPlaceholder(
      "e.g. Physical recount, damaged goods, supplier correction",
    )
    .fill(opts.reason);
  await appPage.getByRole("button", { name: "Apply Adjustment" }).click();
  // This category never tracks IMEI units (see header note), so a
  // successful increase closes immediately — it never advances to the
  // serial-scanning "intake" step, which would leave the modal open with
  // the history/batches UI unmounted underneath it.
  await expect(
    appPage.getByRole("heading", { name: "Adjust Stock" }),
  ).toHaveCount(0);
}

/**
 * The single `<div>` rendering ONE Adjustment History entry, isolated by its
 * own (spec-unique) reason text. `<p>` elements don't nest, so filtering on
 * `p` is unambiguous, and the entry's delta/cost/old→new `<span>` sits
 * alongside the reason `<p>` as a DIRECT child of the same entry `<div>` (see
 * AdjustStockModal.tsx's `adjustments.map` block) — so "one parent up" from
 * the reason paragraph is exactly the entry container, no further or less.
 */
function historyEntry(appPage: Page, reason: string): Locator {
  return appPage.locator("p").filter({ hasText: reason }).locator("xpath=..");
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe("LIRA-165 — stock intake cost visibility", () => {
  test("two receipts at different costs show in history + Cost Batches; a plain correction stays cost-free", async ({
    appPage,
  }) => {
    await seedProduct(appPage);

    await navigateTo(appPage, "/products");
    await searchBox(appPage).fill(PRODUCT_NAME);
    await expect(productRow(appPage)).toHaveCount(1);

    // --- Receipt 1: 2 units @ $1,200 (0 -> 2) --------------------------
    await openAdjustModal(appPage);
    await submitAdjustment(appPage, {
      delta: FIRST_QTY,
      unitCost: FIRST_COST,
      reason: FIRST_REASON,
    });

    // Re-open: the history row shows the cost we just recorded (assertion
    // 1), and with only ONE batch on record the Cost Batches section stays
    // hidden — proving the ">= 2" gate from the low side before proving it
    // from the high side below.
    await openAdjustModal(appPage);
    await expect(
      appPage.getByText(/\+2 @ \$1200\.00 \(0 → 2\)/),
    ).toBeVisible();
    await expect(
      appPage.getByRole("heading", { name: "Cost Batches" }),
    ).toHaveCount(0);

    // --- Receipt 2, in the SAME re-opened modal: 2 more @ $1,300 (2 -> 4)
    await submitAdjustment(appPage, {
      delta: SECOND_QTY,
      unitCost: SECOND_COST,
      reason: SECOND_REASON,
    });

    // The product-list row itself now flags the split too
    // (ProductRepository's COST_TIERS_SUBQUERY -> `product.cost_tiers > 1`)
    // — a second, cheaper confirmation that two distinct-cost batches are
    // really on record, independent of opening the dialog at all.
    await expect(productRow(appPage).getByText("mixed cost")).toBeVisible();

    // --- Re-open: BOTH history rows, and BOTH batch tiers (assertion 2) --
    await openAdjustModal(appPage);
    await expect(
      appPage.getByRole("heading", { name: "Cost Batches" }),
    ).toBeVisible();
    await expect(appPage.getByText(/2 units @ \$1200\.00/)).toBeVisible();
    await expect(appPage.getByText(/2 units @ \$1300\.00/)).toBeVisible();
    await expect(
      appPage.getByText(/\+2 @ \$1200\.00 \(0 → 2\)/),
    ).toBeVisible();
    await expect(
      appPage.getByText(/\+2 @ \$1300\.00 \(2 → 4\)/),
    ).toBeVisible();

    // --- A plain correction: no cost applies to shrinkage --------------
    await submitAdjustment(appPage, {
      delta: CORRECTION_DELTA,
      reason: CORRECTION_REASON,
    });

    // Assertion 3: the correction's OWN history entry carries the old->new
    // text with NO cost annotation — scoped to just that entry (by its
    // unique reason) so the two priced entries elsewhere in the same list
    // can't make a bare "no $ anywhere on the page" check pass by accident.
    await openAdjustModal(appPage);
    const correctionEntry = historyEntry(appPage, CORRECTION_REASON);
    await expect(correctionEntry).toContainText(/-1 \(4 → 3\)/);
    await expect(correctionEntry).not.toContainText("$");

    // The two priced entries are still exactly as they were — the new
    // cost-free row didn't retroactively touch them.
    await expect(
      appPage.getByText(/\+2 @ \$1200\.00 \(0 → 2\)/),
    ).toBeVisible();
    await expect(
      appPage.getByText(/\+2 @ \$1300\.00 \(2 → 4\)/),
    ).toBeVisible();

    // Leave the UI clean for whatever spec runs next.
    await appPage.getByRole("button", { name: "Cancel" }).click();
    await expect(
      appPage.getByRole("heading", { name: "Adjust Stock" }),
    ).toHaveCount(0);
  });
});
