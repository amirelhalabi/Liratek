/**
 * LIRA-371 — the main-system supplier's settle screens: "OMT Cash Drawer |
 * General" (Whish on a Whish shop).
 *
 * `cash_drawer: "GENERAL"` sends every cash leg (IN, change, commission)
 * through General instead of the system cash drawer, and changes nothing
 * else: same supplier balance, settled rows, commission, profit. Refused
 * (nothing written) where the choice does not apply. Absent / SYSTEM =
 * today's posting.
 *
 * Failing-first (rule 17): see specs/371-settle-drawer-choice/tasks.md T019.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  SupplierRepository,
  type SettleAccountRequest,
} from "../SupplierRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resolveServiceCashDrawer } from "../../utils/payments";
import { resetSettingsService } from "../../services/SettingsService";
import { resetSettingsRepository } from "../SettingsRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import {
  buildDb,
  coverageRows,
  fundDrawer,
  memberBalance,
  omtAccount,
  profitTotals,
  resetAll,
  seedLedgerRow,
  seedOmtSend,
  writeCounts,
  type CurrencyPair,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";
import { cashDrawerChoiceNotApplicable } from "../../constants/cashDrawerChoice";

type Choice = "SYSTEM" | "GENERAL" | undefined;
type Leg = {
  method: string;
  currency_code: string;
  amount: number;
  direction?: "IN" | "OUT";
};

let db: Database.Database;
let repo: SupplierRepository;
let acc: OmtAccount;

function setup(base: "OMT" | "WHISH" = "OMT"): void {
  resetAll();
  resetTransactionRepository();
  // The shop's base system is read through these singletons: a stale one
  // still holds the previous (closed) database.
  resetSettingsService();
  resetSettingsRepository();
  resetPaymentMethodRepository();
  db = buildDb();
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  db.prepare(
    `UPDATE system_settings SET value = ? WHERE key_name = 'shop_base_system' AND tenant_id = 1`,
  ).run(base);
  // A Whish-main shop runs an active Whish supplier.
  if (base === "WHISH") {
    db.prepare(
      `UPDATE suppliers SET is_active = 1 WHERE tenant_id = 1 AND provider = 'WHISH'`,
    ).run();
  }
  repo = new SupplierRepository();
  acc = omtAccount(db);
  for (const d of [
    "OMT_System",
    "Whish_System",
    "General",
    "Whish_App",
    "Katsh",
  ]) {
    fundDrawer(db, d, "USD", 100_000);
    fundDrawer(db, d, "LBP", 1_000_000_000);
  }
}

function teardown(): void {
  resetTenantContext();
  db.close();
}

/** Twin run on a fresh database (same ids, same seeds). */
function fresh(base: "OMT" | "WHISH" = "OMT"): void {
  teardown();
  setup(base);
}

beforeEach(() => setup());
afterEach(teardown);

const cash = (currency_code: "USD" | "LBP", amount: number, out = false): Leg => ({
  method: "CASH",
  currency_code,
  amount,
  ...(out ? { direction: "OUT" as const } : {}),
});

