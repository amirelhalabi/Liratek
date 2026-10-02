/**
 * LIRA-185 — Profits accuracy audit, module: LOTO.
 *
 * The September audit (profitaudit/loto.json) filed 10 LEADS for loto by
 * reading an older tree. This file settles each one by EXECUTION (CLAUDE.md
 * rule 28): every ticket here is written by the real writer
 * (`LotoService.sellTicket` -> `LotoTicketRepository.createTicket`) into an
 * in-memory DB built from the REAL production schema
 * (`electron-app/create_db.sql`), then every surface the lead names is read
 * back through its real reader and the numbers compared.
 *
 * Two kinds of test live here:
 *   - `CONFIRMED (guard)` — asserts the CORRECT value and FAILS on the current
 *     code. This is the rule-17 failing-first guard for the later fix.
 *   - `measured` — a characterization that PASSES and records the numbers the
 *     verdict (REFUTED / ALREADY_FIXED / UNVERIFIABLE) rests on.
 *
 * The only non-writer step: partner coverage (lead 2) is set with a direct
 * UPDATE of `partner_ledger.covered_amount`, standing in for a partial
 * partner settlement — the readers only look at that column.
 */

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { initFixedTenantContext } from "../../db/tenantContext";
import { LotoService } from "../../services/LotoService";
import { getLotoTicketRepository } from "../LotoTicketRepository";
import { getLotoSettingsRepository } from "../LotoSettingsRepository";
import { getLotoMonthlyFeeRepository } from "../LotoMonthlyFeeRepository";
import { getLotoCheckpointRepository } from "../LotoCheckpointRepository";
import { getLotoCashPrizeRepository } from "../LotoCashPrizeRepository";
import { ProfitRepository } from "../ProfitRepository";
import { ProfitService } from "../../services/ProfitService";
import { ClosingService } from "../../services/ClosingService";
import { getTransactionRepository } from "../TransactionRepository";
import { localDay } from "../../utils/localDate";

const CREATE_DB_SQL = path.resolve(
  __dirname,
  "../../../../../electron-app/create_db.sql",
);

let db: Database.Database;

function freshDb(): Database.Database {
  const d = new Database(":memory:");
  d.exec(fs.readFileSync(CREATE_DB_SQL, "utf-8"));
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = d;
  return d;
}

function lotoService(): LotoService {
  return new LotoService(
    getLotoTicketRepository(),
    getLotoSettingsRepository(),
    getLotoMonthlyFeeRepository(),
    getLotoCheckpointRepository(),
    getLotoCashPrizeRepository(),
  );
}

function profitService(): ProfitService {
  return new ProfitService(new ProfitRepository());
}

function lotoTxn(ticketId: number): {
  id: number;
  profit_usd: number;
  profit_lbp: number;
  exchange_rate: number | null;
  created_at: string;
} {
  return db
    .prepare(
      `SELECT id, profit_usd, profit_lbp, exchange_rate, created_at
         FROM transactions WHERE source_table = 'loto_tickets' AND source_id = ? AND type = 'LOTO'`,
    )
    .get(ticketId) as {
    id: number;
    profit_usd: number;
    profit_lbp: number;
    exchange_rate: number | null;
    created_at: string;
  };
}

beforeEach(() => {
  db = freshDb();
  initFixedTenantContext(1);
});

afterEach(() => {
  db.close();
  delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
});

// ---------------------------------------------------------------------------
// Lead 1 — kept LBP change: in the stamp/Profits, not in the Loto "Commission"
// ---------------------------------------------------------------------------
describe("Lead 1 (measured) — kept LBP change vs the Loto page's Commission", () => {
  it("one 500,000 LBP ticket with 100,000 LBP kept change: Loto Commission 22,250 vs Profits/Closing 122,250", () => {
    const today = localDay();
    const t = lotoService().sellTicket({
      sale_amount: 500000,
      userId: 1,
      payments: [
        { method: "CASH", currencyCode: "LBP", amount: 600000 },
      ],
      kept_change_lbp: 100000,
    });

    const stamp = lotoTxn(t.id);
    expect(stamp.profit_lbp).toBeCloseTo(122250, 6);

    // Loto page "Commission" stat card + Ticket History column read the column.
    const lotoPageCommission = getLotoTicketRepository().getTotalCommission(today, today);
    expect(lotoPageCommission).toBeCloseTo(22250, 6);

    const summary = profitService().getSummary(today, today);
    expect(summary.loto.profit_lbp).toBeCloseTo(122250, 6);

    const closing = new ClosingService(undefined, profitService()).getDailyStatsSnapshot(
      { day: today },
      { includeProfit: true },
    );
    expect(closing.totalProfitLBP).toBeCloseTo(122250, 6);
  });
});

