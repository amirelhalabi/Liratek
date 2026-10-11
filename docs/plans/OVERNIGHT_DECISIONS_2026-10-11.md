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

Result: **built** (all 47 tasks in `specs/256-omt-statement-commission-types/tasks.md`), not
committed or pushed. The owner can tick which OMT commission types a balance SMS includes; the
statement check subtracts only those types' commission, and both settle screens settle only those
transfers (the others are refused from the batch and wait in the list at the full amount). No
database change (still v209), no new kind of ledger row, no change to how voiding works. The
analyze re-check found S7 is real and inside the changed code, so it was fixed (S9). Measured:
core 643 suites / 6274 tests, backend 165 / 1735, electron handlers 63 / 348, frontend 513 of 514
suites (the one failure only parses landing-page HTML identical to HEAD — pre-existing); `yarn typecheck`, `yarn lint`
(0 errors), `yarn build`, tenant-scoping, bind-arity, transport-parity and schema-equivalence all
pass; web e2e lira-web-053 1 passed. **Unverified:** the desktop twin
(`lira-256-omt-statement-commission-types`) has not run (G5, CI first); the assumption that OMT's
SMS equals gross minus the included types' commission is the owner's LIRA-255 model, not
confirmed with OMT; S9 was measured on an old-style SEND only (RECEIVE not run). Without a tick, every
screen behaves as before, except S9. Note: `yarn build` replaced the `node_modules/@liratek/core`
symlink with a real copy, so later core edits need the `cp` sync again.

- **S1 — What happens to transfers of a type the SMS does not include, when you settle?**
  *Choice:* they stay in the settle list, unsettled, still owed to OMT at the full amount, with
  their commission still to come. A settlement that names covered types is **refused** if it
  includes one of them, and the message names the transfer. They get settled later, when a
  statement includes their type (or with "All types").
  *Why:* the alternative was settling them with a commission of 0, which loses that commission
  for good. They would leave the list, and Profits only counts a new-style transfer's commission
  when it is entered at settlement. A second alternative was "settle now, add the commission
  later". It needs a new kind of settlement, a new void rule and a new screen: much more money
  code for the same result. Refusing changes nothing that already exists, and voiding works
  exactly as before.
  *Undo:* remove the one check in `SupplierRepository` (`_assertRowsCoveredByStatement`) and the
  optional `covered_omt_service_types` field. Past data is untouched.
  *Measured:* `SupplierRepository.coveredTypesSettlement.test.ts` (a), (b), (e), (i): a
  settlement naming Intra that includes a Western Union (or untyped) transfer throws, naming
  `#id` and the type, and leaves the ledger, payments, settlements, allocations and transactions
  row counts unchanged — on `settleTransactions`, on `settleAccount`, and on the two-member
  `settleAccount` path. All four settled instead before the change. Web: lira-web-053 step 3 on
  both endpoints.

- **S2 — Where is the "which types" choice kept?**
  *Choice:* it is not saved as a shop setting. It is sent with each statement check and each
  settlement. The screen remembers your last choice per account, **on that device only**, the
  same way the typed SMS figures already are. Each settlement also writes the types it followed
  into its own transaction details, for the record.
  *Why:* the types change from one SMS to the next, so a saved setting would quietly carry
  yesterday's tick into today's settlement. Nothing needs the saved copy to undo a settlement.
  *Undo:* nothing to migrate; delete the field and the remembered value.
  *Measured:* the panel test saves `["INTRA"]` under `liratek:omt-covered-types:<id>` and
  restores it on remount; a throwing `localStorage` falls back to "All types". Settlements stamp
  `covered_omt_service_types` (de-duplicated, in type order) — tests (c), (g) and lira-web-053.

- **S3 — What if nothing is ticked?**
  *Choice:* all types count, which is exactly today's behaviour on both apps.
  *Why:* it is the safest default, and every existing test stays valid.
  *Undo:* not applicable.
  *Measured:* with no choice, both rows settle and both get allocations and no metadata key
  (test (d)); the read gives today's sum and a `null` echo; all baseline suites still pass, with
  one sanctioned edit (the zeroed-statement `toEqual` gained the two new keys).

