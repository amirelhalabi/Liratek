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

| Field                | Value                              |
| --------------------- | ------------------------------------ |
| **Epic**              | Recharge / Carrier Lines              |
| **Type**              | Product decision                      |
| **Priority**          | Medium                                |
| **Status**            | **DONE** `eb820c7` (corrected 2026-08-12 — this detail block read TODO everywhere in the file; owner confirmed 2026-08-08 D12 is reversed, shipped 2026-08-11 decrementing the SELECTED carrier line, guarded by 3 new rule-20 VOID/REFUND tests) |
| **Affected Modules**  | Recharge > Telecom, Carrier Lines     |
| **Assigned To**       | —                                      |
| **Source Plan**       | Owner report 2026-08-08 vs `done_plans/CARRIER_LINES_VALIDITY_PLAN.md` D12 |

### Summary

Owner (2026-08-08): *"Validity is not decreasing when we charge days from a shop line, only credits
are… if we are charging 10 days to the customer, our shop line validity should decrease by the
amount of days charged."*

**Confirmed: validity is never decremented, in any flow** (`applyMovement` has exactly 4 production
call sites; none decrement a shop line for a customer sale). **But that is the shipped, ratified
design, not a gap** — `CARRIER_LINES_VALIDITY_PLAN.md` **D12** (owner interview **2026-08-06**, two
days earlier): *"A DAYS sale costs credits only — `(days / 10) × $0.30`; the shop's expiry never
moves"*, recorded from the owner's own words: *"We charge the customer by sending SMS. Each SMS adds
10 days to the client's phone number. We lose $0.30 per each ten days sent."* It is documented in
`telecomStockLeg`'s doc comment and guarded by a passing test
(`RechargeRepository.daysStockCost.test.ts`).

**So this is a reversal of a two-day-old decision, not a regression.** Do not implement without
explicit confirmation that D12/D9 are superseded.

### Owner decision 2026-08-08 — D12 REVERSED, build it

> *"shop expiry moves. but be aware we can have multiple lines for each carrier in shop, so make
> sure to decrease the validity from the selected line."*

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
  lands *before* today). Needs a subtract-safe path, not the reused rebase.
- Reversal is free: `_reverseCarrierLineMovements` already reverses any movement tied to a voided
  transaction generically — just pass `transactionId` to `applyMovement`.
- Repro test ready (currently failing by design, untracked so main stays green):
  `packages/core/src/repositories/__tests__/RechargeRepository.daysChargeValidityDecrement.test.ts`
  — **note it asserts against the primary line; retarget it to the selected line.**

### Technical note for whoever builds it

`CarrierLineRepository.computeAppliedState` rebases day-deltas to `max(today, current_expiry)` —
correct for **adding** days, wrong for **subtracting** on an already-expired line (a naive
decrement lands *before* today). Needs a subtract-safe path, not a reused rebase.
Reversal is free: `_reverseCarrierLineMovements` already reverses any movement tied to a voided
transaction generically.

Repro test written (currently failing by design):
`packages/core/src/repositories/__tests__/RechargeRepository.daysChargeValidityDecrement.test.ts`

---

## LIRA-118: BLOCKER — "Submit to partner" disabled on Custom Services even with a partner selected

| Field                | Value                              |
| --------------------- | ------------------------------------ |
| **Epic**              | Custom Services / Partners            |
| **Type**              | Bug - blocker (flow unusable)         |
| **Priority**          | **BLOCKER**                           |
| **Status**            | **DONE** (e586de9) - owner-tested |
| **Affected Modules**  | Custom Services                       |
| **Source Plan**       | Owner manual test 2026-08-10          |

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

| Field                | Value                              |
| --------------------- | ------------------------------------ |
| **Epic**              | Suppliers / Commission                |
| **Type**              | Bug - money risk                      |
| **Priority**          | **High**                              |
| **Status**            | **PARTIAL** (cccd4ca) - see Open below |
| **Affected Modules**  | Suppliers (settle), Commission        |
| **Source Plan**       | Owner manual test 2026-08-10          |

### Summary

Owner settled a Katsh bill in RATE mode. The modal computed the commission correctly in LBP:

```
RATE PER UNIT 20000 | CURRENCY [USD|LBP] | COUNT 1
20000 LBP x 1 = 20,000 LBP
Net payment to Katsh:  $0.00
Total Amount:          $0.00
```

Owner's read, consistent with the symptom: the **net payment / total are computed in USD**, so a
20,000 LBP commission lands as $0. Owner: *"the net payment and currency selected by default in
payment should be in LBP."*

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
      **It was a pure display bug** (hardcoded `$` + `currency: "USD"`). Fixed in cccd4ca.

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

