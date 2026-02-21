# Backend Differences: Desktop (Electron) vs Web (Express)

**Scope**: Compare the "desktop backend" (`electron-app/`) with the "web backend" (`backend/`).

- **Desktop backend** runs inside Electron (main process) and exposes an IPC API to the renderer via `window.api`.
- **Web backend** runs as an Express server and exposes a REST API under `/api/*`.

This document is an **exhaustive inventory** of differences, plus explanations of why they matter.

---

## 1) Architecture Overview

### Desktop (Electron)

Data flow:

`frontend (renderer)` → `window.api` (`electron-app/preload.ts`) → `ipcMain` handlers (`electron-app/handlers/*`) → services (`electron-app/services/*`) → repositories (`electron-app/database/repositories/*`) → SQLite.

### Web (Express)

Data flow:

`frontend (browser)` → `HTTP /api/*` (`backend/src/api/*`) → services (`backend/src/services/*`) → repositories (`backend/src/database/repositories/*`) → SQLite.

---

## 2) DB Path Resolution (Critical Operational Difference)

Both modes must point to the same SQLite file.

**Resolution order (both desktop and web):**

1. `DATABASE_PATH` environment variable
2. `~/Documents/LiraTek/db-path.txt` (user-local config file)
3. macOS fallback: `~/Library/Application Support/liratek/phone_shop.db`

### Why Application Support folders still exist

Electron will always create Application Support directories for caches and runtime data. This is normal and not controllable.

---

## 3) Schema Bootstrap

Both backends bootstrap schema by checking for the `users` table. If missing, they run:

- `electron-app/create_db.sql`

Desktop additionally attempts to seed an admin user if missing.

---

## 4) Authentication & Password Hashing

### Desktop reference

- Uses scrypt hash format: `SCRYPT:<salt_hex>:<hash_hex>`
- Implemented in: `electron-app/utils/crypto.ts`

### Web

- Login endpoint uses `AuthService` so it can verify the same scrypt format.
- Implemented in: `backend/src/api/auth.ts` and `backend/src/utils/crypto.ts`

**Impact:** If web login uses bcrypt while desktop uses scrypt, the same DB will not allow login in one mode.

---

## 5) Debt Calculations (USD + LBP conversion)

### Desktop reference (`electron-app/database/repositories/DebtRepository.ts`)

- Totals include both USD and LBP converted to USD using `exchange_rates` (USD→LBP).

Formula:

- `total = ROUND(SUM(amount_usd) + SUM(amount_lbp) / rate, 2)`

### Web (`backend/src/database/repositories/DebtRepository.ts`)

- Updated to match desktop logic.

---

## 6) Repayments, Payments table, Drawer Balances

Desktop has advanced repayment logic:

- Separates **debt reduction** from **actual paid** amounts
- Writes to:
  - `payments`
  - `drawer_balances`

Web currently writes repayment only to `debt_ledger` (unless explicitly ported).

---

## 7) Payload Shape Differences (camelCase vs snake_case)

Desktop IPC payloads commonly use camelCase (e.g. `clientId`).
Web REST payloads often use snake_case (e.g. `client_id`).

Backends should normalize payloads where needed (example: debts repayments endpoint).

---

## 8) Feature Parity Notes

Some features are inherently easier in Electron (filesystem, PDF printing, auto-updater) and are limited or placeholder in the web backend.

---

## 9) Exhaustive Diff Inventory

The sections below list every file that differs between the desktop backend and the web backend, grouped by area.

> Tip: You can regenerate these lists locally via:
>
> - `diff -qr electron-app/services backend/src/services`
> - `diff -qr electron-app/database/repositories backend/src/database/repositories`
> - `diff -qr electron-app/utils backend/src/utils`
> - `diff -qr electron-app/handlers backend/src/api`

### 9.1 Services (electron-app/services vs backend/src/services)

