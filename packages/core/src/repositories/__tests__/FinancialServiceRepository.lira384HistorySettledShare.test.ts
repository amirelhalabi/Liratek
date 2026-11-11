/**
 * LIRA-384 B — the OMT/Whish History read (`getHistory`, feeding IPC
 * `omt:get-history` and REST `GET /api/services/history` through the same
 * `FinancialService.getHistory`) must carry each settled row's share of its
 * settlement commission (`settlement_commission_allocations`), the figure
 * Profits counts — not only the booking-time estimate in `commission`.
 * Same projection as the Suppliers Transactions tab (`getAllByProvider`):
 * `settled_commission_usd` / `settled_commission_lbp`, NULL while unsettled.
 *
 * Real production schema (create_db.sql + migrations), real writers.
 * Rule 17: run red before the fix (see report).
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { SupplierRepository } from "../SupplierRepository";
import { getFinancialServiceRepository } from "../FinancialServiceRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetSettingsService } from "../../services/SettingsService";
import { resetSettingsRepository } from "../SettingsRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import {
  buildDb,
  fundDrawer,
  omtAccount,
  resetAll,
  seedOmtSend,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";

let db: Database.Database;
let acc: OmtAccount;

beforeEach(() => {
  resetAll();
  resetTransactionRepository();
  resetSettingsService();
  resetSettingsRepository();
  resetPaymentMethodRepository();
  db = buildDb();
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  acc = omtAccount(db);
  fundDrawer(db, "OMT_System", "LBP", 1_000_000_000);
  fundDrawer(db, "OMT_System", "USD", 100_000);
});

afterEach(() => {
  resetTenantContext();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

type HistoryRow = {
  id: number;
  commission: number;
  is_settled: number;
  settled_commission_usd?: number | null;
  settled_commission_lbp?: number | null;
};

it("a settled row carries its settled share; an unsettled row carries none", () => {
  // Booking-time estimates 10,000 LBP each; the settlement pays 30,001.
  const a = seedOmtSend(db, acc.omtId, {
    amount: 1_000_000,
    currency: "LBP",
    commission: 10_000,
  });
  const b = seedOmtSend(db, acc.omtId, {
    amount: 1_000_000,
    currency: "LBP",
    commission: 10_000,
  });
  const open = seedOmtSend(db, acc.omtId, {
    amount: 500_000,
    currency: "LBP",
    commission: 5_000,
  });
  new SupplierRepository().settleTransactions({
    supplier_id: acc.omtId,
    financial_service_ids: [a, b],
    amount_usd: 0,
    amount_lbp: 2_000_000 - 30_001,
    commission_usd: 0,
    commission_lbp: 30_001,
    created_by: 1,
    payments: [
      { method: "CASH", currency_code: "LBP", amount: 2_000_000 - 30_001 },
    ],
  });
  const alloc = new Map(
    (
      db
        .prepare(
          `SELECT financial_service_id AS id, commission_lbp AS lbp
             FROM settlement_commission_allocations WHERE tenant_id = 1`,
        )
        .all() as Array<{ id: number; lbp: number }>
    ).map((r) => [r.id, r.lbp]),
  );

  const rows = getFinancialServiceRepository().getHistory(
    "OMT",
    null,
  ) as unknown as HistoryRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));

  for (const id of [a, b]) {
    const r = byId.get(id)!;
    expect(r.is_settled).toBe(1);
    expect(r.commission).toBe(10_000); // the estimate is left as booked
    expect(r.settled_commission_lbp).toBe(alloc.get(id));
    expect(r.settled_commission_usd).toBe(0);
  }
  expect(
    (byId.get(a)!.settled_commission_lbp ?? 0) +
      (byId.get(b)!.settled_commission_lbp ?? 0),
  ).toBe(30_001);
  expect(byId.get(open)!.settled_commission_lbp ?? null).toBeNull();
  expect(byId.get(open)!.settled_commission_usd ?? null).toBeNull();
  // Ordering and limit are unchanged by the join.
  const latest = getFinancialServiceRepository().getHistory("OMT", 2);
  expect(latest).toHaveLength(2);
});

it("two allocation rows for one row and settlement: listed once, summed", () => {
  const a = seedOmtSend(db, acc.omtId, {
    amount: 100,
    currency: "USD",
    commission: 1,
  });
  new SupplierRepository().settleTransactions({
    supplier_id: acc.omtId,
    financial_service_ids: [a],
    amount_usd: 99,
    amount_lbp: 0,
    commission_usd: 1,
    commission_lbp: 0,
    created_by: 1,
    payments: [{ method: "CASH", currency_code: "USD", amount: 99 }],
  });
  // A second share on the same (row, settlement) pair — the amount-first
  // writer can book a commission share and an owed share for one transfer.
  db.prepare(
    `INSERT INTO settlement_commission_allocations
       (tenant_id, settlement_ledger_id, financial_service_id, service_type,
        provider, commission_usd, commission_lbp)
     SELECT tenant_id, settlement_ledger_id, financial_service_id, service_type,
            provider, 0.5, 0
       FROM settlement_commission_allocations WHERE financial_service_id = ?`,
  ).run(a);
  const rows = (
    getFinancialServiceRepository().getHistory(
      "OMT",
      null,
    ) as unknown as HistoryRow[]
  ).filter((r) => r.id === a);
  expect(rows).toHaveLength(1);
  expect(rows[0].settled_commission_usd).toBe(1.5);
});
