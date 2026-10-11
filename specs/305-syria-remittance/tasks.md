---
description: "Task list for LIRA-305 — Syria remittance (send and receive through a partner)"
---

# Tasks: Syria remittance — send and receive through a partner (LIRA-305)

**Input**: `specs/305-syria-remittance/` — spec.md, plan.md, research.md (R1–R9), data-model.md,
contracts/partner-effective-coverage.md, quickstart.md

**Prerequisites**: read CLAUDE.md rules 13–30, `docs/FEATURE_GUIDE.md` §8, §9, §10, §13 and the Counterparty checklist,
`docs/COUNTERPARTY_LEDGERS.md` §3/§5/§6, and research.md R3–R4 (what is measured broken and why the read-time rule).

**Scope reminder (do not widen)**: both directions already exist (Custom Services → Via Partner, and Via Partner +
Pay out). Route B of the old plan is **not** built. The only behaviour change is one read-time rule in
`packages/core/src/constants/partnerObligation.ts`. No migration (stays v209), no IPC/REST/preload/adapter/schema/UI
change. If a task seems to need one of those, stop and record why in its completion note instead of building it.

**Tests**: REQUIRED. CLAUDE.md rule 17 — every guard test is written first and **run red against the unfixed code; paste
the real failure lines into the task's completion note** before its implementation task starts. Never revert, stash or
re-break finished code to prove a test. A test that cannot be red first (a regression net) must say "not proven
failing-first".

**Commands** (repo root, Mac):
- ABI probe first: `node -e "const D=require('better-sqlite3'); new D(':memory:'); console.log('Node ABI')"`. If it
  throws, `yarn rebuild:node` — but **not while another e2e run is active** (it swaps the native binary under it).
- core: `yarn workspace @liratek/core test --runTestsByPath <path relative to packages/core>` (fallback:
  `cd packages/core && npx jest <path>`)
- backend: `yarn workspace @liratek/backend test`; electron handlers: `yarn workspace @liratek/electron-app test`;
  frontend: `yarn workspace @liratek/frontend test`
- core build & sync after ANY core edit (backend, web e2e and electron read the copy, not the source):
  `cd packages/core && npm run build` then from root `cp -r packages/core/dist/. node_modules/@liratek/core/dist/`
- web e2e: `node scripts/run-e2e.mjs web -g "<title or file>"`; known-good fallback from an agent shell:
  `cd frontend && npx playwright test --config playwright.web.config.ts <file> --reporter=list`
- Confirm every green run executed the new `it(...)`/`test(...)` titles and note elapsed time (rule 28a).

**Never** run desktop e2e or launch Electron on this Mac. Never `git commit` / push / `gh` (the parent commits).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 = netted RECEIVE commission counts (P1), US2 = both directions end to end on both apps (P2),
  US3 = documents match the app (P3)

---

## Phase 1: Setup

**Purpose**: record the baseline and stop anyone from building the superseded plan.

- [ ] T001 Baseline. Run and record suite/test counts + elapsed time in a "Baseline" note appended to `specs/305-syria-remittance/research.md` (section R8): core `src/repositories/__tests__/ProfitRepository.viaPartnerCustomServiceDeferral.test.ts`, `src/repositories/__tests__/CustomServiceRepository.payout.test.ts`, `src/repositories/__tests__/CustomServiceRepository.viaPartner.test.ts`, every `src/repositories/__tests__/ProfitRepository.partnerProportional*.test.ts`, `src/constants/__tests__/partnerLedgerTypes.guard.test.ts`, `src/__tests__/browserEntryIsNodeFree.guard.test.ts`. Also: (a) confirm the last entry in `packages/core/src/db/migrations/index.ts` is still **v209** (`grep -nE "version: 2[0-9][0-9]," packages/core/src/db/migrations/index.ts | tail -1`); (b) confirm by grep that the channels/routes listed in `specs/305-syria-remittance/contracts/partner-effective-coverage.md` still exist (`custom-services:add`, `custom-services:delete`, `transactions:void`, `transactions:refund`, `partners:settle`, `partners:get-balance`, `partners:get-ledger`, `profits:by-module`, `profits:unlock`; REST `POST /api/custom-services`, `DELETE /api/custom-services/:id`, `POST /api/transactions/:id/void`, `POST /api/partners/settle`, `GET /api/partners/:id/balance`, `GET /api/profits/by-module`).
- [ ] T002 [P] Archive the superseded plan: `git mv docs/plans/todo_plans/SYRIA_REMITTANCE_PLAN.md docs/plans/done_plans/SYRIA_REMITTANCE_PLAN.md`; replace the short "SUPERSEDED" banner already at its top with the final one: "Superseded — not built. The owner chose Route A (Custom Services → Via Partner, Pay out) on 2026-09-24 (owner notes #16), shipped in `9ed8d90f` / v185, confirmed 'as built — no change' 2026-09-25. LIRA-305 (`specs/305-syria-remittance/`) added the netting rule and the end-to-end proof." Then `grep -rn "todo_plans/SYRIA_REMITTANCE_PLAN" docs current_sprint.md CLAUDE.md` and repoint each hit to `done_plans/`; update the board entry in `docs/plans/ongoing_plans/PLAN_OVERVIEW.md` (move it to done, adjust the board count).

---

## Phase 2: Foundational (blocks US1 and US2)

**Purpose**: make sure the copies the backend and the e2e servers load match HEAD before any red run.

- [ ] T003 Build and sync core from the **unchanged** source (`cd packages/core && npm run build`, then `cp -r packages/core/dist/. node_modules/@liratek/core/dist/`), and confirm `node_modules/@liratek/core` is a real directory (not a symlink) with `ls -la node_modules/@liratek/`. Record in the completion note. This makes the T005 red run test today's code, not a stale build.

---

## Phase 3: User Story 1 — the RECEIVE commission counts when the corridor nets out (Priority: P1) 🎯 MVP

**Goal**: FR-001…FR-008. A Pay out's commission counts once the partner's account (same currency) no longer owes that
money, cash or netting; oldest Pay out first; nothing stored.