- DIFF: `electron-app/services/ActivityService.ts` vs `backend/src/services/ActivityService.ts`
- DIFF: `electron-app/services/AuthService.ts` vs `backend/src/services/AuthService.ts`
- DIFF: `electron-app/services/ClientService.ts` vs `backend/src/services/ClientService.ts`
- DIFF: `electron-app/services/ClosingService.ts` vs `backend/src/services/ClosingService.ts`
- DIFF: `electron-app/services/CurrencyService.ts` vs `backend/src/services/CurrencyService.ts`
- DIFF: `electron-app/services/DebtService.ts` vs `backend/src/services/DebtService.ts`
- DIFF: `electron-app/services/ExchangeService.ts` vs `backend/src/services/ExchangeService.ts`
- DIFF: `electron-app/services/ExpenseService.ts` vs `backend/src/services/ExpenseService.ts`
- DIFF: `electron-app/services/FinancialService.ts` vs `backend/src/services/FinancialService.ts`
- DIFF: `electron-app/services/InventoryService.ts` vs `backend/src/services/InventoryService.ts`
- DIFF: `electron-app/services/MaintenanceService.ts` vs `backend/src/services/MaintenanceService.ts`
- DIFF: `electron-app/services/RateService.ts` vs `backend/src/services/RateService.ts`
- DIFF: `electron-app/services/RechargeService.ts` vs `backend/src/services/RechargeService.ts`
- DIFF: `electron-app/services/ReportService.ts` vs `backend/src/services/ReportService.ts`
- DIFF: `electron-app/services/SalesService.ts` vs `backend/src/services/SalesService.ts`
- DIFF: `electron-app/services/SettingsService.ts` vs `backend/src/services/SettingsService.ts`
- DIFF: `electron-app/services/SupplierService.ts` vs `backend/src/services/SupplierService.ts`
- DIFF: `electron-app/services/__tests__/ActivityService.test.ts` vs `backend/src/services/__tests__/ActivityService.test.ts`
- DIFF: `electron-app/services/__tests__/AuthService.test.ts` vs `backend/src/services/__tests__/AuthService.test.ts`
- DIFF: `electron-app/services/__tests__/ClientService.test.ts` vs `backend/src/services/__tests__/ClientService.test.ts`
- DIFF: `electron-app/services/__tests__/ClosingService.test.ts` vs `backend/src/services/__tests__/ClosingService.test.ts`
- DIFF: `electron-app/services/__tests__/CurrencyService.test.ts` vs `backend/src/services/__tests__/CurrencyService.test.ts`
- DIFF: `electron-app/services/__tests__/DebtService.test.ts` vs `backend/src/services/__tests__/DebtService.test.ts`
- DIFF: `electron-app/services/__tests__/ExchangeService.test.ts` vs `backend/src/services/__tests__/ExchangeService.test.ts`
- DIFF: `electron-app/services/__tests__/ExpenseService.test.ts` vs `backend/src/services/__tests__/ExpenseService.test.ts`
- DIFF: `electron-app/services/__tests__/FinancialService.test.ts` vs `backend/src/services/__tests__/FinancialService.test.ts`
- DIFF: `electron-app/services/__tests__/InventoryService.test.ts` vs `backend/src/services/__tests__/InventoryService.test.ts`
- DIFF: `electron-app/services/__tests__/MaintenanceService.test.ts` vs `backend/src/services/__tests__/MaintenanceService.test.ts`
- DIFF: `electron-app/services/__tests__/RateService.test.ts` vs `backend/src/services/__tests__/RateService.test.ts`
- DIFF: `electron-app/services/__tests__/RechargeService.test.ts` vs `backend/src/services/__tests__/RechargeService.test.ts`
- DIFF: `electron-app/services/__tests__/ReportService.test.ts` vs `backend/src/services/__tests__/ReportService.test.ts`
- DIFF: `electron-app/services/__tests__/SalesService.test.ts` vs `backend/src/services/__tests__/SalesService.test.ts`
- DIFF: `electron-app/services/__tests__/SettingsService.test.ts` vs `backend/src/services/__tests__/SettingsService.test.ts`
- DIFF: `electron-app/services/index.ts` vs `backend/src/services/index.ts`

### 9.2 Database Repositories (electron-app/database/repositories vs backend/src/database/repositories)

