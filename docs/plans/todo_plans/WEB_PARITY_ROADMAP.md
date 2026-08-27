# Web-Parity Roadmap — living status & reference

**Purpose:** the single tracker for making every LiraTek module work in the **browser** (over REST), not just Electron (over IPC). This is the _execution_ companion to the exploratory `WEBAPP_MULTI_TENANT_PLAN.md`. Update the status columns here as modules land.

**Last updated:** 2026-08-26 · **Branch of record:** `feat/multi-tenant-shared-db` (== `main` tip `ce45a2e`, v1.29.4 — the web-parity work and the multi-tenant work are now unified on this branch).

---

## 1. The model (why this works at all)

One React frontend, two transports, chosen automatically by environment:

```
page → useApi() adapter → backendApi.fn() → ipcOrHttp()
   → isElectron() (== !!window.api)?  IPC: window.api.*  (desktop)
                                      HTTP: /api/* REST   (browser)
both land on the SAME @liratek/core service/repository
```

A module "works in the browser" when: (a) a REST route exists mirroring its IPC handler, (b) the frontend calls it through `useApi()`/the adapter (not `window.api.*` directly), and (c) both transports feed the same core logic. **Tenant scoping is automatic** as long as a REST route uses `authenticateJWT` (which wraps the request in `runWithTenant`) and repos extend `BaseRepository`; desktop uses the fixed tenant context from `initFixedTenantContext(1)` at boot.

---

## 2. Four-phase roadmap — status

| Phase                               | Goal                                               | Status                                                                                                                                                   |
| ----------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Fix broken pages**             | Every page renders (not crash) in a browser        | ✅ Done (`c7bf8b4`)                                                                                                                                      |
| **2. REST parity per money module** | Each module reachable + wired over REST            | ✅ Done — all modules reachable over REST (§3); debts addCredit reclassified as no-web-work                                                              |
| **3. `window.api`→REST shim**       | Let the ~50 IPC-driven desktop specs run over HTTP | 🟡 In progress — shim scaffold landed (`dbeffdd`, canary green); 1st desktop spec green over web (`f5a8cbc`); ~48 specs remain (grow shim per-spec, §10) |
| **4. Unify the suites**             | Run all ~148 specs against BOTH transports         | 🔴 Not started                                                                                                                                           |

---

## 3. Step 2 — per-module status ❌ NOT DONE

**Done** (the three hardest, each with a dedicated proof):

