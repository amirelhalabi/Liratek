/**
 * lira-web-018 — mixed-direction session basket checkout over REST
 * (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase G / §1.5 / Phase F).
 *
 * Drives `POST /api/sessions/checkout` (mirrors lira-web-002's WP4 pattern)
 * with a basket that mixes BOTH directions in one pooled payment:
 *  - a charge item (custom_services, $30 — IN)
 *  - a fee-on-top OMT RECEIVE item (x=50, f=4, omtServiceType INTRA →
 *    c = 4 × 10% = 0.4) — a NEGATIVE cart item (the shop's payout, per the
 *    frontend's own wire contract: `amount: -customerTotal` for a fee-on-top
 *    RECEIVE, Services/index.tsx) whose fee joins the basket's CHARGE bucket
 *    instead of a per-item fee leg (session baskets reject `feePayments[]` —
 *    Phase A2 finding 4/repo guard "not supported in a session basket").
 *
 * `payments[]` covers both buckets in ONE call (rule 16 — there is no
 * follow-up call): an IN leg for the pooled charge+fee ($30 + $4 = $34) and
 * a `direction:"OUT", kind:"PAYOUT"` leg for the $50 payout. The session's
 * PCD/General split (SessionPaymentRepository.getSessionCashSplitContext,
 * Primary Cash Drawer plan §3 Phase D + bug 7 fix) computes TWO independent
 * ratios:
 *   - charge ratio  = primarySystemChargeUsd / chargeTotalUsd = 4 / 34
 *     (custom_services isn't a financial_services row, so only the RECEIVE
 *     item's folded-in fee counts as "primary-system charge")
 *   - payout ratio  = primarySystemPayoutUsd / payoutTotalUsd = 50 / 50 = 1
 *     (the RECEIVE item is the ONLY payout item, and it's on the primary
 *     system OMT)
 * Both ratios land on EXACT cent splits here by construction (chosen so the
 * PCD share of the $34 charge leg is precisely the $4 fee, and the whole $50
 * payout leg is 100% PCD) — no rounding-remainder ambiguity to reason about.
 *
 * Expected drawer deltas for this ONE checkout call:
 *   PCD (omtDrawer)     = +4 (fee's charge-side PCD share) − 50 (payout) = −46
 *   General             = +30 (custom_services' charge-side General share)
 * supplier_ledger (item B's own booking, gross model — FinancialServiceRepository's
 * `grossOwedDelta` for RECEIVE), as of COMMISSION_AT_SETTLEMENT_PLAN.md §4
 * Phase 2 (D1, shipped 2026-08-29) — no commission netted:
 * −(x − f) = −(50 − 4) = −46 (was: −(x−f+c) = −(50−4+0.4) = −46.4)
 *
 * §8.4 invariant (docs/FEATURE_GUIDE.md §8.4, extended by the plan's §1.3),
 * checked against ONLY the RECEIVE item's own attributable drawer deltas
 * (the +4 fee share and the −50 payout share — the custom_services item's
 * +30 General share is a different item and excluded from this per-item
 * check). Phase 2 (D1) drops the `c` term from the RHS too — nothing is kept
 * at transaction time anymore:
 *   Σ(drawer deltas) + Σ(receivable deltas) − Δ(owed) = 0   (was: = c)
 *   (4 − 50) + 0 − (−46) = −46 + 46 = 0 ✓ (was: −46 + 46.4 = 0.4 = c)
 *
 * Identity note (rule 15): as in lira-web-017, there is no REST route
 * exposing individual session-basket payment-leg rows (method/note), so
 * "the payout leg's note is 'Basket payout to customer'" is proven the same
 * way as the note text's OWN discriminator was designed for — by
 * construction, not by fetching the string: `SessionPaymentService.
 * recordBasketPayment` only ever writes "Basket change returned" for a
 * kind-less/CHANGE OUT leg and "Basket payout to customer" for a
 * `kind:"PAYOUT"` OUT leg (packages/core/src/services/SessionPaymentService.ts).
 * This basket's OUT leg is explicitly `kind:"PAYOUT"`, so the note is
 * "Basket payout to customer" (+ " (primary-system item share)" — the branch
 * that fires here, since the leg's PCD share is > 0) by the single code path
 * that could have produced this exact PCD delta at all — the CHANGE-note
 * branch is provably unreached because this checkout carries no kind-less/
 * CHANGE OUT leg. A true per-leg REST fetch would need a new route (out of
 * this phase's "no route changes" scope) — noted as a parity gap, same as
 * lira-web-017.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test("mixed charge + fee-on-top RECEIVE payout basket checks out over REST with both drawers moving and the §8.4 invariant holding", async ({
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
            label: "L018 OMT RECEIVE fee-on-top",
            // Wire contract (Services/index.tsx): a fee-on-top RECEIVE cart
            // item's `amount` is the NEGATIVE bare principal only — the fee
            // is NOT netted in here, it joins the basket's charge bucket via
            // the persisted omt_fee column (feeOnTopReceiveFsIds gate).
            amount: -50,
            currency: "USD",
            ipcChannel: "financial:create",
            formData: {
              provider: "OMT",
              serviceType: "RECEIVE",
              amount: 50,
              currency: "USD",
              omtServiceType: "INTRA",
              omtFee: 4,
              includingFees: false,
              // Client-computed profit hint the real frontend also sends —
              // read directly by SessionCheckoutService's profit aggregation
              // (never re-derived from the server's own calculatedCommission).
              commission: 0.4,
            },
          },
        ],
        payments: [
          // Pooled charge+fee collection: $30 (custom service) + $4 (RECEIVE
          // fee, folded into the charge bucket) = $34, plain IN (no `kind`).
          { method: "CASH", currency_code: "USD", amount: 34 },
          // The shop's payout to the customer for the RECEIVE item — OUT,
          // kind "PAYOUT" (never the legacy change-return leg).
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
  // Net of the signed per-item amounts: 30 + (-50) = -20.
  expect(checkout.checkoutTotalUsd).toBeCloseTo(-20, 2);
  // Only the RECEIVE item carries a profit hint (0.4); custom_services sets
  // none here, isolating the commission's contribution to the aggregate.
  expect(checkout.checkoutProfitUsd).toBeCloseTo(0.4, 2);

  const after = {
    d: await drawers(),
    o: await owedFor(supplierId),
  };

  // Both drawers moved in this ONE pooled checkout (never a follow-up call —
  // rule 16): General collects the custom-service charge's non-primary
  // share; the PCD nets the fee's charge-side share against the full payout.
  expect(after.d.general - before.d.general).toBeCloseTo(30, 2);
  expect(after.d.pcd - before.d.pcd).toBeCloseTo(-46, 2);

  // supplier_ledger booked by the RECEIVE item alone (gross model), Phase 2
  // (D1) — no commission netted: -(50 - 4) = -46. OLD (pre-Phase-2): -46.4.
  expect(after.o - before.o).toBeCloseTo(-46, 2);

  // §8.4 invariant, RECEIVE item's own attributable ledgers only:
  // Σdrawer(+4 fee share, -50 payout) + Σreceivable(0) - Δowed(-46) = 0
  // (was: = c = 0.4, pre-Phase-2 — nothing is kept at transaction time
  // anymore; the commission settles separately).
  const itemBDrawerDelta = 4 + -50;
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
