/**
 * LIRA-322 (T023, FR-017) — for an OMT-account member, the Transactions
 * history's Paid / Partial / Unpaid labels come from what settlements
 * actually recorded (coverage), per currency — never from the USD-only
 * manual-payment pool estimate. A non-member keeps the pool estimate
 * (`FinancialService.voidedFifoStatus.test.ts`).
 *
 * Rule 17: run against the pool-only `getAllByProvider` first.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { SupplierRepository } from "../../repositories/SupplierRepository";
import { getFinancialServiceRepository } from "../../repositories/FinancialServiceRepository";
import { FinancialService } from "../FinancialService";
import {
  buildDb,
  fundDrawer,
  omtAccount,
  resetAll,
  seedOmtSend,
  type OmtAccount,
} from "../../repositories/testHelpers/omtAccountDb";

describe("LIRA-322 — getAllByProvider status from settlement coverage (account members)", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  let acc: OmtAccount;

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
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("closed rows read 'paid', the part-paid row 'partial' with fifo_paid_usd 47, LBP rows use fifo_paid_lbp", () => {
    const usd = [152, 101, 101].map((amount, i) =>
      seedOmtSend(db, acc.omtId, {
        amount,
        created_at: `2026-10-01 0${i + 1}:00:00`,
      }),
    );
    const lbp = seedOmtSend(db, acc.omtId, {
      amount: 900000,
      currency: "LBP",
      created_at: "2026-10-01 00:30:00",
    });
    repo.settleAccount({
      account_supplier_id: acc.omtId,
      per_currency: {
        USD: {
          direction: "PAY",
          payments: [{ method: "CASH", currency_code: "USD", amount: 300 }],
        },
        LBP: {
          direction: "PAY",
          payments: [{ method: "CASH", currency_code: "LBP", amount: 400000 }],
        },
      },
      expected_owed: { usd: 354, lbp: 900000 },
      created_by: 1,
    });

    const rows = new FinancialService(
      getFinancialServiceRepository(),
    ).getAllByProvider("OMT");
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get(usd[0])).toEqual(
      expect.objectContaining({ fifo_status: "paid", fifo_paid_usd: 152, fifo_paid_lbp: 0 }),
    );
    expect(byId.get(usd[1])!.fifo_status).toBe("paid");
    expect(byId.get(usd[2])).toEqual(
      expect.objectContaining({ fifo_status: "partial", fifo_paid_usd: 47, fifo_paid_lbp: 0 }),
    );
    expect(byId.get(lbp)).toEqual(
      expect.objectContaining({
        fifo_status: "partial",
        fifo_paid_usd: 0,
        fifo_paid_lbp: 400000,
      }),
    );
  });

  it("an untouched account row reads 'unpaid' even when manual Pay/Receive payments exist", () => {
    const fs = seedOmtSend(db, acc.omtId, {
      amount: 50,
      created_at: "2026-10-01 01:00:00",
    });
    // A manual $100 Pay on the counter (an open credit) — the pool estimate
    // would call the $50 transfer "paid"; the account's labels must not.
    db.prepare(
      `INSERT INTO supplier_ledger (tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, created_by, created_at)
       VALUES (1, ?, 'PAYMENT', -100, 0, 1, '2026-10-01 02:00:00')`,
    ).run(acc.omtId);
    const [row] = new FinancialService(getFinancialServiceRepository())
      .getAllByProvider("OMT")
      .filter((r) => r.id === fs);
    expect(row.fifo_status).toBe("unpaid");
    expect(row.fifo_paid_usd).toBe(0);
  });
});
