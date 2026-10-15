/**
 * LIRA-322 (T008a) — the legacy whole-row account settlement refuses a row
 * that an amount-first settlement already part-paid: its legacy amounts are
 * the full gross, so an outdated client would pay the covered part twice.
 *
 * Not proven failing-first: the guard was written (with T018) before this
 * test; per rule 17 it was not re-broken to prove it.
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
  writeCounts,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";

describe("LIRA-322 T008a — legacy settle refuses a part-paid row", () => {
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

  it("after an amount-first $300, a legacy payload selecting the part-paid $101 is refused and writes nothing", () => {
    const ids = [152, 101, 101].map((amount, i) =>
      seedOmtSend(db, acc.omtId, {
        amount,
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
      expected_owed: { usd: 354, lbp: 0 },
      created_by: 1,
    });
    const partPaid = ids[2];
    const row = repo
      .getAccountUnsettled(acc.omtId)
      .find((r) => r.kind === "FINANCIAL_SERVICE" && r.id === partPaid)!;
    expect(row.covered_usd).toBeCloseTo(47, 6);

    const counts0 = writeCounts(db);
    expect(() =>
      repo.settleAccount({
        account_supplier_id: acc.omtId,
        direction: "PAY",
        selections: [{ kind: "FINANCIAL_SERVICE", id: partPaid }],
        amount_usd: 101,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 101 }],
      }),
    ).toThrow(
      "This transfer is partly paid; settle it from the Settle Account sheet.",
    );
    expect(writeCounts(db)).toEqual(counts0);
  });
});
