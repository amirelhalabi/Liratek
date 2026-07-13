# T3 — "Keep change": return nothing to the client, book the extra as profit

> **Created**: 2026-07-13
> **Status**: Approved design — implementation not started
> **Origin**: Sprint task T3 (`docs/tickets/CURRENT_SPRINT.md`) — owner: "in the
> return amount section, I want to be able to not return anything to the client
> (I'll have extra money in the drawer, that's fine)."
> **Owner decisions (interview 2026-07-13)**: scope = EVERYWHERE (all forms with
> a Return/Change section, debts included); booking = the kept extra COUNTS AS
> PROFIT; UI = a "Keep change" toggle button.

---

## 1. Problem

When a customer overpays, MultiPaymentInput's Return/Change section auto-seeds
the change and its two CASH fields (USD + LBP) auto-balance each other —
clearing one refills the other with the remainder. **Returning nothing is
structurally impossible today.** Overpayment behavior also diverges by module:
most flows would just leave the extra in the drawer (untracked), while the
debts flow converts an unreturned overpay into extra debt reduction / client
credit.

## 2. Design

### Semantics of "Keep change" (active)

- **No OUT legs are emitted** (`onReturnChange([])`). The customer's full
  tender books as IN legs → the drawer keeps the extra, fully accounted:
  closing/checkpoint expected-cash includes it, so NO variance (verified
  against the checkpoint model).
- **The kept amount is stamped as profit** on the transaction, per currency:
  `profit_usd += kept_usd`, `profit_lbp += kept_lbp` at create time, in the
  creating repository (the FEATURE_GUIDE §10 stamp). Folding it into the
  create-time stamp makes refund symmetry AUTOMATIC — the generic refund
  negates the whole stamp (rule 20), and `_reversePayments` returns the full
  tender (including the kept extra) to the customer, which is correct.
- **Debts special case**: with keep-change active, the kept extra must NOT
  reduce the debt (no silent client credit). The repayment reduction nets the
  kept amounts out (like return legs today), and the kept extra becomes the
  DEBT_REPAYMENT transaction's profit stamp.
- Rule 16 holds by construction: keeping change means NO return legs exist;
  no flow branch ever iterates them.

### Transport — explicit amounts, not a flag (WYSIWYB)

The frontend sends the EXACT kept amounts it displayed:
`kept_change_usd?: number` / `kept_change_lbp?: number` (optional,
nonnegative, default 0) added to each money module's core validator
(`packages/core/src/validators/`), re-exported to electron schemas, consumed
identically by the REST routes (rule 19 — one schema, both transports).
A repo-side re-derivation (boolean flag) was REJECTED: it would recompute the
overpay at repo-chosen rates and could drift from what the operator saw.

### UI

One toggle button in the Return/Change block of `MultiPaymentInput`:
- Activate → both return fields zero + disable, `onReturnChange([])`, and a
  new optional callback `onKeptChange({ usd, lbp } | null)` fires with the
  suggested-change amounts as of that moment.
- Deactivate → fields re-seed with the suggested change, `onKeptChange(null)`.
- Renders only when overpaid (same visibility as the Return/Change block).
- Parents wire `onKeptChange` into their submit payloads.

### Decision default (flag to owner if it surprises)

Kept change folds into the MODULE's profit on the Profits page (a kept 5,000
LBP on a loto ticket raises loto profit). A separate "kept change" profit
bucket was considered and deferred — revisit only if module-profit reports
become misleading.

## 3. Phases

| Ticket | Scope | Status |
| ------ | ----- | ------ |
| **KC-0** | MultiPaymentInput: "Keep change" button + `onKeptChange` emission; component tests (failing-first: returning-nothing is impossible today) | ✅ 2026-07-13 |
| **KC-1** | Reference module POS end-to-end: schema field, handler + REST, SalesRepository profit stamp, failing-first repo test + e2e incl. **create + refund nets to 0** proof | ✅ 2026-07-13 (lira-106; failing-first proof: profit delta 40 pre-fix vs 90 post-fix; 164 desktop + 42 web e2e green) |

**KC-1 implementation notes (2026-07-13):**

