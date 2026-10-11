/**
 * LIRA-306 T098 — stock family: `inventory:adjust-stock`,
 * `inventory:receive-stock` (incl. attaching a delivery to a recorded supplier
 * debt — the supplier-ledger side effect goes through the same service),
 * `product-units:register`, `product-units:delete`. Replayed through the
 * ReplayEngine they book exactly what the services the REST routes call book
 * online (backend/src/api/inventory.ts → InventoryService.adjustStock /
 * adjustStockDelta / receiveStock; backend/src/api/productUnits.ts →
 * ProductUnitService.registerUnits / deleteUnit), on the event's own day.
 * No USD/LBP conversion in this family (costs are USD) → no recorded-rate test.
 */
import { stockAdjustSchema, receiveStockSchema } from "../../../validators/inventory";
import { registerProductUnitsSchema, productUnitIdSchema } from "../../../validators/productUnit";
import { recordedSchema } from "../../channelPolicy";
import { runOnline, runReplay, closeDb, tableState, daysOf, MONEY_TABLES, type Step } from "../../testHelpers/familyParity";
import { FIXTURES } from "../../testHelpers/fixtures/stock";

const MOD = require.resolve("../stock");
const NAME = "STOCK_BINDINGS";
const STOCK_TABLES = ["products", "product_units", "stock_adjustments", "product_stock_batches", "stock_batch_consumptions"];
const TABLES = [...MONEY_TABLES, ...STOCK_TABLES, "suppliers", "product_suppliers"];
// the harness records LBP market 89750 (sell 90000); align the server row so
// createTransaction's market-rate snapshot is the same online and replayed
const ALIGN_RATE = `UPDATE exchange_rates SET sell_rate = 90000, buy_rate = 89500, market_rate = 89750 WHERE tenant_id = 1 AND to_code = 'LBP';`;
const seedSql = [ALIGN_RATE, ...FIXTURES.map((f) => f.seedSql ?? "")].join("\n");
const steps: Step[] = FIXTURES.map((f) => ({ channel: f.channel, payload: f.payload }));

describe("stock bindings (T098)", () => {
  it("record with the routes' schema objects", () => {
    expect(recordedSchema("inventory:adjust-stock")).toBe(stockAdjustSchema);
    expect(recordedSchema("inventory:receive-stock")).toBe(receiveStockSchema);
    expect(recordedSchema("product-units:register")).toBe(registerProductUnitsSchema);
    expect(recordedSchema("product-units:delete")).toBe(productUnitIdSchema);
  });

  it("replay == online, per table (stock, batches, supplier ledger, unified rows)", async () => {
    const on = await runOnline({ bindingsModule: MOD, exportName: NAME, seedSql, steps });
    expect(on.results.map((r) => [r.success, r.error])).toEqual(steps.map(() => [true, undefined]));
    const expected = tableState(on.db, TABLES);
    // not vacuous: the intake booked one new debit and attached the recorded one; the shrinkage consumed a batch
    expect(expected.supplier_ledger).toHaveLength(2);
    expect(expected.product_stock_batches.length).toBeGreaterThanOrEqual(2);
    expect(expected.stock_batch_consumptions.length).toBeGreaterThanOrEqual(1);
    expect(expected.product_units).toHaveLength(2);
    closeDb(on.db);

    const off = await runReplay({ bindingsModule: MOD, exportName: NAME, seedSql, steps });
    expect(off.outcomes.map((o) => [o.status, o.error ?? null])).toEqual(steps.map(() => ["booked", null]));
    expect(tableState(off.db, TABLES)).toEqual(expected);
    closeDb(off.db);
  });

  it("23:50 on day N, sent on day N+1 → every row on day N (no transaction_time)", async () => {
    const off = await runReplay({
      bindingsModule: MOD,
      exportName: NAME,
      seedSql,
      steps,
      occurredAt: "2026-10-01T20:50:00.000Z", // 23:50 Beirut
      clientDay: "2026-10-01",
      clientTzOffsetMinutes: 180,
    });
    expect(off.outcomes.map((o) => o.status)).toEqual(steps.map(() => "booked"));
    for (const t of ["stock_adjustments", "product_stock_batches", "stock_batch_consumptions", "product_units", "transactions"]) {
      expect({ t, days: daysOf(off.db, t, "created_at", "id <> 13001") }).toEqual({ t, days: ["2026-10-01"] });
    }
    // supplier_ledger (STOCK_INTAKE created_at, RECORDED_DEBT attached_at) is
    // written by SupplierRepository — not this family's sweep; see the report.
    closeDb(off.db);
  });

  it("stock moves are credited to the event's actor, never a payload field", async () => {
    const off = await runReplay({ bindingsModule: MOD, exportName: NAME, seedSql, steps, actorUserId: 1 });
    const users = (sql: string) => (off.db.prepare(sql).all() as { u: number | null }[]).map((r) => r.u);
    expect(new Set(users(`SELECT user_id AS u FROM stock_adjustments`))).toEqual(new Set([1]));
    expect(new Set(users(`SELECT created_by AS u FROM product_stock_batches`))).toEqual(new Set([1]));
    expect(users(`SELECT created_by AS u FROM supplier_ledger WHERE entry_type = 'STOCK_INTAKE'`)).toEqual([1]);
    closeDb(off.db);
  });
});
