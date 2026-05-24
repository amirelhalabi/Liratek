# Audit Trail System — Planning Document

## 1. Objective

Track **every mutation** performed in LiraTek POS — who did what, when, and what changed. This enables:

- Detecting wrong sales or suspicious activity by trainees/staff
- Tracking price changes on products
- Reviewing refunds, voids, and deletions
- Full accountability per user session

---

## 2. Current State

| What exists                                                                                                                                    | What's missing                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `transactions` table logs financial operations (sales, refunds, exchanges, OMT, recharges, expenses, debts) with `user_id` and `metadata_json` | No audit trail for **non-financial** mutations: product edits, price changes, settings changes, user management, rate changes, module toggles |
| `ActivityService` (deprecated) wraps `TransactionService.getRecent()`                                                                          | No before/after snapshots — can't see _what_ changed on an update                                                                             |
| Role checks exist on most admin mutations                                                                                                      | Some mutations have **no role check** (clients, debts, exchange, OMT, sales:process) — anyone logged in can execute                           |

---

## 3. Proposed Schema

```sql
CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  username      TEXT NOT NULL,              -- denormalized for fast reads
  role          TEXT NOT NULL,              -- 'admin' | 'staff'
  action        TEXT NOT NULL,              -- 'create' | 'update' | 'delete' | 'refund' | 'void' | 'login' | 'logout' | 'restore' | 'settle' | 'toggle'
  entity_type   TEXT NOT NULL,              -- 'product' | 'sale' | 'client' | 'expense' | 'rate' | 'setting' | ...
  entity_id     TEXT,                       -- PK of affected row (nullable for bulk ops)
  summary       TEXT NOT NULL,              -- human-readable: "Changed price of Coca-Cola from $1.00 to $1.50"
  old_values    TEXT,                       -- JSON snapshot of changed fields before
  new_values    TEXT,                       -- JSON snapshot of changed fields after
  metadata      TEXT,                       -- extra context JSON (e.g. sale total, item count)
  ip_address    TEXT,                       -- future: if multi-terminal
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_action ON audit_log(action);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);
```

**Migration version:** 54

---

## 4. Complete Mutation Inventory by Module

### 4.1 AUTH — User Management

| Channel              | Action   | Entity Type | What to Log                                            |
| -------------------- | -------- | ----------- | ------------------------------------------------------ |
| `auth:login`         | `login`  | `session`   | User logged in                                         |
| `auth:logout`        | `logout` | `session`   | User logged out                                        |
| `users:create`       | `create` | `user`      | New user created (username, role)                      |
| `users:set-active`   | `update` | `user`      | User activated/deactivated — old_values: `{is_active}` |
| `users:set-role`     | `update` | `user`      | Role changed — old/new: `{role}`                       |
| `users:set-password` | `update` | `user`      | Password changed (no values logged)                    |

### 4.2 SALES (POS)

| Channel              | Action   | Entity Type | What to Log                                                    |
| -------------------- | -------- | ----------- | -------------------------------------------------------------- |
| `sales:process`      | `create` | `sale`      | Sale created — total, item count, client, payment method, user |
| `sales:delete-draft` | `delete` | `sale`      | Draft deleted                                                  |
| `sales:refund`       | `refund` | `sale`      | Full refund — sale ID, total refunded, reason                  |
| `sales:refund-item`  | `refund` | `sale_item` | Partial refund — item, qty, amount                             |

### 4.3 INVENTORY

| Channel                             | Action   | Entity Type        | What to Log                                                      |
| ----------------------------------- | -------- | ------------------ | ---------------------------------------------------------------- |
| `inventory:create-product`          | `create` | `product`          | Product created — name, price, cost, barcode, category           |
| `inventory:update-product`          | `update` | `product`          | **old/new diff** — especially `sell_price`, `cost_price`, `name` |
| `inventory:batch-update`            | `update` | `product`          | Batch update — list of product IDs + changed fields              |
| `inventory:delete-product`          | `delete` | `product`          | Product deleted — name, barcode (snapshot in old_values)         |
| `inventory:batch-delete`            | `delete` | `product`          | Batch delete — list of product names/IDs                         |
| `inventory:adjust-stock`            | `update` | `product`          | Stock adjusted — product, old qty, new qty, reason               |
| `inventory:create-category`         | `create` | `product_category` | Category created                                                 |
| `inventory:update-category`         | `update` | `product_category` | Category renamed                                                 |
| `inventory:delete-category`         | `delete` | `product_category` | Category deleted                                                 |
| `inventory:create-product-supplier` | `create` | `product_supplier` | Supplier link created                                            |
| `inventory:update-product-supplier` | `update` | `product_supplier` | Supplier link updated                                            |
| `inventory:delete-product-supplier` | `delete` | `product_supplier` | Supplier link deleted                                            |

