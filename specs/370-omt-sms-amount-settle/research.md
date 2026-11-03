# Research — LIRA-370 Settle OMT from the SMS amount

All measurements are from the test shop and cornertech on 2026-11-03 (test runs voided afterwards).

## R1 — The commission becomes coverage, for the OMT account only

**Decision.** `allocateAccountSettlement` gets an input `commission_covers: boolean`. When it is true, the commission joins the budget with the sign of what is owed, like the waive. The take order is waive, then commission, then money. Its takes are tagged source `'COMMISSION'`. That value is already allowed by `supplier_settlement_coverage.source`'s CHECK, kept for legacy rows, so no schema change is needed for coverage. When `commission_covers` is true, the repository does not book the commission as an open `SUPPLIER_PAYS_US` credit (`_bookAmountFirstCommission`'s ledger loop). It still writes `supplier_settlements` and the allocations. The server derives the flag from the supplier, never from the client. A new rule `commissionCoversOwed(s)` in `utils/settlesByDay.ts` returns true for the OMT account parent and false otherwise. Whish keeps the credit model.

**Rationale.** In the test, with the commission as a credit, the collect case could not be recorded correctly. It needed a second settlement when paying, and an untouched box lost the expected commission. The owner reversed the 2026-10-15 rule for OMT only.

**Alternatives.** (a) The sheet lowers the money and keeps the credit model. Rejected: it still leaves the credit and the part-paid day (measured). (b) The commission as a waive. Rejected: a waive books a supplier DISCOUNT, not profit.

## R2 — Commission split: expected per transfer, extra over the ticked types

**Decision.** The allocator's step 4 changes in three ways:
1. Eligibility uses `Math.abs(orig[i]) > 0`, not `orig[i] > 0`. A Western Union receive is a credit row and must be able to take commission. Today an SMS that covers only receives sets `commission_without_closed_model1`.
2. The commission is split in two parts. **Expected part:** each closed, ticked-type commission-model-1 transfer gets its own outstanding estimate (R3). **Extra part:** the rest is spread over those same transfers in proportion to their estimates, using largest-remainder rounding. When the extra is negative (less than expected), it is taken off pro rata the same way.
3. A commission with no eligible closed transfer is still refused, unless the settlement only clears owed shares (R5).

**Rationale.** The extra lands on the types the SMS names. This answers the owner's earlier limit, "can't put it on Western Union". A receive-only collect must work.

**Alternatives.** Keep a proportional split by gross over every closed model-1 row (today). Rejected: the extra goes to types the SMS did not include.

## R3 — One "commission received" marker per transfer (no double counting)

**Decision.** A transfer's **outstanding estimate** = `financial_services.commission` minus the sum of its live `settlement_commission_allocations` rows (from settlements not voided) minus its live owed-share rows. The expected figure, the split and owed-share creation all use the outstanding estimate. **Revised during T011 (2026-11-03):** every in-scope transfer of a ticked type counts toward the expected commission, and takes its profit share, whether or not this settlement's money closes it. OMT's SMS deducted that commission regardless of what the shop pays. The allocation marks it as accounted, so the settlement that later closes a part-paid transfer counts nothing for it.

**Sign rule found in T011:** in OMT's sign, money + commission = owed in both directions (pay 762.30 + 14.20 = 776.50; collect −249.70 + 26.20 = −223.50). The commission therefore always enters the allocator budget as +. When the shop pays, it is a COMMISSION coverage source. When OMT pays, it absorbs the part of the received money that is commission, so there is no extra and no change.

**Rationale.** With US1.4 ($700 paid on a $762.30 SMS) and owed shares cleared later, a full-estimate rule counts the same commission twice. `settlement_commission_allocations` is already keyed by `financial_service_id`, so it is the marker.

**(Superseded, see above.) Consequence for US1.4.** When the money is short, the commission goes only to transfers that close. The rest of the expected commission goes with the transfers that stay open, and the cashier sees "Commission $x now, $y with the transfers still open". Spec FR-003 is read as "the expected commission of the transfers this settlement closes".

## R4 — One formula for the expected figure (panel, sheet, server)

