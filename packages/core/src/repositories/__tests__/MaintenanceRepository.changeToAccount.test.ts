/**
 * Maintenance checkout — change not handed back goes on the client's account
 * as store credit (owner-approved, 2026-10-13).
 *
 * The shared CheckoutModal (POS + Maintenance job checkout) sends the IN legs
 * plus at most one OUT leg per currency `{ method: "CUSTOMER_ACCOUNT",
 * direction: "OUT" }` for change the cashier did not hand back. Cash change
 * still travels as `change_given_usd/lbp`. Before this change the maintenance
 * save schema had no `direction` key (Zod stripped it, so the OUT leg arrived
 * as IN) and `processPayments` had no IN/OUT split (rule 16).
 *
 * Real writers (`MaintenanceService.saveJob` → `processPayments`) against the
 * real `electron-app/create_db.sql` schema. Fixtures are typed as the save
 * schema's input and parsed through it (rule 24).
 */
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { MaintenanceRepository } from "../MaintenanceRepository.js";
import {
  MaintenanceService,
  type SaveJobParams,
} from "../../services/MaintenanceService.js";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository.js";
import { resetStockBatchRepository } from "../StockBatchRepository.js";
import { resetDebtRepository } from "../DebtRepository.js";
import { resetDebtService } from "../../services/DebtService.js";
import { runWithTenant } from "../../db/tenantContext.js";
import {
  saveMaintenanceJobSchema,
  type SaveMaintenanceJobPayload,
} from "../../validators/maintenance.js";
import { CASH_CHANGE_LEG_MESSAGE } from "../../validators/changeLegs.js";
import {
  snapshotLedgers,
  ledgerDeltas,
  expectPostings,
} from "../testHelpers/postingAssert.js";

const SCHEMA = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "..",
    "electron-app",
    "create_db.sql",
  ),
  "utf-8",
);
const RATE = 89_500;
const USER_ID = 1;

let db: Database.Database;

function resetAll(): void {
  resetTransactionRepository();
  resetStockBatchRepository();
  resetDebtRepository();
  resetDebtService();
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(SCHEMA);
  db.pragma("foreign_keys = OFF");
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  resetAll();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  resetAll();
  db.close();
});

const t1 = <T>(fn: () => T): T => runWithTenant(1, fn);
const svc = () => new MaintenanceService(new MaintenanceRepository());

function save(
  payload: SaveMaintenanceJobPayload,
  extra: Partial<SaveJobParams> = {},
) {
  const parsed = saveMaintenanceJobSchema.parse(payload) as SaveJobParams;
  return t1(() => svc().saveJob({ ...parsed, ...extra }, USER_ID));
}

function addClient(): number {
  return Number(
    db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Credit Client', '03111222')`,
      )
      .run().lastInsertRowid,
  );
}

/** USD job: $14 labour, $5 cost, delivered and paid. */
function usdCheckout(
  extra: Partial<SaveMaintenanceJobPayload>,
): SaveMaintenanceJobPayload {
  return {
    device_name: "Phone",
    issue_description: "screen",
    currency: "USD",
    cost_usd: 5,
    price_usd: 14,
    final_amount_usd: 14,
    status: "Delivered_Paid",
    exchange_rate: RATE,
    ...extra,
  };
}

/** $30 cash for a $14 job, nothing handed back, $16 to the account. */
function changeToAccount(clientId?: number): SaveMaintenanceJobPayload {
  return usdCheckout({
    ...(clientId != null ? { client_id: clientId } : {}),
    payments: [
      { method: "CASH", currency_code: "USD", amount: 30 },
      {
        method: "CUSTOMER_ACCOUNT",
        currency_code: "USD",
        amount: 16,
        direction: "OUT",
      },
    ],
    change_given_usd: 0,
    change_given_lbp: 0,
  });
}

function jobTxnId(jobId: number): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions
          WHERE source_table = 'maintenance' AND source_id = ? AND type = 'MAINTENANCE' AND reverses_id IS NULL`,
      )
      .get(jobId) as { id: number }
  ).id;
}

function debtRows(clientId: number) {
  return db
    .prepare(
      `SELECT transaction_type, amount_usd, amount_lbp, transaction_id, note
         FROM debt_ledger WHERE client_id = ? ORDER BY id`,
    )
    .all(clientId) as {
    transaction_type: string;
    amount_usd: number;
    amount_lbp: number;
    transaction_id: number | null;
    note: string | null;
  }[];
}

function count(table: "transactions" | "maintenance" | "payments"): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }
  ).c;
}

function activeProfit(): { usd: number; lbp: number } {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(profit_usd), 0) AS usd, COALESCE(SUM(profit_lbp), 0) AS lbp
         FROM transactions WHERE status = 'ACTIVE'`,
    )
    .get() as { usd: number; lbp: number };
  return {
    usd: Math.round(row.usd * 1e6) / 1e6,
    lbp: Math.round(row.lbp * 1e6) / 1e6,
  };
}

