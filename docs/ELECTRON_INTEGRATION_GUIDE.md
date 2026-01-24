# Electron Backend Integration Guide

**Task**: [T-23] New Electron Backend Integration  
**Created**: Jan 24, 2026  
**Status**: Ready to implement  
**Estimated Time**: 3-4 hours

---

## 🎯 Goal

Integrate backend services into the new `electron-app/` structure, enabling a fully functional desktop app that uses the clean frontend/backend separation.

---

## 🗄️ Database Location (IMPORTANT)

### ✅ Goal
Have **one shared DB** used by both:
- Desktop (Electron)
- Web mode (backend + frontend)

### ✅ Reality
Electron will always create folders in:
- `~/Library/Application Support/...`

Those folders contain caches/session/runtime files and are normal.

### ✅ Current Decision (T-24 Option 2)
We are **not moving DB files yet**.
Instead, we use a single authoritative DB by setting `DATABASE_PATH` for both Electron and backend.

**Authoritative DB (contains mock data)**:
- `~/Library/Application Support/liratek/phone_shop.db`
  - Verified counts: `users=1`, `clients=4`, `sales=10`

### How to run using the shared DB

#### Recommended (no CLI env vars): repo-local Electron .env + user-local DB config

**Electron renderer URL** (repo-local, gitignored):
- Copy `electron-app/.env.example` → `electron-app/.env`
- Set:
  - `ELECTRON_RENDERER_URL=http://localhost:5173`

**DB path** (user-local):
- Use `~/Documents/LiraTek/db-path.txt` for the DB path


Create:
- `~/Documents/LiraTek/db-path.txt`

**Setup commands (copy/paste):**
```bash
mkdir -p "$HOME/Documents/LiraTek"
echo "$HOME/Library/Application Support/liratek/phone_shop.db" > "$HOME/Documents/LiraTek/db-path.txt"
cat "$HOME/Documents/LiraTek/db-path.txt"
```

Put the absolute DB path inside (one line), e.g.:
- `/Users/amir/Library/Application Support/liratek/phone_shop.db`

Then run:
```bash
npm run dev
npm run dev:web
```

**Important**: keep `backend/.env` for backend config (PORT/JWT/etc.), but **do not set `DATABASE_PATH` there** unless you intentionally want to override `db-path.txt`.

#### Override (advanced): DATABASE_PATH
**Desktop:**
```bash
DATABASE_PATH="$HOME/Library/Application Support/liratek/phone_shop.db" npm run dev
```

**Web:** set `backend/.env`:
```env
DATABASE_PATH=/Users/amir/Library/Application Support/liratek/phone_shop.db
```
Then:
```bash
npm run dev:web
```

### DB files you may see (what they mean)
1. `~/Library/Application Support/liratek/phone_shop.db` ✅ KEEP / authoritative (has data)
2. `~/Library/Application Support/@liratek/electron-app/phone_shop.db` ❌ delete (empty)
3. `~/Library/Application Support/@liratek/electron-app/liratek.db` ⚠️ optional backup (schema but no data)

### Resolution order (important)
Both Desktop and Web resolve DB path in this order:
1. `DATABASE_PATH` env var (highest priority)
2. `~/Documents/LiraTek/db-path.txt` (recommended user-local config)
3. Default fallback (macOS): `~/Library/Application Support/liratek/phone_shop.db`

### Override
Both modes support:
- `DATABASE_PATH=/absolute/path/to/dbfile.db`

### Future improvement
Later we can move the DB to a clearer location like:
- `~/Documents/LiraTek/liratek.db`

…but Option 2 is safest right now.



---

## 📋 Prerequisites

✅ Completed (from previous session):
- T-20 Phase 1: All backend APIs created
- T-20 Phase 2: Structure cleanup prepared
- electron-app/ folder structure created
- Basic main.ts and preload.ts files exist

---

## 🗺️ Implementation Roadmap

### Phase 1: Database & Core Services (1 hour)

