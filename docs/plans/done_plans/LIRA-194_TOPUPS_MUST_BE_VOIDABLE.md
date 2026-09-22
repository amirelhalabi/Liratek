# LIRA-194 — every top-up must be voidable

**Priority: HIGH** (owner, 2026-09-20) · **Status: SHIPPED 2026-09-21 (`9c0194cd`)** · **Type: money / reversal symmetry**

> **DONE.** All four writers post real `payments` rows; `RECHARGE_TOPUP` is out of
> `NON_REVERSIBLE_TRANSACTION_TYPES` and in `ACTIONABLE_TYPES`. Reversal owner per writer:
> `topUpApp` both legs and `topUpFromClient` all legs via the generic `_reversePayments`;
> `topUpFromSupplier`'s link-mode `supplier_ledger` row via a new
> `_reverseSupplierLedgerByTransactionLink`; `topUpFromPartner`'s `partner_ledger` row via the
> **existing** `_reversePartnerLedger`, which already matched it on
> `reference_table`/`reference_id` — confirmed by test rather than assumed.
>
> The new link-mode reversal is deliberately scoped to `RECHARGE_TOPUP`: `LotoTicketRepository`
> writes an identical link-mode `TOP_UP` row that `_reverseLotoSupplierLedger` already owns, so a
> type-agnostic version would double-reverse loto tickets. Decision recorded here because the
> ticket left it open ("decide per writer and write down which").
>
> The ticket's "do NOT partially fix" warning was honoured — all four writers landed together.
> Create-then-void proven to net to 0 per writer per currency, each test shown failing on the
> pre-fix code first (rule 17). Gate green: core 3415 / backend 897 / electron-app 155 /
> frontend 1605, typecheck and lint clean.
>
> Shipped alongside it in the same commit (same code path, could not be split without a broken
> intermediate): the client top-up payout moved to shared `MultiPaymentInput` payment legs, and a
> live rule-11 bug — the modal never sent `clientId`, so every client top-up ever recorded has a
> null `client_id`.
>
> **Not done, deliberately:** e2e has NOT been run against this. `lira-057` was updated to the new
> payload shape but not executed; `lira-141` needs no change (it drives the UI, not the wire).

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
