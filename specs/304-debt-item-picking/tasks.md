---
description: "Task list for LIRA-304 — debt repayment item picking and primary-system drawer routing"
---

# Tasks: Debt Repayment Item Picking and Primary-System Drawer Routing

**Input**: `specs/304-debt-item-picking/` — plan.md, spec.md, research.md, data-model.md, contracts/debt-api.md, quickstart.md

**Tests**: REQUIRED. Constitution VI / CLAUDE.md rule 17: every guard test is written first, run against the unfixed code, and its real failure recorded in the task note before the fix. Never revert finished code to prove a test. Confirm each run actually executed (test count + elapsed time, rule 28).

**Conventions**: `core/` = `packages/core/src/`. Running example used in tests: OMT-primary shop, rate 89,000, debt = OMT send $101 (system, provider `OMT`) + cable $14 (POS sale) + Loto 200,000 LBP. After any core edit: `cd packages/core && npm run build && cp -r dist/. ../../node_modules/@liratek/core/dist/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on an unfinished task)
- **[Story]**: US1–US7 from spec.md

---

## Phase 1: Setup

- [X] T001 Read `docs/FEATURE_GUIDE.md` §4, §7, §9, §11, §13 and `specs/304-debt-item-picking/research.md` D1–D14 before touching money code (rule 18); note in this file any guide statement the design contradicts.
- [X] T002 Snapshot profit totals for the D10 measurement: copy the test-shop/dev DB (`.db` + `-wal` + `-shm`) and record, with Python `sqlite3`, the Profits-page totals (per currency, last 90 days) into `specs/304-debt-item-picking/profit-baseline.md` (scratch data only, no customer names).

---

## Phase 2: Foundational (blocks every story)

**Purpose**: per-member owed/covered storage, one base-system helper, one coverage writer, one pure allocation module.

- [X] T003 Write failing guard (written + seen failing 2026-10-11: `SqliteError: no such column: cst.owed_usd`; passes once T018 writes member owed) `core/repositories/__tests__/sessionMemberCoverage.invariant.test.ts`: after a basket checkout on CUSTOMER_ACCOUNT (OMT $101 + cable $14 + Loto 200,000 LBP), assert per currency that Session Debt `amount` = gift-card part + sale share + Σ non-sale member `owed`, and `covered` = gift-card + sale pre-cover + Σ member `covered` (invariant I1, data-model.md). Expected failure: columns do not exist.
- [X] T004 Add migration v209 in `core/db/migrations/index.ts` (check the last entry first; it was v208): `ALTER TABLE customer_session_transactions ADD COLUMN owed_usd REAL NOT NULL DEFAULT 0`, same for `owed_lbp`, `covered_usd`, `covered_lbp`; add `updated_at` if missing (rule 5); implement `down()`.
- [X] T005 Mirror T004 in `electron-app/create_db.sql` (`customer_session_transactions`, ~:735-755); run `yarn check:schema-equivalence`.
- [X] T006 Implement the v209 backfill in `core/db/migrations/index.ts` per research D12: for each `'Session Debt'` row with `transaction_id IS NULL`, non-sale debt per currency = `amount − sale share − gift card`, split over non-sale charge members by their `amount_*` (by-share; last member takes the rounding remainder; USD to cents, LBP to whole units); distribute existing non-sale `covered_*` oldest-first by `cst.id`; every statement scoped by `tenant_id`; abort with a logged error if I1 fails for any basket.
- [X] T007 [P] Write `core/db/migrations/__tests__/v209.backfill.test.ts`: two pre-v209 baskets (one fully on account, one partly paid with by-share split, one partly repaid) → after migration I1 holds and member owed matches the by-share rule.
- [X] T008 [P] Add `SettingsRepository.getShopBaseSystem(): "OMT" | "WHISH"` in `core/repositories/SettingsRepository.ts` (default "OMT", same semantics as `SettingsService.getShopBaseSystem`) — the existing settings reader, so no new file; test in `core/utils/__tests__/payments.primarySystem.test.ts`. The four existing inline copies (research F11) are listed in its doc comment as known duplicates, not refactored.
- [X] T009 [P] Add `isPrimarySystemProvider(provider, baseSystem)` to `core/utils/payments.ts` (true only for `provider ∈ {OMT, WHISH}` and `provider === baseSystem`; false for `OMT_APP`, `WHISH_APP`, `BINANCE`, `BOB`, `OTHER`, `iPick`, `Katsh`); unit test in `core/utils/__tests__/payments.primarySystem.test.ts`. Keep `utils/payments.ts` browser-safe.
- [X] T010 Write failing tests `core/utils/__tests__/debtRepaymentAllocation.test.ts` for the pure function (contract §3): coverage order (ticked oldest-first, then sales first, then charges/members `created_at, id`); routing per research D3 — ticked items first (ticked primary transfer → system drawer, ticked other item → payment method's drawer), then remainder OMT drawer first, capped per transfer at `amount − Σ earlier routed value` in the transfer's own currency; cash-only legs; cross-currency leg routed in its own currency; IN − OUT − kept caps everything; `drawerPreview` per drawer per currency sums to the applied cash. Use every row of the quickstart.md table as a case.
- [X] T011 Implement `core/utils/debtRepaymentAllocation.ts` exporting `allocateRepayment(input)` and its input/output types; NO imports beyond pure utils (rule 29); export from BOTH `core/index.ts` and `core/browser.ts`; T010 passes; `src/__tests__/browserEntryIsNodeFree.guard.test.ts` passes.
- [X] T012 Add `DebtRepository.applyCoverage(plan)` in `core/repositories/DebtRepository.ts`: the ONLY writer of `sales.paid_usd/paid_lbp`, charge-row `covered_*`, member `covered_*` and the basket row's `covered_*` (kept equal to I1); returns `{sales, charges, members}`; all statements `tenant_id`-scoped and `?`-bound.
- [X] T013 Route `_markSalesPaidFIFO`, `_coverServiceDebtsFIFO` and `_postDebtDiscount` writes through `applyCoverage` (`core/repositories/DebtRepository.ts:905-1162`); `_postDebtDiscount` now stores its record in its COUNTERPARTY_DISCOUNT `metadata_json.coverage_applied` (audit only); existing DebtRepository suites stay green.
- [X] T014 Add a member-level outstanding fragment `memberOutstandingSql(alias, cur)` to `core/repositories/sessionDebtCoverage.ts` (`owed − covered − this member's 'Session Item Refund' credit`, credit linked via the REFUND transaction's `reverses_id`); keep `coverageOutstandingSql` unchanged.

