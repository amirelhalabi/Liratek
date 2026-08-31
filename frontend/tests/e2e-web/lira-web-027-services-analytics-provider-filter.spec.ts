/**
 * lira-web-027 — `GET /api/services/analytics?providers=...` provider filter
 * parity (LIRA-158 Phase 5a / owner decision D16).
 *
 * The bug: the desktop IPC handler (`omt:get-analytics`,
 * electron-app/handlers/omtHandlers.ts) forwards its optional
 * `providers?: string[]` straight through to
 * `FinancialService.getAnalytics(providers?)`
 * (packages/core/src/services/FinancialService.ts →
 * FinancialServiceRepository.ts's `getAnalytics`), which restricts every
 * COUNT/SUM in the response to `provider IN (...)` when given a list. The
 * REST route (`backend/src/api/services.ts`) used to declare its handler
 * `(_req, res)` — the underscore proves the query was never read — and
 * always called `getAnalytics()` with no argument, so the SAME user action
 * (the Services page's `getOMTAnalytics(["OMT","WHISH"])` call, or the
 * Recharge page's `getOMTAnalytics([activeProvider])`,
 * frontend/src/api/backendApi.ts) returned provider-FILTERED analytics on
 * desktop and UNFILTERED analytics on web — a rule-19 dual-transport gap,
 * live before this fix.
 *
 * This spec proves the REST route now honours the filter, over the real
 * HTTP route (no `window.api`/IPC — this suite is REST-only, see README).
 * It does not merely check that a differently-shaped response comes back
 * for two different query strings (that would pass even with an off-by-one
 * or backwards filter) — it seeds one distinguishable row per provider and
 * shows that requesting one provider's analytics both (a) counts exactly
 * that provider's new row and no more, and (b) the `byProvider` breakdown
 * — which the repository builds with the SAME `provider IN (...)` SQL
 * fragment as the top-level totals — contains ONLY that provider, even
 * though the other provider's row was created moments earlier in the very
 * same test run and would appear in an unfiltered request.
 *
 * Rule 15 (shared, accumulating e2e DB): every assertion is a delta
 * snapshotted immediately before/after the two seeded transactions, on a
 * per-provider-filtered request — never an absolute count or "the newest
 * row". `byProvider` is grouped `(provider, currency)` for TODAY only
 * (FinancialServiceRepository.getAnalytics), so a prior spec's same-day OMT
 * or WHISH rows are already baked into the "before" snapshot on both sides
 * of the delta and cancel out.
 *
 * Provider choice: OMT + WHISH (both `is_system_provider` SYSTEM rows) does
 * NOT work here. `FinancialServiceRepository.createTransaction` treats OMT
 * and WHISH as a primary/secondary pair gated by `system_settings.
 * shop_base_system` (this env's tenant has it set to "OMT" — verified by
 * the exact rejection this spec used to hit): a walk-in (no `partnerId`)
 * against whichever of the two is NOT the base system is hard-rejected —
 * "WHISH is the secondary system (shop base system is OMT) — a walk-in
 * transaction cannot be booked directly against it; route it through a
 * partner (set partnerId)" — because that provider's obligation belongs in
 * `partner_ledger`, not a direct supplier debt (same file, ~line 1207's
 * comment). Routing through a partner would drag partner-settlement gating
 * into a spec that is only trying to prove a query-string filter, so this
 * spec avoids the SYSTEM pair entirely.
 *
 * Instead it uses OMT (base system — walk-in already proven fine, no
 * partner needed) + OMT_APP, a wallet provider
 * (`service_providers.is_system_provider = 0`). The primary/secondary guard
 * above is written to check ONLY `provider === "OMT" || provider ===
 * "WHISH"` (FinancialServiceRepository.ts's `skipSecondarySupplierLedger`/
 * walk-in-rejection checks) — OMT_APP, WHISH_APP, and BINANCE are
 * explicitly exempted by that same code's own comment ("OMT_App / Whish_App
 * / Binance FOR-partner are untouched: those wallets hold money the shop
 * genuinely owns, whichever system is primary") — so OMT_APP is always a
 * valid walk-in regardless of `shop_base_system`, making this pairing
 * robust even if that tenant setting ever changes. It is already exercised
 * as a plain walk-in SEND (no `omtServiceType`, no `checkoutTotal`, a
 * single CASH leg) by packages/core's own suite, e.g.
 * FinancialServiceRepository.appWalletTransfer.test.ts's "OMT_APP SEND: app
 * drawer −20, General +20" and crossCurrencyTender.test.ts's OMT_APP SEND
 * cases. A plain `SEND` with `commission: 0` keeps this test's assertions
 * (all on `count`, never `commission`) provider-symmetric — the repository
 * COUNT(*) has no `is_settled` gate, only the SUM does.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test("GET /api/services/analytics?providers=... filters count and byProvider to the requested provider(s), matching the desktop IPC handler", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  // NOTE: `byProvider` is a TOP-LEVEL sibling of `today`/`month`
  // (FinancialServiceRepository.getAnalytics's return shape:
  // `{ today: {...}, month: {...}, byProvider }`), not nested under
  // `today` — an earlier draft of this spec nested it under `today` and the
  // resulting `undefined.every(...)` TypeError never surfaced because the
  // seeding call above it threw first (the invalid-provider bug this spec
  // was written to fix); fixed here now that seeding succeeds.
  type Analytics = {
    today: {
      count: number;
    };
    byProvider: Array<{ provider: string; currency: string; count: number }>;
  };

  const getAnalytics = async (
    providers?: string[],
  ): Promise<Analytics> => {
    const qs = providers ? `?providers=${providers.join(",")}` : "";
    const r = await (
      await page.request.get(`${BACKEND_URL}/api/services/analytics${qs}`, {
        headers: auth,
      })
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.analytics as Analytics;
  };

  const omtCountIn = (a: Analytics): number =>
    a.byProvider
      .filter((p) => p.provider === "OMT")
      .reduce((s, p) => s + p.count, 0);
  const omtAppCountIn = (a: Analytics): number =>
    a.byProvider
      .filter((p) => p.provider === "OMT_APP")
      .reduce((s, p) => s + p.count, 0);

  // ── Snapshot BEFORE seeding, once per query shape under test ────────────
  const beforeOmtOnly = await getAnalytics(["OMT"]);
  const beforeOmtAppOnly = await getAnalytics(["OMT_APP"]);
  const beforeBoth = await getAnalytics(["OMT", "OMT_APP"]);

  // ── Seed one distinguishable SEND per provider ──────────────────────────
  const marker = `LIRA158-${Date.now()}`;
  const sendOmt = await (
    await page.request.post(`${BACKEND_URL}/api/services/transactions`, {
      headers: auth,
      data: {
        provider: "OMT",
        serviceType: "SEND",
        amount: 17.25,
        currency: "USD",
        commission: 0,
        note: `${marker}-OMT`,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 17.25 }],
      },
    })
  ).json();
  expect(sendOmt.success, JSON.stringify(sendOmt)).toBeTruthy();

  const sendOmtApp = await (
    await page.request.post(`${BACKEND_URL}/api/services/transactions`, {
      headers: auth,
      data: {
        provider: "OMT_APP",
        serviceType: "SEND",
        amount: 22.5,
        currency: "USD",
        commission: 0,
        note: `${marker}-OMT_APP`,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 22.5 }],
      },
    })
  ).json();
  expect(sendOmtApp.success, JSON.stringify(sendOmtApp)).toBeTruthy();

  // ── Snapshot AFTER, same three query shapes ──────────────────────────────
  const afterOmtOnly = await getAnalytics(["OMT"]);
  const afterOmtAppOnly = await getAnalytics(["OMT_APP"]);
  const afterBoth = await getAnalytics(["OMT", "OMT_APP"]);

  // `?providers=OMT` — the top-level count moves by exactly 1 (the OMT SEND
  // just created), never 2: if the filter were a no-op (the pre-fix bug),
  // this would be 2, because the OMT_APP SEND created a moment earlier would
  // also be counted.
  expect(afterOmtOnly.today.count - beforeOmtOnly.today.count).toBe(1);
  // The `byProvider` breakdown — built by the SAME `provider IN (...)` SQL
  // fragment as the count above — must contain ONLY "OMT" rows: the OMT_APP
  // SEND created in this very test is provably absent from a request
  // filtered to OMT, not merely zero-valued.
  expect(
    afterOmtOnly.byProvider.every((p) => p.provider === "OMT"),
    JSON.stringify(afterOmtOnly.byProvider),
  ).toBe(true);
  expect(omtCountIn(afterOmtOnly) - omtCountIn(beforeOmtOnly)).toBe(1);

  // `?providers=OMT_APP` — symmetric check, other direction.
  expect(afterOmtAppOnly.today.count - beforeOmtAppOnly.today.count).toBe(1);
  expect(
    afterOmtAppOnly.byProvider.every((p) => p.provider === "OMT_APP"),
    JSON.stringify(afterOmtAppOnly.byProvider),
  ).toBe(true);
  expect(
    omtAppCountIn(afterOmtAppOnly) - omtAppCountIn(beforeOmtAppOnly),
  ).toBe(1);

  // `?providers=OMT,OMT_APP` (the exact comma-joined shape
  // `frontend/src/api/backendApi.ts`'s `getOMTAnalytics` sends, and the
  // Services page's real call, `Services/index.tsx`) — both rows counted
  // together.
  expect(afterBoth.today.count - beforeBoth.today.count).toBe(2);
  expect(omtCountIn(afterBoth) - omtCountIn(beforeBoth)).toBe(1);
  expect(omtAppCountIn(afterBoth) - omtAppCountIn(beforeBoth)).toBe(1);
});