- DIFF: `electron-app/database/repositories/ActivityRepository.ts` vs `backend/src/database/repositories/ActivityRepository.ts`
- DIFF: `electron-app/database/repositories/BaseRepository.ts` vs `backend/src/database/repositories/BaseRepository.ts`
- DIFF: `electron-app/database/repositories/ClientRepository.ts` vs `backend/src/database/repositories/ClientRepository.ts`
- DIFF: `electron-app/database/repositories/ClosingRepository.ts` vs `backend/src/database/repositories/ClosingRepository.ts`
- DIFF: `electron-app/database/repositories/CurrencyRepository.ts` vs `backend/src/database/repositories/CurrencyRepository.ts`
- DIFF: `electron-app/database/repositories/DebtRepository.ts` vs `backend/src/database/repositories/DebtRepository.ts`
- DIFF: `electron-app/database/repositories/ExchangeRepository.ts` vs `backend/src/database/repositories/ExchangeRepository.ts`
- DIFF: `electron-app/database/repositories/ExpenseRepository.ts` vs `backend/src/database/repositories/ExpenseRepository.ts`
- DIFF: `electron-app/database/repositories/FinancialRepository.ts` vs `backend/src/database/repositories/FinancialRepository.ts`
- DIFF: `electron-app/database/repositories/FinancialServiceRepository.ts` vs `backend/src/database/repositories/FinancialServiceRepository.ts`
- DIFF: `electron-app/database/repositories/MaintenanceRepository.ts` vs `backend/src/database/repositories/MaintenanceRepository.ts`
- DIFF: `electron-app/database/repositories/ProductRepository.ts` vs `backend/src/database/repositories/ProductRepository.ts`
- DIFF: `electron-app/database/repositories/RateRepository.ts` vs `backend/src/database/repositories/RateRepository.ts`
- DIFF: `electron-app/database/repositories/RechargeRepository.ts` vs `backend/src/database/repositories/RechargeRepository.ts`
- DIFF: `electron-app/database/repositories/SalesRepository.ts` vs `backend/src/database/repositories/SalesRepository.ts`
- DIFF: `electron-app/database/repositories/SettingsRepository.ts` vs `backend/src/database/repositories/SettingsRepository.ts`
- DIFF: `electron-app/database/repositories/SupplierRepository.ts` vs `backend/src/database/repositories/SupplierRepository.ts`
- DIFF: `electron-app/database/repositories/UserRepository.ts` vs `backend/src/database/repositories/UserRepository.ts`
- DIFF: `electron-app/database/repositories/__tests__/BaseRepository.test.ts` vs `backend/src/database/repositories/__tests__/BaseRepository.test.ts`
- DIFF: `electron-app/database/repositories/__tests__/ClientRepository.test.ts` vs `backend/src/database/repositories/__tests__/ClientRepository.test.ts`
- DIFF: `electron-app/database/repositories/__tests__/SalesRepository.test.ts` vs `backend/src/database/repositories/__tests__/SalesRepository.test.ts`
- DIFF: `electron-app/database/repositories/index.ts` vs `backend/src/database/repositories/index.ts`

### 9.3 Utils (electron-app/utils vs backend/src/utils)

- DIFF: `electron-app/utils/index.ts` vs `backend/src/utils/index.ts`
- DIFF: `electron-app/utils/logger.ts` vs `backend/src/utils/logger.ts`

### 9.4 IPC Handlers vs REST API routes

Desktop IPC handlers live in:
Web REST routes live in:

- ONLY: `backend/src/api` → `activity.ts`
- ONLY: `backend/src/api` → `auth.ts`
- ONLY: `backend/src/api` → `clients.ts`
- ONLY: `backend/src/api` → `closing.ts.bak`
- ONLY: `backend/src/api` → `closing.ts`
- ONLY: `backend/src/api` → `currencies.ts`
- ONLY: `backend/src/api` → `dashboard.ts`
- ONLY: `backend/src/api` → `debts.ts`
- ONLY: `backend/src/api` → `exchange.ts`
- ONLY: `backend/src/api` → `expenses.ts`
- ONLY: `backend/src/api` → `inventory.ts`
- ONLY: `backend/src/api` → `maintenance.ts`
- ONLY: `backend/src/api` → `rates.ts.bak`
- ONLY: `backend/src/api` → `rates.ts`
- ONLY: `backend/src/api` → `recharge.ts`
- ONLY: `backend/src/api` → `reports.ts.bak`
- ONLY: `backend/src/api` → `reports.ts`
- ONLY: `backend/src/api` → `sales.ts`
- ONLY: `backend/src/api` → `services.ts`
- ONLY: `backend/src/api` → `settings.ts`
- ONLY: `backend/src/api` → `suppliers.ts.bak`
- ONLY: `backend/src/api` → `suppliers.ts`
- ONLY: `backend/src/api` → `users.ts.bak`
- ONLY: `backend/src/api` → `users.ts`
- ONLY: `backend/src/api` → `ws-debug.ts`
- ONLY: `electron-app/handlers` → `__tests__`
- ONLY: `electron-app/handlers` → `authHandlers.ts`
- ONLY: `electron-app/handlers` → `clientHandlers.ts`
- ONLY: `electron-app/handlers` → `currencyHandlers.ts`
- ONLY: `electron-app/handlers` → `dbHandlers.ts`
- ONLY: `electron-app/handlers` → `debtHandlers.ts`
- ONLY: `electron-app/handlers` → `exchangeHandlers.ts`
- ONLY: `electron-app/handlers` → `financialHandlers.ts`
- ONLY: `electron-app/handlers` → `inventoryHandlers.ts`
- ONLY: `electron-app/handlers` → `maintenanceHandlers.ts`
- ONLY: `electron-app/handlers` → `omtHandlers.ts`
- ONLY: `electron-app/handlers` → `rateHandlers.ts`
- ONLY: `electron-app/handlers` → `rechargeHandlers.ts`
- ONLY: `electron-app/handlers` → `reportHandlers.ts`
- ONLY: `electron-app/handlers` → `salesHandlers.ts`
- ONLY: `electron-app/handlers` → `supplierHandlers.ts`
- ONLY: `electron-app/handlers` → `updaterHandlers.ts`