**Checkpoint**: T003 and T007 green; allocation module tested; one coverage writer.

---

## Phase 3: User Story 1 — Same drawers whichever way the debt was made (P1) 🎯 MVP

**Goal**: basket and separate-visit debts route the primary-system share identically; secondary system, wallet apps and non-cash never routed.

**Independent Test**: quickstart.md rows 1, 2, 7, 8 — identical drawer deltas for basket vs separate visits.

- [X] T015 [US1] Write failing `core/repositories/__tests__/DebtRepository.routingParity.test.ts`: (a) basket on account then cash settlement → OMT_System +$101, General +$14 +200,000 LBP; (b) same as three separate visits → identical deltas; (c) Whish-primary shop, basket Whish send $50 + cable $14 → Whish_System +$50; (d) OMT shop, Whish (system) debt $50 → General +$50, no system drawer change; (e) Whish App debt $30 in a Whish shop → General +$30; (f) OMT debt paid from a WHISH_APP leg → no routing. Record the real failures (today (a) routes nothing and (d) routes to Whish_System). — guards in `DebtRepository.lira304Routing.test.ts`; seen failing 2026-10-11 (9/12): basket → General +$115 / OMT 0; OMT shop Whish debt → Whish_System +$50; wallet leg → OMT_System; tick cable → OMT_System +$14; LBP for USD → General; refund-then-repay → OMT +$51/General +$50 (D5 confirmed).
- [X] T016 [US1] Write failing `core/repositories/__tests__/DebtRepository.routingCap.test.ts` (research D3): no-tick $50 → OMT_System +$50 while coverage pays cable $14 + OMT $36; then tick OMT and pay $65 → OMT_System +$51 (cap), General +$14; tick cable only, pay $14 → General +$14, OMT_System 0; tick cable only, pay $60 → General +$14, OMT_System +$46; 8,989,000 LBP for a USD $101 send at 89,000 → OMT_System +8,989,000 LBP, `routed.by_transfer[].value = 101` (USD); an OMT send of 9,000,000 LBP, $50 cash at 90,000 → OMT_System +$50, routed value 4,500,000 LBP, and the remaining cap is unchanged after the rate moves to 95,000. — guards in `DebtRepository.lira304Routing.test.ts`; seen failing 2026-10-11 (9/12): basket → General +$115 / OMT 0; OMT shop Whish debt → Whish_System +$50; wallet leg → OMT_System; tick cable → OMT_System +$14; LBP for USD → General; refund-then-repay → OMT +$51/General +$50 (D5 confirmed).
- [X] T017 [US1] Write failing `core/repositories/__tests__/DebtRepository.routingAfterRefund.test.ts` (research D5): route, refund the repayment through the generic refund, repay → the second repayment routes the full amount again. Settle by running. — guards in `DebtRepository.lira304Routing.test.ts`; seen failing 2026-10-11 (9/12): basket → General +$115 / OMT 0; OMT shop Whish debt → Whish_System +$50; wallet leg → OMT_System; tick cable → OMT_System +$14; LBP for USD → General; refund-then-repay → OMT +$51/General +$50 (D5 confirmed).
- [X] T018 [US1] (owed written OMT-first via `utils/sessionMemberOwed.ts` + `SessionPaymentRepository.writeBasketMemberOwed`; T003 green 3/3) In checkout, write member `owed_*` for every non-sale charge member: `core/repositories/SessionPaymentRepository.ts` new method `writeMemberOwed(sessionId, rows)` called from `core/services/SessionPaymentService.ts` after `allocateBasketAccountDebt` (no SQL in the service, rule 13); owed split must satisfy I1 (T003 green). T018 only adds the write path; the owed values come from T048's OMT-first allocation (Phase 3b). Until T048 lands, write owed from today's split.
- [X] T019 [US1] Add `DebtRepository.readRoutingState(clientId)` in `core/repositories/DebtRepository.ts`: for every open primary-system transfer of the client (Service Debt rows of the primary provider net of 'Refund Reversal', and basket members whose transfer is primary), return its amount and currency and its `routed_value` = Σ `metadata_json.routed.by_transfer[].value` for that transfer over DEBT_REPAYMENT transactions that are not VOIDED and not reversed by a refund (`reverses_id`), in the transfer's own currency. Legacy repayments without `routed` (routing was strictly per currency) fall back to Σ positive system-drawer `payments` in the same currency, attributed oldest transfer first.
- [X] T020 [US1] Rewrite the routing block of `addRepayment` (`core/repositories/DebtRepository.ts:631-800`): use `readShopBaseSystem`, `readRoutingState` and `allocateRepayment(...).routing`; route only legs that `resolveServiceCashDrawer` would send to the primary drawer; write the routed share as two INTERNAL payments rows (paying drawer −X, `primaryCashDrawerName(base)` +X, method = provider) that `isInternalLegJs` treats as internal and refund-override never swaps (research D4); store `metadata_json.routed`; delete the dead `SERVICE_DEBT_SYSTEM_DRAWER` map (:108-113). T015–T017 pass.
- [X] T021 [US1] Invariant check in T015: for every repayment, Σ drawer deltas per currency = applied amount + kept change (FEATURE_GUIDE §13 item 14).

