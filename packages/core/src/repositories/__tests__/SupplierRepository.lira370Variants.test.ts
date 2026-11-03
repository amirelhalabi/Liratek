/**
 * LIRA-370 T032 — the variant table (rule 28d): every direction × ticked
 * types × money case of an OMT SMS settlement, built exactly as the sheet
 * builds it (schema `parse`), through the real `SupplierService`, then
 * voided. Each row asserts the money (drawer = SMS money, profit = the
 * worked-out commission, owed shares as expected) and that create + void
 * nets to 0 on every ledger, per currency (rule 20).
 *
 * Not proven failing-first: written after the code it covers (rule 17,
 * said so in tasks.md T032).
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext";
import { SupplierRepository, type SettleAccountRequest } from "../SupplierRepository";
import { getTransactionRepository } from "../TransactionRepository";
import { SupplierService } from "../../services/SupplierService";
import { supplierSettleAccountSchema } from "../../validators/supplier";
import type { OmtCoveredType } from "../../utils/omtCoveredTypes";
import {
  buildDb,
  drawerTotals,
  fundDrawer,
  memberBalance,
  omtAccount,
  profitTotals,
  resetAll,
  settlementTxn,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";
import { seedTestShopOmt } from "../testHelpers/omtTestShop";

const UTC = { clientTzOffsetMinutes: 0 };
const r2 = (v: number) => Math.round(v * 100) / 100;

interface Variant {
  name: string;
  receive: boolean;
  direction: "PAY" | "COLLECT";
  covered?: OmtCoveredType[];
  money: number;
  sms: number;
  profit: number;
  shares: number;
  owedAfter: number;
}

// Pay fixture: owed 776.50, commission C2B 1 / Brokerage 3 / Intra 0.1+0.1.
// Collect fixture: + WU receive 1000 (commission 2): owed −223.50.
const VARIANTS: Variant[] = [
  { name: "pay · all types · SMS 762.30", receive: false, direction: "PAY", money: 762.3, sms: 762.3, profit: 14.2, shares: 0, owedAfter: 0 },
  { name: "pay · all types · untouched 772.30", receive: false, direction: "PAY", money: 772.3, sms: 772.3, profit: 4.2, shares: 0, owedAfter: 0 },
  { name: "pay · all types · less than expected 774.50", receive: false, direction: "PAY", money: 774.5, sms: 774.5, profit: 2, shares: 0, owedAfter: 0 },
  { name: "pay · all types · OMT asks more 790", receive: false, direction: "PAY", money: 790, sms: 790, profit: 0, shares: 4.2, owedAfter: -13.5 },
  { name: "pay · all types · short money 700 on 762.30", receive: false, direction: "PAY", money: 700, sms: 762.3, profit: 14.2, shares: 0, owedAfter: 62.3 },
  { name: "pay · Intra only · 776.30", receive: false, direction: "PAY", covered: ["INTRA"], money: 776.3, sms: 776.3, profit: 0.2, shares: 4, owedAfter: 0 },
  { name: "pay · Intra + Brokerage · 773.30", receive: false, direction: "PAY", covered: ["INTRA", "ONLINE_BROKERAGE"], money: 773.3, sms: 773.3, profit: 3.2, shares: 1, owedAfter: 0 },
  { name: "collect · all types · SMS −249.70", receive: true, direction: "COLLECT", money: 249.7, sms: -249.7, profit: 26.2, shares: 0, owedAfter: 0 },
  { name: "collect · all types · untouched −229.70", receive: true, direction: "COLLECT", money: 229.7, sms: -229.7, profit: 6.2, shares: 0, owedAfter: 0 },
  { name: "collect · all types · OMT pays less −210", receive: true, direction: "COLLECT", money: 210, sms: -210, profit: 0, shares: 6.2, owedAfter: -13.5 },
  { name: "collect · WU only · −225.50", receive: true, direction: "COLLECT", covered: ["WESTERN_UNION"], money: 225.5, sms: -225.5, profit: 2, shares: 4.2, owedAfter: 0 },
  { name: "collect · WU + Intra · −225.70", receive: true, direction: "COLLECT", covered: ["WESTERN_UNION", "INTRA"], money: 225.7, sms: -225.7, profit: 2.2, shares: 4, owedAfter: 0 },
  { name: "collect · WU only · extra +5 (−230.50)", receive: true, direction: "COLLECT", covered: ["WESTERN_UNION"], money: 230.5, sms: -230.5, profit: 7, shares: 4.2, owedAfter: 0 },
];

describe("LIRA-370 — SMS settlement variant table (create → check → void → nets to 0)", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  let service: SupplierService;
  let acc: OmtAccount;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    repo = new SupplierRepository();
    service = new SupplierService();
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

  const owed = () =>
    r2(
      runWithTenant(1, () => repo.getAccountUnsettled(acc.omtId), UTC).reduce(
        (s, r) => s + r.remaining_usd,
        0,
      ),
    );
  const liveShares = () =>
    r2(
      (
        db
          .prepare(
            `SELECT COALESCE(SUM(amount), 0) AS s FROM omt_owed_shares
              WHERE tenant_id = 1 AND is_reversed = 0 AND cleared_settlement_txn_id IS NULL`,
          )
          .get() as { s: number }
      ).s,
    );
  const ledgers = () => ({
    omt: memberBalance(db, acc.omtId),
    app: memberBalance(db, acc.appId),
    ipick: memberBalance(db, acc.ipickId),
  });
  const snapshot = () => ({
    drawers: drawerTotals(db),
    ledgers: ledgers(),
    profit: profitTotals(db),
    owed: owed(),
    shares: liveShares(),
    allocations: (
      db
        .prepare(`SELECT COUNT(*) AS n FROM settlement_commission_allocations WHERE tenant_id = 1`)
        .get() as { n: number }
    ).n,
  });

  it.each(VARIANTS)("$name", (v) => {
    seedTestShopOmt(db, acc, v.receive);
    const start = snapshot();
    const parsed = supplierSettleAccountSchema.parse({
      account_supplier_id: acc.omtId,
      per_currency: {
        USD: {
          direction: v.direction,
          payments: [{ method: "CASH", currency_code: "USD", amount: v.money }],
          sms_amount: v.sms,
        },
      },
      expected_owed: { usd: start.owed, lbp: 0 },
      ...(v.covered ? { covered_omt_service_types: v.covered } : {}),
    });
    const res = service.settleAccount({ ...parsed, created_by: 1 } as SettleAccountRequest);
    expect(res).toMatchObject({ success: true });
    const after = snapshot();
    const cashSign = v.direction === "PAY" ? -1 : 1;
    expect(r2(after.drawers.usd - start.drawers.usd)).toBe(r2(cashSign * v.money));
    expect(r2(after.profit.usd)).toBe(v.profit);
    expect(after.shares).toBe(v.shares);
    expect(after.owed).toBe(v.owedAfter);

    const txn = settlementTxn(db, res.id!);
    getTransactionRepository().voidTransaction(txn.id, 1);
    expect(snapshot()).toEqual(start);
  });
});
