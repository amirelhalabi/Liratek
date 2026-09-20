# LIRA-194 — every top-up must be voidable

**Priority: HIGH** (owner, 2026-09-20) · **Status: TODO, not started** · **Type: money / reversal symmetry**

## The problem

A top-up cannot be undone. Get one wrong and the only remedy is to post an opposite manual entry on
the Suppliers page and hope whoever reads the ledger later understands why two rows cancel out.

`TRANSACTION_TYPES.RECHARGE_TOPUP` sits in `NON_REVERSIBLE_TRANSACTION_TYPES`
(`packages/core/src/constants/transactionTypes.ts`). `TransactionRepository`'s void guard refuses the
type outright, before any write. That covers **every** top-up writer:

| Writer | What it funds |
| ------ | ------------- |
| `RechargeRepository.topUpApp` | drawer-to-drawer transfer (OMT App, Whish App, MTC, Alfa, iPick, Katsh) |
| `RechargeRepository.topUpFromSupplier` | supplier credit — iPick, Katsh, and OMT App since LIRA-190 |
| `RechargeRepository.topUpFromPartner` | Whish App via a partner |
| `RechargeRepository.topUpFromClient` | client-funded |

This became more visible with LIRA-190: loading the OMT App wallet is now a **credit** that books real
debt, and it is reachable from a button an operator presses many times a day. Before that it was a
drawer transfer nobody thought of undoing.

## Why it was non-reversible, and why that reason is now fixable

The recorded rationale is one line: *"the provider-drawer credit has no payments row either."* The
generic reversal (`_reversePayments`) works by mirroring `payments` rows. Top-ups move the drawer with
a bare `applyDrawerDelta` and write no payment row, so there is nothing for the generic path to undo.

**LIRA-192 already solved exactly this.** `RechargeRepository.cashoutToSupplier` writes its wallet
movement as a **real `payments` row** and books its ledger row with a `source_ref` back-link, and it
is fully voidable through the generic machinery with no bespoke reversal code. That is the template.

## What to do

1. Make each top-up writer post its drawer movement as a real `payments` row (as `cashoutToSupplier`
   does) instead of a bare `applyDrawerDelta`, so `_reversePayments` can mirror it.
2. Give the `supplier_ledger` / `partner_ledger` row a reversal owner. **Careful**: `topUpFromSupplier`
   uses **link mode** (`transaction_id` = the top-up's own transaction), not the `source_ref` sibling
   pattern the cashout uses, so the LIRA-091 cascade will not find it. Either move it to `source_ref`
   or add a dedicated reversal shaped like `_reverseLotoSupplierLedger`. Decide per writer and write
   down which.
3. Remove `RECHARGE_TOPUP` from `NON_REVERSIBLE_TRANSACTION_TYPES` only once every writer is covered.
   The type is shared, so a partial fix makes the unfixed writers *look* voidable and silently leave
   their ledger row behind — worse than today.
4. `ACTIONABLE_TYPES` in `frontend/src/features/audit/auditConstants.ts` must gain the type, or the
   Void button will not appear. `actionGating.guard.test.ts` enforces that the two sets partition
   every transaction type, so it will fail loudly if you do one and not the other.

## Acceptance

Rule 20, per writer, per currency: create then void nets the provider drawer, the supplier or partner
ledger, the client debt where applicable, and profit back to **0**. Rule 17: prove each test fails on
the pre-fix code before it counts.

Watch for the double-debit trap — if a writer keeps its `applyDrawerDelta` **and** gains a payments
row, the void reverses one and the create applied the other, so it will not balance. It must be one
or the other.

## Do NOT

Do not make this voidable by special-casing the OMT App and leaving iPick, Katsh, MTC, Alfa, the
partner path and the client path behind. One shared type, one behaviour.
