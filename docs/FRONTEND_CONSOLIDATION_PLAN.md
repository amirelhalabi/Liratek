# Frontend Consolidation Plan - @liratek/ui Package

**Status:** 📋 Planned (Not Started)  
**Priority:** Low (Future Enhancement)  
**Estimated Effort:** 22-29 hours (~3-4 days)  
**Created:** Feb 1, 2026

---

## 🎯 Objective

Consolidate frontend components into a shared `@liratek/ui` package (similar to `@liratek/core` for backend) to enable code reusability between Desktop (Electron) and Web applications.

---

## 📊 Current State Analysis

### Problem:

- Frontend code is tightly coupled to the `frontend/` folder
- No reusability between Desktop and Web deployments
- Duplication risk if we need multiple frontend builds
- No clear separation between "app shell" and "shared UI components"

### Current Structure:

```
frontend/src/
├── features/         ← Feature-specific pages (19 features, ~7000 LOC)
├── shared/           ← Reusable components (8 components)
├── config/           ← Constants & configuration
├── api/              ← API client layer (Desktop vs Web logic)
├── app/              ← App wrapper (App.tsx)
├── types/            ← TypeScript types
└── assets/           ← Static assets
```

---

## 🎨 Proposed Architecture

### New Package Structure:

```
packages/
├── core/              [EXISTS] Backend services, repos, DB logic
└── ui/                [NEW] Shared frontend components & utilities

frontend/               [SLIMMED DOWN] Desktop app shell
backend/                [EXISTS] Web app backend
web-frontend/           [FUTURE] Web app shell
```

---

## 📦 Package Structure: @liratek/ui

```
packages/ui/
├── package.json
├── tsconfig.json
├── vite.config.ts         ← Build with Vite in library mode
├── tailwind.config.js     ← Shared Tailwind config
├── src/
│   ├── index.ts           ← Main exports
│   │
│   ├── components/        ← Reusable UI components
│   │   ├── ui/
│   │   │   ├── Select.tsx              [MOVE FROM frontend/src/shared/components/ui/]
│   │   │   ├── NotificationCenter.tsx  [MOVE]
│   │   │   ├── Button.tsx              [NEW - Create standardized button]
│   │   │   ├── Input.tsx               [NEW - Create standardized input]
│   │   │   ├── Modal.tsx               [NEW - Extract modal pattern]
│   │   │   ├── Card.tsx                [NEW - Extract card pattern]
│   │   │   └── index.ts
│   │   │
│   │   ├── layouts/
│   │   │   ├── MainLayout.tsx          [MOVE FROM frontend/src/shared/components/layouts/]
│   │   │   ├── Sidebar.tsx             [MOVE]
│   │   │   ├── TopBar.tsx              [MOVE]
│   │   │   ├── PageHeader.tsx          [MOVE]
│   │   │   └── index.ts
│   │   │
│   │   └── features/      ← Feature-specific components (business logic)
│   │       ├── auth/
│   │       │   ├── Login.tsx           [MOVE FROM frontend/src/features/auth/]
│   │       │   └── AuthContext.tsx     [MOVE]
│   │       ├── clients/
│   │       │   ├── ClientList.tsx      [MOVE]
│   │       │   └── ClientForm.tsx      [MOVE]
│   │       ├── debts/
│   │       │   └── Debts.tsx           [MOVE]
│   │       ├── inventory/
│   │       │   ├── ProductList.tsx     [MOVE]
│   │       │   └── ProductForm.tsx     [MOVE]
│   │       ├── sales/
│   │       │   └── POS.tsx             [MOVE]
│   │       ├── expenses/
│   │       ├── closing/
│   │       ├── dashboard/
│   │       ├── exchange/
│   │       ├── maintenance/
│   │       ├── recharge/
│   │       ├── services/
│   │       ├── settings/
│   │       └── index.ts
│   │
│   ├── hooks/             ← Custom React hooks
│   │   ├── useAuth.ts                  [EXTRACT FROM AuthContext]
│   │   ├── useCurrencies.ts            [MOVE FROM frontend/src/features/closing/hooks/]
│   │   ├── useDrawerAmounts.ts         [MOVE]
│   │   ├── useSystemExpected.ts        [MOVE]
│   │   ├── useLocalStorage.ts          [NEW - Extract pattern]
│   │   └── index.ts
│   │
│   ├── utils/             ← Utility functions
│   │   ├── appEvents.ts                [MOVE FROM frontend/src/shared/utils/]
│   │   ├── formatting.ts               [NEW - Extract number/currency formatting]
│   │   ├── validation.ts               [NEW - Extract validation helpers]
│   │   ├── receiptFormatter.ts         [MOVE FROM frontend/src/features/sales/utils/]
│   │   ├── closingReportGenerator.ts   [MOVE FROM frontend/src/features/closing/utils/]
│   │   └── index.ts
│   │
│   ├── config/            ← Configuration & constants
│   │   ├── constants.ts                [MOVE FROM frontend/src/config/]
│   │   ├── denominations.ts            [MOVE]
│   │   └── index.ts
│   │
│   ├── types/             ← TypeScript types & interfaces
│   │   ├── index.ts                    [MOVE FROM frontend/src/types/index.ts]
│   │   ├── api.ts                      [NEW - API response types]
│   │   ├── models.ts                   [NEW - Domain models]
│   │   └── electron.d.ts               [MOVE - Keep for desktop-specific types]
│   │
│   └── styles/            ← Global styles
│       ├── globals.css                 [MOVE FROM frontend/src/index.css]
│       └── tailwind.css                [NEW - Tailwind base]
│
└── dist/                  ← Built package output
```

