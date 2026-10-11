/** `sales:process` fixture (sales band 3 → ids 3001…; the rest of the sales
 *  family is Agent B's module). Convention: ../bindingFixtures.ts */
import type { BindingFixture } from "../bindingFixtures";

export const FIXTURES: readonly BindingFixture[] = [
  {
    channel: "sales:process",
    seedSql: `INSERT INTO products (id, tenant_id, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity)
      VALUES (3001, 1, 'Fixture Cable 3001', 'Product', 'General', 2, 5, 20);`,
    payload: {
      client_id: null,
      items: [{ product_id: 3001, quantity: 1, price: 5 }],
      total_amount: 5,
      discount: 0,
      final_amount: 5,
      payment_usd: 5,
      payment_lbp: 0,
      payments: [{ method: "CASH", currency_code: "USD", amount: 5 }],
      exchange_rate: 89500,
      status: "completed",
    },
  },
];
