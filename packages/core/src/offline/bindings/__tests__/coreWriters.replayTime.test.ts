/**
 * LIRA-306 T036 — replayed work lands on its OWN day and rate (FR-021,
 * FR-021a, SC-005). Each event happened at 23:50 Beirut on day N
 * (2026-10-10T20:50Z) with no `transaction_time` and is replayed later; every
 * row, transaction, payment line and profit must sit on day N — asserted
 * through the queries the app uses (Transactions list UTC bounds, profit by
 * day), not only by reading columns. The rates recorded on the PC are used
 * although the server's rate changed meanwhile, with a `rate_changed` note.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../../db/tenantContext";
import { ReplayEngine } from "../../ReplayEngine";
import { getSalesService, resetSalesService } from "../../../services/SalesService";
import { resetSalesRepository } from "../../../repositories/SalesRepository";
import { getTransactionRepository, resetTransactionRepository } from "../../../repositories/TransactionRepository";
import { resetStockBatchRepository } from "../../../repositories/StockBatchRepository";
import { resetRateRepository } from "../../../repositories/RateRepository";
import { OfflineReviewRepository } from "../../../repositories/OfflineReviewRepository";
import { getProfitService, resetProfitService } from "../../../services/ProfitService";
import { installReplayDb, uninstallReplayDb, storeEvent, resetSeq } from "../../testHelpers/replayHarness";

const AT = "2026-10-10T20:50:00.000Z"; // 23:50 in Beirut, day N = 2026-10-10
const AT_SQL = "2026-10-10 20:50:00";
// Beirut day N in UTC text bounds (what the Transactions page sends)
const DAY_FROM = "2026-10-09 21:00:00";
const DAY_TO = "2026-10-10 20:59:59";

let db: Database.Database;
let deviceId = 0;

beforeEach(() => {
  for (const r of [resetSalesService, resetSalesRepository, resetTransactionRepository, resetStockBatchRepository, resetRateRepository, resetProfitService]) r();
  ({ db, deviceId } = installReplayDb());
  resetSeq();
  db.exec(`
    UPDATE exchange_rates SET market_rate = 89750, buy_rate = 89500, sell_rate = 90000 WHERE tenant_id = 1 AND to_code = 'LBP';
    INSERT INTO products (id, tenant_id, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity)
      VALUES (33, 1, 'Cable', 'Product', 'General', 2, 5, 10);
    INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (7, 1, 'Rami', '70123456');
  `);
});
afterEach(() => uninstallReplayDb(db));

const replay = (channel: string, payload: Record<string, unknown>) =>
  runWithTenant(1, () =>
    new ReplayEngine().process(storeEvent({ deviceId, channel, payload, occurredAt: AT, clientDay: "2026-10-10" }), {
      mode: "auto",
    }),
  );

function timestamps(sql: string, ...params: unknown[]): string[] {
  return (db.prepare(sql).all(...params) as Array<{ t: string }>).map((r) => r.t);
}

function onDayN(txId: number): void {
  const inList = runWithTenant(1, () =>
    getTransactionRepository().getRecent(200, { from: DAY_FROM, to: DAY_TO }).map((t) => t.id),
  );
  expect(inList).toContain(txId);
}

describe("replayed core writers keep the event's day (23:50 day N)", () => {
  it("sales:process — sale, transaction, payment lines and profit on day N", async () => {
    const out = await replay("sales:process", {
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
    });
    expect(out.status).toBe("booked");
    expect(timestamps(`SELECT created_at AS t FROM sales`)).toEqual([AT_SQL]);
    expect(timestamps(`SELECT created_at AS t FROM transactions`)).toEqual([AT_SQL]);
    expect(new Set(timestamps(`SELECT created_at AS t FROM payments`))).toEqual(new Set([AT_SQL]));
    const tx = db.prepare(`SELECT id FROM transactions`).get() as { id: number };
    onDayN(tx.id);
    const byDay = runWithTenant(1, () => getProfitService().getByDate("2026-10-10", "2026-10-10"), {
      clientTzOffsetMinutes: 180,
    });
    expect(byDay.find((d) => d.date === "2026-10-10")?.profit_usd).toBeCloseTo(6);
  });

  it("debt:add-repayment — ledger row, transaction and payment line on day N", async () => {
    // an open debt booked online earlier
    runWithTenant(1, () =>
      getSalesService().processSale(
        {
          client_id: 7,
          items: [{ product_id: 33, quantity: 2, price: 5 }],
          total_amount: 10,
          discount: 0,
          final_amount: 10,
          payment_usd: 0,
          payment_lbp: 0,
          payments: [{ method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 10 }],
          exchange_rate: 90000,
          status: "completed",
          transaction_time: "2026-10-09T08:00:00.000Z",
        } as never,
        1,
      ),
    );
    const before = (db.prepare(`SELECT MAX(id) AS m FROM transactions`).get() as { m: number }).m;
    const out = await replay("debt:add-repayment", {
      clientId: 7,
      amountUSD: 4,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 4 }],
    });
    expect(out.status).toBe("booked");
    const tx = db.prepare(`SELECT id, created_at AS t FROM transactions WHERE id > ? AND type = 'DEBT_REPAYMENT'`).get(before) as {
      id: number;
      t: string;
    };
    expect(tx.t).toBe(AT_SQL);
    expect(new Set(timestamps(`SELECT created_at AS t FROM payments WHERE transaction_id = ?`, tx.id))).toEqual(new Set([AT_SQL]));
    expect(timestamps(`SELECT created_at AS t FROM debt_ledger WHERE transaction_id = ?`, tx.id)).toEqual([AT_SQL]);
    onDayN(tx.id);
  });

  it("db:add-expense — expense, transaction and payment line on day N; the recorded rate is used", async () => {
    // the server's rate moved after the PC recorded the event
    db.exec(`UPDATE exchange_rates SET market_rate = 95000, buy_rate = 95000, sell_rate = 95000 WHERE tenant_id = 1 AND to_code = 'LBP'`);
    const out = await replay("db:add-expense", {
      category: "General",
      description: "Bread",
      amount_usd: 0,
      amount_lbp: 450000,
      paid_by_method: "CASH",
      expense_date: "2026-10-10",
    });
    expect(out.status).toBe("booked");
    expect(timestamps(`SELECT created_at AS t FROM expenses`)).toEqual([AT_SQL]);
    const tx = db.prepare(`SELECT id, created_at AS t, exchange_rate FROM transactions WHERE type = 'EXPENSE'`).get() as {
      id: number;
      t: string;
      exchange_rate: number;
    };
    expect(tx.t).toBe(AT_SQL);
    expect([89750, 90000]).toContain(tx.exchange_rate);
    expect(new Set(timestamps(`SELECT created_at AS t FROM payments WHERE transaction_id = ?`, tx.id))).toEqual(new Set([AT_SQL]));
    onDayN(tx.id);
    runWithTenant(1, () => expect(new OfflineReviewRepository().list({ kind: "rate_changed" })).toHaveLength(1));
  });
});
