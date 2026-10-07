/**
 * Hold Money pickup — kept change (owner decision 2026-10-07: a pickup is a
 * PAYOUT, so handing out the round figure keeps the leftover as shop profit,
 * capped below PAYOUT_KEEP_CHANGE_MAX in the pickup's own currency; a payout
 * never carries OUT legs). docs/FEATURE_GUIDE.md §4.1.
 *
 * Every fixture goes through `holdMoneyCollectSchema.parse` (rule 24 — the
 * field names the server actually keeps are the schema's, not hand-typed).
 * Runs against the real fresh schema (`electron-app/create_db.sql`).
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import {
  HoldMoneyRepository,
  resetHoldMoneyRepository,
} from "../HoldMoneyRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { ProfitRepository } from "../ProfitRepository";
import { ProfitService } from "../../services/ProfitService";
import { holdMoneyCollectSchema } from "../../validators/holdMoney";
import { snapshotLedgers, ledgerDeltas } from "../testHelpers/postingAssert";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

const CREATE_DB_SQL_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "electron-app",
  "create_db.sql",
);

let db: Database.Database;
let repo: HoldMoneyRepository;

function collect(body: Record<string, unknown>) {
  return repo.collectHold(holdMoneyCollectSchema.parse(body), 1);
}

function holdUsd(usd: number, lbp = 0): number {
  const res = repo.createHold(
    { client_name: "Rami", usd_amount: usd, lbp_amount: lbp },
    1,
  );
  expect(res.success).toBe(true);
  return res.id!;
}

function collectTxn(): { id: number; profit_usd: number; profit_lbp: number } {
  return db
    .prepare(
      `SELECT id, profit_usd, profit_lbp FROM transactions
       WHERE type = 'HOLD_MONEY_COLLECT' ORDER BY id DESC LIMIT 1`,
    )
    .get() as { id: number; profit_usd: number; profit_lbp: number };
}

function profitSum(): { usd: number; lbp: number } {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(profit_usd), 0) AS usd, COALESCE(SUM(profit_lbp), 0) AS lbp
       FROM transactions WHERE type IN ('HOLD_MONEY_COLLECT', 'HOLD_MONEY_COLLECT_VOID')`,
    )
    .get() as { usd: number; lbp: number };
  return r;
}

function cashUsd(amount: number) {
  return { method: "CASH", currency_code: "USD", amount };
}
function cashLbp(amount: number) {
  return { method: "CASH", currency_code: "LBP", amount };
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf8"));
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  resetHoldMoneyRepository();
  resetTransactionRepository();
  repo = new HoldMoneyRepository();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  resetHoldMoneyRepository();
  resetTransactionRepository();
  resetTenantContext();
  db.close();
});

describe("Hold Money pickup — kept change (payer = payout)", () => {
  it("held $50.12, hands $50 → $0.12 profit on the pickup, the hold clears fully", () => {
    const id = holdUsd(50.12);
    const before = snapshotLedgers(db);

    const res = collect({
      id,
      payments: [cashUsd(50)],
      kept_change_usd: 0.12,
    });
    expect(res.error).toBeUndefined();
    expect(res.success).toBe(true);

    const txn = collectTxn();
    expect(txn.profit_usd).toBeCloseTo(0.12, 6);
    expect(txn.profit_lbp).toBe(0);

    const d = ledgerDeltas(before, snapshotLedgers(db));
    expect(d.drawers["General|USD"]).toBeCloseTo(-50, 6);

    const pickup = db
      .prepare(`SELECT usd_amount, lbp_amount FROM hold_money_pickups WHERE hold_money_id = ?`)
      .get(id) as { usd_amount: number; lbp_amount: number };
    expect(pickup.usd_amount).toBeCloseTo(50.12, 6);

    const hold = repo.getById(id)!;
    expect(hold.status).toBe("collected");
    expect(hold.remaining_usd).toBeCloseTo(0, 6);
  });

  it("LBP-only hold: 1,050,000 held, 1,000,000 handed → 50,000 LBP profit", () => {
    const id = holdUsd(0, 1_050_000);
    const res = collect({
      id,
      payments: [cashLbp(1_000_000)],
      kept_change_lbp: 50_000,
    });
    expect(res.error).toBeUndefined();
    expect(res.success).toBe(true);
    const txn = collectTxn();
    expect(txn.profit_lbp).toBe(50_000);
    expect(txn.profit_usd).toBe(0);
    expect(repo.getById(id)!.status).toBe("collected");
  });

  describe("tampered or disallowed kept change is refused before any write", () => {
    function expectRefused(
      body: Record<string, unknown>,
      message: RegExp,
    ): void {
      const before = snapshotLedgers(db);
      const txnsBefore = (
        db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get() as { n: number }
      ).n;
      const res = collect(body);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(message);
      const d = ledgerDeltas(before, snapshotLedgers(db));
      expect(Object.values(d.drawers).every((v) => Math.abs(v) < 1e-9)).toBe(true);
      expect(
        (db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get() as { n: number }).n,
      ).toBe(txnsBefore);
    }

    it("claimed kept larger than what was actually left unpaid", () => {
      const id = holdUsd(50.12);
      expectRefused(
        { id, payments: [cashUsd(50)], kept_change_usd: 0.5 },
        /reconcile|more than/i,
      );
    });

    it("phantom kept on an exact payout (inside the $0.05 reconcile epsilon)", () => {
      const id = holdUsd(50.12);
      expectRefused(
        { id, payments: [cashUsd(50.12)], kept_change_usd: 0.03 },
        /short|kept/i,
      );
    });

    it("kept at or above the $1 cap", () => {
      const id = holdUsd(51.5);
      expectRefused(
        { id, payments: [cashUsd(50)], kept_change_usd: 1.5 },
        /small leftover/i,
      );
    });

    it("kept in the other currency than the pickup", () => {
      const id = holdUsd(50.12);
      expectRefused(
        { id, payments: [cashUsd(50)], kept_change_lbp: 10_000 },
        /payout currency/i,
      );
    });

    it("kept on a pickup returning both USD and LBP (exact amount required)", () => {
      const id = holdUsd(50.12, 100_000);
      expectRefused(
        {
          id,
          payments: [cashUsd(50), cashLbp(100_000)],
          kept_change_usd: 0.12,
        },
        /one currency/i,
      );
    });

    it("an OUT (change) leg — a payout never receives change", () => {
      const id = holdUsd(50);
      expectRefused(
        {
          id,
          payments: [cashUsd(60), { ...cashUsd(10), direction: "OUT" }],
        },
        /OUT|change/i,
      );
    });

    it("payout lines that are all zero (cashier cleared the amount) — never clears the hold silently", () => {
      const id = holdUsd(50);
      expectRefused(
        { id, payments: [cashUsd(0)] },
        /payout amount|reconcile/i,
      );
      expect(repo.getById(id)!.status).toBe("held");
    });

    it("all-zero payout lines on a two-currency pickup too", () => {
      const id = holdUsd(50, 100_000);
      expectRefused(
        { id, payments: [cashUsd(0), cashLbp(0)] },
        /payout amount|reconcile/i,
      );
    });

    it("an OUT leg on a two-currency pickup too", () => {
      const id = holdUsd(50, 100_000);
      expectRefused(
        {
          id,
          payments: [
            cashUsd(60),
            cashLbp(100_000),
            { ...cashUsd(10), direction: "OUT" },
          ],
        },
        /OUT|change/i,
      );
    });
  });

  it("rule 20 — voiding the pickup nets drawer, profit and the held balance to 0 per currency", () => {
    const id = holdUsd(50.12);
    const before = snapshotLedgers(db);

    const res = collect({ id, payments: [cashUsd(50)], kept_change_usd: 0.12 });
    expect(res.error).toBeUndefined();
    expect(res.success).toBe(true);

    const pickupId = repo.getPickups(id)[0]!.id;
    const v = repo.voidPickup(pickupId, 1);
    expect(v.error).toBeUndefined();
    expect(v.success).toBe(true);

    const d = ledgerDeltas(before, snapshotLedgers(db));
    for (const ledger of Object.values(d)) {
      for (const delta of Object.values(ledger)) {
        expect(Math.abs(delta)).toBeLessThan(1e-9);
      }
    }
    const p = profitSum();
    expect(p.usd).toBeCloseTo(0, 9);
    expect(p.lbp).toBe(0);

    const voidRow = db
      .prepare(`SELECT profit_usd, profit_lbp FROM transactions WHERE type = 'HOLD_MONEY_COLLECT_VOID'`)
      .get() as { profit_usd: number; profit_lbp: number };
    expect(voidRow.profit_usd).toBeCloseTo(-0.12, 9);

    const hold = repo.getById(id)!;
    expect(hold.status).toBe("held");
    expect(hold.remaining_usd).toBeCloseTo(50.12, 6);
  });

  it("an exact pickup with no kept change still books zero profit (unchanged)", () => {
    const id = holdUsd(50, 100_000);
    const res = collect({ id, payments: [cashUsd(50), cashLbp(100_000)] });
    expect(res.success).toBe(true);
    const txn = collectTxn();
    expect(txn.profit_usd).toBe(0);
    expect(txn.profit_lbp).toBe(0);
  });

  // Guard: the kept profit stamped above must reach the Profits page and
  // Closing (both read ProfitService.getSummary's totals). Was `it.failing`
  // while ProfitRepository ignored HOLD_MONEY_COLLECT/_VOID; seen failing as
  // a plain `it` (Expected 0.12, Received 0) before the Hold Money bucket
  // was added.
  it("Profits overview counts the pickup's kept change (gross profit)", () => {
    const id = holdUsd(50.12);
    // ±3 days so a UTC/local day boundary can't make this pass for the
    // wrong reason.
    const d = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const from = d(Date.now() - 3 * 86_400_000);
    const to = d(Date.now() + 3 * 86_400_000);
    const svc = new ProfitService(new ProfitRepository());
    const baseline = svc.getSummary(from, to).totals.gross_profit_usd;
    expect(
      collect({ id, payments: [cashUsd(50)], kept_change_usd: 0.12 }).success,
    ).toBe(true);
    const after = svc.getSummary(from, to).totals.gross_profit_usd;
    expect(after - baseline).toBeCloseTo(0.12, 6);
  });
});

/**
 * Hold Money profit on every Profits surface — written failing-first (rule
 * 17) against a ProfitRepository that did not read HOLD_MONEY_COLLECT/_VOID.
 * Rule 20: the pickup and its void must net to 0 per currency on each one.
 */
