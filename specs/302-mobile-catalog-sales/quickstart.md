# Quickstart: validate phone Katsh / iPick catalog sales (LIRA-302)

## Prerequisites

- Local backend on port 4310 with the `mobiletest` tenant (LIRA-289 quickstart); the phone's
  `.env.development.local` points at it. iOS simulator dev build; Maestro (`/opt/homebrew/bin/maestro`).
- In the web app on the same backend: Katsh and iPick catalog items with cost and price (Settings → Mobile
  services), at least one MTC/Alfa card; a USD→LBP rate set (Settings → Rates); a customer.

## Automated checks

```bash
yarn typecheck && yarn lint
yarn workspace @liratek/core test -- catalogSale exchangeRates phoneCatalogSales   # new suites
yarn workspace @liratek/frontend test -- KatshForm                                  # the 8 existing suites, unchanged
yarn test                                                                           # everything; confirm counts ran (rule 28)
```

The money suite covers Katsh and iPick × account / Whish / OMT × LBP / USD: provider drawer −cost, wallet or debt
+price (or the USD amount), client stamped, profit = price − cost, void → every delta back to 0 (SC-002, SC-003).

## Parity check (SC-002)

Record the same two-item Katsh cart once on the web and once on the phone, both on the same customer's account.
Compare the two transactions on the web Transactions page: amount, cost, profit, payment, description must match.
For a USD sale, make the web sale at the default rate (do not edit the rate on the web payment sheet).

## Manual scenarios (simulator, then Android)

1. Sell → Katsh: items grouped by category, search works, items without price/cost absent, MTC/Alfa cards present
   with no "Only Days".
2. Add two items (one ×2) → cart total correct → On account without a customer → Save refuses.
3. Pick the customer → Save → "Saved" → Home: Katsh balance −cost; Debts: customer +price; Activity: "Katsh ·
   customer" with the items.
4. Same cart, Whish wallet, USD → the USD amount shown matches price ÷ rate → Save → Whish App +USD amount.
5. Stop the backend's rate (or remove the rate) → USD option disabled with a reason; LBP still saves.
6. Double tap Save; then Save with no connection, reconnect, Save again → one sale only.
7. Void the phone sale on the web → every balance and the debt back to before.
8. Stale item: put an item in the phone cart, then switch it off (or change its price) on the web, then Save on the
   phone → the save is blocked, the line is flagged, nothing is booked.
