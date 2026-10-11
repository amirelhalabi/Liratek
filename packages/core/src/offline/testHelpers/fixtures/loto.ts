/** Loto family fixtures (band 12 → ids 12001…). Convention: ../bindingFixtures.ts */
import type { BindingFixture } from "../bindingFixtures";

export const FIXTURES: readonly BindingFixture[] = [
  {
    channel: "loto:sell",
    seedSql: `-- server rate = the harness's default recorded rate (replayHarness RATES), so online and replay convert alike
      UPDATE exchange_rates SET sell_rate = 90000, buy_rate = 89500, market_rate = 89750 WHERE tenant_id = 1 AND to_code = 'LBP';
      INSERT INTO clients (id, tenant_id, full_name) VALUES (12001, 1, 'Loto Client');
      INSERT INTO loto_tickets (id, tenant_id, ticket_number, sale_amount, commission_rate, commission_amount, sale_date, currency, created_at)
        VALUES (12001, 1, 'T-1', 500000, 0.0445, 22250, '2026-10-09', 'LBP', '2026-10-09 10:00:00');`,
    payload: { ticket_number: "T-2", sale_amount: 500000, currency: "LBP", payment_method: "CASH" },
  },
  {
    // on account → Loto Debt on the client's ledger
    channel: "loto:sell",
    payload: {
      sale_amount: 300000,
      currency: "LBP",
      clientId: 12001,
      payments: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 300000 }],
    },
  },
  { channel: "loto:update", payload: { id: 12001, ticket_number: "T-1B", note: "ticket edited" } },
  { channel: "loto:cash-prize:create", payload: { ticket_number: "T-1B", prize_amount: 200000 } },
  { channel: "loto:update-metadata", payload: { id: 12001, note: "edited offline" } },
];
