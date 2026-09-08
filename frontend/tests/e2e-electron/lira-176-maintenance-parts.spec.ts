/**
 * E2E: LIRA-176 phase 8b — maintenance parts (desktop/IPC half).
 *
 * A maintenance job can attach inventory parts. Parts are ALWAYS USD and
 * NEVER converted (owner decision, "option 4"): an LBP-priced job bills
 * labour in LBP and parts in USD, and both currency sides of its unified
 * transaction are non-zero at once.
 *
 * Drives the REAL `/maintenance` form — device/issue/cost/price fields, the
 * real `PartPicker` search+add UI, the real "Save as Draft"/"Proceed to
 * Checkout" buttons, and the real `CheckoutModal` — never a hand-built IPC
 * payload. This feature does currency arithmetic in the FRONTEND
 * (`handleCheckoutComplete`'s `labourFinal`, Maintenance/index.tsx), which a
 * payload-level spec cannot exercise at all (see the jsdom guards in
 * `Maintenance.checkoutPartsPayload.test.tsx` for the pure-function proof;
 * this file is the seam those tests cannot reach — real DOM, real
 * MultiPaymentInput auto-fill, real backend round-trip).
 *
 * Rule 15 (shared accumulating DB, delta + identity, never position):
 * every product/client/job name below is `Date.now()`-unique; rows are
 * matched by device/product name substring or by `source_table`+`source_id`,
 * never by list position or "newest row".
 *
 * The USD scenario pays via CUSTOMER_ACCOUNT specifically so the /audit
 * refund click falls into the bare `confirm()` path rather than the
 * tender-selection `RefundMethodModal` (a CUSTOMER_ACCOUNT settlement never
 * writes a `payments` table row — no customer-facing drawer legs to choose
 * a return method for) — same reasoning lira-130 documents for its own
 * refund-unlock spec.
 */

import { test, expect, navigateTo, seedClient } from "./fixtures";

test.describe.configure({ retries: 0 });

type MaintenanceJobRow = {
  id: number;
  device_name: string;
  is_refunded?: number;
  parts?: Array<{ id: number; product_id: number; quantity: number }>;
};

type Api = {
  api: {
    maintenance: {
      getJobs: (filter?: string) => Promise<MaintenanceJobRow[]>;
    };
    inventory: {
      createProduct: (product: {
        name: string;
        category: string;
        cost_price: number;
        retail_price: number;
        stock_quantity?: number;
        barcode?: string;
        min_stock_level?: number;
      }) => Promise<{ success: boolean; id?: number; error?: string }>;
      getProduct: (
        id: number,
      ) => Promise<{ id: number; stock_quantity: number } | null>;
    };
    transactions: {
      getBySource: (
        sourceTable: string,
        sourceId: number,
      ) => Promise<{
        id: number;
        amount_usd: number;
        amount_lbp: number;
        profit_usd: number;
        profit_lbp: number;
      } | null>;
    };
  };
};

async function createPartProduct(
  appPage: import("@playwright/test").Page,
  args: { name: string; cost: number; price: number; stock: number },
): Promise<number> {
  const result = await appPage.evaluate(async (a) => {
    const w = window as unknown as Api;
    return w.api.inventory.createProduct({
      name: a.name,
      category: "Parts",
      cost_price: a.cost,
      retail_price: a.price,
      stock_quantity: a.stock,
      barcode: "",
    });
  }, args);
  if (!result.success || result.id == null) {
    throw new Error(`createPartProduct failed: ${result.error ?? "no id"}`);
  }
  return result.id;
}

async function getStock(
  appPage: import("@playwright/test").Page,
  productId: number,
): Promise<number> {
  return appPage.evaluate(async (id) => {
    const w = window as unknown as Api;
    const p = await w.api.inventory.getProduct(id);
    return p?.stock_quantity ?? -1;
  }, productId);
}

async function findJobByDeviceName(
  appPage: import("@playwright/test").Page,
  deviceName: string,
): Promise<MaintenanceJobRow | null> {
  return appPage.evaluate(async (name) => {
    const w = window as unknown as Api;
    const jobs = await w.api.maintenance.getJobs();
    return jobs.find((j) => j.device_name === name) ?? null;
  }, deviceName);
}

