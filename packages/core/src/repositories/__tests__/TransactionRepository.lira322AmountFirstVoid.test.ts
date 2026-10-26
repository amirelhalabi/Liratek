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
 *
 * LIRA-343 (R12, owner 2026-10-26 option 3): "newest first" is gone — (b),
 * (b2) and (f) now assert the no-exception undo / void (their LIRA-322
 * refusal expectations were rewritten, not deleted; rule 24).
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

  // LIRA-343 (FR-018, R12; owner 2026-10-26 option 3) — (b)/(b2) rewritten
  // from the LIRA-322 "refused: void it first" rule: undo has no exception.
  // $300 closes 152 + 101 and part-pays $47 of the third row; $100 finishes
  // it ($54) and part-pays $46 of the fourth.
  for (const how of ["void", "refund"] as const) {
    it(`(b${how === "refund" ? "2" : ""}) $300 then $100: ${how} of the $300 is allowed; the $100 stays, its $47 on the shared row becomes owed to OMT`, () => {
      const first = settleUsd(300);
      const second = settleUsd(100);
      const secondCoverage = coverageRows(db).filter((c) => c.transaction_id === second);
      const drawers0 = drawerTotals(db).usd;
      if (how === "void") voidTxn(first);
      else getTransactionRepository().refundTransaction(first, 1);
      expect(drawerTotals(db).usd - drawers0).toBeCloseTo(300, 6);
      expect(coverageRows(db).filter((c) => c.transaction_id === second)).toEqual(
        secondCoverage,
      );
      // The two rows the $300 closed alone reopen; the shared row stays
      // closed by the $100.
      expect(fsState(usd[0])).toEqual({ settlement_id: null, is_settled: 0 });
      expect(fsState(usd[1])).toEqual({ settlement_id: null, is_settled: 0 });
      expect(fsState(usd[2]).settlement_id).not.toBeNull();
      const reversal = (
        db.prepare(`SELECT id FROM transactions WHERE reverses_id = ?`).get(first) as {
          id: number;
        }
      ).id;
      const account = repo
        .getAccountUnsettled(acc.omtId)
        .filter((r) => r.kind === "LEDGER" && r.transaction_id === reversal);
      expect(account.map((r) => [r.row_scope, r.remaining_usd])).toEqual([["ACCOUNT", 47]]);
      // Balance == Σ open remaining, per currency.
      expect(memberBalance(db, acc.omtId).usd).toBeCloseTo(owed().usd, 6);
      expect(memberBalance(db, acc.omtId).lbp).toBeCloseTo(owed().lbp, 6);
    });
  }

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

  // LIRA-343 (FR-019, R12) — rewritten from the LIRA-322 refusal ("partly
  // paid … void that settlement first"): the void goes through, the
  // settlement stays, and the $47 it paid on the transfer is OMT credit.
  it("(f) a part-paid transfer can be voided while a settlement covers it: the $47 paid becomes OMT credit", () => {
    // The transfer's own unified transaction and its auto sibling's hidden
    // one (the real writers book both; the cascade reaches the sibling
    // through `supplier_ledger.transaction_id`).
    const txRepo = getTransactionRepository();
    const transferTxn = txRepo.createTransaction({
      type: TRANSACTION_TYPES.FINANCIAL_SERVICE,
      source_table: "financial_services",
      source_id: usd[2],
      user_id: 1,
      amount_usd: 101,
      amount_lbp: 0,
      summary: "OMT SEND $101",
      metadata_json: {},
    });
    const sibling = db
      .prepare(
        `SELECT id FROM supplier_ledger WHERE source_ref_table = 'financial_services' AND source_ref_id = ?`,
      )
      .get(usd[2]) as { id: number };
    const siblingTxn = txRepo.createTransaction({
      type: TRANSACTION_TYPES.SUPPLIER_PAYMENT,
      source_table: "supplier_ledger",
      source_id: sibling.id,
      user_id: 1,
      amount_usd: 101,
      amount_lbp: 0,
      summary: "OMT top-up (auto)",
      metadata_json: { is_auto: true },
    });
    db.prepare(`UPDATE supplier_ledger SET transaction_id = ? WHERE id = ?`).run(
      siblingTxn,
      sibling.id,
    );
    const settlement = settleUsd(300);
    const coverage0 = coverageRows(db);
    const drawers0 = drawerTotals(db);
    voidTxn(transferTxn);
    expect(coverageRows(db)).toEqual(coverage0);
    expect(drawerTotals(db)).toEqual(drawers0);
    const status = db
      .prepare(`SELECT status FROM transactions WHERE id = ?`)
      .get(settlement) as { status: string };
    expect(status.status).toBe("ACTIVE");
    const reversal = (
      db.prepare(`SELECT id FROM transactions WHERE reverses_id = ?`).get(transferTxn) as {
        id: number;
      }
    ).id;
    const credit = repo
      .getAccountUnsettled(acc.omtId)
      .filter((r) => r.kind === "LEDGER" && r.transaction_id === reversal);
    expect(credit.map((r) => [r.row_scope, r.remaining_usd])).toEqual([["ACCOUNT", -47]]);
    expect(memberBalance(db, acc.omtId).usd).toBeCloseTo(owed().usd, 6);
    expect(memberBalance(db, acc.omtId).lbp).toBeCloseTo(owed().lbp, 6);
  });
});
