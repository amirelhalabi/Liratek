# 🛍️ Liratek - Corner Tech POS Management System

A modern, desktop-based Point of Sale (POS) and inventory management system built with Electron, React, and SQLite. Designed for mobile phone and electronics retail shops.

---

## 📋 Quick Reference

| Section           | Details                                                               |
| ----------------- | --------------------------------------------------------------------- |
| **Tech Stack**    | React 19, TypeScript, Electron 39, Better SQLite3, Tailwind CSS, Vite |
| **Entry Points**  | Frontend: `src/main.tsx` \| Desktop: `electron/main.ts`               |
| **Database**      | `~/Library/Application Support/liratek/phone_shop.db`                 |
| **Default Login** | `admin` / `admin123`                                                  |
| **Exchange Rate** | 1 USD = 89,000 LBP (constant in `src/config/constants.ts`)            |

---

## 🚀 Getting Started

```bash
# Install dependencies
yarn install

# Development (Vite + Electron with hot reload)
yarn dev

# Build frontend + electron
yarn build

# Build macOS DMG (Apple Silicon)
yarn build:mac

# Build Windows EXE
yarn build:app

# Run tests
yarn test

# Lint code
yarn lint

# Reset sales & debts (preserves customers & inventory)
yarn reset:sales-debt
```

### Build Outputs

After building, installers are located in the `release/` folder:

- **macOS**: `LiraTek-{version}-arm64.dmg`
- **Windows**: `LiraTek-{version}-x64.exe`

### Creating a Release

Push a version tag to trigger automated builds:

```bash
git tag v1.0.0
git push origin v1.0.0
```

This will:

1. Run tests and typecheck
2. Build for Windows x64, macOS Intel, macOS ARM
3. Create a GitHub Release with all installers attached

---

## 📁 Project Structure

### Frontend (`src/`)

