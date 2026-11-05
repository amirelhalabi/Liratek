/**
 * LIRA-372 (T027 + T028) — the variant table (rule 28d): every settle screen
 * × direction, with a Discount line.
 *
 * For each row:
 *   - the paid amount comes from the core screen helper the UI uses
 *     (`clampSettleDiscount`: paid = owed − applied discount, FR-010), and
 *     `settleDiscountOverpaid` is false for it;
 *   - the payload is built in the schema's own shape and `parse`d through
 *     the real core schema (rule 24), then run through the real service;
 *   - accepted; the discount's OWN COUNTERPARTY_DISCOUNT row carries the
 *     profit sign: received + (the shop pays) / given − (the shop receives);
 *   - void AND refund (each on a fresh database) net every drawer, ledger,
 *     profit, coverage and settled flag to 0 per currency (FR-007, rule 20).
 *     Settlements (SUPPLIER_SETTLEMENT / PARTNER_SETTLEMENT) refund with NO
 *     override, and an override is refused (LIRA-373);
 *   - $5.01 and 450,001 LBP are refused by the schema on every row.
 * T028 (FR-008): the discount and its reason are readable from the
 * counterparty's history read (the same service method the Suppliers /
 * Partners / Debts history panels call) and from the discount
 * transaction's details (metadata_json.details).
 *
 * The on-screen fill itself is covered by each screen's jsdom test (core
 * cannot import the MultiPaymentInput).
 *
 * Rule 17: not proven failing-first — most of the code it covers landed
 * before this file (T004–T018, T025). Any row that failed on the code as it
 * stood when written is named in the LIRA-372 report.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../db/tenantContext";
import {
  buildDb,
  fundDrawer,
  omtAccount,
  seedOmtSend,
  settlementTxn,
  type OmtAccount,
} from "../repositories/testHelpers/omtAccountDb";
import { seedTestShopOmt } from "../repositories/testHelpers/omtTestShop";
import { addClient, seedChargeDebt, RATE } from "../repositories/testHelpers/debtItemDb";
import { expectPostings, snapshotLedgers } from "../repositories/testHelpers/postingAssert";
import { resetSupplierRepository, type SettleAccountRequest } from "../repositories/SupplierRepository";
import { getTransactionRepository, resetTransactionRepository } from "../repositories/TransactionRepository";
import { resetFinancialServiceRepository } from "../repositories/FinancialServiceRepository";
import { resetPaymentMethodRepository } from "../repositories/PaymentMethodRepository";
import { resetSettingsRepository } from "../repositories/SettingsRepository";
import { resetRateRepository } from "../repositories/RateRepository";
import { resetProfitRepository } from "../repositories/ProfitRepository";
import { PartnerRepository, resetPartnerRepository } from "../repositories/PartnerRepository";
import {
  PartnerSettlementRepository,
  resetPartnerSettlementRepository,
} from "../repositories/PartnerSettlementRepository";
import { resetSalesRepository } from "../repositories/SalesRepository";
import { resetClientRepository } from "../repositories/ClientRepository";
import { DebtRepository } from "../repositories/DebtRepository";
import { resetSessionPaymentRepository } from "../repositories/SessionPaymentRepository";
import { resetCustomerSessionRepository } from "../repositories/CustomerSessionRepository";
import { resetSettingsService } from "../services/SettingsService";
import { resetSessionPaymentService } from "../services/SessionPaymentService";
import { SupplierService } from "../services/SupplierService";
import { PartnerService } from "../services/PartnerService";
import { DebtService } from "../services/DebtService";
import { buildDaySelections } from "../utils/settleDaySelections";
import { clampSettleDiscount, settleDiscountOverpaid } from "../utils/settleDiscount";
import { addRepaymentSchema } from "../validators/debt";
import {
  supplierCashflowSchema,
  supplierSettleAccountSchema,
  supplierSettleSchema,
} from "../validators/supplier";
import { partnerSettleDaysSchema, partnerSettleSchema } from "../validators/partner";

const UTC = { clientTzOffsetMinutes: 0 };
const REASON = "rounded with them";
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
type Ccy = "USD" | "LBP";

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

// ── snapshots ───────────────────────────────────────────────────────────────

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
    owedShares: num(
      `SELECT SUM(amount) AS v FROM omt_owed_shares WHERE is_reversed = 0 AND cleared_settlement_txn_id IS NULL`,
    ),
  };
}
type Side = ReturnType<typeof sideState>;

function snapshot() {
  return {
    ledgers: snapshotLedgers(db),
    side: sideState(),
    maxTxn: num(`SELECT MAX(id) AS v FROM transactions`),
  };
}
type Snap = ReturnType<typeof snapshot>;

function expectNetsToZero(start: Snap, ignore: Array<keyof Side> = []): void {
  expectPostings(start.ledgers, snapshotLedgers(db), {});
  const now: Partial<Side> = { ...sideState() };
  const was: Partial<Side> = { ...start.side };
  for (const k of ignore) {
    delete now[k];
    delete was[k];
  }
  expect(now).toEqual(was);
}

/** The discount transactions booked since `since` (originals only). */
function discountTxns(since: number) {
  return (
    db
      .prepare(
        `SELECT id, profit_usd, profit_lbp, metadata_json FROM transactions
          WHERE type = 'COUNTERPARTY_DISCOUNT' AND id > ? AND reverses_id IS NULL`,
      )
      .all(since) as Array<{
      id: number;
      profit_usd: number;
      profit_lbp: number;
      metadata_json: string;
    }>
  ).map((t) => ({ ...t, meta: JSON.parse(t.metadata_json) }));
}

