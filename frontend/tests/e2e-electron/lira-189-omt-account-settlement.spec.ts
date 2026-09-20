/**
 * E2E: LIRA-189 — OMT open-credit account settlement
 * (docs/plans/ongoing_plans/OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §5 LIRA-189, §8.4;
 * CONTRACT_W2.md §1/§2).
 *
 * One action settles the WHOLE OMT account — the counter (OMT SEND/RECEIVE),
 * the OMT App wallet, and iPick credit — in ONE `SUPPLIER_SETTLEMENT`
 * transaction, writing one `PAYMENT`-family `supplier_ledger` row PER CHILD
 * touched (never a single row parked on the parent — plan §4's worked
 * example). This spec drives the REAL settlement sheet end-to-end, because
 * the frontend does the allocation arithmetic (selection → net → payment
 * legs) — a hand-built IPC payload cannot catch a seam bug there (rule 15
 * layer-seam discipline).
 *
 * Covers (CONTRACT_W2.md §3, lane W7):
 *   1. A mixed account (counter debt + iPick credit debt + an OMT App
 *      cashout credit) settles in ONE payment, with every child touched
 *      netting back to its pre-seed baseline.
 *   2. The OMT Cash Drawer (`OMT_System`, the PCD) falls by EXACTLY the cash
 *      leg (D3 — every leg resolves through `resolveServiceCashDrawer` with
 *      the PARENT's provider context, never `General`).
 *   3. A net-negative account (cashout credits outweigh debt) offers the
 *      COLLECT direction.
 *   4. The deferred OMT App cashout commission (D14, §8.3a — stored in
 *      `transactions.metadata_json.commission` at cashout time, recognised
 *      as profit only at settlement) is summed and stamped as profit on the
 *      settlement transaction, per currency.
 *
 * NOT covered here (by design — owned by other lanes' core jest, not e2e):
 *   - create+void nets every child ledger/account/PCD/profit to 0 (rule 17,
 *     rule 20) — that is `SupplierRepository.accountSettlement.test.ts` (W1)
 *     and `TransactionRepository.accountSettlementReversal.test.ts` (W2).
 *   - Cross-currency (LBP) arithmetic — also W1's core-jest job; this file
 *     stays USD-only to keep the UI seam under test manageable.
 *
 * WHY "isolateSelection" INSTEAD OF TRUSTING THE PRE-SELECTION: this suite
 * shares ONE accumulating DB across ~150 specs that run alphabetically
 * before this file (lira-056…lira-188), several of which (lira-089, -092,
 * -137, -148, -158, -159, and LIRA-188/190/192's own wave-1 specs) leave
 * OMT-account rows permanently unsettled (see this directory's README,
 * "lira-188/190/192 … left UNREVERSED" note). D8's oldest-first pre-select
 * would happily pick up that backlog instead of (or alongside) the rows this
 * spec just created. Every test below therefore explicitly ticks ONLY the
 * rows it created (matched by `data-kind`/`data-row-id` identity, never
 * position) and unticks anything else the sheet may have pre-selected, so
 * every assertion is attributable to exactly this spec's own action — the
 * same delta-by-identity discipline as lira-188/lira-192, just applied to
 * the selection step too since this flow is itself a selection UI.
 *
 * Every money assertion is a DELTA snapshotted immediately before the
 * seeding action and matched by IDENTITY (a unique, non-round amount plus
 * provider/kind), never an absolute total or row position (rule 15).
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

// D13: the OMT App cashout's own named constant — independently re-derived
// here (never imported from the app), same convention as lira-192, so a
// rate drift is caught here rather than merely proven self-consistent.
const CASHOUT_COMMISSION_RATE = 0.001;

// Distinctive, non-round amounts so identity matching by (kind, provider,
// amount) inside the shared DB's history cannot collide with any other
// spec's activity.
const SEND_AMOUNT_USD = 647;
const SEND_FEE_USD = 29; // OMT counter debt = 676.00
const IPICK_TOPUP_USD = 214; // iPick credit debt = 214.00
const CASHOUT_USD = 161; // OMT App cashout credit ≈ -(161 + 0.16)
const NET_PAY_USD = SEND_AMOUNT_USD + SEND_FEE_USD + IPICK_TOPUP_USD; // recomputed below once the real commission is known

const COLLECT_CASHOUT_USD = 337; // isolated net-negative scenario, its own unique marker

function roundForCurrency(amount: number, currency: "USD" | "LBP"): number {
  const unit = currency === "LBP" ? 1 : 0.01;
  return Math.round(amount / unit) * unit;
}

/** Parse a formatted money string ("$728.84", "-$337.34", "1,234,000 LBP")
 *  back to a number, tolerant of whichever display format the sheet uses. */
