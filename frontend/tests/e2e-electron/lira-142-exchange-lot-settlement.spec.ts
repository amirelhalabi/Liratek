/**
 * E2E: Exchange Lot Settlement — real-cost-basis FIFO profit for exotic
 * currencies (docs/plans/todo_plans/EXCHANGE_LOT_SETTLEMENT.md).
 *
 * Drives the REAL Exchange page UI end-to-end (layer-seam discipline — the
 * frontend computes/previews before it sends, so hand-built IPC payloads
 * cannot see a frontend↔repository seam bug the way lira-114's
 * for-partner-services precedent found one). Mirrors the owner's own
 * live-test flow:
 *
 *   1. BUY 217 EUR (From=EUR, To=USD) — opens a cost-basis lot; the exotic
 *      leg must stamp ZERO profit (Q8 — spread profit is replaced entirely
 *      for lot-tracked currencies).
 *   2. Partial SELL-BACK (From=USD, To=EUR) — settles part of the lot FIFO;
 *      the prominent exotic-payout box (data-testid="exchange-exotic-payout",
 *      FIX 6, owner-reported 2026-08-23) must show the real EUR quantity
 *      about to be handed to the customer — the box exists BECAUSE the
 *      operator previously had no way to see this. Realized profit =
 *      qty × (proceeds − cost) from the settlement's OWN stamped rates.
 *   3. History — the BUY row's status flips to Partial with a remaining
 *      quantity and an accumulated realized-profit figure; the SELL row's
 *      settlement breakdown expands and shows a LOT-basis row.
 *   4. Positions panel — the EUR row shows the open (unsold) quantity and an
 *      average cost equal to the BUY's own unit cost.
 *   5. Reversal guard (Q12) — voiding the partially-settled BUY from the
 *      Transactions table is BLOCKED with the "sell first" message and
 *      changes nothing; voiding the SELL succeeds and the BUY's lot is
 *      fully restored (History status back to Open/217; drawers net back to
 *      exactly where they stood right after the BUY — rule 20).
 *
 * Assertion discipline (CLAUDE.md rule 15 / README "Assertion discipline"):
 * every drawer/position/history number is a DELTA snapshotted immediately
 * around its own action, matched by IDENTITY (a unique client-name marker
 * plus the distinctive EUR/USD amounts) — never `getRecent()[0]`, never an
 * absolute drawer total, never a hardcoded rate or profit figure. EUR is a
 * default-seeded currency (electron-app/create_db.sql: is_active, with a
 * default exchange_rates row) and no other spec in this suite ever touches
 * it (grepped), so this is the first EUR activity in the shared per-worker
 * DB — see the README's "Known couplings & hazards" entry for this file.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page, Locator } from "@playwright/test";

test.describe.configure({ retries: 0 });

const RUN_ID = Date.now();
const BUY_CLIENT = `L142-EXLOT-BUY-${RUN_ID}`;
const SELL_CLIENT = `L142-EXLOT-SELL-${RUN_ID}`;
const BUY_AMOUNT_EUR = 217;
// Chosen to realize ≈100 EUR at the e2e seed's default EUR rate
// (create_db.sql: buy 1.16 / sell 1.20) — a PARTIAL settlement of the 217
// EUR lot either way. The exact resulting quantity is never assumed below;
// every assertion derives from the app's own persisted/rendered numbers.
const SELL_AMOUNT_USD = 120;

// ─── Types (extend the ambient window.api.exchange.getHistory() shape with
// the fields this spec needs that aren't in that narrower ambient type —
// verified present at runtime against Exchange/index.tsx's own ExchangeTx
// type and HistoryModal.tsx, which render client_name/profit_usd/
// leg1_profit_usd/leg2_profit_usd from the very same IPC response). ───────

type ExchangeHistoryRow = Awaited<
  ReturnType<typeof window.api.exchange.getHistory>
>[number] & {
  client_name?: string | null;
  profit_usd?: number | null;
  leg1_profit_usd?: number | null;
  leg2_profit_usd?: number | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseNum(text: string): number {
  const m = text.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

async function getExchangeHistory(page: Page): Promise<ExchangeHistoryRow[]> {
  const rows = await page.evaluate(() => window.api.exchange.getHistory());
  return rows as ExchangeHistoryRow[];
}

/** General drawer's USD/EUR balances via the app's own dynamic-balances read
 *  (ClosingRepository.getSystemExpectedBalancesDynamic — a raw
 *  `drawer_balances` projection keyed by drawer/currency, used elsewhere for
 *  the checkpoint-timeline "expected" column). There is no other IPC read
 *  exposing an arbitrary (non-USD/LBP) drawer currency to the renderer. */
