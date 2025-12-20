# Liratek POS - Agent Context

**Project:** Liratek POS System  
**Last Updated:** December 18, 2025  
**Status:** All Core Phases Complete (Monorepo Deferred)

---

## Project Overview

Liratek is an enterprise-grade Electron POS system for a Lebanese phone shop with:

- **Architecture:** Electron (backend) + React 19 + TypeScript 5.9.3
- **Database:** SQLite with better-sqlite3
- **Testing:** Jest with 372 tests, 99% service coverage
- **Logging:** Pino structured logging

### Architecture Layers

```
┌──────────────────────────────────────────────────┐
│         Presentation Layer (React)               │
│     src/features/, src/shared/components/        │
└──────────────────────────────────────────────────┘
                     ↓ IPC
┌──────────────────────────────────────────────────┐
│         IPC Handlers (Thin wrappers)             │
│            electron/handlers/                    │
└──────────────────────────────────────────────────┘
                     ↓
┌──────────────────────────────────────────────────┐
│       Business Logic (Services)                  │
│           electron/services/                     │
└──────────────────────────────────────────────────┘
                     ↓
┌──────────────────────────────────────────────────┐
│       Data Access (Repositories)                 │
│       electron/database/repositories/            │
└──────────────────────────────────────────────────┘
                     ↓
┌──────────────────────────────────────────────────┐
│            Database (SQLite)                     │
└──────────────────────────────────────────────────┘
```

---

## Current File Structure

```
liratek/
├── electron/                        # Main Process (Backend)
│   ├── main.ts                     # App entry, window creation, IPC registration
│   ├── preload.ts                  # Secure IPC bridge (contextBridge)
│   ├── session.ts                  # Session management + safeStorage encryption
│   ├── sync.ts                     # Background sync processor
│   │
│   ├── config/                     # Configuration system
│   │   ├── index.ts               # Zod-validated config loading
│   │   └── schema.ts              # Config schema definitions
│   │
│   ├── database/repositories/      # Data access layer (13 repositories)
│   │   ├── BaseRepository.ts      # Generic CRUD, pagination, soft delete
│   │   ├── UserRepository.ts, ProductRepository.ts, ClientRepository.ts
│   │   ├── SalesRepository.ts, DebtRepository.ts, ExchangeRepository.ts
│   │   ├── FinancialServiceRepository.ts, RateRepository.ts
│   │   ├── CurrencyRepository.ts, RechargeRepository.ts
│   │   ├── MaintenanceRepository.ts, SettingsRepository.ts
│   │   └── index.ts               # Re-exports
│   │
│   ├── services/                   # Business logic layer (16 services)
│   │   ├── AuthService.ts, InventoryService.ts, ClientService.ts
│   │   ├── DebtService.ts, SalesService.ts, ExchangeService.ts
│   │   ├── FinancialService.ts, RateService.ts, CurrencyService.ts
│   │   ├── RechargeService.ts, MaintenanceService.ts, ReportService.ts
│   │   ├── SettingsService.ts, ExpenseService.ts, ClosingService.ts
│   │   ├── ActivityService.ts
│   │   └── index.ts               # Re-exports + singletons
│   │
│   ├── handlers/                   # 13 IPC Handler Modules (thin wrappers)
│   │   ├── authHandlers.ts, clientHandlers.ts, currencyHandlers.ts
│   │   ├── dbHandlers.ts, debtHandlers.ts, exchangeHandlers.ts
│   │   ├── inventoryHandlers.ts, maintenanceHandlers.ts, omtHandlers.ts
│   │   ├── rateHandlers.ts, rechargeHandlers.ts, reportHandlers.ts
│   │   ├── salesHandlers.ts
│   │   └── __tests__/             # Handler unit tests
│   │
│   ├── db/
│   │   ├── index.ts               # Database connection singleton
│   │   ├── create_db.sql          # Full schema (20+ tables)
│   │   └── migrate.ts             # Migration runner
│   │
│   └── utils/
│       ├── crypto.ts              # Password hashing (scrypt)
│       ├── errors.ts              # Custom error classes
│       └── logger.ts              # Pino structured logging
│
├── src/                            # Renderer Process (Frontend)
│   ├── main.tsx                   # React entry point
│   ├── index.css                  # Tailwind imports
│   │
│   ├── app/                       # App entry
│   │   ├── App.tsx                # Root component + router
│   │   └── App.css
│   │
│   ├── features/                  # Feature modules
│   │   ├── auth/                  # Login, AuthContext
│   │   ├── dashboard/             # Dashboard page
│   │   ├── sales/                 # POS, receipt formatter
│   │   ├── inventory/             # Product management
│   │   ├── clients/               # Client management
│   │   ├── debts/                 # Debt tracking
│   │   ├── exchange/              # Currency exchange
│   │   ├── expenses/              # Expense tracking
│   │   ├── services/              # OMT/Whish services
│   │   ├── recharge/              # Mobile recharge
│   │   ├── maintenance/           # Device repair
│   │   ├── closing/               # Daily closing/opening
│   │   └── settings/              # Settings pages
│   │
│   ├── shared/                    # Shared code
│   │   ├── components/ui/         # NotificationCenter
│   │   ├── components/layouts/    # MainLayout, Sidebar, TopBar
│   │   └── utils/                 # appEvents
│   │
│   ├── types/                     # TypeScript interfaces
│   └── config/                    # Frontend constants
│
├── packages/shared/                # Shared types, constants, validators
│
└── __mocks__/                      # Jest mocks
```

