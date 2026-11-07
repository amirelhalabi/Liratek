/**
 * lira-web-080 — Partners page: a partner's ledger opens in two windows,
 * "Transactions (N)" and "Payments (N)", like the Suppliers page (LIRA-340).
 *
 * Over REST: a fresh partner (unique name, rule 15 identity) gets a For
 * Partner OMT send and a manual adjustment, then a Cash + Whish (Split)
 * settlement and a write-off. The page must list the send under
 * Transactions and the adjustment, settlement and write-off under Payments,
 * with the counts on the buttons, and the two groups must add up to the
 * whole ledger (SC-001). Also saves the What's new screenshot (rule 30).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/partner-ledger.png",
);
// Owner 2026-11-07 — the Transactions window with its Status column.
const TXNS_SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/partner-txns-status.png",
);
// Owner 2026-11-07 (CornerTag) — the History list on the partner page.
const HISTORY_SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/partner-history.png",
);

test("partner Transactions / Payments windows over REST", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };
  const post = async (p: string, data: unknown) => {
    const body = await (
      await page.request.post(`${BACKEND_URL}${p}`, { headers: auth, data })
    ).json();
    expect(body.success, JSON.stringify(body)).toBeTruthy();
    return body;
  };
  const ledger = async (group?: string) => {
    const qs = group ? `?group=${group}` : "";
    const body = await (
      await page.request.get(
        `${BACKEND_URL}/api/partners/${partnerId}/ledger${qs}`,
        { headers: auth },
      )
    ).json();
    expect(body.success, JSON.stringify(body)).toBeTruthy();
    return body.statement.entries as Array<{
      transaction_type: string;
      settlement_method: string | null;
      notes: string | null;
      settle_status?: string | null;
      balance_after?: number | null;
    }>;
  };

  const name = `Karim Mobile ${String(Date.now()).slice(-5)}`;
  const created = await post("/api/partners", { name, phone: "03555777" });
  const partnerId = created.data.id as number;

  await post("/api/partners/transactions", {
    partnerId,
    transactionType: "FOR_OMT_SEND",
    amount: 120,
    currency: "USD",
    direction: "DEBIT",
    notes: "OMT send for the partner",
  });
  await post("/api/partners/transactions", {
    partnerId,
    transactionType: "ADJUSTMENT",
    amount: 30,
    currency: "USD",
    direction: "DEBIT",
    notes: "Old paper balance",
  });
  await post("/api/partners/settle", {
    partnerId,
    amount: 100,
    currency: "USD",
    settlementMethod: "CASH",
    notes: "Paid at the counter",
    payments: [
      { method: "CASH", currency_code: "USD", amount: 70 },
      { method: "WHISH", currency_code: "USD", amount: 30 },
    ],
  });
  await post("/api/partners/write-off", {
    partnerId,
    amount_usd: 15,
    reason: "Late delivery",
  });

  // The REST read splits by group, and the groups add up (SC-001).
  const all = await ledger();
  const txns = await ledger("transactions");
  const pays = await ledger("payments");
  expect(txns.map((e) => e.transaction_type)).toEqual(["FOR_OMT_SEND"]);
  // Owner 2026-11-07 — the settlement and write-off paid toward the $120
  // send, so it has a status over REST (from the settle units).
  expect(txns[0].settle_status).toMatch(/^(PAID|PARTIAL)$/);
  expect(pays.map((e) => e.transaction_type).sort()).toEqual([
    "ADJUSTMENT",
    "DISCOUNT",
    "SETTLEMENT",
  ]);
  expect(txns.length + pays.length).toBe(all.length);
  // History: balance after each row, oldest to newest:
  // +120 send, +30 adjustment, −100 settle, −15 write-off.
  expect(
    all
      .map((e) => e.balance_after)
      .reverse()
      .map((b) => Math.round((b ?? NaN) * 100) / 100),
  ).toEqual([120, 150, 50, 35]);
  expect(
    pays.find((e) => e.transaction_type === "SETTLEMENT")?.settlement_method,
  ).toBe("SPLIT");

  // The page: two buttons with the counts, and the History list (every
  // row, with the balance after each) as the only inline table.
  await page.goto("/#/partners");
  await page.getByText(name).first().click();
  const openTxns = page.getByTestId("partner-open-transactions");
  const openPays = page.getByTestId("partner-open-payments");
  await expect(openTxns).toHaveText(/Transactions \(1\)/, { timeout: 15_000 });
  await expect(openPays).toHaveText(/Payments \(3\)/);
  const history = page.getByTestId("partner-history");
  await expect(history.locator("tbody tr")).toHaveCount(4);
  await expect(history.locator("thead")).toContainText("Balance");
  await expect(history.locator("tbody tr").first()).toContainText("$35.00");
  await expect(history).toContainText("OMT send for the partner");
  await expect(history).toContainText("Paid at the counter");
  await expect(page.locator("table")).toHaveCount(1);
  await page.screenshot({ path: HISTORY_SCREENSHOT });

  await openTxns.click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`${name} — Transactions`);
  await expect(dialog).toContainText("OMT send for the partner");
  await expect(dialog).not.toContainText("Paid at the counter");
  await expect(dialog.locator("thead")).toContainText("Status");
  await expect(dialog.locator("tbody")).toContainText(/Paid|Partial ·/);
  await expect(
    dialog.getByRole("button", { name: "This month" }),
  ).toBeVisible();
  await page.screenshot({ path: TXNS_SCREENSHOT });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await openPays.click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`${name} — Payments`);
  await expect(dialog).toContainText("Paid at the counter");
  await expect(dialog).toContainText("via SPLIT");
  await expect(dialog).toContainText("Old paper balance");
  await expect(dialog.locator("tbody tr")).toHaveCount(3);
  await expect(dialog).not.toContainText("OMT send for the partner");
  await page.screenshot({ path: SCREENSHOT });

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
