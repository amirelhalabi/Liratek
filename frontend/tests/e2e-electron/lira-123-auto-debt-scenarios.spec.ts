/**
 * E2E: LIRA-123 — auto-debt remainder: the full owner-facing scenario matrix.
 *
 * One spec per manual-test scenario from the 2026-07-17 change set (auto
 * CUSTOMER_ACCOUNT remainder + opt-in gating + FinancialForm legs-carrier +
 * POS receipt split). Companion to:
 *   - lira-122-auto-debt-split.spec.ts  (the original incident, full books)
 *   - MultiPaymentInput.test.tsx        (component contract, failing-first)
 *   - FinancialForm.legsCarrier.test.tsx (carrier payload, failing-first)
 *
 * Scenario → test map (numbers from the owner briefing):
 *   1+2  auto-split appears / folds back when total is covered   → S1
 *   3    manual edit detaches the debt leg (survives full cover) → S2
 *   4    dismissing the auto leg; re-arms on a fresh cash edit   → S3
 *   5    no client → Remaining (Debt) warning only               → S4
 *   7    RECEIVE (cashout) never auto-splits                     → S5
 *   6    Settings toggle off → no auto-split anywhere            → S6
 *   10+1 Whish Bills catalog ×2 units, auto-split books ONCE     → S7
 *   8    POS checkout auto-split + correct debt/drawer deltas    → S8
 *   13   Debt repayment modal never auto-splits                  → S9
 *   9    POS clientless block — already guarded by CheckoutModal.spec S55
 *   11   currency-follow — guarded at component level (jest)
 *   12   session checkout — no autoDebtRemainder prop (structural off);
 *        lira-109 suite guards its payment behavior unchanged
 *
 * Assertion discipline: deltas + identity (rule 15) — every money check
 * snapshots before/after and matches rows by unique client names.
 */

import { test, expect, navigateTo, seedClient, seedProduct } from "./fixtures";
import { closeAllActiveSessions, goToPOSCheckout } from "./helpers/nav";
import { CheckoutModalPO } from "./page-objects/components/CheckoutModal.po";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

// ─── IPC surface used by this spec ───────────────────────────────────────────

type DrawerBalance = { name: string; usdBalance: number; lbpBalance: number };
type DebtorRow = {
  full_name: string;
  total_debt_usd: number;
  total_debt_lbp: number;
};
type PaymentMethodRow = { id: number; code: string; is_active: number };

type Api = {
  api: {
    recharge: {
      getDrawerBalances: () => Promise<DrawerBalance[]>;
      process: (data: {
        provider: string;
        type: string;
        amount: number;
        cost: number;
        price: number;
        paid_by_method?: string;
        clientId?: number;
        currency?: string;
      }) => Promise<{ success: boolean; error?: string }>;
    };
    debt: { getDebtors: () => Promise<DebtorRow[]> };
    clients: {
      create: (data: {
        full_name: string;
        phone_number: string;
        whatsapp_opt_in: number;
      }) => Promise<{ success: boolean; id?: number; error?: string }>;
    };
    paymentMethods: {
      list: () => Promise<PaymentMethodRow[]>;
      listActive: () => Promise<PaymentMethodRow[]>;
      update: (
        id: number,
        data: { is_active?: number },
      ) => Promise<{ success: boolean; error?: string }>;
    };
    mobileServiceItems: {
      create: (data: {
        provider: string;
        category: string;
        subcategory: string;
        label: string;
        cost_lbp: number;
        sell_lbp: number;
        sort_order: number;
      }) => Promise<{ success: boolean; error?: string }>;
    };
  };
};

// ─── Shared helpers ──────────────────────────────────────────────────────────

async function drawers(page: Page) {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const all = await w.api.recharge.getDrawerBalances();
    const get = (name: string) => all.find((d) => d.name === name);
    return {
      generalUsd: get("General")?.usdBalance ?? 0,
      generalLbp: get("General")?.lbpBalance ?? 0,
    };
  });
}

async function debtOf(page: Page, name: string) {
  return page.evaluate(async (n) => {
    const w = window as unknown as Api;
    const row = (await w.api.debt.getDebtors()).find((d) => d.full_name === n);
    return { usd: row?.total_debt_usd ?? 0, lbp: row?.total_debt_lbp ?? 0 };
  }, name);
}

