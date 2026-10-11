/**
 * Financial services fixtures (band 5 → ids 5001…). Convention: ../bindingFixtures.ts.
 * Agent B (LIRA-306 Phase 6). `seedSql` was produced by running the real
 * services once on a fresh real-schema database whose AUTOINCREMENT
 * sequences started at the band, so every row (and every id inside
 * metadata_json) is in the band; clock columns normalised to 2026-10-09.
 * Shared config (drawer balances) is only ever UPDATEd.
 */
import type { BindingFixture } from "../bindingFixtures";

const SEED = `
PRAGMA foreign_keys = OFF;
UPDATE drawer_balances SET balance = balance + 100 WHERE tenant_id = 1 AND drawer_name IN ('OMT_App', 'General') AND currency_code = 'USD';
INSERT INTO transactions (id, tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, exchange_rate, client_id, client_name, client_phone, reverses_id, profit_usd, profit_lbp, summary, metadata_json, device_id, created_at) VALUES (5001, 1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', 5001, 1, 50, 0, 90000, NULL, NULL, NULL, NULL, 0, 0, 'OMT SEND: Fixture Sender — 50 USD', '{"provider":"OMT","service_type":"SEND","amount":50,"currency":"USD","commission":1,"cost":0,"price":0,"paid_by":"CASH","paid_amount":50,"paid_currency":"USD"}', NULL, '2026-10-09 10:00:00');
INSERT INTO transactions (id, tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, exchange_rate, client_id, client_name, client_phone, reverses_id, profit_usd, profit_lbp, summary, metadata_json, device_id, created_at) VALUES (5002, 1, 'SUPPLIER_PAYMENT', 'ACTIVE', 'supplier_ledger', 5001, 1, 50, 0, 89750, NULL, NULL, NULL, NULL, 0, 0, 'Supplier TOP_UP: $50 + 0 LBP', '{"supplier_id":3,"entry_type":"TOP_UP","counterparty":{"kind":"supplier","id":3,"name":"OMT","flow":"IN","method":"LEDGER","ledger_entry_id":5001},"is_auto":true}', NULL, '2026-10-09 10:00:00');
INSERT INTO supplier_ledger (id, tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id, is_auto, is_refunded, refunded_at, source_ref_table, source_ref_id, settlement_id, attached_at, created_at) VALUES (5001, 1, 3, 'TOP_UP', 50, 0, 'Auto: SEND via OMT', 1, 5002, 1, 0, NULL, 'financial_services', 5001, NULL, NULL, '2026-10-09 10:00:00');
INSERT INTO financial_services (id, tenant_id, provider, service_type, amount, currency, commission, cost, price, paid_by, paid_amount, paid_currency, client_id, client_name, reference_number, phone_number, omt_service_type, omt_fee, whish_fee, profit_rate, pay_fee, payment_method_fee, payment_method_fee_rate, item_key, note, sender_name, sender_phone, receiver_name, receiver_phone, sender_client_id, receiver_client_id, is_settled, settled_at, settlement_id, created_at, created_by, edited_by, edited_at, is_refunded, refunded_at, partner_id, partner_mode, supplier_debt_booked, commission_model, receive_fee_model) VALUES (5001, 1, 'OMT', 'SEND', 50, 'USD', 1, 0, 0, 'CASH', 50, 'USD', NULL, 'Fixture Sender', NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, NULL, NULL, NULL, 'Fixture Sender', NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, '2026-10-09 10:00:00', NULL, NULL, NULL, 0, NULL, NULL, NULL, 0, 1, 0);
INSERT INTO mobile_service_items (id, tenant_id, provider, category, subcategory, label, cost_lbp, sell_lbp, sort_order, is_active, validity_days, credits, days_cost_lbp, sell_days_lbp, sell_credit_lbp, max_returned_credits_usd, created_at, updated_at) VALUES (5001, 1, 'iPick', 'mtc', 'Prepaid', 'Fixture MTC card 5001', 400000, 450000, 0, 1, 30, 4.5, NULL, NULL, NULL, NULL, '2026-10-09 10:00:00', '2026-10-09 10:00:00');
INSERT INTO carrier_lines (id, tenant_id, carrier, phone_number, label, credits, validity_expires_at, notes, is_active, is_primary, days_owed, created_at, updated_at) VALUES (5001, 1, 'mtc', '03005001', 'Fixture MTC 5001', 100, '2099-01-01', NULL, 1, 0, 0, '2026-10-09 10:00:00', '2026-10-09 10:00:00');
INSERT INTO payments (id, tenant_id, transaction_id, session_id, method, drawer_name, currency_code, amount, note, created_by, created_at) VALUES (5001, 1, 5001, NULL, 'CASH', 'OMT_System', 'USD', 50, NULL, 1, '2026-10-09 10:00:00');
PRAGMA foreign_keys = ON;
`;

export const FIXTURES: readonly BindingFixture[] = [
  {
    channel: "omt:add-transaction",
    seedSql: SEED,
    payload: { provider: "OMT", serviceType: "SEND", amount: 20, currency: "USD", commission: 0, cashoutMethod: "CASH", payments: [{ method: "CASH", currencyCode: "USD", amount: 20 }], senderName: "Fixture Sender" },
  },
  { channel: "financial:update-metadata", payload: { id: 5001, note: "edited offline", receiver_name: "Fixture Receiver" } },
  { channel: "financial:self-charge-telecom-item", payload: { mobileServiceItemId: 5001, carrierLineId: 5001 } },
  { channel: "wallet-exchange:create", payload: { drawerName: "OMT_App", fromCurrency: "USD", toCurrency: "LBP", amountIn: 10, rate: 89000 } },
];