**Independent Test**: `ProfitRepository.syriaCorridorNetting.test.ts` green; `lira-web-054` green over REST.

### Tests for User Story 1 (write first, run red) ⚠️

- [ ] T004 [US1] Create `packages/core/src/repositories/__tests__/ProfitRepository.syriaCorridorNetting.test.ts`. Harness: copy the one in `ProfitRepository.viaPartnerCustomServiceDeferral.test.ts` exactly (fresh `:memory:` DB from `electron-app/create_db.sql`, `globalThis.__LIRATEK_TEST_DB__`, `runWithTenant(1, …)`, `resetTransactionRepository()`, inputs parsed through `createCustomServiceSchema.parse(...)` so field names come from the schema (rule 24), `PartnerService.settle`, profit read = `new ProfitService(new ProfitRepository()).getByModule(DAY, DAY)` row `module === "CUSTOM_SERVICE"` `profit_usd`/`profit_lbp`). Helpers: `send(cost, price, currency, time?)` = Via Partner with one CASH IN leg of `price` in `payments`; `receive(arrived, paidOut, currency, time?)` = Via Partner + `direction: "OUT"`; `transaction_time` on DAY (ISO), distinct times when order matters. One partner per test (`INSERT INTO partners (tenant_id, name) VALUES (1, '7welet souria')`). Cases — value after the fix, and **today's value** (R = red today, G = green today, a regression net "not proven failing-first"):
  - (a) shop is net payer: send(150,155) + receive(100,97) → **8** already before settling (partner balance −50: the shop owes, so nothing is held — the "partner overpays" edge case); then the shop settles 50 (`settle` picks DEBIT) → still **8**, partner balance 0. R (today 5).
  - (b) balanced: send(100,103) + receive(100,97), no settlement → **6**. R (today 3). In the same case also assert `getByDate(DAY, DAY)` and `getByUser(DAY, DAY)` (check exact signatures in `ProfitService.ts`) include the +3 (FR-004). R.
  - (c) partner is net payer: send(40,42) + receive(100,97) → **3.2** before settling (2 + 40% of 3); partner settles 60 (CREDIT) → **5**. R (today 2, then 3.8).
  - (d) SEND paid in cash first: send(100,103); settle 100 (DEBIT); then receive(100,97) → **3** (partner really owes 100). G.
  - (e) oldest first: receive(100,97) at 09:00Z, receive(100,96) at 10:00Z, send(100,103) at 11:00Z → partner owes 100 → the 10:00 receive is held → **6** (3 + 3). R (today 3).
  - (f) currencies never net: send(100,103,"USD") + receive(9_000_000, 8_700_000, "LBP") → `profit_lbp` **0**, `profit_usd` **3**. G.
  - (g) For Partner untouched: a For Partner custom service (`partnerMode: "FOR"`, price 100, cost 90, no payments) + send(200,205) on the same partner → the FOR row's 10 still **not** counted; total **5**. G (FR-005).
  - (h) reversal re-derives (FR-007), each from a fresh setup: from (b) void the SEND (`getTransactionRepository().voidTransaction(sendTxnId, 1)`) → **0** (G today, R-then-G across the fix is not observable — label it a net); from (c) after the 60 settlement, void the settlement's PARTNER_SETTLEMENT transaction (`getBySourceId("partner_ledger", entry.id)`) → **3.2** (R today: 2); from (b) refund the RECEIVE (`refundTransaction(recvTxnId, 1)`) → **3** (G — refunded rows are excluded by `notRefunded`); LBP: book receive(9_000_000, 8_700_000, "LBP") + send(9_000_000, 9_300_000, "LBP"), assert `profit_lbp` 600,000 (R today: 300,000), void the RECEIVE → 300,000 (G). After each void/refund also assert General drawer and partner balance equal their values before the voided row was created, per currency.
  - (i) invariants (data-model.md 1–4), read per head directly: `SELECT plr.id, ${partnerEffectiveCoveredSql("plr")} AS eff, ${partnerObligationCoverableSql("plr")} AS cov, MIN(plr.covered_amount, ${partnerObligationCoverableSql("plr")}) AS cash FROM partner_ledger plr WHERE ${partnerObligationHeadRowSql("plr")}` (import the fragments from `../../constants/partnerObligation`) over the end states of (a)–(e) and (g): `0 ≤ eff ≤ cov`, `eff ≥ cash`, non-Pay-out heads `eff === cash`, and Σ(cov − eff) over Pay out heads = `MIN(MAX(0, N), Σ(cov − cash))` with `N` read via `partnerNettingBalanceSql`. Also the existing G16 numbers: a lone receive(100,97) → **0**; plus a 50 partner settlement → **1.5**. Compile error today (fragments do not exist) — record it as the red.
  - (j) deferred bucket agrees (one-bucket rule): after (b), `new ProfitRepository().getDeferredProfit(`${DAY} 00:00:00`, `${DAY} 23:59:59`).partner_profit_usd` (`ProfitRepository.ts:5334`; its `dateRange` compares `datetime(col)` to the bounds, so bare `DAY` bounds return 0 whatever the code does — always pass the full-day bounds) is **0**, and realized + deferred = 6. Control in the same case: a lone receive(100,97) on another partner gives deferred **3**. R (today deferred 3).
  - (k) performance, account square (SC-004): 300 send(10,11) + 300 receive(10,9.7), alternating times → `getByModule` in **< 3000 ms** (`performance.now()`), profit **390** (`toBeCloseTo`, 2 decimals). R on value (today 300).
  - (k2) performance, partner owes: the (k) rows + 150 more receive(10,9.7) → **< 10000 ms**, profit **390** (300 SENDs × 1 + 300 netted receives × 0.3; the 150 newest receives are held, 45 not counted), and `getDeferredProfit(`${DAY} 00:00:00`, `${DAY} 23:59:59`).partner_profit_usd` ≈ **45** (`toBeCloseTo`). R on value (today 300).
  - (l) paper credits never release profit (Y13): receive(100,97) + a paper manual CREDIT of 100 (`new PartnerService(new PartnerRepository()).recordPartnerTransaction({ partnerId, transactionType: "ADJUSTMENT", amount: 100, currency: "USD", direction: "CREDIT", userId: 1, moveCash: false })` — `transactionType` is required in practice: `partner_ledger.transaction_type` is NOT NULL) → **0**; the same with `moveCash: true` → **3**; and a paper CREDIT typed `THROUGH_OMT_SEND` (allowed by `partnerRecordTransactionSchema`) → still **0** (the rule keys on the `PARTNER_ADJUSTMENT` link, not the type). (l-legacy): receive(100,97) + a legacy manual CREDIT of 100 inserted **directly** into `partner_ledger` (`transaction_type 'ADJUSTMENT'`, `reference_table NULL`, no transactions row — the pre-LIRA-066 shape) → **0**. R once the link-based rule exists without the legacy arm (executed 3 in analyze pass 3); G today. G for both today (paper: 0; cash-moved: 3, because a cash-moved entry already applies settlement coverage) — this case guards that the new rule does not change either.
  - (m) time formats: receive(100,97) at 09:00Z and receive(100,96) at 10:00Z (both ISO, on DAY), then send(100,103) at 11:00Z; then rewrite only the 10:00 receive's `partner_ledger.created_at` to the space format `${DAY} 10:00:00` with one `UPDATE` (simulates a row written with `CURRENT_TIMESTAMP`). Expected: the 10:00 receive (newer in real time) is held → profit **6** (3 + 3). With text ordering the ISO 09:00Z row would sort as newer, the 09:00 receive would be held and the result would be **7** (4 + 3) — that is the failure this case catches. R today (3).
  - (n) tenant scoping on the SQL string (check-tenant-scoping does not scan `constants/`): for each NEW sub-query — `plb` in `partnerNettingBalanceSql("x")`, `ph` in `partnerPayoutUncoveredSql("x")`, `pg` in `payoutNewerSumSql("x")`, and `plb_tx` / `plb_tx2` — assert the string contains `<inner>.tenant_id = x.tenant_id` (or `+plb_tx.tenant_id = plb.tenant_id` / `+plb_tx2.tenant_id = plb.tenant_id`). Do not count the inherited coverable / head fragments (reference-keyed by design). Today: `TypeError: … is not a function` in this case only (new API — not proven failing-first by a figure).
  - (o) rule-14 pins: for every Pay out head in the end states of (a)–(e), `partnerPayoutUncoveredSql` equals `cov − cash` from (i); and `payoutNewerSumSql(head)` equals the JS sum of `partnerPayoutUncoveredSql` over the Pay out heads newer by (julianday(created_at), id). Today: `TypeError: … is not a function` in this case only (new API — not proven failing-first by a figure).
  - (p) netting balance pin: with no paper credits, `partnerNettingBalanceSql` equals `PartnerRepository.getBalance(partnerId).usd`; after one paper CREDIT of 100 (`transactionType: "ADJUSTMENT"`, `moveCash: false`) it is exactly 100 higher than `getBalance`. Today: `TypeError: … is not a function` in this case only (new API — not proven failing-first by a figure).
  - (q) void of a cash-moved entry is symmetric (FR-007, analyze pass 2 H-1): on the (b) corridor (profit 6), record a cash-moved DEBIT of 50 (`moveCash: true`, `transactionType: "ADJUSTMENT"`) → profit **4.5** (partner owes 50 → half the receive held); void its PARTNER_PAYMENT transaction (`getBySourceId("partner_ledger", entry.id)` → `voidTransaction`) → profit back to **6**, General and partner balance back to their values before the entry. Today: 3 → 3 → 3 (G, but it must stay symmetric after the fix — a type-whitelist design gives 6 → 4.5 → 4.5).
  - (r) `WHISH_TOPUP` counts and its void is symmetric: on the (b) corridor, top up the Whish App wallet from the same partner for 40 via `RechargeService.topUpFromPartner({ provider: "WHISH_APP", partnerId, amount: 40, currency: "USD", userId: 1 })` (it returns `{ success }` without an id: find the RECHARGE_TOPUP with `getBySourceId("recharges", <MAX(recharges.id)>)`) → partner CREDIT 40 → profit stays **6**; void that top-up → still **6**, and the partner balance is back to 0. A type-whitelist design gives 6 → 6 → 4.8.
  - (t) query plan (deterministic perf guard, CI-safe): run `EXPLAIN QUERY PLAN SELECT ${partnerNettingBalanceSql("x")} FROM partner_ledger x` on the (k) fixture and assert the `plb_tx` / `plb_tx2` lookups use `idx_transactions_source` (not `idx_transactions_tenant_id`). Today: `TypeError: … is not a function` in this case only (new API — not proven failing-first by a figure).
  - (s) a voided receive frees the SEND: from (b), void the RECEIVE, then book a new receive(100,97) → profit **6** again (the SEND nets the new receive).
  Run it on today's code (no source change); paste the failing lines and the green regression nets into the completion note, exactly as labelled above. Core jest runs ts-jest with `isolatedModules: true` (`packages/core/jest.config.cjs`) — no type-check — so importing the not-yet-existing fragments leaves them `undefined` and only (i), (n), (o), (p), (t) throw; every behaviour case still runs and must show its real figure (5 ≠ 8, 3 ≠ 6, 3.8 ≠ 5, …). If the whole file errors at setup instead, that is not a red — fix the harness first (rule 28a). `yarn typecheck` will fail until T006 lands; that is expected during the red step only.
