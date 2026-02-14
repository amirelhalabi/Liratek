# LiraTek POS - Technical Recommendations & Improvement Plan

**Document Version:** 1.0  
**Date:** February 14, 2026  
**Author:** Senior Software Engineer Review  
**Scope:** Comprehensive technical analysis and actionable recommendations

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Critical Issues (Priority 1)](#critical-issues-priority-1)
3. [High Priority (Priority 2)](#high-priority-priority-2)
4. [Medium Priority (Priority 3)](#medium-priority-priority-3)
5. [Low Priority / Nice to Have (Priority 4)](#low-priority-nice-to-have-priority-4)
6. [Architecture Recommendations](#architecture-recommendations)
7. [Database Recommendations](#database-recommendations)
8. [Backend Recommendations](#backend-recommendations)
9. [Frontend Recommendations](#frontend-recommendations)
10. [DevOps & Infrastructure](#devops--infrastructure)
11. [Testing Strategy](#testing-strategy)
12. [Security Recommendations](#security-recommendations)
13. [Performance Optimization](#performance-optimization)
14. [Implementation Roadmap](#implementation-roadmap)

---

## Executive Summary

LiraTek POS is a well-architected dual-mode application with strong fundamentals. The recent consolidation effort (`@liratek/core`) eliminated 9,336 lines of duplicate code, demonstrating excellent architectural decision-making.

**Overall Grade: B+ (Very Good)**

**Key Strengths:**

- ✅ Clean separation of concerns (Repository → Service → Handler/Route)
- ✅ Successful monorepo consolidation reducing duplication
- ✅ Type-safe TypeScript implementation
- ✅ Comprehensive test coverage (447 test files)
- ✅ Dual-mode architecture enabling flexibility

**Key Improvement Areas:**

- ⚠️ Repository duplication still exists in `electron-app/database/repositories/`
- ⚠️ Weak type safety in API layer (`unknown` types)
- ⚠️ Console.log usage instead of consistent logging (61 instances)
- ⚠️ Missing transaction management in critical operations
- ⚠️ E2E tests disabled due to flakiness

**Estimated Technical Debt:** ~2-3 weeks of focused work to address critical and high-priority items.

---

## Critical Issues (Priority 1)

### 🔴 C0. Apply Request Validation to All Backend Routes - **HIGHEST PRIORITY**

**Status:** In Progress (3 of 22 routes completed)  
**Issue:** Inconsistent request validation across backend API endpoints creates security vulnerabilities and poor error handling

**Current State:**

- ✅ **Completed (3 routes):**
  - `/api/clients` - Full CRUD with Zod validation
  - `/api/auth/login` - Credentials validated
  - `/api/inventory/products` - Product operations validated
- ❌ **Remaining (19 routes):** No validation, accepting any request body

**Evidence:**

```typescript
// Current unvalidated endpoints (security risk)
router.post("/api/sales", (req, res) => {
  const result = service.processSale(req.body); // ❌ No validation
});

router.post("/api/debts/repayment", (req, res) => {
  const result = service.addRepayment(req.body); // ❌ No validation
});
```

**Impact:**

- **Security Risk:** Malformed data can crash the application
- **Data Integrity:** Invalid data bypasses business rules
- **Poor UX:** Generic error messages instead of field-specific validation
- **Debugging Difficulty:** Hard to trace what caused failures

---

### **COMPLETE COVERAGE PLAN**

**Estimated Total Effort:** 10-12 hours (complete validation across all 22 routes)  
**Risk:** Low (proven pattern, high value)

---

#### **Phase 1: Create Validation Schemas (2-3 hours)**

**Step 1.1: Sales & POS Schemas**

```typescript
// packages/core/src/validators/sale.ts (ENHANCE EXISTING)

import { z } from "zod";
import {
  positiveDecimalSchema,
  positiveIntegerSchema,
  idSchema,
} from "./common.js";

// Sale item validation
export const saleItemSchema = z.object({
  product_id: idSchema,
  quantity: positiveIntegerSchema.min(1),
  unit_price_usd: positiveDecimalSchema.optional(),
  unit_price_lbp: positiveDecimalSchema.optional(),
  discount: positiveDecimalSchema.default(0),
});

// Complete sale creation
export const createSaleSchema = z.object({
  client_id: idSchema.optional(),
  client_name: z.string().min(1).max(255).optional(),
  client_phone: z
    .string()
    .regex(/^\+?[0-9]{8,15}$/)
    .optional(),
  items: z.array(saleItemSchema).min(1, "At least one item required"),
  total_usd: positiveDecimalSchema,
  total_lbp: positiveDecimalSchema,
  discount: positiveDecimalSchema.default(0),
  final_amount: positiveDecimalSchema,
  paid_usd: positiveDecimalSchema.default(0),
  paid_lbp: positiveDecimalSchema.default(0),
  payment_method: z.enum(["CASH", "CARD", "TRANSFER", "MIXED"]).default("CASH"),
  drawer_name: z.string().optional(),
  status: z.enum(["draft", "completed"]).default("completed"),
  note: z.string().optional(),
});

// Draft retrieval
export const getSaleSchema = z.object({
  id: idSchema,
});

// Sale search
export const searchSalesSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  clientId: idSchema.optional(),
  status: z.enum(["draft", "completed", "refunded"]).optional(),
});
```

**Step 1.2: Financial Services Schemas**

```typescript
// packages/core/src/validators/financial.ts (CREATE NEW)

import { z } from "zod";
import { positiveDecimalSchema, currencyCodeSchema } from "./common.js";

// OMT/WHISH Money Transfer
export const createFinancialServiceSchema = z.object({
  provider: z.enum(["OMT", "WHISH", "WESTERNUNION"]),
  serviceType: z.enum(["SEND", "RECEIVE"]),
  referenceNumber: z.string().min(1).max(100),
  senderName: z.string().min(1).max(255),
  receiverName: z.string().min(1).max(255),
  amountUSD: positiveDecimalSchema,
  commissionUSD: positiveDecimalSchema,
  drawer: z.enum(["OMT_Drawer", "General_Drawer_B"]).optional(),
  note: z.string().optional(),
});

// Query financial services history
export const getFinancialServicesSchema = z.object({
  provider: z.enum(["OMT", "WHISH", "WESTERNUNION"]).optional(),
  limit: z.coerce.number().int().positive().max(1000).default(50),
});
```

**Step 1.3: Debt Management Schemas**

```typescript
// packages/core/src/validators/debt.ts (CREATE NEW)

import { z } from "zod";
import { positiveDecimalSchema, idSchema } from "./common.js";

// Add debt repayment
export const addRepaymentSchema = z
  .object({
    clientId: idSchema,
    amountUSD: positiveDecimalSchema.default(0),
    amountLBP: positiveDecimalSchema.default(0),
    note: z.string().optional(),
    userId: idSchema.optional(),
  })
  .refine((data) => data.amountUSD > 0 || data.amountLBP > 0, {
    message: "At least one amount (USD or LBP) must be greater than 0",
  });

// Get debtor summary
export const getDebtorSummarySchema = z.object({
  clientId: idSchema.optional(),
  hasDebtOnly: z.coerce.boolean().default(false),
});
```

**Step 1.4: Exchange & Currency Schemas**

```typescript
// packages/core/src/validators/exchange.ts (CREATE NEW)

import { z } from "zod";
import { positiveDecimalSchema, currencyCodeSchema } from "./common.js";

export const createExchangeSchema = z
  .object({
    fromCurrency: currencyCodeSchema,
    toCurrency: currencyCodeSchema,
    amountIn: positiveDecimalSchema,
    amountOut: positiveDecimalSchema,
    rate: positiveDecimalSchema,
    clientName: z.string().max(255).optional(),
    note: z.string().optional(),
  })
  .refine((data) => data.fromCurrency !== data.toCurrency, {
    message: "From and To currencies must be different",
  });

export const getExchangeHistorySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(50),
});
```

**Step 1.5: Recharge & Services Schemas**

```typescript
// packages/core/src/validators/recharge.ts (CREATE NEW)

import { z } from "zod";
import { positiveDecimalSchema, positiveIntegerSchema } from "./common.js";

export const createRechargeSchema = z.object({
  provider: z.enum(["MTC", "ALFA"]),
  type: z.enum(["prepaid", "postpaid", "internet"]),
  amount: positiveIntegerSchema, // e.g., 10000 LBP
  price: positiveDecimalSchema, // USD price
  phoneNumber: z.string().regex(/^\+?[0-9]{8,15}$/),
  paid_by_method: z.enum(["CASH", "CARD", "TRANSFER"]).default("CASH"),
  note: z.string().optional(),
});

export const getRechargeStockSchema = z.object({
  // No parameters needed
});
```

**Step 1.6: Expense & Closing Schemas**

```typescript
// packages/core/src/validators/expense.ts (CREATE NEW)

import { z } from "zod";
import { positiveDecimalSchema } from "./common.js";

export const createExpenseSchema = z.object({
  category: z.string().min(1).max(100),
  amount_usd: positiveDecimalSchema,
  amount_lbp: positiveDecimalSchema.default(0),
  paid_by_method: z
    .enum(["CASH", "CARD", "TRANSFER", "DRAWER"])
    .default("CASH"),
  expense_type: z
    .enum(["OPERATIONAL", "SALARY", "RENT", "OTHER"])
    .default("OPERATIONAL"),
  description: z.string().optional(),
});

export const deleteExpenseSchema = z.object({
  id: positiveIntegerSchema,
});
```

```typescript
// packages/core/src/validators/closing.ts (CREATE NEW)

import { z } from "zod";
import { positiveDecimalSchema, dateStringSchema } from "./common.js";

const drawerAmountSchema = z.object({
  currency: z.enum(["USD", "LBP", "EUR"]),
  amount: positiveDecimalSchema,
});

export const setOpeningBalancesSchema = z.object({
  closingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
  amounts: z.array(drawerAmountSchema).min(1),
  userId: positiveIntegerSchema,
});

export const createDailyClosingSchema = z.object({
  closingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amounts: z.array(drawerAmountSchema).min(1),
  userId: positiveIntegerSchema,
  notes: z.string().optional(),
});
```

**Step 1.7: Rates & Settings Schemas**

```typescript
// packages/core/src/validators/rate.ts (CREATE NEW)

import { z } from "zod";
import { positiveDecimalSchema, currencyCodeSchema } from "./common.js";

export const setRateSchema = z.object({
  fromCurrency: currencyCodeSchema,
  toCurrency: currencyCodeSchema,
  rate: positiveDecimalSchema.min(0.0001), // Prevent zero/negative rates
});

export const getRateSchema = z.object({
  fromCurrency: currencyCodeSchema.optional(),
  toCurrency: currencyCodeSchema.optional(),
});
```

**Step 1.8: Maintenance Schemas**

```typescript
// packages/core/src/validators/maintenance.ts (CREATE NEW)

import { z } from "zod";
import { positiveDecimalSchema, positiveIntegerSchema } from "./common.js";

export const saveMaintenanceJobSchema = z.object({
  id: positiveIntegerSchema.optional(), // For updates
  device_name: z.string().min(1).max(255),
  client_id: positiveIntegerSchema.optional(),
  client_name: z.string().max(255).optional(),
  client_phone: z
    .string()
    .regex(/^\+?[0-9]{8,15}$/)
    .optional(),
  issue_description: z.string().optional(),
  price_usd: positiveDecimalSchema,
  status: z
    .enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"])
    .default("PENDING"),
  final_amount_usd: positiveDecimalSchema.optional(),
  notes: z.string().optional(),
});

export const getMaintenanceJobsSchema = z.object({
  status: z
    .enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"])
    .optional(),
});
```

---

#### **Phase 2: Apply Validation to Routes (6-7 hours)**

**Route-by-Route Implementation Checklist:**

| #   | Route                     | Method              | Schema                                             | Priority | Est. Time |
| --- | ------------------------- | ------------------- | -------------------------------------------------- | -------- | --------- |
| ✅  | `/api/clients`            | POST/PUT/GET/DELETE | createClientSchema, updateClientSchema             | DONE     | -         |
| ✅  | `/api/auth/login`         | POST                | loginSchema                                        | DONE     | -         |
| ✅  | `/api/inventory/products` | POST/GET            | createProductSchema, searchProductsSchema          | DONE     | -         |
| 1   | `/api/sales`              | POST                | createSaleSchema                                   | **HIGH** | 30min     |
| 2   | `/api/sales/:id`          | GET                 | getSaleSchema                                      | **HIGH** | 15min     |
| 3   | `/api/sales/drafts`       | GET                 | - (no validation needed)                           | LOW      | 5min      |
| 4   | `/api/debts/repayment`    | POST                | addRepaymentSchema                                 | **HIGH** | 25min     |
| 5   | `/api/debts/summary`      | GET                 | getDebtorSummarySchema                             | MEDIUM   | 15min     |
| 6   | `/api/exchange`           | POST                | createExchangeSchema                               | **HIGH** | 25min     |
| 7   | `/api/exchange/history`   | GET                 | getExchangeHistorySchema                           | LOW      | 10min     |
| 8   | `/api/recharge`           | POST                | createRechargeSchema                               | MEDIUM   | 25min     |
| 9   | `/api/recharge/stock`     | GET                 | getRechargeStockSchema                             | LOW      | 5min      |
| 10  | `/api/expenses`           | POST                | createExpenseSchema                                | MEDIUM   | 20min     |
| 11  | `/api/expenses/:id`       | DELETE              | deleteExpenseSchema                                | LOW      | 15min     |
| 12  | `/api/closing/opening`    | POST                | setOpeningBalancesSchema                           | **HIGH** | 30min     |
| 13  | `/api/closing/daily`      | POST                | createDailyClosingSchema                           | **HIGH** | 30min     |
| 14  | `/api/closing/stats`      | GET                 | - (no validation needed)                           | LOW      | 5min      |
| 15  | `/api/rates`              | POST                | setRateSchema                                      | MEDIUM   | 20min     |
| 16  | `/api/rates/:from/:to`    | GET                 | getRateSchema                                      | LOW      | 15min     |
| 17  | `/api/maintenance/jobs`   | POST/GET            | saveMaintenanceJobSchema, getMaintenanceJobsSchema | MEDIUM   | 30min     |
| 18  | `/api/services/:type`     | POST                | createFinancialServiceSchema                       | **HIGH** | 25min     |
| 19  | `/api/services/history`   | GET                 | getFinancialServicesSchema                         | LOW      | 10min     |
| 20  | `/api/currencies`         | GET/POST            | - (admin only, low traffic)                        | LOW      | 20min     |
| 21  | `/api/dashboard`          | GET                 | - (no validation needed)                           | LOW      | 5min      |
| 22  | `/api/reports`            | POST                | - (complex, handle separately)                     | LOW      | 30min     |

**Total Estimated Time:** ~6-7 hours

---

#### **Phase 3: Testing & Verification (2 hours)**

**Step 3.1: Unit Tests for Validators**

```typescript
// packages/core/src/validators/__tests__/sale.test.ts
import { createSaleSchema } from "../sale.js";

describe("createSaleSchema", () => {
  it("validates valid sale data", () => {
    const validSale = {
      items: [{ product_id: 1, quantity: 2, unit_price_usd: 10 }],
      total_usd: 20,
      total_lbp: 0,
      final_amount: 20,
      payment_method: "CASH",
    };

    expect(() => createSaleSchema.parse(validSale)).not.toThrow();
  });

  it("rejects sale with no items", () => {
    const invalidSale = {
      items: [],
      total_usd: 0,
      total_lbp: 0,
      final_amount: 0,
    };

    expect(() => createSaleSchema.parse(invalidSale)).toThrow();
  });

  it("rejects negative amounts", () => {
    const invalidSale = {
      items: [{ product_id: 1, quantity: 2, unit_price_usd: -10 }],
      total_usd: -20,
      total_lbp: 0,
      final_amount: -20,
    };

    expect(() => createSaleSchema.parse(invalidSale)).toThrow();
  });
});
```

**Step 3.2: Integration Tests**

```typescript
// backend/src/api/__tests__/sales.integration.test.ts
import request from "supertest";
import { app } from "../../server.js";

describe("POST /api/sales (with validation)", () => {
  it("returns 400 for invalid sale data", async () => {
    const response = await request(app).post("/api/sales").send({
      items: [], // Invalid: empty items
      total_usd: 0,
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.details.errors[0].field).toBe("items");
  });

  it("creates sale with valid data", async () => {
    const response = await request(app)
      .post("/api/sales")
      .send({
        items: [{ product_id: 1, quantity: 2, unit_price_usd: 10 }],
        total_usd: 20,
        total_lbp: 0,
        final_amount: 20,
        payment_method: "CASH",
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
  });
});
```

**Step 3.3: Manual Testing Checklist**

- [ ] Test each endpoint with Postman/Thunder Client
- [ ] Verify error messages are helpful and field-specific
- [ ] Test edge cases (empty strings, negative numbers, invalid enums)
- [ ] Verify existing functionality still works

---

#### **Phase 4: Documentation (30min - 1 hour)**

**Step 4.1: Update API Documentation**

````markdown
<!-- docs/API_VALIDATION.md (CREATE NEW) -->

# API Validation Guide

## Overview

All API endpoints now use Zod for runtime validation. This ensures:

- Type safety at runtime
- Helpful error messages
- Consistent error format
- Protection against malformed data

## Validation Error Format

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {
      "errors": [
        {
          "field": "items",
          "message": "At least one item required",
          "code": "too_small"
        }
      ]
    },
    "field": "items"
  }
}
```
````

## Endpoint Validation Reference

### Sales Endpoints

- `POST /api/sales` → `createSaleSchema`
  - Required: `items[]`, `total_usd`, `final_amount`
  - Optional: `client_id`, `payment_method`, `note`

### Debt Endpoints

- `POST /api/debts/repayment` → `addRepaymentSchema`
  - Required: `clientId`, at least one of (`amountUSD` or `amountLBP`)

[... document all endpoints ...]

````

**Step 4.2: Add Inline Comments**
```typescript
// backend/src/api/sales.ts

/**
 * Create a new sale
 *
 * @route POST /api/sales
 * @validation createSaleSchema - Validates sale items, amounts, payment method
 * @returns 201 - Sale created successfully
 * @returns 400 - Validation error
 * @returns 500 - Internal server error
 */
router.post("/", validateRequest(createSaleSchema), async (req, res) => {
  // Implementation...
});
````

---

### **SUCCESS CRITERIA**

✅ **All 22 routes validated**  
✅ **100% of validation schemas have unit tests**  
✅ **Integration tests passing for critical routes (sales, debts, exchange)**  
✅ **Zero validation bypasses** (all user input validated)  
✅ **Helpful error messages** (field-specific, actionable)  
✅ **Documentation complete** (API reference updated)  
✅ **TypeScript errors: 0** (full build passing)  
✅ **ESLint errors: 0** (code quality maintained)  
✅ **All tests passing** (no regressions introduced)

---

### **BENEFITS**

1. **Security:** Prevents malicious/malformed data from reaching business logic
2. **Data Integrity:** Ensures only valid data enters the database
3. **Developer Experience:** IntelliSense for request schemas, compile-time checking
4. **User Experience:** Clear, field-specific error messages
5. **Maintainability:** Self-documenting code (schemas describe expected input)
6. **Debugging:** Validation failures are caught early with helpful messages

---

### **RISKS & MITIGATION**

| Risk                      | Probability | Impact | Mitigation                          |
| ------------------------- | ----------- | ------ | ----------------------------------- |
| Breaking existing clients | LOW         | HIGH   | Test all endpoints before deploying |
| Performance overhead      | LOW         | LOW    | Zod is fast; measure with profiling |
| Schema drift from types   | MEDIUM      | MEDIUM | Use `z.infer<>` to derive types     |
| Over-validation           | LOW         | MEDIUM | Balance between strict and usable   |

---

### **NEXT ACTIONS**

1. **Approve Plan** - Review and confirm approach
2. **Create Schemas** - Implement Phase 1 (2-3 hours)
3. **Apply to Routes** - Implement Phase 2 (6-7 hours)
4. **Test & Verify** - Implement Phase 3 (2 hours)
5. **Document** - Implement Phase 4 (30min-1 hour)
6. **Deploy** - Roll out with monitoring

**Total Effort:** 10-12 hours  
**Expected Completion:** 1-2 working days  
**Priority:** 🔴 **HIGHEST - Start immediately after current task**

---

## Critical Issues (Priority 1)

### 🔴 C5. Inconsistent Logging

**Issue:** Mix of `console.log` (61 instances) and proper `pino` logger usage

**Evidence:**

```bash
# Found 61 console.log statements outside tests
grep -r "console\." packages/core/src backend/src/api electron-app/handlers
```

**Impact:**

- No log levels (can't filter in production)
- No structured logging (can't parse/query logs)
- No log correlation (can't trace requests)
- Console.log doesn't work in production builds

**Recommendation:**

1. **Standardize on `pino` logger** (already in dependencies)
2. Create logger factory in `@liratek/core`
3. Replace all `console.*` calls

```typescript
// packages/core/src/utils/logger.ts
import pino from "pino";

export const createLogger = (name: string) => {
  return pino({
    name,
    level: process.env.LOG_LEVEL || "info",
    transport:
      process.env.NODE_ENV !== "production"
        ? {
            target: "pino-pretty",
            options: { colorize: true },
          }
        : undefined,
  });
};

export const logger = createLogger("liratek-core");

// Usage in repositories/services
// ❌ OLD
console.log("Creating client:", clientData);

// ✅ NEW
logger.info({ clientData }, "Creating client");
logger.error({ err, clientId }, "Failed to create client");
```

**Benefits:**

- Structured JSON logs for production
- Pretty formatted logs for development
- Log levels: trace, debug, info, warn, error, fatal
- Can send logs to external services (Datadog, Sentry, etc.)

**Estimated Effort:** 4-5 hours  
**Risk:** Low

---

## High Priority (Priority 2)

### 🟠 H2. Environment Variable Management

**Issue:** 66 direct `process.env` accesses scattered across codebase

**Problems:**

- No type safety
- No validation
- No defaults documentation
- Hard to track what env vars are needed

**Recommendation:**
Create centralized config management:

```typescript
// packages/core/src/config/env.ts
import { z } from "zod"; // Already in dependencies

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error"])
    .default("info"),
  DATABASE_PATH: z.string().optional(),
  LIRATEK_DB_KEY: z.string().optional(),

  // Backend-specific
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("7d"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

// Usage
// ❌ OLD
const port = parseInt(process.env.PORT || "3000", 10);

// ✅ NEW
import { env } from "@liratek/core/config";
const port = env.PORT;
```

**Benefits:**

- Type-safe environment variables
- Validation on startup (fail fast)
- Auto-complete for env vars
- Self-documenting configuration

**Estimated Effort:** 3-4 hours  
**Risk:** Low

---

### 🟠 H3. Missing Database Migrations System

**Issue:** Schema changes done via manual SQL edits in `create_db.sql`

**Current State:**

- Migrations exist but are idempotent SQL functions
- No version tracking
- No rollback capability
- No migration history

**Recommendation:**
Implement proper migration system:

```typescript
// packages/core/src/db/migrations/index.ts
export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
  down: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: "add_sessions_table",
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS sessions (...)`);
    },
    down: (db) => {
      db.exec(`DROP TABLE IF EXISTS sessions`);
    },
  },
  // ...
];

export function runMigrations(db: Database.Database) {
  // Create migrations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const currentVersion = db
    .prepare("SELECT MAX(version) as v FROM schema_migrations")
    .get() as { v: number | null };

  const applied = currentVersion?.v || 0;

  for (const migration of migrations) {
    if (migration.version > applied) {
      db.transaction(() => {
        migration.up(db);
        db.prepare(
          "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
        ).run(migration.version, migration.name);
      })();

      logger.info(
        { version: migration.version, name: migration.name },
        "Migration applied",
      );
    }
  }
}
```

**Estimated Effort:** 6-8 hours  
**Risk:** Medium

---

### 🟠 H4. E2E Test Flakiness

**Issue:** Playwright tests disabled in CI (`if: false`)

**Root Causes (Common):**

- Race conditions (page loads, API responses)
- Hardcoded waits instead of smart waiting
- Test interdependence (state pollution)
- Network timing issues

**Recommendation:**

1. **Enable Playwright's auto-waiting:**

```typescript
// tests/e2e/_helpers.ts
export async function waitForApiIdle(page: Page) {
  await page.waitForLoadState("networkidle");
}

export async function login(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.fill('[name="username"]', username);
  await page.fill('[name="password"]', password);

  // ✅ Wait for navigation instead of timeout
  await Promise.all([
    page.waitForNavigation(),
    page.click('button[type="submit"]'),
  ]);
}
```

2. **Isolate test state:**

```typescript
// Use unique test data per test
test("creates client", async ({ page }) => {
  const uniquePhone = `+961${Date.now()}`; // Unique per run
  // ...
});
```

3. **Add retries for flaky tests:**

```typescript
// playwright.config.ts
export default defineConfig({
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
});
```

**Estimated Effort:** 8-12 hours  
**Risk:** Medium

---

### 🟠 H5. Missing API Error Handling Standards

**Issue:** Inconsistent error responses between Electron IPC and REST API

**Evidence:**

```typescript
// Electron returns: { success: false, error: "message" }
// REST returns: { error: "message" } OR { message: "..." }
// Inconsistent status codes
```

**Recommendation:**
Standardize error response format:

```typescript
// packages/core/src/utils/errors.ts
export interface ApiError {
  success: false;
  error: {
    code: string; // e.g., "CLIENT_NOT_FOUND"
    message: string; // Human-readable
    details?: unknown; // Additional context
    field?: string; // For validation errors
  };
}

export interface ApiSuccess<T = void> {
  success: true;
  data: T;
}

export type ApiResponse<T = void> = ApiSuccess<T> | ApiError;

// Error factory
export const createErrorResponse = (
  code: string,
  message: string,
  details?: unknown,
): ApiError => ({
  success: false,
  error: { code, message, details },
});
```

**Usage:**

```typescript
// In handlers/routes
try {
  const result = service.createClient(data);
  return { success: true, data: result };
} catch (err) {
  if (err instanceof NotFoundError) {
    return createErrorResponse("NOT_FOUND", err.message);
  }
  if (err instanceof ValidationError) {
    return createErrorResponse("VALIDATION_ERROR", err.message, err.fields);
  }
  return createErrorResponse("INTERNAL_ERROR", "An unexpected error occurred");
}
```

**Estimated Effort:** 4-6 hours  
**Risk:** Medium (requires updating all handlers/routes)

---

## Medium Priority (Priority 3)

### 🟡 M1. Database Schema Optimization

**Issue:** Missing constraints and potential data integrity issues

**Findings:**

1. **Missing NOT NULL constraints** on critical fields
2. **No CHECK constraints** for business rules
3. **Inconsistent foreign key ON DELETE behavior**

**Recommendations:**

```sql
-- Example improvements to create_db.sql

-- 1. Add NOT NULL to required fields
CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,              -- ✅ Add NOT NULL
    phone_number TEXT UNIQUE NOT NULL,     -- ✅ Add NOT NULL
    whatsapp_opt_in BOOLEAN NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Add CHECK constraints for business rules
CREATE TABLE sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    total_usd DECIMAL(10, 2) NOT NULL CHECK(total_usd >= 0),  -- ✅
    discount DECIMAL(10, 2) DEFAULT 0 CHECK(discount >= 0),   -- ✅
    status TEXT NOT NULL CHECK(status IN ('draft', 'completed', 'refunded')),
    -- ...
);

-- 3. Add amount validation
CREATE TABLE debt_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_type TEXT NOT NULL
        CHECK(transaction_type IN ('SALE', 'REPAYMENT', 'ADJUSTMENT')),
    amount_usd DECIMAL(10, 2) NOT NULL,
    amount_lbp DECIMAL(15, 2) NOT NULL,
    -- At least one amount must be > 0
    CHECK(amount_usd > 0 OR amount_lbp > 0),
    -- ...
);

-- 4. Add unique constraints where needed
CREATE UNIQUE INDEX idx_unique_active_closing
    ON daily_closings(closing_date)
    WHERE status = 'open';  -- Only one open closing per day

-- 5. Add partial indexes for performance
CREATE INDEX idx_active_products
    ON products(category, name)
    WHERE is_active = 1;  -- Index only active products
```

**Estimated Effort:** 4-6 hours  
**Risk:** Medium (requires migration + testing)

---

### 🟡 M2. Frontend Component Architecture

**Issue:** Large feature components mixing concerns (12 large index.tsx files)

**Example:**

```typescript
// frontend/src/features/sales/pages/POS/index.tsx
// 500+ lines mixing:
// - State management
// - Business logic
// - API calls
// - UI rendering
// - Form validation
```

**Recommendation:**
Apply component composition pattern:

```typescript
// ❌ OLD: Monolithic component
export function POS() {
  const [cart, setCart] = useState([]);
  const [customer, setCustomer] = useState(null);
  // ... 50+ lines of state

  const handleCheckout = async () => {
    // ... 100+ lines of logic
  };

  return (
    <div>
      {/* 300+ lines of JSX */}
    </div>
  );
}

// ✅ NEW: Composed components
export function POS() {
  return (
    <POSLayout>
      <ProductSearch />
      <Cart />
      <CheckoutPanel />
    </POSLayout>
  );
}

// Separate business logic
export function useCheckout() {
  const handleCheckout = async (cart: CartItem[]) => {
    // Logic here
  };

  return { handleCheckout };
}
```

**Benefits:**

- Easier to test
- Reusable components
- Clearer responsibilities
- Better performance (React.memo on smaller components)

**Estimated Effort:** 12-16 hours (across all features)  
**Risk:** Low

---

### 🟡 M3. Missing Request Validation

**Issue:** API endpoints don't validate request bodies

**Current State:**

```typescript
// backend/src/api/clients.ts
router.post("/", requireRole(["admin"]), (req, res) => {
  const service = getClientService();
  const result = service.createClient(req.body); // ❌ No validation
  res.status(result.success ? 201 : 400).json(result);
});
```

**Recommendation:**
Use Zod for runtime validation:

```typescript
// packages/core/src/validators/client.ts
import { z } from "zod";

export const createClientSchema = z.object({
  full_name: z.string().min(1).max(255),
  phone_number: z.string().regex(/^\+?[0-9]{8,15}$/),
  notes: z.string().optional(),
  whatsapp_opt_in: z.boolean().default(true),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;

// Middleware
export const validateRequest = <T>(schema: z.ZodSchema<T>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: "Validation error",
          details: err.errors,
        });
      } else {
        next(err);
      }
    }
  };
};

// Usage
router.post(
  "/",
  requireRole(["admin"]),
  validateRequest(createClientSchema), // ✅
  (req, res) => {
    const result = service.createClient(req.body);
    res.status(201).json(result);
  },
);
```

**Estimated Effort:** 8-10 hours  
**Risk:** Low

---

### 🟡 M4. Code Organization - Duplicate electron-app/services

**Issue:** Services in `electron-app/services/` are nearly identical to those in `@liratek/core/services/`

**Example:**

```typescript
// electron-app/services/ClientService.ts (150 lines)
// vs
// packages/core/src/services/ClientService.ts (259 lines)

// Both have same methods, minimal differences
```

**Recommendation:**
Similar to repositories, delete `electron-app/services/` and use `@liratek/core` services directly.

**Exceptions:**
Keep only truly Electron-specific services:

- `ReportService.ts` (uses Electron's file system APIs)
- Any service requiring Electron's IPC or native APIs

**Estimated Effort:** 3-4 hours  
**Risk:** Low

---

### 🟡 M5. WebSocket Usage Unclear

**Issue:** Socket.IO is configured but usage is minimal

**Current State:**

```typescript
// backend/src/server.ts - Socket.IO configured
// backend/src/websocket/io.ts - Helper module
// Only used in ws-debug.ts for testing
```

**Questions:**

1. Is real-time sync needed?
2. What events should be broadcasted?
3. Should client updates trigger notifications?

**Recommendation:**
Either:

- **Option A:** Implement real-time features properly (inventory updates, new sales notifications)
- **Option B:** Remove Socket.IO if not needed (saves resources)

If keeping, implement properly:

```typescript
// Example: Real-time inventory updates
// backend/src/services/InventoryService.ts
import { broadcastEvent } from "../websocket/io.js";

class InventoryService {
  updateStock(productId: number, quantity: number) {
    const result = this.productRepo.updateStock(productId, quantity);

    // Broadcast to all connected clients
    broadcastEvent("inventory:updated", {
      productId,
      quantity,
      timestamp: new Date().toISOString(),
    });

    return result;
  }
}

// frontend/src/api/socket.ts
socket.on("inventory:updated", (data) => {
  // Update local state/cache
  queryClient.invalidateQueries(["products", data.productId]);
});
```

**Estimated Effort:** 6-8 hours (if implementing), 1 hour (if removing)  
**Risk:** Low

---

### 🟡 M6. Missing Data Backup Strategy

**Issue:** No automated backup system (critical for POS data)

**Current State:**

- Manual database file backups only
- No scheduled backups
- No backup verification
- No restore testing

**Recommendation:**
Implement automated backup system:

```typescript
// packages/core/src/services/BackupService.ts
import { resolveDatabasePath } from "../db/dbPath.js";
import fs from "fs";
import path from "path";

export class BackupService {
  private backupDir: string;

  constructor(backupDir?: string) {
    this.backupDir =
      backupDir ||
      path.join(
        process.env.HOME || process.env.USERPROFILE!,
        "liratek-backups",
      );

    // Ensure backup directory exists
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * Create backup with timestamp
   */
  async createBackup(): Promise<string> {
    const dbPath = resolveDatabasePath().path;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(this.backupDir, `liratek_${timestamp}.db`);

    // Use SQLite backup API (safer than file copy)
    const db = getDatabase();
    const backup = db.backup(backupPath);

    await new Promise((resolve, reject) => {
      backup.on("finish", resolve);
      backup.on("error", reject);
    });

    logger.info({ backupPath }, "Database backup created");

    // Verify backup
    await this.verifyBackup(backupPath);

    // Cleanup old backups (keep last 30 days)
    await this.cleanupOldBackups(30);

    return backupPath;
  }

  /**
   * Verify backup integrity
   */
  async verifyBackup(backupPath: string): Promise<boolean> {
    const backupDb = new Database(backupPath, { readonly: true });

    try {
      // Run integrity check
      const result = backupDb.pragma("integrity_check");
      const isValid = result[0]?.integrity_check === "ok";

      if (!isValid) {
        throw new Error("Backup integrity check failed");
      }

      // Verify table count
      const tables = backupDb
        .prepare(
          "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'",
        )
        .get() as { count: number };

      if (tables.count < 10) {
        // Sanity check
        throw new Error("Backup has too few tables");
      }

      logger.info({ backupPath }, "Backup verified successfully");
      return true;
    } finally {
      backupDb.close();
    }
  }

  /**
   * List available backups
   */
  listBackups(): Array<{ path: string; size: number; created: Date }> {
    const files = fs
      .readdirSync(this.backupDir)
      .filter((f) => f.endsWith(".db"))
      .map((f) => {
        const filePath = path.join(this.backupDir, f);
        const stats = fs.statSync(filePath);
        return {
          path: filePath,
          size: stats.size,
          created: stats.birthtime,
        };
      })
      .sort((a, b) => b.created.getTime() - a.created.getTime());

    return files;
  }

  /**
   * Cleanup old backups
   */
  async cleanupOldBackups(daysToKeep: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);

    const backups = this.listBackups();
    let deleted = 0;

    for (const backup of backups) {
      if (backup.created < cutoff) {
        fs.unlinkSync(backup.path);
        deleted++;
        logger.info({ path: backup.path }, "Old backup deleted");
      }
    }

    return deleted;
  }
}

// Schedule daily backups (Electron main process)
function scheduleBackups() {
  const backupService = new BackupService();

  // Run daily at 2 AM
  const DAILY = 24 * 60 * 60 * 1000;
  setInterval(
    async () => {
      const hour = new Date().getHours();
      if (hour === 2) {
        try {
          await backupService.createBackup();
        } catch (err) {
          logger.error({ err }, "Backup failed");
        }
      }
    },
    60 * 60 * 1000,
  ); // Check hourly
}
```

**Additional Features:**

1. Export to CSV/Excel for external storage
2. Cloud backup integration (Google Drive, Dropbox)
3. Backup before major operations (daily closing, refunds)
4. Restore UI with backup preview

**Estimated Effort:** 8-10 hours  
**Risk:** Low

---

## Low Priority / Nice to Have (Priority 4)

### 🔵 L1. Performance Monitoring

**Suggestion:** Add application performance monitoring (APM)

**Implementation:**

```typescript
// packages/core/src/utils/performance.ts
export class PerformanceMonitor {
  private metrics: Map<string, number[]> = new Map();

  measure<T>(name: string, fn: () => T): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      const duration = performance.now() - start;

      if (!this.metrics.has(name)) {
        this.metrics.set(name, []);
      }
      this.metrics.get(name)!.push(duration);

      if (duration > 1000) {
        logger.warn({ operation: name, duration }, "Slow operation detected");
      }
    }
  }

  getStats(name: string) {
    const times = this.metrics.get(name) || [];
    if (times.length === 0) return null;

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const max = Math.max(...times);
    const min = Math.min(...times);

    return { avg, max, min, count: times.length };
  }
}

// Usage
const perf = new PerformanceMonitor();

class SalesRepository {
  createSale(data: SaleRequest) {
    return perf.measure("SalesRepository.createSale", () => {
      // ... implementation
    });
  }
}
```

**Estimated Effort:** 4-6 hours  
**Risk:** Very Low

---

### 🔵 L2. GraphQL API Alternative

**Suggestion:** Consider GraphQL for the web API (optional)

**Benefits:**

- Frontend requests exactly what it needs
- Better type safety
- Single endpoint
- Built-in documentation (GraphQL Playground)

**Trade-offs:**

- More complex than REST
- Adds dependency
- Learning curve

**Recommendation:** Only if planning significant web expansion. REST is fine for current needs.

---

### 🔵 L3. Internationalization (i18n)

**Suggestion:** Prepare for multi-language support

**Current State:** All strings hardcoded in English

**If expanding beyond Lebanon:**

```typescript
// packages/ui/src/i18n/en.ts
export const en = {
  'client.fullName': 'Full Name',
  'client.phone': 'Phone Number',
  'sale.total': 'Total',
  // ...
};

// packages/ui/src/i18n/ar.ts
export const ar = {
  'client.fullName': 'الاسم الكامل',
  'client.phone': 'رقم الهاتف',
  'sale.total': 'المجموع',
};

// Usage with react-i18next
import { useTranslation } from 'react-i18next';

function ClientForm() {
  const { t } = useTranslation();
  return <label>{t('client.fullName')}</label>;
}
```

**Estimated Effort:** 20-30 hours  
**Risk:** Low

---

### 🔵 L4. Code Documentation

**Suggestion:** Add JSDoc comments to all public APIs

**Current State:** Some documentation exists, but inconsistent

**Example:**

````typescript
/**
 * Creates a new client in the system
 *
 * @param data - Client information
 * @param data.full_name - Customer's full name (required)
 * @param data.phone_number - Phone number with country code (required)
 * @param data.whatsapp_opt_in - Whether customer agreed to WhatsApp notifications
 *
 * @returns Result object with success status and client ID
 *
 * @throws {ValidationError} If phone number format is invalid
 * @throws {DuplicateError} If phone number already exists
 *
 * @example
 * ```typescript
 * const result = service.createClient({
 *   full_name: 'John Doe',
 *   phone_number: '+96170123456',
 *   whatsapp_opt_in: true
 * });
 * ```
 */
createClient(data: CreateClientData): ClientResult {
  // ...
}
````

**Estimated Effort:** 12-16 hours  
**Risk:** Very Low

---

### 🔵 L5. Storybook for UI Components

**Suggestion:** Use Storybook for component development and documentation

**Benefits:**

- Visual component library
- Isolated component development
- Automatic documentation
- Design system enforcement

**Setup:**

```bash
yarn add -D @storybook/react @storybook/addon-essentials
```

```typescript
// packages/ui/src/components/ui/Select.stories.tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Select } from "./Select";

const meta: Meta<typeof Select> = {
  component: Select,
  title: "UI/Select",
};

export default meta;

export const Default: StoryObj<typeof Select> = {
  args: {
    options: [
      { value: "usd", label: "USD" },
      { value: "lbp", label: "LBP" },
    ],
  },
};
```

**Estimated Effort:** 8-12 hours (initial setup + key components)  
**Risk:** Very Low

---

## Architecture Recommendations

### AR1. Consider Event-Driven Architecture

**Current:** Direct service calls everywhere

**Suggested:** Event bus for decoupled communication

```typescript
// packages/core/src/events/EventBus.ts
type EventHandler<T = any> = (data: T) => void | Promise<void>;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  on<T>(event: string, handler: EventHandler<T>) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  async emit<T>(event: string, data: T) {
    const handlers = this.handlers.get(event);
    if (!handlers) return;

    await Promise.all(Array.from(handlers).map((h) => h(data)));
  }
}

export const eventBus = new EventBus();

// Usage
// When sale is created
eventBus.emit("sale.created", { saleId: 123, total: 100 });

// Multiple listeners
eventBus.on("sale.created", async (data) => {
  // Update inventory
  await inventoryService.decrementStock(data.items);
});

eventBus.on("sale.created", async (data) => {
  // Send notification
  await notificationService.notifyNewSale(data);
});

eventBus.on("sale.created", async (data) => {
  // Log activity
  await activityService.log("SALE_CREATED", data);
});
```

**Benefits:**

- Loose coupling between modules
- Easy to add new features (just add listener)
- Better testability
- Supports future webhooks/integrations

**Estimated Effort:** 12-16 hours  
**Risk:** Medium

---

### AR2. Repository Factory Pattern

**Current:** Manual repository instantiation

**Suggested:** Factory with dependency injection

```typescript
// packages/core/src/repositories/RepositoryFactory.ts
export class RepositoryFactory {
  private static instances = new Map<string, any>();

  static getRepository<T extends BaseRepository<any>>(
    RepoClass: new () => T,
  ): T {
    const key = RepoClass.name;

    if (!this.instances.has(key)) {
      this.instances.set(key, new RepoClass());
    }

    return this.instances.get(key);
  }

  static reset() {
    this.instances.clear();
  }
}

// Usage
const clientRepo = RepositoryFactory.getRepository(ClientRepository);
```

**Benefits:**

- Centralized instance management
- Easier testing (mock factory)
- Consistent initialization

**Estimated Effort:** 4-6 hours  
**Risk:** Low

---

### AR3. Domain-Driven Design Layers

**Suggestion:** Formalize DDD layers

**Current Structure:**

```
Repository → Service → Handler/Route
```

**Suggested Structure:**

```
Entity (domain models)
  ↓
Repository (data access)
  ↓
Domain Service (business rules)
  ↓
Application Service (use cases)
  ↓
API Handler/Route (presentation)
```

**Example:**

```typescript
// Domain Layer
// packages/core/src/domain/Client.ts
export class Client {
  constructor(
    public id: number,
    public fullName: string,
    public phone: string,
    private debtAmount: number,
  ) {}

  canPurchaseOnCredit(amount: number): boolean {
    return this.debtAmount + amount <= 1000; // Business rule
  }

  get hasDebt(): boolean {
    return this.debtAmount > 0;
  }
}

// Application Layer
// packages/core/src/application/CreateSaleUseCase.ts
export class CreateSaleUseCase {
  execute(command: CreateSaleCommand): SaleResult {
    const client = this.clientRepo.findById(command.clientId);

    // Business logic in domain
    if (!client.canPurchaseOnCredit(command.total)) {
      return { success: false, error: "Credit limit exceeded" };
    }

    // Orchestration
    const sale = this.saleRepo.create(command);
    this.inventoryRepo.decrementStock(command.items);

    return { success: true, saleId: sale.id };
  }
}
```

**Estimated Effort:** 20-30 hours (gradual migration)  
**Risk:** Medium-High

---

## Database Recommendations

### DB1. Add Database Query Optimization

**Issue:** No query performance tracking

**Recommendations:**

1. **Enable SQLite query profiling:**

```typescript
// packages/core/src/db/connection.ts
if (process.env.NODE_ENV === "development") {
  db.pragma("stats = ON");

  // Log slow queries
  db.function("slow_query_log", (query: string, duration: number) => {
    if (duration > 100) {
      // ms
      logger.warn({ query, duration }, "Slow query detected");
    }
  });
}
```

2. **Add missing indexes:**

```sql
-- High-frequency queries that need indexes

-- Sale searches by date range
CREATE INDEX IF NOT EXISTS idx_sales_created_at_desc
  ON sales(created_at DESC);

-- Client search by name
CREATE INDEX IF NOT EXISTS idx_clients_full_name
  ON clients(full_name COLLATE NOCASE);

-- Product search optimization
CREATE INDEX IF NOT EXISTS idx_products_search
  ON products(name, barcode)
  WHERE is_active = 1;

-- Debt queries optimization
CREATE INDEX IF NOT EXISTS idx_debt_client_date
  ON debt_ledger(client_id, created_at DESC);
```

3. **ANALYZE statistics:**

```typescript
// Run periodically (daily closing)
db.exec("ANALYZE");
```

**Estimated Effort:** 3-4 hours  
**Risk:** Very Low

---

### DB2. Implement Soft Deletes Consistently

**Issue:** Mix of hard deletes and soft deletes

**Current State:**

- Some tables have `is_active` flag
- Others do hard deletes (data loss risk)

**Recommendation:**
Standardize on soft deletes for business data:

```sql
-- Add deleted_at column to all business tables
ALTER TABLE clients ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE products ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE sales ADD COLUMN deleted_at DATETIME DEFAULT NULL;

-- Create view for active records
CREATE VIEW active_clients AS
  SELECT * FROM clients WHERE deleted_at IS NULL;

CREATE VIEW active_products AS
  SELECT * FROM products WHERE deleted_at IS NULL;
```

```typescript
// BaseRepository soft delete
class BaseRepository<T> {
  softDelete(id: number): boolean {
    const stmt = this.db.prepare(`
      UPDATE ${this.tableName} 
      SET deleted_at = datetime('now') 
      WHERE id = ?
    `);

    const result = stmt.run(id);
    return result.changes > 0;
  }

  restore(id: number): boolean {
    const stmt = this.db.prepare(`
      UPDATE ${this.tableName} 
      SET deleted_at = NULL 
      WHERE id = ?
    `);

    const result = stmt.run(id);
    return result.changes > 0;
  }
}
```

**Benefits:**

- Audit trail (can see what was deleted and when)
- Recover from accidental deletions
- Compliance (some regulations require data retention)

**Estimated Effort:** 6-8 hours  
**Risk:** Medium

---

### DB3. Database Connection Pooling

**Issue:** Single connection shared across all operations

**Current State:**

```typescript
// packages/core/src/db/connection.ts
let db: Database.Database | null = null; // Single connection
```

**For Web Backend:**
Consider connection pooling for concurrent requests:

```typescript
// backend/src/database/pool.ts
import Database from "better-sqlite3";

class DatabasePool {
  private pool: Database.Database[] = [];
  private readonly maxConnections = 5;

  getConnection(): Database.Database {
    if (this.pool.length < this.maxConnections) {
      const db = new Database(DB_PATH);
      db.pragma("journal_mode = WAL");
      this.pool.push(db);
      return db;
    }

    // Round-robin selection
    return this.pool[Math.floor(Math.random() * this.pool.length)];
  }

  closeAll() {
    this.pool.forEach((db) => db.close());
    this.pool = [];
  }
}
```

**Note:** SQLite in WAL mode supports multiple readers, so this is mainly for write concurrency.

**Estimated Effort:** 4-6 hours  
**Risk:** Medium

---

## Backend Recommendations

### BE1. Add Rate Limiting

**Issue:** No rate limiting on API endpoints

**Recommendation:**

```typescript
// backend/src/middleware/rateLimit.ts
import rateLimit from "express-rate-limit";

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 login attempts per 15 minutes
  message: "Too many login attempts, please try again later.",
  skipSuccessfulRequests: true,
});

