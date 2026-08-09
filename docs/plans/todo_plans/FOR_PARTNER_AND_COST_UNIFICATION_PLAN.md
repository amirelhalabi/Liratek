# FOR-PARTNER & COST SEMANTICS — app-wide unification plan

**Status:** PLANNED — awaiting ONE owner decision (§2). Everything else is decided.
**Origin:** owner report 2026-08-08 (LIRA-114) → owner escalated 2026-08-09: *"We should write a
plan to unify this flow in the whole app… if the customer account payment method is disabled in the
OMT/Whish page when the For Partner checkbox is true, I think we should apply this in all pages
where we have a For Partner."*
**Grounding:** 3-agent read-only survey of every partner-aware module at HEAD `a528042`
(2026-08-09). Every claim below carries a file:line. Re-verify before building — this repo's plan
docs go stale fast.

---

## §1 What triggered this

The owner entered a custom service: **For Partner ticked, cost $1008, price $1010, payment method
"Customer Account"** — and saw **General drop by $1008**. Diagnosis found the money is *internally
consistent* (partner owes $1010, no customer debt, no double-booking) but the owner's objection cut
deeper:

> *"As of business flow, we don't pay for the service and then get paid by the customer. I don't
> understand that flow."*

The survey confirms the objection is right, and that **Custom Services is the outlier**.

---

## §2 ⚠ THE OWNER DECISION — what does "cost" mean?

The app currently runs **three mutually inconsistent cost models at once**:

| Model | Modules | What entering a cost does |
| --- | --- | --- |
| **A — CASH NOW** | **Custom Services only** | Immediately posts `−cost` from hardcoded `"CASH"`/`"General"`. Six byte-identical copies of the same template (`CustomServiceRepository.ts:236-245, 309-318, 428-437, 472-481, 534-543, 625-634`). No field, flag or branch exists to say the cost was already paid, is owned stock, or is owed to a supplier. |
| **B — STOCK DRAW-DOWN** | OMT/Whish cost-price flow, Recharge/telecom | Draws down a **provider drawer funded earlier on credit**. `FinancialServiceRepository.ts:3312-3314`: *"the supplier debt was booked once at top-up time; the sale only draws down the provider drawer"*. `FEATURE_GUIDE.md:298` — prepaid-units model. Cash left the till at a **decoupled earlier top-up**, or leaves later at supplier settlement. |
| **C — PROFIT ONLY** | POS Sales, Maintenance | Cost is read **only** to compute margin (`SalesRepository.ts:474-475`, `MaintenanceService.ts:119-121`). **No drawer row, ever.** Stock leaves via a `stock_quantity` decrement. No purchase/restock transaction exists anywhere in the codebase. |

**The owner's described flow ("we don't lay out cash") is models B and C — which the app already
implements.** Custom Services is the anomaly that forces "cash now" on every entry.

### The question to answer

> When staff type a cost into a custom service, should money leave the cash drawer **at that
> moment** — or is the cost sometimes a record of money that **already left earlier** (a part bought
> last week / stock already owned) or is **still owed to a supplier**?

- **"Always now"** → nothing changes; expect General to keep draining on every custom service,
  including jobs where the part was already paid for.
