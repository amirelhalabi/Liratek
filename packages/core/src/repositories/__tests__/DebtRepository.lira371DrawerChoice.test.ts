/**
 * LIRA-371 — Debts → Repay: "OMT Cash Drawer | General".
 *
 * `cash_drawer: "GENERAL"` keeps the cash the default would route to the
 * system cash drawer in General (no internal RESERVE pair) and changes
 * nothing else: same debt ledger, same coverage, same profit. Refused
 * (nothing written) when the default routes nothing. Absent / SYSTEM =
 * today's posting, byte-identical.
 *
 * Failing-first (rule 17): see specs/371-settle-drawer-choice/tasks.md T010.
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  addClient,
  seedTransferDebt,
  seedSaleDebt,
  seedChargeDebt,
  setBaseSystem,
  drawers,
  drawerDelta,
  RATE,
} from "../testHelpers/debtItemDb";
import { DebtRepository, type CreateRepaymentData } from "../DebtRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetSessionPaymentService } from "../../services/SessionPaymentService";
import { resetSessionPaymentRepository } from "../SessionPaymentRepository";
import { resetCustomerSessionRepository } from "../CustomerSessionRepository";
import { resetSalesRepository } from "../SalesRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetSettingsRepository } from "../SettingsRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { cashDrawerChoiceNotApplicable } from "../../constants/cashDrawerChoice";

let db: Database.Database;
let repo: DebtRepository;

function resetAll(): void {
  resetSessionPaymentService();
  resetSessionPaymentRepository();
  resetCustomerSessionRepository();
  resetSalesRepository();
  resetClientRepository();
  resetSettingsRepository();
  resetPaymentMethodRepository();
  resetTransactionRepository();
}

function setup(): void {
  db = installDebtItemTestDb();
  initFixedTenantContext(1);
  resetAll();
  repo = new DebtRepository();
  addClient(db, 7, "Claude Demo", "03101010");
}

function teardown(): void {
  resetAll();
  resetTenantContext();
  uninstallDebtItemTestDb(db);
}

/** A twin run on a fresh database (same ids, same seeds). */
function fresh(): void {
  teardown();
  setup();
}

beforeEach(setup);
afterEach(teardown);

type Leg = {
  method: string;
  currencyCode: "USD" | "LBP";
  amount: number;
  direction?: "IN" | "OUT";
};

function repay(o: {
  usd?: number;
  lbp?: number;
  legs: Leg[];
  cashDrawer?: "SYSTEM" | "GENERAL";
}): number {
  const data: CreateRepaymentData = {
    client_id: 7,
    amount_usd: o.usd ?? 0,
    amount_lbp: o.lbp ?? 0,
    created_by: 1,
    payments: o.legs,
    tender_exchange_rate: RATE,
    ...(o.cashDrawer ? { cash_drawer: o.cashDrawer } : {}),
  } as CreateRepaymentData;
  return repo.addRepayment(data).id;
}

const cash = (amount: number): Leg[] => [
  { method: "CASH", currencyCode: "USD", amount },
];

function txnOf(ledgerId: number): { id: number; metadata_json: string } {
  return db
    .prepare(
      `SELECT id, metadata_json FROM transactions WHERE source_table = 'debt_ledger' AND source_id = ? AND type = 'DEBT_REPAYMENT'`,
    )
    .get(ledgerId) as { id: number; metadata_json: string };
}

function paymentRows(txnId: number) {
  return db
    .prepare(
      `SELECT method, drawer_name, currency_code, amount FROM payments WHERE transaction_id = ? ORDER BY id`,
    )
    .all(txnId);
}

