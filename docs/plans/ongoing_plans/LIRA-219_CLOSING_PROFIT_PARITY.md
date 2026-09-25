# LIRA-219 (widened) — design: closing's profit = the Profits page's profit for the day

**Status:** implemented and verified 2026-09-25 (unit/typecheck/lint green; e2e re-run of 6 fixed
specs pending with the owner); not yet committed at the time of writing.

design APPROVED 2026-09-24; implemented 2026-09-24 (delegation + both transports +
docs landed; parity-test coverage for the rewritten gate scenarios is now COMPLETE — 59 cases,
mutation-proven, covering debt-pending per module-debt type, per-module refunds, bills-only
immunity, mixed-currency sale, pending custom service, two-leg exchange, and model-1
estimate-vs-entered, on top of the 26 cases in section (A) below). Desktop/web e2e are still
owner-run. Ticket: `current_sprint.md` `## LIRA-219`.

## Owner answers — 2026-09-24 (these override section (E)'s defaults)

| Q | Answer |
| --- | --- |
| E-Q1 net line | **Add it.** The PDF prints `Net profit = gross − expenses` **per currency** (USD line, LBP line), matching the Profits headline card. No converted net total. |
| E-Q2 partner rows | **Proportional**, inherited from the Profits page (follows from "closing = Profits page"). LIRA-173's later-payment gap stays open. |
| E-Q3 later recognition | **Accept + add an "as of" line:** `Profit as of HH:MM — later repayments/refunds update this day on the Profits page` (time from the device that prints the PDF). |
| E-Q4 legacy model-0 unsettled | **Moot.** Production (read-only, 2026-09-24): zero OMT/WHISH rows with `commission_model = 0 AND is_settled = 0 AND commission > 0`. Follow the Profits page; no exception. |
| E-Q5 PDF converted totals | **Keep** LIRA-174's `Total (USD/LBP) @ rate (sell rate)` lines for GROSS profit. The separate USD / LBP lines stay above them. |
| E-Q6 access | **Hide the profit block unless the caller is admin OR has unlocked the Profits page** (note #2: staff must not see profits). **Server-enforced on both transports** — reuse LIRA-177's gate (`backend/src/middleware/profitsUnlock.ts` `requireProfitsUnlock` logic; IPC `profitHandlers.ts` `requireProfitsGate`), never a client-side flag. A caller who fails the gate still gets the activity stats and expenses, with the profit fields ABSENT and `profitHidden: true`. The PDF then prints `Profit: hidden — unlock the Profits page to include it`. |
| E-Q7 failed read | **Print "unavailable"**, never `$0.00` (C.6). |

Measured exposure (read-only, 2026-09-24): production has **no** `CREDIT_BUYBACK` rows, and 3 loto tickets and 4 sale lines in total. The local desktop DB has similar tiny counts. No printed closing has been wrong yet.

**Date:** 2026-09-24.
**Owner decision being implemented (2026-09-24):** "Today's profit in the closing report must equal the
Profits page's profit for today." Closing reuses the Profits page's code (rule 14); only owner-decided
differences survive, as named exceptions.

**Verdict.** Closing's profit is wrong for 20 of the 26 measured cases (24 modules, one control and one
out-of-scope partner case). On the combined fixture, closing prints
**$79.00 + 55,000 LBP**. The Profits page prints **$71.75 + 2,805,000 LBP**, and By Date gives the same
figure. The measurement turned up **no** remaining owner-decided difference: LIRA-158's settlement-day
commission already applies to both surfaces. The fix is to delete closing's own profit SQL and have
`ClosingService` read `ProfitService.getSummary(day, day).totals.gross_profit_*`.

**Evidence:** the probe is `scratchpad/lira219/probe219.test.ts`. It uses the real `electron-app/create_db.sql`
schema, a fresh in-memory DB for each case, and rows stamped the way each writer stamps them (the writer is
cited per seeder). It runs under `scratchpad/jest.lira219.cjs` with `--maxWorkers=1`: **27 tests ran, 27
passed**, in 1.5 s. The figures below are copied from `scratchpad/lira219/probe_results.txt`, which the run
wrote. Rule 28: the results file holds a value for every row, so every measurement actually ran.
The combined totals were checked twice: re-added by hand from the per-module rows (USD 71.75 and 79.00,
LBP 2,780,000 before the partner row was added), and cross-checked against `getByDate` for the same day,
which gives the same numbers.

