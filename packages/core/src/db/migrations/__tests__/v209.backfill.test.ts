/**
 * LIRA-304 T007 — migration v209 back-fill: existing baskets get per-member
 * shares whose open amounts add up to the basket row's outstanding amount
 * (invariant I1), split by share as checkouts were split before LIRA-304.
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  addClient,
  seedBasketMembers,
} from "../../../repositories/testHelpers/debtItemDb";
import { backfillSessionMemberDebtShare } from "../index";
import { coverageOutstandingSql } from "../../../repositories/sessionDebtCoverage";

let db: Database.Database;

beforeEach(() => {
  db = installDebtItemTestDb();
  addClient(db, 7);
});
afterEach(() => uninstallDebtItemTestDb(db));

function insertBasketRow(
  sessionId: number,
  o: { usd: number; lbp: number; coveredUsd: number; coveredLbp: number },
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp,
           covered_usd, covered_lbp, transaction_id, session_id, created_by)
         VALUES (1, 7, 'Session Debt', ?, ?, ?, ?, NULL, ?, 1)`,
      )
      .run(o.usd, o.lbp, o.coveredUsd, o.coveredLbp, sessionId).lastInsertRowid,
  );
}

function members(sessionId: number) {
  return db
    .prepare(
      `SELECT cst.id, t.type, owed_usd, owed_lbp, covered_usd, covered_lbp
       FROM customer_session_transactions cst
       JOIN transactions t ON t.id = cst.unified_transaction_id
       WHERE session_id = ? ORDER BY cst.id`,
    )
    .all(sessionId) as Array<{
    id: number;
    type: string;
    owed_usd: number;
    owed_lbp: number;
    covered_usd: number;
    covered_lbp: number;
  }>;
}

function outstanding(rowId: number) {
  return db
    .prepare(
      `SELECT ${coverageOutstandingSql("dl", "usd")} AS usd, ${coverageOutstandingSql("dl", "lbp")} AS lbp
       FROM debt_ledger dl WHERE dl.id = ?`,
    )
    .get(rowId) as { usd: number; lbp: number };
}

it("whole basket on account, untouched: shares follow each item's own currency", () => {
  const b = seedBasketMembers(db, 7, [
    { kind: "transfer", provider: "OMT", usd: 101 },
    { kind: "sale", usd: 14 },
    { kind: "loto", lbp: 200_000 },
  ]);
  // Old checkout: sale pre-covered ($14).
  const row = insertBasketRow(b.sessionId, {
    usd: 115,
    lbp: 200_000,
    coveredUsd: 14,
    coveredLbp: 0,
  });
  backfillSessionMemberDebtShare(db);
  const [omt, sale, loto] = members(b.sessionId);
  expect(omt.owed_usd).toBeCloseTo(101, 2);
  expect(loto.owed_lbp).toBe(200_000);
  expect(sale.owed_usd).toBe(0);
  const o = outstanding(row);
  expect(omt.owed_usd + loto.owed_usd).toBeCloseTo(o.usd, 2);
  expect(omt.owed_lbp + loto.owed_lbp).toBeCloseTo(o.lbp, 0);
});

it("partly repaid basket: the remaining outstanding is split by share", () => {
  const b = seedBasketMembers(db, 7, [
    { kind: "transfer", provider: "OMT", usd: 60 },
    { kind: "transfer", provider: "WHISH_APP", usd: 40 },
  ]);
  // $100 on account, $30 already repaid → $70 outstanding.
  const row = insertBasketRow(b.sessionId, {
    usd: 100,
    lbp: 0,
    coveredUsd: 30,
    coveredLbp: 0,
  });
  backfillSessionMemberDebtShare(db);
  const [omt, wallet] = members(b.sessionId);
  expect(omt.owed_usd).toBeCloseTo(42, 2); // 70 × 60/100
  expect(wallet.owed_usd).toBeCloseTo(28, 2); // remainder
  expect(omt.covered_usd + wallet.covered_usd).toBe(0);
  expect(omt.owed_usd + wallet.owed_usd).toBeCloseTo(outstanding(row).usd, 2);
});

it("a wholly reversed basket is left alone", () => {
  const b = seedBasketMembers(db, 7, [
    { kind: "transfer", provider: "OMT", usd: 50 },
  ]);
  insertBasketRow(b.sessionId, { usd: 50, lbp: 0, coveredUsd: 0, coveredLbp: 0 });
  db.prepare(
    `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp, session_id, created_by)
     VALUES (1, 7, 'Refund Reversal', -50, 0, ?, 1)`,
  ).run(b.sessionId);
  backfillSessionMemberDebtShare(db);
  expect(members(b.sessionId)[0].owed_usd).toBe(0);
});

it("cross-currency: a USD charge on an LBP-priced item is shared by value", () => {
  const b = seedBasketMembers(db, 7, [{ kind: "loto", lbp: 890_000 }]);
  const row = insertBasketRow(b.sessionId, {
    usd: 10,
    lbp: 0,
    coveredUsd: 0,
    coveredLbp: 0,
  });
  backfillSessionMemberDebtShare(db);
  const [loto] = members(b.sessionId);
  expect(loto.owed_usd).toBeCloseTo(outstanding(row).usd, 2);
});
