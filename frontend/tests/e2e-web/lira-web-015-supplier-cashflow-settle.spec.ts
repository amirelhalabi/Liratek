/**
 * lira-web-015 — supplier cashflow (Pay / Receive), all over REST (CQ-9, the
 * web/REST parity wave for the Suppliers page — plan doc
 * COUNTERPARTY_CONSOLIDATION_PLAN.md "Extension (2026-07-18)").
 *
 * Guards POST /api/suppliers/:id/cashflow — the audit's headline finding was
 * that this channel had NO dual-mode wrapper at all (frontend/src/features/
 * suppliers/hooks/useSuppliers.ts called window.api.suppliers.recordCashflow
 * directly, so it threw `undefined is not a function` in the browser) and no
 * REST route existed to fall back to. This spec drives the SAME core path
 * (SupplierRepository.recordSupplierCashflow, funneled through
 * createTransaction() since CQ-7) that the desktop IPC channel uses.
 *
 * Covered, both directions, over one freshly-created supplier:
 *  1. PAY $42.50 CASH (shop pays the supplier down) →
 *     - supplier balance (what the shop owes) drops by exactly $42.50
 *     - the General drawer is debited by exactly $42.50 (cash OUT)
 *     - a PAYMENT supplier_ledger row is written, linked to a transaction
 *     - a SUPPLIER_PAYMENT transaction row exists with
 *       metadata.counterparty = { kind: 'supplier', id, flow: 'OUT', ... }
 *  2. RECEIVE $15 CASH (the supplier pays the shop back) →
 *     - supplier balance rises by exactly $15 back toward zero
 *     - the General drawer is credited by exactly $15 (cash IN)
 *     - a SUPPLIER_PAYS_US supplier_ledger row is written
 *     - its transaction row carries metadata.counterparty.flow = 'IN'
 *
 * Identity + delta asserts only (rule 15) — the e2e DB accumulates across
 * runs. The supplier is created fresh per run (unique name), so its balance
 * and ledger start at a known zero; the unified transaction row is located
 * by IDENTITY (source_table + source_id === the ledger entry id the cashflow
 * call returns), never by "newest row" or list position.
 *
 * DELIBERATELY SKIPPED: the settle-batch happy path
 * (POST /api/suppliers/:id/settle). Settling requires seeding real unsettled
 * `financial_services` rows tied to a supplier's `provider` column (via
 * /api/services/transactions) and then resolving them through
 * /api/suppliers/unsettled?provider=... — meaningfully heavier setup than
 * cashflow, and per the plan's own dead-code audit
 * (COUNTERPARTY_CONSOLIDATION_PLAN.md "Dead/orphaned code discovered"),
 * `settleTransactions` currently has exactly ONE caller in the whole app —
 * the orphaned, unimported `Settings/SupplierLedger.tsx` — which CQ-11/D5
 * deletes and rebuilds as a new batch-settlement UI inside the Suppliers
 * page itself. Proving the batch-settle happy path is better spent once that
 * UI (and its real seeding shape) exists; today it would test a code path no
 * shipped surface can reach.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test("supplier cashflow PAY and RECEIVE post ledger + drawer + a SUPPLIER_PAYMENT transaction with counterparty metadata — over REST", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  const ts = Date.now();
  const NAME = `L-web-015 Supplier ${ts}`;

  // Seed a fresh supplier — unique name, so its balance/ledger start at a
  // known zero regardless of what earlier runs left in the shared DB.
  const supplier = await (
    await page.request.post(`${BACKEND_URL}/api/suppliers`, {
      headers: auth,
      data: { name: NAME, phone: `Lweb015${ts}`.slice(0, 15) },
    })
  ).json();
  expect(supplier.success, JSON.stringify(supplier)).toBeTruthy();
  const supplierId = supplier.id as number;
  expect(supplierId).toBeTruthy();

  const balanceOf = async (): Promise<{ usd: number; lbp: number }> => {
    const r = await (
      await page.request.get(`${BACKEND_URL}/api/suppliers/balances`, {
        headers: auth,
      })
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    const row = (
      r.balances as Array<{
        supplier_id: number;
        total_usd: number;
        total_lbp: number;
      }>
    ).find((b) => b.supplier_id === supplierId);
    // A freshly created supplier still appears (LEFT JOIN) with zero totals.
    return { usd: row?.total_usd ?? 0, lbp: row?.total_lbp ?? 0 };
  };

  const ledgerOf = async (): Promise<
    Array<{
      id: number;
      entry_type: string;
      amount_usd: number;
      amount_lbp: number;
      transaction_id: number | null;
    }>
  > => {
    const r = await (
      await page.request.get(
        `${BACKEND_URL}/api/suppliers/${supplierId}/ledger`,
        { headers: auth },
      )
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.ledger ?? [];
  };

  // General drawer: CASH maps to "General" (FALLBACK_DRAWER_MAP / the
  // payment_methods seed row) — same drawer lira-web-014 already asserts.
  const generalDrawerUsd = async (): Promise<number> => {
    const r = await (
      await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, {
        headers: auth,
      })
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.balances.generalDrawer.usd as number;
  };

  // Locate the unified transaction by IDENTITY (type + source_table +
  // source_id — the supplier_ledger row id the cashflow call returns), never
  // by "newest row"/list position (rule 15). `type=SUPPLIER_PAYMENT` narrows
  // the recent-transactions scan; this is a single-worker suite
  // (playwright.web.config.ts: fullyParallel:false, workers:1) so nothing
  // else can write a newer SUPPLIER_PAYMENT row between the POST above and
  // this GET.
  type Txn = {
    id: number;
    type: string;
    source_table: string;
    source_id: number;
    amount_usd: number;
    amount_lbp: number;
    metadata_json: string | null;
  };
  const findSupplierPaymentTxn = async (
    ledgerEntryId: number,
  ): Promise<Txn> => {
    const r = await (
      await page.request.get(
        `${BACKEND_URL}/api/transactions/recent?type=SUPPLIER_PAYMENT&limit=100`,
        { headers: auth },
      )
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    const txn = (r.transactions as Txn[]).find(
      (t) =>
        t.source_table === "supplier_ledger" && t.source_id === ledgerEntryId,
    );
    expect(
      txn,
      `SUPPLIER_PAYMENT transaction not found for ledger entry #${ledgerEntryId}`,
    ).toBeTruthy();
    return txn!;
  };

  const balBefore = await balanceOf();
  expect(balBefore).toEqual({ usd: 0, lbp: 0 });
  expect(await ledgerOf()).toHaveLength(0);
  const drawerBeforePay = await generalDrawerUsd();

  // --- Action 1: PAY $42.50 CASH — shop pays the supplier down. ---------
  const paid = await (
    await page.request.post(
      `${BACKEND_URL}/api/suppliers/${supplierId}/cashflow`,
      {
        headers: auth,
        data: {
          supplier_id: supplierId,
          direction: "PAY",
          payments: [{ method: "CASH", currency_code: "USD", amount: 42.5 }],
          note: "e2e web PAY",
        },
      },
    )
  ).json();
  expect(paid.success, JSON.stringify(paid)).toBeTruthy();
  const payLedgerId = paid.id as number;
  expect(payLedgerId).toBeTruthy();

  // Identity: what the shop owes the supplier drops by exactly $42.50.
  const balAfterPay = await balanceOf();
  expect(balAfterPay.usd - balBefore.usd).toBeCloseTo(-42.5, 2);

  // The General drawer is debited by exactly $42.50 (cash paid OUT).
  const drawerAfterPay = await generalDrawerUsd();
  expect(drawerAfterPay - drawerBeforePay).toBeCloseTo(-42.5, 2);

  // A single PAYMENT ledger row, linked to its transaction.
  const ledgerAfterPay = await ledgerOf();
  expect(ledgerAfterPay).toHaveLength(1);
  expect(ledgerAfterPay[0].entry_type).toBe("PAYMENT");
  expect(ledgerAfterPay[0].amount_usd).toBeCloseTo(-42.5, 2);
  expect(ledgerAfterPay[0].transaction_id).toBeTruthy();

  // The transaction contract (CQ-8): a SUPPLIER_PAYMENT row exists, carrying
  // the counterparty envelope with kind 'supplier' and flow 'OUT' (shop pays
  // out). Amount on the transaction is the positive magnitude, not the
  // signed ledger delta.
  const payTxn = await findSupplierPaymentTxn(payLedgerId);
  expect(payTxn.amount_usd).toBeCloseTo(42.5, 2);
  const payMeta = JSON.parse(payTxn.metadata_json ?? "{}") as {
    direction?: string;
    counterparty?: { kind?: string; id?: number; flow?: string };
  };
  expect(payMeta.direction).toBe("PAY");
  expect(payMeta.counterparty?.kind).toBe("supplier");
  expect(payMeta.counterparty?.id).toBe(supplierId);
  expect(payMeta.counterparty?.flow).toBe("OUT");

  // --- Action 2: RECEIVE $15 CASH — the supplier pays the shop back. -----
  const received = await (
    await page.request.post(
      `${BACKEND_URL}/api/suppliers/${supplierId}/cashflow`,
      {
        headers: auth,
        data: {
          supplier_id: supplierId,
          direction: "RECEIVE",
          payments: [{ method: "CASH", currency_code: "USD", amount: 15 }],
          note: "e2e web RECEIVE",
        },
      },
    )
  ).json();
  expect(received.success, JSON.stringify(received)).toBeTruthy();
  const receiveLedgerId = received.id as number;
  expect(receiveLedgerId).toBeTruthy();
  expect(receiveLedgerId).not.toBe(payLedgerId);

  // Balance moves back toward zero by exactly $15 (net -$27.50 from start).
  const balAfterReceive = await balanceOf();
  expect(balAfterReceive.usd - balAfterPay.usd).toBeCloseTo(15, 2);
  expect(balAfterReceive.usd - balBefore.usd).toBeCloseTo(-27.5, 2);

  // The General drawer is credited by exactly $15 (cash paid IN).
  const drawerAfterReceive = await generalDrawerUsd();
  expect(drawerAfterReceive - drawerAfterPay).toBeCloseTo(15, 2);

  const ledgerAfterReceive = await ledgerOf();
  expect(ledgerAfterReceive).toHaveLength(2);
  const receiveEntry = ledgerAfterReceive.find(
    (l) => l.id !== ledgerAfterPay[0].id,
  );
  expect(receiveEntry?.entry_type).toBe("SUPPLIER_PAYS_US");
  expect(receiveEntry?.amount_usd).toBeCloseTo(15, 2);

  // The RECEIVE transaction's counterparty flow is the mirror image: 'IN'
  // (the supplier is the one paying, into the shop).
  const receiveTxn = await findSupplierPaymentTxn(receiveLedgerId);
  expect(receiveTxn.amount_usd).toBeCloseTo(15, 2);
  const receiveMeta = JSON.parse(receiveTxn.metadata_json ?? "{}") as {
    direction?: string;
    counterparty?: { kind?: string; id?: number; flow?: string };
  };
  expect(receiveMeta.direction).toBe("RECEIVE");
  expect(receiveMeta.counterparty?.kind).toBe("supplier");
  expect(receiveMeta.counterparty?.id).toBe(supplierId);
  expect(receiveMeta.counterparty?.flow).toBe("IN");
});
