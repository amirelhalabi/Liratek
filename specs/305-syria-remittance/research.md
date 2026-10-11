# Research — LIRA-305 Syria remittance

All file:line references re-read on 2026-10-11 at HEAD `9298a863`. "Measured" = executed, not read.

## R1 — Is the plan's Route B still the job?

- **Decision**: No. Syria stays in Custom Services (Route A). Nothing from the plan's Phases 1–5 is built.
- **Rationale**: owner decisions, in order: 2026-08-10 decision log ("Syria partners are served through Custom
  Services", `current_sprint.md` ~:713); 2026-09-24 owner answer #16 = Route A
  (`docs/plans/done_plans/OWNER_NOTES_REMAINING_BUILD.md:125-138`); built in `9ed8d90f` (migration v185,
  `custom_services.direction`); 2026-09-25 "#16: … As built; no change" (`docs/plans/done_plans/OWNER_NOTES_2026-09-21.md`
  ~:1372). The plan file was never moved out of `todo_plans/`, which is why the ticket read as if nothing existed.
- **Alternatives considered**: Route B (a `supports_remittance` provider flag, re-gating
  `FinancialServiceRepository`'s RECEIVE branch, widening `FinancialServiceEntity.provider`, rewriting
  `Services.throughPartnerInvariant.test.tsx`). Rejected: contradicts three owner decisions, touches fragile OMT/Whish
  posting code, needs a migration, and would give the shop two ways to book the same thing.
- **Plan claims that have moved since 2026-09-17** (for the record; none of them is acted on): `useSystemDrawerFlow` is
  now ~`FinancialServiceRepository.ts:3069`, the wrong-direction credit ~`:3972-3990`, the FOR throw sites
  ~`:2663/:2763/:2809`, `THROUGH_PROVIDER_LEDGER_KEY` ~`:143-151` (per the 2026-09-24 scout, `OWNER_NOTES_REMAINING_BUILD.md`
  :737-741). Custom Services' `min(0)` constraint still stands — the payout is expressed by `direction`, not negatives.

## R2 — What does the as-built corridor do? (measured)

Temporary probe tests on the real schema (`create_db.sql` + `runMigrations`) and real writers, deleted after the run:

| Probe | Result |
| --- | --- |
| P1 Pay out with recipient name/phone | `client_name`/`client_phone` on the transaction row; `client_id` null when no client is picked (the page resolves one through `useSaveAsClient` before sending, `CustomServices/index.tsx:246,509`) |
| P2 Pay out 100/97 → refund, no return lines | General Δ 0, partner net 0, profit sum 0 |
| P3 Pay out → refund with a CASH 97 return line | General Δ 0, partner net 0 |
| P4 Pay out → void | General Δ 0, partner net 0 |
| P5 SEND 100/103 cash → refund | after create General +103, partner −100, profit 3; after refund 0 / 0 |
| P6 LBP Pay out 9,000,000/8,700,000 → void | mid: General −8,700,000, partner +9,000,000; after: 0 / 0 |

Existing suites run: `CustomServiceRepository.payout.test.ts`, `CustomServiceRepository.viaPartner.test.ts`,
`ProfitRepository.viaPartnerCustomServiceDeferral.test.ts` — **3 suites / 24 tests pass (0.8 s; assertions executed — the
repository's own refusal logs for the negative cases printed)**.

- **Decision**: no change to booking, void or refund.
- **Note**: two existing Pay out e2e specs carry a "NOT RUN" header from 2026-09-25 and no recorded green run was found;
  their status is **unverified**. Tasks re-run the web one; the desktop one is CI-only (G5).

## R3 — The netting gap (measured)

Probe 2 (same harness, deleted afterwards), partner "7welet souria", USD, Profits `getByModule` CUSTOM_SERVICE:

| Case | Partner balance at the end | Profit today | Expected |
| --- | --- | --- | --- |
| Q1 SEND 150/155 + Pay out 100/97, shop settles 50 (DEBIT) | 0 | **5** | 8 |
| Q2 SEND 100/103 + Pay out 100/97, nothing settled | 0 | **3** | 6 |
| Q3 SEND 40/42 + Pay out 100/97, partner settles 60 (CREDIT) | 0 | **3.8** (2 + 1.8) | 5 |

Cause (read, consistent with the measurements): `PartnerRepository.applySettlementCoverage` (:444-497) stamps
`covered_amount` on obligation heads only from a SETTLEMENT / DISCOUNT / `applyCoverage` row of the opposite direction.
A SEND's `THROUGH_CUSTOM_SERVICE` CREDIT is deliberately not an obligation (`constants/partnerObligation.ts:21-31`) and
never a coverage source, so a Pay out DEBIT netted by SENDs is never stamped; the profit fragments
(`partnerCoverageRatioWhereSql` :172-192, `partnerUncoveredExistsWhereSql` :199-206) read only that stamp.

## R4 — How to count netting

- **Decision**: a **read-time** rule, defined once in `packages/core/src/constants/partnerObligation.ts` as
  `partnerEffectiveCoveredSql(alias)` and used by both existing fragments in place of the raw `covered_amount`.
  For a Pay out head `h` (partner P, currency C, tenant T):
  - **netting balance `N`** (`partnerNettingBalanceSql`, exported from the same file — the ONE definition, rule 14) =
    the partner's balance in C (Σ DEBIT − Σ CREDIT, as `PartnerRepository.getBalance` :949-975) **minus only the paper
    credits**: a CREDIT row that is the source of a `PARTNER_ADJUSTMENT` transaction (`source_table = 'partner_ledger'`,
    `source_id = row.id` — a manual entry with "Cash moved" off, `PartnerRepository.recordAdjustmentTransaction`
    :708-740) is left out. Every other row counts in both directions — obligations, settlements, discounts, cash-moved
    entries, `WHISH_TOPUP` (a live writer, `RechargeRepository.topUpFromPartner`), and every reversal row. Why this
    shape (analyze pass 2, H-1): a reversal row never carries its own `PARTNER_ADJUSTMENT` link, so it always counts,
    exactly like its original; and `PARTNER_ADJUSTMENT` is non-reversible, so excluded paper rows never have reversals.
    A first draft that whitelisted credit *types* instead broke this symmetry — voiding a cash-moved debit or a
    `WHISH_TOPUP` left the commission stuck (executed: 6 → 4.5 → 4.5 and 6 → 6 → 4.8). It also let a paper credit
    typed `THROUGH_%` through (pass 2, M-1); the link-based rule catches any type. With no paper credits, `N` equals
    `getBalance`; otherwise `N` is larger — profit later, never earlier (Y13, analyze H1). Paper *debits* still count
    (they keep profit waiting — the safe side). **Legacy paper credits** (manual entries from before LIRA-066, which have
    no transactions row at all) are excluded too: a CREDIT with no reference that is not a SETTLEMENT/DISCOUNT and has no
    `PARTNER_PAYMENT`/`PARTNER_SETTLEMENT` link (analyze pass 3 H-2, executed 3 → 0). They cannot be voided, so the
    symmetry argument still holds. Both `transactions` look-ups carry a unary `+` on `tenant_id` so SQLite uses
    `idx_transactions_source` — without it the query plan scans `transactions` per CREDIT row (pass 3 H-1: 14.7 s /
    56 s).
  - **uncovered `unc(x)`** for a Pay out head = `MAX(0, MIN(x.amount, groupNet(x)) − x.covered_amount)`, where
    `groupNet` sums the head's own `THROUGH_CUSTOM_SERVICE` rows (same `reference_table`/`reference_id`/currency, DEBIT +,
    CREDIT −) **filtered by `partner_id` and `tenant_id` too** so the `idx_partner_ledger_partner_id` index is used. For a
    single-head Pay out group this equals `partnerObligationCoverableSql(x) − MIN(covered, coverable)`; T004 (o) pins that
    equality (rule 14).
  - **newer sum**: one grouped pass over P/C/T's `THROUGH_CUSTOM_SERVICE` rows with `reference_table = 'custom_services'`,
    `GROUP BY reference_id`, keeping groups whose first row (lowest id) is a DEBIT (= Pay out groups, the same "first row
    decides" rule `partnerObligationRowSql` uses), each with its `unc`, its head id and head time; summed over groups whose
    head is **newer** than `h` — ordered by `julianday(created_at)` then `id` (rows carry two text formats, ISO `…T…Z` from
    a `transaction_time` and `YYYY-MM-DD HH:MM:SS` from `CURRENT_TIMESTAMP`; plain text order puts 09:00Z after 10:00 —
    measured, analyze M1).
  - **held(h)** = `MAX(0, MIN(unc(h), MAX(0, N) − newerSum(h)))`; **effective covered(h)** = `coverable(h) − held(h)`,
    with a short-circuit: when `N ≤ 0.005` effective covered = `coverable(h)` (nothing is owed).
  - Any other head: effective covered = `MIN(covered_amount, coverable)` (unchanged).
- **Rationale**:
  - The netting balance is the net of cash and of what the shop really owes, so "the partner owes U" is the RECEIVE money
    still unpaid. Holding U on the newest RECEIVEs = oldest counts first, the FIFO every other coverage path uses.
  - Nothing is stored → no new reversal owner (rule 20 holds by construction: voiding a SEND, a RECEIVE or a settlement
    changes `N` or the heads and the next read re-derives).
  - Cash stamps keep their meaning (`applySettlementCoverage`, `_unwindPartnerSettlementCoverage` untouched), so FOR rows
    of every module behave exactly as today (FR-005).
  - Hand-checked against every T004 case (the first analyze pass re-derived all of them independently and executed (b),
    (c), (e) — all match): Q1 N=0 → 3 of 3; Q2 same; Q3 before settling N=60 → held 60 → 40% (1.20), after N=0 → 100%;
    "SEND paid in cash, then RECEIVE" N=100 → 0%; existing G16 tests unchanged (lone payout N=100 → 0; partner pays 50 →
    N=50, unc 50 → 50% = 1.5; void that settlement → 0).
- **Alternatives considered**:
  1. *First draft of this rule* — per-head nested `partnerObligationCoverableSql` / `partnerObligationHeadRowSql` inside
     the newer-heads sub-query. Correct numbers, but **measured 37.5 s** (300+300 rows, 7 evaluations per row as
     `getCustomServiceTotals` does) and **104.9 s** with 150 unpaid RECEIVEs: those nested sub-queries filter on
     reference/type/currency, which no index covers, so each head costs O(N²). Rejected (analyze C1).
  2. *Write-time offset stamps* with an allocation table. Exact and fast to read, but needs a migration, a new table, four
     new write sites and a new reversal owner per site. Rejected: more money code, harder to undo.
  3. *Operator "Net off" button* writing a zero-cash SETTLEMENT pair. Rejected: new UI and ledger rows; Q2 still needs a
     click.
  4. *Count the RECEIVE commission immediately*. Rejected: reverses owner decision D5 (2026-10-06).
  5. *Use `getBalance` as is* (paper credits included). Rejected: a paper "shop owes partner 500" opening entry would
     release every RECEIVE with no money moved — measured 0 → 100% by the first analyze pass (H1); contradicts PFT-7b
     ("paper entries never cover").
  6. *Add an index on `partner_ledger(reference_table, reference_id)`*. Helps, but needs migration v210 and alone measured
     8.1 s with unpaid RECEIVEs. Not needed with the grouped pass.

## R5 — Performance of the read-time rule (measured)

Prototype of the R4 SQL (grouped newer sum, `julianday` order, `N ≤ 0` short-circuit), run with `node` on an in-memory
DB built from `create_db.sql`, `THROUGH_CUSTOM_SERVICE` rows inserted directly, effective coverage evaluated for every
Pay out head 7 times (as `getCustomServiceTotals` does). This first prototype used the plain balance (no paper filter);
the final shape's full-path numbers are further down (pass 3):

| Partner history | Account | Time (7 × all heads) |
| --- | --- | --- |
| 300 SEND + 300 RECEIVE | square (N = 0) | **98 ms** |
| 300 SEND + 450 RECEIVE | partner owes 1,500 | **1,873 ms** (effective total 3,000 of 4,500 — correct) |
| 1,000 SEND + 1,300 RECEIVE | partner owes 3,000 | **15,805 ms** for all 1,300 heads (≈ 1.7 ms per head evaluation) |

- **Decision**: accept. A Profits read evaluates only the RECEIVEs inside its date range (a month is tens, not
  thousands), each costing ~1–2 ms at a 2,000-row corridor history. SC-004 is set to the measured shape with headroom:
  (k) square account < 3 s, (k2) partner owes < 10 s, both through `getByModule` in jest.
- **Full-path measurement (analyze pass 2, executed with the T006 shape patched into the compiled core, real writers):**
  `getByModule` (k) **0.94–0.96 s**, (k2) **3.9–4.3 s** on this Mac — the fragment-only numbers above understate the full
  path ~10× / ~2.3×. An index on `(partner_id, transaction_type, currency)` measured 3.8 s (≈3% better), one on
  `(reference_table, reference_id)` 3.1 s. Decision (delegated, G4): keep no migration; T006 adds the cheap guards
  (skip the newer-sum when the head is already cash-covered or `N ≤ 0`) and T007 re-measures; the (k2) budget is
  **10 s** to leave CI headroom. The index migration stays a recorded fallback for the owner, not built.
- **Pass 3 (final shape, with the paper-credit filter, the legacy arm and the `+tenant_id` hint, executed on the patched
  compiled core):** (k) **1.08 s**, (k2) **4.22 s**. Without the `+` hint: 14.7 s / 56 s (wrong plan). `N` and `unc` are
  evaluated up to twice per head (SQLite does not merge repeated correlated sub-queries); these timings include that.
- **Fallback if (k2) fails on CI**: migration v210 adding `idx_partner_ledger_reference(reference_table, reference_id)`
  (measured best of the two, 3.1 s) to both `migrations/index.ts` and `create_db.sql` (rule 10) — a follow-up decision
  for the owner, not built now.

## R6 — Transport parity, schema, browser entry

- No new or changed IPC channel, REST route, preload binding, `electron.d.ts` type, adapter function or Zod schema: the
  Profits routes (`backend/src/api/profits.ts:160-270`) and handlers already call `ProfitService`, which reads the shared
  fragments. Both transports get the rule from the same core (rule 19).
- `constants/partnerObligation.ts` is not exported from `browser.ts` or `index.ts` (grep, 2026-10-11) and imports
  nothing — rule 29 is unaffected.
- Rule 27: the rule reads no clock and no day.
- Migration: none. Last migration is **v209** (`packages/core/src/db/migrations/index.ts:14369`).
- `check-tenant-scoping` does **not** scan `packages/core/src/constants/` (it scans `repositories/`, `services/`, `utils/`
  and `backend/src`, `scripts/check-tenant-scoping.mjs:77-82`), so its "0 violations" proves nothing about the new
  fragment. Every new sub-query must carry `tenant_id = <alias>.tenant_id` explicitly, and T004 (n) asserts it on the
  generated SQL string. (`partner_ledger.tenant_id` is backfilled to 1 by the tenant migration and set by every writer.)

## R7 — Next free e2e numbers

- Web: `lira-web-054` (053 is the last, `frontend/tests/e2e-web/`). Desktop twin: `lira-305-syria-corridor-netting`
  (no `lira-305*` exists in `frontend/tests/e2e-electron/`).

## R8 — Analyze passes

See `tasks.md` → "Analyze record" (pass 1: 1 CRITICAL, 2 HIGH, 8 MEDIUM, 6 LOW — all CRITICAL/HIGH fixed here and in
tasks; pass 2 result recorded there too).

### Baseline (T001, 2026-10-11, before any LIRA-305 source change)

- Regression nets (core jest): `ProfitRepository.viaPartnerCustomServiceDeferral`, `CustomServiceRepository.payout`,
  `CustomServiceRepository.viaPartner`, the four `ProfitRepository.partnerProportional*`, `partnerLedgerTypes.guard`,
  `browserEntryIsNodeFree.guard` → **9 suites, 71 tests passed**, jest time 1.09 s (1.6 s wall; warm cache — 71 real
  test results reported, so the assertions executed).
- Last migration: **v209** (`packages/core/src/db/migrations/index.ts:14369`).
- Channels confirmed by grep in `electron-app/handlers/`: `custom-services:add`, `custom-services:delete`,
  `transactions:void`, `transactions:refund`, `partners:settle`, `partners:get-balance`, `partners:get-ledger`,
  `profits:by-module`, `profits:unlock`. REST confirmed: `POST /api/custom-services` (`customServices.ts:230`),
  `DELETE /api/custom-services/:id` (:275), `POST /api/transactions/:id/void` (`transactions.ts:234`),
  `POST /api/partners/settle` (`partners.ts:190`), `GET /api/partners/:id/balance` (:59),
  `GET /api/profits/by-module` (`profits.ts:175`).

## R9 — Known limits left as they are (out of scope, recorded)

- **Mixed-currency rows** (pre-existing, analyze L2): `partnerCoverageRatioWhereSql` weighs one source row's USD and LBP
  heads together, so a RECEIVE with both currencies gets one blended ratio. FR-006 holds for netting itself (USD nets only
  with USD); the blended ratio is older behaviour, unchanged.
- **Pay out in a basket** (analyze L3): only the page stops a Pay out from joining a session basket
  (`CustomServices/index.tsx:543`); in the repository the `deferPayment` branch comes before the payout branch
  (`CustomServiceRepository.ts:744` vs `:751`), so a scripted basket Pay out would post no cash-out leg. Unverified
  invariant, unchanged by this ticket; noted for a future ticket.
- **Legacy paper entries** written before LIRA-066 have no `PARTNER_ADJUSTMENT` row. R4's legacy arm leaves out a legacy
  paper CREDIT (no reference, not SETTLEMENT/DISCOUNT, no cash link); a legacy paper DEBIT still counts (keeps profit
  later). Whether any real shop has such rows is unverified; owner decision D10 (2026-10-06) reset old data.
- **Paper SETTLEMENT/DISCOUNT entries** (pre-existing, analyze pass 3 L-4): a manual entry typed `SETTLEMENT` or
  `DISCOUNT` with "Cash moved" off already stamps cash coverage today (`addLedgerEntry` triggers coverage by type), so it
  already releases FOR / Pay out profit. Unchanged by this ticket; noted for a future one.
