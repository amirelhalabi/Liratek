---
title: Stats Card Component
impact: MEDIUM
impactDescription: Consistent stats card UI pattern across the application
tags:
  - component
  - ui
  - stats
  - medium
---

# Stats Card Component

Use the standard stats card pattern for displaying metrics and statistics.

## Basic Pattern

```typescript
import { Icon } from "lucide-react";

<div className="bg-slate-800 rounded-xl border border-slate-700/50 p-4">
  <div className="flex items-center gap-2 mb-2">
    <Icon className="w-4 h-4 text-color-400" />
    <span className="text-xs text-slate-400">Label</span>
  </div>
  <p className="text-2xl font-bold text-white">{value.toLocaleString()}</p>
</div>
```

## Examples

### Single Stat

```typescript
import { DollarSign } from "lucide-react";

<div className="bg-slate-800 rounded-xl border border-slate-700/50 p-4">
  <div className="flex items-center gap-2 mb-2">
    <DollarSign className="w-4 h-4 text-green-400" />
    <span className="text-xs text-slate-400">Total Sales</span>
  </div>
  <p className="text-2xl font-bold text-white">
    {totalSales.toLocaleString()}
  </p>
</div>
```

### Stat with Change Indicator

```typescript
import { TrendingUp, TrendingDown } from "lucide-react";

<div className="bg-slate-800 rounded-xl border border-slate-700/50 p-4">
  <div className="flex items-center justify-between mb-2">
    <div className="flex items-center gap-2">
      <DollarSign className="w-4 h-4 text-green-400" />
      <span className="text-xs text-slate-400">Revenue</span>
    </div>
    {change > 0 ? (
      <TrendingUp className="w-4 h-4 text-green-500" />
    ) : (
      <TrendingDown className="w-4 h-4 text-red-500" />
    )}
  </div>
  <p className="text-2xl font-bold text-white">
    {revenue.toLocaleString()}
  </p>
  <p className={`text-xs mt-1 ${change > 0 ? "text-green-500" : "text-red-500"}`}>
    {change > 0 ? "+" : ""}{change}% from last month
  </p>
</div>
```

### Stats Grid

```typescript
import { Ticket, DollarSign, Users, ShoppingCart } from "lucide-react";

<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
  <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-4">
    <div className="flex items-center gap-2 mb-2">
      <Ticket className="w-4 h-4 text-blue-400" />
      <span className="text-xs text-slate-400">Total Tickets</span>
    </div>
    <p className="text-2xl font-bold text-white">
      {totalTickets.toLocaleString()}
    </p>
  </div>

  <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-4">
    <div className="flex items-center gap-2 mb-2">
      <DollarSign className="w-4 h-4 text-green-400" />
      <span className="text-xs text-slate-400">Total Sales</span>
    </div>
    <p className="text-2xl font-bold text-white">
      {totalSales.toLocaleString()} LBP
    </p>
  </div>

  <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-4">
    <div className="flex items-center gap-2 mb-2">
      <DollarSign className="w-4 h-4 text-yellow-400" />
      <span className="text-xs text-slate-400">Commission</span>
    </div>
    <p className="text-2xl font-bold text-white">
      {totalCommission.toLocaleString()} LBP
    </p>
  </div>

  <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-4">
    <div className="flex items-center gap-2 mb-2">
      <Users className="w-4 h-4 text-purple-400" />
      <span className="text-xs text-slate-400">Winners</span>
    </div>
    <p className="text-2xl font-bold text-white">
      {totalWinners.toLocaleString()}
    </p>
  </div>
</div>
```

### Reusable Component

```typescript
import { LucideIcon } from "lucide-react";

interface StatsCardProps {
  icon: LucideIcon;
  label: string;
  value: number | string;
  change?: number;
  color?: "blue" | "green" | "yellow" | "red" | "purple";
}

const colorMap = {
  blue: "text-blue-400",
  green: "text-green-400",
  yellow: "text-yellow-400",
  red: "text-red-400",
  purple: "text-purple-400",
};

export function StatsCard({
  icon: Icon,
  label,
  value,
  change,
  color = "blue"
}: StatsCardProps) {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${colorMap[color]}`} />
          <span className="text-xs text-slate-400">{label}</span>
        </div>
        {change !== undefined && (
          change >= 0 ? (
            <TrendingUp className="w-4 h-4 text-green-500" />
          ) : (
            <TrendingDown className="w-4 h-4 text-red-500" />
          )
        )}
      </div>
      <p className="text-2xl font-bold text-white">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {change !== undefined && (
        <p className={`text-xs mt-1 ${change >= 0 ? "text-green-500" : "text-red-500"}`}>
          {change >= 0 ? "+" : ""}{change}% from last month
        </p>
      )}
    </div>
  );
}
```

## Color Variations

```typescript
// Blue (default)
<DollarSign className="w-4 h-4 text-blue-400" />

// Green (positive, money)
<DollarSign className="w-4 h-4 text-green-400" />

// Yellow (warning, commission)
<DollarSign className="w-4 h-4 text-yellow-400" />

// Red (negative, losses)
<DollarSign className="w-4 h-4 text-red-400" />

// Purple (users, premium)
<Users className="w-4 h-4 text-purple-400" />
```

## Styling Breakdown

```typescript
// Container
className = "bg-slate-800 rounded-xl border border-slate-700/50 p-4";

// Icon + Label row
className = "flex items-center gap-2 mb-2";

// Icon
className = "w-4 h-4 text-color-400";

// Label
className = "text-xs text-slate-400";

// Value
className = "text-2xl font-bold text-white";
```

## Reference

- Example: `frontend/src/features/loto/pages/Loto/index.tsx`
- Shared components: `frontend/src/shared/components/`
- Icons: https://lucide.dev/icons/