/** FR-010: the paid amount the screen fills = owed − applied discount. */
function fill(currency: Ccy, owed: number, typed: number) {
  const { applied } = clampSettleDiscount(currency, typed, owed);
  const paid = currency === "USD" ? r6(owed - applied) : owed - applied;
  expect(settleDiscountOverpaid(currency, owed, paid, applied)).toBe(false);
  return { paid, applied };
}

// ── row definitions ─────────────────────────────────────────────────────────

interface Booked {
  /** The parent transaction a void / refund targets. */
  txnId: number;
  /** The discount reasons the counterparty's history read shows. */
  history: () => Array<string | null>;
}

interface Row {
  name: string;
  /** +1 received (the shop pays), −1 given (the shop receives). */
  sign: 1 | -1;
  currency: Ccy;
  discount: number;
  settlement: boolean;
  ignore?: Array<keyof Side>;
  seed: () => void;
  book: () => Booked;
  /** The schema accepts / refuses a discount of `amount` in `currency`. */
  capParse: (currency: Ccy, amount: number) => boolean;
}

// Debts ----------------------------------------------------------------------

function seedDebt(): void {
  addClient(db, 7, "Variant Client");
  seedChargeDebt(db, {
    clientId: 7,
    debtType: "Custom Service Debt",
    txnType: "CUSTOM_SERVICE",
    usd: 60,
    profitUsd: 0,
  });
  seedChargeDebt(db, {
    clientId: 7,
    debtType: "Custom Service Debt",
    txnType: "CUSTOM_SERVICE",
    usd: 40,
    profitUsd: 0,
  });
}

function debtPayload(calendar: boolean, currency: Ccy, discount: number, paid: number) {
  const items = run(() => new DebtService(new DebtRepository()).getOpenDebtItems(7));
  const owedUsd = r6(items.reduce((s, i) => s + i.openUsd, 0));
  return {
    clientId: 7,
    amountUSD: paid,
    amountLBP: 0,
    payments: [{ method: "CASH", currencyCode: "USD", amount: paid }],
    discount: {
      amount_usd: currency === "USD" ? discount : 0,
      amount_lbp: currency === "LBP" ? discount : 0,
      reason: REASON,
    },
    targets: items.map((i) => ({ kind: i.kind, id: i.id })),
    ...(calendar ? { expectedOwed: { usd: owedUsd, lbp: 0 } } : {}),
    tender_exchange_rate: RATE,
  };
}

