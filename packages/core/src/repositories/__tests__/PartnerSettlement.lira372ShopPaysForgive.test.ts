/**
 * LIRA-372 (T022) — Partners: the Discount line in both directions.
 *
 *   By day, SHOP payer: the shop owes the partner $500 on picked days, pays
 *   $497 + forgive $3 → DISCOUNT row DEBIT (the partner accepted less →
 *   "received", profit +3), balance 0, days settled, void nets 0. Forgive
 *   $5.01 refused by the schema.
 *   By amount: the partner owes $500, pays $495 + discount $5 → profit −5,
 *   balance 0, void nets 0; discount $6 refused by the schema.
 *
 * Likely a PIN (research R9: the SHOP-payer booking already works
 * server-side; the cap refusals are proven failing-first in T007). Rule 17:
 * whatever this run showed is recorded in the LIRA-372 report.
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
} from "../PartnerSettlementRepository";
import { PartnerRepository, resetPartnerRepository } from "../PartnerRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { PartnerService } from "../../services/PartnerService";
import { buildDaySelections } from "../../utils/settleDaySelections";
import { buildSettleDays } from "../../utils/settleDays";
import {
  partnerSettleDaysSchema,
  partnerSettleSchema,
  type PartnerSettleDaysInput,
} from "../../validators/partner";
import { expectPostings, snapshotLedgers } from "../testHelpers/postingAssert";

const UTC = { clientTzOffsetMinutes: 0 };
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

let db: Database.Database;
let service: PartnerService;
let partnerRepo: PartnerRepository;
let partnerId: number;

const run = <T>(fn: () => T): T => runWithTenant(1, fn, UTC);
const num = (sql: string, ...args: unknown[]): number =>
  r6((db.prepare(sql).get(...args) as { v: number | null }).v ?? 0);

beforeEach(() => {
  resetTransactionRepository();
  resetPartnerRepository();
  resetPartnerSettlementRepository();
  db = buildDb();
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  partnerRepo = new PartnerRepository();
  service = new PartnerService(partnerRepo, new PartnerSettlementRepository());
  fundDrawer(db, "General", "USD", 10_000);
  fundDrawer(db, "General", "LBP", 100_000_000);
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
  refId: number,
): void {
  db.prepare(
    `INSERT INTO partner_ledger
       (tenant_id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, created_at)
     VALUES (1, ?, ?, 'financial_services', ?, ?, 'USD', ?, ?)`,
  ).run(partnerId, type, refId, amount, direction, at);
}

function side() {
  return {
    profitUsd: num(`SELECT SUM(profit_usd) AS v FROM transactions WHERE status = 'ACTIVE'`),
    profitLbp: num(`SELECT SUM(profit_lbp) AS v FROM transactions WHERE status = 'ACTIVE'`),
    covered: num(`SELECT SUM(covered_amount) AS v FROM partner_ledger`),
    coverage: num(
      `SELECT COUNT(*) AS v FROM partner_settlement_coverage WHERE is_reversed = 0`,
    ),
    open: run(() => service.getSettleOpenRows(partnerId)).length,
  };
}

function discountSince(maxId: number) {
  return db
    .prepare(
      `SELECT profit_usd, profit_lbp FROM transactions
        WHERE type = 'COUNTERPARTY_DISCOUNT' AND id > ? AND reverses_id IS NULL`,
    )
    .all(maxId) as Array<{ profit_usd: number; profit_lbp: number }>;
}

const balanceUsd = () => r6(run(() => service.getPartnerBalance(partnerId)).usd);

/** The by-day request, built the way the sheet builds it (one builder). */
function daysRequest(forgive: number, pay: number): PartnerSettleDaysInput {
  const sel = buildDaySelections(run(() => service.getSettleOpenRows(partnerId)), {
    pickedDays: ["2026-10-20", "2026-10-21"],
    untickedRows: new Set(),
  });
  return {
    partnerId,
    selections: sel.selections.map((s) => s.id),
    include_account_credits: true,
    credit_used: sel.credit_used,
    expected_owed: sel.expected_owed,
    per_currency: {
      USD: {
        payer: "SHOP",
        payments: [{ method: "CASH", currency_code: "USD", amount: pay }],
        forgive: { amount: forgive, reason: "rounded" },
      },
    },
  };
}

