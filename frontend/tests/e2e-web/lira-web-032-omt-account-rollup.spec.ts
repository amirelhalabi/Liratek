/**
 * lira-web-032 — OMT open-credit account rollup, over REST (LIRA-188,
 * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §1 D1/D6, §5 LIRA-188, §9.3). Web twin of
 * the desktop `lira-188-omt-account-rollup.spec.ts` (L10) — same identity +
 * delta discipline, proving the REST transport (`GET /api/suppliers/
 * account-balances`, `/:id/account-ledger`, `/:id/account-unsettled`) reaches
 * the SAME `SupplierRepository`/`SupplierService` methods the desktop IPC
 * channels call, per rule 19.
 *
 * Domain recap (CONTRACT.md §1): `'OMT'` is the account PARENT; `'OMT App'`
 * (provider `OMT_APP`) and `'iPick'` are CHILDREN, linked via
 * `suppliers.account_supplier_id` (LIRA-187's migration seed). Ledger rows
 * NEVER move — each child keeps writing to its own `supplier_ledger` rows;
 * the account is a read-time rollup (`getAccountBalances`/`getAccountLedger`/
 * `getAccountUnsettled`). `getSupplierBalances` must stop listing children as
 * top-level cards while the parent keeps appearing.
 *
 * Rule 15 (this suite's DB accumulates across every run, single-worker
 * per `playwright.web.config.ts`): every assertion below is either a DELTA
 * (snapshot immediately before the action, compare immediately after — no
 * concurrent writer can interleave in a single-worker suite) or an IDENTITY
 * match on the row just written (never "first/newest row" or absolute
 * totals). The two seeded amounts below (an OMT SEND commission-free, and an
 * iPick supplier-credit top-up) are chosen so their `supplier_ledger` deltas
 * are exactly derivable from source, not just "some positive number":
 *
 *  - OMT SEND, `commission: 0`, no `omtFee` field → `grossOwedDelta`
 *    (`FinancialServiceRepository.ts` — `principal + fee - c`, fee/`c` both
 *    0 here, `commissionModel` is born 1 for OMT) resolves to exactly
 *    `+amount` on the `'OMT'` supplier_ledger row.
 *  - iPick `topUpFromSupplier`, no fee concept at all → exactly `+amount` on
 *    the `'iPick'` supplier_ledger row (`RechargeRepository.ts`).
 *
 * So the rollup identity under test — "the account headline delta equals the
 * sum of its children's deltas" — is checked against known, re-derived
 * numbers, not a vacuous "greater than zero".
 *
 * NOT covered here (out of this lane/ticket): account SETTLEMENT (LIRA-189,
 * wave 2 — explicitly not built this run) and the Suppliers-page card/sub-row
 * RENDER, which is covered lightly at the end via the exact CONTRACT.md §2.9
 * testids, trusting L7's Suppliers-page build to have landed by the time this
 * spec actually runs (not run in this pass — rule 17/L11 instruction).
 */
import type { Page } from "@playwright/test";
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

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

interface AccountLedgerEntry {
  id: number;
  supplier_id: number;
  source_provider: string | null;
  source_name: string;
  entry_type: string;
  amount_usd: number;
  amount_lbp: number;
  note: string | null;
  created_at: string;
  is_refunded: number;
  settlement_id: number | null;
}

interface AccountUnsettledRow {
  kind: "FINANCIAL_SERVICE" | "LEDGER";
  id: number;
  supplier_id: number;
  source_provider: string | null;
  source_name: string;
  created_at: string;
  amount_usd: number;
  amount_lbp: number;
  entry_type: string | null;
  service_type: string | null;
}

async function authHeaders(
  page: Page,
): Promise<{ Authorization: string }> {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  return { Authorization: `Bearer ${token}` };
}

