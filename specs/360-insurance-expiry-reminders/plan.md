# Implementation Plan: Insurance expiry reminders

**Branch**: `360-insurance-expiry-reminders` (work on `main`, ticket LIRA-360) | **Date**: 2026-10-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/360-insurance-expiry-reminders/spec.md`

## Summary

Insurance is a Custom Services sale with `category = 'insurance'`. Add two columns to `custom_services`: `insurance_type` (required on new insurance sales, picked from 5 fixed codes) and a "won't renew" mark (`renewal_dismissed_at`, `renewal_dismissed_by`). One core read — `getInsuranceRenewals(today)` — derives the list at query time: expiry = shop sale day + 1 year, listed when `days_left <= 7`, minus refunded/voided/dismissed rows and rows renewed by a later live insurance for the same customer + type. The Dashboard card and the TopBar bell both call that one read through `useApi()` (IPC on desktop, REST on web). No cron: nothing is scheduled, the list is computed whenever the Dashboard loads or the bell polls.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node 20 (backend), Electron 31

**Primary Dependencies**: React 19 + Vite + TanStack Query, Express (backend), better-sqlite3 / SQLCipher, Zod

**Storage**: SQLite — `custom_services` gains 3 columns (migration v227; v226 is the last entry today)

**Testing**: core jest (repository + pure helper), frontend jest (card + bell), web Playwright e2e (`frontend/tests/e2e-web/`). No desktop e2e on this Mac.

**Target Platform**: Desktop (Electron, shop PC) + web (Vercel frontend, Fly backend)

**Project Type**: Monorepo: `packages/core`, `electron-app`, `backend`, `frontend`, `packages/ui`

**Performance Goals**: The read scans one tenant's insurance rows only (a few hundred at most); no index needed beyond the existing tenant index. Card loads with the rest of the Dashboard.

**Constraints**: Rule 27 (shop day from the client), rule 29 (pure helpers reachable from `browser.ts`), rule 19 (both transports), rules 21–23 (schema-derived payloads, three-way key diff before touching the add schema).

**Scale/Scope**: 1 migration, 1 repository method + 1 write, 1 service, 2 IPC channels, 2 REST routes, 1 offline binding, 1 form field, 1 Dashboard card, 1 bell check, History column.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How |
| --- | --- | --- |
| I. One core, two transports | PASS | Same `CustomServiceService` methods behind IPC handler + REST route; adapter via `ipcOrHttp`; offline binding for the write. |
| II. Layer boundaries | PASS | SQL only in `CustomServiceRepository`; service assembles; no `getDatabase()` in the service. |
| III. Contracts once | PASS | `INSURANCE_TYPES` + `insuranceRenewal.ts` pure helpers in core; Zod schemas in `validators/customService.ts`; adapter types `z.input<…>`. Phone normaliser moved to core once. |
| IV. Money integrity | PASS — not a money flow | No drawer, ledger, profit or payment change. `insurance_type` is descriptive. Dismiss writes no transaction. Rule 20/26/31: no new ledger row; no copied value (type lives only on `custom_services`). |
| V. Data and security | PASS | Parameterized SQL, tenant-scoped via `BaseRepository`; read = any authenticated user with Dashboard access (same as other `/api/dashboard` reads); write = `requireRole(["admin","staff"])` on both transports; actor from JWT/session. Migration has `down()` and `create_db.sql` update. |
| VI. Testing | PASS (plan) | Failing-first core tests for boundaries/renewal/exclusions; web e2e; affected paths only, ask owner before running. |
| VII. Code quality | PASS | No `any`, module loggers, named exports. |
| Delivery (rule 30) | PASS (plan) | Release note bullet + Highlights card with real screenshot from Cedar Mobile DB. |

## Project Structure

### Documentation (this feature)

```text
specs/360-insurance-expiry-reminders/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── insurance-renewals.md
└── tasks.md             # next: /speckit-tasks
```

### Source Code (repository root)

```text
packages/core/src/
├── utils/insuranceRenewal.ts          # NEW pure: INSURANCE_TYPES, addOneYear(), daysBetween(), classify, normalizePhoneForMatch()
├── utils/__tests__/insuranceRenewal.test.ts
├── db/migrations/index.ts             # v227: insurance_type, renewal_dismissed_at, renewal_dismissed_by
├── repositories/CustomServiceRepository.ts   # getInsuranceRenewalCandidates(), dismissInsuranceRenewal(); INSERT + history columns gain insurance_type
├── repositories/__tests__/CustomServiceRepository.lira360InsuranceRenewals.test.ts
├── services/CustomServiceService.ts   # getInsuranceRenewals(today), dismissInsuranceRenewal(id, user)
├── validators/customService.ts        # insurance_type in create schema (+ refine: required when category=insurance); insuranceRenewalsQuerySchema; dismissInsuranceRenewalSchema
├── offline/bindings/customServices.ts # dismiss binding
├── browser.ts / index.ts              # exports
electron-app/
├── create_db.sql                      # 3 columns
├── handlers/customServiceHandlers.ts  # custom-services:insurance-renewals, custom-services:dismiss-insurance-renewal
├── preload.ts, schemas/index.ts
backend/src/api/customServices.ts      # GET /insurance-renewals, POST /insurance-renewals/:id/dismiss (static before /:id)
packages/ui/src/api/types.ts           # ApiAdapter types
frontend/src/
├── api/backendApi.ts, api/ElectronApiAdapter.ts, types/electron.d.ts
├── features/custom-services/pages/CustomServices/index.tsx            # type picker when category = insurance
├── features/custom-services/pages/CustomServices/components/HistoryModal.tsx  # type column/label
├── features/custom-services/utils/labels.ts                            # insuranceTypeLabel()
├── features/dashboard/components/InsuranceRenewalsCard.tsx             # NEW card + "Won't renew"
├── features/dashboard/pages/Dashboard.tsx                              # place card in Credits & Stock row
├── shared/components/layouts/TopBar.tsx                                # once-per-day summary line
├── locales (en/ar/fr…) for dashboard, customServices, layout
frontend/tests/e2e-web/lira-web-0xx-insurance-renewals.spec.ts
docs/release-notes/UNRELEASED.md + frontend/public/whats-new/<next>/insurance-renewals.png
```

**Structure Decision**: Existing monorepo layers; no new package. The feature lives with Custom Services (the data owner); the Dashboard and TopBar only consume the read.

## Phase summary

- **Phase 0** → [research.md](./research.md): no cron; day math; phone matching; renewal rule; "cancelled" = refunded; bell cadence; role gates.
- **Phase 1** → [data-model.md](./data-model.md), [contracts/insurance-renewals.md](./contracts/insurance-renewals.md), [quickstart.md](./quickstart.md).

## Post-design Constitution re-check

All gates still PASS. One watch item: adding `insurance_type` to the create schema requires the rule-23 three-way key diff (schema ↔ preload `data` type ↔ fields the repository INSERT reads) and the rule-22 check that every mode that builds a custom-service payload (walk-in, session cart, partner, offline replay) uses the one builder, so the type is not dropped in a branch nobody runs.

## Complexity Tracking

No violations.
