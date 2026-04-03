---
name: liratek-backend
description: Backend development skills for LiraTek POS - Repository pattern, Service pattern, business logic, and database operations in packages/core
version: 1.0.0
license: MIT
metadata:
  author: LiraTek Engineering
  organization: LiraTek
  createdAt: "2026-03-20"
categories:
  - backend
  - typescript
  - nodejs
  - sqlite
tags:
  - repository-pattern
  - service-pattern
  - business-logic
  - database
  - sqlite
  - sqlcipher
---

# LiraTek Backend Skills

Backend development skills for LiraTek POS system. Covers Repository pattern, Service pattern, business logic implementation, and database operations.

## When to Use

Use these skills when:

- Creating new repositories for database access
- Implementing business logic in services
- Adding database migrations
- Working with packages/core/src/

## Skill Structure

This skill contains modular rules organized by category:

- **arch-** : Architecture patterns (Repository, Service)
- **db-** : Database operations and queries
- **logger-** : Logging patterns
- **test-** : Testing patterns
- **export-** : Module export patterns

## Related Skills

- `liratek-database` - Database schema and migrations
- `liratek-electron` - IPC handlers that use backend services
- `liratek-testing` - Unit testing patterns

## Quick Start

```bash
# Type check backend
cd packages/core && npm run typecheck

# Build backend
cd packages/core && npm run build

# Run backend tests
yarn workspace @liratek/backend test
```

## Key Files

- `packages/core/src/repositories/` - Database access layer
- `packages/core/src/services/` - Business logic layer
- `packages/core/src/db/` - Database connection and migrations
- `packages/core/src/utils/logger.ts` - Module loggers

## Core Patterns

### Repository Pattern

Data access layer with singleton pattern:

```typescript
export class MyRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  create(data: CreateData): Entity {
    const stmt = this.db.prepare(`INSERT INTO table ...`);
    const result = stmt.run(...values);
    return this.getById(result.lastInsertRowid as number);
  }
}
```

### Service Pattern

Business logic layer with validation:

```typescript
export class MyService {
  private repo: MyRepository;

  constructor(repo: MyRepository) {
    this.repo = repo;
  }

  createEntity(data: CreateData): Entity {
    // Business logic validation
    // Calculate derived fields
    // Create entity via repository
    return this.repo.create(data);
  }
}
```

## Rules

Load the following rules for detailed guidance:

- `arch-repository-pattern` - Repository implementation
- `arch-service-pattern` - Service implementation
- `db-parameterized-queries` - SQL safety
- `logger-module-usage` - Logging patterns
- `export-singleton-pattern` - Singleton exports

## Testing

Always verify:

```bash
# Type check
yarn workspace @liratek/backend typecheck

# Lint
yarn workspace @liratek/backend lint

# Test
yarn workspace @liratek/backend test
```
