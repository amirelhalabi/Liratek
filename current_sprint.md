# LiraTek POS — Current Sprint

> **IMPORTANT NOTE — add a test into the e2e file for each ticket implemented to validate the feature.**

> **Last Restructured:** 2026-08-12 (see "How to keep this file honest" below)
> **Status Legend:** `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED` | `NEEDS INTERVIEW` | `PARTIAL`

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

## LIRA-113: Should a DAYS sale consume the shop line's validity? (reverses D12) — DONE

| Field                | Value                                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Epic**             | Recharge / Carrier Lines                                                                                                                                                                                                                          |
| **Type**             | Product decision                                                                                                                                                                                                                                  |
| **Priority**         | Medium                                                                                                                                                                                                                                            |
| **Status**           | **DONE** `eb820c7` (corrected 2026-08-12 — this detail block read TODO everywhere in the file; owner confirmed 2026-08-08 D12 is reversed, shipped 2026-08-11 decrementing the SELECTED carrier line, guarded by 3 new rule-20 VOID/REFUND tests) |
| **Affected Modules** | Recharge > Telecom, Carrier Lines                                                                                                                                                                                                                 |
| **Assigned To**      | —                                                                                                                                                                                                                                                 |
| **Source Plan**      | Owner report 2026-08-08 vs `done_plans/CARRIER_LINES_VALIDITY_PLAN.md` D12                                                                                                                                                                        |

### Summary

Owner (2026-08-08): _"Validity is not decreasing when we charge days from a shop line, only credits
are… if we are charging 10 days to the customer, our shop line validity should decrease by the
amount of days charged."_

**Confirmed: validity is never decremented, in any flow** (`applyMovement` has exactly 4 production
call sites; none decrement a shop line for a customer sale). **But that is the shipped, ratified
design, not a gap** — `CARRIER_LINES_VALIDITY_PLAN.md` **D12** (owner interview **2026-08-06**, two
days earlier): _"A DAYS sale costs credits only — `(days / 10) × $0.30`; the shop's expiry never
moves"_, recorded from the owner's own words: _"We charge the customer by sending SMS. Each SMS adds
10 days to the client's phone number. We lose $0.30 per each ten days sent."_ It is documented in
`telecomStockLeg`'s doc comment and guarded by a passing test
(`RechargeRepository.daysStockCost.test.ts`).

**So this is a reversal of a two-day-old decision, not a regression.** Do not implement without
explicit confirmation that D12/D9 are superseded.

### Owner decision 2026-08-08 — D12 REVERSED, build it

> _"shop expiry moves. but be aware we can have multiple lines for each carrier in shop, so make
> sure to decrease the validity from the selected line."_

- **Shop expiry DOES move.** `CARRIER_LINES_VALIDITY_PLAN.md` D12/D9 are superseded — update that
  doc and `telecomStockLeg`'s doc comment, which currently assert the opposite, or the codebase
  will read as self-contradicting.
