/**
 * LIRA-322 (T024, R12) — after a $300 partial amount-first settlement, the
 * OMT statement check uses what each row still owes ($197 gross) and still
 * subtracts the part-paid row's FULL expected commission (it is recognised
 * when the row closes, FR-012).
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { SupplierRepository } from "../SupplierRepository";
import {
  buildDb,
  fundDrawer,
  omtAccount,
  resetAll,
  seedOmtSend,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";

describe("LIRA-322 T024 — expected statement after a partial settlement", () => {
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
    fundDrawer(db, "OMT_System", "USD", 10000);
    fundDrawer(db, "General", "USD", 10000);
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("gross is the remaining $197; the commission of the part-paid + untouched rows ($4) is still subtracted", () => {
    [152, 101, 101, 101, 21, 21].forEach((amount, i) =>
      seedOmtSend(db, acc.omtId, {
        amount,
        commission: 1,
        created_at: `2026-10-01 0${i + 1}:00:00`,
      }),
    );
    repo.settleAccount({
      account_supplier_id: acc.omtId,
      per_currency: {
        USD: {
          direction: "PAY",
          payments: [{ method: "CASH", currency_code: "USD", amount: 300 }],
        },
      },
      expected_owed: { usd: 497, lbp: 0 },
      created_by: 1,
    });

    const st = repo.getAccountExpectedStatement(acc.omtId);
    expect(st.gross_owed_usd).toBeCloseTo(197, 6);
    expect(st.unsettled_commission_usd).toBeCloseTo(4, 6);
    expect(st.expected_usd).toBeCloseTo(193, 6);
  });
});
