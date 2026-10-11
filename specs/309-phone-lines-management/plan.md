# Implementation Plan: Phone Lines Management

**Branch**: `309-phone-lines-management` (work on `main`, no branch) | **Date**: 2026-10-11 | **Spec**: [spec.md](./spec.md) | **Ticket**: LIRA-309

**Input**: Feature specification from `specs/309-phone-lines-management/spec.md`

## Summary

The feature gives the shop one Phone Lines page for shop lines and for-sale
lines. It adds 3-day expiry alerts on the Dashboard and the bell, and an
internal recharge of a for-sale line from Mobile Recharge whose cost is
capitalized into the line.

Technical approach:

- **Storage**: for-sale line details go in a new `resale_lines` table, one
  row per inventory product. They are kept out of `carrier_lines` so they
  can never reach the MTC/Alfa drawer, checkpoints, primary-line selection or
  buy-back matching (research R1).
- **Capitalizing a recharge**: the cost *c* is added to the product's cost,
  its price, **and** its open FIFO batch's unit cost. The batch is what a
  sale's cost of goods reads, so profit stays the same (R2).
- **The three sources reuse existing movements** (owner dropped "paid in cash"):
  - Card: the self-charge style debit of the iPick/Katsh drawer (R3).
  - Shop-line credit: a CREDIT_TRANSFER style line and drawer debit, with the
    SMS fee capitalized and no expense row (R4).
  - Days: the DAYS line movement and drawer leg (R5).
- **Transaction and reversal**: each recharge is one new `LINE_RECHARGE`
  transaction. It is reversed by the generic void path plus one new step
  keyed on `resale_line_recharges.transaction_id`. That step is LIFO-guarded,
  refuses once the line is sold, and reverses by delta (R7).
- **Write-off**: a lost line is written off through the existing reversible
  `EXPENSE_INVENTORY` stock-expense flow (R8).
- **Status and alerts**: status comes from one browser-safe core helper,
  `classifyLineStatus`. It is a thin layer over the existing
  `classifyLineValidity`, using the client's day. Alerts are computed in the
  frontend when a page loads, extending today's carrier-line alerts. No
  server job is added. Each bell alert is sent at most once per line, status
  and day (R9).
- **Detection**: Mobile Recharge matches typed numbers against unsold
  for-sale lines (number = product barcode, not copied), and the backend
  refuses a customer recharge on one (R10). iPick/Katsh card sales take no
  target number, so they are out of scope.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node 20 (backend/core), React 19 + Vite (frontend), Electron 31

**Primary Dependencies**: `@liratek/core` (repositories/services/validators), Zod, Express (backend), TanStack Query, `@liratek/ui`

**Storage**: SQLite / SQLCipher (better-sqlite3). Migration v211 adds `resale_lines` and `resale_line_recharges`.

**Testing**: jest (core, frontend, backend, electron handlers), Playwright web e2e (`frontend/tests/e2e-web/`). Desktop e2e is not run on the owner's Mac.

**Target Platform**: Electron desktop (Windows) + multi-tenant web (Vercel SPA + Fly API)

**Project Type**: desktop + web app off one monorepo (Yarn workspaces)

**Performance Goals**: The Phone Lines page and alerts render with page load. Line counts per shop are tens, so list and classify in memory.

**Constraints**:
- Dual transport (rule 19).
- Client day (rule 27).
- Browser-safe leaf modules (rule 29).
- Money flows follow the FEATURE_GUIDE §13 checklist (rule 18).
- Offline desktop channel policy (LIRA-306).
- A parallel session (LIRA-308) touches payment/debt files. Building starts
  after it commits.

**Scale/Scope**: ~2 new tables, 1 transaction type, 5 operations × 2 transports, 1 new page, changes to Recharge page, Dashboard, TopBar, ProductForm.

## Constitution Check

*GATE: checked before Phase 0 and re-checked after Phase 1. Result: **PASS**, with no exceptions.*