| Field                | Value                              |
| --------------------- | ------------------------------------ |
| **Epic**              | Partners / UI                         |
| **Type**              | Bug - feature unusable                |
| **Priority**          | **High**                              |
| **Status**            | **DONE** (714837d) - owner-tested OK |
| **Affected Modules**  | Partners (possibly every Select in a modal) |
| **Source Plan**       | Owner manual test 2026-08-10          |

### Summary

Owner: *"clicking on the currency drop down only changes the arrow direction, no dropdown is opening
to be able to select lbp."*

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

| Field                | Value                              |
| --------------------- | ------------------------------------ |
| **Epic**              | Custom Services / Copy                |
| **Type**              | Bug - misleading copy                 |
| **Priority**          | Medium                                |
| **Status**            | **DONE** (e586de9) |
| **Affected Modules**  | Custom Services                       |
| **Source Plan**       | Owner manual test 2026-08-10          |

### Summary

The notice currently reads: *"The service's cost, $8.00, **still leaves the General drawer right
now**, the same as a walk-in job."* **Section 2a (`d1a0ad2`) removed exactly that behaviour** - the
cost no longer moves any drawer.

Sequencing error: the copy was written in `cc45227` under an explicit instruction to describe
*current* behaviour, and `d1a0ad2` invalidated it one commit later without the copy being revisited.
Misleading copy is what triggered this whole line of work (section 5), so it should not be left.

### Acceptance Criteria

- [ ] Notice states the truth: full price to the partner's tab; **cost affects profit only and moves
      no drawer**.
- [ ] Sweep every other partner/cost notice for the same staleness after section 2a.

---

## LIRA-122: Supplier table shows "Unpaid" on rows where nothing is owed

| Field                | Value                              |
| --------------------- | ------------------------------------ |
| **Epic**              | Suppliers / Reporting                 |
| **Type**              | Bug - misleading info (no money impact) |
| **Priority**          | Low                                   |
| **Status**            | **DONE** (pending commit) |
| **Affected Modules**  | Suppliers                             |
| **Source Plan**       | Owner manual test 2026-08-10          |

### Summary

Owner sold a Katsh **item** (not a bill) and saw it in the Katsh supplier table as
`SEND | 462,075 LBP | Unpaid`, while the supplier balance correctly read **Settled**.

Owner's reasoning, which is correct: *"in katsh we pay from our own shop balance, nothing is owed.
basically only topping up the katsh balance is what we owe to katsh... if item other than bill, we
dont need to see it in the katsh supplier table. the unpaid is misleading but... not critical, not
affecting the money flow, just misleading info."*

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

| Field                | Value                              |
| --------------------- | ------------------------------------ |
| **Epic**              | Tooling / Verification integrity      |
| **Type**              | Bug - false-green verification        |
| **Priority**          | **High**                              |
| **Status**            | **DONE** (db149e6) - see CI correction below |
| **Affected Modules**  | e2e harness (all)                     |
| **Source Plan**       | Found 2026-08-10 while verifying LIRA-118..121 |

### Summary

`yarn test:e2e` **produces zero bytes of output and exits 0 within seconds**, running nothing.
Reproduced three times: twice backgrounded, once in the foreground with a 90s leash.

The suite itself is healthy. Invoking playwright directly works:

```
cd frontend && npx playwright test --config playwright.electron.config.ts --reporter=list
# -> 252 passed (7.2m)
```

`--list` also works through the wrapper, enumerating all 252 specs. Only *execution* via the
yarn script is silent. The script is
`"test:e2e": "cd frontend && npx playwright test --config playwright.electron.config.ts"`.

**Why this is High and not tooling trivia:** a command that exits 0 without running is
indistinguishable from a pass to any caller that checks the exit code - including CI, agents, and
`| tail` pipelines (a pipe returns *tail's* status, so even the empty output is masked). Every
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

| Field                | Value                              |
| --------------------- | ------------------------------------ |
| **Epic**              | Partners / Money posting              |
| **Type**              | Bug - untracked cash outflow          |
| **Priority**          | **High** (latent today, realizes on first use) |
| **Status**            | **DONE** (2e9e822) |
| **Affected Modules**  | omt_whish, partners                   |
| **Source Plan**       | `docs/plans/todo_plans/PARTNER_DISBURSEMENT_MATRIX.md` (22be723), VIOLATES #1 |

### Summary

On a THROUGH-partner OMT/Whish **RECEIVE**, the shop physically hands the customer cash but **no
drawer is debited**. The payout postings at `FinancialServiceRepository.ts:3137-3142`,
`:3253-3257` and `:3270-3276` are all gated on `!skipSystemDrawer`, and
`skipSystemDrawer = isThroughPartner` (`:909`).

This is the owner's own stated scenario (2026-08-10): *"whish system receive [for partner checked
- through partner] i physically give money to the customer ... yes its from our drawers."*

