# Research: OMT statement commission types (LIRA-256)

All file references were checked against `main` at `3522ea72` on 2026-10-11. Line numbers
drift in this repo; each fact names its symbol so it can be re-found with grep.

## R0. Verified facts the design rests on

| # | Fact | Where | How verified |
|---|------|-------|--------------|
| F1 | Every OMT transfer stores its type in `financial_services.omt_service_type` (nullable; CHECK over the 8 values). | `electron-app/create_db.sql` (financial_services), `FinancialServiceRepository.createTransaction` insert | Read the DDL and the insert. |
| F2 | The type can be NULL: the validator makes `omtServiceType` optional and the Services form lets the select be cleared to `""` → `null`. | `validators/financial.ts` (`omtServiceType: z.enum([...]).optional()`), `frontend/src/features/services/pages/Services/index.tsx` (`setOmtServiceType(v === "" ? null : …)`) | Read. |
| F3 | New OMT/WHISH SEND/RECEIVE rows are born `commission_model = 1`; their payable is gross (x + f). | `FinancialServiceRepository.createTransaction` (`commissionModel` stamp), `SUPPLIER_OWED_EXPR` | Read. |
| F4 | A model-1 OMT row STILL stores the auto-calculated commission estimate in `financial_services.commission` (`calculateCommission` from `utils/omtFees.ts`). | `createTransaction` ("AUTO-CALCULATE COMMISSION FOR OMT SERVICES"); local web-dev DB copy: 3 unsettled model-1 INTRA SENDs, commission 0.10 each | Read + queried a copy of `~/Documents/LiraTek/liratek-web-dev.db` with Python `sqlite3`. |
| F5 | LIRA-255's check sums that `commission` column over exactly the Settle tab's row set (`getUnsettledBySupplier` per account member), all types, all models. | `SupplierRepository.getAccountExpectedStatement` | Read. |
| F6 | Both settle paths resolve their eligible rows through ONE helper, `_resolveSettlementBatchModel` (rows with `settlement_id IS NULL`; rejects mixed models, D4), and book commission through ONE helper, `_bookCommissionAtSettlement`. | `SupplierRepository.settleTransactions` and `settleAccount` (step 2 calls `_resolveSettlementBatchModel`; step F calls `_bookCommissionAtSettlement`) | Read. |
| F7 | `_bookCommissionAtSettlement` splits the entered commission over EVERY row it is given (`allocateProportional`, by gross, per currency) and writes `supplier_settlements` + one `settlement_commission_allocations` row per row + a `SUPPLIER_PAYS_US` credit (non-bills batches). | same | Read. |
| F8 | Profits recognises a model-1 row's commission only from `settlement_commission_allocations` (D6/D7, cash basis D10). A model-1 row that is settled with a 0 allocation therefore never shows commission in Profits. | `ProfitRepository` (`atSettlementCommission` = `commission_model = 1`; allocation-reading units) | Read the fragments; matches `COMMISSION_AT_SETTLEMENT_PLAN.md` D6/D7. |
| F9 | Voiding a settlement is fully generic: `_reverseSupplierSettlement` un-stamps rows by `settlement_id`, deletes that settlement's allocations and `supplier_settlements` rows, and the LIRA-091 cascade soft-voids the commission credit; `_reversePayments` returns the drawer. | `TransactionRepository._reverseSupplierSettlement`, `_reverseCommissionAtSettlementRecords` | Read. |
| F10 | Both settlement transactions write `metadata_json` (commission, model, entry_mode) that no reversal reads. | `settleTransactions` (`metadata_json: { … commission_model: batchModel, entry_mode … }`), `settleAccount` (same) | Read. |
| F11 | IPC handlers and REST routes forward the validated payload with `...v.data` / `...req.body`, so a new schema key reaches the repository without handler edits; the preload binding's `data` type is hand-written and must be widened (rule 12). | `electron-app/handlers/supplierHandlers.ts` (`suppliers:settle-transactions`, `suppliers:settle-account`), `backend/src/api/suppliers.ts` (`/:id/settle`, `/:id/settle-account`), `electron-app/preload.ts` | Read. |
| F12 | The statement read takes only `accountSupplierId` on both transports today. | `suppliers:account-expected-statement`, `GET /api/suppliers/:id/account-expected-statement`, `backendApi.getSupplierAccountExpectedStatement`, `useSupplierAccountExpectedStatementQuery` | Read. |
| F13 | `AccountUnsettledRow` (core + `packages/ui` mirror) has no `omt_service_type` / `commission_model`, so the account settle sheet cannot filter by type today. The Settle tab's row type already has `omt_service_type`. | `SupplierRepository.getAccountUnsettled`, `packages/ui/src/api/types.ts`, `Suppliers/index.tsx` | Read. |
| F14 | The 8 values exist in three copies today: inline in `validators/financial.ts`, as `OmtServiceType` in `utils/omtFees.ts`, and as `OMT_SERVICE_OPTIONS` in `frontend/src/features/services/pages/Services/index.tsx`. | those files | Read (third copy found by analyze, M6). |
| F16 | `settleAccount` only resolves a commission member (and calls `_resolveSettlementBatchModel`) when the FINANCIAL_SERVICE selections belong to exactly ONE member; with two members and commission 0, model-1 rows are stamped settled with no allocation. So a covered-types guard must inspect every selected FS row, not the commission member's rows. | `SupplierRepository.settleAccount` step 2 (`commissionSupplierId = fsMemberIds.length === 1 ? … : null`) | Read (analyze finding C1). |
| F15 | Latest migration is v209; this feature needs none. Next free web e2e number is lira-web-053 (052 = OMT commission settle/void). | `migrations/index.ts`, `frontend/tests/e2e-web/` | Listed. |