**Step 1.1: Setup Database Connection**
```typescript
// File: electron-app/main.ts

import Database from 'better-sqlite3';
import * as path from 'path';
import { app } from 'electron';

let db: Database.Database;

function initializeDatabase() {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'liratek.db');
  
  console.log('[ELECTRON] Database path:', dbPath);
  db = new Database(dbPath);
  
  // Run migrations if needed
  // const fs = require('fs');
  // const schemaPath = path.join(__dirname, '../../backend/src/database/schema.sql');
  // const schema = fs.readFileSync(schemaPath, 'utf8');
  // db.exec(schema);
  
  return db;
}
```

**Step 1.2: Import Backend Repositories**
```typescript
// File: electron-app/main.ts

// Import repositories (update paths after TypeScript setup)
// Note: May need to adjust module resolution
import { AuthService } from '../backend/src/services/AuthService';
import { ClientService } from '../backend/src/services/ClientService';
import { SalesService } from '../backend/src/services/SalesService';
// ... import all 19 service modules
```

**Step 1.3: Initialize Services**
```typescript
// File: electron-app/main.ts

let authService: AuthService;
let clientService: ClientService;
// ... declare all services

function initializeBackend() {
  console.log('[ELECTRON] Initializing backend services...');
  
  db = initializeDatabase();
  
  // Initialize services with database
  authService = new AuthService(db);
  clientService = new ClientService(db);
  // ... initialize all services
  
  console.log('[ELECTRON] Backend services initialized');
}
```

---

### Phase 2: IPC Handlers (2-3 hours)

**Step 2.1: Create Handler Registration Pattern**
```typescript
// File: electron-app/handlers/authHandlers.ts

import { ipcMain } from 'electron';
import { AuthService } from '../../backend/src/services/AuthService';

export function registerAuthHandlers(authService: AuthService) {
  // Login
  ipcMain.handle('auth:login', async (_, { username, password }) => {
    return authService.login(username, password);
  });
  
  // Logout
  ipcMain.handle('auth:logout', async (_, { userId }) => {
    return authService.logout(userId);
  });
  
  // Restore session
  ipcMain.handle('auth:restore-session', async () => {
    return authService.restoreSession();
  });
  
  console.log('[HANDLERS] Auth handlers registered');
}
```

**Step 2.2: Register All Handler Modules**

Create handler files for each module:
```
electron-app/handlers/
├── authHandlers.ts       (login, logout, session)
├── clientHandlers.ts     (list, create, update, delete)
├── salesHandlers.ts      (create, list, drafts)
├── inventoryHandlers.ts  (products, stock)
├── debtHandlers.ts       (list, repayments)
├── exchangeHandlers.ts   (convert, history)
├── expensesHandlers.ts   (list, create)
├── settingsHandlers.ts   (get, set, list)
├── rechargeHandlers.ts   (process, stock)
├── servicesHandlers.ts   (OMT, Whish)
├── maintenanceHandlers.ts (jobs, status)
├── currenciesHandlers.ts (list)
├── closingHandlers.ts    (opening, closing, stats)
├── suppliersHandlers.ts  (list, ledger)
├── ratesHandlers.ts      (list, set)
├── usersHandlers.ts      (list, create, update)
├── activityHandlers.ts   (recent logs)
└── reportHandlers.ts     (PDF, backup)
```

**Step 2.3: Import and Register in Main**
```typescript
// File: electron-app/main.ts

import { registerAuthHandlers } from './handlers/authHandlers';
import { registerClientHandlers } from './handlers/clientHandlers';
// ... import all handlers

function registerHandlers() {
  console.log('[ELECTRON] Registering IPC handlers...');
  
  registerAuthHandlers(authService);
  registerClientHandlers(clientService);
  registerSalesHandlers(salesService);
  // ... register all handlers
  
  console.log('[ELECTRON] All IPC handlers registered');
}
```

---

### Phase 3: Update Preload Bridge (30 minutes)