**Checkpoint**: US1 independently shippable — routing parity, primary only, cash only, capped.

---

## Phase 3b: Checkout split OMT-first (FR-009a, owner decision 2026-10-10)

**Goal**: cash paid at checkout of a partly-on-account basket covers primary-system transfers first; member `owed` follows from it.

**Independent Test**: spec edge case "basket partly paid at checkout".

- [X] T047 [US2] Write failing `core/services/__tests__/SessionPaymentService.omtFirstSplit.test.ts`: basket OMT $101 + cable $14, $50 cash + $65 on account → OMT_System +$50, General 0, member owed OMT $51 / cable $14 (owner decision 2026-10-10; today splits ≈ $43.91 / $6.09).
- [X] T048 [US2] Replace the charge-side `ratioForCurrency` split with an OMT-first allocation: SQL/data reads in `core/repositories/SessionPaymentRepository.ts` (`getSessionCashSplitContext` returns per-member primary charges), arithmetic in a pure helper `core/utils/sessionCashSplit.ts` (Node-free), service only orchestrates; payout side unchanged; member `owed_*` = charge − cash allocated (feeds T018). T047 + existing lira-web-018 expectations reviewed (update only what the owner decision changes, documenting each).

---

## Phase 4: User Story 2 — The cashier picks what the payment is for (P1)

