# LiraTek POS — Current Sprint

> **IMPORTANT NOTE — add a test into the e2e file for each ticket implemented to validate the feature.**

> **Last Restructured:** 2026-08-12 (see "How to keep this file honest" below)
> **Status Legend:** `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED` | `NEEDS INTERVIEW` | `PARTIAL`

> **⬆ HIGHEST PRIORITY, updated 2026-09-25: `docs/plans/done_plans/OWNER_NOTES_2026-09-21.md`** — 29
> notes from the customer actually running the shop on the web app. **Implemented and unit-verified
> 2026-09-25** (see the dated section near the end of this file for the full breakdown): the four
> money bugs (D1/#4/#15, #6, #7/LIRA-203, #8/LIRA-204, #10/LIRA-206, #22/LIRA-088, #26/LIRA-215,
> #27/LIRA-217), the Profits-page audit (PA-0..PA-4), the Dashboard chart/tile (DC-1..DC-12), the
> widened **LIRA-219**, and the remaining notes (#11, #13, #16, #19–21, #24, #28, lira-141). All of
> it is **uncommitted** — core/backend/electron/frontend jest, typecheck and lint are green; desktop
> e2e was 310 passed / 3 failed, web e2e 118 passed / 3 failed / 1 skipped, and all 6 failures were
> stale specs, now fixed, still awaiting the owner's re-run. Open: #1 and #25 (customer to confirm), #5 (voice
> note), #17 (parked — owner unsure if it's the rate band or a selling price), #14 slice 3, a
> single-item basket reversal, and two new tickets this batch filed, **LIRA-229** and **LIRA-230**.
> That document outranks `PLAN_OVERVIEW.md` §5 and says so in its own header.
>
> **Superseded banner, kept for the record:** *"HIGHEST PRIORITY (2026-09-11): OMT open-credit
> account epic, LIRA-187 → LIRA-192 — BUILT 2026-09-15, uncommitted, awaiting diff review. ✓
> LIRA-193 — the live money bug in shipped code is now FIXED."* That epic **shipped and its plan
> was archived to `done_plans/` on 2026-09-21** once its confirming web run came back green; the
> "uncommitted, awaiting diff review" wording had been stale for over a week.

---

## How to keep this file honest

This file tracks two things ONLY: (1) genuinely open work, and (2) a short "Recently Closed" window
of context around the current sprint. It does **not** hold multi-month history — that lives in
`docs/plans/done_plans/`.

- **Closed sprints get archived, not deleted.** When a sprint's board is fully (or mostly) closed,
  its ticket bodies move verbatim to `docs/plans/done_plans/SPRINT_N_ARCHIVE_2026-08-12.md`, leaving
  only still-open tickets behind here. See the **Archive Index** at the bottom of this file for what
  moved where. This restructuring (2026-08-12) archived Sprints 1-5 wholesale and the already-closed
  ~80% of Sprint 6, per `docs/plans/todo_plans/SPRINT_INVENTORY_2026-08-12.md` — a read-only audit
  that found 67 of 86 tracked items in this file were already closed history, not backlog, and that
  only 19 were genuinely still open.
- **Spec-name indexes are not ticket boards.** A table mapping `LIRA-NNN` to a `lira-NNN-spec-name`
  e2e spec filename has no Status column, so a naive "not DONE" grep silently miscounts every one of
  its rows as open. That table now lives in `frontend/tests/e2e-electron/README.md`'s coverage index
  (and, verbatim, in the Sprint 1 archive) — not here.
- **`WEB_PARITY_ROADMAP.md` runs its own, independent `lira-NNN` numbering** for e2e spec files,
  assigned chronologically as specs were written — it is NOT the same sequence as this file's
  `LIRA-NNN` ticket IDs, and several numbers collide: 084, 096, 099 and 101 each name two completely
  different, unrelated pieces of work in the two files. `git log --grep=LIRA-0NN` or a plain-text
  search over commit messages can therefore return the WRONG story for those four numbers unless you
  also check commit dates. This collision is exactly what let 6 stale status markers in this file go
  uncorrected for days (see `SPRINT_INVENTORY_2026-08-12.md` §2, §4) — check commit dates, not just
  grep hits, before trusting a ticket's apparent git history.
- **Before marking anything DONE, fix it everywhere it's mentioned** — a ticket's own detail block
  AND any summary board table that also lists it. Two of the six stale markers fixed in this
  restructuring (LIRA-104, LIRA-111) were the same file contradicting itself: the ticket's own detail
  block said TODO while a board 350 lines below it already said DONE.

---

## Recently Closed (2026-08-12)

> Everything below closed **today** (2026-08-12) and is kept here — rather than immediately
> archived — because it is recent enough to still be useful context for anyone picking up related
> work. It will move to the Sprint 6 archive (`docs/plans/done_plans/SPRINT_6_ARCHIVE_2026-08-12.md`)
> in a future pass once it ages out. Ticket bodies below are otherwise verbatim from before this
> restructuring; two carry an explicit correction (LIRA-113's stale status; LIRA-119's supersession
> note) per `docs/plans/todo_plans/SPRINT_INVENTORY_2026-08-12.md` §4.4-4.5.

---

[LIRA-113 - docs/plans/done_plans/CARRIER_LINES_VALIDITY_PLAN.md - done]

---

## LIRA-118: BLOCKER — "Submit to partner" disabled on Custom Services even with a partner selected

| Field                | Value                             |
| -------------------- | --------------------------------- |
| **Epic**             | Custom Services / Partners        |
| **Type**             | Bug - blocker (flow unusable)     |
| **Priority**         | **BLOCKER**                       |
| **Status**           | **DONE** (e586de9) - owner-tested |
| **Affected Modules** | Custom Services                   |
| **Source Plan**      | Owner manual test 2026-08-10      |

### Summary

Owner test: Services page (`/custom-services`), free-text description, cost 8, price 10, **For
Partner ticked** - the only partner in the DB ("test") **was auto-selected** ("Partner: test was
directly selected") - and the **Submit-to-partner button is DISABLED**. So a For-Partner custom
service **cannot be created at all**.

WARNING: **possible regression from today's work.** `cc45227` (plan section 3 slice 1) and `d1a0ad2`
(section 2a) both edited `frontend/src/features/custom-services/pages/CustomServices/index.tsx` and
`CustomServiceRepository`. Establish FIRST whether this is new or pre-existing (check out the commit
before `cc45227` and try the same flow) - that decides fix vs revert.

Candidate causes: the submit-enabled predicate may require a payment method / payment line that the
For-Partner toggle deliberately clears (`setPaymentLines([])`, ~:952-960); or the cost/price
validation; or a guard added in slice 1.

### Acceptance Criteria

- [ ] Determine whether this is a regression from `cc45227`/`d1a0ad2` - state which.
- [ ] For-Partner custom service submits successfully with a partner selected.
- [ ] Rule 17 failing-first test at the layer that would have caught it (a component test asserting
      submit is ENABLED for a valid For-Partner form - note every backend test passed while this
      was broken).

---

## LIRA-119: Settle modal shows "Net payment $0.00" for an LBP commission

| Field                | Value                                  |
| -------------------- | -------------------------------------- |
| **Epic**             | Suppliers / Commission                 |
| **Type**             | Bug - money risk                       |
| **Priority**         | **High**                               |
| **Status**           | **DONE 2026-10-02 (not yet committed)** - see 2026-10-03 verification note below |
| **Affected Modules** | Suppliers (settle), Commission         |
| **Source Plan**      | Owner manual test 2026-08-10           |

### Summary

Owner settled a Katsh bill in RATE mode. The modal computed the commission correctly in LBP:

```
RATE PER UNIT 20000 | CURRENCY [USD|LBP] | COUNT 1
20000 LBP x 1 = 20,000 LBP
Net payment to Katsh:  $0.00
Total Amount:          $0.00
```

Owner's read, consistent with the symptom: the **net payment / total are computed in USD**, so a
20,000 LBP commission lands as $0. Owner: _"the net payment and currency selected by default in
payment should be in LBP."_

**Why this is a money risk rather than cosmetic:** the operator sees $0.00 net and may submit,
potentially settling the wrong amount. Establish what actually posts.

Related to LIRA-112 (`be4143c`), which added `suppliers.commission_rate_currency` and taught the
settle screen to read it for the **commission entry**. The **net-pay/total** side evidently still
assumes USD. Batch settle math is USD-only today by design (`Suppliers/index.tsx` excludes LBP rows)

- likely the root.

### Acceptance Criteria

- [x] Establish what actually POSTS when net shows $0.00 - **ANSWERED: nothing is
      mis-posted.** A bills-only batch genuinely settles 0 cash (`SUPPLIER_OWED_EXPR`'s
      BILL branch is hardcoded 0 - a bill's principal already left via the provider-drawer
      cost leg at creation, never through the settlement ledger). The 20,000 LBP commission
      posts correctly and in full, in LBP, as a cashless `SUPPLIER_PAYS_US` ledger credit.
      **It was a pure display bug** (hardcoded `$`+`currency: "USD"`). Fixed in cccd4ca.

### NOTE - revisit later (owner, 2026-08-10)

The ticket as filed asked for "Net payment: 20,000 LBP". That was **wrong to implement**
literally and was deliberately NOT done: the commission is money the SUPPLIER OWES US (a
credit), never cash we disburse. Rendering it as "Net payment" would invite an operator to
add a matching 20,000 LBP CASH leg and pay the same commission out a second time. Shipped
value is **"0 LBP"** - still zero, but currency-honest instead of a false `$`.

**Still OPEN:** the modal now says "Net payment: 0 LBP" and says NOTHING about the 20,000
the operator just entered - misleading by omission, the same class that started this whole
line of work (LIRA-121 / plan section 5). Proposed: an explicit "Katsh owes you 20,000 LBP"
line in the settle modal. Owner deferred: "we will get back to it later."

- [ ] Net payment + total respect the commission/rate currency; payment currency defaults to it.
- [ ] Rule 17 failing-first; rule 20 net-to-0 preserved.

### Supersession note (2026-08-12, per `docs/plans/todo_plans/SPRINT_INVENTORY_2026-08-12.md` §4.5)

The "Still OPEN" callout above is stale for the case it was filed against. **LIRA-137** (below)
did exactly what was proposed here, for the bills-only shape: "'Total owed'/'Net payment to'
dropped for this shape, replaced by '{supplier} owes you: `<commission>`'." LIRA-137's own metadata
says so explicitly: `Depends On | LIRA-112, LIRA-119 (partial fix, superseded here)`. This ticket's
remaining ask is therefore resolved for its filed scope (Katsh bills). Any true remainder — e.g. the
same "owes you" line once OMT/WHISH gets commission-at-settlement — is now tracked as **LIRA-138**
(Phase 2), not a separate LIRA-119 gap. Status stays **PARTIAL** (not DONE) because the checkbox
above (respecting commission/rate currency + rule 17/20 tests) was never separately proven; it is
kept here rather than archived since the correction is still fresh.

### 2026-10-03 verification (owner decision 2026-10-02 re-raised this ticket's exact scenario)

Re-checked against the CURRENT code (no code change needed — already fully implemented):
`Suppliers/index.tsx`'s `settleNetPayCurrency` already follows the commission currency (LBP
whenever `settleNetPayUsd === 0 && settleEnteredCommissionLbp > 0`), and the payment sheet's
default leg currency (`multiPaymentInput.currency`) already follows the same value — so a Katsh
RATE-mode LBP commission settlement now defaults its payment currency to LBP, exactly as the
owner asked. The bills-only case (the ticket's literal Katsh scenario) is further superseded by
LIRA-137: no "Net payment"/"Total Amount" tender form renders at all for a bills-only batch —
replaced by "{supplier} owes you: 20,000 LBP". Established what POSTS today (guard):
`Suppliers.settleNetPayCurrency.test.tsx` (4 tests) and
`SupplierRepository.commissionAtSettlement.test.ts` (22 tests) both green against the committed
code — no wrong posting found. Status moved PARTIAL → DONE.

---

## LIRA-120: Currency dropdown does not open on Partners Add Credit/Debt (re-opens LIRA-097)

| Field                | Value                                       |
| -------------------- | ------------------------------------------- |
| **Epic**             | Partners / UI                               |
| **Type**             | Bug - feature unusable                      |
| **Priority**         | **High**                                    |
| **Status**           | **DONE** (714837d) - owner-tested OK        |
| **Affected Modules** | Partners (possibly every Select in a modal) |
| **Source Plan**      | Owner manual test 2026-08-10                |

### Summary

Owner: _"clicking on the currency drop down only changes the arrow direction, no dropdown is opening
to be able to select lbp."_

**This supersedes the wrong closure of LIRA-097.** That ticket was closed as "already working"
because the options exist in code - verified present as `{USD, LBP}` at
`frontend/src/features/partners/pages/Partners/index.tsx:549-552` and `:811-814`. They do exist;
they are simply **unreachable**, so the feature is unusable and the closure was wrong in effect.
Lesson recorded: reading an options array is not testing a control.

### Acceptance Criteria

- [x] **ROOT CAUSE (714837d):** `<ListboxOptions anchor="bottom end">` forces headlessui to
      portal the panel to a body-level div where floating-ui positions it `absolute`, so only
      the panel's OWN `z-50` ranked it - and Partners' local `Modal` backdrop is `z-[60]`.
      The click DID toggle open state (hence the chevron flipping); the list rendered BEHIND
      the backdrop. Fixed by raising the panel to `z-[500]` in the shared component.
      **Owner tested 2026-08-10: working.** Also un-broke the System Association and
      Write-Off currency pickers on the same page (same defect).
- [ ] FOLLOW-UP (owner, 2026-08-10): remove the check/tick icon from the option list in the
      USD/LBP dropdown.
- [ ] ~~Root-cause why the `Select` list does not render/open here~~ (portal? z-index inside the modal?
      an overlay swallowing the click? controlled-state bug?).
- [ ] **Check whether the same `Select` fails in other modals** - if it is the shared component,
      this is far wider than Partners.
- [ ] LBP selectable, and an LBP credit/debt books `partner_ledger.currency = 'LBP'`.
- [ ] A test at the layer that would have caught it (interaction, not props).

---

## LIRA-121: For-Partner notice on Custom Services states the opposite of the truth

| Field                | Value                        |
| -------------------- | ---------------------------- |
| **Epic**             | Custom Services / Copy       |
| **Type**             | Bug - misleading copy        |
| **Priority**         | Medium                       |
| **Status**           | **DONE** (e586de9)           |
| **Affected Modules** | Custom Services              |
| **Source Plan**      | Owner manual test 2026-08-10 |

### Summary

The notice currently reads: _"The service's cost, $8.00, **still leaves the General drawer right
now**, the same as a walk-in job."_ **Section 2a (`d1a0ad2`) removed exactly that behaviour** - the
cost no longer moves any drawer.

Sequencing error: the copy was written in `cc45227` under an explicit instruction to describe
_current_ behaviour, and `d1a0ad2` invalidated it one commit later without the copy being revisited.
Misleading copy is what triggered this whole line of work (section 5), so it should not be left.

### Acceptance Criteria

- [ ] Notice states the truth: full price to the partner's tab; **cost affects profit only and moves
      no drawer**.
- [ ] Sweep every other partner/cost notice for the same staleness after section 2a.

---

## LIRA-122: Supplier table shows "Unpaid" on rows where nothing is owed

| Field                | Value                                   |
| -------------------- | --------------------------------------- |
| **Epic**             | Suppliers / Reporting                   |
| **Type**             | Bug - misleading info (no money impact) |
| **Priority**         | Low                                     |
| **Status**           | **DONE** (pending commit)               |
| **Affected Modules** | Suppliers                               |
| **Source Plan**      | Owner manual test 2026-08-10            |

### Summary

Owner sold a Katsh **item** (not a bill) and saw it in the Katsh supplier table as
`SEND | 462,075 LBP | Unpaid`, while the supplier balance correctly read **Settled**.

Owner's reasoning, which is correct: _"in katsh we pay from our own shop balance, nothing is owed.
basically only topping up the katsh balance is what we owe to katsh... if item other than bill, we
dont need to see it in the katsh supplier table. the unpaid is misleading but... not critical, not
affecting the money flow, just misleading info."_

Owner asked to cover **the class**, not just this row: any supplier-table row whose status implies a
debt where none exists.

### Acceptance Criteria

- [ ] Non-bill Katsh/iPick rows either leave the supplier table or stop showing a debt-implying
      status.
- [ ] Audit the same table for other rows implying an obligation that does not exist (prepaid /
      paid-from-own-balance flows).
- [ ] No money-flow change - presentation only. Confirm balances are untouched.

---

## LIRA-123: `yarn test:e2e` silently no-ops - exit 0, zero output, nothing run

| Field                | Value                                          |
| -------------------- | ---------------------------------------------- |
| **Epic**             | Tooling / Verification integrity               |
| **Type**             | Bug - false-green verification                 |
| **Priority**         | **High**                                       |
| **Status**           | **DONE** (db149e6) - see CI correction below   |
| **Affected Modules** | e2e harness (all)                              |
| **Source Plan**      | Found 2026-08-10 while verifying LIRA-118..121 |

### Summary

`yarn test:e2e` **produces zero bytes of output and exits 0 within seconds**, running nothing.
Reproduced three times: twice backgrounded, once in the foreground with a 90s leash.

The suite itself is healthy. Invoking playwright directly works:

```
cd frontend && npx playwright test --config playwright.electron.config.ts --reporter=list
# -> 252 passed (7.2m)
```

`--list` also works through the wrapper, enumerating all 252 specs. Only _execution_ via the
yarn script is silent. The script is
`"test:e2e": "cd frontend && npx playwright test --config playwright.electron.config.ts"`.

**Why this is High and not tooling trivia:** a command that exits 0 without running is
indistinguishable from a pass to any caller that checks the exit code - including CI, agents, and
`| tail` pipelines (a pipe returns _tail's_ status, so even the empty output is masked). Every
"e2e green" in this project that rested on `yarn test:e2e` is therefore **unproven**, not proven.
This ticket was itself only caught because the log was inspected rather than the exit code trusted.

### Acceptance Criteria

- [x] **ROOT CAUSE (db149e6):** the failure is above Node's own `child_process` layer (a
      `--require` spawn hook never fired), i.e. inside yarn's script-dispatch/spawn path when
      the script would spawn Playwright. A direct invocation with no `yarn run`/`yarn
workspace` hop never exhibits it. **Windows dev-machine only.**

### CORRECTION - CI was NOT affected (verified 2026-08-10)

This ticket was filed warning that every past "e2e green" resting on `yarn test:e2e` was
unproven, **including CI's**. That is **half wrong and the wrong half matters**: CI runs on
Ubuntu and was never affected. Verified against real run logs via `gh run view --log` - a
passing run shows `Running 242 tests using 1 worker` / `2 skipped, 240 passed (6.0m)`, and a
failing run shows `6 failed, 225 passed (6.3m)`. Real durations, real counts, real failures.
So the project's CI history of e2e green is intact; only LOCAL Windows runs were vacuous.
The CI step was switched to the direct invocation anyway, as defence in depth.

Also corrected: an intermediate claim that the same defect broke `yarn typecheck`/`yarn lint`
generally. It does not. That conclusion came from reading byte-count instead of ELAPSED TIME -
a clean `tsc` prints zero bytes and exits 0, which is shape-identical to a no-op. Measured:
`yarn workspace @liratek/frontend typecheck` runs 41s, root `yarn typecheck` 120s. The docs
were narrowed before shipping so nobody inherits a warning to distrust reliable commands.

**The durable deliverable is the floor assertion, not the script swap:** `scripts/run-e2e.mjs`
fails when the reported test count is below a floor EVEN IF the exit code was 0. The same
verification-integrity hole was found and closed in `check-tenant-scoping` and
`check-bind-arity`, neither of which asserted it had scanned anything (bind-arity did not even
report a file count - an empty glob passed silently).

- [ ] `yarn test:e2e` either runs the suite with visible output, or fails loudly and non-zero.
- [ ] Audit `test:e2e:web` and every other `yarn` wrapper around a long-running binary for the
      same silent-success mode.
- [ ] CI must fail (not pass) when the harness runs nothing - add a floor assertion on the
      reported spec count.
- [ ] Document the working direct-playwright invocation in the e2e README until fixed.

---

## LIRA-124: THROUGH-partner OMT/Whish RECEIVE pays the customer from no drawer

| Field                | Value                                                                         |
| -------------------- | ----------------------------------------------------------------------------- |
| **Epic**             | Partners / Money posting                                                      |
| **Type**             | Bug - untracked cash outflow                                                  |
| **Priority**         | **High** (latent today, realizes on first use)                                |
| **Status**           | **DONE** (2e9e822)                                                            |
| **Affected Modules** | omt_whish, partners                                                           |
| **Source Plan**      | `docs/plans/ongoing_plans/PARTNER_DISBURSEMENT_MATRIX.md` (22be723), VIOLATES #1 |

### Summary

On a THROUGH-partner OMT/Whish **RECEIVE**, the shop physically hands the customer cash but **no
drawer is debited**. The payout postings at `FinancialServiceRepository.ts:3137-3142`,
`:3253-3257` and `:3270-3276` are all gated on `!skipSystemDrawer`, and
`skipSystemDrawer = isThroughPartner` (`:909`).

This is the owner's own stated scenario (2026-08-10): \*"whish system receive [for partner checked

- through partner] i physically give money to the customer ... yes its from our drawers."\*

**Latent but structurally mandatory.** Zero `THROUGH_%` rows exist in the live DB today, so there
is no historical drift. It cannot be avoided going forward, though: a walk-in transaction on the
shop's secondary system is hard-rejected without a partner (`:966-973`), and the only UI path that
attaches a partner without ticking "For Partner" (`Services/index.tsx:1081`) hardcodes
`partnerMode: "THROUGH"`. It realizes on the shop's first secondary-system RECEIVE.

**Note the correction this ticket embeds:** this was originally diagnosed as a _FOR_-partner gap,
citing the comment at `:3277-3279` ("partner handles the payout, not our cash"). That comment sits
on **unreachable code** - `isForPartner` takes a dedicated early-return branch (`:1867-2188`) that
posts the shop's disbursement via `processReturnLegs("Partner disbursement")` at `:2185` and
returns at `:2188`, so `skipGeneralDrawer` is dead at those gates. FOR-partner is correct; THROUGH
is the broken mirror image. Do not "fix" the FOR path.

Also in scope (VIOLATES #2, same gate): the RECEIVE **fee-on-top collection leg** is dropped -
foregone revenue rather than untracked cash.

### Acceptance Criteria

- [ ] A THROUGH-partner RECEIVE debits the drawer the operator actually paid from, per currency.
- [ ] The system drawer stays untouched (the funds landed in the partner's account, not ours) -
      i.e. fix ONLY the cash/payout side, do not remove `skipSystemDrawer` wholesale.
- [ ] The fee-on-top collection leg posts.
- [ ] Rule 20: create + reverse nets to 0 across every ledger touched, per currency.
- [ ] Rule 17 failing-first, and rule 15 delta+identity assertions (not row position).
- [ ] The stale `:3277-3279` comment is corrected or deleted so the next reader is not misled.

---

## LIRA-125: THROUGH-partner legacy single-method SEND skips the drawer credit

| Field                | Value                                        |
| -------------------- | -------------------------------------------- |
| **Epic**             | Partners / Money posting                     |
| **Type**             | Bug - two code paths disagree                |
| **Priority**         | Medium (latent)                              |
| **Status**           | **DONE** (43c7450)                           |
| **Affected Modules** | omt_whish, partners                          |
| **Source Plan**      | `PARTNER_DISBURSEMENT_MATRIX.md` VIOLATES #3 |

### Summary

For a THROUGH-partner SEND, the **legacy single-`paidByMethod` path** skips the drawer credit
(`FinancialServiceRepository.ts:3033`, `&& !data.partnerId`) while the **modern multi-leg loop**
(`:2866-2904`, no such check) correctly credits it. Same business event, two answers.

Latent: every shipped UI path sends the modern multi-leg shape, so the legacy branch is not
exercised today. It is a trap for any future caller (or an older payload shape) that does.

### Acceptance Criteria

- [ ] Both paths agree, ideally by deleting the legacy branch if nothing can still reach it -
      prove that before deleting.
- [ ] Rule 14: one definition of "does this credit our drawer", not a per-path copy.
- [ ] Rule 17 failing-first.

---

## LIRA-126: THROUGH partner_ledger rows mislabeled WHISH for Binance/iPick/Katsh

| Field                | Value                                                       |
| -------------------- | ----------------------------------------------------------- |
| **Epic**             | Partners / Reporting                                        |
| **Type**             | Bug - wrong label, no money impact                          |
| **Priority**         | Low                                                         |
| **Status**           | **DONE** (43c7450) - no migration needed, zero rows existed |
| **Affected Modules** | partners, reporting                                         |
| **Source Plan**      | `PARTNER_DISBURSEMENT_MATRIX.md` VIOLATES #4                |

### Summary

`FinancialServiceRepository.ts:3507-3510`'s `providerKey` ternary defaults **anything** that is not
OMT/OMT_APP/WHISH/WHISH_APP to `"WHISH"`, so THROUGH-partner BINANCE / iPick / Katsh rows are
written to `partner_ledger.transaction_type` as `THROUGH_WHISH`. No cash is misrouted - the drawers
are correct - but partner reporting attributes the activity to the wrong system.

Interacts with the provider-taxonomy work: a closed provider list is what makes a silent default
tempting. Fix the mapping to be exhaustive and fail loudly on an unmapped provider rather than
defaulting.

### Acceptance Criteria

- [ ] Exhaustive provider -> `THROUGH_*` mapping; an unmapped provider throws rather than defaults.
- [ ] Existing mislabeled rows: decide migrate vs leave (state which, and why).
- [ ] Rule 17 failing-first.

---

## LIRA-127: Secondary-system partner selector hardcodes `provider === "WHISH"`

| Field                | Value                                                                  |
| -------------------- | ---------------------------------------------------------------------- |
| **Epic**             | Partners / OMT-Whish                                                   |
| **Type**             | Bug - asymmetric guard                                                 |
| **Priority**         | Medium                                                                 |
| **Status**           | **DONE** (5980180)                                                     |
| **Affected Modules** | omt_whish, partners                                                    |
| **Source Plan**      | `FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md` section 5b (lines ~268-270) |

### Summary

`frontend/src/features/services/pages/Services/index.tsx` (~:1422-1430) gates the
secondary-system partner requirement on a hardcoded `provider === "WHISH"` instead of
`provider === <the shop's secondary system>`.

The intent is "a transaction on the system the shop does NOT own requires a partner". Written as a
WHISH literal, it only holds for a shop whose base system is OMT. **A shop whose base system is
WHISH has OMT as its secondary system and gets no partner requirement on the OMT tab at all** - the
guard silently does not apply to the tab it should.

Found while investigating the provider taxonomy (section 5b); filed on the owner's instruction
2026-08-10 ("Yea for the provider=whish thing i think its worth a ticket").

Related: the same class of hardcoded-system assumption is what forces "hwelet souria" onto WHISH -
see the taxonomy phases. The correct comparison is against `useShopBase()`'s resolved secondary
system, and after taxonomy phase 4 against the partner's own `system_association`.

### Acceptance Criteria

- [ ] The requirement is derived from the shop's actual base/secondary system, not a WHISH literal.
- [ ] Verified BOTH ways round: base OMT (secondary WHISH) and base WHISH (secondary OMT) - the
      second is the currently-broken direction and must be the one proven.
- [ ] Grep for sibling hardcodes of the same shape (`=== "WHISH"` / `=== "OMT"` in guards or tab
      gating) and report them; `Services/index.tsx:514-519, 1329-1339` and
      `Checkpoint/index.tsx:57-76` are named in section 5b as other `system_association` readers.
- [ ] Rule 17 failing-first at the interaction layer (a props-level assertion will not catch a
      wrong-branch bug - see LIRA-120's wrongly-closed predecessor LIRA-097).

---

## LIRA-128: Confirm on-behalf (FOR) RECEIVE drawer semantics - OMT/Whish vs app-wallet/Binance differ

| Field                | Value                                                              |
| -------------------- | ------------------------------------------------------------------ |
| **Epic**             | Partners / Money posting                                           |
| **Type**             | Question - blocked on shop owner                                   |
| **Priority**         | Medium (no known loss; consistency)                                |
| **Status**           | **RESOLVED** - no change needed; documented in FEATURE_GUIDE 8.1.0 |
| **Affected Modules** | omt_whish, partners                                                |
| **Source Plan**      | `PARTNER_DISBURSEMENT_MATRIX.md` open item                         |

### Summary

A FOR-partner ("on behalf of") RECEIVE posts **differently depending on provider**:

| Provider family                  | What posts at transaction time                                |
| -------------------------------- | ------------------------------------------------------------- |
| **OMT / WHISH** (primary system) | supplier-ledger TOP_UP + partner CREDIT - **no drawer moves** |
| **App wallet / Binance**         | the wallet drawer is **CREDITED** the full amount             |

Owner's description of the flow (2026-08-10): _"OMT received: he calls us and tells us to receive
this OMT transaction and hold on to the money. Not physically hold on to the money, but we will
settle at the end. This receiver of the OMT amount, the amount is what we owe to the partner."_

Owner's provisional answer (2026-08-10), pending confirmation with the shop owner:

> _"im not sure, im asking the shop owner but yes i think drawers doesnt change"_

⇒ **Provisional conclusion: the OMT/Whish behaviour is CORRECT and needs no change.**

**The two behaviours may BOTH be right, for different physical reasons** - this is the hypothesis to
confirm, not an assumed bug:

- An **app wallet / Binance** balance is an asset the shop actually holds. Receiving into it really
  does increase the shop's balance, so crediting that drawer is honest.
- An **OMT/Whish** cash receive is an agent-network operation: nothing lands in a wallet the shop
  holds. The transfer is marked collected, which reduces what the shop owes the provider (the
  TOP_UP entry), and the shop owes the partner instead. No till movement, because no cash moved.

If that holds, there is no bug and this ticket closes as documentation. `FEATURE_GUIDE.md` section
8.1 already documents the OMT/Whish half deliberately ("obligations only ... the partner's later
collection pays out of the PCD").

### Acceptance Criteria

- [ ] Shop owner confirms whether ANY cash physically moves at the moment an on-behalf OMT receive
      is recorded.
- [ ] If no: close as documented-correct; add the app-wallet/Binance rationale to FEATURE_GUIDE
      section 8.1 so the difference reads as deliberate rather than as drift.
- [ ] If yes: this is a second money bug alongside LIRA-124 - the payout must debit the drawer the
      operator paid from, with rule 17 + rule 20 proof.
- [ ] Either way, record the reasoning; the asymmetry currently looks like an inconsistency to any
      reader and will be "fixed" wrongly by someone eventually.

---

## LIRA-129: `TOP_UP` badge and a negative amount contradict each other on screen

| Field                | Value                                                                |
| -------------------- | -------------------------------------------------------------------- |
| **Epic**             | Suppliers / Reporting                                                |
| **Type**             | Bug - misleading display (money is correct)                          |
| **Priority**         | Medium                                                               |
| **Status**           | **DONE** (9082d6c) - one sign rule; 4 of 7 entry_types were affected |
| **Affected Modules** | Suppliers (ledger tab), omt_whish                                    |
| **Source Plan**      | Found closing LIRA-128, 2026-08-10                                   |

### Summary

On a `supplier_ledger` row with `entry_type = 'TOP_UP'` and a **negative** amount, the two
things the operator reads say opposite things:

- `EntryTypeBadge` renders `TOP_UP` in **red** (`Suppliers/index.tsx:135-153`) - reads as
  "debt going UP"
- the amount renders in **green** when negative (`Suppliers/index.tsx:1702`) - reads as
  "debt going DOWN"

Reading it correctly requires already knowing the C5 signed-`TOP_UP` convention, where a RECEIVE
books a negative TOP*UP because it \_reduces* what the shop owes the provider (`grossOwedDelta`).

**NOT partner-specific.** A plain walk-in OMT/WHISH RECEIVE produces the identical row, so this
is on the OMT supplier page during ordinary daily trading - not an edge case.

**Fourth instance of the same class today**, all money-correct and screen-wrong: LIRA-119
($0.00 for a 20,000 LBP commission), LIRA-121 (notice stating the opposite of the truth),
LIRA-122 ("Unpaid" where nothing was owed). Worth asking whether the ledger display needs one
signed-amount presentation rule rather than a fourth point fix.

### Acceptance Criteria

- [ ] Badge and amount agree for a signed `TOP_UP` (e.g. label the direction from the SIGN, not
      the entry type alone - a negative TOP_UP is a reduction).
- [ ] Sweep every `entry_type` that can carry either sign, not just TOP_UP; state which can.
- [ ] **Presentation only** - prove no ledger, drawer or balance value changes.
- [ ] Rule 17 failing-first at the interaction layer (render the real row) - the three prior
      instances of this class were all invisible to backend tests.

---

## LIRA-130: Custom Services history shows a refunded service as live

| Field                | Value                                                             |
| -------------------- | ----------------------------------------------------------------- |
| **Epic**             | Custom Services / Reporting                                       |
| **Type**             | Bug - misleading display (money is correct)                       |
| **Priority**         | **High** (owner-reported; operator cannot tell a refund happened) |
| **Status**           | **DONE** (e47dfa2) - projection fix; the audit spawned LIRA-131   |
| **Affected Modules** | custom_services                                                   |
| **Source Plan**      | Owner report 2026-08-10                                           |

### Summary

Owner created a for-partner custom service ("7welet syria 100$", cost $100 / price $110) and then
refunded it. The **transactions** table is correct - both rows present, original marked `REFUNDED`,
plus a `REFUND ... $-110` row. The **Custom Services history** still shows it as a normal live row:

```
08:58 PM   up $110.00   7welet syria 100$   -   $100.00   $110.00   $10.00   CASH
```

No refund indication at all. Owner: _"Shouldn't we see a refund transaction in the Services.history?"_

**The money is right; the screen is not told.** The refund DOES set the flag - `custom_services` is in
`TransactionRepository._markSourceRefunded`'s whitelist (~:1843-1855), so `is_refunded = 1` and
`refunded_at` are written. The failure is in the read path:

1. `CustomServiceRepository.getColumns()` (:79-81) projects 20 columns and **omits `is_refunded` and
   `refunded_at`** - the frontend cannot see them even if it wanted to.
2. The history query (:541) filters `status != 'voided'` but says nothing about `is_refunded`, so a
   refunded service returns as an ordinary row.
3. `CustomServices/index.tsx` has **zero** references to `is_refunded`.

Second symptom on the same row: the **profit column still shows $10** for a refunded service.
`custom_services.profit_usd` is a GENERATED column (`price - cost`), so it cannot reflect a reversal.
Real profit reporting reads transactions and handles refunds correctly, so the aggregate is right -
only this column lies.

### Design decision (recommended, owner to confirm)

**Mark the existing row; do NOT add a synthetic refund row, and do NOT hide it.**
`custom_services` holds one row per service - the refund lives in `transactions`. Inventing a second
row would fabricate a record that does not exist, and hiding refunded rows would destroy the audit
trail (the service DID happen). A `REFUNDED` badge plus a struck-through/neutralised amount preserves
both truths.

### Acceptance Criteria

- [ ] `is_refunded`/`refunded_at` projected by `getColumns()` and surfaced through the IPC + REST read
      paths identically (rule 19).
- [ ] History marks a refunded service unmistakably; the row is NOT removed.
- [ ] The profit column does not present a live profit for a refunded service.
- [ ] **Presentation only** - prove no ledger, drawer, profit-aggregate or transaction value changes.
- [ ] Rule 17 failing-first at the **interaction layer** (render the real history row). Every prior
      bug of this class was invisible to backend tests.
- [ ] Audit the sibling histories for the same omission: does Recharge / OMT-Whish / Loto /
      Maintenance / Expenses history project and display `is_refunded`? `_markSourceRefunded`'s
      whitelist names 11 tables that carry the flag - report which of their read paths drop it.

### Note - FIFTH instance of one pattern today

LIRA-119 ($0.00 for a 20,000 LBP commission), LIRA-121 (notice stating the opposite of the truth),
LIRA-122 ("Unpaid" where nothing was owed), LIRA-129 (TOP_UP badge contradicting its own sign), and
now this. All money-correct, all screen-wrong, all invisible to 1,900+ backend tests and 252 e2e
specs; every one found by the owner clicking. Treat the audit item above as the real deliverable -
fixing one history while four others silently drop the same flag repeats the pattern.

---

## DECISION LOG: partner-mode derivation — designed, then cancelled (2026-08-10)

**Not a ticket. Recorded so it is not rebuilt.**

A change to derive THROUGH-vs-FOR partner mode from `partners.system_association` (instead of the
hardcoded `partnerMode: "THROUGH"` on the OMT/Whish services page) was scoped, dispatched, and then
**stopped by the owner mid-build and reverted**. Nothing shipped.

**Why it was wrong:** the mismatch it fixes is unreachable. That page's partner selector only renders
on the matching tab and passes `systemFilter={partnerSystem}`, and `PartnerSelector` filters
`p.system_association === systemFilter` — so a Syria-associated partner is **unselectable** on a Whish
transaction. The hardcode is correct by construction.

Syria partners are served through **Custom Services**, which is typed `partnerMode?: "FOR"` and is
already on-behalf. THROUGH is representable in exactly ONE repository; every other partner-aware module
is FOR-only. The owner's rule is therefore already satisfied everywhere with no derivation.

**What was done instead:** the invariant is now documented at the send + consume sites and guarded by an
interaction test, because the coupling was invisible — the hardcode is only safe while that selector
stays system-filtered, and LIRA-127 (`5980180`) had just fixed a case where it wasn't.

**Process lesson:** the rule was reasoned about abstractly without checking whether bad input was
reachable through the UI. Check reachability before building enforcement.

---

## LIRA-131: `is_refunded` dropped from FIVE more module read paths (the audit result)

| Field                | Value                                                           |
| -------------------- | --------------------------------------------------------------- |
| **Epic**             | Reporting / cross-module                                        |
| **Type**             | Bug - misleading display (money correct)                        |
| **Priority**         | **High** (5 modules; same defect the owner hit)                 |
| **Status**           | **DONE** (4710cb8) - all 5 fixed; found a 6th and 7th drop site |
| **Affected Modules** | recharge, omt_whish, exchange, expenses, debts                  |
| **Source Plan**      | The 11-table audit demanded by LIRA-130, run 2026-08-10         |

### Summary

LIRA-130 fixed Custom Services. The audit it required then found the **same defect in five more
modules**: the refund correctly writes `is_refunded` (all 11 tables in
`TransactionRepository._markSourceRefunded`'s whitelist), but the module's read path drops it, so the
history shows a refunded record as live.

**This is not five bugs to discover - it is one bug in five places, and four of them are a ONE-LINE
fix.** The frontend badge code is already written and dead in four of them, starved by the SQL
projection.

| Table                   | Projected?                                                                                             | Frontend ready?                                                                                                                                                                 | Verdict                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `custom_services`       | fixed (e47dfa2)                                                                                        | badge existed; profit neutralised                                                                                                                                               | **DONE**                                                            |
| `recharges`             | **No** - `RechargeRepository.ts:366-368`                                                               | **Yes, dead** - `recharge/components/HistoryModal.tsx:301,332,336-338`                                                                                                          | one-line fix                                                        |
| `financial_services`    | **No** - `FinancialServiceRepository.ts:816-818` (via `getHistory()`:4001-4013 -> `omtHandlers.ts:72`) | **Split**: `services/pages/Services/index.tsx` inline table has NO badge code at all; the shared `recharge/HistoryModal.tsx` (iPick/Katsh/Whish-App/Crypto) has dead badge code | **TWO surfaces** - one needs UI built                               |
| `exchange_transactions` | **No** - `ExchangeRepository.ts:127-152`                                                               | **Yes, dead** - `exchange/.../HistoryModal.tsx:26-27,174,198-200`                                                                                                               | one-line fix                                                        |
| `expenses`              | **No** - `ExpenseRepository.ts:43-45`                                                                  | **Yes, dead** - `expenses/.../HistoryModal.tsx:17,162,179-181`                                                                                                                  | one-line fix                                                        |
| `debt_ledger`           | **No** - `DebtRepository.ts:147-150` (`findClientHistory`:228-235)                                     | **Yes, dead** - `debts/pages/Debts/index.tsx:104,1572,1826`                                                                                                                     | one-line fix (softer: a visible "Refund Reversal" row also appears) |
| `maintenance`           | Yes - `MaintenanceRepository.ts:181-183`                                                               | Yes, list + modal, **with tests**                                                                                                                                               | already correct                                                     |
| `loto_tickets`          | Yes - `LotoTicketRepository.ts:458-464`                                                                | Yes, `TicketHistoryModal.tsx:55,209,238-240`, **with tests**                                                                                                                    | already correct                                                     |
| `supplier_ledger`       | Yes - `SupplierRepository.ts:875-876`                                                                  | Yes                                                                                                                                                                             | already correct                                                     |
| `wallet_exchanges`      | Yes, IPC+REST wired                                                                                    | **No UI consumes it** - `walletExchangeHistory()` has zero callers                                                                                                              | dead plumbing, not a wrong display                                  |
| `drawer_transfers`      | N/A - no module read method                                                                            | Visible only via the unified log, which reads `transactions.status` correctly                                                                                                   | flag is for reversal idempotency only                               |

**Why it looked isolated:** `maintenance`, `loto_tickets` and `supplier_ledger` do it correctly, WITH
tests. So the pattern was invisible - someone built refund display across the app and five read paths
never fed it.

### Acceptance Criteria

- [ ] `recharges` - project `is_refunded`/`refunded_at`; the existing dead badge lights up.
- [ ] `exchange_transactions` - same.
- [ ] `expenses` - same.
- [ ] `debt_ledger` - same.
- [ ] `financial_services` - project it, AND build the missing badge on the OMT/Whish inline table in
      `Services/index.tsx` (the only one of the five needing real UI work).
- [ ] Each with a rule-17 failing-first test at the **interaction layer** - every bug of this class
      this session (LIRA-119, 121, 122, 129, 130) was invisible to backend tests.
- [ ] **Presentation only** - prove no ledger, drawer, profit-aggregate or posting value changes.
- [ ] Where a module's history shows profit, neutralise it on refunded rows as `e47dfa2` did, rather
      than presenting reversed income as live.
- [ ] Steal `maintenance`/`loto_tickets`' existing tests as the pattern - they already got this right.

### Note on scope discipline

Filed as ONE ticket, not five, deliberately. The failure mode here is fixing one module and then
rediscovering the same defect across four more owner reports. The table above is the whole surface;
nothing else in the whitelist is affected.

---

[LIRA-137 - docs/plans/done_plans/BILL_COMMISSION_SETTLEMENT_PLAN.md - done]

---

## Open Board (18 items)

> Every item below is genuinely open per `docs/plans/todo_plans/SPRINT_INVENTORY_2026-08-12.md` §3 —
> verified against source/git history, not against any file's own status marker. Ticket bodies are
> verbatim from before this restructuring (title, priority, status, acceptance criteria, owner
> quotes, commit references unchanged) except where a stale marker is explicitly corrected elsewhere
> in this file. Grouped by priority; original sprint/location noted per row.

| Ticket      | Description                                                                                    | Priority                                                       | Originally in                 |
| ----------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------- |
| LIRA-138    | Generalise the commission-at-settlement drawer top-up (LIRA-137) from Katsh bills to OMT/WHISH | Medium                                                         | Sprint 6                      |
| LIRA-079    | Refund scope (which txn types get Refund) + whether to remove the Void button                  | Medium                                                         | Sprint 4                      |
| LIRA-083    | Custom Services needs a real work-status lifecycle                                             | Medium                                                         | Sprint 4                      |
| LIRA-088    | Signed decrement path for MTC/Alfa provider balance                                            | Medium (likely partially superseded)                           | Sprint 4                      |
| LIRA-099    | Multi-tenant admin/impersonation e2e spec + full-suite proof run                               | Medium                                                         | Sprint 6                      |
| LIRA-101    | Primary Cash Drawer cleanup + verify Suppliers `settleNetPayUsd`                               | Medium                                                         | Sprint 6                      |
| LIRA-116    | Rename the crossed `custom_services`/`omt_whish` module labels + routes                        | **High** (raised 2026-08-22 — has now misled 3 investigations) | Sprint 6                      |
| LIRA-117    | No e2e spec drives the inventory-pick to stock-decrement flow                                  | Medium                                                         | Sprint 6                      |
| LIRA-058    | OMT App topup flow design (dual cash/owed-pool model)                                          | Medium                                                         | Sprint 2                      |
| LIRA-096    | Partners page — remove "Record Transaction"                                                    | Low                                                            | Sprint 5                      |
| LIRA-068    | Mark Transaction "Amount Changed" when edited                                                  | Low                                                            | Sprint 3                      |
| LIRA-075    | Favorite/pin Whish App quick link in home grid                                                 | Low                                                            | Sprint 3                      |
| LIRA-086    | Dashboard checkpoint freshness coloring                                                        | Low                                                            | Sprint 4                      |
| LIRA-054-FU | Binance rows in TransactionsViewer missing directional badge                                   | Low                                                            | Sprint 1 follow-up (orphaned) |
| LIRA-055-FU | Voucher support at session checkout needs `client_id`                                          | Low                                                            | Sprint 1 follow-up (orphaned) |
| LIRA-139    | Sort-by-Amount ignores `amount_lbp` — every LBP-primary row sorts as 0                         | Medium                                                         | Found 2026-08-12              |
| LIRA-140    | Non-till money renders identically to till cash on a settlement row                            | Low                                                            | Found 2026-08-12              |
| LIRA-142    | PM Fee input renders on a For-Partner SEND while the payload forces the fee to 0               | Low                                                            | Found 2026-08-22              |

**Count by priority:** High — 1 · Medium — 11 · Low — 8. **Total: 20.**

---

## LIRA-139: Sort-by-Amount ignores `amount_lbp` — every LBP-primary row sorts as 0

| Field                | Value                                                              |
| -------------------- | ------------------------------------------------------------------ |
| **Epic**             | Transactions / Reporting                                           |
| **Type**             | Bug - pre-existing, table-wide                                     |
| **Priority**         | Medium                                                             |
| **Status** | CLOSED 2026-10-02 (owner confirmed): shipped in 631d0930 (sort by USD equivalent) |
| **Affected Modules** | audit (Transactions page)                                          |
| **Source**           | Found 2026-08-12 during the LIRA-137 render-site sweep (`752e154`) |

> **Note:** Likely shipped in 631d0930 / cab27aa6 — awaiting the owner's confirmation.

### Summary

`getSortValue`'s `"amount_usd"` key in
`frontend/src/features/audit/pages/TransactionsViewer.tsx` reads **only** `row.amount_usd` and ignores
`row.amount_lbp` entirely. So **every LBP-primary transaction sorts as 0** — clicking the Amount header
groups all LBP rows together at one end regardless of their actual size.

This is **older and much wider than LIRA-137**; it affects every LBP row in the table, not just bill
settlements. It surfaced only because the sweep for that ticket enumerated every render/consumer of a
row's amount.

### Why it is not a one-line fix

There is no single number to sort by. A shop runs two live currencies, so the fix requires deciding
what "sort by amount" should MEAN:

- **Convert to one currency** using a rate — but which rate? The row's own stamped
  `exchange_rate`, or today's? Historical rows would re-sort as the rate moves.
- **Sort by the row's primary currency, secondarily by the other** — stable and cheap, but a 1,000,000
  LBP row and a $50 row are then not really comparable.
- **Sort within currency groups** — honest, but changes the table's behaviour from one ordering to two.

### Acceptance Criteria

- [ ] Owner picks the semantics (the three options above, or another).
- [ ] Sorting by Amount orders LBP rows by their actual magnitude under the chosen rule.
- [ ] Mixed USD+LBP rows behave predictably and the rule is documented in the code.
- [ ] Rule 17 failing-first at the interaction layer — sorting is a rendering behaviour and was invisible
      to every existing test.
- [ ] Presentation only; no stored value changes.

---

## LIRA-140: Non-till money renders identically to till cash on a settlement row

| Field                | Value                                                        |
| -------------------- | ------------------------------------------------------------ |
| **Epic**             | Transactions / Reporting                                     |
| **Type**             | UX - missing distinction (money is correct)                  |
| **Priority**         | Low                                                          |
| **Status** | CLOSED 2026-10-02 (owner confirmed): shipped in cab27aa6 (provider-balance inflows marked apart from till cash) |
| **Affected Modules** | audit (Transactions page), suppliers                         |
| **Source**           | Found 2026-08-12 assessing the amber marker during `752e154` |

> **Note:** Likely shipped in 631d0930 / cab27aa6 — awaiting the owner's confirmation.

### Summary

A bills-only Katsh settlement now shows the plain green `↓` "cash in" badge — **visually identical to
an ordinary cash receipt** — even though that money never touched a till. It went into the shop's Katsh
provider balance as a top-up.

There used to be an affordance for exactly this: `isSupplierCredit` renders a distinct **amber `+`**
marker meaning _"a receivable owed to us, not drawer cash."_ It keys on
`type === "SUPPLIER_PAYMENT"` with `is_credit === true`, which only a `SUPPLIER_PAYS_US` ledger entry
stamps — and LIRA-137 (`4fd0ad1`) deliberately stopped booking that entry for bills, replacing it with
the drawer top-up. So the marker is now **unreachable for new bills**.

It is NOT dead code: it still renders correctly for legacy `commission_model = 0` rows already in a
shop's history, and it remains the ready-made hook for LIRA-138. Recommendation was to leave the code
alone — this ticket is only about whether the DISTINCTION deserves a visual affordance again.

### The question for the owner

Should a settlement whose money landed in a provider balance (rather than a till) look different from a
cash receipt on the Transactions page? Both are "money in" and both are correctly recorded — the
question is purely whether the page should say WHERE it landed at a glance.

### Acceptance Criteria

- [ ] Owner decides: restore a distinct marker for provider-balance inflows, or accept the plain "in"
      arrow.
- [ ] If restored: it must cover the LIRA-137 drawer-top-up shape, not just the legacy
      `is_credit` shape, and must not disturb the legacy rows that still use the amber marker.
- [ ] Presentation only.
- [ ] Rule 17 at the interaction layer.

---

## LIRA-114: For-Partner payment section on Services — DONE

| Field                | Value                                         |
| -------------------- | --------------------------------------------- |
| **Epic**             | Services / Partners                           |
| **Type**             | Investigation → likely UX fix                 |
| **Priority**         | Medium                                        |
| **Status**           | **DONE** `fd5444cc` + `aee4d341` (2026-08-22) |
| **Affected Modules** | Financial Services, Custom Services, Partners |
| **Assigned To**      | —                                             |
| **Source Plan**      | Owner report 2026-08-08 ('7welet souria')     |

> ⏭ **Jump to "RESOLVED 2026-08-22" at the end of this ticket first.** The root cause was fixed
> on 2026-08-09; everything between here and there is historical investigation written while it was
> still unknown, and one block of it investigated the wrong module (see LIRA-116).

### Summary

Owner: _"a service for partner called '7welet souria' and payment method debt; it's affecting the
general drawer."_

**The literal scenario does NOT reproduce.** In `FinancialServiceRepository`, a FOR-partner service
carrying a CUSTOMER*ACCOUNT leg is **rejected before any drawer write**
(`assertNoCustomerAccountLeg` → *"A partner financial service cannot carry a CUSTOMER*ACCOUNT
leg"*), and the whole transaction rolls back. 8 new tests + 27 existing partner tests + 5
custom-service partner tests all confirm General delta = 0. (Note: the `DEBT` payment code was
renamed `CUSTOMER_ACCOUNT` in migration v86; the UI label is still "Customer Account (Debt)".)

**Most likely the report is about a different feature**: `CustomServiceRepository`'s FOR-partner
branch posts a **cost outflow** (real money leaving for the provider) while the form still _shows_
a Payment Method selector that is inert in FOR mode — producing exactly the "I chose Debt but the
drawer moved" impression.

### 🔴 CORRECTED 2026-08-09 — the "Services page" is `custom_services`, NOT `omt_whish`

**The module labels and routes are crossed, and it misled two investigations:**

| module key        | UI label       | route              |
| ----------------- | -------------- | ------------------ |
| `custom_services` | **"Services"** | `/custom-services` |
| `omt_whish`       | "OMT/Whish"    | **`/services`**    |

(`electron-app/create_db.sql:1219,1223` — re-resolved 2026-09-23; `:1218,1222` before this
batch inserted a `system_settings` seed row above them.) When the owner said "it's in the **Services** module",
they meant the tile labeled _Services_ — which is **`custom_services`** — not the `/services`
route. A prior investigation "refuted" this ticket on the reasoning _"Services/index.tsx never sets
cost/price, so cost 1008 / price 1010 cannot originate there"_. That reasoning was **correct about
the code and wrong about which page** — `custom_services` DOES have cost/price fields, and the
numbers fit it exactly.

⇒ **The original hypothesis is back: this is `CustomServiceRepository`'s FOR-partner cost outflow.**

**Owner confirmed 2026-08-09:** the transaction WAS entered with the **"For Partner"** checkbox
ticked — _"yes confirmed it was for partner but it acts as through"_. That mismatch (labelled FOR,
behaving like THROUGH) is now the core question of this ticket, not the drawer routing alone.
Owner also confirmed: **keep the checkbox label "For Partner"** — do not rename it.

### ⚑ EARLIER HANDOFF CONTEXT (superseded in part by the correction above)

**The exact scenario, in the owner's words:**

> _"7welet souria is the partner name. It's in the **Services** module… I entered **cost 1008** and
> **price USD 1010** and **payment method customer account**."_

So: **Services page** (`frontend/src/features/services/`, i.e. `FinancialServiceRepository`) — **not**
Custom Services (the owner reports that page isn't even visible to them; the earlier diagnosis
guessed Custom Services and that guess is now **ruled out**). Partner = _7welet souria_.
Cost $1008, price $1010, payment method **Customer Account**. Observed: **General drawer moved.**

**🔴 These are the same numbers as LIRA-115.** The refund report ("customer paid 1010, cost 1008,
refund returned 1008") uses the identical figures — this is very likely **one transaction producing
two symptoms**. Investigate them together; a single root cause may explain both, and fixing one
blind could mask the other.

**What the earlier (pre-clarification) diagnosis established — still valid, don't redo:**

- The `DEBT` payment code was renamed `CUSTOMER_ACCOUNT` in migration v86. The UI label is
  "Customer Account (Debt)". No row for a literal `"DEBT"` code exists.
- **FOR**-partner + a `CUSTOMER_ACCOUNT` leg is **rejected before any drawer write** by
  `assertNoCustomerAccountLeg` (~`FinancialServiceRepository.ts:1806`) — _"A partner financial
  service cannot carry a CUSTOMER_ACCOUNT leg"_ — and the whole `db.transaction` rolls back.
- **THROUGH**-partner: `CUSTOMER_ACCOUNT` legs are explicitly skipped by the drawer-crediting loop
  (`if (p.method === "CUSTOMER_ACCOUNT") continue;`, ~:2769) and booked to `debt_ledger` via
  `bookClientDebtCharge`. General delta 0.
- 8 tests documenting all of the above pass:
  `packages/core/src/repositories/__tests__/FinancialServiceRepository.forPartnerDebtDrawer.test.ts`

**⇒ Leading hypothesis for the next agent: the drawer movement is NOT the payment method — it's the
COST leg.** With cost $1008 the cost/price flow (`useCostPriceFlow`,
~`FinancialServiceRepository.ts:2093-2247`) posts a cost outflow to the provider's drawer. If the
provider/partner has no mapped drawer, `paymentMethodToDrawerName` /
`FALLBACK_DRAWER_MAP[...] ?? "General"` (`packages/core/src/utils/payments.ts`) **falls back to
General**. That would put $1008 on General while the operator's chosen payment method (Customer
Account) correctly moved nothing — matching the report precisely, and explaining why the refund
also revolves around 1008.

### What the next agent must do

- [ ] Confirm which `partner_mode` the real transaction used (FOR vs THROUGH) — the two paths are
      completely different and only one can be the subject.
- [ ] Trace the $1008 cost leg's drawer resolution end-to-end and prove (test) whether it lands in
      General via the unmapped-provider fallback.
- [ ] Decide the accounting: for a partner service with a cost, **should** the cost outflow hit
      General, a partner/provider drawer, or the partner ledger? Owner-facing question.
- [ ] Investigate **jointly with LIRA-115** — same figures, probably the same transaction.

### Separately flagged (own decision, don't lose it)

The THROUGH-partner multi-leg loop credits General/PCD for real customer cash, while a stale
single-leg path claims it should be skipped. One of the two is wrong; lock in whichever the owner
confirms with a regression test. **Not changed this pass — needs the owner's decision, not a guess.**

### ⚑ Joint investigation with LIRA-115, resolved (2026-08-09)

**`same_transaction`: NOT the same transaction.** Traced every shipped UI path that can reach the
Services cost/price flow (KatchForm, FinancialForm, CryptoForm, OmtWhishAppTransferForm,
`Services/index.tsx`): every one of them hardcodes `partnerMode: "FOR"` for a partner selection, and
a FOR-partner cost/price sale **forbids ALL payment legs outright** (`FinancialServiceRepository.ts`
~1864-1868, _"the full selling price goes on the partner's tab"_) — so a partner-carrying cost/price
item can never reach the session-basket/`deferPayment` path LIRA-115 actually reproduces (that path
requires NO partner at all, per its own repro fixture). The owner's two reports share the SAME
round numbers (cost 1008, price 1010) most likely because they explored the SAME cost/price flow
twice — once with a partner attached, once inside a session basket — and reported both under one
mental model ("the same sale"), not because one `createTransaction()` call produced both symptoms.

**The literal LIRA-114 scenario (partner + cost/price + CUSTOMER_ACCOUNT) does not reproduce, and
the code is behaving as designed — confirmed with a new regression test, no money changed:**
`FinancialServiceRepository.forPartnerDebtDrawer.test.ts` gained a `"LIRA-114"` describe block
(2 new tests) with the owner's EXACT figures (iPick, cost 1008, price 1010, partner "7welet souria"):

1. Attaching a CUSTOMER*ACCOUNT leg (any IN-direction payment leg, in fact — see below) to a
   FOR-partner cost/price sale throws **before any drawer write** — General/iPick delta 0, zero rows
   written. The rejecting guard is actually `assertNoCounterPayment` (*"a partner financial service
   takes no counter payment"\_), not `assertNoCustomerAccountLeg` — a FOR-partner cost/price sale
   rejects the customer "paying" via ANY method at all (there is no walk-in customer on a partner
   sale), so the operator's payment-method choice is never even evaluated. This is a MORE total
   rejection than the ticket's original hypothesis, not a narrower one.
2. The only way a FOR-partner cost/price sale succeeds (no payment legs at all) correctly debits the
   cost from the **provider's own drawer** (iPick, -1008) — never General — and books the full price
   (1010) as a DEBIT on `partner_ledger` (`FOR_IPICK`). This is the shop's own stock being consumed;
   General movement would be the ACTUAL bug. `mapDrawerName` only falls back to `"General"` for
   provider `"BOB"`/`"OTHER"`, which no shipped form ever sends (confirmed by the original diagnosis,
   not re-verified this pass — grep still shows zero matches in `frontend/src`).

**Conclusion: no money-routing bug found for the literal report; no code change made to drawer
routing.** Per this ticket's own decision tree ("if $1008 movement IS correct accounting, do NOT
change the money"), the cost/price flow's behavior for every provider actually reachable from the
UI is correct, and is now locked in by the two new tests above. The genuinely inconsistent behavior
that WAS found (the "Separately flagged" THROUGH-partner note above) is real but requires an owner
decision this pass didn't have — left untouched, as instructed.

**Recommended next step (not done this pass — needs the owner, not more code archaeology):** get the
owner's exact click path (or a screen recording) for the ORIGINAL "affecting the general drawer"
report. Every reachable code path was traced and none reproduces it verbatim; without the actual
click path, any further "fix" would be guessing at a UX explanation for behavior that may not even be
this ticket's mechanism.

**Status: investigation closed for the literal report (correct-accounting, tests lock it in);
NEEDS INTERVIEW remains open only for (a) the owner's exact click path and (b) the THROUGH-partner
inconsistency decision.**

### ✅ RESOLVED 2026-08-22 — the root cause was already fixed; only the UI gating remained

**Read this first — the sections above are historical.** Everything below them was written while
the cause was still unknown. It is now known, and it was fixed almost two weeks before this entry:

- The reported symptom (For Partner ticked, cost 1008, General drops) was **Custom Services posting
  the cost as a hardcoded General cash outflow**. `d1a0ad24` (2026-08-09) removed it — cost is a
  profit input only now. `cc452278` closed the follow-on hole where a stale `paid_by` was stamped
  into `metadata_json` as if it had executed. Both are on `main`.
- The 2026-08-09 "joint investigation" block above traced `FinancialServiceRepository` — the
  `/services` route, i.e. the **`omt_whish`** module. That is the crossed-name trap LIRA-116
  documents, hit for the **third** time: the owner's page is `custom_services`. Its conclusions
  about `FinancialServiceRepository` are accurate but were about the wrong module.

**What was genuinely still open, verified against source 2026-08-22:** plan §4 item 1 — the
For-Partner payment section on the OMT/Whish Services page.

- The picker has no `forPartner` gate: `paymentMethods` is the unfiltered `allPaymentMethods` on
  SEND (`Services/index.tsx:2187`), so Customer Account is selectable; `autoDebtRemainder`
  (`:2161`) is likewise ungated and can add that leg unprompted; the label says "Payment"
  (`:2199`) though on a For-Partner SEND the method means **which drawer funds the payout**.
- Picking it **hard-rejects the whole transaction** — the OUT leg lands in `returnLegs`
  (`partitionLegs`, `FinancialServiceRepository.ts:1879`) and `:2116` throws before any drawer
  write. **A UX defect, not a money bug** — no money is ever misrouted.
- On a For-Partner RECEIVE the section is shown but the choice is **silently discarded**
  (`payments: []`, `:1085`) with no cue.

**Owner decision 2026-08-22** — the plan's original "hide the payment UI everywhere" rule is wrong
for Services SEND (it would discard a real drawer choice). Approved instead: SEND keeps the picker,
relabelled **"Paid from"** and filtered to `drawerAffectingMethods`, with a notice stating both
sides; RECEIVE hides it behind a notice. Full rationale in
`docs/plans/done_plans/FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md` §4's decision block.

**✅ Implemented 2026-08-22 (same day as the decision above):** `fd5444cc` ("For-Partner payment
section stops offering what the backend rejects") shipped the SEND/RECEIVE gating decided just
above; `aee4d341` added an e2e spec driving the real For-Partner Services form (UI and money).
Ticket closed — DONE.

---

## LIRA-138: Generalise the commission-at-settlement drawer top-up to OMT/WHISH (Phase 2)

| Field                | Value                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| **Epic**             | Suppliers / Commission-at-settlement                                                            |
| **Type**             | Feature (deferred generalisation)                                                               |
| **Priority**         | Medium                                                                                          |
| **Status** | CLOSED 2026-10-03, no build needed. The owner confirmed OMT/Whish never pays commission separately: it is deducted from what the shop pays ("INCLUDES INTRA SHARES" on the OMT statement SMS). The shipped settle flow already handles this (gross payable, commission off the payment, profit at settlement / deferred per D17). See LIRA-255 for the statement check |
| **Affected Modules** | Suppliers (OMT/WHISH), `SupplierRepository`                                                     |
| **Assigned To**      | —                                                                                               |
| **Depends On**       | LIRA-137 (DONE), `COMMISSION_AT_SETTLEMENT_PLAN.md` Phase 2 (OMT/WHISH gross flip, not shipped) |
| **Source Plan**      | `COMMISSION_AT_SETTLEMENT_PLAN.md` D13; `BILL_COMMISSION_SETTLEMENT_PLAN.md` §4                 |

### Summary

LIRA-137 shipped the "commission books as a real provider-drawer top-up, profit-stamped, no
supplier debt" model, but scoped it **narrowly to Katsh bills** (owner decision, 2026-08-11) — the
new path in `SupplierRepository._bookCommissionAtSettlement` is gated on
`isBillsOnlyBatch` (every eligible row's `service_type === "BILL"`), not the broader
`isNewModelBatch`/`commission_model === 1`. Today that distinction is invisible (only BILL rows are
ever born `commission_model = 1`), but once `COMMISSION_AT_SETTLEMENT_PLAN.md`'s Phase 2 (the
OMT/WHISH gross-payable flip) ships and OMT/WHISH rows start earning `commission_model = 1` too,
this ticket is what extends the SAME drawer-top-up/profit-stamp treatment to them.

### Why this wasn't just built alongside LIRA-137

1. Phase 2 (the OMT/WHISH gross flip itself) has not shipped — there is no `commission_model = 1`
   OMT/WHISH row to design against yet.
2. OMT/WHISH's commission is a provider FEE cut, collected from the customer at transaction time,
   not a bills-style reward funded separately by the provider after the fact — whether "drawer
   top-up, no debt" is the right model for THAT money is a genuinely open design question, not a
   mechanical copy of LIRA-137's fix.
3. The owner was explicit: narrow scope now, file the rest.

### Acceptance criteria (draft, once Phase 2 ships)

- [ ] Decide which drawer an OMT/WHISH commission-at-settlement credit lands in (the PCD? the
      supplier's own float, if any is reintroduced?) — this is a NEW decision, not inherited from
      LIRA-137.
- [ ] Extend `_bookCommissionAtSettlement`'s branch condition (or replace it with a per-provider
      posting strategy) so OMT/WHISH rows take the equivalent real-posting path.
- [ ] Prove rule 20 (create → settle → void nets to 0, per currency, per drawer, per profit) for the
      OMT/WHISH case the same way `FinancialServiceRepository.billsSettlement.test.ts` proved it for
      Katsh.
- [ ] Prove the Katsh/bills path stays byte-for-byte unchanged (it already has its own regression
      test from LIRA-137 — re-run it, don't just trust it).

---

## LIRA-079: Refund Scope + Void Button Decision

| Field                | Value                      |
| -------------------- | -------------------------- |
| **Epic**             | Transactions               |
| **Type**             | Enhancement / Decision     |
| **Priority**         | Medium                     |
| **Status** | DONE 2026-10-02 (not yet committed) — verified: before this change, the Transactions page's Actions cell showed a bare "—" for all 24 `NON_REVERSIBLE_TRANSACTION_TYPES` members with no explanation (`frontend/src/features/audit/components/TransactionCells.tsx` `ActionsCell`). Added `frontend/src/features/audit/nonReversibleReasons.ts` — one plain-language "where to reverse it instead" message per type (sourced from each type's own rule-20 rationale comment in `transactionTypes.ts`), wired into `ActionsCell` as a "Can't refund here" label with the full explanation as its tooltip (falls back to "—" for any future type not yet classified, same as before). A guard test (`nonReversibleReasons.guard.test.ts`) pins the message map 1:1 against core's `NON_REVERSIBLE_TRANSACTION_TYPES` (24/24, no missing/stale entries) the same way `actionGating.guard.test.ts` already pins `ACTIONABLE_TYPES`. Also fixed a comment in `transactionTypes.ts` (PARTNER_ADJUSTMENT) that still pointed at the "Record Tx" button LIRA-096 just removed. Void stays next to Refund, unchanged — pure additive UI, no backend/IPC/REST change needed (reads only `row.type`, already present on both transports, rule 19 satisfied for free). `yarn workspace @liratek/frontend typecheck` (27.5s), `yarn workspace @liratek/core typecheck` (10.4s), eslint on touched files, and `src/features/audit/**` (35 suites / 368 tests) all green. |
| **Affected Modules** | Audit > TransactionsViewer |
| **Assigned To**      | —                          |
| **Depends On**       | —                          |

### Summary

Owner notes 21b/21c and the second (duplicate-labeled) note 27 ("second 27"). The owner wants
refund available on "all" transaction types, and separately raised whether the Void button
should be removed altogether (possibly superseded by Refund). Both conflict with the deliberate
`NON_REVERSIBLE_TRANSACTION_TYPES` gate (`packages/core/src/constants/transactionTypes.ts`),
which exists because several types (LOTO, LOTO_CASH_PRIZE, LOTO_SETTLEMENT,
SUPPLIER_SETTLEMENT, RECHARGE_TOPUP, REFUND, and the partner-ledger types) have side effects the
generic reversal path cannot safely undo. Blocked on owner answers before any code changes.

### Open Questions (owner interview required)

- [ ] Which transaction types actually need refund support — all of them, or a defined subset excluding the types the gate protects for a real reason?
- [ ] Keep the Void button alongside Refund, or remove it? If removed, does every current Void-only use case have a Refund-based replacement?

### Acceptance Criteria

- [ ] _(To be defined after interview)_

---

## LIRA-083: Service Status Workflow for Custom Services

| Field                | Value           |
| -------------------- | --------------- |
| **Epic**             | Custom Services |
| **Type**             | Feature         |
| **Priority**         | Medium          |
| **Status**           | DONE 2026-10-03 (not yet committed) — owner decisions: four states Received -> In_Progress -> Ready -> Delivered (matching Maintenance's own `status` vocabulary exactly, not the existing `fulfillment_status`/LIRA-155 enum which is a different, strict-transition insurance concept reserved for that ticket); freeform transitions, any value to any value (mirrors `MaintenanceRepository.updateJob`'s own whole-form-resubmit model, not `insuranceFulfillment.ts`'s forward-only one — a single-operator housekeeping field doesn't need enforcement); every pre-migration row backfills to 'Delivered' (new rows default 'Received'). Migration v190 (`packages/core/src/db/migrations/index.ts`, mirrored in `electron-app/create_db.sql`) adds `custom_services.work_status` via ALTER with NO CHECK constraint (SQLite limitation, same convention as v185's `direction`), vocabulary enforced at the Zod layer (`updateCustomServiceWorkStatusSchema`, `packages/core/src/validators/customService.ts`) via the one shared definition `packages/core/src/utils/customServiceWorkStatus.ts` (exported from both `index.ts` and `browser.ts`). Dual-transport (rule 19): IPC `custom-services:set-work-status` (`electron-app/handlers/customServiceHandlers.ts`) + REST `POST /api/custom-services/work-status` (`backend/src/api/customServices.ts`), both calling `CustomServiceService.setWorkStatus`; `getAll`/`getServices`/the list IPC/REST routes gained an optional `workStatus` filter too. Frontend: `HistoryModal.tsx` gained a "Work Status" column (a per-row `<select>`, disabled once refunded) plus an "All work status" filter dropdown; `CustomServiceRepository`/`CustomServiceService`/preload/`electron.d.ts`/`backendApi.ts`/`ElectronApiAdapter.ts`/`packages/ui/src/api/types.ts` all updated (rules 12, 21). Caught and fixed along the way: 7 pre-existing core test fixtures' hand-rolled in-memory `custom_services` schemas were missing the new column (the documented "test schemas silently void whole files" trap) — patched; and `WORK_STATUS_LABELS`' derived-not-literal construction exists specifically to avoid tripping `maintenanceInProgressLiteral.guard.test.ts`, a core-wide guard against a quoted "In Progress" (space) string (the real value is `In_Progress`, underscore) — first attempt used a hand-typed label and was caught red by this pre-existing guard; fixed by deriving the label (`s.replace(/_/g, " ")`) instead of spelling it out, which also means the guard's regex never appears literally anywhere in this ticket's own source. Verified: `packages/core` full jest (469 suites / 4557 tests, 85.7s) green; `packages/core`, `backend`, `electron-app`, `frontend` (`tsconfig.app.json`, 15.4s), `packages/ui` typechecks all clean; `backend` customServices API tests, `electron-app` customServiceHandlers tests, and `frontend/src/features/custom-services` (11 suites / 68 tests, including the new `CustomServices.workStatus.test.tsx`) all green — one pre-existing frontend test (`CustomServices.insuranceFulfillmentHistory.test.tsx`) needed a `{ selector: "span" }` disambiguator since the new column's "Delivered" `<option>` is now a second text match in the same row; not a regression, a legitimately more specific query. E2E skipped per this session's lean-test-routine owner rule (no e2e this pass) — flagged for the owner/next e2e pass; no spec file added or touched. |
| **Affected Modules** | Custom Services |
| **Assigned To**      | —               |
| **Depends On**       | —               |

### Summary

Owner note 15 ("sejel 3adli" — a paperwork-style custom service). `custom_services.status` today
only ever transitions between `completed` and `voided` (an accounting-only status) — there is no
work-in-progress lifecycle like Maintenance's `Received → In_Progress → Ready → Delivered`. Add a
genuine status workflow so a custom service (e.g. official-paper processing) can be tracked as it
progresses.

### Acceptance Criteria

- [ ] New multi-state work-status field, separate from the existing accounting status (proposed: `pending → in_progress → done`; confirm exact states with owner before finalizing)
- [ ] Status editable from the Custom Services page
- [ ] Status filterable in the list view
- [ ] Status visible in history (HistoryModal)
- [ ] Migration adds the column with a safe default (no `CURRENT_TIMESTAMP` default on an ALTER, per the v104 lesson)
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                            | Change                             |
| -------- | --------------------------------------------------------------- | ---------------------------------- |
| Database | `packages/core/src/db/migrations/index.ts`                      | New migration — work-status column |
| Database | `electron-app/create_db.sql`                                    | Mirror                             |
| Backend  | `packages/core/src/repositories/CustomServiceRepository.ts`     | Status transitions + filter        |
| Frontend | `frontend/src/features/custom-services/pages/CustomServices/**` | Status UI, filter, history display |

---

## LIRA-084: Partial Keep-Change

| Field                | Value                                            |
| -------------------- | ------------------------------------------------ |
| **Epic**             | Payments                                         |
| **Type**             | Enhancement                                      |
| **Priority**         | Medium                                           |
| **Status**           | DONE 2026-10-02 (not yet committed)              |
| **Affected Modules** | MultiPaymentInput (shared)                       |
| **Assigned To**      | —                                                |
| **Depends On**       | T3 Keep Change (shipped — this is the follow-up) |

### Summary

Owner note 17. `keepChange` in `MultiPaymentInput` is currently all-or-nothing — the operator
either keeps the entire computed change or returns all of it. The owner wants to split it: e.g.
of a 140,000 LBP change, return 100,000 LBP and keep 40,000 on the customer's account.

### Acceptance Criteria

- [x] Operator can keep a PARTIAL amount of the change, not just all-or-nothing — the CASH return
      fields (`return-usd`/`return-lbp`) stay LIVE while "Keep change" is active (reset to 0/full-keep
      the moment the toggle turns on, matching the old default exactly); whatever the operator types
      there is returned, the rest is kept.
- [x] The kept portion books exactly like today's full-keep (same `onKeptChange` → profit path)
- [x] The OUT (return) legs reflect only the amount actually returned (clamped so a typo can never
      return more than the drawer actually received)
- [x] Works independently per currency (USD and LBP each reduce on their own typed amount)
- [x] Owner decision 2026-10-02 (same-day addendum): where the kept part goes depends on the
      selected payment method — CUSTOMER_ACCOUNT already credits the client's account in full
      (today's existing non-cash leg, unaffected by this ticket — no separate plumbing needed, see
      `MultiPaymentInput.tsx`'s `returnLegsValue` doc); the "Keep change" toggle itself only ever
      renders for a CASH return (hidden for every other method), since only cash has a "keep as
      profit vs. hand back" choice to make.
- [x] Component test covering the partial-keep math — 7 new tests in
      `frontend/src/shared/components/__tests__/MultiPaymentInput.test.tsx` (the owner's own
      140,000/100,000/40,000 LBP example, per-currency independence, clamping, restore-on-exit,
      CASH-only gating) — not proven failing-first (written after the fix landed in the same
      change; labelled per rule 17)
- [x] Repository test covering the resulting legs — no repository change was needed: the OUT legs
      this component emits are ordinary `direction: "OUT"` `PaymentLine`s every money repository's
      existing shared end-of-transaction loop (rule 16) already debits correctly; the full existing
      `MultiPaymentInput.test.tsx` suite (71 tests, including the pre-existing T3 full-keep tests)
      stays green, and every module consumer's own keep-change test
      (`Maintenance.keptChangePayload`, `StatsCards.keptChange`, `Recharge.cryptoFieldsTabSwitch`,
      `CustomServices.profitDisplay`) was re-run and is unaffected.
- [x] Typecheck and lint pass (frontend + packages/ui, 0 errors/0 new warnings)

### Files to Modify

| Layer    | File                                                  | Change                        |
| -------- | ----------------------------------------------------- | ----------------------------- |
| Frontend | `packages/ui/src/components/ui/MultiPaymentInput.tsx` | Partial keep-change UI + math |

---

## LIRA-087: Product-Supplier — Record Debt Now, Attach Products Later

| Field                | Value                 |
| -------------------- | --------------------- |
| **Epic**             | Suppliers / Inventory |
| **Type**             | Feature               |
| **Priority**         | Medium                |
| **Status**           | DONE 2026-10-02 (not yet committed) — migration v189 |
| **Affected Modules** | Suppliers, Inventory  |
| **Assigned To**      | —                     |
| **Depends On**       | —                     |

### Summary

Owner note 31. Restocking already-received goods currently risks double-booking supplier debt:
there is no way to record a supplier debt without immediately tying it to specific inventory
items. Add a flow to record the debt first, then attach the related products to it later.

### Acceptance Criteria

- [x] Record a supplier debt entry without any line items — migration v189 adds a new
      `supplier_ledger.entry_type = 'RECORDED_DEBT'` (amount/currency/note only) plus
      `supplier_ledger.attached_at` (NULL = open); `SupplierRepository.recordDebt` + Suppliers
      page's new "Record Debt" button (product suppliers only — mirrors "Add Credit / Debt",
      company suppliers only).
- [x] Later attach the related products to that recorded debt —
      `ProductRepository.receiveStock`'s new `attach_to_recorded_debt_id` param (Inventory's
      restock modal, new "Attach to a recorded debt" picker, populated from
      `SupplierRepository.getOpenRecordedDebts`); validated (right supplier, still open, not
      voided) by `SupplierRepository.attachRecordedDebtToIntake`.
- [x] No duplicate debt created when products are attached after the fact — the attach path skips
      `recordStockIntake` entirely and links the new FIFO batch's `ledger_entry_id`/
      `transaction_id` straight to the pre-existing recorded-debt row.
- [x] Ledger stays consistent (balances unaffected by the two-step flow vs. the one-step flow) —
      proven: `SupplierRepository.stockIntake.test.ts`'s new "records a debt... attaching stock
      books NO second ledger row" test asserts the two-step balance is byte-identical to the
      one-step flow (10 × $5 = $50, ONE ledger row total).
- [x] Void/reversal owner (rule 20, owner decision 2026-10-02) — voiding a RECORDED_DEBT
      transaction reuses `TransactionRepository._reverseSupplierStockIntake` (type-widened, rule
      14): unattached → pure ledger soft-void (balance nets to 0); attached → deletes the linked
      batch and nets to 0, same as voiding a one-step intake; refuses the void once a unit from the
      attached batch has already been sold, same guard as a one-step intake. 5 failing-first-proven
      tests (brand-new methods — every case TypeErrors "is not a function" pre-change) in
      `SupplierRepository.stockIntake.test.ts`, including both rule-20 nets-to-0 proofs and the
      already-sold refusal.
- [x] Typecheck and lint pass — core/electron-app/frontend/backend all 0 errors; eslint 0 errors
      (pre-existing warnings only, threshold unchanged)

### Files to Modify (as built)

| Layer    | File                                                                       | Change                                                           |
| -------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Database | `packages/core/src/db/migrations/index.ts`, `electron-app/create_db.sql`   | Migration v189: `supplier_ledger.entry_type` widened + `attached_at` column |
| Backend  | `packages/core/src/repositories/{SupplierRepository,ProductRepository}.ts`, `TransactionRepository.ts` (void reuse), `constants/transactionTypes.ts`, `services/{SupplierService,InventoryService}.ts`, `validators/{supplier,inventory}.ts` | Two-step debt→attach flow, dual-transport (IPC `suppliers:record-debt`/`suppliers:open-recorded-debts`, REST `/api/suppliers/:id/record-debt`+`/recorded-debts`, `/api/inventory/products/:id/receive-stock` reused as-is via the shared schema) |
| Frontend | `frontend/src/features/suppliers/{pages/Suppliers/index.tsx,hooks/useSuppliers.ts}`, `frontend/src/features/inventory/{components/AdjustStockModal.tsx,hooks/useStockAdjustments.ts}`, `frontend/src/api/{backendApi.ts,ElectronApiAdapter.ts}`, `packages/ui/src/api/types.ts`, `frontend/src/types/electron.d.ts`, `electron-app/{preload.ts,schemas/index.ts,handlers/supplierHandlers.ts}` | "Record Debt" modal (Suppliers), "Attach to a recorded debt" picker (Inventory restock modal), full dual-transport wiring |

---

## LIRA-088: MTC/Alfa Provider-Balance Decrement Adjustment

| Field                | Value                |
| -------------------- | -------------------- |
| **Epic**             | Recharge             |
| **Type**             | Feature              |
| **Priority**         | Medium               |
| **Status**           | DONE 2026-09-25 (uncommitted batch) — built as #21's shop-line checkbox (buy back vs charge the customer) + #22's signed decrement, per `OWNER_NOTES_REMAINING_BUILD.md`; unit/typecheck/lint green |
| **Affected Modules** | Recharge > MTC, Alfa |
| **Assigned To**      | —                    |
| **Depends On**       | —                    |

### Summary

Owner note 4. MTC/Alfa top-up paths (`RechargeRepository.ts`) force positive amounts via
`Math.abs(data.amount)` — there is no way to record the shop consuming its own provider credit
(e.g. using the shop's phone line) as a signed decrement. Note: the "buy credits from customer"
half of the owner's ask already exists (`topUpFromCustomer`) — this ticket is only the decrement
half.

**2026-07-20 amendment:** the W6.a carrier-lines work (`CarrierLineService.updateBalance`,
drawer-free by design) may already cover this if the owner meant the shop-SIM credits reading.
If they meant the _resale_ provider-drawer balance, the decrement gap remains. Downgraded to
NEEDS INTERVIEW — confirm which balance the owner meant before building
(see `docs/plans/ongoing_plans/OWNER_NOTES_TASK_PLAN.md` §B).

### Acceptance Criteria

- [ ] A signed/decrement adjustment path exists for MTC/Alfa provider balance
- [ ] Does not move any cash drawer (informational/internal consumption, not a customer transaction)
- [ ] Audit trail records who/when/how much
- [ ] Tests covering the decrement path
- [ ] Typecheck and lint pass

### Files to Modify

| Layer   | File                                                   | Change                             |
| ------- | ------------------------------------------------------ | ---------------------------------- |
| Backend | `packages/core/src/repositories/RechargeRepository.ts` | Signed decrement adjustment method |

---

## LIRA-099: Multi-tenant — admin/impersonation e2e spec + final full-suite proof

| Field                | Value                                                                        |
| -------------------- | ---------------------------------------------------------------------------- |
| **Epic**             | Multi-Tenant / Admin                                                         |
| **Type**             | Test                                                                         |
| **Priority**         | Medium                                                                       |
| **Status**           | DONE 2026-10-03 (WP9 e2e spec only — the full-suite proof item is explicitly out of scope here, see note below) — `frontend/tests/e2e-web/lira-web-038-admin-impersonation.spec.ts`: seeded super_admin logs in through the real UI, provisions a tenant via the real `AddTenantModal`, "Connect as admin" opens a real new tab carrying the handoff, `ImpersonationBanner` renders, a write made under the impersonation token lands ONLY in the target tenant (REST isolation check against tenant 1), the audit trail is proven against the SHIPPED contract (platform + shop-note `IMPERSONATION_START` rows, `impersonator_id` always NULL by design — B-D3 — actor identity lives in `metadata.impersonatorUserId`), and Disconnect returns the impersonated tab to `/login` while the original super-admin tab stays authenticated. Web: 2/2 passed. Also fixed a real test-harness gap: `playwright.web.config.ts`'s webServer didn't pin `APP_BASE_DOMAIN`, so a developer's own `backend/.env` (`APP_BASE_DOMAIN=liratek.shop`) leaked in and made the impersonation handoff navigate to an unreachable real subdomain — now pinned to `""` like the backend jest suite already pins it. |
| **Affected Modules** | Admin, Multi-Tenant                                                          |
| **Assigned To**      | —                                                                            |
| **Depends On**       | —                                                                            |
| **Source Plan**      | `docs/plans/todo_plans/MULTI_TENANT_IMPLEMENTATION_PLAN.md` (WP9, last item) |

### Summary

Every other work package (WP1-WP8, WP10a/c) is shipped and merged — confirmed via `git log`,
`check-tenant-scoping` run live (647 statements, 0 violations), and existing WP2/WP5/WP6/WP8 test
files. WP9, the dedicated end-to-end proof, was never written: no spec anywhere drives super-admin
login → provision a tenant → impersonate → verify data isolation → disconnect through a real
browser (`impersonat` has zero hits across all of `frontend/tests/`).

### Acceptance Criteria

- [x] `frontend/tests/e2e-web/lira-web-038-admin-impersonation.spec.ts` (named `-038`, the next free
      number at the time — not `-020`): super-admin login → `/admin/tenants` list renders → provision a
      tenant via `AddTenantModal` → "Connect as admin" → `ImpersonationBanner` shows the right tenant →
      create a row (a partner, over REST on the impersonated tab) while impersonating → confirm
      invisible from tenant 1's session → Disconnect. Also asserts the audit trail against the actual
      shipped contract (B-D3: `impersonator_id` always NULL, identity in `metadata.impersonatorUserId`).
      2/2 passed (run twice for stability against the accumulating DB).
- [ ] One final confirmed full-suite green run: `yarn dev` → stop → `yarn test:e2e` AND
      `yarn test:e2e:web`, plus `yarn check:tenant-scoping`, `yarn check:bind-arity`,
      `yarn typecheck && yarn lint` repo-wide — **out of scope for this pass** (the orchestrator runs
      suites; this agent was asked only for the new spec, not the full-suite proof run).
- [ ] Once the full-suite proof above is run and green, archive `MULTI_TENANT_IMPLEMENTATION_PLAN.md` to
      `done_plans/`.

### Files to Modify

| Layer | File                                                              | Change   |
| ----- | ----------------------------------------------------------------- | -------- |
| E2E   | `frontend/tests/e2e-web/lira-web-020-admin-tenants.spec.ts` (new) | New spec |

---

## LIRA-101: Primary Cash Drawer — cleanup stale docs/dead code + verify Suppliers `settleNetPayUsd`

| Field                | Value                                                                     |
| -------------------- | ------------------------------------------------------------------------- |
| **Epic**             | Suppliers / Financial Services                                            |
| **Type**             | Cleanup / Verification                                                    |
| **Priority**         | Medium (one sub-item touches money math)                                  |
| **Status**           | DONE 2026-10-02 (not yet committed) — core-side items only; see note below |
| **Affected Modules** | Suppliers, Financial Services                                             |
| **Assigned To**      | —                                                                         |
| **Depends On**       | —                                                                         |
| **Source Plan**      | `docs/plans/todo_plans/PRIMARY_CASH_DRAWER_PLAN.md` (§6, remaining items) |

### Summary

The Primary Cash Drawer feature itself is fully shipped (commit `9553807`) and `FEATURE_GUIDE.md`
§7/§8/§8.1 is current. What's left is small cleanup, EXCEPT one item that needs real money-eyes
attention:

1. Stale JSDoc still references the withdrawn §8.5 insufficient-funds guard (`packages/ui/src/api/types.ts:606,619`,
   `packages/core/src/services/FinancialService.ts:41-42`, `frontend/src/api/backendApi.ts:3194`) —
   could mislead a future reader into re-adding a guard the owner explicitly reversed.
2. Dead code: unused `getBalance()` in `DrawerTopUpRepository.ts:409-418`; unused import
   `primaryCashDrawerName` in `FinancialServiceRepository.ts:17`.
3. **Money item**: `frontend/src/features/suppliers/pages/Suppliers/index.tsx:625` and
   `frontend/src/features/suppliers/hooks/useSuppliers.ts:298-299` still describe the superseded
   fee-only ledger model. Needs a verification pass confirming `settleNetPayUsd` computes correctly
   under the current GROSS supplier-ledger model, not just a comment edit.

### Acceptance Criteria

- [ ] Stale JSDoc/comments corrected to describe the current (no insufficient-funds guard) reality.
- [ ] Dead code removed (`getBalance()`, unused import).
- [ ] `settleNetPayUsd` independently verified correct under the GROSS model (failing-first test if
      a discrepancy is found; otherwise document the verification and update the stale comments).
- [ ] Typecheck and lint pass.

### Files to Modify

| Layer    | File                                                             | Change                             |
| -------- | ---------------------------------------------------------------- | ---------------------------------- |
| Backend  | `packages/core/src/services/FinancialService.ts`                 | Correct stale JSDoc                |
| Backend  | `packages/core/src/repositories/DrawerTopUpRepository.ts`        | Remove dead `getBalance()`         |
| Backend  | `packages/core/src/repositories/FinancialServiceRepository.ts`   | Remove unused import               |
| Frontend | `frontend/src/features/suppliers/pages/Suppliers/index.tsx`      | Correct stale comment; verify math |
| Frontend | `frontend/src/features/suppliers/hooks/useSuppliers.ts`          | Correct stale comment; verify math |
| Types    | `packages/ui/src/api/types.ts`, `frontend/src/api/backendApi.ts` | Correct stale JSDoc                |

### Resolution (2026-10-02, packages/core + docs only — agent was scoped away from frontend/electron-app this pass)

- **Stale JSDoc**: fixed in `packages/core/src/services/FinancialService.ts` (the `FinancialServiceResult.code`
  doc + the `addTransaction` catch comment) and, same pattern, `packages/core/src/services/DrawerTopUpService.ts`
  (`DrawerTopUpResult.code` doc + `transferBetweenDrawers`'s doc comment) — both referenced the withdrawn
  `InsufficientDrawerFundsError`/§8.5 RECEIVE-payout guard as if still live. Now state plainly that it was
  deleted (owner reversed the no-overdraw rule 2026-08-01) while preserving the still-true part: the
  `code`/`details` envelope remains load-bearing for other `AppError`s (e.g. the FOR-partner
  `BusinessRuleError`). **NOT fixed this pass** (out of scope): `packages/ui/src/api/types.ts:606,619` and
  `frontend/src/api/backendApi.ts:3194` carry the same stale wording — same fix, needs a frontend-scoped agent.
- **Dead code**: removed `DrawerTopUpRepository.ts`'s unused local `getBalance()` closure (was defined, never
  called, inside `transferBetweenDrawers`'s transaction) and `FinancialServiceRepository.ts`'s unused
  `primaryCashDrawerName` import. Confirmed unreferenced via grep before removal; `npx tsc --noEmit` (9.4s) and
  `npm run build` both clean afterward.
- **`settleNetPayUsd` verification**: this is a FRONTEND-computed variable
  (`frontend/src/features/suppliers/pages/Suppliers/index.tsx:1324-1333`) — `isNewModelBatch ? max(0, gross −
  enteredCommission) : max(0, gross)` — with no core-side namesake. Its comments there (and in
  `useSuppliers.ts:465-483`) were re-read in full and are ALREADY CORRECT/current, accurately describing the
  gated legacy-fee-only-vs-new-model-gross split (post-dating this ticket's original diagnosis — ticket line
  numbers were stale, not the code). No edit needed on either acceptance-criteria sub-item.
  Verified the underlying core math by EXECUTION, not reading (rule 28): the existing suite already contains
  exactly the settlement + void/refund execution tests this ticket asks for, with real DB writers asserting
  drawer + supplier-ledger deltas per currency —
  `SupplierRepository.settlement.test.ts` ("correctly settles a $100 OMT SEND, fee $1, $0.10 commission (gross)
  — pays the gross $100.90", "full cycle: TOP_UP(gross) → settle(same amount) nets ledger to 0"),
  `SupplierRepository.commissionAtSettlement.test.ts` (new-model commission split/credit), and
  `TransactionRepository.supplierSettlementReversal.test.ts` ("VOID: the PCD is debited by the settlement, then
  fully restored — rule 20 net-zero across create+settle+reverse", plus the model-1 commission-credit VOID/REFUND
  net-to-0 tests). Ran them: `SupplierRepository.settlement` + `SupplierRepository.commissionAtSettlement` +
  `TransactionRepository.supplierSettlementReversal` + `SupplierRepository.settlementOwnership` → **4 suites, 67
  tests, all passed, 9.4s**. Then the full gate: `yarn workspace @liratek/core test` → **454 suites, 4420 tests,
  all passed, 61.2s**; `yarn workspace @liratek/backend test -- suppliers.api` → **24/24 passed**;
  `yarn workspace @liratek/backend test -- services.api FinancialService.test` → **49/49 passed**;
  `node scripts/check-tenant-scoping.mjs` → 0 violations (218 files, 940 statements); `node
  scripts/check-bind-arity.mjs` → OK. **Verdict: `settleNetPayUsd`'s math is correct under the current GROSS
  model — no discrepancy found, so no guard test was needed (rule 17 only requires one when a bug is found).**
- No release note (rule 30): no user-visible behavior changed — comments, dead code, and verification only.
- **Owner question**: none — no removal or behavior question required a stop.

---

## LIRA-110: Daily closing sums financial-services commission with ZERO gates — SUPERSEDED by LIRA-158 + LIRA-160

| Field                | Value                                                                    |
| -------------------- | ------------------------------------------------------------------------ |
| **Epic**             | Closing / Profits                                                        |
| **Type**             | Bug (candidate — same class as LIRA-108)                                 |
| **Priority**         | Medium                                                                   |
| **Status**           | **SUPERSEDED** — split into LIRA-158 (DONE) + LIRA-160 (**DONE** 2026-09-04, see the `## LIRA-160:` ticket below) |
| **Affected Modules** | Closing                                                                  |
| **Assigned To**      | —                                                                        |
| **Depends On**       | —                                                                        |
| **Source Plan**      | Found by LIRA-108's workflow (2026-08-08, confirmed by both reviewers)   |

### Summary

`ClosingRepository.ts:689-696` computes the daily financial-services commission figure with a
third, fully ungated `SUM(commission)` — missing not just the LIRA-108 counterparty gates but even
`is_settled` and `notRefunded`. A refunded or unsettled or partner-pending commission row inflates
the closing screen's daily commission number. Also rule-14 debt: a third hand-rolled copy of the
"realized commission" concept instead of reusing one definition.

### Resolution (verified against source 2026-09-04) — split into LIRA-158 (DONE) + LIRA-160 (DONE, see the `## LIRA-160:` ticket below)

`ClosingRepository.ts` now has exactly ONE `SUM(...commission...)` query left — `finProfitLegacy`
(~:815-822) — and it already carries both `embeddedCommission(...)` and `notRefunded(...)`. That
closes this ticket's original complaint (a "third, fully ungated" commission sum, plus the rule-14
duplication) via LIRA-158's 2026-08-31 shipment (`8c453764`, `8a868fe3`, `25199c74`).

What LIRA-158 did NOT add is `finProfitLegacy`'s counterparty gates
(`notPartnerPending`/`notDebtPending`) — a for-partner or CUSTOMER_ACCOUNT-charged legacy
commission can still land in today's closing total before the partner/client has actually paid.
That residual is now its own ticket, **LIRA-160** (below, ~:2488), and is self-documented as a
KNOWN GAP in `packages/core/src/constants/__tests__/profitRecognition.guard.test.ts` ~:592-610.

So this ticket closes as **superseded**, not simply "done": the zero-gates complaint split into a
DONE half (LIRA-158) and a still-open half (LIRA-160). Do not mark either resolved by proxy of the
other.

> **Update 2026-09-22:** LIRA-160 closed the same day it was written — `notDebtPending` is exported
> (`ProfitRepository.ts:404`) and wired at **eight** `ClosingRepository.ts` call sites
> (`:997`, `:1012`, `:1120`, `:1132`, `:1183`, `:1195`, `:1284`, `:1321` — the last is the loto
> arm, omitted from the first count). Both halves are
> now DONE.

### Acceptance Criteria (historical — superseded by the Resolution above)

- [ ] Money-eyes pass on what the closing figure is MEANT to show (day's earned commission?
      cash-collected commission?) — the closing screen may intentionally differ from Profits
      (e.g. cash-basis vs recognition-basis). Decide against docs, not taste.
- [ ] Failing-first repro (rule 17), then either reuse the gated definition (rule 14) or document
      the intentional difference in the method comment + COUNTERPARTY_LEDGERS.md.
- [ ] LIRA-098's guard only scans ProfitRepository — consider extending its file list to
      ClosingRepository or adding a sibling guard.

### Files to Modify

| Layer   | File                                                  | Change           |
| ------- | ----------------------------------------------------- | ---------------- |
| Backend | `packages/core/src/repositories/ClosingRepository.ts` | Gate or document |

---

## LIRA-116: Rename the crossed "Services" module labels/routes (owner approved)

| Field                | Value                                |
| -------------------- | ------------------------------------ |
| **Epic**             | Naming / DX                          |
| **Type**             | Refactor (naming only)               |
| **Priority**         | **High** (raised 2026-08-22)         |
| **Status**           | **DONE** — verified already shipped 2026-10-02 (stale TODO status corrected; this ticket's own file had drifted, rule per `feedback_verify_plan_doc_status`). Shipped in `890290c8` ("refactor(routing): rename the omt_whish route /services -> /omt-whish (LIRA-116)") plus migration v162 (`rename_omt_whish_route_to_omt_whish`, `packages/core/src/db/migrations/index.ts`). Verified by reading current code, not just the commit message: `omt_whish` module row is `('OMT/Whish', '/omt-whish')` and `custom_services` is `('Services', '/custom-services')` in both `electron-app/create_db.sql` (tenant-1 seed) and migration v162's `up()`; `ActiveModuleContext.tsx`'s route→key map has `"/omt-whish": "omt_whish"` and `"/custom-services": "custom_services"`; `App.tsx` serves both target routes and keeps `path="/services"` as a `<Navigate to="/omt-whish" replace />` redirect (old bookmarks don't 404) with an inline comment explaining why. Grepped `frontend/tests/` for `"/services"` / `'/services'` — zero hits, so no e2e spec needed updating. The "For Partner" checkbox label was not touched, per the ticket's own note. No further work needed. |
| **Affected Modules** | Custom Services, OMT/Whish           |
| **Source Plan**      | Found while diagnosing LIRA-114      |

> 🔴 **THIRD STRIKE, 2026-08-22 — priority raised to High.** This has now misled a **third**
> consecutive LIRA-114 investigation, and that one produced a dated, file:line-cited "resolved"
> conclusion about `FinancialServiceRepository` (`omt_whish`) when the subject was
> `CustomServiceRepository` (`custom_services`). Documenting the trap has demonstrably not stopped
> it — three investigations read this very warning and fell in anyway. The rename is the only fix
> that ends it. Owner approved it 2026-08-09; it is still unbuilt.

### Summary

The two modules have crossed names, which has already cost real debugging time:

| module key        | UI label       | route              | repository                   |
| ----------------- | -------------- | ------------------ | ---------------------------- |
| `custom_services` | **"Services"** | `/custom-services` | `CustomServiceRepository`    |
| `omt_whish`       | "OMT/Whish"    | **`/services`**    | `FinancialServiceRepository` |

So "the Services page" means `custom_services`, while the `/services` ROUTE belongs to OMT/Whish.
This directly caused LIRA-114 to be wrongly refuted: an investigation reasoned _"Services/index.tsx
never sets cost/price, so the owner's cost 1008 / price 1010 can't come from there"_ — true of
`/services`, irrelevant to the page the owner actually meant. Two separate agent investigations
were misled by it.

Owner approved the rename 2026-08-09 ("rename yes").

### Acceptance Criteria

- [ ] Decide the target naming (suggest: keep the UI label **"Services"** for `custom_services`
      since that is what the owner calls it, and move its route to `/services`; rename the
      `omt_whish` route to `/omt-whish` to match its "OMT/Whish" label). Whatever is chosen, the
      **label, route, module key, repository name, and feature folder should agree**.
- [ ] Migration for the `modules` table `route` values (rule 10: BOTH `migrations/index.ts` and
      `create_db.sql`), plus `ActiveModuleContext.tsx`'s route→key map.
- [ ] Update `App.tsx` routes, feature folder names if renamed, and every e2e spec that navigates
      to either route (grep `"/services"` and `"/custom-services"` across `frontend/tests/`).
- [ ] ⚠ **Old route must not 404 for a user mid-session** — consider a redirect, and check whether
      any stored state (last-visited route, deep links) references the old paths.
- [ ] Full suites + desktop/web e2e green.

### Note

**Do NOT rename the "For Partner" checkbox** — owner explicitly wants that label kept as-is
(2026-08-09).

---

## LIRA-117: No e2e spec drives the inventory-pick → stock-decrement flow

| Field                | Value                                 |
| -------------------- | ------------------------------------- |
| **Epic**             | Custom Services / Inventory           |
| **Type**             | Test coverage gap                     |
| **Priority**         | Medium                                |
| **Status**           | DONE 2026-10-03 — `frontend/tests/e2e-electron/lira-117-custom-service-item-pick.spec.ts` drives the real `custom-service-item-search` dropdown PICK (not fill+Enter): stock decrements by exactly 1 (delta), price/cost pre-fill, the transaction carries the right amount/profit, refund restores stock, and a follow-up free-text submission proves `product_id` stays NULL and stock untouched. Desktop: 2/2 passed. |
| **Affected Modules** | Custom Services, Inventory            |
| **Source Plan**      | Found while shipping §2b (2026-08-09) |

### Summary

§2b (`69c29e8`) made an inventory-backed custom service consume stock, driven by a new
`custom_services.product_id`. The backend is well covered (`CustomServiceRepository.stock.test.ts`,
plus the scenarioMatrix's A1/A2/A3 divergence), but **no e2e spec ever picks a product from the
inventory SearchBar.**

All four specs that touch `custom-service-item-search` — `lira-088`, `lira-093`, `lira-094`,
`lira-135` — use `.fill(text) + press("Enter")`, i.e. the **free-text commit path**, which sends no
`product_id`. So a UI-side regression (the page failing to send `product_id`, or sending the wrong
one) would pass every test we have.

This is exactly the layer-seam problem this suite has been bitten by before: specs that hand-build
IPC payloads bypass the frontend entirely and cannot catch a frontend↔repository mismatch.

### Acceptance Criteria

- [x] New desktop e2e spec: seed a product with known stock → open Custom Services → **pick it from
      the SearchBar dropdown** (not fill+Enter) → submit → assert the product's `stock_quantity`
      dropped by exactly 1 → void/refund the transaction → assert it returns to the original value.
      `frontend/tests/e2e-electron/lira-117-custom-service-item-pick.spec.ts`, 2/2 passed.
- [x] Assert by identity and delta (rule 15) — snapshot stock immediately before, never absolute.
- [x] Also assert the negative case in the same spec: a **free-text** service leaves stock
      untouched. That is the regression that matters most, since all three input paths share one
      backend code path.
- [ ] Consider a web e2e twin (rule 19) if the pick flow differs in browser mode — not done in this
      pass; left open.

### Files to Modify

| Layer | File                                                                      | Change   |
| ----- | ------------------------------------------------------------------------- | -------- |
| E2E   | `frontend/tests/e2e-electron/lira-117-custom-service-stock.spec.ts` (new) | New spec |

---

## LIRA-058: OMT APP — Topup Flow Design

| Field                | Value                         |
| -------------------- | ----------------------------- |
| **Epic**             | OMT App Topup                 |
| **Type**             | Feature                       |
| **Priority**         | Medium                        |
| **Status** | CLOSED 2026-10-02 (owner confirmed): delivered by the OMT open-credit work (LIRA-187..194): an OMT App top-up adds to what is owed to OMT instead of taking drawer cash; Cash Out to OMT returns it |
| **Affected Modules** | Recharge > OMT App, Suppliers |
| **Assigned To**      | —                             |
| **Depends On**       | —                             |

### Summary

OMT App topup has a nuanced dual-pool problem that needs design clarification before implementation. Blocked on interview.

### Context (partial — interview incomplete)

In OMT System there are conceptually two money pools:

- **Cash pool**: physical cash customers paid for OMT transactions → lives in the OMT System drawer
- **Owed/topup pool**: money committed/sent to OMT App — does NOT come from the cash drawer

Topping up OMT App from OMT System should:

- NOT reduce the OMT System cash drawer
- Record a transaction visible in the Suppliers page for OMT System
- Track the distinction between cash and owed money

### Acceptance Criteria

- [ ] _(To be defined after interview)_

### Notes

- Interview required to clarify: what exactly is the "owed pool", how does it appear in the supplier ledger, how does OMT pay us back, can the owed pool go negative?

---

## LIRA-096: Partners Page — Remove "Record Transaction" (Redundant with Add Credit/Debt)

| Field                | Value                                                               |
| -------------------- | ------------------------------------------------------------------- |
| **Epic**             | Partner System                                                      |
| **Type**             | Cleanup / Decision                                                  |
| **Priority**         | Low                                                                 |
| **Status** | DONE 2026-10-02 (not yet committed) — confirmed no functional gap (the generic type picker's non-ADJUSTMENT types bucket identically to ADJUSTMENT in every balance/coverage query; `SETTLEMENT` is already written, better, by the dedicated "Settle" button, including its no-cash-moved paper case), then removed the "Record Tx" action/button/modal-branch/state from `frontend/src/features/partners/pages/Partners/index.tsx`, keeping `RecordTxModal` as the "Add Credit/Debt"-only modal (dropped the now-dead `adjustmentOnly` prop and `TRANSACTION_TYPE_GROUPS`). Backend `recordTransaction` IPC/REST path kept unchanged — still used by Add Credit/Debt. Guard test added confirming the button/modal title are gone. `yarn workspace @liratek/frontend typecheck` (27.6s) and eslint on touched files both clean. |
| **Affected Modules** | Partners                                                            |
| **Assigned To**      | —                                                                   |
| **Depends On**       | LIRA-051 (DONE — prior Record Transaction type-list simplification) |

### Summary

Owner note (2026-08-07, 2:20 AM): _"Remove record txn in partner. Its redundant we have add
credit debt."_ Requests removing the "Record Transaction" action/modal from the Partners page
entirely, on the grounds that "Add Credit/Debt" already covers the same need. LIRA-051 (DONE)
previously simplified Record Transaction's type dropdown rather than removing the feature — this
note goes a step further. Before removing anything, confirm there's no transaction type or
capability Record Transaction covers that Add Credit/Debt cannot currently express — if a gap
exists, it needs to move into Add Credit/Debt first, or the owner needs to accept losing that case.

### Open Questions (owner interview required)

- [ ] Confirm every Record Transaction type in current use is already reachable via Add
      Credit/Debit before removing the feature.

### Acceptance Criteria

- [ ] _(To be defined once the above is confirmed — likely: remove the Record Transaction
      action/modal from the Partners page once no functional gap is found)_

### Files to Modify

| Layer    | File                                                      | Change                                              |
| -------- | --------------------------------------------------------- | --------------------------------------------------- |
| Frontend | `frontend/src/features/partners/pages/Partners/index.tsx` | Remove Record Transaction UI (pending confirmation) |

---

## LIRA-068: Price-change alert on every page with a selling price (was "Amount Changed" badge) — POSTPONED

| Field                | Value                                                                 |
| -------------------- | --------------------------------------------------------------------- |
| **Epic**             | Transaction Visibility / Audit                                        |
| **Type**             | Enhancement                                                           |
| **Priority**         | Low                                                                   |
| **Status**           | POSTPONED by the owner 2026-10-02 (enhancement for later). Redefined; findings below. |
| **Affected Modules** | recharge (exists), pos, custom_services, omt_whish, audit (Transactions table) |
| **Depends On**       | —                                                                     |

### Findings (2026-10-02)

**1. The original premise does not apply.** No edit path can change a saved transaction's amount. Every
`update…Metadata` writer only touches notes, names and phones (plus description/category for expenses):
`RechargeRepository.ts` ~2860-2894, `FinancialServiceRepository.ts` ~5090-5116, `ExpenseRepository.ts`
~330-366, `SalesRepository.ts` ~3120-3158. Wrong money is corrected only by Void/Refund, which already show
who did it in Transactions and the Audit Log. An "amount changed" badge would never fire.

**2. The related mechanism that DOES exist: the recharge "Margin" alert.**
- Setting: Settings → Shop Config → "Recharge Margin Alert" → `recharge_margin_alert_threshold`
  (default 100,000 LBP).
- Logic: `frontend/src/features/recharge/components/HistoryModal.tsx` ~305-350. Each MTC/Alfa sale stores
  `default_price_to_client` (the auto-filled usual price). A red "⚠ Margin" badge shows when
  `actualPrice − default > threshold`.
- Shown ONLY in Recharge → MTC/Alfa → History (type cell, next to "↓ Out"); hover text "Price to client was
  modified — margin: X LBP". Nothing on the Transactions page (no reference in `TransactionsViewer.tsx`).

**3. Live test on cornertech (2026-10-02; both sales refunded, all drawers back to identical values):**

| Sale ($3 MTC credit) | Usual price | Charged | Badge |
| --- | --- | --- | --- |
| A, raised | 300,000 LBP | 450,000 LBP | yes ("margin: 150,000 LBP") |
| B, lowered | 300,000 LBP | 150,000 LBP | **no** |
| C, priced in $ | — | — | not possible: the Credit tab's price is LBP-only (USD price entry exists only on Days) |

So today the alert misses undercharging (the usual way a cashier keeps the difference), and it is visible
only inside one History window.

### Proposed design (for when it is picked up)

Not a generic "remember every price" system. Compare against the usual price each page ALREADY has:

| Page | Usual price exists? | Alert? |
| --- | --- | --- |
| MTC / Alfa | yes — auto-filled Price to Client | yes (exists; fix it) |
| POS | yes — the product's selling price in Inventory | yes, IF the cashier can change a line's price at checkout (to confirm in code) |
| Custom services | yes, when sold from a preset | yes, preset sales only |
| OMT / Whish fees | partly — fee tables for Intra / Western Union | only where a fee table exists |
| Exchange | the shop rate | already covered by the payment-form rate warning (LIRA-240) |
| Maintenance, free-typed services | no | no |

Rules:
1. **One shop-wide threshold in %** (e.g. "warn when a price is changed by more than 10%"), replacing the fixed
   100,000 LBP, so it works for small and large items and in $ and LBP. Per-page thresholds only if needed later.
2. **Store the usual price at the moment of sale** (as recharge does with `default_price_to_client`), so a later
   catalogue price change never flags past sales. Needs a column per module that lacks one (migration).
3. **Both directions:** above and below the usual price.
4. **One review place:** the badge in the Transactions table plus a "price changed" filter, as well as in each
   page's history. Admin only.
5. **Discounts don't count.** A discount is its own visible field; only a typed price change is flagged.

Suggested phases: (1) POS + fix the recharge alert (%, both directions, shown on Transactions);
(2) custom-service presets and OMT/Whish fee tables.

**Open questions for when it is picked up:** is 10% the right default? Can POS change a line's price at
checkout (if not, POS drops out and the scope shrinks)? Staff or admin-only visibility (proposed: admin only)?

**What users will notice (when built):** sales charged at a price far from the usual one, higher or lower, are
marked with a warning in the Transactions table and in each page's history.


**Update 2026-10-03 (owner):** stays POSTPONED. Facts and decisions recorded for when it is picked up:
- **POS is out of scope:** the POS cart has no editable line price. The only input on a cart line is the
  phone-unit picker (`CartLineRow.tsx`), and the checkout discount doesn't count as a price change.
- **Threshold:** 10% above OR below the usual price (owner, 2026-10-03).
- **Remaining scope when built:** fix the MTC/Alfa alert (% threshold, both directions) and show it on the
  Transactions page with a filter (admin only). Custom-service presets and the OMT/Whish fee tables are optional.
---

## LIRA-075: Favorite/Pin Whish App Quick Link in Home Grid

| Field                | Value                 |
| -------------------- | --------------------- |
| **Epic**             | Navigation / Home     |
| **Type**             | Feature               |
| **Priority**         | Low                   |
| **Status**           | DONE 2026-10-03 (not yet committed) — found the pin/favorite mechanism already mostly built (`useSidebarFavorites.ts`, shared `localStorage["sidebar_favorites"]` key, same list the sidebar's press-and-hold favorites use — one list, not two, per-viewer convenience as the CLAUDE.md capabilities guidance recommends for this kind of state) with a working star toggle already wired into every `HomeGrid.tsx` tile (persists, navigates correctly, shared with Sidebar — all pre-existing and already covered by `HomeGrid.test.tsx`). The one real gap against this ticket's acceptance criteria ("pinned pages show first"): tiles never reordered — pinning only filled in the star, the tile stayed in its original module-sort position. Fixed in `HomeGrid.tsx`'s `navItems` useMemo: Dashboard stays first (unchanged long-standing invariant), then a stable sort moves every pinned tile ahead of the unpinned ones, preserving original relative order within each group (so re-pinning promotes a tile instead of reshuffling the whole grid), live-reactive (`favorites` added to the memo's dep array) — no remount needed. "ANY page can be pinned" is already satisfied: `navItems` already enumerates every enabled module (Whish/OMT included), not a hardcoded subset. Verified: `frontend` typecheck clean for every file this ticket touched (one PRE-EXISTING, UNRELATED error surfaced by the full-project `tsc` run — `features/audit/transactionPresentation.ts` missing `SUPPLIER_RECORDED_DEBT` — traced via `git diff --stat` to the parallel MONEY-lane agent's uncommitted `transactionTypes.ts` change, not touched by this ticket, left alone per the "don't edit their files" instruction); eslint clean on all touched files (0 warnings, 0 errors); `HomeGrid.test.tsx` full suite (12 tests: 9 pre-existing + 3 new pinned-first-ordering tests) green. |
| **Affected Modules** | Dashboard / Home grid |
| **Depends On**       | —                     |

### Summary

Add favorite/pinned **quick links** to a page (starting with Whish App) in the home grid view (`Dashboard.tsx`). Noted as **partially implemented** — finish the favorite-link affordance so Whish App (and others) can be pinned for quick access.

### Acceptance Criteria

- [ ] User can favorite/pin a page (Whish App) as a quick link in the home grid
- [ ] Pinned links persist and navigate correctly
- [ ] Builds on the partial home-grid implementation (no parallel mechanism)
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                  | Change                     |
| -------- | ----------------------------------------------------- | -------------------------- |
| Frontend | `frontend/src/features/dashboard/pages/Dashboard.tsx` | Favorite/pin quick-link UI |

---

## LIRA-086: Dashboard Checkpoint Freshness Coloring

| Field                | Value       |
| -------------------- | ----------- |
| **Epic**             | Dashboard   |
| **Type**             | Enhancement |
| **Priority**         | Low         |
| **Status**           | DONE 2026-10-03 (not yet committed) — thresholds per owner decision 2026-10-02: green within $1 (or 100,000 LBP), orange >$1 up to $10, red >$10, defined once as `CHECKPOINT_VARIANCE_GREEN_MAX_USD`/`CHECKPOINT_VARIANCE_ORANGE_MAX_USD` (`frontend/src/features/dashboard/pages/Dashboard.tsx`). Source of the counted-vs-expected numbers: `ClosingRepository.getLastCheckpointPerDrawer()` (already shipped, already returns `{physical, expected}` per currency per drawer — this ticket is purely a new read + a color mapping, no backend change). An LBP variance converts to its USD-equivalent via the shop's own sell rate (`useSellRate()`, the existing shared hook — "convert LBP at the shop rate" per the ticket) before bucketing, rather than a second hardcoded LBP threshold that could drift from the USD one. Rendered as a small colored dot next to the EXISTING checkpoint-time text (kept as-is — that one is a different, already-shipped signal: how long ago, not how accurate) with a title tooltip giving the exact dollar drift; no dot at all when the drawer has never been checkpointed. `drawerStatuses` state widened to carry the `amounts` field the API already returned but the page was dropping. Verified: `frontend` typecheck (`tsconfig.app.json`, 15.9s) clean; `src/features/dashboard` full suite (15 suites / 83 tests) green, including a new `Dashboard.checkpointVarianceColor.test.tsx` (5 tests: green/orange/red/LBP-conversion/no-checkpoint). Fixing this also surfaced and fixed a latent gap in 6 PRE-EXISTING dashboard test files: none mocked `api.getRates()`, which the newly-added `useSellRate()` call now reaches on every Dashboard render — unmocked, it threw synchronously inside the dashboard's load effect and broke those suites; each gained a one-line `getRates: jest.fn().mockResolvedValue([])` mock (not a behavior change, a fixture completeness fix, listed in Files below). Eslint on touched files: 0 errors (pre-existing `any` warnings only, same count as before this ticket). |
| **Affected Modules** | Dashboard   |
| **Assigned To**      | —           |
| **Depends On**       | —           |

### Summary

Owner note 29. Color the dashboard's last-checkpointed value by how fresh/consistent it is
versus the expected value: green when it matches, orange for a small drift, red for a large
drift. Thresholds TBD with the owner.

### Acceptance Criteria

- [ ] Dashboard compares the last checkpointed value against the expected value
- [ ] Green = match, orange = small diff, red = large diff
- [ ] Drift thresholds confirmed with the owner (TBD — not yet defined)
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                  | Change                             |
| -------- | ----------------------------------------------------- | ---------------------------------- |
| Frontend | `frontend/src/features/dashboard/pages/Dashboard.tsx` | Freshness-coded checkpoint display |

---

## Open Follow-ups (Post-Sprint 1) — orphaned, still open

> These two never appear in any Sprint 2-6 board or summary — structurally orphaned since Sprint 1,
> per `docs/plans/todo_plans/SPRINT_INVENTORY_2026-08-12.md` §3, §5.3. Kept as their own table,
> verbatim, exactly as originally filed.

| ID          | Description                                                                                                             | Priority |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- | -------- |
| LIRA-054-FU | BINANCE rows in TransactionsViewer missing directional badge — needs `service_type` joined onto unified transaction row | Low      |
| LIRA-055-FU | Voucher support at session checkout requires `client_id` stored on session (currently only name/phone)                  | Low      |

---

## Previously untracked items (found by this restructuring's source inventory)

Two real issues surfaced by `docs/plans/todo_plans/SPRINT_INVENTORY_2026-08-12.md` §5 that had no
ticket at all — both inside the LIRA-137 commission work.

### CLOSED — Profit rollup for supplier commission was invisible on the Profits page

LIRA-137 stamps `profit_usd`/`profit_lbp` on the new `SUPPLIER_SETTLEMENT` transaction using the same
mechanism every other commission-earning flow uses, but `ProfitRepository.ts`'s `PROFIT_TXN_TYPES`
constant did not include `SUPPLIER_SETTLEMENT`, so every profit-recognition query in that file
silently excluded it — the commission was real and profit-stamped but permanently absent from every
Profits-page aggregate. **Fixed in `02f97aa`** (current HEAD at the time of this restructuring).

### OPEN — Settlement row shows $0.00 in the amount column; the real value lives only in `summary` prose

`SupplierRepository.ts:1205-1227` documents (comment written during LIRA-137 itself) that
`amount_usd`/`amount_lbp` are contractually 0/0 for a bills-only commission-settlement batch shape —
a deliberate, documented workaround, not an oversight. The actual commission value (e.g. "100,000
LBP") appears only inside the free-text `summary` string, which is never filtered by anything. Low
urgency today (a human reading the row can see the number), but a landmine for any future
export/sort-by-amount/aggregate-by-amount view (e.g. LIRA-073's DataTable export) built without
knowing this convention exists. **Pending an owner decision** on whether/how to surface it
structurally; no ticket number assigned yet.

---

## Archive Index

Closed sprint history moved out of this file on 2026-08-12 (per
`docs/plans/todo_plans/SPRINT_INVENTORY_2026-08-12.md`, committed `2bfc7f5`):

| Archive file                                           | Contents                                                                                                                                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/plans/done_plans/SPRINT_1_ARCHIVE_2026-08-12.md` | Pre-merge review (2026-06-19), post-review follow-ups (2026-06-20), LIRA-048..055 — all DONE                                                                                             |
| `docs/plans/done_plans/SPRINT_2_ARCHIVE_2026-08-12.md` | LIRA-056, 057, 059..064 — all DONE (LIRA-058 stayed here, open)                                                                                                                          |
| `docs/plans/done_plans/SPRINT_3_ARCHIVE_2026-08-12.md` | LIRA-065..067, 069..074, 076, 077 + Backlog + Session Summary narrative — all DONE (LIRA-068, 075 stayed here, open)                                                                     |
| `docs/plans/done_plans/SPRINT_4_ARCHIVE_2026-08-12.md` | LIRA-078, 080..082, 085, 089..091, 094 — all DONE, including LIRA-090 (corrected DONE) (LIRA-079, 083, 084, 086, 087, 088 stayed here, open)                                             |
| `docs/plans/done_plans/SPRINT_5_ARCHIVE_2026-08-12.md` | LIRA-095, 097 — DONE / CLOSED-already-working (LIRA-096 stayed here, open)                                                                                                               |
| `docs/plans/done_plans/SPRINT_6_ARCHIVE_2026-08-12.md` | LIRA-098, 100, 102, 103, 104 (corrected DONE), 105..109, 111 (corrected DONE), 112, 115 — all DONE/CLOSED, plus the DECISION LOG and the Sprint 6 summary board (header range corrected) |

The 6-row `Ticket \| Spec \| Validates` e2e coverage table (originally lines 80-88 of this file, under
"POST-REVIEW FOLLOW-UPS") moved to `frontend/tests/e2e-electron/README.md`'s spec index — it was never
a ticket board (no Status column), which is exactly what made a naive grep miscount 6 closed tickets
as open. It is also preserved verbatim inside the Sprint 1 archive above.

---

## LIRA-142: PM Fee input renders on a For-Partner SEND while the payload forces the fee to 0

| Field                | Value                                        |
| -------------------- | -------------------------------------------- |
| **Epic**             | Services / Partners                          |
| **Type**             | UX fix (offered-but-discarded input)         |
| **Priority**         | Low                                          |
| **Status**           | DONE 2026-10-02 (not yet committed)          |
| **Affected Modules** | OMT/Whish (Financial Services)               |
| **Source**           | Found while building LIRA-114 §4, 2026-08-22 |

**What users will notice:** on a For-Partner send, the Payment Method Fee box no longer appears (it
never did anything but get silently discarded). Gated `pmFeeApplies && !forPartner` at
`Services/index.tsx` ~:2499; submit payload untouched. Guard test
`Services.forPartnerPmFeeGate.test.tsx` proven failing-first (rule 17): red against unfixed code
("not.toBeInTheDocument" found the input rendered), green after the `!forPartner` gate — see task
report for captured output. Full `src/features/services` suite (13 files / 48 tests) green after;
`tsc -p tsconfig.app.json --noEmit` clean (15.4s); eslint clean on touched files (2 pre-existing
unrelated warnings only).

### Summary

`Services/index.tsx`'s "Payment Method Fee" box renders whenever `pmFeeApplies` is true, with no
`forPartner` gate — so a For-Partner SEND paying via a non-cash drawer method (e.g. the OMT wallet)
still shows a PM-fee input the operator can type into. The submit payload then **forces
`paymentMethodFee: 0`** for `forPartner` (the PFT-3b spread, `~:1083`), so whatever they typed is
silently discarded.

This is the **same offered-but-discarded shape as LIRA-114 §4** — the defect that ticket just fixed
for the payment-method picker and the RECEIVE cashout selector. It was deliberately left out of
scope there because that change's hard constraint was "the only behavioural change is which methods
can be picked".

### Acceptance Criteria

- [ ] Either hide the PM-fee box on a For-Partner SEND, or state in-line that no PM fee is charged
      on a partner disbursement. Presentation only — do **not** start honouring the value (the
      payload zeroing it is the owner-approved PFT-3b contract, not a bug).
- [ ] Rule 17 at the interaction layer: prove the assertion fails against the current page. The
      natural home is the existing `Services.forPartnerPaymentGate.test.tsx`, which already stubs
      the payment section and drives the For-Partner toggle.
- [ ] Do not touch the submit payload.

### Files to Modify

| Layer    | File                                                      | Change              |
| -------- | --------------------------------------------------------- | ------------------- |
| Frontend | `frontend/src/features/services/pages/Services/index.tsx` | Gate the PM-fee box |

---

## LIRA-143: Phone IMEI units & warranty-from-sale — BUILT (`70776da6`..`e432ba69`, 2026-08-25; hardening through 2026-08-27)

> **Status note (corrected 2026-09-04):** BUILT — phases 1-4 landed 2026-08-25
> (`70776da6`..`e432ba69`); e2e was proven green the SAME day, not left in flight (see "Phase 7
> record" below: desktop 258/258, web 68/68). Two items an earlier draft of this status line
> flagged as still open are BOTH already resolved further down in this ticket's own body: (a) the
> payment-side double-debit on a full-after-partial refund — retired 2026-08-27 by the
> `discountItemRefundTender` fix plus the partial-then-whole BLOCK (see "ALL REMAINING ITEMS BUILT +
> ADVERSARIALLY VERIFIED + SHIPPED 2026-08-27" below); (b) ungated category routes — the owner
> explicitly decided "ACCEPTED AS-IS" 2026-08-26 (JWT-only, matching the IPC handlers), so this was
> a decision, not a gap. Do not re-open either without new owner input. Real residual follow-ups
> (dead-end refund message, no undo on a per-item refund, missing table-exists guard, no REST twin
> for batch-delete, stale-response guard) are already tracked as their own tickets, LIRA-146 through
> LIRA-151, below.

### Summary

Continuation of archived **T-08 "IMEI & Warranty Tracking"** (SPRINT_FEB_19_28_2026.md, completed
Jan 24) — T-08 shipped only the sale-line free-text IMEI prompt + receipt print. What exists today:
`sale_items.imei` (manual text at POS, shown on sale detail/receipt), `products.imei` (single
column, NOT exposed in any UI, NOT searched anywhere), `products.warranty_expiry` (dead column —
no UI writes/reads it, no logic). POS/inventory search matches name/barcode/category ONLY —
scanning the IMEI barcode off a phone box finds nothing. Barcode and IMEI are separate concepts.

### Owner decision record (interviewed 2026-08-23, 8 questions)

1. **Unit model**: ONE product per MODEL ("iPhone 13", stock N, one shared cost/price) with a list
   of per-unit IMEIs attached — NOT one product row per phone, NOT per-unit pricing. New
   `product_units`-style table: product_id, imei (unique), status IN_STOCK/SOLD, sale_item link.
2. **Search**: IMEI joins the search everywhere barcode works — POS product search, scanner lookup
   (scanning a unit's IMEI barcode resolves the model AND preselects that unit), Inventory search.
3. **Uniqueness**: duplicate IMEI on any active in-stock unit is BLOCKED with an error naming the
   existing product.
4. **Warranty**: `warranty_months` on the product (empty = none); checkout stamps
   warranty-until = sale date + months on the sale line; receipt prints it; sale detail shows
   covered/expired. The dead `products.warranty_expiry` column is retired (stop projecting it).
5. **Sale-time strictness**: a product WITH registered IMEIs requires identifying the unit sold
   (scan auto-selects, or pick from the in-stock IMEI list on the cart line). Products without
   IMEIs sell exactly as today.
6. **Intake**: restocking prompts scan/type one IMEI per unit added, skippable; attach later from
   the product form; WARN (never block) when registered in-stock IMEIs ≠ stock_quantity.
7. **Lookup**: the same search finds SOLD units and answers the walk-in question: product, sale
   date, sold price, client (if recorded), warranty covered-until/expired.
8. **Refund/void**: the generic refund flips the unit back to IN_STOCK in the same motion as the
   stock restore (rule 20 symmetry), warranty voided.

### Owner decision record — round 2 (interviewed 2026-08-23, refund × warranty + gating)

9. **Which products get units — flag on the CATEGORY**: `product_categories` gains a
   "tracks IMEI units" boolean, seeded ON for the seeded "Phones" category (verified seeded:
   create_db.sql:276-282, re-resolved 2026-09-23). Replaces the cart's fragile
   `category.includes("phone")` heuristic
   (Cart.tsx:101 — a category named "Headphones" matches it today; renames kill it silently).
   Products inherit from their category; flag editable in Settings so Tablets/Smartwatches can
   join later without code.
10. **Refund UI for phone sales (owner's own design)**: refunding a sale line whose product
    tracks IMEI units opens a phone-specific refund UI with TWO optional inputs:
    - **`is_defective` flag** — recorded on the unit; the unit still returns straight to
      IN_STOCK (owner explicitly rejected a RETURNED/inspection state: "we don't have to make
      any changes to the state of the phone"). The flag is informational — visible on the unit
      list and in IMEI lookup — not a sale blocker.
    - **New warranty expiry (date)** — the operator may SET the warranty expiry going forward
      for that IMEI at refund time (covers warranty-swap/repair-return policy by human judgment
      instead of a hardcoded clock rule; e.g. type the original expiry to preserve the clock, or
      a new date, or leave empty = warranty simply void with the refunded sale).
11. **Warranty lookup precedence** (follows from #10): for an IMEI, the effective warranty is
    (a) the operator-set override from the most recent refund if present, else (b) VOID if its
    sale was refunded, else (c) the sale line's stamped warranty-until. A refunded sale must
    never report "covered" from its own stamp.
12. **Re-sale of a returned unit**: a new sale stamps a fresh warranty-until (sale date +
    months) as normal. _Answer during build, don't block:_ whether an operator warranty
    override from #10 should prefill/beat the fresh stamp on that unit's next sale — default
    plan: the new sale's own stamp wins and the override is cleared, since the override exists
    for customers who KEPT a phone, not for the next buyer.

### Build decisions (recorded during the build, 2026-08-25 — phases 1-4)

- **#12 answered (default confirmed)**: a re-sold unit gets a FRESH warranty stamp and
  `ProductUnitRepository.markSold` clears any refund-time `warranty_override_until` — the
  override exists for a customer who KEPT the phone, not the next buyer. `is_defective` is
  deliberately KEPT across a re-sale (unit history, informational — decision #10's spirit).
- **Unit-tracked cart lines are quantity-1** (one unit per line; selling 3 phones = 3 lines).
  `processSale` rejects `quantity > 1` on a line carrying `product_unit_id`. Keeps the
  `sale_items.imei` projection exact (one column, one IMEI) and makes per-item refunds and
  warranty stamps per-unit by construction.
- **Strictness under drift (decisions #5+#6 combined)**: a line WITHOUT a unit id is rejected
  while the product still has IN_STOCK registered units unclaimed by earlier lines of the same
  sale; once registered units are exhausted (or none were ever registered), surplus
  unregistered stock sells exactly as today. Enforcement keys on registered units, not the
  category flag — the flag gates UI affordances only.
- **One owner of "which unit sold" (§13-14)**: the `product_units` row is truth;
  `sale_items.imei` is a projection stamped from the unit row at sale time (overriding any
  free-text IMEI). `sale_item_id` is KEPT on the unit after a refund flip — it is the
  decision-#11(b) warranty-void pointer.
- **Refund extras transport**: `is_defective` + `warranty_override_until` ride
  `refundTransaction`'s opts as `refundUnitExtras` (same one-payload pattern as `refundLegs`),
  Transactions-page whole-refund flow only; void flips units with no extras; the per-item
  refund path flips its line's unit(s) with no extras.
- **Fixed pre-existing bug**: `TransactionRepository._restoreStock` over-restored stock when a
  sale was partially item-refunded then fully refunded/voided (restored full `quantity`,
  ignoring `refunded_quantity`). Now restores the remainder, failing-first proven.
- **REPORTED, not fixed (owner decision needed)**: the payment-side analog — a full
  `refundTransaction` after a partial `refundSaleItem` re-mirrors the ORIGINAL's FULL payment
  legs (`_reversePayments`), double-debiting the drawer by the already-refunded amount
  (probe: $30 sale → $10 item refund → full refund moved $40 total). Options: block full
  refund after a partial, or pro-rate the mirrored legs to the remainder. Re-confirmed
  still present by the adversarial review (2026-08-25).

### Adversarial review (execution-based, 2026-08-25 — verdict: SHIP WITH FIXES, fixes applied)

Eleven probe scripts against the compiled dist; every reversal path netted to exactly 0
(stock, drawer, profit, unit state) and every failure failed CLOSED. Two MAJOR findings,
both fixed same-day with failing-first regression tests:

1. **Order-dependent strictness** (fixed): the plain-line strictness check excluded only
   unit ids claimed by EARLIER lines, so a drift-surplus sale (2 unit lines + 1 plain
   line, stock 3) was falsely rejected when the plain line came first in the cart array.
   Now request-scoped: the exclusion set is every unit id referenced anywhere in the sale.
2. **Refund flip vs re-registered IMEI** (fixed, error-quality only): refunding a sale
   whose unit's IMEI was meanwhile re-registered IN_STOCK elsewhere (legal per decision
   #3) hit the partial unique index and surfaced a raw `UNIQUE constraint failed` with no
   recovery hint. Still fail-closed (refund blocked, clean rollback), but now a named
   error telling the operator which product/unit holds the IMEI and to delete/correct it
   in the product form, then retry.
3. **NOTE (no fix, no reachable trigger)**: `processSale`'s `if (saleId)` UPDATE branch
   has no status guard against re-processing an already-COMPLETED sale; today only draft
   completion uses it (drafts never link units — probed safe). If an "edit completed
   sale" feature is ever added, add a status guard first: the unconditional
   `DELETE FROM sale_items` would `ON DELETE SET NULL` the units' decision-#11(b)
   warranty-void pointer.

### Acceptance Criteria — ALL MET (built 2026-08-25, e2e lira-143 + lira-web-023)

- [x] Import N phones: one product, stock N, scanned IMEIs (skippable, drift warning) —
      e2e step (a): register via the real Units section, drift banner shows/clears, warn-only.
- [x] Scan an IMEI barcode at POS → the model appears with that unit preselected; selling it marks
      exactly that IMEI SOLD and stamps warranty-until on the sale line + receipt — e2e step (b).
- [x] Selling an IMEI-carrying product without identifying the unit is impossible (picker always
      renders while units exist; backend strictness error surfaces on submit — e2e step (c));
      a no-IMEI product's flow is byte-identical to today (flag-OFF gate unchanged, unit tests).
- [x] Searching a sold IMEI (Inventory) shows the full story incl. warranty status — e2e step (d)
      (ImeiStoryCard; POS wiring of the same card is a nice-to-have follow-up).
- [x] Duplicate active IMEI rejected, named error — repo test + e2e step (a).
- [x] Refund returns the unit to stock; e2e proves sell+refund nets unit status, stock, drawer,
      and warranty display to the pre-sale state, failing-first proven (rule 17: with
      \_reverseProductUnits stubbed out the spec fails at Expected IN_STOCK / Received SOLD).
- [x] Dual transport (rule 19): unit CRUD/search/lookup/refund-extras mirrored on REST;
      web e2e lira-web-023 (68 passed total).
- [x] Migration in BOTH migrations/index.ts and create_db.sql (rule 10); product_units has
      id/created_at/updated_at/tenant_id (rule 5); FEATURE_GUIDE §13 walkthrough done pre-build
      (recorded in the phase-4 commit and the Build decisions above).

### Phase 7 record (e2e, 2026-08-25)

- Desktop suite: **258 passed, 0 failed** (baseline 257 + lira-143-imei-warranty.spec.ts), 8.0m.
- Web suite: **68 passed, 0 failed** (baseline 65 + lira-web-023-imei-units.spec.ts, 3 tests), 2.0m.
- Playwright tsconfig typecheck 0 errors; better-sqlite3 left on Electron ABI; temp profiles cleaned.
- **Layer-seam bug found by the e2e (fixed same-day)**: `resolveScanCode` returned the raw
  `ProductEntity` shape instead of `ProductDTO` — the POS scan-add crashed CartLineRow on
  `retail_price` undefined. Fixed via `ProductRepository.findProductDtoById`; core 2236 +
  backend 592 re-verified. The class of bug hand-built-IPC specs structurally can't catch.
- **Follow-up gap (observed, not fixed)**: `POST /api/inventory/products` never resolves
  `category_id` from the category NAME (the IPC handler does), so `tracks_imei_units` never
  projects onto a REST-created product. UI affordance only, no backend gate — but a real
  dual-transport parity gap; documented in lira-web-023's header comment.

### Phone Units management view (owner-requested follow-up, built 2026-08-26)

Dedicated view at `/inventory/units` (button on the Inventory page — the button itself
shipped early inside LIRA-144's 44eb2d17 via the shared working tree; this build adds the
route/page that makes it live). Built by a 7-agent workflow (2 parallel implementers +
integrator + 3 adversarial verifiers + fixer): `product-units:list` + `POST
/api/product-units/list` (one Zod schema, envelope/role parity, rows + COUNT share ONE
extracted WHERE — mutation-proven), page with status/defective/search filters, pagination,
story-card row expand, IN_STOCK delete. The story join was extracted into a shared
`UNIT_PROVENANCE_JOIN` used by both the walk-in lookup and the list (rule 14). One BLOCKER
found and fixed failing-first (mount-armed debounce cancelled pagination clicks; 5/5 full
runs stable after). e2e: management-view step appended to lira-143 spec.

**Warranty-term display (owner-reported 2026-08-26, fixed same day):** editing a product's
warranty_months did not reflect on the Phone Units page. Two stacked causes, both fixed:
(1) display gap — in-stock units never carried the model's TERM (only sale-stamped facts),
so fresh stock of a 6-month model read "No warranty"; the unit reads now carry
`product_warranty_months` (display-only, never fed to computeWarrantyStatus, no retroactive
stamping — verified with 19 probe checks through the real update path) and NONE+IN_STOCK
renders "N mo — starts at sale". (2) real cache staleness — a product save touches no
product_units row, so nothing invalidated the unit list/story caches inside the 30s
staleTime; ProductForm now prefix-invalidates both on save. E2E drives the owner's exact
repro through the real form (failing-first captured for both causes). Adversarial verify:
no BLOCKER/MAJOR; cross-tenant canary held; 84-combo badge truth table exact.

**Owner decisions on the open items (2026-08-26):**

- Category endpoints ungated → **ACCEPTED AS-IS** (JWT-only, matching the IPC handlers).
- CSV bulk import cache invalidation → **DISMISSED** (the import format carries no warranty
  fields; not a real path).
- REST create/update category_id resolution → **DONE 2026-08-27**: resolution moved INTO
  InventoryService (one site — the duplicate IPC-handler resolution deleted per rule 14);
  omitted/blank category on update = classification unchanged (COALESCE in
  updateProductFull, matching the stock_quantity idiom); caller-supplied conflicting
  category_id no longer forwarded (name is authoritative); recorded TODO: PUT
  /products/:id still has no Zod schema (rule 19c) and the existing updateProductSchema
  speaks REST field names, so it is not a drop-in.
- ALL REMAINING ITEMS **BUILT + ADVERSARIALLY VERIFIED + SHIPPED 2026-08-27** (verified
  workflow: 2 implementers, integrator, 2 verify lenses, fixer). During verification a
  MAJOR pre-existing money bug surfaced and was fixed at the root: `refundSaleItem`
  pro-rated payment/debt legs on the WRONG denominator (transaction amount, i.e. the
  discounted total) while refunding the undiscounted line price — every per-item refund
  of a DISCOUNTED sale over-refunded by the discount share, in every currency leg. Legs
  and debt now pro-rate on one named base (line share of sale total); profit arm
  unchanged; 5-case failing-first guard (SalesRepository.discountItemRefundTender).
  This also retires the old "payment-side double-debit" open item entirely: partial-
  then-whole is now BLOCKED (named error, refund/void/refundBySaleId all guarded,
  zero deltas on a blocked attempt), and the per-item route it directs to is now exact.
  E2E: lira-143 spec grew to 4 tests (delete-cascade frees IMEIs + keeps sold history;
  whole-refund refused after per-item, drawer unmoved), green twice + post-fix;
  lira-web-023 3/3 green (also the rule-19d proof for fad39e58).
  NEW FOLLOW-UPS from this pass (MINOR/NOTE): fully-item-refunded sales get a dead-end
  block message (nothing left to refund — message could say so); item refunds have no
  undo (a mis-keyed per-item refund has no reversal path — pre-existing, now the forced
  route); deleteProduct/batch hard-depend on product_units without a table-exists guard
  (only matters on pre-v157 DBs); batch-delete has NO REST twin (pre-existing, cascade
  widens the gap) and REST delete answers failures with HTTP 400 not the 200 envelope;
  the delete-confirm dialog's IMEI fetch lacks a stale-response guard; DEFERRED: the
  register's "product deleted" label on sold units (needs the shared typing files the
  parallel carrier-lines session holds).
  Original decision record (2026-08-26, one pass):
  (1) whole-sale refund after a partial item refund is BLOCKED with a named error
  directing to per-item refunds (fixes the drawer double-debit; per-item math already
  pro-rates correctly; known edge: phone-refund extras UI unreachable for such sales);
  (4) Phone Units TABLE shows the forward-looking term for IN_STOCK units whose verdict
  is NONE or VOID ("N mo — starts at sale"); operator-override verdicts and the story
  card keep showing the true verdict incl. VOID; (5) LIKE metacharacters escaped in the
  Phone Units search (shared escape helper, ESCAPE clause); (6) Phone Units Excel/PDF
  export fetches ALL rows matching the current filters (paged loop, capped ~5000), not
  the visible page; (7) product soft-delete CASCADE-deletes its IN_STOCK units after a
  confirm listing the IMEIs (frees the locked IMEIs in the active-unique index); SOLD
  units are NEVER touched — they remain as history, labeled "product deleted" in the
  register. Owner explicitly rejected block-on-delete (more burden, not less).
- `search` does not escape LIKE metacharacters — a typed `%`/`_` acts as a wildcard.
- Excel/PDF export on the server-paginated table exports only the visible page.
- `electron-app/handlers/__tests__/` runs under NO jest runner and no CI job (pre-existing —
  affects all 20+ handler tests, not just the new ones); CI also never runs core's jest.
- Units of soft-deleted/deactivated products still appear in the register (arguably correct
  for history; flagging for a deliberate decision).
- A partially-refunded multi-IMEI legacy line can show its returned unit as COVERED
  (impossible under the qty-1 rule; only hand-crafted data).
- Web-mode execution proof for the new page is REST-route-level only (house convention).

### Technical traps (from the diagnosis)

- `sale_items.imei` already exists — the unit link must WRITE it (keep receipts/old readers
  working) while the unit table owns the state; never two owners of "which unit sold" (§13-14).
- POS search fragments live in `ProductRepository` (~:149 and ~:705) — extend ONCE per rule 14,
  not per call site; `findByBarcode` needs the IMEI fallback for scanner flow.
- Refund restock is generic (`TransactionRepository` sale-stock restore) — the unit flip needs a
  named owner wired there, same pattern as `_reverseExchangeLotEffects` (rule 20).
- Warranty stamping at checkout must ride `sale_items` (per-line), NOT `products` — the sale is
  the event that starts the clock (owner decision #4).

---

## LIRA-146: Whole-refund block message is a dead end on a FULLY item-refunded sale — LOW (follow-up, verifier finding 2026-08-27)

**Status:** DONE — committed `78457756`

`TransactionRepository._assertNoPartialItemRefunds` fires for any sale with
`refunded_quantity > 0` — including one where EVERY line is already fully item-refunded.
The operator is told to "refund the remaining items individually" when nothing remains.
Fix: when all lines are fully refunded, throw a distinct message ("This sale has already
been fully refunded item-by-item — nothing remains to refund."). Repo-level test both ways.

## LIRA-147: Per-item refunds have no undo — NEEDS OWNER DESIGN (raised 2026-08-27)

**Status:** DONE 2026-10-02 (not yet committed) — built for the STANDALONE per-item refund (`SalesRepository.refundSaleItem`/`undoSaleItemRefund`), both transports. NOT built for a session-basket item refund (`refundSessionBasketItem`, `metadata_json.refundType === "sessionItem"`) — reported as a scoped-out gap below, the button and REST/IPC path both explicitly refuse that case with a named reason rather than attempting a risky generic reversal.

**What it does:** `SalesRepository.undoSaleItemRefund` inverts exactly what the refund itself wrote — negates the refund's own `payments` rows (+ matching drawer deltas, handles both plain pro-rata legs and an operator `refundLegs` override identically since both resolve to concrete payment rows), negates the refund's `debt_ledger` 'Refund Reversal' rows back into 'Sale Debt' rows, negates the refund's `profit_usd`/`profit_lbp` stamp onto the new row, decrements `sale_items.refunded_quantity`/`products.stock_quantity`, re-consumes FIFO cost batches via a new traced `StockBatchRepository.unrestoreForSaleItem` (the exact inverse of `restoreForSaleItem`, using the existing `is_restored` flag), and flips phone/IMEI units back to SOLD via the same `markSold` the original sale used. Refuses: a second undo of the same refund ("already been undone"); undoing when a returned unit has since been sold again under a different sale (detected via a `restoredUnitIds` snapshot stamped onto the refund's own metadata at refund time — added in this change, so it precisely identifies which units THIS refund flipped, not just a same-count heuristic); undoing when the stock the refund restored has since been consumed by other activity; undoing anything that isn't a standalone per-item refund (whole-sale refund, session-basket item refund). Posts a new `REFUND_UNDO` transaction type (added to `NON_REVERSIBLE_TRANSACTION_TYPES` — itself terminal, same as REFUND — and to `ProfitRepository.PROFIT_TXN_TYPES` so its profit is visible on the Profits page), visible on the Transactions page (not `is_auto` — operator-initiated per rule 26), linked to the refund it undoes via `metadata_json.refundTransactionId`. Admin-only on both transports (`requireRole(["admin"])` IPC + REST, plus a UI-level `isAdmin` gate on the Transactions-page button — defense in depth, backend remains the real authority). UI: an amber "Undo refund" button appears on an active per-item REFUND row's Actions cell for an admin, with a `window.confirm` step (same convention as Void/Refund).

**Tests (failing-first per rule 17 where meaningful — see each file's own header for exactly what was proven red/green; this is new capability, so most "red" is the double-undo/dependent-activity guards proven directly within the test, not a before/after diff of finished code):** `packages/core/src/repositories/__tests__/SalesRepository.undoItemRefund.test.ts` (4 tests — full nets-to-zero across stock/batch/unit/drawer/profit, double-undo refusal, resold-unit refusal, whole-sale-refund refusal); `electron-app/handlers/__tests__/salesHandlers.undoItemRefund.test.ts` (5 tests — admin gate, payload validation, audit-on-success-only); `backend/src/api/__tests__/salesUndoItemRefund.api.test.ts` (6 tests — REST parity, 403 for staff, 401 unauthenticated, envelope parity on both business-rule and thrown failures); `frontend/src/features/audit/components/__tests__/ActionsCell.undoRefund.test.tsx` (5 tests — button visibility by admin/type/status). All green. 20 `SalesRepository.*` suites (88 tests), `StockBatchRepository.fifoAndReversal`, `profitRecognition.guard`, `TransactionRepository.nonReversibleGate`, `moduleDebtTypes.guard`, `ProfitRepository.itemRefundOriginalLink`, full `salesHandlers.*` (6 suites/34), related backend sales REST suites (22 tests), and the full frontend `features/audit` suite (36 suites/373 tests) all re-run green — no regressions. `yarn workspace @liratek/core typecheck` (10.7s), `@liratek/frontend typecheck` (27.7s), `@liratek/backend typecheck` (15s), `@liratek/electron-app typecheck` (4s), `@liratek/ui typecheck` (3.9s) all clean; eslint on touched files clean (pre-existing `any` warnings only, no new errors).

**Known gaps for the owner:**
1. **Session-basket item refund has no undo.** `refundSessionBasketItem` pools money against a session's shared account/legs across potentially several prior item-refund calls on the same basket — materially riskier to reverse generically than the standalone path. Deliberately refused with a clear message rather than attempted under this pass's time budget; a real follow-up ticket, not silently dropped.
2. **FIFO batch tracing is conservative for a split consumption row.** `restoreForSaleItem`'s own `is_restored` flag only marks a row fully restored — a refund whose restore SPLIT a batch-consumption row (requested quantity didn't land on a row boundary) leaves that split fraction untraceable by id, so `canUnrestoreForSaleItem` refuses the undo even though nothing was actually resold (a false negative, never a false positive — it never risks driving `quantity_remaining` negative or misattributing cost). Rare in practice (single-unit IMEI-tracked sales are the dominant case and are unaffected), documented in the repository's own doc comment.
3. **No e2e coverage** (excluded from this pass's scope per the lean-routine instruction — no e2e runs) and no "Undo Refund" entry added to the Transactions-page type filter dropdown (`auditConstants.ts` `FILTER_GROUPS`) — the row is still visible by default, just not individually filterable by type.

An item refund books a REFUND transaction with no `reverses_id`, and REFUND is in
`NON_REVERSIBLE_TRANSACTION_TYPES` — a mis-keyed per-item refund has no correction path
short of re-selling the item. Pre-existing, but the LIRA-146 guard now makes per-item the
ONLY route on partially-refunded sales, so the gap is more visible. Needs an owner
decision on the correction mechanism (a compensating re-charge? an admin void of the item
refund with stock/unit/debt symmetry per rule 20?). Do not build without the interview.

## LIRA-148: deleteProduct cascade needs the product_units table-exists guard — LOW

**Status:** DONE — committed `41db79e7`

`InventoryService.deleteProduct`/`batchDeleteProducts` now hard-depend on `product_units`;
on a pre-v157 DB (or a hand-built test schema without the table) ALL product deletion
throws and nothing is deleted. Every OTHER product_units consumer uses the cached
`_productUnitsTableExists()` sqlite_master guard — add the same here (skip the cascade,
not the delete). Failing-first: schema without the table → delete succeeds, no cascade.

## LIRA-149: Batch product delete has no REST twin; REST delete failures break envelope parity — MEDIUM (rule 19)

**Status:** DONE — committed `41db79e7`

(a) `inventory:batch-delete` (IPC) has no `backend/src/api/` route — in the browser the
batch-delete button reports success having deleted nothing. Mirror it (same roles, same
cascade, `{success,...}` envelope). (b) `DELETE /api/inventory/products/:id` answers a
service failure with HTTP 400 instead of the IPC-identical HTTP-200 `{success:false}`
envelope — newly reachable now that the cascade gives the delete a real failure path; the
adapter branches on `result.success`, so align to 200 (CLAUDE.md envelope-parity rule).

## LIRA-150: Delete-confirm IMEI dialog lacks a stale-response guard — LOW

**Status:** DONE — committed `41db79e7`

`ProductList`'s delete confirm fetches the product's IN_STOCK IMEIs asynchronously; fast
clicking product A's delete then product B's can render A's IMEIs in B's destructive
dialog. Guard with the house stale-response pattern (request id / abort / disable second
click while the first fetch is in flight). Component test with two interleaved fetches.

## LIRA-151: Wire the orphaned test suites into gates — MEDIUM (infrastructure) — PARTIAL (2026-09-04)

(a) `electron-app/handlers/__tests__/` (20+ suites incl. productUnitHandlers) runs under
NO jest runner — `electron-app`'s jest config roots only `schemas/`; every handler test
passes only when invoked by hand. (b) CI never runs `packages/core`'s jest suite (2400+
tests) — `yarn test` does locally, but ci.yml lacks the job. Add the runner root + the CI
job; budget for the runtime cost. Suite-count floors per the LIRA-123 lesson.

**Status: DONE — (b) DONE (this pass, 2026-09-04), (a) DONE separately in `56a26de1`
(2026-09-13, "revive 15 rotted handler suites and give them a runner"): `electron-app/jest.config.cjs`
now roots `handlers/__tests__` alongside `schemas/`, and `.github/workflows/ci.yml` has an
`electron-handler-tests` job (floor 25 suites / 120 tests) in `build`'s `needs`. Re-verified
2026-10-02: `yarn workspace @liratek/electron-app test` → 45 suites / 256 tests passed, 32.9s —
comfortably above the CI floor, no further action needed.**

**Complementary to LIRA-170:** LIRA-170 (above) fixed the LOCAL gate — root `yarn test` now
runs every workspace and reports each one instead of bailing at the first failure. This
ticket fixes the CI gate — `packages/core`'s suite now actually runs on every PR. Neither
subsumes the other: a green local `yarn test` was never wired into GitHub's PR checks, and a
green `core-tests` CI job says nothing about a dev's local run silently skipping core after
an earlier workspace failure. Both were needed; both are now done.

**(b) — DONE.** Added a `core-tests` job to `.github/workflows/ci.yml`: checkout + the same
setup action + the same `actions/cache/restore@v4` (identical `path`/`key`) used by every
other job, then `yarn rebuild:node` (core jest needs the Node ABI, same fix `backend-tests`
already carries for the identical reason), then `yarn workspace @liratek/core test`, wrapped
in a suite-count-floor check modeled on `scripts/run-e2e.mjs`'s `--min` (that script itself
was NOT modified — the floor logic here is a standalone inline shell step, since the ticket
scope is `ci.yml` only). `build`'s `needs` now includes `core-tests` alongside
`lint`/`typecheck`/`backend-tests`/`frontend-tests`.

Floor: 130 suites / 1300 tests — roughly half of the verified current counts (263 suites /
2781 tests, reconfirmed locally 2026-09-04 via `yarn workspace @liratek/core test`, exit 0,
21.5s real time — matches CLAUDE.md's "~21s locally" claim and LIRA-170's own captured
numbers exactly). Same margin `run-e2e.mjs` documents for its own `DEFAULT_MIN`: comfortably
below normal churn (adding/removing a handful of suites never trips it), nowhere near the 0
that a silently-no-op'd step would report. The floor step was proven against three cases
before being trusted: (1) fed the real captured 263/2781 output → passes; (2) fed empty
output (the LIRA-123 "exited 0, ran nothing" mode) → correctly fails; (3) fed a synthetic
50-suite/400-test partial run → correctly fails as below-floor. All three were run locally
against the extracted shell script, not just eyeballed.

**Verified:** YAML parses clean (`js-yaml`); the embedded floor-check script passes
`bash -n`; a step-by-step diff against `backend-tests` confirms steps 0-2 (checkout, setup
action, cache-restore path+key) are byte-identical, and the `yarn rebuild:node` step's `run:`
text is identical to backend-tests' own rebuild step. **NOT verified: the job has not run on
GitHub Actions.** Ubuntu's cache restore, corepack/Node version resolution, and actual
runtime under CI's shared runner remain unconfirmed until a real PR run.

**(a) — NOT wired in this pass, spun off as its own ticket.** Per the ticket's own
instruction ("if a substantial number fail, do NOT fix them all in this pass"): ran all 21
orphaned suites via a throwaway `jest --roots handlers/__tests__` invocation (no config
committed). Result: **15 of 21 suites failed (71%), 41 of 92 tests failed** — not "a couple
of trivial fixes." Four distinct root causes, none of them one-line:

- **11 suites** — `Database not initialized. Call initDatabase() first.` (dbHandlers,
  dbHandlers.behavior, dbHandlers_registration, currencyHandlers.behavior,
  inventoryHandlers, inventoryHandlers.behavior, clientHandlers, omtHandlers,
  exchangeHandlers, rateHandlers, rechargeHandlers) — the config has no setup file that
  mocks or initializes the core DB singleton the way `backend/jest.config.cjs` does.
- **2 suites** (`updaterHandlers`, `updaterHandlers_registration`) —
  `SyntaxError: Identifier '__filename' has already been declared`: `updaterHandlers.ts`'s
  own `const __filename = fileURLToPath(import.meta.url)` collides with the `__filename`
  ts-jest's CJS transform auto-injects. A source/transform-config mismatch, not a test typo.
- **1 suite** (`closingHandlers`) — `Cannot read properties of undefined (reading 'handle')`
  on `ipcMain.handle`: the `electron` module isn't mocked for this suite's shape (no
  `moduleNameMapper`/`__mocks__/electron.ts`, unlike backend's).
- **1 suite** (`maintenanceHandlers`) — `Cannot find module '../../services/MaintenanceService'`:
  a stale import path from a since-moved/renamed service; the test itself is out of date
  with source.

This is real jest infrastructure work (an electron mock, a DB test harness/init strategy,
one fixed import path, one ts-jest transform fix) spanning most of the 21 suites, not a
runner-root flip. Widening `roots` and adding a `test` script now would ship 15 red suites
as the "new" gate — exactly the misleading-green this ticket exists to prevent. **Filed as
its own follow-up ticket** (not yet numbered in this file) to fix the harness and each
suite's failure class deliberately, then wire in `electron-app/jest.config.cjs` +
`electron-app/package.json`'s `test` script — which `scripts/run-tests.mjs` (LIRA-170) will
then pick up automatically with no further changes needed there.

## LIRA-152: Phone Units register — "product deleted" label on sold history rows — LOW (DONE)

**Status:** DONE — committed `41db79e7`

Sold units of a soft-deleted product stay in the register (correct — history), but nothing
says the product is gone. Add `p.is_deleted AS product_deleted` to the unit list/story
reads (the shared UNIT_PROVENANCE_JOIN) and render a muted "product deleted" chip next to
the product name. **UNBLOCKED 2026-09-04**: the shared typing files (`electron.d.ts`,
`backendApi.ts`, `packages/ui` types) this depended on shipped with LIRA-145's carrier-line
usage expense feature (`8845ef2a`, `7f229d99`, both 2026-08-27). Ready to build — TODO.

## Backlog (parked ideas, owner to green-light)

- Cart unit picker "register & select" for an unregistered scanned IMEI (merges intake
  and sale for the drift case, keeps the unit tracked).
- Wire ImeiStoryCard into POS search (today: Inventory + Phone Units only).
- "Products | Units" tab toggle on the Inventory page (nicest UX; LIRA-144's filters have
  landed so the collision risk is gone once LIRA-145 commits).

## LIRA-158: Profits & Closing still report the commission ESTIMATE, not the settled figure — MEDIUM (DONE)

**Status:** DONE — `8c453764` (report the SETTLED commission, not the estimate), `8a868fe3`
(defer cashless settlement commission until the client repays, D17), `25199c74` (fix three
pre-existing bugs in the daily stats snapshot) — all 2026-08-31. See "LIRA-158 follow-ups" below
for residual gaps spun into LIRA-159/160/161.

**Origin:** fallout of LIRA-095 (commit `43948a35`), found by the adversarial reporting pass and
verified against source before filing. Nothing here is a money bug — the ledger and drawers are
correct. It is entirely what the reports DISPLAY.

### Root cause, one sentence

`financial_services.commission` is written ONCE at creation with the auto-calculated **estimate**
and never updated; the real commission the operator types at settlement lands only in
`supplier_settlements`, `settlement_commission_allocations` and the `SUPPLIER_PAYS_US` ledger
credit — and not one Profits or Closing query reads any of those.

Before Phase 2 that was harmless: the estimate WAS the number. Now it is a guess that settlement
overrides, so every consumer of `fs.commission` reports a figure that is simply out of date.

### The symptom, concretely

OMT SEND, x=100, f=5. App estimates the shop's cut at $0.50. At settlement the operator enters the
real $2.00.

| Surface                    | Shows                             | Should show              |
| -------------------------- | --------------------------------- | ------------------------ |
| Suppliers page             | **$2.00** on settlement day       | — correct today          |
| Profits → Commission       | **$0.50**, on the transaction day | $2.00, on settlement day |
| Closing → daily commission | **$0.50**, on the transaction day | $2.00, on settlement day |
| Dashboard analytics        | **$0.50**                         | $2.00                    |

**The asymmetry is the point:** Suppliers and Profits now permanently disagree about how much
commission the shop made, and nothing reconciles them.

### Surfaces, each verified against source

| #   | Surface                                               | Location                               | Verdict                                                                                                                      |
| --- | ----------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | `getRealizedCommissionTotals`                         | `ProfitRepository.ts` ~:1367           | BROKEN — sums the stale creation-time estimate                                                                               |
| 2   | `getPendingCommissionTotals` / `ByProvider`           | `ProfitRepository.ts` ~:1407           | BROKEN — shows a dollar figure settlement can override outright                                                              |
| 3   | `getFinancialSettledByCurrency` / `PendingByCurrency` | `ProfitRepository.ts` ~:647            | BROKEN — same cause, one hop away via stamped `t.profit_*`                                                                   |
| 4   | `getUnsettledSummaryByProvider`                       | `FinancialServiceRepository.ts` ~:4430 | ACCEPTABLE — same number as #2 but self-documented inline as an estimate                                                     |
| 5   | `getAnalytics` (Dashboard)                            | `FinancialServiceRepository.ts` ~:4481 | BROKEN — `is_settled = 1` gate does not fix a stale number underneath                                                        |
| 6   | Closing daily commission (`finProfit`)                | `ClosingRepository.ts` ~:693           | **BROKEN, most owner-visible** — verified NOT gated on `is_settled` at all; sums every row's estimate on the transaction day |
| 7   | Suppliers Outstanding / FIFO / settle tab             | `SupplierRepository.ts` ~:1071, ~:1917 | CORRECT — reads the real entered figure from the ledger credit                                                               |
| 8   | D1.1 gross transaction row                            | transactions consumers                 | CORRECT — no query sums `t.amount_*` for FINANCIAL_SERVICE; all read `fs.*`                                                  |

Item 6 also contradicts owner decision **D10** (cash basis: commission recognised on the day it is
SETTLED, not the day the transaction happened), which is currently implemented nowhere.

### The work

1. One named SQL fragment per query (rule 14, never a copy-paste) that UNIONs:
   - legacy rows (`commission_model = 0`) — keep reading `fs.commission`, unchanged; this is a
     cutover, not a restatement of history;
   - new rows (`commission_model = 1`) — read `settlement_commission_allocations`.
2. Repoint surfaces 1, 2, 3, 5 to it.
3. Closing (#6): switch to settlement-day cash basis per D10, and gate it.
4. Pending surfaces become **"N transactions awaiting settlement"** rather than a dollar amount
   settlement can override — `COMMISSION_AT_SETTLEMENT_PLAN.md` §4 Phase 3 already specifies this.
5. Extend `profitRecognition.guard.test.ts` to the new allocation queries + `ClosingRepository`.

### THE test this needs (it does not exist, and its absence is why this shipped)

Settle a batch whose entered commission is **deliberately ≠ the auto-calc estimate**, then assert
Profits AND Closing both track the ENTERED value, on the SETTLEMENT day. Every existing test uses
fixtures where the two happen to coincide, so the whole class is invisible today.

### Not in scope

The ledger, drawers and settlement math — all verified correct and untouched by this ticket.

### More details — context for a cold start

Written 2026-08-30 by the session that shipped LIRA-095, while the reasoning was still fresh.
Everything below was verified against source, not inferred.

#### 1. The estimate propagates TWO ways, not one — this is the part that doubles the ticket

`commission` is copied into the unified transaction's profit stamp at creation
(`FinancialServiceRepository.ts` ~:1881, `profit_usd: currency === "USD" ? commission : 0`).
So the stale estimate reaches reporting by two independent routes:

a. **`fs.commission`** — the column. Read by `getRealizedCommissionTotals`,
`getPendingCommissionTotals`, `getUnsettledSummaryByProvider`, `getAnalytics`, and the
Closing screen's `finProfit`.
b. **`t.profit_usd` / `t.profit_lbp`** — the STAMP, which is just a copy of (a). Read by at
least seven more sites in `ProfitRepository.ts`: ~:656, ~:687, ~:725, ~:1011 (Profits
by-module), ~:1123 (by-user / by-client), and the deferred-profit queries ~:1503-1530.

**Fixing only (a) leaves (b) stale.** The by-module Profits row, the per-cashier and per-client
figures all read the stamp. The original triage listed 8 surfaces because it only traced (a).

#### 2. The design question this forces — answer it FIRST

Should a `commission_model = 1` row stamp profit AT CREATION at all?

Owner decision **D7** says commission is recognised in the SETTLEMENT's period, not the
transaction's. If that is honoured, a new-model row should stamp **profit 0** at creation and the
profit should appear at settlement instead. That is a bigger change than repointing queries — it
alters what is written, not just what is read — and it decides whether route (b) above needs
fixing at all, or simply stops carrying the estimate.

Do NOT start repointing queries before settling this. The two answers lead to different work.

#### 3. The pattern to copy (and the trap that just bit us)

There is already a JS/SQL twin pair gated on `commission_model` in this exact file:
`isPendingSupplierSettlement` (JS) and `pendingSettlementSql()` (SQL). Copy that shape — same
branch order, same terms, changed in lockstep.

**The trap:** LIRA-095 shipped with `SUPPLIER_OWED_EXPR` reading EVERY row as gross, including
rows written before the cutover. A legacy OMT SEND booked at `x+f-c` read back as `x+f`, so
settlement would have overpaid the provider by exactly `c` (measured: booked 104.50, would settle
105.00, ledger left at -0.50, cash gone). Caught pre-merge and fixed by gating both definitions.

The same trap applies here in mirror image: a query that reads
`settlement_commission_allocations` for a LEGACY row finds nothing and reports zero commission.
Every repointed query must UNION legacy (`commission_model = 0` → `fs.commission`) with new
(`= 1` → allocations). **Read a row with the formula that WROTE it.**

#### 4. Constraints that will bite

- **Rule 14.** One named SQL fragment reused by all five queries, never five copies. The whole
  reason this bug exists is that "what is the commission" was expressed in several places.
- **`profitRecognition.guard.test.ts`** statically scans `ProfitRepository` for `profit|commission`
  queries and FAILS the build on a new ungated one (plan §5 risk 7). Every query added here ships
  gated or with a documented exclusion. Note it currently PASSES and proves nothing about this bug
  — it checks that gates exist, and the bug is stale data flowing through a gate that is correct.
- **LIRA-108's divergence class.** `getRealizedCommissionTotals` (reads `fs.commission`) and
  `getFinancialSettledByCurrency` (reads the stamp) were aligned by LIRA-108 after they disagreed
  by 18 USD. Any redesign must keep them consistent or that class returns.
- **Cutover, not restatement (D3).** Do NOT backfill or recompute history. Legacy rows keep the
  embedded model forever. This is per-row, never a date cutoff.
- **No stamp-back (D6).** The allocations table exists precisely so settlement does NOT mutate
  already-posted rows. Do not "simplify" by writing the settled commission back onto
  `fs.commission` — that retroactively rewrites closed-period reports and breaks the
  additive-only reversal convention.
- **FOR-partner rows need a second gate.** Allocated shares still gate on `notPartnerPending` per
  row: supplier-settled ≠ partner-settled. Two independent gates, both required.
- **Largest-remainder rounding.** Allocations are written so the per-row shares sum to EXACTLY the
  entered amount. Do not re-derive shares at read time or they will not add up.

#### 5. Test-schema trap (cost three separate failures in the LIRA-095 session)

Any new in-memory test must CREATE `supplier_settlements` and
`settlement_commission_allocations`. A missing table makes the repository catch the SQLite error
and return `{success:false}`, so every test in the file dies in SETUP before a single assertion —
which reads like a broken assertion, not a schema gap. Enumerate every table the method under test
touches before writing the schema.

#### 6. Reproducing it by hand

1. OMT SEND, x=100, f=5 — the app estimates the cut at 0.50.
2. Note Profits → Commission and the Closing daily commission for TODAY.
3. Settle that row on the Suppliers page, entering **2.00** (deliberately ≠ the estimate).
4. Suppliers now shows 2.00. Profits and Closing still show 0.50, still dated to step 1's day.

That divergence is the bug, and step 3's "deliberately ≠ the estimate" is the thing no existing
fixture does — which is exactly why the whole class was invisible.

**Refs:** `COMMISSION_AT_SETTLEMENT_PLAN.md` §4 Phase 3 + §5 (risk register) + §6 (D6/D7/D10);
`docs/FEATURE_GUIDE.md` §8/§8.1 (corrected for Phase 2 in `a47db530`);
commits `43948a35` (the flip) and `a47db530` (docs + this ticket).

---

# LIRA-158 follow-ups — filed 2026-08-31

Nine items surfaced while shipping LIRA-158 (`8c453764`, `8a868fe3`, `25199c74`). **Every claim below
was source-verified before filing** by a five-agent triage pass; where the original framing turned out
wrong the ticket says so, because two of them would otherwise send you down the wrong path.

Recommended order: **LIRA-159 first** — it is the only one that prevents the NEXT instance of this bug
class rather than fixing this one. LIRA-160/161 then become small changes against shared fragments.

---

## LIRA-159: Monthly P&L now reports the SETTLED commission — HIGH — DONE (2026-09-04)

**Priority:** High · **Epic:** Profits/Commission-at-settlement · **Status:** **DONE**
`7d595c24` — "feat(profits,dashboard): Monthly P&L reports the SETTLED commission (LIRA-159)"

`financial_services.commission` permanently holds a creation-time ESTIMATE for `commission_model = 1`
rows and is never corrected (D6 no stamp-back, by design). LIRA-158 put every Profits/Closing reader
behind `embeddedCommission(alias, supported)`. Three readers were missed.

**This ticket includes a regression LIRA-158 itself introduced — own it.** Before LIRA-158 the
Dashboard tile, Profits and Closing all agreed on the estimate. They were consistently wrong, but
consistent. LIRA-158 corrected two of the three, so `FinancialRepository.getMonthlyPL` now
_disagrees_ with the other surfaces about the same money. That divergence is new, and it is ours.

**The three surfaces**

1. `FinancialRepository.getMonthlyPL` (`packages/core/src/repositories/FinancialRepository.ts:76-88`)
   → Dashboard "Monthly Net Profit" tile, BOTH transports. Adds the estimate for every model-1 OMT row
   in the month, never sees the operator's entered figure, and carries **no `is_refunded` gate** — so
   a voided financial service inflates it permanently.
2. Profits → Commissions tab "Commission (Pending)" column and the pending pie slice — shows a dollar
   estimate where D15 says it must show a count.
3. The REST consumer of the same payload, which receives the estimate unmarked.

**Precision the triage corrected:** "holds an estimate" is exact only for the OMT SEND/RECEIVE subset.
WHISH is force-zeroed (`FinancialServiceRepository.ts:1329-1331`) and BILL takes the
`useCostPriceFlow` branch, so for those two the column is 0 — they under-report rather than
mis-report. Do not write the fix as if all three shapes behave alike.

**Acceptance**

- `getMonthlyPL` mirrors what `ClosingRepository.getDailyStatsSnapshot` already does (legacy arm via
  `embeddedCommission` + `notRefunded`; settlement arm split bills-only vs cashless with
  `allocationNotDebtPending` + `notPartnerPending`), swapping `todayLocal` for the month bound. Reuse
  the exported fragments — do NOT re-text the predicates (rule 14).
- Surfaces 2 and 3 carry the count, per D15.
- **A static guard test** in the style of `constants/__tests__/profitRecognition.guard.test.ts`: fail
  the build when a new query reads `financial_services.commission` without `embeddedCommission(...)`,
  with an `EXCLUDED_UNITS` escape for row-level display reads. That guard already carries a staleness
  assertion — re-derive keys carefully.
- Rule 17 on each: revert, watch the specific assertion fail, restore.

**Resolution (2026-09-04, `7d595c24`):** `getMonthlyPL`'s commission arms are now COMPOSED from
`ProfitRepository.getRealizedCommissionTotals` (legacy, `commission_model=0`) +
`getSupplierCommissionTotals` (AT_SETTLEMENT, model=1) instead of a third hand-rolled
`SUM(financial_services.commission)` — closing surface 1. The sales arm also gained the
`notRefunded` gate it never had. Surfaces 2/3 (pending count on both transports) landed via
`awaiting_settlement_count` (D15). The static guard shipped as
`constants/__tests__/embeddedCommission.guard.test.ts`. All five rule-17 proofs discharged
failing-first. Core suite 260 suites / 2754 tests green at merge.

---

## LIRA-160: the daily closing snapshot OVER-recognises profit on four module sources — MEDIUM

**Priority:** Medium · **Epic:** Closing · **Status:** DONE (2026-09-04, completed same day — see both
resolution notes below) — the one gate this ticket left blocked (`notDebtPending`) was unblocked the
same day once the concurrent LIRA-162/163 edit on `ProfitRepository.ts` landed; see "Follow-up resolution"
below the first pass.

`ClosingRepository.getDailyStatsSnapshot` books profit for which no cash has arrived. Verified gate
comparison against each ProfitRepository counterpart:

| Sub-query                 | Missing gates                          |
| ------------------------- | -------------------------------------- |
| `finProfitLegacy` (~:815) | `notPartnerPending`, `notDebtPending`  |
| `rechargeProfit` (~:887)  | `notPartnerPending`, `notDebtPending`  |
| `customProfit` (~:904)    | `notPartnerPending`, `notDebtPending`  |
| `maintProfit` (~:924)     | `notDebtPending` **and** `notRefunded` |

**Why this is a real defect and not a design choice.** The snapshot is deliberately a _same-day
cash-in-hand_ view (self-documented at `profitRecognition.guard.test.ts:565-575`) whose only consumer
is the generated closing PDF. That reading does not excuse these — it _condemns_ them: a for-partner
or CUSTOMER_ACCOUNT-charged row books as today's profit when **no cash moved at all**. Wrong under
either reading of the snapshot's purpose.

Reachable today: BINANCE/BOB/app-wallets/OTHER are still born `commission_model = 0`
(`FinancialServiceRepository.ts:1489-1498`), and CUSTOMER_ACCOUNT books a `'Service Debt'` row at
`:2113`.

**Impact:** the end-of-day PDF overstates profit and cannot be reconciled against the Profits page for
the same day. Already self-documented as a known gap at `profitRecognition.guard.test.ts:592-610`.

**Acceptance:** all four carry the gates their Profits counterparts do, via the shared fragments;
`maintProfit` also gains `notRefunded`; rule-17 proof on each; the guard test's "KNOWN GAP" exclusion
text updated to match reality afterwards.

### Resolution (2026-09-04) — PARTIALLY DONE, one gate blocked by a real cross-agent scoping constraint

Verified all four line numbers and the missing-gate table against source before starting — accurate as
filed. Fixed, with rule-17 proof (revert → run the specific test → capture the verbatim failure →
restore) on each:

- `finProfitLegacy`, `rechargeProfit`, `customProfit` all now carry `notPartnerPending`, gated behind a
  new `_hasPartnerLedgerTable()` schema-drift probe (mirrors `_hasTransactionsTable()`'s existing shape)
  so the several fixtures that predate `partner_ledger` degrade to zero rather than throwing.
- `maintProfit` now carries `notRefunded("maintenance")` (unconditional — the column is a real,
  always-present production one; existing fixtures were updated to carry it).

**NOT done: `notDebtPending` on any of the four.** `ProfitRepository.notDebtPending` is a private,
unexported `function notDebtPending(...)` — this ticket's own handover explicitly forbids editing
ProfitRepository.ts (a second agent was concurrently mid-edit on that exact file for LIRA-162/163;
editing it too risked corrupting or losing either agent's in-progress work), and a private function
cannot be imported without adding `export` to it. This is a real, verified blocker, not a shortcut:
`notPartnerPending` (already exported) could be added; `notDebtPending` (not exported) could not. A
CUSTOMER_ACCOUNT-charged ('Service Debt'/'Recharge Debt'/'Custom Service Debt') row on any of these four
modules can still count in today's closing total before the client has repaid — documented as a STILL-OPEN
gap in `profitRecognition.guard.test.ts`'s `EXCLUDED_UNITS` (updated to match this reality, not the
original filing) and in the code comments at each of the four queries in `ClosingRepository.ts`.
**Recommended follow-up (near-zero risk, additive-only):** once LIRA-162/163 lands, add `export` to
`notDebtPending` in ProfitRepository.ts and wire it into these four queries + the two LIRA-161 additions
below, exactly like `notPartnerPending`.

New coverage: `ClosingRepository.lira160PartnerPendingGates.test.ts` (8 tests, all fixtures built so the
old and new predicates DISAGREE per rule 17's own warning). Full core suite: 266 suites / 2798 tests,
exit 0 (30s) — exceeds the 263/2781 baseline.

### Follow-up resolution (2026-09-04) — `notDebtPending` fence lifted, the residual gap closed

The concurrent LIRA-162/163 edit on `ProfitRepository.ts` landed; the scoping constraint above no longer
applies. Verified BOTH `notDebtPending` and `saleFullyPaid` (needed by LIRA-161 item 3, batched into this
same follow-up per the recommended-follow-up notes on both tickets) were still private/unexported before
touching the file — confirmed by grep, not assumed. Added `export` to both, changing nothing else in
`ProfitRepository.ts` (diff is exactly two `+export` / two removed-`function` lines).

`notDebtPending` is now wired into all four sources named in the acceptance criteria, plus the two
LIRA-161 additions (`loto`, which already carries it per its own resolution note below — `exchange` does
not, and re-verified as genuinely unnecessary rather than assumed, see below):

| Sub-query                                     |                            `notPartnerPending`                             |              `notDebtPending`              | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------- | :------------------------------------------------------------------------: | :----------------------------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finProfitLegacy`                             |                        ✅ (this ticket, first pass)                        |            ✅ (this follow-up)             | Resolves the row's own FINANCIAL_SERVICE transaction id via a new `_sourceTxnIdSubquery(sourceTable, txnType)` scalar-subquery helper (mirrors `ProfitRepository.allocationNotDebtPending`'s resolve-then-gate shape) — no existing fixture reliably has a matching `transactions` row for every legacy fs row (verified: `LIRA158.closingCashBasis.test.ts` test 3 does not), so an INNER JOIN would have silently dropped rows; the scalar subquery degrades a missing match to "not pending" instead, matching pre-change behaviour exactly.                                                                                                                                                                                   |
| `rechargeProfit`                              |                                     ✅                                     |                     ✅                     | Same `_sourceTxnIdSubquery` pattern, `source_table = 'recharges'`, `type = 'RECHARGE'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `customProfit`                                |                                     ✅                                     |                     ✅                     | Same pattern, `source_table = 'custom_services'`, `type = 'CUSTOM_SERVICE'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `maintProfit`                                 | ❌ (correct — `getMaintenanceTotals` itself never gates this; re-verified) |                     ✅                     | Same pattern, `source_table = 'maintenance'`, `type = 'MAINTENANCE'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `loto` (LIRA-161 addition)                    |                            ✅ (already shipped)                            |            ✅ (this follow-up)             | Already JOINs `transactions` directly (unlike the four above) — uses the real `t.id`, no subquery needed. `getLotoTotals` itself carries this gate, so this closes the ONE place the prior pass documented as "provably wider than the counterpart."                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `exchange` (LIRA-161 addition)                |                            ✅ (already shipped)                            |  ❌ — **verified unnecessary, not a gap**  | Re-confirmed independently (not just re-read from the prior agent's claim): `electron-app/create_db.sql`'s `exchange_transactions` DDL has NO `client_id` column at all, and `ExchangeRepository.createTransaction`'s payout-leg validation (`ExchangeRepository.ts` ~:505-513) explicitly rejects any non-drawer-affecting method, with an inline comment naming CUSTOMER_ACCOUNT as the excluded case ("needs a client_id, which exchange_transactions does not carry"). A table with no client association can never have a `debt_ledger` row referencing it — `notDebtPending` would always no-op. `getExchangeTotals` itself gates only `notRefunded` + `notPartnerPending`, confirming the counterpart carries none either. |
| `finProfitSettlement` / `billsOnlySettlement` |                                     —                                      | — (recognition-by-construction, unchanged) | Not in scope — no partner_ledger/debt_ledger row is ever keyed to a SUPPLIER_SETTLEMENT transaction id; the CASHLESS half already carries `allocationNotDebtPending` + `notPartnerPending` from LIRA-158 D17, untouched here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**Every schema-drift combination is handled explicitly** (not collapsed into one combined guard): each of
`finProfitLegacy`/`rechargeProfit`/`customProfit` now has four literal branches (`…Degraded` — neither
`partner_ledger` nor `transactions`; `…PartnerOnly`; `…DebtOnly`; `…Full`), verified against two real
fixtures that each have exactly one of the two tables (`ClosingRepository.lira160PartnerPendingGates
.test.ts` has `partner_ledger` but no `transactions`; `LIRA158.closingCashBasis.test.ts` has `transactions`
but no `partner_ledger`) — collapsing the two axes into a single "both or neither" guard would have
silently dropped one gate's coverage on whichever fixture is missing the OTHER table. `maintProfit` needs
only the `transactions` axis (two branches). This is why the gate-call TEXT is written literally inside
every `.prepare()` template rather than hoisted through an intermediate JS variable:
`profitRecognition.guard.test.ts` statically scans each `.prepare()` call's raw source text for the
literal substring `notDebtPending(`/`notPartnerPending(` — a value merely spliced in via `${aVariable}`
would not contain that literal text and would misread a genuinely-gated query as ungated.

**Test-schema trap, hit exactly as CLAUDE.md warned:** two existing fixtures with a `transactions` table
but a `debt_ledger` missing `transaction_id`/`covered_usd`/`covered_lbp` (`LIRA158.closingCashBasis
.test.ts`'s `createFullSchema`, `ClosingRepository.lira161ExchangeAndLoto.test.ts`) started throwing
`no such column: dlp.transaction_id` the moment `notDebtPending` became reachable in their execution
path — both fixed by adding the three real production columns (matching `electron-app/create_db.sql`'s
`debt_ledger` DDL).

**Rule 17, all five gates, verbatim:**

| Gate              | Test                                                     | Captured failure (gate removed) |
| ----------------- | -------------------------------------------------------- | ------------------------------- |
| `finProfitLegacy` | `lira160DebtPendingGates` › finProfitLegacy › excludes … | `Expected: 0, Received: 5`      |
| `rechargeProfit`  | … › rechargeProfit › excludes …                          | `Expected: 0, Received: 6`      |
| `customProfit`    | … › customProfit › excludes …                            | `Expected: 0, Received: 15`     |
| `maintProfit`     | … › maintProfit › excludes …                             | `Expected: 0, Received: 30`     |
| `loto`            | … › loto › excludes …                                    | `Expected: 0, Received: 4500`   |

Each: the specific `AND ${notDebtPending(...)}` clause removed from the branch the fixture actually
exercises, the named test run in isolation (`npx jest ClosingRepository.lira160DebtPendingGates -t
"<module>"`), the failure above captured, the clause restored, the full suite re-confirmed green.

New coverage: `ClosingRepository.lira160DebtPendingGates.test.ts` (11 tests — an uncovered-debt exclusion

- a fully-covered-debt inclusion + a no-debt-row inclusion per module, proving the gate is the real FIFO
  comparison and not a blanket "any debt row exists" check). Every fixture built so the CUSTOMER_ACCOUNT-
  charged row and the cash row disagree (rule 17's own warning against coincidental agreement).

Gates after this follow-up: core **268 suites / 2816 tests**, exit 0 (25.9s); backend **46/633**, exit 0
(25.8s); frontend **180/1360** (1 skipped), exit 0 (39.7s) — meets or exceeds every baseline.

---

## LIRA-161: the same snapshot UNDER-counts — two modules absent, one gap by omission — LOW/MEDIUM

**Priority:** Low-Medium · **Epic:** Closing · **Status:** DONE (2026-09-04) — items 1 and 3 complete;
item 2 was OUT OF SCOPE by owner instruction from the start (filed as its own ticket, LIRA-173) and is not
a blocker on this ticket's completion.

Three under-counting defects in `getDailyStatsSnapshot`, opposite in sign to LIRA-160:

1. **`loto` and `exchange` never reach `totalProfitUSD` at all** (~:933-938), though both have
   ProfitRepository counterparts (`getLotoTotals`, `getExchangeTotals`). Whole modules missing from
   the closing profit figure.
2. **For-partner sale margin reaches the snapshot on NO day, ever.** `salesProfit` (~:754) omits
   `salePaidOrPartnerSettled`'s partner-covered OR-branch. Excluding it on the sale's own day is
   _correct_ for a cash view (a for-partner sale has `paid_usd = 0`) — but unlike commission, which
   got `finProfitSettlement`, sales have no settlement-day path, so it is never picked up when the
   partner actually pays.
3. **`salesProfit` hand-inlines `saleFullyPaid`'s text** instead of calling the exported fragment —
   rule 14. A change to `saleFullyPaid` would silently desynchronise Closing.

**The original framing was too harsh.** Triage found item 2 largely correct by design: it can only
under-count and never claims money that has not arrived. Fix 3 first (cheap, prevents drift), then
decide whether 1 and 2 are wanted — that is a semantics question about what the PDF should mean.

### Resolution (2026-09-04)

**Item 1 — DONE, owner decision confirmed: add BOTH loto and exchange.** Investigated whether each is
genuinely same-day cash before adding, per the owner's stated condition:

- **Loto**: `ProfitRepository.getLotoTotals`'s own doc comment confirms same-day cash ("stamps its
  commission as profit_lbp on the LOTO transaction at sale time"). Added, gated exactly like the
  counterpart (`notRefunded` + `notPartnerPending` on the new `loto_tickets`/`transactions` JOIN, behind
  a new `_hasLotoTicketsTable()` + `_hasTransactionsTable()` + `_hasPartnerLedgerTable()` schema-drift
  guard — no existing fixture creates `loto_tickets`, so every one of them degrades to zero unchanged).
  Loto's real commission is booked ENTIRELY in LBP; `totalProfitUSD` has no currency-conversion
  convention anywhere in this method (the existing `finProfitLegacy`/`rechargeProfit` queries already
  EXCLUDE their own module's LBP slice rather than convert it), so forcing loto through the USD-only
  total would silently contribute exactly $0 — a no-op disguised as a fix. Added a new, additive-only
  `totalProfitLBP?: number` field to `DailyStatsSnapshot` instead (mirrors the `totalSalesUSD`/
  `totalSalesLBP`-pair convention the interface already uses elsewhere). **Follow-up needed, out of this
  ticket's `packages/core`-only scope:** the generated closing PDF (frontend) does not yet render this
  new field — wiring it in is a small, separate frontend change.
- **Exchange**: scrutinised as asked (this is the one the ticket flagged as needing care). Verified in
  `ExchangeRepository.createTransaction`: `leg1_profit_usd`/`leg2_profit_usd` are stamped SYNCHRONOUSLY,
  inside the SAME transaction as the exchange itself — never at a later date. The
  `EXCHANGE_LOT_SETTLEMENT.md` "settlement" terminology that raised the original concern refers to FIFO
  cost-basis matching against a previously-bought lot (deciding WHICH lot(s) a sell consumes), resolved
  at the SELL's own transaction time — `profitRecognition.guard.test.ts`'s own header note already says
  so explicitly ("stamps the FIFO-realized profit... AT SETTLEMENT (the sell's own) time... never at the
  buy's time"). This is NOT the OMT/WHISH kind of deferred cash settlement (a later, separate,
  operator-entered event) — it is same-day by construction for every exchange, lot-tracked or not.
  Additionally `ExchangeRepository` structurally REJECTS CUSTOMER_ACCOUNT payout legs
  ("exchange_transactions does not carry client_id", ExchangeRepository.ts ~:506-513), so exchange can
  never be debt-pending — `getExchangeTotals` itself gates only `notRefunded` + `notPartnerPending`, and
  this addition matches it exactly, with no `notDebtPending` residual gap (the one source in this whole
  pair of tickets with none). **Conclusion: exchange belongs in the same-day view, added.** Folds
  directly into `totalProfitUSD` (already USD-native), gated behind a new
  `_hasExchangeTransactionsTable()` + `_hasPartnerLedgerTable()` probe (degrades to zero on every
  existing fixture, none of which create `exchange_transactions`).

**Item 2 — OUT OF SCOPE as instructed, filed as LIRA-173** (see below). Not built here.

**Item 3 — DONE (2026-09-04 follow-up, the export fence lifted the same day as LIRA-160's).**
`saleFullyPaid` was confirmed still private/unexported by grep before editing (not assumed), then
exported alongside `notDebtPending` (Task 1 of the follow-up, a two-line additive diff — see LIRA-160's
follow-up resolution above). `salesProfit`'s inlined predicate text was replaced with
`${saleFullyPaid("s")}`.

This is a behaviour-preserving refactor, so a plain revert-and-rerun (rule 17) proves nothing — the SQL
text is unchanged. Two different proofs were required and both were done:

1. **Parity ("passes both before and after"):** a new 5-case test file
   (`ClosingRepository.lira161SaleFullyPaidCoupling.test.ts` — fully-paid, $0.03-short-within-tolerance,
   $0.10-short-outside-tolerance, mixed USD+LBP fully paid, materially under-paid) was run against the
   OLD inlined text first (5/5 pass, 6.47s), then again after the `${saleFullyPaid("s")}` swap (5/5 pass,
   5.45s) — identical results both times, confirming the swap is behaviour-preserving.
2. **Coupling proof (the actual point of rule 14):** `ProfitRepository.saleFullyPaid`'s tolerance was
   temporarily tightened from `- 0.05` to `- 0.00`, and the same file's "$0.03 short" test was re-run in
   isolation — it FLIPPED from pass to `Expected: 40, Received: 0`, proving `ClosingRepository` is now
   genuinely coupled to the shared definition (pre-fix, this mutation would not have touched
   `ClosingRepository.ts` at all). `saleFullyPaid` was then reverted to its exact original text and the
   full file re-confirmed green (5/5).

`profitRecognition.guard.test.ts`'s `salesProfit` `EXCLUDED_UNITS` entry was REMOVED (not just edited) —
the query now literally calls `saleFullyPaid(` inside its own `.prepare()` template, so the guard's
text-scan self-detects the gate and the exclusion is stale weight; the guard's own "no stale entries"
check confirms this.

New coverage: `ClosingRepository.lira161ExchangeAndLoto.test.ts` (7 tests, including a schema-drift
fallback proof and rule-17 proofs for both module additions and both new `notPartnerPending` gates);
`ClosingRepository.lira161SaleFullyPaidCoupling.test.ts` (5 tests, the parity + coupling proof above).
Full core suite after both LIRA-160 and LIRA-161 follow-ups: **268 suites / 2816 tests**, exit 0 (25.9s)
— exceeds the 266/2800 baseline this follow-up started from.

---

## LIRA-162: pending commission is INVISIBLE on the Profits Overview and Commissions cards — MEDIUM (DONE)

**Priority:** Medium · **Epic:** Profits · **Status:** DONE (2026-09-04) — `ProfitService.getSummary`
now also calls `ProfitRepository.getPendingCommissionTotals` and carries
`financial_services.awaiting_settlement_count`; the Overview "Pending" line's guard now fires on that
count too (previously rendered nothing at all for an all-post-cutover period), and the field is typed
through the service, the local page type, and three new component-level jest tests (one proven
failing-first against the pre-fix guard). `getFinancialPendingByCurrency` left untouched, as required.

D15's "N transactions awaiting settlement" landed in `getPendingCommissionTotals`, which feeds only
the By-Payment-Method tab. The Overview and Commissions cards are fed by
`getFinancialPendingByCurrency` / `getOMTAnalytics`, which read the transaction profit stamp — now 0
for model-1 rows.

**Corrected from the original claim:** the cards do **not** display `$0.00` pending. The Pending line
does not render at all (it sits behind a `> 0` guard), which is arguably worse — nothing hints the
commission exists.

Worked example, one post-cutover OMT SEND ($100 + $5 fee, unsettled, ~$2.00 estimate):
Overview → Financial Services reads `1 txns / $105.00 / Commission $0.00` and nothing else;
Commissions tab reads `Realized (Month) $0.00` with no pending caption.

**Acceptance:** `ProfitService.getSummary` also calls the existing `getPendingCommissionTotals` and
carries `awaiting_settlement_count` onto the `finSvc` block — do NOT swap out
`getFinancialPendingByCurrency`, which still supplies `revenue` and `count`. Type it through both
transports (rules 12 + 19). Frontend jest coverage for the render.

---

## LIRA-163: `getAnalytics` has no awaiting-settlement count — three more surfaces read $0.00 — MEDIUM (DONE)

**Priority:** Medium · **Epic:** Profits/Services · **Status:** DONE (2026-09-04) —
`FinancialServiceRepository.getAnalytics` now computes `awaiting_settlement_count` (scoped to
`is_settled = 0 AND commission_model = 1`, D15's exact shape) at today/month level, per currency, and
per provider, in the same SQL pass. The three render sites (Services header `StatsCards`, Recharge
`CompactStats`, Profits → Commissions cards/table) now read the real count instead of the deleted
`commission === 0 && count > 0` heuristic — proven wrong-on-purpose failing-first (a genuinely-zero
provider the heuristic mislabeled "Awaiting settlement"). REST (`backend/src/api/services.ts`) needed
no change — confirmed a pure passthrough to the same core service. Both corrected claims re-verified:
the XLSX/PDF export already carries rendered cell text (confirmed by reading `tableExport.ts`), and the
Dashboard is confirmed NOT calling `getOMTAnalytics` at all. `embeddedCommission.guard.test.ts` passes
on the new SQL, and its per-column gate detection was proven (failing-first) to catch a simulated
ungated sibling column added next to the new one — the older `profitRecognition.guard.test.ts` was
confirmed out of scope entirely (its `SCANNED_FILES` never included `FinancialServiceRepository.ts`).
Fixed the pre-existing `Promise<any>` on `ApiAdapter.getOMTAnalytics`/`backendApi.ts`'s `getOMTAnalytics`
while wiring the field through both transports (new `OMTAnalytics` type in `packages/ui`).

`getAnalytics` sums `commission` model-0-only while `COUNT(*)` stays model-agnostic. LIRA-158
relabelled ONE render site client-side ("Awaiting settlement" instead of `$0.00`); the asymmetry is
still in the SQL, so every other consumer shows the bare zero:

- Services (OMT/Whish) page header — Today and Month commission chips read `$0.00`, on the very page
  those transactions are entered
- Recharge page `CompactStats` for non-crypto providers
- Profits → Commissions: the "Revenue by Provider" pie drops a fully-model-1 provider to a zero slice
  while the table beside it says "Awaiting settlement"; the cards above read `Realized (Month) $0.00`
  next to `Transaction Volume: N services`
- REST (`backend/src/api/services.ts:73-79`) returns `count: 10, commission: 0`, unmarked

**Two guesses in the original framing were WRONG — do not act on them:** the XLSX/PDF **export is
fine** (DataTable exports rendered cell text, so it carries "Awaiting settlement"), and the
**Dashboard is not fed by `getAnalytics`** at all (it reads `getUnsettledSummaryByProvider`).

**Acceptance:** add the count in the same SQL pass
(`SUM(CASE WHEN NOT (<modelZeroOnly>) THEN 1 ELSE 0 END) AS awaiting_settlement_count`, per
provider/currency and at today/month level) — the same shape D15 already established — then drive the
render sites off it instead of the `commission === 0 && count > 0` heuristic.

---

## LIRA-164: delete a stale comment — do NOT "re-derive the test" — LOW (doc chore)

**Priority:** Low · **Epic:** Docs · **Status:** TODO

`FinancialServiceRepository.ts:1485-1487` claims `omtCommissionModelGate.test.ts`'s expectations
"describe the PRE-Phase-2 shape and are stale after this change — a Phase 2 follow-up must re-derive
them". **That comment is itself out of date.** The test is correct, green, and already re-derived.

**Filed deliberately as a doc chore, and the framing matters.** If picked up as "re-derive the stale
test", the next agent will rewrite a correct, passing guard against the same production code it was
derived from — pure churn on the double-subtraction guard, one of the most safety-critical tests in
this area. The actionable work is deleting three lines.

Optional and genuinely useful: discharge rule 17 on that guard for real — temporarily re-add the
`- commission` term to `grossOwedDelta`/`SUPPLIER_OWED_EXPR`, confirm the test fails, revert. It has
so far only been re-derived on paper.

---

## LIRA-165: `transaction_time` is validated differently on IPC than on REST — LOW (rule 19)

**Priority:** Low · **Epic:** Dual-transport · **Status:** **DONE** 2026-10-03

### Resolution

`FinancialServiceSchema`'s `transaction_time` (`electron-app/schemas/index.ts`) now mirrors core's
`transactionTimeSchema` (`z.string().datetime().optional()`) instead of a hand-copied
`z.string().optional()`. NOT a cast-bridge re-export of the schema object — embedding an
already-built zod-4 schema as a field inside this file's zod-3 `z.object({...})` typechecks but
dies at runtime (`_parse is not a function`) the moment a sibling `.refine()` runs, proven by
running it and watching `FinancialServiceSchema.feePayments.test.ts` fail with exactly that error;
reverted to a literal mirror instead (same zod-major trap `MobileServiceItemSeedSchema`'s own
comment already documents). Guard:
`electron-app/schemas/__tests__/FinancialServiceSchema.transactionTime.test.ts` — NOT proven
failing-first (the fix was a one-line type swap made before the test was written, and rule 17
forbids reverting finished code to re-derive a red run); the pre-fix behavior is on the record via
`git show`.

The desktop financial-service schema (`electron-app/schemas/index.ts`) carries a hand-copied,
unvalidated `transaction_time: z.string().optional()`; the core validator uses a strict
`z.string().datetime()`. Same field, two contracts.

**No user-facing bug today** — `TransactionTimeOverride.tsx:53` always emits `toISOString()`, which
both accept. Two real consequences: the desktop spec `lira-087` cannot be ported to web mode unchanged
(rule 19d parity unprovable for that surface), and any script or direct IPC caller can write an
arbitrary garbage string into `financial_services.created_at`, after which that row silently falls out
of every date-bucketed report — Profits By Date, Closing, Cash Report.

This cost real debugging time during LIRA-158's e2e fix.

**Acceptance:** the IPC schema re-exports the core one (rule 19b) instead of hand-copying it.

---

## LIRA-166: negative `commission_usd` makes the ledger and the profit stamp disagree in sign — LOW

**Priority:** Low · **Epic:** Suppliers · **Status:** **DONE** 2026-10-03

### Resolution

`validators/supplier.ts`'s `supplierSettleSchema.commission_usd`/`commission_lbp` now carry
`.nonnegative()`. Confirmed the settlement UI (`Suppliers/index.tsx`'s commission inputs) can never
send a negative value — both onChange handlers reject a leading `-` at the keystroke level
(`/^\d*\.?\d*$/`/`/^\d+$/`). `electron-app/schemas/index.ts`'s `SupplierSettleSchema` is a
cast-bridge re-export of this same core schema, so no separate desktop-side fix was needed.
Guard: `packages/core/src/validators/__tests__/supplier.commissionNonnegative.test.ts` — proven
failing-first (ran red against the pre-fix bare `z.number()`, then green after adding
`.nonnegative()`).

`validators/supplier.ts`'s `commission_usd`/`commission_lbp` are bare `z.number()` with no
`.nonnegative()`. The `SUPPLIER_PAYS_US` ledger credit normalises with `-Math.abs(...)` while the
settlement profit stamp uses the RAW value — so a negative entry credits the ledger positively while
booking negative profit.

Not reachable through the settlement UI; reachable via direct IPC/REST. Left deliberately unfixed
during LIRA-158 so shipped bills behaviour was not silently altered (see the comment at the stamp
site). Fix is `.nonnegative()` on both, plus a validator test.

---

## LIRA-167: LIRA-138's dependency line is stale, and D17 changed its meaning — CHORE

**Priority:** Low · **Epic:** Suppliers · **Status:** CLOSED 2026-10-03: LIRA-138 was re-scoped by the owner and closed, so the dependency note no longer applies

`LIRA-138` (the `## LIRA-138:` ticket in this file — still genuinely open, no implementing commit
exists; the `:1215-1259` this line used to cite pointed at LIRA-084's block, re-checked 2026-09-23) says
it depends on "COMMISSION_AT_SETTLEMENT_PLAN.md Phase 2 (OMT/WHISH gross flip, **not shipped**)".
Phase 2 shipped in `43948a35`, so that blocker is gone.

More importantly, **D17 changed what LIRA-138 means.** It was written when the cashless
`SUPPLIER_PAYS_US` branch was considered an unreachable placeholder. That branch is now the live path
that DEFERS commission recognition until the client repays. So "generalise the drawer top-up past
bills-only" is no longer a neutral money-placement question: moving OMT/WHISH commission into a real
drawer credit would make it arrive as actual cash, which under D17's own logic flips it back to
IMMEDIATE recognition and undoes the deferral the owner just asked for.

**Acceptance:** update the ticket body's Depends On and restate its scope against D17 _before_ any
implementation. This is a re-scoping chore, not code.

---

# 2026-09-04 session findings — filed 2026-09-04

Five items found while shipping LIRA-159 and doing a documentation pass over its e2e coverage. **Every
file:line and factual claim below was independently re-verified against source before filing** —
two of the claims handed to the filing agent did not survive verification and are recorded below in
their corrected form, with the original framing named so nobody re-introduces it.

---

## LIRA-168: core jest runs at the wrong timezone on Windows — SQL and JS local-time disagree by 2h — MEDIUM

**Priority:** Medium · **Epic:** Test harness · **Status:** **DONE** 2026-10-03

### Resolution

No single `TZ` value fixes both runtimes on Windows — proven empirically, not assumed: the Windows
CRT (better-sqlite3's `'localtime'`) only understands the POSIX `std offset[dst offset,rule]`
syntax (`EET-2EEST,M3.5.0/0,M10.5.0/0` measured correct — real +3h/+2h Beirut DST/STD), while Node's
`Date` getters only resolve real IANA zone names and silently return offset 0 for ANY POSIX-style
string (`EET-2EEST,...`, `XXX-3`, `<+03>-3`, `UTC+3` — all measured 0). The two runtimes need
mutually exclusive TZ syntaxes; swapping the string trades which side is broken, it doesn't fix
either.

Fix: `packages/core/scripts/runTests.cjs` (new) launches jest directly and only pins
`TZ=Asia/Beirut` on non-Windows (`process.platform !== "win32"`) — CI (Ubuntu) is byte-identical to
before. On Windows it leaves `TZ` unset, so both runtimes fall back to their own OS-API-based zone
resolution, which agree with each other by construction (measured: both report +3h with no `TZ`
pinned, matching the dev machine's real Beirut OS zone). `packages/core/package.json`'s `test`
script now calls this launcher. `packages/core/src/jest.setup.ts` gained a fail-fast probe
(`assertSqlJsTimezoneOffsetsAgree`) that throws a clear, actionable error if SQLite's `'localtime'`
and Node's `Date` getters ever disagree again, on EITHER platform — proven to correctly fire by
invoking jest directly with the old `TZ=Asia/Beirut`-on-Windows invocation (bypassing the new
launcher, not by reverting any finished file).

Impact of leaving TZ unset on Windows: the `*.localBusinessDay`/`*.webTodayTzOffset` tests that need
a non-UTC runner still need the machine's OS zone to actually be non-UTC — covered by their own
existing `beforeAll` probes (`ClosingRepository.localBusinessDay.test.ts`'s own, pre-existing) plus
the new global probe above, both of which fail loudly rather than silently passing under UTC.

Proof: `ProfitAudit.loto.test.ts`, `LotoReportData.keptChange.test.ts`,
`ClosingRepository.carrierLineAdjustments.test.ts` and the `*.localBusinessDay`/
`*.webTodayTzOffset` group all pass through the real `yarn workspace @liratek/core test` script
after the fix, with SQL/JS offsets confirmed agreeing (both +3h, no `TZ` env pin). Full suite:
470 suites / 4569 tests passed, run at 11:06 local time (not inside the 00:00–03:00 window, but the
global probe above would have failed loudly either way if it mattered). App reporting code
(`reportingTimeFragments.ts`) untouched.

Measured 2026-09-04 on Windows 11, via `better-sqlite3` and Node's `Date`, for the fixed instant
`2026-06-30T22:30:00.000Z`:

```
APP path (no TZ set - OS zone):
  SQL 'localtime'  : +3.00h -> 2026-07-01 01:30
  JS  Date getters : +3.00h -> 2026-07-01 01:30   AGREE

TEST path (cross-env TZ=Asia/Beirut - what packages/core's test script uses):
  SQL 'localtime'  : +1.00h -> 2026-06-30 23:30
  JS  Date getters : +3.00h -> 2026-07-01 01:30   DISAGREE by 2.00h

cross-env TZ=UTC: SQL 0.00h
```

`packages/core/package.json`'s `test` script (`cross-env TZ=Asia/Beirut jest ...`) is the only place in
the repo where `TZ=Asia/Beirut` is actually **set** as an environment variable (verified — grepped the
whole repo for an assignment shape, not just the string). _Correction to the original framing: the
literal string `TZ=Asia/Beirut` also appears in roughly a dozen other places — comments in
`ClosingRepository.ts`, `ProfitRepository.ts`, `localDate.ts`, several test file headers, and
`docs/plans/done_plans/LOCAL_BUSINESS_DAY_PLAN.md` — all of them documentation telling a human/CI
operator what TZ to launch with, none of them an actual assignment. "Exactly one place" is true only
for where the variable is actually SET, not for every place the string appears._

Node resolves `Asia/Beirut` through full ICU and correctly gets Beirut's real +3h offset; SQLite's
`'localtime'` modifier goes through the Windows C runtime's `localtime()`, which cannot parse an IANA
zone name, silently falls back to base UTC+0, then applies the **US** DST default rule — landing on
+1h in a September probe. Beirut in June/July/September is genuinely +3h, so the SQL side of the test
environment runs two hours off, on Windows only. This exact mechanism is already independently
documented in two places in the repo, both dated the same day: `ClosingRepository.ts:958-967`'s
`hasOpeningBalanceToday()` comment, and `packages/core/src/repositories/__tests__
/FinancialRepository.monthlyPL.test.ts:108-137`'s own offset-probe comment, which measured the identical
+1h (not +3h) result independently.

**Impact:** any core test that compares a JS-computed local day/month (`localDay()`, `localMonth()`,
`Date` getters) against a SQL-computed one (`todayLocal()`, `dateRange()`, `strftime(..., 'localtime')`)
is comparing two different days/months on Windows. It can mask a real date-boundary bug as easily as
invent a phantom one. On Linux CI both sides resolve to the real +3h, so **CI cannot detect this at
all** — this is Windows-dev-machine-only.

**This is NOT ticket T4** ("Timing error on Windows (works on Mac)" — `docs/tickets/CURRENT_SPRINT.md`,
the stale, non-live board; T4 isn't carried into this file at all, but it's the closest existing
reference to a "Windows timing" bug and worth naming so nobody conflates the two). The shipped Electron
app never sets `TZ` — the "APP path" measurement above is self-consistent (SQL and JS both land on
+3h) — so this ticket does not explain T4. The measurements above are nonetheless a better starting
point for investigating T4 than the guess currently recorded there ("suspect timestamp/timezone
handling").

Two things any investigator must know:

- **Git Bash silently drops `TZ`.** `TZ=Asia/Beirut node -e "console.log(process.env.TZ)"` run from
  MSYS prints `undefined` — a probe run that way measures the OS zone, not the variable, and produced a
  wrong conclusion during this very investigation before being corrected. Only `cross-env` (as
  `packages/core/package.json`'s `test` script already uses) passes it faithfully cross-platform.
- _Correction to the original framing:_ `packages/core/src/repositories/__tests__
/ClosingRepository.localBusinessDay.test.ts` does **NOT** manipulate `process.env.TZ` directly —
  grepped, no `process.env.TZ =` assignment exists anywhere in the file, or anywhere else in the repo's
  test suite. It does the opposite: its header comment (lines 12-16) explicitly explains why a
  **mid-test** `process.env.TZ` assignment is unreliable (SQLite's `'localtime'` reads the C runtime
  zone once, at process launch) and instead relies on `TZ` being set at process launch (via the
  `cross-env` in the package.json script), backed by a `beforeAll` probe that fails loudly if the
  measured offset is 0 — i.e. if the suite is accidentally run without the TZ launch env. Start there
  anyway: it's still the right file, just for the "how this is _supposed_ to be pinned, and how to tell
  if it wasn't" story, not a `process.env.TZ =` example. `ClosingRepository.ts:961-962` separately
  comments that `localDay()` respects `process.env.TZ` (true — it uses Node's `Date` getters, verified).

---

## LIRA-169: `profitRecognition.guard.test.ts` can be defeated by a sibling column in the same query unit — MEDIUM

**Priority:** Medium · **Epic:** Profits · **Status:** **DONE** 2026-10-03

### Resolution

Ported `embeddedCommission.guard.test.ts`'s per-column gate detection (`splitSelectShape`/
`textIsGated`/`isGated`) into `profitRecognition.guard.test.ts`, generalizing the shared pieces into
`testHelpers/sqlQueryUnits.ts` (as `splitSelectShape`/`textIsGated`/`isGatedPerColumn`/
`methodSourceSlice`, parameterised on the caller's own token regex and gate-fragment list) instead
of pasting a second copy (rule 14) — `embeddedCommission.guard.test.ts` itself left untouched.
`profitRecognition.guard.test.ts`'s main violations check and its "no stale exclusions" check both
now call `isGatedPerColumn` instead of the old whole-unit `GATE_CALL_REGEX.test(u.sql)`.

Rule 17: proven via a SYNTHETIC fixture inside the test (`"LIRA-169: sibling-column loophole"`),
never by editing real production code — a fixture unit with two profit-bearing columns, one gated,
one not, sharing a `.prepare()` unit. The OLD whole-unit formula (`GATE_CALL_REGEX.test(u.sql)`) is
proven to wrongly return `true` on it; the NEW per-column check (`isGatedPerColumn`) is proven to
correctly return `false`, plus a sanity case confirming the new check still passes when every column
is genuinely gated.

Tightening the real check surfaced 11 pre-existing, genuinely-ungated-on-their-profit-column units —
all belonging to the same documented "expose the gate" Detail-drill-down family
(`getSalesDetail`'s three private-method siblings, `getRechargeDetail`, `getFinancialServiceDetail`
×2, `getCustomServiceDetail`, `getMaintenanceDetail`, `getLotoDetail`, `getExchangeDetail`,
`getTopupBuybackDetail`). Each verified individually (their own doc comments, several stating the
pattern explicitly — e.g. getRechargeDetail: "including debt-pending ones ... the service needs
those to render the not counted yet section") and confirmed in `ProfitService.buildSaleModuleDetail`
that recognition is applied one layer up (`r.profit_usd * weight`), never by summing the raw column
ungated — added as named `EXCLUDED_UNITS` entries, not silently papered over. Second, smaller
blind spot from the ticket (`this.query`/`this.queryOne` calls invisible to the parser) remains a
documented latent gap, not fixed here — `ProfitRepository.ts` has zero such calls today and
`ClosingRepository.ts`'s four don't touch profit/commission (unchanged since the ticket was filed).

Found while building LIRA-159's new `packages/core/src/constants/__tests__
/embeddedCommission.guard.test.ts`. That guard's first design used unit-level detection —
`GATE_CALL_REGEX.test(unit.sql)` over the WHOLE `.prepare()` call's text, the same granularity
`profitRecognition.guard.test.ts` still uses today — and **failed to catch the very regression LIRA-159
specifies**: stripping `embeddedCommission(...)` from only `getUnsettledSummaryByProvider`'s
`pending_commission_usd`/`_lbp` `CASE` expressions still left `GATE_CALL_REGEX.test(unit.sql)` true,
because the THIRD, untouched `CASE` in the same `.prepare()` call (`awaiting_settlement_count`) kept its
own `atSettlementCommission(...)` call — the surviving sibling call "covered" the two newly-ungated
columns purely because they share one query unit. It was redesigned to paren-depth-aware, per-column
detection (`splitSelectShape`/`isGated`/`textIsGated` in `embeddedCommission.guard.test.ts`, verified
present).

**The same hole is live, not theoretical, in the older guard.** `profitRecognition.guard.test.ts`'s own
check (`GATE_CALL_REGEX.test(u.sql)`, whole-unit) has no per-column splitting logic at all — verified by
reading the file end to end; it never imports `splitSelectShape` or anything equivalent. In
`ProfitRepository.getByUser` (`packages/core/src/repositories/ProfitRepository.ts:2174-2306`) and
`.getByClient` (`:2313-2450`), the `revenue_usd`, `profit_usd`, and `profit_lbp` columns are each their
OWN `SUM(CASE ... END) AS <col>` block, and each independently repeats `NOT
(${txnNotPartnerPending("t")} AND ${notDebtPending("t.id")})` inline at the top of its own `CASE` — the
gate is never hoisted once into the outer `WHERE`. So stripping the gate from, say, only the
`profit_usd` `CASE` while leaving `profit_lbp`'s copy intact would leave `GATE_CALL_REGEX.test(u.sql)`
true (the sibling's copy is still textually present in the same unit), and the current guard would
report "gated" on a query that just shipped an ungated `profit_usd` column.

Second, smaller blind spot, verified by reading every call site: the shared parser
(`constants/testHelpers/sqlQueryUnits.ts`'s `collectQueryUnits`) only recognizes `.prepare(` calls, so
`this.query()`/`this.queryOne()` calls are invisible to it (`embeddedCommission.guard.test.ts` works
around this for its own six scanned files with a supplementary `collectQueryLikeUnits`, but
`profitRecognition.guard.test.ts` does not import or use it). `ProfitRepository.ts` has **0**
`this.query`/`this.queryOne` calls (grepped); `ClosingRepository.ts` has exactly **4**, at lines 1075,
1098, 1174, and 1178 (`getCheckpointAmounts`, `getCheckpointCarrierLines`, and `getCheckpointTimeline`'s
two calls) — none read `profit` or `commission` today, so this is a **latent gap**, not a current miss.

**Fix:** port `embeddedCommission.guard.test.ts`'s per-column detection into
`profitRecognition.guard.test.ts`. Rule 17 applies to the port itself — strip one sibling's gate (e.g.
`profit_usd`'s copy in `getByUser`, leaving `profit_lbp`'s intact), confirm the CURRENT guard passes it
through undetected, then confirm the ported guard catches it.

---

## LIRA-170: root `yarn test` silently skips the core suite when another workspace fails — DONE

**Priority:** Medium-High · **Epic:** Tooling · **Status:** **DONE** 2026-09-04

### Resolution

Root `test` is now `npm run rebuild:node && node scripts/run-tests.mjs`. The new wrapper is modelled
on `scripts/run-e2e.mjs`, which exists for the same class of problem (a step that runs nothing and
exits 0 is indistinguishable from a pass): it runs **every** workspace serially and never bails,
captures each workspace's real exit code, parses its suite/test counts, treats a workspace that
reported **no counts at all** as a failure, prints a summary table, and exits non-zero naming which
workspaces failed.

Ordering alone was deliberately rejected as the fix: adding `-t` makes `packages/core` run before
`frontend`, which cures the observed symptom but only **moves** the blind spot — a core failure would
then bail before backend and frontend ever ran. Yarn's `foreach` has no no-bail option, so no flag
combination gives "run everything, report everything".

Proven by injection, not assertion. With a deliberately failing scratch test in `packages/core`
(the _early_ workspace, so a bail would hide the rest):

```
workspace          exit  suites  tests  elapsed  status
@liratek/core      1     264     2782   21.2s    FAILED
@liratek/backend   0     46      633    15.1s    passed
@liratek/frontend  0     176     1347   40.0s    passed
[run-tests] FAILED: @liratek/core          (overall EXIT=1)
```

Backend and frontend still ran with real counts. Scratch file then removed and re-run clean:

```
@liratek/core      0     263     2781   20.8s    passed
@liratek/backend   0     46      633    14.9s    passed
@liratek/frontend  0     176     1347   40.0s    passed
[run-tests] all workspaces passed         (overall EXIT=0)
```

**Not fixed here at the time this was written: CI never ran `packages/core`'s suite at all** — that
was LIRA-151, and this ticket did not touch `.github/workflows/ci.yml`. Fixing the local gate did
not close the CI blind spot on its own. **Update 2026-09-04: LIRA-151 is now PARTIAL — a
`core-tests` job with a suite-count floor was added to ci.yml, closing this specific gap (see
LIRA-151 above for the unrelated part (a) it deliberately left open).**

Root `package.json`'s `test` script (verified): `"npm run rebuild:node && yarn workspaces foreach -A
--exclude liratek run test"`. `-A` (all workspaces, ignoring git-diff `--since` filtering) carries no
`-t`/`--topological` and no `-p`/`--parallel` — Yarn (this repo pins `yarn@4.12.0`) runs `foreach` in
that shape sequentially and stops at the first workspace whose script exits non-zero, rather than
continuing to the remaining workspaces and reporting each one.

Observed 2026-09-04: one frontend test timed out, the run ended there, and `packages/core`'s test suite
(263 test files on disk as of this filing — close to the "262 suites" figure originally reported; file
count drifts by ±1 as tickets land) **never ran** — while the output said only "Failed with errors in
1m 42s", with no indication that an entire workspace, containing the project's core money logic, was
never touched. So a failed root `yarn test` currently carries **no information** about whether the
money logic was tested at all, and this is the project's designated pre-merge gate (CLAUDE.md rule 9).
It was caught only by counting result blocks in the log.

`yarn typecheck` already uses the safer shape (verified): `"yarn workspaces foreach -ptA --exclude
liratek run typecheck"` — parallel (`-p`) and topological (`-t`), which reports every workspace rather
than stopping at the first failure. **Fix:** bring `test` to the same `-ptA` shape, and/or otherwise
make it continue through every workspace so each one reports pass/fail independently.

**Fold in a second, related correction.** Root `yarn test` runs `npm run rebuild:node` first, flipping
`better-sqlite3` to the Node ABI and breaking desktop e2e (`waitForEvent("window")` timeout on every
spec) until the Electron ABI is restored. **`yarn rebuild:native` (`node
scripts/rebuild-native-deps.cjs`) does correctly restore it** — reported verified 2026-09-04 by
constructing a `Database` and observing the expected ABI throw pre-rebuild, none post-rebuild (the
correct methodology — a bare `require('better-sqlite3')` succeeds even on a mismatched ABI because the
native binding loads lazily). Mechanism, read from source: the script fetches a prebuilt Electron-ABI
binary via `prebuild-install` — not a from-source compile, which is why it's fast (~1s) — for each of up
to 4 hardcoded candidate `better-sqlite3` directories that actually exist on disk; both
`node_modules/better-sqlite3` and `node_modules/@liratek/core/node_modules/better-sqlite3` (the real,
non-symlinked copy) were rebuilt to electron@31.7.7 (the installed version, verified). _Caution before
treating this as fully general:_ this appears to conflict with an earlier-recorded finding that
`rebuild:native` fails to restore the ABI specifically after `test:e2e:web`'s own `rebuild:node` (citing
5+ on-disk `better-sqlite3` copies vs. this script's 4 fixed candidate paths). If that finding still
holds, the two scenarios (root `yarn test` vs. `test:e2e:web`) differ in some way not yet identified —
re-verify in the `test:e2e:web` scenario specifically rather than assuming today's root-`yarn-test`
result generalizes to it.

---

## LIRA-171: Dashboard awaiting-settlement test's 15s timeout was masking an unrelated recharts import — RESOLVED (2026-09-04) — LOW

**Priority:** Low · **Epic:** Test harness · **Status:** RESOLVED (2026-09-04)

`frontend/src/features/dashboard/pages/__tests__/Dashboard.awaitingSettlementCount.test.tsx` (added by
LIRA-159) carried an explicit `jest.setTimeout(15000)` blaming "ts-jest compiling and recharts
initializing" the lazy-loaded Sales Trend chart's dynamic `import()` (the default "trend" insight tab
renders unconditionally on mount, so every render pulled recharts's full module graph in for real).

**Root cause, measured not guessed:** diffing against the fast sibling
`Profits.awaitingSettlementCount.test.tsx` (same ticket, same feature) showed it already stubs its own
chart (`CommissionsChart`) — this file was the one outlier that left its chart real. Isolated runs of
this file (repeated 4x pre-fix) showed the file's first test alone consistently costing ~700-900ms
(dynamic import + Suspense resolution), vs ~60-100ms for tests 2-3 in the same run (warm in-run module
cache) — a ~10x per-test gap explained entirely by recharts, not by any `waitFor`/retry/mock issue (no
retries, no rejected mocks, no fake-vs-real-timers difference from the Profits file).

**Fix:** stubbed `../../components/DashboardChart` the same way `Profits.awaitingSettlementCount.test.tsx`
stubs `CommissionsChart` — none of this file's assertions touch the trend chart, only the unrelated
"Pending Settlement" banner, so the dependency was provably irrelevant to what's under test. Dropped
`jest.setTimeout(15000)` back to jest's plain 5000ms default (documented, not silently omitted) since the
cause was removed rather than budgeted around.

**Before/after (isolated, `npx jest --config jest.config.ts <file>`, 4 runs each):**
before — file "Time" 6.05-8.05s, first test 707-868ms, tests 2-3 59-101ms;
after — file "Time" 6.4-7.4s, first test 136-370ms, tests 2-3 57-276ms (~2-6x reduction on the test
actually subject to the per-test timeout; the residual ~6s "Time" is fixed jest/ts-jest worker-boot +
non-recharts module-graph transform cost, present in the Profits sibling too, and not gated by
`jest.setTimeout` since that only wraps `it()` bodies, not suite-level compile).

**Under real full-suite load** (`npx jest --config jest.config.ts --verbose`, all 176 suites): this file's
3 tests measured 307ms / 80ms / 99ms — comfortably under the new 5000ms default and nowhere near the old
15000ms. Full run: 176 suites / 1347 tests, 1 skipped, exit 0 (39.7s verbose / ~50s non-verbose), matching
the pre-existing baseline.

**Rule 17 sanity check:** temporarily forced the banner's `hasPendingUsd`/`hasAwaiting` flags in
`Dashboard.tsx` to always show the legacy dollar figure and never the count (reintroducing the exact
LIRA-159 D2 bug this test guards). 2 of 3 tests failed as expected:
`Expected substring: "3 awaiting settlement" / Received string: "OMT: $0.0000 commission on $100.00 owed
(3 txns)"` (and the analogous BINANCE mixed-provider case). Reverted immediately after —
`git status`/`git diff` on `Dashboard.tsx` confirm zero residual change. Assertions were not weakened by
this ticket: same `toContain("N awaiting settlement")` / `not.toMatch(/\$0\.00/)` checks as before, only
the irrelevant chart dependency was removed.

Touched only the test file (`Dashboard.awaitingSettlementCount.test.tsx`) — `Dashboard.tsx` itself is
unchanged.

---

## LIRA-172: `ImeiStoryCard` receives `product_deleted` but renders no chip — LOW

**Priority:** Low · **Epic:** Inventory · **Status:** DONE 2026-10-03 (not yet committed) — mirrored the Phone Units register's chip verbatim (same muted slate styling, same gating `=== 1`) into `ImeiStoryCard.tsx`'s product-name line, `data-testid="imei-story-product-deleted"`. Rule 17: proven failing-first — temporarily gated the new JSX behind `{false && ...}`, confirmed `imei-story-product-deleted` was NOT found (red), then restored the real fix (green); not a revert of finished code, since the fix was written in this same session specifically to prove it this way. Added 3 tests to the existing `ImeiStoryCard.test.tsx` (chip shown at `product_deleted: 1`, hidden at `null`, hidden at `0`) — full file 16/16 green. Eslint clean; frontend typecheck clean for this file (one pre-existing, unrelated full-project error from the parallel money-lane agent's uncommitted `transactionTypes.ts` change — not touched here).

LIRA-152 added `p.is_deleted AS product_deleted` to both unit reads that share the
`ProductUnitRepository.UNIT_PROVENANCE_JOIN` fragment (rule 14) — `listUnits` (the Phone Units register,
`packages/core/src/repositories/ProductUnitRepository.ts:597-631`) and `getUnitStoryByImei` (the walk-in
lookup / IMEI story read, `:553-578`) — and renders a muted "Product deleted" chip for it in the Phone
Units register (`frontend/src/features/inventory/pages/PhoneUnits/index.tsx:434-440`, gated on
`unit.product_deleted === 1`).

`frontend/src/features/inventory/components/ImeiStoryCard.tsx` — the story read's OTHER consumer — takes
a `story: UnitStoryEntry` prop, and `UnitStoryEntry`
(`frontend/src/features/inventory/hooks/useProductUnits.ts:40-46`) already carries `product_deleted:
number | null` on the type. But the component's render (verified against the full file) never
references `story.product_deleted` anywhere — no chip, no conditional, nothing. A unit whose product was
deleted renders identically to one whose product wasn't, on this surface only.

Correctly scoped out of LIRA-152 at the time; this is the follow-up. **Fix:** mirror the Phone Units
chip (`{unit.product_deleted === 1 && <span>...Product deleted...</span>}`) into `ImeiStoryCard.tsx`'s
render, gated on `story.product_deleted === 1`.

---

## LIRA-173: for-partner sale margin needs a settlement-day recognition path — CLOSED, WON'T DO

**Priority:** Low-Medium · **Epic:** Closing/Profits · **Status:** **CLOSED (won't do)** 2026-09-05

### Owner decision, 2026-09-05

**For-partner sale margin will never appear in the closing PDF.** The closing snapshot stays strictly
a same-day till-cash view; partner sale margin is not till cash on the sale's day, and the owner
declined both alternatives put to him (recognising it on the day the partner pays, and recognising it
retroactively on the sale's own day). It continues to appear correctly on the Profits page, which
already gates it via `salePaidOrPartnerSettled`.

The retroactive option was rejected for a concrete reason worth preserving: the closing PDF is
generated once and stored (`report_path`), so recognising the margin on the sale's original date would
make a re-run of an already-filed day disagree with the filed document.

**Do not re-file this as a gap.** The absence is deliberate. It can only ever under-count — it never
claims money that has not arrived.

### What did come out of it

The same interview produced a _different_ and larger request: partner obligations should be recognised
**proportionally** as the partner pays, rather than all-or-nothing. That is not this ticket — it
changes the Profits page rather than the closing PDF, and it touches every `FOR_%` module rather than
sales alone. Filed separately; see the proportional-recognition ticket below.

**Filed 2026-09-04, owner decision recorded the same day** — split out of LIRA-161 item 2 on purpose.
The owner separated this because it mirrors the whole shape of LIRA-158's commission-at-settlement work
and deserves its own ticket rather than riding along inside the LIRA-160/161 closing-snapshot fix.

`ClosingRepository.getDailyStatsSnapshot`'s `salesProfit` query excludes a for-partner sale's margin on
the sale's OWN day — correct for a same-day cash view, since a for-partner sale carries `paid_usd = 0`
(no counter cash actually changed hands that day; `ProfitRepository`'s
`salePaidOrPartnerSettled(alias)` fragment's partner-covered OR-branch is what recognizes it, and
`salesProfit` deliberately omits that branch). The gap: unlike financial-service commission, which got a
dedicated settlement-day source (`finProfitSettlement`, reading `SUPPLIER_SETTLEMENT`/`REFUND`
transactions off the unified `transactions` table on THEIR OWN day) when LIRA-158 moved Closing to a
cash basis, sales have NO equivalent path. A for-partner sale's margin is therefore never picked up by
this snapshot on ANY day — not the sale day (correctly deferred) and not the day the partner actually
pays (no source reads it there at all).

**Sign of the bug:** can only ever UNDER-count `totalProfitUSD`, never overstate it — it never claims a
cash event that hasn't happened, so today's behaviour does not violate the "profit is real only when
money is real" rule (`profitRecognition.guard.test.ts`'s own header/`EXCLUDED_UNITS` note for
`salesProfit` documents this explicitly). This is a completeness gap, not a correctness one — which is
exactly why it was correctly triaged as LOW/MEDIUM and separable from LIRA-160's real over-recognition
bugs.

**Acceptance (sketch, mirroring `finProfitSettlement`'s shape):**

- A new settlement-day source in `getDailyStatsSnapshot`, reading a for-partner sale's margin on the day
  the PARTNER settles (i.e. when `partner_ledger`'s FOR\_% coverage against `reference_table = 'sales'`
  completes), not the sale's own day — same "recognize on the day the cash event actually happens"
  principle `finProfitSettlement` already applies to OMT/WHISH commission.
- Reuse `ProfitRepository`'s exported `notPartnerPending` fragment (and `saleFullyPaid`, if exported by
  then — see LIRA-160/161's recommended follow-up) rather than a new hand-written predicate (rule 14).
- Same schema-drift discipline as every other source in this method: degrade to zero, not a throw, on any
  fixture that predates the tables involved (`_hasPartnerLedgerTable()` and friends already exist from
  LIRA-160/161 and can be reused).
- Rule 17 proof: a for-partner sale fixture where the OLD (day-of-sale-only) and NEW (settlement-day)
  queries disagree — the sale day must show $0 (unchanged), the settlement day must show the margin
  (new).
- Update `profitRecognition.guard.test.ts`'s `salesProfit` `EXCLUDED_UNITS` entry once this ships — its
  "gap of omission, worth its own ticket" note becomes stale the moment this lands.

---

## LIRA-174: downloadable profits PDF needs a rate-stamped USD+LBP view — LOW/MEDIUM — DONE (2026-09-04)

**Priority:** Low-Medium · **Epic:** Profits/Reporting · **Status:** DONE — built against the
Checkpoint/closing PDF (owner-confirmed target, not the Profits export). See §6 below for what shipped.

**Filed 2026-09-04**, owner spec recorded verbatim-in-substance while reviewing LIRA-161 (this ticket is a
record of the owner's spec, not a design produced here — per instruction, nothing below was decided by
the filer beyond the one item explicitly marked as an inference in §3).

### 1. What the owner asked for (evolved same-day, in two passes)

**First pass** — three separate downloadable PDF versions:

1. **Total USD** — every currency converted to USD.
2. **Total LBP** — every currency converted to LBP.
3. **Both LBP and USD, zero conversions** — native amounts only.

For modes 1 and 2, an amount with no rate stamped on it was to use "the rate from system configuration."

**Second pass, same day — SUPERSEDES the three-mode spec above.** The owner reviewed the presentation
requirement and decided one view can carry the same transparency without a mode toggle. Their words: _"I
think you are correct on this. Let's stick to one view."_ The reasoning offered back to them (not their
own words, recorded here so the "why" behind the supersession is legible): showing the USD amount, the
LBP amount, and a rate-stamped USD total together on one document already makes every figure both native
and auditable — a reader who wants "the LBP figure" or "the USD figure" already has it without a second
PDF, and a reader who wants the conversion sees the exact rate used printed on the page instead of having
to reverse-engineer it against a separate config screen.

**Do not build the three-mode toggle.** The single-view layout in §2 is the current spec. The three-mode
text above is kept only so the history is legible to whoever picks this up — do not resurrect it as a
"missed requirement."

### 2. The single-view layout (owner's words, verbatim on the first three lines)

> "showcase usd amount, lbp amount, total amount in usd with the rate used — this way it's clear"

Concretely, per line item:

```
USD amount        $ 195.50
LBP amount      450,000 LBP
Total (USD)     $ 200.79   @ 90,000
Total (LBP)   18,071,000 LBP   @ 90,000
```

The first three lines (USD amount, LBP amount, Total (USD) with the rate annotation) are the owner's
explicit instruction. **The fourth line (Total (LBP), also rate-annotated) is the filer's inference, NOT
something the owner said in this exchange** — it completes their ORIGINAL request (which asked for a
usable LBP-facing total as well as a USD-facing one) symmetrically, and costs nothing to add once the
rate is already being stamped on the USD line. Flagged explicitly so the owner can strike it in one line
if they'd rather keep the document USD-total-only.

The rate being printed on the document **is the point** — it turns "some number was converted somehow"
into an auditable figure the reader can check by hand. Every row and every total on the document must
carry its rate whenever a conversion happened; a native (unconverted) amount carries none.

### 3. The conversion rate: `sell_rate`, not `buy_rate` — and why that is a real divergence, flagged not resolved

**Owner decision (2026-09-04): use the `sell_rate` column of `exchange_rates`** as "the rate from system
configuration" for any amount that reaches the document with no rate already stamped on it. Verified
(filer, before this ticket): `exchange_rates` (read via `RateRepository`) carries three independent rates
per currency, seeded as LBP `market 89,500 / buy 89,000 / sell 90,000` and EUR `market 1.18 / buy 1.16 /
sell 1.20`. The PDF uses **sell** — 90,000 for LBP at today's seed values.

**Flag this, do not "fix" it:** the app-wide convention for LBP→USD conversion elsewhere in the codebase
is **buy**, not sell — owner decision 2026-07-06, cited in source at `frontend/src/features/debts/pages/
Debts/index.tsx` (~:2068-2070) and `frontend/src/features/sessions/.../SessionCheckoutModal.tsx`
(~:979-981), and it is what LIRA-139's amount-sort fallback uses. That means the profits PDF's converted
total will **not tie out exactly** against those other buy-rate surfaces for the same underlying LBP
figures. This is defensible on its own terms — sell is the rate the shop would actually pay to turn LBP
into dollars, the conservative reading for a profit figure, and printing the rate on the face of the
document makes the divergence visible rather than silently hidden — but it is a real, deliberate
departure from the established convention. **Do not have a future pass quietly "correct" this to buy, and
do not file the buy/sell mismatch against the other surfaces as a bug** — it is this ticket's own choice,
made by the owner with the tradeoff named, not an oversight.

### 4. What's already built (partly), from LIRA-160/161's core-side work

`ClosingRepository.getDailyStatsSnapshot` already computes a same-day `totalProfitLBP` field (LIRA-161
item 1, 2026-09-04) precisely because loto's commission is booked **entirely in LBP**
(`ProfitRepository.getLotoTotals` returns only `revenue_lbp`/`profit_lbp`, no USD figure at all) — a
USD-only total would silently contribute exactly $0 for loto forever. That LIRA-161 pass deliberately did
**not** touch the PDF renderer (frontend — out of that ticket's `packages/core`-only scope), so this
ticket's data side has a documented head start: the LBP figure this PDF needs for loto is already
surfaced on the snapshot object; only the frontend rendering (this ticket's actual scope) is unbuilt.

### 5. Open items for whoever implements this (name them, do not guess)

- Confirm which document fields, beyond loto, currently arrive with NO stamped rate at all (candidates:
  any USD/LBP total that sums across mixed-rate historical rows) — each such field is where §3's
  `sell_rate` substitution actually fires; a field that already carries its own historical rate (e.g. a
  sale's `exchange_rate_snapshot`) must keep using ITS OWN rate, not be overridden by the current
  `sell_rate` (that would misstate a historical transaction at today's rate).
- Decide whether the Total (LBP) line from §2 survives owner review, per the inference flag above.
- Reuse `RateRepository`'s existing accessor for `sell_rate` rather than a second hand-rolled query
  (rule 14) — confirm the exact method name before implementing.

### 6. What shipped (2026-09-04, frontend-only per this ticket's actual scope)

- **New module** `frontend/src/features/closing/utils/rateStampedProfit.ts` — pure (no React, no
  `useApi`), unit-testable. `buildRateStampedProfitLines(totalProfitUSD, totalProfitLBP, sellRate)`
  converts via `convert`/`RateTable` from `packages/ui/src/money/` (never hand-rolled `lbp / rate`),
  side `"sell"`, both sides of the table set to the same `sellRate` (mirrors
  `frontend/src/features/audit/amountSort.ts`'s LIRA-139 precedent). Degrades to native totals with
  `rateAvailable: false` — never throws — on a missing/0/negative/NaN rate.
  `formatRateStampedProfitBlock(lines)` renders the 4 lines and prints the rate on both converted
  totals, never on the two native lines.
- **Wired into** `closingReportGenerator.ts` (`generateClosingReport` now takes a required 3rd
  `sellRate` param) and `Checkpoint/index.tsx` (reads `useSellRate().sellRate`, injects it — never
  hardcoded, never reached for inside the formatter). This is the actual Checkpoint/closing PDF's HTML
  builder (`api.generatePDF(html, filename)` call site), not the Profits page.
- **Plumbed `totalProfitLBP` frontend-visible** (it was core-only before this ticket): added to
  `frontend/src/types/electron.d.ts`'s `closing.getDailyStatsSnapshot` return type, to a new exported
  `DailyStatsSnapshot` type in `packages/ui/src/api/types.ts` (+ `packages/ui/src/api/index.ts` export),
  and typed (was `Promise<any>`) in `frontend/src/api/backendApi.ts`. No core/electron-app/backend
  changes needed — `ClosingRepository`/`ClosingService`/the IPC handler/the REST route already returned
  the field (LIRA-161); only the frontend-facing types were missing it.
- **§5 open items resolved:**
  - _Which fields arrive with no stamped rate_: only the two profit aggregates
    (`totalProfitUSD`/`totalProfitLBP`) get this treatment — see the "stamped rate" item below for why
    the rest of the document's fields don't have a per-row stamped rate to honour at all at this layer.
  - _Total (LBP) line_: kept, flagged in a source comment in `rateStampedProfit.ts` as the filer's
    inference — a one-line removal if the owner disagrees.
  - _`sell_rate` accessor_: used `useSellRate().sellRate` (the canonical frontend hook everyone else
    reads it from), not a second query — `RateRepository` is a `packages/core` concern already behind
    that hook via IPC/REST.
- **The "LBP amount" scope risk (this ticket's highest-risk item), verified**: `totalProfitLBP`
  (`ClosingRepository.ts:1360`) is `lotoProfit.profit_lbp` — loto's commission ONLY. Confirmed against
  the repository's own doc comment (`ClosingRepository.ts:104-120`): every other module folded into
  `totalProfitUSD` (sales, financial services, recharge, custom services, maintenance, exchange)
  ALREADY EXCLUDES its own LBP-denominated slice at the SQL layer — there is no established
  currency-conversion convention there to fold LBP profit into the USD total. So if any of those
  modules ever produces a genuine LBP profit slice, it is dropped from BOTH totals today, not merely
  deferred. Chose labelling over a bigger fix: the PDF's "LBP amount" line reads "(Loto only)" rather
  than presenting incomplete coverage as if it were the whole picture. A true cross-module LBP
  aggregate is a `packages/core`/`ClosingRepository` change, out of this (frontend-only) ticket.
- **The "stamped rate" clause, verified moot at this layer**: `getDailyStatsSnapshot` returns
  currency-bucketed `SUM`s per module (one number per module per currency), not individual rows, so
  there is no per-amount stamped rate surviving the aggregation for this method to honour. Converting
  the two aggregate profit figures at today's `sell_rate` is the faithful implementation for this view;
  true per-row stamped-rate conversion would mean pushing conversion inside each of the ~7 module
  sub-queries `getDailyStatsSnapshot` composes — a much larger `packages/core` change, correctly out of
  this ticket's scope.
- **Tests**: `rateStampedProfit.test.ts` (new, 10 cases — exact-arithmetic known input verified by a
  second method, zero-side cases, `it.each` over 4 degenerate-rate inputs proving no throw, and 2
  `formatRateStampedProfitBlock` cases proving the rate prints on converted lines only and never on
  native ones); `closingReportGenerator.test.ts` updated (new required `sellRate` param threaded through
  all 4 existing calls; old single "Total Profit (USD)" assertion replaced with the 4 new
  rate-stamped-block assertions, values verified by hand). Rule 17 proof done for real: temporarily
  changed `formatRateStampedProfitBlock`'s `rateLabel` to `""` (dropping the rate annotation — the exact
  defect the ticket calls "the whole point"), ran the suite, captured 3 real failures (verbatim in
  `rateStampedProfit.test.ts`'s comment), reverted, reran green. `Checkpoint.countSheet.test.tsx`'s
  `mockApi` gained a `getRates` mock (the new `useSellRate()` call in `Checkpoint/index.tsx` would
  otherwise throw synchronously in that suite).
- **Divergence flagged in source, not just here**: `rateStampedProfit.ts`'s module doc explains why this
  document uses `sell_rate` while the app-wide LBP→USD convention elsewhere is `buy` (2026-07-06
  decision) — deliberate, conservative-for-profit, made visible by printing the rate. Do not "fix" it
  to buy.
- **Gates**: `@liratek/ui` typecheck (5s) and lint (7s) exit 0; frontend typecheck (26s), lint (28s,
  0 errors/530 pre-existing warnings unrelated to this change), and full `test` (63s, 181 suites/1370
  tests, up from baseline 180/1360 — +1 new suite, +10 new tests, 1 pre-existing skip) all exit 0. Ran
  `yarn workspace @liratek/ui build`/`typecheck`/`lint` and `yarn workspace @liratek/frontend
typecheck`/`lint`/`test` directly (not root `yarn test`) since no `packages/core`/`backend` files were
  touched. Nothing left undone.

---

## LIRA-175: `lira-136-binance-fee-mode-c-ui-driven.spec.ts` — order-dependent failure, only inside the full suite; blocks future e2e sharding — LOW — DONE (2026-09-04)

**Priority:** Low · **Epic:** E2E Infra/Testing · **Status:** DONE — fixed at the spec level after a harness-level attempt was proven to regress an unrelated spec (see Resolution below)

**Filed 2026-09-04**, while fixing LIRA-151's genuinely-failing spec on this branch. This ticket is a
record of an already-diagnosed-as-out-of-scope failure, not a fix — per instruction, the spec itself was
left untouched.

`frontend/tests/e2e-electron/lira-136-binance-fee-mode-c-ui-driven.spec.ts:157` — _"'Customer pays
separately' is absent while a session is active"_ — fails **only when run as part of the full desktop e2e
suite** (observed on Ubuntu CI) and **passes when run alone** (verified on Windows). Both directions were
verified before filing.

**Where it fails:** line 186, `await expect(appPage.locator("#crypto-amount")).toBeVisible({ timeout:
20_000 })` — i.e. failing during the test's own _setup_ (starting a session, navigating to `/recharge`,
clicking the "Binance" provider button, waiting for the crypto-amount field to render) rather than at its
actual assertion further down (the "Customer pays separately" absence check). A spec failing inside its
own setup step, with the same steps succeeding in isolation, is the signature of state left behind by
whichever spec(s) ran immediately before it in the shared run — not a defect in this spec's own logic or
in the LIRA-160/161/162/163 work this branch actually touched.

**Confirmed NOT caused by this branch:** the spec and the code path it drives (Binance/crypto recharge
provider selection) are untouched by LIRA-160/161/162/163. The failure is a pre-existing property of
running the suite in full, surfaced now only because this was the first time the full suite was run since
it started failing.

**The mechanism to investigate** (per CLAUDE.md rule 15): the desktop e2e suite shares **one accumulating
SQLite database** across every spec file, run in order, against a **single Electron window per worker** —
there is no per-file reset. Some earlier spec in the full-suite ordering is leaving behind state (an
active session that shouldn't be active, a module/provider toggle, a lingering modal/toast, drawer or rate
state, etc.) that this spec's setup steps don't anticipate and don't defend against. Finding _which_
earlier spec, and _what_ state it leaves, is the actual investigation — this ticket does not attempt that;
it only localizes the failure to the setup step and rules out this branch as the cause.

**Why this is more than a flaky-test annoyance:** this spec is now a concrete, demonstrated blocker for any
future attempt to shard/parallelize the e2e suite. Sharding would split specs across multiple
workers/DBs, which is exactly the kind of change that would partition (or accidentally fix, or
unpredictably relocate) whatever cross-spec state this failure depends on — so this failure mode should be
understood, not just individually silenced, before anyone attempts that. That context — not the specific
fix — is the most valuable part of this ticket.

**Do not fix, do not touch the spec, as instructed when this was filed.** Whoever picks this up should
start by bisecting the full-suite run (e.g. running increasingly large prefixes of the suite ending at
lira-136) to identify the specific preceding spec(s) responsible, then decide whether the fix belongs in
that spec (clean up after itself) or in this spec (defend its own setup against whatever state
pre-existing sessions leave behind).

---

### Resolution (2026-09-04, owner decision superseded "do not fix yet")

**Bisection attempted, could not force a repro on Windows.** Ran, in order: (1) lira-136 alone — 3
passed; (2) `lira-097-debt-cashout` (opts out of the harness's 2ms toast auto-dismiss via
`test.use({ notificationDurationMs: null })`, sorts before lira-136) → lira-136 — 7 passed; (3)
`lira-089-bill-commission-settlement` (same opt-out) → lira-136 — 4 passed; (4)
`lira-135-session-checkout-net-negative-mixed-basket` — the spec that sorts **immediately** before
lira-136 in true full-suite order, and leaves its own `SessionCheckoutModal` "Checkout Complete" success
view on screen with no explicit close (its own comment says so) → lira-136 — 4 passed; (5) the full,
true-order prefix of **all 79 spec files** (223 tests) from the start of the suite through lira-136
inclusive — 223 passed in 5.3m, lira-136's session-gating test taking 8.8s, unremarkable. None reproduced
the CI failure. Conclusion: this is a genuine Windows-vs-Ubuntu-CI timing difference, not a state leak
reproducible by ordering alone on this machine — consistent with the ticket's own filing, which only ever
claimed the failure on Ubuntu CI and only ever verified the pass-alone case on Windows.

**Root-cause theory (Likely, not proven by reproduction):** the failure signature — a `{ force: true }`
click that "succeeds" (force skips Playwright's actionability/obstruction check, so the resulting click is
a real OS-level click at the target's on-screen coordinates, landing on whatever is topmost there) followed
by `#crypto-amount` never appearing at all ("element(s) not found", not just "not visible") — matches a
click intercepted by an overlay, not a slow render. `navigateTo()`'s existing overlay-dismiss logic
(fixtures.ts) only targets `div.fixed.inset-0` modals; `NotificationCenter`'s toasts are
`fixed bottom-4 right-4` and are invisible to that check. A spec that opts out of the harness's 2ms
auto-dismiss to assert on its own toast content (11 specs do, via `notificationDurationMs: null`) can leave
a toast alive for its real 3s/5s type default; if CI's timing (slower/shared runner, different render
pacing) lines up such that one is still on screen when this spec's setup force-clicks "Binance," the click
is silently eaten. This is the same class of bug as LIRA-151 (fixed same day: a toast assertion racing the
2ms default), just the _intercepting_ side of it instead of the _asserting_ side.

**Fix — spec-level, NOT harness-level, and here is why that reversed the original preference:** the first
attempt put a generic toast-dismiss step inside `fixtures.ts`'s shared `navigateTo()` (used by all ~110
spec files) — reasoning that a harness fix protects every spec, matching this ticket's own stated
preference. That attempt was **proven wrong by execution**: paired with lira-097, it turned a passing run
into a consistent, reproducible failure — not in lira-136, but in lira-097's OWN "mixed position" test,
which asserts a `"Cash out processed!"` toast (a fixed, no-amount string — `Debts/index.tsx:646`).
`NotificationCenter` dedupes identical `type:message` keys within a rolling 5s window regardless of whether
the earlier toast is still visually present (dismissing it early does not reset the dedupe timestamp), and
this spec's two cash-outs already sit within a few hundred ms of that 5s boundary. The generic fix's added
per-`navigateTo()`-call latency (one extra `count()` await, suite-wide) was enough to flip that pre-existing
marginal race consistently red across 2/2 runs. Reverted `fixtures.ts` back to the committed original
(confirmed via `git status` — zero diff) rather than also fixing lira-097's race, which is out of this
ticket's scope and out of the touchable-files list. The fix instead lives entirely in
`lira-136-binance-fee-mode-c-ui-driven.spec.ts`: a local `dismissToasts()` helper (actively clicks each
visible toast's own X button — not a blind wait, not a weakened assertion, and `{ force: true }` is left
untouched since it is legitimately needed elsewhere per `helpers/nav.ts`'s own comment about z-layer
settling) called both from the shared `openBinanceCashOut()` helper and inline in the failing test, right
before each `{ force: true }` click on the "Binance" button. Blast radius: one file.

**Verified:** `npx tsc -p tsconfig.playwright.json --noEmit` and `npx eslint
tests/e2e-electron/lira-136-binance-fee-mode-c-ui-driven.spec.ts` both clean. lira-136 alone: 3 passed
(23.2s). Paired after lira-097: 7 passed (30.0s) — including lira-097's own "mixed position" test back to
1.2s (was 15.9s/failing with the reverted harness-level attempt). Paired after lira-089: 4 passed (22.8s).
Because the fix is confined to the one spec file (`fixtures.ts` is untouched), the mandatory-full-suite
rule was not triggered (owner call, 2026-09-04) — CI already has an independent full run in flight against
this branch.

**Honest limitation:** the local Windows environment never turned this failure red, including with the
full true-order 79-file/223-test prefix (item 5 above). The fix is a well-reasoned hardening against a
documented, real gap (toasts uncovered by `navigateTo()`'s overlay-dismiss) and the exact bug class that
already hit this suite once (LIRA-151), not a red-to-green proof of THIS specific failure. If it recurs on
CI after this lands, the next data point should be the CI trace/screenshot at the moment of failure
(`document.elementFromPoint` at the click coordinates, `document.querySelectorAll('[role="alert"]')`) to
confirm or rule out this exact mechanism.

---

## LIRA-219: LBP-denominated profit is dropped from BOTH closing totals, not deferred — MEDIUM

> **⚠ Renumbered 2026-09-22 — was LIRA-176.** That number collided with
> `docs/plans/done_plans/LIRA-176_MAINTENANCE_PARTS_PLAN.md` (Maintenance Parts / Parts Profit /
> Job Detail Panel, DONE, shipped `396b0dfa`). The maintenance ticket keeps LIRA-176 because
> commits and an archived plan filename already reference it; this one moved to the next free ID.
> Same failure mode as the LIRA-070/094 collision recorded in
> `docs/plans/ongoing_plans/OWNER_NOTES_TASK_PLAN.md:20-24`.

**Priority:** Medium · **Epic:** Closing · **Status:** DONE 2026-09-25 — committed `9ed8d90f` — **WIDENED 2026-09-24**, built per `docs/plans/done_plans/LIRA-219_CLOSING_PROFIT_PARITY.md`; unit/typecheck/lint green, desktop+web e2e green apart from unrelated stale specs (lira-158/lira-103 e2e updated but not yet re-run) · **Found:** 2026-09-04, while building LIRA-174

> **Widened by the owner, 2026-09-24:** today's profit in the closing report must EQUAL the Profits
> page's profit for today. Closing reuses the Profits page's shared code instead of its own copies
> (rule 14); only owner-decided differences survive, as named exceptions. The original LBP-slice gap
> below is one of four symptoms: (1) kept change ignored for every module, including loto's USD kept
> change (`LO-R10`); (2) the LBP slice below; (3) sales profit per unit, never × quantity
> (`ClosingRepository.ts:880`); (4) partner loto tickets. Symptom (4) is OUT of scope and goes with LIRA-173.
> Design + status: `docs/plans/done_plans/OWNER_NOTES_2026-09-21.md` §6.9.

`getDailyStatsSnapshot` returns two profit figures and an LBP-denominated profit slice can fall
outside **both** of them. This is a gap in the data, not in the PDF that displays it.

**Verified against source:**

- `totalProfitLBP` (`ClosingRepository.ts` ~:1360) is `lotoProfit.profit_lbp` — **loto's commission
  alone**. Nothing else feeds it.
- `finProfitLegacy`'s four branches (`finProfitLegacyDegraded` / `PartnerOnly` / `DebtOnly` / `Full`,
  ~:956, :969, :983, :997) each sum
  `CASE WHEN currency != 'LBP' THEN commission ELSE 0 END` — so an LBP-denominated
  financial-services commission is excluded from `profit_usd`.

Those two facts together mean **LBP financial-services commission appears in neither total**. It is
not deferred to a later day and not converted — it is simply absent from the closing profit figure.

**Reported but NOT yet verified** (the LIRA-174 agent's finding, based on the repository's own
comment): the same is true of sales, recharge, custom services, maintenance and exchange — i.e. every
module folded into `totalProfitUSD` excludes its own LBP slice, because no convention exists there for
folding LBP into a USD total. **Confirm module by module before acting**; the mechanism may differ per
module (some may only ever have USD columns, which would be a non-issue rather than a gap).

**Why this matters now.** LIRA-174 prints an LBP profit line on the closing PDF. Because the figure is
loto-only, that line is deliberately labelled **"LBP amount (Loto only)"** rather than presented as
complete LBP coverage — an honest label over a wrong total. Closing this ticket is what would let that
label become simply "LBP amount".

**Not to be confused with the stamped-rate question.** LIRA-174 established that per-row stamped-rate
conversion is impossible at this layer because the snapshot returns currency-bucketed `SUM`s. That is a
separate, larger change (pushing conversion inside ~7 module sub-queries). This ticket is narrower:
make sure an LBP profit slice reaches _a_ total rather than vanishing.

**Acceptance:** every module's LBP profit slice reaches either `totalProfitLBP` or a documented,
deliberate exclusion; rule 17 failing-first per module changed; the shared gate fragments reused, never
re-texted (rule 14); and LIRA-174's PDF label updated once the figure is genuinely complete.

---

# 2026-09-07 session findings — filed 2026-09-07

---

## LIRA-177: Profits page visible to all roles, gated by a separate per-page password — MEDIUM — SHIPPED, VERIFICATION PARTIAL (2026-09-07)

**Priority:** Medium · **Epic:** Profits / Auth · **Status:** PARTIAL — feature complete; desktop
e2e green; core jest + REST route tests now green (`e257d3af`). **One gap left before DONE:**
`lira-web-029` has never been run, so rule 19d (prove it in web mode) is unsatisfied. See §5.

**Commits (all on `main`):** `12c3dd72` feature · `c074843f` Suspense revoke fix · `a36850a4`
lira-120/158 spec fixes · `a079bc79` gate-state wait fix.

### 1. Owner spec (recorded, not designed here)

"Profits page should be visible for all user roles, but when accessing that page I want an 'enter
your password' — we will have a separate password for that page set only by admin user from
settings." Three follow-up decisions, all owner-answered:

- **Everyone types it** — admin is prompted too, not just staff.
- **Server-enforced**, not a UI curtain.
- **Every visit re-prompts**, plus a 15-minute timeout after unlock.

### 2. What shipped

- Migration **v163** flips the `profits` module row to `admin_only = 0` (both roles see the nav
  item); `create_db.sql` mirrored (rule 10). `/profits` route moved `AdminRoute` → `ProtectedRoute`.
- `ProfitsAccessService` (core) holds set/verify/isPasswordSet over `SettingsRepository` (rule 13),
  scrypt via `utils/crypto`. **Fail closed** — nobody enters, admin included, until an admin sets a
  password in Settings › Profits Password. Short PINs are legal: it enforces
  `PROFITS_PASSWORD_MIN_LENGTH` (4), deliberately NOT `validatePasswordComplexity`.
- Both transports (rule 19), one core service, schema shared: 4 IPC channels + 4 REST routes. The 7
  profit data endpoints swapped `requireRole(["admin"])` for a live-unlock check. Unlock state is
  per-webContents on desktop and per tenant+user on web, TTL from one shared constant.
- `ProfitsPasswordGate` wraps the page; unlock lives in component state only (never storage), so
  unmount re-locks. Keeping `Profits` lazy means its chunk loads only after a successful unlock.

### 3. Security note — the hash could not just live in `system_settings` unguarded

`GET /api/settings` is **deliberately unauthenticated** (`backend/src/api/settings.ts` — the web login
screen reads the shop name before auth), and IPC `settings:get-all` / `db:get-setting` carry no role
check. So `SettingsService` now redacts `SENSITIVE_SETTING_KEYS` from every read **and rejects writes
to them** — the password is set only through `ProfitsAccessService`. The write guard matters
independently: `PUT /api/settings/:key` has `authenticateJWT` but **no `requireRole`**, so without it
any authenticated staff user could overwrite the hash through the generic endpoint. **That missing
`requireRole` is a pre-existing hole this ticket routed around rather than fixed — worth its own
ticket.**

### 4. Two real bugs found after the first commit, both now fixed

- **Unlock revoked immediately after succeeding** (`c074843f`). `App.tsx` wraps all routes in ONE
  `<Suspense>` **above** the gate, and `Profits` is lazy **inside** it. On unlock the gate rendered
  the unloaded chunk → suspended → the boundary above hid the gate's subtree → React 18+ destroys
  effects for a hidden subtree while **preserving state** → the gate's unmount cleanup fired
  `profits:lock`. UI unlocked, server locked, every profit call 403/throw. Fixed by giving the gate
  its own inner `<Suspense>`. **Deleting that boundary reintroduces the bug.**
- **e2e helper silently typed nothing** (`a079bc79`). `unlockProfitsPage` branched on
  `isVisible()` — the one Playwright check that does not auto-wait — and returned "already unlocked"
  during two pre-decision windows: before the route mounted (there was no `/profits` entry in
  `navigateTo`'s `routeAnchors`) and during the gate's own status fetch. Now one
  `lockScreen.or(noPasswordSet)` wait, the silent no-op **deleted** (it converted "couldn't find the
  lock screen" into "success"), and `/profits` added to `routeAnchors`.

### 5. Verification gaps — the reason this is PARTIAL, not DONE

- ~~**Core jest never executed.**~~ **CLOSED 2026-09-07** (`e257d3af`) — owner ran `yarn install`;
  both suites now pass (12 tests) and were additionally proven against the buggy code per rule 17:
  emptying `SENSITIVE_SETTING_KEYS` fails all 4 redaction guards while the normal-key control still
  passes, so they detect the guard's removal without being over-broad.
- ~~**Web transport has zero automated coverage.**~~ **PARTIALLY CLOSED** (`e257d3af`) —
  `backend/src/api/__tests__/profitsGate.api.test.ts` adds 14 REST tests (staff-403 on set-password,
  fail-closed, locked-403, both-roles-unlock-then-read, TTL expiry). **STILL OPEN:** `lira-web-029`
  has never been run, so rule 19d remains unsatisfied. Needs `yarn test:e2e:web` — note that does
  `rebuild:node` and flips the native ABI, so the `yarn dev` cycle is required again before any
  desktop e2e afterwards.
- ~~**The 15-minute TTL is untested**~~ **CLOSED 2026-09-07** (`e257d3af`) — and it turned out the
  predicate `now - stamp < PROFITS_UNLOCK_TTL_MS` was copy-pasted into THREE sites (rule 14
  violation introduced by this very feature), which is why it had no testable home. Extracted to
  core's `isProfitsUnlockLive(unlockedAt, now)`, all three sites delegate to it, 8 unit tests cover
  the boundary — **exactly at** the TTL is EXPIRED (strict `<`); do not "tidy" it to `<=`.
  **STILL OPEN:** the client-side auto-relock timer in `ProfitsPasswordGate` has no test.
- ~~**Docs not updated**~~ **CLOSED 2026-09-07** — `FEATURE_GUIDE.md` §10 (its "admin-only in three
  layers" bullet was left factually WRONG by this feature and is now corrected, not merely
  appended to), the `WEB_PARITY_ROADMAP.md` step-2 table, and `PROFITS_UNLOCK_RATE_LIMIT_MAX` in
  `.env.deploy.example`. Deliberately NOT added to `docs/DEPLOYMENT.md`'s env checklist — that list
  is the "at minimum" REQUIRED vars, and this one has a working default.
- **Known design limit (documented, not fixed):** the web unlock map is per-process, so an unlock
  granted on one worker is invisible to another. Fine for today's single-process backend; needs shared
  storage before running multiple workers.

### 6. Fallout this caused in existing specs — resolved, but note the pattern

The 7 profit IPC channels are used as a profit **oracle** by 12 specs testing unrelated money flows.
All 12 now call an idempotent `ensureProfitsUnlocked()` fixture first. Two traps worth remembering:
lira-071 originally used its own password literal while the fixture used another, which would have
failed all 12 unlocks; and a once-per-test unlock is **not** enough for any spec that also visits
`/profits`, because the gate's revoke-on-navigate-away kills it — `getProfitFigures` in lira-158 now
ensures its own unlock per call.

**Also fixed here, not caused here:** lira-120 asserted a partial partner settlement recognises `0`
profit — the pre-#74 all-or-nothing model. `5d61f9a4` replaced it with proportional recognition and
never updated the spec. The implementation is correct; derived independently as
`markup x covered/obligation = 30.13 x 40/80.13 = 15.040559091...`, matching the observed value to
every printed digit. The spec now **computes** that expectation from its own constants rather than
pasting the literal, plus two guards (`> 0`, `< MARKUP_USD`) so it pins the behaviour and not a
number.

---

## LIRA-179: annual days price repriced 2,300,000 → 1,780,000 — DONE (2026-09-07)

**Priority:** Medium · **Epic:** Recharge / Telecom · **Status:** **DONE** `720e8029` (shipped with
LIRA-180; the migration itself is v159, committed earlier and swept into `d7e9cb7f`)

### What changed

`TELECOM_DAYS_SELL_PRICE_LBP[365]` moved from 2,300,000 to **1,780,000**, deepening the annual bulk
discount from ~24% to ~41% off the 8,333 LBP/day rate the 30/60/90-day tiers run at (4,877 LBP/day for
the year). Migration **v159** repriced the six existing 365-day rows.

**This is a pricing decision, not a correction.** v147's 2,300,000 was arithmetically fine — the shop
simply charges less for the year now. Only the days SELL line moved: `cost_lbp`, `credits`,
`days_cost_lbp` and the credit-cost rate R are untouched, so what a card costs is unchanged.

### Where the figure came from

An outside analysis the owner brought in. Its **price** was adopted; its **cost formula** was
explicitly rejected — see §"Why we kept our formula" below, because this is the part most likely to be
re-litigated by whoever reads that document next.

### What it costs, on the iPick 7,728,000 / 77.28 / 365d card

```
Settings "Days margin"     1,140,800 → 620,800   (-520,000)
BOOKED Only-Days profit      777,000 → 257,000   (-520,000, i.e. -67%)
Total per card (incl. resale) 1,502,380 → 982,380
```

**Settings' "Days margin" and the booked profit are different numbers and always were.** The gap is
exactly `(77.28 − 73) × 85,000 = 363,800` — the SMS haircut priced at R. Settings shows the
pre-haircut _allocation_ view (`sell_days_lbp − days_cost_lbp`, face-anchored); the profit stamp shows
the post-haircut _real_ one (`sell_days − cost + recovered × R`). Both are correct for their own
question, but the Settings figure reads optimistic and nothing on that screen says so. **Open, not
filed as its own ticket yet** — see LIRA-180 §Follow-ups.

### Why we kept our formula (do not "fix" this)

The outside analysis derived days cost as `cost − recovered × SELL price`, anchoring on what credit
sells for rather than what it costs. That is a legitimate accounting method (net-realizable-value
allocation) and answers a real question, but it was rejected as a _cost basis_ for three reasons:

1. **Cost would move when the shop changes its own price.** At 110,000/$ the implied days cost goes
   **negative** (−302,000 on this card). A cost that goes negative when you raise a price is not a
   cost — and profit is _stamped at sale time_, so it must be knowable at purchase.
2. **It makes the resale table vacuous.** `recoveredRateLbp` collapses algebraically to exactly the
   sell price, so the 1$/2$/3$ decision aid would always read break-even and could never tell the
   owner whether 100,000/$ is too low. This is Model B, already rejected in `telecomCredit.ts`.
3. **It changes nothing.** R cancels out of total profit — it only decides attribution between the
   days line and the credit line.

The analysis also **double-counted**: its two profit lines are algebraically identical (each equals the
full gross G), so its summary table reads ~2x the real profit. Recorded here so the same document does
not get re-adopted wholesale later.

### Verification

All six 365-day rows checked against the live catalog before shipping — every one still prices days
ABOVE `days_cost_lbp` at the new price, thinnest margin +620,800 (iPick 7,728,000). No card sells its
days at a loss.

### NOT done

- **No e2e spec.** Neither Only-Days spec reads the 365-day table (both self-provision their own
  `sell_days_lbp`), so nothing existing breaks — but per this file's top note, a ticket is not
  complete without one.

---

## LIRA-180: per-card "max returned credits" override (v160) — DONE (2026-09-07)

**Priority:** Medium · **Epic:** Recharge / Telecom · **Status:** **DONE** `720e8029` — code, unit and
integration green; **e2e outstanding**

### The problem

`maxReturnableCredits()` models a **bare** card — nothing on the line but the card's own credit. For
the alfa 77.28 card that yields **$73.00**: 24 messages × $3.16 spends $75.84, leaves $1.44, and a
final $1.50 message needs $1.66. In practice the customer's line holds a little of their own credit,
and **$0.22** of it closes that gap, so the shop actually gets **$73.50** back. The computed figure is
right about the physics and wrong about the shop.

**Not special to this card** — every credit-bearing card in the catalog sits $0.03–$0.49 from another
half-dollar (3.79 needs $0.03; 22.73 needs $0.05). The backfill is still scoped to 77.28 only, because
that is the one with counter experience behind it.

### Owner decisions (interview 2026-09-07)

| #   | Decision                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Per-card field showing the computed value, overridable — the `days_cost_lbp` derived/override pattern, with a one-click reset                                                                                                  |
| 2   | **Upward only**, capped at one `CREDIT_TRANSFER_STEP_USD` above computed. The catalog-wide shortfall all fits in one step, so the cap is the real mechanism, not an arbitrary bound; it also blocks the 83-for-73.5 typo class |
| 3   | Applies **everywhere**: sale autofill, kept-credits base (what the customer is charged), profit stamp, carrier-line credit, Settings economics                                                                                 |
| 4   | **A short transfer IS billed.** Returning 73 against a 73.5 base charges the 0.5 difference (+50,000 LBP). The shop does not absorb a failed transfer                                                                          |
| 5   | Backfill the six 365-day 77.28 rows only                                                                                                                                                                                       |
| 6   | A save that strands an override is **rejected**, never auto-cleared                                                                                                                                                            |

**Decision 4 is the sharp edge.** The customer pays 50,000 for credit that burned in SMS fees and never
landed on their line. Owner-confirmed and deliberate; guarded by a KatchForm test so it cannot drift
silently. It is the item most likely to cause a counter dispute — if it is ever revisited, that test is
where the current behaviour is pinned.

### What shipped

`resolveMaxReturnedCredits()` is the ONE definition of `override ?? computed` (rule 14). The cap is
enforced on the **write** path in BOTH directions — setting the override, and editing `credits`
underneath a stored one (the second direction is the one that ships as a bug, since nothing in that
payload mentions the override). The **read** path ignores an out-of-range value rather than trusting
it, so a row that went stale still prices sales correctly.

`days_cost_lbp` is deliberately untouched: it is face-anchored because it allocates a PURCHASE before
any sale exists, while this prices what actually comes back from a specific sale. Different questions —
do not merge them.

### Rule 20

No new ledger row type, so no new reversal owner. Refunds reverse
`carrier_line_movements.credits_delta` by `transaction_id` rather than recomputing from the catalog,
so changing an override cannot desync a sale booked before the change. Pinned by a
create → change-override → refund test that nets every ledger to 0.

### Three near-misses worth remembering

1. **INSERT arity.** Adding the column left `createItem`/`bulkCreate` at 17 columns / 16 values —
   every insert would have thrown at runtime. Caught by checking parity programmatically, not by eye.
2. **Test-schema sweep.** The new column voided six hand-rolled test schemas _at setup_, which
   presents as a broken suite rather than a failed assertion.
   `telecomDaysCreditValiditySchema.test.ts` was correctly left alone — it builds a pre-v140 table on
   purpose.
3. **Migration assumed its table exists.** v160 went straight to `ALTER TABLE` and broke an unrelated
   suite (`PartnersSystemAssociationFkMigrationViaRunner`'s round trip) with `no such table`, nowhere
   near this change. Migration tests build minimal DBs and the runner walks every migration over them.
   Now guarded on `sqlite_master` like v157/v158, with three regression tests.

### Gates

`yarn typecheck` clean; `yarn test` 465 suites / 4,611 tests, 0 failures (backend 622, frontend 1,317,
core 2,672). Core rebuilt and synced into `node_modules/@liratek/core/dist`.

### Follow-ups (open)

1. **No e2e spec** — set the override in Settings, sell Only-Days, assert the autofill and the charge,
   on desktop and web. Required by this file's top note.
2. **Settings shows the allocation margin, not the booked one** (LIRA-179 §). 620,800 vs 257,000 on the
   77.28 card, differing by the SMS haircut at R. Candidate fix: show both.
3. **`KatchForm` clamps a return above the base to zero kept credit.** If the shop ever recovers more
   than the configured maximum, the excess is valued nowhere. Narrow, and only reachable once someone
   returns above their own override.

---

## LIRA-181: SMS transfer fee becomes an expense — DONE (2026-09-07)

**Priority:** Medium · **Epic:** Recharge / Profits · **Status:** **DONE**
`d84c04ad` (merge of `sms-fee-expense`; the work itself is `cff444ea`). Owner decision 2026-09-06.

The recharge profit stamp subtracted the SMS transfer fee, so a $3 MTC sale for 300,000 LBP reported
**30,600 LBP** on Profits while the recharge page's own preview showed the **45,000** gross margin —
`300,000 − (3 × 85,000) = 45,000`, minus `$0.16 × 90,000 = 14,400`. Two formulas for one concept,
sharing no definition.

Owner's call: the module shows **gross**, and the fee becomes a visible expense. Total net profit
unchanged — the cost moved out of recharge margin onto its own line.

Implementation worth recording: the fee **already moved money** (an `SMS_COST` leg plus a
provider-balance debit, hand-written in `RechargeRepository`), so the change **moves** that debit into
`ExpenseRepository.createExpense` via `drawer_override` rather than adding a second movement —
following LIRA-145's `Line_Usage` precedent so the row inherits the existing void/refund and reporting
machinery. Migration **v163** (renumbered on merge; the commit message and PR description said v166,
but the shipped migration in `packages/core/src/db/migrations/index.ts` and `create_db.sql` is v163)
`add_expenses_source_ref` adds `expenses.source_ref_table`/`source_ref_id`. Rule 20:
`_cascadeExpenseSiblingVoid` is wired into both void and refund. **Cutover, not restatement** —
existing recharges keep their stamped figure, per D3.

Rule 17 evidence, all executed: reintroducing the subtraction failed the gross assertions
(`Expected 60000, Received 31360`); disabling `createExpense` failed the expense-link assertions;
commenting out the cascade left **$0.32 of un-reversed SMS expense stranded on the MTC drawer**
(`Expected 1000, Received 999.68`). A double-debit guard asserts the MTC drawer moves by exactly
**−3.16** for a $3 transfer, never −3.32.

Note two consequences: every CREDIT_TRANSFER now writes an **extra EXPENSE transaction row** alongside
the RECHARGE, and 7 test fixtures needed an `expenses` table added because every credit transfer now
reaches `createExpense`. Verified at merge: 276 suites / 2903 tests, exit 0.

---

## LIRA-182: partner obligations recognised proportionally — DONE (2026-09-06)

**Priority:** Medium · **Epic:** Profits · **Status:** **DONE**
`5d61f9a4` (PR #74). Owner decisions 2026-09-05, from the interview that closed LIRA-173.

Partner profit was all-or-nothing: a partner-pending row contributed zero revenue and zero profit
until the partner settled in full, then jumped to 100%. It is now weighted by the fraction actually
covered. Scope: **Profits page only**, all `FOR_%` modules. `ClosingRepository` keeps its binary gate,
`ExchangeRepository` untouched, and all 36 `notDebtPending` sites untouched — **DBT-1 stands**.

Two fragments, `partnerCoverageRatio` and `txnPartnerCoverageRatio`, both **derived at read time and
never stamped** — a binding constraint, because a refund that unwinds coverage through the existing
reverse-FIFO then corrects the figure automatically, satisfying rule 20 by construction. Counts are
never weighted: a partner transaction counts once **any** money arrives
(`SUM(CASE WHEN ratio > 0 ...)`), because the frontend renders counts as bare integers and a weighted
count would have printed literally as "3.4 txns".

Record the continuity property, since it is why an existing test passes unchanged: at ratio 0 and
ratio 1 a row contributes exactly what the gate contributed, so only partially-covered rows differ.
`LIRA158.settlementAttribution` therefore passes **unedited** — zero-contribution rows are filtered
out of five grouped queries rather than surfacing as phantom `$0.00` provider rows.

Two bugs found by execution: a bare output-alias in `HAVING` silently resolved to a real joined column
instead of the aggregate (three of four filters did nothing), and `EXCHANGE_LEG_PROFIT`'s `COALESCE`
sum needed parenthesising or the weight bound to `leg2` alone and leaked `leg1`.

The merge included a follow-up commit recovering integration work dropped by a `git reset --soft`
during the original push (caught by CI: 274/2879 with 2 failures vs the intended 277/2901 green).
Verified on the merged result: core 277 suites / 2901 tests, backend 46/633, frontend 181/1370, all
exit 0.

**Also fixed as fallout, not by this ticket directly:** lira-120 asserted a partial partner settlement
recognises `0` profit (the pre-#74 all-or-nothing model), computing `0` under the old model. `5d61f9a4`
replaced the model with proportional recognition and left the spec unedited until this was caught; the
spec now derives its expected value independently from its own constants
(`markup × covered/obligation = 30.13 × 40/80.13 ≈ 15.04`) rather than pasting a literal.

---

## LIRA-183: every LBP row shows 0% margin on Profits → By Module — DONE 2026-09-25 (uncommitted batch) — Medium

> **DONE 2026-09-25.** Fixed as part of the Profits audit's PA-4.21 (`OWNER_NOTES_2026-09-21.md`
> §6.4/§6.6): server-side `margin_pct`/`margin_converted` on `ProfitByModule`, rate-free for
> LBP-only rows, flagged "≈" for genuinely mixed rows — the recommendation below, as built.
> Unit/typecheck/lint green.

`frontend/src/features/profits/pages/Profits.tsx:1356` calls `formatPct(row.profit_usd, row.revenue_usd)`.
`formatPct` (`:291`) returns `"0%"` when `total === 0`. An LBP-denominated row has **both USD
arguments at zero**, so it always prints `0%`.

The MTC recharge row's real margin is ~15% (45,000/300,000 after LIRA-181). **Same root cause as
LIRA-139**, where the amount sort read only `amount_usd` and every LBP row sorted as zero — a
USD-only computation on a dual-currency row.

Record the open design fork: a genuinely mixed USD+LBP row needs a rate to produce one percentage.
The recommendation is to fix the LBP-only case **rate-free** (which is 100% of the observed bug)
rather than introduce a conversion rate into a reporting percentage — and to flag mixed rows rather
than silently converting them.

---

## LIRA-184: "sales margin" is hand-written in six places; three ignore quantity — **DONE 2026-10-02 (not yet committed)** — Medium-High

**Re-verified against current `main` before touching anything (per LIRA-185's own caveat that this
audit read a working tree being edited in parallel) — the premise was stale.** Of the original six
cited sites, **three were already gone**, removed by *other*, already-shipped tickets before this one
was picked up:

- `ClosingRepository.ts:871` — removed by **LIRA-219**; that repository no longer computes profit at
  all (header comment: "gross profit is defined exactly once, by `ProfitService.getSummary`").
- `FinancialRepository.ts:130` — removed; the file is now a 45-line stub (`getDrawerNames()` only), no
  profit/margin logic whatsoever.
- `SalesRepository.ts:2078` (the old chart-data query, `SUM(sold_price_usd - cost_price_snapshot_usd)`,
  no qty, no discount) — removed by the **"DC-10" chart-data refactor**; `SalesRepository.ts` now
  carries its own doc comment at the old call site explaining `SalesService.getChartData` composes the
  Profit series from `ProfitService.getByDate` instead (rule 13 — no re-texted profit SQL in a
  repository).

So **the "three ignore quantity" bug does not exist on current `main`** — confirmed by execution, not
just reading: a new guard test (3-unit line, $70 price/$60 cost → stamped profit $30, i.e. 30/210 ≈
14.3%, never the $10/≈4.8% a quantity-dropping copy would stamp) was run against the pre-refactor code
and **already passed** (`SalesRepository.discountProfit.test.ts`, "stamps a 3-unit line's margin as 3×
the per-unit margin, not 1×"). Rule 17 calls for a red-then-green proof; there is no red to show here
because the bug this ticket set out to fix had already been fixed by LIRA-219 and DC-10 — forcing an
artificial failure to satisfy the letter of rule 17 would mean reverting finished code, which rule 17
itself forbids.

The remaining `ProfitRepository.ts` sites the original audit's line numbers pointed near (now at
2416-2417, 3487-3488, 4969-4970, 5689-5690, 8329) are **not accidental drift**: 2416-2417 is
`saleAggBody()`, a single shared helper already called from all 3 of its real call sites (the rule-14
dedup this ticket asked for, already done); the other four are intentionally frozen, individually
doc-commented schema-drift fallback branches gated behind `_hasSaleDiscountAndRefundQuantityColumns()`
— each one explicitly labelled "degrades to the byte-for-byte pre-fix query" for legacy/fixture schemas
missing `discount_usd`/`refunded_quantity`. They were left untouched: refactoring them would change
behaviour for the fixtures that deliberately exercise the old path, for no live-data benefit, and
`ProfitRepository.ts` is where LIRA-196 (parallel, date/day-logic work) is also active.

**What was actually duplicated and genuinely fixed (rule 14):** two LIVE TypeScript call sites in
`SalesRepository.ts` — `processSale`'s per-item loop (`saleProfitUsd += (item.price - costPrice) *
item.quantity`, was line 528/616) and `_computeSaleItemRefundAmounts`'s gross-margin step
(`grossMarginUsd = (item.sold_price_usd - item.cost_price_snapshot_usd) * refundQuantity`, ~line 1987)
— both already correctly multiplied by quantity, but hand-wrote the identical `(price - cost) *
quantity` subexpression. Extracted into one pure, no-I/O function, `lineGrossMarginUsd(unitPrice,
unitCost, quantity)` in `packages/core/src/utils/saleMargin.ts`, exported from `index.ts` (not
`browser.ts` — nothing in the frontend needs it), and used at both sites. This is a pure refactor with
**no behaviour change** (both call sites compute byte-identical numbers before and after — proved by
the full core suite staying green: 454 suites / 4420 tests).

**What users will notice:** nothing — this ticket's reported bug was already fixed before it reached
the top of the queue; today's change is an internal de-duplication with no behavioural effect, so no
release-note line was added (rule 30: refactors with no behaviour change get none).

Files changed: `packages/core/src/utils/saleMargin.ts` (new), `packages/core/src/utils/__tests__/saleMargin.test.ts`
(new), `packages/core/src/repositories/SalesRepository.ts` (2 call sites + import), `packages/core/src/index.ts`
(export), `packages/core/src/repositories/__tests__/SalesRepository.discountProfit.test.ts` (new guard
test).

---

## LIRA-185: profit-surface audit: 73 leads, 6 of 8 modules unverified — DONE (closed 2026-10-10)

A workflow audited all 8 modules across 5 surfaces each (module page preview, module table columns,
the `transactions` profit stamp, the Profits query, the Closing sub-query) and claimed **73
divergences**.

**State this honestly and prominently:** the adversarial verification phase was killed by an org spend
limit — 162 of 228 agents failed. Only **sales** completed a verified pass (7 claimed, 7 confirmed, 0
refuted → LIRA-184). For the other six modules the 73 are **leads, not findings**. Worse, the summary
arithmetic is misleading: when all three verifiers for a divergence errored, the code saw zero votes
and dropped it as unconfirmed — so "19 confirmed of 73" does **not** mean 54 were refuted.

All raw output is preserved at `docs/plans/todo_plans/profit-audit-2026-09/` — `raw-workflow-result.json`
(582 KB) and `journal.jsonl` (456 agent records, all 8 audit agents' full returns). The expensive
discovery work is banked; re-running only the verification for the six remaining modules is
comparatively cheap and is the recommended next step.

Note the caveat that the audit read a working tree the owner was editing in parallel, so findings
touching `SalesRepository`/`TransactionRepository` should be re-checked against current `main`.


**Owner decisions on the audit's open questions (2026-10-02):**
1. **MTC/Alfa payment-window Discount:** MAKE IT WORK. The discount lowers the price charged and the profit booked, capped at the margin. Today it is never applied: the sale is refused, or the discount becomes client debt.
2. **Loto page Commission card:** keep it as pure commission AND add a "Kept change" line under it, so it adds up to the Profits figure.
3. **Maintenance History / jobs list price:** show both, list price struck through next to the charged amount (e.g. 300,000 → 250,000).
4. **MTC/Alfa History, sale on a customer's account:** keep the profit figure with a "profit pending until paid" label, matching Profits.

Built after the display batch (it touches the same files). The money batch was committed in 0eaf8251 and pushed on 2026-10-02.

**Decisions 1 + 4 (MTC/Alfa) — built 2026-10-02, not yet committed.** The page sends `discount` with the list `price`; `RechargeRepository.processRecharge` charges `price − discount` everywhere (row, transaction, legs, debt, profit), records `discount`/`list_price` in `metadata_json`, and refuses a discount above the margin or on a buy-back (`utils/rechargeDiscount.ts`, shared with the sheet's cap). `getHistory` projects `profit_pending` from `notDebtPending`; History shows "Pending until paid". Guards: `RechargeRepository.discount.test.ts`, `Recharge.telecomDiscount.test.tsx`, `Recharge.historyProfitPending.test.tsx`, `HistoryModal.profitPending.test.tsx` (all red first), `TelecomForm.discountField.test.tsx` (not proven failing-first).
**What users will notice:** the MTC/Alfa Discount lowers what the customer pays and the profit, up to the sale's profit; History marks an unpaid account sale's profit "Pending until paid".

**Decision 1 follow-up (cap = margin − SMS fee; receipt line) — built 2026-10-02, not yet committed.** A CREDIT_TRANSFER sale also books its own `SMS_Transfer_Fee` expense (`planSmsTransfer`, `utils/telecomCredit.ts`) on top of `cost`, so a discount at the plain margin netted a loss equal to that fee. `maxRechargeDiscount`/`applyRechargeDiscount` (`utils/rechargeDiscount.ts`) now take an optional `extraFee`, subtracted from the cap; `RechargeRepository.processRecharge` computes it for CREDIT_TRANSFER only (fee converted to the sale's currency at the same rate stamped on the transaction) and passes 0 for every other type (DAYS/VOUCHER/ALFA_GIFT/SHOP_LINE_USE/CREDIT_BUYBACK — unchanged). `TelecomForm.tsx`'s sheet cap mirrors it (gated on the SUBMITTED type via `deriveSubmittedRechargeType`, not the tab); `CardGridPayView.tsx` (Alfa Gift only, no SMS fee) switched its hand-rolled `Math.max(0, sell-cost)` to the same shared helper. Receipt (owner decision #3): `buildServiceReceiptText` (`frontend/src/shared/utils/serviceReceipt.ts`) now prints "Price / Discount / Total" instead of a single "Amount" line when `metadata_json.discount > 0`, reading `list_price`/`discount` already stamped by the repository; no line when the discount is 0. Dual-transport: the receipt builder already reads through `window.api` (works on both desktop and web, unchanged infra). Guards (all red-proven first, by toggling the fix off and back on — not a git revert): `rechargeDiscount.test.ts` (new, pure-function boundary math), `RechargeRepository.discount.test.ts` (new `describe` block — real writers, real SMS expense row, net-to-zero check at the real $3/300,000/255,000/1-SMS archetype), `TelecomForm.discountSmsCap.test.tsx` (new, captures the `maxDiscount` prop via a mocked `PaymentSheet`), `serviceReceipt.test.ts` (2 new cases). Full `yarn workspace @liratek/core test`: 464 suites / 4516 tests green.
**What users will notice:** the MTC/Alfa Discount cap on a Credit Transfer now also leaves room for the SMS cost of sending the credit, so a maxed-out discount still never loses money; a discounted MTC/Alfa sale's receipt shows the full price, the discount, and the total charged.

Closed 2026-10-10: re-checked against source and git — all 19 confirmed divergences fixed (`0eaf8251`, `1d6822f9`,
`e451662e`, plus `9ed8d90f`, `1540a56e`); every module's leads run as `ProfitAudit.<module>.test.ts` (7 suites, 68
tests, green). Last leftover fixed today: Expenses → History showed "Cash" in the payment column for every expense; it
now shows each expense's own payment method. Unlabelled leads, status unknown: financial-services 10, maintenance D6.

What users will notice: in Expenses → History, the payment column shows how each expense was actually paid (for
example Whish or Binance) instead of always "Cash".

---

## LIRA-186: `embeddedCommission.guard.test.ts` keys exclusions by ordinal SQL-unit number — DONE 2026-10-02 (not yet committed) — Low

Its `EXCLUDED_UNITS` entries are keyed by an **ordinal position**, so adding any method that contains
SQL shifts them. Confirmed concretely in the guard file itself
(`packages/core/src/constants/__tests__/embeddedCommission.guard.test.ts:473,480`): LIRA-181's new
`TransactionRepository` method moved a unit from `#20` to `#21`, requiring the key
(`"TransactionRepository:getCustomerFacingLegs:(query-like #21)"`) and its explanation to be updated
in an otherwise unrelated change.

Why it matters beyond the annoyance: a guard that breaks when unrelated code is added trains people to
edit the guard rather than investigate — and this guard exists specifically to stop ungated commission
reads reaching reports. Key exclusions by something stable (method name plus a distinguishing
fragment) instead.

**What users will notice:** nothing — test-only, no behaviour change (rule 30: no release-note line).
`EXCLUDED_UNITS` is now `ExclusionRule[]` keyed by `{file, method, sqlContains}` (a
whitespace-normalized substring of the unit's own SQL), matched via `matchesExclusion`/
`findExclusion` instead of exact `unitKey()` string equality — identity no longer depends on the
parser's `(query #N)`/`(query-like #N)` ordinal fallback label, so an unrelated query added/removed
earlier in the same mis-attributed method span can no longer silently break an exclusion. New test
"exclusion identity survives an ordinal-label shift" is explicitly labeled **NOT proven
failing-first** in its own comment: the "old" behaviour it documents is the code this very change
replaces, so reproducing it failing would mean reverting the fix mid-delivery (rule 17's own
self-referential carve-out) — what IS executed is the old scheme's break as an unconditional
string-equality fact, and the new scheme's survival against the real shipped `findExclusion`. Full
`src/constants` guard suite (9 files / 88 tests) green after; core `tsc -p tsconfig.json --noEmit`
clean (8.7s).

Files changed: `packages/core/src/constants/__tests__/embeddedCommission.guard.test.ts`.

---

**Note (not a ticket) — v163 migration missing from `create_db.sql`'s `schema_migrations` seed.**
Confirmed against current `main`: the seed list jumps `(162, 'rename_omt_whish_route_to_omt_whish')`
→ `(164, 'add_product_stock_batches_and_intake_ledger_type')` (`electron-app/create_db.sql:2066-2067`,
re-resolved 2026-09-23 — the seed block grew by 6 lines above it in this batch).
`profits_module_visible_to_all_roles` is migration v163 in `packages/core/src/db/migrations/index.ts`
(line 9886) but is never seeded into `create_db.sql`. Consequence: on a **fresh install** v163 will
actually RUN (clearing `admin_only` on the `profits` module) rather than being recorded as already
applied via the fresh schema, so a fresh DB and an upgraded DB can diverge in module visibility. Rule
10 wants both files updated. This is framed as **the owner's call** — whether `profits` should be
staff-visible on a brand-new install is a product decision, not something to fix unilaterally.

---

## LIRA-178: `PUT /api/settings/:key` has `authenticateJWT` but no `requireRole` — any staff user can write any setting — MEDIUM

**Priority:** Medium · **Epic:** Auth / Settings · **Status:** **DONE** (2026-09-07) — committed `b1dae8db` · **Found:**
2026-09-07, while building LIRA-177 (pre-existing; **not** introduced by that ticket)

**Shipped.** `requireRole(["admin"])` added to `PUT /:key` after the router-level
`authenticateJWT`, mirroring the IPC twins. `GET /:key` deliberately left open to any
authenticated role, now with a comment saying so is a decision (settings drive UI rendering for
every role) rather than the same oversight repeated. Guard proven failing-first per rule 17 by
execution, not inspection: removing it makes exactly one assertion fail — "staff gets 403 and the
setting is NOT written" — with 403 expected, 200 received. 5 tests in
`backend/src/api/__tests__/settingsRoleGate.api.test.ts`.

**A second, unrelated bug fell out of writing those tests, and it was LIRA-177's fault, not this
ticket's.** `PUT /:key` discarded `updateSetting`'s return value and hardcoded
`res.json({ success: true })`. LIRA-177 had added the `SENSITIVE_SETTING_KEYS` write guard, which
returns `{ success: false, error }` — so REST reported SUCCESS for a write it had rejected, and
audited a row for a write that never happened, while the IPC twins (`return result`) reported it
correctly. A rule-19c parity break: same input, two different answers by transport. Now the route
propagates the real result and returns BEFORE `auditRest`, so a rejected write is never audited.
Impact was limited today (only one key is sensitive and the UI never writes it through this
route), but the moment another key joins that set, REST would silently pretend to write it.

`backend/src/api/settings.ts` mounts `router.use(authenticateJWT)` and then defines
`PUT /:key` with **no role check**. Every other admin-ish write path in that layer pairs
`authenticateJWT` with `requireRole(["admin"])`; this one does not. So any authenticated
user — `staff` included — can write **any** row in `system_settings` over REST.

**Verified against source, not inferred:** the IPC twins are gated and the REST route is not,
which is also a rule-19c role-parity break, not only a hole:

| Surface                       | Guard                                         |
| ----------------------------- | --------------------------------------------- |
| IPC `db:update-setting`       | `requireRole(e.sender.id, ["admin"])`         |
| IPC `settings:update`         | `requireRole(e.sender.id, ["admin"])`         |
| REST `PUT /api/settings/:key` | `authenticateJWT` only — **no `requireRole`** |

**Why it is not already exploitable for the profits password.** LIRA-177 needed to store a secret
in `system_settings`, so `SettingsService.updateSetting` now _rejects_ writes to
`SENSITIVE_SETTING_KEYS` outright — that write guard exists precisely because this route could not
be trusted. That closes the one key that matters most and closes nothing else: `shop_base_system`,
`setup_complete`, every feature flag, and the shop identity remain writable by any staff account
over REST. A staff user flipping `setup_complete` to `0`, for instance, sends the app back into the
setup wizard.

**Fix.** Add `requireRole(["admin"])` to `PUT /:key` (after the existing `authenticateJWT`), matching
the IPC twins. Then decide the same question for `GET /:key`, which is authenticated but ungated —
reads are far less dangerous now that sensitive keys are redacted service-side, so leaving it open
may be deliberate; make it an explicit decision with a comment either way rather than an accident.

**Do NOT remove the `SENSITIVE_SETTING_KEYS` write guard once this lands.** It is defence in depth
for a table reachable from three separate ungated surfaces (`GET /api/settings` is deliberately
unauthenticated, and the `settings:get-all` / `db:get-setting` IPC channels have no role check).

**Acceptance.** A failing-first test per rule 17: a staff-role JWT gets 403 from
`PUT /api/settings/:key` and the row is unchanged, and that test must be shown to FAIL on today's
code before the guard is added. Follow the harness in
`backend/src/api/__tests__/profitsGate.api.test.ts`, which already forges per-role requests against
a real router.

---

## EPIC LIRA-187 → LIRA-192: OMT open-credit account — iPick + OMT App roll up under the OMT supplier — **BUILT, UNCOMMITTED** — **HIGHEST PRIORITY**

| Field        | Value                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| **Epic**     | Suppliers / OMT                                                                                           |
| **Type**     | Money model change (rules 16, 17, 18, 20)                                                                 |
| **Priority** | **HIGHEST** (owner, 2026-09-11)                                                                           |
| **Status**   | **BUILT 2026-09-15, NOT COMMITTED** — awaiting the owner's diff review. 77 paths (+4,967/-135). Gates run by the orchestrator: build / typecheck / lint exit 0; full suite **639 suites, 5,941 tests, 0 failures**. **Desktop + web e2e specs written but NEVER RUN** (needs the owner's `yarn dev` → stop → e2e cycle). LIRA-191 deliberately NOT built (deferred, D9). |
| **Plan**     | `docs/plans/ongoing_plans/OMT_OPEN_CREDIT_ACCOUNT_PLAN.md` — decisions D1–D16, code facts, full ticket bodies |

OMT is ONE open-credit account: the counter (OMT SEND/RECEIVE), the OMT App wallet, and iPick credit
all draw on it and are settled with one payment from the OMT Cash Drawer. Loading the wallet or iPick
moves no cash — the drawer goes up, the debt goes up. Design: read-time grouping via a nullable
`suppliers.account_supplier_id`; ledger rows never move.

| Ticket   | Title                                                                            | Priority     | Depends on |
| -------- | -------------------------------------------------------------------------------- | ------------ | ---------- |
| LIRA-187 | `suppliers.account_supplier_id` — the account link (schema only) — **BUILT** (v176)  | Medium       | —          |
| LIRA-188 | OMT account rollup on the Suppliers page — sub-rows + Type column — **BUILT**    | High         | 187        |
| LIRA-189 | Account settlement — per-child allocation, PAY+COLLECT, reversible — **BUILT**   | High (money) | 187, 188   |
| LIRA-190 | OMT App wallet loads on OMT credit by default — **BUILT**                        | High (money) | 187        |
| LIRA-192 | OMT App **cashout** — account credited + 0.1% commission — **BUILT**            | High (money) | 187        |
| LIRA-191 | Grouping configurable in Service Providers settings; Whish-base shops (deferred) | Low          | 187–192    |

Built in that order. **Settlement (LIRA-189) was attacked four times and six real defects were found
and fixed** — see plan §11 for the table and the durable lesson. The same bug class is LIVE in
shipped code: see **LIRA-193** below.

**Owner review 2026-09-15 — two questions CLOSED, no code change needed** (plan §10.4):
the round-trip commission is **accepted** (D17 — OMT caps cashout volume on their side, so the
exposure is bounded; do NOT add wash detection), and whole-row settlement is **confirmed as wanted**
(D18 — tick rows, payment must equal them exactly, pay less by unticking; do NOT build partial
coverage). **Still open:** a mistaken OMT App credit top-up cannot be voided, only corrected by an
opposite manual entry; and **e2e has never run** — the owner deferred it, and it is the last real gap
before this ships.

---

## LIRA-193: a supplier settlement can mark a debt paid while ZERO money moves — **FIXED 2026-09-15, uncommitted** — HIGH (money)

| Field        | Value                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| **Epic**     | Suppliers                                                                                              |
| **Type**     | Money bug, pre-existing                                                                                |
| **Priority** | **High** — silent, and it surfaces as an unexplained drawer shortfall at closing, not as an error       |
| **Status**   | **FIXED 2026-09-15** (uncommitted, with the OMT epic). Found while hardening LIRA-189, then fixed on the owner's go. Gates: build/typecheck/lint exit 0, full suite **5,963 tests, 0 failures**. **Three defects closed, not one** — see the fix note below. |
| **Found by** | Three independent adversarial agents, each reproducing it with an executed test against `settleAccount`'s identical pre-fix shape |

### What is wrong

Two shipped methods accept payment legs and move drawers **without ever comparing those legs to the
amount they record as settled**, and both silently skip legs whose method moves no drawer.

**`SupplierRepository.settleTransactions`** — the single-supplier settlement in the app today. On the
normal cash-owed path it never reconciles `data.payments` against `amount_usd`/`amount_lbp`; it only
checks that *at least one leg exists*. Its posting loop then does
`if (!isDrawerAffectingMethod(p.method)) continue;`.

Two consequences, both silent:

1. **Overpay / underpay leaks.** Settle a $100 debt with a $150 leg: the ledger nets to 0 and the
   drawer drops $150. $50 leaves with no ledger row, no profit stamp, no kept-change record.
2. **A settlement can move no money at all.** A `payments` array made entirely of `CUSTOMER_ACCOUNT`
   or `GIFT_CARD` legs passes the "at least one leg" check, every leg is skipped at posting, and the
   batch is stamped **fully settled with zero dollars moving**.

**`SupplierRepository.recordSupplierCashflow`** has the same silent skip with **no reconciliation
guard at all**.

**The single-supplier settle UI** (`Suppliers/index.tsx`, `settleHasActiveLegs` /
`settleConfirmDisabled`) enforces only a lower bound — it checks that *some* leg amount is > 0, never
that the entered amount matches the net owed, and never wires return/change legs. So consequence 1 is
reachable by an ordinary typo, not only by a crafted payload.

### Why it has never been noticed

None of this throws. There is no error, no log line and no failing test. It surfaces weeks later as a
drawer that will not reconcile at closing — by which time the settlement that caused it is buried.

### The fix

This is the bug class documented in plan §11 of `OMT_OPEN_CREDIT_ACCOUNT_PLAN.md` and now guarded in
`settleAccount`. **Port the same three fixes**, and take the shape of the fix, not just the patch:

1. Reconcile legs against the settled amount, **per currency**, before any write, and reject a
   mismatch. A supplier settlement has no customer to give change to.
2. Make the guard and the posting loop derive "does this leg move a drawer" from **ONE** predicate
   (`settleAccount` uses a local `assertLegMovesADrawer`) so they can never drift apart again — the
   drift is the actual defect; the symptoms are downstream.
3. Give the single-supplier settle UI the same two-sided bound the account sheet now has.

Consider whether `settleTransactions` should reject OUT legs outright the way `settleAccount` now
does. It has no `direction` field on its leg type today, so it cannot carry one — confirm that before
assuming it is safe.

### Acceptance

Failing-first per rule 17 for each part: write the test first, see it fail on the unfixed code, then fix. Never re-break finished code to prove it.
Prove, per currency, that the drawer delta equals the ledger movement for `settleTransactions` and
`recordSupplierCashflow`, and that a settlement paid entirely in non-drawer-affecting legs is
rejected rather than silently stamped settled. `settleAccount`'s own suite
(`SupplierRepository.accountSettlement.test.ts`, the "leg reconciliation" and "non-drawer-affecting
legs" describe blocks) is the template — copy its structure.

### Do NOT

Do not "fix" this by making the UI the only guard. The repository is this codebase's trust boundary,
and the leak is reachable over raw IPC and REST.

---

### What actually shipped (2026-09-15)

**Three defects, not the two originally filed.** Each was proved failing-first (rule 17) and each was
found by running code, never by reading it.

1. **The two filed above** — `settleTransactions` now reconciles legs against the settled amount per
   currency and hard-rejects a mismatch (D18: whole rows, exact match, pay less by unticking). The
   settle screen blocks it first with an inline message naming the exact difference, so the operator
   never reaches the thrown error. `recordSupplierCashflow` needed a DIFFERENT fix and got one: it has
   no separate target (its amount is derived FROM the legs), so a sum-vs-target check would check
   nothing — instead every leg is validated before it can enter the sum.
2. **A mutual-exclusion gap**, found while tracing: `owesCash` and `isOtherPaymentCommission` are
   meant to be exclusive but were taken on trust from the caller. Claiming both skipped BOTH the
   payment loop and the new guard. Now rejected.
3. **A currency-bucketing leak**, found by the adversarial review AFTER the first fix landed — in the
   one branch the fix had not reached. The Other-payment commission sum bucketed "is it LBP? else
   USD", so a leg tagged `"usd"` (lowercase) or `"EUR"` was counted as USD and posted into a
   `drawer_balances` row **no closing screen or report ever queries**, while `supplier_settlements`
   and `profit_usd` recorded a real USD collection. Money and record permanently disagree, silently.
   Closed by ONE shared currency helper now used by all five bucketing sites in the file (the
   existing inline copies were replaced by it too — duplicated decisions are the root cause of this
   whole class).

**Over-tightening was checked, not assumed.** `settleTransactions` is the daily-use path, so refusing
something legitimate would be worse than the leak. An adversarial reviewer ran 17 real scenarios plus
a 211-test baseline — split payments, USD+LBP, bills-only with zero owed, commission-only, iPick,
Katsh, a batch carrying both cash and an entered commission, and a deliberate `recordSupplierCashflow`
overpayment pushing a supplier into credit (D18's stated purpose). All still work. No existing test
was relying on the removed leniency.

---

## LIRA-216: a shipped code comment says a guard test is stale; the test was fixed in the same commit — LOW

| Field                | Value                                                   |
| -------------------- | ------------------------------------------------------- |
| **Epic**             | Commission / Suppliers                                  |
| **Type**             | Doc defect in source + an unexecuted re-derivation      |
| **Priority**         | Low (no money at risk; costs an agent a wrong hunt)     |
| **Affected Modules** | omt_whish                                               |
| **Source Plan**      | COMMISSION_AT_SETTLEMENT_PLAN.md Phase 2; OWNER_NOTES_2026-09-21.md §0.3 |

### Summary

`FinancialServiceRepository.ts:1541-1544` still tells the reader:

> *"see `FinancialServiceRepository.omtCommissionModelGate.test.ts` for the guard (that file's
> expectations describe the PRE-Phase-2 shape and are stale after this change — a Phase 2
> follow-up must re-derive them to the new invariant, rule 17)."*

**That follow-up already happened, in the same commit (`43948a35`).** The test's own header
(`…omtCommissionModelGate.test.ts:19-43`) reads *"UPDATED 2026-08-29 … re-derived to the
POST-Phase-2 invariant"*, and its assertions are the new shape: `commission_model` → 1
(`:395`), `supplier_owed` → 110 gross (`:405`), ledger nets to 0 after settlement (`:440`).
The comment is the only thing that is stale.

### Two things to do

1. **Delete or correct the comment** at `FinancialServiceRepository.ts:1541-1544`. A comment that
   points at a guard and calls it untrustworthy is worse than none: it invites the next agent to
   "fix" a test that is already correct — which is rule 24 running in reverse.
2. **Confirm the re-derivation actually executes.** The test header admits it is *"a STATIC
   re-derivation from the shipped production code (read, not executed)"*. Run
   `yarn test` and confirm this suite's assertions run and pass — rule 28(a): a green that was
   never observed is not a green. If any number is off, the arithmetic to re-derive is in the
   header (TOP_UP 110 + SETTLEMENT −109 + SUPPLIER_PAYS_US −1 = 0).

**Not a rule-17 case.** Nothing here needs a failing-first test; the guard exists and the
invariant it pins is the correct one.

---

# 2026-09-23 batch — LIRA-198 / LIRA-205 / LIRA-208 shipped, LIRA-220 … LIRA-228 opened

> These tickets were filed from `docs/plans/done_plans/OWNER_NOTES_2026-09-21.md` (the customer's
> 29 notes). Three are DONE in this batch; the nine below them were **discovered while building
> those three** and are new. Next free ID after this block: **LIRA-229** (now taken, with LIRA-230, by the
> 2026-09-24 Profits-audit findings at the end of this file; LIRA-231 filed 2026-09-26; LIRA-232..235 filed 2026-09-26; next free: **LIRA-285** (LIRA-257 … LIRA-266, LIRA-268 … LIRA-274 and LIRA-282 filed 2026-10-06/07; LIRA-267 and LIRA-275 … LIRA-281 taken by the email/sign-up work), LIRA-236 filed 2026-09-27, LIRA-237..251 filed 2026-09-28).
>
> **Two owner decisions taken 2026-09-23, settled — do not relitigate:**
>
> 1. **Audit scope = BROAD, as built.** Staff keep BOTH tabs — the Transactions tab and the Audit
>    Log tab. Do **not** revert `audit:search` / `POST /api/audit/search` to admin-only.
> 2. **Row actions = leave visible.** Staff continue to see Void / Refund / Void-entire-checkout on
>    the transactions table. Do **not** hide them behind a role check; they stay
>    `requireRole(["admin"])` server-side and the FAILURE MESSAGE is identical and explanatory on
>    both transports instead.

---

## LIRA-198: the audit page is invisible to staff, and the nav flag is a curtain not a gate — MEDIUM — DONE

| Field                | Value                                                             |
| -------------------- | ----------------------------------------------------------------- |
| **Epic**             | Audit / Permissions                                               |
| **Type**             | Feature (owner note #2)                                           |
| **Priority**         | Medium                                                            |
| **Status**           | **DONE** 2026-09-23                                               |
| **Affected Modules** | audit, (all — `modules` table)                                    |
| **Source Plan**      | `docs/plans/done_plans/OWNER_NOTES_2026-09-21.md` §0.5, note #2    |

### What shipped

Three pieces, because the nav flag alone would have produced a menu item leading to a 403.

1. **Migration v178** `audit_module_visible_to_all_roles` — `UPDATE modules SET admin_only = 0
   WHERE key = 'audit'`, mirroring v163's `profits` shape exactly. Rule 10 satisfied:
   `electron-app/create_db.sql`'s tenant-1 seed carries the post-migration value directly
   (`:1584`) and a `(178, 'audit_module_visible_to_all_roles')` `schema_migrations` seed row
   (`:2253`).
2. **The role sweep.** `audit:get-recent` and `audit:search` were `requireRole(["admin"])` on BOTH
   transports and are now `["admin", "staff"]` — `electron-app/handlers/auditHandlers.ts` and
   `backend/src/api/audit.ts`. (`audit:get-by-entity` / `GET /by-entity` already allowed staff.)
   The Transactions tab was never role-gated at all: `transactions:get-recent` carries no
   `requireRole`, and `GET /api/transactions/recent` is `requireAuth` only — so that tab worked for
   staff before this ticket and is not what v178 fixed.
3. **The per-tenant seed**, which the triage had missed. `TenantRepository.seedModules` provisions a
   NEW web tenant's `modules` rows independently of both files above, and it still seeded `audit`
   with `admin_only = 1` — and `profits` with `1`, wrong since v163, so every web tenant
   provisioned since then got an admin-only Profits page with no way for its own admin to fix it
   (`admin_only` is not writable on either transport for an `is_system = 1` row). The row list is
   now the exported `MODULE_SEED_ROWS` constant with both at `adminOnly: 0`.

### Why staff reading the audit log is safe

Every operation staff can now reach on this surface is a **read**, by enumeration:
`auditHandlers.ts` registers exactly three `ipcMain.handle` channels and `backend/src/api/audit.ts`
exposes exactly three routes, all landing on `AuditService.getRecent` / `search` / `getByEntity`.
There is no write channel on either file. `AuditRepository`'s three queries all carry
`tenant_id = ?` and are fully parameterised, so the widening cannot cross a tenant boundary. The
transaction write gates (`transactions:void` / `refund` / `void-checkout-group`, and their REST
twins) all remain `requireRole(["admin"])` and were not touched.

### Guards added

- `backend/src/api/__tests__/auditRoleGate.api.test.ts` — staff accepted on the two widened routes;
  staff still refused on every transaction write route.
- `electron-app/handlers/__tests__/auditHandlers.roleGate.test.ts` — the desktop half. Asserts
  `requireRole(1, ["admin", "staff"])` on both widened channels, so reverting either to `["admin"]`
  fails the test.
- `backend/src/__tests__/wp5_wp6_admin_tenant.api.test.ts` — a value-level parity test: every module
  row a new tenant is seeded with must match tenant 1's `admin_only` / `is_enabled` / `is_system`,
  key for key, with **both sides read from the database** rather than hand-typed (rule 24). The
  pre-existing check compared only row COUNTS, which is why this drift shipped unnoticed.

⚠ **Rule 17 is not discharged.** None of those three guards has been shown to fail against the
pre-fix code — see **LIRA-223**.

### Follow-up this opened

**LIRA-220** — widening audit reads to staff made `dbHandlers.ts`'s unredacted settings audit rows
staff-readable.

---

## LIRA-205: show the returned credits on an MTC/Alfa card sale in the transactions table — MEDIUM — DONE

| Field                | Value                                                             |
| -------------------- | ----------------------------------------------------------------- |
| **Epic**             | Audit / Recharge                                                  |
| **Type**             | Feature (owner note #9)                                           |
| **Priority**         | Medium                                                            |
| **Status**           | **DONE** 2026-09-23                                               |
| **Affected Modules** | audit, recharge, omt_whish                                        |
| **Source Plan**      | `docs/plans/done_plans/OWNER_NOTES_2026-09-21.md` note #9          |
| **Depends On**       | LIRA-180 (the number itself — already shipped)                    |

### What shipped

- `TransactionWithUser.returned_credits_usd` (`packages/core/src/repositories/TransactionRepository.ts:475`),
  accumulated in `_attachPaymentLegs` (`:1037`) from the transaction's `CREDIT_RETURN` payment legs.
- An 11th column, **Ret. Credits**, rendered by `ReturnedCreditsCell` in
  `frontend/src/features/audit/components/TransactionCells.tsx`.
- `returned_credits_usd?: number` declared directly on `TransactionRow`
  (`frontend/src/features/audit/hooks/useTransactionRows.ts:82`) — the first pass read it through a
  hand-written intersection cast, which meant a repository-side rename would have rendered "—"
  everywhere with typecheck, lint and e2e all still green. The cast is gone.
- The field reaches both transports unmapped: the IPC handler returns `getRecent(...)` raw, and
  `GET /api/transactions/recent` does `res.json({ success: true, transactions })` raw.

### One decision worth recording

The accumulator sums **USD legs only** (`p.method === CREDIT_RETURN_LEG_METHOD && p.currency_code
=== "USD"`). The field's name and the cell's hard `$` prefix are both already committed to USD, and
the sole real writer (`FinancialServiceRepository.processTelecomCreditReturn`) hardcodes `"USD"`, so
an LBP leg would have rendered as dollars. Restricting the accumulator is the minimal correct fix;
building per-currency rendering for a leg type that never varies would be speculative. A future
non-USD CREDIT_RETURN leg is now a **documented** gap, not a silent one.

### Owner decision 2, implemented here

Staff keep the Void / Refund / Void-entire-checkout buttons. What changed is the message: a new
`describeActionFailure(raw, verb)` in `TransactionsViewer.tsx` turns a `Forbidden` rejection into
*"Failed: &lt;verb&gt; is restricted to admins — ask an admin to do this."* — identically on both
transports. It needed doing on both because the shapes differ: desktop returns
`{ success: false, error: "Forbidden" }`, while web **throws a plain object**
`{ status, message, details }` that is not an `Error` (so `instanceof Error` swallows it). The
existing `messageFrom` helper in `frontend/src/api/apiError.ts` handles both; non-`Forbidden`
errors now surface their real reason, which the old `catch` branch did not do at all.

⚠ **Rule 17 is not discharged** for the new core/frontend tests — see **LIRA-223**.

---

## LIRA-208: "Adjust stock" is undiscoverable from the product edit form — LOW (UX) — DONE

| Field                | Value                                                             |
| -------------------- | ----------------------------------------------------------------- |
| **Epic**             | Inventory                                                         |
| **Type**             | UX (owner note #18) — and one real silent no-op found while doing it |
| **Priority**         | Low → the second half is Medium (a control that did nothing)       |
| **Status**           | **DONE** 2026-09-23                                               |
| **Affected Modules** | inventory                                                         |
| **Source Plan**      | `docs/plans/done_plans/OWNER_NOTES_2026-09-21.md` §0.7, note #18   |

### What shipped

- An **Adjust Stock** button on the edit form itself (`ProductForm.tsx`, testid
  `product-form-adjust-stock`), rendered only when `product && onAdjustStock`. With unsaved edits it
  shows a confirm strip: *Discard & adjust* / *Keep editing*.
- The hand-off resolves the row **fresh** from `ProductList`'s own `products` state at click time
  (`handleAdjustFromForm(productId)`, `ProductList.tsx:738-779`) instead of from the `editingProduct`
  snapshot captured when the form opened. That snapshot was stale-prone **and it moves money**:
  `AdjustStockModal` computes `parsedQuantity - currentStock` and routes an increase through
  `receiveStock`, which books a FIFO batch and a supplier debit — a stale baseline books the wrong
  supplier debt.
- `initialFormData` is now cleared on all four paths that close the form, not one.

### The second D13 instance — the part that was a real defect

The **"Old stock"** checkbox rendered editable on an existing product, but
`InventoryService.updateProduct`'s type has no `is_old_stock` field at all and `ProductForm`'s
`handleSubmit` only sends it on CREATE. Ticking it on an edit was a pure silent no-op — precisely
the shape decision D13 exists to prevent, and the same class D13 already fixed for Quantity. It is
now `disabled={!!product}` with an explanatory title.

A sweep of every other control on the edit form found no third instance: barcode, name, category,
cost price, retail price, min stock level, supplier and warranty months are all forwarded through
`updateProductFull`. `stock_quantity` and `is_old_stock` were the only two the service drops, and
both are now disabled on edit.

### Follow-ups this opened

**LIRA-224** (a *Save & adjust* option — owner answer needed), **LIRA-225** (the hand-off searches a
*filtered* client-side list, so a filtered-out product dead-ends), **LIRA-228** (`warrantyMonths` is
lost on minimize/restore) and **LIRA-222** (`updateProductFull` NULLs `image_url` on every edit —
found while tracing D13, not caused by this ticket).

---

## LIRA-220: settings audit rows leak sensitive values to staff, and are written for writes that never happened — HIGH

| Field                | Value                                                             |
| -------------------- | ----------------------------------------------------------------- |
| **Epic**             | Audit / Settings / Security                                       |
| **Type**             | Bug (security + rule-19c transport divergence)                    |
| **Priority**         | **High** — a live data exposure created by LIRA-198               |
| **Status** | DONE 2026-09-28 — committed `8cf9361d` — the Profits password is redacted in settings audit rows on write AND on read (`constants/sensitiveSettings.ts`); a settings audit row is written only when the write succeeded |
| **Affected Modules** | settings, audit                                                   |
| **Source Plan**      | Found while building LIRA-198 (`OWNER_NOTES_2026-09-21.md` §0.5)  |
| **Depends On**       | LIRA-198 (DONE) — which is what made this reachable               |

### Summary

`electron-app/handlers/dbHandlers.ts`'s `db:update-setting` and `settings:update` call `audit(...)`
with `new_values: { value }` **unconditionally**, with two consequences:

1. **No redaction.** A `SENSITIVE_SETTING_KEYS` value is written to `audit_log` in plaintext. Before
   LIRA-198 that row was admin-only; `audit:search` / `POST /api/audit/search` are now staff-readable
   and `AuditRepository.search` is `SELECT *`, so those values are staff-visible through the Audit
   Log tab.
2. **An audit row for a write that was rejected.** `SettingsService.updateSetting`
   (`packages/core/src/services/SettingsService.ts:152-162`) refuses a `SENSITIVE_SETTING_KEYS`
   write by **returning `{ success: false }`** rather than throwing — so the handler carries on and
   audits it anyway. Desktop therefore persists a plaintext value for a change that never happened.

**The REST twin already gets this right**: `backend/src/api/settings.ts:99-104` returns early on
`!result.success`, before `auditRest`, with a comment saying *"no audit row for a write that was
rejected, not performed"*. So this is a **desktop-only leak AND a rule-19c divergence**.

### Fix

1. Move the `audit(...)` call inside an `if (result.success)` guard in **both** `dbHandlers.ts`
   channels, matching `settings.ts`'s early return.
2. Redact `new_values` for `SENSITIVE_SETTING_KEYS` on both transports — store the key and the fact
   of the change, never the value.
3. Correct `profitHandlers.ts:96`'s comment, which currently points at `dbHandlers` as the
   *good* example of a secret-omitting audit shape. It is not.

### Acceptance Criteria

- [ ] A rejected sensitive-setting write produces **no** `audit_log` row on either transport.
- [ ] An accepted sensitive-setting write produces a row whose `new_values` contains no value.
- [ ] Rule 17: write the test first and watch it fail against the current unconditional `audit(...)`, then fix.
- [ ] A staff-role search of the audit log returns no plaintext sensitive value.

---

## LIRA-221: `MODULE_SEED_ROWS` is not yet the single source of the module seed — MEDIUM

| Field                | Value                                                             |
| -------------------- | ----------------------------------------------------------------- |
| **Epic**             | Multi-tenant / Schema                                             |
| **Type**             | Tech debt (rule 14) — the drift that caused LIRA-198's third piece |
| **Priority**         | Medium                                                            |
| **Status** | DONE 2026-09-28 — committed `8cf9361d` — `MODULE_SEED_ROWS` exported; drift guard `db/__tests__/moduleSeedRows.driftGuard.test.ts` |
| **Affected Modules** | all (`modules` table)                                             |
| **Source Plan**      | Found while building LIRA-198                                     |

### Summary

The module seed list has **three** independent definitions that nothing forces to agree:
`electron-app/create_db.sql`'s tenant-1 `INSERT`s, `TenantRepository.MODULE_SEED_ROWS`, and ~10
historical `INSERT OR IGNORE INTO modules` sites in `migrations/index.ts`. That is exactly how
`audit` and `profits` ended up with `admin_only = 1` for every web tenant provisioned after v163 /
v178 while tenant 1 had `0`.

LIRA-198 extracted `MODULE_SEED_ROWS` as a single source **within** `TenantRepository.ts`, which is
as far as one file's ownership reaches. Two things remain:

1. **Export it.** `MODULE_SEED_ROWS` / `ModuleSeedRow` are not in
   `packages/core/src/repositories/index.ts`'s `TenantRepository` export block, so nothing outside
   that one file can import them. Also declare it `readonly` — as a seed catalogue it should not be
   mutable by an importer.
2. **Guard it.** Add a jest test that parses `create_db.sql`'s two `INSERT OR IGNORE INTO modules`
   blocks (`tenant_id = 1`) and asserts they produce the exact same
   `{key, label, icon, route, sort_order, is_enabled, admin_only, is_system}` rows as
   `MODULE_SEED_ROWS`. As of 2026-09-23 all 22 rows agree on all 7 columns, so it passes today.

**Do NOT pull the ~10 historical migration `INSERT` sites into that guard.** Each is a frozen
point-in-time snapshot of what that migration version shipped (some predate columns the current
schema has); re-deriving them from "current" would itself be a bug.

**Open question for the owner:** where should that guard live — `packages/core/src/__tests__/`, or a
backend-side test (which is where `wp5_wp6_admin_tenant.api.test.ts` already reads `create_db.sql`
off disk)?

### Acceptance Criteria

- [ ] `MODULE_SEED_ROWS` is exported from `packages/core/src/repositories/index.ts` and typed
      `readonly`.
- [ ] A drift guard fails when `create_db.sql`'s tenant-1 module rows and `MODULE_SEED_ROWS`
      disagree on any of the 7 columns, in either direction.
- [ ] Rule 17: prove it by flipping one column in one of the two sources.

---

## LIRA-222: every product edit silently NULLs the product's image — MEDIUM

| Field                | Value                                                             |
| -------------------- | ----------------------------------------------------------------- |
| **Epic**             | Inventory                                                         |
| **Type**             | Bug — silent data loss                                            |
| **Priority**         | Medium                                                            |
| **Status** | DONE 2026-09-28 — committed `8cf9361d` — reproduced; `updateProductFull` keeps `image_url` when none is sent. Pictures already lost stay lost |
| **Affected Modules** | inventory                                                         |
| **Source Plan**      | Found while tracing D13 for LIRA-208; pre-existing, not caused by it |

### Summary

`ProductRepository.updateProductFull` (`packages/core/src/repositories/ProductRepository.ts:1036`)
writes `image_url = ?` **unconditionally** with `data.image_url ?? null`, while
`InventoryService.updateProduct` only forwards `image_url` when it is non-null. The edit form never
sends one. So every product edit appears to NULL an existing `image_url`.

It is the mirror image of the D13 class LIRA-208 closed: not a control that does nothing, but a
stored value destroyed by an unrelated save.

**Assumption (unverified):** this was found by reading the two functions, not by executing the
path — per rule 28, reproduce it before fixing it. It is cheap to check: set an `image_url`, edit
any other field, re-read the row.

### Fix

Make the write conditional the way `category` / `category_id` already are —
`COALESCE(?, image_url)`, or omit the column from the `SET` list when the key is absent.

### Acceptance Criteria

- [ ] Reproduce first (rule 17): a test that sets `image_url`, calls the ordinary edit path, and
      asserts the value survives — failing against today's code.
- [ ] Sweep `updateProductFull`'s other columns for the same unconditional-write shape.

---

## LIRA-223: the guards this batch added have never been shown to fail — MEDIUM

| Field                | Value                                                             |
| -------------------- | ----------------------------------------------------------------- |
| **Epic**             | Testing / process                                                 |
| **Type**             | Rule-17 debt                                                      |
| **Priority**         | Medium — a guard that has never failed proves nothing             |
| **Status** | DONE 2026-09-28 — committed `8cf9361d` — every guard from the 2026-09-23 batch and this batch is either recorded as proven failing-first or labelled "NOT proven failing-first"; no finished code was re-broken |
| **Affected Modules** | audit, inventory, recharge, multi-tenant                          |
| **Source Plan**      | Batch process note, 2026-09-23                                    |

### Summary

Every test added in the 2026-09-23 batch was written **and never run against the pre-fix code**,
because this batch's process forbade running tests mid-batch. Each file says so honestly in its own
docblock rather than claiming a proof it did not have — which is the correct state to leave it in,
but it means none of these has earned trust yet. **A passing run at the gate does not discharge
rule 17**; only watching them go red does.

### The revert/run/revert cycle, per file

| File | Revert this | Expect |
| --- | --- | --- |
| `backend/src/api/__tests__/auditRoleGate.api.test.ts` | `audit.ts`'s two role arrays → `["admin"]` | cases 1-2 return 403, service spy at 0 calls |
| `electron-app/handlers/__tests__/auditHandlers.roleGate.test.ts` | same, in `auditHandlers.ts` | the `toHaveBeenCalledWith(1, ["admin","staff"])` assertions fail |
| `backend/src/__tests__/wp5_wp6_admin_tenant.api.test.ts` (module parity) | `MODULE_SEED_ROWS`' `audit` + `profits` → `adminOnly: 1` | fails on BOTH keys |
| `TransactionRepository.paymentLegs.test.ts` (non-USD exclusion) | drop `&& p.currency_code === "USD"` | the non-USD exclusion case fails |
| `TransactionsViewer.extraCurrencyDrawerMove.test.tsx` | `METHOD_COL_INDEX` → 5 | the four `"Cash"` assertions fail |
| `ProductForm.adjustStock.test.tsx` | remove the form's Adjust Stock button | the 3 presence/click cases fail |

Then restore, confirm green, and **replace each docblock's TODO paragraph with what was actually
observed** — not with a prediction.

### Three comment corrections to make in the same pass

1. `TransactionsViewer.extraCurrencyDrawerMove.test.tsx` — the docblock predicts that removing the
   column makes the two new assertions read `"Cash"` / `undefined`. Wrong in both halves: the `$3`
   case would read `"—"`, and the `"—"` case would still **pass**, because index 5 would then be
   Method, which also renders `"—"` on a legless row.
2. Same file — the `"—"` test cannot distinguish "column present and empty" from "column deleted".
   Anchor it: also assert `screen.getByText("Ret. Credits")`, or that the row has 11 `<td>`s.
3. `auditHandlers.roleGate.test.ts` — the docblock says a cashier-only session "is refused on every
   read channel". `requireRole` is **mocked** in that file, so what it actually proves is that the
   handler honours `requireRole`'s verdict and never reaches the service. Lead with that.

### Two small guards worth adding while here

- A unit test for `describeActionFailure` covering both real shapes (desktop `"Forbidden"` string,
  web `{status: 403, message: "Forbidden"}`) and asserting they produce the **identical** sentence —
  that cross-transport identity is owner decision 2 and nothing currently pins it.
- The `"Forbidden"` literal is now spelled independently in three places (`electron-app/session.ts`,
  `backend/src/middleware/auth.ts` ×2, and `TransactionsViewer.tsx`) with nothing forcing agreement —
  rule 14. Export it once, or key the UI off HTTP 403 rather than off prose.

---

## LIRA-224: should the product form offer "Save & adjust"? — LOW — NEEDS INTERVIEW

| Field                | Value                                                             |
| -------------------- | ----------------------------------------------------------------- |
| **Epic**             | Inventory                                                         |
| **Type**             | Owner decision                                                    |
| **Priority**         | Low                                                               |
| **Status** | DONE 2026-09-28 — committed `8cf9361d` — owner said yes (2026-09-28); "Save & adjust" added to the unsaved-changes warning |
| **Affected Modules** | inventory                                                         |
| **Source Plan**      | Raised while building LIRA-208                                    |

### The question

LIRA-208's confirm strip offers only **Discard & adjust** / **Keep editing**. An operator who opened
Edit Product to change the price *and* wants to adjust quantity in the same visit must therefore lose
one of the two.

Do you want a **Save & adjust** option — save the form first, then hand off to `AdjustStockModal` on
success? It was not built with LIRA-208 because it does not fall out of that change (it touches
`handleSubmit`'s flow) and because the answer might reasonably be "no": adjusting stock is a
money-moving intake event, and forcing a clean save before it is arguably the safer shape.

---

## LIRA-225: the adjust-stock hand-off searches a filtered list, and has no regression test — MEDIUM

| Field                | Value                                                             |
| -------------------- | ----------------------------------------------------------------- |
| **Epic**             | Inventory                                                         |
| **Type**             | Bug (reachable dead-end) + missing coverage                       |
| **Priority**         | Medium                                                            |
| **Status** | DONE 2026-09-28 — committed `8cf9361d` — the hand-off fetches the product by id (`getProductById`, dual-mode), not from the filtered list; regression test added |
| **Affected Modules** | inventory                                                         |
| **Source Plan**      | Found reviewing LIRA-208                                          |

### Summary

`handleAdjustFromForm` resolves the row from `ProductList`'s `products` state, which is the
**filtered/searched** result set, not the whole catalogue. Sequence: open Edit on a product found via
search → minimize the form (the list stays interactive, and `minimizedProducts` is persisted to
`localStorage`, so this survives a restart) → change the search box or a filter so that product no
longer matches → restore the form → click Adjust Stock. `products.find()` returns `undefined`, the
operator is told *"This product is no longer in the list — refreshing."* — which is **false**, the
product exists — and the fallback `loadProducts()` re-runs the same filters, so it never appears.
Dead end, with a misleading message.

Not silent (it does show an error), which is why this is Medium and not High.

### Fix

The real fix is a **single-row read**: wire `getProductById` through `useApi()` /
`backendApi.ts` / `ElectronApiAdapter.ts` / `ApiAdapter` (`packages/ui/src/api/types.ts`) so the
hand-off fetches the row instead of searching a filtered client-side list. A raw IPC type exists in
`electron.d.ts` but nothing dual-mode does. Derive the payload type from the schema (rule 21).

Interim, if that is too wide: say "not visible under the current filters" and clear the
search/filters before reloading.

### Also in scope — the missing guard

The staleness fix LIRA-208 made has **no automated test**. Add a case to
`frontend/src/features/inventory/pages/Inventory/__tests__/ProductList.deleteConfirm.test.tsx` (which
already mounts `ProductList` with a stable `mockApi`), or a new `ProductList.adjustHandoff.test.tsx`:
render the list, open Edit, resolve `getProducts` a second time with a changed `stock_quantity`, click
the form's Adjust Stock button, and assert `AdjustStockModal` receives the **new** quantity. Prove it
fails against the pre-fix `setAdjustingProduct(target)` line first (rule 17).

---

## LIRA-226: `check-schema-equivalence`'s shape half is vacuous in CI, and duplicate versions go unreported — MEDIUM

| Field                | Value                                                             |
| -------------------- | ----------------------------------------------------------------- |
| **Epic**             | CI / Schema                                                       |
| **Type**             | Bug in a guard (a check that cannot fail)                         |
| **Priority**         | Medium                                                            |
| **Status** | DONE 2026-09-28 — committed `8cf9361d` — CI passes `SCHEMA_CHECK_BASE_REF`; duplicate migration versions are reported; `scripts/__tests__/checkSchemaEquivalence.test.mjs` |
| **Affected Modules** | — (tooling)                                                       |
| **Source Plan**      | Found while wiring the check up, 2026-09-23                       |

### Summary — two independent gaps

**(a) The A-vs-B *shape* comparison has no signal in CI.** DB (A) is built from
`git show HEAD:electron-app/create_db.sql`. On `push: [main]`, `HEAD` **is** the pushed commit; on
`pull_request`, `actions/checkout` uses the merge ref. Either way A's source file equals the working
tree's. Once every version is seeded — which the new contents check now enforces — `runMigrations`
applies nothing, so A and B are byte-identical **by construction**. Proven, not reasoned: adding a
column to a copy of `create_db.sql` is caught when old ≠ new, and **not** caught when old = new.

So the classic rule-10 miss of *"added the seed row, forgot the column"* escapes CI. The **new
seed-contents half is unaffected** and does have signal in CI (both the drifted-name and
missing-row cases still exit 1 with old = new), so the step is a real net gain — and the
missing-seed-row form of a rule-10 miss, by far the common one, IS caught.

Fix: either narrow the step's name and comment to say CI enforces the `schema_migrations` seed
contents, or make DB (A) load from the PR base
(`git show ${{ github.event.pull_request.base.sha }}:electron-app/create_db.sql`, falling back to
`HEAD~1` on push).

**(b) A duplicated `version:` in `MIGRATIONS` is silently swallowed.**
`diffMigrationSeedContents` builds `new Map(migrations.map(m => [m.version, m.name]))`, which keeps
only the last of a duplicate pair. That is the exact accident the LIRA-176 v167/v168 renumber note in
`create_db.sql` describes recovering from. The seed side cannot duplicate (`version` is the primary
key), so this is one-directional.

Fix: assert `migrations.length === new Set(migrations.map(m => m.version)).size` before building the
Map, and report any duplicated version as a diff.

### Acceptance Criteria

- [ ] A column added to `create_db.sql` without a matching migration fails CI — or the step no
      longer claims to check that.
- [ ] Two migrations sharing a `version:` fail the check, naming the version.
- [ ] Both proven by introducing the fault and watching the script exit 1 (it is cheap — the whole
      check runs locally in seconds).

---

## LIRA-227: an upgraded tenant 1 and a fresh install disagree on sidebar module order — LOW

| Field                | Value                                                             |
| -------------------- | ----------------------------------------------------------------- |
| **Epic**             | Schema                                                            |
| **Type**             | Bug — presentation only                                           |
| **Priority**         | Low                                                               |
| **Status** | DONE 2026-09-28 — committed `8cf9361d` — migration v188 re-asserts custom_services=12, profits=13, loto=16 |
| **Affected Modules** | all (`modules` table)                                             |
| **Source Plan**      | Surfaced while proving fresh-vs-upgraded equivalence for LIRA-198 |

### Summary

Migration **v49**'s `up()` sets `sort_order` to `loto = 13`, `custom_services = 14`,
`profits = 15` (`migrations/index.ts:2029-2035`). Both fresh-seed definitions — `create_db.sql` and
`MODULE_SEED_ROWS` — use `custom_services = 12`, `profits = 13`, `loto = 16`, and no later migration
re-sets them (`grep "UPDATE modules SET sort_order"` returns only v49's `up`/`down`).

So a genuinely **upgraded** production tenant 1 and a **freshly installed** one disagree on sidebar
order for three modules. It affects presentation only — no visibility, permission or money column —
and it means the module-parity test's tenant-1 baseline is the fresh seed, not a migration-replayed
one.

### Fix

A new migration re-asserting the three `sort_order` values to the `create_db.sql` numbers, with
`create_db.sql` updated in the same change (rule 10).

---

## LIRA-228: the product form loses a warranty edit on minimize/restore — LOW

| Field                | Value                                                             |
| -------------------- | ----------------------------------------------------------------- |
| **Epic**             | Inventory                                                         |
| **Type**             | Bug — silent data loss                                            |
| **Priority**         | Low                                                               |
| **Status** | DONE 2026-09-28 — committed `8cf9361d` — the warranty edit survives minimize/restore |
| **Affected Modules** | inventory                                                         |
| **Source Plan**      | Found reviewing LIRA-208; pre-existing                            |

### Summary

`ProductForm`'s minimize snapshot is `onMinimize({ formData, editingProduct })`, and
`ProductFormProps.onMinimize`'s `formData` shape has **no `warrantyMonths` field** — but
`warrantyMonths` is the 8th term in the `isDirty` comparison. A restored form therefore re-seeds it
from `product.warranty_months`.

Consequence: an operator who edits **only** the warranty, minimizes, and restores silently loses the
edit, and the form restores reading *clean* — so nothing warns them.

### Fix

Add `warrantyMonths` to the minimize snapshot type and to both the save and restore paths, or state
in the UI that warranty is not preserved across a minimize. Prove it with a failing test first
(rule 17).

---

## LIRA-229: a sale's draft autosave writes a fresh SALE transaction row every time — MEDIUM

| Field                | Value                                                                              |
| -------------------- | ---------------------------------------------------------------------------------- |
| **Epic**             | POS / Sales                                                                        |
| **Type**             | Bug — duplicate ledger rows (money path)                                           |
| **Priority**         | Medium                                                                             |
| **Status**           | DONE 2026-09-26 — committed `24651e83` — see "Resolution" below                   |
| **Affected Modules** | pos, profits                                                                       |
| **Source Plan**      | Profits audit run 2026-09-24, lane LCC (`OWNER_NOTES_2026-09-21.md` §6.9)          |

### Summary

Found by reading, not yet measured end to end: `SalesRepository.processSale` inserts a new
`type = 'SALE'` row in `transactions` on **every** call, including each draft autosave and that
same draft's completion. It has no status gate, and nothing voids the earlier row. The same run
also found a **cancelled** sale that still has an ACTIVE SALE row (LCC-R2).

The Profits reports now defend against this at the read side: `refundOriginalJoin` resolves an
item refund to `MIN(o.id)`, one SALE row per sale. The rows are still written, though, and any
reader that sums SALE rows without that defence over-counts. The run's parity probes measured it:
P1b, a draft saved on 06-29 and completed on 07-02, split the profit across two periods. P2, a
cancelled but paid sale, still showed profit on By Cashier.

### Fix

1. **Reproduce first (rule 28):** drive `processSale` as draft → re-save → complete and count the
   SALE rows.
2. Then either stop writing a SALE row for a draft, or void/replace the draft's row on completion
   and on cancel.
3. Rule 20: name the reversal owner for any row that stays.
4. Check that the change touches no drawer or payment posting.
5. Failing-first test (rule 17). Read `docs/FEATURE_GUIDE.md` §13 before touching it (rule 18).

### Resolution (2026-09-26)

**Reproduced first.** Draft → re-save ×2 → complete left **4 ACTIVE SALE rows**. Each draft re-save also
re-posted any typed payment to the drawer: $5 × 3 + $8 left General at +$23 instead of +$8, because old
payment rows were deleted without reversing their drawer deltas. A cancelled draft left an orphan ACTIVE
SALE row behind.

**Owner design:** a draft is a parked order, so a DRAFT writes nothing to the `transactions` money
ledger. `SalesRepository.processSale` now gates the whole posting block on `status === "completed"`:
the unified row, payment legs, drawer deltas, debt, partner ledger and gift card. The single SALE row
is written once, on completion. Cancelling a draft has nothing to reverse. A defensive double-completion
path updates the one row in place (`TransactionRepository.getActiveSaleTransactionId` /
`updateTransactionCore`), reversing its prior legs first. Old duplicate rows in existing DBs are left
as they are, and ProfitRepository's `MIN(o.id)` defence stays.

**Tests:** `SalesRepository.draftAutosaveDuplicateTxn.test.ts`, 5 cases, failing-first.
`SalesRepository.fifoProfitStamp.test.ts`'s draft case was updated to the new design.

**Also found and fixed in this batch:** web "cancel draft" was broken (no `DELETE /api/sales/drafts/:id`
route); it has been added (`salesDeleteDraft.api.test.ts`). Not fixed, reported: the desktop
`sales:delete-draft` handler has no role check, and it audits even when the delete fails.

---

## LIRA-230: a named walk-in's kept change lands in the unnamed "Walk-in" bucket — LOW

| Field                | Value                                                                              |
| -------------------- | ---------------------------------------------------------------------------------- |
| **Epic**             | Sessions / Profits                                                                 |
| **Type**             | Bug — wrong attribution (reporting)                                                |
| **Priority**         | Low                                                                                |
| **Status**           | DONE 2026-09-26 — committed `24651e83` — see "Resolution" below                   |
| **Affected Modules** | pos (session checkout), profits                                                    |
| **Source Plan**      | Profits audit run 2026-09-24, lane LCC (`OWNER_NOTES_2026-09-21.md` §6.9)          |

### Summary

Found by reading: `SessionCheckoutService`'s `KEPT_CHANGE` `createTransaction` call never stamps
`client_name`. When a walk-in customer gives a name but isn't a saved client (no `client_id`, no
phone match), Profits → By Client puts their kept-change profit in the unnamed **Walk-in** group
rather than under their name. No refund is involved. The report side needs no change: By Client
already groups walk-ins by the stamped name.

### Fix

1. Stamp the session's walk-in `client_name` on the KEPT_CHANGE row, the same way the session's
   other rows get it.
2. Failing-first test: a named walk-in session with kept change must show under that name on
   By Client.

### Resolution (2026-09-26)

**Reproduced first:**
- a named walk-in's KEPT_CHANGE row had `client_name` null (so it landed in "Walk-in");
- a saved client's KEPT_CHANGE row was also missing the name, though its `client_id` was already there.

**Fix:** `SessionCheckoutService.checkout()` now stamps `client_name: sessionCustomerName` on the
KEPT_CHANGE row, the same source every other basket item uses. Amounts are unchanged. It is the only
KEPT_CHANGE writer in core.

**Tests:** `SessionCheckoutService.keptChangeClientName.test.ts`, 3 cases: a named walk-in, a saved
client, and an anonymous walk-in, which still goes to Walk-in.

---

# 2026-09-25 — `OWNER_NOTES_2026-09-21.md` batch: implemented and unit-verified, uncommitted

**Source:** `docs/plans/done_plans/OWNER_NOTES_2026-09-21.md` §6.9 (dated status log) and §2b (owner
decisions). Everything below is in the working tree, not yet committed. Gates run: core/backend/
electron/frontend jest, `build:core`, `check:schema-equivalence`, tenant-scoping, bind-arity,
`yarn typecheck`, `yarn lint` — all green. Desktop e2e 310 passed / 3 failed; web e2e 118 passed /
3 failed / 1 skipped — all 6 failures were stale specs (lira-127, lira-custom-service-payout,
lira-web-016, lira-web-017 (d)/(e), and the pre-existing skip), now fixed but not yet re-run by the
owner. Rule-17 red-proofs for this batch's own new guards passed (undo → red → restore, ~35-38
checks across the two build runs).

**Closed by this batch:**
- The four money bugs: #4/#15 (D1, OMT/Whish RECEIVE fee model, migration v180), #6 (LIRA-202, OMT
  fee no longer forced for cash-to-business), #7 (LIRA-203, supplier overpayment books a credit),
  #8 (LIRA-204, debt-settlement cross-currency shortfall), #10 (LIRA-206, buy-back double-credit),
  #22/#21 (LIRA-088, shop-line signed decrement + buy-back/charge checkbox), #26 (LIRA-215, expenses
  now reach Profits), #27 (LIRA-217, debts no longer feed Profits revenue).
- The Profits-page audit, batches 0-4 (`OWNER_NOTES_2026-09-21.md` §6, PA-0..PA-4.23), including
  **LIRA-183** (see its own entry above) and **#29** and **#14 slices 1-2** (per-module detail,
  net-profit headline). **#3** was closed as "no change" by the owner (LIRA-199 will not be filed).
- The Dashboard Sales/Profit chart and Net Profit tile, DC-1..DC-12 (§7).
- The widened **LIRA-219** (see its own entry above): closing's profit now equals the Profits
  page's gross profit for the day, on both transports.
- The remaining owner notes, per `docs/plans/done_plans/OWNER_NOTES_REMAINING_BUILD.md`: #11
  (A netted checkout, B session-group display, C whole-basket reversal, migration v181), #13 (buy
  and resell phone lines), #16 (Syria payout, migration v185, "as built — no change" per the
  owner's 2026-09-25 answer), #19 (Tier A), #20 (Part A only — "Customer gets" typeable for every
  currency), #21 (shop-line checkbox, migration v182 — shares **LIRA-088** with #22), #24 (Hold
  Money payment form + partial pickup, migration v183), #28 (sold-ahead days + days-to-send list,
  migration v184 — owner confirmed 2026-09-25 the pre-existing arithmetic is correct, no change),
  and the `TopUpModal` scroll fix (lira-141).

**Still open — no ticket ID invented for any of these; do not file one without the owner:**
- **#1** (staff name in the txn user column) and **#25** (maintenance "Start" button) — both may
  already be fixed by earlier commits; **waiting on the customer to confirm**, per
  `OWNER_NOTES_2026-09-21.md` §0.8/§0.9.
- **#5** (cashout unicef) — blocked on the voice note.
- **#17** (+15% price-adjustment alert) — PARKED; the owner is unsure whether it means the payment
  form's rate band or a selling price.
- **#14 slice 3** — the remaining modules' transaction-level drill-down (slices 1-2 shipped in this
  batch).
- A single-item basket reversal (distinct from #11-C's whole-basket reversal, which shipped).
- **LIRA-229** (a sale's draft autosave writes a fresh SALE row every time) and **LIRA-230** (a
  named walk-in's kept change lands in the unnamed "Walk-in" bucket) — filed this batch, both still
  TODO, bodies above.

**OMT_APP RECEIVE D1 message — DONE 2026-09-25** (owner: "don't wait for my e2e run, implement
the change"). OMT_APP RECEIVE now refuses a customer fee (`commission`, `includingFees:true` or
`feePayments`) with the shared `OMT_RECEIVE_NO_FEE_MESSAGE`. It is enforced in the shared validator
refine, in the electron schema mirror and in the repository guard. The message wording was broadened
so it names no single fee field. Verified: core jest 3,940/3,940, backend 963/963.

---

## LIRA-231: POS refunds hand money back silently — use the payment form; block session-paid sales — HIGH

| Field                | Value                                                                              |
| -------------------- | ---------------------------------------------------------------------------------- |
| **Epic**             | POS / Refunds                                                                      |
| **Type**             | Bug + small feature (money path)                                                   |
| **Priority**         | High                                                                               |
| **Status**           | DONE 2026-09-26 — committed `24651e83` — incl. items 3–7 below                    |
| **Affected Modules** | pos, audit                                                                         |
| **Source**           | Owner test 2026-09-26: an item refund on session Sale #4                           |

### Summary

The POS Sale detail modal's **"Refund item"** (`SalesRepository.refundSaleItem`) and **"Refund
Sale"** give money back with no cashier input. They silently reverse the sale's OWN payment rows,
in proportion.

For a sale paid through a **customer session basket**, whose payment is pooled on the session, the
sale has no payment rows of its own. The item refund therefore wrote a REFUND row with **no payment
legs and no drawer movement**. The owner refunded a $1,500 iPhone from Sale #4 and the Transactions
page showed `ITEM REFUND … $-1,500` with no payment details: the handed-back cash was never recorded.

### Owner decisions (2026-09-26)

1. **Both POS buttons open the payment form.** This reuses the Transactions page's
   `RefundMethodModal` / `MultiPaymentInput`.
   - It opens pre-filled with how the sale was paid (for an item refund, that item's share).
   - The cashier can change the method, drawer and currency split.
   - What they confirm is posted as the REFUND row's legs.
   - One form, one refund path (rule 14).
2. **A sale paid through a customer session is BLOCKED** for both POS refunds, with the message:
   "This sale was paid through a customer session — refund it from the session basket." This is
   enforced server-side on both transports and matches the Transactions page's existing refusal.
   The proper single-item session refund is a later design (owner's answers so far: the row amount,
   the cashier picks the payback method, account debt is reduced first, sold items only).

### Acceptance

- An override posts exactly the confirmed legs and the drawer deltas; no override gives today's
  proportional behaviour.
- An over-refund is rejected.
- A session-paid sale is refused for both refunds, and nothing is written.
- Both transports, with schema-derived types (rules 19, 21–23).
- Failing-first tests (rule 17).

**Not repaired:** the owner's local test refund on Sale #4 (no drawer movement recorded). It is test
data.

### Added to this ticket (owner decisions 2026-09-26, from the owner's web test on tenant 5)

3. **Deferred Profit nets item refunds.** The Overview "Unpaid sales" card and the Pending tab showed an unpaid
   sale at its gross total ($1,635 / potential $225 for Sale #4, after a $1,500 item refund). They now show it
   net ($135 / $25), via the new `saleNetRevenueNotFullyPaid` fragment, which is registered in the profit guard.
4. **Web "Sale not found".** `GET /api/sales/:id` validated the URL id with `z.number()`, so every web sale
   detail failed. The id is now coerced, and the route returns the IPC envelope.
5. **POS IMEI list marks defective phones.** A unit refunded as Defective is listed as "IMEI — Defective", and
   picking it asks "This phone is marked defective — sell anyway?". This was verified on tenant 5: the unit
   saved `is_defective = 1` and a warranty until 2027-04-01, but the POS showed it as normal.
6. **The POS refund window gets "Returned phones"** (Defective + New warranty expiry), for both Refund Sale and
   Refund item. The per-item refund validates unit ids against that item's own linked units. This supersedes
   the 2026-07-04 "Transactions page only" scoping.
7. **Web expense delete** (`DELETE /api/expenses/:id`) had the same URL-id bug as item 4. It is fixed with
   `expenseIdParamSchema` (`expensesDelete.api.test.ts`). Not changed: this route still returns HTTP 400 on
   failure, not the rule-19c envelope. That is pre-existing.

### Resolution (2026-09-26)

**Built:**
- **Refund window in the POS.** "Refund Sale" and "Refund item" open `RefundMethodModal`, pre-filled
  from a new read-only preview (`sales:refund-preview` / `GET /api/sales/:id/refund-preview`). The
  cashier's legs flow through the existing refund-override contract: `refundBySaleId`'s `refundLegs`, and
  `refundSaleItem`'s new override, validated by the shared `validateRefundLegOverrideAmounts`.
- **Session-sale block.** Refunds of session-paid sales are refused server-side, with the owner's message,
  via `TransactionRepository.isTransactionSessionLinked`.
- **Returned phones.** `unitExtras` are forwarded on both refunds (shared `validateRefundUnitExtras`).
- **Defective-phone confirm** in the cart IMEI dropdown and on scan/auto-add.
- **Deferred Profit net of refunds** (`_getPendingSaleProfitNet`, `salePlusRefundProfitSubquery`).
- **Web sale detail** (`saleIdParamSchema`).

**Verified 2026-09-26:**
- build:core, schema-equivalence (74 tables), tenant-scoping, bind-arity, `yarn typecheck` and `yarn lint`
  (0 errors);
- jest: core 3,960, backend 990 (995 after item 7), electron 219, frontend 1,982 (1 pre-existing skip).
- Tests that were written after their fix are labelled "not proven failing-first" in their headers (rule 17
  as reworded 2026-09-26).

**Desktop e2e (owner run, 2026-09-26):** 311 of 313 passed. Both failures were in `lira-143`, and both
came from the spec not driving this ticket's new screens, not from an app bug:
- the re-sell scan of the refunded-as-defective phone now hits the defective confirm;
- the POS per-item refund now opens the refund payment form.

The spec was updated to click "Sell Anyway" (it now also checks that the confirm appears) and
"Confirm Refund", and the `lira-143` re-run passed. **Web e2e (owner run, 2026-09-26):** 121 passed,
1 skipped.

**Follow-ups:** the proper single-item session refund is `docs/plans/done_plans/SESSION_ITEM_REFUND_PLAN.md`
(LIRA-232, now being built).

---

## LIRA-232: refund a single item from a session basket — HIGH

| Field                | Value                                                                              |
| -------------------- | ---------------------------------------------------------------------------------- |
| **Epic**             | Sessions / Refunds                                                                 |
| **Type**             | Feature (money path)                                                               |
| **Priority**         | High                                                                               |
| **Status**           | DONE 2026-09-27 — committed `24651e83` — 5 review rounds fixed; desktop e2e 313 + lira-232 2/2; web e2e 124 + lira-web-031 fixed |
| **Affected Modules** | pos, audit, debts, sessions                                                        |
| **Source**           | Owner item #9 (2026-09-26); owner's own test of Sale #4 / Session #1               |

### Summary

A session-paid sale has no payment rows of its own, because its payment is pooled on the basket. Refunding
one of its items therefore gave nothing back and left the account debt in place: amir's refunded $1,500
iPhone stayed owed. LIRA-231 blocks those refunds for now. This ticket replaces the block with the proper
flow.

**Full design:** `docs/plans/done_plans/SESSION_ITEM_REFUND_PLAN.md`.

**Owner answers (2026-09-26, all four took the recommended option):**
- A whole-basket reversal after item refunds reverses only what's left.
- POS "Refund Sale" on a session sale refunds all remaining lines in one operation.
- A currency mismatch converts at the day's buy rate.
- The Debts basket view stays read-only.

**Phases:**
1. Core.
2. Transports.
3. UI (Transactions session group, POS sale screen).
4. e2e.

---

## LIRA-233: Profits drill-down for the remaining modules (#14 slice 3) — MEDIUM

| Field                | Value                                                                              |
| -------------------- | ---------------------------------------------------------------------------------- |
| **Epic**             | Profits                                                                            |
| **Type**             | Feature (read-only reporting)                                                      |
| **Priority**         | Medium                                                                             |
| **Status**           | DONE 2026-09-27 — committed `24651e83` — full suites + desktop and web e2e green  |
| **Affected Modules** | profits                                                                            |
| **Source**           | Owner note #14 (OWNER_NOTES_2026-09-21), slice 3                                   |

### Summary

Slice 2 gave By Module rows a transaction list for Product Sales and Recharges. This slice adds the rest:
- financial services, per transfer plus per settlement allocation;
- custom services;
- maintenance, with the parts/labour split;
- loto;
- exchange;
- PM fees;
- simple lists for kept change, counterparty discounts, supplier commission and top-up buyback.

It applies the same owner rules as slice 2:
- counted rows add up exactly to the module row, per currency;
- a "not counted yet" section with a reason per row;
- auto-booked fees are shown next to a row, never subtracted.

`ProfitService.getModuleDetail` now dispatches through a registry. No totals query was changed, and no
transport change was needed.

---

## LIRA-234: desktop cancel-draft role check + web expense error envelope — LOW

| Field                | Value                                                                              |
| -------------------- | ---------------------------------------------------------------------------------- |
| **Epic**             | Transport parity                                                                   |
| **Type**             | Bug                                                                                |
| **Priority**         | Low                                                                                |
| **Status**           | DONE 2026-09-26 — committed `24651e83`                                            |
| **Affected Modules** | pos, expenses                                                                      |
| **Source**           | Follow-ups found while building LIRA-229 / LIRA-231                                |

### Summary

1. **Cancel draft.** Desktop `sales:delete-draft` had no role check and logged an audit entry even when the
   delete was refused.
   - It now requires admin/staff (the same roles as `sales:process`).
   - It rejects an invalid id.
   - It audits only on success.
   - The web route `DELETE /api/sales/drafts/:id` got the matching role check.
   - Tests: `salesHandlers.deleteDraftRoleGate.test.ts` (9 cases, failing-first) and
     `salesDeleteDraft.api.test.ts` (1 new case, "not proven failing-first").
2. **Expense errors on web.** `POST /api/expenses` and `DELETE /api/expenses/:id` returned HTTP 400 on a
   refusal, so the web showed a generic "Failed to …" instead of the real reason. They now return the 200
   `{ success: false, error }` envelope (rule 19c). Test: `expensesDelete.api.test.ts` (failing-first).
   - Found, not fixed: the Expenses page's void handler shows nothing when the server refuses a void.
     That's true on desktop too, and predates this ticket.

---

## LIRA-235: shared staff login for the web e2e suite — LOW

| Field                | Value                                                                              |
| -------------------- | ---------------------------------------------------------------------------------- |
| **Epic**             | Testing                                                                            |
| **Type**             | Test infrastructure                                                                |
| **Priority**         | Low                                                                                |
| **Status**           | DONE 2026-09-27 — committed `24651e83` — web e2e run; lira-web-031 case 4 snapshot order fixed, 4/4 |
| **Affected Modules** | e2e-web                                                                            |
| **Source**           | lira-web-028/029/031 each noted "no staff login fixture exists"                    |

### Summary

`frontend/tests/e2e-web/fixtures.ts` now has `seedStaffUser`, `staffHeaders` and `loginAsUser`.
- lira-web-019/022/025 use it instead of three identical copies.
- lira-web-031 case 4 is no longer skipped: a staff login gets 403 on Reset Data preview/reset, and nothing
  changes.
- lira-web-028 (b) now proves a real staff login can batch-delete.
- lira-web-029 gained case (e): staff sees the same Profits lock and unlocks with the same password.

---

## LIRA-236: refund form — editable exchange rate + free currency mix (all refunds) — HIGH

| Field                | Value                                                                              |
| -------------------- | ---------------------------------------------------------------------------------- |
| **Epic**             | Refunds                                                                            |
| **Type**             | Feature (money path)                                                               |
| **Priority**         | High                                                                               |
| **Status**           | DONE 2026-09-27 — committed `24651e83` — incl. migration v186; full suites + desktop and web e2e green |
| **Affected Modules** | pos, audit, sessions                                                               |
| **Source**           | Owner, 2026-09-27, answering the LIRA-232 rate question                            |

### Summary

Every refund popup gets:
- an editable exchange rate, defaulting to the rate the sale was paid at;
- free currency mixing, where the total value at that rate must equal the refund.

The typed rate also converts the account-first part of a session item refund.

**Scope:** POS Refund Sale / Refund item, the Transactions page Refund, and session item refunds.

**Plan:** `docs/plans/done_plans/REFUND_EXCHANGE_RATE_PLAN.md`.

### LIRA-232 / LIRA-236 — verification and a bug found by the e2e run (2026-09-27)

**Final checks** (all green on the final tree):
- **Checks:** typecheck, lint (0 errors), schema-equivalence (176 migrations), tenant-scoping, bind-arity.
- **Jest:** core 4,147, backend 1,020, electron 246, frontend 2,109.
- **Desktop e2e:** full run 313 of 315; the 2 `lira-232` failures were then fixed, and `lira-232` re-ran 2 of 2.
- **Web e2e:** full run 124 of 125; the `lira-web-031` failure was then fixed, and it re-ran 4 of 4.

**Bug found by the lira-232 e2e — rule 11, pre-existing, fixed.** A POS sale checked out through a session basket never carried the customer. `SessionCheckoutService` stamped `clientId`/`clientName` (camelCase) onto cart items, but `SaleRequest` reads snake_case `client_id`/`client_name` only. So every session-basket sale landed with no client. The fix:
- Both spellings are now stamped.
- `SalesRepository.processSale` no longer auto-creates or name-matches a client for session sales (`deferPayment`), because the session owns client resolution; standalone POS is unchanged.
- Tests: `SessionCheckoutService.salesClientPropagation.test.ts` (3 cases, labelled "not proven failing-first").

**Migration v186** adds `customer_session_transactions.paid_exchange_rate` (nullable, not backfilled): the rate each basket member was paid at, which is the default refund rate. Both `migrations/index.ts` and `create_db.sql` are updated.

**Follow-ups: all fixed 2026-09-27** (full suites + desktop e2e 315/315 + web e2e 125/125 afterwards):
- **`getRecent` query count:** the per-session flags are now batched. The count is flat: 13 queries for 5 sessions and for 50. The single-session check calls the batched one (rule 14).
- **REST envelopes (rule 19c):**
  - `POST /api/transactions/:id/refund`, `/:id/void`, `/checkout-group/:groupId/void` and `/session-basket/:sessionId/void|refund` now return 200 `{ success: false, error }` on failure.
  - The session-basket routes parse ids through `z.coerce`.
  - `POST /api/sales/process` returns 200 too. This was a real web bug: a refused sale showed a generic error instead of the reason.
- **Expenses page:** a refused void now shows the server's reason.
- **`exchangeRate` schema:** there is one definition (`refundExchangeRateSchema` + `refundExchangeRateQuerySchema` from one builder). This fixed the preview endpoint rejecting `null`.
- **Refund line DTOs:** they are derived from the core schema (`"USD" | "LBP"`), with one `toRefundLegs` boundary. This fixed a latent bug where a USDT line was silently sent as USD.
- **The 3 "today" tests (test-only):**
  - Cause: on Windows, `TZ=Asia/Beirut` (set by core's jest script) makes SQLite's `'localtime'` use +01:00 while Node uses +03:00. So for about 2 hours after midnight in Beirut, fixture rows landed on the wrong day.
  - Fixtures are now anchored at noon UTC, and a guard test pins the 22:45 UTC case. Production is not affected, because desktop never sets `TZ`.

**New, NOT fixed — proposed LIRA-237 (investigate):** many reporting queries bucket by `DATE(col, 'localtime')` / `dateRange()`. On the web backend (Fly, host UTC, `TZ` unset per rule 27), that is the SERVER's UTC day. So rows written between 00:00 and 03:00 Beirut may land on the previous day in web daily reports, unless something in that path already compensates. This is unverified.

---

## LIRA-237: web daily reports may put 00:00–03:00 Beirut rows on the previous day — HIGH — INVESTIGATE

| Field                | Value                                                                              |
| -------------------- | ---------------------------------------------------------------------------------- |
| **Epic**             | Dual transport / dates (rule 27)                                                   |
| **Type**             | Investigation (possible bug)                                                       |
| **Priority**         | High                                                                               |
| **Status** | DONE 2026-09-28 — committed `8cf9361d` — CONFIRMED and fixed the rule-27 way: the browser sends `X-Client-Tz-Offset` → tenant context → `repositories/reportingTimeFragments.ts`; Profit, Closing, Sales, Exchange, FinancialService, CustomService, CustomerSession and Product queries converted; desktop falls back to `localtime` |
| **Affected Modules** | profits, closing, dashboard, every daily report on web                             |
| **Source**           | Found while fixing the flaky "today" core tests (2026-09-27)                       |

### Summary

Many reporting queries bucket by SQLite `DATE(col, 'localtime')` / `dateRange()`. On the web
backend (Fly, host UTC, `TZ` unset by design, rule 27), `'localtime'` is the SERVER's UTC day, so
a row written between 00:00 and 03:00 Beirut may land on the previous day in web daily reports.
Something in that path may already compensate — verify first.

**Steps:**
1. Reproduce with a fixed UTC instant and a Beirut client day, over REST.
2. If it is real, fix it the rule-27 way: the client supplies its day, the server's day is only a
   fallback. Never fix it by setting `TZ` on the server.

**What users will notice:** (if confirmed) web daily totals include sales made just after midnight.

---

## LIRA-238: repair old data the owner-notes fixes left behind, and take the SMS fee off the shop line — MEDIUM — CLOSED

| Field                | Value                                                                              |
| -------------------- | ---------------------------------------------------------------------------------- |
| **Epic**             | Owner notes 2026-09-21 — follow-ups                                                |
| **Type**             | Data repair + one code gap                                                         |
| **Priority**         | Medium                                                                             |
| **Status**           | CLOSED 2026-10-02 — the data repairs were dropped by the owner ("old data is fine"; a read-only check of cornertech found nothing to repair), and the SMS-fee-on-the-line code gap was fixed in `01609da6` |
| **Affected Modules** | debts, expenses, recharge, settings (shop lines)                                   |
| **Source**           | `OWNER_NOTES_2026-09-21.md` §00.4                                                  |

### Summary

The fixes for notes #8, #26, #10 and #22 work from now on; past records were not repaired.
1. **#8:** debt balances left at a few hundred LBP (e.g. −340 LBP) by settlements made before
   the fix. A one-off repair per tenant, after a dry-run listing.
2. **#26:** web expenses saved before 2026-09-25 have no `expense_date`, so they don't show on
   Profits. Backfill from `created_at`, dry run first.
3. **#10 / #22:** past drift between an MTC/Alfa shop line's credits and its drawer. A
   reconciliation report per line, then an owner-approved correction entry.
4. **#22 (code):** the SMS fee is still not taken off the shop line when credits are sold
   (`RechargeRepository.ts` ~1222-1230). Add the signed line movement, and decide with the owner
   whether past sales are corrected.

**What users will notice:** old leftover balances and missing past expenses are corrected, and a
shop line's balance matches the credits actually left after SMS fees.

---

## LIRA-239: verify that refunding a "sold ahead" days sale plus the later line recharge nets to zero — MEDIUM — VERIFY

| Field                | Value                                                                              |
| -------------------- | ---------------------------------------------------------------------------------- |
| **Epic**             | Owner notes 2026-09-21 — follow-ups (#28)                                          |
| **Type**             | Execution-based verification                                                       |
| **Priority**         | Medium                                                                             |
| **Status** | DONE 2026-09-28 — committed `8cf9361d` — REAL bug: voiding the days sale and then the later self-charge left the line wrong. A CHARGE reversal is now refused when out of order, with a plain message; newest-first nets every ledger to 0. "Refund basket" is unaffected (a self-charge is never a session member) |
| **Affected Modules** | recharge (carrier lines), sessions, dashboard (owed days)                          |
| **Source**           | `OWNER_NOTES_2026-09-21.md` §00.5                                                  |

### Summary

Note #28 (selling more days than a line holds) shipped in `9ed8d90f` (v184). The plan left one
open item: refunding the days sale together with the later line recharge, in the same session,
may not net to zero on every ledger.

With real writers, check that create + refund nets to 0 on:
- line credits;
- the drawer;
- the "days still to send" list;
- profit.

If it doesn't, fix it with a failing-first test (rule 17).

**What users will notice:** (if a fix is needed) refunding a sold-ahead days sale restores the line
and the owed-days list exactly.

---

## LIRA-240: the ±15% payment-rate check blocks payments; make it an alert — HIGH

| Field | Value |
| --- | --- |
| **Type** | Behaviour change (owner decision) |
| **Priority** | High |
| **Status** | DONE 2026-09-28 — committed `8cf9361d` — the server no longer refuses a far-off rate; the payment form shows an amber warning past 15% ("check for a typo" past 50%) |
| **Affected Modules** | recharge, omt_whish, all payment forms |
| **Source** | Owner note #17 + Exploratory web-app test, 2026-09-28 (`OWNER_NOTES_2026-09-21.md` §00.8) |

### Summary

The payment form refuses a typed exchange rate more than 15% from the shop rate (`TENDER_RATE_BAND_PCT`). It also refused a same-currency payment where no conversion happens.

**Owner decision:** show a non-blocking alert in the payment form (a text line or a warning sign), with no confirmation step; the server no longer refuses. Skip the check when no conversion happens.

**What users will notice:** the payment form warns when the exchange rate is far from the shop rate, but never blocks the payment.

---

## LIRA-241: Debts history has no User column — LOW

| Field | Value |
| --- | --- |
| **Type** | Feature (owner decision) |
| **Priority** | Low |
| **Status** | DONE 2026-09-28 — committed `8cf9361d` — User column in both Debts history tables; the Sale Debt `created_by` actor fixed |
| **Affected Modules** | debts |
| **Source** | Owner note #1 + Exploratory web-app test, 2026-09-28 (`OWNER_NOTES_2026-09-21.md` §00.8) |

### Summary

The Debts page client history shows Date / Note / USD / LBP but not who recorded each entry.

**Owner decision:** add a User column there only; no "By" name on the sale detail or receipt.

**What users will notice:** the Debts history shows which user recorded each entry.

---

## LIRA-242: staff are silently refused for recharges, expenses and maintenance — HIGH

| Field | Value |
| --- | --- |
| **Type** | Permissions (owner decision) |
| **Priority** | High |
| **Status** | DONE 2026-09-28 — committed `8cf9361d` — staff may process recharges (incl. buy-back and shop-line use), add expenses, and create/start/update repair jobs; deletes, cash-out to supplier and line settings stay admin. Owner confirmed 2026-09-29: staff KEEP buy-backs |
| **Affected Modules** | recharge, expenses, maintenance |
| **Source** | Owner note #25 + Exploratory web-app test, 2026-09-28 (`OWNER_NOTES_2026-09-21.md` §00.8) |

### Summary

Staff get a 403 with no message for MTC/Alfa recharges, adding expenses, and creating or starting repair jobs, on both web and desktop. This is very likely the customer's note #25.

**Owner decision:** staff may do all four; void/delete stays admin. Every refusal shows the server's reason.

**What users will notice:** staff can sell MTC/Alfa credits, add expenses and create or start repair jobs, and any refusal now says why.

---

## LIRA-243: Audit Log times show 3 hours ahead on the web — MEDIUM

| Field | Value |
| --- | --- |
| **Type** | Bug (rule 27) |
| **Priority** | Medium |
| **Status** | DONE 2026-09-28 — committed `8cf9361d` — `AuditRepository.log` stamps UTC; entries written before the fix keep the old time (owner decision 2026-09-29: leave them, no backfill) |
| **Affected Modules** | audit |
| **Source** | Exploratory web-app test, 2026-09-28 (`OWNER_NOTES_2026-09-21.md` §00.8) |

### Summary

The same moment shows 20:53 on Transactions and 23:53 on the Audit Log. Audit rows are stored in local time and then rendered as UTC.

**What users will notice:** Audit Log times match the Transactions page.

---

## LIRA-244: Dashboard "Cash Collected (Today)" counts a debt repayment twice — MEDIUM

| Field | Value |
| --- | --- |
| **Type** | Bug (money display) |
| **Priority** | Medium |
| **Status** | DONE 2026-09-28 — committed `8cf9361d` — Cash Collected sums payment legs by their own day (sale transactions + session checkouts) plus repayments; a 12-case matrix matches the drawer (`SalesRepository.dashboardCashCollected.matrix.test.ts`) |
| **Affected Modules** | dashboard |
| **Source** | Exploratory web-app test, 2026-09-28 (`OWNER_NOTES_2026-09-21.md` §00.8) |

### Summary

Measured twice: $8.00 shown against a $4.00 drawer, and $21.37 against $17.37. In both runs the gap is exactly the repayment. The cause has not been traced.

**What users will notice:** "Cash Collected (Today)" matches the cash actually taken.

---

## LIRA-245: Escape in POS checkout empties the cart without asking — MEDIUM

| Field | Value |
| --- | --- |
| **Type** | Bug (UX / lost work) |
| **Priority** | Medium |
| **Status** | DONE 2026-09-28 — committed `8cf9361d` — Escape closes only the top panel; POS passes a non-destructive `onClose` |
| **Affected Modules** | pos |
| **Source** | Exploratory web-app test, 2026-09-28 (`OWNER_NOTES_2026-09-21.md` §00.8) |

### Summary

Pressing Escape in checkout, even with only the receipt preview open, cancels the whole order and empties the cart, with no confirmation.

**What users will notice:** Escape no longer throws away the cart by accident.

---

## LIRA-246: maintenance: status changes keep no user, Lebanese phone formats rejected, name-only client linking — MEDIUM

| Field | Value |
| --- | --- |
| **Type** | Bug |
| **Priority** | Medium |
| **Status** | DONE 2026-09-28 — committed `8cf9361d` — `changed_by` set from the actor; phones normalised (`normalizeLineNumber`); no name-only client link |
| **Affected Modules** | maintenance |
| **Source** | Exploratory web-app test, 2026-09-28 (`OWNER_NOTES_2026-09-21.md` §00.8) |

### Summary

`maintenance_status_history.changed_by` is NULL on web. "03 123 456" / "+961 3 654 321" are rejected as invalid. A job with no phone is linked to a client by name alone.

**What users will notice:** repair jobs accept phone numbers typed with spaces or +961, record who changed their status, and are no longer attached to a same-name client by mistake.

---

## LIRA-247: refusals returned as HTTP 400/403 lose their reason on the web — MEDIUM

| Field | Value |
| --- | --- |
| **Type** | Bug (rule 19c) |
| **Priority** | Medium |
| **Status** | DONE 2026-09-28 — committed `8cf9361d` — about 35 sites use `getApiErrorMessage`; also added the missing success checks (Binance submit, preset on/off) |
| **Affected Modules** | inventory, recharge, expenses, maintenance, others |
| **Source** | Exploratory web-app test, 2026-09-28 (`OWNER_NOTES_2026-09-21.md` §00.8) |

### Summary

Inventory "retail below cost" shows "An unexpected error occurred"; staff 403s show nothing at all. Refusals should use the 200 `{ success: false, error }` envelope, or the UI should surface the thrown `{status, message}`.

**What users will notice:** when something is refused, the screen says why.

---

## LIRA-248: OMT: an edited exchange rate carries over to the next transaction — LOW

| Field | Value |
| --- | --- |
| **Type** | Bug |
| **Priority** | Low |
| **Status** | DONE 2026-09-28 — committed `8cf9361d` — the edited rate resets after each transfer and before opening the payment sheet |
| **Affected Modules** | omt_whish |
| **Source** | Exploratory web-app test, 2026-09-28 (`OWNER_NOTES_2026-09-21.md` §00.8) |

### Summary

After a rate is edited in the payment form, the next OMT transaction starts with that rate until the page is left or reloaded.

**What users will notice:** each new OMT/Whish transaction starts at the shop rate.

---

## LIRA-249: toasts cover the payment panel's Pay button — LOW

| Field | Value |
| --- | --- |
| **Type** | Bug (UX) |
| **Priority** | Low |
| **Status** | DONE 2026-09-28 — committed `8cf9361d` — toasts are click-through; their close button still works |
| **Affected Modules** | ui |
| **Source** | Exploratory web-app test, 2026-09-28 (`OWNER_NOTES_2026-09-21.md` §00.8) |

### Summary

Toasts sit at the bottom right for about 3–5 seconds, on top of the Pay button, and block clicks.

**What users will notice:** messages no longer cover the Pay button.

---

## LIRA-250: Recharge page COUNT / PROFIT cards read 0 after recharges — LOW

| Field | Value |
| --- | --- |
| **Type** | Verify |
| **Priority** | Low |
| **Status** | DONE 2026-09-28 — committed `8cf9361d` — CONFIRMED real (the cards read `financial_services`, which never holds recharges). New core read `RechargeRepository.getTodayStats(provider)` (IPC `recharge:get-today-stats` + `GET /api/recharge/today-stats`) reuses the Profits page's own recharge gates (`type='RECHARGE'`, `notRefunded`, `notDebtPending`, stamped profit, `isToday`); feeds Count, Profit and Total Profit. NOT proven failing-first |
| **Affected Modules** | recharge |
| **Source** | Exploratory web-app test, 2026-09-28 (`OWNER_NOTES_2026-09-21.md` §00.8) |

### Summary

After 8 successful recharges the cards still read 0. Not yet checked after a reload.

**What users will notice:** (if confirmed) the Recharge page cards count today's recharges.

---

## LIRA-251: `getUsdLbpSellRate()` has no tenant filter — MEDIUM

| Field | Value |
| --- | --- |
| **Type** | Security / tenant isolation |
| **Priority** | Medium |
| **Status** | DONE 2026-09-28 — committed `8cf9361d` — the filter was ALREADY fixed in `9ed8d90f` (guard `utils/__tests__/exchangeRate.tenantScoping.test.ts`, re-run 9/9). The real gap: `check-tenant-scoping.mjs` never scanned `packages/core/src/utils/`; now it does (216 files, 0 violations) |
| **Affected Modules** | exchange rates (all money flows) |
| **Source** | Found while building LIRA-240 (2026-09-28) |

### Summary

A comment claimed `getUsdLbpSellRate()` read the rate without a tenant filter. Measured: it was already
fixed. The linter that should have caught it could not, because it never scanned `utils/`. The stale
comment in `constants/tenderRateBand.ts` was corrected.

**What users will notice:** nothing.

---

## LIRA-252: MTC/Alfa drawer can drift from the carrier lines it's supposed to equal — HIGH — DONE (closed 2026-10-10)

| Field | Value |
| --- | --- |
| **Type** | Bug (money) |
| **Priority** | High |
| **Status** | PARTIAL 2026-10-02 — items A, B, C built. B+C (core, both transports) proven failing-first then green; full verification green from that session: core jest 465/465 suites (4528/4528 tests), electron-app jest 260/260, backend jest 1114/1114, core+electron-app+backend+frontend typecheck clean, eslint clean on touched files, check-tenant-scoping (0 violations), check-bind-arity (OK), check-schema-equivalence (0 diffs). Item A (Checkpoint page + Setup wizard per-line UI) built this session — see "What was built (item A)" below; frontend typecheck (tsconfig.app.json + tsconfig.playwright.json, both ~15s/~4s real), packages/ui typecheck, eslint (0 errors/warnings on touched files) and the full frontend jest suite (344/344 suites, 2246/2246 tests, 135s real) all green. Only the Recharge-page mismatch warning (item E) remains — see "Open" below |
| **Affected Modules** | recharge, closing, carrier lines, Setup wizard |
| **Source** | Production cornertech investigation, 2026-10-02 |

### Summary

`RechargeRepository.ts` §0.1 documents the invariant: **carrier drawer (MTC / Alfa, USD) == Σ credits of
that carrier's ACTIVE carrier lines.** Sales, buy-backs and line-use keep it via
`CarrierLineService.applyMovement`. In production the MTC drawer read **$10,000** against one line
(`03924245`) at **$500**; Alfa read **$10,000** with **no line at all**. Causes found:

1. The Setup wizard (`StepDrawerAmounts.tsx` + `StepComplete.tsx`) books MTC/Alfa credits into the drawer
   even with no phone number (`buildCarrierLines()` skips a carrier with an empty phone), and its
   `createCheckpoint` call never sends `carrier_lines`.
2. The Dashboard/Checkpoint page (`Checkpoint/index.tsx`) saves a typed MTC/Alfa drawer amount with no
   line link whenever `carrierLine` is null (no line, not loaded yet, or a fetch error).
   `ClosingRepository.createCheckpoint` derives the carrier drawer from lines ONLY when
   `data.carrier_lines` is sent — a bare drawer amount with none sailed straight through.
3. Settings → Carrier Lines create/edit and the Recharge inline quick-update
   (`CarrierLineRepository.createLine`/`updateLine`/`updateBalance`) changed line credits with **no
   drawer effect at all**.
4. Nothing reconciled the two.

### Owner decisions (2026-10-02)

- **A.** Checkpoints (Dashboard and Setup) enter MTC/Alfa credits PER PHONE LINE; the drawer is always
  the sum; no free-typed MTC/Alfa drawer amount; a carrier with no active line must add one first (no
  bare amount accepted). Setup wizard requires a phone number for non-zero MTC/Alfa credits and sends
  `carrier_lines`.
- **B.** Settings → Carrier Lines (and the Recharge inline balance update): add/edit/archive/reactivate
  moves the carrier drawer by the same delta, as an auditable adjustment (who/when) — reusing the
  checkpoint's own adjustment mechanism, not a new transaction type.
- **C.** `ClosingRepository.createCheckpoint` (both transports) derives the MTC/Alfa drawer from the
  submitted per-line credits and refuses a bare non-zero MTC/Alfa amount with no line supplied. Zero
  amounts / no MTC module stay backward compatible.
- **D.** Existing production data is NOT repaired — the tenant will be reset later.
- **E.** Optional: a mismatch warning on the Recharge page when drawer ≠ Σ lines (legacy data) — only if
  cheap.

### What was built this session (items B + C — core, both transports)

- **C** — `ClosingRepository.createCheckpoint` (`packages/core/src/repositories/ClosingRepository.ts`):
  refuses a non-zero MTC/Alfa USD row in `amounts` when no `carrier_lines` were counted for that carrier
  in the same call (zero amounts and non-carrier drawers stay unaffected — same code path serves both
  desktop IPC and the web REST route, since both call this one repository method). Guard tests (new,
  proven failing-first): `ClosingRepository.carrierLineCheckpoint.test.ts` — "refuses a bare non-zero MTC
  amount when no carrier line is supplied", "...Alfa...", "allows a ZERO MTC/Alfa amount...". Two
  pre-existing, UNRELATED tests in `ClosingRepository.lastCheckpointPerDrawer.test.ts` used "MTC"/"Alfa"
  as incidental fixture drawer names for a freshness-only concern (LIRA-156) and were renamed to
  `Safe`/`VendorX` to stop colliding with the new business rule.
- **B** — `CarrierLineRepository` gets one new private helper, `postCarrierDrawerAdjustment` (reuses
  `CHECKPOINT_ADJUSTMENT_METHOD` / `moneyPosting.ts`'s `insertPaymentRow`+`applyDrawerDelta` — no new
  transaction type, per owner instruction), wired into `createLine` (non-zero starting credits),
  `updateBalance` (Recharge inline quick-update), a new `updateLineAndSyncDrawer` (the Settings edit-form
  entry point — kept SEPARATE from the plain `updateLine` primitive, which `applyMovement`/
  `reverseMovement` build on and must NOT double-post against), `toggleActive` and `archive`. `userId`
  threaded through `CarrierLineService` → `electron-app/handlers/carrierLineHandlers.ts` (`auth.userId`)
  → `backend/src/api/carrierLines.ts` (`req.user!.userId`) for both transports. Guard tests (new, proven
  failing-first — TS compile errors against the pre-fix API, then full red/green after the methods
  existed): `CarrierLineRepository.drawerAdjustment.test.ts` (9 tests) — create/update/toggle/archive
  each move the drawer by the right delta and keep `getCarrierCreditsSum` in lockstep; a dedicated test
  pins that `applyMovement` (the money-path primitive sales/buy-backs/line-use already drive) is NOT
  double-posted by this new mechanism.

Fixing the full suite also required touching several PRE-EXISTING test fixtures whose premise the new
behavior invalidated (rule 17: real behavior change, not reverted) — `CarrierLineRepository.test.ts`,
`.validityRule.test.ts`, `.absoluteValidity.test.ts`, `.primaryAndDelta.test.ts`, and
`CarrierLineService.applyMovement.test.ts` gained the `payments`/`drawer_balances` tables their minimal
schemas lacked; `Checkpoint.stress.test.ts` and `ClosingRepository.lastCheckpointPerDrawer.test.ts`
renamed an incidental "MTC"/"Alfa" drawer-name fixture choice to a non-carrier name (their actual concern
was unrelated to the carrier-line invariant); `TransactionRepository.carrierLineReversal.test.ts` and
`CarrierLineRepository.recordUsage.test.ts` had absolute `payments`-row-count / drawer-balance assertions
that assumed `createLine`/`archive` never touched the drawer — updated to the new, correct baselines (or,
for `recordUsage.test.ts`'s void-nets-to-zero query, scoped by transaction id instead of by drawer name,
since an unscoped sum now also picks up the untransacted manual-adjustment rows).

### What was built (item A — Setup wizard + Checkpoint page per-line UI, 2026-10-02)

- **Checkpoint page** (`frontend/src/features/closing/pages/Checkpoint/index.tsx`,
  `components/DrawerCard.tsx`): MTC/Alfa's USD figure is no longer a single free-typed field — the page
  fetches every active line for the carrier (`api.getActiveCarrierLines`) and renders one Credits +
  Validity row per line (`DrawerCard`'s `carrierLine` prop became `carrierLines: DrawerCardCarrierLineRow[]`,
  with a header total = Σ of the rows). `handleSave` builds `carrier_lines` from every active line's typed
  credits/expiry and never includes a bare MTC/Alfa row in `amounts` (that currency is filtered out of
  `drawerCurrencies` for a carrier drawer, so the array the server would need to refuse is never
  constructed in the first place — the invariant holds by construction, not by a late check). A carrier
  with zero active lines renders an inline "add a line" prompt (phone + starting credits, posts via
  `api.createCarrierLine`, which already moves the drawer per item B) instead of the card, and disables
  Save until a line exists.
- **Setup wizard** (`steps/StepDrawerAmounts.tsx`): the Credits field now writes to its own
  `carrierLineDrafts[drawer].credits`, never to `amounts[drawer]["USD"]` — `buildDrawerAmounts()` excludes
  both carrier drawers outright, so `drawer_amounts` can no longer carry a bare MTC/Alfa figure.
  `validateCarrierLines()` (called from `handleNext`) blocks Next with an inline message when credits are
  typed with no phone number, replacing the old D4 "soft nudge, never blocks" behavior the server's new
  refusal made unsafe.
- **`StepComplete.tsx`** (rule 19 fix): replaced the raw `window.api.setup.complete` /
  `window.api.closing.createCheckpoint` calls with `useApi().completeSetup` (new dual-mode adapter fn,
  added to `backendApi.ts` / `ElectronApiAdapter.ts` / `packages/ui/src/api/types.ts` per rule 21 — desktop
  IPC-only, with a clean refusal on the web branch since the wizard itself has no web counterpart) and
  `useApi().createCheckpoint`. The initial checkpoint's `amounts` filters out any `MTC`/`Alfa` row
  (belt-and-braces — `buildDrawerAmounts()` no longer produces one, but the checkpoint call double-checks)
  since `completeSetup` already created the carrier line and that creation posts the drawer adjustment
  itself (item B); a bare row here would double the money and get refused by item C's server-side guard.
  Catch-block errors now go through `getApiErrorMessage` so a server refusal surfaces its real message
  instead of a stringified error object.
- Guard tests (new): `DrawerCard.test.tsx` (rewritten for the array API, proven red against the old
  single-`carrierLine` prop — TS compile error, same pattern items B/C used), `Checkpoint.carrierLines.test.tsx`
  (3 tests — add-line prompt + disabled Save with no lines, add-line flow, multi-line sum + payload shape),
  `StepDrawerAmounts.test.tsx` (2 tests rewritten, both proven red against the pre-fix code — real failures
  captured, not asserted from code reading), `StepComplete.test.tsx` (new — 3 tests: routes through
  `useApi()` not `window.api`, filters a bare MTC/Alfa row even from a defensive stale-payload case,
  surfaces a server refusal readably).
- Verification: frontend `tsc -p tsconfig.app.json --noEmit` (~15s) and `tsc -p tsconfig.playwright.json
  --noEmit` (~4s) clean; `packages/ui` `tsc --noEmit` (~5s) clean; eslint 0 errors/0 warnings on every
  touched file; full frontend jest suite 344/344 suites, 2246/2246 tests green (135s real — not a
  zero-output no-op).

### Open (NOT built)

- ~~**E** — Recharge-page mismatch warning not built.~~ **Built 2026-10-10** (see below).
- Production data repair — explicitly out of scope (owner decision D).

### E2E impact

Grepped `frontend/tests/e2e-electron` + `frontend/tests/e2e-web` for `createCheckpoint`, `carrier`, `MTC`,
`Alfa`, `setup-carrier-*`, `StepDrawerAmounts`:

- **No existing spec needed a selector update.** The three checkpoint-timeline specs that call
  `createCheckpoint` directly (`lira-091-checkpoint-timeline-variance.spec.ts`,
  `lira-100-checkpoint-timeline-timezone.spec.ts`, `lira-150-dashboard-checkpoint-time.spec.ts`) and the web
  `lira-web-010-checkpoint.spec.ts` all hand-build the IPC/REST payload and checkpoint `General` only — they
  never touch the Checkpoint page's UI or the changed `DrawerCard`/carrier-line rendering.
  `lira-129-loto-refund.spec.ts`'s `createCheckpoint` is an unrelated local helper name (loto checkpoints),
  not this repository's.
  `lira-web-019-telecom-buyback.spec.ts` / `lira-web-025-carrier-line-usage-expense.spec.ts` provision
  carrier lines directly via `POST /api/carrier-lines`, bypassing both changed UIs.
  The shared setup fixture (`frontend/tests/e2e-electron/fixtures.ts`'s `completeSetup()`, used by every
  spec that boots a fresh shop) only fills `setup-amount-General-USD`/`-LBP` and clicks Next/Launch — it
  never types into `setup-carrier-credits-MTC`/`-Alfa` or `setup-carrier-phone-*`, so
  `validateCarrierLines()`'s new phone-required block never fires and `buildDrawerAmounts()`'s MTC/Alfa
  exclusion is a no-op for it (those rows were never in the set it built). Unaffected, run unmodified.
- Items B/C's previously-flagged re-run list (`lira-125-carrier-lines-validity-credits.spec.ts`,
  `lira-145-carrier-line-usage-expense.spec.ts`, `lira-149-validity-rule-and-onlydays-profit`,
  `lira-132-telecom-only-days`, `lira-web-019/020/025`) is unchanged by item A — none of those drive the
  Checkpoint page or Setup wizard carrier-line UI — and was not re-run this session either (still report
  only, per the standing "don't run e2e without asking" convention — CLAUDE.md feedback note).

**What users will notice:** a Checkpoint or Setup screen that types a dollar amount into MTC or Alfa with
no phone line behind it now refuses to save, instead of quietly overwriting the drawer; Checkpoint and
Setup now count MTC/Alfa credits per SIM line (one field per active line, drawer = their sum), and a
carrier with no active line gets an inline prompt to add one instead of a blank dollar field; adding,
editing, archiving or re-activating a shop SIM line in Settings now moves that carrier's drawer to match,
automatically.

### What was built (item E — 2026-10-10)

The MTC/Alfa panel on the Recharge page (`CarrierLinesPanel`, new optional `drawerUsd` prop fed from the page's
existing `getRechargeDrawerBalances()` through `TelecomForm.carrierDrawerUsd`) shows an amber warning when the carrier
drawer's USD balance differs from the sum of its active lines' credits by more than half a cent, naming both amounts
and pointing to a checkpoint. No warning while the drawer balance is unknown. Display only; both transports (the
drawer balances adapter is already dual-mode). Guard test `CarrierLinesPanel.drawerMismatch.test.tsx`: the warning
case failed first (`Unable to find … carrier-drawer-mismatch`), the two no-warning guards passed before and after.
Recharge suites 290/290, frontend tsc app/test clean, eslint 0 errors. Ticket closed: A–C built 2026-10-02, D owner
decision (no repair), E built.

What users will notice: if an MTC or Alfa drawer no longer matches its SIM lines, the Recharge page now shows a
warning with both amounts, so the shop can fix it with a checkpoint.

---

## LIRA-253: "Undo refund" for an item refunded inside a customer-session basket — MEDIUM

| Field | Value |
| --- | --- |
| **Type** | Feature (follow-up to LIRA-147) |
| **Priority** | Medium |
| **Status** | DONE 2026-10-02 (not yet committed) — SALE-member scope only, see note below |
| **Affected Modules** | sessions, pos, transactions |

### Summary

LIRA-147's admin "Undo refund" covers a per-item refund of a normal sale. A refund made with
`refundSessionBasketItem` (money pooled across the basket, possibly several earlier item refunds)
is refused with a clear message. Build undo for that path with full rule-20 symmetry: the basket's
pooled legs, account-first reduction, poolSplit metadata and the `_cancelSessionDebt` marker. Prove
that create + refund + undo nets to the post-sale state on every ledger, per currency.

Owner decision 2026-10-02: in the rare case where FIFO split rows can't be traced, undo keeps
refusing rather than risk a wrong cost. No schema change.

**What users will notice:** an admin can also undo an item refund made inside a customer session.

### Build note (2026-10-02)

Implemented `TransactionRepository.undoSessionBasketItemRefund`, dispatched automatically from
the SAME shared entry point as LIRA-147 (`SalesRepository.undoSaleItemRefund` reads the refund's
own `metadata_json.refundType` and routes to the session-aware counterpart when it's
`"sessionItem"`) — zero new IPC channel/REST route/schema needed, the LIRA-147 wiring already
covers both shapes. `refundSessionBasketItem` now also stamps per-line `lines`
(`saleItemId`+`quantity`) and the merged `restoredUnitIds` onto its own REFUND row's metadata (the
detail the session-aware undo needs that the standalone flow didn't carry); the item-side reversal
routine (`sale_items.refunded_quantity`/`products.stock_quantity`/FIFO batch/`product_units`) was
extracted into a new shared `SalesRepository.unapplySaleItemReversal` so the standalone undo and
this one share ONE routine (rule 14) instead of two drifting copies.

**Scope note:** only a SALE session member is supported (the lines metadata this undo needs is
only stamped for that branch) — a RECHARGE/CUSTOM_SERVICE session-member item refund refuses with
a named reason ("does not yet support") rather than attempting an untraced generic reversal. The
ticket's own refusal list (double undo, resold unit, consumed stock) is entirely SALE-member
language, so this matches the filed scope; a non-SALE member extension is a natural follow-up, not
filed separately here.

Guards reuse `undoSaleItemRefund`'s exact two dependent-activity checks
(`StockBatchRepository.canUnrestoreForSaleItem`, the resold-unit check via the refund's own
`restoredUnitIds` stamp) plus the standalone idempotency check (one ACTIVE REFUND_UNDO per
refund). Money/debt reversal: the account-first credit (`SESSION_ITEM_REFUND_CREDIT_TYPE` rows) is
re-charged as `'Session Debt'`, and every `payments` row the refund posted under its own
transaction id (pool-split AND repaid-account legs alike — both are plain rows, no distinction
needed) is negated and reposted — 4 new tests in
`TransactionRepository.refundSessionBasketItem.test.ts` (proven failing-first: `undoSessionBasketItemRefund`
TypeErrors "is not a function" pre-change), covering a CUSTOMER_ACCOUNT basket (debt/stock/profit
nets to the post-sale state), a CASH basket (drawer nets back exactly), double-undo refusal, and
the resold-unit refusal. The frontend "Undo refund" button (`TransactionCells.tsx`) now also
renders for `refundType === "sessionItem"`, same `onUndoRefund` handler as the standalone case —
the pre-existing hidden-for-sessionItem test was rewritten (rule 24) to assert it now shows.

**Not built in this change:** the REFUND row is not re-linked into
`customer_session_transactions` on undo (avoided deliberately — a `ProfitRepository` comment flags
that linking under the EXISTING `'session_item_refund'` type would double-adjust profit math
designed around a refund-only semantics; a safe link would need a new type and a matching
ProfitRepository audit, out of scope here). The underlying ledgers (stock/debt/drawer/profit) are
still fully and correctly reversed — only the session-basket UI's own transaction list may not
show the undo as its own line item.

---

## LIRA-254: Reset Data keeps MTC/Alfa carrier lines, zeroing their credits — DONE

| Field | Value |
| --- | --- |
| **Type** | Fix |
| **Priority** | Medium |
| **Status** | DONE, built 2026-10-02 |
| **Affected Modules** | settings (Reset Data), carrier-lines |

### Summary

Owner decision 2026-10-02: Settings → Reset Data used to delete `carrier_lines` entirely
(it sat in `RESET_WIPE_TABLES`), so a reset left the MTC/Alfa checkpoint showing only an
"add a line" prompt. A shop's SIM phone numbers are shop setup, like currencies — a reset
now KEEPS every carrier-line row (phone/label/carrier/is_primary/is_active/
`validity_expires_at`, the SIM's real expiry) and resets only `credits`/`days_owed` to 0,
matching the zeroed drawers (LIRA-252: drawer = Σ active line credits).

`carrier_lines` moved from `RESET_WIPE_TABLES` to a generalized `RESET_ZERO_TABLES` bucket
(`packages/core/src/constants/resetTables.ts`) — a `{ table, columns }` spec, so the same
mechanism that zeroes `drawer_balances.balance` now also zeroes `carrier_lines.credits`/
`.days_owed` without a second hand-rolled UPDATE. `carrier_line_movements` and
`carrier_line_owed_deliveries` (per-line HISTORY) stay in `RESET_WIPE_TABLES` — deleted by
their own `tenant_id`, not by cascade from the kept parent, so no FK ordering issue. The
zero happens as a direct column UPDATE inside the reset transaction — no
`CARRIER_LINE_ADJUSTMENT` transaction, no LIRA-252 drawer-adjustment posting — since
`transactions` and `drawer_balances` are already wiped/zeroed by the same reset.

Guard-first (rule 17): added two tests to `DatabaseResetRepository.test.ts` asserting the
kept-row/zeroed-columns/wiped-history/no-adjustment-transaction/zeroed-drawer behavior and
tenant isolation; both failed red on the pre-fix code (the row was gone, not zeroed) before
the fix made them pass. Updated `resetTables.guard.test.ts` and the existing
`DatabaseResetRepository.test.ts` fixture/assertions that assumed `carrier_lines` was wiped
and `RESET_ZERO_TABLES` was a flat table-name list.

**What users will notice:** Reset Data now keeps your MTC/Alfa lines (phone numbers) and
sets their credits to 0.

---

## LIRA-255: OMT account: compare the app with OMT's statement SMS — MEDIUM

| Field | Value |
| --- | --- |
| **Type** | Feature (owner request) |
| **Priority** | Medium |
| **Status** | DONE 2026-10-03. Added `SupplierRepository.getAccountExpectedStatement` (core) — reuses the account card's own gross figure (`getAccountBalances`) and the Settle tab's own pending-settlement row set (`getUnsettledBySupplier`/`pendingSettlementSql`, rule 14) to sum `commission` across ALL `commission_model` values (deliberately NOT legacy-only like `getUnsettledSummaryByProvider`'s dollar columns — see `AccountExpectedStatement`'s doc comment for why the creation-time estimate IS the real figure for this one purpose, and the D17 nuance). `expected = gross − unsettled_commission`, no sign flip (the app's own balance sign is already OMT's own convention — positive = shop owes). Wired IPC (`suppliers:account-expected-statement`) + REST (`GET /api/suppliers/:id/account-expected-statement`) + adapter (types derived/mirrored per the existing `AccountBalance` pattern, rule 21) + a `useSupplierAccountExpectedStatementQuery` hook. New `OmtStatementCheckPanel` renders on the OMT account's own panel (gated the same way the Settle Account button is, `isSelectedAccountParent`), showing gross/−commission/=expected per currency plus two SMS inputs (minus allowed) with a green/amber diff badge (±$0.01 / ±1 LBP); last-typed values persist to localStorage behind try/catch, keyed per account, read only by the panel itself. Display-only — nothing is booked. Core test (`SupplierRepository.accountExpectedStatement.test.ts`, real writers via `FinancialServiceRepository.createTransaction`): USD SEND $207+$1 fee/$0.25 commission + an LBP transfer ⇒ expected = gross − commission per currency; a RECEIVE case proves the OMT-owes-the-shop (negative) direction too — both failing-first (a schema gap, then a wrong RECEIVE-sign expectation, were caught red before going green). Frontend test (`OmtStatementCheckPanel.test.tsx`): renders the three figures, green "Matches" within tolerance, amber "Off by $X" outside it in both sign directions, and localStorage persistence across a remount. `yarn workspace @liratek/core typecheck`/`lint` (tsc, 9.6s), `yarn workspace @liratek/frontend` app typecheck (19.6s), `electron-app`/`backend` typecheck, eslint on touched files (0 errors), full `src/features/suppliers` (17 suites/69 tests) and core Supplier/FinancialService suites (48 suites/607 tests) all green. |
| **Affected Modules** | Suppliers (OMT account), omt_whish |

### Summary

OMT texts the shop its balance, e.g. "the balance of your account as of 01-10-2026 with O.M.T. is USD -1,160.99 and
LBP 11,584,062. INCLUDES INTRA SHARES". **OMT's sign:** minus = OMT owes the shop, plus = the shop owes OMT (owner,
2026-10-03). "Includes intra shares" = the commission is already deducted in OMT's figure.

The app books OMT GROSS (transfer + fee), so the app's figure and OMT's differ by exactly the commission not settled
yet. On the OMT account (Suppliers page), show per currency (USD, LBP):
- **Owed to OMT (gross)**, from the app;
- **minus unsettled commission**, ALL commission types for now (owner: not yet split by type);
- **= what OMT's statement should show**, in OMT's own sign convention.

The owner can type the SMS figures to see the difference. Display only; nothing is booked.

**What users will notice:** the OMT account shows the balance OMT's SMS should report, so a missing or double transfer
stands out at a glance.

---

## LIRA-256: tell the app which commission types an OMT statement includes, and settle the FIFO queue by type — LOW (later)

| Field | Value |
| --- | --- |
| **Type** | Feature (future, owner 2026-10-03) |
| **Priority** | Low |
| **Status** | TODO, not now |

### Summary

OMT's statement sometimes includes only some commission types ("INCLUDES INTRA SHARES", sometimes intra plus another
type). Later: let the owner mark which types a statement covers, so that LIRA-255's check, and settlement in the FIFO
queue, deduct only those types' commission.

---

## LIRA-257: web shops are created without the system suppliers (OMT, Whish, iPick, Katsh, app wallets, Loto) — HIGH — DONE (not deployed)

| Field                | Value                                                             |
| -------------------- | ----------------------------------------------------------------- |
| **Epic**             | Suppliers / Tenant provisioning                                   |
| **Type**             | Bug                                                               |
| **Priority**         | High                                                              |
| **Status**           | **DONE** 2026-10-06 in the working tree; ships on the next deploy |
| **Affected Modules** | suppliers, omt_whish, ipec_katch, loto                            |

### Problem

test.liratek.shop (tenant 5) showed a single supplier, while cornertech (tenant 1) has the full list.
Tenant 1 got its suppliers from `electron-app/create_db.sql` and the early migrations. A shop
provisioned on the web runs `TenantRepository.seedConfig`, which skipped suppliers as "sample data".
The modules look these suppliers up by `provider`, per tenant, so a web shop had no OMT account to
settle against. Loto Liban is created lazily on the first Loto sale, which is likely the one supplier
tenant 5 has (not checked against live data: flyctl was unavailable).

### Fix

- `packages/core/src/db/systemSuppliers.ts` — one definition of the seven system suppliers, matching
  create_db.sql's tenant-1 seed (commission config, Whish's `is_system = 0`, iPick / OMT App linked to
  the tenant's own OMT row). Insert-if-missing per tenant, matched by provider OR exact name (suppliers
  is `UNIQUE (tenant_id, name)`); a name match is skipped and reported, never crashes. `module_key`
  only when the tenant has that module row (composite FK). Never changes an existing row.
- Whish is seeded **inactive**, matching v78 (LIRA-045). `create_db.sql` now deactivates it too, so
  fresh desktop installs, migrated installs and web tenants agree (before, fresh installs had it
  active and migrated ones inactive).
- `TenantRepository.seedConfig` calls it, so every new shop gets them.
- Migration v191 `backfill_system_suppliers` calls it for every existing tenant. Tenants that already
  have all seven (desktop installs, cornertech) are unchanged. `down()` is a no-op on purpose.
- Guard: `packages/core/src/db/__tests__/systemSuppliers.test.ts` — failing-first (5 of 6 original
  tests failed on the unfixed code; the cross-tenant-link test passed vacuously and is a guard only;
  the name-collision and FK tests were added after the fix and are not proven failing-first).

### Known limits

- If a tenant already has a supplier NAMED like a system one but without its provider (e.g. a
  hand-added "OMT"), v191 skips that provider and logs `Migration v191: tenant N NOT seeded for
  provider(s) …`. That shop still needs a manual fix. Check the deploy log.

- Past OMT / Whish / iPick / Katsh entries on an affected web shop that should have written a
  supplier ledger row while the supplier was missing are not reconstructed. Check the live data after
  deploy.

**What users will notice:** On the web app, the Suppliers page of a shop created on the web now lists
OMT, iPick, Katsh, OMT App, Whish App and Loto Liban (plus Whish, switched off), and new shops start
with them.

## LIRA-258: posting integrity — every multi-ledger gap from the 2026-10-06 audit (G1–G39) — HIGH — DONE (closed 2026-10-10)

| Field    | Value                                                          |
| -------- | -------------------------------------------------------------- |
| Epic     | Posting integrity                                              |
| Type     | Bug                                                            |
| Priority | High                                                           |
| Status   | IN PROGRESS 2026-10-06                                         |
| Source   | Plan `docs/plans/ongoing_plans/POSTING_INTEGRITY_PLAN.md` batch 1 (gap list: `docs/POSTING_MAP.md` §7) |

### Summary

1. **FOR-partner OMT/WHISH SEND books obligations only** (owner decision D1, 2026-10-06) — supplier
   OMT/WHISH `TOP_UP` **+(x+f)** back-linked to the `financial_services` row (the generic void
   cascade reverses it); partner `FOR_OMT_SEND`/`FOR_WHISH_SEND` DEBIT = the same `x+f` from
   `grossOwedDelta`; **no drawer moves**; OUT legs rejected. `OMT_APP`/`WHISH_APP`/`BINANCE`
   unchanged. The FOR RECEIVE supplier booking now shares the same helper and no longer swallows
   errors. Closes **G1**, **G24** (FOR half) and **G2** for the FOR-SEND case. Failing-first proven
   on pre-fix code: 4 tests threw "A partner SEND must include the shop's disbursement as OUT
   payment legs", 1 "did not throw". Guard: `FinancialServiceRepository.partner.test.ts`, "LIRA-258"
   block. Also answers PRIMARY_CASH_DRAWER_PLAN §6 item 6a.
2. **Through-partner transfers on the SECOND system** (owner D3/D7) — no longer flagged
   supplier-pending; the shop fee counts as profit immediately (**G3**, **G32**). Dashboard "Pending
   Settlement" banner gains partner lines. Services form hint: "Amount = what the partner tells you
   to collect · Fee = your shop fee".
3. **Missing or turned-off supplier is created / re-activated automatically** (D2, **G4**) — reuses
   LIRA-257's `packages/core/src/db/systemSuppliers.ts`.

4. **Batches 2–4, same day** (each with a failing-first guard unless noted in POSTING_MAP §7):
   G5 item refund reverses the partner share · G6 FOR sale in a basket refused · G7 maintenance
   never charges twice (D8) · G8 one payments row per currency · G9/G33 drawer-to-drawer source leg
   journaled, may go negative · G10 top-up/cashout ensure the supplier · G11 supplier and partner
   operations atomic · G12 re-completing a completed sale refused · G13 store-credit failure rolls
   back (POS, recharge, custom services, transfers, baskets) · G14/G23 Loto legs reconciled,
   gift card, settlement linked + screens wired · G15 DAYS sale lowers line credits (D4) · G16
   via-partner payout profit waits for the partner (D5) · G21 item refund cancels the credit share
   · G22 custom-service delete keeps the journal · G26 THROUGH app-wallet ledger keys · G28 pm fee
   reaches the drawer · G29 Exchange payout keep-change (D9) · G34 void skips audit-only PM_FEE rows
   · G35 drawer recalculation skips them too · G39 gift cards load on the web app.
   Checked, no change: G18, G20, G27, G30. By owner decision: G19 (D6), G25 (D7). Comments: G31.
   G36 partner coverage nets reversals · G37 refund gives the gift card back · G38 checked
   unreachable (guards only) · G17 basket profit waits for the customer (v192) · G40 voided supplier
   history rows show "Voided" and stay out of the FIFO and totals (found in the production test).

Docs updated: FEATURE_GUIDE §7 (PCD row), §8 (second-system row), §8.1.0 (SEND); POSTING_MAP §4.1,
§7; PRIMARY_CASH_DRAWER_PLAN §6 6a.

**What users will notice:** Sending an OMT or Whish transfer for a partner now shows on the OMT/Whish
supplier page as money you owe and no longer takes cash out of a drawer; transfers done through a
partner on your second system no longer wait for a supplier settlement and their shop fee counts as
profit straight away; the Dashboard's Pending Settlement banner also lists partners to settle with;
the Services page explains Amount vs Fee; a repair job is never charged twice; refunding one item of a partner sale lowers what the partner owes; Loto payments must add up and gift cards work on Loto; selling days lowers the line credits; Exchange can keep the leftover cents; gift cards show up on the web app. All from now on only.

Closed 2026-10-10: every gap G1–G46 is fixed and committed (Oct 7 commits `e56ce482`, `dba9f93a` and later) or closed
by an owner decision (G19, G25, G27) or checked as correct (G18, G20, G30, G38); `docs/POSTING_MAP.md` §7 statuses
updated (G17 fixed by migration v192). Optional follow-up, not a bug: Phase 5 posting rules for the 18 transaction
types still marked `todo-phase5` in `packages/core/src/constants/postingRules.ts`, and the G31 stale comments.

---

## LIRA-259 … LIRA-264: owner bug list 2026-10-06 (evening) — IN PROGRESS

Interviewed 2026-10-06. Each item ships with a failing-first guard unless noted in its report.

| Ticket | Item | Owner decision | Status |
| --- | --- | --- | --- |
| LIRA-259 | Katsh: handing back less change than due (e.g. card 450,000 LBP, customer pays $6, cashier returns 10,000 instead of ~34,000 LBP) fails | The un-returned part is kept change (shop profit), like partial keep-change elsewhere | DONE — the form never sent the un-returned part, so the server's reconcile refused it; MultiPaymentInput `keepUnreturnedChange` (on for Katsh/iPick). Also fixed globally: with Keep change on, change returned in the other currency was not recorded leaving the drawer. Owner decision pending: whole change kept silently when both change fields are cleared |
| LIRA-260 | Price-change alert | Any price a cashier changes away from its saved price: amber warning only (saved vs new), sale still goes through | DONE (MTC/Alfa credit, Katsh/iPick Only-Days, Services presets/items, maintenance parts, including parts on a reopened saved job; POS has no editable line price). What users will notice: reopening a saved maintenance job now shows the price warning on any part whose price differs from the product's current price. |
| LIRA-261 | Exchange default direction | Opens on USD → LBP | DONE |
| LIRA-262 | Expense from stock | Search bar (like Services) over inventory + Katsh/iPick/Whish App items; shop uses its own stock: leaves stock / provider balance at cost, no cash moves; one transaction type per source | DONE (uncommitted) — `EXPENSE_INVENTORY` / `EXPENSE_KATSH` / `EXPENSE_IPICK` / `EXPENSE_WHISH_APP`; v193; void/refund restores stock + batches / provider drawer (`ExpenseRepository.stockUse.test.ts`). Not done: web e2e, IMEI-tracked products (refused) |
| LIRA-263 | Maintenance client number lost | Test the full workflow and fix | DONE — link dropped at the first re-save of a job (draft edit / In progress); kept now through payment, receipt shows the customer. Follow-ups: web route envelope (HTTP 200), typed save payload |
| LIRA-264 | Return-change autofill + both currencies | "All in $" / "All in LBP" buttons; remaining and change always shown as "$ \| LBP" with thousands separators | DONE |

Also from the production test: **G40** — voided supplier history rows read "Unpaid" and still took manual payments in the FIFO; now "Voided", excluded (DONE). **G41** — desktop backdated expense lost its time (schema key missing); fixed (DONE).

**What users will notice:** a warning when a price is changed from its saved price; Exchange opens on USD → LBP; one-tap "All in $ / All in LBP" change buttons and the remaining amount in both currencies; a repair job keeps its customer through payment; voided transfers show as "Voided" on the Suppliers page; on the Expenses page you can search any inventory item or Katsh / iPick / Whish App product and record using it for the shop — it comes out of stock (or the provider balance) at its cost, with no cash moving. (Katsh partial change to be added when done.)

### Follow-up decisions (owner, 2026-10-06/07, after the mock-up review)

- **Keep change button removed** (payment form, all pages that record kept change): handing back less than
  the change due is kept as shop profit automatically, with a green "Keeping $X | Y LBP as profit" note;
  nothing blocks Pay. Alfa Gift and walk-in OMT/Whish SEND on Services now record kept change too. Pages
  whose backend can't record kept change keep the red warning (follow-up): Expenses, Loto settlement, Hold
  Money, top-ups, supplier settle, Debts cash-out, Services RECEIVE. Debts repayment: the unreturned part
  is now shop profit (owner: keep the new rule). Stale hook dependencies fixed on Recharge/Services so a
  previous kept amount can't leak into the next sale.
- **Maintenance phone** (LIRA-263 follow-up): the phone field is what gets saved; nothing picked from the
  search → the client is matched by phone (not name), a new phone creates a new client; a phone with no
  name is kept on the job itself (migration v194, `maintenance.client_phone`).
- **Exchange kept change** shows on the Profits "Kept change (other)" line, not inside the Exchange row
  (total unchanged); gated by the partner coverage ratio like its neighbours (owner chose option 1).
- **CLAUDE.md rule 26** corrected: only the SMS transfer fee is an automatic expense; Line_Usage is
  operator-entered and stays visible.

**What users will notice (follow-ups):** the Keep change button is gone — less change handed back is kept
as profit automatically and the form says so; a repair job keeps the phone you type; Exchange kept cents
appear under "Kept change" on the Profits page.

---

## LIRA-265: add missing Whish App catalog items — URGENT — NEEDS ITEM LIST

| Field    | Value                                        |
| -------- | -------------------------------------------- |
| Epic     | Recharge / catalog (Whish App)               |
| Type     | Feature / data                               |
| Priority | **URGENT** (owner, 2026-10-07)               |
| Status   | NEEDS ITEM LIST from owner                   |
| Modules  | recharge (Whish App catalog items)           |

### Summary

Owner request (2026-10-07): "add missing items and Whish App bills". Interview 2026-10-07 clarified:

- "Bills" means the Whish App **items** shown under the Recharge page's Whish App "Bills" tab (FinancialForm
  over `mobile_service_items` provider `WHISH_APP`), not utility bill payments. Utility bills are NOT wanted now.
- Missing items are in the **Whish App catalog grid** only.
- Each item has a cost and a sell price, exactly like iPick / Katsh items (no "fee").

Where items live today: table `mobile_service_items` (provider `WHISH_APP`), seeded once from the static
catalog `frontend/src/data/mobileServices.ts` (WHISH_APP block, 34 priced items: Alfa and MTC prepaid cards and
vouchers) only when the table is empty; existing shops only get catalog changes through a migration. The owner
can already add/edit Whish App items by hand in Settings → Mobile Services.

Next step: owner sends the list of missing items (category, label, cost, sell — a screenshot of the Whish App
catalog is fine). Then: add them to the static catalog (new shops) AND a migration inserting them for existing
shops (`INSERT OR IGNORE` on the UNIQUE(provider, category, subcategory, label) key, never overwriting prices a
shop edited).

### Acceptance (to finalise after the interview)

- [ ] Missing Whish App items in the static catalog (new shops) and in a migration for existing shops,
      without overwriting prices a shop edited.
- [ ] Items visible and searchable in the Whish App grid, sold with the existing cost/sell flow (no new money path).
- [ ] Release note line.

---

## LIRA-266: kept change built once, used by every payment page — HIGH — DONE

| Field    | Value                                                                 |
| -------- | --------------------------------------------------------------------- |
| Epic     | Payments / Posting integrity                                          |
| Type     | Feature + bug fixes (POSTING_MAP G42, G43, G44)                       |
| Priority | High                                                                  |
| Status   | DONE (2026-10-07)                                   |
| Modules  | pos, maintenance, sessions, debts, custom_services, expenses, omt_whish, recharge, hold money, refunds |

### Owner decisions (2026-10-07)

- One "who pays" setting on the payment form (`payer`: customer / payout / shop) and one server check
  (`resolveKeptChange`, `packages/core/src/repositories/keptChange.ts`) that every module calls.
- Customer pays: change not handed back = shop profit. Payout: handing out less (under $1 / 100,000 LBP, same
  currency) = shop profit. Shop pays an outsider (Expenses): change not returned is added to the cost.
- Kept profit lives in the transaction's own profit stamp. Partner transactions: kept refused (exact amount).
- Debts credit cash-out clears to 0. Expenses get a Bill amount field. Hold Money pickup and refunds keep change too.
- Supplier payment void also removes its bundled discount (same as Partners).
- iPick self-charge books no supplier entry — confirmed correct.

### What users will notice

On every payment screen, kept change now behaves the same way and is checked by the server: a round payout a
little under what's owed keeps the cents as profit; at checkout, kept change that doesn't match the money paid is
refused; on Expenses you type the bill and the cash handed, and change not returned is added to the expense; a
Debts cash-out of $101.12 paid with $101 clears the credit and shows $0.12 as profit. Refunding a cash sale or debt payment, you can hand back a round figure and the small leftover shows as profit. Voiding a supplier payment that had a discount now puts the supplier back to the full amount owed (payments recorded from now on).

### Open follow-ups

- Hold Money pickup profit is not read by the Profits page or Closing yet (ProfitRepository buckets).
- Owner answers 2026-10-07 (interview): no server-side "payment adds up" check on every sale (the screen already
  blocks underpaid sales); a basket with a partner item MAY keep change as profit; two-currency Hold Money pickup
  keeps a leftover per currency with NO cap; overpaying a payout stays as today (server refuses, no on-screen block);
  a custom service with no selling price means the cashier types the price on the spot — the payment waits for it
  (never charges the cost); kept change on refunds of ALL modules (LIRA-272 → do); a legs-only debt repayment reduces
  the debt by money in minus change back.

---

## LIRA-268: Binance profit invisible on the Profits page — MEDIUM — DONE

Found 2026-10-07 by the payouts agent. A Binance transaction's profit stamp has no commission term because
`fs.currency` is USDT, and the Profits Overview shows neither its commission nor its kept change. Kept change is
stamped and voids correctly, it just never appears. Fix the USDT bucketing so Binance profit counts.

What users will notice: Binance fees and kept change now appear on the Profits page (as US dollars), including past days; Binance amounts also count in revenue. Still open: Commissions tab excludes Binance; Binance payment-method fees not counted.

---

## LIRA-269: discount on Binance / app RECEIVE payout sheets is refused — MEDIUM — DONE

Found 2026-10-07. On the Crypto and OMT/Whish App RECEIVE payout sheets a discount lowers the sheet's target,
while the server still pays out the full amount, so the payout is refused. Align the target the sheet shows with
what the server pays.

What users will notice: On Binance cash-out and OMT/Whish App receive, a discount lowers the shop's fee and the customer is paid that much more; the payout goes through. SEND side fixed too (OMT/Whish App and Binance sends with a discount; Services page discount box removed).

---

## LIRA-270: session checkout posts stale payment lines on a zero-net basket — HIGH — DONE

Found 2026-10-07 by the sessions agent (probed). When nothing is left to collect, the payment input unmounts but
`paymentLines` is not cleared, so a stale `IN CASH $105` leg is still sent and posted. The server does not catch it
because no kept change is claimed. Clear lines on unmount and refuse legs on a zero-net basket server-side.

What users will notice: If a payout covers the whole basket, the checkout records no customer payment, even if one was typed before the payout was added.

---

## LIRA-271: session fee-on-top rule differs between client and server — MEDIUM — DONE

Found 2026-10-07. The server's fee-on-top rule (WHISH fees, `isFeeOnTopReceiveItem`, batch sub-items) differs from
the client's (`omt_system`/`whish_system` only, `omtFee`, top-level formData). It used to skew only the drawer
split; with the new kept-change check it can refuse an honest kept claim. Make one shared definition.

What users will notice: A basket with an OMT receive no longer adds the OMT fee to what the customer pays; one shared fee rule (`utils/sessionFeeOnTop.ts`).

---

## LIRA-272: kept change on refunds of other modules — HIGH — DONE

Found 2026-10-07. Refund kept change works for SALE and DEBT_REPAYMENT refunds only. For OMT/Whish, recharge,
custom services, maintenance and Loto, the Profits page drops the refunded row and never reads its REFUND row, so
kept profit there would be invisible; the server refuses kept on those refunds for now. Extending needs a
ProfitRepository change. Owner to decide whether to extend.

What users will notice: The Transactions page refund window offers to keep small change on refunds of transfers, recharges, custom services, repairs and Loto tickets (cash or wallet); it shows on Profits under Kept change. Kept change on a refund counts on the day the refund was made — in Overview, By Date, By Cashier/Client and that day's close.

---

## LIRA-273: undoing a session item refund leaves Profits at the refunded level — MEDIUM — DONE

Found 2026-10-07 (pre-existing, no kept change involved). The REFUND_UNDO row is not counted by
`ProfitService.getSummary`, so after Undo refund the Profits total stays as if the refund still stood. Same for a POS per-item refund's undo (measured: gross 13.12 → 3 after refund, still 3 after undo).

## LIRA-267: email sign-up links and invitations (web app) — IN PROGRESS

Spec, plan and tasks: `specs/267-email-invite-signup/`. Branch `267-email-invite-signup`.

- Stage A (built, not deployed): admin invitations from the Tenants page, self-serve sign-up by email behind Cloudflare Turnstile and rate limits, email outbox with retries, `tenants.contact_email` (one shop per email).
- Done 2026-10-07: Spacemail mailbox `mail@liratek.shop`, MX/SPF/DKIM/DMARC in Cloudflare (Gmail: all PASS), SMTP ports 465/587 open from Fly, SMTP transport built.
- Stage A deployed 2026-10-07: email live over SMTP, a real admin invite was delivered and its sign-up link worked (T042 passed). Turnstile is NOT configured (owner decision), so self-serve stays off.
- Stage B (built on branch `267-stage-b`, not deployed): the shared invite code is removed; sign-up is only through an emailed invite link. The login page's Sign up link shows only when self-serve is on. A wrong SMTP password is now caught at startup and switches email off. After deploy the owner runs `yarn api secrets unset SIGNUP_INVITE_CODE` (T045).

**What users will notice:** on the web app, sign-up no longer uses an invite code: new shops join through an email invitation link from LiraTek. The platform admin can email invitations and see whether they were used.

## LIRA-275: "Forgot password?" on the login page (web app) — DONE (deployed 2026-10-07, commit 713634ea)

Built 2026-10-07 (feature C of `docs/plans/todo_plans/SELF_SERVE_SIGNUP_AND_GOOGLE_PLAN.md`, contract C): `/api/password-reset/forgot|check|reset`, core `PasswordResetService`, `password-reset` email template, `/#/forgot-password` and `/#/reset-password` pages, "Forgot password?" link on the web login page. Decided by the v196 foundation: option (a), `users.email`; mail goes only to a VERIFIED email (owner to confirm). No Turnstile: per-IP limit (5/hour) + per-user limit (3/hour) instead. Web e2e `lira-web-040` written, not yet run.

Owner request 2026-10-07. The email capability now exists (LIRA-267: Spacemail SMTP, `email_outbox`, templates, retries).

- A **Forgot password?** link on the web login page. The user enters their email; if it belongs to a user, we email a single-use, time-limited reset link; the response is the same whether or not the email exists (no enumeration). Behind Turnstile + rate limits, like the self-serve sign-up request.
- **Prerequisite:** users have no email today. `tenants.contact_email` exists (one per shop), `users` has only a username. Decide first: (a) add `users.email` (unique per tenant or globally?) and a way to set/verify it, or (b) for now, reset only the shop's first admin through `tenants.contact_email`.
- Usernames are unique per shop, not globally, so the link must also carry which shop (realm) the user belongs to.
- Reuse: `generateToken`/`hashToken` (store only the hash), the outbox worker, the template renderer, `/#/…` hash-route links.
- Web-only (desktop has no email and no reset flow) — record the exception like LIRA-267.

**What users will notice:** a "Forgot password?" link on the web login page that emails a link to choose a new password, for users whose email is confirmed. Choosing a new password signs that account out everywhere.

## LIRA-276: reset password from Settings by email (web app) — DONE (deployed 2026-10-07)

Endpoint built 2026-10-07 on branch `auth-c`: `POST /api/password-reset/send/:userId` (admin of that shop; refuses `USER_HAS_NO_EMAIL`, `EMAIL_NOT_VERIFIED`, `EMAIL_NOT_CONFIGURED`, `RATE_LIMITED`, `NOT_FOUND`) and `sendPasswordReset(userId)` in `backendApi.ts`. The Settings → Users button is feature B's.

Owner request 2026-10-07. Today an admin can already set a user's password directly (`PUT /api/users/:id/password`). This ticket adds the email route:

- In Settings → Users, an admin can send a user a **reset link by email** instead of typing a new password for them.
- A signed-in user can change their own password from Settings (check what exists today before building).
- Same prerequisite as LIRA-275: users need an email address. Build LIRA-275's token + email path once and reuse it here.

**What users will notice:** in Settings, admins can email a password-reset link to a user.

## LIRA-277: email deliverability — tighten DMARC (ops) — IN PROGRESS (owner doing it 2026-10-07)

Context: `mail@liratek.shop` (Spacemail) passes SPF, DKIM and DMARC in Gmail, but the domain is new, so the first emails (including the first invite) landed in **Spam**. That is reputation, not configuration.

- **Now (owner):** in Gmail, mark LiraTek emails "Not spam", reply to one, and send a couple of normal emails to `mail@liratek.shop`. Use the mailbox normally for about two weeks.
- **≈ 2026-10-21, if invites land in the Inbox:** in Cloudflare → `liratek.shop` → DNS → edit the TXT record `_dmarc` from `v=DMARC1; p=none; rua=mailto:mail@liratek.shop` to `v=DMARC1; p=quarantine; rua=mailto:mail@liratek.shop`. Check with `dig +short TXT _dmarc.liratek.shop`, then send one invite to Gmail and confirm DMARC still says PASS.
- Correction 2026-10-07: tightening does not need the warm-up. DMARC only acts on mail that FAILS SPF/DKIM, and all LiraTek mail passes, so `quarantine` can go in now (owner chose to do it now). The warm-up still matters for inbox placement.
- Later (optional): `p=reject` once `quarantine` has run cleanly for a few weeks.
- No code change; no user-visible change (no release note).

What users will notice: After 'Undo refund', the Profits page and day close return to the pre-refund figures.

---

## LIRA-274: For-Partner transfer in a customer basket was charged twice — HIGH — DONE

Found and proven 2026-10-07. A For-Partner OMT SEND ($100 + $5 fee) in a basket with a $20 walk-in item made the
checkout ask the customer for $125; paying it booked the same $105 as customer cash AND partner debt. A For-Partner
RECEIVE in a basket made checkout refuse. Fix: one shared rule (`utils/sessionForPartnerItem.ts`) — a For-Partner item
contributes 0 to the basket's customer charge on client and server; its partner/supplier postings are unchanged.
Baskets checked out before the fix are not repaired.

What users will notice: Session Checkout asks the customer only for their own items; a For Partner transfer in the
basket shows $0 and goes on the partner's account only.

---

## LIRA-278: self-serve "Create your shop" by email — DONE (deployed 2026-10-07, switched on)

Plan: `docs/plans/todo_plans/SELF_SERVE_SIGNUP_AND_GOOGLE_PLAN.md` (Phase 1). `/signup` asks for email + optional shop name and emails the same one-time link as an admin invite. On with `SIGNUP_SELF_SERVE_ENABLED=true` in `.env.fly` (no Turnstile, owner decision). Protection: hidden bot-trap field, minimum fill time, 3 requests/hour per email, one daily cap of 20 public sign-ups (email + Google), identical reply in every case; the visitor's shop name is never put in the email. Platform Invitations list has an All/Admin/Self filter. Temporary IP diagnostic on `/signup/request` until `CLIENT_IP_HEADER` is chosen (LIRA-283).

**What users will notice:** on the web app, "Sign up" on the login page opens "Create your shop": enter your email (and shop name if you like) and open the link we email you to finish.

## LIRA-279: users have an email address — DONE (deployed 2026-10-07)

Migration v196: `users.email` + `email_verified_at`, unique per shop. Each shop's admin email = the sign-up email (existing shops back-filled from `tenants.contact_email`, marked verified — owner decision). Settings → Users: add/change a user's email, confirmation link by email, Confirmed / Not confirmed badge. The shop owner's own email is not editable (owner decision).

**What users will notice:** in Settings → Users, each staff member can have an email address, confirmed by an emailed link.

## LIRA-280: Continue with Google — DONE, switched ON 2026-10-07

Built 2026-10-07 (Phase 3 of the plan). Central Google flow on `www.liratek.shop` with a 60-second one-time hand-off to the shop's own address; accounts linked by Google ID only; existing users connect Google from Settings only; Google sign-up still sets a password and is always allowed once Google is configured, counting toward the daily cap (migration v197 `tenants.google_signup_at`). Off until `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are in `.env.fly` (owner setup: `docs/DEPLOYMENT.md` §5b-google).

Switched on 2026-10-07: Google Cloud project "Liratek", OAuth client "LiraTek web" (origin `https://www.liratek.shop`, redirect `/api/auth/google/callback`), consent screen published (privacy `liratek.shop/privacy`, terms `liratek.shop/terms`); keys in `.env.fly`. Owner verified on test.liratek.shop.

**What users will notice:** on the web app, "Continue with Google" on the login page signs you in; "Connect Google" in Settings links your account first. New shops can also be created with Google. Signing in with your username and password still works.

**One Google account = one shop (owner decision 2026-10-07).** "Connect Google" refuses an account already connected to any user in any other shop (`GOOGLE_ACCOUNT_IN_OTHER_SHOP`, Settings shows `google=in_other_shop`); creating a shop with Google refuses an account connected anywhere (callback `error=already_connected`, re-checked at `POST /signup`); reconnecting the same account to the same user is a no-op. Enforced in `UserIdentityRepository.link` (check + insert in one IMMEDIATE transaction), NOT by a unique index: production already has one account in two shops, which an index could not be built over. Those existing links are kept and still sign in through the shop chooser until one is disconnected. Only LIVE links count (owner decision 2026-10-07): a link to a deactivated user, or in a suspended/archived shop, is ignored (kept, not deleted) by both the Connect check and the sign-up check — one predicate, `LIVE_LINK_FROM` in `UserIdentityRepository`; a 'provisioning' shop still counts. If a dead link revives (shop reactivated) while the account is linked elsewhere, sign-in shows the shop chooser. Per-tenant DB mode: the check only sees every shop in shared mode (same follow-up as `findBySubjectAllTenants`).

**What users will notice (one account = one shop):** on the web app, a Google account can be connected to one shop only; connecting it to a second shop, or creating a new shop with it, explains that it is already connected and how to fix it.

## LIRA-281: invite users to a shop by email — DONE (deployed 2026-10-07)

Settings → Users → "Invite by email" (email + role). The person opens `/#/join?invite=…` on the shop's address and picks their username and password; their email is already confirmed. Pending invitations can be resent or revoked. Lapsed (read-only) shops cannot send invites; an invite opened while the shop is lapsed is refused until renewed (owner decision 2026-10-07, being built).

**What users will notice:** in Settings → Users, "Invite by email" lets you add a staff member or admin; they choose their own username and password from the emailed link.

## LIRA-285: Checkpoint window opens after sign-in again; invites refused while a shop is lapsed — DONE (owner decisions 2026-10-07)

Update 2026-10-07 (owner): instead of one drawer, a single "Checkpoint — all drawers" window lists every visible drawer (General first). Each drawer has its own fields and its own Save (same checkpoint save as the single-drawer window); saved or already-counted drawers show "Counted today ✓" with Re-count; the window stays open until closed. Shown only while at least one drawer is not counted today. The dashboard clipboard icon still opens one drawer.

- After a real sign-in (password or Google, not a page refresh), an admin gets the Checkpoint window for the first drawer not counted today (General first), when checkpoints are on. Once per sign-in; closing it does not reopen it. Skipped right after the setup wizard (it has just counted every drawer). Per-drawer check, not the old "anything counted today" check.
- A user invite opened while the shop's subscription has lapsed (read-only) is refused with "This shop is not active right now. Ask the shop owner to renew, then use the link again." The invite is kept, so the same link works after renewal, before it expires. Grace-period shops still accept invites.

**What users will notice:** after signing in, the Checkpoint window opens for any drawer not counted today; invites into a lapsed shop ask the owner to renew first.

## LIRA-296: warranty for any item, not just phones — P1 + P2 + P3 DONE, not yet released (owner request 2026-10-10; decisions D1–D4 2026-10-10)

Spec: `specs/296-warranty-any-item/`. Plan: `docs/plans/done_plans/WARRANTY_ANY_ITEM_PLAN.md`. Migration v205 (P1).

- **P1 DONE (local commit, not pushed):** one receipt number `RCP-<sale id>` (core `receiptNumberFor`/`parseReceiptNumber`); one warranty-state helper (core `warrantyState`, replaces `computeWarrantyStatus` + the frontend copy); v205 (`product_categories.warranty_months`, `sale_items.warranty_months`/`warranty_set_by`, `idx_sale_items_warranty_until`); warranty search (`WarrantyRepository`/`WarrantyService`, IPC `warranty:search`, REST `GET /api/warranty/search`, adapter `searchWarranties`, `/warranty` page + sidebar); state on every sale line incl. partial refunds; category default + till edit (`resolveWarrantyMonths`, `client_day` starts the clock, rule 27); warranty terms setting + receipts; side fixes SF-1 (web recent-sales day), SF-2 (`GET /api/sales/by-date-range` + `getSalesByDateRange`), SF-3 (receipt header prints).
- **P2 DONE (local commit, not pushed):** migration v206 (`warranty_claims`, `defective_items`, maintenance/consumption/unit warranty columns); `WARRANTY_COST` type (no legs, `is_auto`, NON_REVERSIBLE, posting rule); `refundSaleItem({ restock: false })` + claim-owned undo; `WarrantyService.createClaim` (REPAIR/REPLACE/REFUND, guards), `voidClaim` (nets every ledger to 0 — `voidNetsZero.test.ts`), `resolveDefective`; warranty jobs free + cost booked once at delivery (`notWarrantyJob`); Profits "Warranty cost" line (totals, detail, By Date/By Cashier, Overview card); IPC + REST + adapters for claims/defective; ClaimModal / ClaimHistory / DefectiveItems; repair warranty (months, stamped at Delivered_Paid from `client_day`, on the receipt, in the search, claimable).
- **P3 DONE (local commit, not pushed):** migration v207 (`product_categories.serial_label`/`serial_required`, `supplier_returns` with the links its outcome wrote); serial label through every layer (Settings, cart picker, checkout receipt, sale details + reprint via `getSaleItems.serial_label`, product form units section; core `serialLabelFor`); a sale without the unit: BLOCK → `code: SERIAL_REQUIRED`, WARN → `warnings[]` + a till warning; supplier returns (`SupplierReturnRepository`, `WarrantyService.createSupplierReturn/closeSupplierReturn/listSupplierReturns`; CREDITED = paper ADJUSTMENT −credit + `WARRANTY_COST` +credit per currency, REPLACED = restock batch + +cost, REJECTED = back to HELD; `voidClaim` undoes closed returns and refuses an open one); warranty report (`WarrantyReportRepository`, `WarrantyService.report`, net = −Profits "Warranty cost"); IPC + REST + adapters; `SupplierReturns.tsx`, `WarrantyReport.tsx`, "Send to supplier" in Defective items.

**What users will notice (P3):** categories can call their serials "Serial" or "IMEI" and choose to block or only warn when an item is sold without its serial; faulty items can be sent back to the supplier and the supplier's credit, replacement or rejection recorded; a Warranty report shows what is still under warranty and what claims cost versus what suppliers gave back.

**What users will notice (P2):** from a found warranty, staff start a repair claim and admins a replacement or refund; faulty items are held aside until written off or found not faulty; Profits shows one "Warranty cost" line; repairs can carry their own warranty, printed on the repair receipt.

**What users will notice (P1):** a Warranty page finds any item sold with a warranty by customer, phone, receipt number, product or serial; sale details show Covered / Expired / Void on every warranty item (with "1 of 3 refunded"); categories have a default warranty and the cashier can change it per item at the till; your warranty terms and receipt header print on receipts; one receipt number per sale; on the web, the POS recent-sales list shows the day you pick.

### Before P1 (original ticket)


Plan: `docs/plans/done_plans/WARRANTY_ANY_ITEM_PLAN.md`.

- **Already there (LIRA-143):** `products.warranty_months` on ANY product, stamped as `sale_items.warranty_until` on every completed sale line, printed on the receipt.
- **Missing:** looking a warranty up and acting on it without an IMEI. Gaps G1–G8 in the plan: find by customer / phone / receipt (G1), serial numbers for non-phone items (G2), warranty state on every sale line (G3), claim flow — repair / replace / refund (G4), supplier RMA (G5), per-category default + per-line edit + terms on receipt (G6), warranty on repairs (G7), warranty report (G8).
- **Blocked on owner decisions D1–D4** (claim cost in Profits, replacement warranty, which categories require serials, scope order). Suggested first slice: G1 + G3 + G6.

**What users will notice (when built):** warranty works for any item — chargers, earbuds, laptops and repairs, not only phones — and staff can find and handle a warranty claim without the IMEI.

## LIRA-295: web app has no UI scale — the browser's zoom is the scale (desktop keeps it) — DONE, not yet released (owner decision 2026-10-09)

- **Bug:** on the web, UI Scale set CSS `zoom` on `<html>`. Chrome multiplies every viewport-height size (`h-screen`, `max-h-[90vh]`) by it, so at 125% the bottom of each page and modal fell below the window and the `h-screen overflow-hidden` shell (LeftPanelLayout / HomeViewLayout) would not scroll to it.
- **Decision:** browsers already zoom properly (Ctrl/⌘ + / −), the desktop app cannot, so the setting is desktop-only. `applyUiScale` on the web only removes a CSS zoom an older build may have left; a saved `ui_scale` is ignored. My account → Display shows "use your browser's zoom" on the web; desktop keeps UI Scale (Electron zoom factor).
- **Tests:** `uiScale.webFixed.test.ts` (2 web cases proven failing-first against the old code; a first draft that read back `style.zoom` passed vacuously — jsdom drops `zoom` — and was rewritten to spy), `MyAccount.test.tsx` (web hides UI Scale and shows the hint; desktop keeps it), `lira-web-044` (a saved 1.25 is not applied). Also aligned `lira-web-044`'s LIRA-291 staff test to the redesigned "Sign-in options" panel (96d1ff86).
- **Later (owner):** POS layout at large scale (product grid sized to its panel, flexible cart width, card overflow, sidebar reachable above the parked-sale chip, "1 item").

**What users will notice:** in the web app, pages and pop-ups no longer get cut off at the bottom when zoomed; use your browser's zoom (Ctrl + / Ctrl −) to make things bigger. The desktop app keeps its UI Scale setting in My account.

## LIRA-294: Google profile photo as the account picture (web only) — DONE, not yet released (owner request 2026-10-08)

Migration v204: `user_identities.picture_url TEXT NULL`.

- **Scope:** the Google request asks `openid email profile` (was `openid email`), so the ID token carries `picture`; `verifyIdToken` passes it through `safeGooglePictureUrl` (core `utils/googlePicture.ts`, pure: https only, host `*.googleusercontent.com`, no credentials/port, ≤ 2048 chars, else null) and types it on `GoogleIdentityClaims.picture`. DEPLOYMENT.md §5b-google: add `profile` to the consent screen.
- **Stored per Google link:** set on link (`linkIdentity` / repository `link`, a repeat link refreshes it), on Join with Google (`acceptWithGoogle`), on the Google sign-up link step (the signup ticket carries `picture`), and refreshed on every Google sign-in (`refreshPicture` in each shop the account opens, via `UserIdentityRepository.setPicture`). Disconnect deletes the row, so the photo goes with it.
- **Exposed:** `GET /api/auth/google/link` (`GoogleLinkView.pictureUrl`), and the session user from `POST /api/auth/login` (incl. the Google hand-off exchange, same helper) and `GET /api/auth/me` (`accountPictureUrl`) — `pictureUrl: string | null`, types from core (`AccountPicture`, `GoogleLinkView`).
- **UI:** `AccountAvatar` — the photo in a circle the same size as the icon (top bar My account link, `object-cover`, `referrerPolicy="no-referrer"`, alt "My account"), falling back to the icon on null or load error; larger in My account → Profile. Desktop unchanged (no Google link → icon).
- **CSP:** `frontend/index.html` `img-src 'self' data: https://*.googleusercontent.com` (nothing broader). `vercel.json` and `middleware.js` set no CSP.
- **Tests:** not proven failing-first (owner-chosen order: production code first).

**What users will notice:** on the web app, people who sign in with Google see their Google photo at the top and in My account, from their next Google sign-in.

## LIRA-293: change your own password and your own email — DONE, not yet released (owner-approved 2026-10-08)

Migration v203: `email_verification_tokens.purpose` ('verify' | 'change', default 'verify').

- **Change password (both transports):** `AuthService.changePassword(userId, current, new, { keepSessionToken })` — refuses `PASSWORD_NOT_SET` (has_password = 0) and `WRONG_PASSWORD` (generic), applies the ONE password rule, writes through `updatePassword`, then signs out every OTHER session (`revokeOtherSessions`) and keeps the caller's. Core `changeOwnPasswordSchema` (validators/account.ts, + `ChangeOwnPasswordInput`); the unused `changePasswordSchema` (min 6) is retired. Web: `POST /api/password-reset/change` (authenticateJWT → admin|staff, impersonation 403, per-user limiter 5 failures / 15 min keyed on shop + user, counting every non-success; `PASSWORD_CHANGE_RATE_LIMIT_MAX`), `password-changed` notice (no link) to a CONFIRMED email when email is on (`PasswordResetService.notifyPasswordChanged`), audit "Changed own password". Not subscription-gated (account safety). Desktop: IPC `auth:change-own-password` (validatePayload, user from the session guard, own token from the encrypted session file; unresolvable token → nothing revoked), audit; no email and no attempt limit on desktop. Adapter `changeOwnPassword` (`ipcOrHttp`). UI: `ChangePasswordForm` in Sign-in methods when hasPassword (the panel now shows even with Google sign-in off), and as its own section on desktop.
- **Change email (web only):** `UserEmailService.requestOwnEmailChange` — refuses EMAIL_UNCHANGED / EMAIL_TAKEN_IN_SHOP (`UserRepository.isEmailTakenInShop`) / EMAIL_NOT_CONFIGURED / RATE_LIMITED (the shared 3 links per user per hour); burns open links, issues a `change` link to the NEW address (verify-email template, same `issue`), queues `email-change-notice` (new address masked, `maskEmail`) to the OLD confirmed address. Opening the link: `verify` applies the address confirmed (`setEmail`), refuses if another user took it meanwhile, then re-syncs the sign-in directory (existing path). `POST /api/user-email/me/change` (admin|staff, impersonation 403), exempt from the read-only subscription gate. UI: Profile → Change email → "Check your inbox".
- **Tests:** `changeOwnPassword.api.test.ts`, `userEmail.selfChange.api.test.ts`, `AuthService.test.ts` (changePassword), `authHandlers.changeOwnPassword.test.ts`, gate test, `ChangePasswordForm.test.tsx`, `GoogleAccountPanel.test.tsx`, `MyAccount.test.tsx`, lira-web-045. Not proven failing-first (owner-chosen order: production code first); a partial pre-code run of the 4 backend files showed 28 failed / 54 passed.

**What users will notice:** in My account, anyone with a password can change it (web and desktop app); other devices are signed out and, on the web, an email confirms it. On the web you can change your own email: a link goes to the new address, the email changes once it is opened, and the old address is told.

## LIRA-292: My account — profile, display preferences, desktop link — DONE, not yet released (owner-approved 2026-10-08)

No DB change.

- **Display (this device):** the per-browser preferences (`layout_mode`, `home_columns`, `pos_show_images`, `pos_autofill_payment`, `ui_scale`) moved out of Settings → Shop Config into `features/account/components/DisplayPreferences.tsx` (the one copy), shown on My account for every role. Same storage keys and window events (`layout-mode-changed`, `pos-display-changed`, `saveAndApplyUiScale`), so nothing resets. Shop Config keeps only shop-wide settings and says "Display options moved to My account" with a link. `voicebot_enabled` is also per-browser but is saved by Shop Config's Save button; left there (follow-up candidate).
- **Profile (read-only):** username and role (auth context), shown together beside the account picture; on web, email and verification status appear in the separate Account email row. No route returned the caller's own email (`/api/auth/me` deliberately skips the users table; `GET /api/user-email` is admin-only), so `GET /api/user-email/me` (admin|staff, user from the JWT) + `UserEmailService.getOwn` + adapter `getMyEmail` (answers `null` on desktop without a call). Desktop shows username and role.
- **Desktop:** the top-bar My account link now shows on desktop too. There the page shows Profile and Display only; Sign-in methods and Signed-in devices are rendered on the web only (desktop admins keep Settings → Signed-in Devices).
- **Wording:** the Google "no account" message now says "connect Google in My account".
- **Tests:** `MyAccount.test.tsx`, `ShopConfig.displayMoved.test.tsx`, `TopBar.myAccount.test.tsx` (desktop case inverted), `userEmail.api.test.ts` (GET /me), lira-web-044 (staff changes UI scale on My account).

**What users will notice:** staff can set their own screen display (navigation style, items per row, POS display, auto-fill payment, UI scale) in My account; Settings → Shop Config points there. My account leads with a compact account picture, username and role, with the account email underneath when one is set, and follows the same page spacing as the rest of the app. On the web, email and sign-in controls appear in their own rows. My account is now in the desktop app too.

## LIRA-291: sign-in methods for users who joined with Google — DONE, not yet committed (owner decisions 2026-10-08)

Found during the LIRA-288 production checks. Spec: `specs/291-signin-methods/`. Web only, except the shared password rule.

- **Flag:** migration v202 adds `users.has_password INTEGER NOT NULL DEFAULT 1`. Only `UserInvitationService.acceptWithGoogle` creates a user with 0; `UserRepository.updatePassword` (the one shared password writer) sets it back to 1. Back-fill: 0 only for a Google join (`audit_log` `via = 'invite_google'`) with no later "Password reset by emailed link" / "Changed user password" row and no used reset token.
- **Own disconnect:** `GoogleAuthService.assertCanUnlink` / `unlinkIdentity` refuse `SET_PASSWORD_FIRST` while the user has no password; `DELETE /api/auth/google/link` checks it before the Google on/off check. `GET /link` returns `hasPassword`.
- **Set a password:** `POST /api/password-reset/set-initial` (JWT user only, impersonation refused, `PASSWORD_ALREADY_SET` otherwise). `PasswordResetService.setInitialPassword` keeps Google and sessions and queues a `password-added` notice to a confirmed email. The panel is now "Sign-in methods" with the form, on a new **My account** page (`/account`, ProtectedRoute — every role; owner-approved 2026-10-08) opened from the top bar's person icon (web only). On the web, Settings no longer has a Signed-in Devices tab (one place; desktop keeps it), and the Google link flow now lands on `/#/account?google=…`.
- **Admin disconnect:** `DELETE /api/user-email/:userId/google` then emails a `password-set` link when the user had no password (`passwordLink: sent|not_sent` + code); a failed send never undoes the disconnect. An admin with no password cannot disconnect their own Google there either. UsersManager has a "Sign-in" column (`signinMethodLabel`) and confirm text that depends on the password and email.
- **Wording:** `PasswordResetService.issue` picks `password-set` vs `password-reset` per user; `check` returns `hasPassword`; the reset email heading names the username.
- **Password rule:** any non-letter, non-digit counts as a symbol (core `passwordPolicy.ts`, desktop too); the frontend copy `shared/utils/validatePassword.ts` is deleted. `PasswordInput` (eye toggle, `new-password`) on the reset page, sign-up, Google sign-up, join and Add shop.
- **Login:** a username hint on the shop sign-in page, plus a message when an `@` is typed.

**What users will notice:** Settings → Users shows how each person signs in; everyone has a "My account" page (top bar) for their own sign-in methods and devices; staff who joined with Google can set a password there and can't remove their last way to sign in; an admin disconnecting Google emails them a link to set a password; password emails name the username; show/hide on new-password fields; a username hint on the shop sign-in page; browser-suggested passwords are accepted (desktop app too).

## LIRA-290: one shop per owner email — sign-up says so on the page — DONE, not yet released (owner decisions 2026-10-08)

Found on production: self-serve sign-up emailed a sign-up link to the Gmail that is already the owner (first admin) of cornertech and test. The "already has a shop" check only read `tenants.contact_email`, which is NULL for shops created before sign-up emails existed; the owner's address was on the admin user. Rule (owner): one shop per owner email / Google account; a STAFF member's email may open its own shop. (LIRA-289 was taken by the mobile app ticket.)

- **Data:** migration v201 back-fills a NULL `tenants.contact_email` with the shop's FIRST ADMIN's (lowest-id active admin, `FIRST_ADMIN_WHERE`) confirmed email, lowercased; never overwrites; skips unconfirmed; skips an address another shop already holds (unique index), lowest shop id wins — so of cornertech/test only the older one gets it, and the other is still blocked through it. `down()` is a documented no-op (a back-filled row cannot be told from one sign-up wrote). Shared mode only; per-tenant mode is filled by `signinDirectoryCli --write` (`ShopContactEmailService.backfillAll`).
- **Ongoing:** `ShopContactEmailService.fillFromFirstAdmin(tenantId)` (fill when NULL, never overwrite, never throw) runs from the sign-in directory sync, which every writer already calls after its commit: email set/verify, Google link, invite accept, role/active changes, shop provisioning.
- **Check:** ONE predicate, `SignupInvitationService.findShopOwnedByEmail` — self-serve request, admin invite, Google callback (`error=email_has_shop`, before the form) and Google `POST /signup` (pre-check + unique index; now 200 + `code`, was a thrown 400).
- **UX:** `POST /api/auth/signup/request` answers an owner email with 200 `{success:false, code:"EMAIL_ALREADY_HAS_SHOP", error:"This email already has a LiraTek shop."}` and queues nothing (shop never named; bot checks and rate limits still answer first/generically). The sign-up page shows it under the email field with "Sign in instead →"; the Google landing page and Google sign-up form show the same. Spec 267 FR-028 notes the exception.

**What users will notice:** on the web app, sign-up tells you right away when an email already has a LiraTek shop, with a link to sign in, instead of emailing a sign-up link (also with Google).

**Owner, after deploy (per-tenant mode only):** `yarn api ssh console -C "node dist/scripts/signinDirectoryCli.js --write"` also back-fills shop contact emails. Shared mode is done by v201.

## LIRA-288: Google sign-in for every user, scoped per shop + platform sign-in directory — DONE, not yet released (owner decisions 2026-10-08)

Spec: `specs/288-per-shop-google-signin/`. Rule change: **one Google account = one user per shop** (replaces LIRA-280's "one Gmail = one shop"; the schema's `UNIQUE(provider, subject, tenant_id)` + `UNIQUE(user_id, provider)` are the whole rule; `isLinkedToAnyShop` / `LIVE_LINK_FROM` / `findBySubjectAllTenants` / `findSigninAccountsByEmail` deleted; `GoogleAccountInOtherShopError` kept deprecated for one release). New PLATFORM table `signin_directory` (v200, back-filled in shared mode): one row per confirmed email / Google link of an active non-super-admin user, shop status applied at read time (`DIRECTORY_USABLE`: `active` only). Kept in step by `SigninDirectoryService.syncUser` after every writer (email set/verify, Google link/unlink, invite accept, deactivate/reactivate/role, shop provision → `syncTenant`, shop delete → `deleteForTenant`); never throws. www readers (email code, www forgot password, www Google) read only the directory, so they work in per-tenant mode; Google on a shop's own address and the chooser re-check read the shop's own records in its own scope (FR-004: a shop with no linked user now refuses with `no_account` instead of going to another shop). "Join with Google" on invites (`POST /api/user-invitations/google/start` → 10-min join ticket → `acceptWithGoogle`: verified Google email must equal the invite email; user + link in one shop transaction; Google-only members get an unusable random password hash). Settings → Users: Google column + admin Disconnect (`DELETE /api/user-email/:userId/google`, audited `google_link.remove {by:"admin"}`). Operator CLI `node dist/scripts/signinDirectoryCli.js [--write]` + a boot drift warning. Web only (desktop has no Google, invites or email).

**What users will notice:** one Google account works in several shops (one user each); staff can use Google; invitations offer "Join with Google"; admins see and can disconnect a user's Google in Settings → Users.

**Owner, after deploy:** run `yarn api ssh console -C "node dist/scripts/signinDirectoryCli.js"` and expect zero differences (SC-005; judge by the exit code — stdout also carries dotenv/migration lines before the JSON).

**Decided 2026-10-08 → LIRA-290 (one shop per OWNER email, contact email back-filled from the first admin).** Was: "one shop per contact email" (LIRA-267, `idx_tenants_contact_email`) still applies to a Google sign-up, so an owner cannot create a SECOND shop with the Gmail that already created their first one (`EMAIL_ALREADY_HAS_SHOP`); a staff member's Gmail (not a contact email) can. Unchanged by LIRA-288.

**Also in this batch (owner-approved 2026-10-08, no ticket of its own):** signing in again on the same browser (password or the Google hand-off) ends the previous session behind the replaced token (best effort, ≤2 s, never touches impersonation). **What users will notice:** Settings → Signed-in Devices no longer fills up with old sessions of the same browser.

## LIRA-287: identifier-first sign-in on www (Slack/Shopify-style) — DONE, not yet released (owner-approved 2026-10-07)

www.liratek.shop becomes "Sign in to LiraTek": (1) remembered shops — after a sign-in on `<slug>.liratek.shop` (password or Google hand-off) the shop's slug + name go in an `lt_shops` cookie on `.liratek.shop` (Lax, Secure, not httpOnly, ≤10 shops, 1 year, no user data), shown on www as "Continue" rows with "Forget this shop"; (2) email → 6-digit code (new `signin-code` email, code scrubbed via `secretKeys`, only `sha256(email:code)` stored in the new PLATFORM table `signin_codes`, v199; 10-min TTL, 5 wrong tries lock a code, a new code burns the old ones, 5 codes/email/hour, 10 requests + 30 checks per IP/hour, one generic reply; mailed only to an email that is a verified active user of an active shop) → "Your shops" (only after a valid code) → `https://<slug>.liratek.shop/#/login?u=<username>` with the username filled in and the cursor in the password — the code never signs anyone in; (3) Continue with Google unchanged; (4) "Create your shop" as its own button. The shop-address field and the "Platform admin sign in" button are gone; super admins sign in at the unlinked `#/platform`. "Forgot password?" on www asks only the email and mails one reset link per shop the email signs in to (localhost/previews still ask for the shop). Connecting Google in Settings now sets `users.email` = the Gmail address (verified) when the user has none and no other user in the shop holds it; migration v198 backfills existing links (cornertech/test admins). Wording: "Sign in" / "Create your shop" everywhere, landing header gets both (AR "تسجيل الدخول" / "أنشئ متجرك"). Sign-up shows "1 Email · 2 Shop details".

Limits: the cross-shop email lookup (codes, shop list, www forgot) only sees every shop in SHARED DB mode, like the Google lookup — per-tenant mode needs a platform email index first. Web only (desktop has no www; same exception as LIRA-267).

**What users will notice:** www.liratek.shop lists the shops you used on this device and lets you find your shops by email with a code, then fills in your username; no more typing a shop address. Connecting Google saves your Gmail as your confirmed email.

## LIRA-286: separate the www front door from each shop's sign-in page — DONE (owner decision 2026-10-07)

www.liratek.shop asks "Sign in to your shop" (shop address → that shop's login), plus Continue with Google, Forgot password, "Create your shop", and a "Platform admin sign in" button for super admins. A shop's own address (e.g. cornertech.liratek.shop) shows only its sign-in (username/password, Forgot password, Continue with Google) — no create-a-shop links — and /signup there goes to www. Invite and Google sign-up links keep working. Detection from signup-status (`platformHost`, `shopName`); localhost, previews and desktop keep the combined page.

**What users will notice:** a shop's sign-in page no longer offers to create a new shop; www.liratek.shop asks which shop you want to sign in to.

## LIRA-282: API rate limit can lock out a shop's tills — HIGH — DONE (owner: per user + clear message, 2026-10-07)

Found 2026-10-07 during the cornertech production test. The API allows 1,000 requests per 15 minutes per IP and one page
load costs about 25–30 requests; the test exhausted it twice (≈11:45 and ≈11:54–12:01 Beirut). Any till sharing that
internet connection then sees "Failed to load data. Tap refresh to retry." with no reason given. A shop with several
tills on one connection could hit this in normal use. Options to decide: key the limit per authenticated user/tenant
instead of per IP, raise the read limit, and show a clear "too many requests, wait a minute" message.

> Owner answers 2026-10-07 (second interview): rate limit per logged-in user with a clear "too many requests"
> message (LIRA-282); Whish App send never charges a fee (confirmed); a For-Partner custom service needs a selling
> price like walk-in; customer baskets opened before the update with a no-price service are left as they are;
> refund kept change lands on the refund day; the $0.10 cornertech test residual is left for the reset.

Built: signed-in traffic limited per user (tenant + user, 200/min, `API_USER_RATE_LIMIT_MAX`); per-IP flood cap 10,000/min (`API_IP_FLOOD_RATE_LIMIT_MAX`) because req.ip is shared by all shops (LIRA-283); login/signup/password limiters unchanged; 429 says "Too many requests — please wait a minute and try again." and the Services page shows it.

What users will notice: on the web app, shops with several tills stop seeing "Failed to load data. Tap refresh to retry." when everyone is busy; if one person ever sends too many requests, only their screen asks them to wait a minute.

---

## LIRA-283: the API sees every visitor as the same address — URGENT — DONE (verified in production 2026-10-08)

Measured 2026-10-07 on production: every session on cornertech records `ip_address = 66.241.124.103` (a hosting
proxy address) while the real client was 185.187.131.199. So `req.ip` behind Vercel → Fly is the proxy, not the shop's
connection, and EVERY per-IP limiter is shared by ALL shops:
- the failed-login limiter (`AUTH_RATE_LIMIT_MAX`, 5 per 15 min by default) — a few wrong passwords anywhere can lock
  every shop's login for 15 minutes;
- the sign-up / invite limiters (`SIGNUP_*`, 5 per hour) — LIRA-267 self-serve sign-up is capped globally;
- the profits-unlock limiter, the anonymous API bucket, and the authenticated flood cap (raised to 10,000/min as a stop-gap in LIRA-282).
Fix: read the real client address safely (Vercel's forwarded-for header, with the right `trust proxy` hop count, and
refusing spoofed headers on requests that reach Fly directly), verify on production what each hop adds, then key the
limiters on it. Check the production values of `AUTH_RATE_LIMIT_MAX` / `SIGNUP_*` first — if they are the defaults,
this is live now. Do not touch X-Forwarded-Host handling (tenant login depends on it).

Status 2026-10-08: the `routes` `request.headers` transform from c02b98ef built "Ready" but production
`/health/client-ip` still said `source:"direct", proxyVerified:false`. Replaced by Vercel Routing Middleware
(`middleware.js` at the repo root, `"proxy"` in `vercel.json`, matcher /api, /health, /socket.io): it deletes any
browser-sent `x-liratek-proxy-auth` / `x-liratek-client-ip`, sets the secret from `LIRATEK_PROXY_SECRET` and the
client from Vercel's `x-real-ip`, keeps every other header (Host left to Vercel), and answers `x-liratek-edge: ok`.
Guards: `scripts/__tests__/vercelMiddleware.test.mjs` (failing-first: ERR_MODULE_NOT_FOUND before middleware.js
existed); the verifier now forges `X-Liratek-Client-IP` and the proxy secret through Vercel too (that test change
NOT proven failing-first). Verified locally: `vercel build` puts the middleware route before the external rewrites;
`vercel dev -L` against a local echo origin delivered the secret and the client IP and dropped the forged copies,
for GET, POST bodies and socket.io polling. NOT verified until a real deploy: that production Vercel applies the
middleware's request-header override on an EXTERNAL rewrite, and that no `x-middleware-*` header reaches the
browser. Owner: `yarn api secrets set CLIENT_IP_HEADER=x-liratek-client-ip`, push, then `yarn api:verify`.

What users will notice: on the web app, wrong-password lockouts and sign-up limits count each shop separately, and
each new sign-in records the shop's own address.

Done 2026-10-08: Vercel Routing Middleware (`middleware.js`, vercel.json `proxy`) strips client-sent
`x-liratek-proxy-auth` / `x-liratek-client-ip`, sets the secret from `LIRATEK_PROXY_SECRET` and the client IP from
Vercel's `x-real-ip`; Fly has `CLIENT_IP_PROXY_SECRET` and `CLIENT_IP_HEADER=x-liratek-client-ip`. Measured after
deploy: `www.liratek.shop/health/client-ip` → the visitor's real IP, `source: vercel`, `proxyVerified: true`;
`x-liratek-edge: ok`; no secret in response headers; tenant login OK; `yarn api:verify` all checks passed (forged
headers on a direct request ignored). The first attempt (`routes` transform, c02b98ef) built but never reached Fly.
The temporary LIRA-278 sign-up header logging is removed.

What users will notice: wrong-password lockouts and sign-up limits count each shop's own internet connection, so one
shop's typos no longer lock other shops out; new sign-ins record the shop's real address.

---

## LIRA-284: "Add category" in Settings → Mobile Services does nothing — MEDIUM — DONE (owner decisions 2026-10-07)

Owner-reported 2026-10-07 on the web app (desktop is the same): Settings → Mobile Services → WHISH_APP → "Category",
type "test", confirm — nothing happens and nothing is saved. Cause: a category has no table of its own; it is only the
`category` text on items, so it exists once an item uses it. The confirm opened a subcategory input inside the new
category's row, which cannot render until the category has an item — a dead end. The Recharge page's inline "+" only
added items to EXISTING categories, so there was no way anywhere to create a new category.

> Owner answers 2026-10-07: any category name is allowed, no warning for alfa/mtc-like names; admins must be able to
> add a new category from the sale screen too.

Built: confirming a new category opens the new-item form with the category filled in and an editable Subcategory
field (saved with its first item). Recharge page (`KatchForm` for iPick/Katsh, `FinancialForm` for WHISH_APP): admin
"New category" button under the cards, using one shared inline form (`NewServiceItemInlineForm`) and one payload
builder (`buildNewServiceItemPayload`, `utils/catalogNames.ts`). Typed category/subcategory names reuse an existing
spelling on a case-insensitive match (`resolveCatalogName`), because `parseCarrierKey` lowercases while
`KatchForm.isTelecomVoucher` compares exactly. Settings now refreshes the shared `MobileServiceItemsContext` after
every create/edit/delete/toggle (it loaded only at login, so Settings changes did not reach the Recharge page until a
reload). Guards: `MobileServicesManager.addCategory`, `FinancialForm.newCategory`, `KatchForm.newCategory`. Failing-first,
honestly: on the unfixed code the Settings tests failed at the missing Subcategory field and the FinancialForm tests at
the missing button — that proves the dead end, but the spelling-reuse and catalog-refresh assertions were never reached
on old code. The KatchForm tests failed first only because they did not wait for "Loading items...", so they are NOT
proven failing-first, and the non-admin guard was never seen failing. Not run: web/desktop e2e and a real-app click-through. Not done: the hand-written `createMobileServiceItem` payload
types in `backendApi.ts` / `ApiAdapter` (rule 21 debt, pre-existing).

What users will notice: "Category" in Settings → Mobile Services now works, admins can add a new category from the
Recharge page, and Settings changes show on the Recharge page without a reload.


---

## LIRA-289: Mobile app — owner records and tracks digital sales from the phone, including after closing — IN PROGRESS (owner decisions 2026-10-08; build started 2026-10-10)

Origin: a web-app customer gets requests after the shop is closed (Whish App transfers, iPEC/Katch vouchers) and does
them from his phone. He wants to record and track them in LiraTek from the phone, outside the shop. The mobile app is
also meant to be the main selling point of the system: "run your shop's digital sales from anywhere". Big feature
(web + backend + core, new day-boundary rule) — goes through Spec Kit as `specs/289-…`.

> Owner answers 2026-10-08:
> - **Scope = flows with no physical hand-over.** In: WHISH_APP / OMT_APP transfers, iPEC/Katch vouchers, MTC/Alfa
>   recharge if doable from a phone, maybe Binance. Out: OMT/Whish counter services, exchange, POS, maintenance —
>   anything that gives out cash or an item.
> - **Payment:** the owner picks per transaction — customer account (debt), or paid into the Whish app, OMT app or
>   Binance wallet. No cash.
> - **Day rule is about the drawer being closed, not about the device.** The phone can also be used during working
>   hours, where it behaves exactly like the web app. Transactions recorded after closing belong to the NEXT business
>   day (a "between days" window from closing to the next opening); a closed day's report never changes.
>   **Revised 2026-10-08 after planning research:** LiraTek has no "day closed" state (a closing is a per-drawer count
>   against a live balance, and the PDF is frozen), so a late sale cannot disturb a counted day. Owner decision:
>   transactions count on the **local calendar day** they happened; the count screen lists sales since the last count.
>   Prerequisite slice: make every day-grouped report (Transactions page, daily summary, cash flow) use the local date.
> - **The client sends its own local day** (rule 27) — an after-midnight sale must not take the server's UTC date.
> - **Owner (admin) only** for now.

> Owner answers 2026-10-08 (second round): a real Android + iOS app built with **Expo** (React Native); sign in with
> Google (opens the shop where that account is the owner; no shop list) or shop address + username + password
> (username checked inside that shop only); no Sign in with Apple for now; "Create your shop" in the app sends the
> existing email sign-up link, rest on the web. Depends on
> LIRA-288 for Google sign-in across shops / per-tenant DB mode. Spec: `specs/289-mobile-after-hours-sales/`.

Build direction: Expo SDK 55 app in `mobile/` (new screens; reuses the existing API, core rules and accounts); push notifications later. Web tenants first —
desktop tenants keep their data on the shop PC (no cloud sync), so they cannot use it until a sync exists.

Open questions for the spec:
- How the closing's expected balance is computed today — "since the last closing" or "this calendar date". This
  decides how much work the between-days window needs.
- How the next opening shows the after-hours transactions and includes them in the expected wallet balances.
- Whether MTC/Alfa recharge and Binance are really done from the phone by this customer.

Acceptance criteria (draft):
- From a phone, the owner can record each in-scope transaction with a client and one of the four payment options;
  client, debt and wallet balances are the same as if it were recorded at the counter.
- A transaction recorded while the shop is open lands in today, exactly like the web app.
- A transaction recorded after closing does not change the closed day's report, and appears in the next opening.
- The owner can list the transactions done after hours and see the current wallet / voucher / SIM balances.
- Non-admin users cannot use the mobile flows.
- Works in the web app; desktop unaffected.

What users will notice: (when built) shop owners on the web app can record Whish App / OMT App transfers and voucher
sales from their phone, even after closing, and see the sales made since the last drawer count when they count.

> **Progress 2026-10-10 (uncommitted).** Spec Kit artifacts are complete in `specs/289-mobile-after-hours-sales/`
> (spec, plan, research R1–R12, data model, contract, quickstart, 62 tasks; 8 done).
>
> - **Framework:** Expo, copied from `hetivo-mono/apps/hetivo-mobile-driver`. Pinned to **SDK 55**, because SDK 56/57
>   need a newer Xcode than this Mac's 26.1.1. Capacitor was considered and not chosen (research R11).
> - **iOS:** the app runs on the iPhone 17 simulator in the web palette, with these screens:
>   - sign-in (shop address + username + password)
>   - "Create your shop" (reuses the web's email sign-up)
>   - home (sale tiles; wallet-balance and since-last-count placeholders)
>   - settings (sign out, delete-account link)
> - **Backend:** `POST /api/mobile/auth/login` is built. It finds the shop by address, checks the username inside that
>   shop only, admins only, and sessions are marked `mobile`. Curl-verified against a local backend; not deployed.
> - **Android:** JDK 17 and the Android SDK are being installed.
> - **Fixed along the way:**
>   - the backend now declares `ws` (React Native's `ws@7` had displaced the v8 it relied on);
>   - Metro ignores the other apps' build output.
> - **Open:**
>   - route test (T016; not provable failing-first);
>   - move the route's checks into `MobileAuthService` (T023);
>   - Google sign-in (T019 first);
>   - US3 local-date reports;
>   - sale screens.
> - **Owner decision 2026-10-10: no EAS or online Expo, and no Klareo or Hetivo accounts.** Builds are local only, and
>   APKs are signed with a local upload key (`~/Documents/LiraTek/keys/`, passwords in `~/.gradle/gradle.properties`;
>   back both up together).
> - **Also built 2026-10-10:**
>   - Dark / Light / System appearance in the app's Settings.
>   - App icon and splash from the owner-chosen LiraTek swirl logo, in Pastel Violet + Signal Blue.
>   - Development-only "shop address" mode that reads live data through `https://<shop>.liratek.shop`.
>   - Home screen shows live drawer balances and the latest transactions.
>   - Shared currency rule (`visibleDrawerCurrencies`): USD/LBP always shown, other currencies only when not zero.
>     Applied on the web Dashboard too. Release note added under Dashboard.
>
> What users will notice (Dashboard, web and desktop): drawer balances and Cash on Hand always show dollars and lira,
> even at zero; other currencies appear only when the drawer holds some.
