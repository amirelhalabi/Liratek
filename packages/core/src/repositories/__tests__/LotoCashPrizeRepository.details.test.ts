/**
 * LIRA-329 T029 — a Loto cash prize keeps its ticket number and prize date
 * on its own transaction, the client's name and phone when the prize was
 * paid inside a customer session, and the payout line it booked.
 *
 * Money is asserted FIRST at today's values (FR-008). Expected details go
 * through the kind's own schema (rule 24). Rule 17: run before the builder
 * existed and seen failing.
 *
 * Real schema (`electron-app/create_db.sql`) via the debtItemDb helper.
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  addClient,
  drawer,
} from "../testHelpers/debtItemDb";
import { LotoCashPrizeRepository } from "../LotoCashPrizeRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  lotoPrizeDetailsSchema,
  paymentSnapshotSchema,
} from "../../validators/transactionDetails";
import { expectEverySnapshotMatchesPayments } from "../testHelpers/paymentSnapshotAssert";

let db: Database.Database;
let repo: LotoCashPrizeRepository;

beforeEach(() => {
  db = installDebtItemTestDb();
  initFixedTenantContext(1);
  resetTransactionRepository();
  resetSupplierRepository();
  repo = new LotoCashPrizeRepository();
});
// LIRA-329 T036 — every payment snapshot saved by a case above equals
// the payments rows it booked (method, currency, amount, direction).
afterEach(() => {
  expectEverySnapshotMatchesPayments(db);
});

afterEach(() => {
  resetTransactionRepository();
  resetSupplierRepository();
  resetTenantContext();
  uninstallDebtItemTestDb(db);
});

interface TxnRow {
  id: number;
  amount_lbp: number;
  client_name: string | null;
  client_phone: string | null;
  metadata_json: string;
}

function txnFor(prizeId: number): TxnRow {
  return db
    .prepare(
      `SELECT id, amount_lbp, client_name, client_phone, metadata_json
         FROM transactions
        WHERE source_table = 'loto_cash_prizes' AND source_id = ?`,
    )
    .get(prizeId) as TxnRow;
}

function meta(row: TxnRow): Record<string, unknown> {
  return JSON.parse(row.metadata_json) as Record<string, unknown>;
}

function expectDetails(row: TxnRow, expected: Record<string, unknown>): void {
  expect(lotoPrizeDetailsSchema.parse(expected)).toEqual(expected);
  expect(meta(row).details).toEqual(expected);
}

describe("LIRA-329 — LotoCashPrizeRepository: loto_prize details", () => {
  it("a counter payout keeps the ticket number, the prize date and the payout line", () => {
    const lbp0 = drawer(db, "General", "LBP");
    const prize = repo.createCashPrize({
      ticket_number: "W-55",
      prize_amount: 1_000_000,
      prize_date: "2026-10-15",
      userId: 1,
    });
    const row = txnFor(prize.id);

    // FR-008 — today's money (asserted first; passed on the pre-change run).
    expect(row.amount_lbp).toBe(-1_000_000);
    expect(drawer(db, "General", "LBP") - lbp0).toBe(-1_000_000);

    expectDetails(row, {
      v: 1,
      kind: "loto_prize",
      ticketNumber: "W-55",
      prizeDate: "2026-10-15",
    });
    const snap = paymentSnapshotSchema.parse(meta(row).payment_snapshot);
    expect(snap).toEqual({
      lines: [
        {
          method: "CASH",
          currency: "LBP",
          amount: 1_000_000,
          direction: "OUT",
        },
      ],
    });
    const paid = db
      .prepare(
        `SELECT method, currency_code, amount FROM payments WHERE transaction_id = ?`,
      )
      .all(row.id);
    expect(paid).toEqual([
      { method: "CASH", currency_code: "LBP", amount: -1_000_000 },
    ]);
  });

  it("a prize paid inside a customer session keeps the client's name and phone and no payment lines of its own", () => {
    addClient(db, 9, "Nadine Saab", "76555444");
    const lbp0 = drawer(db, "General", "LBP");
    const prize = repo.createCashPrize({
      prize_amount: 300_000,
      prize_date: "2026-10-16",
      userId: 1,
      deferPayment: true,
      clientId: 9,
    });
    const row = txnFor(prize.id);

    expect(row.amount_lbp).toBe(-300_000);
    expect(drawer(db, "General", "LBP") - lbp0).toBe(0);

    expect(row.client_name).toBe("Nadine Saab");
    expect(row.client_phone).toBe("76555444");
    expectDetails(row, {
      v: 1,
      kind: "loto_prize",
      prizeDate: "2026-10-16",
    });
    expect(meta(row).payment_snapshot).toBeUndefined();
  });

  // LIRA-329 T037 — and it records the session that paid for it
  // (server-injected, like `deferPayment`).
  it("a prize paid inside a customer session records its session", () => {
    const prize = repo.createCashPrize({
      prize_amount: 300_000,
      prize_date: "2026-10-16",
      userId: 1,
      deferPayment: true,
      paid_in_session: 9,
    } as Parameters<typeof repo.createCashPrize>[0]);
    const row = txnFor(prize.id);
    expect(row.amount_lbp).toBe(-300_000);
    expect(meta(row).details).toMatchObject({
      kind: "loto_prize",
      paid_in_session: 9,
    });
    expect(meta(row).payment_snapshot).toEqual({ lines: [], session_id: 9 });
  });
});
