# Quickstart — validating LIRA-324 (Whish App USD mode)

Run locally on this Mac with the web app (desktop e2e is not run on this machine).

## Prerequisites

1. `yarn build:core`
2. `yarn dev:web` (frontend `localhost:5173`, backend `127.0.0.1:4300`, dev DB `~/Documents/LiraTek/liratek-web-dev.db`). The backend applies migration v218 on start.
3. Log in as the local admin (README).

## Scenarios

| # | Do | Expect |
|---|---|---|
| 1 | Recharge → Whish App → Bills on a fresh browser profile | Switch shows **LBP**; grid identical to before the feature |
| 2 | Pick **USD** | Cards show `$` cost/sell; USD-only items (e.g. Razer $1, Yalla Live $25) appear; LBP-only items (e.g. Genshin Impact) and all MTC/Alfa Prepaid cards are gone |
| 3 | Reload the page | Still **USD** |
| 4 | Select 2 items, switch to LBP | Confirmation; Continue clears the 2 items and shows LBP |
| 5 | USD mode: sell "PSN $10 - LEBANON" paid $10 cash | Transaction in USD; Whish App drawer USD −10.00; cash drawer USD +10.00; profit $0.00 (sell = cost) |
| 6 | Same, paid in LBP | Payment window converts at the shop rate like other USD sales |
| 7 | Void the sale from 5 | Whish App USD, cash drawer and profit back to their values before step 5 |
| 8 | USD mode, For Partner sale | Partner owed in USD |
| 9 | USD mode, add to a customer session, then check out | Basket line and checkout in USD |
| 10 | Settings → Mobile Services → a Whish App item | Edit Cost/Sell (USD); clearing both hides it from USD mode |
| 11 | iPick / Katsh / Whish App Transfer | No switch; unchanged |

## Automated checks

- Core: v218 migration test (fills only NULL USD prices, adds USD-only items, skips empty catalogs, idempotent, `down` safe); USD sale characterization (cost from `Whish_App` USD, `profit_usd`, void nets 0 per currency; For Partner; session).
- Frontend: `isUsdSellable`/`isLbpSellable` unit test; FinancialForm USD payload test (field names from the schema, rule 24); switch memory + confirm-clear test; Settings USD fields test.
- Web e2e `lira-web-0NN`: USD sale on Whish App Bills, delta assertions on drawers (rule 15).
- Gates: `yarn typecheck`, `yarn lint`, `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`, release-notes check.
