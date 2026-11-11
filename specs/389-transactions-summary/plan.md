# Implementation Plan: Summary view on Audit & Transactions

**Branch**: `389-transactions-summary` (work on `main`; ticket LIRA-389) | **Date**: 2026-11-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/389-transactions-summary/spec.md`

## Summary

Add a List | Summary toggle to Audit & Transactions. Summary groups the SAME rows the list
shows (same from/to, Type selection, search and default auto-row visibility) by Type
(module), Service type, Product or Product category, with Count, Units (product dims only),
Volume USD and Volume LBP, a TOTAL row, an "include refunded" toggle (off by default), a
row click that opens the List filtered to that row, and a "Summary by …" sheet in the Excel
export. No profit, cost, margin or commission anywhere.

Technical approach (research.md R1–R9):

1. **One filter rule, in core.** The list's filter is today split between SQL
   (`TransactionRepository.getRecent`) and the browser (`useTransactionRows`'
   `isRowVisibleForOption`: auto-row hide, Supplier Credit, Cash only, mixed selections).
   Both halves move to / stay in core: the request builder (`buildTransactionListFilters`)
   and the row predicate (`isTransactionListRowVisible`) become ONE browser-safe core module
   (`utils/transactionListFilter.ts`). The list hook imports them; the summary service
   runs `getRecent` with the same filters and the same predicate on the server.
2. **Summary computed on the server** (`TransactionSummaryService`) from those rows plus a
   reporting repository (`TransactionSummaryRepository`) that reads sale lines and the
   reversal rows linked to the counted originals. Groups are labelled by core functions
   the list itself uses (`transactionTitle` + service word; a typed module map).
3. **Dual transport**: `transactions:summary` IPC + `GET /api/transactions/summary`, one core
   schema (`transactionSummarySchema`), adapter type derived from it (rule 21).
4. **Drill-down**: the list gains a `drill` (module / service title client-side through the
   SAME core key functions; product / category server-side through two new `getRecent`
   filter keys validated by one core schema on both transports — rule 23).
5. **UI**: `DataTable` gets a `bodyOverride` slot so the Summary view keeps the table's own
   day-range filter and Excel/PDF export bar; the export template appends a
   "Summary by <grouping>" sheet when Summary is shown.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node 20 (backend), Electron 31, React 19

**Primary Dependencies**: better-sqlite3 / SQLCipher, Zod, Express, TanStack Table (DataTable), i18next

**Storage**: SQLite — reads only (`transactions`, `customer_session_transactions`, `payments`, `sale_items`, `products`, `product_categories`). No migration.

**Testing**: jest (core, backend, electron-app, frontend), Playwright web e2e (`lira-web-100`)

**Target Platform**: Desktop (Electron, IPC) and web (Vercel + Fly REST), one core

**Project Type**: Monorepo desktop + web app

**Performance Goals**: SC-004 — 12-month range answers < 3 s on the test tenant (web)

**Constraints**: rule 27 (days from the client), rule 29 (browser-reachable core module stays Node-free), literal `tenant_id = ?` in every new statement (check:tenant-scoping), no profit columns

**Scale/Scope**: up to tens of thousands of transactions per year per shop; a hard row cap (100,000) is reported as `truncated` rather than silently cut

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How |
| --- | --- | --- |
| I. One core, two transports | PASS | One service; IPC + REST; `useApi()`; one payload builder for list + summary (rule 22); days from the client (rule 27); new browser-reachable module imports only leaves (rule 29, guarded by `browserEntryIsNodeFree.guard.test.ts`) |
| II. Layer boundaries | PASS | All SQL in `TransactionRepository` / `TransactionSummaryRepository`; service aggregates only (rule 13) |
| III. Contracts once | PASS | `transactionSummarySchema` + `transactionSaleDrillFiltersSchema` in `validators/`; adapter types `z.input<…>` (rule 21); rule-23 diff for the two new `getRecent` keys (research R7); category label expression shared with `ProductRepository` (rule 14) |
| IV. Money integrity | N/A (read-only) | Writes no money. Netting reuses the existing reversal signals (`reverses_id`, `reversed_by_id`, VOIDED, item-refund rows, `refunded_quantity`) — no new predicate copies |
| V. Data & security | PASS | `?` placeholders; literal `tenant_id = ?` per statement; IPC `requireRole(["admin","staff"])`-equivalent to the list's access; REST `requireAuth` like `/recent` |
| VI. Testing | PASS | Failing-first core table test (skeleton service returning no rows → real assertion failures recorded), page test, route test, web e2e |
| VII. Code quality | PASS | strict TS, module loggers, `api` via ref |

Post-design re-check: PASS (no violations; no Complexity Tracking entries).

## Project Structure

### Documentation (this feature)

```text
specs/389-transactions-summary/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── transactions-summary.md
│   └── recent-drill-filters.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/core/src/
├── utils/transactionListFilter.ts            # NEW (browser leaf): list filter builder + row predicate + summary keys/labels
├── repositories/TransactionSummaryRepository.ts  # NEW: sale lines + linked reversal rows
├── repositories/TransactionRepository.ts     # getRecent: sale_product_id / sale_category drill keys
├── repositories/ProductRepository.ts         # export the display-category SQL (shared)
├── services/TransactionSummaryService.ts     # NEW: grouping/netting
├── validators/transactionSummary.ts          # NEW: request schema + drill-key schema
├── offline/channelPolicy.ts                  # transactions:summary is a read
└── index.ts / browser.ts / repositories/index.ts / services/index.ts / validators/index.ts

electron-app/handlers/transactionHandlers.ts  # transactions:summary; get-recent validates drill keys
electron-app/preload.ts, electron-app/schemas/index.ts
backend/src/api/transactions.ts               # GET /summary; /recent parses drill keys
frontend/src/api/backendApi.ts, ElectronApiAdapter.ts, types/electron.d.ts
packages/ui/src/api/types.ts                  # ApiAdapter.getTransactionSummary
packages/ui/src/components/ui/DataTable.tsx   # bodyOverride slot
frontend/src/features/audit/
├── hooks/useTransactionRows.ts               # core predicate + drill
├── hooks/useTransactionSummary.ts            # NEW
├── components/TransactionSummaryView.tsx     # NEW
├── pages/TransactionsViewer.tsx              # toggle, group-by, include refunded, drill chip
├── auditConstants.ts                         # visibility helpers re-exported from core
└── export/transactionsExportTemplate.ts      # "Summary by …" sheet
packages/ui/src/i18n/locales/{en,ar}/audit.json
frontend/tests/e2e-web/lira-web-100-transactions-summary.spec.ts
```

**Structure Decision**: existing monorepo layout; one new repository, one new service, one
new browser-safe util, one new page component.

## Complexity Tracking

None.
