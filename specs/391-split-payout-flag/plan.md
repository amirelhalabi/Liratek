# Implementation Plan: LIRA-391 — split payout books the whole payout to the account

**Branch**: `main` (edit in place, ticket dir `391-split-payout-flag`) | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)

## Summary

A payout page sends a stale single-method flag (`cashoutMethod`) next to split `payments[]` legs,
and core branches on the flag before the legs. Fix in two layers:

1. **Core fence** (`packages/core/src/utils/paymentLegs.ts`, pure, re-exported by `payments.ts`):
   - **Routing** — `lumpFlagWhenNoLegs(flag, legs)` returns the flag only when there is no IN leg
     with a non-zero amount. Every money-routing branch reads the method through it, so legs
     present ⇒ the per-leg path (reconcile + per-leg posting), even when every leg is
     CUSTOMER_ACCOUNT.
   - **Eligibility** — `payoutMethodOf(flag, legs)` returns the method the legs share (or
     `"MIXED"`), or the flag when there are no legs. Used where the code asks "what kind of
     payout is this" (kept change / round-up / added-change refusals, `systemAdded` gate, legacy
     fee method, `chargesCustomerAccount`), so today's refusals for an all-account or all-wallet
     payout stay, and a stale flag can no longer trigger them.
2. **Page helper** (`frontend/src/utils/paymentUtils.ts` → `lumpMethodOf(lines)`): the method
   only when every line shares it. Replaces every `lines.length === 1` method setter / ternary,
   so pages stop sending a stale flag. A jest guard forbids new ones.

## Technical Context

**Language/Version**: TypeScript 5 (strict)
**Primary Dependencies**: React 19, Electron 31, Express backend, better-sqlite3
**Storage**: SQLite (no schema change, no migration)
**Testing**: jest (core real-DB, frontend RTL), Playwright web e2e
**Target Platform**: desktop (IPC) + web (REST) — same core
**Project Type**: monorepo (frontend / electron-app / backend / packages/core)
**Performance Goals**: n/a (no new queries)
**Constraints**: legacy no-leg callers keep the flag path unchanged; no throw on a stale flag
**Scale/Scope**: 2 core repositories' branches (Binance/app-wallet RECEIVE, system OMT/WHISH RECEIVE), 7 frontend sites

## Constitution Check

| Principle | Status |
|---|---|
| I. One core, two transports | Pass — fix lives in core; both transports already send the same payload builder |
| II. Layer boundaries | Pass — no SQL moves; helpers are pure |
| III. Contracts defined once | Pass — one routing predicate, one eligibility helper, one page helper (rule 14) |
| IV. Money integrity | Pass — per-leg path keeps `reconcileLegs`; refund symmetry test (rule 20); variant sweep (rule 28d) |
| V. Data and security | Pass — no schema/auth change |
| VI. Testing | Pass — guards written and run failing-first (rule 17), web e2e for both cash-out forms |
| VII. Code quality | Pass — no `any`, module loggers unchanged |

Post-design re-check: pass (no new entity, no new endpoint).

## Project Structure

```text
specs/391-split-payout-flag/
├── spec.md  plan.md  research.md  data-model.md  quickstart.md  tasks.md
└── contracts/lump-flag-fence.md

packages/core/src/utils/paymentLegs.ts                      # fence helpers
packages/core/src/repositories/FinancialServiceRepository.ts # sites: 1640, 3495, 3569, 3643, 4815/4857, 5446/5467/5554/5574/5645/5714
packages/core/src/repositories/__tests__/splitPayoutFlag.sweep.test.ts   # FR-4 + FR-7
frontend/src/utils/paymentUtils.ts                           # lumpMethodOf
frontend/src/features/recharge/pages/Recharge/index.tsx      # Binance
frontend/src/features/recharge/components/{OmtWhishAppTransferForm,FinancialForm,KatshForm,TelecomForm}.tsx
frontend/src/features/services/pages/Services/index.tsx
frontend/src/utils/__tests__/lumpMethodSetter.guard.test.ts  # FR-5
frontend/tests/e2e-web/lira-web-NNN-*.spec.ts                # FR-6 (two specs)
```

**Structure Decision**: existing monorepo layout; no new modules.

## Complexity Tracking

None.