// Usage
app.use("/api/", apiLimiter);
app.use("/api/auth/login", authLimiter);
```

**Estimated Effort:** 2-3 hours  
**Risk:** Low

---

### BE2. Add Request Correlation IDs

**Issue:** Hard to trace requests across logs

**Recommendation:**

```typescript
// backend/src/middleware/requestId.ts
import { randomUUID } from "crypto";

export function requestIdMiddleware(req, res, next) {
  req.id = randomUUID();
  res.setHeader("X-Request-ID", req.id);
  next();
}

// Update logger to include request ID
app.use((req, res, next) => {
  req.log = logger.child({ requestId: req.id });
  next();
});

// Usage in routes
router.get("/clients", (req, res) => {
  req.log.info("Fetching clients");
  // ...
});
```

**Estimated Effort:** 2-3 hours  
**Risk:** Very Low

---

### BE3. Add Health Check Endpoints

**Current:** Basic `/health` endpoint

**Recommendation:** Comprehensive health checks

```typescript
// backend/src/api/health.ts
import { Router } from "express";
import { getDatabase } from "../database/connection.js";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

router.get("/health/detailed", (_req, res) => {
  const checks = {
    database: checkDatabase(),
    memory: checkMemory(),
    disk: checkDisk(),
  };

  const allHealthy = Object.values(checks).every((c) => c.healthy);

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? "healthy" : "unhealthy",
    timestamp: new Date().toISOString(),
    checks,
  });
});