#### Desktop IPC handler files

- `electron-app/handlers/authHandlers.ts`
- `electron-app/handlers/clientHandlers.ts`
- `electron-app/handlers/currencyHandlers.ts`
- `electron-app/handlers/dbHandlers.ts`
- `electron-app/handlers/debtHandlers.ts`
- `electron-app/handlers/exchangeHandlers.ts`
- `electron-app/handlers/financialHandlers.ts`
- `electron-app/handlers/inventoryHandlers.ts`
- `electron-app/handlers/maintenanceHandlers.ts`
- `electron-app/handlers/omtHandlers.ts`
- `electron-app/handlers/rateHandlers.ts`
- `electron-app/handlers/rechargeHandlers.ts`
- `electron-app/handlers/reportHandlers.ts`
- `electron-app/handlers/salesHandlers.ts`
- `electron-app/handlers/supplierHandlers.ts`
- `electron-app/handlers/updaterHandlers.ts`

#### Web REST route files

- `backend/src/api/activity.ts`
- `backend/src/api/auth.ts`
- `backend/src/api/clients.ts`
- `backend/src/api/closing.ts`
- `backend/src/api/currencies.ts`
- `backend/src/api/dashboard.ts`
- `backend/src/api/debts.ts`
- `backend/src/api/exchange.ts`
- `backend/src/api/expenses.ts`
- `backend/src/api/inventory.ts`
- `backend/src/api/maintenance.ts`
- `backend/src/api/rates.ts`
- `backend/src/api/recharge.ts`
- `backend/src/api/reports.ts`
- `backend/src/api/sales.ts`
- `backend/src/api/services.ts`
- `backend/src/api/settings.ts`
- `backend/src/api/suppliers.ts`
- `backend/src/api/users.ts`
- `backend/src/api/ws-debug.ts`

#### Notes

- Desktop handlers register IPC channels on `ipcMain` (see `electron-app/main.ts`).
- Web routes register HTTP endpoints on Express router (see `backend/src/server.ts`).
- Names do not match 1:1: Desktop uses channels like `"debt:add-repayment"`, Web uses routes like `POST /api/debts/repayments`.

## 10) Module Parity Status (Desktop vs Web)

Legend:

- ✅ **Same**: user-visible behavior should match
- ⚠️ **Partial**: works in both, but logic/side-effects differ
- ❌ **Different**: feature is missing/placeholder in one mode

> This table focuses on _runtime behavior_ and _data correctness_, not just code diffs.

| Module               | Desktop (Electron)      |                             Web (Express) | Parity | Notes                                                                                                                 |
| -------------------- | ----------------------- | ----------------------------------------: | :----: | --------------------------------------------------------------------------------------------------------------------- |
| Auth                 | IPC (`auth:*`)          |                      REST (`/api/auth/*`) |   ⚠️   | Must share password hash format (SCRYPT). Web login now delegates to AuthService. Session persistence differs.        |
| Clients              | IPC (`clients:*`)       |                     REST (`/api/clients`) |   ⚠️   | CRUD should match; payload casing and validation may differ.                                                          |
| Inventory            | IPC (`inventory:*`)     |                   REST (`/api/inventory`) |   ⚠️   | Generally similar; verify stock update side-effects and soft-delete behavior.                                         |
| Sales / POS          | IPC (`sales:*`)         |                       REST (`/api/sales`) |   ⚠️   | Critical path: ensure payments/drawers side effects match.                                                            |
| Debts                | IPC (`debt:*`)          |                       REST (`/api/debts`) |   ⚠️   | Totals now include USD+LBP conversion in both. Repayment drawer/payments side-effects are richer on Desktop.          |
| Exchange             | IPC (`exchange:*`)      |                    REST (`/api/exchange`) |   ⚠️   | Verify column naming and history mapping; ensure same schema assumptions.                                             |
| Expenses             | IPC (`expenses:*`)      |                    REST (`/api/expenses`) |   ⚠️   | Should match; ensure currency handling consistent.                                                                    |
| Recharge             | IPC (`recharge:*`)      |                    REST (`/api/recharge`) |   ⚠️   | Stock endpoints must match. Web may rely on backend availability; desktop is direct DB.                               |
| Services (OMT/Whish) | IPC (`omt:*`)           |                    REST (`/api/services`) |   ⚠️   | Analytics/history must match; web requires backend running.                                                           |
| Maintenance          | IPC (`maintenance:*`)   |                 REST (`/api/maintenance`) |   ⚠️   | Similar; ensure filters/status mapping match.                                                                         |
| Currencies           | IPC (`currencies:list`) |                  REST (`/api/currencies`) |   ✅   | Now routed via window.api in Electron; simple list.                                                                   |
| Rates                | IPC (`rates:*`)         |                       REST (`/api/rates`) |   ⚠️   | Should match; verify exchange_rates schema + defaults.                                                                |
| Settings             | IPC (`settings:*`)      |                    REST (`/api/settings`) |   ⚠️   | Electron uses dbHandlers/settings IPC. Web uses SettingsService. Some keys/shape may differ.                          |
| Closing / Opening    | IPC (`closing:*`)       |                     REST (`/api/closing`) |   ⚠️   | Historically table name mismatches (closing_amounts vs daily_closing_amounts) and schema drift. Needs careful parity. |
| Suppliers            | IPC (`suppliers:*`)     |                   REST (`/api/suppliers`) |   ⚠️   | Basic CRUD/ledger likely matches; ensure drawer integration parity.                                                   |
| Activity Logs        | IPC (`activity:*`)      |                    REST (`/api/activity`) |   ⚠️   | Web exists; desktop also exists. Query shape and filtering may differ.                                                |
| Reports / Backups    | IPC (`report:*`)        |                     REST (`/api/reports`) |   ❌   | Desktop can do filesystem/PDF; web has placeholders/limited features unless implemented.                              |
| Diagnostics          | IPC (`diagnostics:*`)   | REST (part of `/api/reports/diagnostics`) |   ❌   | Desktop has real DB checks; web currently placeholder.                                                                |
| Updater              | IPC (`updater:*`)       |                               REST (none) |   ❌   | Electron-only by design.                                                                                              |