**Decision.** New pure leaf `packages/core/src/utils/omtSmsSettlement.ts`, exported from `browser.ts` (rule 29: no imports beyond pure utils):

- `expectedSmsFigure({ rows, coveredTypes, owedShares, currency })` → `{ owed, expectedCommission, owedSharesIncluded, expected }`. `owed` = signed remaining of the in-scope rows (day rows plus account rows, the same scope `buildDaySelections` sends). `expectedCommission` = the outstanding estimates of ticked-type model-1 transfers in scope. `owedSharesIncluded` = live owed shares of ticked types. `expected = owed − expectedCommission − owedSharesIncluded`, in OMT's sign.
- `deriveSmsCommission({ owed, expectedCommission, owedSharesIncluded, sms })` → `{ commission, expectedPart, extraPart, lessThanExpected, omtAsksMore, difference }`. `commission = max(0, owed − sms)` in OMT's sign (pay: owed 776.50, SMS 762.30 → 14.20; collect: owed −223.50, SMS −249.70 → 26.20). When `omtAsksMore`, the commission is 0 and `difference = |sms − owed|`.

The statement panel calls the same function over the same rows (`account-unsettled` cut at its "up to" day, plus owed shares). It stops summing the ledger and `getUnsettledBySupplier` itself. `getAccountExpectedStatement` is re-implemented on top of `_accountRows` + `expectedSmsFigure`, so the REST/IPC read and the sheet agree to the cent (SC-003). The B7 "ledger as it stood at the end of the day" cut is kept for days that later payments closed: the panel's figure for a past day equals the open-queue figure only when no later settlement exists. The plan keeps B7's ledger cut as `owed` when `upToDay` is given and the queue figure otherwise, and pins both in tests.

**Rationale.** Rule 14: one derivation per value. The panel and the sheet disagree today ($225.50 vs $600.00).

## R5 — Owed shares: new table, profit when cleared

**Decision.** Migration **v229** `omt_owed_shares`: `id`, `tenant_id`, `financial_service_id`, `omt_service_type`, `currency`, `amount` (> 0), `created_settlement_txn_id`, `created_anchor_ledger_id`, `cleared_settlement_txn_id` (NULL = owed), `cleared_anchor_ledger_id`, `is_reversed` (0/1), `created_at`, `updated_at`. Indexes on (tenant_id, cleared_settlement_txn_id, is_reversed) and (tenant_id, financial_service_id). Both `packages/core/src/db/migrations/index.ts` and `electron-app/create_db.sql` are updated (rule 10). Verified: last entry is 228, and the migrations file has no uncommitted change.

- **Create.** When a settlement closes a model-1 OMT transfer of an unticked type, and when the ticked types' expected commission can't be booked because OMT asks for more (FR-007), one row per transfer is created with its outstanding estimate (R3). No ledger row is written, so it is not in the OMT balance, and no profit is booked.
- **Clear.** A later settlement whose ticked types include the row's type counts it in `owedSharesIncluded`. If that settlement's commission covers it, the row is stamped cleared, and a `settlement_commission_allocations` row (same `financial_service_id`) books the profit on that settlement's date. If the later SMS is short, the owed shares clear oldest first up to what the commission allows.
- **Shares-only settlement.** No open transfers but owed shares exist: the sheet offers them alone. The money received = shares cleared. The payload has no selections, and `owed_shares_only: true` lets the server accept a settlement with no in-scope rows.
- **Copied value (rule 31).** `amount` is a snapshot taken at settlement time. If a transfer is edited later, the owed share does not change, and the details window labels it "as at settlement". Transfers that are already settled cannot have their amounts edited today, so this matches.

**Alternatives.** (a) A ledger row per share. Rejected: it would move the OMT balance and need a sign that reads as "OMT owes us" while profit has not happened. (b) A flag on `financial_services`. Rejected: it can't hold create/clear settlement links for undo.

## R6 — Undo / void: reversal owners (rule 20)

