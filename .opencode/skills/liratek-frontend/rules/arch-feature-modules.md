---
title: Feature Module Architecture
impact: CRITICAL
impactDescription: Consistent feature module structure enables maintainability and discoverability
tags:
  - architecture
  - feature-modules
  - organization
  - critical
---

# Feature Module Architecture

All feature modules MUST follow the standard directory structure for consistency and maintainability.

## Directory Structure

```
frontend/src/features/{module}/
├── pages/
│   └── {Module}/
│       └── index.tsx          # Main page component
├── components/                 # Module-specific components
│   ├── {Module}Form.tsx
│   └── {Module}List.tsx
├── hooks/                      # Module-specific hooks
│   └── use{Module}Data.ts
└── types/                      # Module-specific types
    └── {module}.ts
```

## Example: Loto Module

```
frontend/src/features/loto/
├── pages/
│   └── Loto/
│       └── index.tsx
├── components/
│   ├── LotoForm.tsx
│   ├── LotoList.tsx
│   └── LotoStats.tsx
├── hooks/
│   └── useLotoData.ts
└── types/
    └── loto.ts
```

## Page Component

`features/loto/pages/Loto/index.tsx`:

```typescript
import { useState, useEffect } from "react";
import { Ticket, DollarSign } from "lucide-react";

export function LotoPage() {
  const [data, setData] = useState<Type | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const result = await window.api.loto.get();
    if (result.success) {
      setData(result.data);
    }
    setLoading(false);
  }

  return (
    <div className="h-full p-6">
      <h1 className="text-2xl font-bold text-white">Loto</h1>
      {/* Content */}
    </div>
  );
}

export default LotoPage;
```

## Add Route

In `frontend/src/app/App.tsx`:

```typescript
import { lazy } from "react";

const Loto = lazy(() => import("@/features/loto/pages/Loto"));

// In Routes:
<Route
  path="/loto"
  element={
    <ProtectedRoute>
      <Loto />
    </ProtectedRoute>
  }
/>
```

## Component Files

`features/loto/components/LotoForm.tsx`:

```typescript
import { useState } from "react";

interface LotoFormProps {
  onSubmit: (data: CreateLotoData) => void;
  onCancel: () => void;
}

export function LotoForm({ onSubmit, onCancel }: LotoFormProps) {
  const [ticketNumber, setTicketNumber] = useState("");
  const [saleAmount, setSaleAmount] = useState("");

  function handleSubmit() {
    onSubmit({
      ticket_number: ticketNumber,
      sale_amount: parseFloat(saleAmount),
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* Form fields */}
    </form>
  );
}
```

## Custom Hook

`features/loto/hooks/useLotoData.ts`:

```typescript
import { useState, useEffect } from "react";

export function useLotoData() {
  const [data, setData] = useState<Type | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const result = await window.api.loto.get();
      if (result.success) {
        setData(result.data);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  return { data, loading, error, refetch: loadData };
}
```

## Types

`features/loto/types/loto.ts`:

```typescript
export interface LotoTicket {
  id: number;
  ticket_number: string;
  sale_amount: number;
  commission_rate: number;
  commission_amount: number;
  is_winner: boolean;
  prize_amount: number;
  sale_date: string;
  created_at: string;
  updated_at: string;
}

export interface CreateLotoData {
  ticket_number?: string;
  sale_amount: number;
  commission_rate?: number;
  is_winner?: boolean;
  prize_amount?: number;
  sale_date?: string;
  payment_method?: string;
  currency?: string;
  note?: string;
}
```

## Required Elements

✅ **DO:**

- Create `pages/{Module}/index.tsx` for main page
- Export component as both named and default
- Add route in `app/App.tsx`
- Use `@/` alias for imports
- Handle loading and error states
- Use module-specific components
- Create custom hooks for data fetching
- Define TypeScript types

❌ **DON'T:**

- Put all components in one file
- Skip the pages directory
- Forget to add route
- Use relative imports (use `@/`)
- Skip loading/error states
- Put business logic in components

## Module Naming

- Directory: `features/{module}` (kebab-case, lowercase)
- Page: `pages/{Module}` (PascalCase)
- Component: `{Module}Component.tsx` (PascalCase)
- Hook: `use{Module}Hook.ts` (camelCase)
- Type: `{module}.ts` (kebab-case, lowercase)

## Reference

- Example: `frontend/src/features/loto/pages/Loto/index.tsx`
- Routes: `frontend/src/app/App.tsx`
- Shared components: `frontend/src/shared/components/`