### 4.4 CLIENTS

| Channel          | Action   | Entity Type | What to Log                    |
| ---------------- | -------- | ----------- | ------------------------------ |
| `clients:create` | `create` | `client`    | Client created — name, phone   |
| `clients:update` | `update` | `client`    | Client updated — old/new diff  |
| `clients:delete` | `delete` | `client`    | Client deleted — name snapshot |

> **Security gap:** No role check. Any staff can delete clients.

### 4.5 DEBTS

| Channel              | Action   | Entity Type   | What to Log                                          |
| -------------------- | -------- | ------------- | ---------------------------------------------------- |
| `debt:add-repayment` | `create` | `debt_ledger` | Repayment — client, amount, currency, payment method |

> **Security gap:** No role check.

### 4.6 EXCHANGE

| Channel                    | Action   | Entity Type            | What to Log                                     |
| -------------------------- | -------- | ---------------------- | ----------------------------------------------- |
| `exchange:add-transaction` | `create` | `exchange_transaction` | Exchange — from/to currency, amounts, rate used |

> **Security gap:** No role check.

### 4.7 OMT / WHISH / Financial Services

| Channel               | Action   | Entity Type         | What to Log                                                      |
| --------------------- | -------- | ------------------- | ---------------------------------------------------------------- |
| `omt:add-transaction` | `create` | `financial_service` | Service transaction — type, provider, amount, commission, client |

> **Security gap:** No role check.

### 4.8 RECHARGE (MTC/Alfa)

| Channel               | Action   | Entity Type | What to Log                                              |
| --------------------- | -------- | ----------- | -------------------------------------------------------- |
| `recharge:process`    | `create` | `recharge`  | Recharge sold — provider, denomination, quantity, amount |
| `recharge:top-up`     | `create` | `recharge`  | Stock top-up — provider, amount (admin only)             |
| `recharge:top-up-app` | `create` | `recharge`  | App top-up — provider, amount (admin only)               |

### 4.9 EXPENSES

| Channel             | Action   | Entity Type | What to Log                                   |
| ------------------- | -------- | ----------- | --------------------------------------------- |
| `db:add-expense`    | `create` | `expense`   | Expense added — description, amount, category |
| `db:delete-expense` | `delete` | `expense`   | Expense deleted — snapshot                    |

### 4.10 CUSTOM SERVICES

| Channel                  | Action   | Entity Type      | What to Log                              |
| ------------------------ | -------- | ---------------- | ---------------------------------------- |
| `custom-services:add`    | `create` | `custom_service` | Service added — name, cost, sell, client |
| `custom-services:delete` | `delete` | `custom_service` | Service deleted — snapshot               |

### 4.11 MAINTENANCE

| Channel              | Action            | Entity Type   | What to Log                              |
| -------------------- | ----------------- | ------------- | ---------------------------------------- |
| `maintenance:save`   | `create`/`update` | `maintenance` | Job saved — client, device, status, cost |
| `maintenance:delete` | `delete`          | `maintenance` | Job deleted — snapshot                   |

### 4.12 LOTO (All admin-only)