### 10.1 Key Known Differences (module-by-module)

This section is **exhaustive**: every major module is listed with:

- Desktop behavior and code locations
- Web behavior and code locations
- Known differences that can cause mismatches

> Desktop reference files generally live under `electron-app/handlers/*`, `electron-app/services/*`, `electron-app/database/repositories/*`.
> Web files generally live under `backend/src/api/*`, `backend/src/services/*`, `backend/src/database/repositories/*`.

#### Auth

**Desktop**

- IPC: `auth:*` (see `electron-app/handlers/authHandlers.ts`)
- Service: `electron-app/services/AuthService.ts`
- Crypto: `electron-app/utils/crypto.ts` (SCRYPT format)
- Session storage: `electron-app/session.ts` (Electron runtime)

**Web**

- REST: `/api/auth/*` (see `backend/src/api/auth.ts`)
- Service: `backend/src/services/AuthService.ts`
- Crypto: `backend/src/utils/crypto.ts`

**Differences / Risks**

- Session model differs: Desktop can persist session via Electron runtime; Web uses JWT.
- Password hash compatibility must remain aligned (`SCRYPT:<salt>:<hash>`).

#### Clients

**Desktop**

- IPC: `clients:*` (`electron-app/handlers/clientHandlers.ts`)
- Service: `electron-app/services/ClientService.ts`
- Repo: `electron-app/database/repositories/ClientRepository.ts`

**Web**

- REST: `/api/clients` (`backend/src/api/clients.ts`)
- Service: `backend/src/services/ClientService.ts`
- Repo: `backend/src/database/repositories/ClientRepository.ts`

**Differences / Risks**

- Payload casing: Desktop often camelCase, Web often snake_case.
- Validation and error shapes may differ.

#### Inventory

**Desktop**

- IPC: `inventory:*` (`electron-app/handlers/inventoryHandlers.ts`)
- Service: `electron-app/services/InventoryService.ts`
- Repo: `electron-app/database/repositories/ProductRepository.ts`

**Web**

- REST: `/api/inventory` (`backend/src/api/inventory.ts`)
- Service: `backend/src/services/InventoryService.ts`
- Repo: `backend/src/database/repositories/ProductRepository.ts`

**Differences / Risks**

- Soft-delete semantics must match (e.g., `is_deleted` vs `is_active`).
- Stock decrement rules must match POS logic.

#### Sales / POS

**Desktop**

- IPC: `sales:*` (`electron-app/handlers/salesHandlers.ts`)
- Service: `electron-app/services/SalesService.ts`
- Repo: `electron-app/database/repositories/SalesRepository.ts`

**Web**

- REST: `/api/sales` (`backend/src/api/sales.ts`)
- Service: `backend/src/services/SalesService.ts`
- Repo: `backend/src/database/repositories/SalesRepository.ts`

**Differences / Risks**

- Side effects: payments / drawer balances may be more complete on Desktop.
- Draft handling and receipt formatting may diverge.

#### Debts

**Desktop (reference)**

- IPC: `debt:*` (`electron-app/handlers/debtHandlers.ts`)
- Service: `electron-app/services/DebtService.ts`
- Repo: `electron-app/database/repositories/DebtRepository.ts`
  - Totals include USD + (LBP/rate) using `exchange_rates`.
  - Repayments can write to `payments` + `drawer_balances`.

