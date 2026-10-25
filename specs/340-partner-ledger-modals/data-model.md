# Data model: LIRA-340

No schema change.

- **partner_ledger** (existing): id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, notes, user_id, settlement_method, covered_amount, created_at, tenant_id.
- **LedgerFilters** (existing, extended): `startDate?`, `endDate?`, `type?`, `mode?`, `provider?`, `direction?`, **`group?: "transactions" | "payments"`** (new).
- **PARTNER_PAYMENT_ENTRY_TYPES** (new constant): `["SETTLEMENT", "DISCOUNT", "ADJUSTMENT"]`.
  - group = payments ⇔ `transaction_type ∈ PARTNER_PAYMENT_ENTRY_TYPES`
  - group = transactions ⇔ `transaction_type ∉` it, or NULL
