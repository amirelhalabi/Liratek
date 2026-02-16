# Module Management Guide

How modules work in the system, and what to change when adding or removing one.

---

## Module Schema

The `modules` table (`create_db.sql` line 488):

| Column       | Type    | Description                                       |
| ------------ | ------- | ------------------------------------------------- |
| `key`        | TEXT PK | Unique identifier, e.g. `pos`, `omt_whish`        |
| `label`      | TEXT    | Display name shown in the sidebar                 |
| `icon`       | TEXT    | Lucide icon name, e.g. `ShoppingCart`             |
| `route`      | TEXT    | React Router path, e.g. `/pos`                    |
| `sort_order` | INTEGER | Controls sidebar ordering (lower = higher)        |
| `is_enabled` | INTEGER | 1 = visible in sidebar, 0 = hidden                |
| `admin_only` | INTEGER | 1 = only admin users see it                       |
| `is_system`  | INTEGER | 1 = cannot be disabled (dashboard, closing, etc.) |

### Current Modules

**System (non-toggleable):**

| Key         | Route       | sort_order |
| ----------- | ----------- | ---------- |
| `dashboard` | `/`         | 0          |
| `closing`   | _(empty)_   | 99         |
| `settings`  | `/settings` | 100        |

**Toggleable:**

| Key           | Label         | Icon         | Route           | sort_order |
| ------------- | ------------- | ------------ | --------------- | ---------- |
| `analytics`   | Analytics     | TrendingUp   | `/commissions`  | 1          |
| `pos`         | Point of Sale | ShoppingCart | `/pos`          | 2          |
| `debts`       | Debts         | BookOpen     | `/debts`        | 3          |
| `inventory`   | Inventory     | Package      | `/products`     | 4          |
| `clients`     | Clients       | Users        | `/clients`      | 5          |
| `exchange`    | Exchange      | RefreshCw    | `/exchange`     | 6          |
| `omt_whish`   | OMT/Whish     | Send         | `/services`     | 7          |
| `recharge`    | Recharge      | Smartphone   | `/recharge`     | 8          |
| `expenses`    | Expenses      | Banknote     | `/expenses`     | 9          |
| `maintenance` | Maintenance   | Wrench       | `/maintenance`  | 10         |
| `binance`     | Binance       | Bitcoin      | `/binance`      | 11         |
| `ipec_katch`  | IPEC/Katch    | Zap          | `/ikw-services` | 12         |

---

## Related Tables

Modules are referenced by several tables. Understanding these relationships is **critical** before adding or removing a module.

### 1. `currency_modules` (many-to-many)

Controls which currencies are available in each module.

```
currency_modules
├── currency_code → currencies(code) ON DELETE CASCADE
└── module_key    → modules(key)     ON DELETE CASCADE
```

- **Adding a module**: insert rows for every currency the module should support.
- **Removing a module**: rows are automatically deleted by CASCADE.

### 2. `suppliers` (optional FK)

Links system suppliers (OMT, Whish, IPEC, Katch) to their parent module.

```
suppliers.module_key → modules(key) ON DELETE SET NULL
```

- **Adding a module**: if it has providers/suppliers, insert them with `module_key` and `provider` set.
- **Removing a module**: the FK is set to NULL (supplier record survives, but loses its module link).

### 3. `drawer_balances` (no FK — implicit by naming)

Each module that handles money typically has its own drawer(s). There is **no foreign key** from drawers to modules — the link is by convention (e.g. the `Binance` drawer belongs to the `binance` module).

| Module      | Drawer(s)                               |
| ----------- | --------------------------------------- |
| pos / debts | `General`                               |
| omt_whish   | `OMT_System`, `Whish_System`            |
| recharge    | `MTC`, `Alfa`                           |
| binance     | `Binance`                               |
| ipec_katch  | `IPEC`, `Katch`, `Whish_App`, `OMT_App` |

- **Adding a module**: insert `drawer_balances` rows for each (drawer_name, currency_code) pair.
- **Removing a module**: drawer rows are **NOT** auto-cleaned. Delete them manually or leave them as orphans.