function debtRow(calendar: boolean): Row {
  return {
    name: `Debts Repay (${calendar ? "calendar" : "picker"}) · shop receives`,
    sign: -1,
    currency: "USD",
    discount: 5,
    settlement: false,
    seed: seedDebt,
    book: () => {
      const { paid, applied } = fill("USD", 100, 5);
      const parsed = addRepaymentSchema.parse(debtPayload(calendar, "USD", applied, paid));
      const service = new DebtService(new DebtRepository());
      const res = run(() => service.addRepayment({ ...parsed, userId: 1 }));
      expect(res).toMatchObject({ success: true });
      expect(num(`SELECT SUM(amount_usd) AS v FROM debt_ledger WHERE client_id = 7`)).toBe(0);
      return {
        txnId: num(
          `SELECT id AS v FROM transactions WHERE type = 'DEBT_REPAYMENT' AND source_table = 'debt_ledger' AND source_id = ?`,
          res.id,
        ),
        history: () =>
          run(() => service.getClientHistory(7))
            .filter((e) => e.transaction_type === "Debt Discount")
            .map((e) => e.note ?? null),
      };
    },
    capParse: (c, amount) =>
      addRepaymentSchema.safeParse(debtPayload(calendar, c, amount, 95)).success,
  };
}

// Supplier Pay / Receive -------------------------------------------------------

let plainSupplierId = 0;
function seedPlainSupplier(balanceUsd: number): void {
  plainSupplierId = Number(
    db
      .prepare(
        `INSERT INTO suppliers (tenant_id, name, is_active, is_system) VALUES (1, 'Variant Supplier', 1, 0)`,
      )
      .run().lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO supplier_ledger (tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, created_by)
     VALUES (1, ?, 'ADJUSTMENT', ?, 0, 1)`,
  ).run(plainSupplierId, balanceUsd);
  if (balanceUsd > 0) {
    db.prepare(
      `INSERT INTO supplier_purchases (tenant_id, supplier_id, total_usd, paid_usd, created_by) VALUES (1, ?, ?, 0, 1)`,
    ).run(plainSupplierId, balanceUsd);
  }
}

function cashflowPayload(direction: "PAY" | "RECEIVE", c: Ccy, discount: number, paid: number) {
  return {
    supplier_id: plainSupplierId,
    direction,
    payments: [{ method: "CASH", currency_code: "USD", amount: paid }],
    discount: {
      amount_usd: c === "USD" ? discount : 0,
      amount_lbp: c === "LBP" ? discount : 0,
      reason: REASON,
    },
    exchange_rate: RATE,
  };
}

function supplierLedgerReasons(supplierId: number): () => Array<string | null> {
  return () =>
    run(() => new SupplierService().getSupplierLedger(supplierId))
      .filter((e) => e.entry_type === "DISCOUNT")
      .map((e) => e.note ?? null);
}

function cashflowRow(direction: "PAY" | "RECEIVE"): Row {
  return {
    name: `Supplier ${direction === "PAY" ? "Pay · shop pays" : "Receive · shop receives"}`,
    sign: direction === "PAY" ? 1 : -1,
    currency: "USD",
    discount: 5,
    settlement: false,
    seed: () => seedPlainSupplier(direction === "PAY" ? 100 : -100),
    book: () => {
      const { paid, applied } = fill("USD", 100, 5);
      const parsed = supplierCashflowSchema.parse(cashflowPayload(direction, "USD", applied, paid));
      const res = run(() => new SupplierService().recordSupplierCashflow({ ...parsed, created_by: 1 }));
      expect(res).toMatchObject({ success: true });
      return {
        txnId: num(
          `SELECT id AS v FROM transactions WHERE type = 'SUPPLIER_PAYMENT' AND source_table = 'supplier_ledger' AND source_id = ?`,
          res.id,
        ),
        history: supplierLedgerReasons(plainSupplierId),
      };
    },
    capParse: (c, amount) =>
      supplierCashflowSchema.safeParse(cashflowPayload(direction, c, amount, 95)).success,
  };
}

// Supplier batch Settle --------------------------------------------------------

const BATCH_PROVIDER = "LIRA372VAR";
let batchSupplierId = 0;
let batchFsId = 0;
function seedBatch(owed: number, bills = false): void {
  db.prepare(
    `INSERT OR IGNORE INTO service_providers (tenant_id, code, label, drawer_name) VALUES (1, ?, 'Variant Provider', 'General')`,
  ).run(BATCH_PROVIDER);
  batchSupplierId = Number(
    db
      .prepare(
        `INSERT INTO suppliers (tenant_id, name, provider, is_active, is_system) VALUES (1, 'Batch Supplier', ?, 1, 0)`,
      )
      .run(BATCH_PROVIDER).lastInsertRowid,
  );
  if (owed) {
    db.prepare(
      `INSERT INTO supplier_ledger (tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, created_by)
       VALUES (1, ?, 'TOP_UP', ?, 0, 1)`,
    ).run(batchSupplierId, owed);
  }
  batchFsId = Number(
    db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, service_type, amount, currency, commission, commission_model, is_settled)
         VALUES (1, ?, ?, ?, 'USD', 0, ?, 0)`,
      )
      .run(BATCH_PROVIDER, bills ? "BILL" : "SEND", owed || 10, bills ? 1 : 0).lastInsertRowid,
  );
}

