/**
 * LIRA-373 (owner decision 2026-11-05) — a settlement is refunded by EXACT
 * reversal only. Shape of production tx 15456 (Cornertech): an amount-first
 * OMT settlement that COLLECTS dollars from OMT and PAYS lira to OMT in one
 * transaction. The refund window folded the lira leg into the dollar leg as
 * if it were customer change and sent ONE Cash-USD override, which skipped
 * both original legs and landed the money in General.
 *
 * (a) failing-first (rule 17): the server must refuse a `refundLegs` override
 *     on a settlement — the exact folded line the window sent.
 * (b) no override: every drawer, every member balance (per currency), the
 *     coverage rows and the settled flags return to before the settlement
 *     (rule 20, create + reverse nets to 0).
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { SupplierRepository } from "../SupplierRepository";
import { getTransactionRepository } from "../TransactionRepository";
import {
  buildDb,
  coverageRows,
  drawerTotals,
  fundDrawer,
  memberBalance,
  omtAccount,
  profitTotals,
  resetAll,
  seedOmtSend,
  settlementTxn,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";

const RATE = 90_000;

describe("LIRA-373 — settlement refunds are exact reversal only", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  let acc: OmtAccount;
  let receiveUsd: number;
  let sendLbp: number;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    repo = new SupplierRepository();
    acc = omtAccount(db);
    for (const d of ["OMT_System", "General"]) {
      fundDrawer(db, d, "USD", 10_000);
      fundDrawer(db, d, "LBP", 100_000_000);
    }
    // OMT owes the shop $200 (a receive); the shop owes OMT 900,000 LBP.
    receiveUsd = seedOmtSend(db, acc.omtId, {
      amount: 200,
      service_type: "RECEIVE",
      created_at: "2026-10-01 01:00:00",
    });
    sendLbp = seedOmtSend(db, acc.omtId, {
      amount: 900_000,
      currency: "LBP",
      created_at: "2026-10-01 02:00:00",
    });
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  /** USD COLLECT $200 + LBP PAY 900,000 in ONE settlement (tx 15456 shape). */
  function settleBothWays(): number {
    const anchor = repo.settleAccount({
      account_supplier_id: acc.omtId,
      per_currency: {
        USD: {
          direction: "COLLECT",
          payments: [{ method: "CASH", currency_code: "USD", amount: 200 }],
        },
        LBP: {
          direction: "PAY",
          payments: [{ method: "CASH", currency_code: "LBP", amount: 900_000 }],
        },
      },
      expected_owed: { usd: -200, lbp: 900_000 },
      exchange_rate: RATE,
      created_by: 1,
    }).id;
    return settlementTxn(db, anchor).id;
  }

  function perDrawer(): Record<string, number> {
    const rows = db
      .prepare(
        `SELECT drawer_name || '|' || currency_code AS k, balance
           FROM drawer_balances WHERE tenant_id = 1`,
      )
      .all() as Array<{ k: string; balance: number }>;
    return Object.fromEntries(rows.map((r) => [r.k, r.balance]));
  }

  function settled(id: number) {
    return db
      .prepare(
        `SELECT settlement_id, is_settled FROM financial_services WHERE id = ?`,
      )
      .get(id) as { settlement_id: number | null; is_settled: number };
  }

  it("(a) refuses a refundLegs override on a SUPPLIER_SETTLEMENT (the folded one-line Cash USD the window sent)", () => {
    const txn = settleBothWays();
    const legs = db
      .prepare(
        `SELECT method, currency_code, amount, drawer_name FROM payments WHERE transaction_id = ? ORDER BY id`,
      )
      .all(txn);
    expect(legs).toHaveLength(2);
    // $200 in − 900,000 LBP out at 90,000 = $190 net: the folded pre-fill.
    expect(() =>
      getTransactionRepository().refundTransaction(txn, 1, {
        refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 190 }],
        exchangeRate: RATE,
      }),
    ).toThrow(/settlement can only be refunded exactly as it was made/i);
    // Nothing written.
    expect(
      db
        .prepare(`SELECT COUNT(*) AS n FROM transactions WHERE reverses_id = ?`)
        .get(txn),
    ).toEqual({ n: 0 });
  });

  function owed() {
    const q = repo.getAccountUnsettled(acc.omtId);
    return {
      usd: q.reduce((sum, r) => sum + r.remaining_usd, 0),
      lbp: q.reduce((sum, r) => sum + r.remaining_lbp, 0),
    };
  }

  function snapshot() {
    return {
      drawers: perDrawer(),
      omt: memberBalance(db, acc.omtId),
      profit: profitTotals(db),
      owed: owed(),
      allocations: (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM settlement_commission_allocations`,
          )
          .get() as { n: number }
      ).n,
      activeCoverage: coverageRows(db).filter((c) => c.is_reversed === 0)
        .length,
    };
  }

  function expectSameAs(before: ReturnType<typeof snapshot>): void {
    const now = snapshot();
    const keys = new Set([
      ...Object.keys(before.drawers),
      ...Object.keys(now.drawers),
    ]);
    for (const k of keys) {
      expect([k, now.drawers[k] ?? 0]).toEqual([k, before.drawers[k] ?? 0]);
    }
    for (const key of ["omt", "profit", "owed"] as const) {
      expect([key, "usd", now[key].usd]).toEqual([
        key,
        "usd",
        expect.closeTo(before[key].usd, 6),
      ]);
      expect([key, "lbp", now[key].lbp]).toEqual([
        key,
        "lbp",
        expect.closeTo(before[key].lbp, 6),
      ]);
    }
    expect(now.allocations).toBe(before.allocations);
    expect(now.activeCoverage).toBe(before.activeCoverage);
  }

  it("(b) a plain refund returns every drawer, member balance, profit, owed queue, coverage and settled flag to before the settlement", () => {
    const before = snapshot();
    const totals0 = drawerTotals(db);

    const txn = settleBothWays();
    // Sanity: the settlement moved money both ways and closed both rows.
    expect(drawerTotals(db).usd - totals0.usd).toBeCloseTo(200, 6);
    expect(drawerTotals(db).lbp - totals0.lbp).toBe(-900_000);
    expect(settled(receiveUsd).settlement_id).not.toBeNull();
    expect(settled(sendLbp).settlement_id).not.toBeNull();

    getTransactionRepository().refundTransaction(txn, 1);

    expectSameAs(before);
    expect(settled(receiveUsd)).toEqual({ settlement_id: null, is_settled: 0 });
    expect(settled(sendLbp)).toEqual({ settlement_id: null, is_settled: 0 });
  });

  it("(c) with commission: a plain refund of a two-currency settlement that booked commission nets profit and allocations to 0 too", () => {
    // Shop owes OMT $497 in USD on top of the $200 receive → USD PAY $297.
    seedOmtSend(db, acc.omtId, {
      amount: 497,
      created_at: "2026-10-01 03:00:00",
    });
    const before = snapshot();
    const anchor = repo.settleAccount({
      account_supplier_id: acc.omtId,
      per_currency: {
        USD: {
          direction: "PAY",
          payments: [{ method: "CASH", currency_code: "USD", amount: 297 }],
          commission: 0.7,
        },
        LBP: {
          direction: "PAY",
          payments: [{ method: "CASH", currency_code: "LBP", amount: 900_000 }],
        },
      },
      expected_owed: { usd: 297, lbp: 900_000 },
      exchange_rate: RATE,
      created_by: 1,
    }).id;
    const txn = settlementTxn(db, anchor).id;
    expect(snapshot().allocations).toBeGreaterThan(before.allocations);
    expect(profitTotals(db).usd).not.toBeCloseTo(before.profit.usd, 6);

    getTransactionRepository().refundTransaction(txn, 1);

    expectSameAs(before);
  });
});
