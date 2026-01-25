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

### Installation

```bash
# Clone the repository
git clone https://github.com/amirelhalabi/Liratek.git
cd Liratek

# Enable Corepack (for Yarn 4)
corepack enable

# Install dependencies
yarn install
```

### 🚀 Running the Application

#### Desktop Mode (Electron - Recommended)
```bash
npm run dev
```
This starts:
- Frontend dev server (Vite on port 5173)
- Electron desktop app (loads from Vite with hot reload)

#### Browser Mode (Web Development)
```bash
npm run dev:web
```
This starts:
- Backend API server (port 3000)
- Frontend dev server (port 5173)
- Open http://localhost:5173 in browser

#### Docker Mode (Production-like)
```bash
npm run dev:docker
```

### 🔑 Default Login

- **Username**: `admin`
- **Password**: `admin123`

### 🔧 Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Desktop app (Electron + Vite) |
| `npm run dev:web` | Browser mode (Backend + Frontend) |
| `npm run dev:frontend` | Frontend only (port 5173) |
| `npm run dev:backend` | Backend API only (port 3000) |
| `npm run build` | Build everything (core + frontend + electron) |
| `npm run build:core` | Build shared @liratek/core package |
| `npm test` | Run all tests |
| `npm run lint` | Lint all code |
| `npm run typecheck` | TypeScript type checking |

### 🎯 What Mode to Use

**Use Desktop Mode (Electron) when:**
- Developing desktop features
- Need native OS integration
- Testing IPC handlers
- Daily development

**Use Browser Mode when:**
- Developing REST API
- Testing without Electron
- Cloud deployment testing
- Need backend-only features

- Backend: `http://localhost:3000`
- Frontend: `http://localhost:5173`

### Docker (Production-like)

```bash
docker compose up --build
```

---

## 🏗️ Architecture

LiraTek is built as a **dual-mode application** that can run as both a desktop app (Electron) and a web app (Browser), sharing the same business logic through the `@liratek/core` package.

### Monorepo Structure

```
liratek/
├── packages/core/           # 🔥 Shared business logic (@liratek/core)
│   ├── repositories/        # Database access layer
│   ├── services/            # Business logic
│   └── utils/               # Crypto, logging, errors, barcode
├── electron-app/            # Desktop Electron wrapper
│   ├── main.ts              # Main process (Node.js)
│   ├── preload.ts           # IPC bridge (contextBridge)
│   └── handlers/            # IPC handlers (uses @liratek/core)
├── frontend/                # React UI (works in both modes)
│   └── src/
│       ├── features/        # Feature modules (POS, Inventory, etc.)
│       └── api/             # API abstraction (window.api vs REST)
├── backend/                 # REST API server (for browser mode)
│   └── src/
│       └── api/             # Express routes (uses @liratek/core)
└── docs/                    # Documentation
```

### Data Flow

#### Desktop Mode (Electron)
```
Frontend (React) 
  → window.api (preload.ts contextBridge)
    → ipcMain handlers (electron-app/handlers/)
      → Services (@liratek/core/services)
        → Repositories (@liratek/core/repositories)
          → SQLite (better-sqlite3)
```

#### Browser Mode (Express)
```
Frontend (React)
  → HTTP REST API (backend/src/api/)
    → Services (@liratek/core/services)
      → Repositories (@liratek/core/repositories)
        → SQLite (better-sqlite3)
```

### Key Architectural Decisions

1. **@liratek/core Package**: All business logic (services, repositories, utilities) is shared between Electron and Web backends, eliminating ~9,336 lines of duplicate code.

2. **Frontend Abstraction**: The React frontend detects its environment and uses either `window.api` (Electron) or `fetch` (Browser) transparently.

3. **Single Database**: Both modes can point to the same SQLite database using environment variables or config files.

4. **Session Storage**: Encrypted JSON files for session tokens (scrypt-derived AES-256-GCM)

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

### Database Encryption (SQLCipher)

**Status**: Infrastructure implemented, SQLCipher build required

LiraTek includes built-in support for database encryption using SQLCipher. The encryption system is fully implemented but requires a SQLCipher-enabled build of better-sqlite3.

#### Current Implementation

**Key Management** (`@liratek/core`):
- Automatic key resolution from multiple sources
- Secure key storage outside repository
- Graceful fallback when encryption not available

**Resolution Order**:
1. `DATABASE_KEY` environment variable
2. `~/Documents/LiraTek/db-key.txt` file
3. None (database runs unencrypted)

