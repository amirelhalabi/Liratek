/**
 * LIRA-322 (T031, US6) — voiding an amount-first account settlement gives
 * back exactly its own share, newest first (research R8, FR-018/FR-019).
 *
 * Every case snapshots the ledgers a settlement touches and asserts that
 * create + void nets to 0 per currency (rule 20): drawers, member
 * balances, profit, commission allocations and coverage.
 *
 * Rule 17: run before `_assertSettlementIsNewestOnItsRows` and the coverage
 * soft-void exist.
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
import { getTransactionRepository } from "../TransactionRepository";
import { TRANSACTION_TYPES } from "../../constants/transactionTypes";
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
  type CurrencyPair,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";

const USD_ROWS = [152, 101, 101, 101, 21, 21];

describe("LIRA-322 — void of an amount-first account settlement", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  let acc: OmtAccount;
  let usd: number[];

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    repo = new SupplierRepository();
    acc = omtAccount(db);
    for (const d of ["OMT_System", "General"]) {
      fundDrawer(db, d, "USD", 10000);
      fundDrawer(db, d, "LBP", 100_000_000);
    }
    usd = USD_ROWS.map((amount, i) =>
      seedOmtSend(db, acc.omtId, {
        amount,
        created_at: `2026-10-01 0${i + 1}:00:00`,
      }),
    );
    seedOmtSend(db, acc.omtId, {
      amount: 900000,
      currency: "LBP",
      created_at: "2026-10-01 00:30:00",
    });
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  const cashUsd = (amount: number) => ({
    method: "CASH",
    currency_code: "USD",
    amount,
  });

  function owed(): CurrencyPair {
    const q = repo.getAccountUnsettled(acc.omtId);
    return {
      usd: q.reduce((s, r) => s + r.remaining_usd, 0),
      lbp: q.reduce((s, r) => s + r.remaining_lbp, 0),
    };
  }

  function settleUsd(
    amount: number,
    section: Partial<NonNullable<SettleAccountRequest["per_currency"]>["USD"]> = {},
  ): number {
    const anchor = repo.settleAccount({
      account_supplier_id: acc.omtId,
      per_currency: {
        USD: { direction: "PAY", payments: [cashUsd(amount)], ...section },
      },
      expected_owed: owed(),
      created_by: 1,
    }).id;
    return settlementTxn(db, anchor).id;
  }

  const voidTxn = (id: number) => getTransactionRepository().voidTransaction(id, 1);

  function snapshot() {
    return {
      drawers: drawerTotals(db),
      omt: memberBalance(db, acc.omtId),
      app: memberBalance(db, acc.appId),
      ipick: memberBalance(db, acc.ipickId),
      profit: profitTotals(db),
      owed: owed(),
      allocations: (
        db.prepare(`SELECT COUNT(*) AS n FROM settlement_commission_allocations`).get() as {
          n: number;
        }
      ).n,
      activeCoverage: coverageRows(db).filter((c) => c.is_reversed === 0).length,
    };
  }

  function expectSameAs(before: ReturnType<typeof snapshot>): void {
    const now = snapshot();
    for (const key of ["drawers", "omt", "app", "ipick", "profit", "owed"] as const) {
      expect(now[key].usd).toBeCloseTo(before[key].usd, 6);
      expect(now[key].lbp).toBeCloseTo(before[key].lbp, 6);
    }
    expect(now.allocations).toBe(before.allocations);
    expect(now.activeCoverage).toBe(before.activeCoverage);
  }

  function fsState(id: number) {
    return db
      .prepare(`SELECT settlement_id, is_settled FROM financial_services WHERE id = ?`)
      .get(id) as { settlement_id: number | null; is_settled: number };
  }

  it("(a) the $300 partial settlement, voided, returns every ledger to before", () => {
    const before = snapshot();
    const txn = settleUsd(300);
    voidTxn(txn);
    expectSameAs(before);
    expect(coverageRows(db).every((c) => c.is_reversed === 1)).toBe(true);
    const part = repo
      .getAccountUnsettled(acc.omtId)
      .find((r) => r.kind === "FINANCIAL_SERVICE" && r.id === usd[2])!;
    expect(part.remaining_usd).toBeCloseTo(101, 6);
    expect(fsState(usd[0])).toEqual({ settlement_id: null, is_settled: 0 });
    expect(fsState(usd[1])).toEqual({ settlement_id: null, is_settled: 0 });
  });

  it("(b) $300 then $100: voiding the $300 is refused and changes nothing", () => {
    const first = settleUsd(300);
    const second = settleUsd(100);
    const before = snapshot();
    expect(() => voidTxn(first)).toThrow(
      new RegExp(`A later settlement \\(#${second}, .*\\) paid the same transfers\\. Void it first\\.`),
    );
    expectSameAs(before);
    const status = db
      .prepare(`SELECT status FROM transactions WHERE id = ?`)
      .get(first) as { status: string };
    expect(status.status).toBe("ACTIVE");
  });

  it("(b2) the same refusal applies to a refund of the older settlement", () => {
    const first = settleUsd(300);
    settleUsd(100);
    expect(() =>
      getTransactionRepository().refundTransaction(first, 1),
    ).toThrow(/A later settlement .* Void it first\./);
  });

  it("(a2) a REFUND of the $300 settlement also returns every ledger to before", () => {
    const before = snapshot();
    const txn = settleUsd(300);
    getTransactionRepository().refundTransaction(txn, 1);
    expectSameAs(before);
    expect(coverageRows(db).every((c) => c.is_reversed === 1)).toBe(true);
  });

  it("(c) void the $100, then the $300: back to the start", () => {
    const before = snapshot();
    const first = settleUsd(300);
    const second = settleUsd(100);
    voidTxn(second);
    voidTxn(first);
    expectSameAs(before);
    for (const id of usd) expect(fsState(id).settlement_id).toBeNull();
  });

  it("(d) commission 0.70: the void deletes the allocations, voids the credit, reverses profit", () => {
    const before = snapshot();
    const txn = settleUsd(497, { commission: 0.7 });
    expect(snapshot().allocations).toBeGreaterThan(before.allocations);
    voidTxn(txn);
    expectSameAs(before);
    // The open commission credit (owner 2026-10-15) is soft-voided with it.
    const credit = db
      .prepare(
        `SELECT is_refunded FROM supplier_ledger
          WHERE entry_type = 'SUPPLIER_PAYS_US' AND transaction_id = ? AND note LIKE 'Auto: commission credit%'`,
      )
      .all(txn) as Array<{ is_refunded: number }>;
    expect(credit).toEqual([{ is_refunded: 1 }]);
  });

  it("(e) an overpay extra, voided: the overpay row is soft-voided", () => {
    const before = snapshot();
    const txn = settleUsd(507.11);
    voidTxn(txn);
    expectSameAs(before);
    expect(
      repo.getAccountUnsettled(acc.omtId).filter((r) => r.kind === "LEDGER"),
    ).toEqual([]);
  });

  it("(f) a part-paid transfer cannot be voided while a settlement covers it", () => {
    // The transfer's own unified transaction (FinancialServiceRepository
    // books one per transfer; seeded here).
    const transferTxn = getTransactionRepository().createTransaction({
      type: TRANSACTION_TYPES.FINANCIAL_SERVICE,
      source_table: "financial_services",
      source_id: usd[2],
      user_id: 1,
      amount_usd: 101,
      amount_lbp: 0,
      summary: "OMT SEND $101",
      metadata_json: {},
    });
    settleUsd(300);
    const before = snapshot();
    expect(() => voidTxn(transferTxn)).toThrow(/partly paid/);
    expectSameAs(before);
  });
});
