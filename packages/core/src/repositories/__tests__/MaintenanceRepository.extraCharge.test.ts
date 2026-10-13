/**
 * LIRA-319 T037 / T038 / T053 (Maintenance) — an extra charged on top of a
 * repair checkout.
 *
 * Rules under test (specs/319-extra-charges/data-model.md, research R2/R4):
 *   - the MAINTENANCE row's `amount_*` INCLUDES the extra, `profit_*`
 *     EXCLUDES it, and `extra_usd/lbp` carries it;
 *   - the extra is in the job's currency (an LBP job's extra is LBP);
 *   - kept change and the debt residual reconcile against labour + parts +
 *     extra — so a checkout fully on the client's account books the extra as
 *     debt, and a void nets every ledger to 0 per currency (rule 20);
 *   - the server refuses: discount + extra (an LBP job's discount is the
 *     implicit `price_lbp − final_amount_lbp`), an extra above the pre-extra
 *     total, an extra in the other currency, and an extra on a session-basket
 *     job (the basket checkout takes it).
 *
 * Real writers (`MaintenanceService.saveJob` → `processPayments`) against the
 * real `electron-app/create_db.sql` schema. Payloads are typed as the save
 * schema's input and validated through it exactly as both transports do
 * (rule 24); a schema refusal comes back as `{ success: false, error }`.
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
import {
  DISCOUNT_AND_EXTRA_MESSAGE,
  EXTRA_ABOVE_TOTAL_MESSAGE,
  EXTRA_ON_SESSION_ITEM_MESSAGE,
} from "../../validators/common.js";
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

/** Validate like the transports (IPC `validatePayload` / REST
 *  `validateRequest`), then save. `server` is merged AFTER validation — the
 *  fields only the server sets (the session basket's `deferPayment`). */
function save(
  payload: SaveMaintenanceJobPayload,
  server: Partial<SaveJobParams> = {},
): { success: boolean; id?: number; error?: string } {
  const parsed = saveMaintenanceJobSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message };
  }
  return t1(() =>
    svc().saveJob({ ...(parsed.data as SaveJobParams), ...server }, USER_ID),
  );
}

function addClient(): number {
  return Number(
    db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Extra Client', '03111222')`,
      )
      .run().lastInsertRowid,
  );
}

/** USD job: $20 labour, $8 cost, delivered and paid. */
function usdJob(
  patch: Partial<SaveMaintenanceJobPayload> = {},
): SaveMaintenanceJobPayload {
  return {
    device_name: "Phone",
    issue_description: "screen",
    currency: "USD",
    cost_usd: 8,
    price_usd: 20,
    final_amount_usd: 20,
    status: "Delivered_Paid",
    exchange_rate: RATE,
    change_given_usd: 0,
    change_given_lbp: 0,
    ...patch,
  };
}

/** LBP job: 1,800,000 LBP labour, 900,000 LBP cost. */
function lbpJob(
  patch: Partial<SaveMaintenanceJobPayload> = {},
): SaveMaintenanceJobPayload {
  return {
    device_name: "Tablet",
    issue_description: "battery",
    currency: "LBP",
    cost_usd: 0,
    price_usd: 0,
    cost_lbp: 900_000,
    price_lbp: 1_800_000,
    final_amount_usd: 0,
    final_amount_lbp: 1_800_000,
    status: "Delivered_Paid",
    exchange_rate: RATE,
    change_given_usd: 0,
    change_given_lbp: 0,
    ...patch,
  };
}

interface TxnRow {
  id: number;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  extra_usd: number;
  extra_lbp: number;
}

