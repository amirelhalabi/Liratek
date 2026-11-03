# Implementation Plan: Settle OMT from the SMS amount

**Branch**: `370-omt-sms-amount-settle` (work on `main`, ticket LIRA-370) | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/370-omt-sms-amount-settle/spec.md`

## Summary

On the OMT account's Settle Account sheet, the cashier types the figure from OMT's SMS. LiraTek works out the commission as owed − SMS (OMT's sign, floored at 0). The commission now covers the picked transfers together with the money, so one settlement closes every picked day, in both directions. The SMS box opens at the expected figure (owed − outstanding expected commission of ticked types − owed shares of ticked types).

Ticked types decide only whose commission is expected. Transfers of unticked types still close, and their shares become **owed shares**: a new table, no profit until a later SMS includes the type. When OMT asks for more, the sheet warns, the extra stays as credit, and the expected commission becomes owed shares.

The statement panel becomes read-only and uses the same pure formula. Every settlement reverses fully. A void of an earlier settlement whose shares were cleared later books a relief row. The design is in [research.md](research.md) (R1–R11).

## Technical Context

**Language/Version**: TypeScript strict (Node 22 / Electron 31 / React 19)

**Primary Dependencies**: `@liratek/core` (repositories, services, validators, pure utils), Express backend, Electron IPC, TanStack Query, Zod

**Storage**: SQLite (SQLCipher desktop, per-tenant files on Fly). One migration, v229 `omt_owed_shares`.

**Testing**: core jest (Node ABI), frontend jest (jsdom), Playwright web e2e (`lira-web-091`)

**Target Platform**: desktop app + multi-tenant web app (rule 19)

**Project Type**: monorepo desktop + web

**Performance Goals**: the sheet's preview recomputes on every keystroke, as it does today. Pure functions over at most a few hundred rows.

**Constraints**: money exact in integer minor units (cents, whole LBP). The pure leaf stays browser-safe (rule 29). No client-trusted commission (FR-014).

**Scale/Scope**: OMT account only. Other suppliers byte-identical.

## Constitution Check

| Principle | Status |
| --- | --- |
| I. One core, two transports | ✅ Same schema for IPC + REST. The new read gets a handler + route + `backendApi` fn + `ApiAdapter` type. One payload builder (rule 22). Day from the client (rule 27) unchanged. `omtSmsSettlement.ts` is a pure leaf (rule 29, `browserEntryIsNodeFree` guard). |
| II. Layer boundaries | ✅ SQL only in `SupplierRepository` / `TransactionRepository`. Service orchestrates. |
| III. Contracts once | ✅ `sms_amount` / `owed_shares_only` in the core schema. Adapter types derived (rule 21). Rule 23 three-way diff for the new keys. `OWED_SHARE_LIVE_SQL` and the expected-figure formula are each defined once (rule 14). |
| IV. Money integrity | ✅ FEATURE_GUIDE §13 walked in tasks. IN legs only in flow branches (rule 16). Reversal owners: COMMISSION coverage, allocations, owed shares and relief rows are all owned by `_reverseSupplierSettlement` (rule 20). The relief row is `is_auto` (rule 26). The owed-share amount is a named snapshot (rule 31). |
| V. Data and security | ✅ `?` placeholders. `tenant_id` on every `omt_owed_shares` query. Migration in both files (rule 10). The table has `id`/`created_at`/`updated_at`. |
| Tests | ✅ Guards proven failing first (rule 17). Variant table (rule 28d). Explicit test paths only. |
| Release notes | ✅ UNRELEASED line + What's new card with a real screenshot (rule 30). |

No violations. Complexity Tracking is not needed.

## Project Structure

### Documentation (this feature)

```text
specs/370-omt-sms-amount-settle/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/settle-account-sms.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code

```text
packages/core/src/
├── db/migrations/index.ts                # v229 omt_owed_shares (+ down)
├── utils/omtSmsSettlement.ts             # NEW pure leaf: expectedSmsFigure, deriveSmsCommission, outstandingEstimate
├── utils/settlesByDay.ts                 # + commissionCoversOwed()
├── utils/accountSettleAllocation.ts      # commission_covers input, COMMISSION source, |orig| eligibility, expected+extra split
├── validators/supplier.ts                # sms_amount, owed_shares_only
├── repositories/SupplierRepository.ts    # settleAccount OMT path, owed shares create/clear, expected statement via the pure fn, owed-shares read, row expected_commission
├── repositories/TransactionRepository.ts # _reverseSupplierSettlement owed-share step + relief
├── services/SupplierService.ts           # getAccountOwedShares
└── browser.ts / index.ts                 # exports
electron-app/
├── create_db.sql                         # omt_owed_shares
├── handlers/supplierHandlers.ts          # suppliers:account-owed-shares
└── preload.ts                            # binding, derived type
backend/src/api/suppliers.ts              # GET /:id/account-owed-shares
frontend/src/
├── api/backendApi.ts + ElectronApiAdapter.ts
├── features/suppliers/components/AccountSettleSheet.tsx      # SMS box, commission line, warning, owed shares, All-types default, no change box
├── features/suppliers/components/OmtStatementCheckPanel.tsx  # read-only + owed shares
└── features/suppliers/hooks/useSuppliers.ts                  # owed-shares query
packages/ui/src/api/types.ts + i18n/locales/{en,ar,fr}/suppliers.json
frontend/tests/e2e-web/lira-web-091-omt-sms-settle.spec.ts
docs/release-notes/UNRELEASED.md, frontend/public/whats-new/<next>/omt-sms-settle.png
```

**Structure Decision**: the existing monorepo layout. Logic in core, transports thin, the UI on the existing sheet.

## Phases (handed to /speckit-tasks)

1. **Foundation**: migration v229, the pure leaf + its tests (failing first), `commissionCoversOwed`, schema keys + rule-23 diff.
2. **US1/US2/US3 (P1)**: allocator `commission_covers`, R2 split + `|orig|` (guard: receive-only collect), R3 marker, server derive + stale refusal, no commission credit row, sheet SMS box + prefill + commission line, no change box. Web e2e scenarios 1–2.
3. **US4/US4b (P2/P3)**: drop the row filter on the OMT path, owed shares create/clear/shares-only, owed-shares read (IPC + REST + adapter), sheet chip + "All types" default, panel shows owed shares.
4. **US5 (P2)**: OMT-asks-more warning, overpay credit in SMS mode, expected commission → owed shares.
5. **Void (FR-009c/FR-010)**: owed-share reversal + relief row, variant table with net-0 per ledger.
6. **US6 (P3)**: panel read-only over the shared formula, SC-003 equality test.
7. **Polish**: i18n en/ar/fr, release note + What's new screenshot, gates, current_sprint.md ticket update.

## Risks

- **Changing `getAccountExpectedStatement` to use the shared formula could move cornertech's panel figure.** Pin today's figures in a test before the change, and explain any cent that moves.
- **The allocator is shared by every calendar supplier.** `commission_covers: false` must leave the output byte-identical. The existing allocator suites pass unchanged as the guard.
- **Profit timing for cleared shares** relies on the allocation's `created_at` (ProfitRepository buckets by it). The variant test asserts the day.
