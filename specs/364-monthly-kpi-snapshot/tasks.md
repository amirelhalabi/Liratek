# Tasks: Monthly KPI snapshot (LIRA-364)

**Input**: `specs/364-monthly-kpi-snapshot/` (plan.md, spec.md, research.md, data-model.md, contracts/kpi-snapshots.md, quickstart.md)

**Tests**: included. Project rule 17 requires guard tests written first and seen failing. Run tests one file at a time by explicit path, and only with the owner's go-ahead (never full suites).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 = automatic capture, US2 = Monthly progress page, US3 = phone-shop gating

---

## Phase 1: Setup

- [x] T001 Re-check the last migration version at the end of `packages/core/src/db/migrations/index.ts` (v227 when planned) and use the next number for this feature everywhere below (written as v228)

---

## Phase 2: Foundational (blocks all stories)

- [x] T002 [P] Create `packages/core/src/constants/kpiDefinitions.ts`: export `KPI_KEYS` (`customers_owe_shop`, `suppliers_owe_shop`, `partners_owe_shop`, `shop_owes_customers`, `shop_owes_suppliers`, `shop_owes_partners`, `stock_value`, `carrier_credits`), type `KpiKey`, and `KPI_DEFINITIONS` (key, `group: 'generic' | 'phone_shop'`, `requiresModule?: 'recharge'` only on `carrier_credits`, `order` 1–8 as in data-model.md). No imports except types (rule 29)
- [x] T003 [P] Write failing test `packages/core/src/utils/__tests__/kpiSplit.test.ts`: `splitBySign` puts positive amounts on the "owes" side and negative ones (as absolute values) on the other, per currency independently; |usd| < 0.005 and |lbp| < 0.5 count as zero; a mixed-sign counterparty ($50 owed, 450,000 LBP credit) lands on both sides. Run it and record the failure
- [x] T004 [P] Create `packages/core/src/utils/kpiSplit.ts` (`splitBySign(rows: {usd:number; lbp:number}[]) => { positive: {usd,lbp}; negative: {usd,lbp} }`, pure, no imports) and make T003 pass
- [x] T005 [P] Write failing test `packages/core/src/utils/__tests__/kpiMonth.test.ts`: `beirutMonth(new Date('2026-10-31T23:30:00Z'))` is `'2026-11'` (01:30 Beirut); `previousMonth('2026-01')` is `'2025-12'`; `beirutMonthStartUtc('2026-11')` is `'2026-10-31 22:00:00'` (Beirut UTC+2 in winter; also cover a summer month at UTC+3). Run it and record the failure
- [x] T006 [P] Create `packages/core/src/utils/kpiMonth.ts` with `beirutMonth`, `previousMonth`, `beirutMonthStartUtc`, using `Intl.DateTimeFormat` with `timeZone: SHOP_TIME_ZONE` imported from `utils/trialCalendar.ts` (never `process.env.TZ`, never the host day: rule 27); make T005 pass
- [x] T007 Add migration v228 to `packages/core/src/db/migrations/index.ts` AND the same tables to `electron-app/create_db.sql` (rule 10), with `down()` dropping both: `kpi_snapshots` (`id` PK, `tenant_id INTEGER NOT NULL REFERENCES tenants(id)`, `month TEXT NOT NULL` "YYYY-MM", `taken_at TEXT NOT NULL`, `is_late INTEGER NOT NULL DEFAULT 0 CHECK (is_late IN (0,1))`, `usd_lbp_buy_rate REAL NULL`, `usd_lbp_sell_rate REAL NULL`, `created_at`/`updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`, `UNIQUE (tenant_id, month)`) and `kpi_snapshot_values` (`id` PK, `tenant_id INTEGER NOT NULL REFERENCES tenants(id)`, `snapshot_id INTEGER NOT NULL REFERENCES kpi_snapshots(id) ON DELETE CASCADE`, `kpi_key TEXT NOT NULL`, `amount_usd REAL NOT NULL DEFAULT 0`, `amount_lbp REAL NOT NULL DEFAULT 0`, `created_at`/`updated_at`, `UNIQUE (snapshot_id, kpi_key)`); update `CLAUDE.md`'s "current migration version" line
- [x] T008 Add `kpi_snapshot_values` then `kpi_snapshots` to the table list of `TenantRepository.deleteTenantCascade` in `packages/core/src/repositories/TenantRepository.ts`
- [x] T009 Export `KPI_DEFINITIONS`, `KpiKey`, `KpiSnapshotView`, `splitBySign`, `beirutMonth` from `packages/core/src/browser.ts` and `packages/core/src/index.ts`; repository/service exports only from `index.ts` and `repositories/index.ts` / `services/index.ts`

