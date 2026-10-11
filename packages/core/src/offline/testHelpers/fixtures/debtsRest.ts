/**
 * Debts (rest) fixtures (band 7 → ids 7501… (7001… is debt:add-repayment's)). Convention: ../bindingFixtures.ts.
 * Agent B (LIRA-306 Phase 6). `seedSql` was produced by running the real
 * services once on a fresh real-schema database whose AUTOINCREMENT
 * sequences started at the band, so every row (and every id inside
 * metadata_json) is in the band; clock columns normalised to 2026-10-09.
 * Shared config (drawer balances) is only ever UPDATEd.
 */
import type { BindingFixture } from "../bindingFixtures";

const SEED = `
PRAGMA foreign_keys = OFF;
UPDATE drawer_balances SET balance = balance + 100 WHERE tenant_id = 1 AND drawer_name = 'General' AND currency_code = 'USD';
INSERT INTO transactions (id, tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, exchange_rate, client_id, client_name, client_phone, reverses_id, profit_usd, profit_lbp, summary, metadata_json, device_id, created_at) VALUES (7501, 1, 'DEBT_CASH_OUT', 'ACTIVE', 'debt_ledger', 7501, 1, 30, 0, 89750, 7501, NULL, NULL, NULL, 0, 0, 'Cash Advance (Debt): $30 + 0 LBP', '{"paid_by":"CASH","counterparty":{"kind":"client","id":7501,"name":"Fixture Debtor 7501","flow":"OUT","method":"CASH","ledger_entry_id":7501}}', NULL, '2026-10-09 10:00:00');
INSERT INTO clients (id, tenant_id, full_name, phone_number, notes, whatsapp_opt_in, created_at) VALUES (7501, 1, 'Fixture Debtor 7501', '70007501', NULL, 1, '2026-10-09 10:00:00');
INSERT INTO clients (id, tenant_id, full_name, phone_number, notes, whatsapp_opt_in, created_at) VALUES (7502, 1, 'Fixture Creditor 7502', '70007502', NULL, 1, '2026-10-09 10:00:00');
INSERT INTO debt_ledger (id, tenant_id, client_id, transaction_type, amount_usd, amount_lbp, transaction_id, due_date, note, created_at, created_by, edited_by, edited_at, is_refunded, refunded_at, session_id, covered_usd, covered_lbp) VALUES (7501, 1, 7501, 'Manual Debt', 30, 0, 7501, NULL, 'Cash advance (debt)', '2026-10-09 10:00:00', 1, NULL, NULL, 0, NULL, NULL, 0, 0);
INSERT INTO debt_ledger (id, tenant_id, client_id, transaction_type, amount_usd, amount_lbp, transaction_id, due_date, note, created_at, created_by, edited_by, edited_at, is_refunded, refunded_at, session_id, covered_usd, covered_lbp) VALUES (7502, 1, 7502, 'CREDIT_DEPOSIT', -50, 0, NULL, NULL, NULL, '2026-10-09 10:00:00', 1, NULL, NULL, 0, NULL, NULL, 0, 0);
INSERT INTO payments (id, tenant_id, transaction_id, session_id, method, drawer_name, currency_code, amount, note, created_by, created_at) VALUES (7501, 1, 7501, NULL, 'CASH', 'General', 'USD', -30, 'Cash advance (debt)', 1, '2026-10-09 10:00:00');
PRAGMA foreign_keys = ON;
`;

export const FIXTURES: readonly BindingFixture[] = [
  { channel: "debt:cash-out", seedSql: SEED, payload: { clientId: 7502, amountUSD: 10, amountLBP: 0, payments: [{ method: "CASH", currencyCode: "USD", amount: 10 }], note: "fixture cash-out" } },
  { channel: "debt:add-account-entry", payload: { direction: "credit", clientId: 7501, amountUSD: 5, amountLBP: 0, moveCash: false, note: "fixture paper entry" } },
  { channel: "debt:add-credit", payload: { clientId: 7501, amountUsd: 2, amountLbp: 0, note: "fixture credit" } },
  { channel: "debt:use-credit", payload: { clientId: 7502, amountUsd: 5, amountLbp: 0, note: "fixture use" } },
  { channel: "debt:write-off", payload: { clientId: 7501, amountUSD: 3, amountLBP: 0, reason: "fixture write-off" } },
  { channel: "debts:update-metadata", payload: { id: 7501, note: "edited offline" } },
];
