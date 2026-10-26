/**
 * LIRA-343 T040 (US7, FR-021/021a, research R6) — "Settle old history up
 * to <date>": one settlement that uses the account credits (whatever their
 * date) to pay the open transfers on or before the date, with no money.
 *
 * The payload is built exactly as the sheet builds it: open queue →
 * `buildDaySelections` (the ONE builder, rule 22) with every open day ≤ the
 * date picked and the default credit use → the core schema's `parse`
 * (rule 23) → the REAL `settleAccount`. Every currency section carries
 * `payments: []`.
 *
 * Seed: a $300 manual Pay on the OMT counter dated 2 Oct (an ACCOUNT row:
 * old payments are often dated after the transfers they paid), and $300 of
 * OMT transfers on 28, 29 and 30 Sep ($100 each). An October transfer
 * stays out of the pick.
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
import { buildDaySelections } from "../../utils/settleDaySelections";
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
  seedOmtSend,
  settlementTxn,
  writeCounts,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";

const UTC = { clientTzOffsetMinutes: 0 };
const UP_TO = "2026-09-30";

describe("LIRA-343 — settle old history up to a date (core)", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  let acc: OmtAccount;
  let sep: { d28: number; d29: number; d30: number; oct5: number };

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
    sep = {
      d28: seedOmtSend(db, acc.omtId, { amount: 100, created_at: "2026-09-28 09:00:00" }),
      d29: seedOmtSend(db, acc.omtId, { amount: 100, created_at: "2026-09-29 09:00:00" }),
      d30: seedOmtSend(db, acc.omtId, { amount: 100, created_at: "2026-09-30 09:00:00" }),
      oct5: seedOmtSend(db, acc.omtId, { amount: 40, created_at: "2026-10-05 09:00:00" }),
    };
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  function queue(): AccountUnsettledRow[] {
    return runWithTenant(1, () => repo.getAccountUnsettled(acc.omtId), UTC);
  }

  function row(kind: string, id: number): AccountUnsettledRow | undefined {
    return queue().find((r) => r.kind === kind && r.id === id);
  }

  /** A manual Pay on the OMT counter dated 2 Oct: an ACCOUNT credit (R4). */
  function seedOldPayment(usd: number): number {
    return seedLedgerRow(db, acc.omtId, {
      entry_type: "PAYMENT",
      amount_usd: -usd,
      created_at: "2026-10-02 08:00:00",
    });
  }

  /** The sheet's one-time payload: every open DAY on or before UP_TO,
   *  default credit use, no money in any currency. */
  function oldHistoryPayload(): SettleAccountRequest {
    const open = queue();
    const pickedDays = [
      ...new Set(
        open
          .filter((r) => r.row_scope === "DAY" && r.shop_day <= UP_TO)
          .map((r) => r.shop_day),
      ),
    ];
    expect(pickedDays.sort()).toEqual(["2026-09-28", "2026-09-29", "2026-09-30"]);
    const built = buildDaySelections(open, { pickedDays });
    const parsed = supplierSettleAccountSchema.parse({
      account_supplier_id: acc.omtId,
      per_currency: { USD: { direction: "PAY", payments: [] } },
      selections: built.selections,
      include_account_credits: true,
      credit_used: built.credit_used,
      expected_owed: built.expected_owed,
    });
    return { ...parsed, created_by: 1 } as SettleAccountRequest;
  }

  function settle(p: SettleAccountRequest): number {
    return runWithTenant(1, () => repo.settleAccount(p).id, UTC);
  }

  function snapshot() {
    const q = queue();
    const omt = memberBalance(db, acc.omtId);
    const app = memberBalance(db, acc.appId);
    const ipick = memberBalance(db, acc.ipickId);
    return {
      drawers: drawerTotals(db),
      account: { usd: omt.usd + app.usd + ipick.usd, lbp: omt.lbp + app.lbp + ipick.lbp },
      omt,
      profit: profitTotals(db),
      owed: {
        usd: Math.round(q.reduce((s, r) => s + r.remaining_usd, 0) * 100) / 100,
        lbp: q.reduce((s, r) => s + r.remaining_lbp, 0),
      },
      payments: writeCounts(db).payments,
      activeCoverage: coverageRows(db).filter((c) => c.is_reversed === 0).length,
    };
  }

  function expectSame(
    before: ReturnType<typeof snapshot>,
    after: ReturnType<typeof snapshot>,
    keys: ReadonlyArray<"drawers" | "account" | "omt" | "profit" | "owed">,
  ): void {
    for (const k of keys) {
      expect([k, after[k].usd]).toEqual([k, expect.closeTo(before[k].usd, 2)]);
      expect([k, after[k].lbp]).toEqual([k, before[k].lbp]);
    }
  }

  function undo(anchor: number): void {
    getTransactionRepository().voidTransaction(settlementTxn(db, anchor).id, 1);
  }

  // ── $300 credit: everything up to 30 Sep closes, nothing moves ──────────

  it("a $300 credit dated 2 Oct closes 28–30 Sep: no drawer, balance unchanged; undo nets to 0", () => {
    const credit = seedOldPayment(300);
    const before = snapshot();
    expect(before.owed.usd).toBeCloseTo(40, 2); // 300 owed − 300 credit + 40 (5 Oct)

    const p = oldHistoryPayload();
    expect(p.credit_used).toEqual({ usd: 300, lbp: 0 });
    const anchor = settle(p);
    const after = snapshot();

    for (const id of [sep.d28, sep.d29, sep.d30]) {
      expect(row("FINANCIAL_SERVICE", id)).toBeUndefined();
    }
    expect(row("LEDGER", credit)).toBeUndefined();
    expect(row("FINANCIAL_SERVICE", sep.oct5)?.remaining_usd).toBe(40);
    // FR-021a: no money, no balance change.
    expectSame(before, after, ["drawers", "account", "omt", "profit", "owed"]);
    expect(after.payments).toBe(before.payments);
    expect(after.activeCoverage).toBeGreaterThan(before.activeCoverage);

    undo(anchor);
    const undone = snapshot();
    expectSame(before, undone, ["drawers", "account", "omt", "profit", "owed"]);
    expect(undone.payments).toBe(before.payments);
    expect(undone.activeCoverage).toBe(before.activeCoverage);
    expect(row("LEDGER", credit)?.remaining_usd).toBeCloseTo(-300, 2);
    expect(row("FINANCIAL_SERVICE", sep.d30)?.remaining_usd).toBe(100);
  });

  // ── $280 credit: 30 Sep stays partly paid with $20 left ─────────────────

  it("a $280 credit closes 28–29 Sep and leaves $20 on 30 Sep; undo nets to 0", () => {
    const credit = seedOldPayment(280);
    const before = snapshot();

    const p = oldHistoryPayload();
    expect(p.credit_used).toEqual({ usd: 280, lbp: 0 });
    const anchor = settle(p);
    const after = snapshot();

    expect(row("FINANCIAL_SERVICE", sep.d28)).toBeUndefined();
    expect(row("FINANCIAL_SERVICE", sep.d29)).toBeUndefined();
    expect(row("FINANCIAL_SERVICE", sep.d30)?.remaining_usd).toBeCloseTo(20, 2);
    expect(row("LEDGER", credit)).toBeUndefined();
    expectSame(before, after, ["drawers", "account", "omt", "profit", "owed"]);
    expect(after.payments).toBe(before.payments);

    undo(anchor);
    const undone = snapshot();
    expectSame(before, undone, ["drawers", "account", "omt", "profit", "owed"]);
    expect(undone.activeCoverage).toBe(before.activeCoverage);
    expect(row("LEDGER", credit)?.remaining_usd).toBeCloseTo(-280, 2);
  });
});