**Decision.** `TransactionRepository._reverseSupplierSettlement` gets one more owner step:
- **Voiding the settlement that created owed shares:** its owed-share rows are marked `is_reversed = 1`. If some of them were cleared by a later live settlement, what that later settlement received for them is booked as relief: one open account row "OMT paid shares ahead", in the share's currency. It is built by the same planner as LIRA-343 R12 (`_planSettlementCoverageRelief`) and nets at the next settlement (owner 2026-11-03).
- **Voiding the settlement that cleared owed shares:** its allocations are already reversed by anchor (existing). Its cleared owed shares get `cleared_* = NULL` again, so they are owed again.
- COMMISSION-source coverage rows are soft-voided with the rest of the coverage (existing `is_reversed`).

Every variant must net to 0 per ledger and per currency: supplier ledger, drawers, transactions profit, `settlement_commission_allocations`, live `omt_owed_shares`.

## R7 — Ticked types change money: open on "All types"

**Decision.** For the OMT account only, the sheet stops seeding the covered types from `omtCoveredTypesStorage`. It opens on "All types". When narrower types are ticked, a chip by the SMS box says "SMS includes: Western Union, Intra" and the owed shares this will create ("$4.20 stays owed by OMT"). The statement panel keeps its remembered choice, because it is display only.

**Rationale.** A stale tick would quietly move profit into owed shares.

## R8 — Remove the "waiting" rule only on the amount-first OMT path

**Decision.** `_assertRowsCoveredByStatement` is no longer called from the amount-first `settleAccount` path when `commissionCoversOwed` is true. It stays on the tick-list (`settleTransactions`) and legacy whole-row paths, which have no owed-share handling. On the OMT sheet, `isSettleRowWaiting` is not applied (`buildSettleDays` / `buildDaySelections` get no `coveredTypes` for scope, only for commission), and the calendar's "Waiting for its statement type" badge is not shown there.

## R9 — Money lines: the SMS amount, and the extra goes to the account automatically

**Decision.** The OMT sheet's main payment line starts at |SMS| in the section's direction. When the money is more than owed minus commission (only possible when OMT asks for more), the extra goes to the account. It is the LIRA-315 overpay credit, written by the existing path, and no "Change to return" box is shown. The sheet sends no change legs in SMS mode. Paying less leaves the newest picked row part-paid (existing).

**Measured today.** Variant B (receive 249.70, commission 26.20, change to "Account") gave the right drawer (+249.70 leg verified) and profit, but left +26.20 / −26.20 open rows. With R1 there is no commission credit, so neither row exists.

## R10 — Payload, record, both transports

**Decision.** `settleAccountCurrencySectionSchema` gets an optional `sms_amount: number`. When it is present, the server recomputes `deriveSmsCommission` from its own rows and refuses a different client `commission` (stale message, like `expected_owed`). It also gets an optional root `owed_shares_only: boolean`. The settlement's `metadata_json.per_currency[c]` stamps `sms_amount`, `expected_commission`, `extra_commission`, `owed_shares_cleared`, `owed_shares_created`, `omt_asks_more`. The summary reads, for example, "Account Settlement: OMT — USD PAY $762.30 · SMS 762.30 · commission $14.20 ($4.20 expected + $10.00 extra)". No new channel and no new route: `suppliers:settle-account` and `POST /api/suppliers/:id/settle-account` already validate with the shared schema. The preload `data` type and `ApiAdapter` take `z.input<typeof supplierSettleAccountSchema>` (rule 21). Check that the preload already does this, and fix it if it is hand-written. Rule 23 three-way key diff for the new keys.

A new read gives the sheet and panel the owed shares: `suppliers:account-owed-shares` / `GET /api/suppliers/:id/account-owed-shares`. It returns live uncleared rows grouped by type and currency. `account-expected-statement` includes them.

## R11 — Old-style transfers

Measured: none open on cornertech (69 FS rows, all `commission_model = 1`) or the test shop (4). The SMS box refuses a scope that holds an open model-0 OMT transfer of an unticked type (message: tick "All types"). No other design.

## Rule 23 three-way diff (T008, 2026-11-03)

