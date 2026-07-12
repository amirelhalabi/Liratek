# Today's Work

## Agent 1 changes

**1. Fixed the checkpoint time display bug (original report)**
- Root cause: SQLite stores timestamps as marker-less UTC; the Checkpoint Timeline parsed them with raw `new Date()` → shifted by the UTC offset (3:40 → 12:40).
- Fix: routed it through the existing `parseDbDate` helper.
- Client's Dashboard bug is a **pre-v1.27.3 build** — they need updating.

**2. Swept the same display bug app-wide (Class A)**
- ~50 sites across 27 files (debts, profits, sales, sessions, recharge, etc.) → `parseDbDate`, applied via 4 parallel agents, verified with typecheck/lint/tests.

**3. Fixed the "business day" boundary (Class C — Beirut-local)**
- "Today"/month/date-range logic ran on **UTC**, so the day rolled at 3 AM Beirut. Aligned outliers (`ClosingRepository`, `ProfitRepository`, `FinancialRepository.getMonthlyPL`, `LotoService`, `VoucherRepository`, `backend/profits.ts`, Dashboard, frontend defaults) to the existing `DATE(col,'localtime')` convention.
- Added shared `localDay`/`localMonth` helpers; fixed `DateRangeFilter`.

**4. Tests**
- Unit rule-17 proofs (`ClosingRepository.localBusinessDay`, `ProfitRepository.localBusinessDay`) — shown to fail on the pre-fix code. Pinned core jest to `TZ=Asia/Beirut` via cross-env.
- 3 E2E specs (all green): `lira-100` (display), `lira-102` (local month P&L), `lira-103` (local "today" stats).
- Green: core 593, backend 444 (2 pre-existing failures only), frontend 321, typecheck + lint clean.

**5. Docs/memory**
- Plan: `docs/plans/LOCAL_BUSINESS_DAY_PLAN.md`; updated e2e README; recorded the `parseDbDate` convention + e2e webServer-race lesson in memory.

**Follow-ups (not code):**
- Update the client to >= v1.27.3.
- Pin `TZ=Asia/Beirut` on the **web backend** deploy — otherwise web-mode reporting follows the server's timezone.

## Agent 2 changes

**1. Sale summary + debt note enrichment**
- `SalesRepository` now bakes item names into the transaction summary, `metadata_json`, and debt-ledger note (was just `"Sale #3: $15"` / `"Balance from Sale"`).

**2. Debts page ID bug fix**
- `loadHistory` was passing a `transactions.id` into a function expecting a `sales.id` — fixed; retroactively restores item-name display on old debt rows too.

**3. POS checkout bugs (CheckoutModal)**
- Diagnosed: currency switch not converting the payment amount, discount not decrementing the auto-filled amount, no way to waive a sub-$1 remaining balance.
- Migrated `CheckoutModal` (shared by POS *and* Maintenance) off its bespoke payment UI onto the shared `MultiPaymentInput` component — fixes all three bugs at once and adds a new "Waive" button.
- Extended `MultiPaymentInput` with 4 new opt-in props (`onWaiveRemaining`, `smartSplitOverpay`, `cashOnlyReturn`, threshold) — other 7 consumers unaffected.

**4. Tests**
- RTL unit tests, a new backend test, a new frontend test, and 5 new E2E specs (incl. a Maintenance-path smoke test) — all proven to fail against pre-fix code before being confirmed green.
- Full `yarn dev` → stop → `test:e2e` cycle: 9/9 passing with everything combined.

**Follow-ups (not code):**
- Nothing committed yet.

## Agent 3 changes

**1. Fixed the Whish App RECEIVE fee bug (original report)**
- Root cause: the shop was crediting only 10% of the customer fee as profit instead of the full fee, and the wallet-inflow vs. customer-payout amounts were conflated — the customer got shorted ($99.90 paid out instead of $99/$100 depending on the "fee included" toggle).
- Extracted the fee/amount math into a pure, testable helper (`omtWhishAppFees.ts`); fixed a bug where the manual fee field couldn't be explicitly set to zero; persisted `whish_fee` on the transaction row (was stored `NULL`).

**2. Extended the same fix to OMT App RECEIVE**
- OMT App's manual fee previously had ZERO effect on wallet inflow, payout, or profit — a pre-existing, already-decided-but-unimplemented gap (`LEFT_TO_DO.md` 2026-07-04: "the fee is fully the shop's, OMT App + Whish App").
- Generalized `isWhishAppReceive` → `isAppWalletReceive` so both providers share one contract; the repository needed zero changes (the shared app-wallet branch was already generic).

