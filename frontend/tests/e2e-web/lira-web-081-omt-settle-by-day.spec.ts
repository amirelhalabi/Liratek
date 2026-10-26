/**
 * lira-web-081 — settle the OMT account BY DAY (LIRA-343,
 * specs/343-omt-settle-by-day, T027). Real browser sheet + REST.
 *
 * Seeds two past days that had no open OMT-account row, all backdated
 * (`transaction_time`, noon UTC):
 *   DAY_OLD  OMT SEND $X1 + fee, and an OMT SEND in LBP  → a two-currency day
 *   DAY_NEW  OMT SEND $X2 + fee, and an OMT RECEIVE of $R → OMT owes back $R
 *
 *  1. The calendar: both days are open ("unpaid") and picked by default
 *     (every open day before today is); DAY_OLD shows the $ and L badges,
 *     DAY_NEW the one-currency paid-share ring; today is never picked by
 *     default; a future day cannot be picked.
 *  2. The operator clears the pick, picks both days, then unpicks DAY_OLD:
 *     it gets the amber "!" (older open day left out). Tapping DAY_NEW also
 *     opens its day details, listing its two transfers ticked. The OMT
 *     credit is set to 0 (other specs leave credit on the account).
 *  3. The payment box is pre-filled with what DAY_NEW nets to (the receive
 *     nets inside the picked day): SEND owed − R. Nothing in LBP is owed.
 *     The What's new screenshot is saved here, with the sheet open.
 *  4. Confirm. By identity: DAY_NEW's SEND and RECEIVE are closed, both of
 *     DAY_OLD's transfers are still open and untouched; the settlement's
 *     own `selections` name DAY_NEW's rows only; the OMT Cash Drawer moved
 *     by exactly −(SEND owed − R) in $ and 0 in LBP.
 *  5. Reopened, the calendar shows DAY_NEW settled and DAY_OLD unpaid.
 *  6. Clean-up over REST: DAY_OLD is settled exactly, so no open row stays
 *     behind for the next run.
 *
 * Rule 15: the DB accumulates across runs and specs, so rows are matched by
 * kind + id, the picked days are proven to carry only this spec's rows, and
 * every money check is a delta. Rule 30: saves
 * `frontend/public/whats-new/1.35.0/omt-settle-calendar.png` (landscape).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  loginAsAdmin,
  gotoAndSettle,
  BACKEND_URL,
} from "./fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/omt-settle-calendar.png",
);

type Auth = { Authorization: string };

interface AccountUnsettledRow {
  kind: "FINANCIAL_SERVICE" | "LEDGER";
  id: number;
  amount_usd: number;
  amount_lbp: number;
  remaining_usd: number;
  remaining_lbp: number;
  shop_day: string;
  row_scope: "DAY" | "ACCOUNT";
}
interface AccountBalance {
  account_supplier_id: number;
  account_name: string;
}
interface RecentTxn {
  id: number;
  type: string;
  metadata_json: string | null;
}
type RowRef = { kind: AccountUnsettledRow["kind"]; id: number };

async function getJson<T>(page: Page, auth: Auth, url: string): Promise<T> {
  const r = await (
    await page.request.get(`${BACKEND_URL}${url}`, { headers: auth })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r as T;
}

async function postJson(
  page: Page,
  auth: Auth,
  url: string,
  data: unknown,
): Promise<{ success: boolean; id?: number; error?: string }> {
  return (
    await page.request.post(`${BACKEND_URL}${url}`, { headers: auth, data })
  ).json();
}

async function omtAccountId(page: Page, auth: Auth): Promise<number> {
  const r = await getJson<{ balances: AccountBalance[] }>(
    page,
    auth,
    "/api/suppliers/account-balances",
  );
  const account = r.balances.find((a) => a.account_name === "OMT");
  expect(account, JSON.stringify(r.balances)).toBeTruthy();
  return account!.account_supplier_id;
}

async function queue(
  page: Page,
  auth: Auth,
  accountId: number,
): Promise<AccountUnsettledRow[]> {
  const r = await getJson<{ transactions: AccountUnsettledRow[] }>(
    page,
    auth,
    `/api/suppliers/${accountId}/account-unsettled`,
  );
  return r.transactions;
}

const findRow = (rows: AccountUnsettledRow[], ref: RowRef) =>
  rows.find((r) => r.kind === ref.kind && r.id === ref.id);

/** The OMT Cash Drawer: every settlement cash leg lands here. */
async function omtDrawer(
  page: Page,
  auth: Auth,
): Promise<{ usd: number; lbp: number }> {
  const r = await getJson<{
    balances: Array<{ name: string; usdBalance: number; lbpBalance: number }>;
  }>(page, auth, "/api/recharge/drawer-balances");
  const d = r.balances.find((b) => b.name === "OMT_System");
  expect(d, JSON.stringify(r.balances)).toBeTruthy();
  return { usd: d!.usdBalance, lbp: d!.lbpBalance };
}

