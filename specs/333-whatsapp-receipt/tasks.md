---
description: "Task list for LIRA-333 — Send the receipt on WhatsApp"
---

# Tasks: Send the receipt on WhatsApp (LIRA-333)

**Input**: Design documents from `specs/333-whatsapp-receipt/`. These are plan.md, spec.md, research.md, data-model.md, quickstart.md and the contracts in contracts/ (open-external.md, sale-receipt-read.md, whatsapp-message.md).

**Tests are mandatory here**. Constitution VI and CLAUDE.md rule 17 require that every guard test is written FIRST, run against the unfixed code, and its real failure recorded before the implementation task. Never revert or stash finished code to prove a test.

**Test runs**: run affected test files only, by explicit path (owner rule). Never run a full jest suite. Never run desktop e2e on the owner's Mac. Before trusting a green result, confirm the test count is above zero (rule 28a).

**No migration**: this feature only reads existing data. If an implementer finds that a migration is needed after all, stop and re-plan. The version number would be the next free one after the LAST entry in `packages/core/src/db/migrations/index.ts` at build time (v219 when this plan was written; other sessions add more).

**Format**: `[ID] [P?] [Story] Description`. [P] means the task can run in parallel because it touches different files and has no unmet dependency.

---

## Phase 1: Setup

**Purpose**: confirm the ground truth the plan relies on, before writing anything.

- [x] T001 Re-read `packages/core/src/repositories/SalesRepository.ts`:
  - `processSale` `sumPayments` (~L700–720)
  - the non-drawer IN-leg skip (~L1531)
  - `bookClientDebtCharge('Sale Debt')` (~L1779)
  - the voucher `redeemByCode` loop (~L1555)
  - `getSaleWithCustomer` (~L4678)

  Then confirm research R2–R4 still hold. If any line has moved in meaning (not just in line number), update `specs/333-whatsapp-receipt/research.md` before continuing.
- [x] T002 [P] Read the offline channel policy in `electron-app/offline/channelPolicy*.ts` and its tests. Confirm that `sales:get` and `sales:getItems` are allowed in desktop offline mode, and decide the class of the new local-only `app:open-external` channel. Record the result in `specs/333-whatsapp-receipt/research.md` R10, replacing the "Assumption (unverified)".

---

## Phase 2: Foundational (blocks every user story)

**Purpose**: the phone rule, the saved-sale read fields, the one receipt description, the WhatsApp text formatter and the open-outside-LiraTek path. US1, US2 and US3 all need all five.

### Phone rule (FR-014, FR-015)

- [x] T003 [P] Write a failing-first test, `packages/core/src/utils/__tests__/whatsappPhone.test.ts`. It encodes the spec FR-014 table verbatim:
  - `03 123 456`, `03-123456` and `(03) 123456` → `9613123456`
  - `76901610` → `96176901610`
  - `+961 76 901 610` → `96176901610`
  - `0096176901610` → `96176901610`
  - `96176901610` → `96176901610`
  - `+33 6 12 34 56 78` and `0033612345678` → `33612345678`
  - `+961 03 123 456` → `9613123456`
  - `abc`, `12` and `""` are rejected, as are whitespace-only and a 16+ digit number.

  The function returns `{ ok: true, digits } | { ok: false, reason: "empty" | "invalid" }`. Run it and record the failure: the module is missing.
- [x] T004 Implement `toWhatsAppNumber` in `packages/core/src/utils/whatsappPhone.ts`, following research R6 rules 1–8. It is pure with zero imports. Export it from `packages/core/src/browser.ts` and `packages/core/src/index.ts`. Run T003 and `packages/core/src/__tests__/browserEntryIsNodeFree.guard.test.ts`.
- [x] T005 Replace the private `formatLebanonNumber` in `packages/core/src/services/WhatsAppService.ts` with `toWhatsAppNumber`. An `{ ok: false }` result returns `{ success: false, error: "Invalid phone number" }` without calling the API. Adjust or add the affected test in `packages/core/src/services/__tests__/` (WhatsAppService test, if one exists) with one `0096…` case and one foreign-number case. Write the case first and see it fail on the old method.

### Saved-sale read fields (contracts/sale-receipt-read.md)

- [x] T006 [P] Write a failing-first test, `packages/core/src/repositories/__tests__/SalesRepository.receiptRead.test.ts`, part 1, covering the phone fields:
  - Walk-in sale with a typed phone: `sale_phone` is that phone and `linked_client_phone` is null.
  - Linked-client sale: `linked_client_phone` is `clients.phone_number`. Assert what `sale_phone` is (the `transactions.client_phone` stamp). Record the observed value in research R4, which settles that assumption.
  - The existing `client_phone`/`client_name` values are unchanged.
