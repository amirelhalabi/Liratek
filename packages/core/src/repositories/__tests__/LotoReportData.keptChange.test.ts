/**
 * LIRA-185 owner decision (2026-10-02) — the Loto page's "Commission" card
 * stays PURE commission and gains a "Kept change" line under it, so that
 * commission + kept change equals the Profits page's loto profit for the
 * same period.
 *
 * Audit evidence (ProfitAudit.loto.test.ts, lead 1): one 500,000 LBP ticket
 * with 100,000 LBP kept change showed 22,250 LBP on the card vs 122,250 LBP on
 * Profits — the 100,000 LBP difference was nowhere on the Loto page.
 *
 * Every ticket here is written by the real writer (`LotoService.sellTicket`
 * -> `LotoTicketRepository.createTicket`) into an in-memory DB built from the
 * real production schema, reversed by the real generic void/refund
 * (`TransactionRepository`), and read back through the real readers
 * (`LotoService.getReportData`, `ProfitService.getSummary`).
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
import { getTransactionRepository } from "../TransactionRepository";
import { localDay } from "../../utils/localDate";

const CREATE_DB_SQL = path.resolve(
  __dirname,
  "../../../../../electron-app/create_db.sql",
);

let db: Database.Database;

function lotoService(): LotoService {
  return new LotoService(
    getLotoTicketRepository(),
    getLotoSettingsRepository(),
    getLotoMonthlyFeeRepository(),
    getLotoCheckpointRepository(),
    getLotoCashPrizeRepository(),
  );
}

/**
 * The report shape this guard pins. Declared as an intersection (not read
 * off `LotoReportData` alone) so the file compiles and its assertions run —
 * and fail on their values — against code that has no kept-change fields yet.
 */
type ReportWithKeptChange = ReturnType<LotoService["getReportData"]> & {
  total_kept_change_usd: number;
  total_kept_change_lbp: number;
};

function report(from: string, to: string): ReportWithKeptChange {
  return lotoService().getReportData(from, to) as ReportWithKeptChange;
}

function profitService(): ProfitService {
  return new ProfitService(new ProfitRepository());
}

function lotoTxnId(ticketId: number): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'loto_tickets' AND source_id = ? AND type = 'LOTO'`,
      )
      .get(ticketId) as { id: number }
  ).id;
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL, "utf-8"));
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
});

afterEach(() => {
  db.close();
  delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
});

describe("Loto page report — kept change shown next to commission (LIRA-185)", () => {
  it("LBP kept change: card shows commission 22,250 and kept change 100,000; sum = Profits 122,250", () => {
    const today = localDay();
    lotoService().sellTicket({
      sale_amount: 500000,
      userId: 1,
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 600000 }],
      kept_change_lbp: 100000,
    });

    const r = report(today, today);
    const summary = profitService().getSummary(today, today);

    expect(r.total_commission).toBeCloseTo(22250, 6);
    expect(r.total_kept_change_lbp).toBeCloseTo(100000, 6);
    expect(r.total_kept_change_usd).toBeCloseTo(0, 6);
    expect(r.total_commission + r.total_kept_change_lbp).toBeCloseTo(
      summary.loto.profit_lbp,
      6,
    );
    expect(summary.loto.profit_lbp).toBeCloseTo(122250, 6);
  });

  it("USD kept change is reported in USD, matching Profits' loto kept_change_usd", () => {
    const today = localDay();
    lotoService().sellTicket({
      sale_amount: 500000,
      userId: 1,
      // $6 handed over, $1 kept, $5 = 500,000 LBP at the till's rate (G14:
      // legs must now reconcile to the ticket).
      payments: [{ method: "CASH", currencyCode: "USD", amount: 6 }],
      tender_exchange_rate: 100000,
      kept_change_usd: 1,
    });

    const r = report(today, today);
    const summary = profitService().getSummary(today, today);

    expect(r.total_kept_change_usd).toBeCloseTo(1, 6);
    expect(r.total_kept_change_usd).toBeCloseTo(
      summary.loto.kept_change_usd,
      6,
    );
    expect(r.total_kept_change_lbp).toBeCloseTo(0, 6);
    expect(r.total_commission).toBeCloseTo(summary.loto.profit_lbp, 6);
  });

  it("a ticket without kept change reports 0 kept change", () => {
    const today = localDay();
    lotoService().sellTicket({
      sale_amount: 500000,
      userId: 1,
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 500000 }],
    });
    const r = report(today, today);
    expect(r.total_kept_change_lbp).toBe(0);
    expect(r.total_kept_change_usd).toBe(0);
  });

  it("voided and refunded tickets drop out of kept change (and of Profits) in both currencies", () => {
    const today = localDay();
    const voided = lotoService().sellTicket({
      sale_amount: 500000,
      userId: 1,
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 600000 }],
      kept_change_lbp: 100000,
    });
    const refunded = lotoService().sellTicket({
      sale_amount: 500000,
      userId: 1,
      // $6 handed over, $1 kept, $5 = 500,000 LBP at the till's rate (G14:
      // legs must now reconcile to the ticket).
      payments: [{ method: "CASH", currencyCode: "USD", amount: 6 }],
      tender_exchange_rate: 100000,
      kept_change_usd: 1,
    });
    lotoService().sellTicket({
      sale_amount: 1000000,
      userId: 1,
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 1050000 }],
      kept_change_lbp: 50000,
    });

    const txnRepo = getTransactionRepository();
    txnRepo.voidTransaction(lotoTxnId(voided.id), 1);
    txnRepo.refundTransaction(lotoTxnId(refunded.id), 1);

    const r = report(today, today);
    const summary = profitService().getSummary(today, today);

    expect(r.total_kept_change_lbp).toBeCloseTo(50000, 6);
    expect(r.total_kept_change_usd).toBeCloseTo(0, 6);
    expect(r.total_commission + r.total_kept_change_lbp).toBeCloseTo(
      summary.loto.profit_lbp,
      6,
    );
    expect(r.total_kept_change_usd).toBeCloseTo(
      summary.loto.kept_change_usd,
      6,
    );
  });

  it("kept change uses the card's window: a ticket from another day is excluded", () => {
    const today = localDay();
    lotoService().sellTicket({
      sale_amount: 500000,
      userId: 1,
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 600000 }],
      kept_change_lbp: 100000,
    });
    const r = report("2000-01-01", "2000-01-01");
    expect(r.total_kept_change_lbp).toBe(0);
    expect(r.total_commission).toBe(0);
    expect(report(today, today).total_kept_change_lbp).toBeCloseTo(100000, 6);
  });
});
