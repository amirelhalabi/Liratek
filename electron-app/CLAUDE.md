# electron-app — Claude Code Context

Loads automatically when working under `electron-app/`. Root context is `../CLAUDE.md`.

### IPC Handler Pattern

```typescript
import { ipcMain } from "electron";
import { getMyService } from "@liratek/core";
import { myLogger } from "@liratek/core";
import { requireRole } from "../session.js";

let service: ReturnType<typeof getMyService> | null = null;

function getServiceInstance() {
  if (!service) service = getMyService();
  return service;
}

export function registerMyHandlers(): void {
  myLogger.info("Registering My IPC handlers");

  ipcMain.handle("my:create", async (e, data) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error);

      const result = getServiceInstance().createEntity(data);
      return { success: true, result };
    } catch (error) {
      myLogger.error({ error }, "my:create failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create",
      };
    }
  });

  myLogger.info("My IPC handlers registered");
}
```

### Preload Bindings (`electron-app/preload.ts`)

```typescript
myModule: {
  create: (data: CreateData) => ipcRenderer.invoke("my:create", data),
  getById: (id: number) => ipcRenderer.invoke("my:getById", id),
  update: (id: number, data: UpdateData) => ipcRenderer.invoke("my:update", id, data),
  delete: (id: number) => ipcRenderer.invoke("my:delete", id),
},
```

### Register in Main (`electron-app/main.ts`)

```typescript
const myHandlers = await import("./handlers/myHandlers.js");
myHandlers.registerMyHandlers();
```

### IPC Input Validation (Zod)

**All write-path handlers MUST validate input with Zod before touching the database.**

Schemas live in `electron-app/schemas/index.ts`. Use the `validatePayload` helper:

```typescript
import { validatePayload, MySchema } from "../schemas/index.js";

ipcMain.handle("my:create", async (e, data) => {
  try {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };

    // ← Validate BEFORE any DB call
    const validation = validatePayload(MySchema, data);
    if (!validation.ok) return { success: false, error: validation.error };

    const result = getServiceInstance().createEntity(validation.data);
    return { success: true, result };
  } catch (error) {
    myLogger.error({ error }, "my:create failed");
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed",
    };
  }
});
```

When adding a new schema:

```typescript
// electron-app/schemas/index.ts
export const MySchema = z.object({
  name: z.string().min(1, "Name is required"),
  amount: z.number().nonnegative(),
  status: z.enum(["active", "inactive"]).optional().default("active"),
});
```

**Rules:**

- Read-only handlers (GET) — validation optional but recommended
- Write handlers (CREATE/UPDATE/DELETE) — validation **required**
- Always export new schemas from `schemas/index.ts`
- Use `.safeParse()` via `validatePayload()`, never `.parse()` (throws)

### Handler Checklist

- [ ] Create `electron-app/handlers/{module}Handlers.ts`
- [ ] Wrap every handler in try-catch
- [ ] Call `requireRole()` for protected operations
- [ ] Validate input with `validatePayload()` + Zod schema on write paths
- [ ] Return `{ success, data?, error? }` always
- [ ] Add preload bindings in `preload.ts` — include ALL fields the frontend sends in the parameter type
- [ ] Register handler function in `main.ts`
- [ ] Add TypeScript types in `frontend/src/types/electron.d.ts`
- [ ] If the form has a client name/phone field: pass `clientId` + `clientName` through IPC → service → `createTransaction({ client_id })`
- [ ] **Mirror it for the web (rule 19):** add a REST route in `backend/src/api/` feeding the same core service, a dual-mode `backendApi.ts` fn on `useApi()`, and consume via `useApi()` in the frontend — never a raw `window.api.*` call. See **Dual-Transport Architecture**.
