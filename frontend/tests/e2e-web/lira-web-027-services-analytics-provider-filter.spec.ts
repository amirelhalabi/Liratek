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
 * Provider choice: OMT and WHISH are both pre-seeded `service_providers`
 * rows (used throughout this suite, e.g. lira-web-016/017/019/020) so no
 * setup is needed. A plain `SEND` with `commission: 0` and no
 * `omtServiceType` avoids the OMT fee-table auto-commission lookup
 * (FinancialServiceRepository.ts ~line 1291) entirely — irrelevant here
 * anyway since every assertion below is on `count`, not `commission`,
 * because WHISH transactions are ALWAYS forced to `commission = 0`
 * (same file, "WHISH SYSTEM: No commission" branch) — commission deltas
 * would not distinguish the two providers, but `count` unconditionally
 * does (the repository's COUNT(*) has no `is_settled` gate, only the SUM
 * does).
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test("GET /api/services/analytics?providers=... filters count and byProvider to the requested provider(s), matching the desktop IPC handler", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  type Analytics = {
    today: {
      count: number;
      byProvider: Array<{ provider: string; currency: string; count: number }>;
    };
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
    a.today.byProvider
      .filter((p) => p.provider === "OMT")
      .reduce((s, p) => s + p.count, 0);
  const whishCountIn = (a: Analytics): number =>
    a.today.byProvider
      .filter((p) => p.provider === "WHISH")
      .reduce((s, p) => s + p.count, 0);

  // ── Snapshot BEFORE seeding, once per query shape under test ────────────
  const beforeOmtOnly = await getAnalytics(["OMT"]);
  const beforeWhishOnly = await getAnalytics(["WHISH"]);
  const beforeBoth = await getAnalytics(["OMT", "WHISH"]);

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

  const sendWhish = await (
    await page.request.post(`${BACKEND_URL}/api/services/transactions`, {
      headers: auth,
      data: {
        provider: "WHISH",
        serviceType: "SEND",
        amount: 22.5,
        currency: "USD",
        commission: 0,
        note: `${marker}-WHISH`,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 22.5 }],
      },
    })
  ).json();
  expect(sendWhish.success, JSON.stringify(sendWhish)).toBeTruthy();

  // ── Snapshot AFTER, same three query shapes ──────────────────────────────
  const afterOmtOnly = await getAnalytics(["OMT"]);
  const afterWhishOnly = await getAnalytics(["WHISH"]);
  const afterBoth = await getAnalytics(["OMT", "WHISH"]);

  // `?providers=OMT` — the top-level count moves by exactly 1 (the OMT SEND
  // just created), never 2: if the filter were a no-op (the pre-fix bug),
  // this would be 2, because the WHISH SEND created a moment earlier would
  // also be counted.
  expect(afterOmtOnly.today.count - beforeOmtOnly.today.count).toBe(1);
  // The `byProvider` breakdown — built by the SAME `provider IN (...)` SQL
  // fragment as the count above — must contain ONLY "OMT" rows: the WHISH
  // SEND created in this very test is provably absent from a request
  // filtered to OMT, not merely zero-valued.
  expect(
    afterOmtOnly.today.byProvider.every((p) => p.provider === "OMT"),
    JSON.stringify(afterOmtOnly.today.byProvider),
  ).toBe(true);
  expect(omtCountIn(afterOmtOnly) - omtCountIn(beforeOmtOnly)).toBe(1);

  // `?providers=WHISH` — symmetric check, other direction.
  expect(afterWhishOnly.today.count - beforeWhishOnly.today.count).toBe(1);
  expect(
    afterWhishOnly.today.byProvider.every((p) => p.provider === "WHISH"),
    JSON.stringify(afterWhishOnly.today.byProvider),
  ).toBe(true);
  expect(whishCountIn(afterWhishOnly) - whishCountIn(beforeWhishOnly)).toBe(1);

  // `?providers=OMT,WHISH` (the exact comma-joined shape
  // `frontend/src/api/backendApi.ts`'s `getOMTAnalytics` sends, and the
  // Services page's real call, `Services/index.tsx`) — both rows counted
  // together.
  expect(afterBoth.today.count - beforeBoth.today.count).toBe(2);
  expect(omtCountIn(afterBoth) - omtCountIn(beforeBoth)).toBe(1);
  expect(whishCountIn(afterBoth) - whishCountIn(beforeBoth)).toBe(1);
});
