# LiraTek POS — Claude Code Context

@docs/fable-brain.md

## Project Overview

LiraTek is a **desktop POS system for retail management** built as an Electron app with a React frontend and SQLite backend.

- **Monorepo**: Yarn Workspaces (`frontend`, `electron-app`, `packages/core`, `backend`)
- **Stack**: React 19 + Vite + TypeScript + Electron 31 + SQLite (SQLCipher) + TanStack Query
- **DB**: Current migration version is **v147** — always check the last entry in `packages/core/src/db/migrations/index.ts` for the real current version and increment from it when adding migrations
- **Package manager**: Yarn (use `yarn workspace @liratek/X` commands)

## Project Structure

```
liratek/
├── frontend/src/
│   ├── features/          # Feature modules (POS, Debts, Loto, etc.)
│   ├── shared/            # Shared components, hooks, utils
│   ├── contexts/          # React Context providers
│   ├── types/             # TypeScript types (electron.d.ts)
│   └── app/              # App config, routes (App.tsx)
│
├── electron-app/
│   ├── main.ts            # Main process entry
│   ├── preload.ts         # IPC bindings → window.api.*
│   ├── handlers/          # IPC handler implementations (thin wrappers)
│   ├── session.ts         # Session & role-based auth
│   └── create_db.sql      # Fresh install schema (keep in sync with migrations)
│
├── packages/core/src/
│   ├── repositories/      # Database access layer
│   ├── services/          # Business logic layer
│   ├── db/
│   │   ├── connection.ts  # Database connection
│   │   └── migrations/    # Schema migrations (index.ts)
│   └── utils/
│       └── logger.ts      # Module-specific loggers
│
├── backend/               # Backend services
└── .github/workflows/     # CI/CD pipelines
```

## Shell Commands

- Always use the **Bash tool** with `cmd /c "..."` for yarn, npm, and any CLI commands — never the PowerShell tool. PowerShell output is unreliable for yarn on this Windows setup.

## Running E2E tests (`yarn test:e2e`)

**Required procedure — always run E2E this way:**

1. Run `yarn dev` first and wait for it to finish starting (it rebuilds `better-sqlite3` to the Electron ABI and builds `electron-app/dist`).
2. **Stop `yarn dev`** (frees port 5173 and the Electron instance).
3. Then run `yarn test:e2e`.

Do NOT try to launch the app directly (`npx electron .`) to validate — it fails with an ESM `cjsPreparseModuleExports` error outside this flow. The Playwright harness only launches correctly after the `yarn dev` → stop → `test:e2e` sequence. E2E specs live in `frontend/tests/e2e-electron/lira-*.spec.ts`.

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
- **better-sqlite3 ABI is NOT portable.** Electron ABI (`yarn rebuild:native`) vs Node ABI (`yarn rebuild:node`, used by `yarn test:e2e:web` and core jest). Running the wrong one makes desktop e2e fail EVERY spec at `fixtures.ts` `waitForEvent "window"` — environmental, not a code bug. Probe: `node -e "require('better-sqlite3')"` LOADS ⇒ Node ABI (wrong for desktop).
- **Envelope parity**: REST returns HTTP 200 even on failure (`{success:false,error}`) to match IPC; the adapter branches on `result.success`, not status code. Don't "fix" to 4xx.
- **Field translation**: IPC args ≠ REST bodies sometimes (`seed.ts`: `cost_price`↔`cost_price_usd`, `whatsapp_opt_in` 0/1↔boolean; IPC-only fields like `started_by`/`closedBy` are dropped — REST derives the actor from the JWT). Cross-check the body against the actual `backend/src/api/*` route, not the IPC arg.
- **Tenant context is automatic** on REST via `authenticateJWT` (→ `runWithTenant`) as long as repos extend `BaseRepository`; desktop uses the fixed tenant from `initFixedTenantContext(1)` at boot. `tenantContext.ts` is fail-closed.

