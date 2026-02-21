# @liratek/ui

Shared UI primitives, layout components, config, and renderer-facing types used by the desktop and future web shells.

## Scope

- Shared UI primitives (e.g., Select, NotificationCenter)
- Shared layouts (e.g., PageHeader)
- Shared utilities (e.g., appEvents)
- Shared config and renderer types

## Out of Scope

- App shell and routing
- Feature pages and business workflows
- Electron- or web-specific API wiring

## Usage

- Import shared components and utilities from `@liratek/ui`.
- The app shell remains responsible for routing and platform-specific behavior.
- CSS delivery is owned by the app shell (Tailwind build in `frontend/`).

## Scripts

- `npm run typecheck` - TypeScript typecheck
- `npm run build` - Alias of typecheck (source-only package)
- `npm run lint` - Alias of typecheck (source-only package)
