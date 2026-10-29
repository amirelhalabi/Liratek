# Quickstart: validate Loto on Settle Account (LIRA-351)

## Automated (affected tests only; ask the owner before running)

- Core: the backfill migration test (settled checkpoints stamped, unsettled left open, balance unchanged, open-queue sum = ledger balance per currency); `settlesByDay` / `billsStayOnTickList` / `calendarTakesCommission` for LOTO; a Loto day with 3 tickets and a prize nets to Loto owes 156,020 LBP; settling it as COLLECT closes it, CASH → General; overpay → Loto credit; settlement void reopens the day; calendar-covered ticket void → credit; checkpoint-settled ticket void still refused; refusals of the old paths.
- Desktop handlers + REST: the refusal envelopes for `loto:settle-checkpoint(s)`, `loto:mark-checkpoint-settled`, cashflow for Loto.
- Frontend: Suppliers page with Loto selected shows Settle Account, no Pay / Receive tab, no Settle tick list; Loto page shows checkpoints with no settle action.
- Web e2e: a new `lira-web-0xx-loto-settle-calendar` spec — sell 3 tickets, pay a prize, open Suppliers → Loto → Settle Account, settle the day, check the drawer delta and the day settled.

## Manual, on the test tenant then Cornertech (after the owner pushes)

1. Before deploying, note Loto's balance (Suppliers → Loto).
2. Deploy; open Suppliers → Loto: the balance is identical; Settle Account is there; no tabs.
3. Open the calendar: days covered by settled checkpoints show settled; only recent unsettled days are open; "left this month" plus Loto credit equals the balance.
4. Settle one open day; check the drawer moved by that day's net and the day turned green.
5. Loto page: checkpoints listed with totals, no settle button.
6. Report any shop where the open-queue sum differs from the balance (a past checkpoint settled with typed totals) with the amount, for the owner to decide.
