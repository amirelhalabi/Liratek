# Sprint 6 Archive — Todo-Plans Sweep, 2026-08-08 onward (LIRA-098..138)

> **Archived 2026-08-12** from `current_sprint.md` (per `docs/plans/todo_plans/SPRINT_INVENTORY_2026-08-12.md`,
> committed `2bfc7f5`). Sprint 6 is `current_sprint.md`'s live sprint — it is NOT fully closed, so
> this archive holds only the tickets that were already DONE / CLOSED / RESOLVED **before**
> 2026-08-12 and are not needed as live-board context.
>
> **NOT archived here — still genuinely open, moved to the live board in `current_sprint.md`:**
> LIRA-099, 101, 110, 114, 116, 117, 138.
>
> **NOT archived here — closed on 2026-08-12 (today), kept in the "Recently Closed" section of the
> live board as useful recent context:** LIRA-113, 118, 119, 120, 121, 122, 123, 124, 125, 126,
> 127, 128, 129, 130, 131, 137.
>
> **Stale-marker corrections applied in place below** (per
> `docs/plans/todo_plans/SPRINT_INVENTORY_2026-08-12.md` §4.2–4.3, §4.6): LIRA-104 and LIRA-111
> (both detail blocks said TODO while this sprint's own board said DONE — same file contradicting
> itself); the Summary header range (`LIRA-098..107` was stale — the board runs to LIRA-138); and
> the Summary board's LIRA-113 row (said TODO; DONE via `eb820c7`, 2026-08-11).
>
> The DECISION LOG entry below is not a ticket — it documents a cancelled feature (partner-mode
> derivation) "so it is not rebuilt." Kept verbatim.

---

# Sprint 6 — Todo-Plans Sweep (2026-08-08)

> **Sprint Focus:** `current_sprint.md` as the single source of truth — every `docs/plans/todo_plans/*.md`
> file was re-verified against the actual current code (not just its own claimed status/checkboxes,
> which are known to go stale within days), and every genuinely-remaining item is filed below as a
> real ticket. Nothing here was found by trusting a plan doc's own words — each item was independently
> confirmed via grep/read/`git log` before being ticketed.
> **Created:** 2026-08-08
> **Status Legend:** `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED` | `NEEDS INTERVIEW`

**Source:** all 8 files under `docs/plans/todo_plans/`. `OWNER_NOTES_TASK_PLAN.md`'s remainder needs
**no new ticket** — it's already fully represented by the existing **LIRA-083, 084, 086, 087, 088, 089**
(Sprint 4, above). The other 7 files each had 1-2 genuine, verified residuals — ticketed below.
Several plans turned out MORE complete than their own "Left TODO" notes claimed (e.g.
`PRIMARY_CASH_DRAWER_PLAN.md` flagged a spec as broken that was actually already fixed 2026-08-07) —
a reminder that the plan docs themselves are not reliable evidence, only the code is.

## LIRA-098: Guard test — profit queries must use the debt/partner-pending recognition gate

| Field                | Value                                                                        |
| -------------------- | ---------------------------------------------------------------------------- |
| **Epic**             | Profits / Counterparty Ledgers                                               |
| **Type**             | Test / Guard                                                                 |
| **Priority**         | Medium                                                                       |
| **Status**           | DONE (2026-08-08) — and it found LIRA-108                                    |
| **Affected Modules** | Profits                                                                      |
| **Assigned To**      | —                                                                            |
| **Depends On**       | —                                                                            |
| **Source Plan**      | `docs/plans/todo_plans/COUNTERPARTY_CONSOLIDATION_PLAN.md` (CQ-1, last item) |

### Summary

`ProfitRepository.ts` defines and reuses `notDebtPending`/`notPartnerPending`/`saleFullyPaid`/
`salePaidOrPartnerSettled` fragments (~15 call sites) so profit is only recognized once money is
real — but nothing scans for a future profit query that skips the gate. A second file-scanning
guard test (the plan's own CQ-1 goal) was never written — only `moduleDebtTypes.guard.test.ts` and
`partnerLedgerTypes.guard.test.ts` exist in `constants/__tests__/`, no third file.

### Acceptance Criteria

- [x] New `packages/core/src/constants/__tests__/profitRecognition.guard.test.ts`, mirroring
      `partnerLedgerTypes.guard.test.ts`'s file-scanning approach — extended beyond the ticket's
      sketch: per-`.prepare()` query units, the big `getByDate` CTE split into one unit per CTE
      (so a new ungated CTE can't hide behind its siblings' gates), `--` comment stripping (proven
      necessary — a SQL comment containing the word "profit" false-positived on the first clean run),
      six gate fragments recognized (the ticket's four + `saleNotFullyPaid`/`txnNotPartnerPending`,
      without which the guard fails on CORRECT code), five documented exclusions each with a verified
      reason, and two guard-the-guard sanity tests (fragments still exist; scan finds >10 units —
      actual 27).
- [x] Rule 17 both ways: passes on clean code; observed FAILING on an injected ungated
      `SUM(profit_usd)` dummy (then removed, `git diff` confirmed empty).
- [x] Full core jest green: 154/154 suites, 1658/1658 tests. Typecheck clean.

### Outcome — the guard found a real candidate bug on day one

Building the exclusion list surfaced **LIRA-108** (filed below): `getRealizedCommissionTotals` lacks
the counterparty gates its sibling settled-commission query carries. That's the guard doing exactly
what CQ-1 wanted — except the hole predates the guard. With this, `COUNTERPARTY_CONSOLIDATION_PLAN.md`
has nothing left and can be archived once LIRA-108 is resolved (the plan's own scope is complete;
108 is a new finding, not a plan residual).

### Files to Modify

| Layer   | File                                                                          | Change                   |
| ------- | ----------------------------------------------------------------------------- | ------------------------ |
| Backend | `packages/core/src/constants/__tests__/profitRecognition.guard.test.ts` (new) | File-scanning guard test |

---

## LIRA-108: `getRealizedCommissionTotals` missing counterparty gates — "Commission (Settled)" may overstate

| Field                | Value                                                          |
| -------------------- | -------------------------------------------------------------- |
| **Epic**             | Profits / Counterparty Ledgers                                 |
| **Type**             | Bug (candidate — needs money-eyes verification)                |
| **Priority**         | Medium                                                         |
| **Status**           | DONE (2026-08-08) — CONFIRMED REAL, fixed, double-SHIP verdict |
| **Affected Modules** | Profits                                                        |
| **Assigned To**      | —                                                              |
| **Depends On**       | —                                                              |
| **Source Plan**      | Found by LIRA-098's guard-building analysis (2026-08-08)       |

### Summary

`ProfitRepository.getRealizedCommissionTotals` (~line 1220, feeds `ProfitService.getByPaymentMethod`'s
"Commission (Settled)" row) sums `financial_services.commission` with only
`is_settled = 1 AND commission > 0 AND notRefunded AND dateRange AND tenant_id` — **no**
`notPartnerPending`/`notDebtPending`. Its sibling `getFinancialSettledByCurrency` (~line 529) carries
BOTH gates (lines 546-547) for the same `is_settled = 1` population. Asymmetry verified directly in
source, not just reported.

Consequence if real: a commission transaction that is supplier-settled but still partner-pending
(for-partner flow) or account-charged (debt still open) shows its commission as realized profit in
the "Commission (Settled)" row while the sibling per-currency view correctly withholds it — the two
profit views disagree, and the totals row overstates.

### Acceptance Criteria

- [x] Money-eyes verification: **CONFIRMED REAL** — constructed concretely (in-memory DB, same
      window/tenant): realized totals returned 23 USD/3 rows (control 5 + partner-pending 7 +
      debt-pending 11) while the gated sibling returned 5 USD/1 row. Divergence 18 USD, asserted
      directly. Domain-intent review of FEATURE_GUIDE/COUNTERPARTY_LEDGERS + git history: omission,
      not a decision.
- [x] Gates added by adopting the sibling's exact JOIN shape (`t.type='FINANCIAL_SERVICE'`,
      `t.status='ACTIVE'`, `notPartnerPending` + `notDebtPending`, dual tenant binds) — rule 14
      fragments reused verbatim. Rule 17: regression test observed failing pre-fix
      (Expected 10/Received 28; divergence Expected 0/Received 18), independently re-confirmed by a
      second reviewer who reverted and re-ran himself.