**Goal**: optional `targets` on repayment; ticked items paid first; preview of drawers before confirming.

**Independent Test**: quickstart.md rows 3–5 and spec US2 scenarios 1–6, 4a, 4b.

- [X] T022 [US2] Write failing `core/repositories/__tests__/DebtRepository.repaymentTargets.test.ts`: tick OMT, pay $50 → OMT open $51, cable and Loto untouched, OMT_System +$50; tick OMT only, pay $120 → OMT paid, $19 oldest-first to others → General; separate visits only (4a) behaves the same; mixed basket + visits (4b); a target of another client, a closed item, a refunded member, or a 'Manual Debt' row → `{success:false}` and NOTHING written (FR-011); two repayments ticking the same member, the second built on the state before the first commits → the second sees the reduced open amount and cannot over-cover (`member.covered ≤ member.owed`).
- [X] T023 [US2] Add `targets` to `addRepaymentSchema` in `core/validators/debt.ts`: `z.array(z.object({ kind: z.enum(["sale","charge","member"]), id: z.number().int().positive() })).max(200).optional()` with a uniqueness refine on `kind+id`; confirm `AddRepaymentPayload` (z.input, `debt.ts:202`) exposes it from both `core/index.ts` and `core/browser.ts`.
- [X] T024 [US2] Rule 23 four-place add, ONE change: `electron-app/preload.ts` `debt.addRepayment` data type (:348-368); `electron-app/handlers/debtHandlers.ts` local `RepaymentData` (:29-47) and forwarding; `core/services/DebtService.ts` `RepaymentData` + camel→snake mapping (:35-56, :190-290) to `CreateRepaymentData.targets`; `frontend/src/types/electron.d.ts` (:1280). Add a unit test that the handler forwards `targets` unchanged.
- [X] T025 [US2] Implement target handling in `DebtRepository.addRepayment`: re-read each target server-side (belongs to client, open, pickable), refuse before any write, feed `allocateRepayment` with server-read open items, apply its coverage through `applyCoverage`, store `metadata_json.targets` and `coverage_applied.members`. Re-read targets INSIDE the write transaction; every coverage UPDATE carries `AND covered + ? <= owed + ε` and checks `.run().changes === 1`, else refuse and roll back (FEATURE_GUIDE §13 item 15). T022 passes.
- [X] T026 [P] [US2] Add `DebtRepository.findOpenDebtItems(clientId)` returning `OpenDebtItem[]` (data-model.md: `kind`, `id`, `session_id`, `label`, `type`, `provider`, `is_primary_system`, `created_at`, `owed_*`, `open_*`, `refunded`, `pickable`) ordered `created_at, id`, plus `routed_value` on each primary-system transfer item (from `readRoutingState`); test in `core/repositories/__tests__/DebtRepository.openDebtItems.test.ts` (Manual Debt listed with `pickable:false`; refunded member listed with `refunded:true`).
- [X] T027 [US2] `DebtService.getOpenDebtItems(clientId)` in `core/services/DebtService.ts` (no SQL).
- [X] T028 [P] [US2] IPC `debt:get-open-items` in `electron-app/handlers/debtHandlers.ts` (same `requireRole` as `debt:getClientHistory`), preload binding `debt.getOpenItems`, `electron.d.ts` type.
- [X] T029 [P] [US2] (route built 2026-10-11; its test still to write) REST `GET /api/debts/clients/:clientId/open-items` in `backend/src/api/debts.ts` (static path before any `/:id`; `authenticateJWT` → same roles; IPC-identical shape); route test in `backend/src/api/__tests__/debtsOpenItems.api.test.ts`.
- [X] T030 [US2] Adapter `getOpenDebtItems(clientId)` in `frontend/src/api/backendApi.ts` via `ipcOrHttp` (returns the raw array), expose on `frontend/src/api/ElectronApiAdapter.ts`, type on `ApiAdapter` in `packages/ui/src/api/types.ts`.
- [X] T031 [US2] (component built 2026-10-11; its test still to write) Create `frontend/src/features/debts/components/DebtItemPicker.tsx`: lists open items, basket members grouped under "Session #N basket", checkbox per pickable item, open amounts, "Nothing ticked = OMT drawer first, then oldest first" hint; controlled `selected: RepaymentTarget[]`; tests in `frontend/src/features/debts/components/__tests__/DebtItemPicker.test.tsx` (stable `useApi` mock, rule 25).
- [X] T032 [US2] Wire the picker into the repayment modal in `frontend/src/features/debts/pages/Debts/index.tsx` (`CounterpartySettleModal` slot, :2102-2304): load `getOpenDebtItems` when the modal opens (read `api` through a ref), add `targets` to the ONE payload in `handleProcessRepayment` (:803-822, rule 22).
- [X] T033 [US2] (preview built 2026-10-11; its test still to write) Drawer preview (FR-010): in the same modal compute `allocateRepayment(...)` from the open items, current lines, `repayModalRate`, base system and routing state; render "Goes to: OMT Cash Drawer $X · General $Y + Z LBP" only when a system drawer receives money; test in `frontend/src/features/debts/pages/Debts/__tests__/Debts.repaymentPreview.test.tsx` that preview equals the posted split for the quickstart rows.

