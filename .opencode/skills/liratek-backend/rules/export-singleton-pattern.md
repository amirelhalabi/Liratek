---
title: Singleton Export Pattern
impact: HIGH
impactDescription: Consistent singleton pattern for repositories and services enables testing and dependency injection
tags:
  - architecture
  - singleton
  - export
  - high
---

# Singleton Export Pattern

All repositories and services MUST use the singleton pattern with getter and reset functions.

## Pattern Structure

```typescript
// 1. Class definition
export class MyRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // Methods...
}

// 2. Singleton instance
let instance: MyRepository | null = null;

// 3. Getter function
export function getMyRepository(): MyRepository {
  if (!instance) {
    instance = new MyRepository(getDatabase());
  }
  return instance;
}

// 4. Reset function (for testing)
export function resetMyRepository(): void {
  instance = null;
}
```

## Repository Example

```typescript
import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";

export class ProductsRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(data: CreateProduct): Product {
    const stmt = this.db.prepare(`
      INSERT INTO products (name, price, created_at, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    const result = stmt.run(data.name, data.price);
    return this.getById(result.lastInsertRowid as number)!;
  }

  getById(id: number): Product | null {
    const stmt = this.db.prepare(`SELECT * FROM products WHERE id = ?`);
    return stmt.get(id) as Product | null;
  }
}

// Singleton
let instance: ProductsRepository | null = null;

export function getProductsRepository(): ProductsRepository {
  if (!instance) {
    instance = new ProductsRepository(getDatabase());
  }
  return instance;
}

export function resetProductsRepository(): void {
  instance = null;
}
```

## Service Example

```typescript
import { ProductsRepository } from "../repositories/ProductsRepository.js";
import { productsLogger } from "../utils/logger.js";

export class ProductsService {
  private repo: ProductsRepository;

  constructor(repo: ProductsRepository) {
    this.repo = repo;
  }

  createProduct(data: CreateProduct): Product {
    try {
      const product = this.repo.create(data);
      productsLogger.info({ productId: product.id }, "Product created");
      return product;
    } catch (error) {
      productsLogger.error({ error }, "createProduct failed");
      throw error;
    }
  }
}

// Singleton
let instance: ProductsService | null = null;

export function getProductsService(): ProductsService {
  if (!instance) {
    const repo = getProductsRepository();
    instance = new ProductsService(repo);
  }
  return instance;
}

export function resetProductsService(): void {
  instance = null;
}
```

## Export in Index Files

### repositories/index.ts

```typescript
export {
  ProductsRepository,
  getProductsRepository,
  resetProductsRepository,
} from "./ProductsRepository.js";

export {
  SalesRepository,
  getSalesRepository,
  resetSalesRepository,
} from "./SalesRepository.js";
```

### services/index.ts

```typescript
export {
  ProductsService,
  getProductsService,
  resetProductsService,
} from "./ProductsService.js";

export {
  SalesService,
  getSalesService,
  resetSalesService,
} from "./SalesService.js";
```

## Usage in IPC Handlers

```typescript
import { ipcMain } from "electron";
import { getProductsService, productsLogger } from "@liratek/core";
import { requireRole } from "../session.js";

let service: ReturnType<typeof getProductsService> | null = null;

function getServiceInstance() {
  if (!service) {
    service = getProductsService();
  }
  return service;
}

export function registerProductsHandlers(): void {
  productsLogger.info("Registering Products IPC handlers");

  ipcMain.handle("products:create", async (e, data: any) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error);

      const service = getServiceInstance();
      const product = service.createProduct(data);
      return { success: true, product };
    } catch (error) {
      productsLogger.error({ error }, "products:create failed");
      return { success: false, error: error.message };
    }
  });

  productsLogger.info("Products IPC handlers registered");
}
```

## Testing with Reset

```typescript
import {
  getProductsService,
  resetProductsService,
  resetProductsRepository,
} from "@liratek/core";

describe("ProductsService", () => {
  beforeEach(() => {
    // Reset singletons before each test
    resetProductsService();
    resetProductsRepository();
  });

  afterEach(() => {
    // Clean up after each test
    resetProductsService();
    resetProductsRepository();
  });

  it("should create a product", () => {
    const service = getProductsService();
    const product = service.createProduct({
      name: "Test Product",
      price: 1000,
    });

    expect(product.id).toBeDefined();
    expect(product.name).toBe("Test Product");
  });
});
```

## Why Singleton?

✅ **Benefits:**

1. **Single instance**: One database connection shared across app
2. **Performance**: No need to create new instances repeatedly
3. **Consistency**: Same state across all calls
4. **Testing**: Reset function allows clean state between tests
5. **Simple**: No complex dependency injection needed

❌ **Without Singleton:**

- Multiple database connections
- Inconsistent state
- Harder to test
- More complex code

## Naming Convention

- Class: `MyRepository` / `MyService`
- Instance: `instance`
- Getter: `getMyRepository()` / `getMyService()`
- Reset: `resetMyRepository()` / `resetMyService()`

## Reference

- Repository example: `packages/core/src/repositories/SalesRepository.ts`
- Service example: `packages/core/src/services/SalesService.ts`
- Exports: `packages/core/src/repositories/index.ts`, `packages/core/src/services/index.ts`
