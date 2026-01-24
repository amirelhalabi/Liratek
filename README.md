# LiraTek POS 📱💰

A comprehensive, enterprise-grade Point of Sale (POS) and inventory management system designed specifically for mobile phone and electronics retail shops.

---

## 📑 Table of Contents

- [Core Features](#-core-features)
- [Tech Stack](#️-tech-stack)
- [Getting Started](#-getting-started)
- [Architecture](#️-architecture)
- [Database Schema](#️-database-schema)
- [Development Guide](#-development-guide)
- [Business Logic](#-business-logic)
- [Testing](#-testing)
- [Build & Release](#️-build--release)
- [Security](#-security)
- [API Migration](#-api-migration)
- [Troubleshooting](#-troubleshooting)
- [Additional Documentation](#-additional-documentation)

---

## ✨ Core Features

- **Inventory Tracking**: Manage product stock, barcodes, and IMEI/Serial numbers with ease.
- **Advanced POS**: Multi-item cart, multi-currency checkout, and sales draft support.
- **Client & Debt Management**: Track customer history and manage dual-currency (USD/LBP) debts with smart rounding logic.
- **Financial Services**: Built-in support for OMT, Whish, and Mobile Recharges (MTC/Alfa).
- **Daily Auditing**: 3-step opening and closing workflow with variance detection and PDF audit trails.
- **Security First**: Role-based access control, scrypt password hashing, and session encryption.

---

## 🛠️ Tech Stack

- **Frontend**: React 19 + TypeScript + Tailwind CSS
- **Backend**: Electron 39 + Node.js (migrating to standalone Express server)
- **Database**: Better SQLite3 (Local, Encrypted Session storage)
- **Testing**: Jest + Playwright
- **CI/CD**: GitHub Actions (Automated multi-platform releases)

---

## 📥 Getting Started

### Prerequisites

- **Node.js**: v18.x or v20.x
- **Yarn**: v4.0.2 (`corepack enable`)
- **Git**
- **C++ Build Tools**: 
  - macOS: `xcode-select --install`
  - Windows: Visual Studio Build Tools ("Desktop development with C++")

### Installation & Development

```bash
# Install dependencies
yarn install

# Run in development mode (Vite + Electron)
npm run dev

# Run all tests
npm test

# Build for production
npm run build
```

### Running Backend + Frontend Separately (Migration Mode)

```bash
# Terminal 1 - Backend
cd backend
yarn dev

# Terminal 2 - Frontend
cd frontend
yarn dev
```

- Backend: `http://localhost:3000`
- Frontend: `http://localhost:5173`

### Docker (Production-like)

```bash
docker compose up --build
```

---

## 🏗️ Architecture

LiraTek is built using Electron with strict separation between the backend (Main Process) and UI (Renderer Process).

### Process Communication (IPC)

- **Main Process (Node.js)**: Manages SQLite database, file system, and system events. Defined in `electron/`
- **Renderer Process (React)**: Modern UI with Tailwind CSS. Defined in `src/`
- **IPC Bridge**: Secure communication via `preload.ts` using `contextBridge`

### Directory Structure

```
liratek/
├── electron/               # Main process logic
│   ├── db/                # SQL schema and migrations
│   ├── handlers/          # IPC request management (13 modules)
│   ├── services/          # Core business logic (domain layer)
│   └── database/
│       └── repositories/  # Data access layer
├── src/                   # Renderer process
│   ├── features/          # Modular feature pages
│   ├── shared/            # Reusable UI components and hooks
│   └── types/             # TypeScript definitions
├── backend/               # Standalone backend (migration in progress)
│   ├── src/api/          # REST API endpoints
│   └── src/services/     # Business logic
├── frontend/              # Standalone frontend (migration in progress)
│   └── src/              # React app for browser mode
├── packages/shared/       # Shared types, Zod schemas, and DTOs
└── docs/                  # Documentation
```

---

## 🗄️ Database Schema

LiraTek uses **SQLite** for low-latency, localized data storage.

### Core Tables

- **`products`**: Inventory with barcode and IMEI tracking
- **`sales` / `sale_items`**: Transaction records and snapshots
- **`clients` / `debt_ledger`**: Customer profiling and dual-currency debt tracking with smart rounding
- **`payments`**: Cash movement tracking linked to sales, debts, expenses, and services
- **`drawer_balances`**: Running totals for all payment method drawers (General, OMT, Whish, Binance, MTC, Alfa)
- **`financial_services`**: OMT and Whish transaction logs
- **`daily_closings`**: Multi-drawer end-of-day audits and variance tracking
- **`activity_logs`**: Comprehensive JSON-based audit trail
- **`recharges`**: MTC/Alfa recharge tracking with virtual stock
- **`maintenance_jobs`**: Device repair tracking with status workflow
- **`supplier_ledger`**: Dual-currency supplier debt management

### Database Location

- **Electron Mode**: `~/Library/Application Support/liratek/liratek.db` (macOS)
- **Backend Mode**: `DATABASE_PATH` environment variable or `./liratek.db`
- **Docker**: `/data/liratek.db` (persisted via volume)

---

## 💻 Development Guide

### Code Organization

**Repositories** (`electron/database/repositories/`):
- Data access layer
- SQL query management
- Transaction handling

**Services** (`electron/services/`):
- Business logic layer
- Validation and error handling
- Orchestration between repositories

**Handlers** (`electron/handlers/`):
- IPC endpoint definitions
- Request/response formatting
- Thin wrappers over services

### Writing Tests

**Unit Tests** (Jest):
```bash
npm test                    # Run all tests
npm run test:coverage      # With coverage report
npm run test:watch         # Watch mode
```

**E2E Tests** (Playwright):
```bash
cd frontend
npm run test:e2e           # Run E2E tests
npm run test:e2e:ui        # Run with UI
```

### Common Commands

```bash
# Development
npm run dev                 # Start Electron app
npm run dev:vite           # Start Vite only
npm run dev:electron       # Start Electron only

# Testing
npm test                    # Run unit tests
npm run test:e2e           # Run E2E tests

# Building
npm run build              # Build for current platform
npm run build:win:x64      # Windows installer
npm run build:mac:x64      # macOS Intel
npm run build:mac:arm64    # macOS ARM
npm run build:all          # All platforms

# Utilities
npm run rebuild            # Rebuild native modules
npm run type-check         # TypeScript validation
```

---

## 💰 Business Logic

### Debt Repayment with Smart Rounding

LiraTek implements intelligent debt repayment logic to handle real-world cash transactions while maintaining accounting accuracy.

#### The Problem

When a debt of $262.95 is displayed as "$262 + 85,000 LBP" and a customer pays only 85,000 LBP:
- Standard conversion: 85,000 ÷ 89,000 = $0.9551
- Actual fractional debt: $0.95
- This creates a $0.01 discrepancy

#### The Solution

**Smart Debt Reduction Algorithm**:

1. **Customer pays** rounded amount (85,000 LBP) - practical denominations
2. **Drawer receives** the full payment (85,000 LBP goes into drawer_balances)
3. **Debt reduces** by actual fractional amount ($0.95, not $0.9551)
4. **Shop gains** small rounding profit (450 LBP ≈ $0.0051)

**Example Flow**:
```
Total Debt: $262.95
├─ Integer Part: $262
└─ Fractional Part: $0.95 = 84,550 LBP
   └─ Rounded for Display: 85,000 LBP

Customer Pays: 85,000 LBP
├─ Drawer Receives: 85,000 LBP ✓
├─ Debt Reduced By: $0.95 ✓
└─ Shop Gain: 450 LBP ≈ $0.0051

Remaining Debt: $262.00 ✓ (not $261.99)
```

**Implementation**:

Frontend logic detects when paying the fractional portion:
```typescript
const integerDebt = Math.floor(totalDebt);
const fractionalDebt = totalDebt - integerDebt;
const fractionalLBP = fractionalDebt * EXCHANGE_RATE;

if (paidLBP > 0) {
  const roundedFractionalLBP = Math.ceil(fractionalLBP / 5000) * 5000;
  
  // Check if paying the rounded fractional portion
  if (Math.abs(paidLBP - roundedFractionalLBP) < 1000) {
    // Reduce debt by actual fractional amount
    debtReductionUSD += fractionalDebt;
  } else {
    // Use exact LBP conversion
    debtReductionUSD += paidLBP / EXCHANGE_RATE;
  }
}
```

Backend separates payment recording from debt reduction:
```typescript
// Record debt reduction in debt_ledger
INSERT INTO debt_ledger (amount_usd, amount_lbp) 
VALUES (-0.95, 0);  // Actual debt reduction

// Record payment in payments table
INSERT INTO payments (amount) 
VALUES (85000);  // Actual payment received

// Update drawer balance
UPDATE drawer_balances 
SET balance = balance + 85000;  // Cash received
```

**Benefits**:
- ✅ No rounding errors in debt calculations
- ✅ Customers pay in practical denominations
- ✅ Accurate drawer balance tracking
- ✅ Shop captures small legitimate profit from rounding

### Multi-Currency Support

Exchange rate management with configurable rates:
```typescript
// src/config/constants.ts
export const EXCHANGE_RATE = 89000; // 1 USD = 89,000 LBP
```

Supported currencies: USD, LBP, EUR (via exchange module)

### Payment Methods & Drawers

- **Cash** → General Drawer
- **OMT** → OMT Drawer
- **Whish** → Whish Drawer
- **Binance** → Binance Drawer
- **MTC** → MTC Drawer (recharges)
- **Alfa** → Alfa Drawer (recharges)

Each drawer tracks balances independently with opening/closing audit workflow.

---

## 🧪 Testing

### Test Coverage Goals

- **Critical Paths**: 90%+ (auth, sales, debt, closing)
- **Business Logic**: 80%+ (services, repositories)
- **UI Components**: 60%+ (forms, validation)

### Module Testing Status

#### ✅ Core Modules (Working in Browser & Electron)
- Authentication (login, logout, session)
- Dashboard (stats, charts, balances)
- Clients (CRUD operations)
- Inventory (products, stock management)
- Sales/POS (checkout, cart, drafts)
- Debts (list, repayments with smart rounding)
- Exchange (currency conversion)
- Expenses (tracking, categories)
- Recharge (MTC/Alfa top-ups)
- Services (OMT/Whish transactions)
- Maintenance (repair tracking)
- Currencies (list, rates)
- Settings (shop config)

#### ⏳ Advanced Features (Partial/Electron Only)
- Closing (daily audits, variance)
- Opening (balance initialization)
- Advanced Settings (rates, users, suppliers)
- Diagnostics (DB checks, backups)
- Reports (PDF generation)
- Activity Logs (audit trail)
- Updates (auto-updater)

### Running Tests

**Unit Tests**:
```bash
npm test                          # All tests
npm test -- ClientService.test.ts # Specific test
npm run test:coverage             # With coverage
```

**E2E Tests**:
```bash
cd frontend
npm run test:e2e                  # All E2E tests
npm run test:e2e -- login.spec.ts # Specific spec
npm run test:e2e:ui               # Interactive mode
```

### Writing Tests

**Repository Test Example**:
```typescript
import Database from 'better-sqlite3';
import { ClientRepository } from '../ClientRepository';

describe('ClientRepository', () => {
  let db: Database.Database;
  let repo: ClientRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    // Create tables...
    repo = new ClientRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should create a client', () => {
    const result = repo.create({
      full_name: 'John Doe',
      phone_number: '1234567890',
    });
    expect(result.success).toBe(true);
  });
});
```

---

## 🛠️ Build & Release

### Build Commands

| Platform | Command | Output |
|----------|---------|--------|
| **Windows** | `npm run build:win:x64` | NSIS Installer (.exe) |
| **macOS (Intel)** | `npm run build:mac:x64` | DMG + ZIP |
| **macOS (ARM)** | `npm run build:mac:arm64` | DMG + ZIP |
| **All** | `npm run build:all` | All target installers |

### Icon Generation

If icons need refreshing, use **ImageMagick**:
```bash
magick convert build/icon.png -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico
```

### Release Process

1. Update version in `package.json`
2. Update `RELEASE_NOTES_v*.md`
3. Commit changes
4. Create Git tag: `git tag v1.0.0`
5. Push with tags: `git push origin main --tags`
6. GitHub Actions will build and create release

---

## 🔒 Security

### Authentication & Authorization

**Password Security**:
- Scrypt hashing with salt
- Passwords never stored in plain text
- Session tokens encrypted using OS keychain

**Role-Based Access**:
- **Admin**: Full system access
- **Staff**: Limited access (no settings, user management, or closings approval)

**Session Management**:
```typescript
// Sessions encrypted using Electron's safeStorage API
// Leverages native OS keychain:
// - macOS: Keychain
// - Windows: DPAPI
```

### Security Best Practices

1. **Single Instance Lock**: Prevents multiple app instances (database corruption prevention)
2. **Transaction Management**: All multi-table writes use transactions
3. **Input Validation**: Zod schemas for all user inputs
4. **SQL Injection Prevention**: Prepared statements only
5. **XSS Protection**: React's built-in escaping + Content Security Policy

### Database Security

```typescript
// Future: SQLCipher encryption (planned)
// Current: OS-level file permissions + encrypted session storage
```

---

## 🔄 API Migration

### Migration Status: 57% Complete (13/23 modules)

The app is being refactored from monolithic Electron to:
- **Backend**: Standalone Node.js/Express REST API + WebSocket server
- **Frontend**: Modern web app (runs in browser or Electron)

### ✅ Completed Modules

REST endpoints available at `http://localhost:3000/api`:

1. `/api/auth` - Authentication
2. `/api/settings` - Shop configuration
3. `/api/dashboard` - Stats and analytics
4. `/api/clients` - Client management
5. `/api/inventory` - Product management
6. `/api/sales` - POS and sales
7. `/api/debts` - Debt tracking
8. `/api/exchange` - Currency exchange
9. `/api/expenses` - Expense tracking
10. `/api/recharge` - MTC/Alfa recharges
11. `/api/services` - OMT/Whish services
12. `/api/maintenance` - Repair tracking
13. `/api/currencies` - Currency management

### ⏳ Remaining Modules

High priority:
- `/api/closing` - Daily audit workflow
- `/api/suppliers` - Supplier management

Medium priority:
- `/api/rates` - Exchange rates
- `/api/users` - User management
- `/api/activity` - Activity logs

Low priority:
- `/api/reports` - PDF generation
- `/api/diagnostics` - DB diagnostics
- `/api/updater` - Auto-update

### Testing Migration

**Electron Mode** (all features):
```bash
npm run dev
```

**Browser Mode** (REST API):
```bash
cd backend && npm run dev    # Terminal 1
cd frontend && npm run dev   # Terminal 2
# Visit http://localhost:5173
```

---

## 🔧 Troubleshooting

### Common Issues

**Database Errors**:
```bash
# Missing columns
Check electron/db/migrations/ and apply manually

# Foreign key violations
window.api.diagnostics.foreignKeyCheck()
```

**Build Errors**:
```bash
# Native module issues
npm run rebuild
# or
npx electron-rebuild

# TypeScript errors
Check tsconfig.json and ensure all @types packages are installed
```

**Performance Issues**:
```bash
# Slow queries - check indexes
See electron/db/create_db.sql

# Memory leaks
Ensure cleanup in React useEffect hooks
Close database connections properly
```

**Docker Issues**:
```bash
# Reset everything
docker compose down -v
docker compose up --build
```

### Debug Mode

Enable detailed logging:
```bash
# Set environment variable
DEBUG=liratek:* npm run dev
```

View logs:
- **Electron**: DevTools Console (Ctrl+Shift+I / Cmd+Option+I)
- **Backend**: Terminal output
- **Database**: Check `activity_logs` table

---

## 📚 Additional Documentation

- **[CURRENT_SPRINT.md](docs/CURRENT_SPRINT.md)**: Active sprint tasks, roadmap, and recent completions
- **[RELEASE_NOTES_v1.0.0.md](RELEASE_NOTES_v1.0.0.md)**: Full changelog and platform downloads
- **Marketing Materials**: `docs/marketing/`
- **Document Templates**: `docs/templates/`

---

## 📊 Platform Vision

LiraTek aims to provide Lebanese phone shop owners with a robust, offline-capable management platform that handles the unique complexities of multi-currency markets and telecom services.

### Key Differentiators

- **Dual-Currency Native**: Built-in USD/LBP support with smart rounding
- **Telecom Services**: Integrated OMT, Whish, MTC, Alfa support
- **Offline-First**: Full functionality without internet
- **Audit Trail**: Comprehensive activity logging
- **Lebanese Market Focus**: Designed for local business needs

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Write tests for new features
4. Ensure all tests pass
5. Submit a pull request

---

## 📄 License

© 2025 LiraTek Team. All rights reserved.

---

## 📞 Support

For issues, questions, or feature requests:
- Create an issue on GitHub
- Check existing documentation
- Review test examples for usage patterns
