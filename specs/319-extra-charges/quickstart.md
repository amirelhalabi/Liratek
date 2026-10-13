# Quickstart: validating Extra charges (LIRA-319)

## Prerequisites

- Node ABI for better-sqlite3 (`yarn rebuild:node`) for core jest and web e2e; core rebuilt and synced after core changes (`cd packages/core && npm run build && cp -r dist/. ../../node_modules/@liratek/core/dist/`).
- Desktop e2e is not run on the owner's Mac; web e2e is (`node scripts/run-e2e.mjs web`, or `cd frontend && npx playwright test --config playwright.web.config.ts`).

## Scenarios (each must pass)

1. **Owner's example (POS, cash)** — item cost $5 price $6, "+ Extra" 1, pay $7 cash. Expect: SALE row amount 7, profit 1, extra_usd 1; General USD drawer +7; sale_items price 6 cost 5; Profits by module: SALE profit 1, "Extra charges" 1. (SC-002)
2. **Wallet** — same with Whish: Whish drawer +7.
3. **Shortfall** — extra 1, pay 6: payment box shows 1 owed; with a client on account the client's debt is +1 (or +7 on full account). (US5)
4. **Void** — void scenario 1: drawer −7, SALE leaves profit, "Extra charges" back to 0. (SC-003)
5. **Full refund** — REFUND row amount −7, extra −1; "Extra charges" nets 0.
6. **Partial refund** — items $10 + $5, extra $3, refund the $5 item: customer gets $6.00, REFUND extra −1.00, "Extra charges" 2.00. Undo the refund: back to 3.00.
7. **Each page** (FR-011) — Maintenance, Custom Services, Loto, MTC/Alfa sale, OMT send, Katsh, crypto send: extra recorded on the row, item/fee/commission unchanged, counted under "Extra charges". (SC-004)
8. **Session basket** — two items, extra 2 at session checkout: one EXTRA_CHARGE row, basket charge + 2, refund one item → its share back.
9. **Refusals** — discount + extra together; extra on a for-partner sale; extra above the total; extra on a basket item: each refused with its message, nothing posted.
10. **Both apps** — scenarios 1, 4 and 6 in web e2e; desktop covered by the shared core tests (rule 19).
11. **Receipts** — POS 58/80 mm and service receipt show "Extra +$1.00" between the discount slot and the total.

## Tests to expect

Core jest guards written first (rule 17) for scenarios 1, 4–6, 8, 9 per module; a schema guard that `extra_*` are optional without default (offline replay); `moduleDebtTypes`/`browserEntryIsNodeFree` guards stay green; frontend jest for the switch and each page payload (parsed through the schema, rule 24); web e2e for 1, 4, 6.
