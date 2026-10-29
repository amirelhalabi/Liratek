/**
 * "Set custom time" on the Settle Account sheet (supplier settle-by-day).
 *
 * The shop paid OMT on Monday 26 but records it on Wednesday 28: every row
 * the settlement writes must land on Monday — the SUPPLIER_SETTLEMENT
 * transaction, the supplier_ledger rows (money, netting, commission credit,
 * overpayment, waive), the coverage rows, the commission records and the
 * drawer payment legs — so per-day balances, the statement check, the settle
 * calendar and the drawer checkpoints stay true.
 *
 * The payload is built the way the sheet builds it (`buildDaySelections` →
 * the core schema's `parse`), so `transaction_time` must survive Zod's key
 * stripping (rule 23). Every settle call runs inside a UTC request context so
 * the shop-day rule is deterministic on any runner.
 *
 * Rule 17: written before the fix; the first run's failures are in the
 * hand-off report.
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
import {
  getClosingRepository,
  resetClosingRepository,
} from "../ClosingRepository";
import {
  getCheckpointDifferenceRepository,
  resetCheckpointDifferenceRepository,
} from "../CheckpointDifferenceRepository";
import { SupplierService } from "../../services/SupplierService";
import { buildDaySelections } from "../../utils/settleDaySelections";
import { supplierSettleAccountSchema } from "../../validators/supplier";
import { CHECKPOINT_RESOLUTION_METHOD } from "../../constants/checkpointAdjustment";
import {
  buildDb,
  fundDrawer,
  omtAccount,
  resetAll,
  seedLedgerRow,
  seedOmtSend,
  settlementTxn,
  writeCounts,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";

const UTC = { clientTzOffsetMinutes: 0 };
/** Monday 26, 14:00 (UTC = the shop's day in this UTC context). */
const MON_1400 = "2026-10-26T14:00:00.000Z";
const MON_1400_SQL = "2026-10-26 14:00:00";
const PICKED = ["2026-10-24", "2026-10-25"];

