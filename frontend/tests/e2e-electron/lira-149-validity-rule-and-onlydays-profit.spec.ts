/**
 * E2E: LIRA-157 (carrier-line validity rule) + LIRA-153 (Only-Days profit).
 *
 * Both fixes come from the owner's 2026-08-29 testing notes and both were
 * interviewed to a decision before being built
 * (`docs/plans/todo_plans/OWNER_NOTES_2026-08-29.md`, §6.4 and §2.5).
 *
 * ── LIRA-157, the validity rule ────────────────────────────────────────────
 * Owner: charging a line expired 22 days ago showed 30 days left, and a
 * 365-day card on a line with 30 days left showed 395. The rule now is:
 *
 *   valid line       -> expiry + days      (stacks)
 *   lapsed <= 5 days -> today  + days      (grace: the lapse is forgiven)
 *   lapsed  > 5 days -> REFUSED            (the line is burned)
 *   always           -> clipped at today + 365
 *
 * ── LIRA-153, the Only-Days profit ─────────────────────────────────────────
 * Owner: "before the sale i had 96000 lbp, after sale i can see —". The stamp
 * counted the whole card as spent and none of the credit SMSed back as
 * recovered, so one sale buried the module's profit below zero (and the By
 * Module cell renders a non-positive LBP total as an em dash). The margin now
 * nets the returned credit off the gross cost at R, the shop's cost of credit.
 *
 * ── Conventions ────────────────────────────────────────────────────────────
 * Rule 15 throughout: this spec CREATES its own catalog item and its own
 * carrier lines with unique identifiers, and asserts DELTAS around each action
 * — never an absolute total, never a row position, never `getRecent()[0]`.
 * Sharing the seeded `3.79` card with lira-132 would be fragile: that spec
 * edits catalog rows.
 *
 * Every carrier line here is created NON-primary and targeted explicitly by
 * `carrierLineId`, so this spec cannot disturb the primary line other specs
 * (lira-132/133/145) rely on.
 *
 * FAILING-FIRST PROOF (rule 17), per part:
 *  - LIRA-157: in `packages/core/src/utils/carrierLineValidity.ts`, restore the
 *    old rule inside `projectValidityExpiry` — `const base = expiry && expiry >
 *    today ? expiry : today; return { expiry: addDaysToDateString(base,
 *    daysDelta) }` with no ceiling and no burned branch. The grace test still
 *    passes (the old rule agreed there); the CEILING and BURNED tests both
 *    fail. Restore afterwards.
 *  - LIRA-153: in `FinancialServiceRepository.createTransaction`, change the
 *    margin back to `price - cost` (drop `+ telecomCreditReturnCredit`). The
 *    profit-delta test fails by exactly `returnedCredits * R`.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

/**
 * R — the shop's cost of $1 of card-embedded credit, and the rate the profit
 * stamp values a returned credit at.
 *
 * Hardcoded rather than imported: pulling `@liratek/core` into a Playwright
 * spec would drag better-sqlite3 into the test process. It MUST equal
 * `TELECOM_CREDIT_COST_RATE_LBP` (`packages/core/src/utils/telecomCredit.ts`),
 * which migration v148 re-anchored from 93,333.33 to this value
 * (owner-confirmed 2026-08-05). A drift here shows up as a failing profit
 * delta, not a silent pass.
 */
const CREDIT_COST_RATE_LBP = 85_000;

/** The ceiling from `MAX_LINE_VALIDITY_DAYS`. */
const MAX_VALIDITY_DAYS = 365;

// ─── The purpose-built catalog item ──────────────────────────────────────────
//
// Chosen so every figure is round and the Only-Days margin lands POSITIVE, so
// a passing test cannot be confused with "the loss got smaller":
//
//   cost_lbp 1,000,000 · credits $10 · validity 10 days
//   maxReturnableCredits(10) = $9.00
//       (n=3 SMS: cap 3x$3 = $9.00 binds under the surviving $10.00 - 3x$0.16
//        = $9.52, floored to the $0.50 step -> $9.00)
//   days_cost_lbp = 1,000,000 - 10 x 85,000 = 150,000
//   Only-Days price 300,000
//
//   profit = 300,000 - 1,000,000 + 9 x 85,000 = +65,000   <- after LIRA-153
//   profit = 300,000 - 1,000,000             = -700,000   <- before
const ITEM = {
  cost_lbp: 1_000_000,
  sell_lbp: 1_200_000,
  credits: 10,
  validity_days: 10,
  days_cost_lbp: 150_000,
  sell_days_lbp: 300_000,
  sell_credit_lbp: 120_000,
};
const RETURNABLE_CREDITS = 9; // maxReturnableCredits(10)
const EXPECTED_ONLY_DAYS_PROFIT_LBP =
  ITEM.sell_days_lbp - ITEM.cost_lbp + RETURNABLE_CREDITS * CREDIT_COST_RATE_LBP;
