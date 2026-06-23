# Plan — Enforce E2E Coverage for Sprint 2 DONE Tickets

> Goal: a dedicated, money-invariant e2e (real main-process IPC) for each **DONE** Sprint-2 ticket.
> Scope: **LIRA-056, 057, 059, 061, 063, 064** (excludes 058 NEEDS-INTERVIEW, 060/062 TODO).
> All e2e are IPC-driven via `appPage.evaluate(() => window.api.*)` over the shared per-worker DB,
> modeled on `lira-session-basket-payment.spec.ts`. Created 2026-06-20.

## Summary

| Ticket   | Title                                                                    | Existing e2e           | New spec                                                 | Effort | Priority |
| -------- | ------------------------------------------------------------------------ | ---------------------- | -------------------------------------------------------- | ------ | -------- |
| LIRA-059 | Suppliers: bidirectional balance + supplier-pays-us (`recordCashflow`)   | **none**               | `lira-059-supplier-cashflow-bidirectional.spec.ts` (NEW) | M      | High     |
| LIRA-056 | KATSH/iPick supplier-credit top-up + settle (no source-drawer deduction) | **none**               | `lira-056-supplier-credit-topup-settle.spec.ts` (NEW)    | M      | High     |
| LIRA-061 | cost/price SEND must book settleable SALE_COST (not TOP_UP)              | partial (Katsh only)   | `lira-061-sale-cost-supplier-ledger.spec.ts` (EXTEND)    | M      | High     |
| LIRA-057 | Whish App top-up Via Partner / From Client                               | **none**               | `lira-057-whish-topup-partner-client.spec.ts` (NEW)      | M      | High     |
| LIRA-064 | Transactions table structured in/out payment legs                        | partial (1 IN leg)     | `lira-064-payment-legs-summary.spec.ts` (EXTEND)         | M      | Medium   |
| LIRA-063 | OMT/Whish App optional name/phone (persisted when provided)              | partial (OMT_APP SEND) | `lira-063-omt-whish-optional-client.spec.ts` (EXTEND)    | S      | Medium   |

Recommended order: **059 → 056 → 061 → 057 → 064 → 063** (highest-risk, zero-coverage money flows first; 059 first because it builds the reusable supplier-balance/drawer-delta helpers the others reuse).

---

## ✅ Real bug surfaced by this audit — FIXED (2026-06-20)

**`WISH_APP` vs `WHISH_APP` provider-name mismatch.** The transaction layer used the typo
**`WISH_APP`** (no H) while the seeded supplier, `recharges.carrier` and the `Whish_App` drawer all used
the **`WHISH`** spelling. So a **Whish App SEND** (cost/price flow) hit `getByProvider("WISH_APP")`,
which never matched the `WHISH_APP` supplier → the `SALE_COST` supplier-ledger write was silently
swallowed (empty catch). Whish App SEND sales weren't recorded as a settleable supplier debt.

**Fix shipped:** renamed `WISH_APP` → `WHISH_APP` across all ~21 source files (frontend forms/types,
preload, schemas, `FinancialServiceRepository` type union + `mapDrawerName`, `ProfitRepository`
provider constants) + `create_db.sql` CHECK, and added **migration v105** which recreates
`financial_services` (schema-faithful: copies its own live CREATE, widening only the provider CHECK to
also accept `WHISH_APP`) and migrates `financial_services.provider` + `mobile_service_items.provider` +
`transactions.metadata_json`. Verified: core 379 / backend 384 / typecheck / lint clean. So **the
LIRA-061 Whish App scenario below is now a real green test, not an xfail.**

---

## Shared helpers to add (`frontend/tests/e2e-electron/helpers/`)

All renderer read APIs the plan needs **already exist** — no new IPC required. Promote these inline
patterns into helpers (used across 056/057/059/061):

