/**
 * LIRA-343 T022/T023 — settling picked days, with the OMT account credit.
 *
 * The payload is built exactly as the sheet builds it: open queue →
 * `buildDaySelections` (the ONE builder, rule 22) → the core schema's
 * `parse` (so the new keys survive Zod's key stripping, rule 23) → the
 * repository. Field names come from the schema, never hand-typed (rule 24).
 *
 * Seed (quickstart §4, the mock's October):
 *   21 Oct  #410 $47 (an unpicked day)
 *   22 Oct  #411 900,000 LBP (an unpicked day)
 *   23 Oct  #421 $120
 *   24 Oct  iPick $95 TOP_UP, OMT App cash-out −$40 (a day credit)
 *   25 Oct  #430 $200, #431 990,000 LBP
 *
 * RULE 17 — written before T023; the first run's failures are recorded in
 * the T023 hand-off report.
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
const PICKED = ["2026-10-23", "2026-10-24", "2026-10-25"];

describe("LIRA-343 — settle picked days (core)", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  let acc: OmtAccount;
  let ids: {
    r410: number;
    r411: number;
    r421: number;
    ipick95: number;
    cash40: number;
    r430: number;
    r431: number;
  };

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
    const r410 = seedOmtSend(db, acc.omtId, {
      amount: 47,
      created_at: "2026-10-21 09:00:00",
    });
    const r411 = seedOmtSend(db, acc.omtId, {
      amount: 900000,
      currency: "LBP",
      created_at: "2026-10-22 09:00:00",
    });
    const r421 = seedOmtSend(db, acc.omtId, {
      amount: 120,
      created_at: "2026-10-23 09:00:00",
    });
    const ipick95 = seedLedgerRow(db, acc.ipickId, {
      entry_type: "TOP_UP",
      amount_usd: 95,
      created_at: "2026-10-24 10:00:00",
    });
    // OMT App cash-out: a DAY credit (PAYMENT with a source link, R4).
    const cash40 = seedLedgerRow(db, acc.appId, {
      entry_type: "PAYMENT",
      amount_usd: -40,
      created_at: "2026-10-24 11:00:00",
    });
    db.prepare(
      `UPDATE supplier_ledger SET source_ref_table = 'recharges', source_ref_id = 1 WHERE id = ?`,
    ).run(cash40);
    const r430 = seedOmtSend(db, acc.omtId, {
      amount: 200,
      created_at: "2026-10-25 09:00:00",
    });
    const r431 = seedOmtSend(db, acc.omtId, {
      amount: 990000,
      currency: "LBP",
      created_at: "2026-10-25 10:00:00",
    });
    ids = { r410, r411, r421, ipick95, cash40, r430, r431 };
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

  /** A manual Pay on the OMT counter: an ACCOUNT credit (R4). */
  function seedAccountCredit(usd: number, lbp = 0): number {
    return seedLedgerRow(db, acc.omtId, {
      entry_type: "PAYMENT",
      amount_usd: -usd,
      amount_lbp: -lbp,
      created_at: "2026-10-26 08:00:00",
    });
  }

  const cash = (currency_code: "USD" | "LBP", amount: number) => ({
    method: "CASH",
    currency_code,
    amount,
  });

  /** The sheet's payload: builder output + per_currency, through the schema. */
  function payload(opts: {
    usd: number;
    lbp: number;
    creditUsed?: { usd?: number; lbp?: number };
    expectedOverride?: { usd: number; lbp: number };
  }): SettleAccountRequest {
    const built = buildDaySelections(queue(), {
      pickedDays: PICKED,
      creditUsed: opts.creditUsed ?? { usd: 0, lbp: 0 },
    });
    const parsed = supplierSettleAccountSchema.parse({
      account_supplier_id: acc.omtId,
      per_currency: {
        USD: { direction: "PAY", payments: [cash("USD", opts.usd)] },
        LBP: { direction: "PAY", payments: [cash("LBP", opts.lbp)] },
      },
      selections: built.selections,
      include_account_credits: true,
      credit_used: built.credit_used,
      expected_owed: opts.expectedOverride ?? built.expected_owed,
    });
    return { ...parsed, created_by: 1 } as SettleAccountRequest;
  }

  function settle(p: SettleAccountRequest): number {
    return repo.settleAccount(p).id;
  }

  function coverageOf(anchor: number) {
    const txn = settlementTxn(db, anchor).id;
    return coverageRows(db)
      .filter((c) => c.transaction_id === txn)
      .map((c) => ({
        key: `${c.row_kind}:${c.row_id}`,
        currency: c.currency,
        source: c.source,
        amount: c.amount,
      }));
  }

  function snapshot() {
    const q = queue();
    return {
      drawers: drawerTotals(db),
      omt: memberBalance(db, acc.omtId),
      app: memberBalance(db, acc.appId),
      ipick: memberBalance(db, acc.ipickId),
      profit: profitTotals(db),
      owed: {
        usd: Math.round(q.reduce((s, r) => s + r.remaining_usd, 0) * 100) / 100,
        lbp: q.reduce((s, r) => s + r.remaining_lbp, 0),
      },
      activeCoverage: coverageRows(db).filter((c) => c.is_reversed === 0)
        .length,
    };
  }

  function expectNetZero(
    before: ReturnType<typeof snapshot>,
    after: ReturnType<typeof snapshot>,
  ): void {
    for (const k of ["drawers", "omt", "app", "ipick", "profit", "owed"] as const) {
      expect(after[k].usd).toBeCloseTo(before[k].usd, 2);
      expect(after[k].lbp).toBe(before[k].lbp);
    }
    expect(after.activeCoverage).toBe(before.activeCoverage);
  }

  // ── (a) the exact coverage of picked days; other days untouched ─────────

  it("(a) pick 23–25 Oct, pay $250 + 990,000 LBP, credit 0 → exact coverage; 21/22 Oct untouched", () => {
    const anchor = settle(payload({ usd: 250, lbp: 990000 }));

    const cov = coverageOf(anchor);
    expect(cov).toHaveLength(6);
    expect(cov).toEqual(
      expect.arrayContaining([
        { key: `LEDGER:${ids.cash40}`, currency: "USD", source: "NETTING", amount: 40 },
        { key: `FINANCIAL_SERVICE:${ids.r421}`, currency: "USD", source: "NETTING", amount: 40 },
        { key: `FINANCIAL_SERVICE:${ids.r421}`, currency: "USD", source: "PAYMENT", amount: 80 },
        { key: `LEDGER:${ids.ipick95}`, currency: "USD", source: "PAYMENT", amount: 95 },
        { key: `FINANCIAL_SERVICE:${ids.r430}`, currency: "USD", source: "PAYMENT", amount: 75 },
        { key: `FINANCIAL_SERVICE:${ids.r431}`, currency: "LBP", source: "PAYMENT", amount: 990000 },
      ]),
    );
    expect(row("FINANCIAL_SERVICE", ids.r430)?.remaining_usd).toBeCloseTo(125, 2);
    expect(row("FINANCIAL_SERVICE", ids.r431)).toBeUndefined();
    expect(row("FINANCIAL_SERVICE", ids.r410)?.remaining_usd).toBe(47);
    expect(row("FINANCIAL_SERVICE", ids.r411)?.remaining_lbp).toBe(900000);
  });

  // ── (b) the account credit is used as the user set it ───────────────────

  it("(b) an $8.70 account credit, credit_used 8.70, pay $366.30 → all closed, credit consumed", () => {
    const credit = seedAccountCredit(8.7);
    const p = payload({ usd: 366.3, lbp: 990000, creditUsed: { usd: 8.7 } });
    expect(p.expected_owed).toEqual({ usd: 366.3, lbp: 990000 });
    const anchor = settle(p);

    for (const [kind, id] of [
      ["FINANCIAL_SERVICE", ids.r421],
      ["LEDGER", ids.ipick95],
      ["LEDGER", ids.cash40],
      ["FINANCIAL_SERVICE", ids.r430],
      ["FINANCIAL_SERVICE", ids.r431],
      ["LEDGER", credit],
    ] as const) {
      expect(row(kind, id)).toBeUndefined();
    }
    // The credit is used as NETTING (shop pays), so the existing reversal applies.
    expect(coverageOf(anchor)).toEqual(
      expect.arrayContaining([
        { key: `LEDGER:${credit}`, currency: "USD", source: "NETTING", amount: 8.7 },
      ]),
    );
    expect(row("FINANCIAL_SERVICE", ids.r410)?.remaining_usd).toBe(47);
  });

  it("(b2) credit_used 5 of 8.70 with $370 → all closed, 3.70 of credit left open; undo nets to 0", () => {
    const credit = seedAccountCredit(8.7);
    const before = snapshot();
    const anchor = settle(payload({ usd: 370, lbp: 990000, creditUsed: { usd: 5 } }));
    expect(row("FINANCIAL_SERVICE", ids.r430)).toBeUndefined();
    expect(row("LEDGER", credit)?.remaining_usd).toBeCloseTo(-3.7, 2);

    // Not proven failing-first: written after T023 (rule 17).
    getTransactionRepository().voidTransaction(settlementTxn(db, anchor).id, 1);
    expectNetZero(before, snapshot());
    expect(row("LEDGER", credit)?.remaining_usd).toBeCloseTo(-8.7, 2);
  });

  // ── (c) too much credit is refused plainly, before any write ────────────

  it("(c) credit_used more than the credit → refused, nothing written", () => {
    seedAccountCredit(8.7);
    const before = writeCounts(db);
    expect(() =>
      settle(payload({ usd: 366, lbp: 990000, creditUsed: { usd: 9 } })),
    ).toThrow(/You can use at most \$8\.70 of OMT credit/);
    expect(writeCounts(db)).toEqual(before);
  });

  it("(c) credit_used more than the picked days owe → refused, nothing written", () => {
    seedAccountCredit(500);
    const before = writeCounts(db);
    expect(() =>
      settle(payload({ usd: 1, lbp: 990000, creditUsed: { usd: 400 } })),
    ).toThrow(/You can use at most \$375\.00 of OMT credit/);
    expect(writeCounts(db)).toEqual(before);
  });

  // ── (d) the stale check counts the account rows ─────────────────────────

  it("(d) expected_owed without the account credit → refused as stale; with it → accepted", () => {
    seedAccountCredit(8.7);
    const before = writeCounts(db);
    expect(() =>
      settle(
        payload({
          usd: 375,
          lbp: 990000,
          expectedOverride: { usd: 375, lbp: 990000 },
        }),
      ),
    ).toThrow(/OMT's balance changed since you opened this sheet/);
    expect(writeCounts(db)).toEqual(before);

    // The builder's figure (375 − 8.70) is what the server recomputes.
    expect(() => settle(payload({ usd: 375, lbp: 990000 }))).not.toThrow();
  });

  // ── (e) create + undo nets to 0 per ledger per currency ─────────────────

  it("(e) settle with the credit, then undo → every ledger back, credit open again", () => {
    const credit = seedAccountCredit(8.7);
    const before = snapshot();
    const anchor = settle(payload({ usd: 366.3, lbp: 990000, creditUsed: { usd: 8.7 } }));
    const after = snapshot();
    expect(after.drawers.usd).toBeCloseTo(before.drawers.usd - 366.3, 2);
    expect(after.drawers.lbp).toBe(before.drawers.lbp - 990000);
    expect(row("LEDGER", credit)).toBeUndefined();

    getTransactionRepository().voidTransaction(settlementTxn(db, anchor).id, 1);

    const undone = snapshot();
    expect(undone.drawers).toEqual(before.drawers);
    for (const k of ["omt", "app", "ipick", "profit", "owed"] as const) {
      expect(undone[k].usd).toBeCloseTo(before[k].usd, 2);
      expect(undone[k].lbp).toBe(before[k].lbp);
    }
    expect(undone.activeCoverage).toBe(before.activeCoverage);
    expect(row("LEDGER", credit)?.remaining_usd).toBeCloseTo(-8.7, 2);
  });

  // ── (f) the two new keys are recorded ──────────────────────────────────

  it("(f) metadata_json records include_account_credits and credit_used", () => {
    seedAccountCredit(8.7);
    const anchor = settle(payload({ usd: 366.3, lbp: 990000, creditUsed: { usd: 8.7 } }));
    const meta = JSON.parse(settlementTxn(db, anchor).metadata_json) as Record<
      string,
      unknown
    >;
    expect(meta.include_account_credits).toBe(true);
    expect(meta.credit_used).toEqual({ usd: 8.7, lbp: 0 });
  });

  // ── (g) a transfer recorded after the sheet was built ───────────────────

  it("(g) a transfer recorded after selections were built is not settled, not refused, stays open", () => {
    const p = payload({ usd: 250, lbp: 990000 });
    const late = seedOmtSend(db, acc.omtId, {
      amount: 33,
      created_at: "2026-10-25 18:00:00",
    });
    expect(() => settle(p)).not.toThrow();
    expect(row("FINANCIAL_SERVICE", late)?.remaining_usd).toBe(33);
  });

  // ── OMT pays: received money covers day credits, then the account credit ─

  it("OMT pays: credit_used 8.70 with $108.70 received → day credit and account credit closed", () => {
    const rcv = seedLedgerRow(db, acc.appId, {
      entry_type: "PAYMENT",
      amount_usd: -100,
      created_at: "2026-10-20 10:00:00",
    });
    db.prepare(
      `UPDATE supplier_ledger SET source_ref_table = 'recharges', source_ref_id = 2 WHERE id = ?`,
    ).run(rcv);
    const credit = seedAccountCredit(8.7);
    const built = buildDaySelections(queue(), {
      pickedDays: ["2026-10-20"],
      creditUsed: { usd: 8.7 },
    });
    expect(built.prefill.usd).toBeCloseTo(-108.7, 2);
    const p = supplierSettleAccountSchema.parse({
      account_supplier_id: acc.omtId,
      per_currency: {
        USD: { direction: "COLLECT", payments: [cash("USD", 108.7)] },
      },
      selections: built.selections,
      include_account_credits: true,
      credit_used: built.credit_used,
      expected_owed: built.expected_owed,
    });
    const before = snapshot();
    const anchor = settle({ ...p, created_by: 1 } as SettleAccountRequest);
    expect(drawerTotals(db).usd).toBeCloseTo(before.drawers.usd + 108.7, 2);
    expect(row("LEDGER", rcv)).toBeUndefined();
    expect(row("LEDGER", credit)).toBeUndefined();
    expect(coverageOf(anchor)).toEqual(
      expect.arrayContaining([
        { key: `LEDGER:${credit}`, currency: "USD", source: "PAYMENT", amount: 8.7 },
      ]),
    );

    // Not proven failing-first: written after T023 (rule 17).
    getTransactionRepository().voidTransaction(settlementTxn(db, anchor).id, 1);
    expectNetZero(before, snapshot());
    expect(row("LEDGER", credit)?.remaining_usd).toBeCloseTo(-8.7, 2);
    expect(row("LEDGER", rcv)?.remaining_usd).toBeCloseTo(-100, 2);
  });
});