/** Everything but the drawers: debt, coverage, profit. */
function books(ledgerId: number) {
  const balance = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
       FROM debt_ledger WHERE client_id = 7`,
    )
    .get() as { usd: number; lbp: number };
  const rows = db
    .prepare(
      `SELECT id, transaction_type, amount_usd, amount_lbp, covered_usd, covered_lbp
       FROM debt_ledger WHERE client_id = 7 ORDER BY id`,
    )
    .all();
  const sales = db.prepare(`SELECT id, paid_usd FROM sales ORDER BY id`).all();
  const txn = db
    .prepare(
      `SELECT amount_usd, amount_lbp, profit_usd, profit_lbp, metadata_json FROM transactions
       WHERE source_table = 'debt_ledger' AND source_id = ? AND type = 'DEBT_REPAYMENT'`,
    )
    .get(ledgerId) as {
    amount_usd: number;
    amount_lbp: number;
    profit_usd: number;
    profit_lbp: number;
    metadata_json: string;
  };
  const meta = JSON.parse(txn.metadata_json) as Record<string, unknown>;
  return {
    balance: {
      usd: Math.round(balance.usd * 100) / 100,
      lbp: Math.round(balance.lbp),
    },
    rows,
    sales,
    txn: {
      amount_usd: txn.amount_usd,
      amount_lbp: txn.amount_lbp,
      profit_usd: txn.profit_usd,
      profit_lbp: txn.profit_lbp,
    },
    coverage: meta.coverage_applied,
  };
}

function counts() {
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    ledger: n(`SELECT COUNT(*) AS n FROM debt_ledger`),
    payments: n(`SELECT COUNT(*) AS n FROM payments`),
    transactions: n(`SELECT COUNT(*) AS n FROM transactions`),
    drawers: drawers(db),
  };
}

describe("T010 — Debts repayment drawer choice", () => {
  it("(a) baseline: no field and SYSTEM post identically", () => {
    seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 200 });
    let before = drawers(db);
    const a = repay({ usd: 200, legs: cash(200) });
    const deltaA = drawerDelta(before, drawers(db));
    const rowsA = paymentRows(txnOf(a).id);
    fresh();
    seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 200 });
    before = drawers(db);
    const b = repay({ usd: 200, legs: cash(200), cashDrawer: "SYSTEM" });
    expect(drawerDelta(before, drawers(db))).toEqual(deltaA);
    expect(paymentRows(txnOf(b).id)).toEqual(rowsA);
    expect(deltaA).toEqual({ "OMT_System|USD": 200 });
  });

  it("(b) $200 OMT send, $200 cash, GENERAL → General +200, OMT 0, debt 0, no RESERVE", () => {
    seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 200 });
    const before = drawers(db);
    const id = repay({ usd: 200, legs: cash(200), cashDrawer: "GENERAL" });
    expect(drawerDelta(before, drawers(db))).toEqual({ "General|USD": 200 });
    expect(books(id).balance).toEqual({ usd: 0, lbp: 0 });
    expect(
      paymentRows(txnOf(id).id).filter(
        (p) => (p as { method: string }).method === "RESERVE",
      ),
    ).toEqual([]);
  });

  it("(c) $200 send + $50 sale, $250 cash: GENERAL moves only the drawer", () => {
    seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 200 });
    seedSaleDebt(db, { clientId: 7, usd: 50 });
    let before = drawers(db);
    const d = repay({ usd: 250, legs: cash(250) });
    expect(drawerDelta(before, drawers(db))).toEqual({
      "OMT_System|USD": 200,
      "General|USD": 50,
    });
    const booksDefault = books(d);
    fresh();
    seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 200 });
    seedSaleDebt(db, { clientId: 7, usd: 50 });
    before = drawers(db);
    const g = repay({ usd: 250, legs: cash(250), cashDrawer: "GENERAL" });
    expect(drawerDelta(before, drawers(db))).toEqual({ "General|USD": 250 });
    expect(books(g)).toEqual(booksDefault);
  });

  it("(d) GENERAL with only a sale + recharge is refused, nothing written; SYSTEM is accepted", () => {
    seedSaleDebt(db, { clientId: 7, usd: 30 });
    seedChargeDebt(db, {
      clientId: 7,
      debtType: "Recharge Debt",
      txnType: "RECHARGE",
      usd: 20,
    });
    const before = counts();
    expect(() =>
      repay({ usd: 50, legs: cash(50), cashDrawer: "GENERAL" }),
    ).toThrow(cashDrawerChoiceNotApplicable("OMT"));
    expect(counts()).toEqual(before);

    const drawersBefore = drawers(db);
    repay({ usd: 50, legs: cash(50), cashDrawer: "SYSTEM" });
    expect(drawerDelta(drawersBefore, drawers(db))).toEqual({
      "General|USD": 50,
    });
  });

  it("(e) GENERAL with a wallet-only payment is refused, nothing written", () => {
    seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 200 });
    const before = counts();
    expect(() =>
      repay({
        usd: 200,
        legs: [{ method: "WHISH", currencyCode: "USD", amount: 200 }],
        cashDrawer: "GENERAL",
      }),
    ).toThrow(cashDrawerChoiceNotApplicable("OMT"));
    expect(counts()).toEqual(before);
  });

  it("(f) Whish-main shop: Whish send + GENERAL → General, Whish_System 0", () => {
    setBaseSystem(db, "WHISH");
    seedTransferDebt(db, { clientId: 7, provider: "WHISH", usd: 200 });
    const before = drawers(db);
    repay({ usd: 200, legs: cash(200), cashDrawer: "GENERAL" });
    expect(drawerDelta(before, drawers(db))).toEqual({ "General|USD": 200 });
  });

  it("(g) cash change on a GENERAL overpay leaves General", () => {
    seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 200 });
    const before = drawers(db);
    repay({
      usd: 200,
      legs: [
        { method: "CASH", currencyCode: "USD", amount: 250 },
        { method: "CASH", currencyCode: "USD", amount: 50, direction: "OUT" },
      ],
      cashDrawer: "GENERAL",
    });
    expect(drawerDelta(before, drawers(db))).toEqual({ "General|USD": 200 });
  });

  it("(h)(i) the record says GENERAL and the legs read General", () => {
    seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 200 });
    const id = repay({ usd: 200, legs: cash(200), cashDrawer: "GENERAL" });
    const txn = txnOf(id);
    const meta = JSON.parse(txn.metadata_json) as {
      routed: { cash_drawer?: string; by_transfer: unknown[]; legs: unknown[] };
    };
    expect(meta.routed.cash_drawer).toBe("GENERAL");
    expect(meta.routed.by_transfer).toEqual([]);
    expect(meta.routed.legs).toEqual([]);
    const legs = getTransactionRepository().getPaymentsByTransactionId(txn.id);
    expect(legs.map((l) => [l.method, l.drawer_name, l.amount])).toEqual([
      ["CASH", "General", 200],
    ]);
  });

  it("(j) split $100 CASH + $100 wallet with GENERAL: only cash moves to General", () => {
    seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 200 });
    const before = drawers(db);
    repay({
      usd: 200,
      legs: [
        { method: "CASH", currencyCode: "USD", amount: 100 },
        { method: "WHISH", currencyCode: "USD", amount: 100 },
      ],
      cashDrawer: "GENERAL",
    });
    expect(drawerDelta(before, drawers(db))).toEqual({
      "General|USD": 100,
      "Whish_App|USD": 100,
    });
  });
});

/** Everything a repayment touches, for exact before/after comparison. */
function snapshot() {
  const balance = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
       FROM debt_ledger WHERE client_id = 7`,
    )
    .get() as { usd: number; lbp: number };
  const rows = db
    .prepare(
      `SELECT id, covered_usd, covered_lbp FROM debt_ledger
       WHERE client_id = 7 AND transaction_type NOT IN ('Repayment', 'Repayment Reversal')
       ORDER BY id`,
    )
    .all();
  const sales = db.prepare(`SELECT id, paid_usd FROM sales ORDER BY id`).all();
  return {
    drawers: drawers(db),
    balance: {
      usd: Math.round(balance.usd * 100) / 100,
      lbp: Math.round(balance.lbp),
    },
    rows,
    sales,
  };
}

