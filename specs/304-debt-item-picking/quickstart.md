# Quickstart: validating LIRA-304

Desktop e2e cannot run on this Mac (owner rule); desktop parity is proven by core jest here and the desktop e2e job in CI. Web parity is proven by a web e2e spec.

## Prerequisites
- `yarn install`; Node ABI for core jest and web e2e: `yarn rebuild:node`, probe with
  `node -e "const D=require('better-sqlite3'); new D(':memory:'); console.log('Node ABI')"`.
- After core changes: `cd packages/core && npm run build && cp -r dist/. ../../node_modules/@liratek/core/dist/`.

## 1. Core guard tests (write first, see them fail, then fix — rule 17)
```
yarn workspace @liratek/core test -- DebtRepository.routingCap
yarn workspace @liratek/core test -- DebtRepository.routingAfterRefund
yarn workspace @liratek/core test -- TransactionRepository.refundRoutedRepayment
yarn workspace @liratek/core test -- sessionMemberCoverage.invariant
yarn workspace @liratek/core test -- DebtRepository.repaymentTargets
yarn workspace @liratek/core test -- debtRepaymentAllocation
```
Confirm each suite actually ran (test count, elapsed time — rule 28).

**Expected outcomes** (OMT-primary shop, rate 89,000, debt = OMT send $101 + cable $14 + Loto 200,000 LBP):

| Scenario | OMT Cash Drawer | General | Items after |
|---|---|---|---|
| Basket on account, settle $115 + 200,000 LBP cash | +$101 | +$14, +200,000 LBP | all paid |
| Same three as separate visits, same settlement | +$101 | +$14, +200,000 LBP | all paid |
| Tick OMT, pay $50 | +$50 | 0 | OMT open $51 |
| Tick nothing, pay $50 | +$50 | 0 | cable paid, OMT open $65 (coverage sales first) |
| Then tick OMT, pay $65 | +$51 (cap) | +$14 | OMT paid |
| Tick cable only, pay $14 | 0 | +$14 | cable paid |
| Tick cable only, pay $60 | +$46 | +$14 | cable paid, OMT open $55 |
| Pay 8,989,000 LBP for OMT $101 | +8,989,000 LBP | 0 | OMT paid |
| Whish (system) debt in OMT shop, $50 cash | 0 | +$50 | paid |
| Whish App debt, $30 cash | 0 | +$30 | paid |
| Void any of the above | back to before | back to before | reopened exactly |

## 2. Web e2e
`node scripts/run-e2e.mjs web -g "lira-web-051"` — new spec `frontend/tests/e2e-web/lira-web-051-debt-item-picking.spec.ts`: basket on account → settle with OMT ticked → assert drawer DELTAS and the payment-detail line text; separate visits → same deltas (rule 15: identity + deltas, never row position).

## 3. Manual check on the test shop (web)
Repeat the 2026-10-10 run (session with OMT $100, cable, Loto 200,000 LBP on account, then settle) and confirm:
- Accounts page: basket line expands to the three items with open amounts.
- Repayment modal: items tickable; "Goes to" shows OMT Cash Drawer $101 · General $14 + 200,000 LBP.
- Transactions page: `In — Cash: $115 + 200,000 LBP {$101 OMT Cash Drawer · $14 + 200,000 LBP General}` and `Out — Customer Account: $115 + 200,000 LBP`.
- Dashboard drawer balances moved by exactly those amounts.
- Checkpoint: OMT Cash Drawer shows per-currency match plus "Total ≈ $X".

## 4. Gates
`yarn typecheck`, `yarn lint`, `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`, core + frontend jest. Release note in `docs/release-notes/UNRELEASED.md`.
