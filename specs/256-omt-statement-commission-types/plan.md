# Implementation Plan: OMT statement commission types

**Branch**: `main` (ticket LIRA-256; Spec Kit dir `256-omt-statement-commission-types`) | **Date**: 2026-10-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/256-omt-statement-commission-types/spec.md`

## Summary

Let the owner say which OMT commission types a balance SMS includes. (a) The LIRA-255 statement
check subtracts only those types' unsettled commission (display only). (b) A settlement that
names covered types is **refused** if it contains a new-style OMT transfer of an uncovered type,
so uncovered transfers stay in the queue at gross with their commission pending, and the typed
commission is split only across the transfers actually settled. No migration, no new ledger row,
no change to the commission booking or void code: one pure "is this row covered" function, one
read-only guard shared by both settle paths, one optional payload key on two schemas, one
optional argument on one read, and the UI to choose the types. Absent choice = today's behaviour.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node 20 (backend, jest), Electron 31 main process

**Primary Dependencies**: `@liratek/core` (repositories/services/validators), Zod, Express (backend), React 19 + TanStack Query (frontend), Playwright (e2e)

**Storage**: SQLite / SQLCipher via better-sqlite3 — **no schema change** (stays v209)

**Testing**: jest (core real-schema tests, backend supertest, electron handler tests, frontend RTL), Playwright web e2e (`frontend/tests/e2e-web`), desktop e2e twin (CI only)

**Target Platform**: Desktop (Electron, IPC) and web (Vercel + Fly REST), same core

**Project Type**: Monorepo desktop + web app (Yarn workspaces: `packages/core`, `backend`, `electron-app`, `frontend`, `packages/ui`)

**Performance Goals**: The statement read stays one pass over the same queue rows it reads today (no extra query)

**Constraints**: Money integrity (FEATURE_GUIDE §8/§9/§10/§13); dual transport (rule 19); absent field must be byte-identical to today (S3)

**Scale/Scope**: One OMT account per shop; queue of tens to hundreds of transfers

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | How |
|-----------|--------|-----|
| I. One core, two transports | PASS | Read + both writes extended on IPC and REST, same `SupplierService` methods; frontend via `useApi()`; one payload shape per operation (no transport branch); no clock/locale dependency; new util is a pure leaf (rule 29). |
| II. Layer boundaries | PASS | Filter + guard in `SupplierRepository`; service passes through; handlers/routes only validate and forward. |
| III. Contracts defined once | PASS | `OMT_SERVICE_TYPES` tuple replaces the inline enum copy; `omtCoveredTypesSchema` shared by IPC + REST; adapter types derived from schema; three-way key diff task (rule 23); `isOmtRowCovered` is the one predicate. |
| IV. Money integrity | PASS | No new side-effect row → no new reversal owner needed (rule 20 by construction); settle→void net-zero test per currency anyway; no drawer/leg change (rule 16 untouched); no client propagation surface; §13 walk below. |
| V. Data and security | PASS | `?` placeholders only; tenant filters unchanged (guard reuses tenant-scoped rows); settle stays `admin`; read keeps its current auth. No migration. |
| VI. Testing | PASS | Failing-first tasks precede each implementation task; e2e asserts deltas by identity; schema-derived field names in tests. |
| VII. Code quality | PASS | No `any`; module loggers; `api` read through a ref where needed; stable `useApi` mocks. |

**FEATURE_GUIDE §13 walk (money):** 1 schema/plumbing — no migration; preload + `electron.d.ts` +
`ApiAdapter` widened; core build & sync. 2 transactions row — no new type; settlement metadata gains
an informational key. 3 IN/OUT — unchanged. 4 legs — unchanged. 5 drawers — unchanged. 6 client
propagation — n/a (no client field). 7 CUSTOMER_ACCOUNT — n/a. 8 supplier ledger — unchanged
(gross payable, commission credit as today). 9 void — unchanged code, re-proven by test. 10 profits
— commission still recognised from allocations on settlement day; uncovered rows' commission is
deferred, never dropped. 11 sessions — n/a. 12 audit viewer — n/a. 13 e2e — lira-web-053 + desktop
twin. 14 one obligation one owner — unchanged. 15 legs vs amount — unchanged guards.

Post-design re-check: PASS (no violations; Complexity Tracking empty).

## Project Structure

### Documentation (this feature)

```text
specs/256-omt-statement-commission-types/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/supplier-commission-types.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/core/src/
├── utils/omtFees.ts                         # + OMT_SERVICE_TYPES tuple; OmtServiceType derived
├── utils/omtCoveredTypes.ts                 # NEW pure leaf: OmtCoveredType, isOmtRowCovered, label, normalise
├── utils/__tests__/omtCoveredTypes.test.ts  # NEW
├── validators/financial.ts                  # omtServiceType: z.enum(OMT_SERVICE_TYPES)
├── validators/supplier.ts                   # + omtCoveredTypesSchema; key on both settle schemas
├── validators/__tests__/supplier.coveredTypes.test.ts      # NEW
├── repositories/SupplierRepository.ts       # statement filter + by-type; AccountUnsettledRow fields;
│                                            #   _resolveSettlementBatchModel SELECT; _assertRowsCovered guard;
│                                            #   metadata stamp in settleTransactions + settleAccount
├── repositories/__tests__/SupplierRepository.accountExpectedStatement.test.ts   # extended
├── repositories/__tests__/SupplierRepository.coveredTypesSettlement.test.ts     # NEW
├── repositories/__tests__/TransactionRepository.supplierSettlementReversal.test.ts  # extended
└── services/SupplierService.ts              # getAccountExpectedStatement(id, covered?)