const PRE_FIX_ONLY_DAYS_PROFIT_LBP = ITEM.sell_days_lbp - ITEM.cost_lbp;

type Api = {
  api: {
    mobileServiceItems: {
      create: (data: Record<string, unknown>) => Promise<{
        success: boolean;
        data?: { id: number };
        error?: string;
      }>;
    };
    carrierLines: {
      create: (data: Record<string, unknown>) => Promise<{
        success: boolean;
        data?: { id: number };
        error?: string;
      }>;
      getAllAdmin: () => Promise<{
        success: boolean;
        data?: Array<{
          id: number;
          phone_number: string;
          credits: number;
          validity_expires_at: string | null;
        }>;
        error?: string;
      }>;
    };
    financial: {
      selfChargeTelecomItem: (data: {
        mobileServiceItemId: number;
        carrierLineId?: number;
      }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    };
    omt: {
      addTransaction: (
        data: Record<string, unknown>,
      ) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    };
    profits: {
      byModule: (
        from: string,
        to: string,
      ) => Promise<
        Array<{ module: string; profit_usd: number; profit_lbp: number }>
      >;
    };
  };
};

/** Local Y-M-D `days` from today — mirrors `localDay()`, which is what the
 *  rule anchors on. Deliberately NOT via toISOString(), which would be a UTC
 *  day and could be off by one near midnight in a non-UTC timezone. */
function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** A catalog item owned by this spec alone. */
async function createItem(page: Page, label: string): Promise<number> {
  const res = await page.evaluate(
    async ({ itemLabel, item }) => {
      const w = window as unknown as Api;
      return w.api.mobileServiceItems.create({
        provider: "iPick",
        category: "mtc",
        subcategory: "Prepaid",
        label: itemLabel,
        ...item,
      });
    },
    { itemLabel: label, item: ITEM },
  );
  expect(res.success, `item create failed: ${res.error}`).toBe(true);
  return res.data!.id;
}

/** A NON-primary mtc line with a chosen expiry. */
async function createLine(
  page: Page,
  phone: string,
  expiry: string,
): Promise<number> {
  const res = await page.evaluate(
    async ({ phone_number, validity_expires_at }) => {
      const w = window as unknown as Api;
      return w.api.carrierLines.create({
        carrier: "mtc",
        phone_number,
        label: `E2E-149-${phone_number}`,
        credits: 0,
        validity_expires_at,
      });
    },
    { phone_number: phone, validity_expires_at: expiry },
  );
  expect(res.success, `line create failed: ${res.error}`).toBe(true);
  return res.data!.id;
}

async function readLine(
  page: Page,
  lineId: number,
): Promise<{ credits: number; validity_expires_at: string | null }> {
  const row = await page.evaluate(async (id) => {
    const w = window as unknown as Api;
    const res = await w.api.carrierLines.getAllAdmin();
    return (res.data ?? []).find((r) => r.id === id) ?? null;
  }, lineId);
  expect(row, `carrier line #${lineId} not found`).not.toBeNull();
  return row!;
}

async function selfCharge(
  page: Page,
  itemId: number,
  lineId: number,
): Promise<{ success: boolean; error?: string }> {
  return page.evaluate(
    async ({ mobileServiceItemId, carrierLineId }) => {
      const w = window as unknown as Api;
      const res = await w.api.financial.selfChargeTelecomItem({
        mobileServiceItemId,
        carrierLineId,
      });
      return { success: res.success, error: res.error };
    },
    { mobileServiceItemId: itemId, carrierLineId: lineId },
  );
}

/** Total stamped LBP profit across every module, for today. Summed rather
 *  than picked by module name so the assertion does not depend on which label
 *  an iPick catalog sale maps to — one action between two snapshots makes the
 *  delta unambiguous either way. */
async function totalProfitLbp(page: Page): Promise<number> {
  const today = dayOffset(0);
  return page.evaluate(async (day) => {
    const w = window as unknown as Api;
    const rows = await w.api.profits.byModule(day, day);
    return (rows ?? []).reduce((sum, r) => sum + (r.profit_lbp ?? 0), 0);
  }, today);
}

test.describe("LIRA-157 — carrier-line validity rule", () => {
  test("a charge STACKS on a live line, and is CLIPPED at 365 days", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/recharge");
    const stamp = Date.now().toString().slice(-6);
    const itemId = await createItem(appPage, `E2E-149-stack-${stamp}`);

    // ── stacks: 30 days left + a 10-day card = 40 ────────────────────────
    const liveLineId = await createLine(appPage, `03${stamp}1`, dayOffset(30));
    expect((await selfCharge(appPage, itemId, liveLineId)).success).toBe(true);
    expect((await readLine(appPage, liveLineId)).validity_expires_at).toBe(
      dayOffset(40),
    );

    // ── clipped: 360 days left + a 10-day card = 370 -> 365 ──────────────
    // The owner's own case was 30 left + a 365-day card = 395; this is the
    // same arithmetic with a card small enough not to distort the shared
    // provider drawer.
    const nearCapLineId = await createLine(
      appPage,
      `03${stamp}2`,
      dayOffset(360),
    );
    expect((await selfCharge(appPage, itemId, nearCapLineId)).success).toBe(
      true,
    );
    expect((await readLine(appPage, nearCapLineId)).validity_expires_at).toBe(
      dayOffset(MAX_VALIDITY_DAYS),
    );
  });

  test("inside the 5-day grace the charge starts from TODAY", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/recharge");
    const stamp = Date.now().toString().slice(-6);
    const itemId = await createItem(appPage, `E2E-149-grace-${stamp}`);

    // Lapsed 3 days, +10 -> today+10. NOT today+7 (the lapse is forgiven,
    // not deducted) and NOT today+13 (it does not stack onto a past date).
    const lineId = await createLine(appPage, `03${stamp}3`, dayOffset(-3));
    expect((await selfCharge(appPage, itemId, lineId)).success).toBe(true);
    expect((await readLine(appPage, lineId)).validity_expires_at).toBe(
      dayOffset(10),
    );
  });

  test("a BURNED line refuses the charge and keeps every value untouched", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/recharge");
    const stamp = Date.now().toString().slice(-6);
    const itemId = await createItem(appPage, `E2E-149-burned-${stamp}`);

    // The owner's exact case: lapsed 22 days, well past the 5-day window.
    const staleExpiry = dayOffset(-22);
    const lineId = await createLine(appPage, `03${stamp}4`, staleExpiry);

    const res = await selfCharge(appPage, itemId, lineId);
    expect(res.success).toBe(false);
    expect(res.error ?? "").toMatch(/burned/i);
    expect(res.error ?? "").toMatch(/22 days ago/);

    // The whole self-charge rolls back: no credit, no validity move.
    const after = await readLine(appPage, lineId);
    expect(after.validity_expires_at).toBe(staleExpiry);
    expect(after.credits).toBe(0);
  });
});

