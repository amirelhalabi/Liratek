---
title: Schema Table Standards
impact: CRITICAL
impactDescription: All tables must follow consistent schema standards for maintainability and tooling support
tags:
  - schema
  - table
  - standards
  - critical
---

# Schema Table Standards

All database tables MUST follow consistent schema standards for timestamps, primary keys, and foreign keys.

## Required Columns

Every table MUST have:

```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
```

## Complete Table Template

```sql
CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Business fields
  name TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'active',

  -- Foreign keys
  user_id INTEGER,
  client_id INTEGER,

  -- Timestamps (REQUIRED)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- Foreign key constraints
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
);

-- Indexes for frequently queried fields
CREATE INDEX idx_entities_user_id ON entities(user_id);
CREATE INDEX idx_entities_status ON entities(status);
CREATE INDEX idx_entities_created_at ON entities(created_at);
```

## Column Types

### Text Fields

```sql
-- Required text
name TEXT NOT NULL,

-- Optional text
description TEXT,

-- Fixed length (codes, etc.)
code TEXT(10) NOT NULL,

-- Long text
notes TEXT
```

### Numeric Fields

```sql
-- Integer
quantity INTEGER NOT NULL DEFAULT 0,

-- Real/Float
amount REAL NOT NULL DEFAULT 0,
price REAL NOT NULL,

-- With check constraint
amount REAL CHECK (amount >= 0),
discount REAL CHECK (discount >= 0 AND discount <= 1)
```

### Boolean (Integer)

```sql
-- SQLite uses INTEGER for boolean
is_active INTEGER DEFAULT 1,
is_winner INTEGER DEFAULT 0,
deleted INTEGER DEFAULT 0
```

### Date/Time

```sql
-- Date only
sale_date TEXT,

-- Timestamp with default
created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

-- Soft delete timestamp
deleted_at DATETIME
```

## Foreign Key Constraints

### ON DELETE Actions

```sql
-- Set NULL on delete (most common)
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL

-- Cascade delete (use carefully)
FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE

-- Restrict delete (prevent orphan records)
FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT

-- No action (same as RESTRICT in SQLite)
FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE NO ACTION
```

### Examples

```sql
-- Sale items reference sale
FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE

-- Sale references client (don't delete client if has sales)
FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT

-- Product reference (can exist without product)
FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
```

## Index Patterns

### Single Column Index

```sql
CREATE INDEX idx_table_field ON table(field);

-- Examples
CREATE INDEX idx_sales_client_id ON sales(client_id);
CREATE INDEX idx_products_name ON products(name);
```

### Composite Index

```sql
CREATE INDEX idx_table_field1_field2 ON table(field1, field2);

-- Example
CREATE INDEX idx_sales_date_client ON sales(sale_date, client_id);
```

### Partial Index

```sql
CREATE INDEX idx_table_active ON table(status)
WHERE status = 'active';

-- Example
CREATE INDEX idx_sales_pending ON sales(status)
WHERE status = 'pending';
```

### Unique Index

```sql
CREATE UNIQUE INDEX idx_table_unique_field ON table(field);

-- Example
CREATE UNIQUE INDEX idx_users_email ON users(email);
```

## CHECK Constraints

```sql
-- Positive numbers
amount REAL CHECK (amount >= 0),

-- Percentage range
discount REAL CHECK (discount >= 0 AND discount <= 1),

-- Status enum
status TEXT CHECK (status IN ('active', 'inactive', 'pending')),

-- Date validation
sale_date TEXT CHECK (sale_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
```

## Example: Complete Table

```sql
CREATE TABLE IF NOT EXISTS loto_tickets (
  -- Primary key
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Business fields
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

  -- Foreign keys
  user_id INTEGER,

  -- Timestamps (REQUIRED)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- Constraints
  CHECK (sale_amount >= 0),
  CHECK (commission_rate >= 0 AND commission_rate <= 1),
  CHECK (prize_amount >= 0),
  CHECK (currency IN ('USD', 'LBP')),

  -- Foreign key constraints
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Indexes
CREATE INDEX idx_loto_tickets_sale_date ON loto_tickets(sale_date);
CREATE INDEX idx_loto_tickets_user_id ON loto_tickets(user_id);
CREATE INDEX idx_loto_tickets_is_winner ON loto_tickets(is_winner);
CREATE UNIQUE INDEX idx_loto_tickets_number ON loto_tickets(ticket_number)
  WHERE ticket_number IS NOT NULL;
```

## Naming Conventions

### Tables

- Lowercase with underscores: `loto_tickets`, `sale_items`
- Plural for entity tables: `users`, `products`, `sales`
- Singular for junction/settings: `currency_modules`, `loto_settings`

### Columns

- Lowercase with underscores: `created_at`, `sale_amount`
- Primary key: `id`
- Foreign keys: `{table}_id` (e.g., `user_id`, `client_id`)
- Timestamps: `created_at`, `updated_at`, `deleted_at`

### Indexes

- Format: `idx_{table}_{column(s)}`
- Examples:
  - `idx_sales_client_id`
  - `idx_products_name`
  - `idx_sales_date_client`

## Reference

- Example tables: `electron-app/create_db.sql`
- Migration example: `packages/core/src/db/migrations/index.ts` (v47)