| Channel                           | Action   | Entity Type        | What to Log                              |
| --------------------------------- | -------- | ------------------ | ---------------------------------------- |
| `loto:sell`                       | `create` | `loto_ticket`      | Ticket sold — game, numbers, amount      |
| `loto:update`                     | `update` | `loto_ticket`      | Ticket updated — old/new diff            |
| `loto:checkpoint:create`          | `create` | `loto_checkpoint`  | Checkpoint created — amounts             |
| `loto:checkpoint:settle`          | `settle` | `loto_checkpoint`  | Checkpoint settled — commission, balance |
| `loto:cash-prize:create`          | `create` | `loto_cash_prize`  | Cash prize logged — amount               |
| `loto:cash-prize:mark-reimbursed` | `update` | `loto_cash_prize`  | Prize marked reimbursed                  |
| `loto:fees:create`                | `create` | `loto_monthly_fee` | Monthly fee created                      |
| `loto:fees:pay`                   | `update` | `loto_monthly_fee` | Fee marked paid                          |
| `loto:settings:update`            | `update` | `loto_settings`    | Settings changed — old/new               |

### 4.13 SUPPLIERS

| Channel                         | Action   | Entity Type       | What to Log                         |
| ------------------------------- | -------- | ----------------- | ----------------------------------- |
| `suppliers:create`              | `create` | `supplier`        | Supplier created — name             |
| `suppliers:add-ledger-entry`    | `create` | `supplier_ledger` | Ledger entry — amount, type, notes  |
| `suppliers:settle-transactions` | `settle` | `supplier`        | Transactions settled — count, total |

### 4.14 TRANSACTIONS (Admin)

| Channel               | Action   | Entity Type   | What to Log                             |
| --------------------- | -------- | ------------- | --------------------------------------- |
| `transactions:void`   | `void`   | `transaction` | Transaction voided — ID, amount, reason |
| `transactions:refund` | `refund` | `transaction` | Transaction refunded — ID, amount       |

### 4.15 RATES

| Channel        | Action   | Entity Type     | What to Log                                      |
| -------------- | -------- | --------------- | ------------------------------------------------ |
| `rates:set`    | `update` | `exchange_rate` | Rate changed — currency pair, old rate, new rate |
| `rates:delete` | `delete` | `exchange_rate` | Rate deleted                                     |

### 4.16 SETTINGS & CONFIGURATION

| Channel                                 | Action   | Entity Type       | What to Log                                 |
| --------------------------------------- | -------- | ----------------- | ------------------------------------------- |
| `settings:update` / `db:update-setting` | `update` | `setting`         | Setting changed — key, old value, new value |
| `currencies:create`                     | `create` | `currency`        | Currency added                              |
| `currencies:update`                     | `update` | `currency`        | Currency updated                            |
| `currencies:delete`                     | `delete` | `currency`        | Currency deleted                            |
| `currencies:setModules`                 | `update` | `currency_module` | Module currencies changed                   |
| `currencies:setDrawerCurrencies`        | `update` | `currency_drawer` | Drawer currencies changed                   |
| `modules:setEnabled`                    | `toggle` | `module`          | Module enabled/disabled                     |
| `modules:bulkSetEnabled`                | `toggle` | `module`          | Bulk module toggle                          |
| `payment-methods:create`                | `create` | `payment_method`  | Payment method added                        |
| `payment-methods:update`                | `update` | `payment_method`  | Payment method updated                      |
| `payment-methods:delete`                | `delete` | `payment_method`  | Payment method deleted                      |
| `payment-methods:reorder`               | `update` | `payment_method`  | Payment methods reordered                   |

### 4.17 CLOSING

| Channel                               | Action   | Entity Type            | What to Log                                 |
| ------------------------------------- | -------- | ---------------------- | ------------------------------------------- |
| `closing:create-daily-closing`        | `create` | `daily_closing`        | Day closed — date, discrepancies            |
| `closing:update-daily-closing`        | `update` | `daily_closing`        | Closing updated                             |
| `closing:set-opening-balances`        | `create` | `daily_closing_amount` | Opening balances set — amounts per currency |
| `closing:recalculate-drawer-balances` | `update` | `drawer_balance`       | Balances recalculated                       |

### 4.18 MOBILE SERVICE ITEMS

| Channel                              | Action   | Entity Type           | What to Log                                     |
| ------------------------------------ | -------- | --------------------- | ----------------------------------------------- |
| `mobile-service-items:create`        | `create` | `mobile_service_item` | Item created — provider, label, cost, sell      |
| `mobile-service-items:update`        | `update` | `mobile_service_item` | Item updated — old/new diff (especially prices) |
| `mobile-service-items:toggle-active` | `toggle` | `mobile_service_item` | Item activated/deactivated                      |
| `mobile-service-items:delete`        | `delete` | `mobile_service_item` | Item deleted — snapshot                         |
| `mobile-service-items:seed`          | `create` | `mobile_service_item` | Bulk seed — count of items                      |