- The $0.30/10-days drawer cost **stays** (owner didn't retract it) — validity decrements are
  **in addition to** it. The existing `RechargeRepository.daysStockCost.test.ts` keeps guarding the
  cost half; only its "validity never moves" comment/assertion needs revising.
- ⚠ **DECREMENT THE SELECTED LINE, NOT THE PRIMARY.** A shop can hold **multiple lines per
  carrier**. The diagnosis's proposed `getPrimary(carrier)` is therefore **WRONG** and must not be
  used. Trace which line the DAYS sale is actually sold from (the Telecom form's line selector →
  the IPC payload → `processRecharge`) and decrement **that** `carrier_lines` row. If the payload
  does not currently carry a line id, adding it is part of this ticket.

### Remaining questions (answer during build, don't block on them)

- [ ] Ratio: assume 10 customer days = 10 shop days unless the code says otherwise.
- [ ] Line runs out mid-sale: block, allow negative, or clamp? Pick the behavior that matches how
      credits already behave on the same line and state it in the PR.

### Technical traps (from the diagnosis)

- `CarrierLineRepository.computeAppliedState` rebases day-deltas to `max(today, current_expiry)` —
  right for **adding**, wrong for **subtracting** on an already-expired line (a naive decrement
  lands _before_ today). Needs a subtract-safe path, not the reused rebase.
- Reversal is free: `_reverseCarrierLineMovements` already reverses any movement tied to a voided
  transaction generically — just pass `transactionId` to `applyMovement`.
- Repro test ready (currently failing by design, untracked so main stays green):
  `packages/core/src/repositories/__tests__/RechargeRepository.daysChargeValidityDecrement.test.ts`
  — **note it asserts against the primary line; retarget it to the selected line.**

### Technical note for whoever builds it

`CarrierLineRepository.computeAppliedState` rebases day-deltas to `max(today, current_expiry)` —
correct for **adding** days, wrong for **subtracting** on an already-expired line (a naive
decrement lands _before_ today). Needs a subtract-safe path, not a reused rebase.
Reversal is free: `_reverseCarrierLineMovements` already reverses any movement tied to a voided
transaction generically.

Repro test written (currently failing by design):
`packages/core/src/repositories/__tests__/RechargeRepository.daysChargeValidityDecrement.test.ts`

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
| **Status**           | **PARTIAL** (cccd4ca) - see Open below |
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
| **Source Plan**      | `docs/plans/todo_plans/PARTNER_DISBURSEMENT_MATRIX.md` (22be723), VIOLATES #1 |

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

## LIRA-137: Katsh bill settlement — commission frozen at $0, wrong direction (DONE)

| Field                | Value                                                                             |
| -------------------- | --------------------------------------------------------------------------------- |
| **Epic**             | Suppliers / Commission-at-settlement                                              |
| **Type**             | Bug (money-correctness + UX)                                                      |
| **Priority**         | **High**                                                                          |
| **Status**           | **DONE** — see `BILL_COMMISSION_SETTLEMENT_PLAN.md` §4 for the full design record |
| **Affected Modules** | Suppliers (Katsh), Settle modal, `SupplierRepository`                             |
| **Assigned To**      | —                                                                                 |
| **Depends On**       | LIRA-112, LIRA-119 (partial fix, superseded here)                                 |
| **Source Plan**      | `docs/plans/todo_plans/BILL_COMMISSION_SETTLEMENT_PLAN.md`                        |

### Owner report (2026-08-11, verbatim)

Settling 2 Katsh bills at RATE 20,000 LBP / COUNT 5: "the Net Payment to Katsh is not changing in
the modal... still at zero... so I cannot do any payments," plus the correction: "When katsh owes
us 100,000lbp they pay it to us via topup to our katsh account... The commission should be a
separate payment regardless of if katsh owes us or we owe them... It is profit, entirely."

### Root cause

`settleNetPayUsd/Lbp = max(0, grossOwed − enteredCommission)` and a bill's `grossOwed` is
STRUCTURALLY 0 (its principal already left via the provider-drawer cost leg at creation, never the
ledger) — so the clamp floored every entered commission to 0, unconditionally, for every bills-only
batch. The commission then posted as a cashless `SUPPLIER_PAYS_US` ledger credit — invisible in the
modal and modeling the wrong real-world fact (a debt write-down against unrelated credit, not the
separate top-up the owner described).

### Fix

- **Posting**: bills-only batches book the commission as a REAL drawer top-up into the Katsh/iPick
  provider drawer (`_bookBillsCommissionDrawerTopUp`), profit-stamped, no supplier debt booked (kept
  structurally apart from `topUpFromSupplier`'s debt-booking half). Every other batch shape is
  byte-for-byte unchanged.
- **UI**: "Total owed"/"Net payment to" dropped for this shape, replaced by "{supplier} owes you:
  `<commission>`"; no tender form renders (nothing to pay); Confirm is enabled with no legs.
- **Hazard**: `settleTransactions` now rejects a payload with legs but nothing owed (the mirror of
  the pre-existing "owed but no legs" guard); the frontend removes the possibility structurally.
- **Reversal**: free via the generic `_reversePayments`/profit-status-flip paths (rule 20) — no
  bespoke reversal code.

Full design record, the double-count judgement, and the deferred-generalisation note:
`docs/plans/todo_plans/BILL_COMMISSION_SETTLEMENT_PLAN.md` §4.

### Verification

- `packages/core` jest: 190/190 suites, 1961/1961 tests (net +4 vs. the pre-task baseline of 1957).
- `backend` jest: 42/42 suites, 582/582 tests (unaffected — no backend/IPC/schema changes were
  needed; the fix lives entirely in the shared `@liratek/core` service/repository layer, so desktop
  IPC and web REST both pick it up automatically).
- `frontend` jest: 134/134 suites, 921 passed + 1 skipped / 922 (one pre-existing component test,
  `Suppliers.settleNetPayCurrency.test.tsx`, updated to match the new UI and proved failing against
  the pre-fix page; a new `cashFlow.ts` `SUPPLIER_SETTLEMENT` describe block added).
- Rule 17 (failing-first): every new/changed assertion was run against the pre-fix code and observed
  failing for the stated reason, then re-run green after restoring the fix — at both the repository
  level (`SupplierRepository.commissionAtSettlement.test.ts`,
  `FinancialServiceRepository.billsSettlement.test.ts`) and the component level
  (`Suppliers.settleNetPayCurrency.test.tsx`).
- **Desktop e2e is UNEXECUTED.** `lira-137-katsh-bill-settlement-modal-characterization.spec.ts`
  (the diagnosis-only predecessor) was replaced by
  `lira-137-katsh-bill-settlement-commission-topup.spec.ts` — a real guard, typechecked clean against
  `tsconfig.playwright.json`, but desktop e2e cannot run from an agent shell (`yarn test:e2e` and
  `node scripts/run-e2e.mjs` both exit 0 having run nothing) — the owner/orchestrator must run it
  after a fresh `yarn dev` cycle.

---

---

## Open Board (20 items)

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
| LIRA-084    | Partial keep-change in MultiPaymentInput                                                       | Medium                                                         | Sprint 4                      |
| LIRA-087    | Record a supplier debt without line items, attach products later                               | Medium                                                         | Sprint 4                      |
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
| **Status**           | TODO - needs an owner decision on semantics                        |
| **Affected Modules** | audit (Transactions page)                                          |
| **Source**           | Found 2026-08-12 during the LIRA-137 render-site sweep (`752e154`) |

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
| **Status**           | TODO - product call, not a defect                            |
| **Affected Modules** | audit (Transactions page), suppliers                         |
| **Source**           | Found 2026-08-12 assessing the amber marker during `752e154` |

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

(`electron-app/create_db.sql:1218,1222`.) When the owner said "it's in the **Services** module",
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
`docs/plans/todo_plans/FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md` §4's decision block.

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
| **Status**           | TODO                                                                                            |
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
| **Status**           | NEEDS INTERVIEW            |
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
| **Status**           | TODO            |
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
| **Status**           | TODO                                             |
| **Affected Modules** | MultiPaymentInput (shared)                       |
| **Assigned To**      | —                                                |
| **Depends On**       | T3 Keep Change (shipped — this is the follow-up) |

### Summary

Owner note 17. `keepChange` in `MultiPaymentInput` is currently all-or-nothing — the operator
either keeps the entire computed change or returns all of it. The owner wants to split it: e.g.
of a 140,000 LBP change, return 100,000 LBP and keep 40,000 on the customer's account.

### Acceptance Criteria

- [ ] Operator can keep a PARTIAL amount of the change, not just all-or-nothing
- [ ] The kept portion books exactly like today's full-keep (same ledger/debt path)
- [ ] The OUT (return) legs reflect only the amount actually returned, not the full computed change
- [ ] Works independently per currency
- [ ] Component test covering the partial-keep math
- [ ] Repository test covering the resulting legs
- [ ] Typecheck and lint pass

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
| **Status**           | TODO                  |
| **Affected Modules** | Suppliers, Inventory  |
| **Assigned To**      | —                     |
| **Depends On**       | —                     |

### Summary

Owner note 31. Restocking already-received goods currently risks double-booking supplier debt:
there is no way to record a supplier debt without immediately tying it to specific inventory
items. Add a flow to record the debt first, then attach the related products to it later.

### Acceptance Criteria

- [ ] Record a supplier debt entry without any line items
- [ ] Later attach the related products to that recorded debt
- [ ] No duplicate debt created when products are attached after the fact
- [ ] Ledger stays consistent (balances unaffected by the two-step flow vs. the one-step flow)
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                                                       | Change                                                           |
| -------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Database | `packages/core/src/db/migrations/index.ts`                                 | Linking table/column between a debt entry and product line items |
| Backend  | `packages/core/src/repositories/{SupplierRepository,ProductRepository}.ts` | Two-step debt→attach flow                                        |
| Frontend | `frontend/src/features/{suppliers,inventory}/**`                           | UI for recording debt then attaching products                    |

---

## LIRA-088: MTC/Alfa Provider-Balance Decrement Adjustment

| Field                | Value                |
| -------------------- | -------------------- |
| **Epic**             | Recharge             |
| **Type**             | Feature              |
| **Priority**         | Medium               |
| **Status**           | NEEDS INTERVIEW      |
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
(see `docs/plans/todo_plans/OWNER_NOTES_TASK_PLAN.md` §B).

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
| **Status**           | TODO                                                                         |
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

- [ ] `frontend/tests/e2e-web/lira-web-020-admin-tenants.spec.ts`: super-admin login → `/admin/tenants`
      list renders → provision a tenant via `AddTenantModal` → "Connect as admin" → `ImpersonationBanner`
      shows the right tenant → create a row while impersonating → confirm invisible from a different
      tenant's session → Disconnect.
- [ ] One final confirmed full-suite green run: `yarn dev` → stop → `yarn test:e2e` AND
      `yarn test:e2e:web`, plus `yarn check:tenant-scoping`, `yarn check:bind-arity`,
      `yarn typecheck && yarn lint` repo-wide — none of these has been run together as one proof yet.
- [ ] Once green, archive `MULTI_TENANT_IMPLEMENTATION_PLAN.md` to `done_plans/`.

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
| **Status**           | TODO                                                                      |
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

---

## LIRA-110: Daily closing sums financial-services commission with ZERO gates — SUPERSEDED by LIRA-158 + LIRA-160

| Field                | Value                                                                  |
| -------------------- | ---------------------------------------------------------------------- |
| **Epic**             | Closing / Profits                                                      |
| **Type**             | Bug (candidate — same class as LIRA-108)                               |
| **Priority**         | Medium                                                                 |
| **Status**           | **SUPERSEDED** — split into LIRA-158 (DONE) + LIRA-160 (TODO), see below |
| **Affected Modules** | Closing                                                                |
| **Assigned To**      | —                                                                      |
| **Depends On**       | —                                                                      |
| **Source Plan**      | Found by LIRA-108's workflow (2026-08-08, confirmed by both reviewers) |

### Summary

`ClosingRepository.ts:689-696` computes the daily financial-services commission figure with a
third, fully ungated `SUM(commission)` — missing not just the LIRA-108 counterparty gates but even
`is_settled` and `notRefunded`. A refunded or unsettled or partner-pending commission row inflates
the closing screen's daily commission number. Also rule-14 debt: a third hand-rolled copy of the
"realized commission" concept instead of reusing one definition.

### Resolution (verified against source 2026-09-04) — split into LIRA-158 (DONE) + LIRA-160 (TODO)

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
| **Status**           | TODO — **owner approved 2026-08-09** |
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
| **Status**           | TODO                                  |
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

- [ ] New desktop e2e spec: seed a product with known stock → open Custom Services → **pick it from
      the SearchBar dropdown** (not fill+Enter) → submit → assert the product's `stock_quantity`
      dropped by exactly 1 → void/refund the transaction → assert it returns to the original value.
- [ ] Assert by identity and delta (rule 15) — snapshot stock immediately before, never absolute.
- [ ] Also assert the negative case in the same spec: a **free-text** service leaves stock
      untouched. That is the regression that matters most, since all three input paths share one
      backend code path.
- [ ] Consider a web e2e twin (rule 19) if the pick flow differs in browser mode.

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
| **Status**           | NEEDS INTERVIEW               |
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
| **Status**           | NEEDS INTERVIEW                                                     |
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

## LIRA-068: Mark Transaction "Amount Changed" When Edited

| Field                | Value                          |
| -------------------- | ------------------------------ |
| **Epic**             | Transaction Visibility / Audit |
| **Type**             | Feature                        |
| **Priority**         | Low                            |
| **Status**           | TODO                           |
| **Affected Modules** | All transaction types          |
| **Depends On**       | —                              |

### Summary

If a transaction's **amount** was modified after creation, flag it as **"amount changed"** (badge/indicator). Edits are already tracked via `edited_by` / `edited_at` across modules. **Check overlap with the existing recharge "margin alert"** (theft-detection on margin override, `HistoryModal` `marginAlertThreshold`, default 100k LBP) — reuse/align rather than duplicate. **Expand the indicator to all transaction types.**

### Acceptance Criteria

- [ ] A transaction whose amount changed shows an "amount changed" indicator
- [ ] Approach reconciled with the existing margin-alert mechanism (no duplicate/contradictory signals)
- [ ] Applies across all transaction types (not just recharge)
- [ ] Distinguishes "amount changed" from generic edited metadata where relevant
- [ ] Typecheck and lint pass

### Files to Modify

| Layer    | File                                              | Change                                    |
| -------- | ------------------------------------------------- | ----------------------------------------- |
| Backend  | transaction/edit paths                            | Persist/expose amount-changed signal      |
| Frontend | `TransactionsViewer.tsx` + module `HistoryModal`s | Render indicator; align with margin alert |

---

## LIRA-075: Favorite/Pin Whish App Quick Link in Home Grid

| Field                | Value                 |
| -------------------- | --------------------- |
| **Epic**             | Navigation / Home     |
| **Type**             | Feature               |
| **Priority**         | Low                   |
| **Status**           | TODO                  |
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
| **Status**           | TODO        |
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
| **Status**           | TODO                                         |
| **Affected Modules** | OMT/Whish (Financial Services)               |
| **Source**           | Found while building LIRA-114 §4, 2026-08-22 |

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
   create_db.sql:275-281). Replaces the cart's fragile `category.includes("phone")` heuristic
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

`TransactionRepository._assertNoPartialItemRefunds` fires for any sale with
`refunded_quantity > 0` — including one where EVERY line is already fully item-refunded.
The operator is told to "refund the remaining items individually" when nothing remains.
Fix: when all lines are fully refunded, throw a distinct message ("This sale has already
been fully refunded item-by-item — nothing remains to refund."). Repo-level test both ways.

## LIRA-147: Per-item refunds have no undo — NEEDS OWNER DESIGN (raised 2026-08-27)

An item refund books a REFUND transaction with no `reverses_id`, and REFUND is in
`NON_REVERSIBLE_TRANSACTION_TYPES` — a mis-keyed per-item refund has no correction path
short of re-selling the item. Pre-existing, but the LIRA-146 guard now makes per-item the
ONLY route on partially-refunded sales, so the gap is more visible. Needs an owner
decision on the correction mechanism (a compensating re-charge? an admin void of the item
refund with stock/unit/debt symmetry per rule 20?). Do not build without the interview.

## LIRA-148: deleteProduct cascade needs the product_units table-exists guard — LOW

`InventoryService.deleteProduct`/`batchDeleteProducts` now hard-depend on `product_units`;
on a pre-v157 DB (or a hand-built test schema without the table) ALL product deletion
throws and nothing is deleted. Every OTHER product_units consumer uses the cached
`_productUnitsTableExists()` sqlite_master guard — add the same here (skip the cascade,
not the delete). Failing-first: schema without the table → delete succeeds, no cascade.

## LIRA-149: Batch product delete has no REST twin; REST delete failures break envelope parity — MEDIUM (rule 19)

(a) `inventory:batch-delete` (IPC) has no `backend/src/api/` route — in the browser the
batch-delete button reports success having deleted nothing. Mirror it (same roles, same
cascade, `{success,...}` envelope). (b) `DELETE /api/inventory/products/:id` answers a
service failure with HTTP 400 instead of the IPC-identical HTTP-200 `{success:false}`
envelope — newly reachable now that the cascade gives the delete a real failure path; the
adapter branches on `result.success`, so align to 200 (CLAUDE.md envelope-parity rule).

## LIRA-150: Delete-confirm IMEI dialog lacks a stale-response guard — LOW

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

**Status: PARTIAL — (b) DONE, (a) deliberately NOT wired in, spun off as its own ticket.**

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

## LIRA-152: Phone Units register — "product deleted" label on sold history rows — LOW (UNBLOCKED — TODO)

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

| Surface | Shows | Should show |
| ------- | ----- | ----------- |
| Suppliers page | **$2.00** on settlement day | — correct today |
| Profits → Commission | **$0.50**, on the transaction day | $2.00, on settlement day |
| Closing → daily commission | **$0.50**, on the transaction day | $2.00, on settlement day |
| Dashboard analytics | **$0.50** | $2.00 |

**The asymmetry is the point:** Suppliers and Profits now permanently disagree about how much
commission the shop made, and nothing reconciles them.

### Surfaces, each verified against source

| # | Surface | Location | Verdict |
| - | ------- | -------- | ------- |
| 1 | `getRealizedCommissionTotals` | `ProfitRepository.ts` ~:1367 | BROKEN — sums the stale creation-time estimate |
| 2 | `getPendingCommissionTotals` / `ByProvider` | `ProfitRepository.ts` ~:1407 | BROKEN — shows a dollar figure settlement can override outright |
| 3 | `getFinancialSettledByCurrency` / `PendingByCurrency` | `ProfitRepository.ts` ~:647 | BROKEN — same cause, one hop away via stamped `t.profit_*` |
| 4 | `getUnsettledSummaryByProvider` | `FinancialServiceRepository.ts` ~:4430 | ACCEPTABLE — same number as #2 but self-documented inline as an estimate |
| 5 | `getAnalytics` (Dashboard) | `FinancialServiceRepository.ts` ~:4481 | BROKEN — `is_settled = 1` gate does not fix a stale number underneath |
| 6 | Closing daily commission (`finProfit`) | `ClosingRepository.ts` ~:693 | **BROKEN, most owner-visible** — verified NOT gated on `is_settled` at all; sums every row's estimate on the transaction day |
| 7 | Suppliers Outstanding / FIFO / settle tab | `SupplierRepository.ts` ~:1071, ~:1917 | CORRECT — reads the real entered figure from the ledger credit |
| 8 | D1.1 gross transaction row | transactions consumers | CORRECT — no query sums `t.amount_*` for FINANCIAL_SERVICE; all read `fs.*` |

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

## LIRA-159: `fs.commission` estimate still reaches THREE ungated reporting surfaces — HIGH

**Priority:** High · **Epic:** Profits/Commission-at-settlement · **Status:** TODO

`financial_services.commission` permanently holds a creation-time ESTIMATE for `commission_model = 1`
rows and is never corrected (D6 no stamp-back, by design). LIRA-158 put every Profits/Closing reader
behind `embeddedCommission(alias, supported)`. Three readers were missed.

**This ticket includes a regression LIRA-158 itself introduced — own it.** Before LIRA-158 the
Dashboard tile, Profits and Closing all agreed on the estimate. They were consistently wrong, but
consistent. LIRA-158 corrected two of the three, so `FinancialRepository.getMonthlyPL` now
*disagrees* with the other surfaces about the same money. That divergence is new, and it is ours.

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

---

## LIRA-160: the daily closing snapshot OVER-recognises profit on four module sources — MEDIUM

**Priority:** Medium · **Epic:** Closing · **Status:** DONE (2026-09-04, completed same day — see both
resolution notes below) — the one gate this ticket left blocked (`notDebtPending`) was unblocked the
same day once the concurrent LIRA-162/163 edit on `ProfitRepository.ts` landed; see "Follow-up resolution"
below the first pass.

`ClosingRepository.getDailyStatsSnapshot` books profit for which no cash has arrived. Verified gate
comparison against each ProfitRepository counterpart:

| Sub-query | Missing gates |
| --------- | ------------- |
| `finProfitLegacy` (~:815) | `notPartnerPending`, `notDebtPending` |
| `rechargeProfit` (~:887) | `notPartnerPending`, `notDebtPending` |
| `customProfit` (~:904) | `notPartnerPending`, `notDebtPending` |
| `maintProfit` (~:924) | `notDebtPending` **and** `notRefunded` |

**Why this is a real defect and not a design choice.** The snapshot is deliberately a *same-day
cash-in-hand* view (self-documented at `profitRecognition.guard.test.ts:565-575`) whose only consumer
is the generated closing PDF. That reading does not excuse these — it *condemns* them: a for-partner
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

| Sub-query | `notPartnerPending` | `notDebtPending` | Notes |
| --------- | :---: | :---: | ----- |
| `finProfitLegacy` | ✅ (this ticket, first pass) | ✅ (this follow-up) | Resolves the row's own FINANCIAL_SERVICE transaction id via a new `_sourceTxnIdSubquery(sourceTable, txnType)` scalar-subquery helper (mirrors `ProfitRepository.allocationNotDebtPending`'s resolve-then-gate shape) — no existing fixture reliably has a matching `transactions` row for every legacy fs row (verified: `LIRA158.closingCashBasis.test.ts` test 3 does not), so an INNER JOIN would have silently dropped rows; the scalar subquery degrades a missing match to "not pending" instead, matching pre-change behaviour exactly. |
| `rechargeProfit` | ✅ | ✅ | Same `_sourceTxnIdSubquery` pattern, `source_table = 'recharges'`, `type = 'RECHARGE'`. |
| `customProfit` | ✅ | ✅ | Same pattern, `source_table = 'custom_services'`, `type = 'CUSTOM_SERVICE'`. |
| `maintProfit` | ❌ (correct — `getMaintenanceTotals` itself never gates this; re-verified) | ✅ | Same pattern, `source_table = 'maintenance'`, `type = 'MAINTENANCE'`. |
| `loto` (LIRA-161 addition) | ✅ (already shipped) | ✅ (this follow-up) | Already JOINs `transactions` directly (unlike the four above) — uses the real `t.id`, no subquery needed. `getLotoTotals` itself carries this gate, so this closes the ONE place the prior pass documented as "provably wider than the counterpart." |
| `exchange` (LIRA-161 addition) | ✅ (already shipped) | ❌ — **verified unnecessary, not a gap** | Re-confirmed independently (not just re-read from the prior agent's claim): `electron-app/create_db.sql`'s `exchange_transactions` DDL has NO `client_id` column at all, and `ExchangeRepository.createTransaction`'s payout-leg validation (`ExchangeRepository.ts` ~:505-513) explicitly rejects any non-drawer-affecting method, with an inline comment naming CUSTOMER_ACCOUNT as the excluded case ("needs a client_id, which exchange_transactions does not carry"). A table with no client association can never have a `debt_ledger` row referencing it — `notDebtPending` would always no-op. `getExchangeTotals` itself gates only `notRefunded` + `notPartnerPending`, confirming the counterpart carries none either. |
| `finProfitSettlement` / `billsOnlySettlement` | — | — (recognition-by-construction, unchanged) | Not in scope — no partner_ledger/debt_ledger row is ever keyed to a SUPPLIER_SETTLEMENT transaction id; the CASHLESS half already carries `allocationNotDebtPending` + `notPartnerPending` from LIRA-158 D17, untouched here. |

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

| Gate | Test | Captured failure (gate removed) |
| --- | --- | --- |
| `finProfitLegacy` | `lira160DebtPendingGates` › finProfitLegacy › excludes … | `Expected: 0, Received: 5` |
| `rechargeProfit` | … › rechargeProfit › excludes … | `Expected: 0, Received: 6` |
| `customProfit` | … › customProfit › excludes … | `Expected: 0, Received: 15` |
| `maintProfit` | … › maintProfit › excludes … | `Expected: 0, Received: 30` |
| `loto` | … › loto › excludes … | `Expected: 0, Received: 4500` |

Each: the specific `AND ${notDebtPending(...)}` clause removed from the branch the fixture actually
exercises, the named test run in isolation (`npx jest ClosingRepository.lira160DebtPendingGates -t
"<module>"`), the failure above captured, the clause restored, the full suite re-confirmed green.

New coverage: `ClosingRepository.lira160DebtPendingGates.test.ts` (11 tests — an uncovered-debt exclusion
+ a fully-covered-debt inclusion + a no-debt-row inclusion per module, proving the gate is the real FIFO
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
   *correct* for a cash view (a for-partner sale has `paid_usd = 0`) — but unlike commission, which
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

**Priority:** Low · **Epic:** Dual-transport · **Status:** TODO

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

**Priority:** Low · **Epic:** Suppliers · **Status:** TODO

`validators/supplier.ts`'s `commission_usd`/`commission_lbp` are bare `z.number()` with no
`.nonnegative()`. The `SUPPLIER_PAYS_US` ledger credit normalises with `-Math.abs(...)` while the
settlement profit stamp uses the RAW value — so a negative entry credits the ledger positively while
booking negative profit.

Not reachable through the settlement UI; reachable via direct IPC/REST. Left deliberately unfixed
during LIRA-158 so shipped bills behaviour was not silently altered (see the comment at the stamp
site). Fix is `.nonnegative()` on both, plus a validator test.

---

## LIRA-167: LIRA-138's dependency line is stale, and D17 changed its meaning — CHORE

**Priority:** Low · **Epic:** Suppliers · **Status:** TODO

`LIRA-138` (`current_sprint.md:1215-1259`, still genuinely open — no implementing commit exists) says
it depends on "COMMISSION_AT_SETTLEMENT_PLAN.md Phase 2 (OMT/WHISH gross flip, **not shipped**)".
Phase 2 shipped in `43948a35`, so that blocker is gone.

More importantly, **D17 changed what LIRA-138 means.** It was written when the cashless
`SUPPLIER_PAYS_US` branch was considered an unreachable placeholder. That branch is now the live path
that DEFERS commission recognition until the client repays. So "generalise the drawer top-up past
bills-only" is no longer a neutral money-placement question: moving OMT/WHISH commission into a real
drawer credit would make it arrive as actual cash, which under D17's own logic flips it back to
IMMEDIATE recognition and undoes the deferral the owner just asked for.

**Acceptance:** update the ticket body's Depends On and restate its scope against D17 *before* any
implementation. This is a re-scoping chore, not code.

---

# 2026-09-04 session findings — filed 2026-09-04

Five items found while shipping LIRA-159 and doing a documentation pass over its e2e coverage. **Every
file:line and factual claim below was independently re-verified against source before filing** —
two of the claims handed to the filing agent did not survive verification and are recorded below in
their corrected form, with the original framing named so nobody re-introduces it.

---

## LIRA-168: core jest runs at the wrong timezone on Windows — SQL and JS local-time disagree by 2h — MEDIUM

**Priority:** Medium · **Epic:** Test harness · **Status:** TODO

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
whole repo for an assignment shape, not just the string). *Correction to the original framing: the
literal string `TZ=Asia/Beirut` also appears in roughly a dozen other places — comments in
`ClosingRepository.ts`, `ProfitRepository.ts`, `localDate.ts`, several test file headers, and
`docs/plans/done_plans/LOCAL_BUSINESS_DAY_PLAN.md` — all of them documentation telling a human/CI
operator what TZ to launch with, none of them an actual assignment. "Exactly one place" is true only
for where the variable is actually SET, not for every place the string appears.*

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
- *Correction to the original framing:* `packages/core/src/repositories/__tests__
  /ClosingRepository.localBusinessDay.test.ts` does **NOT** manipulate `process.env.TZ` directly —
  grepped, no `process.env.TZ =` assignment exists anywhere in the file, or anywhere else in the repo's
  test suite. It does the opposite: its header comment (lines 12-16) explicitly explains why a
  **mid-test** `process.env.TZ` assignment is unreliable (SQLite's `'localtime'` reads the C runtime
  zone once, at process launch) and instead relies on `TZ` being set at process launch (via the
  `cross-env` in the package.json script), backed by a `beforeAll` probe that fails loudly if the
  measured offset is 0 — i.e. if the suite is accidentally run without the TZ launch env. Start there
  anyway: it's still the right file, just for the "how this is *supposed* to be pinned, and how to tell
  if it wasn't" story, not a `process.env.TZ =` example. `ClosingRepository.ts:961-962` separately
  comments that `localDay()` respects `process.env.TZ` (true — it uses Node's `Date` getters, verified).

---

## LIRA-169: `profitRecognition.guard.test.ts` can be defeated by a sibling column in the same query unit — MEDIUM

**Priority:** Medium · **Epic:** Profits · **Status:** TODO

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
(the *early* workspace, so a bail would hide the rest):

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
non-symlinked copy) were rebuilt to electron@31.7.7 (the installed version, verified). *Caution before
treating this as fully general:* this appears to conflict with an earlier-recorded finding that
`rebuild:native` fails to restore the ABI specifically after `test:e2e:web`'s own `rebuild:node` (citing
5+ on-disk `better-sqlite3` copies vs. this script's 4 fixed candidate paths). If that finding still
holds, the two scenarios (root `yarn test` vs. `test:e2e:web`) differ in some way not yet identified —
re-verify in the `test:e2e:web` scenario specifically rather than assuming today's root-`yarn-test`
result generalizes to it.

---

## LIRA-171: Dashboard awaiting-settlement test is 12s against a 15s limit — flaky under full-suite load — LOW

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

**Priority:** Low · **Epic:** Inventory · **Status:** TODO

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

The same interview produced a *different* and larger request: partner obligations should be recognised
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
  the PARTNER settles (i.e. when `partner_ledger`'s FOR_% coverage against `reference_table = 'sales'`
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
requirement and decided one view can carry the same transparency without a mode toggle. Their words: *"I
think you are correct on this. Let's stick to one view."* The reasoning offered back to them (not their
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
  - *Which fields arrive with no stamped rate*: only the two profit aggregates
    (`totalProfitUSD`/`totalProfitLBP`) get this treatment — see the "stamped rate" item below for why
    the rest of the document's fields don't have a per-row stamped rate to honour at all at this layer.
  - *Total (LBP) line*: kept, flagged in a source comment in `rateStampedProfit.ts` as the filer's
    inference — a one-line removal if the owner disagrees.
  - *`sell_rate` accessor*: used `useSellRate().sellRate` (the canonical frontend hook everyone else
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

`frontend/tests/e2e-electron/lira-136-binance-fee-mode-c-ui-driven.spec.ts:157` — *"'Customer pays
separately' is absent while a session is active"* — fails **only when run as part of the full desktop e2e
suite** (observed on Ubuntu CI) and **passes when run alone** (verified on Windows). Both directions were
verified before filing.

**Where it fails:** line 186, `await expect(appPage.locator("#crypto-amount")).toBeVisible({ timeout:
20_000 })` — i.e. failing during the test's own *setup* (starting a session, navigating to `/recharge`,
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
state, etc.) that this spec's setup steps don't anticipate and don't defend against. Finding *which*
earlier spec, and *what* state it leaves, is the actual investigation — this ticket does not attempt that;
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
2ms default), just the *intercepting* side of it instead of the *asserting* side.

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

## LIRA-176: LBP-denominated profit is dropped from BOTH closing totals, not deferred — MEDIUM

**Priority:** Medium · **Epic:** Closing · **Status:** TODO · **Found:** 2026-09-04, while building LIRA-174

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
make sure an LBP profit slice reaches *a* total rather than vanishing.

**Acceptance:** every module's LBP profit slice reaches either `totalProfitLBP` or a documented,
deliberate exclusion; rule 17 failing-first per module changed; the shared gate fragments reused, never
re-texted (rule 14); and LIRA-174's PDF label updated once the figure is genuinely complete.
