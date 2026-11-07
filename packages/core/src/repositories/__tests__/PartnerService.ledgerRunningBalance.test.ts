/**
 * Owner 2026-11-07 — the Partners page History list shows every ledger row
 * with the partner's balance after it (CornerTag asked for the Suppliers
 * Purchase History on Partners). The balance is per currency, signed like
 * `getBalance` (DEBIT − CREDIT: positive = the partner owes us), and counts
 * EVERY earlier row, so a date filter never changes a row's figure.
 *
 *   $300 owed, $200 owed, $350 paid, $5 discount, $100 owed
 *   → after each: 300, 500, 150, 145, 245 — and 245 = the balance card.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext";
import { buildDb } from "../testHelpers/omtAccountDb";
import {
  PartnerSettlementRepository,
  resetPartnerSettlementRepository,
} from "../PartnerSettlementRepository";
import {
  PartnerRepository,
  resetPartnerRepository,
  type LedgerFilters,
} from "../PartnerRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { PartnerService } from "../../services/PartnerService";

const UTC = { clientTzOffsetMinutes: 0 };

let db: Database.Database;
let service: PartnerService;
let partnerId: number;

const run = <T>(fn: () => T): T => runWithTenant(1, fn, UTC);

beforeEach(() => {
  resetTransactionRepository();
  resetPartnerRepository();
  resetPartnerSettlementRepository();
  db = buildDb();
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  const partnerRepo = new PartnerRepository();
  service = new PartnerService(partnerRepo, new PartnerSettlementRepository());
  partnerId = run(() => partnerRepo.create({ name: "Karim" }).id);
});

afterEach(() => {
  resetTenantContext();
  resetTransactionRepository();
  resetPartnerRepository();
  resetPartnerSettlementRepository();
  db.close();
});

function ledgerRow(
  type: string,
  direction: "DEBIT" | "CREDIT",
  amount: number,
  at: string,
  currency = "USD",
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO partner_ledger
           (tenant_id, partner_id, transaction_type, amount, currency, direction, created_at)
         VALUES (1, ?, ?, ?, ?, ?, ?)`,
      )
      .run(partnerId, type, amount, currency, direction, at).lastInsertRowid,
  );
}

function balanceAfter(filters?: LedgerFilters) {
  const { entries, balance } = run(() =>
    service.getPartnerStatement(partnerId, filters),
  );
  return {
    ids: entries.map((e) => e.id),
    after: new Map(entries.map((e) => [e.id, e.balance_after])),
    balance,
  };
}

describe("Partners History — balance after each row", () => {
  it("counts every row of the currency, newest first, and ends on the balance", () => {
    const a = ledgerRow("FOR_OMT_SEND", "DEBIT", 300, "2026-10-20 10:00:00");
    const b = ledgerRow("FOR_OMT_SEND", "DEBIT", 200, "2026-10-21 10:00:00");
    const pay = ledgerRow("SETTLEMENT", "CREDIT", 350, "2026-10-21 12:00:00");
    const disc = ledgerRow("DISCOUNT", "CREDIT", 5, "2026-10-21 12:00:00");
    const c = ledgerRow("FOR_OMT_SEND", "DEBIT", 100, "2026-10-22 10:00:00");

    const s = balanceAfter();
    // Same-second rows (payment + discount) keep their insert order.
    expect(s.ids).toEqual([c, disc, pay, b, a]);
    expect(s.after.get(a)).toBe(300);
    expect(s.after.get(b)).toBe(500);
    expect(s.after.get(pay)).toBe(150);
    expect(s.after.get(disc)).toBe(145);
    expect(s.after.get(c)).toBe(245);
    expect(s.balance.usd).toBe(245);
  });

  it("keeps each currency apart", () => {
    const usd = ledgerRow("FOR_OMT_SEND", "DEBIT", 50, "2026-10-20 10:00:00");
    const lbp = ledgerRow(
      "FOR_WHISH_SEND",
      "CREDIT",
      900_000,
      "2026-10-21 10:00:00",
      "LBP",
    );
    const s = balanceAfter();
    expect(s.after.get(usd)).toBe(50);
    expect(s.after.get(lbp)).toBe(-900_000);
  });

  it("a date filter hides earlier rows but still counts them", () => {
    ledgerRow("FOR_OMT_SEND", "DEBIT", 300, "2026-10-20 10:00:00");
    const later = ledgerRow(
      "FOR_OMT_SEND",
      "DEBIT",
      100,
      "2026-10-22 10:00:00",
    );
    const s = balanceAfter({ startDate: "2026-10-22" });
    expect(s.ids).toEqual([later]);
    expect(s.after.get(later)).toBe(400);
  });
});
