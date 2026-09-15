# OMT open-credit account — iPick + OMT App roll up under the OMT supplier

Tickets **LIRA-187 → LIRA-192** in `current_sprint.md`. Planned 2026-09-10 from an owner interview
(2026-09-09/10), extended 2026-09-13/14 with the OMT App cashout (§8); every file:line below was
opened and read on `main` on the date given in its section heading.

> **STATUS: SHIPPED 2026-09-15/16 — everything except LIRA-191, which the owner deferred.**
> All eighteen owner decisions answered (§1). See **§12** for what landed, where, and the two
> things that genuinely remain. This header previously read "Nothing built yet" for a full day
> after the work shipped — the exact staleness trap this repo keeps hitting. If you are reading
> this to decide what to do next, trust §12 and the commit log, not any prose above it.

---

## §1 Owner decisions

| #   | Decision                                                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | OMT is ONE open-credit account. The counter (OMT SEND/RECEIVE), the OMT App wallet, and iPick credit all draw on it. Settlement is one payment to OMT.                                                                             |
| D2  | The OMT Cash Drawer (`OMT_System`, the PCD) holds **physical cash in store only**. Loading the OMT App wallet or iPick credit moves **no cash** — the wallet/iPick drawer goes up and the account debt goes up by the same amount. |
| D3  | Every settlement of the account (counter, app, iPick debt alike) debits the **OMT Cash Drawer** (or whichever legs the admin picks; CASH resolves to the PCD as today).                                                            |
| D4  | OMT App wallet top-up: **credit is the default**. Keep the existing drawer-to-drawer transfer available as an explicit alternative.                                                                                                |
| D5  | Historical OMT App cash top-ups: leave as recorded. No backfill.                                                                                                                                                                   |
| D6  | Suppliers page: OMT shows as an **account card** with OMT counter / OMT App / iPick as **sub-rows**, each with its own drawer badge and contribution. Ledger and settlement queue merge all three with a **Type** column.          |
| D7  | Katsh stays standalone.                                                                                                                                                                                                            |
| D8  | Partial settlement allocation: **oldest rows pre-selected, admin can change the selection**.                                                                                                                                       |
| D9  | Whish-base shops / Whish App under Whish: **deferred**. The grouping is data (a column), not code, so it can be reconfigured later.                                                                                                |
| D10 | The OMT App gets a **cashout** — the mirror of the top-up. Wallet balance goes back to the OMT system: `OMT_App` drawer **down**, OMT account **credited**. No physical cash moves (§8).                                            |
| D11 | A cashout earns the shop **0.1% commission**, and the account is credited **principal + commission** (owner: _"omt system owes me 100$ + 0.1% comission"_). The ledger shows 100.10 owed by OMT.                                   |
| D12 | Button label: **"Cash Out to OMT"**. Internal transaction type `WALLET_CASHOUT`, to avoid the three existing uses of "cashout" (§8.5).                                                                                          |
| D13 | The 0.1% lives as a **named constant**, not a magic number and not a per-tenant setting yet. **No currency conversion is involved**: a USD cashout credits USD, an LBP cashout credits LBP, same percentage (§8.3).            |
| D14 | Cashout commission is recognised as profit **at settlement, like the counter** — not at creation. The account balance still shows principal + commission from the moment of the cashout (§8.3a).                              |
| D15 | Cashing out more than the wallet holds is **blocked**, per currency.                                                                                                                                                              |
| D16 | Cashout is **OMT App only** for now. No iPick or Katsh credit return.                                                                                                                                                             |
| D17 | **Round-trip commission: ACCEPTED, no action** (owner, 2026-09-15). Top-up on OMT credit then immediate cashout earns 0.1% for no real activity ($1 per $1,000, loopable). **OMT limits cashout volume from their own system**, so the exposure is bounded and the owner is content. Do NOT add wash detection. Commission still recognised at settlement (D14). |
| D18 | **Settlement clears WHOLE rows only — confirmed, keep it** (owner, 2026-09-15). You tick which rows you are clearing and the payment must equal them exactly; pay less by unticking rows. Paying MORE is refused (a deliberate overpayment goes through the Suppliers Pay action, which books the credit correctly). **Do NOT build partial coverage of a single row** — it would need a new coverage column and the owner does not want it. |

Owner's own words, for the model: _"the omt system works like open credit system where you can use
as much as u want and then pay later"_; _"omt cash drawer is only for cash [in store]"_; _"when we
topup omt app and ipick, we use the omt system to top these up -> this only increases the related
drawers and does not decrease the omt cash drawer"_.

---

## §2 Design principle

**Ledger rows NEVER move.** iPick and OMT App keep their own `suppliers` rows, their own
`supplier_ledger` rows, their own drawers. The OMT account is a **read-time grouping** via a new
nullable `suppliers.account_supplier_id` (self-FK). Voids keep finding rows where they always were,
so the rule-20 reversal fear is closed by construction. The one new reversal owner is the account
settlement (LIRA-189).

Why not merge into one supplier: the supplier for a transaction is found by a strict 1:1 lookup on
`suppliers.provider` (`SupplierRepository.getByProvider`, `SupplierRepository.ts:584-596`, called at
`FinancialServiceRepository.ts:3946`). One row cannot own three providers.

Why not re-point writes to the parent: the void path follows `source_ref_table/source_ref_id` to the
child's ledger row (`TransactionRepository.ts:1991-2000, 2353`). Rows written elsewhere would be
orphaned on void — a phantom debt forever.

**Rule 18 applies to every ticket** — read `docs/FEATURE_GUIDE.md` §7/§8/§8.1 first. Note
`Suppliers/index.tsx:115-125` and `:1021-1024` still carry superseded float-model comments
("provider FLOAT, never a real cash drawer"); fix on touch.

---

## §3 Current-code facts the tickets depend on (verified 2026-09-09)

- **Names.** `OMT_System` is a drawer only (the PCD; `systemFloatDrawers.ts:29-36`), never a
  supplier. The counter supplier is named `'OMT'` (provider `OMT`). `'OMT App'` is a supplier
  (provider `OMT_APP`, drawer `OMT_App`). `'iPick'` is supplier + provider + drawer. Casing is
  load-bearing (`iPick`, not IPIC).
- **iPick already matches D2.** `RechargeRepository.topUpFromSupplier` (`:1543-1618`): no source
  drawer, iPick drawer up, `TOP_UP` debt on the iPick supplier.
- **OMT App has NO credit path.** `RechargeRepository.topUpApp` (`:462`) is a drawer transfer with
  `TOP_UP_PROVIDER_DEFAULT_SOURCES.OMT_APP = "OMT_System"` (`constants/rechargeProviders.ts:41`) and
  an insufficient-balance guard on the source. So today every wallet load drains the OMT Cash
  Drawer and books no debt — the opposite of D2.