function jobTxn(jobId: number): TxnRow {
  return db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, profit_usd, profit_lbp, extra_usd, extra_lbp
         FROM transactions
        WHERE source_table = 'maintenance' AND source_id = ? AND type = 'MAINTENANCE' AND reverses_id IS NULL`,
    )
    .get(jobId) as TxnRow;
}

function jobRow(jobId: number): {
  final_amount_usd: number;
  final_amount_lbp: number;
} {
  return db
    .prepare(
      `SELECT final_amount_usd, final_amount_lbp FROM maintenance WHERE id = ?`,
    )
    .get(jobId) as { final_amount_usd: number; final_amount_lbp: number };
}

function count(table: "transactions" | "maintenance" | "payments"): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }
  ).c;
}

/** Profit + extra still counted (ACTIVE rows), per currency. */
function activeTotals(): {
  profitUsd: number;
  profitLbp: number;
  extraUsd: number;
  extraLbp: number;
} {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(profit_usd), 0) AS pu, COALESCE(SUM(profit_lbp), 0) AS pl,
              COALESCE(SUM(extra_usd), 0) AS eu, COALESCE(SUM(extra_lbp), 0) AS el
         FROM transactions WHERE status = 'ACTIVE'`,
    )
    .get() as { pu: number; pl: number; eu: number; el: number };
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    profitUsd: r6(r.pu),
    profitLbp: r6(r.pl),
    extraUsd: r6(r.eu),
    extraLbp: r6(r.el),
  };
}

function expectRefused(
  payload: SaveMaintenanceJobPayload,
  message: string | RegExp,
  server: Partial<SaveJobParams> = {},
) {
  const before = snapshotLedgers(db);
  const counts = [
    count("transactions"),
    count("maintenance"),
    count("payments"),
  ];
  const res = save(payload, server);
  expect(res.success).toBe(false);
  if (typeof message === "string") expect(res.error).toBe(message);
  else expect(res.error).toMatch(message);
  expectPostings(before, snapshotLedgers(db), {});
  expect([
    count("transactions"),
    count("maintenance"),
    count("payments"),
  ]).toEqual(counts);
}

describe("Maintenance checkout — extra charge (T037, failing-first)", () => {
  it("USD job: $20 labour + $2 extra, $22 cash → amount 22, extra 2, labour profit unchanged, drawer +22", () => {
    const before = snapshotLedgers(db);
    const res = save(
      usdJob({
        extra_usd: 2,
        payments: [{ method: "CASH", currency_code: "USD", amount: 22 }],
      }),
    );
    expect(res).toEqual({ success: true, id: expect.any(Number) });

    expect(jobTxn(res.id!)).toMatchObject({
      amount_usd: 22,
      amount_lbp: 0,
      profit_usd: 12,
      profit_lbp: 0,
      extra_usd: 2,
      extra_lbp: 0,
    });
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": 22 },
    });
    // The job's own price columns keep their meaning (data-model.md).
    expect(jobRow(res.id!)).toEqual({
      final_amount_usd: 20,
      final_amount_lbp: 0,
    });
  });

  it("LBP job: the extra is in LBP — 1,800,000 + 100,000 extra, 1,900,000 cash", () => {
    const before = snapshotLedgers(db);
    const res = save(
      lbpJob({
        extra_lbp: 100_000,
        payments: [{ method: "CASH", currency_code: "LBP", amount: 1_900_000 }],
      }),
    );
    expect(res).toEqual({ success: true, id: expect.any(Number) });

    expect(jobTxn(res.id!)).toMatchObject({
      amount_usd: 0,
      amount_lbp: 1_900_000,
      profit_usd: 0,
      profit_lbp: 900_000,
      extra_usd: 0,
      extra_lbp: 100_000,
    });
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|LBP": 1_900_000 },
    });
  });

  it("kept change reconciles against labour + extra: $20 + $2, $25 cash, $3 kept", () => {
    const before = snapshotLedgers(db);
    const res = save(
      usdJob({
        extra_usd: 2,
        payments: [{ method: "CASH", currency_code: "USD", amount: 25 }],
        kept_change_usd: 3,
      }),
    );
    expect(res).toEqual({ success: true, id: expect.any(Number) });
    expect(jobTxn(res.id!)).toMatchObject({
      amount_usd: 22,
      profit_usd: 15,
      extra_usd: 2,
    });
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": 25 },
    });
  });

  it("void of a cash checkout with an extra nets every ledger, profit and extra to 0", () => {
    const before = snapshotLedgers(db);
    const res = save(
      usdJob({
        extra_usd: 2,
        payments: [{ method: "CASH", currency_code: "USD", amount: 22 }],
      }),
    );
    expect(res.success).toBe(true);
    t1(() =>
      getTransactionRepository().voidTransaction(jobTxn(res.id!).id, USER_ID),
    );
    expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
      drawers: {},
      supplier: {},
      partner: {},
      debt: {},
    });
    expect(activeTotals()).toEqual({
      profitUsd: 0,
      profitLbp: 0,
      extraUsd: 0,
      extraLbp: 0,
    });
  });
});