**3. Tests**
- Pure-function unit tests (10 cases), repository-level tests, and a new UI-driven E2E spec (`lira-101-app-wallet-receive-fee-ui.spec.ts`, 6 cases across both providers, real form + `/audit` row assertions) — all proven to fail against the pre-fix code (rule 17) before being confirmed green.
- Diagnosed and fixed a `better-sqlite3` ABI mismatch blocking E2E runs in this environment (bare `require()` succeeding doesn't prove the native ABI matches).
- Green: core 594, backend 445 (2 pre-existing failures only, confirmed unrelated), frontend 325, typecheck + lint clean, all 6 E2E passing.

**4. Docs/memory**
- Plan: `docs/plans/WHISH_APP_RECEIVE_FEE_FIX_PLAN.md`; updated the E2E README index; recorded the ABI-diagnostic trap and the OMT App fix in memory.

**Follow-ups (not code):**
- The original 15:00 Whish App transaction (the reported bug) needs to be voided and re-entered by the shop owner (as "fee included") — not auto-migrated.
- Whish App SEND manual-fee handling and the RECEIVE `cashoutMethod` plumbing gap (payout always hits Cash regardless of the selected method) remain open follow-ups.
- No "fee included" UI toggle exists for OMT App (deliberately out of scope — add only if asked).

## Agent 4 changes

**Focus: web-parity — making LiraTek work in the browser over REST, not just Electron over IPC.**

**1. Phase 2 — REST parity per module (completed)**
- Built the browser/REST transport for **partners**, **voucher codes**, and **closing/checkpoint** (incl. the `createCheckpoint` money write) — each feeding the same `@liratek/core` service the IPC path uses; proofs `lira-web-008/009/010`.
- Built **`POST /api/debts/credit`** (the one genuinely-missing route) feeding the existing `DebtService.addCredit`; dedicated proof `lira-web-011`.
- Fixed 2 real bugs surfaced by money-delta proofs: closing routes' `requireAuth`-before-`requireRole` ordering, and a latent 404 (adapter called routes that didn't exist yet).

**2. Phase 3 — `window.api`→REST shim (started, proven loop)**
- Built the browser-side `window.api` shim (`helpers/webApiShim.ts`) so the IPC-driven desktop specs run over HTTP unchanged. Key: a `__LIRATEK_WEB_API_SHIM` flag keeps `isElectron()` false so installing the shim doesn't flip app boot into Electron-only paths.
- Landed **7 desktop specs over the shim** in the default web suite: app.spec (canary), transactions-timezone, session-multiple-per-day, **lira-081** (maintenance→debt money), **lira-084** (supplier ledger), **lira-096** (split repayment), **lira-097** (creditor cash-out).
- Fixed a cross-spec phone collision (lira-web-002 vs lira-099); diagnosed lira-099 as full-suite order-flaky (kept green standalone, pulled from the default allowlist).
- Investigated a suspected web-mode money gap and **disproved it** — REST session checkout books the on-account debtor correctly (verified with a REST-only repro).

**3. Docs/rules**
- Added **CLAUDE.md Rule 19 + a "Dual-Transport Architecture" section**: every feature must work on both desktop (IPC) and web (REST) off one codebase; the pattern + the gotchas (isElectron===!!window.api, requireRole-needs-requireAuth, better-sqlite3 ABI, envelope parity, field translation).
- Kept `docs/plans/WEB_PARITY_ROADMAP.md` current with per-spec status + learnings (most namespaces already have REST → shim-mapping not building; full-suite flakiness + env-reset discipline).

**4. Tests**
- 11 dedicated web specs (`lira-web-001…011`) + 7 desktop specs over the shim; **web suite 41/41 green**. Each new route verified against pre-route state (404 → spec can't pass without it — rule 17).

**Follow-ups (not code):**
- Phase 3 has ~43 desktop specs left (mostly cheap shim-mappings; a few genuinely-missing routes: `omt.*`, `profits.summary`, `mobileServiceItems`, `recharge.getDrawerBalances` shape, `suppliers.recordCashflow`, `transactions.void/refund`).
- Phase 4 (run the full ~148-spec suite against both transports in CI) not started.
- lira-099 needs an isolation/ordering fix to re-enter the default suite.
- Committed only my own files throughout (parallel agents' work untouched).
