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
 * `payments[]`) and the role-parity gate Phase 0b added to this exact route
 * (`requireRole(["admin"])`, matching the IPC twin) — re-asserted here
 * because Phase 6 turned this same route into a cash-payout endpoint, the
 * highest-stakes moment for a role-escalation regression to slip in
 * unnoticed for a NEW type specifically. It should already pass (no
 * type-specific bypass exists), but the assertion costs nothing.
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
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
// Same import global-setup.ts already uses — no dual-ABI mock concern here:
// this suite runs under the Node ABI (rule "the two ABIs are mutually
// exclusive, hence rebuild:node before ... web e2e").
import Database from "better-sqlite3";
import { hashPassword } from "@liratek/core";
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";
import type { Page } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Mirrors global-setup.ts's own path resolution exactly — same DB file,
// this spec file lives in the same directory.
const DB_PATH = path.join(
  __dirname,
  "..",
  "..",
  "test-results",
  "e2e-web",
  "phone_shop.web.db",
);

const STAFF_USERNAME = "e2e019staff";
const STAFF_PASSWORD = "E2e019Staff!1";

/**
 * Seed (idempotently) a REAL `staff`-role user directly in the shared test
 * DB — mirrors global-setup.ts's own admin-password bootstrap.
 *
 * Why not go over REST: `POST /api/users` (backend/src/api/users.ts) is an
 * unfinished placeholder — it validates the body, logs, and returns
 * `{success:true,id:1}` without writing a row, so it cannot create a
 * logically-real staff account. And `authenticateJWT` requires a live DB
 * `sessions` row behind the JWT's `sessionToken` (backend/src/middleware/
 * auth.ts), so a self-signed token (even with the correct role claim and
 * the right `JWT_SECRET`) is rejected the same way a stale one is — there
 * is no way to prove this route's role gate without a REAL login. The
 * backend jest suite's `x-test-role` header (recharge.api.test.ts) is not a
 * usable shortcut either: it only exists inside that suite's own
 * `jest.mock("../../middleware/auth.js")`, never wired into the real
 * Express app this e2e suite drives.
 */
function seedStaffUser(): void {
  const db = new Database(DB_PATH);
  try {
    db.prepare(
      `INSERT OR IGNORE INTO users (tenant_id, username, password_hash, role, is_active)
       VALUES (1, ?, ?, 'staff', 1)`,
    ).run(STAFF_USERNAME, hashPassword(STAFF_PASSWORD));
    // INSERT OR IGNORE no-ops against the accumulating DB on every run after
    // the first — force the password/role/active state unconditionally so
    // this spec never depends on what a PRIOR run happened to leave behind.
    db.prepare(
      `UPDATE users SET password_hash = ?, role = 'staff', is_active = 1 WHERE username = ?`,
    ).run(hashPassword(STAFF_PASSWORD), STAFF_USERNAME);
  } finally {
    db.close();
  }
}

async function loginHeaders(
  page: Page,
  username: string,
  password: string,
): Promise<Record<string, string>> {
  const res = await (
    await page.request.post(`${BACKEND_URL}/api/auth/login`, {
      data: { username, password },
    })
  ).json();
  expect(res.success, JSON.stringify(res)).toBeTruthy();
  return { Authorization: `Bearer ${res.data.token as string}` };
}

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

  test("(c) a staff-role JWT is refused on /process (role parity, Phase 0b)", async ({
    page,
  }) => {
    seedStaffUser();
    const headers = await loginHeaders(page, STAFF_USERNAME, STAFF_PASSWORD);

    const res = await page.request.post(`${BACKEND_URL}/api/recharge/process`, {
      headers,
      data: {
        provider: "MTC",
        type: "CREDIT_BUYBACK",
        amount: 5,
        price: 100_000,
        currency: "LBP",
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 100_000 }],
      },
    });

    // requireRole(["admin"]) (backend/src/middleware/auth.ts) — 403, no
    // `success` envelope at this layer (matches the middleware's existing,
    // pre-Phase-6 shape; not something this plan changes).
    expect(res.status()).toBe(403);
  });
});
