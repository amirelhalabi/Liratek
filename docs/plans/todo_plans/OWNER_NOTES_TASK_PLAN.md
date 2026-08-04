# Owner Notes — Triage & Task Plan

**Author:** Claude Fable 5 — 2026-07-20
**Source:** 32 freeform owner notes (Account / Partner-Supplier / Services / MTC-Alfa /
Transactions / Keep-change / Whish App / Alfa / Scenario / Dashboard / Debt / Product-supplier).
**Method:** every note verified against the current codebase by 4 parallel read-only
Explore agents (no edits), then re-validated against the 2026-07-19 parallel session
(`PARTIAL_TASKS_COMPLETION_PLAN.md` — W1/W2/W4/W5/W6 — and the supplier/Loto commission
rework), which shipped concurrently and changed some verdicts. Nothing in this doc has
been committed or applied — it is a triage index only.

**Renumbering note:** two notes were double-numbered in the original list; split as
**22a/22b** and **27a/27b** below.

**Next free identifiers (verified 2026-07-20):** LIRA ticket → **LIRA-078**
(root `current_sprint.md` tail is LIRA-077). Migration version → **v136**
(`packages/core/src/db/migrations/index.ts` tail is v135, from W6). E2E spec → `lira-126+`
(lira-125 was consumed by the parallel session's W1 print-gating spec).

**⚠️ Outstanding collision to resolve before filing new tickets:** `PARTIAL_TASKS_COMPLETION_PLAN.md`
executed carrier-legs void-asymmetry work under the label "LIRA-070," but the tracker's real
LIRA-070 is the unrelated Profits-page audit. Recommend renumbering the void-asymmetry work
to **LIRA-094** (reserved below) when tickets are next filed, and fixing the two docs that
call it LIRA-070 (`PARTIAL_TASKS_COMPLETION_PLAN.md`, `CARRIER_LEGS_VOID_ASYMMETRY.md`).

---

## ⚠️ SUPERSEDED — tickets were filed 2026-07-20 under DIFFERENT numbers

The draft LIRA numbers below were **never filed**. A concurrent session filed the actual
tickets into `current_sprint.md` (**Sprint 4 — Owner Notes Batch (2026-07-20)**, LIRA-078–090)
and executed several items the same day. **The registry numbering is authoritative** — use
this map, not the draft numbers in §D:

| Draft (this doc)                   | Outcome in the registry                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| LIRA-078 (note 30 phantom credit)  | **FIXED 2026-07-20** — `repaymentReduction.ts` cross-currency netting, failing-first tested                            |
| LIRA-079 (counterparty undo 25/26) | Filed as **LIRA-085**                                                                                                  |
| LIRA-080 (refund button + modal)   | 21d **FIXED 2026-07-20** (`reversed_by_id` + `isReversibleRow()` + REFUNDED badge); tender modal filed as **LIRA-078** |
| LIRA-081 (maintenance refund list) | **FIXED 2026-07-20** — jobs-list badge + `MaintenanceRepository.getColumns()` now selects `is_refunded`/`refunded_at`  |
| LIRA-082 (for-partner, note 3)     | Filed as **LIRA-081**, IN PROGRESS same day (maintenance coverage being verified too)                                  |
| LIRA-085 (exchange print)          | PARKED as a LIRA-069/W1 follow-up — not filed                                                                          |
| LIRA-086 (custom service status)   | Filed as **LIRA-083**                                                                                                  |
| LIRA-087 (partial keep-change)     | Filed as **LIRA-084**                                                                                                  |
| LIRA-088 (alfa gift label)         | **FIXED 2026-07-20** — session-aware `CardGridPayView` prop                                                            |
| LIRA-089 (checkpoint coloring)     | Filed as **LIRA-086**                                                                                                  |
| LIRA-090 (supplier debt-first)     | Filed as **LIRA-087**                                                                                                  |
| LIRA-091/092 (telecom, reserved)   | Filed as **LIRA-090** + `TELECOM_DAYS_VALIDITY_PLAN.md` (NEEDS INTERVIEW)                                              |
| LIRA-093 (bills commission)        | Filed as **LIRA-089** (NEEDS INTERVIEW)                                                                                |
| LIRA-094 (carrier-legs renumber)   | Still open — LIRA-091+ remain free in the registry; the renumbering recommendation stands                              |

Two verdict corrections against §A/§B below, established after this doc was written:

- **Note 23 was NOT invalid**: the sale path is USD-correct, but `ServiceDebtDetailModal`
  formatted USD totals in the service's currency ("15 LBP"/"3 LBP") — proven by a
  failing-first component test on 2026-07-20 and fixed the same day (including per-currency
  `debtAmountUsd`/`debtAmountLbp`).
- **Note 2 / LIRA-066**: partner paper Record-Tx now posts a `PARTNER_ADJUSTMENT` row
  (landed 2026-07-20); the CLIENT_ACCOUNT-method partner settlement was confirmed to skip
  its transactions row and is being fixed under LIRA-066.
- §B's W6.a finding (note 4 covered by `CarrierLineService.updateBalance`) was folded into
  filed **LIRA-088**, downgraded to NEEDS INTERVIEW pending which reading the owner meant.

Full per-note disposition: `LEFT_TO_DO.md`, section "2026-07-20 — Owner notes batch (32 notes)".

---

## A — Invalid notes (no action — already works as asked)

| #   | Note                                             | Evidence                                                                                                                                           |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | Buy credits from customer, affecting drawer      | `topUpFromCustomer` — TopUpModal "Credits Received from Customer / Cash Paid to Customer" (`RechargeRepository.ts:476`)                            |
| 16  | LBP not selectable in partner record-txn         | Currency select already offers USD + LBP (`Partners/index.tsx:789`)                                                                                |
| 18  | Whish App RECEIVE fee mandatory                  | Fee is optional/zeroable — shipped, guarded by lira-100/101                                                                                        |
| 20  | Settle-debt remainder not accounted              | Overpayment handled: drawer-out return or store-credit deposit (`DebtRepository.ts:575`). The _real_ remainder bug is note 30 (below, still valid) |
| 23  | $18 cart, $15 paid, $3 debt shown as "3 LBP"     | Stamping + all detail views are USD-correct now; `salePaidFormat.ts` documents this exact fix as already applied                                   |
| 24  | Settlement should use multi-payment form         | Shipped — `CounterpartySettleModal` + `MultiPaymentInput`, per-leg drawer deltas, all 3 pages (CQ-11, 2026-07-18)                                  |
| 26  | Refunded settle-debt txn doesn't reverse balance | Fixed by D3 (2026-07-19): `_restoreRepaymentDebt` on both void and refund (`TransactionRepository.ts:1248`)                                        |
| 27a | No discount option in these pages                | Shipped on all 3 pages (CQ-10, migration v131 widened the `supplier_ledger` CHECK)                                                                 |

**Caveat:** these verdicts are against the current working tree. If the shop machine runs an
older build, the owner may have genuinely seen 23/24/26/27a — confirm deployed version
before telling them "already works."

---

## B — Resolved or partially resolved by the 2026-07-19 parallel session

| #               | Note                                             | Status after W1–W6                                                                                                                                                                                                                                                                                                                         |
| --------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4               | Update MTC/Alfa balance without affecting drawer | **Resolved** by W6.a — `CarrierLineService.updateBalance` is drawer-free by design ("informational only — no drawer legs", `CarrierLineService.ts:4-5`). Covers the shop-SIM-credits reading of the note. If the owner meant the _resale_ drawer balance instead, that gap remains — confirm which they meant (folds into LIRA-091 below). |
| 6               | Shop-number validity days                        | **Half-shipped.** Field + Settings manager + live MTC/Alfa panel exist (v135). NOT wired: auto-decrement on selling days, extension on shop-number self-charge — service is explicitly "no checkout/closing involvement." Remainder → **LIRA-091**.                                                                                        |
| 7/8/9           | Days/credit cost breakdown + sell prices         | **Foundation laid** — `mobile_service_items` now has structured `validity_days` + `credits` columns (v135). Still missing: itemCost/daysCost/creditCost breakdown, per-SMS tiers, sell-days/sell-credit prices. Remainder → **LIRA-092** (needs owner discussion first, per the note's own "TO BE DISCUSSED").                             |
| 21 (print half) | Print not available on all txn types             | **Mostly shipped** by W1 — provider-aware `isReceiptableRow` gating, per-row print, history-modal print, auto-print. **EXCHANGE is still excluded** (`RECEIPTABLE_TYPES` unchanged: FINANCIAL_SERVICE/RECHARGE/MAINTENANCE/CUSTOM_SERVICE/LOTO). That sliver → **LIRA-085**.                                                               |
| 13              | Bills commission fixed at settlement time        | Still valid (untouched), but W5's OMT/WHISH settle-netting pattern (`Σ(amount+fee) − commission`, funded at settlement via a `SUPPLIER_PAYS_US` credit) is now a proven template — ticketed as **LIRA-093**, cheaper to build than originally scoped.                                                                                      |

---

## C — Already tracked elsewhere (no new ticket — extend the existing item)

| #   | Note                                                                                            | Where it lives                                                                                           |
| --- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 2   | Partner/supplier record-txn must appear in Transactions page                                    | **LIRA-066** (root `current_sprint.md`, TODO)                                                            |
| 1   | Add credit/debt always hits the drawer (Debts page specifically; Supplier has no button at all) | Extend **CQ-6** in `COUNTERPARTY_CONSOLIDATION_PLAN.md`                                                  |
| 32  | Add Credit/Debt button missing (Suppliers only)                                                 | Same — **CQ-6**                                                                                          |
| 3   | 'For partner' toggle missing on some service pages                                              | Extend **CQ-6**'s `<ForPartnerToggle>` consolidation (currently covers financial/recharge/POS/Loto only) |

These four should be added as acceptance-criteria line items to their existing tracker
entries, not filed as new LIRA numbers.

---

## D — New tickets to file (LIRA-078 onward)

Ticket blocks below are ready to paste into root `current_sprint.md` in its existing format
(field table + Summary + Acceptance Criteria + Files to Modify). Grouped by priority.

### Tier 1 — Critical (money correctness)

#### LIRA-078: Debt repayment — cross-currency change returns a phantom credit ✅ DONE

| Field                | Value    |
| -------------------- | -------- |
| **Epic**             | Debts    |
| **Type**             | Bug      |
| **Priority**         | Critical |
| **Status**           | TODO     |
| **Affected Modules** | Debts    |
| **Depends On**       | —        |

**Summary:** Owed $30, customer pays $40 cash, shop returns 900,000 LBP change. The ledger
should net to exactly −$30 (debt cleared, nothing more). Instead it books −$40, i.e. a
phantom $10 credit to the customer's account. Root cause: `computeRepaymentReduction`
nets change per-currency with a floor (`Math.max(0, paidLbp − returnedLbp)`), which clamps
the 900,000 LBP change to 0 because there was no LBP paid-in to subtract it from — the
LBP change is silently dropped instead of being converted/reconciled against the USD
overpayment. The $10 USD leftover is then re-added as "customer credit" and written to
`debt_ledger` as if the customer overpaid by $10.

**Acceptance Criteria:**

- [ ] Failing-first jest on `repaymentReduction.ts` (`computeRepaymentReduction`) reproducing
      the exact scenario (owed $30, paid $40 USD, returned 900,000 LBP) — assert ledger delta
      = −$30 across the transaction, not −$40.
- [ ] Fix nets cross-currency change against the correct currency's overpayment before
      falling back to same-currency credit.
- [ ] `DebtRepository.addRepayment` write path re-verified against the corrected reduction.
- [ ] E2E spec `lira-126-debt-overpay-cross-currency-change.spec.ts`: snapshot debt balance
      before/after, assert delta = −$30 exactly (rule 15 discipline).

**Files to Modify:** `frontend/src/features/debts/utils/repaymentReduction.ts`,
`packages/core/src/repositories/DebtRepository.ts`, `frontend/src/features/debts/pages/Debts/index.tsx`.

---

#### LIRA-079: Counterparty ledgers — no refund/undo path (partner + supplier) ✅ DONE

| Field                | Value                                                                  |
| -------------------- | ---------------------------------------------------------------------- |
| **Epic**             | Partners / Suppliers                                                   |
| **Type**             | Bug / Enhancement                                                      |
| **Priority**         | High                                                                   |
| **Status**           | TODO                                                                   |
| **Affected Modules** | Partners, Suppliers, Transactions                                      |
| **Depends On**       | LIRA-066 (note 2 — partner txns must exist in Transactions page first) |

**Summary:** Rule 20 (reversal symmetry) is unmet for partner ledger entries: `PARTNER_PAYMENT`,
`PARTNER_SETTLEMENT`, and `COUNTERPARTY_DISCOUNT` sit in `NON_REVERSIBLE_TRANSACTION_TYPES`
with no owned reversal, and neither the Partner nor Supplier page exposes a
void/refund/undo affordance on its own ledger rows (Supplier only renders a passive
"VOIDED" badge). Owner: "shop owner did a mistake in the txn detail, should be able to undo."

**Acceptance Criteria:**

- [ ] Define a named reversal owner for each currently-non-reversible partner/supplier
      type (generic path extension or module-owned reversal, per rule 20).
- [ ] Undo/refund action surfaced on partner ledger rows and supplier ledger rows (not
      only via the separate Transactions page).
- [ ] Failing-first test: create + reverse nets to 0 across every ledger touched, per
      currency (rule 17/20).

**Files to Modify:** `packages/core/src/constants/transactionTypes.ts`,
`packages/core/src/repositories/{PartnerRepository,SupplierRepository,TransactionRepository}.ts`,
`frontend/src/features/{partners,suppliers}/pages/*/index.tsx`.

---

### Tier 2 — High (UX / data integrity on the Transactions page)

#### LIRA-080: Transaction refund — button doesn't disappear after refund; refund UX should use a payment-method modal ✅ DONE

| Field                | Value             |
| -------------------- | ----------------- |
| **Epic**             | Transactions      |
| **Type**             | Bug / Enhancement |
| **Priority**         | High              |
| **Status**           | TODO              |
| **Affected Modules** | Transactions      |
| **Depends On**       | —                 |

**Summary:** Two related gaps in `TransactionsViewer`:
(a) After refunding transaction X, its Refund button does **not** disappear — the original
row stays ACTIVE (only a separate REFUND reverser is created; `reverses_id` is never set on
the original), so both Void and Refund remain clickable. The backend blocks a repeat
refund/void, so this is a misleading-UI bug, not a double-spend risk — but it must be fixed.
(b) Clicking Refund does a bare `confirm()` + auto-reverse — it should instead open a modal
with the multi-payment form so the operator can choose _how_ to return the money (matching
the `CounterpartySettleModal` pattern already used for settlements). Must account for W5's
`voidCheckoutGroup` — split-checkout units refund/void as a group, so the modal needs to
operate at group level when `split_group` is present.
Also folds in: the Void button is likely redundant once Refund covers the same need —
confirm with owner whether to remove it.

**Acceptance Criteria:**

- [ ] Refund button hidden once a transaction has an active reverser (gate on
      `reverses_id`/refunded status of the _original_ row, not just `ACTIONABLE_TYPES`).
- [ ] Refund opens a `MultiPaymentInput`-based modal; the chosen legs drive the reversal.
- [ ] Split-group awareness: refunding a `split_group` member routes to the group flow.
- [ ] Owner decision recorded: keep or remove the Void button.
- [ ] Failing-first e2e: refund a txn → assert Refund button gone.

**Files to Modify:** `frontend/src/features/audit/pages/TransactionsViewer.tsx`,
`packages/core/src/repositories/TransactionRepository.ts`.

---

#### LIRA-081: Refunded maintenance job doesn't show refunded status in the jobs list ✅ DONE

| Field                | Value                      |
| -------------------- | -------------------------- |
| **Epic**             | Maintenance / Transactions |
| **Type**             | Bug                        |
| **Priority**         | Medium                     |
| **Status**           | TODO                       |
| **Affected Modules** | Maintenance                |
| **Depends On**       | —                          |

**Summary:** Refunding a maintenance transaction sets `maintenance.is_refunded`/`refunded_at`
only; `status` is untouched, and the main jobs-list query doesn't even select the refund
columns. A refunded job stays under its old status tab with no visual marker (the separate
History modal does show a "Refunded" badge, but the jobs list itself does not).

**Acceptance Criteria:**

- [ ] `MaintenanceRepository.getJobs`/`getColumns` include `is_refunded`/`refunded_at`.
- [ ] Jobs list renders a refunded badge/status alongside the existing lifecycle badges.
- [ ] Failing-first e2e: refund a maintenance txn → assert the jobs list shows it refunded.

**Files to Modify:** `packages/core/src/repositories/MaintenanceRepository.ts`,
`frontend/src/features/maintenance/pages/Maintenance/index.tsx`.

---

#### LIRA-082: 'For partner' toggle missing on custom services, maintenance, exchange ✅ DONE (Exchange + Custom Services; Maintenance intentionally deferred)

| Field                | Value                                  |
| -------------------- | -------------------------------------- |
| **Epic**             | Partners                               |
| **Type**             | Enhancement                            |
| **Priority**         | Medium                                 |
| **Status**           | TODO                                   |
| **Affected Modules** | Custom Services, Maintenance, Exchange |
| **Depends On**       | CQ-6 (ForPartnerToggle consolidation)  |

**Summary:** `ForPartnerToggle` is wired into financial/recharge forms, POS, and Loto, but
absent from custom services, maintenance, and exchange forms — those transactions can't be
attributed to a partner.

**Acceptance Criteria:**

- [ ] `ForPartnerToggle` added to custom-service, maintenance, and exchange transaction forms,
      wired the same way as existing consumers (single shared component, no copy-paste).

**Files to Modify:** `frontend/src/features/{custom-services,maintenance,exchange}/**`.

---

#### LIRA-085: Exchange transactions excluded from receipt printing ❌ NOT DONE

| Field                | Value                                          |
| -------------------- | ---------------------------------------------- |
| **Epic**             | Transactions                                   |
| **Type**             | Enhancement                                    |
| **Priority**         | Medium                                         |
| **Status**           | TODO                                           |
| **Affected Modules** | Exchange, Transactions                         |
| **Depends On**       | LIRA-069/W1 (print gating foundation, shipped) |

**Summary:** Note 21 asked for print on "the exchange transaction and all customer related
pages." W1 shipped provider-aware print gating for FINANCIAL_SERVICE/RECHARGE/MAINTENANCE/
CUSTOM_SERVICE/LOTO, but EXCHANGE was not added to `RECEIPTABLE_TYPES`.

**Acceptance Criteria:**

- [ ] EXCHANGE added to the receiptable-types predicate (`receiptGating`/`auditConstants.ts`),
      with a receipt format appropriate to a currency exchange.

**Files to Modify:** `frontend/src/features/audit/{auditConstants.ts,receiptGating.ts}`.

---

### Tier 3 — Medium (feature gaps, no money-correctness risk)

#### LIRA-086: Custom service status lifecycle (started / in progress / done) ❌ NOT DONE

| Field                | Value           |
| -------------------- | --------------- |
| **Epic**             | Custom Services |
| **Type**             | Feature         |
| **Priority**         | Medium          |
| **Status**           | TODO            |
| **Affected Modules** | Custom Services |
| **Depends On**       | —               |

**Summary:** Answers note 15 ("where is it?"): nowhere. `custom_services.status` only has
accounting states (`pending/completed/voided`); the started → in-progress → done work
lifecycle the owner recalls discussing (e.g. for a "sejel 3adli" paperwork-style service)
exists today only in the unrelated Maintenance module (`Received → In_Progress → Ready →
Delivered`). Needs a genuine status column + UI, modeled on Maintenance's pattern.

**Acceptance Criteria:**

- [ ] New work-status field on custom services (separate from the existing accounting
      `status`), with a status UI (tabs/badges) mirroring Maintenance's pattern.
- [ ] Migration adds the column with a safe default (no `CURRENT_TIMESTAMP` default on
      an ALTER, per the v104 lesson).

**Files to Modify:** `packages/core/src/db/migrations/index.ts` (new version),
`electron-app/create_db.sql`, `packages/core/src/repositories/CustomServiceRepository.ts`,
`frontend/src/features/custom-services/**`.

---

#### LIRA-087: Partial keep-change (keep part of the change, return the rest) ❌ NOT DONE

| Field                | Value                                            |
| -------------------- | ------------------------------------------------ |
| **Epic**             | Payments                                         |
| **Type**             | Enhancement                                      |
| **Priority**         | Medium                                           |
| **Status**           | TODO                                             |
| **Affected Modules** | MultiPaymentInput (shared)                       |
| **Depends On**       | T3 Keep Change (shipped — this is the follow-up) |

**Summary:** Keep-change is currently a single binary toggle — when on, it keeps the
**entire** computed change. Owner wants to return part and keep part (e.g. return 100,000 LBP
of a 140,000 LBP change, keep 40,000).

**Acceptance Criteria:**

- [ ] `MultiPaymentInput` keep-change UI accepts a partial amount, not just all-or-nothing.
- [ ] Both currencies supported independently.
- [ ] Component test covering partial-keep math.

**Files to Modify:** `packages/ui/src/components/ui/MultiPaymentInput.tsx`.

---

#### LIRA-088: Alfa Gift button says "Pay" instead of "Add to Cart" during an active session ✅ DONE

| Field                | Value           |
| -------------------- | --------------- |
| **Epic**             | Recharge        |
| **Type**             | Bug             |
| **Priority**         | Low             |
| **Status**           | TODO            |
| **Affected Modules** | Recharge (Alfa) |
| **Depends On**       | —               |

**Summary:** `CardGridPayView` (used by Alfa Gift) hardcodes the button label "Pay" and never
reads `activeSession`. It does correctly add to the session basket when a session is open —
only the label is wrong. Every other recharge form (Telecom, Whish/OMT, Katch) already
switches its label under a session.

**Acceptance Criteria:**

- [ ] `CardGridPayView` reads session state and shows "Add to Cart" when a session is active,
      matching the other forms' convention.

**Files to Modify:** `frontend/src/features/recharge/components/CardGridPayView.tsx`.

---

#### LIRA-089: Dashboard checkpoint time — color-code by staleness ❌ NOT DONE

| Field                | Value       |
| -------------------- | ----------- |
| **Epic**             | Dashboard   |
| **Type**             | Enhancement |
| **Priority**         | Low         |
| **Status**           | TODO        |
| **Affected Modules** | Dashboard   |
| **Depends On**       | —           |

**Summary:** Owner wants the dashboard's last-checkpoint time colored by how stale/consistent
it is versus the prior checkpoint value (green = matches, orange = small drift, red = large
drift). Note: LIRA-065 already colors CHECKPOINT rows in the Transactions viewer — that's a
different surface; the Dashboard itself has no such coloring today.

**Acceptance Criteria:**

- [ ] Dashboard checkpoint-time display colored per a defined drift threshold
      (thresholds TBD with owner).

**Files to Modify:** `frontend/src/features/dashboard/pages/Dashboard.tsx`.

---

#### LIRA-090: Supplier — record debt first, attach inventory products later ❌ NOT DONE

| Field                | Value                 |
| -------------------- | --------------------- |
| **Epic**             | Suppliers / Inventory |
| **Type**             | Feature               |
| **Priority**         | Medium                |
| **Status**           | TODO                  |
| **Affected Modules** | Suppliers, Inventory  |
| **Depends On**       | —                     |

**Summary:** No mechanism today links a supplier debt to specific inventory items —
`supplier_purchases`/`supplier_ledger` carry lump sums with no `product_id`, and adding
inventory stock never books a supplier debt at all (`product.supplier` is just a text
label). Owner wants: record the debt once, then later attach the specific products it
covers — to avoid double-recording debt when re-adding the same items to inventory.

**Acceptance Criteria:**

- [ ] Design: a linking table/flow between a supplier debt entry and one or more
      inventory line items (many-to-one or many-to-many — TBD).
- [ ] Re-adding items already tied to a recorded debt does not create a duplicate debt.

**Files to Modify:** new migration, `packages/core/src/repositories/{SupplierPurchaseRepository,ProductRepository}.ts`,
`frontend/src/features/inventory/**`.

---

### Tier 4 — Needs owner discussion before ticketing (per the notes' own "TO BE DISCUSSED")

| #             | Topic                                                                               | Discussion needed                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 6 (remainder) | Shop-number validity auto-decrement on day sales / self-charge                      | Fold into **LIRA-091**: what exactly decrements validity — every day-sale, or only specific items?                          |
| 7/8/9         | itemCost/daysCost/creditCost breakdown, per-SMS tiers, sell-days/sell-credit prices | **LIRA-092**: owner's own note says "TO BE DISCUSSED" — needs the max-returned-credits formula agreed before implementation |
| 10            | How to apply credit-sell to each item (map of 3 cases?)                             | Fold into LIRA-092 discussion                                                                                               |
| 11            | Drawer effects of charging only-days                                                | Fold into LIRA-092 discussion                                                                                               |
| 12            | Charge a telecom item to the shop's own number                                      | Fold into **LIRA-091**                                                                                                      |
| 13            | Bills commission entered at settlement, not fixed per-bill                          | **LIRA-093** — ticketed above (Tier B), but confirm the commission-entry UX with owner before building                      |

**LIRA-091** (shop-number self-charge + validity decrement) and **LIRA-092** (item cost/sell
breakdown) are reserved numbers — do not file their full ticket bodies until the owner
answers the open questions in notes 6/7/9/10/11/12. **LIRA-093** (bills commission at
settlement) is ready to build using the W5 OMT/Whish settle-netting pattern as a template.
**LIRA-094** is reserved for the carrier-legs void-asymmetry renumbering (see the collision
note at top).

---

## Summary counts

- **Invalid (no action):** 8 — §A
- **Resolved/partial by parallel session:** 5 — §B
- **Already tracked, extend existing item:** 4 — §C
- **New tickets, ready to file:** 12 (LIRA-078 through 090, minus reserved 091/092) — §D
- **Needs owner discussion before ticketing:** 6 topics feeding into LIRA-091/092/093 — §D Tier 4

32 notes in, all accounted for.

## Left TODO

<!--
//TODO — Validation pass 2026-08-04. Verdict: PARTIAL — most Tier 1/2 money-correctness and UX items shipped and independently verified in code; several Tier 3 feature-gap tickets and two NEEDS-INTERVIEW items are still unstarted; the telecom cluster (notes 6-12) shipped far beyond what this doc and its own registry describe.
//TODO   VERIFIED DONE (do not redo):
//TODO   - Note 30 / draft LIRA-078 (phantom credit): cross-currency netting in frontend/src/features/debts/utils/repaymentReduction.ts:49-58 (netUsd/netLbp cross-settle before clamping at 0); failing-first test reproduces the EXACT owner scenario ($30 due, $40 paid, 900,000 LBP change) at frontend/src/features/debts/utils/__tests__/repaymentReduction.test.ts:97-108.
//TODO   - Note 21d + actual LIRA-078 (refund tender modal): frontend/src/features/audit/pages/TransactionsViewer.tsx:1111-1129 (REFUNDED badge on `row.reversed_by_id`), :832-884 (`refundModalRow`/`handleConfirmRefundOverride`), :1447-1459 (`RefundMethodModal` wired with `MultiPaymentInput`, confirmed at frontend/src/features/audit/components/RefundMethodModal.tsx:53). Gating lives in frontend/src/features/audit/actionGating.ts:47-55 `isReversibleRow` (checks `reversed_by_id == null`), so Void+Refund both disappear once refunded.
//TODO   - Note 26: packages/core/src/repositories/TransactionRepository.ts:1085 (void path) and :1265 (refund path) both call `_restoreRepaymentDebt` (defined :1724).
//TODO   - Note 5: packages/core/src/repositories/RechargeRepository.ts:497 `topUpFromCustomer`.
//TODO   - Note 16: currency selector (USD/LBP) confirmed in frontend/src/features/partners/pages/Partners/index.tsx (`setCurrency` + "Currency" label, ~line 708-810) — see CORRECTED DETAILS below, the doc's cited line 789 is stale.
//TODO   - Note 18: fee-optional confirmed by frontend/tests/e2e-electron/lira-101-app-wallet-receive-fee-ui.spec.ts:231 (explicit `fee: "0"` override case) — see CORRECTED DETAILS, "lira-100" in the doc's citation is unrelated.
//TODO   - Note 20: overpayment return-leg loop (drawer-out debit OR `CUSTOMER_ACCOUNT` credit) in packages/core/src/repositories/DebtRepository.ts ~590-610 ("Return (OUT) legs" comment) — logic confirmed, cited line 575 has drifted.
//TODO   - Note 23: frontend/src/features/debts/components/ServiceDebtDetailModal.tsx + frontend/src/features/debts/utils/salePaidFormat.ts + `debtAmountUsd`/`debtAmountLbp` fields confirmed present.
//TODO   - Note 24: `CounterpartySettleModal` confirmed wired into frontend/src/features/{suppliers,partners,debts}/pages/*/index.tsx.
//TODO   - Note 27a: packages/core/src/db/migrations/index.ts v131 (~line 6440-6446) adds `DISCOUNT` to the `supplier_ledger.entry_type` CHECK.
//TODO   - Note 4 (shop-SIM reading): packages/core/src/services/CarrierLineService.ts:4-5 "Informational only — no drawer legs, no checkout/closing involvement." confirmed verbatim. (Resale-drawer-decrement reading of note 4 is NOT done — see REMAINING.)
//TODO   - Note 2 / LIRA-066: `PARTNER_ADJUSTMENT` confirmed live (8 files reference it, incl. packages/core/src/repositories/PartnerRepository.ts). The doc says the CLIENT_ACCOUNT-settlement gap "is being fixed" — it is now FULLY fixed: PartnerRepository.ts:460-572 shows the unified transaction row is always written, even for CLIENT_ACCOUNT (no-drawer) settlements. Reality exceeds the doc's own wording.
//TODO   - Notes 1/32 (actual LIRA-080): Suppliers "Add Credit/Debt" + "Cash moved" toggle confirmed at frontend/src/features/suppliers/pages/Suppliers/index.tsx:890-908,1478-1603; Debts page toggle at frontend/src/features/debts/pages/Debts/index.tsx:148,2450-2463.
//TODO   - Note 3 (actual LIRA-081): `ForPartnerToggle` confirmed wired into frontend/src/features/exchange/pages/Exchange/index.tsx:43-45,1106 and frontend/src/features/custom-services/pages/CustomServices/index.tsx. Maintenance was deliberately EXCLUDED by a documented decision ("payment is a later lifecycle step, needs own design" — LEFT_TO_DO.md:156), not left undone by oversight.
//TODO   - Draft LIRA-081 (maintenance refund badge): packages/core/src/repositories/MaintenanceRepository.ts:184 `getColumns()` includes `is_refunded`/`refunded_at`; frontend/src/features/maintenance/pages/Maintenance/index.tsx:545-570 renders a "Refunded" badge in the jobs list.
//TODO   - Draft LIRA-088 (Alfa Gift label): frontend/src/features/recharge/components/CardGridPayView.tsx:227 `{hasActiveSession ? "Add to Cart" : "Pay"}`.
//TODO   - LIRA-094 collision (carrier-legs void-asymmetry renumbering): RESOLVED as recommended — packages/core/src/repositories/TransactionRepository.ts:1644 refers to the work as "LIRA-094"; docs/plans/done_plans/CARRIER_LEGS_VOID_ASYMMETRY.md is archived to done_plans (shipped).
//TODO   - Note 21 (print)/draft LIRA-085: confirmed STILL correctly described as excluded — frontend/src/features/audit/auditConstants.ts:365-371 `RECEIPTABLE_TYPES` = {FINANCIAL_SERVICE, RECHARGE, MAINTENANCE, CUSTOM_SERVICE, LOTO}, no EXCHANGE. Matches the doc's "PARKED, not filed" status.
//TODO   - Note 13/draft LIRA-093 (bills commission): confirmed STILL correctly described as unfixed — packages/core/src/repositories/FinancialServiceRepository.ts:2884-2892 still hardcodes `-20000` LBP `SUPPLIER_PAYS_US` per bill at transaction time. Matches "NEEDS INTERVIEW", unchanged.
//TODO
//TODO   REMAINING (verified NOT implemented in code):
//TODO   - Draft LIRA-086 / actual LIRA-083 (custom service status lifecycle): packages/core/src/repositories/CustomServiceRepository.ts only has `'completed'`/`'voided'` states (:678,:771) — no work-status column. Owner note 15's Received→In-Progress→Ready→Delivered-style lifecycle does not exist for Custom Services.
//TODO   - Draft LIRA-087 / actual LIRA-084 (partial keep-change): packages/ui/src/components/ui/MultiPaymentInput.tsx:933 `keepChange` is still a plain boolean; :1055 `returnLegsValue = keepChange ? [] : suggestedReturnLegs` is still all-or-nothing. No partial-amount UI/math exists.
//TODO   - Draft LIRA-089 / actual LIRA-086 (dashboard checkpoint coloring): frontend/src/features/dashboard/pages/Dashboard.tsx:176-191 only has `stalenessDotColor`/`stalenessTextColor` — a TIME-ELAPSED freshness color (green <8h / yellow <24h / red else), pre-existing since v1.22.0 (commit cee7337, predates this note). This is a DIFFERENT feature from what note 29 asks (VALUE-drift vs the expected checkpoint amount: green=matches, orange=small drift, red=large drift). No value-drift comparison/coloring exists anywhere in Dashboard.tsx. A future implementer must not mistake the existing time-based color dots for this ticket being done.
//TODO   - Draft LIRA-090 / actual LIRA-087 (supplier debt-first, attach products later): no `product_id`/linking mechanism found in packages/core/src/repositories/SupplierRepository.ts or ProductRepository.ts. Not started.
//TODO   - Note 4 remainder / actual LIRA-088 (MTC/Alfa signed provider-balance decrement): packages/core/src/repositories/RechargeRepository.ts still forces `Math.abs(data.amount)` at every call site (lines 255,270-285,320,430,1096,1201,1315) — no signed/decrement path exists. Still NEEDS INTERVIEW (which balance the owner meant), unchanged since the doc was written.
//TODO   - Actual LIRA-079 (refund scope + Void-button removal decision, folded inside draft LIRA-080's "Also folds in" line): still NEEDS INTERVIEW — both Void and Refund buttons remain side-by-side in TransactionsViewer.tsx:1173-1184; no owner decision has been recorded to remove Void.
//TODO
//TODO   CORRECTED DETAILS (stale symbol/line citations found in this doc):
//TODO   - Note 16 cites `Partners/index.tsx:789` — that line is now the closing `</select>` of an unrelated transaction-type dropdown (file drift from intervening commits). The actual currency selector lives around lines 708-810 (`setCurrency`, "Currency" label).
//TODO   - Note 20 cites `DebtRepository.ts:575` — the actual overpayment return-leg loop is now ~15-30 lines later, around line 590 ("Return (OUT) legs" comment). Logic itself is correct, only the line number drifted.
//TODO   - Note 18 cites "guarded by lira-100/101" — `lira-100` is frontend/tests/e2e-electron/lira-100-checkpoint-timeline-timezone.spec.ts, an UNRELATED checkpoint-timezone spec. Only `lira-101-app-wallet-receive-fee-ui.spec.ts` actually covers this note.
//TODO   - The doc's "Next free identifiers" section (migration v136, LIRA ticket → LIRA-078) is now fully stale: `packages/core/src/db/migrations/index.ts` tail is v142 (not v135/v136), and LIRA tickets have been filed and shipped well past LIRA-090 (see current_sprint.md Sprint 4, and packages/core/src/constants/transactionTypes.ts's references to LIRA-090's `TELECOM_SELF_CHARGE`).
//TODO   - "27b" is referenced once in the renumbering note (line 13) as a split-out note but never appears in any subsequent table in this doc — a dangling forward-reference in the doc's own bookkeeping, not a code issue.
//TODO
//TODO   MAJOR SUPERSESSION — telecom cluster (notes 6-12, draft LIRA-091/092, actual LIRA-090):
//TODO   This doc (2026-07-20) and current_sprint.md's per-ticket status both describe LIRA-090 as "NEEDS INTERVIEW" / blocked on the owner. In reality it shipped substantially via commit 8391056 "LIRA-090: Telecom Days & Credit Validity Model (MTC/Alfa Only-Days) (#67)" merged 2026-08-02 (13 days after this doc): migrations v135-v141 (carrier_lines table, mobile_service_items.validity_days/credits/days_cost_lbp/sell_days_lbp/sell_credit_lbp, carrier_line_movements), a new TELECOM_SELF_CHARGE transaction type (packages/core/src/constants/transactionTypes.ts:355-360, explicitly reversible), MobileServiceItemRepository split-column logic, a telecomCredit calc module (maxReturnableCredits/deriveItemEconomics), Settings split editor, and full IPC+REST dual-transport wiring. A FOLLOW-ON to this work is actively in progress right now (uncommitted frontend/src/data/mobileServices.ts changes + untracked docs/plans/todo_plans/TELECOM_DAYS_COST_PLAN.md), separate from this validation pass. Do not re-scope or re-file LIRA-090/091/092 without first reading docs/plans/todo_plans/TELECOM_DAYS_VALIDITY_PLAN.md and TELECOM_DAYS_COST_PLAN.md and checking current_sprint.md for the real current status.
//TODO
//TODO   GATE when picked up: per this repo's CLAUDE.md — `yarn typecheck` and `yarn lint`; for any packages/core change, `cd packages/core && npm run build` then `xcopy /e /y /q "packages\core\dist" "node_modules\@liratek\core\dist\"`; failing-first tests per rule 17 before any fix; migrations need both `packages/core/src/db/migrations/index.ts` AND `electron-app/create_db.sql` updated; new charge/debt types must satisfy the `moduleDebtTypes.guard.test.ts` naming convention; run `yarn check:tenant-scoping` after any repository SQL edit.
-->

**Summary — 6 item(s) left:** Six Tier-3/discussion tickets have NOT been started: custom service status lifecycle (LIRA-083), partial keep-change (LIRA-084), dashboard checkpoint value-drift coloring (LIRA-086 — note: an unrelated time-elapsed staleness color already exists and could be mistaken for this), supplier debt-first/attach-products-later (LIRA-087), MTC/Alfa signed balance decrement (LIRA-088), and bills-commission-at-settlement (LIRA-089, note 13) — the last two are still blocked on an owner interview that hasn't happened. Everything else this doc tracked in §A (already-working notes), most of §B, all of §C, and 9 of the 11 fully-specified §D tickets (LIRA-078 through LIRA-081, LIRA-082, LIRA-085 [correctly still parked], LIRA-088) is independently verified DONE in the current codebase — several (note 2's CLIENT_ACCOUNT gap, and the entire telecom cluster in notes 6-12/LIRA-090) have shipped even further than this doc or the sprint registry currently claim. The telecom supersession is the single highest-value finding: do not re-plan or re-file that work without reading the two TELECOM_DAYS_*.md plan docs and current_sprint.md first.