**Web**

- REST: `/api/debts` (`backend/src/api/debts.ts`)
- Service: `backend/src/services/DebtService.ts`
- Repo: `backend/src/database/repositories/DebtRepository.ts`

**Differences / Risks**

- Repayment side effects: Desktop updates drawers; Web may be ledger-only unless ported.
- Payload normalization required (we added it for repayments).

#### Exchange

**Desktop**

- IPC: `exchange:*` (`electron-app/handlers/exchangeHandlers.ts`)
- Service: `electron-app/services/ExchangeService.ts`
- Repo: `electron-app/database/repositories/ExchangeRepository.ts`

**Web**

- REST: `/api/exchange` (`backend/src/api/exchange.ts`)
- Service: `backend/src/services/ExchangeService.ts`
- Repo: `backend/src/database/repositories/ExchangeRepository.ts`

**Differences / Risks**

- Column naming/schema drift can cause mismatched history.
- Rate source should be consistent with `exchange_rates`.

#### Expenses

**Desktop**

- IPC: `expenses:*` (`electron-app/handlers/financialHandlers.ts` and/or expense handler channels)
- Service: `electron-app/services/ExpenseService.ts`
- Repo: `electron-app/database/repositories/ExpenseRepository.ts`

**Web**

- REST: `/api/expenses` (`backend/src/api/expenses.ts`)
- Service: `backend/src/services/ExpenseService.ts`
- Repo: `backend/src/database/repositories/ExpenseRepository.ts`

**Differences / Risks**

- Currency handling and drawer effects must match.

#### Recharge

**Desktop**

- IPC: `recharge:*` (`electron-app/handlers/rechargeHandlers.ts`)
- Service: `electron-app/services/RechargeService.ts`
- Repo: `electron-app/database/repositories/RechargeRepository.ts`

**Web**

- REST: `/api/recharge` (`backend/src/api/recharge.ts`)
- Service: `backend/src/services/RechargeService.ts`
- Repo: `backend/src/database/repositories/RechargeRepository.ts`

**Differences / Risks**

- Stock computation and provider naming must match.
- Some UI previously called REST when it should use IPC (fixed via frontend wrappers).

#### Services (OMT/Whish)

**Desktop**

- IPC: `omt:*` (`electron-app/handlers/omtHandlers.ts`)
- Service: `electron-app/services/FinancialService.ts`
- Repo: `electron-app/database/repositories/FinancialServiceRepository.ts`

**Web**

- REST: `/api/services` (`backend/src/api/services.ts`)
- Service: `backend/src/services/FinancialService.ts`
- Repo: `backend/src/database/repositories/FinancialServiceRepository.ts`

**Differences / Risks**

- Analytics calculation must match.
- Web requires backend process; desktop uses direct DB.

#### Maintenance

**Desktop**

- IPC: `maintenance:*` (`electron-app/handlers/maintenanceHandlers.ts`)
- Service: `electron-app/services/MaintenanceService.ts`
- Repo: `electron-app/database/repositories/MaintenanceRepository.ts`

**Web**

- REST: `/api/maintenance` (`backend/src/api/maintenance.ts`)
- Service: `backend/src/services/MaintenanceService.ts`
- Repo: `backend/src/database/repositories/MaintenanceRepository.ts`

**Differences / Risks**

- Status filtering values must match.

#### Currencies

**Desktop**

- IPC: `currencies:list` (`electron-app/handlers/currencyHandlers.ts`)
- Service: `electron-app/services/CurrencyService.ts`
- Repo: `electron-app/database/repositories/CurrencyRepository.ts`

**Web**

- REST: `/api/currencies` (`backend/src/api/currencies.ts`)
- Service: `backend/src/services/CurrencyService.ts`
- Repo: `backend/src/database/repositories/CurrencyRepository.ts`

**Differences / Risks**

- Generally low risk; should remain aligned.

#### Rates

**Desktop**

- IPC: `rates:*` (`electron-app/handlers/rateHandlers.ts`)
- Service: `electron-app/services/RateService.ts`
- Repo: `electron-app/database/repositories/RateRepository.ts`

**Web**

- REST: `/api/rates` (`backend/src/api/rates.ts`)
- Service: `backend/src/services/RateService.ts`
- Repo: `backend/src/database/repositories/RateRepository.ts`

**Differences / Risks**

- Defaults (e.g., 89000) must match; avoid hardcoding in only one backend.

#### Settings

**Desktop**

- IPC: `settings:*` (`electron-app/handlers/dbHandlers.ts`)
- Service: `electron-app/services/SettingsService.ts`
- Repo: `electron-app/database/repositories/SettingsRepository.ts`

