# Owner Notes — 2026-08-29 · triage, diagnosis & task plan

**Source:** 6 freeform owner notes from a live testing session (WhatsApp, 3:52 AM 2026-08-29).
**Method:** every note traced to source at HEAD `526eba3f`, read-only. Every claim below carries a
`file:line`. Nothing has been changed — this is a design + triage document, not an implementation.
**Confidence marks:** unmarked = verified against source. `Likely:` = inferred, strong basis named.
`Assumption (unverified):` = needed to proceed, owner must confirm.

**Next free identifiers (verified 2026-08-29):**

| Thing             | Current tail                                                 | Next free        |
| ----------------- | ------------------------------------------------------------ | ---------------- |
| LIRA ticket       | LIRA-152 (`current_sprint.md:2254`)                          | **LIRA-153**     |
| Migration version | v157 `add_product_imei_units_and_warranty` (`index.ts:8980`) | **v158**         |
| Desktop e2e spec  | `lira-148-omt-system-account-settlement-routing.spec.ts`     | **lira-149**     |
| Web e2e spec      | `lira-web-026-general-drawer-foreign-currency.spec.ts`       | **lira-web-027** |

---

## 0.0 Implementation status — updated 2026-08-29

**Shipped in this pass: notes #6 (LIRA-157) and #2 (LIRA-153).** Both were owner-interviewed first;
every decision is recorded in §7 and reflected in the sections below. Notes #1, #3, #4 and #5 are
designed but NOT built.

| Note | Ticket   | State                                                                                   |
| ---- | -------- | --------------------------------------------------------------------------------------- |
| #6   | LIRA-157 | ✅ **Implemented** — new validity rule + grace window + 365 ceiling + burned-line block |
| #2   | LIRA-153 | ✅ **Implemented** — credit-return now offsets the margin; negative LBP profits visible |
| #5   | LIRA-156 | ✅ **Implemented** — per-drawer checkpoint time; commit `066786e1`                      |
| #1   | LIRA-095 | Designed only — execute `COMMISSION_AT_SETTLEMENT_PLAN.md` Phase 2.                     |
| #3   | LIRA-154 | **In progress** — migration v158 + VIA mode; ledger `THROUGH_CUSTOM_SERVICE`            |
| #4   | LIRA-155 | Designed only. Statuses decided (D4.2); cancel-as-refund decided (D4.2b).               |

**What LIRA-157 changed**

- New `packages/core/src/utils/carrierLineValidity.ts` — the ONE validity rule, pure and
  clock-injectable. `CarrierLineRepository.computeAppliedState` now delegates to it instead of
  containing it, which is what lets the UI project the same answer the write path will produce.
- `CarrierKey` moved to the util layer as `TelecomCarrierKey` (a util may not import a repository);
  `CarrierLineRepository.CarrierKey` is now an alias, so no call site changed.
- Self-charge surfaces the refusal verbatim; `KatchForm` disables Confirm and explains before the
  card is spent; `CarrierLinesPanel` shows a **burned** badge.

**What LIRA-153 changed**

- New `resolveTelecomCreditReturns` / `telecomCreditReturnValueLbp` in `utils/telecomCredit.ts`.
  Resolution moved OUT of the booking closure so the profit stamp and the drawer leg consume ONE
  number — the two disagreeing is precisely how the bug existed.
- The margin is now `price − gross_cost + returned_credits × R`. `cost`, the provider-drawer
  debit and the supplier payable are untouched.
- `Profits.tsx` renders negative LBP totals in red instead of an em dash.

---

## 0. Verdict first — the six notes, ranked

| #   | Note                                        | What it really is                                                                      | Ticket   | Size      | Order |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------- | -------- | --------- | ----- |
| 1   | OMT transactions saved net of fees          | **Already designed.** `COMMISSION_AT_SETTLEMENT_PLAN.md` Phase 2 (D1), never started   | LIRA-095 | L (3–5 d) | 3rd   |
| 2   | Only-Days profit shows `—`                  | **Real money bug** — profit stamped against the GROSS card cost + a UI that hides `<0` | LIRA-153 | M (1–2 d) | 1st   |
| 3   | Service via partner: payment in, owe cost   | **New flow.** A third partner mode Custom Services does not have                       | LIRA-154 | M (2–3 d) | 4th   |
| 4   | Rename + "insurance" category with statuses | **New feature**, builds on #3. Needs owner input on the status set                     | LIRA-155 | L (3–4 d) | 5th   |
| 5   | Dashboard last-checkpoint time never moves  | **Real query bug** — one uncorrelated subquery                                         | LIRA-156 | S (2–4 h) | 2nd   |
| 6   | Validity math: 22d lapse eaten; 395d > max  | **Real money-adjacent bug** — two independent defects in one 6-line function           | LIRA-157 | S (4–6 h) | 1st   |

**Recommended order:** #6 and #2 first (small, self-contained, both currently produce wrong numbers
the owner is reading off a screen today), then #5 (smallest of all), then #1 (largest, and its plan
already exists), then #3 → #4 (#4 depends on #3's partner mode).

**Owner decisions blocking work:** three, all listed in §7. Only D2.1 (which cost basis prices an
Only-Days sale) changes a number the owner will see; the other two change scope, not arithmetic.

---

## 1. OMT transactions are saved net of fees — the fee should go to the supplier in full

> _"Omt trnx are saved -fees, shouldn't be the case. The amount is owed fully to the supplier, the
> commission is paid separately based on the fee, but the fee should be paid in total to the
> supplier."_

### 1.1 What the code does today

There is **one** definition of what an OMT/WHISH transfer adds to the supplier payable, and its SQL
twin, both in `FinancialServiceRepository.ts`:

