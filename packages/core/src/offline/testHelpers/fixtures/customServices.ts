/** Custom-services family fixtures (band 11 → ids 11001…). Convention: ../bindingFixtures.ts */
import type { BindingFixture } from "../bindingFixtures";

export const FIXTURES: readonly BindingFixture[] = [
  {
    channel: "custom-services:add",
    seedSql: `-- server rate = the harness's default recorded rate (replayHarness RATES), so online and replay convert alike
      UPDATE exchange_rates SET sell_rate = 90000, buy_rate = 89500, market_rate = 89750 WHERE tenant_id = 1 AND to_code = 'LBP';
      INSERT INTO clients (id, tenant_id, full_name) VALUES (11001, 1, 'Custom Client');
      INSERT INTO custom_services (id, tenant_id, description, price_usd, paid_by, status, created_by, fulfillment_status, created_at)
        VALUES (11001, 1, 'Insurance policy', 0, 'CASH', 'completed', 1, 'ORDERED', '2026-10-09 10:00:00');
      -- 11002: a booked CASH sale ($1 cost, $6 price) exactly as addService writes it, so the delete's void reverses real money
      INSERT INTO custom_services (id, tenant_id, description, cost_usd, price_usd, paid_by, status, created_by, created_at)
        VALUES (11002, 1, 'Typing', 1, 6, 'CASH', 'completed', 1, '2026-10-09 10:05:00');
      -- 11003: a live insurance sale for "Won't renew" (LIRA-360)
      INSERT INTO custom_services (id, tenant_id, description, price_usd, paid_by, status, created_by, category, insurance_type, created_at)
        VALUES (11003, 1, 'Car insurance', 0, 'CASH', 'completed', 1, 'insurance', 'COMPULSORY', '2025-10-09 10:00:00');
      INSERT INTO transactions (id, tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, exchange_rate, profit_usd, profit_lbp, summary, metadata_json, created_at)
        VALUES (11001, 1, 'CUSTOM_SERVICE', 'ACTIVE', 'custom_services', 11002, 1, 6, 0, 89750, 5, 0, 'Custom Service: Typing',
          '{"cost_usd":1,"cost_lbp":0,"price_usd":6,"price_lbp":0,"paid_by":"CASH","direction":"IN"}', '2026-10-09 10:05:00');
      INSERT INTO payments (id, tenant_id, transaction_id, method, drawer_name, currency_code, amount, note, created_by, created_at)
        VALUES (11001, 1, 11001, 'CASH', 'General', 'USD', 6, 'Custom Service: Typing (price inflow)', 1, '2026-10-09 10:05:00');
      UPDATE drawer_balances SET balance = balance + 6 WHERE tenant_id = 1 AND drawer_name = 'General' AND currency_code = 'USD';`,
    payload: { description: "Photocopies", cost_usd: 1, price_usd: 4, paid_by: "CASH" },
  },
  {
    // on account → Custom Service Debt on the client's ledger
    channel: "custom-services:add",
    payload: { description: "CV printing", price_usd: 15, paid_by: "CUSTOMER_ACCOUNT", client_id: 11001 },
  },
  {
    channel: "custom-services:add",
    payload: { description: "Lamination", cost_lbp: 100000, price_lbp: 450000, paid_by: "CASH", kept_change_lbp: 0 },
  },
  { channel: "custom-services:delete", payload: { id: 11002 } },
  { channel: "custom-services:update-metadata", payload: { id: 11001, note: "edited offline", client_name: "Rami" } },
  { channel: "custom-services:advance-fulfillment", payload: { id: 11001, fulfillment_status: "ISSUED" } },
  { channel: "custom-services:set-work-status", payload: { id: 11001, work_status: "In_Progress" } },
  { channel: "custom-services:dismiss-insurance-renewal", payload: { id: 11003 } },
];