**Step 3.1: Complete window.api Methods**
```typescript
// File: electron-app/preload.ts

contextBridge.exposeInMainWorld('api', {
  // Auth
  login: (username: string, password: string) => 
    ipcRenderer.invoke('auth:login', { username, password }),
  logout: (userId: number) => 
    ipcRenderer.invoke('auth:logout', { userId }),
  restoreSession: () => 
    ipcRenderer.invoke('auth:restore-session'),
  
  // Clients
  clients: {
    list: (search?: string) => 
      ipcRenderer.invoke('clients:list', { search }),
    create: (data: any) => 
      ipcRenderer.invoke('clients:create', data),
    update: (id: number, data: any) => 
      ipcRenderer.invoke('clients:update', { id, ...data }),
    delete: (id: number) => 
      ipcRenderer.invoke('clients:delete', { id }),
  },
  
  // Sales
  sales: {
    create: (data: any) => 
      ipcRenderer.invoke('sales:create', data),
    list: (limit?: number) => 
      ipcRenderer.invoke('sales:list', { limit }),
    // ... all sales methods
  },
  
  // ... Complete all 19 modules
});
```

**Step 3.2: Ensure Type Safety**
```typescript
// File: frontend/src/types/electron.d.ts
// Ensure this matches the preload.ts API exactly
```

---

### Phase 4: Module Resolution & Build (30 minutes)

**Step 4.1: Fix TypeScript Module Resolution**

Option A: Use relative paths
```typescript
import { AuthService } from '../backend/src/services/AuthService.js';
```

Option B: Configure path aliases in tsconfig.json
```json
{
  "compilerOptions": {
    "paths": {
      "@backend/*": ["../backend/src/*"]
    }
  }
}
```

**Step 4.2: Handle CommonJS/ESM Issues**

Backend uses ESM, Electron needs CommonJS compatibility:
```typescript
// May need to use dynamic imports
const { AuthService } = await import('../backend/src/services/AuthService.js');
```

**Step 4.3: Update Build Script**
```json
// electron-app/package.json
{
  "scripts": {
    "build": "tsc && node copy-backend.js",
    "dev": "tsc && electron ."
  }
}
```

---

### Phase 5: Testing (1 hour)

**Step 5.1: Compile and Fix Errors**
```bash
cd electron-app
npm run build
# Fix any TypeScript/import errors
```

**Step 5.2: Start Frontend Dev Server**
```bash
cd frontend
npm run dev
# Should run on http://localhost:5173
```

**Step 5.3: Start New Electron App**
```bash
# From root
npm run dev:electron
# Or
cd electron-app
ELECTRON_RENDERER_URL=http://localhost:5173 npm start
```

**Step 5.4: Test Core Features**

Test checklist:
- [ ] Login works
- [ ] Dashboard loads
- [ ] Can view clients
- [ ] Can create sale
- [ ] POS works
- [ ] Debts list works
- [ ] Settings page works
- [ ] Closing workflow works
- [ ] All 19 modules functional

**Step 5.5: Fix Issues**
- Check console for errors
- Verify IPC handlers are registered
- Test database queries work
- Ensure all API methods exist

---

### Phase 6: Cleanup (30 minutes)

**Step 6.1: Delete Old Structure**

Once new Electron is verified working:
```bash
bash DELETE_THESE_FILES.sh
```

This deletes:
- electron/
- src/
- public/
- __mocks__/
- packages/
- Old config files

**Step 6.2: Update Root Package.json**
```json
{
  "scripts": {
    "dev": "npm run dev:electron",
    "dev:electron": "concurrently -k \"npm run dev:frontend\" \"wait-on tcp:5173 && npm run electron:start\"",
    "dev:web": "npm run dev:backend && npm run dev:frontend",
    "electron:start": "cd electron-app && npm start"
  }
}
```

**Step 6.3: Update Documentation**
- Update README.md with new structure
- Update CURRENT_SPRINT.md (mark T-23 complete)
- Delete CLEANUP_INSTRUCTIONS.md (no longer needed)

**Step 6.4: Final Git Commit**
```bash
git add -A
git commit -m "feat(T-23): Complete Electron backend integration

- Integrated all 19 backend service modules
- Registered all IPC handlers
- Completed window.api bridge
- Tested all features working
- Deleted old monolithic structure (electron/, src/)
- New structure: electron-app/ + frontend/ + backend/

Closes T-23"
```

