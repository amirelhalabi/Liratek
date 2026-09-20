/**
 * lira-web-033 — OMT App wallet loads on OMT credit by default, over REST +
 * the real browser UI (LIRA-190, OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §1 D2/D4,
 * §5). Web twin of the desktop `lira-190-omt-app-credit-topup.spec.ts` (L10).
 *
 * D2: loading the OMT App wallet moves NO physical cash — the `OMT_App`
 * drawer goes up and the OMT account debt goes up by the same amount; the
 * `OMT_System` (OMT Cash Drawer) is UNCHANGED. D4: the top-up modal's
 * funding choice defaults to "On OMT credit"; "Transfer from drawer" (the
 * pre-existing drawer-to-drawer path) stays available as an explicit
 * alternative, and its OWN default source no longer silently drains
 * `OMT_System` (`TOP_UP_PROVIDER_DEFAULT_SOURCES.OMT_APP` changed to
 * `"General"` — a regression this spec also guards).
 *
 * Three layers, cheapest-and-most-structural first:
 *  (a) REST-level core proof: `topUpFromSupplier({provider:"OMT_APP"})`
 *      widened onto the existing iPick/Katsh mechanism — USD AND LBP.
 *  (b) Real-UI proof of the DEFAULT (rule: "drive the UI wherever the
 *      frontend does arithmetic/decisions" — the funding CHOICE is exactly
 *      that: a frontend decision point, not something a hand-built IPC/REST
 *      payload can catch if the wiring regresses to the wrong handler).
 *  (c) Real-UI proof the "Transfer from drawer" alternative still exists,
 *      defaults its source to "General" (not "OMT_System"), and still moves
 *      real drawer-to-drawer cash when used explicitly.
 *
 * Rule 15 (accumulating, single-worker suite): every assertion is a DELTA
 * around a snapshot taken immediately before the action — never an absolute
 * balance or "newest row". `topUpFromSupplier`'s `RECHARGE_TOPUP` transaction
 * is NOT void-tested here. NOTE (LIRA-194, 2026-09-21): the original reason
 * given here — that `NON_REVERSIBLE_TRANSACTION_TYPES` lists `RECHARGE_TOPUP`
 * ("the provider-drawer credit has no payments row either") — is NO LONGER
 * TRUE. Every top-up writer now posts real `payments` rows and `RECHARGE_TOPUP`
 * was removed from that set, so a void here would be meaningful. This spec
 * simply does not cover it yet; void coverage lives in lira-web-034. Treat
 * the gap as untested, not as by-design non-reversibility.
 */
import type { Page } from "@playwright/test";
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

async function authHeaders(
  page: Page,
): Promise<{ Authorization: string }> {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  return { Authorization: `Bearer ${token}` };
}

interface DrawerBalance {
  name: string;
  usdBalance: number;
  lbpBalance: number;
  usdtBalance: number;
}

async function drawerBalances(
  page: Page,
  headers: { Authorization: string },
): Promise<DrawerBalance[]> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/recharge/drawer-balances`, {
      headers,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r.balances as DrawerBalance[];
}

function drawerOf(balances: DrawerBalance[], name: string): DrawerBalance {
  const d = balances.find((b) => b.name === name);
  expect(d, JSON.stringify(balances)).toBeTruthy();
  return d!;
}

interface AccountChildBalance {
  supplier_id: number;
  name: string;
  provider: string | null;
  drawer_name: string | null;
  total_usd: number;
  total_lbp: number;
  is_parent: boolean;
}
interface AccountBalance {
  account_supplier_id: number;
  account_name: string;
  total_usd: number;
  total_lbp: number;
  children: AccountChildBalance[];
}

async function omtAppChildBalance(
  page: Page,
  headers: { Authorization: string },
): Promise<AccountChildBalance> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/suppliers/account-balances`, {
      headers,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  const account = (r.balances as AccountBalance[]).find(
    (a) => a.account_name === "OMT",
  );
  expect(account, JSON.stringify(r)).toBeTruthy();
  const child = account!.children.find((c) => c.provider === "OMT_APP");
  expect(child, JSON.stringify(account)).toBeTruthy();
  return child!;
}

