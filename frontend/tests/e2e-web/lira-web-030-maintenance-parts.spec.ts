/**
 * lira-web-030 — LIRA-176 maintenance parts, over the WEB transport.
 *
 * REST twin of `frontend/tests/e2e-electron/lira-176-maintenance-parts.spec.ts`.
 * Same feature, different transport (rule 19): a maintenance job can attach
 * inventory parts, always priced/costed in USD and never converted (owner
 * decision, "option 4") — an LBP-priced job bills labour in LBP and parts in
 * USD, so its unified transaction carries a non-zero amount in BOTH
 * currencies at once.
 *
 * Why a sibling exists at all: `handleCheckoutComplete`'s `labourFinal`
 * (Maintenance/index.tsx) — the exact formula the desktop spec's item-1
 * jsdom guard exists for — runs in the SAME frontend bundle here, but now
 * every `useApi()` call it triggers must resolve on the HTTP branch of
 * `ipcOrHttp` instead of IPC. A regression to a raw `window.api.*` call
 * anywhere in the maintenance/parts/checkout path would throw before any
 * money moves in a real browser (`window.api` does not exist here) — this
 * file is what would catch that; the desktop spec cannot.
 *
 * Scope choices that keep this file within what has actually been exercised
 * on this transport before:
 *  - No prior web spec drives `CheckoutModal`'s client-search dropdown /
 *    CUSTOMER_ACCOUNT auto-select over HTTP, so this file avoids it: every
 *    checkout here is a plain default-CASH single-line payment, which
 *    `MultiPaymentInput`'s own mount-time auto-fill already covers in full
 *    (no field needs to be typed) — same mechanism the desktop spec's LBP
 *    scenario relies on for its cross-currency fold-in.
 *  - The refund half goes through `POST /api/transactions/:id/refund`
 *    directly, mirroring `lira-web-012-refund-account-debt.spec.ts`'s own
 *    precedent (that file's "reported action" is a Transactions-table
 *    refund click, and it still asserts the reversal over REST) — a real
 *    default-reversal refund (no `refundLegs` override) needs no tender
 *    selection, so this is the same code path a bare-confirm UI click would
 *    reach, without adding an unverified UI dependency on `/audit`'s
 *    `RefundMethodModal`.
 *
 * Rule 15 for this suite: the web DB in `test-results/e2e-web` ACCUMULATES
 * across runs — every product/device name is `Date.now()`-unique, and every
 * row is matched by name/identity or by `source_table`+`source_id`, never by
 * list position.
 *
 * Rule 17 (NOT RUN by this workstream — the owner runs `yarn test:e2e:web`):
 * the failing-first recipes are the same ones named in the desktop spec's
 * header (revert the `labourFinal` currency branch, or drop the `parts` key
 * handling) — this file would fail the `amount_usd`/`amount_lbp`/
 * `profit_usd`/`profit_lbp` assertions exactly the same way.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";
import type { Page } from "@playwright/test";

type Headers = Record<string, string>;

async function adminHeaders(page: Page): Promise<Headers> {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  expect(token).toBeTruthy();
  return { Authorization: `Bearer ${token as string}` };
}

async function createPartProduct(
  page: Page,
  headers: Headers,
  args: { name: string; cost: number; price: number; stock: number },
): Promise<number> {
  const res = await (
    await page.request.post(`${BACKEND_URL}/api/inventory/products`, {
      headers,
      data: {
        name: args.name,
        category: "Parts",
        cost_price_usd: args.cost,
        retail_price_usd: args.price,
        stock: args.stock,
      },
    })
  ).json();
  expect(res.success, JSON.stringify(res)).toBeTruthy();
  const id = (res.id ?? res.data?.id) as number;
  expect(id).toBeTruthy();
  return id;
}

async function getStock(
  page: Page,
  headers: Headers,
  productId: number,
): Promise<number> {
  const res = await (
    await page.request.get(
      `${BACKEND_URL}/api/inventory/products/${productId}`,
      { headers },
    )
  ).json();
  expect(res.success, JSON.stringify(res)).toBeTruthy();
  return res.product.stock_quantity as number;
}

async function findJobByDeviceName(
  page: Page,
  headers: Headers,
  deviceName: string,
): Promise<{ id: number; is_refunded?: number } | null> {
  const res = await (
    await page.request.get(`${BACKEND_URL}/api/maintenance/jobs`, { headers })
  ).json();
  expect(res.success, JSON.stringify(res)).toBeTruthy();
  const jobs = (res.jobs ?? []) as Array<{
    id: number;
    device_name: string;
    is_refunded?: number;
  }>;
  return jobs.find((j) => j.device_name === deviceName) ?? null;
}

async function getTransactionBySource(
  page: Page,
  headers: Headers,
  jobId: number,
): Promise<{
  id: number;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
} | null> {
  const res = await (
    await page.request.get(
      `${BACKEND_URL}/api/transactions/by-source/maintenance/${jobId}`,
      { headers },
    )
  ).json();
  expect(res.success, JSON.stringify(res)).toBeTruthy();
  return res.transaction ?? null;
}

test.describe("LIRA-176 — maintenance parts over REST", () => {
  test("USD job: the real form attaches a part (stock decrements once), checkout charges labour+part and stamps both margins, and REST refund restores the stock", async ({
    page,
  }) => {
    const headers = await adminHeaders(page);
    const ts = Date.now();
    const partName = `W030 Part A ${ts}`;
    const deviceName = `W030 USD Job ${ts}`;

    const productId = await createPartProduct(page, headers, {
      name: partName,
      cost: 20,
      price: 35,
      stock: 10,
    });

    await page.goto("/#/maintenance");
    await expect(page.locator("#root")).not.toContainText(
      "Something went wrong",
    );

    await page.fill("#maintenance-device-name", deviceName);
    await page.fill("#maintenance-issue", "Screen replacement — parts web e2e");
    await page.fill("#maintenance-cost", "10");
    await page.fill("#maintenance-price", "100");

    // ── Attach the part via the REAL PartPicker search — same UI as desktop,
    //    now running the HTTP branch of every api.* call it triggers. ──
    await page.fill('input[placeholder="Search parts..."]', partName);
    const partResult = page.getByText(partName, { exact: true }).first();
    await expect(partResult).toBeVisible({ timeout: 10_000 });
    await partResult.click();
    await expect(page.getByTestId(`part-unit-price-${productId}`)).toHaveValue(
      "35",
    );

    const stockBeforeSave = await getStock(page, headers, productId);

    await page.getByText("Save as Draft", { exact: true }).click();
    await expect(page.locator("#maintenance-device-name")).toHaveValue("", {
      timeout: 10_000,
    });

    const stockAfterDraftSave = await getStock(page, headers, productId);
    expect(stockAfterDraftSave).toBe(stockBeforeSave - 1);

    const draftJob = await findJobByDeviceName(page, headers, deviceName);
    expect(draftJob).not.toBeNull();
    if (!draftJob) return;

    // ── Reopen the draft and check out on a plain default CASH payment ──
    await page
      .locator("button")
      .filter({ hasText: deviceName })
      .first()
      .click();
    await expect(page.locator("#maintenance-price")).toHaveValue("100");

    await page.getByRole("button", { name: /Proceed to Checkout/i }).click();
    const modal = page.locator('[data-testid="checkout-modal"]');
    await expect(modal).toBeVisible({ timeout: 10_000 });

    const completeBtn = page.getByTestId("checkout-complete-btn");
    await expect(completeBtn).toBeEnabled({ timeout: 10_000 });
    await completeBtn.click();
    await expect(modal).toBeHidden({ timeout: 15_000 });

    const txn = await getTransactionBySource(page, headers, draftJob.id);
    expect(txn).not.toBeNull();
    if (!txn) return;

    // Charged total: labour (100) + part price (35) = 135.
    expect(txn.amount_usd).toBeCloseTo(135, 2);
    // Profit: labour margin (100 - 10 = 90) + part margin (35 - 20 = 15) = 105.
    expect(txn.profit_usd).toBeCloseTo(105, 2);

    // Checking out the SAME already-attached part must not draw stock again.
    const stockAfterCheckout = await getStock(page, headers, productId);
    expect(stockAfterCheckout).toBe(stockAfterDraftSave);

    // ── Refund over REST (see file header for why this half isn't UI-driven) ──
    const refunded = await (
      await page.request.post(
        `${BACKEND_URL}/api/transactions/${txn.id}/refund`,
        { headers },
      )
    ).json();
    expect(refunded.success, JSON.stringify(refunded)).toBeTruthy();

    // Stock is restored exactly once — back to the level before the part was
    // ever attached, not doubled by a second restore on top of the draft.
    const stockAfterRefund = await getStock(page, headers, productId);
    expect(stockAfterRefund).toBe(stockBeforeSave);
  });

  test("LBP job with a part: the unified transaction carries a two-currency amount due (labour LBP + part USD)", async ({
    page,
  }) => {
    const headers = await adminHeaders(page);
    const ts = Date.now();
    const partName = `W030 Part B ${ts}`;
    const deviceName = `W030 LBP Job ${ts}`;

    const productId = await createPartProduct(page, headers, {
      name: partName,
      cost: 15,
      price: 25,
      stock: 5,
    });

    await page.goto("/#/maintenance");
    await expect(page.locator("#root")).not.toContainText(
      "Something went wrong",
    );

    await page.getByRole("button", { name: "LBP", exact: true }).click();

    await page.fill("#maintenance-device-name", deviceName);
    await page.fill("#maintenance-issue", "Battery swap — LBP parts web e2e");
    await page.fill("#maintenance-cost", "100000");
    await page.fill("#maintenance-price", "500000");

    await page.fill('input[placeholder="Search parts..."]', partName);
    const partResult = page.getByText(partName, { exact: true }).first();
    await expect(partResult).toBeVisible({ timeout: 10_000 });
    await partResult.click();
    await expect(page.getByTestId(`part-unit-price-${productId}`)).toHaveValue(
      "25",
    );

    // The "Due" row reads "<LBP> + $<USD>" — no conversion, no rate.
    const dueLabel = page.getByText("Due", { exact: true });
    await expect(dueLabel).toBeVisible();
    const dueRow = dueLabel.locator("xpath=..");
    await expect(dueRow).toContainText("500,000 LBP");
    await expect(dueRow).toContainText("$25.00");

    await page.getByRole("button", { name: /Proceed to Checkout/i }).click();
    const modal = page.locator('[data-testid="checkout-modal"]');
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // No client needed: the single-line auto-fill folds the cross-currency
    // (USD parts) remainder into the one LBP line, so a plain default CASH
    // payment already covers both totals.
    const completeBtn = page.getByTestId("checkout-complete-btn");
    await expect(completeBtn).toBeEnabled({ timeout: 10_000 });
    await completeBtn.click();
    await expect(modal).toBeHidden({ timeout: 15_000 });

    const job = await findJobByDeviceName(page, headers, deviceName);
    expect(job).not.toBeNull();
    if (!job) return;

    const txn = await getTransactionBySource(page, headers, job.id);
    expect(txn).not.toBeNull();
    if (!txn) return;

    // Labour rides in LBP, the part rides in USD — BOTH non-zero at once.
    expect(txn.amount_lbp).toBeCloseTo(500000, 0);
    expect(txn.amount_usd).toBeCloseTo(25, 2);
    // Profit: labour margin 500000-100000=400000 LBP; part margin 25-15=10 USD.
    expect(txn.profit_lbp).toBeCloseTo(400000, 0);
    expect(txn.profit_usd).toBeCloseTo(10, 2);

    const stockAfter = await getStock(page, headers, productId);
    expect(stockAfter).toBe(4); // seeded at 5, one unit drawn
  });
});