| Principle | How this plan complies |
|---|---|
| I. One core, two transports | Every operation has an IPC handler and a REST route feeding `ResaleLineService` (contracts table). The frontend uses only `useApi()`. Each payload is built once. The client day is supplied (`client_day` / `X-Client-Day`). `lineStatus.ts` and the schema module are Node-free leaves under `browser.ts`, guarded by `browserEntryIsNodeFree.guard.test.ts`. |
| II. Layer boundaries | SQL lives in `ResaleLineRepository` plus one new `StockBatchRepository.addToOpenBatchUnitCost`. The service orchestrates. Handlers and routes only validate, authorize and call. |
| III. Contracts defined once | Schemas live in `validators/resaleLine.ts`. Adapter types come from `z.input`. The status thresholds are named constants. "Unsold line" is one named SQL fragment, reused by the list, the detection and the `processRecharge` guard. No existing handler gains a schema, so the rule-23 diff does not apply. Carrier-line create/update only gains a refusal. |
| IV. Money integrity | The §13 walk-through is below. Each source's ledger rows have a named reversal owner (R7). Net-zero per ledger and currency is tested per source (quickstart C4, C10, C14). No source posts customer or cash legs, so rule 16 does not apply. There is no client field, so rule 11 does not apply; this is documented. There are no auto sibling rows: the SMS fee is capitalized, not written, so no `is_auto` row is needed. |
| V. Data and security | `?` placeholders. `tenant_id` on every statement. Admin-only writes for line details and write-off, with the actor taken from the JWT. Both tables have `id/created_at/updated_at`. The migration goes into `index.ts` and `create_db.sql`, with `down()`. |
| VI. Testing | Guards are written first and seen failing (quickstart). The web e2e asserts deltas by identity. Payload names in tests come from the schemas. The web parity spec is `lira-web-NNN-phone-lines`. |
| VII. Code quality | Strict TS, module loggers, named exports, `@/` alias, and `api` read through a ref with stable mocks. |

### FEATURE_GUIDE §13 walk-through (LINE_RECHARGE)

| # | Item | Decision |
|---|---|---|
| 1 | Plumbing | v211 migration in both files. Repository → service → handler (Zod + `requireRole` + envelope) → REST. Preload typed with all fields, plus `electron.d.ts`. Core build and sync. |
| 2 | Transaction row | `LINE_RECHARGE` in `transactionTypes.ts`. `source_table='resale_line_recharges'`, `source_id`. `exchange_rate` stamped. `profit_usd/lbp = 0`. `client_id` NULL (internal). No supplier sibling. |
| 3 | IN/OUT badge | `TRANSACTION_CASH_DIRECTION.LINE_RECHARGE = null`. All sources move only internal balances (analogue `TELECOM_SELF_CHARGE: null`). |
| 4 | Payment legs | No customer legs and no change or return legs. Each source posts its drawer leg through the same leg writer it uses today. |
| 5 | Drawers | CARD goes to the iPick/Katsh drawer in LBP. SHOP_LINE_CREDIT and DAYS go to the MTC/Alfa drawer in USD, keeping drawer = Σ shop-line credits. |
| 6 | Client propagation | N/A: no client field. |
| 7 | CUSTOMER_ACCOUNT | N/A: never a payment method here. |
| 8 | Supplier/partner ledger | None. The dealer debt was booked at stock intake. Recharge sources are the shop's own balances. |
| 9 | Void path | Reversible through the generic void plus `_reverseResaleLineRecharge`. Proven per source. |
| 10 | Profits | Recharge profit is 0. The sale's profit uses the raised batch cost. Write-off books an expense at FIFO cost. Refund of the sale restores the unit at the consumption cost (existing). |
| 11 | Sessions | No basket branch. Internal recharges are not customer activity; documented. |
| 12 | Audit viewer | Label "Line recharge". Visible by default (operator action, not `is_auto`). In `ACTIONABLE_TYPES`. |
| 13 | E2E guard | Web spec with delta and identity assertions (quickstart). |
| 14 | One obligation, one owner | Invariant: Δ inventory value (+c) = Σ source decrease at cost. No ledger also encodes it. |
| 15 | Legs vs amount | No `payments[]` input. *c* is computed once in the service and passed to both the source movement and the capitalization. |

