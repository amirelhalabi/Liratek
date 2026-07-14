# Multi-Currency Payment Engine — MultiPaymentInput Redesign

> **Created**: 2026-07-12
> **Status**: Approved design — implementation not started
> **Origin**: Sprint task T2 (`docs/tickets/CURRENT_SPRINT.md`) — rate change in the debt
> repayment modal inflates the LBP payment amount.
> **Tickets**: MCP-0 … MCP-5 (below)

---

## 1. Problem

**Repro (owner-reported, 2026-07-12):** a client owes **600,000 LBP**. The repayment
modal opens with rate 89,000 and prefills 600,000 LBP. Editing the rate to 90,000
changes the prefill to **606,742 LBP** — the debt appears to grow with the rate.

**Root cause — the debt's currency composition is destroyed at the component door:**

1. The Debts page normalizes the whole position into ONE USD scalar:
   `totalAmount = dueUsd + dueLbp / EXCHANGE_RATE`
   (`frontend/src/features/debts/pages/Debts/index.tsx:1871-1877`).
   600,000 LBP @ 89,000 becomes `$6.7416` — a bare number with no currency identity.
2. `MultiPaymentInput`'s single-mode auto-sync converts that USD scalar into the
   line's currency at the **current editable rate**, and re-runs on every rate edit
   (`packages/ui/src/components/ui/MultiPaymentInput.tsx:284-321`, same round-trip in
   the split-mode auto-fill at ~409-418).
   `6.7416 × 90,000 = 606,742`.

The stored ledger is per-currency and correct; the submission path reduces debt
per-currency (`computeRepaymentReduction`). The damage is **over-collection at the
counter** when the cashier trusts the prefill — plus a display/booking split-brain:
the UI derives its numbers from one computation, the submission from another.

## 2. Design principles

1. **No bare money numbers.** Every amount carries its currency: `Money = { amount, currency }`.
2. **Conversion only at a currency boundary.** A rate is consulted exactly when a
   payment (or spillover) crosses from one currency to another — never within one.
   Same-currency math is rate-independent _by construction_.
3. **One engine, two uses.** The number the UI displays and the number that books
   come from the SAME pure-function call. Display and submission can never drift.
4. **Adding a currency is data, not code.** EUR later = one registry row + one rate
   row. Zero component changes is the acceptance test for the whole design.

## 3. Domain model

```ts
// packages/ui/src/money/types.ts
export type Money = { amount: number; currency: string };

export type RateTable = {
  base: string; // "USD"
  rates: Record<string, { buy: number; sell: number }>; // value of 1 unit vs base
};
// convert(x, from, to) = through base: from→base→to. Identity when from === to.

export type CurrencyInfo = {
  code: string; // "USD" | "LBP" | later "EUR"
  symbol: string;
  decimals: number; // USD 2, LBP 0
  epsilon: number; // "close enough to settled": USD 0.01, LBP 0.5
};
```

The `CurrencyInfo` registry centralizes what is today scattered ad-hoc:
`Math.round` vs `toFixed(2)` inside `MultiPaymentInput`, and the `0.01 USD / 0.5 LBP`
tolerances hardcoded in the Debts page (~line 680). Long-term the registry is fed
from the `currencies` DB table; phase 1 ships a static map for USD/LBP.

## 4. The engine (pure TS, no React)

```ts
// packages/ui/src/money/
convert(m: Money, to: string, rates: RateTable, side: "buy" | "sell"): Money
roundForCurrency(m: Money, registry): Money

allocatePayments(input: {
  totals: Money[];        // owed, per currency (native)
  payments: Money[];      // IN legs being handed over, per currency
  rates: RateTable;
  side: "buy" | "sell";  // business decision, per flow (see D4)
}): {
  remaining: Money[];             // still owed, per currency — NATIVE, rate-independent
  crossCurrencyApplied: Array<{   // audit trail of every conversion that happened
    from: Money; to: Money; rateUsed: number;
  }>;
  change: Money[];                // true excess, in the tender currency (→ OUT legs)
}
```

`allocatePayments` algorithm: (1) net each payment against the total in its **own**
currency — no rate; (2) excess in currency X settles other currencies' remaining via
`convert()` — the ONLY place rates enter — in the D1 order; (3) what's left is
`change`, kept in the tender currency.

**Invariants (each becomes a unit test, see §7):**

