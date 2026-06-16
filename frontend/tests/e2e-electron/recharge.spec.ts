/**
 * E2E: Recharge — MTC/Alfa CREDIT_TRANSFER with SMS cost deduction
 *
 * Verifies that after submitting a CREDIT_TRANSFER:
 *   - The MTC/Alfa drawer balance decreases by amount + smsCostUsd
 *   - smsCostUsd = ceil(amount / 3) × $0.16
 *
 * The page starts with MTC + CREDIT_TRANSFER selected by default.
 * Tests use a fresh shared Electron instance (same as app.spec.ts).
 */

import { test, expect, navigateTo } from "./fixtures";

test.describe.configure({ retries: 0 });

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns the current USD balance of the named drawer via IPC. */
async function getMtcUsdBalance(appPage: import("@playwright/test").Page): Promise<number> {
  const balances = await appPage.evaluate(() =>
    (window as any).api.recharge.getDrawerBalances() as Promise<
      Array<{ name: string; usdBalance: number }>
    >,
  );
  return balances.find((b) => b.name === "MTC")?.usdBalance ?? 0;
}

async function getAlfaUsdBalance(appPage: import("@playwright/test").Page): Promise<number> {
  const balances = await appPage.evaluate(() =>
    (window as any).api.recharge.getDrawerBalances() as Promise<
      Array<{ name: string; usdBalance: number }>
    >,
  );
  return balances.find((b) => b.name === "Alfa")?.usdBalance ?? 0;
}

/** Submit a CREDIT_TRANSFER on the open Recharge page and confirm payment. */
async function submitCreditTransfer(
  appPage: import("@playwright/test").Page,
  phone: string,
  amountUsd: string,
) {
  const phoneInput = appPage.locator("#telecom-phone");
  await expect(phoneInput).toBeVisible({ timeout: 8_000 });
  await phoneInput.fill(phone);

  const amountInput = appPage.locator("#telecom-amount");
  await expect(amountInput).toBeVisible({ timeout: 5_000 });
  await amountInput.fill(amountUsd);

  // Proceed to Pay opens the PaymentSheet
  const proceedBtn = appPage.getByRole("button", { name: /Proceed to Pay/i });
  await expect(proceedBtn).toBeEnabled({ timeout: 5_000 });
  await proceedBtn.click();

  // Confirm inside the PaymentSheet — label is "Pay X LBP"
  const confirmBtn = appPage
    .locator("button")
    .filter({ hasText: /^Pay / })
    .last();
  await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
  await confirmBtn.click();

  // The PaymentSheet closes as soon as the IPC call commits — the DB is already
  // updated at this point, so getMtcUsdBalance() right after will see the new
  // balance without waiting for the full query-refetch / form-reset cycle.
  await expect(confirmBtn).toBeHidden({ timeout: 8_000 });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe("Recharge — CREDIT_TRANSFER SMS cost deduction", () => {
  test("MTC $3 transfer: drawer decremented by $3.16 (credits + 1 SMS × $0.16)", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/recharge");

    // MTC is the default provider; CREDIT_TRANSFER is the default type.
    // Click MTC tab to be explicit in case a previous test left a different provider.
    const mtcTab = appPage.locator("button").filter({ hasText: /^MTC$/ }).first();
    await expect(mtcTab).toBeVisible({ timeout: 8_000 });
    await mtcTab.click();

    const before = await getMtcUsdBalance(appPage);

    await submitCreditTransfer(appPage, "03111222", "3");

    const after = await getMtcUsdBalance(appPage);
    const delta = before - after;

    // 1 SMS (ceil(3/3)=1) × $0.16 = $0.16 → total deduction = $3.16
    expect(delta).toBeCloseTo(3.16, 1);
  });

  test("MTC $6 transfer: drawer decremented by $6.32 (credits + 2 SMSes × $0.16)", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/recharge");

    const mtcTab = appPage.locator("button").filter({ hasText: /^MTC$/ }).first();
    await expect(mtcTab).toBeVisible({ timeout: 8_000 });
    await mtcTab.click();

    const before = await getMtcUsdBalance(appPage);

    await submitCreditTransfer(appPage, "03111333", "6");

    const after = await getMtcUsdBalance(appPage);
    const delta = before - after;

    // 2 SMSes (ceil(6/3)=2) × $0.16 = $0.32 → total deduction = $6.32
    expect(delta).toBeCloseTo(6.32, 1);
  });

  test("Alfa $3 transfer: Alfa drawer decremented by $3.16", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/recharge");

    // Switch to Alfa provider
    const alfaTab = appPage.locator("button").filter({ hasText: /^Alfa$/ }).first();
    await expect(alfaTab).toBeVisible({ timeout: 8_000 });
    await alfaTab.click();

    const before = await getAlfaUsdBalance(appPage);

    await submitCreditTransfer(appPage, "70111222", "3");

    const after = await getAlfaUsdBalance(appPage);
    const delta = before - after;

    expect(delta).toBeCloseTo(3.16, 1);
  });

  test("MTC $1.50 transfer: drawer decremented by $1.66 (ceiling — 1 SMS for sub-$3 amount)", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/recharge");

    const mtcTab = appPage.locator("button").filter({ hasText: /^MTC$/ }).first();
    await expect(mtcTab).toBeVisible({ timeout: 8_000 });
    await mtcTab.click();

    const before = await getMtcUsdBalance(appPage);

    await submitCreditTransfer(appPage, "03111444", "1.5");

    const after = await getMtcUsdBalance(appPage);
    const delta = before - after;

    // ceil(1.5/3)=1 SMS → $0.16 → total $1.66
    expect(delta).toBeCloseTo(1.66, 1);
  });
});
