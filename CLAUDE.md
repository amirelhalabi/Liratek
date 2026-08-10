# LiraTek POS — Claude Code Context

@docs/fable-brain.md

## Project Overview

LiraTek is a **desktop POS system for retail management** built as an Electron app with a React frontend and SQLite backend.

- **Monorepo**: Yarn Workspaces (`frontend`, `electron-app`, `packages/core`, `backend`)
- **Stack**: React 19 + Vite + TypeScript + Electron 31 + SQLite (SQLCipher) + TanStack Query
- **DB**: Current migration version is **v147** — always check the last entry in `packages/core/src/db/migrations/index.ts` for the real current version and increment from it when adding migrations
- **Package manager**: Yarn (use `yarn workspace @liratek/X` commands)

## Shell Commands

- Always use the **Bash tool** with `cmd /c "..."` for yarn, npm, and any CLI commands — never the PowerShell tool. PowerShell output is unreliable for yarn on this Windows setup.

## Running E2E tests (`node scripts/run-e2e.mjs electron`)

**Required procedure — always run E2E this way:**

1. Run `yarn dev` first and wait for it to finish starting (it rebuilds `better-sqlite3` to the Electron ABI and builds `electron-app/dist`).
2. **Stop `yarn dev`** (frees port 5173 and the Electron instance).
3. Then run `node scripts/run-e2e.mjs electron` from the repo root (or `node ../scripts/run-e2e.mjs electron` from `frontend/`). **Never `yarn test:e2e` / `yarn workspace @liratek/frontend test:e2e`** — see the LIRA-123 note below. Pass extra Playwright args after the target, e.g. `node scripts/run-e2e.mjs electron -g "some test title"`. `node scripts/run-e2e.mjs web` runs the web suite the same way.

**LIRA-123 — do not invoke E2E through `yarn` on this Windows dev setup.** `yarn test:e2e` and `yarn workspace @liratek/frontend test:e2e` can silently exit 0 with **ZERO output in well under a second**, instead of running (or correctly erroring on) anything — proven with a `-g` pattern matching no spec, which Playwright itself always fails loudly on ("Error: No tests found") when invoked directly; reproduced this way repeatedly, from a fresh shell, every time. A direct invocation with no `yarn run`/`yarn workspace` hop in the chain does not exhibit it. `scripts/run-e2e.mjs` is that direct invocation, plus a floor assertion: it fails the run if the reported test count is suspiciously low, even when the underlying process's own exit code was 0. CI is NOT affected (Linux runners; verified against real run logs showing genuine spec counts like "240 passed (6.0m)"), but the CI step was switched to the same direct invocation anyway.