- [ ] T005 [US1] Create `frontend/tests/e2e-web/lira-web-054-syria-corridor.spec.ts` (REST, pattern of `lira-web-custom-service-payout.spec.ts` + the Profits unlock block of `lira-web-052-omt-commission-settlement-void.spec.ts`). One test: login admin; set/unlock the Profits password (copy the block under the `// ── Profits gate` comment in lira-web-052 — anchor by that comment, its line numbers may move); create a fresh partner `L-web 7welet souria ${Date.now()}` via `POST /api/partners`; helpers: General USD from `GET /api/dashboard/drawer-balances` (`balances.generalDrawer.usd`), partner USD from `GET /api/partners/:id/balance` (`balance.usd`), Custom Services profit from `GET /api/profits/by-module?from=2000-01-01&to=2100-01-01` (`data.find(r => r.module === "CUSTOM_SERVICE").profit_usd`; wide window — rule 27). Steps, asserting **deltas** from a snapshot taken right before each step (rule 15): (1) SEND `POST /api/custom-services` `{description, cost_usd: 100, price_usd: 103, partnerId, partnerMode: "VIA", payments: [{method: "CASH", currency_code: "USD", amount: 103}]}` → General +103, partner −100, profit +3; (2) RECEIVE `{description, price_usd: 100, cost_usd: 97, partnerId, partnerMode: "VIA", direction: "OUT"}` → General −97, partner +100 (now 0), profit **+3** (the netting — red today, +0); (3) find the RECEIVE's transaction by identity (`GET /api/transactions/recent?limit=50&source_table=custom_services`, `source_id === id`) and void it with `POST /api/transactions/:id/void` → General +97, partner −100, profit −3; (4) void the SEND with `DELETE /api/custom-services/:id` → General −103, partner +100, profit −3; final values equal the starting snapshot. Run it against today's backend (core synced in T003) and paste the real failure (step 2 profit delta 0 ≠ 3) into the completion note. Do not run while another e2e run is active.

