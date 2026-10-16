/**
 * LIRA-329 T014 — Hold Money keeps its notes and the action on each of its
 * transactions (hold, pickup, pickup void), plus how the money moved.
 *
 * Money columns are asserted FIRST at today's values (FR-008); those passed
 * on the pre-change run. Expected details go through the kind's own schema
 * (rule 24). Rule 17: run before the builder existed and seen failing.
 *
 * Real schema: create_db.sql + migrations.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { HoldMoneyRepository } from "../HoldMoneyRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { buildDb, fundDrawer, USER_ID } from "../testHelpers/omtAccountDb";
import {
  holdMoneyCollectSchema,
  holdMoneyCreateSchema,
} from "../../validators/holdMoney";
import { holdMoneyDetailsSchema } from "../../validators/transactionDetails";
import { expectEverySnapshotMatchesPayments } from "../testHelpers/paymentSnapshotAssert";

interface TxnRow {
  id: number;
  type: string;
  amount_usd: number;
  profit_usd: number;
  client_name: string | null;
  client_phone: string | null;
  metadata_json: string;
}

function txnById(db: Database.Database, id: number): TxnRow {
  return db
    .prepare(
      `SELECT id, type, amount_usd, profit_usd, client_name, client_phone, metadata_json
         FROM transactions WHERE id = ?`,
    )
    .get(id) as TxnRow;
}

function txnOfType(db: Database.Database, type: string): TxnRow {
  return db
    .prepare(
      `SELECT id, type, amount_usd, profit_usd, client_name, client_phone, metadata_json
         FROM transactions WHERE type = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(type) as TxnRow;
}

function meta(row: TxnRow): Record<string, unknown> {
  return JSON.parse(row.metadata_json) as Record<string, unknown>;
}

function expectDetails(row: TxnRow, expected: Record<string, unknown>): void {
  expect(holdMoneyDetailsSchema.parse(expected)).toEqual(expected);
  expect(meta(row).details).toEqual(expected);
}

describe("LIRA-329 — HoldMoneyRepository: hold_money details", () => {
  let db: Database.Database;
  let repo: HoldMoneyRepository;

  beforeEach(() => {
    resetTransactionRepository();
    db = buildDb();
    initFixedTenantContext(1);
    fundDrawer(db, "General", "USD", 10000);
    fundDrawer(db, "General", "LBP", 100_000_000);
    repo = new HoldMoneyRepository();
  });

  // LIRA-329 T036 — every payment snapshot saved by a case above equals
  // the payments rows it booked (method, currency, amount, direction).
  afterEach(() => {
    expectEverySnapshotMatchesPayments(db);
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  function hold(): number {
    const result = repo.createHold(
      holdMoneyCreateSchema.parse({
        client_name: "Joe Haddad",
        phone_number: "70222333",
        usd_amount: 50,
        notes: "for the rent, back Friday",
        payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
      }),
      USER_ID,
    );
    expect(result).toMatchObject({ success: true });
    return result.id as number;
  }

  it("a hold keeps its notes, the action, the client and the payment lines", () => {
    hold();
    const row = txnOfType(db, "HOLD_MONEY");
    expect(row).toMatchObject({
      amount_usd: 50,
      profit_usd: 0,
      client_name: "Joe Haddad",
      client_phone: "70222333",
    });
    expectDetails(row, {
      v: 1,
      kind: "hold_money",
      action: "CREATE",
      notes: "for the rent, back Friday",
    });
    expect(meta(row).payment_snapshot).toEqual({
      lines: [{ method: "CASH", currency: "USD", amount: 50, direction: "IN" }],
    });
  });

  it("a pickup keeps the action, the hold's notes and the payout lines", () => {
    const holdId = hold();
    const result = repo.collectHold(
      holdMoneyCollectSchema.parse({
        id: holdId,
        usd_amount: 20,
        payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
      }),
      USER_ID,
    );
    expect(result).toMatchObject({ success: true });
    const row = txnById(db, result.id as number);
    expect(row).toMatchObject({ type: "HOLD_MONEY_COLLECT", amount_usd: 20 });
    expectDetails(row, {
      v: 1,
      kind: "hold_money",
      action: "COLLECT",
      notes: "for the rent, back Friday",
    });
    expect(meta(row).payment_snapshot).toEqual({
      lines: [
        { method: "CASH", currency: "USD", amount: 20, direction: "OUT" },
      ],
    });
  });

  it("a pickup void keeps the action", () => {
    const holdId = hold();
    repo.collectHold(
      holdMoneyCollectSchema.parse({
        id: holdId,
        usd_amount: 20,
        payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
      }),
      USER_ID,
    );
    const pickupId = (
      db
        .prepare(`SELECT id FROM hold_money_pickups WHERE hold_money_id = ?`)
        .get(holdId) as { id: number }
    ).id;
    expect(repo.voidPickup(pickupId, USER_ID)).toMatchObject({ success: true });
    const row = txnOfType(db, "HOLD_MONEY_COLLECT_VOID");
    expect(row).toMatchObject({ amount_usd: 20, profit_usd: 0 });
    expectDetails(row, {
      v: 1,
      kind: "hold_money",
      action: "VOID_PICKUP",
      notes: "for the rent, back Friday",
    });
  });
});