describe("Maintenance checkout — extra refusals (T038, failing-first)", () => {
  const cash = (amount: number) => [
    { method: "CASH", currency_code: "USD", amount },
  ];

  it("an extra above the pre-extra total is refused with no postings", () => {
    expectRefused(
      usdJob({ extra_usd: 20.01, payments: cash(40.01) }),
      EXTRA_ABOVE_TOTAL_MESSAGE,
    );
  });

  it("an LBP extra above the LBP labour total is refused with no postings", () => {
    expectRefused(
      lbpJob({
        extra_lbp: 1_800_001,
        payments: [{ method: "CASH", currency_code: "LBP", amount: 3_600_001 }],
      }),
      EXTRA_ABOVE_TOTAL_MESSAGE,
    );
  });

  it("discount + extra on a USD job is refused", () => {
    expectRefused(
      usdJob({
        discount_usd: 2,
        final_amount_usd: 18,
        extra_usd: 1,
        payments: cash(19),
      }),
      DISCOUNT_AND_EXTRA_MESSAGE,
    );
  });

  it("discount + extra on an LBP job (discount folded into final_amount_lbp) is refused", () => {
    expectRefused(
      lbpJob({
        final_amount_lbp: 1_700_000,
        extra_lbp: 50_000,
        payments: [{ method: "CASH", currency_code: "LBP", amount: 1_750_000 }],
      }),
      DISCOUNT_AND_EXTRA_MESSAGE,
    );
  });

  it("an extra in the other currency is refused (USD job, LBP extra)", () => {
    expectRefused(
      usdJob({
        extra_lbp: 89_500,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 20 },
          { method: "CASH", currency_code: "LBP", amount: 89_500 },
        ],
      }),
      /job's currency/,
    );
  });

  it("an extra on a session-basket job is refused — the basket checkout takes it", () => {
    expectRefused(
      usdJob({ extra_usd: 1, payments: [] }),
      EXTRA_ON_SESSION_ITEM_MESSAGE,
      { deferPayment: true },
    );
  });
});

describe("Maintenance checkout — extra on the client's account (T053, failing-first)", () => {
  it("$6 labour + $1 extra fully on CUSTOMER_ACCOUNT → client debt +7; void → 0", () => {
    const clientId = addClient();
    const before = snapshotLedgers(db);
    const res = save(
      usdJob({
        client_id: clientId,
        cost_usd: 2,
        price_usd: 6,
        final_amount_usd: 6,
        extra_usd: 1,
        payments: [
          { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 7 },
        ],
      }),
    );
    expect(res).toEqual({ success: true, id: expect.any(Number) });
    const txn = jobTxn(res.id!);
    expect(txn).toMatchObject({ amount_usd: 7, profit_usd: 4, extra_usd: 1 });
    expectPostings(before, snapshotLedgers(db), {
      debt: { [`${clientId}|USD`]: 7 },
    });

    t1(() => getTransactionRepository().voidTransaction(txn.id, USER_ID));
    expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
      drawers: {},
      supplier: {},
      partner: {},
      debt: {},
    });
    expect(activeTotals()).toEqual({
      profitUsd: 0,
      profitLbp: 0,
      extraUsd: 0,
      extraLbp: 0,
    });
  });
});