## R1. The settlement safety model (decision S1)

**Decision: restrict the batch.** A settlement that names covered types is refused if it
contains a model-1 OMT counter row whose type is not covered. Uncovered rows stay unsettled,
owed at gross, commission pending, until a later settlement includes them.

**Rationale**

- It keeps `_bookCommissionAtSettlement` and `_reverseSupplierSettlement` byte-identical:
  the only new code is a read-only guard that throws before any write. Rule 20 is satisfied by
  construction: no new side-effect row exists, so no new reversal owner is needed.
- Uncovered rows' commission cannot be lost (F8): they never receive a settlement id until a
  settlement that covers them, which is also where their commission is entered and allocated.
- It matches the ticket title ("settle the FIFO queue by type") and OMT's own behaviour: each
  type's shares arrive on the statement that includes them.
- If the shop pays OMT's whole statement balance (which includes uncovered transfers' gross),
  the OMT account settle sheet already records the extra as an open account credit (LIRA-203)
  to tick at a later settlement, when the uncovered rows settle. No new money path.
- Undo = delete the guard and the payload key; history is untouched.

**Alternatives considered**

| Option | Why rejected |
|--------|--------------|
| A. Settle all rows; allocate commission only to covered rows; uncovered rows get 0. | Silently loses the uncovered rows' commission forever (F8): they leave the queue (`pendingSettlementSql`) and Profits reads model-1 commission only from allocations. This is exactly the hazard the ticket warns about. |
| B. Settle all rows for principal; mark uncovered rows "awaiting commission"; add a later "commission-only settlement" that books a `SUPPLIER_PAYS_US` credit and allocations for them. | Correct but large: a new settlement kind, a new anchor ledger row, a void-ordering guard (a principal void must be refused while a later commission-only entry still has allocations on its rows, or a re-settle double-counts), a new screen, a new read, two new endpoints, new e2e. More money paths for the same outcome. Kept as the documented fallback if the owner finds that leaving uncovered rows queued is impractical. |
| C. Restrict in the UI only (no server guard). | Rule 19/22: a direct REST/IPC call would bypass it; the server must enforce. |
| D. Auto-drop uncovered rows from the batch server-side. | Silently changes what the operator asked to settle (and the amount they typed would no longer match the rows). Refusing with a named row is safer. |

