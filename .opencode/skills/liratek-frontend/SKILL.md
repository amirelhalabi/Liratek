---
name: liratek-frontend
description: Frontend development skills for LiraTek POS - React components, pages, routes, TypeScript types, and UI patterns
version: 1.0.0
license: MIT
metadata:
  author: LiraTek Engineering
  organization: LiraTek
  createdAt: "2026-03-20"
categories:
  - frontend
  - react
  - typescript
  - vite
tags:
  - react
  - components
  - pages
  - typescript
  - tailwindcss
  - vite
---

# LiraTek Frontend Skills

Frontend development skills for LiraTek POS system. Covers React components, pages, routes, TypeScript types, and UI patterns.

## When to Use

Use these skills when:

- Creating new feature modules
- Building React components
- Adding routes to the app
- Defining TypeScript types for IPC
- Implementing UI patterns

## Skill Structure

This skill contains modular rules organized by category:

- **arch-** : Architecture patterns (feature modules, pages)
- **comp-** : Component patterns (cards, forms, tables)
- **ipc-** : IPC API access patterns
- **type-** : TypeScript type definitions
- **route-** : Route configuration
- **hook-** : Custom hooks

## Related Skills

- `liratek-electron` - IPC handlers that frontend calls
- `liratek-backend` - Backend services accessed via IPC
- `liratek-testing` - Frontend testing patterns

## Quick Start

```bash
# Type check frontend
cd frontend && npm run typecheck

# Lint frontend
cd frontend && npm run lint

# Build frontend
cd frontend && npm run build

# Dev mode
cd frontend && npm run dev
```

## Key Files

- `frontend/src/features/` - Feature modules
- `frontend/src/shared/components/` - Shared components
- `frontend/src/app/App.tsx` - App routes
- `frontend/src/types/electron.d.ts` - TypeScript types

## Core Patterns

### Feature Module Structure

```
frontend/src/features/{module}/
├── pages/
│   └── {Module}/
│       └── index.tsx
├── components/
├── hooks/
└── types/
```

### IPC Access

```typescript
// ✅ CORRECT
const result = await window.api.my.create(data);

// ❌ WRONG - NEVER use
const result = await window.electron.my.create(data);
```

## Rules

Load the following rules for detailed guidance:

- `arch-feature-modules` - Feature module structure
- `comp-stats-card` - Stats card component
- `comp-form-input` - Form input component
- `ipc-api-access` - IPC access patterns
- `type-ipc-definitions` - TypeScript type definitions
- `route-configuration` - Route setup

## Testing

Always verify:

```bash
# Type check
cd frontend && npm run typecheck

# Lint
cd frontend && npm run lint

# Test
yarn workspace @liratek/frontend test
```
