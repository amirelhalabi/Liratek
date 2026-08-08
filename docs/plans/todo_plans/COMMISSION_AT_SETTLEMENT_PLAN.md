# COMMISSION AT SETTLEMENT — unified redesign (LIRA-095 + LIRA-089)

**Status:** **Phase 0+1 SHIPPED 2026-08-08 (`1d498ff`)** — migration v150, shared machinery, bills
slice, dual-transport, green on every gate (full `yarn test` exit 0; desktop e2e 252/252; web e2e
61/61). **Phases 2-4 NOT started.**

> ### ⚠ Read this before starting Phase 2
> Phase 0 shipped with `commission_model = 1` scoped to **BILL rows only**. OMT/WHISH SEND/RECEIVE
> are deliberately still born `commission_model = 0` (legacy embedded), because their payable is
> STILL netted by `−commission` in `grossOwedDelta`/`SUPPLIER_OWED_EXPR`. Routing them into the new
> money-bearing settlement path before that flip **double-subtracts commission** — an adversarial
> reviewer caught exactly this pre-commit. Phase 2's gross flip and widening the
> `commission_model` stamp to OMT/WHISH must therefore land in the **same change**, with a
> realistic OMT SEND (real `omtServiceType`/`omtFee` so the auto-calc fires — fixtures using
> `commission: 0` cannot catch this class) proving no double deduction.
> Guard already in place: `FinancialServiceRepository.omtCommissionModelGate.test.ts`.
**Owner decisions (interview 2026-08-08):** one unified redesign; commission entered at supplier
settlement in one of two modes per supplier (LUMP for the batch, or RATE × unit count); per-type
reporting via PROPORTIONAL allocation of the settlement amount; CUTOVER — history keeps the old
embedded/per-bill model, no restatement.
**Grounding:** every file:line below was verified against HEAD `ba03976` by a 3-agent deep-read
(bills flow / payable math / storage) on 2026-08-08. Re-verify before building a later phase —
this repo's plan docs go stale fast.

---

## §0 Scope fence — what moves to settlement time, what must NOT

**IN scope** (supplier-granted commission, currently guessed at transaction time):

- OMT/WHISH system transfers (SEND/RECEIVE) — commission embedded in the payable via
  `grossOwedDelta` / `SUPPLIER_OWED_EXPR` (`FinancialServiceRepository.ts:586-623`).
- iPick/Katsh BILLs — hardcoded −20,000 LBP `SUPPLIER_PAYS_US` per bill
  (`FinancialServiceRepository.ts:3184-3203`, LIRA-062). **Phase 1.**

**OUT of scope — touching these breaks drawer math** (customer-fee profit realized at
transaction time, never supplier-settled):

