---
title: Repository Pattern Implementation
impact: CRITICAL
impactDescription: All database access must go through repositories for consistency, testability, and maintainability
tags:
  - architecture
  - repository
  - database
  - critical
---

# Repository Pattern

All database access MUST go through repository classes following the singleton pattern.

## Structure

```typescript
import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";

export interface Entity {
  id: number;
  created_at: string;
  updated_at: string;
}

export interface CreateData {
  // Define fields
}

export class MyRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(data: CreateData): Entity {
    const stmt = this.db.prepare(`
      INSERT INTO table (field1, field2, created_at, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    const result = stmt.run(data.field1, data.field2);
    return this.getById(result.lastInsertRowid as number)!;
  }

  getById(id: number): Entity | null {
    const stmt = this.db.prepare(`SELECT * FROM table WHERE id = ?`);
    return stmt.get(id) as Entity | null;
  }

  update(id: number, data: Partial<CreateData>): Entity | null {
    const stmt = this.db.prepare(`
      UPDATE table 
      SET field1 = ?, field2 = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(data.field1, data.field2, id);
    return this.getById(id);
  }

  delete(id: number): void {
    const stmt = this.db.prepare(`DELETE FROM table WHERE id = ?`);
    stmt.run(id);
  }
}

// Singleton pattern
let instance: MyRepository | null = null;

export function getMyRepository(): MyRepository {
  if (!instance) {
    instance = new MyRepository(getDatabase());
  }
  return instance;
}

export function resetMyRepository(): void {
  instance = null;
}
```

## Required Elements

✅ **DO:**

- Define `Entity` interface with `id`, `created_at`, `updated_at`
- Define `CreateData` interface for input validation
- Inject database via constructor
- Use parameterized queries (`?` placeholders)
- Implement singleton pattern with `getMyRepository()`
- Export `resetMyRepository()` for testing
- Use `CURRENT_TIMESTAMP` for timestamps
- Return `Entity | null` for getters
- Return `void` for delete operations

❌ **DON'T:**

- Access database directly outside repositories
- Use string concatenation for SQL
- Skip the singleton pattern
- Forget to export reset function
- Use `any` types

## Example: SalesRepository

```typescript
import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";

export interface SaleItem {
  id: number;
  sale_id: number;
  product_id: number;
  quantity: number;
  price: number;
  created_at: string;
  updated_at: string;
}

export interface CreateSaleItem {
  sale_id: number;
  product_id: number;
  quantity: number;
  price: number;
}

export class SalesRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  createItem(data: CreateSaleItem): SaleItem {
    const stmt = this.db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, quantity, price, created_at, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    const result = stmt.run(
      data.sale_id,
      data.product_id,
      data.quantity,
      data.price,
    );
    return this.getItemById(result.lastInsertRowid as number)!;
  }

  getItemById(id: number): SaleItem | null {
    const stmt = this.db.prepare(`
      SELECT * FROM sale_items WHERE id = ?
    `);
    return stmt.get(id) as SaleItem | null;
  }

  getItemsBySaleId(saleId: number): SaleItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM sale_items WHERE sale_id = ?
    `);
    return stmt.all(saleId) as SaleItem[];
  }
}

let instance: SalesRepository | null = null;

export function getSalesRepository(): SalesRepository {
  if (!instance) {
    instance = new SalesRepository(getDatabase());
  }
  return instance;
}

export function resetSalesRepository(): void {
  instance = null;
}
```

## Testing

```typescript
// In tests, reset singleton between tests
beforeEach(() => {
  resetSalesRepository();
});

afterEach(() => {
  resetSalesRepository();
});
```

## Reference

- Example: `packages/core/src/repositories/SalesRepository.ts`
- Database connection: `packages/core/src/db/connection.ts`
