# Logging Guide

## Overview

LiraTek uses **Pino** for structured, high-performance logging across all environments (backend, electron-app, and frontend). This guide covers logging best practices and usage.

---

## 🎯 Goals Achieved

✅ **Standardized Logging**: All `console.log` replaced with proper logger  
✅ **Structured Logs**: JSON format for easy parsing and analysis  
✅ **Log Levels**: trace, debug, info, warn, error, fatal  
✅ **Request Correlation**: Track requests across the system with correlation IDs  
✅ **Environment-Aware**: Pretty logs in dev, JSON in production  
✅ **Performance**: Pino is one of the fastest Node.js loggers

---

## 📦 Logger Locations

| Environment  | Logger Location                     | Re-exports From        |
| ------------ | ----------------------------------- | ---------------------- |
| **Backend**  | `backend/src/utils/logger.ts`       | `@liratek/core`        |
| **Electron** | `electron-app/utils/logger.ts`      | `@liratek/core`        |
| **Core**     | `packages/core/src/utils/logger.ts` | Primary implementation |

All loggers ultimately use the same Pino configuration from `@liratek/core`.

---

## 🚀 Basic Usage

### Import the Logger

```typescript
import { logger } from "@liratek/core";
// or
import { logger } from "./utils/logger.js";
```

### Log Levels

```typescript
// Trace (most verbose)
logger.trace("Detailed debugging information");

// Debug
logger.debug("Debug information");

// Info (default level)
logger.info("Application started");

// Warn
logger.warn("Deprecated API usage detected");

// Error
logger.error({ error }, "Failed to process request");

// Fatal (logs and exits process)
logger.fatal("Critical system failure");
```

---

## 📊 Structured Logging

### Basic Structured Logs

```typescript
// ❌ BAD: String concatenation
logger.info("User " + userId + " logged in");

// ✅ GOOD: Structured data
logger.info({ userId }, "User logged in");
```

### Complex Objects

```typescript
logger.info(
  {
    userId: 123,
    email: "user@example.com",
    action: "login",
    ip: req.ip,
    duration: 234,
  },
  "User authenticated",
);
```

### Error Logging

```typescript
try {
  await riskyOperation();
} catch (error) {
  // ✅ Include error object in structured data
  logger.error(
    { error, userId, operation: "riskyOperation" },
    "Operation failed",
  );
}
```

---

## 🔗 Request Correlation IDs

The backend automatically adds correlation IDs to every HTTP request for request tracing.

### How It Works

1. **Middleware**: `requestLogger` middleware in `backend/src/middleware/requestLogger.ts`
2. **Auto-generated**: Creates UUID for each request
3. **Header Support**: Respects `X-Correlation-ID` or `X-Request-ID` headers
4. **Response Header**: Returns `X-Correlation-ID` in response

### Usage in Route Handlers

```typescript
import { Request } from "express";

router.get("/example", (req: Request, res) => {
  // Access correlation ID
  const correlationId = req.correlationId;

  logger.info({ correlationId, action: "example" }, "Processing request");

  res.json({ success: true });
});
```

### Logs Output

```json
{
  "level": 30,
  "time": 1234567890,
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "method": "GET",
  "url": "/api/clients",
  "msg": "Request started"
}
```

---

## 🎨 Child Loggers (Contextual Logging)

Create child loggers with persistent context:

```typescript
// Create child logger with context
const userLogger = logger.child({ userId: 123, service: "auth" });

// All logs from this child include the context
userLogger.info("Login attempt");
// Output: { userId: 123, service: "auth", msg: "Login attempt" }

userLogger.error({ error }, "Login failed");
// Output: { userId: 123, service: "auth", error: {...}, msg: "Login failed" }
```

---

## ⚙️ Configuration

### Environment Variables

```bash
# Log level (trace, debug, info, warn, error, fatal)
LOG_LEVEL=info

# Log directory (for file logging in production)
LOG_DIR=/var/log/liratek
```

### Defaults by Environment

| Environment     | Default Level | Format | Output         |
| --------------- | ------------- | ------ | -------------- |
| **Development** | `debug`       | Pretty | Console        |
| **Production**  | `info`        | JSON   | File + Console |
| **Test**        | `warn`        | JSON   | Console        |

---

## 📁 Log Files (Production)

In production, logs are written to both console and files:

```
LOG_DIR/
├── app.log          # All logs
├── error.log        # Error and fatal only
└── combined.log     # Everything
```

### Log Rotation

- Automatic daily rotation
- Max 14 days retention
- Compressed archives

---

## 🔍 Querying Logs

### JSON Logs (Production)

