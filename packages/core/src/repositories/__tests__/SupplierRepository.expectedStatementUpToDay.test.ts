/**
 * Owner decision 2026-10-27 (option B) — "Check against OMT's statement"
 * matches OMT's SMS, which covers the account up to the END OF YESTERDAY.
 * With `upToDay` the read counts only open rows whose SHOP day is on or
 * before it (DAY and ACCOUNT rows alike), and reports the rest separately
 * as `after_day_*`. Without it, the output is unchanged.
 *
 * Timestamps are at 12:00 UTC so the shop-day shift (`localDayExpr`) can
 * never move a row across days, whatever zone the test machine is in.
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

describe("getAccountExpectedStatement — up to a shop day", () => {
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

    // 26 Oct: $100 (commission $1). 27 Oct: $50 (commission $0.50).
    seedOmtSend(db, acc.omtId, {
      amount: 100,
      commission: 1,
      created_at: "2026-10-26 12:00:00",
    });
    seedOmtSend(db, acc.omtId, {
      amount: 50,
      commission: 0.5,
      created_at: "2026-10-27 12:00:00",
    });
    // 28 Oct ("today"): $150 (commission $1.50), 500,000 LBP (commission
    // 5,000 LBP) and an OMT App credit of −$20 (an open ledger row).
    seedOmtSend(db, acc.omtId, {
      amount: 150,
      commission: 1.5,
      created_at: "2026-10-28 12:00:00",
    });
    seedOmtSend(db, acc.omtId, {
      amount: 500_000,
      currency: "LBP",
      commission: 5_000,
      created_at: "2026-10-28 12:30:00",
    });
    seedLedgerRow(db, acc.appId, {
      entry_type: "SUPPLIER_PAYS_US",
      amount_usd: -20,
      created_at: "2026-10-28 13:00:00",
    });
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("without upToDay counts everything open and adds no after-day keys", () => {
    const st = repo.getAccountExpectedStatement(acc.omtId);
    expect(st.gross_owed_usd).toBeCloseTo(280, 6);
    expect(st.gross_owed_lbp).toBeCloseTo(500_000, 6);
    expect(st.unsettled_commission_usd).toBeCloseTo(3, 6);
    expect(st.unsettled_commission_lbp).toBeCloseTo(5_000, 6);
    expect(st.expected_usd).toBeCloseTo(277, 6);
    expect(st).not.toHaveProperty("after_day_usd");
    expect(st).not.toHaveProperty("after_day_lbp");
  });

  it("upToDay 2026-10-27 leaves the 28th out of gross and commission and reports it as after_day", () => {
    const full = repo.getAccountExpectedStatement(acc.omtId);
    const st = repo.getAccountExpectedStatement(
      acc.omtId,
      undefined,
      "2026-10-27",
    );

    expect(st.gross_owed_usd).toBeCloseTo(150, 6);
    expect(st.gross_owed_lbp).toBeCloseTo(0, 6);
    expect(st.unsettled_commission_usd).toBeCloseTo(1.5, 6);
    expect(st.unsettled_commission_lbp).toBeCloseTo(0, 6);
    expect(st.expected_usd).toBeCloseTo(148.5, 6);
    expect(st.expected_lbp).toBeCloseTo(0, 6);
    expect(st.commission_by_type).toEqual([
      {
        omt_service_type: "INTRA",
        commission_usd: 1.5,
        commission_lbp: 0,
        count: 2,
      },
    ]);

    // The 28th: +$150 − $20 and +500,000 LBP, same sign as the gross.
    expect(st.after_day_usd).toBeCloseTo(130, 6);
    expect(st.after_day_lbp).toBeCloseTo(500_000, 6);
    // Nothing lost: the cut + what was left out = the uncut gross.
    expect(st.gross_owed_usd + (st.after_day_usd ?? NaN)).toBeCloseTo(
      full.gross_owed_usd,
      6,
    );
    expect(st.gross_owed_lbp + (st.after_day_lbp ?? NaN)).toBeCloseTo(
      full.gross_owed_lbp,
      6,
    );
  });

  it("upToDay on the newest day leaves nothing out (after_day = 0)", () => {
    const st = repo.getAccountExpectedStatement(
      acc.omtId,
      undefined,
      "2026-10-28",
    );
    expect(st.gross_owed_usd).toBeCloseTo(280, 6);
    expect(st.unsettled_commission_usd).toBeCloseTo(3, 6);
    expect(st.after_day_usd).toBe(0);
    expect(st.after_day_lbp).toBe(0);
  });
});