function batchPayload(c: Ccy, discount: number, paid: number) {
  return {
    supplier_id: batchSupplierId,
    financial_service_ids: [batchFsId],
    amount_usd: 100,
    amount_lbp: 0,
    commission_usd: 0,
    commission_lbp: 0,
    payments: [{ method: "CASH", currency_code: "USD", amount: paid }],
    discount: {
      amount_usd: c === "USD" ? discount : 0,
      amount_lbp: c === "LBP" ? discount : 0,
      reason: REASON,
    },
    exchange_rate: RATE,
  };
}

const batchRow: Row = {
  name: "Supplier batch Settle · shop pays",
  sign: 1,
  currency: "USD",
  discount: 5,
  settlement: true,
  // A commission-0 transfer keeps is_settled on void by design
  // (TransactionRepository.supplierSettlementReversal.test.ts).
  ignore: ["fsSettled"],
  seed: () => seedBatch(100),
  book: () => {
    const { paid, applied } = fill("USD", 100, 5);
    const parsed = supplierSettleSchema.parse(batchPayload("USD", applied, paid));
    const res = run(() => new SupplierService().settleTransactions({ ...parsed, created_by: 1 }));
    expect(res).toMatchObject({ success: true });
    return {
      txnId: settlementTxn(db, res.id!).id,
      history: supplierLedgerReasons(batchSupplierId),
    };
  },
  capParse: (c, amount) => supplierSettleSchema.safeParse(batchPayload(c, amount, 95)).success,
};

// Supplier Settle Account (OMT, SMS amount) ------------------------------------

let acc: OmtAccount;
function accountOwedUsd(): number {
  return r6(
    run(() => new SupplierService().getAccountUnsettled(acc.omtId)).reduce(
      (s, r) => s + r.remaining_usd,
      0,
    ),
  );
}

function accountPayload(
  direction: "PAY" | "COLLECT",
  c: Ccy,
  waive: number,
  paid: number,
  sms: number,
  owed: number,
) {
  return {
    account_supplier_id: acc.omtId,
    per_currency: {
      [c]: {
        direction,
        payments: [{ method: "CASH", currency_code: c, amount: paid }],
        ...(c === "USD" ? { sms_amount: sms } : {}),
        waive,
      },
    },
    expected_owed: { usd: owed, lbp: 0 },
    discount_reason: REASON,
  };
}

