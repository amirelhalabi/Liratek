# Overnight decisions — 2026-10-11 → 2026-10-12

The owner asked (2026-10-11, evening) for four items to be worked through, in this order,
without being asked anything, and for every decision taken on their behalf to be listed here:

1. `COMMISSION_AT_SETTLEMENT_PLAN.md` — what is left of it
2. LIRA-256 — OMT statement commission types
3. `SYRIA_REMITTANCE_PLAN.md`
4. `OFFLINE_DESKTOP_FALLBACK_PLAN.md`

Each decision says: the question, what was chosen, why, and how to undo it. Newest at the
bottom of each section.

## Ground rules applied to the whole batch

- **G1 — Nothing is pushed.** Pushing to `main` deploys the web app and runs migrations on the
  live database. Each item is committed locally when it is done (owner's batch rule,
  2026-10-08); the push waits for the owner. `b7d8920e` (`.gitignore`) and `8fa28255`
  (LIRA-252 status row) are also local only.
- **G2 — Spec Kit only where it fits.** Full Spec Kit (specify → plan → tasks → analyze →
  implement) for the three big items: LIRA-256, Syria, Offline. The commission plan's remainder
  is a small proof-and-docs tail, so it is done directly under its existing tickets.
  Undo: none needed.
- **G3 — New tickets.** Syria and Offline had no ticket. Filed as **LIRA-305** (Syria remittance)
  and **LIRA-306** (Offline desktop fallback), the next free numbers after LIRA-304.
- **G4 — Owner questions.** Where a plan waits on an owner answer, the option chosen is the one
  that moves the least money and is easiest to reverse, and it is recorded below.
- **G5 — What could not be verified tonight.** Desktop e2e is never run on this Mac and CI only
  runs on push, so desktop specs are written but desktop behaviour is **unverified** until CI.
  Anything that needs Fly, DNS or production access is not done; it is listed as blocked.

## 1. Commission at settlement

Result: the plan is finished and archived to
`docs/plans/done_plans/COMMISSION_AT_SETTLEMENT_PLAN.md`. Nothing a shop owner or cashier sees
changed, so there is no release-note line.

- **C1 — Which providers count in the Profits "Commission" figure?**
  *Choice:* only the supplier-commission providers (`COMMISSION_PROVIDERS`: OMT, WHISH, OMT_APP,
  WHISH_APP, BINANCE), plus commission entered at settlement. This is the owner's own rule D11:
  commission is what a supplier pays, and a card margin is Mobile Services profit.
  *Why:* every Commission figure on screen already worked this way. The Overview card and the
  By-Payment-Method "Commission (Settled)" row both read the same query, and that query has
  carried this filter since LIRA-185. The one method still without it,
  `getRealizedCommissionTotals`, has no caller in the app any more (checked by search; the
  monthly P&L that used it was deleted). I added the same one-line filter to it, so there is now
  only one definition of "realized commission". This was the option that changed the fewest
  figures (none on screen) and is the easiest to undo.
  *What it drops:* iPick, Katsh and BOB cost/price sales. Those rows also store their margin in the
  `commission` column, so the unfiltered method counted the margin as commission.
  *Measured:* new test `ProfitRepository.commissionProviderSet.test.ts` uses the real schema and
  the real writer, with an iPick sale (margin 2.00), a BOB sale (margin 3.00) and an older OMT
  row (commission 1.50).
  - The method returned **6.50 before the fix and 1.50 after**. The test failed before the fix.
  - Mobile Services showed **5.00** both before and after; it is the margins' only home.
  - The Overview commission bucket and the By-Payment row showed **1.50** both before and after.
  - The local databases contain no iPick, Katsh or BOB rows (3 OMT rows, 1 WHISH_APP row), so a
    real-data comparison would show 0 difference and prove nothing.
  
  One older test used made-up provider names (R0/R50/R100/WalkIn) only to test partner weighting.
  I renamed them to real provider codes, the same way the file's Group 1 did before.
  *Undo:* remove the line `AND fs.provider IN (${COMMISSION_PROVIDERS})` from
  `getRealizedCommissionTotals` and its last test case. No figure on screen moves either way.

- **C2 — Should the "pending commission" queries get the same provider filter?**
  *Choice:* no, leave them as they are.
  *Why:* only OMT/WHISH transfers and commission-eligible bills can ever be "not yet settled".
  That has been true since before migration v150: the old creation code marked only OMT/WHISH
  rows as pending. So a filter would change nothing in real data, and one existing test
  deliberately uses a pending BOB row.
  *Measured:* no change. *Undo:* nothing to undo.