describe("LIRA-372 — partner by day, SHOP payer, with a forgive", () => {
  beforeEach(() => {
    ledgerRow("THROUGH_OMT_SEND", "CREDIT", 300, "2026-10-20 10:00:00", 9001);
    ledgerRow("THROUGH_OMT_SEND", "CREDIT", 200, "2026-10-21 10:00:00", 9002);
  });

  it("shop owes $500, pays $497 + forgive $3 → DISCOUNT DEBIT, profit +3, balance 0, days settled; void nets 0", () => {
    expect(balanceUsd()).toBe(-500);
    const ledgers0 = snapshotLedgers(db);
    const side0 = side();
    const maxId = num(`SELECT MAX(id) AS v FROM transactions`);
    const drawer0 = drawerTotals(db).usd;

    const parsed = partnerSettleDaysSchema.parse(daysRequest(3, 497));
    const res = run(() => service.settleDays({ ...parsed, userId: 1 }));
    expect(res).toMatchObject({ success: true });

    const disc = db
      .prepare(
        `SELECT direction, amount, notes FROM partner_ledger WHERE partner_id = ? AND transaction_type = 'DISCOUNT'`,
      )
      .all(partnerId) as Array<{ direction: string; amount: number; notes: string | null }>;
    expect(disc).toHaveLength(1);
    expect(disc[0].direction).toBe("DEBIT");
    expect(r6(disc[0].amount)).toBe(3);
    const rows = discountSince(maxId);
    expect(rows).toHaveLength(1);
    expect(r6(rows[0].profit_usd)).toBe(3);
    expect(balanceUsd()).toBe(0);
    expect(r6(drawerTotals(db).usd - drawer0)).toBe(-497);
    const days = buildSettleDays(
      run(() => service.getSettleMonthRows(partnerId, "2026-10")),
      { today: "2026-10-31", month: "2026-10" },
    );
    for (const d of ["2026-10-20", "2026-10-21"]) {
      expect(days.find((x) => x.day === d)?.state).toBe("SETTLED");
    }

    run(() => getTransactionRepository().voidTransaction(res.id!, 1));
    expectPostings(ledgers0, snapshotLedgers(db), {});
    expect(side()).toEqual(side0);
  });

  it("the server refuses forgive $5.01 even past the schema (decision B): nothing written", () => {
    const ledgers0 = snapshotLedgers(db);
    const side0 = side();
    const res = run(() =>
      service.settleDays({ ...daysRequest(5.01, 494.99), userId: 1 }),
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("The discount is more than $5.");
    expectPostings(ledgers0, snapshotLedgers(db), {});
    expect(side()).toEqual(side0);
  });

  it("the schema refuses forgive $5.01", () => {
    const r = partnerSettleDaysSchema.safeParse(daysRequest(5.01, 494.99));
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("The discount is more than $5.");
  });
});

describe("LIRA-372 — partner by amount, partner owes, with a discount", () => {
  beforeEach(() => {
    ledgerRow("FOR_OMT_SEND", "DEBIT", 500, "2026-10-20 10:00:00", 9101);
  });

  const request = (discount: number, pay: number) => ({
    partnerId,
    amount: pay,
    currency: "USD",
    settlementMethod: "CASH",
    payments: [{ method: "CASH", currency_code: "USD", amount: pay }],
    discount: { amount_usd: discount, amount_lbp: 0, reason: "rounded" },
  });

  it("owes $500, pays $495 + discount $5 → profit −5, balance 0; void nets 0", () => {
    expect(balanceUsd()).toBe(500);
    const ledgers0 = snapshotLedgers(db);
    const side0 = side();
    const maxId = num(`SELECT MAX(id) AS v FROM transactions`);

    const parsed = partnerSettleSchema.parse(request(5, 495));
    const entry = run(() => service.settle({ ...parsed, userId: 1 }));
    const rows = discountSince(maxId);
    expect(rows).toHaveLength(1);
    expect(r6(rows[0].profit_usd)).toBe(-5);
    expect(balanceUsd()).toBe(0);

    const txnId = num(
      `SELECT id AS v FROM transactions WHERE type = 'PARTNER_SETTLEMENT' AND source_table = 'partner_ledger' AND source_id = ?`,
      entry.id,
    );
    run(() => getTransactionRepository().voidTransaction(txnId, 1));
    expectPostings(ledgers0, snapshotLedgers(db), {});
    expect(side()).toEqual(side0);
  });

  it("the service refuses discount $6 even past the schema (decision B): nothing written", () => {
    const ledgers0 = snapshotLedgers(db);
    const side0 = side();
    expect(() =>
      run(() =>
        service.settle({
          ...(request(6, 494) as Parameters<PartnerService["settle"]>[0]),
          userId: 1,
        } as Parameters<PartnerService["settle"]>[0]),
      ),
    ).toThrow("The discount is more than $5.");
    expectPostings(ledgers0, snapshotLedgers(db), {});
    expect(side()).toEqual(side0);
  });

  it("the schema refuses discount $6", () => {
    const r = partnerSettleSchema.safeParse(request(6, 494));
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("The discount is more than $5.");
  });
});