- `resolveSystemSupplier(api, provider)` → `suppliers.list("", true).find(s => s.provider === provider)`. (`preload.ts:375`)
- `readSupplierLedger(api, id, limit)` → `suppliers.getLedger(id, limit)`. **Raw array** (no `{success}`); read `entry_type` as a **string** (the `electron.d.ts` union omits `SUPPLIER_PAYS_US`). (`preload.ts:379`)
- `readSupplierBalances(api)` → `suppliers.getBalances(true)` → `{supplier_id,total_usd,total_lbp}` (positive = we owe; negative = they owe us). (`preload.ts:377`)
- `readProviderDrawer(api, name)` → `recharge.getDrawerBalances().find(d => d.name === name)`. **Mandatory** for `Katsh`/`iPick`/`Whish_App`/`OMT_App` — `dashboard.getDrawerBalances` only exposes `generalDrawer`+`omtDrawer`. Match **raw** names (`Whish_App`, not "Whish App"). (`preload.ts:298`)
- `readPartnerLedger(api, id, filters)` / `readPartnerBalance(api, id)` → `partners.getLedger` / `partners.getBalance` (`{usd,lbp}` = ΣDEBIT − ΣCREDIT). (`preload.ts:645,641`)
- `fundGeneralDrawer(api, {amount_usd, amount_lbp})` → `drawerTopUp.create(...)` (credits General). **Build first** — unblocks LIRA-057 From-Client happy path. (`preload.ts:602-607`)
- `deltaSnapshot(api)` → captures supplier balances + provider drawers + general drawer **before** each action so every assertion is a **delta**, not an absolute.

---

## Cross-cutting rules (apply to every spec)

1. **Shared worker DB, ordered execution** → assert **deltas** (snapshot before the action); target a
   specific `entry_type`/`itemKey`/captured id, never `getLedger[0]` or absolute totals.
2. **Provider-drawer reads use `recharge.getDrawerBalances()`** (name-keyed), never `dashboard.*`.
3. **OMT-base / WHISH gating** affects none of these scenarios (Katsh/iPick/OMT_APP/WISH_APP are
   `is_system=1` cost/price providers; partner top-up only checks `is_active`). Always pass
   `includeInactive=true`; never assert on the WHISH base-system supplier on a default list.
4. **Provider spelling is now uniformly `WHISH_APP`** (the `WISH_APP` typo was renamed in code + migrated via v105) — send and resolve `WHISH_APP` everywhere.
5. **Raw-array vs `{success}` envelope**: `getLedger`/`getUnsettledTransactions`/`getRecent` return raw arrays; `omt.addTransaction`/`recordCashflow`/`settleTransactions`/`addLedgerEntry`/`recharge.topUp*` return `{success,...}`.
6. **Profit is not on a txn row** (`getRecent` has no `profit_*`) — prove profit indirectly via drawer deltas or `profits.summary`.
7. **Admin write paths**: `recordCashflow`/`addLedgerEntry`/`settleTransactions` are admin-only; setup session is admin (confirm in `completeSetup`).

---

## LIRA-059 — Suppliers bidirectional balance + supplier-pays-us _(NEW, do first)_

**Flow:** `suppliers.recordCashflow({supplier_id, direction:"PAY"|"RECEIVE", payments[], note?})` →
`supplierHandlers.ts:115` (admin) → `SupplierRepository.recordSupplierCashflow` (`:538-644`): PAY → one
`PAYMENT` ledger row (**negative**) + drawer **debit**; RECEIVE → one `SUPPLIER_PAYS_US` ledger row
(**positive**, requires migration v103 CHECK) + drawer **credit**. Balance = `getSupplierBalances` =
Σ ledger rows. Seed a positive owed balance with no drawer effect via `addLedgerEntry({entry_type:"TOP_UP"})`.

**Scenarios:**

1. **PAY (CASH) pays down a positive balance** — seed `TOP_UP +100` on OMT; `recordCashflow PAY 100 CASH/USD` → ledger newest `PAYMENT` `amount_usd=-100`; `generalDrawer.usd −100` (proves it hits **General**, not the provider drawer — the original bug); balance −100. _Zero pending txns needed._
2. **RECEIVE (supplier pays us)** — `recordCashflow RECEIVE 30 CASH/USD` → ledger newest `SUPPLIER_PAYS_US` `amount_usd=+30` (proves v103 CHECK at runtime); `generalDrawer.usd +30`; balance +30.
3. **Bidirectional/overpay → negative** — fresh supplier, `TOP_UP +50`, `PAY 70` → balance delta −20 and strictly below the pre-seed baseline (green "they owe you").
4. **Companies/Products split** — `suppliers.create({name})` → row `is_system===0`; a system provider has `is_system===1`. (Optional `/suppliers` DOM check for the tabs.)

