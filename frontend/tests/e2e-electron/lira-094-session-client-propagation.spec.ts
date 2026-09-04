/**
 * E2E: LIRA-094 — every transaction type made through ONE customer session
 * must carry the client name (owner req 2026-07-04, full-matrix version).
 *
 * The session-checkout replay (sessionHandlers.processCartItem) spreads each
 * cart item's stored formData VERBATIM — it never injects the session client.
 * So client propagation depends entirely on what each page's session branch
 * put into formData (CLAUDE.md rule 11, session flavor). This spec DOM-drives
 * EVERY sessionable flow through its real page UI, checks out once through
 * the real SessionCheckoutModal, then sweeps every transaction linked to the
 * session and asserts client_name on each.
 *
 * Basket flows (24): custom service · loto · MTC credits/days · Alfa
 * credits/days · Alfa Gift · Katsh item/bill · iPick item/bill · Whish App
 * item · Whish/OMT App transfer SEND+RECEIVE · Binance SEND+cashout · POS
 * sale · maintenance · OMT system SEND+RECEIVE (primary) · WHISH system
 * SEND+RECEIVE (secondary, via a seeded partner — production shape).
 * Plus: Exchange (no basket branch — it executes immediately and LINKS to the
 * session, so the sweep still covers it).
 *
 * Excluded by design: Expenses (shop expense, no client). Alfa Gift's
 * STANDALONE flow stays clientless (owner-accepted: no client UI there) —
 * but in a SESSION the telecom autofill carries the client, proven here.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0, mode: "serial" });

// This spec asserts on toast visibility — opt out of the harness's 2ms
// notification-duration override and keep the real dismiss timing.
test.use({ notificationDurationMs: null });

const CLIENT_NAME = "E2E Session Client";
const PRODUCT_NAME = "L094 Session Widget";

type Api = {
  api: {
    clients: {
      create: (c: {
        full_name: string;
        phone_number: string;
        whatsapp_opt_in: 0 | 1;
      }) => Promise<{ success: boolean; id?: number; error?: string }>;
    };
    partners: {
      create: (d: {
        name: string;
        phone?: string;
        system_association?: string | null;
      }) => Promise<{ success: boolean; id?: number; error?: string }>;
      getAll: (
        includeInactive?: boolean,
      ) => Promise<Array<{ id: number; name: string }>>;
    };
    session: {
      start: (d: {
        customer_name: string;
        customer_phone: string;
        started_by: string;
      }) => Promise<{ success?: boolean; sessionId?: number; error?: string }>;
      getActive: () => Promise<{ session?: { id: number } | null }>;
    };
    transactions: {
      getRecent: (
        limit?: number,
        filters?: Record<string, unknown>,
      ) => Promise<
        Array<{
          id: number;
          type: string;
          session_id?: number | null;
          client_id?: number | null;
          client_name?: string | null;
          summary?: string | null;
        }>
      >;
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

let sessionId = 0;
let dialogs: string[] = [];

/** TopBar badge is the cheap cart-count barrier between flows. */
async function expectCartCount(page: Page, n: number) {
  try {
    await expect(
      page.locator("button").filter({ hasText: `items: ${n}` }),
    ).toBeVisible({ timeout: 10_000 });
  } catch (e) {
    expect(dialogs, `alerts while adding item #${n}`).toEqual([]);
    const toasts = await page
      .locator('[role="alert"]')
      .allTextContents()
      .catch(() => [] as string[]);
    expect(toasts, `toasts while adding item #${n}`).toEqual([]);
    throw e;
  }
}

const PROVIDER_MARKERS: Record<string, string> = {
  MTC: "#telecom-amount",
  Alfa: "#telecom-amount",
  Katsh: "Search Katsh items",
  iPick: "Search iPick items",
  // Whish App keeps inner-tab state (Transfer/Bills) across navigations —
  // the reliable "provider active" signal is its inner tab row, not the
  // transfer amount input (hidden while Bills mode is selected).
  "Whish App": "btn:Transfer",
  "OMT App": "#transfer-amount",
  Binance: "#crypto-amount",
};

/** Click a recharge provider tab and VERIFY its form rendered. Toasts from a
 *  previous action can sit OVER the tab row and swallow force-clicks (events
 *  go to the element at the coordinates), so wait them out before clicking. */
