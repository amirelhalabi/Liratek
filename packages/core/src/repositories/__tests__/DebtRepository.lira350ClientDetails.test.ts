/**
 * LIRA-350 — the client's account history carries, per row, the line and
 * detail the client understands (`client_details`), built from the
 * transaction's saved data, the voucher / loto record and a session
 * basket's items — and the repayment picker names an item with the same
 * line (rule 14: one wording on both screens).
 */
import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DebtRepository } from "../DebtRepository";
import {
  addClient,
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
} from "../testHelpers/debtItemDb";

type Fixture = {
  type: string;
  source_table: string;
  source_id: number;
  summary: string;
  amount_usd: number;
  amount_lbp: number;
  exchange_rate: number;
  metadata_json: string;
  created_at: string;
};
const FIX = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "../../utils/__tests__/fixtures/lira350TenantReview.json",
    ),
    "utf8",
  ),
) as Record<string, Fixture>;

const CLIENT = 9927;
let db: Database.Database;

function insertTx(id: number, sourceId?: number): number {
  const f = FIX[String(id)]!;
  db.prepare(
    `INSERT INTO transactions (id, tenant_id, type, status, source_table, source_id, user_id,
       amount_usd, amount_lbp, exchange_rate, client_id, summary, metadata_json, created_at)
     VALUES (?, 1, ?, 'ACTIVE', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    f.type,
    f.source_table,
    sourceId ?? f.source_id,
    f.amount_usd,
    f.amount_lbp,
    f.exchange_rate,
    CLIENT,
    f.summary,
    f.metadata_json,
    f.created_at,
  );
  return id;
}

function insertDebt(
  type: string,
  txnId: number | null,
  usd: number,
  lbp: number,
  note: string,
  sessionId: number | null = null,
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp,
           transaction_id, note, session_id, created_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, '2026-10-26 22:30:00')`,
      )
      .run(CLIENT, type, usd, lbp, txnId, note, sessionId).lastInsertRowid,
  );
}

beforeEach(() => {
  db = installDebtItemTestDb();
  addClient(db, CLIENT, "Review Client 26-10", "03261026");
});
afterEach(() => uninstallDebtItemTestDb(db));

function history() {
  return new DebtRepository().findClientHistory(CLIENT);
}