#### Enabling Encryption

**Option 1: Environment Variable**
```bash
# Generate a secure key (64 characters recommended)
DATABASE_KEY=$(openssl rand -hex 32)

# Desktop mode
DATABASE_KEY="your-secure-key-here" npm run dev

# Web mode (add to backend/.env)
echo "DATABASE_KEY=your-secure-key-here" >> backend/.env
```

**Option 2: Configuration File (Recommended)**
```bash
# Generate and save key
openssl rand -hex 32 > ~/Documents/LiraTek/db-key.txt
chmod 600 ~/Documents/LiraTek/db-key.txt

# Application will automatically use this key on next start
npm run dev
```

#### Using SQLCipher

To enable actual encryption, you need a SQLCipher-enabled build of better-sqlite3.

⚠️ **Note**: @journeyapps/sqlcipher is NOT compatible - it uses a completely different async API.

**Option 1: Build better-sqlite3 with SQLCipher (Advanced)**

This requires SQLCipher development libraries installed on your system:

```bash
# macOS (using Homebrew)
brew install sqlcipher

# Build better-sqlite3 with SQLCipher
npm install better-sqlite3 --build-from-source --sqlite3=$(brew --prefix sqlcipher)

# Rebuild for Electron
cd electron-app
npm rebuild better-sqlite3 --runtime=electron --target=31.0.0
```

**Option 2: Use Pre-built Package (If Available)**

Search for community packages like `better-sqlite3-sqlcipher` or pre-compiled builds.

**Option 3: Docker/Container with SQLCipher**

Build a Docker image with SQLCipher and deploy as containerized application.

#### Migrating Existing Database

To encrypt an existing database:

```bash
# Backup current database
cp ~/Library/Application\ Support/liratek/phone_shop.db ~/Desktop/phone_shop_backup.db

# Create migration script
node migrate_to_encrypted.js
```

**migrate_to_encrypted.js**:
```javascript
const Database = require('better-sqlite3'); // Must be SQLCipher-enabled build
const fs = require('fs');

const oldDb = '~/Library/Application Support/liratek/phone_shop.db';
const newDb = '~/Library/Application Support/liratek/phone_shop_encrypted.db';
const key = fs.readFileSync('~/Documents/LiraTek/db-key.txt', 'utf8').trim();

// Open unencrypted database
const db = new Database(oldDb);

// Attach encrypted database
db.exec(`ATTACH DATABASE '${newDb}' AS encrypted KEY '${key}';`);

// Export to encrypted database
db.exec('SELECT sqlcipher_export("encrypted");');

// Detach and close
db.exec('DETACH DATABASE encrypted;');
db.close();

console.log('✅ Migration complete. Backup old DB and rename new DB.');
```

#### Security Warnings

⚠️ **Key Loss = Data Loss**: If you lose the encryption key, the database cannot be decrypted.

⚠️ **Backup Keys Securely**: Store keys in a password manager or secure location.

⚠️ **Don't Commit Keys**: Keys in git history compromise security.

#### Verification

Check encryption status in application logs:
```
🔐 SQLCipher: keySource=file:db-key.txt, applied=true, supported=true
```

- `keySource`: Where the key was loaded from
- `applied`: Whether encryption was applied
- `supported`: Whether SQLCipher is available

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

## 🐛 Troubleshooting

### Electron won't start
```bash
cd electron-app
npm rebuild better-sqlite3 --runtime=electron --target=31.0.0
npm run build
```

### Frontend not loading
- Ensure frontend dev server is running (port 5173)
- Check `npm run dev:frontend` in separate terminal

### Database errors
- Database auto-creates in: `~/Library/Application Support/@liratek/electron-app/`
- Delete database to reset: `rm ~/Library/Application\ Support/@liratek/electron-app/*.db`

### Build fails with TypeScript errors
- Ensure `@liratek/core` is built first: `npm run build:core`
- Clean and rebuild: `npm run clean && yarn install && npm run build`

---

## 📚 Additional Documentation

- **[CURRENT_SPRINT.md](docs/CURRENT_SPRINT.md)**: Active sprint tasks, roadmap, and recent completions
- **Marketing Materials**: `docs/marketing/` - Product marketing and promotion guides
- **Document Templates**: `docs/templates/` - Business document templates (quotations, etc.)
- **Archive**: `docs/archive/` - Historical documentation for reference

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
