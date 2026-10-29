/**
 * LIRA-345 — the LIRA-343 settle-by-day calendar for suppliers outside the
 * OMT account: Katsh top-ups, product suppliers and Whish (owner decisions
 * S1–S4, 2026-10-26). Each one is an "account of one": the same queue,
 * allocator, coverage and undo as the OMT account.
 *
 * The payload is built the way the sheet builds it: open queue →
 * `buildDaySelections` (the ONE builder, rule 22) → the core schema's
 * `parse` (rule 23/24) → the service (which carries the server gate).
 *
 * RULE 17 — written before the LIRA-345 core changes; the first run's
 * failures are recorded in the LIRA-345 hand-off report.
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
import { getRechargeRepository } from "../RechargeRepository";
import {
  getSupplierService,
  resetSupplierService,
} from "../../services/SupplierService";
import { FinancialService } from "../../services/FinancialService";
import { buildDaySelections } from "../../utils/settleDaySelections";
import { buildSettleDays } from "../../utils/settleDays";
import { supplierSettleAccountSchema } from "../../validators/supplier";
import {
  buildDb,
  drawerTotals,
  fundDrawer,
  memberBalance,
  omtAccount,
  profitTotals,
  resetAll,
  seedLedgerRow,
  seedOmtSend,
  settlementTxn,
} from "../testHelpers/omtAccountDb";

const UTC = { clientTzOffsetMinutes: 0 };

describe("LIRA-345 — settle by day for suppliers outside the OMT account", () => {
  let db: Database.Database;
  let repo: SupplierRepository;

  beforeEach(() => {
    resetAll();
    resetSupplierService();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    repo = new SupplierRepository();
    for (const d of [
      "General",
      "OMT_System",
      "Whish_System",
      "Katsh",
      "iPick",
      "OMT_App",
    ]) {
      fundDrawer(db, d, "USD", 10000);
      fundDrawer(db, d, "LBP", 100_000_000);
    }
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  const supplierByProvider = (provider: string): number =>
    (
      db
        .prepare(`SELECT id FROM suppliers WHERE tenant_id = 1 AND provider = ?`)
        .get(provider) as { id: number }
    ).id;

  const productSupplier = (name: string): number =>
    Number(
      db
        .prepare(
          `INSERT INTO suppliers (tenant_id, name, is_system, is_active) VALUES (1, ?, 0, 1)`,
        )
        .run(name).lastInsertRowid,
    );

  const queue = (supplierId: number): AccountUnsettledRow[] =>
    runWithTenant(1, () => repo.getAccountUnsettled(supplierId), UTC);

  const cash = (currency_code: "USD" | "LBP", amount: number) => ({
    method: "CASH",
    currency_code,
    amount,
  });

  function payload(
    supplierId: number,
    opts: {
      pickedDays: string[];
      usd?: number;
      lbp?: number;
      commissionUsd?: number;
      creditUsed?: { usd?: number; lbp?: number };
    },
  ): SettleAccountRequest {
    const built = buildDaySelections(queue(supplierId), {
      pickedDays: opts.pickedDays,
      creditUsed: opts.creditUsed ?? { usd: 0, lbp: 0 },
    });
    const perCurrency: Record<string, unknown> = {};
    if (opts.usd !== undefined) {
      perCurrency.USD = {
        direction: "PAY",
        payments: opts.usd > 0 ? [cash("USD", opts.usd)] : [],
        ...(opts.commissionUsd ? { commission: opts.commissionUsd } : {}),
      };
    }
    if (opts.lbp !== undefined) {
      perCurrency.LBP = {
        direction: "PAY",
        payments: opts.lbp > 0 ? [cash("LBP", opts.lbp)] : [],
      };
    }
    const parsed = supplierSettleAccountSchema.parse({
      account_supplier_id: supplierId,
      per_currency: perCurrency,
      selections: built.selections,
      include_account_credits: true,
      credit_used: built.credit_used,
      expected_owed: built.expected_owed,
    });
    return { ...parsed, created_by: 1 } as SettleAccountRequest;
  }

  /** Settle through the SERVICE (the gate both transports go through). */
  function settle(p: SettleAccountRequest): number {
    const res = runWithTenant(1, () => getSupplierService().settleAccount(p), UTC);
    if (!res.success) throw new Error(res.error);
    return res.id!;
  }

  function undo(anchor: number): void {
    getTransactionRepository().voidTransaction(settlementTxn(db, anchor).id, 1);
  }

  function snapshot(supplierId: number) {
    const q = queue(supplierId);
    return {
      drawers: drawerTotals(db),
      ledger: memberBalance(db, supplierId),
      profit: profitTotals(db),
      owed: {
        usd: Math.round(q.reduce((s, r) => s + r.remaining_usd, 0) * 100) / 100,
        lbp: q.reduce((s, r) => s + r.remaining_lbp, 0),
      },
    };
  }

  function expectNetZero(
    before: ReturnType<typeof snapshot>,
    after: ReturnType<typeof snapshot>,
  ): void {
    for (const k of ["drawers", "ledger", "profit", "owed"] as const) {
      expect(after[k].usd).toBeCloseTo(before[k].usd, 2);
      expect(after[k].lbp).toBe(before[k].lbp);
    }
  }

  /** FR-020 — the supplier's ledger balance equals Σ open remaining. */
  function expectBalanceMatchesQueue(supplierId: number): void {
    const q = queue(supplierId);
    const bal = memberBalance(db, supplierId);
    expect(q.reduce((s, r) => s + r.remaining_usd, 0)).toBeCloseTo(bal.usd, 2);
    expect(q.reduce((s, r) => s + r.remaining_lbp, 0)).toBe(bal.lbp);
  }

  // ── Katsh ────────────────────────────────────────────────────────────────

  describe("Katsh top-ups (S1)", () => {
    let katsh: number;
    let top3: number;
    let top10: number;
    let bill: number;

    beforeEach(() => {
      katsh = supplierByProvider("Katsh");
      top3 = seedLedgerRow(db, katsh, {
        entry_type: "TOP_UP",
        amount_usd: 500,
        created_at: "2026-10-03 09:00:00",
      });
      top10 = seedLedgerRow(db, katsh, {
        entry_type: "TOP_UP",
        amount_usd: 300,
        created_at: "2026-10-10 09:00:00",
      });
      // A Katsh bill: owes 0, its commission is settled on the tick list.
      bill = Number(
        db
          .prepare(
            `INSERT INTO financial_services
               (tenant_id, provider, service_type, amount, currency, commission,
                commission_model, is_settled, created_by, created_at)
             VALUES (1, 'Katsh', 'BILL', 50, 'USD', 0, 1, 0, 1, '2026-10-03 10:00:00')`,
          )
          .run().lastInsertRowid,
      );
    });

    it("the calendar queue holds the top-ups only — bills stay on the tick list", () => {
      const q = queue(katsh);
      expect(q.map((r) => `${r.kind}:${r.id}`).sort()).toEqual(
        [`LEDGER:${top3}`, `LEDGER:${top10}`].sort(),
      );
      expect(q.every((r) => r.row_scope === "DAY")).toBe(true);
    });

    it("pick 3 Oct, pay $500 → 3 Oct settled, 10 Oct still open; the bill untouched", () => {
      settle(payload(katsh, { pickedDays: ["2026-10-03"], usd: 500 }));

      const q = queue(katsh);
      expect(q.find((r) => r.id === top3 && r.kind === "LEDGER")).toBeUndefined();
      expect(q.find((r) => r.id === top10 && r.kind === "LEDGER")?.remaining_usd).toBe(300);

      const rows = runWithTenant(
        1,
        () =>
          repo.getAccountRows(katsh, {
            fromUtc: "2026-09-30 00:00:00",
            toUtc: "2026-11-02 00:00:00",
          }),
        UTC,
      );
      const days = buildSettleDays(rows, { today: "2026-10-26", month: "2026-10" });
      expect(days.find((d) => d.day === "2026-10-03")?.state).toBe("SETTLED");
      expect(days.find((d) => d.day === "2026-10-10")?.state).toBe("UNPAID");

      const b = db
        .prepare(`SELECT is_settled, settlement_id FROM financial_services WHERE id = ?`)
        .get(bill) as { is_settled: number; settlement_id: number | null };
      expect(b).toEqual({ is_settled: 0, settlement_id: null });
      expectBalanceMatchesQueue(katsh);
    });

    it("create + undo nets to 0 on every ledger, per currency", () => {
      const before = snapshot(katsh);
      const anchor = settle(payload(katsh, { pickedDays: ["2026-10-03"], usd: 500 }));
      undo(anchor);
      expectNetZero(before, snapshot(katsh));
    });
  });

  // ── Voiding a real Katsh top-up a settlement paid (R12) ─────────────────

  describe("void of a Katsh top-up the calendar paid (real writer)", () => {
    let katsh: number;

    function topUp(amount: number): { txnId: number; row: AccountUnsettledRow } {
      const res = runWithTenant(1, () =>
        getRechargeRepository().topUpFromSupplier({
          provider: "Katsh",
          amount,
          currency: "USD",
          userId: 1,
        }),
      );
      expect(res.success).toBe(true);
      const txnId = (
        db
          .prepare(
            `SELECT id FROM transactions WHERE tenant_id = 1 AND type = 'RECHARGE_TOPUP' ORDER BY id DESC LIMIT 1`,
          )
          .get() as { id: number }
      ).id;
      const row = queue(katsh).find(
        (r) => r.kind === "LEDGER" && r.transaction_id === txnId,
      )!;
      expect(row.remaining_usd).toBe(amount);
      return { txnId, row };
    }

    beforeEach(() => {
      katsh = supplierByProvider("Katsh");
    });

    it.each([
      ["part-paid ($200 of $500)", 200],
      ["fully paid", 500],
    ])("%s: the void puts what was paid back on the account", (_l, paid) => {
      const { txnId, row } = topUp(500);
      settle(payload(katsh, { pickedDays: [row.shop_day], usd: paid }));
      expectBalanceMatchesQueue(katsh);

      getTransactionRepository().voidTransaction(txnId, 1);
      // The top-up is gone; what the settlement paid on it is now a Katsh
      // credit on the account, and the ledger balance still equals the queue.
      expectBalanceMatchesQueue(katsh);
      const credit = queue(katsh).filter((r) => r.row_scope === "ACCOUNT");
      expect(credit.reduce((s, r) => s + r.remaining_usd, 0)).toBeCloseTo(-paid, 2);
    });
  });

  // ── Product supplier ─────────────────────────────────────────────────────

  describe("product supplier (S1, S2 strict per currency)", () => {
    let acme: number;
    let intakeUsd: number;
    let intakeLbp: number;

    beforeEach(() => {
      acme = productSupplier("Acme Phones");
      intakeUsd = seedLedgerRow(db, acme, {
        entry_type: "STOCK_INTAKE",
        amount_usd: 200,
        created_at: "2026-10-05 09:00:00",
      });
      intakeLbp = seedLedgerRow(db, acme, {
        entry_type: "STOCK_INTAKE",
        amount_lbp: 900000,
        created_at: "2026-10-05 10:00:00",
      });
    });

    it("stock intake $200 paid $100 → $100 left; the LBP intake stays open in LBP", () => {
      const before = snapshot(acme);
      settle(payload(acme, { pickedDays: ["2026-10-05"], usd: 100 }));

      const q = queue(acme);
      expect(q.find((r) => r.id === intakeUsd)?.remaining_usd).toBeCloseTo(100, 2);
      expect(q.find((r) => r.id === intakeLbp)?.remaining_lbp).toBe(900000);
      // Strict per currency: the USD payment never touched the LBP debt.
      expect(q.find((r) => r.id === intakeLbp)?.covered_lbp).toBe(0);
      const after = snapshot(acme);
      expect(after.drawers.usd - before.drawers.usd).toBeCloseTo(-100, 2);
      expect(after.drawers.lbp).toBe(before.drawers.lbp);
      expectBalanceMatchesQueue(acme);
    });

    it("create + undo nets to 0 per currency", () => {
      const before = snapshot(acme);
      const anchor = settle(payload(acme, { pickedDays: ["2026-10-05"], usd: 100 }));
      undo(anchor);
      expectNetZero(before, snapshot(acme));
    });

    it("a Pay-with-discount is account-level: its DISCOUNT row is an ACCOUNT credit (blocker b)", () => {
      runWithTenant(1, () =>
        repo.recordSupplierCashflow({
          supplier_id: acme,
          direction: "PAY",
          payments: [cash("USD", 50)],
          discount: { amount_usd: 10, amount_lbp: 0 },
          created_by: 1,
        }),
      );
      const accountRows = queue(acme).filter((r) => r.row_scope === "ACCOUNT");
      expect(accountRows.map((r) => r.entry_type).sort()).toEqual([
        "DISCOUNT",
        "PAYMENT",
      ]);
      expect(accountRows.reduce((s, r) => s + r.remaining_usd, 0)).toBeCloseTo(-60, 2);
      expectBalanceMatchesQueue(acme);
    });

    it("credit from a Pay + discount, used by a settlement, then the Pay voided → balance still equals the queue", () => {
      runWithTenant(1, () =>
        repo.recordSupplierCashflow({
          supplier_id: acme,
          direction: "PAY",
          payments: [cash("USD", 50)],
          discount: { amount_usd: 10, amount_lbp: 0 },
          created_by: 1,
        }),
      );
      // Use the whole $60 credit, pay $140 → the $200 intake closes.
      settle(
        payload(acme, {
          pickedDays: ["2026-10-05"],
          usd: 140,
          creditUsed: { usd: 60 },
        }),
      );
      expect(queue(acme).find((r) => r.id === intakeUsd)).toBeUndefined();
      expectBalanceMatchesQueue(acme);

      const payTxn = (
        db
          .prepare(
            `SELECT id FROM transactions WHERE tenant_id = 1 AND type = 'SUPPLIER_PAYMENT' ORDER BY id DESC LIMIT 1`,
          )
          .get() as { id: number }
      ).id;
      getTransactionRepository().voidTransaction(payTxn, 1);
      // The $60 the settlement used comes back as "you owe Acme" on the
      // account, and the ledger balance still equals the open queue.
      expectBalanceMatchesQueue(acme);
      const open = queue(acme).filter((r) => r.row_scope === "ACCOUNT");
      expect(open.reduce((s, r) => s + r.remaining_usd, 0)).toBeCloseTo(60, 2);
    });
  });

  // ── Whish (S1 when active, S4 commission on the account) ────────────────

  describe("Whish", () => {
    let whish: number;

    beforeEach(() => {
      whish = supplierByProvider("WHISH");
      db.prepare(`UPDATE suppliers SET is_active = 1 WHERE id = ?`).run(whish);
    });

    it("commission becomes a Whish credit, used at the next settlement", () => {
      const s1 = seedOmtSend(db, whish, {
        provider: "WHISH",
        amount: 100,
        created_at: "2026-10-07 09:00:00",
      });
      settle(payload(whish, { pickedDays: ["2026-10-07"], usd: 100, commissionUsd: 2 }));

      let q = queue(whish);
      expect(q.find((r) => r.kind === "FINANCIAL_SERVICE" && r.id === s1)).toBeUndefined();
      const credit = q.filter((r) => r.row_scope === "ACCOUNT");
      expect(credit.reduce((s, r) => s + r.remaining_usd, 0)).toBeCloseTo(-2, 2);
      expectBalanceMatchesQueue(whish);

      const s2 = seedOmtSend(db, whish, {
        provider: "WHISH",
        amount: 50,
        created_at: "2026-10-08 09:00:00",
      });
      settle(
        payload(whish, { pickedDays: ["2026-10-08"], usd: 48, creditUsed: { usd: 2 } }),
      );
      q = queue(whish);
      expect(q.find((r) => r.kind === "FINANCIAL_SERVICE" && r.id === s2)).toBeUndefined();
      expect(q.filter((r) => r.row_scope === "ACCOUNT")).toHaveLength(0);
      expectBalanceMatchesQueue(whish);
    });

    it("Transactions labels come from coverage, not the oldest-first pool estimate", () => {
      const s7 = seedOmtSend(db, whish, {
        provider: "WHISH",
        amount: 100,
        created_at: "2026-10-07 09:00:00",
      });
      const s8 = seedOmtSend(db, whish, {
        provider: "WHISH",
        amount: 100,
        created_at: "2026-10-08 09:00:00",
      });
      // Only 8 Oct is picked: the $40 pays the 8 Oct transfer, never 7 Oct.
      settle(payload(whish, { pickedDays: ["2026-10-08"], usd: 40 }));
      const rows = runWithTenant(
        1,
        () => new FinancialService().getAllByProvider("WHISH"),
        UTC,
      );
      const r7 = rows.find((x) => x.id === s7)!;
      const r8 = rows.find((x) => x.id === s8)!;
      expect(r7.fifo_status).toBe("unpaid");
      expect(r8.fifo_status).toBe("partial");
      expect(r8.fifo_paid_usd).toBeCloseTo(40, 2);
    });

    it("the tick list refuses a transfer the calendar already part-paid", () => {
      const s1 = seedOmtSend(db, whish, {
        provider: "WHISH",
        amount: 100,
        created_at: "2026-10-07 09:00:00",
      });
      settle(payload(whish, { pickedDays: ["2026-10-07"], usd: 40 }));
      expect(() =>
        runWithTenant(1, () =>
          repo.settleTransactions({
            supplier_id: whish,
            financial_service_ids: [s1],
            amount_usd: 100,
            amount_lbp: 0,
            commission_usd: 0,
            commission_lbp: 0,
            payments: [cash("USD", 100)],
            created_by: 1,
          }),
        ),
      ).toThrow(/partly paid/);
    });

    it("an inactive Whish is refused by the server gate", () => {
      seedOmtSend(db, whish, {
        provider: "WHISH",
        amount: 100,
        created_at: "2026-10-07 09:00:00",
      });
      const p = payload(whish, { pickedDays: ["2026-10-07"], usd: 100 });
      db.prepare(`UPDATE suppliers SET is_active = 0 WHERE id = ?`).run(whish);
      expect(() => settle(p)).toThrow(/settled from the day calendar/);
    });
  });

  // ── Loto (out of scope, S1) ──────────────────────────────────────────────

  // LIRA-351 (owner decisions 2026-10-29): Loto is on the calendar now
  // (rule 24 — this case used to assert the refusal).
  it("Loto is accepted by the server gate", () => {
    const loto = supplierByProvider("LOTO");
    seedLedgerRow(db, loto, {
      entry_type: "TOP_UP",
      amount_usd: 100,
      created_at: "2026-10-04 09:00:00",
    });
    expect(() =>
      settle(payload(loto, { pickedDays: ["2026-10-04"], usd: 100 })),
    ).not.toThrow();
  });

  // ── Coordinator follow-up (1): detach count uses the open-row rule ──────

  it("detaching an OMT member is not blocked by legacy settlement bookkeeping rows", () => {
    const acc = omtAccount(db);
    // A legacy tick-list SETTLEMENT row (never stamped) and a legacy
    // settlement commission credit (back-linked, is_auto): neither is an
    // open row on the queue.
    const settlementRow = seedLedgerRow(db, acc.appId, {
      entry_type: "SETTLEMENT",
      amount_usd: -30,
      created_at: "2026-10-02 09:00:00",
    });
    const credit = seedLedgerRow(db, acc.appId, {
      entry_type: "SUPPLIER_PAYS_US",
      amount_usd: -3,
      created_at: "2026-10-02 09:00:00",
    });
    db.prepare(
      `UPDATE supplier_ledger SET source_ref_table = 'supplier_ledger', source_ref_id = ?, is_auto = 1 WHERE id = ?`,
    ).run(settlementRow, credit);
    expect(queue(acc.appId)).toHaveLength(0);

    expect(() =>
      runWithTenant(1, () =>
        repo.updateAccountLink({ supplier_id: acc.appId, account_supplier_id: null }),
      ),
    ).not.toThrow();
  });
});