### Implementation for User Story 1

- [ ] T006 [US1] In `packages/core/src/constants/partnerObligation.ts` add, export and document (research R4, contract doc, data-model.md):
  - `partnerNettingBalanceSql(alias)` = `(SELECT COALESCE(SUM(CASE WHEN plb.direction = 'DEBIT' THEN plb.amount WHEN EXISTS (SELECT 1 FROM transactions plb_tx WHERE plb_tx.type = 'PARTNER_ADJUSTMENT' AND plb_tx.source_table = 'partner_ledger' AND plb_tx.source_id = plb.id AND +plb_tx.tenant_id = plb.tenant_id) THEN 0 WHEN plb.reference_table IS NULL AND COALESCE(plb.transaction_type, '') NOT IN ('SETTLEMENT', 'DISCOUNT') AND NOT EXISTS (SELECT 1 FROM transactions plb_tx2 WHERE plb_tx2.type IN ('PARTNER_PAYMENT', 'PARTNER_SETTLEMENT') AND plb_tx2.source_table = 'partner_ledger' AND plb_tx2.source_id = plb.id AND +plb_tx2.tenant_id = plb.tenant_id) THEN 0 ELSE -plb.amount END), 0) FROM partner_ledger plb WHERE plb.partner_id = ${alias}.partner_id AND plb.currency = ${alias}.currency AND plb.tenant_id = ${alias}.tenant_id)` — the full balance minus paper credits only: (1) a CREDIT that sources a `PARTNER_ADJUSTMENT` transaction (`recordAdjustmentTransaction`, `PartnerRepository.ts` ~:719-721; non-reversible), and (2) a **legacy** manual CREDIT written before LIRA-066 — no reference, not a SETTLEMENT/DISCOUNT, and no `PARTNER_PAYMENT`/`PARTNER_SETTLEMENT` link (such rows have no transaction at all and cannot be voided, so excluding them keeps void symmetry; analyze pass 3 H-2). Every other row, and every reversal row, counts. Do **not** whitelist credit types (that breaks void symmetry — T004 q, r). The unary `+` on `+plb_tx.tenant_id` / `+plb_tx2.tenant_id` is **required**: without it SQLite picks `idx_transactions_tenant_id` and scans the whole `transactions` table per CREDIT row (measured 14.7 s for (k), 56 s for (k2)); with it the plan uses `idx_transactions_source` (1.1 s / 4.2 s). Say this in a comment next to the `+`.
  - `partnerPayoutUncoveredSql(alias)` = `MAX(0.0, MIN(${alias}.amount, (SELECT COALESCE(SUM(CASE WHEN ph.direction = 'DEBIT' THEN ph.amount ELSE -ph.amount END), 0) FROM partner_ledger ph WHERE ph.partner_id = ${alias}.partner_id AND ph.tenant_id = ${alias}.tenant_id AND ph.currency = ${alias}.currency AND ph.transaction_type = ${alias}.transaction_type AND ph.reference_table = ${alias}.reference_table AND ph.reference_id = ${alias}.reference_id)) - ${alias}.covered_amount)`.
  - `payoutNewerSumSql(alias)` (exported, `@internal`, for T004 o) = `(SELECT COALESCE(SUM(g.unc), 0) FROM (SELECT pg.reference_id, MIN(pg.id) AS head_id, MIN(CASE WHEN pg.direction = 'DEBIT' THEN julianday(pg.created_at) END) AS head_jd, MAX(0.0, MIN(SUM(CASE WHEN pg.direction = 'DEBIT' THEN pg.amount ELSE 0 END), SUM(CASE WHEN pg.direction = 'DEBIT' THEN pg.amount ELSE -pg.amount END)) - SUM(pg.covered_amount)) AS unc FROM partner_ledger pg WHERE pg.partner_id = ${alias}.partner_id AND pg.currency = ${alias}.currency AND pg.tenant_id = ${alias}.tenant_id AND pg.transaction_type = 'THROUGH_CUSTOM_SERVICE' AND pg.reference_table = 'custom_services' GROUP BY pg.reference_id HAVING MIN(CASE WHEN pg.direction = 'DEBIT' THEN pg.id END) = MIN(pg.id)) g WHERE g.head_jd > julianday(${alias}.created_at) OR (g.head_jd = julianday(${alias}.created_at) AND g.head_id > ${alias}.id))`. `head_jd` reads the DEBIT row's time only (a Pay out group has exactly one DEBIT, its head), so a same-day reversal in the other text format can never be mistaken for the head (analyze L-4).
  - `partnerEffectiveCoveredSql(alias)` = `(CASE WHEN ${alias}.transaction_type = 'THROUGH_CUSTOM_SERVICE' AND ${alias}.direction = 'DEBIT' THEN (CASE WHEN ${partnerPayoutUncoveredSql(alias)} <= 0.005 THEN ${coverable} WHEN ${partnerNettingBalanceSql(alias)} <= 0.005 THEN ${coverable} ELSE ${coverable} - MAX(0.0, MIN(${partnerPayoutUncoveredSql(alias)}, ${partnerNettingBalanceSql(alias)} - ${payoutNewerSumSql(alias)})) END) ELSE MIN(${alias}.covered_amount, ${coverable}) END)` with `coverable = partnerObligationCoverableSql(alias)`. The first two arms are the cheap guards (already cash-covered; nothing owed) so the grouped newer-sum only runs for heads that can actually be held. Valid only on rows passing `partnerObligationHeadRowSql`; a `THROUGH_CUSTOM_SERVICE` DEBIT head is by construction a Pay out (the IN-reversal DEBIT is excluded by `partnerObligationRowSql`). Full `getByModule` with exactly this shape (patched into the compiled core, real writers) measured **1.08 s** for (k) and **4.22 s** for (k2) (analyze pass 3; research R5). The guards return the same value the ELSE arm would — they only save work; `N` and `unc` are still evaluated up to twice per head (SQLite does not merge repeated correlated sub-queries), which those numbers include.
  - Reserved inner aliases (`plb`, `plb_tx`, `plb_tx2`, `ph`, `pg`, `g`, plus the existing `plg`, `plg_tx`, `plh_earlier`, `plh_prev`, `plo_first`) listed in the doc comment.
  Then use `partnerEffectiveCoveredSql` in the only two consumers: `partnerCoverageRatioWhereSql` (select `${partnerEffectiveCoveredSql("plr")} AS effective` in the inner query and compute `SUM(MIN(effective, coverable)) / SUM(coverable)`) and `partnerUncoveredExistsWhereSql` (`AND ${partnerEffectiveCoveredSql("plp")} < ${partnerObligationCoverableSql("plp")} - 0.005`). Do **not** touch `applySettlementCoverage` (`PartnerRepository.ts:444`) or `_unwindPartnerSettlementCoverage` (`TransactionRepository.ts` ~:8352) — cash stamps keep their meaning. Update the file's doc comments: the "Members" block (a Pay out also counts netting — "LIRA-305, owner decisions Y6/Y13: netting counts as paying; paper credits never do") and the "Not stamped anywhere" sentence (netting is read-time too, so voids re-derive on the next read — rule 20 needs no new owner). Add one line to the doc comment above `notPartnerPending` in `packages/core/src/repositories/ProfitRepository.ts` (~:880-900) pointing to the new fragment. No `any`; no logger change.
