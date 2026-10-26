/**
 * LIRA-346 — settle partners by day (specs/346-partner-settle-by-day).
 *
 * Full schema (create_db.sql + migrations, so v225 exists). Every check
 * that touches money compares DELTAS per currency (rule 15) and, after
 * every step, the balance invariant: partner balance == Σ open remaining
 * of the settle queue (day rows + account rows), per currency.
 *
 * Rule 17: these were written AFTER the core code (PartnerSettlementRepository
 * / partnerSettleUnits) — NOT proven failing-first. The migration test
 * (v225.partnerSettlementCoverage) was. Recorded honestly in the report.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext";
import { buildDb, drawerTotals, fundDrawer } from "../testHelpers/omtAccountDb";
import {
  PartnerSettlementRepository,
  resetPartnerSettlementRepository,
  type PartnerSettleRow,
} from "../PartnerSettlementRepository";
import {
  PartnerRepository,
  resetPartnerRepository,
} from "../PartnerRepository";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { PartnerService } from "../../services/PartnerService";
import { buildDaySelections } from "../../utils/settleDaySelections";
import { buildSettleDays } from "../../utils/settleDays";
import { partnerCoverageRatioWhereSql } from "../../constants/partnerObligation";
import type { PartnerSettleDaysInput } from "../../validators/partner";

const UTC = { clientTzOffsetMinutes: 0 };

describe("LIRA-346 — partner settle by day", () => {
  let db: Database.Database;
  let settleRepo: PartnerSettlementRepository;
  let partnerRepo: PartnerRepository;
  let service: PartnerService;
  let txRepo: TransactionRepository;
  let partnerId: number;

  const run = <T>(fn: () => T, now?: string): T =>
    runWithTenant(1, fn, {
      ...UTC,
      // effectiveNow takes ISO text ("2026-10-22T15:00:00Z").
      ...(now ? { effectiveNow: `${now.replace(" ", "T")}Z` } : {}),
    });

  beforeEach(() => {
    resetTransactionRepository();
    resetPartnerRepository();
    resetPartnerSettlementRepository();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    settleRepo = new PartnerSettlementRepository();
    partnerRepo = new PartnerRepository();
    service = new PartnerService(partnerRepo, settleRepo);
    txRepo = new TransactionRepository();
    fundDrawer(db, "General", "USD", 10_000);
    fundDrawer(db, "General", "LBP", 100_000_000);
    partnerId = run(() => partnerRepo.create({ name: "Karim" }).id);
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  /** A For sale: sales row + SALE transaction + its FOR_POS DEBIT. */
  function forSale(
    amount: number,
    at: string,
    currency: "USD" | "LBP" = "USD",
  ) {
    const saleId = Number(
      db
        .prepare(
          `INSERT INTO sales (tenant_id, total_amount_usd, final_amount_usd, created_at)
           VALUES (1, ?, ?, ?)`,
        )
        .run(amount, amount, at).lastInsertRowid,
    );
    const txnId = Number(
      db
        .prepare(
          `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id, amount_usd, profit_usd, created_at)
           VALUES (1, 'SALE', 'sales', ?, 1, 0, 10, ?)`,
        )
        .run(saleId, at).lastInsertRowid,
    );
    const rowId = row(
      "FOR_POS",
      "DEBIT",
      amount,
      at,
      { table: "sales", id: saleId },
      currency,
    );
    return { saleId, txnId, rowId };
  }

  function row(
    type: string,
    direction: "DEBIT" | "CREDIT",
    amount: number,
    at: string,
    ref?: { table: string; id: number },
    currency: "USD" | "LBP" = "USD",
  ): number {
    return Number(
      db
        .prepare(
          `INSERT INTO partner_ledger
             (tenant_id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, created_at)
           VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          partnerId,
          type,
          ref?.table ?? null,
          ref?.id ?? null,
          amount,
          currency,
          direction,
          at,
        ).lastInsertRowid,
    );
  }

  const open = (): PartnerSettleRow[] =>
    run(() => service.getSettleOpenRows(partnerId));
  const month = (m: string): PartnerSettleRow[] =>
    run(() => service.getSettleMonthRows(partnerId, m));

  function balance(): { usd: number; lbp: number } {
    return run(() => {
      const b = partnerRepo.getBalance(partnerId);
      return { usd: b.usd, lbp: b.lbp };
    });
  }

  /** Σ open remaining (day + account rows) — must equal the balance. */
  function expectInvariant(): void {
    const rows = open();
    const sum = rows.reduce(
      (s, r) => ({
        usd: s.usd + r.remaining_usd,
        lbp: s.lbp + r.remaining_lbp,
      }),
      { usd: 0, lbp: 0 },
    );
    const b = balance();
    expect(sum.usd).toBeCloseTo(b.usd, 2);
    expect(sum.lbp).toBeCloseTo(b.lbp, 0);
  }

  /** Build the request exactly like the sheet: the ONE builder (rule 22). */
  function settle(opts: {
    days: string[];
    usd?: { payer: "PARTNER" | "SHOP"; amount: number; forgive?: number };
    lbp?: { payer: "PARTNER" | "SHOP"; amount: number };
    creditUsed?: { usd?: number; lbp?: number };
    unticked?: number[];
    at?: string;
  }): number {
    const rows = open();
    const sel = buildDaySelections(rows, {
      pickedDays: opts.days,
      untickedRows: new Set((opts.unticked ?? []).map((id) => `LEDGER:${id}`)),
      ...(opts.creditUsed ? { creditUsed: opts.creditUsed } : {}),
    });
    const section = (
      c: "USD" | "LBP",
      s: { payer: "PARTNER" | "SHOP"; amount: number; forgive?: number },
    ) => ({
      payer: s.payer,
      payments:
        s.amount > 0
          ? [{ method: "CASH", currency_code: c, amount: s.amount }]
          : [],
      ...(s.forgive ? { forgive: { amount: s.forgive } } : {}),
    });
    const req: PartnerSettleDaysInput = {
      partnerId,
      selections: sel.selections.map((s) => s.id),
      include_account_credits: true,
      credit_used: sel.credit_used,
      expected_owed: sel.expected_owed,
      per_currency: {
        ...(opts.usd ? { USD: section("USD", opts.usd) } : {}),
        ...(opts.lbp ? { LBP: section("LBP", opts.lbp) } : {}),
      },
    };
    const res = run(() => service.settleDays({ ...req, userId: 1 }), opts.at);
    if (!res.success) throw new Error(res.error);
    return res.id!;
  }

  const dayState = (rows: PartnerSettleRow[], m: string, day: string) =>
    buildSettleDays(rows, { today: "2026-10-31", month: m }).find(
      (d) => d.day === day,
    )!;

  const coveredAmount = (id: number): number =>
    (
      db
        .prepare(`SELECT covered_amount FROM partner_ledger WHERE id = ?`)
        .get(id) as {
        covered_amount: number;
      }
    ).covered_amount;

  const ratio = (saleId: number): number =>
    (
      db
        .prepare(
          `SELECT ${partnerCoverageRatioWhereSql(
            `plr.reference_table = 'sales' AND plr.reference_id = ${Number(saleId)}`,
          )} AS r`,
        )
        .get() as { r: number }
    ).r;

  // ── P2 — every row on its own day; rows net ─────────────────────────────

  it("P2: For $100 (20 Oct) + Through $300 (21 Oct), the shop pays a net $200 — both days green", () => {
    const sale = forSale(100, "2026-10-20 10:00:00");
    row("THROUGH_OMT_SEND", "CREDIT", 300, "2026-10-21 10:00:00", {
      table: "financial_services",
      id: 9001,
    });
    expectInvariant();
    expect(balance().usd).toBe(-200);
    const drawer0 = drawerTotals(db);

    settle({
      days: ["2026-10-20", "2026-10-21"],
      usd: { payer: "SHOP", amount: 200 },
    });

    const rows = month("2026-10");
    expect(dayState(rows, "2026-10", "2026-10-20").state).toBe("SETTLED");
    expect(dayState(rows, "2026-10", "2026-10-21").state).toBe("SETTLED");
    expect(balance().usd).toBe(0);
    expect(drawerTotals(db).usd - drawer0.usd).toBe(-200);
    expect(open()).toEqual([]);
    expectInvariant();
    // D6 (owner decision 2026-10-26, reversed): the For row closed by
    // NETTING against the Through transfer — its profit is earned now.
    // Rule 24 rewrite: this line asserted 0 ("netting never counts").
    expect(coveredAmount(sale.rowId)).toBe(100);
    expect(ratio(sale.saleId)).toBe(1);
  });

  it("D6: a For sale netted against a Through transfer is earned at that settlement; undo puts it back to deferred (per currency)", () => {
    const usd = forSale(100, "2026-10-20 10:00:00");
    row("THROUGH_OMT_SEND", "CREDIT", 300, "2026-10-21 10:00:00", {
      table: "financial_services",
      id: 9101,
    });
    const lbp = forSale(500_000, "2026-10-20 11:00:00", "LBP");
    row(
      "THROUGH_WHISH_SEND",
      "CREDIT",
      500_000,
      "2026-10-21 11:00:00",
      {
        table: "financial_services",
        id: 9102,
      },
      "LBP",
    );
    const before = snapshot();
    expect(ratio(usd.saleId)).toBe(0);
    expect(ratio(lbp.saleId)).toBe(0);

    const id = settle({
      days: ["2026-10-20", "2026-10-21"],
      usd: { payer: "SHOP", amount: 200 },
      lbp: { payer: "PARTNER", amount: 0 },
      at: "2026-10-22 09:00:00",
    });
    expect(open()).toEqual([]);
    // Earned at the netting settlement, in each currency.
    expect(coveredAmount(usd.rowId)).toBe(100);
    expect(coveredAmount(lbp.rowId)).toBe(500_000);
    expect(ratio(usd.saleId)).toBe(1);
    expect(ratio(lbp.saleId)).toBe(1);
    expectInvariant();

    // Undo (rule 20): back to deferred, and every ledger nets to 0.
    run(() => txRepo.voidTransaction(id, 1), "2026-10-23 09:00:00");
    expect(coveredAmount(usd.rowId)).toBe(0);
    expect(coveredAmount(lbp.rowId)).toBe(0);
    expect(ratio(usd.saleId)).toBe(0);
    expect(ratio(lbp.saleId)).toBe(0);
    const after = snapshot();
    expect(after.drawer).toEqual(before.drawer);
    expect(after.balance).toEqual(before.balance);
    expect(after.covered).toBeCloseTo(before.covered, 5);
    expect(after.profit).toEqual(before.profit);
    expect(after.activeCoverage).toBe(0);
    expectInvariant();
  });

  it("D6 characterization (open owner question): a For sale netted against a paper credit entry is earned too", () => {
    // The coverage row does not record WHAT the For row was netted against,
    // so any day-row CREDIT (here a manual entry with no Through link)
    // releases For profit the same way a Through transfer does.
    const s = forSale(100, "2026-10-20 10:00:00");
    row("ADJUSTMENT", "CREDIT", 100, "2026-10-21 10:00:00");
    settle({
      days: ["2026-10-20", "2026-10-21"],
      usd: { payer: "PARTNER", amount: 0 },
    });
    expect(open()).toEqual([]);
    expect(coveredAmount(s.rowId)).toBe(100);
    expectInvariant();
  });

  // ── skip a day ──────────────────────────────────────────────────────────

  it("skip-a-day: picking only 21 Oct settles it and leaves 20 Oct untouched", () => {
    forSale(50, "2026-10-20 09:00:00");
    const s21 = forSale(70, "2026-10-21 09:00:00");
    settle({ days: ["2026-10-21"], usd: { payer: "PARTNER", amount: 70 } });

    const rows = month("2026-10");
    expect(dayState(rows, "2026-10", "2026-10-20").state).toBe("UNPAID");
    expect(dayState(rows, "2026-10", "2026-10-21").state).toBe("SETTLED");
    expect(balance().usd).toBe(50);
    expect(coveredAmount(s21.rowId)).toBe(70);
    expectInvariant();
  });

  it("unticking a row of a picked day leaves that row open", () => {
    const a = forSale(40, "2026-10-21 09:00:00");
    const b = forSale(60, "2026-10-21 11:00:00");
    settle({
      days: ["2026-10-21"],
      unticked: [a.rowId],
      usd: { payer: "PARTNER", amount: 60 },
    });
    const left = open();
    expect(left.map((r) => r.id)).toEqual([a.rowId]);
    expect(coveredAmount(b.rowId)).toBe(60);
    expectInvariant();
  });

  // ── P3 — overpay becomes partner credit, used next time ────────────────

  it("P3: overpay becomes a partner-credit account row; the next settlement uses it", () => {
    forSale(100, "2026-10-20 09:00:00");
    settle({ days: ["2026-10-20"], usd: { payer: "PARTNER", amount: 130 } });
    let acct = open().filter((r) => r.row_scope === "ACCOUNT");
    expect(acct).toHaveLength(1);
    expect(acct[0].remaining_usd).toBe(-30);
    expect(balance().usd).toBe(-30);
    expectInvariant();

    const s2 = forSale(50, "2026-10-22 09:00:00");
    const drawer0 = drawerTotals(db);
    settle({
      days: ["2026-10-22"],
      creditUsed: { usd: 30 },
      usd: { payer: "PARTNER", amount: 20 },
    });
    expect(drawerTotals(db).usd - drawer0.usd).toBe(20);
    expect(open()).toEqual([]);
    expect(balance().usd).toBe(0);
    // D6 (2026-10-26): the $30 credit is NETTING and now counts too, so
    // the For row is fully earned ($20 cash + $30 credit). Rule 24
    // rewrite: this line asserted 20 ("netting never counts").
    expect(coveredAmount(s2.rowId)).toBe(50);
    acct = open().filter((r) => r.row_scope === "ACCOUNT");
    expect(acct).toHaveLength(0);
    expectInvariant();
  });

  it("refuses partner credit above what can be used", () => {
    forSale(100, "2026-10-20 09:00:00");
    settle({ days: ["2026-10-20"], usd: { payer: "PARTNER", amount: 130 } });
    forSale(10, "2026-10-22 09:00:00");
    expect(() =>
      settle({
        days: ["2026-10-22"],
        creditUsed: { usd: 25 },
        usd: { payer: "PARTNER", amount: 0 },
      }),
    ).toThrow(/more partner credit/);
  });

  it("refuses a stale sheet (the balance changed after it opened)", () => {
    forSale(100, "2026-10-20 09:00:00");
    const rows = open();
    const sel = buildDaySelections(rows, { pickedDays: ["2026-10-20"] });
    forSale(5, "2026-10-20 12:00:00"); // a new row, not in the selection
    // still fine: a new row is not in `selections` — only scope counts…
    row("ADJUSTMENT", "CREDIT", 1, "2026-10-19 08:00:00"); // …but a day row
    const res = run(() =>
      service.settleDays({
        partnerId,
        selections: sel.selections.map((s) => s.id),
        include_account_credits: true,
        expected_owed: { usd: sel.expected_owed.usd + 50, lbp: 0 },
        per_currency: { USD: { payer: "PARTNER", payments: [] } },
        userId: 1,
      }),
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/changed since you opened/);
  });

  // ── Forgive (kept from today's modal) ───────────────────────────────────

  it("forgive covers the oldest picked debt, books a DISCOUNT + COUNTERPARTY_DISCOUNT", () => {
    const s = forSale(100, "2026-10-20 09:00:00");
    settle({
      days: ["2026-10-20"],
      usd: { payer: "PARTNER", amount: 90, forgive: 10 },
    });
    expect(open()).toEqual([]);
    expect(balance().usd).toBe(0);
    expect(coveredAmount(s.rowId)).toBe(100); // WAIVE counts for profit
    const disc = db
      .prepare(
        `SELECT COUNT(*) AS n FROM transactions WHERE type = 'COUNTERPARTY_DISCOUNT' AND status = 'ACTIVE'`,
      )
      .get() as { n: number };
    expect(disc.n).toBe(1);
    expectInvariant();
  });

  // ── Undo in any order nets to 0 ─────────────────────────────────────────

  function snapshot() {
    return {
      drawer: drawerTotals(db),
      balance: balance(),
      covered: (
        db
          .prepare(
            `SELECT COALESCE(SUM(covered_amount), 0) AS c FROM partner_ledger`,
          )
          .get() as {
          c: number;
        }
      ).c,
      profit: db
        .prepare(
          `SELECT COALESCE(SUM(profit_usd), 0) AS usd, COALESCE(SUM(profit_lbp), 0) AS lbp FROM transactions WHERE tenant_id = 1`,
        )
        .get() as { usd: number; lbp: number },
      activeCoverage: (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM partner_settlement_coverage WHERE is_reversed = 0 AND source <> 'RELIEF'`,
          )
          .get() as { n: number }
      ).n,
    };
  }

  it("undo in any order (first settlement first) nets every ledger to 0 per currency", () => {
    forSale(100, "2026-10-20 09:00:00");
    forSale(500_000, "2026-10-21 09:00:00", "LBP");
    row("THROUGH_WHISH_SEND", "CREDIT", 40, "2026-10-21 10:00:00", {
      table: "financial_services",
      id: 77,
    });
    const before = snapshot();
    const a = settle({
      days: ["2026-10-20"],
      usd: { payer: "PARTNER", amount: 100, forgive: 0 },
    });
    const b = settle({
      days: ["2026-10-21"],
      usd: { payer: "SHOP", amount: 40 },
      lbp: { payer: "PARTNER", amount: 500_000 },
    });
    expect(open()).toEqual([]);
    run(() => txRepo.voidTransaction(a, 1), "2026-10-23 09:00:00");
    expectInvariant();
    run(() => txRepo.voidTransaction(b, 1), "2026-10-23 10:00:00");
    expectInvariant();
    const after = snapshot();
    expect(after.drawer).toEqual(before.drawer);
    expect(after.balance).toEqual(before.balance);
    expect(after.covered).toBeCloseTo(before.covered, 5);
    expect(after.profit).toEqual(before.profit);
    expect(after.activeCoverage).toBe(0);
  });

  it("undo #A after #B finished a row #A part-paid: the row stays closed, the account shows the difference (↺ UNDO)", () => {
    const s = forSale(100, "2026-10-20 09:00:00");
    const a = settle({
      days: ["2026-10-20"],
      usd: { payer: "PARTNER", amount: 30 },
    });
    settle({ days: ["2026-10-20"], usd: { payer: "PARTNER", amount: 70 } });
    expect(open()).toEqual([]);
    run(() => txRepo.voidTransaction(a, 1), "2026-10-24 09:00:00");
    const rows = open();
    // The day stays settled; the $30 handed back is owed again, on no day.
    expect(rows.filter((r) => r.row_scope === "DAY")).toEqual([]);
    const acct = rows.filter((r) => r.row_scope === "ACCOUNT");
    expect(acct).toHaveLength(1);
    expect(acct[0].remaining_usd).toBe(30);
    expect(acct[0].relief_origin).toBe("UNDO");
    expect(acct[0].shop_day).toBe("2026-10-24");
    const marks = buildSettleDays(month("2026-10"), {
      today: "2026-10-31",
      month: "2026-10",
    }).find((d) => d.day === "2026-10-24")!.account_marks;
    expect(marks).toEqual([
      { origin: "UNDO", ref: `#${a}`, currency: "USD", amount: 30 },
    ]);
    expect(dayState(month("2026-10"), "2026-10", "2026-10-20").state).toBe(
      "SETTLED",
    );
    // Profit unchanged: the row is still paid (kept coverage).
    expect(coveredAmount(s.rowId)).toBe(100);
    expectInvariant();
  });

  it("undo a settlement whose overpay credit a later settlement used: the account shows it (↺ UNDO)", () => {
    forSale(100, "2026-10-20 09:00:00");
    const a = settle({
      days: ["2026-10-20"],
      usd: { payer: "PARTNER", amount: 130 },
    });
    forSale(30, "2026-10-21 09:00:00");
    settle({
      days: ["2026-10-21"],
      creditUsed: { usd: 30 },
      usd: { payer: "PARTNER", amount: 0 },
    });
    expect(open()).toEqual([]);
    run(() => txRepo.voidTransaction(a, 1), "2026-10-25 09:00:00");
    const rows = open();
    const day = rows.filter((r) => r.row_scope === "DAY");
    expect(day.map((r) => r.remaining_usd)).toEqual([100]); // 20 Oct reopens
    const acct = rows.filter((r) => r.row_scope === "ACCOUNT");
    expect(acct).toHaveLength(1);
    expect(acct[0].remaining_usd).toBe(30); // the credit #B used: owed again
    expect(acct[0].relief_origin).toBe("UNDO");
    expectInvariant();
  });

  // ── P4 — void of a sale a settlement already paid ───────────────────────

  it("P4: voiding a paid For sale turns what was paid into partner credit + ↺ VOID on the void day", () => {
    const s = forSale(100, "2026-10-20 09:00:00");
    const settlementId = settle({
      days: ["2026-10-20"],
      usd: { payer: "PARTNER", amount: 100 },
    });
    const drawer0 = drawerTotals(db);
    run(() => txRepo.voidTransaction(s.txnId, 1), "2026-10-22 15:00:00");

    // The settlement is unchanged.
    const st = db
      .prepare(`SELECT status FROM transactions WHERE id = ?`)
      .get(settlementId) as { status: string };
    expect(st.status).toBe("ACTIVE");
    expect(drawerTotals(db).usd).toBe(drawer0.usd);
    const rows = open();
    expect(rows.filter((r) => r.row_scope === "DAY")).toEqual([]);
    const acct = rows.filter((r) => r.row_scope === "ACCOUNT");
    expect(acct).toHaveLength(1);
    expect(acct[0].remaining_usd).toBe(-100); // the shop owes the partner
    expect(acct[0].relief_origin).toBe("VOID");
    expect(acct[0].relief_ref).toBe(`#${s.txnId}`);
    expect(acct[0].shop_day).toBe("2026-10-22");
    const d = buildSettleDays(month("2026-10"), {
      today: "2026-10-31",
      month: "2026-10",
    });
    expect(d.find((x) => x.day === "2026-10-22")!.account_marks).toEqual([
      { origin: "VOID", ref: `#${s.txnId}`, currency: "USD", amount: 100 },
    ]);
    expect(d.find((x) => x.day === "2026-10-20")!.state).toBe("SETTLED");
    expect(balance().usd).toBe(-100);
    expectInvariant();

    // The credit is used by the next settlement.
    forSale(100, "2026-10-26 09:00:00");
    settle({
      days: ["2026-10-26"],
      creditUsed: { usd: 100 },
      usd: { payer: "PARTNER", amount: 0 },
    });
    expect(open()).toEqual([]);
    expectInvariant();
  });

  // ── Profit parity (old path vs new path) ────────────────────────────────

  it("profit parity: a fully settled For sale is recognised the same by the old settle and the new one", () => {
    const oldSale = forSale(100, "2026-10-20 09:00:00");
    expect(ratio(oldSale.saleId)).toBe(0);
    run(() =>
      service.settle({
        partnerId,
        amount: 100,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
      }),
    );
    const oldCovered = coveredAmount(oldSale.rowId);
    const oldRatio = ratio(oldSale.saleId);

    const newSale = forSale(100, "2026-10-21 09:00:00");
    expect(ratio(newSale.saleId)).toBe(0);
    settle({ days: ["2026-10-21"], usd: { payer: "PARTNER", amount: 100 } });
    expect(coveredAmount(newSale.rowId)).toBe(oldCovered);
    expect(ratio(newSale.saleId)).toBe(oldRatio);
    expect(oldRatio).toBe(1);
    expectInvariant();
  });

  it("the old balance-based settle writes coverage rows and is undone exactly", () => {
    const s = forSale(100, "2026-10-20 09:00:00");
    const entry = run(() =>
      service.settle({
        partnerId,
        amount: 60,
        currency: "USD",
        settlementMethod: "CASH",
        userId: 1,
      }),
    );
    const txn = db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'partner_ledger' AND source_id = ?`,
      )
      .get(entry.id) as { id: number };
    const cov = db
      .prepare(
        `SELECT transaction_id, source, SUM(amount) AS a FROM partner_settlement_coverage GROUP BY transaction_id, source`,
      )
      .all();
    expect(cov).toEqual([
      { transaction_id: txn.id, source: "PAYMENT", a: 120 },
    ]); // 60 on the row + 60 self
    expect(coveredAmount(s.rowId)).toBe(60);
    expectInvariant();
    run(() => txRepo.voidTransaction(txn.id, 1));
    expect(coveredAmount(s.rowId)).toBe(0);
    expect(balance().usd).toBe(100);
    expectInvariant();
  });

  // ── D7 — history from before v225 ───────────────────────────────────────

  it("pre-v225 history: legacy coverage is matched to old settlements; 'settle old history' nets the rest with no money", () => {
    // Before v225: For 100 (DEBIT), Through 30 (CREDIT), the partner paid 70;
    // the old settle stamped 70 on the For row.
    const s = forSale(100, "2026-09-10 09:00:00");
    row("THROUGH_OMT_SEND", "CREDIT", 30, "2026-09-11 09:00:00", {
      table: "financial_services",
      id: 501,
    });
    row("SETTLEMENT", "CREDIT", 70, "2026-09-12 09:00:00");
    db.prepare(
      `UPDATE partner_ledger SET covered_amount = 70, legacy_covered_amount = 70 WHERE id = ?`,
    ).run(s.rowId);
    expectInvariant();
    const rows = month("2026-09");
    expect(dayState(rows, "2026-09", "2026-09-10").state).toBe("PARTIAL");
    expect(dayState(rows, "2026-09", "2026-09-11").state).toBe("UNPAID");
    expect(open().filter((r) => r.row_scope === "ACCOUNT")).toEqual([]);

    const drawer0 = drawerTotals(db);
    settle({
      days: ["2026-09-10", "2026-09-11"],
      usd: { payer: "PARTNER", amount: 0 },
    });
    expect(open()).toEqual([]);
    expect(drawerTotals(db)).toEqual(drawer0);
    expect(balance().usd).toBe(0);
    // D6 (2026-10-26): the $30 netted against the Through row now counts;
    // the frozen legacy 70 is untouched. Rule 24 rewrite: this asserted 70
    // ("netting never counts").
    expect(coveredAmount(s.rowId)).toBe(100);
    expect(
      (
        db
          .prepare(
            `SELECT legacy_covered_amount AS l FROM partner_ledger WHERE id = ?`,
          )
          .get(s.rowId) as {
          l: number;
        }
      ).l,
    ).toBe(70);
    expectInvariant();
  });

  it("undoing a pre-v225 settlement gives back only its legacy part, newest first", () => {
    const s = forSale(100, "2026-09-10 09:00:00");
    const settleRow = row("SETTLEMENT", "CREDIT", 100, "2026-09-12 09:00:00");
    db.prepare(
      `UPDATE partner_ledger SET covered_amount = 100, legacy_covered_amount = 100 WHERE id = ?`,
    ).run(s.rowId);
    const txn = Number(
      db
        .prepare(
          `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id, amount_usd)
           VALUES (1, 'PARTNER_SETTLEMENT', 'partner_ledger', ?, 1, 100)`,
        )
        .run(settleRow).lastInsertRowid,
    );
    expect(open()).toEqual([]);
    run(() => txRepo.voidTransaction(txn, 1));
    expect(coveredAmount(s.rowId)).toBe(0);
    expect(open().map((r) => r.remaining_usd)).toEqual([100]);
    expectInvariant();
  });

  // ── Item refund nets into the sale's own day ────────────────────────────

  it("an item refund (row referencing the refund transaction) nets into the sale's day", () => {
    const s = forSale(100, "2026-10-20 09:00:00");
    const refundTxn = Number(
      db
        .prepare(
          `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id, created_at)
           VALUES (1, 'REFUND', 'sales', ?, 1, '2026-10-23 09:00:00')`,
        )
        .run(s.saleId).lastInsertRowid,
    );
    row("FOR_POS", "CREDIT", 30, "2026-10-23 09:00:00", {
      table: "transactions",
      id: refundTxn,
    });
    const rows = open();
    expect(rows).toHaveLength(1);
    expect(rows[0].shop_day).toBe("2026-10-20");
    expect(rows[0].remaining_usd).toBe(70);
    expectInvariant();
  });

  // ── Day detail ──────────────────────────────────────────────────────────

  it("day detail lists each row with the settlements that paid it", () => {
    const s = forSale(100, "2026-10-20 09:00:00");
    const a = settle({
      days: ["2026-10-20"],
      usd: { payer: "PARTNER", amount: 40 },
    });
    const b = settle({
      days: ["2026-10-20"],
      usd: { payer: "PARTNER", amount: 60 },
    });
    const detail = run(() =>
      service.getSettleDayDetail(partnerId, "2026-10-20"),
    );
    expect(detail).toHaveLength(1);
    expect(detail[0].id).toBe(s.rowId);
    expect(
      detail[0].settlements.map((x) => [x.transaction_id, x.amount]),
    ).toEqual([
      [a, 40],
      [b, 60],
    ]);
  });

  it("shop day follows the client's zone (rule 27): 22:30 UTC is the next day in Beirut", () => {
    forSale(10, "2026-10-24 22:30:00");
    const rows = runWithTenant(1, () => service.getSettleOpenRows(partnerId), {
      clientTzOffsetMinutes: 180,
    });
    expect(rows[0].shop_day).toBe("2026-10-25");
  });

  // ── Seeded property test: balance == Σ open remaining ───────────────────

  it("property: random settle / undo / void sequences keep balance == Σ open remaining per currency", () => {
    let seed = 346;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const pickInt = (n: number): number => Math.floor(rnd() * n);
    // Legacy rows first (pre-v225 state).
    const legacy = forSale(80, "2026-09-01 09:00:00");
    row("SETTLEMENT", "CREDIT", 50, "2026-09-02 09:00:00");
    db.prepare(
      `UPDATE partner_ledger SET covered_amount = 50, legacy_covered_amount = 50 WHERE id = ?`,
    ).run(legacy.rowId);

    const sales: number[] = [];
    const settlements: number[] = [];
    const done = { settled: 0, undone: 0, voided: 0 };
    for (let step = 0; step < 80; step++) {
      const day = `2026-10-${String(1 + (step % 28)).padStart(2, "0")}`;
      const op = pickInt(6);
      try {
        if (op === 0) {
          sales.push(forSale(10 + pickInt(90), `${day} 09:00:00`).txnId);
        } else if (op === 1) {
          forSale(100_000 + pickInt(900_000), `${day} 10:00:00`, "LBP");
        } else if (op === 2) {
          row(
            "THROUGH_OMT_SEND",
            "CREDIT",
            5 + pickInt(60),
            `${day} 11:00:00`,
            { table: "financial_services", id: 10_000 + step },
          );
        } else if (op === 3) {
          const days = [
            ...new Set(
              open()
                .filter((r) => r.row_scope === "DAY")
                .map((r) => r.shop_day),
            ),
          ];
          const picked = days.filter(() => rnd() < 0.6);
          if (picked.length === 0) continue;
          const sel = buildDaySelections(open(), { pickedDays: picked });
          const usdPayer = sel.prefill.usd >= 0 ? "PARTNER" : "SHOP";
          const lbpPayer = sel.prefill.lbp >= 0 ? "PARTNER" : "SHOP";
          const factor = [0.5, 1, 1.2][pickInt(3)];
          const usdAmt =
            Math.round(Math.abs(sel.prefill.usd) * factor * 100) / 100;
          const lbpAmt = Math.round(Math.abs(sel.prefill.lbp) * factor);
          settlements.push(
            settle({
              days: picked,
              usd: { payer: usdPayer, amount: usdAmt },
              lbp: { payer: lbpPayer, amount: lbpAmt },
              at: `${day} 18:00:00`,
            }),
          );
          done.settled++;
        } else if (op === 4 && settlements.length > 0) {
          const i = pickInt(settlements.length);
          const id = settlements.splice(i, 1)[0];
          run(() => txRepo.voidTransaction(id, 1), `${day} 19:00:00`);
          done.undone++;
        } else if (op === 5 && sales.length > 0) {
          const i = pickInt(sales.length);
          const id = sales.splice(i, 1)[0];
          run(() => txRepo.voidTransaction(id, 1), `${day} 20:00:00`);
          done.voided++;
        }
      } catch (e) {
        throw new Error(`step ${step} op ${op}: ${(e as Error).message}`);
      }
      expectInvariant();
    }
    // The sequence really exercised every operation (rule 28a).
    expect(done.settled).toBeGreaterThanOrEqual(5);
    expect(done.undone).toBeGreaterThanOrEqual(3);
    expect(done.voided).toBeGreaterThanOrEqual(3);
  });
});
