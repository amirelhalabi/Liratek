# Logging Guide

**Last Updated:** February 15, 2026

---

## Overview

LiraTek uses **Pino** for structured, high-performance logging across all environments. The frontend uses a lightweight browser-compatible logger with the same API.

---

## Logger Locations

| Environment  | Logger Location                     | Source                     |
| ------------ | ----------------------------------- | -------------------------- |
| **Core**     | `packages/core/src/utils/logger.ts` | Primary impl               |
| **Backend**  | `backend/src/utils/logger.ts`       | Re-exports `@liratek/core` |
| **Electron** | `electron-app/utils/logger.ts`      | Re-exports `@liratek/core` |
| **Frontend** | `frontend/src/utils/logger.ts`      | Browser-compatible         |

---

## Usage

### Import

```typescript
import { logger } from "@liratek/core";
// or in frontend:
import logger from "../utils/logger";
```

### Log Levels

```typescript
logger.trace("Detailed debugging information");
logger.debug("Debug information");
logger.info("Application started");
logger.warn("Deprecated API usage detected");
logger.error({ error }, "Failed to process request");
logger.fatal("Critical system failure");
```

### Structured Logging

```typescript
// ❌ BAD: String concatenation
logger.info("User " + userId + " logged in");

// ✅ GOOD: Structured data
logger.info({ userId }, "User logged in");

// Complex context
logger.info(
  { userId: 123, action: "login", ip: req.ip, duration: 234 },
  "User authenticated",
);

// Errors — always pass the error object
try {
  await riskyOperation();
} catch (error) {
  logger.error(
    { error, userId, operation: "riskyOperation" },
    "Operation failed",
  );
}
```

---

## Module Loggers

Pre-configured child loggers with module context:

```
authLogger, dbLogger, salesLogger, inventoryLogger, clientLogger,
debtLogger, exchangeLogger, binanceLogger, financialLogger,
maintenanceLogger, rechargeLogger, settingsLogger, expenseLogger,
closingLogger, syncLogger
```

```typescript
salesLogger.info({ id, amount }, "Sale completed");
salesLogger.error({ error, data }, "Failed to create sale");
```

### Custom Child Loggers

```typescript
import { createChildLogger } from "../utils/logger.js";
const requestLogger = createChildLogger({
  requestId: req.id,
  userId: req.user.id,
});
requestLogger.info("Processing request");
```

---

## Request Correlation IDs

- Middleware: `requestLogger` in `backend/src/middleware/requestLogger.ts`
- Auto-generated UUID per request
- Respects incoming `X-Correlation-ID` or `X-Request-ID` headers
- Returns `X-Correlation-ID` in response

---

## Performance Timing

```typescript
import { measureTime } from "../utils/logger.js";
const result = await measureTime("process-sale", async () => { ... }, salesLogger);
```

---

## Configuration

| Environment     | Default Level | Format | Output         |
| --------------- | ------------- | ------ | -------------- |
| **Development** | `debug`       | Pretty | Console        |
| **Production**  | `info`        | JSON   | File + Console |
| **Test**        | `warn`        | JSON   | Console        |

**Environment variables:**

- `LOG_LEVEL` — `trace`, `debug`, `info`, `warn`, `error`, `fatal`
- `LOG_DIR` — Directory for log files (production)

### Log Files (Production)

```
LOG_DIR/
├── app.log       # All logs
├── error.log     # Error and fatal only
└── combined.log  # Everything
```

Log rotation: daily, 14-day retention, compressed archives.

---

## Security

**Auto-redacted fields:** `password`, `password_hash`, `credit_card`, `cvv`, `ssn`, `api_key`, `secret`, `token`

---

## ESLint Enforcement

`console.*` calls are blocked in production code:

```json
{ "rules": { "no-console": ["error", { "allow": ["warn", "error"] }] } }
```

Exception: `packages/core/src/config/env.ts` uses `process.stderr.write()` because it runs before the logger initializes.

---

## Testing

Logs are auto-silenced in test environment (`LOG_LEVEL=warn`). To verify logging in tests:

```typescript
jest.spyOn(salesLogger, "error");
// ... perform action ...
expect(salesLogger.error).toHaveBeenCalledWith(
  expect.objectContaining({ error: expect.any(Error) }),
  expect.stringContaining("Failed"),
);
```

---

## Best Practices

**DO:**

- Use structured logging with context objects
- Include error objects (not just messages)
- Add contextual data for debugging (IDs, amounts, actions)
- Use the appropriate log level

**DON'T:**

- Use `console.*` in business logic
- Log sensitive data (passwords, tokens, keys)
- Rely on log messages for business logic
- Log large objects without filtering
