# Local Business Day (Beirut) — align "today"/date-range to local, not UTC

## Problem

The app's "day" is computed inconsistently:

- **Already local** (majority/correct convention): `SalesRepository`, `FinancialServiceRepository`,
  `CustomerSessionRepository`, `CustomServiceRepository` use
  `DATE(created_at, 'localtime') = DATE('now', 'localtime')`.
- **UTC outliers** (the bug): `ClosingRepository`, `ProfitRepository`/`ProfitService`,
  `backend/api/profits.ts`, `VoucherRepository`, `LotoService`, `Dashboard` month slice, and
  the frontend "today" defaults (`DateRangeFilter.todayISO/daysAgoISO`, expense/loto/checkpoint
  prefills, `CheckpointTimeline.todayISO`, `CashReportModal`) all compute the day via
  `new Date().toISOString().split("T")[0]` (UTC) and filter with UTC-window comparisons.

Effect in Beirut (UTC+3): the day rolls at 03:00 local. Records made 00:00–03:00 local file
under the previous day; "today's stats"/dashboard/monthly-P&L/profits-range bucket by UTC.

Decision (user, 2026-07-11): fix to Beirut local. Implementation = align outliers to the
existing `'localtime'` convention. This implements **machine-local**, which _equals_ Beirut on
the reported platform (desktop) — not a hardcoded Beirut offset (so DST is handled by the OS).

### Web / multi-tenant caveat (advisor #2 — must be acted on for web mode)

`'now','localtime'` / `datetime(col,'localtime')` follow the **machine's** TZ:

- **Desktop (Electron):** machine = the shop's PC = Beirut → fixes the reported bug. ✓
- **Web backend:** follows the **server's** TZ. The backend currently pins **no TZ** (verified —
  no `TZ` in `backend/.env*`, Dockerfile, or code). So on web the server buckets by its own TZ
  (UTC in a default container) while the frontend defaults to browser-local (Beirut) → a NEW
  frontend-vs-backend mismatch for from/to-param queries where today it's consistently UTC.
  **Resolution (not per-tenant TZ — out of scope):** deploy the backend with `TZ=Asia/Beirut`
  (compose/env). Until the server TZ is pinned, web-mode reporting is NOT correct. Verify probe:
  `SELECT strftime('%s','now') - strftime('%s','now','localtime');` must be non-zero on the server.
- Historical rows stamped UTC-day before this change shift slightly on boundary hours — negligible,
  no migration.

## Changes

### A. Shared local-day helpers (define once per runtime layer — rule 14)

- `packages/core/src/utils/localDate.ts`: `localDay(d=new Date())` → local `YYYY-MM-DD`,
  `localMonth()` → `YYYY-MM`, `localDaysAgo(n)`. Use local getters, NOT `toISOString`.
- `packages/ui` `DateRangeFilter.tsx`: fix `todayISO()`/`daysAgoISO()` to use local getters
  (comment already claims "local time"). This is the shared FE default used by Profits etc.
- `frontend/src/shared/utils/localDay.ts`: `localDay`/`localMonth` for FE spots not using
  the DateRangeFilter helpers (Dashboard month, prefills, CheckpointTimeline, CashReportModal).

### B. Core SQL: UTC → localtime (align to SalesRepository)

- `ClosingRepository.getDailyStatsSnapshot`: drop JS `today`; `DATE(col,'localtime') =
DATE('now','localtime')` for created_at cols; `expense_date = DATE('now','localtime')`
  (date-only col — no `'localtime'` on the column).
- `ClosingRepository.hasOpeningBalanceToday`: `closing_date = DATE('now','localtime')`.
- `ClosingRepository.getCheckpointTimeline`: default from/to → `localDay()`.
- `ClosingRepository.createCheckpoint`: `closing_date` → `localDay()`.
- `ClosingService` (231/266): default closingDate → `localDay()`.
- `ProfitRepository.dateRange(col)`: `col >= ? AND col <= ?` →
  `datetime(${col},'localtime') >= ? AND datetime(${col},'localtime') <= ?`
  (ProfitService keeps building `"${from} 00:00:00".."${to} 23:59:59"`, already-padded; the
  change ONLY shifts the window from UTC wall-clock to local wall-clock — no other behavior
  change). Daily-bucketing `DATE(x.created_at)` (SELECT + GROUP BY) → `DATE(x.created_at,'localtime')`.
  Note: `datetime(col,'localtime') >= ?` is non-sargable (defeats a `created_at` index) — same
  cost the existing localtime queries already pay; acceptable, flagged for large tables.
- `backend/api/profits.ts` `todayISO`/`daysAgoISO` → local.
- `VoucherRepository` (102 JS compare, 242) → `localDay()` / inline `DATE('now','localtime')`.
- `LotoService` date-only defaults (152 sale_date, 915/925 checkpoint range, 969 prize_date)
  → `localDay()`. (Timestamp `toISOString()` defaults for settled_at/paid_date/recorded_date
  stay — storing a UTC instant in a timestamp column is correct.)

