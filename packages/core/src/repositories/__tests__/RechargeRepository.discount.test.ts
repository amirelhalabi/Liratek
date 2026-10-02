/**
 * LIRA-185 owner decision #1 (2026-10-02) — "make the MTC/Alfa Discount work".
 *
 * The payment sheet on the MTC/Alfa page offers a Discount field. Before
 * this fix the discount never reached the server: the sheet lowered the
 * amount due, the page still submitted the full price, and the repository
 * either refused the sale (legs short of the price, no client) or booked the
 * gap as client debt — with profit stamped as if no discount was given.
 *
 * Contract built here (mirrors POS: `sales.discount` + `final_amount`, profit
 * on the amount actually charged):
 *   - the caller sends `price` = the LIST price and `discount` = the amount
 *     taken off (sale currency);
 *   - the repository charges `price − discount` everywhere (recharges.price,
 *     transactions amount, leg reconciliation, debt remainder, profit stamp)
 *     and records the list price + discount in `metadata_json`;
 *   - a discount larger than the margin (`price − cost`) is REJECTED
 *     server-side, so a crafted payload cannot book a loss through it.
 *
 * Every case drives the REAL writers against the REAL schema
 * (`electron-app/create_db.sql`, fresh in-memory DB per case).
 */
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { RechargeRepository } from "../RechargeRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { DebtRepository, resetDebtRepository } from "../DebtRepository";
import { resetDebtService } from "../../services/DebtService";
import { resetCarrierLineRepository } from "../CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository";
import { resetCarrierLineService } from "../../services/CarrierLineService";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { createRechargeSchema } from "../../validators/recharge";

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

type G = { __LIRATEK_TEST_DB__?: Database.Database };
let db: Database.Database;

function resetSingletons(): void {
  resetTransactionRepository();
  resetDebtService();
  resetDebtRepository();
  resetCarrierLineRepository();
  resetCarrierLineMovementRepository();
  resetCarrierLineService();
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(SCHEMA);
  db.pragma("foreign_keys = OFF");
  (globalThis as G).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  resetSingletons();
  const seed = db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  for (const [d, c, b] of [
    ["MTC", "USD", 1000],
    ["Alfa", "USD", 1000],
    ["General", "USD", 5000],
    ["General", "LBP", 500_000_000],
  ] as const)
    seed.run(d, c, b);
  db.prepare(
    `INSERT INTO carrier_lines (tenant_id, carrier, phone_number, label, credits, validity_expires_at, is_active, is_primary)
     VALUES (1, 'mtc', '03123456', 'Shop MTC', 500, '2099-01-01', 1, 1)`,
  ).run();
  db.prepare(
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (7, 1, 'Rami', '70111222')`,
  ).run();
});

afterEach(() => {
  resetTenantContext();
  resetSingletons();
  delete (globalThis as G).__LIRATEK_TEST_DB__;
  db.close();
});

type ProcessInput = Parameters<RechargeRepository["processRecharge"]>[0];
const repo = () => new RechargeRepository();

/** The owner's archetype: MTC $3 credit, list price 300,000 LBP, cost 255,000. */
function mtc3(extra: Record<string, unknown> = {}): ProcessInput {
  return {
    provider: "MTC",
    type: "CREDIT_TRANSFER",
    amount: 3,
    cost: 255_000,
    price: 300_000,
    currency: "LBP",
    phoneNumber: "03999001",
    payments: [{ method: "CASH", currencyCode: "LBP", amount: 300_000 }],
    userId: 1,
    ...extra,
  } as ProcessInput;
}

function drawers(): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT drawer_name, currency_code, balance FROM drawer_balances ORDER BY drawer_name, currency_code`,
    )
    .all() as { drawer_name: string; currency_code: string; balance: number }[];
  return Object.fromEntries(
    rows.map((r) => [`${r.drawer_name}:${r.currency_code}`, r.balance]),
  );
}

function rechargeTxn(rechargeId: number) {
  return db
    .prepare(
      `SELECT id, amount_lbp, profit_usd, profit_lbp, metadata_json FROM transactions
       WHERE source_table='recharges' AND source_id=? AND type='RECHARGE'`,
    )
    .get(rechargeId) as {
    id: number;
    amount_lbp: number;
    profit_usd: number;
    profit_lbp: number;
    metadata_json: string;
  };
}

function legsTotalLbp(txnId: number): number {
  return (
    db
      .prepare(
        `SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE transaction_id=? AND currency_code='LBP' AND drawer_name='General'`,
      )
      .get(txnId) as { s: number }
  ).s;
}

