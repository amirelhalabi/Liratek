/**
 * LIRA-372 (T002) — baseline pin: today's settle discounts, each under $5,
 * booked through the real services on the full production schema
 * (create_db.sql + migrations). For each one: the discount books with the
 * right profit sign on its own COUNTERPARTY_DISCOUNT row, the balance it
 * settles closes, and a void nets EVERY ledger back to 0 per currency
 * (drawers, supplier, partner, debt, profit, coverage, settled flags).
 *
 * A pin, not a guard: it must pass before and after LIRA-372. Rule 17: not
 * proven failing-first (nothing here is expected to fail on today's code).
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext";
import {
  buildDb,
  fundDrawer,
  omtAccount,
  settlementTxn,
} from "../testHelpers/omtAccountDb";
import { seedTestShopOmt } from "../testHelpers/omtTestShop";
import { addClient, seedChargeDebt, RATE } from "../testHelpers/debtItemDb";
import { resetSupplierRepository, SupplierRepository } from "../SupplierRepository";
import { getTransactionRepository, resetTransactionRepository } from "../TransactionRepository";
import { resetFinancialServiceRepository } from "../FinancialServiceRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetSettingsRepository } from "../SettingsRepository";
import { resetRateRepository } from "../RateRepository";
import { resetProfitRepository } from "../ProfitRepository";
import { resetPartnerRepository, PartnerRepository } from "../PartnerRepository";
import {
  resetPartnerSettlementRepository,
  PartnerSettlementRepository,
} from "../PartnerSettlementRepository";
import { resetSalesRepository } from "../SalesRepository";
import { resetClientRepository } from "../ClientRepository";
import { DebtRepository } from "../DebtRepository";
import { resetSettingsService } from "../../services/SettingsService";
import { resetSessionPaymentService } from "../../services/SessionPaymentService";
import { resetSessionPaymentRepository } from "../SessionPaymentRepository";
import { resetCustomerSessionRepository } from "../CustomerSessionRepository";
import { SupplierService } from "../../services/SupplierService";
import { PartnerService } from "../../services/PartnerService";
import { DebtService } from "../../services/DebtService";
import { buildDaySelections } from "../../utils/settleDaySelections";
import type { SettleAccountRequest } from "../SupplierRepository";
import { expectPostings, snapshotLedgers } from "../testHelpers/postingAssert";

const UTC = { clientTzOffsetMinutes: 0 };
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

let db: Database.Database;

function resetAll(): void {
  resetSupplierRepository();
  resetTransactionRepository();
  resetFinancialServiceRepository();
  resetPaymentMethodRepository();
  resetSettingsRepository();
  resetSettingsService();
  resetRateRepository();
  resetProfitRepository();
  resetPartnerRepository();
  resetPartnerSettlementRepository();
  resetSessionPaymentService();
  resetSessionPaymentRepository();
  resetCustomerSessionRepository();
  resetSalesRepository();
  resetClientRepository();
}

beforeEach(() => {
  resetAll();
  db = buildDb();
  db.prepare(
    `UPDATE exchange_rates SET market_rate = ?, buy_rate = ?, sell_rate = ? WHERE to_code = 'LBP' AND tenant_id = 1`,
  ).run(RATE, RATE, RATE);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  for (const d of ["General", "OMT_System"]) {
    fundDrawer(db, d, "USD", 10_000);
    fundDrawer(db, d, "LBP", 100_000_000);
  }
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

const run = <T>(fn: () => T): T => runWithTenant(1, fn, UTC);

const num = (sql: string, ...args: unknown[]): number =>
  r6((db.prepare(sql).get(...args) as { v: number | null }).v ?? 0);

/** Every non-ledger figure a settle discount can move. */
function sideState() {
  return {
    profitUsd: num(`SELECT SUM(profit_usd) AS v FROM transactions WHERE status = 'ACTIVE'`),
    profitLbp: num(`SELECT SUM(profit_lbp) AS v FROM transactions WHERE status = 'ACTIVE'`),
    debtCoveredUsd: num(`SELECT SUM(covered_usd) AS v FROM debt_ledger`),
    debtCoveredLbp: num(`SELECT SUM(covered_lbp) AS v FROM debt_ledger`),
    partnerCovered: num(`SELECT SUM(covered_amount) AS v FROM partner_ledger`),
    partnerCoverage: num(
      `SELECT COUNT(*) AS v FROM partner_settlement_coverage WHERE is_reversed = 0`,
    ),
    purchasesPaid: num(`SELECT SUM(paid_usd) AS v FROM supplier_purchases`),
    fsSettled: num(`SELECT SUM(is_settled) AS v FROM financial_services`),
    supplierCoverage: num(
      `SELECT COUNT(*) AS v FROM supplier_settlement_coverage WHERE is_reversed = 0`,
    ),
    allocations: num(`SELECT COUNT(*) AS v FROM settlement_commission_allocations`),
  };
}