- **Wallet SEND/RECEIVE book no supplier row** (`FinancialServiceRepository.ts:4020-4028`, "Fix B",
  `WALLET_PROVIDERS` in `constants/walletProviders.ts`). This stays CORRECT under D2 because the
  debt is booked once, at load time. Do not "fix" it.
- **Counter ledger amount is GROSS** via `grossOwedDelta` (`FinancialServiceRepository.ts:716-757`)
  with SQL twin `SUPPLIER_OWED_EXPR` (`:800-822`), written as a signed `TOP_UP` at `:4029-4062`.
  The write sits in a swallowing `try/catch` (`:4065-4067`).
- **Balance** = signed `supplier_ledger` SUM (`SupplierRepository.ts:1116-1127`); the page hides the
  secondary base system via the predicate in `getSupplierBalances` (`:1171-1191`). Positive = shop
  owes = GREEN (`Suppliers/index.tsx:161-178`).
- **Settlement** resolves CASH legs to the PCD when `supplier.provider === shop_base_system`
  (`SupplierRepository.ts:1378-1382`, `:1661`; manual cashflow `:2339-2342`, `:2432-2453`).
- **Closing** reads `drawer_balances` only (`ClosingRepository.ts:382-400`) — zero supplier
  coupling. Nothing in closing changes.
- **Provider→drawer is written in three places:** `service_providers.drawer_name`
  (`create_db.sql:1690`), the fallback switch at `FinancialServiceRepository.ts:991-1010`, and the
  display map `Suppliers/index.tsx:140-148`. LIRA-188 deletes the third.
- **Guard set to keep green:** `OmtSystemFeeCharacterization.test.ts`,
  `FinancialServiceRepository.systemLedger.test.ts`, `SupplierRepository.settlement.test.ts`,
  `FinancialServiceRepository.appWalletTransfer.test.ts`, e2e `lira-148`, `lira-076`, `lira-131`,
  `lira-web-016`.

---

## §4 Worked example (the reason for per-child allocation)

| Event                              | Ledger row today    | Account |
| ---------------------------------- | ------------------- | ------- |
| OMT SEND, principal 1,000 + fee 50 | OMT supplier +1,050 | 1,050   |
| iPick supplier-credit top-up 200   | iPick supplier +200 | 1,250   |

Owner pays OMT 1,250 once from the OMT Cash Drawer.

- **Single row on the parent (rejected):** OMT shows −200 (OMT owes shop), iPick still +200
  (unpaid). Account total 0, every child wrong, unsettled queue lies.
- **Allocated rows (chosen):** −1,050 on OMT, −200 on iPick. Every child nets to 0, account nets to
  0, one cash leg leaves the drawer.

---

## §5 Tickets

### LIRA-187: `suppliers.account_supplier_id` — the account link (schema only) — Medium

**Depends on:** nothing · **Blocks:** 188, 189, 190

