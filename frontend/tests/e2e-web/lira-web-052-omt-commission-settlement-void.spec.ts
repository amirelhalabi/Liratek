/**
 * lira-web-052 — commission at settlement for an OMT (system) SEND, over REST
 * (COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 4, "full e2e both transports for
 * the whole flow"). Desktop twin: lira-095-omt-commission-settlement-void.spec.ts.
 *
 * Why this file exists: bills (Katsh, RATE mode) already have a full
 * create → settle → void proof on both transports (lira-web-021 / lira-089).
 * The OMT/WHISH half of the redesign — a new-model (`commission_model = 1`)
 * SEND whose payable is GROSS and whose commission is entered at settlement
 * in LUMP mode — had none over REST: lira-158 (desktop) settles OMT through
 * the real UI but never voids, and lira-web-015 deliberately skipped
 * `/settle` altogether.
 *
 * Covered, IPC-identical envelope checks throughout (rule 19c):
 *  1. POST an OMT SEND (x = 373, f = 7, INTRA). The supplier ledger grows by
 *     the GROSS x + f = 380 — no commission netted at creation (D1). The
 *     row joins the unsettled queue.
 *  2. Settle it in LUMP mode with an entered commission of 1.37 —
 *     deliberately NOT the 0.70 auto-calculated estimate still sitting on
 *     the row — paying net 380 − 1.37 = 378.63 in CASH. The supplier balance
 *     returns to its pre-SEND baseline (TOP_UP +380, SETTLEMENT −378.63,
 *     SUPPLIER_PAYS_US −1.37), the Primary Cash Drawer (OMT_System) falls by
 *     exactly the net cash leg, the settlement transaction records LUMP /
 *     model 1 / 1.37, and Profits "Commission (at settlement)" rises by
 *     exactly 1.37 (walk-in, cash-paid: nothing defers it).
 *  3. Void the SUPPLIER_SETTLEMENT. Every effect returns: the supplier owes
 *     the gross 380 again, the drawer gets the net cash back, the row
 *     re-joins the unsettled queue, and the Profits commission delta is 0.
 *
 * Rule 15: the web DB accumulates across specs — every assertion is a DELTA
 * snapshotted right around its own action, and every row is matched by
 * IDENTITY (the SEND's own id, the settlement's own ledger id), never by
 * position or absolute totals. Amounts (373 / 7) are unique to this file.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

const PROFITS_PASSWORD = "1234";
const X = 373;
const FEE = 7;
const GROSS = X + FEE; // 380 — what a new-model SEND owes OMT (D1)
const ENTERED_COMMISSION = 1.37;
const NET_PAY = Math.round((GROSS - ENTERED_COMMISSION) * 100) / 100; // 378.63

type SupplierRow = { id: number; provider: string | null };
type BalanceRow = { supplier_id: number; total_usd: number };
type LedgerRow = {
  id: number;
  entry_type: string;
  amount_usd: number;
  is_refunded?: number;
};
type UnsettledRow = {
  id: number;
  settlement_id: number | null;
  commission_model?: number;
};
type RecentTxn = {
  id: number;
  source_table: string;
  source_id: number | null;
  metadata_json: string | null;
};

test("OMT SEND owes the gross amount, settles with a LUMP commission over REST, and voiding the settlement nets every ledger, drawer and profit figure back to 0", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  // ── Profits gate (same pattern as lira-web-036) ─────────────────────────
  const status = await (
    await page.request.get(`${BACKEND_URL}/api/profits/password-status`, {
      headers: auth,
    })
  ).json();
  expect(status.success, JSON.stringify(status)).toBeTruthy();
  if (!status.isSet) {
    const setRes = await (
      await page.request.put(`${BACKEND_URL}/api/profits/password`, {
        headers: auth,
        data: { password: PROFITS_PASSWORD },
      })
    ).json();
    expect(setRes.success, JSON.stringify(setRes)).toBeTruthy();
  }
  const unlockRes = await (
    await page.request.post(`${BACKEND_URL}/api/profits/unlock`, {
      headers: auth,
      data: { password: PROFITS_PASSWORD },
    })
  ).json();
  expect(unlockRes.success, JSON.stringify(unlockRes)).toBeTruthy();

  // ── Seeded OMT supplier (identified by provider, never list position) ───
  const suppliers = await (
    await page.request.get(`${BACKEND_URL}/api/suppliers`, { headers: auth })
  ).json();
  expect(suppliers.success, JSON.stringify(suppliers)).toBeTruthy();
  const omt = (suppliers.suppliers as SupplierRow[]).find(
    (s) => s.provider === "OMT",
  );
  expect(omt, "OMT supplier not found").toBeTruthy();
  const omtId = omt!.id;

  const owedUsd = async (): Promise<number> => {
    const r = await (
      await page.request.get(`${BACKEND_URL}/api/suppliers/balances`, {
        headers: auth,
      })
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return (
      (r.balances as BalanceRow[]).find((b) => b.supplier_id === omtId)
        ?.total_usd ?? 0
    );
  };

  const pcdUsd = async (): Promise<number> => {
    const r = await (
      await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, {
        headers: auth,
      })
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.balances.omtDrawer.usd as number;
  };

  const commissionAtSettlementUsd = async (): Promise<number> => {
    // A wide window, not "today": every assertion here is a delta, and a
    // today-only window would depend on the server's clock agreeing with the
    // allocation's stamped day (rule 27 — wrong for 3 hours a night across
    // UTC/Beirut). Same window as the desktop twin.
    const r = await (
      await page.request.get(
        `${BACKEND_URL}/api/profits/summary?from=2000-01-01&to=2100-01-01`,
        { headers: auth },
      )
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return (
      (r.data?.financial_services?.commission_at_settlement_usd as number) ?? 0
    );
  };

  const unsettledOmt = async (): Promise<UnsettledRow[]> => {
    const r = await (
      await page.request.get(
        `${BACKEND_URL}/api/suppliers/unsettled?provider=OMT`,
        { headers: auth },
      )
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.transactions ?? [];
  };

  const ledger = async (): Promise<LedgerRow[]> => {
    const r = await (
      await page.request.get(
        `${BACKEND_URL}/api/suppliers/${omtId}/ledger?limit=500`,
        { headers: auth },
      )
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.ledger ?? [];
  };

  // ── 1. OMT SEND — the payable is GROSS (D1) ─────────────────────────────
  const owedBeforeSend = await owedUsd();
  const sent = await (
    await page.request.post(`${BACKEND_URL}/api/services/transactions`, {
      headers: auth,
      data: {
        provider: "OMT",
        serviceType: "SEND",
        amount: X,
        currency: "USD",
        omtServiceType: "INTRA",
        omtFee: FEE,
        payments: [{ method: "CASH", currencyCode: "USD", amount: GROSS }],
      },
    })
  ).json();
  expect(sent.success, JSON.stringify(sent)).toBeTruthy();
  const sendId = sent.id as number;
  expect(sendId).toBeTruthy();

  const owedAfterSend = await owedUsd();
  expect(owedAfterSend - owedBeforeSend).toBeCloseTo(GROSS, 2);

  const queued = (await unsettledOmt()).find((r) => r.id === sendId);
  expect(queued, "SEND did not join the unsettled queue").toBeTruthy();
  expect(queued!.settlement_id).toBeNull();

  // ── 2. Settle in LUMP mode with an entered commission ───────────────────
  const pcdBeforeSettle = await pcdUsd();
  const commissionBeforeSettle = await commissionAtSettlementUsd();

  const settleRes = await (
    await page.request.post(`${BACKEND_URL}/api/suppliers/${omtId}/settle`, {
      headers: auth,
      data: {
        financial_service_ids: [sendId],
        amount_usd: NET_PAY,
        amount_lbp: 0,
        commission_usd: ENTERED_COMMISSION,
        commission_lbp: 0,
        entry_mode: "LUMP",
        note: "L-web-052 e2e LUMP settlement",
        payments: [{ method: "CASH", currency_code: "USD", amount: NET_PAY }],
      },
    })
  ).json();
  expect(settleRes.success, JSON.stringify(settleRes)).toBeTruthy();
  const settlementLedgerId = settleRes.id as number;
  expect(settlementLedgerId).toBeTruthy();

  // Supplier: +380 at SEND, −378.63 paid, −1.37 commission credit → back to
  // the pre-SEND baseline.
  expect((await owedUsd()) - owedBeforeSend).toBeCloseTo(0, 2);
  const ledgerAfterSettle = await ledger();
  const settlementRow = ledgerAfterSettle.find(
    (l) => l.id === settlementLedgerId,
  );
  expect(settlementRow?.entry_type).toBe("SETTLEMENT");
  expect(Math.abs(settlementRow!.amount_usd)).toBeCloseTo(NET_PAY, 2);

  // The net cash leg left the PCD (primary system → OMT_System).
  expect((await pcdUsd()) - pcdBeforeSettle).toBeCloseTo(-NET_PAY, 2);

  // Profits recognises the ENTERED commission (not the 0.70 estimate) on the
  // settlement day.
  expect(
    (await commissionAtSettlementUsd()) - commissionBeforeSettle,
  ).toBeCloseTo(ENTERED_COMMISSION, 2);

  // The row left the unsettled queue.
  expect((await unsettledOmt()).find((r) => r.id === sendId)).toBeUndefined();

  // The settlement transaction records the model and entry mode.
  const recent = await (
    await page.request.get(
      `${BACKEND_URL}/api/transactions/recent?type=SUPPLIER_SETTLEMENT&limit=100`,
      { headers: auth },
    )
  ).json();
  expect(recent.success, JSON.stringify(recent)).toBeTruthy();
  const settlementTxn = (recent.transactions as RecentTxn[]).find(
    (t) =>
      t.source_table === "supplier_ledger" &&
      t.source_id === settlementLedgerId,
  );
  expect(
    settlementTxn,
    "SUPPLIER_SETTLEMENT transaction not found",
  ).toBeTruthy();
  const meta = JSON.parse(settlementTxn!.metadata_json ?? "{}") as {
    commission_model?: number;
    entry_mode?: string;
    commission_usd?: number;
  };
  expect(meta.commission_model).toBe(1);
  expect(meta.entry_mode).toBe("LUMP");
  expect(meta.commission_usd).toBeCloseTo(ENTERED_COMMISSION, 2);

  // ── 3. Void the settlement — every effect returns (rule 20) ─────────────
  const voidRes = await (
    await page.request.post(
      `${BACKEND_URL}/api/transactions/${settlementTxn!.id}/void`,
      { headers: auth },
    )
  ).json();
  expect(voidRes.success, JSON.stringify(voidRes)).toBeTruthy();

  // The supplier is owed the gross amount again — exactly as after the SEND.
  expect((await owedUsd()) - owedBeforeSend).toBeCloseTo(GROSS, 2);
  expect(
    (await ledger()).find((l) => l.id === settlementLedgerId)?.is_refunded,
  ).toBe(1);

  // The drawer got the net cash back.
  expect((await pcdUsd()) - pcdBeforeSettle).toBeCloseTo(0, 2);

  // Profits: the settlement-day commission is gone again.
  expect(
    (await commissionAtSettlementUsd()) - commissionBeforeSettle,
  ).toBeCloseTo(0, 2);

  // The SEND is back in the unsettled queue, detached from the settlement.
  const requeued = (await unsettledOmt()).find((r) => r.id === sendId);
  expect(requeued, "SEND did not re-join the unsettled queue").toBeTruthy();
  expect(requeued!.settlement_id).toBeNull();
});