- [x] T007 [P] Write part 2 of the same test file, the failing-first variant matrix (rule 28d). Each case books a real sale through `processSale` with the real leg shape, then asserts `tender_usd`, `tender_lbp`, `gift_card_usd`, `on_account_usd`, `change_given_usd` and `change_given_lbp`. The cases are:
  - (a) cash USD only
  - (b) USD + LBP
  - (c) fully on account
  - (d) partly on account, USD
  - (e) partly on account, with the account leg in LBP: the expected `on_account_usd` is the USD equivalent
  - (f) gift card covering part
  - (g) gift card + account
  - (h) change in USD and LBP
  - (i) discount + extra
  - (j) an on-account sale, then a debt repayment through the real `DebtRepository.addRepayment`: every receipt field is identical before and after, even though `sales.paid_usd` changes. This is the immutability guard for SC-003.
  - (k) a partial item refund: the receipt fields are identical before and after (R7)
  - (l) a session-basket sale (`deferPayment: true`). It writes no `payments` row on its own transaction; the basket checkout pools the cash (SalesRepository ~L1819 back-fills `paid_*`). Assert what the receipt shows, and record the choice in research R3. If it shows tender 0 for a paid session item, fall back to the basket's back-filled `paid_*` ONLY for deferred sales, and say so in R3.

  Every subquery must be tenant-scoped. Add a case where another tenant has the same txn id and its rows are ignored.
- [x] T008 Extend `getSaleWithCustomer` in `packages/core/src/repositories/SalesRepository.ts` with `sale_phone` (`t.client_phone`), `linked_client_phone` (`c.phone_number`), `tender_usd`, `tender_lbp`, `gift_card_usd` and `on_account_usd`, per data-model.md:
  - `tender_*` = "SUM(payments.amount) WHERE transaction_id = SALE txn AND amount > 0", per currency
  - `gift_card_usd` = "SUM(vouchers.amount) WHERE redeemed_transaction_id = SALE txn"
  - `on_account_usd` = "MAX(0, SUM(debt_ledger.amount_usd WHERE transaction_type='Sale Debt' AND transaction_id = SALE txn AND amount_usd > 0) − gift_card_usd)"

  Define the tender, 'Sale Debt' and voucher predicates once, as named SQL fragments (rule 14). Use `?` binds and `tenant_id` on every table, and update the return type. Run T006 and T007. Then run `yarn check:tenant-scoping` and `yarn check:bind-arity`.
- [x] T009 Rebuild and sync core: `cd packages/core && npm run build`, then `cp -r packages/core/dist/. node_modules/@liratek/core/dist/` from the repo root.

### One receipt description + WhatsApp text (FR-005..FR-011)

- [x] T010 [P] Add the six optional fields to the `SaleDetail` interface in `frontend/src/features/sales/pages/POS/components/SaleDetailModal.tsx` (~L91): `sale_phone?: string | null`, `linked_client_phone?: string | null`, `tender_usd?: number`, `tender_lbp?: number`, `gift_card_usd?: number` and `on_account_usd?: number`. Do the same for any shared sale type it imports. Missing values read as null or 0.
- [x] T011 [P] Write a failing-first test, `frontend/src/features/sales/utils/__tests__/saleReceipt.test.ts`. It covers:
  - **`buildSaleReceiptData(sale, items, shop)`** maps every field listed in data-model.md. In particular:
    - `receipt_number` = `receiptNumberFor(sale.id)`
    - `timestamp` = `sale.created_at`
    - `exchange_rate` = `sale.exchange_rate_snapshot`
    - stamped `warranty_until`
    - `total` = `final_amount_usd + extra_usd`
    - `payment_*` = `tender_*` (NOT `paid_*`, which a repayment changes)
    - `gift_card_usd` and `on_account_usd` passed through
    - `on_account_lbp` = 0
  - **`recipientPhoneFor(sale)`** returns `sale_phone`, then `linked_client_phone`, then null.

  Take the fixture field names from the `SaleDetail` type, not hand-typed (rule 24).