- **S4 — OMT transfers saved without a type.**
  *Choice:* they show as their own choice, "Type not recorded", so they can always be included
  and never get stuck.
  *Undo:* drop the extra choice. Such rows would then settle only under "All types".
  *Measured:* an untyped OMT transfer is refused under `["INTRA"]` (message "Type not recorded")
  and settles under `["INTRA","UNSPECIFIED"]` (test (e)); the check's `UNSPECIFIED` choice
  subtracts only that row's commission.

- **S5 — Old-style OMT transfers (from before commission-at-settlement).**
  *Choice:* the type choice does not block them at settlement. Their commission was already
  taken off what was owed when they were created. The statement check still filters them by
  type, the same as the new ones.
  *Undo:* not applicable.
  *Measured:* a legacy (model 0) Intra + Western Union batch under `["INTRA"]` is not refused and
  is stamped (test (f)); an old-style row is never disabled on the account settle sheet.

- **S6 — Paying OMT's full SMS figure while some transfers wait.**
  *Choice:* no new money path. The OMT account settle sheet's existing "pay more than the ticked
  rows" option records the extra as an account credit, and you tick that credit at a later
  settlement.
  *Undo:* not applicable.
  *Measured:* not re-tested; the existing LIRA-203 surplus path is unchanged (no code touched).

- **S7 — A probable existing mistake found while designing; not changed.**
  The statement check (LIRA-255) also subtracts the commission of old-style transfers, whose
  owed amount already had that commission taken off. So for those rows the commission is likely
  subtracted twice. This is `Likely`, based on the code; the local database has no such rows,
  so it could not be measured. I did not change it, because it would change a figure you
  already use. It is noted on the LIRA-256 ticket as a follow-up.
  *Measured:* superseded by S9 below — measured and fixed.

- **S8 — Review fixes (Spec Kit "analyze").**
  An independent read-only review found 4 critical and 5 high issues in the plan. All were fixed
  in the plan before any code exists. The important one: the OMT account settlement skips the
  commission step when the ticked rows come from two account members. So the type check must
  look at **every** ticked OMT transfer, not only at the rows that get commission. Otherwise an
  uncovered transfer could slip through and lose its commission. The other fixes: test fixtures
  that could not hold new-style rows; two tests that could never fail first, now labelled
  honestly; an unstable test mock (rule 25); `yarn build` missing from the final checks; and
  three places where an older test would have broken.
  *Undo:* not applicable (planning only).
  *Measured:* the second analyze pass (research.md R11) confirmed the first pass's fixes and found
  one remaining HIGH (S7, now S9). The two-member guard is proven by test (i).