describe("T028 — a GENERAL repayment reverses exactly (protection test)", () => {
  it.each([
    ["(b) $200 OMT send, $200 cash", false],
    ["(c) $200 send + $50 sale, $250 cash", true],
  ] as const)("%s: void nets every drawer and the debt to 0", (_n, withSale) => {
    seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 200 });
    if (withSale) seedSaleDebt(db, { clientId: 7, usd: 50 });
    const usd = withSale ? 250 : 200;
    const before = snapshot();
    const id = repay({ usd, legs: cash(usd), cashDrawer: "GENERAL" });
    expect(snapshot()).not.toEqual(before);
    getTransactionRepository().voidTransaction(txnOf(id).id, 1);
    expect(snapshot()).toEqual(before);
    expect(before.balance.usd).toBe(usd);
  });

  it("an exact refund (no override) gives the same result", () => {
    seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 200 });
    const before = snapshot();
    const id = repay({ usd: 200, legs: cash(200), cashDrawer: "GENERAL" });
    getTransactionRepository().refundTransaction(txnOf(id).id, 1);
    expect(snapshot()).toEqual(before);
  });

  it("a refund with a CASH override of a GENERAL repayment pays out of General", () => {
    seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 200 });
    const before = drawers(db);
    const id = repay({ usd: 200, legs: cash(200), cashDrawer: "GENERAL" });
    getTransactionRepository().refundTransaction(txnOf(id).id, 1, {
      refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 200 }],
    });
    expect(drawerDelta(before, drawers(db))).toEqual({});
  });
});

describe("T030 — 'OMT drawer first' after a GENERAL repayment (protection test)", () => {
  it("$200 send: $100 GENERAL then $100 default → General +100, OMT_System +100, debt 0", () => {
    seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 200 });
    const before = drawers(db);
    repay({ usd: 100, legs: cash(100), cashDrawer: "GENERAL" });
    repay({ usd: 100, legs: cash(100) });
    expect(drawerDelta(before, drawers(db))).toEqual({
      "General|USD": 100,
      "OMT_System|USD": 100,
    });
    expect(snapshot().balance).toEqual({ usd: 0, lbp: 0 });
  });
});