The living tracker + per-module status + the web-test shim mechanism is `docs/plans/todo_plans/WEB_PARITY_ROADMAP.md`.

---

## Area: Backend (`packages/core/src/`)

### Repository Pattern

All database access goes through repository classes with the singleton pattern.

```typescript
import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";

export interface Entity {
  id: number;
  created_at: string;
  updated_at: string;
}

export interface CreateData {
  field1: string;
  field2: number;
}

export class MyRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(data: CreateData): Entity {
    const stmt = this.db.prepare(`
      INSERT INTO my_table (field1, field2, created_at, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    const result = stmt.run(data.field1, data.field2);
    return this.getById(result.lastInsertRowid as number)!;
  }

  getById(id: number): Entity | null {
    const stmt = this.db.prepare(`SELECT * FROM my_table WHERE id = ?`);
    return stmt.get(id) as Entity | null;
  }

  update(id: number, data: Partial<CreateData>): Entity | null {
    const stmt = this.db.prepare(`
      UPDATE my_table SET field1 = ?, field2 = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(data.field1, data.field2, id);
    return this.getById(id);
  }

  delete(id: number): void {
    const stmt = this.db.prepare(`DELETE FROM my_table WHERE id = ?`);
    stmt.run(id);
  }
}

// Singleton
let instance: MyRepository | null = null;

export function getMyRepository(): MyRepository {
  if (!instance) {
    instance = new MyRepository(getDatabase());
  }
  return instance;
}

export function resetMyRepository(): void {
  instance = null; // Used in tests
}
```

Export in `packages/core/src/repositories/index.ts`:

```typescript
export {
  MyRepository,
  getMyRepository,
  resetMyRepository,
} from "./MyRepository.js";
```

### Service Pattern

Business logic layer — repositories handle data, services handle validation and logic.

```typescript
import {
  getMyRepository,
  type MyRepository,
} from "../repositories/MyRepository.js";
import { myLogger } from "../utils/logger.js";

export class MyService {
  private repo: MyRepository;

  constructor(repo: MyRepository) {
    this.repo = repo;
  }

  createEntity(data: CreateData): Entity {
    try {
      if (!data.field1) throw new Error("field1 is required");

      const entity = this.repo.create(data);
      myLogger.info({ entityId: entity.id }, "Entity created");
      return entity;
    } catch (error) {
      myLogger.error({ error }, "createEntity failed");
      throw error;
    }
  }
}

// Singleton
let instance: MyService | null = null;

export function getMyService(): MyService {
  if (!instance) {
    instance = new MyService(getMyRepository());
  }
  return instance;
}

export function resetMyService(): void {
  instance = null;
}
```

Export in `packages/core/src/services/index.ts`:

```typescript
export { MyService, getMyService, resetMyService } from "./MyService.js";
```

### Available Loggers

```typescript
import { salesLogger, lotoLogger, rechargeLogger } from "../utils/logger.js";
// Also: financialLogger, exchangeLogger, debtLogger, inventoryLogger,
//       authLogger, dbLogger, ipcLogger, maintenanceLogger, expenseLogger,
//       closingLogger, customServiceLogger, settingsLogger, voiceBotLogger
```

### Backend Commands

```bash
cd packages/core && npm run build      # MUST rebuild after core changes
yarn workspace @liratek/backend typecheck
yarn workspace @liratek/backend test
yarn workspace @liratek/backend test:coverage
```

### Core Build & Sync (REQUIRED after every packages/core change)

`node_modules/@liratek/core` is a **real copy**, not a symlink. After rebuilding core, you MUST sync it:

```bash
# Step 1 — rebuild
cd packages/core && npm run build

# Step 2 — sync into node_modules (Electron main process reads from here)
xcopy /e /y /q "packages\core\dist" "node_modules\@liratek\core\dist\"
```

**If you skip Step 2, the Electron main process will run old code even after a full restart.** This manifests as schema changes, new fields, or logic fixes being silently ignored at runtime.

Rule: whenever you edit any file under `packages/core/src/`, always run both commands before declaring the task complete.

---

## Area: Database (`packages/core/src/db/`)

### Migration Creation

Add to `packages/core/src/db/migrations/index.ts`:

```typescript
{
  version: 49, // Always increment from current
  name: "add_new_feature",
  description: "Add new feature tables",
  type: "typescript",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS new_table (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        field1 TEXT NOT NULL,
        field2 REAL NOT NULL DEFAULT 0,
        user_id INTEGER,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    db.exec(`CREATE INDEX idx_new_table_user_id ON new_table(user_id)`);
    db.exec(`CREATE INDEX idx_new_table_created_at ON new_table(created_at)`);

    // Register module
    db.exec(`
      INSERT OR IGNORE INTO modules (key, label, icon, route, sort_order, admin_only)
      VALUES ('new_module', 'New Module', 'IconName', '/new-module', 17, 0)
    `);

    // Currency support (USD & LBP)
    db.exec(`
      INSERT OR IGNORE INTO currency_modules (currency_code, module_key)
      VALUES ('USD', 'new_module'), ('LBP', 'new_module')
    `);

    // Drawer support (if module handles cash)
    db.exec(`
      INSERT OR IGNORE INTO currency_drawers (currency_code, drawer_name)
      VALUES ('USD', 'NewModule'), ('LBP', 'NewModule')
    `);

    console.log("Migration v49: New feature added");
  },
  down(db) {
    db.exec(`DROP TABLE IF EXISTS new_table`);
    db.exec(`DELETE FROM modules WHERE key = 'new_module'`);
    db.exec(`DELETE FROM currency_modules WHERE module_key = 'new_module'`);
    db.exec(`DELETE FROM currency_drawers WHERE drawer_name = 'NewModule'`);
  }
}
```

### Fresh Install Schema

Also update `electron-app/create_db.sql` with the same table + INSERT statements, plus:

```sql
INSERT INTO schema_migrations (version, name, applied_at)
VALUES (49, 'add_new_feature', CURRENT_TIMESTAMP);
```

### Schema Standards

```sql
-- Every table must have:
id INTEGER PRIMARY KEY AUTOINCREMENT
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP

-- Foreign keys with explicit actions:
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL   -- most common
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE    -- for child records
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT   -- protect parent

-- Indexes for WHERE/JOIN fields:
CREATE INDEX idx_table_field ON table(field);
```

### Transactions

```typescript
const transaction = db.transaction((data) => {
  db.prepare(`INSERT INTO table1 ...`).run(data.val1);
  db.prepare(`INSERT INTO table2 ...`).run(data.val2);
});
transaction(data);
```

### Database Tables Reference

**Core**: `users`, `products`, `clients`, `sales`, `sale_items`, `debt_ledger`, `suppliers`

**Financial**: `financial_services` (OMT/Whish/IPEC/KATCH), `recharges` (MTC/Alfa), `loto_tickets`, `loto_settings`, `loto_monthly_fees`, `exchange_rates`, `expenses`, `maintenance_jobs`

**System**: `modules`, `payment_methods`, `currencies`, `currency_modules`, `currency_drawers`, `schema_migrations`

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

## Area: Electron (`electron-app/`)

### IPC Handler Pattern

```typescript
import { ipcMain } from "electron";
import { getMyService } from "@liratek/core";
import { myLogger } from "@liratek/core";
import { requireRole } from "../session.js";

let service: ReturnType<typeof getMyService> | null = null;

function getServiceInstance() {
  if (!service) service = getMyService();
  return service;
}

export function registerMyHandlers(): void {
  myLogger.info("Registering My IPC handlers");

  ipcMain.handle("my:create", async (e, data) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error);

      const result = getServiceInstance().createEntity(data);
      return { success: true, result };
    } catch (error) {
      myLogger.error({ error }, "my:create failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create",
      };
    }
  });

  myLogger.info("My IPC handlers registered");
}
```

### Preload Bindings (`electron-app/preload.ts`)

```typescript
myModule: {
  create: (data: CreateData) => ipcRenderer.invoke("my:create", data),
  getById: (id: number) => ipcRenderer.invoke("my:getById", id),
  update: (id: number, data: UpdateData) => ipcRenderer.invoke("my:update", id, data),
  delete: (id: number) => ipcRenderer.invoke("my:delete", id),
},
```

### Register in Main (`electron-app/main.ts`)

```typescript
const myHandlers = await import("./handlers/myHandlers.js");
myHandlers.registerMyHandlers();
```

### IPC Input Validation (Zod)

**All write-path handlers MUST validate input with Zod before touching the database.**

Schemas live in `electron-app/schemas/index.ts`. Use the `validatePayload` helper:

```typescript
import { validatePayload, MySchema } from "../schemas/index.js";

ipcMain.handle("my:create", async (e, data) => {
  try {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };

    // ← Validate BEFORE any DB call
    const validation = validatePayload(MySchema, data);
    if (!validation.ok) return { success: false, error: validation.error };

    const result = getServiceInstance().createEntity(validation.data);
    return { success: true, result };
  } catch (error) {
    myLogger.error({ error }, "my:create failed");
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed",
    };
  }
});
```

When adding a new schema:

```typescript
// electron-app/schemas/index.ts
export const MySchema = z.object({
  name: z.string().min(1, "Name is required"),
  amount: z.number().nonnegative(),
  status: z.enum(["active", "inactive"]).optional().default("active"),
});
```

**Rules:**

- Read-only handlers (GET) — validation optional but recommended
- Write handlers (CREATE/UPDATE/DELETE) — validation **required**
- Always export new schemas from `schemas/index.ts`
- Use `.safeParse()` via `validatePayload()`, never `.parse()` (throws)

### Handler Checklist

- [ ] Create `electron-app/handlers/{module}Handlers.ts`
- [ ] Wrap every handler in try-catch
- [ ] Call `requireRole()` for protected operations
- [ ] Validate input with `validatePayload()` + Zod schema on write paths
- [ ] Return `{ success, data?, error? }` always
- [ ] Add preload bindings in `preload.ts` — include ALL fields the frontend sends in the parameter type
- [ ] Register handler function in `main.ts`
- [ ] Add TypeScript types in `frontend/src/types/electron.d.ts`
- [ ] If the form has a client name/phone field: pass `clientId` + `clientName` through IPC → service → `createTransaction({ client_id })`
- [ ] **Mirror it for the web (rule 19):** add a REST route in `backend/src/api/` feeding the same core service, a dual-mode `backendApi.ts` fn on `useApi()`, and consume via `useApi()` in the frontend — never a raw `window.api.*` call. See **Dual-Transport Architecture**.

---

## Area: Frontend (`frontend/src/`)

### Feature Module Structure

```
frontend/src/features/{module}/
├── pages/
│   └── {Module}/
│       └── index.tsx     ← default export, named export both fine here
├── components/
├── hooks/
└── types/
```

### Page Component Template

```typescript
import { useState, useEffect } from "react";

export function ModulePage() {
  const [data, setData] = useState<MyType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    const result = await window.api.myModule.get();
    if (result.success) {
      setData(result.data);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }

  return (
    <div className="h-full p-6">
      <h1 className="text-2xl font-bold text-white">Module Name</h1>
      {/* Content */}
    </div>
  );
}

export default ModulePage;
```

### Add Route (`frontend/src/app/App.tsx`)

```typescript
const MyModule = lazy(() => import("@/features/myModule/pages/MyModule"));

// In Routes:
<Route path="/my-module" element={<ProtectedRoute><MyModule /></ProtectedRoute>} />
```

### TypeScript Types (`frontend/src/types/electron.d.ts`)

```typescript
myModule: {
  create: (data: CreateData) => Promise<{ success: boolean; result?: Entity; error?: string }>;
  get: (id: number) => Promise<{ success: boolean; result?: Entity; error?: string }>;
  update: (id: number, data: UpdateData) => Promise<{ success: boolean; result?: Entity; error?: string }>;
  delete: (id: number) => Promise<{ success: boolean; error?: string }>;
};
```

### UI Component Patterns

**Stats Card:**

```typescript
<div className="bg-slate-800 rounded-xl border border-slate-700/50 p-4">
  <div className="flex items-center gap-2 mb-2">
    <Icon className="w-4 h-4 text-orange-400" />
    <span className="text-xs text-slate-400">Label</span>
  </div>
  <p className="text-2xl font-bold text-white">{value.toLocaleString()}</p>
</div>
```

**Form Input:**

```typescript
<div>
  <label className="text-xs text-slate-400 block mb-1">Label *</label>
  <input
    type="text"
    value={value}
    onChange={(e) => setValue(e.target.value)}
    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
    placeholder="Enter value"
  />
</div>
```

**Submit Button:**

```typescript
<button
  onClick={handleSubmit}
  disabled={isSubmitting || !isValid}
  className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
>
  {isSubmitting ? "Processing..." : "Submit"}
</button>
```

**Data Table:**

```typescript
<div className="bg-slate-800 rounded-xl border border-slate-700/50 overflow-hidden">
  <table className="w-full">
    <thead className="bg-slate-900">
      <tr>
        <th className="text-left text-xs text-slate-400 px-4 py-3">Column</th>
      </tr>
    </thead>
    <tbody className="divide-y divide-slate-700">
      {items.map((item) => (
        <tr key={item.id} className="hover:bg-slate-700/50">
          <td className="px-4 py-3 text-sm text-white">{item.value}</td>
        </tr>
      ))}
    </tbody>
  </table>
</div>
```

### Custom Hook Template (TanStack Query)

Use TanStack Query for all data fetching — it replaces manual `useState`/`useEffect`/`loading`/`error` boilerplate. The `unwrapIpc` helper (`frontend/src/shared/api/unwrapIpc.ts`) unwraps the standard `{ success, error? }` envelope.

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrapIpc } from "@/shared/api/unwrapIpc";

// ── Query key constants (co-locate with the hooks that use them) ──────────────
export const MODULE_KEYS = {
  all: ["myModule"] as const,
  detail: (id: number) => ["myModule", id] as const,
};

// ── Read ──────────────────────────────────────────────────────────────────────
export function useModuleListQuery() {
  return useQuery({
    queryKey: MODULE_KEYS.all,
    queryFn: () =>
      unwrapIpc(window.api.myModule.getAll(), (r) => r.items ?? []),
  });
}

// ── Write ─────────────────────────────────────────────────────────────────────
export function useCreateModuleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateData) =>
      unwrapIpc(window.api.myModule.create(data), (r) => r.item),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MODULE_KEYS.all });
    },
  });
}
```

**Usage in a component:**

```typescript
const { data: items = [], isLoading, isError, refetch } = useModuleListQuery();
const create = useCreateModuleMutation();