**Web**

- REST: `/api/settings` (`backend/src/api/settings.ts`)
- Service: `backend/src/services/SettingsService.ts`
- Repo: `backend/src/database/repositories/SettingsRepository.ts`

**Differences / Risks**

- Response shape must match what UI expects.
- Desktop uses dbHandlers channels; Web uses REST.

#### Closing / Opening

**Desktop**

- IPC: `closing:*` (`electron-app/handlers/dbHandlers.ts`)
- Service: `electron-app/services/ClosingService.ts`
- Repo: `electron-app/database/repositories/ClosingRepository.ts`

**Web**

- REST: `/api/closing` (`backend/src/api/closing.ts`)
- Service: `backend/src/services/ClosingService.ts`
- Repo: `backend/src/database/repositories/ClosingRepository.ts`

**Differences / Risks**

- Schema drift can cause missing-table errors if DB not initialized.
- Table naming mismatches have occurred historically.

#### Suppliers

**Desktop**

- IPC: `suppliers:*` (`electron-app/handlers/supplierHandlers.ts`)
- Service: `electron-app/services/SupplierService.ts`
- Repo: `electron-app/database/repositories/SupplierRepository.ts`

**Web**

- REST: `/api/suppliers` (`backend/src/api/suppliers.ts`)
- Service: `backend/src/services/SupplierService.ts`
- Repo: `backend/src/database/repositories/SupplierRepository.ts`

**Differences / Risks**

- Drawer integration parity must be confirmed.

#### Activity Logs

**Desktop**

- IPC: `activity:*` (`electron-app/handlers/dbHandlers.ts`)
- Service: `electron-app/services/ActivityService.ts`
- Repo: `electron-app/database/repositories/ActivityRepository.ts`

**Web**

- REST: `/api/activity` (`backend/src/api/activity.ts`)
- Service: `backend/src/services/ActivityService.ts`
- Repo: `backend/src/database/repositories/ActivityRepository.ts`

**Differences / Risks**

- Filtering/limit defaults may differ.

#### Reports / Backups

**Desktop**

- IPC: `report:*` (`electron-app/handlers/reportHandlers.ts`)
- Service: `electron-app/services/ReportService.ts`

**Web**

- REST: `/api/reports` (`backend/src/api/reports.ts`)

**Differences / Risks**

- Desktop can access filesystem/PDF; Web may be placeholder.

#### Diagnostics

**Desktop**

- IPC: `diagnostics:*` (`electron-app/handlers/dbHandlers.ts`)

**Web**

- REST: partial/placeholder endpoints under reports

**Differences / Risks**

- Desktop has real DB checks; Web currently placeholder.

#### Updater

**Desktop**

- IPC: `updater:*` (`electron-app/handlers/updaterHandlers.ts`)

**Web**

- Not applicable (Electron-only feature)

**Differences / Risks**

- Electron-only by design.

---

## 11) QA Parity Checklist (Desktop vs Web)

Use this checklist after any backend change to ensure **Desktop and Web behave the same** when pointed at the same DB.

> Preconditions:
>
> - Desktop and Web are configured to use the same DB path (`DATABASE_PATH` or `~/Documents/LiraTek/db-path.txt`).
> - You test with the same user account (e.g., `admin`).

### 11.1 Authentication

- [ ] Desktop login works (`admin/admin123`)
- [ ] Web login works (`admin/admin123`)
- [ ] Role/permissions match (admin/staff)
- [ ] Token/session persistence:
  - [ ] Desktop session restore works (or expected behavior documented)
  - [ ] Web JWT `/api/auth/me` works

#### 11.1.1 Auth Parity Tests (detailed)

**Login:**

- Call `/api/auth/login` with `admin/admin123` → expect success
- Login in Electron with `admin/admin123` → expect success

**Change Password (admin):**

- In Web, change admin password to `Admin123!` using the UI
- Verify `/api/auth/login` works with new password and fails with old one
- In Desktop, login with `Admin123!` → must work using the same DB

**Create User:**

- In Web (Settings → Users), create `testuser1 / Test123!`
- Verify Web login works for `testuser1`
- Verify Desktop login works for `testuser1` (same credentials, same DB)

If any of these checks fail, investigate:

- Shared crypto in `packages/core/src/utils/crypto.ts`
- Shared AuthService in `packages/core/src/services/AuthService.ts`
- DB path configuration (must point to same file)

### 11.2 Dashboard

- [ ] Dashboard loads without errors in both modes
- [ ] Drawer balances match
- [ ] Debt summary numbers match
- [ ] Analytics charts match (where applicable)

### 11.3 Clients

- [ ] Create client in Desktop → appears in Web
- [ ] Update client in Web → reflected in Desktop
- [ ] Delete/deactivate behavior matches

