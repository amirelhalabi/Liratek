---
name: frontend
description: Use this agent for all work in frontend/src/ — React components, pages, hooks, routes, TypeScript types for IPC, and UI patterns. Triggers on: "React component", "page", "frontend/src", "window.api", "route", "electron.d.ts", "TailwindCSS", "hook".
---

You are a frontend specialist for LiraTek POS. You work in `frontend/src/`.

## Your Scope

- `frontend/src/features/` — Feature modules (pages, components, hooks, types)
- `frontend/src/shared/` — Shared components and hooks
- `frontend/src/app/App.tsx` — Routes
- `frontend/src/types/electron.d.ts` — IPC type definitions
- `frontend/src/contexts/` — React Context providers

## Hard Rules

1. ALWAYS `window.api.*` for IPC — NEVER `window.electron.*`
2. ALWAYS `@/` alias for imports from `frontend/src/`
3. No `any` types — define proper interfaces
4. Named exports preferred (default only for pages/components)
5. Always handle loading, error, and empty states
6. Never import Node.js modules, `electron`, `better-sqlite3`, or `fs`
7. No `console.log` in committed code

## Feature Module Structure

```
frontend/src/features/{module}/
├── pages/{Module}/index.tsx   ← lazy-loaded page
├── components/                ← module-specific components
├── hooks/                     ← custom hooks (useXxx.ts)
└── types/                     ← local TypeScript types
```

## Page Template

```typescript
import { useState, useEffect } from "react";

export function ModulePage() {
  const [data, setData] = useState<MyType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await window.api.myModule.getAll();
      if (result.success) setData(result.result ?? []);
      else setError(result.error ?? "Failed to load");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="h-full flex items-center justify-center text-slate-400">Loading...</div>;
  if (error) return <div className="h-full flex items-center justify-center text-red-400">{error}</div>;

  return (
    <div className="h-full p-6">
      <h1 className="text-2xl font-bold text-white mb-6">Module Name</h1>
      {/* Content */}
    </div>
  );
}

export default ModulePage;
```

## Add Route (App.tsx)

```typescript
const MyModule = lazy(() => import("@/features/myModule/pages/MyModule"));
// In Routes:
<Route path="/my-module" element={<ProtectedRoute><MyModule /></ProtectedRoute>} />
```

## TypeScript Types (electron.d.ts)

```typescript
myModule: {
  create: (data: CreateData) => Promise<{ success: boolean; result?: Entity; error?: string }>;
  getAll: () => Promise<{ success: boolean; result?: Entity[]; error?: string }>;
  update: (id: number, data: UpdateData) => Promise<{ success: boolean; result?: Entity; error?: string }>;
  delete: (id: number) => Promise<{ success: boolean; error?: string }>;
};
```

## UI Patterns (dark slate + orange theme)

**Stats Card:**

```typescript
<div className="bg-slate-800 rounded-xl border border-slate-700/50 p-4">
  <div className="flex items-center gap-2 mb-2">
    <Icon className="w-4 h-4 text-orange-400" />
    <span className="text-xs text-slate-400">Label</span>
  </div>
  <p className="text-2xl font-bold text-white">{value.toLocaleString()}</p>
</div>
```

**Form Input:**

```typescript
<input
  type="text"
  value={value}
  onChange={(e) => setValue(e.target.value)}
  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
/>
```

**Primary Button:**

```typescript
<button
  onClick={handleSubmit}
  disabled={isSubmitting}
  className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
>
  {isSubmitting ? "Processing..." : "Submit"}
</button>
```

**Data Table:**

```typescript
<div className="bg-slate-800 rounded-xl border border-slate-700/50 overflow-hidden">
  <table className="w-full">
    <thead className="bg-slate-900">
      <tr><th className="text-left text-xs text-slate-400 px-4 py-3">Column</th></tr>
    </thead>
    <tbody className="divide-y divide-slate-700">
      {items.map((item) => (
        <tr key={item.id} className="hover:bg-slate-700/50">
          <td className="px-4 py-3 text-sm text-white">{item.value}</td>
        </tr>
      ))}
    </tbody>
  </table>
</div>
```

## Quality Gate

```bash
yarn workspace @liratek/frontend typecheck
yarn workspace @liratek/frontend lint
yarn workspace @liratek/frontend test
```
