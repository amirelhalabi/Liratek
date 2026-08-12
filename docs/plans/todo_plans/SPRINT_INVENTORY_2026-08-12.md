# Sprint Inventory — 2026-08-12

> **Purpose:** one honest, deduplicated accounting of what is genuinely still open in
> `current_sprint.md` (4,378 lines), verified against git history and source code — not against
> the file's own status markers. Produced read-only; `current_sprint.md` was not touched.
>
> **Method:** every item below was checked with `git log --oneline --all | grep -i <ticket>`,
> targeted `grep`/`Read` of the code path the ticket describes, and cross-reference against
> `docs/plans/done_plans/` and `docs/plans/todo_plans/`. Where I could not resolve a claim to
> either DONE or OPEN with actual evidence, it is marked **UNKNOWN — needs owner input**, not
> guessed.

---

## 1. Verdict

**Roughly 80% of this file is historical record, not a backlog.** Of the 86 tracked items (84
numbered `LIRA-NNN` tickets across 6 sprints, plus 2 orphaned `-FU` follow-ups), **67 are correctly
closed** (DONE / CLOSED-won't-do / RESOLVED-no-code / DISREGARDED) and should never have shown up
in an "open work" count at all. Only **19 are genuinely still open**, and **2 more open items exist
in the code today with no ticket at all** (found this session, both inside the LIRA-137 commission
work). On top of that, **the file's own status markers are wrong in 6 places** — most importantly
**LIRA-090** (Telecom Days/Credit Model), which the file still lists as **NEEDS INTERVIEW / High**
under Sprint 4, but which shipped in full over three commits (2026-08-01 → 2026-08-07) and was
refined again as recently as 2026-08-11 (LIRA-113). That single stale row would have misdirected
an entire sprint's planning.

**The single most important thing actually left** is **LIRA-138** — generalising the
commission-at-settlement drawer top-up (just shipped for Katsh bills in LIRA-137) to OMT/WHISH. It
is the one open item that is: (a) correctly filed, (b) High-value (money-model correctness), and
(c) has a ready design path (`_bookCommissionAtSettlement`'s `isBillsOnlyBatch` gate already
isolates the new code, so this is additive). Everything else open is either a `NEEDS INTERVIEW`
blocked on the owner, a small display/test-coverage item, or genuinely low-priority polish.

---

## 2. Map of the file's structure (why the naive grep was garbage)

`current_sprint.md` is **6 sprints stacked chronologically with no archival**, plus 2 narrative
sections that carry no ticket board at all. A plain `grep` for `LIRA-\d+` or for table rows
matching `^\| LIRA-` hits **7 different tables** — most of them describing sprints that finished
weeks ago, and one of them (the "e2e spec-name listing") isn't a ticket table at all:

| # | Section | Lines | What it is | Ticket rows |
|---|---------|-------|------------|-------------|
| 1 | Title / legend | 1–11 | Front matter | 0 |
| 2 | PRE-MERGE REVIEW & FIXES (2026-06-19) | 12–58 | Narrative changelog, pre-dates ticket numbering | 0 |
| 3 | POST-REVIEW FOLLOW-UPS (2026-06-20) | 60–96 | Narrative **+ a 6-row `Ticket \| Spec \| Validates` table (80–88)** | 6 (no Status column — a naive "not DONE" grep would wrongly count all 6 as open even though the tickets themselves show DONE elsewhere) |
| 4 | Sprint 1 — LIRA-048..055 | 97–459 | Fully closed old sprint + "Open Follow-ups" table (449–455) | 8 ticket headers + 2 `-FU` rows |
| 5 | Sprint 2 — LIRA-056..064 | 460–921 | Fully closed old sprint, board at 900–916 | 9 |
| 6 | Sprint 3 — LIRA-065..076 | 922–1374 | Old sprint, board at 1350–1365 — **2 genuinely still open** (068, 075) | 12 |
| 7 | Backlog + Session Summary | 1375–1499 | LIRA-077 (DONE) + an untitled narrative retro with no ticket | 1 |
| 8 | Sprint 4 — LIRA-078..091,094 | 1500–2099 | Owner-notes batch, board at 2072–2090 — **8 still open, 3 NEEDS INTERVIEW** | 15 |
| 9 | Sprint 5 — LIRA-095..097 | 2100–2292 | Owner-notes batch, board at 2277–2283 — **1 still open** | 3 |
| 10 | Sprint 6 — LIRA-098..138 | 2293–4378 | **The live sprint.** Contains a DECISION LOG (3611–3634, not a ticket) and the current board (4335–4374) | 36 |

**Total ticket-shaped rows a naive grep would match: ~83**, across those 7 tables — but only
**77 distinct ticket IDs** (the e2e-spec table at #3 re-lists 6 IDs that already appear in the
Sprint 2 board, and it has no Status column at all, so a "not DONE" filter double-counts them as
open for free). That is the mechanical reason a raw grep produces a number like "68 open": it sums
row-appearances across superseded sprint boards and a non-status table, instead of deduplicating by
ticket ID and checking the ticket's own (and, as shown below, sometimes-wrong) status field.

**A second, nastier collision exists *outside* this file**: `docs/plans/todo_plans/WEB_PARITY_ROADMAP.md`
uses its own, unrelated `lira-NNN-spec-name` numbering for e2e **spec files**, assigned
chronologically as specs were written (starting mid-2026-07). Several of those numbers collide
with *later* `current_sprint.md` ticket IDs for completely different features:

| Number | `current_sprint.md` ticket (this sprint board) | Colliding web-parity spec (different, older feature) |
|---|---|---|
| 084 | Partial Keep-Change (Sprint 4, filed 2026-07-20) | `lira-084-supplier-opening-balance` (landed `bd2fde5`, 2026-07-11) |
| 096 | Partners — remove Record Transaction (Sprint 5, filed 2026-08-07) | `lira-096-debt-split-repayment` (landed `e15e311`, 2026-07-11) |
| 099 | Multi-tenant admin/impersonation e2e (Sprint 6) | `lira-099-session-debt-detail` (landed `9cb5603`, 2026-07-11) |
| 101 | PCD cleanup + `settleNetPayUsd` verification (Sprint 6) | test file renamed to reference "lira-098/lira-101" (`155f037`, cosmetic, unrelated) |

A `git log --grep=LIRA-096` (or -084/-099/-101) therefore returns commits that look like the
ticket shipped, when they are a **different, older, already-settled body of work** that happens to
share a number. I verified each of the four against the actual commit dates/content before ruling
them still-open below — this is exactly the trap the task brief warned about, just one layer
deeper (cross-file, not just cross-table).

---

## 3. THE INVENTORY — genuinely open items

Sorted by priority. "Evidence" = what I checked to confirm it is still open, not what the doc says.

| Ticket | Description | Priority | Evidence it is still open | Where it lives |
|---|---|---|---|---|
| LIRA-138 | Generalise the commission-at-settlement drawer top-up (LIRA-137) from Katsh bills to OMT/WHISH once Phase 2 (gross-payable flip) ships | Medium | `SupplierRepository._bookCommissionAtSettlement` branches only on `isBillsOnlyBatch`; grep for `commission_model = 1` shows only BILL rows are ever born with it — no OMT/WHISH code path exists yet. `git log --grep=LIRA-138` → 0 hits. | `current_sprint.md:4270–4317`; design ref `COMMISSION_AT_SETTLEMENT_PLAN.md` D13, `BILL_COMMISSION_SETTLEMENT_PLAN.md` §4 |
| LIRA-114 | "For Partner" custom service behaves like THROUGH; owner's exact click path never captured | High (narrowed) | Investigation text itself says "NEEDS INTERVIEW remains open only for (a) the owner's exact click path and (b) the THROUGH-partner inconsistency decision." **(b) is very likely already resolved** — LIRA-125 ("THROUGH legacy single-method SEND skips drawer credit", `43c7450`) matches the flagged inconsistency almost verbatim. Only **(a)**, which needs the owner in person, is a true remainder. | `current_sprint.md:2864–3018` |
| LIRA-079 | Refund scope (which txn types get Refund) + whether to remove the Void button | Medium | `git log --all \| grep -i LIRA-079` → 0 hits. `NON_REVERSIBLE_TRANSACTION_TYPES` in `packages/core/src/constants/transactionTypes.ts` unchanged; ticket is explicitly blocked on an owner interview that never happened. | `current_sprint.md:1553–1584` (Sprint 4) |
| LIRA-083 | Custom Services needs a real work-status lifecycle (today only `completed`/`voided`) | Medium | No migration past what's already in `index.ts` adds a work-status column to `custom_services`; `git log --all \| grep -i LIRA-083` → 0 hits. | `current_sprint.md:1699–1737` (Sprint 4) |
| LIRA-084 | Partial keep-change (split a computed change between "keep" and "return") in `MultiPaymentInput` | Medium | `MultiPaymentInput.tsx`'s `keepChange` is still all-or-nothing (no partial-amount UI); the one git hit for "LIRA-084" is the unrelated web-parity spec collision (see §2), dated 2026-07-11, before this ticket even existed (filed 2026-07-20). | `current_sprint.md:1739–1773` (Sprint 4) |
| LIRA-087 | Record a supplier debt without line items, attach products later | Medium | No linking table/column between a debt entry and product line items exists in the migrations file; 0 git hits. | `current_sprint.md:1845–1879` (Sprint 4) |
| LIRA-088 | Signed decrement path for MTC/Alfa provider balance (shop consumes its own credit) | Medium (Likely partially superseded) | `RechargeRepository.ts` still forces `Math.abs(data.amount)` at 6 call sites — the exact complaint. **However**, `FinancialServiceRepository.selfChargeTelecomItem` (wired to both IPC `omtHandlers.ts:178` and REST `backend/src/api/services.ts:129`, with dedicated tests) now lets the shop consume its own line's credits/validity without moving a cash drawer — this may already satisfy the "shop-SIM credits" reading the ticket itself flagged as one of two possible interpretations. The ticket's *other* reading ("resale provider-drawer balance") is not addressed. **Assumption (unverified):** I could not confirm from code alone which reading the owner meant — this is exactly why the ticket says NEEDS INTERVIEW, and it still needs the owner's confirmation, not more code archaeology. | `current_sprint.md:1881–1921` (Sprint 4) |
| LIRA-096 | Partners page — remove "Record Transaction" (redundant with Add Credit/Debt) | Low | 0 real git hits (the `LIRA-096` matches in git log are the unrelated `lira-096-debt-split-repayment` web-parity spec from 2026-07-11 — see §2 collision table); `Partners/index.tsx` still renders both actions. | `current_sprint.md:2175–2213` (Sprint 5) |
| LIRA-099 | Multi-tenant admin/impersonation e2e spec + one confirmed full-suite proof run | Medium | 0 real git hits (git log matches are the unrelated `lira-099-session-debt-detail` web-parity spec — see §2); `grep -r "impersonat" frontend/tests/` still returns nothing relevant to a super-admin e2e flow. | `current_sprint.md:2438–2476`; `MULTI_TENANT_IMPLEMENTATION_PLAN.md` WP9 |
| LIRA-101 | PCD stale-JSDoc/dead-code cleanup + independent verification of `settleNetPayUsd` under the GROSS model | Medium (one item touches money math) | The stale JSDoc lines cited by the ticket (`FinancialService.ts:41-42`, `types.ts:606,619`, `backendApi.ts:3194`) are unchanged; `DrawerTopUpRepository.getBalance()` (`:409-418`) is still present and still unused. The one git hit (`155f037`) only renames an e2e interaction-script file — it does not touch the cited files. | `current_sprint.md:2523–2571`; `PRIMARY_CASH_DRAWER_PLAN.md` §6 |
| LIRA-110 | Daily closing sums financial-services commission with zero gates (not even `is_settled`/`notRefunded`) | Medium | `ClosingRepository.ts:689-696`'s `SUM(commission)` is still ungated — confirmed by reading the cited lines; 0 git hits for LIRA-110. Same defect class as the now-fixed LIRA-108. | `current_sprint.md:3897–3934` |
| LIRA-116 | Rename the crossed `custom_services`/`omt_whish` module labels + routes (owner approved 2026-08-09) | Medium | Owner-approved but unbuilt: `create_db.sql` still shows `custom_services` → "Services" / `/custom-services` and `omt_whish` → "OMT/Whish" / `/services` (still crossed); only the filing commit (`032d890`) exists, no implementation commit. | `current_sprint.md:3745–3792` |
| LIRA-117 | No e2e spec drives the inventory-pick → stock-decrement flow via the SearchBar dropdown | Medium | The 4 specs the ticket names (`lira-088`, `-093`, `-094`, `-135`) still use `.fill()+Enter` (free-text path), never the dropdown-pick path — confirmed by the ticket's own text, and no new spec file `lira-117-*` exists in `frontend/tests/e2e-electron/`. Only the filing commit (`a95f041`) exists. | `current_sprint.md:3700–3743` |
| LIRA-058 | OMT App topup design — dual cash/owed-pool model | Medium | Blocked on an interview that never happened; 0 git hits for LIRA-058 (as a ticket — not to be confused with any coincidental substring match). | `current_sprint.md:569–606` (Sprint 2) |
| LIRA-068 | Flag a transaction as "amount changed" when edited, reconciled with the existing recharge margin-alert | Low | 0 git hits; no such indicator exists in `TransactionsViewer.tsx` or any module's `HistoryModal`. | `current_sprint.md:1050–1080` (Sprint 3) |
| LIRA-075 | Favorite/pin a page (starting with Whish App) as a home-grid quick link | Low | 0 git hits; `Dashboard.tsx`'s home grid has no pin/favorite affordance. | `current_sprint.md:1270–1298` (Sprint 3) |
| LIRA-086 | Dashboard checkpoint freshness coloring (green/orange/red vs. expected value) | Low | 0 git hits; no such coloring logic in `Dashboard.tsx`. Thresholds were never even defined (TBD in the ticket itself). | `current_sprint.md:1812–1843` (Sprint 4) |
| LIRA-054-FU | Binance rows in TransactionsViewer missing a directional badge (`service_type` never joined onto the unified row) | Low | 0 git hits for "054-FU"; no `service_type` join found near the Binance row rendering in the audit feature. **Orphaned** — never appears in any Sprint 2–6 board; only exists in the one-off "Open Follow-ups (Post-Sprint 1)" table. | `current_sprint.md:449–455` |
| LIRA-055-FU | Voucher support at session checkout needs `client_id` stored on the session (currently name/phone only) | Low | 0 git hits for "055-FU"; 0 hits for `client_id` in any session-checkout component. **Orphaned**, same as above. | `current_sprint.md:449–455` |

**Count by priority:** High (narrowed) — 1 · Medium — 12 · Low — 6. **Total: 19.**

---

## 4. Stale-marker corrections

Six real inversions, worst first.

### 4.1 LIRA-090 — doc says "NEEDS INTERVIEW / High" (Sprint 4). Reality: **DONE**, shipped 11 days before this audit.

This is the highest-value correction in this document — a High-priority row presented as
completely blocked on an owner interview, when the feature has been live since 2026-08-01 and was
touched again as recently as 2026-08-11.

- `docs/plans/done_plans/LIRA_090_HANDOFF.md`, line 3: **"STATUS 2026-08-01: COMPLETE — all gates
  green, adversarially reviewed, safe to merge."**
- Two shipping commits titled with the ticket number: `8391056` ("LIRA-090: Telecom Days & Credit
  Validity Model (MTC/Alfa Only-Days) (#67)", 2026-08-02) and `d7c9ba0` ("LIRA-090 follow-up:
  telecom days-cost model, set-primary + self-charge UI (#72)", 2026-08-05).
- The full design landed as `docs/plans/done_plans/CARRIER_LINES_VALIDITY_PLAN.md`, whose own
  header reads "**Status: COMPLETE 2026-08-07.** All waves (1–5) landed and merged to `main` via
  `dbbb710`." — i.e. the very doc the `current_sprint.md` ticket cites
  (`TELECOM_DAYS_VALIDITY_PLAN.md`) has itself been superseded and archived to `done_plans/`.
- `packages/core/src/repositories/ProfitRepository.ts:369-373` has a live code comment referencing
  **"`TELECOM_SELF_CHARGE` (LIRA-090 M3)"** as a named, shipped phase.
- It was touched again by **LIRA-113** (`eb820c7`, 2026-08-11), which explicitly reverses one of
  this plan's decisions (D12) — you cannot reverse a decision from a plan that hasn't shipped.

**Correction:** LIRA-090 should read DONE, referencing `CARRIER_LINES_VALIDITY_PLAN.md` and
`LIRA_090_HANDOFF.md`, both in `done_plans/`. Its `docs/plans/todo_plans/TELECOM_DAYS_VALIDITY_PLAN.md`
reference is also stale — that file no longer exists in `todo_plans/` (it's in `done_plans/` too).

### 4.2 / 4.3 LIRA-104 and LIRA-111 — the ticket's own detail block says TODO; the ticket's own board (350 lines later, in the same file) says DONE. Reality: **DONE**.

Both tickets' per-ticket metadata blocks (`current_sprint.md:3995` and `:3862`) still read
`**Status** | TODO`. But the Sprint 6 board at the bottom of the same file (`:4345`, `:4351`) — and
a follow-up commit — say DONE:

- `6949bc1` ("feat(backend): REST write routes now record an audit trail (LIRA-104) + /audit spec
  hygiene (LIRA-111)") wires ~92 audit call sites across 31 REST route files (LIRA-104) and adds
  the documented `/` remount bounce to all 8 named specs (LIRA-111).
- `24cead2` ("docs(plan): LIRA-104 + LIRA-111 verified green (desktop e2e 252/252)") is the proof run.

This is not a cross-file collision like §2's — it is the **same file contradicting itself**: the
detail block was written before the fix landed and was never revisited, while the summary board 350
lines below was updated after. Anyone reading top-to-bottom (i.e. hitting the detail block first)
would wrongly conclude these are open.

### 4.4 LIRA-113 — doc says TODO everywhere in the file (detail block *and* board). Reality: **DONE**.

`current_sprint.md:2794` and `:4353` both still show `TODO`. But `eb820c7`
("fix(recharge): a DAYS sale now decrements the shop line's validity too (LIRA-113)", 2026-08-11)
implements exactly what the ticket asked — decrementing the **selected** carrier line (not the
primary, per the owner's explicit correction), with 3 new rule-20 tests proving VOID/REFUND restore
`validity_expires_at` to its exact pre-sale value. This commit postdates the file's last edit to
this section — the sprint file simply was never updated after today's work shipped, which matches
the task brief's own framing ("today's session closed LIRA-113").

### 4.5 LIRA-119 — doc's own "Still OPEN" callout is stale; its ask was fulfilled by LIRA-137, three sprints down in the same file.

`current_sprint.md:3108-3111` says: *"Still OPEN: the modal now says 'Net payment: 0 LBP' and says
NOTHING about the 20,000 the operator just entered... Proposed: an explicit 'Katsh owes you 20,000
LBP' line in the settle modal."*

LIRA-137 (shipped, same file, `:4231-4245`) did exactly this for the case LIRA-119 was filed
against: *"'Total owed'/'Net payment to' dropped for this shape, replaced by '{supplier} owes you:
`<commission>`'."* LIRA-137's own metadata even says so explicitly: `**Depends On** | LIRA-112,
LIRA-119 (partial fix, superseded here)`. The doc contains the correction already — it just never
went back to close the loop on LIRA-119's own "Still OPEN" note. **Correction: LIRA-119's remaining
ask is resolved for its filed scope (bills); any true remainder is now LIRA-138 (Phase 2,
OMT/WHISH), not a separate LIRA-119 gap.**

### 4.6 Sprint 6's own summary header is out of date about its own scope.

`current_sprint.md:4319`: `## Summary (Sprint 6 — LIRA-098..107)`. The sprint's actual board four
lines above ends at LIRA-138 — the header range was written early in the sprint and never widened
as ~30 more tickets were added underneath it. Cosmetic, but exactly the kind of thing that makes a
reader stop trusting section boundaries in this file.

*(LIRA-119's PARTIAL status and LIRA-128's RESOLVED-no-code status are correctly marked as-is per
the task brief — not counted as inversions, only as confirmed via the above.)*

---

## 5. Items open but NOT ticketed

### 5.1 Profit rollup for supplier commission — stamped on the transaction, invisible on the Profits page

LIRA-137 stamps `profit_usd`/`profit_lbp` on the new `SUPPLIER_SETTLEMENT` transaction
(`SupplierRepository.ts:1243-1244`: `profit_usd: isBillsOnlyBatch ? data.commission_usd : 0`) using
"the SAME mechanism... every other commission-earning flow already uses" (per the ticket's own
text). But `ProfitRepository.ts:375-376` defines:

```
const PROFIT_TXN_TYPES =
  "'SALE', 'FINANCIAL_SERVICE', 'RECHARGE', 'CUSTOM_SERVICE', 'MAINTENANCE', 'LOTO', 'REFUND', 'TELECOM_CREDIT_BUYBACK'";
```

`SUPPLIER_SETTLEMENT` is not in that list, and I found zero references to it anywhere in
`ProfitRepository.ts`. Every profit-recognition query in that file gates on
`t.type IN (${PROFIT_TXN_TYPES})` (7 call sites checked: lines 832, 849, 984, 1355-1543). The
commission is real, profit-stamped, and permanently excluded from every Profits-page aggregate —
the exact class of bug LIRA-098's guard test was built to catch, except LIRA-098's guard only scans
for the recognition-*gate* pattern, not for a whole transaction type missing from the type-list
constant, so it did not fire here.

**Not ticketed anywhere in `current_sprint.md`.** This should be a new ticket (Medium/High —
money-correct but a real reporting gap) rather than folded into LIRA-138, since it affects the
Katsh-bills case that's *already shipped*, not just the future OMT/WHISH generalisation.

### 5.2 Settlement row shows $0.00 in the amount column; the real commission value lives only in `summary` prose

Confirmed by the code comment at `SupplierRepository.ts:1205-1227` (written during LIRA-137 itself):
*"`amount_usd`/`amount_lbp` are contractually 0/0 for this batch shape... Fixed at the summary-text
level instead of touching the shared predicate... far too broad a lever for a one-row problem."*
This is a **deliberate, documented workaround**, not an oversight — but it means the
`SUPPLIER_SETTLEMENT` row's structured `amount_usd`/`amount_lbp` columns are always 0 for a
bills-only commission settlement, and the only place the actual number (e.g. "100,000 LBP") appears
is inside a free-text `summary` string, which — by the comment's own admission — "is never
filtered" by anything. Any future export, sort-by-amount, or aggregate-by-amount view will silently
treat every one of these rows as a $0 transaction.

**Not ticketed.** Low urgency on its own (the number IS visible to a human reading the row), but it
is a landmine for any analytics/export feature (LIRA-073's DataTable export, e.g.) built later
without knowing this convention exists.

### 5.3 Older untracked items found while reading the file (for completeness)

- **LIRA-054-FU / LIRA-055-FU** (§3 above) are technically *ticketed* (they have IDs) but are
  **structurally orphaned**: they exist only in a one-off "Open Follow-ups (Post-Sprint 1)" table
  and never appear in any later Sprint 2–6 board or summary. They will keep being invisible to
  anyone who only reads sprint boards.
- **LIRA-101 §3's "money item"** (independent verification of `settleNetPayUsd` under the GROSS
  model) is itself a sub-bullet inside an already-ticketed cleanup item, not a separate gap — flagged
  here only so it isn't missed since it's the one line in that ticket that touches money math.
- The **DECISION LOG** entry (`:3611-3634`, partner-mode derivation, cancelled 2026-08-10) is
  correctly *not* a ticket — it says so explicitly ("Not a ticket. Recorded so it is not rebuilt.")
  and I confirmed via `bec11b1` that the cancellation is real and complete. No action needed; listed
  here only to confirm it was checked, not skipped.

---

## 6. Proposed cleanup (NOT executed — owner's call)

1. **Archive Sprints 1–5 wholesale.** Every ticket in Sprints 1, 2, 3, and 5 is closed; Sprint 4 has
   8 residual open items. Move Sprints 1–3 and 5 verbatim into
   `docs/plans/done_plans/SPRINT_1-3_5_ARCHIVE.md` (or split per-sprint), leaving only their
   Summary tables' final counts behind as a one-line pointer. This alone removes ~2,200 of the
   file's 4,378 lines from the "current" surface.
2. **Sprint 4: split, don't archive whole.** Carry its 8 open rows (058 is Sprint 2 but same
   pattern — see below) forward into the live board; archive the other 7 closed rows with the rest
   of Sprint 4's narrative.
3. **One board, going forward.** Keep exactly one `## Current Board` table for Sprint 6+, and retire
   the per-sprint "Summary" + "board" pairing — it's what let the Sprint 6 summary header (§4.6) go
   stale without anyone noticing, since the board 16 lines below it was still being maintained.
4. **Move the e2e spec-name table out of the ticket file entirely.** The 6-row `Ticket | Spec |
   Validates` table (lines 80–88) belongs in `frontend/tests/e2e-electron/README.md`'s coverage
   index, not in the sprint file — it has no Status column and its presence here is exactly what
   made a naive "not DONE" grep miscount 6 already-closed tickets as open.
5. **Resolve the numbering collision with `WEB_PARITY_ROADMAP.md` going forward**, either by
   giving that file's spec-numbering a distinct prefix (`WP-084` instead of `lira-084-...`) or by
   retiring it once its own specs are fully landed — right now two independent counters both emit
   `LIRA-NNN`-shaped strings, which is why `git log --grep` and plain-text search can't be trusted
   to disambiguate without also checking dates (as this audit had to do four times).
6. **Add a one-line "superseded by" cross-reference at close time.** LIRA-119's "Still OPEN" note
   (§4.5) would not have gone stale if LIRA-137, when filed, had also edited LIRA-119's own section
   to say "resolved here" instead of only recording the relationship in LIRA-137's own `Depends On`
   field, which nobody reading LIRA-119 in isolation would see.
7. **Fix the two stale-detail-block cases (LIRA-104, LIRA-111) as a matter of hygiene** — a
   reader who trusts the first status marker they see (before scrolling to the board) gets the
   wrong answer today.

The owner decides whether/when to do any of this; nothing above was executed.

---

## Appendix — full disposition of all 84 numbered tickets + 2 `-FU` items

Legend: **D** = confirmed DONE/CLOSED/RESOLVED (verified or accepted per task brief) · **O** = open (§3) ·
**S** = stale marker, corrected in §4 · **N/A** = not a ticket (narrative section).

| Range | Tickets | Disposition |
|---|---|---|
| Sprint 1 | 048–055 | D (8/8, validated in the file's own 2026-06-19 pre-merge review) |
| Sprint 1 follow-ups | 054-FU, 055-FU | O (orphaned, §5.3) |
| Sprint 2 | 056–064 | D (8/9) · **058 = O** |
| Sprint 3 | 065–076 | D (10/12) · **068, 075 = O** · 067 = DISREGARDED (decided, not open) |
| Backlog | 077 | D |
| Sprint 4 | 078–091, 094 | D (7/15) · **079, 083, 084, 086, 087, 088 = O** · **090 = S (§4.1)** |
| Sprint 5 | 095–097 | D (2/3) · **096 = O** · 097 = CLOSED-already-working (accepted) |
| Sprint 6 | 098–138 | D (mostly) · **099, 101, 110, 114 (narrowed), 116, 117, 138 = O** · **104, 111, 113, 119 = S (§4.2–4.5)** · 107 = CLOSED-won't-do, 128 = RESOLVED-no-code (both accepted per task brief, not open) |

**Totals:** 67 D · 19 O · 6 S (all also folded into the D/O count above once corrected) · 2 items
with no ticket at all (§5.1, §5.2).
