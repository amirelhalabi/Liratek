# Implementation Plan: Whish App "Only Days" for MTC / Alfa prepaid cards

**Branch**: `406-whish-app-only-days` (work on `main`) | **Date**: 2026-11-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/406-whish-app-only-days/spec.md`

## Summary

Whish App sells the same 13 MTC / Alfa cards as Katsh and iPick and already carries their Only Days catalog data, but the screen has no Only Days option and the server refuses to book returned credit for `WHISH_APP`. The plan reuses the Katsh / iPick machinery end to end instead of copying it:

1. **Server**: allow `WHISH_APP` in the one credit-return gate (`isTelecomResellerApp`, `FinancialServiceRepository`), LBP only. Nothing else in core changes: the drawer leg, line movement, profit offset and reversal are provider-agnostic.
2. **Shared pricing**: move Katsh's module-private Only Days pricing (`resolveOnlyDaysPricing`, `calcPrice`, `lineUnitPriceOf`, the toggle default) and its pricing-data load into a shared module and hook, used by both KatshForm and FinancialForm (rule 14).
3. **Shared panel**: move Katsh's Only Days panel (checkbox, returned credit, days / credit price, kept credit, total) into one component rendered by both grids.
4. **Whish App cart**: `WhishCartLine` gains the same Only Days fields as `CatalogCartLine`; FinancialForm gets the toggle handlers and the panel (LBP mode only).
5. **Four payload builders**, each fed by one per-unit derivation shared with `catalogBatchSubItems`: walk-in per-unit loop, `whishBatchSubItems` (session basket + basket checkout), and the `WHISH_APP` branch of `buildPartnerOrderPayload`.

## Technical Context

**Language/Version**: TypeScript (strict), React 19, Node (Electron 31 main + Fly backend)

**Primary Dependencies**: `@liratek/core` (repositories, validators, `utils/telecomCredit.ts`), `@liratek/ui` `useApi()`, TanStack Query, Zod

**Storage**: SQLite / SQLCipher. **No migration**: Whish App cards already carry `credits`, `validity_days`, `days_cost_lbp`, `sell_days_lbp`, `max_returned_credits_usd` (verified on the seeded screenshot shop: 13 per provider)

**Testing**: core jest (real schema via `create_db.sql` + migrations), frontend jest (RTL), web Playwright e2e (`frontend/tests/e2e-web/lira-web-*`). Desktop Electron e2e cannot run on this Mac (owner rule)

**Target Platform**: Electron desktop (IPC) + multi-tenant web (REST on Fly), same core

**Project Type**: monorepo desktop + web app

**Performance Goals**: no change (one extra map lookup per card render)

**Constraints**: rules 14, 16, 19, 20, 22, 23, 24, 25 (see Constitution Check); LBP only for Whish App Only Days

**Scale/Scope**: 13 Whish App cards; 4 sale modes x 2 transports

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How the plan meets it |
| --- | --- |
| I. One core, two transports | No new endpoint. Every mode already posts through `addOMTTransaction` / session checkout / `rechargeBasketCheckout` / `rechargePartnerOrder`, each dual-transport. Payloads built once per mode (rule 22). |
| II. Layer boundaries | Only the repository gate changes in core; no SQL in services. |
| III. Contracts defined once | Uses existing schema keys (`itemCategory`, `mobileServiceItemId`, `returnedCreditsUsd`, `telecomCreditReturns`); no new keys, so no rule-23 key-set drift. Pricing and per-unit credit-return derivation each live in ONE shared function (rule 14). |
| IV. Money integrity | Same drawer leg / line movement / profit offset as Katsh. Reversal owner unchanged (generic `_reversePayments` + `_reverseCarrierLineMovements`, rule 20); proven by create + void nets to 0 per currency, every mode. USD refusal on the server, not only in the UI. |
| V. Data and security | No new data, no role change. |
| VI. Testing | Failing-first core test for the gate (rule 17); failing-first frontend tests for each payload builder; variant table across modes (rule 28d); web e2e. |
| VII. Code quality | Extraction reduces KatshForm (2,484 lines) rather than growing FinancialForm with a copy. New hook reads `api` through a ref (rule 25). |

**Result**: PASS, no violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/406-whish-app-only-days/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/payloads.md
├── checklists/requirements.md
└── tasks.md          # /speckit-tasks
```

### Source Code (repository root)

```text
packages/core/src/
├── repositories/FinancialServiceRepository.ts          # gate: + WHISH_APP, LBP only
├── repositories/__tests__/FinancialServiceRepository.telecomOnlyDays.test.ts
└── services/__tests__/RechargePartnerOrderService.test.ts   # Whish partner Only Days

frontend/src/features/recharge/
├── utils/onlyDaysPricing.ts          # NEW: moved from KatshForm (pricing + toggle default)
├── hooks/useOnlyDaysPricingData.ts   # NEW: catalog pricing map + tenant credit price (api via ref)
├── components/OnlyDaysPanel.tsx      # NEW: moved from KatshForm ItemCard
├── components/KatshForm.tsx          # uses the three above (no behaviour change)
├── components/FinancialForm.tsx      # Whish App: toggle, panel, priced lines, walk-in loop
├── types/basket.ts                   # WhishCartLine + Only Days fields
├── utils/basketCheckout.ts           # shared per-unit Only Days fields; whishBatchSubItems; partner WHISH_APP branch
└── (tests next to each)

frontend/tests/e2e-web/lira-web-1xx-whish-only-days.spec.ts   # NEW + What's new screenshot
docs/release-notes/UNRELEASED.md, frontend/public/whats-new/<next>/whish-only-days.png
```

**Structure Decision**: extract-then-reuse. Katsh's behaviour is the reference; extraction is a pure move guarded by Katsh's existing tests (`KatshForm.onlyDaysPricing`, `.validityCredits`, `.builderParity`, `.legsCarrier`), which must stay green unchanged.

## Complexity Tracking

None.