- [ ] T007 [US1] Run T004 → all green; paste counts + elapsed time; confirm (k) < 3000 ms and (k2) < 10000 ms through the full `getByModule` path, and record both times next to the design-time measurement (1.08 s / 4.22 s). If either is far slower, first check T004 (t) — a lost `+` hint (wrong query plan) is the known cause, not a missing index. If (k2) still fails, record the time and stop: an index migration (v210, both `packages/core/src/db/migrations/index.ts` and `electron-app/create_db.sql`, rule 10) is a new decision for the owner, not something to add silently.
- [ ] T008 [US1] Run the T001 regression nets plus the whole core suite (`cd packages/core && npx jest`) → all green with no test edits; compare counts with the baseline. `yarn check:tenant-scoping` and `yarn check:bind-arity` → 0 violations (the new sub-queries carry `tenant_id`; no binds).
- [ ] T009 [US1] Core build & sync again (T003 commands), then run T005 → green ("1 passed", non-trivial time). Paste the result.
- [ ] T010 [US1] Transport no-change check (rules 19, 21–23 — nothing to add, prove it): `git diff --stat` must show **no** change under `electron-app/handlers/`, `electron-app/preload.ts`, `frontend/src/types/electron.d.ts`, `backend/src/api/` (non-test), `frontend/src/api/backendApi.ts`, `frontend/src/api/ElectronApiAdapter.ts`, `packages/ui/src/api/types.ts`, `packages/core/src/validators/`, `packages/core/src/db/migrations/index.ts`, `electron-app/create_db.sql`, `frontend/src/features/services/` (the OMT/Whish page and its `Services.throughPartnerInvariant.test.tsx`), `frontend/src/features/custom-services/` (the Services tile — booking UI unchanged), `frontend/src/hooks/useShopBase.ts`, and the files named `SetupContext.tsx` / `StepBaseSystem.tsx` (find them with `git ls-files | grep -E 'SetupContext|StepBaseSystem'`). Run `yarn check:transport-parity` and `yarn check:schema-equivalence` → pass. Record the list in the completion note as "exists, unchanged" with the file that proves each transport (IPC `electron-app/handlers/profitHandlers.ts` → `ProfitService`; REST `backend/src/api/profits.ts` → `ProfitService`).

**Checkpoint**: US1 is done when T004 and T005 are green and nothing outside `partnerObligation.ts` (+ the one doc line in `ProfitRepository.ts`) changed in source.

---

## Phase 4: User Story 2 — both directions end to end on both apps (Priority: P2)

**Goal**: the corridor (SEND, RECEIVE, void) is proven on desktop too, and the existing Pay out specs are confirmed green.

**Independent Test**: the desktop twin typechecks and lints (first run in CI); `lira-web-custom-service-payout` green.