---

## 🔑 Critical Innovation: API Adapter Pattern

### The Problem:

Current code has mixed API access patterns:

- **Desktop:** `window.api.getSale()`
- **Web:** `backendApi.getSale()`

### The Solution:

Create a unified API adapter interface that both apps implement differently.

#### 1. Define API Interface in @liratek/ui

```typescript
// packages/ui/src/api/types.ts
export interface ApiAdapter {
  // Auth
  login(username: string, password: string): Promise<LoginResult>;
  logout(): Promise<void>;

  // Sales
  getSale(id: number): Promise<Sale>;
  getSaleItems(id: number): Promise<SaleItem[]>;
  processSale(data: SaleData): Promise<ProcessSaleResult>;

  // Debts
  getDebtors(): Promise<Debtor[]>;
  getClientDebtHistory(clientId: number): Promise<DebtHistory[]>;

  // Clients
  listClients(search?: string): Promise<Client[]>;
  createClient(data: ClientData): Promise<Client>;

  // ... all other API methods
}
```

#### 2. Update Components to Use Adapter

```typescript
// packages/ui/src/components/features/debts/Debts.tsx
import { useApi } from "@liratek/ui/hooks";

export function Debts() {
  const api = useApi(); // Gets injected adapter

  const loadSaleDetails = async (saleId: number) => {
    const sale = await api.getSale(saleId); // Works for both Desktop & Web!
    const items = await api.getSaleItems(saleId);
    // ...
  };
}
```

#### 3. Desktop Implementation

```typescript
// frontend/src/api/adapter.ts
import { ApiAdapter } from "@liratek/ui/api";

export class ElectronApiAdapter implements ApiAdapter {
  constructor(private electronApi: any) {}

  async getSale(id: number) {
    return this.electronApi.getSale(id); // Uses Electron IPC
  }

  async getSaleItems(id: number) {
    return this.electronApi.getSaleItems(id);
  }

  // ... implement all other methods
}
```

#### 4. Web Implementation (Future)

```typescript
// web-frontend/src/api/adapter.ts
import { ApiAdapter } from "@liratek/ui/api";

export class HttpApiAdapter implements ApiAdapter {
  async getSale(id: number) {
    const res = await fetch(`/api/sales/${id}`);
    return res.json(); // Uses HTTP requests
  }

  async getSaleItems(id: number) {
    const res = await fetch(`/api/sales/${id}/items`);
    return res.json();
  }

  // ... implement all other methods
}
```

#### 5. Usage in App

```typescript
// frontend/src/main.tsx (Desktop)
import { ApiProvider } from '@liratek/ui';
import { ElectronApiAdapter } from './api/adapter';

const apiAdapter = new ElectronApiAdapter(window.api);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ApiProvider adapter={apiAdapter}>
    <App />
  </ApiProvider>
);
```