async function generalBalances(
  page: Page,
): Promise<{ usd: number; eur: number }> {
  return page.evaluate(async () => {
    const all = await window.api.closing.getSystemExpectedBalancesDynamic();
    const general = all["General"] ?? {};
    return { usd: general["USD"] ?? 0, eur: general["EUR"] ?? 0 };
  });
}

async function eurOpenQty(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const res = await window.api.exchangeLots.getPositions();
    const row = (res.data ?? []).find((p) => p.currency_code === "EUR");
    return row?.open_qty ?? 0;
  });
}

async function unifiedExchangeTxn(page: Page, exchangeId: number) {
  return page.evaluate(async (id) => {
    const recent = await window.api.transactions.getRecent(50, {
      source_table: "exchange_transactions",
    });
    return recent.find((t) => t.source_id === id && !t.reverses_id) ?? null;
  }, exchangeId);
}

/**
 * Provision this spec's own prerequisite instead of assuming EUR survives
 * as active from the create_db.sql seed (the same discipline the suite's
 * other seed helpers — seedClient/seedProduct/seedExchangeRate — already
 * use for their own fixtures). Confirmed root cause (coordinator, querying
 * the actual accumulated worker DBs at the end of a full-suite run): the
 * setup wizard (electron-app/handlers/setupHandlers.ts:221) deactivates any
 * currency not explicitly selected during setup, and reaches EUR under
 * conditions present in a full-suite run but not isolation.
 *
 * Uses the app's own admin API — `currencies:update` (window.api.currencies
 * .update), the same channel Settings > Currency Manager calls, admin-only
 * via `requireRole(event.sender.id, ["admin"])` (electron-app/handlers/
 * currencyHandlers.ts) — never the Settings UI (provisioning isn't what
 * this spec tests). Idempotent: already-active is a no-op, verified by
 * reading `currencies:list` first; only inactive EUR triggers the write.
 *
 * `currencies:update`'s success does NOT by itself make the row's activation
 * visible in the ALREADY-RUNNING renderer: CurrencyContext
 * (frontend/src/contexts/CurrencyContext.tsx) loads `currencies` exactly
 * ONCE, at CurrencyProvider's mount (which sits above HashRouter — every
 * navigation in this whole suite is a hash change, never a remount of that
 * provider) and is never refetched — there is no "currencies changed"
 * listener wired to it (CurrencyManager.tsx dispatches a
 * `window.dispatchEvent(new Event("currencies-changed"))`, but only
 * ModulesManager.tsx subscribes to it) and no polling. So on the cold path
 * (EUR really was inactive) a same-URL `page.reload()` is required to force
 * a fresh CurrencyProvider mount that reads the now-corrected DB row. This
 * is deliberately narrower than the general "never reload — it drops the
 * session" guidance (README/CLAUDE.md): it is safe here specifically
 * because auth survives it by design — the main-process session Map
 * (electron-app/session.ts `sessions`) is keyed by the STABLE webContents
 * id, which a content reload does not recreate, and the renderer
 * separately restores its own login state from the persisted session token
 * (frontend/src/features/auth/context/AuthContext.tsx reads
 * `localStorage.sessionToken`; session.ts's `storeSessionTokenToFile` doc
 * comment says outright: "for persistence across refreshes"). The reload
 * only fires on this cold path — the common/idempotent (already-active)
 * case returns above it and never reloads. NOTE: this exact reload path was
 * not exercised by a live run at the time this was written (the coordinator
 * runs the suite) — if it ever mis-restores the session, that is the first
 * thing to re-check.
 */
