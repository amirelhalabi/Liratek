/**
 * LIRA-370 T002 — today's figures, pinned BEFORE the SMS settlement lands.
 *
 * The fixture is the test shop's OMT account on 2026-11-03 (spec
 * "Evidence"): iPick + OMT App top-ups, Cash to Business / Online Brokerage
 * / two Intra sends (commission 1.00 / 3.00 / 0.10 / 0.10), and for the
 * collect case a $1,000 Western Union receive (commission 2.00).
 *
 * What must NOT move:
 *   - the statement panel's figures (`getAccountExpectedStatement`), for
 *     all types and for Western Union only — the re-implementation over the
 *     shared formula (T024) must reproduce them to the cent;
 *   - every supplier outside the OMT account settles exactly as today.
 *
 * Passes on the unchanged code by design (it is a baseline, not a guard).
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext";
import { SupplierRepository } from "../SupplierRepository";
import {
  buildDb,
  fundDrawer,
  omtAccount,
  resetAll,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";
import { seedTestShopOmt } from "../testHelpers/omtTestShop";

const UTC = { clientTzOffsetMinutes: 0 };

describe("LIRA-370 baseline — statement panel figures", () => {
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
    for (const d of ["OMT_System", "General"]) fundDrawer(db, d, "USD", 10000);
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  const statement = (covered?: Parameters<SupplierRepository["getAccountExpectedStatement"]>[1]) =>
    runWithTenant(1, () => repo.getAccountExpectedStatement(acc.omtId, covered), UTC);

  it("we owe OMT: 776.50 − 4.20 = 772.30", () => {
    seedTestShopOmt(db, acc, false);
    const s = statement();
    expect(s.gross_owed_usd).toBeCloseTo(776.5, 2);
    expect(s.unsettled_commission_usd).toBeCloseTo(4.2, 2);
    expect(s.expected_usd).toBeCloseTo(772.3, 2);
  });

  it("OMT owes us: −223.50 − 6.20 = −229.70", () => {
    seedTestShopOmt(db, acc, true);
    const s = statement();
    expect(s.gross_owed_usd).toBeCloseTo(-223.5, 2);
    expect(s.unsettled_commission_usd).toBeCloseTo(6.2, 2);
    expect(s.expected_usd).toBeCloseTo(-229.7, 2);
  });

  it("Western Union only: −223.50 − 2.00 = −225.50", () => {
    seedTestShopOmt(db, acc, true);
    const s = statement(["WESTERN_UNION"]);
    expect(s.unsettled_commission_usd).toBeCloseTo(2, 2);
    expect(s.expected_usd).toBeCloseTo(-225.5, 2);
  });

  it("the open queue carries each transfer's commission estimate (T009)", () => {
    seedTestShopOmt(db, acc, true);
    const rows = runWithTenant(1, () => repo.getAccountUnsettled(acc.omtId), UTC);
    const fs = rows.filter((r) => r.kind === "FINANCIAL_SERVICE");
    expect(fs.map((r) => r.expected_commission_usd).sort()).toEqual([0.1, 0.1, 1, 2, 3]);
    expect(fs.every((r) => r.commission_accounted_usd === 0)).toBe(true);
  });
});
