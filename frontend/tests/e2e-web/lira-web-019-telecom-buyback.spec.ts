/**
 * lira-web-019 — CARRIER_LINES_VALIDITY_PLAN.md Phase 6, over REST.
 *
 * Proves `POST /api/recharge/process`'s `CREDIT_BUYBACK` path end-to-end on
 * the web transport: a split CASH + CUSTOMER_ACCOUNT payout moves both the
 * General drawer and the client's account balance, and lands credits on the
 * shop's primary carrier line. This only survives `validateRequest`'s
 * Zod-strip because of Phase 6a's schema consolidation (`payments[]` lives in
 * `createRechargeSchema` now, not a REST-only copy missing it) — see that
 * phase's own guard, `backend/src/api/__tests__/recharge.api.test.ts`.
 *
 * Also covers the hard-reject `processCreditBuyback` owns itself (empty
 * `payments[]`).
 *
 * LIRA-242 (owner decision 2026-09-28) UPDATE: test (c) below used to assert
 * that a staff-role JWT was REFUSED on this route (Phase 0b's
 * `requireRole(["admin"])`). The owner has since decided staff MAY process
 * MTC/Alfa recharges — the ordinary sale flow a cashier does — and
 * CREDIT_BUYBACK shares this SAME `/process` route (only the `type` field
 * distinguishes it), so it opened to staff too. (c) now asserts the OPPOSITE:
 * staff CAN process a buy-back here. See
 * `backend/src/api/__tests__/recharge.api.test.ts`'s own staff-success guard
 * for the role-parity fix on the plain (non-buyback) sale body.
 *
 * Rule 15: identity via a freshly created client + carrier line (never a
 * prior spec's row), deltas snapshotted immediately before the action.
 *
 * Rule 17 (NOT YET RUN — flagged for the orchestrating session, which runs
 * `yarn test:e2e:web`, out of scope for this pass): test (a) is a guard only
 * once shown failing against the pre-Phase-6a schema (re-add the local
 * REST-only recharge schema without `payments[]`/`CREDIT_BUYBACK` and this
 * split-leg payout should either 400 at the Zod layer or silently fall into
 * the legacy single-method fallback, moving the wrong drawer by the wrong
 * amount). Revert after confirming.
 *
 * Fix round 1 (major, issue no-e2e-case2): tests (d)/(e) added — owner note
 * #21 case 2 (LIRA-088, migration v182), `SHOP_LINE_USE`, over REST. Also
 * NOT YET RUN. (d) is a guard once shown failing against the pre-fix code by
 * temporarily reverting the `isShopOwnLine`-gated `SHOP_LINE_USE` branch in
 * `RechargeRepository.processRecharge` back to falling through to the
 * ordinary CREDIT_TRANSFER-shaped body with no type distinction — the
 * SMS-expense-count assertion would then fail. (e)'s rejection is guarded by
 * reverting the same guard entirely (the call would then succeed against an
 * arbitrary phone number).
 */
import {
  test,
  expect,
  loginAsAdmin,
  seedStaffUser,
  staffHeaders,
  BACKEND_URL,
} from "./fixtures";
import type { Page } from "@playwright/test";

const STAFF_USERNAME = "e2e019staff";
const STAFF_PASSWORD = "E2e019Staff!1";

async function drawers(
  page: Page,
  headers: Record<string, string>,
): Promise<{ generalUsd: number; generalLbp: number }> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, {
      headers,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return {
    generalUsd: r.balances.generalDrawer.usd as number,
    generalLbp: r.balances.generalDrawer.lbp as number,
  };
}

