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
 *     CONFIRMED DESIGN (341ae2ef, reverting aa0d5623/23897d6e's
 *     `SUPPLIER_PAYS_US` credit attempt): a bills-only settlement's
 *     commission is DISPLAY-ONLY. It funds the provider drawer directly
 *     (`_bookBillsCommissionDrawerTopUp`) and books NO supplier-ledger
 *     credit row — there is no debt for a commission credit to net against,
 *     so the ledger balance stays byte-identical. The commission is instead
 *     surfaced by two read-side LEFT JOINs: the SETTLEMENT ledger row's own
 *     `settlement_commission_usd`/`_lbp` (`getSupplierLedger`, joining
 *     `supplier_settlements`) and the settled BILL's own
 *     `settled_commission_usd`/`_lbp` (`getAllByProvider`, joining
 *     `settlement_commission_allocations`).
 *  4. POST /api/transactions/:id/void on the SUPPLIER_SETTLEMENT row — the
 *     whole create → settle → void cycle nets to 0: the SETTLEMENT ledger
 *     row (the only ledger row this design ever writes) soft-voids, the
 *     supplier's LBP balance stays at its pre-bill baseline throughout (it
 *     never moved — a bills-only SETTLEMENT row is contractually 0/0), the
 *     bill re-joins the unsettled queue, and the settlement's derived
 *     display records (`supplier_settlements`/
 *     `settlement_commission_allocations`) are hard-deleted
 *     (`_reverseCommissionAtSettlementRecords` — neither table has a
 *     soft-void column), so the commission enrichment from step 3
 *     disappears too and can't leak into a future re-settlement.
 *
 * `settlement_commission_allocations`/`supplier_settlements` have no REST
 * projection of their own (mirrors the desktop spec's finding) — this spec
 * reads their effect through the two display JOINs above plus the
 * SUPPLIER_SETTLEMENT transaction's `metadata_json` (commission_model/
 * entry_mode/commission_lbp, stamped from the SAME data
 * `_bookCommissionAtSettlement` persists onto `supplier_settlements`).
 *
 * Rule 15: the e2e DB accumulates across runs — every assertion is a DELTA
 * around this run's own action, and every row is matched by IDENTITY (a
 * bill amount unique to this file, this settlement's own ledger-entry id, or
 * the bill's own id), never by absolute totals or "newest row". Single-
 * worker suite (playwright.web.config.ts: fullyParallel:false, workers:1),
 * so nothing else can write a colliding row between requests.
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
  /** Display-only LEFT JOIN enrichment (SupplierRepository.getSupplierLedger,
   *  341ae2ef) — the batch commission collected at a bills-only settlement,
   *  present only on that settlement's own SETTLEMENT row. Undefined when
   *  the join isn't applied; null once `_reverseCommissionAtSettlementRecords`
   *  deletes the underlying `supplier_settlements` row on void. */
  settlement_commission_usd?: number | null;
  /** @see settlement_commission_usd */
  settlement_commission_lbp?: number | null;
};
type UnsettledSummaryRow = { provider: string; bill_count: number };
type SupplierTxnRow = {
  id: number;
  provider: string;
  service_type: string;
  amount: number;
  currency: string;
  settlement_id: number | null;
  /** Display-only LEFT JOIN enrichment (FinancialServiceRepository
   *  .getAllByProvider, 341ae2ef) — this row's per-currency share of the
   *  commission entered at settlement time (settlement_commission_allocations),
   *  keyed on BOTH this row's id and its CURRENT settlement_id. Undefined on
   *  the /unsettled endpoint (no join there); null once voided (the
   *  allocation row is hard-deleted and settlement_id resets to NULL). */
  settled_commission_usd?: number | null;
  /** @see settled_commission_usd */
  settled_commission_lbp?: number | null;
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

  // Transactions-tab equivalent (FinancialServiceRepository.getAllByProvider)
  // — the ONLY REST read that carries the settled-commission display JOIN.
  // limit=500: this provider accumulates rows across every past e2e run
  // (rule 15), so the default limit=200 risks pushing this run's own bill
  // off the page before it's ever settled.
  const allTransactionsKatsh = async (): Promise<SupplierTxnRow[]> => {
    const r = await (
      await page.request.get(
        `${BACKEND_URL}/api/suppliers/all-transactions?provider=Katsh&limit=500`,
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

  // ── CONFIRMED DESIGN (341ae2ef): NO commission-credit ledger row ────────
  // aa0d5623 tried booking a SUPPLIER_PAYS_US credit here and was reverted
  // (23897d6e) — a bills-only settlement's commission funds the provider
  // drawer directly and is display-only (see file doc comment). Absence is
  // scoped by IDENTITY (this exact settlement's would-be note), not by a
  // whole-ledger count, so an unrelated row elsewhere can never make this
  // assertion a false pass.
  const ledgerAfterSettle = await ledgerOf();
  const legacyCommissionCreditNote = `commission credit from settlement #${settlementLedgerId}`;
  const commissionCreditRow = ledgerAfterSettle.find(
    (l) =>
      l.entry_type === "SUPPLIER_PAYS_US" &&
      (l.note ?? "").includes(legacyCommissionCreditNote),
  );
  expect(
    commissionCreditRow,
    "a SUPPLIER_PAYS_US commission-credit row was booked, but the confirmed " +
      "design (341ae2ef) is display-only — no such ledger row should exist",
  ).toBeUndefined();

  // The commission IS surfaced — on the SETTLEMENT row itself, via
  // getSupplierLedger's display-only JOIN onto supplier_settlements. This
  // row's own amount_usd/amount_lbp stay contractually 0/0 (no cash owed for
  // a bills-only batch); the JOIN substitutes the batch commission into the
  // same cells the Payments table renders (Suppliers/index.tsx).
  const settlementRow = ledgerAfterSettle.find(
    (l) => l.id === settlementLedgerId,
  );
  expect(settlementRow, "SETTLEMENT ledger row not found").toBeTruthy();
  expect(settlementRow!.entry_type).toBe("SETTLEMENT");
  expect(settlementRow!.amount_usd).toBe(0);
  expect(settlementRow!.amount_lbp).toBe(0);
  expect(settlementRow!.settlement_commission_usd ?? 0).toBe(0);
  expect(settlementRow!.settlement_commission_lbp).toBe(COMMISSION_LBP);
  expect(settlementRow!.is_refunded ?? 0).toBe(0);

  // The commission is ALSO surfaced on the settled BILL's own Transactions-
  // tab row, via getAllByProvider's display-only JOIN onto
  // settlement_commission_allocations (this bill's per-currency share of the
  // batch commission — 100% of it, since it's the only row in the batch).
  const allTxnsAfterSettle = await allTransactionsKatsh();
  const billTxnAfterSettle = allTxnsAfterSettle.find((t) => t.id === billId);
  expect(
    billTxnAfterSettle,
    "settled BILL row not found in all-transactions",
  ).toBeTruthy();
  expect(billTxnAfterSettle!.settlement_id).toBe(settlementLedgerId);
  expect(billTxnAfterSettle!.settled_commission_usd ?? 0).toBe(0);
  expect(billTxnAfterSettle!.settled_commission_lbp).toBe(COMMISSION_LBP);

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

  // ── 5. Void the settlement — everything must net to 0 ───────────────────
  // Under the display-only design there is only ONE ledger row to reverse
  // (the SETTLEMENT row itself) — no second SUPPLIER_PAYS_US amount was ever
  // booked, so there is nothing else for the ledger balance to net back
  // from; it never moved in the first place (asserted again below).
  const voidRes = await (
    await page.request.post(
      `${BACKEND_URL}/api/transactions/${settlementTxn.id}/void`,
      { headers: auth },
    )
  ).json();
  expect(voidRes.success, JSON.stringify(voidRes)).toBeTruthy();

  const ledgerAfterVoid = await ledgerOf();
  expect(
    ledgerAfterVoid.find((l) => l.id === settlementLedgerId)?.is_refunded,
  ).toBe(1);

  // Supplier LBP balance is back to the pre-bill baseline (it never actually
  // moved — a bills-only SETTLEMENT row is contractually 0/0 both before and
  // after void).
  expect((await balanceOf()) - balBefore).toBe(0);

  // The settlement's derived display records have no soft-void column —
  // TransactionRepository._reverseCommissionAtSettlementRecords hard-deletes
  // them on void — so the commission enrichment from step 4 disappears too,
  // proving no stale commission linkage survives for a future re-settlement
  // to pick up by mistake.
  const settlementRowAfterVoid = ledgerAfterVoid.find(
    (l) => l.id === settlementLedgerId,
  );
  expect(settlementRowAfterVoid!.settlement_commission_usd ?? null).toBeNull();
  expect(settlementRowAfterVoid!.settlement_commission_lbp ?? null).toBeNull();

  // The bill re-joins the unsettled queue.
  const unsettledAfterVoid = await unsettledKatsh();
  const billAfterVoid = unsettledAfterVoid.find((r) => r.id === billId);
  expect(
    billAfterVoid,
    "bill did not re-join the unsettled queue",
  ).toBeTruthy();
  expect(billAfterVoid!.settlement_id).toBeNull();
  expect((await billCountOf()) - billCountBefore).toBe(1);

  // ...and its Transactions-tab commission display clears too: settlement_id
  // resets to NULL, and the allocation row backing settled_commission_* is
  // gone.
  const allTxnsAfterVoid = await allTransactionsKatsh();
  const billTxnAfterVoid = allTxnsAfterVoid.find((t) => t.id === billId);
  expect(
    billTxnAfterVoid,
    "voided BILL row not found in all-transactions",
  ).toBeTruthy();
  expect(billTxnAfterVoid!.settlement_id).toBeNull();
  expect(billTxnAfterVoid!.settled_commission_usd ?? null).toBeNull();
  expect(billTxnAfterVoid!.settled_commission_lbp ?? null).toBeNull();
});
