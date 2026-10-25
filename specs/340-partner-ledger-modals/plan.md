# Implementation Plan: Partner Transactions and Payments in their own windows

**Branch**: `main` | **Date**: 2026-10-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/340-partner-ledger-modals/spec.md`

## Summary

The partner ledger already holds everything (see spec "Findings"). The Partners page shows it as one inline table. We split it into two groups — **Payments** (settlements, discounts/write-offs, manual adjustments) and **Transactions** (everything else) — defined ONCE in core as a ledger filter `group`, read through the existing statement call on both transports, and shown in two windows opened from header buttons, using the Suppliers window component promoted to a shared component.

## Technical Context

**Language/Version**: TypeScript (strict), React 19, Node 20
**Primary Dependencies**: existing `@liratek/core` PartnerRepository/PartnerService, `useApi()` / `backendApi.ts`, Express route `backend/src/api/partners.ts`, IPC `partners:get-ledger`
**Storage**: SQLite `partner_ledger` (no schema change, no migration)
**Testing**: core jest (repository filter), frontend jest (page + modal), web e2e (lira-web spec + screenshot)
**Target Platform**: desktop (Electron IPC) + web (REST)
**Project Type**: monorepo (core / electron-app / backend / frontend / packages/ui)
**Performance Goals**: windows open instantly from already-loaded rows; one extra statement read per partner selection
**Constraints**: display only (FR-010); no new endpoint; rule 14 one group definition; rule 21 adapter payload typed from core
**Scale/Scope**: 1 page, 1 shared component, 1 filter field across 4 layers

## Constitution Check

- **I. One core, two transports**: group filter lives in core repo; IPC passes filters through unchanged; REST parses `group`; adapter adds it once. PASS.
- **II. Layer boundaries**: SQL stays in PartnerRepository; service unchanged except pass-through. PASS.
- **One definition (rule 14)**: `PARTNER_PAYMENT_ENTRY_TYPES` constant in core used by the SQL filter and exported for the screen's labels/tests. PASS.
- **Adapter types from schema (rule 21)**: `partnersGetLedger` filters type becomes core `LedgerFilters` (removes a hand-copied literal). PASS.
- **Money rules (16, 20)**: no writes. N/A.
- **Release notes + What's new (rule 30)**: bullet + Highlights card with real screenshot from a web e2e. PASS (task).
- **Tests failing-first (rule 17)**: repository group filter test and page test written first. PASS (task).

## Project Structure

### Documentation (this feature)

```text
specs/340-partner-ledger-modals/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/partner-ledger-group.md
└── tasks.md   (/speckit-tasks)
```

### Source Code (touched)

```text
packages/core/src/repositories/PartnerRepository.ts   # LedgerFilters.group + SQL; PARTNER_PAYMENT_ENTRY_TYPES
packages/core/src/constants/ (or same file)           # the constant, exported from index.ts + browser.ts
backend/src/api/partners.ts                           # parse ?group=
frontend/src/api/backendApi.ts                        # partnersGetLedger(filters: LedgerFilters) + group qs
packages/ui/src/api/types.ts                          # ApiAdapter partners.getLedger filters type
frontend/src/shared/components/TableModal.tsx         # promoted from suppliers/components/SupplierTableModal.tsx
frontend/src/features/suppliers/...                    # import the shared one (no behaviour change)
frontend/src/features/partners/pages/Partners/index.tsx  # buttons + two windows, inline table removed
frontend/src/features/partners/testing/partnerTableModals.ts  # test helper (like suppliers)
frontend/tests/e2e-web/lira-web-07x-partner-ledger-modals.spec.ts  # + screenshot for What's new
docs/release-notes/UNRELEASED.md, frontend/public/whats-new/<next>/partner-ledger.png, current_sprint.md
```

**Structure Decision**: extend existing layers; no new endpoint; promote the modal to `shared/components`.

## Complexity Tracking

None.