- **"Not always"** (expected, per the owner's own words) → Custom Services adopts the pattern
  OMT/Whish and Recharge already use: fund a cost bucket once (on credit, no till movement), then
  each sale just draws it down; settle real cash with the supplier separately.

**Nothing in §3-§5 depends on this answer** — those can ship first.

---

## §3 DECIDED — unify the For-Partner / payment-method rule

Owner's instruction is unambiguous, and one module **already implements exactly it**.

### Convergence target: `LotoTicketRepository`

It is the ONLY module whose guard inspects **both** the structured `payments[]` legs **and** the
legacy single payment-method field, and **rejects** the combination rather than silently storing a
dead value (`LotoTicketRepository.ts:338-346, 353-360`).

### The gap in every other module

`assertNoCounterPayment` (`moneyPosting.ts:559-568`) takes a **boolean the caller computes**, and
four of five callers compute it from the structured legs ONLY:

| Module | Inspects | Misses |
| --- | --- | --- |
| Loto | legs **+ legacy `payment_method`** | — ✅ |
| Custom Services | `data.payments` only (`:230-233`) | **`paid_by`** |
| Financial Services | `inPayments` only (`:1804`) | **`paidByMethod` / `cashoutMethod`** |
| Recharge | `inPayments` only (`:768`) | **`paid_by_method`** |
| Sales | `inLegs` only (`:805`) | `payment_usd` / `payment_lbp` |

Consequence, confirmed in the owner's transaction: the legacy field is written to the source row
**and** stamped into `metadata_json` **before** `isForPartner` is even computed — so **the audit
trail records a payment method that never executed.**

### Work

- [ ] Extend the shared guard so it inspects legacy single-method fields too, not just legs
      (rule 14 — one definition; do **not** add a fifth per-module variant).
- [ ] Add the missing `assertNoCustomerAccountLeg` call to Custom Services (it has **no**
      CUSTOMER_ACCOUNT-vs-FOR check of any kind — the exact hole the owner fell through).
- [ ] Stop storing a dead `paid_by` on FOR rows: either reject it (preferred, matches Loto) or
      null it before it reaches the row and `metadata_json`.
- [ ] Zod cross-field rules per module. Today only `financial.ts:325-342` (feePayments vs partnerId)
      exists; no schema anywhere gates a payment-method field against partner mode.
- [ ] Fix `assertPartnerIdRequired` bypass: FinancialService computes
      `isForPartner = !!(partnerId && mode==='FOR')`, so a bare `mode:'FOR'` with no partnerId
      **silently falls through to the walk-in path** instead of throwing
      (`moneyPosting.ts:521-526` documents this un-fixed asymmetry).

---

## §4 DECIDED — unify the UI gating

Ten surfaces, four different behaviours. Ranked by money risk:

1. 🔴 **Services / OMT/Whish (`Services/index.tsx`) is the worst offender** — and notably the page
   the owner *assumed* was already strict. Its `MultiPaymentInput` is rendered **unconditionally**
   (`:2075-2198`, no `forPartner` branch at all) with **unfiltered** methods (`:2162`), so
   CUSTOMER_ACCOUNT is selectable; for a For-Partner **SEND** that value is read straight into an
   OUT disbursement leg (`:1062-1076`). **It is honoured, not ignored.**
2. 🔴 **The same page treats SEND and RECEIVE oppositely** — RECEIVE discards the operator's input
   (`:1077`) — with zero UI cue distinguishing them.
3. Services is also the only partner surface **not** built on the shared
   `ForPartnerToggle`/`ForPartnerNotice` (`frontend/src/features/partners/components/`) that the
   other nine use — the structural root of 1 and 2.
4. Custom Services hides the payment UI but still forwards `paid_by: primaryMethod`, defaulting to
   the literal `"CASH"` (`CustomServices/index.tsx:293-316`), because the toggle already forced
   `paymentLines = []` (`:952-960`) — **silently discarding the operator's prior choice**.
5. Two sibling recharge forms filter the "Paid from" picker differently for the same control —
   `FinancialForm.tsx:865-873` unfiltered vs `OmtWhishAppTransferForm.tsx:846-853` drawer-affecting
   only.
6. `CheckoutModal.tsx:143-144` already computes a CUSTOMER_ACCOUNT-excluding list — but it's
   **dead code**, since the input it feeds is unmounted when `forPartner` is true. Someone already
   saw this conflict and guarded for it.

### Work

- [ ] Migrate Services/OMT-Whish onto the shared `ForPartnerToggle`/`ForPartnerNotice`.
- [ ] One rule everywhere: **For Partner ON ⇒ payment-method UI hidden, and no payment-method value
      sent.** (Hidden-and-omitted is the cleanest existing pattern — CheckoutModal, Loto, Exchange,
      CryptoForm already do it.)
- [ ] Keep the checkbox label **"For Partner"** — owner explicitly confirmed 2026-08-09.
- [ ] Decide whether a client/customer identity should still be captured on a For-Partner sale —
      currently inconsistent (Custom Services, Loto and Services keep it; CheckoutModal, Telecom,
      Exchange replace it entirely).

---

## §5 DECIDED — fix the misleading copy

The Custom Services notice (`CustomServices/index.tsx:969-980`) reads:

> *"No payment is collected for a partner service. The full price goes on the selected partner's
> account, settled later"*

True of the **price**, silent about the **cost** — while $1008 in real cash leaves General at
submit. **This is what actually misled the owner.** Every partner notice must state what happens to
BOTH sides. Services/OMT-Whish has no notice at all.

---

## §5b ⚑ NEW REQUIREMENT — partners need their own system association (owner, 2026-08-09)

Owner confirmed two things:

1. **The partner's linked system DOES determine which drawer moves.** (Confirmed by the owner
   directly; the parallel investigation is establishing the exact code path.)
2. **Today you can only associate a partner with the Whish system** — so '7welet souria', a Syria
   remittance partner with nothing to do with Whish, is linked to Whish and therefore
   **moves the Whish_System drawer**. Owner: *"7welet syria should not affect the whish system
   drawer, but it would be normal because currently we are only able to create a whish system
   association for any partner created."*

### The rule to build to (owner's words)

> **"The partner settlement should affect the drawer of the system associated to it."**

So a partner associated with a *'syria'* system must settle against a **Syria** drawer, not Whish.

### What this implies (to be designed — not yet decided)

- The system association becomes **user-creatable**, not a fixed OMT/Whish choice.
- Each system association needs a **drawer** of its own (generalising the existing
  `OMT_System` / `Whish_System` pattern to N systems).
- ⚠ This collides with existing assumptions: `shop_base_system` / Primary Cash Drawer (PCD, plan
  #68) treats OMT_System as *the* primary cash drawer, and money paths contain hardcoded `'OMT'` /
  `'WHISH'` literals. Any generalisation must enumerate and handle those.
- **Data already in the field is wrong**, not just the schema: existing partners linked to Whish
  purely for lack of an alternative have been moving Whish_System. A cutover/repair decision is
  needed — likely "leave history, apply forward" per D3 precedent, but that is the owner's call.

**Sequencing note:** this is independent of §2 (cost model) and §3-§5 (guard/copy unification), and
larger than both. It should get its own ticket + plan once the investigation reports; do not fold it
into the §3 work in flight.

---

## §6 Sequencing

1. **§3 + §4 + §5** — the For-Partner unification. No owner decision needed, no historical data
   touched. Ship first.
2. **§2** — the cost-model change. Needs the owner's answer, and if it's "not always now" it is a
   real feature (a cost bucket / supplier-owed path for custom services), plus a cutover decision
   for historical rows.

## §7 Rules that bind this work

Rule 14 (one guard definition, not five copies — the six duplicated cost templates in
`CustomServiceRepository` are the cautionary tale), rule 17 (failing-first proof for every guard),
rule 20 (any new ledger row needs a named reversal owner), rule 19 (both transports).
