/**
 * LIRA-335 T012 — the resolution engine on the owner's worked example
 * (spec "Background", User Story 1, FR-004..FR-010, FR-016).
 *
 * Real schema (create_db.sql + every migration), real `createCheckpoint`,
 * real `processSale` / `createExpense`. Checkpoints are taken at a chosen
 * instant through the replay clock (`runWithTenant(..., { effectiveNow })`),
 * so "Monday 18:00" is a real stored time; transactions are saved now with a
 * custom `transaction_time` before it.
 *
 * Rule 17: written before the flows called the engine. First run on the
 * unwired code: the worked example failed with General at 1100 (expected
 * 1050) — the back-timed sale raised the drawer a second time.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { z } from "zod";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext";
import {
  SalesRepository,
  resetSalesRepository,
  type SaleRequest,
} from "../SalesRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  getClosingRepository,
  resetClosingRepository,
} from "../ClosingRepository";
import {
  ExpenseRepository,
  resetExpenseRepository,
} from "../ExpenseRepository";
import {
  getCheckpointDifferenceRepository,
  resetCheckpointDifferenceRepository,
} from "../CheckpointDifferenceRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetStockBatchRepository } from "../StockBatchRepository";
import { resetProductUnitRepository } from "../ProductUnitRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetProfitRepository } from "../ProfitRepository";
import { resetDebtService } from "../../services/DebtService";
import { saleProcessSchema } from "../../validators/sale";
import { CHECKPOINT_RESOLUTION_METHOD } from "../../constants/checkpointAdjustment";
import { getOpenDifferencesAfter } from "../checkpointResolution";
import {
  getRechargeRepository,
  resetRechargeRepository,
} from "../RechargeRepository";

type SalePayload = z.input<typeof saleProcessSchema>;

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf-8",
);
const USER_ID = 1;
const RATE = 89_500;
const MON_1410 = "2026-10-12T14:10:00.000Z";
const MON_1620 = "2026-10-12T16:20:00.000Z";
const MON_1800 = "2026-10-12T18:00:00.000Z";
const TUE_0900 = "2026-10-13T09:00:00.000Z";

let db: Database.Database;

function resetAll(): void {
  resetSalesRepository();
  resetTransactionRepository();
  resetClosingRepository();
  resetExpenseRepository();
  resetCheckpointDifferenceRepository();
  resetPartnerRepository();
  resetStockBatchRepository();
  resetProductUnitRepository();
  resetDebtRepository();
  resetProfitRepository();
  resetDebtService();
  resetRechargeRepository();
}

beforeEach(() => {
  resetAll();
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  initDatabase(db);
  runMigrations(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  const seed = db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  seed.run("General", "USD", 1000);
  seed.run("General", "LBP", 0);
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

function balance(drawer: string, currency: string): number {
  const r = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ? AND tenant_id = 1`,
    )
    .get(drawer, currency) as { balance: number } | undefined;
  return r?.balance ?? 0;
}

/** A General checkpoint taken at `at`, counting the given amounts. */
function checkpoint(at: string, counted: Record<string, number>): number {
  const res = runWithTenant(
    1,
    () =>
      getClosingRepository().createCheckpoint({
        user_id: USER_ID,
        drawer_name: "General",
        closing_date: at.slice(0, 10),
        amounts: Object.entries(counted).map(
          ([currency_code, physical_amount]) => ({
            drawer_name: "General",
            currency_code,
            expected_amount: 0,
            physical_amount,
          }),
        ),
      }),
    { effectiveNow: at },
  );
  expect(res.success).toBe(true);
  return Number(res.id);
}

function differences(closingId: number) {
  return (
    getCheckpointDifferenceRepository()
      .listForClosings([closingId])
      .get(closingId) ?? []
  );
}