function checkDatabase() {
  try {
    const db = getDatabase();
    db.prepare("SELECT 1").get();
    return { healthy: true };
  } catch (err) {
    return { healthy: false, error: err.message };
  }
}

function checkMemory() {
  const usage = process.memoryUsage();
  const heapUsedMB = usage.heapUsed / 1024 / 1024;
  const threshold = 500; // MB

  return {
    healthy: heapUsedMB < threshold,
    heapUsedMB: Math.round(heapUsedMB),
    threshold,
  };
}

function checkDisk() {
  // Implement disk space check
  return { healthy: true };
}
```

**Estimated Effort:** 3-4 hours  
**Risk:** Very Low

---

## Frontend Recommendations

### FE1. Add React Query for Data Fetching

**Issue:** Manual state management for server data

**Current State:**

```typescript
const [clients, setClients] = useState([]);
const [loading, setLoading] = useState(false);

useEffect(() => {
  setLoading(true);
  api.getClients().then((data) => {
    setClients(data);
    setLoading(false);
  });
}, []);
```

**Recommendation:**
Use React Query (TanStack Query):

```typescript
// frontend/src/hooks/useClients.ts
import { useQuery } from '@tanstack/react-query';

export function useClients(search?: string) {
  return useQuery({
    queryKey: ['clients', search],
    queryFn: () => api.getClients(search),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Usage
function ClientList() {
  const { data: clients, isLoading, error } = useClients();

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage error={error} />;

  return <Table data={clients} />;
}
```

**Benefits:**

- Automatic caching
- Background refetching
- Optimistic updates
- Error handling
- Loading states

**Estimated Effort:** 8-12 hours  
**Risk:** Low

---

### FE2. Add Error Boundary

**Issue:** Uncaught errors crash entire app

**Recommendation:**

```typescript
// frontend/src/components/ErrorBoundary.tsx
import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error({ error, errorInfo }, 'React error boundary caught error');
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="error-container">
          <h1>Something went wrong</h1>
          <p>{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()}>
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Usage in App.tsx
<ErrorBoundary>
  <App />
</ErrorBoundary>
```

**Estimated Effort:** 2-3 hours  
**Risk:** Very Low

---

### FE3. Add Form State Management

**Issue:** Manual form state management

**Recommendation:**
Use React Hook Form:

```typescript
// frontend/src/features/clients/ClientForm.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createClientSchema } from '@liratek/core';

export function ClientForm() {
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(createClientSchema),
  });

  const onSubmit = async (data) => {
    await api.createClient(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('full_name')} />
      {errors.full_name && <span>{errors.full_name.message}</span>}

      <input {...register('phone_number')} />
      {errors.phone_number && <span>{errors.phone_number.message}</span>}

      <button type="submit">Create</button>
    </form>
  );
}
```

**Benefits:**

- Less boilerplate
- Built-in validation
- Error handling
- Dirty state tracking

**Estimated Effort:** 6-8 hours  
**Risk:** Low

---

## Security Recommendations

### SEC1. SQL Injection Prevention Audit

**Current State:** Using parameterized queries (✅ Good!)

**Verification Needed:**

- Ensure ALL queries use parameterized statements
- No string concatenation in SQL

```typescript
// ❌ DANGEROUS - SQL Injection risk
const query = `SELECT * FROM clients WHERE name = '${userName}'`;

// ✅ SAFE - Parameterized query
const stmt = db.prepare("SELECT * FROM clients WHERE name = ?");
stmt.get(userName);
```

**Action:** Code audit for string interpolation in SQL queries.

**Estimated Effort:** 2-3 hours  
**Risk:** Very Low (already using prepared statements)

---

### SEC2. JWT Secret Management

**Issue:** JWT_SECRET in environment variable (potential risk)

**Current:**

```typescript
JWT_SECRET: process.env.JWT_SECRET || "default-secret";
```

**Recommendation:**

1. **Never use default secrets:**

```typescript
// Fail if JWT_SECRET not provided
if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}
```

2. **Generate strong secrets:**

```bash
# Generate 256-bit secret
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

