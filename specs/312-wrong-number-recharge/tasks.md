---
description: "Task list for LIRA-312 Wrong-Number Card Recharge"
---

# Tasks: Wrong-Number Card Recharge

**Input**: `specs/312-wrong-number-recharge/`, which holds plan.md, spec.md, research.md, data-model.md, contracts/wrong-number.md and quickstart.md.

**Tests**: These are required by Constitution §VI and CLAUDE.md rule 17. Write each guard test FIRST and see it FAIL on the unchanged code before the fix, then record the real failure. Never revert finished code to prove a test. Money flows need net-zero tests per ledger and per currency (rule 20). **Ask the owner before running any test suite** (standing preference).

**Organization**: tasks are grouped by user story: US1 (P1) refund as wrong number, US2 (P1) credits received, US3 (P2) expense path, US4 (P2) undo.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task).
- **[Story]**: US1–US4 from spec.md.

## Conventions for every task

- Core paths are `packages/core/src/…`. After any core change, rebuild and sync: `cd packages/core && npm run build && cp -r dist/. ../../node_modules/@liratek/core/dist/`.
- Every SQL statement uses `tenant_id` and `?` placeholders only. Repositories extend `BaseRepository`. Services never call `getDatabase()`; they use `repo.withTransaction(...)`.
- The envelope is `{ success, data?, error? }`, and REST answers HTTP 200 even when it refuses.
- Schemas live in `validators/wrongNumber.ts` and are exported from `validators/index.ts`, which `index.ts` and `browser.ts` both read. Adapter types are `z.input<…>`.
- **Parallel session**: another session is editing Expenses and Profits files (LIRA-310/311). Do not start T023/T024 (Profits) or T026 (Expenses UI) until `git status` shows its edits committed, and stage only this ticket's hunks.

---

## Phase 1: Setup

- [ ] T001 Read the last entry of `packages/core/src/db/migrations/index.ts`. Confirm it is still **v211**; if not, use last+1 everywhere this file says v212, and record the number here.
- [ ] T002 Add the LIRA-312 entry to `current_sprint.md` (edit only that section): owner decisions 2026-10-12, a link to the spec, and a "What users will notice:" line.
- [ ] T003 [P] Read `docs/FEATURE_GUIDE.md` §13 and `specs/312-wrong-number-recharge/plan.md` §13 before writing any money code (rule 18).

---

## Phase 2: Foundational (blocks all stories)

- [ ] T004 Add migration **v212** `wrong_number_cards` in `packages/core/src/db/migrations/index.ts`, with a `down()`. Columns:
  - `id INTEGER PK`, `tenant_id INTEGER REFERENCES tenants(id)`
  - `expense_id INTEGER NOT NULL REFERENCES expenses(id)`
  - `expense_transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id)`
  - `sale_transaction_id INTEGER NULL REFERENCES transactions(id)`
  - `provider TEXT NOT NULL CHECK(provider IN ('iPick','Katsh','WHISH_APP'))`
  - `carrier TEXT NOT NULL CHECK(carrier IN ('mtc','alfa'))`
  - `mobile_service_item_id INTEGER NOT NULL REFERENCES mobile_service_items(id)`
  - `card_label TEXT NOT NULL`
  - `card_cost_lbp REAL NOT NULL CHECK(card_cost_lbp > 0)`
  - `card_credit_usd REAL NOT NULL CHECK(card_credit_usd >= 0)`
  - `wrong_number TEXT NOT NULL`, `right_number TEXT NULL`
  - `created_at`, `updated_at`

  Add an index `(tenant_id, sale_transaction_id)`.
- [ ] T005 Mirror T004 byte-for-byte into `electron-app/create_db.sql` and add `(212, 'wrong_number_cards')` to its migrations seed list. Then:
  - add `wrong_number_cards` to `RESET_WIPE_TABLES` in `packages/core/src/constants/resetTables.ts`;
  - append it to `OFFLINE_ID_TABLES` in `packages/core/src/offline/idRange.ts` (append-only);
  - add a v212 seed row to `packages/core/src/repositories/__tests__/DatabaseResetRepository.test.ts`.
