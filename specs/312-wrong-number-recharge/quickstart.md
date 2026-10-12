# Quickstart: validating Wrong-Number Card Recharge (LIRA-312)

Example used throughout: an iPick **Alfa $7.58** card, cost **770,000 LBP**,
sold for **800,000 LBP**. Credit sell rate R = `telecom_credit_sell_price_lbp` = 100,000.

Assert with snapshots taken just before each action, and match rows by
identity, never by position (rule 15).

**Ask the owner before running any suite** (standing preference).

## Core (jest)

| # | Scenario | Expect |
|---|---|---|
| W1 | Record a wrong number (path A), no credits | iPick drawer −770,000; expense 770,000 "Wrong number card"; record WAITING; net LBP profit −770,000 |
| W2 | Path B on a 800,000 card sale | sale untouched (cash +800,000, its cost leg −770,000, profit +30,000); extra iPick −770,000; record linked to the sale; right number stored |
| W3 | right_number equals wrong_number in another format ("+961 3 …" vs "03 …") | refused |
| W4 | Credits $6.68 on Alfa shop line | line +6.68, Alfa drawer +6.68, `WRONG_NUMBER_CREDITS` profit_lbp = 668,000; remaining loss 102,000; PARTLY_RECOVERED |
| W5 | Credits $4.00 then $2.68 | total 6.68; each entry voids on its own and nets to 0 |
| W6 | Credits above $7.58 in total | refused |
| W7 | MTC shop line for an Alfa card | refused |
| W8 | Void the wrong-number expense with an active credits entry | refused "Undo the credits received first."; after voiding the entry → allowed; iPick +770,000 back, loss 0 |
| W9 | W4 then void the credits entry | line, drawer and profit back to before (net 0, per currency) |
| W10 | Profits for the day | a "Wrong-number credits recovered" line equals Σ active profit_lbp; net LBP = −770,000 + 668,000 = −102,000. Owner check: a 1,200,000 card with $6 back shows −600,000 |

## Frontend (jest)

- Transactions row: "Wrong number…" shows only on active iPick/Katsh/Whish App sales.
- The panel defaults to the card named in the sale note. Payload fields come from the schema (rule 24).
- Expenses: the "Wrong number" tick shows only for an MTC/Alfa card item and sends `recordWrongNumber`.
- Credits received panel: lists only active shop lines of the card's carrier, shows the remaining loss, and caps the amount.

## Web e2e (`frontend/tests/e2e-web/lira-web-NNN-wrong-number.spec.ts`)

Run W2 → W4 → W9 → W8 through the UI, and assert drawer and shop-line deltas
by identity.
