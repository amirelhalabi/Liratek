# Posting Integrity Plan — close the multi-ledger gaps

> **Status:** IN PROGRESS — batch 1 started 2026-10-06 (LIRA-258); phase 5 started 2026-10-07 (§7). Created 2026-10-06.
> **Overlap:** LIRA-257 (another session, same day) already seeds the seven system suppliers for
> every tenant (`db/systemSuppliers.ts`, migration v191). That covers the "seed on provisioning"
> half of D2; item 1.3 reuses it for the get-or-create path instead of adding a second definition.
> **Source of the gaps:** [`docs/POSTING_MAP.md`](../../POSTING_MAP.md) §7 (G1–G31). This plan
> does not repeat the gap text; it says what to do about each one. Visual summary:
> the "LiraTek Posting Gaps" artifact (owner's claude.ai gallery).
> **Proposed tickets:** LIRA-258 onward (LIRA-257 was taken by the supplier-seeding fix) (next free ID per `PLAN_OVERVIEW.md`). File each ticket
> in `current_sprint.md` when its work starts, not up front.

---

## 0. The goal in one paragraph

Every money transaction writes records into several ledgers. Today nothing lists which records
each path must write, so a branch that skips one fails no test (`POSTING_MAP.md` §8). This plan
fixes the gaps found on 2026-10-06 **and** adds the missing guard: a shared test helper that
proves, per path, "these exact records were written, and voiding nets every ledger to zero".
The helper grows into a typed table of posting rules once enough paths use it. A single posting
engine (option C) is out of scope unless the table shows the same class of bug keeps coming back.

---

## 1. Owner decisions — all answered 2026-10-06 (interview)

| # | Question | Answer | What it changes |
| --- | --- | --- | --- |
| D1 | FOR-partner OMT/WHISH SEND: what does each side owe? | Partner owes `x + f`; shop owes OMT `x + f` (whole fee to OMT, commission back at settlement); **no drawer moves**. | 1.2 |
| D2 | Supplier row missing or turned off? | **Create (or re-activate) it automatically**, the Loto way, and seed the system suppliers when a new web shop is provisioned. Never skip the debt silently. Finding behind it: new web tenants are provisioned with **no** OMT/Whish supplier rows (`TenantRepository` seed excludes them) and `getByProvider` ignores inactive suppliers, so today those shops skip every supplier posting. | 1.3, 2.2 |
| D3 | Through-partner transfers on the second system? | They are **not** supplier-pending (no supplier settlement ever applies). The Dashboard **Pending Settlement** banner covers what must be settled **in every ledger**, so they appear there as **partner** pending (e.g. "Ali: 3 pending — you owe $303"), cleared by settling the partner. | 1.4 |
| D4 | DAYS sale: do line credits really drop? | **Yes.** Selling days costs credit per month (e.g. 3 SMS × $0.30 for 30 days) and that credit leaves the line. A DAYS sale must lower the primary line's credits by the same `daysCostUsd` the drawer already loses. `topUpApp` into MTC/Alfa: same "drawer = Σ lines" rule — verify and align in 4.3. | 4.3 |
| D5 | Via-partner custom service profit timing? | **When the partner pays** (same coverage rule as FOR rows). | 4.2 |
| D6 | Undo refund in a basket for recharges / custom services? | **No — keep POS only.** G19 closed as "by design". | 3.3 dropped |
| D7 | Through-partner amounts? | **Amount = what the partner tells you to collect → owed to the partner** (today's behaviour, keep). **Fee = the shop's own fee → 100% profit, counted immediately** (today it is stamped 0 and never recognised — new gap **G32**). Add a form hint: "Amount = what the partner tells you · Fee = your shop fee". | 4.1 |
| D8 | Maintenance job re-saved as paid? | **Never charge twice.** Changing a payment means refunding it first. | 2.6 |
| D9 | Keep-change on Exchange? | **Yes, add it.** (Today the Exchange payment sheet never shows the toggle, so nothing is lost now.) | 4.6 |
| D10 | Old data? | **Reset everywhere, including cornertech.** No repair scripts. | all |

## 2. Ground rules for every item

- **Verify before fixing (rule 17).** 27 of the 31 gaps are *Reported* by an audit, not seen
  failing. Each money item starts with a guard test against **today's** code. It fails → the gap
  is real and the failing-first proof is recorded. It passes → the audit was wrong: strike the
  gap in `POSTING_MAP.md` §7 and drop the item. Nothing is fixed that nobody has seen fail.
- **Never re-break finished code to prove a test** (rule 17, owner decision 2026-09-26).
- **Tests that pin the wrong behaviour are rewritten, not deleted** (rule 24) — listed per item.
- **Every new record gets a reversal owner in the same change** (rule 20) and, if written by the
  system, `is_auto` derived from its link (rule 26).
- **Both transports** (rule 19): fixes live in `packages/core`, which desktop and web share; any
  form change is made once in the shared frontend.
- **Release note** (rule 30) for every change a cashier or owner can see.
- **`POSTING_MAP.md` updated in the same commit** as any posting change (its §9).
- **Shipping:** a push to `main` deploys to production (Vercel + Fly). Each batch needs the
  owner's go. Changes touching frontend and core deploy separately, so for a few minutes an old
  page can talk to a new server; batches with a payload change say so in their release step.

Gates per batch: core build + sync (`cp -r packages/core/dist/. node_modules/@liratek/core/dist/`),
`yarn typecheck`, `yarn lint`, core / backend / electron / frontend jest (check elapsed time, not
just exit code — rule 28a), desktop e2e via the CLAUDE.md procedure, web e2e for touched flows.

---

## 3. Phase 1 — the reported bug, and the helper that guards the whole class

**One stream, one file:** everything here edits `FinancialServiceRepository.ts`, so it ships as
one batch.

### 1.1 Posting test helper (built inside 1.2, not as its own project)

`packages/core/src/__tests__/helpers/postingAssert.ts`:

- `snapshotLedgers(db)` — drawer balances, Σ `payments` per drawer/currency, supplier balances
  (`getSupplierBalance`, non-refunded rows), partner balances, client debt balances, Settle-queue
  rows.
- `expectPostings(before, after, expected)` — asserts the **exact** delta per ledger and fails on
  any unexpected delta (a missing posting and an extra posting both fail).
- `expectVoidNetsToZero(txnId)` — voids through `TransactionRepository` and asserts every ledger
  is back to `before`, **per currency**.
- `expectQueueMatchesLedger(provider)` — every row the Settle queue lists has its supplier
  posting (invariant 2 in `POSTING_MAP.md` §6).

### 1.2 G1 + G2 + G24 — FOR-partner OMT/WHISH SEND (LIRA-258) — **Buildable now** (D1)

| | |
| --- | --- |
| Fix | In the FOR-partner SEND arm, split OMT/WHISH from OMT_APP/WHISH_APP (app wallets keep paying from the wallet — unchanged). For OMT/WHISH: refuse OUT legs (same as FOR RECEIVE); compute **one** `grossOwedDelta(...)` value; write the supplier `TOP_UP` with `source_ref_table/id` (so the generic sibling cascade reverses it — rule 20) and the partner `FOR_*_SEND` DEBIT from the **same** number. Pull the RECEIVE arm's supplier booking into one helper both arms call (rule 14). No empty `catch` in the new code. |
| Frontend | `Services/index.tsx` FOR SEND branch sends `payments: []` for OMT/WHISH; stop sending a non-CASH `paidByMethod` there, or hide the paid-by picker for that case. |
| Failing-first test | `partner.test.ts`: FOR OMT SEND (USD, LBP) writes supplier `+(x+f)`, partner `+(x+f)`, no drawer delta; void nets to 0; settling the queued row leaves the OMT balance at 0 (closes G2 for this case). One WHISH case with `shop_base_system = WHISH`. |
| Tests to rewrite | `partner.test.ts` :456 (PCD debited → unchanged), :483, :503 (amount from `x+f`, not legs), :584 ("[OPEN OWNER QUESTION]" → asserts the TOP_UP), :1661, the `disbursementLeg` helper's OMT uses; grep `OmtSystemFeeCharacterization.test.ts` for FOR SEND. E2E: `lira-119`, `lira-services-for-partner-ui`, `lira-118`, `lira-120`, and `lira-web-*` FOR specs that assert drawer deltas on an OMT FOR SEND. |
| Docs | `FEATURE_GUIDE.md` §8.1.0 and §7 PCD row: SEND joins RECEIVE as "obligations only". `PRIMARY_CASH_DRAWER_PLAN.md` §6 item 6a closed with D1. |
| Release note | Suppliers / OMT: "Sending an OMT or Whish transfer for a partner now shows on the OMT/Whish supplier page as money you owe, and no longer takes cash out of a drawer." |
| Size | M |

### 1.3 G4 — stop swallowing OMT/WHISH supplier booking errors — **Buildable (D2: auto-create)**

| | |
| --- | --- |
| Fix | One `ensureSystemSupplier(provider)` in `SupplierRepository` (get, re-activate if inactive, or create — the Loto pattern, rule 14) used by every auto supplier posting. Seed the system suppliers in tenant provisioning. Remove the empty `catch` at both booking sites: any other error propagates and rolls back the whole transaction. |
| Precondition | None for missing suppliers (they are created). Still worth a read-only owner check of which tenants were missing them, since those tenants have had no supplier postings so far (D10: reset, no repair). |
| Failing-first test | Supplier row deleted / set inactive → today the transaction commits with no supplier posting; after → the supplier exists and the posting is written. A forced ledger error rolls everything back. |
| Size | S |

### 1.4 G3 + G32 — second-system THROUGH rows: partner-pending, fee is profit — **Buildable (D3, D7)**

- Stamp second-system THROUGH rows as **not supplier-pending** (base-system check in
  `isPendingSupplierSettlement` / `pendingSettlementSql()`, one definition).
- Stamp the shop fee as profit at creation for these rows (G32, D7).
- Dashboard **Pending Settlement** banner becomes all-ledger: supplier lines (as today) plus
  partner lines from unsettled partner balances, e.g. "Ali: 3 pending — you owe $303" (D3).
- Form hint on the THROUGH-partner Services form: "Amount = what the partner tells you · Fee =
  your shop fee".
- Guards: `expectQueueMatchesLedger` over every OMT/WHISH mode; THROUGH-secondary profit = fee.
- Release note (Dashboard / Services). Size M.

### 1.5 G18 — basket WHISH RECEIVE fee profit — verify first

Guard test; if confirmed, gate `whishReceiveFeeProfit` on `!deferPayment` (the basket books the
fee). Size S.

### 1.6 Invariant sweep test

One parametrised core test that runs **every OMT/WHISH mode** (walk-in, basket, THROUGH base,
THROUGH secondary, FOR SEND, FOR RECEIVE × USD/LBP) through the helper and asserts invariants 1
and 2 of `POSTING_MAP.md` §6. This is the class guard: a future branch that skips the supplier
posting fails here. Size S.

---

## 4. Phase 2 — money balances in other modules (parallel streams)

Different repositories, so these can run side by side. Each starts with its failing-first guard.

| Item | Gaps | Repository | Fix | Decision | Size |
| --- | --- | --- | --- | --- | --- |
| 2.1 FOR-partner sale in a basket | G6 | `SalesRepository`, `SessionPaymentService` | Write `FOR_POS` even under `deferPayment`, and keep the partner sale out of the basket's money. Guard: partner balance +price, basket untouched, void nets to 0. | — | M |
| 2.2 Missing supplier on top-up | G10 | `RechargeRepository.topUpFromSupplier` | Use `ensureSystemSupplier` (D2); never credit the drawer without the debt. | D2 ✔ | S |
| 2.3 Ignored store-credit failure | G13 | `SalesRepository` (+ other `addCredit` callers) | Check the result; fail the sale if the credit is not written. | — | S |
| 2.4 Atomic counterparty operations | G11 | `SupplierRepository.addLedgerEntry`, `PartnerService.settle` / `recordPartnerTransaction` | Wrap each operation in one `db.transaction`. Guard: force the second write to throw, assert nothing was written. | — | M |
| 2.5 Drawer moves with no journal row | G8, G9 | `SupplierRepository` manual PAYMENT; `DrawerTopUpRepository.createTopUpFromDrawer` | One `payments` row per currency moved. Guard: after the operation, `recalculateDrawerBalances` changes nothing. | — | S |
| 2.6 Maintenance double charge | G7 | `MaintenanceService` / `MaintenanceRepository.processPayments` | Decide "already paid" from the MAINTENANCE transaction existing, not from `payments` rows. | D8 ✔ | S |
| 2.7 POS completion retry | G12 | `SalesRepository.processSale` | On retry, reverse **all** earlier postings (stock, FIFO, debt, `FOR_POS`, credits) before re-posting — or refuse a retry on a completed sale. Verify first. | — | M |
| 2.8 Loto leg reconciliation | G14 | `LotoTicketRepository` | Call `reconcileLegs`; handle GIFT_CARD and CA-change like Recharge; reject unknown methods. Editing a ticket's amount: refuse after creation, or re-post. | — | M |
| 2.9 Basket profit hold | G17 | `SessionPaymentRepository` / `ProfitRepository.notDebtPending` | Verify first. If real: let the hold match basket debt through the session link. | — | S |

---

## 5. Phase 3 — reversals (rule 20)

| Item | Gaps | Fix | Decision | Size |
| --- | --- | --- | --- | --- |
| 3.1 Partner share on item refund | G5 | `SalesRepository.refundSaleItem` reverses the refunded share of `FOR_POS` (pro rata, same currency) using the generic partner-reversal helper; the undo re-posts it. Guard: refund one of two items → partner balance falls by that item; undo restores it. | — | M |
| 3.2 Credits on item refund | G21 | Item refund also cancels the linked `CREDIT_DEPOSIT` share; voucher returns to usable when its credit is reversed. | — | S |
| 3.3 Undo refund scope | G19 | **Dropped** — D6: keep POS only. Document as by design. | D6 ✔ | — |
| 3.4 Cascade semantics | G20 | Verify first. If a refund should refund (not void) its auto siblings, add a refund-mode cascade. | — | S |
| 3.5 Custom-service delete journal | G22 | `deleteService` stops hard-deleting `payments`; rely on the void's reversal rows. | — | S |
| 3.6 Loto settlement | G23 | Link the `SETTLEMENT` row to its transaction; resolve the LOTO supplier explicitly (no `|| 1`); reconcile legs to net; name a reversal owner or keep it non-reversible with that reason documented. | — | M |

---

## 6. Phase 4 — one formula per obligation, labelling, cleanup

| Item | Gaps | Fix | Decision | Size |
| --- | --- | --- | --- | --- |
| 4.1 Partner amount function | G24 (rest), G25 | One `partnerOwedDelta(...)` beside `grossOwedDelta`: FOR = `x + f` (D1), THROUGH = amount (D7, unchanged). G25 closes as "by design". | D7 ✔ | S |
| 4.2 Via-partner profit timing | G16 | Include `THROUGH_CUSTOM_SERVICE` in the partner-coverage deferral. | D5 ✔ | S |
| 4.3 Carrier invariant | G15 | DAYS sale also moves the primary line's credits by `−daysCostUsd` (same movement row, reversed by the generic carrier-line reversal). Verify `topUpApp` into MTC/Alfa against the same rule and align it. | D4 ✔ | S–M |
| 4.4 Labels and types | G26, G27, G30 | Distinct THROUGH keys for app wallets (check reports first); map `SUPPLIER_PAYS_US` / `TOP_UP` to their own transaction types; give Line_Usage a source link so it is `is_auto`. | — | S |
| 4.5 Payment-method fee | G28 | Post the fee leg on catalog and wallet flows the way system SEND does. Verify first. | — | S |
| 4.6 Exchange keep-change | G29 | Build it (D9): pass `onKeptChange` from the Exchange page, add kept-change fields to the exchange schema/repository, stamp as profit, reversed by the REFUND row. | D9 ✔ | M |
| 4.7 Stale comments | G31 | Correct the four comments. | — | S |

---

## 7. Phase 5 — promote the helper to posting rules (option B)

Once phases 1–3 have put most money paths through `postingAssert`, move the expected postings
from individual tests into one typed table, `constants/postingRules.ts`
(`transactionType × mode → required ledgers and amount functions`). Tests then read the table,
and `POSTING_MAP.md` §4 links to it as the source of truth. Optional: a dev-only runtime check
that a created transaction matched its rule. **Option C (one posting engine)** is reconsidered
only if this table keeps catching the same class of gap.

### Phase 5 progress — started 2026-10-07 (owner approved option B)

**Built (working tree, not committed):**

- `packages/core/src/constants/postingRules.ts` — `POSTING_RULES` (`satisfies Record<string, PostingRule>`,
  keys like `"FS_SYSTEM/SEND/FOR"`, `"LOTO/ticket/account"`). Each rule names its `transactionType`,
  a `mode` label, a `mapRef`, and **all four** ledgers (`drawers`, `supplier`, `partner`, `debt`) as
  `{ post: "post", lines }` / `{ post: "none" }` / `{ post: "unchecked", reason }`. A line names a
  **role** (`pcd`, `general`, `tender`, `providerSupplier`, `partner`, `client`), a currency
  (`"txn"` or fixed) and an amount function of `{ x, f, c, currency }`. Pure leaf, test-only,
  deliberately **not** re-exported from `constants/index.ts` (rule 29).
- `POSTING_RULE_EXCLUSIONS` — every transaction type without a rule, tagged `no-money`
  (CLIENT_*, KEPT_CHANGE), `reversal` (REFUND, REFUND_UNDO, HOLD_MONEY_COLLECT_VOID — guarded as
  create + reverse nets to 0, rule 20) or `todo-phase5`.
- `postingAssert.ts` — added `expectedPostingsForRule` and `expectPostingsMatchRule(rule, before,
  after, inputs, keys)` (full delta per ledger; `unchecked` ledgers skipped). Existing exports
  unchanged.
- Guards: `constants/__tests__/postingRules.guard.test.ts` (meta-guard: every TRANSACTION_TYPES value
  is ruled or excluded, never both, no stale exclusion, every rule declares four ledgers). Rule 17:
  its first run was against a classification missing the `todo-phase5` block (drafted, then
  removed before that run) — it failed listing 40 unclassified types (SALE, EXCHANGE, RECHARGE,
  LOTO_CASH_PRIZE …); the block was added back after. `repositories/__tests__/postingAssert.rules.test.ts`
  proves the helper fails on a missing posting, a wrong amount and an extra drawer posting.
- Converted: the item 1.6 OMT/WHISH invariant sweep (`FinancialServiceRepository.partner.test.ts`)
  now reads its expectations from the table — same supplier and Settle-queue numbers as before
  (rule 24), plus a full-delta check on drawers/partner/debt and a new basket SEND case (16 cases,
  was 14). Loto tickets: a table-driven describe in `LotoTicketRepository.legIntegrity.test.ts`
  (walk-in / account / FOR, each voided back to 0).

- Recharge & carrier batch (2026-10-07, working tree): 14 new rules — `RECHARGE/sale/{walk-in,
  account,FOR,basket}`, `RECHARGE/DAYS/walk-in`, `TELECOM_CREDIT_BUYBACK/{cash,account}`,
  `TELECOM_SELF_CHARGE/catalog`, `CARRIER_LINE_ADJUSTMENT/manual`, `RECHARGE_TOPUP/{app,supplier,
  partner,client}`, `WALLET_CASHOUT/OMT_APP`. New drawer roles `carrier` / `wallet` / `source` and
  optional inputs `carrierUsd` / `smsUsd` (read through `need()`, which throws if a test forgets
  one). New exclusion reason `retired` for `MTC_TOPUP` / `ALFA_TOPUP` (their only writer,
  `topUpFromCustomer`, was deleted in Phase 8.2). Test: `repositories/__tests__/
  RechargeCarrier.postingRules.test.ts` (real `create_db.sql` schema, 24 cases incl. the MTC/Alfa `topUpApp` refusal): each case asserts
  one transaction of the rule's type, the full four-ledger delta from the table, line credits ==
  carrier drawer delta, then voids and asserts every ledger and the lines net to 0 per currency.
  `CARRIER_LINE_ADJUSTMENT` (NON_REVERSIBLE) instead asserts the void is refused and changes
  nothing, and that the documented owner (an opposite edit) nets to 0. Characterization, not
  failing-first: every case passed on first run; three deliberately wrong inputs were then shown
  to fail (sensitivity check) and restored. The code contradicted three §4.2/§4.3 cells; in each
  case the code matches an already-recorded fix, so the cells were corrected rather than filed as
  gaps: DAYS sale lowers line credits by the days cost (30 days at $0.90 → Alfa drawer −0.90 and
  line −0.90; map said credits unchanged — G15/D4); `topUpApp` refuses MTC/Alfa (map said
  MTC/Alfa +; refusal tested, nothing posts — G15); `topUpFromSupplier` always books its TOP_UP
  (map said "only if a supplier row exists" — G10). `topUpFromClient` had no map row (x = 100,
  fee 5 → General −95, Whish_App +100); one was added to §4.2.

- Drawers & counterparties batch (2026-10-07, working tree): 22 new rules — `DRAWER_TRANSFER/
  between-drawers`, `DRAWER_TOPUP/{external,from-drawer}`, `DRAWER_CASHOUT/general`,
  `CHECKPOINT/count`, `SUPPLIER_PAYMENT/{pay,receive,manual-drawer}`, `SUPPLIER_ADJUSTMENT/paper`,
  `SUPPLIER_STOCK_INTAKE/receive`, `SUPPLIER_RECORDED_DEBT/open`, `SUPPLIER_SETTLEMENT/system-model1`,
  `PARTNER_SETTLEMENT/{partner-owes,shop-owes,client-account}`, `PARTNER_PAYMENT/{add-debt,
  add-credit}`, `PARTNER_ADJUSTMENT/paper`, `COUNTERPARTY_DISCOUNT/{client,partner-forgiven,
  partner-received,supplier}`. New drawer roles `destination` / `counted`; `providerSupplier` now
  also means "the supplier the operator picked". Test: `repositories/__tests__/
  DrawersCounterparties.postingRules.test.ts` (real `create_db.sql`, 41 cases, USD and LBP): each
  case asserts the exact set of NEW transaction rows by type and `is_auto` (rule 15 — not "one
  row of the type"), the full four-ledger delta (a payment with a bundled discount is asserted
  against the SUM of its two rules), then voids a reversible type back to 0, or for a
  NON_REVERSIBLE type asserts the void is refused, nothing moved, and the correction entry nets to
  0. Characterization, not failing-first: all 41 passed on first run; four deliberately wrong
  table entries / expectations (partner settle sign, settlement without commission, top-up
  without its source leg, supplier-discount leftover) then failed 8 cases and were restored. The profit stamp is also read on the client write-off (−x) and the bundled supplier discount (+40); flipping either expectation failed 2 cases. The
  code contradicted one §4.7 cell, and it follows an already-recorded fix: "Manual supplier entry
  with drawer — one `payments` row only" (G8: USD 50 + LBP 1,000,000 writes two rows, −50 and
  −1,000,000). Corrected; five missing §4.7 rows added from the code. **Measured, not decided:**
  voiding a supplier PAY with a bundled discount ($60 + $40) leaves the supplier at −40 — the
  DISCOUNT row stays (no link to the payment; COUNTERPARTY_DISCOUNT is NON_REVERSIBLE), unlike a
  partner settle void, which sweeps its discount. Pinned as today's behaviour and reported as a
  candidate gap for the owner; not filed in §7 from this batch. Corrections the tests use but no
  code or decision names: cash-out ↔ external top-up (only top-up → cash-out is documented),
  from-drawer top-up → reverse `transferBetweenDrawers`, write-offs → an opposite paper entry.

**Covered:** drawers & counterparties (§4.6 cash-out, §4.7: DRAWER_TRANSFER, DRAWER_TOPUP,
DRAWER_CASHOUT, CHECKPOINT, manual SUPPLIER_PAYMENT, SUPPLIER_SETTLEMENT, SUPPLIER_ADJUSTMENT,
SUPPLIER_STOCK_INTAKE, SUPPLIER_RECORDED_DEBT, PARTNER_SETTLEMENT, PARTNER_PAYMENT,
PARTNER_ADJUSTMENT, COUNTERPARTY_DISCOUNT); FINANCIAL_SERVICE — OMT/WHISH system transfers (§4.1, all modes incl. basket);
LOTO — ticket sale (§4.4: walk-in, customer account, FOR partner); RECHARGE, TELECOM_CREDIT_BUYBACK,
TELECOM_SELF_CHARGE, RECHARGE_TOPUP (all four writers), WALLET_CASHOUT, CARRIER_LINE_ADJUSTMENT
(§4.3 and the matching §4.2 rows); MTC_TOPUP / ALFA_TOPUP excluded as `retired`. Not yet encoded in
this family: `SHOP_LINE_USE` and the other credit-sale types beyond CREDIT_TRANSFER / VOUCHER
(same code path), change returned as store credit, GIFT_CARD legs, `recordUsage` (`Line_Usage`
is an EXPENSE — belongs to the expenses batch).

**TODO — move each `todo-phase5` exclusion into a rule (one module per batch):**

- [ ] FINANCIAL_SERVICE other families (§4.2): app wallets, Binance, iPick/Katsh catalog, Katsh BILL, THROUGH app keys
- [x] Recharge / carrier (§4.3): RECHARGE (walk-in, FOR, account, DAYS, basket), TELECOM_CREDIT_BUYBACK, TELECOM_SELF_CHARGE, RECHARGE_TOPUP, MTC_TOPUP / ALFA_TOPUP (`retired`), CARRIER_LINE_ADJUSTMENT, WALLET_CASHOUT — 2026-10-07
- [ ] Loto rest (§4.4): LOTO_CASH_PRIZE, LOTO_SETTLEMENT (after 3.6), LOTO_MONTHLY_FEE
- [ ] POS / debts (§4.5): SALE (walk-in, FOR, account, basket), DEBT_REPAYMENT, CREDIT_CASH_OUT / CREDIT_CASH_IN, DEBT_CASH_OUT, ACCOUNT_ADJUSTMENT
- [ ] Exchange / custom services / maintenance / expenses / hold money (§4.6): EXCHANGE, WALLET_EXCHANGE, CUSTOM_SERVICE, MAINTENANCE, EXPENSE + EXPENSE_INVENTORY / _KATSH / _IPICK / _WHISH_APP, HOLD_MONEY, HOLD_MONEY_COLLECT
- [x] Drawers and counterparties: DRAWER_TRANSFER, DRAWER_TOPUP, DRAWER_CASHOUT, CHECKPOINT, SUPPLIER_PAYMENT (manual payment; the auto sibling is covered by each parent's supplier line), SUPPLIER_SETTLEMENT, SUPPLIER_ADJUSTMENT, SUPPLIER_STOCK_INTAKE, SUPPLIER_RECORDED_DEBT, PARTNER_SETTLEMENT, PARTNER_PAYMENT, PARTNER_ADJUSTMENT, COUNTERPARTY_DISCOUNT — 2026-10-07 (not yet: `settleAccount`, bills-only settlement, MTC/Alfa checkpoint, BINANCE/USDT and split legs, top-up extra-currency lots)
- [ ] Optional (not started): dev-only runtime check that a created transaction matched its rule

---

## 8. Order and batches

```mermaid
graph LR
  A["Phase 1<br/>FinancialServiceRepository<br/>1.2 → 1.6 (+1.3/1.4 once D2/D3)"] --> E["Phase 5<br/>posting rules table"]
  B["Phase 2 streams<br/>Sales · Supplier · DrawerTopUp<br/>Maintenance · Loto"] --> E
  C["Phase 3 reversals<br/>(3.1 after 2.1, same file)"] --> E
  D["Phase 4 cleanup<br/>after D4–D9"] --> E
```

1. **Batch 1:** 1.1 + 1.2 + 1.6 (buildable now). Then 1.3 / 1.4 / 1.5 as their decisions land.
2. **Batch 2:** 2.5, 2.4, 2.3 (no decisions, small).
3. **Batch 3:** 2.1 + 3.1 + 3.2 (all `SalesRepository` — one stream).
4. **Batch 4:** 2.6, 2.7, 2.8, 2.9, 3.5, 3.6.
5. **Batch 5:** phase 4 items as decisions arrive.
6. **Batch 6:** phase 5.

---

## 9. Coverage — every gap has a place

| Gap | Plan item | Notes |
| --- | --- | --- |
| G1 | 1.2 | D1 answered |
| G2 | 1.2 (this case), 1.6 (class) | account route (`settleAccount`) covered by 1.6 |
| G3 | 1.4 | D3 ✔ |
| G4 | 1.3 | D2 ✔ |
| G5 | 3.1 | |
| G6 | 2.1 | |
| G7 | 2.6 | D8 ✔ |
| G8 | 2.5 | |
| G9 | 2.5 | |
| G10 | 2.2 | D2 ✔ |
| G11 | 2.4 | |
| G12 | 2.7 | verify first |
| G13 | 2.3 | |
| G14 | 2.8 | |
| G15 | 4.3 | D4 ✔ — real gap |
| G16 | 4.2 | D5 ✔ |
| G17 | 2.9 | verify first (Unverified) |
| G18 | 1.5 | verify first |
| G19 | — | **Won't fix, by design** (D6) |
| G20 | 3.4 | verify first |
| G21 | 3.2 | |
| G22 | 3.5 | |
| G23 | 3.6 | |
| G24 | 1.2, 4.1 | |
| G25 | — | **By design** (D7: partner owed = amount) |
| G26 | 4.4 | |
| G27 | 4.4 | |
| G28 | 4.5 | verify first |
| G29 | 4.6 | D9 ✔ — build |
| G30 | 4.4 | |
| G31 | 4.7 | |
| G32 | 1.4 | new 2026-10-06: THROUGH-secondary shop fee never counted as profit (D7) |

---

## 10. Assumptions

- D10 answered: no data repair for any gap; affected shops (cornertech included) reset and retest.
- Line numbers in `POSTING_MAP.md` are from `main @ 008f2c9a` and will drift.
