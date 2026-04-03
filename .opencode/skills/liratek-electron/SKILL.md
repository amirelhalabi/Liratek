---
name: liratek-electron
description: Electron skills for LiraTek POS - IPC handlers, preload bindings, session management, and main process
version: 1.0.0
license: MIT
metadata:
  author: LiraTek Engineering
  organization: LiraTek
  createdAt: "2026-03-20"
categories:
  - electron
  - ipc
  - main-process
  - preload
tags:
  - electron
  - ipc
  - handlers
  - preload
  - session
---

# LiraTek Electron Skills

Electron development skills for LiraTek POS system. Covers IPC handlers, preload bindings, session management, and main process.

## When to Use

Use these skills when:

- Creating IPC handlers
- Adding preload bindings
- Implementing session management
- Configuring main process
- Setting up auto-update

## Skill Structure

This skill contains modular rules organized by category:

- **ipc-** : IPC handler patterns
- **preload-** : Preload binding patterns
- **session-** : Session and authentication
- **main-** : Main process configuration

## Related Skills

- `liratek-backend` - Services called by IPC handlers
- `liratek-frontend` - Frontend calls IPC handlers
- `liratek-devops` - Build and release configuration

## Quick Start

```bash
# Test IPC from frontend console
const result = await window.api.module.action(data);
console.log(result);

# Check handler registration
yarn dev 2>&1 | grep -E "Registering|registered"
```

## Key Files

- `electron-app/main.ts` - Main process entry
- `electron-app/preload.ts` - IPC bindings
- `electron-app/handlers/` - IPC handlers
- `electron-app/session.ts` - Session management

## Core Patterns

### IPC Handler

```typescript
ipcMain.handle("my:create", async (e, data) => {
  try {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) throw new Error(auth.error);

    const service = getMyService();
    const result = service.createEntity(data);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

### Preload Binding

```typescript
myModule: {
  create: (data: CreateData) =>
    ipcRenderer.invoke("my:create", data),
},
```

## Rules

Load the following rules for detailed guidance:

- `ipc-handler-pattern` - IPC handler implementation
- `preload-bindings` - Preload script bindings
- `session-auth` - Session authentication
- `main-registration` - Handler registration in main.ts

## Reference

- IPC handlers: `electron-app/handlers/salesHandlers.ts`
- Preload: `electron-app/preload.ts`
- Main: `electron-app/main.ts`