- [ ] T006 [P] Write the migration test `packages/core/src/db/migrations/__tests__/v212.wrongNumberCards.test.ts`. Mirror `v211.resaleLines.test.ts`: v212 follows v211; the table has `id`/`tenant_id`/timestamps; the provider/carrier CHECKs hold; `expense_transaction_id` is UNIQUE; `down()` drops the table.
- [ ] T007 Register the transaction type `WRONG_NUMBER_CREDITS` everywhere:
  - `constants/transactionTypes.ts` (reversible, NOT in `NON_REVERSIBLE_TRANSACTION_TYPES`);
  - label "Credits recovered" in `utils/transactionText.ts`;
  - `TRANSACTION_CASH_DIRECTION.WRONG_NUMBER_CREDITS = "in"` in `utils/cashFlow.ts`;
  - a posting rule in `constants/postingRules.ts`, modelled on the `TELECOM_CREDIT_BUYBACK` entry;
  - `ACTIONABLE_TYPES` in `frontend/src/features/audit/auditConstants.ts`.
- [ ] T008 Create `packages/core/src/validators/wrongNumber.ts` with `recordWrongNumberSchema`, `wrongNumberCreditsSchema` and `listWrongNumbersQuerySchema`, exactly as in `contracts/wrong-number.md`:
  - `superRefine`: `right_number` is required when `sale_transaction_id` is set;
  - export input and output types;
  - export from `validators/index.ts`;
  - re-export in `electron-app/schemas/index.ts` with the zod-major cast.
- [ ] T009 Create `packages/core/src/repositories/WrongNumberRepository.ts`. Methods:
  - `withTransaction`, `insert`, `getById`, `getByExpenseTransactionId`, `list(filters)`;
  - `getActiveCredits(cardId)`, which reads `transactions` with `type='WRONG_NUMBER_CREDITS' AND source_table='wrong_number_cards' AND source_id=? AND status='ACTIVE'` through one named constant fragment (rule 14);
  - `getCardItem(itemId, provider)`, which returns the active `mobile_service_items` row with cost_lbp, credits, label and category.

  Register it in `repositories/index.ts`.

**Checkpoint**: schema, type and repository exist, and the core build is green.

---

## Phase 3: User Story 1 — Refund as wrong number on a saved sale (P1) 🎯 MVP

**Goal**: on an active iPick/Katsh/Whish App card sale, "Wrong number…" records the wrong recharge as a loss (a stock-use expense of the picked card) linked to the sale. The sale stays untouched and counts as the correct recharge.

**Independent Test** (quickstart W2, W3):
- After the action on an 800,000 sale: the sale is unchanged, iPick shows an extra −770,000, the expense is 770,000 "Wrong number card", and the record is WAITING with the right number stored.
- The same number typed in two formats is refused.

### Tests (write first, see them fail)

- [ ] T010 [P] [US1] Write `packages/core/src/services/__tests__/WrongNumberService.record.test.ts` (W1, W2, W3) on a real in-memory DB with the stock-expense tables. Check:
  - path B: the provider drawer delta is −770,000 LBP, the sale's transaction/payments rows are byte-identical before and after, and one `EXPENSE_IPICK` with category "Wrong number card" exists;
  - `wrong_number_cards` has `card_cost_lbp` 770000, `card_credit_usd` 7.58, `sale_transaction_id` set and `right_number` normalised;
  - refusals: a non-MTC/Alfa item; another provider's sale; a voided sale; right = wrong in "+961 3 …" vs "03 …" form.
- [ ] T011 [P] [US1] Write `frontend/src/features/audit/__tests__/wrongNumberAction.test.tsx`:
  - "Wrong number…" shows on an ACTIVE `FINANCIAL_SERVICE` row with `metadata.provider` iPick/Katsh/WHISH_APP, and not on other rows or refunded/voided ones;
  - the panel defaults the card to the first MTC/Alfa item named in the sale note;
  - the payload equals `recordWrongNumberSchema.parse(fixture)` (rule 24);
  - the `useApi` mock is stable (rule 25).