**Latent but structurally mandatory.** Zero `THROUGH_%` rows exist in the live DB today, so there
is no historical drift. It cannot be avoided going forward, though: a walk-in transaction on the
shop's secondary system is hard-rejected without a partner (`:966-973`), and the only UI path that
attaches a partner without ticking "For Partner" (`Services/index.tsx:1081`) hardcodes
`partnerMode: "THROUGH"`. It realizes on the shop's first secondary-system RECEIVE.

**Note the correction this ticket embeds:** this was originally diagnosed as a *FOR*-partner gap,
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

| Field                | Value                              |
| --------------------- | ------------------------------------ |
| **Epic**              | Partners / Money posting              |
| **Type**              | Bug - two code paths disagree         |
| **Priority**          | Medium (latent)                       |
| **Status**            | **DONE** (43c7450) |
| **Affected Modules**  | omt_whish, partners                   |
| **Source Plan**       | `PARTNER_DISBURSEMENT_MATRIX.md` VIOLATES #3 |

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

| Field                | Value                              |
| --------------------- | ------------------------------------ |
| **Epic**              | Partners / Reporting                  |
| **Type**              | Bug - wrong label, no money impact    |
| **Priority**          | Low                                   |
| **Status**            | **DONE** (43c7450) - no migration needed, zero rows existed |
| **Affected Modules**  | partners, reporting                   |
| **Source Plan**       | `PARTNER_DISBURSEMENT_MATRIX.md` VIOLATES #4 |

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

| Field                | Value                              |
| --------------------- | ------------------------------------ |
| **Epic**              | Partners / OMT-Whish                  |
| **Type**              | Bug - asymmetric guard                |
| **Priority**          | Medium                                |
| **Status**            | **DONE** (5980180) |
| **Affected Modules**  | omt_whish, partners                   |
| **Source Plan**       | `FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md` section 5b (lines ~268-270) |

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

| Field                | Value                              |
| --------------------- | ------------------------------------ |
| **Epic**              | Partners / Money posting              |
| **Type**              | Question - blocked on shop owner      |
| **Priority**          | Medium (no known loss; consistency)   |
| **Status**            | **RESOLVED** - no change needed; documented in FEATURE_GUIDE 8.1.0 |
| **Affected Modules**  | omt_whish, partners                   |
| **Source Plan**       | `PARTNER_DISBURSEMENT_MATRIX.md` open item |

### Summary

A FOR-partner ("on behalf of") RECEIVE posts **differently depending on provider**:

| Provider family | What posts at transaction time |
| --- | --- |
| **OMT / WHISH** (primary system) | supplier-ledger TOP_UP + partner CREDIT - **no drawer moves** |
| **App wallet / Binance** | the wallet drawer is **CREDITED** the full amount |

Owner's description of the flow (2026-08-10): *"OMT received: he calls us and tells us to receive
this OMT transaction and hold on to the money. Not physically hold on to the money, but we will
settle at the end. This receiver of the OMT amount, the amount is what we owe to the partner."*

Owner's provisional answer (2026-08-10), pending confirmation with the shop owner:
> *"im not sure, im asking the shop owner but yes i think drawers doesnt change"*

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

| Field                | Value                              |
| --------------------- | ------------------------------------ |
| **Epic**              | Suppliers / Reporting                 |
| **Type**              | Bug - misleading display (money is correct) |
| **Priority**          | Medium                                |
| **Status**            | **DONE** (9082d6c) - one sign rule; 4 of 7 entry_types were affected |
| **Affected Modules**  | Suppliers (ledger tab), omt_whish     |
| **Source Plan**       | Found closing LIRA-128, 2026-08-10    |

### Summary

On a `supplier_ledger` row with `entry_type = 'TOP_UP'` and a **negative** amount, the two
things the operator reads say opposite things:

- `EntryTypeBadge` renders `TOP_UP` in **red** (`Suppliers/index.tsx:135-153`) - reads as
  "debt going UP"
- the amount renders in **green** when negative (`Suppliers/index.tsx:1702`) - reads as
  "debt going DOWN"

Reading it correctly requires already knowing the C5 signed-`TOP_UP` convention, where a RECEIVE
books a negative TOP_UP because it *reduces* what the shop owes the provider (`grossOwedDelta`).

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

| Field                | Value                              |
| --------------------- | ------------------------------------ |
| **Epic**              | Custom Services / Reporting           |
| **Type**              | Bug - misleading display (money is correct) |
| **Priority**          | **High** (owner-reported; operator cannot tell a refund happened) |
| **Status**            | **DONE** (e47dfa2) - projection fix; the audit spawned LIRA-131 |
| **Affected Modules**  | custom_services                       |
| **Source Plan**       | Owner report 2026-08-10               |

