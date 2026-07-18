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
