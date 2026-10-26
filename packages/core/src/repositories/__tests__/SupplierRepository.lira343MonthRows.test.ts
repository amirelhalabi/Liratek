/**
 * LIRA-343 T006 — one row source for the OMT account, two modes.
 *
 *  - open  (`getAccountUnsettled`): the settle queue, unchanged rows, plus
 *    `shop_day`, `source_ref_table`, `row_scope` and `transaction_id`.
 *  - range (`getAccountRows`): every account row in a UTC window, settled
 *    or not, so the calendar can colour each shop day.
 *
 * Rule 17: written before the refactor and run against it first.
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
import {
  buildDb,
  fundDrawer,
  omtAccount,
  resetAll,
  seedLedgerRow,
  seedOmtSend,
  settlementTxn,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";

/** Beirut summer time: UTC+3. */
const BEIRUT = { clientTzOffsetMinutes: 180 };
const UTC = { clientTzOffsetMinutes: 0 };

describe("LIRA-343 — account rows: open and range modes", () => {
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

  // ── helpers ──────────────────────────────────────────────────────────────

  function insertTxn(type: string, sourceTable: string, sourceId: number): number {
    return Number(
      db
        .prepare(
          `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id)
           VALUES (1, ?, ?, ?, 1)`,
        )
        .run(type, sourceTable, sourceId).lastInsertRowid,
    );
  }

  function setLedger(id: number, cols: Record<string, string | number | null>): void {
    for (const [col, value] of Object.entries(cols)) {
      // Column names are this test's own literals, never input.
      db.prepare(`UPDATE supplier_ledger SET ${col} = ? WHERE id = ?`).run(value, id);
    }
  }

  function open(opts = UTC): AccountUnsettledRow[] {
    return runWithTenant(1, () => repo.getAccountUnsettled(acc.omtId), opts);
  }

  const pick = (rows: AccountUnsettledRow[], kind: string, id: number) => {
    const row = rows.find((r) => r.kind === kind && r.id === id);
    if (!row) throw new Error(`${kind}:${id} not returned`);
    return row;
  };

  // ── 6. open mode carries the four new fields ─────────────────────────────

  it("open mode: FS row carries shop_day, source_ref_table null, DAY and its unified transaction id", () => {
    const fs = seedOmtSend(db, acc.omtId, { amount: 100, created_at: "2026-10-24 22:30:00" });
    const txn = insertTxn("FINANCIAL_SERVICE", "financial_services", fs);

    const row = pick(open(UTC), "FINANCIAL_SERVICE", fs);
    expect(row.shop_day).toBe("2026-10-24");
    expect(row.source_ref_table).toBeNull();
    expect(row.row_scope).toBe("DAY");
    expect(row.transaction_id).toBe(txn);
  });

  it("1. shop day: 22:30 UTC on 24 Oct is 25 Oct in Beirut (+180)", () => {
    const fs = seedOmtSend(db, acc.omtId, { amount: 100, created_at: "2026-10-24 22:30:00" });
    const cashOut = seedLedgerRow(db, acc.appId, {
      entry_type: "PAYMENT",
      amount_usd: -40,
      created_at: "2026-10-24 22:30:00",
    });
    setLedger(cashOut, { source_ref_table: "recharges", source_ref_id: 1 });

    const rows = open(BEIRUT);
    expect(pick(rows, "FINANCIAL_SERVICE", fs).shop_day).toBe("2026-10-25");
    expect(pick(rows, "LEDGER", cashOut).shop_day).toBe("2026-10-25");
  });

  it("row_scope: cash-out PAYMENT (recharges) DAY; manual PAYMENT ACCOUNT; iPick TOP_UP DAY", () => {
    const cashOut = seedLedgerRow(db, acc.appId, { entry_type: "PAYMENT", amount_usd: -40 });
    setLedger(cashOut, { source_ref_table: "recharges", source_ref_id: 7 });
    const rechargeTxn = insertTxn("RECHARGE", "recharges", 7);
    setLedger(cashOut, { transaction_id: rechargeTxn });
    const manualPay = seedLedgerRow(db, acc.omtId, { entry_type: "PAYMENT", amount_usd: -25 });
    const manualReceive = seedLedgerRow(db, acc.omtId, {
      entry_type: "SUPPLIER_PAYS_US",
      amount_usd: -15,
    });
    const topUp = seedLedgerRow(db, acc.ipickId, { entry_type: "TOP_UP", amount_usd: 50 });

    const rows = open(UTC);
    const c = pick(rows, "LEDGER", cashOut);
    expect([c.row_scope, c.source_ref_table, c.transaction_id]).toEqual([
      "DAY",
      "recharges",
      rechargeTxn,
    ]);
    expect(pick(rows, "LEDGER", manualPay).row_scope).toBe("ACCOUNT");
    expect(pick(rows, "LEDGER", manualReceive).row_scope).toBe("ACCOUNT");
    const t = pick(rows, "LEDGER", topUp);
    expect([t.row_scope, t.source_ref_table, t.transaction_id]).toEqual(["DAY", null, null]);
  });

  it("row_scope: a settlement overpay credit is ACCOUNT and links the settlement", () => {
    seedOmtSend(db, acc.omtId, { amount: 100, created_at: "2026-10-20 09:00:00" });
    const owed = open(UTC).reduce((s, r) => s + r.remaining_usd, 0);
    const anchor = repo.settleAccount({
      account_supplier_id: acc.omtId,
      per_currency: {
        USD: {
          direction: "PAY",
          payments: [{ method: "CASH", currency_code: "USD", amount: 110 }],
        },
      } as SettleAccountRequest["per_currency"],
      expected_owed: { usd: owed, lbp: 0 },
      created_by: 1,
    }).id;
    const settlement = settlementTxn(db, anchor).id;

    const credits = open(UTC).filter((r) => r.kind === "LEDGER");
    expect(credits).toHaveLength(1);
    expect(credits[0].amount_usd).toBeCloseTo(-10, 6);
    expect(credits[0].row_scope).toBe("ACCOUNT");
    expect(credits[0].transaction_id).toBe(settlement);
  });

  // ── range mode ───────────────────────────────────────────────────────────

  const ALL = { fromUtc: "2000-01-01 00:00:00", toUtc: "2100-01-01 00:00:00" };

  function range(win = ALL, opts = UTC): AccountUnsettledRow[] {
    return runWithTenant(1, () => repo.getAccountRows(acc.omtId, win), opts);
  }

  /** A pre-LIRA-322 whole-row account settlement: a self-stamped SETTLEMENT
   *  anchor (as the LIRA-189 whole-row path stamps its anchor) that the
   *  settled FS rows point at, and no coverage rows. */
  function legacySettle(fsIds: number[], total: number): number {
    const settlementRow = seedLedgerRow(db, acc.omtId, {
      entry_type: "SETTLEMENT",
      amount_usd: -total,
      created_at: "2026-10-03 12:00:00",
    });
    setLedger(settlementRow, { settlement_id: settlementRow });
    for (const id of fsIds) {
      db.prepare(
        `UPDATE financial_services SET is_settled = 1, settlement_id = ?, settled_at = '2026-10-03 12:00:00' WHERE id = ?`,
      ).run(settlementRow, id);
    }
    return settlementRow;
  }

  /** An OMT SEND born settled: legacy model, no commission → not pending. */
  function seedBornSettled(createdAt: string): number {
    return Number(
      db
        .prepare(
          `INSERT INTO financial_services
             (tenant_id, provider, service_type, amount, currency, commission, omt_fee,
              omt_service_type, commission_model, is_settled, created_by, created_at)
           VALUES (1, 'OMT', 'SEND', 70, 'USD', 0, 2, 'INTRA', 0, 1, 1, ?)`,
        )
        .run(createdAt).lastInsertRowid,
    );
  }

  /** A legacy cost-flow iPick sale: born is_settled = 1 but its supplier
   *  debt is still open until settlement_id is set. */
  function seedLegacyCostSale(createdAt: string, cost: number): number {
    return Number(
      db
        .prepare(
          `INSERT INTO financial_services
             (tenant_id, provider, service_type, amount, currency, commission, cost, price,
              commission_model, is_settled, supplier_debt_booked, created_by, created_at)
           VALUES (1, 'iPick', 'SEND', ?, 'USD', 0, ?, ?, 0, 1, 1, 1, ?)`,
        )
        .run(cost + 5, cost, cost + 5, createdAt).lastInsertRowid,
    );
  }

  function settleUsd(amount: number, waive?: number): number {
    const owed = open(UTC).reduce((s, r) => s + r.remaining_usd, 0);
    const lbp = open(UTC).reduce((s, r) => s + r.remaining_lbp, 0);
    return repo.settleAccount({
      account_supplier_id: acc.omtId,
      per_currency: {
        USD: {
          direction: "PAY",
          payments: [{ method: "CASH", currency_code: "USD", amount }],
          ...(waive ? { waive } : {}),
        },
      } as SettleAccountRequest["per_currency"],
      expected_owed: { usd: owed, lbp },
      created_by: 1,
    }).id;
  }

  it("1. range mode: shop_day uses the client offset too", () => {
    const fs = seedOmtSend(db, acc.omtId, { amount: 100, created_at: "2026-10-24 22:30:00" });
    expect(pick(range(ALL, BEIRUT), "FINANCIAL_SERVICE", fs).shop_day).toBe("2026-10-25");
    expect(pick(range(ALL, UTC), "FINANCIAL_SERVICE", fs).shop_day).toBe("2026-10-24");
  });

  it("range mode: keeps only created_at in [fromUtc, toUtc)", () => {
    const before = seedOmtSend(db, acc.omtId, { amount: 1, created_at: "2026-09-30 23:59:59" });
    const first = seedOmtSend(db, acc.omtId, { amount: 2, created_at: "2026-10-01 00:00:00" });
    const last = seedOmtSend(db, acc.omtId, { amount: 3, created_at: "2026-10-31 23:59:59" });
    const after = seedOmtSend(db, acc.omtId, { amount: 4, created_at: "2026-11-01 00:00:00" });
    const ids = range({ fromUtc: "2026-10-01 00:00:00", toUtc: "2026-11-01 00:00:00" })
      .filter((r) => r.kind === "FINANCIAL_SERVICE")
      .map((r) => r.id);
    expect(ids).toEqual([first, last]);
    expect(ids).not.toContain(before);
    expect(ids).not.toContain(after);
  });

  it("2. a legacy whole-row settled FS row comes back closed: remaining 0, covered = amount", () => {
    const fs = seedOmtSend(db, acc.omtId, { amount: 120, created_at: "2026-10-02 10:00:00" });
    legacySettle([fs], 120);
    expect(open(UTC).find((r) => r.id === fs && r.kind === "FINANCIAL_SERVICE")).toBeUndefined();
    expect(open(UTC).filter((r) => r.entry_type === "SETTLEMENT")).toEqual([]);

    const row = pick(range(), "FINANCIAL_SERVICE", fs);
    expect(row.amount_usd).toBe(120);
    expect(row.covered_usd).toBe(120);
    expect(row.remaining_usd).toBe(0);
    expect(row.row_scope).toBe("DAY");
  });

  it("2b. a legacy cost-flow sale (born is_settled = 1) stays open until settlement_id is set", () => {
    const sale = seedLegacyCostSale("2026-10-04 10:00:00", 30);
    expect(pick(open(UTC), "FINANCIAL_SERVICE", sale).remaining_usd).toBe(30);
    expect(pick(range(), "FINANCIAL_SERVICE", sale).remaining_usd).toBe(30);
  });

  it("3. a born-settled non-pending FS row is returned with owed 0 (the day has activity)", () => {
    const fs = seedBornSettled("2026-10-05 10:00:00");
    expect(open(UTC).find((r) => r.id === fs && r.kind === "FINANCIAL_SERVICE")).toBeUndefined();
    const row = pick(range(), "FINANCIAL_SERVICE", fs);
    expect([row.amount_usd, row.amount_lbp, row.remaining_usd, row.remaining_lbp]).toEqual([
      0, 0, 0, 0,
    ]);
    expect(row.shop_day).toBe("2026-10-05");
    expect(row.row_scope).toBe("DAY");
  });

  it("4. exclusions: SETTLEMENT rows, FS siblings, settlement commission credits, refunded rows", () => {
    const fs = seedOmtSend(db, acc.omtId, { amount: 120, created_at: "2026-10-02 10:00:00" });
    const settlementRow = legacySettle([fs], 120);
    const sibling = (
      db
        .prepare(
          `SELECT id FROM supplier_ledger WHERE source_ref_table = 'financial_services' AND source_ref_id = ?`,
        )
        .get(fs) as { id: number }
    ).id;
    const commissionCredit = seedLedgerRow(db, acc.omtId, {
      entry_type: "SUPPLIER_PAYS_US",
      amount_usd: -3,
      created_at: "2026-10-03 12:00:00",
    });
    setLedger(commissionCredit, {
      source_ref_table: "supplier_ledger",
      source_ref_id: settlementRow,
      is_auto: 1,
    });
    const refundedDebt = seedLedgerRow(db, acc.ipickId, { entry_type: "TOP_UP", amount_usd: 9 });
    setLedger(refundedDebt, { is_refunded: 1 });
    const refundedFs = seedOmtSend(db, acc.omtId, { amount: 11, created_at: "2026-10-06 10:00:00" });
    db.prepare(`UPDATE financial_services SET is_refunded = 1 WHERE id = ?`).run(refundedFs);

    const rows = range();
    const ledgerIds = rows.filter((r) => r.kind === "LEDGER").map((r) => r.id);
    expect(ledgerIds).not.toContain(settlementRow);
    expect(ledgerIds).not.toContain(sibling);
    expect(ledgerIds).not.toContain(commissionCredit);
    expect(ledgerIds).not.toContain(refundedDebt);
    const fsIds = rows.filter((r) => r.kind === "FINANCIAL_SERVICE").map((r) => r.id);
    expect(fsIds).toEqual([fs]);
  });

  it("4b. an amount-first settlement's own rows never sit on a day", () => {
    seedOmtSend(db, acc.omtId, { amount: 100, created_at: "2026-10-20 09:00:00" });
    seedOmtSend(db, acc.omtId, { amount: 50, created_at: "2026-10-21 09:00:00" });
    const anchor = settleUsd(160); // closes both, $10 overpay credit
    const settlement = settlementTxn(db, anchor).id;

    const rows = range();
    expect(rows.find((r) => r.kind === "LEDGER" && r.id === anchor)).toBeUndefined();
    const onDay = rows.filter((r) => r.row_scope === "DAY" && r.transaction_id === settlement);
    expect(onDay).toEqual([]);
    // The overpay credit is there, as an ACCOUNT row.
    const credit = rows.filter((r) => r.kind === "LEDGER" && r.transaction_id === settlement);
    expect(credit).toHaveLength(1);
    expect(credit[0].row_scope).toBe("ACCOUNT");
    // Both FS rows closed: remaining 0, covered = amount.
    for (const r of rows.filter((x) => x.kind === "FINANCIAL_SERVICE")) {
      expect(r.remaining_usd).toBe(0);
      expect(r.covered_usd).toBeCloseTo(r.amount_usd, 6);
    }
  });

  it("4c. a waive's DISCOUNT row rides on the settlement, never on a day", () => {
    seedOmtSend(db, acc.omtId, { amount: 100, created_at: "2026-10-20 09:00:00" });
    seedOmtSend(db, acc.omtId, { amount: 50, created_at: "2026-10-21 09:00:00" });
    settleUsd(148, 2);
    const discounts = db
      .prepare(`SELECT id FROM supplier_ledger WHERE entry_type = 'DISCOUNT'`)
      .all() as Array<{ id: number }>;
    expect(discounts.length).toBeGreaterThan(0);
    const ledgerIds = range()
      .filter((r) => r.kind === "LEDGER")
      .map((r) => r.id);
    for (const d of discounts) expect(ledgerIds).not.toContain(d.id);
  });

  it("5. invariant: per shop_day and currency, range Σ(signed amount − covered) over DAY rows = open Σ remaining over DAY rows", () => {
    // 20 Oct: two OMT sends (one will be part-paid), 21 Oct: a send and a cash-out credit,
    // 22 Oct: an LBP send, a legacy closed send, a born-settled row, an iPick debt.
    seedOmtSend(db, acc.omtId, { amount: 100, created_at: "2026-10-20 08:00:00" });
    seedOmtSend(db, acc.omtId, { amount: 60, created_at: "2026-10-20 21:30:00" }); // 21 Oct in Beirut
    seedOmtSend(db, acc.omtId, { amount: 45, created_at: "2026-10-21 10:00:00" });
    const cashOut = seedLedgerRow(db, acc.appId, {
      entry_type: "PAYMENT",
      amount_usd: -40,
      created_at: "2026-10-21 11:00:00",
    });
    setLedger(cashOut, { source_ref_table: "recharges", source_ref_id: 3 });
    seedOmtSend(db, acc.omtId, { amount: 900000, currency: "LBP", created_at: "2026-10-22 09:00:00" });
    const closed = seedOmtSend(db, acc.omtId, { amount: 33, created_at: "2026-10-22 10:00:00" });
    legacySettle([closed], 33);
    seedBornSettled("2026-10-22 11:00:00");
    seedLedgerRow(db, acc.ipickId, {
      entry_type: "TOP_UP",
      amount_usd: 25,
      created_at: "2026-10-22 12:00:00",
    });
    seedLegacyCostSale("2026-10-22 13:00:00", 30);
    // The legacy settlement is not an open credit (no phantom netting below).
    expect(open(UTC).filter((r) => r.entry_type === "SETTLEMENT")).toEqual([]);
    // Part-pay: closes the oldest, leaves one row part-paid.
    settleUsd(110);

    for (const opts of [UTC, BEIRUT]) {
      const sums = (rows: AccountUnsettledRow[], f: (r: AccountUnsettledRow, c: "usd" | "lbp") => number) => {
        const out = new Map<string, number>();
        for (const r of rows.filter((x) => x.row_scope === "DAY")) {
          for (const c of ["usd", "lbp"] as const) {
            const k = `${r.shop_day}|${c}`;
            out.set(k, (out.get(k) ?? 0) + f(r, c));
          }
        }
        return out;
      };
      const signedLeft = (r: AccountUnsettledRow, c: "usd" | "lbp"): number => {
        const amount = c === "usd" ? r.amount_usd : r.amount_lbp;
        const covered = c === "usd" ? r.covered_usd : r.covered_lbp;
        return amount === 0 ? 0 : Math.sign(amount) * (Math.abs(amount) - covered);
      };
      const fromRange = sums(range(ALL, opts), signedLeft);
      const fromOpen = sums(open(opts), (r, c) => (c === "usd" ? r.remaining_usd : r.remaining_lbp));
      // Some covered work happened: the range side has more days than the open side.
      expect(fromRange.size).toBeGreaterThanOrEqual(fromOpen.size);
      for (const [k, v] of fromRange) {
        expect([k, v]).toEqual([k, expect.closeTo(fromOpen.get(k) ?? 0, 6)]);
      }
      for (const [k, v] of fromOpen) {
        expect([k, fromRange.get(k) ?? 0]).toEqual([k, expect.closeTo(v, 6)]);
      }
    }
    // The part-paid row exists, so the test really mixes covered and open.
    expect(open(UTC).some((r) => r.covered_usd > 0 && r.remaining_usd > 0)).toBe(true);
  });
});