function addProduct(price: number): number {
  return Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, ?, 'Product', 1, ?, 10)`,
      )
      .run(`P-${Math.random()}`, price).lastInsertRowid,
  );
}

function addClient(): number {
  return Number(
    db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Rami', '03111222')`,
      )
      .run().lastInsertRowid,
  );
}

/** A one-item sale of `price` paid by `payments`, saved at `time`. */
function sell(
  price: number,
  payments: SalePayload["payments"],
  extra: Partial<SalePayload> = {},
): number {
  const payload: SalePayload = {
    client_id: null,
    items: [{ product_id: addProduct(price), quantity: 1, price }],
    total_amount: price,
    discount: 0,
    final_amount: price,
    payment_usd: 0,
    payment_lbp: 0,
    exchange_rate: RATE,
    status: "completed",
    payments,
    ...extra,
  };
  const res = new SalesRepository().processSale(
    saleProcessSchema.parse(payload) as SaleRequest,
    USER_ID,
  );
  expect(res.error).toBeUndefined();
  expect(res.success).toBe(true);
  const txn = db
    .prepare(
      `SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`,
    )
    .get(res.id) as { id: number };
  return txn.id;
}

function cashSale(price: number, time?: string): number {
  return sell(
    price,
    [{ method: "CASH", currency_code: "USD", amount: price }],
    {
      ...(time ? { transaction_time: time } : {}),
    },
  );
}

function expense(amountUsd: number, time: string): number {
  const id = new ExpenseRepository().createExpense(
    {
      description: "Delivery",
      category: "Supplies",
      paid_by_method: "CASH",
      amount_usd: amountUsd,
      amount_lbp: 0,
      expense_date: time.slice(0, 10),
      transaction_time: time,
    },
    USER_ID,
  );
  return getTransactionRepository().getBySourceId("expenses", id)!.id;
}

function offsetLegs(
  txnId: number,
): { drawer_name: string; currency_code: string; amount: number }[] {
  return db
    .prepare(
      `SELECT drawer_name, currency_code, amount FROM payments WHERE transaction_id = ? AND method = ?`,
    )
    .all(txnId, CHECKPOINT_RESOLUTION_METHOD) as {
    drawer_name: string;
    currency_code: string;
    amount: number;
  }[];
}

function activeShortageExpenses(
  differenceId: number,
): { amount_usd: number }[] {
  return db
    .prepare(
      `SELECT e.amount_usd FROM expenses e
         JOIN transactions t ON t.source_table = 'expenses' AND t.source_id = e.id
        WHERE e.source_ref_table = 'checkpoint_differences' AND e.source_ref_id = ?
          AND t.status = 'ACTIVE' AND t.reverses_id IS NULL`,
    )
    .all(differenceId) as { amount_usd: number }[];
}