test.describe("LIRA-153 — Only-Days profit nets the returned credit", () => {
  test("an Only-Days sale books a POSITIVE margin, not the whole card as a loss", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/recharge");
    const stamp = Date.now().toString().slice(-6);
    const itemId = await createItem(appPage, `E2E-149-profit-${stamp}`);

    const before = await totalProfitLbp(appPage);

    const sale = await appPage.evaluate(
      async ({ mobileServiceItemId, item }) => {
        const w = window as unknown as Api;
        const res = await w.api.omt.addTransaction({
          provider: "iPick",
          serviceType: "SEND",
          amount: item.sell_days_lbp,
          currency: "LBP",
          commission: 0,
          cost: item.cost_lbp,
          price: item.sell_days_lbp,
          paidByMethod: "CASH",
          itemCategory: "mtc",
          mobileServiceItemId,
          // returnedCreditsUsd omitted on purpose: the computed default is
          // what the real form sends, and it is the path the bug lived on.
        });
        return { success: res.success, error: res.error };
      },
      { mobileServiceItemId: itemId, item: ITEM },
    );
    expect(sale.success, `Only-Days sale failed: ${sale.error}`).toBe(true);

    const delta = (await totalProfitLbp(appPage)) - before;

    expect(
      delta,
      `expected the Only-Days sale to add ${EXPECTED_ONLY_DAYS_PROFIT_LBP} LBP ` +
        `(= ${ITEM.sell_days_lbp} price - ${ITEM.cost_lbp} gross cost + ` +
        `${RETURNABLE_CREDITS} credits x ${CREDIT_COST_RATE_LBP}), got ${delta}`,
    ).toBeCloseTo(EXPECTED_ONLY_DAYS_PROFIT_LBP, 0);

    // The headline: a positive margin, where the pre-fix stamp booked a
    // 700,000 LBP hole big enough to drag the whole module negative.
    expect(delta).toBeGreaterThan(0);
    expect(delta).not.toBeCloseTo(PRE_FIX_ONLY_DAYS_PROFIT_LBP, 0);
  });
});
