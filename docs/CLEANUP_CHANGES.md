# Cleanup Changes Log

This document captures the primary cleanup edits made during Phases 1–3 to reduce `any` usage, normalize error handling, and improve typings in services, handlers, repositories, and UI components. Each entry shows Before → After code excerpts.

## TopBar (src/shared/components/layouts/TopBar.tsx)

- Remove `any` cast in filter setter

Before:

```tsx
onClick={() => setFilter(f as any)}
```

After:

```tsx
onClick={() => setFilter(f as UINotification["type"] | "all")}
```

## MainLayout (src/shared/components/layouts/MainLayout.tsx)

- Replace window `any` cast with typed overlay

Before:

```tsx
(window as any).currentUserId = user?.id;
```

After:

```tsx
(window as unknown as { currentUserId?: number | undefined }).currentUserId =
  user?.id;
```

## receiptFormatter (src/features/sales/utils/receiptFormatter.ts)

- Safer generic map for JSON export

Before:

```ts
export function getReceiptJSON(data: ReceiptData): Record<string, any> {
```

After:

```ts
export function getReceiptJSON(data: ReceiptData): Record<string, unknown> {
```

## Dashboard (src/features/dashboard/pages/Dashboard.tsx)

- Tooltip formatter typed

Before:

```tsx
formatter={(value: any) =>
```

After:

```tsx
formatter={(value: number) =>
```

## dbHandlers (electron/handlers/dbHandlers.ts)

- Type payloads; safe error logging; remove `as any`

Before:

```ts
ipcMain.handle("closing:set-opening-balances", (e, data: any) => {
...
} catch (error: any) {
  closingLogger.error({ error: error.message }, "Error checking opening balance");
}
ipcMain.handle("closing:create-daily-closing", (e, data: any) => {
...
if (!auth.ok) return { success: false, error: auth.error } as any;
```

After:

```ts
ipcMain.handle("closing:set-opening-balances", (e, data: { drawer_name: string; balances: Record<string, number> }) => {
...
} catch (error) {
  closingLogger.error({ error: (error instanceof Error ? error.message : String(error)) }, "Error checking opening balance");
}
ipcMain.handle("closing:create-daily-closing", (e, data: { drawer_name: string; note?: string }) => {
...
if (!auth.ok) return { success: false, error: auth.error };
```

## inventoryHandlers (electron/handlers/inventoryHandlers.ts)

- Remove `any` in catch blocks of read handlers

Before:

```ts
} catch (error: any) {
  console.error("Failed to get stock stats:", error);
  return { stock_budget_usd: 0, stock_count: 0 };
}
```

After:

```ts
} catch (error) {
  console.error("Failed to get stock stats:", error);
  return { stock_budget_usd: 0, stock_count: 0 };
}
```

Before:

```ts
} catch (error: any) {
  console.error("Failed to get low stock products:", error);
  return [];
}
```

After:

```ts
} catch (error) {
  console.error("Failed to get low stock products:", error);
  return [];
}
```

## maintenanceHandlers (electron/handlers/maintenanceHandlers.ts)

- Type maintenance save payload and correct log prop

Before:

```ts
ipcMain.handle("maintenance:save", (e, job: any) => {
  maintenanceLogger.info({ jobId: job.id, device: job.device_type }, "Saving maintenance job");
```

After:

```ts
type MaintenanceJobInput = { id?: number; device_name: string; issue_description: string; estimated_cost_usd?: number; repair_price_usd?: number; status?: string; client_name?: string; client_phone?: string };
ipcMain.handle("maintenance:save", (e, job: MaintenanceJobInput) => {
  maintenanceLogger.info({ jobId: job.id, device: job.device_name }, "Saving maintenance job");
```

## reportHandlers (electron/handlers/reportHandlers.ts)

- Remove `as any` from auth guard returns

Before:

```ts
if (!auth.ok) return { success: false, error: auth.error } as any;
```

After:

```ts
if (!auth.ok) return { success: false, error: auth.error };
```

## RechargeRepository (electron/database/repositories/RechargeRepository.ts)

- Normalize catch typing and error message access

Before:

```ts
} catch (error: any) {
  console.error('Recharge failed:', error);
  return { success: false, error: error.message };
}
```

After:

```ts
} catch (error) {
  console.error('Recharge failed:', error);
  return { success: false, error: (error instanceof Error ? error.message : String(error)) };
}
```

## SalesRepository (electron/database/repositories/SalesRepository.ts)

- Avoid `any` in processSale catch and return safe message

Before:

```ts
} catch (error: any) {
  console.error('Sale transaction failed:', error);
  return { success: false, error: error.message };
}
```

After:

```ts
} catch (error) {
  console.error('Sale transaction failed:', error);
  return { success: false, error: (error instanceof Error ? error.message : String(error)) };
}
```

## ProductRepository (electron/database/repositories/ProductRepository.ts)

- Remove `any` in create/update catches; read SQLite code via safe access

Before:

```ts
} catch (error: any) {
  if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    throw new DatabaseError('Barcode already exists', { cause: error, code: 'DUPLICATE_BARCODE' });
  }
  throw new DatabaseError('Failed to update product', { cause: error, entityId: id });
}
```

After:

```ts
} catch (error) {
  const code = (error as { code?: string })?.code;
  if (code === 'SQLITE_CONSTRAINT_UNIQUE') {
    throw new DatabaseError('Barcode already exists', { cause: error, code: 'DUPLICATE_BARCODE' });
  }
  throw new DatabaseError('Failed to update product', { cause: error, entityId: id });
}
```

## ClientRepository (electron/database/repositories/ClientRepository.ts)

- Remove `any` in create/update catches; safe SQLite code detection

Before:

```ts
} catch (error: any) {
  if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    throw new DatabaseError('Phone number already registered', { cause: error, code: 'DUPLICATE_PHONE' });
  }
  throw new DatabaseError('Failed to create client', { cause: error });
}
```

After:

```ts
} catch (error) {
  const code = (error as { code?: string })?.code;
  if (code === 'SQLITE_CONSTRAINT_UNIQUE') {
    throw new DatabaseError('Phone number already registered', { cause: error, code: 'DUPLICATE_PHONE' });
  }
  throw new DatabaseError('Failed to create client', { cause: error });
}
```

## ClosingRepository (electron/database/repositories/ClosingRepository.ts)

- Remove `any` in multiple catch locations (transactions/updates)

Before:

```ts
} catch (error: any) {
  // various branches
}
```

After:

```ts
} catch (error) {
  // various branches
}
```

## ClosingService (electron/services/ClosingService.ts)

- Remove `any` in getSystemExpectedBalances/getDailyStatsSnapshot

Before:

```ts
} catch (error: any) {
  console.error("ClosingService.getSystemExpectedBalances error:", error);
  return { ... };
}
```

After:

```ts
} catch (error) {
  console.error("ClosingService.getSystemExpectedBalances error:", error);
  return { ... };
}
```

Before:

```ts
} catch (error: any) {
  console.error("ClosingService.getDailyStatsSnapshot error:", error);
  return { ... };
}
```

After:

```ts
} catch (error) {
  console.error("ClosingService.getDailyStatsSnapshot error:", error);
  return { ... };
}
```

## Inventory/Expense/Report/Currency Services

- Normalize catch and error return paths with safe conversion (selected lines in each file)

Pattern Before:

```ts
} catch (error: any) {
  return { success: false, error: error.message };
}
```

Pattern After:

```ts
} catch (error) {
  return { success: false, error: (error instanceof Error ? error.message : String(error)) };
}
```
