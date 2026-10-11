# Implementation Plan: Waive on every payment page

**Branch**: `main` (ticket LIRA-310, folder `310-waive-everywhere`) | **Date**: 2026-10-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/310-waive-everywhere/spec.md`

## Summary

A Waive button closes a payment gap of up to $5 / 450,000 LBP in one tap on 18 pages.

- **Screen side**: one shared component (`MultiPaymentInput`) gains the button logic, the cap and the ceiling. Thirteen pages wire it to a discount, bill or price they already send.
- **Server side**:
  - Two customer flows (Loto ticket, Session checkout) gain a verified "reduction" claim inside the shared kept-change check. It lowers that transaction's profit only.
  - Three settlement flows (supplier account settle, supplier batch settle, LOTO settlement) book the gap as a bundled supplier discount in either direction.
- **Payout kept change**: its cap rises to the same shared value.

See [research.md](./research.md) R1–R7 for every decision.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node 22, React 19

**Primary Dependencies**: Electron 31, Express (backend), Zod, TanStack Query, better-sqlite3 / SQLCipher

**Storage**: SQLite. **No migration**: new payload fields, one new transaction type value (`WAIVED_SHORTFALL`), and existing ledger entry types.

**Testing**: core jest, frontend jest (RTL), Playwright web e2e. Electron e2e runs in CI only (owner rule: not on this Mac).

**Target Platform**: desktop (Electron IPC) + multi-tenant web (Vercel + Fly REST) + offline desktop replay

**Project Type**: Yarn monorepo (`frontend`, `electron-app`, `packages/core`, `packages/ui`, `backend`)

**Performance Goals**: n/a (no new queries on hot paths)

**Constraints**: money invariants (FEATURE_GUIDE §4.1, §8, §9, §13); dual transport; browser-safe constants

**Scale/Scope**: 18 pages; 5 core write flows; ~11 existing tests that pin the old $1 cap are updated deliberately

## Constitution Check

| Principle | Status | Notes |
| --- | --- | --- |
| I. One core, two transports | PASS | Every server change is in `@liratek/core` and reached by IPC + REST. Loto sell and Session checkout fixtures are updated for offline replay. The cap constant lives in a browser-safe validator (rule 29). |
| II. Layer boundaries | PASS | New SQL only in repositories (`SupplierRepository`, `LotoCheckpointRepository`, `LotoTicketRepository`, `SessionCheckoutService` uses the repository's existing `createTransaction`/`linkTransaction`). No logic in handlers or routes. |
| III. Contracts defined once | PASS with noted debt | New fields are added to core schemas. Adapter types derive from them. The supplier settle preload, `electron.d.ts` and `SettleAccountRequest` are hand-written today: the key is added there (rule 23 three-way diff), and the full rule-21 rewrite is logged as debt, not done here. |
| IV. Money integrity | PASS (by design, proven in tasks) | §13 walk below. Each new side-effect row has a named reversal owner, and create + reverse = 0 is a failing-first test. |
| V. Data and security | PASS | `?` placeholders; every new statement is tenant-scoped; the REST actor comes from the JWT. |

### FEATURE_GUIDE §13 walk (money flows touched)

| # | Item | Answer |
| --- | --- | --- |
| 1 | Schema/plumbing | No migration. Schemas plus preload, `electron.d.ts`, adapter; core build & sync. |
| 2 | Transactions row | Loto: existing LOTO row, profit lowered. Session: new `WAIVED_SHORTFALL` sibling (KEPT_CHANGE shape). Settlements: existing COUNTERPARTY_DISCOUNT. |
| 3 | IN/OUT badge | `WAIVED_SHORTFALL` → none (`no-money`, like KEPT_CHANGE). COUNTERPARTY_DISCOUNT is already metadata-resolved. |
| 4 | Payment legs | No new legs. A reduction lowers the reconcile target, as the payout branch already does. OUT legs combined with a reduction are refused. |
| 5 | Drawers | Unchanged: only the legs actually paid move drawers. |
| 6 | Client propagation | Untouched. The session sibling stamps `client_name` like KEPT_CHANGE. |
| 7 | CUSTOMER_ACCOUNT | A waive never charges the account. When an auto account line hides Remaining, Waive is hidden too. |
| 8 | Supplier/partner ledger | Customer side: owed amount unchanged (invariant 2). Settlements: settlement row = cash paid, plus a DISCOUNT row; the balance closes to 0. |
| 9 | Void path | Loto: generic via the profit stamp. Session: `voidSessionBasket`/`refundSessionBasket`. Supplier settles: widened `_linkedSupplierDiscount` sweep. LOTO settlement: non-reversible (documented). |
| 10 | Profits | Stamped per currency. ProfitRepository Loto kept-change fragments subtract the discount. The new type joins the KEPT_CHANGE profit branches. |
| 11 | Sessions | A Loto discount is refused inside a basket; the basket waive covers it. |
| 12 | Audit viewer | `WAIVED_SHORTFALL` label "Waived" (`transactionText.ts`), visible. |
| 13 | E2E guard | Web e2e with delta + identity. |
| 14 | One obligation one owner | Customer waive: the obligation stays with the counterparty and the loss with the shop's profit. Settlement discount: one DISCOUNT row, owned by the settlement reversal. |
| 15 | Legs vs amount, one predicate | All three settle flows reconcile against `amount − discount` in the same check the posting loop uses. `.changes` check on the new self-stamp. |

**Gate result**: PASS. Re-checked after Phase 1: no new violation. Debt noted under III.

## Project Structure

### Documentation (this feature)

```text
specs/310-waive-everywhere/
├── spec.md
├── plan.md            # this file
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/payloads.md
├── checklists/requirements.md
└── tasks.md           # /speckit-tasks
```

### Source Code (touched areas)

```text
packages/core/src/
├── validators/exchange.ts            # SHORTFALL_MAX, isWithinShortfallMax
├── validators/{loto,session,supplier}.ts
├── repositories/keptChange.ts        # customer reduction claim
├── repositories/LotoTicketRepository.ts
├── repositories/LotoCheckpointRepository.ts
├── repositories/SupplierRepository.ts  # shared bundled-discount writer
├── repositories/TransactionRepository.ts  # widened discount sweep
├── repositories/ProfitRepository.ts
├── services/{SessionCheckoutService,SessionPaymentService,LotoService,SupplierService}.ts
├── constants/{transactionTypes,postingRules,profitRowClass,…}.ts
└── offline/testHelpers/{fixtures,onlineOnlyExempt}.ts
packages/ui/src/components/ui/MultiPaymentInput.tsx
electron-app/{handlers/lotoHandlers.ts,preload.ts}
backend/src/api/loto.ts
frontend/src/
├── types/electron.d.ts
├── api/backendApi.ts (types only)
├── features/recharge/components/PaymentSheet.tsx
├── features/sales/pages/POS/components/CheckoutModal.tsx
├── features/{debts,partners,suppliers,expenses,custom-services,loto,sessions}/…
└── features/audit/cashFlow.ts, transactionText
docs/FEATURE_GUIDE.md (§4.1 cap, §9 LOTO discount note), docs/release-notes/UNRELEASED.md
```

**Structure Decision**: existing monorepo layout; no new package or folder.

## Delivery order

1. Cap constant + MPI (unblocks all of Group A).
2. Group A page wiring.
3. Payout cap raise (server + tests).
4. Core reduction claim → Loto ticket → Session checkout.
5. Shared supplier discount writer + reversal widening → batch settle → account settle → LOTO settlement.
6. Docs, release note, web e2e.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| Hand-written supplier settle preload / `SettleAccountRequest` types gain a key instead of being re-derived | keep this change reviewable | the full rule-21 rewrite touches unrelated settle fields; logged as follow-up debt |
