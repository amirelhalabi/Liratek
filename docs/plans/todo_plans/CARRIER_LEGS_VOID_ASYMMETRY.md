# Carrier-legs void asymmetry (multi-unit split checkouts)

**Status:** implemented as **design B+** (2026-07-19, W5). Metadata group
linkage + void guard + whole-group void — no migration. See "Implementation
(B+)" below for what shipped, and "Follow-up" for the deferred design-A work
and the legacy-row limitation.
**Origin:** code-review 2026-07-17 of the auto-debt-remainder change set
(removed-behavior audit, findings 1–2). Pre-existing property of the
**lira-095 legs-carrying convention**, not a regression — but the auto-debt
feature makes split payloads far more common, so exposure is now real.

## The convention today

Multi-unit checkouts (KatchForm bills since lira-095; FinancialForm catalog
units since this change set) submit ONE transaction per unit, and the payment
legs (the customer's full tender + any CUSTOMER_ACCOUNT debt + change/return
legs + kept change) book against exactly **one CARRIER transaction** — the
first unit. Every sibling unit submits `deferPayment: true` (cost + commission
only). This is correct at create time: money books once, cost books per unit.

Guarded by: `FinancialForm.legsCarrier.test.tsx` (jest, failing-first proven)
and KatchForm's inline guard comment. The N×-overbooking alternative (same
legs attached to every unit call) is the bug this convention prevents.

## The asymmetry (rule 20 gap)

Each unit is an independent `FINANCIAL_SERVICE` transaction with **no
cart/group id linking siblings**, so the generic void/refund
(`TransactionRepository._reversePayments`, same path for void and refund)
operates per-transaction:

1. **Void the CARRIER** → the ENTIRE cart's customer cash-in (and debt) is
   reversed, but only the carrier's own cost/profit. Sibling units keep their
   `-cost` provider-drawer legs and profit stamps: books show the shop paid
   the provider for N−1 units, earned profit on them, and retained zero
   customer money.
2. **Void a SIBLING** → its cost/profit reverse, but the customer's payment
   for that unit (living on the carrier) is untouched: the customer stays
   fully charged for a unit that was cancelled; no cash/debt is returned.

Create + reverse does NOT net to 0 across ledgers per currency unless the
operator voids **every** unit of the checkout — and nothing enforces or even
suggests that.

## Candidate designs (pick one)

- **A. Checkout group id** — new column (e.g. `transactions.group_id` or a
  `checkout_id` on `financial_services`) stamped on every unit of one
  checkout. Void of ANY member offers/forces group void; the generic reversal
  walks the group. Deepest fix; touches migration + create paths + void UI.
- **B. Carrier-aware void guard** — voiding a transaction that carries legs
  larger than its own price (or one flagged `deferPayment`-sibling) is
  blocked with a message directing the operator to void the whole checkout
  (manually, unit by unit, carrier last). Cheap, honest, no schema change.
- **C. Proportional re-carry** — voiding a sibling moves a price-share of the
  carrier's legs onto a compensating adjustment row. Most "automatic", by far
  the most complex; interacts with debt, change legs, kept change. Not
  recommended as a first step.

Recommendation: **B now, A when a migration window is open.** Option B is a
single guard in the void path + one failing-first spec (void carrier of a
2-unit split → blocked; void sibling → blocked; void both in order → allowed
and nets to 0).

## Acceptance (rule 17 / rule 20)

- Failing-first test demonstrating today's non-zero net after a partial void
  of a 2-unit split-payment checkout (drawer + debt_ledger, per currency).
- After the fix: create + (whole-checkout) reverse nets to 0 across
  `payments`/drawers, `debt_ledger`, and profit stamps, per currency.
- KatchForm bills AND FinancialForm catalog units both covered.

---

## Implementation (B+) — 2026-07-19, W5

Shipped exactly as **B (cheapest possible linkage) + a whole-group void
method**, per the recommendation trajectory above. No schema migration.

