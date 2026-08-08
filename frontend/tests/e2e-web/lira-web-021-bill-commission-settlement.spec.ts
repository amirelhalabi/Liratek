/**
 * lira-web-021 — commission-at-settlement for iPick/Katsh BILLs, over REST
 * (docs/plans/todo_plans/COMMISSION_AT_SETTLEMENT_PLAN.md, Phase 0+1).
 *
 * REST twin of lira-089-bill-commission-settlement.spec.ts (desktop). Also
 * closes the plan's §1.7 rule-19 gap: `validators/financial.ts`'s
 * `serviceType` enum was `['SEND','RECEIVE']` — REST hard-rejected every
 * BILL, so bills were desktop-IPC-only on the write path. This spec's first
 * request (POST /api/services/transactions with `serviceType: 'BILL'`)
 * proves that gap is closed.
 *
 * Covered, over REST only, IPC-identical envelope checks throughout
 * (`{ success, ... }`, HTTP 200 even on business-rule failure — rule 19c):
 *  1. POST a Katsh BILL — `serviceType: 'BILL'` — and confirm NO commission
 *     credit posts at creation (a fresh BILL row is born `commission_model =
 *     1` — the repository's insert path stamps this specifically for
 *     `service_type === "BILL"`; OMT/WHISH stay `commission_model = 0` until
 *     Phase 2 ships).
 *  2. GET /api/suppliers/unsettled-summary shows the bill in Katsh's
 *     `bill_count` (+1 delta) — the Settle-tab-feeding projection.
 *  3. POST /api/suppliers/:id/settle in RATE mode (rate × unit_count) —
 *     books a `SUPPLIER_PAYS_US` credit of exactly that amount, linked to
 *     this settlement via its ledger-entry id (never by time proximity).
 *  4. POST /api/transactions/:id/void on the SUPPLIER_SETTLEMENT row — the
 *     whole create → settle → void cycle nets to 0 (rule 20): both ledger
 *     rows this settlement wrote soft-void, the supplier's LBP balance
 *     returns to its pre-bill baseline, and the bill re-joins the unsettled
 *     queue.
 *
 * `settlement_commission_allocations`/`supplier_settlements` have no REST
 * projection either (mirrors the desktop spec's finding) — the SUPPLIER_
 * SETTLEMENT transaction's `metadata_json` (commission_model/entry_mode/
 * commission_lbp, stamped from the SAME data `_bookCommissionAtSettlement`
 * persists onto `supplier_settlements`) is the closest available proof,
 * asserted alongside the ledger credit.
 *
 * Rule 15: the e2e DB accumulates across runs — every assertion is a DELTA
 * around this run's own action, and every row is matched by IDENTITY (a
 * bill amount unique to this file, this settlement's own ledger-entry id
 * embedded in the credit's note), never by absolute totals or "newest row".
 * Single-worker suite (playwright.web.config.ts: fullyParallel:false,
 * workers:1), so nothing else can write a colliding row between requests.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

// Unique to this spec file — not reused by any other Katsh-bill spec.
const BILL_AMOUNT_LBP = 493_000;
const RATE_LBP = 8_000;
const UNIT_COUNT = 1;
const COMMISSION_LBP = RATE_LBP * UNIT_COUNT;

type SupplierRow = { id: number; provider: string | null };
type BalanceRow = { supplier_id: number; total_usd: number; total_lbp: number };
type LedgerRow = {
  id: number;
  entry_type: string;
  amount_usd: number;
  amount_lbp: number;
  note: string | null;
  is_refunded?: number;
};
type UnsettledSummaryRow = { provider: string; bill_count: number };
type SupplierTxnRow = {
  id: number;
  provider: string;
  service_type: string;
  amount: number;
  currency: string;
  settlement_id: number | null;
};
type RecentTxn = {
  id: number;
  type: string;
  source_table: string;
  source_id: number | null;
  metadata_json: string | null;
};

test("Katsh BILL books no commission at creation, settles in RATE mode over REST, and voiding nets everything to 0", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  // ── Resolve the seeded Katsh supplier row ──────────────────────────────
  const suppliersRes = await (
    await page.request.get(`${BACKEND_URL}/api/suppliers?search=Katsh`, {
      headers: auth,
    })
  ).json();
  expect(suppliersRes.success, JSON.stringify(suppliersRes)).toBeTruthy();
  const katsh = (suppliersRes.suppliers as SupplierRow[]).find(
    (s) => s.provider === "Katsh",
  );
  expect(katsh, "Katsh supplier not found").toBeTruthy();
  const katshId = katsh!.id;

  const balanceOf = async (): Promise<number> => {
    const r = await (
      await page.request.get(`${BACKEND_URL}/api/suppliers/balances`, {
        headers: auth,
      })
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return (
      (r.balances as BalanceRow[]).find((b) => b.supplier_id === katshId)
        ?.total_lbp ?? 0
    );
  };

  const ledgerOf = async (): Promise<LedgerRow[]> => {
    const r = await (
      await page.request.get(
        `${BACKEND_URL}/api/suppliers/${katshId}/ledger?limit=500`,
        { headers: auth },
      )
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.ledger ?? [];
  };

  const billCountOf = async (): Promise<number> => {
    const r = await (
      await page.request.get(`${BACKEND_URL}/api/suppliers/unsettled-summary`, {
        headers: auth,
      })
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return (
      (r.summary as UnsettledSummaryRow[]).find((s) => s.provider === "Katsh")
        ?.bill_count ?? 0
    );
  };

  const unsettledKatsh = async (): Promise<SupplierTxnRow[]> => {
    const r = await (
      await page.request.get(
        `${BACKEND_URL}/api/suppliers/unsettled?provider=Katsh`,
        { headers: auth },
      )
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.transactions ?? [];
  };

  const balBefore = await balanceOf();
  const legacyCreditsBefore = (await ledgerOf()).filter(
    (l) =>
      l.entry_type === "SUPPLIER_PAYS_US" &&
      (l.note ?? "").includes("BILL commission from Katsh"),
  ).length;
  const billCountBefore = await billCountOf();

  // ── 1. POST a Katsh BILL over REST — the rule-19 gap fix ────────────────
  const created = await (
    await page.request.post(`${BACKEND_URL}/api/services/transactions`, {
      headers: auth,
      data: {
        provider: "Katsh",
        serviceType: "BILL",
        amount: BILL_AMOUNT_LBP,
        currency: "LBP",
        cost: BILL_AMOUNT_LBP,
        price: BILL_AMOUNT_LBP,
        commission: 0,
        paidByMethod: "CASH",
      },
    })
  ).json();
  expect(created.success, JSON.stringify(created)).toBeTruthy();
  const billId = created.id as number;
  expect(billId).toBeTruthy();

  // ── 2. NO commission credit posted at creation ───────────────────────────
  expect((await balanceOf()) - balBefore).toBe(0);
  const legacyCreditsAfterCreate = (await ledgerOf()).filter(
    (l) =>
      l.entry_type === "SUPPLIER_PAYS_US" &&
      (l.note ?? "").includes("BILL commission from Katsh"),
  ).length;
  expect(legacyCreditsAfterCreate - legacyCreditsBefore).toBe(0);

  // ── 3. The bill joined the unsettled queue (Settle-tab projection) ──────
  expect((await billCountOf()) - billCountBefore).toBe(1);
  const unsettledBefore = await unsettledKatsh();
  const billRow = unsettledBefore.find(
    (r) => r.service_type === "BILL" && r.amount === BILL_AMOUNT_LBP,
  );
  expect(billRow, "unsettled BILL row not found").toBeTruthy();
  expect(billRow!.id).toBe(billId);
  expect(billRow!.settlement_id).toBeNull();

  // ── 4. Settle in RATE mode (rate × unit_count) — $0/0 LBP net (the
  // bill's principal already reached the supplier via the provider
  // drawer's cost leg; only the commission moves here). ────────────────────
  const settleRes = await (
    await page.request.post(`${BACKEND_URL}/api/suppliers/${katshId}/settle`, {
      headers: auth,
      data: {
        financial_service_ids: [billId],
        amount_usd: 0,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: COMMISSION_LBP,
        entry_mode: "RATE",
        commission_rate: RATE_LBP,
        commission_unit_count: UNIT_COUNT,
        note: "L-web-021 e2e RATE settlement",
      },
    })
  ).json();
  expect(settleRes.success, JSON.stringify(settleRes)).toBeTruthy();
  const settlementLedgerId = settleRes.id as number;
  expect(settlementLedgerId).toBeTruthy();

  // Commission credit, linked to THIS settlement via its note.
  const ledgerAfterSettle = await ledgerOf();
  const creditRow = ledgerAfterSettle.find(
    (l) =>
      l.entry_type === "SUPPLIER_PAYS_US" &&
      (l.note ?? "").includes(
        `commission credit from settlement #${settlementLedgerId}`,
      ),
  );
  expect(creditRow, "commission credit ledger row not found").toBeTruthy();
  expect(creditRow!.amount_lbp).toBe(-COMMISSION_LBP);
  expect(creditRow!.amount_usd).toBe(0);
  expect(creditRow!.is_refunded ?? 0).toBe(0);

  // Allocation proof: the SUPPLIER_SETTLEMENT transaction's metadata mirrors
  // the same data persisted onto supplier_settlements (no REST projection of
  // that table exists — see file doc comment).
  const findSettlementTxn = async (): Promise<RecentTxn> => {
    const r = await (
      await page.request.get(
        `${BACKEND_URL}/api/transactions/recent?type=SUPPLIER_SETTLEMENT&limit=100`,
        { headers: auth },
      )
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    const txn = (r.transactions as RecentTxn[]).find(
      (t) =>
        t.source_table === "supplier_ledger" &&
        t.source_id === settlementLedgerId,
    );
    expect(txn, "SUPPLIER_SETTLEMENT transaction not found").toBeTruthy();
    return txn!;
  };
  const settlementTxn = await findSettlementTxn();
  const meta = JSON.parse(settlementTxn.metadata_json ?? "{}") as {
    commission_model?: number;
    entry_mode?: string;
    commission_lbp?: number;
  };
  expect(meta.commission_model).toBe(1);
  expect(meta.entry_mode).toBe("RATE");
  expect(meta.commission_lbp).toBe(COMMISSION_LBP);

  // The bill is no longer in the unsettled queue.
  const unsettledAfterSettle = await unsettledKatsh();
  expect(unsettledAfterSettle.find((r) => r.id === billId)).toBeUndefined();

  // ── 5. Void the settlement — everything must net to 0 (rule 20) ─────────
  const voidRes = await (
    await page.request.post(
      `${BACKEND_URL}/api/transactions/${settlementTxn.id}/void`,
      { headers: auth },
    )
  ).json();
  expect(voidRes.success, JSON.stringify(voidRes)).toBeTruthy();

  const ledgerAfterVoid = await ledgerOf();
  expect(ledgerAfterVoid.find((l) => l.id === creditRow!.id)?.is_refunded).toBe(
    1,
  );
  expect(
    ledgerAfterVoid.find((l) => l.id === settlementLedgerId)?.is_refunded,
  ).toBe(1);

  // Supplier LBP balance is back to the pre-bill baseline.
  expect((await balanceOf()) - balBefore).toBe(0);

  // The bill re-joins the unsettled queue.
  const unsettledAfterVoid = await unsettledKatsh();
  const billAfterVoid = unsettledAfterVoid.find((r) => r.id === billId);
  expect(
    billAfterVoid,
    "bill did not re-join the unsettled queue",
  ).toBeTruthy();
  expect(billAfterVoid!.settlement_id).toBeNull();
  expect((await billCountOf()) - billCountBefore).toBe(1);
});