- Transport: `kept_change_usd`/`kept_change_lbp` on `saleProcessSchema`
  (`packages/core/src/validators/sale.ts`) → both transports pass the whole
  validated object to `SalesService.processSale` → `SalesRepository` adds the
  kept amounts to the create-time profit stamp (`profit_usd`/`profit_lbp`).
- Reversal split settled while implementing: the GENERIC full void negates the
  whole stamp (kept change reverses, full tender returns — asserted by
  lira-106); the PER-ITEM refund path deliberately does NOT reverse kept
  change (a partial item return doesn't hand the kept change back).
- Unmigrated modules receiving the fields (e.g. Maintenance shares
  CheckoutModal) safely STRIP them at validation (Zod default) until their
  KC-3 schema lands — no breakage, just ignored.
| **KC-2** | Debts: reduction excludes kept amounts; DEBT_REPAYMENT profit stamp; e2e | ✅ 2026-07-13 (lira-107; "Other / kept change" profits bucket + page line) |

**KC-2 implementation notes (2026-07-13):**

- Owner decision: new **"Other / kept change"** Profits line (bucket
  `debt_repayments` in ProfitSummary; `getDebtRepaymentProfit` mirrors the
  SALE+REFUND pattern over `source_table='debt_ledger'` so a voided
  repayment's negated stamp nets out). Counts in gross-profit totals.
- **Kept split is TENDER-native** (engine `change` output), NOT the
  return-field suggestion: lira-107's failing-first run caught a kept
  100,000 LBP reported as the $1.12 return suggestion, which the per-currency
  netting clamped away and cross-converted into a phantom client credit.
  The smart-split return suggestion (USD notes + LBP remainder) likewise does
  not apply to KEEPING — the drawer physically holds the excess tender.
- **Two failing-first proofs** en route (profit delta 0 vs 100,000; balance
  ±1.12 vs 0) — the second found the tender-native design requirement.
- **Rule-14 debt found**: `DebtRepaymentSchema` in electron-app/schemas is a
  LOCAL duplicate of core's `addRepaymentSchema` (REST validates core, IPC
  validates the local copy) — kept fields silently stripped on desktop until
  added to BOTH. Documented at both sites; consolidate like DebtCashOutSchema
  when next touched.
- Keep-change is wired for REPAY mode only; cash-out mode has no defined
  "kept change" semantics and shows no button (opt-in).

**KC-2 finding (2026-07-13):** `ProfitRepository`'s summary joins specific
transaction types per module — DEBT_REPAYMENT is aggregated NOWHERE, so a
kept-change profit stamp on a repayment books in the data but is INVISIBLE on
the Profits page. KC-2 therefore needs either (a) a new summary bucket (e.g.
"Debt repayments / kept change") + Profits page line, or (b) owner accepts
keep-change on debts NOT appearing in profit reports (stamp only). Owner
decision pending. Meanwhile the keep-change button was made OPT-IN per
consumer (`onKeptChange` wired = shown): unmigrated forms (debts, maintenance,
recharge, loto, custom services, sessions) show NO button, closing the
silent-money-hole hazard of suppressing returns whose kept amounts the backend
would strip.
| **KC-3** | Remaining modules (recharge/financial, loto, custom services, maintenance): mechanical replication + combined delta e2e | ⬜ |
| **KC-4** | Sessions: button in SessionCheckoutModal; kept change carried on the pooled-payment carrier row; web-parity run + docs | ⬜ |

Every phase: rules 17 (failing-first), 15 (delta assertions), 19 (both
transports), 20 (create+reverse nets 0 across drawers/ledgers/profit, per
currency); full gates (typecheck, jest, desktop + web e2e) before ticking.

## 4. Risks

- **Session carrier row** (KC-4) is the one structurally unclear spot: the
  basket books several transaction rows; the kept-change profit must land on
  exactly one (the pooled-payment carrier) and reverse with it.
- Kept change is USD/LBP only (the return UI is a USD/LBP pair). EUR later
  inherits via the same per-currency fields when the return UI grows a third
  field — no design change needed.
- The Profits page will show kept change inside module profits (see decision
  default above).
