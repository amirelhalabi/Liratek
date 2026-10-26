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
 * LIRA-322 (specs/322-omt-amount-first-settle, T051): the sheet now settles
 * BY AMOUNT, one currency at a time, and is the only way to pay the OMT
 * account. All four scenarios keep their intent but use the amount-first
 * contract the sheet sends (`per_currency` + `expected_owed`, scoped by
 * `selections` to this spec's own rows, since the account carries other
 * specs' backlog and oldest-first would otherwise pay that instead). Closed
 * rows now share ONE `settlement_id` (the settlement's anchor ledger row),
 * and the UI pass ticks its row in "Pick transfers" (nothing is pre-ticked).
 *
 * LIRA-343 (T026): the sheet opens on a day calendar and settles the PICKED
 * DAYS (every open day before today starts picked; "Pick transfers" is
 * gone). The UI pass therefore seeds an OMT SEND backdated
 * (`transaction_time`, noon UTC) onto a past day with no other open row,
 * clears the default pick and picks only that day. It seeded an iPick
 * top-up before; a top-up cannot be backdated.
 */
import type { Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  loginAsAdmin,
  gotoAndSettle,
  BACKEND_URL,
} from "./fixtures";

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
  // LIRA-322 — what each row still owes after part-payments.
  remaining_usd: number;
  remaining_lbp: number;
  /** LIRA-343 — the shop's calendar day of the row (`YYYY-MM-DD`). */
  shop_day: string;
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

// ── LIRA-343 calendar helpers ───────────────────────────────────────────────

/** The browser's own calendar day — what the sheet calls "today" (rule 27). */
async function browserToday(page: Page): Promise<string> {
  return page.evaluate(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
}

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** Noon UTC on `day`: the same calendar day from UTC−11 to UTC+11. */
const noonUtc = (day: string) => `${day}T12:00:00.000Z`;

const monthNumber = (day: string) =>
  Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7));

/** The most recent past day with NO open row on the account, so picking it
 *  in the calendar picks only what this spec seeds there (rule 15). */
async function freePastDay(
  page: Page,
  headers: { Authorization: string },
  accountId: number,
  today: string,
): Promise<string> {
  const open = new Set(
    (await getAccountUnsettled(page, headers, accountId)).map(
      (r) => r.shop_day,
    ),
  );
  for (let k = 1; k <= 180; k++) {
    const day = shiftDay(today, -k);
    if (!open.has(day)) return day;
  }
  throw new Error("no past day without open OMT rows in the last 180 days");
}

/** Clears the default pick (every open day before today), then picks
 *  exactly `day`, walking back from today's month to the day's month. */
async function pickOnlyDay(sheet: Locator, today: string, day: string) {
  const bar = sheet.getByTestId("settle-selection-bar");
  await expect(bar).toBeVisible({ timeout: 15_000 });
  // No test id on Clear (reported): the bar's only button while days are
  // picked; "Pick all open" while none are.
  const clear = bar.getByRole("button", { name: "Clear", exact: true });
  if (await clear.count()) await clear.click();
  await expect(clear).toHaveCount(0);
  for (let i = monthNumber(today) - monthNumber(day); i > 0; i--) {
    await sheet
      .getByRole("button", { name: "Previous month", exact: true })
      .click();
  }
  const button = sheet.locator(`[data-day="${day}"] button`);
  await expect(button).toBeEnabled({ timeout: 15_000 });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(bar).toContainText("1 day picked");
  await closeDayDetails(sheet);
}

/** LIRA-343 — tapping a day also opens its details panel (inline, under the
 *  calendar; it grows once its rows load). Close it — by ITS Close button,
 *  not the sheet's own "Close" — so the payment box below stays put. */
async function closeDayDetails(sheet: Locator) {
  const details = sheet.getByTestId("settle-day-details");
  await expect(details).toBeVisible();
  await details.getByRole("button", { name: "Close", exact: true }).click();
  await expect(details).toHaveCount(0);
}

/** The OMT credit line pre-fills min(owed, credit); other specs leave
 *  credit on the account, so set it to 0 to keep the amounts this spec's. */
async function setCreditToZero(sheet: Locator) {
  for (const c of ["usd", "lbp"]) {
    const input = sheet.getByTestId(`supplier-account-settle-credit-${c}`);
    if (await input.count()) {
      await input.fill("0");
      await expect(input).toHaveValue("0");
    }
  }
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

// ── The settlement transaction itself. `profit_usd`/`profit_lbp` are NOT
// listed here: `/api/transactions/recent`'s SELECT deliberately omits them
// (profit sits behind the Profits page's password gate, v163) — see
// `fetchTransactionDetail`'s doc comment below for where profit IS read
// from. `metadata_json` IS returned by `/recent` (getRecent's own SELECT
// names it) — used to confirm which member suppliers a settlement touched.
interface SettlementTxn {
  id: number;
  type: string;
  amount_usd: number;
  amount_lbp: number;
  status: string;
  metadata_json: string | null;
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

/**
 * `GET /api/transactions/recent` omits `profit_usd`/`profit_lbp` on purpose
 * (see `SettlementTxn`'s doc comment). `GET /api/transactions/:id` goes
 * through `TransactionService.getById` → `BaseRepository.findById`, which
 * SELECTs every column (`getColumns()`) behind `requireAuth` only — no
 * profits gate. That is a real, pre-existing, ungated route, so reading
 * profit off it is not "adding profit to the recent endpoint"; it is the one
 * REST surface that already exposes a single transaction's profit honestly.
 * Mirrors lira-web-034's identical helper (kept local — these two spec files
 * don't share a util module).
 */
interface TxnDetail {
  id: number;
  profit_usd: number;
  profit_lbp: number;
}
async function fetchTransactionDetail(
  page: Page,
  headers: { Authorization: string },
  id: number,
): Promise<TxnDetail> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/transactions/${id}`, {
      headers,
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r.transaction as TxnDetail;
}

/** `packages/core/src/constants/omtAppCashout.ts` — D13's 0.1%, USD 2dp
 *  rounding. Mirrors lira-web-034's own local copy (never fed back into the
 *  app — used only to compute THIS spec's own expectation). */
function expectedCashoutCommissionUsd(amount: number): number {
  return Math.round(amount * 0.001 * 100) / 100;
}

const settleAccountUrl = (accountSupplierId: number): string =>
  `${BACKEND_URL}/api/suppliers/${accountSupplierId}/settle-account`;

/** LIRA-322 — the signed in-scope remaining the sheet sends as
 *  `expected_owed` (the server refuses the settlement if it changed). */
function expectedOwedOf(rows: AccountUnsettledRow[]): {
  usd: number;
  lbp: number;
} {
  return {
    usd: rows.reduce((s, r) => s + r.remaining_usd, 0),
    lbp: Math.round(rows.reduce((s, r) => s + r.remaining_lbp, 0)),
  };
}

/** The SUPPLIER_SETTLEMENT transaction of a settle-account call, by
 *  identity: its `source_id` is the anchor ledger id the call returns. */
async function settlementTxnByAnchor(
  page: Page,
  headers: { Authorization: string },
  anchorLedgerId: number,
): Promise<SettlementTxn & { source_table: string; source_id: number }> {
  const r = await (
    await page.request.get(
      `${BACKEND_URL}/api/transactions/recent?type=SUPPLIER_SETTLEMENT&limit=300`,
      { headers },
    )
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  const txn = (
    r.transactions as Array<
      SettlementTxn & { source_table: string; source_id: number }
    >
  ).find(
    (t) => t.source_table === "supplier_ledger" && t.source_id === anchorLedgerId,
  );
  expect(txn, `no settlement transaction for anchor #${anchorLedgerId}`).toBeTruthy();
  return txn!;
}

test.describe("OMT open-credit account settlement over REST (LIRA-189)", () => {
  test("a two-child batch with NO debt on the OMT parent settles in one PAY: both rows net to 0, one SUPPLIER_SETTLEMENT transaction, and the OMT Cash Drawer falls by exactly the cash leg (D3)", async ({
    page,
  }) => {
    const headers = await authHeaders(page);
    const marker = Date.now();
    // Run-unique, non-round amounts so this batch's combined total can never
    // collide with another run's settlement (identity via amount match).
    // Whole cents (LIRA-322): the amount-first allocator works in cents, so
    // two 3-decimal rows could round to a total one cent off their sum.
    const IPICK_AMOUNT = Number((14.11 + (marker % 733) / 100).toFixed(2));
    const OMTAPP_AMOUNT = Number((9.27 + (marker % 611) / 100).toFixed(2));
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
        // LIRA-322 amount-first payload (the only one the sheet sends):
        // scoped to these two rows, the money in its own currency section.
        data: {
          account_supplier_id: omtId,
          selections: [
            { kind: ipickRow.kind, id: ipickRow.id },
            { kind: omtAppRow.kind, id: omtAppRow.id },
          ],
          expected_owed: expectedOwedOf([ipickRow, omtAppRow]),
          per_currency: {
            USD: {
              direction: "PAY",
              payments: [
                { method: "CASH", currency_code: "USD", amount: TOTAL },
              ],
            },
          },
          note: `lira-web-035 mixed no-parent-debt ${marker}`,
        },
      })
    ).json();
    expect(settled.success, JSON.stringify(settled)).toBeTruthy();
    expect(settled.id, JSON.stringify(settled)).toBeTruthy();

    // ── Both rows are stamped settled. LIRA-322: an amount-first
    // settlement stamps every row it closes with ONE id — its anchor ledger
    // row, the id the call returns (the legacy path gave each member its own
    // negation row id). Both members still get their own money row; what
    // ties them together is that anchor and the one transaction below. ───
    const ledgerAfter = await getAccountLedger(page, headers, omtId);
    const ipickLedgerAfter = ledgerAfter.find((l) => l.id === ipickRow.id);
    const omtAppLedgerAfter = ledgerAfter.find((l) => l.id === omtAppRow.id);
    expect(ipickLedgerAfter?.settlement_id, "iPick row not stamped settled").toBe(
      settled.id,
    );
    expect(
      omtAppLedgerAfter?.settlement_id,
      "OMT App row not stamped settled",
    ).toBe(settled.id);
    // Rows never move (plan §2) — the raw amounts are untouched by settling.
    expect(ipickLedgerAfter?.amount_usd).toBeCloseTo(IPICK_AMOUNT, 2);
    expect(omtAppLedgerAfter?.amount_usd).toBeCloseTo(OMTAPP_AMOUNT, 2);

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
    expect((await settlementTxnByAnchor(page, headers, settled.id)).id).toBe(
      txns[0].id,
    );

    // ── The two rows really DO "belong to the settlement" together: what's
    // shared across members is the ONE settlement transaction (proven above)
    // and its own `metadata_json.members` list — not a shared
    // `settlement_id` (see the comment above disproving that). Both member
    // suppliers this batch touched must be named on it. "They all reverse
    // together" is W1's own jest proof (`SupplierRepository.
    // accountSettlement.test.ts`), deliberately not re-proven here (file
    // header, rule 14). ─────────────────────────────────────────────────────
    const settlementMeta = JSON.parse(
      txns[0].metadata_json ?? "{}",
    ) as { members?: number[] };
    expect(settlementMeta.members).toEqual(
      expect.arrayContaining([ipickRow.supplier_id, omtAppRow.supplier_id]),
    );
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
        // No operator-entered commission for this batch — the profit
        // asserted below must come SOLELY from the deferred cash-out
        // commission, summed automatically (D14), never added by hand.
        // LIRA-322: the USD section's direction follows the sign of what is
        // owed (negative here), so it is COLLECT.
        data: {
          account_supplier_id: omtId,
          selections: [{ kind: cashoutRow.kind, id: cashoutRow.id }],
          expected_owed: expectedOwedOf([cashoutRow]),
          per_currency: {
            USD: {
              direction: "COLLECT",
              payments: [
                { method: "CASH", currency_code: "USD", amount: COLLECT_TOTAL },
              ],
            },
          },
          note: `lira-web-035 collect deferred-commission ${marker}`,
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
    // commission (0 operator commission entered) — computed, not typed.
    // `/recent` doesn't carry profit_usd (see `SettlementTxn`'s doc
    // comment) — read it off `/transactions/:id` instead. ──────────────────
    const settlementTxn = await settlementTxnByAnchor(
      page,
      headers,
      settled.id,
    );
    const settlementDetail = await fetchTransactionDetail(
      page,
      headers,
      settlementTxn.id,
    );
    expect(settlementDetail.profit_usd).toBeCloseTo(COMMISSION, 2);
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
          selections: [{ kind: "LEDGER", id: foreignLedgerId }],
          // What a forged client would claim the row owes.
          expected_owed: { usd: -10, lbp: 0 },
          per_currency: {
            USD: {
              direction: "PAY",
              payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
            },
          },
          note: `lira-web-035 hostile selection ${marker}`,
        },
      })
    ).json();
    expect(rejected.success, JSON.stringify(rejected)).toBe(false);
    // The scope check runs first: the id is not on this account's queue.
    expect(String(rejected.error)).toContain("no longer open on this account");

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

  // ── Real-UI layer-seam pass (LIRA-343 calendar sheet). The sheet opens
  // with every open day before today picked; picking ONLY this spec's day
  // must narrow the USD section's owed figure to exactly its one transfer —
  // the sheet's OWN arithmetic, which a hand-built REST payload cannot
  // prove — and a real submit must reach the same core mutation the REST
  // tests above proved. ──────────────────────────────────────────────────
  test("UI: picking only this spec's day in the real settlement sheet narrows what is owed to exactly that day's transfer, the preview closes it, and a real submit reaches the same core mutation", async ({
    page,
  }) => {
    const headers = await authHeaders(page);
    const marker = Date.now();
    const UI_AMOUNT = Number((6.5 + (marker % 211) / 100).toFixed(2));
    const UI_FEE = 1;

    const account = await omtAccount(page, headers);
    const omtId = account.account_supplier_id;
    const today = await browserToday(page);
    const DAY = await freePastDay(page, headers, omtId, today);

    const seeded = await (
      await page.request.post(`${BACKEND_URL}/api/services/transactions`, {
        headers,
        data: {
          provider: "OMT",
          serviceType: "SEND",
          amount: UI_AMOUNT,
          currency: "USD",
          omtServiceType: "INTRA",
          omtFee: UI_FEE,
          payments: [
            { method: "CASH", currencyCode: "USD", amount: UI_AMOUNT + UI_FEE },
          ],
          transaction_time: noonUtc(DAY),
        },
      })
    ).json();
    expect(seeded.success, JSON.stringify(seeded)).toBeTruthy();
    const rowId = seeded.id as number;

    const unsettledBefore = await getAccountUnsettled(page, headers, omtId);
    const row = unsettledBefore.find(
      (r) => r.kind === "FINANCIAL_SERVICE" && r.id === rowId,
    );
    expect(row, "seeded OMT SEND not in the account queue").toBeTruthy();
    // `transaction_time` reached the row, and DAY carries only this row.
    expect(row!.shop_day).toBe(DAY);
    expect(
      unsettledBefore.filter((r) => r.shop_day === DAY).map((r) => r.id),
    ).toEqual([rowId]);
    const OWED = Math.round(row!.remaining_usd * 100) / 100;
    expect(OWED).toBeCloseTo(UI_AMOUNT + UI_FEE, 2);
    // Snapshot AFTER seeding: the SEND's own cash lands in this drawer.
    const omtSystemBefore = drawerOf(
      await drawerBalances(page, headers),
      "OMT_System",
    );

    await gotoAndSettle(page, "/#/suppliers");
    await expect(page.locator("#root")).not.toContainText(
      "Something went wrong",
    );

    const card = page.getByTestId("supplier-account-card-OMT");
    await expect(card).toBeVisible();
    await card.getByTestId("supplier-account-settle-button").click();

    const sheet = page.getByTestId("supplier-account-settle-sheet");
    await expect(sheet).toBeVisible({ timeout: 10_000 });

    // Picking only DAY and setting the OMT credit to 0 come BEFORE the
    // payment line: changing either re-fills the payment box.
    await pickOnlyDay(sheet, today, DAY);
    await setCreditToZero(sheet);

    const usd = sheet.getByTestId("supplier-account-settle-section-usd");
    await expect(
      usd.getByTestId("supplier-account-settle-owed-usd"),
    ).toHaveText(`$${OWED.toFixed(2)}`);
    // Only this USD row is in scope, so no LBP section is open.
    await expect(
      sheet.getByTestId("supplier-account-settle-section-lbp"),
    ).toHaveCount(0);

    const method = usd.locator('[data-testid^="payment-method-"]').first();
    if (await method.count()) await method.selectOption("CASH");
    await usd
      .locator('[data-testid^="payment-amount-"]')
      .first()
      .fill(OWED.toFixed(2));

    await expect(
      usd.locator(
        `[data-testid="supplier-account-settle-preview-row"][data-kind="FINANCIAL_SERVICE"][data-row-id="${rowId}"]`,
      ),
    ).toHaveAttribute("data-status", "closes");
    await expect(
      usd.getByTestId("supplier-account-settle-still-owed-usd"),
    ).toHaveText("$0.00");

    await sheet.getByTestId("supplier-account-settle-submit").click();
    await expect(sheet).toHaveCount(0, { timeout: 10_000 });

    // The real submit reached the same core mutation the REST tests above
    // proved: the row is gone from the unsettled queue, and the OMT Cash
    // Drawer paid exactly that row (D3).
    const unsettledAfter = await getAccountUnsettled(page, headers, omtId);
    expect(
      unsettledAfter.some(
        (r) => r.kind === "FINANCIAL_SERVICE" && r.id === rowId,
      ),
    ).toBe(false);
    const omtSystemAfter = drawerOf(
      await drawerBalances(page, headers),
      "OMT_System",
    );
    expect(omtSystemAfter.usdBalance - omtSystemBefore.usdBalance).toBeCloseTo(
      -OWED,
      2,
    );
  });
});
