/**
 * lira-web-065 — settle the OMT account BY AMOUNT, one currency at a time
 * (LIRA-322, specs/322-omt-amount-first-settle). Real browser sheet + REST.
 *
 * One test, in order, over rows this spec seeds itself:
 *   A  OMT SEND  $145 + $7 fee  → owes $152 (oldest)
 *   B  OMT SEND  $95  + $6 fee  → owes $101
 *   C  OMT SEND  $18  + $3 fee  → owes $21
 *   L  OMT SEND in LBP          → owes L LBP
 *
 * LIRA-343: the sheet now opens on a day calendar and settles the PICKED
 * DAYS (every open day before today starts picked; single transfers are no
 * longer ticked). So all four rows are backdated (`transaction_time`, noon
 * UTC) onto ONE past day that has no other open row on the account, and the
 * UI step clears the default pick and picks only that day. L was an iPick
 * LBP top-up before; a top-up cannot be backdated, so it is now an LBP OMT
 * transfer (still "LBP owed while paying USD only").
 *
 *  1. UI, USD only while LBP is owed: the calendar picks exactly the seeded
 *     day (A/B/C/L), the OMT credit is set to 0. ONE payment box (owner 2026-10-15) opens with a USD
 *     line and an LBP line pre-filled with what is owed; setting the USD
 *     line to $199 and clearing the LBP line previews A closes, B part-paid
 *     "$47 of $101 · $54 owed", C untouched, $75.00 still owed, L untouched,
 *     and the box's Remaining row "$75.00 · L LBP" (never one converted
 *     figure) — BEFORE confirming. After confirming:
 *     the OMT drawer moved −$199 and 0 LBP, L still owes all of L, and the
 *     settlement sent no LBP section.
 *  2. Suppliers → OMT → Transactions shows B as "Partial · $47.00".
 *  3. REST: a second settlement (B + C, Cash $60) closes B and part-pays C.
 *  4. LIRA-343 (FR-018, owner 2026-10-26): undoing the FIRST settlement is
 *     allowed although the second one relied on it (both paid B). A
 *     reopens to $152; B and the second settlement stay as they are (B
 *     stays closed); the $47 the first one paid on B becomes an account
 *     line "Owed to OMT added: $47.00 (undo of #s1)", on no day; the drawer
 *     and the account move back by exactly the $199 of the undone one. In
 *     the sheet, that line links to the day of the undo, which shows the ↺
 *     badge naming the undo.
 *  5. Clean-up that is also a check: one REST call pays A, C and the $47
 *     account line in USD and L in LBP (both sections in one go), so this
 *     spec leaves nothing open; the drawer and the account end exactly
 *     $274 and L LBP below where they started (s2 + clean-up).
 *
 * Rule 15: the account carries other specs' backlog, so every settlement is
 * scoped to this spec's own rows (their own day in the UI, `selections`
 * over REST), rows are matched by kind + id, and every money check is a
 * delta.
 */
import type { Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  loginAsAdmin,
  gotoAndSettle,
  BACKEND_URL,
} from "./fixtures";

type Auth = { Authorization: string };

interface AccountUnsettledRow {
  kind: "FINANCIAL_SERVICE" | "LEDGER";
  id: number;
  supplier_id: number;
  source_provider: string | null;
  entry_type: string | null;
  amount_usd: number;
  amount_lbp: number;
  covered_usd?: number;
  covered_lbp?: number;
  remaining_usd: number;
  remaining_lbp: number;
  /** LIRA-343 — the shop's calendar day of the row (`YYYY-MM-DD`). */
  shop_day: string;
  /** LIRA-343 — on a day, or an account line on no day. */
  row_scope: "DAY" | "ACCOUNT";
  /** LIRA-343 T037 — set on the account line an undo / void wrote. */
  relief_origin?: "UNDO" | "VOID" | null;
  /** `"#<undone / voided transaction id>"` when `relief_origin` is set. */
  relief_ref?: string | null;
}
interface AccountBalance {
  account_supplier_id: number;
  account_name: string;
  total_usd: number;
  total_lbp: number;
}
interface RecentTxn {
  id: number;
  type: string;
  status: string;
  source_table: string | null;
  source_id: number | null;
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
  data?: unknown,
): Promise<{ success: boolean; id?: number; error?: string }> {
  return (
    await page.request.post(`${BACKEND_URL}${url}`, {
      headers: auth,
      ...(data === undefined ? {} : { data }),
    })
  ).json();
}