---

## 🚨 Common Issues & Solutions

### Issue 1: Module Resolution Errors
**Problem**: `Cannot find module '../backend/...'`  
**Solution**: Use relative paths with `.js` extension or configure path aliases

### Issue 2: Better-SQLite3 Native Module
**Problem**: `Error: The module was compiled against a different Node.js version`  
**Solution**: 
```bash
cd electron-app
npm rebuild better-sqlite3 --runtime=electron --target=31.0.0
```

### Issue 3: Database Not Found
**Problem**: `SQLITE_CANTOPEN: unable to open database file`  
**Solution**: Check app.getPath('userData') and ensure directory exists

### Issue 4: IPC Handler Not Registered
**Problem**: `No handler registered for 'module:method'`  
**Solution**: Verify handler is imported and registered in registerHandlers()

### Issue 5: Frontend Can't Connect
**Problem**: `window.api is undefined`  
**Solution**: Check preload script is loaded, verify contextBridge.exposeInMainWorld

---

## 📊 Progress Tracking

Use this checklist during implementation:

**Phase 1: Database & Core Services**
- [ ] Database connection working
- [ ] All services imported
- [ ] Services initialized with database

**Phase 2: IPC Handlers**
- [ ] Auth handlers (3 methods)
- [ ] Client handlers (4 methods)
- [ ] Sales handlers (5 methods)
- [ ] Inventory handlers (5 methods)
- [ ] Debt handlers (3 methods)
- [ ] Exchange handlers (3 methods)
- [ ] Expenses handlers (3 methods)
- [ ] Settings handlers (3 methods)
- [ ] Recharge handlers (4 methods)
- [ ] Services handlers (4 methods)
- [ ] Maintenance handlers (5 methods)
- [ ] Currencies handlers (2 methods)
- [ ] Closing handlers (6 methods)
- [ ] Suppliers handlers (5 methods)
- [ ] Rates handlers (2 methods)
- [ ] Users handlers (5 methods)
- [ ] Activity handlers (1 method)
- [ ] Report handlers (4 methods)

**Phase 3: Preload Bridge**
- [ ] All methods exposed via window.api
- [ ] Type definitions match implementation

**Phase 4: Build & Module Resolution**
- [ ] TypeScript compiles without errors
- [ ] Module imports working
- [ ] Build script runs successfully

**Phase 5: Testing**
- [ ] App launches without errors
- [ ] Login works
- [ ] All 19 modules tested
- [ ] Database queries work
- [ ] No console errors

**Phase 6: Cleanup**
- [ ] Old structure deleted
- [ ] Package.json updated
- [ ] Documentation updated
- [ ] Git committed

---

## 🎯 Success Criteria

✅ New Electron app is fully functional  
✅ All 19 modules working  
✅ No references to old electron/ or src/  
✅ TypeScript compiles without errors  
✅ Tests pass  
✅ Documentation updated  
✅ Can run: `npm run dev:electron` successfully  
✅ Old structure deleted (~1.5 GB freed)  

---

## 📚 Reference

**Similar Implementation**: Old structure (`electron/`) for reference  
**Backend Services**: `backend/src/services/`  
**Handler Pattern**: Can copy from old `electron/handlers/` and adapt  
**Types**: `frontend/src/types/electron.d.ts`  

---

## 💡 Tips

1. **Start Small**: Get 1-2 modules working first (e.g., Auth + Settings)
2. **Copy & Adapt**: Use old handlers as templates
3. **Test Frequently**: Run Electron after each module
4. **Use Console Logs**: Add logging to track which handlers are called
5. **Type Safety**: Update electron.d.ts as you add methods
6. **Database First**: Ensure database connection works before handlers

---

## 🚀 After Completion

Once T-23 is complete:
- Clean, modern Electron app structure
- Easy to maintain and extend
- Ready for T-01 (Two-Wallet System)
- Ready for T-10 (Real-time Drawer Balances)
- Ready for future features

Good luck! 🎉