async function ensureEurActive(page: Page): Promise<void> {
  type CurrencyRow = { id: number; code: string; is_active: number };
  type CurrencyUpdateApi = {
    update: (data: {
      id: number;
      is_active: number;
    }) => Promise<{ success: boolean; error?: string }>;
  };

  const eur = await page.evaluate(async () => {
    const list = (await window.api.currencies.list()) as unknown as CurrencyRow[];
    return list.find((c) => c.code === "EUR") ?? null;
  });
  if (!eur) {
    throw new Error(
      "EUR currency row not found via currencies:list — cannot provision lira-142's prerequisite",
    );
  }
  if (eur.is_active) return; // Idempotent: already active, nothing to do.

  const result = await page.evaluate(async (id) => {
    const api = window.api.currencies as unknown as CurrencyUpdateApi;
    return api.update({ id, is_active: 1 });
  }, eur.id);
  if (!result.success) {
    throw new Error(
      `Failed to activate EUR currency via currencies:update: ${result.error ?? "unknown error"}`,
    );
  }

  await page.reload();
  await page.waitForSelector('nav a[href], [data-testid="sidebar"]', {
    timeout: 15_000,
  });
}

/** The "From"/"To" CurrencySelector's root div — located via its uppercase
 *  label span, since CurrencySelector (Exchange/index.tsx) carries no
 *  data-testid of its own. */
function fromBox(page: Page): Locator {
  return page
    .getByText("From", { exact: true })
    .locator("xpath=following-sibling::div[1]");
}
function toBox(page: Page): Locator {
  return page
    .getByText("To", { exact: true })
    .locator("xpath=following-sibling::div[1]");
}

/**
 * CurrencySelector (Exchange/index.tsx ~line 174) renders USD/LBP as two
 * fixed buttons plus a SEARCHABLE "More" dropdown for every other currency:
 * a search `<input type="text">` (placeholder "Search currency...") filters
 * `dropdownOptions` — EUR (from CurrencyContext, if active) always leads the
 * list, followed by whatever the live FX-rate feed (a real network call,
 * `fetchLiveRatesSnapshot`, refired on every Exchange-page mount) returns.
 * Each option button renders `<span>{code}</span><span>{symbol}</span>`
 * with no separating space, so a plain `hasText: code` filter is a
 * SUBSTRING match — it would also match a hypothetical longer code (e.g.
 * "EURX") that happens to start with "EUR". Matching the code `<span>`'s
 * own text EXACTLY avoids that.
 *
 * CONFIRMED root cause of the first live full-suite failure (line 142's
 * `option.toBeVisible` timing out for 25s — "element(s) not found" — only
 * on the 252-spec-accumulated shared DB, never in isolation): EUR was
 * genuinely `is_active = 0` in that DB, not a slow render. The setup wizard
 * (electron-app/handlers/setupHandlers.ts:221,
 * `UPDATE currencies SET is_active = ? WHERE code = ?`) deactivates any
 * currency not selected during setup, and reaches EUR under conditions
 * present in a full-suite run but not in isolation (verified by querying
 * both accumulated worker DBs directly — `currency_modules` still has EUR
 * enabled for exchange and its `exchange_rates` row survives; only
 * `is_active` was the blocker). `ensureEurActive()` below provisions this
 * prerequisite itself instead of assuming the create_db.sql seed default
 * survives — the retry loop here stays as generic defensive hardening for
 * a genuinely slow render/click (still correct, just not what actually
 * broke the first run); each attempt is idempotent — it only (re)opens the
 * dropdown when the panel isn't already open, so a retry can never toggle
 * an already-open panel closed.
 */
