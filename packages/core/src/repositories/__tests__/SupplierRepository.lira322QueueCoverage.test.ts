/**
 * LIRA-322 T008 — the account queue (`getAccountUnsettled`) reports what
 * active settlements already applied to each row: `covered_usd/lbp` (SUM of
 * active `supplier_settlement_coverage`) and `remaining_usd/lbp` (signed,
 * amount − covered). `amount_*` stays the full gross.
 *
 * Coverage rows are inserted by hand: the amount-first writer lands in
 * Phase 3.
 *
 * Rule 17: run against the queue before it read coverage (type-only fields
 * added first, so the failure is the runtime value, not a compile error).
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { SupplierRepository } from "../SupplierRepository";
import {
  buildDb,
  omtAccount,
  resetAll,
  seedLedgerRow,
  seedOmtSend,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";

describe("LIRA-322 — getAccountUnsettled coverage fields", () => {
  let db: Database.Database;
  let acc: OmtAccount;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    acc = omtAccount(db);
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  /** Hand-written coverage row; FKs are off because no settlement exists. */
  function cover(row: {
    tenant_id?: number;
    kind: "FINANCIAL_SERVICE" | "LEDGER";
    id: number;
    member: number;
    currency: "USD" | "LBP";
    amount: number;
    reversed?: boolean;
  }): void {
    db.pragma("foreign_keys = OFF");
    db.prepare(
      `INSERT INTO supplier_settlement_coverage
         (tenant_id, transaction_id, anchor_ledger_id, row_kind, row_id,
          member_supplier_id, currency, amount, source, is_reversed)
       VALUES (?, 999, 999, ?, ?, ?, ?, ?, 'PAYMENT', ?)`,
    ).run(
      row.tenant_id ?? 1,
      row.kind,
      row.id,
      row.member,
      row.currency,
      row.amount,
      row.reversed ? 1 : 0,
    );
    db.pragma("foreign_keys = ON");
  }

  const find = (repo: SupplierRepository, kind: string, id: number) => {
    const row = repo
      .getAccountUnsettled(acc.omtId)
      .find((r) => r.kind === kind && r.id === id);
    if (!row) throw new Error(`${kind}:${id} not in the queue`);
    return row;
  };

  it("counts only active coverage; remaining = amount − covered; amount stays gross", () => {
    const fs = seedOmtSend(db, acc.omtId, { amount: 101 });
    cover({ kind: "FINANCIAL_SERVICE", id: fs, member: acc.omtId, currency: "USD", amount: 47 });
    cover({ kind: "FINANCIAL_SERVICE", id: fs, member: acc.omtId, currency: "USD", amount: 20, reversed: true });
    // Another tenant's coverage on the same id never counts.
    cover({ tenant_id: 2, kind: "FINANCIAL_SERVICE", id: fs, member: acc.omtId, currency: "USD", amount: 30 });
    // Coverage on a LEDGER row with the same id never counts for the FS row.
    cover({ kind: "LEDGER", id: fs, member: acc.omtId, currency: "USD", amount: 5 });

    const row = find(new SupplierRepository(), "FINANCIAL_SERVICE", fs);
    expect(row.amount_usd).toBe(101);
    expect(row.covered_usd).toBe(47);
    expect(row.remaining_usd).toBe(54);
    expect(row.covered_lbp).toBe(0);
    expect(row.remaining_lbp).toBe(0);
  });

  it("LBP rows and LEDGER rows get the same fields", () => {
    const fsLbp = seedOmtSend(db, acc.omtId, { amount: 900000, currency: "LBP" });
    const ipickDebt = seedLedgerRow(db, acc.ipickId, { entry_type: "TOP_UP", amount_usd: 50 });
    const credit = seedLedgerRow(db, acc.appId, { entry_type: "SUPPLIER_PAYS_US", amount_usd: -60 });
    cover({ kind: "FINANCIAL_SERVICE", id: fsLbp, member: acc.omtId, currency: "LBP", amount: 100000 });
    cover({ kind: "LEDGER", id: ipickDebt, member: acc.ipickId, currency: "USD", amount: 10 });
    cover({ kind: "LEDGER", id: credit, member: acc.appId, currency: "USD", amount: 25 });

    const repo = new SupplierRepository();
    const lbp = find(repo, "FINANCIAL_SERVICE", fsLbp);
    expect([lbp.covered_lbp, lbp.remaining_lbp]).toEqual([100000, 800000]);
    expect([lbp.covered_usd, lbp.remaining_usd]).toEqual([0, 0]);

    const debt = find(repo, "LEDGER", ipickDebt);
    expect([debt.covered_usd, debt.remaining_usd]).toEqual([10, 40]);

    // A credit keeps its sign: −60 with 25 applied still owes the shop −35.
    const cr = find(repo, "LEDGER", credit);
    expect([cr.amount_usd, cr.covered_usd, cr.remaining_usd]).toEqual([-60, 25, -35]);
  });

  it("a row whose remaining is within $0.005 is still returned until it is stamped", () => {
    const fs = seedOmtSend(db, acc.omtId, { amount: 21 });
    cover({ kind: "FINANCIAL_SERVICE", id: fs, member: acc.omtId, currency: "USD", amount: 20.996 });
    const row = find(new SupplierRepository(), "FINANCIAL_SERVICE", fs);
    expect(row.covered_usd).toBeCloseTo(20.996, 6);
    expect(row.remaining_usd).toBeCloseTo(0.004, 6);
  });

  it("a row with no coverage reads covered 0 and remaining = amount", () => {
    const fs = seedOmtSend(db, acc.omtId, { amount: 152 });
    const row = find(new SupplierRepository(), "FINANCIAL_SERVICE", fs);
    expect([row.covered_usd, row.remaining_usd, row.covered_lbp, row.remaining_lbp]).toEqual([0, 152, 0, 0]);
  });

  it("on a database without the coverage table, covered is 0 (older fixtures keep working)", () => {
    const fs = seedOmtSend(db, acc.omtId, { amount: 152 });
    db.exec(`DROP TABLE supplier_settlement_coverage`);
    const row = find(new SupplierRepository(), "FINANCIAL_SERVICE", fs);
    expect([row.covered_usd, row.remaining_usd]).toEqual([0, 152]);
  });
});
