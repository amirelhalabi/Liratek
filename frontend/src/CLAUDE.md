# frontend/src — Claude Code Context

Loads automatically when working under `frontend/src/`. Root context is `../../CLAUDE.md`.

### Data access — `useApi()`, never `window.api` (root rules 19, 21, 22, 25)

Every page, component and hook reaches the backend through `useApi()` (from `@liratek/ui`). Its functions live in `frontend/src/api/backendApi.ts`, where `ipcOrHttp` picks IPC on desktop or REST on web — the ONLY place a transport may be branched on. So in feature code:

- No raw `window.api.*` call, no `if (window.api)` / `window.api ? … : …` gate. If you truly need a runtime check (e.g. hide a desktop-only button), call `isElectron()`.
- Build each payload ONCE, typed as the core schema's input type (`z.input<typeof xSchema>`, usually exported as `XInput`/`XRequest` from `@liratek/core`), and pass it to the adapter. Never one object literal per transport.
- Inside `useEffect`/`useCallback`, read `api` through a ref — never put `api` in a dependency array.

**CI enforces this.** `yarn check:transport-parity` (`scripts/check-transport-parity.mjs`, runs in CI) fails on (A1) a `window.api`/`isElectron()` branch whose both arms build object literals, and (C1) any `window.api` access in `frontend/src` (tests, `.d.ts` and the two adapter files excluded) that is not in `scripts/transport-parity-allowlist.json`. For a call that is genuinely desktop-only (setup wizard, native file dialogs, the voice bot), add an allowlist entry naming the file, the `window.api.<namespace>`s it touches (`(bare)` = a truthiness check) and a `reason`; mark `"temporary": true` only for a known web defect kept visible. Entries that stop matching are stale and fail the check, so remove the entry when you remove the call.

### Page Component Template

Based on `features/expenses/pages/Expenses/index.tsx` (useApi) and `contexts/FeatureFlagContext.tsx` (the ref pattern):

```typescript
import { useState, useEffect, useCallback, useRef } from "react";
import type { CreateThingInput } from "@liratek/core"; // = z.input<typeof createThingSchema>
import { useApi } from "@liratek/ui";
import logger from "@/utils/logger";

export function ModulePage() {
  const api = useApi();
  // rule 25: stable loader identity — `.current` is reassigned every render,
  // so it is never stale, and the effect below does not re-fire on api churn.
  const apiRef = useRef(api);
  apiRef.current = api;

  const [items, setItems] = useState<Thing[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await apiRef.current.getThings()); // reads return the raw shape
    } catch (err) {
      logger.error("Failed to load things:", err);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSubmit(form: FormState) {
    // ONE payload, typed from the schema — no per-transport literal (rule 22)
    const payload: CreateThingInput = { name: form.name, amountUSD: form.amount };
    const result = await api.createThing(payload); // writes return the envelope
    if (result.success) {
      load();
    } else {
      setError(result.error ?? "Failed to save");
    }
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

### Adding an API function (dual-mode)

When the page needs a backend call `useApi()` does not have yet, add it in three places (the IPC handler, preload binding and REST route come first — see root **Dual-Transport Architecture**). Model: `addExpense`.

```typescript
// 1. frontend/src/api/backendApi.ts — payload type imported from @liratek/core (rule 21)
export async function createThing(
  payload: CreateThingInput,
): Promise<{ success: boolean; id?: number; error?: string }> {
  return ipcOrHttp(
    async () => getElectronApi().things.create(payload),
    async () =>
      requestJson<{ success: boolean; id?: number; error?: string }>(
        `/api/things`,
        { method: "POST", body: payload },
      ),
  );
}

// 2. frontend/src/api/ElectronApiAdapter.ts
createThing = (payload: CreateThingInput) => api.createThing(payload);

// 3. packages/ui/src/api/types.ts — on ApiAdapter
createThing: (payload: CreateThingInput) => Promise<ApiResult & { id?: number }>;
```

Never type the payload as a hand-written object literal, `any` or `unknown` — that is a second copy of the contract nothing keeps in sync. Make sure the type is exported from `packages/core/src/browser.ts` (the entry Vite and jest resolve), not only `index.ts`. Reads return the RAW IPC shape (array/object); writes return the `{ success, … }` envelope.

The desktop bridge type in `frontend/src/types/electron.d.ts` (`things.create: (data: CreateThingInput) => Promise<…>`) must still match the `preload.ts` binding, but only `backendApi.ts` calls it.

### Testing a component that uses `useApi()`

The mock MUST return a stable, module-level object (rule 25). A `useApi: () => ({ … })` literal creates a new identity every render; a component with `api` in a dependency list then loops synchronously, and jest reports it as **"Jest worker ran out of memory"**, not as a timeout. Pattern from `Expenses/__tests__/Expenses.addErrorMessage.test.tsx`:

```typescript
const mockAddExpense = jest.fn();
const mockGetTodayExpenses = jest.fn();

// module-level: one identity for the whole test file
const mockApi = {
  addExpense: mockAddExpense,
  getTodayExpenses: mockGetTodayExpenses,
};

jest.mock("@liratek/ui", () => ({
  useApi: () => mockApi,
  // …plus any other @liratek/ui exports the component renders
}));
```

Assert payload field names from the schema, not hand-typed (rule 24). When rewriting a test that covered an old `window.api` branch, turn it into a guard that the raw call is NOT made (`expect(rawWindowApiCall).not.toHaveBeenCalled()`).

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

Use TanStack Query for all data fetching — it replaces manual `useState`/`useEffect`/`loading`/`error` boilerplate. Call `useApi()` at the top of the hook; reads return the raw shape, so the query function returns it directly. For writes, `unwrapIpc` (`frontend/src/shared/api/unwrapIpc.ts`) unwraps the `{ success, error? }` envelope and throws on failure. (`unwrapIpc`'s own doc comment still shows a `window.api` argument — pass an `api.*` call instead.)

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateThingInput } from "@liratek/core";
import { useApi } from "@liratek/ui";
import { unwrapIpc } from "@/shared/api/unwrapIpc";

// ── Query key constants (co-locate with the hooks that use them) ──────────────
export const MODULE_KEYS = {
  all: ["myModule"] as const,
  detail: (id: number) => ["myModule", id] as const,
};

// ── Read ──────────────────────────────────────────────────────────────────────
export function useModuleListQuery() {
  const api = useApi();
  return useQuery({
    queryKey: MODULE_KEYS.all,
    queryFn: () => api.getThings(),
  });
}

// ── Write ─────────────────────────────────────────────────────────────────────
export function useCreateModuleMutation() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateThingInput) =>
      unwrapIpc(api.createThing(payload), (r) => r.id),
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

`QueryClientProvider` is already wired in `App.tsx` with transport-agnostic defaults (`retry: false`, `refetchOnWindowFocus: false`, `staleTime: 30_000`). New features should follow this pattern; old pages can be migrated as they are touched.

### Frontend Commands

```bash
yarn workspace @liratek/frontend typecheck
yarn workspace @liratek/frontend lint
yarn workspace @liratek/frontend test
yarn workspace @liratek/frontend test:coverage
```
