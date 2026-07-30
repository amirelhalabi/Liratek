# Primary-System Cash Drawer — Feature Plan

**Status: PLANNED** — owner interviewed 2026-07-30, all model decisions recorded below.
**Supersedes the float-model semantics of PR #66.** The owner's verdict (2026-07-30, verbatim):
"we dont have omt system balance.. no need for another drawer. we can use our omt system
drawer" and "I don't really care about this float model … I think the float model is
something wrongly implemented." The float model's *structural* fixes stay (no double-debits,
reversal symmetry, settlement that nets to zero, the invariant-asserting test harness); its
*semantics* (in-system spendable balance, fee-only supplier ledger) are replaced.

Read together with `docs/FEATURE_GUIDE.md` §7/§8/§8.1 (which this plan will rewrite) and
`docs/plans/todo_plans/OMT_FLOAT_MODEL_HANDOVER.md` (open threads §3.1–§3.4 still apply,
see §6 below).

---

## 0. Owner decision record (2026-07-30 interview)

| # | Question | Decision |
|---|----------|----------|
| 1 | What is `OMT_System`? | **The physical dedicated cash drawer at the counter.** There is NO account/float balance at OMT to track. The drawer is countable at closing like any cash box. |
| 2 | New drawer or reuse? | **Reuse `OMT_System` / `Whish_System`** — no new drawer name. |
| 3 | Scope | Symmetric by **primary system** (`shop_base_system`): OMT primary → `OMT_System` is the active cash drawer; Whish primary → `Whish_System`. The secondary system's drawer lies dormant. Future (out of scope now): a per-shop config to merge this drawer into General. |
| 4 | Which cash goes in it | **Everything from primary-system SEND/RECEIVE**: customer payment `(x+f)`, RECEIVE payouts, change/return legs, the customer fee. |
| 5 | App wallets / Binance | **General**, unchanged. Only classic system SEND/RECEIVE uses the drawer. |
| 6 | Partner-routed (THROUGH/FOR, secondary system) | **General**, unchanged. |
| 7 | Session-basket primary-system items | **Yes** — the basket's cash share for the FS item routes to the drawer (needs provider context in the session path, §3 Phase D). |
| 8 | Service-debt repayments (client pays an OMT debt later) | **Into the drawer.** |
| 9 | Supplier ledger ("owed to OMT") | **Gross**: SEND books `+(x + f − c)`; RECEIVE books `−(x − (f − c))`. Replaces #66's fee-only `feeOwedDelta`. |
| 10 | Settlement source | Settlement pays the net owed **from the drawer** (via normal payment legs whose CASH resolves to the drawer). |
| 11 | RECEIVE payout, insufficient drawer funds | **Block**, and show an inline button "move remaining from General" **with a USD/LBP currency toggle**; after the transfer the transaction proceeds. |
| 12 | Manual transfers | **General ↔ drawer, both directions**, in the UI. |
| 13 | Fund-the-float (v139) | Obsolete as a concept; its reversible transfer plumbing is repurposed as the generic drawer↔General cash transfer. |
| 14 | Cutover | **Owner wipes the DB and starts fresh.** No balance/data migration needed for the owner's install. Schema migrations still required for the upgrade path + multi-tenant web (rule 10). Opening drawer balance set by physical count via Initial Drawer Amounts. |

---

## 1. The model

`OMT_System` (or `Whish_System` when Whish is primary) = **the banknotes physically inside
the dedicated money-transfer drawer**. No leg represents a balance inside the provider's
system — that concept is deleted.

Three quantities, same as before: `x` principal, `f` customer fee, `c` shop commission
(`c ≤ f`, `c = 0` for WHISH).

### Per-case drawer table (replaces FEATURE_GUIDE §8.1's four-row table)

Cash legs of a primary-system, non-partner transaction target the **primary cash drawer**
(`PCD` below). Non-cash tenders (CUSTOMER_ACCOUNT, wallets, gift card) keep their existing
non-drawer / own-drawer behavior.

| Case | PCD legs | Δ owed to provider (supplier_ledger) | PCD Σ − Δowed |
|------|----------|--------------------------------------|----------------|
| SEND, fee on top (customer hands x+f cash) | `+(x+f)` | `+(x + f − c)` | `+c` |
| SEND, fee included (customer hands x; principal x−f) | `+x` | `+((x−f) + f − c) = +(x − c)` | `+c` |
| RECEIVE, fee on top (payout x, fee f collected) | `−x`, `+f` | `−(x − (f − c))` | `+c` |
| RECEIVE, fee included (payout x−f) | `−(x−f)` | `−(x − (f − c))` | `+c` |

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

## 2. What changes vs. the float model (#66)