electron-app/
├── schemas/index.ts                         # re-export OmtCoveredTypesSchema (zod-major cast)
├── handlers/supplierHandlers.ts             # read: optional 2nd arg, validated
├── handlers/__tests__/supplierHandlers.coveredTypes.test.ts  # NEW
└── preload.ts                               # three binding signatures

backend/src/api/
├── suppliers.ts                             # GET ?covered= parsed with the shared schema
└── __tests__/suppliers.api.test.ts          # extended

packages/ui/src/api/types.ts                 # ApiAdapter + AccountExpectedStatement + AccountUnsettledRow mirrors

frontend/src/
├── types/electron.d.ts
├── api/backendApi.ts, api/ElectronApiAdapter.ts
└── features/suppliers/
    ├── hooks/useSuppliers.ts                # query key + arg
    ├── utils/omtCoveredTypesStorage.ts      # NEW per-device last choice (try/catch)
    ├── components/OmtCoveredTypesPicker.tsx # NEW shared picker
    ├── components/OmtStatementCheckPanel.tsx
    ├── components/AccountSettleSheet.tsx
    └── pages/Suppliers/index.tsx            # Settle tab (OMT supplier only)

frontend/tests/
├── e2e-web/lira-web-053-omt-statement-commission-types.spec.ts      # NEW
├── e2e-electron/lira-256-omt-statement-commission-types.spec.ts     # NEW (CI only)
└── e2e-electron/README.md                   # index row

docs/release-notes/UNRELEASED.md, current_sprint.md, docs/FEATURE_GUIDE.md §10,
docs/COUNTERPARTY_LEDGERS.md §4.1, docs/plans/OVERNIGHT_DECISIONS_2026-10-11.md §2
```

**Structure Decision**: Existing monorepo layout; every change lands in the module that already
owns the behaviour (core repository for SQL/guard, shared validator for the contract, existing
handler/route for transport, existing supplier feature folder for UI).

## Design notes the tasks rely on

1. **Guard placement.** `_assertRowsCoveredByStatement(rows, covered)` runs in `settleTransactions` right after
   `_resolveSettlementBatchModel` (pre-try tier, so its message
   reaches the caller verbatim like the mixed-model error). In `settleAccount` it runs elsewhere: (right after step 0, on EVERY selected FINANCIAL_SERVICE row, before any
   write — not on `commissionEligibleRows`, which is empty when the FS selections span two members,
   analyze finding C1). It takes structural rows `{ id, provider, omt_service_type, commission_model }`,
   filters `commission_model === 1` rows through `isOmtRowCovered`; throws `DatabaseError` naming the lowest offending id and type label.
   With `covered === undefined` it returns immediately.
2. **Commission-with-no-row case.** Already impossible for model-1 batches: every row in the
   batch is covered once the guard passes, so `_bookCommissionAtSettlement` receives exactly the
   settled rows. No change there.
3. **Statement filter.** In `getAccountExpectedStatement`, inside the existing per-member loop:
   for `member.provider === "OMT"` rows, add to `commission_by_type` always, add to the totals only
   when `isOmtRowCovered`. Non-OMT members unchanged.
4. **Normalisation.** `normaliseCoveredTypes(list)` de-duplicates and orders by tuple order; used
   for the metadata stamp and the echo field, so the same choice always prints the same way.
5. **UI.** One `OmtCoveredTypesPicker` (checkbox per type + "All types" + "Type not recorded",
   each showing count/amount when given). Panel passes the choice to the query; settle screens
   make only covered rows selectable (the account sheet pre-selects them oldest first as today; the
   Settle tab keeps starting empty and its "Select all" picks covered rows only), render uncovered ones disabled
   with "Waiting — not in this statement", and send `covered_omt_service_types` only when the
   choice is not "All types". Choice stored per account via `omtCoveredTypesStorage`
   (`liratek:omt-covered-types:<accountSupplierId>`), shared by the three screens.
6. **REST query parsing.** `covered` is a comma list, given once (string) or repeated (string[]); parsed into an array and validated with the
   shared schema in the route (not a second schema).

## Complexity Tracking

No constitution violations. Nothing to justify.
