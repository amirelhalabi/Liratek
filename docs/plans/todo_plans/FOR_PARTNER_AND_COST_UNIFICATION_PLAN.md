# FOR-PARTNER & COST SEMANTICS — app-wide unification plan

**Status:** **§2 SHIPPED** (`d1a0ad2` + `69c29e8`) · **§3 slice 1 + §5 SHIPPED** (`cc45227`).
Remaining: §3 slice 2 (wire the legacy field in the other 4 modules), §4 (UI gating), §5b
(provider taxonomy / the 'syria' request). **No owner decisions outstanding** — every question in
this plan has been answered; see §2's answer list, §5b, and §6.
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

## §2 ✅ ANSWERED AND SHIPPED — what does "cost" mean?

> The question below is kept for the record; it is **settled**. Jump to "§2 SHIPPED" for the
> outcome and "§2 FINAL SPEC" for the rules that now apply.

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

### §2 answers so far (owner, 2026-08-09)

- **Cost must NOT leave the drawer at submit time.** *"money should not leave the drawer at that
  moment."* Custom Services stops being Model A.
- **Inventory-backed custom service behaves like a POS sale**: *"yes"* — **stock decrements, no cash
  row**, because the cost was already accounted for when the stock was bought (Model C).
- ⚠ **Blocker discovered by the characterization matrix:** the three input paths (preset /
  inventory item / free-text) are **byte-identical by the time they reach the backend** — no
  `preset_id`, no `product_id`, nothing distinguishing them (`CustomServiceRepository.scenarioMatrix`
  scenarios A1/A2/A3 produced identical rows). So **the repository cannot apply a per-path rule
  today.** Recording which path was used (at minimum a `product_id` for the inventory case) is a
  prerequisite for this change, not an optional extra. It is also why an inventory-consuming
  custom service currently **does not decrement stock** — the backend never learns a product was
  involved.
- **Presets**: cost is *"just a number i compute for my profit"* → Model C.
- **Free-text**: same treatment as presets — *"since we will be paid cost+profit"* (the customer
  reimburses the cost) → Model C.
- **No supplier link.** Owner reviewed a worked example and declined: *"the items that I select from
  the customer services page are already bought, and I don't owe Ali anything. So no we don't need
  this."* → costs are never an unpaid payable; nothing to attach a supplier to.

### ✅ §2 SHIPPED (2026-08-09) — `d1a0ad2` (§2a) + `69c29e8` (§2b)

- **§2a** removed the cost cash movement from all six branches (911→703 lines). Desktop e2e 252/252.
- **§2b** added `custom_services.product_id` (migration v152) and stock decrement/restore on the
  inventory path, mirroring POS's guarded conditional write. Restoration wired into BOTH
  `_voidTransactionInternal` and `_refundTransactionInternal` — `deleteService()` is not the
  reversal owner. v152 verified against the real accumulated e2e database (existing rows NULL).
- A1/A2/A3 now diverge for the first time: preset and free-text remain byte-identical with no stock
  effect; inventory drops 1 on create and restores on refund.
- Coverage gap filed as **LIRA-117**: no e2e spec picks a product from the SearchBar, so a UI-side
  `product_id` regression would go uncaught.

### §2 FINAL SPEC (interview complete, 2026-08-09)

**Cost never moves cash, on any of the three paths.** It is a profit input only — which is what the
schema already says: `custom_services.profit_usd` is a GENERATED column
`price_usd - cost_usd` (`create_db.sql:726-727`). Today's repository posts a cash outflow *on top
of* that, contradicting its own schema. Remove it.

| Path | Cost behaviour | Extra |
| --- | --- | --- |
| Preset | profit math only | — |
| Free-text | profit math only | — |
| Inventory item | profit math only | **decrement stock**, like a POS sale |

**Prerequisite (not optional):** the backend currently cannot tell the three paths apart — no
`product_id`, no `preset_id` is stored, which is exactly why stock never decrements. Recording the
product for the inventory path is required before the stock rule can be implemented.

⚠ **Visible consequence to expect, by design:** with the cost outflow removed, a $8-cost/$10-price
job increases the till by the full **$10** instead of a net **$8**. That is correct under this model
(the customer reimburses the cost), but it is a real change to the daily cash position and should be
called out in the release note so it isn't mistaken for a bug.

**Reversal (rule 20):** removing the cost leg also removes what its refund reversed — confirm
create+refund still nets to 0 across every scenario (the characterization matrix
`CustomServiceRepository.scenarioMatrix.test.ts` already asserts this and must stay green).

**Cutover:** historical rows keep their posted cost outflows (consistent with D3 and the owner's
iPick decision) — do NOT retro-reverse. New rows only.

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

> 🔴 **CORRECTION (2026-08-09, after investigation).** The owner stated — and this plan initially
> recorded as spec — that the partner's linked system determines which drawer moves. **The code
> refutes that.** `partners.system_association` is **never read by any money code**: grep across
> `packages/core/src` finds it only in `PartnerRepository`'s own CRUD. It is a **UI filter** that
> decides which partners appear in a selector and whether a provider tab is enabled
> (`Services/index.tsx:514-519, 1329-1339, 1422-1430`; `Checkpoint/index.tsx:57-76`). Every other
> partner-aware module (Custom Services, Recharge, Exchange, Loto, Sales) ignores it entirely.
>
> **The owner's conclusion is still right, by a different mechanism:** a partner is only offered
> when its provider tab is open, which forces `provider: "WHISH"` onto the transaction; the drawer
> is then chosen by `resolveServiceCashDrawer` from `provider === shop_base_system`
> (`utils/payments.ts:190-203`), whose doc comment states outright *"Partner involvement is NOT part
> of this predicate — route by the system the transaction runs on, not the counterparty"*. So if the
> shop's base system IS Whish, that cash lands in `Whish_System`; if the base is OMT, it falls to
> General instead. **The contamination is real but conditional on the shop's own base-system
> setting**, and it pollutes provider-keyed analytics either way.
>
> Lesson recorded: an owner's statement about *mechanism* is a hypothesis to verify, not a spec —
> their statement about *intent* ("Syria must not touch Whish") is the requirement.

