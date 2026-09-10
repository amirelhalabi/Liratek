# OMT open-credit account — iPick + OMT App roll up under the OMT supplier

Tickets **LIRA-187 → LIRA-191** in `current_sprint.md`. Planned 2026-09-10 from an owner interview
(2026-09-09/10); every file:line below was opened and read on `main` that day. **Status: READY TO
IMPLEMENT — all owner decisions answered (§1). Nothing built yet.**

**Priority: HIGHEST** (owner, 2026-09-11).

---

## §1 Owner decisions

| #   | Decision                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | OMT is ONE open-credit account. The counter (OMT SEND/RECEIVE), the OMT App wallet, and iPick credit all draw on it. Settlement is one payment to OMT.                                                                              |
| D2  | The OMT Cash Drawer (`OMT_System`, the PCD) holds **physical cash in store only**. Loading the OMT App wallet or iPick credit moves **no cash** — the wallet/iPick drawer goes up and the account debt goes up by the same amount. |
| D3  | Every settlement of the account (counter, app, iPick debt alike) debits the **OMT Cash Drawer** (or whichever legs the admin picks; CASH resolves to the PCD as today).                                                              |
| D4  | OMT App wallet top-up: **credit is the default**. Keep the existing drawer-to-drawer transfer available as an explicit alternative.                                                                                                    |
| D5  | Historical OMT App cash top-ups: leave as recorded. No backfill.                                                                                                                                                                      |
| D6  | Suppliers page: OMT shows as an **account card** with OMT counter / OMT App / iPick as **sub-rows**, each with its own drawer badge and contribution. Ledger and settlement queue merge all three with a **Type** column. |
| D7  | Katsh stays standalone.                                                                                                                                                                                                              |
| D8  | Partial settlement allocation: **oldest rows pre-selected, admin can change the selection**.                                                                                                                                          |
| D9  | Whish-base shops / Whish App under Whish: **deferred**. The grouping is data (a column), not code, so it can be reconfigured later.                                                                                                    |

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

| Event                                  | Ledger row today   | Account |
| -------------------------------------- | ------------------ | ------- |
| OMT SEND, principal 1,000 + fee 50     | OMT supplier +1,050 | 1,050  |
| iPick supplier-credit top-up 200       | iPick supplier +200 | 1,250  |

Owner pays OMT 1,250 once from the OMT Cash Drawer.

- **Single row on the parent (rejected):** OMT shows −200 (OMT owes shop), iPick still +200
  (unpaid). Account total 0, every child wrong, unsettled queue lies.
- **Allocated rows (chosen):** −1,050 on OMT, −200 on iPick. Every child nets to 0, account nets to
  0, one cash leg leaves the drawer.

---

## §5 Tickets

### LIRA-187: `suppliers.account_supplier_id` — the account link (schema only) — Medium

**Depends on:** nothing · **Blocks:** 188, 189, 190

Add nullable `account_supplier_id INTEGER REFERENCES suppliers(id)` to `suppliers` (migration in
`packages/core/src/db/migrations/index.ts` — take the NEXT number from the last entry, do not trust
any version quoted in prose — AND `electron-app/create_db.sql`). Seed per tenant:
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

**Reversal.** The credit top-up's `TOP_UP` row + `RECHARGE_TOPUP` transaction must void to 0 on the
OMT App ledger AND the OMT_App drawer — iPick's existing void path is the model; add the OMT_APP case
to the same guard test, failing-first.

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
3. LIRA-189 (needs 188's membership predicate and unsettled union; money).
4. LIRA-191 only after the owner has used 187–190.

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