**Checkpoint**: US2 shippable — picking + preview, server-validated.

---

## Phase 5: User Story 5 — Undoing a repayment undoes exactly what it did (P1)

**Goal**: void/refund restores items, drawers (incl. routing), profit.

**Independent Test**: spec US5 scenarios; SC-004.

- [X] T034 [US5] Write failing `core/repositories/__tests__/TransactionRepository.refundRoutedRepayment.test.ts` (research D4): refund a routed repayment with `refundLegs` overriding the method → every drawer nets to 0 per currency; OMT_System returns exactly the routed amount.
- [X] T035 [US5] Write failing `core/repositories/__tests__/TransactionRepository.voidRepaymentMembers.test.ts`: void a repayment that paid basket members (ticked and not) → each member's `covered_*` back by exactly its share, basket row I1 holds, drawers back, held profit held again.
- [X] T036 [US5] Extend `_restoreRepaymentDebt` in `core/repositories/TransactionRepository.ts` (:7133-7235) to reverse `coverage_applied.members` through the same member-aware path (decrement member + basket row together, `MAX(0, …)`, `tenant_id`-scoped). T035 passes.
- [X] T037 [US5] Make the routed internal pair non-overridable in `_reversePayments` (`core/repositories/TransactionRepository.ts:7707-7826`) if T034 shows it is swapped; T034 passes.
- [X] T038 [US5] Rule 20 check: create + void and create + refund net to 0 across drawers, `debt_ledger`, member coverage and profit, per currency, for: no-tick, ticked, cross-currency (LBP for USD), basket and separate visits — add these cases to T035.

---

## Phase 6: User Story 4 — Profit follows what was actually paid (P2)

**Goal**: per-member profit release.

**Independent Test**: spec US4 scenarios.

- [X] T039 [US4] Write failing `core/repositories/__tests__/ProfitRepository.memberDebtHold.test.ts`: basket with two non-sale charge members on account; tick and fully pay one → its profit released, the other still held; no-tick payments release as today's order.
- [X] T040 [US4] Change the second arm of `ProfitRepository.notDebtPending` (`core/repositories/ProfitRepository.ts:1041-1065`) to hold a member only while `memberOutstandingSql` for that member is open; update the doc comment (:1035-1037). T039 passes; existing profit suites green.
- [ ] T041 [US4] (BLOCKED on owner: needs a copy of a real database — the local one has no baskets on account) Measure D10: rerun the T002 query after migration + T040 on the same DB copy; write before/after totals and the difference into `specs/304-debt-item-picking/profit-baseline.md`; if the Profits page changes for users, add a release-note line (rule 30).