**Checkpoint**: pure helpers green, schema in both files.

---

## Phase 3: User Story 1 — Month-end balances are saved automatically (P1) 🎯 MVP

**Goal**: every shop saves one snapshot per Beirut month of the eight KPIs, idempotently, starting after deploy.
**Independent test**: quickstart §1 and §3: known balances in → exact snapshot rows out, one per month.

### Tests (write first, see them fail)

- [x] T010 [US1] Write failing test `packages/core/src/services/__tests__/KpiSnapshotService.lira364.test.ts` on the real schema (`installWarrantyTestDb` + `initFixedTenantContext(1)`), covering every quickstart §1 bullet: first run sets marker `kpi_snapshots_since` and saves nothing; marker `2026-10` + now `2026-10-31T23:00:00Z` (01:00 on 1 Nov, Beirut) saves `2026-10` once, second call saves nothing; customers Ali (+$120, +900,000 LBP) / Rana (−$30) / mixed (+$50, −450,000 LBP) give `customers_owe_shop` $170 / 900,000 and `shop_owes_customers` $30 / 450,000; supplier sign (positive = shop owes) with an account parent + child counted once and a refunded supplier_ledger row excluded; partner sign (DEBIT − CREDIT positive = partner owes shop), USDT ignored; `stock_value` equals `getStockStats().stock_budget_usd`, LBP 0; `carrier_credits` equals MTC + Alfa `getCarrierCreditsSum`, LBP 0; a `transactions` row created after the new Beirut month started marks `is_late = 1`; buy/sell rate stored from `exchange_rates` USD→LBP. Run it and record the failures

### Implementation

