/**
 * E2E: LIRA-093 — CUSTOMER_ACCOUNT works from EVERY payment form (owner req
 * 2026-07-04, revised 2026-07-09): one shared "E2E Client"; on each form type
 * the first letters, pick the autocomplete suggestion, pay on account, and
 * assert the client's balance moved in the Debts data — finishing with the
 * Debts page UI.
 *
 * ONE model everywhere: OPEN DEBT. Every form — custom services, loto,
 * telecom recharge, and financial services (katsh/ipick catalog, omt/whish
 * app transfers) — books a `debt_ledger` row on CUSTOMER_ACCOUNT; the
 * client's debt INCREASES by the amount. No prior balance is required — a
 * client with zero (or even positive/owing) balance can still charge to
 * account, same as POS/telecom. Financial services previously validated
 * CUSTOMER_ACCOUNT against existing prepaid credit and rejected a
 * never-credited client outright ("Not enough balance…"); that gate
 * (`DebtService.validateCustomerAccountAvailability`) is retired — the
 * katsh and omt-app tests below prove a client with NO seeded credit can
 * still charge to account.
 *
 * This sweep's mapping found (and this session fixed): loto silently DROPPED
 * CUSTOMER_ACCOUNT legs — ticket sold, supplier debt accrued, customer owed
 * nothing. The loto test here is the e2e regression for that fix.
 *
 * POS, maintenance, and session-basket CUSTOMER_ACCOUNT flows are already
 * covered (app.spec, CheckoutModal.spec S49-51, lira-081, session-basket
 * specs) and are not duplicated here.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0, mode: "serial" });

const CLIENT_NAME = "E2E Client";

type DebtorRow = {
  id: number;
  full_name: string;
  total_debt_usd: number;
  total_debt_lbp: number;
};

type Api = {
  api: {
    clients: {
      create: (c: {
        full_name: string;
        phone_number: string;
        whatsapp_opt_in: 0 | 1;
      }) => Promise<{ success: boolean; id?: number; error?: string }>;
    };
    debt: {
      getDebtors: () => Promise<DebtorRow[]>;
    };
    mobileServiceItems: {
      getAll: () => Promise<{
        success: boolean;
        data?: Array<{
          provider: string;
          label: string;
          sell_lbp: number;
          is_active: number;
        }>;
      }>;
    };
  };
};

/** Snapshot the E2E Client's debt balance (0/0 when no ledger rows yet). */
async function balance(page: Page): Promise<{ usd: number; lbp: number }> {
  return page.evaluate(async (name) => {
    const w = window as unknown as Api;
    const row = (await w.api.debt.getDebtors()).find(
      (d) => d.full_name === name,
    );
    return {
      usd: row?.total_debt_usd ?? 0,
      lbp: row?.total_debt_lbp ?? 0,
    };
  }, CLIENT_NAME);
}

/** The owner's flow: type the first letters, click the suggestion. */
async function pickClient(scope: Page | ReturnType<Page["locator"]>) {
  const field = scope.locator('[data-testid="client-autocomplete-field"]').first();
  await field.click();
  await field.fill(CLIENT_NAME.slice(0, 3)); // "E2E"
  const option = scope
    .locator('[data-testid="client-dropdown"]')
    .locator('[data-testid^="client-option-"]')
    .filter({ hasText: CLIENT_NAME })
    .first();
  await option.click();
}

/** Assert the (auto-selected) payment method is CUSTOMER_ACCOUNT. */
async function expectCustomerAccount(
  scope: Page | ReturnType<Page["locator"]>,
) {
  const select = scope.locator('[data-testid^="payment-method-"]').first();
  await expect(select).toHaveValue("CUSTOMER_ACCOUNT", { timeout: 5_000 });
}

