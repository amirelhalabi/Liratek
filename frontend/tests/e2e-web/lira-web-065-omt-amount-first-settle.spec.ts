/**
 * lira-web-065 — settle the OMT account BY AMOUNT, one currency at a time
 * (LIRA-322, specs/322-omt-amount-first-settle). Real browser sheet + REST.
 *
 * One test, in order, over rows this spec seeds itself:
 *   A  OMT SEND  $145 + $7 fee  → owes $152 (oldest)
 *   B  OMT SEND  $95  + $6 fee  → owes $101
 *   C  OMT SEND  $18  + $3 fee  → owes $21
 *   L  iPick top-up in LBP      → owes L LBP
 *
 *  1. UI, USD only while LBP is owed: the sheet's "Pick transfers" ticks
 *     exactly A/B/C/L. ONE payment box (owner 2026-10-15) opens with a USD
 *     line and an LBP line pre-filled with what is owed; setting the USD
 *     line to $199 and clearing the LBP line previews A closes, B part-paid
 *     "$47 of $101 · $54 owed", C untouched, $75.00 still owed, L untouched,
 *     and the box's Remaining row "$75.00 · L LBP" (never one converted
 *     figure) — BEFORE confirming. After confirming:
 *     the OMT drawer moved −$199 and 0 LBP, L still owes all of L, and the
 *     settlement sent no LBP section.
 *  2. Suppliers → OMT → Transactions shows B as "Partial · $47.00".
 *  3. REST: a second settlement (B + C, Cash $60) closes B and part-pays C.
 *  4. Voiding the FIRST settlement is refused (a later one paid the same
 *     transfer) and changes nothing; voiding the second, then the first, is
 *     allowed and puts every row, the drawer and the account back.
 *  5. Clean-up that is also a check: one REST call pays A/B/C in USD and L
 *     in LBP (both sections in one go), so this spec leaves nothing open.
 *
 * Rule 15: the account carries other specs' backlog, so every settlement is
 * scoped to this spec's own rows (ticked in the UI, `selections` over REST),
 * rows are matched by kind + id, and every money check is a delta.
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

function previewRow(section: Locator, ref: RowRef): Locator {
  return section.locator(
    `[data-testid="supplier-account-settle-preview-row"][data-kind="${ref.kind}"][data-row-id="${ref.id}"]`,
  );
}

test("lira-web-065 OMT settle by amount: USD only while LBP is owed, a previewed partial, the 'Partial · $47.00' label, and newest-first voids", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth: Auth = { Authorization: `Bearer ${token}` };
  const marker = Date.now();
  const LBP_OWED = 900_000 + (marker % 1000) * 1000;

  const account = await omtAccount(page, auth);
  const omtId = account.account_supplier_id;

  // ── Seed ────────────────────────────────────────────────────────────────
  const send = async (amount: number, fee: number): Promise<RowRef> => {
    const r = await postJson(page, auth, "/api/services/transactions", {
      provider: "OMT",
      serviceType: "SEND",
      amount,
      currency: "USD",
      omtServiceType: "INTRA",
      omtFee: fee,
      payments: [{ method: "CASH", currencyCode: "USD", amount: amount + fee }],
    });
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return { kind: "FINANCIAL_SERVICE", id: r.id as number };
  };
  const A = await send(145, 7);
  const B = await send(95, 6);
  const C = await send(18, 3);

  const before = await queue(page, auth, omtId);
  const topUp = await postJson(page, auth, "/api/recharge/top-up-from-supplier", {
    provider: "iPick",
    amount: LBP_OWED,
    currency: "LBP",
  });
  expect(topUp.success, JSON.stringify(topUp)).toBeTruthy();
  const seeded = await queue(page, auth, omtId);
  const lRow = seeded.find(
    (r) =>
      r.kind === "LEDGER" &&
      r.source_provider === "iPick" &&
      r.amount_lbp === LBP_OWED &&
      !before.some((b) => b.kind === "LEDGER" && b.id === r.id),
  );
  expect(lRow, "seeded iPick LBP top-up not in the OMT queue").toBeTruthy();
  const L: RowRef = { kind: "LEDGER", id: lRow!.id };

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

  // Nothing is ticked by default; tick exactly this spec's four rows.
  await sheet.getByTestId("supplier-account-settle-pick-toggle").click();
  for (const ref of [A, B, C, L]) {
    const row = sheet.locator(
      `[data-testid="supplier-account-settle-row"][data-kind="${ref.kind}"][data-row-id="${ref.id}"]`,
    );
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByTestId("supplier-account-settle-row-toggle").check();
  }

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

  // ── 4. Newest-first voids ──────────────────────────────────────────────
  const drawerBeforeRefusal = await omtDrawer(page, auth);
  const refused = await postJson(
    page,
    auth,
    `/api/transactions/${s1[0].id}/void`,
  );
  expect(refused.success, JSON.stringify(refused)).toBe(false);
  expect(String(refused.error)).toContain("Void it first");
  expect(
    (await omtDrawer(page, auth)).usd - drawerBeforeRefusal.usd,
  ).toBeCloseTo(0, 2);
  const qRefused = await queue(page, auth, omtId);
  expect(findRow(qRefused, B), "a refused void reopened B").toBeUndefined();
  expect(findRow(qRefused, C)?.remaining_usd).toBeCloseTo(15, 2);

  const void2 = await postJson(page, auth, `/api/transactions/${s2!.id}/void`);
  expect(void2.success, JSON.stringify(void2)).toBeTruthy();
  const qVoid2 = await queue(page, auth, omtId);
  expect(findRow(qVoid2, B)?.remaining_usd).toBeCloseTo(54, 2);
  expect(findRow(qVoid2, C)?.remaining_usd).toBeCloseTo(21, 2);
  expect((await omtDrawer(page, auth)).usd - drawerBefore2.usd).toBeCloseTo(
    0,
    2,
  );

  const void1 = await postJson(page, auth, `/api/transactions/${s1[0].id}/void`);
  expect(void1.success, JSON.stringify(void1)).toBeTruthy();
  const qVoid1 = await queue(page, auth, omtId);
  expect(findRow(qVoid1, A)?.remaining_usd).toBeCloseTo(152, 2);
  expect(findRow(qVoid1, B)?.remaining_usd).toBeCloseTo(101, 2);
  expect(findRow(qVoid1, C)?.remaining_usd).toBeCloseTo(21, 2);
  expect(findRow(qVoid1, L)?.remaining_lbp).toBe(LBP_OWED);
  const drawerVoided = await omtDrawer(page, auth);
  expect(drawerVoided.usd - drawerStart.usd).toBeCloseTo(0, 2);
  expect(drawerVoided.lbp - drawerStart.lbp).toBeCloseTo(0, 0);
  const accountVoided = await omtAccount(page, auth);
  expect(accountVoided.total_usd - accountStart.total_usd).toBeCloseTo(0, 2);
  expect(accountVoided.total_lbp - accountStart.total_lbp).toBeCloseTo(0, 0);

  // ── 5. Both currencies in one call (also the clean-up) ─────────────────
  const all = [A, B, C, L];
  const owedAll = expectedOwed(qVoid1, all);
  expect(owedAll).toEqual({ usd: 274, lbp: LBP_OWED });
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
          payments: [{ method: "CASH", currency_code: "USD", amount: 274 }],
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
  for (const ref of all) {
    expect(findRow(qEnd, ref), `${ref.kind}:${ref.id} still open`).toBeUndefined();
  }
  const drawerEnd = await omtDrawer(page, auth);
  expect(drawerEnd.usd - drawerVoided.usd).toBeCloseTo(-274, 2);
  expect(drawerEnd.lbp - drawerVoided.lbp).toBeCloseTo(-LBP_OWED, 0);
});
