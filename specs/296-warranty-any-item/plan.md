# Implementation Plan: Warranty for any item, not just phones

**Branch**: `296-warranty-any-item` (work directly on local `main`, owner preference) | **Date**: 2026-10-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/296-warranty-any-item/spec.md`

## Summary

LiraTek already records a warranty for every product sold (LIRA-143). This feature makes it
usable for any item, on both the desktop app and the web app.

It is built in three phases, each releasable on its own (owner decision D4):

- **P1 — Find and see, with rules:**
  - one stable receipt number, `RCP-<sale id>`;
  - a warranty search by customer, phone, receipt number, product or serial;
  - warranty status on every sale line, including partly refunded ones;
  - a default warranty per category, editable per line at the till, with the edit recorded;
  - warranty terms on receipts;
  - three small fixes in the same release: the web recent-sales list honours the picked day, a web route for sales by date range, and the saved receipt header now prints.

  Small schema change: migration v205.
- **P2 — Act:** claims (repair, replace or refund), a defective holding for faulty items, and
  one **Warranty cost** line in Profits, written as `WARRANTY_COST` transactions with no payment
  legs (D1). A replacement keeps the original end date (D2). Repairs carry their own warranty.
  Migration v206.
- **P3 — Track and report:** serials for any category with a per-category block/warn rule (D3),
  supplier returns that offset the warranty cost, and a warranty report. Migration v207.

## Technical Context

**Language/Version**: TypeScript in strict mode. Node 20 (Fly backend). React 19 + Vite (Vercel). Electron 31 (desktop).

**Primary Dependencies**: existing ones only — better-sqlite3 / SQLCipher, zod, Express, TanStack Query, `@liratek/ui`.

**Storage**: SQLite. One migration per phase (v205, v206, v207), each mirrored in `create_db.sql`.

**Testing**:
- Jest for core, backend, electron and frontend.
- Playwright for web e2e.
- Desktop e2e on Windows or CI only.

**Target Platform**: desktop (IPC) and web (REST), with identical behaviour (Constitution I).

**Project Type**: monorepo — core library, Express API, Electron main process and React SPA.

**Performance Goals**: a warranty search returns in under 1 s for 2 years of sales. It uses indexed joins on `sale_items.warranty_until`, `sales.client_id` and `product_units.imei`; P1 adds the index on `sale_items(warranty_until)`.

**Constraints**:
- Money integrity (rules 16, 18, 20, 26).
- No drawer movement except the existing refund legs.
- The client supplies the day (rule 27).
- The browser bundle stays free of Node built-ins (rule 29).

**Scale/Scope**:
- **P1:** 1 migration, 1 repository, 1 service and 1 schema module; changes to the sale schema, the receipt formatter, CategoriesManager, Shop Config and SaleDetailModal; and a new Warranty lookup page.
- **P2:** 1 migration and a claims service; changes to refund-item (no restock), Maintenance (warranty job and warranty length) and Profits (WARRANTY row); and a claim UI.
- **P3:** 1 migration, supplier returns, the serial rule and the report page.

## Constitution Check

| Principle | Status | Note |
|---|---|---|
| I. One core, two transports | Pass | Every operation has a core service, an IPC handler, a REST route and an adapter function (research R11). |
| I. Location-dependent values (rule 27) | Pass | `client_day` drives every state and stamp; the server's day is only a fallback. |
| I. Browser leaf (rule 29) | Pass | `warrantyState`, `receiptNumberFor` and the schemas are pure; services are Node-only. |
| II. Layer boundaries (rule 13) | Pass | SQL lives in `WarrantyRepository` and its new tables' repositories; services orchestrate only. |
| III. Contracts defined once (rules 14, 21, 22, 23) | Pass | One status helper replaces two (R2). One `WARRANTY_JOB` predicate. Schemas live in `validators/warranty.ts`; adapter types are derived from them. A three-way key diff happens before the sale schema change. |
| IV. Money integrity | Pass by design | `WARRANTY_COST` has no payment legs. Its reversal owner is `voidClaim`, gated in `NON_REVERSIBLE_TRANSACTION_TYPES` (rule 20). Rows are `is_auto` (rule 26). A REFUND claim reuses the existing refund-item legs, with `restock: false`. The FEATURE_GUIDE §13 checklist is worked through in tasks for P2 and P3 (rule 18). |
| V. Data and security | Pass | New tables have id, tenant_id and timestamps, and are tenant-scoped. Roles: staff may search and start repair claims; replace, refund, void and supplier returns are admin only (R11). |
| VI. Testing (rule 17) | Planned | Failing-first tests for each requirement; ledger-delta assertions (rule 15); web e2e per phase. |
| VII. Code quality | Pass | Strict TypeScript, module loggers, parameterised SQL. |
| Delivery (rule 30) | Required | A release note and a sprint "What users will notice" line per phase. |

**Post-design re-check:** passes. No exceptions to record.

## Project Structure

### Documentation

```text
specs/296-warranty-any-item/
├── spec.md · plan.md · research.md · data-model.md · quickstart.md
├── contracts/api.md
├── checklists/requirements.md
└── tasks.md            (next: /speckit-tasks)
```

### Source code

```text
packages/core/src/
├── db/migrations/index.ts                 # v205 (P1), v206 (P2), v207 (P3)
├── utils/warrantyState.ts                 # NEW pure: warrantyState(), replaces computeWarrantyStatus + frontend getWarrantyState
├── utils/receiptNumber.ts                 # NEW pure: receiptNumberFor / parseReceiptNumber
├── validators/warranty.ts                 # NEW: search, claim, defective, supplier-return schemas (+ index/browser exports)
├── validators/sale.ts, inventory.ts       # sale item warranty_months; category warranty_months / serial fields
├── repositories/WarrantyRepository.ts     # NEW: search (sale lines, P2 + repairs)
├── repositories/WarrantyClaimRepository.ts, DefectiveItemRepository.ts, SupplierReturnRepository.ts   # NEW (P2/P3)
├── repositories/SalesRepository.ts        # resolve length (line ?? product ?? category), stamp warranty_months/_set_by; refundSaleItem restock:false (P2)
├── repositories/CategoryRepository.ts     # warranty_months, serial_label, serial_required
├── repositories/MaintenanceRepository.ts  # warranty_months/_until, warranty_claim_id (P2)
├── repositories/ProfitRepository.ts       # WARRANTY totals/detail; WARRANTY_JOB exclusion from maintenance (P2)
├── repositories/StockBatchRepository.ts   # consume/restore owner warranty_claim_id (P2)
├── services/WarrantyService.ts            # NEW: search; claims; void; defective resolve; supplier returns; report
├── services/ProfitService.ts              # WARRANTY by-module row + summary (P2)
├── constants/transactionTypes.ts          # WARRANTY_COST (+ NON_REVERSIBLE) (P2)
electron-app/
├── create_db.sql                          # mirror each migration + ledger rows
├── handlers/warrantyHandlers.ts           # NEW warranty:* (register in main.ts)
├── preload.ts, schemas/index.ts           # bindings + schema re-exports
backend/src/api/warranty.ts                # NEW /api/warranty (mount in server.ts)
frontend/src/
├── api/backendApi.ts, ElectronApiAdapter.ts; packages/ui/src/api/types.ts   # adapter fns (rule 21)
├── features/warranty/pages/WarrantyLookup.tsx            # NEW search page (+ route, sidebar entry)
├── features/warranty/components/ClaimModal.tsx, ClaimHistory.tsx, DefectiveItems.tsx, SupplierReturns.tsx, WarrantyReport.tsx  # P2/P3
├── features/sales/pages/POS/components/SaleDetailModal.tsx   # per-unit/partial state; "Start claim" (P2)
├── features/sales/pages/POS/components/CheckoutModal.tsx     # receipt number from sale id; per-line warranty edit
├── features/sales/utils/receiptFormatter.ts, shared/utils/serviceReceipt.ts   # terms text; repair warranty line
├── features/settings/pages/Settings/CategoriesManager.tsx    # category default (+ serial fields P3)
├── features/settings/pages/Settings/ShopConfig.tsx           # warranty terms text
├── features/maintenance/...                                  # warranty length; warranty job badge (P2)
└── features/profits/pages/Profits.tsx                        # Warranty cost row + detail (P2)
frontend/tests/e2e-web/lira-web-0NN-warranty-*.spec.ts
docs/release-notes/UNRELEASED.md, current_sprint.md (LIRA-296), docs/FEATURE_GUIDE.md (WARRANTY_COST posting row, P2)
```

**Structure decision**: existing layers. One new feature folder, `frontend/src/features/warranty`.
No new package.

## Implementation order

1. **P1 foundations:**
   - `receiptNumber.ts` and the checkout fix;
   - `warrantyState.ts`, then migrate both old helpers onto it;
   - migration v205.
2. **P1 behaviour:**
   - resolve and stamp the length;
   - the three-way key diff, then the sale schema change;
   - the category default UI;
   - the terms setting and receipt.
3. **P1 search:**
   - repository, service, schema;
   - IPC, REST and adapter;
   - the Warranty lookup page;
   - partial-refund states in SaleDetailModal.
4. **P1 side fixes** (same ticket, owner decision 2026-10-10):
   - SF-1: the web "today's sales" routes honour the date;
   - SF-2: a web route and adapter function for sales by date range;
   - SF-3: the receipt header prints on sale and repair receipts.
5. **P1 ship:** release note, gates, web e2e, commit, owner review, push.
6. **P2:**
   - read the FEATURE_GUIDE §13 checklist;
   - migration v206;
   - `WARRANTY_COST`, plus its void test written first;
   - REFUND with `restock: false`;
   - REPLACE;
   - REPAIR and repair warranty;
   - defective resolve;
   - the Profits row;
   - the claim UI;
   - e2e, ship.
7. **P3:**
   - migration v207;
   - serial label and rule;
   - supplier returns;
   - report;
   - e2e, ship.

## Complexity Tracking

| Decision | Why | Simpler alternative rejected |
|---|---|---|
| A new `WARRANTY_COST` transaction type with no payment legs | Puts warranty cost in Profits the same way every module stamps profit, with one reversal owner | An `EXPENSE` row would move a drawer; changing the original sale's profit would rewrite past months (D1) |
| A `defective_items` holding | A faulty item must not be sold again, and it must be traceable to a supplier return | Restocking (today's behaviour) puts broken items back on sale; writing them straight off loses the supplier recovery |
| Reusing `product_units` for serials | Every IMEI behaviour (story card, refund unit extras, overrides) carries over | A separate serials table would duplicate LIRA-143 |
