# packages/core — Claude Code Context

Loads automatically when working under `packages/core/`. Root context is `../../CLAUDE.md`.

### Repository Pattern

All database access goes through repository classes with the singleton pattern.

```typescript
import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";

export interface Entity {
  id: number;
  created_at: string;
  updated_at: string;
}

export interface CreateData {
  field1: string;
  field2: number;
}

export class MyRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(data: CreateData): Entity {
    const stmt = this.db.prepare(`
      INSERT INTO my_table (field1, field2, created_at, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    const result = stmt.run(data.field1, data.field2);
    return this.getById(result.lastInsertRowid as number)!;
  }

  getById(id: number): Entity | null {
    const stmt = this.db.prepare(`SELECT * FROM my_table WHERE id = ?`);
    return stmt.get(id) as Entity | null;
  }

  update(id: number, data: Partial<CreateData>): Entity | null {
    const stmt = this.db.prepare(`
      UPDATE my_table SET field1 = ?, field2 = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(data.field1, data.field2, id);
    return this.getById(id);
  }

  delete(id: number): void {
    const stmt = this.db.prepare(`DELETE FROM my_table WHERE id = ?`);
    stmt.run(id);
  }
}

// Singleton
let instance: MyRepository | null = null;

export function getMyRepository(): MyRepository {
  if (!instance) {
    instance = new MyRepository(getDatabase());
  }
  return instance;
}

export function resetMyRepository(): void {
  instance = null; // Used in tests
}
```

Export in `packages/core/src/repositories/index.ts`:

```typescript
export {
  MyRepository,
  getMyRepository,
  resetMyRepository,
} from "./MyRepository.js";
```

### Service Pattern

Business logic layer — repositories handle data, services handle validation and logic.

```typescript
import {
  getMyRepository,
  type MyRepository,
} from "../repositories/MyRepository.js";
import { myLogger } from "../utils/logger.js";

export class MyService {
  private repo: MyRepository;

  constructor(repo: MyRepository) {
    this.repo = repo;
  }

  createEntity(data: CreateData): Entity {
    try {
      if (!data.field1) throw new Error("field1 is required");

      const entity = this.repo.create(data);
      myLogger.info({ entityId: entity.id }, "Entity created");
      return entity;
    } catch (error) {
      myLogger.error({ error }, "createEntity failed");
      throw error;
    }
  }
}

// Singleton
let instance: MyService | null = null;

export function getMyService(): MyService {
  if (!instance) {
    instance = new MyService(getMyRepository());
  }
  return instance;
}

export function resetMyService(): void {
  instance = null;
}
```

Export in `packages/core/src/services/index.ts`:

```typescript
export { MyService, getMyService, resetMyService } from "./MyService.js";
```

### Available Loggers

```typescript
import { salesLogger, lotoLogger, rechargeLogger } from "../utils/logger.js";
// Also: financialLogger, exchangeLogger, debtLogger, inventoryLogger,
//       authLogger, dbLogger, ipcLogger, maintenanceLogger, expenseLogger,
//       closingLogger, customServiceLogger, settingsLogger, voiceBotLogger
```

### Backend Commands

```bash
cd packages/core && npm run build      # MUST rebuild after core changes
yarn workspace @liratek/backend typecheck
yarn workspace @liratek/backend test
yarn workspace @liratek/backend test:coverage
```

### Core Build & Sync (REQUIRED after every packages/core change)

`node_modules/@liratek/core` is a **real copy**, not a symlink. After rebuilding core, you MUST sync it:

```bash
# Step 1 — rebuild
cd packages/core && npm run build

# Step 2 — sync into node_modules (Electron main process reads from here)
xcopy /e /y /q "packages\core\dist" "node_modules\@liratek\core\dist\"
```

**If you skip Step 2, the Electron main process will run old code even after a full restart.** This manifests as schema changes, new fields, or logic fixes being silently ignored at runtime.

Rule: whenever you edit any file under `packages/core/src/`, always run both commands before declaring the task complete.
