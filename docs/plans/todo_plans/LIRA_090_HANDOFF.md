# LIRA-090 — Implementation Handoff (2026-07-31)

Progress snapshot after two agent workflows. The second workflow was cut short by the org's
**monthly spend limit** (resets 2026-08-01), which killed 9 of 10 agents. This file is the source
of truth for what remains. The authoritative design is `TELECOM_DAYS_VALIDITY_PLAN.md`.

Branch: `feat/lira-090-telecom-days` (git worktree). Nothing is committed — all work is in the
working tree. In this worktree `node_modules/@liratek/core` is a **symlink** to `packages/core`,
so `cd packages/core && npm run build` is sufficient (no xcopy step).

---

## DONE and verified green (do not redo)

Core layer — build clean (`tsc` exit 0), and **12 telecom suites / 168 tests pass**:

- **v140 migration** (`packages/core/src/db/migrations/index.ts` + `electron-app/create_db.sql`):
  `mobile_service_items.{days_cost_lbp, sell_days_lbp, sell_credit_lbp}` (nullable, defaultless
  ALTER), `carrier_lines.is_primary` + partial unique index, new `carrier_line_movements` table,
  `telecom_credit_sell_price_lbp` setting. `check-schema-equivalence.mjs` → zero diffs.
- A **v141**-style follow-up landed too: `carrier_line_movements` stores the pre-mutation
  `validity_expires_at` so reversals restore the exact prior date (review finding M2). Confirm its
  version number is correct and mirrored in `create_db.sql` during final gates.
- **`packages/core/src/utils/telecomCredit.ts`** — the calc core (integer-cents;
  `maxReturnableCredits(77) === 73` exact). Review fix M1 (sub-cent flooring) applied.
- **Catalog data layer** — `MobileServiceItemRepository` + `MobileServiceItemService` (split
  columns, gate via shared `isTelecomSplitComplete`), `validators/mobileServiceItem.ts` (create +
  update schemas).
- **Carrier lines + rule-20 reversal** — `CarrierLineRepository`/`Service`,
  `CarrierLineMovementRepository`, movement-logged mutations, void hook in `TransactionRepository`.
  Review fixes H2 (archived line can't stay primary) and H3 (raw primitives no longer bypass the
  movement log) applied.
- **Money path** — `FinancialServiceRepository`: iPick gate fixed (bug §6.1), computed
  returned-credit default, carrier-line movement, and `selfChargeTelecomItem`.
- **Self-charge txn shape (M3)** — new `TRANSACTION_TYPES.TELECOM_SELF_CHARGE`, absent from
  `PROFIT_TXN_TYPES` (no profit) and from `NON_REVERSIBLE_TRANSACTION_TYPES` (stays voidable via the
  generic path). Void/refund of a real self-charge nets every ledger to 0; double-void is a no-op.

---

## NOT DONE — the remaining work

### 🔴 BLOCKER B1 — gross-cost double-count (money-critical, `KatchForm.tsx`)
`calcCost` sends a cost that already has the returned credit netted out
(`cost − returnedCredits × 85,000`), and the repository ALSO credits the MTC/Alfa drawer. For the
77$ cart the iPick/Katsh LBP drawer is debited 1,055,000 instead of 7,600,000. **Fix:** frontend
sends GROSS `cost` (full `cost_lbp`) + `mobileServiceItemId` + per-line returned credits; the
customer price (S2 `reconcileLegs` total) is unchanged; the repository already nets to
`days_cost_lbp`. Confirm the repo side, then fix the UI. This pre-existed on Katsh; do NOT ship the
iPick gate widening without this.

### 🔴 BLOCKER B2 — Zod strips the new fields (`electron-app/schemas/index.ts:~374`)
`FinancialServiceSchema` declares neither `mobileServiceItemId` nor `telecomCreditReturns`; Zod
strips unknown keys, so the computed feature is dead code over IPC. Add them to match the repo's
payload shape.

### Also outstanding
- **B2b (rule 14):** a third copy of the returnable formula lives at `KatchForm.tsx:43-45`
  (`Math.floor(denom/0.5)*0.5` → 77, not 73). Delete it; import from `utils/telecomCredit.ts`.
  Same for the checkbox gate — import `isTelecomSplitComplete`.
- **Walk-in path (spec §6.2):** standalone submit aggregates the cart into one transaction; send a
  per-line returned-credits array alongside the aggregate (do not split into N transactions).
- **Rate-key consolidation:** `Recharge/index.tsx:235` reads `alfa_credit_cost_rate_lbp` which
  nothing writes (`ShopConfig.tsx:213` writes `alfa_credit_cost_lbp`) → pinned to hardcoded 85,000.
- **Electron transport:** IPC handlers for split create/update, carrier-line primary get/set,
  self-charge; `requireRole` + `validatePayload`; `mobileServiceItemHandlers` `create` has no
  validation today; preload types (rule 12); register in `main.ts`. **Rebuild `electron-app/dist`
  before any desktop e2e.**
- **Backend REST (rule 19):** mirror every write path; template `backend/src/api/carrierLines.ts`,
  **never** `recharge.ts` (no `requireRole`). Add the missing `POST` to `mobileServiceItems.ts`.
- **Adapter layer:** `backendApi.ts` (`ipcOrHttp`), `ElectronApiAdapter.ts`,
  `packages/ui/src/api/types.ts`, `frontend/src/types/electron.d.ts`. Reads return raw shape,
  writes return the envelope. Verify URL paths match mounted routes (the `topUpApp` → nonexistent
  `/api/recharge/top-up-app` precedent).
- **Settings UI:** `MobileServicesManager.tsx` split editor + the §2.4 decision table
  (102,302 / 95,247 / 92,895; profits −2,302 / +4,753 / +7,105 — show the negative). Migrate the
  raw `window.api...create` at `KatchForm.tsx:665` and `FinancialForm.tsx:300` to `useApi()`.
  Do NOT touch `frontend/src/data/mobileServices.ts` (strict `toEqual` test).
- **Tests (rule 15/17):** replace the tautological invariant test
  (`FinancialServiceRepository.telecomOnlyDays.test.ts:571-606`) with real snapshot-then-delta
  drawer assertions for iPick AND Katsh; end-to-end void integration tests; frontend jest for the
  KatchForm gross-cost payload (prove it fails on the netted code first). New e2e spec id: **lira-132**
  (not `lira-090-*`).
- **Final gates:** `yarn typecheck`, `yarn lint`, core/backend/frontend jest,
  `yarn check:tenant-scoping`, `check-schema-equivalence.mjs`. Known unrelated flake to ignore:
  `PostRefactorVerification.test.ts` "hasOpeningBalanceToday() returns true after first checkpoint"
  (midnight-rollover).

---

## Resume note

Do **not** blindly re-run workflow `wf_216fd0e7-098` with `resumeFromRunId`: the `core-fixes` agent
applied its edits to disk but returned no cached result, so a resume would re-run it and double-apply
M1/H2/H3/M2. Author a fresh workflow that treats everything under "DONE" above as complete and starts
at the transport/UI/tests phases.