The exact mechanism inside Yarn's script-dispatch layer is not pinned down (its script/exec spawn path never reached a `child_process`-level require-hook in the failing case, so the failure is somewhere above that, not inside Node's own subprocess plumbing). Scope note: the identical symptom (exit 0, 0 output, sub-second) was also seen intermittently on `yarn workspace @liratek/frontend typecheck`/`test`/`lint` during this investigation, but — unlike the e2e case — not reliably; a separate clean-session measurement of the same typecheck/test commands completed correctly with real multi-second/minute runtimes and real output. The likely explanation is session/resource-state dependent (this investigation's shell had accumulated dozens of spawned processes), not a permanent property of every yarn invocation on this box. Do **not** read this as "distrust all yarn output" — `yarn typecheck`/`yarn lint` are not shown to be unreliable in normal use; only the e2e/Playwright invocation is proven broken and is the one to always bypass.

Do NOT try to launch the app directly (`npx electron .`) to validate — it fails with an ESM `cjsPreparseModuleExports` error outside this flow. The Playwright harness only launches correctly after the `yarn dev` → stop → e2e-run sequence. E2E specs live in `frontend/tests/e2e-electron/lira-*.spec.ts`.

**Stale build = old code at runtime.** The harness loads compiled output, not source. After editing `electron-app/` source (handlers, `preload.ts`, `schemas/index.ts`) you MUST re-run step 1 (`yarn dev` rebuilds `electron-app/dist`) before `test:e2e` — otherwise the old `dist` runs and your change is silently ignored (a stale `schemas/dist` rejecting a renamed enum once surfaced as a confusing Zod-validation failure on a value the new source clearly allows). After editing `packages/core/` source, rebuild + sync core (see **Core Build & Sync**) — `node_modules/@liratek/core/dist` is a real copy, not a symlink.

## Non-Negotiable Rules

1. **TypeScript strict mode** — no `any` types
2. **IPC access** — always `window.api.*` in frontend, NEVER `window.electron.*`
3. **SQL safety** — always parameterized queries (`?` placeholders), NEVER string concatenation
4. **Logger** — always use module loggers, NEVER `console.log`
5. **Schema** — all tables must have `id`, `created_at`, `updated_at`
6. **IPC response format** — always `{ success: boolean, data?, error? }`
7. **Exports** — named exports preferred; default only for pages/components
8. **Import alias** — use `@/` for `frontend/src/` imports
9. **Build verification** — always run `yarn typecheck` and `yarn lint` before considering work complete
10. **Migrations** — always update BOTH `packages/core/src/db/migrations/index.ts` AND `electron-app/create_db.sql`
11. **Client propagation** — any transaction submission form that has a client name/phone UI field MUST propagate `client_id` all the way through: UI state → IPC call payload → handler → service/repository → `createTransaction({ client_id })`. A missing link silently drops the association and the client column shows "—" in the transactions table.
12. **Preload type completeness** — the `data` parameter type in every `preload.ts` IPC binding MUST include all fields the frontend sends. TypeScript types don't strip properties at runtime, but missing fields cause type errors when the renderer isn't using `as any`, and they make it easy to silently drop fields in future refactors.
13. **Services never touch the database** — no `getDatabase()`, no `db.prepare(...)`, no raw SQL in any `*Service.ts`. All data access goes through a repository injected via the constructor — _including_ multi-table analytics/reporting queries. A cross-entity report gets a dedicated reporting repository (e.g. `ProfitRepository`); the service keeps only assembly, aggregation, currency-splitting, and business decisions. This keeps SQL in one layer and lets services be unit-tested with a mocked repo. (`ProfitService`, `SessionPaymentService`, and `ActivityService` currently violate this — they are the bug to fix, not the pattern to copy.)
14. **Never copy-paste a business-rule SQL predicate** — any `WHERE`/`CASE` fragment that encodes a domain rule ("fully paid", settled-vs-pending, date-range bounds, USD/LBP bucketing) must be defined **once** as a named constant or SQL fragment and reused. If you're about to paste the same predicate into a second query, extract it first.
15. **E2E assertions over the shared DB** — the `test:e2e` suite shares ONE accumulating SQLite DB across all specs, run in order. NEVER assert "my transaction is the newest row" via `transactions.getRecent(...)[0]` or `tbody tr.first()`. Three traps make that wrong: (a) a single action can write **multiple** unified-transaction rows (e.g. a cost/price SEND or supplier-credit op writes a `FINANCIAL_SERVICE`/`RECHARGE` row **and** an auto `SUPPLIER_PAYMENT` supplier-ledger sibling); (b) `transactions.created_at` is **second-granular**, so same-second rows tie (`getRecent` orders `created_at DESC, id DESC`); (c) earlier specs leave rows that are "newer" than yours if yours didn't commit. Instead: match the row by **identity** (type + provider/`service_type`, `source_id`, `item_key`, or a unique amount/label), and assert **deltas** — snapshot the drawer/ledger/balance immediately before the action and compare — never absolute totals or row position.
16. **Payment legs — flow branches consume IN legs only** — every money repository (`FinancialServiceRepository`, `RechargeRepository`, `SalesRepository`, `DebtRepository`) splits its `payments[]` with `partitionLegs` (`utils/payments.ts`): legs without a `direction` are IN (customer-paid / payout), `direction: "OUT"` marks change/return legs. Each repo has ONE shared end-of-transaction loop that debits every drawer-affecting OUT leg exactly once ("Change returned"). A flow-specific branch that iterates legs MUST build from the IN set only — including `returnLegs` double-debits the drawer (this exact bug was caught pre-merge in the C1 split-payout fix). The frontend sends split legs, return legs, and cashout method in ONE IPC call; there is never a follow-up call, so money-movement fixes belong in the repository layer.
17. **Prove regression tests against the buggy code** — a test added to guard a fix only counts once it has been shown to FAIL on the pre-fix code: temporarily reintroduce the bug, watch the new test fail, revert. A guard test that has never failed proves nothing.
18. **Read the Feature Guide before touching money** — before building or modifying ANY flow that writes transactions, payments, drawers, or ledgers, read `docs/FEATURE_GUIDE.md` and work through its §13 checklist (transaction row fields, IN/OUT badge case, payment legs, client propagation, CUSTOMER_ACCOUNT model, supplier/partner ledger, void path, profit stamping, session branch). Rules 11/15/16/17 above are the enforcement summary; the guide is the full map with the guarding spec named for each rule.
19. **Dual-transport by default — every feature MUST work on BOTH desktop (Electron/IPC) and web (browser/REST).** LiraTek ships as an Electron desktop app AND a multi-tenant web app off the SAME codebase. New code is not done until it works in both. The non-negotiables: (a) frontend data access goes through `useApi()` / the dual-mode `frontend/src/api/backendApi.ts` adapter (`ipcOrHttp` picks IPC vs REST) — **never** a raw `window.api.*` call or a `if (window.api) … else …` transport gate in a page/component (that breaks in the browser and under the web-test shim; if you must detect the runtime, call the canonical `isElectron()`, never `!!window.api` inline); (b) every write-path IPC handler in `electron-app/handlers/` gets a mirroring REST route in `backend/src/api/` that feeds the **same** `@liratek/core` service, with the Zod schema lifted to `packages/core/src/validators/` and shared by both (rules 13 + 14); (c) REST routes use `authenticateJWT` (tenant context) **then** `requireRole(...)` matching the handler, inject `userId`/actor from the JWT (never trust the client), and return the IPC-identical envelope (`{ success, … }`, HTTP 200 even on failure); (d) prove it in web mode — extend `frontend/tests/e2e-web/lira-web-*` or enable the desktop spec over the web shim (`docs/plans/todo_plans/WEB_PARITY_ROADMAP.md`). See **Dual-Transport Architecture** below for the full pattern. The old desktop-only shortcuts (raw `window.api`, IPC-only handlers with no REST) are the debt being paid down, not the pattern to copy.

20. **Reversal symmetry — every ledger row a flow writes must have a named reversal owner.** The generic void/refund (`TransactionRepository`) reverses payment legs/drawers (`_reversePayments`), module-charge debt (`_cancelDebt` over `MODULE_DEBT_TRANSACTION_TYPES`), profit (negated stamp on REFUND), sale stock, and the supplier soft-void. Whenever a change makes a flow write a NEW side-effect row tied to a transaction — a new `debt_ledger` `transaction_type`, a new ledger table, an auto sibling row — the SAME change must assign its reversal owner: (a) the generic path (add the charge type to `MODULE_DEBT_TRANSACTION_TYPES` / extend the generic reversal), or (b) a module-owned reversal with the type gated in `NON_REVERSIBLE_TRANSACTION_TYPES` — and prove create + reverse nets to **0 across every ledger touched, per currency**, with a failing-first test (rule 17). The trap that ships this bug is NOT new flows (the guide's §13 checklist catches those) — it's **extending an existing capability to more modules** (e.g. "CUSTOMER_ACCOUNT everywhere", lira-093): each newly covered module re-triggers this rule. That exact miss left refunds of account-charged recharges/services keeping the customer's debt (owner-reported 2026-07-12; lira-104 + lira-web-012 guard it). New charge types MUST be named `'<Module> Debt'` — the core jest guard `constants/__tests__/moduleDebtTypes.guard.test.ts` fails any `… Debt` string literal in `packages/core/src` that is not classified in the whitelist or the documented exclusions.

---

## Dual-Transport Architecture (Desktop IPC + Web REST)

One React frontend, two transports, one core. Both land on the SAME `@liratek/core` service/repository — the transport is the only thing that differs.

```
page/component
  → useApi()  (ApiProvider → ElectronApiAdapter, a thin shim over backendApi.ts)
  → backendApi.ts fn → ipcOrHttp(ipc, http)
       isElectron()?  window.api.* (IPC, desktop)   :   /api/* (REST, browser)
  → BOTH call the same @liratek/core service → repository (tenant-scoped)
```

**Adding/changing a feature — the checklist:**

- **Core** owns the logic. Repositories do SQL; services orchestrate (rule 13). Both transports call the service — no logic in the handler or the route.
- **Schema once** in `packages/core/src/validators/<module>.ts`; re-export in `electron-app/schemas/index.ts` with the zod-major cast (`as unknown as z.ZodSchema<T>`); `backend/` imports it directly for `validateRequest(...)` (rule 14).
- **IPC handler** (`electron-app/handlers/`): `requireRole` + `validatePayload` + `{ success, data?, error? }`.
- **REST route** (`backend/src/api/<module>.ts`, mounted in `server.ts`): `authenticateJWT` → `requireRole(...)` (same roles), `validateRequest(coreSchema)`, inject `userId` from `req.user`, IPC-identical envelope. Static paths before `/:id`.
- **Adapter**: dual-mode fn in `backendApi.ts` (`ipcOrHttp`); expose on `ElectronApiAdapter.ts`; type it in `packages/ui/src/api/types.ts` (`ApiAdapter`). Reads return the RAW IPC shape (array/object), writes return the envelope — the shim and the app both depend on that contract.
- **Frontend**: call `useApi().<fn>` — migrate any raw `window.api.*` you touch.
- **Prove both**: web e2e green (`yarn test:e2e:web`) AND desktop e2e green (`yarn rebuild:native` first).

**Gotchas that cost real time:**

- **`isElectron()` is `!!window.api`.** Any component gating on raw `window.api` truthiness (instead of `isElectron()` / the adapter) takes the wrong branch in the browser and crashes under the web-test `window.api` shim. Fix on sight: drop the branch, use `useApi()`.
- **`requireRole` needs `requireAuth`/`authenticateJWT` FIRST** — it only reads `req.user`. Most route files have a router-level `authenticateJWT`; a few (e.g. `closing.ts`) don't — add `requireAuth` per admin route or `req.user` is undefined → 401 with no `success` field.
- **better-sqlite3 ABI is NOT portable.** Electron ABI (`yarn rebuild:native`) vs Node ABI (`yarn rebuild:node`, used by `yarn test:e2e:web` and core jest). Running the wrong one makes desktop e2e fail EVERY spec at `fixtures.ts` `waitForEvent "window"` — environmental, not a code bug. **Probe — it MUST construct a database; a bare `require` is a false positive:** `node -e "const D=require('better-sqlite3'); new D(':memory:'); console.log('Node ABI')"`. The native binding loads lazily inside the `Database` constructor, so `require('better-sqlite3')` alone succeeds even on a mismatched ABI (it printed OK seconds before `new Database()` threw `NODE_MODULE_VERSION 125 ... requires 127`). Constructs ⇒ Node ABI (wrong for desktop). **To merely READ a LiraTek db, use Python's stdlib `sqlite3`** — zero ABI coupling, no rebuild, so it cannot break desktop e2e (the live app db is `~/Documents/LiraTek/liratek.db`, plain SQLite, not encrypted; copy `.db`+`-wal`+`-shm` and query the copy).
- **Envelope parity**: REST returns HTTP 200 even on failure (`{success:false,error}`) to match IPC; the adapter branches on `result.success`, not status code. Don't "fix" to 4xx.
- **Field translation**: IPC args ≠ REST bodies sometimes (`seed.ts`: `cost_price`↔`cost_price_usd`, `whatsapp_opt_in` 0/1↔boolean; IPC-only fields like `started_by`/`closedBy` are dropped — REST derives the actor from the JWT). Cross-check the body against the actual `backend/src/api/*` route, not the IPC arg.
- **Tenant context is automatic** on REST via `authenticateJWT` (→ `runWithTenant`) as long as repos extend `BaseRepository`; desktop uses the fixed tenant from `initFixedTenantContext(1)` at boot. `tenantContext.ts` is fail-closed.

The living tracker + per-module status + the web-test shim mechanism is `docs/plans/todo_plans/WEB_PARITY_ROADMAP.md`.

---

## Electron Process Model

This is critical. Electron runs two separate JS environments that cannot share memory.

```
┌─────────────────────────────────┐     IPC only      ┌─────────────────────────────────┐
│        MAIN PROCESS             │ ◄────────────────► │      RENDERER PROCESS           │
│  electron-app/main.ts           │                    │  frontend/src/ (React + Vite)   │
│  electron-app/handlers/*.ts     │                    │  window.api.* calls only        │
│  packages/core/ (DB, services)  │                    │  NO Node.js, NO DB access       │
│  Node.js APIs available         │                    │  contextIsolation = true        │
└─────────────────────────────────┘                    └─────────────────────────────────┘
                ▲
                │ contextBridge (preload.ts)
                │ exposes window.api.* to renderer
```

### What goes where

| Task                   | Location                          | Why                               |
| ---------------------- | --------------------------------- | --------------------------------- |
| Database queries       | `packages/core/src/repositories/` | Main process only                 |
| Business logic         | `packages/core/src/services/`     | Main process only                 |
| IPC wiring             | `electron-app/handlers/`          | Main process only                 |
| File system (userData) | Main process via `app.getPath()`  | Renderer has no fs access         |
| React UI, state        | `frontend/src/`                   | Renderer only                     |
| `window.api.*` calls   | `frontend/src/`                   | Only way to reach main            |
| `ipcRenderer.invoke`   | `electron-app/preload.ts` only    | Never import in renderer directly |

### Security Model

```
contextIsolation = true   ← renderer cannot access Node.js globals
nodeIntegration  = false  ← renderer is a sandboxed browser
sandbox          = false  ← preload scripts can use Node (required for IPC)
```

**Never:**

- Import `electron`, `better-sqlite3`, `fs`, or any Node module in `frontend/src/`
- Call `ipcRenderer` directly from React code (only from `preload.ts`)
- Use `window.electron.*` — only `window.api.*`

### Dev vs Production Paths

```typescript
// ✅ Correct — works in both dev and prod
import { app } from "electron";
const userDataPath = app.getPath("userData"); // e.g. AppData/Roaming/LiraTek
const dbPath = path.join(userDataPath, "phone_shop.db");

// ❌ Wrong — breaks in packaged app
const dbPath = path.join(__dirname, "../../phone_shop.db");
```

### Native Module Rebuild

`better-sqlite3` is a native module that must be compiled for the exact Electron version:

```bash
# Run after: yarn install, Electron version change, switching node versions
yarn rebuild:native

# If switching to plain Node (for tests)
yarn rebuild:node
```

---

## Active Modules

`pos`, `debts`, `inventory`, `clients`, `exchange`, `omt_whish`, `recharge`, `loto`, `expenses`, `maintenance`, `custom_services`, `closing`, `profits`

---

## Key Reference Files

| What                                                                   | Where                                                      |
| ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| Money rules & feature checklist                                        | `docs/FEATURE_GUIDE.md`                                    |
| Dual-transport (desktop+web) status & shim                             | `docs/plans/todo_plans/WEB_PARITY_ROADMAP.md`              |
| Dual-mode API adapter                                                  | `frontend/src/api/backendApi.ts` + `ElectronApiAdapter.ts` |
| E2E suite index & conventions                                          | `frontend/tests/e2e-electron/README.md`                    |
| Repository example                                                     | `packages/core/src/repositories/SalesRepository.ts`        |
| Service example                                                        | `packages/core/src/services/SalesService.ts`               |
| IPC handler example                                                    | `electron-app/handlers/salesHandlers.ts`                   |
| Preload bindings                                                       | `electron-app/preload.ts`                                  |
| TypeScript types                                                       | `frontend/src/types/electron.d.ts`                         |
| Page example                                                           | `frontend/src/features/loto/pages/Loto/index.tsx`          |
| Routes                                                                 | `frontend/src/app/App.tsx`                                 |
| Migrations                                                             | `packages/core/src/db/migrations/index.ts`                 |
| Fresh schema                                                           | `electron-app/create_db.sql`                               |
| DB connection                                                          | `packages/core/src/db/connection.ts`                       |
| Loggers                                                                | `packages/core/src/utils/logger.ts`                        |
| CI workflow                                                            | `.github/workflows/ci.yml`                                 |
| Build workflow                                                         | `.github/workflows/build.yml`                              |
| Backend patterns (repository/service/logger conventions, build & sync) | `packages/core/CLAUDE.md`                                  |
| Electron patterns (IPC handler/preload/Zod conventions)                | `electron-app/CLAUDE.md`                                   |
| Frontend patterns (page/component/hook templates, routes)              | `frontend/src/CLAUDE.md`                                   |
| CI/CD conventions                                                      | `.github/CLAUDE.md`                                        |
| Adding a DB migration (template, schema standards)                     | `add-migration` skill                                      |
| Adding a brand-new feature module end-to-end                           | `add-feature-module` skill                                 |

---

## Common Gotchas

### General

- `window.electron.*` → use `window.api.*`
- `console.log` → use the module logger
- String SQL concatenation → use `?` parameterized queries
- Skipping `create_db.sql` after a migration → always update both
- Forgetting to rebuild core → `cd packages/core && npm run build` after any core change, then `xcopy /e /y /q "packages\core\dist" "node_modules\@liratek\core\dist\"` to sync (node_modules is a real copy, not a symlink)
- Skipping `down()` in migrations → always implement rollback
- `any` TypeScript type → define a proper interface
- Write-path IPC handler missing Zod validation → add `validatePayload()` call
- `getDatabase()` / raw SQL inside a `*Service.ts` → move it to a repository; services orchestrate, repositories query
- Copy-pasting the same business-rule predicate (e.g. the "fully paid" check) into a second query → extract it to one named fragment first
- Iterating `returnLegs` (OUT legs) inside a flow-specific branch of a money repository → double-debit; the shared end-of-transaction loop already handles them (rule 16)

### Electron-Specific

- Importing `fs`, `path`, `electron`, or `better-sqlite3` in `frontend/src/` → **main process only**
- Using `__dirname` for DB/file paths → use `app.getPath('userData')` instead
- After changing Electron version → run `yarn rebuild:native`
- Forgetting `requireRole()` on protected IPC channels → security hole
- Adding a handler but forgetting to register it in `main.ts` → silently does nothing
- Adding a preload binding but no TypeScript type in `electron.d.ts` → type error in renderer
- Multi-step DB operations without a transaction → data inconsistency on crash
