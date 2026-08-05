# Payment-Legs Integrity — kill the "gated legs" bug class

> **Created**: 2026-07-18 · **Origin**: owner-reported Whish App SEND bug (LBP
> tender recorded as USD); cross-session study swept every payment form,
> backend consumer, and the MultiPaymentInput contract.
> **Decisions**: S1–S8 answered by the owner 2026-07-18 (see below).
> **Status**: PLAN → executing as waves 6–8 in the orchestration session.

## The bug class

The legs contract works when forms send ALL legs (IN tender + OUT change) in
one call → `partitionLegs` splits → IN legs credit each leg's own drawer in
the leg's own currency → one shared loop debits OUT legs. The failures are at
the edges:

**Four forms gate sending legs on "split only"** — a single-line payment
(the common case) silently drops amount+currency; only the method survives,
and backend fallbacks then assume tender = service currency:

| Form                                              | Gate             | Extra problem                                                                                                                                                                          |
| ------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Services/index.tsx:833-858` (OMT/WHISH system)   | split-only       | change-leg branch sends OUT legs but still drops the IN tender; embeds gated payload into session formData (assumption to verify: does session replay neutralize it via deferPayment?) |
| `OmtWhishAppTransferForm.tsx:85`                  | split or change  | the reported bug                                                                                                                                                                       |
| `Recharge/index.tsx:935` (Binance)                | split or change  | —                                                                                                                                                                                      |
| `FinancialForm.tsx:386` (Whish App bills/catalog) | split or voucher | never wires change legs at all — overpayment change never recorded (violates lira-088 rule)                                                                                            |

**8 backend fallback sites** assume tender = service currency
(FinancialServiceRepository, RechargeRepository, legacy loto path) — they stay
as legacy-caller fallbacks but stop being reachable from the UI once the gates
are gone.

**Second verified bug**: `RechargeRepository.ts:954-970` sums
CUSTOMER_ACCOUNT debt across all leg currencies and books the whole sum under
the service currency — a mixed-currency on-account recharge writes debt in the
wrong currency column.

**Safe by construction** (verified): POS sales, debts repayment/cashout,
custom services, maintenance, expenses, suppliers, session checkout.

> **Correction (2026-07-20):** "debts repayment/cashout" above was verified safe for the
> **payment-legs write contract** audited in this plan (a form sends all its legs, the repository
> posts them without dropping any) — that verdict still stands. What it did NOT cover is a
> separate bug one layer up, in the **repayment reduction math** that consumes those legs to
> decide how much debt to clear: `computeRepaymentReduction` netted change per-currency with a
> floor (`Math.max(0, paid − returned)`), which silently dropped an OUT leg returned in a
> different currency than it was paid in instead of reconciling it against the other currency's
> overpayment. See "Owner scenarios verified & fixed (2026-07-20)" at the end of this doc for the
> full root cause and fix. Not deleting the original line — the legs-write audit above was
> correct on its own terms; the gap was adjacent to it, not inside it.

## Owner decisions (2026-07-18)

- **S1 — Always send legs.** All four gates removed; a form forwards ALL legs
  whenever ≥1 payment line exists. KatshForm's shape is the model. Backend
  fallbacks remain only for legacy/scripted callers.
- **S2 — Hard-reject reconciliation, refined rule.** When legs are present,
  the repository verifies at the stamped exchange rate (epsilon ~$0.05 /
  ~5,000 LBP): `sum(IN legs incl. CUSTOMER_ACCOUNT) − sum(OUT change legs) =