```typescript
// web-frontend/src/main.tsx (Web - Future)
import { ApiProvider } from '@liratek/ui';
import { HttpApiAdapter } from './api/adapter';

const apiAdapter = new HttpApiAdapter();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ApiProvider adapter={apiAdapter}>
    <App />
  </ApiProvider>
);
```

---

## 📋 Detailed Migration Plan

### PHASE 1: Setup @liratek/ui Package (2-3 hours)

**Step 1.1: Create Package Structure**

```bash
mkdir -p packages/ui/src/{components/{ui,layouts,features},hooks,utils,config,types,styles}
cd packages/ui
npm init -y
```

**Step 1.2: Configure Build Tools**

- Create `tsconfig.json` (extends base config)
- Create `vite.config.ts` (library mode)
- Create `tailwind.config.js`
- Add build scripts to `package.json`

**Step 1.3: Install Dependencies**

```bash
npm install react react-dom react-router-dom --save-peer
npm install @headlessui/react lucide-react recharts clsx tailwind-merge zod
npm install -D typescript vite tailwindcss @types/react @types/react-dom
```

**Step 1.4: Create Barrel Exports**

- `src/index.ts` - Main export file
- `src/components/index.ts`
- `src/hooks/index.ts`
- `src/utils/index.ts`

---

### PHASE 2: Move Shared Components (3-4 hours)

**Priority Order (Low Risk → High Risk):**

**2.1: Move Simple UI Components (LOWEST RISK)**

```
frontend/src/shared/components/ui/Select.tsx
  → packages/ui/src/components/ui/Select.tsx

frontend/src/shared/components/ui/NotificationCenter.tsx
  → packages/ui/src/components/ui/NotificationCenter.tsx
```

- Update imports in @liratek/ui
- Test build: `npm run build`
- Update frontend to use: `import { Select } from '@liratek/ui'`

**2.2: Move Layout Components (LOW RISK)**

```
frontend/src/shared/components/layouts/*.tsx
  → packages/ui/src/components/layouts/*.tsx
```

**2.3: Move Utilities & Config (LOW RISK)**

```
frontend/src/shared/utils/*.ts → packages/ui/src/utils/
frontend/src/config/*.ts → packages/ui/src/config/
```

**2.4: Move Types (MEDIUM RISK)**

```
frontend/src/types/*.ts → packages/ui/src/types/
```

- Keep `electron.d.ts` separate or make it optional

---

### PHASE 3: Abstract API Layer (4-5 hours) ⚠️ **CRITICAL**

This is the most important phase!

**3.1: Create API Interface in @liratek/ui**

- Define `ApiAdapter` interface with ALL API methods
- Create `useApi()` hook for components to consume

**3.2: Update Components to Use Adapter**

- Replace `window.api` calls with `useApi()` hook
- Replace direct `backendApi` calls with adapter

**3.3: Implement Desktop Adapter**

- Create `ElectronApiAdapter` class
- Wrap all `window.api` calls
- Test in desktop app

**3.4: Create API Provider**

- Create context provider for API adapter
- Inject adapter at app root

---

### PHASE 4: Move Feature Components (8-10 hours) **HIGHEST COMPLEXITY**

**Strategy:** Move one feature at a time, test thoroughly

**4.1: Start with Simplest Feature (e.g., Clients)**

```
frontend/src/features/clients/
  → packages/ui/src/components/features/clients/
```

**4.2: Update API Calls**

- Replace `window.api` with `useApi()` hook
- Replace direct `backendApi` calls with adapter

**4.3: Test in Desktop App**

```bash
cd frontend && npm run dev
```

**4.4: Repeat for Each Feature**

Priority order (simple → complex):

1. ✅ Clients (LOW)
2. ✅ Inventory (LOW)
3. ✅ Expenses (MEDIUM)
4. ✅ Debts (MEDIUM)
5. ✅ Recharge (MEDIUM)
6. ✅ Sales/POS (HIGH - complex state management)
7. ✅ Closing (HIGH - multi-step workflow)
8. ✅ Dashboard (HIGH - multiple data sources)
9. ✅ Settings (HIGH - many sub-pages)

---

### PHASE 5: Update Frontend to Use @liratek/ui (2-3 hours)