3. **Consider key rotation:**

```typescript
// Support multiple secrets for rotation
const secrets = [
  process.env.JWT_SECRET,
  process.env.JWT_SECRET_OLD, // For graceful rotation
].filter(Boolean);

function verifyToken(token: string) {
  for (const secret of secrets) {
    try {
      return jwt.verify(token, secret);
    } catch (err) {
      continue;
    }
  }
  throw new Error("Invalid token");
}
```

**Estimated Effort:** 2-3 hours  
**Risk:** Low

---

### SEC3. Add Content Security Policy

**Issue:** No CSP headers in web mode

**Recommendation:**

```typescript
// backend/src/server.ts
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // Remove unsafe-inline if possible
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  }),
);
```

**Estimated Effort:** 2-3 hours  
**Risk:** Low

---

## Performance Optimization

### PERF1. Bundle Size Optimization

**Recommendation:**

1. **Analyze bundle:**

```bash
yarn workspace @liratek/frontend build
npx vite-bundle-visualizer
```

2. **Code splitting:**

```typescript
// frontend/src/app/App.tsx
import { lazy, Suspense } from 'react';

const Dashboard = lazy(() => import('../features/dashboard/Dashboard'));
const Clients = lazy(() => import('../features/clients/Clients'));

function App() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/clients" element={<Clients />} />
      </Routes>
    </Suspense>
  );
}
```

