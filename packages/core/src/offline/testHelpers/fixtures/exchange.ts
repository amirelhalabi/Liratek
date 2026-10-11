/** Exchange family fixtures (band 9 → ids 9001…). Convention: ../bindingFixtures.ts */
import type { BindingFixture } from "../bindingFixtures";

export const FIXTURES: readonly BindingFixture[] = [
  {
    channel: "exchange:add-transaction",
    seedSql: `INSERT INTO exchange_transactions (id, tenant_id, type, from_currency, to_currency, amount_in, amount_out, rate, base_rate, profit_usd, note, created_at)
      VALUES (9001, 1, 'BUY', 'USD', 'LBP', 10, 895000, 89500, 89750, 0.03, 'seeded', '2026-10-09 10:00:00');`,
    payload: {
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 100,
      amountOut: 8950000,
      leg1Rate: 89500,
      leg1MarketRate: 89750,
      leg1ProfitUsd: 0.28,
      totalProfitUsd: 0.28,
      clientName: "Walk-in",
    },
  },
  {
    channel: "exchange:add-transaction",
    payload: {
      fromCurrency: "EUR",
      toCurrency: "USD",
      amountIn: 50,
      amountOut: 54,
      leg1Rate: 1.08,
      leg1MarketRate: 1.1,
      leg1ProfitUsd: 1,
      totalProfitUsd: 1,
    },
  },
  {
    // sells part of the EUR lot just bought → a FIFO settlement row
    channel: "exchange:add-transaction",
    payload: {
      fromCurrency: "USD",
      toCurrency: "EUR",
      amountIn: 22,
      amountOut: 20,
      leg1Rate: 0.909,
      leg1MarketRate: 0.92,
      leg1ProfitUsd: 0.3,
      totalProfitUsd: 0.3,
    },
  },
  {
    channel: "exchange:update-metadata",
    payload: { id: 9001, note: "edited offline", client_name: "Rami" },
  },
];
