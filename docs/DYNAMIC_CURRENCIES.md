# Dynamic Currencies Implementation Plan

**Created:** 2026-02-15
**Updated:** 2026-02-15
**Status:** ✅ Complete (Phases 1–5, 7–9 shipped)
**Priority:** Done

---

## Summary

All planned phases have been implemented. The codebase now supports fully dynamic currencies, a configurable modules system, dynamic drawer–currency mapping, and the `window.api` layer has been reorganized into logical namespaces (`auth`, `expenses`, `inventory`, `clients`, `sales`, `dashboard`, `debt`, `financial`, `exchange`, `binance`, `omt`, `recharge`, `suppliers`, `maintenance`, etc.).

---

## Phase 6: Schema-Level Redesign (Future — Out of Current Scope)

The following tables have currencies baked into column names:

| Table                | Columns                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `sales`              | `total_amount_usd`, `paid_usd`, `paid_lbp`, `change_given_usd`, `change_given_lbp`               |
| `sale_items`         | `sold_price_usd`, `cost_price_snapshot_usd`                                                      |
| `expenses`           | `amount_usd`, `amount_lbp`                                                                       |
| `debt_ledger`        | `amount_usd`, `amount_lbp`                                                                       |
| `maintenance_orders` | `cost_usd`, `price_usd`, `paid_usd`, `paid_lbp`                                                  |
| `suppliers_ledger`   | `amount_usd`, `amount_lbp`                                                                       |
| `daily_closings`     | `opening_balance_usd/_lbp`, `physical_usd/_lbp/_eur`, `system_expected_usd/_lbp`, `variance_usd` |

To make these truly dynamic, each would need a normalized structure:

```sql
-- Instead of: amount_usd DECIMAL, amount_lbp DECIMAL
CREATE TABLE sale_payments (
  sale_id INTEGER, currency_code TEXT, amount DECIMAL,
  PRIMARY KEY (sale_id, currency_code)
);
```

> **This is a massive breaking change** affecting every query in every repository. It should only be done if the business genuinely needs >3 currencies in these tables. For now, the `payments` table (which IS flexible) handles multi-currency payments correctly.

---

## Testing

See [LOCAL_TESTS_CHECKLIST.md](LOCAL_TESTS_CHECKLIST.md) → Section 19: Dynamic Currencies & Modules.
