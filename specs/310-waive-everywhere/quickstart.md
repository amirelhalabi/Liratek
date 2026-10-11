# Quickstart: validating LIRA-310

Desktop Electron e2e must not run on this Mac (owner rule). Validate with core jest, frontend jest and web e2e. CI runs the Electron suite.

## Prerequisites
```bash
yarn rebuild:node                          # Node ABI for core jest + web e2e
cd packages/core && npm run build && cd ../.. && cp -r packages/core/dist/. node_modules/@liratek/core/dist/
```

## 1. Gates
```bash
yarn typecheck      # confirm it really ran: ~2 min, not 2 s (CLAUDE.md rule 28a)
yarn lint
node scripts/check-tenant-scoping.mjs
yarn check:bind-arity
```

## 2. Core money proofs (`yarn workspace @liratek/core test -- <pattern>`)

| Pattern | Proves |
| --- | --- |
| `shortfallMax` | cap at $5.00 / 450,000 accepted, at $5.01 / 450,001 refused, both payer kinds |
| `keptChange` | customer reduction: claim = gap, over cap refused, combined with kept refused, no IN legs refused |
| `LotoTicketRepository.lira310` | discount lowers profit only; LOTO TOP_UP unchanged; void and refund net to 0 |
| `SessionCheckout.lira310` | `WAIVED_SHORTFALL` row booked; basket void and refund net drawers, profit and debt to 0 |
| `SupplierRepository.lira310` | account PAY/COLLECT and batch settle with discount: balance closes to 0; void sweeps the discount (ledger + profit) to 0 |
| `LotoCheckpointRepository.lira310` | both directions: balance closes to 0; discount profit sign correct |
| `offline` bindings | `bindings.complete` / `channelPolicy.complete` green with new fixtures |

Each guard is written and run red **before** its fix (rule 17). Record the failing output in `tasks.md`.

## 3. Frontend (`yarn workspace @liratek/frontend test -- <pattern>`)
- `MultiPaymentInput.waive` covers:
  - the built-in path (shows, hidden over `maxDiscount`, hidden on payout, hidden without `onDiscountChange`);
  - the external path (rounded amount, per-currency second argument, `waiveRemainingMax`);
  - the boundaries at $5 / 450,000;
  - Waive hidden whenever Remaining is hidden (incl. auto-debt with a client attached).
- Page wiring, one test each: Debts (splits into USD/LBP discount), Partners, Expenses (bill lowered), Custom Services (price − discount sent), Loto (discount sent), Session (waived sent, Confirm enabled), AccountSettleSheet / batch settle / LOTO settlement (discount sent).

## 4. Web e2e (`node scripts/run-e2e.mjs web -g "lira-web-057"`)
Spec `frontend/tests/e2e-web/lira-web-057-waive.spec.ts`. It uses identity plus delta assertions (rule 15) and covers:
- an Alfa card sale $0.50 short → Waive → profit = the identical full-price card's profit − 0.50;
- a Loto ticket 20,000 LBP short → discount → LOTO supplier delta equals a full-price ticket's (sale − commission); profit = commission − 20,000; a discount above the commission is refused;
- a session basket $3 short → Waive → `WAIVED_SHORTFALL` row for that session with profit −3; a claim that is not the real gap, and a $5.01 claim, are refused with no cash moved;
- a supplier batch $3 short → Waive → the full amount owed is closed, then void → supplier balance and drawer back to their pre-settle values;
- the Expenses page: a $3 shortfall shows Waive in the Remaining row; clicking it lowers the bill and the Remaining row goes away.

## 5. Manual smoke (web app)
1. POS: $10 sale, pay $5 → Waive shows; pay $4.99 → no Waive.
2. OMT/Whish system send on the Services page: no Waive anywhere.
3. OMT receive $104.50, hand $100 → green "Keeping $4.50 as profit".