describe("Settle Account — Set custom time (core)", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  let acc: OmtAccount;
  let ids: { r24: number; r25: number; cash25: number };

  beforeEach(() => {
    resetAll();
    resetClosingRepository();
    resetCheckpointDifferenceRepository();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    repo = new SupplierRepository();
    acc = omtAccount(db);
    for (const d of ["OMT_System", "General"]) {
      fundDrawer(db, d, "USD", 10000);
      fundDrawer(db, d, "LBP", 100_000_000);
    }
    const r24 = seedOmtSend(db, acc.omtId, {
      amount: 100,
      created_at: "2026-10-24 09:00:00",
    });
    const r25 = seedOmtSend(db, acc.omtId, {
      amount: 50,
      created_at: "2026-10-25 09:00:00",
    });
    // OMT App cash-out on the 25th: a DAY credit on another member, so the
    // settlement also writes cross-member netting rows.
    const cash25 = seedLedgerRow(db, acc.appId, {
      entry_type: "PAYMENT",
      amount_usd: -40,
      created_at: "2026-10-25 11:00:00",
    });
    db.prepare(
      `UPDATE supplier_ledger SET source_ref_table = 'recharges', source_ref_id = 1 WHERE id = ?`,
    ).run(cash25);
    ids = { r24, r25, cash25 };
  });

  afterEach(() => {
    resetTenantContext();
    resetClosingRepository();
    resetCheckpointDifferenceRepository();
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    db.close();
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  const inUtc = <T>(fn: () => T): T => runWithTenant(1, fn, UTC);

  function queue(): AccountUnsettledRow[] {
    return inUtc(() => repo.getAccountUnsettled(acc.omtId));
  }

  /** The sheet's payload, through the schema (rule 23/24). */
  function payload(opts: {
    usd: number;
    pickedDays?: readonly string[];
    commission?: number;
    waive?: number;
    time?: string;
  }): SettleAccountRequest {
    const built = buildDaySelections(queue(), {
      pickedDays: opts.pickedDays ?? PICKED,
      creditUsed: { usd: 0, lbp: 0 },
    });
    const parsed = supplierSettleAccountSchema.parse({
      account_supplier_id: acc.omtId,
      per_currency: {
        USD: {
          direction: "PAY",
          payments: [{ method: "CASH", currency_code: "USD", amount: opts.usd }],
          ...(opts.commission ? { commission: opts.commission } : {}),
          ...(opts.waive ? { waive: opts.waive } : {}),
        },
      },
      selections: built.selections,
      include_account_credits: true,
      credit_used: built.credit_used,
      expected_owed: built.expected_owed,
      ...(opts.time ? { transaction_time: opts.time } : {}),
    });
    return { ...parsed, created_by: 1 } as SettleAccountRequest;
  }

  function settle(p: SettleAccountRequest): number {
    return inUtc(() => repo.settleAccount(p).id);
  }

  /** Highest id per table before a settle call: everything above it was
   *  written by that call. */
  const TABLES = [
    "transactions",
    "supplier_ledger",
    "supplier_settlement_coverage",
    "payments",
    "supplier_settlements",
    "settlement_commission_allocations",
  ] as const;
  type Marks = Record<(typeof TABLES)[number], number>;
  function marks(): Marks {
    const out = {} as Marks;
    for (const t of TABLES) {
      out[t] = (
        db.prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM ${t}`).get() as {
          m: number;
        }
      ).m;
    }
    return out;
  }

  /** Every row written since `before`, as `table: [normalised created_at]`. */
  function writtenTimes(before: Marks): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const t of TABLES) {
      out[t] = (
        db
          .prepare(
            `SELECT datetime(created_at) AS at FROM ${t} WHERE id > ? ORDER BY id`,
          )
          .all(before[t]) as { at: string }[]
      ).map((r) => r.at);
    }
    return out;
  }

  // ── back-timed settlement ────────────────────────────────────────────────

  it("every row the settlement writes carries the custom time (money, netting, commission, overpayment, coverage, legs)", () => {
    // Owed 100 + 50 − 40 = 110; pay 120 → $10 extra on the account;
    // commission $2 on the closed model-1 transfers.
    const before = marks();
    const anchor = settle(payload({ usd: 120, commission: 2, time: MON_1400 }));
    const times = writtenTimes(before);

    // Something of every kind was written…
    expect(times.transactions).toHaveLength(1);
    // anchor + netting pair + commission credit + overpayment
    expect(times.supplier_ledger.length).toBeGreaterThanOrEqual(5);
    expect(times.supplier_settlement_coverage.length).toBeGreaterThanOrEqual(3);
    expect(times.payments).toHaveLength(1);
    expect(times.supplier_settlements).toHaveLength(1);
    expect(times.settlement_commission_allocations.length).toBeGreaterThanOrEqual(1);
    // …and all of it on Monday 14:00.
    for (const [table, list] of Object.entries(times)) {
      for (const at of list) expect({ table, at }).toEqual({ table, at: MON_1400_SQL });
    }
    // Stored as the canonical SQLite text every settlement row has always
    // used, on the transaction as on the ledger.
    const raw = (sql: string) =>
      (db.prepare(sql).get(anchor) as { created_at: string }).created_at;
    expect(
      raw(`SELECT created_at FROM supplier_ledger WHERE id = ? AND tenant_id = 1`),
    ).toBe(MON_1400_SQL);
    expect(
      raw(
        `SELECT created_at FROM transactions WHERE source_table = 'supplier_ledger' AND source_id = ? AND type = 'SUPPLIER_SETTLEMENT'`,
      ),
    ).toBe(MON_1400_SQL);
  });

  it("a waived settlement's DISCOUNT row and its transaction carry the custom time", () => {
    // Owed 110: pay 108, waive 2.
    const before = marks();
    settle(payload({ usd: 108, waive: 2, time: MON_1400 }));
    const discount = db
      .prepare(
        `SELECT datetime(created_at) AS at FROM supplier_ledger
          WHERE entry_type = 'DISCOUNT' AND tenant_id = 1`,
      )
      .all() as { at: string }[];
    expect(discount).toHaveLength(1);
    expect(discount[0].at).toBe(MON_1400_SQL);
    const times = writtenTimes(before);
    // the settlement + the waive's own COUNTERPARTY_DISCOUNT transaction
    expect(times.transactions).toHaveLength(2);
    for (const list of Object.values(times)) {
      for (const at of list) expect(at).toBe(MON_1400_SQL);
    }
  });

  // ── refusals ────────────────────────────────────────────────────────────

  it("a time in the future is refused by the service, nothing written", () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const before = writeCounts(db);
    const res = inUtc(() =>
      new SupplierService().settleAccount(payload({ usd: 110, time: future })),
    );
    expect(res).toEqual({
      success: false,
      error: "transaction_time cannot be in the future",
    });
    expect(writeCounts(db)).toEqual(before);
  });

  it("a time before the latest picked day it covers is refused, nothing written", () => {
    const before = writeCounts(db);
    // Saturday 24 at 20:00 cannot pay for Sunday 25.
    // LIRA-353: the cashier reads the day as "Sun 25 Oct", not as raw
    // "2026-10-25", and sees no internal field names.
    let message = "";
    try {
      settle(payload({ usd: 110, time: "2026-10-24T20:00:00.000Z" }));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe(
      "This payment covers Sun 25 Oct, so it can't be dated before that day. Pick a later time or leave out the later days.",
    );
    expect(writeCounts(db)).toEqual(before);
  });

  it("a time on the latest picked day itself is accepted", () => {
    const before = marks();
    settle(payload({ usd: 110, time: "2026-10-25T18:00:00.000Z" }));
    for (const list of Object.values(writtenTimes(before))) {
      for (const at of list) expect(at).toBe("2026-10-25 18:00:00");
    }
  });

  it("the legacy whole-row payload refuses transaction_time (never accepted and ignored)", () => {
    const res = supplierSettleAccountSchema.safeParse({
      account_supplier_id: acc.omtId,
      direction: "PAY",
      selections: [{ kind: "FINANCIAL_SERVICE", id: ids.r24 }],
      amount_usd: 100,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
      transaction_time: MON_1400,
    });
    expect(res.success).toBe(false);
  });

  // ── guard: no custom time = unchanged ───────────────────────────────────

  it("without a custom time the rows carry the save time, as before", () => {
    const before = marks();
    settle(payload({ usd: 120, commission: 2 }));
    const now = Date.now();
    for (const [table, list] of Object.entries(writtenTimes(before))) {
      for (const at of list) {
        const ms = new Date(`${at.replace(" ", "T")}Z`).getTime();
        expect({ table, near: Math.abs(ms - now) < 5 * 60 * 1000 }).toEqual({
          table,
          near: true,
        });
      }
    }
  });

  // ── checkpoint resolution (LIRA-335) ────────────────────────────────────

  describe("a back-timed payment before a drawer count", () => {
    const TUE_1800 = "2026-10-27T18:00:00.000Z";

    function balance(): number {
      return (
        db
          .prepare(
            `SELECT balance FROM drawer_balances WHERE tenant_id = 1 AND drawer_name = 'OMT_System' AND currency_code = 'USD'`,
          )
          .get() as { balance: number }
      ).balance;
    }

    function checkpointShort(short: number): number {
      const res = runWithTenant(
        1,
        () =>
          getClosingRepository().createCheckpoint({
            user_id: 1,
            drawer_name: "OMT_System",
            closing_date: TUE_1800.slice(0, 10),
            amounts: [
              {
                drawer_name: "OMT_System",
                currency_code: "USD",
                expected_amount: 0,
                physical_amount: balance() - short,
              },
            ],
          }),
        { effectiveNow: TUE_1800 },
      );
      expect(res.success).toBe(true);
      return Number(res.id);
    }

    function difference(closingId: number) {
      const list =
        getCheckpointDifferenceRepository()
          .listForClosings([closingId])
          .get(closingId) ?? [];
      return list.find(
        (d) => d.drawer_name === "OMT_System" && d.currency_code === "USD",
      );
    }

    it("resolves Tuesday's Short instead of moving the drawer twice; undo restores it", () => {
      // Tuesday's count found $110 missing: the cash went to OMT on Monday
      // and was never recorded.
      const closing = checkpointShort(110);
      const counted = balance();
      expect(difference(closing)).toMatchObject({ open: 110 });

      const anchor = settle(payload({ usd: 110, time: MON_1400 }));
      const txnId = settlementTxn(db, anchor).id;

      expect(balance()).toBe(counted);
      const offset = db
        .prepare(
          `SELECT drawer_name, currency_code, amount FROM payments WHERE transaction_id = ? AND method = ?`,
        )
        .all(txnId, CHECKPOINT_RESOLUTION_METHOD);
      expect(offset).toEqual([
        { drawer_name: "OMT_System", currency_code: "USD", amount: 110 },
      ]);
      expect(difference(closing)).toMatchObject({ open: 0 });

      // Rule 20: the undo mirrors the offset leg, the difference reopens.
      getTransactionRepository().voidTransaction(txnId, 1);
      expect(balance()).toBe(counted);
      expect(difference(closing)).toMatchObject({ open: 110 });
    });

    it("a settlement saved without a custom time leaves the Short open", () => {
      const closing = checkpointShort(110);
      const counted = balance();
      settle(payload({ usd: 110 }));
      expect(balance()).toBe(counted - 110);
      expect(difference(closing)).toMatchObject({ open: 110 });
    });
  });
});