- [x] T012 Implement `buildSaleReceiptData` and `recipientPhoneFor` in the new file `frontend/src/features/sales/utils/saleReceipt.ts`. Add `gift_card_usd?: number` to `ReceiptData` in `frontend/src/features/sales/utils/receiptFormatter.ts`. Print a "Gift card:" line in `formatReceipt58mm` and `formatReceipt80mm` when it is above 0. Run T011 and `frontend/src/features/sales/utils/__tests__/receiptFormatter.test.ts`.
- [x] T013 [P] Write failing-first tests for `formatReceiptWhatsApp` and `buildWhatsAppLink` in `frontend/src/features/sales/utils/__tests__/receiptFormatter.test.ts`, following contracts/whatsapp-message.md. They must check:
  - line order;
  - lines are omitted when the paper receipt omits them;
  - "On account" is its own line and never inside "Paid";
  - no padding runs and no fixed-width columns;
  - every figure string equals the one `formatReceipt58mm` prints for the same `ReceiptData` (SC-002);
  - Arabic text survives `encodeURIComponent` round-trip;
  - no cost or profit field appears;
  - the shortening order holds when the text is over `WHATSAPP_TEXT_MAX_ENCODED` (totals, payment, account and change are kept, and the "(shortened — ask the shop for the full receipt)" line is added).