describe("findClientHistory — client_details on every row (LIRA-350)", () => {
  it("maintenance and exchange rows read the saved details, not the debt note", () => {
    insertDebt(
      "Maintenance Debt",
      insertTx(13110),
      20,
      0,
      "Balance from Maintenance",
    );
    insertDebt("Exchange Debt", insertTx(13112), 10, 0, "Exchange USD → LBP");
    const lines = history().map((r) => r.client_details?.line);
    expect(lines).toEqual(
      expect.arrayContaining([
        "Job #51 — iPhone 15 (black): Charging port replacement + screen protector fitted — $30, paid 890,000 LBP, $20 on account",
        "$20 → 1,780,000 LBP @ 89,000, paid $10, $10 on account",
      ]),
    );
  });

  it("a voucher row reads its code, status, expiry and note from the voucher record", () => {
    const voucherId = Number(
      db
        .prepare(
          `INSERT INTO vouchers (tenant_id, code, client_id, client_name, amount, currency_code,
             status, note, created_by)
           VALUES (1, 'GIFT-SL8E-BKBM', ?, 'Review Client 26-10', 10, 'USD', 'pending',
             'Birthday gift for brother', 1)`,
        )
        .run(CLIENT).lastInsertRowid,
    );
    insertDebt(
      "Voucher Debt",
      insertTx(13113, voucherId),
      10,
      0,
      "Voucher sold GIFT-SL8E-BKBM",
    );
    expect(history()[0]!.client_details?.line).toBe(
      "Voucher GIFT-SL8E-BKBM $10 (Pending, no expiry) — Birthday gift for brother",
    );
  });

  it("a loto row reads its ticket from loto_tickets, never 'CUSTOMER ACCOUNT'", () => {
    const ticketId = Number(
      db
        .prepare(
          `INSERT INTO loto_tickets (tenant_id, ticket_number, sale_amount, commission_amount,
             sale_date, payment_method, client_id)
           VALUES (1, NULL, 200000, 8900, '2026-10-27', 'CUSTOMER_ACCOUNT', ?)`,
        )
        .run(CLIENT).lastInsertRowid,
    );
    insertDebt(
      "Loto Debt",
      insertTx(13111, ticketId),
      0,
      200000,
      "Loto ticket sale: #217 CUSTOMER ACCOUNT",
    );
    const d = history()[0]!.client_details!;
    expect(d.line).toBe("Loto ticket — 200,000 LBP");
    expect(d.fields).toContainEqual({
      key: "date",
      value: "2026-10-27",
      type: "date",
    });
  });

  it("a session basket row lists its items with how each was paid", () => {
    const sessionId = Number(
      db
        .prepare(
          `INSERT INTO customer_sessions (tenant_id, customer_name, customer_phone, started_by, is_active)
           VALUES (1, 'Review Client 26-10', '03261026', 'admin', 0)`,
        )
        .run().lastInsertRowid,
    );
    insertTx(13102); // MTC $3 → 300,000 LBP, used as the basket's on-account item
    insertTx(13109); // Spotify $5, paid at checkout
    const cst = db.prepare(
      `INSERT INTO customer_session_transactions (tenant_id, session_id, transaction_type,
         transaction_id, unified_transaction_id, amount_usd, amount_lbp, owed_usd, owed_lbp)
       VALUES (1, ?, ?, 1, ?, ?, ?, ?, ?)`,
    );
    cst.run(sessionId, "custom_service", 13109, 5, 0, 0, 0);
    cst.run(sessionId, "recharge_mtc", 13102, 0, 300000, 0, 300000);
    db.prepare(
      `INSERT INTO payments (tenant_id, session_id, method, drawer_name, currency_code, amount)
       VALUES (1, ?, 'CASH', 'General', 'USD', 5)`,
    ).run(sessionId);
    insertDebt(
      "Session Debt",
      null,
      0,
      300000,
      `Session #${sessionId} basket`,
      sessionId,
    );
    const d = history()[0]!.client_details!;
    expect(d.kind).toBe("session");
    expect(d.members?.map((m) => `${m.line} | ${m.paidText}`)).toEqual([
      "Spotify Premium 1 Month — $5 | Paid",
      "MTC $3 credit → 03261026 — 300,000 LBP | 300,000 LBP on account",
    ]);
    expect(d.payments.map((p) => `${p.method} ${p.text}`)).toEqual(["CASH $5"]);
  });

  it("a repayment row (money paid OFF the account) never reads as 'on account'", () => {
    db.prepare(
      `INSERT INTO transactions (id, tenant_id, type, status, source_table, source_id, user_id,
         amount_usd, amount_lbp, client_id, summary, metadata_json, created_at)
       VALUES (14000, 1, 'DEBT_REPAYMENT', 'ACTIVE', 'debt_ledger', 1, 1, 10, 0, ?,
         'Debt repayment: $10', ?, '2026-10-27 10:00:00')`,
    ).run(
      CLIENT,
      JSON.stringify({
        payment_snapshot: {
          lines: [
            { method: "CASH", currency: "USD", amount: 10, direction: "IN" },
          ],
        },
      }),
    );
    insertDebt("Repayment", 14000, -10, 0, "Cash repayment");
    const d = history()[0]!.client_details!;
    expect(d.line).toBe("Debt repayment: $10");
    expect(d.line).not.toMatch(/on account|\$-/);
    expect(d.onAccount).toEqual({ usd: -10, lbp: 0 });
  });

  it("a manual row keeps its note", () => {
    insertDebt("Manual Debt", null, 5, 0, "Borrowed cash");
    expect(history()[0]!.client_details?.line).toBe("Borrowed cash");
  });
});

describe("repayment picker labels use the same line (rule 14)", () => {
  it("a loto charge is no longer labelled with the raw payment code", () => {
    const ticketId = Number(
      db
        .prepare(
          `INSERT INTO loto_tickets (tenant_id, ticket_number, sale_amount, commission_amount,
             sale_date, payment_method, client_id)
           VALUES (1, '88123', 200000, 8900, '2026-10-27', 'CUSTOMER_ACCOUNT', ?)`,
        )
        .run(CLIENT).lastInsertRowid,
    );
    insertDebt("Loto Debt", insertTx(13111, ticketId), 0, 200000, "x");
    const items = new DebtRepository().findOpenDebtItems(CLIENT);
    expect(items.map((i) => i.label)).toEqual([
      "Loto ticket #88123 — 200,000 LBP",
    ]);
  });
});
