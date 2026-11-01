/**
 * lira-web-090 — LIRA-366: the optional Note on a money-in payment form,
 * over the web app (specs/366-payment-note/quickstart.md step 3).
 *
 * An MTC $6 credit transfer (600,000 LBP) to a known client, paid
 * 550,000 LBP cash + 50,000 LBP on the client's account, with the note
 * "rest on Monday":
 *   1. the request carries `typedNote` (the key the core schema reads);
 *   2. the transaction's details carry the note, the Details window shows
 *      it, and the row has the note mark (FR-002);
 *   3. the client's 50,000 LBP debt entry ends with the note (FR-003);
 *   4. editing the note changes the transaction and the debt entry
 *      together (FR-004, rule 31).
 * Also saves the What's new screenshot of the Note box (rule 30).
 *
 * Rows are found by identity (the recharge id / the phone number) and the
 * debt by its transaction id, never by position (rule 15).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "./fixtures";
import {
  addLine,
  closeDetails,
  findTxn,
  getJson,
  lastTxnId,
  openDetails,
  openShopDay,
  payLine,
  pickClientOption,
  postJson,
  splitOn,
  waitPost,
  type ShopDay,
} from "./shopDayHelpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/payment-note.png",
);

const NOTE = "rest on Monday";
const EDITED = "rest on Tuesday";

interface DebtRow {
  transaction_id: number | null;
  transaction_type: string;
  amount_lbp: number | null;
  note: string | null;
}

async function chargeRow(
  day: ShopDay,
  clientId: number,
  txnId: number,
): Promise<DebtRow> {
  const r = await getJson<{ success: boolean; history: DebtRow[] }>(
    day,
    `/api/debts/clients/${clientId}/history`,
  );
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  const row = r.history.find(
    (h) => h.transaction_id === txnId && / Debt$/.test(h.transaction_type),
  );
  expect(row, `debt charge row for transaction #${txnId}`).toBeTruthy();
  return row!;
}

test("payment note: saved, shown, marked, copied to the debt, edited together", async ({
  browser,
}) => {
  const day = await openShopDay(browser);
  const { page } = day;
  const clientName = `Note Spec ${day.stamp}`;
  const created = await postJson<{
    success: boolean;
    data?: { id: number };
    id?: number;
  }>(day, "/api/clients", {
    full_name: clientName,
    phone_number: `71${day.stamp}`,
  });
  const clientId = (created.data?.id ?? created.id) as number;
  expect(clientId, JSON.stringify(created)).toBeTruthy();
  // Stock so the transfer has credits to consume.
  await postJson(day, "/api/recharge/top-up", { provider: "MTC", amount: 20 });

  // ── The sale, typed on the real screen ─────────────────────────────────
  await page.goto("/#/recharge");
  const mtc = page.getByRole("button", { name: "MTC", exact: true }).first();
  await expect(mtc).toBeVisible({ timeout: 15_000 });
  await mtc.click();
  const before = await lastTxnId(day);
  const number = `03${day.stamp}`;
  await page.getByPlaceholder("XX XXX XXX").fill(number);
  await page.getByRole("button", { name: "$6", exact: true }).click();
  await page.getByRole("button", { name: /Proceed to Pay/ }).click();
  await pickClientOption(
    page,
    page.getByPlaceholder("Search client by name..."),
    clientName,
  );
  await splitOn(page);
  await payLine(page, 0, "CASH", 550_000, "LBP");
  await addLine(page);
  await payLine(page, 1, "CUSTOMER_ACCOUNT", 50_000, "LBP");
  const noteBox = page.getByTestId("payment-note").filter({ visible: true });
  await expect(noteBox).toBeVisible();
  await noteBox.fill(NOTE);
  await page.screenshot({ path: SCREENSHOT });

  const pay = page.getByRole("button", { name: /^Pay / });
  await expect(pay).toBeEnabled({ timeout: 10_000 });
  const res = waitPost(page, "/api/recharge");
  await pay.click();
  const { body, request } = await res;
  expect(body.success, JSON.stringify(body)).toBeTruthy();
  expect(request.typedNote, JSON.stringify(request)).toBe(NOTE);

  // ── 2. details, Details window, row mark ───────────────────────────────
  const t = await findTxn(
    day,
    before,
    "telecom_recharge",
    (x) => x.details?.phone === number,
  );
  expect(t.details?.note).toBe(NOTE);
  const panel = await openDetails(day, t.id, clientName);
  await expect(panel).toContainText(NOTE);
  await closeDetails(panel);
  const row = page
    .getByTestId("data-table")
    .locator("tr", { hasText: clientName })
    .first();
  await expect(row.getByTestId("row-note-mark")).toHaveAttribute(
    "title",
    NOTE,
  );

  // ── 3. the debt entry carries the note ─────────────────────────────────
  const charge = await chargeRow(day, clientId, t.id);
  expect(charge.amount_lbp).toBeCloseTo(50_000, 0);
  expect(charge.note ?? "").toMatch(new RegExp(` — ${NOTE}$`));

  // ── 4. edit → both change ──────────────────────────────────────────────
  const edit = await postJson<{ success: boolean }>(
    day,
    "/api/recharge/update-metadata",
    { id: t.source_id, note: EDITED },
  );
  expect(edit.success, JSON.stringify(edit)).toBeTruthy();
  const t2 = await findTxn(
    day,
    before,
    "telecom_recharge",
    (x) => x.id === t.id && x.details?.note === EDITED,
    "edited note on the transaction",
  );
  expect(t2.details?.note).toBe(EDITED);
  const charge2 = await chargeRow(day, clientId, t.id);
  expect(charge2.note ?? "").toMatch(new RegExp(` — ${EDITED}$`));
  expect(charge2.note ?? "").not.toContain(NOTE);

  await day.context.close();
});
