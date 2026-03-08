# Electron + Vite + React — Best Practices for Windows Desktop Apps

A comprehensive reference for building reliable, secure, and performant Windows desktop applications using the Electron + Vite + React stack.

---

## 1. Architecture & Process Model

Electron runs two distinct processes. Understanding their separation is the most critical foundation.

| Process      | Environment          | Responsibilities                                              |
| ------------ | -------------------- | ------------------------------------------------------------- |
| **Main**     | Node.js              | Window management, native APIs, OS integration, IPC handlers  |
| **Renderer** | Chromium (sandboxed) | All React UI, user interactions                               |
| **Preload**  | Isolated bridge      | Exposes whitelisted Main APIs to Renderer via `contextBridge` |

**Rules:**

- The Renderer **must never** have direct Node.js or Electron access
- All native operations (file system, DB, printing, updates) belong in the **Main** process
- The **Preload** script is the only safe conduit between the two

---

## 2. Security (Non-Negotiable)

### Always-on Defaults

```ts
// main.ts — BrowserWindow creation
new BrowserWindow({
  webPreferences: {
    contextIsolation: true, // MUST be true — isolates preload from renderer
    nodeIntegration: false, // MUST be false — renderer cannot access Node
    sandbox: true, // Recommended — Chromium OS-level sandboxing
    preload: path.join(__dirname, "preload.js"),
  },
});
```

> **Never** set `contextIsolation: false` or `nodeIntegration: true`. This opens the door to full RCE (Remote Code Execution) via any XSS.

### contextBridge Pattern (Preload)

```ts
// preload.ts
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  sales: {
    getTodaysSales: (date?: string) =>
      ipcRenderer.invoke("sales:get-todays-sales", date),
  },
  print: {
    getPrinters: () => ipcRenderer.invoke("print:get-printers"),
    silentPrint: (html: string, printer: string, opts?: any) =>
      ipcRenderer.invoke("print:silent", html, printer, opts),
  },
});
```

Only expose exactly what the UI needs — nothing more.

### Input Validation in IPC Handlers

```ts
// handlers/salesHandlers.ts
ipcMain.handle("sales:get-todays-sales", async (_event, date?: string) => {
  // Validate before touching DB
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid date format");
  }
  return salesRepository.getByDate(
    date ?? new Date().toISOString().split("T")[0],
  );
});
```

### Content Security Policy

Add a strict CSP via the `Content-Security-Policy` meta tag in your `index.html`:

```html
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';"
/>
```

### Dependency Hygiene

- Run `yarn audit` regularly and fix critical/high vulnerabilities
- Keep Electron itself updated — CVEs are patched in minor versions (e.g., 32.3.0+)
- Pin exact dependency versions in `package.json` for reproducible builds
- Keep `yarn.lock` committed to version control

---

## 3. IPC Communication Patterns

### ✅ Preferred: invoke/handle (request-response)

```ts
// Renderer (via window.api exposed in preload)
const result = await window.api.sales.createSale(payload);

// Main
ipcMain.handle("sales:create", async (_event, payload) => {
  return salesRepository.create(payload);
});
```

### One-way events: Main → Renderer

```ts
// Main sends to a specific window
mainWindow.webContents.send("app:update-available", { version: "1.2.0" });

// Renderer listens (via preload exposure)
ipcRenderer.on("app:update-available", (_event, data) => {
  /* ... */
});
```

### Naming Convention

Use namespaced channel names: `domain:action`

```
sales:get-todays-sales
sales:create
print:silent
print:get-printers
settings:get-all
settings:save
```

---

## 4. Performance

### Startup Performance

- **Lazy-load heavy modules** — don't `require('better-sqlite3')` at module top-level if not immediately needed
- **Defer non-critical IPC handlers** — register them after the window is ready
- **Preload only what's needed** — the preload script runs synchronously before the page loads

### React Rendering

```tsx
// Memoize expensive components
const SalesTable = React.memo(({ sales }) => {
  /* ... */
});

// Avoid recreating callbacks on every render
const handleSearch = useCallback(
  (term: string) => {
    loadProducts(term);
  },
  [loadProducts],
);

// Memoize expensive computations
const totalRevenue = useMemo(
  () => sales.reduce((acc, s) => acc + s.final_amount_usd, 0),
  [sales],
);
```

### Code Splitting

```tsx
// Lazy-load heavy routes
const Reports = React.lazy(() => import("./features/reports/pages/Reports"));
const Inventory = React.lazy(
  () => import("./features/inventory/pages/Inventory"),
);
```

### Vite Build Optimizations

```ts
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          ui: ["lucide-react"],
        },
      },
    },
    minify: "esbuild",
    sourcemap: false, // disable in production
  },
});
```

### Database (SQLite)

- Use **WAL mode** for better concurrent read performance:
  ```ts
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  ```
- Always use **prepared statements** — never string-interpolate SQL
- Run heavy queries in a background Worker Thread to avoid blocking the main process UI

