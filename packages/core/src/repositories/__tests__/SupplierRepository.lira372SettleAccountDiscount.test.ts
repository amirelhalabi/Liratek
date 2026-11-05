/**
 * LIRA-372 (T012, T025) — the Settle Account sheet's Discount line on the
 * server (`per_currency.<C>.waive` + the new top-level `discount_reason`).
 *
 *   - T025 pin (Likely passes on today's code, research R6): the OMT SMS
 *     commission does not move with a discount (FR-006), the discount books
 *     received (PAY) / given (COLLECT), and void nets everything to 0.
 *   - T012 (failing first): the reason lands on the DISCOUNT ledger note and
 *     the COUNTERPARTY_DISCOUNT details, and the settlement's own details
 *     carry the single-currency discount (FR-008).
 *   - the schema refuses a $5.01 waive.
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

describe("LIRA-372 — Settle Account with a discount", () => {
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
  const snapshot = () => ({
    drawers: drawerTotals(db),
    ledgers: {
      omt: memberBalance(db, acc.omtId),
      app: memberBalance(db, acc.appId),
      ipick: memberBalance(db, acc.ipickId),
    },
    profit: profitTotals(db),
    owed: owed(),
  });

  function settle(
    direction: "PAY" | "COLLECT",
    money: number,
    sms: number,
    waive: number,
    reason?: string,
  ) {
    const start = snapshot();
    const parsed = supplierSettleAccountSchema.parse({
      account_supplier_id: acc.omtId,
      per_currency: {
        USD: {
          direction,
          payments: [{ method: "CASH", currency_code: "USD", amount: money }],
          sms_amount: sms,
          waive,
        },
      },
      expected_owed: { usd: start.owed, lbp: 0 },
      ...(reason ? { discount_reason: reason } : {}),
    });
    const res = service.settleAccount({
      ...parsed,
      created_by: 1,
    } as SettleAccountRequest);
    return { start, res };
  }

  it("PAY: SMS 772.30, discount 2.30, pay 770 → commission 4.20, profit 6.50, owed 0; void nets 0", () => {
    seedTestShopOmt(db, acc, false);
    const { start, res } = settle("PAY", 770, 772.3, 2.3);
    expect(res).toMatchObject({ success: true });
    const after = snapshot();
    expect(r2(after.drawers.usd - start.drawers.usd)).toBe(-770);
    expect(r2(after.profit.usd - start.profit.usd)).toBe(6.5);
    const txn = settlementTxn(db, res.id!);
    expect(r2(txn.profit_usd)).toBe(4.2);
    expect(after.owed).toBe(0);
    getTransactionRepository().voidTransaction(txn.id, 1);
    expect(snapshot()).toEqual(start);
  });

  it("COLLECT: SMS −229.70, discount 1.70, receive 228 → commission 6.20, profit 4.50; void nets 0", () => {
    seedTestShopOmt(db, acc, true);
    const { start, res } = settle("COLLECT", 228, -229.7, 1.7);
    expect(res).toMatchObject({ success: true });
    const after = snapshot();
    expect(r2(after.drawers.usd - start.drawers.usd)).toBe(228);
    expect(r2(after.profit.usd - start.profit.usd)).toBe(4.5);
    expect(r2(settlementTxn(db, res.id!).profit_usd)).toBe(6.2);
    expect(after.owed).toBe(0);
    getTransactionRepository().voidTransaction(
      settlementTxn(db, res.id!).id,
      1,
    );
    expect(snapshot()).toEqual(start);
  });

  it("the reason lands on the DISCOUNT row and its transaction; the settlement details carry the discount", () => {
    seedTestShopOmt(db, acc, false);
    const { res } = settle("PAY", 770, 772.3, 2.3, "rounded with OMT");
    expect(res).toMatchObject({ success: true });
    const row = db
      .prepare(
        `SELECT id, note FROM supplier_ledger WHERE entry_type = 'DISCOUNT' AND tenant_id = 1`,
      )
      .get() as { id: number; note: string | null };
    expect(row.note).toBe("rounded with OMT");
    const discTxn = db
      .prepare(
        `SELECT metadata_json FROM transactions WHERE type = 'COUNTERPARTY_DISCOUNT' AND source_id = ?`,
      )
      .get(row.id) as { metadata_json: string };
    expect(JSON.parse(discTxn.metadata_json).details.note).toBe(
      "rounded with OMT",
    );
    const settleDetails = JSON.parse(
      settlementTxn(db, res.id!).metadata_json,
    ).details;
    expect(settleDetails.discount).toEqual({ amount: 2.3, currency: "USD" });
  });

  it("the schema refuses a $5.01 waive and a discount_reason without per_currency", () => {
    expect(
      supplierSettleAccountSchema.safeParse({
        account_supplier_id: 1,
        expected_owed: { usd: 100, lbp: 0 },
        per_currency: {
          USD: {
            direction: "PAY",
            payments: [{ method: "CASH", currency_code: "USD", amount: 95 }],
            waive: 5.01,
          },
        },
      }).success,
    ).toBe(false);
    const legacy = {
      account_supplier_id: 1,
      direction: "PAY",
      selections: [{ kind: "LEDGER", id: 1 }],
      payments: [{ method: "CASH", currency_code: "USD", amount: 95 }],
      amount_usd: 95,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
    };
    expect(supplierSettleAccountSchema.safeParse(legacy).success).toBe(true);
    expect(
      supplierSettleAccountSchema.safeParse({ ...legacy, discount_reason: "x" })
        .success,
    ).toBe(false);
  });
});