- [x] T014 Implement `formatReceiptWhatsApp(data)`, `buildWhatsAppLink(digits, text)` and `export const WHATSAPP_TEXT_MAX_ENCODED = 2000` in `frontend/src/features/sales/utils/receiptFormatter.ts`. The constant is provisional until T031 and carries a comment saying so. The date and time use the same `toLocaleDateString()`/`toLocaleTimeString()` calls as paper (rule 27: the client's device). Run T013.

### Open outside LiraTek (contracts/open-external.md)

- [x] T015 [P] Write a failing-first schema test, `packages/core/src/validators/__tests__/app.test.ts`:
  - accepts `https://wa.me/9613123456?text=x` and `https://api.whatsapp.com/send?phone=1`;
  - rejects `http://wa.me/…`, `https://evil.com/…`, `https://wa.me.evil.com/…`, `javascript:…`, `file:///…` and an empty string.
- [x] T016 Create `packages/core/src/validators/app.ts` with `WHATSAPP_HOSTS = ["wa.me", "api.whatsapp.com"]`, `openExternalUrlSchema` and `OpenExternalUrlInput = z.input<typeof openExternalUrlSchema>`. The module imports only `zod`. Re-export it from `packages/core/src/validators/index.ts`, `packages/core/src/index.ts` and `packages/core/src/browser.ts`. Run T015 and the `browserEntryIsNodeFree` guard, then rebuild and sync core as in T009.
- [x] T017 [P] Write a failing-first handler test, `electron-app/handlers/__tests__/appShellHandlers.test.ts`, with `electron.shell.openExternal` mocked:
  - an allowed URL calls it once and returns `{ success: true }`;
  - a refused URL never calls it and returns `{ success: false, error: "URL not allowed" }`;
  - a shell rejection returns `{ success: false, error }`.
- [x] T018 Create `electron-app/handlers/appShellHandlers.ts` with a `registerAppShellHandlers()` that registers `app:open-external`:
  - `validatePayload(openExternalUrlSchema, data)`, then `shell.openExternal(url)`;
  - no `requireRole`, with the reason written in a comment;
  - the module logger warns on a refusal.

  Also:
  - Re-export the schema in `electron-app/schemas/index.ts` with the zod-major cast.
  - Register it in `electron-app/main.ts`.
  - Classify the channel in the offline channel policy, as decided in T002.

  Run T017 and any channel-policy completeness test the offline folder has (e.g. `electron-app/offline/__tests__/channelPolicy.complete.test.ts`, `handlerBindingParity.test.ts`).
- [x] T019 Add `app: { openExternal: (data: OpenExternalUrlInput) => ipcRenderer.invoke("app:open-external", data) }` to `electron-app/preload.ts`. Add the matching type in `frontend/src/types/electron.d.ts` (rule 12).
- [x] T020 Add `openExternalUrl(input: OpenExternalUrlInput)` to `frontend/src/api/backendApi.ts`. It is the only transport branch:
  - **desktop:** `getElectronApi().app.openExternal(input)`;
  - **web:** validate with `openExternalUrlSchema.safeParse`, then a synchronous `const w = window.open(input.url, "_blank")`. Never pass `"noopener"`: it makes `window.open` always return null. `null` → `{ success: false, error: "blocked" }`; otherwise set `w.opener = null` and return `{ success: true }`. There must be NO `await` before `window.open`.

  Expose it in `frontend/src/api/ElectronApiAdapter.ts`, and type it on `ApiAdapter` in `packages/ui/src/api/types.ts` with the core-derived type (rule 21). Write a unit test for the web arm first and see it fail: null → blocked, and no `await` before the call. Put it in `frontend/src/api/__tests__/openExternalUrl.test.ts`. Also check the web-test `window.api` shim described in `docs/plans/ongoing_plans/WEB_PARITY_ROADMAP.md`. If the shim makes `isElectron()` true in web e2e, the shim needs an `app.openExternal` entry that routes to `window.open`; add it there, or T029 will exercise the wrong arm.

**Checkpoint**: phone rule, read fields, shared description, WhatsApp text and the open path all exist and are unit-tested. No UI uses them yet.

---

## Phase 3: User Story 1 — Send the receipt right after a sale (P1) 🎯 MVP

**Goal**: after Complete Sale, a non-blocking strip appears: "Sale completed — RCP-n · Send on WhatsApp · Print". Send opens WhatsApp on the sale's number with the saved-sale receipt.

**Independent test**: complete a sale for a client with `03 123 456`. Send opens `https://wa.me/9613123456?text=…`, and the decoded text's figures equal that sale's reprint.

- [x] T021 [P] [US1] Write a failing-first hook test, `frontend/src/features/sales/hooks/__tests__/useSendReceiptOnWhatsApp.test.tsx`, with a module-level stable `mockApi` (rule 25). It covers:
  - prefetch calls `getSale` and `getSaleItems` once per saleId;
  - `send()` calls `openExternalUrl` synchronously, with no awaited promise between the click and the call, using the `buildWhatsAppLink(toWhatsAppNumber(recipientPhoneFor(sale)).digits, formatReceiptWhatsApp(buildSaleReceiptData(...)))` URL;
  - a missing phone → `needsNumber` state;
  - an invalid typed number → error, with no open;
  - a `{ success: false, error: "blocked" }` result → a visible "WhatsApp could not be opened — allow pop-ups and try again" message (FR-018);
  - **FR-023 no-write guard**: across every path, the only `mockApi` methods called are `getSale`, `getSaleItems`, `openExternalUrl` and the shop-info read; no write method is ever called.
- [x] T022 [US1] Implement `frontend/src/features/sales/hooks/useSendReceiptOnWhatsApp.ts`:
  - input `saleId | null`;
  - prefetches through `apiRef.current` (rule 25);
  - exposes `{ status: "loading" | "ready" | "error", needsNumber, send(typedNumber?), error }`;
  - takes shop info from the same source `SaleDetailModal` uses today (`shopInfo`/`useShopName`);
  - the typed number is kept only in state and never persisted (FR-013).

  Run T021.
- [x] T023 [P] [US1] Create `frontend/src/features/sales/components/SendOnWhatsAppButton.tsx`, a default-export component:
  - it takes a `saleId` and renders "Send on WhatsApp";
  - it is disabled while loading and shows an error state;
  - when `needsNumber` is set, it shows a small inline number field with live `toWhatsAppNumber` validation, plus Send and Cancel;
  - the confirming click calls `send(typed)` synchronously;
  - the client "Receive updates via WhatsApp" switch is NOT read (FR-020).

  Add `frontend/src/features/sales/components/__tests__/SendOnWhatsAppButton.test.tsx`, written first: it renders for a client whose WhatsApp switch is OFF, and the button stays enabled.
- [x] T024 [US1] Create `frontend/src/features/sales/pages/POS/components/SaleCompletedStrip.tsx`:
  - text "Sale completed — RCP-<id> · Send on WhatsApp · Print", with RCP from `receiptNumberFor(id)`;
  - Print calls the same `formatReceipt58mm(buildSaleReceiptData(...))` and `printReceipt` path as the details window;
  - non-modal, with no focus capture, so typing and scanning still reach POS;
  - a close (×) button.
- [x] T025 [US1] Wire the strip into `frontend/src/features/sales/pages/POS/index.tsx`:
  - on `processSale` success (~L699–745), set `completedSaleId = result.id`;
  - clear it when the cart gets its first item, a draft is resumed, or checkout opens;
  - another completed sale replaces it;
  - keep the existing "Sale completed successfully!" notification and the `fixFocus()` call;
  - do NOT open WhatsApp automatically (FR-004);
  - complete-without-send takes the same steps as today (SC-007).

  Add or extend a POS page test in `frontend/src/features/sales/pages/POS/__tests__/` (whichever existing file covers completion) for show, hide and replace, writing the case first.

**Checkpoint**: US1 works on both apps at unit level; it is proven in the browser in Phase 5.

---

## Phase 4: User Story 2 — Send the receipt of a past sale (P1)

**Goal**: "Send on WhatsApp" next to "Print" in the sale details window, wherever it opens (POS recent sales, Transactions, Warranty lookup).

**Independent test**: open last week's sale. The message has the same RCP, date, items, warranty dates and amounts (at the saved rate) as its reprint, and it equals the strip's message for the same sale (SC-003).

- [x] T026 [P] [US2] Write a failing-first test in `frontend/src/features/sales/pages/POS/components/__tests__/SaleDetailModal.whatsapp.test.tsx`, with a stable `mockApi`. It covers:
  - the button is shown next to Print for `status: "completed"` and hidden for a draft (FR-003);
  - Print now builds through `buildSaleReceiptData`, and the printed text shows the "On account" line for a sale with `on_account_usd > 0`, which reconciles the two printouts (FR-006, FR-008);
  - an old sale uses `exchange_rate_snapshot`, not the current rate (US2-3);
  - after the customer phone is edited and saved, the re-fetched `sale_phone` is used (US2-2);
  - a refunded sale gets the same text as its reprint (US2-4).
- [x] T027 [US2] In `frontend/src/features/sales/pages/POS/components/SaleDetailModal.tsx`:
  - replace the inline `ReceiptData` literal in `handlePrintReceipt` (~L568–602) with `buildSaleReceiptData(sale, items, shopInfo)`;
  - render `<SendOnWhatsAppButton saleId={sale.id} />` beside the Print button (~L986), only when `sale.status === "completed"`;
  - after a customer edit is saved, the hook refetches, so the new phone is used.

  Run T026 plus the existing `SaleDetailModal` tests touched by the Print change.
- [x] T028 [US2] Check each opener: `frontend/src/features/audit/pages/TransactionsViewer.tsx`, `frontend/src/features/warranty/pages/WarrantyLookup.tsx` and the POS recent-sales list in `frontend/src/features/sales/pages/POS/index.tsx`. Confirm they all render the same `SaleDetailModal` and need no change. If any passes a reduced sale object, fix it so the modal fetches through `getSale`.

**Checkpoint**: US1 and US2 share one description. The strip and details produce identical text for the same sale.

---

## Phase 5: User Story 3 — Works on the desktop app, the web app and a phone browser (P1)

**Goal**: the same button opens WhatsApp outside LiraTek on both apps, never inside a LiraTek window, and the LiraTek screen keeps its state.

**Independent test**: run US1 on web (e2e) and on desktop (manual, on the shop PC). WhatsApp opens on the right chat with the same text in both.

- [ ] T029 [US3] (WRITTEN as `lira-web-072-whatsapp-receipt.spec.ts`, typechecked, NOT RUN 2026-10-17: ports 3101/5174 were held by another process) Write the web e2e spec, `frontend/tests/e2e-web/lira-web-0NN-whatsapp-receipt.spec.ts`. Use the next free `lira-web-` number at build time; 071 was the highest when this plan was written. Before each click, stub `window.open` with `page.addInitScript` / `page.evaluate` to record calls. The spec covers quickstart.md scenarios 1–5:
  - strip RCP and URL for `03 123 456`;
  - the strip text equals the details text for the same sale;
  - the account line for a partly on-account sale;
  - the walk-in prompt: `abc` refused, and `+33 6 12 34 56 78` → `wa.me/33612345678`, with the sale phone unchanged afterwards;
  - a stub returning null shows the blocked message;
  - `page.url()` is unchanged.

  Match the sale by its id from the strip (rule 15), never by row position. Run only this spec with `node scripts/run-e2e.mjs web -g "LIRA-333"` and confirm that the reported test count is above 0.
- [ ] T030 [US3] (LEFT FOR THE OWNER — no Electron on the Mac) Desktop manual check on the Windows shop PC (not the owner's Mac): complete a sale and press Send in the strip, then in a details window. The WhatsApp desktop app (or the default browser) opens; no new LiraTek window appears; the POS cart and the scanner focus are intact. Record the result in `specs/333-whatsapp-receipt/quickstart.md` under "Manual". If no Windows run is possible in this change, write "desktop path unverified beyond T017 unit test" there (rule 28c).
- [ ] T031 [US3] (LEFT FOR THE OWNER — needs real devices; cap ships provisional at 2000) **Measure the message length cap (research R8, FR-011).** Build the worst-case sale: 40 lines, long names, serials, 600-character warranty terms, and an Arabic shop name and header. Open its link on:
  - (a) WhatsApp desktop for Windows from the desktop app;
  - (b) WhatsApp Web in Chrome;
  - (c) Android WhatsApp from a phone browser.

  Record the largest encoded length that arrives intact. Set `WHATSAPP_TEXT_MAX_ENCODED` in `frontend/src/features/sales/utils/receiptFormatter.ts` to it, minus a margin. Replace the "provisional" comment with the measurement date and devices, and update research R8. Re-run the T013 tests.

**Checkpoint**: all P1 stories are proven on web by e2e and on desktop by the unit test plus the manual check.

---

## Phase 6: User Story 4 — Other receipts on WhatsApp (P3, later ticket)

Out of this change, except for one guard that keeps the scope rule in one place (FR-022).

- [x] T032 [P] [US4] Write a guard test in `frontend/src/features/audit/__tests__/receiptGating.whatsapp.test.ts`. For every row type for which `isReceiptableTransaction` returns false (OMT, WHISH, OMT_APP, BINANCE, debt repayment), assert that `SendOnWhatsAppButton` is not rendered anywhere it could be reached. In this change that means it is only imported by `SaleDetailModal` and `SaleCompletedStrip`, which handle sales only. Write it as an import-graph assertion so that the later ticket must route through `isReceiptableTransaction`. Leave a `// LIRA-333 P3:` note in `frontend/src/features/audit/receiptGating.ts` saying the later phase gates WhatsApp with this same function.

---

## Phase 7: Polish & Cross-Cutting

- [x] T033 Add the release note line under `## 🛒 POS` (or the existing POS heading) in `docs/release-notes/UNRELEASED.md`, for both apps. Suggested wording: "After a sale, and from any past sale's details, you can now send the receipt to the customer on WhatsApp — WhatsApp opens on their chat with the receipt already written; you press Send." Add the "What users will notice:" line to LIRA-333 in `current_sprint.md` at implementation time; this planning step does not touch it.
- [x] T034 Run the quality gates: `yarn typecheck`, `yarn lint`, `yarn check:transport-parity` (no new `window.api` outside `backendApi.ts`), `yarn check:tenant-scoping` and `yarn check:bind-arity`. For `tsc`, measure the elapsed time; an empty output on its own is not a pass (rule 28a).
- [x] T035 Re-run only the affected unit tests listed in `specs/333-whatsapp-receipt/quickstart.md` and record their counts. Report anything that was not proven failing-first as "not proven failing-first" (rule 17).
- [x] T036 Tell the owner about the visible changes this introduces:
  - (a) the saved-sale printout now shows an "On account" line and a "Gift card" line, and its "Paid" no longer grows after the customer repays the debt (an existing reprint defect, fixed);
  - (b) an account portion taken in LBP shows as its USD equivalent on the saved receipt (research R3);
  - (c) a refunded sale's receipt still shows the original sale (R7).

  Put these in the hand-off message only; do not file them as release notes beyond T033.

---

## Dependencies & Execution Order

- **Setup (T001–T002)** comes first. T002 feeds T018.
- **Foundational (T003–T020)** blocks every story. Inside it, the order is:
  - test → implementation for each pair: T003→T004, T006/T007→T008, T011→T012, T013→T014, T015→T016, T017→T018, plus T020's own test;
  - T008 → T009 (core sync) before any frontend task that reads the new fields;
  - T016 → T018/T019/T020.
- **US1 (T021–T025)** depends on Foundational. T021→T022→T023→T024→T025.
- **US2 (T026–T028)** depends on Foundational and on T022/T023 (the shared hook and button). It can run alongside T024/T025.
- **US3 (T029–T031)** depends on US1 + US2 being done.
- **US4 (T032)** can run any time after T023.
- **Polish (T033–T036)** comes last.

## Parallel Opportunities

- T003, T006, T007, T011, T013, T015 and T017 are test-first files in different packages and can all be written together.
- T010 and T023 can run in parallel with the core tasks once their dependencies exist.
- T026 can run in parallel with T024/T025.

## Implementation Strategy

1. **MVP**: Phase 1 + Phase 2 + US1. That gives the strip's Send and Print from the saved sale.
2. Then US2 (the details button, and the reprint switching to the shared description, which fixes the printout disagreement).
3. Then US3 proof (web e2e, desktop manual, length measurement). Ship once T029 is green and T031 has been measured, or when the provisional cap is accepted by the owner.
4. US4 stays a later ticket.