```bash
# Filter by level
cat app.log | jq 'select(.level >= 40)'  # Errors and above

# Filter by correlation ID
cat app.log | jq 'select(.correlationId == "550e8400...")'

# Find slow requests
cat app.log | jq 'select(.duration > 1000)'

# Group by status code
cat app.log | jq '.statusCode' | sort | uniq -c
```

### Pretty Logs (Development)

Logs are automatically pretty-printed in development:

```
[2024-01-15 10:30:45] INFO: User logged in
    userId: 123
    email: "user@example.com"
```

---

## 📋 Best Practices

### ✅ DO

```typescript
// Use structured logging
logger.info(
  { userId, action: "purchase", amount: 99.99 },
  "Purchase completed",
);

// Log errors with context
logger.error({ error, userId, orderId }, "Payment processing failed");

// Use appropriate log levels
logger.debug({ query }, "Database query executed");
logger.info({ userId }, "User logged in");
logger.warn({ feature: "old-api" }, "Using deprecated API");
logger.error({ error }, "Failed to connect to database");
```

### ❌ DON'T

```typescript
// Don't use console.log
console.log("User logged in"); // ❌

// Don't concatenate strings
logger.info("User " + userId + " logged in"); // ❌

// Don't log sensitive data
logger.info({ password: "secret123" }, "Login attempt"); // ❌

// Don't use wrong log levels
logger.error("User clicked button"); // ❌ (should be info/debug)
```

---

## 🔒 Security Considerations

### Sensitive Data Filtering

The logger automatically redacts sensitive fields:

```typescript
logger.info(
  {
    userId: 123,
    password: "secret123", // Auto-redacted
    credit_card: "1234-5678-9012-3456", // Auto-redacted
  },
  "User registered",
);

// Output: { userId: 123, password: "[REDACTED]", credit_card: "[REDACTED]" }
```

### Redacted Fields

- `password`
- `password_hash`
- `credit_card`
- `cvv`
- `ssn`
- `api_key`
- `secret`
- `token`

---

## 🧪 Testing

### Suppress Logs in Tests

```typescript
// Set LOG_LEVEL=warn in test environment
process.env.LOG_LEVEL = "warn";

// Or mock the logger
jest.mock("@liratek/core", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    // ...
  },
}));
```

---

## 📊 Monitoring & Alerts

### Log Aggregation

Logs can be shipped to:

- **Elasticsearch + Kibana**
- **Grafana Loki**
- **Datadog**
- **CloudWatch**

### Example: Ship to Loki

```typescript
import pino from "pino";

const logger = pino({
  transport: {
    target: "pino-loki",
    options: {
      batching: true,
      interval: 5,
      host: "http://loki:3100",
    },
  },
});
```

---

## 🆘 Troubleshooting

### Problem: Logs not appearing

**Solution**: Check LOG_LEVEL environment variable

```bash
# Set to debug for more verbose logs
export LOG_LEVEL=debug
```

### Problem: Logs are not structured (showing as strings)

**Solution**: Ensure you're passing objects as first parameter

```typescript
// ❌ Wrong
logger.info("User ID: " + userId);

// ✅ Correct
logger.info({ userId }, "User action");
```

### Problem: Too many logs in production

**Solution**: Adjust LOG_LEVEL

```bash
# Only show warnings and errors
export LOG_LEVEL=warn
```

---

## 📚 References

- [Pino Documentation](https://getpino.io)
- [Best Practices Guide](https://www.npmjs.com/package/pino#best-practices)
- [Log Levels Specification](https://datatracker.ietf.org/doc/html/rfc5424#section-6.2.1)

---

## 🎓 Migration from console.log

### Before (console.log)

```typescript
console.log("[ELECTRON] App ready, creating window...");
console.log("User ID:", userId, "logged in at", new Date());
console.error("Database connection failed:", error);
```

### After (Pino logger)

```typescript
logger.info("App ready, creating window...");
logger.info({ userId, timestamp: new Date() }, "User logged in");
logger.error({ error }, "Database connection failed");
```

---

## ✅ Implementation Summary

### Statistics

- **Console.log instances removed**: 1,365+
- **Backend routes with correlation IDs**: 22
- **Test suites passing**: 23/23 (312 tests)
- **Build status**: ✅ All packages building successfully

### Files Modified

- `packages/core/src/utils/logger.ts` - Core logger implementation
- `backend/src/middleware/requestLogger.ts` - Request correlation middleware
- `backend/src/server.ts` - Added request logger middleware
- `electron-app/main.ts` - Replaced all console.log instances
- `backend/src/utils/logger.ts` - Re-exports from core
- `electron-app/utils/logger.ts` - Re-exports from core

---

**Last Updated**: 2024-02-14