- `grossOwedDelta()` — [FinancialServiceRepository.ts:650-673](packages/core/src/repositories/FinancialServiceRepository.ts#L650-L673)
- `SUPPLIER_OWED_EXPR` — [FinancialServiceRepository.ts:713-724](packages/core/src/repositories/FinancialServiceRepository.ts#L713-L724)

With `x` = principal, `f` = the provider's customer-facing fee, `c` = the shop's commission:

```
SEND     →  + (x + f − c)
RECEIVE  →  − (x − f + c)
```

The `− c` is exactly what the owner is objecting to. The shop's own cut is **subtracted from what
the supplier is owed** at transaction time, so the payable is booked net. `FEATURE_GUIDE.md:310`
("§8.1 THE invariant") documents this as the shipped model.

### 1.2 What the owner is asking for

```
SEND     →  + (x + f)      ← the whole fee is owed to the provider
RECEIVE  →  − (x − f)
c        →  settled separately, as its own obligation
```

### 1.3 This is already a written plan — Phase 2 of LIRA-095

`docs/plans/todo_plans/COMMISSION_AT_SETTLEMENT_PLAN.md`, decision **D1**:

> _"Payable goes **GROSS**: SEND `+(x+f)`, RECEIVE `−(x−f)`; JS + SQL twin change in lockstep."_

Phases 0 and 1 shipped 2026-08-08 (`1d498ff`, migration v150): the shared machinery, the single
pending-settlement predicate, the `supplier_settlements` + `settlement_commission_allocations`
tables, and the bills slice. **Phase 2 — the OMT/WHISH flip the owner is describing — was never
started.** The repository says so in its own comments at
[FinancialServiceRepository.ts:1298-1313](packages/core/src/repositories/FinancialServiceRepository.ts#L1298-L1313).

So this note does not need a new design. It needs Phase 2 executed.

### 1.4 The one trap that will ship a double-subtraction

`commission_model` is stamped per row at creation
([FinancialServiceRepository.ts:1315](packages/core/src/repositories/FinancialServiceRepository.ts#L1315)):
`1` = AT_SETTLEMENT for BILL rows, `0` = legacy EMBEDDED for everything else. OMT/WHISH SEND/RECEIVE
are deliberately still `0` **because their payable is still netted by `−c`**.

Flipping `grossOwedDelta` without widening the stamp, or widening the stamp without flipping
`grossOwedDelta`, subtracts the commission twice — once inside the payable, once again at
settlement. An adversarial reviewer caught exactly this pre-commit in Phase 0. Both halves must land
in **one** change.

The guard already exists: `packages/core/src/repositories/__tests__/FinancialServiceRepository.omtCommissionModelGate.test.ts`.
The fixture must use a **realistic** OMT SEND (a real `omtServiceType` + `omtFee` so the auto-calc
at [:1270-1287](packages/core/src/repositories/FinancialServiceRepository.ts#L1270-L1287) actually
fires) — a fixture with `commission: 0` structurally cannot catch this class.

### 1.5 Work breakdown (from the plan's §4 Phase 2, re-verified against HEAD)

1. **Flip both twins in lockstep** (rule 14): `grossOwedDelta` + `SUPPLIER_OWED_EXPR`. Drop the
   `∓ commission` term from all four OMT/WHISH branches.
2. **Widen the `commission_model = 1` stamp** to OMT/WHISH SEND/RECEIVE in the same commit.
3. **Forms stop sending a guessed commission** for new-model rows — `calculateCommission`
   (`utils/omtFees.ts:171-190`) becomes a display **estimate** only. Risk 6 in the plan's §5: if a
   form keeps writing a calculated commission post-cutover, the legacy predicates fire on new rows.
4. **Negative-net settlement.** With gross payables, a RECEIVE-heavy batch can net to "the provider
   owes us". Owner already answered this (**D13**): model the commission as a **directional payment
   leg** reusing `partitionLegs` / `direction: "OUT"` (`packages/core/src/utils/payments.ts`), not a
   `Math.max(0, …)` clamp. Rule 16 applies — the flow branch consumes IN legs only.
5. **~10 pinning tests flip**, each failing-first in both directions (rule 17):
   `OmtSystemFeeCharacterization`, `supplierLedgerAmount`, `SupplierRepository.settlement`,
   `supplierSiblingVoidCascade:378`, `partner.test:676`, e2e `lira-076`, `lira-web-016/017/018`.
6. **Docs**: `FEATURE_GUIDE.md` §8/§8.1 per-case table (`+c` column) is restated by this change and
   must be rewritten in the same PR, or the guide starts lying.

### 1.6 One thing to confirm before starting

There is a **second** possible reading of _"trnx are saved -fees"_: on a **fee-included** SEND/RECEIVE
the frontend pre-nets the principal before the IPC call, so the stored `financial_services.amount`
is `x − f`, not `x` ([FinancialServiceRepository.ts:637-642](packages/core/src/repositories/FinancialServiceRepository.ts#L637-L642),
fee mode `DEDUCTED` at `OmtWhishAppTransferForm.tsx:131-134`). That is a **display/storage** question,
separate from the payable.

Both readings point at the same ledger fix, so Phase 2 is right either way. But if the owner also
wants the transaction ROW to read the gross `x + f`, that is a small extra change and belongs in the
same PR. **→ Decision D1.1 (§7).**

---

## 2. Only-Days sale destroys the module profit (`96,000 LBP` → `—`)

> _"Selling katsh mtc only days, return all credits. We have only days cost with the only days sell
> price. We should be able to track the profits. But in the profits page before the sale i had 96000
> lbp, after sale i can see —"_

**This is the highest-value fix in the batch: it is silently mis-stating profit today.**

### 2.1 What actually happens — traced end to end

An Only-Days sale of one Katsh **mtc 7.58** card (`cost_lbp` 765,007 · `credits` 7.58 ·
`validity_days` 30 — `TELECOM_DAYS_COST_PLAN.md` §1.2):

| Step | Where                                                                                                                                            | What is sent / booked                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| 1    | `KatchForm.tsx:1420` (session) / `:1547` (walk-in)                                                                                               | `cost` = **GROSS** `catalogCost` = 765,007 LBP. Deliberate — see §2.2.          |
| 2    | `KatchForm.tsx:1405-1416`                                                                                                                        | `price` = `sell_days_lbp + kept_credits × credit_price` (the days price)        |
| 3    | [FinancialServiceRepository.ts:1058](packages/core/src/repositories/FinancialServiceRepository.ts#L1058)                                         | `cost = data.cost ?? 0` — the gross, unchanged                                  |
| 4    | [FinancialServiceRepository.ts:1287](packages/core/src/repositories/FinancialServiceRepository.ts#L1287)                                         | `commission = price − cost` ← **the sent commission is ignored and re-derived** |
| 5    | [FinancialServiceRepository.ts:1666-1669](packages/core/src/repositories/FinancialServiceRepository.ts#L1666-L1669)                              | `profit_lbp = commission` → stamped on the transaction                          |
| 6    | [FinancialServiceRepository.ts:1960-2080](packages/core/src/repositories/FinancialServiceRepository.ts#L1960-L2080) `processTelecomCreditReturn` | credits the **MTC drawer +$7.00 USD** and moves the carrier line                |

Step 6 books the returned credit as a **drawer asset**. It never touches `cost`, `commission`, or
the profit stamp. So the stamped profit counts the whole 765,007 LBP outflow and **none** of the
$7.00 that came back.

Worked example (days price 195,000 LBP — iPick's standalone 30-day list price, used here only to make
the magnitude concrete):

```
stamped profit_lbp = 195,000 − 765,007 = −570,007 LBP
```

### 2.2 Why the frontend comment says the repo handles it — and why it doesn't

`KatchForm.tsx:1417-1419` reads:

> _"LIRA-090 B1: GROSS cost — the session recorder sends it through to the repository unchanged, and
> the repo nets to `days_cost_lbp` when `mobileServiceItemId` is present (`processTelecomCreditReturn`)."_

That is true of the **drawer legs** and false of the **profit stamp**. `processTelecomCreditReturn`
runs at [:2207](packages/core/src/repositories/FinancialServiceRepository.ts#L2207)/[:2572](packages/core/src/repositories/FinancialServiceRepository.ts#L2572),
long **after** `commission` is computed (:1287) and the transaction row is written (:1645). There is
no `UPDATE financial_services SET cost` anywhere in the file. The comment describes an intent that
was only half-implemented, and it is why nobody noticed.

Sending the gross cost is **correct** and must not change — the shop really did pay Katsh 765,007
LBP and the Katsh drawer really must fall by that. The bug is entirely in what gets stamped as profit.

### 2.3 Why the screen says `—` rather than a red negative

`Profits.tsx:1181-1185` (**By Module** tab):

```tsx
{
  row.profit_lbp > 0 ? formatAmount(row.profit_lbp, "LBP") : "—";
}
```

`ProfitRepository.getFinancialSettledByProvider`
([:1000-1030](packages/core/src/repositories/ProfitRepository.ts#L1000-L1030)) sums the **stamped**
`t.profit_lbp`. One −570,007 row swamps the +96,000 that was there, the module total goes negative,
and the cell renders `—`. **This is a second, independent defect**: a genuinely loss-making period
is indistinguishable from "no data". The same `> 0 ? … : "—"` pattern appears at `Profits.tsx:1175`
(revenue) and `:1416` (By Payment Method LBP).

### 2.4 The fix

**(a) Stamp the profit against the days cost basis.** The drawer legs stay exactly as they are; only
the number written to `transactions.profit_lbp` changes:

```
profit_lbp  =  price − gross_cost  +  returned_credits × R
```

where `R` = `telecom_credit_cost_rate_lbp`, the per-tenant setting read from `system_settings`,
**never** the literal (rule 14).

> ⚠ **`R` is 85,000 LBP/$, not 93,333.33.** An earlier draft of this document quoted
> 93,333.33 from migration v144’s description — that description is **stale**. Migration
> v148 (`reanchor_telecom_credit_cost_rate`, owner-confirmed 2026-08-05,
> `migrations/index.ts:7555`) moved R to **85,000** and re-derived every `days_cost_lbp` written
> at the old rate; the live constant is `TELECOM_CREDIT_COST_RATE_LBP = 85_000`
> (`packages/core/src/utils/telecomCredit.ts:510`). **Every figure below is at 85,000.**

`returned_credits` is the same resolved credit the drawer leg is given — one number, used
twice, not two derivations.

Sanity check on the same card, with the full recoverable return (`maxReturnableCredits(7.58) = 7.00`
— re-derived from `telecomCredit.ts:143-166` at n=3 messages: balance $7.58 − 3 × $0.16 SMS fee = $7.10 (below the 3 × $3 cap, so the balance binds), floored to
the $0.50 step = **$7.00**):

```
195,000 − 765,007 + 7.00 × 85,000  =  195,000 − 765,007 + 595,000  =  +24,993 LBP
```

A plausible margin instead of a −570,007 crater.

**Structural requirement:** the credit-return amount must be resolved **before** the `commission`
line at :1287, not after. Today `processTelecomCreditReturn` is a closure invoked late. Split it:
resolve the lines (and their `resolvedCredits`) early, book the legs where they are booked now. That
is the whole shape of the change.

**(b) Render negative profit instead of hiding it.** Change the three `> 0` guards to `!== 0` and
colour negatives red. A loss must be visible.

### 2.5 The decision this needs — it changes the number

Two defensible cost bases disagree by the SMS transfer burn:

| Basis                                                         | Cost of days    | Profit on the example | Notes                                                                        |
| ------------------------------------------------------------- | --------------- | --------------------- | ---------------------------------------------------------------------------- |
| (i) catalog `days_cost_lbp` = `round(cost_lbp − credits × R)` | **120,707 LBP** | **+74,293**           | Uses **face** credits 7.58. Ignores the $0.58 burned by SMS fees.            |
| (ii) actual return: `gross_cost − returned_credits × R`       | **170,007 LBP** | **+24,993**           | Uses the **$7.00 actually recovered**. Same number the drawer leg was given. |

Difference: `0.58 × 85,000 = 49,300 LBP` per card — the SMS transfer loss.

**✅ DECIDED 2026-08-29 — (ii), the actual credits recovered.** It is exact, it reuses the figure
and drawer can never disagree), and it degrades correctly when the operator overrides the return
amount. (i) is what the owner's sentence _"we have only days cost with the only days sell price"_
literally describes, and it would keep Settings' margin display and the P&L agreeing — but it books
a profit the shop did not make. **→ Decision D2.1 (§7).**

Currency note either way: the sale is LBP, the return is USD. Valuing the return at `R` keeps the
whole thing in LBP. Do **not** stamp `profit_usd += returned_credits` — that would show a large LBP
loss beside a USD gain for a single sale.

### 2.6 Proof required

- Failing-first (rule 17) in `FinancialServiceRepository.telecomOnlyDays.test.ts`: an Only-Days
  Katsh mtc 7.58 sale asserts the stamped `profit_lbp` is the §2.4 figure. Confirm it fails at
  −570,007 on the pre-fix code before fixing.
- A `ProfitRepository` test that the By-Module row for Katsh is positive after that sale.
- A `Profits.tsx` component test that a negative `profit_lbp` renders a red number, not `—`.
- e2e `lira-149`: baseline the module profit, sell Only-Days, assert the **delta** (rule 15 — never
  an absolute total, never row position).

---

## 3. Service **via** partner — payment form, cash in, we owe the partner the COST

> _"In services when doing a service for syria partner(other) we should be able to see payment form,
> money should come into our drawer, and we should owe to the partner the cost price instead of the
> sell price."_

### 3.1 Today's behaviour is a different relationship

Custom Services has exactly one partner mode, `partnerMode: "FOR"`
([CustomServiceRepository.ts:187](packages/core/src/repositories/CustomServiceRepository.ts#L187)):

- The payment section is **replaced by a notice** (`CustomServices/index.tsx:985-1010`).
- The **full price** books to `partner_ledger` as a `FOR_CUSTOM_SERVICE` **DEBIT** — the partner
  owes us ([CustomServiceRepository.ts:314-336](packages/core/src/repositories/CustomServiceRepository.ts#L314-L336)).
- No drawer moves. Cost is a profit input only, never a drawer leg (`§2a`, `d1a0ad2`).

That models **"the partner is the customer"**. The owner's Syria case is the mirror image: **"the
partner performs the service, the customer pays us."**

| Axis              | FOR partner (today)           | VIA partner (asked for)       |
| ----------------- | ----------------------------- | ----------------------------- |
| Who pays the shop | nobody now; the partner later | the walk-in customer, now     |
| Payment form      | hidden                        | **shown**                     |
| Drawer            | untouched                     | **+ price** (normal legs)     |
| `partner_ledger`  | **DEBIT** price (they owe us) | **CREDIT cost** (we owe them) |
| Shop profit       | price − cost                  | price − cost (same)           |

The naming already exists elsewhere in the codebase and matches: `FinancialServiceRepository` uses
`partner_mode: 'THROUGH' | 'FOR'` where THROUGH = _"we use their system"_
([:433-434](packages/core/src/repositories/FinancialServiceRepository.ts#L433-L434)). "Via partner"
is THROUGH, applied to Custom Services.

The partner itself needs no new concept: `system_association = 'OTHER'` already exists as a seeded
`service_providers` row (`create_db.sql:1506`, label "Other", drawer General,
`is_system_provider = 0`), and `ForPartnerToggle` in Custom Services passes **no** `systemFilter`, so
a Syria/Other partner is already selectable.

### 3.2 Design

**Migration v158** — `ALTER TABLE custom_services ADD COLUMN partner_mode TEXT DEFAULT NULL
CHECK(partner_mode IN ('FOR','VIA'))`, plus the mirrored `create_db.sql` change (rule 10). Existing
rows read NULL; a NULL row with a `partner_id` is legacy FOR. **Do not** infer the mode from the
partner's `system_association` — a per-row stamp is required so a reversal can branch correctly
(precedent: `commission_model` D3, `supplier_debt_booked` v115).

**New ledger type** `VIA_CUSTOM_SERVICE`, direction **CREDIT**, amount = the **cost** components per
currency (never a converted single figure — same rule the FOR path follows). Add it to the union at
[PartnerRepository.ts:127-168](packages/core/src/repositories/PartnerRepository.ts#L127-L168) and to
the doc comment above it — `partnerLedgerTypes.guard.test.ts` scans that comment as plain text for
"used somewhere".

**Repository** (`CustomServiceRepository.createService`): a third branch beside the existing FOR
branch at `:284-340`. It takes the **normal** payment path (legs, drawers, client propagation — all
of it unchanged) and additionally writes the partner CREDIT. Rule 16: if that branch iterates
`data.payments`, it must build from the **IN** set via `partitionLegs`; the shared end-of-transaction
loop already debits OUT/change legs.

**Reversal (rule 20) — already covered, verify don't rebuild.** `_reversePartnerLedger`
([TransactionRepository.ts:3006](packages/core/src/repositories/TransactionRepository.ts#L3006))
matches by `reference_table`/`reference_id`, not by type, so a `VIA_CUSTOM_SERVICE` row tied to
`custom_services`/`id` is swept by the generic void/refund path with no new code. **Prove it**: a
create → void test asserting the partner balance and every drawer net to **0, per currency**,
failing-first.

**Frontend** (`CustomServices/index.tsx`): the toggle becomes a two-option mode when a partner is
selected. In VIA mode the payment section stays mounted (do not clear `paymentLines`/`returnLegs` —
`:960-968` currently wipes them on toggle) and the notice reads _"You will owe {partner} the cost,
{cost}. The customer pays the full price now."_ Submit guard: VIA requires a partner **and** at least
one payment leg (or an explicit CUSTOMER_ACCOUNT leg).

**Rule 19 — both transports.** Zod schema in `packages/core/src/validators/customService.ts` gains
`partnerMode`; re-export in `electron-app/schemas/index.ts`; `backend/src/api/customServices.ts`
mirrors it; `preload.ts` + `electron.d.ts` + `backendApi.ts` + `packages/ui` `ApiAdapter` types
updated (rule 12). Prove with `lira-web-027` as well as the desktop spec.

**Also flag while in here:** `CustomServices/index.tsx` uses `useApi()` throughout — good. But the
setup wizard (`StepComplete.tsx:61`) calls raw `window.api.closing.createCheckpoint`, a rule-19(a)
violation on the path §5 touches. Sweep it in whichever ticket lands first.

---

## 4. Rename "For Partner" → "Via Partner", and a new **insurance** category with statuses

> _"In services, change for partner to via partner. Create new category with special behavior,
> 'insurance' with via partner option, an insurance should be tracked, a sale insurance should have
> status (ordered, collected etc think of other statuses) we can collect the price of it but it can
> still be ordered."_

### 4.1 The rename — one question first

Read together with note #3, _"change for partner to via partner"_ has two possible meanings:

- **(A) Replace.** Custom Services only ever had one partner relationship, the owner always meant
  #3's semantics, and today's FOR behaviour is simply wrong. → rename the label, change the money.
- **(B) Add.** Both relationships are real; the label "For Partner" is just confusing for the Syria
  case. → a two-option selector, "For partner" / "Via partner".

**Recommendation: (B).** The FOR path is deliberate shipped behaviour (LIRA-081 / PFT-R), has its own
ledger type, settlement FIFO coverage (`covered_amount`, v128) and specs; deleting it would strand
any existing `FOR_CUSTOM_SERVICE` rows. (B) also matches the FOR/THROUGH pair that already exists in
financial services, so the app ends up with one vocabulary instead of two. **→ Decision D4.1 (§7).**

If the owner picks (A), §3's repository branch replaces rather than joins the existing one, and a
data-migration decision for existing FOR rows is required (recommend: leave them, gated by the v158
`partner_mode` stamp — cutover, not restatement, same as `commission_model`).

### 4.2 Insurance — the shape of it

The key sentence is _"we can collect the price of it but it can still be ordered."_ **Payment status
and fulfilment status are independent axes.** Do not encode fulfilment into
`custom_services.status`, which is `CHECK(status IN ('pending','completed','voided'))`
(`create_db.sql:884`) and is the void/refund axis — overloading it would make a collected-but-not-yet-
delivered insurance indistinguishable from a voided one to every reversal query.

**Migration v158** (same migration as §3, one version bump): `ALTER TABLE custom_services ADD COLUMN
fulfillment_status TEXT DEFAULT NULL` + a `CHECK` over the agreed set, `+ fulfilled_at TEXT`. NULL =
not a tracked-fulfilment service (every existing row, and every non-insurance service). Mirror in
`create_db.sql`, `down()` for both (rule 10).

**Precedent to copy:** `maintenance_jobs` already runs exactly this pattern —
Received / In_Progress / Ready / Delivered / Delivered_Paid (`FEATURE_GUIDE.md:24`). Reuse its
transition + filter shape rather than inventing one.

**Status set — owner input needed.** The owner named "ordered, collected" and asked for more. A
proposal to react to (not to adopt silently):

| Status      | Meaning                                             | Terminal? |
| ----------- | --------------------------------------------------- | --------- |
| `ORDERED`   | placed with the partner/insurer, nothing back yet   | no        |
| `ISSUED`    | policy/document exists, not yet in the shop's hands | no        |
| `RECEIVED`  | in the shop, ready for the customer                 | no        |
| `DELIVERED` | handed to the customer                              | **yes**   |

> ✅ **`CANCELLED` is NOT a stored status** (owner decision D4.2b, 2026-08-29). Cancel and
> Refund are ONE operation with two doors: the insurance page’s Cancel button calls the SAME
> generic refund path the Transactions table uses, and the page renders "Cancelled" when
> `custom_services.is_refunded = 1` — a flag the generic refund already stamps
> (`TransactionRepository._markSourceRefunded`’s whitelist includes `custom_services`).
> Deriving it means the two pages cannot disagree, because there is only one fact. A stored
> `CANCELLED` alongside `is_refunded` would be the same truth in two columns, and those drift.
>
> Two consequences, both accepted: cancelling an UNPAID insurance still writes a zero-value
> REFUND row (correct — it is still a reversal, and it is the most common cancel), and
> cancelling is NOT undoable, matching the repo’s additive-only reversal convention.

**✅ Both answered (D4.2, D4.2b)** — see §7.

**Category.** Add `{ value: "insurance", label: "Insurance", icon: "shield" }` to `SERVICE_CATEGORIES`
(`CustomServices/index.tsx:77-87`). It follows the `hold_money` precedent at `:88-89`: a category
whose selection swaps in extra form behaviour — here, the fulfilment-status field and the VIA-partner
default — rather than a new module.

**Tracking surface.** An "Insurance" filter + status column on the Custom Services history, and a
dashboard notification card for `ORDERED`/`ISSUED` items older than N days, following the active
money-holds card (`Dashboard.tsx:443-450`).

**Rule 19 + 12** apply exactly as in §3 for every new field.

---

## 5. Dashboard "last checkpoint" time never updates (timeline is correct)

> _"Dashboard checkpoint is not changing the last checkpoint time in dashboard but is propagating
> correctly in checkpoint timeline."_

### 5.1 The event chain is fine — the query is not

The refresh path works: `Checkpoint/index.tsx:343` emits `closing:completed`; `Dashboard.tsx:541-546`
subscribes and calls `loadData()`, which re-fetches `getLastCheckpointPerDrawer()` at `:415`. The
timeline reads a different method (`getCheckpoints`, ordered `dc.created_at DESC`) and is correct —
which is exactly the asymmetry the owner observed.

The defect is in `ClosingRepository.getLastCheckpointPerDrawer()`
([:1012-1052](packages/core/src/repositories/ClosingRepository.ts#L1012-L1052)):

```sql
WHERE dca.closing_id IN (
  SELECT MAX(dca2.closing_id) FROM daily_closing_amounts dca2
  WHERE dca2.tenant_id = ? GROUP BY dca2.drawer_name      -- ← NOT correlated to dca.drawer_name
)
...
ORDER BY dca.drawer_name, dca.currency_code                -- ← no time ordering at all
```

The `IN` list is a flat set of closing ids. It is never re-checked that the row's own closing is
_that drawer's_ latest. Then the JS loop
([:1040-1052](packages/core/src/repositories/ClosingRepository.ts#L1040-L1052)) sets `checked_at`
from the **first** row it sees for a drawer, while `amounts[currency]` is **overwritten** by every
later row.

### 5.2 Why a drawer ends up with rows from two closings

Most checkpoints are single-drawer: `Checkpoint/index.tsx:253-258` stamps every amount row with the
one `drawerName`. But two paths write a **multi-drawer** checkpoint:

- `InitialDrawerAmountsModal.tsx:151-168` — `drawer_name: "AGGREGATED"`, `amountRows` looped over
  **every** visible drawer.
- `StepComplete.tsx:61-71` — the same, written **unconditionally on every fresh install**.

So every database has at least one closing spanning all drawers. (Confirmed in the live app db:
`daily_closings` id 1, `drawer_name` `AGGREGATED`, `2026-08-22 12:48:36`.) Once the operator
checkpoints, say, General individually:

```
MAX(closing_id) per drawer →  General: 7   MTC: 1   Alfa: 1  …
IN list                    →  {1, 7}
rows for "General"         →  from closing 1 (the setup baseline) AND from closing 7 (today)
```

`checked_at` is taken from whichever of those two the sort emits first — with ties on
`(drawer_name, currency_code)` broken by scan order, that is the **lower rowid**, i.e. the older
closing. The amounts, being overwritten, come from the newer one. **Result: the numbers update, the
time is frozen at the setup baseline** — precisely the reported symptom.

**Confidence: `Likely` — mechanism verified in source, not reproduced on data.** The live db has been
reset (`daily_closing_amounts` = 0 rows), so the two-closing state could not be observed directly.
The repro in §5.4 settles it in minutes and must be run before the fix, not after.

### 5.3 The fix

Correlate per drawer and order by time, not by id:

```sql
SELECT checked_at, drawer_name, currency_code, physical_amount, opening_amount FROM (
  SELECT dc.created_at AS checked_at, dca.drawer_name, dca.currency_code,
         dca.physical_amount, dca.opening_amount,
         ROW_NUMBER() OVER (PARTITION BY dca.drawer_name
                            ORDER BY dc.created_at DESC, dc.id DESC) AS rn
  FROM daily_closing_amounts dca
  JOIN daily_closings dc ON dc.id = dca.closing_id AND dc.tenant_id = ?
  WHERE dca.tenant_id = ?
) WHERE rn = 1
ORDER BY drawer_name, currency_code
```

`ROW_NUMBER()` needs SQLite ≥ 3.25 — better-sqlite3 ships far newer, and window functions are already
used elsewhere in core. If a plain-SQL form is preferred, a correlated
`dca.closing_id = (SELECT MAX(...) WHERE dca2.drawer_name = dca.drawer_name)` is equivalent, but the
partition form also fixes the id-vs-time ordering in the same expression.

`ORDER BY dc.created_at DESC, dc.id DESC` (not id alone) matters because `created_at` is
second-granular — two checkpoints in the same second tie, and `id DESC` is the documented tiebreak
convention in this repo (`FEATURE_GUIDE.md:47`).

**Also decide:** should the setup/initial-amounts `AGGREGATED` baseline count as a checkpoint for
staleness at all? It is a real physical count, so yes by default — but if the owner wants the
dashboard dot to read "Never" until a real checkpoint is taken, filter
`dc.drawer_name != 'AGGREGATED'`. Low stakes, mention it, don't block on it.

### 5.4 Proof (failing-first, rule 17)

A `ClosingRepository` unit test on an in-memory db:

1. `createCheckpoint({drawer_name: 'AGGREGATED', amounts: [General/USD, MTC/USD]})`
2. sleep past a second boundary, then `createCheckpoint({drawer_name: 'General', amounts: [General/USD]})`
3. assert `getLastCheckpointPerDrawer()['General'].checked_at` equals the **second** closing's
   `created_at`.

Watch it fail on the current query first. Then e2e `lira-149`: read the dashboard chip, take a
checkpoint, assert the chip text changed (a **delta**, not an absolute time — rule 15).

---

## 6. Carrier-line validity: the lapse is forgiven, and there is no 365-day ceiling

> _"Charging a line that is expired 22d ago by 1 month now shows expiry in 30d, but should be in
> 8 (30−22). Another case: when I already have 30d expiry, charging the shop line with a 77 card that
> has 365 days showcases 395d validity for the line. A line can have max 365 days validity."_

### 6.1 Both cases reduce to six lines

Everything that moves a line's expiry goes through the private module-level
`computeAppliedState()` — [CarrierLineRepository.ts:970-996](packages/core/src/repositories/CarrierLineRepository.ts#L970-L996):

```ts
let newExpiry = line.validity_expires_at;
if (validityDaysDelta !== 0) {
  const today = localDay();
  const base =
    line.validity_expires_at && line.validity_expires_at > today
      ? line.validity_expires_at
      : today; // ← bug (a): the lapse is discarded
  newExpiry = addDaysToDateString(base, validityDaysDelta);
} // ← bug (b): nothing caps the result
```

Both of the owner's numbers fall straight out of it:

| Case                              | `base`     | Result        | Displayed (`daysRemaining`) | Owner expects |
| --------------------------------- | ---------- | ------------- | --------------------------- | ------------- |
| expired 22d ago, +30 days         | `today`    | `today + 30`  | **30 d**                    | **8 d**       |
| 30 d left, + a 77.28 card (365 d) | `today+30` | `today + 395` | **395 d**                   | **365 d max** |

The display side is innocent: `daysRemaining` (`frontend/src/shared/utils/daysRemaining.ts:14-20`)
is a single shared definition and reports the stored date faithfully.

The "extends from today" rebasing was never an owner decision — it was a defensive convenience
documented at [CarrierLineRepository.ts:667-670](packages/core/src/repositories/CarrierLineRepository.ts#L667-L670)
(_"'10 more days' on a line that lapsed three months ago lands 10 days from now"_). The owner has now
stated the real carrier rule: **the validity clock keeps running while the line is lapsed, and the
top-up pays off the lapse first.**

### 6.2 The fix, as built

The rule lives in **`packages/core/src/utils/carrierLineValidity.ts`** — a new, pure module.
It is deliberately NOT inside the repository any more: while the rule was a private helper in
`CarrierLineRepository`, the only way to learn where a charge would land was to perform it, which is
why the UI could promise 395 days and why the rule could not be unit-tested without a database.

```ts
export const MAX_LINE_VALIDITY_DAYS = 365;
export const LINE_REVIVAL_GRACE_DAYS = 5;

// charge (daysDelta > 0)
if (state === "BURNED") return { burned: true }; // refuse — D6.4
const base = state === "VALID" ? expiry : today; // stack, or start today in GRACE
const extended = addDaysToDateString(base, daysDelta);
const ceiling = addDaysToDateString(today, MAX_LINE_VALIDITY_DAYS);
return {
  expiry: extended > ceiling ? ceiling : extended,
  capped: extended > ceiling,
};

// sell (daysDelta < 0) — consumption, never refused, no grace, no ceiling
return { expiry: addDaysToDateString(expiry ?? today, daysDelta) };
```

`today` is a parameter, never a `localDay()` call inside the rule, so the whole projection is
testable across a date boundary without mocking a clock.

Checks against the owner's two reports: 30 days left + a 365-day card = `today+395` → clipped to
`today+365` ✅. A line lapsed 22 days is BURNED, so the charge is refused rather than
rebased ✅ (this supersedes note #6's own "8 (30−22)" expectation — see §6.4).

`CarrierLineRepository.computeAppliedState` keeps only assembly: credits are a plain sum, the expiry
comes from `projectValidityExpiry`, and a burned projection is turned into a throw inside the
existing db transaction (so better-sqlite3 rolls the savepoint back and no partial movement row
survives — asserted).

**Where the constants live.** Not in `telecomCredit.ts` as originally proposed: that module is credit
and SMS math, this is validity dates. They sit in the new module beside the rule that uses them.
The carrier union moved too — `TelecomCarrierKey` now has ONE definition in the util layer, and
`CarrierLineRepository.CarrierKey` is an alias of it, because a util cannot import a repository
without inverting the layering. No call site changed.

**Frontend, same rule.** `KatchForm`'s self-charge dialog imports `projectValidityExpiry` and shows
what the charge will really do — it disables Confirm on a burned line, warns when the ceiling
will clip part of the card, and says so when the grace window means the lapsed days are not
recovered. `CarrierLinesPanel` shows a **burned** badge via `classifyLineValidity`. Neither
re-implements the comparison.

### 6.3 Three callers share this function — check each

| Caller                                                                                                                                | Delta    | Effect of the change                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Self-charge ADD ([FinancialServiceRepository.ts:4007-4011](packages/core/src/repositories/FinancialServiceRepository.ts#L4007-L4011)) | positive | **The fixed case.** Both of the owner's reports come from here.                                                                                                                                                      |
| DAYS sale SUBTRACT ([RechargeRepository.ts:1000-1006](packages/core/src/repositories/RechargeRepository.ts#L1000-L1006), LIRA-113)    | negative | Selling 10 days off an already-lapsed line now reads `expiry − 10` instead of `today − 10`. More truthful; **must be re-pinned**, its comment at `:973-976` explicitly documents the old rebasing and becomes stale. |
| Checkpoint counted date ([ClosingRepository.ts:546](packages/core/src/repositories/ClosingRepository.ts#L546))                        | **0**    | Unaffected — takes the `validityExpiresAt` absolute branch at `:981-983`, which returns before this code.                                                                                                            |

**Reversal (rule 20) is already safe — say so, don't rebuild it.** `applyMovement` snapshots
`previous_validity_expires_at` **before** mutating
([:702-703](packages/core/src/repositories/CarrierLineRepository.ts#L702-L703)) and `reverseMovement`
restores it **verbatim** rather than re-deriving by day math. So both the de-rebasing and the cap are
reversal-transparent by construction. Still assert it: apply → void → expiry back to the exact prior
string, including a movement that was capped.

### 6.4 ✅ ANSWERED — the rule as built

The owner's answers (interview 2026-08-29) replaced the proposal above with a sharper rule. Note
that **D6.2 supersedes note #6's own "8 (30−22)" expectation**: a line 22 days lapsed is not
short-changed, it is _dead_, so the subtraction never arises.

| Decision | Question                   | Answer                                                                                    |
| -------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| D6.1     | Deep lapse (400 days), +30 | Not chargeable at all — beyond 5 days the line is burned                                  |
| D6.2     | Lapsed 3 days, +30         | **today + 30** — inside the grace the lapse is forgiven, days start today                 |
| D6.3     | Live line, 30 left + 30    | **60** — charges STACK, then the ceiling applies                                          |
| D6.4     | Charging a burned line     | **Hard block** with an explanation; the absolute-date path stays open as the escape hatch |

The rule as implemented (`projectValidityExpiry`):

```
charge (days > 0):
    no expiry            -> today + days
    valid (expiry >= today) -> expiry + days          (stack)
    lapsed <= 5 days     -> today + days              (grace)
    lapsed  > 5 days     -> REFUSED                   (burned)
    then, always         -> min(result, today + 365)  (ceiling)

sell (days < 0):
    (expiry or today) + days   — never refused, no grace, no ceiling
```

Two deliberate asymmetries, both tested:

- **Selling days is never refused.** Consumption is a record, not a revival. Before this change the
  sale path rebased a lapsed line onto today, so selling 10 days off a line 22 days dead stored
  `today − 10` — reporting it as _less_ expired than it really was.
- **The absolute counted-date path is exempt** from both the ceiling and the burned check. A
  checkpoint count is evidence of what the carrier did, not a projection of what a charge would do,
  and it is the only way to record the state of a burned line.

Reversal (rule 20) needed no new code and is asserted anyway: the grace rebase and the ceiling clip
both DISCARD days, so no `-validityDaysDelta` arithmetic could undo either — only
`previous_validity_expires_at`, the snapshot that has been stored since v141, can.

### 6.5 Proof

- `CarrierLineRepository` unit tests, failing-first, for both of the owner's exact cases (22-day
  lapse + 30; 30 remaining + 365) and for the cap boundary (exactly 365 must **not** be capped).
- A negative-delta test pinning the DAYS-sale path's new behaviour.
- Apply → reverse → exact-string restore, including a capped movement.
- e2e `lira-149`: self-charge the 77.28 card and assert the panel chip (`CarrierLinesPanel.tsx:432`)
  reads 365, not 395.

---

## 7. Owner decisions — all answered 2026-08-29

Every decision this document raised has been answered in interview. Recorded here so the reasoning
survives; the sections above are written against these answers.

| ID       | Question                           | Answer                                                                                                                                                |
| -------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D2.1** | Only-Days cost basis               | **Actual credits recovered.** Catalog `days_cost_lbp` prices the days at 120,707 against a real 170,007, overstating every card by 49,300 LBP. Built. |
| **D4.1** | "Via partner": replace or add?     | **Add as a second mode.** The FOR flow is shipped and has live ledger rows. Not yet built (LIRA-154).                                                 |
| **D4.2** | Insurance statuses                 | **ORDERED → ISSUED → RECEIVED → DELIVERED**. Payment is an independent axis. NO stored `CANCELLED` — see D4.2b. Not yet built (LIRA-155).             |
| **D6.1** | Deep lapse (400 days), +30         | **Not chargeable** — beyond 5 days the line is burned. Built.                                                                                         |
| **D6.2** | Lapsed 3 days, +30                 | **today + 30** — inside the grace the lapse is forgiven. Built.                                                                                       |
| **D6.3** | Live line, 30 left + a 30-day card | **60** — charges stack, then the ceiling applies. Built.                                                                                              |
| **D6.4** | Charging a burned line             | **Hard block** with an explanation; the absolute counted-date path stays open. Built.                                                                 |

### ✅ D1.1 and D4.2b — answered 2026-08-29

| ID        | Question                                     | Answer                                                                                                                                                                                                                                                                                                                                           |
| --------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **D1.1**  | OMT row on a fee-included transfer           | **Show the cash that crossed the counter.** The row amount becomes the total the customer handed over, with the split in the summary, so the row, the drawer and the payable all carry ONE number. Today they carry three, and the fee is invisible on plain OMT/WHISH rows (the `(+fee)` suffix is wallet-providers-only). Ships with LIRA-095. |
| **D4.2b** | Money on a cancelled, already-paid insurance | **Cancel ≡ Refund — one operation, two doors.** No stored `CANCELLED`; derived from `is_refunded`. See §4.2.                                                                                                                                                                                                                                     |

## **Nothing is blocked on an owner answer any more.**

## 8. Cross-cutting notes for whoever builds these

- **Rule 15 in every e2e.** All six touch shared-DB accumulating specs. Match rows by identity
  (`source_id`, `item_key`, provider + service_type) and assert **deltas** around the action. Never
  `getRecent(...)[0]`, never `tbody tr.first()`.
- **Rule 17 everywhere.** Each of #2, #5, #6 is a wrong-number bug; each guard test must be watched
  failing on the current code before the fix lands. #5's is the one most likely to be skipped — its
  repro needs two checkpoints with the right shapes, which is 10 minutes of setup, not zero.
- **Rule 19 on #3 and #4 only.** They add fields and a write path; both need the REST mirror, the
  shared Zod schema in `packages/core/src/validators/`, and a `lira-web-*` spec. #1, #2, #5, #6 are
  repository-internal and reach both transports for free — but #2 and #5 still need their web-mode
  read paths re-checked, since both feed pages that render in the browser.
- **One migration.** §3 and §4 both alter `custom_services`; fold them into a single **v158** with
  both `ALTER`s, mirrored in `create_db.sql`, with a working `down()` (rule 10). Re-read
  `migrations/index.ts` tail before writing it — v157 is today's head and this number goes stale fast.
- **Docs that go stale with these changes**, and must move in the same PRs: `FEATURE_GUIDE.md` §8/§8.1
  (#1 restates the per-case table), §1 module taxonomy (#4 adds a category with behaviour),
  `COMMISSION_AT_SETTLEMENT_PLAN.md` header (#1 moves it to Phase 2 done),
  `CarrierLineRepository.ts:667-670` + `RechargeRepository.ts:973-976` doc comments (#6 invalidates
  both), `KatchForm.tsx:1417-1419` (#2 — the comment currently claims a netting that does not happen).
