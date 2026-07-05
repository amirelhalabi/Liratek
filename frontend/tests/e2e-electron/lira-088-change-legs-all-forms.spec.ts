/**
 * E2E: LIRA-088 — change/return legs reach the books in EVERY payment form
 *
 * Owner-reported family (2026-07-03): forms that collect payment lines but
 * lose the change (OUT) legs on the way to the repository. Katsh worked;
 * loto, alfa gift, and custom services did not:
 *  - Loto page never wired the Return/Change output (change never captured).
 *  - Alfa gift's CardGridPayView didn't forward onReturnChange to its sheet.
 *  - CustomServiceRepository ignored `data.payments` entirely.
 *
 * IPC-driven; shared accumulating DB → delta assertions on General.
 */

import { test, expect } from "./fixtures";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    recharge: {
      getDrawerBalances: () => Promise<
        Array<{ name: string; usdBalance: number; lbpBalance: number }>
      >;
      process: (data: Record<string, unknown>) => Promise<{
        success: boolean;
        error?: string;
      }>;
    };
    loto: {
      sell: (data: Record<string, unknown>) => Promise<{
        success: boolean;
        error?: string;
      }>;
    };
    customServices: {
      add: (data: Record<string, unknown>) => Promise<{
        success: boolean;
        error?: string;
      }>;
    };
  };
};

async function general(appPage: import("@playwright/test").Page) {
  return appPage.evaluate(async () => {
    const w = window as unknown as Api;
    const g = (await w.api.recharge.getDrawerBalances()).find(
      (d) => d.name === "General",
    );
    return { usd: g?.usdBalance ?? 0, lbp: g?.lbpBalance ?? 0 };
  });
}

test.describe("LIRA-088 — change legs in all forms", () => {
  test("loto: 300k LBP ticket paid $10 with 700k LBP change (owner screenshot)", async ({
    appPage,
  }) => {
    const before = await general(appPage);
    const res = await appPage.evaluate(() =>
      (window as unknown as Api).api.loto.sell({
        ticket_number: `B88-${Date.now()}`,
        sale_amount: 300_000,
        payment_method: "CASH",
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 10 },
          {
            method: "CASH",
            currencyCode: "LBP",
            amount: 700_000,
            direction: "OUT",
          },
        ],
      }),
    );
    const after = await general(appPage);

    expect(res.error ?? null).toBeNull();
    expect(res.success).toBe(true);
    expect(after.usd - before.usd).toBeCloseTo(10, 2);
    expect(after.lbp - before.lbp).toBeCloseTo(-700_000, 2);
  });

  test("alfa gift: 900k LBP gift paid $20 with 900k LBP change (owner screenshot)", async ({
    appPage,
  }) => {
    const before = await general(appPage);
    const res = await appPage.evaluate(() =>
      (window as unknown as Api).api.recharge.process({
        provider: "Alfa",
        type: "ALFA_GIFT",
        amount: 10,
        cost: 9,
        price: 900_000,
        currency: "LBP",
        paid_by_method: "CASH",
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 20 },
          {
            method: "CASH",
            currencyCode: "LBP",
            amount: 900_000,
            direction: "OUT",
          },
        ],
      }),
    );
    const after = await general(appPage);

    expect(res.error ?? null).toBeNull();
    expect(res.success).toBe(true);
    expect(after.usd - before.usd).toBeCloseTo(20, 2);
    expect(after.lbp - before.lbp).toBeCloseTo(-900_000, 2);
  });

  test("custom service: 900k LBP service paid $20 with 900k LBP change", async ({
    appPage,
  }) => {
    const before = await general(appPage);
    const res = await appPage.evaluate(() =>
      (window as unknown as Api).api.customServices.add({
        description: `B88 unlock ${Date.now()}`,
        cost_usd: 0,
        cost_lbp: 500_000,
        price_usd: 0,
        price_lbp: 900_000,
        paid_by: "CASH",
        status: "completed",
        payments: [
          { method: "CASH", currency_code: "USD", amount: 20 },
          {
            method: "CASH",
            currency_code: "LBP",
            amount: 900_000,
            direction: "OUT",
          },
        ],
      }),
    );
    const after = await general(appPage);

    expect(res.error ?? null).toBeNull();
    expect(res.success).toBe(true);
    // +$20 in; −900,000 LBP change; −500,000 LBP cost outflow.
    expect(after.usd - before.usd).toBeCloseTo(20, 2);
    expect(after.lbp - before.lbp).toBeCloseTo(-1_400_000, 2);
  });

  // A5 canary (owner-reported, Windows-only so far, unreproducible on macOS):
  // "customer name / phone / note take no keyboard input" on the Services
  // page. This asserts the inputs DO accept keystrokes on the harness — a
  // regression net; the Windows-specific repro stays open in LEFT_TO_DO.
  test("A5 canary: Services page name/phone/note/description inputs accept keyboard input", async ({
    appPage,
  }) => {
    const { navigateTo } = await import("./fixtures");
    await navigateTo(appPage, "/custom-services");

    // Description field is a SearchBar until text is committed.
    const search = appPage.getByPlaceholder(/Search inventory/i);
    await expect(search).toBeVisible({ timeout: 10_000 });
    await search.click();
    await search.pressSequentially("A5 canary service");
    await expect(search).toHaveValue("A5 canary service");

    // Customer name (ClientAutocompleteInput), phone, note.
    const name = appPage.locator("#svc-client");
    await name.click();
    await name.pressSequentially("A5 Canary Customer");
    await expect(name).toHaveValue("A5 Canary Customer");

    const phone = appPage.locator("#svc-phone");
    await phone.click();
    await phone.pressSequentially("03123456");
    await expect(phone).toHaveValue("03123456");

    const note = appPage.locator("#svc-note");
    await note.click();
    await note.pressSequentially("canary note");
    await expect(note).toHaveValue("canary note");
  });
});
