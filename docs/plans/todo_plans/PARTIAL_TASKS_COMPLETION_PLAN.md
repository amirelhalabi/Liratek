# Partial-Tasks Completion Plan (LIRA-069 / 070 / 072 / 077)

**Author:** Claude Fable 5 — 2026-07-19
**Executors:** 4 parallel Sonnet subagents (W1, W2, W4, W5), one workstream each.
**Verifier:** Fable 5 (integrated verification phase after all workstreams land).

Validated state as of 2026-07-19 (four-agent code audit): these four tickets are
PARTIAL — each has a shipped foundation and a precisely known remainder. This plan
finishes the remainders. Out of scope (blocked on owner data, do NOT attempt):
137 zero sell-prices in `mobileServices.ts` (business data), T6 shop-machine
version check (physical machine), T4 Windows timing repro (needs Windows).

---

## Global constraints — every workstream

1. **Read `docs/FEATURE_GUIDE.md` §13 before touching anything that writes
   transactions/payments/drawers/ledgers** (repo rule 18). W5 mandatory; W1/W4
   if their work touches a money write path.
2. **No commits, no branches.** Leave changes in the working tree. Fable
   verifies and the owner decides on commits.
3. **NEVER run `yarn test:e2e`, `yarn test:e2e:web`, or `yarn dev`.** Other
   agents are editing the renderer concurrently (a mid-edit agent breaks the
   Vite bundle for every spec) and the e2e DB is single-instance. WRITE e2e
   specs; Fable runs them in the verification phase.
4. **Do not rebuild/sync `packages/core` dist** (`npm run build` + xcopy) — done
   once centrally at verification. Exception: none.
5. **Core jest requires the Node-ABI dance and is reserved for W5 exclusively**
   (`cd packages/core && npm rebuild better-sqlite3 && npx jest <pattern> && npm run rebuild:native`).
   W1/W2/W4 write core tests if needed but run only `yarn typecheck` +
   `yarn workspace @liratek/frontend test` (vitest is safe to run concurrently).
