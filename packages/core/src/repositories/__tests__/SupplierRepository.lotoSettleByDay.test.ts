/**
 * LIRA-351 — Loto on Settle Account (day calendar). Owner decisions
 * 2026-10-29: Loto settles only on the calendar; prizes net within their
 * shop day; no commission at settlement (earned at the sale); the waive
 * (≤ 450,000 LBP) stays.
 *
 * Drives the REAL ticket / prize writers and the REAL settle on the real
 * schema (create_db.sql + every migration). Example from the spec: Monday
 * 3 × 120,000 LBP tickets at 4.45% (114,660 owed each = 343,980) and a
 * 500,000 LBP prize → Loto owes the shop 156,020.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { MIGRATIONS, runMigrations } from "../../db/migrations/index";
import { LotoCheckpointRepository } from "../LotoCheckpointRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext";
import {
  SupplierRepository,
  resetSupplierRepository,
  type SettleAccountRequest,
} from "../SupplierRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { LotoTicketRepository } from "../LotoTicketRepository";
import { LotoCashPrizeRepository } from "../LotoCashPrizeRepository";
import { buildDaySelections } from "../../utils/settleDaySelections";
import { supplierSettleAccountSchema } from "../../validators/supplier";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf-8",
);
const UTC = { clientTzOffsetMinutes: 0 };
const SALE = 120_000;
const COMMISSION = 5_340;
const OWED = SALE - COMMISSION; // 114,660

let db: Database.Database;
let repo: SupplierRepository;
let lotoId: number;

const inUtc = <T>(fn: () => T): T => runWithTenant(1, fn, UTC);

function generalLbp(): number {
  const r = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = 'LBP' AND tenant_id = 1`,
    )
    .get() as { balance: number } | undefined;
  return r?.balance ?? 0;
}

function balance(): number {
  return (
    db
      .prepare(
        // Voided (refunded) lines do not count, as in the app's balance.
        `SELECT COALESCE(SUM(amount_lbp), 0) AS b FROM supplier_ledger WHERE supplier_id = ? AND COALESCE(is_refunded, 0) = 0`,
      )
      .get(lotoId) as { b: number }
  ).b;
}

/** Tickets and prizes are stamped at 12:00 UTC on `day` so the shop day
 *  never shifts, whatever zone the machine is in. */
function sell(day: string, n = 1): void {
  for (let i = 0; i < n; i++) {
    runWithTenant(
      1,
      () =>
        new LotoTicketRepository(db).createTicket({
          sale_amount: SALE,
          commission_amount: COMMISSION,
          sale_date: day,
          payment_method: "CASH",
          currency: "LBP",
          userId: 1,
        }),
      { ...UTC, effectiveNow: `${day}T12:00:00.000Z` },
    );
  }
}

function prize(day: string, amount: number): void {
  runWithTenant(
    1,
    () =>
      new LotoCashPrizeRepository(db).createCashPrize({
        prize_amount: amount,
        prize_date: day,
        userId: 1,
      }),
    { ...UTC, effectiveNow: `${day}T13:00:00.000Z` },
  );
}

function dayTotals(): Record<string, number> {
  const rows = inUtc(() => repo.getAccountUnsettled(lotoId));
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.row_scope !== "DAY") continue;
    out[r.shop_day] = (out[r.shop_day] ?? 0) + r.remaining_lbp;
  }
  return out;
}

function settle(opts: {
  days: string[];
  lbp: number;
  direction: "PAY" | "COLLECT";
  waive?: number;
  commission?: number;
}): { id: number } {
  return inUtc(() => {
    const built = buildDaySelections(repo.getAccountUnsettled(lotoId), {
      pickedDays: opts.days,
      creditUsed: { usd: 0, lbp: 0 },
    });
    const parsed = supplierSettleAccountSchema.parse({
      account_supplier_id: lotoId,
      per_currency: {
        LBP: {
          direction: opts.direction,
          payments:
            opts.lbp > 0
              ? [{ method: "CASH", currency_code: "LBP", amount: opts.lbp }]
              : [],
          ...(opts.waive ? { waive: opts.waive } : {}),
          ...(opts.commission ? { commission: opts.commission } : {}),
        },
      },
      selections: built.selections,
      include_account_credits: true,
      credit_used: built.credit_used,
      expected_owed: built.expected_owed,
    });
    return repo.settleAccount({
      ...parsed,
      created_by: 1,
    } as SettleAccountRequest);
  });
}