---

## Completed Phases

### Phase 1: Foundation ✅

- Crypto utils extraction (`electron/utils/crypto.ts`)
- Custom error classes (`electron/utils/errors.ts`)
- Zod-validated config system (`electron/config/`)
- Shared package (`packages/shared/`)
- Path aliases (`@/*`, `@shared/*`)

### Phase 2: Backend Refactor ✅

- **13 Repositories** - Data access layer with BaseRepository pattern
- **16 Services** - Business logic layer
- **13 Handlers refactored** - Thin IPC wrappers delegating to services

### Phase 3: Frontend Refactor ✅

- Feature-based directory structure (`src/features/`)
- Shared components moved to `src/shared/`
- App entry moved to `src/app/`
- All imports updated

### Phase 4: Quality & Polish ✅

- 372 tests passing across 35 test suites
- 99% service layer coverage
- Pino structured logging in all handlers
- Handler tests for all 13 handlers

### Phase 5: Monorepo Split ⏸️ (DEFERRED)

- Target: `apps/desktop`, `packages/db`, `packages/shared`
- Postponed for future development cycle

---

## Success Criteria Status

| Criterion                            | Status  |
| ------------------------------------ | ------- |
| Path aliases (no `../../../`)        | ✅ Done |
| Repository pattern (13 repositories) | ✅ Done |
| Service layer (16 services)          | ✅ Done |
| Thin handlers (<50 lines avg)        | ✅ Done |
| Shared types (`packages/shared/`)    | ✅ Done |
| 70%+ test coverage (99% achieved)    | ✅ Done |
| Environment config                   | ✅ Done |
| Structured logging (Pino)            | ✅ Done |
| Feature-based frontend               | ✅ Done |
| Session encryption (safeStorage)     | ✅ Done |
| Password hashing (Scrypt)            | ✅ Done |
| Role-based access (requireRole)      | ✅ Done |
| Activity logging                     | ✅ Done |

---

## Security Features

| Feature            | Implementation                                       |
| ------------------ | ---------------------------------------------------- |
| Session Encryption | `safeStorage` API for OS keychain                    |
| Password Hashing   | Scrypt with random salt                              |
| Password Migration | Auto-migrate plain text → scrypt on login            |
| Role-Based Access  | `requireRole()` checks in admin handlers             |
| Activity Logging   | All critical actions logged to `activity_logs` table |

---

## Key Files Reference

### Backend Entry Points

- `electron/main.ts` - App lifecycle, IPC registration
- `electron/preload.ts` - Secure context bridge
- `electron/db/index.ts` - Database singleton

### Service Layer

- `electron/services/index.ts` - All service singletons
- Pattern: `get[Service]()` returns singleton instance

### Repository Layer

- `electron/database/repositories/index.ts` - All repository exports
- Pattern: Extends `BaseRepository<Entity>`

### Frontend Entry Points

- `src/main.tsx` - React entry
- `src/app/App.tsx` - Router + layout

---

## Testing

```bash
# Run all tests
yarn test

# Run with coverage
yarn test --coverage

# Run specific test file
yarn jest path/to/test.ts
```

**Current Stats:**

- 35 test suites
- 372 tests passing
- 99% service layer coverage

---

## Development Commands

```bash
# Start development
yarn dev

# Build for production
yarn build

# Format code
yarn format

# Lint
yarn lint
```

---

**Document Purpose:** Context for AI agents working on this codebase  
**Last Updated:** December 18, 2025
