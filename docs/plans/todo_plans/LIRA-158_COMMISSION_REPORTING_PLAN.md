# LIRA-158 — Profits & Closing report the commission ESTIMATE, not the settled figure

Detailed implementation plan for `COMMISSION_AT_SETTLEMENT_PLAN.md` §4 **Phase 3**.
Written 2026-08-30 after a 20-agent map + adversarial verification pass over every read and write
site. Every file:line below was opened and read; claims that were only inferred are marked.

**Status: READY TO IMPLEMENT — all three owner decisions answered 2026-08-30 (§8).**

---

## §0 Baseline (re-measured on HEAD `f23cbee8`, after the v160 commit)

| Gate         | Result                                                                     |
| ------------ | -------------------------------------------------------------------------- |
| `yarn typecheck` | **clean**, exit 0 (1m16s elapsed — a real run, not a silent no-op)     |
| `yarn lint`      | exit 0 — **0 errors, 543 warnings** (9 + 534 across the two workspaces) |
| `yarn test`      | **4,611 passed**, 465 suites, 1 skipped — backend 622 / frontend 1,317 / core 2,672 |
| desktop e2e      | NOT re-measured — needs the `yarn dev` → stop → run cycle (owner's)     |
| web e2e          | NOT re-measured — same, and must run AFTER desktop (`rebuild:node` breaks the desktop ABI) |

Deltas vs the figure carried in the ticket: jest **4,554 → 4,611** (+57). Lint's "534" was one
workspace; the true total is 543. Migration head is **v160** (`migrations/index.ts:9395`).

Two things worth recording:

- `frontend/src/features/debts/pages/Debts/__tests__/Debts.refundedBadge.test.tsx:222` failed once
  and passed on an immediate re-run with no code change — **flaky**, not a regression. If it fails
  during this ticket's final gate, re-run before investigating.
- The first baseline run was piped through `tail`, which returned tail's exit code and reported a
  green 0 over a failing suite. Do not pipe a gate through `tail` (CLAUDE.md LIRA-123).

---

## §1 The diagnosis, corrected

The ticket's one-line root cause is right: `financial_services.commission` is written once at
creation and never updated (verified — every non-migration `UPDATE financial_services` in
`packages/core` touches only `partner_id`/`is_settled`/`settlement_id`/client/note fields; the
dynamic-SET statement at `FinancialServiceRepository.ts:4677` builds its field list at :4600-4667
and `commission` is not in it).

Four corrections change the work.

### 1.1 There are THREE shapes, not one — and two of them report ZERO, not a stale estimate

The repository auto-calculates the estimate itself and does **not** zero it for new-model rows
(`FinancialServiceRepository.ts:1291-1344`, bound into the INSERT at :1448-1450 / :1688). What the
column ends up holding depends on the provider:

| Shape (all `commission_model = 1`) | `fs.commission` after creation | What Profits shows today |
| ---------------------------------- | ------------------------------ | ------------------------ |
| **OMT** SEND/RECEIVE               | the auto-calc **estimate**     | the stale estimate — the ticket's framing |
| **WHISH** SEND/RECEIVE             | **0** (forced, `:1325-1327`)   | **nothing, ever** — even after settlement |
| **BILL** (Katsh)                   | **0** (never auto-calculated)  | **nothing, ever** |

This matters because **all six** `fs.commission` readers carry `AND commission > 0`
(`ProfitRepository.ts:1380, 1419, 1438, 1540, 1664, 1758`). A WHISH or BILL row is not merely
mis-valued — it is *structurally excluded from the WHERE clause*. A fix that adds an allocations
UNION but leaves `commission > 0` in place will still report zero for two of the three shapes.
`ProfitRepository.ts:609-611` states the BILL half in-source: *"a BILL row's
`financial_services.commission` column stays 0 forever."*

**Corollary that constrains every branch:** you cannot detect a new-model row by `commission === 0`.
You must read `commission_model`.

### 1.1b `commission` does NOT always mean "supplier commission" — and BILL rows prove it

`FinancialServiceRepository.ts:1448-1450`:

```ts
const commission = useCostPriceFlow
  ? price - cost + telecomCreditReturnCredit   // a MARGIN
  : calculatedCommission;                       // a supplier-commission ESTIMATE
```

with `useCostPriceFlow = data.cost !== undefined && data.cost > 0` (`:1083`), and `const cost =
data.cost ?? 0` bound straight into the INSERT (`:1116`, `:1688`) — so **`fs.cost > 0` is an exact
persisted twin of `useCostPriceFlow`**.

This overlaps `commission_model = 1`, and not rarely: **every BILL row takes the cost/price branch.**
All three submission sites send `cost = price = bill amount` (`KatchForm.tsx:1272-1273`, `:1404-1405`,
`:1778-1779`), so a bill's `commission` is the expression `price - cost`, which merely *evaluates to
0* today. It is not a supplier commission that happens to be zero — it is a margin.

**Consequence, and it is a trap in both directions:**

- **Phase 0** must not correct cost/price rows. Harmless today (the term is 0), semantically wrong,
  and it would corrupt any bill priced with a margin. Predicate:
  `commission_model = 1 AND COALESCE(fs.cost, 0) = 0`.
- **Phase 1** must not zero their term either. The naive gate `commissionModel === 1 ? 0 : …`
  **silently deletes a bill's margin** the day one is priced above cost. Correct gate:
  `commissionModel === 1 && !useCostPriceFlow`.

Stated as the rule that generates both: *remove only the value that came from
`calculatedCommission`.* A margin is earned at transaction time and is not deferred to settlement —
it is not what D7 re-assigns.

Neither the ticket nor the parent plan names this. It was found by tracing `useCostPriceFlow`
through to the INSERT while Phase 0 was being written.

### 1.2 The estimate propagates THREE ways, not two

- **(a) `fs.commission`** — the column. **6** readers in `ProfitRepository` (the ticket named 3;
  it missed the `getByUser`/`getByClient` `pending_profit_usd` correlated sub-queries at :1534/:1655
  and `getUnsettledCommissions` at :1755), plus `ClosingRepository.ts:696`, plus **5** sub-queries
  inside `FinancialServiceRepository.getAnalytics` (:4518+), plus `getUnsettledSummaryByProvider`
  (:4467) and `getHistory` (:4238-4251, ungated, feeds `GET /api/services/history`).
- **(b) `transactions.profit_usd/profit_lbp`** — the stamp at `FinancialServiceRepository.ts:1881-1884`.
  **8 methods / 9 prepared statements** in `ProfitRepository` read it on rows that include
  `FINANCIAL_SERVICE`: `getFinancialSettledByCurrency:656`, `getFinancialPendingByCurrency:687`,
  `getDeferredProfit:957` and `:974`, `getFinancialSettledByProvider:1011`, `getByDate`'s
  `daily_commissions` CTE `:1123`, `getByUser:1511`, `getByClient:1632`.
- **(c) `transactions.metadata_json.commission`** — `FinancialServiceRepository.ts:1986`, plus the
  estimate interpolated into the row's human-readable `summary` text (`:1962-1968`). Not summed by
  any report, but it is what the audit viewer displays. **The ticket missed this entirely.**

**The stamp is not the commission.** `:1881` is
`profit_usd: (currency === "USD" ? commission : 0) + (data.kept_change_usd ?? 0)`. "Stamp 0" would
silently delete kept-change profit — a separate money concept guarded by
`lira-108-keep-change-modules.spec.ts`. Only the **commission term** may be zeroed.

### 1.3 Closing's commission is not on screen

Verified: the only user-visible surface for `finProfit` is the line
`Total Profit (USD): ${dailyStats.totalProfitUSD.toFixed(2)}` at
`frontend/src/features/closing/utils/closingReportGenerator.ts:115`, rendered into a **generated
PDF**. A sweep of `frontend/src/features/closing/**` for `/profit|commission/i` found only the type
declaration at `:25` and that render. No dashboard tile, no closing summary card. The ticket's
"most owner-visible" ranking for surface #6 is wrong — it is the *least* visible, though still
wrong and still in scope (it is the D10 surface).

**Bonus defect in the same query** (`ClosingRepository.ts:693-699`): `finProfit` has **no
`is_refunded` filter**, unlike `salesProfit` eight lines above which carries `si.is_refunded = 0`.
A voided financial service still contributes its commission to the day's total profit. Pre-existing,
independent of LIRA-158, cheap to fix here. Note the fix is **not** `activeExpense()` —
`financial_services` has no `status` column; use the file's own `notRefunded`-shaped predicate.

### 1.4 The settlement tables are already read correctly, once

`FinancialServiceRepository.getAllByProvider:4426-4444` already joins allocations to surface the
real per-row figure for the Suppliers page. **This is the join shape to extract and reuse** (rule 14):

```sql
LEFT JOIN settlement_commission_allocations sca
  ON sca.financial_service_id = t.id
 AND sca.settlement_ledger_id = t.settlement_id   -- BOTH keys: a voided-then-resettled
 AND sca.tenant_id = ?                            -- row must not surface a stale allocation
```

It is guarded by `this._hasSettlementAllocationsTable()` (a `sqlite_master` probe) because older
fixtures lack the table. Any new query naming those tables needs the same guard **or** every
fixture must create them (§5).

**Reversal needs no predicate.** A voided settlement **hard-DELETEs** its allocations —
`TransactionRepository.ts:3650`, `DELETE FROM settlement_commission_allocations WHERE
settlement_ledger_id = ? AND tenant_id = ?`; the comment at :3624 confirms the tables carry no
soft-void column by design. Reversed allocations are physically gone, so no `is_voided` gate is
needed. (An fs row refunded *without* voiding the settlement still needs the existing
`notRefunded(...)`.)

---

## §2 The design decision — Q1, and the answer

> **Should a `commission_model = 1` row stamp profit at creation at all?**

Three advocates (pro-A, pro-B, third-way) and three judges (correctness / owner-decision compliance
/ implementation risk) ran independently over the verified map. The result was **unanimous**:

| Option | Correctness | D-compliance | Risk | |
| ------ | ----------- | ------------ | ---- | - |
| A — stamp 0, recognition moves to settlement | 7 | 8 | 6 | |
| B — keep the stamp, repoint every read to allocations | 4 | 3 | 3 | |
| **C — hybrid (below)** | **8** | **9** | **8** | **winner on every lens** |

Both A's and B's own advocates concluded their option is insufficient alone, each naming the
other's mechanism as the missing half. That convergence, not the scores, is the real signal.

### Why B loses: D7 is unreachable by a join

Every commission read on the `financial_services` spine buckets on the **fs row's own date** —
`AND ${dateRange("fs.created_at")}` at `ProfitRepository.ts:667`, `:1021`, `:1385`, and `getByDate`
groups by `DATE(fs.created_at,'localtime')` at `:1120`. Allocations are written `datetime('now')` at
settlement (`SupplierRepository.ts:1850, :1871`). **Any construction that reaches the real number by
joining allocations onto the fs row inherits the fs row's period** — a September settlement books
into August, the exact inverse of D7. B also does nothing for D10: `ClosingRepository` has no
`transactions` join to hang a stamp-based UNION on.

### Why the answer is C, not A

The codebase **already ships settlement-day cash-basis commission recognition** — it is just fenced
to bills. `SupplierRepository.ts:1422-1423`:

```ts
profit_usd: isBillsOnlyBatch ? data.commission_usd : 0,
profit_lbp: isBillsOnlyBatch ? data.commission_lbp : 0,
```

stamped onto a `SUPPLIER_SETTLEMENT` transaction (`source_table: 'supplier_ledger'`), and read by
`ProfitRepository.getSupplierCommissionTotals:624-644` with `${dateRange("created_at")}` over
`transactions` — **settlement day, not transaction day**. `SUPPLIER_SETTLEMENT` is already in
`PROFIT_TXN_TYPES` (:444-445); its REFUND counterpart already nets it to 0
(`TransactionRepository.ts:1625`); and the doc block at `:414-441` *pre-authorises exactly this
routing in writing*.

**Answer to Q1: yes — stamp 0 for the commission TERM only (keep `kept_change`), and in the same
change widen the settlement stamp past `isBillsOnlyBatch`.** The two halves are an interlock, not
alternatives:

- Widening alone **double-counts**: once settled, `fs.is_settled` flips to 1 and
  `getFinancialSettledByCurrency` sums the estimate stamp at the same moment the widened settlement
  row adds the real figure. `ProfitService.ts:436-454` folds **both** `finSvc.commission_usd` and
  `supplierCommission.profit_usd` into `grossProfitUsd`. The existing no-double-count argument at
  `ProfitRepository.ts:607-611` rests on *"a BILL row's commission column stays 0 forever"* — true
  for BILL, **false for OMT**.
- Zeroing alone leaves By Module and By Date at zero (§3 Phase 3).

### What C gets for free

`getByUser`/`getByClient` route `source_table = 'financial_services'` into an is_settled-gated arm
and everything else into a bare `ELSE t.profit_usd` (`ProfitRepository.ts:1506-1516`, LBP mirror
`:1520-1531`). A `SUPPLIER_SETTLEMENT` row's `source_table` is `supplier_ledger`, so it lands on
that ELSE **with no query change**, and a 0-stamped FS row passes through the FS arm as 0. Overview,
By Cashier and By Client become correct with zero SQL edits. Reversal symmetry (rule 20) is likewise
free — the REFUND row carries the negated stamp on the same `source_table`.

### Q1's residual — ANSWERED 2026-08-30: period re-assignment

C re-assigns commission from the transaction's period to the settlement's, and re-attributes it from
the **cashier who ran the transaction** to the **user who ran the settlement** (the settlement
transaction's `user_id`). Both follow from D7 and neither is a bug, but both are visible changes.
`COMMISSION_AT_SETTLEMENT_PLAN.md` §4 Phase 3 flagged this as needing sign-off.

**Owner confirmed period RE-ASSIGNMENT** (2026-08-30): commission leaves the transaction's day and
lands on the settlement's, attributed to the settling user. Option C stands; Option B is dead.
This is now a **decision of record** — a future session must not "restore" transaction-day
commission on the theory that it looks like a regression.

### Migration: almost certainly not needed, verify anyway

Structural bound, not a guess: OMT/WHISH only became `commission_model = 1` in commit `43948a35` at
**2026-08-30 16:39** — hours before this plan. WHISH is force-zeroed and BILL never auto-calculates.
So the affected population (`commission_model = 1 AND commission > 0`) is **at most one afternoon of
OMT SEND/RECEIVE traffic on any deployment**. Measured on the local DB (`~/Documents/LiraTek/liratek.db`,
schema v159, via Python stdlib `sqlite3`): **0 rows**, and 0 `FINANCIAL_SERVICE` transactions with a
nonzero profit stamp.

That DB holds 2 rows total, so the count alone proves little — the *structural* bound is the
argument. Ship a **guarded one-shot migration** anyway (§3 Phase 0): it is ~15 lines, it is the only
thing standing between a mixed-convention history and a silently wrong report, and no read-side test
can distinguish an old model-1 row carrying an estimate from a new one carrying 0.

---

## §3 Phases

Each phase is independently verifiable. Per the owner's process rule, **run nothing until every
phase is implemented** — one consolidated gate at the end (§6).

### Phase 0 — migration (head is v160 ⇒ this is **v161**)

Re-read the last entry of `packages/core/src/db/migrations/index.ts` before writing; trust no doc,
including this one.

- Zero the **commission term only** in the profit stamp of already-posted `commission_model = 1`
  rows, preserving kept change:
  `UPDATE transactions SET profit_usd = profit_usd - <commission term>, …` keyed by the fs join and
  `commission_model = 1`. Derive the term from `fs.commission` and `fs.currency` exactly as
  `:1881-1884` composed it — **not** by setting the column to 0.
- Predicate must also carry **`AND COALESCE(fs.cost, 0) = 0`** (§1.1b): a cost/price row's
  `commission` is a margin, not an estimate, and must not be corrected.
- Spell the term `fs.currency = 'USD'` / `= 'LBP'`, mirroring the ternary at `:1881-1884` — **not**
  the reporting queries' `!= 'LBP'` convention. A row in a third currency belongs in neither bucket.
- **Correct the REFUND rows too, with the opposite sign.** A refund carries `-original.profit_usd`
  on the SAME `source_table`/`source_id` (`TransactionRepository.ts:1620-1631`). Adjusting the
  original without its refund breaks create+refund netting to zero (rule 20).
- Leave `fs.commission` **untouched** (D6 no stamp-back; D3 cutover-not-restatement; the column stays
  the audit record of what was estimated).
- `down()` restores the term.
- Migration test asserting a pre-existing model-**0** row is untouched (precedent:
  `SupplierPaymentIsAutoBackfillMigration.test.ts`).
- Update `electron-app/create_db.sql` if any DDL changes (rule 10). *Expected: none — this is
  data-only.*

### Phase 1 — write path (the interlock; both halves in ONE commit)

1. `FinancialServiceRepository.ts:1881-1884` — gate the commission term on `commissionModel`
   **and `useCostPriceFlow`** (§1.1b — a cost/price row's `commission` is a margin earned now, not a
   deferred supplier commission):
   `(commissionModel === 1 && !useCostPriceFlow ? 0 : (currency === "USD" ? commission : 0)) + (data.kept_change_usd ?? 0)`,
   LBP mirror. **`kept_change` stays unconditional.**
   Without the `!useCostPriceFlow` half this silently deletes a bill's margin the first time a bill
   is priced above cost — invisible today only because every bill sends `cost === price`.
2. `SupplierRepository.ts:1422-1423` — replace `isBillsOnlyBatch ?` with the new-model batch
   condition so every model-1 settlement stamps its entered commission, dated to settlement day.
   The batch's model is already resolved server-side (`:1185`, and `supplier_settlements.model`).
3. Leave `fs.commission` and `metadata_json.commission` as written — they remain the estimate of
   record. Their read sites are handled in Phase 2.

**Rule 17 obligation:** both halves must be proven failing-first, and specifically the *interlock* —
apply half 2 alone and demonstrate the double-count, then apply half 1 and watch it resolve.

### Phase 2 — read path: stop the estimate reaching reports

One named `commission_model`-aware fragment (rule 14), in `ProfitRepository`'s Rule-14 section next
to `notPartnerPending`/`notDebtPending`, with a **JS twin** if any branch needs it — copy the shape
of `isPendingSupplierSettlement` / `pendingSettlementSql` (`FinancialServiceRepository.ts:822-871`)
and of `grossOwedDelta` / `SUPPLIER_OWED_EXPR` (`:625-708`), which already encodes
`const embedded = params.commissionModel === 0`.

- **Realized** (`getRealizedCommissionTotals:1367`) — restrict to `commission_model = 0`. New-model
  commission now arrives via `getSupplierCommissionTotals`. **Drop or relocate `commission > 0`** so
  the predicate no longer doubles as a model filter (§1.1). Its doc comment at `:1350-1366` becomes
  false and must be rewritten in the same change.
- **Settled-by-currency** (`:656`), **settled-by-provider** (`:1011`), `getByDate`'s
  `daily_commissions` CTE (`:1123`) — these read the stamp, which is now 0 for model-1 rows, so they
  self-correct to "no double count" but lose the figure. Restore attribution in Phase 3.
- **Pending** (`:1407`, `:1428`, and the `getByUser`/`getByClient` sub-queries at `:1534`/`:1655`) —
  **D15**: a model-1 row's pending commission is unknowable, so return a **count** ("N transactions
  awaiting settlement"), not a dollar figure. Keep the model-0 dollar figure. Replace the
  hand-rolled `is_settled = 0 AND commission > 0` with the canonical `pendingSettlementSql()`
  (it is a second definition of the same rule — rule 14).
  Note the plumbing: `ProfitService.ts:716` currently hardcodes `total_lbp: 0` on the pending row,
  so pending LBP never reaches the UI at all. The count must be carried on a field the adapter,
  `ApiAdapter` types and the Profits page all know about — not smuggled into the existing
  `pending_commission_usd` number.
- `ClosingRepository.ts:693-699` — see Phase 4.
- `FinancialServiceRepository.getAnalytics` (5 sub-queries), `getUnsettledSummaryByProvider:4467`,
  `getHistory:4238` — same treatment. #4 is already self-documented as an estimate
  (`:4480-4489`); decide explicitly whether it stays an estimate or becomes a count, and say so
  in-source.
- **`getDeferredProfit:957/:974`** — flat `SUM(t.profit_usd)` over `PROFIT_TXN_TYPES` with no
  `source_table` branch. It correctly goes to 0 for model-1 rows. Confirm that is intended (nothing
  recognised ⇒ nothing to defer) and document it rather than "fixing" it.

### Phase 3 — restore attribution (By Module, By Date, By Provider)

The settlement stamp gives correct **totals** and **period**; it does not give per-provider or
per-module grain, because a `SUPPLIER_SETTLEMENT` row is not a `FINANCIAL_SERVICE` row. That grain
is exactly what `settlement_commission_allocations` carries (`provider`, `service_type`,
`financial_service_id`, per-currency shares).

- Add a settlement-sourced source for `getFinancialSettledByProvider` and `getByDate`'s
  `daily_commissions`, dated on `sca.created_at` (D7), grouped by `sca.provider`.
- Use the §1.4 join shape, extracted once. Guard with `_hasSettlementAllocationsTable()`.
- **Do not re-derive shares at read time** — largest-remainder rounding means the stored shares sum
  to the entered amount exactly; recomputed ones will not.
- **FOR-partner rows keep their second gate**: allocated shares still gate on `notPartnerPending`
  per row. Supplier-settled ≠ partner-settled; two independent gates, both required.

### Phase 4 — Closing (D10)

- Replace `finProfit` with a settlement-day source for model-1 rows, keeping `fs.commission` for
  model-0 (cutover, not restatement). The natural source is the same `SUPPLIER_SETTLEMENT` stamp
  Closing can reach via `transactions` — `ClosingRepository` currently references `transactions`
  exactly once (`:939`), so this adds a join.
- Add the missing `is_refunded` gate (§1.3). Do **not** use `activeExpense()`.
- Note the semantics change in `docs/FEATURE_GUIDE.md`.

### Phase 5 — guard, docs, parity

- Extend `profitRecognition.guard.test.ts` to the new queries. Its live assertions are: every
  `profit|commission`-bearing query unit must textually call one of the six gate fragments, or carry
  an `EXCLUDED_UNITS` entry. `getSupplierCommissionTotals:(query)` is the precedent — a
  "recognition-by-construction" rationale. **The guard scans `ProfitRepository.ts` only**; extending
  it to `ClosingRepository` is genuinely new work, as the ticket says.
- Rule 19 parity (**D16 — in scope**): `backend/src/api/services.ts:39` is
  `router.get("/analytics", (_req, res)` — it **ignores `?providers=`**, which
  `backendApi.ts:1380-1385` sends, so web returns unfiltered analytics while desktop returns
  filtered. Read the filter off `req.query`, pass it to `getAnalytics(...)`, and add a `lira-web-*`
  assertion that it is honoured (rule 19d) — the gap exists because nothing proved it in web mode.
- Purge the stale "informational commission" comments the change invalidates.

---

## §4 Blast radius — tests that pin the current behaviour

These will fail and **must be re-derived, not silenced**. Each was named with a line number by the
advocates; spot-check before editing (agent line numbers drifted by 1-2 in several places).

| Test | Pins |
| ---- | ---- |
| `frontend/tests/e2e-electron/lira-103-business-day-today.spec.ts:117` | `expect(r.commission).toBeGreaterThan(0)` on a real OMT SEND, plus a Closing `totalProfitUSD` delta — **verified by hand** |
| `lira-102-business-day-monthly.spec.ts:135-139` | same collision for `getMonthlyPL` |
| `ProfitRepository.commissionGates.test.ts` | the LIRA-108 consistency file; its `seedSettledCommission` writes column and stamp to the same value |
| `ProfitRepository.tenantIsolation.test.ts:465+` | commission 5/15 per tenant; a `getByDate` profit of 72 including 5 USD of FS commission |
| `ProfitService.transactionBased.test.ts:488+` | 12 realized / 7 pending |
| `ProfitService.supplierSettlementCommission.test.ts:457-478` | the explicit **no-double-count** guard — widening `isBillsOnlyBatch` puts this directly in the line of fire. It is the most important test in the list: it should still pass, for a new reason. |
| `FinancialServiceRepository.telecomOnlyDays.test.ts:894` | asserts stored commission == stamped profit — Phase 1 deliberately breaks this invariant for model-1 rows; confirm the row under test is model 0 |
| `FinancialServiceRepository.tenantIsolation.test.ts:213+` | `getAnalytics` today.commission = 5 |
| `lira-108-keep-change-modules.spec.ts:179-218` | **must survive** — it is the proof that only the commission term was zeroed |

---

## §5 Test-schema trap (cost three failures in the LIRA-095 session)

A missing table makes the repository catch the SQLite error and return `{success:false}`, so every
test in the file dies in **setup** — which reads like a broken assertion, not a schema gap.

Before writing any fixture, enumerate every table the method under test touches, **including
unconditional prepares**. Known-deficient fixtures that any repointed query will break:

- `ClosingRepository.localBusinessDay.test.ts:52-57` — builds a minimal `financial_services` with
  `is_refunded` but **no `commission_model`, no `is_settled`**.
- Every Profits/Closing fixture needs `commission_model` on `financial_services` plus
  `supplier_settlements` and `settlement_commission_allocations` before a query may name them.

The cheaper alternative for read paths: carry `_hasSettlementAllocationsTable()`-style guards so an
old fixture degrades to the legacy branch instead of throwing. Prefer the guard where the query
already has one nearby; prefer fixing the fixture where the test is *about* the new behaviour.

---

## §6 The test this ticket exists for

Settle a batch whose entered commission is **deliberately ≠ the auto-calc estimate**, then assert
Profits **and** Closing both track the **entered** value, on the **settlement** day. Every existing
fixture uses values where the two coincide, which is precisely why the whole class was invisible.

Minimum coverage:

1. OMT SEND x=100, f=5 (estimate 0.50) → settle entering **2.00** → Profits commission = 2.00 dated
   to the settlement day; the transaction day shows 0.
2. Same, then **void the settlement** → every ledger nets to 0 per currency, allocations gone,
   Profits back to 0 (rule 20).
3. A **WHISH** and a **BILL** row — the two shapes that report zero today (§1.1). These are the
   regression proof that the `commission > 0` predicate was handled.
4. A **model-0 legacy** OMT row settled in the same period — must still read `fs.commission` and be
   completely unchanged (D3 cutover). This is the LIRA-095 mirror-image trap: read a row with the
   formula that wrote it.
5. Mixed model-0 + model-1 in one reporting period — the sum must be right, with no double count.
6. **A model-1 BILL row priced with a margin** (`price > cost`, so `commission = price - cost > 0`)
   — its margin must survive Phase 0 and Phase 1 untouched, and must keep reaching Profits at
   transaction time. §1.1b: this is the case that distinguishes "margin earned now" from "supplier
   commission deferred to settlement", and no current fixture exercises it because every bill ships
   `cost === price`. Without this test the `!useCostPriceFlow` guard has nothing pinning it and a
   later refactor will drop it.

Rule 17: prove each by reverting the fix, watching the specific assertion fail, restoring. A toggle
script beats hand-editing.

---

## §6b Known residuals — NOT fixed by this ticket

Recorded so a later session doesn't rediscover them as new bugs.

- **The Overview / Commissions tab summary cards may carry the same D15 gap.** They are fed by
  `getFinancialPendingByCurrency` and `getOMTAnalytics` (→ `commissionsData.today.pending_commission`,
  `financial_services.pending_commission_usd`), not by `getPendingCommissionTotals`, so Phase 2b's
  count treatment does not reach them. `getFinancialPendingByCurrency` reads the STAMP, which is now
  0 for model-1 rows, so those cards will read $0.00 for a post-cutover pending row rather than
  showing a count. Same class as the fix, different query — decide whether the count belongs there
  too. Found by the Phase 2b agent while wiring the By-Payment-Method row.
- **`getAnalytics.byProvider` count vs. commission** — `COUNT(*)` stays model-agnostic while
  `commission` is now model-0 only. Phase 2b relabels the cell client-side ("Awaiting settlement"
  instead of `$0.00`) rather than changing SQL, which is the right layer for a display fix but leaves
  the underlying asymmetry in place.
- **The allocation arm carries `notPartnerPending` but NOT `notDebtPending`** — a deliberate
  asymmetry with `getRealizedCommissionTotals`, which carries both. The reasoning: `notDebtPending`
  defers profit until a CLIENT repays an account-charged transaction. A settlement commission is
  paid by the SUPPLIER and arrives independently of whether the customer has settled their own debt,
  so it is not contingent on client repayment — and `getSupplierCommissionTotals` (the pre-existing
  settlement-sourced query) carries no debt gate either, so the new arm matches its established
  sibling rather than the legacy embedded-row query. **This is the LIRA-108 divergence class**
  (two commission queries disagreeing) and it is the one place this ticket deliberately introduces a
  gate difference. Defensible, but owner-visible: a CUSTOMER_ACCOUNT-charged OMT SEND now recognises
  its supplier commission at settlement even while the client still owes for the transfer itself.
  Confirm that is wanted.
- **Negative `commission_usd`** is accepted by `validators/supplier.ts` (a bare `z.number()`), while
  the SUPPLIER_PAYS_US ledger credit normalises with `-Math.abs(...)` and the settlement profit stamp
  uses the raw value. Not reachable through the UI; left deliberately un-"fixed" so shipped bills
  behaviour is not silently altered. See the comment at the stamp site.

---

## §7 Final gate (one consolidated pass, after ALL phases)

1. `yarn typecheck` — clean (measure **elapsed time**, not output size; ~1m15s is a real run)
2. `yarn lint` — 0 errors, ≤543 warnings
3. `yarn test` — ≥4,611 + new tests
4. Rebuild + sync core: `cd packages/core && npm run build`, then
   `cp -r packages/core/dist/. node_modules/@liratek/core/dist/`.
   **Never pipe the build through `tail`** — the exit code comes from tail.
   A frontend-facing export must be added to **`browser.ts`**, not just `index.ts`.
5. Desktop e2e (owner's cycle): `yarn dev` → stop → `npx playwright test --config
   playwright.electron.config.ts` with `env -u ELECTRON_RUN_AS_NODE`. **Desktop before web.**
6. Web e2e last (`rebuild:node` breaks the desktop ABI).
7. `yarn format` is the owner's — never run it.

---

## §8 Owner decisions — ANSWERED 2026-08-30

All three answered before implementation began. These are decisions of record (D14-D16), in the
same register as `COMMISSION_AT_SETTLEMENT_PLAN.md` §6's D10-D13.

**D14 — D7 means period RE-ASSIGNMENT.** Commission leaves the transaction's day and lands on the
settlement's day, and is attributed to the **user who settled**, not the cashier who transacted.
Option C (§2) is confirmed; Option B is rejected. Both consequences are intended and visible; a
future session must not read them as a regression and "fix" them back.

**D15 — Pending surfaces show a COUNT, not a dollar figure**, for `commission_model = 1` rows:
"3 transactions awaiting settlement". Legacy model-0 rows keep their dollar figure. This confirms
`COMMISSION_AT_SETTLEMENT_PLAN.md` §4 Phase 3. Rationale reinforced by §1.1: WHISH and BILL rows
have no estimate at all (the column is 0), so a dollar figure would render "$0.00" and read as
*settled for nothing* rather than *not yet known*.

**D16 — the `getAnalytics` IPC/REST parity gap is IN SCOPE**, folded into Phase 5.
`backend/src/api/services.ts:39` is `router.get("/analytics", (_req, res)` and ignores the
`?providers=` filter that `frontend/src/api/backendApi.ts:1380-1385` sends, so web mode returns
unfiltered analytics while desktop returns filtered. Phase 5 already edits this surface for the
commission repoint, so the fix rides along. Needs a `lira-web-*` assertion that the filter is
honoured (rule 19d) — the gap exists precisely because nothing proved it in web mode.