---

## LIRA-056 — KATSH/iPick supplier-credit top-up + settle _(NEW)_

**Flow:** `recharge.topUpFromSupplier({provider, amount, currency})` → `rechargeHandlers.ts:246` →
`RechargeRepository.topUpFromSupplier` (`:858-954`): provider drawer **+amount**, one supplier_ledger
`TOP_UP` **positive** row, `recharges` row `paid_by='SUPPLIER'`, `RECHARGE_TOPUP` txn — **no source
drawer deducted** (the core regression). Settlement: `suppliers.addLedgerEntry({entry_type:'PAYMENT', drawer_name})`
→ drawer **debit** + negative `PAYMENT` ledger row; ledger nets to 0.

**Scenarios:**

1. **Katsh top-up** — `topUpFromSupplier({provider:'Katsh', amount:100, currency:'USD'})` → Katsh drawer **+100**, **General unchanged** (key invariant), ledger `TOP_UP +100`, supplier balance +100.
2. **Settle** — `addLedgerEntry({supplier_id, entry_type:'PAYMENT', amount_usd:100, drawer_name:'General'})` → General **−100**, ledger `PAYMENT −100`, balance nets to baseline.
3. **iPick top-up** — same as #1 for iPick (proves the provider→drawer map + no-deduction for both).

---

## LIRA-061 — cost/price SEND books settleable SALE_COST _(EXTEND existing spec)_

**Existing:** Katsh SEND → `SALE_COST` (not `TOP_UP`), surfaces in `getUnsettledTransactions`, UI badge.
**Gaps:** iPick SEND; the actual **settle** path; the **pay-down** path; drawer-money invariants; the **WISH_APP bug**.

**Add scenarios:**

1. **iPick SEND** (`omt.addTransaction({provider:'iPick', serviceType:'SEND', cost:90, price:100, paidByMethod:'CASH'})`) → ledger newest `SALE_COST 90`, no `TOP_UP`; iPick drawer **−90**, General **+100**; appears in `getUnsettledTransactions('iPick')` (amount 90, commission 0).
2. **Per-transaction settle** — grab the unsettled row id, `settleTransactions({supplier_id, financial_service_ids:[id], amount_usd:90, ..., drawer_name:'General', payments:[{CASH,USD,90}]})` → `SETTLEMENT −90` ledger row, row leaves the unsettled list (`settlement_id` stamped), balance nets to 0.
3. **Cumulative pay-down** — fresh SEND cost 50/price 70, then `recordCashflow PAY 50 CASH/USD` → `PAYMENT −50`, balance back to baseline. (Note: pay-down does **not** stamp `settlement_id`, so assert balance, not disappearance.)
4. **Whish App SEND** (`omt.addTransaction({provider:'WHISH_APP', serviceType:'SEND', cost:90, price:100, paidByMethod:'CASH'})`) → ledger newest `SALE_COST 90`, Whish_App drawer **−90**, General **+100**, appears in `getUnsettledTransactions`. Now a **real green test** (the `WISH_APP`/`WHISH_APP` bug is fixed — see the top section).

---

## LIRA-057 — Whish App top-up Via Partner / From Client _(NEW)_

**Flow — Via Partner:** `recharge.topUpFromPartner({provider:'WHISH_APP', partnerId, amount, currency})`
→ `RechargeRepository.topUpFromPartner` (`:962-1056`): Whish_App drawer **+amount**, one `partner_ledger`
`WHISH_TOPUP` **CREDIT** row (we owe partner), `RECHARGE_TOPUP` txn, **no cash drawer**; unknown/inactive
partner → `{success:false,'Partner not found'}`, no mutation.
**Flow — From Client:** `recharge.topUpFromClient({amount, cashPaid, currency, clientName?})`
(`:1064-1183`): Whish_App **+amount**, General **−cashPaid**, profit = amount−cashPaid; guards on
General balance (`Insufficient balance in General drawer`); **no** partner_ledger entry.

