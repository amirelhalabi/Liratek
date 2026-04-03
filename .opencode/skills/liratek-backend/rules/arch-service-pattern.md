---
title: Service Pattern Implementation
impact: CRITICAL
impactDescription: All business logic must be in services, not in repositories or IPC handlers
tags:
  - architecture
  - service
  - business-logic
  - critical
---

# Service Pattern

All business logic MUST be implemented in service classes. Services wrap repositories and add validation, calculations, and logging.

## Structure

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
      // 1. Business logic validation
      if (!data.field) {
        throw new Error("Field is required");
      }

      // 2. Calculate derived fields
      const calculatedValue = data.amount * 0.0445; // 4.45% commission

      // 3. Create entity via repository
      const entity = this.repo.create({
        ...data,
        calculated_value: calculatedValue,
      });

      // 4. Log success
      myLogger.info({ entityId: entity.id }, "Entity created");
      return entity;
    } catch (error) {
      // 5. Log error and rethrow
      myLogger.error({ error }, "createEntity failed");
      throw error;
    }
  }

  getReportData(from: string, to: string): ReportData {
    return {
      total: this.repo.getTotal(from, to),
      count: this.repo.getCount(from, to),
    };
  }
}

// Singleton pattern
let instance: MyService | null = null;

export function getMyService(): MyService {
  if (!instance) {
    const repo = getMyRepository();
    instance = new MyService(repo);
  }
  return instance;
}

export function resetMyService(): void {
  instance = null;
}
```

## Required Elements

✅ **DO:**

- Inject repository via constructor
- Validate business rules before operations
- Calculate derived fields (commission, totals, etc.)
- Use module-specific logger (`myLogger`)
- Wrap operations in try-catch
- Log both success and errors
- Implement singleton pattern
- Export reset function for testing
- Keep IPC handlers thin (just call services)

❌ **DON'T:**

- Put business logic in IPC handlers
- Access repositories directly from handlers
- Skip validation
- Use `console.log` (use logger)
- Skip error logging
- Put database queries in services (use repository)

## Example: SalesService

```typescript
import { SalesRepository } from "../repositories/SalesRepository.js";
import { salesLogger } from "../utils/logger.js";

export interface SaleReport {
  total_sales: number;
  total_amount: number;
  total_items: number;
}

export class SalesService {
  private repo: SalesRepository;

  constructor(repo: SalesRepository) {
    this.repo = repo;
  }

  createSale(data: CreateSaleData): Sale {
    try {
      // Validate client exists
      if (!data.client_id) {
        throw new Error("Client ID is required");
      }

      // Validate items
      if (!data.items || data.items.length === 0) {
        throw new Error("Sale must have at least one item");
      }

      // Calculate totals
      const subtotal = data.items.reduce(
        (sum, item) => sum + item.quantity * item.price,
        0,
      );
      const tax = subtotal * 0.11; // 11% tax
      const total = subtotal + tax;

      // Create sale
      const sale = this.repo.create({
        ...data,
        subtotal,
        tax,
        total,
      });

      // Create sale items
      for (const item of data.items) {
        this.repo.createItem({
          sale_id: sale.id,
          product_id: item.product_id,
          quantity: item.quantity,
          price: item.price,
        });
      }

      salesLogger.info({ saleId: sale.id, total }, "Sale created");
      return sale;
    } catch (error) {
      salesLogger.error({ error, data }, "createSale failed");
      throw error;
    }
  }

  getReport(from: string, to: string): SaleReport {
    return {
      total_sales: this.repo.getCount(from, to),
      total_amount: this.repo.getTotalAmount(from, to),
      total_items: this.repo.getTotalItems(from, to),
    };
  }
}

let instance: SalesService | null = null;

export function getSalesService(): SalesService {
  if (!instance) {
    const repo = getSalesRepository();
    instance = new SalesService(repo);
  }
  return instance;
}

export function resetSalesService(): void {
  instance = null;
}
```

## Service Layer Responsibilities

Services handle:

1. **Validation**: Business rules, data integrity
2. **Calculations**: Totals, commissions, taxes, discounts
3. **Transactions**: Multi-step database operations
4. **Logging**: Success/error logging with context
5. **Error Handling**: Catch, log, and rethrow errors

## IPC Handler Integration

```typescript
// In electron-app/handlers/salesHandlers.ts
import { getSalesService, salesLogger } from "@liratek/core";
import { requireRole } from "../session.js";

ipcMain.handle("sales:create", async (e, data: any) => {
  try {
    const auth = requireRole(e.sender.id, ["admin", "cashier"]);
    if (!auth.ok) throw new Error(auth.error);

    const service = getSalesService();
    const sale = service.createSale(data);
    return { success: true, sale };
  } catch (error) {
    salesLogger.error({ error }, "sales:create failed");
    return { success: false, error: error.message };
  }
});
```

## Testing

```typescript
// Reset singleton between tests
beforeEach(() => {
  resetSalesService();
  resetSalesRepository();
});

afterEach(() => {
  resetSalesService();
  resetSalesRepository();
});
```

## Reference

- Example: `packages/core/src/services/SalesService.ts`
- Repository: `packages/core/src/repositories/SalesRepository.ts`
- Logger: `packages/core/src/utils/logger.ts`