### 11.4 Inventory

- [ ] Create product in Desktop → appears in Web
- [ ] Stock adjustments match
- [ ] IMEI-related fields behave consistently (if used)

### 11.5 Sales / POS

- [ ] Create sale in Desktop → appears in Web
- [ ] Create sale in Web → appears in Desktop
- [ ] Stock decrement matches
- [ ] Payments/drawer effects match (or differences documented)

### 11.6 Debts

- [ ] Debtors list totals match (Desktop vs Web)
- [ ] Client debt history matches (same rows)
- [ ] Debt total conversion matches (USD + LBP converted via exchange_rates)
- [ ] Repayment:
  - [ ] Same remaining debt in both modes after repayment
  - [ ] Drawer balances update correctly (desktop reference; web parity target)

### 11.7 Exchange

- [ ] Transactions list matches
- [ ] Rates applied match

### 11.8 Expenses

- [ ] Expenses list matches
- [ ] Currency behavior matches

### 11.9 Recharge

- [ ] Stock loads in both modes
- [ ] Processing recharge updates stock the same way

### 11.10 Services (OMT/Whish)

- [ ] History loads in both modes
- [ ] Analytics loads in both modes

### 11.11 Maintenance

- [ ] Job list matches
- [ ] Status filters behave the same

### 11.12 Settings

- [ ] Settings load successfully in Desktop (IPC)
- [ ] Settings load successfully in Web (REST)
- [ ] Updating a setting in one mode is visible in the other

### 11.13 Closing / Opening

- [ ] Opening balances can be set
- [ ] Closing workflow completes
- [ ] Calculations match (expected vs physical)

### 11.14 Suppliers

- [ ] Suppliers list matches
- [ ] Ledger entries match

### 11.15 Activity Logs

- [ ] Recent activity matches

### 11.16 Reports / Diagnostics / Updater

- [ ] Desktop-only features work (PDF, backup, updater)
- [ ] Web behavior is explicitly documented (placeholder / not supported)

---

## 12) Consolidation Plan: One Shared Backend Core (Reduce Code Duplication)

### 12.1 Problem

The project currently maintains **two implementations** of the same domain logic:

- Desktop backend in `electron-app/` (services + repositories + utils)
- Web backend in `backend/src/` (services + repositories + utils)

This creates:

- Divergence risk (same feature behaves differently)
- Double maintenance effort
- Bugs like "same debt history but different totals"

### 12.2 Target Architecture

Create a **single shared core package** used by both Desktop and Web.

Proposed structure:

- `packages/core/` (new)
  - `src/database/` (connection + schema bootstrap)
  - `src/repositories/` (SQLite queries)
  - `src/services/` (business rules)
  - `src/utils/` (crypto, errors, logging)
  - `src/types/` (entities, DTOs)

Then:

- Desktop (`electron-app/`) depends on `packages/core`
  - keeps only Electron-specific pieces:
    - window creation
    - preload + IPC handlers
    - updater
    - filesystem/PDF features
- Web (`backend/`) depends on `packages/core`
  - keeps only web-specific pieces:
    - Express routes
    - JWT middleware
    - CORS

### 12.3 Migration Strategy (Incremental, Low Risk)

**Step 1: Extract pure logic first**

- Move/duplicate (temporarily) only code with no Electron or Express dependencies:
  - repositories
  - services
  - crypto utils
  - error utilities

**Step 2: Make DB path resolution shared**

- Put DB resolver (DATABASE_PATH + db-path.txt) into `packages/core`.
- Both desktop and web import the same resolver.

**Step 3: Adopt core in Desktop**

- Update `electron-app/services/*` to import from `packages/core/services/*`.
- Update IPC handlers to call core services.

**Step 4: Adopt core in Web**

- Update `backend/src/services/*` to import from `packages/core/services/*`.
- Keep REST handlers thin.

**Step 5: Delete duplicated services/repos**

- After both modes use the core package, delete:
  - `electron-app/services/*` (except Electron-only)
  - `backend/src/services/*` (except server integration)
  - duplicated repositories

### 12.4 What must remain separate (by design)

**Electron-only:**

- updater
- filesystem-based PDF generation
- OS integrations
- session encryption via Electron APIs

**Web-only:**

- REST routing layer
- CORS
- JWT middleware

### 12.5 Benefits

- One source of truth for business logic
- No parity drift between Desktop and Web
- Smaller repo and less maintenance
- Easier testing: one test suite can validate both modes

---

## 13) Recommended Next Work (to reduce divergence)

1. **Consolidate core logic** using section 12 plan (start with Debts and Auth).
2. **Enforce parity** by running checklist in section 11 whenever logic changes.
3. Add integration tests that run against the same DB path.