1. **Metadata group linkage at create time.** `KatchForm.tsx` and
   `FinancialForm.tsx` compute, once per checkout before the per-unit
   submit loop, `totalCheckoutUnits` (KatchForm: `(cart.size>0?1:0) +
pendingBills.length`; FinancialForm: `Σ line.quantity`) and
   `useSplitGroup = totalCheckoutUnits > 1 && paymentsPayload !== undefined`
   (the exact condition under which a real carrier/sibling split exists — a
   no-legs checkout, e.g. session-deferred mode, never hits this asymmetry).
   When true, one `crypto.randomUUID()` (`splitGroupId`) is generated and
   sent with EVERY unit as `split_group` (the uuid), `split_role`
   (`"carrier"` | `"sibling"`, reusing each call site's existing `isCarrier`
   boolean), and `split_units` (the count). Single-unit checkouts send
   nothing — no metadata noise.
   `FinancialServiceRepository.createTransaction` persists these three
   fields into the unified row's `metadata_json` (next to
   `provider`/`service_type`/etc.) ONLY when `data.split_group` is present.
   `CreateFinancialServiceData` gained the three optional fields; the core
   Zod validator (`packages/core/src/validators/financial.ts`) and its
   LOCAL duplicate (`electron-app/schemas/index.ts`'s `FinancialServiceSchema`
   — rule-14 debt, same trap as `checkoutTotal`/`deferPayment`) both gained
   matching optional fields; `electron-app/preload.ts`'s `omt.addTransaction`
   param type gained them too (rule 12). Both KatchForm-bills (provider
   `Katsh`/`iPick`, `serviceType: "BILL"`) and FinancialForm-catalog
   (provider `WHISH_APP`/`OMT_APP`, `serviceType: "SEND"`) shapes go through
   this SAME repository method — no separate recharge-path plumbing was
   needed (neither form calls `RechargeRepository`).

2. **Void guard.** `TransactionRepository._assertReversible` gained a
   `{ allowSplitGroupMember?: boolean }` option. When NOT set (the default —
   every external caller: `voidTransaction`, `refundTransaction`), a row
   whose `metadata_json` parses to a `split_group` (via the new private
   `_getSplitGroup` helper) is refused with `"This transaction is part of a
{N}-unit checkout; void the whole checkout instead."` — applies to BOTH
   void and refund, and to carrier AND sibling alike (case 2 of the
   asymmetry — a lone sibling void/refund must be blocked too, since it
   would leave the customer charged for a "cancelled" unit). Members are
   found by `json_extract(metadata_json, '$.split_group') = ?` (a bound
   parameter) — a deliberate deviation from this doc's originally-suggested
   `metadata_json LIKE '%"split_group":"<id>"%'`: `json_extract` is already
   the established pattern for querying this exact column in this exact
   file (the provider/service_type filters in `getRecent`), gives an EXACT
   match instead of a substring scan, and is provably safe (`metadata_json`
   is always either NULL or `JSON.stringify`-produced, so it's never
   malformed JSON).

3. **`voidCheckoutGroup(groupId, userId)`.** New `TransactionRepository`
   method: finds every member (`reverses_id IS NULL AND
json_extract(...) = ?`), ranks siblings before the carrier, and — inside
   ONE `this.transaction(...)` — calls a new private `_voidTransactionInternal`
   (the exact former body of `voidTransaction`, now parameterized by the
   guard-bypass option) per non-voided member with
   `{ allowSplitGroupMember: true }`. better-sqlite3 nests
   `db.transaction()` calls via savepoints, so this is genuinely atomic — a
   failure partway through rolls back every member already voided in that
   call. `voidTransaction`/`refundTransaction` themselves are unchanged in
   behavior for ordinary rows (they now just delegate to
   `_voidTransactionInternal(id, userId, {})`, i.e. the guard active).
   Idempotent: an already-VOIDED member is skipped, not errored; an unknown
   `groupId` throws `NotFoundError`.
   Dual-transport (rule 19): IPC `transactions:void-checkout-group` (
   `electron-app/handlers/transactionHandlers.ts`, `requireRole(["admin"])`
   matching the existing void/refund handlers, `validatePayload` against a
   new shared `voidCheckoutGroupSchema`
   (`packages/core/src/validators/transaction.ts`) re-exported with the
   zod-major cast as `VoidCheckoutGroupSchema`); REST
   `POST /api/transactions/checkout-group/:groupId/void` (same schema via
   `validateParams`, `requireAuth` + `requireRole(["admin"])`); dual-mode
   `voidCheckoutGroup()` in `frontend/src/api/backendApi.ts`; exposed on
   `ElectronApiAdapter`; typed on `ApiAdapter` in
   `packages/ui/src/api/types.ts`; preload binding + `electron.d.ts`
   `transactions.voidCheckoutGroup` entry.

