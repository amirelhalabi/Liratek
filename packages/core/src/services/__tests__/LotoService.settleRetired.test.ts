/**
 * LIRA-351 (owner decisions 2026-10-29): Loto is settled only on the day
 * calendar (Suppliers → Loto → Settle Account). The old paths that record a
 * Loto payment tied to no shop day are refused in the service, so desktop
 * (IPC) and web (REST) both return the same refusal: checkpoint settle,
 * checkpoint batch settle, "mark checkpoint settled", and Pay / Receive
 * (cashflow) for the Loto supplier. Paper Add Credit / Debt stays allowed.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { getLotoService, resetLotoService } from "../LotoService";
import { SupplierService, resetSupplierService } from "../SupplierService";
import { resetSupplierRepository } from "../../repositories/SupplierRepository";
import { resetTransactionRepository } from "../../repositories/TransactionRepository";
import { LotoTicketRepository } from "../../repositories/LotoTicketRepository";
import {
  LOTO_SETTLE_MOVED_MESSAGE,
  LOTO_PAY_MOVED_MESSAGE,
} from "../LotoService";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf-8",
);

let db: Database.Database;
let lotoId: number;

beforeEach(() => {
  resetLotoService();
  resetSupplierService();
  resetSupplierRepository();
  resetTransactionRepository();
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  initDatabase(db);
  runMigrations(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  new LotoTicketRepository(db).createTicket({
    sale_amount: 120_000,
    commission_amount: 5_340,
    sale_date: "2026-10-26",
    payment_method: "CASH",
    currency: "LBP",
    userId: 1,
  });
  lotoId = (
    db.prepare(`SELECT id FROM suppliers WHERE provider = 'LOTO'`).get() as {
      id: number;
    }
  ).id;
});

afterEach(() => {
  resetTenantContext();
  resetLotoService();
  resetSupplierService();
  resetSupplierRepository();
  resetTransactionRepository();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

function checkpointId(): number {
  return getLotoService().createCheckpoint({
    checkpoint_date: "2026-10-26",
    period_start: "2026-10-26",
    period_end: "2026-10-26",
  }).id;
}

describe("Loto: the old untied payment paths are refused (LIRA-351)", () => {
  it("refuses settling a checkpoint, a batch, and marking one settled", () => {
    const id = checkpointId();
    expect(() =>
      getLotoService().settleCheckpoint(
        id,
        120_000,
        5_340,
        0,
        0,
        undefined,
        1,
        [{ method: "CASH", currency_code: "LBP", amount: -114_660 }],
      ),
    ).toThrow(LOTO_SETTLE_MOVED_MESSAGE);
    expect(() =>
      getLotoService().settleCheckpoints([id], 120_000, 5_340, undefined, 1, [
        { method: "CASH", currency_code: "LBP", amount: -114_660 },
      ]),
    ).toThrow(LOTO_SETTLE_MOVED_MESSAGE);
    expect(() => getLotoService().markCheckpointAsSettled(id)).toThrow(
      LOTO_SETTLE_MOVED_MESSAGE,
    );
    // Nothing was settled.
    expect(
      (
        db
          .prepare(`SELECT is_settled FROM loto_checkpoints WHERE id = ?`)
          .get(id) as {
          is_settled: number;
        }
      ).is_settled,
    ).toBe(0);
  });

  it("refuses Pay / Receive (cashflow) for Loto but keeps paper Add Credit / Debt", () => {
    const service = new SupplierService();
    expect(
      service.recordSupplierCashflow({
        supplier_id: lotoId,
        direction: "PAY",
        payments: [{ method: "CASH", currency_code: "LBP", amount: 114_660 }],
        created_by: 1,
      }),
    ).toEqual({ success: false, error: LOTO_PAY_MOVED_MESSAGE });
    expect(
      service.addLedgerEntry({
        supplier_id: lotoId,
        entry_type: "ADJUSTMENT",
        amount_usd: 0,
        amount_lbp: -1_000,
        created_by: 1,
      }).success,
    ).toBe(true);
  });
});
