# Frontend Consolidation Plan - @liratek/ui Package

**Status:** 🚧 In Progress  
**Priority:** Low (Future Enhancement)  
**Estimated Effort:** 22-29 hours (~3-4 days)  
**Created:** Feb 1, 2026

---

## 🎯 Objective

Consolidate frontend components into a shared `@liratek/ui` package (similar to `@liratek/core` for backend) to enable code reusability between Desktop (Electron) and Web applications.

**Definition of Done (for @liratek/ui):**

- `@liratek/ui` builds successfully in isolation and is consumed by the desktop shell without local path hacks.
- CSS delivery is explicit and documented (either precompiled CSS shipped by `@liratek/ui` or app shell handles Tailwind build).
- Public API surface is stable: exported components, hooks, config, and types are documented in `src/index.ts`.
- Adapter contract matches the current dual-mode facade in `frontend/src/api/backendApi.ts` to avoid duplication.
- At least one adapter-level test validates routing behavior (Electron vs HTTP) and error propagation.

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

**Module Boundary Decision (current):**

- Keep `@liratek/ui` limited to shared primitives/layouts/hooks/utils/config/types.
- Keep feature pages and routing inside the app shell (`frontend/`) to minimize risk.
- Defer moving feature pages until a later phase if needed.
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

**Asset Handling (decide before moving):**

- Option A: keep runtime assets (images/fonts) in app shells and pass URLs down as props.
- Option B: move assets into `@liratek/ui/src/assets` and bundle them as part of the library build.
- Document whichever option is chosen to avoid mixed patterns.

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

**Adapter contract alignment:**

- The adapter interface should be generated from or at least match the surface of `frontend/src/api/backendApi.ts` so that the UI package does not invent a parallel API.
- Prefer re-exporting types from the existing API layer to avoid drift.

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

## 📋 Detailed Migration Plan (Low-Risk)

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

**Build Order + Workspace Scripts (add at root):**

- Root scripts should build `@liratek/ui` before `frontend` and `electron-app`.
- CI should run `build:ui` before any frontend build step.

Example (root package.json):

```json
{
  "scripts": {
    "build:ui": "yarn workspace @liratek/ui build",
    "build:frontend": "yarn workspace @liratek/frontend build",
    "build:desktop": "yarn workspace @liratek/electron-app build",
    "build": "yarn build:ui && yarn build:frontend && yarn build:desktop"
  }
}
```

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

**Compatibility Matrix (pin before moving code):**

- React / React DOM versions aligned across `frontend` and `@liratek/ui`.
- Tailwind version aligned (including plugins like `tailwind-merge`).
- Vite version aligned for library mode and app builds.

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

**Tailwind Integration (decide early):**

- If `@liratek/ui` ships precompiled CSS, ensure the consuming app imports it once (e.g., `import '@liratek/ui/styles';`).
- If the app shell compiles Tailwind, add `packages/ui/src/**/*.{ts,tsx}` to the Tailwind content config in the app.

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

**Adapter Tests (minimum):**

- One test that ensures Electron mode never calls HTTP.
- One test that verifies HTTP mode routes to `fetch` and preserves errors.

---

### PHASE 4: Move Feature Components (Optional / Deferred)

- This phase is intentionally deferred to keep the UI working exactly as it does now.
- If needed later, move one feature at a time and test thoroughly in Electron mode first.

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

- Single source of truth for shared UI components
- Reduced duplication without changing app behavior
- Easy incremental path to deeper consolidation later

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

- Week 1: Phase 1-2 (Setup + Shared components)
- Week 2: Phase 5-6 (Integration + Testing)
- Phase 4 (Feature components) deferred

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

**Update (Feb 2026):** We effectively implemented the “quick win” using `frontend/src/api/backendApi.ts` as a facade. For the low-risk consolidation, keep this facade as-is (only small cleanup allowed) so runtime behavior does not change.

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

## ✅ Decision Checklist (Before Phase 1)

- Choose module boundary: shared primitives only, or full feature pages in `@liratek/ui`.
- Choose asset strategy: app shell assets vs bundled UI assets.
- Choose Tailwind strategy: `@liratek/ui` ships CSS vs app shell compiles.
- Confirm version alignment: React, Tailwind, Vite, and shared UI libs.
- Confirm adapter contract source: mirror `frontend/src/api/backendApi.ts`.
- Confirm build order in root scripts and CI.

## ✅ Implementation Status (Current)

- [x] Create `@liratek/ui` package scaffold
- [x] Move shared UI primitives (Select, NotificationCenter)
- [x] Move shared layout component (PageHeader)
- [x] Move shared utils (appEvents)
- [x] Move shared config (constants, denominations)
- [x] Move shared renderer types
- [x] Add API adapter scaffolding (types + provider + frontend adapter)
- [x] Wire ApiProvider at app root
- [x] Add adapter test for parameter normalization
- [x] Add shared styles strategy documentation (CSS owned by app shell)
- [N/A] ~~Migrate additional layouts (MainLayout, Sidebar, TopBar)~~ - **Deferred**: These are app composition layers with feature dependencies
- [N/A] ~~Migrate hooks (useAuth, useCurrencies, etc.)~~ - **Deferred**: Feature-specific, not general-purpose UI hooks
- [N/A] ~~Migrate feature pages~~ - **Deferred per plan**

**Migration Complete for Initial Scope:**
✅ All platform-agnostic shared primitives, utilities, config, and API adapter pattern are now in @liratek/ui
✅ Frontend properly re-exports for backward compatibility
✅ Build warnings resolved, tests added, documentation updated

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
