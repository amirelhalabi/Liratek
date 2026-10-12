# Implementation Plan: Wrong-Number Card Recharge

**Branch**: `312-wrong-number-recharge` (work on `main`) | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md) | **Ticket**: LIRA-312

## Summary

The code showed that a card-sale refund always gives the provider balance
back, and that a walk-in card sale is one row for the whole cart, with no
record of which card or number. So "Refund as wrong number" is **not a
refund**:

- **The sale stays untouched.** It now stands for the correct recharge of the
  right number: the customer paid, and its cost is the redo.
- **The wrong recharge is booked as a wrong-number expense.** The existing
  iPick/Katsh/Whish App stock-use expense takes the card's cost from the
  provider balance as a loss.
- **Both paths use one record.** Path A (before saving, from Expenses) and
  path B (from the sale row) call one `WrongNumberService` that writes this
  expense plus a `wrong_number_cards` record. The cashier picks the card and
  types both numbers.
- **Credits received** is a new reversible `WRONG_NUMBER_CREDITS`
  transaction, in the shape of the credit buy-back: the chosen shop line goes
  up +X and the carrier drawer +X USD. It stamps `profit_lbp = X ×
  telecom_credit_sell_price_lbp` (the resold-credit price, 100,000 per $1, owner decision), so the LBP
  loss nets on the Profits page.
- **Undo** uses the generic void, plus one guard: the expense cannot be
  voided while credits entries are active.

Research R1–R8 has the details and line references.

## Technical Context

- **Language/Version**: TypeScript strict; React 19 + Vite; Electron 31; Node backend
- **Storage**: SQLite. Migration v212 adds `wrong_number_cards`.
- **Testing**: jest (core, backend, frontend, handlers) and a web e2e. Suites run only after asking the owner.
- **Constraints**:
  - dual transport (rule 19);
  - client day (rule 27);
  - money checklist (rule 18);
  - reversal owners (rule 20);
  - offline channel policy (online-only);
  - a parallel session is editing Expenses/Profits files, so the Profits and Expenses tasks wait for its commit.

## Constitution Check: PASS

| Principle | Compliance |
|---|---|
| I | IPC + REST over one `WrongNumberService`; `useApi()` only; one payload per operation; client day for `expense_date`. |
| II | SQL lives in `WrongNumberRepository`; the expense goes through `ExpenseRepository.createStockExpense`; the line movement goes through `CarrierLineService.applyMovement`. |
| III | Schemas in `validators/wrongNumber.ts`; adapter types use `z.input`; the "active credits" predicate is defined once. |
| IV | Walked through §13 below; each row has a reversal owner; net-zero tests per ledger and currency (W5, W8, W9). |
| V | `tenant_id` everywhere; roles admin+staff to record, admin to void; migration in both files. |
| VI | Tests are written first and seen failing (quickstart W1–W10); a web e2e. |
| VII | Strict TS; module loggers; stable `useApi` mocks. |

### FEATURE_GUIDE §13 (WRONG_NUMBER_CREDITS + wrong-number expense)

1. **Plumbing:** v212; repo → service → IPC + REST; preload / `electron.d.ts`.
2. **Transaction row:** new `WRONG_NUMBER_CREDITS`, `source_table='wrong_number_cards'`, `profit_lbp` stamped, `exchange_rate` stamped, no client. The expense keeps its existing `EXPENSE_*` type.
3. **IN/OUT badge:** `WRONG_NUMBER_CREDITS` → `"in"` (credit arrives on a drawer). The expense stays `"out"`.
4. **Legs:** one `+X` USD leg; no customer legs and no change legs.
5. **Drawers:** the carrier drawer (USD), keeping drawer = Σ shop-line credits. The expense debits the provider drawer (LBP).
6. **Client propagation:** none.
7. **Customer account:** N/A.
8. **Supplier/partner ledger:** none.
9. **Void:** generic; plus the expense guard (R6).
10. **Profits:** a new "Wrong-number credits recovered" LBP line; `PROFIT_TXN_TYPES` + the gross term; voided rows drop out.
11. **Sessions:** works on basket members, because the sale is untouched.
12. **Audit:** labels "Wrong number card" (category) and "Credits recovered"; both visible by default.
13. **E2E:** web spec with deltas.
14. **One owner per obligation:** the shop-line credit is owned by `carrier_lines` + the drawer. The loss is owned by the expense, and the recovery by the profit stamp. No double booking.
15. **Legs vs amount:** single leg = amount; no `payments[]` input.

## Project Structure

```text
packages/core/src/
  db/migrations/index.ts (v212), constants/transactionTypes.ts, postingRules.ts,
  utils/transactionText.ts, utils/cashFlow.ts, offline/channelPolicy.ts, offline/idRange.ts,
  constants/resetTables.ts, validators/wrongNumber.ts (new),
  repositories/WrongNumberRepository.ts (new), repositories/TransactionRepository.ts (guard),
  repositories/ProfitRepository.ts (+ getWrongNumberRecoveryTotals),
  services/WrongNumberService.ts (new), services/ProfitService.ts (gross term)
electron-app/ create_db.sql, handlers/wrongNumberHandlers.ts (new), main.ts, preload.ts, schemas/index.ts
backend/src/ api/wrongNumbers.ts (new), server.ts
frontend/src/
  api/backendApi.ts, ElectronApiAdapter.ts, types/electron.d.ts
  features/audit/ (row action "Wrong number…", actionGating predicate)
  features/wrongNumbers/components/WrongNumberPanel.tsx (new: card picker, numbers, first credits)
  features/wrongNumbers/components/CreditsReceivedPanel.tsx (new)
  features/expenses/pages/Expenses/index.tsx ("Wrong number" tick on a card item)
  features/profits/ (the new line)
packages/ui/src/api/types.ts
frontend/tests/e2e-web/lira-web-NNN-wrong-number.spec.ts
```

## Delivery order

1. Core: migration, repository, service (record + credits), type registration, guard, profit line. Tests W1–W10 first.
2. Transports: IPC, REST and adapters.
3. UI: Transactions row action → WrongNumberPanel; CreditsReceivedPanel (from the row and from the expense); the Expenses tick.
4. Web e2e, release notes, sprint entry.

The Expenses and Profits UI steps wait until the parallel session commits its LIRA-310/311 Expenses and Profits edits.

## Owner decisions (2026-10-12)

1. **Roles:** cashiers and admins record wrong numbers and credits. Undo (void) is admin-only.
2. **Value of recovered credit:** the resold-credit price (`telecom_credit_sell_price_lbp`, Settings → Mobile Services, 100,000 per $1). A 1,200,000 card with $6 back shows a 600,000 loss.

## Complexity Tracking

No constitution violations, so this section is empty.