function debtRows(): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM debt_ledger`).get() as { n: number }
  ).n;
}

function netProfitLbp(): number {
  return (
    db
      .prepare(
        `SELECT COALESCE(SUM(profit_lbp),0) AS s FROM transactions WHERE type IN ('RECHARGE','REFUND')`,
      )
      .get() as { s: number }
  ).s;
}

describe("LIRA-185 #1 — MTC/Alfa payment-sheet discount", () => {
  it("schema keeps the discount key (Zod would otherwise strip it on BOTH transports) and rejects a negative one", () => {
    const ok = createRechargeSchema.safeParse(mtc3({ discount: 20_000 }));
    expect(ok.success).toBe(true);
    expect(ok.success && (ok.data as Record<string, unknown>).discount).toBe(
      20_000,
    );
    expect(createRechargeSchema.safeParse(mtc3({ discount: -1 })).success).toBe(
      false,
    );
  });

  it("$3 credit at 300,000 with a 20,000 discount charges 280,000: row, transaction, legs, drawer all 280,000; profit drops by exactly 20,000; no debt", () => {
    // Baseline (no discount) for the "drops by exactly" comparison.
    const baseRes = repo().processRecharge(mtc3());
    expect(baseRes.success).toBe(true);
    const baseProfit = rechargeTxn(baseRes.id as number).profit_lbp;

    const before = drawers();
    const res = repo().processRecharge(
      mtc3({
        discount: 20_000,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 280_000 }],
      }),
    );
    expect(res).toEqual(expect.objectContaining({ success: true }));
    const id = res.id as number;

    const row = db
      .prepare(
        `SELECT price, default_price_to_client FROM recharges WHERE id=?`,
      )
      .get(id) as { price: number };
    expect(row.price).toBe(280_000);

    const txn = rechargeTxn(id);
    expect(txn.amount_lbp).toBe(280_000);
    expect(legsTotalLbp(txn.id)).toBe(280_000);
    expect(drawers()["General:LBP"] - before["General:LBP"]).toBe(280_000);
    expect(txn.profit_lbp).toBe(baseProfit - 20_000);
    expect(txn.profit_lbp).toBe(25_000);

    const meta = JSON.parse(txn.metadata_json) as Record<string, unknown>;
    expect(meta.discount).toBe(20_000);
    expect(meta.list_price).toBe(300_000);
    expect(meta.price).toBe(280_000);

    expect(debtRows()).toBe(0);
  });

  it("with a client selected, a fully-paid discounted sale creates NO client debt", () => {
    const res = repo().processRecharge(
      mtc3({
        clientId: 7,
        discount: 20_000,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 280_000 }],
      }),
    );
    expect(res.success).toBe(true);
    expect(debtRows()).toBe(0);
  });

  it("a discount above the plain margin (price − cost) is refused server-side and writes nothing", () => {
    const before = drawers();
    const res = repo().processRecharge(
      mtc3({
        discount: 45_001,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 254_999 }],
      }),
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/discount/i);
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM recharges`).get() as { n: number })
        .n,
    ).toBe(0);
    expect(drawers()).toEqual(before);
  });

  // LIRA-185 #1 follow-up (owner decision 2026-10-02) — "cap = margin − SMS
  // fee". mtc3() is a CREDIT_TRANSFER of $3, one SMS (ceil(3/3)=1 message,
  // MAX_CREDIT_PER_SMS_USD=3). `create_db.sql` seeds a default LBP sell rate
  // of 90,000 — SMS fee in LBP = 0.16 * 90,000 = 14,400. Plain margin
  // 45,000 − 14,400 = 30,600.
  // NOT proven failing-first (LIRA-185): verified by toggling the fix in
  // place, which rule 17 does not accept.
  describe("the SMS-aware cap (CREDIT_TRANSFER burns an SMS_Transfer_Fee expense on top of cost)", () => {
    const SMS_FEE_LBP = 14_400; // 0.16 USD * 90,000 (seeded sell_rate)
    const SMS_AWARE_CAP = 45_000 - SMS_FEE_LBP; // 30,600

    it("a discount ABOVE the SMS-aware cap but still under the plain margin (35,000) is refused — the plain-margin check alone would have allowed it", () => {
      const before = drawers();
      const res = repo().processRecharge(
        mtc3({
          discount: 35_000,
          payments: [{ method: "CASH", currencyCode: "LBP", amount: 265_000 }],
        }),
      );
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/discount/i);
      expect(
        (
          db.prepare(`SELECT COUNT(*) AS n FROM recharges`).get() as {
            n: number;
          }
        ).n,
      ).toBe(0);
      expect(drawers()).toEqual(before);
    });

    it("a discount exactly at the SMS-aware cap (30,600) is allowed; stamped profit minus the SMS expense nets to exactly 0", () => {
      const res = repo().processRecharge(
        mtc3({
          discount: SMS_AWARE_CAP,
          payments: [
            {
              method: "CASH",
              currencyCode: "LBP",
              amount: 300_000 - SMS_AWARE_CAP,
            },
          ],
        }),
      );
      expect(res).toEqual(expect.objectContaining({ success: true }));
      const id = res.id as number;
      const txn = rechargeTxn(id);
      // Gross profit stamp = margin − discount = 45,000 − 30,600 = 14,400 —
      // exactly the SMS fee, by construction of the cap.
      expect(txn.profit_lbp).toBe(SMS_FEE_LBP);

      const smsExpense = db
        .prepare(
          `SELECT amount_usd FROM expenses WHERE source_ref_table='recharges' AND source_ref_id=? AND category='SMS_Transfer_Fee'`,
        )
        .get(id) as { amount_usd: number } | undefined;
      expect(smsExpense?.amount_usd).toBeCloseTo(0.16, 6);

      // Net (stamped profit − SMS expense, both converted to LBP at the
      // SAME seeded sell rate) is >= 0, and exactly 0 at the cap boundary.
      const netLbp = txn.profit_lbp - (smsExpense?.amount_usd ?? 0) * 90_000;
      expect(netLbp).toBeCloseTo(0, 6);
    });

    it("one unit more than the SMS-aware cap (30,601) is refused", () => {
      const res = repo().processRecharge(
        mtc3({
          discount: SMS_AWARE_CAP + 1,
          payments: [
            {
              method: "CASH",
              currencyCode: "LBP",
              amount: 300_000 - SMS_AWARE_CAP - 1,
            },
          ],
        }),
      );
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/discount/i);
    });

    it("the SMS fee does NOT shrink the cap for a type with no SMS fee (VOUCHER keeps the plain margin)", () => {
      const res = repo().processRecharge(
        mtc3({
          type: "VOUCHER",
          phoneNumber: undefined,
          discount: 45_000, // the PLAIN margin, above the SMS-aware figure
          payments: [{ method: "CASH", currencyCode: "LBP", amount: 255_000 }],
        }),
      );
      expect(res).toEqual(expect.objectContaining({ success: true }));
      expect(rechargeTxn(res.id as number).profit_lbp).toBe(0);
    });
  });

  it("a discount on a credit buy-back (a payout, not a sale) is refused", () => {
    const res = repo().processRecharge(
      mtc3({
        type: "CREDIT_BUYBACK",
        phoneNumber: "03123456",
        price: 250_000,
        cost: 0,
        discount: 10_000,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 240_000 }],
      }),
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/discount/i);
  });

  it("void of a discounted sale nets every drawer and the profit to 0", () => {
    const before = drawers();
    const res = repo().processRecharge(
      mtc3({
        discount: 20_000,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 280_000 }],
      }),
    );
    expect(res.success).toBe(true);
    getTransactionRepository().voidTransaction(
      rechargeTxn(res.id as number).id,
      1,
    );
    const after = drawers();
    for (const k of Object.keys(before))
      expect(after[k]).toBeCloseTo(before[k], 6);
  });

  it("refund of a discounted sale nets every drawer and the profit to 0", () => {
    const before = drawers();
    const res = repo().processRecharge(
      mtc3({
        discount: 20_000,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 280_000 }],
      }),
    );
    expect(res.success).toBe(true);
    getTransactionRepository().refundTransaction(
      rechargeTxn(res.id as number).id,
      1,
    );
    const after = drawers();
    for (const k of Object.keys(before))
      expect(after[k]).toBeCloseTo(before[k], 6);
    expect(netProfitLbp()).toBeCloseTo(0, 6);
  });
});

describe("LIRA-185 #4 — History 'profit pending until paid' flag", () => {
  it("a sale charged to the customer's account reads profit_pending = 1 until repaid, then 0", () => {
    const res = repo().processRecharge(
      mtc3({
        clientId: 7,
        payments: [
          { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 300_000 },
        ],
        paid_by_method: "CUSTOMER_ACCOUNT",
      }),
    );
    expect(res.success).toBe(true);
    const pendingOf = () =>
      (
        repo()
          .getHistory("MTC")
          .find((r) => r.id === res.id) as { profit_pending?: number }
      ).profit_pending;
    expect(pendingOf()).toBe(1);

    new DebtRepository().addRepayment({
      client_id: 7,
      amount_usd: 0,
      amount_lbp: 300_000,
      created_by: 1,
    });
    expect(pendingOf()).toBe(0);
  });

  it("a cash-paid sale reads profit_pending = 0", () => {
    const res = repo().processRecharge(mtc3());
    const row = repo()
      .getHistory("MTC")
      .find((r) => r.id === res.id) as { profit_pending?: number };
    expect(row.profit_pending).toBe(0);
  });
});