/** Open Recharge → Whish App and force the given sub-tab. Bounces through
 *  "/" first so a sheet/client left open by the previous test unmounts —
 *  the appPage is reused across tests in this file. */
async function whishTab(page: Page, sub: "Transfer" | "Bills") {
  await navigateTo(page, "/");
  await navigateTo(page, "/recharge");
  const tab = page
    .locator("button")
    .filter({ hasText: /^Whish App$/ })
    .first();
  await expect(tab).toBeVisible({ timeout: 8_000 });
  await tab.click();
  const subTab = page
    .locator("button")
    .filter({ hasText: new RegExp(`^${sub}$`) })
    .first();
  await expect(subTab).toBeVisible({ timeout: 10_000 });
  await subTab.click();
}

/** Fill the Whish SEND transfer form and open the payment sheet with the
 *  first leg forced to CASH. Returns the sheet's MultiPaymentInput root. */
async function openWhishSendSheet(
  page: Page,
  opts: { amount: string; name?: string; phone?: string },
) {
  await whishTab(page, "Transfer");
  await expect(page.locator("#transfer-amount")).toBeVisible({
    timeout: 5_000,
  });
  await page.locator("#transfer-amount").fill(opts.amount);
  if (opts.name) {
    await page.locator("#sender-name").fill(opts.name);
    await page.keyboard.press("Escape"); // dismiss autocomplete dropdown
  }
  if (opts.phone) {
    await page.locator("#sender-phone").fill(opts.phone);
  }
  await page.getByRole("button", { name: /Proceed to Pay/i }).click();

  const sheet = page.locator('[data-testid="multi-payment-input"]').last();
  const methodSelect = sheet
    .locator('[data-testid^="payment-method-"]')
    .first();
  await expect(methodSelect).toBeVisible({ timeout: 5_000 });
  await methodSelect.selectOption("CASH");
  return sheet;
}

const amounts = (sheet: ReturnType<Page["locator"]>) =>
  sheet.locator('[data-testid^="payment-amount-"]');