- **pages/**: Login, Dashboard, POS, Inventory, Clients, Debts, Exchange, Maintenance, Recharge, Services
- **components/Layout/**: Sidebar, TopBar, MainLayout (navigation)
- **contexts/AuthContext.tsx**: Login state management
- **config/constants.ts**: Exchange rate constant
- **utils/appEvents.ts**: App-wide event emitter for real-time dashboard updates

### Backend (`electron/`)

- **main.ts**: Electron app entry point, creates window, registers IPC handlers
- **preload.ts**: IPC bridge exposing `window.api.*` methods to frontend
- **db/**: SQLite database initialization and schema
- **handlers/**: IPC request handlers for all features
  - `authHandlers.ts` - Login, session
  - `salesHandlers.ts` - POS, checkout, dashboard stats (includes repayments in totals)
  - `inventoryHandlers.ts` - Products
  - `clientHandlers.ts` - Customers
  - `debtHandlers.ts` - Debt tracking with running balance calculation
  - `exchangeHandlers.ts`, `maintenanceHandlers.ts`, `rechargeHandlers.ts`, `omtHandlers.ts` - Additional services

---

## 🗄️ Database Schema

### Key Tables

**users** - Login accounts  
**clients** - Customer profiles (name, phone for debt tracking)  
**products** - Inventory (barcode, IMEI, stock level, pricing)  
**sales** - Transactions (status: completed/draft/cancelled)  
**sale_items** - Line items in each sale  
**debt_ledger** - Customer debts & repayments

- Positive amount = debt created
- Negative amount = repayment
- Running balance determines if debt is "paid"

**maintenance, expenses, exchange_transactions, financial_services** - Additional operations  
**system_settings** - App configuration  
**activity_logs** - Audit trail

---

## ✨ Features

### Operational / Admin Tooling

- **Local backups**: create/list/verify/restore database backups (admin-only) from Settings → Diagnostics
- **Automatic backups**: scheduled backups with retention pruning (configurable)
- **Foreign key integrity**: FK enforcement enabled + on-demand FK check (Settings → Diagnostics)
- **Auto-updater (GitHub Releases)**: check/download/install updates (packaged builds only)
- **Closing report PDFs**: daily closing auto-generates a PDF and persists `report_path`
- **Versioned SQL migrations + performance indexes**: idempotent migration runner + additional indexes

---

### 1. Point of Sale

- Product search (name/barcode)
- Multi-item cart with quantity adjustment
- Discounts
- Payment: USD + LBP
- **Debt Creation**: Requires customer name AND phone number
- Draft sales for later completion
- Auto stock deduction on completion

### 2. Inventory

- Add/edit/delete products
- Stock tracking with low-stock alerts
- Barcode & IMEI management
- Cost + selling price

### 3. Clients

- Create/manage profiles
- Phone number tracking (required for debt)
- History view

### 4. Debts

- Full ledger view (all debts, paid & unpaid)
- Running balance calculation
- "Paid Fully" visual status indicator
- Process repayments in USD & LBP
- Total debt display per customer
- Debt deletion preserves customer

### 5. Dashboard

- **Total Sales (Today)**: Sum of completed sales + repayments
- Orders count
- Active clients
- Low stock alert count
- Revenue chart (last 7 days)
- Recent activity feed
- Top products
- **Real-time refresh** after sale completion via event emitter

### 6. Multi-Currency

- Standardized rate: 1 USD = 89,000 LBP
- Used consistently in checkout, debts, repayments
- Currency exchange transactions (buy/sell)

### 7. Additional

- Device maintenance/repair tracking
- Mobile recharge management (Alfa/MTC)
- Financial services (OMT, Whish)
- Daily cash closings

---

## 🔌 Main API Endpoints

All via `window.api.*` object:

```
Authentication:  login(user, pass), logout(id), getCurrentUser(id)
Inventory:       getProducts(search), getProduct(id), getProductByBarcode(code),
                 createProduct(obj), updateProduct(obj), deleteProduct(id)
Clients:         getClients(search), getClient(id), createClient(obj),
                 updateClient(obj), deleteClient(id)
Sales:           processSale(data), getDashboardStats(), getDrafts(),
                 getSalesChart(), getRecentActivity(), getTopProducts()
Debt:            getDebtors(), getClientDebtHistory(id), getClientDebtTotal(id),
                 addRepayment({clientId, amountUSD, amountLBP, note, exchangeRate})
```

---

## ⚙️ Configuration

### Exchange Rate

**File**: `src/config/constants.ts`

```typescript
export const EXCHANGE_RATE = 89000; // 1 USD = 89,000 LBP
```

Updated in all files: CheckoutModal, Debts, debtHandlers, salesHandlers

### Database Path

```
macOS:   ~/Library/Application Support/liratek/phone_shop.db
Windows: %APPDATA%\liratek\phone_shop.db
Linux:   ~/.config/liratek/phone_shop.db
```

---

## 🔄 Data Flow

### Sale Completion Flow

1. User selects products in POS → adds to cart
2. Opens checkout modal
3. **Phone Validation**: If creating debt, customer must have phone
4. Processes sale → creates sales record + sale_items
5. Deducts stock from products
6. **Emits** `sale:completed` event
7. Dashboard listener receives event → refreshes stats immediately
8. Total sales updated to include repayments

### Debt Flow

1. Create debt from POS or manual entry
2. Store as positive amount in `debt_ledger`
3. Repayment stored as negative amount
4. Running balance = SUM(amounts) for customer
5. is_paid = (running_balance <= $0.01)
6. Dashboard stat includes all repayments in daily total

---

## 🧪 Testing & Cleanup

### Reset Sales & Debts

Removes all sales and debts while keeping customers & products:

```bash
npm run reset:sales-debt
```

**What it does:**

- Creates backup: `phone_shop.db.backup`
- Clears: `sales`, `sale_items`, `debt_ledger` tables
- Resets auto-increment sequences
- Preserves: Users, products, clients, settings

**Use for:** Testing, clearing old data, resetting between audits

---

## 🐛 Debugging

### DevTools

- **macOS**: `Cmd + Option + I`
- **Windows/Linux**: `Ctrl + Shift + I`

### Console Logs

Prefixed output in terminal:

- `[AUTH]` - Authentication operations
- `[SALES]` - Sales & dashboard stats
- `[DEBT]` - Debt transactions
- `[DB]` - Database operations

### Backups / Restore / FK Checks

- Backups directory: `Documents/LiratekBackups/`
- Diagnostics (admin): Settings → Diagnostics
  - Local backups: Backup Now / Verify / Restore
  - Foreign key check: Run FK Check Now

Notes:
- Restore replaces the local DB and restarts the app.
- On startup, the app runs `PRAGMA foreign_keys = ON` and a non-fatal `foreign_key_check`.

### Common Issues

| Issue                    | Solution                                                     |
| ------------------------ | ------------------------------------------------------------ |
| "Autofill.enable" error  | Harmless DevTools warning, ignore                            |
| Login fails              | Check admin user: `sqlite3 "db_path" "SELECT * FROM users;"` |
| Phone validation on debt | Customer must have phone number - edit profile to add        |
| Database locked          | Close all Electron instances, check Activity Monitor         |
| Dashboard not updating   | Check browser console for fetch errors, restart app          |

---

## 🏗️ Architecture Notes

### Frontend

- React hooks + Context API for state
- Event emitter (`appEvents`) for cross-component communication
- Tailwind CSS for styling
- TypeScript for type safety
- IPC bridge (`window.api`) for backend calls

### Backend

- Electron IPC handlers (synchronous)
- Better SQLite3 for embedded database
- Logging with console (prefixed)
- Error handling per handler
- Activity logging for audit trail

### Debt Logic

- Ledger-based: each transaction is a row
- Running balance calculated on fetch
- Positive = debt created, Negative = repayment
- Paid status determined by cumulative balance

### Dashboard Stats

- `getDashboardStats()` query:
  - Sales: COUNT + SUM from `sales` table (completed only)
  - Repayments: SUM(ABS) from `debt_ledger` (transaction_type='Repayment')
  - Total = Sales + Repayments
  - Date filtered using `DATE(created_at)` for timezone safety

---

## 📊 Recent Changes

### Latest Updates

1. ✅ **App Icon**: Custom dollar bill icon for macOS dock and app bundle
2. ✅ **Build System**: Electron-builder for macOS DMG and Windows EXE
3. ✅ **CI/CD**: GitHub Actions workflows for automated builds and tests
   - `ci.yml` - Runs tests, typecheck, lint on push/PR
   - `build.yml` - Creates releases for Windows x64, macOS Intel, macOS ARM
4. ✅ **App Naming**: Renamed from "Corner Tech POS" to "LiraTek"
5. ✅ **Pino Logging**: Structured logging with file rotation in electron handlers

### Fixed Issues

1. ✅ **Phone validation**: Debt creation requires customer phone
2. ✅ **Dashboard total**: Now includes repayment amounts
3. ✅ **Exchange rate**: Standardized to 89000 LBP per USD across all files
4. ✅ **Debt data**: Complete repayment info stored (USD + LBP)
5. ✅ **Debt view**: Shows all debts with paid/unpaid status + total amount
6. ✅ **Dashboard refresh**: Real-time update after sale via event emitter
7. ✅ **Production builds**: Fixed asset paths for Electron file:// protocol

---

## 📞 Support

For issues: Check logs, verify database state, restart app

---

**Version**: 1.0.0 | **Updated**: June 2025
