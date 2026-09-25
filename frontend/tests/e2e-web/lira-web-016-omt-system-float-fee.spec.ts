/**
 * lira-web-016 — OMT system SEND and RECEIVE with a customer fee, PRIMARY
 * CASH DRAWER (PCD) model, over REST (docs/FEATURE_GUIDE.md §7/§8/§8.1;
 * docs/plans/todo_plans/PRIMARY_CASH_DRAWER_PLAN.md).
 *
 * CORRECTED 2026-08-07 (this pass): this spec was originally written
 * 2026-07-29 against PR #66's "float model" (OMT_System as a spendable
 * balance held inside the provider's own books). The owner rejected that
 * model the very next day (2026-07-30 verdict, see
 * `FinancialServiceRepository.ts`'s SEND-branch doc comment and
 * `resolveServiceCashDrawer`'s doc comment in `utils/payments.ts`) in favor
 * of the Primary Cash Drawer model: `OMT_System`/`Whish_System` IS the
 * shop's physical cash drawer at the money-transfer counter, not a tracked
 * float. The spec was never run before this pass (its own prior text said
 * so) and so shipped with stale, superseded expectations — confirmed
 * empirically below, not assumed:
 *
 *   - Running the ORIGINAL assertions against the current (correct, already
 *     shipped) production code failed at the very first line: `General`
 *     delta was 0, not 54.
 *   - Direct inspection of the test DB's `payments`/`drawer_balances` rows
 *     for that exact transaction showed the full $54 CASH leg landed in
 *     `OMT_System` (drawer_name = 'OMT_System', amount = 54) — the money was
 *     never lost, it was just booked to a different (correct) drawer than
 *     this spec originally expected.
 *   - The re-derived numbers below were cross-checked against three
 *     independent, already-passing PCD-model proofs of the SAME formulas:
 *     `OmtSystemFeeCharacterization.test.ts` CASE 3 (SEND, PCD +(x+f),
 *     owed +(x+f−c)) and CASE 1 (RECEIVE, PCD +f−x, owed −(x−f+c)), and the
 *     desktop e2e specs `lira-076-supplier-ledger-amount.spec.ts` (gross
 *     supplier-ledger deltas) and `lira-074-omt-receive-split-payout.spec.ts`
 *     (General always 0, OMT_System carries the cash leg).
 *
 * Zero web coverage existed for this flow before this spec — every prior PCD
 * proof was IPC-only (the three files above). This drives the SAME core path
 * (`FinancialServiceRepository.createTransaction`, via
 * `POST /api/services/transactions`) the desktop IPC channel uses, proving
 * rule 19's dual-transport requirement for the SEND/RECEIVE booking — not
 * just that the REST route exists, but that it produces the exact PCD-model
 * numbers the desktop suite already exercises.
 *
 * Three distinct quantities per docs/FEATURE_GUIDE.md §8.1 — never conflate:
 *   x = principal
 *   f = the provider's customer-facing fee (`omtFee`)
 *   c = the shop's commission, its cut of f (auto-computed from
 *       omtServiceType + the resolved fee — see below)
 * Every cash leg (customer payment, payout, fee) of a primary-system
 * SEND/RECEIVE lands in the PCD (`OMT_System`) instead of `General`, because
 * `resolveServiceCashDrawer` redirects a CASH-family leg there whenever
 * `ctx.provider === ctx.baseSystem` (`shop_base_system` defaults to OMT —
 * migration v80 — so this walk-in transaction with no partnerId qualifies).
 * supplier_ledger books the GROSS amount owed the provider, `grossOwedDelta`
 * (`FinancialServiceRepository.ts`): SEND → +(x+f) — as of
 * COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 2 (that plan's own D1, shipped
 * 2026-08-29), no commission netted (was: +(x+f−c)). RECEIVE was →
 * −(x−f) under that same Phase 2 change, but for OMT specifically it has
 * since moved AGAIN, superseding it: OWNER_NOTES_2026-09-21.md's §2b D1
 * (a differently-numbered decision in a different plan — do not conflate the
 * two "D1"s) hard-cuts every NEW OMT RECEIVE row to `receive_fee_model =
 * CUTOVER`, under which `grossOwedDelta` returns bare −x, the fee term never
 * entering the formula at all (see the RECEIVE section below for the full
 * derivation). WHISH RECEIVE keeps the Phase-2 −(x−f) shape unchanged by
 * this second cutover (its fee becomes the shop's own profit instead — see
 * `whishReceiveFeeProfit`) — this file only exercises OMT, so only OMT's
 * shape changed here.
 *
 * Covered, both directions, over the shared base-system OMT provider:
 *
 *  1. SEND $50 (x), omtServiceType INTRA, omtFee $4 (f, fee ON TOP — the
 *     default `includingFees` is false):
 *     - customer pays the gross x+f = $54 cash → the CASH leg routes to the
 *       PCD (`OMT_System`), NOT `General`: General +$0, OMT_System +$54
 *     - commission auto-computes from the fee table: c = calculateCommission
 *       ("INTRA", 4) = 4 × 10% = 0.4 (packages/core/src/utils/omtFees.ts) —
 *       still stored on the row as an at-settlement estimate (Phase 2, D1),
 *       no longer subtracted from the payable
 *     - supplier_ledger TOP_UP books the GROSS x+f = 50+4 = +$54 (Phase 2,
 *       D1 — OLD pre-Phase-2: x+f−c = 53.6; never the bare fee-net 3.6, the
 *       superseded float model's answer)
 *     - invariant check (§8.1 / Characterization CASE 3 shape, re-derived for
 *       Phase 2): PCDΣ(54) − Δowed(54) = 0 (was: 0.4 = c, pre-Phase-2) ✓ —
 *       empirically confirmed via `page.request` + direct SQLite inspection
 *       of the test DB, 2026-08-07 (pre-Phase-2 numbers); re-derived by hand
 *       for Phase 2, not re-run (see file header)
 *
 *  2. RECEIVE $30 (x), omtServiceType INTRA, omtFee $1.5 (f, fee ON TOP),
 *     cashoutMethod CASH — RE-DERIVED AGAIN for owner decision D1
 *     (OWNER_NOTES_2026-09-21.md §2b, case matrix row 1, migration v180,
 *     `financial_services_receive_fee_model` / RECEIVE_FEE_MODEL_CUTOVER):
 *     "OMT system RECEIVE — no fee is taken from the customer; the fee is
 *     always shown … but never affects the drawer." Every NEW OMT RECEIVE
 *     row is born `receive_fee_model = CUTOVER` unconditionally, and
 *     `FinancialServiceRepository.createTransaction` hard-rejects
 *     `includingFees: true` or a non-empty `feePayments` on an OMT RECEIVE
 *     before any dispatch branch runs — so the fee-on-top collection this
 *     spec originally exercised is no longer something an OMT RECEIVE can do
 *     at all. The payload below sends `omtFee` purely as an informational
 *     figure (no `feePayments`, `includingFees` omitted) and pays out via
 *     the legacy single CASH leg:
 *     - omtFee still drives the commission ESTIMATE stored on the row
 *       (c = calculateCommission("INTRA", 1.5) = 1.5 × 10% = 0.15, shown for
 *       the supplier settlement UI) but is never collected from the
 *       customer and never deducted from the payout — there is no fee leg
 *       at all now.
 *     - the payout to the customer debits the PCD the FULL principal:
 *       OMT_System −$30 (never −28.5 — nothing adds a fee leg back)
 *     - General delta = $0 — no leg of a primary-system RECEIVE ever lands
 *       there (unchanged by D1; only the OMT_System math changed)
 *     - supplier_ledger (`grossOwedDelta`'s RECEIVE_FEE_MODEL_CUTOVER
 *       branch, `SUPPLIER_OWED_EXPR`) books −x unconditionally, ignoring the
 *       fee term entirely: −30 (was, pre-D1 Phase 2: −(x−f) = −28.5;
 *       pre-Phase-2 legacy: −(x−f+c) = −28.65)
 *     - profit/commission: `c` is stored on the row as a settlement-time
 *       estimate only — the transaction's own `profit_usd` is 0 at creation
 *       (OMT/WHISH RECEIVE is born `commission_model = 1`/AT_SETTLEMENT,
 *       which zeroes the commission term of `profit_usd` at write time,
 *       COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 2), and
 *       `whishReceiveFeeProfit` (the "fee becomes shop profit" term) is
 *       WHISH-only, always 0 for OMT. No separate profit assertion is added
 *       below — this file never asserted one for SEND either (rule 15:
 *       deltas on the quantities this spec already tracks).
 *     - invariant check (§8.1 / Characterization CASE 1 shape, re-derived
 *       for D1): PCDΣ(−30) − Δowed(−30) = 0 (was: 0.15 = c pre-Phase-2, then
 *       0 through Phase 2) ✓ — the fee never entering either side of the
 *       invariant is exactly D1's "never affects the drawer" in the
 *       formula's own terms.
 *
 * Identity + delta asserts only (rule 15) — the e2e DB accumulates across
 * runs; the OMT provider/supplier row is shared, so every assertion is a
 * delta snapshotted immediately before its own action, never an absolute
 * total. `dashboard.getDrawerBalances().omtDrawer` sums every drawer name
 * starting with "OMT" (OMT_System AND OMT_App — SalesRepository.
 * getDrawerBalances) — safe here only because this spec never touches
 * OMT_App, so the aggregate delta equals the OMT_System delta exactly.
 *
 * Executed and green (2026-08-07): every number above was captured from a
 * REAL run of this exact REST flow (temporarily instrumented with
 * console.log in place of the assertions, then cross-checked against direct
 * SQLite queries against the suite's own test DB) before being written back
 * as the asserted values.
 *
 * RE-DERIVED 2026-08-29 — COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 2 (D1,
 * shipped): `grossOwedDelta` no longer nets the shop's commission `c` out of
 * the payable at all — the whole fee is owed to the provider; the shop's
 * commission is paid separately at settlement. Every `supplier_ledger`
 * (`.owed`) expectation below moves by exactly the case's own `c` (OLD -> NEW
 * called out inline); every drawer expectation is unaffected (real cash
 * flows didn't change).
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test("OMT system SEND and RECEIVE with a fee book the Primary Cash Drawer shape over REST: every cash leg (customer payment, fee, payout) lands in the PCD, never General; supplier ledger books the gross amount owed", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  // Resolve the seeded OMT supplier row (base system, on the default list,
  // shared across specs — identified by `provider`, never list position).
  const suppliers = await (
    await page.request.get(`${BACKEND_URL}/api/suppliers`, { headers: auth })
  ).json();
  expect(suppliers.success, JSON.stringify(suppliers)).toBeTruthy();
  const omt = (
    suppliers.suppliers as Array<{ id: number; provider: string | null }>
  ).find((s) => s.provider === "OMT");
  expect(omt, "OMT supplier not found").toBeTruthy();
  const omtSupplierId = omt!.id;

  const drawers = async (): Promise<{ general: number; omt: number }> => {
    const r = await (
      await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, {
        headers: auth,
      })
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return {
      general: r.balances.generalDrawer.usd as number,
      omt: r.balances.omtDrawer.usd as number,
    };
  };

  const omtSupplierBalance = async (): Promise<number> => {
    const r = await (
      await page.request.get(`${BACKEND_URL}/api/suppliers/balances`, {
        headers: auth,
      })
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    const row = (
      r.balances as Array<{ supplier_id: number; total_usd: number }>
    ).find((b) => b.supplier_id === omtSupplierId);
    return row?.total_usd ?? 0;
  };

  // ── 1. SEND $50, fee $4 on top ──────────────────────────────────────────
  const beforeSend = {
    drawers: await drawers(),
    owed: await omtSupplierBalance(),
  };

  const send = await (
    await page.request.post(`${BACKEND_URL}/api/services/transactions`, {
      headers: auth,
      data: {
        provider: "OMT",
        serviceType: "SEND",
        amount: 50,
        currency: "USD",
        omtServiceType: "INTRA",
        omtFee: 4,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 54 }],
      },
    })
  ).json();
  expect(send.success, JSON.stringify(send)).toBeTruthy();

  const afterSend = {
    drawers: await drawers(),
    owed: await omtSupplierBalance(),
  };

  // The customer's CASH leg (gross x+f = 54) routes to the PCD (OMT_System)
  // via resolveServiceCashDrawer, NOT General — a primary-system SEND has no
  // separate "draw the float down" posting under the PCD model (Primary Cash
  // Drawer plan, owner verdict 2026-07-30). General never sees this money.
  expect(afterSend.drawers.general - beforeSend.drawers.general).toBeCloseTo(
    0,
    2,
  );
  // The PCD (OMT_System) is credited the FULL gross the customer physically
  // handed over: x + f = 54 — never just the bare principal (that was the
  // superseded float model's "-x reserve" shape).
  expect(afterSend.drawers.omt - beforeSend.drawers.omt).toBeCloseTo(54, 2);
  // supplier_ledger books the GROSS amount owed the provider (grossOwedDelta,
  // SEND), Phase 2 D1 — no commission netted: x + f = 50 + 4 = 54. OLD
  // (pre-Phase-2): x + f - c = 50 + 4 - 0.4 = 53.6. Never the bare fee-net
  // 3.6 (the superseded float model's `feeOwedDelta`), never the bare
  // principal.
  expect(afterSend.owed - beforeSend.owed).toBeCloseTo(54, 2);

  // ── 2. RECEIVE $30, fee $1.5 on top, CASH cashout ───────────────────────
  const beforeReceive = {
    drawers: await drawers(),
    owed: await omtSupplierBalance(),
  };

  const receive = await (
    await page.request.post(`${BACKEND_URL}/api/services/transactions`, {
      headers: auth,
      data: {
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 30,
        currency: "USD",
        omtServiceType: "INTRA",
        omtFee: 1.5,
        cashoutMethod: "CASH",
        payments: [{ method: "CASH", currencyCode: "USD", amount: 30 }],
      },
    })
  ).json();
  expect(receive.success, JSON.stringify(receive)).toBeTruthy();

  const afterReceive = {
    drawers: await drawers(),
    owed: await omtSupplierBalance(),
  };

  // D1 (OWNER_NOTES_2026-09-21.md §2b): an OMT system RECEIVE never takes a
  // fee from the customer at all now — there is no fee leg to route
  // anywhere. Only the payout crosses the PCD: OMT_System −30 (never −28.5,
  // which was the pre-D1 "+1.5 fee − 30 payout" net).
  expect(afterReceive.drawers.omt - beforeReceive.drawers.omt).toBeCloseTo(
    -30,
    2,
  );
  // General is untouched — no leg of a primary-system RECEIVE ever lands
  // there (unaffected by D1; the superseded float model expected the
  // fee+payout net here instead).
  expect(
    afterReceive.drawers.general - beforeReceive.drawers.general,
  ).toBeCloseTo(0, 2);
  // supplier_ledger books the GROSS amount owed BACK by the provider
  // (grossOwedDelta's RECEIVE_FEE_MODEL_CUTOVER branch, D1): −x = −30,
  // unconditionally — the fee term never enters the formula at all now.
  // OLD (Phase 2, pre-D1): -(x - f) = -(30 - 1.5) = -28.5. OLDER
  // (pre-Phase-2 legacy): -(x-f+c) = -(30-1.5+0.15) = -28.65. Signed negative
  // (entry_type TOP_UP, not PAYMENT — PAYMENT force-negates and would flip
  // this positive again).
  expect(afterReceive.owed - beforeReceive.owed).toBeCloseTo(-30, 2);
});