- **S9 — The S7 double subtraction is real; fixed in LIRA-256 (supersedes S7's "not changed").**
  *Question:* the analyze re-check found that S7 sits inside the very loop LIRA-256 changes.
  Fix it, or leave it?
  *Measured first:* a test with an old-style Western Union transfer (100 + fee 5, commission
  0.50, booked on the OMT balance as 104.50, the shape the code itself documents) showed an
  expected statement figure of **104.00** before any change. The right figure is **104.50**
  when the SMS includes Western Union (OMT already took the 0.50 off, and so did the app's
  balance) and **105.00** when it does not (OMT still shows the transfer at full).
  *Choice:* fixed. For an old-style transfer the check now subtracts nothing more when its
  type is included and adds the commission back when it is not. New-style transfers are
  unchanged (subtract the commission when included).
  *Why:* the figure was wrong by exactly the commission of every old-style transfer still
  waiting, and the change is display only: nothing is booked, no balance moves. Leaving it
  would have made the new per-type ticks wrong for old-style transfers too.
  *What users will notice:* a shop that still has old unsettled OMT transfers sees a
  different "expected on OMT's statement" figure, now matching OMT's. Shops without them see
  no change.
  *Undo:* in `getAccountExpectedStatement`, treat model-0 rows like model-1 rows again.

## 3. Syria remittance (LIRA-305)

Result: **designed, not built.** Ticket **LIRA-305**, as filed under G3. Spec Kit design ran (specify → plan → tasks →
analyze, three independent passes) in `specs/305-syria-remittance/`.

The big finding came first. **Both directions already exist and work:** SEND is Services → Via Partner, and RECEIVE is
Services → Via Partner → Pay out. You chose that route on 2026-09-24 (notes #16) and confirmed it "as built, no change" on
2026-09-25. The plan file from 2026-09-17 (a "Syria" tab on the OMT/Whish page) was never moved out of the to-do folder.
That is why it looked unbuilt. It is not built and should not be.

I checked the money with test runs, not by reading the code:
- Booking, voiding and refunding a send or a pay-out puts the cash drawer, the partner's account and the profit back to
  zero, in dollars and in lira.
- One real mistake was found. A pay-out's commission waits until the partner "pays". But when what you owe the partner
  for sends cancels what the partner owes you for pay-outs, the app never counted that as paying, so the pay-out
  commission never showed on Profits. The fix is designed (Y6) and has 21 tasks ready for an agent.

Nothing in the database changes (still v209). The OMT/Whish screens are not touched.

- **Y1 — Build a "Syria" provider on the OMT/Whish page, or keep Syria in Services (Via Partner)?**
  *Choice:* keep it in Services, exactly as it works today.
  *Why:* you decided this three times (2026-08-10, 2026-09-24, 2026-09-25). The OMT/Whish route needs a database change and
  edits to delicate OMT/Whish money code. It would also give the shop two different ways to book the same transfer.
  *Undo:* nothing to undo; the old plan is kept, marked "superseded", for the record.

- **Y2 — Is a partner always required?**
  *Choice:* yes, as today. A pay-out without a partner is refused on both apps.
  *Undo:* not applicable.

- **Y3 — Which cash drawer?**
  *Choice:* General. A send takes payment the normal way; a pay-out is paid in cash from General. Syria never touches the
  OMT or Whish cash drawers, as you asked. No new drawer.
  *Undo:* not applicable.

- **Y4 — Currency?**
  *Choice:* dollars and lira each stay on their own, with no conversion. Netting (Y6) only matches dollars with dollars
  and lira with lira.
  *Undo:* not applicable.

- **Y5 — How is commission taken, and when is it counted?**
  *Choice:* as today.
  - On a send: price minus cost, counted the same day, because the customer has already paid you.
  - On a pay-out: what arrived minus what you paid out (for example $100 arrived, the customer gets $97, $3 commission).
    It is counted when the partner pays, which is your rule from 2026-10-06 (D5) and replaces the earlier note "counted
    the same day".
  
  *Undo:* not applicable.

- **Y6 — Does netting count as the partner paying?**
  *Choice:* **yes.** A pay-out's commission counts as the partner's account, in that currency, stops owing that money.
  It does not matter whether the partner paid you in cash or what you owe them for sends cancelled it. If the partner
  still owes part of it, the newest pay-outs wait and the oldest count first. Nothing extra is saved; Profits works it
  out each time it opens.
  *Why:* without it, the commission on pay-outs is never counted in a normal two-way corridor. Measured today:
  
  | What happened | Partner's account at the end | Pay-out commission counted | After the fix |
  | --- | --- | --- | --- |
  | Sends of 150 and pay-outs of 100; you paid the 50 difference | square | $0 of $3 | $3 |
  | Sends of 100 and pay-outs of 100; nothing to pay | square | $0 of $3 | $3 |
  | Sends of 40 and pay-outs of 100; the partner paid the 60 difference | square | $1.80 of $3 | $3 |
  
  It moves no money: no drawer, no balance and no saved record changes. Only the timing on Profits changes. It cannot
  count profit too early.
  **This departs from part of your D5 rule (2026-10-06) — please confirm it first.** D5 said a pay-out's commission
  counts "when the partner pays, same rule as For Partner rows". The For Partner rule only counts cash, never netting,
  so in a two-way corridor the pay-out commission would never count at all. Y6 keeps "when the partner pays" and adds
  netting for Services pay-outs only; For Partner rows keep the cash-only rule (Y7). Because Profits works this out each
  time, profit for earlier days goes up too; closings already printed do not change. If you already paid the partner cash for the sends,
  a later pay-out still waits, because the partner really owes you.
  *What you will notice:* pay-out commissions that were stuck as "waiting for partner" appear on Profits, on their own
  day. That includes ones you entered before this change.
  *Undo:* remove one small piece of the Profits calculation. No data to fix.
  *Measured:* the "today" figures above come from a test run on the real database layout. The "after" figures are the
  targets of the new guard test (task T004), not yet run. Speed was measured on a prototype of the calculation, for a
  partner with 300 sends and 300 pay-outs: about 1 second for the whole Profits read when the account is square, and about
  4 seconds when 150 pay-outs are still unpaid. My first version took 37 seconds; the review caught it and the design was changed before any
  code was written. A second review caught that undoing a cash entry would have left a commission stuck; that was fixed
  in the design too.

- **Y7 — Should netting also release profit on other partner work (For Partner sales, recharges, Loto…)?**
  *Choice:* no. It applies only to Services pay-outs. Everything else stays exactly as today.
  *Why:* it is the smallest change that fixes the corridor. Other partner work has its own rules, and nobody asked to
  change them.
  *Undo:* not applicable.

- **Y8 — One corridor (Syria) or several?**
  *Choice:* it already works for any corridor: any partner, same form (Turkey, Iraq…). Nothing is Syria-specific.
  *Undo:* not applicable.

- **Y9 — "For Partner" or "Via Partner"?**
  *Choice:* Via Partner, for both directions. "For Partner" on the Services page keeps its own meaning: the partner uses
  your service and owes you the full price.
  *Undo:* not applicable.

- **Y10 — Which "OMT or Whish only" places in the app must stay as they are?**
  *Choice:* all of them, untouched: the shop's main system, the setup wizard, the OMT/Whish cash drawer routing, the
  OMT/Whish page's provider list, the partner filter there, and the test that guards it.
  *Why:* Syria is a route the shop offers, not the shop's main system.
  *Undo:* not applicable.

- **Y11 — Undoing a send, a pay-out or a partner payment?**
  *Choice:* the existing void and refund already put everything back (measured: drawer, partner account and profit
  return to 0). Netting saves nothing, so there is nothing extra to undo. After a void, Profits recalculates on its own.
  *Undo:* not applicable.

- **Y12 — Can a pay-out go into a customer's session basket?**
  *Choice:* no, as today. A pay-out is recorded straight away.
  *Undo:* not applicable.

- **Y13 — Do "paper" entries on a partner's account count as you owing the partner?**
  These are manual entries with "Cash moved" switched off, for example an opening balance.
  *Choice:* no. A manual credit entered with "Cash moved" switched off is left out. Everything else on the partner's
  account counts: sends and other partner jobs, settlements, discounts, entries where cash moved, wallet top-ups from the
  partner, and the voids of any of these.
  
  A paper credit never releases a pay-out's commission. A paper debit ("the partner owes us") still keeps it waiting.
  *Why:* the review found that, without this rule, one paper line "shop owes partner 500" would have counted every
  pay-out's commission at once with no money moving. That also breaks your earlier rule that paper entries are only
  notes and never count as payment.
  *Undo:* drop the exclusion; the Partners page balance itself is not affected either way.


## 4. Offline desktop fallback (LIRA-306)

## Morning summary

- **Web test failures (LIRA-094 group 4, LIRA-095 mixed-currency, LIRA-158 D17): test-only fixes. The app was not changed.**
  None of the three came from tonight's commits. All three failed only when the browser window was visible. Web runs
  show the window by default, and that makes the steps run slower, so timing problems in the tests showed up. With the
  window hidden, all three passed on the same code.
  The fixes are all in the test files:
  - 094: the test waited for an input that the Whish App form also has, so it typed into the outgoing form. It now
    waits for a button that only the OMT App page has.
  - 095 (and 123 S7): the test switched the payment back to Cash before the app's automatic switch to Customer Account
    had finished. It now waits for that switch first.
  - 158: the test picked the payment method after typing the commission. It now picks the method first.
  - Two new web tests (052/053) were replacing the Profits password on every run, which made later tests fail to
    unlock. They now leave an existing password alone.
  - Not fixed (rare in practice): if the payment method is changed within a few milliseconds of the total changing,
    the payment window can keep the old amount. No person can click that fast. Written up so it isn't forgotten.