test.describe("LIRA-176 — maintenance parts", () => {
  test("USD job: attaching a part decrements stock once, the charged total and profit stamp include the part, and refund restores stock exactly once", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const partName = `L176 Part A ${ts}`;
    const deviceName = `L176 USD Job ${ts}`;
    const clientName = `L176 Client ${ts}`;
    const phone = `77${String(ts).slice(-6)}`;

    // Cost 20 / price 35 so the part's own margin (15) is distinguishable
    // from the labour margin (90) in the profit assertion below.
    const productId = await createPartProduct(appPage, {
      name: partName,
      cost: 20,
      price: 35,
      stock: 10,
    });
    await seedClient(appPage, { name: clientName, phone });

    await navigateTo(appPage, "/maintenance");

    await appPage.fill("#maintenance-device-name", deviceName);
    await appPage.fill("#maintenance-issue", "Screen replacement — parts e2e");
    await appPage.fill("#maintenance-cost", "10");
    await appPage.fill("#maintenance-price", "100");

    // ── Attach the part via the REAL PartPicker search ──
    await appPage.fill('input[placeholder="Search parts..."]', partName);
    const partResult = appPage.getByText(partName, { exact: true }).first();
    await expect(partResult).toBeVisible({ timeout: 10_000 });
    await partResult.click();
    // The line is now in the parts editor (search box cleared, dropdown
    // gone) — confirm the price pre-filled from the product's own price.
    await expect(
      appPage.getByTestId(`part-unit-price-${productId}`),
    ).toHaveValue("35");

    const stockBeforeSave = await getStock(appPage, productId);

    // ── Save as Draft — proves the part draws stock even off the paid path ──
    await appPage.getByText("Save as Draft", { exact: true }).click();
    await expect(appPage.locator("#maintenance-device-name")).toHaveValue("", {
      timeout: 10_000,
    });

    const stockAfterDraftSave = await getStock(appPage, productId);
    expect(stockAfterDraftSave).toBe(stockBeforeSave - 1);

    const draftJob = await findJobByDeviceName(appPage, deviceName);
    expect(draftJob).not.toBeNull();
    if (!draftJob) return;

    // ── Reopen the draft and check out on the client's account ──
    await appPage
      .locator("button")
      .filter({ hasText: deviceName })
      .first()
      .click();
    await expect(appPage.locator("#maintenance-price")).toHaveValue("100");

    await appPage.getByRole("button", { name: /Proceed to Checkout/i }).click();
    const modal = appPage.locator('[data-testid="checkout-modal"]');
    await expect(modal).toBeVisible({ timeout: 10_000 });

    const clientField = modal.locator(
      '[data-testid="client-autocomplete-field"]',
    );
    await clientField.fill(clientName);
    await expect(modal.locator('[data-testid="client-dropdown"]')).toBeVisible(
      { timeout: 5000 },
    );
    await modal.locator('[data-testid^="client-option-"]').first().click();

    // CheckoutModal auto-selects CUSTOMER_ACCOUNT once a chargeable client
    // is set — wait for the commit before completing (avoids racing the
    // async auto-switch effect, same pattern app.spec.ts's Debts test uses).
    await expect(
      modal.locator('[data-testid^="payment-method-"]').first(),
    ).toHaveValue("CUSTOMER_ACCOUNT", { timeout: 5000 });

    const completeBtn = appPage.getByTestId("checkout-complete-btn");
    await expect(completeBtn).toBeEnabled({ timeout: 5000 });
    await completeBtn.click();
    await expect(modal).toBeHidden({ timeout: 15_000 });

    const txn = await appPage.evaluate(
      async (jobId) => {
        const w = window as unknown as Api;
        return w.api.transactions.getBySource("maintenance", jobId);
      },
      draftJob.id,
    );
    expect(txn).not.toBeNull();
    if (!txn) return;

    // Charged total: labour (100) + part price (35) = 135.
    expect(txn.amount_usd).toBeCloseTo(135, 2);
    // Profit: labour margin (100 - 10 = 90) + part margin (35 - 20 = 15) = 105.
    expect(txn.profit_usd).toBeCloseTo(105, 2);

    // Checking out the SAME already-attached part must not draw stock again.
    const stockAfterCheckout = await getStock(appPage, productId);
    expect(stockAfterCheckout).toBe(stockAfterDraftSave);

    // ── Refund from /audit (real button, bare confirm() path) ──
    await navigateTo(appPage, "/audit");
    const row = appPage.locator("tbody tr").filter({ hasText: deviceName }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    const refundBtn = row.getByRole("button", { name: /^Refund$/ });
    await expect(refundBtn).toBeVisible();

    const confirmSeen = new Promise<string>((resolve) => {
      appPage.once("dialog", (d) => {
        d.accept().catch(() => {});
        resolve(d.message());
      });
    });
    await refundBtn.click();
    expect(await confirmSeen).toMatch(/Refund this transaction/i);

    await expect
      .poll(
        async () => {
          const job = await findJobByDeviceName(appPage, deviceName);
          return job?.is_refunded ?? 0;
        },
        { timeout: 10_000 },
      )
      .toBe(1);

    // Stock is restored exactly once — back to the level before the part was
    // ever attached, not doubled by a second restore on top of the draft.
    const stockAfterRefund = await getStock(appPage, productId);
    expect(stockAfterRefund).toBe(stockBeforeSave);
  });

  test("LBP job with a part: the unified transaction carries a two-currency amount due (labour LBP + part USD)", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const partName = `L176 Part B ${ts}`;
    const deviceName = `L176 LBP Job ${ts}`;

    const productId = await createPartProduct(appPage, {
      name: partName,
      cost: 15,
      price: 25,
      stock: 5,
    });

    // Fresh mount (README convention) so this test never inherits form state
    // left by the previous one.
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/maintenance");

    await appPage.getByRole("button", { name: "LBP", exact: true }).click();

    await appPage.fill("#maintenance-device-name", deviceName);
    await appPage.fill("#maintenance-issue", "Battery swap — LBP parts e2e");
    await appPage.fill("#maintenance-cost", "100000");
    await appPage.fill("#maintenance-price", "500000");

    await appPage.fill('input[placeholder="Search parts..."]', partName);
    const partResult = appPage.getByText(partName, { exact: true }).first();
    await expect(partResult).toBeVisible({ timeout: 10_000 });
    await partResult.click();
    await expect(
      appPage.getByTestId(`part-unit-price-${productId}`),
    ).toHaveValue("25");

    // The "Due" row in the totals block reads "<LBP> + $<USD>" — no
    // conversion, no rate — proving the two-currency total surfaces in the
    // UI before checkout is ever opened.
    const dueLabel = appPage.getByText("Due", { exact: true });
    await expect(dueLabel).toBeVisible();
    const dueRow = dueLabel.locator("xpath=..");
    await expect(dueRow).toContainText("500,000 LBP");
    await expect(dueRow).toContainText("$25.00");

    await appPage.getByRole("button", { name: /Proceed to Checkout/i }).click();
    const modal = appPage.locator('[data-testid="checkout-modal"]');
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // No client needed: MultiPaymentInput's single-line auto-fill folds the
    // cross-currency (USD parts) remainder into the one LBP line, so a plain
    // CASH payment already covers both totals.
    const completeBtn = appPage.getByTestId("checkout-complete-btn");
    await expect(completeBtn).toBeEnabled({ timeout: 5000 });
    await completeBtn.click();
    await expect(modal).toBeHidden({ timeout: 15_000 });

    const job = await findJobByDeviceName(appPage, deviceName);
    expect(job).not.toBeNull();
    if (!job) return;

    const txn = await appPage.evaluate(
      async (jobId) => {
        const w = window as unknown as Api;
        return w.api.transactions.getBySource("maintenance", jobId);
      },
      job.id,
    );
    expect(txn).not.toBeNull();
    if (!txn) return;

    // Labour rides in LBP, the part rides in USD — BOTH non-zero at once.
    expect(txn.amount_lbp).toBeCloseTo(500000, 0);
    expect(txn.amount_usd).toBeCloseTo(25, 2);
    // Profit: labour margin 500000-100000=400000 LBP; part margin 25-15=10 USD.
    expect(txn.profit_lbp).toBeCloseTo(400000, 0);
    expect(txn.profit_usd).toBeCloseTo(10, 2);

    const stockAfter = await getStock(appPage, productId);
    expect(stockAfter).toBe(4); // seeded at 5, one unit drawn
  });
});
