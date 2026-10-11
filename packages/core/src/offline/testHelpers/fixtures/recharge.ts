/**
 * Recharge + carrier lines fixtures (band 6 → ids 6001…). Convention: ../bindingFixtures.ts.
 * Agent B (LIRA-306 Phase 6). `seedSql` was produced by running the real
 * services once on a fresh real-schema database whose AUTOINCREMENT
 * sequences started at the band, so every row (and every id inside
 * metadata_json) is in the band; clock columns normalised to 2026-10-09.
 * Shared config (drawer balances) is only ever UPDATEd.
 */
import type { BindingFixture } from "../bindingFixtures";

const SEED = `
PRAGMA foreign_keys = OFF;
INSERT INTO transactions (id, tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, exchange_rate, client_id, client_name, client_phone, reverses_id, profit_usd, profit_lbp, summary, metadata_json, device_id, created_at) VALUES (6001, 1, 'RECHARGE', 'ACTIVE', 'recharges', 6001, 1, 11, 0, 90000, NULL, NULL, NULL, NULL, 2, 0, 'Recharge: Alfa Voucher $10 — $11 USD', '{"provider":"Alfa","type":"VOUCHER","amount":10,"cost":9,"price":11,"currency":"USD","paid_by":"CASH","phone":"71006009"}', NULL, '2026-10-09 10:00:00');
INSERT INTO clients (id, tenant_id, full_name, phone_number, notes, whatsapp_opt_in, created_at) VALUES (6001, 1, 'Fixture Recharge Client 6001', '70006001', NULL, 1, '2026-10-09 10:00:00');
INSERT INTO recharges (id, tenant_id, carrier, recharge_type, amount, cost, price, default_price_to_client, currency_code, paid_by, phone_number, client_id, client_name, note, created_at, created_by, edited_by, edited_at, is_refunded, refunded_at) VALUES (6001, 1, 'Alfa', 'VOUCHER', 10, 9, 11, NULL, 'USD', 'CASH', '71006009', NULL, NULL, 'Alfa Voucher $10 - 71006009', '2026-10-09 10:00:00', 1, NULL, NULL, 0, NULL);
INSERT INTO carrier_lines (id, tenant_id, carrier, phone_number, label, credits, validity_expires_at, notes, is_active, is_primary, days_owed, created_at, updated_at) VALUES (6001, 1, 'alfa', '71006001', 'Fixture Alfa 6001', 500, '2099-01-01', NULL, 1, 0, 0, '2026-10-09 10:00:00', '2026-10-09 10:00:00');
INSERT INTO carrier_line_owed_deliveries (id, tenant_id, carrier_line_id, transaction_id, client_id, client_name, days_owed, status, sent_at, sent_by, created_at, updated_at) VALUES (6001, 1, 6001, NULL, 6001, 'Fixture Recharge Client 6001', 30, 'PENDING', NULL, NULL, '2026-10-09 10:00:00', '2026-10-09 10:00:00');
INSERT INTO payments (id, tenant_id, transaction_id, session_id, method, drawer_name, currency_code, amount, note, created_by, created_at) VALUES (6001, 1, 6001, NULL, 'CASH', 'General', 'USD', 11, 'Alfa Voucher $10 - 71006009', 1, '2026-10-09 10:00:00');
INSERT INTO payments (id, tenant_id, transaction_id, session_id, method, drawer_name, currency_code, amount, note, created_by, created_at) VALUES (6002, 1, 6001, NULL, 'Alfa', 'Alfa', 'USD', -10, 'Telecom balance sent', 1, '2026-10-09 10:00:00');
PRAGMA foreign_keys = ON;
`;

export const FIXTURES: readonly BindingFixture[] = [
  {
    channel: "recharge:process",
    seedSql: SEED,
    payload: { provider: "Alfa", type: "VOUCHER", amount: 10, cost: 9, price: 11, currency: "USD", paid_by_method: "CASH", phoneNumber: "71006010", payments: [{ method: "CASH", currencyCode: "USD", amount: 11 }] },
  },
  { channel: "recharge:top-up-from-client", payload: { amount: 100, fee: 5, currency: "USD", payments: [{ method: "CASH", currencyCode: "USD", amount: 95 }], clientId: 6001, clientName: "Fixture Recharge Client 6001" } },
  { channel: "recharge:update-metadata", payload: { id: 6001, note: "edited offline", phone_number: "71006019" } },
  { channel: "carrier-lines:record-usage", payload: { carrierLineId: 6001, newCredits: 490, note: "fixture usage" } },
  { channel: "carrier-lines:mark-owed-delivery-sent", payload: { deliveryId: 6001 } },
];
