/**
 * Owner 2026-11-07 — the Partners Transactions window shows a Status per
 * row, like the Suppliers window (Paid / Partial · amount / Unpaid /
 * Voided). It comes from the settle units (utils/partnerSettleUnits.ts,
 * LIRA-346), the same model as the settle calendar, never from
 * `covered_amount`.
 *
 *   - $300 + $200 + $100 the partner owes; the partner pays $350 by amount
 *     → $300 Paid, $200 Partial · $50, $100 Unpaid.
 *   - A row reversed in full (refund) → Voided, and so is its reversal row.
 *   - USDT rows have no unit → no status.
 *   - The Payments window rows get no status.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext";
import { buildDb, fundDrawer } from "../testHelpers/omtAccountDb";
import {
  PartnerSettlementRepository,
  resetPartnerSettlementRepository,
} from "../PartnerSettlementRepository";
import {
  PartnerRepository,
  resetPartnerRepository,
} from "../PartnerRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { PartnerService } from "../../services/PartnerService";
import { partnerSettleSchema } from "../../validators/partner";

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
  fundDrawer(db, "General", "USD", 10_000);
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
  currency = "USD",
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO partner_ledger
           (tenant_id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, created_at)
         VALUES (1, ?, ?, 'financial_services', ?, ?, ?, ?, ?)`,
      )
      .run(partnerId, type, refId, amount, currency, direction, at)
      .lastInsertRowid,
  );
}

function statusById(group: "transactions" | "payments") {
  const { entries } = run(() =>
    service.getPartnerStatement(partnerId, { group }),
  );
  return new Map(
    entries.map((e) => [
      e.id,
      { status: e.settle_status ?? null, paid: e.settle_paid ?? null },
    ]),
  );
}

describe("Partners Transactions window — Status per row", () => {
  it("Paid / Partial · $50 / Unpaid after a $350 payment by amount", () => {
    const a = ledgerRow(
      "FOR_OMT_SEND",
      "DEBIT",
      300,
      "2026-10-20 10:00:00",
      9001,
    );
    const b = ledgerRow(
      "FOR_OMT_SEND",
      "DEBIT",
      200,
      "2026-10-21 10:00:00",
      9002,
    );
    const c = ledgerRow(
      "FOR_OMT_SEND",
      "DEBIT",
      100,
      "2026-10-22 10:00:00",
      9003,
    );
    const parsed = partnerSettleSchema.parse({
      partnerId,
      amount: 350,
      currency: "USD",
      settlementMethod: "CASH",
      payments: [{ method: "CASH", currency_code: "USD", amount: 350 }],
    });
    run(() => service.settle({ ...parsed, userId: 1 }));

    const s = statusById("transactions");
    expect(s.get(a)).toEqual({ status: "PAID", paid: 300 });
    expect(s.get(b)).toEqual({ status: "PARTIAL", paid: 50 });
    expect(s.get(c)).toEqual({ status: "UNPAID", paid: 0 });
  });

  it("a row reversed in full is Voided, and so is its reversal row", () => {
    const head = ledgerRow(
      "FOR_OMT_SEND",
      "DEBIT",
      80,
      "2026-10-20 10:00:00",
      9101,
    );
    const rev = ledgerRow(
      "FOR_OMT_SEND",
      "CREDIT",
      80,
      "2026-10-20 11:00:00",
      9101,
    );
    const s = statusById("transactions");
    expect(s.get(head)?.status).toBe("VOIDED");
    expect(s.get(rev)?.status).toBe("VOIDED");
  });

  it("a USDT row has no status", () => {
    const usdt = ledgerRow(
      "THROUGH_BINANCE_SEND",
      "CREDIT",
      40,
      "2026-10-20 10:00:00",
      9201,
      "USDT",
    );
    expect(statusById("transactions").get(usdt)).toEqual({
      status: null,
      paid: null,
    });
  });

  it("Payments window rows get no status", () => {
    ledgerRow("FOR_OMT_SEND", "DEBIT", 100, "2026-10-20 10:00:00", 9301);
    const parsed = partnerSettleSchema.parse({
      partnerId,
      amount: 100,
      currency: "USD",
      settlementMethod: "CASH",
      payments: [{ method: "CASH", currency_code: "USD", amount: 100 }],
    });
    run(() => service.settle({ ...parsed, userId: 1 }));
    const pay = [...statusById("payments").values()];
    expect(pay.length).toBeGreaterThan(0);
    for (const p of pay) expect(p).toEqual({ status: null, paid: null });
  });
});
