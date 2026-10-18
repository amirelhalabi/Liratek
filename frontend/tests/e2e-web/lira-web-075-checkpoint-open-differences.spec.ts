/**
 * lira-web-075 — LIRA-335 checkpoint open differences over the web transport
 * (owner decisions 2026-10-18; spec `specs/335-checkpoint-open-differences/`,
 * quickstart "Manual check" steps 1–5).
 *
 * Owner decision for this ticket: this spec is WRITTEN AND TYPECHECKED, NOT
 * RUN. Run it with `yarn test:e2e:web -g "LIRA-335"` when the owner says so.
 *
 *   1. A General checkpoint counted $50 over → one OPEN difference of +50 on
 *      that checkpoint; the "Open differences only" count grows by 1.
 *   2. A $50 cash POS sale saved with a custom time BEFORE that checkpoint →
 *      the hint's data source lists the difference beforehand; after saving,
 *      General's expected balance is unchanged and the difference is RESOLVED
 *      by that sale (timeline shows "Resolved").
 *   3. A new checkpoint with the same counted cash → no difference (Balanced).
 *   4. Voiding the sale → the difference is OPEN again by $50; General
 *      unchanged (create + void nets to 0).
 *   5. A checkpoint $3 short → Close (REST) books one "Drawer shortage"
 *      expense of $3.00 today; Reopen voids it and the difference is open.
 *
 * Rule 15: the shared web DB accumulates (lira-web-010 leaves an open Over on
 * General every run). Checkpoints are matched by a unique note, the
 * difference by drawer + currency on that checkpoint, the resolver by the
 * SALE's source_id, the expense by its id — and every money check is a delta.
 *
 * Money writes go over REST (as lira-web-010/050/074 do), never through the
 * minute-granular `datetime-local` input: a custom time rounded down to
 * HH:MM:00 can fall before an earlier General checkpoint from another spec,
 * and the engine resolves only the FIRST checkpoint after the time. Here the
 * custom time is taken after login and >1.5 s before our checkpoint, so ours
 * is the first General checkpoint after it.
 */
// Same convention as lira-web-010: one owner for the shop's calendar day.
import { localDay } from "@liratek/core";
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";
import type { Page } from "@playwright/test";

const DRAWER = "General";
const CUR = "USD";

type Headers = Record<string, string>;

type ResolutionView = {
  transaction_id: number;
  amount: number;
};

type DifferenceView = {
  id: number;
  closing_id: number;
  drawer_name: string;
  currency_code: string;
  amount: number;
  direction: "OVER" | "SHORT";
  resolved: number;
  open: number;
  status: "OPEN" | "PARTLY_RESOLVED" | "RESOLVED" | "CLOSED";
  shortage_expense_id: number | null;
  resolutions: ResolutionView[];
};

type CheckpointRow = {
  id: number;
  notes?: string | null;
  differences?: DifferenceView[];
};

type ExpenseRow = {
  id: number;
  category: string;
  amount_usd: number;
  is_refunded?: number;
  status?: string;
};

async function auth(page: Page): Promise<Headers> {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  return { Authorization: `Bearer ${token}` };
}

/** General/USD expected balance — the figure a checkpoint compares against. */
async function generalUsd(page: Page, headers: Headers): Promise<number> {
  const res = await (
    await page.request.get(
      `${BACKEND_URL}/api/closing/system-expected-balances-dynamic`,
      { headers },
    )
  ).json();
  expect(res.success, JSON.stringify(res)).toBeTruthy();
  return (res.balances?.[DRAWER]?.[CUR] as number) ?? 0;
}

async function checkpoint(
  page: Page,
  headers: Headers,
  note: string,
  physical: number,
  expected: number,
): Promise<number> {
  const res = await (
    await page.request.post(`${BACKEND_URL}/api/closing/checkpoint`, {
      headers,
      data: {
        drawer_name: DRAWER,
        notes: note,
        amounts: [
          {
            drawer_name: DRAWER,
            currency_code: CUR,
            expected_amount: expected,
            physical_amount: physical,
          },
        ],
      },
    })
  ).json();
  expect(res.success, JSON.stringify(res)).toBeTruthy();
  return Number(res.id);
}