**5.1: Update package.json**

```json
{
  "dependencies": {
    "@liratek/ui": "workspace:*"
  }
}
```

**5.2: Simplify main.tsx**

```typescript
import '@liratek/ui/styles';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
```

**5.3: Update App.tsx**

```typescript
import { BrowserRouter } from 'react-router-dom';
import { ApiProvider } from '@liratek/ui';
import { ElectronApiAdapter } from './api/adapter';
import { AppRoutes } from './router';

const apiAdapter = new ElectronApiAdapter(window.api);

export function App() {
  return (
    <ApiProvider adapter={apiAdapter}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ApiProvider>
  );
}
```

**5.4: Setup Routes**

```typescript
// frontend/src/router/index.tsx
import { Routes, Route } from 'react-router-dom';
import {
  Login,
  Dashboard,
  Debts,
  Clients,
  // ... import all from @liratek/ui
} from '@liratek/ui';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Dashboard />} />
      <Route path="/debts" element={<Debts />} />
      {/* ... all other routes */}
    </Routes>
  );
}
```

---

### PHASE 6: Testing & Validation (3-4 hours)

**6.1: Unit Tests**

- Test @liratek/ui components in isolation
- Mock ApiAdapter for testing

**6.2: Integration Tests**

- Test Desktop app with Electron adapter
- Verify all features work

**6.3: Build Tests**

```bash
npm run build              # Should build @liratek/ui first
npm run build:frontend     # Then build frontend
npm run electron:build     # Then Electron app
```

---

## 🎯 Benefits After Consolidation

### 1. **Code Reusability** ✅

- Single source of truth for UI components
- Share 95%+ of code between Desktop and Web
- Only API layer differs (Electron IPC vs HTTP)

### 2. **Better Separation of Concerns** ✅

```
@liratek/core    → Backend logic (Services, DB, Repos)
@liratek/ui      → Frontend components (UI, hooks, utils)
frontend/        → Desktop app shell (Electron-specific)
backend/         → Web backend (Express server)
web-frontend/    → Web app shell (HTTP client)
```

### 3. **Easier Testing** ✅

- Test @liratek/ui components independently
- Mock API adapter in tests
- No Electron or backend required for UI tests

### 4. **Simplified Maintenance** ✅

- Bug fix in one place → affects both apps
- Feature added once → available everywhere
- Consistent UI/UX across platforms

### 5. **Build Optimization** ✅

```bash
# Build once, use everywhere
npm run build:ui        # Build @liratek/ui
npm run build:desktop   # Use built UI
npm run build:web       # Use same built UI
```

### 6. **Future-Proof Architecture** ✅

- Easy to add mobile app (React Native)
- Easy to add another web client
- Easy to create white-label versions

---

## ⚠️ Risks & Mitigation

### Risk 1: Breaking Changes During Migration

**Mitigation:**

- Move incrementally, one feature at a time
- Keep both old and new code during transition
- Thorough testing after each move

### Risk 2: Build Complexity

**Mitigation:**

- Use Vite for fast builds
- Set up proper build order in package.json scripts
- Document build process clearly

### Risk 3: Import Path Changes

**Mitigation:**

- Use TypeScript path aliases
- Update imports systematically (find/replace)
- Use linter to catch broken imports

### Risk 4: API Adapter Overhead

**Mitigation:**

- Keep adapter interface thin
- Use TypeScript for type safety
- Create comprehensive adapter tests

### Risk 5: Tailwind CSS Configuration

**Mitigation:**

- Share Tailwind config between packages
- Ensure CSS is properly bundled with @liratek/ui
- Test styles in both apps

---

## 📊 Effort Estimation

| Phase     | Description               | Estimated Time  | Risk Level    |
| --------- | ------------------------- | --------------- | ------------- |
| 1         | Setup @liratek/ui package | 2-3 hours       | LOW           |
| 2         | Move shared components    | 3-4 hours       | LOW           |
| 3         | Abstract API layer        | 4-5 hours       | HIGH          |
| 4         | Move feature components   | 8-10 hours      | MEDIUM        |
| 5         | Update frontend shell     | 2-3 hours       | LOW           |
| 6         | Testing & validation      | 3-4 hours       | MEDIUM        |
| **TOTAL** | **Full migration**        | **22-29 hours** | **~3-4 days** |

