# Database Schema & Migrations

**Last Updated:** February 21, 2026

---

## How the Schema Works

LiraTek uses a two-part approach to database management:

| Phase                    | Tool                 | Purpose                                        |
| ------------------------ | -------------------- | ---------------------------------------------- |
| **Pre-production** (now) | `create_db.sql`      | Single source of truth for the full schema     |
| **Post-production**      | `MIGRATIONS[]` array | Incremental changes to existing user databases |

### Pre-production (current state)

All tables, indexes, and seed data are defined in **`electron-app/create_db.sql`**. When the app starts for the first time and finds no database, it runs this file to create everything from scratch.

The `MIGRATIONS[]` array in `packages/core/src/db/migrations/index.ts` contains migrations v9–v20. These run automatically on app startup for existing databases. Any new schema change should be added both to `create_db.sql` (for fresh installs) and as a new migration entry (for existing databases).

### Post-production (future)

Once real users have data, you can't re-run `create_db.sql` without destroying their data. At that point, you add entries to the `MIGRATIONS[]` array. The migration runner will:

1. Check `schema_migrations` to see what version the database is at
2. Run only the new migrations the user hasn't applied yet
3. Record each applied migration so it never runs twice

---

## Schema Files

| File                                       | Purpose                                        |
| ------------------------------------------ | ---------------------------------------------- |
| `electron-app/create_db.sql`               | Full canonical schema (tables, indexes, seeds) |
| `packages/core/src/db/migrations/index.ts` | Migration runner + registry (v9–v20)           |
| `scripts/migrate.ts`                       | CLI tool for manual migration management       |

---

## The `schema_migrations` Table

Tracks which migrations have been applied to a database:

```sql
CREATE TABLE schema_migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    applied_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

- Created by `create_db.sql` for new databases
- Also created by the migration runner if missing (for safety)
- Currently has entries for v9–v20

---

## Adding a Migration (Post-Production)

When you need to change the schema after users have real data:

### 1. Add the change to `create_db.sql`

So that new fresh databases still get the full schema:

```sql
-- In create_db.sql, add the new table/column/index
CREATE TABLE IF NOT EXISTS product_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    tag TEXT NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id)
);
```

### 2. Add a migration for existing databases

In `packages/core/src/db/migrations/index.ts`:

```typescript
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "add_product_tags",
    description: "Add product tagging feature",
    type: "typescript",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS product_tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL,
          tag TEXT NOT NULL,
          FOREIGN KEY (product_id) REFERENCES products(id)
        );
      `);
    },
    down(db) {
      db.exec(`DROP TABLE IF EXISTS product_tags;`);
    },
  },
];
```

### 3. Version rules

- Start from **1** and increment sequentially
- Never reuse or skip a version number
- Never modify a migration after it has been applied to any database

---

## Automatic Startup

In `electron-app/main.ts`, `runMigrations(db)` is called on every app launch. It's a no-op when there are no pending migrations, so it has zero cost today.

```
App starts → create_db.sql (if fresh) → runMigrations(db) (applies pending) → ready
```

---

## CLI Usage

```bash
# Run pending migrations
npm run migrate

# Check current status
npm run migrate status

# Rollback to a specific version
npm run migrate rollback 2

# Show current version number
npm run migrate version
```

---

## Programmatic API

All exported from `@liratek/core`:

```typescript
import {
  runMigrations,
  getCurrentVersion,
  getMigrationStatus,
  getPendingMigrations,
  getAppliedMigrations,
  rollbackTo,
} from "@liratek/core";
```

| Function                   | Returns             | Description                                         |
| -------------------------- | ------------------- | --------------------------------------------------- |
| `runMigrations(db)`        | `void`              | Apply all pending migrations                        |
| `getCurrentVersion(db)`    | `number`            | Highest applied version (0 if none)                 |
| `getMigrationStatus(db)`   | `object`            | Current version, latest, applied list, pending list |
| `getPendingMigrations(db)` | `Migration[]`       | Migrations not yet applied                          |
| `getAppliedMigrations(db)` | `MigrationRecord[]` | Already-applied migrations with timestamps          |
| `rollbackTo(db, version)`  | `void`              | Roll back to target version (requires `down()`)     |

---

## Best Practices

**DO:**

- Keep migrations small and focused (one concern per migration)
- Use `IF NOT EXISTS` / `IF EXISTS` for idempotency
- Always update `create_db.sql` AND add a migration (both must stay in sync)
- Provide `down()` rollback methods when possible
- Test the migration on a copy of data before deploying

**DON'T:**

- Modify a migration after it has been applied
- Put business logic in migrations — keep them pure schema/data operations
- Depend on application code from within a migration
- Skip version numbers