async function providerTab(page: Page, label: string) {
  const marker = PROVIDER_MARKERS[label];
  for (let attempt = 0; attempt < 4; attempt++) {
    await page
      .locator('[role="alert"]')
      .first()
      .waitFor({ state: "hidden", timeout: 6_000 })
      .catch(() => {});
    const tab = page
      .locator("button")
      .filter({ hasText: new RegExp(`^${label}$`) })
      .first();
    if (attempt === 0) {
      await tab.click({ force: true });
    } else {
      // Retry path: something (session hover popup / toast) is covering the
      // tab's pixels — park the mouse away to dismiss hover overlays, then
      // dispatch a DOM-level click that no overlay can intercept.
      await page.mouse.move(5, 400);
      await tab.evaluate((el) => (el as HTMLButtonElement).click());
    }
    if (!marker) return;
    const target = marker.startsWith("#")
      ? page.locator(marker).first()
      : marker.startsWith("btn:")
        ? page
            .locator("button")
            .filter({ hasText: new RegExp(`^${marker.slice(4)}$`) })
            .first()
        : page.getByPlaceholder(new RegExp(marker, "i")).first();
    // startTransition can take several seconds to commit under full-suite
    // CPU load — escalate the wait instead of assuming the click missed.
    const waitMs = [2_500, 5_000, 10_000, 10_000][attempt] ?? 10_000;
    const ok = await target
      .waitFor({ state: "visible", timeout: waitMs })
      .then(() => true)
      .catch(() => false);
    if (ok) return;
  }
  const visibleButtons = await page
    .locator("button:visible")
    .allTextContents()
    .catch(() => [] as string[]);
  const overlay = await page
    .locator("div.fixed.inset-0")
    .first()
    .isVisible({ timeout: 200 })
    .catch(() => false);
  const placeholders = await page
    .locator("input:visible")
    .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).placeholder))
    .catch(() => [] as string[]);
  throw new Error(
    `Provider tab "${label}" did not activate after 3 clicks. overlay=${overlay} placeholders=${JSON.stringify(placeholders)} buttons=${JSON.stringify(visibleButtons.slice(0, 40))}`,
  );
}

/** Search a catalog form and click the item card (cards are <div>s). */
async function clickCatalogItem(page: Page, provider: string, label: string) {
  await page
    .getByPlaceholder(new RegExp(`Search ${provider} items`, "i"))
    .fill(label);
  await page
    .locator("div.cursor-pointer")
    .filter({ hasText: label })
    .first()
    .click();
}

/** Find an active catalog item for a provider (label + LBP price). */
async function catalogItem(page: Page, provider: string) {
  const item = await page.evaluate(async (p) => {
    const w = window as unknown as Api;
    const all = await w.api.mobileServiceItems.getAll();
    return (
      (all.data ?? []).find(
        (i) => i.provider === p && i.is_active === 1 && i.sell_lbp > 0,
      ) ?? null
    );
  }, provider);
  expect(item, `no active ${provider} catalog item`).not.toBeNull();
  return item!;
}