---

## 🚀 Recommended Approach

### Option A: Incremental Migration (RECOMMENDED)

**Timeline:** 3-4 weeks, working part-time

- Week 1: Phase 1-2 (Setup + Simple components)
- Week 2: Phase 3 (API abstraction) ← Most critical
- Week 3: Phase 4 (Feature components)
- Week 4: Phase 5-6 (Integration + Testing)

**Pros:**

- Less risky, can pause anytime
- Desktop app keeps working throughout
- Learn and adjust as you go

**Cons:**

- Takes longer
- Temporary code duplication

---

### Option B: Big Bang Migration

**Timeline:** 3-4 days, full-time focus

- Day 1: Phase 1-2
- Day 2: Phase 3-4 (first half)
- Day 3: Phase 4 (second half) + Phase 5
- Day 4: Phase 6 + Buffer

**Pros:**

- Faster completion
- No duplicate code period
- Cleaner end result

**Cons:**

- Desktop app broken during migration
- Higher risk of issues
- Requires focused time block

---

## 💡 Quick Win Alternative: API Adapter Only (4-5 hours)

**Update (Feb 2026):** We effectively implemented the “quick win” using `frontend/src/api/backendApi.ts` as a facade. The next required step is to harden it (see T-26) so Desktop never accidentally uses HTTP when the backend server is not running.

If full migration is too much, implement just Phase 3 (API Adapter Pattern) for immediate benefits:

```typescript
// Add this to frontend/src/api/adapter.ts
export const api = {
  // Auth
  login: (username, password) => window.api.login(username, password),
  logout: () => window.api.logout(),

  // Sales
  getSale: (id) => window.api.getSale(id),
  getSaleItems: (id) => window.api.getSaleItems(id),
  processSale: (data) => window.api.processSale(data),

  // Debts
  getDebtors: () => window.api.getDebtors(),
  getClientDebtHistory: (id) => window.api.getClientDebtHistory(id),

  // ... wrap all window.api calls
};

// Update components to use:
import { api } from "@/api/adapter";
const sale = await api.getSale(id); // Instead of window.api.getSale(id)
```

**Benefits:**

- 80% of the benefit with 20% of the effort
- Easy to switch to HTTP adapter later
- Minimal disruption to current work
- Prepares codebase for future migration

---

## 📝 Decision Log

**Date:** Feb 1, 2026  
**Decision:** Save for later, continue with desktop app development  
**Rationale:** Main focus is desktop app, defer architectural work until web deployment is needed  
**Next Review:** When web app deployment is planned

**Update - Feb 1, 2026 (Later same day):**

- ✅ Completed T-20 Phase 1: Window.api migration (59 calls migrated)
- ✅ Many components now call a single dual‑mode facade: `frontend/src/api/backendApi.ts`
- ⚠️ **Important:** the facade is currently only _partially hardened_.
  - Some exports route correctly via `isElectron()` (IPC)
  - Others can still fall back to HTTP (`http://localhost:3000`) in Desktop mode if not guarded
- ✅ This work is a stepping stone toward full `@liratek/ui` consolidation
- 💡 We created **T-26 (High Priority)** to harden `backendApi.ts` in an enterprise-grade way (adapter/helper + parity audit + tests + CI gate)

---

## 📚 Related Documents

- [CURRENT_SPRINT.md](./CURRENT_SPRINT.md) - Current sprint tasks
- [Backend Consolidation](../packages/core/README.md) - Example of successful consolidation

---

## ✅ Checklist for When Starting Migration

- [ ] Review this plan thoroughly
- [ ] Set aside dedicated time block (3-4 days)
- [ ] Create feature branch: `feature/frontend-consolidation`
- [ ] Backup current working code
- [ ] Complete Phase 1: Setup @liratek/ui
- [ ] Complete Phase 2: Move shared components
- [ ] Complete Phase 3: API adapter pattern (CRITICAL)
- [ ] Complete Phase 4: Move feature components
- [ ] Complete Phase 5: Update frontend shell
- [ ] Complete Phase 6: Testing & validation
- [ ] Update documentation
- [ ] Merge to main branch

---

**End of Document**