describe("LIRA-335 worked example — a re-entered sale resolves Monday's Over", () => {
  it("the $50 sale keeps General as counted, resolves the Over, and the next checkpoint is Balanced", () => {
    const monday = checkpoint(MON_1800, { USD: 1050 });
    expect(balance("General", "USD")).toBe(1050);
    const [over] = differences(monday);
    expect(over).toMatchObject({
      drawer_name: "General",
      currency_code: "USD",
      amount: 50,
      status: "OPEN",
    });

    const saleTxn = cashSale(50, MON_1410);

    expect(balance("General", "USD")).toBe(1050);
    expect(offsetLegs(saleTxn)).toEqual([
      { drawer_name: "General", currency_code: "USD", amount: -50 },
    ]);
    const [after] = differences(monday);
    expect(after.status).toBe("RESOLVED");
    expect(after.resolutions).toHaveLength(1);
    expect(after.resolutions[0]).toMatchObject({
      transaction_id: saleTxn,
      amount: 50,
    });

    const tuesday = checkpoint(TUE_0900, { USD: 1050 });
    expect(differences(tuesday)).toEqual([]);
  });

  it("a $60 sale resolves $50 and raises General by $10 only", () => {
    const monday = checkpoint(MON_1800, { USD: 1050 });
    const saleTxn = cashSale(60, MON_1410);
    expect(balance("General", "USD")).toBe(1060);
    expect(offsetLegs(saleTxn)).toEqual([
      { drawer_name: "General", currency_code: "USD", amount: -50 },
    ]);
    expect(differences(monday)[0].status).toBe("RESOLVED");
  });

  it("an expense out of General against an Over resolves nothing (wrong direction)", () => {
    const monday = checkpoint(MON_1800, { USD: 1050 });
    const txn = expense(12, MON_1620);
    expect(offsetLegs(txn)).toEqual([]);
    expect(balance("General", "USD")).toBe(1038);
    expect(differences(monday)[0].status).toBe("OPEN");
  });

  it("only the FIRST checkpoint after the time counts — a matched one blocks a later Over", () => {
    checkpoint(MON_1800, { USD: 1000 }); // matched
    const tuesday = checkpoint(TUE_0900, { USD: 1050 }); // Over 50
    const saleTxn = cashSale(50, MON_1410);
    expect(offsetLegs(saleTxn)).toEqual([]);
    expect(balance("General", "USD")).toBe(1100);
    expect(differences(tuesday)[0].status).toBe("OPEN");
  });

  it("a sale saved without a custom time behaves exactly as today", () => {
    const monday = checkpoint(MON_1800, { USD: 1050 });
    const saleTxn = cashSale(50);
    expect(offsetLegs(saleTxn)).toEqual([]);
    expect(balance("General", "USD")).toBe(1100);
    expect(differences(monday)[0].status).toBe("OPEN");
  });

  it("an offline sale replayed with its Monday event time resolves like a custom time (FR-006)", () => {
    const monday = checkpoint(MON_1800, { USD: 1050 });
    const saleTxn = runWithTenant(1, () => cashSale(50), {
      effectiveNow: "2026-10-12T14:10:00.000Z",
    });
    expect(balance("General", "USD")).toBe(1050);
    expect(offsetLegs(saleTxn)).toHaveLength(1);
    expect(differences(monday)[0].status).toBe("RESOLVED");
  });

  it("a split USD + LBP sale against an Over in USD resolves the USD part only", () => {
    const monday = checkpoint(MON_1800, { USD: 1050, LBP: 0 });
    const saleTxn = sell(
      60,
      [
        { method: "CASH", currency_code: "USD", amount: 50 },
        { method: "CASH", currency_code: "LBP", amount: 895_000 },
      ],
      { transaction_time: MON_1410 },
    );
    expect(offsetLegs(saleTxn)).toEqual([
      { drawer_name: "General", currency_code: "USD", amount: -50 },
    ]);
    expect(balance("General", "USD")).toBe(1050);
    expect(balance("General", "LBP")).toBe(895_000);
    expect(differences(monday)[0].status).toBe("RESOLVED");
  });

  it("money charged to the customer's account moves no drawer and resolves nothing", () => {
    const monday = checkpoint(MON_1800, { USD: 1050 });
    const clientId = addClient();
    const saleTxn = sell(
      50,
      [{ method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 50 }],
      {
        client_id: clientId,
        transaction_time: MON_1410,
      },
    );
    expect(offsetLegs(saleTxn)).toEqual([]);
    expect(differences(monday)[0].status).toBe("OPEN");
  });

  it("voiding the resolving sale reopens the difference and nets General to zero (FR-009)", () => {
    const monday = checkpoint(MON_1800, { USD: 1050 });
    const saleTxn = cashSale(50, MON_1410);
    getTransactionRepository().voidTransaction(saleTxn, USER_ID);
    expect(balance("General", "USD")).toBe(1050);
    const [d] = differences(monday);
    expect(d.status).toBe("OPEN");
    expect(d.resolutions).toEqual([]);
  });

  it("a refund of the resolving sale keeps the resolution and hands back $50 (FR-009)", () => {
    const monday = checkpoint(MON_1800, { USD: 1050 });
    const saleTxn = cashSale(50, MON_1410);
    getTransactionRepository().refundTransaction(saleTxn, USER_ID);
    expect(balance("General", "USD")).toBe(1000);
    expect(differences(monday)[0].status).toBe("RESOLVED");
  });
});