function accountRow(direction: "PAY" | "COLLECT"): Row {
  // PAY: owed 776.50, SMS 772.30 (commission 4.20) → discount 2.30, pay 770.
  // COLLECT: owed −223.50, SMS −229.70 (commission 6.20) → discount 1.70, receive 228.
  const sms = direction === "PAY" ? 772.3 : 229.7;
  const typed = direction === "PAY" ? 2.3 : 1.7;
  return {
    name: `Supplier Settle Account (OMT SMS) · ${direction === "PAY" ? "shop pays" : "shop receives"}`,
    sign: direction === "PAY" ? 1 : -1,
    currency: "USD",
    discount: typed,
    settlement: true,
    seed: () => {
      acc = omtAccount(db);
      seedTestShopOmt(db, acc, direction === "COLLECT");
    },
    book: () => {
      const owed = accountOwedUsd();
      const { paid, applied } = fill("USD", sms, typed);
      const parsed = supplierSettleAccountSchema.parse(
        accountPayload(direction, "USD", applied, paid, direction === "PAY" ? sms : -sms, owed),
      );
      const res = run(() =>
        new SupplierService().settleAccount({ ...parsed, created_by: 1 } as SettleAccountRequest),
      );
      expect(res).toMatchObject({ success: true });
      const txn = settlementTxn(db, res.id!);
      // FR-006: the commission is the SMS figure's, unchanged by the discount.
      expect(r6(txn.profit_usd)).toBe(direction === "PAY" ? 4.2 : 6.2);
      expect(accountOwedUsd()).toBe(0);
      return {
        txnId: txn.id,
        history: () =>
          run(() => new SupplierService().getAccountLedger(acc.omtId))
            .filter((e) => e.entry_type === "DISCOUNT")
            .map((e) => e.note ?? null),
      };
    },
    capParse: (c, amount) =>
      supplierSettleAccountSchema.safeParse(accountPayload(direction, c, amount, 100, 100, 100))
        .success,
  };
}

// Partners -------------------------------------------------------------------

let partnerId = 0;
let partnerService: PartnerService;
function seedPartner(direction: "DEBIT" | "CREDIT"): void {
  const repo = new PartnerRepository();
  partnerService = new PartnerService(repo, new PartnerSettlementRepository());
  partnerId = run(() => repo.create({ name: "Variant Partner" }).id);
  const type = direction === "DEBIT" ? "FOR_OMT_SEND" : "THROUGH_OMT_SEND";
  for (const [amount, at, ref] of [
    [300, "2026-10-20 10:00:00", 9001],
    [200, "2026-10-21 10:00:00", 9002],
  ] as const) {
    db.prepare(
      `INSERT INTO partner_ledger
         (tenant_id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, created_at)
       VALUES (1, ?, ?, 'financial_services', ?, ?, 'USD', ?, ?)`,
    ).run(partnerId, type, ref, amount, direction, at);
  }
}

const partnerReasons = () => () =>
  run(() => partnerService.getPartnerStatement(partnerId))
    .entries.filter((e) => e.transaction_type === "DISCOUNT")
    .map((e) => e.notes ?? null);

function byDayPayload(payer: "SHOP" | "PARTNER", c: Ccy, forgive: number, paid: number) {
  const sel = buildDaySelections(run(() => partnerService.getSettleOpenRows(partnerId)), {
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
      [c]: {
        payer,
        payments: [{ method: "CASH", currency_code: c, amount: paid }],
        forgive: { amount: forgive, reason: REASON },
      },
    },
  };
}

function byDayRow(payer: "SHOP" | "PARTNER"): Row {
  return {
    name: `Partner settle by day · ${payer === "SHOP" ? "shop pays" : "shop receives"}`,
    sign: payer === "SHOP" ? 1 : -1,
    currency: "USD",
    discount: 5,
    settlement: true,
    seed: () => seedPartner(payer === "SHOP" ? "CREDIT" : "DEBIT"),
    book: () => {
      const { paid, applied } = fill("USD", 500, 5);
      const parsed = partnerSettleDaysSchema.parse(byDayPayload(payer, "USD", applied, paid));
      const res = run(() => partnerService.settleDays({ ...parsed, userId: 1 }));
      expect(res).toMatchObject({ success: true });
      expect(r6(run(() => partnerService.getPartnerBalance(partnerId)).usd)).toBe(0);
      return { txnId: res.id!, history: partnerReasons() };
    },
    capParse: (c, amount) =>
      partnerSettleDaysSchema.safeParse(byDayPayload(payer, c, amount, 100)).success,
  };
}

