# Implementation Plan: Customer adds change on payouts

**Branch**: `336-customer-adds-change` (work on `main`; ticket LIRA-336) | **Date**: 2026-10-18 | **Spec**: [spec.md](spec.md)

## Summary

On a payout, money the customer hands over above what they owe (up to $5 / 450,000 LBP, in the payout currency) raises the amount the shop pays out by the same value.

- **Payment box:** the "Customer pays" section (useLinesSection / counterFlow) reports the added change, and MultiPaymentInput folds it into the payout target before the kept-change and round-up checks. Screens with no customer section today get an optional one that starts closed.
- **Server:** each payout flow verifies an `added_change_*` claim with one resolver, `resolveAddedChange`, which builds on a pure `measureCustomerLegs` split out of `bookCustomerLegs`. It reconciles the outgoing lines against owed + added, and writes the customer's lines as incoming payment rows.
- No expense is booked and profit does not change. Reversal goes through the existing payment reversal.

## Technical Context

**Language/Version**: TypeScript 5 strict, Node 22
**Primary Dependencies**: React 19, Zod, better-sqlite3/SQLCipher, Express, Electron 31
**Storage**: SQLite. No migration.
**Testing**: jest (core, frontend, ui), affected files only; Playwright web e2e
**Target Platform**: Electron desktop and the web app
**Project Type**: monorepo desktop + web
**Constraints**: offline replay. Only top-level optional keys with no default are added, and no leg element schema changes.
**Scale/Scope**:
- 5 schemas;
- 5 repository flows plus the WHISH fee writer;
- 1 new resolver;
- useLinesSection and MultiPaymentInput;
- 8 screens.

## Constitution Check

| Principle | Status |
| --- | --- |
| I. Two transports | PASS: same channels and core. Payloads are built once per screen; the app transfer goes through `buildWalletTransferPayload`. |
| II. Layers | PASS: logic stays in the repositories and resolver. |
| III. Contracts once | PASS: fields live in the core validators; adapters use `z.input`; the hand-typed preload, electron.d.ts and rechargeHandlers entries are updated (rule 12). |
| IV. Money integrity | PASS: the customer's lines are payment rows, reversed by `_reversePayments` / `voidPickup` (rule 20, proven by create + void tests). No new sibling rows. |
| V. Data/security | PASS: no new SQL beyond the existing writers. |
| VI. Testing | PASS: guard tests first; web e2e `lira-web-076`. |
| VII. Quality | PASS |

## Project Structure

```text
packages/core/src/
  validators/{common,financial,exchange,recharge,holdMoney}.ts
  repositories/moneyPosting.ts            # measureCustomerLegs split
  repositories/addedChange.ts             # NEW resolveAddedChange
  repositories/{FinancialService,Exchange,Recharge,HoldMoney}Repository.ts
  utils/walletTransfer.ts                 # addedChange input
packages/ui/src/components/ui/
  useLinesSection.ts, MultiPaymentInput.tsx, TopUpModal.tsx
  i18n/locales/{en,ar}/payment.json
frontend/src/features/
  services/pages/Services/index.tsx
  recharge/{pages/Recharge/index.tsx, components/{CryptoForm,OmtWhishAppTransferForm,TelecomForm}.tsx}
  exchange/pages/Exchange/index.tsx
  custom-services/components/HoldMoneyPickupSheet.tsx
electron-app/{preload.ts, handlers/rechargeHandlers.ts}, frontend/src/types/electron.d.ts
docs/FEATURE_GUIDE.md, docs/POSTING_MAP.md, docs/release-notes/UNRELEASED.md, current_sprint.md
```

## Complexity Tracking

None.
