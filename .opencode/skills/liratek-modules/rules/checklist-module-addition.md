---
title: Complete Module Addition Checklist
impact: CRITICAL
impactDescription: Follow this complete checklist when adding any new module to ensure all components are properly integrated
tags:
  - checklist
  - module
  - addition
  - critical
---

# Complete Module Addition Checklist

Follow this checklist when adding a new module (example: Loto) to ensure all components are properly integrated.

## Step 1: Database Migration

**File**: `packages/core/src/db/migrations/index.ts`

```typescript
{
  version: 48, // Increment from current (47)
  name: "add_new_module",
  description: "Add New Module tables and configuration",
  type: "typescript",
  up(db) {
    // 1. Create tables
    db.exec(`CREATE TABLE IF NOT EXISTS new_module_items (...)`);

    // 2. Add module
    db.exec(`
      INSERT OR IGNORE INTO modules (key, label, icon, route, sort_order, admin_only)
      VALUES ('new_module', 'New Module', 'IconName', '/new-module', 17, 0)
    `);

    // 3. Add currency support (USD & LBP)
    db.exec(`
      INSERT OR IGNORE INTO currency_modules (currency_code, module_key)
      VALUES ('USD', 'new_module'), ('LBP', 'new_module')
    `);

    // 4. Add drawer support (if needed)
    db.exec(`
      INSERT OR IGNORE INTO currency_drawers (currency_code, drawer_name)
      VALUES ('USD', 'NewModule'), ('LBP', 'NewModule')
    `);

    console.log("Migration v48: New Module added");
  },
  down(db) {
    db.exec(`DROP TABLE IF EXISTS new_module_items`);
    db.exec(`DELETE FROM modules WHERE key = 'new_module'`);
    db.exec(`DELETE FROM currency_modules WHERE module_key = 'new_module'`);
    db.exec(`DELETE FROM currency_drawers WHERE drawer_name = 'NewModule'`);
  }
}
```

- [ ] Increment version number
- [ ] Create tables with timestamps
- [ ] Add module registration
- [ ] Add currency_modules (USD & LBP)
- [ ] Add currency_drawers
- [ ] Implement down() function

## Step 2: Update Fresh Install Schema

**File**: `electron-app/create_db.sql`

```sql
-- Create table
CREATE TABLE IF NOT EXISTS new_module_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  field1 TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Add module
INSERT OR IGNORE INTO modules (key, label, icon, route, sort_order, admin_only)
VALUES ('new_module', 'New Module', 'IconName', '/new-module', 17, 0);

-- Add currency support
INSERT OR IGNORE INTO currency_modules (currency_code, module_key)
VALUES ('USD', 'new_module'), ('LBP', 'new_module');

-- Add drawer support
INSERT OR IGNORE INTO currency_drawers (currency_code, drawer_name)
VALUES ('USD', 'NewModule'), ('LBP', 'NewModule');
```

- [ ] Add CREATE TABLE statements
- [ ] Add module registration
- [ ] Add currency support
- [ ] Add drawer support

## Step 3: Create Repository

**File**: `packages/core/src/repositories/NewModuleRepository.ts`

```typescript
import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";

export class NewModuleRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(data: CreateData): Entity {
    const stmt = this.db.prepare(`INSERT INTO ...`);
    const result = stmt.run(...values);
    return this.getById(result.lastInsertRowid as number)!;
  }

  getById(id: number): Entity | null {
    const stmt = this.db.prepare(`SELECT * FROM ... WHERE id = ?`);
    return stmt.get(id) as Entity | null;
  }
}

let instance: NewModuleRepository | null = null;

export function getNewModuleRepository(): NewModuleRepository {
  if (!instance) {
    instance = new NewModuleRepository(getDatabase());
  }
  return instance;
}

export function resetNewModuleRepository(): void {
  instance = null;
}
```

- [ ] Create repository class
- [ ] Implement CRUD methods
- [ ] Use parameterized queries
- [ ] Add singleton pattern
- [ ] Export getter and reset functions

**File**: `packages/core/src/repositories/index.ts`

```typescript
export {
  NewModuleRepository,
  getNewModuleRepository,
  resetNewModuleRepository,
} from "./NewModuleRepository.js";
```

- [ ] Export in index.ts

## Step 4: Create Service

**File**: `packages/core/src/services/NewModuleService.ts`

```typescript
import { NewModuleRepository } from "../repositories/NewModuleRepository.js";
import { newModuleLogger } from "../utils/logger.js";

export class NewModuleService {
  private repo: NewModuleRepository;

  constructor(repo: NewModuleRepository) {
    this.repo = repo;
  }

  createItem(data: CreateData) {
    try {
      const item = this.repo.create(data);
      newModuleLogger.info({ itemId: item.id }, "Item created");
      return item;
    } catch (error) {
      newModuleLogger.error({ error }, "createItem failed");
      throw error;
    }
  }
}

let instance: NewModuleService | null = null;

export function getNewModuleService(): NewModuleService {
  if (!instance) {
    const repo = getNewModuleRepository();
    instance = new NewModuleService(repo);
  }
  return instance;
}

export function resetNewModuleService(): void {
  instance = null;
}
```

