# Logging Best Practices

## Overview

The application uses **Pino** for structured, high-performance logging. All business logic should use the centralized logger instead of `console.*` calls.

## Quick Reference

### Import the Logger

```typescript
// Use module-specific loggers
import { salesLogger } from "../utils/logger.js";
import { inventoryLogger } from "../utils/logger.js";
import { dbLogger } from "../utils/logger.js";

// Or import the base logger
import logger from "../utils/logger.js";
```

### Available Module Loggers

- `authLogger` - Authentication operations
- `dbLogger` - Database operations
- `salesLogger` - Sales transactions
- `inventoryLogger` - Inventory management
- `clientLogger` - Client operations
- `debtLogger` - Debt management
- `exchangeLogger` - Currency exchange
- `binanceLogger` - Binance integration
- `financialLogger` - Financial services (OMT/WHISH)
- `maintenanceLogger` - Maintenance jobs
- `rechargeLogger` - Mobile recharge
- `settingsLogger` - Settings management
- `expenseLogger` - Expense tracking
- `closingLogger` - Day opening/closing
- `syncLogger` - Data synchronization

### Log Levels

```typescript
// DEBUG - Detailed diagnostic info
salesLogger.debug({ productId, quantity }, "Processing sale item");

// INFO - General informational messages
salesLogger.info({ saleId, amount }, "Sale completed successfully");

// WARN - Warning conditions
salesLogger.warn({ stockLevel, threshold }, "Low stock warning");

// ERROR - Error conditions
salesLogger.error({ error, data }, "Failed to create sale");
```

### Best Practices

#### ✅ DO: Use Structured Logging

```typescript
// Good - structured with context
salesLogger.info(
  {
    saleId: result.id,
    drawer: drawerName,
    amount: finalAmount,
    status: "completed",
  },
  "Sale completed successfully",
);
```

#### ❌ DON'T: Use String Concatenation

```typescript
// Bad - unstructured
console.log(`[SALES] Sale #${id}: $${amount}`);
```

#### ✅ DO: Include Error Objects

```typescript
// Good - includes full error context
salesLogger.error({ error, sale }, "Sale transaction failed");
```

#### ❌ DON'T: Log Error Messages Only

```typescript
// Bad - loses stack trace
console.error("Sale failed:", error.message);
```

#### ✅ DO: Add Contextual Data

```typescript
// Good - provides debugging context
inventoryLogger.error(
  { error, productId, quantity, userId },
  "Stock adjustment failed",
);
```

#### ❌ DON'T: Log Without Context

```typescript
// Bad - no context for debugging
console.error("Stock adjustment failed");
```

## Performance Timing

Use built-in timing utilities for performance-critical operations:

```typescript
import { measureTime } from "../utils/logger.js";

const result = await measureTime(
  "process-sale",
  async () => {
    // Your operation here
    return await this.salesRepo.processSale(sale);
  },
  salesLogger, // Optional: specific logger
);
```

## Child Loggers

Create custom child loggers with additional context:

```typescript
import { createChildLogger } from "../utils/logger.js";

const requestLogger = createChildLogger({
  requestId: req.id,
  userId: req.user.id,
  ip: req.ip,
});

requestLogger.info("Processing user request");
```

## Configuration

Logging behavior is controlled by environment variables:

- `NODE_ENV=production` - JSON logs to file + stdout
- `NODE_ENV=development` - Pretty-printed colored logs
- `NODE_ENV=test` - Minimal logging
- `LOG_LEVEL=debug|info|warn|error` - Set minimum log level
- `LOG_DIR=/path/to/logs` - Custom log directory (production)

## ESLint Enforcement

The codebase enforces logging standards via ESLint:

```json
{
  "rules": {
    "no-console": ["error", { "allow": ["warn", "error"] }]
  }
}
```

This prevents accidental `console.log()` usage while allowing emergency fallbacks.

## Migration Guide

When updating old code:

### Before:

```typescript
try {
  const result = await this.repo.createSale(data);
  console.log(`[SALES] Created sale #${result.id}`);
  return { success: true, id: result.id };
} catch (error) {
  console.error("Failed to create sale:", error);
  return { success: false, error: error.message };
}
```

### After:

```typescript
import { salesLogger } from "../utils/logger.js";

try {
  const result = await this.repo.createSale(data);
  salesLogger.info(
    { saleId: result.id, amount: data.amount },
    `Created sale #${result.id}`,
  );
  return { success: true, id: result.id };
} catch (error) {
  salesLogger.error({ error, data }, "Failed to create sale");
  return { success: false, error: error.message };
}
```

## Production Log Management

In production, logs are written to:

- `logs/app-YYYY-MM-DD.log` (JSON format)
- stdout (for Docker/systemd collection)

Recommended log management:

- Use log rotation (logrotate, Docker logging drivers)
- Aggregate logs with ELK stack, Grafana Loki, or similar
- Set up alerts for ERROR-level logs
- Monitor log volume and performance

## Testing

Logs are automatically silenced in test environment (`NODE_ENV=test`). To verify logging in tests:

```typescript
import { salesLogger } from "../utils/logger.js";

// Mock the logger
jest.spyOn(salesLogger, "error");

// Run your code
await service.createSale(invalidData);

// Verify logging
expect(salesLogger.error).toHaveBeenCalledWith(
  expect.objectContaining({ error: expect.any(Error) }),
  "Failed to create sale",
);
```

## Summary

- ✅ Use module-specific loggers (`salesLogger`, `inventoryLogger`, etc.)
- ✅ Always include structured data objects
- ✅ Use appropriate log levels (debug, info, warn, error)
- ✅ Include error objects, not just messages
- ✅ Add contextual data for debugging
- ❌ Don't use `console.*` in business logic
- ❌ Don't log sensitive data (passwords, tokens, PII)
- ❌ Don't rely on log messages for business logic