---

## 5. Windows-Specific Considerations

### Native Module Rebuilding

Native modules (like `better-sqlite3`) must be compiled for the correct Electron ABI:

```json
// package.json
"scripts": {
  "postinstall": "electron-rebuild -f -w better-sqlite3"
}
```

Use `electron-rebuild` or configure it in `electron-builder`.

### Code Signing (Required for Windows Distribution)

Unsigned apps trigger SmartScreen warnings or are blocked outright on Windows 11.

```yaml
# electron-builder.yml
win:
  target: nsis
  signingHashAlgorithms: ["sha256"]
  certificateFile: cert.pfx
  certificatePassword: ${env.CERT_PASSWORD}
```

Sign all executables: `.exe`, `.dll`, installer.

### NSIS Installer Best Practices

```yaml
nsis:
  oneClick: false # Let user choose install location
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  runAfterFinish: true
  installerIcon: build/icon.ico
  uninstallerIcon: build/icon.ico
```

### File Paths on Windows

Always use `path.join()` or `app.getPath()` — never hardcode path separators:

```ts
import { app } from "electron";
import path from "path";

const dbPath = path.join(app.getPath("userData"), "liratek.db");
const logPath = path.join(app.getPath("logs"), "app.log");
```

### Auto-Updater

```ts
import { autoUpdater } from "electron-updater";

autoUpdater.checkForUpdatesAndNotify();
autoUpdater.on("update-downloaded", () => {
  // Prompt user before restarting
  dialog
    .showMessageBox({ message: "Update ready. Restart?" })
    .then(() => autoUpdater.quitAndInstall());
});
```

---

## 6. Error Handling & Logging

### Structured Logging (Pino)

```ts
import pino from "pino";

const logger = pino({
  transport: {
    target: "pino/file",
    options: { destination: path.join(app.getPath("logs"), "app.log") },
  },
});

// Structured context — easy to search logs
logger.info({ saleId: 123, amount: 45.5 }, "Sale completed");
logger.error({ err, printerName }, "Silent print failed");
```

### Uncaught Error Handling

```ts
// main.ts
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception in main process');
});

// renderer — React Error Boundary
class ErrorBoundary extends React.Component {
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logger.error({ error, info }, 'Renderer crashed');
  }
  render() {
    return this.state.hasError ? <ErrorScreen /> : this.props.children;
  }
}
```

### IPC Error Propagation

```ts
// Always wrap handlers in try/catch and return structured errors
ipcMain.handle("sales:create", async (_event, payload) => {
  try {
    return { success: true, data: await salesRepo.create(payload) };
  } catch (err) {
    logger.error({ err }, "Failed to create sale");
    return { success: false, error: (err as Error).message };
  }
});
```

---

## 7. Development Workflow

### Dev Server Setup

The `electron-vite` package provides integrated HMR for both main and renderer:

```bash
yarn dev        # HMR for renderer + restart main on changes
yarn build      # Production build
yarn preview    # Test production bundle locally
```

### Environment Variables

```ts
// Use import.meta.env in Vite renderer
const API_URL = import.meta.env.VITE_API_URL;

// Use process.env in Electron main
const IS_DEV = process.env.NODE_ENV === "development";
```

Never expose secrets via `VITE_` prefixed env vars — they are bundled into the renderer.

### TypeScript Strictness

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

### ESLint Rules to Enforce

```json
{
  "rules": {
    "no-console": "warn", // Use logger instead
    "@typescript-eslint/no-explicit-any": "warn",
    "react-hooks/exhaustive-deps": "warn",
    "react-hooks/rules-of-hooks": "error"
  }
}
```

---

## 8. Quick Checklist

| Area        | Check                                                               |
| ----------- | ------------------------------------------------------------------- |
| Security    | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` |
| Security    | All IPC via `contextBridge` only                                    |
| Security    | Input validated in every IPC handler                                |
| Security    | CSP meta tag in `index.html`                                        |
| Security    | Code-signed installer for Windows distribution                      |
| Performance | React.memo / useCallback / useMemo on expensive components          |
| Performance | Code-split heavy routes with `React.lazy`                           |
| Performance | SQLite WAL mode enabled                                             |
| Performance | Production build with sourcemaps disabled                           |
| Windows     | `path.join` / `app.getPath()` for all file paths                    |
| Windows     | Native modules rebuilt for Electron ABI (`electron-rebuild`)        |
| Reliability | Structured logging with context (Pino)                              |
| Reliability | `uncaughtException` handler in main process                         |
| Reliability | React `ErrorBoundary` in renderer                                   |
| Reliability | IPC handlers always return `{ success, error }` pattern             |
| DX          | Strict TypeScript (`noImplicitAny`, `noUnusedLocals`)               |
| DX          | `yarn audit` in CI pipeline                                         |
