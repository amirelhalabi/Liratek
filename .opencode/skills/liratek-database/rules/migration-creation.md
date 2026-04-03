---
title: Migration Creation Pattern
impact: CRITICAL
impactDescription: All database changes must be versioned with up/down migrations for rollback capability
tags:
  - migration
  - database
  - versioning
  - critical
---

# Migration Creation Pattern

All database schema changes MUST be implemented as versioned migrations with both `up()` and `down()` functions.

## Migration Structure

In `packages/core/src/db/migrations/index.ts`:

```typescript
{
  version: 48, // Increment from current (47)
  name: "add_new_feature",
  description: "Add new feature tables and configuration",
  type: "typescript",
  up(db: Database.Database) {
    // 1. Create tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS new_table (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        field1 TEXT NOT NULL,
        field2 REAL NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Add module registration
    db.exec(`
      INSERT OR IGNORE INTO modules (key, label, icon, route, sort_order, admin_only)
      VALUES ('new_module', 'New Module', 'Icon', '/new-module', 17, 0)
    `);

    // 3. Add currency support (USD & LBP)
    db.exec(`
      INSERT OR IGNORE INTO currency_modules (currency_code, module_key)
      VALUES ('USD', 'new_module'), ('LBP', 'new_module')
    `);

    // 4. Add drawer support (if needed)
    db.exec(`
      INSERT OR IGNORE INTO currency_drawers (currency_code, drawer_name)
      VALUES ('USD', 'NewModule'), ('LBP', 'NewModule')
    `);

    console.log("Migration v48: New feature added");
  },
  down(db: Database.Database) {
    // Rollback in reverse order
    db.exec(`DELETE FROM currency_drawers WHERE drawer_name = 'NewModule'`);
    db.exec(`DELETE FROM currency_modules WHERE module_key = 'new_module'`);
    db.exec(`DELETE FROM modules WHERE key = 'new_module'`);
    db.exec(`DROP TABLE IF EXISTS new_table`);
  }
}
```

## Required Elements

✅ **DO:**

- Increment version number from current (47 → 48)
- Implement both `up()` and `down()` functions
- Use parameterized queries
- Add module to `modules` table
- Add currency support (`currency_modules`)
- Add drawer support (`currency_drawers`) if needed
- Update `electron-app/create_db.sql` for fresh installs
- Log migration completion

❌ **DON'T:**

- Skip the `down()` function
- Forget to increment version
- Use string concatenation for SQL
- Forget to update `create_db.sql`
- Skip module registration
- Forget currency support

## Module Registration

For new modules, always add:

```typescript
// Module entry
db.exec(`
  INSERT OR IGNORE INTO modules (key, label, icon, route, sort_order, admin_only)
  VALUES ('module_key', 'Module Label', 'IconName', '/module-route', 17, 0)
`);

// Currency support (USD & LBP)
db.exec(`
  INSERT OR IGNORE INTO currency_modules (currency_code, module_key)
  VALUES ('USD', 'module_key'), ('LBP', 'module_key')
`);

// Drawer support (if needed)
db.exec(`
  INSERT OR IGNORE INTO currency_drawers (currency_code, drawer_name)
  VALUES ('USD', 'ModuleName'), ('LBP', 'ModuleName')
`);
```

## Fresh Install Schema

Update `electron-app/create_db.sql`:

```sql
-- Create table
CREATE TABLE IF NOT EXISTS new_table (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  field1 TEXT NOT NULL,
  field2 REAL NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Register module
INSERT OR IGNORE INTO modules (key, label, icon, route, sort_order, admin_only)
VALUES ('new_module', 'New Module', 'Icon', '/new-module', 17, 0);

-- Add currency support
INSERT OR IGNORE INTO currency_modules (currency_code, module_key)
VALUES ('USD', 'new_module'), ('LBP', 'new_module');

-- Add to schema migrations
INSERT INTO schema_migrations (version, name, applied_at)
VALUES (48, 'add_new_feature', CURRENT_TIMESTAMP);
```

## Testing Migrations

### Test on Existing Database

```bash
# Start app (migration auto-runs)
yarn dev

# Check migration applied
sqlite3 "~/Library/Application Support/liratek/phone_shop.db" \
  "SELECT * FROM schema_migrations ORDER BY version DESC LIMIT 1;"

# Check tables created
sqlite3 "~/Library/Application Support/liratek/phone_shop.db" \
  ".tables" | grep -i new_module
```

### Test Fresh Install

```bash
# Delete database
rm "~/Library/Application Support/liratek/phone_shop.db"

# Start app (creates fresh DB)
yarn dev

# Verify tables exist
sqlite3 "~/Library/Application Support/liratek/phone_shop.db" \
  "SELECT name FROM sqlite_master WHERE type='table';"
```

## Example: Loto Module Migration (v47)

```typescript
{
  version: 47,
  name: "add_loto_module",
  description: "Add Loto module tables and configuration",
  type: "typescript",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS loto_tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_number TEXT,
        sale_amount REAL NOT NULL,
        commission_rate REAL DEFAULT 0.0445,
        commission_amount REAL,
        is_winner INTEGER DEFAULT 0,
        prize_amount REAL DEFAULT 0,
        sale_date TEXT,
        payment_method TEXT,
        currency TEXT DEFAULT 'LBP',
        note TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS loto_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        setting_key TEXT UNIQUE NOT NULL,
        setting_value TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.exec(`
      INSERT OR IGNORE INTO modules (key, label, icon, route, sort_order, admin_only)
      VALUES ('loto', 'Loto', 'Ticket', '/loto', 16, 0)
    `);

    db.exec(`
      INSERT OR IGNORE INTO currency_modules (currency_code, module_key)
      VALUES ('USD', 'loto'), ('LBP', 'loto')
    `);

    db.exec(`
      INSERT OR IGNORE INTO currency_drawers (currency_code, drawer_name)
      VALUES ('USD', 'Loto'), ('LBP', 'Loto')
    `);

    console.log("Migration v47: Loto module added");
  },
  down(db) {
    db.exec(`DROP TABLE IF EXISTS loto_tickets`);
    db.exec(`DROP TABLE IF EXISTS loto_settings`);
    db.exec(`DROP TABLE IF EXISTS loto_monthly_fees`);
    db.exec(`DELETE FROM modules WHERE key = 'loto'`);
    db.exec(`DELETE FROM currency_modules WHERE module_key = 'loto'`);
    db.exec(`DELETE FROM currency_drawers WHERE drawer_name IN ('Loto', 'Loto')`);
  }
}
```

## Rollback Strategy

The `down()` function should:

1. Delete in reverse order of creation
2. Remove from system tables (modules, currency_modules, currency_drawers)
3. Drop tables last
4. Be idempotent (safe to run multiple times)

## Reference

- Migration file: `packages/core/src/db/migrations/index.ts`
- Fresh schema: `electron-app/create_db.sql`
- Example: v47 Loto migration