function byAmountPayload(c: Ccy, discount: number, paid: number) {
  return {
    partnerId,
    amount: paid,
    currency: c,
    settlementMethod: "CASH",
    payments: [{ method: "CASH", currency_code: c, amount: paid }],
    discount: {
      amount_usd: c === "USD" ? discount : 0,
      amount_lbp: c === "LBP" ? discount : 0,
      reason: REASON,
    },
  };
}

function byAmountRow(shopPays: boolean): Row {
  return {
    name: `Partner settle by amount · ${shopPays ? "shop pays" : "shop receives"}`,
    sign: shopPays ? 1 : -1,
    currency: "USD",
    discount: 5,
    settlement: true,
    seed: () => seedPartner(shopPays ? "CREDIT" : "DEBIT"),
    book: () => {
      const { paid, applied } = fill("USD", 500, 5);
      const parsed = partnerSettleSchema.parse(byAmountPayload("USD", applied, paid));
      const entry = run(() => partnerService.settle({ ...parsed, userId: 1 }));
      expect(r6(run(() => partnerService.getPartnerBalance(partnerId)).usd)).toBe(0);
      return {
        txnId: num(
          `SELECT id AS v FROM transactions WHERE type = 'PARTNER_SETTLEMENT' AND source_table = 'partner_ledger' AND source_id = ?`,
          entry.id,
        ),
        history: partnerReasons(),
      };
    },
    capParse: (c, amount) => partnerSettleSchema.safeParse(byAmountPayload(c, amount, 100)).success,
  };
}

const ROWS: Row[] = [
  debtRow(false),
  debtRow(true),
  cashflowRow("PAY"),
  cashflowRow("RECEIVE"),
  batchRow,
  accountRow("PAY"),
  accountRow("COLLECT"),
  byDayRow("SHOP"),
  byDayRow("PARTNER"),
  byAmountRow(true),
  byAmountRow(false),
];

// ── T027 — book, check, reverse ──────────────────────────────────────────────