## R2. Where the covered-types choice lives (decision S2)

**Decision:** not persisted server-side. It is a per-request input:

- Statement check: optional query/argument on the existing read. Per-device memory of the last
  choice in `localStorage` (behind try/catch), shared by the check panel and both settle
  screens, keyed per account. Same convenience class as LIRA-255's typed SMS figures.
- Settlement: optional `covered_omt_service_types` key on both settle schemas, snapshotted into
  the settlement transaction's `metadata_json` (F10) for audit only.

**Rationale:** the choice changes per SMS ("sometimes intra, sometimes intra plus another"), so
it is statement data, not a shop preference. Under the restrict model reversal does not need a
snapshot (each settled row carries its own type), so a `supplier_settlements` column (and
migration v210 in two files plus `down()` and schema-equivalence) buys nothing. Metadata needs no
migration and no reversal.

**Alternatives:** a shop setting in `system_settings` (wrong lifetime; one stale tick would
silently change the next settlement); a `supplier_settlements.covered_omt_service_types` column
(migration cost with no reader); per-supplier column like D8's `commission_entry_mode` (same
lifetime problem).

## R3. Default and compatibility (decision S3)

**Decision:** absent key ⇒ all types covered ⇒ today's behaviour, exactly. The schema accepts
`undefined` or a non-empty array; an empty array is rejected (it would mean "covers nothing",
which cannot settle anything and is almost certainly a client bug). Every existing caller, test
and the lira-web-052 / lira-095 specs keep passing unchanged.

## R4. Rows without a type (decision S4)

**Decision:** a pseudo-value `"UNSPECIFIED"` in the covered-types enum matches rows whose
`omt_service_type IS NULL`. It is never written to the database (the DB CHECK stays as is).
Label: "Type not recorded". Without it, such rows could only ever settle under "All types".

## R5. Old-style rows (decision S5)

**Decision:** at settlement the type guard only inspects rows `_resolveSettlementBatchModel`
returns for a model-1 batch; a legacy (model-0) batch is not restricted (its commission figure is
informational only, F10/`SettleTransactionsData` doc). The statement check filters model-0 rows
by type exactly like model-1 rows, keeping LIRA-255's current inclusion of both models.

**Finding, out of scope (S7):** LIRA-255 subtracts the `commission` column of model-0 rows too,
but a model-0 row's payable was already booked net of commission, so for such rows the check
likely subtracts the commission twice. `Likely, based on SUPPLIER_OWED_EXPR's model-0 branch and
the AccountExpectedStatement doc comment.` The local DB copy has zero model-0 OMT rows, so this
cannot be measured here; production may still hold old unsettled ones. Not changed by LIRA-256
(it would change a figure the owner already uses); recorded as a follow-up note on the sprint
ticket.

## R6. Per-type breakdown in the check (FR-004)

**Decision:** the read returns `commission_by_type[]` (type, usd, lbp, count) for OMT counter
rows in the queue, computed in the same loop as today's sum (no second predicate, rule 14). The
panel shows the amount next to each tick.

## R7. One definition of the type list (rule 14)

**Decision:** add `OMT_SERVICE_TYPES` (readonly tuple) next to `OmtServiceType` in
`packages/core/src/utils/omtFees.ts` (pure, already browser-reachable, no Node import — rule 29),
derive `OmtServiceType` from it, and make `validators/financial.ts` use `z.enum(OMT_SERVICE_TYPES)`.
New `omtCoveredTypesSchema = z.array(z.enum([...OMT_SERVICE_TYPES, "UNSPECIFIED"])).min(1)` in
`validators/supplier.ts`. The "is this row covered" test is ONE pure function
(`isOmtRowCovered` in a new leaf `utils/omtCoveredTypes.ts`) used by the repository guard, the
check's filter and both settle screens.