Migration **v176** (head verified at v175, §9.1) adds TWO nullable columns in ONE migration, in both
`packages/core/src/db/migrations/index.ts` AND `electron-app/create_db.sql`:
`suppliers.account_supplier_id INTEGER REFERENCES suppliers(id)`, and
`supplier_ledger.settlement_id INTEGER` (§9.3 — without it D8's selectable queue cannot be built). Seed per tenant:
`iPick.account_supplier_id = OMT.id`, `'OMT App'.account_supplier_id = OMT.id`. Katsh, Whish, Whish
App: NULL (D7, D9). `down()` drops the column.

Expose on `SupplierEntity` and the Zod validators in `packages/core/src/validators/`; no UI yet.
**Zero behaviour change** — every existing balance/ledger/settlement test must pass untouched.

Acceptance: migration test in `db/migrations/__tests__/` proving the seed lands per tenant and that
a tenant with no OMT supplier gets NULLs, not a crash.

### LIRA-188: OMT account rollup on the Suppliers page — balance, ledger, unsettled queue, sub-rows — High

**Depends on:** 187 · **Blocks:** 189

**Core.** New read methods on `SupplierRepository` (rule 13 — SQL stays here):
`getAccountBalances()` sums `supplier_ledger` over the parent AND its children per currency;
`getAccountLedger(parentId)` and `getAccountUnsettled(parentId)` union the children's rows with a
`source_supplier_id` / `source_provider` column. Extract the "member of account X" predicate ONCE
(`s.id = ? OR s.account_supplier_id = ?`) as a named fragment (rule 14). `getSupplierBalances` must
stop listing children as top-level cards while still returning their per-child contribution for the
sub-rows. The existing secondary-system hide predicate stays as-is.

**Transport.** IPC handler + mirrored REST route (rule 19), same roles as the existing supplier
reads, envelope-identical. Adapter fn in `backendApi.ts`, `ElectronApiAdapter.ts`, typed in
`packages/ui/src/api/types.ts`.

**Frontend** (`frontend/src/features/suppliers/pages/Suppliers/index.tsx`, Companies tab):

- OMT renders as an **account card**: headline balance per currency, existing sign/colour rule.
- Three **sub-rows** (D6): OMT counter, OMT App, iPick — each with its own drawer badge
  (OMT Cash Drawer / OMT_App / iPick), contribution per currency, unsettled count. Sub-rows have **no
  settle button**; they show "part of OMT account".
- Ledger table gains a **Type** column (OMT System / OMT App / iPick) and a type filter chip
  defaulting to all.
- Replace the local `PROVIDER_DRAWER` display map with `service_providers.drawer_name`. Delete the
  stale float-model comments at `:115-125` / `:1021-1024`.

**Tests.** Frontend jest for the card/sub-row rendering and the Type column. Desktop e2e
`lira-188-omt-account-rollup.spec.ts`: seed an OMT SEND and an iPick credit top-up, assert the OMT
account headline equals the sum and both sub-rows show their contribution — **deltas, not
absolutes** (rule 15). Web twin. Existing specs that assert an iPick top-level card (lira-056,
lira-062, lira-078, lira-141, lira-web-015) move their assertion to the sub-row.

### LIRA-189: account settlement — one payment, allocated per child, PCD legs, reversible — High (money)

**Depends on:** 187, 188 · **Rules 16, 17, 18, 20 apply.**

**Behaviour.** Settling the OMT account takes ONE set of payment legs (D3: CASH resolves to the PCD
via `resolveServiceCashDrawer` with the PARENT's provider ctx — iPick/OMT App debt is paid from the
OMT Cash Drawer by owner decision). The repository writes **one `PAYMENT` ledger row per child
touched** (§4), never a single row on the parent.

**Allocation (D8).** The settlement sheet lists unsettled rows across all three children with a
Type column, **oldest pre-selected up to the amount entered**, admin can tick/untick. The selected
set is sent in the ONE IPC/REST call (rule 16: no follow-up call). Server re-validates the
selection against the account membership predicate from LIRA-188 — never trust the client's
supplier ids.

**Commission.** Settlement-day commission stamp stays **per child** using the child's own
`commission_eligible` / `commission_entry_mode` (iPick = not eligible; OMT = LUMP). Do not aggregate.
**Plus, from LIRA-192 (D14, §8.3a):** sum the stored commission of every OMT App cashout row in
the batch and stamp it automatically, per currency. That figure is computed, not operator-entered
— never ask the operator to add up cashout commissions.

**Direction and sign (§8.4).** Cashouts can push the account net NEGATIVE (OMT owes the shop). The
sheet must offer the **collect** direction, reusing `SupplierRepository`'s existing manual-cashflow
`RECEIVE` path (`:2339-2350`) rather than duplicating it, and the allocation must handle mixed-sign
rows by netting credits against debt.

**Reversal (rule 20).** Voiding an account settlement must reverse EVERY child `PAYMENT` row and the
drawer legs together. Extend `TransactionRepository`'s supplier settlement reversal
(`TransactionRepository.supplierSettlementReversal.test.ts` is the model) to iterate the allocated
rows by `source_ref`. Prove create + reverse nets to **0 on every child ledger, the account, and the
PCD, per currency**, with a test shown to FAIL first (rule 17) — e.g. by temporarily reverting to a
single parent `PAYMENT` row and watching the per-child assertion fail.

**Tests.** Core jest `SupplierRepository.accountSettlement.test.ts` (full, partial-oldest-first,
partial-with-manual-selection, cross-currency, void). Desktop e2e `lira-189-omt-account-settle`
driven through the REAL settlement sheet (layer-seam rule — the frontend does the allocation
arithmetic). Web twin.

### LIRA-190: OMT App wallet loads on OMT credit by default — High (money)

**Depends on:** 187 · **Rules 17, 18, 20 apply.**

**Behaviour (D2, D4).** Widen `RechargeRepository.topUpFromSupplier` from `"iPick" | "Katsh"` to
include `"OMT_APP"`: OMT_App drawer up, **no source drawer touched**, `TOP_UP` debt booked on the
`'OMT App'` supplier (which LIRA-187 parents under OMT, so it lands in the account). Keep
`topUpApp` (drawer transfer) as the explicit alternative; change
`TOP_UP_PROVIDER_DEFAULT_SOURCES.OMT_APP` so the transfer no longer silently drains the OMT Cash
Drawer by default — the top-up modal offers **"On OMT credit" (default)** and "Transfer from
drawer". D5: no backfill of historical transfers.

**Invariant check.** The wallet SEND/RECEIVE branches must remain unchanged — they still book no
supplier ledger row (`FinancialServiceRepository.appWalletTransfer.test.ts` must stay green)
because the debt is now booked at load time. State this in a comment next to the wallet guard.

**Reversal — CORRECTED 2026-09-14, the original text here was wrong.** This paragraph used to say
"the credit top-up must void to 0 ... iPick's existing void path is the model". **That is false, and
three implementation lanes independently caught it.** `RECHARGE_TOPUP` is a member of
`NON_REVERSIBLE_TRANSACTION_TYPES` (`transactionTypes.ts`, rationale "the provider-drawer credit has
no payments row either"), and `TransactionRepository`'s void guard refuses it — **for iPick and Katsh
exactly as much as for OMT App**. There has never been a reversible top-up path to copy.

**Decision: leave it non-reversible.** That is rule 20 option (b) — gated non-reversible with a
documented correction path — and it is the status quo for every existing provider. Making
`RECHARGE_TOPUP` reversible would mean rewriting `topUpFromSupplier` to post a real payments row for
every provider and removing the type from the non-reversible set: a cross-cutting change to iPick,
Katsh, partner and client top-ups that nobody asked for. The correction path for a mistaken credit
top-up is an **opposite manual entry on the Suppliers page**, the same as today.

The asymmetry with the cashout is deliberate and worth stating: **`WALLET_CASHOUT` IS reversible**
(LIRA-192), because it stamps a commission, so a mistake that could not be voided would leave phantom
earnings on the books. A top-up stamps no profit, so the manual-correction path is adequate there.

**Owner item:** a mistaken OMT App credit top-up cannot be voided, only corrected by an opposite
manual entry. That is unchanged from how iPick behaves today, but it is now reachable from a new
button, so confirm you are content with it.

**Tests.** Core jest extension of the `topUpFromSupplier` suite; desktop e2e
`lira-190-omt-app-credit-topup` asserting OMT Cash Drawer delta = 0, OMT_App drawer delta = +amount,
OMT account delta = +amount (deltas only, rule 15); web twin.

### LIRA-191: account grouping configurable in Service Providers settings; Whish-base shops — Low (deferred, D9)

**Depends on:** 187–190 shipped and observed in use.

Surface `account_supplier_id` in the Service Providers manager so a tenant can (re)parent iPick /
OMT App / Whish App. Decide Whish-base behaviour then: on a Whish-base shop the OMT supplier is
hidden by the secondary-system predicate, so iPick parented under it would disappear — the fix is
either to exempt account parents with active children from that predicate, or to leave iPick
unparented on Whish-base tenants. Owner explicitly deferred this; do not pre-build it.

---

## §6 Build order and gates

1. LIRA-187 and LIRA-188 together (187 is a prerequisite with no risk; 188 is the largest).
2. LIRA-190 (independent of 188; money).
3. LIRA-192 (the cashout, §8 — needs 187 so the credit lands in the account; money).
4. LIRA-189 **last** (needs 188's membership predicate and unsettled union, AND must handle the
   negative/mixed-sign account that LIRA-192 makes possible — §8.4; money). It also owns the
   **profit stamping** for LIRA-192's deferred commission (D14, §8.3a): until 189 ships, cashout
   commission is recorded but not yet recognised, which is the correct intermediate state.
5. LIRA-191 only after the owner has used 187–190 and 192.

Per the owner's check cadence: run NOTHING until every ticket in the batch is implemented, then the
full `yarn test` (not per-workspace), `yarn typecheck`, `yarn lint`, then the owner's desktop e2e
cycle BEFORE web e2e. Also update `docs/FEATURE_GUIDE.md` §8 (supplier ledger) with the account
model and §13 checklist with "does this row belong to an account parent?".

---

## §7 Open risks

- The OMT Cash Drawer is understated relative to the owner's model until LIRA-190 ships, because
  every wallet load today drains it (§3). D5 says no backfill — so the drawer's physical count at
  the first closing after LIRA-190 is the reconciliation point.
- Partial-settlement allocation arithmetic lives in the frontend (D8, editable selection); the e2e
  for LIRA-189 must drive the real sheet, not a hand-built IPC payload.
- The counter ledger write is inside a swallowing `try/catch`; any change nearby that throws would
  silently book nothing. Keep LIRA-188/189 out of that block.

---

## §8 OMT App cashout — LIRA-192 (added 2026-09-13, owner interview)

### §8.1 What the button does

The mirror of the top-up. Wallet balance leaves the `OMT_App` drawer and returns to the OMT system,
which credits the shop's account with the principal **plus 0.1% commission**. **No physical cash
moves in either direction** — same as the top-up (D2).

Owner's spec, verbatim:

> topup omt app: 100$ -> supplier omt system bado mene 100$
> cashout button: 100$ -> omt app drawer 100$, then omt system owes me 100$ + 0.1% comission

On a 100 USD cashout at 0.1%:

| Effect                              | Delta                  | Notes                                |
| ----------------------------------- | ---------------------- | ------------------------------------ |
| `OMT_App` drawer                    | **−100.00**            | wallet balance leaves                |
| `OMT_System` (OMT Cash Drawer)      | **0**                  | no physical cash — D2                |
| `supplier_ledger` on `'OMT App'`    | **−100.10**            | negative = OMT owes the shop          |
| OMT account headline (LIRA-188)     | **−100.10**            | rolls up from the child               |
| Profit recognised                   | **+0.10 at settlement**| deferred like the counter — D14      |

Sign check against §8.1 of `FEATURE_GUIDE.md`: `Σ(drawer deltas) − Δ(owed to provider)` =
`(−100.00) − (−100.10)` = `+0.10` = the shop's earning. The invariant holds. Under D14 that earning
is **recognised** later, at settlement; the identity above is about balances, not about when profit
is booked — two different facts that `FEATURE_GUIDE.md` §8.1 explicitly warns against conflating.

The top-up (LIRA-190) and the cashout are exact opposites and share one mechanism: wallet drawer
one way, account ledger the other, no cash. Build them on the same repository helper.

### §8.2 What OMT App commission is TODAY — nothing is calculated, it is typed

This matters because **the 0.1% would be the first COMPUTED commission the OMT App has ever had.**
Verified 2026-09-13:

- **The fee is manual.** `frontend/src/features/recharge/utils/omtWhishAppFees.ts:71-78` — `autoFee`
  is non-zero only for `WHISH_APP` RECEIVE in USD (1%). For `OMT_APP` it is always `0`, so
  `providerFee` is whatever the operator types into the Fee Amount box
  (`OmtWhishAppTransferForm.tsx:698-706`, state `manualFee` at `:145`).
- **The commission IS the fee, 1:1.** `omtWhishAppFees.ts:107-109`:
  ```ts
  // SEND and RECEIVE alike: the fee is charged to the customer on top of the
  // transfer and kept whole by the shop (2026-07-04 decision).
  const shopProfit = providerFee;
  ```
  The form submits `commission: Math.max(0, shopProfit - discount)` and sends `omtFee` for display
  only (`OmtWhishAppTransferForm.tsx:350-357`).
- **The backend does not touch it.** `FinancialServiceRepository.ts:1353` —
  `let calculatedCommission = data.commission || 0;`. The fee-tier auto-calc is gated on
  `provider === "OMT"` (`:1355`), so no OMT App path ever reaches `lookupOmtFee` /
  `calculateCommission`.
- **`commission_model = 0`** for OMT App (`:1551-1555` — only BILL and the OMT/WHISH **counter**
  get model 1), so the profit is stamped **immediately** on the `FINANCIAL_SERVICE` row:
  `profit_usd = commission` (`:1980-1991`). There is no settlement step.
- **No supplier ledger row at all** — `grossOwedDelta` short-circuits wallet providers to `0`
  (`:730-733`) and the write block skips them ("Fix B", `:4034-4041`). `is_settled = 1` at birth, so
  an OMT App row never enters the Suppliers settle queue.
- **Drawers:** SEND → `OMT_App −x`, cash `+(x + fee)`. RECEIVE → `OMT_App +x`, cash `−(x − fee)`
  (modes A/B) or `−x` plus explicit fee legs (mode C). Guarded by
  `FinancialServiceRepository.appWalletTransfer.test.ts:270-335`.

Contrast — the OMT **counter** computes both: the fee comes from a tier table
(`INTRA_FEE_TIERS`, `WESTERN_UNION_FEE_TIERS`) and the commission is a percentage OF that fee
(`OMT_COMMISSION_RATES`: INTRA/WU 10%, CASH_TO_BUSINESS/GOV 25%), under `commission_model = 1` so
the profit is deferred to settlement.

### §8.3 The 0.1% already exists in the codebase — and it is a commission percentage, not an exchange rate

`packages/core/src/utils/omtFees.ts:31`:

```ts
OMT_WALLET: 0.001, // 0.1% of transfer amount (no fee to customer)
```

and again, hardcoded, inside `calculateCommission` (`:164-168`) — a pre-existing rule-14 duplication
of the same number. That constant is the **counter's** OMT_WALLET service type, not the app wallet.
Same number today; not obviously the same business rule.

**DECIDED (D13).** A separate named constant `OMT_APP_CASHOUT_COMMISSION_RATE = 0.001` in
`packages/core/src/constants/`, with a comment cross-referencing `OMT_COMMISSION_RATES.OMT_WALLET`
and stating that the two are independently changeable. Reusing the counter's constant would make a
future change to one silently change the other. **No magic number at the call site** (owner's
standing SOLID rule) and, while touching `omtFees.ts`, collapse the inline `0.001` into the table
entry (rule 14). A per-tenant setting is a small follow-up if OMT ever changes the percentage; do
not pre-build it.

**No exchange rate is involved anywhere in this flow.** "Rate" here means the commission
percentage only. A USD cashout moves USD out of the wallet and credits USD on the account; an LBP
cashout does the same in LBP. Same percentage in both, one `supplier_ledger` row per currency,
never a cross-currency conversion. The rounding helper the repository already uses decides the
minor-unit precision per currency.

### §8.3a Commission is known at creation, recognised at settlement (D14)

D14 splits two things that are easy to confuse:

| Fact                          | When                | Value  |
| ----------------------------- | ------------------- | ------ |
| Account balance owed by OMT   | at the cashout      | 100.10 |
| Profit on the books           | at account settlement | 0.10 |

So the cashout row stores its commission (`0.10`) and stamps `profit_* = 0`, exactly like a
counter SEND under `commission_model = 1` (`FinancialServiceRepository.ts:1980-1991` zeroes the
stamp for model 1). The `supplier_ledger` row is still the full `−100.10`, because that IS what
OMT owes from the moment the balance moves — only the *recognition* is deferred.

**One difference from the counter, and it is deliberate:** the counter's settlement commission is
operator-entered because it is negotiated. The cashout's is **computed and known up front** — it is
deferred only because the money is not real until the account settles. So the settlement must
**sum the stored commissions of the cashout rows in the batch** and stamp that automatically, not
ask the operator to add it up. That is an extension of the existing settlement-day stamp
(`SupplierRepository.ts:1578-1579`, LIRA-137), not a new mechanism.

**This is also why OMT App now runs two commission models at once, correctly:** a SEND/RECEIVE fee
arrives as **cash in the drawer immediately**, so it is profit immediately (model 0, §8.2). A
cashout commission is only a **claim on the account** until settlement, so it is deferred (model
1). The rule is "recognise when the money is real", and it produces different answers for the two
flows. Say so in a comment; a future reader will otherwise read it as an inconsistency and
"fix" it.

**Consequence for build order:** LIRA-192 can ship before LIRA-189, but until 189 lands the
commission is **recorded and not yet recognised** — cashouts show on the account and contribute no
profit. That is the correct intermediate state, not a bug. The stamping belongs to LIRA-189.

### §8.4 The account can now go NEGATIVE — this changes LIRA-189

Today every OMT App and iPick row only ever ADDS debt. A cashout **credits** the account. Enough
cashouts and the OMT account flips to "OMT owes the shop".

LIRA-189 as written assumes one direction — the shop pays OMT — and allocates a payment across
unsettled debt rows oldest-first (D8). With cashouts in the queue it must handle:

- **Mixed-sign rows.** A `+1,050` counter SEND and a `−100.10` cashout in the same account.
  Recommended: credits are applied to the net automatically, so the sheet asks for `949.90`, and
  both rows settle together. The alternative (leave credits out of the allocation and carry them
  forward) leaves the operator doing the arithmetic and is not recommended.
- **A net-negative account.** The settlement sheet must offer the **collect** direction (cash in,
  `SUPPLIER_PAYS_US`) rather than only pay. `SupplierRepository`'s manual cashflow already supports
  both directions (`:2339-2350`: `PAY` = ledger `PAYMENT` (−) + drawer out; `RECEIVE` = ledger
  `SUPPLIER_PAYS_US` (+) + drawer in) — the account settlement path must reuse that, not duplicate
  it (rule 14).

- **Deferred cashout commission (D14, §8.3a).** The settlement must sum the stored commission of
  every cashout row it settles and stamp that as the settlement transaction's profit, per
  currency. Extend the existing settlement-day stamp (`SupplierRepository.ts:1578-1579`) rather
  than adding a second stamping site (rule 14).

**Build LIRA-192 before LIRA-189** so the settlement work is written against the real sign range,
and add a mixed-sign case, a net-negative case, and a deferred-commission case to
`SupplierRepository.accountSettlement.test.ts`.

### §8.5 Naming — "cashout" is already taken three times

Do **not** introduce a bare `CASHOUT`. The term is in use for three unrelated things:

| Existing use                | Where                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `DRAWER_CASHOUT`            | pulling physical cash OUT of the General drawer; `drawer_cashouts` table, `DrawerCashoutRepository`, Dashboard `DrawerCashoutModal.tsx:137` ("Cash Out — General Drawer"), audit label "General Cash-Out" |
| `cashoutMethod`             | the payout method on a financial-service RECEIVE (`FinancialServiceRepository.ts:3118`) |
| session-basket "cashout"    | a RECEIVE / loto-prize payout item (`SessionCheckoutModal.tsx:150-153`)                  |

**Recommendation:** transaction type `WALLET_CASHOUT`, repository method `cashoutToSupplier` (the
mirror of `topUpFromSupplier`), UI button **"Cash Out to OMT"** on the Recharge page's OMT App
header beside Top-Up. A bare "Cash Out" label there would read as the Dashboard's General-drawer
feature in the audit/transactions list, where both would appear as "Cash Out". Owner picks the
visible label — §8.6 Q1.

### §8.6 ANSWERED (owner, 2026-09-14) — nothing open

| Q                          | Answer                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| Button label               | **"Cash Out to OMT"** (D12). Internal type `WALLET_CASHOUT`.                                          |
| Rate source                | **Named constant** (D13). No exchange rate anywhere — USD cashout credits USD, LBP credits LBP.      |
| Profit timing              | **At settlement, like the counter** (D14). Ledger still shows principal + commission at cashout time. |
| Insufficient wallet        | **Block**, per currency (D15).                                                                        |
| iPick / Katsh symmetry     | **No** — OMT App only for now (D16).                                                                 |

Confirmed with the answers: cashout works in **both USD and LBP** at the same 0.1%, booking a
per-currency ledger row and never converting between them.

### §8.7 LIRA-192: OMT App cashout — High (money)

**Depends on:** 187 · **Blocks:** 189 (§8.4) · **Profit stamping belongs to 189** (§8.3a) ·
**Rules 16, 17, 18, 19, 20 apply.**

**Core.** New `RechargeRepository.cashoutToSupplier` — the mirror of `topUpFromSupplier`
(`:1543-1618`). One DB transaction:

1. Guard the `OMT_App` balance for the currency and **reject** an over-draw (D15). This is the one
   place a balance guard is right: the wallet is a prepaid balance OMT actually holds. Do NOT copy
   the PCD's "may go negative, never blocked" rule here (`FEATURE_GUIDE.md` §7).
2. `applyDrawerDelta(OMT_App, currency, −amount)` — written as a real `payments` row (see Reversal
   below), not a bare balance UPDATE.
3. `commission = round(amount × OMT_APP_CASHOUT_COMMISSION_RATE)` using the shared money-rounding
   helper, never inline arithmetic.
4. One `supplier_ledger` row on the `'OMT App'` supplier for `−(amount + commission)`, entry type
   `PAYMENT`-family (pick the existing type whose sign convention already means "they owe us"; do
   NOT invent a `… Debt` string — rule 20's naming guard), `is_auto: true`, with
   `source_ref_table`/`source_ref_id` back-linked so the cascade-void can find it.
5. Unified `transactions` row, type `WALLET_CASHOUT`, storing `commission` = the computed 0.1% and
   `profit_usd`/`profit_lbp` = **0** (D14 — recognised at settlement by LIRA-189, §8.3a). Mark it
   pending settlement so the settlement batch can find it.

Extract the principal/commission/ledger-amount arithmetic as ONE named helper shared with the
top-up path (rule 14) — the two flows are the same rule with opposite signs.

**Transport (rule 19).** IPC handler + mirrored REST route, shared Zod schema in
`packages/core/src/validators/`, adapter fn in `backendApi.ts` + `ElectronApiAdapter.ts` + typed in
`packages/ui/src/api/types.ts`.

**Frontend.** Button labelled **"Cash Out to OMT"** (D12) beside Top-Up in the Recharge page
header, gated to `OMT_APP` only (D16)
(`Recharge/index.tsx:1414-1445` is the existing Top-Up gate). Modal shows amount, currency, the
computed commission, and the resulting account credit before confirming. The commission is computed
in core and echoed to the UI — do not re-implement the rate in the frontend (that is exactly the
preview-vs-stamp divergence class LIRA-185 is auditing).

**Reversal (rule 20) — note the sibling is NOT reversible, and that is a trap here.**
`RECHARGE_TOPUP` sits in `NON_REVERSIBLE_TRANSACTION_TYPES` (`transactionTypes.ts:242`, rationale at
`:227`: "the provider-drawer credit has no payments row either"), so today a mistaken iPick
supplier-credit top-up cannot be voided at all. **Do not copy that classification.** A cashout
stamps PROFIT, so a non-reversible mistake would leave phantom earnings on the books. Make it
reversible: write the wallet movement as a real `payments` row so the type-agnostic
`_reversePayments` restores the drawer, back-link the ledger row so the existing supplier cascade
negates it, and let the generic negated profit stamp handle the 0.10. Then prove create + void nets
to **0 on the `OMT_App` drawer, the `'OMT App'` ledger, the OMT account, and profit, per currency**,
with the test shown to FAIL first (rule 17).

**Tests.** Core jest `RechargeRepository.omtAppCashout.test.ts`: USD, LBP, commission arithmetic,
over-draw rejected (D15), `profit_* = 0` at creation with `commission` stored (D14), void-to-zero.
Desktop e2e `lira-192-omt-app-cashout` driven through the real button, asserting `OMT_System`
delta = **0**, `OMT_App` delta = −amount, account delta = −(amount + commission) — deltas only
(rule 15). Web twin. Keep `FinancialServiceRepository.appWalletTransfer.test.ts` green:
SEND/RECEIVE still book no supplier row, because only the top-up and cashout paths touch the
account.

---

## §9 Structural findings from the pre-implementation recon (2026-09-14)

Eight read-only agents mapped every touch point before any code was written. Four findings change
scope or would have shipped a bug. All were verified in source by the orchestrator, not taken on the
agents' word.

### §9.1 Migration head is v175, so this work is v176

`packages/core/src/db/migrations/index.ts` last entry is `version: 175`
(`backfill_expense_is_auto_metadata`). CLAUDE.md still says v153. The array is NOT sorted by version
in places, but the runner sorts before applying and the recent convention is to append in order.
Template to copy for an ADD COLUMN: **v166 `add_expenses_source_ref`** — it guards with
`PRAGMA table_info` before each `ALTER TABLE ... ADD COLUMN`, and its `down()` uses **native
`ALTER TABLE ... DROP COLUMN`**, which this better-sqlite3 build supports (20+ existing sites).

### §9.2 The cashout ledger row is `PAYMENT`, NOT `SUPPLIER_PAYS_US`

A recon agent proposed `SUPPLIER_PAYS_US` by reading the name. **That is the wrong sign.** Verified
at `SupplierRepository.ts:2343-2351`:

```ts
const isPay = data.direction === "PAY";
const entryType = isPay ? "PAYMENT" : "SUPPLIER_PAYS_US";
// PAY: cash out + reduce what we owe (−). RECEIVE: cash in + settle their debt to us (+).
const sign = isPay ? -1 : 1;
```

`SUPPLIER_PAYS_US` is **positive** — it INCREASES what the shop owes (the supplier handed us cash, so
we owe it back). A cashout hands value TO OMT and must REDUCE the debt, so it is `PAYMENT`, which
`addLedgerEntry` force-negates (`:691-697`). Using `SUPPLIER_PAYS_US` would have moved the account
the wrong way by the full amount. The `entry_type` CHECK enum is fixed
(`TOP_UP, SALE_COST, PAYMENT, ADJUSTMENT, SETTLEMENT, CASH_PRIZE, SUPPLIER_PAYS_US, DISCOUNT, STOCK_INTAKE`),
so no new value may be invented without a table rebuild.

### §9.3 `supplier_ledger` has NO settled flag — D8's selectable queue cannot be built without one

The only unsettled-queue mechanism in the codebase is on `financial_services`
(`is_settled` / `settled_at` / `settlement_id`), read by
`FinancialServiceRepository.getUnsettledBySupplier(provider)`. It covers the OMT **counter** rows
only. iPick / OMT App / Katsh supplier-credit debt is a **raw `supplier_ledger` row with no per-row
flag** — today it can only be paid down in bulk via `recordSupplierCashflow`, never selected
row-by-row.

So the merged, tickable queue D6 and D8 describe does not exist and cannot be assembled from what is
there. **Scope change, decided by the orchestrator (mechanism, not product):** LIRA-187's migration
adds a **second** nullable column, `supplier_ledger.settlement_id INTEGER`, so a ledger row becomes a
selectable line exactly as a financial-service row already is. `settlement_id IS NULL` means open.
One migration, two columns.

**Open product nuance for the owner:** a selected row is all-or-nothing. If a payment does not cover
every selected row, the operator deselects rows rather than part-paying one. There is no
`covered_usd`-style partial-coverage column on `supplier_ledger` (unlike `debt_ledger` and
`partner_ledger`, which both have one), and inventing one is out of scope here. Confirm this is
acceptable before LIRA-189 ships.

### §9.4 The settlement reversal cannot iterate N ledger rows today

`settleTransactions` writes exactly ONE `SETTLEMENT` ledger row, and the settlement transaction's
`source_id` is that single row's id. `TransactionRepository._reverseSupplierSettlement`
(`:3548`) dispatches off that single id. LIRA-189 needs one `PAYMENT` row **per child**, i.e. N rows
under one settlement transaction. The primitive exists — `addLedgerEntry`'s link mode accepts a
`transaction_id`, so N rows can share one — but **no existing reversal code iterates
`supplier_ledger WHERE transaction_id = ?`**. That iteration is net-new work inside LIRA-189 and is
the single highest-risk piece of the epic. It must be proven failing-first (rule 17).

### §9.5 Payment legs lose `direction` in five of six layers

`electron.d.ts` types a settlement payment leg with `direction?: "IN" | "OUT"`, but the field is
absent from `backendApi.ts`, `ElectronApiAdapter.ts`, `packages/ui/src/api/types.ts`, `preload.ts`
and the Zod `supplierPaymentLegSchema`. A pre-existing rule-12 completeness gap. LIRA-189's
collect direction (§8.4) needs it, so that ticket should close the gap across all six layers rather
than adding a sixth partial copy.

---

## §10 What wave 1 actually built, and what LIRA-189 must know (2026-09-15)

Wave 1 — LIRA-187, 188, 190, 192 — is implemented, typechecks clean across all five workspaces, and
the full jest suite is green (635 suites / 5,891 tests / 0 failures). **Desktop and web e2e specs are
written but NOT run** — they need the owner's `yarn dev` → stop → e2e cycle. Nothing is committed
until the owner reviews the diff.

### §10.1 Two real bugs found by running things, not by reading

**(a) A production void bug, in pre-existing code.** `TransactionRepository._unapplySupplierPurchaseCoverage`
matched on `type = SUPPLIER_PAYMENT` + `source_table = 'supplier_ledger'` + `entry_type = 'PAYMENT'`
and then walked `supplier_purchases` FIFO coverage. That triple is NOT unique to a manual
`recordSupplierCashflow` payment — `addLedgerEntry`'s no-drawer branch stamps the same triple for any
cashless auto PAYMENT row, and the new cashout is the first such caller. Voiding a cashout would have
"given back" purchase coverage that was never applied, corrupting `supplier_purchases.paid_usd` on
unrelated product purchases for that supplier. Fixed by also requiring `!ledger.is_auto`.
**Verified safe:** `recordSupplierCashflow`'s own INSERT omits `is_auto` (defaults 0) so the manual
path is untouched, and the only two callers of `_applyPurchaseFifoCoverage` are that manual PAY
branch and the DISCOUNT flow (different `entry_type`, already returns early). Proven failing-first
per rule 17.

**(b) A cashless payment row claiming cash moved.** `addLedgerEntry`'s no-drawer branch hardcoded the
summary `"Supplier Payment: … — paid to <supplier>"` and `counterpartyFlow = "OUT"`, on the premise
that a PAYMENT always pays cash out. A cashout pays no cash. Now an **auto** cashless PAYMENT derives
its summary from the caller's own `note` and its flow from the ledger sign; the manual no-drawer path
and the drawer-based path are untouched.

### §10.2 Facts LIRA-189 depends on

| Fact | Where |
| ---- | ----- |
| The cashout's commission has **no column** — it lives in `transactions.metadata_json.commission` | `RechargeRepository.cashoutToSupplier` |
| Settlement must therefore **sum commission out of metadata_json**, per currency, for the cashout rows in the batch (D14) | LIRA-189 |
| `supplier_ledger.settlement_id` exists (v176), `NULL` = open. Nothing writes it yet | migration v176 |
| `getAccountUnsettled` returns **every** open ledger row, not only `TOP_UP` — a manual adjustment or cashflow entry appears too. D8's tick/untick UI is what scopes a batch | `SupplierRepository.getAccountUnsettled` |
| The cashout ledger row is `entry_type: 'PAYMENT'`, `is_auto: 1`, `source_ref_table: 'recharges'` | ditto |
| `RECHARGE_TOPUP` stays **non-reversible** (§5 LIRA-190, corrected) | `transactionTypes.ts` |
| Payment legs still lose `direction` in 5 of 6 layers (§9.5) — LIRA-189's collect direction needs it closed | §9.5 |
| The account rollup does **not** gate on `is_active`, so a deactivated child still counts toward the headline | `getAccountBalances` |

### §10.3 Smaller decisions worth not re-litigating

- A cashout's `recharges` row reuses `recharge_type = 'TOP_UP'` — the enum has no cashout value and
  changing a SQLite CHECK means rebuilding the table. **Verified no read path filters on
  `recharges.recharge_type`**, so this is a readability gap only; the `WALLET_CASHOUT` transaction
  type is what distinguishes the two everywhere that matters.
- `roundMoneyForCurrency` was added to `utils/omtFees.ts` because no shared money-rounding helper
  existed — only three private, USD-only copies. If a fourth rounding need appears, move it to a
  money util rather than importing `omtFees` for it.
- The cashout writes a real `payments` row for the wallet leg **and** applies the drawer delta. That
  is the correct pairing, not a double-debit: `insertPaymentRow` only writes the journal row, it
  never moves a balance.
- REST audits the cashout only on success while IPC audits unconditionally. Pre-existing asymmetry,
  shared with the top-up pair; left alone.

### §10.4 Owner items — status after the 2026-09-15 review

**CLOSED, do not reopen:**

- **Partial payment of a single ledger line** — the owner confirmed whole-row settlement is what he
  wants (**D18**). Rows stay all-or-nothing; pay less by unticking rows. No coverage column.
- **Round-trip commission on a credit top-up then immediate cashout** — accepted (**D17**). OMT caps
  cashout volume on their own side, so the exposure is bounded. No wash detection.
- **Commission timing** — the owner re-confirmed in his own words that "the commission is paid on
  settlement later on", which is exactly what D14 built.

**STILL OPEN:**

1. **A mistaken OMT App credit top-up cannot be voided**, only corrected by an opposite manual entry
   on the Suppliers page. Unchanged from iPick, but newly reachable from a button (§5 LIRA-190). The
   owner has not ruled on whether that is acceptable.
2. **e2e — partially run, NOT yet green.** Superseded by §12.2; the short version is that the owner
   ran the WEB suite on 2026-09-15, five of this epic's specs failed, all five were fixed, and the
   suite has **not been re-run since**. The DESKTOP suite has never run at all.
3. ~~**LIRA-193**~~ — **FIXED 2026-09-15** on the owner's go. Three defects closed, not the two filed:
   the reconciliation gap, a mutual-exclusion gap found while tracing, and a currency-bucketing leak
   the adversarial review found AFTER the first fix landed. Full suite 5,963 tests green, and 17
   real settlement scenarios re-run to prove nothing legitimate is now refused.

---

## §11 LIRA-189 settlement: what four adversarial rounds found (2026-09-15)

`settleAccount` was written once and then attacked four times. **Five real defects were found**, each
reproduced by running code, and each fixed with a failing-first proof (rule 17: the bug was
reintroduced, the new test watched to fail, then restored). Recording them because every one is a
pattern that will recur in the next money flow.

| # | Defect | How it leaked |
| - | ------ | ------------- |
| 1 | Payment legs never reconciled against the settled amount | Settling a $100 debt with a $150 CASH leg was accepted: ledger nets to 0, drawer drops $150. $50 out with no ledger row, no profit stamp, no kept-change record |
| 2 | Rule 16 violation — same sign applied to every leg | An OUT (change) leg was debited instead of credited. Proven: drawer landed at 800 where 900 was correct |
| 3 | Legs that move no drawer still counted as settled | `[{CASH,70},{CUSTOMER_ACCOUNT,30}]` against $100 reconciled on paper; only $70 left the drawer; the ledger stamped $100 settled |
| 4 | Cross-drawer wash | An equal-and-opposite IN/OUT pair nets to zero in the guard but routes to two DIFFERENT drawers. Real money moved between the shop's own drawers, unaudited, desyncing the closing count |
| 5 | Validate-then-write race, plus unverified writes | Eligibility was read before the transaction opened; the stamps guarded only on `settlement_id IS NULL`, never re-checked `is_refunded`, and ignored `.changes`. A row voided in the window was still negated and stamped. A stamp affecting zero rows counted as success |

A sixth was found by the fix agent itself before the attackers reached it: the deferred cashout
commission was read **before** the write transaction, so a cashout voided in that window could stamp
phantom profit.

### §11.1 The shape of the bug class, which is the durable lesson

Four of the six are the same mistake: **two pieces of code independently deciding which legs count,
or when to read state.** The guard summed one set; the posting loop posted another. The eligibility
check read at one moment; the write acted at another.

Patching each symptom would have left the seventh. The fixes therefore derive both sides from ONE
predicate (`assertLegMovesADrawer`, the shared `accountMemberOf` fragment) and move every read that a
write depends on **inside** the transaction. Defect 4 was closed not by another check but by removing
the capability: **OUT legs are rejected outright in `settleAccount`** — a supplier settlement has no
customer, so there is no change to return. The now-unreachable OUT handling was then deleted, because
dead code in a money path tells the next reader a lie.

### §11.2 What the final verifiers confirmed

- **No over-tightening.** Nine probes of legitimate settlements — split legs, LBP-only, wallet-only,
  multi-member, mixed-currency — all still succeed. Four rounds of guards block nothing a shop owner
  would reasonably attempt. This mattered as much as the leaks.
- **Reversal is sound.** 15 scenarios against void and refund found nothing.
- **Money derivation is exact.** A verifier that ignored every comment and traced the arithmetic
  across 9 scenarios found no discrepancy.

### §11.3 Two findings deliberately NOT fixed

**(a) Cashing out more than was advanced on credit is CORRECT, not a leak.** A reviewer flagged a
$50 credit top-up plus a $200 customer inflow, then a $150 cashout leaving the account at −$100.15.
A customer RECEIVE converts the shop's own drawer cash into wallet balance, so the wallet holds real
value whatever its origin, and returning it to OMT means OMT genuinely owes it. **Do not add an
"only cash out what was advanced" restriction.**

**(b) The round-trip commission is an OWNER DECISION, not a code defect.** Top up $X on OMT credit,
immediately cash the same $X back out: the wallet ends where it started, no real cash moves, and the
account nets to **−0.1% × X — OMT owing the shop money that was never real.** Repeat it and the
figure grows linearly. Whether OMT pays 0.1% on a wash is a fact about the shop's agreement with OMT,
not something to invent in code. **RESOLVED 2026-09-15 (D17): accepted, no action.** OMT limits
cashout volume from their own system, so the exposure is bounded ($1 per $1,000 cycled) and the owner
is content to leave it. **Do not add wash detection.**

### §11.4 The same bug class WAS live in shipped code — fixed 2026-09-15 as LIRA-193

Three independent agents found, and were initially told NOT to fix, the same defects in code this
epic did not introduce. **The owner then gave the go and they were fixed** — see `current_sprint.md`
LIRA-193 for what shipped, including a THIRD defect (currency bucketing) that only surfaced when the
fix itself was adversarially attacked. The three originally found were:

- **`settleTransactions`** (the single-supplier settlement shipping today) never reconciles
  `data.payments` against `amount_usd`/`amount_lbp` at all on the normal cash-owed path — it only
  checks that at least one leg exists. Its posting loop silently skips non-drawer-affecting methods.
  So a settlement paid entirely in `CUSTOMER_ACCOUNT` legs would stamp the batch fully settled with
  **zero dollars moving**.
- **`recordSupplierCashflow`** has the identical silent skip with no reconciliation guard at all.
- The **single-supplier settle UI** has the same missing upper bound the account sheet had.

Defect 1 and defect 3 of the table above therefore exist in production right now. This work only
found them because settlement was being rewritten beside them. **Recommend a dedicated ticket at
high priority.**

---

## §12 What shipped, where, and what remains (2026-09-16)

### §12.1 Commits

| Commit | What |
| ------ | ---- |
| `40a184c8` | The epic: LIRA-187/188/189/190/192 + LIRA-193. 81 files, migration v176 |
| `02d033a4` | The account settle sheet was unreachable on a laptop screen (no height cap, no internal scroll, so its top was pushed off the viewport). Plus three corrected web-spec assertions |
| `6ea06edf` | The Transactions type filter ignored five of its own filters on web, and now takes several types at once. Not strictly this epic, but it was found while looking at OMT rows and the fix is what makes filtering by "Whish App Send" actually show only that |
| `3dbb82b9` | Opening any dropdown dragged the whole page sideways. Shared `Select`, so it affected every screen, not just OMT |

`LIRA-191` is **not** in any of them, deliberately.

### §12.2 e2e — the honest status

**This is the one real gap.** The specs exist; they are not proven.

| Suite | State |
| ----- | ----- |
| Web | Run once by the owner on 2026-09-15. **Five of this epic's specs failed**, all five were fixed in `02d033a4`, and the suite has **NOT been re-run since**. So the fixes themselves are unverified. |
| Desktop | **Never run.** Four specs, entirely unexecuted. |

Six *other* web specs failed in that same run and are **not** this epic's fault — three carrier-line
specs that have been broken since the Profits password shipped on 2026-09-07 (the spec predates the
gate), two maintenance-parts specs, and one flaky debts timeout. Worth their own ticket; they have
been red for over a week without anyone noticing.

Before running desktop: do a `yarn dev` cycle. Several agents rebuilt the native module for Node
during this work, so the desktop app and its e2e will fail at startup until the Electron build is
restored. That is the documented ABI flip, not damage.

### §12.3 What actually remains

1. **LIRA-191** — grouping configurable in Service Providers settings, and the Whish-base question
   (§5, D9). Deferred by the owner until the account has been used in anger. Unchanged.
2. **Prove the e2e** (§12.2). The last thing standing between this and "done".
3. **One unanswered owner question**: a mistaken OMT App credit top-up cannot be voided, only
   corrected by an opposite manual entry. Unchanged from how iPick has always behaved, but now
   reachable from a button, so more people will hit it. The owner has not ruled on whether that is
   acceptable (§10.4).

### §12.4 Things found along the way that outlived this epic

- **LIRA-193** — the leg-reconciliation bug class was LIVE in shipped code (`settleTransactions`,
  `recordSupplierCashflow`). Fixed (§11.4). Three defects, not the two filed.
- **The shared `Select` pinned its panel by the right edge**, so a wide trigger pushed the panel past
  the window, gave the document horizontal scroll it was never meant to have, and let focus drag the
  whole app shell sideways. `MultiSelect` and `InventoryFiltersPopover` already pinned left; `Select`
  was the odd one out. Fixed in `3dbb82b9`, and `MainLayout` now locks document overflow as a
  backstop.
- **`max-h-60` on that panel had never worked** — @headlessui writes `maxHeight` inline and an inline
  style beats a class. Worth remembering before writing another Tailwind cap on a floating panel.