async function getAccountBalances(
  page: Page,
  headers: { Authorization: string },
): Promise<AccountBalance[]> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/suppliers/account-balances`, {
      headers,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r.balances as AccountBalance[];
}

function findOmtAccount(balances: AccountBalance[]): AccountBalance {
  const account = balances.find((a) => a.account_name === "OMT");
  expect(account, JSON.stringify(balances)).toBeTruthy();
  return account!;
}

function childOf(
  account: AccountBalance,
  provider: string,
): AccountChildBalance {
  const child = account.children.find((c) => c.provider === provider);
  expect(child, JSON.stringify(account)).toBeTruthy();
  return child!;
}

test.describe("OMT open-credit account rollup over REST (LIRA-188)", () => {
  test("account headline delta equals the sum of the OMT + iPick sub-row deltas; OMT App untouched", async ({
    page,
  }) => {
    const headers = await authHeaders(page);

    const beforeBalances = await getAccountBalances(page, headers);
    const beforeAccount = findOmtAccount(beforeBalances);
    const beforeOmt = childOf(beforeAccount, "OMT");
    const beforeIpick = childOf(beforeAccount, "iPick");
    const beforeOmtApp = childOf(beforeAccount, "OMT_APP");

    // is_parent + drawer_name wiring (LIRA-187/188): the parent is flagged,
    // each child carries ITS OWN drawer (service_providers.drawer_name join —
    // never a hardcoded map), not the parent's.
    expect(beforeOmt.is_parent).toBe(true);
    expect(beforeIpick.is_parent).toBe(false);
    expect(beforeOmtApp.is_parent).toBe(false);
    expect(beforeOmt.drawer_name).toBe("OMT_System");
    expect(beforeIpick.drawer_name).toBe("iPick");
    expect(beforeOmtApp.drawer_name).toBe("OMT_App");
    expect(beforeAccount.account_supplier_id).toBe(beforeOmt.supplier_id);

    // ── Seed 1: an OMT SEND, commission-free (fee defaults to 0 with no
    // `omtFee` field — FinancialServiceRepository.ts's resolvedProviderFee),
    // so grossOwedDelta resolves to EXACTLY +amount on the 'OMT' ledger. ────
    const OMT_SEND_AMOUNT = 53.75;
    const sendOmt = await (
      await page.request.post(`${BACKEND_URL}/api/services/transactions`, {
        headers,
        data: {
          provider: "OMT",
          serviceType: "SEND",
          amount: OMT_SEND_AMOUNT,
          currency: "USD",
          commission: 0,
          note: `lira-web-032 OMT SEND ${Date.now()}`,
          payments: [
            { method: "CASH", currencyCode: "USD", amount: OMT_SEND_AMOUNT },
          ],
        },
      })
    ).json();
    expect(sendOmt.success, JSON.stringify(sendOmt)).toBeTruthy();

    // ── Seed 2: an iPick supplier-credit top-up — no fee concept, exactly
    // +amount on the 'iPick' ledger. ─────────────────────────────────────
    const IPICK_TOPUP_AMOUNT = 31.2;
    const topUpIpick = await (
      await page.request.post(
        `${BACKEND_URL}/api/recharge/top-up-from-supplier`,
        {
          headers,
          data: {
            provider: "iPick",
            amount: IPICK_TOPUP_AMOUNT,
            currency: "USD",
          },
        },
      )
    ).json();
    expect(topUpIpick.success, JSON.stringify(topUpIpick)).toBeTruthy();

    const afterBalances = await getAccountBalances(page, headers);
    const afterAccount = findOmtAccount(afterBalances);
    const afterOmt = childOf(afterAccount, "OMT");
    const afterIpick = childOf(afterAccount, "iPick");
    const afterOmtApp = childOf(afterAccount, "OMT_APP");

    const omtDelta = afterOmt.total_usd - beforeOmt.total_usd;
    const ipickDelta = afterIpick.total_usd - beforeIpick.total_usd;
    const omtAppDelta = afterOmtApp.total_usd - beforeOmtApp.total_usd;
    const accountDelta = afterAccount.total_usd - beforeAccount.total_usd;

    // Re-derived, not just "positive": the exact formulas above.
    expect(omtDelta).toBeCloseTo(OMT_SEND_AMOUNT, 2);
    expect(ipickDelta).toBeCloseTo(IPICK_TOPUP_AMOUNT, 2);
    // OMT App wasn't touched by either seed this test — its LBP/USD delta
    // must be exactly 0, proving the rollup doesn't leak across siblings.
    expect(omtAppDelta).toBeCloseTo(0, 2);

    // THE headline claim: the account total moves by exactly the sum of its
    // sub-rows' deltas — never re-derived independently, always composed.
    expect(accountDelta).toBeCloseTo(omtDelta + ipickDelta + omtAppDelta, 2);
    expect(accountDelta).toBeCloseTo(OMT_SEND_AMOUNT + IPICK_TOPUP_AMOUNT, 2);

    // LBP side is untouched by either seed (both were USD) — same identity
    // proof in the other currency, cheaply, without a second seed.
    expect(afterAccount.total_lbp - beforeAccount.total_lbp).toBeCloseTo(0, 0);
  });

  test("getSupplierBalances no longer lists OMT App / iPick as top-level cards; the OMT parent still does", async ({
    page,
  }) => {
    const headers = await authHeaders(page);

    const accountBalances = await getAccountBalances(page, headers);
    const account = findOmtAccount(accountBalances);
    const omtId = account.account_supplier_id;
    const ipickId = childOf(account, "iPick").supplier_id;
    const omtAppId = childOf(account, "OMT_APP").supplier_id;

    const topLevel = await (
      await page.request.get(`${BACKEND_URL}/api/suppliers/balances`, {
        headers,
      })
    ).json();
    expect(topLevel.success, JSON.stringify(topLevel)).toBeTruthy();
    const ids = new Set(
      (topLevel.balances as Array<{ supplier_id: number }>).map(
        (b) => b.supplier_id,
      ),
    );

    // LIRA-188: children are excluded from the top-level list (they surface
    // only inside the account's sub-rows above) — the parent is unaffected,
    // still a real top-level supplier row (zero behaviour change for it).
    expect(ids.has(omtId)).toBe(true);
    expect(ids.has(ipickId)).toBe(false);
    expect(ids.has(omtAppId)).toBe(false);
  });

  test("account ledger + unsettled queue union both children with the right Type identity (plan §9.3)", async ({
    page,
  }) => {
    const headers = await authHeaders(page);

    const accountBalances = await getAccountBalances(page, headers);
    const account = findOmtAccount(accountBalances);
    const omtId = account.account_supplier_id;

    const ledgerBefore = await (
      await page.request.get(
        `${BACKEND_URL}/api/suppliers/${omtId}/account-ledger?limit=500`,
        { headers },
      )
    ).json();
    expect(ledgerBefore.success, JSON.stringify(ledgerBefore)).toBeTruthy();
    const ledgerBeforeIds = new Set(
      (ledgerBefore.ledger as AccountLedgerEntry[]).map((l) => l.id),
    );

    const unsettledBefore = await (
      await page.request.get(
        `${BACKEND_URL}/api/suppliers/${omtId}/account-unsettled`,
        { headers },
      )
    ).json();
    expect(
      unsettledBefore.success,
      JSON.stringify(unsettledBefore),
    ).toBeTruthy();
    const unsettledBeforeKey = new Set(
      (unsettledBefore.transactions as AccountUnsettledRow[]).map(
        (u) => `${u.kind}:${u.id}`,
      ),
    );

    // Two run-unique amounts, one per source shape (§9.3): (a) a
    // financial_services row (the OMT SEND) and (b) a raw supplier_ledger
    // row with no settlement batch yet (the iPick top-up).
    const marker = Date.now();
    const OMT_SEND_AMOUNT = 12.34 + (marker % 100) / 1000;
    const sendOmt = await (
      await page.request.post(`${BACKEND_URL}/api/services/transactions`, {
        headers,
        data: {
          provider: "OMT",
          serviceType: "SEND",
          amount: OMT_SEND_AMOUNT,
          currency: "USD",
          commission: 0,
          note: `lira-web-032 union-check ${marker}`,
          payments: [
            { method: "CASH", currencyCode: "USD", amount: OMT_SEND_AMOUNT },
          ],
        },
      })
    ).json();
    expect(sendOmt.success, JSON.stringify(sendOmt)).toBeTruthy();

    const IPICK_TOPUP_AMOUNT = 8.76 + (marker % 100) / 1000;
    const topUpIpick = await (
      await page.request.post(
        `${BACKEND_URL}/api/recharge/top-up-from-supplier`,
        {
          headers,
          data: {
            provider: "iPick",
            amount: IPICK_TOPUP_AMOUNT,
            currency: "USD",
          },
        },
      )
    ).json();
    expect(topUpIpick.success, JSON.stringify(topUpIpick)).toBeTruthy();

    // ── Ledger union: ledger rows never move (plan §2) — each new row still
    // carries the CHILD's own source_name/source_provider, proving the Type
    // column feed is real, not a parent-relabel. ────────────────────────
    const ledgerAfter = await (
      await page.request.get(
        `${BACKEND_URL}/api/suppliers/${omtId}/account-ledger?limit=500`,
        { headers },
      )
    ).json();
    expect(ledgerAfter.success, JSON.stringify(ledgerAfter)).toBeTruthy();
    const newLedgerRows = (ledgerAfter.ledger as AccountLedgerEntry[]).filter(
      (l) => !ledgerBeforeIds.has(l.id),
    );

    const newOmtRow = newLedgerRows.find(
      (l) =>
        l.source_provider === "OMT" &&
        Math.abs(l.amount_usd - OMT_SEND_AMOUNT) < 0.01,
    );
    expect(newOmtRow, JSON.stringify(newLedgerRows)).toBeTruthy();
    expect(newOmtRow!.source_name).toBe("OMT");
    expect(newOmtRow!.entry_type).toBe("TOP_UP");

    const newIpickRow = newLedgerRows.find(
      (l) =>
        l.source_provider === "iPick" &&
        Math.abs(l.amount_usd - IPICK_TOPUP_AMOUNT) < 0.01,
    );
    expect(newIpickRow, JSON.stringify(newLedgerRows)).toBeTruthy();
    expect(newIpickRow!.source_name).toBe("iPick");
    expect(newIpickRow!.entry_type).toBe("TOP_UP");

    // ── Unsettled union: the OMT SEND surfaces via the financial_services
    // arm (kind FINANCIAL_SERVICE); the iPick top-up has no
    // financial_services row at all — it surfaces via the raw
    // supplier_ledger arm (kind LEDGER). Two structurally different sources,
    // one merged queue (plan §9.3). ──────────────────────────────────────
    const unsettledAfter = await (
      await page.request.get(
        `${BACKEND_URL}/api/suppliers/${omtId}/account-unsettled`,
        { headers },
      )
    ).json();
    expect(
      unsettledAfter.success,
      JSON.stringify(unsettledAfter),
    ).toBeTruthy();
    const newUnsettled = (
      unsettledAfter.transactions as AccountUnsettledRow[]
    ).filter((u) => !unsettledBeforeKey.has(`${u.kind}:${u.id}`));

    const newOmtUnsettled = newUnsettled.find(
      (u) =>
        u.kind === "FINANCIAL_SERVICE" &&
        u.source_provider === "OMT" &&
        Math.abs(u.amount_usd - OMT_SEND_AMOUNT) < 0.01,
    );
    expect(newOmtUnsettled, JSON.stringify(newUnsettled)).toBeTruthy();

    const newIpickUnsettled = newUnsettled.find(
      (u) =>
        u.kind === "LEDGER" &&
        u.source_provider === "iPick" &&
        Math.abs(u.amount_usd - IPICK_TOPUP_AMOUNT) < 0.01,
    );
    expect(newIpickUnsettled, JSON.stringify(newUnsettled)).toBeTruthy();
  });

  // ── Light real-UI smoke check (CONTRACT.md §2.9 testids). L7 (the
  // Suppliers-page account card/sub-rows) is a separate, parallel lane; this
  // check trusts it has landed by the time the suite actually runs (rule 17 —
  // not run in this authoring pass). Kept deliberately thin: the REST tests
  // above already prove the data is correct, so this only proves the page
  // renders it, not the arithmetic again. ──────────────────────────────────
  test("Suppliers page renders the OMT account card + sub-rows with the exact testids", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/#/suppliers");
    await page.waitForTimeout(1_500);
    await expect(page.locator("#root")).not.toContainText(
      "Something went wrong",
    );

    const card = page.getByTestId("supplier-account-card-OMT");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("supplier-account-balance-usd")).toBeVisible();
    await expect(card.getByTestId("supplier-account-balance-lbp")).toBeVisible();

    for (const key of ["OMT", "OMT_APP", "iPick"]) {
      const subrow = card.getByTestId(`supplier-account-subrow-${key}`);
      await expect(subrow).toBeVisible();
      await expect(
        subrow.getByTestId(`supplier-account-subrow-balance-${key}`),
      ).toBeVisible();
    }

    // The merged ledger's Type filter only renders once the account PARENT
    // is selected (AccountLedgerTable's own doc comment:
    // `isSelectedAccountParent`) — select it via the card header first.
    await card.getByTestId("supplier-tile-OMT").click();
    await page.waitForTimeout(500);
    await expect(page.getByTestId("supplier-ledger-type-filter")).toBeVisible();
  });
});