### 4.19 CUSTOMER SESSIONS

| Channel                   | Action   | Entity Type                    | What to Log                      |
| ------------------------- | -------- | ------------------------------ | -------------------------------- |
| `session:start`           | `create` | `customer_session`             | Session started — customer       |
| `session:update`          | `update` | `customer_session`             | Session updated                  |
| `session:close`           | `update` | `customer_session`             | Session closed — duration, total |
| `session:linkTransaction` | `create` | `customer_session_transaction` | Transaction linked to session    |

### 4.20 BACKUP & SYSTEM

| Channel                              | Action    | Entity Type | What to Log                                  |
| ------------------------------------ | --------- | ----------- | -------------------------------------------- |
| `backup:create` / `report:backup-db` | `create`  | `backup`    | Backup created — path                        |
| `backup:delete`                      | `delete`  | `backup`    | Backup deleted — filename                    |
| `backup:setDir`                      | `update`  | `setting`   | Backup directory changed                     |
| `report:restore-db`                  | `restore` | `backup`    | **CRITICAL** — Database restored from backup |
| `updater:download`                   | `update`  | `system`    | Update downloaded                            |
| `updater:quit-and-install`           | `update`  | `system`    | Update installed — version                   |
| `setup:complete`                     | `create`  | `system`    | Initial setup completed                      |

### 4.21 OTHER

| Channel                 | Action    | Entity Type     | What to Log                            |
| ----------------------- | --------- | --------------- | -------------------------------------- |
| `item-costs:set`        | `update`  | `item_cost`     | Item cost changed — old/new            |
| `voucher-images:set`    | `update`  | `voucher_image` | Voucher image set                      |
| `voucher-images:delete` | `delete`  | `voucher_image` | Voucher image deleted                  |
| `voicebot:execute`      | `execute` | `voicebot`      | Voice command executed — parsed intent |

---

## 5. Implementation Strategy

### 5.1 Backend — AuditService + AuditRepository

```
packages/core/src/repositories/AuditRepository.ts
packages/core/src/services/AuditService.ts
```

**AuditService API:**

```typescript
interface AuditEntry {
  userId: number;
  username: string;
  role: string;
  action:
    | "create"
    | "update"
    | "delete"
    | "refund"
    | "void"
    | "login"
    | "logout"
    | "restore"
    | "settle"
    | "toggle"
    | "execute";
  entityType: string;
  entityId?: string;
  summary: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

class AuditService {
  log(entry: AuditEntry): void; // fire-and-forget, never throws
  getRecent(limit: number): AuditLog[];
  getByUser(userId: number, limit: number): AuditLog[];
  getByEntity(entityType: string, entityId: string): AuditLog[];
  getByDateRange(from: string, to: string): AuditLog[];
  search(filters: AuditFilters): AuditLog[];
}
```

### 5.2 Integration Point — IPC Handlers

Each handler calls `auditService.log()` **after** the successful mutation. The `requireRole()` result already provides `userId`, `username`, and `role`. For handlers without role checks, we pull user info from session.

**Example — inventory price change:**

```typescript
ipcMain.handle("inventory:update-product", async (e, id, data) => {
  const auth = requireRole(e.sender.id, ["admin"]);
  if (!auth.ok) throw new Error(auth.error);

  const service = getInventoryService();
  const oldProduct = service.getById(id); // snapshot before
  const updated = service.updateProduct(id, data); // perform mutation

  auditService.log({
    userId: auth.user.id,
    username: auth.user.username,
    role: auth.user.role,
    action: "update",
    entityType: "product",
    entityId: String(id),
    summary: `Updated product "${updated.name}"`,
    oldValues: {
      sell_price: oldProduct.sell_price,
      cost_price: oldProduct.cost_price,
      name: oldProduct.name,
    },
    newValues: {
      sell_price: updated.sell_price,
      cost_price: updated.cost_price,
      name: updated.name,
    },
  });

  return { success: true, result: updated };
});
```