6. **Regression tests are failing-first** (rule 17): where you fix behavior,
   first show the new test failing against the pre-fix code (temporarily revert
   your fix, run, watch fail, restore). Record the failing output in your report.
   For e2e specs (which you can't run), state exactly what the failing-first
   check is so Fable can execute it.
7. **Dual transport** (rule 19): any new IPC handler gets a mirroring REST route
   in `backend/src/api/` on the same core service, Zod schema lifted to
   `packages/core/src/validators/`, dual-mode fn in
   `frontend/src/api/backendApi.ts` (`ipcOrHttp`), exposed on
   `ElectronApiAdapter` + typed in `packages/ui/src/api/types.ts`. Frontend
   consumes via `useApi()`, never raw `window.api.*` in pages/components.
8. **Concurrent-edit protocol:** other agents may touch the same file (known
   hotspots listed per workstream). Keep edits minimal and localized; if an
   Edit fails because content changed, re-read the file and re-apply. Never
   rewrite a whole shared file with Write.
9. **Report format (final message):** files changed (path → one line), tests
   written + which you RAN with results, failing-first proof, open questions /
   owner decisions needed, exact verification steps for Fable.

---

## W1 — LIRA-069: finish receipt printing (frontend agent)

**Shipped already (do not rebuild):** shared `printReceipt` (logo) +
`buildServiceReceiptText` + `printServiceReceiptByTransaction(txnId, shop)`
(`frontend/src/features/audit/serviceReceipt.ts:168-232`); a per-row Print
button in the Transactions viewer (`TransactionsViewer.tsx:898-905`) gated by
`RECEIPTABLE_TYPES` (`frontend/src/features/audit/auditConstants.ts:307-313`);
POS has its own receipt path (`SaleDetailModal.tsx:526`, CheckoutModal
Preview/Print).

**Remaining criteria (validated 2026-07-19):**

### W1.a — Provider-level gating predicate (do FIRST — correctness bug)

Today the Print button shows on **every** FINANCIAL_SERVICE row, including OMT
System, Whish System, OMT App, Whish App transfers, and Binance — all of which
the ticket excludes. Providers are distinguishable: `provider` + `service_type`
are stamped into the unified row's `metadata_json` at write time
(`FinancialServiceRepository.ts:876-878`).

- Build ONE named predicate — e.g. `isReceiptableTransaction(txn)` in
  `frontend/src/features/audit/receiptGating.ts` (or extend `auditConstants.ts`)
  — that takes the transaction row (type + parsed `metadata_json`) and returns
  whether a customer receipt applies. Single source of truth (rule 14 spirit):
  the Transactions-viewer button, the History-modal buttons (W1.c), and
  auto-print (W1.d) must ALL call it. No copy-pasted provider lists.
- Include: RECHARGE (telecom/mobile), MAINTENANCE, CUSTOM_SERVICE, LOTO, and
  FINANCIAL_SERVICE rows for iPick/Katsh (KATCH/IPEC) catalog+bills.
  Exclude: providers OMT_SYSTEM/WHISH_SYSTEM (system transfers), OMT_APP /
  WHISH_APP transfers, BINANCE, and `RECHARGE_TOPUP`-class rows (drawer top-ups
  are not customer receipts). Grep the real provider enum values in
  `packages/core/src/constants/rechargeProviders.ts` — do not guess spellings
  (v105 renamed WISH_APP → WHISH_APP).
- **Whish App Bills are the exception — they ARE receiptable.** Bills flow
  through FinancialForm under provider WHISH_APP (Bills sub-mode,
  `Recharge/index.tsx:1320-1372`). Investigate how a WHISH_APP bill row differs
  from a WHISH_APP transfer row (`service_type`, `item_key`, note shape). If a
  reliable marker exists, include bills. If NOT distinguishable in persisted
  data, keep WHISH_APP excluded entirely, and say so in your report (owner
  follow-up) — do not include transfers by accident.
- Unit test: an include/exclude matrix over realistic row fixtures (each
  provider × service_type). Failing-first: the matrix fails against the current
  type-only gate.

### W1.b — Print button in the session checkout modal

`frontend/src/features/sessions/components/SessionCheckoutModal.tsx` has zero
print references. After a successful session-basket checkout, show a Print
button that prints the checkout's receipt via the existing shared path (the
basket books one carrier transaction — one receipt). Investigate how the
checkout result exposes the transaction id; if the IPC response doesn't return
it, prefer the smallest change that threads it through (the RECEIPTS_PLAN notes
"returning the txn id" as the intended step). No auto-print here — explicit
button only (the ticket: sessions skip the auto-dialog).

### W1.c — Print button in each module's History modal