- [ ] Create service class
- [ ] Inject repository
- [ ] Add business logic
- [ ] Use logger
- [ ] Add singleton pattern
- [ ] Export getter and reset functions

**File**: `packages/core/src/services/index.ts`

```typescript
export {
  NewModuleService,
  getNewModuleService,
  resetNewModuleService,
} from "./NewModuleService.js";
```

- [ ] Export in index.ts

## Step 5: Create IPC Handlers

**File**: `electron-app/handlers/newModuleHandlers.ts`

```typescript
import { ipcMain } from "electron";
import { getNewModuleService, newModuleLogger } from "@liratek/core";
import { requireRole } from "../session.js";

let service: ReturnType<typeof getNewModuleService> | null = null;

function getServiceInstance() {
  if (!service) {
    service = getNewModuleService();
  }
  return service;
}

export function registerNewModuleHandlers(): void {
  newModuleLogger.info("Registering New Module IPC handlers");

  ipcMain.handle("new-module:create", async (e, data: any) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error);

      const service = getServiceInstance();
      const result = service.createItem(data);
      return { success: true, result };
    } catch (error) {
      newModuleLogger.error({ error }, "new-module:create failed");
      return { success: false, error: error.message };
    }
  });

  newModuleLogger.info("New Module IPC handlers registered");
}
```

- [ ] Create handler file
- [ ] Import service from @liratek/core
- [ ] Add authentication checks
- [ ] Return standardized response
- [ ] Log handler registration

**File**: `electron-app/preload.ts`

```typescript
newModule: {
  create: (data: CreateData) =>
    ipcRenderer.invoke("new-module:create", data),
  get: (id: number) =>
    ipcRenderer.invoke("new-module:get", id),
},
```

- [ ] Add preload bindings

**File**: `electron-app/main.ts`

```typescript
const newModuleHandlers = await import("./handlers/newModuleHandlers.js");
newModuleHandlers.registerNewModuleHandlers();
```

- [ ] Register handlers in main.ts

## Step 6: Create Frontend Page

**File**: `frontend/src/features/new-module/pages/NewModule/index.tsx`

```typescript
import { useState } from "react";

export function NewModulePage() {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");

  async function handleSubmit() {
    const result = await window.api.newModule.create({
      name,
      amount: parseFloat(amount),
    });

    if (result.success) {
      alert("Created successfully!");
    } else {
      alert(result.error);
    }
  }

  return (
    <div className="h-full p-6">
      <h1 className="text-2xl font-bold text-white">New Module</h1>
      {/* Form */}
    </div>
  );
}

export default NewModulePage;
```

- [ ] Create page component
- [ ] Use window.api.\* for IPC
- [ ] Handle loading/error states
- [ ] Export as default

**File**: `frontend/src/app/App.tsx`

```typescript
const NewModule = lazy(() => import("@/features/new-module/pages/NewModule"));

// In Routes:
<Route
  path="/new-module"
  element={
    <ProtectedRoute>
      <NewModule />
    </ProtectedRoute>
  }
/>
```

- [ ] Add route

**File**: `frontend/src/types/electron.d.ts`

```typescript
newModule: {
  create: (data: CreateData) =>
    Promise<{ success: boolean; result?: any; error?: string }>;
  get: (id: number) =>
    Promise<{ success: boolean; result?: any; error?: string }>;
}
```

- [ ] Add TypeScript types

## Step 7: Rebuild Core Package

```bash
cd packages/core && npm run build
```

- [ ] Rebuild core package

## Step 8: Testing

```bash
# Type check
yarn typecheck

# Lint
yarn lint

# Build
yarn build

# Dev test
yarn dev
```

- [ ] Run typecheck
- [ ] Run lint
- [ ] Run build
- [ ] Test in dev mode
- [ ] Test migration on existing DB
- [ ] Test fresh install

## Verification Checklist

- [ ] Migration created and version incremented
- [ ] Repository created with singleton pattern
- [ ] Service created with business logic
- [ ] IPC handlers created with auth checks
- [ ] Preload bindings added
- [ ] Handlers registered in main.ts
- [ ] Frontend page created
- [ ] Route added in App.tsx
- [ ] TypeScript types added
- [ ] Schema updated for fresh installs
- [ ] Typecheck passes
- [ ] Lint passes
- [ ] Build succeeds
- [ ] Dev mode works

## Reference

- Example: Loto module (migration v47)
- Migration: `packages/core/src/db/migrations/index.ts`
