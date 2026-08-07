# frontend/src — Claude Code Context

Loads automatically when working under `frontend/src/`. Root context is `../../CLAUDE.md`.

### Page Component Template

```typescript
import { useState, useEffect } from "react";

export function ModulePage() {
  const [data, setData] = useState<MyType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    const result = await window.api.myModule.get();
    if (result.success) {
      setData(result.data);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }

  return (
    <div className="h-full p-6">
      <h1 className="text-2xl font-bold text-white">Module Name</h1>
      {/* Content */}
    </div>
  );
}

export default ModulePage;
```

### Add Route (`frontend/src/app/App.tsx`)

```typescript
const MyModule = lazy(() => import("@/features/myModule/pages/MyModule"));

// In Routes:
<Route path="/my-module" element={<ProtectedRoute><MyModule /></ProtectedRoute>} />
```

### TypeScript Types (`frontend/src/types/electron.d.ts`)

```typescript
myModule: {
  create: (data: CreateData) => Promise<{ success: boolean; result?: Entity; error?: string }>;
  get: (id: number) => Promise<{ success: boolean; result?: Entity; error?: string }>;
  update: (id: number, data: UpdateData) => Promise<{ success: boolean; result?: Entity; error?: string }>;
  delete: (id: number) => Promise<{ success: boolean; error?: string }>;
};
```

### UI Component Patterns

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
<div>
  <label className="text-xs text-slate-400 block mb-1">Label *</label>
  <input
    type="text"
    value={value}
    onChange={(e) => setValue(e.target.value)}
    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
    placeholder="Enter value"
  />
</div>
```

**Submit Button:**

```typescript
<button
  onClick={handleSubmit}
  disabled={isSubmitting || !isValid}
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
      <tr>
        <th className="text-left text-xs text-slate-400 px-4 py-3">Column</th>
      </tr>
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

### Custom Hook Template (TanStack Query)

Use TanStack Query for all data fetching — it replaces manual `useState`/`useEffect`/`loading`/`error` boilerplate. The `unwrapIpc` helper (`frontend/src/shared/api/unwrapIpc.ts`) unwraps the standard `{ success, error? }` envelope.

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { unwrapIpc } from "@/shared/api/unwrapIpc";

// ── Query key constants (co-locate with the hooks that use them) ──────────────
export const MODULE_KEYS = {
  all: ["myModule"] as const,
  detail: (id: number) => ["myModule", id] as const,
};

// ── Read ──────────────────────────────────────────────────────────────────────
export function useModuleListQuery() {
  return useQuery({
    queryKey: MODULE_KEYS.all,
    queryFn: () =>
      unwrapIpc(window.api.myModule.getAll(), (r) => r.items ?? []),
  });
}

// ── Write ─────────────────────────────────────────────────────────────────────
export function useCreateModuleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateData) =>
      unwrapIpc(window.api.myModule.create(data), (r) => r.item),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MODULE_KEYS.all });
    },
  });
}
```

**Usage in a component:**

```typescript
const { data: items = [], isLoading, isError, refetch } = useModuleListQuery();
const create = useCreateModuleMutation();

// trigger: create.mutate(payload)
// loading: create.isPending
```

`QueryClientProvider` is already wired in `App.tsx` with IPC-appropriate defaults (`retry: false`, `refetchOnWindowFocus: false`, `staleTime: 30_000`). New features should follow this pattern; old pages can be migrated as they are touched.

### Frontend Commands

```bash
yarn workspace @liratek/frontend typecheck
yarn workspace @liratek/frontend lint
yarn workspace @liratek/frontend test
yarn workspace @liratek/frontend test:coverage
```
