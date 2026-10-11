/**
 * Test helper (not a test) for the duplicate tests (LIRA-306 T056–T059,
 * T051): book an action ONLINE at a given instant through the same binding
 * the replay uses (= the service the REST route calls), and return the rows
 * it created.
 */
import { runWithTenant } from "../../db/tenantContext";
import { getDatabase } from "../../db/connection";
import { RowCaptureRepository } from "../../repositories/RowCaptureRepository";
import { getOfflineBinding } from "../bindings/index";
import { recordedSchema } from "../channelPolicy";
import { encodeOfflineId, offlineTableIndex } from "../idRange";

/** Online booking at `atIso` (the web route's service, stamped at that instant). */
export function bookOnline(
  channel: string,
  payload: Record<string, unknown>,
  atIso: string,
  actorUserId = 1,
): { result: Record<string, unknown>; created: Record<string, number[]> } {
  const capture = new RowCaptureRepository();
  const parsed = recordedSchema(channel)!.parse(payload) as Record<string, unknown>;
  return runWithTenant(
    1,
    () => {
      const db = getDatabase();
      let out!: { result: Record<string, unknown>; created: Record<string, number[]> };
      db.transaction(() => {
        const before = capture.snapshotSequences();
        const result = getOfflineBinding(channel)!.run(parsed, {
          tenantId: 1,
          actorUserId,
          eventId: "online",
          deviceId: 0,
        }) as Record<string, unknown>;
        if (result.success !== true) throw new Error(`online ${channel} refused: ${String(result.error)}`);
        out = { result, created: capture.createdSince(before) };
      })();
      return out;
    },
    { effectiveNow: atIso, clientDay: atIso.slice(0, 10), clientTzOffsetMinutes: 0 },
  );
}

export const SALE = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  client_id: null,
  items: [{ product_id: 33, quantity: 1, price: 40 }],
  total_amount: 40,
  discount: 0,
  final_amount: 40,
  payment_usd: 40,
  payment_lbp: 0,
  payments: [{ method: "CASH", currency_code: "USD", amount: 40 }],
  exchange_rate: 90000,
  status: "completed",
  ...over,
});

export const OMT_SEND = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  provider: "OMT",
  serviceType: "SEND",
  amount: 100,
  currency: "USD",
  commission: 0,
  cashoutMethod: "CASH",
  payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
  senderName: "Rami",
  senderPhone: "70123456",
  receiverPhone: "71999888",
  referenceNumber: "OM-7731",
  ...over,
});

export const RECHARGE = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  provider: "Alfa",
  type: "VOUCHER",
  amount: 10,
  cost: 9,
  price: 11,
  currency: "USD",
  paid_by_method: "CASH",
  phoneNumber: "71006010",
  payments: [{ method: "CASH", currencyCode: "USD", amount: 11 }],
  ...over,
});

export const EXPENSE = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  category: "General",
  description: "Water",
  amount_usd: 2,
  amount_lbp: 0,
  paid_by_method: "CASH",
  expense_date: "2026-10-10",
  ...over,
});

export const EXCHANGE = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  fromCurrency: "USD",
  toCurrency: "LBP",
  amountIn: 100,
  amountOut: 8950000,
  leg1Rate: 89500,
  leg1MarketRate: 89750,
  leg1ProfitUsd: 0.28,
  totalProfitUsd: 0.28,
  ...over,
});

export const REPAYMENT = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  clientId: 7001,
  amountUSD: 5,
  payments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
  ...over,
});

/** Products, a debtor and drawer floats the payloads above need. */
export const DUP_SEED_SQL = `
  INSERT INTO products (id, tenant_id, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity)
    VALUES (33, 1, 'Cable', 'Product', 'General', 2, 40, 100), (34, 1, 'Charger', 'Product', 'General', 3, 10, 100);
  INSERT INTO clients (id, tenant_id, full_name, phone_number, created_at)
    VALUES (7001, 1, 'Debtor', '70007001', '2026-10-09 10:00:00');
  INSERT INTO debt_ledger (id, tenant_id, client_id, transaction_type, amount_usd, amount_lbp, note, created_by, created_at)
    VALUES (7001, 1, 7001, 'Manual Debt', 100, 0, 'seeded', 1, '2026-10-09 10:00:00');
  UPDATE drawer_balances SET balance = balance + 1000 WHERE tenant_id = 1 AND currency_code = 'USD';
  UPDATE exchange_rates SET sell_rate = 90000, buy_rate = 89500, market_rate = 89750 WHERE tenant_id = 1 AND to_code = 'LBP';
`;

/** The PC side of an action: the same row counts per table as `created`, in
 *  PC `pc`'s offline range (counter starting at `start`). */
export function pcCreatedLike(
  created: Record<string, number[]>,
  pc: number,
  start: number,
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const [t, ids] of Object.entries(created)) {
    out[t] = ids.map((_, i) => encodeOfflineId(pc, offlineTableIndex(t), start + i));
  }
  return out;
}
