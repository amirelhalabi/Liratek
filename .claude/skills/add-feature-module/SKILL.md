---
name: add-feature-module
description: Use when adding a brand-new feature module to LiraTek end-to-end — the full database/backend/electron/frontend checklist and the quality gates to run before marking it done.
---

## Full Module Addition Checklist

When adding a new feature module, complete every step:

### Database

- [ ] Create migration in `packages/core/src/db/migrations/index.ts` (increment version)
- [ ] Add `down()` rollback function
- [ ] Register in `modules` table
- [ ] Add to `currency_modules` (USD & LBP)
- [ ] Add to `currency_drawers` (if cash-handling)
- [ ] Update `electron-app/create_db.sql` (same schema + migration entry)

### Backend

- [ ] Create `packages/core/src/repositories/{Module}Repository.ts`
- [ ] Create `packages/core/src/services/{Module}Service.ts`
- [ ] Export from `repositories/index.ts`
- [ ] Export from `services/index.ts`
- [ ] Use module-specific logger

### Electron

- [ ] Create `electron-app/handlers/{module}Handlers.ts`
- [ ] Add `requireRole()` auth checks
- [ ] Return `{ success, data?, error? }` from all handlers
- [ ] Add bindings in `electron-app/preload.ts`
- [ ] Register in `electron-app/main.ts`

### Frontend

- [ ] Create `frontend/src/features/{module}/pages/{Module}/index.tsx`
- [ ] Add route in `frontend/src/app/App.tsx`
- [ ] Add TypeScript types in `frontend/src/types/electron.d.ts`
- [ ] Handle loading, error, and empty states

### Quality Gates (run before marking done)

- [ ] `cd packages/core && npm run build`
- [ ] `yarn typecheck`
- [ ] `yarn lint`
- [ ] `yarn workspace @liratek/backend test`
- [ ] `yarn workspace @liratek/frontend test`
- [ ] `yarn build`
- [ ] `yarn dev` (manual smoke test)
