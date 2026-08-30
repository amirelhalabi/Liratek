# Bill commission settlement — diagnosis + plan (Katsh, LIRA-131-ish)

**Status: DIAGNOSIS ONLY — nothing built.** The owner asked to plan this before it is built. This
doc: (1) the owner's report, (2) exactly why the modal behaves that way today (`file:line`), (3) a
proposed design with the owner decisions it needs. **No production code, no migration.**

Extends `docs/plans/todo_plans/COMMISSION_AT_SETTLEMENT_PLAN.md` (the "Phase 1 — bills slice", shipped
`1d498ff`) — read that first; this doc does not repeat its background, only the parts relevant to the
bug.

Companion e2e spec (characterization, not a guard):
`frontend/tests/e2e-electron/lira-137-katsh-bill-settlement-modal-characterization.spec.ts`.

---

## 1. The owner's report (2026-08-11, verbatim where quoted)

On Suppliers → Katsh, 2 bills selected → Settle → in the modal: RATE PER UNIT `20000`, CURRENCY
`LBP`, COUNT `5`. The modal correctly computes `20000 LBP × 5 = 100,000 LBP`, but:

> "the Net Payment to Katsh is not changing in the modal, whatever or however I change the count and
> rate per unit. The Net Payment to Katsh is still at zero. How will I know how much I am paying? Even
> the total amount in the payment form is still at zero, so I cannot do any payments."

And the business correction — **the direction is inverted**:

> "We said that the katsh bills are commissioned, but at settlement, the commission is not reduced
> from the total owed. We have a counter for the bills, and based on that counter, we should be able
> to autofill how much we need from the supplier. For example, two bills with a rate per unit of
> 20,000 means we need 40,000 from the katsh provider. **This means that he will pay us 40,000.** And
> you should also double-check the direction of the payment."

So for Katsh BILLS the commission is money the **supplier pays the shop**, not money the shop pays
out. The UI frames it as "Net payment TO Katsh" with a tender form — backwards.

---

## 2. Why it behaves this way — traced, `file:line`

### Q1 — why `Net payment to Katsh` never reacts to the counter

`frontend/src/features/suppliers/pages/Suppliers/index.tsx`:

```
856  // Fee-only supplier_owed already nets out the shop's commission for a
857  // LEGACY batch — pay exactly that. For a NEW-MODEL batch the commission is
858  // entered here, so net pay = gross owed − entered commission (clamped at
859  // 0 — a bills-only batch has 0 gross owed and settles for $0 cash, only
860  // the commission credit moves, per the plan's "bills settlement note").
861  const settleNetPayUsd = isNewModelBatch
862    ? Math.max(0, settleTotalOwedUsd - settleEnteredCommissionUsd)
863    : Math.max(0, settleTotalOwedUsd);
...
868  const settleNetPayLbp = isNewModelBatch
869    ? Math.max(0, settleTotalOwedLbp - settleEnteredCommissionLbp)
870    : 0;
```

`settleTotalOwedUsd`/`settleTotalOwedLbp` (`:787-809`) sum each selected row's `supplier_owed`
(`FinancialServiceRepository.ts`'s `SUPPLIER_OWED_EXPR`). Its BILL branch is hardcoded:

```
FinancialServiceRepository.ts:708   WHEN service_type = 'BILL' THEN 0
```

— a bill's principal already left the shop via the provider-drawer cost leg at creation (a prepaid
top-up, not a ledger receivable), so **gross owed for a bills-only batch is always exactly 0**, no
matter which/how many bills are selected. `settleNetPayUsd`/`Lbp` is then
`max(0, 0 − enteredCommission)` = **always 0**, for any nonzero entered commission, at any COUNT, at
any RATE. This is not a stray bug that fires only in an edge case — for a bills-only batch it fires
**every single time**, unconditionally.

