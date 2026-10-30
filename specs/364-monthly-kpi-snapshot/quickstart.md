# Quickstart: validating the monthly KPI snapshot (LIRA-364)

Run tests one file at a time, by explicit path, and only with the owner's go-ahead (no full suites).

## 1. Capture rules (core jest)

`packages/core/src/services/__tests__/KpiSnapshotService.lira364.test.ts` on the real schema (`installWarrantyTestDb`). It must show:

- First run for a shop: sets the `kpi_snapshots_since` marker and saves nothing.
- With the marker at 2026-10 and "now" = 2026-11-01 00:30 Beirut, it saves `2026-10`. A second call saves nothing.
- Balance cases (spec scenarios 2 and 3): Ali owes $120 / 900,000 LBP; Rana has a $30 credit; a mixed-sign customer splits per currency.
- A supplier with an OMT account child counts once; a refunded supplier_ledger row is excluded; partner signs follow the Partners page; USDT is ignored.
- Stock value equals `getStockStats().stock_budget_usd`; carrier credits equal the MTC + Alfa `getCarrierCreditsSum`.
- 23:30 UTC on 31 October (= 01:30 Beirut, 1 November) already counts as November.
- A transaction saved in the new month before capture marks the snapshot late.

## 2. Pure split (core jest)

`packages/core/src/utils/__tests__/kpiSplit.test.ts`: sign split per currency and the epsilon.

## 3. Web sweep (backend jest)

`backend/src/services/__tests__/kpiSnapshotSweep.test.ts`: two tenants, each captured in its own context (verifies R9); one tenant throwing does not stop the other.

## 4. Read route (backend jest)

`backend/src/api/__tests__/kpi.lira364.api.test.ts`: admin gets snapshots newest first; staff gets 403; the envelope matches the contract.

## 5. Page (frontend jest)

`frontend/src/features/kpi/pages/MonthlyProgress/__tests__/MonthlyProgress.lira364.test.tsx`: months as columns, change vs previous month per currency, empty-state text, carrier row hidden with recharge off, "taken late" mark.

## 6. Web e2e

`frontend/tests/e2e-web/lira-web-0NN-monthly-progress.spec.ts`: seed two snapshots for the test tenant through the test fixture's database helper. There is no app channel to create one, by design. As admin, open Monthly progress and assert both months and one delta; as staff, assert the menu item is absent. Save the What's new screenshot.

## 7. Desktop

No Electron on this Mac. Desktop wiring (boot capture before handlers, standalone-only) is covered by an electron-app unit test of `kpiSnapshotTimer.ts` with mocked mode. Note it as not exercised end-to-end.

## Gates

`yarn typecheck`, `yarn lint`, `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`, `node scripts/build-release-notes.cjs --check`.