## R8. Transport parity (rule 19, 21–23, 27)

- Read: IPC `suppliers:account-expected-statement` gains an optional second argument; REST adds
  `?covered=INTRA,WESTERN_UNION`. Both parse through `omtCoveredTypesSchema` and call the same
  `SupplierService.getAccountExpectedStatement(id, covered)`.
- Writes: the key rides inside the existing validated payload (F11). Three-way key diff (rule 23)
  is a task: schema ⇄ preload `data` type ⇄ repository data interface.
- Adapter types already derive from the core schema types (`SupplierSettleInput`,
  `SupplierSettleAccountPayload`), so adding the key to the schema widens them (rule 21).
- Nothing here depends on the server's clock, timezone or locale (rule 27).
- `utils/omtCoveredTypes.ts` imports nothing but types (rule 29 guard covers it).

## R9. Testing approach

- Core jest on the real schema with the real writer (`FinancialServiceRepository.createTransaction`
  with real `omtServiceType`/`omtFee`, so the estimate is non-zero — the Phase-2 lesson that
  `commission: 0` fixtures prove nothing).
- Failing-first (rule 17): every guard test is written and run red before its implementation task.
- Web e2e lira-web-053 over REST; desktop twin `lira-256-omt-statement-commission-types` (CI only, G5).

## R10. Baseline (T001, 2026-10-11, before any LIRA-256 code)

Latest migration confirmed v209 (no migration in this feature). Node ABI confirmed.

| Suite set | Result | Elapsed |
|-----------|--------|---------|
| core: accountExpectedStatement, settlement, accountSettlement, supplierSettlementReversal, accountSettlementReversal, browserEntryIsNodeFree.guard | 6 suites, 90 tests passed | 3 s |
| backend: `src/api/__tests__/suppliers.api.test.ts` | 1 suite, 33 tests passed | 1 s |
| frontend: `src/features/suppliers` (whole folder) | 19 suites, 75 tests passed | 5 s |

## R11. Analyze re-check (2026-10-11, second pass)

The first analyze pass's 4 CRITICAL / 5 HIGH findings were confirmed fixed in plan/tasks
(guard over every selected FS row in `settleAccount`; v150+ fixtures; failing-first labels;
stable `useApi` mocks; `yarn build` in the gates; the three pre-existing assertions named).
Checked against the code: `_resolveSettlementBatchModel` returns no rows for a model-0 batch
(S5 holds); `settleAccount` only resolves a commission member for a single-member FS
selection (F16, so the guard must run on step 0's rows); `pendingSettlementSql(false)` is
`1 = 1` for the bill clause, so T010 case (5)'s OMT App bill does reach the queue in a
fixture without `commission_eligible`.

One remaining HIGH finding, now fixed in spec/data-model/contracts/tasks:

- **H1 — S7 is real and sits inside T014's loop.** `gross_owed_*` is a `supplier_ledger`
  sum (`_ledgerBalanceQuery`), and a legacy (model-0) OMT row's TOP_UP was booked NET of its
  commission (`grossOwedDelta` / `SUPPLIER_OWED_EXPR` legacy branch). The check then subtracts
  that commission again. **Measured** (T010 S9 cases, run red against unchanged code): legacy
  WESTERN_UNION SEND x=100 f=5 c=0.5 with its 104.50 net ledger row → the check showed
  expected **104.00**; the correct figure is **104.50** (type included) and **105.00** (type
  not included, OMT still shows it at full). Fix (decision S9): per OMT counter row, model 1 →
  subtract c when covered; model 0 → subtract nothing when covered, add c back when not.
  FR-003/FR-014/SC-004, data-model, contracts and T010(6)/T014 amended. No other
  CRITICAL/HIGH issue found.
