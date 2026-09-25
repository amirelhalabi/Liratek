/**
 * lira-web-018 — mixed-direction session basket checkout over REST
 * (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase G / §1.5 / Phase F), RE-DERIVED
 * for owner decision D1 (`docs/plans/todo_plans/OWNER_NOTES_2026-09-21.md`
 * §2b, case matrix row 4, migration v180).
 *
 * OLD rule (what this file used to guard): a fee-on-top OMT system RECEIVE
 * inside a session basket folded its fee `f` into the basket's pooled
 * CHARGE leg (collected as real cash alongside the other charge items), and
 * the supplier ledger netted `f` out of what OMT owed.
 *
 * NEW rule (D1, final): an OMT system RECEIVE never takes a fee from the
 * customer, in a session basket exactly as everywhere else — `omtFee` stays
 * informational (drives the commission ESTIMATE only). Two independent
 * mechanisms now enforce this for a basket item specifically — see
 * `SessionPaymentRepository.getSessionCashSplitContext`'s own D1 cutover
 * comment (`packages/core/src/repositories/SessionPaymentRepository.ts`,
 * `feeOnTopReceiveFsIds` handling): the basket recorder is a SEPARATE call
 * from `createTransaction` (whose hard-reject guards therefore don't reach
 * it), so the fee-folding SQL itself is now provider-gated —
 * `CASE WHEN provider = 'WHISH' THEN COALESCE(whish_fee, 0) ELSE 0 END` —
 * meaning an OMT row's fee resolves to 0 in the charge-bucket computation
 * regardless of what `omt_fee` the row carries. This basket therefore no
 * longer collects the $4 fee as cash at all: the pooled charge leg is just
 * the $30 custom-service charge, and the $50 payout leg is unaffected
 * (payout-side routing was never fee-dependent — bug 7's ratio uses the
 * item's own payout MAGNITUDE, not its fee).
 *
 * Drives `POST /api/sessions/checkout` (mirrors lira-web-002's WP4 pattern)
 * with a basket that mixes BOTH directions in one pooled payment:
 *  - a charge item (custom_services, $30 — IN)
 *  - an OMT system RECEIVE item (x=50) that STILL carries `omtFee: 4` in its
 *    formData — kept deliberately (rule 24: keep the same realistic amounts
 *    where they exist) to prove the fee is genuinely just informational now:
 *    it drives ONLY the client-supplied commission-estimate hint
 *    (`commission: 0.4`, unaffected by D1 — see lira-web-017's positive
 *    test (g) for the same estimate formula), never a leg, never a drawer.
 *
 * `payments[]` covers both buckets in ONE call (rule 16 — there is no
 * follow-up call): a plain IN leg for the charge ($30 only — no fee folded
 * in) and a `direction:"OUT", kind:"PAYOUT"` leg for the $50 payout. The
 * session's PCD/General split (SessionPaymentRepository.
 * getSessionCashSplitContext, Primary Cash Drawer plan §3 Phase D) computes
 * TWO independent ratios:
 *   - charge ratio  = primarySystemChargeUsd / chargeTotalUsd = 0 / 30 = 0
 *     (custom_services isn't a financial_services row, and the OMT item now
 *     contributes NOTHING to the charge bucket under D1 — the $30 charge
 *     leg is 100% General)
 *   - payout ratio  = primarySystemPayoutUsd / payoutTotalUsd = 50 / 50 = 1
 *     (unaffected by D1 — the RECEIVE item is the ONLY payout item, and
 *     it's on the primary system OMT, exactly as before)
 *
 * Expected drawer deltas for this ONE checkout call:
 *   PCD (omtDrawer)     = 0 (no fee share) − 50 (full payout) = −50
 *   General             = +30 (the charge leg's ENTIRE share, ratio 0)
 * supplier_ledger (item B's own booking, `grossOwedDelta`'s D1 CUTOVER
 * branch — `packages/core/src/repositories/FinancialServiceRepository.ts`):
 * `-principal` unconditionally, the fee term never enters the formula —
 * `-50`, not `-(50 - 4) = -46`. This booking is unaffected by `deferPayment`
 * (session-basket items still hit the same supplier-ledger write site,
 * per that function's own D1 trace comment), so it books the same way a
 * walk-in RECEIVE does.
 *
 * §8.4 invariant (docs/FEATURE_GUIDE.md §8.4), checked against ONLY the
 * RECEIVE item's own attributable drawer deltas (the $0 fee share and the
 * −$50 payout share — the custom_services item's +$30 General share is a
 * different item and excluded from this per-item check). D1 drops every
 * term but the payout from the LHS — nothing is kept at transaction time,
 * same as the walk-in case:
 *   Σ(drawer deltas) + Σ(receivable deltas) − Δ(owed) = 0
 *   (0 − 50) + 0 − (−50) = −50 + 50 = 0 ✓
 *
 * Identity note (rule 15): as in lira-web-017, there is no REST route
 * exposing individual session-basket payment-leg rows (method/note), so
 * "the payout leg's note is 'Basket payout to customer'" is proven by
 * construction, not by fetching the string: `SessionPaymentService.
 * recordBasketPayment` only ever writes "Basket change returned" for a
 * kind-less/CHANGE OUT leg and "Basket payout to customer" for a
 * `kind:"PAYOUT"` OUT leg. This basket's OUT leg is explicitly
 * `kind:"PAYOUT"`, so the note is "Basket payout to customer" (+ " (primary-
 * system item share)" — the branch that fires here, since the leg's PCD
 * share is > 0, unaffected by D1: only the CHARGE side's fee attribution
 * changed, not the payout side's) by the single code path that could have
 * produced this exact PCD delta at all. A true per-leg REST fetch would need
 * a new route (out of this phase's "no route changes" scope) — noted as a
 * parity gap, same as lira-web-017.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test("mixed charge + OMT RECEIVE payout basket checks out over REST — D1: the fee is shown, never collected, and both drawers move without it", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  const drawers = async (): Promise<{ general: number; pcd: number }> => {
    const r = await (
      await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, {
        headers: auth,
      })
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return {
      general: r.balances.generalDrawer.usd as number,
      pcd: r.balances.omtDrawer.usd as number,
    };
  };

  const omtSupplierId = async (): Promise<number> => {
    const suppliers = await (
      await page.request.get(`${BACKEND_URL}/api/suppliers`, { headers: auth })
    ).json();
    expect(suppliers.success, JSON.stringify(suppliers)).toBeTruthy();
    const omt = (
      suppliers.suppliers as Array<{ id: number; provider: string | null }>
    ).find((s) => s.provider === "OMT");
    expect(omt, "OMT supplier not found").toBeTruthy();
    return omt!.id;
  };

  const owedFor = async (supplierId: number): Promise<number> => {
    const r = await (
      await page.request.get(`${BACKEND_URL}/api/suppliers/balances`, {
        headers: auth,
      })
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    const row = (
      r.balances as Array<{ supplier_id: number; total_usd: number }>
    ).find((b) => b.supplier_id === supplierId);
    return row?.total_usd ?? 0;
  };

  const supplierId = await omtSupplierId();

  // Start a session (mirrors lira-web-002's WP4 pattern).
  const started = await (
    await page.request.post(`${BACKEND_URL}/api/sessions/start`, {
      headers: auth,
      data: {
        customer_name: `L018 Basket ${Date.now()}`,
        customer_phone: `0366${Date.now().toString().slice(-6)}`,
      },
    })
  ).json();
  expect(started.success, JSON.stringify(started)).toBeTruthy();
  const sessionId = started.sessionId as number;
  expect(sessionId).toBeTruthy();

  const before = {
    d: await drawers(),
    o: await owedFor(supplierId),
  };

  const checkout = await (
    await page.request.post(`${BACKEND_URL}/api/sessions/checkout`, {
      headers: auth,
      data: {
        sessionId,
        cartItems: [
          {
            id: "l018-charge",
            module: "custom_services",
            label: "L018 Custom Service",
            amount: 30,
            currency: "USD",
            ipcChannel: "custom-services:add",
            formData: {
              description: "L018 Custom Service",
              price_usd: 30,
              cost_usd: 0,
              status: "completed",
            },
          },
          {
            id: "l018-receive",
            module: "omt_system",
            label: "L018 OMT RECEIVE (fee shown, never collected)",
            // Wire contract (Services/index.tsx): a RECEIVE cart item's
            // `amount` is the NEGATIVE bare principal only — unaffected by
            // D1 (the fee was never netted into this field, on either side
            // of the cutover).
            amount: -50,
            currency: "USD",
            ipcChannel: "financial:create",
            formData: {
              provider: "OMT",
              serviceType: "RECEIVE",
              amount: 50,
              currency: "USD",
              omtServiceType: "INTRA",
              // D1: kept on the payload — still informational (drives the
              // commission ESTIMATE below), never collected as cash and
              // never folded into the basket's charge bucket. `includingFees`
              // is omitted entirely: D1 removed that choice for OMT RECEIVE
              // (the Services form no longer even renders the toggle for
              // this combination — Services/index.tsx's "Including Fees
              // Checkbox" block is now WHISH-RECEIVE/OMT-SEND only).
              omtFee: 4,
              // Client-computed profit hint the real frontend also sends —
              // read directly by SessionCheckoutService's profit aggregation
              // (never re-derived from the server's own calculatedCommission)
              // — unaffected by D1, same estimate formula as before
              // (calculateCommission("INTRA", 4) = 4 × 10% = 0.4).
              commission: 0.4,
            },
          },
        ],
        payments: [
          // Pooled charge collection: $30 (custom service) ONLY. D1: the
          // OMT item's $4 fee is no longer part of the charge bucket at
          // all (SessionPaymentRepository.getSessionCashSplitContext's
          // fee-folding SQL now resolves to 0 for a non-WHISH provider), so
          // it is never collected here.
          { method: "CASH", currency_code: "USD", amount: 30 },
          // The shop's payout to the customer for the RECEIVE item — OUT,
          // kind "PAYOUT" (never the legacy change-return leg). Unaffected
          // by D1: the payout is always the FULL principal for an OMT
          // RECEIVE now (there was never a fee-included deduction choice to
          // begin with in this basket — fee-on-top was always "pay the full
          // amount"; D1 just deletes the alternative).
          {
            method: "CASH",
            currency_code: "USD",
            amount: 50,
            direction: "OUT",
            kind: "PAYOUT",
          },
        ],
        exchangeRate: 90000,
        userId: 1,
      },
    })
  ).json();
  expect(checkout.success, JSON.stringify(checkout)).toBeTruthy();
  expect(checkout.itemCount).toBe(2);
  // Net of the signed per-item amounts: 30 + (-50) = -20 (unaffected by D1 —
  // the fee was never part of either item's `amount` field).
  expect(checkout.checkoutTotalUsd).toBeCloseTo(-20, 2);
  // Only the RECEIVE item carries a profit hint (0.4); custom_services sets
  // none here, isolating the commission estimate's contribution.
  expect(checkout.checkoutProfitUsd).toBeCloseTo(0.4, 2);

  const after = {
    d: await drawers(),
    o: await owedFor(supplierId),
  };

  // Both drawers moved in this ONE pooled checkout (never a follow-up call —
  // rule 16). D1: General collects the FULL $30 charge (ratio 0 — the OMT
  // item contributes nothing to the charge bucket); the PCD carries only
  // the full $50 payout, no fee share to offset it.
  expect(after.d.general - before.d.general).toBeCloseTo(30, 2);
  expect(after.d.pcd - before.d.pcd).toBeCloseTo(-50, 2);

  // supplier_ledger booked by the RECEIVE item alone (D1 CUTOVER —
  // `grossOwedDelta`'s RECEIVE branch): -principal unconditionally, the fee
  // term never enters the formula — -(50) = -50, not -(50 - 4) = -46.
  expect(after.o - before.o).toBeCloseTo(-50, 2);

  // §8.4 invariant, RECEIVE item's own attributable ledgers only:
  // Σdrawer(0 fee share, -50 payout) + Σreceivable(0) - Δowed(-50) = 0.
  const itemBDrawerDelta = 0 + -50;
  const itemBReceivableDelta = 0;
  const itemBOwedDelta = after.o - before.o;
  expect(itemBDrawerDelta + itemBReceivableDelta - itemBOwedDelta).toBeCloseTo(
    0,
    2,
  );

  // The session must be closed by the checkout (matches lira-web-002 WP4).
  const details = await (
    await page.request.get(`${BACKEND_URL}/api/sessions/${sessionId}`, {
      headers: auth,
    })
  ).json();
  expect(details.session.is_active).toBe(0);
});