- App-wallet/Binance spread fees (`FinancialServiceRepository.ts:2492-2510`).
- Non-OMT/WHISH immediate commission drawer inflow, e.g. BOB (`:3125-3142`).
- FOR-partner app-wallet fees (partner-charged, `:1772-1777`, `:1856-1871`).
- Loto commission (own checkpoint model; the 2×-mint lesson at `LotoCheckpointRepository.ts:343-349`
  is the cautionary tale for adding ANY commission drawer leg — OMT/WHISH drawers are ALREADY gross
  under PCD #68; commission never moves a drawer at transaction OR settlement time. That stays true.)

---

## §1 Current mechanics (compressed; the why of each change)

1. **Payable embeds the guess**: SEND books `+(x+f−c)`, RECEIVE `−(x−f+c)` (JS `:590-607`, SQL twin
   `:615-623`, consumed by `getColumns :632` → settle tab `:3554`, transactions tab `:3598`,
   dashboard summary `:3628`).
2. **`commission > 0` is secretly the pending-settlement marker** in FOUR copies: born-settled
   predicate (`:923-928`), settle-tab population (`:3561`), pending summary (`:3643`), reversal
   `wasPendingSettlement` (`TransactionRepository.ts:2661-2663`). New-model rows (commission=0 at
   creation) would be born settled, invisible to settlement, and unreversible — **this is why
   Phase 0 exists**.
3. **Bills**: fs.commission = 0 (cost==price), so bills are born settled, excluded from every
   settle/pending/profit query; the 20,000 lives ONLY as a supplier_ledger credit — pure balance
   sheet, absent from all P&L (`ProfitRepository` has zero reads of `SUPPLIER_PAYS_US`).
   Settled via cumulative balance pay-down (`recordSupplierCashflow`, `SupplierRepository.ts:970`),
   never via `settleTransactions`.
4. **No settlement table**: a settlement = supplier_ledger SETTLEMENT row (negative, id IS the
   settlement id) + is_settled/settlement_id stamps + SUPPLIER_SETTLEMENT transaction (metadata
   carries informational commission pair, `SupplierRepository.ts:889-895`) + payment legs
   (`:791-954`).
5. **Reversal owners** (rule 20): `_reversePayments`, `_markSourceRefunded('supplier_ledger')`,
   `_reverseSupplierSettlement` (`TransactionRepository.ts:2637-2680`) — the last resets
   is_settled only WHERE `commission > 0` (copy #4 of the marker).
6. **Profit reads two sources**: `getRealizedCommissionTotals` sums fs.commission;
   `getFinancialSettledByCurrency` sums stamped t.profit\_\* — LIRA-108 aligned their gates; any
   redesign must keep them consistent or the 18-USD divergence class returns.
7. **Rule-19 gap found**: `validators/financial.ts:26` serviceType enum is `['SEND','RECEIVE']` —
   **REST rejects every BILL**; bills are desktop-only on the write path. No web spec covers bills.

---

## §2 Design decisions

| #   | Decision                                                                                                                                                                                                    | Rationale                                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Payable goes **GROSS**: SEND `+(x+f)`, RECEIVE `−(x−f)`; JS + SQL twin change in lockstep                                                                                                                   | Owner's core ask; rule 14 lockstep or ledger/projection diverge by exactly c per row                                                                                                                                                                                                                                          |
| D2  | **One named pending-settlement predicate** replaces all four `commission > 0` copies, keyed on provider/direction + `commission_model`                                                                      | The marker collapse is the #1 kill risk; rule 14                                                                                                                                                                                                                                                                              |
| D3  | Per-row cutover flag `financial_services.commission_model` (0=EMBEDDED legacy, 1=AT_SETTLEMENT), NOT a date/version cutoff                                                                                  | Multi-tenant single DB; backdated rows; reversal must branch per row. Precedent: `supplier_debt_booked` v115                                                                                                                                                                                                                  |
| D4  | **Mixed-model settle batches are hard-rejected** (one settlement per model)                                                                                                                                 | Entering commission across a mixed batch double-nets legacy rows' embedded c — the exact bug `SupplierRepository.ts:104-109` warns about                                                                                                                                                                                      |
| D5  | New table `supplier_settlements` (real commission storage: gross, commission per currency, entry_mode LUMP/RATE, rate, unit_count, model, `ledger_entry_id` UNIQUE → supplier_ledger)                       | Today's metadata_json pair is unqueryable and unmaintained on reversal                                                                                                                                                                                                                                                        |
| D6  | New table `settlement_commission_allocations` (one row per settled fs row, per-currency share, largest-remainder rounding at write so Σ = entered amount exactly)                                           | Chosen over stamp-back (mutates posted rows, retroactively rewrites closed-period reports, violates the additive-only reversal convention) and over pure query-time derivation (FOR-partner rows need a per-row record for `notPartnerPending` to suppress — supplier-settled ≠ partner-settled; frozen audit-stable numbers) |
| D7  | Commission is recognized in the **settlement's period** (allocation created_at), not the transaction's period                                                                                               | Economically correct for commission-at-settlement; avoids closed-period rewrites                                                                                                                                                                                                                                              |
| D8  | Per-supplier entry-mode preference: `suppliers.commission_entry_mode` ('LUMP'/'RATE') + `suppliers.commission_rate`; the settlement snapshots the actually-used mode/rate/count onto `supplier_settlements` | Owner: "both, per supplier". Settings table is shop-global; UI state isn't shared across transports (rule 19)                                                                                                                                                                                                                 |
| D9  | No commission drawer legs, ever, in this redesign                                                                                                                                                           | Drawers are already gross (PCD #68); adding one re-creates the Loto 2×-mint                                                                                                                                                                                                                                                   |

---

## §3 Migration **v150** (verify current head is still v149 before building — `migrations/index.ts:7818`)

Both `packages/core/src/db/migrations/index.ts` AND `electron-app/create_db.sql` (rule 10):

1. `supplier_settlements` per D5 (id/tenant_id/supplier_id/ledger_entry_id UNIQUE/gross_usd/
   gross_lbp/commission_usd/commission_lbp/entry_mode CHECK/rate/unit_count/model CHECK/
   created_by/created_at/updated_at).
2. `settlement_commission_allocations` per D6 (settlement_ledger_id/financial_service_id/
   service_type/provider/commission_usd/commission_lbp + std columns; index on both FKs).
3. `ALTER financial_services ADD commission_model INTEGER NOT NULL DEFAULT 0` — existing rows read
   0/EMBEDDED; insert path stamps 1; fresh `create_db.sql` declares DEFAULT 1. **Migration test
   asserting pre-existing rows read 0** (precedent: `SupplierPaymentIsAutoBackfillMigration.test.ts`).
4. `ALTER suppliers ADD commission_entry_mode TEXT CHECK(... 'LUMP','RATE') DEFAULT 'LUMP'`,
   `ADD commission_rate REAL`.
5. `down()` for all of it.

---

## §4 Phases

### Phase 0 — shared machinery ✅ SHIPPED `1d498ff`

- v150 migration (§3).
- The ONE pending-settlement predicate (D2) — extracted, then swapped into: creation
  (`FSR:923-928`), settle-tab query (`:3561`), pending summary (`:3643`), reversal
  (`TransactionRepository.ts:2661-2678` — branch on `commission_model`).
- `settleTransactions` (`SupplierRepository.ts:791-954`): accepts `entry_mode/rate/unit_count` +
  money-bearing commission pair; writes `supplier_settlements` + allocations (largest-remainder);
  books the commission credit as a `SUPPLIER_PAYS_US` supplier_ledger row **linked to the
  settlement** (stamp the settlement ledger id — the LIRA-085 lesson: never link by time
  proximity); hard-rejects mixed-model batches (D4).
- Reversal (rule 20): extend `_reverseSupplierSettlement` to soft-void the commission credit row
  (found via its settlement link) and the allocations (WHERE settlement_ledger_id = source_id);
  create→settle→void must net to 0 across supplier_ledger + allocations + profit queries, per
  currency, failing-first (rule 17). Extend `TransactionRepository.supplierSettlementReversal.test.ts`.
- Zod: `supplierSettleSchema` (`validators/supplier.ts:38-51`) gains the new fields; commission
  docs flip from "informational" to money-bearing. Shared by IPC + REST (rule 19b). Adapter/preload/
  `electron.d.ts`/`ApiAdapter` types updated (rule 12).
- Settlement UI (`Suppliers/index.tsx:624-655, 1147-1162, 1736-1760`): LUMP and RATE×count entry
  modes (pre-selected from the supplier preference), net pay = max(0, Σ gross owed − entered
  commission), per-model batch separation surfaced to the operator.

### Phase 1 — bills slice (LIRA-089) ✅ SHIPPED `1d498ff`

- DELETE the per-bill −20,000 booking (`FSR:3184-3203`) for `commission_model=1` rows.
- Bills join the unsettled queue: new BILL branch in `getUnsettledBySupplier`/
  `getUnsettledSummaryByProvider` (`:3554-3648`) — `settlement_id IS NULL` guard + **bill-count
  projection** (feeds RATE × count). Add `notRefunded` to both queries (pre-existing leak: voided
  rows are settleable today — verify with a repro first, rule 17).
- Bills stop being born-settled (D2 predicate covers BILL).
- Allocation: bills receive their proportional share; bill commission finally reaches P&L via
  allocations (it NEVER did — today's 20,000s are invisible to Profits).
- **Fix the rule-19 gap**: add `'BILL'` to `validators/financial.ts:26` serviceType enum so bills
  work over REST; extend `lira-web-*` coverage (bills currently have zero web specs).
- Cutover honesty: legacy bills' 20,000 credits stay; new bills book nothing until settlement.
- e2e (desktop + web): bill → appears in settle tab with count → settle with RATE mode → ledger
  nets correctly → void settlement → everything returns, net 0.

### Phase 2 — OMT/WHISH transfers (LIRA-095 core)

- D1 gross flip: `grossOwedDelta` + `SUPPLIER_OWED_EXPR` in lockstep; the ~10 pinning tests flip
  in the same change, each failing-first both directions (`OmtSystemFeeCharacterization`,
  `supplierLedgerAmount`, `SupplierRepository.settlement`, `supplierSiblingVoidCascade:378`,
  `partner.test:676`, `lira-076` e2e, `lira-web-016/017/018`).
- Forms: new-model rows send/store commission 0 (`calculateCommission` display becomes an
  "estimate" label only — `FSR:864-916`, `utils/omtFees.ts:26`, `whishFees.ts:45`); FOR-partner
  OMT/WHISH RECEIVE keeps full partner credit, gross supplier booking without c (`:1901-1919`).
- Negative-net RECEIVE-heavy batches: design the "provider pays us net of our commission" path —
  `recordSupplierCashflow` RECEIVE has no commission entry point (`SupplierRepository.ts:167-185`).
  **Needs a small owner check-in when Phase 2 starts** (see §6).
- FOR-partner allocated shares still gate on `notPartnerPending` per row (two independent gates:
  supplier settled ≠ partner settled) — the allocations table makes this possible (D6).

### Phase 3 — Profits/reporting repoint

- UNION old-model (fs.commission WHERE commission_model=0) + new-model (allocations) in ONE named
  fragment each for: `getRealizedCommissionTotals`, `getPendingCommissionTotals` (+ByProvider),
  `getFinancialSettledByCurrency`/`PendingByCurrency`, `getUnsettledSummaryByProvider`
  (`FSR:3628-3648`), `getAnalytics` (`:3657-3750`).
- Pending surfaces for new-model rows become "N transactions awaiting settlement" (no number to
  show — commission unknown until entered).
- Closing screen (LIRA-110 folds in here): daily commission becomes settlement-day cash-basis for
  new-model rows — **document the semantics change; owner sign-off** (§6).
- Resolve the LIRA-108 residuals here: provider set of the Commission row; fs.commission vs
  stamped t.profit source split; USDT bucketing.
- Extend the profit-recognition guard to the new allocation queries + ClosingRepository.

### Phase 4 — proof + docs

- Full e2e both transports for the whole flow; FEATURE_GUIDE §7/§13 + COUNTERPARTY_LEDGERS.md
  updated; stale "fee-only"/"informational commission" comments purged
  (`SupplierRepository.ts:104-128`, `FinancialService.ts:262-268`, `useSuppliers.ts:294-306` —
  overlaps LIRA-101).

---

## §5 Risk register (from the deep-read — each verified, not guessed)

1. **Marker collapse** (§1.2) — mitigated by D2 shipping BEFORE/WITH any booking change.
2. **Mixed-batch double-netting** — D4 hard-reject; UI shows per-model separation.
3. **RECEIVE sign**: gross makes the shop's claim grow by c per RECEIVE; commission always reduces
   net pay; the 0-clamp at `index.tsx:655` currently hides negative nets.
4. **Refunded rows leak into settlement** (no `is_refunded` filter in unsettled queries) —
   fix + repro in Phase 1.
5. **Allocation rounding** — largest-remainder at write (D6); batches are USD-only today
   (`index.tsx:632-633`) so LBP entry is currently only reachable for bills-style LBP commission —
   settle math must define it rather than inherit the USD-only assumption silently.
6. **Estimate drift**: if forms keep writing calculated commission post-cutover, old-model
   predicates fire on new rows — frontend MUST send 0 for commission_model=1 rows.
7. **Guard interplay**: `profitRecognition.guard.test.ts` scans `profit|commission` in
   ProfitRepository — every new query ships gated or with a documented exclusion.

## §6 Owner check-ins queued (do NOT block Phase 0+1)

- Closing-screen daily semantics under cash-basis commission (Phase 3).
- Negative-net RECEIVE-heavy batch flow (Phase 2).
- Provider set of the Profits "Commission" row (Phase 3; LIRA-108 residual).

## §7 Blast radius quick-index

Tests pinning ±c math: see Phase 2 list. Settlement contract tests:
`backend/src/api/__tests__/suppliers.api.test.ts:242-243`, `SupplierRepository.settlement.test.ts`,
`CounterpartyMetadataContract.test.ts`, `validators/__tests__/supplier.paymentLegAmount.test.ts`,
`cq8Contract.test.ts`, `omtHandlers.test.ts`. Type surfaces: `electron.d.ts:997-1008,1222-1234`,
`packages/ui/src/api/types.ts` (settleTransactions), `backendApi.ts:1652-1676`, `preload.ts:545-552`.
