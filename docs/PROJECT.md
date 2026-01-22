# Liratek - Project Plan & Documentation

**Single Source of Truth**  
**Last Updated:** December 18, 2025  
**Version:** 1.0.0  
**Status:** ✅ Production-Ready - First Release Complete

> **Note:** This document consolidates PROJECT_STATUS.md, TECHNICAL_CONTEXT.md, IMPLEMENTATION_ROADMAP.md, and AGENT_ONBOARDING_PROMPT.md into one authoritative reference.
>
> Practical trackers:
> - Current sprint board: `docs/CURRENT_SPRINT.md`
> - Next roadmap / TODO list: `docs/nexttodo.md`

---

## Table of Contents

1. [Quick Start & Onboarding](#1-quick-start--onboarding)
2. [What's New - Recent Changes](#2-whats-new---recent-changes)
3. [Troubleshooting Guide](#3-troubleshooting-guide)
4. [Project Overview](#4-project-overview)
5. [Architecture](#5-architecture)
6. [Current Status](#6-current-status)
7. [Implementation Roadmap](#7-implementation-roadmap)
8. [Technical Patterns & Conventions](#8-technical-patterns--conventions)
9. [Multi-Drawer System](#9-multi-drawer-system)
10. [Testing Strategy](#10-testing-strategy)
11. [Security Analysis](#11-security-analysis)
12. [Database Schema](#12-database-schema)
13. [Build & Deployment](#13-build--deployment)
14. [Future Architecture Vision](#14-future-architecture-vision)
15. [Quick Reference](#15-quick-reference)

---

## 1. Quick Start & Onboarding

### Default Credentials

- **Username:** `admin`
- **Password:** `admin123`

### Environment Setup

```bash
# Install dependencies
yarn install

# Run in development mode
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

### Codebase Structure

```
electron/               # Main process (TypeScript)
  ├── main.ts          # App entry, IPC registration
  ├── preload.ts       # Secure IPC bridge
  ├── session.ts       # Session management
  ├── db/              # Database layer
  │   ├── index.ts     # Connection management
  │   ├── create_db.sql # Schema
  │   └── migrate.ts   # Migration runner
  └── handlers/        # 13 IPC handler modules
      ├── authHandlers.ts
      ├── salesHandlers.ts
      ├── inventoryHandlers.ts
      ├── debtHandlers.ts
      └── ... (10 more)

src/                   # Renderer process (React)
  ├── App.tsx          # Root component + router
  ├── pages/           # 14 page modules
  ├── components/      # Shared components
  │   ├── Layout/      # MainLayout, Sidebar, TopBar
  │   └── NotificationCenter.tsx
  ├── contexts/        # AuthContext
  └── utils/           # Event emitter, formatters

Database Locations:
  - macOS: ~/Library/Application Support/liratek/phone_shop.db
  - Windows: %APPDATA%/liratek/phone_shop.db
```

### Key Files Reference

| Category     | File                                | Purpose                             |
| ------------ | ----------------------------------- | ----------------------------------- |
| Entry Points | `electron/main.ts`                  | Electron app entry                  |
|              | `src/main.tsx`                      | React entry                         |
| Config       | `package.json`                      | Dependencies, scripts, build config |
|              | `tsconfig.json`                     | TypeScript config                   |
|              | `vite.config.ts`                    | Vite build config                   |
|              | `jest.config.ts`                    | Test config                         |
| Database     | `electron/db/create_db.sql`         | Full schema (20+ tables)            |
| Auth         | `src/contexts/AuthContext.tsx`      | Frontend auth state                 |
|              | `electron/handlers/authHandlers.ts` | Backend auth logic                  |

---

## 2. What's New - Recent Changes

### December 19, 2025 - Major UX & Architecture Improvements

#### Dashboard Redesign

- **Sales Revenue vs Cash Collected:** Separated revenue recognition from cash flow tracking for accurate accounting
- **3-Section Layout:** Financial Metrics | Drawer Balances | Stock Overview
- **Card Height Reduction:** 10% smaller cards for better space utilization
- **Currency Standardization:** "$170" format everywhere (removed "170 USD")
- **Chart Enhancements:** Profit Y-axis shows $ currency, sidebar widgets match chart height

#### Bill Denomination Logic

- **Smart Rounding:** Implemented real-world bill denomination rounding
- **LBP Bills:** 5k, 10k, 20k, 50k, 100k (excluding 1k bills as requested)
- **USD Bills:** $1, $5, $10, $20, $50, $100
- **Rounding Rule:** Always rounds UP to nearest payable amount
- **Applied To:** CheckoutModal Fix button, debt breakdown display
- **New File:** `src/config/denominations.ts`

#### Debt Management Enhancements

- **Auto-fill Settlement:** Modal pre-fills with calculated breakdown amounts
- **Redesigned Layout:** Merged "Amount" column header, dual-currency side-by-side
- **Inline Currency Display:** Table cells show "+$170" and "+60,000 LBP" format
- **Sortable Dates:** Click column header to toggle DESC/ASC sorting
- **Auto-select Client:** First client automatically selected on page load
- **User Tracking:** Debt repayments now track `user_id` for audit trail

#### Opening/Closing Modal Redesign

- **Clean Design:** Removed gradients, emojis, elaborate styling for flat, consistent look
- **Input Bug Fix:** Fixed zero-value handling that prevented typing "0.5"
- **MTC/Alfa USD-only:** These drawers only show USD (phone credits, not cash)
- **Sidebar Fix:** Opening button now works (added event subscription)
- **Empty State:** Clear warning messages when no currencies exist
- **User Tracking:** Daily closings now track `user_id` for audit trail

#### User Authentication & Security

- **Complete useAuth Implementation:** Added to ALL modules (Debts, Closing, Sales, Expenses, Maintenance, Exchange, Recharge, Services)
- **Admin-Only Settings:** Settings menu only visible to admin users
- **Audit Trail Infrastructure:** All modules ready to track `user_id` in transactions
- **Role-Based Access:** All operational features accessible to all authenticated users
- **Security Enhancement:** Created complete accountability system

#### Database Schema Improvements

- **Default Currencies:** USD and LBP now seeded automatically on first run
- **Runtime Migrations:** Patches missing columns (e.g., `debt_ledger.created_by`)
- **Idempotent Design:** Safe to run on existing installations
- **Schema Patch System:** `ensureColumnExists()` helper for future migrations

#### Testing Infrastructure

- **jsdom Support:** Added jest-environment-jsdom for React component tests
- **Test Count:** 41 suites, 413 tests (up from 12 suites, 410 tests)
- **Coverage:** 60%+ (up from 40%)
- **New Tests:** Opening/Closing component tests with full user flow coverage
- **TypeScript Config:** Created `tsconfig.jest.json` for Jest-friendly setup

#### Architecture Improvements

- **Centralized Bill Logic:** `src/config/denominations.ts` for reusable rounding functions
- **Enhanced AuthContext:** Complete user tracking across all modules
- **Separation of Concerns:** Revenue recognition vs cash flow properly separated
- **Audit Trail Ready:** Infrastructure in place for complete transaction tracking
- **Role-Based Access Control:** Foundation for granular permissions

**December 18, 2025 Updates:**

| #   | Change                                                                                | Status     |
| --- | ------------------------------------------------------------------------------------- | ---------- |
| 1   | **DevOps Tooling** - Added `prettier` (3.7.4), updated `clean` script                 | ✅ Done    |
| 2   | **Role-Based Access Control** - `requireRole()` checks in admin IPC handlers          | ✅ Done    |
| 3   | **Activity Logging** - Comprehensive log system with Settings viewer                  | ✅ Done    |
| 4   | **Password Security** - 8+ chars, uppercase, lowercase, number, special char          | ✅ Done    |
| 5   | **Notification Preferences** - Per-user settings in Settings page                     | ✅ Done    |
| 6   | **Settings Module Complete** - All 8 subpages implemented                             | ✅ Done    |
| 7   | **Test Coverage** - 12/12 suites passing; behavior tests added                        | ✅ Done    |
| 8   | **Auto-Update Scaffolding** - electron-updater config with publish provider           | ✅ Partial |
| 9   | **Session Management** - Purge on logout, last_activity refresh                       | ✅ Done    |
| 10  | **Build Scripts** - Enterprise scripts (start, clean, typecheck, format, test:\*)     | ✅ Done    |
| 11  | **Session Encryption (safeStorage)** - Encrypted session tokens via OS keychain       | ✅ Done    |
| 12  | **Password Auto-Migration** - Legacy plain-text passwords migrated to scrypt on login | ✅ Done    |

**Recently Modified Files:**

- `package.json` - DevDeps & scripts
- `electron/handlers/dbHandlers.ts` - Role validation
- `electron/handlers/authHandlers.ts` - Password validation, activity logging, encrypted session
- `electron/session.ts` - safeStorage encryption, session store/restore/clear
- `electron/preload.ts` - restoreSession API exposed
- `src/contexts/AuthContext.tsx` - Uses encrypted session restoration
- `electron/tsconfig.json` - Include all TS files
- `src/pages/Settings/` - All settings subpages

---

## 3. Troubleshooting Guide

### Port Already in Use (5173)

```bash
# Find and kill process
lsof -ti:5173 | xargs kill -9

# Or use different port
VITE_PORT=5174 npm run dev
```

### Database Locked or Not Found

```bash
# Check if file exists (macOS)
ls -l "$HOME/Library/Application Support/liratek/"

# Kill lingering Electron processes
pkill -f electron

# Reset database (CAUTION: deletes all data)
rm -rf "$HOME/Library/Application Support/liratek/"
```

### Jest Test Failures

```bash
# Clear Jest cache
npx jest --clearCache

# Run single test file
npm test -- electron/handlers/__tests__/dbHandlers.test.ts
```

**Common Causes:**

- ESM/CJS Mismatch - Use dynamic `require()` in tests for Electron mocks
- Missing Mocks - Ensure `__mocks__/better-sqlite3.ts` and `__mocks__/electron.ts` exist

### TypeScript Errors After Pull

```bash
yarn clean
rm -rf node_modules .yarn/cache
yarn install
npx tsc --version  # Should be ~5.9.3
```

### Reset Admin Password

```sql
sqlite3 "$HOME/Library/Application Support/liratek/phone_shop.db"
UPDATE users SET password_hash = 'admin123' WHERE username = 'admin';
-- Will auto-migrate to scrypt on next login
```

### Build/Packaging Failures

```bash
# Test build without signing
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:app
```

---

## 4. Project Overview

**Liratek** is a comprehensive desktop POS and inventory management system for mobile phone and electronics retail shops.

### Tech Stack

| Layer      | Technology                      | Version               |
| ---------- | ------------------------------- | --------------------- |
| Frontend   | React, TypeScript, Tailwind CSS | 19.2.0, 5.9.3, 4.1.18 |
| Build      | Vite                            | 7.3.0                 |
| Backend    | Electron, Better SQLite3        | 39.2.7, 12.5.0        |
| Testing    | Jest, ts-jest                   | 30.2.0, 29.4.6        |
| Validation | Zod                             | 3.23.8                |

### Core Features (100% Implemented)

1. **Authentication & Authorization** - Login/logout, scrypt hashing, role-based access
2. **Inventory Management** - Product CRUD, barcode/IMEI tracking, stock levels
3. **Point of Sale (POS)** - Multi-item cart, multi-currency payment, draft sales
4. **Client Management** - Customer profiles, phone tracking, history
5. **Debt Management** - Ledger with running balance, repayments
6. **Dashboard & Analytics** - Real-time stats, charts, recent activity
7. **Currency Exchange** - USD/LBP/EUR with dynamic rates
8. **OMT/Whish Services** - Money transfer, bill payment, commission tracking
9. **Mobile Recharge** - MTC (Blue) and Alfa (Red), virtual stock
10. **Device Maintenance** - Repair tracking, status workflow

### Operational Features (Partial)

11. **Expenses Tracking** - ✅ Basic UI, ⚠️ Limited reporting
12. **Daily Opening/Closing** - ✅ Wizards complete, ✅ Report auto-attach implemented (PDF saved + `report_path` persisted)
13. **Settings & Configuration** - ✅ User mgmt, Currency mgmt, Diagnostics

---

## 5. Architecture

### Application Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Renderer Process                      │
│  (React 19 + TypeScript + Tailwind CSS)                 │
│  - Pages: Dashboard, POS, Inventory, Clients, etc.      │
│  - Components: Layout, Modals, Forms                     │
│  - Contexts: AuthContext (session management)            │
│  - Utils: Event emitter, formatters, generators         │
└──────────────────┬──────────────────────────────────────┘
                   │ window.api.* (IPC Bridge)
                   │ (contextBridge.exposeInMainWorld)
┌──────────────────▼──────────────────────────────────────┐
│                    Main Process                          │
│  (Electron + TypeScript)                                 │
│  - main.ts: Window creation, handler registration        │
│  - preload.ts: Secure API exposure to renderer           │
│  - handlers/*: IPC request handlers (13 modules)         │
│  - db/: SQLite operations, migrations                    │
│  - sync.ts: Background sync processor (env-gated)        │
└──────────────────┬──────────────────────────────────────┘
                   │ better-sqlite3
┌──────────────────▼──────────────────────────────────────┐
│              SQLite Database                             │
│  20+ tables: users, products, sales, clients, debts,    │
│  activity_logs, sync_queue, daily_closings, currencies  │
└─────────────────────────────────────────────────────────┘
```

### Security Model

- **Context Isolation:** Enabled (Electron best practice)
- **Node Integration:** Disabled (no direct Node access from renderer)
- **IPC Bridge:** Controlled API surface via `contextBridge`
- **SQL Injection Prevention:** Prepared statements throughout
- **Password Hashing:** Scrypt with random salt, auto-migration from legacy
- **Session Encryption:** safeStorage API encrypts session tokens via OS keychain

---

## 6. Current Status

### Maturity Assessment

| Area                 | Completion | Notes                                                      |
| -------------------- | ---------- | ---------------------------------------------------------- |
| Core Functionality   | ✅ 100%    | All business features implemented                          |
| Security Hardening   | ✅ 85%     | Role validation, session encryption, scrypt passwords done |
| Testing Coverage     | 🟡 40%     | 12/12 suites passing, expanding coverage                   |
| Documentation        | ✅ 90%     | Comprehensive docs organized, need user manual             |
| Build & Release      | ✅ 100%    | Icons complete, automated releases active                  |
| Production Readiness | ✅ 95%     | Ready for v1.0, code signing pending for future            |

### What's Complete ✅

Updated (Dec 19, 2025)

- Typing alignment across renderer ↔ Electron API for Products, Clients, Sales, Exchange, OMT, and Maintenance.
- Debts and Dashboard typed DTOs in UI. Tooltip contract fixed for Recharts.
- Mixed require() strategy in Electron (static import where safe, inline suppressions where needed).
- React hooks cleanup in multiple pages (useCallback, effect dependencies).
- Preload bridge signatures tightened (unknown/typed payloads in several methods).

- All core business features (POS, Inventory, Clients, Debts)
- Financial services (OMT, Recharge, Exchange, Maintenance)
- Dashboard with real-time updates
- Opening/Closing wizards with blind count enforcement
- Multi-drawer, multi-currency support
- Dynamic currency management
- User management with role-based access
- Scrypt password hashing with complexity requirements
- Backend IPC handler role validation
- Activity logging with Settings viewer
- Notification preferences
- Session encryption via Electron safeStorage (OS keychain)
- Password auto-migration to scrypt on login
- 12/12 test suites passing

### What Needs Work ⚠️

| Priority     | Item                                 | Status        | Blocker? |
| ------------ | ------------------------------------ | ------------- | -------- |
| ~~CRITICAL~~ | ~~Session encryption (safeStorage)~~ | ✅ Done       | No       |
| HIGH         | Test coverage to 70%                 | In progress   | No       |
| HIGH         | Icon assets for packaging            | Placeholder   | Yes      |
| HIGH         | Code signing setup                   | Not started   | Yes      |
| MEDIUM       | Auto-updater implementation          | Scaffold only | No       |
| MEDIUM       | Closing report auto-attach           | Not started   | No       |
| LOW          | Cloud sync (Phase 6)                 | 40%           | No       |

---

## 7. Implementation Roadmap

### Phase Overview

| Phase     | Focus                   | Status           |
| --------- | ----------------------- | ---------------- |
| Phase 1-4 | Core Features           | ✅ 100% Complete |
| Phase 5   | Dashboard & Reporting   | ✅ 95% Complete  |
| Phase 6   | Sync & Cloud            | ⚠️ 40% Complete  |
| Phase 7   | Security & Distribution | ⚠️ 70% Complete  |

### Remaining Tasks by Priority

#### CRITICAL (Blocking Production)

| Task                                 | Est. Time    | Status      |
| ------------------------------------ | ------------ | ----------- |
| ~~Session encryption (safeStorage)~~ | ~~1-2 days~~ | ✅ Done     |
| Icon assets (icns, ico)              | 1 day        | Not started |
| Code signing setup                   | 1-2 days     | Not started |
| QA checklist execution               | 2-3 days     | Not started |

#### HIGH Priority

| Task                           | Est. Time | Status        |
| ------------------------------ | --------- | ------------- |
| Test coverage to 70%           | 5-7 days  | In progress   |
| Auto-updater integration       | 1-2 days  | Scaffold done |
| Installation/Admin docs        | 2-3 days  | Not started   |
| Build testing on clean systems | 1 day     | Not started   |

#### MEDIUM Priority

| Task                       | Est. Time | Status      |
| -------------------------- | --------- | ----------- |
| Closing report auto-attach | 0.5 day   | ✅ Done |
| Variance threshold alerts  | 0.5 day   | ✅ Done |
| Database indexes           | 1 day     | ✅ Done |
| Local backup automation    | 2-3 days  | ✅ Done |

#### LOW Priority (Post-Launch)

| Task                      | Est. Time | Status   |
| ------------------------- | --------- | -------- |
| Cloud sync implementation | 5-7 days  | Optional |
| DRM/Licensing             | 4-5 days  | Optional |
| Multi-location support    | TBD       | Future   |

### Estimated Timeline to Production

**6-7 weeks** with focused effort:

- Week 1-2: Security completion + Settings polish
- Week 3-4: Testing coverage + QA
- Week 5: Packaging + Build testing
- Week 6: Documentation + Final polish
- Week 7: Buffer for issues

---

## 8. Technical Patterns & Conventions

### IPC Handler Pattern

```typescript
import { ipcMain } from "electron";
import { getDatabase } from "../db";

export function registerMyHandlers(): void {
  const db = getDatabase();

  ipcMain.handle("my:operation", async (_event, data) => {
    try {
      // 1. Validate input
      if (!data?.requiredField) {
        throw new Error("Invalid input");
      }

      // 2. Role check (for admin operations)
      const { requireRole } = require("../session");
      const auth = requireRole(_event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      // 3. Database operation
      const result = db
        .prepare("SELECT * FROM my_table WHERE id = ?")
        .get(data.id);

      // 4. Return result
      return { success: true, data: result };
    } catch (error: any) {
      console.error("[MY_HANDLER] Error:", error);
      return { success: false, error: error.message };
    }
  });
}
```

### Transaction Pattern (for writes)

```typescript
const transaction = db.transaction((data) => {
  db.prepare("INSERT INTO table1 VALUES (?)").run(data.field1);
  db.prepare("UPDATE table2 SET x = ? WHERE id = ?").run(data.field2, data.id);
});

try {
  transaction(data);
  return { success: true };
} catch (error) {
  // Auto-rollback on error
  return { success: false, error: error.message };
}
```

### React Component Pattern

```typescript
export default function MyPage() {
  const [data, setData] = useState<MyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const result = await window.api.myOperation();
      setData(result);
    } catch (error) {
      setError("Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div>Loading...</div>;
  if (error) return <div className="text-red-500">{error}</div>;

  return <div className="p-6">{/* Content */}</div>;
}
```

### Event Emitter Pattern

```typescript
// Emit event
import { appEvents } from "./utils/appEvents";
appEvents.emit("sale:completed", { saleId: 123 });

// Listen with cleanup
useEffect(() => {
  const unsubscribe = appEvents.on("sale:completed", (data) => {
    refreshDashboard();
  });
  return () => unsubscribe(); // Cleanup on unmount
}, []);
```

### Modal Pattern (Opening/Closing style)

```typescript
// Sidebar.tsx
<button onClick={() => appEvents.emit("openClosingModal")}>Closing</button>

// MainLayout.tsx
useEffect(() => {
  const off = appEvents.on("openClosingModal", () => setIsClosingModalOpen(true));
  return () => off();
}, []);

{isAdmin && isClosingModalOpen && (
  <Closing isOpen={isClosingModalOpen} onClose={() => setIsClosingModalOpen(false)} />
)}
```

---

## 9. Multi-Drawer System

### Overview

Drawers represent *logical wallets* that map to payment methods and/or business modules.

- **General drawer (CASH):** Cash-only (USD/LBP)
- **OMT drawer:** OMT money-transfer transactions (SEND/RECEIVE) + OMT payment-method sales lines
- **Whish drawer:** Whish money-transfer transactions (SEND/RECEIVE) + Whish payment-method sales lines
- **Binance drawer:** Binance payment-method sales lines (and Binance module transactions)
- **MTC drawer:** Recharge transactions (USD)
- **Alfa drawer:** Recharge transactions (USD)

### Running Expected Balances (Drawer Balances)

Expected balances are stored and updated *behind the scenes*:

- DB table: `drawer_balances` (by `drawer_name` + `currency_code`)
- Every transaction that affects a drawer writes to:
  - `payments` (auditable payment rows, signed deltas)
  - `drawer_balances` (running totals)
- Implemented sources using this model:
  - POS sales (multi-payment lines)
  - Expenses (Cash_Out with Paid By method)
  - Financial services (OMT/Whish SEND/RECEIVE)
  - Exchange (USD/LBP movement inside General)
  - Recharges (MTC/Alfa): customer payment increases the selected method drawer (full price), and telecom balance decreases by the recharge `amount`
- Opening sets the baseline by writing the counted opening amounts into `drawer_balances`.
- Closing compares the operators *actual* counts to the current `drawer_balances` expected amounts.

### Current Implementation

| Feature                                | Status  | Notes |
| -------------------------------------- | ------- | ----- |
| Running expected balances              | ✅ Done | `drawer_balances` holds expected amounts per (drawer, currency) |
| Auditable balance changes              | ✅ Done | `payments` stores signed deltas by source (SALE/EXPENSE/EXCHANGE/FINANCIAL_SERVICE/RECHARGE) |
| Method-based drawers (CASH/OMT/WHISH/BINANCE) | ✅ Done | Payment method maps to drawer name (General/OMT/Whish/Binance) |
| POS multi-payment lines                | ✅ Done | Checkout supports multiple payment lines (method + currency + amount) |
| Expenses paid-by routing               | ✅ Done | Expense Cash_Out decreases selected drawer |
| Exchange affects expected balances     | ✅ Done | Currency movement updates General drawer balances |
| Recharges affect expected balances     | ✅ Done | Paid By increases method drawer; MTC/Alfa telecom balance decreases by `amount` |

### Drawer Routing Logic (Current)

- **Sales (POS):** each payment line updates its drawer and currency
- **Expenses (Cash_Out):** decreases selected drawer
- **Financial services (OMT/Whish):** SEND decreases, RECEIVE increases the provider drawer
- **Exchange:** subtract from-currency and add to-currency within General
- **Recharges:**
  - customer payment increases the selected method drawer by full price
  - telecom balance decreases in MTC/Alfa drawer by recharge `amount`

### Key Insight

Drawers now represent two categories:

1. **Cash-like drawers** (physically countable): General/OMT/Whish/Binance (USD/LBP)
2. **Telecom balance drawers** (verified on phone): MTC/Alfa (USD only)

Both are surfaced in Opening/Closing, but the operator verifies them differently (physical count vs phone balance).

---

## 10. Testing Strategy

### Current State

| Module                    | Test File                             | Coverage | Status  |
| ------------------------- | ------------------------------------- | -------- | ------- |
| appEvents.ts              | ✅ appEvents.test.ts                  | 100%     | Passing |
| closingReportGenerator.ts | ✅ closingReportGenerator.test.ts     | 95%      | Passing |
| authHandlers.ts           | ✅ authHandlers.test.ts               | 80%      | Passing |
| dbHandlers.ts             | ✅ dbHandlers.behavior.test.ts        | 70%      | Passing |
| salesHandlers.ts          | ✅ salesHandlers.test.ts              | 60%      | Passing |
| inventoryHandlers.ts      | ✅ inventoryHandlers.behavior.test.ts | 50%      | Passing |
| currencyHandlers.ts       | ✅ currencyHandlers.behavior.test.ts  | 50%      | Passing |
| debtHandlers.ts           | ✅ debtHandlers.test.ts               | 50%      | Passing |

**Overall:** 12/12 suites passing, ~40% estimated coverage

### Testing Best Practices

```typescript
// Dynamic module loading (ensures mocks ready)
beforeEach(() => {
  jest.clearAllMocks();
  const module = require("../moduleUnderTest");
  registerHandlers = module.registerHandlers;
  registerHandlers();
});

// Mock database with complete chain
mockDbInstance.prepare.mockImplementation((sql: string) => ({
  run: jest.fn().mockReturnValue({ lastInsertRowid: 1 }),
  get: jest.fn(),
  all: jest.fn().mockReturnValue([]),
  _sql: sql,
}));
```

### Target

- **Goal:** 70%+ coverage before production
- **Priority:** Critical path handlers (sales, debts, closing)

---

## 11. Security Analysis

### ✅ Implemented

| Security Feature           | Status                                   |
| -------------------------- | ---------------------------------------- |
| Context isolation          | ✅ Enabled                               |
| No nodeIntegration         | ✅ Disabled                              |
| IPC bridge (contextBridge) | ✅ Secure                                |
| SQL injection prevention   | ✅ Prepared statements                   |
| Password hashing (scrypt)  | ✅ With salt                             |
| Role-based UI gating       | ✅ Admin features hidden                 |
| Backend role validation    | ✅ requireRole() in handlers             |
| Password complexity        | ✅ 8+ chars, mixed case, number, special |
| Activity logging           | ✅ Critical operations logged            |
| Session purge on logout    | ✅ Implemented                           |

### ⚠️ Pending

| Security Feature                 | Priority | Status                           |
| -------------------------------- | -------- | -------------------------------- |
| Session encryption (safeStorage) | CRITICAL | ✅ Done                          |
| Session timeout (30 min)         | HIGH     | Partial (last_activity tracking) |
| Database encryption (SQLCipher)  | MEDIUM   | Not started                      |
| Rate limiting on IPC             | LOW      | Not started                      |

### Security Recommendations

1. **CRITICAL:** Implement session encryption with Electron's safeStorage API (✅ done)
2. **HIGH:** Complete session timeout with auto-logout
3. **MEDIUM:** Consider SQLCipher for database encryption
4. **LOW:** Add rate limiting for IPC handlers

---

## 12. Database Schema

### Core Tables (20+)

| Table                 | Purpose                                |
| --------------------- | -------------------------------------- |
| users                 | Authentication and roles               |
| clients               | Customer profiles                      |
| products              | Inventory items                        |
| sales                 | Transaction records                    |
| sale_items            | Line items per sale                    |
| debt_ledger           | Debt transactions with running balance |
| maintenance           | Repair jobs                            |
| financial_services    | OMT/Whish transactions                 |
| exchange_transactions | Currency exchange                      |
| expenses              | Daily expenses                         |
| daily_closings        | End-of-day records                     |
| daily_closing_amounts | Multi-drawer/currency balances         |
| activity_logs         | Audit trail                            |
| sync_queue            | Pending cloud sync                     |
| sync_errors           | Failed sync attempts                   |
| currencies            | Dynamic currency definitions           |
| exchange_rates        | Cross-rate matrix                      |
| system_settings       | App configuration                      |
| sessions              | Active user sessions                   |

### Schema Location

`electron/db/create_db.sql` - Consolidated schema with all tables

### Pending Improvements

- [x] Migration system (versioned migrations)
- [x] Database indexes (performance)
- [x] Foreign key enforcement (PRAGMA foreign_keys = ON) — Enabled at connection open; startup runs `PRAGMA foreign_key_check` and logs violations (non-fatal).
- [ ] Data archival strategy (>1 year records)

### Data Archival Strategy (Ops + Performance)

**Problem:** over time, high-write tables (sales, activity logs, sync errors, etc.) will grow and can slow queries/backups.

**Goals:**
- Keep the primary DB fast for day-to-day operations.
- Keep historical data retrievable.
- Make the process **reversible** (archive before delete).

#### Recommended approach (safe + reversible)

1. **Archive to a separate SQLite file** (preferred)
   - Create `Documents/LiratekArchives/archive_<YYYY-MM>.sqlite`
   - Copy rows older than retention into the archive DB
   - Verify counts match
   - Only then delete from the primary DB

2. **Retention defaults** (suggested)

| Table | Keep in primary DB | Archive older than |
|------|---------------------|-------------------|
| `sales`, `sale_items` | 24 months | 24 months |
| `debt_ledger` | 36 months | 36 months |
| `activity_logs` | 6-12 months | 12 months |
| `sync_queue` | keep all (usually small) | N/A |
| `sync_errors` | 3 months | 3 months |
| `expenses` | 24 months | 24 months |
| `exchange_transactions` | 24 months | 24 months |
| `financial_services` | 24 months | 24 months |
| `maintenance` | 36 months | 36 months |
| `recharges` | 24 months | 24 months |
| `daily_closings`, `daily_closing_amounts` | keep all | (optional) |

> Note: retention periods should reflect accounting/legal needs.

#### Operator workflow (manual)

- Step 0: Run FK check (Settings → Diagnostics → Foreign Key Check)
- Step 1: Take a backup (Settings → Diagnostics → Local Backups → Backup Now)
- Step 2: Run an archival/export tool (future: provide a built-in archiver or admin script)
- Step 3: Verify:
  - Archive row counts match extracted row counts
  - Primary DB still passes `foreign_key_check`
- Step 4: Delete archived rows from primary DB (only after verification)
- Step 5: Take a post-archive backup

#### Implementation plan (future)

- Provide an admin-only action that:
  - previews row counts by table for a cutoff date
  - exports to archive DB
  - runs validation checks
  - optionally deletes (with confirmation)

### Foreign Key Verification (Ops)

On every app start we run:
- `PRAGMA foreign_keys = ON` (enforcement)
- `PRAGMA foreign_key_check` (verification)

If the log shows violations:
1. Stop normal operations (avoid creating more inconsistent data)
2. Take a backup (Settings → Diagnostics → Local Backups → Backup Now)
3. Investigate the violating tables/rows and either:
   - Repair missing parent rows, or
   - Delete orphan rows (as a last resort)
4. Restart the app and confirm `foreign_key_check` returns no violations

---

## 13. Build & Deployment

### Development Commands

```bash
npm run dev          # Start dev server (Vite + Electron)
npm start            # Alias for dev
npm test             # Run all tests
npm run test:watch   # Watch mode
npm run test:coverage # Coverage report
npm run typecheck    # TypeScript check
npm run lint         # ESLint
npm run format       # Prettier
npm run clean        # Remove build artifacts
```

### Production Commands

```bash
npm run build        # Compile TypeScript + Vite build
npm run build:app    # Windows installer (NSIS)
npm run build:mac    # macOS DMG/ZIP
```

### Electron Builder Config

| Setting     | Value                  |
| ----------- | ---------------------- |
| appId       | com.liratek.cornertech |
| productName | Corner Tech POS        |
| Windows     | NSIS installer (x64)   |
| macOS       | DMG + ZIP (arm64)      |
| ASAR        | Enabled                |

### Code Signing (Not Yet Configured)

**macOS:**

```bash
export CSC_IDENTITY_AUTO=true
export APPLE_ID=you@example.com
export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
export ASC_PROVIDER=YOURTEAM
npm run build:mac
```

**Windows:**

```bash
export CSC_LINK=/path/to/cert.pfx
export CSC_KEY_PASSWORD=********
npm run build:app
```

---

## 14. Future Architecture Vision

### Proposed v2 Structure (Monorepo)

```
liratek/
├── apps/
│   ├── desktop/           # Electron renderer + shell
│   └── server/            # Node.js service (HTTP/IPC endpoints)
├── packages/
│   ├── db/                # Database schema, migrations, access
│   └── shared/            # Types, DTOs, validation schemas (Zod)
```

### Key Changes

1. **Backend Service:** REST/tRPC endpoints for all IPC handlers
2. **Centralized Auth:** JWT session with role claims
3. **Database:** Prisma/Drizzle migrations, connection pooling
4. **Logging:** Pino with structured logging, request correlation
5. **Config:** .env per package, typed config loader

### Migration Path

1. Wrap existing IPC handlers with adapter calling new server endpoints
2. Incrementally move modules (auth, inventory, sales, closing)
3. Keep compatibility layer until all modules migrated

**Note:** This is a proposal for v2. Do not implement yet.

---

## 15. Quick Reference

### Common Commands

| Command             | Purpose                 |
| ------------------- | ----------------------- |
| `npm run dev`       | Start development       |
| `npm test`          | Run tests               |
| `npm run typecheck` | Check TypeScript        |
| `npm run format`    | Format with Prettier    |
| `npm run clean`     | Clean build artifacts   |
| `npm run build:app` | Build Windows installer |
| `npm run build:mac` | Build macOS package     |

### Default Credentials

- **Username:** `admin`
- **Password:** `admin123`

### Database Locations

- **macOS:** `~/Library/Application Support/liratek/phone_shop.db`
- **Windows:** `%APPDATA%/liratek/phone_shop.db`

### Key Contacts

| Event              | Handler             |
| ------------------ | ------------------- |
| Sale completed     | `sale:completed`    |
| Stock updated      | `inventory:updated` |
| Open closing modal | `openClosingModal`  |
| Open opening modal | `openOpeningModal`  |

### Success Criteria for v1.0.0 Release

- ✅ [x] All 12 test suites passing
- ✅ [x] Backend role validation complete
- ✅ [x] Session encryption implemented
- 🟡 [~] 40% test coverage (expanding)
- ✅ [x] Installers built and tested
- ✅ [x] Icons for all platforms (Windows, macOS)
- ✅ [x] GitHub Actions automated releases
- ✅ [x] Comprehensive documentation organized
- 🟡 [~] User documentation (in progress)
- ⏳ [ ] Code signing (deferred to future release)

---

## Document History

| Version | Date         | Changes                           |
| ------- | ------------ | --------------------------------- |
| 1.0     | Dec 18, 2025 | Consolidated from 4 separate docs |

**Supersedes:**

- PROJECT_STATUS.md
- TECHNICAL_CONTEXT.md
- IMPLEMENTATION_ROADMAP.md
- AGENT_ONBOARDING_PROMPT.md

---

**This is the single source of truth for the Liratek project.**