async function pickCurrency(box: Locator, code: "USD" | "LBP" | "EUR") {
  if (code === "USD" || code === "LBP") {
    await box.getByRole("button", { name: code, exact: true }).click();
    return;
  }

  const panel = box.locator("div.absolute");
  const searchInput = panel.locator('input[type="text"]');
  // Exact text match on the option's own code span — never the whole
  // button's `hasText` (which also contains the symbol and would
  // substring-match a longer code).
  const codeSpan = panel.getByText(code, { exact: true });
  const option = codeSpan.locator("xpath=ancestor::button[1]");

  const deadline = Date.now() + 25_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (!(await panel.isVisible().catch(() => false))) {
        await box.locator("button").nth(2).click();
      }
      await expect(panel).toBeVisible({ timeout: 3_000 });
      await searchInput.fill(code);
      await expect(option).toBeVisible({ timeout: 3_000 });
      await option.click();
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw (
    lastError ??
    new Error(`pickCurrency(${code}): option never became visible`)
  );
}

function amountInInput(page: Page): Locator {
  return page
    .locator("label", { hasText: "You Receive" })
    .locator("xpath=following-sibling::div[1]//input");
}

function clientNameInput(page: Page): Locator {
  return page.locator('input[placeholder="Walk-in Client"]');
}

async function exoticPayoutQty(page: Page): Promise<number> {
  const raw = await page
    .getByTestId("exchange-exotic-payout")
    .locator("input")
    .inputValue();
  return parseNum(raw);
}

/**
 * The open History modal's root — scoped explicitly. PositionsPanel
 * (Q16) is ALWAYS mounted on the same /exchange page, as a sibling, not
 * unmounted while the modal is open — it renders its own `<table>` with a
 * `<tbody><tr>` per open position, and once this spec's lot exists that row
 * contains "EUR" plus numbers that can look like "217"/"120" (open qty,
 * avg cost). A `tbody tr` / `getByText("EUR")` query run against the whole
 * `page` can therefore match BOTH the modal's row and the panel's row —
 * exactly the strict-mode collision that broke the first live run on the
 * bare `getByRole("button", { name: "History" })` (a substring match
 * against PositionsPanel's own "View EUR history" button). Every
 * History-modal locator below is built from this root, never from `page`
 * directly.
 */
function historyModal(page: Page): Locator {
  return page
    .locator("div.fixed.inset-0.z-50")
    .filter({ hasText: "Exchange History" });
}