- **C3 — The other two leftovers: commission column vs profit stamp, and USDT.**
  *Choice:* mark both closed, based on tests I ran rather than on reading the code.
  - The commission-column vs profit-stamp split was fixed by LIRA-185: both Commission rows now
    read the same stamp-based query. Its test (`ProfitAudit.financial_services`) passes.
  - USDT was fixed by LIRA-268: USDT counts as US dollars, and the Binance fee missing from the
    stamp is added back. Its test (`ProfitService.binanceProfitVisible`) passes.
  - Daily Closing matches Profits by construction: since LIRA-219 the closing screen takes its
    profit from the same `ProfitService.getSummary`, and `ClosingRepository` has no commission
    SQL of its own.
  
  *Measured:* those suites plus every other test that calls the touched method: 17 suites,
  137 tests, all pass after the C1 rename. *Undo:* not applicable.

- **C4 — "Extend the profit-recognition guard to the allocation queries and Closing."**
  *Choice:* no new code. It was already done under LIRA-158 (Phase 5 and D17). The guard reads
  both `ProfitRepository.ts` and `ClosingRepository.ts`, and every query that reads settlement
  allocations is either gated or a documented exception. The other places that touch the
  allocations table do not add up profit: the insert at settlement, the delete on void, and one
  display-only join.
  *Measured:* the guard passes. *Undo:* not applicable.

- **C5 — Was end-to-end coverage missing?**
  *Choice:* yes, for OMT only. Bills (Katsh, RATE mode: create, settle, void) were already covered
  on both web and desktop (lira-web-021 and lira-089). Nothing on the web tested an OMT
  settlement with commission followed by a void. lira-158 (desktop) settles but never voids, and
  lira-web-015 skips settling entirely. I added two specs:
  - **lira-web-052** (web): an OMT SEND of 373 with a fee of 7 owes OMT 380. It is settled with a
    commission of 1.37, deliberately not the 0.70 estimate, paying 378.63 in cash. The OMT
    balance returns to its starting point, the OMT cash drawer drops by 378.63, and Profits
    "Commission (at settlement)" rises by 1.37. After the void, OMT is owed 380 again, the drawer
    gets its 378.63 back, the commission change is 0, and the transfer is back in the "to settle"
    list.
  - **Its desktop twin**, named `lira-095-omt-commission-settlement-void` after the commission
    ticket (LIRA-095).
  
  *Measured:* the web spec ran locally: 1 passed (4.1 s for the test, 9 s in total, on a second
  run after switching its Profits read to a wide date window so it cannot depend on the server's
  clock). Both specs cover behaviour that already shipped (`43948a35`), with no fix behind them,
  so they were **not proven failing-first**. The web spec is still not hollow: its +1.37
  commission and −378.63 drawer deltas could not pass if a field path were wrong. The desktop
  spec typechecks (`tsconfig.playwright.json`) and lints clean.
  **Unverified:** the desktop spec has not run yet. Desktop e2e never runs on this Mac (G5), so
  CI will be its first run.
  *Undo:* delete the two spec files and the README row.

- **C6 — Docs, stale comments, tickets, archive.**
  *Choice:*
  - `COUNTERPARTY_LEDGERS.md` gained a new §4.1 on commission at settlement, covering the gross
    payable, the per-row cutover, LUMP/RATE entry, proportional allocation, the bills-only
    top-up, recognition on the settlement day, and reversal. I also fixed three wrong rows there:
    a settlement can be voided now; the fixed 20,000 LBP credit per bill is legacy only; and the
    profit-gate table.
  - `FEATURE_GUIDE.md`: §7 now says commission never moves a drawer at transaction time; §10
    explains commission at settlement and that "Commission" means supplier-paid only; §13 item 10
    was updated.
  - Stale "fee-only" and float-model comments were rewritten in `FinancialService.ts`,
    `useSuppliers.ts`, `Suppliers/index.tsx` and `validators/supplier.ts`. Dated history comments
    in `TransactionRepository.ts` and `transactionTypes.ts` were left alone.
  - LIRA-101 got a follow-up note. LIRA-095, LIRA-089 and LIRA-108 are already archived as DONE
    in the sprint archives, so they were not edited.
  - The plan was moved to `done_plans/`, and `PLAN_OVERVIEW.md` was updated: the board count is
    now 15, and owner question #2 is struck as decided by C1.
  
  No `UNRELEASED.md` line and no "What users will notice" line, because users see no change.
  *Undo:* move the plan back with `git mv` and revert the doc edits.


## 2. LIRA-256

## 3. Syria remittance (LIRA-305)

## 4. Offline desktop fallback (LIRA-306)

## Morning summary