| # | Change | Where |
|---|--------|-------|
| 1 | **Delete the float legs**: SEND `−x` (`FinancialServiceRepository.ts:2276-2293`) and RECEIVE `+x` (`:2331-2342`) are removed. | FS repo |
| 2 | **Reroute cash legs**: every `paymentMethodToDrawerName()` call on the classic SEND/RECEIVE path resolves CASH → PCD when `provider === shop_base_system && !partnerId`. Full call-site list in §3 Phase B. | FS repo + friends |
| 3 | **Gross supplier ledger**: `feeOwedDelta()` and its SQL mirror `SUPPLIER_OWED_EXPR` (`FinancialServiceRepository.ts:423-448`) become `grossOwedDelta()` — one function + one SQL fragment, changed together (rule 14). RECEIVE books a signed negative entry; verify `addLedgerEntry` sign handling (`PAYMENT` force-negates — keep using signed `TOP_UP`/`ADJUSTMENT`, see #66's rationale in FEATURE_GUIDE §8). | FS repo, SupplierRepository reads |
| 4 | **`_System` ≠ internal anymore**: drop the `endsWith("_System")` (`TransactionRepository.ts:149`) and `NOT LIKE '%\_System'` (`:168`) predicates — PCD legs ARE customer-facing cash (in/out summary, D1 cash-flow, receipts, refund-override set must all see them). `INTERNAL_LEG_METHODS` and `PROVIDER_STOCK_DRAWERS` stay. | TransactionRepository |
| 5 | **Fund-the-float → generic cash transfer**: `fundSystemDrawer` (`DrawerTopUpRepository.ts:337-546`, v139 `system_float_topups`) is generalized into a bidirectional, reversible General↔PCD transfer (it already writes payments rows on both sides and is void-reversible — proven by `ProviderFloatTopUp.test.ts:451`). Widen/replace the `target_drawer` CHECK (`create_db.sql:893`, `migrations/index.ts:7038`). `createTopUpFromDrawer` (`:219-317`, raw-UPDATE, non-reversible, hardcoded General dest) is retired from this pair's use. | DrawerTopUp* |
| 6 | **Keep the drawer names.** Renaming `OMT_System` → `OMT_Cash` would touch ~30 sites (constants, seeds, unions, specs) for zero user value; instead only **UI labels** change ("OMT Cash Drawer" / "Whish Cash Drawer"), derived from `shop_base_system` where the surface is shared. | UI only |

Explicitly **kept** from #66: single-point posting via `insertPaymentRow`/`applyDrawerDelta`
(`moneyPosting.ts`), drawer-name-agnostic reversal (`_reversePayments`,
`TransactionRepository.ts:1948-2013`), the store-credit reversal fix, walk-in-on-secondary
rejection, partner flows, the invariant-test harness, rule-17 discipline.

---

## 3. Work breakdown

> Before implementation: run the `new-money-feature` skill and the FEATURE_GUIDE §13
> checklist (CLAUDE.md rule 18). Every changed number needs a failing-first proof (rule 17).

### Phase A — Core model primitives

1. **One routing resolver** (rule 14): e.g. `resolveServiceCashDrawer(method, ctx)` in
   `packages/core/src/utils/payments.ts` (beside `paymentMethodToDrawerName`), where
   `ctx = { provider, baseSystem, partnerId }`. Returns the PCD
   (`baseSystem === "OMT" ? "OMT_System" : "Whish_System"`) for drawer-affecting cash-family
   methods on a primary-system non-partner transaction; falls through to
   `paymentMethodToDrawerName` otherwise. Do NOT touch `payment_methods.CASH.drawer_name`
   (blocked: `is_system=1` guard `PaymentMethodRepository.ts:162-172`; and
   `isNonCashDrawerMethod` tests `drawer_name !== "General"` — `payments.ts:47-57`).
2. **`grossOwedDelta()` + SQL mirror** replacing `feeOwedDelta`/`SUPPLIER_OWED_EXPR`
   (`FinancialServiceRepository.ts:423-448`). SEND `+(x+f−c)`, RECEIVE `−(x−(f−c))`.
3. Retire `SYSTEM_FLOAT_DRAWER_NAMES`' float meaning (`constants/systemFloatDrawers.ts:16`)
   — rename concept to "primary cash drawer"; keep the two name strings.

### Phase B — FinancialServiceRepository (the heavy lift)

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
  (decision #5), FOR-partner dispatch `:1189-1434` except that its RECEIVE leg `:1403-1412`
  currently posts to `OMT_System` — re-derive what a partner RECEIVE means with no float
  (likely: partner ledger only, no PCD movement; owner-check if unclear).
- RECEIVE insufficient-funds guard: per-currency PCD balance check before payout legs;
  throw a structured error (`code: "INSUFFICIENT_DRAWER_FUNDS"`, shortfall per currency)
  the UI can act on.
- Supplier-ledger booking `:2555-2655` switches to `grossOwedDelta`.

### Phase C — Adjacent money repositories

- **`SupplierRepository.settleTransactions`** (`:893-918`): CASH legs resolve via the same
  resolver (supplier == primary provider → PCD). Settle-tab reads move to the gross
  fragment. `recordSupplierCashflow` (`:1048`) reviewed the same way.
- **`DebtRepository`** service-debt repayment (`:440-570`): the existing RESERVE re-route
  into `OMT_System` (`:466`, `:488`, `:544-568`) was float-reconstruction; under the new
  model the mechanism survives but now means "move the FS-debt share of the repayment into
  the physical drawer". Verify amounts against the gross model and lira-104's guards; the
  destination stays `OMT_System`/`Whish_System`.
- **`TransactionRepository`**: predicates change (§2 #4); LIRA-078 refund-override
  replacement legs (`:1999`) re-derive drawer from method — must use the resolver for FS
  transactions or an overridden CASH refund of an OMT SEND leaks back to General.
- **`SalesRepository.getDrawerBalances`** (`:1438-1488`): pre-existing wart — the
  `startsWith("OMT")` fold (`:1472`) merges `OMT_System` + `OMT_App`. Now that OMT_System
  is a countable cash drawer, split the response (`omtCash` vs wallet) and update the
  consumer (`backend/src/api/dashboard.ts:38-43`) + e2e fixture contract
  (`frontend/tests/e2e-electron/fixtures.ts:752-777` hard-depends on the shape).

### Phase D — Session basket (riskiest seam)

`SessionPaymentService.recordBasketPayment` (`:205-224`) resolves drawers by method only —
no provider context exists there today. Work: thread the basket's FS-item context
(provider + amounts) into `BasketPaymentLeg`/the service, and split cash legs: FS-item
share → PCD, remainder → General (deterministic order, per currency). This needs its own
mini-design at implementation time; it is the one place the frontend/session layer knows
something the money layer needs. Rule 16 (IN legs only) and the handover §4.1 warning
(payload-built tests can't see this seam) both bite here — cover with a UI-driven spec.

### Phase E — Transfers & guards

- Generalize v139 `fundSystemDrawer` into `transferBetweenDrawers(General ↔ PCD)` —
  reversible, payments rows both sides, `TRANSFER`-family method (already in
  `INTERNAL_LEG_METHODS` so it stays out of customer cash-flow reports). Migration v140
  (verify latest version first — v139 is current): widen/replace `system_float_topups`
  CHECK or add a `drawer_transfers` table; update `create_db.sql` in the same change
  (rule 10). REST + IPC parity (rule 19): `drawer-topup:fund-system` /
  `POST /api/drawer-topup/fund-system` become the transfer endpoints; Zod schema in
  `packages/core/src/validators/` shared by both.
- `getSourceDrawerBalances` (`DrawerTopUpRepository.ts:550-564`) un-hardcode
  `'OMT_System'`.
- `DrawerCashoutRepository` stays General-only (owner drains PCD→General first).

### Phase F — Frontend

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

## 4. Test plan

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
- Baseline gates per handover §5.

---

## 5. Cutover

Owner wipes the DB and starts fresh (their explicit decision — no balance migration).
The fresh-install path must therefore be first-class: `create_db.sql` + migrations stay in
sync (rule 10); opening PCD balance set by physical count via Initial Drawer Amounts /
setup wizard. The #66 "settle-to-zero" release blocker is mooted for the owner's install;
multi-tenant web installs (if any hold real data) need the same wipe-or-count decision
before upgrade — flag at release time.

---

## 6. Open items & risks

1. **FOR-partner RECEIVE leg** (`FinancialServiceRepository.ts:1403-1412`) posts to
   `OMT_System` today — re-derive under no-float semantics (likely partner-ledger only).
   Owner-check if ambiguous.
2. **`"FEE"` method tag audit** (handover §3.1) — still open and now MORE relevant: the
   FEE leg moves to the PCD. Fold the audit into Phase B.
3. **RECEIVE fee tiers not direction-gated** (handover §3.4) — still awaiting owner.
4. **OMT_App top-up default source** (`TOP_UP_PROVIDER_DEFAULT_SOURCES.OMT_APP =
   "OMT_System"`, `constants/rechargeProviders.ts:38-47`): with no float, recommend default
   General, keep PCD selectable. Owner-confirm at implementation.
5. **Session-basket split rule** (Phase D) needs its own design pass; highest seam risk.
6. **Idempotency gap** (handover §6) — unchanged, still unowned; the new transfer endpoint
   inherits it.
7. **Gross-ledger sign handling** in `addLedgerEntry` for negative RECEIVE entries —
   verify no clamping/force-negation surprises.
8. Docs: rewrite FEATURE_GUIDE §7/§8/§8.1 and mark the float-model handover as superseded
   (keep its traps §4 — they are process lessons, not model claims).

## 7. Out of scope (recorded for later)

- Per-shop config to merge the PCD into General (owner: "later on we can make this
  configurable").
- Any account-balance tracking at the provider (owner: "we will check it later" — if a
  real in-system balance ever needs tracking again, it must be a NEW drawer, not this one;
  this drawer is physical cash).
