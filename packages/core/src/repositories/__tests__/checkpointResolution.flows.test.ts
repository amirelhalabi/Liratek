/**
 * LIRA-335 T015 — every money flow that takes Set custom time resolves a
 * checkpoint's open difference, and create + void nets to zero on every
 * ledger, per currency (rule 28d: one table-driven case per flow and mode;
 * spec FR-006, FR-009, SC-002).
 *
 * Each case drives the flow's REAL repository writer on the REAL schema
 * (create_db.sql + every migration) with a custom `transaction_time` before
 * a checkpoint of the drawer it moves. The checkpoint was counted with the
 * missed money already inside (Over for money IN, Short for money OUT), so:
 *   1. the drawer the case targets does not move for the resolved part, and
 *      one resolution of that amount exists on the flow's own transaction;
 *   2. voiding the transaction (reversible types) puts every ledger back to
 *      where it stood before the save, per currency, and the difference is
 *      open again. Types the generic void refuses keep their resolution —
 *      their module correction is a new movement, like a refund (FR-009).
 *
 * Rule 17: written before the flows called the engine. The failing lines
 * for the first run are recorded in the Lane B report.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  getClosingRepository,
  resetClosingRepository,
} from "../ClosingRepository";
import {
  getCheckpointDifferenceRepository,
  resetCheckpointDifferenceRepository,
} from "../CheckpointDifferenceRepository";
import { DebtRepository, resetDebtRepository } from "../DebtRepository";
import {
  ExchangeRepository,
  resetExchangeRepository,
} from "../ExchangeRepository";
import { resetExchangeLotRepository } from "../ExchangeLotRepository";
import { resetExpenseRepository } from "../ExpenseRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetRateRepository } from "../RateRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetSettingsRepository } from "../SettingsRepository";
import { resetDebtService } from "../../services/DebtService";
import {
  getFinancialServiceRepository,
  resetFinancialServiceRepository,
} from "../FinancialServiceRepository";
import {
  getRechargeRepository,
  resetRechargeRepository,
} from "../RechargeRepository";
import {
  getCustomServiceRepository,
  resetCustomServiceRepository,
} from "../CustomServiceRepository";
import {
  getLotoTicketRepository,
  resetLotoTicketRepository,
} from "../LotoTicketRepository";
import {
  getHoldMoneyRepository,
  resetHoldMoneyRepository,
} from "../HoldMoneyRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetCarrierLineRepository } from "../CarrierLineRepository";
import {
  getMaintenanceService,
  resetMaintenanceService,
} from "../../services/MaintenanceService";
import { createCustomServiceSchema } from "../../validators/customService";
import { saveMaintenanceJobSchema } from "../../validators/maintenance";
import { holdMoneyCollectSchema } from "../../validators/holdMoney";
import { CHECKPOINT_RESOLUTION_METHOD } from "../../constants/checkpointAdjustment";
import { snapshotLedgers, expectPostings } from "../testHelpers/postingAssert";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf-8",
);
const USER_ID = 1;
const CLIENT_ID = 1;
const RATE = 89_500;
const MON_1410 = "2026-10-12T14:10:00.000Z";
const MON_0900 = "2026-10-12T09:00:00.000Z";
const MON_1800 = "2026-10-12T18:00:00.000Z";

let db: Database.Database;
/** The hold the pickup case collects (set by its `setup`). */
let heldId = 0;

function resetAllRepositories(): void {
  resetTransactionRepository();
  resetClosingRepository();
  resetCheckpointDifferenceRepository();
  resetDebtRepository();
  resetDebtService();
  resetExchangeRepository();
  resetExchangeLotRepository();
  resetExpenseRepository();
  resetPartnerRepository();
  resetRateRepository();
  resetPaymentMethodRepository();
  resetClientRepository();
  resetSettingsRepository();
  resetFinancialServiceRepository();
  resetRechargeRepository();
  resetCustomServiceRepository();
  resetLotoTicketRepository();
  resetHoldMoneyRepository();
  resetSupplierRepository();
  resetCarrierLineRepository();
  resetMaintenanceService();
}

