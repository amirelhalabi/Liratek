---
title: IPC Handler Pattern
impact: CRITICAL
impactDescription: All IPC handlers must follow consistent pattern with auth, error handling, and standardized response
tags:
  - ipc
  - handler
  - electron
  - critical
---

# IPC Handler Pattern

All IPC handlers MUST follow the standard pattern with authentication, error handling, and standardized response format.

## Handler Structure

```typescript
import { ipcMain } from "electron";
import { getMyService, myLogger } from "@liratek/core";
import { requireRole } from "../session.js";

let service: ReturnType<typeof getMyService> | null = null;

function getServiceInstance() {
  if (!service) {
    service = getMyService();
  }
  return service;
}

export function registerMyHandlers(): void {
  myLogger.info("Registering My IPC handlers");

  // CREATE
  ipcMain.handle("my:create", async (e, data: any) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error);

      const service = getServiceInstance();
      const result = service.createEntity(data);
      return { success: true, result };
    } catch (error) {
      myLogger.error({ error }, "my:create failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create",
      };
    }
  });

  // READ
  ipcMain.handle("my:get", async (e, id: number) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error);

      const service = getServiceInstance();
      const result = service.getById(id);
      return { success: true, result };
    } catch (error) {
      myLogger.error({ error }, "my:get failed");
      return { success: false, error: error.message };
    }
  });

  // UPDATE
  ipcMain.handle("my:update", async (e, id: number, data: any) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error);

      const service = getServiceInstance();
      const result = service.update(id, data);
      return { success: true, result };
    } catch (error) {
      myLogger.error({ error }, "my:update failed");
      return { success: false, error: error.message };
    }
  });

  // DELETE
  ipcMain.handle("my:delete", async (e, id: number) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error);

      const service = getServiceInstance();
      service.delete(id);
      return { success: true };
    } catch (error) {
      myLogger.error({ error }, "my:delete failed");
      return { success: false, error: error.message };
    }
  });

  myLogger.info("My IPC handlers registered");
}
```

## Required Elements

✅ **DO:**

- Import service from `@liratek/core`
- Create singleton service instance
- Add authentication with `requireRole()`
- Wrap in try-catch blocks
- Return `{ success, data?, error? }` format
- Log handler registration
- Log errors with context
- Use module-specific logger

❌ **DON'T:**

- Put business logic in handlers
- Skip authentication
- Skip error handling
- Return non-standard response format
- Use `console.log`
- Access database directly (use service)

## Response Format

### Success

```typescript
{ success: true, result: data }
{ success: true, sale: saleData }
{ success: true, ticket: ticketData }
{ success: true } // For delete
```

### Error

```typescript
{ success: false, error: "Error message" }
```

## Handler Registration

In `electron-app/main.ts`:

```typescript
async function initializeApp() {
  // Import handlers
  const myHandlers = await import("./handlers/myHandlers.js");

  // Register handlers
  myHandlers.registerMyHandlers();
}
```

## Preload Binding

In `electron-app/preload.ts`:

```typescript
myModule: {
  create: (data: CreateData) =>
    ipcRenderer.invoke("my:create", data),
  get: (id: number) =>
    ipcRenderer.invoke("my:get", id),
  update: (id: number, data: UpdateData) =>
    ipcRenderer.invoke("my:update", id, data),
  delete: (id: number) =>
    ipcRenderer.invoke("my:delete", id),
},
```

## TypeScript Types

In `frontend/src/types/electron.d.ts`:

```typescript
myModule: {
  create: (data: CreateData) =>
    Promise<{ success: boolean; result?: any; error?: string }>;
  get: (id: number) =>
    Promise<{ success: boolean; result?: any; error?: string }>;
  update: (id: number, data: UpdateData) =>
    Promise<{ success: boolean; result?: any; error?: string }>;
  delete: (id: number) =>
    Promise<{ success: boolean; error?: string }>;
};
```

## Example: Sales Handlers

```typescript
import { ipcMain } from "electron";
import { getSalesService, salesLogger } from "@liratek/core";
import { requireRole } from "../session.js";

let service: ReturnType<typeof getSalesService> | null = null;

function getServiceInstance() {
  if (!service) {
    service = getSalesService();
  }
  return service;
}

export function registerSalesHandlers(): void {
  salesLogger.info("Registering Sales IPC handlers");

  ipcMain.handle("sales:create", async (e, data: any) => {
    try {
      const auth = requireRole(e.sender.id, ["admin", "cashier"]);
      if (!auth.ok) throw new Error(auth.error);

      const service = getServiceInstance();
      const sale = service.createSale(data);
      return { success: true, sale };
    } catch (error) {
      salesLogger.error({ error }, "sales:create failed");
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("sales:get", async (e, id: number) => {
    try {
      const auth = requireRole(e.sender.id, ["admin", "cashier"]);
      if (!auth.ok) throw new Error(auth.error);

      const service = getServiceInstance();
      const sale = service.getSaleById(id);
      return { success: true, sale };
    } catch (error) {
      salesLogger.error({ error }, "sales:get failed");
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("sales:report", async (e, from: string, to: string) => {
    try {
      const auth = requireRole(e.sender.id, ["admin", "manager"]);
      if (!auth.ok) throw new Error(auth.error);

      const service = getServiceInstance();
      const report = service.getReport(from, to);
      return { success: true, report };
    } catch (error) {
      salesLogger.error({ error }, "sales:report failed");
      return { success: false, error: error.message };
    }
  });

  salesLogger.info("Sales IPC handlers registered");
}
```

## Reference

- Example: `electron-app/handlers/salesHandlers.ts`
- Session: `electron-app/session.ts`
- Preload: `electron-app/preload.ts`
