# Implementation Plan: OMT settlement by amount, one currency at a time

**Branch**: `322-omt-amount-first-settle` (work on `main`, ticket LIRA-322) | **Date**: 2026-10-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/322-omt-amount-first-settle/spec.md`

## Summary

- **What changes**: the OMT Settle Account sheet stops merging USD and LBP into one figure. The operator enters money per currency, and the system decides what closes.
  - Each currency is handled separately: credits net first, then the money plus any entered commission covers the oldest transfers.
  - The last transfer reached may be part-paid. Extra goes on the account.
  - One settlement can pay OMT in one currency and collect in the other.
- **Server**: coverage is stored in a new `supplier_settlement_coverage` table (v217). One pure allocator in core is shared by the sheet preview and the server.
  - The server re-runs it inside the write transaction and refuses stale previews.
  - Voids go newest first and soft-void their coverage.
- **Legacy path**: the old whole-row payload keeps working, so the existing suites stay a regression net.
- **Two findings fixed on the way** (each failing-first):
  - a past settlement's commission credit reappears in the queue (F3);
  - entered commission on the sheet does not reconcile (F4).
- **Suppliers page**: for account members, Pay / Receive and the Commission settlement list are hidden, and the paid / partial labels come from real coverage.
- Details: [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md).

## Technical Context

**Language/Version**: TypeScript (strict), Node 22 / Electron 31, React 19

**Primary Dependencies**: `@liratek/core` (SupplierRepository, TransactionRepository, FinancialServiceRepository, validators, `fifoCoverage`, `moneyPosting`), `@liratek/ui` (MultiPaymentInput), Express backend, Electron IPC

**Storage**: SQLite (SQLCipher desktop, Litestream web). Migration **v217** (last is v216) + `electron-app/create_db.sql`

**Testing**: core jest (in-memory DB, per-currency ledger deltas, property test), frontend jest (RTL), backend jest, web e2e (Playwright). Desktop e2e updated but not run on the owner's Mac. Ask before running suites.

**Target Platform**: desktop app and the multi-tenant web app

**Project Type**: monorepo — desktop + web off one core

**Performance Goals**: queue read adds one indexed SUM per row (hundreds of rows at most); settle stays one transaction

**Constraints**: legacy payload unchanged; per-currency strictness; create + void = 0 per ledger per currency; allocator browser-safe (rule 29); string ordering, never `Date` parsing

**Scale/Scope**: 1 migration, 1 new pure util, 3 repositories (Supplier, Transaction, FinancialService read), 1 service, 1 schema, IPC + REST + preload + adapter types, 1 sheet rewrite, 1 page gate, ~17 test files new/extended (see tasks.md), 1 new web e2e

## Constitution Check

*GATE: checked before Phase 0 and again after Phase 1.*

| Principle | How this plan meets it | Status |
| --- | --- | --- |
| I. One core, two transports | The same `SupplierService.settleAccount` serves IPC and REST, and the schema is shared. The sheet builds one payload through `useApi()`. The allocator is pure and reachable from `browser.ts` with no Node imports (guard test). No clock or locale input: ordering uses stored `created_at` strings. | Pass |
| II. Layer boundaries | All SQL is in repositories. The allocator is pure math. The service only validates and forwards. Handler and route hold no logic. | Pass |
| III. Contracts once | The schema is extended in `validators/supplier.ts`. The adapter and preload types derive from `z.input` (the hand-typed preload payload is replaced). A three-way key diff runs before wiring (rule 23). `ACCOUNT_ROW_COVERED_SQL` and `isSettlementCommissionCredit` are named once (rule 14). | Pass |
| IV. Money integrity | Work through the FEATURE_GUIDE §13 checklist:<br>• **Legs**: per-currency IN legs only toward coverage; change legs go through the shared loop (rule 16).<br>• **Reversal owners**: coverage → void soft-void; netting pairs and member/currency rows → the existing `transaction_id` scan; commission credit → the existing sibling cascade (rule 20).<br>• **`is_auto`**: on the netting pairs (rule 26).<br>• **Tests**: create + void = 0 per currency, written failing-first (rule 17).<br>• **No client**: there is no client field, so rule 11 does not apply. | Pass |
| V. Data and security | `?` placeholders only, `tenant_id` on every new query, admin role on both transports, actor from session/JWT. | Pass |

Post-design re-check: pass. The one structural addition, a coverage table instead of columns, is justified in research R1 and needs no Complexity Tracking entry.

## Project Structure

### Documentation (this feature)

```text
specs/322-omt-amount-first-settle/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md
├── contracts/settle-account.md, contracts/allocator.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
packages/core/src/
├── db/migrations/index.ts                 # v217 supplier_settlement_coverage
├── utils/accountSettleAllocation.ts       # NEW pure allocator (+ __tests__)
├── utils/fifoCoverage.ts                  # reused
├── validators/supplier.ts                 # per_currency, expected_owed (additive)
├── repositories/SupplierRepository.ts     # settleAccount amount-first branch, getAccountUnsettled coverage,
│                                          # getAccountExpectedStatement remaining, F3 exclusion
├── repositories/TransactionRepository.ts  # _reverseSupplierSettlement: newest-first guard + coverage soft-void
├── services/FinancialService.ts           # getAllByProvider: coverage-based labels for account members
├── constants/postingRules.ts              # SUPPLIER_SETTLEMENT/account-amount-first entry
├── index.ts, browser.ts                   # export allocator
electron-app/create_db.sql                 # same table
electron-app/preload.ts                    # settleAccount payload type derived
electron-app/handlers/supplierHandlers.ts  # unchanged logic; test payload
backend/src/api/suppliers.ts               # unchanged logic; test payload
packages/ui/src/api/types.ts               # AccountUnsettledRow + coverage fields; adapter type derived
frontend/src/features/suppliers/
├── components/AccountSettleSheet.tsx      # per-currency sections, preview, optional picker, expected_owed
├── utils/accountSettleMath.ts             # collapse helpers removed; thin wrappers over core allocator
├── pages/Suppliers/index.tsx              # hide Pay/Receive + Commission settlement for account members;
│                                          # Partial with amount, two-currency Outstanding
frontend/src/features/audit/               # mixed-direction badge for SUPPLIER_SETTLEMENT from legs
frontend/tests/e2e-web/lira-web-065-omt-amount-first-settle.spec.ts   # NEW
docs/release-notes/UNRELEASED.md           # Suppliers / OMT line
```

**Structure Decision**: the existing monorepo layout. All logic lives in `packages/core`. Transports only pass the payload through. The frontend changes one sheet, one page and the audit badge.

## Phasing (MVP first)

1. **Foundation**:
   - v217 table;
   - allocator plus its unit tests;
   - queue coverage fields;
   - F3 exclusion (failing-first);
   - schema additions.
2. **MVP — US1 + US2 + US6**: per-currency PAY, partial FIFO, coverage writes, stale check, void newest-first, the sheet's per-currency sections and preview. This fixes the reported defect.
3. **US3**: credit netting (within and across members), COLLECT direction, mixed directions in one transaction, F4 commission fix, cash-out commission on closed credits.
4. **US4**: hide Pay / Receive and Commission settlement for members; coverage-based labels; two-currency Outstanding.
5. **US5**: optional row picker (scope = ticked rows).
6. **Wrap-up**:
   - web e2e;
   - updates to lira-web-035 / 053 and desktop lira-189;
   - release note;
   - sprint entry;
   - FEATURE_GUIDE note on amount-first settlement.

## Complexity Tracking

None. No constitution violations.
