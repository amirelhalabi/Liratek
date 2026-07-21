/**
 * E2E: Alfa Gift card recording (regression + customer session)
 *
 * Regression: handleAlfaGiftSubmit used to send a payload
 * {rechargeType, giftTier, amountUsd, priceLbp} that FAILED the recharge:process
 * Zod schema (which requires {type, amount, cost, price}), so the gift sale was
 * silently never recorded — and therefore never appeared in a customer session.
 *
 * This spec verifies:
 *   1. Submitting an Alfa Gift outside a session records exactly one ALFA_GIFT
 *      recharge with a correct {type, amount, cost, price} shape.
 *   2. Submitting an Alfa Gift while a customer session is active defers it into
 *      the session basket (no direct recharge), and a basket checkout then
 *      records the gift AND links it to the session.
 *
 * Shared Electron instance / accumulating DB. We start from a clean session
 * slate because an earlier spec (lira-064) leaves a session open — without that,
 * the no-session test's gift would defer into the open basket. Provider/gift
 * tabs are force-clicked because the active-session hover popup in the TopBar can
 * overlay them (same pattern as lira-062). Assertions match by IDENTITY (new
 * recharge ids, session id) and DELTAS (CLAUDE.md rule 15).
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

/** Close every active customer session via IPC (clean slate). */
async function closeAllActiveSessions(page: Page) {
  await page.evaluate(async () => {
    const r = await (window as any).api.session.getActiveSessions();
    const list = (r.sessions ?? r) as Array<{ id: number }>;
    for (const s of list) {
      await (window as any).api.session.close(s.id, "admin");
    }
  });
}

/** Wait until the renderer's SessionContext reflects "no active session". */
async function waitNoActiveSession(page: Page) {
  await expect(
    page.locator('button[title="Start Customer Session"]'),
  ).toBeVisible({ timeout: 8_000 });
}

/**
 * Dispatch a native click on the exact element whose trimmed text matches.
 * In session mode the active-session hover popup overlays the provider/service
 * tabs, and even a Playwright force-click lands on the topmost (popup) element;
 * a native element.click() fires the React handler regardless of overlays.
 * Waits for the element to exist first (handles React re-renders between tabs).
 */
async function nativeClickByText(page: Page, tag: string, text: string) {
  await page.waitForFunction(
    ({ tag, text }) =>
      Array.from(document.querySelectorAll(tag)).some(
        (e) => (e.textContent || "").trim() === text,
      ),
    { tag, text },
    { timeout: 8_000 },
  );
  await page.evaluate(
    ({ tag, text }) => {
      const el = Array.from(document.querySelectorAll(tag)).find(
        (e) => (e.textContent || "").trim() === text,
      );
      (el as HTMLElement).click();
    },
    { tag, text },
  );
}

/** Select an Alfa Gift tier and confirm payment on the open Recharge page.
 *  With an active session (owner note 19, 2026-07-20) the sticky trigger
 *  reads "Add to Cart" and submits straight into the basket — no
 *  PaymentSheet; pass `inSessionId` so the helper can wait on the basket
 *  write (the sheet-hidden wait used to be the sync point). */