async function clientBalanceLbp(
  page: Page,
  headers: Record<string, string>,
  clientId: number,
): Promise<number> {
  const r = await (
    await page.request.get(
      `${BACKEND_URL}/api/debts/clients/${clientId}/balance`,
      { headers },
    )
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return (r.data.balance_lbp ?? 0) as number;
}

async function primaryMtcCredits(
  page: Page,
  headers: Record<string, string>,
): Promise<number> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/carrier-lines/primary/mtc`, {
      headers,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r.data.credits as number;
}

async function todayExpenseCount(
  page: Page,
  headers: Record<string, string>,
): Promise<number> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/expenses/today`, { headers })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return (r.expenses ?? []).length as number;
}

test.describe("Telecom credit buy-back over REST (CARRIER_LINES_VALIDITY_PLAN.md Phase 6)", () => {
  test("(a) split CASH + CUSTOMER_ACCOUNT payout moves the General drawer, the client's account, and the primary carrier line", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const adminToken = await page.evaluate(() =>
      localStorage.getItem("liratek.jwt"),
    );
    const headers = { Authorization: `Bearer ${adminToken}` };

    // A fresh primary MTC line (admin-only create + set-primary).
    const phone = `03${Date.now().toString().slice(-6)}`;
    const created = await (
      await page.request.post(`${BACKEND_URL}/api/carrier-lines`, {
        headers,
        data: { carrier: "mtc", phone_number: phone, credits: 20 },
      })
    ).json();
    expect(created.success, JSON.stringify(created)).toBeTruthy();
    const lineId = created.data.id as number;
    const setPrimary = await (
      await page.request.put(
        `${BACKEND_URL}/api/carrier-lines/${lineId}/set-primary`,
        { headers },
      )
    ).json();
    expect(setPrimary.success, JSON.stringify(setPrimary)).toBeTruthy();

    // A client to receive the CUSTOMER_ACCOUNT leg.
    const client = await (
      await page.request.post(`${BACKEND_URL}/api/clients`, {
        headers,
        data: {
          full_name: `L019 Client ${Date.now()}`,
          phone_number: "03777888",
        },
      })
    ).json();
    const clientId = (client.data?.id ?? client.id) as number;
    expect(clientId).toBeTruthy();

    const before = {
      d: await drawers(page, headers),
      c: await clientBalanceLbp(page, headers, clientId),
      credits: await primaryMtcCredits(page, headers),
    };

    const CREDITS = 9.5;
    const CASH_LEG = 200_000;
    const ACCOUNT_LEG = 100_000;

    const res = await (
      await page.request.post(`${BACKEND_URL}/api/recharge/process`, {
        headers,
        data: {
          provider: "MTC",
          type: "CREDIT_BUYBACK",
          amount: CREDITS,
          price: CASH_LEG + ACCOUNT_LEG,
          currency: "LBP",
          clientId,
          payments: [
            { method: "CASH", currencyCode: "LBP", amount: CASH_LEG },
            {
              method: "CUSTOMER_ACCOUNT",
              currencyCode: "LBP",
              amount: ACCOUNT_LEG,
            },
          ],
        },
      })
    ).json();
    expect(res.success, JSON.stringify(res)).toBeTruthy();

    const after = {
      d: await drawers(page, headers),
      c: await clientBalanceLbp(page, headers, clientId),
      credits: await primaryMtcCredits(page, headers),
    };

    // CASH leg debits General LBP (paymentMethodToDrawerName("CASH") =
    // "General" — moneyPosting.ts's postPayoutLegs posts `-legAmount`).
    expect(after.d.generalLbp - before.d.generalLbp).toBeCloseTo(-CASH_LEG, 0);
    expect(after.d.generalUsd - before.d.generalUsd).toBeCloseTo(0, 2);
    // CUSTOMER_ACCOUNT leg credits the client's account — the shop owes the
    // customer more, so the balance moves DOWN (same sign convention
    // lira-web-011 pins for DebtService.addCredit).
    expect(after.c - before.c).toBeCloseTo(-ACCOUNT_LEG, 0);
    // The credits landed on the shop's own primary line (D9: this route
    // never moves validity — no cheap REST read exists to assert that zero
    // here, so it is asserted only by the repository's own unit test).
    expect(after.credits - before.credits).toBeCloseTo(CREDITS, 2);
  });

  test("(b) an empty payments[] hard-rejects with no drawer movement", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const token = await page.evaluate(() =>
      localStorage.getItem("liratek.jwt"),
    );
    const headers = { Authorization: `Bearer ${token}` };

    const before = await drawers(page, headers);

    const res = await (
      await page.request.post(`${BACKEND_URL}/api/recharge/process`, {
        headers,
        data: {
          provider: "MTC",
          type: "CREDIT_BUYBACK",
          amount: 5,
          price: 100_000,
          currency: "LBP",
          payments: [],
        },
      })
    ).json();

    // The repository's own guard (RechargeRepository.processCreditBuyback),
    // not a Zod refine — HTTP 200 with a string `error`, matching the IPC
    // envelope convention (rule 19c).
    expect(res.success).toBe(false);
    expect(res.error as string).toContain("Payment legs are required");

    const after = await drawers(page, headers);
    expect(after.generalLbp - before.generalLbp).toBeCloseTo(0, 0);
    expect(after.generalUsd - before.generalUsd).toBeCloseTo(0, 2);
  });

  test("(c) a staff-role JWT CAN process a buy-back on /process (LIRA-242, owner decision 2026-09-28: staff may do recharge sales, and CREDIT_BUYBACK shares this same route)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const adminToken = await page.evaluate(() =>
      localStorage.getItem("liratek.jwt"),
    );
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };

    // A fresh primary MTC line (admin-only create + set-primary — unaffected
    // by LIRA-242, which only widens /process itself).
    const phone = `03${Date.now().toString().slice(-6)}`;
    const created = await (
      await page.request.post(`${BACKEND_URL}/api/carrier-lines`, {
        headers: adminHeaders,
        data: { carrier: "mtc", phone_number: phone, credits: 20 },
      })
    ).json();
    expect(created.success, JSON.stringify(created)).toBeTruthy();
    const lineId = created.data.id as number;
    const setPrimary = await (
      await page.request.put(
        `${BACKEND_URL}/api/carrier-lines/${lineId}/set-primary`,
        { headers: adminHeaders },
      )
    ).json();
    expect(setPrimary.success, JSON.stringify(setPrimary)).toBeTruthy();

    seedStaffUser(STAFF_USERNAME, STAFF_PASSWORD);
    const headers = await staffHeaders(page, STAFF_USERNAME, STAFF_PASSWORD);

    const before = await drawers(page, headers);

    const res = await (
      await page.request.post(`${BACKEND_URL}/api/recharge/process`, {
        headers,
        data: {
          provider: "MTC",
          type: "CREDIT_BUYBACK",
          amount: 5,
          price: 100_000,
          currency: "LBP",
          payments: [{ method: "CASH", currencyCode: "LBP", amount: 100_000 }],
        },
      })
    ).json();

    // LIRA-242: this is the ONE line that flipped from the old "(c) staff
    // is refused" (403, no envelope) test — see git history for the pre-fix
    // assertion, proven failing per rule 17 in
    // backend/src/api/__tests__/recharge.api.test.ts's own guard.
    expect(res.success, JSON.stringify(res)).toBeTruthy();

    const after = await drawers(page, headers);
    // CASH leg debits General LBP (paymentMethodToDrawerName("CASH") =
    // "General" — moneyPosting.ts's postPayoutLegs posts `-legAmount`),
    // mirroring test (a)'s own drawer-delta assertion above.
    expect(after.generalLbp - before.generalLbp).toBeCloseTo(-100_000, 0);
  });

  /**
   * Fix round 1 (major, issue no-e2e-case2) — owner note #21 case 2
   * (LIRA-088, migration v182), proven over REST. `SHOP_LINE_USE` reuses
   * the ordinary (non-buy-back) `processRecharge` sale body, so unlike (a)
   * above this is cash IN, credits still land on the PRIMARY line, and NO
   * SMS_Transfer_Fee expense is booked (the SMS gate is
   * `type === "CREDIT_TRANSFER"` only).
   */
  test("(d) SHOP_LINE_USE books cash IN, decrements the primary line, and books no SMS expense", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const adminToken = await page.evaluate(() =>
      localStorage.getItem("liratek.jwt"),
    );
    const headers = { Authorization: `Bearer ${adminToken}` };

    const phone = `03${Date.now().toString().slice(-6)}`;
    const created = await (
      await page.request.post(`${BACKEND_URL}/api/carrier-lines`, {
        headers,
        data: { carrier: "mtc", phone_number: phone, credits: 20 },
      })
    ).json();
    expect(created.success, JSON.stringify(created)).toBeTruthy();
    const lineId = created.data.id as number;
    const setPrimary = await (
      await page.request.put(
        `${BACKEND_URL}/api/carrier-lines/${lineId}/set-primary`,
        { headers },
      )
    ).json();
    expect(setPrimary.success, JSON.stringify(setPrimary)).toBeTruthy();

    const before = {
      d: await drawers(page, headers),
      credits: await primaryMtcCredits(page, headers),
      expenseCount: await todayExpenseCount(page, headers),
    };

    const CREDITS = 6.5;
    const PRICE_LBP = 585_000;

    const res = await (
      await page.request.post(`${BACKEND_URL}/api/recharge/process`, {
        headers,
        data: {
          provider: "MTC",
          type: "SHOP_LINE_USE",
          amount: CREDITS,
          cost: CREDITS * 85_000,
          price: PRICE_LBP,
          currency: "LBP",
          phoneNumber: phone,
          payments: [
            { method: "CASH", currencyCode: "LBP", amount: PRICE_LBP },
          ],
        },
      })
    ).json();
    expect(res.success, JSON.stringify(res)).toBeTruthy();

    const after = {
      d: await drawers(page, headers),
      credits: await primaryMtcCredits(page, headers),
      expenseCount: await todayExpenseCount(page, headers),
    };

    // Cash IN (opposite sign from case 1's payout in test (a) above).
    expect(after.d.generalLbp - before.d.generalLbp).toBeCloseTo(
      PRICE_LBP,
      0,
    );
    expect(after.credits - before.credits).toBeCloseTo(-CREDITS, 2);
    expect(after.expenseCount).toBe(before.expenseCount);
  });

  /**
   * Fix round 1 companion to (d): the server-side re-check
   * (`isShopOwnLine`, mirroring `processCreditBuyback`'s own) rejects a
   * SHOP_LINE_USE whose phone number is NOT one of the shop's active
   * lines — proves a direct REST caller cannot sell credits with no SMS fee
   * against an arbitrary walk-in number just by choosing this type.
   */
  test("(e) SHOP_LINE_USE rejects a phone number that isn't a shop line", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const adminToken = await page.evaluate(() =>
      localStorage.getItem("liratek.jwt"),
    );
    const headers = { Authorization: `Bearer ${adminToken}` };

    const before = await drawers(page, headers);

    const res = await (
      await page.request.post(`${BACKEND_URL}/api/recharge/process`, {
        headers,
        data: {
          provider: "MTC",
          type: "SHOP_LINE_USE",
          amount: 3,
          cost: 3 * 85_000,
          price: 270_000,
          currency: "LBP",
          phoneNumber: "70999999",
          payments: [
            { method: "CASH", currencyCode: "LBP", amount: 270_000 },
          ],
        },
      })
    ).json();
    expect(res.success).toBe(false);
    expect(res.error as string).toMatch(/shop's active/i);

    const after = await drawers(page, headers);
    expect(after.generalLbp - before.generalLbp).toBeCloseTo(0, 0);
  });
});