### 5.3 Helper — Diff Utility

```typescript
// packages/core/src/utils/audit.ts
export function diffObjects(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  keys: string[],
): {
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
} | null {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  let hasChanges = false;

  for (const key of keys) {
    if (oldObj[key] !== newObj[key]) {
      oldValues[key] = oldObj[key];
      newValues[key] = newObj[key];
      hasChanges = true;
    }
  }

  return hasChanges ? { oldValues, newValues } : null;
}
```

### 5.4 Frontend — Audit Log Viewer

Replace the existing `ActivityLogViewer` in Settings with a full audit log viewer:

- Filterable by: user, action type, entity type, date range
- Searchable by summary text
- Expandable rows showing old/new value diffs
- Color-coded actions (red for deletes/refunds, orange for updates, green for creates)
- Export to CSV

### 5.5 IPC Handlers for Audit

```
audit:get-recent       — admin only
audit:get-by-user      — admin only
audit:get-by-entity    — admin only
audit:search           — admin only
```

---

## 6. Security Gaps to Fix Alongside

These mutations currently have **no role check** — any authenticated user (including trainees) can execute them:

| Channel                       | Risk                             | Recommendation               |
| ----------------------------- | -------------------------------- | ---------------------------- |
| `clients:delete`              | Staff can delete clients         | Add `requireRole(["admin"])` |
| `clients:update`              | Staff can edit client data       | Keep open but **audit**      |
| `clients:create`              | Low risk                         | Keep open but **audit**      |
| `debt:add-repayment`          | Staff can record fake repayments | Keep open but **audit**      |
| `exchange:add-transaction`    | Staff can process exchanges      | Keep open but **audit**      |
| `omt:add-transaction`         | Staff can process OMT/Whish      | Keep open but **audit**      |
| `sales:process`               | Staff can make sales (intended)  | Keep open but **audit**      |
| `sales:delete-draft`          | Staff can delete drafts          | Keep open but **audit**      |
| `item-costs:set`              | Staff can change item costs      | Add `requireRole(["admin"])` |
| `voucher-images:set/delete`   | Low risk                         | Keep open but **audit**      |
| `backup:create/delete/setDir` | Staff can delete backups         | Add `requireRole(["admin"])` |
| `session:*`                   | Customer session management      | Keep open but **audit**      |

---

## 7. Implementation Order

| Phase                                | Work                                                                                                         | Effort     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ---------- |
| **Phase 1 — Foundation**             | Migration v54 (`audit_log` table), AuditRepository, AuditService, diff utility                               | 1 session  |
| **Phase 2 — Critical Handlers**      | Wire audit into: `sales:*`, `inventory:*` (price changes), `auth:*`, `transactions:void/refund`, `rates:set` | 1 session  |
| **Phase 3 — All Remaining Handlers** | Wire audit into all other mutation handlers (34 handler files, ~90 mutation channels)                        | 2 sessions |
| **Phase 4 — Frontend Viewer**        | Audit Log Viewer page in Settings (replaces ActivityLogViewer), filters, search, CSV export                  | 1 session  |
| **Phase 5 — Security Hardening**     | Add missing role checks, review session expiry                                                               | 1 session  |

**Total estimated: 5-6 sessions**

---

## 8. Performance Considerations

- `auditService.log()` is **synchronous SQLite insert** — fast (< 1ms per insert)
- Never block the mutation response on audit failure — wrap in try/catch, log error but don't propagate
- Add `created_at` index for time-range queries
- Consider pruning old audit logs (> 1 year) or archiving to file
- JSON columns (`old_values`, `new_values`, `metadata`) are TEXT — no need for JSON1 extension, just `JSON.stringify/parse`

---

## 9. Open Questions

1. **Retention policy** — How long to keep audit logs? 6 months? 1 year? Forever?
2. **Trainee role** — Should we add a `"trainee"` role distinct from `"staff"` for stricter monitoring?
3. **Real-time alerts** — Should certain actions (e.g., refunds, price changes, deletions) trigger immediate notifications to admin?
4. **Multi-terminal** — If multiple terminals are planned, should we track terminal/device ID?
5. **Print/export** — Should audit logs be exportable as PDF reports for the shop owner?