Owner confirmed two things:

1. ~~The partner's linked system DOES determine which drawer moves.~~ **See the correction above** —
   the intent stands, the mechanism was wrong.
2. **Today you can only associate a partner with the Whish system** — so '7welet souria', a Syria
   remittance partner with nothing to do with Whish, is linked to Whish and therefore
   **moves the Whish_System drawer**. Owner: *"7welet syria should not affect the whish system
   drawer, but it would be normal because currently we are only able to create a whish system
   association for any partner created."*

### The rule to build to (owner's words)

> **"The partner settlement should affect the drawer of the system associated to it."**

So a partner associated with a *'syria'* system must settle against a **Syria** drawer, not Whish.

### The REAL blocker for a 'syria' system (from the investigation)

- `financial_services.provider` is a **closed CHECK constraint** of 9 values
  (`create_db.sql:618`) mirrored by a closed Zod enum (`validators/financial.ts:15-25`). There is no
  provider slot for Syria, so a Syria remittance must currently be booked as OMT/WHISH
  (contaminating those buckets and their analytics) or pushed through an unrelated module.
- `partners.system_association` is by contrast **unconstrained TEXT** with no FK, no enum, no CHECK
  (`create_db.sql:691`, migration v79) — "SYRIA" would store fine and mean nothing downstream.
- The Partners UI dropdown is hardcoded to `{None, <the shop's non-owned system>}`
  (`Partners/index.tsx:294-306`), derived from `useShopBase()` whose `BaseSystem` is a two-value TS
  union — **no free-text entry exists**.
- Latent bug found in passing: the secondary-system partner selector hardcodes `provider === "WHISH"`
  (`Services/index.tsx:1422-1430`) instead of `provider === partnerSystem`, so a shop whose base
  system is WHISH (making OMT secondary) has no equivalent partner requirement on the OMT tab.

⇒ Generalising to N systems is primarily a **provider-taxonomy** change, not a
`system_association` change. Any design must start there.

### PROPOSAL — do to `provider` exactly what was already done to `payment_methods`

**The precedent is in this repo.** `payment_methods` used to be hardcoded; it is now a
tenant-scoped table the operator manages (`create_db.sql:1295-1307`):

```
payment_methods(code, label, drawer_name, affects_drawer, sort_order, is_active, is_system)
```

`paymentMethodToDrawerName()` reads it, with a hardcoded map only as an offline fallback. That is
precisely the shape `provider` needs — it is still
`CHECK(provider IN ('OMT','WHISH','BOB','OTHER','iPick','Katsh','WHISH_APP','OMT_APP','BINANCE'))`
(`create_db.sql:618`).

**Phased, each phase independently shippable and behaviour-neutral until the last:**

1. **Introduce `service_providers`** (mirroring `payment_methods`): `code`, `label`,
   `drawer_name`, `is_system_provider`, `is_active`, `is_system`, tenant-scoped. **Seed with the
   existing 9 values, drawer names matching today's hardcoded `mapDrawerName`
   (`FinancialServiceRepository.ts:741-764`).** Nothing reads it yet → zero behaviour change.
2. **Point the code at the table**: `mapDrawerName` reads `service_providers.drawer_name` with the
   current switch as the offline fallback — same pattern as `paymentMethodToDrawerName`. Prove
   byte-identical drawer resolution for all 9 providers (characterization test).
3. **Relax the constraint**: rebuild `financial_services` replacing the CHECK with an FK to
   `service_providers(code)`; make the Zod enum validate against the table instead of a literal
   union. (SQLite needs a table rebuild — the v150 migration is a recent template.)
4. **Partner association becomes an FK** to `service_providers` instead of the hardcoded
   `{None, non-owned system}` dropdown, and the Partners UI offers the real list.
5. **Then "Syria" is a data entry, not a migration** — the owner adds a provider, chooses whether
   it gets its own drawer, and associates the partner with it.

**Alternative considered — add `'SYRIA'` as a 10th CHECK value.** Faster (one migration), but
hardcodes the next system too, and every future partner system repeats the work. Reasonable ONLY as
a stopgap if the owner needs Syria working before the phased change lands; it does not remove the
need for the above.

**ANSWERED (owner, 2026-08-09): no new drawers.** *"all of them if paid cash will affect general
drawer. only the whish system association is linked to whish system drawer."*

⇒ A new system (Syria, etc.) resolves cash to **General**. Only the existing system associations
keep their dedicated drawers (`Whish_System`, and `OMT_System` as the shop's own base/PCD).

**This makes the phased plan materially cheaper and safer:**
- `service_providers.drawer_name` is seeded `'General'` for every NEW provider, and only
  OMT/WHISH carry `OMT_System`/`Whish_System` — i.e. exactly today's `mapDrawerName` behaviour,
  which already routes unknown providers to `"General"` (its `default:` case).
- **No new drawer means no closing/checkpoint impact** — the drawer enumeration is unchanged, which
  removes the biggest risk from phase 5.
- The existing PCD model (plan #68: `OMT_System` is the primary cash drawer) is untouched.

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
