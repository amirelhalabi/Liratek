# Sprint 5 Archive — Owner Notes Batch, 2026-08-07/08 (LIRA-095..097)

> **Archived 2026-08-12** from `current_sprint.md` (per `docs/plans/todo_plans/SPRINT_INVENTORY_2026-08-12.md`,
> committed `2bfc7f5`). Sprint 5 created 2026-08-07, triage of an 11-note owner QA batch tested
> against v1.30.0. 2 of 3 tickets are DONE (LIRA-097 is CLOSED-already-working, accepted as-is).
>
> **LIRA-096 is NOT archived here — it is still genuinely open** (Partners page still renders
> both "Record Transaction" and Add Credit/Debt) and lives in the live board in
> `current_sprint.md`. It originally sat between LIRA-095 and LIRA-097 below.

---

# Sprint 5 — Owner Notes Batch (2026-08-07/08)

> **Sprint Focus:** Triage of a fresh owner QA note batch (11 notes, tested against v1.30.0).
> **Created:** 2026-08-08
> **Status Legend:** `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED` | `NEEDS INTERVIEW`

**Source:** 11 freeform owner notes from a live QA session, 2026-08-07 (1:34–2:46 AM). 8 of the
11 were bug reports — all 8 re-validated against the codebase, confirmed, fixed, and independently
verified same-day (commits `dd6cbb6` "fix: resolve 6 QA-reported bugs across money repositories
and UI" and `a65ce03` "fix: stamp the operator's tendered exchange rate on transactions" — the
latter from a separate live follow-up report, not this note batch, but shipped in the same
session). The 3 tickets below are the notes that were **feature/design requests, not bugs** —
correctly not attacked as part of the bug-fix pass; filed here so they aren't lost.

## LIRA-095: OMT/Whish/Katsh — Rethink Commission Flow (Don't Deduct From Transaction Amount)

| Field                | Value                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------- |
| **Epic**             | Financial Services / Suppliers                                                               |
| **Type**             | Feature / Decision                                                                           |
| **Priority**         | High (money-flow architecture)                                                               |
| **Status**           | INTERVIEW DONE (2026-08-08) → plan: `docs/plans/todo_plans/COMMISSION_AT_SETTLEMENT_PLAN.md` |
| **Affected Modules** | Financial Services (OMT, Whish, Katsh, iPick), Suppliers, Profits                            |
| **Assigned To**      | —                                                                                            |
| **Depends On**       | —                                                                                            |

### Summary

Owner note (2026-08-07, 2:04 AM): _"Commission should not be deduced from the amount (we have
this function amount + fee - commission). We should rethink about commission flow. Commission
should not be deduced directly in ledgers. It should be entered in payment between shop and
supplier. In the new way we should still be able to track the commissions per transaction type
for the profits page."_

This asks to move WHERE commission is recognized: today it's computed and deducted inline as
part of each transaction's own amount/ledger math; the owner wants it moved to be a value entered
at supplier-payment/settlement time instead — while the Profits page still needs to attribute it
back to the originating transaction type. This is an architectural change touching every
OMT/Whish/Katsh/iPick money flow, not a bug fix. Needs an owner interview before any code is
touched (see LIRA-089 above for the closely related, already-filed "iPick/Katsh bills commission
at settlement" ticket — this note may be the general case LIRA-089 is one instance of; resolve
LIRA-089's open questions and this one together).

### Open Questions — ANSWERED (owner interview 2026-08-08)

- [x] Per-type split: **allocate the settlement lump proportionally** across the settled
      transactions by type.
- [x] Historical commission: **cutover date, keep history** — no restatement, new model applies
      forward only.
- [x] Entry shape at settlement: **both modes, per supplier** — a lump sum for the batch OR a
      per-unit rate × count; the settlement UI offers both.
- [x] Relationship to LIRA-089: **one unified redesign** (owner reviewed the code-grounded
      comparison: both tickets change the same recognition point and share all machinery —
      settlement-time entry, allocation, cutover). LIRA-089's bills flow is Phase 1 (the simplest
      vertical slice, validates the machinery before the OMT/Whish payable math changes).
- [ ] Provider set for the Profits "Commission" row (folded in from LIRA-108's residuals): the row
      still counts iPick/Katsh `commission > 0` rows the per-currency sibling routes to Mobile
      Services, and sums raw `fs.commission` vs the sibling's stamped `t.profit_usd/lbp` (USDT
      buckets as USD). Resolve inside the plan's Profits phase.

### Acceptance Criteria

Defined in `docs/plans/todo_plans/COMMISSION_AT_SETTLEMENT_PLAN.md` (the unified plan for
LIRA-095 + LIRA-089). This ticket closes when that plan's OMT/Whish phases ship.