function drawers(): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT drawer_name, currency_code, balance FROM drawer_balances WHERE tenant_id = 1`,
    )
    .all() as Array<{ drawer_name: string; currency_code: string; balance: number }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[`${r.drawer_name}|${r.currency_code}`] = r.balance;
  return out;
}

function delta(
  before: Record<string, number>,
  after: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const d = (after[k] ?? 0) - (before[k] ?? 0);
    if (Math.abs(d) > 1e-6) out[k] = Math.round(d * 100) / 100;
  }
  return out;
}

const supplierByProvider = (provider: string): number =>
  (
    db
      .prepare(`SELECT id FROM suppliers WHERE tenant_id = 1 AND provider = ?`)
      .get(provider) as { id: number }
  ).id;

function queueOwed(accountId: number): CurrencyPair {
  const q = repo.getAccountUnsettled(accountId);
  return {
    usd: Math.round(q.reduce((s, r) => s + r.remaining_usd, 0) * 100) / 100,
    lbp: q.reduce((s, r) => s + r.remaining_lbp, 0),
  };
}

function settle(
  per_currency: SettleAccountRequest["per_currency"],
  choice: Choice,
  accountId = acc.omtId,
): number {
  return repo.settleAccount({
    account_supplier_id: accountId,
    per_currency,
    expected_owed: queueOwed(accountId),
    created_by: 1,
    exchange_rate: 89_000,
    ...(choice ? { cash_drawer: choice } : {}),
  }).id;
}

/** Everything but the drawers. */
function books(fsIds: number[]) {
  return {
    omt: memberBalance(db, acc.omtId),
    queue: queueOwed(acc.omtId),
    fs: fsIds.map(
      (id) =>
        db
          .prepare(`SELECT is_settled FROM financial_services WHERE id = ?`)
          .get(id) as { is_settled: number },
    ),
    profit: profitTotals(db),
    coverage: coverageRows(db).length,
  };
}

/** Seed the $772.30 OMT owes-the-shop-pays case. */
function seed772(): number {
  return seedOmtSend(db, acc.omtId, { amount: 772.3 });
}

function settlementTxnId(): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE type = 'SUPPLIER_SETTLEMENT' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { id: number }
  ).id;
}

describe("T019 — supplier settle drawer choice", () => {
  it("(a) baseline: default and SYSTEM post identically", () => {
    seed772();
    let d0 = drawers();
    settle({ USD: { direction: "PAY", payments: [cash("USD", 772.3)] } }, undefined);
    const dDefault = delta(d0, drawers());
    fresh();
    seed772();
    d0 = drawers();
    settle({ USD: { direction: "PAY", payments: [cash("USD", 772.3)] } }, "SYSTEM");
    expect(delta(d0, drawers())).toEqual(dDefault);
    expect(dDefault).toEqual({ "OMT_System|USD": -772.3 });
  });

  it("(b) Settle Account $772.30 cash, GENERAL → General −772.30; books identical", () => {
    let fs = seed772();
    settle({ USD: { direction: "PAY", payments: [cash("USD", 772.3)] } }, undefined);
    const booksDefault = books([fs]);
    fresh();
    fs = seed772();
    const d0 = drawers();
    settle({ USD: { direction: "PAY", payments: [cash("USD", 772.3)] } }, "GENERAL");
    expect(delta(d0, drawers())).toEqual({ "General|USD": -772.3 });
    expect(books([fs])).toEqual(booksDefault);
    expect(booksDefault.queue).toEqual({ usd: 0, lbp: 0 });
  });

  it("(c) two currencies: COLLECT +$7,492.70, PAY −60,000,000 LBP, GENERAL → both in General", () => {
    seedOmtSend(db, acc.omtId, {
      amount: 7492.7,
      service_type: "RECEIVE",
    });
    seedOmtSend(db, acc.omtId, { amount: 60_000_000, currency: "LBP" });
    const d0 = drawers();
    settle(
      {
        USD: { direction: "COLLECT", payments: [cash("USD", 7492.7)] },
        LBP: { direction: "PAY", payments: [cash("LBP", 60_000_000)] },
      },
      "GENERAL",
    );
    expect(delta(d0, drawers())).toEqual({
      "General|USD": 7492.7,
      "General|LBP": -60_000_000,
    });
  });

  it("(d) change (OUT) leg with GENERAL comes back into General", () => {
    seed772();
    const d0 = drawers();
    settle(
      {
        USD: {
          direction: "PAY",
          payments: [cash("USD", 800), cash("USD", 27.7, true)],
        },
      },
      "GENERAL",
    );
    expect(delta(d0, drawers())).toEqual({ "General|USD": -772.3 });
  });

  it("(e) legacy whole-row settleAccount with GENERAL", () => {
    const fs = seed772();
    const d0 = drawers();
    repo.settleAccount({
      account_supplier_id: acc.omtId,
      direction: "PAY",
      selections: [{ kind: "FINANCIAL_SERVICE", id: fs }],
      amount_usd: 772.3,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
      created_by: 1,
      payments: [cash("USD", 772.3)],
      cash_drawer: "GENERAL",
    });
    expect(delta(d0, drawers())).toEqual({ "General|USD": -772.3 });
  });

  it("(f) Pay / Receive for the main-system supplier (Whish shop) with GENERAL", () => {
    fresh("WHISH");
    const whish = supplierByProvider("WHISH");
    const d0 = drawers();
    repo.recordSupplierCashflow({
      supplier_id: whish,
      direction: "PAY",
      payments: [cash("USD", 100)],
      created_by: 1,
      cash_drawer: "GENERAL",
    });
    repo.recordSupplierCashflow({
      supplier_id: whish,
      direction: "RECEIVE",
      payments: [cash("USD", 40)],
      created_by: 1,
      cash_drawer: "GENERAL",
    });
    expect(delta(d0, drawers())).toEqual({ "General|USD": -60 });
  });

  it("(g) Whish shop: bills-only OTHER_PAYMENT cash commission with GENERAL → General", () => {
    fresh("WHISH");
    const whish = supplierByProvider("WHISH");
    const fsId = Number(
      db
        .prepare(
          `INSERT INTO financial_services
             (tenant_id, provider, service_type, amount, currency, commission,
              commission_model, is_settled, created_by, created_at)
           VALUES (1, 'WHISH', 'BILL', 0, 'LBP', 0, 1, 0, 1, '2026-10-03 10:00:00')`,
        )
        .run().lastInsertRowid,
    );
    const d0 = drawers();
    repo.settleTransactions({
      supplier_id: whish,
      financial_service_ids: [fsId],
      amount_usd: 0,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 20_000,
      created_by: 1,
      commission_collection_mode: "OTHER_PAYMENT",
      payments: [cash("LBP", 20_000)],
      cash_drawer: "GENERAL",
    });
    expect(delta(d0, drawers())).toEqual({ "General|LBP": 20_000 });
  });

  describe("(h) refused, nothing written; SYSTEM accepted", () => {
    function expectRefused(base: "OMT" | "WHISH", run: () => unknown): void {
      const before = { counts: writeCounts(db), drawers: drawers() };
      expect(run).toThrow(cashDrawerChoiceNotApplicable(base));
      expect({ counts: writeCounts(db), drawers: drawers() }).toEqual(before);
    }

    it("Katsh account settlement", () => {
      const katsh = supplierByProvider("Katsh");
      seedLedgerRow(db, katsh, {
        entry_type: "TOP_UP",
        amount_usd: 500,
        created_at: "2026-10-03 09:00:00",
      });
      const pc = { USD: { direction: "PAY" as const, payments: [cash("USD", 500)] } };
      expectRefused("OMT", () => settle(pc, "GENERAL", katsh));
      const d0 = drawers();
      settle(pc, "SYSTEM", katsh);
      expect(delta(d0, drawers())).toEqual({ "General|USD": -500 });
    });

    it("a product supplier's Pay", () => {
      const product = Number(
        db
          .prepare(
            `INSERT INTO suppliers (tenant_id, name, is_system, is_active) VALUES (1, 'Cables Co', 0, 1)`,
          )
          .run().lastInsertRowid,
      );
      const pay = (choice: Choice) =>
        repo.recordSupplierCashflow({
          supplier_id: product,
          direction: "PAY",
          payments: [cash("USD", 50)],
          created_by: 1,
          ...(choice ? { cash_drawer: choice } : {}),
        });
      expectRefused("OMT", () => pay("GENERAL"));
      const d0 = drawers();
      pay("SYSTEM");
      expect(delta(d0, drawers())).toEqual({ "General|USD": -50 });
    });

    it("OMT on a Whish-main shop", () => {
      fresh("WHISH");
      seed772();
      const pc = { USD: { direction: "PAY" as const, payments: [cash("USD", 772.3)] } };
      expectRefused("WHISH", () => settle(pc, "GENERAL"));
      const d0 = drawers();
      settle(pc, "SYSTEM");
      expect(delta(d0, drawers())).toEqual({ "General|USD": -772.3 });
    });

    it("legacy whole-row settleAccount, non-cash legs only (refusal text not wrapped)", () => {
      const fs = seed772();
      expectRefused("OMT", () =>
        repo.settleAccount({
          account_supplier_id: acc.omtId,
          direction: "PAY",
          selections: [{ kind: "FINANCIAL_SERVICE", id: fs }],
          amount_usd: 772.3,
          amount_lbp: 0,
          commission_usd: 0,
          commission_lbp: 0,
          created_by: 1,
          payments: [{ method: "WHISH", currency_code: "USD", amount: 772.3 }],
          cash_drawer: "GENERAL",
        }),
      );
    });

    it("non-cash legs only", () => {
      seed772();
      const pc = {
        USD: {
          direction: "PAY" as const,
          payments: [{ method: "WHISH", currency_code: "USD", amount: 772.3 }],
        },
      };
      expectRefused("OMT", () => settle(pc, "GENERAL"));
    });
  });

  it("(j) split $400 CASH + $372.30 wallet with GENERAL: only the cash moves to General", () => {
    seed772();
    const d0 = drawers();
    settle(
      {
        USD: {
          direction: "PAY",
          payments: [
            cash("USD", 400),
            { method: "WHISH", currency_code: "USD", amount: 372.3 },
          ],
        },
      },
      "GENERAL",
    );
    expect(delta(d0, drawers())).toEqual({
      "General|USD": -400,
      "Whish_App|USD": -372.3,
    });
  });

  it("(i) the resolver default is untouched: OMT cash → OMT_System without the choice", () => {
    // FinancialService SEND/RECEIVE build their ctx without `cashDrawer`.
    expect(resolveServiceCashDrawer("CASH", { provider: "OMT", baseSystem: "OMT" })).toBe(
      "OMT_System",
    );
    expect(
      resolveServiceCashDrawer("CASH", {
        provider: "OMT",
        baseSystem: "OMT",
        cashDrawer: "SYSTEM",
      }),
    ).toBe("OMT_System");
    expect(
      resolveServiceCashDrawer("CASH", {
        provider: "OMT",
        baseSystem: "OMT",
        cashDrawer: "GENERAL",
      }),
    ).toBe("General");
  });
});

describe("T029 — a GENERAL settlement reverses exactly (protection test)", () => {
  function snap() {
    return {
      drawers: drawers(),
      omt: memberBalance(db, acc.omtId),
      queue: queueOwed(acc.omtId),
    };
  }

  it("(b) $772.30 GENERAL Settle Account + void → every drawer and the ledger back", () => {
    seed772();
    const before = snap();
    settle({ USD: { direction: "PAY", payments: [cash("USD", 772.3)] } }, "GENERAL");
    expect(snap()).not.toEqual(before);
    getTransactionRepository().voidTransaction(settlementTxnId(), 1);
    expect(snap()).toEqual(before);
  });

  it("(c) two currencies GENERAL + void → back, per currency", () => {
    seedOmtSend(db, acc.omtId, { amount: 7492.7, service_type: "RECEIVE" });
    seedOmtSend(db, acc.omtId, { amount: 60_000_000, currency: "LBP" });
    const before = snap();
    settle(
      {
        USD: { direction: "COLLECT", payments: [cash("USD", 7492.7)] },
        LBP: { direction: "PAY", payments: [cash("LBP", 60_000_000)] },
      },
      "GENERAL",
    );
    getTransactionRepository().voidTransaction(settlementTxnId(), 1);
    expect(snap()).toEqual(before);
  });

  it("an exact refund gives the same result", () => {
    seed772();
    const before = snap();
    settle({ USD: { direction: "PAY", payments: [cash("USD", 772.3)] } }, "GENERAL");
    getTransactionRepository().refundTransaction(settlementTxnId(), 1);
    expect(snap()).toEqual(before);
  });

  it("an override refund of a GENERAL Settle Account is refused (LIRA-373)", () => {
    seed772();
    settle({ USD: { direction: "PAY", payments: [cash("USD", 772.3)] } }, "GENERAL");
    const before = snap();
    expect(() =>
      getTransactionRepository().refundTransaction(settlementTxnId(), 1, {
        refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 772.3 }],
      }),
    ).toThrow("A settlement can only be refunded exactly as it was made");
    expect(snap()).toEqual(before);
  });

  it("Pay / Receive (Whish shop) GENERAL + CASH-override refund → General nets to 0", () => {
    fresh("WHISH");
    const whish = supplierByProvider("WHISH");
    const d0 = drawers();
    repo.recordSupplierCashflow({
      supplier_id: whish,
      direction: "PAY",
      payments: [cash("USD", 100)],
      created_by: 1,
      cash_drawer: "GENERAL",
    });
    const txnId = (
      db
        .prepare(
          `SELECT id FROM transactions WHERE type = 'SUPPLIER_PAYMENT' ORDER BY id DESC LIMIT 1`,
        )
        .get() as { id: number }
    ).id;
    getTransactionRepository().refundTransaction(txnId, 1, {
      refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
    });
    expect(delta(d0, drawers())).toEqual({});
  });
});
