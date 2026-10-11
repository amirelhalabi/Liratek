/** `debt:add-repayment` fixture (debts band 7 → ids 7001…; the rest of the
 *  debts family is Agent B's module). Convention: ../bindingFixtures.ts */
import type { BindingFixture } from "../bindingFixtures";

export const FIXTURES: readonly BindingFixture[] = [
  {
    channel: "debt:add-repayment",
    seedSql: `
      INSERT INTO clients (id, tenant_id, full_name, phone_number, created_at)
        VALUES (7001, 1, 'Seeded Debtor 7001', '70007001', '2026-10-09 10:00:00');
      INSERT INTO debt_ledger (id, tenant_id, client_id, transaction_type, amount_usd, amount_lbp, note, created_by, created_at)
        VALUES (7001, 1, 7001, 'Manual Debt', 10, 0, 'seeded', 1, '2026-10-09 10:00:00');`,
    payload: { clientId: 7001, amountUSD: 5, payments: [{ method: "CASH", currencyCode: "USD", amount: 5 }] },
  },
];