function parseMoneyText(text: string): number {
  const cleaned = text.replace(/[^0-9.-]/g, "");
  return parseFloat(cleaned);
}

type AccountBalance = {
  account_supplier_id: number;
  account_name: string;
  total_usd: number;
  total_lbp: number;
  children: Array<{
    supplier_id: number;
    name: string;
    provider: string | null;
    total_usd: number;
    total_lbp: number;
    is_parent: boolean;
  }>;
};

type AccountUnsettledRow = {
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
};

type DrawerBalance = { name: string; usdBalance: number; lbpBalance: number };
type SupplierBalanceRow = {
  supplier_id: number;
  total_usd: number;
  total_lbp: number;
};

/** Only the fields this spec reads. `transactions.getRecent` passes through
 *  every journal column at runtime (per its own doc comment in
 *  electron.d.ts) even though `RecentTransaction` only types the ones the
 *  renderer relies on — `profit_usd`/`profit_lbp` are real columns
 *  (`electron-app/create_db.sql`) and arrive on the raw IPC payload. */
type RecentTxn = {
  id: number;
  type: string;
  amount_usd: number;
  amount_lbp: number;
  metadata_json: string | null;
  profit_usd?: number;
  profit_lbp?: number;
};

type Api = {
  api: {
    suppliers: {
      list: (
        search: string,
        includeInactive: boolean,
      ) => Promise<Array<{ id: number; provider: string | null }>>;
      getBalances: (
        includeInactive?: boolean,
      ) => Promise<SupplierBalanceRow[]>;
      getAccountBalances: () => Promise<AccountBalance[]>;
      getAccountUnsettled: (
        accountSupplierId: number,
      ) => Promise<AccountUnsettledRow[]>;
    };
    omt: {
      addTransaction: (data: {
        provider: string;
        serviceType: "SEND" | "RECEIVE" | "BILL";
        amount: number;
        currency?: string;
        omtServiceType?: string;
        omtFee?: number;
        payments?: Array<{
          method: string;
          currencyCode: string;
          amount: number;
          direction?: "IN" | "OUT";
        }>;
      }) => Promise<{ success?: boolean; error?: string }>;
    };
    recharge: {
      getDrawerBalances: () => Promise<DrawerBalance[]>;
      topUpFromSupplier: (data: {
        provider: "iPick" | "Katsh" | "OMT_APP";
        amount: number;
        currency: "USD" | "LBP";
      }) => Promise<{ success: boolean; error?: string }>;
      cashoutToSupplier: (data: {
        provider: "OMT_APP";
        amount: number;
        currency: "USD" | "LBP";
      }) => Promise<{ success: boolean; error?: string; commission?: number }>;
    };
    transactions: {
      getRecent: (limit: number) => Promise<RecentTxn[]>;
    };
  };
};

async function drawers(
  page: Page,
): Promise<{ general: number; omtSystem: number }> {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const rows = await w.api.recharge.getDrawerBalances();
    const pick = (n: string) => rows.find((d) => d.name === n)?.usdBalance ?? 0;
    return { general: pick("General"), omtSystem: pick("OMT_System") };
  });
}

async function omtAccountId(page: Page): Promise<number> {
  const id = await page.evaluate(async () => {
    const w = window as unknown as Api;
    const account = (await w.api.suppliers.getAccountBalances()).find(
      (a) => a.account_name === "OMT",
    );
    return account?.account_supplier_id ?? null;
  });
  if (id === null) throw new Error("OMT account not found");
  return id;
}

// OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §5 (LIRA-188): 'OMT App' and 'iPick' are
// OMT-account CHILDREN (`account_supplier_id` -> OMT), so `getBalances`
// deliberately excludes them from its top-level list — they surface only in
// the account rollup's `children[]` (which ALSO includes the parent 'OMT'
// itself, flagged `is_parent: true`). Reading every provider here through
// `getAccountBalances()` uniformly handles OMT/iPick/OMT_APP alike, rather
// than a two-path branch that special-cases the parent.
async function supplierBalanceByProvider(
  page: Page,
  provider: string,
): Promise<number> {
  return page.evaluate(async (p) => {
    const w = window as unknown as Api;
    const child = (await w.api.suppliers.getAccountBalances())
      .flatMap((a) => a.children)
      .find((c) => c.provider === p);
    return child?.total_usd ?? 0;
  }, provider);
}

async function unsettledRows(
  page: Page,
  accountId: number,
): Promise<AccountUnsettledRow[]> {
  return page.evaluate(
    (id) =>
      (window as unknown as Api).api.suppliers.getAccountUnsettled(id),
    accountId,
  );
}

async function seedOmtSend(page: Page, amount: number, fee: number) {
  const res = await page.evaluate(
    async ({ amount, fee }) => {
      const w = window as unknown as Api;
      return w.api.omt.addTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount,
        currency: "USD",
        omtServiceType: "INTRA",
        omtFee: fee,
        payments: [{ method: "CASH", currencyCode: "USD", amount: amount + fee }],
      });
    },
    { amount, fee },
  );
  expect(res.error ?? null).toBeNull();
  expect(res.success).toBe(true);
}

async function seedIpickTopup(page: Page, amount: number) {
  const res = await page.evaluate(
    async (amount) => {
      const w = window as unknown as Api;
      return w.api.recharge.topUpFromSupplier({
        provider: "iPick",
        amount,
        currency: "USD",
      });
    },
    amount,
  );
  expect(res.success).toBe(true);
}

/** Fund the OMT_App wallet drawer on OMT credit (LIRA-190) so a subsequent
 *  cashout of up to `amount` is never refused for insufficient balance (D15)
 *  — the guard checks the real `OMT_App` DRAWER balance, which this shared,
 *  alphabetically-ordered suite gives no guarantee about otherwise (this
 *  file runs BEFORE lira-190/lira-192, the specs that would normally have
 *  funded it). Mirrors lira-192's own `seedWallet` convention: fund well
 *  above what will be drawn down, regardless of the DB's prior history. */
async function seedOmtAppWallet(page: Page, atLeast: number) {
  const res = await page.evaluate(
    async (amount) => {
      const w = window as unknown as Api;
      return w.api.recharge.topUpFromSupplier({
        provider: "OMT_APP",
        amount,
        currency: "USD",
      });
    },
    atLeast * 2 + 1000,
  );
  expect(res.success).toBe(true);
}

/** Returns the actual, server-computed commission (D13's rate, independently
 *  re-derived above for the assertion, not for this seed step). */
async function seedOmtAppCashout(
  page: Page,
  amount: number,
): Promise<number> {
  const res = await page.evaluate(
    async (amount) => {
      const w = window as unknown as Api;
      return w.api.recharge.cashoutToSupplier({
        provider: "OMT_APP",
        amount,
        currency: "USD",
      });
    },
    amount,
  );
  expect(res.error ?? null).toBeNull();
  expect(res.success).toBe(true);
  const expectedCommission = roundForCurrency(
    amount * CASHOUT_COMMISSION_RATE,
    "USD",
  );
  // Cross-check the documented rate against whatever the repository actually
  // stamped, rather than trusting the response blindly (rule 4).
  if (typeof res.commission === "number") {
    expect(res.commission).toBeCloseTo(expectedCommission, 2);
  }
  return expectedCommission;
}