### Files to Modify

| Layer    | File                                                           | Change                                    |
| -------- | -------------------------------------------------------------- | ----------------------------------------- |
| Backend  | `packages/core/src/repositories/FinancialServiceRepository.ts` | Commission recognition point (TBD)        |
| Backend  | `packages/core/src/repositories/ProfitRepository.ts`           | Per-transaction-type attribution (TBD)    |
| Frontend | `frontend/src/features/suppliers/pages/Suppliers/index.tsx`    | Settlement-time commission entry UI (TBD) |

---


> *(LIRA-096 — Partners Page: Remove "Record Transaction" — moved to the live board, still open)*

---

## LIRA-097: Partners Page — Enable LBP Option for Add Credit/Debt

| Field                | Value                                                   |
| -------------------- | ------------------------------------------------------- |
| **Epic**             | Partner System                                          |
| **Type**             | Enhancement                                             |
| **Priority**         | Low                                                     |
| **Status**           | CLOSED — ALREADY WORKING (2026-08-08; guard test added) |
| **Affected Modules** | Partners                                                |
| **Assigned To**      | —                                                       |
| **Depends On**       | —                                                       |

### Summary

Owner note (2026-08-07, 2:21 AM): _"Enable lbp option to add credit debt in partner page."_ The
Add Credit/Debt action on the Partners page needs an LBP currency option — confirm the exact
current currency options on that action before building (the note implies LBP isn't currently
selectable there, unlike the equivalent actions on Debts/Suppliers).

### Acceptance Criteria

- [x] Confirm current currency options on the Partners page's Add Credit/Debt action.
- [x] ~~Add LBP~~ **Premise false — LBP was already selectable and fully wired.** The Add Credit/Debt
      modal's Currency `Select` has offered USD + LBP since 2026-06-22 (commit `b3f96649`, predating
      the owner's note by over a month), and the full chain already propagates it on BOTH transports:
      UI (`Partners/index.tsx:808-814`) → shared Zod validator (`validators/partner.ts`, free string)
      → IPC handler AND `POST /api/partners/transactions` → `PartnerService.recordPartnerTransaction`
      → `PartnerRepository.addLedgerEntry` → `partner_ledger.currency` (no CHECK constraint).
- [x] Partner ledger correctly books the amount in the selected currency (verified through the chain
      above, parameterized insert).
- [x] Typecheck and lint pass.

### Outcome — no code change; regression guard added

Like the earlier "OMT receive fee override" note from the same batch, this owner note described
something that already works. Possible the owner hit a stale build, or expected the dual-field
USD+LBP-simultaneous pattern Debts uses (partner_ledger is single-currency-per-row like Suppliers,
so the single-amount + currency-toggle UI is the correct analogue). **If the owner still sees no LBP
option in the running app, that's a build/deployment question, not a code gap — re-open with a
screenshot.**

No test previously exercised the LBP path (existing partner specs only send USD), so a guard was
added: `Partners.addCreditLbp.test.tsx` drives the real modal to submit `currency: "LBP"` and was
proven failing-first by temporarily removing the LBP option (rule 17).

### Files to Modify

| Layer    | File                                                      | Change                                    |
| -------- | --------------------------------------------------------- | ----------------------------------------- |
| Frontend | `frontend/src/features/partners/pages/Partners/index.tsx` | Add LBP option to Add Credit/Debt form    |
| Backend  | `packages/core/src/repositories/PartnerRepository.ts`     | Verify/extend currency handling if needed |

---

## Summary (Sprint 5 — LIRA-095..097)

| Priority  | Total | Done  | Remaining |
| --------- | ----- | ----- | --------- |
| High      | 1     | 0     | 1         |
| Low       | 2     | 0     | 2         |
| **Total** | **3** | **0** | **3**     |

### Sprint 5 board

| ID       | Title                                            | Priority | Status                                          |
| -------- | ------------------------------------------------ | -------- | ----------------------------------------------- |
| LIRA-095 | OMT/Whish/Katsh — rethink commission flow        | High     | INTERVIEW DONE → COMMISSION_AT_SETTLEMENT_PLAN  |
| LIRA-096 | Partners — remove Record Transaction (redundant) | Low      | NEEDS INTERVIEW                                 |
| LIRA-097 | Partners — enable LBP for Add Credit/Debt        | Low      | CLOSED — already working (guard test `d217221`) |

> The other 8 notes from this same batch were bugs — all fixed and independently verified
> 2026-08-07/08 (commits `dd6cbb6`, `a65ce03`). One further note (OMT receive fee override) was
> investigated and found to already work correctly — no ticket needed.

---

---