- [x] T011 [P] [US1] Add `getClientBalances(): {client_id:number; usd:number; lbp:number}[]` to `packages/core/src/repositories/DebtRepository.ts` (per-client `SUM(amount_usd)`, `SUM(amount_lbp)` over `debt_ledger`, `tenant_id = ?`, same base as `getDebtSummary`)
- [x] T012 [P] [US1] Add `getCounterpartyBalances(): {usd:number; lbp:number}[]` to `packages/core/src/repositories/SupplierRepository.ts`, reusing the `_ledgerBalanceQuery` join and `ledgerNotRefunded` (rule 14; do not paste the predicate), grouped by `COALESCE(account_supplier_id, id)` so an account counts once, active and inactive suppliers, excluding the hidden secondary system via `_secondarySystemHideClause` (research R1)
- [x] T013 [US1] Create `packages/core/src/repositories/KpiSnapshotRepository.ts` (extends `BaseRepository`, singleton + reset): `getMarker()`/`setMarker(month)` on `system_settings` key `kpi_snapshots_since`; `exists(month)`; `hasTransactionsSince(utc)`; `getUsdLbpRates()`; `insertSnapshot({month, taken_at, is_late, buy, sell, values})` in ONE transaction using `INSERT … ON CONFLICT (tenant_id, month) DO NOTHING` and skipping values when nothing was inserted; `listSnapshots()` newest month first, values grouped per snapshot. Every query carries `tenant_id = ?`
- [x] T014 [US1] Create `packages/core/src/services/KpiSnapshotService.ts` (repositories injected; no SQL: rule 13): `captureDue(now: Date)` returns `{captured, reason}` per contracts/kpi-snapshots.md. Marker first run → `marker_set`; target = `previousMonth(beirutMonth(now))`; skip if target < marker (`not_due`) or exists (`exists`); else gather the five sources (T011, T012, `PartnerRepository.getAllBalances(true)` usd/lbp only, `ProductRepository.getStockStats`, `CarrierLineRepository.getCarrierCreditsSum('MTC'|'Alfa')`), split with `splitBySign` (customers/partners: positive = they owe shop; suppliers: positive = shop owes), compute `is_late` via `hasTransactionsSince(beirutMonthStartUtc(currentMonth))`, insert. Also `listSnapshots(): KpiSnapshotView[]`. Module logger
- [x] T015 [US1] Make T010 pass; then run the neighbouring tests that read the touched repositories by explicit path (DebtRepository and SupplierRepository balance tests)
- [x] T016 [P] [US1] Write failing test `backend/src/services/__tests__/kpiSnapshotSweep.test.ts`: with two tenants, `runSweepOnce(now)` calls `captureDue` once per tenant inside `runWithTenant(id, …)`, and a throw for the first does not stop the second (FR-009). Also verifies research R9 (each tenant's rows land in its own context)
- [x] T017 [US1] Create `backend/src/services/kpiSnapshotSweep.ts` modelled on `lapseSweep.ts` (boot run + hourly `setInterval`, `unref`, `stop…` for tests), iterating `TenantRepository.listAllRows()` under `runWithoutTenant` and capturing each under `runWithTenant` with its own try/catch + `logger.error`; start it in `backend/src/server.ts` next to `startLapseSweep()`; make T016 pass
- [x] T018 [P] [US1] Write test `electron-app/__tests__/kpiSnapshotTimer.test.ts`: in standalone mode `startKpiSnapshotTimer` calls `captureDue` immediately and schedules hourly; in paired mode it does nothing
- [x] T019 [US1] Create `electron-app/kpiSnapshotTimer.ts` and call it in `electron-app/main.ts` right after `initializeBackend()` and BEFORE the IPC handler registrations, only when `offlineBoot.decision.mode === "standalone"` (FR-007, R4); make T018 pass. Note in the sprint ticket: not exercised in a running Electron app (no Electron on this Mac)

### Per-shop switch (owner decision 2026-10-30, added mid-build)

- [x] T019a [US1] Opt-in feature list `tenant_subscriptions.enabled_features` (v228; NULL = none, fails closed) + `OPT_IN_FEATURES` in `constants/subscription.ts`; `SubscriptionService.isFeatureEnabled` / `setEnabledFeatures`; `captureDue` returns `disabled` while off (`SubscriptionService.lira364Features.test.ts`, `KpiSnapshotService.lira364.test.ts`)
- [x] T019b [US1] Super admin route `PUT /api/admin/subscriptions/:tenantId/features` with `setEnabledFeaturesSchema` (own validated route, LIRA-332 R10) + audit row; list rows carry `enabledFeatures` (`admin.lira364Features.api.test.ts`)
- [x] T019c [US1] Desktop licence sync stores `enabledFeatures` (`licenseSync.lira364Features.test.ts`); `/by-key` shape pinned with the new key
- [x] T019d [US1] Plan window → Features section with its own Save (`PlanModal.lira364Features.test.tsx`)
- [ ] T019e [US2] Page/menu/read route also refuse while the switch is off (with T022–T028)

**Checkpoint**: snapshots are saved on both transports for switched-on shops; nothing is visible to the shop yet. This alone must ship first (missed months are unrecoverable).

---

## Phase 4: User Story 2 — Monthly progress page (P1)

**Goal**: admins see every saved month, with the change from the previous month, per currency.
**Independent test**: quickstart §4–§6.

### Tests (write first, see them fail)

- [ ] T020 [P] [US2] Write failing test `backend/src/api/__tests__/kpi.lira364.api.test.ts` (harness from `suppliers.lira362Archive.api.test.ts`): `GET /api/kpi/snapshots` as admin returns `{ success: true, snapshots }` from `KpiSnapshotService.listSnapshots` (spied); staff gets 403 and the service is not called; a thrown error returns HTTP 500 `{ success:false }` like sibling routes
- [ ] T021 [P] [US2] Write failing test `frontend/src/features/kpi/pages/MonthlyProgress/__tests__/MonthlyProgress.lira364.test.tsx` (module-level stable `useApi` mock, rule 25): two months render as columns newest first; stock value $9,500 vs $8,000 shows "+$1,500"; USD and LBP on separate lines; a missing KPI key shows "not recorded"; `is_late` shows the "taken late" mark; zero snapshots show the "first snapshot at the end of this month" text

### Implementation

- [ ] T022 [P] [US2] Create `electron-app/handlers/kpiHandlers.ts` with `kpi:list-snapshots` (`requireRole(e.sender.id, ["admin"])`, try/catch, returns `{ success: true, snapshots }`), register it in `electron-app/main.ts`; add `kpi.listSnapshots` to `electron-app/preload.ts` and `frontend/src/types/electron.d.ts`
- [ ] T023 [P] [US2] Add `"kpi:list-snapshots"` to the read list in `packages/core/src/offline/channelPolicy.ts` and bump `read` + `total` in `electron-app/offline/__tests__/channelPolicy.complete.test.ts` with a LIRA-364 comment
- [ ] T024 [P] [US2] Create `backend/src/api/kpi.ts` (`authenticateJWT` → `requireRole(["admin"])`, IPC-identical envelope) and mount it at `/api/kpi` in `backend/src/server.ts`; make T020 pass
- [ ] T025 [US2] Add `getKpiSnapshots()` to `frontend/src/api/backendApi.ts` (`ipcOrHttp`), `frontend/src/api/ElectronApiAdapter.ts` and `ApiAdapter` in `packages/ui/src/api/types.ts`, typed with core's `KpiSnapshotView` (rule 21)
- [ ] T026 [US2] Create `frontend/src/features/kpi/hooks/useKpiSnapshots.ts` (TanStack `useQuery`, key `["kpi-snapshots"]`)
- [ ] T027 [US2] Create `frontend/src/features/kpi/pages/MonthlyProgress/index.tsx` (default export): rows from `KPI_DEFINITIONS` order, months as columns newest first, each cell USD and LBP on separate lines (never combined: FR-003) with the delta vs the next-older saved month per currency, rate under each month heading, "taken late" mark, empty state; make T021 pass
- [ ] T028 [US2] Add route `/monthly-progress` under `AdminRoute` (lazy) in `frontend/src/app/App.tsx` and an admin-only sidebar item next to Checkpoint timeline / Profits
- [ ] T029 [P] [US2] Create `packages/ui/src/i18n/locales/en/kpi.json` and `ar/kpi.json` (page title, KPI names per key, "not recorded", "taken late", empty state, rate label) and register the namespace wherever namespaces are listed

**Checkpoint**: an admin sees saved months on desktop and web; staff cannot.

---

## Phase 5: User Story 3 — Phone-shop gating (P3)

**Goal**: carrier credits are hidden for a shop without the recharge module, but still saved.
**Independent test**: page test with recharge off.

- [ ] T030 [US3] Extend `MonthlyProgress.lira364.test.tsx` with failing cases: recharge module off hides the `carrier_credits` row; on shows it with saved values (FR-013)
- [ ] T031 [US3] In `MonthlyProgress/index.tsx`, filter rows whose `requiresModule` is disabled, using `ModuleContext` (`frontend/src/contexts/ModuleContext.tsx`); make T030 pass

---

## Phase 6: Polish & cross-cutting

- [ ] T032 [P] Web e2e `frontend/tests/e2e-web/lira-web-0NN-monthly-progress.spec.ts` (next free number): seed two snapshots for the test tenant via the fixture's DB helper (there is no app channel by design), assert both months and one delta as admin, assert the menu item is absent for staff, save landscape screenshot `frontend/public/whats-new/<next version>/monthly-progress.png`. Ask the owner before running
- [ ] T033 Release note in `docs/release-notes/UNRELEASED.md`: a `### Monthly progress` card under `## ✨ Highlights` with the screenshot, plus a bullet; run `node scripts/build-release-notes.cjs --check` (rule 30)
- [ ] T034 Update the LIRA-364 ticket in `current_sprint.md` (built, tests with failing-first status, desktop not run, "What users will notice")
- [ ] T035 Gates: `yarn typecheck`, `yarn lint`, `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`, `yarn check:transport-parity`; confirm the elapsed time shows they ran (rule 28)

---

## Dependencies & execution order

- Phase 1 → Phase 2 → US1 → US2 → US3 → Polish.
- **US1 must ship before anything else.** Every month without capture is lost; the page can follow later.
- US2 needs US1's service (`listSnapshots`) and tables; it does not need the sweeps.
- US3 only touches the page (needs T027).
- Within a story: failing test → repository → service → transport → UI.

## Parallel opportunities

- Phase 2: T002, T003/T004, T005/T006 are independent files.
- US1: T011 and T012 in parallel; T016/T017 (backend) and T018/T019 (electron) in parallel once T014 exists.
- US2: T020/T024 (backend), T022/T023 (electron/policy), T029 (i18n) in parallel; T025→T026→T027→T028 in sequence.

## Implementation strategy

1. **MVP = Phase 1–3 (US1).** Deploy as soon as it is green, so the first real snapshot is taken at the next month end. Its start marker is set on the first sweep.
2. Then US2 (the page) and US3, then polish (e2e, What's new card).
3. Commit per phase, only on the owner's go.