async function timeline(
  page: Page,
  headers: Headers,
  openOnly = false,
): Promise<{ checkpoints: CheckpointRow[]; open_count?: number }> {
  const today = localDay();
  const res = await (
    await page.request.get(
      `${BACKEND_URL}/api/closing/checkpoint-timeline?date_from=${today}&date_to=${today}&type=ALL${
        openOnly ? "&open_only=1" : ""
      }`,
      { headers },
    )
  ).json();
  expect(res.success, JSON.stringify(res)).toBeTruthy();
  return res;
}

/** Our checkpoint's General/USD difference (undefined when it has none). */
async function differenceOf(
  page: Page,
  headers: Headers,
  note: string,
): Promise<DifferenceView | undefined> {
  const { checkpoints } = await timeline(page, headers);
  const cp = checkpoints.find((c) => c.notes === note);
  expect(cp, `checkpoint "${note}" not in the timeline`).toBeTruthy();
  return (cp!.differences ?? []).find(
    (d) => d.drawer_name === DRAWER && d.currency_code === CUR,
  );
}

/**
 * Open the Checkpoints page and narrow it to one checkpoint by its unique
 * note: earlier specs (lira-web-071's shop day) add checkpoints today and the
 * table paginates, so a bare row lookup could miss ours.
 */
async function openTimelineFor(page: Page, note: string): Promise<void> {
  await page.goto("/#/");
  await page.goto("/#/checkpoint-timeline");
  await expect(page.locator("#root")).not.toContainText("Something went wrong");
  await page.getByPlaceholder("Search drawer, user, notes…").fill(note);
}

async function liveExpense(
  page: Page,
  headers: Headers,
  id: number,
): Promise<ExpenseRow | undefined> {
  const res = await (
    await page.request.get(`${BACKEND_URL}/api/expenses/today`, { headers })
  ).json();
  expect(res.success, JSON.stringify(res)).toBeTruthy();
  return ((res.expenses ?? []) as ExpenseRow[]).find(
    (e) => e.id === id && !e.is_refunded && (e.status ?? "active") === "active",
  );
}

