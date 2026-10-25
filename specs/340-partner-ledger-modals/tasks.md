# Tasks: Partner Transactions and Payments in their own windows (LIRA-340)

**Input**: spec.md, plan.md, research.md, data-model.md, contracts/partner-ledger-group.md
**Tests**: required (rule 17 — guard tests seen failing first). Affected test files only, never full suites.

## Phase 1: Setup
- [X] T001 Add LIRA-340 to `current_sprint.md` (append only; other sessions edit this file) with a "What users will notice:" line

## Phase 2: Foundation (core group filter)
- [X] T002 Test FIRST `packages/core/src/repositories/__tests__/PartnerRepository.ledgerGroup.test.ts`: partner with FOR_POS, THROUGH_OMT_SEND, SETTLEMENT (settlement_method SPLIT), DISCOUNT, ADJUSTMENT → group "payments" returns the 3 payment rows, "transactions" the other 2, no group all 5; dates still filter inside a group; record the failure
- [X] T003 `packages/core/src/repositories/PartnerRepository.ts`: `PARTNER_PAYMENT_ENTRY_TYPES = ["SETTLEMENT","DISCOUNT","ADJUSTMENT"] as const`; `LedgerFilters.group?: "transactions" | "payments"`; SQL `transaction_type IN (...)` / `(transaction_type IS NULL OR transaction_type NOT IN (...))` with `?` placeholders; export the constant and `LedgerFilters` from `index.ts` and `browser.ts` (type-only where needed, rule 29)
- [X] T004 `backend/src/api/partners.ts`: parse `?group=transactions|payments` (ignore other values) + a backend test for the parse
- [X] T005 `frontend/src/api/backendApi.ts` `partnersGetLedger(partnerId, filters?: LedgerFilters)` (type from `@liratek/core`, rule 21) and set `group` in the query string; same type in `packages/ui/src/api/types.ts` and `ElectronApiAdapter.ts`/`frontend/src/types/electron.d.ts` if they declare it
- [X] T006 Rebuild core and sync `node_modules/@liratek/core/dist`

## Phase 3: US3 — shared window (P2, needed by US1/US2)
- [X] T007 Move `frontend/src/features/suppliers/components/SupplierTableModal.tsx` to `frontend/src/shared/components/TableModal.tsx` (optional `testId` prop, default keeps `supplier-table-modal-backdrop` for Suppliers); Suppliers imports it; Suppliers tests stay green

## Phase 4: US1 + US2 — Partners page (P1)
- [X] T008 Test FIRST `frontend/src/features/partners/pages/Partners/__tests__/Partners.tableModals.test.tsx` (stable useApi mock, rule 25): buttons "Transactions (N)"/"Payments (N)" with counts from the two reads (`group` passed), no inline ledger table on the panel, Transactions window has the existing filters, Payments window has the date filter only, Split shows as method, Escape/X/backdrop close, error shows Retry; record the failure
- [X] T009 `frontend/src/features/partners/pages/Partners/index.tsx`: two reads (transactions with current filters; payments with its own from/to), header buttons (`partner-open-transactions`, `partner-open-payments`), the existing ledger table rendering reused inside each `TableModal`, inline table removed, reload both after settle / write-off / add credit-debt / void; i18n keys for the button labels and window titles (all locales the page already has)
- [X] T010 `frontend/src/features/partners/testing/partnerTableModals.ts` helper (like suppliers) and update existing Partners tests that read ledger rows to open the window first
- [X] T011 Web e2e `frontend/tests/e2e-web/lira-web-080-partner-ledger-modals.spec.ts` (074 was taken; 080 is the next free number): create partner, a For Partner entry, a Split settlement, a write-off, an adjustment over REST; assert counts and rows in both windows (identity + deltas, rule 15); save a landscape screenshot to `frontend/public/whats-new/<next version>/partner-ledger.png`; update any existing e2e that reads the partner ledger table

## Phase 5: Polish
- [X] T012 Release note line under Partners/Suppliers heading + `### ✨ Highlights` card with the screenshot in `docs/release-notes/UNRELEASED.md` (keep ≤ 5 cards: if 5 exist, merge with the closest card, don't drop others' work); `node scripts/build-release-notes.cjs --check`
- [X] T013 Gates: core/backend/frontend/ui typechecks, eslint + prettier on touched files, check-transport-parity, affected jest files, the new web e2e; mark tasks [X]

## Dependencies
T002→T003→T004/T005→T006 → T007 → T008→T009→T010→T011 → T012→T013