function snapshot() {
  return {
    ledgers: snapshotLedgers(db),
    side: sideState(),
    maxTxn: num(`SELECT MAX(id) AS v FROM transactions`),
  };
}

/** The ONE COUNTERPARTY_DISCOUNT row booked since `since`. */
function discountRow(since: number): { profit_usd: number; profit_lbp: number } {
  const rows = db
    .prepare(
      `SELECT profit_usd, profit_lbp FROM transactions
        WHERE type = 'COUNTERPARTY_DISCOUNT' AND id > ? AND reverses_id IS NULL`,
    )
    .all(since) as Array<{ profit_usd: number; profit_lbp: number }>;
  expect(rows).toHaveLength(1);
  return rows[0];
}

function expectNetsToZero(
  start: ReturnType<typeof snapshot>,
  ignore: Array<keyof ReturnType<typeof sideState>> = [],
): void {
  expectPostings(start.ledgers, snapshotLedgers(db), {});
  const now = { ...sideState() };
  const was = { ...start.side };
  for (const k of ignore) {
    delete now[k];
    delete was[k];
  }
  expect(now).toEqual(was);
}

function voidTxn(id: number): void {
  run(() => getTransactionRepository().voidTransaction(id, 1));
}

function plainSupplier(balanceUsd: number): number {
  const id = Number(
    db
      .prepare(
        `INSERT INTO suppliers (tenant_id, name, is_active, is_system) VALUES (1, 'Baseline Supplier', 1, 0)`,
      )
      .run().lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO supplier_ledger (tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, created_by)
     VALUES (1, ?, 'ADJUSTMENT', ?, 0, 1)`,
  ).run(id, balanceUsd);
  return id;
}

describe("LIRA-372 baseline — today's settle discounts book and void to 0", () => {
  it("Supplier Pay: owes $100, pay $98 + discount $2 (received, FIFO purchase coverage applied, given back on void)", () => {
    const supplierId = plainSupplier(100);
    const purchaseId = Number(
      db
        .prepare(
          `INSERT INTO supplier_purchases (tenant_id, supplier_id, total_usd, paid_usd, created_by) VALUES (1, ?, 100, 0, 1)`,
        )
        .run(supplierId).lastInsertRowid,
    );
    const start = snapshot();
    const res = run(() =>
      new SupplierService().recordSupplierCashflow({
        supplier_id: supplierId,
        direction: "PAY",
        payments: [{ method: "CASH", currency_code: "USD", amount: 98 }],
        discount: { amount_usd: 2, amount_lbp: 0, reason: "baseline" },
        exchange_rate: RATE,
        created_by: 1,
      }),
    );
    expect(res).toMatchObject({ success: true });
    expect(discountRow(start.maxTxn).profit_usd).toBe(2);
    expect(num(`SELECT paid_usd AS v FROM supplier_purchases WHERE id = ?`, purchaseId)).toBe(100);
    expect(
      run(() => new SupplierRepository().getSupplierBalance(supplierId)).balance_usd,
    ).toBeCloseTo(0, 6);
    const txnId = num(
      `SELECT id AS v FROM transactions WHERE type = 'SUPPLIER_PAYMENT' AND source_table = 'supplier_ledger' AND source_id = ?`,
      res.id,
    );
    voidTxn(txnId);
    expectNetsToZero(start);
  });

  it("Supplier batch Settle: owes $52, pay $50 + waive $2 (received)", () => {
    const provider = "LIRA372BASE";
    db.prepare(
      `INSERT OR IGNORE INTO service_providers (tenant_id, code, label, drawer_name) VALUES (1, ?, 'Baseline Provider', 'General')`,
    ).run(provider);
    const supplierId = Number(
      db
        .prepare(
          `INSERT INTO suppliers (tenant_id, name, provider, is_active, is_system) VALUES (1, 'Batch Supplier', ?, 1, 0)`,
        )
        .run(provider).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO supplier_ledger (tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, created_by)
       VALUES (1, ?, 'TOP_UP', 52, 0, 1)`,
    ).run(supplierId);
    const fsId = Number(
      db
        .prepare(
          `INSERT INTO financial_services (tenant_id, provider, service_type, amount, currency, commission, commission_model, is_settled)
           VALUES (1, ?, 'SEND', 52, 'USD', 0, 0, 0)`,
        )
        .run(provider).lastInsertRowid,
    );
    const start = snapshot();
    const res = run(() =>
      new SupplierService().settleTransactions({
        supplier_id: supplierId,
        financial_service_ids: [fsId],
        amount_usd: 52,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
        discount: { amount_usd: 2, amount_lbp: 0 },
        exchange_rate: RATE,
        created_by: 1,
      }),
    );
    expect(res).toMatchObject({ success: true });
    expect(discountRow(start.maxTxn).profit_usd).toBe(2);
    expect(num(`SELECT is_settled AS v FROM financial_services WHERE id = ?`, fsId)).toBe(1);
    voidTxn(settlementTxn(db, res.id!).id);
    // is_settled is LEFT ALONE on void for a commission-0 transfer (already
    // realized; TransactionRepository.supplierSettlementReversal.test.ts) —
    // by design, unrelated to the discount.
    expectNetsToZero(start, ["fsSettled"]);
  });

  for (const v of [
    { name: "PAY: owes 776.50, pay 774.50 + waive $2 (received)", receive: false, direction: "PAY" as const, money: 774.5, owed: 776.5, sign: 1 },
    { name: "COLLECT: OMT owes 223.50, receive 221.50 + waive $2 (given)", receive: true, direction: "COLLECT" as const, money: 221.5, owed: -223.5, sign: -1 },
  ]) {
    it(`Supplier Settle Account ${v.name}`, () => {
      const acc = omtAccount(db);
      seedTestShopOmt(db, acc, v.receive);
      const repo = new SupplierRepository();
      const owed = () =>
        r6(run(() => repo.getAccountUnsettled(acc.omtId)).reduce((s, r) => s + r.remaining_usd, 0));
      expect(owed()).toBe(v.owed);
      const start = snapshot();
      const res = run(() =>
        new SupplierService().settleAccount({
          account_supplier_id: acc.omtId,
          per_currency: {
            USD: {
              direction: v.direction,
              payments: [{ method: "CASH", currency_code: "USD", amount: v.money }],
              waive: 2,
            },
          },
          expected_owed: { usd: v.owed, lbp: 0 },
          created_by: 1,
        } as SettleAccountRequest),
      );
      expect(res).toMatchObject({ success: true });
      expect(discountRow(start.maxTxn).profit_usd).toBe(2 * v.sign);
      expect(owed()).toBe(0);
      voidTxn(settlementTxn(db, res.id!).id);
      expectNetsToZero(start);
      expect(owed()).toBe(v.owed);
    });
  }

  function partner(): { id: number; service: PartnerService } {
    const partnerRepo = new PartnerRepository();
    const service = new PartnerService(partnerRepo, new PartnerSettlementRepository());
    const id = run(() => partnerRepo.create({ name: "Baseline Partner" }).id);
    return { id, service };
  }

  /** A For sale the partner owes (profit 0, so coverage releases nothing). */
  function partnerOwes(partnerId: number, amount: number, at: string): void {
    const saleId = Number(
      db
        .prepare(
          `INSERT INTO sales (tenant_id, total_amount_usd, final_amount_usd, created_at) VALUES (1, ?, ?, ?)`,
        )
        .run(amount, amount, at).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, source_table, source_id, user_id, amount_usd, profit_usd, created_at)
       VALUES (1, 'SALE', 'sales', ?, 1, 0, 0, ?)`,
    ).run(saleId, at);
    db.prepare(
      `INSERT INTO partner_ledger (tenant_id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, created_at)
       VALUES (1, ?, 'FOR_POS', 'sales', ?, ?, 'USD', 'DEBIT', ?)`,
    ).run(partnerId, saleId, amount, at);
  }

  it("Partner by amount: partner owes $100, pays $97 + discount $3 (given)", () => {
    const p = partner();
    partnerOwes(p.id, 100, "2026-10-20 09:00:00");
    const start = snapshot();
    const entry = run(() =>
      p.service.settle({
        partnerId: p.id,
        amount: 97,
        currency: "USD",
        settlementMethod: "CASH",
        discount: { amount_usd: 3, amount_lbp: 0, reason: "baseline" },
        userId: 1,
      }),
    );
    expect(discountRow(start.maxTxn).profit_usd).toBe(-3);
    expect(run(() => p.service.getPartnerBalance(p.id)).usd).toBeCloseTo(0, 6);
    const txnId = num(
      `SELECT id AS v FROM transactions WHERE type = 'PARTNER_SETTLEMENT' AND source_table = 'partner_ledger' AND source_id = ?`,
      entry.id,
    );
    voidTxn(txnId);
    expectNetsToZero(start);
  });

  it("Partner by day: partner owes $100 on 20 Oct, PARTNER payer pays $97 + forgive $3 (given)", () => {
    const p = partner();
    partnerOwes(p.id, 100, "2026-10-20 09:00:00");
    const start = snapshot();
    const rows = run(() => p.service.getSettleOpenRows(p.id));
    const sel = buildDaySelections(rows, { pickedDays: ["2026-10-20"], untickedRows: new Set() });
    const res = run(() =>
      p.service.settleDays({
        partnerId: p.id,
        selections: sel.selections.map((s) => s.id),
        include_account_credits: true,
        credit_used: sel.credit_used,
        expected_owed: sel.expected_owed,
        per_currency: {
          USD: {
            payer: "PARTNER",
            payments: [{ method: "CASH", currency_code: "USD", amount: 97 }],
            forgive: { amount: 3 },
          },
        },
        userId: 1,
      }),
    );
    expect(res).toMatchObject({ success: true });
    expect(discountRow(start.maxTxn).profit_usd).toBe(-3);
    expect(run(() => p.service.getPartnerBalance(p.id)).usd).toBeCloseTo(0, 6);
    voidTxn(res.id!);
    expectNetsToZero(start);
  });

  it("Debt repayment: client owes $100, pays $97 + discount $3 ('Debt Discount', given)", () => {
    addClient(db, 7, "Baseline Client");
    seedChargeDebt(db, {
      clientId: 7,
      debtType: "Custom Service Debt",
      txnType: "CUSTOM_SERVICE",
      usd: 100,
      profitUsd: 0,
    });
    const start = snapshot();
    const res = run(() =>
      new DebtService(new DebtRepository()).addRepayment({
        clientId: 7,
        amountUSD: 97,
        amountLBP: 0,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 97 }],
        discount: { amount_usd: 3, amount_lbp: 0, reason: "baseline" },
        tender_exchange_rate: RATE,
        userId: 1,
      }),
    );
    expect(res).toMatchObject({ success: true });
    expect(discountRow(start.maxTxn).profit_usd).toBe(-3);
    expect(
      num(`SELECT SUM(amount_usd) AS v FROM debt_ledger WHERE client_id = 7`),
    ).toBe(0);
    const txnId = num(
      `SELECT id AS v FROM transactions WHERE type = 'DEBT_REPAYMENT' AND source_table = 'debt_ledger' AND source_id = ?`,
      res.id,
    );
    voidTxn(txnId);
    expectNetsToZero(start);
  });
});
