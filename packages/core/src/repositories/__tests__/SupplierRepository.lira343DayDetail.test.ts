/**
 * LIRA-343 T030 — what is behind one shop day of the OMT account
 * (contracts/calendar-reads.md §3, research R7/R8).
 *
 * `getAccountDayDetail(accountId, shopDay)` returns the day's range rows
 * (the SAME builder as the month read), each with:
 *  - `settlements`: the row's ACTIVE coverage, one entry per settlement
 *    transaction, currency and source (amounts summed), oldest settlement
 *    first, dated by the settlement transaction's own `created_at`;
 *  - `added_after_settlement` (R7): an open FINANCIAL_SERVICE row whose
 *    unified transaction id is greater than the transaction id of an active
 *    coverage row on ANOTHER row of the same shop day.
 *
 * Rule 17: written before `getAccountDayDetail` existed and run against it.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext";
import {
  SupplierRepository,
  type AccountDayDetailRow,
  type AccountUnsettledRow,
  type SettleAccountRequest,
} from "../SupplierRepository";
import { getTransactionRepository } from "../TransactionRepository";
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

describe("LIRA-343 — account day detail", () => {
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

  /** An OMT send plus its unified transaction row, the way the real writer
   *  books both (the fixture's `seedOmtSend` writes no transaction). */
  function send(amount: number, created_at: string): { fs: number; txn: number } {
    const fs = seedOmtSend(db, acc.omtId, { amount, created_at });
    const txn = Number(
      db
        .prepare(
          `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id, created_at)
           VALUES (1, 'FINANCIAL_SERVICE', 'financial_services', ?, 1, ?)`,
        )
        .run(fs, created_at).lastInsertRowid,
    );
    return { fs, txn };
  }

  function open(): AccountUnsettledRow[] {
    return runWithTenant(1, () => repo.getAccountUnsettled(acc.omtId), UTC);
  }

  /** Amount-first USD settlement over the whole queue; returns the
   *  SUPPLIER_SETTLEMENT transaction id. */
  function settleUsd(amount: number): number {
    const q = open();
    const anchor = runWithTenant(
      1,
      () =>
        repo.settleAccount({
          account_supplier_id: acc.omtId,
          per_currency: {
            USD: {
              direction: "PAY",
              payments: [{ method: "CASH", currency_code: "USD", amount }],
            },
          } as SettleAccountRequest["per_currency"],
          expected_owed: {
            usd: q.reduce((s, r) => s + r.remaining_usd, 0),
            lbp: q.reduce((s, r) => s + r.remaining_lbp, 0),
          },
          created_by: 1,
        }).id,
      UTC,
    );
    return settlementTxn(db, anchor).id;
  }

  function txnCreatedAt(id: number): string {
    return (
      db.prepare(`SELECT created_at FROM transactions WHERE id = ?`).get(id) as {
        created_at: string;
      }
    ).created_at;
  }

  function detail(day: string, opts = UTC): AccountDayDetailRow[] {
    return runWithTenant(1, () => repo.getAccountDayDetail(acc.omtId, day), opts);
  }

  const pick = (rows: AccountDayDetailRow[], kind: string, id: number) => {
    const row = rows.find((r) => r.kind === kind && r.id === id);
    if (!row) throw new Error(`${kind}:${id} not returned`);
    return row;
  };

  // ── the day's rows ───────────────────────────────────────────────────────

  it("returns only that shop day's rows, settled or not", () => {
    const before = send(10, "2026-10-19 12:00:00");
    const a = send(100, "2026-10-20 08:00:00");
    const b = send(50, "2026-10-20 10:00:00");
    const after = send(30, "2026-10-21 09:00:00");
    settleUsd(100); // closes `before` and part-pays `a`

    const rows = detail("2026-10-20");
    const ids = rows.filter((r) => r.kind === "FINANCIAL_SERVICE").map((r) => r.id);
    expect(ids.sort()).toEqual([a.fs, b.fs].sort());
    expect(ids).not.toContain(before.fs);
    expect(ids).not.toContain(after.fs);
    for (const r of rows) expect(r.shop_day).toBe("2026-10-20");
  });

  it("a 00:30 Beirut row (21:30 UTC the day before) lands on its own shop day", () => {
    const late = send(25, "2026-10-19 21:30:00");

    expect(detail("2026-10-20", BEIRUT).map((r) => r.id)).toContain(late.fs);
    expect(detail("2026-10-19", BEIRUT).map((r) => r.id)).not.toContain(late.fs);
    // Without the client offset it is still the 19th.
    expect(detail("2026-10-19", UTC).map((r) => r.id)).toContain(late.fs);
  });

  it("the window wraps the year: 22:30 UTC on 31 Dec is 1 Jan in Beirut", () => {
    const nye = send(15, "2025-12-31 22:30:00");
    const jan2 = send(16, "2026-01-02 10:00:00");
    const ids = detail("2026-01-01", BEIRUT).map((r) => r.id);
    expect(ids).toContain(nye.fs);
    expect(ids).not.toContain(jan2.fs);
  });

  // ── coverage per settlement ──────────────────────────────────────────────

  it("groups each row's active coverage per settlement, oldest first, dated by the settlement", () => {
    const a = send(100, "2026-10-20 08:00:00");
    const b = send(50, "2026-10-20 10:00:00");
    const s1 = settleUsd(120); // a: 100, b: 20
    const s2 = settleUsd(10); // b: 10 more

    const rows = detail("2026-10-20");
    expect(pick(rows, "FINANCIAL_SERVICE", a.fs).settlements).toEqual([
      {
        transaction_id: s1,
        settled_at: txnCreatedAt(s1),
        currency: "USD",
        amount: 100,
        source: "PAYMENT",
      },
    ]);
    const rb = pick(rows, "FINANCIAL_SERVICE", b.fs);
    expect(rb.settlements).toEqual([
      {
        transaction_id: s1,
        settled_at: txnCreatedAt(s1),
        currency: "USD",
        amount: 20,
        source: "PAYMENT",
      },
      {
        transaction_id: s2,
        settled_at: txnCreatedAt(s2),
        currency: "USD",
        amount: 10,
        source: "PAYMENT",
      },
    ]);
    expect(rb.remaining_usd).toBeCloseTo(20, 6);
  });

  it("one settlement that nets and pays the same row gives one entry per source", () => {
    const cashOut = seedLedgerRow(db, acc.appId, {
      entry_type: "PAYMENT",
      amount_usd: -40,
      created_at: "2026-10-20 07:00:00",
    });
    db.prepare(
      `UPDATE supplier_ledger SET source_ref_table = 'recharges', source_ref_id = 1 WHERE id = ?`,
    ).run(cashOut);
    const a = send(100, "2026-10-20 08:00:00");
    const s1 = settleUsd(60);

    const rows = detail("2026-10-20");
    const fsSettlements = pick(rows, "FINANCIAL_SERVICE", a.fs).settlements;
    expect(fsSettlements).toHaveLength(2);
    expect(fsSettlements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ transaction_id: s1, source: "NETTING", amount: 40 }),
        expect.objectContaining({ transaction_id: s1, source: "PAYMENT", amount: 60 }),
      ]),
    );
    expect(pick(rows, "LEDGER", cashOut).settlements).toEqual([
      expect.objectContaining({ transaction_id: s1, source: "NETTING", amount: 40 }),
    ]);
  });

  it("reversed coverage is left out", () => {
    const a = send(100, "2026-10-20 08:00:00");
    const s1 = settleUsd(100);
    getTransactionRepository().voidTransaction(s1, 1);
    expect(pick(detail("2026-10-20"), "FINANCIAL_SERVICE", a.fs).settlements).toEqual([]);

    const s2 = settleUsd(100);
    expect(
      pick(detail("2026-10-20"), "FINANCIAL_SERVICE", a.fs).settlements.map(
        (s) => s.transaction_id,
      ),
    ).toEqual([s2]);
  });

  it("a row with no coverage reads an empty list", () => {
    const a = send(100, "2026-10-20 08:00:00");
    const row = pick(detail("2026-10-20"), "FINANCIAL_SERVICE", a.fs);
    expect(row.settlements).toEqual([]);
    expect(row.added_after_settlement).toBe(false);
  });

  // ── "added after settlement" (R7) ────────────────────────────────────────

  it("an open transfer recorded after the day was settled is tagged", () => {
    const a = send(100, "2026-10-20 08:00:00");
    const b = send(50, "2026-10-20 10:00:00");
    settleUsd(150); // closes the whole day
    const late = send(35, "2026-10-20 18:00:00"); // back-dated into the 20th
    expect(late.txn).toBeGreaterThan(0);

    const rows = detail("2026-10-20");
    expect(pick(rows, "FINANCIAL_SERVICE", late.fs).added_after_settlement).toBe(true);
    // The settled rows are closed: never tagged.
    expect(pick(rows, "FINANCIAL_SERVICE", a.fs).added_after_settlement).toBe(false);
    expect(pick(rows, "FINANCIAL_SERVICE", b.fs).added_after_settlement).toBe(false);
  });

  it("not tagged: a part-paid row whose only coverage is its own, an older open row, a day no settlement touched, a LEDGER row", () => {
    const a = send(100, "2026-10-20 08:00:00");
    const b = send(50, "2026-10-20 10:00:00");
    const other = send(30, "2026-10-21 09:00:00");
    settleUsd(120); // a closed, b part-paid; 21 Oct untouched
    const topUp = seedLedgerRow(db, acc.ipickId, {
      entry_type: "TOP_UP",
      amount_usd: 9,
      created_at: "2026-10-20 19:00:00",
    });
    // A newer unified transaction than the settlement, so only the
    // FINANCIAL_SERVICE-only rule keeps it untagged. (Added after the
    // implementation: not proven failing-first.)
    const topUpTxn = Number(
      db
        .prepare(
          `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id)
           VALUES (1, 'RECHARGE', 'supplier_ledger', ?, 1)`,
        )
        .run(topUp).lastInsertRowid,
    );
    db.prepare(`UPDATE supplier_ledger SET transaction_id = ? WHERE id = ?`).run(
      topUpTxn,
      topUp,
    );
    const lateOther = send(12, "2026-10-21 18:00:00");

    const day20 = detail("2026-10-20");
    // b was there before the settlement (its txn id is lower).
    expect(pick(day20, "FINANCIAL_SERVICE", b.fs).added_after_settlement).toBe(false);
    expect(pick(day20, "FINANCIAL_SERVICE", a.fs).added_after_settlement).toBe(false);
    // The tag is for transfers (FINANCIAL_SERVICE rows) only.
    const topUpRow = pick(day20, "LEDGER", topUp);
    expect(topUpRow.transaction_id).toBe(topUpTxn);
    expect(topUpRow.remaining_usd).toBeCloseTo(9, 6);
    expect(topUpRow.added_after_settlement).toBe(false);

    const day21 = detail("2026-10-21");
    // No settlement covered anything on the 21st.
    expect(pick(day21, "FINANCIAL_SERVICE", other.fs).added_after_settlement).toBe(false);
    expect(pick(day21, "FINANCIAL_SERVICE", lateOther.fs).added_after_settlement).toBe(
      false,
    );
  });

  it("a part-paid row recorded after another row of the day was settled is tagged", () => {
    send(100, "2026-10-20 08:00:00");
    const s1 = settleUsd(100);
    const late = send(50, "2026-10-20 18:00:00");
    settleUsd(20); // part-pays the late row (its own coverage is newer than it)

    const row = pick(detail("2026-10-20"), "FINANCIAL_SERVICE", late.fs);
    expect(row.remaining_usd).toBeCloseTo(30, 6);
    expect(row.settlements.map((s) => s.transaction_id)).not.toContain(s1);
    expect(row.added_after_settlement).toBe(true);
  });

  // Added after the implementation: not proven failing-first.
  it("not tagged: a late transfer once a later settlement has fully paid it", () => {
    send(100, "2026-10-20 08:00:00");
    settleUsd(100);
    const late = send(35, "2026-10-20 18:00:00");
    const s2 = settleUsd(35);

    const row = pick(detail("2026-10-20"), "FINANCIAL_SERVICE", late.fs);
    expect(row.remaining_usd).toBe(0);
    expect(row.transaction_id).toBe(late.txn);
    expect(row.settlements.map((s) => s.transaction_id)).toEqual([s2]);
    expect(row.added_after_settlement).toBe(false);
  });
});