### 4. `currency_drawers` (maps currencies to drawers)

Determines which currencies appear in each drawer on the Closing screen.

- **Adding a module with drawers**: insert `currency_drawers` rows to match the `drawer_balances` entries.
- **Removing a module**: no FK cascade, clean up manually.

### 5. `payment_methods` (optional)

If a module introduces a new payment method (e.g. `OMT` → `OMT_App` drawer, `BINANCE` → `Binance` drawer):

- **Adding**: insert a `payment_methods` row with the correct `drawer_name`.
- **Removing**: no FK cascade, clean up manually.

---

## Checklist: Adding a New Module

### Database (`create_db.sql` for fresh installs)

1. **`modules` table** — add an `INSERT OR IGNORE` with key, label, icon, route, sort_order
2. **`currency_modules`** — add currency mappings (which currencies does this module use?)
3. **`drawer_balances`** — if the module has its own drawer(s), seed initial balances
4. **`currency_drawers`** — map currencies to the new drawer(s)
5. **`payment_methods`** — if the module introduces a payment method, insert it
6. **`suppliers`** — if the module has system suppliers/providers, insert them with `module_key` and `provider`

### Migration (for existing databases)

7. **New migration** in `packages/core/src/db/migrations/index.ts` — replicate all the INSERTs above so existing users get the new module on upgrade. Bump the version number.

### Backend

8. **API routes** — create `backend/src/api/<module>.ts` with Express routes; register in `backend/src/server.ts`

### Core (packages/core)

9. **Repository** — create `packages/core/src/repositories/<Module>Repository.ts` with database operations
10. **Service** — create `packages/core/src/services/<Module>Service.ts` as the business logic layer

### Electron

11. **IPC handler** — create `electron-app/handlers/<module>Handlers.ts`; register in the handler setup
12. **Preload** — expose IPC channels in `electron-app/preload.ts` under a new namespace

### Frontend

13. **TypeScript types** — add the preload API shape to `frontend/src/types/electron.d.ts`
14. **API adapter** — add functions to `frontend/src/api/backendApi.ts` (dual Electron + HTTP mode)
15. **Page component** — create `frontend/src/features/<module>/pages/<Module>/index.tsx`
16. **Route** — add a `<Route>` in `frontend/src/app/App.tsx`
17. **Sidebar icon** — add the Lucide icon to the `iconMap` in `frontend/src/shared/components/layouts/Sidebar.tsx`

### Optional

18. **Logger** — add a child logger in `packages/core/src/utils/logger.ts` if needed
19. **CurrencySelect integration** — if the module uses `CurrencySelect`, pass `moduleKey` prop so only enabled currencies appear
20. **Settings UI** — the module automatically appears in Settings > Modules once inserted into the `modules` table

---

## Checklist: Removing a Module

### Automatic (FK cascades)

- `currency_modules` rows → **deleted automatically** (ON DELETE CASCADE)
- `suppliers.module_key` → **set to NULL** (ON DELETE SET NULL)

### Manual Cleanup Required

