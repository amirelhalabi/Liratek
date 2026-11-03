/**
 * LIRA-370 T022/T028/T030 — shares OMT still owes us, "OMT asks more", and
 * the undo of every SMS settlement (rule 20: create + reverse nets to 0 on
 * every ledger, per currency).
 *
 * Fixture: the test shop's OMT account (testHelpers/omtTestShop.ts).
 *
 * Owner decisions 2026-11-03: an SMS that includes only some types' shares
 * still closes every transfer; the other types' shares stay owed by OMT,
 * with no profit, until a later SMS includes them (option A). One SMS may
 * name several types. When OMT asks for more, the expected commission stays
 * owed too. Undoing a settlement whose shares a later one collected is
 * allowed: what was collected stays as an open amount on OMT's account.
 *
 * RULE 17 — NOT proven failing-first: the owed-share and void code was
 * written before this file (said so in tasks.md T022/T030).
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
import { getTransactionRepository } from "../TransactionRepository";
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
  seedOmtSend,
  settlementTxn,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";
import { seedTestShopOmt } from "../testHelpers/omtTestShop";

const UTC = { clientTzOffsetMinutes: 0 };
const r2 = (v: number) => Math.round(v * 100) / 100;

describe("LIRA-370 — owed shares, OMT asks more, undo", () => {
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
  const balance = () =>
    r2(
      memberBalance(db, acc.omtId).usd +
        memberBalance(db, acc.appId).usd +
        memberBalance(db, acc.ipickId).usd,
    );
  const liveShares = () =>
    db
      .prepare(
        `SELECT omt_service_type AS t, amount FROM omt_owed_shares
          WHERE tenant_id = 1 AND is_reversed = 0 AND cleared_settlement_txn_id IS NULL
          ORDER BY id`,
      )
      .all() as Array<{ t: string; amount: number }>;
  const sharesTotal = () => r2(liveShares().reduce((s, x) => s + x.amount, 0));
  const voidTxn = (id: number) => getTransactionRepository().voidTransaction(id, 1);

  function settle(opts: {
    direction: "PAY" | "COLLECT";
    money: number;
    sms: number;
    covered?: OmtCoveredType[];
    sharesOnly?: boolean;
    time?: string;
  }): { anchor: number; txn: number } {
    const parsed = supplierSettleAccountSchema.parse({
      account_supplier_id: acc.omtId,
      per_currency: {
        USD: {
          direction: opts.direction,
          payments: [{ method: "CASH", currency_code: "USD", amount: opts.money }],
          sms_amount: opts.sms,
        },
      },
      expected_owed: { usd: opts.sharesOnly ? 0 : owed(), lbp: 0 },
      ...(opts.covered ? { covered_omt_service_types: opts.covered } : {}),
      ...(opts.sharesOnly ? { owed_shares_only: true } : {}),
      ...(opts.time ? { transaction_time: opts.time } : {}),
    });
    const anchor = repo.settleAccount({ ...parsed, created_by: 1 } as SettleAccountRequest).id;
    return { anchor, txn: settlementTxn(db, anchor).id };
  }

  const snapshot = () => ({
    drawers: drawerTotals(db),
    balance: balance(),
    profit: profitTotals(db),
    owed: owed(),
    shares: sharesTotal(),
  });

  describe("SMS includes only Western Union shares (OMT owes us)", () => {
    beforeEach(() => seedTestShopOmt(db, acc, true));

    it("every transfer closes, profit 2.00, the other $4.20 stays owed by OMT", () => {
      const before = drawerTotals(db);
      settle({ direction: "COLLECT", money: 225.5, sms: -225.5, covered: ["WESTERN_UNION"] });
      expect(r2(drawerTotals(db).usd - before.usd)).toBe(225.5);
      expect(r2(profitTotals(db).usd)).toBe(2);
      expect(balance()).toBe(0);
      expect(queue()).toHaveLength(0);
      expect(liveShares().map((x) => x.t).sort()).toEqual([
        "CASH_TO_BUSINESS",
        "INTRA",
        "INTRA",
        "ONLINE_BROKERAGE",
      ]);
      expect(sharesTotal()).toBe(4.2);
    });

    it("several types (Western Union + Intra): profit 2.20, $4.00 stays owed", () => {
      settle({ direction: "COLLECT", money: 225.7, sms: -225.7, covered: ["WESTERN_UNION", "INTRA"] });
      expect(r2(profitTotals(db).usd)).toBe(2.2);
      expect(sharesTotal()).toBe(4);
    });

    it("a later SMS including Intra + Cash to Business collects those $1.20 (profit then); Brokerage stays", () => {
      const first = settle({
        direction: "COLLECT",
        money: 225.5,
        sms: -225.5,
        covered: ["WESTERN_UNION"],
        time: "2026-11-03T10:00:00.000Z",
      });
      seedOmtSend(db, acc.omtId, {
        amount: 20,
        fee: 1,
        commission: 0.1,
        type: "INTRA",
        created_at: "2026-11-04 09:00:00",
      });
      // OMT's next SMS: 21 − 0.10 (its own Intra) − 1.20 (owed shares) = 19.70
      const before = drawerTotals(db);
      const second = settle({
        direction: "PAY",
        money: 19.7,
        sms: 19.7,
        covered: ["INTRA", "CASH_TO_BUSINESS"],
        time: "2026-11-05T10:00:00.000Z",
      });
      expect(r2(drawerTotals(db).usd - before.usd)).toBe(-19.7);
      expect(r2(settlementTxn(db, second.anchor).profit_usd)).toBe(1.3);
      expect(r2(profitTotals(db).usd)).toBe(3.3);
      expect(balance()).toBe(0);
      expect(liveShares()).toEqual([{ t: "ONLINE_BROKERAGE", amount: 3 }]);
      // Profits bucket by the allocation's day: the collected shares count
      // on the second settlement's day, not the first's.
      const byDay = db
        .prepare(
          `SELECT substr(created_at, 1, 10) AS d, ROUND(SUM(commission_usd), 2) AS c
             FROM settlement_commission_allocations WHERE tenant_id = 1 GROUP BY d ORDER BY d`,
        )
        .all();
      expect(byDay).toEqual([
        { d: "2026-11-03", c: 2 },
        { d: "2026-11-05", c: 1.3 },
      ]);
      expect(first.txn).not.toBe(second.txn);
    });

    it("a shares-only SMS (Brokerage) is settled on its own", () => {
      settle({ direction: "COLLECT", money: 225.5, sms: -225.5, covered: ["WESTERN_UNION"] });
      const before = drawerTotals(db);
      settle({
        direction: "COLLECT",
        money: 3,
        sms: -3,
        covered: ["ONLINE_BROKERAGE"],
        sharesOnly: true,
      });
      expect(r2(drawerTotals(db).usd - before.usd)).toBe(3);
      expect(r2(profitTotals(db).usd)).toBe(5);
      expect(sharesTotal()).toBe(1.2);
      expect(balance()).toBe(0);
    });

    it("shares-only with no owed share of the ticked types is refused", () => {
      expect(() =>
        settle({ direction: "COLLECT", money: 3, sms: -3, covered: ["OMT_CARD"], sharesOnly: true }),
      ).toThrow(/Nothing to settle/);
    });
  });

  describe("OMT asks for more", () => {
    it("pay 790 on 776.50: profit 0, $13.50 OMT credit, the expected $4.20 stays owed", () => {
      seedTestShopOmt(db, acc, false);
      const before = drawerTotals(db);
      const { txn, anchor } = settle({ direction: "PAY", money: 790, sms: 790 });
      expect(r2(drawerTotals(db).usd - before.usd)).toBe(-790);
      expect(r2(profitTotals(db).usd)).toBe(0);
      expect(balance()).toBe(-13.5);
      expect(sharesTotal()).toBe(4.2);
      const meta = JSON.parse(settlementTxn(db, anchor).metadata_json);
      expect(meta.per_currency.USD).toMatchObject({ omt_asks_more: true, difference: 13.5, commission: 0 });
      expect(txn).toBeGreaterThan(0);
    });

    it("collect 210 on 223.50: profit 0, OMT still owes 13.50, the expected $6.20 stays owed", () => {
      seedTestShopOmt(db, acc, true);
      settle({ direction: "COLLECT", money: 210, sms: -210 });
      expect(r2(profitTotals(db).usd)).toBe(0);
      expect(owed()).toBe(-13.5);
      expect(sharesTotal()).toBe(6.2);
    });
  });

  describe("undo (rule 20: nets to 0 everywhere)", () => {
    beforeEach(() => seedTestShopOmt(db, acc, true));

    it("voiding a WU-only settlement removes its owed shares and puts everything back", () => {
      const start = snapshot();
      const { txn } = settle({ direction: "COLLECT", money: 225.5, sms: -225.5, covered: ["WESTERN_UNION"] });
      voidTxn(txn);
      expect(snapshot()).toEqual(start);
    });

    it("voiding the settlement that collected shares makes them owed again", () => {
      settle({ direction: "COLLECT", money: 225.5, sms: -225.5, covered: ["WESTERN_UNION"] });
      seedOmtSend(db, acc.omtId, { amount: 20, fee: 1, commission: 0.1, type: "INTRA", created_at: "2026-11-04 09:00:00" });
      const mid = snapshot();
      const second = settle({ direction: "PAY", money: 19.7, sms: 19.7, covered: ["INTRA", "CASH_TO_BUSINESS"] });
      voidTxn(second.txn);
      expect(snapshot()).toEqual(mid);
    });

    it("voiding the creating settlement first is allowed: the $1.20 collected stays on OMT's account; then voiding the other returns to the start", () => {
      const start = snapshot();
      const first = settle({ direction: "COLLECT", money: 225.5, sms: -225.5, covered: ["WESTERN_UNION"] });
      seedOmtSend(db, acc.omtId, { amount: 20, fee: 1, commission: 0.1, type: "INTRA", created_at: "2026-11-04 09:00:00" });
      const startWithNew = { ...start, owed: r2(start.owed + 21), balance: r2(start.balance + 21) };
      const second = settle({ direction: "PAY", money: 19.7, sms: 19.7, covered: ["INTRA", "CASH_TO_BUSINESS"] });

      voidTxn(first.txn);
      expect(sharesTotal()).toBe(0);
      // The first settlement's transfers are open again; the $1.20 OMT paid
      // for their shares is an open amount on the account (we owe it back).
      const relief = queue().filter((r) => r.row_scope === "ACCOUNT");
      expect(relief.map((r) => r2(r.remaining_usd))).toEqual([1.2]);

      voidTxn(second.txn);
      expect(snapshot()).toEqual(startWithNew);
    });
  });
});