describe("LIRA-372 T027 — settle discount variant table", () => {
  const cases = ROWS.flatMap((row) =>
    (["void", "refund"] as const).map((reverse) => ({ row, reverse, label: `${row.name} · ${reverse}` })),
  );

  it.each(cases)("$label", ({ row, reverse }) => {
    row.seed();
    const start = snapshot();
    const booked = row.book();

    const discounts = discountTxns(start.maxTxn);
    expect(discounts).toHaveLength(1);
    const profit = row.currency === "USD" ? discounts[0].profit_usd : discounts[0].profit_lbp;
    expect(r6(profit)).toBe(r6(row.sign * row.discount));

    const txRepo = getTransactionRepository();
    if (reverse === "void") {
      run(() => txRepo.voidTransaction(booked.txnId, 1));
    } else {
      if (row.settlement) {
        // LIRA-373: a settlement refunds exactly as made — an override is refused.
        expect(() =>
          run(() =>
            txRepo.refundTransaction(booked.txnId, 1, {
              refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 1 }],
              exchangeRate: RATE,
            }),
          ),
        ).toThrow(/refunded exactly as it was made/i);
      }
      run(() => txRepo.refundTransaction(booked.txnId, 1));
    }
    expectNetsToZero(start, row.ignore);
  });

  it.each(ROWS.map((row) => ({ row, label: row.name })))(
    "$label · the schema refuses $5.01 and 450,001 LBP, accepts $5 and 450,000 LBP",
    ({ row }) => {
      row.seed();
      expect(row.capParse("USD", 5.01)).toBe(false);
      expect(row.capParse("LBP", 450_001)).toBe(false);
      expect(row.capParse("USD", 5)).toBe(true);
      expect(row.capParse("LBP", 450_000)).toBe(true);
    },
  );

  it("Supplier batch Settle · shop receives: no line; a hand-built bills-only payload with a discount is refused, nothing written", () => {
    seedBatch(0, true);
    const start = snapshot();
    const parsed = supplierSettleSchema.parse({
      supplier_id: batchSupplierId,
      financial_service_ids: [batchFsId],
      amount_usd: 0,
      amount_lbp: 0,
      commission_usd: 2,
      commission_lbp: 0,
      discount: { amount_usd: 1, amount_lbp: 0, reason: REASON },
    });
    const res = run(() => new SupplierService().settleTransactions({ ...parsed, created_by: 1 }));
    expect(res.success).toBe(false);
    expectNetsToZero(start);
  });

  describe("5x — Settle Account, sections going opposite ways (FR-011)", () => {
    beforeEach(() => {
      acc = omtAccount(db);
      // OMT owes the shop $200; the shop owes OMT 900,000 LBP.
      seedOmtSend(db, acc.omtId, { amount: 200, service_type: "RECEIVE", created_at: "2026-10-01 01:00:00" });
      seedOmtSend(db, acc.omtId, { amount: 900_000, currency: "LBP", created_at: "2026-10-01 02:00:00" });
    });

    const payload = (usdWaive: number, lbpWaive: number) => ({
      account_supplier_id: acc.omtId,
      per_currency: {
        USD: {
          direction: "COLLECT" as const,
          payments: [{ method: "CASH", currency_code: "USD", amount: 200 - usdWaive }],
          ...(usdWaive ? { waive: usdWaive } : {}),
        },
        LBP: {
          direction: "PAY" as const,
          payments: [{ method: "CASH", currency_code: "LBP", amount: 900_000 - lbpWaive }],
          ...(lbpWaive ? { waive: lbpWaive } : {}),
        },
      },
      expected_owed: { usd: -200, lbp: 900_000 },
      exchange_rate: RATE,
      discount_reason: REASON,
    });

    it.each(["void", "refund"] as const)(
      "a discount on one currency (USD $2) is accepted, booked given; %s nets to 0",
      (reverse) => {
        const start = snapshot();
        const parsed = supplierSettleAccountSchema.parse(payload(2, 0));
        const res = run(() =>
          new SupplierService().settleAccount({ ...parsed, created_by: 1 } as SettleAccountRequest),
        );
        expect(res).toMatchObject({ success: true });
        const d = discountTxns(start.maxTxn);
        expect(d).toHaveLength(1);
        expect(r6(d[0].profit_usd)).toBe(-2);
        const txnId = settlementTxn(db, res.id!).id;
        const txRepo = getTransactionRepository();
        if (reverse === "void") run(() => txRepo.voidTransaction(txnId, 1));
        else run(() => txRepo.refundTransaction(txnId, 1));
        expectNetsToZero(start);
      },
    );

    it("a discount on both currencies is refused with today's message, nothing written", () => {
      const start = snapshot();
      const parsed = supplierSettleAccountSchema.parse(payload(2, 100_000));
      const res = run(() =>
        new SupplierService().settleAccount({ ...parsed, created_by: 1 } as SettleAccountRequest),
      );
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/pay OMT in one currency and collect/i);
      expectNetsToZero(start);
    });
  });
});

// ── T028 — FR-008: the discount and its reason are readable ─────────────────

describe("LIRA-372 T028 — the discount and its reason show in history and details (FR-008)", () => {
  it.each(ROWS.map((row) => ({ row, label: row.name })))("$label", ({ row }) => {
    row.seed();
    const start = snapshot();
    const booked = row.book();
    // The counterparty's Payments history read: one DISCOUNT row, its note.
    expect(booked.history()).toEqual([REASON]);
    // The discount transaction's details (what the details panel renders:
    // metadata_json.details — the reason as typed).
    const [d] = discountTxns(start.maxTxn);
    expect(JSON.stringify(d.meta.details ?? {})).toContain(REASON);
  });
});