### Summary

Owner created a for-partner custom service ("7welet syria 100$", cost $100 / price $110) and then
refunded it. The **transactions** table is correct - both rows present, original marked `REFUNDED`,
plus a `REFUND ... $-110` row. The **Custom Services history** still shows it as a normal live row:

```
08:58 PM   up $110.00   7welet syria 100$   -   $100.00   $110.00   $10.00   CASH
```

No refund indication at all. Owner: *"Shouldn't we see a refund transaction in the Services.history?"*

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

| Field                | Value                              |
| --------------------- | ------------------------------------ |
| **Epic**              | Reporting / cross-module              |
| **Type**              | Bug - misleading display (money correct) |
| **Priority**          | **High** (5 modules; same defect the owner hit) |
| **Status**            | **DONE** (4710cb8) - all 5 fixed; found a 6th and 7th drop site |
| **Affected Modules**  | recharge, omt_whish, exchange, expenses, debts |
| **Source Plan**       | The 11-table audit demanded by LIRA-130, run 2026-08-10 |

### Summary

LIRA-130 fixed Custom Services. The audit it required then found the **same defect in five more
modules**: the refund correctly writes `is_refunded` (all 11 tables in
`TransactionRepository._markSourceRefunded`'s whitelist), but the module's read path drops it, so the
history shows a refunded record as live.

**This is not five bugs to discover - it is one bug in five places, and four of them are a ONE-LINE
fix.** The frontend badge code is already written and dead in four of them, starved by the SQL
projection.

| Table | Projected? | Frontend ready? | Verdict |
| --- | --- | --- | --- |
| `custom_services` | fixed (e47dfa2) | badge existed; profit neutralised | **DONE** |
| `recharges` | **No** - `RechargeRepository.ts:366-368` | **Yes, dead** - `recharge/components/HistoryModal.tsx:301,332,336-338` | one-line fix |
| `financial_services` | **No** - `FinancialServiceRepository.ts:816-818` (via `getHistory()`:4001-4013 -> `omtHandlers.ts:72`) | **Split**: `services/pages/Services/index.tsx` inline table has NO badge code at all; the shared `recharge/HistoryModal.tsx` (iPick/Katsh/Whish-App/Crypto) has dead badge code | **TWO surfaces** - one needs UI built |
| `exchange_transactions` | **No** - `ExchangeRepository.ts:127-152` | **Yes, dead** - `exchange/.../HistoryModal.tsx:26-27,174,198-200` | one-line fix |
| `expenses` | **No** - `ExpenseRepository.ts:43-45` | **Yes, dead** - `expenses/.../HistoryModal.tsx:17,162,179-181` | one-line fix |
| `debt_ledger` | **No** - `DebtRepository.ts:147-150` (`findClientHistory`:228-235) | **Yes, dead** - `debts/pages/Debts/index.tsx:104,1572,1826` | one-line fix (softer: a visible "Refund Reversal" row also appears) |
| `maintenance` | Yes - `MaintenanceRepository.ts:181-183` | Yes, list + modal, **with tests** | already correct |
| `loto_tickets` | Yes - `LotoTicketRepository.ts:458-464` | Yes, `TicketHistoryModal.tsx:55,209,238-240`, **with tests** | already correct |
| `supplier_ledger` | Yes - `SupplierRepository.ts:875-876` | Yes | already correct |
| `wallet_exchanges` | Yes, IPC+REST wired | **No UI consumes it** - `walletExchangeHistory()` has zero callers | dead plumbing, not a wrong display |
| `drawer_transfers` | N/A - no module read method | Visible only via the unified log, which reads `transactions.status` correctly | flag is for reversal idempotency only |

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

| Field                | Value                                                                            |
| -------------------- | --------------------------------------------------------------------------------- |
| **Epic**             | Suppliers / Commission-at-settlement                                              |
| **Type**             | Bug (money-correctness + UX)                                                      |
| **Priority**         | **High**                                                                          |
| **Status**           | **DONE** — see `BILL_COMMISSION_SETTLEMENT_PLAN.md` §4 for the full design record |
| **Affected Modules** | Suppliers (Katsh), Settle modal, `SupplierRepository`                             |
| **Assigned To**      | —                                                                                  |
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

## Open Board (19 items)

> Every item below is genuinely open per `docs/plans/todo_plans/SPRINT_INVENTORY_2026-08-12.md` §3 —
> verified against source/git history, not against any file's own status marker. Ticket bodies are
> verbatim from before this restructuring (title, priority, status, acceptance criteria, owner
> quotes, commit references unchanged) except where a stale marker is explicitly corrected elsewhere
> in this file. Grouped by priority; original sprint/location noted per row.

| Ticket | Description | Priority | Originally in |
|---|---|---|---|
| LIRA-114 | Services/OMT-Whish For-Partner payment section: unfiltered on SEND, discarded on RECEIVE | High (narrowed) | Sprint 6 |
| LIRA-138 | Generalise the commission-at-settlement drawer top-up (LIRA-137) from Katsh bills to OMT/WHISH | Medium | Sprint 6 |
| LIRA-079 | Refund scope (which txn types get Refund) + whether to remove the Void button | Medium | Sprint 4 |
| LIRA-083 | Custom Services needs a real work-status lifecycle | Medium | Sprint 4 |
| LIRA-084 | Partial keep-change in MultiPaymentInput | Medium | Sprint 4 |
| LIRA-087 | Record a supplier debt without line items, attach products later | Medium | Sprint 4 |
| LIRA-088 | Signed decrement path for MTC/Alfa provider balance | Medium (likely partially superseded) | Sprint 4 |
| LIRA-099 | Multi-tenant admin/impersonation e2e spec + full-suite proof run | Medium | Sprint 6 |
| LIRA-101 | Primary Cash Drawer cleanup + verify Suppliers `settleNetPayUsd` | Medium | Sprint 6 |
| LIRA-110 | Daily closing sums financial-services commission with zero gates | Medium | Sprint 6 |
| LIRA-116 | Rename the crossed `custom_services`/`omt_whish` module labels + routes | **High** (raised 2026-08-22 — has now misled 3 investigations) | Sprint 6 |
| LIRA-117 | No e2e spec drives the inventory-pick to stock-decrement flow | Medium | Sprint 6 |
| LIRA-058 | OMT App topup flow design (dual cash/owed-pool model) | Medium | Sprint 2 |
| LIRA-096 | Partners page — remove "Record Transaction" | Low | Sprint 5 |
| LIRA-068 | Mark Transaction "Amount Changed" when edited | Low | Sprint 3 |
| LIRA-075 | Favorite/pin Whish App quick link in home grid | Low | Sprint 3 |
| LIRA-086 | Dashboard checkpoint freshness coloring | Low | Sprint 4 |
| LIRA-054-FU | Binance rows in TransactionsViewer missing directional badge | Low | Sprint 1 follow-up (orphaned) |
| LIRA-055-FU | Voucher support at session checkout needs `client_id` | Low | Sprint 1 follow-up (orphaned) |
| LIRA-139 | Sort-by-Amount ignores `amount_lbp` — every LBP-primary row sorts as 0 | Medium | Found 2026-08-12 |
| LIRA-140 | Non-till money renders identically to till cash on a settlement row | Low | Found 2026-08-12 |
| LIRA-142 | PM Fee input renders on a For-Partner SEND while the payload forces the fee to 0 | Low | Found 2026-08-22 |

**Count by priority:** High — 2 · Medium — 12 · Low — 8. **Total: 22.**

---

## LIRA-139: Sort-by-Amount ignores `amount_lbp` — every LBP-primary row sorts as 0

| Field                | Value                              |
| --------------------- | ------------------------------------ |
| **Epic**              | Transactions / Reporting              |
| **Type**              | Bug - pre-existing, table-wide        |
| **Priority**          | Medium                                |
| **Status**            | TODO - needs an owner decision on semantics |
| **Affected Modules**  | audit (Transactions page)             |
| **Source**            | Found 2026-08-12 during the LIRA-137 render-site sweep (`752e154`) |

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

| Field                | Value                              |
| --------------------- | ------------------------------------ |
| **Epic**              | Transactions / Reporting              |
| **Type**              | UX - missing distinction (money is correct) |
| **Priority**          | Low                                   |
| **Status**            | TODO - product call, not a defect     |
| **Affected Modules**  | audit (Transactions page), suppliers  |
| **Source**            | Found 2026-08-12 assessing the amber marker during `752e154` |

### Summary

A bills-only Katsh settlement now shows the plain green `↓` "cash in" badge — **visually identical to
an ordinary cash receipt** — even though that money never touched a till. It went into the shop's Katsh
provider balance as a top-up.

There used to be an affordance for exactly this: `isSupplierCredit` renders a distinct **amber `+`**
marker meaning *"a receivable owed to us, not drawer cash."* It keys on
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

## LIRA-114: For-Partner payment section on Services — ROOT CAUSE FIXED, §4 UI gating IN BUILD

| Field                | Value                              |
| --------------------- | ------------------------------------ |
| **Epic**              | Services / Partners                   |
| **Type**              | Investigation → likely UX fix         |
| **Priority**          | Medium                                |
| **Status**            | **IN BUILD 2026-08-22** (was NEEDS INTERVIEW) |
| **Affected Modules**  | Financial Services, Custom Services, Partners |
| **Assigned To**       | —                                      |
| **Source Plan**       | Owner report 2026-08-08 ('7welet souria') |

> ⏭ **Jump to "RESOLVED 2026-08-22" at the end of this ticket first.** The root cause was fixed
> on 2026-08-09; everything between here and there is historical investigation written while it was
> still unknown, and one block of it investigated the wrong module (see LIRA-116).

### Summary

Owner: *"a service for partner called '7welet souria' and payment method debt; it's affecting the
general drawer."*

**The literal scenario does NOT reproduce.** In `FinancialServiceRepository`, a FOR-partner service
carrying a CUSTOMER_ACCOUNT leg is **rejected before any drawer write**
(`assertNoCustomerAccountLeg` → *"A partner financial service cannot carry a CUSTOMER_ACCOUNT
leg"*), and the whole transaction rolls back. 8 new tests + 27 existing partner tests + 5
custom-service partner tests all confirm General delta = 0. (Note: the `DEBT` payment code was
renamed `CUSTOMER_ACCOUNT` in migration v86; the UI label is still "Customer Account (Debt)".)

**Most likely the report is about a different feature**: `CustomServiceRepository`'s FOR-partner
branch posts a **cost outflow** (real money leaving for the provider) while the form still *shows*
a Payment Method selector that is inert in FOR mode — producing exactly the "I chose Debt but the
drawer moved" impression.

### 🔴 CORRECTED 2026-08-09 — the "Services page" is `custom_services`, NOT `omt_whish`

**The module labels and routes are crossed, and it misled two investigations:**

| module key        | UI label      | route              |
| ----------------- | ------------- | ------------------ |
| `custom_services` | **"Services"**| `/custom-services` |
| `omt_whish`       | "OMT/Whish"   | **`/services`**    |

(`electron-app/create_db.sql:1218,1222`.) When the owner said "it's in the **Services** module",
they meant the tile labeled *Services* — which is **`custom_services`** — not the `/services`
route. A prior investigation "refuted" this ticket on the reasoning *"Services/index.tsx never sets
cost/price, so cost 1008 / price 1010 cannot originate there"*. That reasoning was **correct about
the code and wrong about which page** — `custom_services` DOES have cost/price fields, and the
numbers fit it exactly.

⇒ **The original hypothesis is back: this is `CustomServiceRepository`'s FOR-partner cost outflow.**

**Owner confirmed 2026-08-09:** the transaction WAS entered with the **"For Partner"** checkbox
ticked — *"yes confirmed it was for partner but it acts as through"*. That mismatch (labelled FOR,
behaving like THROUGH) is now the core question of this ticket, not the drawer routing alone.
Owner also confirmed: **keep the checkbox label "For Partner"** — do not rename it.

### ⚑ EARLIER HANDOFF CONTEXT (superseded in part by the correction above)

**The exact scenario, in the owner's words:**
> *"7welet souria is the partner name. It's in the **Services** module… I entered **cost 1008** and
> **price USD 1010** and **payment method customer account**."*

So: **Services page** (`frontend/src/features/services/`, i.e. `FinancialServiceRepository`) — **not**
Custom Services (the owner reports that page isn't even visible to them; the earlier diagnosis
guessed Custom Services and that guess is now **ruled out**). Partner = *7welet souria*.
Cost $1008, price $1010, payment method **Customer Account**. Observed: **General drawer moved.**

**🔴 These are the same numbers as LIRA-115.** The refund report ("customer paid 1010, cost 1008,
refund returned 1008") uses the identical figures — this is very likely **one transaction producing
two symptoms**. Investigate them together; a single root cause may explain both, and fixing one
blind could mask the other.

**What the earlier (pre-clarification) diagnosis established — still valid, don't redo:**
- The `DEBT` payment code was renamed `CUSTOMER_ACCOUNT` in migration v86. The UI label is
  "Customer Account (Debt)". No row for a literal `"DEBT"` code exists.
- **FOR**-partner + a `CUSTOMER_ACCOUNT` leg is **rejected before any drawer write** by
  `assertNoCustomerAccountLeg` (~`FinancialServiceRepository.ts:1806`) — *"A partner financial
  service cannot carry a CUSTOMER_ACCOUNT leg"* — and the whole `db.transaction` rolls back.
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
~1864-1868, *"the full selling price goes on the partner's tab"*) — so a partner-carrying cost/price
item can never reach the session-basket/`deferPayment` path LIRA-115 actually reproduces (that path
requires NO partner at all, per its own repro fixture). The owner's two reports share the SAME
round numbers (cost 1008, price 1010) most likely because they explored the SAME cost/price flow
twice — once with a partner attached, once inside a session basket — and reported both under one
mental model ("the same sale"), not because one `createTransaction()` call produced both symptoms.

**The literal LIRA-114 scenario (partner + cost/price + CUSTOMER_ACCOUNT) does not reproduce, and
the code is behaving as designed — confirmed with a new regression test, no money changed:**
`FinancialServiceRepository.forPartnerDebtDrawer.test.ts` gained a `"LIRA-114"` describe block
(2 new tests) with the owner's EXACT figures (iPick, cost 1008, price 1010, partner "7welet souria"):

1. Attaching a CUSTOMER_ACCOUNT leg (any IN-direction payment leg, in fact — see below) to a
   FOR-partner cost/price sale throws **before any drawer write** — General/iPick delta 0, zero rows
   written. The rejecting guard is actually `assertNoCounterPayment` (*"a partner financial service
   takes no counter payment"*), not `assertNoCustomerAccountLeg` — a FOR-partner cost/price sale
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

---

## LIRA-138: Generalise the commission-at-settlement drawer top-up to OMT/WHISH (Phase 2)

| Field                | Value                                                                             |
| -------------------- | ---------------------------------------------------------------------------------- |
| **Epic**             | Suppliers / Commission-at-settlement                                             |
| **Type**             | Feature (deferred generalisation)                                                |
| **Priority**         | Medium                                                                            |
| **Status**           | TODO                                                                              |
| **Affected Modules** | Suppliers (OMT/WHISH), `SupplierRepository`                                      |
| **Assigned To**      | —                                                                                 |
| **Depends On**       | LIRA-137 (DONE), `COMMISSION_AT_SETTLEMENT_PLAN.md` Phase 2 (OMT/WHISH gross flip, not shipped) |
| **Source Plan**      | `COMMISSION_AT_SETTLEMENT_PLAN.md` D13; `BILL_COMMISSION_SETTLEMENT_PLAN.md` §4   |

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

## LIRA-110: Daily closing sums financial-services commission with ZERO gates

| Field                | Value                                                                  |
| -------------------- | ---------------------------------------------------------------------- |
| **Epic**             | Closing / Profits                                                      |
| **Type**             | Bug (candidate — same class as LIRA-108)                               |
| **Priority**         | Medium                                                                 |
| **Status**           | TODO                                                                   |
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

### Acceptance Criteria

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

| Field                | Value                              |
| --------------------- | ------------------------------------ |
| **Epic**              | Naming / DX                           |
| **Type**              | Refactor (naming only)                |
| **Priority**          | **High** (raised 2026-08-22)          |
| **Status**            | TODO — **owner approved 2026-08-09**  |
| **Affected Modules**  | Custom Services, OMT/Whish            |
| **Source Plan**       | Found while diagnosing LIRA-114       |

> 🔴 **THIRD STRIKE, 2026-08-22 — priority raised to High.** This has now misled a **third**
> consecutive LIRA-114 investigation, and that one produced a dated, file:line-cited "resolved"
> conclusion about `FinancialServiceRepository` (`omt_whish`) when the subject was
> `CustomServiceRepository` (`custom_services`). Documenting the trap has demonstrably not stopped
> it — three investigations read this very warning and fell in anyway. The rename is the only fix
> that ends it. Owner approved it 2026-08-09; it is still unbuilt.

### Summary

The two modules have crossed names, which has already cost real debugging time:

| module key        | UI label       | route              | repository                  |
| ----------------- | -------------- | ------------------ | --------------------------- |
| `custom_services` | **"Services"** | `/custom-services` | `CustomServiceRepository`   |
| `omt_whish`       | "OMT/Whish"    | **`/services`**    | `FinancialServiceRepository`|

So "the Services page" means `custom_services`, while the `/services` ROUTE belongs to OMT/Whish.
This directly caused LIRA-114 to be wrongly refuted: an investigation reasoned *"Services/index.tsx
never sets cost/price, so the owner's cost 1008 / price 1010 can't come from there"* — true of
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

| Field                | Value                              |
| --------------------- | ------------------------------------ |
| **Epic**              | Custom Services / Inventory           |
| **Type**              | Test coverage gap                     |
| **Priority**          | Medium                                |
| **Status**            | TODO                                  |
| **Affected Modules**  | Custom Services, Inventory            |
| **Source Plan**       | Found while shipping §2b (2026-08-09) |

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

| Layer | File                                                    | Change   |
| ----- | ----------------------------------------------------------- | ------------ |
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

| Archive file | Contents |
|---|---|
| `docs/plans/done_plans/SPRINT_1_ARCHIVE_2026-08-12.md` | Pre-merge review (2026-06-19), post-review follow-ups (2026-06-20), LIRA-048..055 — all DONE |
| `docs/plans/done_plans/SPRINT_2_ARCHIVE_2026-08-12.md` | LIRA-056, 057, 059..064 — all DONE (LIRA-058 stayed here, open) |
| `docs/plans/done_plans/SPRINT_3_ARCHIVE_2026-08-12.md` | LIRA-065..067, 069..074, 076, 077 + Backlog + Session Summary narrative — all DONE (LIRA-068, 075 stayed here, open) |
| `docs/plans/done_plans/SPRINT_4_ARCHIVE_2026-08-12.md` | LIRA-078, 080..082, 085, 089..091, 094 — all DONE, including LIRA-090 (corrected DONE) (LIRA-079, 083, 084, 086, 087, 088 stayed here, open) |
| `docs/plans/done_plans/SPRINT_5_ARCHIVE_2026-08-12.md` | LIRA-095, 097 — DONE / CLOSED-already-working (LIRA-096 stayed here, open) |
| `docs/plans/done_plans/SPRINT_6_ARCHIVE_2026-08-12.md` | LIRA-098, 100, 102, 103, 104 (corrected DONE), 105..109, 111 (corrected DONE), 112, 115 — all DONE/CLOSED, plus the DECISION LOG and the Sprint 6 summary board (header range corrected) |

The 6-row `Ticket \| Spec \| Validates` e2e coverage table (originally lines 80-88 of this file, under
"POST-REVIEW FOLLOW-UPS") moved to `frontend/tests/e2e-electron/README.md`'s spec index — it was never
a ticket board (no Status column), which is exactly what made a naive grep miscount 6 closed tickets
as open. It is also preserved verbatim inside the Sprint 1 archive above.

---

## LIRA-142: PM Fee input renders on a For-Partner SEND while the payload forces the fee to 0

| Field                | Value                                             |
| --------------------- | --------------------------------------------------- |
| **Epic**              | Services / Partners                                 |
| **Type**              | UX fix (offered-but-discarded input)                |
| **Priority**          | Low                                                 |
| **Status**            | TODO                                                |
| **Affected Modules**  | OMT/Whish (Financial Services)                      |
| **Source**            | Found while building LIRA-114 §4, 2026-08-22        |

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

| Layer    | File                                                        | Change              |
| -------- | ----------------------------------------------------------- | ------------------- |
| Frontend | `frontend/src/features/services/pages/Services/index.tsx`   | Gate the PM-fee box |


---

## LIRA-143: Phone IMEI units & warranty-from-sale — NEEDS BUILD (owner-interviewed 2026-08-23)

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

### Acceptance Criteria

- [ ] Import 5 iPhone 13s: one product, stock 5, 5 scanned IMEIs (skippable, drift warning).
- [ ] Scan an IMEI barcode at POS → the model appears with that unit preselected; selling it marks
      exactly that IMEI SOLD and stamps warranty-until on the sale line + receipt.
- [ ] Selling an IMEI-carrying product without identifying the unit is impossible; a no-IMEI
      product's flow is byte-identical to today.
- [ ] Searching a sold IMEI (POS or Inventory) shows the full story incl. warranty status.
- [ ] Duplicate active IMEI rejected, named error.
- [ ] Refund returns the unit to stock; e2e proves sell+refund nets unit status, stock, and
      warranty display to the pre-sale state (rule 17: failing-first).
- [ ] Dual transport (rule 19): unit CRUD/search/lookup mirrored on REST; web e2e coverage.
- [ ] Migration in BOTH migrations/index.ts and create_db.sql (rule 10); new table gets
      id/created_at/updated_at/tenant_id (rule 5); FEATURE_GUIDE §13 walkthrough before building
      (rule 18 — this touches sales money paths via the cart line).

### Technical traps (from the diagnosis)

- `sale_items.imei` already exists — the unit link must WRITE it (keep receipts/old readers
  working) while the unit table owns the state; never two owners of "which unit sold" (§13-14).
- POS search fragments live in `ProductRepository` (~:149 and ~:705) — extend ONCE per rule 14,
  not per call site; `findByBarcode` needs the IMEI fallback for scanner flow.
- Refund restock is generic (`TransactionRepository` sale-stock restore) — the unit flip needs a
  named owner wired there, same pattern as `_reverseExchangeLotEffects` (rule 20).
- Warranty stamping at checkout must ride `sale_items` (per-line), NOT `products` — the sale is
  the event that starts the clock (owner decision #4).