| Module                                              | Commit                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POS sales                                           | `fd3d29c`             | shared `saleProcessSchema` in core; `POST /api/sales/process`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Loto                                                | `4cfa514`             | 7 schemas → core; `backend/src/api/loto.ts` (~28 routes)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Sessions (browse+cart+checkout)                     | `1dcef64` + `a13d768` | checkout orchestration extracted to core `SessionCheckoutService`; see `SESSIONS_WEB_PARITY_PLAN.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Hold money                                          | `0eb9a52`             | `holdMoneyCreateSchema` → core; `backend/src/api/holdMoney.ts` (list/active/create/collect); proof `lira-web-003`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Service presets                                     | `6472d91`             | config CRUD (no money); schemas already in core; `backend/src/api/servicePresets.ts`; proof `lira-web-004`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Audit log (read)                                    | `40e4c5d`             | read-only; `backend/src/api/audit.ts` (search/recent/by-entity); core AuditService already present; proof `lira-web-005`. NOTE: distinct from `/api/activity`; the viewer uses the `audit` trail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Drawer top-ups                                      | `104e9e1`             | `backend/src/api/drawerTopUp.ts` (source-drawers/history/create/from-drawer); no schema/core change; proof `lira-web-006`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Debts cash-out + account-entry                      | `919cb7e`             | lifted debtCashOut/debtAccountEntry schemas; `/api/debts/{clients/:id/balance,cash-out,account-entry}`; Debts page fully dual-mode; proof `lira-web-007`. (getDebtors/history/repayment/summary were already dual-mode) **Update (CQ-9, 2026-07-18):** `debt:use-credit`/`debts:update-metadata` had no REST route at all — closed by `POST /api/debts/use-credit` + `PUT /api/debts/update-metadata` (part of the same 11-route CQ-9 pass, see the Suppliers row below); repayment role parity fixed too (was admin+staff on IPC, admin-only on REST — now admin+staff on both).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Suppliers (full REST parity + role alignment)       | CQ-9 (2026-07-18)     | `docs/plans/todo_plans/COUNTERPARTY_CONSOLIDATION_PLAN.md` CQ-9 — supersedes this doc's 2026-07-11 "all modules reachable over REST" claim for Suppliers: CQ-9's audit found 9 of 14 supplier channels had no REST route at all, and `recordSupplierCashflow`'s REST fallback targeted a 404 (`settleTransactions`) or didn't exist (`recordSupplierCashflow` — undefined in the browser). 11 routes added total (9 supplier + the 2 debt routes above); existing supplier routes gained real Zod schema validation (`validators/supplier.ts`, previously hand-validated); roles aligned to IPC across the board; Suppliers page migrated off raw `window.api.suppliers.*` onto 9 dual-mode `backendApi.ts` fns; proof `lira-web-015` (cashflow + the CQ-8 counterparty-contract shape asserted over REST, full web suite 45/45 at landing). Bonus fixes discovered en route: REST repayment (`/api/debts/*`) was silently stripping the leg `direction` field; NULL-provider suppliers were invisible to `listSuppliers`/`getSupplierBalances` (a SQL `NULL` comparison trap, not a REST-specific bug but caught during this pass).                                                                                                                                                                                                 |
| Closing / checkpoint (createCheckpoint money write) | `57cfd6e`             | new `createCheckpointSchema` → core; `backend/src/api/closing.ts` +4 routes (POST /checkpoint admin money-write, POST /recalculate-drawer-balances [adapter already called it — route was 404], GET /checkpoint-timeline [fixed filter shape], GET /initial-checkpoint-date); adapter gained createCheckpoint/getCheckpointTimeline/getInitialCheckpointDate; migrated Checkpoint page + CheckpointTimeline + InitialDrawerAmountsModal; proof `lira-web-010` (drawer-balance +10 delta, rule 15). **Gotcha:** closing.ts has no router-level `authenticateJWT` — admin routes need explicit `requireAuth` BEFORE `requireRole`. Same desktop-ABI caveat.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Voucher codes (gift cards)                          | `ce10670`             | lifted `VoucherCreateSchema` → core (rule 14, cast re-export in electron); `backend/src/api/vouchers.ts` (create/get-all/validate/cancel; cancel admin-only); `vouchers` adapter namespace + `createClient` exposed on the adapter; Vouchers page migrated off `window.api.vouchers.*`/`window.api.clients.*`; proof `lira-web-009`. Money path (redeemByCode) stays internal to parent sale/session txns — not exposed. Same desktop-ABI caveat as partners.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Partners (config + partner_ledger)                  | `6338f6f`             | new `partner.ts` validators (no `userId` — injected from JWT; `transactionType` = full repo union); `backend/src/api/partners.ts` (all 11 channels); `partners` adapter namespace (reads raw, writes enveloped); migrated Partners page + **shared** PartnerSelector + Services + Checkpoint; proof `lira-web-008` (create → DEBIT ledger → settle → **page-level** getAllBalances round-trip through the adapter). ⚠️ Desktop harness NOT re-run to green — shared better-sqlite3 was at Node ABI (parallel-agent contention), so all desktop specs incl. partners-unrelated `app.spec` failed at Electron window-launch (environmental, not a regression).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Carrier lines — record usage (LIRA-145)             | LIRA-145 (2026-08-26) | Shared `recordCarrierLineUsageSchema` lives in `packages/core/src/validators/carrierLine.ts`, re-exported by `electron-app/schemas/index.ts` and imported directly by backend; IPC `carrier-lines:record-usage` (admin+staff) and REST `POST /api/carrier-lines/record-usage` (`authenticateJWT` + `requireRole(["admin","staff"])`) both call the SAME `CarrierLineService.recordUsage` → `CarrierLineRepository.recordUsage`; the route returns HTTP 200 even on a business rejection (`{success:false,error}`) — unlike the older 400-on-failure siblings in the same file; frontend goes through the dual-mode adapter (`recordCarrierLineUsage` in `frontend/src/api/backendApi.ts`, exposed on `ElectronApiAdapter`, typed in `packages/ui/src/api/types.ts`); the UI is the dialog in `frontend/src/features/recharge/components/CarrierLinesPanel.tsx`; proof `frontend/tests/e2e-web/lira-web-025-carrier-line-usage-expense.spec.ts` — drives the REAL Recharge panel in a REAL browser (HTTP branch), asserting money deltas over REST plus envelope parity (HTTP 200 on rejection) and role parity (staff may record usage). Caveat: the desktop spec `frontend/tests/e2e-electron/lira-145-carrier-line-usage-expense.spec.ts` is NOT yet runnable over the phase-3 web shim (not in `SHARED_DESKTOP_SPECS`) — see §7b. |

**Pending:** _none_ — **step-2 is complete.** Every money/config module the feature
pages call is now reachable over REST. Next: **phase 3** (the `window.api`→REST shim to
run the ~50 IPC-driven desktop specs over HTTP), then phase 4 (both transports).

**Reclassified — no web work needed:**

- **debts `addCredit`** (verified 2026-07-11, then revised): the manual "Add Credit" UI uses
  `api.addAccountEntry({direction:"credit"})` (dual-mode, `lira-web-007`), and no PAGE calls
  `debt.addCredit`. It was reclassified no-web-work on that basis — but the desktop **spec**
  `lira-097` calls `window.api.debt.addCredit` directly, so phase 3 DID build `POST /api/debts/credit`
  (`0cf0254`) feeding the existing `DebtService.addCredit` + `addCreditSchema`. Lesson: "no page
  calls it" ≠ "no web consumer" — a shimmed desktop spec is a consumer too.

> **Desktop e2e verification note (2026-07-11):** the shared checkout's `better-sqlite3`
> ABI is contended by a parallel agent that needs Node ABI (127) for backend/core jest;
> desktop e2e needs Electron ABI (125). While that contention is live, desktop specs may
> fail wholesale at `fixtures.ts:203` (`waitForEvent "window"` timeout) — this is the DB
> failing to load in the Electron main process, NOT a code regression. Confirm by probing
> the binary: `node -e "require('better-sqlite3')"` LOADS under Node → wrong ABI for desktop.
> Frontend-only `window.api.X` → `useApi().X` migrations route to the identical `window.api`
> call in Electron, so they are transparent by construction on desktop; the meaningful
> new risk (adapter unwrap-key bugs) is caught by a page-level web round-trip instead.

---

## 4. The proven recipe (per module)

Followed for sales/loto/sessions; reuse verbatim. **This is money-path work — load the `new-money-feature` skill and read `docs/FEATURE_GUIDE.md` first (rule 18).**

1. **Map** the surface: the module's IPC handler channels + Zod schemas (`electron-app/`), the frontend adapter/page usage, and the core service/repo methods it calls.
2. **Lift the write-path Zod schema(s)** from `electron-app/schemas/index.ts` into `packages/core/src/validators/<module>.ts`; re-export from `electron-app/schemas` with the zod-major cast (see §6). Export from `packages/core/src/validators/index.ts`.
3. **Add the REST route** `backend/src/api/<module>.ts` — IPC-identical envelopes (`{ success, <key> }`, HTTP 200 even on failure), `authenticateJWT` + `requireRole(...)` matching the handler, static paths before `/:id`. Mount in `backend/src/server.ts`. Calls the SAME core service.
4. **Adapter:** add dual-mode `ipcOrHttp` functions to `frontend/src/api/backendApi.ts`; expose them on `ElectronApiAdapter.ts` (nested namespace if the page expects one); add to the `ApiAdapter` type in `packages/ui/src/api/types.ts`.
5. **Migrate the page(s)** from `window.api.<module>.*` to `useApi().<module>.*`; drop any web-mode `if (!window.api...) return` guards.
6. **If the handler holds business orchestration** (not just a thin service call — the sessions-checkout case), extract it into a core service first (rule 13: DB access stays in repos), then point both transports at it.
7. **Prove** (§7).
8. **Build/sync** (§6), typecheck + lint, commit. If it touches the money path in a non-trivial way, commit it in isolation so it reverts cleanly.

---

## 5. Cross-cutting build/sync (after ANY core change)

1. `cd packages/core && npm run build`
2. Sync the real copy: `rm -rf node_modules/@liratek/core/dist && cp -R packages/core/dist node_modules/@liratek/core/dist` (Windows: the `xcopy` in CLAUDE.md).
3. If `electron-app/` source changed: `cd electron-app && npm run build` (harness/app loads compiled `dist`, not source).
4. `@liratek/ui` is source-consumed (vite/tsconfig alias) — no build.

---

## 6. Gotchas that cost real time (don't rediscover)

- **better-sqlite3 ABI is NOT portable.** `NODE_MODULE_VERSION 127` (Node, from `rebuild:node`) vs `125` (Electron). `yarn test:e2e:web` runs `rebuild:node` and silently flips it — the next desktop run then fails EVERY spec with `waitForEvent "window"` timeout (looks like a code bug; it's the DB failing to load). **`yarn rebuild:native` before desktop e2e / `yarn dev`; `rebuild:node` before web e2e / core jest.** `yarn dev:web` (commit `8204808`) is the web dev command; `yarn dev` stays desktop-only.
- **zod major mismatch:** core types against **zod 4**, electron/backend against **zod 3**. Reuse the cast pattern: electron `export const X = coreSchema as unknown as z.ZodSchema<CoreInput>`; backend a local `SafeParseable<T>` structural cast (see `backend/src/api/loto.ts`, `sessions.ts`).
- **Envelope parity:** REST returns `{ success, <key> }` with HTTP **200 even on failure** (`{success:false,error}`) to match IPC — the adapter branches on `result.success`, not status code. Don't "fix" to 4xx.
- **Tenant context:** new REST routes MUST use `authenticateJWT` (→ `runWithTenant`); new repos MUST extend `BaseRepository`. `tenantContext.ts` is fail-closed — a money write with no tenant context throws.
- **Adapter path:** most feature pages call `window.api.*` directly and must be migrated to `useApi()`; a few already use `useApi()`. Check per page.

---

## 7. Proof standard (per module)

- **Live money-delta** over REST (curl or an e2e spec): assert the drawer/ledger/debt delta and that the row was journaled with correct `tenant_id` — mirror the loto-sell / session-checkout proofs.
- **Rule 15:** delta + identity assertions, never "newest row" / absolute totals (the e2e DB accumulates).
- **Rule 17:** any regression/guard test must be shown to FAIL on the pre-fix code before it counts.
- **Both transports:** web e2e (`yarn test:e2e:web`) green; desktop specs for the module green (`yarn rebuild:native` first). Keep `frontend/tests/e2e-web/lira-web-*` extended as modules land.

---

## 7b. Phase 3 — the `window.api`→REST shim (how it works + rollout loop) ❌ NOT DONE

**Scaffold** (`frontend/tests/e2e-electron/helpers/webApiShim.ts`, committed `dbeffdd`):
a browser-side `window.api` installed via `addInitScript` in the **web-shared** fixture
only (the phase-2 `lira-web-*` specs use a different fixture, unaffected). It's a
`Proxy` whose **unmapped methods reject** with `web-api-shim miss: <ns>.<method>` and
whose `on*` methods return a synchronous no-op unsubscribe (Electron event contract).
Reads unwrap the REST envelope to the raw IPC shape; writes pass `{success,…}` through.

**The load-bearing trick:** installing `window.api` would flip `isElectron()` (`!!window.api`)
true app-wide, activating Electron-only boot paths (auth restore/session-events, direct
`if (isElectron()) return window.api.X` fns like login) that a partial shim can't satisfy →
render crash / login failure. So the shim sets `window.__LIRATEK_WEB_API_SHIM = true` and
`backendApi.isElectron()` returns **false** when that flag is set. Result: **app code keeps
taking the HTTP path exactly as in shim-absent web mode**; the shim exists ONLY for the
specs' direct `page.evaluate(window.api.*)` calls (and any component still gating on raw
`window.api` truthiness — see below). Canary proof: `app.spec.ts` runs green in web WITH
the shim installed.

**Rollout loop (per spec):**

1. `E2E_WEB_SPECS=<spec>.spec.ts yarn test:e2e:web` (Node ABI — fully runnable this session, no Electron ABI fight).
2. For each `web-api-shim miss: ns.method` → add a route to the table in `webApiShim.ts`
   (REST path/verb MUST match `backend/src/api/*`; centralize IPC-arg→REST-body translation there).
   If the REST route doesn't exist yet, build it with the phase-2 recipe first.
3. If a **component the spec renders** gates on raw `window.api` (not `isElectron()`) and
   breaks, fix the component: drop the dead `if (window.api)` branch and use the dual-mode
   `useApi()` adapter (it's already `ipcOrHttp`). Did this for `ClientList`; the same
   pattern applies to the debts page reads, `AuthContext`, etc. as specs surface them.
4. Add the spec to `SHARED_DESKTOP_SPECS` in `playwright.web.config.ts` once green.

**Done (in the default web-shared allowlist, full suite 35/35 green ~48s):**
`app.spec` (canary), `lira-transactions-timezone` (`f5a8cbc`; `transactions.getRecent` — read),
`lira-session-multiple-per-day` (`ffaad3b`; `session.start`/`close`/`getActiveSessions`/
`getTodayAllSessions` — **write path proven**), `lira-081-maintenance-customer-account`
(`85f9258`; `maintenance.getJobs`/`save`/`delete` — save is a MONEY path → `debt_ledger`),
`lira-084-supplier-opening-balance` (`bd2fde5`; `suppliers.list`/`getBalances`/`addLedgerEntry`
— supplier-ledger money path), `lira-096-debt-split-repayment` (`e15e311`;
`dashboard.getDrawerBalances`/`rates.list` + maintenance/debt — split USD+LBP repayment),
`lira-097-debt-cashout` (`0cf0254`; **built `POST /api/debts/credit`** + `clients.create`/
`debt.addCredit`/cash-out — 4 sub-tests, mixed USD-credit/LBP-debt).
**Green STANDALONE but pulled from the default suite (order-flaky):**
`lira-099-session-debt-detail` (`9cb5603` landed it, `bd2fde5` pulled it) — passes via
`E2E_WEB_SPECS=lira-099-… yarn test:e2e:web`; in the full suite once 081/084 precede it, its
checkout succeeds but the debtor doesn't surface (shared-DB/shared-page cross-spec state, NOT a
shim/money bug). Its `session.getActive/cartAdd/checkout` mappings remain.
**Remaining:** ~43 specs.

**`lira-145` shim gap (2026-08-26):** the desktop spec `lira-145-carrier-line-usage-expense.spec.ts`
calls six `window.api` methods not yet in `webApiShim.ts` — `carrierLines.create`,
`carrierLines.getAllAdmin`, `carrierLines.recordUsage`, `recharge.getDrawerBalances`,
`profits.summary`, `transactions.getById` (already mapped and NOT needed:
`suppliers.getBalances`, `transactions.getRecent`). All six already have REST routes, so this
is pure shim-mapping work, no phase-2 route-building: `GET /api/carrier-lines/` (admin),
`POST /api/carrier-lines`, `POST /api/carrier-lines/record-usage`,
`GET /api/recharge/drawer-balances`, `GET /api/profits/summary`, `GET /api/transactions/:id`.
Observation: `GET /api/recharge/drawer-balances` and `GET /api/profits/summary` now EXIST —
learning 1's "truly-missing" list above (`recharge.getDrawerBalances`/`profits.summary`) is
stale for these two routes; noted here only, the old list is left as-is. The spec's void step
needs no shim entry — it clicks the Transactions table's Void button, and `voidTransaction`
(`frontend/src/api/backendApi.ts:2155`) is already dual-mode and takes the HTTP branch
(`POST /api/transactions/:id/void`) since `isElectron()` is false under the shim.

**Two learnings from this pass:**

1. **Most namespaces already have REST** (built in phases 1–2: maintenance, suppliers, recharge,
   services, profits, rates, exchange, sessions, debts, transactions, …). The blocked list was
   over-pessimistic — most specs need only a **shim mapping** to an existing route, not a new build.
   Truly-missing so far: `mobileServiceItems`, `omt` (some), `recharge.topUpFrom*`,
   `recharge.getDrawerBalances` shape, `profits.summary`, `auth.createUser`.
2. **Full-suite flakiness is real** — the web-shared specs share ONE browser page + ONE backend +
   an accumulating DB that `global-setup.ts` does NOT reset between `yarn test:e2e:web` runs. After
   many runs the env degrades (runtime 48s→1.4m, app.spec's complex UI tests flake). **Reset before
   trusting a red:** kill stale vite/backend/tsx procs, `rm frontend/test-results/e2e-web/phone_shop.web.db*`,
   re-run. A spec that flakes in the full suite but passes standalone is an isolation/env issue, not
   a product bug — verify standalone before adding to the allowlist AND run the FULL suite before
   committing the allowlist entry (isolation-green is necessary, not sufficient). Highest-surface (`lira-090/094/097`) touch namespaces with no
   REST yet (`maintenance`, `omt`, `recharge.topUpFrom*`, `suppliers.recordCashflow`,
   `profits.summary`, `auth.createUser`) — those need phase-2-style routes built first.
   (`suppliers.recordCashflow` since closed — CQ-9, 2026-07-18, see §3's Suppliers row.)

**Cross-spec test-data collision (the `lira-099` lesson, resolved `9cb5603`).** The web-shared DB is
walked by BOTH the web-only `lira-web-*` specs AND the desktop specs. lira-099 (desktop, hardcodes
phone `03777888`) failed because `lira-web-002` hardcoded the SAME phone — so `findOrCreateByPhone`
attached lira-099's on-account debt to lira-web-002's client, and lira-099's name lookup found
nothing. It was NOT a money or shim bug (REST checkout books the debtor correctly — verified by a
REST-only repro). **Rule for web-only specs:** use per-run-unique names/phones (`Date.now()` suffix)
so they can't squat an identifier a hardcoded desktop spec reuses. Desktop specs stay unchanged
(phase-3 goal); fix the collision on the web side. When a landed desktop spec's UI assertion fails
but the money/REST layer is provably fine, suspect a shared-DB identity collision before the shim.

**Writes + field translation — now proven (`ffaad3b`).** `session.start` maps with a real
arg→body translation (drops the IPC-only `started_by`; `close` drops `closedBy` — REST derives the
actor from the JWT). The discipline holds: cross-check each write body against the actual
`backend/src/api/*` route/schema, NOT the IPC arg, and centralize translation in the shim.
`seed.ts` documents more of these (`cost_price`↔`cost_price_usd`, `stock_quantity`↔`stock`,
`whatsapp_opt_in` 0/1↔boolean) — a mapped-but-malformed write fails as an ASSERTION, not a "shim miss".

**Also (self-heal is gone by design):** since `isElectron()` is false under the shim, app code never
enters `ipcOrHttp`'s ipc branch — there is NO fallback catching shim misses for raw-`window.api`
components. Migrating them to `useApi()` (rollout step 3) is the ONLY fix, not optional cleanup.

**Diagnosing a tail failure — four distinct fixes:** (a) `web-api-shim miss:` in the log → map the
method / build its REST route; (b) mapped but wrong body → field-translation bug; (c) missing
desktop-only UI (a component's `if (isElectron())` now renders its web branch, or an Electron-only
feature — `display/print/diagnostics/whatsapp/backup`) → `isElectron()`-gate the component or benign-stub
in the shim, NOT a REST mapping; (d) assertion/state mismatch → the accumulating web DB differs from the
desktop DB's seed state (rule 15 delta assertions should hold; adjust seeds, not the shim).

## 8. Related plan docs

- `SESSIONS_WEB_PARITY_PLAN.md` — sessions, ✅ complete (the extraction pattern-setter).
- `POS_STOCK_OVERSELL_GUARD_PLAN.md` — 🔴 open; a separate concurrency/inventory correctness bug (not web-parity), live in v1.29.4.
- `WEBAPP_MULTI_TENANT_PLAN.md` — the exploratory options doc + Appendix A history.
- `MULTI_TENANT_IMPLEMENTATION_PLAN.md` — the shared-DB + `tenant_id` decisions (already implemented on this branch).
- `SESSION_WEB_PARITY_MERGE_HANDOFF.md` — ⚠️ **obsolete** (the merge it describes already happened via `0a79495`); safe to delete.

## 9. Deferred / hygiene backlog (from the audits, verify before relying)

- Rotate the committed `DASHSCOPE_API_KEY` in `backend/.env.dev`; fix/remove corrupted `backend/.env.prod`.
- Verify the desktop DB is actually SQLCipher-encrypted (stock better-sqlite3 prebuilds don't bundle the codec; key is optional — may be plaintext).
- Loto quirks: session-cart cash-prize channel `loto:cashPrize:create` ≠ registered `loto:cash-prize:create`; `CheckpointHistory.tsx` raw `window.api.loto.updateMetadata` (web-broken); `GET /checkpoints/scheduled` creates over GET.
- `lira-073` export spec: `#transfer-amount` seeding form doesn't open in web mode (excluded from the web suite).
- Align zod major versions across workspaces (removes the cast pattern).
- **REST action routes don't WRITE audit entries.** Only the Electron IPC handlers call `audit(...)`; the REST routes (loto/sessions/holdMoney/servicePresets/sales/…) don't. The audit VIEWER reads over REST (commit `40e4c5d`), but web-mode actions currently leave no audit trail. Decide: a shared audit hook in core, or per-route audit calls, when audit coverage of the web transport is needed.
- **Unproven-in-test surface from the closing/checkpoint pass (`57cfd6e`), thin wrappers — verify if touched:** (a) `POST /api/closing/recalculate-drawer-balances` is now live (the adapter had been calling a 404) but no spec hits it; (b) `InitialDrawerAmountsModal`'s four migrated calls aren't rendered by any web spec — the two name-changing mappings (`currencies.allDrawerCurrencies`→`getAllDrawerCurrencies`, `currencies.setDrawerCurrencies`→`setDrawerCurrencies`) were IPC-branch-name-verified by inspection but not exercised. Cover both in phase 4 (render the setup modal under both transports).

## Left TODO

<!--
//TODO — Validation pass 2026-08-04. Verdict: PARTIAL — phase 1 verified done, phase 2 (§3) overstates completeness (Recharge drawer top-ups are raw `window.api` with zero REST backing, a rule-19a violation), phase 3 (§7b) is genuinely mid-flight (7 of 87 desktop specs shimmed) with stale remaining-work counts, phase 4 correctly reported as not started. This doc IS a living tracker (per CLAUDE.md) — phases 3/4 sitting open is expected, not itself a defect. The defect is the false "step-2 is complete" claim.
//TODO   VERIFIED DONE (do not redo):
//TODO   - Phase 1 (page-render fixes): commit `c7bf8b4` exists in history (`git cat-file -t c7bf8b4` → commit).
//TODO   - Every commit hash cited across §3/§7b (fd3d29c, 4cfa514, 1dcef64, a13d768, 0eb9a52, 6472d91, 40e4c5d, 104e9e1, 919cb7e, 57cfd6e, ce10670, 6338f6f, 0cf0254, 9cb5603, bd2fde5, ffaad3b, e15e311) verified present in git history.
//TODO   - Per-module REST route files in §3's table all exist with plausible route counts: `backend/src/api/loto.ts` (30 router.* calls, claim "~28"), `partners.ts` (12), `suppliers.ts` (15), `debts.ts` incl. `POST /api/debts/credit` at line 125 (the `0cf0254` addCredit REST route), `closing.ts` (13, incl. `GET /checkpoint-timeline`:269, `GET /initial-checkpoint-date`:298), `vouchers.ts` (4), `audit.ts` (3), `drawerTopUp.ts` (5), `holdMoney.ts` (4), `servicePresets.ts` (4).
//TODO   - Phase 3 shim mechanism (§7b) verified byte-for-byte accurate against `frontend/tests/e2e-electron/helpers/webApiShim.ts` (Proxy + `__LIRATEK_WEB_API_SHIM` flag + reads-unwrap/writes-passthrough exactly as described). `frontend/playwright.web.config.ts` lines 47-64 (`SHARED_DESKTOP_SPECS`) list exactly the 7 specs the doc claims done (app.spec, lira-transactions-timezone, lira-session-multiple-per-day, lira-081, lira-084, lira-096, lira-097); `lira-099-session-debt-detail` is present in the file only as a comment explaining why it's excluded — matches the doc's "pulled, order-flaky" note exactly.
//TODO   - §9 backlog items spot-checked and confirmed still current (not stale): loto `cashPrize:create` (frontend `Loto/index.tsx:411`) vs registered `cash-prize:create` (electron `lotoHandlers.ts:696`, core `SessionCheckoutService.ts:178`) mismatch still present; `CheckpointHistory.tsx:84` still calls raw `window.api.loto.updateMetadata`; `GET /checkpoints/scheduled` still creates a checkpoint over GET (`backend/src/api/loto.ts:359`); REST routes still write zero audit entries (`grep audit( backend/src/api/*.ts` → 0 matches vs 31 electron handler files that call it).
//TODO   - Phase 4 ("Not started") confirmed accurate: `package.json` has separate `test:e2e` (`playwright.electron.config.ts`) and `test:e2e:web` (`playwright.web.config.ts`) scripts, no unified runner.
//TODO   REMAINING:
//TODO   - §3's "Pending: none — step-2 is complete... every money/config module the feature pages call is now reachable over REST" is FALSE. Recharge (an Active Module per CLAUDE.md) is missing from the §3 table entirely, and its drawer top-up UI is unreachable over REST: `frontend/src/features/recharge/pages/Recharge/index.tsx` calls raw `window.api.recharge.getDrawerBalances` (lines 329, 655), `.getHistory` (581), `.topUpApp` (681), `.topUpFromCustomer` (728), `.topUpFromSupplier` (763), `.topUpFromPartner` (792), `.topUpFromClient` (820) — NOT through `useApi()`/`backendApi.ts` (rule 19a violation; present since commit `072a0c6`, 2026-06-16, predates this doc). `backend/src/api/recharge.ts` has only 3 routes (`GET /stock`, `POST /process`, `POST /top-up`) — none of the 7 methods above exist as REST routes. In a real browser (no Electron, no test shim) these calls throw immediately (`window.api` is `undefined`) — a live dual-transport gap, not merely a phase-3 test-shim gap. §7b's own "truly-missing" list names `recharge.topUpFrom*`/`recharge.getDrawerBalances` but frames it only as a phase-3 shim-mapping task, which masks that this is really an unfinished phase-2 item plus an already-shipped rule-19 violation.
//TODO   - Phase 3: 7 of 87 desktop spec files are shimmed into the default web suite (plus 1 standalone-only, `lira-099`) — genuinely "in progress" as the doc says. But the doc's remaining-work estimates ("~43 specs remain" in §7b, "~50 IPC-driven desktop specs" in §2's phase-3 goal, "~148 specs" in §2's phase-4 goal — all dated 2026-07-11/07-21) are now stale: the suite has grown to 87 desktop + 16 web spec files (240 individual `test()` cases) since roughly 40 new `lira-089`..`lira-132` desktop specs landed after the tracker's last edit (`48b44ed`, 2026-07-21). Actual remaining desktop-spec work is closer to ~80 files, not ~43.
//TODO   - Phase 4 ("Unify the suites"): 0% started, confirmed accurate — nothing to correct, just still open.
//TODO   TRACKER DRIFT:
//TODO   - §3's per-module table omits Recharge entirely while the section's prose asserts full REST reachability for every feature-page module — see REMAINING above.
//TODO   - §7b's/§2's numeric backlog ("~43 specs remain", "~50 IPC-driven desktop specs", "~148 specs" for phase 4) is stale relative to the current 87 desktop + 16 web spec files / 240 `test()` cases; re-baseline before using these numbers for planning.
//TODO   - §8 lists `SESSION_WEB_PARITY_MERGE_HANDOFF.md` as "safe to delete" (obsolete) — it still exists, just relocated to `docs/plans/done_plans/SESSION_WEB_PARITY_MERGE_HANDOFF.md` during the todo/done_plans reorg (`b4a42f1`), not deleted. Low priority.
//TODO   CORRECTED DETAILS: none — no plan instruction names a symbol/route/file that was renamed or shipped under a different mechanism than described. Every commit hash, route file name, and shim mechanic cited in the doc checks out against the current code exactly as written.
//TODO   GATE when picked up: follow §4's proven recipe for Recharge — lift `topUpFrom*`/`getDrawerBalances`/`getHistory`/`topUpApp` Zod schemas into `packages/core/src/validators/recharge.ts`, add matching routes to `backend/src/api/recharge.ts`, add dual-mode fns to `frontend/src/api/backendApi.ts` + `ElectronApiAdapter.ts`, migrate `Recharge/index.tsx` off raw `window.api.recharge.*` onto `useApi()` (rule 19a), then extend `webApiShim.ts` and add the relevant recharge-heavy desktop specs to `SHARED_DESKTOP_SPECS`. Rebuild core + sync into `node_modules/@liratek/core/dist` (CLAUDE.md Core Build & Sync) before testing. Prove per §7 (live money-delta, rule-15 deltas, rule-17 fail-first).
-->

**Summary — 2 item(s) left:** The roadmap's phase-1 page fixes and the 12-module phase-2 REST-parity table are real and verified in code, and phase-3's shim mechanism and 7-spec allowlist are described with byte-for-byte accuracy. But the document's headline claim that "step-2 is complete... every money/config module the feature pages call is now reachable over REST" is false: the Recharge module's drawer top-up UI (top-up-from-customer/supplier/partner/client, drawer balances, history) still calls raw `window.api.recharge.*` with zero REST backing — a real, currently-shipping gap the doc's own §7b footnotes but never surfaces as an open phase-2 item or rule-19 violation. Separately, phase 3 is genuinely mid-flight (7 of 87 desktop specs shimmed) and its "specs remaining" counts are stale by roughly 40 specs added to the suite after the doc's last edit. Phase 4 is untouched, exactly as the doc states. As a living tracker, phases 3/4 being open is expected and not a defect on its own — the defect worth fixing is the false "complete" claim around Recharge.