const methods = (sheet: ReturnType<Page["locator"]>) =>
  sheet.locator('[data-testid^="payment-method-"]');

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe("LIRA-123 — auto-debt remainder scenarios", () => {
  test.beforeEach(async ({ appPage }) => {
    await closeAllActiveSessions(appPage).catch(() => {});
  });

  test("S1 (scenarios 1+2): underpay auto-splits; covering the total folds back to single mode", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const sheet = await openWhishSendSheet(appPage, {
      amount: "140",
      name: `L123 S1 ${ts}`,
      phone: `81${String(ts).slice(-6)}`,
    });

    await expect(amounts(sheet).first()).toHaveValue("140");
    await amounts(sheet).first().fill("100");

    // Auto-split: second CUSTOMER_ACCOUNT line for the $40 shortfall.
    await expect(amounts(sheet)).toHaveCount(2, { timeout: 4_000 });
    await expect(methods(sheet).nth(1)).toHaveValue("CUSTOMER_ACCOUNT");
    await expect(amounts(sheet).nth(1)).toHaveValue("40");
    await expect(sheet.getByTestId("split-toggle")).toContainText(
      "Split Active",
    );

    // Cover the total — the auto leg withdraws and the sheet folds back.
    await amounts(sheet).first().fill("140");
    await expect(amounts(sheet)).toHaveCount(1, { timeout: 4_000 });
    await expect(sheet.getByTestId("split-toggle")).not.toContainText(
      "Split Active",
    );
  });

  test("S2 (scenario 3): manually editing the debt leg detaches it — it survives the cash covering the total", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const sheet = await openWhishSendSheet(appPage, {
      amount: "140",
      name: `L123 S2 ${ts}`,
      phone: `81${String(ts + 1).slice(-6)}`,
    });

    await amounts(sheet).first().fill("100");
    await expect(amounts(sheet)).toHaveCount(2, { timeout: 4_000 });

    // Operator takes ownership: 40 → 30.
    await amounts(sheet).nth(1).fill("30");

    // Cash edits no longer resize it…
    await amounts(sheet).first().fill("120");
    await expect(amounts(sheet).nth(1)).toHaveValue("30");

    // …and covering the full total no longer deletes it (review finding).
    await amounts(sheet).first().fill("140");
    await expect(amounts(sheet)).toHaveCount(2);
    await expect(amounts(sheet).nth(1)).toHaveValue("30");
  });

  test("S3 (scenario 4): removing the auto leg dismisses it; a fresh cash edit re-arms it", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const sheet = await openWhishSendSheet(appPage, {
      amount: "140",
      name: `L123 S3 ${ts}`,
      phone: `81${String(ts + 2).slice(-6)}`,
    });

    await amounts(sheet).first().fill("100");
    await expect(amounts(sheet)).toHaveCount(2, { timeout: 4_000 });

    // Remove the auto leg — it must stay gone (no phantom resurrection).
    const secondLine = sheet.locator('[data-testid^="payment-line-"]').nth(1);
    await secondLine.getByTitle("Remove").click();
    await expect(amounts(sheet)).toHaveCount(1);
    await appPage.waitForTimeout(800); // well past the reveal window
    await expect(amounts(sheet)).toHaveCount(1);

    // A fresh cash edit re-arms auto-split.
    await amounts(sheet).first().fill("90");
    await expect(amounts(sheet)).toHaveCount(2, { timeout: 4_000 });
    await expect(amounts(sheet).nth(1)).toHaveValue("50");
  });

  test("S4 (scenario 5): no client → Remaining (Debt) warning only, never splits", async ({
    appPage,
  }) => {
    const sheet = await openWhishSendSheet(appPage, { amount: "140" });

    await amounts(sheet).first().fill("100");
    await appPage.waitForTimeout(800);

    await expect(amounts(sheet)).toHaveCount(1);
    await expect(
      sheet.getByTestId("payment-summary").getByText(/Remaining \(Debt\)/i),
    ).toBeVisible();
  });

  test("S5 (scenario 7): RECEIVE (cashout) never auto-splits even with a client", async ({
    appPage,
  }) => {
    const ts = Date.now();
    await whishTab(appPage, "Transfer");
    await appPage
      .locator("button")
      .filter({ hasText: /^Receive$/ })
      .first()
      .click();
    await expect(appPage.locator("#receiver-name")).toBeVisible({
      timeout: 5_000,
    });
    await appPage.locator("#transfer-amount").fill("140");
    await appPage.locator("#receiver-name").fill(`L123 S5 ${ts}`);
    await appPage.keyboard.press("Escape");
    await appPage
      .locator("#receiver-phone")
      .fill(`81${String(ts + 3).slice(-6)}`);
    await appPage.getByRole("button", { name: /Proceed to Pay/i }).click();

    const sheet = appPage.locator('[data-testid="multi-payment-input"]').last();
    const methodSelect = sheet
      .locator('[data-testid^="payment-method-"]')
      .first();
    await expect(methodSelect).toBeVisible({ timeout: 5_000 });
    await methodSelect.selectOption("CASH");

    await amounts(sheet).first().fill("100");
    await appPage.waitForTimeout(800);

    // Money-OUT flow: an auto IN-direction debt leg would invert the sign of
    // the unpaid remainder — it must never appear here.
    await expect(amounts(sheet)).toHaveCount(1);
  });

  test("S6 (scenario 6): CUSTOMER_ACCOUNT disabled in Settings → no auto-split even with a client", async ({
    appPage,
  }) => {
    const toggled = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      const pm = (await w.api.paymentMethods.list()).find(
        (m) => m.code === "CUSTOMER_ACCOUNT",
      );
      if (!pm)
        return { id: -1, ok: false, error: "CUSTOMER_ACCOUNT not found" };
      const res = await w.api.paymentMethods.update(pm.id, { is_active: 0 });
      const stillActive = (await w.api.paymentMethods.listActive()).some(
        (m) => m.code === "CUSTOMER_ACCOUNT",
      );
      return {
        id: pm.id,
        ok: res.success === true && !stillActive,
        error: res.error ?? (stillActive ? "still listed active" : ""),
      };
    });
    expect(toggled.ok, `toggle failed: ${toggled.error}`).toBe(true);
    const pmId = toggled.id;

    try {
      // The methods list is fetched by hooks on mount — reload the renderer
      // so no already-mounted hook serves the stale (CA-active) list.
      await appPage.reload();

      const ts = Date.now();
      const sheet = await openWhishSendSheet(appPage, {
        amount: "140",
        name: `L123 S6 ${ts}`,
        phone: `81${String(ts + 4).slice(-6)}`,
      });

      // Sanity gate: the deactivated method must be gone from the dropdown.
      await expect(
        methods(sheet).first().locator('option[value="CUSTOMER_ACCOUNT"]'),
      ).toHaveCount(0);

      await amounts(sheet).first().fill("100");
      await appPage.waitForTimeout(800);

      await expect(amounts(sheet)).toHaveCount(1);
    } finally {
      // ALWAYS restore — the accumulating suite DB is shared by every spec.
      await appPage.evaluate(async (id) => {
        const w = window as unknown as Api;
        await w.api.paymentMethods.update(id, { is_active: 1 });
      }, pmId);
    }
  });

  test("S7 (scenarios 10+1): Whish Bills catalog ×2 units — auto-split legs book ONCE (carrier), debt = shortfall only", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const CLIENT = `L123 S7 ${ts}`;
    const PHONE = `81${String(ts + 5).slice(-6)}`;
    const LABEL = `L123 DSL ${ts}`;

    // Seed a WHISH_APP catalog item: sell 300,000 / cost 250,000 LBP.
    const seeded = await appPage.evaluate(async (label) => {
      const w = window as unknown as Api;
      return w.api.mobileServiceItems.create({
        provider: "WHISH_APP",
        category: "bills-e2e",
        subcategory: "DSL",
        label,
        cost_lbp: 250_000,
        sell_lbp: 300_000,
        sort_order: 0,
      });
    }, LABEL);
    expect(seeded.success, seeded.error ?? "item seed failed").toBe(true);

    // Catalog items live in an app-level context fetched once at app mount —
    // reload so the just-seeded item is in the list the Bills grid renders.
    await appPage.reload();

    await whishTab(appPage, "Bills");

    // Add the item twice → quantity 2 (600,000 LBP total).
    const card = appPage.locator(`text=${LABEL}`).first();
    await expect(card).toBeVisible({ timeout: 8_000 });
    await card.click(); // qty 1
    await appPage.getByRole("button", { name: "+" }).first().click(); // qty 2

    await appPage.getByRole("button", { name: /Proceed to Pay/i }).click();

    // Client (auto-promotes the method) → back to CASH → underpay 500,000.
    await appPage.getByPlaceholder(/Client name \(optional\)/i).fill(CLIENT);
    await appPage.keyboard.press("Escape");
    await appPage.getByPlaceholder(/Phone number/i).fill(PHONE);

    const sheet = appPage.locator('[data-testid="multi-payment-input"]').last();
    const methodSelect = sheet
      .locator('[data-testid^="payment-method-"]')
      .first();
    await expect(methodSelect).toBeVisible({ timeout: 5_000 });
    await methodSelect.selectOption("CASH");
    await expect(amounts(sheet).first()).toHaveValue("600,000");
    await amounts(sheet).first().fill("500000");

    await expect(amounts(sheet)).toHaveCount(2, { timeout: 4_000 });
    await expect(methods(sheet).nth(1)).toHaveValue("CUSTOMER_ACCOUNT");
    await expect(amounts(sheet).nth(1)).toHaveValue("100,000");

    const before = await drawers(appPage);
    const payBtn = appPage
      .locator("button")
      .filter({ hasText: /^Pay / })
      .last();
    await payBtn.click();
    await expect(payBtn).toBeHidden({ timeout: 10_000 });

    const after = await drawers(appPage);
    const debt = await debtOf(appPage, CLIENT);

    // Carrier convention: the split books EXACTLY once across the two unit
    // transactions — pre-fix this read +1,000,000 cash and 200,000 debt.
    expect(after.generalLbp - before.generalLbp).toBeCloseTo(500_000, 0);
    expect(debt.lbp).toBeCloseTo(100_000, 0);
    expect(debt.usd).toBeCloseTo(0, 2);
  });

  test("S8 (scenario 8): POS checkout auto-splits and books tender + debt correctly", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const clientName = `L123 S8 ${ts}`;
    await seedClient(appPage, {
      name: clientName,
      phone: `81${String(ts + 6).slice(-6)}`,
    });
    const productId = await seedProduct(appPage, {
      name: `L123 Prod ${ts}`,
      cost_price: 3,
      sell_price: 10,
      quantity: 5,
    });

    await navigateTo(appPage, "/"); // clean slate — appPage is reused
    await goToPOSCheckout(appPage, productId);
    const checkoutPO = new CheckoutModalPO(appPage);
    await checkoutPO.expectOpen();
    const modal = appPage.locator('[data-testid="checkout-modal"]');

    // Pick the client (payment auto-switches to CUSTOMER_ACCOUNT) → CASH.
    const clientSearch = modal
      .locator(
        'input[placeholder*="client" i], [data-testid="client-autocomplete-field"]',
      )
      .first();
    await clientSearch.fill(clientName);
    await expect(
      appPage.locator('[data-testid="client-dropdown"]'),
    ).toBeVisible({ timeout: 5_000 });
    // Exact-name option — accumulated same-prefix clients from earlier runs
    // make a bare .first() nondeterministic (rule 15: identity, not position).
    await appPage
      .locator('[data-testid^="client-option-"]')
      .filter({ hasText: clientName })
      .first()
      .click();

    const methodSelect = modal
      .locator('[data-testid^="payment-method-"]')
      .first();
    await expect(methodSelect).toHaveValue("CUSTOMER_ACCOUNT", {
      timeout: 5_000,
    });
    await methodSelect.selectOption("CASH");

    // Underpay $7 of $10 → auto CUSTOMER_ACCOUNT $3.
    await modal.locator('[data-testid^="payment-amount-"]').first().fill("7");
    await expect(modal.locator('[data-testid^="payment-amount-"]')).toHaveCount(
      2,
      { timeout: 4_000 },
    );
    await expect(
      modal.locator('[data-testid^="payment-method-"]').nth(1),
    ).toHaveValue("CUSTOMER_ACCOUNT");
    await expect(
      modal.locator('[data-testid^="payment-amount-"]').nth(1),
    ).toHaveValue("3");

    const before = await drawers(appPage);
    await checkoutPO.complete();
    await checkoutPO.expectClosed();

    const after = await drawers(appPage);
    const debt = await debtOf(appPage, clientName);

    expect(after.generalUsd - before.generalUsd).toBeCloseTo(7, 2);
    expect(debt.usd).toBeCloseTo(3, 2);
  });

  test("S9 (scenario 13): the debt REPAYMENT modal never auto-splits a partial repayment", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const CLIENT = `L123 S9 ${ts}`;

    // Seed a 600,000 LBP debt via IPC (account-charged MTC recharge —
    // the lira-104 pattern).
    const seeded = await appPage.evaluate(
      async (args: { name: string; phone: string }) => {
        const w = window as unknown as Api;
        const client = await w.api.clients.create({
          full_name: args.name,
          phone_number: args.phone,
          whatsapp_opt_in: 0,
        });
        if (!client.success || !client.id) {
          return { ok: false, error: client.error ?? "client create failed" };
        }
        const r = await w.api.recharge.process({
          provider: "MTC",
          type: "CREDIT_TRANSFER",
          amount: 6,
          cost: 500_000,
          price: 600_000,
          paid_by_method: "CUSTOMER_ACCOUNT",
          clientId: client.id,
          currency: "LBP",
        });
        return { ok: r.success, error: r.error };
      },
      { name: CLIENT, phone: `81${String(ts + 7).slice(-6)}` },
    );
    expect(seeded.ok, seeded.error ?? "debt seed failed").toBe(true);

    await navigateTo(appPage, "/debts");
    await appPage.waitForLoadState("networkidle", { timeout: 10_000 });
    const clientRow = appPage
      .locator("button")
      .filter({ hasText: CLIENT })
      .first();
    await expect(clientRow).toBeVisible({ timeout: 10_000 });
    await clientRow.click();

    const settleBtn = appPage.getByRole("button", { name: /Settle Debt/i });
    await expect(settleBtn).toBeVisible({ timeout: 10_000 });
    await settleBtn.click();

    // Repay modal opens pre-filled with the full 600,000 — underpay it.
    const amount = appPage.locator('[data-testid^="payment-amount-"]').first();
    await expect(amount).not.toHaveValue("", { timeout: 5_000 });
    await amount.fill("400000");
    await appPage.waitForTimeout(800);

    // A partial repayment is the NORMAL case here — the remainder stays as
    // the client's existing debt; no auto CUSTOMER_ACCOUNT leg may appear.
    await expect(
      appPage.locator('[data-testid^="payment-amount-"]'),
    ).toHaveCount(1);

    await appPage.keyboard.press("Escape"); // close without confirming
  });
});