async function omtAccount(page: Page, auth: Auth): Promise<AccountBalance> {
  const r = await getJson<{ balances: AccountBalance[] }>(
    page,
    auth,
    "/api/suppliers/account-balances",
  );
  const account = r.balances.find((a) => a.account_name === "OMT");
  expect(account, JSON.stringify(r.balances)).toBeTruthy();
  return account!;
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

/** The OMT Cash Drawer (D3: every settlement cash leg lands here). */
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

/** Signed in-scope remaining — what the sheet sends as `expected_owed`. */
function expectedOwed(
  rows: AccountUnsettledRow[],
  refs: RowRef[],
): { usd: number; lbp: number } {
  const scoped = refs.map((ref) => {
    const row = findRow(rows, ref);
    expect(row, `row ${ref.kind}:${ref.id} not in the queue`).toBeTruthy();
    return row!;
  });
  return {
    usd: Math.round(scoped.reduce((s, r) => s + r.remaining_usd, 0) * 100) / 100,
    lbp: Math.round(scoped.reduce((s, r) => s + r.remaining_lbp, 0)),
  };
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
  auth: Auth,
  accountId: number,
  today: string,
): Promise<string> {
  const open = new Set(
    (await queue(page, auth, accountId)).map((r) => r.shop_day),
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

function previewRow(section: Locator, ref: RowRef): Locator {
  return section.locator(
    `[data-testid="supplier-account-settle-preview-row"][data-kind="${ref.kind}"][data-row-id="${ref.id}"]`,
  );
}

test("lira-web-065 OMT settle by amount: USD only while LBP is owed, a previewed partial, the 'Partial · $47.00' label, and undoing the older settlement leaves an 'owed to OMT' account line", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth: Auth = { Authorization: `Bearer ${token}` };
  const marker = Date.now();
  const LBP_AMOUNT = 900_000 + (marker % 1000) * 1000;
  const LBP_FEE = 50_000;

  const account = await omtAccount(page, auth);
  const omtId = account.account_supplier_id;

  // ── Seed: all four rows on ONE past day with no other open row ─────────
  const today = await browserToday(page);
  const DAY = await freePastDay(page, auth, omtId, today);
  const send = async (
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
      payments: [{ method: "CASH", currencyCode: currency, amount: amount + fee }],
      transaction_time: noonUtc(DAY),
    });
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return { kind: "FINANCIAL_SERVICE", id: r.id as number };
  };
  const A = await send(145, 7);
  const B = await send(95, 6);
  const C = await send(18, 3);
  const L = await send(LBP_AMOUNT, LBP_FEE, "LBP");

  const seeded = await queue(page, auth, omtId);
  // `transaction_time` reached the row (a stripped key would land it on
  // today, and the day pick below would then settle nothing of ours).
  for (const ref of [A, B, C, L]) {
    expect(findRow(seeded, ref)?.shop_day, `${ref.kind}:${ref.id}`).toBe(DAY);
  }
  // DAY carries only this spec's four rows.
  expect(
    seeded.filter(
      (r) =>
        r.shop_day === DAY &&
        ![A, B, C, L].some((ref) => ref.kind === r.kind && ref.id === r.id),
    ),
  ).toEqual([]);
  const lRow = findRow(seeded, L);
  expect(lRow?.amount_usd).toBe(0);
  const LBP_OWED = lRow!.remaining_lbp;
  expect(LBP_OWED).toBeGreaterThan(0);

  expect(findRow(seeded, A)?.remaining_usd).toBeCloseTo(152, 2);
  expect(findRow(seeded, B)?.remaining_usd).toBeCloseTo(101, 2);
  expect(findRow(seeded, C)?.remaining_usd).toBeCloseTo(21, 2);
  expect(findRow(seeded, L)?.remaining_lbp).toBe(LBP_OWED);

  // Snapshots AFTER seeding (the SENDs' own cash lands in this drawer).
  const drawerStart = await omtDrawer(page, auth);
  const accountStart = await omtAccount(page, auth);

  // ── 1. UI: USD only, $199, previewed before confirming ─────────────────
  await gotoAndSettle(page, "/#/suppliers");
  await expect(page.locator("#root")).not.toContainText("Something went wrong");
  const card = page.getByTestId("supplier-account-card-OMT");
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByTestId("supplier-account-settle-button").click();
  const sheet = page.getByTestId("supplier-account-settle-sheet");
  await expect(sheet).toBeVisible({ timeout: 10_000 });

  // LIRA-343: every open day before today starts picked — DAY among them.
  const dayButton = sheet.locator(`[data-day="${DAY}"] button`);
  if (DAY.slice(0, 7) === today.slice(0, 7)) {
    await expect(dayButton).toHaveAttribute("aria-pressed", "true", {
      timeout: 15_000,
    });
  }
  // Pick exactly this spec's day (its four rows), with no OMT credit. Both
  // BEFORE typing: changing the days or the credit re-fills the box.
  await pickOnlyDay(sheet, today, DAY);
  await setCreditToZero(sheet);

  // ONE box for both currencies; the header keeps each in its own currency.
  const box = sheet.getByTestId("supplier-account-settle-section-usd-lbp");
  const usd = box;
  const lbp = box;
  await expect(box.getByTestId("supplier-account-settle-owed-usd")).toHaveText(
    "$274.00",
  );
  await expect(box.getByTestId("supplier-account-settle-owed-lbp")).toHaveText(
    `${LBP_OWED.toLocaleString("en-US")} LBP`,
  );
  const amounts = box.locator('[data-testid^="payment-amount-"]');
  await expect(amounts).toHaveCount(2);

  // Line 1 is USD, line 2 LBP (both Cash, pre-filled with what is owed).
  await amounts.nth(0).fill("199");
  await amounts.nth(1).fill("0");
  await expect(box.getByTestId("remaining-amount")).toHaveText(
    `$75.00 · ${LBP_OWED.toLocaleString("en-US")} LBP`,
  );

  // The preview, before confirming.
  await expect(previewRow(usd, A)).toHaveAttribute("data-status", "closes");
  await expect(previewRow(usd, B)).toHaveAttribute("data-status", "part-paid");
  await expect(previewRow(usd, B)).toContainText("$47 of $101 · $54 owed");
  await expect(previewRow(usd, C)).toHaveAttribute("data-status", "untouched");
  await expect(
    usd.getByTestId("supplier-account-settle-still-owed-usd"),
  ).toHaveText("$75.00");
  await expect(previewRow(lbp, L)).toHaveAttribute("data-status", "untouched");
  await expect(
    lbp.getByTestId("supplier-account-settle-still-owed-lbp"),
  ).toHaveText(`${LBP_OWED.toLocaleString("en-US")} LBP`);

  const submit = sheet.getByTestId("supplier-account-settle-submit");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(sheet).toBeHidden({ timeout: 15_000 });

  const drawerAfter1 = await omtDrawer(page, auth);
  expect(drawerAfter1.usd - drawerStart.usd).toBeCloseTo(-199, 2);
  expect(drawerAfter1.lbp - drawerStart.lbp).toBeCloseTo(0, 0);
  const accountAfter1 = await omtAccount(page, auth);
  expect(accountAfter1.total_usd - accountStart.total_usd).toBeCloseTo(-199, 2);
  expect(accountAfter1.total_lbp - accountStart.total_lbp).toBeCloseTo(0, 0);

  const q1 = await queue(page, auth, omtId);
  expect(findRow(q1, A), "A should be closed").toBeUndefined();
  expect(findRow(q1, B)?.remaining_usd).toBeCloseTo(54, 2);
  expect(findRow(q1, B)?.covered_usd).toBeCloseTo(47, 2);
  expect(findRow(q1, C)?.remaining_usd).toBeCloseTo(21, 2);
  expect(findRow(q1, L)?.remaining_lbp).toBe(LBP_OWED);

  // The ONE settlement this sheet wrote, by identity (its ticked rows).
  const s1 = (await settlementTxns(page, auth)).filter((t) => {
    const meta = JSON.parse(t.metadata_json ?? "{}") as {
      selections?: RowRef[];
    };
    return (meta.selections ?? []).some(
      (s) => s.kind === A.kind && s.id === A.id,
    );
  });
  expect(s1, JSON.stringify(s1)).toHaveLength(1);
  const s1Meta = JSON.parse(s1[0].metadata_json ?? "{}") as {
    per_currency?: Record<string, { direction: string }>;
  };
  expect(Object.keys(s1Meta.per_currency ?? {})).toEqual(["USD"]);
  expect(s1Meta.per_currency?.USD.direction).toBe("PAY");

  // ── 2. Suppliers → OMT → Transactions: "Partial · $47.00" ──────────────
  await page.getByTestId("supplier-tile-OMT").click();
  // The history opens in its own modal from the header (owner 2026-10-16).
  await page.getByTestId("supplier-open-transactions").click();
  await expect(page.getByTestId(`supplier-txn-row-${B.id}`)).toContainText(
    "Partial · $47.00",
    { timeout: 15_000 },
  );
  await expect(page.getByTestId(`supplier-txn-row-${A.id}`)).toContainText(
    "Settled",
  );
  await expect(page.getByTestId(`supplier-txn-row-${C.id}`)).toContainText(
    "Unpaid",
  );

  // ── 3. REST: a second settlement over B + C, Cash $60 ──────────────────
  const drawerBefore2 = await omtDrawer(page, auth);
  const s2Res = await postJson(
    page,
    auth,
    `/api/suppliers/${omtId}/settle-account`,
    {
      account_supplier_id: omtId,
      selections: [B, C],
      expected_owed: expectedOwed(q1, [B, C]),
      per_currency: {
        USD: {
          direction: "PAY",
          payments: [{ method: "CASH", currency_code: "USD", amount: 60 }],
        },
      },
      note: `lira-web-065 second ${marker}`,
    },
  );
  expect(s2Res.success, JSON.stringify(s2Res)).toBeTruthy();
  const s2 = (await settlementTxns(page, auth)).find(
    (t) => t.source_table === "supplier_ledger" && t.source_id === s2Res.id,
  );
  expect(s2, "second settlement transaction not found").toBeTruthy();

  const q2 = await queue(page, auth, omtId);
  expect(findRow(q2, B), "B should be closed").toBeUndefined();
  expect(findRow(q2, C)?.remaining_usd).toBeCloseTo(15, 2);
  expect((await omtDrawer(page, auth)).usd - drawerBefore2.usd).toBeCloseTo(
    -60,
    2,
  );

  // ── 4. Undo the FIRST settlement although the second relied on it ────
  // LIRA-343 FR-018: allowed, no refusal. s2 stays; B stays closed; the
  // $47 s1 paid on B becomes an open account line owed to OMT.
  const drawerBeforeUndo = await omtDrawer(page, auth);
  const accountBeforeUndo = await omtAccount(page, auth);
  const undo1 = await postJson(page, auth, `/api/transactions/${s1[0].id}/void`);
  expect(undo1.success, JSON.stringify(undo1)).toBeTruthy();

  const qUndo = await queue(page, auth, omtId);
  expect(findRow(qUndo, A)?.remaining_usd).toBeCloseTo(152, 2);
  expect(findRow(qUndo, B), "B stays closed by the second settlement").toBeUndefined();
  expect(findRow(qUndo, C)?.remaining_usd).toBeCloseTo(15, 2);
  expect(findRow(qUndo, L)?.remaining_lbp).toBe(LBP_OWED);
  // The account line, by identity: written by the undo of s1.
  const reliefRows = qUndo.filter(
    (r) =>
      r.kind === "LEDGER" &&
      r.row_scope === "ACCOUNT" &&
      r.relief_origin === "UNDO" &&
      r.relief_ref === `#${s1[0].id}`,
  );
  expect(reliefRows, JSON.stringify(reliefRows)).toHaveLength(1);
  const relief = reliefRows[0];
  expect(relief.remaining_usd).toBeCloseTo(47, 2);
  expect(relief.remaining_lbp).toBe(0);
  const RELIEF: RowRef = { kind: "LEDGER", id: relief.id };

  // Exactly s1's $199 comes back; the account line pair is balance-neutral.
  const drawerAfterUndo = await omtDrawer(page, auth);
  expect(drawerAfterUndo.usd - drawerBeforeUndo.usd).toBeCloseTo(199, 2);
  expect(drawerAfterUndo.lbp - drawerBeforeUndo.lbp).toBeCloseTo(0, 0);
  const accountAfterUndo = await omtAccount(page, auth);
  expect(accountAfterUndo.total_usd - accountBeforeUndo.total_usd).toBeCloseTo(
    199,
    2,
  );
  expect(accountAfterUndo.total_lbp - accountBeforeUndo.total_lbp).toBeCloseTo(
    0,
    0,
  );
  // s2 is untouched by the undo.
  const s2After = (await settlementTxns(page, auth)).find((t) => t.id === s2!.id);
  expect(s2After?.status, JSON.stringify(s2After)).toBe(s2!.status);

  // The sheet: the account line names the undo and links to its day, and
  // that day carries the ↺ badge. The day is the row's own `shop_day` (the
  // server stamped it), never the browser's today (rule 27).
  await page.reload();
  await gotoAndSettle(page, "/#/suppliers");
  const card2 = page.getByTestId("supplier-account-card-OMT");
  await expect(card2).toBeVisible({ timeout: 15_000 });
  await card2.getByTestId("supplier-account-settle-button").click();
  const sheet2 = page.getByTestId("supplier-account-settle-sheet");
  await expect(sheet2).toBeVisible({ timeout: 10_000 });
  const reliefLine = sheet2
    .getByTestId("supplier-account-settle-relief-line")
    .filter({ hasText: `(undo of #${s1[0].id})` });
  await expect(reliefLine).toHaveCount(1, { timeout: 15_000 });
  await expect(reliefLine).toContainText(
    `Owed to OMT added: $47.00 (undo of #${s1[0].id})`,
  );
  await reliefLine.getByRole("button").click();
  const undoDay = sheet2.locator(`[data-day="${relief.shop_day}"]`);
  await expect(undoDay).toBeVisible({ timeout: 15_000 });
  await expect(undoDay.locator("[data-account-mark]")).toHaveCount(1);
  // Other undos / voids may mark the same day: the tooltip names this one.
  // (The tooltip only shows on hover; its text is in the DOM already.)
  await expect(undoDay.locator('[role="tooltip"]')).toContainText(
    `Owed to OMT added: $47.00 (undo of #${s1[0].id})`,
  );

  // ── 5. Both currencies in one call (also the clean-up) ─────────────────
  // A and C in USD, L in LBP, plus the $47 account line (selected like a
  // row: without `include_account_credits` it is not netted against other
  // specs' account lines).
  const all = [A, C, L, RELIEF];
  const owedAll = expectedOwed(qUndo, all);
  expect(owedAll).toEqual({ usd: 214, lbp: LBP_OWED });
  const both = await postJson(
    page,
    auth,
    `/api/suppliers/${omtId}/settle-account`,
    {
      account_supplier_id: omtId,
      selections: all,
      expected_owed: owedAll,
      per_currency: {
        USD: {
          direction: "PAY",
          payments: [{ method: "CASH", currency_code: "USD", amount: 214 }],
        },
        LBP: {
          direction: "PAY",
          payments: [
            { method: "CASH", currency_code: "LBP", amount: LBP_OWED },
          ],
        },
      },
      note: `lira-web-065 clean-up ${marker}`,
    },
  );
  expect(both.success, JSON.stringify(both)).toBeTruthy();
  const qEnd = await queue(page, auth, omtId);
  for (const ref of [A, B, C, L, RELIEF]) {
    expect(findRow(qEnd, ref), `${ref.kind}:${ref.id} still open`).toBeUndefined();
  }
  const drawerEnd = await omtDrawer(page, auth);
  expect(drawerEnd.usd - drawerAfterUndo.usd).toBeCloseTo(-214, 2);
  expect(drawerEnd.lbp - drawerAfterUndo.lbp).toBeCloseTo(-LBP_OWED, 0);
  // End to end: s2 ($60) + the clean-up ($214) = everything A/B/C owed
  // ($274), and all of L — the undone s1 nets to zero apart from the $47
  // line the clean-up just paid.
  expect(drawerEnd.usd - drawerStart.usd).toBeCloseTo(-274, 2);
  expect(drawerEnd.lbp - drawerStart.lbp).toBeCloseTo(-LBP_OWED, 0);
  const accountEnd = await omtAccount(page, auth);
  expect(accountEnd.total_usd - accountStart.total_usd).toBeCloseTo(-274, 2);
  expect(accountEnd.total_lbp - accountStart.total_lbp).toBeCloseTo(
    -LBP_OWED,
    0,
  );
});