**Scenarios:**

1. **Via Partner (USD)** — create partner; `topUpFromPartner 50 USD` → Whish_App **+50**, General **unchanged**, one `WHISH_TOPUP`/`CREDIT` partner_ledger entry (amount 50), partner balance **−50**.
2. **Via Partner guard** — unknown `partnerId` → `{success:false, /Partner not found/}`, drawers unchanged.
3. **From Client (USD)** — `fundGeneralDrawer` first; `topUpFromClient {amount:40, cashPaid:30}` → Whish_App **+40**, General **−30** (⇒ profit 10), no partner_ledger entry.
4. **From Client guard** — `cashPaid` > General balance → `{success:false, /Insufficient balance in General drawer/}`, drawers unchanged (atomic).

---

## LIRA-064 — structured in/out payment legs _(EXTEND existing spec)_

**Existing:** one USD IN leg shape + viewer renders `in: $X`; summary not polluted.
**Gaps:** OUT legs, mixed currency, same-currency summing, internal-leg exclusion.

**Add scenarios (drive via `session.checkout` payment legs):**

1. **Mixed IN + OUT change** — payments `[$40 IN, 100,000 LBP IN, 50,000 LBP OUT]` → row has both in-legs + the OUT leg (`signed_amount −50000`); viewer cell shows `in: $40 + 100,000 LBP · out: 50,000 LBP`.
2. **Same-currency summing** — `[$30 IN, $20 IN]` → two backend legs, viewer collapses to a single `in: $50` (no `$30`/`$20`).
3. **Internal-leg exclusion** — an OMT SEND basket → the row's legs contain **only** the customer CASH `$52` in-leg (count 1, currency in {USD,LBP}, method not in the internal set). _Positive-only assertion — see blocker._

---

## LIRA-063 — OMT/Whish App optional name/phone _(EXTEND existing spec, do last)_

**Existing:** OMT_APP SEND, empty name/phone → proceeds, `client_id` null, `—` in table.
**Gaps:** the other 3 provider×serviceType combos; the **persisted-when-provided** case (never tested).

**Add scenarios (IPC-driven):**

1. **All four combos empty** — `omt.addTransaction` for `{OMT_APP,WISH_APP}×{SEND,RECEIVE}` with name/phone omitted → each `{success:true}`; `omt.getById(id)` → `client_name`/`phone_number`/`client_id` all null.
2. **Provided is persisted** — OMT_APP SEND + WISH_APP RECEIVE with a **unique** name+phone → `omt.getById` shows `client_name`/`phone_number` saved and `client_id` non-null (auto-create). _Use a unique phone to avoid matching an earlier auto-created client._
3. _(Optional)_ WISH_APP SEND UI parity — form opens PaymentSheet with empty name/phone.

> Note: `omt.addTransaction`'s `electron.d.ts` type is **stale** — cast `window as unknown as {...}` and pass the rich `CreateFinancialServiceData` shape (as `lira-supplier-secondary-system.spec.ts` does).

---

## Blockers / constraints (all resolved or have workarounds)

- **Renderer read APIs**: none missing — supplier ledger/balances, partner ledger/balance, provider drawers, General drawer all reachable. Full money-conservation invariants are e2e-assertable.
- **LIRA-057 General funding**: resolved via `fundGeneralDrawer` (`drawerTopUp.create`).
- **LIRA-061 Whish App**: the `WISH_APP`/`WHISH_APP` bug is **fixed** (rename + migration v105) — its scenario is now a normal green test.
- **LIRA-064 internal-leg exclusion**: renderer leg shape omits `drawer_name`/`note`, so exclusion is **positive-only** (assert only the expected customer leg present). Deeper coverage = a repo unit test on `_attachPaymentLegs`.
- **LIRA-059 supplier ledger**: `transaction_type` is not populated by the repo query — assert on `entry_type` + signed amounts only.