required total`. Business nuance (owner): with NO client identity
  (no name/session), payment must be in full — overpayment is returned to the
  walk-in customer as OUT change legs; with client identity, a
  CUSTOMER_ACCOUNT leg may cover the remainder (identity requirement for
  account legs is already enforced by the name+phone rule). Same invariant
  either way. Mismatch = the write FAILS. No-leg legacy callers unaffected.
  Implemented as the seed of CQ-3's `moneyPosting.ts` shared helper.
- **S3 — Tender-first display, value-model internals.** The row's in/out line
  shows the real tender legs (`in: 900,000 LBP`); the summary carries the
  service value ("OMT send $10 (paid 900,000 LBP)"); `amount_usd/lbp` keep
  the VALUE stamp (v126 model) so profits/reports never double-count.
- **S4 — Book physical reality; keep the System-drawer convention.** General
  takes the real tender currency (+900,000 LBP); the reserve transfer
  (General −$X USD → *_System +$X USD, emptied at supplier settlement) is
  unchanged. No phantom FX conversions; till rebalancing is the Exchange
  module's job (lira-082 principle).
- **S5 — Change currency stays operator-controlled** (mixed-currency change
  is normal; engine suggests tender currency).
- **S6 — Wire FinancialForm (Whish App bills) change legs in this sweep.**
- **S7 — Fix the recharge on-account debt-currency bug in this sweep**, with
  rule-20 reversal symmetry (refund path reverses per currency identically).
- **S8 — Full guard scope**: cross-currency single-leg tests for the whole FS
  SEND family; `partitionLegs` unit test; a static "gate guard" test that
  fails any form gating legs on `isSplitPayment` (class-killer, mirrors
  moduleDebtTypes.guard); FEATURE_GUIDE §4 reworded: "forms forward ALL legs
  whenever any line exists — never gate on split".

## Waves

| Wave            | Scope                                                                                                                                                                                                                                                    | Gate                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **6 (Phase 1)** | Remove all four form gates (S1); wire FinancialForm change legs (S6); verify/fix the Services session-formData assumption; failing-first form guards + FS-repo single-LBP-leg jest guard + lira-077 cross-currency e2e case (written, run at final gate) | frontend + core jest                        |
| **7 (Phase 2)** | Repo-layer reconciliation per refined S2 (seed of CQ-3 `moneyPosting.ts`); S7 recharge debt-currency fix + reversal symmetry                                                                                                                             | core + backend jest                         |
| **8 (Phase 3)** | S8 guard sweep + FEATURE_GUIDE rewording + S3 display verification (the "(paid …)" suffix and in-line render with legs restored)                                                                                                                         | all jest walls + web e2e + full desktop e2e |

Constraints carried over from the CQ waves: typecheck/lint batched at the end;
Node-ABI flips owned by the orchestrator; fixture drift → fix fixtures never
queries; rule 17 failing-first for every fix; nothing committed (owner
decision 2026-07-18: proceed on the uncommitted tree).

---

## Owner scenarios verified & fixed (2026-07-20)

Two scenarios from the owner's 2026-07-20 feedback batch (32 notes, disposition log in root
`LEFT_TO_DO.md`) were traced to real bugs immediately adjacent to this plan's scope. Both are
now fixed and unit-tested.

### Note 30 — debt repayment: cross-currency change returns a phantom credit

**Scenario:** customer owes $30, pays $40 cash, shop returns 900,000 LBP in change. The debt
ledger should net to exactly −$30 (debt cleared, nothing more). Instead it booked −$40 — a
phantom $10 customer credit.

**Root cause:** `frontend/src/features/debts/utils/repaymentReduction.ts`
`computeRepaymentReduction` computed `netPaidUsd = Math.max(0, paidUsd − returnedUsd)` and
`netPaidLbp = Math.max(0, paidLbp − returnedLbp)` **independently per currency**. Since all
$40 was paid in USD and the change was returned in LBP, `returnedLbp` (900,000) had no
`paidLbp` to subtract from — the LBP change was clamped to 0 and silently dropped instead of
being converted against the USD side. The undiminished $40 USD net then over-cleared the $30
debt, and the $10 difference was re-added as a "customer credit" write to `debt_ledger`.

**Fix:** the per-currency net is now allowed to go negative internally — a negative net means
more was returned in that currency than was tendered in it, i.e. the change came from the
OTHER currency's payment. That deficit is settled against the other currency's net at the
transaction's `rate` **before** either side is clamped at 0 (see the diff in
`repaymentReduction.ts` — `netUsd`/`netLbp` intermediate variables replace the old
independent `Math.max(0, …)` pair). Cross-currency change is now netted correctly in both
directions (USD paid / LBP change, and LBP paid / USD change).

**Tests:** new failing-first cases in
`frontend/src/features/debts/utils/__tests__/repaymentReduction.test.ts` reproduce the exact
owed-$30/paid-$40-USD/returned-900,000-LBP scenario and assert the debt reduction nets to
exactly $30, not $40.

### Note 23 — ServiceDebtDetailModal: display-only currency mis-attribution

**Scenario:** a debt/account-charge amount rendered in the WRONG currency in the debt detail
modal — e.g. a $3 USD debt on an LBP-denominated service displayed as "3 LBP" instead of "$3".

**Root cause:** `frontend/src/features/debts/components/ServiceDebtDetailModal.tsx`'s
`fmtCurrency` helper defaulted to the PARENT service's own currency (`fs.currency`) whenever
no explicit currency was passed at a call site — but a payment leg or a debt/account-charge
amount can be denominated in a DIFFERENT currency than the service it's attached to. Storage
was already correct (the debt ledger and payment legs were written with the right currency);
this was a display-only bug. A second, related issue: `totalPaid` summed customer payment legs
across BOTH currencies into one number before formatting, so a mixed-tender payment (part USD,
part LBP) collapsed to a single misleading figure.

**Fix:** `fmtCurrency` now takes an explicit, required currency argument at every call site
(no more silent fallback to `fs.currency`); the debt/account-charge amount is always formatted
as USD per its actual source column (`debt_ledger.amount_usd`); and `totalPaid` was split into
`totalPaidUsd`/`totalPaidLbp`, rendered via the shared `formatPaidAmount` helper (same one
`salePaidFormat.ts` already uses elsewhere) so a mixed-currency payment shows both amounts
instead of one wrong number.

**Tests:** a component test added covering the USD-debt-on-LBP-service case and the
mixed-currency paid-total case; `data-testid="service-debt-paid-total"` /
`data-testid="service-debt-remaining"` added for direct assertion.