- [x] `getPendingCommissionTotals` deliberately UNCHANGED — investigation answer: a
      settled-but-counterparty-pending row belongs in NEITHER by-payment row (it lives in
      deferred/counterparty views until the counterparty pays); documented in the method comment
      and `docs/COUNTERPARTY_LEDGERS.md` §6.
- [x] LIRA-098 guard widened: token scan now `profit|commission`, 4 new verified exclusions, proven
      to fail on an injected ungated commission dummy (both by implementer and independently by the
      completeness reviewer).
- [x] Suites: core 155/1662, backend 38/529, frontend 111/851+1 — full `yarn test` exit 0.

### Adversarial review (2 lenses, both SHIP)

JOIN fan-out **refuted** (exactly one `FINANCIAL_SERVICE`-type transaction writer per fs row; auto
SUPPLIER_PAYMENT sibling and REFUND rows excluded by the `t.type` filter — no double-count possible).
Dropped-rows risk **refuted** (`_markSourceRefunded` sets `is_refunded=1` on both void and refund, so
every row the ACTIVE-join excludes was already excluded by the old `notRefunded` gate).

### Residuals discovered (filed, not silently fixed)

1. → folded into **LIRA-095**'s open questions: the Commission row still counts iPick/Katsh
   `commission > 0` rows that the per-currency sibling routes to Mobile Services (possible
   double-display), and it sums raw `fs.commission` while the sibling sums stamped
   `t.profit_usd/lbp` (USDT currently buckets as USD in the totals row). Provider-set narrowing is
   an owner semantics call, same discussion as the commission-flow redesign.
2. → **LIRA-110** (new): `ClosingRepository.ts:689-696` computes daily fs commission with a THIRD,
   fully ungated sum — not even `is_settled`/`notRefunded`. Same bug class on the closing screen.
3. Flake note for CI: one core run failed 2 suites/3 tests then passed twice on identical code —
   pre-existing parallel-worker flakiness (unrelated modules), a red core run may need one retry.

### Files to Modify

| Layer   | File                                                                    | Change                     |
| ------- | ----------------------------------------------------------------------- | -------------------------- |
| Backend | `packages/core/src/repositories/ProfitRepository.ts`                    | Add gates if confirmed     |
| Backend | `packages/core/src/constants/__tests__/profitRecognition.guard.test.ts` | Optionally widen heuristic |

---


> *(LIRA-099 — Multi-tenant admin/impersonation e2e spec + full-suite proof — moved to the live board, still open)*

---

## LIRA-100: Loto — no in-module ticket reprint UI

| Field                | Value                                                                      |
| -------------------- | -------------------------------------------------------------------------- |
| **Epic**             | Loto                                                                       |
| **Type**             | Feature / Gap                                                              |
| **Priority**         | Low                                                                        |
| **Status**           | DONE (2026-08-08) — e2e LOTO row executed GREEN same day                   |
| **Affected Modules** | Loto                                                                       |
| **Assigned To**      | —                                                                          |
| **Depends On**       | LIRA-069 (DONE — receipt-print gating foundation)                          |
| **Source Plan**      | `docs/plans/todo_plans/PARTIAL_TASKS_COMPLETION_PLAN.md` (W1.c, last item) |

### Summary

Recharge, Maintenance, and Custom Services all got a per-ticket History/reprint entry point when
receipt-print gating shipped (LIRA-069) — Loto didn't. `Loto/index.tsx` has no history/reprint UI
for individual ticket sales; its only history surface, `CheckpointHistory.tsx`, operates on
aggregate checkpoint rows (`total_tickets`, `settlement_id`), not individual tickets. A loto ticket
can only be reprinted today via the general `/audit` Transactions viewer.

### Acceptance Criteria

- [x] Ticket-level History view: new `frontend/src/features/loto/components/TicketHistoryModal.tsx`
      mirroring Recharge's `HistoryModal` UX, self-fetching on mount (like the sibling
      `CheckpointHistory`) since Loto's page holds no preloaded ticket superset. Data path is 100%
      pre-existing dual-mode plumbing — `useApi().loto.getByDateRange` and `getTransactionBySource`,
      zero new adapter/REST/IPC code, zero raw `window.api` in the component (grep-verified).
- [x] Rows gated per-row by `isReceiptableRow({ type: "LOTO" })` — the canonical predicate.
- [x] Transaction resolved via the dual-mode `getTransactionBySource("loto_tickets", ticketId)` →
      `TransactionRepository.getBySourceId`; print via the shared `printServiceReceiptByTransaction`.
- [x] Component test (3 cases incl. gate-wiring proof; rule 17: bypassing the gate with `|| true`
      made exactly the hide-assertion fail) + lira-069 e2e spec extended with a LOTO row.
      **Executed 2026-08-08: PASSED** — lira-069 ran 3/3 green including the LOTO row, in the same
      4/4 desktop run that proved LIRA-102's spec.
- [x] Frontend tests 3/3, typecheck clean, playwright tsc adds zero new errors (re-run independently).

### Files to Modify

| Layer    | File                                              | Change                          |
| -------- | ------------------------------------------------- | ------------------------------- |
| Frontend | `frontend/src/features/loto/pages/Loto/index.tsx` | Ticket-level History/reprint UI |

---


> *(LIRA-101 — Primary Cash Drawer cleanup + settleNetPayUsd verification — moved to the live board, still open)*

---

## LIRA-102: Session grouping UI — missing e2e coverage

