# Primary-System Cash Drawer — Feature Plan

**Status: PLANNED** — owner interviewed 2026-07-30, all model decisions recorded below.
**Supersedes the float-model semantics of PR #66.** The owner's verdict (2026-07-30, verbatim):
"we dont have omt system balance.. no need for another drawer. we can use our omt system
drawer" and "I don't really care about this float model … I think the float model is
something wrongly implemented." The float model's _structural_ fixes stay (no double-debits,
reversal symmetry, settlement that nets to zero, the invariant-asserting test harness); its
_semantics_ (in-system spendable balance, fee-only supplier ledger) are replaced.

Read together with `docs/FEATURE_GUIDE.md` §7/§8/§8.1 (which this plan will rewrite) and
`docs/plans/todo_plans/OMT_FLOAT_MODEL_HANDOVER.md` (open threads §3.1–§3.4 still apply,
see §6 below).

---

## 0. Owner decision record (2026-07-30 interview)

| #   | Question                                                | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | What is `OMT_System`?                                   | **The physical dedicated cash drawer at the counter.** There is NO account/float balance at OMT to track. The drawer is countable at closing like any cash box.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2   | New drawer or reuse?                                    | **Reuse `OMT_System` / `Whish_System`** — no new drawer name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 3   | Scope                                                   | Symmetric by **primary system** (`shop_base_system`): OMT primary → `OMT_System` is the active cash drawer; Whish primary → `Whish_System`. The secondary system's drawer lies dormant. Future (out of scope now): a per-shop config to merge this drawer into General.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 4   | Which cash goes in it                                   | **Everything from primary-system SEND/RECEIVE**: customer payment `(x+f)`, RECEIVE payouts, change/return legs, the customer fee.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 5   | App wallets / Binance                                   | **General**, unchanged. Only classic system SEND/RECEIVE uses the drawer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 6b  | FOR-partner on the SECONDARY system (2026-08-01)        | **Rejected outright.** "FOR partner" = the partner's customer, _our_ system — and a provider is _secondary_ precisely because the shop has no account on its rails, so it cannot run anything FOR anyone there. Only THROUGH. The **UI has always enforced this** (`{provider !== partnerSystem && …}` gates the "For Partner" toggle); the backend had not, and the gap was reachable only because lira-119 hand-builds IPC payloads. It also let a FOR-partner RECEIVE book a supplier obligation against a supplier row `listSuppliers` deliberately HIDES — money real in the DB, invisible in the app. Now a typed `BusinessRuleError`. **SYSTEM providers only** — OMT_App / Whish_App / Binance FOR-partner are untouched, since those wallets hold money the shop genuinely owns.                                                                                                                                                                                                              |
| 6   | Partner flows (follow-up 2026-07-30)                    | **Route by the SYSTEM the transaction runs on, not the counterparty.** THROUGH-partner (secondary system, e.g. Whish when OMT is primary) → **General**. FOR-partner (runs on YOUR primary system) → **PCD**. A FOR-partner RECEIVE moves **no drawer at transaction time** — obligations only (supplier ledger: provider owes you; partner ledger: you owe the partner); the partner's later collection pays out of the **PCD**. Owner: "all my cash received or that I want to pay … related to an OMT system transaction should be affecting the OMT drawer, not the general."                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 7   | Session-basket primary-system items                     | **Yes — split by item share** (follow-up 2026-07-30): the FS item's pro-rata portion of each cash leg routes to the drawer, the remainder to General (needs provider context in the session path, §3 Phase D).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 8   | Service-debt repayments (client pays an OMT debt later) | **Into the drawer.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 9   | Supplier ledger ("owed to OMT")                         | **Gross**: SEND books `+(x + f − c)`; RECEIVE books `−(x − (f − c))`. Replaces #66's fee-only `feeOwedDelta`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 10  | Settlement source                                       | Settlement pays the net owed **from the drawer** (via normal payment legs whose CASH resolves to the drawer).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 11  | RECEIVE payout, insufficient drawer funds               | ~~Block~~ → **REVERSED 2026-08-01. Nothing is ever blocked.** Owner: "I don't want it blocked. We can have negative amounts in all drawers today… let's make the negative amount show up in the section to move money from drawers, but you can still perform the transaction." A drawer may go negative; the transfer modal lists every negative drawer per currency with a **"Cover it"** button that pre-fills the amount clearing it. Applies to drawer↔drawer transfers too (owner, same date): no drawer operation anywhere refuses. **Why it's right:** blocking strands the operator mid-sale with a customer waiting, over a condition the rest of the system already tolerates. **The caveat to keep in view:** a physical cash box cannot actually hold a negative, so a negative balance means cash was taken from another drawer without recording the transfer — it is an _unrecorded transfer_, not an error, and surfacing it where the operator can fix it in one click is the point. |
| 12  | Manual transfers                                        | **General ↔ drawer, both directions**, in the UI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 13  | Fund-the-float (v139)                                   | Obsolete as a concept; its reversible transfer plumbing is repurposed as the generic drawer↔General cash transfer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 14  | Cutover                                                 | **Owner wipes the DB and starts fresh.** No balance/data migration needed for the owner's install. Schema migrations still required for the upgrade path + multi-tenant web (rule 10). Opening drawer balance set by physical count via Initial Drawer Amounts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

---

## 1. The model ✅ DONE

`OMT_System` (or `Whish_System` when Whish is primary) = **the banknotes physically inside
the dedicated money-transfer drawer**. No leg represents a balance inside the provider's
system — that concept is deleted.

Three quantities, same as before: `x` principal, `f` customer fee, `c` shop commission
(`c ≤ f`, `c = 0` for WHISH).

### Per-case drawer table (replaces FEATURE_GUIDE §8.1's four-row table)

Cash legs of a primary-system, non-partner transaction target the **primary cash drawer**
(`PCD` below). Non-cash tenders (CUSTOMER_ACCOUNT, wallets, gift card) keep their existing
non-drawer / own-drawer behavior.

| Case                                                 | PCD legs   | Δ owed to provider (supplier_ledger) | PCD Σ − Δowed |
| ---------------------------------------------------- | ---------- | ------------------------------------ | ------------- |
| SEND, fee on top (customer hands x+f cash)           | `+(x+f)`   | `+(x + f − c)`                       | `+c`          |
| SEND, fee included (customer hands x; principal x−f) | `+x`       | `+((x−f) + f − c) = +(x − c)`        | `+c`          |
| RECEIVE, fee on top (payout x, fee f collected)      | `−x`, `+f` | `−(x − (f − c))`                     | `+c`          |
| RECEIVE, fee included (payout x−f)                   | `−(x−f)`   | `−(x − (f − c))`                     | `+c`          |