test.describe("LIRA-335 checkpoint open differences over REST", () => {
  test("(1–4) Over $50 → back-timed $50 sale resolves it → next checkpoint balanced → void reopens it", async ({
    page,
  }) => {
    const headers = await auth(page);
    const ts = Date.now();
    const NOTE_1 = `web-075 over ${ts}`;
    const NOTE_2 = `web-075 recount ${ts}`;

    // The custom time: after login (earlier General checkpoints are already
    // older), and strictly before our checkpoint.
    const T = new Date().toISOString();
    const tMs = Date.parse(T);
    await expect.poll(() => Date.now() > tMs + 1_500).toBe(true);

    // ── Step 1: count $50 more than expected ─────────────────────────────
    const openBefore = (await timeline(page, headers, true)).open_count ?? 0;
    const before = await generalUsd(page, headers);
    const closingId = await checkpoint(
      page,
      headers,
      NOTE_1,
      before + 50,
      before,
    );
    const counted = before + 50;
    expect(await generalUsd(page, headers)).toBeCloseTo(counted, 2);

    const diff1 = await differenceOf(page, headers, NOTE_1);
    expect(diff1, "no General/USD difference recorded").toBeTruthy();
    expect(diff1!.closing_id).toBe(closingId);
    expect(diff1!.amount).toBeCloseTo(50, 2);
    expect(diff1!.direction).toBe("OVER");
    expect(diff1!.status).toBe("OPEN");
    expect(diff1!.open).toBeCloseTo(50, 2);

    const openList = await timeline(page, headers, true);
    expect((openList.open_count ?? 0) - openBefore).toBe(1);
    expect(openList.checkpoints.some((c) => c.notes === NOTE_1)).toBe(true);

    // ── Step 2: the hint's data, then the back-timed sale ────────────────
    const hint = await (
      await page.request.get(
        `${BACKEND_URL}/api/closing/differences/open-after?at=${encodeURIComponent(T)}`,
        { headers },
      )
    ).json();
    expect(hint.success, JSON.stringify(hint)).toBeTruthy();
    const hinted = (hint.data as DifferenceView[]).find(
      (d) => d.id === diff1!.id,
    );
    expect(hinted, "open-after does not list our difference").toBeTruthy();
    expect(hinted!.open).toBeCloseTo(50, 2);

    const product = await (
      await page.request.post(`${BACKEND_URL}/api/inventory/products`, {
        headers,
        data: {
          name: `L-web-075 Missed Sale ${ts}`,
          category: "General",
          cost_price_usd: 20,
          retail_price_usd: 50,
          stock: 5,
          min_stock_threshold: 0,
        },
      })
    ).json();
    expect(product.success, JSON.stringify(product)).toBeTruthy();

    const sale = await (
      await page.request.post(`${BACKEND_URL}/api/sales/process`, {
        headers,
        data: {
          client_id: null,
          items: [
            { product_id: product.data.id as number, quantity: 1, price: 50 },
          ],
          total_amount: 50,
          discount: 0,
          final_amount: 50,
          payment_usd: 50,
          payment_lbp: 0,
          payments: [{ method: "CASH", currency_code: CUR, amount: 50 }],
          change_given_usd: 0,
          change_given_lbp: 0,
          exchange_rate: 89500,
          status: "completed",
          transaction_time: T,
        },
      })
    ).json();
    expect(sale.success, JSON.stringify(sale)).toBeTruthy();
    const saleId = sale.id as number;

    // The drawer is NOT raised a second time: still the counted cash.
    expect((await generalUsd(page, headers)) - counted).toBeCloseTo(0, 2);

    const recent = await (
      await page.request.get(
        `${BACKEND_URL}/api/transactions/recent?limit=200`,
        { headers },
      )
    ).json();
    const saleTxn = (
      recent.transactions as Array<{
        id: number;
        type: string;
        source_id: number | null;
      }>
    ).find((t) => t.type === "SALE" && t.source_id === saleId);
    expect(saleTxn, `SALE txn for sale #${saleId} not found`).toBeTruthy();

    const diff2 = await differenceOf(page, headers, NOTE_1);
    expect(diff2!.status).toBe("RESOLVED");
    expect(diff2!.open).toBeCloseTo(0, 2);
    const byUs = diff2!.resolutions.find(
      (r) => r.transaction_id === saleTxn!.id,
    );
    expect(byUs, "the sale is not listed as the resolver").toBeTruthy();
    expect(Math.abs(byUs!.amount)).toBeCloseTo(50, 2);

    // The hint no longer offers it.
    const hintAfter = await (
      await page.request.get(
        `${BACKEND_URL}/api/closing/differences/open-after?at=${encodeURIComponent(T)}`,
        { headers },
      )
    ).json();
    expect(hintAfter.success, JSON.stringify(hintAfter)).toBeTruthy();
    expect(
      (hintAfter.data as DifferenceView[]).some((d) => d.id === diff1!.id),
    ).toBe(false);

    // The timeline row shows it, through the useApi() adapter.
    await openTimelineFor(page, NOTE_1);
    const row1 = page.locator("tr", { hasText: NOTE_1 });
    await expect(row1).toContainText("Resolved", { timeout: 15_000 });

    // ── Step 3: recount the same cash → Balanced ─────────────────────────
    await checkpoint(page, headers, NOTE_2, counted, counted);
    expect((await generalUsd(page, headers)) - counted).toBeCloseTo(0, 2);
    expect(await differenceOf(page, headers, NOTE_2)).toBeUndefined();

    // ── Step 4: void the sale → the difference reopens, drawer unchanged ──
    const voided = await (
      await page.request.post(
        `${BACKEND_URL}/api/transactions/${saleTxn!.id}/void`,
        { headers },
      )
    ).json();
    expect(voided.success, JSON.stringify(voided)).toBeTruthy();

    expect((await generalUsd(page, headers)) - counted).toBeCloseTo(0, 2);
    const diff3 = await differenceOf(page, headers, NOTE_1);
    expect(diff3!.status).toBe("OPEN");
    expect(diff3!.open).toBeCloseTo(50, 2);
    // The recount checkpoint stays untouched.
    expect(await differenceOf(page, headers, NOTE_2)).toBeUndefined();

    // The filter on the page lists our checkpoint again.
    // (Navigating away and back, not reload: a reload could bring back the
    // auto "Checkpoint — all drawers" window over the page.)
    await openTimelineFor(page, NOTE_1);
    await page.getByText("Open differences only").click();
    await expect(page.locator("tr", { hasText: NOTE_1 })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("(5) Short $3 → Close books one Drawer shortage expense; Reopen voids it", async ({
    page,
  }) => {
    const headers = await auth(page);
    const NOTE = `web-075 short ${Date.now()}`;

    const before = await generalUsd(page, headers);
    await checkpoint(page, headers, NOTE, before - 3, before);
    const after = await generalUsd(page, headers);
    expect(after - before).toBeCloseTo(-3, 2);

    const diff = await differenceOf(page, headers, NOTE);
    expect(diff, "no General/USD difference recorded").toBeTruthy();
    expect(diff!.direction).toBe("SHORT");
    expect(diff!.status).toBe("OPEN");
    expect(diff!.open).toBeCloseTo(3, 2);

    // The details window offers Close to an admin.
    await openTimelineFor(page, NOTE);
    await page
      .locator("tr", { hasText: NOTE })
      .getByTitle("View details")
      .click();
    await expect(
      page.getByRole("button", { name: "Close difference…" }),
    ).toBeVisible({ timeout: 15_000 });

    // Close over REST (the dialog's confirm wording is the UI lane's call).
    const closed = await (
      await page.request.post(`${BACKEND_URL}/api/closing/differences/close`, {
        headers,
        data: { difference_id: diff!.id },
      })
    ).json();
    expect(closed.success, JSON.stringify(closed)).toBeTruthy();
    const closedView = closed.data as DifferenceView;
    expect(closedView.status).toBe("CLOSED");
    expect(closedView.shortage_expense_id).not.toBeNull();
    const expenseId = closedView.shortage_expense_id as number;

    // Books only: no drawer movement.
    expect((await generalUsd(page, headers)) - after).toBeCloseTo(0, 2);
    const expense = await liveExpense(page, headers, expenseId);
    expect(
      expense,
      `Drawer shortage expense #${expenseId} not listed`,
    ).toBeTruthy();
    expect(expense!.category).toBe("Drawer shortage");
    expect(expense!.amount_usd).toBeCloseTo(3, 2);

    const reopened = await (
      await page.request.post(`${BACKEND_URL}/api/closing/differences/reopen`, {
        headers,
        data: { difference_id: diff!.id },
      })
    ).json();
    expect(reopened.success, JSON.stringify(reopened)).toBeTruthy();
    const reopenedView = reopened.data as DifferenceView;
    expect(reopenedView.status).toBe("OPEN");
    expect(reopenedView.open).toBeCloseTo(3, 2);
    expect(reopenedView.shortage_expense_id).toBeNull();

    expect(await liveExpense(page, headers, expenseId)).toBeUndefined();
    expect((await generalUsd(page, headers)) - after).toBeCloseTo(0, 2);
  });
});
