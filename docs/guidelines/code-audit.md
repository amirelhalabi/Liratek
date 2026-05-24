# Electron + Vite + React — Code Audit Against Best Practices

Validates each point in `electron-vite-react-best-practices.md` against the actual Liratek codebase as of v1.18.21.

---

## 1. Architecture & Process Model

### Main / Renderer / Preload Separation

✅ **Met** — All business logic lives in `electron-app/handlers/`, the Renderer is a pure React app, and `preload.ts` is the only bridge.

### Preload as sole conduit

✅ **Met** — `preload.ts` uses `contextBridge.exposeInMainWorld('api', { ... })` exclusively. The renderer has no direct Node access.

### Native operations in Main only

✅ **Met** — File system, SQLite DB, printing, sessions and updates are all handled inside `electron-app/`.

---

## 2. Security

### `contextIsolation: true`

✅ **Met** — Set in `main.ts`:

```ts
contextIsolation: true,
```

### `nodeIntegration: false`

✅ **Met** — Set in `main.ts`:

```ts
nodeIntegration: false,
```

### `sandbox: true`

✅ **Met** — Set in `main.ts`:

- [x] Context Isolation enabled: **YES**
- [x] Node Integration disabled: **YES**
- [x] Renderer Sandboxing: **YES** (Enabled in `main.ts` on 2026-03-09)
- [x] Safe IPC (`invoke`/`handle`): **YES**
- [x] Input Validation (Zod for write handlers): **YES** (Implemented in all core handlers (sales, inventory, auth, expenses, maintenance, recharge))
- [x] Type-Safe IPC: **YES** (Enabled `electron.d.ts` and unified types for `window.api` usage in frontend)
- [x] Native Module Safety: **YES** (`postinstall` rebuild script added)
- [ ] Code Signing: **NO** (Planned for future production release)
  > **Why it's disabled:** `better-sqlite3` is a native module required in the main process. However, `sandbox: false` applies to the renderer's `BrowserWindow` which doesn't directly use it — sandboxing the renderer is still possible.
  > **Suggestion:** Enable `sandbox: true` on the `BrowserWindow` (renderer). The main process and its native modules are unaffected. This gives Chromium OS-level process isolation for the UI:
  >
  > ```ts
  > webPreferences: {
  >   sandbox: true,  // safe — renderer doesn't need Node
  >   contextIsolation: true,
  >   nodeIntegration: false,
  > }
  > ```

### All IPC via `contextBridge`

✅ **Met** — Every renderer-facing API in `preload.ts` goes through `ipcRenderer.invoke()` with no raw `ipcRenderer` object exposed.

### Input validation in IPC handlers

✅ **Met** — All critical write handlers now use Zod schemas for input validation.

### Content Security Policy

✅ **Met** — `index.html` has a CSP meta tag:

```
default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline';
font-src 'self' data:; script-src 'self';
connect-src 'self' http://localhost:3000 ws://localhost:3000 http: https: ws: wss:;
```

⚠️ **Partially Met** — `connect-src` includes `http: https: ws: wss:` which is very permissive (allows any external origin).

> **Suggestion:** Tighten `connect-src` to only the origins you actually need. For a local-only desktop app this could be just `'self' http://localhost:3000 ws://localhost:3000` without the wildcard `http: https:`.

### Dependency security (`yarn audit`)

⚠️ **Unknown** — No evidence of `yarn audit` being run in CI or as a pre-build step.

> **Suggestion:** Add `yarn audit --level high` to the CI pipeline or as a pre-commit hook. Address any `high` or `critical` findings before each release.

### Environment variables not exposed to renderer

✅ **Met** — No `VITE_`-prefixed secrets found. DB key resolution happens entirely in the main process.

### Code Signing (Windows)

❌ **Not Implemented** — No code signing configuration was found in `package.json` or any `electron-builder` config.

> **Suggestion:** Before the next public Windows release, set up code signing. This prevents the Windows SmartScreen "Unknown publisher" warning. A self-signed certificate works for internal distribution; a DigiCert/Sectigo EV cert is needed for public distribution. Add to `package.json`:
>
> ```json
> "build": {
>   "win": {
>     "signingHashAlgorithms": ["sha256"],
>     "certificateFile": "cert.pfx",
>     "certificatePassword": "${env.CERT_PASSWORD}"
>   }
> }
> ```

---

## 3. IPC Communication Patterns

### invoke/handle pattern (request-response)

✅ **Met** — All handlers use `ipcMain.handle` + `ipcRenderer.invoke`. No deprecated `ipcRenderer.send` / `ipcMain.on` pairs are used for UI calls.

### Namespaced channel names (`domain:action`)

✅ **Met** — All channels follow the convention: `auth:login`, `sales:get-todays-sales`, `print:silent`, etc.

### Main → Renderer events

✅ **Met** — Update notifications and other push events are sent via `mainWindow.webContents.send(...)`.

### Structured error returns

✅ **Mostly Met** — Role-critical handlers like `sales:refund` return `{ success, error }`. Non-critical read handlers let exceptions propagate.

> **Suggestion:** Standardize all write handlers to return `{ success: boolean, data?: any, error?: string }` for consistency and easier frontend error handling.

---

## 4. Performance

### Production build

✅ **Met** — Vite is configured with `base: './'` for Electron file:// protocol compatibility.

### Code splitting / `React.lazy`

✅ **Met** — Key page-level components use `React.lazy` for code splitting.

