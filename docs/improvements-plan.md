# Code Quality Improvements — Implementation Plan

Based on the code audit findings and decisions made on 2026-03-09.

---

## Decisions Summary

| Question                     | Decision                                     |
| ---------------------------- | -------------------------------------------- |
| Code signing                 | Later (future release)                       |
| `sandbox: true`              | Enable and test                              |
| React memoization scope      | Selective — POS, DataTable, heavy pages only |
| Input validation library     | Zod                                          |
| CSP tightening               | Skip — WhatsApp API needs broad connect-src  |
| `uncaughtException` behavior | Show dialog + offer restart                  |

---

## Priority 1 — Safety & Reliability (Do First)

### 1.1 `uncaughtException` + `unhandledRejection` handlers

**File:** `electron-app/main.ts`

Add error handlers before `app.whenReady()`:

```ts
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception in main process");
  dialog
    .showMessageBox({
      type: "error",
      title: "Unexpected Error",
      message: "An unexpected error occurred.",
      detail: err.message,
      buttons: ["Restart", "Quit"],
    })
    .then(({ response }) => {
      if (response === 0) app.relaunch();
      app.quit();
    });
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection in main process");
});
```

### 1.2 React `ErrorBoundary`

**File:** `frontend/src/App.tsx` (or create `frontend/src/shared/components/ErrorBoundary.tsx`)

Wrap the router in a class-based `ErrorBoundary` that catches renderer crashes and shows a recovery screen instead of a blank white page.

```tsx
class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    logger.error({ error, info }, "Renderer crash");
  }
  render() {
    if (this.state.hasError)
      return <ErrorScreen onReload={() => window.location.reload()} />;
    return this.props.children;
  }
}
```

---

## Priority 2 — Performance (Quick Wins)

### 2.1 SQLite `synchronous = NORMAL` pragma

**File:** `electron-app/main.ts`

Add one line after `journal_mode = WAL`:

```ts
db.pragma("synchronous = NORMAL");
```

This is a one-liner with significant write performance improvement. Zero risk.

### 2.2 Vite build configuration

**File:** `frontend/vite.config.ts`

Add production optimizations:

```ts
build: {
  chunkSizeWarningLimit: 1200,
  minify: 'esbuild',
  sourcemap: false,
  rollupOptions: {
    output: {
      manualChunks: {
        vendor: ['react', 'react-dom'],
        ui: ['lucide-react'],
      },
    },
  },
},
```

### 2.3 `React.memo` on core shared components

**Scope:** Selective — only high-render components

- `frontend/src/shared/components/DataTable.tsx` — wrap with `React.memo`
- `frontend/src/features/sales/pages/POS/components/ProductSearch.tsx` — wrap heavy list renders in `useCallback`
- `frontend/src/features/sales/pages/POS/components/CheckoutModal.tsx` — wrap item list renders

---

## Priority 3 — Security (Medium Effort)

### 3.1 Enable `sandbox: true` on the BrowserWindow

**File:** `electron-app/main.ts`

Change:

```ts
sandbox: false,
```

→

```ts
sandbox: true,
```

**Testing required:** After enabling, verify that:

- Login works
- DB reads/writes work
- Printing works
- WhatsApp handler works

If any feature breaks, disable only for that window and investigate why.

### 3.2 Zod input validation on write IPC handlers

**New file:** `electron-app/schemas/` (one file per domain)

Add Zod schemas for all IPC handlers that write to the DB. Start with highest-risk domains:

- `salesHandlers.ts` — `sales:create`, `sales:refund`
- `inventoryHandlers.ts` — `inventory:create-product`, `inventory:update-product`
- `authHandlers.ts` — `users:create`, `users:set-password`
- `expenseHandlers.ts` — `db:add-expense`

Pattern:

```ts
import { z } from "zod";

const CreateSaleSchema = z.object({
  client_id: z.number().int().optional(),
  items: z.array(
    z.object({ product_id: z.number(), quantity: z.number().positive() }),
  ),
  paid_usd: z.number().nonnegative(),
  paid_lbp: z.number().nonnegative(),
});

ipcMain.handle("sales:create", (_event, payload) => {
  const data = CreateSaleSchema.parse(payload); // throws ZodError with details if invalid
  return salesService.create(data);
});
```

### 3.3 Native module rebuild configuration

**File:** `package.json`

Add:

```json
"scripts": {
  "postinstall": "electron-rebuild -f -w better-sqlite3"
}
```

Also ensure `electron-rebuild` is in `devDependencies`. This prevents the `better-sqlite3` native module crash on fresh Windows installs.

---

## Priority 4 — Code Splitting (Low Risk, Medium Effort)

### 4.1 `React.lazy` for heavy routes

**File:** `frontend/src/App.tsx` (or wherever the router is defined)

Identify and lazy-load all page-level components that are not shown on first render:

- Reports page
- Debts page
- Recharge page
- Exchange page
- Settings page

```tsx
const Reports = React.lazy(() => import("./features/reports/pages/Reports"));

<Suspense
  fallback={
    <div className="flex items-center justify-center h-full">
      <Spinner />
    </div>
  }
>
  <Reports />
</Suspense>;
```

---

## Skipped / Deferred

| Item                                  | Reason                                      |
| ------------------------------------- | ------------------------------------------- |
| Code signing                          | Deferred to a future release                |
| CSP `connect-src` tightening          | WhatsApp API requires broad origin access   |
| `yarn audit` CI                       | No CI pipeline currently configured         |
| Standardize all handler error returns | Low priority — read handlers are fine as-is |

---

## Suggested Order of Work

1. `uncaughtException` handlers → React `ErrorBoundary` _(Priority 1, ~1 hour)_
2. SQLite pragma + Vite build config _(Priority 2, ~15 minutes)_
3. `sandbox: true` + test _(Priority 3, ~30 mins + testing)_
4. Zod schemas on write handlers _(Priority 3, ~2–3 hours across all handlers)_
5. `React.memo` on DataTable + POS _(Priority 2, ~1 hour)_
6. `React.lazy` on routes _(Priority 4, ~1 hour)_