async function settlementTxns(page: Page, auth: Auth): Promise<RecentTxn[]> {
  const r = await getJson<{ transactions: RecentTxn[] }>(
    page,
    auth,
    "/api/transactions/recent?type=SUPPLIER_SETTLEMENT&limit=300",
  );
  return r.transactions;
}

// ── Days ────────────────────────────────────────────────────────────────────

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

/** The most recent past day with NO OMT-account row at all (open OR
 *  settled), skipping `avoid`, so the day's colour comes from this spec's
 *  rows only (rule 15). Checking only the open queue is not enough: a day
 *  another spec already settled reads "partly paid" once new rows land. */
async function freePastDay(
  page: Page,
  auth: Auth,
  accountId: number,
  today: string,
  avoid: string[] = [],
): Promise<string> {
  const open = new Set(
    (await queue(page, auth, accountId)).map((r) => r.shop_day),
  );
  const busyByMonth = new Map<string, Set<string>>();
  const busyDays = async (month: string): Promise<Set<string>> => {
    const cached = busyByMonth.get(month);
    if (cached) return cached;
    const r = await getJson<{ rows: AccountUnsettledRow[] }>(
      page,
      auth,
      `/api/suppliers/${accountId}/account-month-rows?month=${month}`,
    );
    const days = new Set(r.rows.map((row) => row.shop_day));
    busyByMonth.set(month, days);
    return days;
  };
  for (let k = 1; k <= 180; k++) {
    const day = shiftDay(today, -k);
    if (open.has(day) || avoid.includes(day)) continue;
    if ((await busyDays(day.slice(0, 7))).has(day)) continue;
    return day;
  }
  throw new Error("no past day without OMT rows in the last 180 days");
}

// ── Calendar ────────────────────────────────────────────────────────────────

/** Walks the calendar from the shown month to `day`'s month. No test id on
 *  the month arrows (reported): found by their accessible names. */
async function showMonthOf(
  sheet: Locator,
  shown: string,
  day: string,
): Promise<string> {
  const diff = monthNumber(day) - monthNumber(shown);
  const name = diff < 0 ? "Previous month" : "Next month";
  for (let i = 0; i < Math.abs(diff); i++) {
    await sheet.getByRole("button", { name, exact: true }).click();
  }
  await expect(sheet.locator(`[data-day="${day}"]`)).toBeVisible({
    timeout: 15_000,
  });
  return day;
}

const dayButton = (sheet: Locator, day: string) =>
  sheet.locator(`[data-day="${day}"] button`);