### THE invariant (form unchanged from #66 — components re-derived)

> `Σ(drawer deltas) − Δ(owed to provider) = c + kept_change`

per currency, at the stamped rate for multi-currency splits. This is the same quotable rule
as before; only where the deltas land (all in PCD, none in a float) and the ledger formula
(gross, not fee-only) change. `OmtSystemFeeCharacterization.test.ts`'s `assertInvariant`
harness survives with new expected values.

### Settlement identity

Settlement pays the outstanding net `Σ owed` through real payment legs; a CASH leg resolves
to the **PCD**. After a full cycle (transactions + settlement) the ledger nets to **0** and
the drawer retains `Σc + kept_change + seeds/transfers`. A drawer that held only provider
money ends up holding exactly the shop's commission — matching the owner's physical reality.

### Negative balance policy

RECEIVE payouts are **blocked** when the drawer lacks funds in the payout currency
(per-currency check). The error is structured so the frontend can offer the
"move remaining from General" button (USD/LBP toggle). Other legs (SEND cash-in, fees)
cannot drive the drawer negative. Manual transfers/settlement use existing
insufficient-funds guards.

---

## 2. What changes vs. the float model (#66) ✅ DONE

| #   | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Where                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | **Delete the float legs**: SEND `−x` (`FinancialServiceRepository.ts:2276-2293`) and RECEIVE `+x` (`:2331-2342`) are removed.                                                                                                                                                                                                                                                                                                                                                                                                                  | FS repo                           |
| 2   | **Reroute cash legs**: every `paymentMethodToDrawerName()` call on the classic SEND/RECEIVE path resolves CASH → PCD when **`provider === shop_base_system`** — partner involvement does NOT enter the predicate (THROUGH-partner flows run on the secondary provider and fall out naturally; FOR-partner flows run on the primary system and route to the PCD, per decision #6). Full call-site list in §3 Phase B.                                                                                                                           | FS repo + friends                 |
| 3   | **Gross supplier ledger**: `feeOwedDelta()` and its SQL mirror `SUPPLIER_OWED_EXPR` (`FinancialServiceRepository.ts:423-448`) become `grossOwedDelta()` — one function + one SQL fragment, changed together (rule 14). RECEIVE books a signed negative entry; verify `addLedgerEntry` sign handling (`PAYMENT` force-negates — keep using signed `TOP_UP`/`ADJUSTMENT`, see #66's rationale in FEATURE_GUIDE §8).                                                                                                                              | FS repo, SupplierRepository reads |
| 4   | **`_System` ≠ internal anymore**: drop the `endsWith("_System")` (`TransactionRepository.ts:149`) and `NOT LIKE '%\_System'` (`:168`) predicates — PCD legs ARE customer-facing cash (in/out summary, D1 cash-flow, receipts, refund-override set must all see them). `INTERNAL_LEG_METHODS` and `PROVIDER_STOCK_DRAWERS` stay.                                                                                                                                                                                                                | TransactionRepository             |
| 5   | **Fund-the-float → generic cash transfer**: `fundSystemDrawer` (`DrawerTopUpRepository.ts:337-546`, v139 `system_float_topups`) is generalized into a bidirectional, reversible General↔PCD transfer (it already writes payments rows on both sides and is void-reversible — proven by `ProviderFloatTopUp.test.ts:451`). Widen/replace the `target_drawer` CHECK (`create_db.sql:893`, `migrations/index.ts:7038`). `createTopUpFromDrawer` (`:219-317`, raw-UPDATE, non-reversible, hardcoded General dest) is retired from this pair's use. | DrawerTopUp\*                     |
| 6   | **Keep the drawer names.** Renaming `OMT_System` → `OMT_Cash` would touch ~30 sites (constants, seeds, unions, specs) for zero user value; instead only **UI labels** change ("OMT Cash Drawer" / "Whish Cash Drawer"), derived from `shop_base_system` where the surface is shared.                                                                                                                                                                                                                                                           | UI only                           |

Explicitly **kept** from #66: single-point posting via `insertPaymentRow`/`applyDrawerDelta`
(`moneyPosting.ts`), drawer-name-agnostic reversal (`_reversePayments`,
`TransactionRepository.ts:1948-2013`), the store-credit reversal fix, walk-in-on-secondary
rejection, partner flows, the invariant-test harness, rule-17 discipline.

---

## 3. Work breakdown

> Before implementation: run the `new-money-feature` skill and the FEATURE_GUIDE §13
> checklist (CLAUDE.md rule 18). Every changed number needs a failing-first proof (rule 17).

### Phase A — Core model primitives ✅ DONE

1. **One routing resolver** (rule 14): e.g. `resolveServiceCashDrawer(method, ctx)` in
   `packages/core/src/utils/payments.ts` (beside `paymentMethodToDrawerName`), where
   `ctx = { provider, baseSystem }`. Returns the PCD
   (`baseSystem === "OMT" ? "OMT_System" : "Whish_System"`) for drawer-affecting cash-family
   methods whenever the transaction runs on the primary system (`provider === baseSystem`,
   partner or not — decision #6); falls through to `paymentMethodToDrawerName` otherwise. Do NOT touch `payment_methods.CASH.drawer_name`
   (blocked: `is_system=1` guard `PaymentMethodRepository.ts:162-172`; and
   `isNonCashDrawerMethod` tests `drawer_name !== "General"` — `payments.ts:47-57`).
2. **`grossOwedDelta()` + SQL mirror** replacing `feeOwedDelta`/`SUPPLIER_OWED_EXPR`
   (`FinancialServiceRepository.ts:423-448`). SEND `+(x+f−c)`, RECEIVE `−(x−(f−c))`.
3. Retire `SYSTEM_FLOAT_DRAWER_NAMES`' float meaning (`constants/systemFloatDrawers.ts:16`)
   — rename concept to "primary cash drawer"; keep the two name strings.

### Phase B — FinancialServiceRepository (the heavy lift) ✅ DONE

File: `packages/core/src/repositories/FinancialServiceRepository.ts`. It already reads
`baseSystem` inline (`:616-626`) and partner flags (`:601-607`) — reuse those locals.

- Remove float legs: SEND `:2276-2293`, RECEIVE `:2331-2342`.
- Apply the resolver at the classic-flow call sites: `:2055` (SEND split legs), `:2209`
  (SEND single), `:2237` (PM_FEE row), `:2354` (FEE leg — currently **hardcoded
  `"General"`**), `:2390`/`:2397` (cashout drawer), `:2481` (RECEIVE split payout),
  `:2499-2508` (**hardcoded `"General"` no-legs payout fallback**), and `:1128`
  (`processReturnLegs` change legs — needs the ctx threaded; partner disbursements at the
  same site must keep General per decision #6).
- **Do NOT touch**: cost/price flow `:1510/:1554`, wallet flows `:1715/:1783/:1883/:1905`
  (decision #5).
- **FOR-partner dispatch** `:1189-1434` (resolved, decision #6): the RECEIVE float credit
  at `:1403-1412` is REMOVED — a FOR-partner RECEIVE books obligations only (gross
  supplier-ledger entry for the primary provider + the partner-ledger row; the fee split
  between shop and partner is an implementation-time detail — owner-check if ambiguous).
  FOR-partner SEND disbursement OUT legs (`:1431` → `processReturnLegs` `:1128`) go through
  the resolver like every other primary-system cash leg → PCD.
- RECEIVE insufficient-funds guard: per-currency PCD balance check before payout legs;
  throw a structured error (`code: "INSUFFICIENT_DRAWER_FUNDS"`, shortfall per currency)
  the UI can act on.
- Supplier-ledger booking `:2555-2655` switches to `grossOwedDelta`.

### Phase C — Adjacent money repositories ✅ DONE

- **`SupplierRepository.settleTransactions`** (`:893-918`): CASH legs resolve via the same
  resolver (supplier == primary provider → PCD). Settle-tab reads move to the gross
  fragment. `recordSupplierCashflow` (`:1048`) reviewed the same way.
- **`DebtRepository`** service-debt repayment (`:440-570`) — **verified 2026-07-30, keep
  the mechanism as-is**: the leg credits its own drawer (CASH → General), then the RESERVE
  pair moves exactly the outstanding service-debt share into `OMT_System`/`Whish_System`
  (`:544-573`), capped per currency and net of change (`:501-505`). Under the new model
  that IS the owner's rule (repayment's OMT share physically moves to the drawer), the
  destination is already the PCD, and RESERVE ∈ `INTERNAL_LEG_METHODS` keeps the transfer
  pair out of customer cash-flow. The two-step (not direct-to-PCD) is load-bearing: a
  single leg can cover mixed debts and only the service share may route. Only the note
  text ("Reserve for X settlement" → drawer-move wording) and re-derived test numbers
  change. The `routedByDrawer` double-route guard (`:456-479`) keys on drawer+type and
  stays correct.
- **`TransactionRepository`**: predicates change (§2 #4); LIRA-078 refund-override
  replacement legs (`:1999`) re-derive drawer from method — must use the resolver for FS
  transactions or an overridden CASH refund of an OMT SEND leaks back to General.
- **`SalesRepository.getDrawerBalances`** (`:1438-1488`): pre-existing wart — the
  `startsWith("OMT")` fold (`:1472`) merges `OMT_System` + `OMT_App`. Now that OMT_System
  is a countable cash drawer, split the response (`omtCash` vs wallet) and update the
  consumer (`backend/src/api/dashboard.ts:38-43`) + e2e fixture contract
  (`frontend/tests/e2e-electron/fixtures.ts:752-777` hard-depends on the shape).

### Phase D — Session basket (riskiest seam) ✅ DONE

`SessionPaymentService.recordBasketPayment` (`:205-224`) resolves drawers by method only —
no provider context exists there today. **Rule (owner-confirmed): split by item share** —
the primary-system FS item's pro-rata portion of each cash leg → PCD, remainder → General
(deterministic order, per currency, rounding remainder to General). Work: thread the
basket's FS-item context (provider + amounts) into `BasketPaymentLeg`/the service. The
split mechanics still need their own mini-design at implementation time; it is the one
place the frontend/session layer knows something the money layer needs. Rule 16 (IN legs only) and the handover §4.1 warning
(payload-built tests can't see this seam) both bite here — cover with a UI-driven spec.

### Phase E — Transfers & guards ✅ DONE

- Generalize v139 `fundSystemDrawer` into `transferBetweenDrawers(General ↔ PCD)` —
  reversible, payments rows both sides, `TRANSFER`-family method (already in
  `INTERNAL_LEG_METHODS` so it stays out of customer cash-flow reports).
  **Mechanism decided 2026-07-30**: SQLite cannot ALTER a CHECK, and
  `system_float_topups.target_drawer CHECK IN ('OMT_System','Whish_System')`
  (`create_db.sql:893`) forbids the PCD→General direction — so migration v140 (verify
  latest version first — v139 is current) REBUILDS the table as `drawer_transfers` with
  `from_drawer`/`to_drawer` (rows migrated: `funding_drawer`→`from_drawer`,
  `target_drawer`→`to_drawer`), keeping `is_refunded`/`refunded_at` so the generic void
  path still owns reversal (rule 20). Update `create_db.sql` in the same change (rule 10)
  and the audit-viewer type mapping (`cashFlow.ts:170` `SYSTEM_FLOAT_TOPUP` case →
  `DRAWER_TRANSFER`). REST + IPC parity (rule 19): `drawer-topup:fund-system` /
  `POST /api/drawer-topup/fund-system` become the transfer endpoints; Zod schema in
  `packages/core/src/validators/` shared by both.
- `getSourceDrawerBalances` (`DrawerTopUpRepository.ts:550-564`) un-hardcode
  `'OMT_System'`.
- `DrawerCashoutRepository` stays General-only (owner drains PCD→General first).

### Phase F — Frontend ✅ DONE

- **Services page** (`frontend/src/features/services/pages/Services/index.tsx`): RECEIVE
  insufficient-funds UX — catch the structured error, show "Move X from General"
  button with USD/LBP toggle, call the transfer endpoint, retry submission. Remove the
  float top-up affordances (`:1174-1175`, `:2279-2281`) or relabel as drawer transfer.
- **Labels**: closing `DRAWER_CONFIGS` (`features/closing/config/drawers.ts`) — label
  `OMT_System` as "OMT Cash Drawer" (dynamic by `shop_base_system` where feasible);
  `CurrencyManager.tsx:616` `DRAWER_LABELS`; Dashboard `formatDrawerLabel`/`DRAWER_COLORS`.
- **Dashboard "Cash on Hand" strip** (`Dashboard.tsx:897-945`): under the new model
  `["General","OMT_System"]` is finally semantically CORRECT (both physical cash) — just
  relabel. TopBar `drawer_limit_omt` alert (`TopBar.tsx:195-213`) keeps working as a cash
  limit.
- **DrawerTopUpModal** (`features/dashboard/components/DrawerTopUpModal.tsx`): becomes the
  bidirectional transfer UI (General ↔ PCD).
- Closing UI: `OMT_System`/`Whish_System` are already in `DrawerType`/`DRAWER_ORDER` — no
  registration needed; verify the secondary system's dormant drawer presentation
  (Checkpoint page already has a partner-drawer gate, `Checkpoint/index.tsx:56/73`).
- Audit: stale doc comments claiming "CASH legs post to the General drawer"
  (`cashFlow.ts:205-210`, `auditConstants.ts:129`). The "Cash only (till)" filter is
  method-based (`cashFlow.ts:211-215`) — still correct.

### Phase G — Untouched by design (verified by audit)

- **Profit**: 100% drawer-agnostic (stamped on `transactions.profit_*`; the one
  payments-based report buckets by method). No profit number changes.
- **Split payments frontend**: `MultiPaymentInput` never names a drawer — zero changes.
- **Closing backend**: `getSystemExpectedBalancesDynamic`, `recalculateDrawerBalances`,
  checkpoint creation/variance — all generic by drawer name.
- **Void/refund**: `_reversePayments` mirrors `payments.drawer_name` — generic path covers
  everything that is a payments row (rule 20: no new ledger row type is introduced except
  the gross supplier entries, whose reversal owner is the existing soft-void path).

---

## 4. Test plan ✅ DONE (one named e2e spec not re-derived — see Left TODO)

- **Re-derive `OmtSystemFeeCharacterization.test.ts`** (CASE 1–8b) to the §1 table:
  every case asserts the invariant with PCD deltas + gross ledger. Every changed number
  proven failing-first (rule 17), single-agent, per handover §4.3.
- **`SupplierRepository.settlement.test.ts`**: mixed SEND+RECEIVE batch nets ledger to 0;
  drawer delta at settlement = −(net owed) **into** the PCD legs (no longer "zero
  OMT_System delta" — that assertion inverts).
- **`ProviderFloatTopUp.test.ts`** → transfer semantics (both directions + reversal).
- **New**: RECEIVE insufficient-funds block + transfer-and-retry (UI-driven, lira-131
  pattern — the frontend does arithmetic here, so payload-built specs are insufficient
  per handover §4.1); session-basket routing spec (Phase D).
- **E2E sweep** — specs asserting General deltas for OMT flows will fail by design and
  need re-derivation: `lira-131`, `lira-064`, `lira-074`, `lira-076`, `lira-088`,
  `lira-095`, `lira-098`, `lira-101`, `lira-106/107`, `lira-119`, web `lira-web-016`.
  Follow rule 15 (identity + delta assertions, never row position).
- Run `yarn check:tenant-scoping` after every repository SQL edit (not in CI yet —
  handover §3.3).
- Baseline gates per handover §5. **Verified green 2026-07-30 (pre-implementation), on a
  working tree containing only unrelated uncommitted deployment changes**: core jest
  1205/1205 (113 suites), backend 500/500 (36 suites), frontend 663 passed / 1 skipped
  (82 suites), typecheck clean, lint 0 errors / 524 warnings (matches the documented
  warning baseline), `check:tenant-scoping` 0 violations / 629 statements. Desktop/web
  e2e NOT run at baseline (their OMT assertions get re-derived by this feature anyway);
  run them once at implementation start if an untouched-spec baseline is wanted.

---

## 5. Cutover ✅ DONE

Owner wipes the DB and starts fresh (their explicit decision — no balance migration).
The fresh-install path must therefore be first-class: `create_db.sql` + migrations stay in
sync (rule 10); opening PCD balance set by physical count via Initial Drawer Amounts /
setup wizard. The #66 "settle-to-zero" release blocker is mooted for the owner's install;
multi-tenant web installs (if any hold real data) need the same wipe-or-count decision
before upgrade — flag at release time.

---

## 6. Open items & risks

1. **Partner settlement source drawer** (`PartnerRepository.ts:498/:575`): a partner
   balance can mix THROUGH (secondary-system, General-cash) and FOR (primary-system,
   PCD-cash) history. Per decision #6 the FOR side's cash belongs to the PCD — give the
   partner settle form an explicit source-drawer choice; default per provenance if
   derivable, else PCD for primary-system partners. Confirm exact default at
   implementation. (The FOR-partner RECEIVE question itself is RESOLVED — decision #6.)
2. **`"FEE"` method tag audit** (handover §3.1) — still open and now MORE relevant: the
   FEE leg moves to the PCD. Fold the audit into Phase B.
3. **RECEIVE fee tiers not direction-gated** (handover §3.4) — still awaiting owner.
4. **OMT_App top-up default source** (`TOP_UP_PROVIDER_DEFAULT_SOURCES.OMT_APP =
"OMT_System"`, `constants/rechargeProviders.ts:38-47`): with no float, recommend default
   General, keep PCD selectable. Owner-confirm at implementation.
5. **Session-basket split mechanics** (Phase D): the RULE is decided (split by item
   share); the implementation design (context threading, per-currency rounding) still
   needs its own pass; highest seam risk.
6. **Idempotency gap** (handover §6) — unchanged, still unowned; the new transfer endpoint
   inherits it.
   6a. **[OWNER] FOR-partner SEND books no supplier-ledger entry** (pre-existing, unchanged).
   Decision #6 resolved the RECEIVE side only. The transfer still runs on the real provider
   rails, so a symmetric gross entry is arguably owed — left as-is rather than guessed.
   6b. **Session cart fee convention** (Phase D): the pro-rata split assumes a cart line's
   `amount` for an FS SEND already INCLUDES the customer fee. If the cart stores it
   fee-excluded, the split mechanism stays correct but the ratio's input is wrong. Confirm
   against the frontend basket-item construction, then pin it with the Phase D spec.
   The subtotal also counts any FS row whose provider matches the base system (including
   BILL*PAYMENT), not just SEND/RECEIVE — confirm that is intended.
   6c. **Transfer validator accepts any drawer pair** (`validators/drawerTransfer.ts`): no
   name enum, matching the plan's "generic transfer" language; the UI only offers
   General↔PCD. Decide whether the backend should hard-restrict one side.
   6d. **Suppliers page stale comments + settle math under gross**
   (`features/suppliers/**`, `hooks/useSuppliers.ts`): comments still describe the fee-only
   model and call the PCD "never a real cash drawer". `settleNetPayUsd` sums `supplier_owed`
   and is \_probably* still correct under gross, but it was out of the labels-only agent's
   scope — needs a money-eyes pass, not a comment fix.
   6e. **Session-basket PCD payouts have no insufficient-funds guard** — decision #11's guard is
   scoped to the FS RECEIVE path only. Decide whether a basket-level cash-out sharing the
   PCD needs the same block.
7. ~~Gross-ledger sign handling~~ **VERIFIED 2026-07-30**: `addLedgerEntry`
   (`SupplierRepository.ts:373-379`) force-negates ONLY `entry_type: "PAYMENT"`; `TOP_UP`
   and `ADJUSTMENT` pass through signed as-is — a RECEIVE's negative gross entry books
   correctly as signed `TOP_UP` (same convention #66 already used for its fee-only
   entries). Also noted: `drawer_name` is rejected on non-PAYMENT entries (`:356-359`) —
   the gross auto-entries carry no drawer, so no conflict.
8. Docs: rewrite FEATURE_GUIDE §7/§8/§8.1 and mark the float-model handover as superseded
   (keep its traps §4 — they are process lessons, not model claims).

## 8. Implementation contract — BINDING on every implementing agent ✅ DONE

Written 2026-07-30 before the implementation fleet launched. Parallel agents depend on these
exact names/formulas without seeing each other's diffs. **If you must deviate, report the
deviation loudly in your final report — do not silently pick another shape.**

### 8.1 Vocabulary + naming ✅ DONE

- **PCD** = "primary cash drawer" = `OMT_System` when `shop_base_system = 'OMT'`,
  `Whish_System` when `'WHISH'`. **Drawer-name strings never change.**
- `packages/core/src/constants/systemFloatDrawers.ts` keeps its PATH (avoid re-export churn)
  but its exports are renamed and re-exported from `constants/index.ts`:
  ```ts
  export const PRIMARY_CASH_DRAWER_NAMES = [
    "OMT_System",
    "Whish_System",
  ] as const;
  export type PrimaryCashDrawerName =
    (typeof PRIMARY_CASH_DRAWER_NAMES)[number];
  export function primaryCashDrawerName(
    baseSystem: "OMT" | "WHISH",
  ): PrimaryCashDrawerName;
  ```
  The old `SYSTEM_FLOAT_DRAWER_NAMES` name is removed (all consumers updated).

### 8.2 The routing resolver (single definition — rule 14) ✅ DONE

```ts
// packages/core/src/utils/payments.ts
export type BaseSystem = "OMT" | "WHISH";
export interface ServiceCashDrawerContext {
  provider: string;
  baseSystem: BaseSystem;
}
export function resolveServiceCashDrawer(
  method: string,
  ctx: ServiceCashDrawerContext,
): string;
```

Returns the **PCD** iff ALL hold, else falls through to `paymentMethodToDrawerName(method)`:

1. `ctx.provider === ctx.baseSystem` — string equality. `"OMT_APP"` never equals `"OMT"`, so
   app wallets/Binance fall through automatically (decision #5). Partner involvement is NOT
   part of the predicate (decision #6: route by the system the transaction runs on).
2. `isDrawerAffectingMethod(method)` is true.
3. `paymentMethodToDrawerName(method) === "General"` — i.e. a cash-family tender. A tender
   already bound to its own drawer (wallets) keeps it.
4. `method !== "GIFT_CARD"` — a voucher is not banknotes; preserve today's behavior.

`payment_methods.CASH.drawer_name` MUST NOT be repointed (blocked by the `is_system` guard at
`PaymentMethodRepository.ts:162-172`, and `isNonCashDrawerMethod` tests `drawer_name !== "General"`
— a global remap would reclassify CASH as a wallet method).

### 8.3 Supplier-ledger formula (single definition + SQL mirror — rule 14) ✅ DONE

Replaces `feeOwedDelta()` / `SUPPLIER_OWED_EXPR` (`FinancialServiceRepository.ts:423-448`):

```
grossOwedDelta:  SEND    → +(principal + fee − commission)
                 RECEIVE → −(principal − fee + commission)
```

- `principal` = the repo's existing `sentAmount` (SEND) / `receiveAmount` (RECEIVE, bare).
  **Fee-on-top vs fee-included needs no branch**: the frontend pre-nets, so `sentAmount` is
  already the true principal and `totalCollected = sentAmount + fee` is what the customer hands.
- `fee` = `resolvedProviderFee` (`f`); `commission` = shop's cut (`c`, always 0 for WHISH).
- Per currency. Signed `TOP_UP` entries both directions (**verified**: `addLedgerEntry`
  force-negates only `entry_type: "PAYMENT"`, `SupplierRepository.ts:373-379`; and it rejects
  `drawer_name` on non-PAYMENT rows, `:356-359` — auto entries carry none).
- `SUPPLIER_OWED_EXPR` must reproduce the identical number from `financial_services` columns;
  change both together or the Settle tab and the ledger disagree.

**Worked example** (USD, principal 100, f 5, c 0.5): SEND `+104.5`; RECEIVE `−95.5`.
Full SEND+RECEIVE cycle: drawer `+105 − 95 = +10`, owed `+104.5 − 95.5 = +9`, difference
`1 = 2c`. ✅ invariant holds per transaction.

### 8.4 The invariant every money test asserts ✅ DONE

> `Σ(drawer deltas) + Σ(receivable deltas) − Δ(owed to provider) = c + kept_change`

per currency (stamped rate for multi-currency splits). The receivable term covers
CUSTOMER_ACCOUNT-funded legs exactly as the existing `assertInvariant` helper in
`OmtSystemFeeCharacterization.test.ts` already models them — preserve that handling.

### 8.5 ~~Insufficient-funds contract~~ — WITHDRAWN 2026-08-01

**Decision #11 was reversed by the owner; this section describes code that no
longer exists.** No drawer operation is blocked anywhere: not the RECEIVE
payout, not a drawer↔drawer transfer. `InsufficientDrawerFundsError` and its
`details` shape are deleted (nothing threw them once the guards went), the
Services page's shortfall panel and move-and-retry are gone, and the modal's
client-side funds check is gone.

**What survives, and must not be re-removed:** the `code`/`details` envelope
plumbing through `FinancialService` / `DrawerTopUpService` → IPC and REST. That
is the general `AppError` contract (rule 19c), not a feature of this guard, and
it is what carries the FOR-partner `BusinessRuleError` (§0 decision 6b) to the
UI today. `FinancialService.errorEnvelope.test.ts` guards it, standing on
`DatabaseError` now that the original trigger is gone.

**Replacement behaviour:** `DrawerTopUpModal` renders a negative-balance panel
listing each drawer/currency in the red with a "Cover it" button that aims the
transfer at that drawer and pre-fills the clearing amount. Surfaced there
because that is the only screen where the operator can act on it.

The original contract, for the record:

<details><summary>Withdrawn §8.5</summary>

Thrown by the repository BEFORE any payout leg posts, checked per currency against the PCD:

```ts
class InsufficientDrawerFundsError extends Error {
  code = "INSUFFICIENT_DRAWER_FUNDS";
  details: {
    drawer: string;
    shortfall: { USD?: number; LBP?: number };
    available: { USD?: number; LBP?: number };
    required: { USD?: number; LBP?: number };
  };
}
```

Both transports surface it identically (rule 19c), extending the standard envelope:
`{ success: false, error: <message>, code: "INSUFFICIENT_DRAWER_FUNDS", details: {...} }`
(REST still HTTP 200). The Services page catches `code` — never a message-string match.

</details>

### 8.6 Drawer-transfer contract (replaces fund-the-float) ✅ DONE

- **Migration v140** (`v139` is the current max, verified) —
  `rebuild_system_float_topups_as_drawer_transfers`: SQLite cannot ALTER a CHECK, so rebuild.
  ```sql
  CREATE TABLE drawer_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
    from_drawer TEXT NOT NULL,
    to_drawer   TEXT NOT NULL,          -- no CHECK: both directions must be legal
    amount_usd REAL NOT NULL DEFAULT 0,
    amount_lbp REAL NOT NULL DEFAULT 0,
    notes TEXT, created_by INTEGER,
    is_refunded INTEGER DEFAULT 0, refunded_at TEXT DEFAULT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  ```
  Migrate rows `funding_drawer → from_drawer`, `target_drawer → to_drawer`; drop the old table.
  `down()` rebuilds the old shape. Mirror in `create_db.sql` (rule 10).
- **Repository**: `transferBetweenDrawers({ fromDrawer, toDrawer, amountUsd, amountLbp, notes, createdBy })`
  — both sides via `insertPaymentRow` + `applyDrawerDelta` (so the generic void path owns
  reversal, rule 20). Guards: drawers distinct, amounts finite/non-negative, at least one > 0,
  sufficient funds in `fromDrawer` per currency. Register the source table in the reversible
  list alongside the old `system_float_topups` entry.
- **Transaction type**: `TRANSACTION_TYPES.SYSTEM_FLOAT_TOPUP` → `DRAWER_TRANSFER`
  (`constants/transactionTypes.ts:31`); leg method string likewise. Consumers to update:
  `frontend/src/features/audit/auditConstants.ts:318`, `cashFlow.ts:170` (stays `"both"`).
- **Validator**: `packages/core/src/validators/drawerTransfer.ts`, shared by IPC + REST.
- **Transports**: IPC `drawer-topup:transfer` + REST `POST /api/drawer-topup/transfer`
  (`authenticateJWT` → `requireRole(["admin","staff"])`). Adapter fn on `useApi()`:
  `transferBetweenDrawers(data)`. The old `fund-system` channel/route is retired.

### 8.7 File ownership during the implementation fleet

Each agent edits ONLY its own files. If a change is needed outside your set, report it —
do not reach across. Barrel files (`constants/index.ts`, `repositories/index.ts`,
`services/index.ts`) belong to the core-money agent.

## 8bis. Implementation status (2026-07-30, branch `feat/primary-cash-drawer`)

**Phases A–G are IMPLEMENTED. Tests are NOT.** Ten agents landed the change across 44 files
in one run; gates below were green at hand-off.

| Gate                              | Result                                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `packages/core` build             | clean                                                                                                                  |
| `yarn typecheck` (all workspaces) | clean                                                                                                                  |
| `yarn lint`                       | 0 errors / 524 warnings (baseline exactly)                                                                             |
| `yarn check:tenant-scoping`       | **0 violations / 634 statements** (baseline 629; +5 from `transferBetweenDrawers`, all scoped)                         |
| core jest                         | 99/113 suites pass; **14 suites / 55 tests fail — all classified (a) expected model change, zero suspected real bugs** |

The 55 failures are the deliberate re-derivation surface (§4). Spot-check that gives real
confidence: the failing numbers reproduce §8.3's worked example exactly — the ledger reads
104.5 where the old fee-only model read 4.5, and −95.5 / −99.1 on RECEIVE.

**Two cross-agent seam gaps were found by the agents and closed by hand afterwards** (neither
was in any agent's file ownership — this is the predictable cost of parallel file partitioning):

1. **`FinancialService.ts` swallowed `code`/`details`.** Its catch collapsed every error to a
   bare string, so `InsufficientDrawerFundsError` reached the UI without its code — silently
   disabling the entire owner-requested "move the shortfall from General and retry" flow over
   BOTH transports. Now mirrors `DrawerTopUpService.transferBetweenDrawers` via `isAppError`.
   `FinancialServiceResult` and `electron.d.ts`'s `omt.addTransaction` widened to match.
2. **`DRAWER_TRANSFER` was missing from `INTERNAL_LEG_METHODS`.** Removing the
   `endsWith("_System")` exclusion (§2 #4) was correct for customer cash, but it had been the
   only thing keeping the cash-drawer side of a transfer out of the reports — so BOTH legs of
   every General↔PCD transfer would have leaked into the D1 cash-flow report and the in/out
   summary as customer money. Added to the set (the SQL mirror derives from it, so one edit).

**Newly surfaced, unresolved** (added to §6): FOR-partner SEND ledger symmetry; the session
cart's fee convention; the transfer validator accepting any drawer pair; the Suppliers page's
stale fee-only comments and its settle math under gross.

### 8bis.1 Second owner pass — 2026-08-01 (after the first e2e run)

The owner ran desktop e2e; 15 specs failed. **14 were this feature and every one was an
outdated expectation, not a defect** — the §4 sweep, which had not run yet. The 15th (Exchange)
came from the v1.29.14 split-payout release and was unrelated; it has since been fixed in the
working tree independently.

Three rulings came out of triage, all now implemented:

1. **Nothing is blocked** (decision #11 reversed — see §0 and the withdrawn §8.5). This
   removed 6 of the 14 failures outright.
2. **All primary-provider supplier cash routes through the PCD**, not just fee settlement —
   the owner widened decision #10 to cover ad-hoc supplier payments and receipts (lira-059).
3. **FOR-partner is rejected on the secondary system** (§0 decision 6b) — the backend was
   drifting from a rule the UI has always enforced.

**The lesson worth keeping from this round**: the failing e2e specs were the _only_ thing that
found the lira-059 and lira-075 routing consequences — my §4 sweep list missed both, having
been derived from a drawer-balance audit rather than from "which specs assert General deltas
for OMT flows". And lira-119's Whish FOR-partner cases had been asserting balances for a
combination **the real app cannot produce**, because that spec hand-builds IPC payloads and
never touches a locator (handover §4.1, again). A payload-built spec can encode a fiction and
stay green for months.

## 9. Out of scope (recorded for later)

- Per-shop config to merge the PCD into General (owner: "later on we can make this
  configurable").
- Any account-balance tracking at the provider (owner: "we will check it later" — if a
  real in-system balance ever needs tracking again, it must be a NEW drawer, not this one;
  this drawer is physical cash).

## Left TODO

<!--
//TODO — Validation pass 2026-08-04. Verdict: PARTIAL — Phases A-G, migration v140,
//TODO   IPC/REST parity, and the FEATURE_GUIDE §7/§8/§8.1 rewrite are all VERIFIED in code
//TODO   (cross-checked against commit 9553807); one e2e spec explicitly named in the plan's
//TODO   own §4 sweep list was never re-derived and still asserts the REJECTED float model,
//TODO   plus a handful of stale doc-comments/dead code referencing the withdrawn §8.5 guard.
//TODO
//TODO   VERIFIED DONE (do not redo):
//TODO   - Phase A: resolveServiceCashDrawer (packages/core/src/utils/payments.ts:119-132);
//TODO     grossOwedDelta + SUPPLIER_OWED_EXPR SQL mirror (FinancialServiceRepository.ts:521-558);
//TODO     PRIMARY_CASH_DRAWER_NAMES/primaryCashDrawerName (constants/systemFloatDrawers.ts:25-34,
//TODO     re-exported via constants/index.ts:4); old SYSTEM_FLOAT_DRAWER_NAMES/feeOwedDelta fully
//TODO     gone from live code (repo-wide grep: comments only).
//TODO   - Phase B: old float legs (SEND/RECEIVE principal credited to OMT_System/Whish_System as
//TODO     an in-provider balance) deleted, not relocated (FinancialServiceRepository.ts ~2564-2583,
//TODO     confirmed against `git show 9553807`); resolver called at 8 sites (:1275, :2349, :2509,
//TODO     :2546, :2616, :2656, :2763, :2788); FEE leg (:2611-2629) and RECEIVE no-legs fallback
//TODO     (:2783-2800) no longer hardcoded "General"; FOR-partner RECEIVE books ledger-only, no
//TODO     drawer leg (:1653-1715); wallet/cost-price flows (:1730-2219) untouched by the resolver.
//TODO   - Phase C: SupplierRepository.settleTransactions/recordSupplierCashflow route CASH via the
//TODO     resolver (SupplierRepository.ts:927, :1087); DebtRepository RESERVE-pair mechanism kept
//TODO     as-is, wording updated to drawer-move language (DebtRepository.ts:556-579), no leftover
//TODO     "Reserve for X settlement" text; TransactionRepository's endsWith("_System") (was :149)
//TODO     and `NOT LIKE '%\_System'` (was :168) predicates both dropped (:153-177, :181-197);
//TODO     refund-override (LIRA-078) re-derives drawer via resolver (:2001-2045, :2106-2110);
//TODO     SalesRepository.getDrawerBalances (:177-195, :1459-1569) splits omtDrawer vs
//TODO     appWalletDrawer (no more startsWith("OMT") fold); backend/src/api/dashboard.ts:38-62 and
//TODO     frontend/tests/e2e-electron/fixtures.ts:754-775 both compatible with the new shape.
//TODO   - Phase D: SessionPaymentService.recordBasketPayment does a REAL pro-rata split (not the
//TODO     unimplemented state the plan itself worried about) via
//TODO     SessionPaymentRepository.getSessionCashSplitContext (:179-230) and
//TODO     splitCashLegByItemShare, posting independent PCD/General legs
//TODO     (SessionPaymentService.ts ~L228-373); covered by
//TODO     packages/core/src/services/__tests__/SessionPaymentService.basket.test.ts with a worked
//TODO     example matching the owner's split-by-item-share rule.
//TODO   - Phase E: migration v140 rebuild_system_float_topups_as_drawer_transfers
//TODO     (packages/core/src/db/migrations/index.ts:7066-7159, up() creates drawer_transfers with
//TODO     no CHECK constraint, migrates funding_drawer->from_drawer/target_drawer->to_drawer, drops
//TODO     the old table; down() rebuilds the old shape); electron-app/create_db.sql:947-962 defines
//TODO     drawer_transfers with matching schema_migrations row at :1632-1633; transferBetweenDrawers
//TODO     (DrawerTopUpRepository.ts:369-548) posts both legs via insertPaymentRow+applyDrawerDelta
//TODO     and correctly has NO sufficient-funds guard (decision #11 reversal, documented in a
//TODO     comment at :420-431); TRANSACTION_TYPES.DRAWER_TRANSFER replaces SYSTEM_FLOAT_TOPUP
//TODO     (constants/transactionTypes.ts:68); validators/drawerTransfer.ts exists (plain-string
//TODO     drawer names, no enum — matches the plan's own open item 6c); IPC drawer-topup:transfer
//TODO     (electron-app/handlers/drawerTopUpHandlers.ts:155-213, old fund-system channel fully
//TODO     retired) + REST POST /api/drawer-topup/transfer (backend/src/api/drawerTopUp.ts:129-153)
//TODO     both wired to the same service; adapter transferBetweenDrawers wired through
//TODO     electron-app/preload.ts:785-792, frontend/src/api/backendApi.ts:3128-3137,
//TODO     ElectronApiAdapter.ts:701-709; DRAWER_TRANSFER added to INTERNAL_LEG_METHODS
//TODO     (TransactionRepository.ts:128) — the cross-agent gap the plan's §8bis says was closed
//TODO     by hand, confirmed present.
//TODO   - Phase F: Services/index.tsx has no shortfall panel / retry UI (removed cleanly, only
//TODO     explanatory comments remain at :668-673, :1180-1188); DrawerTopUpModal.tsx:418-488 renders
//TODO     the negative-balance panel with a "Cover it" button that pre-fills the clearing transfer,
//TODO     no client-side blocking check (disabled= expression at :790-794 does not include the
//TODO     insufficient-funds flag); FinancialService.ts:120-138 catch block now propagates
//TODO     code/details via isAppError() instead of collapsing to a string; drawer labels updated in
//TODO     closing/config/drawers.ts:28-38/116-126, CurrencyManager.tsx:619-630,
//TODO     Dashboard.tsx:139-146; Cash-on-Hand strip is dynamic by shop_base_system
//TODO     (Dashboard.tsx:915-930); stale "CASH always posts to General" comments corrected in
//TODO     cashFlow.ts:213-221 and auditConstants.ts:124-134; Checkpoint/index.tsx:54-73 partner-
//TODO     drawer gate for the dormant secondary system is intact.
//TODO   - Test plan: OmtSystemFeeCharacterization.test.ts re-derived to PCD+gross values (e.g. CASE
//TODO     3 SEND asserts +105 drawer / +104 supplier ledger, not the old fee-only numbers);
//TODO     SupplierRepository.settlement.test.ts nets the ledger to 0 with the settlement debit
//TODO     landing in the PCD (not the old "zero OMT_System delta" assertion, which is noted inline
//TODO     as inverted); ProviderFloatTopUp.test.ts was renamed to
//TODO     packages/core/src/repositories/__tests__/DrawerTransfer.test.ts and covers both transfer
//TODO     directions plus void/reversal; SessionPaymentService.basket.test.ts (Phase D, UI-driven
//TODO     per rule 16/handover §4.1) covers the split-by-item-share worked example.
//TODO   - Docs: docs/FEATURE_GUIDE.md §7/§8/§8.1 (lines ~224-412) fully rewritten to the PCD/gross
//TODO     model, with the old PR #66 float model preserved ONLY inside a clearly labeled
//TODO     "Historical — superseded" <details> block; docs/plans/todo_plans/OMT_FLOAT_MODEL_HANDOVER.md
//TODO     carries an explicit "⚠️ SUPERSEDED 2026-07-30" banner at its top (lines 3-15) plus repeated
//TODO     "(historical)" markers throughout.
//TODO
//TODO   REMAINING:
//TODO   1. frontend/tests/e2e-web/lira-web-016-omt-system-float-fee.spec.ts — named explicitly in
//TODO      this plan's own §4 sweep list, but was never touched by the implementation commit. It
//TODO      still asserts the REJECTED PR #66 float-model numbers end-to-end over REST (e.g. OMT
//TODO      drawer delta of bare -50/-100 principal instead of the gross PCD delta, ledger delta of
//TODO      +3.6 fee-only instead of the gross +53.6-style figure). This is the one substantive gap:
//TODO      a web-parity regression test currently documents/proves the WRONG model. Needs the same
//TODO      re-derivation already done for lira-074/lira-076/lira-119/lira-131.
//TODO   2. Stale JSDoc/comments still describe the WITHDRAWN §8.5 insufficient-funds guard as if
//TODO      live (no functional code path emits INSUFFICIENT_DRAWER_FUNDS any more, so this is
//TODO      doc-only risk — a future reader/agent could reintroduce the removed guard thinking it's
//TODO      still expected): packages/ui/src/api/types.ts:562-566 (addOMTTransaction doc) and
//TODO      :572-577 (transferBetweenDrawers doc); packages/core/src/services/FinancialService.ts:38-46
//TODO      (FinancialServiceResult.code doc); frontend/src/api/backendApi.ts:3121-3127.
//TODO   3. Minor cleanup: dead `getBalance()` helper in DrawerTopUpRepository.ts:409-418 (never
//TODO      called since the funds-guard it served was removed); unused `primaryCashDrawerName`
//TODO      import in FinancialServiceRepository.ts:17; and this plan's own §8bis status line
//TODO      ("Tests are NOT [implemented]") is now stale — tests were added in the later pass
//TODO      documented by §8bis.1 and the test files listed above, but the earlier line was never
//TODO      corrected.
//TODO
//TODO   DOC DEBT: FEATURE_GUIDE §7/§8/§8.1 do NOT still describe the superseded model — verified
//TODO   rewritten verbatim to the PCD/gross model (per-case table, worked example +104.5/-95.5, the
//TODO   "PCD is physical cash, not a float" framing all present), with the old float model fenced
//TODO   off in a clearly labeled historical block. The narrower doc debt that DOES remain is the
//TODO   3 stale JSDoc/comment sites in REMAINING item 2 above (unrelated to FEATURE_GUIDE — they
//TODO   describe the separately-withdrawn §8.5 guard, not the float-vs-PCD model).
//TODO
//TODO   CORRECTED DETAILS:
//TODO   - Plan text (Phase D) says "thread... into `BasketPaymentLeg`/the service" — the actual
//TODO     implementation instead added `SessionCashSplitContext`/`getSessionCashSplitContext` in
//TODO     packages/core/src/repositories/SessionPaymentRepository.ts (computed once per session
//TODO     server-side, not per client-supplied leg) — functionally equivalent and arguably safer,
//TODO     but a real name/shape deviation from the plan's literal vocabulary; `BasketPaymentLeg`
//TODO     itself was NOT widened.
//TODO   - Plan suggests response field names `omtCash`/`wallet` for SalesRepository.getDrawerBalances
//TODO     — actual fields are `omtDrawer`/`appWalletDrawer` (SalesRepository.ts:177-195).
//TODO   - `ProviderFloatTopUp.test.ts` was renamed (not edited in place) to
//TODO     packages/core/src/repositories/__tests__/DrawerTransfer.test.ts.
//TODO   - Migration v140 landed exactly as planned, but the real current max migration version is
//TODO     now v142 (`add_carrier_line_movement_previous_validity`) — two unrelated migrations
//TODO     landed after v140. Any future migration must increment from 142, not 140.
//TODO
//TODO   GATE when picked up:
//TODO   - Re-derive lira-web-016 to PCD/gross assertions (pattern: lira-074/lira-076/lira-119/
//TODO     lira-131), following the required `yarn dev` → stop → `yarn test:e2e:web` sequence.
//TODO   - Update the 3 stale JSDoc/comment sites (REMAINING item 2) to match the wording already
//TODO     used in Services/index.tsx and DrawerTopUpModal.tsx for the withdrawn §8.5 guard.
//TODO   - Remove the dead `getBalance()` helper and the unused `primaryCashDrawerName` import
//TODO     (REMAINING item 3); correct the stale §8bis status line.
//TODO   - Re-run `yarn typecheck` and `yarn lint` after cleanup (documented baseline: 0 errors /
//TODO     524 warnings). `yarn check:tenant-scoping` only needed if DrawerTopUpRepository.ts SQL
//TODO     is touched by the dead-code removal.
-->

**Summary — 3 item(s) left:** The Primary Cash Drawer implementation itself is done and verified
correct in code — the routing resolver, the gross supplier-ledger formula, the migration that
rebuilds the transfer table, the IPC/REST transfer endpoints, the frontend labels and the new
negative-balance "Cover it" UI, the withdrawal of the insufficient-funds block, and the
FEATURE_GUIDE rewrite were all independently re-derived from the actual source and cross-checked
against the real implementing commit (9553807). What's left is small: one web e2e spec
(`lira-web-016`) that the plan itself flagged for re-derivation was never touched and still proves
the rejected float model instead of the shipped one — that should be fixed before anyone relies on
web-parity e2e as a safety net for this feature. The rest is housekeeping: a few stale doc-comments
that still describe a guard the owner explicitly withdrew, one dead helper function, one unused
import, and one outdated status line in this plan's own §8bis. None of the remaining items touch
money correctness in the shipped code paths.
