/** Generic void/refund fixtures (band 2 → ids 2001…). Convention: ../bindingFixtures.ts */
import type { BindingFixture } from "../bindingFixtures";

export const FIXTURES: readonly BindingFixture[] = [
  {
    channel: "transactions:void",
    seedSql: `
      INSERT INTO expenses (id, tenant_id, description, category, paid_by_method, amount_usd, amount_lbp, expense_date, created_at)
        VALUES (2001, 1, 'Seeded expense 2001', 'General', 'CASH', 3, 0, '2026-10-09', '2026-10-09 10:00:00'),
               (2002, 1, 'Seeded expense 2002', 'General', 'CASH', 4, 0, '2026-10-09', '2026-10-09 10:00:00');
      INSERT INTO transactions (id, tenant_id, type, source_table, source_id, user_id, amount_usd, amount_lbp, summary, created_at)
        VALUES (2001, 1, 'EXPENSE', 'expenses', 2001, 1, 3, 0, 'Seeded expense 2001', '2026-10-09 10:00:00'),
               (2002, 1, 'EXPENSE', 'expenses', 2002, 1, 4, 0, 'Seeded expense 2002', '2026-10-09 10:00:00');
      INSERT INTO payments (id, tenant_id, transaction_id, method, drawer_name, currency_code, amount, created_by, created_at)
        VALUES (2001, 1, 2001, 'CASH', 'General', 'USD', -3, 1, '2026-10-09 10:00:00'),
               (2002, 1, 2002, 'CASH', 'General', 'USD', -4, 1, '2026-10-09 10:00:00');`,
    payload: { transactionId: 2001 },
  },
  {
    channel: "transactions:refund",
    payload: { transactionId: 2002 },
  },
];
