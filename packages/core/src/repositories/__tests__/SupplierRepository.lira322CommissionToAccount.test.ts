/**
 * LIRA-322 — owner decision 2026-10-15 (replaces FR-013a "commission counts
 * toward coverage"): "Pay the amount in full; don't let the commission
 * amount affect the payment leg amount. After the payment is processed, the
 * commission amount is credited to the supplier account."
 *
 * On the amount-first path:
 * - only money (and a waive) covers rows — the commission never does;
 * - the entered commission is booked as an OPEN credit on the OMT account
 *   in its currency (−commission, is_auto, linked to the settlement's own
 *   transaction), so it shows in the queue and nets first at the next
 *   settlement;
 * - profit is still recognised by the settlement, over the commission-model-1
 *   rows it closes;
 * - the void reverses the credit with the settlement (nets 0 per currency),
 *   and is refused while a LATER settlement has already netted that credit.
 *
 * The test shop's account: six USD transfers $152/$101/$101/$101/$21/$21
 * (oldest first) and one 900,000 LBP send, all on the OMT counter,
 * commission model 1.
 *
 * Rule 17: written and run against the commission-as-coverage code first.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  SupplierRepository,
  type SettleAccountRequest,
} from "../SupplierRepository";
import { getTransactionRepository } from "../TransactionRepository";
import {
  buildDb,
  coverageRows,
  drawerTotals,
  fundDrawer,
  memberBalance,
  omtAccount,
  profitTotals,
  resetAll,
  seedOmtSend,
  settlementTxn,
  writeCounts,
  type CurrencyPair,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";

const USD_ROWS = [152, 101, 101, 101, 21, 21];

describe("LIRA-322 — the settlement commission goes on the account as an open credit (owner 2026-10-15)", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  let acc: OmtAccount;
  let usd: number[];

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
    usd = USD_ROWS.map((amount, i) =>
      seedOmtSend(db, acc.omtId, {
        amount,
        created_at: `2026-10-01 0${i + 1}:00:00`,
      }),
    );
    seedOmtSend(db, acc.omtId, {
      amount: 900000,
      currency: "LBP",
      created_at: "2026-10-01 00:30:00",
    });
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  const cashUsd = (amount: number) => ({
    method: "CASH",
    currency_code: "USD",
    amount,
  });

  function owed(): CurrencyPair {
    const q = repo.getAccountUnsettled(acc.omtId);
    return {
      usd: q.reduce((s, r) => s + r.remaining_usd, 0),
      lbp: q.reduce((s, r) => s + r.remaining_lbp, 0),
    };
  }

  /** Settle USD; returns the SUPPLIER_SETTLEMENT transaction id. */
  function settleUsd(
    amount: number,
    section: Partial<NonNullable<SettleAccountRequest["per_currency"]>["USD"]> = {},
  ): number {
    const anchor = repo.settleAccount({
      account_supplier_id: acc.omtId,
      per_currency: {
        USD: { direction: "PAY", payments: [cashUsd(amount)], ...section },
      },
      expected_owed: owed(),
      created_by: 1,
    }).id;
    return settlementTxn(db, anchor).id;
  }

  const voidTxn = (id: number) =>
    getTransactionRepository().voidTransaction(id, 1);

  function fsSettled(id: number): boolean {
    const r = db
      .prepare(`SELECT settlement_id FROM financial_services WHERE id = ?`)
      .get(id) as { settlement_id: number | null };
    return r.settlement_id != null;
  }

  /** Open LEDGER queue rows (credits / manual rows). */
  function openLedgerRows() {
    return repo
      .getAccountUnsettled(acc.omtId)
      .filter((r) => r.kind === "LEDGER");
  }

  function overpayRows(): number {
    return (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM supplier_ledger
            WHERE note LIKE 'Overpayment%' AND COALESCE(is_refunded, 0) = 0`,
        )
        .get() as { n: number }
    ).n;
  }

  /** data-model.md invariant 1 for every member. */
  function expectBalanceInvariant(): void {
    const q = repo.getAccountUnsettled(acc.omtId);
    for (const member of [acc.omtId, acc.appId, acc.ipickId]) {
      const bal = memberBalance(db, member);
      const rows = q.filter((r) => r.supplier_id === member);
      expect(bal.usd).toBeCloseTo(
        rows.reduce((s, r) => s + r.remaining_usd, 0),
        6,
      );
      expect(bal.lbp).toBeCloseTo(
        rows.reduce((s, r) => s + r.remaining_lbp, 0),
        6,
      );
    }
  }

  function snapshot() {
    return {
      drawers: drawerTotals(db),
      omt: memberBalance(db, acc.omtId),
      app: memberBalance(db, acc.appId),
      ipick: memberBalance(db, acc.ipickId),
      profit: profitTotals(db),
      owed: owed(),
      allocations: (
        db
          .prepare(`SELECT COUNT(*) AS n FROM settlement_commission_allocations`)
          .get() as { n: number }
      ).n,
      activeCoverage: coverageRows(db).filter((c) => c.is_reversed === 0)
        .length,
    };
  }

  function expectSameAs(before: ReturnType<typeof snapshot>): void {
    const now = snapshot();
    for (const key of ["drawers", "omt", "app", "ipick", "profit", "owed"] as const) {
      expect(now[key].usd).toBeCloseTo(before[key].usd, 6);
      expect(now[key].lbp).toBeCloseTo(before[key].lbp, 6);
    }
    expect(now.allocations).toBe(before.allocations);
    expect(now.activeCoverage).toBe(before.activeCoverage);
  }

  it("$300, then $197 + commission $0.70: all four remaining USD rows close, no overpay, one open −0.70 credit, balance −0.70", () => {
    settleUsd(300);
    const profit0 = profitTotals(db);
    const bal0 = memberBalance(db, acc.omtId);
    const second = settleUsd(197, { commission: 0.7 });

    // Every USD transfer is closed — the money alone covered them.
    for (const id of usd) expect(fsSettled(id)).toBe(true);
    // No coverage came from the commission.
    expect(coverageRows(db).filter((c) => c.source === "COMMISSION")).toEqual([]);
    // The commission is NOT an overpay.
    expect(overpayRows()).toBe(0);

    // Exactly one open credit: −0.70 USD, on the OMT counter, linked to the
    // settlement's own transaction, hidden bookkeeping (is_auto).
    const credits = openLedgerRows();
    expect(credits).toHaveLength(1);
    expect(credits[0].supplier_id).toBe(acc.omtId);
    expect(credits[0].remaining_usd).toBeCloseTo(-0.7, 6);
    expect(credits[0].remaining_lbp).toBe(0);
    const row = db
      .prepare(
        `SELECT transaction_id, settlement_id, is_auto, entry_type FROM supplier_ledger WHERE id = ?`,
      )
      .get(credits[0].id) as {
      transaction_id: number;
      settlement_id: number | null;
      is_auto: number;
      entry_type: string;
    };
    expect(row).toEqual({
      transaction_id: second,
      settlement_id: null,
      is_auto: 1,
      entry_type: "SUPPLIER_PAYS_US",
    });

    // The account now shows the shop is owed $0.70; LBP untouched.
    expect(owed().usd).toBeCloseTo(-0.7, 6);
    expect(owed().lbp).toBeCloseTo(900000, 6);
    const bal = memberBalance(db, acc.omtId);
    expect(bal.usd - bal0.usd).toBeCloseTo(-197.7, 6);
    expect(bal.usd).toBeCloseTo(-0.7, 6);

    // Profit: the commission is still recognised by this settlement, over
    // the commission-model-1 rows it closed.
    expect(profitTotals(db).usd - profit0.usd).toBeCloseTo(0.7, 6);
    const alloc = db
      .prepare(
        `SELECT COALESCE(SUM(commission_usd), 0) AS s FROM settlement_commission_allocations`,
      )
      .get() as { s: number };
    expect(alloc.s).toBeCloseTo(0.7, 6);
    expectBalanceInvariant();
  });

  it("$497 + commission $0.70 in one go: all six close, nothing extra, −0.70 credit open", () => {
    const drawers0 = drawerTotals(db);
    settleUsd(497, { commission: 0.7 });
    for (const id of usd) expect(fsSettled(id)).toBe(true);
    expect(overpayRows()).toBe(0);
    expect(drawerTotals(db).usd - drawers0.usd).toBeCloseTo(-497, 6);
    expect(owed().usd).toBeCloseTo(-0.7, 6);
    expectBalanceInvariant();
  });

  it("$496.30 + commission $0.70: the commission does not cover — the newest $21 stays part-paid at $20.30", () => {
    settleUsd(496.3, { commission: 0.7 });
    const newest = repo
      .getAccountUnsettled(acc.omtId)
      .find((r) => r.kind === "FINANCIAL_SERVICE" && r.id === usd[5])!;
    expect(newest.covered_usd).toBeCloseTo(20.3, 6);
    expect(newest.remaining_usd).toBeCloseTo(0.7, 6);
    // ...and the −0.70 credit sits next to it: net owed 0.
    expect(owed().usd).toBeCloseTo(0, 6);
    expectBalanceInvariant();
  });

  it("the next settlement nets the credit first and recognises no profit for it", () => {
    settleUsd(497, { commission: 0.7 });
    // The open credit is the commission, not an overpay.
    expect(overpayRows()).toBe(0);
    const creditId = openLedgerRows()[0].id;
    const newSend = seedOmtSend(db, acc.omtId, {
      amount: 50,
      created_at: "2026-10-02 01:00:00",
    });
    const profit0 = profitTotals(db);
    const drawers0 = drawerTotals(db);
    const next = settleUsd(49.3);

    expect(fsSettled(newSend)).toBe(true);
    expect(openLedgerRows()).toEqual([]);
    const credit = db
      .prepare(`SELECT settlement_id FROM supplier_ledger WHERE id = ?`)
      .get(creditId) as { settlement_id: number | null };
    expect(credit.settlement_id).not.toBeNull();
    const netting = coverageRows(db).filter(
      (c) => c.transaction_id === next && c.row_kind === "LEDGER" && c.row_id === creditId,
    );
    expect(netting).toHaveLength(1);
    expect(netting[0].source).toBe("NETTING");
    expect(netting[0].amount).toBeCloseTo(0.7, 6);
    expect(drawerTotals(db).usd - drawers0.usd).toBeCloseTo(-49.3, 6);
    expect(profitTotals(db).usd - profit0.usd).toBeCloseTo(0, 6);
    expect(owed().usd).toBeCloseTo(0, 6);
    expectBalanceInvariant();
  });

  it("void of the commission settlement nets to 0 per currency and soft-voids the credit", () => {
    const before = snapshot();
    const txn = settleUsd(497, { commission: 0.7 });
    expect(overpayRows()).toBe(0);
    const creditId = openLedgerRows()[0].id;
    voidTxn(txn);
    expectSameAs(before);
    const credit = db
      .prepare(`SELECT is_refunded FROM supplier_ledger WHERE id = ?`)
      .get(creditId) as { is_refunded: number };
    expect(credit.is_refunded).toBe(1);
    expect(openLedgerRows()).toEqual([]);
    expectBalanceInvariant();
  });

  // LIRA-343 (FR-018, R12; owner 2026-10-26 option 3) — rewritten from the
  // LIRA-322 "refused, void newest first" rule: undo has no exception now.
  it("void order: undoing the commission settlement after a later one netted its credit is allowed; the later one stays, the account owes OMT $0.70; undoing both returns to the start", () => {
    const before = snapshot();
    const first = settleUsd(497, { commission: 0.7 });
    expect(overpayRows()).toBe(0);
    seedOmtSend(db, acc.omtId, { amount: 50, created_at: "2026-10-02 01:00:00" });
    const second = settleUsd(49.3);
    const secondCoverage = coverageRows(db).filter((c) => c.transaction_id === second);

    const mid = snapshot();
    voidTxn(first);
    // #first's money is back; #second is untouched.
    expect(drawerTotals(db).usd - mid.drawers.usd).toBeCloseTo(497, 6);
    expect(coverageRows(db).filter((c) => c.transaction_id === second)).toEqual(
      secondCoverage,
    );
    const undoId = (
      db.prepare(`SELECT id FROM transactions WHERE reverses_id = ?`).get(first) as {
        id: number;
      }
    ).id;
    const owedRow = openLedgerRows().filter((r) => r.transaction_id === undoId);
    expect(owedRow.map((r) => [r.row_scope, r.remaining_usd])).toEqual([["ACCOUNT", 0.7]]);
    expectBalanceInvariant();

    voidTxn(second);
    // Back to the start, plus the $50 send still owed.
    const now = snapshot();
    expect(now.owed.usd - before.owed.usd).toBeCloseTo(50, 6);
    expect(now.drawers.usd).toBeCloseTo(before.drawers.usd, 6);
    expect(now.profit.usd).toBeCloseTo(before.profit.usd, 6);
    expect(now.allocations).toBe(before.allocations);
    expectBalanceInvariant();
  });

  it("commission with no commission-carrying transfer closing is still refused and writes nothing", () => {
    const counts0 = writeCounts(db);
    expect(() => settleUsd(100, { commission: 0.7 })).toThrow(/commission/i);
    expect(writeCounts(db)).toEqual(counts0);
  });
});