describe("LIRA-335 FR-016 — a closed Short later explained by a back-timed expense", () => {
  it("shrinks the Drawer shortage expense, voids it when fully explained, and a void grows it back", () => {
    const monday = checkpoint(MON_1800, { USD: 980 }); // Short 20
    const [short] = differences(monday);
    expect(short).toMatchObject({ amount: -20, direction: "SHORT" });
    expect(
      getCheckpointDifferenceRepository().close(short.id, USER_ID),
    ).toEqual({ success: true });
    expect(activeShortageExpenses(short.id)).toEqual([{ amount_usd: 20 }]);

    const first = expense(12, MON_1620);
    expect(balance("General", "USD")).toBe(980);
    expect(offsetLegs(first)).toEqual([
      { drawer_name: "General", currency_code: "USD", amount: 12 },
    ]);
    expect(activeShortageExpenses(short.id)).toEqual([{ amount_usd: 8 }]);
    expect(getCheckpointDifferenceRepository().getById(short.id)!.status).toBe(
      "CLOSED",
    );

    const second = expense(8, MON_1620);
    expect(balance("General", "USD")).toBe(980);
    expect(activeShortageExpenses(short.id)).toEqual([]);
    expect(getCheckpointDifferenceRepository().getById(short.id)!.status).toBe(
      "RESOLVED",
    );

    getTransactionRepository().voidTransaction(second, USER_ID);
    expect(balance("General", "USD")).toBe(980);
    expect(activeShortageExpenses(short.id)).toEqual([{ amount_usd: 8 }]);
    expect(getCheckpointDifferenceRepository().getById(short.id)!.status).toBe(
      "CLOSED",
    );
  });

  it("an open Short partly explained becomes Partly resolved with the rest open", () => {
    const monday = checkpoint(MON_1800, { USD: 980 });
    expense(12, MON_1620);
    const [d] = differences(monday);
    expect(d.status).toBe("PARTLY_RESOLVED");
    expect(d.open).toBeCloseTo(8, 6);
    expect(balance("General", "USD")).toBe(980);
  });
});

describe("LIRA-335 getOpenDifferencesAfter — what money saved at a time could resolve", () => {
  it("lists Monday's Over for a time before it, nothing after it", () => {
    const monday = checkpoint(MON_1800, { USD: 1050 });
    const before = getOpenDifferencesAfter(db, { at: MON_1410 });
    expect(
      before.map((d) => [d.closing_id, d.drawer_name, d.currency_code, d.open]),
    ).toEqual([[monday, "General", "USD", 50]]);
    expect(getOpenDifferencesAfter(db, { at: "2026-10-12 19:00:00" })).toEqual(
      [],
    );
  });

  it("lists nothing when the first checkpoint after the time matched", () => {
    checkpoint(MON_1800, { USD: 1000 });
    checkpoint(TUE_0900, { USD: 1050 });
    expect(getOpenDifferencesAfter(db, { at: MON_1410 })).toEqual([]);
  });

  it("drops a difference once it is fully resolved", () => {
    checkpoint(MON_1800, { USD: 1050 });
    cashSale(50, MON_1410);
    expect(getOpenDifferencesAfter(db, { at: MON_1410 })).toEqual([]);
  });
});

