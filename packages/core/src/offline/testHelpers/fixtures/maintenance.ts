/**
 * Maintenance + warranty family fixtures (band 10 → ids 10001…).
 * Convention: ../bindingFixtures.ts.
 *
 * NOTE: `maintenance:delete` and `warranty:void-claim` are ADMIN-only channels
 * (the IPC handlers' requireRole + WarrantyService.voidClaim). They book only
 * when replayed as an admin (user 1) — the family test does that; the
 * cross-family guards store every fixture as the default actor (user 2,
 * staff) and need an `actorUserId` on BindingFixture to replay these two.
 */
import type { BindingFixture } from "../bindingFixtures";

/** Seeded rows: a customer, two products, a sale line under warranty, five
 *  repair jobs (edit / checkout / delete / warranty source / warranty job)
 *  and one OPEN repair claim on the sale line (voided by the last fixture). */
export const MAINTENANCE_SEED_SQL = `
  INSERT INTO clients (id, tenant_id, full_name, phone_number, created_at) VALUES (10001, 1, 'Maya Khoury', '70111222', '2026-10-01 09:00:00');
  INSERT INTO products (id, tenant_id, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity, warranty_months)
    VALUES (10001, 1, 'Phone case 10001', 'Product', 'Accessories', 4, 20, 5, 3),
           (10002, 1, 'Screen part 10002', 'Product', 'Parts', 6, 12, 3, NULL);
  INSERT INTO sales (id, tenant_id, client_id, total_amount_usd, final_amount_usd, paid_usd, status, created_at)
    VALUES (10001, 1, 10001, 40, 40, 40, 'completed', '2026-10-05 10:00:00');
  INSERT INTO sale_items (id, tenant_id, sale_id, product_id, quantity, sold_price_usd, cost_price_snapshot_usd, warranty_until, warranty_months)
    VALUES (10001, 1, 10001, 10001, 2, 20, 4, '2027-01-05', 3);
  INSERT INTO maintenance (id, tenant_id, client_id, client_name, device_name, issue_description, status, created_at)
    VALUES (10001, 1, 10001, 'Maya Khoury', 'iPhone 11', 'Battery', 'Received', '2026-10-08 10:00:00'),
           (10003, 1, NULL, 'Walk-in', 'Old Nokia', 'Keypad', 'Received', '2026-10-08 10:00:00');
  INSERT INTO maintenance (id, tenant_id, client_id, client_name, device_name, issue_description, cost_usd, price_usd, final_amount_usd, status, created_at)
    VALUES (10002, 1, 10001, 'Maya Khoury', 'Galaxy A52', 'Screen', 10, 30, 30, 'In_Progress', '2026-10-08 10:00:00');
  INSERT INTO maintenance (id, tenant_id, client_id, client_name, device_name, issue_description, status, warranty_months, warranty_until, created_at)
    VALUES (10004, 1, 10001, 'Maya Khoury', 'iPad Air', 'Charging port', 'Delivered_Paid', 3, '2027-01-01', '2026-10-01 10:00:00'),
           (10005, 1, 10001, 'Maya Khoury', 'Phone case 10001', 'Warranty repair', 'Received', NULL, NULL, '2026-10-06 10:00:00');
  INSERT INTO warranty_claims (id, tenant_id, sale_item_id, action, status, user_id, repair_job_id, created_at)
    VALUES (10001, 1, 10001, 'REPAIR', 'OPEN', 1, 10005, '2026-10-06 10:00:00');
  UPDATE maintenance SET warranty_claim_id = 10001 WHERE id = 10005 AND tenant_id = 1;
`;

export const FIXTURES: readonly BindingFixture[] = [
  {
    // new job, typed phone → links/creates the customer (clients INSERT)
    channel: "maintenance:save",
    seedSql: MAINTENANCE_SEED_SQL,
    payload: {
      device_name: "Pixel 7",
      client_name: "Nadim Saab",
      client_phone: "71 555 666",
      issue_description: "Cracked screen",
      cost_usd: 15,
      price_usd: 60,
      final_amount_usd: 60,
      status: "Received",
    },
  },
  {
    // checkout of seeded job 10002: a part, split USD/LBP legs, a repair warranty
    channel: "maintenance:save",
    payload: {
      id: 10002,
      device_name: "Galaxy A52",
      client_id: 10001,
      client_name: "Maya Khoury",
      client_phone: "",
      issue_description: "Screen",
      cost_usd: 10,
      price_usd: 30,
      final_amount_usd: 30,
      status: "Delivered_Paid",
      exchange_rate: 90000,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 30 },
        { method: "CASH", currency_code: "LBP", amount: 1080000 },
      ],
      parts: [{ product_id: 10002, quantity: 1, unit_price_usd: 12 }],
      warranty_months: 3,
    },
  },
  {
    channel: "maintenance:update-metadata",
    payload: {
      id: 10001,
      device_name: "iPhone 11 Pro",
      note: "edited offline",
    },
  },
  {
    channel: "maintenance:delete",
    payload: { id: 10003 },
  },
  {
    // a repair under the sale line's warranty → claim + a free repair job
    channel: "warranty:claim",
    payload: {
      sale_item_id: 10001,
      action: "REPAIR",
      notes: "Case cracked",
      client_day: "2026-10-10",
    },
  },
  {
    // a repair under the repair's own warranty (job 10004)
    channel: "warranty:claim",
    payload: {
      maintenance_id: 10004,
      action: "REPAIR",
      client_day: "2026-10-10",
    },
  },
  {
    channel: "warranty:void-claim",
    payload: { claim_id: 10001 },
  },
];