3. **Tree shaking:**
   Ensure all imports are ES modules:

```typescript
// ❌ BAD - imports entire library
import _ from "lodash";

// ✅ GOOD - tree-shakeable
import { debounce } from "lodash-es";
```

**Estimated Effort:** 4-6 hours  
**Risk:** Low

---

### PERF2. Database Query Batching

**Issue:** N+1 query problem in some endpoints

**Example:**

```typescript
// ❌ BAD - N+1 queries
const sales = getSales();
sales.forEach((sale) => {
  sale.client = getClient(sale.client_id); // N queries
});

// ✅ GOOD - Single query with JOIN
const sales = db
  .prepare(
    `
  SELECT 
    s.*,
    c.full_name as client_name,
    c.phone_number as client_phone
  FROM sales s
  LEFT JOIN clients c ON s.client_id = c.id
  WHERE s.created_at >= ?
`,
  )
  .all(startDate);
```

**Estimated Effort:** 4-6 hours  
**Risk:** Low

---

## Testing Strategy

### TEST1. Add Integration Tests

**Current:** Unit tests exist, but no integration tests

**Recommendation:**

```typescript
// backend/src/__tests__/integration/sales.integration.test.ts
describe("Sales Flow Integration", () => {
  let testDb: Database.Database;

  beforeEach(() => {
    testDb = new Database(":memory:");
    // Setup schema
    testDb.exec(fs.readFileSync("electron-app/create_db.sql", "utf-8"));
    initDatabase(testDb);
  });

  afterEach(() => {
    testDb.close();
  });

  it("should create sale and update inventory", () => {
    // Create product
    const productService = getInventoryService();
    const product = productService.createProduct({
      name: "iPhone",
      stock: 10,
      // ...
    });

    // Create sale
    const salesService = getSalesService();
    const sale = salesService.createSale({
      items: [{ product_id: product.id!, quantity: 2 }],
      // ...
    });

    // Verify inventory decreased
    const updated = productService.getProduct(product.id!);
    expect(updated.stock).toBe(8);
  });
});
```