test.describe("OMT App wallet credit top-up (LIRA-190)", () => {
  test("REST: topUpFromSupplier(OMT_APP) leaves OMT_System untouched and books +amount, USD and LBP", async ({
    page,
  }) => {
    const headers = await authHeaders(page);

    for (const { amount, currency } of [
      { amount: 41.5, currency: "USD" as const },
      { amount: 620_000, currency: "LBP" as const },
    ]) {
      const before = await drawerBalances(page, headers);
      const omtSystemBefore = drawerOf(before, "OMT_System");
      const omtAppBefore = drawerOf(before, "OMT_App");
      const childBefore = await omtAppChildBalance(page, headers);

      const result = await (
        await page.request.post(
          `${BACKEND_URL}/api/recharge/top-up-from-supplier`,
          { headers, data: { provider: "OMT_APP", amount, currency } },
        )
      ).json();
      expect(result.success, JSON.stringify(result)).toBeTruthy();

      const after = await drawerBalances(page, headers);
      const omtSystemAfter = drawerOf(after, "OMT_System");
      const omtAppAfter = drawerOf(after, "OMT_App");
      const childAfter = await omtAppChildBalance(page, headers);

      const field = currency === "USD" ? "usdBalance" : "lbpBalance";
      const acctField = currency === "USD" ? "total_usd" : "total_lbp";
      const digits = currency === "USD" ? 2 : 0;

      // D2: no physical cash moved — the OMT Cash Drawer is UNTOUCHED.
      expect(omtSystemAfter[field] - omtSystemBefore[field]).toBeCloseTo(
        0,
        digits,
      );
      // The wallet drawer goes up by exactly the amount.
      expect(omtAppAfter[field] - omtAppBefore[field]).toBeCloseTo(
        amount,
        digits,
      );
      // The account debt (via the 'OMT App' child) goes up by the SAME
      // amount — D2's "the account debt goes up by the same amount".
      expect(childAfter[acctField] - childBefore[acctField]).toBeCloseTo(
        amount,
        digits,
      );
    }
  });

  test("UI: the Top-Up modal's funding choice defaults to 'On OMT credit' — submitting without touching the toggle reaches the supplier-credit path", async ({
    page,
  }) => {
    const headers = await authHeaders(page);

    await page.goto("/#/recharge");
    await page.waitForTimeout(1_500);
    await expect(page.locator("#root")).not.toContainText(
      "Something went wrong",
    );

    await page.getByRole("button", { name: "OMT App" }).click();
    await page.waitForTimeout(500);

    const before = await drawerBalances(page, headers);
    const omtSystemBefore = drawerOf(before, "OMT_System");
    const omtAppBefore = drawerOf(before, "OMT_App");
    const childBefore = await omtAppChildBalance(page, headers);

    await page.getByRole("button", { name: "Top-Up", exact: true }).click();
    await expect(
      page.getByText("Top Up OMT App Drawer", { exact: false }),
    ).toBeVisible({ timeout: 10_000 });

    const modal = page.locator(".fixed.inset-0.z-50", {
      hasText: "Top Up OMT App Drawer",
    });

    // Both funding-choice buttons render (D4); the default is "credit" —
    // proven behaviourally below by NOT clicking either and checking the
    // submit button already reads the supplier-credit label.
    await expect(modal.getByTestId("topup-funding-credit")).toBeVisible();
    await expect(modal.getByTestId("topup-funding-transfer")).toBeVisible();
    await expect(
      modal.getByRole("button", { name: "Confirm Supplier Credit" }),
    ).toBeVisible();

    // Run-unique-ish amount so this test's delta can't be confused with the
    // REST test above (different amount, same currency-agnostic proof).
    const AMOUNT = 17.65;
    await modal.locator('input[placeholder="0.00"]').fill(String(AMOUNT));
    await modal
      .getByRole("button", { name: "Confirm Supplier Credit" })
      .click();

    // Modal closes on success.
    await expect(
      page.getByText("Top Up OMT App Drawer", { exact: false }),
    ).toHaveCount(0, { timeout: 10_000 });

    const after = await drawerBalances(page, headers);
    const omtSystemAfter = drawerOf(after, "OMT_System");
    const omtAppAfter = drawerOf(after, "OMT_App");
    const childAfter = await omtAppChildBalance(page, headers);

    expect(omtSystemAfter.usdBalance - omtSystemBefore.usdBalance).toBeCloseTo(
      0,
      2,
    );
    expect(omtAppAfter.usdBalance - omtAppBefore.usdBalance).toBeCloseTo(
      AMOUNT,
      2,
    );
    expect(childAfter.total_usd - childBefore.total_usd).toBeCloseTo(
      AMOUNT,
      2,
    );
  });

  test("UI: 'Transfer from drawer' stays available, defaults its source to General (not OMT_System), and moves real drawer cash when used explicitly", async ({
    page,
  }) => {
    const headers = await authHeaders(page);

    // Guarantee General has enough cash for the small transfer below,
    // regardless of what earlier specs left it at (rule 15 — never assume a
    // shared drawer's absolute balance).
    const injected = await (
      await page.request.post(`${BACKEND_URL}/api/drawer-topup`, {
        headers,
        data: { amount_usd: 25, amount_lbp: 0, notes: "lira-web-033 seed" },
      })
    ).json();
    expect(injected.success, JSON.stringify(injected)).toBeTruthy();

    await page.goto("/#/recharge");
    await page.waitForTimeout(1_500);
    await page.getByRole("button", { name: "OMT App" }).click();
    await page.waitForTimeout(500);

    const before = await drawerBalances(page, headers);
    const omtSystemBefore = drawerOf(before, "OMT_System");
    const omtAppBefore = drawerOf(before, "OMT_App");
    const generalBefore = drawerOf(before, "General");

    await page.getByRole("button", { name: "Top-Up", exact: true }).click();
    await expect(
      page.getByText("Top Up OMT App Drawer", { exact: false }),
    ).toBeVisible({ timeout: 10_000 });
    const modal = page.locator(".fixed.inset-0.z-50", {
      hasText: "Top Up OMT App Drawer",
    });

    await modal.getByTestId("topup-funding-transfer").click();

    // D2/D4 regression guard: the "From Drawer" select must default to
    // General now, not OMT_System (which the transfer path used to drain
    // silently before LIRA-190 — plan §7 open risk).
    const sourceSelect = modal.locator("select");
    await expect(sourceSelect).toHaveValue("General");

    await expect(
      modal.getByRole("button", { name: "Confirm Top-Up" }),
    ).toBeVisible();

    const AMOUNT = 5;
    await modal.locator('input[placeholder="0.00"]').fill(String(AMOUNT));
    await modal.getByRole("button", { name: "Confirm Top-Up" }).click();

    await expect(
      page.getByText("Top Up OMT App Drawer", { exact: false }),
    ).toHaveCount(0, { timeout: 10_000 });

    const after = await drawerBalances(page, headers);
    const omtSystemAfter = drawerOf(after, "OMT_System");
    const omtAppAfter = drawerOf(after, "OMT_App");
    const generalAfter = drawerOf(after, "General");

    // The explicit transfer alternative still works — cash actually moves,
    // drawer to drawer — but the OMT Cash Drawer stays out of it entirely.
    expect(omtSystemAfter.usdBalance - omtSystemBefore.usdBalance).toBeCloseTo(
      0,
      2,
    );
    expect(generalAfter.usdBalance - generalBefore.usdBalance).toBeCloseTo(
      -AMOUNT,
      2,
    );
    expect(omtAppAfter.usdBalance - omtAppBefore.usdBalance).toBeCloseTo(
      AMOUNT,
      2,
    );
  });
});
