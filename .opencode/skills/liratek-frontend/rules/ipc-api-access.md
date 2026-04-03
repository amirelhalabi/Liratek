---
title: IPC API Access Pattern
impact: CRITICAL
impactDescription: All IPC calls must use window.api.* (NOT window.electron.*) for proper type safety and IPC routing
tags:
  - ipc
  - api
  - typescript
  - critical
---

# IPC API Access Pattern

All IPC calls from frontend MUST use `window.api.*` (NEVER `window.electron.*`).

## Correct Usage

✅ **DO:**

```typescript
// Create operation
const result = await window.api.myModule.create(data);
if (result.success) {
  // Handle success
  console.log("Created:", result.result);
} else {
  // Handle error
  alert(result.error);
}

// Get operation
const getResult = await window.api.myModule.get(id);
if (getResult.success) {
  setData(getResult.result);
}

// Update operation
const updateResult = await window.api.myModule.update(id, data);
if (updateResult.success) {
  // Handle success
}

// Delete operation
const deleteResult = await window.api.myModule.delete(id);
if (deleteResult.success) {
  // Handle success
}

// Report operation
const reportResult = await window.api.myModule.report(from, to);
if (reportResult.success) {
  setReportData(reportResult.reportData);
}
```

## Incorrect Usage

❌ **DON'T:**

```typescript
// NEVER use window.electron.*
const result = await window.electron.myModule.create(data);

// NEVER access ipcRenderer directly
const { ipcRenderer } = require("electron");
const result = await ipcRenderer.invoke("my:create", data);
```

## Response Format

All IPC calls return standardized format:

```typescript
// Success response
{
  success: true,
  result?: any,    // or data, ticket, sale, etc.
  error?: never
}

// Error response
{
  success: false,
  result?: never,
  error: string
}
```

## Type-Safe Usage

Define types in `frontend/src/types/electron.d.ts`:

```typescript
export interface ElectronAPI {
  myModule: {
    create: (data: CreateData) => Promise<{
      success: boolean;
      result?: MyEntity;
      error?: string;
    }>;
    get: (id: number) => Promise<{
      success: boolean;
      result?: MyEntity;
      error?: string;
    }>;
    update: (
      id: number,
      data: UpdateData,
    ) => Promise<{
      success: boolean;
      result?: MyEntity;
      error?: string;
    }>;
    delete: (id: number) => Promise<{
      success: boolean;
      error?: string;
    }>;
  };
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
```

Use types in components:

```typescript
import { CreateData, MyEntity } from "@/types/electron";

async function handleCreate() {
  const data: CreateData = {
    name: "Test",
    amount: 1000,
  };

  const result = await window.api.myModule.create(data);

  if (result.success && result.result) {
    const entity: MyEntity = result.result;
    console.log("Created:", entity.id);
  } else if (result.error) {
    alert(result.error);
  }
}
```

## Error Handling

```typescript
// Basic error handling
async function handleCreate() {
  const result = await window.api.myModule.create(data);

  if (!result.success) {
    alert(result.error);
    return;
  }

  // Handle success
}

// Try-catch error handling
async function handleCreate() {
  try {
    const result = await window.api.myModule.create(data);

    if (!result.success) {
      throw new Error(result.error);
    }

    // Handle success
  } catch (error) {
    console.error("Failed to create:", error);
    alert("An error occurred");
  }
}

// With loading state
async function handleCreate() {
  setLoading(true);
  try {
    const result = await window.api.myModule.create(data);

    if (!result.success) {
      setError(result.error);
      return;
    }

    // Handle success
  } catch (error) {
    setError(error instanceof Error ? error.message : "Failed");
  } finally {
    setLoading(false);
  }
}
```

## Component Example

```typescript
import { useState } from "react";

export function MyModuleForm() {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const result = await window.api.myModule.create({
        name,
        amount: parseFloat(amount),
      });

      if (!result.success) {
        setError(result.error);
        return;
      }

      // Success - reset form, show message, etc.
      setName("");
      setAmount("");
      alert("Created successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div className="bg-red-500 text-white p-2 rounded mb-4">
          {error}
        </div>
      )}

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        disabled={loading}
      />

      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="Amount"
        disabled={loading}
      />

      <button
        type="submit"
        disabled={loading || !name || !amount}
        className="bg-orange-500 text-white px-4 py-2 rounded"
      >
        {loading ? "Creating..." : "Create"}
      </button>
    </form>
  );
}
```

## Testing from Console

Test IPC calls from browser console:

```javascript
// Test create
const result = await window.api.myModule.create({
  name: "Test",
  amount: 1000,
});
console.log("Create result:", result);

// Test get
const getResult = await window.api.myModule.get(1);
console.log("Get result:", getResult);

// Test update
const updateResult = await window.api.myModule.update(1, {
  name: "Updated",
});
console.log("Update result:", updateResult);

// Test delete
const deleteResult = await window.api.myModule.delete(1);
console.log("Delete result:", deleteResult);
```

## Why window.api.\*?

✅ **Benefits:**

1. **Type Safety**: TypeScript definitions in `electron.d.ts`
2. **Abstraction**: Decoupled from Electron implementation
3. **Testing**: Easier to mock in tests
4. **Consistency**: Standard pattern across app
5. **Security**: Preload script controls access

❌ **Without window.api.\*:**

- No type safety
- Tightly coupled to Electron
- Harder to test
- Inconsistent patterns
- Security risks

## Reference

- TypeScript types: `frontend/src/types/electron.d.ts`
- Preload bindings: `electron-app/preload.ts`
- IPC handlers: `electron-app/handlers/`