**Estimated Effort:** 12-16 hours  
**Risk:** Low

---

### TEST2. Add Contract Tests

**Issue:** No tests verifying API contracts between frontend and backend

**Recommendation:**
Use Pact or similar contract testing:

```typescript
// frontend/src/__tests__/contracts/clients.pact.test.ts
import { pactWith } from "jest-pact";

pactWith({ consumer: "Frontend", provider: "Backend" }, (provider) => {
  describe("GET /api/clients", () => {
    beforeEach(() =>
      provider.addInteraction({
        state: "clients exist",
        uponReceiving: "a request for all clients",
        withRequest: {
          method: "GET",
          path: "/api/clients",
        },
        willRespondWith: {
          status: 200,
          body: {
            success: true,
            clients: eachLike({
              id: like(1),
              full_name: like("John Doe"),
              phone_number: like("+96170123456"),
            }),
          },
        },
      }),
    );

    it("returns a list of clients", async () => {
      const clients = await api.getClients();
      expect(clients).toHaveLength(1);
    });
  });
});
```

**Estimated Effort:** 8-12 hours  
**Risk:** Medium

---

## DevOps & Infrastructure

### DEVOPS1. Add Docker Development Environment

**Current:** Docker for production only

**Recommendation:**
Create docker-compose for local development:

```yaml
# docker-compose.dev.yml
version: "3.8"

services:
  backend:
    build:
      context: .
      dockerfile: backend/Dockerfile.dev
    volumes:
      - ./backend:/app/backend
      - ./packages:/app/packages
      - backend_node_modules:/app/backend/node_modules
    environment:
      - NODE_ENV=development
      - DATABASE_PATH=/data/dev.db
    ports:
      - "3000:3000"
    command: npm run dev

  frontend:
    build:
      context: .
      dockerfile: frontend/Dockerfile.dev
    volumes:
      - ./frontend:/app/frontend
      - ./packages:/app/packages
      - frontend_node_modules:/app/frontend/node_modules
    ports:
      - "5173:5173"
    command: npm run dev

volumes:
  backend_node_modules:
  frontend_node_modules:
```

**Estimated Effort:** 4-6 hours  
**Risk:** Low

---

### DEVOPS2. Add GitHub Actions for Releases

**Current:** Manual releases

**Recommendation:**

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - "v*"

jobs:
  build-electron:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [macos-latest, windows-latest]

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: corepack enable
      - run: yarn install --immutable
      - run: yarn build

      - name: Build Electron App
        run: yarn electron:build

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: app-${{ matrix.os }}
          path: releases/

      - name: Release
        uses: softprops/action-gh-release@v1
        with:
          files: releases/*
```

**Estimated Effort:** 6-8 hours  
**Risk:** Low

---

## Implementation Roadmap

### Phase 1: Critical Fixes (Week 1-2)

**Total Effort: ~15-20 hours** (was ~35-45 hours)

1. ~~**C1:** Delete duplicate repositories (4-6h)~~ ✅ COMPLETED
2. ~~**C2:** Remove backend service layer redundancy (2-3h)~~ ✅ COMPLETED
3. ~~**C3:** Fix weak type safety in API layer (3-4h)~~ ✅ COMPLETED
4. ~~**C4:** Implement transaction management (6-8h)~~ ✅ COMPLETED
5. **C5:** Standardize logging (4-5h)
6. **H2:** Environment variable management (3-4h)
7. **SEC2:** JWT secret management (2-3h)
8. **BE1:** Add rate limiting (2-3h)

**Expected Outcomes:**

- ✅ Eliminated ~5,000 lines of duplicate code
- ✅ Type-safe API layer
- ✅ Data integrity guaranteed with transactions
- 🔄 Professional logging (in progress)
- 🔄 Better security (in progress)

---

### Phase 2: High Priority Improvements (Week 3-4)

**Total Effort: ~35-45 hours**

1. ~~**H1:** Replace SELECT \* queries~~ ✅ COMPLETED
2. **H3:** Database migrations system (6-8h)
3. **H4:** Fix E2E test flakiness (8-12h)
4. **H5:** Standardize error handling (4-6h)
5. **M3:** Request validation with Zod (8-10h)
6. **DB1:** Query optimization (3-4h)

**Expected Outcomes:**

- Stable CI/CD pipeline
- Proper migration system
- Validated API inputs
- Better query performance

---

### Phase 3: Medium Priority (Week 5-6)

**Total Effort: ~30-40 hours**

1. **M1:** Database schema optimization (4-6h)
2. **M2:** Frontend component refactoring (12-16h)
3. **M6:** Automated backup system (8-10h)
4. **FE1:** Add React Query (8-12h)

**Expected Outcomes:**

- Cleaner frontend architecture
- Automated backups
- Better data fetching

---

### Phase 4: Polish & Nice-to-Haves (Week 7-8)

**Total Effort: ~20-30 hours**

1. **L1:** Performance monitoring (4-6h)
2. **L4:** Code documentation (12-16h)
3. **PERF1:** Bundle optimization (4-6h)
4. **TEST1:** Integration tests (12-16h)

**Expected Outcomes:**

- Better observability
- Documented codebase
- Faster load times

---

## Success Metrics

### Code Quality

- [x] Zero duplicate repositories ✅
- [x] 100% TypeScript type safety (no `any` or `unknown` in public APIs) ✅
- [x] All SQL queries use explicit column lists ✅
- [ ] Zero console.log in production code

### Testing

- [ ] E2E tests passing in CI
- [ ] > 80% code coverage
- [ ] All critical paths have integration tests

### Performance

- [ ] All queries < 100ms (p95)
- [ ] Frontend bundle < 500KB gzipped
- [ ] API responses < 200ms (p95)

### Security

- [ ] No hardcoded secrets
- [ ] All inputs validated
- [ ] SQL injection audit passed
- [ ] CSP headers configured

### Reliability

- [ ] Automated daily backups
- [x] Transaction wrapping on critical operations ✅
- [ ] Graceful error handling
- [ ] Health check endpoints

---

## Conclusion

LiraTek POS is a well-built application with solid foundations. The recommendations in this document address technical debt and prepare the codebase for future growth.

**Priority Focus:**

1. ~~**Eliminate duplicate code** (Critical)~~ ✅ COMPLETED
2. ~~**Add transaction management** (Critical - data integrity)~~ ✅ COMPLETED
3. ~~**Fix type safety** (Critical - developer experience)~~ ✅ COMPLETED
4. **Stabilize E2E tests** (High - CI reliability)
5. **Standardize logging** (Critical - production readiness)

**Total Estimated Effort:** 90-120 hours (2-3 weeks of focused work)
**Already Completed:** 30-40 hours worth of critical improvements ✅

**Expected ROI:**

- **Reduced Bugs:** Transaction management prevents data corruption
- **Faster Development:** Type safety catches errors at compile time
- **Lower Maintenance:** Single source of truth eliminates drift
- **Better Reliability:** Comprehensive testing and monitoring

**Next Steps:**

1. Review and prioritize recommendations
2. Create tracking tickets (Jira/GitHub Issues)
3. Start with Phase 1 (Critical Fixes)
4. Measure success metrics after each phase

---

**Document End**