Reprint from within recharge, financial-services, maintenance, custom-services,
and loto history surfaces (whatever history modal/table each module has — find
them; recharge's is `frontend/src/features/recharge/components/HistoryModal.tsx`).
Each row that maps to a receiptable transaction (per W1.a predicate) gets a
Print action calling `printServiceReceiptByTransaction`.

- History rows are module rows (e.g. `recharges.id`), not transaction ids.
  Check for an existing lookup (transactions by `source_id`/`item_key` — grep
  `getBySource` / `source_id` in `TransactionRepository` and the transactions
  API). Prefer an existing API. If a new core read method is unavoidable, add
  it **additively** (new method, new IPC read handler + REST mirror per global
  rule 7) — and be aware W5 is concurrently editing `TransactionRepository`'s
  void path; keep your addition separate and minimal.

### W1.d — Auto-open print dialog on successful standalone payment

- On a successful payment in the included modules (per the W1.a predicate),
  auto-open the print dialog through the same shared print path. Implement once
  (e.g. a `useAutoPrintReceipt` hook or a helper called from each success
  handler), not five hand-rolled copies.
- **Skip when a customer session is active** — module submits that go into the
  session basket must NOT auto-print (the session gets its W1.b button
  instead). Investigate how forms know a session is active (sessions context /
  `is_active`); gate on it.
- POS/sales keep their existing behavior (POS modal already has Preview/Print;
  the ticket's auto-print list is the service modules).
- Component test: mock the print path, assert it fires on success for an
  included module and does NOT fire for an excluded provider or when a session
  is active.

### W1.e — E2E spec (write only)

New `frontend/tests/e2e-electron/lira-069-receipt-print-gating.spec.ts`:
excluded provider rows show no Print button; included rows show it; (if
feasible headless) auto-print hook invoked on a standalone recharge. Follow
rule 15 (identity-matched rows, delta assertions, never row position). State
the failing-first procedure for Fable.

**Concurrent-edit hotspots:** W5 edits `KatchForm.tsx` / `FinancialForm.tsx`
submit-payload construction and `TransactionRepository.ts` (void path). Your
edits there are success-handler / read-method only — stay out of payload
construction and void code.

---

## W2 — LIRA-072: MTC voucher naming by card face value (frontend agent)

**Shipped already:** iPick alfa Prepaid + Katsh alfa/mtc Prepaid renamed to card
FACE VALUE — owner decision 2026-07-03 "(A1)", dated comment at
`frontend/src/data/mobileServices.ts:22-30, 317-345`.

**Remaining:** iPick **mtc** groups still amount-labeled:

- `mobileServices.ts:79-84` — mtc Credits: "3$".."15$"
- `mobileServices.ts:93-104` — mtc Prepaid: "credit only 1$", "10 days 3.79$", …
- `mobileServices.ts:85-91` — mtc Validity: day-counts

**Steps:**

1. Recover the A1 conversion rule: `git log -p --follow -- frontend/src/data/mobileServices.ts`
   around 2026-07-03 — see exactly how alfa labels mapped old→new (the face
   value appears to derive from the cost basis, e.g. "1.22", "3.03", "4.5").
2. Apply the SAME rule to the iPick mtc groups **only where the mapping is
   unambiguous** (e.g. "3$" whose card face value is derivable the same way the
   alfa ones were). **Never invent a card number.** Items whose printed-card
   value cannot be derived from the data you have (likely the Validity
   day-count bundles) stay unchanged — list them in your report as
   needs-owner-confirmation, mirroring how A1 was decided.
3. Keep the same dated-comment convention marking the rename and its rule.
4. Check consumers so nothing breaks: `useMobileServiceItems.ts:23-28`
   (`formatCatalogItemName`), `MobileServicesManager.tsx` (DB-backed live
   prices/overrides — determine whether names live in the DB too; **if a DB
   migration would be required to rename existing rows, DO NOT write it** —
   report back; W4 owns migration v132 and version collisions must be avoided),
   history rendering of old labels (LIRA-072 criterion: existing carts/history
   still render sensibly).
5. Test: a vitest snapshot/assertion pinning the renamed labels, plus whatever
   existing catalog tests cover naming.

Touches only `frontend/src/data/mobileServices.ts` + tests — no expected
conflicts.

---

## W4 — LIRA-077: stock adjustment UI + audit trail (general-purpose agent)

**Shipped already:** `InventoryService.adjustStock` (set-absolute, :326) and
`adjustStockDelta` (:345) with repo methods (`ProductRepository.ts:477,497`),
exposed at `electron-app/preload.ts:69`, `electron-app/handlers/inventoryHandlers.ts:280`,
`backend/src/api/inventory.ts:126-127`, typed at `electron.d.ts:364`. Negative-
stock detection surfaced read-only in Settings → Diagnostics
(`Diagnostics.tsx:358-425`). **No UI invokes adjustment; no audit trail.**

**Steps:**

1. **Migration v132** (latest is v131 — re-verify the tail of
   `packages/core/src/db/migrations/index.ts` before numbering):
   `stock_adjustments` — `id`, `product_id` (FK → products, ON DELETE CASCADE),
   `delta INTEGER NOT NULL`, `old_quantity`, `new_quantity`, `reason TEXT NOT NULL`,
   `user_id` (FK → users, ON DELETE SET NULL), `created_at`, `updated_at`;
   indexes on `product_id` and `created_at`; full `down()`. Mirror in
   `electron-app/create_db.sql` + its `schema_migrations` INSERT (rule 10).
   **Never ADD COLUMN with a CURRENT_TIMESTAMP default** (v104 prod-brick
   lesson) — this is a new table, so defaults in CREATE TABLE are fine.
2. **Core:** new `StockAdjustmentRepository` (create + `getByProduct` +
   `getRecent`; singleton + reset; export from `repositories/index.ts`).
   Extend `InventoryService.adjustStock`/`adjustStockDelta` to require
   `{ reason, userId }` and write the audit row in the SAME db transaction as
   the quantity change (repo-level transaction; services never touch the DB —
   rule 13). Keep backward compatibility of the service signature explicit —
   update the existing handler/route callers.
3. **Transport:** existing adjust handler/route now pass `reason`/`userId`
   (IPC: from `auth.userId`; REST: from `req.user`, never the client body —
   rule 19c). Zod schema for the payload in
   `packages/core/src/validators/inventory.ts` (create if missing), re-exported
   via `electron-app/schemas/index.ts` with the zod-major cast, used by BOTH
   transports. New read endpoint `inventory:getStockAdjustments(productId?)` +
   REST mirror + `backendApi.ts` dual-mode fn + `ElectronApiAdapter` +
   `packages/ui/src/api/types.ts` + `electron.d.ts`.
4. **Frontend (inventory feature):** an "Adjust stock" action per product row
   (`ProductList.tsx`) opening a modal: mode delta-or-set, quantity, required
   reason; submits via `useApi()`; TanStack mutation invalidating product
   queries. An adjustments history view (per-product, in the modal or product
   detail): when, who, delta, old→new, reason. Loading/error/empty states.
5. **Diagnostics tie-in (small):** in the negative-stock report, a per-row
   "Adjust" shortcut opening the same modal prefilled. If wiring it in is
   invasive, skip and note it — not blocking.
6. **Tests:** core jest for repository + service-writes-audit-row (WRITE, do
   not run — state the run command for Fable; ABI is reserved for W5). Vitest
   for the modal (validation: reason required, delta math). E2E spec
   `lira-077-stock-adjustments.spec.ts` (write only): adjust a product → stock
   delta + audit row rendered; assert per rule 15 (identity + deltas).
7. `yarn typecheck` + `yarn workspace @liratek/frontend test` must pass.

**Concurrent-edit hotspots:** `preload.ts`, `electron.d.ts`, `backendApi.ts`,
`ApiAdapter` types — W1 may add a transactions read binding; keep additions
purely additive.

---

## W5 — carrier-legs void asymmetry (filed 2026-07-21 as **LIRA-094**; "LIRA-070" here was a mislabel — the registry's LIRA-070 is the Profits audit) (backend agent)

**Read first:** `docs/plans/todo_plans/CARRIER_LEGS_VOID_ASYMMETRY.md` (the
problem statement + acceptance), `docs/FEATURE_GUIDE.md` §13 (rule 18), rules
16/17/20 in CLAUDE.md.

**The bug (validated 2026-07-19, still open):** multi-unit split checkouts
(KatchForm bills since lira-095; FinancialForm catalog units) book ALL customer
legs on the FIRST unit (the **carrier**); siblings submit `deferPayment: true`
(cost+commission only). The generic void (`TransactionRepository._reversePayments`)
is per-transaction, so voiding the carrier alone reverses the whole cart's
money but only its own cost/profit; voiding a sibling alone reverses cost but
returns none of the customer's money. Create + reverse does NOT net to 0 unless
every unit is voided, and nothing enforces that. No `group_id`/guard exists.

**Design decision (per the doc's recommendation trajectory — B now with the
cheapest possible linkage; flag for owner sign-off in your report):**

**B+ = metadata group linkage + void guard + whole-group void. No migration.**

1. **Stamp the group at create time.** The forms already orchestrate the
   per-unit calls, so they generate one `splitGroupId` (uuid) per multi-unit
   checkout and send with EVERY unit: `split_group` (uuid), `split_role`
   (`carrier` | `sibling`), `split_units` (N). Single-unit checkouts send
   nothing (no metadata noise). Persist into the unified row's `metadata_json`
   next to the existing provider/service_type stamping
   (`FinancialServiceRepository.ts:876-888`; same for the recharge path if
   KatchForm bills go through `RechargeRepository`). Extend the core Zod
   validators (`packages/core/src/validators/financial.ts` etc.) with the
   optional fields — shared by IPC + REST automatically (rule 14/19). Update
   `preload.ts` param types (rule 12) and `electron.d.ts`.
   Frontend: `KatchForm.tsx` + `FinancialForm.tsx` payload construction ONLY
   (W1 concurrently edits their success handlers — do not touch those regions).
2. **Guard the generic void/refund path** (`TransactionRepository`): when the
   target row's metadata carries `split_group`, block the single void with a
   clear error naming the group size — e.g. "This transaction is part of a
   {N}-unit checkout; void the whole checkout instead." Applies to carrier AND
   sibling (a lone sibling void leaves the customer charged for a cancelled
   unit — the asymmetry's case 2). Find members via a parameterized
   `metadata_json LIKE '%"split_group":"<id>"%'` query (safe: bound parameter,
   uuid). Legacy pre-fix rows have no marker — the guard cannot cover them;
   document this limitation in the plan doc.
3. **Whole-group void:** `voidCheckoutGroup(groupId, …)` on the repository —
   ONE db transaction voiding every non-voided member **siblings first, carrier
   last**, reusing the existing per-transaction reversal internals so payment
   legs/drawers, `debt_ledger` (rule 20 owners), and profit stamps all reverse
   through the code that already knows how. New IPC handler
   (`transactions:voidCheckoutGroup`) + REST mirror + adapter fn per rule 19,
   same roles as the existing void handler.
4. **Void UI:** wherever single void is triggered (TransactionsViewer void
   dialog — locate it), detect `split_group` in the row metadata and offer
   "Void entire checkout (N units)" driving the new endpoint; the single-void
   error from (2) is the fallback for any other path.
5. **Tests (you own the core-jest ABI dance — restore Electron ABI after:**
   `npm rebuild better-sqlite3` → jest → `npm run rebuild:native`):
   - **Failing-first core jest:** build a 2-unit split at repo level (carrier
     with legs + group metadata; sibling `deferPayment` + group metadata).
     Assert (i) today: single void of carrier → drawers/debt/profit net ≠ 0
     across the pair (this test FAILS once the guard lands — flip it to expect
     the block); (ii) after fix: single void of carrier → error; single void of
     sibling → error; `voidCheckoutGroup` → SUM across `payments`/drawers,
     `debt_ledger`, and profit stamps = 0 **per currency** (rule 20 acceptance).
     Cover a cross-currency tender case and a CUSTOMER_ACCOUNT (debt) leg case.
   - Both KatchForm-bills and FinancialForm-catalog shapes covered (per the
     asymmetry doc's acceptance).
   - **E2E spec (write only)** `lira-113-split-void-group.spec.ts` (check the
     lira- numbering tail first; take the next free number): UI 2-unit
     checkout → void one unit → blocked; group void → snapshot-delta of drawer
     - debt + profit = 0 (rule 15 discipline). State the failing-first
       procedure for Fable.
6. On completion, move/update `CARRIER_LEGS_VOID_ASYMMETRY.md`: status →
   implemented-as-B+ (metadata linkage), remaining follow-up = design A
   (real `group_id` column) when a migration window opens + legacy-row
   limitation.

**Hard boundaries:** do not run e2e; do not rebuild/sync core dist; leave
`PAYMENT_LEGS_INTEGRITY_PLAN.md` work alone (separate effort, owner answers
pending); keep `TransactionRepository` edits scoped to the void path + the new
group method (W1 may add a small read method elsewhere in the file).

---

## W6 — Telecom validity & credits (✅ DONE 2026-07-19 — migration v135; verified: core 989/989, targeted e2e 27/27 incl. lira-125; live-DB migration boot confirmed)

**Owner ask (2026-07-19):** "we should be able to set validity and credits for
each alfa and mtc numbers in the setup pages … we can just see our validity
days and credits, update them in the mtc/alfa tabs in mobile recharge."
Owner confirmed scope = **both** parts below; informational only — **no drawer
legs, no checkout/closing involvement**. Do not start while W1/W5 are editing
the recharge feature.

### W6.a — Shop SIM-line tracking

- Migration (next free version after W4's v132 — re-verify the tail): new table
  `carrier_lines` — `id`, `carrier TEXT CHECK(carrier IN ('alfa','mtc'))`,
  `phone_number TEXT NOT NULL`, `label TEXT`, `credits REAL DEFAULT 0`,
  `validity_expires_at TEXT` (date), `notes TEXT`, `is_active` flag,
  timestamps, index on `carrier`. + `create_db.sql` mirror.
  - Store the **expiry date**, render **days remaining** (a stored day-count
    goes stale daily). UI accepts either "days from today" or a date and
    persists the date. Flag to owner in the report; trivial to flip.
- Core: `CarrierLineRepository` + service (CRUD + `updateBalance`); full dual
  transport (rule 19) for list/create/update/archive.
- Settings ("setup pages"): a manager section (pattern: existing Settings
  managers) — add/edit/archive lines per carrier.
- Mobile Recharge MTC/Alfa tabs: compact panel showing each active line's
  credits + days remaining, with inline quick-update (credits and/or new
  expiry). Manual updates only — transfers do NOT auto-decrement (out of
  scope; candidate follow-up).

### W6.b — Structured validity/credits on catalog items

- Same migration: `mobile_service_items` gains nullable `validity_days INTEGER`
  and `credits REAL` (plain nullable ALTERs — no CURRENT_TIMESTAMP defaults;
  test the migration against a prod DB copy per the v104 lesson).
- **Fold in W2's pending iPick rename** (ready-to-paste RENAMES block in the
  W2 report, mirroring v117 scoped `provider='iPick'`): same migration
  ALSO backfills `validity_days` from the OLD verbose labels before renaming
  them ("10 days 3.79$" → validity_days=10, label "3.79"), and stamps
  validity/credits for the Katsh/WHISH_APP tiers where the v117 mapping makes
  it known. The structured fields preserve what the stripped labels encoded.
- Settings → MobileServicesManager: editable validity-days + credits fields on
  the item edit UI (both transports via the existing item update path).
- Recharge MTC/Alfa item cards: show validity/credits when present. NOT shown
  at checkout, NOT on receipts.
- Note: this cleanly resolves W2 owner-question 2 (Validity bundles keep
  duration labels but gain a structured `validity_days`); W2 question 1
  (`mtc.Credits` rename) stays with the owner.
- Tests: migration backfill jest (label→validity_days matrix, failing-first),
  manager-UI vitest, e2e spec extension for the tabs panel (write; Fable runs).

---

## Verification phase (Fable, after all four land)

1. `cd packages/core && npm run build` + sync `node_modules/@liratek/core/dist`.
2. `yarn typecheck`, `yarn lint`.
3. Core jest (ABI dance) for W4+W5 suites; backend + frontend unit suites.
4. Failing-first e2e proofs where specs are new (revert fix → spec fails →
   restore), then full `yarn dev` → stop → `env -u ELECTRON_RUN_AS_NODE yarn test:e2e`.
5. Adversarial review of W5's ledger math (rule 20: create + reverse nets to 0
   per currency, every ledger).
6. Sprint-doc sync: LIRA-060/066 → DONE, BINANCE follow-up + session client_id
   follow-up → closed (resolved at checkout), Whish SEND/RECEIVE + T-61 → DONE,
   LIRA-069/072/077 re-scoped or closed per outcomes, LIRA-094 (ex-"LIRA-070" mislabel) updated with B+.
