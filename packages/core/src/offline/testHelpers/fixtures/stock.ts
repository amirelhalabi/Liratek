/** Stock family fixtures (band 13 → ids 13001…). Convention: ../bindingFixtures.ts */
import type { BindingFixture } from "../bindingFixtures";

export const FIXTURES: readonly BindingFixture[] = [
  {
    // receive with a linked supplier → a STOCK_INTAKE supplier-ledger debit + a cost batch
    channel: "inventory:receive-stock",
    seedSql: `INSERT INTO suppliers (id, tenant_id, name, created_at) VALUES (13001, 1, 'Stock Fixture Supplier', '2026-10-09 10:00:00');
      INSERT INTO product_suppliers (id, tenant_id, name, supplier_id, created_at) VALUES (13001, 1, 'Stock Fixture Supplier', 13001, '2026-10-09 10:00:00');
      INSERT INTO products (id, tenant_id, barcode, name, item_type, cost_price_usd, selling_price_usd, stock_quantity, created_at)
        VALUES (13001, 1, 'FIX-13001', 'Fixture Cable', 'Product', 2, 5, 10, '2026-10-09 10:00:00');
      INSERT INTO products (id, tenant_id, barcode, name, item_type, cost_price_usd, selling_price_usd, stock_quantity, created_at)
        VALUES (13002, 1, 'FIX-13002', 'Fixture Phone', 'Product', 300, 400, 1, '2026-10-09 10:00:00');
      INSERT INTO product_units (id, tenant_id, product_id, imei, status, created_at, updated_at)
        VALUES (13001, 1, 13002, '350000000013001', 'IN_STOCK', '2026-10-09 10:00:00', '2026-10-09 10:00:00');
      INSERT INTO transactions (id, tenant_id, type, source_table, source_id, user_id, amount_usd, amount_lbp, created_at)
        VALUES (13001, 1, 'SUPPLIER_RECORDED_DEBT', 'supplier_ledger', 13001, 1, 60, 0, '2026-10-09 10:00:00');
      INSERT INTO supplier_ledger (id, tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id, created_at)
        VALUES (13001, 1, 13001, 'RECORDED_DEBT', 60, 0, 'seeded recorded debt', 1, 13001, '2026-10-09 10:00:00');`,
    payload: { product_id: 13001, quantity: 5, unit_cost_usd: 3, supplier: "Stock Fixture Supplier", reason: "Delivery" },
  },
  {
    // attach the delivery to the supplier's already-recorded open debt (no second debit)
    channel: "inventory:receive-stock",
    payload: { product_id: 13001, quantity: 4, unit_cost_usd: 15, supplier: "Stock Fixture Supplier", attach_to_recorded_debt_id: 13001 },
  },
  {
    // a decrease is shrinkage: consumes the cost batches FIFO
    channel: "inventory:adjust-stock",
    payload: { id: 13001, delta: -2, reason: "Broken in shop" },
  },
  {
    // absolute count above the current stock: an increase
    channel: "inventory:adjust-stock",
    payload: { id: 13001, newQuantity: 20, reason: "Recount" },
  },
  {
    channel: "product-units:register",
    payload: { product_id: 13002, imeis: ["350000000013002", "350000000013003"] },
  },
  {
    channel: "product-units:delete",
    payload: { id: 13001 },
  },
];
