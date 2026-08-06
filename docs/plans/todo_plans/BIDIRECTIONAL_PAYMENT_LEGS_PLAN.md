# Bidirectional Payment Legs — customer-paid fees on shop-pays-customer flows — Feature Plan

**Status: IMPLEMENTED 2026-08-06** (all phases; owner requested 2026-08-06 — "adding a direction
into the payment line makes things much better instead of having another payment form").
Per-suite verification ran with each phase (every guard failing-first, rule 17); the FULL
verification gates (lint / typecheck / format / whole-workspace suites / desktop e2e) were
**deferred by owner decision** ("keep them for later … commit your work … we can do another
commit if we need a fix") — see §9 for the exact commands and the already-known reds.

Read together with: `docs/FEATURE_GUIDE.md` §3 (badges) / §4 (legs, ONE-loop) / §7 (PCD) / §8.1
(THE invariant) / §9 (reversal symmetry) / §11 (sessions) / §13 (checklist) ·
`PRIMARY_CASH_DRAWER_PLAN.md` (§2#2 FEE-leg routing, §6 item 2 FEE audit, open items 6b/6e) ·
`done_plans/WHISH_APP_RECEIVE_FEE_FIX_PLAN.md` (app-fee contract + its two live follow-ups) ·
`OMT_FLOAT_MODEL_HANDOVER.md` §3.1 (the `"FEE"` tag audit — this plan closes it) / §3.4 (fee-tier
direction gating — interacts, stays open).

---

## 0. Owner decision record (2026-08-06 request + open questions)

| #   | Question                                                     | Decision                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Can the customer pay a fee-on-top with any payment method?   | **DECIDED (owner, 2026-08-06)** — "It doesn't only arrive as cash. The customer can pay by wish, can pay by any payment method we have in the system." Applies only when `includingFees` is unchecked (fee NOT deducted from the payout).                              |
| 2   | UI shape                                                     | **DECIDED (owner)** — direction on the payment line, ONE payment form/sheet. No second form.                                                                                                                                                                            |
| 3   | Sessions                                                     | **DECIDED (owner)** — the session checkout modal must show and settle both directions when a basket contains a payout item and/or a customer-paid fee.                                                                                                                  |
| 4   | Flows in scope                                               | **DECIDED (owner list)** — Loto cash prize, OMT RECEIVE, WHISH RECEIVE, OMT App RECEIVE, Whish App RECEIVE, Binance cash out. Change-return is explicitly **out** ("separate flow, not a payment row").                                                                 |
| 5   | Wire format for fee legs                                     | **PROPOSED: a separate `feePayments[]` payload field**, not direction-overloading `payments[]` — §1.2. `[OWNER-CONFIRM]`                                                                                                                                                |
| 6   | Loto prize: does the payout need method choice / split legs? | **DECIDED (owner, 2026-08-06)** — "for the Loto, we can keep it as is." No leg pipeline; Loto keeps hardcoded `CASH`/`General`/`LBP`. Only the two §2 bug fixes ship (session channel crash #3, dead `payment_method` field #9). Phase E is dropped.                     |
| 7   | App-wallet/Binance: is a counter-collected fee a real case?  | **DECIDED (owner, 2026-08-06)** — "yes, it happens. The customer can pay the fee separately in different payment methods." Phase D builds the separately-collected-fee mode for app wallets/Binance. (Answer given while discussing the system-receive example — re-confirm against the A/B/C write-up before starting Phase D.)                             |
| 8   | Fee charged to CUSTOMER_ACCOUNT                              | PROPOSED — books a `debt_ledger` `'Service Debt'` charge (already in `MODULE_DEBT_TRANSACTION_TYPES`, so the generic `_cancelDebt` reversal covers it; rule 20 satisfied with no new charge type).                                                                       |
| 9   | The `"FEE"` method string                                    | PROPOSED — retire it. Store the customer's **real tender method** on the leg; keep the note `"<provider> RECEIVE fee (customer-paid)"` as the discriminator. Closes `OMT_FLOAT_MODEL_HANDOVER.md` §3.1. Historical rows keep `"FEE"`; the viewer's fallback label copes. |
| 10  | IN/OUT badge for a fee-on-top RECEIVE                        | PROPOSED — return `"both"` from `getCashFlowDirection` (renderable today, `TransactionsViewer.tsx:572-585`, currently unreachable for FINANCIAL_SERVICE).                                                                                                                |

---

## 1. The model

### 1.1 Vocabulary (single definitions — rule 14)

- **Payout legs** — the shop pays the customer. Standalone payloads: the plain (IN-partition)
  entries of `payments[]`, unchanged. Session envelope: `direction: "OUT"` legs, unchanged.
- **Fee legs** — the customer pays the provider fee `f` separately (fee-on-top only). NEW:
  `feePayments[]` on the create payload. Each leg: `{method, currencyCode, amount}` — real tender
  methods, split allowed, CUSTOMER_ACCOUNT allowed (name+phone gate).
- **Change legs** — `direction: "OUT"` entries of `payments[]`, consumed once by the shared
  end-of-transaction loop. Untouched by this feature (rule 16).

### 1.2 Wire format: why `feePayments[]` and not direction-in-`payments[]`

The IN partition of `payments[]` is **already occupied by the payout** in every standalone RECEIVE
flow: `payoutLegs = (data.payments ?? []).filter(isDrawerAffectingMethod)`
(`FinancialServiceRepository.ts:2741-2743`, app-wallet twin `:2151`), reconciled hard-reject
against `payoutAmount` (`:2756-2762`, `:2152-2158`). A fee leg placed there either trips
`reconcileLegs` (diff = `+f`) or posts with an inverted sign. Tagging it `direction: "IN"` while
flipping the payout to OUT would invert the convention of four repository branches, the FOR-partner
OUT-disbursement meaning (`:1567-1602`), the exchange payout ban (`ExchangeRepository.ts:369-374`),
and every hand-built payload in the e2e suite — a semantic migration of the whole payout family for
zero operator-visible gain. A sibling array is additive: existing callers, specs, and the no-legs
fallback stay valid byte-for-byte.

The **UI still reads as one form with a direction per line** (owner decision #2): the payment sheet
renders payout lines and fee lines in one card with per-line direction chips ("You pay" / "Customer
pays"); the split into `payments` vs `feePayments` happens at payload assembly, invisible to the
operator — same pattern as `toCamelLegs` already merging lines+returnLegs.

The **session envelope needs no new field**: its convention is already "IN = customer pays", so the
fee simply joins the gross charge bucket and is collected by the pooled payment lines (§1.5).

### 1.3 The invariant (extends FEATURE_GUIDE §8.4)

> `Σ(drawer deltas) + Σ(receivable deltas) − Δ(owed to provider) = c + kept_change`

holds unchanged, **per currency**, with fee legs now contributing per-method:

- CASH fee leg → `+f_i` to the **PCD** on a primary-system transaction (`resolveServiceCashDrawer`),
  `General` otherwise — exactly where the implicit leg already lands.
- OMT/WHISH/BINANCE wallet fee leg → `+f_i` to `OMT_App`/`Whish_App`/`Binance`. The invariant sums
  **all** drawers, so it still nets to `+c`.
- CUSTOMER_ACCOUNT fee leg → no drawer; `+f_i` to receivables (`'Service Debt'` charge).
- `Σ f_i` must equal the transaction's fee `f` — enforced by a second `reconcileLegs` call
  (`inLegs: feePayments, expectedTotals: expectedTotalIn(f, currency)`), same ±$0.05 epsilon and
  tender-rate band as the payout reconcile.

### 1.4 Per-case table (extends the §8.1 table; OMT/WHISH system RECEIVE, fee-on-top)

| Fee collected via | Drawer legs                          | Receivable | Δ owed         | Net (all ledgers) |
| ----------------- | ------------------------------------ | ---------- | -------------- | ----------------- |
| CASH              | PCD `−x`, PCD `+f`                   | 0          | `−(x − (f−c))` | `+c`              |
| WHISH wallet      | PCD `−x`, `Whish_App +f`             | 0          | `−(x − (f−c))` | `+c`              |
| Split cash+wallet | PCD `−x`, PCD `+f₁`, `OMT_App +f₂`   | 0          | `−(x − (f−c))` | `+c`              |
| CUSTOMER_ACCOUNT  | PCD `−x`                             | `+f`       | `−(x − (f−c))` | `+c`              |
| Fee-included      | PCD `−(x−f)` — no fee legs (invalid) | 0          | `−(x − (f−c))` | `+c`              |

Reversal must net every row of this table to **0 across every ledger touched, per currency**
(rule 20), proven failing-first (rule 17).

### 1.5 Session model

Convention already correct (`SessionPaymentService.recordBasketPayment` is direction- and
method-agnostic): the fee joins `chargeUsd`/`chargeLbp` in `splitBasketCashSides`, is collected by
the pooled IN lines, and the per-item fee leg **stays skipped** under `deferPayment` (no
double-count). The item-level supplier ledger `−(x − f + c)` and profit `c` — already booked at
replay — become correct instead of phantom (§2 bug 1). The payout side additionally becomes
method-choosable (today hard-derived as CASH-or-CUSTOMER_ACCOUNT, `SessionCheckoutModal.tsx:337-338`,
`:422`).

---

## 2. Bugs found during research (fix regardless of the feature)

| #   | Severity | Bug                                                                                                                                                                                                                                                                                                                                                                     | Where                                                                                          |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 1   | **P0**   | **Session RECEIVE books a fee no drawer ever received.** The fee UI is hidden in sessions, but `omtFee` still auto-fills via the tier lookup (`lookupOmtFee`, not direction-gated) and ships in the payload → profit `c = f×rate` stamped and supplier ledger booked `−(x − f + c)` while the FEE leg and payout are defer-skipped and the basket total excludes the fee. | `Services/index.tsx:799-815`, `:959`; `FinancialServiceRepository.ts:823-832`, `:2876-2883` vs `:2625` |
| 2   | **P0**   | **Same-currency net-negative/net-zero basket cannot check out.** The payment widget render-gate reads NET totals; a $50 charge + $100 payout basket hides the widget → `paidUSD = 0 < 50` → Confirm permanently disabled.                                                                                                                                                  | `SessionCheckoutModal.tsx:851` vs `:478`                                                        |
| 3   | **P0**   | **Loto prize in a session basket throws at checkout.** Cart enqueues `ipcChannel: "loto:cashPrize:create"` (camelCase); the replay switch only accepts `"loto:cash-prize:create"` and its default throws. The guarding spec hand-builds the correct channel, so it is blind.                                                                                              | `Loto/index.tsx:411` vs `SessionCheckoutService.ts:178`, `:216-219`                             |
| 4   | P1       | **LIRA-078 refund-override breaks on fee-on-top RECEIVE** (3 ways): the `"FEE"` leg is dropped from the override mirror (fee stays in the drawer after refund); backend signed-net validation vs frontend absolute-net makes an overridden RECEIVE refund unreachable; the modal's default method is literally `"FEE"`. Untouched-defaults path is the only correct one.    | `TransactionRepository.ts:2075`, `:1923-1985`; `refundLegOverride.ts:59-78`, `:135`             |
| 5   | P1       | **THROUGH-partner RECEIVE with a fee credits `+f` with no payout offset** — `skipSystemDrawer` suppresses both payout branches but not the FEE leg.                                                                                                                                                                                                                        | `FinancialServiceRepository.ts:2625-2644` vs `:2706-2729`                                       |
| 6   | P1       | **App-transfer form never sends `cashoutMethod`** — a non-cash payout selection silently debits `General`. Already recorded as an open follow-up of the Whish-fee fix; still live.                                                                                                                                                                                         | `OmtWhishAppTransferForm.tsx:287-342`; `WHISH_APP_RECEIVE_FEE_FIX_PLAN.md:127-131`              |
| 7   | P1       | **PCD split ratio corrupted by payout items** — `getSessionCashSplitContext` sums **signed** item amounts, so a negative RECEIVE item shrinks/inverts the basket total driving the PCD/General split. (= PRIMARY_CASH_DRAWER_PLAN open item 6b.)                                                                                                                          | `SessionPaymentRepository.ts:179-230`                                                           |
| 8   | P2       | **`"FEE"` misclassified as a wallet method** — unregistered in `payment_methods`, so `isNonCashDrawerMethod("FEE") === true` (counts into PM-fee proration) and two "drawer-affecting" predicates disagree on it.                                                                                                                                                          | `utils/payments.ts:48-58` vs `PaymentMethodRepository.ts:234-237`                               |
| 9   | P2       | **Loto prize `payment_method` is dead** — sent by the form, silently stripped by the Zod schema, hardcoded in the repo. The adapter typing is `(data: any)`, which is why it never surfaced.                                                                                                                                                                               | `Loto/index.tsx:397-402`; `validators/loto.ts:51-61`; `LotoCashPrizeRepository.ts:102-103`      |
| 10  | P3       | **Debt cash-out is UI-gated to desktop for no backend reason** — `if (!window.api)` hard-block despite a dual-mode adapter fn and a live REST route (also a rule-19 violation: raw transport gate in a page).                                                                                                                                                              | `Debts/index.tsx:592-595`                                                                       |

Bugs 1–3 are shippable before/without the feature and should go first (Phase 0). Bug 1's minimal
fix is to stop sending an auto `omtFee` on the session RECEIVE path until Phase F wires collection.

---

## 3. What changes vs today (per flow)

| Flow                     | Today                                                                                                                       | Target                                                                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OMT/WHISH system RECEIVE | Fee-on-top books ONE implicit leg, method `"FEE"`, tender forced to cash-family collapse of `cashoutMethod` (`:2625-2644`)   | Operator-selectable `feePayments[]` (split, any method, CUSTOMER_ACCOUNT); real tender stored; legacy fallback: absent `feePayments` + fee>0 → synthesize today's single leg |
| OMT App / Whish App RECEIVE | Fee netted from payout (wallet spread); no counter fee; `cashoutMethod` never sent (bug 6)                                | Payout legs/method wired correctly (bug 6); counter fee via `feePayments[]` **only if owner Q7 = yes**                                                                     |
| Binance cash out         | Same netted model, USDT wallet leg + USD payout legs                                                                        | Same as app wallets                                                                                                                                                        |
| Loto cash prize          | No legs; hardcoded CASH/General/LBP; NON_REVERSIBLE; no profit; no client; 2 bugs (3, 9)                                    | Bugs fixed only — payout stays as-is (owner Q6, 2026-08-06)                                                                                                                |
| Session checkout         | Backend bidirectional already; modal: net render-gate (bug 2), payout method derived not chosen, fee suppressed (bug 1)     | Gross gate; payout-side method editor emitting OUT legs; fee in charge bucket; split-context fix (bug 7); payout OUT legs note-discriminated from change                    |
| Refund/void              | Generic `_reversePayments` correct; override path broken on fee legs (bug 4)                                                | Fee legs first-class in override mirror + validation; rule-20 proof per §1.4 table                                                                                         |
| Audit viewer             | RECEIVE badge unconditionally "out"; fee shows as anonymous `in:` leg; Method column reads "Fee"                            | Badge `"both"` when a customer-paid IN leg exists; legs labeled by real tender                                                                                             |

---

## 4. Work breakdown

**Phase 0 — standalone correctness fixes (no feature dependency). ✅ DONE 2026-08-06.** Bugs 1
(session payload zeroes the auto-fee for `activeSession && RECEIVE` — `Services/index.tsx` fee
resolvers), 2 (`SessionCheckoutModal` payment-widget gate now reads GROSS `chargeUsd/chargeLbp`),
3 (Loto cart writes canonical `loto:cash-prize:create`; `SessionCheckoutService` also accepts the
legacy camelCase spelling for persisted cart rows) and 9 (dead `payment_method` removed). Each
proven failing-first (rule 17): `Services.sessionReceiveFee.test.tsx` (Expected 0 / Received 1
pre-fix), `SessionCheckoutModal.paymentGate.test.tsx` (widget absent + Confirm disabled pre-fix),
`SessionCheckoutService.cartItemChannel.test.ts` (Unknown-IPC-channel throw pre-fix). Core rebuilt
+ synced to `node_modules/@liratek/core/dist`. All three suites re-run green by the orchestrator.

**Phase A — core: `feePayments[]` for the system RECEIVE branch. ✅ DONE 2026-08-06.**
Shipped: `validators/financial.ts` field + 2 refines (+ the `electron-app/schemas/index.ts`
duplicate), `FinancialServiceRepository` fee-leg booking (real tender methods — `"FEE"` literal
retired for new rows; CUSTOMER_ACCOUNT → `'Service Debt'`; second `reconcileLegs` against `f`;
THROUGH-partner gate = bug 5 fix; legacy single-leg fallback preserved). Guarded by
`FinancialServiceRepository.receiveFeeLegs.test.ts` (14 cases incl. reversal symmetry via
`voidTransaction`, all failing-first) + `OmtSystemFeeCharacterization` regression-green (24/24).
Orchestrator review added case (j): a fee leg that is neither CUSTOMER_ACCOUNT nor
drawer-affecting (e.g. GIFT_CARD) now HARD-REJECTS — reconcile counted it while booking skipped
it, which would have reintroduced the phantom-fee class inside the new path (proven failing-first:
"Received function did not throw"). Core rebuilt + synced.
`packages/core/src/validators/financial.ts` (+ the `electron-app/schemas/index.ts` duplicate —
rule-14 debt, both or the transport strips it): `feePayments?: leg[]`, refined invalid when
`includingFees` or partner modes. `FinancialServiceRepository.ts:2616-2644` consumes it: per-leg
booking (drawer via `resolveServiceCashDrawer`; CUSTOMER_ACCOUNT → `bookClientDebtCharge('Service
Debt')`), second `reconcileLegs` against `f`, real tender method stored, note discriminator kept.
Legacy fallback preserved. THROUGH-partner gating (bug 5) lands here. Core build & sync.

**Phase B — reversal symmetry. ✅ DONE 2026-08-06.** Net-based override shipped: the override
states the MAGNITUDE of the row's net customer-facing movement; direction is restored from the
original net's sign per currency (`_overridableNetByCurrency`, one rule-14 helper shared by
validator + applier). `buildDefaultRefundLines` now picks the largest-|signed_amount| leg's method
per currency and falls back to CASH for non-selectable methods (covers legacy `"FEE"` rows).
Guards (failing-first): `TransactionRepository.refundFeeOnTopReceive.test.ts` (override refund of
a fee-on-top RECEIVE nets every drawer to 0 — pre-fix threw "totals do not match"; wrong
magnitudes still reject; money-IN regression), frontend `refundLegOverride.test.ts` +4 cases.
29/29 core + 21/21 frontend re-run green by the orchestrator. Core rebuilt + synced.
(§1.4 reversal proofs via `voidTransaction` landed in Phase A's test file.)

**Phase C — Services page UI. ✅ DONE 2026-08-06.** `MultiPaymentInput` gained the optional
`counterFlow` prop (one card, "You pay"/"Customer pays" chips, independent line state, emits only
via `counterFlow.onChange`; snapshot-identical when absent). Services page renders it for
fee-on-top RECEIVE outside a session (`Customer pays — <provider> fee`, seeded one CASH line =
today's money movement) and sends `feePayments` ONLY then; GIFT_CARD excluded from the method
list (server hard-rejects it). `getCashFlowDirection` returns `"both"` for a RECEIVE whose legs
move both ways (fed `row.payments` by the viewer). Typings: preload + electron.d.ts. Guards
(failing-first): +6 MPI tests, `Services.feeCounterFlow.test.tsx` (payload present/absent per
gate), +5 cashFlow tests — 98/98 re-run green by the orchestrator, frontend typecheck clean.
Known polish item: the counter-flow CUSTOMER_ACCOUNT gate uses name-OR-phone while
`canChargeToCustomerAccount` demands name+phone — the repository hard-reject protects money;
tighten in Phase F polish.

**Phase D — app wallets. ✅ DONE 2026-08-06** (two Sonnet agents: core then form). Mode C ("fee
paid by: Customer pays separately") on OMT_APP/WHISH_APP RECEIVE: wallet receives the bare
amount, payout legs = FULL amount, fee via `feePayments[]` booked by the ONE shared
`bookFeeCollectionLegs` helper (rule-14 extraction — the system branch now calls the same
helper); A2 guard made provider-aware (fee source `omtFee`/`whishFee` for app wallets;
**BINANCE hard-rejects with a named error — DEFERRED** until the owner's uncommitted
`Recharge/index.tsx` work lands, since the Binance payload builder lives there). Bug 6 fixed
(`cashoutMethod` synced from a single payout line, sent on every RECEIVE). Form: `feeMode`
SENDER/DEDUCTED/SEPARATE radio (DEDUCTED stays WHISH_APP-only; SEPARATE hidden for
partner/session), `PaymentSheet` counterFlow pass-through. Modes A/B fee-math payloads
regression-proven unchanged. Core agent ran the FULL core suite: 139 suites / 1541 tests green.

**Phase G — web parity. ✅ DONE 2026-08-06.** `lira-web-017` (feePayments over REST: deltas,
split fee, partner/zero-fee/mismatch rejections with rollback), `lira-web-018` (session checkout
with `kind:"PAYOUT"` leg + fee-on-top item, §8.4 invariant asserted), `lira-web-007` extended
(debt cash-out driven through the real page UI — bug 10's `window.api` gate deleted, hang
proven failing-first). 8/8 green at implementation time. Parity gaps recorded, deliberately not
fixed: (i) `lira-web-016` was ALREADY red pre-feature (asserts pre-PR#68 drawer targets);
(ii) Zod-refine rejections over REST return HTTP 400/object-error via `validateRequest`, not the
200-envelope (general middleware behavior, all modules — needs an owner decision against the
rule-19 envelope contract); (iii) no REST route exposes payment-leg rows — specs assert via
named-drawer deltas instead.

## 9. Verification gates (deferred by owner, 2026-08-06) — run these, fix in a follow-up commit

```
yarn lint
yarn typecheck
yarn format
yarn test                                              # all workspaces; self-corrects native ABI
cd electron-app && npx jest --config jest.config.cjs    # new electron schema tests (not in `yarn test`)
yarn test:e2e:web                                       # run BEFORE the desktop block (ABI)
yarn dev    # let it fully start, then STOP it, then:
yarn test:e2e
```

Known/expected reds going in: `lira-web-016` (pre-existing rot, §Phase G); desktop session e2e
specs may assert pre-bug-7 PCD split numbers (§7 risk 3); prettier may reformat agent-written
files on `yarn format`. `yarn dev` must not be running during `yarn test` (SQLite lock).

**Phase E — DROPPED (owner Q6, 2026-08-06: keep Loto as-is).** The Loto prize keeps its
hardcoded `CASH`/`General`/`LBP` payout. Its two §2 bugs (#3 session channel crash, #9 dead
`payment_method` field) ship in Phase 0.

**Phase F — sessions. ✅ DONE 2026-08-06** (two parallel lanes, frozen wire contract:
`kind?: "PAYOUT"|"CHANGE"` on OUT checkout legs; fee joins the CHARGE bucket, collected by the
pooled IN lines; per-item fee leg stays defer-skipped). CORE: schema `kind`;
`SessionPaymentService` payout/change note + result split and per-BUCKET PCD ratio
(`ratioForCurrency(ctx, ccy, "charge"|"payout")`); `getSessionCashSplitContext` gross
per-direction sums + persisted `omt_fee`/`whish_fee` folded into the charge bucket for fee-on-top
FS RECEIVE items (`feeOnTopReceiveFsIds`, gate exported from SessionCheckoutService) — bug 7 fixed;
stale comments swept. FRONTEND: session RECEIVE fee re-enabled (Phase 0's zeroing replaced by real
wiring: cart amount = fee-adjusted payout, fee in label + formData), `splitBasketCashSides`
fee-aware, per-currency payout-method select on the checkout modal (default = old derivation)
emitting kind:PAYOUT legs, receipts print gross Charges/Payout lines. Guards: 21 new core tests +
6 frontend suites (31 tests), each failing-first (incl. a TS2339 compile-level proof for the
schema field); orchestrator re-ran 77/77 core + 31/31 frontend green, dist sync verified.
Adversarial finding #3 (stale pre-fix carts) resolves forward: fee-bearing cart rows checked out
post-F are collected via the pooled legs. Mid-implementation both lanes were killed by an org
spend limit; a stranded `git stash` from the frontend lane was recovered surgically (stash@{0}
retained as a safety copy until commit).

**Phase G — web parity (rule 19).** Validators are shared already for FS + sessions; loto REST
route inherits the new schema; extend `lira-web-016` with a wallet-collected fee; new web spec for
the mixed-direction session checkout. Bug 10 folded in (drop the `window.api` gate).

---

## 5. Test plan (rule 17 — every guard proven failing-first; rule 15 — delta + identity)

- **Core jest**: `OmtSystemFeeCharacterization` new cases per §1.4 (each asserts the §8.4 invariant
  after create AND after reverse); fee-leg reconcile hard-reject cases; THROUGH-partner fee gating;
  session split-context gross sums.
- **Desktop e2e**: extend `lira-131` (UI-driven: fee collected via Whish wallet → `Whish_App +f`,
  PCD `−x`, ledger `−(x−(f−c))`); refund-override spec driving a fee-on-top RECEIVE through the
  modal; session spec driving a **same-currency mixed basket through the real modal UI** (none
  exists today — both mixed specs bypass it via IPC); loto-prize legs spec if Q6 lands.
- **Web e2e**: `lira-web-016` extension + mixed-direction session checkout over REST.
- Every money assertion is a **delta** against a snapshot taken immediately before the action, with
  row identity by type+provider+amount — never row position (rule 15).

---

## 6. Out of scope (recorded)

- **Change-return redesign** — owner: "separate flow, not a payment row". The shared OUT-leg loop
  stays untouched (rule 16).
- **Debt credit cash-out fee** — not a fee-bearing flow; only bug 10 rides along.
- **RECEIVE fee-tier direction gating** (`OMT_FLOAT_MODEL_HANDOVER.md` §3.4) — still open, still
  `[OWNER]`; Phase 0's bug-1 fix removes its worst consequence (phantom session fees).
- **Session-basket PCD payout insufficient-funds surfacing** (PRIMARY_CASH_DRAWER_PLAN 6e) —
  unchanged; no balance check anywhere per the owner's 2026-08-01 decision.

## 6bis. Adversarial review findings (2026-08-06 workflow — 4 execution probes + refutation pass; 9 confirmed, 0 refuted, 0 P0)

The §1.4 arithmetic, multi-currency fee legs (incl. tender-rate band), and downstream consumers
(receipts/closing/D1/till filter, old `"FEE"` rows vs new real-method rows) all probed CLEAN. The
confirmed findings are misuse-path gating holes, one fix package (**Phase A2**, dispatched after
the Phase F lanes release their files):

| # | Sev | Finding | Fix owner |
| - | --- | ------- | --------- |
| 1 | P1 | **FOR-partner RECEIVE discards `feePayments` silently** — the PFT-3b early return (~:1464) never reads the field; no reconcile, no booking, success returned; supplier ledger still embeds the uncollected fee via `omtFee`. Reachable from the shipped UI: `showFeeCounterFlow`/`feeCounterFlowActive` have no partner check, and the counter-flow seeds a CASH line by default. The Phase A spec's "refined invalid when … partner modes" was DROPPED by the implementing agent and missed in diff review. | A2: repo authoritative guard + core validator refine (partnerId) + electron mirror + frontend gate |
| 2 | P1 | **`feePayments` no-op'd when the resolved fee is 0/omitted** — outer gate requires `receiveFeeAmt > 0`, so legs are dropped without reconcile on BOTH transports. | A2: hard-reject (repo) + validator refine (fee fields > 0 when legs present) |
| 3 | P1 | **Stale pre-fix session carts still phantom-book** — Phase 0's bug-1 fix is UI-only; a cart row persisted with `omtFee > 0` before the fix (or a raw-IPC session caller) still books ledger/profit with no cash at replay. | Phase F resolves forward (fee collected via pooled legs, incl. stale carts checked out post-F); F-core test (c) is the guard. Cutover note added. |
| 4 | P2 | `deferPayment: true` + `feePayments` → reconcile never runs, silently accepted. Sessions never send the field (pooled collection). | A2: hard-reject |
| 5 | P2 | THROUGH-partner + `feePayments` → intended no-booking (bug-5 gate) but no reject either — silent discard. | A2: hard-reject |
| 6 | P2 | electron-app schema duplicate omits BOTH core refines ("repository is the enforcement layer" — but the repository doesn't enforce; that's findings 1/2/4/5). | A2: repo becomes the real enforcement layer; refines mirrored into the electron duplicate |
| 7 | P3 | amount 0/negative/empty-array probes: no divergence (not a bug — recorded for completeness). | — |

**Phase A2 ✅ DONE 2026-08-06** — findings 1/2/4/5/6 fixed: repository authoritative guard
(`FinancialServiceRepository.createTransaction`, after fee resolution and BEFORE the PFT-3b
dispatch — every branch hits it; five named hard-rejects), two new core validator refines
(partnerId, zero fee), all four refines mirrored onto the electron schema (electron-app gained a
minimal jest harness + 7 schema tests — its first test infra), and `showFeeCounterFlow`/
`feeCounterFlowActive` gained `&& !forPartner`. All failing-first (the pre-fix silent-success
captured verbatim); orchestrator re-ran 21/21 core + 7/7 electron + 4/4 frontend green.
Finding 3 was closed by Phase F (stale fee-bearing carts collect via pooled legs post-F).

(Findings 1 and 2 were each independently discovered by two different probe surfaces; every
verdict agent reproduced its finding with its own probe before confirming.)

## 7. Risks

1. The second `reconcileLegs` call makes previously-accepted sloppy fee payloads hard-reject —
   deliberate (S2 discipline), but scripted callers must use the legacy fallback path.
2. Retiring `"FEE"` changes the Method column for NEW rows only; mixed history in the viewer is
   expected and harmless (fallback label).
3. Phase F touches the pooled-payment path guarded by 13 session specs — run the full session suite
   after every sub-step; the PCD split change (bug 7) alters numbers existing specs may assert.
