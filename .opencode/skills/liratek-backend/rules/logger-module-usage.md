---
title: Module Logger Usage
impact: HIGH
impactDescription: Consistent logging across the application for debugging and monitoring
tags:
  - logging
  - debugging
  - monitoring
  - high
---

# Module Logger Usage

Use module-specific loggers for all logging. Never use `console.log` in production code.

## Available Loggers

Import from `@liratek/core`:

```typescript
import {
  salesLogger,
  lotoLogger,
  rechargeLogger,
  financialLogger,
  exchangeLogger,
  debtLogger,
  inventoryLogger,
  authLogger,
  dbLogger,
  ipcLogger,
  maintenanceLogger,
  expenseLogger,
  closingLogger,
  customServiceLogger,
  settingsLogger,
  voiceBotLogger,
} from "@liratek/core";
```

## Usage Patterns

### Info Logging

```typescript
import { salesLogger } from "@liratek/core";

// Simple info
salesLogger.info("Sale created");

// With context
salesLogger.info({ saleId: 123, total: 10000 }, "Sale created");

// Multiple context fields
salesLogger.info(
  {
    saleId: 123,
    clientId: 456,
    items: 3,
    total: 10000,
    currency: "LBP",
  },
  "Sale created successfully",
);
```

### Error Logging

```typescript
import { salesLogger } from "@liratek/core";

try {
  // Business logic
} catch (error) {
  // Log error with context
  salesLogger.error({ error, data }, "createSale failed");

  // Log with stack trace
  salesLogger.error({ error, stack: error.stack, userId }, "createSale failed");

  // Re-throw after logging
  throw error;
}
```

### Debug Logging

```typescript
import { salesLogger } from "@liratek/core";

// Debug with request/response
salesLogger.debug({ request: data, response: result }, "Request processed");

// Debug with timing
const start = Date.now();
// ... operation
const duration = Date.now() - start;
salesLogger.debug({ duration }, "Operation completed");
```

### Warning Logging

```typescript
import { salesLogger } from "@liratek/core";

// Deprecation warning
salesLogger.warn(
  { oldMethod: "v1", newMethod: "v2" },
  "Using deprecated method",
);

// Business rule warning
salesLogger.warn(
  { discount: 0.5, maxAllowed: 0.3 },
  "Discount exceeds maximum allowed",
);
```

## Service Pattern Integration

```typescript
import { MyRepository } from "../repositories/MyRepository.js";
import { myLogger } from "../utils/logger.js";

export class MyService {
  private repo: MyRepository;

  constructor(repo: MyRepository) {
    this.repo = repo;
  }

  createEntity(data: CreateData): Entity {
    try {
      // Log incoming request
      myLogger.debug({ data }, "createEntity called");

      // Validation
      if (!data.field) {
        myLogger.warn({ data }, "Missing required field");
        throw new Error("Field is required");
      }

      // Create entity
      const entity = this.repo.create(data);

      // Log success
      myLogger.info({ entityId: entity.id }, "Entity created");
      return entity;
    } catch (error) {
      // Log error
      myLogger.error({ error, data }, "createEntity failed");
      throw error;
    }
  }
}
```

## IPC Handler Integration

```typescript
import { ipcMain } from "electron";
import { getMyService, myLogger } from "@liratek/core";
import { requireRole } from "../session.js";

export function registerMyHandlers(): void {
  myLogger.info("Registering My IPC handlers");

  ipcMain.handle("my:create", async (e, data: any) => {
    try {
      myLogger.debug({ data }, "my:create request");

      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) {
        myLogger.warn({ sessionId: e.sender.id }, "Unauthorized access");
        throw new Error(auth.error);
      }

      const service = getMyService();
      const result = service.createEntity(data);

      myLogger.info({ resultId: result.id }, "my:create success");
      return { success: true, result };
    } catch (error) {
      myLogger.error({ error }, "my:create failed");
      return { success: false, error: error.message };
    }
  });

  myLogger.info("My IPC handlers registered");
}
```

## Best Practices

✅ **DO:**

- Use module-specific logger (salesLogger for sales, etc.)
- Include relevant context in every log
- Log both success and errors
- Use appropriate log levels (info, warn, error, debug)
- Log request data in debug mode
- Log error stack traces
- Log handler registration

❌ **DON'T:**

- Use `console.log` in production code
- Log sensitive data (passwords, tokens)
- Log without context
- Skip error logging
- Use wrong logger (use salesLogger for sales, not dbLogger)

## Log Levels

- **error**: Errors that need attention
- **warn**: Warnings that don't break functionality
- **info**: Important business events (create, update, delete)
- **debug**: Detailed information for debugging

## Example: Complete Service with Logging

```typescript
import { SalesRepository } from "../repositories/SalesRepository.js";
import { salesLogger } from "../utils/logger.js";

export class SalesService {
  private repo: SalesRepository;

  constructor(repo: SalesRepository) {
    this.repo = repo;
  }

  createSale(data: CreateSaleData): Sale {
    try {
      salesLogger.debug({ data }, "createSale called");

      // Validate
      if (!data.client_id) {
        salesLogger.warn({ data }, "Missing client_id");
        throw new Error("Client ID is required");
      }

      // Calculate
      const subtotal = data.items.reduce(
        (sum, item) => sum + item.quantity * item.price,
        0,
      );
      const tax = subtotal * 0.11;
      const total = subtotal + tax;

      salesLogger.debug({ subtotal, tax, total }, "Calculated totals");

      // Create
      const sale = this.repo.create({ ...data, subtotal, tax, total });

      salesLogger.info(
        { saleId: sale.id, total, items: data.items.length },
        "Sale created",
      );

      return sale;
    } catch (error) {
      salesLogger.error(
        { error, data, stack: error.stack },
        "createSale failed",
      );
      throw error;
    }
  }

  getSaleById(id: number): Sale | null {
    try {
      salesLogger.debug({ id }, "getSaleById called");

      const sale = this.repo.getById(id);

      if (!sale) {
        salesLogger.warn({ id }, "Sale not found");
        return null;
      }

      salesLogger.debug({ saleId: sale.id }, "Sale found");
      return sale;
    } catch (error) {
      salesLogger.error({ error, id }, "getSaleById failed");
      throw error;
    }
  }
}
```

## Reference

- Logger implementation: `packages/core/src/utils/logger.ts`
- Winston documentation: https://github.com/winstonjs/winston