`:762`'s comment ("Net you pay = supplier*owed itself, NOT owed − commission again") is about the
**LEGACY** (`commission_model = 0`, OMT/WHISH float model) branch a few lines above (`:758-769`) — it
explains why the \_old* math doesn't double-subtract, not why the _new-model_ clamp floors bills to
zero. The comment that actually explains today's bill behaviour is the one immediately above the
clamp itself, `:856-860`, quoted above — and it is written as **a known, intended consequence**
("clamped at 0 … only the commission credit moves"), not an oversight. The code's own author already
knew a bills-only settlement pays **$0 cash**; what the code doesn't do is tell the _operator_ that in
the modal, or point the commission the correct direction. That is the actual defect: a true, silent
fact ("no cash moves") is being surfaced as a false one ("you owe nothing" / "there's nothing to
enter").

**Corroborating risk note, written back on 2026-08-08** (`COMMISSION_AT_SETTLEMENT_PLAN.md` §5, risk 3):

> "RECEIVE sign: gross makes the shop's claim grow by c per RECEIVE; commission always reduces net
> pay; **the 0-clamp at index.tsx:655 currently hides negative nets.**"

That risk was written for **Phase 2** (OMT/WHISH, not yet shipped) as an edge case: an OMT/WHISH
batch's gross owed is usually a real, larger number, so the clamp only bites when commission
_exceeds_ gross owed — rare. For **bills** (Phase 1, shipped), gross owed is _structurally_ always 0,
so the same clamp bites **100% of the time**. Phase 1 shipped without noticing this because Phase 1's
own e2e (`lira-089-bill-commission-settlement.spec.ts`) drives `settleTransactions` over raw IPC and
never opens the modal — it can't see a UI-only symptom.

### Q2 — why `Total Amount` in the payment sheet is 0, and can the operator enter anything

`:2273-2293` wires `CounterpartySettleModal`'s `multiPaymentInput`:

```
2279  totals: [
2280    { amount: settleNetPayAmount, currency: settleNetPayCurrency },
2281  ],
2282  totalAmountCurrency: settleNetPayCurrency,
```

`settleNetPayAmount` is `settleNetPayUsd`/`Lbp` from Q1 — **always 0** for a bills-only batch — so
`MultiPaymentInput`'s target total is 0 by construction, not a display glitch downstream of some
other number.

The amount **input itself is not disabled** — `packages/ui/src/components/ui/MultiPaymentInput.tsx`
(single-payment-line render, `:1582-1601`, the split-mode twin `:1450-1463`) has no `disabled` prop —
the operator CAN type a number into it. But with the target frozen at 0, ANY nonzero entry registers
as an **overpayment against a $0 target** (`:946-948` `overpaidTarget`, `:1836-1873` the
Paid-vs-target comparison, tolerance `0.01`/`100`): the checkmark never turns green, a "change/return"
branch engages instead of a plain accepted payment, and nothing about the UI explains that this is
expected. That is almost certainly what the owner means by "I cannot do any payments" — not a hard
block, but a form that visibly rejects every real number as wrong.

`Confirm Settlement` is **never disabled** either way: `CounterpartySettleModal.tsx` (`packages/ui`)
defaults `confirmDisabled = false` (`:96,123`), and the Suppliers page's usage (`:2097-2293`) never
passes `confirmDisabled` at all. So the button is clickable at $0/0 LBP net with zero legs — and the
backend accepts that (see Q3): `owesCash` in `settleTransactions` is `false` when both amounts are 0,
so no payment leg is required and the call succeeds.

**Related risk found while tracing this (not one of the five questions, but load-bearing for any
fix):** `settleTransactions`'s guard only checks the _direction_ "cash owed but no legs⇒throw"
(`SupplierRepository.ts:1045-1051`); it does **not** check the reverse — legs present but no cash
contractually owed. Step 4 (`:1197-1226`) debits **every** leg in `data.payments` unconditionally. If
an operator, confused by the $0 target, forces a real number into the payment line anyway and
confirms, `handleBatchSettle`'s `activeLines` (`:952`, `amount > 0`) would carry that leg straight
through, and a real drawer would be debited with **no matching ledger entry** (the SETTLEMENT row
still uses `amount_usd`/`amount_lbp` = 0). Any fix must close this off — either by removing the
payment-leg UI entirely for a $0-net batch, or by rejecting stray legs server-side when
`amount_usd`/`amount_lbp` are both 0.

### Q3 — what actually POSTS today on Confirm, for a bills-only batch

`SupplierRepository.settleTransactions` (`:1041-1250`), for the eligible bill rows
(`commission_model = 1` ⇒ `isNewModelBatch`, always true for BILL-only selections since a
`commission_model = 0` bill can never reach the unsettled queue):

1. `:1093-1110` — a `supplier_ledger` `SETTLEMENT` row, `amount_usd = -abs(0) = 0`,
   `amount_lbp = -abs(0) = 0`. Writes a row; changes nothing numerically.
2. `:1121-1131` — the bill rows are stamped `is_settled = 1`, `settlement_id = <this ledger row>`.
3. `:1147-1188` — one `SUPPLIER_SETTLEMENT` unified transaction, `amount_usd`/`amount_lbp` = 0;
   `commission_usd`/`commission_lbp`/`entry_mode`/`commission_model` land in `metadata_json` as
   **audit-only** fields (`:1164-1176`) — informational, not money-bearing at this layer.
4. `:1197-1226` — payment legs (if any were sent) debit a real drawer. For a well-behaved $0 batch,
   no legs are sent, so **no drawer moves**.
5. `:1228-1241` → `_bookCommissionAtSettlement` (`:1432-1561`), because `batchModel === 1`:
   - `:1499-1519` — one `supplier_settlements` row: `gross_usd = gross_lbp = 0` (bills never carry
     gross), `commission_usd`/`commission_lbp` = the entered figures, `entry_mode`/`rate`/`unit_count`
     snapshot, `model = 1`.
   - `:1521-1538` — one `settlement_commission_allocations` row per bill, largest-remainder split of
     the entered commission (falls back to an equal split across the batch's bills since gross weight
     is 0 for every bill — `:1456-1470`'s own comment).
   - `:1546-1561` — **the money-bearing effect**: a `SUPPLIER_PAYS_US` `supplier_ledger` row,
     `amount_usd = -abs(commission_usd)`, `amount_lbp = -abs(commission_lbp)` — **negative**.

So: **yes, purely a cashless credit.** No drawer entry is written for the commission itself (only a
manually-forced leg, per Q2's risk note, would move a drawer, and incorrectly so). The only thing that
changes is the `supplier_ledger` balance.

**What that negative sign means**, per `getSupplierBalance`'s own doc comment (`:1886-1890`,
"`+` = shop owes supplier") and the plain `SUM(amount_usd/lbp)` behind it (`:1896-1911`): a negative
row **reduces** the running balance — i.e. it reduces how much the shop owes Katsh (or, if the balance
is already negative/"they owe us", makes the shop owe them even less). Concretely: after this
settlement, whatever the shop's Katsh balance was, it drops by exactly the entered commission. This
_is_ money moving in the shop's favor — it is just invisible in the modal, because the modal's only
displayed "net" figure (`settleNetPayAmount`) is a different, always-0 number.

### Q4 — is there an existing flow to actually RECEIVE that cash

**Yes.** `recordSupplierCashflow` (`SupplierRepository.ts:1578-1750`) has a `RECEIVE` direction that
is exactly "the supplier pays the shop": `:1603-1609`

```
1603  const isPay = data.direction === "PAY";
1604  const entryType: SupplierLedgerEntryType = isPay
1605    ? "PAYMENT"
1606    : "SUPPLIER_PAYS_US";
1607  // PAY: cash out + reduce what we owe (−). RECEIVE: cash in + settle their
1608  // debt to us (+). Ledger and drawer share the same sign here.
1609  const sign = isPay ? -1 : 1;
```

RECEIVE writes `entry_type = SUPPLIER_PAYS_US` with a **positive** ledger amount (`sign = +1`) AND
debits/credits a **real drawer** through actual payment-method legs (`:1691-1713`,
`applyDrawerDelta`). This is wired into the Suppliers page today as the separate "Pay / Receive" tab
(`index.tsx:1257-1271`, `1679-1767`), fully independent of the batch-Settle flow.

So the model **is already two-step by design**, just not connected end-to-end for bills:
`settleTransactions` books the credit as a running-balance adjustment (Q3); a manual "Receive" later
can turn part or all of that credit into real collected cash, via the _opposite-signed_ same
`entry_type` (`SUPPLIER_PAYS_US`, this time `+`), which nets against the settlement's `-` row in the
balance sum. Nothing forces the operator to ever run that second step — if they don't, the credit
simply sits in the ledger forever, silently reducing what the shop will owe at the next top-up. That
is consistent with the owner's own earlier framing ("only topping up the katsh balance is what we owe
to katsh") — see the owner-decision list in §3.

### Q5 — the OMT contrast, so a fix doesn't leak into it

OMT (and WHISH) never enter this code path today. Their commission is **embedded at transaction
creation**, not entered at settlement:

- `FinancialServiceRepository.ts:641-665` (`grossOwedDelta`, JS) / `:704-714`
  (`SUPPLIER_OWED_EXPR`, SQL twin) — SEND books `+(principal + fee − commission)`, RECEIVE books
  `−(principal − fee + commission)`. The commission is calculated once, automatically
  (`calculatedCommission`, `:1267-1271`), and immediately netted into the number the settle tab shows
  as "owed" — no rate/count/currency UI, no per-settlement entry.
- `:1298` — `commissionModel = data.serviceType === "BILL" ? 1 : 0` — **only BILL rows are born
  `commission_model = 1`**. OMT/WHISH SEND/RECEIVE stay `commission_model = 0` (legacy EMBEDDED) until
  `COMMISSION_AT_SETTLEMENT_PLAN.md`'s Phase 2 (gross flip) ships, which it has not.
- Consequently `isNewModelBatch` (`Suppliers/index.tsx:786`) is `false` for any OMT/WHISH selection,
  and the settle math takes the **other** branch: `settleNetPayUsd = Math.max(0, settleTotalOwedUsd)`
  (`:863`'s `:` side) — the pre-existing, unaffected legacy path. `settleTotalOwedUsd`/`Lbp` for
  OMT/WHISH are real, usually-nonzero numbers (fee-only, already net of the embedded commission per
  the 2026-07-29 float-model comment at `:758-761`), so this branch pays a real cash amount today, and
  a Katsh-bill fix must not touch it.

**The safety fence already exists in the code**: `isNewModelBatch` (`:786`, `commission_model = 1`
AND not mixed) is the exact gate that separates "bills today, OMT/WHISH later once Phase 2 ships" from
"legacy, untouched." Any fix belongs **entirely inside `isNewModelBatch === true`** branches (the
computation of `settleNetPayUsd`/`Lbp`/`Currency`, the modal's commission section, the payment-leg
wiring) and must leave the `: false` branches byte-for-byte alone. This also means the fix, if
designed against `isNewModelBatch` rather than "is this Katsh," is automatically ready for Phase 2
when OMT/WHISH eventually flip to `commission_model = 1` — see the owner-decision list, item 4.

---

## 3. Proposed design (NOT implemented — owner decisions needed)

**What should change**, for a batch where `isNewModelBatch` is true (today: BILL rows only) and gross
owed is 0 (i.e. every selected row's `supplier_owed` is 0 — true for every bill, and it's the specific
case the owner hit):

- Stop presenting a "Net payment to Katsh" tender figure that is structurally always 0. The modal's
  headline number for this case should be the entered commission itself, framed as **incoming**:
  something like "Katsh owes the shop: 100,000 LBP" (or a signed/two-color figure once §D13 below is
  answered), not a $0.00 amount sitting above a payment form.
- The "Total owed to Katsh (fee-net)" header (`:2109-2112`) is _also_ worth revisiting on its own —
  it's hardcoded to a `$`-prefixed USD string regardless of the batch's real currency (unlike the
  `preSettleCurrency`/`preSettleOwed` pair already computed at `:901-910` for the pre-modal strip,
  which the confirm modal itself never reuses). Whether that's folded into this fix or filed
  separately is an owner call (§ decisions below).
- The payment-leg form (`MultiPaymentInput`) should not render at all for a $0-net, commission-only
  batch — there is nothing to tender. What replaces it depends on decision #1 below:
  - **Netting only**: no payment UI at all. Confirm just books the same cashless `SUPPLIER_PAYS_US`
    credit `_bookCommissionAtSettlement` already writes today (`SupplierRepository.ts:1546-1561`) —
    **zero backend change needed**, this is purely a UI/labeling fix.
  - **Optional cash collection now**: reuse the existing `recordSupplierCashflow` RECEIVE mechanism
    (`:1578-1750`) or, per the owner's own 2026-08-08 decision D13 in
    `COMMISSION_AT_SETTLEMENT_PLAN.md` §6 ("model commission as a DIRECTIONAL leg… reuse the existing
    bidirectional payment-leg machinery… direction: 'OUT'" — read for a RECEIVE-style case as an IN
    leg), extend `settleTransactions` to accept an optional incoming leg that, if provided, credits a
    real drawer in addition to the ledger row. This is a real (small) backend change.
- Whatever is chosen must be gated on `isNewModelBatch` (§Q5) so OMT/WHISH's legacy branch is
  untouched, and must close the Q2 risk (no leg can be forced through when nothing is contractually
  owed).

### Owner decisions needed (not picked here)

1. **Is the commission collected as cash at settlement, or purely credited against the next Katsh
   top-up (netting)?** The owner has previously said "only topping up the katsh balance is what we
   owe to katsh," which reads as netting — but this bug report's own phrasing ("how will I know how
   much I am paying… so I cannot do any payments") also reads as wanting to see/settle it as a real
   amount right now. These are different UI shapes (§3's two bullet branches above); please pick, or
   say "both, operator's choice."
2. If cash collection is wanted at all, is it every time, optional per settlement, or via the existing
   separate "Pay / Receive" → Receive tab (i.e. leave `settleTransactions` cashless, and just make the
   modal say so clearly instead of implying a payment is due)?
3. Should the modal's language for this case read as "Katsh owes you" / an incoming figure, and should
   the tender form disappear entirely for a pure-commission batch — or should it be replaced by an
   explicit RECEIVE-style leg picker (still visible, but framed as money coming IN and asking which
   drawer it lands in)?
4. Should the fix be written strictly against `isNewModelBatch` (so it's already correct once Phase 2
   flips OMT/WHISH to `commission_model = 1`), or scoped narrowly to "BILL rows only" for now? (This
   doc recommends the former — `isNewModelBatch` is already the boundary the code uses — but it's the
   owner's call since it affects how much work ships now vs. later.)
5. Is the "Total owed to Katsh (fee-net)" header's hardcoded `$`/USD display (`:2109-2112`) part of
   this fix, or a separate, lower-priority display bug?

Nothing above is picked. No production code or migration was written for this task.

---

## 4. Owner decisions (2026-08-11) + what shipped (LIRA-137)

The owner answered all five questions above directly, in the same conversation that commissioned
this build:

> "When katsh owes us 100,000lbp they pay it to us via topup to our katsh account (so katsh drawer
> should increase by the payment)" — **at Confirm, directly** (answers §3.1/§3.3: cash-like
> collection every time, via a real drawer top-up, no RECEIVE-style leg picker — there is only one
> destination, so no method choice is offered).
>
> "The commission should be a separate payment regardless of if katsh owes us or we owe them." —
> the commission is its own directional payment, never a netting term against gross `owed` (this was
> already D13 of `COMMISSION_AT_SETTLEMENT_PLAN.md` §6; this task applies it to Phase 1/bills).
>
> "It is profit, entirely." — answers the profit-recognition question this doc didn't even ask yet:
> the commission is not a receivable waiting to be collected, it is realized income the instant it
> lands in the drawer.
>
> Scope: **narrow to Katsh bills only** (§3.4) — the `isNewModelBatch`-vs-`service_type === "BILL"`
> question is answered "BILL rows only, for now"; generalising to OMT/WHISH once Phase 2 of
> `COMMISSION_AT_SETTLEMENT_PLAN.md` ships is filed as **LIRA-138** (`current_sprint.md`), not built
> here.
>
> §3.5 (the hardcoded `$`/USD "Total owed" header) — folded into this fix: the row is **dropped**
> entirely for a bills-only batch (it can only ever read a misleading $0.00 for that shape), not
> merely currency-corrected.

### What shipped

- **Posting** (`SupplierRepository.ts`): `settleTransactions` now derives `isBillsOnlyBatch`
  (`commission_model = 1` AND every eligible row's `service_type === "BILL"`) alongside the existing
  `batchModel` resolution. `_bookCommissionAtSettlement` branches on it:
  - **Bills-only** → `_bookBillsCommissionDrawerTopUp` (new): credits the Katsh/iPick provider drawer
    directly (`applyDrawerDelta` + a `payments` leg on the settlement's OWN transaction, `method` =
    the provider name — the exact convention `FinancialServiceRepository`'s cost/price-flow cost leg
    already uses for a provider-drawer movement). **No `supplier_ledger` row is written for this
    money at all** — not `TOP_UP` (that would fabricate a debt the shop never incurred — the SHOP
    isn't extending credit here, KATSH is funding the top-up) and not the old `SUPPLIER_PAYS_US`
    credit either (see the double-count judgement below).
  - **Every other new-model batch** (unreachable in production today — only exercised by this file's
    own generic `commission_model = 1` test fixtures) → byte-for-byte the ORIGINAL cashless
    `SUPPLIER_PAYS_US` ledger-credit path, untouched.
  - **Profit**: `profit_usd`/`profit_lbp` on the settlement's own transaction row are now
    `isBillsOnlyBatch ? data.commission_usd/lbp : 0` — the SAME mechanism (a plain
    `createTransaction({ profit_usd, profit_lbp })` call) every other commission-earning flow in this
    codebase already uses (`FinancialServiceRepository`'s SEND/RECEIVE commission,
    `LotoTicketRepository`'s ticket commission) — not a bespoke field.
  - **CQ-8 flow**: `metadata.counterparty.flow` is `"IN"` for a bills-only batch (money arrived),
    `"OUT"` for every other batch (byte-for-byte unchanged) — drives the transactions-table cash-flow
    badge (`frontend/src/features/audit/cashFlow.ts`'s new `SUPPLIER_SETTLEMENT` case, metadata-
    resolved like `SUPPLIER_PAYMENT`, defaulting to `"out"` for every historical row).
  - **The double-count judgement** (the task's own words: "get it wrong and the Katsh balance drifts
    from reality"): the OLD `SUPPLIER_PAYS_US` credit reduced whatever the shop's `supplier_ledger`
    balance happened to be — modeling the commission as Katsh forgiving part of an UNRELATED
    credit-funded top-up debt. That is not what is happening: the commission is a NEW, separate
    reward, with no connection to any prior `topUpFromSupplier` debt. Keeping BOTH the new drawer
    credit AND the old ledger credit would double-book the same value in two unrelated places (the
    shop's total claim on Katsh — drawer stock + reduced debt — would overstate reality by 2×) AND
    would misrepresent the transaction as debt forgiveness that never happened. The fix therefore
    **replaces** the ledger credit for this batch shape; it does not add to it.
- **No supplier debt**: `_bookBillsCommissionDrawerTopUp` deliberately does not call
  `addLedgerEntry`/write to `supplier_ledger` at all — kept apart from
  `RechargeRepository.topUpFromSupplier`'s debt-booking half by construction (no code path in the
  new method can reach `supplier_ledger`), not by a runtime flag.
- **Reversal (rule 20)**: needs NO bespoke code. The drawer credit is a `payments` row on the
  settlement's own transaction, reversed for free by the generic `_reversePayments` step every
  void/refund already runs; the profit stamp nets to 0 the same generic way every transaction's
  profit does (VOID: original flips to `status = 'VOIDED'`, excluded from every ACTIVE-only profit
  sum; REFUND: the reversal row carries `-profit_usd/-profit_lbp`). Proved end-to-end (create → settle
  → void, drawer + ledger + profit all net to 0) by
  `FinancialServiceRepository.billsSettlement.test.ts`'s rewritten rule-20 test.
- **Hazard closed at both ends** (LIRA-137 Q2): `settleTransactions` now throws
  `"Settlement has no cash owed — payment-method legs are not accepted"` when `payments[]` is nonempty
  but both `amount_usd`/`amount_lbp` are ~0 (the sibling of the pre-existing "cash owed, no legs"
  guard). The frontend removes the possibility structurally: `multiPaymentInput={null}` for a
  bills-only batch, so there is no tender form to type a stray leg into at all; `confirmDisabled`
  mirrors the same two-sided check as belt-and-braces.
- **UI** (`Suppliers/index.tsx`): "Total owed to {supplier} (fee-net)" and "Net payment to {supplier}"
  are dropped for `isBillsOnlyBatch`, replaced by "{supplier} owes you: `<entered commission>`" (the
  RAW commission, not netted against a $0 "owed" figure) plus a one-line explainer that it arrives as
  a drawer top-up. The pre-modal strip's "Owed X − commission / Net you pay: 0" gets the same
  treatment. OMT/WHISH (`isNewModelBatch === false` today, always) is untouched — proved by a
  dedicated regression test and an unchanged existing component test
  (`Suppliers.settleNetPayCurrency.test.tsx`'s OMT case).
- **Deferred, not built**: generalising this to any commission-at-settlement provider (Phase 2,
  OMT/WHISH) — filed as **LIRA-138** in `current_sprint.md`, referencing this section and
  `COMMISSION_AT_SETTLEMENT_PLAN.md`'s own D13.
