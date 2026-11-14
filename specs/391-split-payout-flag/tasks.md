---
description: "Task list — LIRA-391 split payout flag"
---

# Tasks: LIRA-391 — split payout books the whole payout to the account

**Input**: spec.md, plan.md, research.md, data-model.md, contracts/lump-flag-fence.md, quickstart.md
**Tests**: requested by the spec (FR-4…FR-7) and by rule 17 — every guard is written and run
failing-first BEFORE its fix and BEFORE the core dist is rebuilt/synced.

Stories (the spec has requirements, not stories; grouped as):
- **US1 (P1)** core fence — FR-1, FR-2, FR-4, FR-7
- **US2 (P1)** pages derive the lump method — FR-3, FR-5
- **US3 (P2)** web e2e proof on both cash-out forms — FR-6, FR-8

## Phase 1: Setup

- [x] T001 Read spec, CLAUDE.md rules 14/16/17/20/22/24/25/28, the two RECEIVE branches in packages/core/src/repositories/FinancialServiceRepository.ts, and the docs/FEATURE_GUIDE.md §13 checklist (constitution IV)
- [x] T002 Spec Kit artifacts: specs/391-split-payout-flag/{plan,research,data-model,quickstart}.md, contracts/lump-flag-fence.md

## Phase 2: Foundational — failing-first guards (all BEFORE any fix / core build)

- [x] T003 [P] [US1] Core sweep test (table-driven, real DB) in packages/core/src/repositories/__tests__/splitPayoutFlag.sweep.test.ts — rows: Binance, OMT App, Whish App cash-out (Account+Whish, Account+Cash); system OMT/WHISH RECEIVE (stale CUSTOMER_ACCOUNT, stale WHISH); Katsh/iPick; loto ticket/prize, partner order, exchange, debt repayment, session payout, maintenance, vouchers, supplier/partner settle (thin rows); unbalanced split throws. Record failing rows in the file's doc comment.
- [x] T004 [P] [US1] Refund-symmetry case (FR-7) in the same sweep file: refund a split Binance cash-out, every touched ledger nets 0 per currency (Binance USDT, Whish_App USD, General USD, client ledger)
- [x] T005 [P] [US2] Page test packages: frontend/src/features/recharge/pages/Recharge/__tests__/Recharge.splitPayoutFlag.test.tsx and frontend/src/features/recharge/components/__tests__/OmtWhishAppTransferForm.splitPayoutFlag.test.tsx (split → no cashoutMethod, single account → CUSTOMER_ACCOUNT, single cash → CASH-equivalent; field names from the core schema, stable module-level useApi mock)
- [x] T006 [P] [US2] Guard frontend/src/utils/__tests__/lumpMethodSetter.guard.test.ts — fails any `.length === 1` … `[0].method` outside frontend/src/utils/paymentUtils.ts
- [x] T007 [P] [US3] Web e2e frontend/tests/e2e-web/lira-web-101-binance-split-payout.spec.ts
- [x] T008 [P] [US3] Web e2e frontend/tests/e2e-web/lira-web-102-app-wallet-split-payout.spec.ts
- [x] T009 Run T003–T008 against the unfixed code; record each real failure (test doc comments + report)

## Phase 3: US1 — core fence (P1)

- [x] T010 [US1] Add `hasPostingLegs`, `lumpFlagWhenNoLegs`, `payoutMethodOf` in packages/core/src/utils/paymentLegs.ts; re-export from packages/core/src/utils/payments.ts
- [x] T011 [US1] Wallet RECEIVE (Binance / OMT_APP / WHISH_APP) routing through `lumpFlagWhenNoLegs` in FinancialServiceRepository.ts
- [x] T012 [US1] System OMT/WHISH RECEIVE routing (account lump, wallet lump, CASH per-leg) through `lumpFlagWhenNoLegs`; fee fallback + `systemAdded` gate through `payoutMethodOf`
- [x] T013 [US1] Kept / rounding / added refusals and `chargesCustomerAccount` through `payoutMethodOf`
- [x] T014 [US1] Core build + sync; sweep + refund tests green

## Phase 4: US2 — pages (P1)

- [x] T015 [US2] `lumpMethodOf` in frontend/src/utils/paymentUtils.ts; `derivePaidByMethod` built on it
- [x] T016 [US2] Binance: frontend/src/features/recharge/pages/Recharge/index.tsx (submit + kept/round-up gates)
- [x] T017 [US2] frontend/src/features/recharge/components/OmtWhishAppTransferForm.tsx
- [x] T018 [P] [US2] FinancialForm.tsx, KatshForm.tsx, TelecomForm.tsx (frontend/src/features/recharge/components/)
- [x] T019 [P] [US2] frontend/src/features/services/pages/Services/index.tsx
- [x] T020 [US2] Page tests + guard green

## Phase 5: US3 — web e2e (P2)

- [x] T021 [US3] Both e2e specs green on a fresh web DB

## Phase 6: Polish

- [x] T022 Release note in docs/release-notes/UNRELEASED.md; FEATURE_GUIDE §13 line; "What users will notice" in current_sprint.md
- [x] T023 Gates: yarn typecheck, yarn lint, check:transport-parity, check:tenant-scoping, check:bind-arity, check:schema-equivalence, node scripts/build-release-notes.cjs --check, full core suite --maxWorkers=2, affected frontend tests (yarn build only if time allows; report if skipped)

## Dependencies

Phase 2 before Phases 3–5 (rule 17). T010 before T011–T013. T015 before T016–T019. T014 before T021.

## Parallel

T003–T008 are independent files. T018/T019 independent of each other.

## MVP

US1 (core fence) alone fixes every shipped page server-side.