describe("LIRA-335 — MTC / Alfa drawers follow their SIM lines (not failing-first: regression guard written after the engine)", () => {
  it("a back-timed Alfa recharge never offsets the Alfa drawer, so drawer = Σ lines still holds", () => {
    db.prepare(
      `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'Alfa', 'USD', 1000)`,
    ).run();
    // A recorded Short on the Alfa drawer at Monday 18:00 (seeded: a real
    // carrier checkpoint needs counted lines, which this rule never reads).
    const closing = Number(
      db
        .prepare(
          `INSERT INTO daily_closings (tenant_id, closing_date, drawer_name, created_at) VALUES (1, '2026-10-12', 'Alfa', ?)`,
        )
        .run(MON_1800).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO daily_closing_amounts (tenant_id, closing_id, drawer_name, currency_code, opening_amount, physical_amount) VALUES (1, ?, 'Alfa', 'USD', 1003, 1000)`,
    ).run(closing);
    db.prepare(
      `INSERT INTO checkpoint_differences (tenant_id, closing_id, drawer_name, currency_code, amount, created_at, updated_at) VALUES (1, ?, 'Alfa', 'USD', -3, ?, ?)`,
    ).run(closing, MON_1800, MON_1800);

    const res = getRechargeRepository().processRecharge({
      userId: USER_ID,
      provider: "Alfa",
      type: "ALFA_GIFT",
      amount: 3,
      cost: 255_000,
      price: 300_000,
      currency: "LBP",
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 300_000 }],
      transaction_time: MON_1410,
    });
    expect(res.error).toBeUndefined();
    const txn = db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'recharges' AND source_id = ? AND type = 'RECHARGE'`,
      )
      .get(res.id) as { id: number };
    expect(offsetLegs(txn.id)).toEqual([]);
    expect(balance("Alfa", "USD")).toBe(997);
    expect(differences(closing)[0].status).toBe("OPEN");
    expect(getOpenDifferencesAfter(db, { at: MON_1410 })).toEqual([]);
  });
});

describe("LIRA-335 FR-008 — the resolving sale keeps its sales, profit and receipt", () => {
  function saleIdOf(txnId: number): number {
    return (
      db
        .prepare(`SELECT source_id FROM transactions WHERE id = ?`)
        .get(txnId) as { source_id: number }
    ).source_id;
  }
  function profitOf(txnId: number): number {
    return (
      db
        .prepare(`SELECT profit_usd FROM transactions WHERE id = ?`)
        .get(txnId) as { profit_usd: number }
    ).profit_usd;
  }

  it("profit and receipt tender match the same sale saved without a custom time (regression guard)", () => {
    checkpoint(MON_1800, { USD: 1050 });
    const resolving = cashSale(50, MON_1410);
    const control = cashSale(50);
    expect(offsetLegs(resolving)).toHaveLength(1);
    expect(profitOf(resolving)).toBe(profitOf(control));
    const receipt = new SalesRepository().getSaleWithCustomer(
      saleIdOf(resolving),
    )!;
    expect([receipt.tender_usd, receipt.tender_lbp]).toEqual([50, 0]);
  });

  it("change in LBP that resolves an LBP Short does not show on the receipt as LBP tender (failing-first)", () => {
    db.prepare(
      `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'LBP', 9000000)`,
    ).run();
    const monday = checkpoint(MON_1800, { USD: 1000, LBP: 8_100_000 }); // LBP Short 900,000
    const saleTxn = sell(
      100,
      [{ method: "CASH", currency_code: "USD", amount: 110 }],
      {
        change_given_lbp: 895_000,
        transaction_time: MON_1410,
      },
    );
    expect(offsetLegs(saleTxn)).toEqual([
      { drawer_name: "General", currency_code: "LBP", amount: 895_000 },
    ]);
    expect(balance("General", "LBP")).toBe(8_100_000);
    expect(
      differences(monday).find((d) => d.currency_code === "LBP")!.status,
    ).toBe("PARTLY_RESOLVED");
    const receipt = new SalesRepository().getSaleWithCustomer(
      saleIdOf(saleTxn),
    )!;
    expect([receipt.tender_usd, receipt.tender_lbp]).toEqual([110, 0]);
  });
});
