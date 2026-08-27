/**
 * E2E: Exchange — operator rate override on a CROSS-currency (via-USD)
 * exchange, driven through the REAL Exchange form. Extends
 * lira-142-exchange-lot-settlement.spec.ts (the direct-pair lot lifecycle)
 * to the cross-currency override path that spec never exercises (lira-142
 * only ever submits at the DEFAULT rates — it never fills a
 * `exchange-cross-rate-input-*` field).
 *
 * Three separate guarantees, each isolated in its own assertion group below
 * (never inferred from one another):
 *
 * 1. SIGN-LOSS BUG (guarded by the second `test()` in this file — the
 *    "losing-override guard"). `applyCustomRates`
 *    (frontend/src/features/exchange/pages/Exchange/index.tsx) computes an
 *    overridden leg's profit as `Math.abs(marketOut − actualOut)` — for a
 *    NON-lot-tracked leg (USD/LBP on both sides here), the server TRUSTS and
 *    books this value VERBATIM (`ExchangeRepository._applyExchangeLotEffects`
 *    returns `touched: false` and leaves `leg1ProfitUsd`/`leg2ProfitUsd` at
 *    their client-submitted values whenever neither side is lot-tracked).
 *    `Math.abs` silently turns a LOSING override (the shop giving the
 *    customer a BETTER-than-market rate) into a phantom POSITIVE profit. The
 *    fix is the already-exported, correctly-signed
 *    `computeOverrideLegProfitUsd` (packages/core/src/utils/
 *    currencyConverter.ts) — this spec's second test overrides a direct
 *    USD→LBP exchange to a worse-than-market rate and asserts the booked
 *    `profit_usd` is NEGATIVE.
 *
 *    Rule 17 (traced by hand against the CURRENT pre-fix source, since this
 *    suite cannot be run from here): with the buggy `Math.abs` formula still
 *    in place, $100 USD→LBP at an applied rate of 90,200 (deliberately NOT
 *    the seeded sell_rate of 90,000 — see the loss-override rate constant
 *    below for why) vs. a market rate of 89,500 computes
 *    `diffRaw = |100×89500 − 100×90200| = 70,000`, then
 *    `profitUsd = diffRaw / market_rate = 70,000 / 89,500 ≈ +0.7821` — a
 *    POSITIVE number for what is actually a real loss to the shop (the
 *    customer walked out with 700,000 more LBP than market rate would have
 *    given them). This test's `expect(lossRow.profit_usd).toBeLessThan(0)`
 *    therefore FAILS on that pre-fix code and PASSES once `applyCustomRates`
 *    is swapped to the signed formula.
 *
 * 2. LOT COST-BASIS FIDELITY UNDER OVERRIDE (first `test()`, phases 1–2).
 *    Overriding leg 1's rate on a CROSS (via-USD) BUY of an exotic currency
 *    must set the resulting lot's `unit_cost_usd` to the OVERRIDDEN rate —
 *    not the currency's default `buy_rate`, and not anything derived from
 *    leg 2 (which is never overridden here). Traced against
 *    `ExchangeRepository._crossUsdNotional`/`_applyExchangeLotEffects`: for
 *    a toCurrency of LBP, the shared USD notional is computed via LEG 2's
 *    OWN (unmodified) rate — `crossUsdNotional = amountOut(LBP) /
 *    leg2Rate` — which round-trips back to exactly leg 1's own overridden
 *    USD notional (100 EUR × 1.12 = 112 USD) with no accumulated rounding,
 *    then `unitCostUsd = crossUsdNotional / amountIn = 112 / 100 = 1.12`.
 *    This is independent of the sign-loss bug above — the cost basis comes
 *    from the submitted RATE/amounts, never from the buggy profit math (the
 *    server also hardcodes `leg1ProfitUsd = 0` for any lot-tracked acquire
 *    leg regardless of what the client sends — Q8 below).
 *
 * 3. DEFERRAL TO SETTLEMENT (phases 1–3). Q8 (EXCHANGE_LOT_SETTLEMENT.md):
 *    a BUY of an exotic currency books ZERO profit at acquisition
 *    (`leg1_profit_usd === 0`) no matter how favorable the override — the
 *    gain vs. market the override locked in ($6.00 = (1.18 − 1.12) × 100)
 *    is DEFERRED into the lot's cost basis, not booked immediately. Phase 3
 *    fully liquidates that same lot via a plain direct USD→EUR sale at the
 *    shop's own configured sell_rate (1.20, unmodified) and proves the
 *    deferred value surfaces there: realized profit = qty × (proceeds −
 *    cost) = 100 × (1.20 − 1.12) = $8.00, cross-checked independently via
 *    `exchangeLots.getBreakdown()`'s own per-settlement figures (never a
 *    hardcoded number).
 *
 * Isolation from lira-142's own leftover EUR position (README "Known
 * couplings & hazards"): lira-142 runs earlier alphabetically and
 * deliberately leaves a 217 EUR lot OPEN. Left alone, FIFO would consume
 * THAT lot first when this file tries to sell, contaminating every
 * cost-basis/profit assertion below with a rate this file never set. Phase 0
 * writes off whatever is currently open via the admin `exchangeLots.adjust`
 * negative-qty path (Q15 — "moves no money, no drawer delta, no unified
 * transaction row", confirmed against `ExchangeLotRepository.adjust`'s own
 * doc comment) BEFORE opening this file's own lot, so `getPositions()`'s
 * `avg_unit_cost_usd` is exactly this file's own lot with nothing blended
 * in. See the README addition below for what this leaves behind.
 *
 * Assertion discipline (CLAUDE.md rule 15): every number is either read back
 * from the app's own persisted/rendered state (never hand-derived) or
 * cross-checked by an independent recomputation; rows are matched by
 * IDENTITY (a unique per-run client-name marker), never `getRecent()[0]` or
 * row position; drawer movements are DELTAS snapshotted immediately around
 * their own action.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page, Locator } from "@playwright/test";

test.describe.configure({ retries: 0 });

const RUN_ID = Date.now();
const BUY_CLIENT = `L146-XOVER-BUY-${RUN_ID}`;
const SELL_CLIENT = `L146-XOVER-SELL-${RUN_ID}`;
const LOSS_CLIENT = `L146-XOVER-LOSS-${RUN_ID}`;

// ─── Seed rates this spec's math depends on (self-provisioned — never
// assumed to survive untouched from create_db.sql, matching lira-142's own
// "self-provision, don't assume" discipline for EUR's is_active flag). No
// other spec in the suite ever calls `rates:set` (grepped), so these should
// already match create_db.sql's defaults; setting them explicitly and
// idempotently is a defensive belt-and-suspenders, not a correction. ───────
const EUR_RATE = {
  to_code: "EUR",
  market_rate: 1.18,
  buy_rate: 1.16,
  sell_rate: 1.2,
  is_stronger: -1 as const,
};
const LBP_RATE = {
  to_code: "LBP",
  market_rate: 89500,
  buy_rate: 89000,
  sell_rate: 90000,
  is_stronger: 1 as const,
};

const BUY_AMOUNT_EUR = 100;
// Below BOTH market (1.18) and the normal buy_rate (1.16) — a bigger gain
// for the shop than an un-overridden buy, so the override is actually
// doing something observable in the deferred-profit figure.
const OVERRIDE_LEG1_RATE = 1.12;
const LEG1_USD_OUT = BUY_AMOUNT_EUR * OVERRIDE_LEG1_RATE; // 112 — leg1's own USD notional

// Leg 1 (EUR→USD) is a lot-tracked ACQUIRE leg — booked profit is forced to
// 0 (Q8); the gain vs. market is deferred into the lot's cost basis instead.
const EXPECTED_DEFERRED_USD =
  (EUR_RATE.market_rate - OVERRIDE_LEG1_RATE) * BUY_AMOUNT_EUR; // 6.00

// Leg 2 (USD→LBP) is never overridden by the OPERATOR here, but for a cross
// exchange `applyCustomRates` (index.tsx, the leg-2 recompute block)
// UNCONDITIONALLY recomputes leg2's profit via the signed
// `computeOverrideLegProfitUsd` at leg2's own (unmodified) rate — it is NOT
// the untouched calculateExchange half-spread figure. At the default
// buy_rate and is_stronger=+1, computeOverrideLegProfitUsd(marketOut,
// actualOut, cr) reduces to:
//   (LEG1_USD_OUT × market_rate − LEG1_USD_OUT × buy_rate) / market_rate
//   = LEG1_USD_OUT × (market_rate − buy_rate) / market_rate
// This numerically agrees with the half-spread model's (sell−buy)/2 ONLY
// because the seeded LBP market_rate (89,500) happens to sit exactly
// mid-spread between buy_rate (89,000) and sell_rate (90,000) — the two
// formulas would diverge for any other market_rate, so this derives from
// computeOverrideLegProfitUsd's own formula, not the half-spread one.
const EXPECTED_LEG2_PROFIT_USD =
  (LEG1_USD_OUT * (LBP_RATE.market_rate - LBP_RATE.buy_rate)) /
  LBP_RATE.market_rate; // (112×500)/89,500 ≈ 0.6257

// 120 USD ÷ 1.20 (EUR's default, unmodified sell_rate) = exactly 100 EUR —
// fully liquidates the lot opened above in one shot.
const SELL_AMOUNT_IN_USD = 120;
const EXPECTED_REALIZED_SELL_PROFIT_USD =
  BUY_AMOUNT_EUR * (EUR_RATE.sell_rate - OVERRIDE_LEG1_RATE); // 100×(1.20−1.12) = 8.00

const LOSS_AMOUNT_USD = 100;
// WORSE than market (89,500) for the shop — the customer walks out with
// MORE LBP than market rate would give them: a real loss. Deliberately NOT
// the seeded sell_rate (90,000): using the sell_rate here would make a
// hypothetical clamp-to-sell-rate bug indistinguishable from an honored
// override, since both would land on the exact same booked number.
const LOSS_OVERRIDE_RATE_LBP = 90200;
const EXPECTED_LOSS_PROFIT_USD =
  (LOSS_AMOUNT_USD * LBP_RATE.market_rate -
    LOSS_AMOUNT_USD * LOSS_OVERRIDE_RATE_LBP) /
  LBP_RATE.market_rate; // (100×89,500 − 100×90,200)/89,500 = −70,000/89,500 ≈ −0.7821

// ─── Types (extend the ambient window.api.exchange.getHistory() shape with
// the profit fields this spec needs — verified present at runtime, same
// precedent as lira-142's identical extension). ────────────────────────────

type ExchangeHistoryRow = Awaited<
  ReturnType<typeof window.api.exchange.getHistory>
>[number] & {
  client_name?: string | null;
  profit_usd?: number | null;
  leg1_profit_usd?: number | null;
  leg2_profit_usd?: number | null;
  via_currency?: string | null;
};

type LotPositionRow = {
  currency_code: string;
  open_qty: number;
  avg_unit_cost_usd: number;
};

// `window.api.rates` is not part of the ambient ElectronAPI type in
// electron.d.ts (a real gap — preload.ts exposes it, electron.d.ts never
// mirrored it) — same situation lira-096-debt-split-repayment.spec.ts hits
// for `rates.list()`. Cast at the call site rather than widening the
// ambient type from a test file.
type RatesSetApi = {
  rates: {
    set: (data: {
      to_code: string;
      market_rate: number;
      buy_rate: number;
      sell_rate: number;
      is_stronger: 1 | -1;
    }) => Promise<{ success: boolean; error?: string }>;
  };
};

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Handles the app's "sign BEFORE the $" display convention (e.g.
 *  "-$2.00 books at sale (loss)", "Total +$0.6257") where a naive
 *  `-?\d+(\.\d+)?` regex can't reach the minus — it isn't adjacent to a
 *  digit, so it silently returns a positive number for a negative display.
 *  Also handles plain unsigned/un-prefixed numeric text (e.g. an <input>'s
 *  raw value) where neither the sign nor the "$" is present. */
