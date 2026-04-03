---
name: liratek-database
description: Database skills for LiraTek POS - SQLite schema design, migrations, queries, and data integrity
version: 1.0.0
license: MIT
metadata:
  author: LiraTek Engineering
  organization: LiraTek
  createdAt: "2026-03-20"
categories:
  - database
  - sqlite
  - sqlcipher
  - migrations
tags:
  - sqlite
  - migrations
  - schema
  - sql
  - sqlcipher
---

# LiraTek Database Skills

Database development skills for LiraTek POS system. Covers SQLite schema design, migrations, queries optimization, and data integrity.

## When to Use

Use these skills when:

- Creating database migrations
- Designing table schemas
- Writing SQL queries
- Optimizing database performance
- Managing schema changes

## Skill Structure

This skill contains modular rules organized by category:

- **migration-** : Migration creation and versioning
- **schema-** : Schema design and standards
- **query-** : Query optimization and patterns
- **index-** : Index creation and usage

## Related Skills

- `liratek-backend` - Repositories that use database
- `liratek-modules` - Module addition includes DB changes

## Quick Start

```bash
# Test migration on existing DB
yarn dev

# Test fresh install
rm "~/Library/Application Support/liratek/phone_shop.db" && yarn dev

# Check migrations
sqlite3 "~/Library/Application Support/liratek/phone_shop.db" \
  "SELECT * FROM schema_migrations ORDER BY version DESC;"
```

## Key Files

- `packages/core/src/db/migrations/index.ts` - Migration definitions
- `packages/core/src/db/connection.ts` - Database connection
- `electron-app/create_db.sql` - Fresh install schema

## Core Patterns

### Migration Structure

```typescript
{
  version: 48,
  name: "add_new_feature",
  description: "Add new feature tables",
  type: "typescript",
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS new_table (...)`);
  },
  down(db) {
    db.exec(`DROP TABLE IF EXISTS new_table`);
  }
}
```

### Schema Standards

```sql
CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  field1 TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Rules

Load the following rules for detailed guidance:

- `migration-creation` - Creating migrations
- `migration-versioning` - Version management
- `schema-table-standards` - Table design standards
- `query-parameterized` - Parameterized queries
- `index-creation` - Index patterns

## Current Version

Migration version: **47**

## Reference

- Migration example: `packages/core/src/db/migrations/index.ts` (see v47 for Loto)
- Fresh schema: `electron-app/create_db.sql`