### Implementation

- [ ] T012 [US1] Create `packages/core/src/services/WrongNumberService.ts` with `recordWrongNumber(input, userId)`, all inside `repo.withTransaction`. It:
  - validates the card (an active MTC/Alfa prepaid item of the provider, `cost_lbp > 0`);
  - on path B, validates the sale (ACTIVE `FINANCIAL_SERVICE` with `metadata_json.provider` equal to the input provider) and that `isSameLebanesePhone(right, wrong)` is false;
  - calls `ExpenseRepository.createStockExpense({ source: provider, item_id, quantity: 1, category: "Wrong number card", description: "Wrong number <wrong> — <card>", expense_date })`;
  - inserts `wrong_number_cards` with snapshots;
  - if `credits_received` is set, calls the US2 writer (T020) in the same transaction.

  T010 passes. Register it in `services/index.ts`.
- [ ] T013 [US1] Wire `wrong-numbers:record` and `wrong-numbers:list` on every layer:
  - IPC `electron-app/handlers/wrongNumberHandlers.ts`: `requireRole(['admin','staff'])` for record, any session for list, `userId` from the session; register in `electron-app/main.ts`;
  - `electron-app/preload.ts` binding with full types, and `frontend/src/types/electron.d.ts`;
  - classify both channels (record online-only, list read) in `packages/core/src/offline/channelPolicy.ts`, and update the counts in `electron-app/offline/__tests__/channelPolicy.complete.test.ts`.
