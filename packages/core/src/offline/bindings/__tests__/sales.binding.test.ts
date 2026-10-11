/**
 * LIRA-306 T038 — `sales:process` replayed through the ReplayEngine books
 * exactly what `getSalesService().processSale` (what POST /api/sales/process
 * calls) books online: same drawers, payment lines, stock, profit and debt,
 * per currency (SC-001). Two fresh databases, one action each.
 */
import type Database from "better-sqlite3";
import type { z } from "zod";
import { runWithTenant } from "../../../db/tenantContext";
import { saleProcessSchema } from "../../../validators/sale";
import { recordedSchema } from "../../channelPolicy";
import { getOfflineBinding } from "../index";
import { ReplayEngine } from "../../ReplayEngine";
import { getSalesService, resetSalesService } from "../../../services/SalesService";
import { resetSalesRepository } from "../../../repositories/SalesRepository";
import { resetTransactionRepository } from "../../../repositories/TransactionRepository";
import { resetStockBatchRepository } from "../../../repositories/StockBatchRepository";
import { installReplayDb, uninstallReplayDb, storeEvent, resetSeq } from "../../testHelpers/replayHarness";
import { moneyState } from "../../testHelpers/parity";

type SaleInput = z.input<typeof saleProcessSchema>;

function resetSingletons(): void {
  resetSalesService();
  resetSalesRepository();
  resetTransactionRepository();
  resetStockBatchRepository();
}

function seed(db: Database.Database): void {
  db.exec(`
    UPDATE exchange_rates SET market_rate = 89750, buy_rate = 89500, sell_rate = 90000 WHERE tenant_id = 1 AND to_code = 'LBP';
    INSERT INTO products (id, tenant_id, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity)
      VALUES (33, 1, 'Cable', 'Product', 'General', 2, 5, 10);
    INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (7, 1, 'Rami', '70123456');
  `);
}

const SCENARIOS: Array<[string, SaleInput]> = [
  [
    "cash USD",
    {
      client_id: null,
      items: [{ product_id: 33, quantity: 2, price: 5 }],
      total_amount: 10,
      discount: 0,
      final_amount: 10,
      payment_usd: 10,
      payment_lbp: 0,
      payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
      exchange_rate: 90000,
      status: "completed",
      client_day: "2026-10-10",
    } as SaleInput,
  ],
  [
    "LBP leg",
    {
      client_id: null,
      items: [{ product_id: 33, quantity: 1, price: 5 }],
      total_amount: 5,
      discount: 0,
      final_amount: 5,
      payment_usd: 0,
      payment_lbp: 450000,
      payments: [{ method: "CASH", currency_code: "LBP", amount: 450000 }],
      exchange_rate: 90000,
      status: "completed",
      client_day: "2026-10-10",
    } as SaleInput,
  ],
  [
    "customer account",
    {
      client_id: 7,
      items: [{ product_id: 33, quantity: 3, price: 5 }],
      total_amount: 15,
      discount: 0,
      final_amount: 15,
      payment_usd: 0,
      payment_lbp: 0,
      payments: [{ method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 15 }],
      exchange_rate: 90000,
      status: "completed",
      client_day: "2026-10-10",
    } as SaleInput,
  ],
];

describe("sales:process binding parity (SC-001)", () => {
  it("validates with the route's schema object", () => {
    expect(recordedSchema("sales:process")).toBe(saleProcessSchema);
    expect(getOfflineBinding("sales:process")).toBeDefined();
  });

  it.each(SCENARIOS)("%s — replay equals online", async (_name, sale) => {
    // online
    resetSingletons();
    const online = installReplayDb();
    seed(online.db);
    const res = runWithTenant(1, () => getSalesService().processSale(saleProcessSchema.parse(sale) as never, 2), {
      clientDay: "2026-10-10",
    });
    expect(res.success).toBe(true);
    const expected = moneyState(online.db);
    uninstallReplayDb(online.db);

    // replay
    resetSingletons();
    resetSeq();
    const offline = installReplayDb();
    seed(offline.db);
    const row = storeEvent({ deviceId: offline.deviceId, channel: "sales:process", payload: sale as Record<string, unknown> });
    const out = await runWithTenant(1, () => new ReplayEngine().process(row, { mode: "auto" }));
    expect(out.status).toBe("booked");
    expect(moneyState(offline.db)).toEqual(expected);
    uninstallReplayDb(offline.db);
  });
});