4. **Void UI.** `TransactionsViewer.tsx`'s per-row action cell: a new
   `getSplitGroupInfo(row.metadata_json)` helper detects a `split_group`
   row and renders a single **"Void entire checkout (N units)"** button
   (calling `voidCheckoutGroup`) in place of the ordinary Void/Refund pair —
   never both, since a lone Void/Refund on a split-group row would only
   surface the guard's error. Non-split rows are completely unaffected.

5. **Tests.** Core jest
   `FinancialServiceRepository.splitGroupVoid.test.ts` (20 tests): metadata
   wiring for both shapes, the guard blocking void/refund of carrier AND
   sibling for both shapes (failing-first proven — see the W5 report for
   the captured pre-fix failure output), a permanent "bug mechanism"
   documentation pair using the same `allowSplitGroupMember: true` bypass
   `voidCheckoutGroup` itself uses (no code reversion needed to demonstrate
   the non-zero net), and `voidCheckoutGroup` netting-to-0 proofs covering a
   cross-currency tender case (Checkout A) and a CUSTOMER_ACCOUNT debt-leg
   case with non-zero profit (Checkout B). E2E spec (write-only, per W5's
   constraints) `frontend/tests/e2e-electron/lira-124-split-void-group.spec.ts`.

## Follow-up (not done — owner sign-off items)

- **Design A (real `group_id` column)** when a migration window opens: the
  metadata-based lookup (`json_extract` over `metadata_json`) is
  functionally correct but not indexed — fine at today's per-checkout
  member counts (2–a handful), but a dedicated `checkout_group_id` column +
  index would be the "deepest fix" this doc's original candidate-designs
  section describes, and would also let the guard/void-group logic drop its
  JSON-parsing entirely.
- **Legacy-row limitation.** Any split checkout created BEFORE this fix
  landed carries no `split_group` marker in its `metadata_json` — the guard
  cannot detect it, and a lone void/refund of one of those old rows is
  still exposed to the exact asymmetry this doc describes. There is no
  retroactive fix without a data migration that infers group membership
  from timing/amount heuristics, which was explicitly out of scope for B+.
- **B+ as a design choice** (owner sign-off item): B+ was chosen over
  stopping at bare option B (guard only, no group-void) because a guard
  with no unblocking path would strand an operator who legitimately needs
  to cancel a whole checkout. It was chosen over option A (real column)
  because A requires a migration and this fix needed to ship inside the
  "no migration" constraint set for this workstream. If the owner would
  rather block on A directly (skip the metadata-linkage step and go
  straight to a real column + full backfill), that's a possible
  alternative — B+ is not a irreversible commitment: the metadata this
  fix's create-time stamping writes is a strict subset of what a future
  `checkout_group_id` column would need, so migrating from B+ to A later is
  additive, not a rewrite.
- **Out of scope when this doc was written, FIXED 2026-07-21 by LIRA-091:** a
  Katsh BILL's auto `SUPPLIER_PAYS_US` supplier_ledger row was not reversed by
  `voidCheckoutGroup` any more than by an ordinary single void — the
  FEATURE_GUIDE §9 standing gap ("voiding a FINANCIAL_SERVICE row leaves its
  auto SUPPLIER_PAYMENT sibling standing"), unrelated to the carrier-legs
  asymmetry and not part of this fix's original acceptance criteria
  (payments/drawers/debt_ledger/profit only). LIRA-091 added
  `supplier_ledger.source_ref_table`/`source_ref_id` (migration v136) and a
  cascade in `TransactionRepository`; since `voidCheckoutGroup` delegates to
  the same `_voidTransactionInternal` every single void uses, it inherited
  the fix with no code change of its own — proved directly for a Katsh BILL
  split-group member in
  `TransactionRepository.supplierSiblingVoidCascade.test.ts` case (d).