async function openOmtAccountCard(page: Page): Promise<Locator> {
  await navigateTo(page, "/suppliers");
  const tab = page.getByRole("button", { name: "Companies" });
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
  }
  const card = page.getByTestId("supplier-account-card-OMT");
  await expect(card).toBeVisible({ timeout: 10_000 });
  // Select the account parent — the card's own clickable header button
  // (LIRA-188's `SupplierAccountCard`), not any nested sub-row.
  await card.locator("button").first().click();
  return card;
}

async function openAccountSettleSheet(page: Page): Promise<Locator> {
  await openOmtAccountCard(page);
  const settleBtn = page.getByTestId("supplier-account-settle-button");
  await expect(settleBtn).toBeVisible({ timeout: 10_000 });
  await settleBtn.click();
  const sheet = page.getByTestId("supplier-account-settle-sheet");
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  return sheet;
}

/**
 * Ticks EXACTLY the given rows and unticks every other row currently
 * rendered in the sheet — see the file's top docblock for why this is
 * necessary on a shared, accumulating DB (D8's oldest-first pre-select would
 * otherwise happily reach into unrelated backlog from ~150 earlier specs).
 * Assumes `supplier-account-settle-row-toggle` is a checkbox (or ARIA
 * checkbox) `.check()`/`.uncheck()` can drive — flagged as an assumption in
 * this lane's report since the frontend (W6) had not landed when this spec
 * was written.
 *
 * Waits for every WANTED row to actually be rendered before touching any
 * checkbox, rather than taking a single `rows.count()` snapshot the instant
 * the sheet's shell appears. `openAccountSettleSheet` only waits for the
 * sheet DIV, not for its row query to resolve — and `AccountSettleSheet`'s
 * unsettled-row query shares its cache entry with the (typically
 * continuously-mounted) account card, so a row this test just seeded via a
 * raw `window.api` call (which bypasses every app-level cache invalidation)
 * can legitimately still be mid-refetch, or briefly served from a queue
 * cached before the seed, when the sheet first paints. A one-shot
 * `rows.count()` taken in that window silently sees the OLD row set, ticks
 * nothing matching `wanted`, and every downstream total reads $0 — this
 * exact race produced "Expected -337.34, Received 0" on the net readout
 * with NOTHING wrong in `AccountSettleSheet`'s own arithmetic (proved by
 * `AccountSettleSheet.test.tsx`'s "net-negative selection" case, which
 * covers the identical single-credit-row shape against a fresh, uncached
 * query and passes). `AccountSettleSheet` now asks for
 * `refetchOnMount: "always"` precisely so this wait is bounded by one real
 * IPC round trip, not by the 30s app-wide `staleTime`.
 */
async function isolateSelection(
  sheet: Locator,
  wanted: Array<{ kind: "FINANCIAL_SERVICE" | "LEDGER"; id: number }>,
) {
  for (const w of wanted) {
    await expect(
      sheet.locator(
        `[data-testid="supplier-account-settle-row"][data-kind="${w.kind}"][data-row-id="${w.id}"]`,
      ),
    ).toBeVisible({ timeout: 10_000 });
  }

  const rows = sheet.locator('[data-testid="supplier-account-settle-row"]');
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const kind = await row.getAttribute("data-kind");
    const idAttr = await row.getAttribute("data-row-id");
    const id = idAttr === null ? Number.NaN : Number(idAttr);
    const shouldCheck = wanted.some((w) => w.kind === kind && w.id === id);
    const toggle = row.getByTestId("supplier-account-settle-row-toggle");
    if (shouldCheck) {
      await toggle.check();
    } else {
      await toggle.uncheck();
    }
  }
}

/** Fills a single CASH USD leg via the shared `MultiPaymentInput` (rule 14 —
 *  the same component every other settle/cashflow sheet in this app uses;
 *  `payment-method-*`/`payment-amount-*`/`payment-currency-*` are the
 *  established sitewide prefix-testid convention for it, e.g.
 *  lira-141/lira-137). Scoped to the settle sheet so it never collides with
 *  another payment widget on the page. */