| Field                | Value                                                                        |
| -------------------- | ---------------------------------------------------------------------------- |
| **Epic**             | Customer Sessions / Transactions                                             |
| **Type**             | Test                                                                         |
| **Priority**         | Low                                                                          |
| **Status**           | DONE (2026-08-08) — spec `0579942`, executed GREEN same day                  |
| **Affected Modules** | Transactions (Audit)                                                         |
| **Assigned To**      | —                                                                            |
| **Depends On**       | —                                                                            |
| **Source Plan**      | `docs/plans/todo_plans/session-basket-payment-remaining.md` (#3a, last item) |

### Summary

The per-session border-accent feature itself shipped and is unchanged (`TransactionsViewer.tsx`'s
`sessionHue`/`data-session`, `index.css`'s dark/light accent colors) — only the e2e spec the plan
called for was never written. `lira-session-grouping-ui.spec.ts` does not exist (confirmed: never
created, not deleted).

### Acceptance Criteria

- [x] `frontend/tests/e2e-electron/lira-session-grouping-ui.spec.ts`: checkout 2 custom-service
      items in one session → assert both rows expose `data-session=""` and share the same
      `--session-hue` (`round(abs(id * 137.508)) % 360`) → toggle dark mode → assert
      `border-left-color` changes (62% dark / 42% light) while hue holds. Match rows by unique
      label (rule 15), never `tbody tr.first()`.
      **Executed 2026-08-08: PASSED (2.4s), in a 4/4 run alongside lira-069 + its new LOTO row.**
      All three first-run risks flagged in the spec header (numeric CSS custom-property
      pass-through, HSL→RGB probe comparison, theme-toggle localStorage leakage) held.
- [ ] `session-basket-payment-remaining.md` has nothing left — move to `done_plans/` (pending).

### Files to Modify

| Layer | File                                                                 | Change   |
| ----- | -------------------------------------------------------------------- | -------- |
| E2E   | `frontend/tests/e2e-electron/lira-session-grouping-ui.spec.ts` (new) | New spec |

---

## LIRA-103: Recharge — close remaining REST-parity gaps (history route + unmigrated drawer-balances call)

| Field                | Value                                                                         |
| -------------------- | ----------------------------------------------------------------------------- |
| **Epic**             | Recharge / Web Parity                                                         |
| **Type**             | Bug / Dual-Transport                                                          |
| **Priority**         | Medium                                                                        |
| **Status**           | DONE (2026-08-08) — web spec executed GREEN same day; found residual LIRA-109 |
| **Affected Modules** | Recharge                                                                      |
| **Assigned To**      | —                                                                             |
| **Depends On**       | —                                                                             |
| **Source Plan**      | `docs/plans/todo_plans/WEB_PARITY_ROADMAP.md` (§9, Recharge items)            |

### Summary

Recharge's transfer/top-up endpoints already went dual-mode (carrier-lines waves, 2026-08-06/07),
but two spots still call raw `window.api.recharge.*` with no REST backing:

1. **History has no REST route at all**: `Recharge/index.tsx:673` calls
   `window.api.recharge.getHistory(activeProvider)` for the MTC/Alfa history tab. No `/history`
   route exists in `backend/src/api/recharge.ts`, no wrapper in `backendApi.ts`/`ElectronApiAdapter.ts`.
   Degrades to a silently-empty history list in a real browser (wrapped in try/catch) rather than
   crashing — a real data gap, not a crash.
2. **Leftover unmigrated call site in the SAME file**: `Recharge/index.tsx:391-400`
   (`loadDrawerBalances`) still calls raw `window.api.recharge.getDrawerBalances()` even though a
   working dual-mode twin, `api.getRechargeDrawerBalances()`, already exists and is used elsewhere
   in this same file (`handleTopUpClick:753`) — this call site was simply never switched over. The
   `line 392` comment ("Drawer balances are IPC-only") is stale.

### Acceptance Criteria

- [x] `GET /api/recharge/history` route (validated via new `getRechargeHistorySchema`, required
      `provider: z.enum(["MTC","Alfa"])` — first schema for this endpoint, the IPC handler has none
      to lift) + `getRechargeHistory` wrapper in `backendApi.ts`/`ElectronApiAdapter.ts`/`ApiAdapter`
      types. **Auth parity verified in source**: `recharge:get-history` has NO `requireRole`
      (rechargeHandlers.ts:36-40), so the REST route is likewise not role-gated (router-level
      `authenticateJWT` only) — same documented rationale as the sibling `/stock` route; gating web
      would make it stricter than desktop.
- [x] `loadDrawerBalances` switched to the existing `api.getRechargeDrawerBalances()`; the
      `if (!window.api?.recharge) return;` guard and stale "IPC-only" comment deleted.
- [x] Web e2e: `lira-web-020-recharge-history-drawer-balances.spec.ts` — seeds via
      `POST /api/recharge/process`, drives the real page, asserts drawer stat + history modal.
      **Executed 2026-08-08: both tests PASSED** in a full 59/59 `test:e2e:web` run.
- [x] Rule 17: new component test (adapter-mocked, zero `window.api`) observed failing 2/2 pre-fix,
      passing post-fix. Backend +5 route tests. Full `yarn test` exit 0 on the combined tree:
      backend 38/521, frontend 110/849+1, core 154/1658.

### Outcome note

A THIRD unmigrated raw call was found in the same feature during the sweep —
`TelecomForm.tsx:~1198` `window.api.recharge.updateMetadata` (history-edit path). Out of this
ticket's named scope; filed as **LIRA-109** so it doesn't vanish.

### Files to Modify

| Layer    | File                                                          | Change                                |
| -------- | ------------------------------------------------------------- | ------------------------------------- |
| Backend  | `backend/src/api/recharge.ts`                                 | Add `/history` route                  |
| Frontend | `frontend/src/api/backendApi.ts`, `.../ElectronApiAdapter.ts` | `getRechargeHistory` wrapper          |
| Frontend | `frontend/src/features/recharge/pages/Recharge/index.tsx`     | Both call sites switched to dual-mode |

---

## LIRA-115: Refunding a session-basket item never returns the customer's cash (live money loss)

| Field                | Value                              |
| --------------------- | ------------------------------------ |
| **Epic**              | Transactions / Sessions               |
| **Type**              | Bug (money loss)                      |
| **Priority**          | **HIGH — live money**                 |
| **Status**            | **FIX IMPLEMENTED (option (a)) — pending e2e + orchestrator review/commit** |
| **Affected Modules**  | Transactions, Customer Sessions, Financial Services |
| **Assigned To**       | —                                      |
| **Depends On**        | —                                      |
| **Source Plan**       | Owner report 2026-08-08, reproduced   |

### Summary

Owner: *"Refund of a service txn where customer paid 1010$, cost 1008$, is adding back into drawer
1008$ not 1010$."* **Reproduced.** Fires only when the item was sold through a **session basket**
(customer cart) — the direct single-item sale path is correct
(`TransactionRepository.refundCostPriceFlow.test.ts` proves it).

Mechanism:
- At sale time the **cost leg** is written with `transaction_id = <item's own txn id>`.
- The **customer's cash leg** is deliberately skipped for basket items (`deferPayment`) and written
  later by `SessionPaymentService.recordBasketPayment` → `insertSessionLeg` with
  **`transaction_id = NULL`, `session_id = <basket session>`** — pooled across every item in the
  basket.
- `_reversePayments` queries **only** `WHERE transaction_id = ?`. It finds the cost leg, reverses
  $1008 into the provider drawer, and never sees the customer's $1010. **General is untouched.**

**Worse than reported: `voidTransaction` has the identical hole and no warning modal** — the
frontend at least half-knows (`TransactionsViewer.handleRefund` detects `session_id` and skips part
of the flow); void has nothing.

### Design decision required (not a patch)

When one item of a multi-item basket is refunded, which item owns the pooled cash? The codebase's
own precedent for this class (split-group checkouts, `_assertReversible` + `voidCheckoutGroup`) is
to **refuse the per-item reversal and require a group-level one**.

- [x] **Recommended (a) — IMPLEMENTED**: gate session-linked rows out of per-item refund/void with a
      clear message, and route to a basket-level reversal — mirrors the split_group precedent, lowest
      risk.
- [ ] (b): implement true per-item reversal of a pooled payment (proportional reallocation) — a real
      accounting design, materially more work. Not built (a) was chosen).

### Fix implemented (2026-08-09)

- `TransactionRepository._assertReversible` gained a session-basket check, shaped exactly like the
  existing `split_group` check immediately above it (rule 14): any row linked via
  `customer_session_transactions.unified_transaction_id` now hard-refuses a bare
  `voidTransaction`/`refundTransaction` with `"This transaction is part of session basket #N;
  void/refund the whole basket instead."` — before any write (the throw is before
  `this.transaction()` opens).
- New repository methods `voidSessionBasket(sessionId, userId)` and
  `refundSessionBasket(sessionId, userId)` are the basket-level route: they loop every item linked to
  the session via the EXISTING per-item reversal (`_voidTransactionInternal`/
  `_refundTransactionInternal` with a new `allowSessionMember: true` bypass) — so every module-specific
  side effect (cost/provider-drawer leg, profit stamp, carrier-line movements, supplier-ledger
  siblings, partner ledger) is reversed exactly the way a normal single-item void/refund already
  does, nothing reimplemented — PLUS two new steps that only run ONCE for the whole basket:
  `_reverseSessionPooledPayments` (negates the pooled `payments` row(s), `transaction_id IS NULL,
  session_id = ?`) and `_cancelSessionDebt` (negates the pooled `debt_ledger` `'Session Debt'` row —
  closes the gap `transactionTypes.ts`'s own doc comment named but never implemented: *"reversed by
  the session flow, not the generic path"* — that flow now exists). A `_assertSessionBasketReversible`
  up-front guard refuses a second call on an already-reversed basket (idempotency without
  double-reversal risk).
- Regression test file (now tracked — see rule 17/.gitignore note below):
  `TransactionRepository.refundSessionBasketCostPriceFlow.test.ts` — 8 tests: the original SANITY
  case: two "refused" tests (void + refund) proving the guard fires and nothing partial persists;
  a nets-to-zero proof for `refundSessionBasket` (drawer + profit, CASH-paid basket); a
  CUSTOMER_ACCOUNT variant proving `_cancelSessionDebt` nets the pooled debt to 0 (the owner's
  literal payment method, General never touched); a `voidSessionBasket` parity test; a double-call
  idempotency-refusal test; and a 2-item basket test proving the pooled leg is reversed EXACTLY ONCE,
  not once per item.
- **Known gap, named on purpose (not silently dropped)**: `voidSessionBasket`/`refundSessionBasket`
  are NOT yet wired to IPC/REST/a frontend button — building that blind (this pass could not run
  `yarn dev`/e2e/launch Electron to verify a new UI flow) risked shipping an unverifiable new surface.
  `TransactionsViewer.tsx` now HIDES the per-item Void/Refund buttons for any session-basket row
  (mirrors the split_group button-hiding treatment) and shows an explanatory label ("Basket item —
  see admin to reverse") instead of a button that would just surface the guard's error after a click.
  Today an admin can still reverse a basket via a REPL/console call to the new repository methods;
  wiring a real "Void/Refund entire basket" button (IPC handler + REST route + preload/adapter
  binding + UI) is the explicit follow-up, same shape as `voidCheckoutGroup`'s existing wiring.
- **Also a known, pre-existing, NOT-newly-introduced gap**: if an item was refunded through the OLD
  buggy per-item path *before* this fix shipped, its pooled cash is already lost and this fix does
  not retroactively recover it (no backfill was attempted — out of scope for "stop further loss").

### Acceptance Criteria

- [x] Failing-first test (rule 17) reproducing 1010/1008 through the session-basket path — the
      pre-existing untracked repro (adapted into the "FIXED" suite above; observed failing against
      the pre-fix code via `git stash`, both as a TS compile error — the new API doesn't exist yet —
      and, with only the guard line disabled, as a runtime assertion failure on the two refusal tests).
- [x] Rule 20: create + reverse nets to **0 per drawer per currency** for the chosen path (drawer +
      profit + debt_ledger all proven in the test file above).
- [x] **`voidTransaction` gets the same treatment as `refundTransaction`** — both gated identically,
      both proven.
- [ ] e2e on both transports — NOT run this pass (explicitly out of scope per this task's own
      instructions: no `yarn dev`/`test:e2e`/`test:e2e:web`). The hidden-button frontend change has
      no e2e coverage yet either.

### Files Modified

| Layer   | File                                                     | Change                          |
| ------- | ------------------------------------------------------------ | ---------------------------------- |
| Backend | `packages/core/src/repositories/TransactionRepository.ts` | Session-aware refund/void gating + `voidSessionBasket`/`refundSessionBasket` |
| Tests   | `packages/core/src/repositories/__tests__/TransactionRepository.refundSessionBasketCostPriceFlow.test.ts` | Now tracked (removed from `.gitignore`); 8 tests |
| Frontend| `frontend/src/features/audit/pages/TransactionsViewer.tsx` | Hide per-item Void/Refund buttons on session-basket rows, explain why |

---


> *(LIRA-113, 114, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130 — all closed or opened on 2026-08-12 (today) or still genuinely open — moved to current_sprint.md: LIRA-114 is open (live board); the rest were closed today and live in the "Recently Closed" section)*

---

## DECISION LOG: partner-mode derivation — designed, then cancelled (2026-08-10)

**Not a ticket. Recorded so it is not rebuilt.**

A change to derive THROUGH-vs-FOR partner mode from `partners.system_association` (instead of the
hardcoded `partnerMode: "THROUGH"` on the OMT/Whish services page) was scoped, dispatched, and then
**stopped by the owner mid-build and reverted**. Nothing shipped.

**Why it was wrong:** the mismatch it fixes is unreachable. That page's partner selector only renders
on the matching tab and passes `systemFilter={partnerSystem}`, and `PartnerSelector` filters
`p.system_association === systemFilter` — so a Syria-associated partner is **unselectable** on a Whish
transaction. The hardcode is correct by construction.

Syria partners are served through **Custom Services**, which is typed `partnerMode?: "FOR"` and is
already on-behalf. THROUGH is representable in exactly ONE repository; every other partner-aware module
is FOR-only. The owner's rule is therefore already satisfied everywhere with no derivation.

**What was done instead:** the invariant is now documented at the send + consume sites and guarded by an
interaction test, because the coupling was invisible — the hardcode is only safe while that selector
stays system-filtered, and LIRA-127 (`5980180`) had just fixed a case where it wasn't.

**Process lesson:** the rule was reasoned about abstractly without checking whether bad input was
reachable through the UI. Check reachability before building enforcement.

---


> *(LIRA-131 — closed today 2026-08-12, lives in the "Recently Closed" section of current_sprint.md. LIRA-117 and LIRA-116 are both still genuinely open — moved to the live board.)*

---

## LIRA-112: iPick bills must book NO commission (only Katsh pays) — corrects shipped behavior

| Field                | Value                              |
| --------------------- | ------------------------------------ |
| **Epic**              | Suppliers / Recharge                  |
| **Type**              | Bug (pre-existing, carried forward)   |
| **Priority**          | **High** (wrong money on the supplier ledger) |
| **Status**            | DONE (2026-08-09, `be4143c`) — v151, e2e 252/252 |
| **Affected Modules**  | Recharge > iPick/Katsh, Suppliers     |
| **Assigned To**       | —                                      |
| **Depends On**        | LIRA-089 (DONE)                       |
| **Source Plan**       | Owner correction 2026-08-08 (COMMISSION_AT_SETTLEMENT_PLAN §6 D12) |

### Summary

Owner: **iPick bills earn the shop NO commission. Katsh bills earn 20,000 LBP per bill.**

Both the pre-plan code and shipped Phase 1 treat the two providers identically:
- Legacy booking: `Auto: BILL commission from ${data.provider}` fired for ANY bill provider
  (`FinancialServiceRepository.ts:~3337`) — so **iPick has been credited 20,000 LBP per bill it
  never earned**, inflating the iPick supplier balance in the shop's favour.
- Phase 1: `commission_model = data.serviceType === "BILL" ? 1 : 0` (`:1046`) — no provider check,
  so iPick bills now also join the commission settlement queue.

Neither is correct. This is a pre-existing bug we carried forward, not a Phase 1 regression — but
Phase 1 is the right place to fix it since the machinery now exists.

### Target behavior

- **Katsh**: bills join the settlement queue; the Suppliers settle screen shows an **estimated
  commission of 20,000 LBP × bills sold** (this is exactly the RATE × count mode Phase 0 built —
  drive it from the supplier's stored preference rather than a hardcode).
- **iPick**: bills book **no commission at all**, at creation or settlement, and do not appear in
  the commission settlement queue.
- Make it **data-driven**, not a provider name hardcoded in a repository: use the v150
  `suppliers.commission_entry_mode` / `commission_rate` columns (Katsh → RATE @ 20,000; iPick →
  none). Note `commission_rate` was specced as USD — bills are LBP, so a rate **currency** is
  needed (extra column or a documented convention). Rule 14: one definition of "does this supplier
  pay commission".

### Acceptance Criteria

- [ ] Failing-first test (rule 17): an iPick bill books zero commission rows at creation AND is
      absent from the unsettled commission queue; a Katsh bill does both.
- [ ] Settle screen prefills Katsh's estimate = 20,000 LBP × bill count, from stored config.
- [x] Historical iPick credits: **owner decided 2026-08-08 — LEAVE THEM.** ("Historical ipick leave
      them i dont care.") No backfill, no correcting migration, no reporting task. Consistent with
      the D3 cutover principle: history keeps the old model, the fix applies forward only. Do NOT
      let a future review re-open this as an unfinished data-integrity item.
- [ ] Full suites + desktop/web e2e green; extend `lira-089` / `lira-web-021` with an iPick case.

### Files to Modify

| Layer    | File                                                          | Change                        |
| -------- | ---------------------------------------------------------------- | -------------------------------- |
| Backend  | `packages/core/src/repositories/FinancialServiceRepository.ts` | Provider-aware commission gating |
| Backend  | `packages/core/src/db/migrations/index.ts` + `create_db.sql`   | Rate currency + Katsh/iPick seed |
| Frontend | `frontend/src/features/suppliers/pages/Suppliers/index.tsx`    | Estimated-commission prefill     |

---


## LIRA-111: 8 e2e specs navigate to `/audit` without the documented remount bounce

| Field                 | Value                              |
| --------------------- | ------------------------------------ |
| **Epic**              | Test infrastructure                   |
| **Type**              | Latent flake / hygiene                |
| **Priority**          | Low                                   |
| **Status**            | **DONE** `6949bc1` (corrected 2026-08-12 — this detail block was stale "TODO"; the Sprint 6 board 350 lines below it already said DONE) |
| **Affected Modules**  | e2e suite                             |
| **Assigned To**       | —                                      |
| **Depends On**        | —                                      |
| **Source Plan**       | Found while shipping Phase 0+1 (2026-08-08) |

### Summary

The app uses **hash routing**: `navigateTo("/audit")` while the app is ALREADY parked on `/audit`
fires no `hashchange`, so `AuditPage`/`TransactionsViewer` never remounts and the table keeps
showing whatever it fetched on its first visit. `frontend/tests/e2e-electron/README.md:26-27`
documents the fix — bounce `navigateTo("/")` → `navigateTo("/audit")`.

These 8 specs navigate to `/audit` WITHOUT the bounce and pass today only because nothing currently
running before them leaves the app parked there:

`lira-063-omt-whish-optional-client`, `lira-064-payment-legs-summary`,
`lira-073-datatable-export-columns`, `lira-087-currency-by-date`, `lira-092-supplier-payment-void`,
`lira-104-refund-account-debt`, `lira-124-split-void-group`, `lira-transactions-timezone`

**Risk is now higher than before**: `lira-session-grouping-ui.spec.ts` (added 2026-08-08 for
LIRA-102) ends its test still parked on `/audit`, which is exactly what exposed this in
`lira-transactions-hidden-types` and cost three agent rounds to root-cause (it presents as
"the row exists in the DB but isn't rendered" — no error, just an absent row).

### Acceptance Criteria

- [x] Add the documented `/` bounce to all 8 specs (one line each).
- [x] Consider the systemic fix instead/additionally: either have `navigateTo` detect a same-route
      call and force a remount, or add an `afterEach` that parks the app on `/` so no spec can leave
      a stale viewer for its neighbour.
- [x] Full desktop e2e still 252/252.

### Correction (2026-08-12, per `docs/plans/todo_plans/SPRINT_INVENTORY_2026-08-12.md` §4.2)

This ticket's own detail block above still read `TODO` while the Sprint 6 board (same file,
~350 lines below) already said DONE — same file contradicting itself, not a cross-file collision.

- `6949bc1` ("feat(backend): REST write routes now record an audit trail (LIRA-104) + /audit spec
  hygiene (LIRA-111)") adds the documented `/` remount bounce to all 8 named specs.
- `24cead2` ("docs(plan): LIRA-104 + LIRA-111 verified green (desktop e2e 252/252)") is the proof run.

---

> *(LIRA-110 — Daily closing sums financial-services commission with ZERO gates — moved to the live board, still open)*

---

## LIRA-109: Recharge — `updateMetadata` still raw `window.api` (history-edit path)

| Field                | Value                                              |
| -------------------- | -------------------------------------------------- |
| **Epic**             | Recharge / Web Parity                              |
| **Type**             | Bug / Dual-Transport                               |
| **Priority**         | Low                                                |
| **Status**           | DONE (2026-08-08) — web e2e executed green (60/60) |
| **Affected Modules** | Recharge                                           |
| **Assigned To**      | —                                                  |
| **Depends On**       | —                                                  |
| **Source Plan**      | Found during LIRA-103 (2026-08-08)                 |

### Summary

`TelecomForm.tsx` (~line 1198, `onUpdateMetadata` handler for the history modal's edit feature)
still calls raw `window.api.recharge.updateMetadata` — the third and last unmigrated recharge call
site after LIRA-103 fixed history + drawer-balances. In a browser, editing a history row's metadata
silently fails. Same fix shape as LIRA-103: mirror the IPC handler as a REST route (check its
roles!), dual-mode wrapper, adapter type, switch the call site (rule 19).

### Acceptance Criteria

- [x] REST route `POST /api/recharge/update-metadata`: `requireRole(["admin","staff"])` matching
      the IPC handler verbatim; `editedBy` derived from the JWT username, never the body (a test
      sends a spoofed `editedBy` and asserts it's ignored); IPC-identical envelope.
- [x] **Second finding confirmed and fixed on BOTH transports**: the IPC handler had NO Zod
      validation (raw typed arg trusted verbatim). One shared `updateRechargeMetadataSchema`
      (`validators/recharge.ts`) now feeds `validatePayload` (IPC) and `validateRequest` (REST) —
      rules 14 + 19b, closed in one move rather than validating only the new route.
- [x] Dual-mode wrapper + adapter + `ApiAdapter` type; `TelecomForm.tsx` call site switched
      (one-line swap — the adapter was already in scope).
- [x] Rule 17 component test (2 tests, observed failing pre-fix); lira-web-020 extended with the
      edit path — **executed 2026-08-08: 60/60 web suite green** (59 + the new case).
- [x] The ticket's predicted `phone_number`/`client_phone` mismatch was a false alarm — the
      `client_phone` naming belongs to the SALES module's own updateMetadata; the recharge chain
      agrees on `phone_number` at all four layers (checked, not assumed).

> Note: `electron-app/` source changed (handler + schemas) — the next DESKTOP e2e session needs its
> usual `yarn dev` rebuild first or the old dist runs. No existing desktop spec exercises this path
> (grep-verified), so nothing needed re-running today.

### Files to Modify

| Layer    | File                                                        | Change                    |
| -------- | ----------------------------------------------------------- | ------------------------- |
| Backend  | `backend/src/api/recharge.ts`                               | Add update-metadata route |
| Frontend | `frontend/src/api/backendApi.ts`, `ElectronApiAdapter.ts`   | Dual-mode wrapper         |
| Frontend | `frontend/src/features/recharge/components/TelecomForm.tsx` | Switch call site          |

---


## LIRA-104: Web-mode REST write routes create no audit trail

| Field                | Value                                              |
| -------------------- | -------------------------------------------------- |
| **Epic**             | Web Parity / Security                              |
| **Type**             | Design / Feature                                   |
| **Priority**         | Medium                                             |
| **Status**           | **DONE** `6949bc1` (corrected 2026-08-12 — this detail block was stale "TODO"; the Sprint 6 board 350 lines below it already said DONE) |
| **Affected Modules** | All web-migrated modules                           |
| **Assigned To**      | —                                                  |
| **Depends On**       | —                                                  |
| **Source Plan**      | `docs/plans/todo_plans/WEB_PARITY_ROADMAP.md` (§9) |

### Summary

Every Electron IPC handler that writes money/state calls the audit logger — 31 handler files call
`audit(...)`. Zero REST routes do (`grep audit( backend/src/api/*.ts` → 0 matches across every
migrated module: loto, sessions, holdMoney, servicePresets, sales, recharge, …). A web-mode write
today leaves no audit trail at all. Needs a design decision on where/how REST audit entries should
be recorded (same `audit()` call reused from `req.user`? a middleware wrapper?) before broad
implementation — flagging as TODO rather than NEEDS INTERVIEW since the shape of the fix is fairly
standard, but the rollout touches every REST route file.

### Acceptance Criteria

- [x] Design: how REST routes record audit entries (reuse the existing `audit()` helper, sourcing
      the actor from `req.user` instead of an IPC-side `auth.userId`).
- [x] Applied consistently across every REST write route.
- [x] Test asserting a REST write produces the same audit entry shape an equivalent IPC call would.

### Files to Modify

| Layer   | File                                      | Change                    |
| ------- | ----------------------------------------- | ------------------------- |
| Backend | `backend/src/api/*.ts` (all write routes) | Add audit-trail recording |

### Correction (2026-08-12, per `docs/plans/todo_plans/SPRINT_INVENTORY_2026-08-12.md` §4.2)

This ticket's own detail block above still read `TODO` while the Sprint 6 board (same file,
~350 lines below) already said DONE.

- `6949bc1` ("feat(backend): REST write routes now record an audit trail (LIRA-104) + /audit spec
  hygiene (LIRA-111)") wires ~92 audit call sites across 31 REST route files.
- `24cead2` ("docs(plan): LIRA-104 + LIRA-111 verified green (desktop e2e 252/252)") is the proof run.

---
## LIRA-105: Payment-method unknown-code fallback disagrees between `payments.ts` and `PaymentMethodRepository`

| Field                | Value                                                                 |
| -------------------- | --------------------------------------------------------------------- |
| **Epic**             | Payments (shared)                                                     |
| **Type**             | Bug (latent)                                                          |
| **Priority**         | Low                                                                   |
| **Status**           | DONE (2026-08-08, `c9f2262` + regression fix `6f74cfd`)               |
| **Affected Modules** | Payments (shared utility)                                             |
| **Assigned To**      | —                                                                     |
| **Depends On**       | —                                                                     |
| **Source Plan**      | `docs/plans/todo_plans/BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md` (§2 bug 8) |

### Summary

`packages/core/src/utils/payments.ts`'s `isDrawerAffectingMethod`/`isNonCashDrawerMethod` treat an
unregistered payment-method code as drawer-affecting (`true`) when `getByCode()` returns null;
`PaymentMethodRepository.isDrawerAffecting` treats the same case as `false`. Exposure is currently
latent only — no code path can create an unregistered method code today (the retired `"FEE"`
literal that used to trigger this was removed) — but the two predicates disagree and should be
reconciled before that changes.

### Acceptance Criteria

- [x] Pick one semantics for an unregistered method code (matched the repository, `false`) and align
      both predicates — defined ONCE as `UNREGISTERED_METHOD_IS_DRAWER_AFFECTING` (rule 14).
- [x] Test proving the two predicates now agree for an unregistered code (5 new tests; the 3
      agreement assertions were observed FAILING pre-fix per rule 17).

### Outcome — this was more than a consistency cleanup

Reviewing the call sites showed `false` is not merely the _consistent_ choice but the **safer** one:
the permissive `true` fallback let an unregistered code fall through to
`paymentMethodToDrawerName`'s own unknown-code default (`FALLBACK_DRAWER_MAP[method] ?? "General"`),
silently posting real money into the General drawer for a code nobody configured. All ~40 call sites
across every money repository were reviewed — each either skips to a debt branch on `false` or throws;
none relied on `true` to post a legitimate drawer movement.

Exposure was confirmed latent (verified by grep, not assumed): the retired `"FEE"` literal is gone
(owner decision #9) and the `"MULTI"` sentinel is hard-rejected in `RechargeRepository.processRecharge`
before reaching these functions. The DB-_unavailable_ `catch` fallback is deliberately untouched and
still uses the hardcoded map, so the `SessionPaymentService.basket` tests that omit the
`payment_methods` table on purpose keep passing.

**Residual (not blocking, worth a follow-up):** every Zod leg schema types `method` as a free
`z.string().min(1)` with no enum restricting it to registered codes, so a bogus method string can
still reach the repositories from an external caller. Pre-existing and orthogonal — and this fix makes
that scenario safer (reject/no-op instead of a silent post to General) rather than worse.

### Regression + fix (`6f74cfd`) — read this before touching `payments.ts` again

The first attempt (`c9f2262`) was verified against the **core** suite only, and broke
`backend/src/__tests__/core_payments.test.ts`. The lesson is not "run more tests" but **what** the
failure exposed: `c9f2262` split two cases that had always shared one return path — "DB unavailable"
(the `catch`) and "DB reachable but no row" — and sent the latter to `false`. A canonical method's row
can legitimately be missing while the DB is fine:

1. `TenantRepository.seedPaymentMethods()` seeds OMT/WHISH/BINANCE with `is_system = 0` — **deletable
   per tenant.** A shop deleting its OMT method would have silently stopped crediting the `OMT_App`
   drawer. Real money.
2. `backend/jest.config.cjs` mocks better-sqlite3, so `getByCode()` resolves `undefined` for every
   code and the `catch` path is never reached in that workspace.

Fix: `CANONICAL_METHODS` (derived from `FALLBACK_DRAWER_MAP` keys ∪ `NON_DRAWER_METHODS`, so it can't
drift). "Reachable but no row" returns `false` ONLY for a non-canonical code; a canonical one falls
through to the hardcoded-map answer. `core_payments.test.ts` was deliberately left **unmodified** —
its expectations were right all along, and editing it would have buried the bug.

Full `yarn test` after, exit 0: backend 38/38 · 516 tests, frontend 107/107 · 843+1 skipped,
core 153/153 · 1654 tests.

### Files to Modify

| Layer   | File                                                        | Change                      |
| ------- | ----------------------------------------------------------- | --------------------------- |
| Backend | `packages/core/src/utils/payments.ts`                       | Align fallback semantics    |
| Backend | `packages/core/src/repositories/PaymentMethodRepository.ts` | Reference point for the fix |

---

## LIRA-106: Recharge — provider-tab switch doesn't reset stale crypto fields

| Field                | Value                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------- |
| **Epic**             | Recharge / Binance                                                                      |
| **Type**             | Bug (UI hygiene, no money risk)                                                         |
| **Priority**         | Low                                                                                     |
| **Status**           | DONE (2026-08-08, `0c910cd`) — scope widened, see Outcome                               |
| **Affected Modules** | Recharge > Binance                                                                      |
| **Assigned To**      | —                                                                                       |
| **Depends On**       | —                                                                                       |
| **Source Plan**      | `docs/plans/todo_plans/BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md` (adversarial-review finding) |

### Summary

`Recharge/index.tsx`'s `useEffect` keyed on `[activeProvider]` (~line 317) resets several
provider-specific fields on a tab switch but touches zero `crypto*` state
(`cryptoFeeCollectedSeparately`, `cryptoFeePaymentLines`, `cryptoAmount`, `cryptoFeeIncluded`). A
stale Binance selection can carry across a provider-tab switch or SEND↔RECEIVE flip until the next
successful submit (which does clear them). No money-correctness risk — a real submit still clears
state correctly — but it's a UI-hygiene gap worth closing.

### Acceptance Criteria

- [x] The tab-switch reset effect also clears the `crypto*` fields — **all 13**, not just the 4 this
      ticket originally named (see Outcome).
- [x] Component test: switch away from Binance mid-edit, switch back, assert fields are reset
      (5 assertions, all observed FAILING pre-fix per rule 17).

### Outcome — this ticket under-specified its own fix

The ticket named 4 fields (`cryptoAmount`, `cryptoFeeIncluded`, `cryptoFeeCollectedSeparately`,
`cryptoFeePaymentLines`). Reviewing the first pass against the two crypto submit paths
(`index.tsx:1148-1160` mode-C early return, `:1242-1254` main submit) showed those paths reset **13**
fields — so 9 were still surviving a tab switch, and they carry **higher** stakes than the 4 named:

- `cryptoPaymentLines`, `cryptoReturnLegs`, `cryptoKeptChange` — money-leg state
- `cryptoClientId`, `cryptoClientName`, `cryptoClientPhone` — a stale `client_id` could attribute the
  next crypto transaction to the **wrong client** (rule 11 territory)
- `cryptoFee`, `cryptoDescription`, `cryptoTransactionTime`

All 13 now reset, using the submit paths' exact values. `cryptoType`/`cryptoPaidBy`/`cryptoTenderRate`
are deliberately left sticky — neither submit path resets them either.

Recharge module suite after: 23 suites / 146 tests (143 baseline + 3 new).

### Files to Modify

| Layer    | File                                                      | Change                         |
| -------- | --------------------------------------------------------- | ------------------------------ |
| Frontend | `frontend/src/features/recharge/pages/Recharge/index.tsx` | Extend tab-switch reset effect |

---

## LIRA-107: Recharge — SEND↔RECEIVE flip resets nothing (CLOSED — WON'T DO)

| Field                | Value                                         |
| -------------------- | --------------------------------------------- |
| **Epic**             | Recharge / Binance                            |
| **Type**             | Design question                               |
| **Priority**         | Low                                           |
| **Status**           | CLOSED — WON'T DO (owner decision 2026-08-08) |
| **Affected Modules** | Recharge > Binance                            |
| **Assigned To**      | —                                             |
| **Depends On**       | LIRA-106 (DONE)                               |
| **Source Plan**      | Found while reviewing LIRA-106 (2026-08-08)   |

### Owner decision — NO

Asked whether flipping SEND↔RECEIVE should clear the crypto form. Owner answered **no** (2026-08-08).
A direction flip keeps the operator's in-progress entry; only a **provider-tab** switch clears it
(LIRA-106). No `cryptoType`-keyed reset effect will be added.

**Do not "fix" this later as if it were an oversight** — the asymmetry between the provider-switch
reset and the direction flip is intentional and owner-confirmed. A future adversarial review that
re-flags it should be pointed at this decision.

### Summary

LIRA-106's summary named two triggers for stale crypto state: a provider-tab switch **and** a
SEND↔RECEIVE flip. Only the first is now fixed. The reset effect is keyed on `[activeProvider]`, and
there is **no `cryptoType`-keyed reset effect anywhere in the file** (verified by grep) — so flipping
direction mid-edit resets nothing at all.

### The question that was asked (kept for the record)

Should flipping SEND↔RECEIVE clear the crypto form? A UX trade-off, not a correctness bug:

- **Clear it** — matches the "direction change means a different transaction" reading; legs entered
  under SEND semantics are arguably wrong for RECEIVE (opposite money flow: SEND wallet−/General+,
  RECEIVE wallet+/General−).
- **Keep it** — an operator who flips direction just to check something doesn't lose their entry.
  ← **owner chose this**

---


> *(LIRA-137 — closed today 2026-08-12, lives in the "Recently Closed" section of current_sprint.md. LIRA-138 is still genuinely open — moved to the live board.)*

---

## Summary (Sprint 6 — LIRA-098..138)

> **Header range corrected 2026-08-12** (per `docs/plans/todo_plans/SPRINT_INVENTORY_2026-08-12.md`
> §4.6) — originally read `LIRA-098..107`, written early in the sprint and never widened as ~30 more
> tickets were added to the board below. The Priority/Done/Remaining counts below are the
> **original, un-recomputed snapshot** from when this summary was last edited (before LIRA-110..138
> existed) — kept verbatim as a historical artifact; the true final disposition of every Sprint 6
> ticket is in the board immediately below and in `docs/plans/todo_plans/SPRINT_INVENTORY_2026-08-12.md`.

| Priority  | Total  | Done  | Closed (won't do) | Remaining |
| --------- | ------ | ----- | ----------------- | --------- |
| Medium    | 7      | 3     | 0                 | 4         |
| Low       | 6      | 5     | 1                 | 0         |
| **Total** | **13** | **8** | **1**             | **4**     |

> All e2e proof EXECUTED (2026-08-08): desktop targeted run 4/4 (LIRA-102 spec + lira-069 with the
> LIRA-100 LOTO row), web suite 59/59 then 60/60 after LIRA-109's edit case. Every Low ticket in
> Sprint 6 is now resolved. Remaining open (all Medium): LIRA-099, 101, 104, 108.

> LIRA-102's spec is **written and committed but never executed** — running it needs the
> `yarn dev` → stop → `yarn test:e2e` sequence, which the owner runs. It stays TODO until it has
> actually passed once; a spec that has never run proves nothing.

### Sprint 6 board

| ID       | Title                                                    | Priority | Status                                                    | Source Plan                         |
| -------- | --------------------------------------------------------- | -------- | --------------------------------------------------------- | ------------------------------------ |
| LIRA-098 | Profit-recognition guard test                            | Medium   | DONE `e6e3747` (found LIRA-108)                           | COUNTERPARTY_CONSOLIDATION_PLAN.md  |
| LIRA-099 | Multi-tenant admin/impersonation e2e + full-suite proof  | Medium   | TODO — still open, see current_sprint.md live board       | MULTI_TENANT_IMPLEMENTATION_PLAN.md |
| LIRA-100 | Loto — in-module ticket reprint UI                       | Low      | DONE `a3e24af` (e2e row green)                            | PARTIAL_TASKS_COMPLETION_PLAN.md    |
| LIRA-101 | PCD cleanup + Suppliers `settleNetPayUsd` verification   | Medium   | TODO — still open, see current_sprint.md live board       | PRIMARY_CASH_DRAWER_PLAN.md         |
| LIRA-102 | Session-grouping UI e2e spec                             | Low      | DONE — executed green 2026-08-08 (4/4 with lira-069+LOTO) | session-basket-payment-remaining.md |
| LIRA-103 | Recharge — remaining REST-parity gaps                    | Medium   | DONE (web spec green; found LIRA-109)                     | WEB_PARITY_ROADMAP.md               |
| LIRA-104 | Web-mode REST writes have no audit trail                 | Medium   | DONE `6949bc1` (124 routes, 2 blockers fixed)             | WEB_PARITY_ROADMAP.md               |
| LIRA-105 | Payment-method unknown-code semantics mismatch           | Low      | DONE `c9f2262`+`6f74cfd`                                  | BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md  |
| LIRA-106 | Recharge — crypto fields not reset on tab switch         | Low      | DONE `0c910cd`                                            | BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md  |
| LIRA-107 | Recharge — SEND↔RECEIVE flip resets nothing              | Low      | CLOSED — WON'T DO (owner)                                 | found reviewing LIRA-106            |
| LIRA-108 | `getRealizedCommissionTotals` missing counterparty gates | Medium   | DONE — confirmed real (18 USD divergence), fixed, 2× SHIP | found by LIRA-098's guard           |
| LIRA-110 | Daily closing sums fs commission with zero gates         | Medium   | TODO — still open, see current_sprint.md live board       | found by LIRA-108's workflow        |
| LIRA-111 | 8 e2e specs miss the `/audit` remount bounce             | Low      | DONE `6949bc1` (desktop e2e 252/252)                      | found shipping commission Phase 0+1 |
| LIRA-112 | iPick bills must book NO commission (only Katsh pays)    | **High** | DONE `be4143c` (v151, data-driven, e2e 252/252)           | owner correction (plan §6 D12)      |
| LIRA-113 | DAYS sale decrements shop-line validity (D12 reversed)   | Medium   | **DONE** `eb820c7` (corrected 2026-08-12 — was stale TODO; owner confirmed, decrements the SELECTED line) | owner report 2026-08-08             |
| LIRA-114 | 'For Partner' custom service acts as THROUGH; cost hits General | **High** | RE-OPENED 2026-08-09 — it IS custom_services, not omt_whish (crossed labels); owner confirmed For-Partner ticked — still open (narrowed), see current_sprint.md live board | owner report 2026-08-08 |
| LIRA-116 | Rename crossed 'Services' module labels/routes          | Medium   | TODO (owner approved 2026-08-09) — still open, see current_sprint.md live board | found via LIRA-114                  |
| LIRA-117 | No e2e drives inventory-pick -> stock decrement          | Medium   | TODO — still open, see current_sprint.md live board       | found shipping §2b                  |
| LIRA-118 | BLOCKER: submit-to-partner disabled on Custom Services   | **BLOCKER** | **DONE** e586de9 (pre-existing from 62e43ea, NOT a regression) | owner manual test 2026-08-10        |
| LIRA-119 | Settle modal: LBP commission shows Net payment $0.00     | **High** | **PARTIAL** cccd4ca - display fixed; "supplier owes you X" line still open (owner: revisit); superseded for its filed scope by LIRA-137 — see current_sprint.md | owner manual test 2026-08-10        |
| LIRA-120 | Partners currency dropdown will not open (re-opens 097)  | **High** | **DONE** 714837d, owner-tested; check-icon removal in flight | owner manual test 2026-08-10        |
| LIRA-121 | For-Partner notice now states the opposite of the truth  | Medium   | **DONE** e586de9                                          | owner manual test 2026-08-10        |
| LIRA-122 | Supplier table shows 'Unpaid' where nothing is owed      | Low      | **DONE** - rule-14 unification on supplier_debt_booked    | owner manual test 2026-08-10        |
| LIRA-123 | `yarn test:e2e` silently no-ops (exit 0, zero output)     | **High** | **DONE** db149e6 - direct invocation + spec-count floor; CI was NOT affected (Ubuntu) | found verifying LIRA-118..121 |
| LIRA-124 | THROUGH-partner RECEIVE pays customer from no drawer     | **High** | **DONE** 2e9e822 - payout + fee leg post; FOR path untouched (correct) | PARTNER_DISBURSEMENT_MATRIX.md |
| LIRA-125 | THROUGH legacy single-method SEND skips drawer credit    | Medium   | **DONE** 43c7450 - legacy path was LIVE, unified not deleted | PARTNER_DISBURSEMENT_MATRIX.md   |
| LIRA-126 | THROUGH ledger rows mislabeled WHISH (Binance/iPick/Katsh) | Low    | **DONE** 43c7450 - throws on unmapped; 0 rows to migrate  | PARTNER_DISBURSEMENT_MATRIX.md      |
| LIRA-127 | Secondary-system partner guard hardcodes provider==='WHISH' | Medium | **DONE** 5980180 - was an UNSUBMITTABLE OMT tab, not just a missing guard | section 5b, owner-approved 2026-08-10 |
| LIRA-128 | Confirm on-behalf RECEIVE drawer semantics (OMT vs wallet) | Medium | **RESOLVED** - owner confirmed no cash moves; documented FEATURE_GUIDE 8.1.0 | PARTNER_DISBURSEMENT_MATRIX.md |
| LIRA-129 | Ledger badge contradicts the amount's sign                | Medium | **DONE** 9082d6c - one sign rule; 4 of 7 entry_types affected, incl. an unreported LOTO SETTLEMENT case | found closing LIRA-128 |
| LIRA-130 | Custom Services history shows a REFUNDED service as live | **High** | **DONE** e47dfa2 - frontend was starved, not unbuilt; audit -> LIRA-131 | owner report 2026-08-10 |
| LIRA-131 | is_refunded dropped from 5 MORE module read paths        | **High** | **DONE** 4710cb8 - plus a 2nd financial_services projection and 2 frontend re-mapping drops the audit had missed | LIRA-130's 11-table audit |
| LIRA-115 | Session-basket refund never returns customer cash       | **HIGH** | DONE `405a190` — e2e VERIFIED (full desktop 252/252, 2026-08-09); basket-level reversal path is a named follow-up | owner report 2026-08-08, reproduced |
| LIRA-109 | Recharge `updateMetadata` still raw `window.api`         | Low      | DONE — web e2e green 60/60                                | found during LIRA-103               |
| LIRA-137 | Katsh bill settlement: commission frozen at $0, wrong direction | **High** | **DONE** — commission now books as a real Katsh-drawer top-up (profit-stamped, no supplier debt), tender form removed for the bills-only shape, both ends of the "legs with nothing owed" hazard closed; e2e spec rewritten as a guard (unexecuted — desktop e2e cannot run from an agent shell); see current_sprint.md "Recently Closed" for full ticket body | owner report 2026-08-11, `BILL_COMMISSION_SETTLEMENT_PLAN.md` |
| LIRA-138 | Generalise commission-at-settlement drawer top-up to OMT/WHISH (Phase 2) | Medium | TODO — deliberately NOT built by LIRA-137 (narrow scope, owner-approved); still open, see current_sprint.md live board | `COMMISSION_AT_SETTLEMENT_PLAN.md` D13, `BILL_COMMISSION_SETTLEMENT_PLAN.md` §4 |

> `OWNER_NOTES_TASK_PLAN.md` needed no new ticket — its full remainder is already tracked as
> LIRA-083, 084, 086, 087, 088, 089 (Sprint 4). All 8 `todo_plans/*.md` files are now fully
> represented in this registry — `current_sprint.md` is the source of truth going forward.