- [ ] T011 [P] [US2] Create `frontend/tests/e2e-electron/lira-305-syria-corridor-netting.spec.ts` — the desktop twin of T005 over IPC, pattern of `frontend/tests/e2e-electron/lira-custom-service-payout.spec.ts` (`test.describe.configure({ retries: 0 })`, fresh partner via `api.partners.create`, General via `api.recharge.getDrawerBalances`, partner via `api.partners.getBalance(id).usd`, profit via `ensureProfitsUnlocked(page)` from `./fixtures` then `api.profits.byModule("2000-01-01", "2100-01-01")`, SEND/RECEIVE via `api.customServices.add`, RECEIVE void via `api.transactions.void(txnId)` found by identity through `api.transactions.getRecent`, SEND void via `api.customServices.delete(id)`). Same four steps and deltas as T005. Header: "Not proven failing-first; desktop e2e never runs on the owner's Mac — first run is CI (G5)." Verify with `cd frontend && npx tsc -p tsconfig.playwright.json --noEmit` and `npx eslint tests/e2e-electron/lira-305-syria-corridor-netting.spec.ts`. Do not add it to `frontend/playwright.web.config.ts` (the web twin T005 covers REST).
- [ ] T012 [US2] Re-run the existing corridor specs over REST: `lira-web-custom-service-payout.spec.ts`, `lira-web-008-partners.spec.ts`, and (web mode) `lira-custom-service-payout.spec.ts` via `frontend/playwright.web.config.ts`. If green, replace the "NOT RUN — the owner runs the e2e suite later (fix-round I4)" first line of `frontend/tests/e2e-web/lira-web-custom-service-payout.spec.ts` and `frontend/tests/e2e-electron/lira-custom-service-payout.spec.ts` with "Last run green over REST: <date> (LIRA-305)". In the same headers and in `packages/core/src/repositories/__tests__/CustomServiceRepository.payout.test.ts` (first line "NOT RUN — proven at the end-of-batch gate" and the "same day" wording in the header and in the `it("owner example: … booked same day")` title / the "Commission ($3) is profit, stamped on create — same day, no deferral" comment), say instead: the commission is stamped at once and counted when the partner's account covers it (cash or netting — LIRA-258 D5, LIRA-305 Y6). Comment and title edits only; no assertion changes. If a spec fails, record the failure and stop — do not change money code here.
- [ ] T013 [P] [US2] Add rows for `lira-305-syria-corridor-netting.spec.ts` (and a note for `lira-web-054`) to the index in `frontend/tests/e2e-electron/README.md`, following the existing row format.

**Checkpoint**: both directions are covered end to end on both transports (desktop pending CI).

---

## Phase 5: User Story 3 — the documents say what the app does (Priority: P3)

**Goal**: FR-010. No document sends anyone to build Route B or says a Pay out's commission counts the same day.

- [ ] T014 [P] [US3] `docs/FEATURE_GUIDE.md`: retitle §8 to "Supplier and partner ledgers" (it already holds the partner-ledger notes, ~:405) and add a §8.4 "Remittance corridor (Syria) — Custom Services → Via Partner" after §8.3: the two-direction table from spec.md "What already exists" (drawer, partner row, commission timing), "partner always required", "General only, never the OMT/Whish cash drawers", "USD/LBP each on its own", "a Pay out never joins a basket", and the netting rule in one paragraph with the measured Q1–Q3 numbers and the guard file name. In §10 add a bullet "Partner netting (LIRA-305)" pointing to `partnerEffectiveCoveredSql`. In §13 item 10 add: "a partner obligation's profit counts cash coverage — and, for a Custom Services Pay out only, netting against what the shop owes the same partner (one fragment, `constants/partnerObligation.ts`)".
- [ ] T015 [P] [US3] `docs/COUNTERPARTY_LEDGERS.md`: in §3's type table add a `THROUGH_CUSTOM_SERVICE` row (IN = CREDIT cost, shop owes partner, not an obligation; Pay out = DEBIT arrived, partner owes shop, obligation head since LIRA-258 D5; written by `CustomServiceRepository.createService`; reversal `_reversePartnerLedger`); in §6 add the netting rule (what it reads, that it stores nothing, that FOR rows are unchanged, that it is conservative when a corridor partner has other debts); in §7 add "netting — nothing stored, nothing to reverse; void/refund of a SEND, RECEIVE or settlement re-derives on the next read (guard: `ProfitRepository.syriaCorridorNetting.test.ts` (h))".
- [ ] T016 [P] [US3] `docs/POSTING_MAP.md`: line ~237 ("Custom service, Via partner OUT (Syria-style payout)") profit column → "when the partner's account covers it — cash settlement or netting against what the shop owes the partner (LIRA-258 D5, LIRA-305)"; line ~236 (Via partner IN) keep "immediate"; in the G16 row (~:369) append "LIRA-305: netting now counts as coverage (`partnerEffectiveCoveredSql`)".
- [ ] T017 [P] [US3] `docs/plans/ongoing_plans/PARTNER_DISBURSEMENT_MATRIX.md`: add a dated status note under the title: the "hwelet souria / 7welet souria" gap is closed by Route A (Custom Services Via Partner + Pay out, v185) and LIRA-305; the Syria partner never goes through the OMT/Whish page, so the derivation-rule hazard in Part C does not apply to it. Do not rewrite the audit body (it is a dated record).

**Checkpoint**: `grep -rn "same day" docs/POSTING_MAP.md docs/FEATURE_GUIDE.md docs/COUNTERPARTY_LEDGERS.md | grep -i "payout\|pay out"` returns nothing stale.

---

## Phase 6: Polish & cross-cutting