- [ ] T014 [US1] Create REST routes in `backend/src/api/wrongNumbers.ts`: `POST /` (authenticateJWT → requireRole admin, staff → validateRequest; `userId` from the JWT) and `GET /`. Mount them at `/api/wrong-numbers` in `backend/src/server.ts`. Add a route test `backend/src/api/__tests__/wrongNumbers.api.test.ts` with the role gate, payload-from-schema and the 200 envelope.
- [ ] T015 [US1] Add `recordWrongNumber` and `getWrongNumbers` (`ipcOrHttp`) in `frontend/src/api/backendApi.ts`, `frontend/src/api/ElectronApiAdapter.ts` and `packages/ui/src/api/types.ts`.
- [ ] T016 [US1] Create `frontend/src/features/wrongNumbers/components/WrongNumberPanel.tsx`. It has:
  - a card picker (`api.getActiveMobileServiceItems()` filtered to the sale's provider, MTC/Alfa prepaid, `cost_lbp > 0`, defaulting from the sale note);
  - a wrong-number field and a right-number field;
  - an optional "credits already received" amount + shop-line select (active lines of the card's carrier, via `getAllActiveCarrierLines`);
  - a cost/loss preview such as "Loss 770,000 LBP".

  It submits one payload (rule 22).
- [ ] T017 [US1] Add a row action "Wrong number…" in `frontend/src/features/audit/components/TransactionCells.tsx`, with a predicate in `frontend/src/features/audit/actionGating.ts` (`isWrongNumberEligible(row)`). Render it in the plain branch AND for session basket members, since the sale is not reversed. Open `WrongNumberPanel` from `frontend/src/features/audit/pages/TransactionsViewer.tsx`. T011 passes.

**Checkpoint**: path B works on desktop and web, and the loss is booked.

---

## Phase 4: User Story 2 — Credits received (P1)

**Goal**: credits sent back are entered against a wrong-number record, in parts, on a chosen shop line. The shop line and the MTC/Alfa drawer rise by +X USD, and the loss falls by X × the resold-credit price.

**Independent Test** (W4, W5, W6, W7, W10): $6.68 on the Alfa shop line → line +6.68, Alfa drawer +6.68, profit_lbp 668,000, remaining loss 102,000. Entries above the card credit are refused, and so is a line of the other carrier.

### Tests (write first, see them fail)

- [ ] T018 [P] [US2] Write `packages/core/src/services/__tests__/WrongNumberService.credits.test.ts` (W4–W7, W9):
  - deltas on `carrier_lines.credits`, the carrier drawer USD and the `WRONG_NUMBER_CREDITS` transaction, with `profit_lbp = X × telecom_credit_sell_price_lbp` and the rate stored in metadata;
  - cumulative cap: refuse once the total would exceed `card_credit_usd`;
  - wrong carrier or inactive line refused;
  - voiding the entry through `TransactionRepository.voidTransaction` returns the line, the drawer and profit to the prior snapshot (net 0, per currency).
- [ ] T019 [P] [US2] Write `packages/core/src/repositories/__tests__/ProfitRepository.wrongNumberRecovery.test.ts` (W10): a new `getWrongNumberRecoveryTotals(from,to)` sums the profit_lbp of ACTIVE `WRONG_NUMBER_CREDITS` rows, and drops voided ones. Give it a documented gate/exclusion so `constants/__tests__/profitRecognition.guard.test.ts` passes.

### Implementation

- [ ] T020 [US2] Add `WrongNumberService.recordCreditsReceived(input, userId)` inside `repo.withTransaction`, in the shape of `RechargeRepository.processCreditBuyback`:
  - read `telecom_credit_sell_price_lbp` through a repository settings read (default 100,000);
  - write a `WRONG_NUMBER_CREDITS` transaction (`source_table='wrong_number_cards'`, `source_id`, `amount_usd=X`, `profit_lbp=X×rate`, `profit_usd=0`, metadata `{carrier, carrier_line_id, credit_rate_lbp}`, `exchange_rate` stamped);
  - call `CarrierLineService.applyMovement({ carrierLineId, creditsDelta:+X, validityDaysDelta:0, reason:"WRONG_NUMBER_CREDITS", transactionId })`;
  - post a `+X` USD payments leg on the carrier drawer, plus the existing drift-correction leg rule, using the same leg writer as the buy-back;
  - check the line's carrier matches, the line is active, and the cap holds.

  T018 passes.
- [ ] T021 [US2] Wire `wrong-numbers:credits` on IPC (admin, staff) and REST (`POST /api/wrong-numbers/:id/credits`), plus preload, `electron.d.ts`, the channelPolicy entry (online-only) and adapter `recordWrongNumberCredits`. Extend the T014 route test.
- [ ] T022 [US2] Create `frontend/src/features/wrongNumbers/components/CreditsReceivedPanel.tsx`. It shows:
  - the card, the wrong and right numbers, card cost, total recovered, remaining loss and status;
  - the list of entries;
  - an amount + shop-line select (active lines of the card's carrier) with the remaining-credit cap shown.

  Open it from the "Wrong number…" action when a record already exists for the sale, and from any `WRONG_NUMBER_CREDITS` row.
- [ ] T023 [US2] Add `getWrongNumberRecoveryTotals` in `packages/core/src/repositories/ProfitRepository.ts`. Add it to `PROFIT_TXN_TYPES` and add a gross-profit LBP term in `packages/core/src/services/ProfitService.ts` (the WARRANTY_COST pattern). T019 passes. **Wait for the parallel session's Profits commit.**
- [ ] T024 [US2] Add a "Wrong-number credits recovered" line in `frontend/src/features/profits/pages/Profits.tsx`, next to expenses. **Wait for the parallel session's Profits commit.**

**Checkpoint**: credits flow end to end and the Profits page nets the loss.

---

## Phase 5: User Story 3 — Expense path (P2)

**Goal**: Expenses → use an item (iPick/Katsh/Whish App MTC/Alfa card) gets a "Wrong number" tick that records through `recordWrongNumber` (path A). The same Credits received panel works on it.

**Independent Test** (W1): ticking "Wrong number" on Alfa 7.58 → iPick −770,000, expense "Wrong number card", record WAITING; credits work as in US2.

- [ ] T025 [P] [US3] Write `frontend/src/features/expenses/pages/Expenses/__tests__/Expenses.wrongNumber.test.tsx`:
  - the tick shows only for an MTC/Alfa card item;
  - with it ticked, submit calls `recordWrongNumber` with `recordWrongNumberSchema` fields, not `addStockExpense`;
  - without it, today's flow is unchanged.
- [ ] T026 [US3] In `frontend/src/features/expenses/pages/Expenses/index.tsx`, inside the picked-item card (≈:419), add a "Wrong number" tick and a wrong-number field. When ticked, submit `api.recordWrongNumber({ provider, mobile_service_item_id, wrong_number, expense_date: localDay() })`. **Wait for the parallel session's Expenses commit.**
- [ ] T027 [US3] Make the "Credits received" action reachable from the expense row in Transactions (the `EXPENSE_IPICK/KATSH/WHISH_APP` row linked to a `wrong_number_cards` record) in `frontend/src/features/audit/components/TransactionCells.tsx`.

---

## Phase 6: User Story 4 — Undo (P2)

**Goal**: every step undoes, newest first, netting to 0. The expense refuses to undo while active credits exist.

**Independent Test** (W8, W9).

- [ ] T028 [P] [US4] Write `packages/core/src/repositories/__tests__/TransactionRepository.wrongNumberGuard.test.ts` (W8):
  - voiding the wrong-number expense with an active credits entry is refused with "Undo the credits received first.";
  - once the entry is voided, the expense void succeeds and the iPick balance is +770,000 back;
  - voiding a plain stock-use expense (no record) is unaffected.
- [ ] T029 [US4] Add the guard in `_assertReversible` (`packages/core/src/repositories/TransactionRepository.ts`), keyed on `wrong_number_cards.expense_transaction_id`, and reuse the T009 "active credits" fragment. T028 passes.

---

## Phase 7: Polish

- [ ] T030 Write the web e2e `frontend/tests/e2e-web/lira-web-NNN-wrong-number.spec.ts` (next free number): card sale → Wrong number… → credits $6.68 → void credits → void expense. Assert drawer, shop-line and iPick deltas by identity (rule 15). Ask before running.
- [ ] T031 [P] Write the handler role test `electron-app/handlers/__tests__/wrongNumberHandlers.roleGate.test.ts`: record and credits allow admin and staff; void stays admin-only through the existing channel.
- [ ] T032 Add release notes (`docs/release-notes/UNRELEASED.md`, only this ticket's lines):
  - Transactions/Mobile services: "Wrong number…" on a card sale records the wasted card as a loss, and you enter credits sent back later;
  - Expenses: a "Wrong number" tick when using an iPick/Katsh card;
  - Profits: a "Wrong-number credits recovered" line.
- [ ] T033 Run the quality gates (after asking the owner): `yarn lint`, `yarn typecheck`, `check:tenant-scoping`, `check:bind-arity`, `check:schema-equivalence`, `check:transport-parity`, the four test suites (record suite counts and times, rule 28), `yarn build`, and `build-release-notes --check`.
- [ ] T034 [P] Add a short `WRONG_NUMBER_CREDITS` section to `docs/FEATURE_GUIDE.md`: why it is not a refund; the reversal owners; the LBP stamp at the resold-credit price.

---

## Dependencies & order

```
Setup → Foundational ─┬─▶ US1 (record, path B) ─┬─▶ US2 (credits) ─▶ US4 (undo guard)
                      │                         └─▶ US3 (expense path; needs US2 panel for credits)
                      └── Profits/Expenses UI tasks (T023, T024, T026) wait for the parallel session's commit
                                                     all ─▶ Polish
```

- **US1** needs Phase 2.
- **US2** needs US1's record (or US3's).
- **US3** needs `recordWrongNumber` from T012 and the T022 panel.
- **US4** needs US2's entries to exist.

## Parallel opportunities

- Phase 2: T006 alongside T007/T008.
- US1: T010 and T011 together; T014 and T015 alongside T016.
- US2: T018 and T019 together; T021 alongside T022.
- US3: T025 alongside the US2 UI.
- Polish: T031 and T034.

## Implementation strategy

1. **MVP = Phases 1–3 + US2 core (T018–T021).** The owner can mark a wrong-number sale and enter credits on desktop and web. The Profits line can follow once the parallel session commits.
2. Then the US2 UI and Profits line, then the US3 Expenses tick, then the US4 guard.
3. Polish last. Commit on the owner's "commit" only.
