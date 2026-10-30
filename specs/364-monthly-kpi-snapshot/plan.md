# Implementation Plan: Monthly KPI snapshot

**Branch**: `364-monthly-kpi-snapshot` (work on `main`; ticket LIRA-364) | **Date**: 2026-10-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/364-monthly-kpi-snapshot/spec.md`

## Summary

Every shop automatically saves, once per Beirut calendar month, eight month-end balances in USD and LBP: the six owes directions between the shop and its customers, suppliers and partners, plus stock value and carrier credits. Admins read them on a new "Monthly progress" page. Each figure reuses the app's existing balance definition (rule 14), split per counterparty and per currency by one pure function. Web shops are captured by an hourly, idempotent server sweep (the `lapseSweep.ts` pattern); desktop shops at boot, before handlers register. Storage is a header table plus a key-value table, so new KPIs need no migration.

## Technical Context

**Language/Version**: TypeScript (strict), Node 20 / Electron 31, React 19

**Primary Dependencies**: `@liratek/core` repositories/services, Express (backend), TanStack Query (frontend), zod (no write schema needed; read only)

**Storage**: SQLite (SQLCipher on desktop; per-tenant files on web), migration v228: `kpi_snapshots`, `kpi_snapshot_values`, plus the `system_settings` key `kpi_snapshots_since`

**Testing**: core/backend/frontend jest (explicit paths only), web Playwright e2e; no Electron run on this Mac

**Target Platform**: Electron desktop (standalone) + Fly web backend + Vercel SPA

**Project Type**: monorepo desktop + web app

**Performance Goals**: capture < 1 s per shop (eight aggregate queries); page renders 12+ months < 3 s (SC-003)

**Constraints**: Beirut month boundaries independent of server TZ (rule 27); browser-safe KPI definitions (rule 29); no write channel (FR-010)

**Scale/Scope**: ~tens of tenants, 12 snapshots × 8 values per tenant per year

## Constitution Check

| Principle | Status | How |
|---|---|---|
| I. One core, two transports | PASS | Same `KpiSnapshotService` on both; reads via `useApi()` → `ipcOrHttp`; capture is triggered per transport (server sweep / desktop boot) but the logic is one core call |
| I. Rule 27 (where code runs) | PASS, with exception | No client exists for a timer-driven capture; uses the explicit `Asia/Beirut` zone via `Intl` (trialCalendar precedent), never `process.env.TZ` or the server day. See Complexity Tracking |
| I. Rule 29 (browser leaf) | PASS | `kpiDefinitions.ts` and `kpiSplit.ts` import nothing Node; the service/repositories are index.ts-only |
| II. Layer boundaries | PASS | All SQL in repositories (new methods on Debt/Supplier repos + `KpiSnapshotRepository`); the service assembles and splits only |
| III. Contracts once | PASS | One response type exported from core (both entries); no write schema exists to share |
| III. Rule 14 (no pasted predicates) | PASS | Supplier figure reuses `_ledgerBalanceQuery`/`ledgerNotRefunded`; stock reuses `getStockStats`; carrier reuses `getCarrierCreditsSum`; partners reuse `getAllBalances` |
| IV. Money integrity | N/A | Reads only; writes no transaction, payment, drawer or ledger row |
| V. Data and security | PASS | `?` placeholders; `tenant_id` on both tables and every query; admin-only on both transports; migration in both files with `down()`; tables added to the tenant cascade delete |
| VI. Testing | PASS | Core capture tests written first and seen failing (rule 17); schema-derived names (rule 24); web e2e for parity |
| VII. Code quality | PASS | No `any`; module logger; `api` read through a ref; stable `useApi` mocks |

**Post-design re-check:** unchanged. The design adds no write path and no new transport branching.

## Project Structure

### Documentation (this feature)

```text
specs/364-monthly-kpi-snapshot/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R10 decisions
├── data-model.md        # tables, KPI definitions, marker
├── quickstart.md        # validation runs
├── contracts/kpi-snapshots.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/core/src/
├── constants/kpiDefinitions.ts            # NEW: keys, group, requiresModule, order (browser-safe)
├── utils/kpiSplit.ts                      # NEW: splitBySign (pure)
├── utils/kpiMonth.ts                      # NEW: Beirut month helpers (Intl, explicit zone)
├── repositories/KpiSnapshotRepository.ts  # NEW: insert/list snapshots, marker, late check
├── repositories/DebtRepository.ts         # + getClientBalances()
├── repositories/SupplierRepository.ts     # + getCounterpartyBalances() (reuses _ledgerBalanceQuery)
├── repositories/TenantRepository.ts       # + the two tables in deleteTenantCascade
├── services/KpiSnapshotService.ts         # NEW: captureDue(now), listSnapshots()
├── db/migrations/index.ts                 # v228
├── index.ts / browser.ts                  # exports (types + definitions in browser.ts)
└── offline/channelPolicy.ts               # kpi:list-snapshots → read

electron-app/
├── create_db.sql                          # both tables
├── handlers/kpiHandlers.ts                # NEW: kpi:list-snapshots (admin)
├── kpiSnapshotTimer.ts                    # NEW: boot capture + hourly, standalone only
├── main.ts                                # register handler; start timer after initializeBackend
├── preload.ts                             # kpi.listSnapshots
└── offline/__tests__/channelPolicy.complete.test.ts  # read count +1

backend/src/
├── api/kpi.ts                             # NEW: GET /api/kpi/snapshots (admin)
├── services/kpiSnapshotSweep.ts           # NEW: boot + hourly, every tenant, per-tenant try/catch
└── server.ts                              # mount route; start sweep

frontend/src/
├── api/backendApi.ts / ElectronApiAdapter.ts      # getKpiSnapshots
├── types/electron.d.ts                            # kpi.listSnapshots
├── features/kpi/hooks/useKpiSnapshots.ts          # NEW
├── features/kpi/pages/MonthlyProgress/index.tsx   # NEW page
├── app/App.tsx                                    # /monthly-progress under AdminRoute
└── (sidebar)                                      # admin-only menu item

packages/ui/src/
├── api/types.ts                                   # ApiAdapter.getKpiSnapshots
└── i18n/locales/{en,ar}/kpi.json                  # NEW namespace

docs/release-notes/UNRELEASED.md + frontend/public/whats-new/<next>/monthly-progress.png
```

**Structure Decision**: the existing monorepo layout. The new feature folder is `frontend/src/features/kpi/`. Core keeps SQL in repositories and splitting in a pure util.

## Complexity Tracking

| Exception | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Rule 27: the server determines the month itself (explicit `Asia/Beirut`) rather than the client supplying it | The capture is timer-driven, with no request and no client; the owner asked for Beirut month end | Setting `TZ` on the server is forbidden by rule 27; waiting for a client request would miss shops nobody opens, which breaks "automatic, every shop" |
| Desktop capture runs at boot before handlers register | FR-007 needs the snapshot before the first sale of the month | Checking inside every money write path would touch every repository |