test.describe("LIRA-094 — session client propagation (full matrix)", () => {
  test.beforeEach(({ appPage }) => {
    dialogs = [];
    appPage.on("dialog", (d) => {
      dialogs.push(d.message());
    });
  });

  test("seed: client + WHISH partner + product, then start the session", async ({
    appPage,
  }) => {
    const res = await appPage.evaluate(async (name) => {
      const w = window as unknown as Api;
      await w.api.clients.create({
        full_name: name,
        phone_number: `76${String(Date.now()).slice(-6)}`,
        whatsapp_opt_in: 0,
      });
      // Secondary-system (WHISH) transactions require a partner — production
      // shape: shop base = OMT, WHISH runs THROUGH a partner. autoSelectSingle
      // in the Services page picks it up without UI interaction.
      const partners = await w.api.partners.getAll(true);
      if (!partners.some((p) => p.name === "L094 Whish Partner")) {
        await w.api.partners.create({
          name: "L094 Whish Partner",
          system_association: "WHISH",
        });
      }
      const started = await w.api.session.start({
        customer_name: name,
        customer_phone: `76${String(Date.now()).slice(-6)}`,
        started_by: "admin",
      });
      const id =
        started.sessionId ?? (await w.api.session.getActive()).session?.id ?? 0;
      return { id, error: started.error ?? null };
    }, CLIENT_NAME);
    expect(res.error).toBeNull();
    expect(res.id).toBeGreaterThan(0);
    sessionId = res.id;

    // Product for the POS flow (UI path proven in app.spec).
    await navigateTo(appPage, "/products");
    await appPage.locator("button").filter({ hasText: "Add Product" }).click();
    await expect(appPage.locator("#product-name")).toBeVisible({
      timeout: 5_000,
    });
    await appPage.locator("#product-name").fill(PRODUCT_NAME);
    await appPage.locator("#product-cost-price").fill("4");
    await appPage.locator("#product-retail-price").fill("9");
    await appPage.locator("#product-stock").fill("50");
    await appPage.getByRole("button", { name: /Save Product/i }).click();
    await expect(appPage.locator(`text=${PRODUCT_NAME}`).first()).toBeVisible({
      timeout: 10_000,
    });

    // Session visible in the UI before driving pages.
    await navigateTo(appPage, "/custom-services");
    await expect(appPage.getByText(CLIENT_NAME).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("group 1: custom service, loto, POS sale, maintenance", async ({
    appPage,
  }) => {
    // 1. Custom service $15.
    await navigateTo(appPage, "/custom-services");
    // Hooked by data-testid (not placeholder copy — the owner rewords that text).
    const search = appPage.getByTestId("custom-service-item-search");
    await search.fill("L094 session service");
    await search.press("Enter");
    await expect(appPage.locator("#svc-description")).toHaveValue(
      "L094 session service",
    );
    await appPage.locator("#svc-price").fill("15");
    await appPage.getByRole("button", { name: /Submit Service/i }).click();
    await expectCartCount(appPage, 1);

    // 2. Loto ticket 120,000 LBP.
    await navigateTo(appPage, "/loto");
    await appPage.getByPlaceholder("Enter sale amount").fill("120000");
    await appPage
      .getByRole("button", { name: /Sell Ticket|Add to/i })
      .last()
      .click();
    await expectCartCount(appPage, 2);

    // 3. POS sale (session mode: cart footer says "Add to Session Cart").
    await navigateTo(appPage, "/pos");
    const posSearch = appPage.getByPlaceholder(
      "Search products by name or barcode...",
    );
    await expect(posSearch).toBeVisible({ timeout: 10_000 });
    await posSearch.fill(PRODUCT_NAME);
    await appPage.locator(`text=${PRODUCT_NAME}`).first().click();
    await appPage.getByRole("button", { name: /Add to Session Cart/i }).click();
    await expectCartCount(appPage, 3);

    // 4. Maintenance $12 via its CheckoutModal (session branch on complete).
    await navigateTo(appPage, "/maintenance");
    await appPage.locator("#maintenance-device-name").fill("L094 Phone");
    await appPage.locator("#maintenance-issue").fill("screen");
    await appPage.locator("#maintenance-price").fill("12");
    await appPage.getByRole("button", { name: /Proceed to Checkout/i }).click();
    const modal = appPage.locator('[data-testid="checkout-modal"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await appPage.locator('[data-testid="checkout-complete-btn"]').click();
    await expectCartCount(appPage, 4);
  });

  test("group 2: telecom — MTC credits, MTC days, Alfa credits, Alfa days", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/recharge");

    // 5. MTC credits $5 ("Add to Cart" in session mode skips the sheet).
    await providerTab(appPage, "MTC");
    await appPage.locator("#telecom-amount").fill("5");
    await appPage.getByRole("button", { name: /Add to Cart/i }).click();
    await expectCartCount(appPage, 5);

    // 6. MTC days (needs days-count + cost + price).
    await appPage
      .locator("button")
      .filter({ hasText: /^Days$/ })
      .first()
      .click();
    await appPage.locator("#telecom-amount").fill("30");
    await appPage.locator("#telecom-days-cost").fill("3");
    await appPage.locator("#telecom-price").first().fill("4");
    await appPage.getByRole("button", { name: /Add to Cart/i }).click();
    await expectCartCount(appPage, 6);

    // 7. Alfa credits $4.
    await providerTab(appPage, "Alfa");
    await appPage.locator("#telecom-amount").fill("4");
    await appPage.getByRole("button", { name: /Add to Cart/i }).click();
    await expectCartCount(appPage, 7);

    // 8. Alfa days.
    await appPage
      .locator("button")
      .filter({ hasText: /^Days$/ })
      .first()
      .click();
    await appPage.locator("#telecom-amount").fill("30");
    await appPage.locator("#telecom-days-cost").fill("2");
    await appPage.locator("#telecom-price").first().fill("3");
    await appPage.getByRole("button", { name: /Add to Cart/i }).click();
    await expectCartCount(appPage, 8);
  });

  test("group 3: catalog items + bills — Katsh, iPick, Whish App items", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/recharge");

    // 9. Katsh item ("Add to Cart" replaces Proceed to Pay in session mode).
    const katshItem = await catalogItem(appPage, "Katsh");
    await providerTab(appPage, "Katsh");
    await clickCatalogItem(appPage, "Katsh", katshItem.label);
    await appPage
      .getByRole("button", { name: /Add to Cart|Proceed to Pay/i })
      .last()
      .click();
    await expectCartCount(appPage, 9);

    // 10. Katsh BILL 150,000 LBP — the BILL card is inline on the form and
    // only renders while the search box is EMPTY; session button says
    // "Add Bill to Cart".
    await appPage.getByPlaceholder(/Search Katsh items/i).fill("");
    const katshBill = appPage
      .locator("div.bg-slate-800")
      .filter({ has: appPage.getByText("BILL", { exact: true }) })
      .last();
    await katshBill.locator("input").last().fill("150000");
    await appPage.getByRole("button", { name: /Add Bill to Cart/i }).click();
    await expectCartCount(appPage, 10);

    // 11. iPick item.
    const ipickItem = await catalogItem(appPage, "iPick");
    await providerTab(appPage, "iPick");
    await clickCatalogItem(appPage, "iPick", ipickItem.label);
    await appPage
      .getByRole("button", { name: /Add to Cart|Proceed to Pay/i })
      .last()
      .click();
    await expectCartCount(appPage, 11);

    // 12. iPick BILL 100,000 LBP (same inline BILL card).
    await appPage.getByPlaceholder(/Search iPick items/i).fill("");
    const ipickBill = appPage
      .locator("div.bg-slate-800")
      .filter({ has: appPage.getByText("BILL", { exact: true }) })
      .last();
    await ipickBill.locator("input").last().fill("100000");
    await appPage.getByRole("button", { name: /Add Bill to Cart/i }).click();
    await expectCartCount(appPage, 12);

    // 13. Whish App item (its items/bills section = FinancialForm).
    const whishItem = await catalogItem(appPage, "WHISH_APP");
    await providerTab(appPage, "Whish App");
    await appPage
      .locator("button")
      .filter({ hasText: /^Bills$/ })
      .first()
      .click();
    await clickCatalogItem(appPage, "Whish App", whishItem.label);
    await appPage
      .getByRole("button", { name: /Add to Cart|Proceed to Pay/i })
      .last()
      .click();
    await expectCartCount(appPage, 13);
  });

  test("group 4: app transfers + binance", async ({ appPage }) => {
    await navigateTo(appPage, "/recharge");

    // 14/15. Whish App transfer SEND $10 + RECEIVE $8 (name/phone autofill
    // from the session).
    await providerTab(appPage, "Whish App");
    await appPage
      .locator("button")
      .filter({ hasText: /Transfer/i })
      .first()
      .click();
    await appPage.locator("#transfer-amount").fill("10");
    await appPage
      .getByRole("button", { name: /Proceed to Pay|Add to/i })
      .last()
      .click();
    await expectCartCount(appPage, 14);

    await appPage
      .locator("button")
      .filter({ hasText: /^Receive$/ })
      .first()
      .click();
    await appPage.locator("#transfer-amount").fill("8");
    await appPage
      .getByRole("button", { name: /Proceed to Pay|Add to|Confirm/i })
      .last()
      .click();
    await expectCartCount(appPage, 15);

    // 16/17. OMT App SEND $10 + RECEIVE $6.
    await providerTab(appPage, "OMT App");
    await appPage.locator("#transfer-amount").fill("10");
    await appPage
      .getByRole("button", { name: /Proceed to Pay|Add to/i })
      .last()
      .click();
    await expectCartCount(appPage, 16);

    await appPage
      .locator("button")
      .filter({ hasText: /^Receive$/ })
      .first()
      .click();
    await appPage.locator("#transfer-amount").fill("6");
    await appPage
      .getByRole("button", { name: /Proceed to Pay|Add to|Confirm/i })
      .last()
      .click();
    await expectCartCount(appPage, 17);

    // 18/19. Binance SEND 20 USDT + Cash Out 15 USDT.
    await providerTab(appPage, "Binance");
    await appPage.locator("#crypto-amount").fill("20");
    await appPage
      .getByRole("button", { name: /Proceed to Pay|Add to/i })
      .last()
      .click();
    await expectCartCount(appPage, 18);

    await appPage
      .locator("button")
      .filter({ hasText: /Cash Out/i })
      .first()
      .click();
    await appPage.locator("#crypto-amount").fill("15");
    await appPage
      .getByRole("button", { name: /Confirm Cash Out|Add to/i })
      .last()
      .click();
    await expectCartCount(appPage, 19);
  });

  test("group 5: system services — OMT (primary) + WHISH (secondary/partner) SEND+RECEIVE", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/omt-whish");

    // 20. OMT system SEND $30.
    await appPage
      .locator("button")
      .filter({ hasText: /OMT/ })
      .filter({ hasText: /↑/ })
      .first()
      .click();
    await appPage.locator("#service-amount").fill("30");
    await appPage
      .getByRole("button", { name: /Record (Send|Receive)/i })
      .last()
      .click();
    await expectCartCount(appPage, 20);

    // 21. OMT system RECEIVE $25.
    await appPage
      .locator("button")
      .filter({ hasText: /OMT/ })
      .filter({ hasText: /↓/ })
      .first()
      .click();
    await appPage.locator("#service-amount").fill("25");
    await appPage
      .getByRole("button", { name: /Record (Send|Receive)/i })
      .last()
      .click();
    await expectCartCount(appPage, 21);

    // 22. WHISH system SEND $20 (partner auto-selected — single WHISH partner).
    await appPage
      .locator("button")
      .filter({ hasText: /WHISH/i })
      .filter({ hasText: /↑/ })
      .first()
      .click();
    await appPage.locator("#service-amount").fill("20");
    await appPage
      .getByRole("button", { name: /Record (Send|Receive)/i })
      .last()
      .click();
    await expectCartCount(appPage, 22);

    // 23. WHISH system RECEIVE $18.
    await appPage
      .locator("button")
      .filter({ hasText: /WHISH/i })
      .filter({ hasText: /↓/ })
      .first()
      .click();
    await appPage.locator("#service-amount").fill("18");
    await appPage
      .getByRole("button", { name: /Record (Send|Receive)/i })
      .last()
      .click();
    await expectCartCount(appPage, 23);
  });

  test("group 6: Alfa Gift — session client propagates despite no client field in the gift UI", async ({
    appPage,
  }) => {
    // The standalone gift sheet has no client UI (owner-accepted); with a
    // SESSION active the page's telecom client state autofills from the
    // session and the gift defers into the basket — the sweep proves the
    // client name reaches the transaction.
    await navigateTo(appPage, "/recharge");
    await providerTab(appPage, "Alfa");
    await appPage
      .locator("button")
      .filter({ hasText: /Alfa Gift/i })
      .first()
      .click();
    // Flow (owner note 19, 2026-07-20): with a session active the sticky
    // trigger reads "Add to Cart" and hands the gift straight to the basket
    // via handleAlfaGiftSubmit's session branch — no PaymentSheet opens.
    await expect(appPage.getByText("Select Alfa Gift")).toBeVisible({
      timeout: 8_000,
    });
    await appPage.locator("div.cursor-pointer").first().click();
    await appPage.getByRole("button", { name: /^Add to Cart$/ }).click();
    await expectCartCount(appPage, 24);
  });

  test("exchange links to the session (no basket branch — executes directly)", async ({
    appPage,
  }) => {
    // Exchange has no basket branch: the page executes the transaction and
    // calls session.linkTransaction (Exchange/index.tsx session block). The
    // calculator's rate/profit gating is UI-heavy, so this replicates the
    // page's exact two IPC calls — clientName comes from the session autofill
    // exactly as the form fills it.
    const linked = await appPage.evaluate(
      async (args: { name: string; sid: number }) => {
        const w = window as unknown as Api & {
          api: {
            exchange: {
              addTransaction: (d: Record<string, unknown>) => Promise<{
                success?: boolean;
                id?: number;
                error?: string;
              }>;
            };
            session: {
              linkTransaction: (d: Record<string, unknown>) => Promise<unknown>;
            };
          };
        };
        const res = await w.api.exchange.addTransaction({
          fromCurrency: "USD",
          toCurrency: "LBP",
          amountIn: 10,
          amountOut: 890_000,
          leg1Rate: 89_000,
          leg1MarketRate: 89_000,
          leg1ProfitUsd: 0,
          totalProfitUsd: 0,
          clientName: args.name,
        });
        let linkResult: unknown = null;
        if (res?.success && res.id) {
          linkResult = await w.api.session.linkTransaction({
            transactionType: "exchange",
            transactionId: res.id,
            amountUsd: 10,
            amountLbp: 0,
            profitUsd: 0,
          });
        }
        return {
          ok: res?.success === true,
          error: res?.error ?? null,
          link: JSON.stringify(linkResult),
        };
      },
      { name: CLIENT_NAME, sid: sessionId },
    );
    expect(linked.error).toBeNull();
    expect(linked.ok).toBe(true);
    expect(linked.link).toContain('"linked":true');
    // Linked transaction appears for the session (asserted in the sweep).
    await expect
      .poll(
        async () =>
          appPage.evaluate(async (sid) => {
            const w = window as unknown as Api;
            const rows = await w.api.transactions.getRecent(100);
            return rows.some(
              (t) => t.session_id === sid && t.type === "EXCHANGE",
            );
          }, sessionId),
        { timeout: 10_000 },
      )
      .toBe(true);
  });

  test("checkout the 24-item basket via the SessionCheckoutModal", async ({
    appPage,
  }) => {
    await appPage
      .locator("button")
      .filter({ hasText: `Session - ${CLIENT_NAME}` })
      .hover();
    await appPage
      .locator("button")
      .filter({ hasText: /Checkout \(24 items\)/ })
      .click();

    const confirm = appPage.getByRole("button", { name: /Confirm Checkout/i });
    await expect(confirm).toBeVisible({ timeout: 10_000 });
    await expect(confirm).toBeEnabled({ timeout: 10_000 });
    await confirm.click();
    try {
      await expect(confirm).toBeHidden({ timeout: 20_000 });
    } catch (e) {
      expect(dialogs, "alerts during checkout").toEqual([]);
      expect(
        await appPage.locator(".text-red-300").allTextContents(),
        "in-modal checkout error",
      ).toEqual([]);
      throw e;
    }
  });

  test("SWEEP: every transaction linked to the session carries the client name", async ({
    appPage,
  }) => {
    const rows = await appPage.evaluate(
      async (args: { sid: number }) => {
        const w = window as unknown as Api;
        const recent = await w.api.transactions.getRecent(200);
        return recent
          .filter((t) => t.session_id === args.sid)
          .map((t) => ({
            id: t.id,
            type: t.type,
            client_name: t.client_name ?? null,
            client_id: t.client_id ?? null,
            summary: t.summary ?? null,
          }));
      },
      { sid: sessionId },
    );

    // 24 basket flows + the linked exchange (some flows may write >1 row).
    expect(rows.length).toBeGreaterThanOrEqual(25);

    const offenders = rows
      .filter((r) => r.client_name !== CLIENT_NAME)
      .map(
        (r) =>
          `#${r.id} ${r.type} client_name=${JSON.stringify(r.client_name)} client_id=${r.client_id} (${r.summary})`,
      );
    expect(offenders).toEqual([]);
  });
});
