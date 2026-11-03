/**
 * LIRA-370 T012/T017/T020 — settling the OMT account from the SMS amount
 * (core repository, both directions).
 *
 * Fixture: the test shop's OMT account on 2026-11-03 (see the baseline
 * test): we owe OMT 776.50 with 4.20 expected commission; with the $1,000
 * Western Union receive, OMT owes us 223.50 with 6.20 expected.
 *
 * The payload goes through the core schema's `parse` (rule 23: the new
 * keys must survive) and takes its field names from the schema (rule 24).
 *
 * RULE 17 — written before the repository change (T013); the first run is
 * recorded in tasks.md T012.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext";
import {
  SupplierRepository,
  type AccountUnsettledRow,
  type SettleAccountRequest,
} from "../SupplierRepository";
import { supplierSettleAccountSchema } from "../../validators/supplier";
import {
  buildDb,
  coverageRows,
  drawerTotals,
  fundDrawer,
  memberBalance,
  omtAccount,
  profitTotals,
  resetAll,
  seedLedgerRow,
  settlementTxn,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";
import { seedTestShopOmt } from "../testHelpers/omtTestShop";

const UTC = { clientTzOffsetMinutes: 0 };
const r2 = (v: number) => Math.round(v * 100) / 100 + 0;

describe("LIRA-370 — settle the OMT account from the SMS amount", () => {
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

  const queue = (): AccountUnsettledRow[] =>
    runWithTenant(1, () => repo.getAccountUnsettled(acc.omtId), UTC);

  const owed = () => r2(queue().reduce((s, r) => s + r.remaining_usd, 0));

  const accountBalance = () =>
    r2(
      memberBalance(db, acc.omtId).usd +
        memberBalance(db, acc.appId).usd +
        memberBalance(db, acc.ipickId).usd,
    );

  function payload(opts: {
    direction: "PAY" | "COLLECT";
    money: number;
    sms: number;
    commission?: number;
  }): SettleAccountRequest {
    const parsed = supplierSettleAccountSchema.parse({
      account_supplier_id: acc.omtId,
      per_currency: {
        USD: {
          direction: opts.direction,
          payments: [{ method: "CASH", currency_code: "USD", amount: opts.money }],
          sms_amount: opts.sms,
          ...(opts.commission !== undefined ? { commission: opts.commission } : {}),
        },
      },
      expected_owed: { usd: owed(), lbp: 0 },
    });
    return { ...parsed, created_by: 1 } as SettleAccountRequest;
  }

  const settle = (p: SettleAccountRequest) => repo.settleAccount(p).id;

  const commissionCredits = () =>
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM supplier_ledger
          WHERE tenant_id = 1 AND note LIKE 'Auto: commission credit%' AND COALESCE(is_refunded, 0) = 0`,
      )
      .get() as { n: number };

  const allocations = () =>
    r2(
      (
        db
          .prepare(
            `SELECT COALESCE(SUM(commission_usd), 0) AS s FROM settlement_commission_allocations WHERE tenant_id = 1`,
          )
          .get() as { s: number }
      ).s,
    );

  describe("we owe OMT (pay)", () => {
    beforeEach(() => seedTestShopOmt(db, acc, false));

    it("SMS 762.30: drawer −762.30, profit 14.20, balance 0, every row closed, no commission credit", () => {
      const before = drawerTotals(db);
      const anchor = settle(payload({ direction: "PAY", money: 762.3, sms: 762.3, commission: 14.2 }));
      expect(r2(drawerTotals(db).usd - before.usd)).toBe(-762.3);
      expect(r2(profitTotals(db).usd)).toBe(14.2);
      expect(accountBalance()).toBe(0);
      expect(queue()).toHaveLength(0);
      expect(commissionCredits().n).toBe(0);
      expect(allocations()).toBe(14.2);
      const txn = settlementTxn(db, anchor);
      const cov = coverageRows(db).filter((c) => c.transaction_id === txn.id);
      expect(r2(cov.filter((c) => c.source === "COMMISSION").reduce((s, c) => s + c.amount, 0))).toBe(14.2);
      const meta = JSON.parse(txn.metadata_json);
      expect(meta.per_currency.USD).toMatchObject({
        sms_amount: 762.3,
        commission: 14.2,
        expected_commission: 4.2,
        extra_commission: 10,
        omt_asks_more: false,
      });
    });

    it("the summary shows the worked-out commission and the SMS figure (FR-012)", () => {
      const anchor = settle(payload({ direction: "PAY", money: 762.3, sms: 762.3 }));
      const summary = (
        db.prepare(`SELECT summary FROM transactions WHERE id = ?`).get(settlementTxn(db, anchor).id) as {
          summary: string;
        }
      ).summary;
      expect(summary).toContain("USD PAY $762.30 + commission $14.20 · SMS $762.30");
    });

    it("the server works the commission out itself when the client sends none", () => {
      settle(payload({ direction: "PAY", money: 762.3, sms: 762.3 }));
      expect(r2(profitTotals(db).usd)).toBe(14.2);
      expect(queue()).toHaveLength(0);
    });

    it("a client commission that disagrees with the SMS is refused as stale", () => {
      expect(() =>
        settle(payload({ direction: "PAY", money: 762.3, sms: 762.3, commission: 10 })),
      ).toThrow(/balance changed/);
    });

    it("untouched box (SMS = expected 772.30): profit = the expected 4.20, never 0", () => {
      settle(payload({ direction: "PAY", money: 772.3, sms: 772.3 }));
      expect(r2(profitTotals(db).usd)).toBe(4.2);
      expect(queue()).toHaveLength(0);
      expect(accountBalance()).toBe(0);
    });

    it("short money: 700 on SMS 762.30 leaves 62.30 owed; the commission is never counted twice", () => {
      settle(payload({ direction: "PAY", money: 700, sms: 762.3 }));
      expect(owed()).toBe(62.3);
      expect(r2(profitTotals(db).usd)).toBe(14.2);
      // The rest: OMT's next SMS for what is left is 62.30 (no commission left).
      settle(payload({ direction: "PAY", money: 62.3, sms: 62.3 }));
      expect(queue()).toHaveLength(0);
      expect(r2(profitTotals(db).usd)).toBe(14.2);
      expect(allocations()).toBe(14.2);
      expect(accountBalance()).toBe(0);
    });
  });

  describe("with an open OMT credit on the account (advisor review)", () => {
    beforeEach(() => seedTestShopOmt(db, acc, false));

    /** A manual Pay on the OMT counter: an ACCOUNT credit (LIRA-343 R4). */
    const credit = (usd: number) =>
      seedLedgerRow(db, acc.omtId, {
        entry_type: "PAYMENT",
        amount_usd: -usd,
        created_at: "2026-10-27 08:00:00",
      });

    it("credit $14.20 below the debts: the SMS figure nets it; expected 758.10, profit 4.20, balance 0", () => {
      credit(14.2);
      const payloadPlus = (sms: number, money: number) => {
        const p = payload({ direction: "PAY", money, sms });
        return { ...p, include_account_credits: true } as SettleAccountRequest;
      };
      const before = drawerTotals(db);
      settle(payloadPlus(758.1, 758.1));
      expect(r2(drawerTotals(db).usd - before.usd)).toBe(-758.1);
      expect(r2(profitTotals(db).usd)).toBe(4.2);
      expect(accountBalance()).toBe(0);
      expect(queue()).toHaveLength(0);
    });

    // Owner 2026-11-03: a credit bigger than the picked days flips the
    // settlement to "OMT pays you" — the whole credit is used. 776.50 owed
    // − 1000 credit = OMT owes us 223.50; expected SMS −227.70.
    // RULE 17 — written before the change; first run: refused with
    // "credit ($1000.00) is more than the picked days owe".
    const withCredits = (p: SettleAccountRequest) =>
      ({ ...p, include_account_credits: true }) as SettleAccountRequest;

    it("credit bigger than the debts flips to OMT pays you: SMS −227.70 receives 227.70, profit 4.20, balance 0", () => {
      credit(1000);
      const before = drawerTotals(db);
      settle(withCredits(payload({ direction: "COLLECT", money: 227.7, sms: -227.7 })));
      expect(r2(drawerTotals(db).usd - before.usd)).toBe(227.7);
      expect(r2(profitTotals(db).usd)).toBe(4.2);
      expect(accountBalance()).toBe(0);
      expect(queue()).toHaveLength(0);
      expect(commissionCredits().n).toBe(0);
    });

    it("credit bigger than the debts, OMT pays $10 more: SMS −237.70, profit 14.20, balance 0", () => {
      credit(1000);
      const before = drawerTotals(db);
      settle(withCredits(payload({ direction: "COLLECT", money: 237.7, sms: -237.7 })));
      expect(r2(drawerTotals(db).usd - before.usd)).toBe(237.7);
      expect(r2(profitTotals(db).usd)).toBe(14.2);
      expect(accountBalance()).toBe(0);
      expect(queue()).toHaveLength(0);
    });

    it("credit bigger than the debts sent as PAY is refused as the wrong direction, nothing written", () => {
      credit(1000);
      const ledgerRows = () =>
        (db.prepare(`SELECT COUNT(*) AS n FROM supplier_ledger WHERE tenant_id = 1`).get() as { n: number }).n;
      const n = ledgerRows();
      expect(() => settle(withCredits(payload({ direction: "PAY", money: 227.7, sms: -227.7 })))).toThrow(
        /pays you in/,
      );
      expect(ledgerRows()).toBe(n);
    });
  });

  describe("OMT owes us (collect)", () => {
    beforeEach(() => seedTestShopOmt(db, acc, true));

    it("SMS −249.70: drawer +249.70, profit 26.20, balance 0, no overpay row, no change", () => {
      const before = drawerTotals(db);
      settle(payload({ direction: "COLLECT", money: 249.7, sms: -249.7 }));
      expect(r2(drawerTotals(db).usd - before.usd)).toBe(249.7);
      expect(r2(profitTotals(db).usd)).toBe(26.2);
      expect(accountBalance()).toBe(0);
      expect(queue()).toHaveLength(0);
      expect(commissionCredits().n).toBe(0);
      const overpay = db
        .prepare(
          `SELECT COUNT(*) AS n FROM supplier_ledger WHERE tenant_id = 1 AND note LIKE 'Overpayment%' AND COALESCE(is_refunded, 0) = 0`,
        )
        .get() as { n: number };
      expect(overpay.n).toBe(0);
    });

    it("the summary says OMT pays (FR-012)", () => {
      const anchor = settle(payload({ direction: "COLLECT", money: 249.7, sms: -249.7 }));
      const summary = (
        db.prepare(`SELECT summary FROM transactions WHERE id = ?`).get(settlementTxn(db, anchor).id) as {
          summary: string;
        }
      ).summary;
      expect(summary).toContain("USD COLLECT $249.70 + commission $26.20 · SMS OMT pays $249.70");
    });

    it("untouched box (SMS −229.70): profit 6.20", () => {
      settle(payload({ direction: "COLLECT", money: 229.7, sms: -229.7 }));
      expect(r2(profitTotals(db).usd)).toBe(6.2);
      expect(accountBalance()).toBe(0);
    });
  });
});
