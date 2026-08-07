---
name: add-migration
description: Use when adding a new database migration to LiraTek — schema conventions, the migration template (up/down, module registration, currency_modules/currency_drawers inserts), and keeping create_db.sql in sync.
---

## Area: Database (`packages/core/src/db/`)

### Migration Creation

Add to `packages/core/src/db/migrations/index.ts`:

```typescript
{
  version: 49, // Always increment from current
  name: "add_new_feature",
  description: "Add new feature tables",
  type: "typescript",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS new_table (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        field1 TEXT NOT NULL,
        field2 REAL NOT NULL DEFAULT 0,
        user_id INTEGER,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    db.exec(`CREATE INDEX idx_new_table_user_id ON new_table(user_id)`);
    db.exec(`CREATE INDEX idx_new_table_created_at ON new_table(created_at)`);

    // Register module
    db.exec(`
      INSERT OR IGNORE INTO modules (key, label, icon, route, sort_order, admin_only)
      VALUES ('new_module', 'New Module', 'IconName', '/new-module', 17, 0)
    `);

    // Currency support (USD & LBP)
    db.exec(`
      INSERT OR IGNORE INTO currency_modules (currency_code, module_key)
      VALUES ('USD', 'new_module'), ('LBP', 'new_module')
    `);

    // Drawer support (if module handles cash)
    db.exec(`
      INSERT OR IGNORE INTO currency_drawers (currency_code, drawer_name)
      VALUES ('USD', 'NewModule'), ('LBP', 'NewModule')
    `);

    console.log("Migration v49: New feature added");
  },
  down(db) {
    db.exec(`DROP TABLE IF EXISTS new_table`);
    db.exec(`DELETE FROM modules WHERE key = 'new_module'`);
    db.exec(`DELETE FROM currency_modules WHERE module_key = 'new_module'`);
    db.exec(`DELETE FROM currency_drawers WHERE drawer_name = 'NewModule'`);
  }
}
```

### Fresh Install Schema

Also update `electron-app/create_db.sql` with the same table + INSERT statements, plus:

```sql
INSERT INTO schema_migrations (version, name, applied_at)
VALUES (49, 'add_new_feature', CURRENT_TIMESTAMP);
```

### Schema Standards

```sql
-- Every table must have:
id INTEGER PRIMARY KEY AUTOINCREMENT
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP

-- Foreign keys with explicit actions:
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL   -- most common
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE    -- for child records
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT   -- protect parent

-- Indexes for WHERE/JOIN fields:
CREATE INDEX idx_table_field ON table(field);
```

### Transactions

```typescript
const transaction = db.transaction((data) => {
  db.prepare(`INSERT INTO table1 ...`).run(data.val1);
  db.prepare(`INSERT INTO table2 ...`).run(data.val2);
});
transaction(data);
```

### Database Tables Reference

**Core**: `users`, `products`, `clients`, `sales`, `sale_items`, `debt_ledger`, `suppliers`

**Financial**: `financial_services` (OMT/Whish/IPEC/KATCH), `recharges` (MTC/Alfa), `loto_tickets`, `loto_settings`, `loto_monthly_fees`, `exchange_rates`, `expenses`, `maintenance_jobs`

**System**: `modules`, `payment_methods`, `currencies`, `currency_modules`, `currency_drawers`, `schema_migrations`
