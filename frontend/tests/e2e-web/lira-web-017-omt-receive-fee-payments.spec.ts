/**
 * lira-web-017 — OMT RECEIVE with operator-chosen `feePayments[]` legs over
 * REST (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase G / rule 19).
 *
 * Sibling to lira-web-016 (kept untouched — see the header note below) rather
 * than an in-place extension: `feePayments[]` is Phase A/A2 (landed), proven
 * here over `POST /api/services/transactions`, the SAME core path
 * (`FinancialServiceRepository.createTransaction`) the desktop IPC channel
 * and lira-web-016 already exercise. No REST route changes were needed — the
 * Zod schema (`packages/core/src/validators/financial.ts`) and the
 * repository's own authoritative guard (§6bis findings 1/2/4/5) are shared by
 * both transports already.
 *
 * Three quantities per transaction (docs/FEATURE_GUIDE.md §8.1, extended by
 * the plan's §1.3/§1.4): x = principal, f = the provider's customer-facing
 * fee (omtFee), c = the shop's commission (calculateCommission("INTRA", f) =
 * f × 10% — packages/core/src/utils/omtFees.ts). supplier_ledger books the
 * GROSS `grossOwedDelta` shape for a RECEIVE: `-(x - f + c)`
 * (FinancialServiceRepository.ts's `grossOwedDelta`) — algebraically the same
 * number as the plan's §1.4 "−(x − (f−c))" (distribute the fee/commission
 * bracket and they're identical). The float drawer is now the Primary Cash
 * Drawer (PCD, `OMT_System` when OMT is `shop_base_system`, migration v80's
 * default) per PRIMARY_CASH_DRAWER_PLAN.md (PR #68) — every cash-family leg
 * of a primary-system RECEIVE (payout AND fee) lands there, not General.
 *
 * NOTE on lira-web-016: that spec's own SEND/RECEIVE assertions predate the
 * PR #68 primary-cash-drawer rewrite and the later gross-supplier-ledger
 * model (`grossOwedDelta`'s doc: "SEND +104.5" gross, not the old f−c-only
 * shape) — running it standalone against the current tree fails on its own
 * baseline math (`general +54` expected, `0` received; the $54 now lands in
 * `omtDrawer`/PCD, not General). That drift is pre-existing and orthogonal to
 * this feature; going sibling avoids coupling this phase's green run to
 * fixing an unrelated, already-rotted spec. Reported to the orchestrator as a
 * discovered-but-not-fixed parity gap.
 *
 * Identity note (rule 15): there is no REST route that returns individual
 * `payments` leg rows (method/note) for a financial-services transaction —
 * `GET /api/services/history` returns only the `financial_services` row
 * itself, and neither `TransactionRepository.getCustomerFacingLegs` nor the
 * IPC-only `omt.getPaymentsByTransaction` has a REST twin. Per this phase's
 * brief ("the REST surface needs no route changes"), identity here is proven
 * the same way lira-web-016 already does it: each sub-test uses financially
 * DISTINCT amounts and asserts the delta on the ONE named drawer only that
 * leg's method could have moved (`Whish_App`/`OMT_App` via `appWalletDrawer`,
 * `OMT_System` via `omtDrawer`) — nothing else touches that key in the same
 * narrow before/after window, so the delta itself is the identity proof. A
 * true leg-level (method + note text) REST fetch would need a new route,
 * which is out of this phase's scope; noted as a parity gap.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test.describe("OMT RECEIVE feePayments[] over REST", () => {
  async function auth(page: import("@playwright/test").Page) {
    await loginAsAdmin(page);
    const token = await page.evaluate(() =>
      localStorage.getItem("liratek.jwt"),
    );
    return { Authorization: `Bearer ${token}` };
  }

  async function drawers(
    page: import("@playwright/test").Page,
    headers: Record<string, string>,
  ): Promise<{ general: number; pcd: number; appWallet: number }> {
    const r = await (
      await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, {
        headers,
      })
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return {
      general: r.balances.generalDrawer.usd as number,
      // `omtDrawer` is the PCD (exact-match `OMT_System`/`Whish_System`, not
      // a startsWith fold) since PR #68 — see SalesRepository.getDrawerBalances.
      pcd: r.balances.omtDrawer.usd as number,
      // `OMT_App` + `Whish_App` combined — safe as an identity proxy here
      // because no sub-test in this file ever moves both in the same action.
      appWallet: r.balances.appWalletDrawer.usd as number,
    };
  }

  async function omtSupplierId(
    page: import("@playwright/test").Page,
    headers: Record<string, string>,
  ): Promise<number> {
    const suppliers = await (
      await page.request.get(`${BACKEND_URL}/api/suppliers`, { headers })
    ).json();
    expect(suppliers.success, JSON.stringify(suppliers)).toBeTruthy();
    const omt = (
      suppliers.suppliers as Array<{ id: number; provider: string | null }>
    ).find((s) => s.provider === "OMT");
    expect(omt, "OMT supplier not found").toBeTruthy();
    return omt!.id;
  }

  async function owed(
    page: import("@playwright/test").Page,
    headers: Record<string, string>,
    supplierId: number,
  ): Promise<number> {
    const r = await (
      await page.request.get(`${BACKEND_URL}/api/suppliers/balances`, {
        headers,
      })
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    const row = (
      r.balances as Array<{ supplier_id: number; total_usd: number }>
    ).find((b) => b.supplier_id === supplierId);
    return row?.total_usd ?? 0;
  }

  test("(a) fee-on-top RECEIVE with a single WHISH-wallet fee leg", async ({
    page,
  }) => {
    const headers = await auth(page);
    const supplierId = await omtSupplierId(page, headers);

    const before = { d: await drawers(page, headers), o: await owed(page, headers, supplierId) };

    // x=100, f=5, omtServiceType INTRA → c = 5 × 10% = 0.5. No `payments[]`
    // sent — the RECEIVE payout falls back to the legacy single-leg CASH
    // debit (cashoutMethod defaults "CASH"), which a primary-system RECEIVE
    // routes to the PCD (resolveServiceCashDrawer), not General.
    const res = await (
      await page.request.post(`${BACKEND_URL}/api/services/transactions`, {
        headers,
        data: {
          provider: "OMT",
          serviceType: "RECEIVE",
          amount: 100,
          currency: "USD",
          omtServiceType: "INTRA",
          omtFee: 5,
          feePayments: [{ method: "WHISH", currencyCode: "USD", amount: 5 }],
        },
      })
    ).json();
    expect(res.success, JSON.stringify(res)).toBeTruthy();

    const after = { d: await drawers(page, headers), o: await owed(page, headers, supplierId) };

    // Identity: WHISH is the ONLY method touching Whish_App/appWalletDrawer
    // in this action — the delta itself identifies the fee leg's method.
    expect(after.d.appWallet - before.d.appWallet).toBeCloseTo(5, 2);
    // Payout ($100, CASH fallback) debits the PCD, never General.
    expect(after.d.pcd - before.d.pcd).toBeCloseTo(-100, 2);
    expect(after.d.general - before.d.general).toBeCloseTo(0, 2);
    // supplier_ledger: -(x - f + c) = -(100 - 5 + 0.5) = -95.5.
    expect(after.o - before.o).toBeCloseTo(-95.5, 2);
  });

  test("(b) split fee CASH 2 + OMT-wallet 3 — both drawers move", async ({
    page,
  }) => {
    const headers = await auth(page);
    const supplierId = await omtSupplierId(page, headers);

    const before = { d: await drawers(page, headers), o: await owed(page, headers, supplierId) };

    // x=60, f=5 (2 CASH + 3 OMT-wallet), same INTRA fee → c = 0.5. Principal
    // deliberately differs from (a) so the two transactions' PCD deltas are
    // never numerically ambiguous with each other.
    const res = await (
      await page.request.post(`${BACKEND_URL}/api/services/transactions`, {
        headers,
        data: {
          provider: "OMT",
          serviceType: "RECEIVE",
          amount: 60,
          currency: "USD",
          omtServiceType: "INTRA",
          omtFee: 5,
          feePayments: [
            { method: "CASH", currencyCode: "USD", amount: 2 },
            { method: "OMT", currencyCode: "USD", amount: 3 },
          ],
        },
      })
    ).json();
    expect(res.success, JSON.stringify(res)).toBeTruthy();

    const after = { d: await drawers(page, headers), o: await owed(page, headers, supplierId) };

    // The CASH fee leg is cash-family on a primary-system RECEIVE → PCD, same
    // as the payout; net PCD delta = -60 (payout) + 2 (CASH fee share) = -58.
    expect(after.d.pcd - before.d.pcd).toBeCloseTo(-58, 2);
    // The OMT-wallet fee leg keeps its own drawer (OMT_App, part of
    // appWalletDrawer) — the ONLY thing moving it in this action.
    expect(after.d.appWallet - before.d.appWallet).toBeCloseTo(3, 2);
    expect(after.d.general - before.d.general).toBeCloseTo(0, 2);
    // supplier_ledger: -(60 - 5 + 0.5) = -55.5 (commission unaffected by the split).
    expect(after.o - before.o).toBeCloseTo(-55.5, 2);
  });

  test("(c) partnerId + feePayments is rejected — the partner handles the fee", async ({
    page,
  }) => {
    const headers = await auth(page);
    const supplierId = await omtSupplierId(page, headers);
    const before = { d: await drawers(page, headers), o: await owed(page, headers, supplierId) };

    const partner = await (
      await page.request.post(`${BACKEND_URL}/api/partners`, {
        headers,
        data: { name: `L017 Partner ${Date.now()}`, phone: "03999222" },
      })
    ).json();
    expect(partner.success, JSON.stringify(partner)).toBeTruthy();

    const res = await page.request.post(
      `${BACKEND_URL}/api/services/transactions`,
      {
        headers,
        data: {
          provider: "OMT",
          serviceType: "RECEIVE",
          amount: 40,
          currency: "USD",
          omtServiceType: "INTRA",
          omtFee: 3,
          partnerId: partner.data.id,
          partnerMode: "THROUGH",
          feePayments: [{ method: "CASH", currencyCode: "USD", amount: 3 }],
        },
      },
    );
    const body = await res.json();

    // DISCOVERED PARITY GAP (reported, not fixed — out of this phase's file
    // scope): this exact combination is ALSO rejected by a Zod `.refine` on
    // `createFinancialServiceSchema` (validators/financial.ts), and the
    // generic `validateRequest` Express middleware answers Zod refinement
    // failures with HTTP 400 and an OBJECT-shaped `error` ({code, message,
    // details, field}) — never reaching the repository's OWN "authoritative
    // enforcement layer" guard (§6bis), which would have answered HTTP 200
    // with a STRING `error`, matching rule 19c. Confirmed by direct
    // execution against this exact payload (see the file's PR notes). The
    // repository's guard is real and still fires for any caller that
    // bypasses `validateRequest` (e.g. a raw/scripted request, or the
    // Electron IPC path if its schema mirror ever drifts) — this assertion
    // matches CURRENT REST reality rather than the general rule-19c "never
    // assert 4xx" guidance, which holds for every OTHER business-rule
    // rejection in this file (see (e) below, which the repository itself
    // throws and which DOES answer 200).
    expect(res.status()).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error?.message ?? body.error).toContain(
      "feePayments cannot be used on a partner transaction",
    );

    const after = { d: await drawers(page, headers), o: await owed(page, headers, supplierId) };
    expect(after.d.pcd - before.d.pcd).toBeCloseTo(0, 2);
    expect(after.d.general - before.d.general).toBeCloseTo(0, 2);
    expect(after.d.appWallet - before.d.appWallet).toBeCloseTo(0, 2);
    expect(after.o - before.o).toBeCloseTo(0, 2);
  });

  test("(d) feePayments against a zero/omitted fee is rejected", async ({
    page,
  }) => {
    const headers = await auth(page);
    const supplierId = await omtSupplierId(page, headers);
    const before = { d: await drawers(page, headers), o: await owed(page, headers, supplierId) };

    const res = await page.request.post(
      `${BACKEND_URL}/api/services/transactions`,
      {
        headers,
        data: {
          provider: "OMT",
          serviceType: "RECEIVE",
          amount: 40,
          currency: "USD",
          omtServiceType: "INTRA",
          omtFee: 0,
          feePayments: [{ method: "CASH", currencyCode: "USD", amount: 3 }],
        },
      },
    );
    const body = await res.json();

    // Same discovered parity gap as (c) — caught by the Zod refine (400,
    // object error), never reaching the repository's own zero-fee guard.
    expect(res.status()).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error?.message ?? body.error).toContain(
      "feePayments requires a non-zero omtFee/whishFee",
    );

    const after = { d: await drawers(page, headers), o: await owed(page, headers, supplierId) };
    expect(after.d.pcd - before.d.pcd).toBeCloseTo(0, 2);
    expect(after.d.general - before.d.general).toBeCloseTo(0, 2);
    expect(after.d.appWallet - before.d.appWallet).toBeCloseTo(0, 2);
    expect(after.o - before.o).toBeCloseTo(0, 2);
  });

  test("(e) feePayments summing short of the fee hard-rejects with no rows written", async ({
    page,
  }) => {
    const headers = await auth(page);
    const supplierId = await omtSupplierId(page, headers);
    const before = { d: await drawers(page, headers), o: await owed(page, headers, supplierId) };

    // f=5 but only $2 of feePayments — this passes every Zod refine (partner
    // absent, fee > 0, RECEIVE, not fee-included) so it DOES reach the
    // repository's `reconcileLegs` hard-reject, which throws inside the same
    // db.transaction as every other write for this row — HTTP 200,
    // string `error`, atomic rollback (rule 19c holds here, unlike (c)/(d)).
    const res = await (
      await page.request.post(`${BACKEND_URL}/api/services/transactions`, {
        headers,
        data: {
          provider: "OMT",
          serviceType: "RECEIVE",
          amount: 40,
          currency: "USD",
          omtServiceType: "INTRA",
          omtFee: 5,
          feePayments: [{ method: "CASH", currencyCode: "USD", amount: 2 }],
        },
      })
    ).json();

    expect(res.success).toBe(false);
    expect(typeof res.error).toBe("string");
    expect(res.error as string).toContain("do not reconcile");

    const after = { d: await drawers(page, headers), o: await owed(page, headers, supplierId) };
    expect(after.d.pcd - before.d.pcd).toBeCloseTo(0, 2);
    expect(after.d.general - before.d.general).toBeCloseTo(0, 2);
    expect(after.d.appWallet - before.d.appWallet).toBeCloseTo(0, 2);
    expect(after.o - before.o).toBeCloseTo(0, 2);
  });
});
