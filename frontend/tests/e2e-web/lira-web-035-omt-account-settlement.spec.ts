/**
 * lira-web-035 — OMT open-credit account SETTLEMENT, over REST + the real
 * browser UI (LIRA-189, CONTRACT_W2.md §1/§2, OMT_OPEN_CREDIT_ACCOUNT_PLAN.md
 * §5 LIRA-189, §8.4, §9.2-§9.4, §10). Web twin of the desktop
 * `lira-189-omt-account-settlement.spec.ts` (lane W7) — same identity + delta
 * discipline, proving `POST /api/suppliers/:id/settle-account` (lane W5)
 * reaches the SAME `SupplierRepository.settleAccount` (lane W1) the desktop
 * IPC channel `suppliers:settle-account` calls, per rule 19.
 *
 * This is the highest-risk spec of the epic: settlement is the one flow that
 * both moves real cash (D3: a CASH leg resolves to the OMT Cash Drawer,
 * `OMT_System`, via the existing `resolveServiceCashDrawer`) AND writes N
 * `supplier_ledger` rows — one per child touched — under a single
 * `SUPPLIER_SETTLEMENT` transaction (CONTRACT_W2.md §1 "Per-child rows" /
 * §9.4). Per-lane split (this file is W8, REST/UI only):
 *  - W1 (`SupplierRepository.accountSettlement.test.ts`) owns the exhaustive
 *    money-correctness matrix, INCLUDING the create+void-nets-to-0 proof
 *    (rule 17/20). That proof is deliberately NOT duplicated here — it is a
 *    jest-level guarantee, not something this REST/UI layer can add
 *    confidence to beyond what W1 already covers.
 *  - W2 (`TransactionRepository.accountSettlementReversal.test.ts`) owns the
 *    reversal mechanics.
 *  - This file's job (contract's exact W8 coverage list) is the LAYER-SEAM
 *    proof: the REST transport reaches the real core, AND (lightly, since
 *    lane W6's sheet is a parallel, not-yet-landed build this pass) the real
 *    settlement sheet's OWN allocation arithmetic — a hand-built REST payload
 *    cannot catch a bug in the frontend's selection/net-total logic.
 *
 * Four scenarios, covering the contract's W8 bullet list exactly:
 *  1. A mixed account (iPick + OMT App, TWO children, NO debt on the OMT
 *     parent itself) settles in one PAY, every selected row nets to 0, and
 *     the OMT Cash Drawer falls by exactly the cash leg. This also happens
 *     to be the "parent has no debt of its own" edge case
 *     (CONTRACT_W2.md §1.1's third constraint) — chosen deliberately so one
 *     seed proves both facts instead of two separate ones.
 *  2. A cash-out-only selection (no offsetting debt) is NET NEGATIVE — OMT
 *     owes the shop — and settles via COLLECT (cash INTO the OMT Cash
 *     Drawer), and the settlement stamps the cash-out's DEFERRED commission
 *     (D14, plan §8.3a/§10.2 — stored in `transactions.metadata_json.
 *     commission`, no column) as `profit_usd`, summed automatically, never
 *     operator-entered.
 *  3. Security: the server re-validates every selected id against the
 *     account's own membership predicate (D8) — a ledger row belonging to an
 *     unrelated, non-OMT supplier is rejected, not silently trusted.
 *  4. A thin real-UI pass over the EXACT testids fixed in CONTRACT_W2.md
 *     §2.3: opens the real sheet, proves a row's toggle changes the selected
 *     total by exactly that row's own amount (works whether the row started
 *     pre-selected or not — D8's "oldest pre-selected, admin can change it"
 *     — without this spec having to reproduce the pre-selection ordering
 *     itself), and a real submit reaches the same core mutation the REST
 *     tests above already proved. The payment-leg inputs are NOT in
 *     CONTRACT_W2.md's fixed testid list (only the selection/direction/
 *     total/submit controls are); this spec reuses the `payment-amount-`/
 *     `payment-currency-` prefix convention the EXISTING settle-batch sheet
 *     already uses (`Suppliers.settleNetPayCurrency.test.tsx`), on the
 *     working assumption lane W6 reuses the same `MultiPaymentInput` family
 *     for this new sheet rather than inventing a second one — flagged here
 *     so a future reader can fix this one assumption fast if W6 diverges.
 *
 * Rule 15 (this suite's DB accumulates across every run, single-worker per
 * `playwright.web.config.ts`): every assertion is either a DELTA (snapshot
 * immediately before the action under test, compare immediately after) or an
 * IDENTITY match on a row/transaction just created via a run-unique amount —
 * never "newest row" or an absolute total. All four scenarios are kept in
 * USD only: LBP parity for the underlying top-up/cash-out primitives is
 * already proven in lira-web-033/lira-web-034, and per-currency settlement
 * math is W1's jest matrix — duplicating it here would not add confidence,
 * only runtime (rule 14 in spirit: don't re-prove what's proven elsewhere).
 *
 * NOT RUN in this pass (contract instruction) — this spec is authored
 * against CONTRACT_W2.md's FIXED names only; every place it must additionally
 * guess at unfixed UI structure is called out in a comment at that call site.
 */
