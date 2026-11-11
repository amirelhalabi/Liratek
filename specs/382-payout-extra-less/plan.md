# Implementation Plan: "+ Extra / − Less" line on every payout screen

**Branch**: `382-payout-extra-less` (work on `main`, ticket LIRA-382) | **Date**: 2026-11-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/382-payout-extra-less/spec.md`

## Summary

Payout screens get the same "− Less | + Extra" line pay-in screens show under the total. The line is built into `MultiPaymentInput`'s payout mode, so every payout screen that already wires the LIRA-334 round-up (`onRoundUpChange`) gets it with no page edit. The line only moves what the payout's payment line fills to (owed ± the typed value); the figures sent to the server are still the existing kept change and round-up, computed from the lines exactly as today. No core change, no new payload key, no new booking.

## Technical Context

**Language/Version**: TypeScript 5 (strict), React 19

**Primary Dependencies**: `@liratek/ui` (`MultiPaymentInput`, `DiscountLine`), `@liratek/core` (`isWithinShortfallMax`, `SHORTFALL_MAX`), react-i18next

**Storage**: N/A (no schema change; existing `rounding_given_*` / `kept_change_*` payload fields)

**Testing**: jest + Testing Library (frontend config, which also runs `packages/ui`), Playwright web e2e (`node scripts/run-e2e.mjs web`)

**Target Platform**: Electron desktop app and web app (same React frontend)

**Project Type**: desktop + web app, monorepo

**Performance Goals**: no extra render loop (rule 25); the line adds no effect that feeds itself

**Constraints**: cap $5 / 450,000 LBP via the shared `isWithinShortfallMax`; one source of truth for kept/round-up figures (rule 14)

**Scale/Scope**: one shared component (+ `DiscountLine` label props), i18n en/ar, tests on 5 screens, one web e2e

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                   | Status                                                                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. One core, two transports | PASS — UI-only change in the shared payment box; both transports already carry `rounding_given_*`/`kept_change_*` through the same core services. Proven on web by e2e 095.        |
| II. Layer boundaries        | PASS — no SQL, no service change.                                                                                                                                                  |
| III. Contracts defined once | PASS — no new key; the cap is the shared core predicate; the line reuses `DiscountLine`.                                                                                           |
| IV. Money integrity         | PASS — booking unchanged (LIRA-334 change rounding with its reversal owner; kept change existing path). FEATURE_GUIDE §13 walked: no new transaction row, leg, ledger or reversal. |
| V. Data and security        | N/A                                                                                                                                                                                |
| VI. Testing                 | PASS — guards written first and seen failing; field names read from schema-parsed payloads; e2e by identity + drawer delta.                                                        |
| VII. Code quality           | PASS — no `any`; no `api` in deps.                                                                                                                                                 |

Post-design re-check: unchanged, PASS.

## Project Structure

### Documentation (this feature)

```text
specs/382-payout-extra-less/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/payout-line-ui.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/ui/src/components/ui/
├── MultiPaymentInput.tsx      # payout "− Less | + Extra" line
└── DiscountLine.tsx           # switch labels configurable ("− Less")
packages/ui/src/i18n/locales/{en,ar}/ui.json, payment.json   # labels
frontend/src/shared/testing/payoutExtraLess.ts               # shared test steps
frontend/src/shared/components/__tests__/MultiPaymentInput.payoutExtraLess.test.tsx
frontend/src/features/services/pages/Services/__tests__/Services.payoutExtraLess.test.tsx
frontend/src/features/exchange/pages/Exchange/__tests__/Exchange.payoutExtraLess.test.tsx
frontend/src/features/recharge/components/__tests__/TopUpModal.payoutExtraLess.test.tsx
frontend/src/features/recharge/components/__tests__/OmtWhishAppTransferForm.payoutExtraLess.test.tsx
frontend/tests/e2e-web/lira-web-095-payout-extra-less.spec.ts
frontend/public/whats-new/1.35.0/payout-extra-less.png
```

**Structure Decision**: change confined to the shared payment box in `packages/ui`; pages untouched (they already gate `onRoundUpChange`/`onKeptChange` to cash, walk-in, non-session, non-partner payouts).

## Complexity Tracking

None.
