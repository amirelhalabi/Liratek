---
name: liratek-modules
description: Module addition skills for LiraTek POS - Complete checklist for adding new modules to the application
version: 1.0.0
license: MIT
metadata:
  author: LiraTek Engineering
  organization: LiraTek
  createdAt: "2026-03-20"
categories:
  - modules
  - feature-addition
  - checklist
tags:
  - modules
  - features
  - checklist
  - migration
---

# LiraTek Module Addition Skills

Complete checklist and patterns for adding new modules to LiraTek POS system.

## When to Use

Use these skills when:

- Adding a new feature module (like Loto)
- Extending existing modules
- Creating module migrations
- Setting up module IPC handlers
- Adding module frontend pages

## Skill Structure

This skill contains modular rules organized by category:

- **checklist-** : Complete addition checklist
- **migration-** : Module migration patterns
- **frontend-** : Frontend module setup
- **backend-** : Backend module setup

## Related Skills

- `liratek-database` - Database migrations
- `liratek-backend` - Backend services
- `liratek-frontend` - Frontend pages
- `liratek-electron` - IPC handlers

## Quick Start

Follow the complete checklist in `checklist-module-addition` rule.

## Module Addition Checklist

### Database (packages/core/src/db/migrations/index.ts)

- [ ] Add tables
- [ ] Increment migration version
- [ ] Add to modules table
- [ ] Add to currency_modules (USD & LBP)
- [ ] Add to currency_drawers
- [ ] Implement down() function

### Schema (electron-app/create_db.sql)

- [ ] Add CREATE TABLE statements
- [ ] Add module registration
- [ ] Add currency support
- [ ] Add to schema_migrations

### Backend (packages/core/src/)

- [ ] Create Repository
- [ ] Create Service
- [ ] Export in repositories/index.ts
- [ ] Export in services/index.ts
- [ ] Add logger

### IPC (electron-app/)

- [ ] Create handlers/{module}Handlers.ts
- [ ] Add preload bindings in preload.ts
- [ ] Register in main.ts

### Frontend (frontend/src/)

- [ ] Create features/{module}/pages/
- [ ] Add route in app/App.tsx
- [ ] Add types in types/electron.d.ts
- [ ] Create components if needed
- [ ] Create hooks if needed

### Testing

- [ ] Run typecheck
- [ ] Run lint
- [ ] Run tests
- [ ] Build application
- [ ] Test in dev mode

## Rules

Load the following rules for detailed guidance:

- `checklist-module-addition` - Complete addition checklist
- `migration-module-setup` - Module migration setup
- `frontend-module-setup` - Frontend module setup
- `backend-module-setup` - Backend module setup

## Reference

- Module example: Loto module (v47)
- Migration: `packages/core/src/db/migrations/index.ts`