test("lira-web-081 OMT settle by day: open days on the calendar, unpick one, settle the other, by identity and deltas", async ({
  page,
}) => {
  test.setTimeout(150_000);
  // Landscape, for the What's new screenshot (rule 30).
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth: Auth = { Authorization: `Bearer ${token}` };
  const marker = Date.now();
  const X1 = 60 + (marker % 37);
  const X2 = 120 + (marker % 41);
  const R = 30;
  const LBP_AMOUNT = 1_500_000 + (marker % 500) * 1000;

  const omtId = await omtAccountId(page, auth);
  const today = await browserToday(page);
  const DAY_NEW = await freePastDay(page, auth, omtId, today);
  const DAY_OLD = await freePastDay(page, auth, omtId, today, [DAY_NEW]);
  expect(DAY_OLD < DAY_NEW).toBe(true);

  // ── Seed ────────────────────────────────────────────────────────────────
  const send = async (
    day: string,
    amount: number,
    fee: number,
    currency: "USD" | "LBP" = "USD",
  ): Promise<RowRef> => {
    const r = await postJson(page, auth, "/api/services/transactions", {
      provider: "OMT",
      serviceType: "SEND",
      amount,
      currency,
      omtServiceType: "INTRA",
      omtFee: fee,
      payments: [
        { method: "CASH", currencyCode: currency, amount: amount + fee },
      ],
      transaction_time: noonUtc(day),
    });
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return { kind: "FINANCIAL_SERVICE", id: r.id as number };
  };
  const OLD_USD = await send(DAY_OLD, X1, 2);
  const OLD_LBP = await send(DAY_OLD, LBP_AMOUNT, 50_000, "LBP");
  const NEW_SEND = await send(DAY_NEW, X2, 4);
  const received = await postJson(page, auth, "/api/services/transactions", {
    provider: "OMT",
    serviceType: "RECEIVE",
    amount: R,
    currency: "USD",
    omtServiceType: "INTRA",
    omtFee: 1.5,
    cashoutMethod: "CASH",
    payments: [{ method: "CASH", currencyCode: "USD", amount: R }],
    transaction_time: noonUtc(DAY_NEW),
  });
  expect(received.success, JSON.stringify(received)).toBeTruthy();
  const NEW_RECEIVE: RowRef = {
    kind: "FINANCIAL_SERVICE",
    id: received.id as number,
  };
  const ours = [OLD_USD, OLD_LBP, NEW_SEND, NEW_RECEIVE];
  const oldRefs = [OLD_USD, OLD_LBP];
  const newRefs = [NEW_SEND, NEW_RECEIVE];

  const seeded = await queue(page, auth, omtId);
  for (const ref of oldRefs) {
    expect(findRow(seeded, ref)?.shop_day, `${ref.id}`).toBe(DAY_OLD);
  }
  for (const ref of newRefs) {
    expect(findRow(seeded, ref)?.shop_day, `${ref.id}`).toBe(DAY_NEW);
  }
  // Both days carry only this spec's rows.
  expect(
    seeded.filter(
      (r) =>
        (r.shop_day === DAY_OLD || r.shop_day === DAY_NEW) &&
        !ours.some((ref) => ref.kind === r.kind && ref.id === r.id),
    ),
  ).toEqual([]);

  const oldUsd = findRow(seeded, OLD_USD)!;
  const oldLbp = findRow(seeded, OLD_LBP)!;
  const newSend = findRow(seeded, NEW_SEND)!;
  const newReceive = findRow(seeded, NEW_RECEIVE)!;
  expect(oldUsd.remaining_usd).toBeCloseTo(X1 + 2, 2);
  expect(oldLbp.amount_usd).toBe(0);
  expect(oldLbp.remaining_lbp).toBeGreaterThan(0);
  expect(newSend.remaining_usd).toBeCloseTo(X2 + 4, 2);
  expect(newReceive.remaining_usd).toBeLessThan(0);
  // What DAY_NEW nets to: the receive nets inside the picked day.
  const NEW_NET =
    Math.round((newSend.remaining_usd + newReceive.remaining_usd) * 100) / 100;
  expect(NEW_NET).toBeGreaterThan(0);

  // Snapshot AFTER seeding: the transfers' own cash lands in this drawer.
  const drawerStart = await omtDrawer(page, auth);

  // ── 1. The calendar ────────────────────────────────────────────────────
  await gotoAndSettle(page, "/#/suppliers");
  await expect(page.locator("#root")).not.toContainText("Something went wrong");
  const card = page.getByTestId("supplier-account-card-OMT");
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByTestId("supplier-account-settle-button").click();
  const sheet = page.getByTestId("supplier-account-settle-sheet");
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  const bar = sheet.getByTestId("settle-selection-bar");
  await expect(bar).toBeVisible({ timeout: 15_000 });

  // The sheet opens on today's month. Today is never picked by default
  // (FR-008); a future day cannot be picked.
  await expect(sheet.locator(`[data-day="${today}"]`)).toBeVisible({
    timeout: 15_000,
  });
  await expect(dayButton(sheet, today)).not.toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const tomorrow = shiftDay(today, 1);
  if (tomorrow.slice(0, 7) === today.slice(0, 7)) {
    await expect(dayButton(sheet, tomorrow)).toBeDisabled();
    await expect(dayButton(sheet, tomorrow)).toHaveAttribute(
      "aria-label",
      /, future$/,
    );
  }

  // DAY_NEW: one currency, unpaid, picked by default, the paid-share ring.
  let shown = await showMonthOf(sheet, today, DAY_NEW);
  const newButton = dayButton(sheet, DAY_NEW);
  await expect(newButton).toHaveAttribute("aria-label", /, unpaid, /);
  await expect(newButton).toHaveAttribute("aria-pressed", "true");
  await expect(
    sheet.locator(`[data-day="${DAY_NEW}"] [data-ring="pct"]`),
  ).toHaveCount(1);
  await expect(
    sheet.locator(`[data-day="${DAY_NEW}"] [data-badge]`),
  ).toHaveCount(0);

  // DAY_OLD: two currencies, unpaid, picked by default, $ and L badges red.
  shown = await showMonthOf(sheet, shown, DAY_OLD);
  const oldButton = dayButton(sheet, DAY_OLD);
  await expect(oldButton).toHaveAttribute("aria-label", /, unpaid, /);
  await expect(oldButton).toHaveAttribute("aria-pressed", "true");
  await expect(
    sheet.locator(`[data-day="${DAY_OLD}"] [data-ring="state"]`),
  ).toHaveCount(1);
  await expect(
    sheet.locator(`[data-day="${DAY_OLD}"] [data-badge="USD"]`),
  ).toHaveAttribute("data-state", "OWED");
  await expect(
    sheet.locator(`[data-day="${DAY_OLD}"] [data-badge="LBP"]`),
  ).toHaveAttribute("data-state", "OWED");
  await expect(
    sheet.locator(`[data-day="${DAY_OLD}"] [data-amounts]`),
  ).toContainText("LBP");

  // ── 2. Clear, pick both days, then unpick DAY_OLD ──────────────────────
  // No test id on Clear (reported): the bar's only button while days are
  // picked; "Pick all open" while none are.
  const clear = bar.getByRole("button", { name: "Clear", exact: true });
  await clear.click();
  await expect(clear).toHaveCount(0);
  await expect(oldButton).toHaveAttribute("aria-pressed", "false");

  await oldButton.click();
  await expect(oldButton).toHaveAttribute("aria-pressed", "true");
  shown = await showMonthOf(sheet, shown, DAY_NEW);
  await newButton.click();
  await expect(newButton).toHaveAttribute("aria-pressed", "true");
  await expect(bar).toContainText("2 days picked");
  // Tapping a day also opens its details (FR-016): DAY_NEW's two transfers,
  // each with a ticked box (the day is picked, both are open).
  const details = sheet.getByTestId("settle-day-details");
  await expect(details).toBeVisible();
  for (const ref of newRefs) {
    await expect(
      details
        .getByTestId(`settle-day-row-${ref.kind}:${ref.id}`)
        .getByRole("checkbox"),
    ).toBeChecked({ timeout: 15_000 });
  }

  shown = await showMonthOf(sheet, shown, DAY_OLD);
  await oldButton.click();
  await expect(oldButton).toHaveAttribute("aria-pressed", "false");
  // An older open day left out: the amber "!".
  await expect(
    sheet.locator(`[data-day="${DAY_OLD}"] [data-corner="leftOut"]`),
  ).toHaveCount(1);
  await expect(bar).toContainText("1 day picked");

  // The OMT credit, BEFORE reading the box (it re-fills the box).
  for (const c of ["usd", "lbp"]) {
    const input = sheet.getByTestId(`supplier-account-settle-credit-${c}`);
    if (await input.count()) {
      await input.fill("0");
      await expect(input).toHaveValue("0");
    }
  }

  // ── 3. The pre-filled payment: what DAY_NEW nets to, $ only ────────────
  const usd = sheet.getByTestId("supplier-account-settle-section-usd");
  await expect(usd.getByTestId("supplier-account-settle-owed-usd")).toHaveText(
    `$${NEW_NET.toFixed(2)}`,
  );
  await expect(
    sheet.getByTestId("supplier-account-settle-section-usd-lbp"),
  ).toHaveCount(0);
  await expect(
    sheet.getByTestId("supplier-account-settle-section-lbp"),
  ).toHaveCount(0);
  const amount = usd.locator('[data-testid^="payment-amount-"]');
  await expect(amount).toHaveCount(1);
  expect(
    Number((await amount.first().inputValue()).replace(/,/g, "")),
  ).toBeCloseTo(NEW_NET, 2);
  // Only DAY_NEW's two transfers are in the preview; the SEND closes.
  const previewRows = usd.locator(
    '[data-testid="supplier-account-settle-preview-row"]',
  );
  await expect(previewRows).toHaveCount(2);
  for (const ref of newRefs) {
    await expect(
      usd.locator(
        `[data-testid="supplier-account-settle-preview-row"][data-kind="${ref.kind}"][data-row-id="${ref.id}"]`,
      ),
    ).toHaveCount(1);
  }
  await expect(
    usd.locator(
      `[data-testid="supplier-account-settle-preview-row"][data-row-id="${NEW_SEND.id}"]`,
    ),
  ).toHaveAttribute("data-status", "closes");
  await expect(
    usd.getByTestId("supplier-account-settle-still-owed-usd"),
  ).toHaveText("$0.00");

  // What's new (rule 30): the sheet with the calendar, on DAY_NEW's month.
  // The details panel still shows DAY_OLD (the last day tapped): close it
  // by ITS Close button (the sheet has its own "Close") so the shot shows
  // the calendar alone.
  await details.getByRole("button", { name: "Close", exact: true }).click();
  await expect(details).toHaveCount(0);
  shown = await showMonthOf(sheet, shown, DAY_NEW);
  await sheet
    .getByTestId("supplier-account-settle-calendar")
    .scrollIntoViewIfNeeded();
  mkdirSync(path.dirname(SCREENSHOT), { recursive: true });
  await page.screenshot({ path: SCREENSHOT });

  // ── 4. Confirm; check by identity and deltas ───────────────────────────
  const submit = sheet.getByTestId("supplier-account-settle-submit");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(sheet).toBeHidden({ timeout: 15_000 });

  const after = await queue(page, auth, omtId);
  for (const ref of newRefs) {
    expect(findRow(after, ref), `${ref.id} should be closed`).toBeUndefined();
  }
  expect(findRow(after, OLD_USD)?.remaining_usd).toBeCloseTo(
    oldUsd.remaining_usd,
    2,
  );
  expect(findRow(after, OLD_LBP)?.remaining_lbp).toBe(oldLbp.remaining_lbp);

  const drawerAfter = await omtDrawer(page, auth);
  expect(drawerAfter.usd - drawerStart.usd).toBeCloseTo(-NEW_NET, 2);
  expect(drawerAfter.lbp - drawerStart.lbp).toBeCloseTo(0, 0);

  // The ONE settlement this sheet wrote, by identity: its own selections.
  const mine = (await settlementTxns(page, auth)).filter((t) => {
    const meta = JSON.parse(t.metadata_json ?? "{}") as {
      selections?: RowRef[];
    };
    return (meta.selections ?? []).some(
      (s) => s.kind === NEW_SEND.kind && s.id === NEW_SEND.id,
    );
  });
  expect(mine, JSON.stringify(mine)).toHaveLength(1);
  const selections = (
    JSON.parse(mine[0].metadata_json ?? "{}") as { selections: RowRef[] }
  ).selections;
  expect(selections.map((s) => s.id).sort((a, b) => a - b)).toEqual(
    newRefs.map((r) => r.id).sort((a, b) => a - b),
  );

  // ── 5. Reopened: DAY_NEW settled, DAY_OLD still unpaid ─────────────────
  await card.getByTestId("supplier-account-settle-button").click();
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  await expect(bar).toBeVisible({ timeout: 15_000 });
  shown = await showMonthOf(sheet, today, DAY_NEW);
  await expect(newButton).toHaveAttribute("aria-label", /, settled$/);
  await expect(
    sheet.locator(`[data-day="${DAY_NEW}"] [data-settled-check]`),
  ).toHaveCount(1);
  await showMonthOf(sheet, shown, DAY_OLD);
  await expect(oldButton).toHaveAttribute("aria-label", /, unpaid, /);
  // Still open, so picked again by default.
  await expect(oldButton).toHaveAttribute("aria-pressed", "true");

  // ── 6. Clean-up over REST: settle DAY_OLD exactly ──────────────────────
  const cleanup = await postJson(
    page,
    auth,
    `/api/suppliers/${omtId}/settle-account`,
    {
      account_supplier_id: omtId,
      selections: oldRefs,
      expected_owed: { usd: oldUsd.remaining_usd, lbp: oldLbp.remaining_lbp },
      per_currency: {
        USD: {
          direction: "PAY",
          payments: [
            {
              method: "CASH",
              currency_code: "USD",
              amount: oldUsd.remaining_usd,
            },
          ],
        },
        LBP: {
          direction: "PAY",
          payments: [
            {
              method: "CASH",
              currency_code: "LBP",
              amount: oldLbp.remaining_lbp,
            },
          ],
        },
      },
      note: `lira-web-081 clean-up ${marker}`,
    },
  );
  expect(cleanup.success, JSON.stringify(cleanup)).toBeTruthy();
  const end = await queue(page, auth, omtId);
  for (const ref of ours) {
    expect(findRow(end, ref), `${ref.id} still open`).toBeUndefined();
  }
});