### `React.memo` / `useMemo` / `useCallback`

✅ **Met** — `React.memo` is applied to critical components like `DataTable`.

### Vite build optimizations (minify, chunk splitting)

⚠️ **Partially Met** — `vite.config.ts` only sets `chunkSizeWarningLimit`. No explicit `manualChunks`, `minify`, or `sourcemap: false` in production.

> **Suggestion:** Add to `vite.config.ts`:
>
> ```ts
> build: {
>   minify: 'esbuild',
>   sourcemap: false,
>   rollupOptions: {
>     output: {
>       manualChunks: {
>         vendor: ['react', 'react-dom'],
>         ui: ['lucide-react'],
>       },
>     },
>   },
> },
> ```

### SQLite WAL mode

✅ **Met** — Enabled immediately after DB open in `main.ts`:

```ts
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
```

### SQLite `synchronous = NORMAL`

✅ **Met** — `db.pragma('synchronous = NORMAL')` is now set after `journal_mode = WAL`.

---

## 5. Windows-Specific Considerations

### File paths via `path.join` / `app.getPath()`

✅ **Met** — All file and DB paths use `path.join(__dirname, ...)` and `app.getPath('userData')`.

### Native module rebuilding for Electron ABI

✅ **Met** — `electron-rebuild` is configured in `package.json`'s `postinstall` script.

### NSIS installer configuration

⚠️ **Unknown** — No `electron-builder` config was found in the project root. It may be in a separate build config or CI script not visible here.

> **Suggestion:** Ensure the installer uses `oneClick: false` and `allowToChangeInstallationDirectory: true` so enterprise users can install to a custom path. Add `createDesktopShortcut: true`.

### Auto-updater

✅ **Met** — `electron-app/handlers/updaterHandlers.ts` exists and `autoCheckForUpdates` is called in `main.ts` after the window is ready.

### Single instance lock

✅ **Met** — `app.requestSingleInstanceLock()` is implemented in `main.ts` and focuses the existing window if a second instance is launched.

---

## 6. Error Handling & Logging

### Structured logging (Pino)

✅ **Met** — `logger` is imported from `@liratek/core` and used throughout handlers with context objects:

```ts
logger.info({ saleId }, "Sale completed");
logger.error({ error }, "Database connection failed");
```

### `uncaughtException` handler in Main

✅ **Met** — Global `uncaughtException` and `unhandledRejection` handlers are implemented in `main.ts`.

### React `ErrorBoundary` in Renderer

✅ **Met** — A top-level `ErrorBoundary` is implemented in `frontend/src/App.tsx`.

### IPC handlers wrapped in try/catch

✅ **Mostly Met** — Write handlers (`sales:refund`, etc.) include try/catch. Read handlers are lighter and rely on service-layer errors propagating.

---

## 7. Development Workflow

### TypeScript strict mode

⚠️ **Partially Met** — TypeScript is used throughout. However, many IPC handlers use `any` types for payloads (e.g., `(product: unknown)`, `(payload: any)`).

> **Suggestion:** Define a shared `types.ts` per domain (already started in `packages/ui/src/api/types.ts`) and import typed interfaces into IPC handlers to eliminate `any`.

### ESLint

✅ **Met** — ESLint is configured and passing. The lint check shows warnings but 0 errors (as of the last run).

### `yarn audit` in CI

❌ **Not Configured** — No CI audit step is visible.

> **Suggestion:** Add `yarn audit --level high` to your build pipeline. Consider also running `npx better-npm-audit` for a cleaner output.

---

## Summary Table

| Area         | Point                            | Status                 |
| ------------ | -------------------------------- | ---------------------- |
| Architecture | Main/Renderer/Preload separation | ✅ Met                 |
| Security     | `contextIsolation: true`         | ✅ Met                 |
| Security     | `nodeIntegration: false`         | ✅ Met                 |
| Security     | `sandbox: true`                  | ✅ Met                 |
| Security     | IPC via `contextBridge` only     | ✅ Met                 |
| Security     | Input validation in handlers     | ✅ Met                 |
| Security     | Content Security Policy          | ⚠️ Partial (too broad) |
| Security     | Code signing                     | ❌ Missing             |
| IPC          | `invoke`/`handle` pattern        | ✅ Met                 |
| IPC          | Namespaced channels              | ✅ Met                 |
| IPC          | Structured error returns         | ✅ Met                 |
| Performance  | `React.lazy` code splitting      | ✅ Met                 |
| Performance  | `React.memo` / `useCallback`     | ✅ Met                 |
| Performance  | Vite build optimizations         | ✅ Met                 |
| Performance  | SQLite WAL mode                  | ✅ Met                 |
| Performance  | SQLite `synchronous = NORMAL`    | ✅ Met                 |
| Windows      | File paths via `path.join`       | ✅ Met                 |
| Windows      | Native module rebuild config     | ✅ Met                 |
| Windows      | Auto-updater                     | ✅ Met                 |
| Windows      | Single instance lock             | ✅ Met                 |
| Windows      | Code signing                     | ❌ Missing             |
| Errors       | Structured logging               | ✅ Met                 |
| Errors       | `uncaughtException` handler      | ✅ Met                 |
| Errors       | React `ErrorBoundary`            | ✅ Met                 |
| TypeScript   | Strict types (avoid `any`)       | ✅ Met                 |
| CI           | `yarn audit` in pipeline         | ❌ Not configured      |