// ---------------------------------------------------------------------------
// Lead 2 — for-partner ticket: Loto page / Profits / Closing
// ---------------------------------------------------------------------------
describe("Lead 2 (measured) — for-partner ticket, 40% partner coverage", () => {
  it("Profits = Closing = 17,800 (proportional); Loto page card = 44,500 (ungated)", () => {
    const today = localDay();
    db.prepare(`INSERT INTO partners (tenant_id, name) VALUES (1, 'P1')`).run();
    const partnerId = (db.prepare(`SELECT id FROM partners WHERE name='P1'`).get() as { id: number }).id;

    const t = lotoService().sellTicket({
      sale_amount: 1000000,
      userId: 1,
      partnerId,
      partnerMode: "FOR",
    });
    expect(lotoTxn(t.id).profit_lbp).toBeCloseTo(44500, 6);

    // stand-in for a partial partner settlement (see file header)
    db.prepare(
      `UPDATE partner_ledger SET covered_amount = 400000 WHERE reference_table='loto_tickets' AND reference_id = ?`,
    ).run(t.id);

    const lotoPage = getLotoTicketRepository().getTotalCommission(today, today);
    const summary = profitService().getSummary(today, today);
    const closing = new ClosingService(undefined, profitService()).getDailyStatsSnapshot(
      { day: today },
      { includeProfit: true },
    );

    expect(lotoPage).toBeCloseTo(44500, 6);
    expect(summary.loto.profit_lbp).toBeCloseTo(17800, 6);
    expect(summary.loto.revenue_lbp).toBeCloseTo(400000, 6);
    expect(closing.totalProfitLBP).toBeCloseTo(17800, 6);
  });
});

// ---------------------------------------------------------------------------
// Lead 3 — on-account ticket; By Cashier revenue vs By Module
// ---------------------------------------------------------------------------
describe("Lead 3 (measured) — on-account (CUSTOMER_ACCOUNT) ticket, unrepaid", () => {
  it("Profits/Closing/By Cashier all defer (0 revenue, 0 profit); Loto page card still 22,250", () => {
    const today = localDay();
    db.prepare(`INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'X', '70000000')`).run();
    const clientId = (db.prepare(`SELECT id FROM clients WHERE full_name='X'`).get() as { id: number }).id;

    lotoService().sellTicket({
      sale_amount: 500000,
      userId: 1,
      clientId,
      clientName: "X",
      payments: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 500000 }],
    });

    const debt = db
      .prepare(`SELECT transaction_type, amount_lbp FROM debt_ledger WHERE client_id = ?`)
      .all(clientId) as Array<{ transaction_type: string; amount_lbp: number }>;
    expect(debt.some((d) => d.transaction_type === "Loto Debt")).toBe(true);

    const ps = profitService();
    const summary = ps.getSummary(today, today);
    expect(summary.loto.count ?? 0).toBe(0); // SUM over zero rows reads NULL
    expect(summary.loto.profit_lbp).toBe(0);
    expect(ps.getByModule(today, today).find((r) => r.module === "LOTO")).toBeUndefined();

    const byUser = ps.getByUser(today, today);
    const admin = byUser.find((u) => u.user_id === 1);
    expect(admin?.revenue_lbp ?? 0).toBe(0);
    expect(admin?.profit_lbp ?? 0).toBe(0);

    const closing = new ClosingService(undefined, ps).getDailyStatsSnapshot(
      { day: today },
      { includeProfit: true },
    );
    expect(closing.totalProfitLBP).toBe(0);

    expect(getLotoTicketRepository().getTotalCommission(today, today)).toBeCloseTo(22250, 6);
  });
});

// ---------------------------------------------------------------------------
// Lead 4 — kept USD change reaches every Profits surface + Closing
// ---------------------------------------------------------------------------
describe("Lead 4 (measured) — kept USD change on a loto ticket", () => {
  it("$0.4444 kept change reaches gross_profit_usd, the By Module row, By Cashier and Closing", () => {
    const today = localDay();
    lotoService().sellTicket({
      sale_amount: 500000,
      userId: 1,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 6 },
      ],
      kept_change_usd: 0.4444,
    });
    const ps = profitService();
    const summary = ps.getSummary(today, today);
    expect(summary.loto.kept_change_usd).toBeCloseTo(0.4444, 6);
    expect(summary.totals.gross_profit_usd).toBeCloseTo(0.4444, 6);

    const row = ps.getByModule(today, today).find((r) => r.module === "LOTO");
    expect(row?.kept_change_usd).toBeCloseTo(0.4444, 6);

    const admin = ps.getByUser(today, today).find((u) => u.user_id === 1);
    expect(admin?.profit_usd).toBeCloseTo(0.4444, 6);

    const closing = new ClosingService(undefined, ps).getDailyStatsSnapshot(
      { day: today },
      { includeProfit: true },
    );
    expect(closing.totalProfitUSD).toBeCloseTo(0.4444, 6);
  });
});