1. **`drawer_balances`** — delete rows for the module's drawers (no FK)
2. **`currency_drawers`** — delete rows for the module's drawers (no FK)
3. **`payment_methods`** — delete any payment methods tied to the module's drawers (no FK)
4. **`suppliers`** — decide whether to delete or keep the supplier records (they'll have `module_key = NULL`)
5. **Frontend route** — remove the `<Route>` from `App.tsx` (routes are static, so the URL still works even if the module row is deleted)
6. **Sidebar icon** — remove from `iconMap` in `Sidebar.tsx`
7. **Migration** — write a migration that performs the DELETE + cleanup for existing databases
8. **Code cleanup** — remove the handler, service, repository, API routes, preload bindings, type definitions, and page component

> **Note:** Disabling a module (setting `is_enabled = 0`) only hides the sidebar link. The route remains accessible if navigated to directly. To fully block access, remove the `<Route>` or add a guard.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     modules table                       │
│  key | label | icon | route | sort_order | is_enabled   │
└───────┬──────────────────────┬──────────────────────────┘
        │                      │
        │ ON DELETE CASCADE    │ ON DELETE SET NULL
        ▼                      ▼
┌───────────────────┐  ┌───────────────────┐
│ currency_modules  │  │    suppliers       │
│ currency_code, PK │  │ module_key (FK)    │
│ module_key    (FK)│  │ provider           │
└───────────────────┘  │ is_system          │
                       └───────────────────┘

 No FK (implicit by naming convention):
┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐
│ drawer_balances   │  │ currency_drawers  │  │ payment_methods   │
│ drawer_name       │  │ drawer_name       │  │ drawer_name       │
│ currency_code     │  │ currency_code     │  │ code, label       │
│ balance           │  │                   │  │ affects_drawer     │
└───────────────────┘  └───────────────────┘  └───────────────────┘
```

---

## Code Layer Map

| Layer            | Location                                             | Role                                      |
| ---------------- | ---------------------------------------------------- | ----------------------------------------- |
| DB Schema        | `electron-app/create_db.sql`                         | Table definitions + seed data             |
| Migrations       | `packages/core/src/db/migrations/index.ts`           | Schema changes for existing databases     |
| Repository       | `packages/core/src/repositories/`                    | Raw SQL queries                           |
| Service          | `packages/core/src/services/`                        | Business logic + validation               |
| IPC Handler      | `electron-app/handlers/`                             | Electron main-process handlers            |
| Preload          | `electron-app/preload.ts`                            | IPC bridge to renderer                    |
| Type Definitions | `frontend/src/types/electron.d.ts`                   | TypeScript types for preload API          |
| API Adapter      | `frontend/src/api/backendApi.ts`                     | Dual-mode (Electron IPC / HTTP) functions |
| Backend API      | `backend/src/api/`                                   | Express routes (HTTP mode)                |
| Backend Server   | `backend/src/server.ts`                              | Route registration                        |
| Page Component   | `frontend/src/features/<module>/pages/`              | React UI                                  |
| Routing          | `frontend/src/app/App.tsx`                           | Static `<Route>` declarations             |
| Sidebar          | `frontend/src/shared/components/layouts/Sidebar.tsx` | Icon map + nav link generation            |
| Module Context   | `frontend/src/contexts/ModuleContext.tsx`            | Provides `enabledModules` to the app      |
| Currency Context | `frontend/src/contexts/CurrencyContext.tsx`          | `getCurrenciesForModule(key)`             |
| Settings UI      | `frontend/src/features/settings/pages/Settings/`     | ModulesManager + CurrencyManager          |

---

## Common Patterns

### Module with drawers + suppliers (e.g. `omt_whish`)

```sql
-- 1. Module
INSERT OR IGNORE INTO modules (...) VALUES ('my_module', 'My Module', 'Icon', '/my-module', 13, 1, 0, 0);

-- 2. Currency mappings
INSERT OR IGNORE INTO currency_modules (currency_code, module_key) VALUES ('USD', 'my_module'), ('LBP', 'my_module');

-- 3. Drawers
INSERT OR IGNORE INTO drawer_balances (drawer_name, currency_code, balance) VALUES ('MyDrawer', 'USD', 0), ('MyDrawer', 'LBP', 0);
INSERT OR IGNORE INTO currency_drawers (currency_code, drawer_name) VALUES ('USD', 'MyDrawer'), ('LBP', 'MyDrawer');

-- 4. Payment method (optional)
INSERT OR IGNORE INTO payment_methods (code, label, drawer_name, affects_drawer, sort_order, is_system) VALUES ('MY_PAY', 'My Payment', 'MyDrawer', 1, 6, 0);

-- 5. Supplier (optional)
INSERT OR IGNORE INTO suppliers (name, module_key, provider, is_system) VALUES ('MyProvider', 'my_module', 'MY_PROVIDER', 1);
```

### Module without drawers (e.g. `inventory`, `clients`)

Only steps 1 and 2 from above are needed. These modules use the `General` drawer via CASH payment.

### Key Gotcha

Module keys are **plain strings** throughout the codebase — there is no TypeScript enum or constant array defining all valid keys. Search for the key string across the codebase when adding or removing to catch all references.