async function submitAlfaGift(
  page: Page,
  tierLabel: string,
  opts: { inSessionId?: number } = {},
) {
  await nativeClickByText(page, "button", "Alfa"); // provider tab
  await nativeClickByText(page, "button", "Alfa Gift"); // service-type tab
  await nativeClickByText(page, "div", tierLabel); // gift tier card (bold label)

  if (opts.inSessionId != null) {
    const addTrigger = page.getByRole("button", {
      name: "Add to Cart",
      exact: true,
    });
    await expect(addTrigger).toBeEnabled({ timeout: 5_000 });
    await nativeClickByText(page, "button", "Add to Cart");
    await page.waitForFunction(
      async (sessionIdArg: number) => {
        const r = await (window as any).api.session.cartGet(sessionIdArg);
        const items = (r.items ?? r) as Array<{
          module: string;
          form_data: string;
        }>;
        return items.some((i) => {
          if (i.module !== "recharge_alfa") return false;
          try {
            return JSON.parse(i.form_data).type === "ALFA_GIFT";
          } catch {
            return false;
          }
        });
      },
      opts.inSessionId,
      { timeout: 8_000 },
    );
    return;
  }

  // Sticky trigger bar "Pay" button opens the PaymentSheet; wait for it to
  // enable (tier selected) before clicking.
  const payTrigger = page.getByRole("button", { name: "Pay", exact: true });
  await expect(payTrigger).toBeEnabled({ timeout: 5_000 });
  await nativeClickByText(page, "button", "Pay");

  // PaymentSheet confirm is "Pay <amount> LBP"; it calls onConfirm + onClose.
  const confirm = page.locator("button").filter({ hasText: /^Pay / }).last();
  await expect(confirm).toBeVisible({ timeout: 5_000 });
  await confirm.click();
  await expect(confirm).toBeHidden({ timeout: 8_000 });
}

/** Start a customer session through the real FAB → New Session modal UI. */
async function startSessionViaUI(page: Page, name: string) {
  const fab = page
    .locator(
      'button[title="Start Customer Session"], button[title*="active session"]',
    )
    .first();
  await fab.click({ timeout: 10_000 });

  const newSessionBtn = page.locator('button:has-text("New Session")').first();
  if (await newSessionBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await newSessionBtn.click();
  }

  await page.waitForSelector('h2:has-text("New Customer Session")', {
    timeout: 5_000,
  });
  await page.locator("#customer-name").fill(name);
  await page.getByRole("button", { name: /Start Session/i }).click();
  await page.waitForSelector('h2:has-text("New Customer Session")', {
    state: "detached",
    timeout: 8_000,
  });
  // Move off the TopBar so the hover-driven session popup doesn't linger.
  await page.mouse.move(10, 400);
}

// Never leak an open session OR a hover-driven session popup into later specs
// (e.g. recharge.spec, whose plain tab clicks would otherwise be intercepted).
test.afterEach(async ({ appPage }) => {
  await closeAllActiveSessions(appPage).catch(() => {});
  await appPage.mouse.move(10, 400).catch(() => {});
});