function parseNum(text: string): number {
  const m = text.replace(/,/g, "").match(/([+-])?\$?(\d+(?:\.\d+)?)/);
  if (!m) return NaN;
  return (m[1] === "-" ? -1 : 1) * parseFloat(m[2]);
}

async function getExchangeHistory(page: Page): Promise<ExchangeHistoryRow[]> {
  const rows = await page.evaluate(() => window.api.exchange.getHistory());
  return rows as ExchangeHistoryRow[];
}

/** General drawer's USD/EUR/LBP balances — same dynamic-balances read
 *  lira-142 uses, extended with LBP (this file's losing-override phase
 *  moves LBP, not EUR). */
async function generalBalances(
  page: Page,
): Promise<{ usd: number; eur: number; lbp: number }> {
  return page.evaluate(async () => {
    const all = await window.api.closing.getSystemExpectedBalancesDynamic();
    const general = all["General"] ?? {};
    return {
      usd: general["USD"] ?? 0,
      eur: general["EUR"] ?? 0,
      lbp: general["LBP"] ?? 0,
    };
  });
}

async function eurPosition(page: Page): Promise<LotPositionRow> {
  return page.evaluate(async () => {
    const res = await window.api.exchangeLots.getPositions();
    const row = (res.data ?? []).find((p) => p.currency_code === "EUR");
    return row
      ? {
          currency_code: "EUR",
          open_qty: row.open_qty,
          avg_unit_cost_usd: row.avg_unit_cost_usd,
        }
      : { currency_code: "EUR", open_qty: 0, avg_unit_cost_usd: 0 };
  });
}

