---
title: Parameterized SQL Queries
impact: CRITICAL
impactDescription: SQL injection prevention - all queries must use parameterized statements
tags:
  - security
  - database
  - sql
  - critical
---

# Parameterized SQL Queries

All SQL queries MUST use parameterized statements to prevent SQL injection attacks.

## Correct Usage

✅ **DO:**

```typescript
// Using ? placeholders
const stmt = this.db.prepare(`
  SELECT * FROM users WHERE id = ?
`);
const user = stmt.get(userId);

// Multiple parameters
const stmt = this.db.prepare(`
  INSERT INTO products (name, price, created_at, updated_at)
  VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
`);
stmt.run(name, price);

// Using named parameters
const stmt = this.db.prepare(`
  UPDATE users SET name = :name, email = :email WHERE id = :id
`);
stmt.run({ name, email, id });

// IN clause with dynamic parameters
const ids = [1, 2, 3];
const placeholders = ids.map(() => "?").join(", ");
const stmt = this.db.prepare(`
  SELECT * FROM products WHERE id IN (${placeholders})
`);
const products = stmt.all(...ids);
```

## Incorrect Usage

❌ **DON'T:**

```typescript
// NEVER concatenate user input
const stmt = this.db.prepare(`
  SELECT * FROM users WHERE id = ${userId}
`);

// NEVER use template literals with variables
const stmt = this.db.prepare(`
  SELECT * FROM users WHERE name = '${name}'
`);

// NEVER build SQL with string concatenation
const sql = `DELETE FROM users WHERE id = ` + userId;
const stmt = this.db.prepare(sql);
```

## Examples by Operation

### SELECT

```typescript
// Single condition
getById(id: number): Entity | null {
  const stmt = this.db.prepare(`SELECT * FROM table WHERE id = ?`);
  return stmt.get(id) as Entity | null;
}

// Multiple conditions
getByStatusAndDate(status: string, date: string): Entity[] {
  const stmt = this.db.prepare(`
    SELECT * FROM table
    WHERE status = ? AND created_at >= ?
  `);
  return stmt.all(status, date) as Entity[];
}

// LIKE query (sanitize input)
searchByName(name: string): Entity[] {
  const searchTerm = `%${name.replace(/[%_]/g, "")}%`;
  const stmt = this.db.prepare(`
    SELECT * FROM table WHERE name LIKE ?
  `);
  return stmt.all(searchTerm) as Entity[];
}
```

### INSERT

```typescript
create(data: CreateData): Entity {
  const stmt = this.db.prepare(`
    INSERT INTO table (field1, field2, field3, created_at, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  const result = stmt.run(data.field1, data.field2, data.field3);
  return this.getById(result.lastInsertRowid as number)!;
}
```

### UPDATE

```typescript
update(id: number, data: Partial<CreateData>): Entity | null {
  const stmt = this.db.prepare(`
    UPDATE table
    SET field1 = ?, field2 = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(data.field1, data.field2, id);
  return this.getById(id);
}

// Dynamic UPDATE (only include provided fields)
updateDynamic(id: number, data: Partial<CreateData>): Entity | null {
  const fields = Object.keys(data);
  if (fields.length === 0) return this.getById(id);

  const setClause = fields
    .map((f) => `${f} = ?`)
    .join(", ");
  const values = fields.map((f) => data[f as keyof typeof data]);

  const stmt = this.db.prepare(`
    UPDATE table
    SET ${setClause}, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(...values, id);
  return this.getById(id);
}
```

### DELETE

```typescript
delete(id: number): void {
  const stmt = this.db.prepare(`DELETE FROM table WHERE id = ?`);
  stmt.run(id);
}

// Soft delete
softDelete(id: number): Entity | null {
  const stmt = this.db.prepare(`
    UPDATE table
    SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(id);
  return this.getById(id);
}
```

### Aggregations

```typescript
getTotal(from: string, to: string): number {
  const stmt = this.db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM transactions
    WHERE created_at BETWEEN ? AND ?
  `);
  const result = stmt.get(from, to) as { total: number };
  return result.total;
}

getCount(status?: string): number {
  if (status) {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM table WHERE status = ?
    `);
    const result = stmt.get(status) as { count: number };
    return result.count;
  }

  const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM table`);
  const result = stmt.get() as { count: number };
  return result.count;
}
```

## Transactions

```typescript
createWithItems(data: CreateSaleData): Sale {
  const transaction = this.db.transaction((saleData, items) => {
    // Create sale
    const saleStmt = this.db.prepare(`
      INSERT INTO sales (client_id, total, created_at, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    const saleResult = saleStmt.run(saleData.client_id, saleData.total);
    const saleId = saleResult.lastInsertRowid as number;

    // Create items
    const itemStmt = this.db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, quantity, price, created_at, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    for (const item of items) {
      itemStmt.run(saleId, item.product_id, item.quantity, item.price);
    }

    return saleId;
  });

  const saleId = transaction(data, data.items);
  return this.getById(saleId)!;
}
```

## Security Notes

1. **Never trust user input** - Always use parameters
2. **Sanitize LIKE queries** - Escape `%` and `_` characters
3. **Validate data types** - Ensure numbers are numbers, etc.
4. **Use transactions** - For multi-step operations
5. **Limit result sets** - Use LIMIT to prevent DoS

## Reference

- better-sqlite3 docs: https://github.com/JoshuaWise/better-sqlite3
- OWASP SQL Injection: https://owasp.org/www-community/attacks/SQL_Injection
