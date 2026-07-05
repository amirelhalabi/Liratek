---
name: new-money-feature
description: Use when building or modifying ANY LiraTek flow that moves money — a new payment form, transaction type, provider, module, recharge/financial service, session branch, or void/refund path. Loads the money-rules guide and walks the invariant checklist so nothing (client propagation, IN/OUT, legs, ledgers, profits, voids) is silently dropped.
---

# New money feature — invariant walkthrough

## Step 1 — Load the rules

Read `docs/FEATURE_GUIDE.md` in full. It is the canonical map of every money
invariant, each anchored to the e2e spec that guards it. Also skim
`frontend/tests/e2e-electron/README.md` for the assertion discipline your new
guard test must follow.

## Step 2 — Answer these before writing code

Write down (in your plan or a comment block) the answer for each; "n/a" must be
justified, not assumed:

1. **Transaction row**: which `TRANSACTION_TYPES` constant? What `source_table`/
   `source_id`? Does the action also write an auto `SUPPLIER_PAYMENT` sibling?
2. **IN/OUT badge**: which case in `getCashFlowDirection`
   (`frontend/src/features/audit/cashFlow.ts`)? Unmapped types render a blank badge.
3. **Payment legs**: does the form collect split legs and change/return (OUT) legs?
   They must travel in ONE IPC payload, and repository branches must consume IN legs
   only (CLAUDE.md rule 16).
4. **Drawers**: which drawer per leg, per currency? App wallets follow the Binance
   pattern (SEND wallet−/General+, RECEIVE wallet+/General−).
5. **Client propagation** (rule 11): UI state → IPC payload → handler → service/repo →
   `createTransaction({ client_id })` — plus the session branch putting the client
   into `formData`.
6. **CUSTOMER_ACCOUNT**: open-debt model or prepaid-credit model? Gate on name+phone
   via `canChargeToCustomerAccount` (`@liratek/ui`).
7. **Supplier/partner ledger**: amount = transfer only; correct sign; prepaid-units
   model (debt once at top-up); secondary system → `partner_ledger`.
8. **Void path**: reversible (prove drawer + ledger + profit restore, including the
   supplier sibling) or added to `NON_REVERSIBLE_TRANSACTION_TYPES`?
9. **Profits**: stamp `profit_usd`/`profit_lbp` on the transactions row; refund must
   net it to zero.
10. **Sessions**: basket branch (defer + formData client + payout posting rules), or a
    documented exclusion.
11. **Audit viewer**: row label, visible vs hidden type, cash-only filter behavior.

## Step 3 — Ship with proof

- Migration in BOTH `packages/core/src/db/migrations/index.ts` and
  `electron-app/create_db.sql`; core build & sync; typecheck + lint.
- Add an e2e or repo-level guard using delta + identity assertions (rule 15), and
  prove it FAILS on the pre-fix/pre-feature code (rule 17) before counting it.