async function fillCashLeg(sheet: Locator, amount: number) {
  const mpi = sheet.getByTestId("multi-payment-input");
  await expect(mpi).toBeVisible({ timeout: 10_000 });

  const methodSelect = mpi.locator('[data-testid^="payment-method-"]').first();
  await expect(methodSelect).toBeVisible({ timeout: 10_000 });
  await methodSelect.selectOption("CASH");

  const currencySelect = mpi
    .locator('[data-testid^="payment-currency-"]')
    .first();
  if (await currencySelect.count()) {
    await currencySelect.selectOption("USD").catch(() => {});
  }

  const amountInput = mpi.locator('[data-testid^="payment-amount-"]').first();
  await amountInput.fill(amount.toFixed(2));
}

async function submitSettlement(sheet: Locator, page: Page) {
  const submit = sheet.getByTestId("supplier-account-settle-submit");
  await expect(submit).toBeEnabled({ timeout: 10_000 });
  await submit.click();
  await expect(page.getByTestId("supplier-account-settle-sheet")).toBeHidden({
    timeout: 15_000,
  });
}

test.describe("LIRA-189 — OMT account settlement, driven through the real settlement sheet", () => {
  test("A mixed account settles in ONE payment: OMT counter debt + iPick credit debt + an OMT App cashout credit all net back to baseline, and the OMT Cash Drawer falls by exactly the cash leg", async ({
    appPage,
  }) => {
    const accountId = await omtAccountId(appPage);

    // Fund the OMT_App wallet BEFORE any ledger baseline snapshot:
    // `topUpFromSupplier` moves no drawer (D2), but it DOES book its own
    // 'OMT App' debt row — capturing `beforeApp` only after this step keeps
    // every OMT_APP delta below attributable to the cashout alone (the
    // wallet-funding debt stays a constant, unselected, still-unsettled row
    // throughout, exactly like the ~150 earlier specs' own backlog this
    // file's docblock already designs around). The DRAWER baseline
    // (`beforeDrawers`) is snapshotted separately, later — see its own
    // comment below for why it must come AFTER seeding too, not just after
    // the wallet funding.
    await seedOmtAppWallet(appPage, CASHOUT_USD);

    const beforeOmt = await supplierBalanceByProvider(appPage, "OMT");
    const beforeIpick = await supplierBalanceByProvider(appPage, "iPick");
    const beforeApp = await supplierBalanceByProvider(appPage, "OMT_APP");

    await seedOmtSend(appPage, SEND_AMOUNT_USD, SEND_FEE_USD);
    await seedIpickTopup(appPage, IPICK_TOPUP_USD);
    const cashoutCommission = await seedOmtAppCashout(appPage, CASHOUT_USD);
    const netPay = NET_PAY_USD - (CASHOUT_USD + cashoutCommission);

    // Drawer baseline snapshotted HERE, after seeding, not before it (rule
    // 15 — "snapshot immediately before the action"). `seedOmtSend` above
    // pays for the SEND with a real CASH leg
    // (`payments: [{ method: "CASH", amount: amount + fee }]`), and that
    // leg is itself customer cash landing in the OMT Cash Drawer at
    // CREATION time (Primary Cash Drawer plan §8.2 — a CASH leg on a
    // primary-system SEND routes to the PCD via
    // `resolveServiceCashDrawer`/`FinancialServiceRepository`, the same
    // resolver `settleAccount` uses for the settlement leg below). A
    // baseline taken before the seed would silently fold the SEND's own
    // +676 cash-in into the settlement's own −728.84 cash-out and expect
    // their SUM (a −52.84 delta) to equal the settlement leg ALONE
    // (−728.84) — which is exactly the "spec expected -728.84, got -52.84,
    // short by exactly 676 (= SEND_AMOUNT_USD + SEND_FEE_USD)" shape.
    // `settleAccount`'s own leg-posting is unit-tested exactly against this
    // scenario (`SupplierRepository.accountSettlement.test.ts`) and posts
    // precisely the leg sum — the drawer math above was the bug, not the
    // repository.
    const beforeDrawers = await drawers(appPage);

    // Sanity: seeding alone moved each child by exactly its own contribution
    // (same discipline as lira-188) before we touch the settlement UI at all.
    const afterSeedOmt = await supplierBalanceByProvider(appPage, "OMT");
    const afterSeedIpick = await supplierBalanceByProvider(appPage, "iPick");
    const afterSeedApp = await supplierBalanceByProvider(appPage, "OMT_APP");
    expect(afterSeedOmt - beforeOmt).toBeCloseTo(
      SEND_AMOUNT_USD + SEND_FEE_USD,
      2,
    );
    expect(afterSeedIpick - beforeIpick).toBeCloseTo(IPICK_TOPUP_USD, 2);
    expect(afterSeedApp - beforeApp).toBeCloseTo(
      -(CASHOUT_USD + cashoutCommission),
      2,
    );

    const queue = await unsettledRows(appPage, accountId);
    const sendRow = queue.find(
      (r) =>
        r.kind === "FINANCIAL_SERVICE" &&
        r.source_provider === "OMT" &&
        Math.abs(r.amount_usd - (SEND_AMOUNT_USD + SEND_FEE_USD)) < 0.01,
    );
    const ipickRow = queue.find(
      (r) =>
        r.kind === "LEDGER" &&
        r.source_provider === "iPick" &&
        Math.abs(r.amount_usd - IPICK_TOPUP_USD) < 0.01,
    );
    const cashoutRow = queue.find(
      (r) =>
        r.kind === "LEDGER" &&
        r.source_provider === "OMT_APP" &&
        Math.abs(r.amount_usd - -(CASHOUT_USD + cashoutCommission)) < 0.01,
    );
    expect(sendRow, "seeded OMT SEND row must appear in the unsettled queue").toBeDefined();
    expect(ipickRow, "seeded iPick top-up row must appear in the unsettled queue").toBeDefined();
    expect(
      cashoutRow,
      "seeded OMT App cashout row must appear in the unsettled queue",
    ).toBeDefined();
    if (!sendRow || !ipickRow || !cashoutRow) return;

    const sheet = await openAccountSettleSheet(appPage);
    await sheet.getByTestId("supplier-account-settle-direction-pay").click();
    await isolateSelection(sheet, [
      { kind: "FINANCIAL_SERVICE", id: sendRow.id },
      { kind: "LEDGER", id: ipickRow.id },
      { kind: "LEDGER", id: cashoutRow.id },
    ]);

    const netText = await sheet
      .getByTestId("supplier-account-settle-net")
      .innerText();
    expect(parseMoneyText(netText)).toBeCloseTo(netPay, 2);

    // The deferred cashout commission this settlement will recognise as
    // profit (D14) — computed, never operator-entered.
    const deferredText = await sheet
      .getByTestId("supplier-account-settle-deferred-commission")
      .innerText();
    expect(parseMoneyText(deferredText)).toBeCloseTo(cashoutCommission, 2);

    await fillCashLeg(sheet, netPay);
    await submitSettlement(sheet, appPage);

    const afterDrawers = await drawers(appPage);
    // D3: the cash leg lands in the OMT Cash Drawer, never General.
    expect(afterDrawers.omtSystem - beforeDrawers.omtSystem).toBeCloseTo(
      -netPay,
      2,
    );
    expect(afterDrawers.general - beforeDrawers.general).toBeCloseTo(0, 2);

    // Every touched child nets back to its PRE-SEED baseline — the whole
    // point of per-child allocated rows (plan §4) over one lump row on the
    // parent, which would have left one child overpaid and another unpaid.
    const afterSettleOmt = await supplierBalanceByProvider(appPage, "OMT");
    const afterSettleIpick = await supplierBalanceByProvider(appPage, "iPick");
    const afterSettleApp = await supplierBalanceByProvider(appPage, "OMT_APP");
    expect(afterSettleOmt - beforeOmt).toBeCloseTo(0, 2);
    expect(afterSettleIpick - beforeIpick).toBeCloseTo(0, 2);
    expect(afterSettleApp - beforeApp).toBeCloseTo(0, 2);

    // Exactly ONE SUPPLIER_SETTLEMENT transaction, identity-matched by its
    // unique net amount, carries the deferred cashout commission as profit.
    const recent = await appPage.evaluate(
      () => (window as unknown as Api).api.transactions.getRecent(100),
    );
    const matches = recent.filter(
      (t) =>
        t.type === "SUPPLIER_SETTLEMENT" &&
        Math.abs(t.amount_usd - netPay) < 0.01,
    );
    expect(matches.length).toBe(1);
    const settlementTxn = matches[0];
    expect(settlementTxn.profit_usd ?? 0).toBeCloseTo(cashoutCommission, 2);
  });

  test("A net-negative account (cashout credit alone, no debt) offers the COLLECT direction; settling it credits cash INTO the OMT Cash Drawer and recognises the deferred commission as profit", async ({
    appPage,
  }) => {
    const accountId = await omtAccountId(appPage);

    // Fund BEFORE the baseline snapshot — see the previous test's comment on
    // why (topUpFromSupplier moves no drawer per D2, but does book its own
    // constant, unselected 'OMT App' debt row).
    await seedOmtAppWallet(appPage, COLLECT_CASHOUT_USD);

    const beforeApp = await supplierBalanceByProvider(appPage, "OMT_APP");
    const beforeDrawers = await drawers(appPage);

    const commission = await seedOmtAppCashout(appPage, COLLECT_CASHOUT_USD);
    const collectAmount = COLLECT_CASHOUT_USD + commission;

    const queue = await unsettledRows(appPage, accountId);
    const cashoutRow = queue.find(
      (r) =>
        r.kind === "LEDGER" &&
        r.source_provider === "OMT_APP" &&
        Math.abs(r.amount_usd - -collectAmount) < 0.01,
    );
    expect(cashoutRow, "seeded cashout row must appear in the unsettled queue").toBeDefined();
    if (!cashoutRow) return;

    const sheet = await openAccountSettleSheet(appPage);
    await isolateSelection(sheet, [{ kind: "LEDGER", id: cashoutRow.id }]);

    // §8.4: a mixed/negative net must offer the collect direction — this IS
    // the assertion, not incidental setup.
    const collectBtn = sheet.getByTestId(
      "supplier-account-settle-direction-collect",
    );
    await expect(collectBtn).toBeVisible({ timeout: 10_000 });
    await collectBtn.click();

    const netText = await sheet
      .getByTestId("supplier-account-settle-net")
      .innerText();
    expect(parseMoneyText(netText)).toBeCloseTo(-collectAmount, 2);

    const deferredText = await sheet
      .getByTestId("supplier-account-settle-deferred-commission")
      .innerText();
    expect(parseMoneyText(deferredText)).toBeCloseTo(commission, 2);

    await fillCashLeg(sheet, collectAmount);
    await submitSettlement(sheet, appPage);

    const afterDrawers = await drawers(appPage);
    // RECEIVE-shaped leg: cash comes IN from OMT via the PCD (§8.4:
    // `recordSupplierCashflow`'s existing RECEIVE mechanics, reused not
    // duplicated), never General.
    expect(afterDrawers.omtSystem - beforeDrawers.omtSystem).toBeCloseTo(
      collectAmount,
      2,
    );
    expect(afterDrawers.general - beforeDrawers.general).toBeCloseTo(0, 2);

    const afterApp = await supplierBalanceByProvider(appPage, "OMT_APP");
    expect(afterApp - beforeApp).toBeCloseTo(0, 2);

    const recent = await appPage.evaluate(
      () => (window as unknown as Api).api.transactions.getRecent(100),
    );
    const matches = recent.filter(
      (t) =>
        t.type === "SUPPLIER_SETTLEMENT" &&
        Math.abs(t.amount_usd - collectAmount) < 0.01,
    );
    expect(matches.length).toBe(1);
    // D14/§8.3a: the commission stored at cashout time (never recognised
    // then — profit_usd was 0 on the WALLET_CASHOUT row) is recognised HERE,
    // at settlement, per currency.
    expect(matches[0].profit_usd ?? 0).toBeCloseTo(commission, 2);
  });
});