- **I1 — Rate independence:** `remaining` in currency X never changes with any rate
  while all payments are in X. (This is T2.)
- **I2 — Conservation per currency:** payments = native-applied + cross-applied
  (converted) + change, within each currency's epsilon.
- **I3 — Identity:** `convert(m, m.currency, …) === m` exactly.
- **I4 — Rounding honesty:** rounding never fabricates or eats value beyond the
  currency's epsilon; a round-trip `X→base→X` at one rate is stable.
- **I5 — Determinism:** same inputs ⇒ same outputs, including spillover order.

## 5. Settled decisions

### D1 — Spillover order: largest remaining first, change in tender currency

Excess payment in currency X settles the other currencies' remaining debt in
**descending order of remaining value normalized to base**; whatever is left after
all debt is settled becomes change **in X** (the currency the customer handed over).

- _Why:_ deterministic, explainable at the counter ("your extra LBP paid down the
  dollar debt first because it was the bigger one"), minimizes the number of
  currencies left open, and change in the tender currency matches how the return-leg
  drawer flow already works.
- _Rejected:_ fixed priority list (arbitrary; silently wrong the day EUR arrives);
  pro-rata split (fractional conversions across several currencies — impossible to
  explain to a cashier or audit).

### D2 — Engine location: `packages/ui/src/money/`, with a named promotion trigger

Ships in `@liratek/ui` next to the component. It is pure zero-dependency TS.

- _Why:_ every consumer today is a frontend form; `@liratek/ui` is already the shared
  frontend package; moving pure TS later is cheap — duplicating it is exactly how the
  current display-vs-booking drift happened.
- _Promotion trigger (explicit):_ the FIRST time `packages/core` or `backend` needs
  conversion/allocation math, the module graduates to its own `packages/money`
  workspace and both import it. Never copy.
- _Rejected:_ `packages/core` now (main-process-oriented package, would couple the
  renderer to it); new workspace now (cost with no second consumer yet).
- _Note:_ engine unit tests live in the frontend workspace beside the existing
  component tests (`frontend/src/shared/components/__tests__/`) because
  `packages/ui` has no jest infrastructure — same convention as
  `MultiPaymentInput.test.tsx` today.

### D3 — Editable-rate UX: show a rate field only for pairs actually crossing

The rate editor renders **only** for currency pairs present in the engine's
`crossCurrencyApplied` output for the current line state. No conversion happening →
no rate field → nothing for a cashier to fiddle with (T2 becomes impossible to even
trigger on a pure-LBP debt paid in LBP).

- Seeded from the flow's `side` of the `RateTable`; an operator edit is a
  per-transaction override surfaced via `onRateOverride(pair, rate)` and fed into the
  SAME `allocatePayments` call that computes both the display and the submitted
  amounts (generalizes today's `repayModalRate` pattern, minus the split-brain).
- _Rejected:_ always-visible rate field (invites edits that can't affect anything —
  the current bug's UX); hiding rate entirely (operators legitimately override the
  daily rate per transaction — owner-confirmed workflow).

### D4 — Buy/sell side is the caller's explicit choice

`allocatePayments` and the component take `side: "buy" | "sell"` from the flow.
Repayments use `buy` (owner decision 2026-07-06, comment at `Debts/index.tsx:75-77`);
sales forms use their existing choice. The component never picks a side silently.

### D5 — Backward compatibility: shim, migrate, then delete

`totalAmount` / `totalAmountCurrency` / `exchangeRate` stay as deprecated props that
map internally to `totals=[{amount, currency}]` and a two-sided-equal `RateTable`.
Existing consumers keep byte-identical behavior (proven by MCP-0 characterization
tests) until each migrates; the shim is deleted in MCP-5.

## 6. Phases & tickets

| Ticket    | Scope                                                                                            | Size       | Status                        |
| --------- | ------------------------------------------------------------------------------------------------ | ---------- | ----------------------------- |
| **MCP-0** | Characterization tests + the failing T2 test                                                     | S          | ✅ 2026-07-12                 |
| **MCP-1** | Money core (`types`, `convert`, `round`, `registry`, `allocatePayments`) + invariant tests       | M          | ✅ 2026-07-12                 |
| **MCP-2** | Rewire `MultiPaymentInput` internals onto the engine behind the old props (zero behavior change) | M          | ✅ 2026-07-12                 |
| **MCP-3** | Migrate the Debts repayment + cash-out modal to `totals: Money[]`; T2 test green; e2e            | M          | ✅ 2026-07-12 (lira-105)      |
| **MCP-4** | Migrate the remaining 13 consumer files (mechanical)                                             | M (spread) | ✅ 2026-07-12                 |
| **MCP-5** | Delete the deprecated `totalAmount` path; EUR-readiness check                                    | S          | ✅ 2026-07-12 (revised scope) |

**MCP-5 outcome (2026-07-12):** `totalAmount` prop and its internal shim are
deleted — `totals: Money[]` is the only totals contract. `totalAmountCurrency`
(the summary/aggregate currency) and `exchangeRate` (the header-rate seed) are
re-documented as first-class props. The legacy `it.failing` scalar test died
with the prop as documented; the totals-contract T2 guards remain. EUR
acceptance landed at both levels: engine tests (mixed USD/LBP/EUR allocation)
and a component test proving a EUR total prefills natively and is invariant to
the USD↔LBP header rate — a new currency is a rate-table/registry row, no
component changes. Final verification: 377 frontend jest, 163 desktop e2e,
42 web e2e, all green; Electron ABI restored after the web run.

**MCP-4 outcome (2026-07-12):** every direct `MultiPaymentInput` call site now
passes per-currency `totals`; `totalAmount` was made optional (default 0) and
nothing passes it anymore. Two wrapper components (`PaymentSheet`,
`CheckoutModal`) keep scalar props in their OWN APIs and translate to `totals`
at their single inner call — their callers (TelecomForm, KatchForm,
FinancialForm, OmtWhishAppTransferForm, CardGridPayView, CryptoForm, POS page,
Maintenance page) needed no changes. SessionCheckoutModal migrated with a
corrected audit verdict (pattern present but already rate-aligned — not buggy).

**MCP-5 scope revision (2026-07-12):** the original scope ("delete
`totalAmount`/`totalAmountCurrency`/`exchangeRate`") over-reached.
`totalAmountCurrency` has a legitimate ongoing role — the currency the summary
aggregates/displays in — and `exchangeRate` is the seed for the operator's
header rate field; deleting them forces a `rateTable` rollout through every
consumer with zero behavioral gain. Revised MCP-5: delete the deprecated
`totalAmount` prop + its internal shim branch (and the `it.failing`
legacy-path test, whose documented death this is), keep
`totalAmountCurrency`/`exchangeRate` as first-class props (re-documented, no
longer "deprecated"), and land the EUR-readiness proof (3-currency totals +
rateTable through the component with zero component changes).

**Implementation notes (2026-07-12):**

- Rule-17 proofs ran at BOTH levels: the component test failed on pre-fix code
  with `Expected "600,000" / Received "606,742"`, and `lira-105` failed the
  same way with the fix stash-reverted. The residual legacy-scalar bug is kept
  documented by an `it.failing` test that dies with the shim in MCP-5.
- MCP-2 zero-behavior-change detail: prefill math keeps the legacy rounding
  contract — the native part passes through raw (like the old same-currency
  branch); only the cross-converted part is rounded to currency precision.
  `allocatePayments` grew a `{ round: false }` option for this.
- The engine's `change` output is not yet wired to the return-leg UI — the
  return/change fields still work off the legacy scalar bridge
  (`overpaidTarget` in totalAmountCurrency). Candidate improvement for MCP-4+.

### MCP-0 — Pin down today, prove the bug (rule 17)

- Extend `frontend/src/shared/components/__tests__/MultiPaymentInput.test.tsx` with
  characterization tests of CURRENT math: single-mode prefill, rate-edit resync,
  split-mode auto-fill, discount clamping, waive threshold — for a single-currency
  total (the correct, must-not-change behavior of POS/Telecom/etc.).
- Add the T2 regression test: totals equivalent to `dueLbp=600000` fed through the
  current scalar API at rate 89,000, rate edited to 90,000 → assert prefill stays
  600,000. **Must FAIL on current code** — commit the failing proof note in the test.
- Acceptance: suite green except the one documented-failing T2 test.

### MCP-1 — Build the engine

- `packages/ui/src/money/` per §3–§4, exported from `@liratek/ui`.
- Unit tests in `frontend/src/shared/components/__tests__/moneyEngine.test.ts`
  covering invariants I1–I5 plus: mixed USD+LBP totals, overpay-in-LBP spillover
  order (D1), change stays in tender currency, epsilon behavior at boundaries,
  degenerate rates guarded (0 / NaN / missing currency ⇒ typed error, never NaN out).
- Verify whether `@liratek/ui` needs a build/sync step for the frontend to see new
  exports (mirror of the `@liratek/core` node_modules-copy gotcha) — document the
  answer in this file.
  - **Answered (2026-07-12): NO build/sync step.** `@liratek/ui` has
    `"main": "./src/index.ts"`, and both `frontend/jest.config.ts` and
    `frontend/vite.config.ts` alias `@liratek/ui` straight to
    `packages/ui/src/index.ts` — source is consumed directly everywhere. The
    core-style node_modules-copy gotcha does NOT apply.
- Acceptance: engine tests green; no component/consumer file touched.

### MCP-2 — Rewire the component (refactor, zero behavior change)

- Replace `MultiPaymentInput`'s internal scalar math (single-mode auto-sync effect,
  split auto-fill, remaining display, discount normalization) with engine calls.
- Old props mapped via the D5 shim; `totals`/`rateTable`/`side`/`onRateOverride`
  added but not yet consumed anywhere.
- Acceptance: ALL MCP-0 characterization tests pass unchanged; `yarn typecheck`,
  `yarn lint`, frontend test suite green; no consumer file modified.

### MCP-3 — Migrate the Debts modal (the T2 fix lands here)

- Repayment + cash-out modals pass `totals=[{dueUsd,"USD"},{dueLbp,"LBP"}]`
  (resp. credit amounts), `side:"buy"`; delete the `dueLbp / EXCHANGE_RATE`
  normalization and the `repayModalRate` re-derivation.
- Submission consumes the SAME `allocatePayments` result the UI displayed
  (`remaining` → reduction, `change` → OUT legs; rule 16 — flow code never iterates
  return legs).
- Re-implement `computeRepaymentReduction`
  (`frontend/src/features/debts/utils/repaymentReduction.ts`) as a thin wrapper over
  `allocatePayments`. Its existing test suite MUST stay green — any intended
  behavior change (e.g. the documented LBP→USD smart-rounding) is called out
  explicitly here, not slipped in.
  - **Decision at implementation (2026-07-12): kept as-is, wrapper REJECTED.**
    On reading the code, `computeRepaymentReduction` is not allocation — it is
    booking POLICY layered on the same per-currency native-first model:
    (a) smart-rounding forgiveness (LBP notes rounded up to 5,000 clear the
    exact USD fraction), (b) overpay beyond all debt books as CUSTOMER credit
    (over-reduction), not change. Forcing it through `allocatePayments` would
    re-implement both around the engine — more code and more risk on a money
    path, not less. The drift the wrapper was meant to prevent is closed
    differently: display and booking now share the same rate source (the
    modal header field) and the same per-currency native-first semantics.
- New desktop e2e `lira-105-debt-repayment-rate-invariance.spec.ts`: seed an
  LBP-only debt, open repayment, edit the rate, assert prefill unchanged; submit and
  assert per-currency ledger + drawer DELTAS (rule 15 — identity matching, no
  row-position asserts). Mirror in web mode per the parity roadmap if the shim
  covers the flow.
- Acceptance: T2 test green; repaymentReduction tests green; e2e green both ABIs.

### MCP-4 — Migrate remaining consumers (mechanical, opportunistic)

Call sites (from repo grep, 2026-07-12; most are genuinely single-currency and
become `totals=[{amount, currency:"USD"}]` one-liners):

| File                                                      | Note                                                     |
| --------------------------------------------------------- | -------------------------------------------------------- |
| `features/sales/pages/POS/components/CheckoutModal.tsx`   | USD sale total                                           |
| `features/sessions/components/SessionCheckoutModal.tsx`   | check for mixed-position feed                            |
| `features/loto/pages/Loto/index.tsx`                      |                                                          |
| `features/loto/components/SettlementVerification.tsx`     |                                                          |
| `features/expenses/pages/Expenses/index.tsx`              | touches T7 (all payment methods) — coordinate            |
| `features/custom-services/pages/CustomServices/index.tsx` |                                                          |
| `features/recharge/components/TelecomForm.tsx`            |                                                          |
| `features/recharge/components/KatchForm.tsx`              |                                                          |
| `features/recharge/components/PaymentSheet.tsx`           |                                                          |
| `features/recharge/pages/Recharge/index.tsx`              |                                                          |
| `features/services/pages/Services/index.tsx`              |                                                          |
| `features/settings/pages/Settings/SupplierLedger.tsx`     | supplier ledger may be mixed-currency — audit like Debts |
| `features/suppliers/pages/Suppliers/index.tsx`            | same audit                                               |

- **Audit rule while migrating:** any consumer found feeding a _mixed/native-LBP
  position normalized at a frozen rate_ (the T2 pattern) gets the Debts treatment +
  its own regression test, not just the mechanical prop swap. Prime suspects:
  SupplierLedger, Suppliers, SessionCheckoutModal.
- **Audit results (2026-07-12):**
  - `SupplierLedger.tsx:821` — CLEAN. `settleNetPayUsd` sums USD-only rows
    natively (`t.currency !== "LBP"` filter); no rate collapse. Mechanical swap.
  - `Suppliers/index.tsx:853` — CLEAN. `totalAmount={Math.abs(payAmount)}` with
    `totalAmountCurrency={payCurrency}` — genuinely single-currency. Mechanical.
  - `SessionCheckoutModal.tsx:335-337` — pattern present but **NOT buggy**
    (initial audit call of "has the T2 bug" was wrong; corrected same day).
    `combinedTotalUSD = chargeUsd + chargeLbp / exchangeRate` LOOKS like the
    Debts bug, but `exchangeRate` here is live modal state fed by
    `onRateChange` — scalar and rate move together, so the LBP prefill
    round-trips back to its native value on every edit (this modal had
    independently implemented the "rate alignment" fix shape). The Debts bug
    specifically required the scalar to be frozen at a DIFFERENT rate
    (page-level `EXCHANGE_RATE`) than the one being edited (`repayModalRate`).
    Migrated to per-currency `totals` anyway (native model, no scalar float
    round-trip) as a mechanical MCP-4 item — no failing-first spec possible or
    needed; existing session e2e (lira-094/098/099) cover the modal.
- Acceptance per file: behavior test (characterization or existing suite) green.

### MCP-5 — Delete the shim, prove EUR-readiness

- Remove `totalAmount`/`totalAmountCurrency`/`exchangeRate` props and the shim.
- EUR-readiness check (design acceptance test): add a fake `EUR` row to the static
  registry + rate table in a test, run a mixed USD/LBP/EUR allocation through the
  engine and the component — no component code change required.
- Acceptance: full quality gates (`yarn typecheck`, `yarn lint`, frontend + backend
  suites, both e2e ABIs).

## 7. Test plan summary

| Layer            | What                                                                    | Where                                      |
| ---------------- | ----------------------------------------------------------------------- | ------------------------------------------ |
| Unit (engine)    | Invariants I1–I5, D1 spillover, epsilon/rounding, degenerate rates      | `moneyEngine.test.ts` (frontend workspace) |
| Unit (component) | Characterization of pre-change behavior + T2 regression (failing-first) | `MultiPaymentInput.test.tsx`               |
| Unit (debts)     | `repaymentReduction` wrapper parity                                     | existing `repaymentReduction.test.ts`      |
| E2E desktop      | `lira-105` rate-invariance + per-currency deltas                        | `frontend/tests/e2e-electron/`             |
| E2E web          | same flow over the shim (parity roadmap)                                | `frontend/tests/e2e-web/`                  |

## 8. Risks & gotchas

- `MultiPaymentInput` is 1,453 lines with 14 call sites — the MCP-0 characterization
  net is **non-negotiable** before MCP-2 touches internals.
- Rule 16: engine `change` output maps to OUT/return legs handled by the repos' ONE
  shared end-of-transaction loop; no flow branch may consume them.
- Booking parity in MCP-3: display and submission intentionally converge on one
  engine call — if any historical asymmetry between them was load-bearing (smart
  rounding), it must be reproduced in the engine or explicitly retired here.
- `@liratek/ui` build/sync semantics unverified (MCP-1 checks whether the core-style
  node_modules copy gotcha applies).
- Dual-transport (rule 19): all changes are renderer-side; the IPC/REST payloads
  (`addRepayment` per-currency amounts) are unchanged — but the web e2e must prove it.