test.describe("LIRA-093 — customer account everywhere", () => {
  test("seed: create the E2E Client (name + phone — the account gate needs both)", async ({
    appPage,
  }) => {
    const res = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      const created = await w.api.clients.create({
        full_name: "E2E Client",
        phone_number: `71${String(Date.now()).slice(-6)}`,
        whatsapp_opt_in: 0,
      });
      return { ok: created.success === true, error: created.error ?? null };
    });
    expect(res.error).toBeNull();
    expect(res.ok).toBe(true);
  });

  test("custom services: pick E2E Client → auto CUSTOMER_ACCOUNT → debt +$25", async ({
    appPage,
  }) => {
    const before = await balance(appPage);
    await navigateTo(appPage, "/custom-services");

    // Description (SearchBar free text → Enter commits it). Pressing Enter
    // fast used to silently drop the text (the A5 bug, fixed in SearchBar);
    // assert the committed description input actually appears.
    const search = appPage.getByPlaceholder(/Search inventory/i);
    await search.fill("CA sweep service");
    await search.press("Enter");
    await expect(appPage.locator("#svc-description")).toHaveValue(
      "CA sweep service",
      { timeout: 1_000 },
    );

    // Price BEFORE picking the client (the pick remounts the payment line
    // with the current total).
    await appPage.locator("#svc-price").fill("25");

    await pickClient(appPage);
    await expectCustomerAccount(appPage);

    await appPage.getByRole("button", { name: /Submit Service/i }).click();

    await expect
      .poll(async () => (await balance(appPage)).usd - before.usd, {
        timeout: 10_000,
      })
      .toBeCloseTo(25, 2);
  });

  test("loto (regression for the dropped-leg bug): sell 150,000 LBP on account → debt +150,000 LBP", async ({
    appPage,
  }) => {
    const before = await balance(appPage);
    await navigateTo(appPage, "/loto");

    await appPage.getByPlaceholder("Enter sale amount").fill("150000");
    await pickClient(appPage);
    await expectCustomerAccount(appPage);

    // Two "Sell Ticket" buttons exist (tab + submit); the submit is last.
    await appPage.getByRole("button", { name: /Sell Ticket/i }).last().click();

    // Pre-fix: the leg was silently dropped and this delta stayed 0.
    await expect
      .poll(async () => (await balance(appPage)).lbp - before.lbp, {
        timeout: 10_000,
      })
      .toBeCloseTo(150_000, 2);
  });

  test("telecom recharge (MTC): custom sheet client picker → debt increases in LBP", async ({
    appPage,
  }) => {
    const before = await balance(appPage);
    await navigateTo(appPage, "/recharge");

    await appPage
      .locator("button")
      .filter({ hasText: /^MTC$/ })
      .first()
      .click({ force: true });

    // Amount for the default CREDIT_TRANSFER service — entered in USD
    // credit; the recharge itself (and its debt) books in LBP at the rate.
    await appPage.locator("#telecom-amount").fill("10");

    await appPage.getByRole("button", { name: /Proceed to Pay/i }).click();

    // PaymentSheet uses its own client picker (plain input + button rows).
    const sheetClient = appPage.getByPlaceholder(/Search client by name/i);
    await expect(sheetClient).toBeVisible({ timeout: 8_000 });
    await sheetClient.fill(CLIENT_NAME.slice(0, 3));
    await appPage
      .locator("button")
      .filter({ hasText: CLIENT_NAME })
      .first()
      .click();

    await expectCustomerAccount(appPage);
    await appPage
      .locator("button")
      .filter({ hasText: /^Pay / })
      .last()
      .click();

    // Telecom debt books in the recharge's LBP bucket: $10 of credit at the
    // sell rate (~89,500) ≈ 900k LBP; the exact total varies with rate + SMS
    // fee, so assert a substantial positive LBP delta.
    await expect
      .poll(async () => (await balance(appPage)).lbp - before.lbp, {
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(500_000);
  });

  test("katsh catalog sale on account (no prior credit needed): debt +item price", async ({
    appPage,
  }) => {
    // Financial services book CUSTOMER_ACCOUNT as open debt, same as every
    // other module — no prior balance/credit is required. The client already
    // carries debt from the earlier custom-services/loto/telecom tests in
    // this serial suite; this proves that existing (non-negative) balance
    // does not block a further on-account charge.
    // Pick a real active katsh item + its price from the catalog.
    const item = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      const all = await w.api.mobileServiceItems.getAll();
      const rows = all.data ?? [];
      return (
        rows.find(
          (i) => i.provider === "Katsh" && i.is_active === 1 && i.sell_lbp > 0,
        ) ?? null
      );
    });
    expect(item).not.toBeNull();

    const before = await balance(appPage);
    await navigateTo(appPage, "/recharge");
    await appPage
      .locator("button")
      .filter({ hasText: /^Katsh$/ })
      .first()
      .click({ force: true });

    // Capture any app alert (fixtures auto-accept them silently) — a failed
    // submit surfaces only as an alert, so assert none fired after Pay.
    const dialogs: string[] = [];
    appPage.on("dialog", (d) => {
      dialogs.push(d.message());
    });

    // The catalog grid is category-grouped — use the form's search to surface
    // the item's card. Cards are clickable <div>s (cursor-pointer), not buttons.
    await appPage.getByPlaceholder(/Search Katsh items/i).fill(item!.label);
    await appPage
      .locator("div.cursor-pointer")
      .filter({ hasText: item!.label })
      .first()
      .click();
    await appPage.getByRole("button", { name: /Proceed to Pay/i }).click();

    // Katsh sheet uses the shared autocomplete.
    await pickClient(appPage);
    await expectCustomerAccount(appPage);
    await appPage
      .locator("button")
      .filter({ hasText: /^Pay / })
      .last()
      .click();

    // Open debt: the LBP balance moves UP by the item price (no seeded
    // credit involved). On failure, surface any captured app alert — submit
    // rejections are otherwise invisible (auto-accepted).
    try {
      await expect
        .poll(async () => (await balance(appPage)).lbp - before.lbp, {
          timeout: 1000,
        })
        .toBeCloseTo(item!.sell_lbp, 2);
    } catch (e) {
      expect(dialogs, "app alerts fired during submit").toEqual([]);
      throw e;
    }
  });

  test("omt app transfer SEND $20 on account: debt +$20 (no prior credit needed)", async ({
    appPage,
  }) => {
    const before = await balance(appPage);
    await navigateTo(appPage, "/recharge");
    await appPage
      .locator("button")
      .filter({ hasText: /^OMT App$/ })
      .first()
      .click({ force: true });

    await appPage.locator("#transfer-amount").fill("20");

    // Sender field is a shared autocomplete (scope to its wrapper via id).
    const senderWrap = appPage
      .locator('[data-testid="client-autocomplete-input"]')
      .filter({ has: appPage.locator("#sender-name") });
    await appPage.locator("#sender-name").fill(CLIENT_NAME.slice(0, 3));
    await senderWrap
      .locator('[data-testid^="client-option-"]')
      .filter({ hasText: CLIENT_NAME })
      .first()
      .click();

    await appPage.getByRole("button", { name: /Proceed to Pay/i }).click();
    await expectCustomerAccount(appPage);
    await appPage
      .locator("button")
      .filter({ hasText: /^Pay / })
      .last()
      .click();

    await expect
      .poll(async () => (await balance(appPage)).usd - before.usd, {
        timeout: 10_000,
      })
      .toBeCloseTo(20, 2);
  });

  test("Debts page UI shows the E2E Client with the accumulated balance", async ({
    appPage,
  }) => {
    const totals = await balance(appPage);
    await navigateTo(appPage, "/debts");

    const search = appPage.getByPlaceholder("Search client...");
    await search.fill("E2E");

    const card = appPage
      .locator("button")
      .filter({ hasText: CLIENT_NAME })
      .first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    // The card renders the USD figure of whatever the net balance is.
    await expect(card).toContainText(Math.abs(totals.usd).toFixed(2));
  });
});