// ---------------------------------------------------------------------------
// Lead 5 — By Module margin for LOTO
// ---------------------------------------------------------------------------
describe("Lead 5 (measured) — LOTO By Module margin", () => {
  it("100 tickets x 500,000 LBP -> margin_pct 4.45, not 0", () => {
    const today = localDay();
    const svc = lotoService();
    for (let i = 0; i < 100; i++) {
      svc.sellTicket({
        sale_amount: 500000,
        userId: 1,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 500000 }],
      });
    }
    const row = profitService().getByModule(today, today).find((r) => r.module === "LOTO");
    expect(row?.revenue_lbp).toBeCloseTo(50000000, 4);
    expect(row?.profit_lbp).toBeCloseTo(2225000, 4);
    expect(row?.margin_pct).toBeCloseTo(4.45, 6);
    expect(row?.margin_converted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Lead 6 — backdated ticket: sale_date vs created_at
// ---------------------------------------------------------------------------
describe("Lead 6 — backdated ticket (Transaction Time override)", () => {
  // Payload exactly as the Loto page sends it (index.tsx:271/:307):
  // sale_date: localDay() (today) + transaction_time: the override.
  const BACKDATED_DAY = "2026-09-01";

  function sellBackdated(): void {
    lotoService().sellTicket({
      sale_amount: 500000,
      userId: 1,
      sale_date: localDay(),
      transaction_time: `${BACKDATED_DAY} 14:00:00`,
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 500000 }],
    });
  }

  // Before the fix this test recorded the split (Loto page = today, Profits =
  // backdated day). After LIRA-185 lead 6 both file it on the backdated day.
  it("measured: Profits AND the Loto page both file it on the backdated day, neither on today", () => {
    const today = localDay();
    sellBackdated();
    const lotoRepo = getLotoTicketRepository();
    const ps = profitService();
    expect(ps.getSummary(BACKDATED_DAY, BACKDATED_DAY).loto.profit_lbp).toBeCloseTo(22250, 6);
    expect(ps.getSummary(today, today).loto.profit_lbp).toBe(0);
    expect(lotoRepo.getTotalCommission(today, today)).toBe(0);
    expect(lotoRepo.getTotalCommission(BACKDATED_DAY, BACKDATED_DAY)).toBeCloseTo(22250, 6);
  });

  it("a ticket with no Transaction Time override keeps the sent sale_date", () => {
    const today = localDay();
    lotoService().sellTicket({
      sale_amount: 500000,
      userId: 1,
      sale_date: today,
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 500000 }],
    });
    expect(getLotoTicketRepository().getTotalCommission(today, today)).toBeCloseTo(22250, 6);
  });

  it("CONFIRMED (guard): the Loto page's commission for the backdated day equals the Profits page's for that day", () => {
    sellBackdated();
    const lotoRepo = getLotoTicketRepository();
    const profitsOnDay = profitService().getSummary(BACKDATED_DAY, BACKDATED_DAY).loto.profit_lbp;
    expect(profitsOnDay).toBeCloseTo(22250, 6);
    // created_at is the business date (TransactionRepository D1 doc comment;
    // the override sets it). The module's own day-filtered aggregates must
    // file the ticket on the same day.
    expect(lotoRepo.getTotalCommission(BACKDATED_DAY, BACKDATED_DAY)).toBeCloseTo(profitsOnDay, 6);
    expect(lotoRepo.getTicketsByDateRange(BACKDATED_DAY, BACKDATED_DAY)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Lead 7 — Settlement Verification "Unchecked Activity" panel
// ---------------------------------------------------------------------------
describe("Lead 7 (measured) — the panel's date-range source vs the server's checkpoint sweep", () => {
  /** The OLD panel's arithmetic (SettlementVerification.tsx:121-158 before
   *  LIRA-185 lead 7). Kept as the measurement behind that lead; the panel
   *  now reads getUncheckpointed() instead — guarded by the frontend test
   *  SettlementVerification.uncheckedActivity.test.tsx. */
  function panelFigures(): { tickets: number; sales: number; commission: number } {
    const repo = getLotoTicketRepository();
    const last = lotoService().getLastCheckpoint();
    const today = localDay();
    let periodStart = "1970-01-01";
    if (last) {
      const d = new Date(`${last.period_end}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      periodStart = d.toISOString().slice(0, 10);
    }
    const tickets = repo.getTicketsByDateRange(periodStart, today);
    return {
      tickets: tickets.length,
      sales: tickets.reduce((s, t) => s + t.sale_amount, 0),
      commission: tickets.reduce((s, t) => s + t.commission_amount, 0),
    };
  }

  it("case A: a ticket sold after today's checkpoint is pending on the server but absent from the panel", () => {
    const svc = lotoService();
    svc.sellTicket({ sale_amount: 100000, userId: 1, payments: [{ method: "CASH", currencyCode: "LBP", amount: 100000 }] });
    svc.createScheduledCheckpoint(localDay());
    svc.sellTicket({ sale_amount: 300000, userId: 1, payments: [{ method: "CASH", currencyCode: "LBP", amount: 300000 }] });

    const server = getLotoTicketRepository().getUncheckpointedTotals();
    expect(server.count).toBe(1);
    expect(server.totalCommission).toBeCloseTo(13350, 6);

    const panel = panelFigures();
    expect(panel.tickets).toBe(0);
    expect(panel.commission).toBe(0);
  });

  it("case B: a voided ticket stays in the panel's 'We pay LOTO' figure; the checkpoint excludes it", () => {
    const svc = lotoService();
    svc.sellTicket({ sale_amount: 500000, userId: 1, payments: [{ method: "CASH", currencyCode: "LBP", amount: 500000 }] });
    const t2 = svc.sellTicket({ sale_amount: 500000, userId: 1, payments: [{ method: "CASH", currencyCode: "LBP", amount: 500000 }] });
    getTransactionRepository().voidTransaction(lotoTxn(t2.id).id, 1);

    const panel = panelFigures();
    expect(panel.sales - panel.commission).toBeCloseTo(955500, 6);

    const server = getLotoTicketRepository().getUncheckpointedTotals();
    expect(server.totalSales - server.totalCommission).toBeCloseTo(477750, 6);
  });
});

// ---------------------------------------------------------------------------
// Lead 8 — Dashboard net profit tile has no loto arm
// ---------------------------------------------------------------------------
describe("Lead 8 (measured) — the Dashboard net-profit source now carries loto", () => {
  it("ProfitService.getByDate (feeds SalesService.getNetProfitLast30Days) includes the loto commission", () => {
    const today = localDay();
    lotoService().sellTicket({ sale_amount: 500000, userId: 1, payments: [{ method: "CASH", currencyCode: "LBP", amount: 500000 }] });
    const rows = profitService().getByDate(today, today);
    const lbp = rows.reduce((s, r) => s + r.net_profit_lbp, 0);
    expect(lbp).toBeCloseTo(22250, 6);
  });
});

// ---------------------------------------------------------------------------
// Lead 9 — exchange_rate stamp on a direct sale
// ---------------------------------------------------------------------------
describe("Lead 9 — exchange_rate stamped on a directly-sold ticket", () => {
  it("CONFIRMED (guard): a direct sale with no rate snapshots the shop's LBP market rate, not a hardcoded 100,000", () => {
    const market = (db
      .prepare(`SELECT market_rate FROM exchange_rates WHERE tenant_id = 1 AND to_code = 'LBP'`)
      .get() as { market_rate: number }).market_rate;
    expect(market).toBe(89500);
    const t = lotoService().sellTicket({
      sale_amount: 500000,
      userId: 1,
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 500000 }],
    });
    // TransactionRepository.createTransaction's documented contract: "a
    // missing exchange_rate is snapshotted from the current LBP market rate".
    expect(lotoTxn(t.id).exchange_rate).toBe(market);
  });

  it("measured: the session path's injected rate is stamped as sent", () => {
    const t = lotoService().sellTicket({
      sale_amount: 500000,
      userId: 1,
      exchange_rate: 90000,
      deferPayment: true,
    });
    expect(lotoTxn(t.id).exchange_rate).toBe(90000);
  });
});

// ---------------------------------------------------------------------------
// Lead 10 — client-sent commission_rate wins over settings
// ---------------------------------------------------------------------------
describe("Lead 10 (measured) — commission_rate from the client vs settings", () => {
  it("settings 5%: a payload carrying 0.0445 books 22,250; a payload with no rate books 25,000", () => {
    db.prepare(`UPDATE loto_settings SET value = '0.05' WHERE tenant_id = 1 AND key_name = 'commission_rate'`).run();
    const svc = lotoService();
    const withRate = svc.sellTicket({
      sale_amount: 500000,
      userId: 1,
      commission_rate: 0.0445,
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 500000 }],
    });
    const noRate = svc.sellTicket({
      sale_amount: 500000,
      userId: 1,
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 500000 }],
    });
    expect(withRate.commission_amount).toBeCloseTo(22250, 6);
    expect(noRate.commission_amount).toBeCloseTo(25000, 6);
  });
});
