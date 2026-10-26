/**
 * LIRA-343 — a LEGACY tick-list settlement (`settleTransactions`) must not
 * leave a phantom open credit on the account.
 *
 * `settleTransactions` books its payment as a `SETTLEMENT` ledger row with
 * no `settlement_id` (only `transaction_id` → the SUPPLIER_SETTLEMENT
 * transaction) and closes the transfers it paid (`is_settled = 1`). That
 * row is the settlement's own bookkeeping (`isSettlementOwnRow`): range
 * mode already leaves it out, and the open queue (`getAccountUnsettled` →
 * settle sheet, default selection, "settle old history", amount-first) must
 * too — otherwise it reads as an open ACCOUNT credit that a later
 * settlement would spend a second time.
 *
 * Genuinely open account credits (a manual Pay, a settlement overpay) stay
 * in the queue.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  SupplierRepository,
  type AccountUnsettledRow,
} from "../SupplierRepository";
import {
  buildDb,
  memberBalance,
  omtAccount,
  resetAll,
  seedLedgerRow,
  seedOmtSend,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";

const round2 = (v: number): number => Math.round(v * 100) / 100 + 0;

const WIDE = { fromUtc: "2000-01-01 00:00:00", toUtc: "2100-01-01 00:00:00" };

function remainingByDay(
  rows: AccountUnsettledRow[],
): Record<string, { usd: number; lbp: number }> {
  const out: Record<string, { usd: number; lbp: number }> = {};
  for (const r of rows) {
    const d = (out[r.shop_day] ??= { usd: 0, lbp: 0 });
    d.usd = round2(d.usd + r.remaining_usd);
    d.lbp = Math.round(d.lbp + r.remaining_lbp) + 0;
  }
  for (const k of Object.keys(out)) {
    if (out[k].usd === 0 && out[k].lbp === 0) delete out[k];
  }
  return out;
}

describe("LIRA-343 — legacy settleTransactions leaves no phantom account credit", () => {
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
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  });

  const settleLegacy = (ids: number[], usd: number) =>
    repo.settleTransactions({
      supplier_id: acc.omtId,
      financial_service_ids: ids,
      amount_usd: usd,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: usd }],
    });

  const settlementLedgerRow = () =>
    db
      .prepare(
        `SELECT id, settlement_id, transaction_id FROM supplier_ledger
          WHERE tenant_id = 1 AND supplier_id = ? AND entry_type = 'SETTLEMENT'`,
      )
      .get(acc.omtId) as {
      id: number;
      settlement_id: number | null;
      transaction_id: number | null;
    };

  it("the SETTLEMENT row is not an open row, and open remaining == balance", () => {
    const fs = seedOmtSend(db, acc.omtId, { amount: 100, model: 0 });
    settleLegacy([fs], 100);

    const settlement = settlementLedgerRow();
    // Premise: the legacy shape — unstamped, linked by transaction only.
    expect(settlement.settlement_id).toBeNull();
    expect(settlement.transaction_id).not.toBeNull();

    const open = repo.getAccountUnsettled(acc.omtId);
    expect(
      open.filter((r) => r.kind === "LEDGER" && r.id === settlement.id),
    ).toEqual([]);
    expect(
      open.filter((r) => r.kind === "FINANCIAL_SERVICE" && r.id === fs),
    ).toEqual([]);

    // Account invariant (lira343Invariant): ledger balance == Σ open remaining.
    for (const member of [acc.omtId, acc.appId, acc.ipickId]) {
      const bal = memberBalance(db, member);
      const mine = open.filter((r) => r.supplier_id === member);
      expect({
        usd: round2(mine.reduce((s, r) => s + r.remaining_usd, 0)),
        lbp: Math.round(mine.reduce((s, r) => s + r.remaining_lbp, 0)) + 0,
      }).toEqual({ usd: round2(bal.usd), lbp: Math.round(bal.lbp) + 0 });
    }

    // Range mode and open mode agree, day by day.
    expect(remainingByDay(open)).toEqual(
      remainingByDay(repo.getAccountRows(acc.omtId, WIDE)),
    );
  });

  const expectBalanceEqualsOpen = () => {
    const open = repo.getAccountUnsettled(acc.omtId);
    for (const member of [acc.omtId, acc.appId, acc.ipickId]) {
      const bal = memberBalance(db, member);
      const mine = open.filter((r) => r.supplier_id === member);
      expect({
        usd: round2(mine.reduce((s, r) => s + r.remaining_usd, 0)),
        lbp: Math.round(mine.reduce((s, r) => s + r.remaining_lbp, 0)) + 0,
      }).toEqual({ usd: round2(bal.usd), lbp: Math.round(bal.lbp) + 0 });
    }
    expect(remainingByDay(open)).toEqual(
      remainingByDay(repo.getAccountRows(acc.omtId, WIDE)),
    );
    return open;
  };

  // Added after the fix — not proven failing-first (rule 17).
  it("model 1 (commission at settlement): net SETTLEMENT row hidden, invariant holds", () => {
    const fs = seedOmtSend(db, acc.omtId, {
      amount: 100,
      fee: 5,
      model: 1,
      type: "INTRA",
    });
    repo.settleTransactions({
      supplier_id: acc.omtId,
      financial_service_ids: [fs],
      amount_usd: 104,
      amount_lbp: 0,
      commission_usd: 1,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 104 }],
      covered_omt_service_types: ["INTRA"],
    });
    const open = expectBalanceEqualsOpen();
    expect(open.some((r) => r.entry_type === "SETTLEMENT")).toBe(false);
  });

  // Added after the fix — not proven failing-first (rule 17).
  it("an overpay on a legacy settlement stays an open credit of exactly the extra", () => {
    const fs = seedOmtSend(db, acc.omtId, { amount: 100, model: 0 });
    // As the sheet sends it: the amount owed, legs paying $10 more.
    repo.settleTransactions({
      supplier_id: acc.omtId,
      financial_service_ids: [fs],
      amount_usd: 100,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 110 }],
    });
    const open = expectBalanceEqualsOpen();
    const credits = open.filter((r) => r.kind === "LEDGER");
    expect(credits.map((r) => [r.entry_type, r.remaining_usd])).toEqual([
      ["PAYMENT", -10],
    ]);
  });

  it("a genuinely open account credit (manual Pay) stays in the queue", () => {
    const fs = seedOmtSend(db, acc.omtId, { amount: 100, model: 0 });
    settleLegacy([fs], 100);
    const pay = seedLedgerRow(db, acc.omtId, {
      entry_type: "PAYMENT",
      amount_usd: -40,
      created_at: "2026-10-02 08:00:00",
    });

    const open = repo.getAccountUnsettled(acc.omtId);
    const row = open.find((r) => r.kind === "LEDGER" && r.id === pay);
    expect(row?.remaining_usd).toBe(-40);
    expect(row?.row_scope).toBe("ACCOUNT");
    expect(round2(open.reduce((s, r) => s + r.remaining_usd, 0))).toBe(
      round2(memberBalance(db, acc.omtId).usd),
    );
  });
});
