/**
 * lira-web-017 — OMT system RECEIVE fee handling over REST, RE-DERIVED for
 * owner decision D1 (`docs/plans/todo_plans/OWNER_NOTES_2026-09-21.md` §2b,
 * case matrix row 1, migration v180).
 *
 * OLD rule (what this file used to guard): an OMT system RECEIVE could
 * collect its customer-facing fee via operator-chosen `feePayments[]` legs
 * (Phase A/A2), netting `f` out of what OMT owed (`-(x - f)`).
 *
 * NEW rule (D1, final): "OMT system RECEIVE — no fee is taken from the
 * customer; the fee is always shown (so the shop sees how it was calculated
 * and what the commission is) but never affects the drawer." Concretely,
 * `FinancialServiceRepository.createTransaction` now HARD-REJECTS an OMT
 * RECEIVE that carries `includingFees: true` or a non-empty `feePayments`,
 * before any other guard runs (checked immediately after `resolvedProviderFee`
 * resolves, ahead of every dispatch branch — walk-in, THROUGH-partner,
 * deferred). The rejection message is fixed (`OMT_RECEIVE_NO_FEE_MESSAGE`,
 * `packages/core/src/validators/financial.ts`):
 *
 *   "OMT RECEIVE never takes a fee from the customer — any provider fee is
 *    shown for the commission calculation only, never collected or
 *    deducted. Remove the fee amount, includingFees, and feePayments, then
 *    resubmit."
 *
 * Owner decision 2026-09-25: OMT_APP RECEIVE now hard-rejects with this SAME
 * message too (its fee travels in `commission`, not `omtFee`/`feePayments`)
 * — see FinancialServiceRepository.receiveFeeCutoverD1.test.ts and
 * FinancialServiceRepository.receiveFeeLegs.test.ts's block (o) for that
 * coverage; this file's own scope stays OMT-system-only.
 *
 * Because this guard checks ONLY `provider === "OMT" && serviceType ===
 * "RECEIVE"` plus the presence of `includingFees`/`feePayments` — it does not
 * care about the fee's magnitude, whether a partner is attached, or whether
 * the fee legs reconcile — every payload shape the OLD suite exercised
 * (single fee leg, split fee legs, a partner combo, a zero-fee combo, a
 * leg-sum mismatch) now hits this SAME guard, before it can ever reach the
 * sub-guard each old sub-test was originally targeting (the partner-specific
 * rejection, the zero-fee rejection, or the `reconcileLegs` sum-mismatch
 * hard-reject). Rule 24: each sub-test below is rewritten to assert the NEW
 * (D1) rejection it actually hits now, not the OLD one it used to hit — the
 * payload shapes are kept so the file still proves the guard is genuinely
 * blanket across all of them, not just one.
 *
 * Positive replacement (rule 24's "prove the opposite"): test (g) drives a
 * plain OMT RECEIVE with NO `feePayments`/`includingFees` — `omtFee` is
 * still sent (and still drives the commission ESTIMATE, per the Services
 * form's now-informational-only fee input) — and proves the fee never
 * touches a drawer: payout is the FULL principal `x` (not `x - f`), and OMT
 * is owed the full `x` (`grossOwedDelta`'s `RECEIVE_FEE_MODEL_CUTOVER`
 * branch — `packages/core/src/repositories/FinancialServiceRepository.ts`,
 * `grossOwedDelta`'s RECEIVE case — returns `-principal` unconditionally,
 * ignoring `fee` entirely, once a row is stamped CUTOVER, which every row
 * created from here on is).
 *
 * Whish/OMT App/Binance are UNTOUCHED by D1 (see the header of
 * lira-101-app-wallet-receive-fee-ui.spec.ts and lira-131-omt-fee-ui-driven
 * .spec.ts for those) — this file stays OMT-system-only, as it always was.
 *
 * Sibling to lira-web-016 (kept untouched — see the header note below) rather
 * than an in-place extension: `feePayments[]` is Phase A/A2 (landed), proven
 * here over `POST /api/services/transactions`, the SAME core path
 * (`FinancialServiceRepository.createTransaction`) the desktop IPC channel
 * and lira-web-016 already exercise. No REST route changes were needed for
 * D1 either — the guard lives in the repository, shared by both transports.
 *
 * Three quantities per transaction (docs/FEATURE_GUIDE.md §8.1, extended by
 * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §1.3/§1.4): x = principal, f = the
 * provider's customer-facing fee (omtFee), c = the shop's commission
 * (calculateCommission("INTRA", f) = f × 10% — packages/core/src/utils/
 * omtFees.ts). supplier_ledger books the GROSS `grossOwedDelta` shape for a
 * RECEIVE — as of D1 this is simply `-x`, the full principal, regardless of
 * `f` (was, pre-D1: `-(x - f)`, COMMISSION_AT_SETTLEMENT_PLAN.md §4 Phase 2).
 * The float drawer is the Primary Cash Drawer (PCD, `OMT_System` when OMT is
 * `shop_base_system`, migration v80's default) per PRIMARY_CASH_DRAWER_PLAN.md
 * (PR #68) — every cash-family leg of a primary-system RECEIVE lands there,
 * not General.
 *
 * NOTE on lira-web-016: that spec's own SEND/RECEIVE assertions predate the
 * PR #68 primary-cash-drawer rewrite and the later gross-supplier-ledger
 * model — running it standalone against the current tree fails on its own
 * baseline math. That drift is pre-existing and orthogonal to this feature;
 * going sibling avoids coupling this phase's green run to fixing an
 * unrelated, already-rotted spec. Reported to the orchestrator as a
 * discovered-but-not-fixed parity gap (unchanged by this D1 rewrite).
 *
 * Identity note (rule 15): there is no REST route that returns individual
 * `payments` leg rows (method/note) for a financial-services transaction —
 * `GET /api/services/history` returns only the `financial_services` row
 * itself. Per this phase's brief ("the REST surface needs no route
 * changes"), identity here is proven the same way lira-web-016 already does
 * it: each sub-test uses financially DISTINCT amounts and asserts the delta
 * on the ONE named drawer only that leg's method could have moved — nothing
 * else touches that key in the same narrow before/after window, so the
 * delta itself is the identity proof.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test.describe("OMT RECEIVE fee handling over REST — D1 (owner decision, 2026-09-23)", () => {
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

  // The single D1 rejection message every sub-test below now hits.
  const D1_REJECTION =
    "OMT RECEIVE never takes a fee from the customer";

  test("(a) fee-on-top RECEIVE with a single WHISH-wallet feePayments leg — D1 hard-rejects, nothing collected", async ({
    page,
  }) => {
    const headers = await auth(page);
    const supplierId = await omtSupplierId(page, headers);

    const before = {
      d: await drawers(page, headers),
      o: await owed(page, headers, supplierId),
    };

    // Same payload the OLD (pre-D1) rule accepted and collected a $5 fee
    // for via a Whish-wallet leg. D1 now refuses it outright.
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

    expect(res.success).toBe(false);
    expect(typeof res.error).toBe("string");
    expect(res.error as string).toContain(D1_REJECTION);

    const after = {
      d: await drawers(page, headers),
      o: await owed(page, headers, supplierId),
    };
    // Nothing written: no drawer moved, nothing owed changed.
    expect(after.d.appWallet - before.d.appWallet).toBeCloseTo(0, 2);
    expect(after.d.pcd - before.d.pcd).toBeCloseTo(0, 2);
    expect(after.d.general - before.d.general).toBeCloseTo(0, 2);
    expect(after.o - before.o).toBeCloseTo(0, 2);
  });

  test("(b) split fee CASH 2 + OMT-wallet 3 — also D1 hard-rejects, both drawers untouched", async ({
    page,
  }) => {
    const headers = await auth(page);
    const supplierId = await omtSupplierId(page, headers);

    const before = {
      d: await drawers(page, headers),
      o: await owed(page, headers, supplierId),
    };

    // x=60, f=5 (2 CASH + 3 OMT-wallet) — the split shape the OLD rule
    // routed through two different drawers. D1's guard doesn't care about
    // shape: any non-empty feePayments on an OMT RECEIVE is refused.
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

    expect(res.success).toBe(false);
    expect(typeof res.error).toBe("string");
    expect(res.error as string).toContain(D1_REJECTION);

    const after = {
      d: await drawers(page, headers),
      o: await owed(page, headers, supplierId),
    };
    expect(after.d.pcd - before.d.pcd).toBeCloseTo(0, 2);
    expect(after.d.appWallet - before.d.appWallet).toBeCloseTo(0, 2);
    expect(after.d.general - before.d.general).toBeCloseTo(0, 2);
    expect(after.o - before.o).toBeCloseTo(0, 2);
  });

  test("(c) includingFees: true alone (no feePayments) is ALSO D1 hard-rejected — there is no payout reduction to apply", async ({
    page,
  }) => {
    const headers = await auth(page);
    const supplierId = await omtSupplierId(page, headers);
    const before = {
      d: await drawers(page, headers),
      o: await owed(page, headers, supplierId),
    };

    // The D1 guard's OTHER trigger: `includingFees === true` with no
    // feePayments at all — the pre-D1 "fee deducted from payout" shape.
    const res = await page.request.post(
      `${BACKEND_URL}/api/services/transactions`,
      {
        headers,
        data: {
          provider: "OMT",
          serviceType: "RECEIVE",
          amount: 45,
          currency: "USD",
          omtServiceType: "INTRA",
          omtFee: 5,
          includingFees: true,
        },
      },
    );
    const body = await res.json();

    expect(res.status()).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toContain(D1_REJECTION);

    const after = {
      d: await drawers(page, headers),
      o: await owed(page, headers, supplierId),
    };
    expect(after.d.pcd - before.d.pcd).toBeCloseTo(0, 2);
    expect(after.d.general - before.d.general).toBeCloseTo(0, 2);
    expect(after.o - before.o).toBeCloseTo(0, 2);
  });

  test("(d) partnerId + feePayments — still rejected, now by the blanket D1 guard rather than the partner-specific rule", async ({
    page,
  }) => {
    const headers = await auth(page);
    const supplierId = await omtSupplierId(page, headers);
    const before = {
      d: await drawers(page, headers),
      o: await owed(page, headers, supplierId),
    };

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

    // OLD behaviour (pre-D1): this exact combination was rejected by the
    // PARTNER-specific guard ("feePayments cannot be used on a partner
    // transaction — the partner handles the fee"), reached only after the
    // OMT-RECEIVE-wide D1 check. D1's guard is checked EARLIER (right after
    // `resolvedProviderFee` resolves, before every dispatch branch including
    // the partner ones — FinancialServiceRepository.ts, D1 cutover comment)
    // and does not read `partnerId` at all, so it fires first now — the
    // outcome (rejected, zero side effects) is unchanged; only the message
    // and the guard layer that produced it are.
    expect(res.status()).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toContain(D1_REJECTION);

    const after = {
      d: await drawers(page, headers),
      o: await owed(page, headers, supplierId),
    };
    expect(after.d.pcd - before.d.pcd).toBeCloseTo(0, 2);
    expect(after.d.general - before.d.general).toBeCloseTo(0, 2);
    expect(after.d.appWallet - before.d.appWallet).toBeCloseTo(0, 2);
    expect(after.o - before.o).toBeCloseTo(0, 2);
  });

  test("(e) feePayments against a zero/omitted fee — still rejected, now by the blanket D1 guard (magnitude is irrelevant to it)", async ({
    page,
  }) => {
    const headers = await auth(page);
    const supplierId = await omtSupplierId(page, headers);
    const before = {
      d: await drawers(page, headers),
      o: await owed(page, headers, supplierId),
    };

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

    // OLD behaviour: rejected by "feePayments requires a fee-on-top RECEIVE
    // with a non-zero omtFee/whishFee" (a magnitude check). D1's guard is
    // checked before that one too and only asks "is feePayments non-empty
    // on an OMT RECEIVE?" — true here regardless of `omtFee`'s value — so
    // it fires first.
    expect(res.status()).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toContain(D1_REJECTION);

    const after = {
      d: await drawers(page, headers),
      o: await owed(page, headers, supplierId),
    };
    expect(after.d.pcd - before.d.pcd).toBeCloseTo(0, 2);
    expect(after.d.general - before.d.general).toBeCloseTo(0, 2);
    expect(after.o - before.o).toBeCloseTo(0, 2);
  });

  test("(f) feePayments summing short of the fee — still rejected by the blanket D1 guard, before the reconcile check is ever reached", async ({
    page,
  }) => {
    const headers = await auth(page);
    const supplierId = await omtSupplierId(page, headers);
    const before = {
      d: await drawers(page, headers),
      o: await owed(page, headers, supplierId),
    };

    // f=5 but only $2 of feePayments. OLD behaviour: this passed every
    // earlier guard and reached the repository's `reconcileLegs`
    // hard-reject ("... do not reconcile ..."), inside the same
    // db.transaction as every other write. D1's blanket guard now sits
    // BEFORE that reconcile check for an OMT RECEIVE specifically, so the
    // leg-sum mismatch is never even evaluated — this exact payload no
    // longer reaches `reconcileLegs` at all. (The reconcile guard itself
    // is unaffected and still reachable via a provider D1 doesn't touch —
    // see lira-101/lira-131 for Whish/App-wallet coverage.)
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
    expect(res.error as string).toContain(D1_REJECTION);

    const after = {
      d: await drawers(page, headers),
      o: await owed(page, headers, supplierId),
    };
    expect(after.d.pcd - before.d.pcd).toBeCloseTo(0, 2);
    expect(after.d.general - before.d.general).toBeCloseTo(0, 2);
    expect(after.o - before.o).toBeCloseTo(0, 2);
  });

  test("(g) plain OMT RECEIVE, no feePayments: fee is shown for the commission estimate only — payout is the FULL x, PCD −x, OMT owed the full x", async ({
    page,
  }) => {
    const headers = await auth(page);
    const supplierId = await omtSupplierId(page, headers);

    const before = {
      d: await drawers(page, headers),
      o: await owed(page, headers, supplierId),
    };

    // x=100, f=5 (omtFee) — sent purely for the commission ESTIMATE
    // (calculateCommission("INTRA", 5) = 0.5), never collected or deducted.
    // No `payments[]` sent — the RECEIVE payout falls back to the legacy
    // single-leg CASH debit (cashoutMethod defaults "CASH"), which a
    // primary-system RECEIVE routes to the PCD, not General.
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
        },
      })
    ).json();
    expect(res.success, JSON.stringify(res)).toBeTruthy();

    const after = {
      d: await drawers(page, headers),
      o: await owed(page, headers, supplierId),
    };

    // Full payout — never x-f. The fee never routes through any drawer
    // (D1 deletes the fee-on-top leg entirely for `provider === "OMT"`,
    // FinancialServiceRepository.ts's RECEIVE branch).
    expect(after.d.pcd - before.d.pcd).toBeCloseTo(-100, 2);
    expect(after.d.general - before.d.general).toBeCloseTo(0, 2);
    expect(after.d.appWallet - before.d.appWallet).toBeCloseTo(0, 2);
    // supplier_ledger: D1's `grossOwedDelta` RECEIVE branch under
    // RECEIVE_FEE_MODEL_CUTOVER returns `-principal` unconditionally — the
    // fee term never enters the formula at all, so OMT is owed the FULL
    // $100, not $95. (Pre-D1 Phase 2: -(x - f) = -(100 - 5) = -95.)
    expect(after.o - before.o).toBeCloseTo(-100, 2);
  });
});