// trigger: create.mutate(payload)
// loading: create.isPending
```

`QueryClientProvider` is already wired in `App.tsx` with IPC-appropriate defaults (`retry: false`, `refetchOnWindowFocus: false`, `staleTime: 30_000`). New features should follow this pattern; old pages can be migrated as they are touched.

### Frontend Commands

```bash
yarn workspace @liratek/frontend typecheck
yarn workspace @liratek/frontend lint
yarn workspace @liratek/frontend test
yarn workspace @liratek/frontend test:coverage
```

---

## Area: DevOps (`.github/workflows/`)

- **CI** (`ci.yml`): runs on PRs → install → lint → typecheck → backend-tests → frontend-tests → build
- **Release** (`build.yml`): triggered by `v*` tags or manual → tests → draft release → build Windows → publish
- **Node version**: 20, **Yarn**: via corepack
- **Required secrets**: `UPDATE_TOKEN` (auto-update auth), `GH_TOKEN` (auto-provided)
- Always use `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` in env
- Always use draft releases; publish only after build artifacts are uploaded
- Use concurrency control: `group: ci-${{ github.ref }}` with `cancel-in-progress: true`

**Release flow:**

```bash
git tag v1.X.X
git push origin v1.X.X
# CI/CD handles the rest automatically
```

---

## Full Module Addition Checklist

When adding a new feature module, complete every step:

### Database

- [ ] Create migration in `packages/core/src/db/migrations/index.ts` (increment version)
- [ ] Add `down()` rollback function
- [ ] Register in `modules` table
- [ ] Add to `currency_modules` (USD & LBP)
- [ ] Add to `currency_drawers` (if cash-handling)
- [ ] Update `electron-app/create_db.sql` (same schema + migration entry)

### Backend

- [ ] Create `packages/core/src/repositories/{Module}Repository.ts`
- [ ] Create `packages/core/src/services/{Module}Service.ts`
- [ ] Export from `repositories/index.ts`
- [ ] Export from `services/index.ts`
- [ ] Use module-specific logger

### Electron

- [ ] Create `electron-app/handlers/{module}Handlers.ts`
- [ ] Add `requireRole()` auth checks
- [ ] Return `{ success, data?, error? }` from all handlers
- [ ] Add bindings in `electron-app/preload.ts`
- [ ] Register in `electron-app/main.ts`

### Frontend

- [ ] Create `frontend/src/features/{module}/pages/{Module}/index.tsx`
- [ ] Add route in `frontend/src/app/App.tsx`
- [ ] Add TypeScript types in `frontend/src/types/electron.d.ts`
- [ ] Handle loading, error, and empty states

### Quality Gates (run before marking done)

- [ ] `cd packages/core && npm run build`
- [ ] `yarn typecheck`
- [ ] `yarn lint`
- [ ] `yarn workspace @liratek/backend test`
- [ ] `yarn workspace @liratek/frontend test`
- [ ] `yarn build`
- [ ] `yarn dev` (manual smoke test)

---

## Active Modules

`pos`, `debts`, `inventory`, `clients`, `exchange`, `omt_whish`, `recharge`, `loto`, `expenses`, `maintenance`, `custom_services`, `closing`, `profits`

---

## Key Reference Files

| What                                       | Where                                                      |
| ------------------------------------------ | ---------------------------------------------------------- |
| Money rules & feature checklist            | `docs/FEATURE_GUIDE.md`                                    |
| Dual-transport (desktop+web) status & shim | `docs/plans/todo_plans/WEB_PARITY_ROADMAP.md`              |
| Dual-mode API adapter                      | `frontend/src/api/backendApi.ts` + `ElectronApiAdapter.ts` |
| E2E suite index & conventions              | `frontend/tests/e2e-electron/README.md`                    |
| Repository example                         | `packages/core/src/repositories/SalesRepository.ts`        |
| Service example                            | `packages/core/src/services/SalesService.ts`               |
| IPC handler example                        | `electron-app/handlers/salesHandlers.ts`                   |
| Preload bindings                           | `electron-app/preload.ts`                                  |
| TypeScript types                           | `frontend/src/types/electron.d.ts`                         |
| Page example                               | `frontend/src/features/loto/pages/Loto/index.tsx`          |
| Routes                                     | `frontend/src/app/App.tsx`                                 |
| Migrations                                 | `packages/core/src/db/migrations/index.ts`                 |
| Fresh schema                               | `electron-app/create_db.sql`                               |
| DB connection                              | `packages/core/src/db/connection.ts`                       |
| Loggers                                    | `packages/core/src/utils/logger.ts`                        |
| CI workflow                                | `.github/workflows/ci.yml`                                 |
| Build workflow                             | `.github/workflows/build.yml`                              |

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