import type { Page } from "@playwright/test";
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

async function authHeaders(page: Page): Promise<{ Authorization: string }> {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  return { Authorization: `Bearer ${token}` };
}

// ── Drawer balances (OMT_System = the OMT Cash Drawer / PCD, D2/D3). ────────
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

// ── Account rollup (LIRA-188). ──────────────────────────────────────────────
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
async function omtAccount(
  page: Page,
  headers: { Authorization: string },
): Promise<AccountBalance> {
  const balances = await getAccountBalances(page, headers);
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

// ── Unsettled queue + ledger (plan §9.3 / §1.1 settled-marking). ───────────
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
async function getAccountUnsettled(
  page: Page,
  headers: { Authorization: string },
  accountSupplierId: number,
): Promise<AccountUnsettledRow[]> {
  const r = await (
    await page.request.get(
      `${BACKEND_URL}/api/suppliers/${accountSupplierId}/account-unsettled`,
      { headers },
    )
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r.transactions as AccountUnsettledRow[];
}

interface AccountLedgerEntry {
  id: number;
  supplier_id: number;
  source_provider: string | null;
  entry_type: string;
  amount_usd: number;
  amount_lbp: number;
  settlement_id: number | null;
}
async function getAccountLedger(
  page: Page,
  headers: { Authorization: string },
  accountSupplierId: number,
): Promise<AccountLedgerEntry[]> {
  const r = await (
    await page.request.get(
      `${BACKEND_URL}/api/suppliers/${accountSupplierId}/account-ledger?limit=500`,
      { headers },
    )
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r.ledger as AccountLedgerEntry[];
}

function findUnsettled(
  rows: AccountUnsettledRow[],
  provider: string,
  entryType: string | null,
  amountUsd: number,
): AccountUnsettledRow {
  const row = rows.find(
    (r) =>
      r.source_provider === provider &&
      r.entry_type === entryType &&
      Math.abs(r.amount_usd - amountUsd) < 0.01,
  );
  expect(
    row,
    `Unsettled row not found: provider=${provider} entry_type=${entryType} amount_usd=${amountUsd} in ${JSON.stringify(rows)}`,
  ).toBeTruthy();
  return row!;
}

// ── The settlement transaction itself. ─────────────────────────────────────
interface SettlementTxn {
  id: number;
  type: string;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  status: string;
}
async function findSettlementTxns(
  page: Page,
  headers: { Authorization: string },
  amountUsd: number,
): Promise<SettlementTxn[]> {
  const r = await (
    await page.request.get(
      `${BACKEND_URL}/api/transactions/recent?type=SUPPLIER_SETTLEMENT&limit=300`,
      { headers },
    )
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return (r.transactions as SettlementTxn[]).filter(
    (t) => Math.abs(t.amount_usd - amountUsd) < 0.01,
  );
}

/** `packages/core/src/constants/omtAppCashout.ts` — D13's 0.1%, USD 2dp
 *  rounding. Mirrors lira-web-034's own local copy (never fed back into the
 *  app — used only to compute THIS spec's own expectation). */
function expectedCashoutCommissionUsd(amount: number): number {
  return Math.round(amount * 0.001 * 100) / 100;
}

/** Strip currency symbols/commas/labels from a rendered money string. */
function parseMoneyText(text: string): number {
  const match = text.replace(/,/g, "").match(/-?[\d.]+/);
  return match ? parseFloat(match[0]) : NaN;
}

const settleAccountUrl = (accountSupplierId: number): string =>
  `${BACKEND_URL}/api/suppliers/${accountSupplierId}/settle-account`;

test.describe("OMT open-credit account settlement over REST (LIRA-189)", () => {
  test("a two-child batch with NO debt on the OMT parent settles in one PAY: both rows net to 0, one SUPPLIER_SETTLEMENT transaction, and the OMT Cash Drawer falls by exactly the cash leg (D3)", async ({
    page,
  }) => {
    const headers = await authHeaders(page);
    const marker = Date.now();
    // Run-unique, non-round amounts so this batch's combined total can never
    // collide with another run's settlement (identity via amount match).
    const IPICK_AMOUNT = Number((14.11 + (marker % 733) / 1000).toFixed(3));
    const OMTAPP_AMOUNT = Number((9.27 + (marker % 611) / 1000).toFixed(3));
    const TOTAL = Number((IPICK_AMOUNT + OMTAPP_AMOUNT).toFixed(2));

    const account = await omtAccount(page, headers);
    const omtId = account.account_supplier_id;

    const omtSystemBefore = drawerOf(
      await drawerBalances(page, headers),
      "OMT_System",
    );
    const ipickChildBefore = childOf(
      await omtAccount(page, headers),
      "iPick",
    );
    const omtAppChildBefore = childOf(
      await omtAccount(page, headers),
      "OMT_APP",
    );

    // ── Seed: iPick top-up debt + OMT App credit top-up debt — TWO children,
    // ZERO debt on the OMT counter itself (the parent). ────────────────────
    const ipickSeed = await (
      await page.request.post(
        `${BACKEND_URL}/api/recharge/top-up-from-supplier`,
        {
          headers,
          data: { provider: "iPick", amount: IPICK_AMOUNT, currency: "USD" },
        },
      )
    ).json();
    expect(ipickSeed.success, JSON.stringify(ipickSeed)).toBeTruthy();

    const omtAppSeed = await (
      await page.request.post(
        `${BACKEND_URL}/api/recharge/top-up-from-supplier`,
        {
          headers,
          data: {
            provider: "OMT_APP",
            amount: OMTAPP_AMOUNT,
            currency: "USD",
          },
        },
      )
    ).json();
    expect(omtAppSeed.success, JSON.stringify(omtAppSeed)).toBeTruthy();

    const unsettled = await getAccountUnsettled(page, headers, omtId);
    const ipickRow = findUnsettled(unsettled, "iPick", "TOP_UP", IPICK_AMOUNT);
    const omtAppRow = findUnsettled(
      unsettled,
      "OMT_APP",
      "TOP_UP",
      OMTAPP_AMOUNT,
    );

    // ── Settle exactly these two rows, PAY, one CASH leg. ──────────────────
    const settled = await (
      await page.request.post(settleAccountUrl(omtId), {
        headers,
        data: {
          account_supplier_id: omtId,
          direction: "PAY",
          selections: [
            { kind: ipickRow.kind, id: ipickRow.id },
            { kind: omtAppRow.kind, id: omtAppRow.id },
          ],
          amount_usd: TOTAL,
          amount_lbp: 0,
          commission_usd: 0,
          commission_lbp: 0,
          note: `lira-web-035 mixed no-parent-debt ${marker}`,
          created_by: 1,
          payments: [{ method: "CASH", currency_code: "USD", amount: TOTAL }],
        },
      })
    ).json();
    expect(settled.success, JSON.stringify(settled)).toBeTruthy();
    expect(settled.id, JSON.stringify(settled)).toBeTruthy();

    // ── §1.1 mechanism: both rows are findable and stamped from the ONE
    // settlement — same `settlement_id`, whatever value W1 chose for it. ───
    const ledgerAfter = await getAccountLedger(page, headers, omtId);
    const ipickLedgerAfter = ledgerAfter.find((l) => l.id === ipickRow.id);
    const omtAppLedgerAfter = ledgerAfter.find((l) => l.id === omtAppRow.id);
    expect(ipickLedgerAfter?.settlement_id, "iPick row not stamped settled").toBeTruthy();
    expect(
      omtAppLedgerAfter?.settlement_id,
      "OMT App row not stamped settled",
    ).toBeTruthy();
    expect(omtAppLedgerAfter?.settlement_id).toBe(
      ipickLedgerAfter?.settlement_id,
    );
    // Rows never move (plan §2) — the raw amounts are untouched by settling.
    expect(ipickLedgerAfter?.amount_usd).toBeCloseTo(IPICK_AMOUNT, 3);
    expect(omtAppLedgerAfter?.amount_usd).toBeCloseTo(OMTAPP_AMOUNT, 3);

    // Both rows leave the open unsettled queue.
    const unsettledAfter = await getAccountUnsettled(page, headers, omtId);
    expect(unsettledAfter.some((r) => r.id === ipickRow.id && r.kind === "LEDGER")).toBe(
      false,
    );
    expect(
      unsettledAfter.some((r) => r.id === omtAppRow.id && r.kind === "LEDGER"),
    ).toBe(false);

    // ── Per-child nets: EACH child's contribution returns to exactly its
    // pre-seed balance — the debt this test created was fully paid off,
    // individually, not just "the batch total is 0" (CONTRACT_W2.md §1). ──
    const ipickChildAfter = childOf(await omtAccount(page, headers), "iPick");
    const omtAppChildAfter = childOf(
      await omtAccount(page, headers),
      "OMT_APP",
    );
    expect(ipickChildAfter.total_usd - ipickChildBefore.total_usd).toBeCloseTo(
      0,
      2,
    );
    expect(
      omtAppChildAfter.total_usd - omtAppChildBefore.total_usd,
    ).toBeCloseTo(0, 2);

    // ── D3: the ONLY cash-moving step in this whole scenario is the
    // settlement's CASH leg — it lands on the OMT Cash Drawer, not General,
    // even though neither child's OWN drawer is `OMT_System`. ─────────────
    const omtSystemAfter = drawerOf(
      await drawerBalances(page, headers),
      "OMT_System",
    );
    expect(omtSystemAfter.usdBalance - omtSystemBefore.usdBalance).toBeCloseTo(
      -TOTAL,
      2,
    );

    // ── Exactly ONE SUPPLIER_SETTLEMENT transaction for this exact total
    // (run-unique, so no earlier run's settlement can collide). ────────────
    const txns = await findSettlementTxns(page, headers, TOTAL);
    expect(txns, JSON.stringify(txns)).toHaveLength(1);
    expect(txns[0].status).toBe("ACTIVE");
  });

  test("a cash-out-only selection is NET NEGATIVE and settles via COLLECT: cash flows INTO the OMT Cash Drawer, the row nets to 0, and the deferred cash-out commission is stamped as profit automatically (D14) — never operator-entered", async ({
    page,
  }) => {
    const headers = await authHeaders(page);
    const marker = Date.now();
    const CASHOUT_AMOUNT = Number((37 + (marker % 461) / 100).toFixed(2));
    const COMMISSION = expectedCashoutCommissionUsd(CASHOUT_AMOUNT);
    const COLLECT_TOTAL = Number((CASHOUT_AMOUNT + COMMISSION).toFixed(2));

    const account = await omtAccount(page, headers);
    const omtId = account.account_supplier_id;

    // Seed enough OMT_App wallet balance to cash out from (supplier credit —
    // no drawer drained, D2 — lira-web-033's own proof).
    const seeded = await (
      await page.request.post(
        `${BACKEND_URL}/api/recharge/top-up-from-supplier`,
        {
          headers,
          data: {
            provider: "OMT_APP",
            amount: CASHOUT_AMOUNT + 250,
            currency: "USD",
          },
        },
      )
    ).json();
    expect(seeded.success, JSON.stringify(seeded)).toBeTruthy();

    const cashout = await (
      await page.request.post(
        `${BACKEND_URL}/api/recharge/cashout-to-supplier`,
        {
          headers,
          data: {
            provider: "OMT_APP",
            amount: CASHOUT_AMOUNT,
            currency: "USD",
          },
        },
      )
    ).json();
    expect(cashout.success, JSON.stringify(cashout)).toBeTruthy();

    // Snapshot AFTER the cash-out, right before settling — isolates the
    // settlement's own effect from the top-up/cash-out's effects (rule 15).
    const omtSystemBeforeSettle = drawerOf(
      await drawerBalances(page, headers),
      "OMT_System",
    );
    const omtAppChildBeforeSettle = childOf(
      await omtAccount(page, headers),
      "OMT_APP",
    );

    const unsettled = await getAccountUnsettled(page, headers, omtId);
    const cashoutRow = findUnsettled(
      unsettled,
      "OMT_APP",
      "PAYMENT",
      -COLLECT_TOTAL,
    );

    // ── This selection alone is net NEGATIVE (OMT owes the shop) — the
    // sheet/API must offer COLLECT, not just PAY (§8.4). ───────────────────
    const settled = await (
      await page.request.post(settleAccountUrl(omtId), {
        headers,
        data: {
          account_supplier_id: omtId,
          direction: "COLLECT",
          selections: [{ kind: cashoutRow.kind, id: cashoutRow.id }],
          amount_usd: COLLECT_TOTAL,
          amount_lbp: 0,
          // No operator-entered commission for this batch — the profit
          // asserted below must come SOLELY from the deferred cash-out
          // commission, summed automatically (D14), never added by hand.
          commission_usd: 0,
          commission_lbp: 0,
          note: `lira-web-035 collect deferred-commission ${marker}`,
          created_by: 1,
          payments: [
            { method: "CASH", currency_code: "USD", amount: COLLECT_TOTAL },
          ],
        },
      })
    ).json();
    expect(settled.success, JSON.stringify(settled)).toBeTruthy();

    // The row nets to exactly 0 relative to its own cash-out contribution.
    const omtAppChildAfter = childOf(await omtAccount(page, headers), "OMT_APP");
    expect(
      omtAppChildAfter.total_usd - omtAppChildBeforeSettle.total_usd,
    ).toBeCloseTo(COLLECT_TOTAL, 2);

    // D3 applies to COLLECT too: cash comes IN via the OMT Cash Drawer.
    const omtSystemAfter = drawerOf(
      await drawerBalances(page, headers),
      "OMT_System",
    );
    expect(
      omtSystemAfter.usdBalance - omtSystemBeforeSettle.usdBalance,
    ).toBeCloseTo(COLLECT_TOTAL, 2);

    // The row leaves the unsettled queue.
    const unsettledAfter = await getAccountUnsettled(page, headers, omtId);
    expect(
      unsettledAfter.some((r) => r.id === cashoutRow.id && r.kind === "LEDGER"),
    ).toBe(false);

    // ── D14: profit on the settlement is EXACTLY the cash-out's stored
    // commission (0 operator commission entered) — computed, not typed. ───
    const txns = await findSettlementTxns(page, headers, COLLECT_TOTAL);
    expect(txns, JSON.stringify(txns)).toHaveLength(1);
    expect(txns[0].profit_usd).toBeCloseTo(COMMISSION, 2);
  });

  test("selecting a ledger row from a supplier OUTSIDE the OMT account is REJECTED — the server re-validates membership, it never trusts the client's ids (D8)", async ({
    page,
  }) => {
    const headers = await authHeaders(page);
    const marker = Date.now();

    const account = await omtAccount(page, headers);
    const omtId = account.account_supplier_id;

    // A fresh, ordinary supplier — NOT linked to the OMT account at all.
    const foreignSupplier = await (
      await page.request.post(`${BACKEND_URL}/api/suppliers`, {
        headers,
        data: {
          name: `L-web-035 Outsider ${marker}`,
          phone: `Lweb035${marker}`.slice(0, 15),
        },
      })
    ).json();
    expect(foreignSupplier.success, JSON.stringify(foreignSupplier)).toBeTruthy();
    const foreignId = foreignSupplier.id as number;

    // Give it a real, unsettled PAYMENT ledger row via the ordinary cashflow
    // path (lira-web-015's own proven mechanism) — a legitimate row, just on
    // the WRONG account.
    const paid = await (
      await page.request.post(
        `${BACKEND_URL}/api/suppliers/${foreignId}/cashflow`,
        {
          headers,
          data: {
            supplier_id: foreignId,
            direction: "PAY",
            payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
            note: "lira-web-035 outsider seed",
          },
        },
      )
    ).json();
    expect(paid.success, JSON.stringify(paid)).toBeTruthy();
    const foreignLedgerId = paid.id as number;

    const omtSystemBefore = drawerOf(
      await drawerBalances(page, headers),
      "OMT_System",
    );

    const rejected = await (
      await page.request.post(settleAccountUrl(omtId), {
        headers,
        data: {
          account_supplier_id: omtId,
          direction: "PAY",
          selections: [{ kind: "LEDGER", id: foreignLedgerId }],
          amount_usd: 10,
          amount_lbp: 0,
          commission_usd: 0,
          commission_lbp: 0,
          note: `lira-web-035 hostile selection ${marker}`,
          created_by: 1,
          payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
        },
      })
    ).json();
    expect(rejected.success, JSON.stringify(rejected)).toBe(false);
    expect(typeof rejected.error).toBe("string");

    // Nothing written: the OMT Cash Drawer is untouched...
    const omtSystemAfter = drawerOf(
      await drawerBalances(page, headers),
      "OMT_System",
    );
    expect(omtSystemAfter.usdBalance - omtSystemBefore.usdBalance).toBeCloseTo(
      0,
      2,
    );
    // ...and the foreign supplier's own row is still open, unsettled.
    const foreignBalance = await (
      await page.request.get(`${BACKEND_URL}/api/suppliers/balances`, {
        headers,
      })
    ).json();
    expect(foreignBalance.success, JSON.stringify(foreignBalance)).toBeTruthy();
    const foreignRow = (
      foreignBalance.balances as Array<{ supplier_id: number; total_usd: number }>
    ).find((b) => b.supplier_id === foreignId);
    expect(foreignRow?.total_usd).toBeCloseTo(-10, 2);
  });

  // ── Real-UI layer-seam pass — CONTRACT_W2.md §2.3's fixed testids only
  // (see file header for the one flagged assumption: the payment-leg input
  // prefix). Trusts lane W6's sheet has landed by the time this spec
  // actually runs (rule 17/contract instruction — NOT run in this pass). ──
  test("UI: the real settlement sheet's row toggle changes the selected total by exactly that row's own amount, and a real submit reaches the same core mutation", async ({
    page,
  }) => {
    const headers = await authHeaders(page);
    const marker = Date.now();
    const UI_AMOUNT = Number((6.5 + (marker % 211) / 100).toFixed(2));

    const account = await omtAccount(page, headers);
    const omtId = account.account_supplier_id;

    const seeded = await (
      await page.request.post(
        `${BACKEND_URL}/api/recharge/top-up-from-supplier`,
        {
          headers,
          data: { provider: "iPick", amount: UI_AMOUNT, currency: "USD" },
        },
      )
    ).json();
    expect(seeded.success, JSON.stringify(seeded)).toBeTruthy();

    const unsettledBefore = await getAccountUnsettled(page, headers, omtId);
    const row = findUnsettled(unsettledBefore, "iPick", "TOP_UP", UI_AMOUNT);

    await page.goto("/#/suppliers");
    await page.waitForTimeout(1_500);
    await expect(page.locator("#root")).not.toContainText(
      "Something went wrong",
    );

    const card = page.getByTestId("supplier-account-card-OMT");
    await expect(card).toBeVisible();
    await card.getByTestId("supplier-account-settle-button").click();

    const sheet = page.getByTestId("supplier-account-settle-sheet");
    await expect(sheet).toBeVisible({ timeout: 10_000 });

    const uiRow = sheet.locator(
      `[data-testid="supplier-account-settle-row"][data-row-id="${row.id}"]`,
    );
    await expect(uiRow).toBeVisible();
    await expect(uiRow).toHaveAttribute("data-kind", "LEDGER");

    const totalBefore = parseMoneyText(
      await sheet.getByTestId("supplier-account-settle-selected-total").innerText(),
    );

    const toggle = uiRow.getByTestId("supplier-account-settle-row-toggle");
    await toggle.click();
    let totalAfter = parseMoneyText(
      await sheet.getByTestId("supplier-account-settle-selected-total").innerText(),
    );
    // Whichever way the click moved it (deselected an already-pre-selected
    // oldest row, or selected a not-yet-selected one), the MAGNITUDE of the
    // change must be exactly this row's own amount — proving the sheet's own
    // arithmetic, not a hand-built payload's.
    expect(Math.abs(totalAfter - totalBefore)).toBeCloseTo(UI_AMOUNT, 2);

    // Make sure the row ends up SELECTED before submitting.
    if (totalAfter < totalBefore) {
      await toggle.click();
      totalAfter = parseMoneyText(
        await sheet
          .getByTestId("supplier-account-settle-selected-total")
          .innerText(),
      );
      expect(totalAfter - totalBefore).toBeCloseTo(0, 2);
    }

    await expect(
      sheet.getByTestId("supplier-account-settle-net"),
    ).toBeVisible();
    await expect(
      sheet.getByTestId("supplier-account-settle-deferred-commission"),
    ).toBeVisible();

    // This selection alone is a straightforward debt — PAY.
    await sheet.getByTestId("supplier-account-settle-direction-pay").click();

    // Payment leg — NOT a CONTRACT_W2.md-fixed testid (see file header):
    // reusing the existing settle-sheet's `payment-amount-`/
    // `payment-currency-` prefix convention.
    const amountInput = sheet
      .locator('[data-testid^="payment-amount-"]')
      .first();
    await amountInput.fill(String(totalAfter));
    const currencySelect = sheet
      .locator('[data-testid^="payment-currency-"]')
      .first();
    if (await currencySelect.count()) {
      await currencySelect.selectOption("USD");
    }

    await sheet.getByTestId("supplier-account-settle-submit").click();
    await expect(sheet).toHaveCount(0, { timeout: 10_000 });

    // The real submit reached the same core mutation the REST tests above
    // proved: the row is gone from the unsettled queue.
    const unsettledAfter = await getAccountUnsettled(page, headers, omtId);
    expect(unsettledAfter.some((r) => r.id === row.id)).toBe(false);
  });
});