describe("Hold Money pickup profit — Profits surfaces", () => {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const from = day(Date.now() - 3 * 86_400_000);
  const to = day(Date.now() + 3 * 86_400_000);
  const svc = () => new ProfitService(new ProfitRepository());

  function holdMoneyModule() {
    return svc()
      .getByModule(from, to)
      .find((r) => r.module === "HOLD_MONEY");
  }

  it("Overview + By Module: +kept after the pickup, back to 0 after its void (USD)", () => {
    const id = holdUsd(50.12);
    const base = svc().getSummary(from, to).totals;
    expect(
      collect({ id, payments: [cashUsd(50)], kept_change_usd: 0.12 }).success,
    ).toBe(true);

    const s1 = svc().getSummary(from, to);
    expect(s1.totals.gross_profit_usd - base.gross_profit_usd).toBeCloseTo(0.12, 6);
    expect(s1.totals.gross_revenue_usd).toBeCloseTo(base.gross_revenue_usd, 6);
    expect(s1.hold_money.profit_usd).toBeCloseTo(0.12, 6);
    expect(s1.hold_money.count).toBe(1);
    const m1 = holdMoneyModule();
    expect(m1?.label).toBe("Hold Money");
    expect(m1?.profit_usd).toBeCloseTo(0.12, 6);
    expect(m1?.revenue_usd).toBe(0);
    expect(m1?.count).toBe(1);

    const pickupId = repo.getPickups(id)[0]!.id;
    expect(repo.voidPickup(pickupId, 1).success).toBe(true);
    const s2 = svc().getSummary(from, to);
    expect(s2.totals.gross_profit_usd - base.gross_profit_usd).toBeCloseTo(0, 9);
    expect(s2.totals.gross_profit_lbp - base.gross_profit_lbp).toBeCloseTo(0, 9);
    expect(s2.hold_money.profit_usd).toBeCloseTo(0, 9);
    // A fully voided pickup leaves no By Module row behind.
    expect(holdMoneyModule()).toBeUndefined();
  });

  it("LBP kept change lands in the LBP column", () => {
    const id = holdUsd(0, 1_050_000);
    expect(
      collect({ id, payments: [cashLbp(1_000_000)], kept_change_lbp: 50_000 })
        .success,
    ).toBe(true);
    const s = svc().getSummary(from, to);
    expect(s.hold_money.profit_lbp).toBeCloseTo(50_000, 6);
    expect(s.hold_money.profit_usd).toBe(0);
    expect(holdMoneyModule()?.profit_lbp).toBeCloseTo(50_000, 6);
  });

  it("By Date carries the same profit as the Overview", () => {
    const id = holdUsd(50.12);
    expect(
      collect({ id, payments: [cashUsd(50)], kept_change_usd: 0.12 }).success,
    ).toBe(true);
    const byDate = svc().getByDate(from, to);
    const sum = byDate.reduce((acc, r) => acc + r.profit_usd, 0);
    expect(sum).toBeCloseTo(svc().getSummary(from, to).totals.gross_profit_usd, 6);
    expect(sum).toBeCloseTo(0.12, 6);
  });

  it("By Cashier / By Client: profit +kept, the payout is NOT revenue, void nets to 0", () => {
    const id = holdUsd(50.12);
    expect(
      collect({ id, payments: [cashUsd(50)], kept_change_usd: 0.12 }).success,
    ).toBe(true);

    const u1 = svc().getByUser(from, to).find((r) => r.user_id === 1);
    expect(u1?.profit_usd).toBeCloseTo(0.12, 6);
    expect(u1?.revenue_usd ?? 0).toBe(0);
    const c1 = svc().getByClient(from, to).find((r) => r.client_name === "Rami");
    expect(c1?.profit_usd).toBeCloseTo(0.12, 6);
    expect(c1?.revenue_usd ?? 0).toBe(0);

    const pickupId = repo.getPickups(id)[0]!.id;
    expect(repo.voidPickup(pickupId, 1).success).toBe(true);
    const u2 = svc().getByUser(from, to).find((r) => r.user_id === 1);
    expect(u2?.profit_usd ?? 0).toBeCloseTo(0, 9);
    expect(u2?.revenue_usd ?? 0).toBeCloseTo(0, 9);
    const c2 = svc().getByClient(from, to).find((r) => r.client_name === "Rami");
    expect(c2?.profit_usd ?? 0).toBeCloseTo(0, 9);
    expect(c2?.revenue_usd ?? 0).toBeCloseTo(0, 9);
  });
});
