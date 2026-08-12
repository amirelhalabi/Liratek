# Sprint 4 Archive — Owner Notes Batch, 2026-07-20 (LIRA-078..091, 094)

> **Archived 2026-08-12** from `current_sprint.md` (per `docs/plans/todo_plans/SPRINT_INVENTORY_2026-08-12.md`,
> committed `2bfc7f5`). Sprint 4 created 2026-07-20, disposition of a 32-note owner feedback batch.
> 7 of 15 tickets are DONE (after the LIRA-090 stale-marker correction below).
>
> **LIRA-079, 083, 084, 086, 087, 088 are NOT archived here — all six are still genuinely open**
> and live in the live board in `current_sprint.md`, in their original positions between
> LIRA-078/080, 082/084, 083/085, 085/087, 086/088, and 087/089 respectively (see the inline
> pointers below).
>
> **Stale-marker correction (LIRA-090):** the ticket below originally read
> `**Status** | NEEDS INTERVIEW`. It is corrected to `DONE` in place, with evidence, per
> `docs/plans/todo_plans/SPRINT_INVENTORY_2026-08-12.md` §4.1 — this was the single highest-value
> correction in that inventory: a High-priority row had looked blocked on the owner for 11 days
> when the feature shipped 2026-08-01→08-07 and was touched again 2026-08-11 (LIRA-113).

---

# Sprint 4 — Owner Notes Batch (2026-07-20)

> **Sprint Focus:** disposition of a 32-note owner feedback batch delivered 2026-07-20 — each
> note was verified against the code before being ticketed. Full per-note disposition log (fixed
> today / invalid / in progress / ticketed / parked) lives in `LEFT_TO_DO.md`, dated section
> "2026-07-20 — Owner notes batch (32 notes)".
> **Created:** 2026-07-20
> **Status Legend:** `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED` | `NEEDS INTERVIEW`

---

## LIRA-078: Refund Tender-Selection Modal

| Field                | Value                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------- |
| **Epic**             | Transactions                                                                            |
| **Type**             | Feature / UX                                                                            |
| **Priority**         | High                                                                                    |
| **Status**           | DONE (2026-07-21 — method-override modal, 33 unit tests + lira-126 e2e transport guard) |
| **Affected Modules** | Audit > TransactionsViewer                                                              |
| **Assigned To**      | —                                                                                       |
| **Depends On**       | —                                                                                       |

### Summary

Owner note 22b. Today refunding a transaction is a bare `confirm("Refund this transaction? A
reversal entry will be created.")` dialog (`TransactionsViewer.tsx` `handleRefund`) followed by
an instant, automatic reversal of the original payment legs — the operator has no say in HOW the
money goes back (e.g. return cash when the customer originally paid by CUSTOMER_ACCOUNT, or split
the return across methods). Replace this with a modal built on the shared `MultiPaymentInput`
component (the same pattern already used by `CounterpartySettleModal`) so the operator explicitly
chooses the return method(s), pre-filled with the original legs reversed as a sane default.

### Acceptance Criteria

- [ ] Clicking Refund opens a modal (not a `confirm()` dialog) containing `MultiPaymentInput`
- [ ] Modal defaults/pre-fills to the original transaction's legs, reversed (today's behavior, as the default path)
- [ ] Operator can change the return method/split before confirming
- [ ] Whichever methods are chosen, the correct drawer(s) are affected per method
- [ ] Reversal still nets ledgers and profit to exactly zero per currency (rule 20), regardless of which return method the operator picks
- [ ] Failing-first regression test proving the old auto-reversal-only path is superseded (rule 17)
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                            | Change                                                                                                     |
| -------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Frontend | `frontend/src/features/audit/pages/TransactionsViewer.tsx`      | Replace `confirm()` + `handleRefund` auto-reversal with a modal launch                                     |
| Frontend | New refund modal component (pattern: `CounterpartySettleModal`) | `MultiPaymentInput`-based tender selection                                                                 |
| Backend  | `packages/core/src/repositories/TransactionRepository.ts`       | Accept operator-chosen legs for the refund reversal instead of always reversing the original legs verbatim |