## Project Structure

### Documentation (this feature)

```text
specs/309-phone-lines-management/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── resale-lines.md  # Phase 1
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks (not created here)
```

### Source Code (repository root)

```text
packages/core/src/
├── db/migrations/index.ts                 # v211 resale_lines, resale_line_recharges
├── utils/lineStatus.ts                    # NEW leaf: classifyLineStatus, RESALE_/SHOP_LINE_EXPIRY_WARNING_DAYS (3 / 7)
├── validators/resaleLine.ts               # NEW schemas (export from index.ts AND browser.ts)
├── repositories/ResaleLineRepository.ts   # NEW
├── repositories/StockBatchRepository.ts   # + addToOpenBatchUnitCost (guarded)
├── repositories/RechargeRepository.ts     # + unsold-line guard in processRecharge
├── repositories/CarrierLineRepository.ts  # + refuse number of an unsold for-sale line
├── repositories/TransactionRepository.ts  # + _reverseResaleLineRecharge step
├── services/ResaleLineService.ts          # NEW: recharge per source, capitalization, write-off
├── constants/transactionTypes.ts, postingRules.ts
├── utils/transactionText.ts, utils/cashFlow.ts
└── offline/channelPolicy.ts               # new channels
electron-app/
├── create_db.sql                          # v211 tables
├── handlers/resaleLineHandlers.ts         # NEW, registered in main.ts
├── preload.ts, schemas/index.ts
backend/src/
├── api/resaleLines.ts                     # NEW, mounted in server.ts
frontend/src/
├── api/backendApi.ts, ElectronApiAdapter.ts, types/electron.d.ts
├── features/phoneLines/pages/PhoneLines/index.tsx   # NEW page (two tabs)
├── features/recharge/components/ResaleLineRechargePanel.tsx  # NEW
├── features/recharge/pages/Recharge/index.tsx       # detection + banner
├── features/dashboard/utils/carrierLineAlerts.ts    # → lineExpiryAlerts (for-sale 3 days, shop 7 days)
├── features/inventory/pages/Inventory/ProductForm.tsx  # carrier/expiry/credit for lines category
├── features/audit/auditConstants.ts                 # ACTIONABLE_TYPES
├── shared/components/layouts/TopBar.tsx, Sidebar.tsx; app/App.tsx; ActiveModuleContext.tsx
packages/ui/src/api/types.ts
frontend/tests/e2e-web/lira-web-NNN-phone-lines.spec.ts
docs/release-notes/UNRELEASED.md; current_sprint.md (LIRA-309 entry)
```

**Structure Decision**: the existing monorepo layout. The new code follows
the `product_units` full-stack pattern (child table → repository → handler +
REST + adapter) and the carrier-line reversal pattern.

## Delivery order (for /speckit-tasks)

1. **Foundation (US1)**: migration, `lineStatus.ts`, repository, save/list
   operations on both transports, Phone Lines page, ProductForm fields.
2. **Alerts (US2)**: `lineExpiryAlerts` on the Dashboard and TopBar
   (for-sale 3 days, shop lines unchanged at 7), and the write-off prompt
   plus the write-off operation.
3. **Recharge (US3)**: batch method, service per source, `LINE_RECHARGE`
   type and reversal step, recharge panel. Net-zero tests per source first.
4. **Detection (US4)**: banner on Mobile Recharge and the `processRecharge`
   guard.
5. Web e2e, release notes, sprint entry, quality gates.

Step 3 must wait for LIRA-308 to be committed. It shares payment-leg and
recharge files with that session.

## Owner answers (2026-10-11)

1. Card source = card bought from the iPick/Katsh balance. No card count.
2. Shop lines keep their 7-day warning; for-sale lines warn at 3 days.
3. "Paid in cash" source dropped as unnecessary.

## Complexity Tracking

No constitution violations, so this section is empty.
