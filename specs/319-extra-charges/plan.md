# Implementation Plan: Extra charges

**Branch**: `319-extra-charges` (work on `main`, ticket LIRA-319) | **Date**: 2026-10-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/319-extra-charges/spec.md`

## Summary

A cashier can add a small extra on top of a sale's total from the payment box ("− Discount | + Extra" on the LIRA-318 Discount line). The extra is stored in two new columns on the unified transaction row (`extra_usd`, `extra_lbp`); it is part of the amount the customer owes and pays (so drawers, debt and the generic void follow with no new code) and is kept out of the row's profit stamp (item and service margins stay unchanged). Profits shows it as its own "Extra charges" row from those columns through one shared SQL fragment. Partial item refunds give back the item's share; the session basket records one extra row. Seven write paths, seven schemas, both transports. Details: [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md).

## Technical Context

**Language/Version**: TypeScript (strict), Node 22 / Electron 31, React 19

**Primary Dependencies**: `@liratek/core` (repositories, services, Zod validators), `@liratek/ui` (MultiPaymentInput, DiscountLine), Express backend, Electron IPC

**Storage**: SQLite (SQLCipher on desktop, Litestream-replicated on web) — migration v212 + `create_db.sql`

**Testing**: core jest (in-memory DB from `create_db.sql`, `postingAssert` ledger deltas), backend jest, frontend jest (RTL), web e2e (Playwright)

**Target Platform**: desktop app (macOS/Windows) and the multi-tenant web app

**Project Type**: monorepo — desktop app + web app off one core

**Performance Goals**: no measurable change; one extra column pair per row, Profits adds one SUM over indexed rows

**Constraints**: offline replay (new fields optional, no default); same behaviour on both transports; money nets to 0 on every reversal, per currency

**Scale/Scope**: 7 payment pages, 7 schemas, 7 repositories, Profits service + page, receipts, Transactions view

## Constitution Check

*GATE: checked before Phase 0 and again after Phase 1.*

| Principle | How this plan meets it | Status |
| --- | --- | --- |
| I. One core, two transports | Each write keeps its IPC handler + REST route on the same core schema; extra validated server-side; no transport branch in pages; no Node import reachable from `browser.ts` (DiscountLine/MPI are UI-only). | Pass |
| II. Layer boundaries | SQL only in repositories (new fragment + Profits query in `ProfitRepository`); `ProfitService` only assembles. | Pass |
| III. Contracts once | `extra_usd/lbp` added once per core schema; adapter/preload types derived; rule-23 key diff per channel; one `EXTRA_CHARGE_PROFIT_*` fragment. | Pass |
| IV. Money integrity | FEATURE_GUIDE §13 per module; extra enters via the amount + IN legs only (rule 16); `client_id` paths unchanged; reversal owners: generic void, `_createRefundRow`, item refund/undo, session basket (rule 20) with create + reverse = 0 tests. | Pass |
| V. Data & security | Parameterised SQL; tenant_id on every new query; migration in both files with `down()`; no new role (sale roles). | Pass |
| VI. Testing | Guards written first per module; e2e by identity + deltas; payload names from schemas; counts confirmed. | Pass |
| VII. Code quality | Strict TS, module loggers, named exports. | Pass |

Re-check after design: no violations; no Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/319-extra-charges/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── payment-box.md
│   └── write-payloads.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/core/src/
├── db/migrations/index.ts                 # v212 extra_usd / extra_lbp
├── validators/{sale,maintenance,customService,loto,recharge,financial,session}.ts
├── repositories/
│   ├── TransactionRepository.ts           # createTransaction cols, _createRefundRow, session refund/undo
│   ├── SalesRepository.ts                 # processSale, item refund share, undo
│   ├── MaintenanceRepository.ts  CustomServiceRepository.ts  LotoTicketRepository.ts
│   ├── RechargeRepository.ts     FinancialServiceRepository.ts
│   ├── ProfitRepository.ts                # EXTRA_CHARGE_PROFIT fragment + queries
│   └── CustomerSessionRepository.ts       # session profit sums
├── services/{ProfitService,SessionCheckoutService,SessionPaymentService}.ts
├── constants/{profitRowClass,profitModuleDetailSupport,postingRules}.ts
└── utils/transactionRowDisplay.ts
electron-app/create_db.sql   electron-app/preload.ts   frontend/src/types/electron.d.ts
backend/src/api/{sales,maintenance,customServices,loto,recharge,services,sessions,profits}.ts
packages/ui/src/components/ui/{DiscountLine,MultiPaymentInput}.tsx   packages/ui/src/api/types.ts
frontend/src/
├── api/backendApi.ts  api/ElectronApiAdapter.ts
├── features/sales/pages/POS/components/CheckoutModal.tsx   features/sales/utils/receiptFormatter.ts
├── features/maintenance/  features/custom-services/  features/loto/  features/recharge/  features/services/
├── features/sessions/components/SessionCheckoutModal.tsx   features/sessions/utils/sessionReceipt.ts
├── features/profits/pages/Profits.tsx
├── features/audit/ (TransactionsViewer, cells, RefundMethodModal)
└── shared/utils/serviceReceipt.ts
docs/FEATURE_GUIDE.md  docs/POSTING_MAP.md  docs/release-notes/UNRELEASED.md
```

**Structure Decision**: existing monorepo layout; no new package or module. Order of work: (1) migration + Profits fragment/row + generic refund columns; (2) POS end to end (MVP, US1–US3); (3) the other pages (US4); (4) session basket; (5) account sales (US5), receipts, Transactions view, docs.

## Complexity Tracking

None.