test.describe("Alfa Gift recording", () => {
  test("submitting an Alfa Gift records exactly one ALFA_GIFT recharge", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/recharge");
    await closeAllActiveSessions(appPage);
    await waitNoActiveSession(appPage);

    const beforeIds = await appPage.evaluate(async () => {
      const h = (await (window as any).api.recharge.getHistory(
        "Alfa",
      )) as Array<{
        id: number;
      }>;
      return h.map((r) => r.id);
    });

    await submitAlfaGift(appPage, "1 GB");

    const created = await appPage.evaluate(async (before: number[]) => {
      const h = (await (window as any).api.recharge.getHistory(
        "Alfa",
      )) as Array<{
        id: number;
        recharge_type: string;
        amount: number;
        cost: number;
        price: number;
      }>;
      return h
        .filter((r) => !before.includes(r.id))
        .map((r) => ({
          recharge_type: r.recharge_type,
          amount: r.amount,
          cost: r.cost,
          price: r.price,
        }));
    }, beforeIds);

    // Before the fix this was [] (validation failed → nothing recorded).
    expect(created).toHaveLength(1);
    expect(created[0].recharge_type).toBe("ALFA_GIFT");
    // 1 GB tier USD face value is 3.5 (ALFA_GIFT_TIERS).
    expect(created[0].amount).toBeCloseTo(3.5, 2);
    expect(created[0].price).toBeGreaterThan(0);
    expect(created[0].cost).toBeGreaterThan(0);
  });

  test("Alfa Gift in an active session defers to the basket and links on checkout", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/recharge");
    await closeAllActiveSessions(appPage);
    await waitNoActiveSession(appPage);

    const name = `E2E Gift Session ${Date.now()}`;
    await startSessionViaUI(appPage, name);

    const sessionId = await appPage.evaluate(async (nm: string) => {
      const r = await (window as any).api.session.getActiveSessions();
      const list = (r.sessions ?? r) as Array<{
        id: number;
        customer_name?: string;
      }>;
      return list.find((s) => s.customer_name === nm)?.id ?? null;
    }, name);
    expect(sessionId).not.toBeNull();
    const sid = sessionId as number;

    await navigateTo(appPage, "/recharge");

    const giftCountBefore = await appPage.evaluate(async () => {
      const h = (await (window as any).api.recharge.getHistory(
        "Alfa",
      )) as Array<{
        recharge_type: string;
      }>;
      return h.filter((r) => r.recharge_type === "ALFA_GIFT").length;
    });

    await submitAlfaGift(appPage, "3 GB", { inSessionId: sid });

    // The gift must land in THIS session's basket, not be submitted directly.
    const inCart = await appPage.evaluate(async (sessionIdArg: number) => {
      const r = await (window as any).api.session.cartGet(sessionIdArg);
      const items = (r.items ?? r) as Array<{
        module: string;
        form_data: string;
      }>;
      return items.some((i) => {
        if (i.module !== "recharge_alfa") return false;
        try {
          return JSON.parse(i.form_data).type === "ALFA_GIFT";
        } catch {
          return false;
        }
      });
    }, sid);
    expect(inCart).toBe(true);

    const giftCountAfterAdd = await appPage.evaluate(async () => {
      const h = (await (window as any).api.recharge.getHistory(
        "Alfa",
      )) as Array<{
        recharge_type: string;
      }>;
      return h.filter((r) => r.recharge_type === "ALFA_GIFT").length;
    });
    // Deferred — no new recharge yet.
    expect(giftCountAfterAdd).toBe(giftCountBefore);

    // Check out the basket; the gift should now be recorded AND linked.
    const result = await appPage.evaluate(async (sessionIdArg: number) => {
      const cartRes = await (window as any).api.session.cartGet(sessionIdArg);
      const items = (cartRes.items ?? cartRes) as Array<{
        item_id: string;
        module: string;
        label: string;
        amount: number;
        currency: string;
        form_data: string;
        ipc_channel: string;
      }>;
      const cartItems = items.map((i) => ({
        id: i.item_id,
        module: i.module,
        label: i.label,
        amount: i.amount,
        currency: i.currency,
        formData: JSON.parse(i.form_data),
        ipcChannel: i.ipc_channel,
      }));
      const totalLbp = cartItems.reduce(
        (s, i) => s + (i.currency === "LBP" ? i.amount : 0),
        0,
      );
      const checkout = await (window as any).api.session.checkout({
        sessionId: sessionIdArg,
        cartItems,
        paidByMethod: "CASH",
        payments: [
          {
            method: "CASH",
            currency_code: "LBP",
            amount: totalLbp,
            direction: "IN",
          },
        ],
        exchangeRate: 90000,
        userId: 1,
      });
      const h = (await (window as any).api.recharge.getHistory(
        "Alfa",
      )) as Array<{
        recharge_type: string;
      }>;
      const recent = (await (window as any).api.transactions.getRecent(
        100,
      )) as Array<{ type: string; session_id: number | null }>;
      return {
        ok: checkout.success,
        error: checkout.error ?? null,
        giftCount: h.filter((r) => r.recharge_type === "ALFA_GIFT").length,
        sessionRecharges: recent.filter(
          (t) => t.session_id === sessionIdArg && t.type === "RECHARGE",
        ).length,
      };
    }, sid);

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.giftCount).toBe(giftCountBefore + 1);
    expect(result.sessionRecharges).toBeGreaterThanOrEqual(1);
  });
});