test.describe("Exchange lot settlement — FIFO cost-basis profit, driven through the real UI", () => {
  test("BUY EUR opens a zero-profit lot; a partial SELL-BACK realizes FIFO profit and shows the exotic payout qty; a partially-settled BUY is unvoidable until its sell is voided (Q8/Q10/Q12/Q16)", async ({
    appPage,
  }) => {
    // ─── Phase 1: BUY 217 EUR (From=EUR, To=USD) ─────────────────────────
    await navigateTo(appPage, "/exchange");

    // Provision this spec's own prerequisite (see ensureEurActive's doc
    // comment) — may reload the page on the cold path, so it runs before
    // any other wait/interaction below, and everything after it re-checks
    // the page from scratch regardless of whether a reload happened.
    await ensureEurActive(appPage);

    await expect(
      fromBox(appPage).getByRole("button", { name: "USD", exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    await pickCurrency(fromBox(appPage), "EUR");
    await pickCurrency(toBox(appPage), "USD");
    await amountInInput(appPage).fill(String(BUY_AMOUNT_EUR));
    await clientNameInput(appPage).fill(BUY_CLIENT);

    // toCurrency = USD ⇒ canSplitPayout ⇒ the button always reads "Proceed
    // to Payout" and routes through the real PaymentSheet (never partner
    // mode here, so this is unconditional).
    const proceedBtn = appPage.getByRole("button", {
      name: "Proceed to Payout",
    });
    await expect(proceedBtn).toBeEnabled({ timeout: 8_000 });

    const beforeBuy = await generalBalances(appPage);
    const eurOpenBeforeBuy = await eurOpenQty(appPage);

    await proceedBtn.click();
    // MultiPaymentInput's single default CASH line auto-syncs to the full
    // total on mount (lira-063 precedent) — no manual fill needed.
    const payBtn = appPage
      .locator("button")
      .filter({ hasText: /^Pay / })
      .last();
    await expect(payBtn).toBeVisible({ timeout: 5_000 });
    await payBtn.click();
    await expect(payBtn).toBeHidden({ timeout: 8_000 });

    // Identity: the BUY row exists with the right pair + distinctive amount
    // + unique client marker.
    await expect
      .poll(
        async () => {
          const rows = await getExchangeHistory(appPage);
          return rows.some(
            (r) =>
              r.client_name === BUY_CLIENT &&
              r.from_currency === "EUR" &&
              r.to_currency === "USD" &&
              Number(r.amount_in) === BUY_AMOUNT_EUR,
          );
        },
        { timeout: 10_000 },
      )
      .toBe(true);

    const historyAfterBuy = await getExchangeHistory(appPage);
    const buyRow = historyAfterBuy.find((r) => r.client_name === BUY_CLIENT);
    if (!buyRow) throw new Error("BUY exchange row not found by identity");
    const buyExchangeId = buyRow.id;
    const buyAmountOutUsd = Number(buyRow.amount_out);

    // Deltas by identity, never absolutes (rule 15): EUR moves by exactly
    // what we typed; USD moves by exactly what the server stamped as
    // amount_out for this row (never a hand-derived rate).
    const afterBuy = await generalBalances(appPage);
    expect(afterBuy.eur - beforeBuy.eur).toBeCloseTo(BUY_AMOUNT_EUR, 4);
    expect(afterBuy.usd - beforeBuy.usd).toBeCloseTo(-buyAmountOutUsd, 2);

    // Q8 — a buy of a lot-tracked (exotic) currency stamps ZERO profit,
    // regardless of the spread the UI would otherwise have shown pre-lot.
    const buyProfit = Number(buyRow.leg1_profit_usd ?? buyRow.profit_usd);
    expect(buyProfit).toBeCloseTo(0, 6);

    // Positions (Q16): the EUR lot opened for exactly what was bought.
    const eurOpenAfterBuy = await eurOpenQty(appPage);
    expect(eurOpenAfterBuy - eurOpenBeforeBuy).toBeCloseTo(BUY_AMOUNT_EUR, 4);

    // ─── Phase 2: partial SELL-BACK (From=USD, To=EUR) ───────────────────
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/exchange");
    await expect(
      fromBox(appPage).getByRole("button", { name: "USD", exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    await pickCurrency(fromBox(appPage), "USD");
    await pickCurrency(toBox(appPage), "EUR");
    await amountInInput(appPage).fill(String(SELL_AMOUNT_USD));
    await clientNameInput(appPage).fill(SELL_CLIENT);

    // FIX 6 (owner-reported 2026-08-23) regression guard: the prominent
    // exotic-payout box must show a real, non-empty EUR quantity BEFORE
    // submit — this box exists BECAUSE the till operator previously had no
    // way to see how many EUR to hand the customer.
    await expect(appPage.getByTestId("exchange-exotic-payout")).toBeVisible({
      timeout: 5_000,
    });
    await expect
      .poll(async () => exoticPayoutQty(appPage), { timeout: 5_000 })
      .toBeGreaterThan(0);
    const previewEurQty = await exoticPayoutQty(appPage);
    // Sanity: must be a PARTIAL settlement of the 217 EUR lot (the whole
    // point of the scenario — Q12 needs "some left over"). The exact figure
    // is asserted from the server's own persisted amount_out below, never
    // guessed here.
    expect(previewEurQty).toBeGreaterThan(1);
    expect(previewEurQty).toBeLessThan(BUY_AMOUNT_EUR);

    const confirmBtn = appPage.getByRole("button", {
      name: "Confirm Exchange",
    });
    // Disabled while the debounced FIFO realized-profit preview is in
    // flight (toIsLotTracked && lotPreviewLoading) — wait it out.
    await expect(confirmBtn).toBeEnabled({ timeout: 8_000 });

    const beforeSell = await generalBalances(appPage);

    await confirmBtn.click();
    // Q10 — a legitimate loss is never blocked, only confirmed. Defensive
    // only: the seed's default EUR rates (buy 1.16 < sell 1.20) make this a
    // real profit, so this branch is not expected to fire.
    const lossConfirm = appPage.getByRole("button", {
      name: "Proceed Anyway",
    });
    if (await lossConfirm.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await lossConfirm.click();
    }

    await expect
      .poll(
        async () => {
          const rows = await getExchangeHistory(appPage);
          return rows.some(
            (r) =>
              r.client_name === SELL_CLIENT &&
              r.from_currency === "USD" &&
              r.to_currency === "EUR" &&
              Number(r.amount_in) === SELL_AMOUNT_USD,
          );
        },
        { timeout: 10_000 },
      )
      .toBe(true);

    const historyAfterSell = await getExchangeHistory(appPage);
    const sellRow = historyAfterSell.find((r) => r.client_name === SELL_CLIENT);
    if (!sellRow) throw new Error("SELL exchange row not found by identity");
    const sellExchangeId = sellRow.id;
    const actualEurSold = Number(sellRow.amount_out);
    // The box's live preview must match what actually got submitted.
    expect(actualEurSold).toBeCloseTo(previewEurQty, 2);

    const afterSell = await generalBalances(appPage);
    expect(afterSell.eur - beforeSell.eur).toBeCloseTo(-actualEurSold, 4);
    expect(afterSell.usd - beforeSell.usd).toBeCloseTo(SELL_AMOUNT_USD, 2);

    // Realized profit = qty × (proceeds − cost), computed from the
    // settlement's OWN stamped rates — never a hardcoded number.
    const breakdown = await appPage.evaluate(async (id) => {
      const res = await window.api.exchangeLots.getBreakdown(id);
      return res.data ?? { asSettler: [], againstSource: [] };
    }, sellExchangeId);
    expect(breakdown.asSettler.length).toBeGreaterThan(0);
    const recomputedProfit = breakdown.asSettler.reduce(
      (sum, s) => sum + s.qty * (s.unit_proceeds_usd - s.unit_cost_usd),
      0,
    );
    const stampedProfit = breakdown.asSettler.reduce(
      (sum, s) => sum + s.profit_usd,
      0,
    );
    expect(stampedProfit).toBeCloseTo(recomputedProfit, 2);
    expect(Math.abs(stampedProfit)).toBeGreaterThan(0.01); // a real, nonzero realization
    const sellRowProfit = Number(sellRow.leg1_profit_usd ?? sellRow.profit_usd);
    expect(sellRowProfit).toBeCloseTo(stampedProfit, 2);

    // ─── Phase 3: History — BUY shows Partial + remaining + realized; the
    // SELL row's breakdown expands with a LOT-basis settlement row ────────
    // Exact match — PositionsPanel's own "View EUR history" button
    // (title attribute) is a substring match for the bare name "History",
    // which broke the first live run of this spec (strict-mode violation).
    await appPage
      .getByRole("button", { name: "History", exact: true })
      .click();
    await expect(historyModal(appPage)).toBeVisible({ timeout: 5_000 });

    // Identity within the modal (scoped via historyModal() — see its doc
    // comment for why an unscoped `page`-level query collides with
    // PositionsPanel's own always-mounted table): HistoryModal renders no
    // client-name cell, so match by the "EUR" pair (unique to this spec's
    // two rows in the whole shared DB — no other spec ever creates a EUR
    // exchange) plus each row's own distinctive Amount-In figure.
    const buyHistoryRow = historyModal(appPage)
      .locator("tbody tr")
      .filter({ hasText: "EUR" })
      .filter({ hasText: String(BUY_AMOUNT_EUR) });
    await expect(buyHistoryRow).toBeVisible({ timeout: 8_000 });
    // Not currently expected to be needed (our two rows are the newest
    // activity in the whole shared DB, so they sort at/near the top of the
    // 50-row-capped, presumably created_at-DESC list) but the modal's body
    // is an unwindowed `overflow-auto` container holding up to 50 real
    // rows — scroll defensively before reading cell text, since `toBeVisible`
    // alone does not guarantee a row sitting below the current scroll
    // offset of an ancestor is actually within its visible viewport.
    await buyHistoryRow.scrollIntoViewIfNeeded();
    // Columns: Time, Pair, Amount In, Amount Out, Via, Status, Remaining,
    // Realized, Profit, Edit (HistoryModal.tsx column list, 0-indexed).
    await expect(buyHistoryRow.locator("td").nth(5)).toContainText("Partial");
    const remainingAfterSellText = await buyHistoryRow
      .locator("td")
      .nth(6)
      .innerText();
    expect(parseNum(remainingAfterSellText)).toBeCloseTo(
      BUY_AMOUNT_EUR - actualEurSold,
      2,
    );
    const realizedAfterSellText = await buyHistoryRow
      .locator("td")
      .nth(7)
      .innerText();
    expect(parseNum(realizedAfterSellText)).toBeCloseTo(stampedProfit, 2);

    const sellHistoryRow = historyModal(appPage)
      .locator("tbody tr")
      .filter({ hasText: "EUR" })
      .filter({ hasText: String(SELL_AMOUNT_USD) });
    await expect(sellHistoryRow).toBeVisible({ timeout: 8_000 });
    await sellHistoryRow.scrollIntoViewIfNeeded();
    await sellHistoryRow.click();
    // The expandable settlement breakdown renders as the very next <tr>
    // sibling (HistoryModal.tsx's inline second-row pattern).
    const sellBreakdownRow = sellHistoryRow.locator(
      "xpath=following-sibling::tr[1]",
    );
    await expect(sellBreakdownRow).toBeVisible({ timeout: 8_000 });
    await expect(sellBreakdownRow).toContainText("Settled from lots");
    await expect(sellBreakdownRow).toContainText("Unit Cost");
    await expect(sellBreakdownRow).toContainText("Unit Proceeds");
    // Basis = LOT (not MARKET) — the 217 EUR lot fully covers this sale.
    await expect(sellBreakdownRow).toContainText("LOT");

    // ─── Phase 4: Positions panel — EUR row shows open qty ≈ remaining and
    // an avg cost equal to the BUY's own unit cost ────────────────────────
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/exchange");
    const positionsHeading = appPage.getByRole("heading", {
      name: "Open Positions",
    });
    const positionsCard = positionsHeading.locator(
      "xpath=ancestor::div[contains(@class,'rounded-xl')][1]",
    );
    const eurPositionRow = positionsCard
      .locator("tbody tr")
      .filter({ hasText: "EUR" });
    await expect(eurPositionRow).toBeVisible({ timeout: 8_000 });
    await eurPositionRow.scrollIntoViewIfNeeded();
    const openQtyText = await eurPositionRow.locator("td").nth(1).innerText();
    expect(parseNum(openQtyText)).toBeCloseTo(
      BUY_AMOUNT_EUR - actualEurSold,
      2,
    );
    const avgCostText = await eurPositionRow.locator("td").nth(2).innerText();
    // The avg cost of the REMAINING (unsold) portion of a single FIFO lot is
    // unchanged by a partial sale — it must still equal the buy's own unit
    // cost (amount_out ÷ amount_in from the BUY row itself).
    expect(parseNum(avgCostText)).toBeCloseTo(
      buyAmountOutUsd / BUY_AMOUNT_EUR,
      3,
    );

    // ─── Phase 5: reversal guard (Q12) — BUY blocked sell-first; SELL
    // voidable; BUY's lot fully restored; drawers net back ────────────────
    await navigateTo(appPage, "/audit");

    const dialogLog: string[] = [];
    appPage.on("dialog", (d) => dialogLog.push(d.message()));

    const buyAuditRow = appPage
      .locator("tbody tr")
      .filter({ hasText: BUY_CLIENT });
    await expect(buyAuditRow).toBeVisible({ timeout: 10_000 });
    await buyAuditRow.scrollIntoViewIfNeeded();
    const buyVoidBtn = buyAuditRow.getByRole("button", { name: /^Void$/ });
    await expect(buyVoidBtn).toBeVisible();

    let seen = dialogLog.length;
    await buyVoidBtn.click();
    // Two dialogs: the confirm(), then TransactionsViewer's own
    // `alert("Failed: " + error)` once the guard rejects it.
    await expect
      .poll(() => dialogLog.length, { timeout: 8_000 })
      .toBeGreaterThanOrEqual(seen + 2);
    const [confirmMsg, blockedMsg] = dialogLog.slice(seen);
    expect(confirmMsg).toMatch(/Void this transaction/i);
    expect(blockedMsg).toMatch(/^Failed:/);
    expect(blockedMsg).toMatch(/already been partially or fully sold/i);
    expect(blockedMsg).toMatch(/void the consuming sell transaction/i);

    // Nothing moved: the BUY's own unified transaction is still ACTIVE.
    const buyTxnAfterBlock = await unifiedExchangeTxn(appPage, buyExchangeId);
    expect(buyTxnAfterBlock?.status).toBe("ACTIVE");

    const sellAuditRow = appPage
      .locator("tbody tr")
      .filter({ hasText: SELL_CLIENT });
    await expect(sellAuditRow).toBeVisible({ timeout: 10_000 });
    await sellAuditRow.scrollIntoViewIfNeeded();
    const sellVoidBtn = sellAuditRow.getByRole("button", { name: /^Void$/ });
    await expect(sellVoidBtn).toBeVisible();

    seen = dialogLog.length;
    await sellVoidBtn.click();
    await expect
      .poll(
        async () => (await unifiedExchangeTxn(appPage, sellExchangeId))?.status,
        { timeout: 10_000 },
      )
      .toBe("VOIDED");
    // No failure alert this time — only the confirm() dialog fired.
    expect(dialogLog.slice(seen).some((m) => m.startsWith("Failed:"))).toBe(
      false,
    );

    // The BUY's lot is fully restored: History status back to Open/217.
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/exchange");
    await appPage
      .getByRole("button", { name: "History", exact: true })
      .click();
    await expect(historyModal(appPage)).toBeVisible({ timeout: 5_000 });
    const buyHistoryRowAfterReversal = historyModal(appPage)
      .locator("tbody tr")
      .filter({ hasText: "EUR" })
      .filter({ hasText: String(BUY_AMOUNT_EUR) });
    await expect(buyHistoryRowAfterReversal).toBeVisible({ timeout: 8_000 });
    await buyHistoryRowAfterReversal.scrollIntoViewIfNeeded();
    await expect(
      buyHistoryRowAfterReversal.locator("td").nth(5),
    ).toContainText("Open");
    const remainingAfterReversalText = await buyHistoryRowAfterReversal
      .locator("td")
      .nth(6)
      .innerText();
    expect(parseNum(remainingAfterReversalText)).toBeCloseTo(
      BUY_AMOUNT_EUR,
      2,
    );

    // Drawers net back to exactly where they stood right after the BUY —
    // the SELL's own create+void nets to 0 (rule 20).
    await expect
      .poll(async () => (await generalBalances(appPage)).eur, {
        timeout: 8_000,
      })
      .toBeCloseTo(afterBuy.eur, 4);
    const afterReversal = await generalBalances(appPage);
    expect(afterReversal.usd).toBeCloseTo(afterBuy.usd, 2);
  });
});