function expectRefused(
  payload: SaveMaintenanceJobPayload,
  message: RegExp,
  opts: { bypassSchema?: boolean } = {},
) {
  const before = snapshotLedgers(db);
  const counts = [count("transactions"), count("maintenance"), count("payments")];
  // bypassSchema: a repository caller that never runs the Zod schema.
  const res = opts.bypassSchema
    ? t1(() => svc().saveJob(payload as SaveJobParams, USER_ID))
    : save(payload);
  expect(res.success).toBe(false);
  expect(res.error).toMatch(message);
  expectPostings(before, snapshotLedgers(db), {});
  expect([
    count("transactions"),
    count("maintenance"),
    count("payments"),
  ]).toEqual(counts);
}

describe("Maintenance checkout — change to the client's account (failing-first)", () => {
  it("(a) $14 job, $30 cash, $16 OUT to account: drawer +$30, client credit $16 linked to the txn, no debt", () => {
    const clientId = addClient();
    const before = snapshotLedgers(db);
    const res = save(changeToAccount(clientId));
    expect(res).toEqual({ success: true, id: expect.any(Number) });
    const txnId = jobTxnId(res.id!);

    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": 30 },
      debt: { [`${clientId}|USD`]: -16 },
    });
    expect(debtRows(clientId)).toEqual([
      {
        transaction_type: "CREDIT_DEPOSIT",
        amount_usd: -16,
        amount_lbp: 0,
        transaction_id: txnId,
        note: "Change returned",
      },
    ]);
    // The OUT leg is not a payment row (it moves no drawer).
    const legs = db
      .prepare(
        `SELECT method, amount FROM payments WHERE transaction_id = ? ORDER BY id`,
      )
      .all(txnId);
    expect(legs).toEqual([{ method: "CASH", amount: 30 }]);
  });

  it("(b) a CASH OUT leg in payments is refused — it must never post as IN", () => {
    const payload = usdCheckout({
      payments: [
        { method: "CASH", currency_code: "USD", amount: 30 },
        {
          method: "CASH",
          currency_code: "USD",
          amount: 16,
          direction: "OUT",
        },
      ],
    });
    // 2026-10-25: the schema now refuses it at the edge with the shared
    // rule (validators/changeLegs.ts) — before, it parsed and only the
    // repository refused it. Rewritten from a parse-then-save assertion.
    const edge = saveMaintenanceJobSchema.safeParse(payload);
    expect(edge.success).toBe(false);
    if (!edge.success) {
      expect(edge.error.issues[0]?.message).toBe(CASH_CHANGE_LEG_MESSAGE);
    }
    // The repository still refuses it for callers that skip the schema.
    expectRefused(payload, /change|returned/i, { bypassSchema: true });
  });

  it("(b2) an OUT account leg the payment does not support is refused (no $1000 credit from $30)", () => {
    const clientId = addClient();
    expectRefused(
      usdCheckout({
        client_id: clientId,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 30 },
          {
            method: "CUSTOMER_ACCOUNT",
            currency_code: "USD",
            amount: 1000,
            direction: "OUT",
          },
        ],
      }),
      /reconcile/i,
    );
    expect(debtRows(clientId)).toEqual([]);
  });

  it("(b3) an OUT account leg with no client is refused with a plain sentence", () => {
    expectRefused(
      changeToAccount(),
      /Client is required to return change as store credit/,
    );
  });

  it("(c) voiding (a) nets payments/drawer, debt_ledger and profit to 0 per currency", () => {
    const clientId = addClient();
    const before = snapshotLedgers(db);
    const res = save(changeToAccount(clientId));
    expect(res.success).toBe(true);
    const txnId = jobTxnId(res.id!);

    t1(() => getTransactionRepository().voidTransaction(txnId, USER_ID));
    expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
      drawers: {},
      supplier: {},
      partner: {},
      debt: {},
    });
    expect(activeProfit()).toEqual({ usd: 0, lbp: 0 });
    const net = db
      .prepare(
        `SELECT currency_code, ROUND(SUM(amount), 6) AS total FROM payments GROUP BY currency_code`,
      )
      .all() as { currency_code: string; total: number }[];
    for (const r of net) expect(r.total).toBe(0);
  });
});

describe("Maintenance checkout — session basket (deferred) drops change-to-account legs (written after the fix — NOT proven failing-first)", () => {
  it("books no credit and no drawer movement — the basket owns the payment and its change", () => {
    const clientId = addClient();
    const before = snapshotLedgers(db);
    const res = save(changeToAccount(clientId), { deferPayment: true });
    expect(res.success).toBe(true);
    expectPostings(before, snapshotLedgers(db), {});
    expect(debtRows(clientId)).toEqual([]);
  });
});
