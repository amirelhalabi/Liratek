/**
 * lira-web-016 — OMT system SEND and RECEIVE with a customer fee, float
 * model, over REST (docs/FEATURE_GUIDE.md §7/§8/§8.1, 2026-07-29).
 *
 * Zero web coverage existed for this flow before this spec (the float-model
 * assess report confirmed it) — every prior float-model proof was IPC-only
 * (`OmtSystemFeeCharacterization.test.ts`, lira-074, lira-076). This drives
 * the SAME core path (`FinancialServiceRepository.createTransaction`, via
 * `POST /api/services/transactions`) the desktop IPC channel uses, proving
 * rule 19's dual-transport requirement for the rewritten SEND/RECEIVE booking
 * — not just that the REST route exists, but that it produces the exact
 * float-model numbers the desktop suite already exercises.
 *
 * Three distinct quantities per docs/FEATURE_GUIDE.md §8.1 — never conflate:
 *   x = principal (moves through the OMT_System float drawer only)
 *   f = the provider's customer-facing fee (`omtFee`)
 *   c = the shop's commission, its cut of f (auto-computed from
 *       omtServiceType + the resolved fee — see below)
 * supplier_ledger books ONLY `f − c` (never x); the float drawer books
 * ONLY `x` (never f or c).
 *
 * Covered, both directions, over the shared base-system OMT provider
 * (shop_base_system defaults to OMT — migration v80 — so no partnerId is
 * needed for a walk-in transaction):
 *
 *  1. SEND $50 (x), omtServiceType INTRA, omtFee $4 (f, fee ON TOP — the
 *     default `includingFees` is false):
 *     - customer pays the gross x+f = $54 cash → General +$54
 *     - the OMT_System float is drawn DOWN by the bare principal: −$50
 *     - commission auto-computes from the fee table: c = calculateCommission
 *       ("INTRA", 4) = 4 × 10% = 0.4 (packages/core/src/utils/omtFees.ts)
 *     - supplier_ledger TOP_UP books ONLY f − c = 4 − 0.4 = +$3.6 (never the
 *       gross 54, never the bare 50 — the superseded C3 model's two wrong
 *       answers)
 *     - invariant check (§8.1): Σ(drawer deltas) − Δ(owed) = c ⇒
 *       (54 − 50) − 3.6 = 0.4 ✓, hand-derived, unexecuted
 *
 *  2. RECEIVE $30 (x), omtServiceType INTRA, omtFee $1.5 (f, fee ON TOP),
 *     cashoutMethod CASH:
 *     - the OMT_System float is filled back UP by the bare principal: +$30
 *       (never x + commission, the pre-float-model shape)
 *     - a NEW customer-paid fee leg (this fix's own new capability — RECEIVE
 *       never had a fee leg before) credits General +$1.5
 *     - the payout to the customer debits General −$30 (fee is on top, not
 *       netted out of the payout since `includingFees` is false)
 *     - net General delta for this action: +1.5 − 30 = −$28.5
 *     - c = calculateCommission("INTRA", 1.5) = 1.5 × 10% = 0.15
 *     - supplier_ledger TOP_UP books f − c = 1.5 − 0.15 = +$1.35 — the SAME
 *       shape as SEND (both directions book identically now; RECEIVE used to
 *       book the bare principal with entry_type PAYMENT, force-negated)
 *     - invariant check: (30 + 1.5 − 30) − 1.35 = 0.15 = c ✓, hand-derived,
 *       unexecuted
 *
 * Identity + delta asserts only (rule 15) — the e2e DB accumulates across
 * runs; the OMT provider/supplier row is shared, so every assertion is a
 * delta snapshotted immediately before its own action, never an absolute
 * total. `dashboard.getDrawerBalances().omtDrawer` sums every drawer name
 * starting with "OMT" (OMT_System AND OMT_App — SalesRepository.
 * getDrawerBalances) — safe here only because this spec never touches
 * OMT_App, so the aggregate delta equals the OMT_System delta exactly.
 *
 * Unexecuted per this workstream's ground rules — every number above is
 * derived by hand from FinancialServiceRepository.ts's feeOwedDelta/SEND/
 * RECEIVE branches and packages/core/src/utils/omtFees.ts, never run.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test("OMT system SEND and RECEIVE with a fee book the float-model shape over REST: principal through the float drawer, fee-net-of-commission through the supplier ledger", async ({
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
  const beforeSend = { drawers: await drawers(), owed: await omtSupplierBalance() };

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

  const afterSend = { drawers: await drawers(), owed: await omtSupplierBalance() };

  // Customer paid the gross x+f = 54 in cash — General is credited, not
  // netted back out (the deleted "reserve" branch this whole fix removed).
  expect(afterSend.drawers.general - beforeSend.drawers.general).toBeCloseTo(
    54,
    2,
  );
  // The float drawer draws down by the BARE principal only (−x), never the
  // gross x+f — the sign-flip + de-grossing this whole rewrite is about.
  expect(afterSend.drawers.omt - beforeSend.drawers.omt).toBeCloseTo(-50, 2);
  // supplier_ledger books f−c = 4−0.4 = 3.6, never x+f (85-style gross) and
  // never bare f.
  expect(afterSend.owed - beforeSend.owed).toBeCloseTo(3.6, 2);

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

  // Float fills back up by the bare principal (+x = +30) — the fee never
  // touches this leg, on either direction.
  expect(afterReceive.drawers.omt - beforeReceive.drawers.omt).toBeCloseTo(
    30,
    2,
  );
  // General nets the new customer-paid fee leg (+1.5) against the payout
  // (−30): +1.5 − 30 = −28.5. Before this fix a RECEIVE had no fee leg at
  // all, so this would have been a bare −30.
  expect(
    afterReceive.drawers.general - beforeReceive.drawers.general,
  ).toBeCloseTo(-28.5, 2);
  // supplier_ledger books the SAME shape as SEND: f−c = 1.5−0.15 = 1.35,
  // entry_type TOP_UP (not PAYMENT — PAYMENT force-negates, which would
  // have made this obligation silently REDUCE what's owed instead).
  expect(afterReceive.owed - beforeReceive.owed).toBeCloseTo(1.35, 2);
});