/**
 * Write off any pre-existing EUR position via the admin Q15 adjustment path
 * BEFORE this file opens its own lot — see the file header and the README
 * addition for why (lira-142 leaves a 217 EUR lot open; FIFO would consume
 * it first and contaminate every cost-basis assertion below). No-op when
 * already clean. `exchangeLots.adjust` "moves no money (no drawer delta, no
 * unified transaction row)" per `ExchangeLotRepository.adjust`'s own doc
 * comment, so this never disturbs the General EUR/USD balance snapshots
 * taken around the real transactions below.
 */
async function drainEurPosition(page: Page): Promise<void> {
  const { open_qty } = await eurPosition(page);
  if (open_qty <= 0.01) return; // already clean (or below LOT_QTY_EPSILON)

  const result = await page.evaluate(async (qty) => {
    return window.api.exchangeLots.adjust({
      currencyCode: "EUR",
      qty: -qty,
      note:
        "lira-146 e2e: isolate lot cost-basis from any pre-existing EUR " +
        "position (lira-142 leaves a 217 EUR lot open)",
    });
  }, open_qty);
  if (!result.success) {
    throw new Error(
      `Failed to drain pre-existing EUR position: ${result.error ?? "unknown error"}`,
    );
  }
}

/** Idempotent upsert of a full rate row (see the const block above for why
 *  this is defensive rather than corrective). Admin-only IPC, same
 *  authenticated session lira-142's `currencies:update` already relies on. */