- [ ] T018 [P] Release note (rule 30) in `docs/release-notes/UNRELEASED.md` under `## 📊 Profits page`, one line, shop-owner words, no ticket id: "On the Profits page, the commission on money you pay out for a partner (Services → Via Partner → Pay out, for example a Syria transfer) now counts as the partner's account is paid down — by cash, or by what you owe that partner for transfers you sent. Before, only cash from the partner counted. Pay-outs you already recorded are included, so profit shown for earlier days can go up." Then run `node scripts/build-release-notes.cjs --check` (and regenerate if the check asks for it).
- [ ] T019 [P] Update the LIRA-305 ticket in `current_sprint.md`: Status → DONE (not deployed) with date; the measured results (counts, times, red→green figures from T004/T005/T007/T009); the "What users will notice:" line (same meaning as T018); "Unverified" list (desktop twin until CI; any gate that could not run).
- [ ] T020 [P] Fill the "Measured" line of each Y decision (Y1–Y13) in `docs/plans/OVERNIGHT_DECISIONS_2026-10-11.md` §3 from the completion notes (Y6 especially: before/after figures).
- [ ] T021 Gates — run each, record suite/test counts and elapsed time in the completion note (rule 28a; a fast silent run is not a pass): `yarn typecheck`; `yarn lint` (0 errors); `yarn build`; `yarn check:tenant-scoping`; `yarn check:bind-arity`; `yarn check:transport-parity`; `yarn check:schema-equivalence`; full core jest (`cd packages/core && npx jest`); `yarn workspace @liratek/backend test`; `yarn workspace @liratek/electron-app test`; `yarn workspace @liratek/frontend test`; `node scripts/build-release-notes.cjs --check`. Do **not** use root `yarn test` (it runs `rebuild:node`). After `yarn build`, re-run the core sync (`cp -r packages/core/dist/. node_modules/@liratek/core/dist/`) if `node_modules/@liratek/core` was replaced.

---

## Dependencies & Execution Order

- T001 → T003 → (T004, T005 written and red) → T006 → T007 → T008 → T009 → T010.
- T002 is independent (docs) — any time.
- US2: T011 needs T006 semantics settled (write after T007); T012 needs T009 (same server state); T013 any time after T011.
- US3: T014–T017 after T007 (they quote measured numbers); parallel with each other.
- Polish: T018–T020 after T009; T021 last.

### Parallel opportunities

- T002 ∥ T001.
- T004 ∥ T005 (different files; both run red before T006).
- T011 ∥ T013 ∥ T014 ∥ T015 ∥ T016 ∥ T017 after T009.
- T018 ∥ T019 ∥ T020.

## Implementation Strategy

- **MVP = US1** (T001–T010): the netting rule, proven in core and over REST. It is the only behaviour change.
- Then US2 (desktop twin, re-confirm existing Pay out specs), then US3 (documents), then polish + gates.
- Undo path (Y6): delete `partnerEffectiveCoveredSql` and restore the two consumers to `covered_amount`; nothing stored
  needs migrating.

## Completion notes

(append per task: what ran, counts, elapsed time, red output for T004/T005, green output after T006)

## Analyze record

**Pass 1 (2026-10-11, independent read-only reviewer; executed the proposed SQL on an in-memory DB):** 1 CRITICAL, 2 HIGH,
8 MEDIUM, 6 LOW. Every expected figure in T004 (a)–(k) was independently re-derived and matched; (b), (c), (e) executed.