beforeEach(() => {
  resetTransactionRepository();
  resetSupplierRepository();
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  initDatabase(db);
  runMigrations(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'LBP', 900000000)`,
  ).run();
  repo = new SupplierRepository();
  sell("2026-10-26", 3); // Monday: 343,980 owed
  lotoId = (
    db.prepare(`SELECT id FROM suppliers WHERE provider = 'LOTO'`).get() as {
      id: number;
    }
  ).id;
});

afterEach(() => {
  resetTenantContext();
  resetTransactionRepository();
  resetSupplierRepository();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("Loto on Settle Account (LIRA-351)", () => {
  it("lists each shop day at sale − commission", () => {
    sell("2026-10-27", 1);
    expect(dayTotals()).toEqual({
      "2026-10-26": 3 * OWED,
      "2026-10-27": OWED,
    });
  });

  it("settles the older day only: it closes, the newer stays, cash leaves General", () => {
    sell("2026-10-27", 1);
    const drawerBefore = generalLbp();
    const balanceBefore = balance();
    settle({ days: ["2026-10-26"], lbp: 3 * OWED, direction: "PAY" });
    expect(dayTotals()).toEqual({ "2026-10-27": OWED });
    expect(generalLbp()).toBe(drawerBefore - 3 * OWED);
    expect(balance()).toBe(balanceBefore - 3 * OWED);
  });

  it("nets a prize within its day: Loto owes the shop 156,020, and collecting it closes the day", () => {
    prize("2026-10-26", 500_000);
    expect(dayTotals()).toEqual({ "2026-10-26": 3 * OWED - 500_000 });
    const drawerBefore = generalLbp();
    settle({ days: ["2026-10-26"], lbp: 156_020, direction: "COLLECT" });
    expect(dayTotals()).toEqual({});
    expect(generalLbp()).toBe(drawerBefore + 156_020);
  });

  it("an overpay becomes Loto credit, the balance drops by what was paid", () => {
    const balanceBefore = balance();
    settle({ days: ["2026-10-26"], lbp: 350_000, direction: "PAY" });
    expect(dayTotals()).toEqual({});
    expect(balance()).toBe(balanceBefore - 350_000);
  });

  it("waives a small leftover (pay 340,000 + waive 3,980) and refuses a waive above 450,000", () => {
    settle({
      days: ["2026-10-26"],
      lbp: 340_000,
      waive: 3_980,
      direction: "PAY",
    });
    expect(dayTotals()).toEqual({});
    sell("2026-10-28", 10);
    expect(() =>
      settle({
        days: ["2026-10-28"],
        lbp: 10 * OWED - 500_000,
        waive: 500_000,
        direction: "PAY",
      }),
    ).toThrow();
  });

  it("takes no commission at settlement (earned at the sale)", () => {
    expect(() =>
      settle({
        days: ["2026-10-26"],
        lbp: 3 * OWED,
        commission: 1_000,
        direction: "PAY",
      }),
    ).toThrow(/commission/i);
  });

  // US3 — history: what an old checkpoint settled stays settled on the
  // calendar (migration v226), and the open queue agrees with the balance.
  it("after the backfill a settled checkpoint's sales are not open, and the open sum equals the balance", () => {
    // Monday's 3 tickets (343,980) were settled through a checkpoint the
    // old way; Tuesday has 1 ticket never settled; an old Pay-tab payment
    // of 50,000 sits untied.
    const checkpoints = new LotoCheckpointRepository(db);
    const tickets = new LotoTicketRepository(db);
    runWithTenant(
      1,
      () => {
        const cp = checkpoints.createCheckpoint({
          checkpoint_date: "2026-10-26",
          period_start: "2026-10-26",
          period_end: "2026-10-26",
          total_sales: 3 * SALE,
          total_commission: 3 * COMMISSION,
          total_tickets: 3,
        });
        for (const t of db
          .prepare(`SELECT id FROM loto_tickets WHERE checkpoint_id IS NULL`)
          .all() as { id: number }[])
          tickets.assignToCheckpoint(t.id, cp.id);
        checkpoints.settleCheckpoint(
          cp.id,
          3 * SALE,
          3 * COMMISSION,
          0,
          0,
          undefined,
          1,
          [{ method: "CASH", currency_code: "LBP", amount: -3 * OWED }],
        );
      },
      UTC,
    );
    sell("2026-10-27", 1);
    db.prepare(
      `INSERT INTO supplier_ledger (tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, created_at)
       VALUES (1, ?, 'PAYMENT', 0, -50000, 'old Pay tab', 1, '2026-10-27 10:00:00')`,
    ).run(lotoId);

    const backfill = MIGRATIONS.find(
      (m) => m.name === "loto_checkpoint_backfill",
    )!;
    (backfill.up as (d: Database.Database) => void)(db);

    expect(dayTotals()).toEqual({ "2026-10-27": OWED });
    const open = inUtc(() => repo.getAccountUnsettled(lotoId)).reduce(
      (sum, r) => sum + r.remaining_lbp,
      0,
    );
    expect(open).toBe(balance());
    expect(balance()).toBe(OWED - 50_000);
  });

  // Voids follow the house rule for calendar suppliers (LIRA-343, confirmed
  // for Loto by the owner 2026-10-29).
  function ticketTxn(): number {
    return (
      db
        .prepare(
          `SELECT id FROM transactions WHERE source_table = 'loto_tickets' AND reverses_id IS NULL ORDER BY id LIMIT 1`,
        )
        .get() as { id: number }
    ).id;
  }

  it("a ticket on a calendar-paid day can be voided; its paid share becomes Loto credit", () => {
    settle({ days: ["2026-10-26"], lbp: 3 * OWED, direction: "PAY" });
    const balanceBefore = balance();
    inUtc(() => getTransactionRepository().voidTransaction(ticketTxn(), 1));
    expect(balance()).toBe(balanceBefore - OWED);
    const open = inUtc(() => repo.getAccountUnsettled(lotoId));
    expect(open.reduce((sum, r) => sum + r.remaining_lbp, 0)).toBe(-OWED);
  });

  it("voiding a Loto settlement reopens its day and puts the cash back", () => {
    const drawerBefore = generalLbp();
    const { id } = settle({
      days: ["2026-10-26"],
      lbp: 3 * OWED,
      direction: "PAY",
    });
    const txn = (
      db
        .prepare(`SELECT transaction_id FROM supplier_ledger WHERE id = ?`)
        .get(id) as {
        transaction_id: number;
      }
    ).transaction_id;
    inUtc(() => getTransactionRepository().voidTransaction(txn, 1));
    expect(dayTotals()).toEqual({ "2026-10-26": 3 * OWED });
    expect(generalLbp()).toBe(drawerBefore);
  });
});