---


> *(LIRA-079 — Refund Scope + Void Button Decision — moved to the live board, still open)*

---

## LIRA-080: No-Drawer (Paper) Credit/Debt Entries on Accounts + Supplier Pages

| Field                | Value                                                                |
| -------------------- | -------------------------------------------------------------------- |
| **Epic**             | Counterparty Ledgers                                                 |
| **Type**             | Feature                                                              |
| **Priority**         | High                                                                 |
| **Status**           | DONE (2026-07-21 — landed + verified; core tests 4/4, rule-20 gated) |
| **Affected Modules** | Debts (Accounts), Suppliers                                          |
| **Assigned To**      | —                                                                    |
| **Depends On**       | CQ-6 (`COUNTERPARTY_CONSOLIDATION_PLAN.md`)                          |

### Summary

Owner notes 1 + 32. The Partner page already has a default-off "Cash moved" toggle so a
Record-Transaction entry can be posted as a pure paper/ledger adjustment with no drawer effect.
The Accounts (client debt) page has no such toggle — every Add Credit/Debt always moves the
drawer. The Supplier page is worse: it has no Add Credit/Debt action at all today. Add the same
toggle to Accounts (default ON, preserving today's behavior) and add the missing Add Credit/Debt
button to Suppliers with the same toggle.

### Acceptance Criteria

- [ ] Accounts page "Add Credit/Debt" gains a "Cash moved" toggle, default ON (= current behavior unchanged when left alone)
- [ ] Supplier page gains an "Add Credit/Debt" action (currently absent), with the same toggle
- [ ] A paper (toggle-off) entry posts a visible no-cash-movement row in Transactions
- [ ] Reversal ownership defined for the new paper-entry ledger rows (rule 20)
- [ ] Failing-first tests for both the drawer-affecting and paper paths
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                                    | Change                                  |
| -------- | ----------------------------------------------------------------------- | --------------------------------------- |
| Frontend | `frontend/src/features/debts/pages/Debts/index.tsx` (Accounts)          | "Cash moved" toggle on Add Credit/Debit |
| Frontend | `frontend/src/features/suppliers/pages/Suppliers/index.tsx`             | New Add Credit/Debt action + toggle     |
| Backend  | `packages/core/src/repositories/{DebtRepository,SupplierRepository}.ts` | Paper-entry write path + reversal owner |

---

## LIRA-081: For-Partner Toggle on Exchange and Custom Services

| Field                | Value                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| **Epic**             | Partners                                                                                           |
| **Type**             | Enhancement                                                                                        |
| **Priority**         | Medium                                                                                             |
| **Status**           | DONE (2026-07-21 — Exchange + Custom Services; Maintenance deliberately excluded, see ticket note) |
| **Affected Modules** | Exchange, Custom Services                                                                          |
| **Assigned To**      | —                                                                                                  |
| **Depends On**       | CQ-6 (ForPartnerToggle consolidation)                                                              |

### Summary

Owner note 3. `ForPartnerToggle` is already wired into POS (`CheckoutModal.tsx`), Loto, and every
recharge form (`FinancialForm`, `OmtWhishAppTransferForm`, `KatchForm`, `TelecomForm`,
`CryptoForm`) but is absent from Exchange and Custom Services — those transactions cannot be
attributed to a partner today.

### Acceptance Criteria

- [ ] `ForPartnerToggle` present on Exchange and Custom Services forms, wired the same way as the existing consumers (single shared component, no copy-paste)
- [ ] Toggling posts the matching `partner_ledger` `FOR_*` entry
- [ ] Void cascade extends to these two newly-covered parent transaction types
- [ ] Tests covering the toggle-on write path and its void reversal
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                                             | Change                                        |
| -------- | -------------------------------------------------------------------------------- | --------------------------------------------- |
| Frontend | `frontend/src/features/exchange/pages/Exchange/index.tsx`                        | Add `ForPartnerToggle`                        |
| Frontend | `frontend/src/features/custom-services/pages/CustomServices/index.tsx`           | Add `ForPartnerToggle`                        |
| Backend  | `packages/core/src/repositories/{ExchangeRepository,CustomServiceRepository}.ts` | `FOR_*` partner_ledger posting + void cascade |

---

## LIRA-082: Detailed Summaries on All createTransaction Call Sites

| Field                | Value                                                        |
| -------------------- | ------------------------------------------------------------ |
| **Epic**             | Transaction Visibility                                       |
| **Type**             | Enhancement                                                  |
| **Priority**         | Medium                                                       |
| **Status**           | DONE (2026-07-20 — 5 call sites enriched, no e2e collisions) |
| **Affected Modules** | Maintenance, Debts, Suppliers, Services (Hold Money)         |
| **Assigned To**      | —                                                            |
| **Depends On**       | —                                                            |

### Summary

Owner note 14. Several `createTransaction` call sites write bare, amount-only summaries that
don't reflect what actually happened: the Maintenance summary omits the device/issue, and
DebtRepayment / SupplierPayment / HoldMoney summaries carry only the amount with no context.
Enrich each with the relevant detail, appended to (not replacing) the existing summary prefix.

### Acceptance Criteria

- [ ] Maintenance transaction summary includes device + issue detail
- [ ] DebtRepayment, SupplierPayment, and HoldMoney summaries include identifying detail beyond the bare amount
- [ ] Existing summary prefixes/conventions preserved (no format break for existing rows/filters)
- [ ] Tests updated to assert the enriched summary text
- [ ] Typecheck and lint pass

### Files to Modify

| Layer   | File                                                                                        | Change                         |
| ------- | ------------------------------------------------------------------------------------------- | ------------------------------ |
| Backend | `packages/core/src/repositories/MaintenanceRepository.ts`                                   | Append device/issue to summary |
| Backend | `packages/core/src/repositories/{DebtRepository,SupplierRepository,HoldMoneyRepository}.ts` | Enrich summaries               |

---


> *(LIRA-083 — Service Status Workflow for Custom Services — moved to the live board, still open)*

---

> *(LIRA-084 — Partial Keep-Change — moved to the live board, still open)*

---

## LIRA-085: Undo/Reverse for Partner & Supplier Ledger Transactions

| Field                | Value                                                        |
| -------------------- | ------------------------------------------------------------ |
| **Epic**             | Partners / Suppliers                                         |
| **Type**             | Bug / Enhancement                                            |
| **Priority**         | High                                                         |
| **Status**           | DONE (2026-07-21 — module-owned reversals, 27 netting tests) |
| **Affected Modules** | Partners, Suppliers                                          |
| **Assigned To**      | —                                                            |
| **Depends On**       | —                                                            |

### Summary

Owner notes 25 and the partner/supplier half of note 26. `PARTNER_SETTLEMENT`,
`PARTNER_PAYMENT`, and `SUPPLIER_SETTLEMENT` are deliberately listed in
`NON_REVERSIBLE_TRANSACTION_TYPES` (rule 20) because no reversal owner was ever built for them.
The owner wants a mistake-undo path for these ledgers.

### Acceptance Criteria

- [ ] A module-owned reversal defined for each of the currently-non-reversible partner/supplier types (per rule 20 — generic-path extension or dedicated reversal)
- [ ] Create + reverse nets to exactly zero per currency, across every ledger touched (partner_ledger / supplier_ledger / drawer / debt if applicable)
- [ ] Undo affordance surfaced on the Partner and Supplier pages
- [ ] Failing-first proof (rule 17)
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                                                             | Change                                                                            |
| -------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Backend  | `packages/core/src/constants/transactionTypes.ts`                                                | Move types out of `NON_REVERSIBLE_TRANSACTION_TYPES` once a reversal owner exists |
| Backend  | `packages/core/src/repositories/{PartnerRepository,SupplierRepository,TransactionRepository}.ts` | Reversal owner implementation                                                     |
| Frontend | `frontend/src/features/{partners,suppliers}/pages/*/index.tsx`                                   | Undo affordance                                                                   |

---


> *(LIRA-086 — Dashboard Checkpoint Freshness Coloring — moved to the live board, still open)*

---

> *(LIRA-087 — Product-Supplier: Record Debt Now, Attach Products Later — moved to the live board, still open)*

---

> *(LIRA-088 — MTC/Alfa Provider-Balance Decrement Adjustment — moved to the live board, still open)*

---

## LIRA-089: iPick/Katsh Bills — Commission at Settlement, Not Per-Bill

| Field                | Value                                                                       |
| -------------------- | --------------------------------------------------------------------------- |
| **Epic**             | Suppliers / Recharge                                                        |
| **Type**             | Feature / Decision                                                          |
| **Priority**         | Medium                                                                      |
| **Status**           | DONE (2026-08-08, `1d498ff`) — Phase 1 of `COMMISSION_AT_SETTLEMENT_PLAN.md` shipped |
| **Affected Modules** | Recharge > iPick, Katsh; Suppliers                                          |
| **Assigned To**      | —                                                                           |
| **Depends On**       | —                                                                           |

### Summary

Owner note 13. Today every iPick/Katsh bill auto-books a hardcoded −20,000 LBP
`SUPPLIER_PAYS_US` ledger row at transaction time (`FinancialServiceRepository`, per LIRA-062).
The owner's model instead: count bills only at transaction time (no commission booked yet), and
enter the ACTUAL commission amount later, at supplier settlement. Blocked on owner answers before
implementation.

### Open Questions — ANSWERED (owner interview 2026-08-08)

- [x] Entry shape: **both, per supplier** — lump per settlement batch OR per-bill × count; the
      settlement UI offers both modes.
- [x] Historical bills: **cutover, keep history** — rows booked under the hardcoded-per-bill model
      stay as-is; no backfill/migration of past data.
- [x] (From the joint interview) This is **Phase 1 of the unified COMMISSION_AT_SETTLEMENT
      redesign** with LIRA-095 — the bills slice ships first to validate the settlement-time
      commission machinery.

### Acceptance Criteria

Defined in `docs/plans/todo_plans/COMMISSION_AT_SETTLEMENT_PLAN.md` Phase 1. This ticket closes
when the bills slice ships.

---


## LIRA-090: Telecom Days/Credit Model (MTC/Alfa)

| Field                | Value                          |
| -------------------- | ------------------------------ |
| **Epic**             | Recharge                       |
| **Type**             | Feature / Decision             |
| **Priority**         | High                           |
| **Status**           | **DONE** (corrected 2026-08-12 — see below; was stale "NEEDS INTERVIEW") |
| **Affected Modules** | Recharge > MTC, Alfa; Settings |
| **Assigned To**      | —                              |
| **Depends On**       | —                              |

### Summary

Owner notes 6–12. A substantial new model for shop-number validity days and per-item cost/credit
breakdowns for telecom (MTC/Alfa) — originally scoped in `docs/plans/todo_plans/TELECOM_DAYS_VALIDITY_PLAN.md`
(that path is now stale — the file has moved to `docs/plans/done_plans/TELECOM_DAYS_VALIDITY_PLAN.md`,
superseded by the plan below).

### Acceptance Criteria

- [x] Shipped in full — see Correction below.

### Correction (2026-08-12, per `docs/plans/todo_plans/SPRINT_INVENTORY_2026-08-12.md` §4.1)

This ticket's own detail block still read `NEEDS INTERVIEW` while the feature had been live for
11 days. Evidence:

- `docs/plans/done_plans/LIRA_090_HANDOFF.md:3`: **"STATUS 2026-08-01: COMPLETE — all gates green,
  adversarially reviewed, safe to merge."**
- Two shipping commits titled with the ticket number: `8391056` ("LIRA-090: Telecom Days & Credit
  Validity Model (MTC/Alfa Only-Days) (#67)", 2026-08-02) and `d7c9ba0` ("LIRA-090 follow-up:
  telecom days-cost model, set-primary + self-charge UI (#72)", 2026-08-05).
- Full design landed as `docs/plans/done_plans/CARRIER_LINES_VALIDITY_PLAN.md`
  ("**Status: COMPLETE 2026-08-07.** All waves (1–5) landed and merged to `main` via `dbbb710`.").
- `packages/core/src/repositories/ProfitRepository.ts:369-373` has a live code comment referencing
  **"`TELECOM_SELF_CHARGE` (LIRA-090 M3)"** as a named, shipped phase.
- Touched again by **LIRA-113** (`eb820c7`, 2026-08-11), which explicitly reverses one of this
  plan's decisions (D12) — a decision from a plan that hadn't shipped could not be reversed.

---
## Summary (Sprint 4 — LIRA-078..090)

| Priority  | Total  | Done  | Remaining |
| --------- | ------ | ----- | --------- |
| High      | 4      | 0     | 4         |
| Medium    | 7      | 0     | 7         |
| Low       | 1      | 0     | 1         |
| **Total** | **13** | **0** | **13**    |

> 3 of the 13 (LIRA-080, LIRA-081, LIRA-082) are already IN PROGRESS — implementation landing
> the same day (2026-07-20) as this batch was triaged. 3 are NEEDS INTERVIEW (LIRA-079, LIRA-089,
> LIRA-090) and cannot proceed without owner answers.

## LIRA-091: Void Cascade for Auto Supplier-Ledger Siblings (FS/RECHARGE)

| Field                | Value                                      |
| -------------------- | ------------------------------------------ |
| **Epic**             | Transactions / Suppliers                   |
| **Type**             | Bug                                        |
| **Priority**         | High                                       |
| **Status**           | DONE (2026-07-21)                          |
| **Affected Modules** | Transactions, Financial Services, Recharge |
| **Assigned To**      | —                                          |
| **Depends On**       | —                                          |

### Summary

The FEATURE_GUIDE §9 standing gap (also `LEFT_TO_DO.md` "Known gap — next batch"): voiding a
`FINANCIAL_SERVICE` (e.g. OMT/OMT-App SEND) or `RECHARGE` reverses cash + wallet legs, but the
**auto supplier TOP_UP/SUPPLIER_PAYS_US sibling** (ledger row + hidden `SUPPLIER_PAYMENT` txn)
stays — the supplier balance overstates the debt by the voided amount (conservative direction:
overstated, never understated). No schema link exists from the parent row to the sibling.
Fix: add the reference (migration v136), cascade the soft-void through both the single void
and `voidCheckoutGroup`, and handle the already-settled sibling case. Legacy (pre-link) rows
are out of reach without a heuristic data repair — documented limitation, mirroring LIRA-094.

**Shipped (2026-07-21):** `supplier_ledger.source_ref_table`/`source_ref_id` (migration v136)
back-links an auto sibling to its parent's `source_table`/`source_id`, stamped by both
FinancialServiceRepository `is_auto:true` sites (BILL commission, SEND/RECEIVE TOP_UP/PAYMENT).
`TransactionRepository._cascadeSupplierSiblingVoid` finds unrefunded, `is_auto=1` siblings and
reuses `_voidTransactionInternal` per sibling (soft-void via the pre-existing
`_markSourceRefunded` step — no second reversal path); `voidCheckoutGroup` inherits it for free
since it already delegates to the same internal method (proved for a Katsh BILL split-group
member). `_assertSupplierSiblingsVoidable` blocks the whole void/refund up-front, naming the
settlement, when the parent's own `financial_services.settlement_id` is already stamped —
honest-block, no compensating entry. FACTS-FIRST finding: RechargeRepository has no LIVE
`is_auto:true` separate-hidden-transaction creation site today (`topUpFromSupplier` is
link-mode, tied to the already-non-reversible `RECHARGE_TOPUP` type, and is deliberately left
unstamped — see the code comment); the RECHARGE acceptance case is proved as a synthetic,
source-table-generic fixture instead of a live path. Guarded against ~26 pre-existing hand-rolled
`supplier_ledger` test fixtures that predate v136 (`SupplierRepository._supplierLedgerHasSourceRefColumns`
/ `TransactionRepository._supplierLedgerHasSourceRefColumns` check column existence before
reading/writing the new columns — absent columns means "no siblings possible," a correct
no-op, not a swallowed error).

### Acceptance Criteria

- [x] Parent void/refund also soft-voids the auto supplier sibling (ledger + hidden txn)
- [x] Create + void nets to 0 across supplier_ledger per currency (failing-first proof)
- [x] Already-settled sibling handled explicitly (block — documented decision, owner sign-off item)
- [x] Both creation paths covered (FinancialServiceRepository live; RechargeRepository proved
      generically via a synthetic fixture — no live creation site exists today, see summary)
- [x] Migration v136 in BOTH migrations index and create_db.sql

## LIRA-094: Carrier-Legs Void Asymmetry (Split Checkouts) — retroactive filing

| Field                | Value                                                          |
| -------------------- | -------------------------------------------------------------- |
| **Epic**             | Transactions / Payments                                        |
| **Type**             | Bug                                                            |
| **Priority**         | High                                                           |
| **Status**           | DONE (2026-07-19, shipped as design B+ in W5)                  |
| **Affected Modules** | Transactions, Financial Services, Recharge (Katch/iPick bills) |
| **Assigned To**      | —                                                              |
| **Depends On**       | —                                                              |

### Summary

Retroactive registry filing (2026-07-21): this work was executed 2026-07-19 under the
mislabel "LIRA-070" in `PARTIAL_TASKS_COMPLETION_PLAN.md` — the registry's real LIRA-070 is
the unrelated Profits-page audit. Multi-unit split checkouts book all payment legs on ONE
carrier transaction; voiding a single member (carrier or sibling) broke reversal symmetry
(rule 20). Shipped fix: metadata `split_group` linkage at create time, a void/refund guard on
group members, atomic `voidCheckoutGroup`, and a "Void entire checkout (N units)" action —
full design record in `docs/plans/done_plans/CARRIER_LEGS_VOID_ASYMMETRY.md`. Open follow-ups
live there (design-A real column when a migration window opens; legacy pre-fix rows
undetectable by the guard). Numbers LIRA-092–093 remain free (LIRA-091 filed 2026-07-21, see above).

### Sprint 4 board

| ID       | Title                                                   | Priority | Status                                                 |
| -------- | ------------------------------------------------------- | -------- | ------------------------------------------------------ |
| LIRA-078 | Refund tender-selection modal                           | High     | DONE                                                   |
| LIRA-079 | Refund scope + Void button decision                     | Medium   | NEEDS INTERVIEW                                        |
| LIRA-080 | No-drawer paper credit/debt on Accounts + Supplier      | High     | DONE                                                   |
| LIRA-081 | For-Partner toggle on Exchange + Custom Services        | Medium   | DONE                                                   |
| LIRA-082 | Detailed summaries on all createTransaction call sites  | Medium   | DONE                                                   |
| LIRA-083 | Custom Services status workflow                         | Medium   | TODO                                                   |
| LIRA-084 | Partial keep-change                                     | Medium   | TODO                                                   |
| LIRA-085 | Undo/reverse for partner & supplier ledger transactions | High     | DONE                                                   |
| LIRA-086 | Dashboard checkpoint freshness coloring                 | Low      | TODO                                                   |
| LIRA-087 | Product-supplier — debt now, attach products later      | Medium   | TODO                                                   |
| LIRA-088 | MTC/Alfa provider-balance decrement                     | Medium   | NEEDS INTERVIEW                                        |
| LIRA-089 | iPick/Katsh bills commission at settlement              | Medium   | DONE `1d498ff` (Phase 0+1 shipped) |
| LIRA-090 | Telecom days/credit model                               | High     | NEEDS INTERVIEW                                        |
| LIRA-091 | Void cascade for auto supplier-ledger siblings          | High     | DONE                                                   |
| LIRA-094 | Carrier-legs void asymmetry (retroactive — shipped W5)  | High     | DONE                                                   |

> Full per-note disposition (all 32 owner notes, including the ones that were INVALID/already
> working, FIXED today, or already tracked under an existing ticket) is logged in
> `LEFT_TO_DO.md`, dated section "2026-07-20 — Owner notes batch (32 notes)".

---

---

