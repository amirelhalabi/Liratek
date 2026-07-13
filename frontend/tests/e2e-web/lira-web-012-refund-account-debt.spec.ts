/**
 * lira-web-012 — refunding an account-charged transaction reverses the debt
 * (owner-reported 2026-07-12: an MTC recharge for 600,000 LBP charged to a
 * customer account, refunded from the Transactions table, left the client
 * still owing 600,000 LBP — the 'Recharge Debt' ledger row survived).
 *
 * Guards POST /api/transactions/:id/refund → TransactionRepository
 * refundTransaction → _cancelDebt over MODULE_DEBT_TRANSACTION_TYPES in BOTH
 * currencies. Asserted as a DELTA on the client's per-currency balance
 * (rule 15); the transaction is located by identity (type + source_id),
 * never by row position. Same core path the desktop IPC refund uses.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test("refund of a CUSTOMER_ACCOUNT recharge cancels the LBP debt over REST", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  const client = await (
    await page.request.post(`${BACKEND_URL}/api/clients`, {
      headers: auth,
      data: { full_name: "Refund Debt Web Spec", phone_number: "03888112" },
    })
  ).json();
  const clientId = (client.data?.id ?? client.id) as number;
  expect(clientId).toBeTruthy();

  const balOf = async (): Promise<{ usd: number; lbp: number }> => {
    const r = await (
      await page.request.get(
        `${BACKEND_URL}/api/debts/clients/${clientId}/balance`,
        { headers: auth },
      )
    ).json();
    expect(r.success).toBeTruthy();
    return {
      usd: r.data.balance_usd as number,
      lbp: r.data.balance_lbp as number,
    };
  };
  const before = await balOf();

  // Stock so the transfer has credits to consume.
  await page.request.post(`${BACKEND_URL}/api/recharge/top-up`, {
    headers: auth,
    data: { provider: "MTC", amount: 20 },
  });

  // The reported scenario: MTC credits, 600,000 LBP, charged to the account.
  const recharge = await (
    await page.request.post(`${BACKEND_URL}/api/recharge/process`, {
      headers: auth,
      data: {
        provider: "MTC",
        type: "CREDIT_TRANSFER",
        amount: 6,
        cost: 486_000,
        price: 600_000,
        currency: "LBP",
        phoneNumber: "03123456",
        paid_by_method: "CUSTOMER_ACCOUNT",
        clientId,
      },
    })
  ).json();
  expect(recharge.success, JSON.stringify(recharge)).toBeTruthy();
  const rechargeId = recharge.id as number;

  // On-account charge → debt UP by exactly 600,000 LBP, USD untouched.
  const charged = await balOf();
  expect(charged.lbp - before.lbp).toBeCloseTo(600_000, 2);
  expect(charged.usd - before.usd).toBeCloseTo(0, 2);

  // Locate the unified transaction by IDENTITY (type + source_id).
  const txns = await (
    await page.request.get(
      `${BACKEND_URL}/api/transactions/client/${clientId}?limit=50`,
      { headers: auth },
    )
  ).json();
  expect(txns.success).toBeTruthy();
  const txn = (
    txns.transactions as Array<{
      id: number;
      type: string;
      source_table: string;
      source_id: number;
    }>
  ).find(
    (t) =>
      t.type === "RECHARGE" &&
      t.source_table === "recharges" &&
      t.source_id === rechargeId,
  );
  expect(txn, "RECHARGE transaction not found for the recharge").toBeTruthy();

  // Refund it from the transactions surface — the reported action.
  const refunded = await (
    await page.request.post(
      `${BACKEND_URL}/api/transactions/${txn!.id}/refund`,
      { headers: auth },
    )
  ).json();
  expect(refunded.success, JSON.stringify(refunded)).toBeTruthy();

  // The debt is cancelled: balance returns to its pre-recharge value in BOTH
  // currencies (pre-fix: still +600,000 LBP).
  const after = await balOf();
  expect(after.lbp - before.lbp).toBeCloseTo(0, 2);
  expect(after.usd - before.usd).toBeCloseTo(0, 2);
});