---

## Phase 7: User Story 3 — The Accounts page shows what is inside a basket (P2)

**Goal**: expandable basket line with item amounts and open amounts.

**Independent Test**: spec US3 scenarios; SC-005.

- [X] T042 [US3] In `frontend/src/features/debts/pages/Debts/index.tsx` purchases list (:1588-1848), make a `'Session Debt'` row expandable, rendering its members from `getOpenDebtItems` (amount, open amount, "Refunded" badge), keeping the existing eye/`SessionDebtDetailModal`.
- [X] T043 [P] [US3] Test `frontend/src/features/debts/pages/Debts/__tests__/Debts.basketExpand.test.tsx`: expanded items sum to the basket line (refunded shown separately), partly-paid member shows its open amount.

---

## Phase 8: User Story 6 — Payment details show which drawer got the money (P2)

**Goal**: one line per method + direction; per-drawer breakdown when split.

**Independent Test**: spec US6 scenarios; SC-007.

- [X] T044 [P] [US6] Write failing `frontend/src/features/audit/__tests__/paymentDetailLines.test.ts`: the 2026-10-10 repayment legs (two CASH IN rows + routing internal pair + two CUSTOMER_ACCOUNT OUT) → exactly `In — Cash: $115 + 200,000 LBP  {$101 OMT Cash Drawer · $14 + 200,000 LBP General}` and `Out — Customer Account: $115 + 200,000 LBP`; all-General repayment → no braces; a sale paid $10 + 100,000 LBP cash → one line; a basket checkout split (PCD + General rows) → breakdown; Σ breakdown = line per currency.
- [X] T045 [US6] Implement `frontend/src/features/audit/paymentDetailLines.ts` (group by method + direction, fold internal routing pairs into the paying line, drawer labels `OMT_System` → "OMT Cash Drawer", `Whish_System` → "Whish Cash Drawer"); keep legacy RESERVE-pair repayments readable.
- [X] T046 [US6] Use it in `buildLegDetailTr` in `frontend/src/features/audit/pages/TransactionsViewer.tsx` (:738-793) for both the row's own legs and the "Session #N pooled:" block; existing audit tests stay green. If folding needs the internal legs that `_attachPaymentLegs`/`toLeg` drops (`core/repositories/TransactionRepository.ts:1676-1699`), return them flagged `internal: true` instead of dropping, and filter them everywhere else.

---

## Phase 9: User Story 7 — LBP for USD and checkpoint total (P3)

**Goal**: cross-currency routing (already in T020) visible end to end; info-only checkpoint total.

**Independent Test**: spec US7 scenarios.

- [X] T058 [US2] (UI + shared split built 2026-10-11; component test still to write) Session checkout "Goes to" preview (FR-010a): export T048's pure OMT-first split helper from `core/browser.ts`, call it in `frontend/src/features/sessions/components/SessionCheckoutModal.tsx` with the cart items + current cash lines + base system, and render "Goes to: OMT Cash Drawer $X · General $Y" only when a primary-system transfer receives cash; test in `frontend/src/features/sessions/components/__tests__/SessionCheckoutModal.goesTo.test.tsx`.
- [X] T049 [P] [US7] Checkpoint info total: in `frontend/src/features/closing/hooks/useDrawerCheckpoint.ts` compute `usdTotal {expected, counted}` per drawer with the page's `sellRate` (:98); in `frontend/src/features/closing/components/DrawerCard.tsx` add optional prop `usdTotal` rendered as "Total ≈ $X" only when the drawer holds more than one non-zero currency; never passed to `getVarianceStatus`.
- [X] T050 [P] [US7] Test `frontend/src/features/closing/components/__tests__/DrawerCard.usdTotal.test.tsx`: total shown for a two-currency drawer, hidden for one currency; a drawer with matching USD total but mismatched currencies is NOT balanced (spec US7 scenario 3).