---

## (A) Module-by-module

Line numbers refer to the working tree: `ClosingRepository.ts` (**CR**) and `ProfitRepository.ts` (**PR**).
Closing's date rule is always `todayLocal(col)` = `DATE(col,'localtime') = DATE('now','localtime')`. That
is the **server's** own calendar day, and it takes no parameter (CR:50-51, CR:823). The Profits page's
date rule is always `dateRange(col)` with the **client's** `from`/`to` (PR:865). Every figure in the
Measured column is `USD / LBP`.

| # | Case | Closing formula + gates | Profits page formula + gates | Measured closing | Measured Profits | Class |
|---|---|---|---|---|---|---|
| 1 | Sale, qty 3 at 10 (cost 6), $2 discount | `SUM(si.sold_price − si.cost_snapshot)`: per unit, **never × quantity, no discount**. Gates: `si.is_refunded=0`, `saleFullyPaid`, binary (CR:877-888) | `SUM(t.profit_usd × saleRecognitionWeight)` over SALE+REFUND, dated by the sale's `created_at` (PR:2692) | 4 / 0 | 10 / 0 | **BUG** (same as DC-10) |
| 2 | Sale + 10,000 LBP kept change | USD only | `t.profit_lbp` (PA-3.1) | 2 / 0 | 2 / 10,000 | **BUG** |
| 3 | LBP recharge, 500,000 − 450,000, + $1 kept change | `CASE currency_code != 'LBP' THEN price−cost ELSE 0`: LBP dropped, kept change dropped (CR:1087-1136) | `ownCurrencyProfit(t)` + `otherCurrencyKeptChange*`, `t.type='RECHARGE'` (PR:3196) | 0 / 0 | 1 / 50,000 | **BUG** (the original LIRA-219) |
| 4 | USD recharge, 10 − 9, + 45,000 LBP kept change | same | same | 1 / 0 | 1 / 45,000 | **BUG** (LO-V1 kept change) |
| 5 | FS model-0 USD (Binance), commission $2 | `commission` where `currency != 'LBP'`, `embeddedCommission`, no `is_settled` gate (CR:960-1017) | `ownCurrencyProfit(t)`, `fsStampRecognized` (PR:3029) | 2 / 0 | 2 / 0 | equal |
| 6 | FS model-0 LBP (OMT_APP), commission 100,000 | LBP excluded | counted | 0 / 0 | 0 / 100,000 | **BUG** |
| 7 | FS model-1 USD OMT SEND, settled today, $3 (cashless) | allocations `commission_usd` only, dated by `sca.created_at`, binary partner gate (CR:1048-1060) | allocations `commission_usd` and `_lbp`, **same settlement-day dating**, proportional partner weighting (PR:2982-2996) | 3 / 0 | 3 / 0 | equal. LIRA-158 D14 settlement-day dating applies to **both** surfaces, so it is not a closing exception |
| 8 | FS model-1 LBP WHISH SEND, settled today, 150,000 | `commission_usd` only | `commission_lbp` counted | 0 / 0 | 0 / 150,000 | **BUG** |
| 9 | Bills-only settlement (Katsh), $1.50 + 20,000 LBP | `SUM(profit_usd)` of the SUPPLIER_SETTLEMENT stamp, USD only (CR:1035-1046) | `profit_usd` and `profit_lbp` (PR:2960) | 1.5 / 0 | 1.5 / 20,000 | **BUG** |
| 10 | PM fee $0.75 | **not read at all** | `getPmFeeTotals` (PR:3356; PA-2.6: immediate profit) | 0 / 0 | 0.75 / 0 | **BUG** |
| 11 | Mobile service iPick USD, 5 − 4 | model-0 `commission` column | `ownCurrencyProfit(t)` (PR:3137) | 1 / 0 | 1 / 0 | equal |
| 12 | Mobile service iPick LBP, 500,000 − 400,000 | LBP excluded | counted | 0 / 0 | 0 / 100,000 | **BUG** |
| 13 | Custom service USD, 20 − 12, + $0.50 kept change | `cs.profit_usd` (a generated column, price − cost): kept change dropped (CR:1150-1199) | `t.profit_usd` (PR:3243) | 8 / 0 | 8.5 / 0 | **BUG** |
| 14 | Custom service LBP, 300,000 − 100,000 | `profit_lbp` never read | counted | 0 / 0 | 0 / 200,000 | **BUG** |
| 15 | Maintenance USD job with parts | `final − (cost + parts_cost)` (CR:1227-1289) | `t.profit_usd` (PR:3276) | 34 / 0 | 34 / 0 | equal (kept change would differ, same pattern as #13) |
| 16 | Maintenance LBP job, 3,000,000 − 1,000,000 | LBP never read | `t.profit_lbp` | 0 / 0 | 0 / 2,000,000 | **BUG** |
| 17 | Exchange, leg profit $2.50 | leg1 + leg2, binary partner gate (CR:1352-1370) | same expression, proportional partner weighting (PR:3382) | 2.5 / 0 | 2.5 / 0 | equal |
| 18 | Loto: 50,000 commission + 5,000 LBP and $1 kept change | `t.profit_lbp` only (CR:1313-1325) | `t.profit_lbp` + `t.profit_usd` as `kept_change_usd` (PR:3314) | 0 / 55,000 | 1 / 55,000 | **BUG** (LO-R10) |
| 19 | Debt repayment, $0.50 kept change | **not read** | `getDebtRepaymentProfit` (T3 KC-2, owner 2026-07-13) | 0 / 0 | 0.5 / 0 | **BUG** |
| 20 | Counterparty discount, −$3 forgiven | **not read** | `getCounterpartyDiscountTotals` (CQ-10 D1: netted into profit) | 0 / 0 | −3 / 0 | **BUG** |
| 21 | Client Whish top-up USD, $2 fee | caught by `rechargeProfit`, which has **no type filter**: price − cost = amount − cashPaid = fee | `getTopupBuybackProfit` (PR:2813) | 2 / 0 | 2 / 0 | equal, but only by accident |
| 22 | Client Whish top-up LBP, 50,000 fee | LBP excluded | counted | 0 / 0 | 0 / 50,000 | **BUG** |
| 23 | Credit buyback: $20 credits for $18 cash | `rechargeProfit` reads the `CREDIT_BUYBACK` row (`cost = 0`, `price = payout`) and counts the **whole payout** as profit | `t.profit_usd = credits − payout` | **18** / 0 | 2 / 0 | **BUG** (new finding: over-counts, not under-counts) |
| 24 | Credit buyback: $20 credits for 1,620,000 LBP | LBP row excluded | `t.profit_usd` = $2 | 0 / 0 | 2 / 0 | **BUG** |
| 25 | Expense $5 + 100,000 LBP (control) | `activeExpense`, todayLocal | `activeExpense`, dateRange | 5 / 100,000 (expenses) | 5 / 100,000 | equal |
| 26 | Partner loto ticket, 50% covered (record only) | binary `notPartnerPending`, excluded | proportional `partnerCoverageRatio` | 0 / 0 | 0 / 25,000 | OUT OF SCOPE: LIRA-173, but see E-Q2 |
| — | **All combined** | | | **79 / 55,000** | **71.75 / 2,805,000** | |

**Symptoms the ticket named, each verified:**
1. **Kept change: CONFIRMED.** Closing reads no kept change of its own anywhere. Loto's LBP kept change gets
   in only because it shares `t.profit_lbp` with the commission (#18). Every other kept-change arm is
   dropped (#2, #4, #13, #19).
2. **`totalProfitLBP` is loto-only: CONFIRMED** (CR:1403). Every other module's LBP slice is dropped (#3,
   #6, #8, #9, #12, #14, #16, #22).
3. **Per-unit sales formula: CONFIRMED** (#1: $4 against $10).
4. **Partner rows: CONFIRMED and recorded** (#26). Closing uses the binary gate; the Profits page is
   proportional.
5. **"Today": CONFIRMED rule-27 defect (from the source; not measurable in-process).** `getDailyStatsSnapshot()`
   takes no argument and asks SQLite for `DATE('now','localtime')`, which is the server's day. It never
   reads `clientDay()`, even though `ClosingRepository` already imports it for checkpoints (CR:4). On web
   (Fly, UTC), a closing printed between 00:00 and 03:00 Beirut reports the **previous** UTC day, while the
   Profits page gets the browser's day. The Profits page has its own, separate LIRA-196 problem:
   `dateRange` converts the stored timestamp with the server's `localtime`. Both surfaces share that, so
   parity survives it. It stays out of scope, as §7.2 of the owner notes already says.

**New findings, not in the ticket:**
- **#23/#24, buyback over-count.** `rechargeProfit` scans the whole `recharges` table, including
  `CREDIT_BUYBACK` and every `TOP_UP` shape. A $20-credit buyback adds **$18** to closing profit instead of
  $2. This is the one case where closing *over*-states profit.
- **Stale comment at CR:1390-1402.** It says `saleFullyPaid` is unexported and "hand-inlined". It is
  imported (CR:27) and called (CR:885). The comment goes away with the code.
- **The REST route returns HTTP 500 on failure** (`backend/src/api/closing.ts:118-124`). That breaks the
  envelope rule 19c (HTTP 200 + `{success:false}`).
- **`ClosingService`'s error fallback** (`ClosingService.ts:60-79`) returns all zeros with no
  `totalProfitLBP`, so a failed profit read would print a confident "$0.00".

**UNCLEAR, needs an owner answer (E-Q4).** For a legacy model-0 row that is still `is_settled = 0`
(OMT/WHISH with `commission > 0`, `pendingSettlementSql` arm 2), closing counts the commission on the
transaction day. The Profits page holds it in "Pending" and keeps it out of gross until it is settled
(`fsStampRecognized`, PR:998). Likely, based on `FinancialServiceRepository.ts:1625-1629`: new OMT/WHISH
SEND/RECEIVE rows are born model 1, so no such row can be *created today*, and the difference is ~0 for
today's closing. A read-only production query would confirm it (see E-Q4).

---

## (B) Which Profits-page figure closing should equal

**`summary.totals.gross_profit_usd` / `gross_profit_lbp`: gross, before expenses, per currency, never
combined.**
- The closing PDF prints `Total Expenses (USD/LBP)` as separate lines and never subtracts them from profit
  (`closingReportGenerator.ts:133-141`). Its profit lines are therefore gross. The Profits headline reads
  "Gross − Expenses = Net" (`Profits.tsx:1013-1046`), and the owner's Dashboard decision is also "Profit =
  gross, before expenses" (§7, decision 1).
- It also equals By Date for that day. The probe checked this: `getByDate(day, day)` Σ `profit_usd`/`_lbp`
  equals `getSummary` gross in every one of the 27 cases. So closing, the Profits Overview, By Date and
  the future DC-10 chart all tie to one definition.
- Closing's expense figures already equal `summary.expenses` (#25). Switching them over costs nothing and
  removes a second copy of `activeExpense` + date rule.

Whether to also print a **Net** line is an owner question (E-Q1).

---

## (C) Design

### C.1 Layer (rules 13 and 14)
The gross-profit arithmetic is service-level assembly (`ProfitService.getSummary`, lines 827-903 of that
file, ~17 terms per currency). A repository cannot reuse it without re-typing it. So the composition goes
in the **service** layer:

```
ClosingService.getDailyStatsSnapshot(input?: { day?: string })
  day      = input?.day ?? clientDay()                 // rule 27: the client's value wins
  activity = this.repo.getDailyActivityStats(day)       // sales count/total, debt payments: NO profit SQL
  summary  = this.profitService.getSummary(day, day)    // the ONE definition
  return { ...activity,
           totalExpensesUSD: summary.expenses.total_usd, totalExpensesLBP: summary.expenses.total_lbp,
           totalProfitUSD:  summary.totals.gross_profit_usd,
           totalProfitLBP:  summary.totals.gross_profit_lbp,     // now required, not optional
           profitDay: day }
```

- `ClosingService`'s constructor gains `profitService: ProfitService = getProfitService()` (dependency
  injection, SOLID), next to the existing `repo`. It already follows that pattern.
- **Delete from `ClosingRepository.getDailyStatsSnapshot`:** `salesProfit`, `finProfitLegacy` (4
  branches), `finProfitSettlement` (3 branches), `rechargeProfit` (4), `customProfit` (4), `maintProfit` (2),
  `lotoProfit` and `exchangeProfit`. Also delete the schema probes and helpers only they use:
  `_hasCommissionModelColumn`, `_hasSettlementAllocationsTable`, `_hasPartnerLedgerTable`,
  `_hasLotoTicketsTable`, `_hasExchangeTransactionsTable`, `_sourceTxnIdSubquery`, and `_hasTransactionsTable`
  if nothing else uses it. The implementer greps each name before deleting. Drop the now-unused
  `ProfitRepository` imports on CR:14-28. Rename the method to `getDailyActivityStats(day: string)` so a
  caller cannot mistake it for the profit-bearing snapshot. Its remaining queries take `day` through
  `dateRange(...)` (import it; do not re-text `todayLocal`), bound `${day} 00:00:00`–`${day} 23:59:59`,
  exactly as `ProfitService` binds them.
- Cost: `getSummary` runs about 20 queries, including the date-independent `getPendingSaleProfit`, once per
  checkpoint. Acceptable. Do **not** add a slimmer `getGrossProfit` twin now: it would be a second fetch
  path for the same terms. That is a follow-up, only if measurement shows it is slow.
- **Named exceptions: none remain.** If the owner keeps legacy model-0 unsettled commission on the
  transaction day (E-Q4 answered "keep"), that is the *only* exception. It would be added as a single
  service-level adjustment using a new exported `ProfitRepository` fragment, with its owner decision cited
  in the code. Closing never re-texts SQL for it.

### C.2 Types (rule 21)
- `DailyStatsSnapshot` moves to its service-level shape, with `totalProfitLBP: number` (required) and
  `profitDay: string`, plus an optional `profitUnavailable?: true` (C.6).
- The repo returns `DailyActivityStats` (no profit fields).
- The four hand-written copies of the type must follow: `packages/ui/src/api/types.ts:~300`,
  `frontend/src/types/electron.d.ts:2246`, the local `DailyStatsData` in `closingReportGenerator.ts:22-35`,
  and the repository interface. Collapse them onto ONE exported type from `@liratek/core`. Verify that
  `browser.ts` re-exports it as a **type-only** export (rule 29: `export type` is erased at compile time,
  so it is safe).

### C.3 "Today" (rule 27)
- New `dailyStatsSnapshotQuerySchema = z.object({ day: <YYYY-MM-DD>.optional() })` in
  `packages/core/src/validators/closing.ts`. That file already carries the same regex 5 times (lines 20,
  30, 65, 95, 112). Extract one `localDaySchema` and reuse it (rule 14).
- The frontend sends it explicitly. `Checkpoint/index.tsx:302` calls the snapshot with
  `{ day: closingDay }`. `closingDay` is the SAME `localDay()` value it passes as `closing_date` and prints
  as `Date:`. Compute it once so the PDF date and the profit day cannot disagree (rule 22).
- The server falls back to `clientDay()`: the `X-Client-Day` header on web, and `localDay()` on desktop.
  The no-argument callers (lira-103 e2e, handler tests) therefore keep working.
- **Do not** set `TZ` on the server (rule 27). LIRA-196 stays a separate ticket.

### C.4 Both transports (rule 19)
- **IPC** (`electron-app/handlers/dbHandlers.ts:215`): `closing:get-daily-stats-snapshot` accepts an
  optional payload → `validatePayload(dailyStatsSnapshotQuerySchema)` → `getClosingService()
  .getDailyStatsSnapshot(payload)`. Rule 23 three-way diff: schema `{day}` / preload `{day}` / handler
  forwards `{day}`. Today the handler has no role check. Keep that unless E-Q6 changes it.
- **preload** (`preload.ts:907`): `getDailyStatsSnapshot: (data?: DailyStatsSnapshotQuery) =>
  ipcRenderer.invoke(..., data)`.
- **REST** (`backend/src/api/closing.ts:117`): `GET /daily-stats-snapshot?day=` validated against the same
  core schema (on `req.query`; the implementer checks how the existing validator handles query strings).
  Return **HTTP 200** `{success:false,error}` on failure instead of 500 (rule 19c).
- **Adapter:** `backendApi.getDailyStatsSnapshot(input?: z.input<typeof dailyStatsSnapshotQuerySchema>)`
  → `ipcOrHttp`. The `?day=` query string is built once from the same object (rule 22). Update
  `ElectronApiAdapter.ts:317` and `ApiAdapter` (`packages/ui/src/api/types.ts:1329`).

### C.5 Stored history
- `daily_closings` / `daily_closing_amounts` have **no profit column** (`create_db.sql:1350-1371`). Profit
  exists only inside the PDF generated after the checkpoint is saved (`Checkpoint/index.tsx:300-340`).
  Nothing is restated and **no migration** is needed. Old PDFs keep their old, wrong figures. That is
  acceptable, and it is the "history is not restated" rule applied.

### C.6 PDF (LIRA-174 label)
- `rateStampedProfit.ts` `formatRateStampedProfitBlock`: change `Profit - LBP amount (Loto only)` to
  `Gross profit - LBP amount`, and `Profit - USD amount` to `Gross profit - USD amount`, so both use the
  Profits page's word. Rewrite the module doc's "What 'LBP amount' actually is" section (it describes the
  deleted loto-only behaviour).
- Update the assertion in `closingReportGenerator.test.ts` (rule 24: take the label from the formatter's
  own exported constant rather than hand-typing it).
- Add a line `Profit as of <HH:MM> — later repayments/refunds adjust this day on the Profits page` (E-Q3).
- If `profitUnavailable`, print `Gross profit: unavailable` instead of `$0.00`. On a money report, a silent
  zero is the wrong way to fail. The service catches a `getSummary` throw, logs it, and returns the
  activity stats with the flag set.

### C.7 Guards and docs in the same change
- `profitRecognition.guard.test.ts`: the 6 `ClosingRepository:getDailyStatsSnapshot:*` `EXCLUDED_UNITS`
  entries (lines ~375-500) become stale, and the "no stale entries" test (line 550) **will fail until they
  are removed**. Keep `ClosingRepository.ts` in the scan. Add one assertion: `ClosingRepository.ts` contains
  **zero** profit-bearing query units, so a future re-texted profit query fails CI.
- `embeddedCommission.guard.test.ts:104`: keep `ClosingRepository` in scope (it becomes vacuous). Check that
  its `inScopeUnits.length > 10` floor (line 536) does not depend on closing's units.
- Update `docs/FEATURE_GUIDE.md` closing semantics ("closing profit = Profits Overview gross for the
  client's day"). In `current_sprint.md`, widen the LIRA-219 body and add a close-out. Update the comment at
  `FinancialRepository.ts:90`.

---

## (D) Failing-first tests (rule 17)

New core file `packages/core/src/services/__tests__/ClosingService.profitParity.test.ts`. It uses the
**create_db.sql** schema, like the probe; that avoids the "test schema silently voids the file" trap for
every closing fixture. Each case asserts BOTH an **explicit hand-derived expected** value (this is what fails
on HEAD) AND `closing == getSummary(day,day).totals.gross_*` (this guards against drift). The HEAD failure
for each was **measured by the probe** (column "HEAD").

| Case | Expected USD / LBP | HEAD | Proves |
|---|---|---|---|
| Sale qty 3, discount | 10 / 0 | 4 / 0 fails | × quantity, discount |
| Sale LBP kept change | 2 / 10,000 | fails | kept change |
| LBP recharge + $1 kept change | 1 / 50,000 | fails | LBP slice + kept change |
| USD recharge + LBP kept change | 1 / 45,000 | fails | kept change |
| FS model-0 LBP | 0 / 100,000 | fails | LBP |
| FS model-1 LBP cashless settlement | 0 / 150,000 | fails | LBP on the settlement-day arm |
| Bills-only settlement LBP | 1.5 / 20,000 | fails | LBP |
| PM fee | 0.75 / 0 | fails | missing source |
| iPick LBP | 0 / 100,000 | fails | LBP |
| Custom USD kept change | 8.5 / 0 | fails | kept change |
| Custom LBP | 0 / 200,000 | fails | LBP |
| Maintenance LBP | 0 / 2,000,000 | fails | LBP |
| Loto USD kept change (LO-R10) | 1 / 55,000 | fails | kept change |
| Debt repayment kept change | 0.5 / 0 | fails | missing source |
| Counterparty discount | −3 / 0 | fails | missing source |
| Top-up LBP | 0 / 50,000 | fails | LBP |
| Buyback USD | 2 / 0 | **18** fails | over-count |
| Buyback LBP payout | 2 / 0 | 0 fails | missing source |
| All combined | 71.75 / 2,780,000 (excl. partner) | 79 / 55,000 fails | end to end |
| **Explicit `day`** (a row stamped yesterday at 12:00 local; call with `day = yesterday`) | row's profit | HEAD has no parameter, ignores the day, returns 0: fails | rule 27 |

**Equality guards that cannot fail first** (they already agree on HEAD): FS model-0 USD, model-1 USD
cashless, iPick USD, maintenance USD, exchange, top-up USD and expenses. Keep them as regression cases, and
label them honestly in the file header as "not failing-first". Their protection comes from the
explicit-expected assertion: a mutation of a `ProfitService` gross term would break it, because the
equality half is trivially true once closing delegates.

**Structural:** mock `ProfitService` and assert that `getSummary` is called with `(day, day)` and that its
`totals.gross_*` is returned unchanged. Fails on HEAD, because `ProfitService` is not a dependency there.

**Transport and UI (failing-first where a behaviour changes):**
- `electron-app/handlers/__tests__/dbHandlers.*`: a `{day}` payload reaches the service; a malformed day is
  rejected.
- `backend/src/api/__tests__/closing*`: `?day=` is forwarded, and a failure returns HTTP **200**
  `{success:false}`. HEAD returns 500, so this fails first.
- `frontend/src/api/__tests__/backendApi.dualmode.test.ts`: both branches send the same `{day}`.
- `Checkpoint` page test: the snapshot is requested with the same day as `closing_date`.
- `closingReportGenerator.test.ts`: no "(Loto only)" in the label, and "unavailable" rendering.

**Existing tests to rewrite, not delete (rule 24).** These assert closing's own deleted SQL:
`ClosingRepository.{moduleProfitGates, lira160DebtPendingGates, lira160PartnerPendingGates,
lira161ExchangeAndLoto, lira161SaleFullyPaidCoupling, localBusinessDay, maintenancePartsProfit,
cashlessSettlementDefersOnDebt}.test.ts`, `LIRA158.closingCashBasis.test.ts`, `ExpenseActiveGate.test.ts`
(closing arm), `Checkpoint.stress.test.ts`, `PostRefactorVerification.test.ts`, and
`backend/src/services/__tests__/ClosingService.test.ts`. Each gate scenario (refund, debt-pending, partner,
maintenance-completed, parts cost, settlement-day, D17 cashless deferral, local-day boundary) becomes a case
in the parity file above. Its expected value is re-derived under the Profits page's rules. The partner
cases' expected values change from "excluded" to "proportional", per E-Q2. `lira-103` e2e needs **no**
change: the recharge margin equals its stamp, and the no-argument call falls back to `clientDay()`.

---

## (E) Owner questions (each has a recommended default)

1. **Gross, or gross and net, on the PDF?** *Default: print gross (as today, now correct) and add a
   `Net profit = gross − expenses` line per currency, matching the Profits headline.* Both inputs are
   already in the snapshot.
2. **Partner rows become proportional in closing.** Delegating means closing inherits the owner's
   2026-09-05 proportional rule (#26: 25,000 LBP instead of 0). "Closing = Profits page" requires this.
   *Default: accept.* LIRA-173's gap stays open: a partner who pays **after** the day never shows in any
   closing.
3. **Profit recognised later.** A debt repaid tomorrow, a partner covering later, or a refund of an older
   sale all change *that origin day* on the Profits page, and never appear in any closing. This is true
   today as well; delegation does not create it. *Default: accept (closing is a snapshot of the Profits
   page at print time), and print "as of HH:MM" plus the one-line footnote (C.6).* The alternative is a
   cash-basis "recognised today" figure, which would break the equality the owner asked for.
4. **Legacy model-0 OMT/WHISH commission still unsettled.** *Default: follow the Profits page (pending, out
   of gross); no exception.* Confirm with a read-only production query: model-0 OMT/WHISH rows with
   `is_settled = 0 AND commission > 0` created after the v148 cutover. If the count is 0, the question is
   moot.
5. **Converted totals on the PDF.** LIRA-174 prints "Total (USD/LBP) @ sell rate". The 2026-09-24 note #3
   removed the combined USD↔LBP net figure from the *Profits page*. *Default: keep the PDF's converted lines
   (LIRA-174 was a document-specific owner spec).* Ask, because the two decisions look inconsistent to a
   reader.
6. **Access.** The Profits page is behind the per-page password (LIRA-177, `requireProfitsUnlock`,
   `profits.ts:155`). The closing snapshot is not (IPC has no role check; REST uses only `requireAuth`), so
   a staff checkpoint PDF shows the full profit. *Default: keep the current behaviour* (staff already see
   closing profit today). Ask whether the profit block should be hidden unless the user is an admin or has
   unlocked the Profits page.
7. **A failed profit read.** *Default: print "unavailable", never $0.00* (C.6).

---

## (F) Risks

- **Ordering.** The Profits run is still editing `ProfitService`/`ProfitRepository` (uncommitted working
  tree). LIRA-219's expected values are derived from that tree. Land LIRA-219 **after** that run is
  verified and committed, or its expected values move under it.
- **Test fallout.** About 13 test files assert the deleted SQL. Rewrite them together with the deletion.
  Their minimal hand-written schemas cannot run `getSummary` (`reference_test_schema_completeness`), which
  is why the parity file uses `create_db.sql`.
- **Guard edits.** Deleting the queries breaks `profitRecognition.guard`'s stale-entry test until its 6
  closing entries are removed. This is expected; do not read it as a regression.
- **LIRA-196 is shared, not fixed.** On web, both surfaces convert stored timestamps with the server's UTC
  `localtime`. They stay equal to each other and are both off by 3 hours at the day boundary. Parity holds;
  correctness near midnight on web does not.
- **Point-in-time.** Equality holds at print time only (E-Q3). A reviewer comparing an old PDF with today's
  Profits page will see differences. That is expected, not a regression.
- **Import cycle and bundle.** `ClosingService` → `ProfitService` → `ProfitRepository`/`RateRepository`.
  `ClosingRepository` already imports `ProfitRepository`, so no new cycle is expected, and `ClosingService`
  is not reachable from `browser.ts` (rule 29). Verify with the existing
  `browserEntryIsNodeFree.guard.test.ts`.
- **Performance.** About 20 queries per checkpoint. Likely negligible; measure once on the owner's local DB
  copy.

**Assumptions (unverified):**
- The probe seeds rows with direct INSERTs stamped per each writer's code (cited per seeder). It does not
  call the writers themselves, so a writer that stamps differently from the cited lines would shift a
  figure.
- The E-Q4 impact is ~0 (inferred from `FinancialServiceRepository.ts:1625-1629`; no production query has
  been run yet).
- `getSummary` is fast enough per checkpoint (not measured).