async function setRate(
  page: Page,
  data: {
    to_code: string;
    market_rate: number;
    buy_rate: number;
    sell_rate: number;
    is_stronger: 1 | -1;
  },
): Promise<void> {
  const result = await page.evaluate(async (payload) => {
    const api = window.api as unknown as RatesSetApi;
    return api.rates.set(payload);
  }, data);
  if (!result.success) {
    throw new Error(
      `Failed to set ${data.to_code} rate: ${result.error ?? "unknown error"}`,
    );
  }
}

/**
 * Provision EUR as active — verbatim adaptation of lira-142's own
 * `ensureEurActive` (see that file's doc comment for the full root-cause
 * trail: the setup wizard deactivates any currency not selected during
 * setup, reached under full-suite conditions). Duplicated here rather than
 * imported because the e2e specs in this suite are deliberately
 * self-contained (no shared non-fixture helper module) — same precedent as
 * every other spec's own copy of `pickCurrency`/`fromBox`/etc.
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
      "EUR currency row not found via currencies:list — cannot provision lira-146's prerequisite",
    );
  }
  if (eur.is_active) return;

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

/** Verbatim adaptation of lira-142's own `pickCurrency` — see that file's
 *  doc comment for the exact-match rationale and the retry-loop hardening. */
async function pickCurrency(box: Locator, code: "USD" | "LBP" | "EUR") {
  if (code === "USD" || code === "LBP") {
    await box.getByRole("button", { name: code, exact: true }).click();
    return;
  }

  const panel = box.locator("div.absolute");
  const searchInput = panel.locator('input[type="text"]');
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

/** The single-leg rate input rendered for a DIRECT (non-cross) exchange. */
function directRateInput(page: Page): Locator {
  return page.getByTestId("exchange-direct-rate-input");
}

async function testIdNumber(page: Page, testId: string): Promise<number> {
  const text = await page.getByTestId(testId).innerText();
  return parseNum(text);
}

/** MultiPaymentInput's single default CASH line auto-syncs to the full
 *  total on mount (lira-063/lira-142 precedent) — no manual fill needed. */
async function payViaSheet(page: Page): Promise<void> {
  const payBtn = page.locator("button").filter({ hasText: /^Pay / }).last();
  await expect(payBtn).toBeVisible({ timeout: 5_000 });
  await payBtn.click();
  await expect(payBtn).toBeHidden({ timeout: 8_000 });
}

/** Fresh mount of the Exchange page (hash-route away and back — never a
 *  hard reload, which would drop the session) so a just-changed rate/
 *  currency-active flag is actually refetched: Exchange's own
 *  `useEffect(load rates, [])` and `useExchangeCurrencyList` both run once
 *  per mount, never on a background IPC write. */
async function remountExchangePage(page: Page): Promise<void> {
  await navigateTo(page, "/");
  await navigateTo(page, "/exchange");
  await expect(
    fromBox(page).getByRole("button", { name: "USD", exact: true }),
  ).toBeVisible({ timeout: 10_000 });
}

// ─── Tests ────────────────────────────────────────────────────────────────

test.describe("Exchange — cross-currency (via-USD) operator rate override, driven through the real UI", () => {
  test("overriding leg 1 of a EUR→LBP cross exchange sets the lot's cost basis to the override; the deferred gain surfaces only when the lot is later sold", async ({
    appPage,
  }) => {
    // ─── Phase 0: self-provision — EUR active, exact seed rates, and a
    // clean (zero) EUR position so this file's own lot is never blended
    // with lira-142's leftover 217 EUR position ───────────────────────────
    await navigateTo(appPage, "/exchange");
    await ensureEurActive(appPage);
    await setRate(appPage, EUR_RATE);
    await setRate(appPage, LBP_RATE);
    await drainEurPosition(appPage);
    await remountExchangePage(appPage);

    const eurPosBaseline = await eurPosition(appPage);
    expect(eurPosBaseline.open_qty).toBeLessThanOrEqual(0.01);

    // ─── Phase 1: BUY 100 EUR → LBP (cross via USD), leg 1 overridden ────
    await pickCurrency(fromBox(appPage), "EUR");
    await pickCurrency(toBox(appPage), "LBP");
    await amountInInput(appPage).fill(String(BUY_AMOUNT_EUR));
    await clientNameInput(appPage).fill(BUY_CLIENT);

    const rateInput1 = appPage.getByTestId("exchange-cross-rate-input-1");
    await expect(rateInput1).toBeVisible({ timeout: 8_000 });
    await rateInput1.fill(String(OVERRIDE_LEG1_RATE));

    // Preview: leg1 books 0 (acquire, Q8) with a $6.00 DEFERRED annotation;
    // leg2's own (un-overridden) profit carries the visible total (~$0.63).
    //
    // Leg 1 here is an ACQUIRE leg (i === 0 && fromIsLotTracked — EUR is
    // lot-tracked, only USD/LBP are exempt per LOT_EXEMPT_CURRENCIES). index.tsx
    // renders the two testids from a SINGLE ternary keyed on `isAcquireLeg`
    // (Exchange/index.tsx ~line 1216): the acquire branch renders ONLY
    // `exchange-cross-deferred-1`, the non-acquire branch renders ONLY
    // `exchange-cross-leg-profit-1` — they are mutually exclusive by
    // construction, never both in the DOM for the same leg. So for THIS
    // scenario `exchange-cross-leg-profit-1` must have zero matches; asserting
    // that (rather than polling its numeric text, which would just time out
    // waiting on a locator that can never resolve) is what actually proves the
    // acquire/deferred branch rendered.
    await expect(
      appPage.getByTestId("exchange-cross-leg-profit-1"),
    ).toHaveCount(0);
    await expect
      .poll(() => testIdNumber(appPage, "exchange-cross-deferred-1"), {
        timeout: 5_000,
      })
      .toBeCloseTo(EXPECTED_DEFERRED_USD, 2);
    await expect
      .poll(() => testIdNumber(appPage, "exchange-cross-leg-profit-2"), {
        timeout: 5_000,
      })
      .toBeCloseTo(EXPECTED_LEG2_PROFIT_USD, 2);
    await expect
      .poll(() => testIdNumber(appPage, "exchange-cross-total-profit"), {
        timeout: 5_000,
      })
      .toBeCloseTo(EXPECTED_LEG2_PROFIT_USD, 2);

    const proceedBtn = appPage.getByRole("button", {
      name: "Proceed to Payout",
    });
    await expect(proceedBtn).toBeEnabled({ timeout: 8_000 });

    const beforeBuy = await generalBalances(appPage);

    await proceedBtn.click();
    await payViaSheet(appPage);

    // Identity: match the new row by client marker + pair + amount — never
    // getRecent()[0] (rule 15).
    await expect
      .poll(
        async () => {
          const rows = await getExchangeHistory(appPage);
          return rows.some(
            (r) =>
              r.client_name === BUY_CLIENT &&
              r.from_currency === "EUR" &&
              r.to_currency === "LBP" &&
              Number(r.amount_in) === BUY_AMOUNT_EUR,
          );
        },
        { timeout: 10_000 },
      )
      .toBe(true);

    const historyAfterBuy = await getExchangeHistory(appPage);
    const buyRow = historyAfterBuy.find((r) => r.client_name === BUY_CLIENT);
    if (!buyRow) throw new Error("BUY exchange row not found by identity");
    expect(buyRow.via_currency).toBe("USD");
    const buyAmountOutLbp = Number(buyRow.amount_out);

    // Booked leg1 profit forced to 0 (Q8) regardless of the override.
    expect(Number(buyRow.leg1_profit_usd)).toBeCloseTo(0, 6);
    // Leg2's own profit, and the row's total, equal the un-overridden
    // half-spread figure computed above.
    expect(Number(buyRow.leg2_profit_usd)).toBeCloseTo(
      EXPECTED_LEG2_PROFIT_USD,
      4,
    );
    expect(Number(buyRow.profit_usd)).toBeCloseTo(EXPECTED_LEG2_PROFIT_USD, 4);

    // Deltas by identity (rule 15): EUR moves by exactly what was typed;
    // USD is a pure internal pivot for a cross exchange (never physically
    // exchanged with the customer) so General USD is untouched; LBP moves
    // by exactly what the server stamped as amount_out for this row.
    const afterBuy = await generalBalances(appPage);
    expect(afterBuy.eur - beforeBuy.eur).toBeCloseTo(BUY_AMOUNT_EUR, 4);
    expect(afterBuy.usd - beforeBuy.usd).toBeCloseTo(0, 2);
    // LBP amounts run into the millions — a -1 digit tolerance (agreement to
    // the nearest 5 LBP) is exact for practical purposes without being
    // brittle against any internal two-step (leg1-then-leg2) rounding.
    expect(afterBuy.lbp - beforeBuy.lbp).toBeCloseTo(-buyAmountOutLbp, -1);

    // ─── Phase 2: the lot's cost basis is the OVERRIDE, not the default
    // buy_rate and not anything derived from leg 2 ────────────────────────
    const posAfterBuy = await eurPosition(appPage);
    expect(posAfterBuy.open_qty).toBeCloseTo(BUY_AMOUNT_EUR, 4);
    expect(posAfterBuy.avg_unit_cost_usd).toBeCloseTo(OVERRIDE_LEG1_RATE, 6);

    // ─── Phase 3: fully liquidate the lot — direct USD→EUR at the shop's
    // own DEFAULT (unmodified) sell_rate — proving the deferred gain
    // surfaces here, not before ────────────────────────────────────────────
    await remountExchangePage(appPage);
    await pickCurrency(fromBox(appPage), "USD");
    await pickCurrency(toBox(appPage), "EUR");
    await amountInInput(appPage).fill(String(SELL_AMOUNT_IN_USD));
    await clientNameInput(appPage).fill(SELL_CLIENT);

    await expect(appPage.getByTestId("exchange-exotic-payout")).toBeVisible({
      timeout: 5_000,
    });
    await expect
      .poll(async () => exoticPayoutQty(appPage), { timeout: 5_000 })
      .toBeCloseTo(BUY_AMOUNT_EUR, 1);

    const confirmBtn = appPage.getByRole("button", {
      name: "Confirm Exchange",
    });
    // Disabled while the debounced FIFO realized-profit preview is in
    // flight (toIsLotTracked && lotPreviewLoading) — wait it out.
    await expect(confirmBtn).toBeEnabled({ timeout: 8_000 });

    const beforeSell = await generalBalances(appPage);

    await confirmBtn.click();
    // Not expected to fire (realized profit here is a real GAIN), but
    // defensive like lira-142's own phase 2.
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
              Number(r.amount_in) === SELL_AMOUNT_IN_USD,
          );
        },
        { timeout: 10_000 },
      )
      .toBe(true);

    const historyAfterSell = await getExchangeHistory(appPage);
    const sellRow = historyAfterSell.find((r) => r.client_name === SELL_CLIENT);
    if (!sellRow) throw new Error("SELL exchange row not found by identity");
    const actualEurSold = Number(sellRow.amount_out);
    expect(actualEurSold).toBeCloseTo(BUY_AMOUNT_EUR, 2); // full liquidation

    // Realized profit — read from the row, then cross-checked independently
    // via the settlement breakdown's own qty×(proceeds−cost) figures (never
    // a hardcoded number at either layer).
    const sellRowProfit = Number(sellRow.leg1_profit_usd ?? sellRow.profit_usd);
    expect(sellRowProfit).toBeCloseTo(EXPECTED_REALIZED_SELL_PROFIT_USD, 2);

    const breakdown = await appPage.evaluate(async (id) => {
      const res = await window.api.exchangeLots.getBreakdown(id);
      return res.data ?? { asSettler: [], againstSource: [] };
    }, sellRow.id);
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
    expect(stampedProfit).toBeCloseTo(EXPECTED_REALIZED_SELL_PROFIT_USD, 2);
    // Every settlement drew from a lot at the override's own cost — proves
    // the $6 deferred from Phase 1 is exactly what's realizing here, not a
    // blend with any other lot.
    for (const s of breakdown.asSettler) {
      expect(s.unit_cost_usd).toBeCloseTo(OVERRIDE_LEG1_RATE, 6);
    }

    const afterSell = await generalBalances(appPage);
    expect(afterSell.eur - beforeSell.eur).toBeCloseTo(-actualEurSold, 4);
    expect(afterSell.usd - beforeSell.usd).toBeCloseTo(SELL_AMOUNT_IN_USD, 2);

    // The lot is now fully settled — this file leaves EUR at (near) zero,
    // a cleaner terminal state than lira-142's own 217-open ending (see the
    // README addition for what this means for any future EUR-touching spec).
    const posAfterSell = await eurPosition(appPage);
    expect(posAfterSell.open_qty).toBeCloseTo(0, 2);
  });
});