beforeEach(() => {
  resetAllRepositories();
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  initDatabase(db);
  runMigrations(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  const seed = db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  for (const [d, c, b] of [
    ["General", "USD", 10_000],
    ["General", "LBP", 900_000_000],
    ["OMT_System", "USD", 5_000],
    ["OMT_System", "LBP", 100_000_000],
    ["Alfa", "USD", 1_000],
  ] as const)
    seed.run(d, c, b);
  db.prepare(
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (?, 1, 'Flow Client', '70111222')`,
  ).run(CLIENT_ID);
  const rate = db.prepare(
    `INSERT OR REPLACE INTO exchange_rates (tenant_id, to_code, market_rate, buy_rate, sell_rate, is_stronger) VALUES (1, ?, ?, ?, ?, ?)`,
  );
  rate.run("LBP", RATE, 89_000, 90_000, 1);
});

afterEach(() => {
  resetTenantContext();
  resetAllRepositories();
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

/** Count `drawer` at Monday 18:00 with `missed` already in it (> 0 Over,
 *  < 0 Short) and return the difference id it records. */
function checkpointWithMissed(
  drawer: string,
  currency: string,
  missed: number,
): number {
  const res = runWithTenant(
    1,
    () =>
      getClosingRepository().createCheckpoint({
        user_id: USER_ID,
        drawer_name: drawer,
        closing_date: "2026-10-12",
        amounts: [
          {
            drawer_name: drawer,
            currency_code: currency,
            expected_amount: 0,
            physical_amount: balance(drawer, currency) + missed,
          },
        ],
      }),
    { effectiveNow: MON_1800 },
  );
  expect(res.success).toBe(true);
  const closingId = Number(res.id);
  const [d] =
    getCheckpointDifferenceRepository()
      .listForClosings([closingId])
      .get(closingId) ?? [];
  expect(d).toMatchObject({ drawer_name: drawer, currency_code: currency });
  expect(d.amount).toBeCloseTo(missed, 6);
  return d.id;
}

function txnOf(sourceTable: string, sourceId: number, type?: string): number {
  const row = db
    .prepare(
      `SELECT id FROM transactions
        WHERE source_table = ? AND source_id = ? AND reverses_id IS NULL
          ${type ? "AND type = ?" : ""}
        ORDER BY id LIMIT 1`,
    )
    .get(
      ...(type ? [sourceTable, sourceId, type] : [sourceTable, sourceId]),
    ) as { id: number } | undefined;
  expect(row).toBeDefined();
  return row!.id;
}

function txnOfDebtLedger(ledgerId: number): number {
  const row = db
    .prepare(`SELECT transaction_id FROM debt_ledger WHERE id = ?`)
    .get(ledgerId) as { transaction_id: number };
  return row.transaction_id;
}

interface FlowCase {
  name: string;
  drawer: string;
  currency: string;
  /** Signed drawer movement the flow makes on `drawer` (> 0 money IN). */
  movement: number;
  /** Seed anything the flow needs before the checkpoint is taken. */
  setup?: () => void;
  /** Save the flow with `time` as its custom time; return its transaction. */
  save: (time: string) => number;
  /** How the transaction is undone: the generic void, a module-owned
   *  reversal (both must reopen the difference and net every ledger to 0),
   *  or "none" — the generic void refuses the type and the module has no
   *  reversal, so the resolution stays like a refund's (FR-009). */
  reverse: "generic" | "none" | ((txnId: number) => void);
}

const CASES: FlowCase[] = [
  {
    name: "debt repayment in cash (money IN General USD)",
    drawer: "General",
    currency: "USD",
    movement: 30,
    setup: () => {
      new DebtRepository().addAccountCashEntry({
        direction: "debt",
        client_id: CLIENT_ID,
        amount_usd: 30,
        amount_lbp: 0,
        note: "old balance",
        created_by: USER_ID,
        move_cash: false,
      });
    },
    save: (time) =>
      txnOfDebtLedger(
        new DebtRepository().addRepayment({
          client_id: CLIENT_ID,
          amount_usd: 30,
          amount_lbp: 0,
          created_by: USER_ID,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 30 }],
          tender_exchange_rate: RATE,
          transaction_time: time,
        }).id,
      ),
    reverse: "generic",
  },
  {
    name: "account credit cashed out (money OUT General USD, module-owned reversal)",
    drawer: "General",
    currency: "USD",
    movement: -20,
    setup: () => {
      new DebtRepository().addAccountCashEntry({
        direction: "credit",
        client_id: CLIENT_ID,
        amount_usd: 40,
        amount_lbp: 0,
        created_by: USER_ID,
      });
    },
    save: (time) =>
      txnOfDebtLedger(
        new DebtRepository().cashOutCredit({
          client_id: CLIENT_ID,
          amount_usd: 20,
          amount_lbp: 0,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 20 }],
          created_by: USER_ID,
          transaction_time: time,
        }).id,
      ),
    reverse: "none",
  },
  {
    name: "account cash entry: money left as credit (money IN General USD, module-owned reversal)",
    drawer: "General",
    currency: "USD",
    movement: 25,
    save: (time) =>
      txnOfDebtLedger(
        new DebtRepository().addAccountCashEntry({
          direction: "credit",
          client_id: CLIENT_ID,
          amount_usd: 25,
          amount_lbp: 0,
          payments: [{ method: "CASH", currencyCode: "USD", amount: 25 }],
          created_by: USER_ID,
          transaction_time: time,
        }).id,
      ),
    reverse: "none",
  },
  {
    name: "exchange USD → LBP (USD IN General resolves; LBP paid out moves as today)",
    drawer: "General",
    currency: "USD",
    movement: 100,
    save: (time) => {
      const { id } = new ExchangeRepository().createTransaction({
        fromCurrency: "USD",
        toCurrency: "LBP",
        amountIn: 100,
        amountOut: 8_950_000,
        leg1Rate: RATE,
        leg1MarketRate: 89_000,
        leg1ProfitUsd: 0.5,
        totalProfitUsd: 0.5,
        note: "Exchange USD → LBP",
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 8_950_000 }],
        tender_exchange_rate: RATE,
        transaction_time: time,
      });
      return txnOf("exchange_transactions", id);
    },
    reverse: "generic",
  },
  {
    name: "OMT send paid in cash (money IN the OMT_System cash drawer)",
    drawer: "OMT_System",
    currency: "USD",
    movement: 105,
    save: (time) => {
      const { id } = getFinancialServiceRepository().createTransaction({
        userId: USER_ID,
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        commission: 0,
        omtServiceType: "INTRA",
        omtFee: 5,
        includingFees: false,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 105 }],
        transaction_time: time,
      });
      return txnOf("financial_services", id, "FINANCIAL_SERVICE");
    },
    reverse: "generic",
  },
  {
    name: "OMT receive paid out in cash (money OUT of the OMT_System cash drawer)",
    drawer: "OMT_System",
    currency: "USD",
    movement: -100,
    save: (time) => {
      const { id } = getFinancialServiceRepository().createTransaction({
        userId: USER_ID,
        exchangeRate: RATE,
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 100,
        currency: "USD",
        commission: 0,
        omtServiceType: "INTRA",
        cashoutMethod: "CASH",
        payments: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
        transaction_time: time,
      });
      return txnOf("financial_services", id, "FINANCIAL_SERVICE");
    },
    reverse: "generic",
  },
  {
    name: "Alfa gift recharge paid in LBP cash (General LBP resolves; the Alfa stock follows its lines as today)",
    drawer: "General",
    currency: "LBP",
    movement: 300_000,
    save: (time) => {
      const res = getRechargeRepository().processRecharge({
        userId: USER_ID,
        provider: "Alfa",
        type: "ALFA_GIFT",
        amount: 3,
        cost: 255_000,
        price: 300_000,
        currency: "LBP",
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 300_000 }],
        transaction_time: time,
      });
      expect(res.error).toBeUndefined();
      return txnOf("recharges", res.id!, "RECHARGE");
    },
    reverse: "generic",
  },
  {
    name: "custom service paid in cash (money IN General USD)",
    drawer: "General",
    currency: "USD",
    movement: 9,
    save: (time) => {
      const res = getCustomServiceRepository().createService(
        createCustomServiceSchema.parse({
          description: "Screen protector fitting",
          cost_usd: 7,
          price_usd: 9,
          paid_by: "CASH",
          exchange_rate: RATE,
          payments: [{ method: "CASH", currency_code: "USD", amount: 9 }],
          transaction_time: time,
        }),
        USER_ID,
      );
      expect(res.error).toBeUndefined();
      return txnOf("custom_services", res.id!, "CUSTOM_SERVICE");
    },
    reverse: "generic",
  },
  {
    name: "repair delivered and paid in cash (money IN General USD)",
    drawer: "General",
    currency: "USD",
    movement: 13.37,
    save: (time) => {
      const res = getMaintenanceService().saveJob(
        saveMaintenanceJobSchema.parse({
          device_name: "Phone",
          issue_description: "screen",
          currency: "USD",
          cost_usd: 5,
          price_usd: 13.37,
          final_amount_usd: 13.37,
          status: "Delivered_Paid",
          exchange_rate: RATE,
          payments: [{ method: "CASH", currency_code: "USD", amount: 13.37 }],
          transaction_time: time,
        }),
        USER_ID,
      );
      expect(res.error).toBeUndefined();
      return txnOf("maintenance", res.id!, "MAINTENANCE");
    },
    reverse: "generic",
  },
  {
    name: "loto ticket sold for LBP cash (money IN General LBP)",
    drawer: "General",
    currency: "LBP",
    movement: 500_000,
    save: (time) => {
      const t = getLotoTicketRepository().createTicket({
        sale_amount: 500_000,
        commission_amount: 25_000,
        commission_rate: 0.05,
        sale_date: "2026-10-12",
        currency: "LBP",
        userId: USER_ID,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 500_000 }],
        transaction_time: time,
      });
      return txnOf("loto_tickets", t.id, "LOTO");
    },
    reverse: "generic",
  },
  {
    name: "hold money drop-off (money IN General USD, no reversal: a pickup is its correction)",
    drawer: "General",
    currency: "USD",
    movement: 50,
    save: (time) => {
      const h = getHoldMoneyRepository().createHold(
        {
          client_name: "Rami",
          usd_amount: 50,
          lbp_amount: 0,
          transaction_time: time,
        },
        USER_ID,
      );
      expect(h.error).toBeUndefined();
      return txnOf("hold_money", h.id!, "HOLD_MONEY");
    },
    reverse: "none",
  },
  {
    name: "hold money pickup (money OUT of General USD, reversed by Void pickup) — reopen needs ACTIVE_RESOLUTION_SQL to treat a HOLD_MONEY_COLLECT_VOID reversal as voided (integration)",
    drawer: "General",
    currency: "USD",
    movement: -50,
    setup: () => {
      const h = getHoldMoneyRepository().createHold(
        { client_name: "Rami", usd_amount: 50, lbp_amount: 0 },
        USER_ID,
      );
      expect(h.error).toBeUndefined();
      heldId = h.id!;
    },
    save: (time) => {
      const res = getHoldMoneyRepository().collectHold(
        holdMoneyCollectSchema.parse({
          id: heldId,
          transaction_time: time,
          payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
        }),
        USER_ID,
      );
      expect(res.error).toBeUndefined();
      return txnOf("hold_money", heldId, "HOLD_MONEY_COLLECT");
    },
    reverse: () => {
      const hold = getHoldMoneyRepository();
      const [pickup] = hold.getPickups(heldId);
      const res = hold.voidPickup(pickup.id, USER_ID);
      expect(res.error).toBeUndefined();
    },
  },
];

describe("LIRA-335 — every back-timed flow resolves the first later checkpoint, and void nets to zero", () => {
  it.each(CASES)("$name", (c) => {
    // Anything the case needs already in the drawer is booked before the
    // count (the checkpoint measures the drawer as of its own time).
    if (c.setup) runWithTenant(1, c.setup, { effectiveNow: MON_0900 });
    const differenceId = checkpointWithMissed(c.drawer, c.currency, c.movement);
    const beforeSave = snapshotLedgers(db);
    const drawerBefore = balance(c.drawer, c.currency);

    const txnId = c.save(MON_1410);

    // 1. The resolved movement does not raise / lower the drawer again.
    expect(balance(c.drawer, c.currency)).toBeCloseTo(drawerBefore, 6);
    const legs = db
      .prepare(
        `SELECT drawer_name, currency_code, amount FROM payments WHERE transaction_id = ? AND method = ?`,
      )
      .all(txnId, CHECKPOINT_RESOLUTION_METHOD);
    expect(legs).toEqual([
      {
        drawer_name: c.drawer,
        currency_code: c.currency,
        amount: expect.closeTo(-c.movement, 6),
      },
    ]);
    const d = getCheckpointDifferenceRepository().getById(differenceId)!;
    expect(d.status).toBe("RESOLVED");
    expect(d.resolutions.map((r) => [r.transaction_id, r.amount])).toEqual([
      [txnId, expect.closeTo(c.movement, 6)],
    ]);

    // 2. Undo: every ledger back to before the save; the difference reopens.
    if (c.reverse === "none") {
      expect(() =>
        getTransactionRepository().voidTransaction(txnId, USER_ID),
      ).toThrow();
      expect(
        getCheckpointDifferenceRepository().getById(differenceId)!.status,
      ).toBe("RESOLVED");
      return;
    }
    if (c.reverse === "generic") {
      getTransactionRepository().voidTransaction(txnId, USER_ID);
    } else {
      c.reverse(txnId);
    }
    expectPostings(beforeSave, snapshotLedgers(db), {});
    expect(
      getCheckpointDifferenceRepository().getById(differenceId)!.status,
    ).toBe("OPEN");
  });
});