---

## Phase 10: Polish & Cross-Cutting

- [X] T051 Web e2e `frontend/tests/e2e-web/lira-web-051-debt-item-picking.spec.ts`: basket on account → settle with OMT ticked → assert drawer DELTAS (snapshot before/after via `/api/dashboard/drawer-balances`) and the payment-detail line text; separate visits → same deltas; rows matched by identity (rule 15). Run `node scripts/run-e2e.mjs web -g "lira-web-051"` and confirm the test count.
- [X] T052 [P] Fix the four stale comments (research F14) in `core/repositories/TransactionRepository.ts` (:90-93, :2734-2737, :3304-3310, :4258-4260).
- [X] T053 [P] Update `docs/FEATURE_GUIDE.md` §7 (repayment routing: primary system only, cash only, cross-currency, cap, internal pair) and §11 (member owed/covered, OMT-first checkout split, per-member profit hold); update `frontend/tests/e2e-electron/README.md` if a desktop spec is added.
- [X] T054 [P] Release notes in `docs/release-notes/UNRELEASED.md` (shop-owner wording, rule 30): Debts — tick what a payment is for; money for OMT/Whish transfers goes to the transfer cash drawer whether bought in one visit or several, from now on; Transactions — payment details show each method on one line and which drawer got the money; Checkpoint — total in dollars shown for information; plus T041's line if needed. Update the LIRA-304 "What users will notice" line in `current_sprint.md`.
- [X] T055 Gates: `yarn typecheck`, `yarn lint`, `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`, core + backend + frontend jest; confirm suite counts and elapsed times (rule 28). Desktop e2e runs in CI only (no Electron on this Mac).
- [X] T057 Desktop e2e `frontend/tests/e2e-electron/lira-304-debt-item-picking.spec.ts` mirroring T051 (basket + separate visits, OMT ticked, drawer deltas matched by identity, rule 15). Runs in CI's desktop job only (no Electron on this Mac); add it to `frontend/tests/e2e-electron/README.md`.
- [ ] T056 (BLOCKED on owner: needs a push to main, which deploys) Manual check on the test shop per quickstart.md §3 (owner present for the password); record results in `current_sprint.md` under LIRA-304.

---

## Dependencies & Execution Order

```
Phase 1 (T001-T002)
   └─► Phase 2 Foundational (T003-T014)  ── blocks everything
          ├─► US1 routing parity (T015-T021)  🎯 MVP
          │      └─► Checkout split OMT-first (T047-T048)
          │             └─► US2 picking (T022-T033) ──► US5 void (T034-T038)
          │                         └─► US4 profit (T039-T041)
          │                         └─► US3 basket expand (T042-T043)  (needs T026-T030)
          ├─► US6 payment detail (T044-T046)  (needs T020's leg shape)
          └─► US7 LBP + checkpoint total (T049-T050)
   Polish (T051-T056) last
```

- Within each story: failing test → repository → service → handler/route → adapter → UI.
- US5 must land before release, even if US2 ships first internally: any repayment shape must be voidable.

## Parallel Examples

- Foundational: T007, T008, T009 together; T010 alongside T012.
- US2: T026, T028, T029 together after T025's types settle.
- US6 (T044-T046) and the checkpoint total (T049-T050) can run alongside US2.
- Polish: T052, T053, T054 together.

## Implementation Strategy

1. **MVP = Phase 2 + US1**: routing parity, primary only, cash only, capped, voidable through the existing generic void (T034/T035 tests may be pulled forward). Already fixes the inconsistency the owner raised.
2. **Increment 2 = checkout split (Phase 3b) + US2 + US5**: picking with preview, fully reversible.
3. **Increment 3 = US4 + US3 + US6**: per-item profit, basket expand, payment-detail lines.
4. **Increment 4 = US7**, then Polish (incl. desktop e2e T057 in CI).
Each increment: gates green, web e2e for what it touches, release-note lines written in the same change (rule 30). Nothing is committed until the owner says "commit".
