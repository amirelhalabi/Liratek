/**
 * LIRA-306 T042 — client create, void (incl. the reversal row that used to
 * rely on the `created_at` default, TransactionRepository ~:5388) and refund
 * replayed at 23:50 Beirut day N → every timestamp they write is on day N.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../../db/tenantContext";
import { ReplayEngine } from "../../ReplayEngine";
import { getSalesService, resetSalesService } from "../../../services/SalesService";
import { resetSalesRepository } from "../../../repositories/SalesRepository";
import { resetTransactionRepository } from "../../../repositories/TransactionRepository";
import { resetStockBatchRepository } from "../../../repositories/StockBatchRepository";
import { getExpenseService, resetExpenseService } from "../../../services/ExpenseService";
import { resetExpenseRepository } from "../../../repositories/ExpenseRepository";
import { installReplayDb, uninstallReplayDb, storeEvent, resetSeq } from "../../testHelpers/replayHarness";

const AT = "2026-10-10T20:50:00.000Z";
const AT_SQL = "2026-10-10 20:50:00";
let db: Database.Database;
let deviceId = 0;

beforeEach(() => {
  for (const r of [resetSalesService, resetSalesRepository, resetTransactionRepository, resetStockBatchRepository, resetExpenseService, resetExpenseRepository]) r();
  ({ db, deviceId } = installReplayDb());
  resetSeq();
  db.exec(`
    INSERT INTO products (id, tenant_id, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity)
      VALUES (33, 1, 'Cable', 'Product', 'General', 2, 5, 10);
  `);
});
afterEach(() => uninstallReplayDb(db));

const replay = (channel: string, payload: Record<string, unknown>) =>
  runWithTenant(1, () =>
    new ReplayEngine().process(storeEvent({ deviceId, channel, payload, occurredAt: AT, clientDay: "2026-10-10", actorUserId: 1 }), {
      mode: "auto",
    }),
  );

const onlineExpense = (): number => {
  const r = runWithTenant(1, () =>
    getExpenseService().addExpense(
      { category: "General", description: "Bread", amount_usd: 3, amount_lbp: 0, expense_date: "2026-10-09", paid_by_method: "CASH" } as never,
      1,
    ),
  );
  expect(r.success).toBe(true);
  return (db.prepare(`SELECT id FROM transactions WHERE type = 'EXPENSE' ORDER BY id DESC LIMIT 1`).get() as { id: number }).id;
};

describe("clients / void / refund replayed keep day N", () => {
  it("clients:create — client row and its CLIENT_CREATED transaction", async () => {
    const out = await replay("clients:create", { full_name: "Rami", phone_number: "70123456", whatsapp_opt_in: 1 });
    expect(out.status).toBe("booked");
    expect((db.prepare(`SELECT created_at AS t FROM clients WHERE full_name = 'Rami'`).get() as { t: string }).t).toBe(AT_SQL);
    const tx = db.prepare(`SELECT created_at AS t FROM transactions WHERE type = 'CLIENT_CREATED'`).all() as Array<{ t: string }>;
    expect(tx.map((r) => r.t)).toEqual([AT_SQL]);
  });

  it("transactions:void — the reversal row and its payment lines", async () => {
    const original = onlineExpense();
    const out = await replay("transactions:void", { transactionId: original });
    expect(out.status).toBe("booked");
    const rev = db.prepare(`SELECT id, created_at AS t FROM transactions WHERE reverses_id = ?`).get(original) as { id: number; t: string };
    expect(rev.t).toBe(AT_SQL);
    const legs = db.prepare(`SELECT created_at AS t FROM payments WHERE transaction_id = ?`).all(rev.id) as Array<{ t: string }>;
    expect(legs.length).toBeGreaterThan(0);
    expect(new Set(legs.map((l) => l.t))).toEqual(new Set([AT_SQL]));
  });

  it("transactions:refund — the refund row, its payment lines and the source's refunded_at", async () => {
    const original = onlineExpense();
    const out = await replay("transactions:refund", { transactionId: original });
    expect(out.status).toBe("booked");
    const ref = db.prepare(`SELECT id, created_at AS t FROM transactions WHERE type = 'REFUND' AND reverses_id = ?`).get(original) as {
      id: number;
      t: string;
    };
    expect(ref.t).toBe(AT_SQL);
    const legs = db.prepare(`SELECT created_at AS t FROM payments WHERE transaction_id = ?`).all(ref.id) as Array<{ t: string }>;
    expect(new Set(legs.map((l) => l.t))).toEqual(new Set([AT_SQL]));
    const src = db.prepare(`SELECT refunded_at AS t FROM expenses ORDER BY id DESC LIMIT 1`).get() as { t: string | null };
    expect(src.t).toBe(AT_SQL);
  });
});