### C. Frontend "today" defaults → local

Dashboard month (342/354); expense (54/110), loto (219/309), Checkpoint (225),
CheckpointScheduler (76/78) prefills; `CheckpointTimeline.todayISO` (40); `CashReportModal`
(53/57).

### Leave

- `new Date().toISOString()` storing a "now" instant into a timestamp column (correct).
- `ReportingService.getDateRange` (date-only→date-only; latent negative-offset-only edge, not Beirut).
- Class A display fixes (already done) and date-only display (Class B).

## Tests (rule 17 — must fail on the UTC version)

Core jest with `process.env.TZ='Asia/Beirut'`: insert a row whose `created_at` UTC-day ≠
local-day (e.g. UTC `2026-07-10 23:30:00` = Beirut `2026-07-11 02:30`); assert
`getDailyStatsSnapshot` and `ProfitRepository` bucket it under the LOCAL day. Prove each fails
before the SQL change, passes after.

## Verify

`cd packages/core && npm run build` + sync; `yarn typecheck`; `yarn lint`; core jest (Node ABI,
TZ=Asia/Beirut) then restore Electron ABI; frontend tests; the two timezone e2e specs.

## Status — DONE (2026-07-11)

- Helpers: `packages/core/src/utils/localDate.ts`, `frontend/src/shared/utils/localDay.ts`,
  `DateRangeFilter.todayISO/daysAgoISO` now local.
- Core SQL: ClosingRepository (`todayLocal` helper + createCheckpoint/hasOpeningBalanceToday/
  getCheckpointTimeline), ProfitRepository (`dateRange` + 20 daily-bucket `DATE(...,'localtime')`),
  ClosingService, VoucherRepository, LotoService, backend/profits.ts.
- Frontend defaults: Dashboard month, expenses/loto/checkpoint prefills, CheckpointTimeline,
  CashReportModal, SettlementVerification (incl. the extra 617-line site).
- Also fixed (advisor): `FinancialRepository.getMonthlyPL` — 3 `strftime('%Y-%m', col)` sites →
  `strftime('%Y-%m', col, 'localtime')`. Dashboard now sends `localMonth()`; without this the
  frontend(local)-vs-backend(UTC) month param would mismatch at every month boundary.
- TZ pinning: `'localtime'` reads the C-runtime zone at process launch, NOT via a mid-run
  `process.env.TZ` write — a jest `setupFiles` pin was tried and PROVEN ineffective (probe still
  saw offset 0 under a UTC launcher). Fix: core `test` script runs under
  `cross-env TZ=Asia/Beirut` (cross-platform; bare `cross-env`/`TZ=… ` shell forms don't work in
  the workspace-script context / Windows cmd — referenced by explicit node path). Proven: with
  ambient `TZ=UTC`, the script still pins Beirut and the probe passes.
- Tests (rule 17 — proven FAIL on pre-fix, pass after; reverted via git diff):
  `ClosingRepository.localBusinessDay.test.ts` (todayLocal helper) and
  `ProfitRepository.localBusinessDay.test.ts` (dateRange). Both carry a beforeAll offset≠0 probe.
  Updated `pending_profit` SQL-string assertion to `datetime(s.created_at,'localtime')`.
- Green: core 593/593 (via cross-env script); backend 444 pass — 2 PRE-EXISTING failures
  unrelated to dates (`SalesService.test.ts` mock-payload shape + `wp5_wp6_admin_tenant.api.test.ts`
  config-table counts, both fail on pristine HEAD) + `rateLimit.test.ts` (flaky under parallelism,
  passes 10/10 alone); frontend typecheck 0 errors, lint 0 errors, 321 tests pass.
- NOT done here (needs ops): pin `TZ=Asia/Beirut` on the web backend deployment, or web-mode
  reporting follows the server TZ (see Web caveat above). Desktop is correct as-is.
- Leftover latent (out of scope): `ReportingService.getDateRange` negative-offset edge;
  `logger.ts` log-filename UTC day.
- E2E (Playwright/Electron): `lira-100-checkpoint-timeline-timezone` (display), plus
  `lira-102-business-day-monthly` (getMonthlyPL local month) and `lira-103-business-day-today`
  (getDailyStatsSnapshot local "today") — both backdate an OMT commission via `transaction_time`
  to a day/month boundary and assert it buckets by the LOCAL day via delta assertions (rule 15),
  reading the flow's actual computed commission back through `omt.getById`. All 3 green together.
  Run flow gotcha: keep `yarn dev` running and let Playwright reuse the live vite
  (`reuseExistingServer`) — stopping it makes the test:e2e webServer re-run `npm run dev` and
  rewrite `electron-app/dist` mid-launch (window-timeout race). Specs inherit the suite's
  `retries: 2` (safe: delta-based, no marker double-count).