- **Schema** (`supplierSettleAccountSchema`): adds `per_currency.*.sms_amount` and root `owed_shares_only` (amount-first only).
- **Preload** `suppliers.settleAccount(data: SupplierSettleAccountPayload)`: already `z.input` of the schema, so the new keys are typed automatically.
- **IPC handler** `suppliers:settle-account`: forwards `...v.data`, so every key reaches the service.
- **REST** `POST /api/suppliers/:id/settle-account`: `validateRequest(schema)`, then `...req.body`, same.
- **Adapter** `ApiAdapter.settleSupplierAccount` / `backendApi.settleSupplierAccount`: `Omit<SupplierSettleAccountPayload, "account_supplier_id">`, derived.
- **Gap found:** the repository's hand-written `SettleAccountCurrencySectionData` / `SettleAccountRequest` lacked both keys. They were added, so the service signature carries them.

## FEATURE_GUIDE §13 walk (T001)

1. **Plumbing:** migration v229 in both files. No new write channel. New read `account-owed-shares` on IPC + REST + adapter. Preload type derived. Core build & sync at the end.
2. **Transaction row:** still the one SUPPLIER_SETTLEMENT (`source_table = supplier_ledger`, anchor). `profit_usd/lbp` = commission booked (cleared owed shares included). `exchange_rate` stamp unchanged. No client.
3. **IN/OUT badge:** unchanged. The type already maps PAY → OUT, COLLECT → IN.
4. **Payment legs:** IN legs = the SMS money. SMS mode sends no change legs. Extra goes through the existing overpay (LIRA-315) path, short through the existing partial path. No flow branch iterates OUT legs.
5. **Drawers:** unchanged. Each leg goes to its method's drawer, per currency, as today.
6. **Client propagation:** n/a (supplier settlement).
7. **CUSTOMER_ACCOUNT:** n/a.
8. **Supplier ledger:** no commission-credit row on the OMT path. Commission coverage goes in `supplier_settlement_coverage` (source COMMISSION). Owed shares stay off the ledger, so the OMT balance is unchanged. Relief row on a void (R6).
9. **Void path:** reversible. `_reverseSupplierSettlement` already deletes allocations / `supplier_settlements` and soft-voids coverage. New: the owed-share step + relief (T030–T031).
10. **Profits:** a commission entered at settlement goes in `settlement_commission_allocations` (ProfitRepository reads it by `created_at`). A cleared share is booked on the clearing settlement's date.
11. **Sessions:** n/a (admin settle sheet, not a basket flow).
12. **Audit viewer:** summary text extended. `describeSettleAccountForAudit` gets the SMS figure.
13. **E2E guard:** `lira-web-091`, with delta + identity assertions.
14. **One obligation, one owner:** the commission is now either coverage (closing rows) or an owed share, never both and never also a ledger credit.

## T013 decision — SMS mode is opt-in by payload

`commission_covers` turns on only when the OMT account's payload carries `sms_amount` in some section. Without it, the OMT path is byte-identical to LIRA-322/343: typed commission becomes an open credit, and unticked types wait or are refused. Reasons:
- an offline desktop entry queued before the update keeps the meaning it had when it was typed;
- the 12 LIRA-322 tests that pin the credit model stay valid guards and don't need rewriting.

The sheet always sends `sms_amount` for the OMT account (T014). In SMS mode the server also uses all usable account credit, because OMT's SMS covers the whole account.

## R13 — An OMT credit bigger than the picked days (owner decision 2026-11-03)

Settling from the SMS uses the whole open OMT credit on the account, because OMT's SMS nets all of it. When that credit is more than the picked days owe, the settlement flips to "OMT pays you": the credit closes the days, and the money received covers the rest of the credit. The commission is worked out from the SMS as usual.

Example: the days owe 11.00 and the credit is 79.40, so OMT owes us 68.40. The expected commission is 0.70, so the expected SMS is −69.10 and we receive 69.10.

Mechanism: the allocator takes a new `whole_credit` input. The server sets it only for a currency section that carries `sms_amount`, so a section without one keeps the LIRA-343 cap (`min(owed, credit)`). The direction check uses owed − credit in SMS mode.

An earlier draft refused this case with "Pick more days, or use the credit first". The owner rejected that version after seeing the sheet: it showed the warning next to a working-looking preview.
