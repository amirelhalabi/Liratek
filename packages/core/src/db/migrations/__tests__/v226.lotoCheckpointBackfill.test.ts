/**
 * LIRA-351 v226 — close Loto's history before Loto goes on the settle
 * calendar (owner decision 2026-10-29: "mark settled checkpoints paid").
 *
 * A checkpoint settlement wrote one SETTLEMENT ledger row for the net and
 * never stamped the ticket / prize rows it paid, so the calendar would list
 * every old sale as open. The migration stamps `settlement_id` on the rows of
 * settled checkpoints (and on the waive DISCOUNT a checkpoint settlement
 * posted) with the checkpoint settlement's own SETTLEMENT row. Data only: no
 * row is inserted, deleted or changed in amount, so the balance cannot move.
 *
 * Looked up by NAME, not number.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../connection";
import { MIGRATIONS, runMigrations } from "../index";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../tenantContext";
import { LotoTicketRepository } from "../../../repositories/LotoTicketRepository";
import { LotoCashPrizeRepository } from "../../../repositories/LotoCashPrizeRepository";
import { LotoCheckpointRepository } from "../../../repositories/LotoCheckpointRepository";
import { resetTransactionRepository } from "../../../repositories/TransactionRepository";
import { resetSupplierRepository } from "../../../repositories/SupplierRepository";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../../electron-app/create_db.sql"),
  "utf8",
);

function mig() {
  const m = MIGRATIONS.find((x) => x.name === "loto_checkpoint_backfill");
  if (!m || !m.down) throw new Error("v226 migration (with down) not found");
  return m as typeof m & {
    up: (db: Database.Database) => void;
    down: NonNullable<typeof m.down>;
  };
}

const SALE = 120_000;
const COMMISSION = 5_340; // 4.45%

let db: Database.Database;

function ledger(): Array<{
  id: number;
  entry_type: string;
  amount_lbp: number;
  settlement_id: number | null;
  transaction_id: number | null;
}> {
  return db
    .prepare(
      `SELECT l.id, l.entry_type, l.amount_lbp, l.settlement_id, l.transaction_id
         FROM supplier_ledger l JOIN suppliers s ON s.id = l.supplier_id
        WHERE s.provider = 'LOTO' ORDER BY l.id`,
    )
    .all() as ReturnType<typeof ledger>;
}

function balance(): number {
  return ledger().reduce((s, r) => s + r.amount_lbp, 0);
}

function sell(day: string): number {
  return new LotoTicketRepository(db).createTicket({
    sale_amount: SALE,
    commission_amount: COMMISSION,
    sale_date: day,
    payment_method: "CASH",
    currency: "LBP",
    userId: 1,
  }).id;
}

function ledgerOfTxnSource(table: string, id: number): number {
  const row = db
    .prepare(
      `SELECT l.id FROM supplier_ledger l
         JOIN transactions t ON t.id = l.transaction_id
        WHERE t.source_table = ? AND t.source_id = ?`,
    )
    .get(table, id) as { id: number };
  return row.id;
}

beforeEach(() => {
  resetTransactionRepository();
  resetSupplierRepository();
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  initDatabase(db);
  runMigrations(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'LBP', 900000000)`,
  ).run();
});

afterEach(() => {
  resetTenantContext();
  resetTransactionRepository();
  resetSupplierRepository();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("v226 loto_checkpoint_backfill", () => {
  // Was "is the latest migration" — true only until v227 landed after it.
  it("is migration v226", () => {
    expect(mig().version).toBe(226);
  });

  it("stamps exactly the rows of settled checkpoints, keeps the balance, and down() clears them", () => {
    const tickets = new LotoTicketRepository(db);
    const prizes = new LotoCashPrizeRepository(db);
    const checkpoints = new LotoCheckpointRepository(db);

    // Settled checkpoint CP1: 2 tickets + a 100,000 prize, settled with a
    // 320 LBP waive.
    const a = sell("2026-10-20");
    const b = sell("2026-10-20");
    const p1 = prizes.createCashPrize({
      prize_amount: 100_000,
      prize_date: "2026-10-20",
      userId: 1,
    }).id;
    const cp1 = checkpoints.createCheckpoint({
      checkpoint_date: "2026-10-20",
      period_start: "2026-10-20",
      period_end: "2026-10-20",
      total_sales: 2 * SALE,
      total_commission: 2 * COMMISSION,
      total_tickets: 2,
      total_cash_prizes: 100_000,
      total_cash_prizes_count: 1,
    });
    tickets.assignToCheckpoint(a, cp1.id);
    tickets.assignToCheckpoint(b, cp1.id);
    prizes.assignToCheckpoint(p1, cp1.id);
    // net = commission + prizes − sales = 10,680 + 100,000 − 240,000 = −129,320
    checkpoints.settleCheckpoint(
      cp1.id,
      2 * SALE,
      2 * COMMISSION,
      0,
      0,
      undefined,
      1,
      [{ method: "CASH", currency_code: "LBP", amount: -129_000 }],
      undefined,
      320,
    );

    // Unsettled checkpoint CP2 with one ticket; one ticket never checkpointed.
    const c = sell("2026-10-21");
    const cp2 = checkpoints.createCheckpoint({
      checkpoint_date: "2026-10-21",
      period_start: "2026-10-21",
      period_end: "2026-10-21",
      total_sales: SALE,
      total_commission: COMMISSION,
      total_tickets: 1,
    });
    tickets.assignToCheckpoint(c, cp2.id);
    const d = sell("2026-10-22");

    // An old Pay / Receive payment to Loto, tied to no checkpoint.
    const lotoId = (
      db.prepare(`SELECT id FROM suppliers WHERE provider = 'LOTO'`).get() as {
        id: number;
      }
    ).id;
    const oldPay = Number(
      db
        .prepare(
          `INSERT INTO supplier_ledger (tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, created_at)
           VALUES (1, ?, 'PAYMENT', 0, -50000, 'old Pay tab', 1, '2026-10-22 10:00:00')`,
        )
        .run(lotoId).lastInsertRowid,
    );

    const settlementRow = ledger().find((r) => r.entry_type === "SETTLEMENT")!;
    const discountRow = ledger().find((r) => r.entry_type === "DISCOUNT")!;
    expect(settlementRow).toBeDefined();
    expect(discountRow).toBeDefined();

    // Nothing is stamped before the migration (the bug this closes).
    const rowA = ledgerOfTxnSource("loto_tickets", a);
    expect(ledger().find((r) => r.id === rowA)!.settlement_id).toBeNull();

    const balanceBefore = balance();
    const amountsBefore = ledger().map((r) => [r.id, r.amount_lbp]);

    mig().up(db);

    const stamped = new Map(ledger().map((r) => [r.id, r.settlement_id]));
    const closed = [
      rowA,
      ledgerOfTxnSource("loto_tickets", b),
      ledgerOfTxnSource("loto_cash_prizes", p1),
      discountRow.id,
    ];
    for (const id of closed) expect(stamped.get(id)).toBe(settlementRow.id);
    for (const id of [
      ledgerOfTxnSource("loto_tickets", c),
      ledgerOfTxnSource("loto_tickets", d),
      oldPay,
    ])
      expect(stamped.get(id)).toBeNull();

    // Data only: same rows, same amounts, same balance.
    expect(ledger().map((r) => [r.id, r.amount_lbp])).toEqual(amountsBefore);
    expect(balance()).toBe(balanceBefore);

    // Idempotent.
    mig().up(db);
    expect(new Map(ledger().map((r) => [r.id, r.settlement_id]))).toEqual(
      stamped,
    );

    mig().down(db);
    for (const id of closed)
      expect(ledger().find((r) => r.id === id)!.settlement_id).toBeNull();
    expect(balance()).toBe(balanceBefore);
  });
});
