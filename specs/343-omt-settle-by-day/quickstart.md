# Quickstart: validating OMT settlement by day (LIRA-343)

## Ground rules (owner)

- **Ask before running any suite.** Run only the affected test files, passed by explicit path, never full jest suites (RAM).
- **No Electron on the owner's Mac.** Desktop e2e specs may be edited but not run here. Prove behaviour with the web e2e suite (`node scripts/run-e2e.mjs web`) and core/frontend jest.
- After a core change, rebuild and sync core (`cd packages/core && npm run build`, then `cp -r packages/core/dist/. node_modules/@liratek/core/dist/`).
- A green run counts only after checking that the tests actually ran: count and elapsed time (rule 28).

## 1. Allocator: the owner's tables

`packages/core/src/utils/__tests__/accountSettleAllocation.accountCredits.test.ts` (new).

- Table-driven over the two tables in `contracts/settle-account-days.md`.
- Seen failing first (no `account_credits` input yet), then passing.
- The existing allocator tests stay green unchanged (empty `account_credits` gives today's output).

## 2. Days from rows

`packages/core/src/utils/__tests__/settleDays.test.ts` (new), using the mock's October:

| Day | Expect |
| --- | --- |
| 14 Oct | `NONE` |
| 1–20 Oct (with rows) | `SETTLED` |
| 21 Oct | `PARTIAL`, left $47, paid % ≈ 83 |
| 22 Oct | `PARTIAL`, $ `PAID`, LBP `OWED`, left 900,000 LBP |
| 25 Oct (Sunday) | `UNPAID`, left $200 and 990,000 LBP |
| Month left | $482.00 + 1,890,000 LBP (including today's $60) |

- An account credit row on 20 Oct leaves 20 Oct `SETTLED`.
- The rule 29 guard (`browserEntryIsNodeFree.guard.test.ts`) stays green with `settleDays.ts` reachable from `browser.ts`.

## 3. Repository: range mode and shop day

`SupplierRepository.lira343MonthRows.test.ts` (new, built on `testHelpers/omtAccountDb.ts`).

- **Shop day**: a row stored `2026-10-24 22:30:00` UTC with a client offset of +180 returns `shop_day = 2026-10-25`.
- **Invariant**: for every day and currency, Σ(owed − covered) over range rows = Σ remaining over that day's queue rows.
- **Credit classification**: the OMT App cash-out → `DAY`; overpay `PAYMENT` with the settlement's `transaction_id` → `ACCOUNT`; the amount-first commission credit → `ACCOUNT`; a manual Pay / Receive → `ACCOUNT`.

## 4. Settlement end to end (core)

`SupplierRepository.lira343SettleDays.test.ts` (new).

- Pick 23–25 Oct and pay $250 + 990,000 LBP. Expect:
  - coverage NETTING $40 (receive → #421);
  - PAYMENT $80, $95, $75;
  - 25 Oct $125 left;
  - LBP closed;
  - no row on an unpicked day touched.
- The same with an $8.70 account credit and $366.30 paid: all closed, credit used.
- Old history: a $300 credit dated 2 Oct and $300 of debts dated 28–30 Sep, settled up to 30 Sep with money 0 → all three closed; no drawer moved.
- Undo each of the above: every ledger nets to 0 per currency (FR-020).
- Undo #A after #B used #A's $8.70 credit → allowed; #A's days reopen, #B unchanged, account shows +$8.70 owed to OMT; balance = Σ open remaining.
- Void transfer #440 ($35) paid by #10061 → allowed; #10061 unchanged; account shows $35 OMT credit.
- Seeded property test: random settle / undo / void sequences keep balance = Σ open remaining, per currency.

## 5. Sheet (frontend jest)

`AccountSettleSheet.lira343Calendar.test.tsx` (new).

- Default selection = open days before today, across months; today not picked.
- The credit amount is pre-filled with min(owed, credit); typing 0 makes the payment the full amount; typing a different payment leaves the credit as set.
- Unticking a transfer in a day's details changes the payload and the totals.
- The "1 unselected day in September" link appears only while 30 Sep is unpicked.
- The payload is built by `buildDaySelections`; field names come from the schema (rule 24).
- `useApi` mock returns a stable reference (rule 25).

## 6. Web e2e

`frontend/tests/e2e-web/lira-web-0xx-omt-settle-by-day.spec.ts` (new, next free number).

1. Seed OMT transfers on two days plus a receive.
2. Open Settle Account and check the day colours.
3. Unpick one day and settle.
4. Assert by identity and deltas (rule 15): the picked days' transfers are closed, the unpicked one is still open, and the drawer delta equals the amount paid.
5. Save a landscape screenshot of the sheet to `frontend/public/whats-new/<next version>/omt-settle-calendar.png` for the What's new card (rule 30).

## 7. Speed check (research R11)

On the test shop, time the month read (`account-month-rows`) for October. Record rows returned and elapsed time in `tasks.md`. If it is over 300 ms, batch the coverage read first.

## 8. Gates

`yarn lint`, `yarn typecheck`, `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence` (should be unchanged; no migration) and `node scripts/build-release-notes.cjs --check`. Ask before the full jest and web suites.