test.describe("Exchange — losing rate override on a non-lot-tracked pair (sign-loss regression guard)", () => {
  test("a direct USD→LBP exchange overridden WORSE than market books a NEGATIVE profit_usd", async ({
    appPage,
  }) => {
    // Self-contained: only needs the LBP rate, independent of the EUR/lot
    // scenario above (runnable in isolation via `-g`).
    await navigateTo(appPage, "/exchange");
    await setRate(appPage, LBP_RATE);
    await remountExchangePage(appPage);

    await pickCurrency(fromBox(appPage), "USD");
    await pickCurrency(toBox(appPage), "LBP");
    await amountInInput(appPage).fill(String(LOSS_AMOUNT_USD));
    await clientNameInput(appPage).fill(LOSS_CLIENT);

    const rateInput = directRateInput(appPage);
    await expect(rateInput).toBeVisible({ timeout: 8_000 });
    await rateInput.fill(String(LOSS_OVERRIDE_RATE_LBP));

    const proceedBtn = appPage.getByRole("button", {
      name: "Proceed to Payout",
    });
    await expect(proceedBtn).toBeEnabled({ timeout: 8_000 });

    const beforeLoss = await generalBalances(appPage);

    await proceedBtn.click();
    await payViaSheet(appPage);

    await expect
      .poll(
        async () => {
          const rows = await getExchangeHistory(appPage);
          return rows.some(
            (r) =>
              r.client_name === LOSS_CLIENT &&
              r.from_currency === "USD" &&
              r.to_currency === "LBP" &&
              Number(r.amount_in) === LOSS_AMOUNT_USD,
          );
        },
        { timeout: 10_000 },
      )
      .toBe(true);

    const history = await getExchangeHistory(appPage);
    const lossRow = history.find((r) => r.client_name === LOSS_CLIENT);
    if (!lossRow) throw new Error("Loss-override exchange row not found by identity");

    const bookedProfit = Number(lossRow.leg1_profit_usd ?? lossRow.profit_usd);
    // THE regression guard: pre-fix (Math.abs), this books +0.7821 — a
    // phantom gain for what is actually a real loss to the shop. Post-fix,
    // it books the signed value below.
    expect(bookedProfit).toBeLessThan(0);
    expect(bookedProfit).toBeCloseTo(EXPECTED_LOSS_PROFIT_USD, 2);

    // The customer walked out with MORE LBP than a fair rate would give
    // them — the drawer's LBP delta reflects the actual (worse) payout,
    // read from the row itself, never hardcoded.
    const afterLoss = await generalBalances(appPage);
    expect(afterLoss.lbp - beforeLoss.lbp).toBeCloseTo(
      -Number(lossRow.amount_out),
      -1,
    );
    expect(afterLoss.usd - beforeLoss.usd).toBeCloseTo(LOSS_AMOUNT_USD, 2);
  });
});
