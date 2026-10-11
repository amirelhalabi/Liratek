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

Result: **built and tested, not deployed** (2026-10-11, overnight). Ticket **LIRA-305**, filed under G3, designed with
Spec Kit in `specs/305-syria-remittance/` (21 of 21 tasks done). The only change to the app is one Profits rule: a pay-out's
commission now counts when what you owe the partner for sends cancels what the partner owes you, not only when the
partner pays cash (Y6). The parent agent went ahead with Y6 without waiting for you (Y14). The rule saves nothing: it is
worked out each time Profits opens. Removing it brings back today's figures, and no data needs fixing.

Tested by running it, not by reading the code. The new guard test failed first on the old code (5, 3 and 3.8 instead of 8, 6
and 5) and passes now. The web test failed first (pay-out commission +$0) and passes now (+$3). Every void puts the drawer, the
partner's account and Profits back. Speed: about 1.1 s for the whole Profits read when the account is square, and 4.3 s
when the partner owes. The limits were 3 s and 10 s. The desktop test is written. On this Mac it passed once in web mode;
its first desktop run is on CI (G5). Nothing in the database changes: it is still v209. No screens or OMT/Whish code changed.
**Profits for earlier days can go up** for partners you both send and pay out through.

The big finding came first. **Both directions already exist and work:** SEND is Services → Via Partner, and RECEIVE is
Services → Via Partner → Pay out. You chose that route on 2026-09-24 (notes #16) and confirmed it "as built, no change" on
2026-09-25. The plan file from 2026-09-17 (a "Syria" tab on the OMT/Whish page) was never moved out of the to-do folder
(it is now archived in `done_plans/`). That is why it looked unbuilt. It is not built and should not be.

I checked the money with test runs, not by reading the code:
- Booking, voiding and refunding a send or a pay-out puts the cash drawer, the partner's account and the profit back to
  zero, in dollars and in lira.
- One real mistake was found. A pay-out's commission waits until the partner "pays". But when what you owe the partner
  for sends cancels what the partner owes you for pay-outs, the app never counted that as paying, so the pay-out
  commission never showed on Profits. The fix (Y6) is now built; see the Result above.

Nothing in the database changes (still v209). The OMT/Whish screens are not touched.

- **Y1 — Build a "Syria" provider on the OMT/Whish page, or keep Syria in Services (Via Partner)?**
  *Choice:* keep it in Services, exactly as it works today.
  *Why:* you decided this three times (2026-08-10, 2026-09-24, 2026-09-25). The OMT/Whish route needs a database change and
  edits to delicate OMT/Whish money code. It would also give the shop two different ways to book the same transfer.
  *Measured:* no OMT/Whish file changed (`git diff` over the OMT/Whish page, its test, the setup wizard and the drawer routing is empty); the old plan is archived in `done_plans/`.
  *Undo:* nothing to undo; the old plan is kept, marked "superseded", for the record.

- **Y2 — Is a partner always required?**
  *Choice:* yes, as today. A pay-out without a partner is refused on both apps.
  *Measured:* unchanged; the existing refusal tests still pass (`CustomServiceRepository.payout.test.ts`, lira-web-custom-service-payout "rejected without a Via-Partner mode", green over the web on 2026-10-11).
  *Undo:* not applicable.

- **Y3 — Which cash drawer?**
  *Choice:* General. A send takes payment the normal way; a pay-out is paid in cash from General. Syria never touches the
  OMT or Whish cash drawers, as you asked. No new drawer.
  *Measured:* send +$103 and pay-out −$97 on General, both apps' tests (lira-web-054 green; desktop twin green in web mode).
  *Undo:* not applicable.

- **Y4 — Currency?**
  *Choice:* dollars and lira each stay on their own, with no conversion. Netting (Y6) only matches dollars with dollars
  and lira with lira.
  *Measured:* a USD send never nets an LBP pay-out (LBP profit stays 0, USD 3); an LBP corridor gives 600,000 LBP and goes back to 300,000 after voiding the pay-out.
  *Undo:* not applicable.

- **Y5 — How is commission taken, and when is it counted?**
  *Choice:* as today.
  - On a send: price minus cost, counted the same day, because the customer has already paid you.
  - On a pay-out: what arrived minus what you paid out (for example $100 arrived, the customer gets $97, $3 commission).
    It is counted when the partner pays, which is your rule from 2026-10-06 (D5) and replaces the earlier note "counted
    the same day".
  
  *Measured:* the send's $3 counts at once (lira-web-054 step 1: +$3); a lone pay-out still counts $0 until paid, and $1.50 after the partner pays $50.
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
  **This departs from part of your D5 rule (2026-10-06) — please confirm it first.** → Decided by the parent agent: go ahead (Y14). It can be undone in one step. D5 said a pay-out's commission
  counts "when the partner pays, same rule as For Partner rows". The For Partner rule only counts cash, never netting,
  so in a two-way corridor the pay-out commission would never count at all. Y6 keeps "when the partner pays" and adds
  netting for Services pay-outs only; For Partner rows keep the cash-only rule (Y7). Because Profits works this out each
  time, profit for earlier days goes up too; closings already printed do not change. If you already paid the partner cash for the sends,
  a later pay-out still waits, because the partner really owes you.
  *What you will notice:* pay-out commissions that were stuck as "waiting for partner" appear on Profits, on their own
  day. That includes ones you entered before this change.
  *Undo:* remove one small piece of the Profits calculation. No data to fix.
  *Measured:* the "today" figures above come from a test run on the real database layout. **After the change, measured
  (guard test `ProfitRepository.syriaCorridorNetting.test.ts`, 28 of 28 passing):** the three rows give $8, $6 and $5 for the
  whole corridor (it gave $5, $3 and $3.80 before). On the web the pay-out commission went from +$0 to +$3 (lira-web-054).
  Earlier note on the design: speed was measured on a prototype of the calculation, for a
  partner with 300 sends and 300 pay-outs: about 1 second for the whole Profits read when the account is square, and about
  4 seconds when 150 pay-outs are still unpaid. My first version took 37 seconds; the review caught it and the design was changed before any
  code was written. A second review caught that undoing a cash entry would have left a commission stuck; that was fixed
  in the design too.

- **Y7 — Should netting also release profit on other partner work (For Partner sales, recharges, Loto…)?**
  *Choice:* no. It applies only to Services pay-outs. Everything else stays exactly as today.
  *Why:* it is the smallest change that fixes the corridor. Other partner work has its own rules, and nobody asked to
  change them.
  *Measured:* For Partner rows unchanged: a For Partner service's $10 still waits (total $5, the same before and after); the full core suite passes (6,302 tests).
  *Undo:* not applicable.

- **Y8 — One corridor (Syria) or several?**
  *Choice:* it already works for any corridor: any partner, same form (Turkey, Iraq…). Nothing is Syria-specific.
  *Measured:* tests use any partner name; nothing in the code says Syria.
  *Undo:* not applicable.

- **Y9 — "For Partner" or "Via Partner"?**
  *Choice:* Via Partner, for both directions. "For Partner" on the Services page keeps its own meaning: the partner uses
  your service and owes you the full price.
  *Measured:* not applicable.
  *Undo:* not applicable.

- **Y10 — Which "OMT or Whish only" places in the app must stay as they are?**
  *Choice:* all of them, untouched: the shop's main system, the setup wizard, the OMT/Whish cash drawer routing, the
  OMT/Whish page's provider list, the partner filter there, and the test that guards it.
  *Why:* Syria is a route the shop offers, not the shop's main system.
  *Measured:* `git diff` over every listed place is empty (task T010).
  *Undo:* not applicable.

- **Y11 — Undoing a send, a pay-out or a partner payment?**
  *Choice:* the existing void and refund already put everything back (measured: drawer, partner account and profit
  return to 0). Netting saves nothing, so there is nothing extra to undo. After a void, Profits recalculates on its own.
  *Measured:* voiding the send gives $0, voiding the partner's settlement gives $3.20, refunding the pay-out gives $3, and voiding a cash entry or a wallet top-up leaves the figure where it was. The drawer and the partner's account come back each time, in USD and LBP.
  *Undo:* not applicable.

- **Y12 — Can a pay-out go into a customer's session basket?**
  *Choice:* no, as today. A pay-out is recorded straight away.
  *Measured:* unchanged (no basket code touched).
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
  *Measured:* a paper credit of $100 gives $0, the same credit with cash moved gives $3, and a paper credit with another type still gives $0. An old-style manual credit from before LIRA-066 gives $0.
  *Undo:* drop the exclusion; the Partners page balance itself is not affected either way.

- **Y14 — Go ahead with Y6 before you confirm it?**
  *Choice:* **yes.** The designer asked for your confirmation first (Y6). The parent agent decided to build it now.
  *Why:* the rule saves nothing. It changes only how Profits reads what is already there. No drawer, no balance and no
  saved record changes. A printed closing stays as it is. Closings do not store profit, though, so a past day's close
  opened again shows the new figure. Without it, pay-out commissions in a two-way
  corridor never show at all.
  *What you will notice:* pay-out commissions for partners you both send and pay out through appear on Profits, on their
  own day. Old payments and sends count too. **Profit shown for earlier days can go up** for those partners. The release
  note says so plainly.
  *Undo:* delete `partnerEffectiveCoveredSql` in `packages/core/src/constants/partnerObligation.ts` and point its two users
  in the same file (`partnerCoverageRatioWhereSql`, `partnerUncoveredExistsWhereSql`) back at `covered_amount`. Every
  figure goes back to what it was. There is no data to fix and no migration.
  **Owner confirmed 2026-10-11: keep Y14** (netting counts as the partner covering a pay-out; past Profits may rise).

- **Y15 — Seven older unit tests broke on the new rule. Change the code or the tests?**
  *Choice:* the tests' cut-down tables. Seven older core tests build their own small copy of the partner and transaction
  tables, and those copies leave out columns the real database has always had. The new rule reads those columns, so
  these seven tests stopped with "no such column" before checking anything. Each test's table now has the missing
  columns, written the way the real database has them. No expected value, test data or check was changed. LIRA-258 did
  the same when its rule started reading more columns.
  *Why:* the real database always has these columns. Writing the rule around missing columns would only help those tests.
  *Undo:* not applicable. Taking the columns out again only breaks those seven tests.
  *Measured:* before, 7 suites (36 tests) stopped with "no such column". After, the whole core suite passes: 644 suites,
  6,302 tests.


## 4. Offline desktop fallback (LIRA-306)

Result: **redesigned, not built.** The first overnight design (web paused while a PC was offline, three offline actions
only, committed in `a3698788`) is **superseded**. On 2026-10-11 the owner decided a different model in a live
conversation (N1–N9 below). The new Spec Kit design is in `specs/306-offline-desktop-fallback/` (152 tasks, 10 phases). Three independent review
passes were run (your cap): pass 1 found 1 critical + 8 high, pass 2 found 1 critical + 7 high, pass 3 found 0 critical
+ 4 high. All were fixed in the design; the last four high items are also written as tests that must fail first
(T011, T016, T034, T059). No code, no
database change yet. The design adds one migration (v210, eight new tables).

**What it does, in short.** Every PC of the shop keeps a copy of the shop's data, refreshed about every 5 minutes. If the
internet or the power goes, each PC can switch to offline mode on its own copy and do everything a cashier does on the
web app. Each action is saved as an "event". The web app and phones keep working the whole time. When the internet is
back, each PC sends its events. The server puts all PCs' events in time order and books each one through the same rules
as the web app, on the day it happened. Duplicates, stock that went below zero, drawer counts taken offline and anything
it cannot book go on an "Offline work to review" page on the web app.

### Owner decisions (2026-10-11, live conversation — decided by the owner, not by me)

- **N1** The web app never locks. Web, phones and other PCs keep working online while any PC is offline. Replaces D2.
- **N2** Offline mode allows every cashier action the online app has: sales, customer baskets, OMT/Whish/wallet
  transfers, recharge, debts and repayments, expenses, exchange, repairs, custom services, loto, refunds and voids,
  clients, stock movements. Online-only, refused offline with a clear message: Settings, users and permissions, Reset
  Data, supplier/partner settlement, subscription/licensing, setup.
- **N3** The worst case is the shop network or power going down, so every PC can go offline on its own and works on its
  own copy. While online each PC refreshes its copy (about every 5 minutes). Offline mode does not rely on the shop
  network (the Windows share).
- **N4** Events: each PC records an event for every write (the validated request, who, when, which day and time zone,
  the PC's own sequence number, a unique id) in the same save as the change itself. On reconnect the server processes
  events in time order across PCs, never reordering one PC's own events, through the same core services the website
  uses, with each event's original time and day. Events refer to other events, not to local row numbers. Rows created
  offline get numbers from a far-away range per PC so the server can swap them for the real numbers it assigns (D4).
- **N5** A PC with events has changes. Cross-check: the rows the PC's working file gained must agree with its events;
  any mismatch goes on the review list.
- **N6** Real money is always booked. Stock that goes below zero after the merge is booked and flagged "stock count was
  off". One physical item sold twice is a duplicate (N7).
- **N7** Duplicates: same event id → skipped silently. Certain duplicate (same OMT/Whish reference number; same recharge
  carrier + phone + amount within 10 minutes) → skipped and noted. Likely duplicate (all listed fields equal within ±5
  minutes, ignoring who and the exact second) → held on the review list with Apply / Dismiss, never dropped by itself.
  Compared against online rows made during the outage and other PCs' events.
- **N8** Drawer counts and checkpoints taken offline are never applied by themselves; they go to the review list.
- **N9** Still valid: D1 the web is primary; D3 Google Drive is not used for syncing; D4 row numbers are assigned only by
  the database that stores the row. D2 is revoked by N1.

### Decisions I took within N1–N9 (question, choice, why, undo)

- **O-new-1 — How are offline row numbers built?**
  *Choice:* PC number × 10¹² + table number × 10⁹ + a counter (PC 1's 5th sale might be `1 007 000 000 005`). Each
  PC gets its number when it is paired, never reused.
  *Why:* the owner's example started at 1,000,000,001, but 1,000,000,000 LBP is only about $11,200, an ordinary sale. A
  number that low could be mistaken for an amount. Putting the table in the number also tells the server which table a
  number belongs to without extra lists.
  *Undo:* change the layout before the first release; after that, never.
- **O-new-2 — Can a PC sell an item its copy shows as out of stock?**
  *Choice:* yes, with a warning on screen. On the server the sale is booked and flagged "stock count was off".
  *Why:* the copy can be minutes old, and N6 says the count may be wrong, not the sale.
  *Undo:* respect the shop's out-of-stock setting offline.
- **O-new-3 — A repayment ticked a debt that someone paid online meanwhile.**
  *Choice:* book the money anyway against the oldest open debts (any extra becomes credit, as today) and add a note.
  *Why:* today such a repayment is refused as a whole; N6 says real money is booked.
  *Undo:* send it to the review list instead.
- **O-new-4 — A customer created offline has a phone number that already exists.**
  *Choice:* use the existing customer for everything that PC did with the new one, and add a note.
  *Why:* otherwise every later sale and repayment for that customer would be held.
  *Undo:* hold it for review instead.
- **O-new-5 — A certain duplicate was really a second transfer.**
  *Choice:* the note has a "Book anyway" button.
  *Why:* a recharge rule of "same phone and amount within 10 minutes" can be a real second recharge; N6.
  *Undo:* remove the button.
- **O-new-6 — Vouchers offline?**
  *Choice:* creating a voucher is online-only. Cancelling one works offline.
  *Why:* the server makes the voucher code; a code printed offline would not match.
  *Undo:* send the PC's code with the event (a service change).
- **O-new-7 — Whose name goes on replayed work? Please confirm.** (was O23)
  *Choice:* the person who did it on the PC. The server checks that person belongs to the shop and is allowed to do
  that action. Someone switched off since is still booked, with a note, because the money moved.
  *Undo:* credit the pairing admin instead.
- **O-new-8 — How does a PC prove itself with no one signed in? Please confirm.** (was O25)
  *Choice:* its own device key, issued when an admin pairs it, stored hashed on the server, revocable in Settings. Any
  number of PCs per shop.
  *Undo:* revoke the PC.
- **O-new-9 — Product catalog changes offline?**
  *Choice:* online-only (create, edit, delete products, categories, product suppliers). Stock movements work offline.
  *Why:* N2 does not list them; an old offline price edit landing later would overwrite a newer online one.
  *Undo:* move the channels to offline.
- **O-new-10 — Receipt number of an offline sale.**
  *Choice:* it prints `RCP-<offline number>`; after sending, that number still finds the sale (reprint, warranty).
  *Undo:* not applicable.
- **O-new-11 — Actions N2 does not name** (drawer top-up, cash-out and transfer, hold money, warranty claims, debt
  write-off, carrier-line usage, deleting an expense/repair/custom service, editing notes and statuses).
  *Choice:* allowed offline — they are actions on the shop's own till and records.
  *Undo:* move any of them to online-only (one line each).
- **O-new-12 — The same record was edited online and offline.**
  *Choice:* the edit processed last wins.
  *Undo:* hold conflicting edits for review (needs a change-tracking column).
- **O-new-13 — Which time do replayed rows carry, including the cash-drawer detail lines?** (re-decides old O26)
  *Choice:* the time the action happened on the PC, for every timestamp the save writes. A time the user typed
  (backdating) still wins. Backdating on the web/desktop is unchanged.
  *Why:* the money entered the drawer then; the old choice (lines dated when sent) would move drawer lines to the
  reconnect day.
  *Undo:* stop passing the event time to the drawer lines.
- **O-new-14 — Order across PCs.**
  *Choice:* earliest next event first by corrected time, each PC's own order always kept; the server waits 30 seconds
  after an upload so PCs that reconnect together interleave; it never waits for a PC still offline.
  *Undo:* change the 30 seconds (a server setting).
- **O-new-15 — A PC's clock is wrong.**
  *Choice:* the server measures each PC's clock at every check-in and upload and corrects event times when the error is
  over 2 minutes, never into the future and never before the copy the PC worked on; a note says so. Money is still booked.
  *Undo:* change the 2 minutes.
- **O-new-16 — Does the desktop window show the web app while online?**
  *Choice:* no. The standby screen has "Open the web app", which opens the browser.
  *Why:* inside the desktop window the web app would talk to the PC's local copy instead of the server.
- **O-new-17 — Can the cashier keep working offline after the internet is back?**
  *Choice:* yes; events send by themselves in the background and a banner asks to go back to the web app. "Back to the web
  app" finishes sending and returns the PC to standby.
  *Why:* never cut a sale off half-way.
- **O-new-18 — How are duplicates compared?**
  *Choice:* the server books the event in a trial step, takes the same "fingerprint" from the rows it just made as from
  the rows already there, and undoes the trial if it is a duplicate.
  *Why:* one definition of "the same", used on both sides.
- **O-new-19 — Lists that use row number as time** (customer running balance, carrier-line movements).
  *Choice:* keep today's order. A replayed row shows in a customer's running balance where it was sent, not where it
  happened; the release note says so.
  *Why:* switching to time order would also change today's online running balances for backdated entries (the review
  found the row-number order is deliberate there).
  *Undo:* a follow-up that orders by time with a tie-break, after checking backdated entries.
- **O-new-20 — A held or refused event has later events that depend on it.**
  *Choice:* only those are held ("waits on item …"); everything else carries on. When the item is applied they are
  processed automatically.
- **O-new-21 — Kept from the first design:** permanent "processed once" record (old O9), working copy with the event in
  the same save (O10), version check and updates on standby (O11), copy contents (O16), the PC's own request allowance
  (O17), desktop-only shops unchanged (O18, O19), re-pairing keeps waiting work (O24), copy made by the server (O3),
  device key (O4). **Superseded:** O1, O2, O5, O6, O7, O8, O12, O13 (replaced by O-new-20), O14 (O-new-15), O15
  (O-new-10), O20 (O-new-19), O22, O23 (O-new-7), O25 (O-new-8), O26 (O-new-13).
- **O-new-22 — Timings.** PCs check in every 30 seconds; "Work offline" appears after 30 seconds without the server.
  *Undo:* settings.
- **O-new-23 — Can a web sale get mixed into a replayed event's save?**
  *Choice:* no. Each replayed event is saved in one uninterrupted step; the server checks that nothing else ran in the
  middle and undoes the step if something did (it is then retried). A web sale arriving at that moment simply runs
  right after it.
  *Undo:* not applicable.
- **O-new-24 — Which exchange rate does replayed work use?**
  *Choice:* the rate the PC had when the cashier did it (saved with the event). If today's rate on the web differs
  from it when the work arrives, the item gets a "rate changed during the outage" note. Fee tables and commissions use today's server
  values.
  *Undo:* use the server's rate at replay time.
- **O-new-25 — A PC loses power in the middle of offline mode.**
  *Choice:* on restart it reopens the same working copy with its unsent events, never a fresh one. A re-paired PC keeps
  its PC number, so its waiting events still fit.
- **O-new-26 — An app update changes an offline form while a PC still has unsent work.**
  *Choice:* work whose form is still compatible is booked normally; work that no longer fits is put on the review list
  with everything the cashier entered, so you can re-enter it. Rule for releases: don't publish a change to an offline
  form while the PCs panel shows unsent work.
  *Undo:* not applicable.
- **O-new-27 — A drawer count taken offline is applied later.**
  *Choice:* when you press Apply, the server works out the expected amount again at that time (the PC could not see the
  web's and other PCs' sales) and shows you both figures before booking.
  *Undo:* book the PC's own figure.
- **O-new-28 — "Same as" links for duplicates.**
  *Choice:* when you confirm a duplicate, only the sale or transfer itself is linked to the existing one, not its lines;
  a later offline refund of one line of it waits on the review list instead of guessing which line.
  *Why:* the two entries may list items in a different order.
- **O-new-29 — A PC's event numbering gets out of step with the server** (it lost its saved state).
  *Choice:* the PCs panel shows it and offers "Renumber this PC's unsent work"; nothing is lost and nothing is booked
  twice.
- **Gate G0 — what waits for your yes.** Following the project's rules, the parts that need O-new-7 and O-new-8 (the PC
  key routes, sending from PCs, and the two web tests that use them) are not started until you approve. Everything
  else (the merge engine, duplicates, the review logic behind the page, money preparation, copy builder) can be built
  now. The review page itself, its routes and the PCs panel also wait (they are web-only, part of E1).

### Decisions taken while building (implementation, LIRA-306)

- **O-impl-1 — The PC outbox has no PC link column.**
  *Question:* the design says the PC's outbox has "the same columns" as the server's event table, which links each event
  to a paired PC. *Choice:* the outbox has no such link (on a PC the paired-PC table is empty, so the link would break
  every save) and keeps its own delivery state (waiting / acked / done, the server's outcome, the last error).
  *Why:* the PC is always the one PC. *Undo:* add the column in a later migration.
- **O-impl-2 — Refunding an item on the web: one check or several?**
  *Question:* the plan says to give the web refund route the single shared check the desktop and offline replay now use.
  *Choice:* the web route keeps checking each part (return methods, returned phones, rate, change kept) on its own, with
  the same shared pieces the single check is built from. *Why:* rebuilding it would change the exact error wording and
  how an empty value is treated on the web, for no gain. *Undo:* switch the web route to the single check.
- **O-impl-3 — Customer create/edit: desktop and web rules differ today.**
  *Question:* the web refuses a phone number that is not 8–15 digits and wants "WhatsApp" as yes/no; the desktop accepts
  any phone text and 0/1. Offline work needs one rule. *Choice:* offline work uses the DESKTOP rule (the PC records what
  its own screen accepted); the web keeps its stricter rule. Nothing changes for anyone today. *Why:* making them equal
  would change what one of the two apps accepts. *Undo:* a follow-up that picks one rule for both apps.
- **O-impl-4 — Expenses on the desktop now follow the web's rules.** *Choice:* the desktop expense form is checked
  with the same rules as the web: an empty description and a missing Lira amount (counted as 0) are now accepted on
  the desktop too (a description left out entirely still fails, as it does on the web today). A field the desktop sent that nothing read ("expense type") is no longer passed on. *Why:* one rule for
  both apps and for offline work. *Undo:* make the description required again in the shared rules (both apps).
- **O-impl-5 — The server's processing kept failing in the real app but not in tests.**
  *What happened:* running the web test showed every sent item stayed "waiting": the built app uses an older copy of the
  library that checks forms, while the tests used the newer one, and the code that compares form versions only knew the
  newer one. *Choice:* it now understands both, a test proves both give the same answer, and an unexpected error while
  booking one item can no longer stop the rest (it is retried, then put on the review list). *Undo:* not applicable.
- **O-impl-6 — Unpairing the test PC.** *Choice:* the web test does not unpair its PC at the end (the unpair button is
  part of the review page, not built yet); the next test run unpairs every test PC before it starts. *Undo:* unpair in
  the test once the route exists.
- **O-impl-C-1 — Cancelling a voucher offline.** *Choice:* cancelling a voucher is online-only, like creating one
  (your answer: vouchers online-only); O-new-6's text had kept cancelling offline. *Undo:* move it back to the offline
  list and restore the counts (71 offline / 105 online-only).
- **O-impl-C-2 — The "time of replayed work" check skips one settings table.** *Choice:* the automatic check that
  every saved row carries the work's own time ignores the currencies setup table (a setting, not shop work); otherwise
  about 29 old tests would need rewriting. *Undo:* include it and update those tests.
- **Smaller choices while building (Agent C), for the record:** a held-money pickup is dated with the work's time, not a
  typed time; adding or deleting a custom service still records no "who" on either app (unchanged); deleting a repair
  now refuses a malformed number such as "7abc"; the desktop now refuses a broken drawer-count form exactly as the web
  does. *Known and left as they are (follow-ups):* a late phone-line balance reading overwrites credit used after it; a
  scheduled loto checkpoint is not de-duplicated; an applied loto checkpoint also counts tickets sold after its time;
  the next drawer count starts from the most recently ENTERED count, so an offline count applied later becomes the base.
- **O-impl-D-1 — A broken link inside a shop copy.** *Choice:* counted and logged, the copy is still served (not
  fatal). *Why:* one stray row must not stop every PC from getting a copy. *Undo:* refuse the copy.
- **O-impl-D-2 — Profits password in the copy.** *Choice:* kept. *Why:* otherwise the Profits page could not be
  unlocked offline. *Undo:* strip it (Profits locked offline).
- **O-impl-D-3 — Google sign-in links in the copy.** *Choice:* removed. *Consequence:* a user who only signs in with
  Google cannot sign in offline (they need a password). *Undo:* keep the links (they are useless without internet).
- **O-impl-D-4 — Copy cache.** *Choice:* one cached copy per shop (not per PC). *Undo:* key it by PC.
- *Follow-up for T115:* the backend test for the copy route should inject the build step; the service singleton cannot
  take the test database constructor.

### What can be built and tested on this Mac

The server side: merging, id swapping, duplicates, the review logic, the copy builder — with core tests. The review
page, its routes and the PCs panel wait for G0. The web tests lira-web-055 (sending work) and lira-web-056 (review page) drive the PC key routes, so
they wait for your yes on O-new-7/O-new-8 (gate G0). Also the money
preparation: moving 23 desktop checks into the shared core and making replayed rows keep their own time (core tests,
failing first). The PC parts (recorder, working copy, sending, screens) are written with unit tests only; they cannot be
seen working until CI or your Windows PC.

### Blocked on you or on infrastructure (G5)

- push and deploy;
- a desktop release with the same data version;
- pairing two real PCs and the two-PC outage drill at the test shop;
- your yes on O-new-7, O-new-8 and the web-only/desktop-only parts (E1) — needed before the PC key routes, the
  review page and the two web tests can be started (gate G0);
- later and optional: hosting Phase D, and the faster copy through Litestream (needs R2 keys).

- **Morning summary line for LIRA-306.** Redesigned on your N1–N9: the web never pauses; every PC can work offline and
  sends events that the server merges and books once. Two choices need your yes: O-new-7 and O-new-8. The engine, duplicate
  checks, review logic and money preparation can be built and tested on this Mac; the review page and PC routes wait
  for your yes; the PC parts need CI or your Windows PC.

**Owner answers, 2026-10-11 (live):** G0 approved — O-new-7 (offline work credited to the cashier who did it, checked
active + allowed role) and O-new-8 (each PC proves itself with its own admin-issued, revocable device key), and E1.
O-new-3 confirmed (ticked debt already paid online → booked against oldest open debts, leftover as credit, with a note).
O-new-4 confirmed (offline customer with an existing phone → linked to the existing customer). O-new-6 / O-new-9
confirmed (vouchers and catalog changes online-only). Other O-new items stand as decided.

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