| ID | Sev | Finding | Resolution |
| --- | --- | --- | --- |
| C1 | CRITICAL | (history — superseded by pass 2 H-3 and pass 3 H-1) First-draft fragment measured 37.5 s (300+300, 7 evaluations/row) and 104.9 s with unpaid RECEIVEs — nested per-head coverable sub-queries hit unindexed scans; the R5 "one indexed lookup" claim was false | Redesigned (research R4): grouped newer-sum pass filtered by `partner_id`, `N ≤ 0` short-circuit, `unc` via partner-filtered group net. Prototype re-measured: 98 ms / 1,873 ms / 15,805 ms (R5). SC-004 restated (3 s square / 5 s owing); index migration kept as an owner-decision fallback only |
| H1 | HIGH | (history — design superseded by pass 2 H-1) Partner balance includes paper (no-cash) credits → a paper "shop owes 500" released profit with no money moved (measured 0 → 100%); contradicts PFT-7b | New decision Y13: netting balance counts only real credits (obligations, SETTLEMENT, DISCOUNT, cash-moved entries); `partnerNettingBalanceSql`; spec FR-001/FR-002, T004 (l), (p) |
| H2 | HIGH | (history — value corrected by pass 2 H-2) Perf guard had B = 0 by construction (false green); (k) mislabelled green | Added (k2) with 150 unpaid RECEIVEs (< 5 s, profit 345); (k) relabelled R on value |
| M1 | MED | Two stored time formats; text order mis-sorts ISO vs space format | `julianday(created_at)` then `id`; T004 (m) |
| M2 | MED | A probe test file was left behind; "deleted" claim false | Deleted both probe files; claim now true |
| M3 | MED | `check-tenant-scoping` does not scan `constants/` | T004 (n) asserts `tenant_id` on the SQL string; R6 corrected |
| M4 | MED | Balance arithmetic hand-copied | `partnerNettingBalanceSql` is the one definition; T004 (p) pins it to `getBalance` (no paper credits) |
| M5 | MED | Release note overclaimed ("as soon as square"), no past-days warning | T018 / ticket / Y6 wording fixed |
| M6 | MED | Red/green labels inconsistent | Every T004 case now labelled R/G with today's value |
| M7 | MED | Invariant test not executable as worded | T004 (i) gives the exact SELECT |
| M8 | MED | FR-004 screens / LBP Profits void not asserted | T004 (b) adds `getByDate`/`getByUser`; (h) adds an LBP corridor + void |
| L1 | LOW | Wrong paths in T010 | Fixed (`features/custom-services/`, `hooks/useShopBase.ts`, git ls-files for the setup files) |
| L2 | LOW | Mixed-currency rows get one blended ratio (pre-existing) | Recorded, research R9 |
| L3 | LOW | Pay out kept out of baskets only by the page | Recorded, research R9 |
| L4 | LOW | FEATURE_GUIDE §8 is "Supplier ledger" | T014 retitles §8 "Supplier and partner ledgers" |
| L5 | LOW | Reserved inner aliases not listed | Contract + T006 list them |
| L6 | LOW | Unrelated uncommitted e2e edits in the tree | Noted for the parent: keep `frontend/tests/e2e-electron/lira-094-…`, `lira-095-…`, `lira-158-…`, `frontend/tests/e2e-web/fixtures.ts`, `lira-web-052-…`, `lira-web-053-…` edits (another session's) out of the LIRA-305 commit |

**Pass 2 (2026-10-11, fresh independent reviewer; executed the T006 SQL both transcribed and patched into the compiled core
with the real writers):** 0 CRITICAL, 3 HIGH, 4 MEDIUM, 5 LOW. All pass-1 fixes confirmed present; every T004 figure
re-derived, (a)–(e), (i), (k), (k2), (l), (m) executed.

| ID | Sev | Finding | Resolution |
| --- | --- | --- | --- |
| H-1 | HIGH | Type-whitelisted credits broke void symmetry: void of a cash-moved debit (executed 6 → 4.5 → 4.5) or of a `WHISH_TOPUP` (6 → 6 → 4.8) left commission stuck; `WHISH_TOPUP` is a live writer | Netting balance redefined as the full balance minus paper credits only (CREDIT rows sourcing a `PARTNER_ADJUSTMENT`); reversals always count. R4, data-model (invariant 7), contract, spec FR-001, Y13, T006 updated; T004 (q), (r) added |
| H-2 | HIGH | (k2) expected 345; correct is 390 (executed both harnesses) | Fixed to 390 + deferred 45 |
| H-3 | HIGH | Full-path (k2) measured 3.9–4.3 s vs a 5 s budget — no CI headroom; index fallbacks barely help | Delegated decision: cheap guards added to T006 (skip when cash-covered or nothing owed), budget restated to 10 s in SC-004/plan/T004/T007/ticket with the measured numbers; index migration kept as an owner fallback (best measured: `(reference_table, reference_id)`, 3.1 s) |
| M-1 | MED | A paper credit typed `THROUGH_%`/`SETTLEMENT` passed the type whitelist | Resolved by H-1's link-based rule; T004 (l) sub-case |
| M-2 | MED | `recordPartnerTransaction` without `transactionType` throws (NOT NULL) | (l), (p), (q) pass `transactionType: "ADJUSTMENT"` |
| M-3 | MED | (n) counted inherited fragments too — unpassable | (n) asserts per new sub-query only |
| M-4 | MED | Grouped `unc` inside the newer-sum was an unpinned second definition | `payoutNewerSumSql` exported `@internal`; (o) pins it |
| L-1 | LOW | "R1–R8" stale | R1–R9 everywhere |
| L-2 | LOW | Plan said "one core function" | Reworded |
| L-3 | LOW | Overpay and "voided receive frees the SEND" edges not asserted | (a) asserts 8 before settling; (s) added |
| L-4 | LOW | `MIN(created_at)` could pick a reversal's time | `head_jd` = julianday of the DEBIT row only |
| L-5 | LOW | Line-number anchor in T005; more unrelated edits in tree | Anchored by comment; keep-out list extended (L6) |

**Pass 3 (2026-10-11, fresh independent reviewer; T006 patched into a copy of the compiled core, real writers, every
T004 figure executed except (n)/(o)):** 0 CRITICAL, 2 HIGH, 2 MEDIUM, 4 LOW. Pass-2 H-1 and H-2 confirmed resolved
((q) 6 → 4.5 → 6, (r) 6 → 6 → 6, (s) 3 → 6, (k2) 390 / deferred 45).

| ID | Sev | Finding | Resolution |
| --- | --- | --- | --- |
| H-1 | HIGH | The link-based EXISTS made SQLite pick `idx_transactions_tenant_id` and scan all `transactions` per CREDIT row: (k) 14.7 s, (k2) 56 s (same plan on a copy of the real dev DB) | `+plb_tx.tenant_id` hint in T006 (plan → `idx_transactions_source`; executed 1.08 s / 4.22 s with the final shape); T004 (t) asserts the plan; R5, T006, T007, plan, SC-004 numbers updated |
| H-2 | HIGH | Legacy (pre-LIRA-066) paper credits have no `PARTNER_ADJUSTMENT` row → counted → profit 0 → 3 with no money moved; R9/spec claimed the opposite | Legacy arm added to `partnerNettingBalanceSql` (no reference, not SETTLEMENT/DISCOUNT, no cash link → excluded; such rows are not voidable, so symmetry holds; executed: legacy 0, all 22 figures unchanged); T004 (l-legacy); R9, spec Assumptions, data-model fixed |
| M-1 | MED | `getDeferredProfit` with bare `DAY` bounds returns 0 regardless (false green) | (j)/(k2) use full-day bounds + a control case |
| M-2 | MED | "Evaluate N once" overclaimed | Claim dropped (T006/R5 say up to twice, included in the timings) |
| L-1 | LOW | data-model invariant 5 named the wrong link | Reworded |
| L-2 | LOW | Pass-1 history cells read as live in a grep | Marked superseded |
| L-3 | LOW | (r) entry point / id lookup unspecified | `RechargeService.topUpFromPartner` + `getBySourceId("recharges", MAX(id))` |
| L-4 | LOW | A paper entry typed SETTLEMENT/DISCOUNT already stamps coverage today (pre-existing) | Recorded, research R9 — not changed |

**Pass 4 (author, executed — closes pass 3):** the exact `partnerNettingBalanceSql` text now in T006 was extracted from
this file, patched (with the other three T006 fragments and both consumers) into a copy of the compiled core, and run with
the real writers: (a) 8/8 balance 0, (b) 6, (c) 3.2 → 5, (d) 3, (e) 6, (f) 3 / 0, (g) 5, (h) 0 / 3.2 / 3 / LBP 600,000 →
300,000, (i) 0 / 1.5, (l) paper 0 / cash-moved 3 / paper `THROUGH_OMT_SEND` 0, legacy paper credit 0, (m) 6, (p) pinned,
(q) 6 → 4.5 → 6 with General and partner restored, (r) 6 → 6 → 6, (s) 3 → 6, `getByDate`/`getByUser` 6, deferred 0;
(k) 1,074–1,096 ms profit 390; (k2) 4,160–4,281 ms profit 390, deferred 45 (full-day bounds). (n), (o), (t) not executed
(they are string/plan assertions written in T004).

**Result: 0 CRITICAL / 0 HIGH open** after pass 3's fixes (2 MEDIUM and 4 LOW from pass 3 also resolved above).
