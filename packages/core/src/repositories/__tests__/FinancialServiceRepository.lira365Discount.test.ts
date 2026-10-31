/**
 * LIRA-365 US1 — a discount on a walk-in OMT/Whish system SEND.
 *
 * The rule (spec FR-002/FR-003/FR-007, research R3): the discount is its own
 * field (`discount_amount`, in the send's currency). It lowers what the
 * customer's legs must cover — and so what lands in the drawer — but never
 * the provider fee, the commission or what is owed to OMT/Whish. The shop
 * books it as ONE books-only, auto, linked "Discount given" expense. A void
 * or refund puts every ledger back and voids the expense (rule 20).
 *
 * Twins: the same send with and without the discount, so each assertion is
 * "differs by exactly the discount, and only where it should".
 *
 * Real production schema (create_db.sql + migrations, shop_base_system =
 * OMT); nothing is mocked. Payloads are typed as the schema's input and
 * parsed through it (rule 24).
 *
 * Rule 17: written before the repository change; it must fail first.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  FinancialServiceRepository,
  resetFinancialServiceRepository,
  type CreateFinancialServiceData,
} from "../FinancialServiceRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetDebtService } from "../../services/DebtService";
import { resetClientRepository } from "../ClientRepository";
import { resetExpenseRepository } from "../ExpenseRepository";
import {
  createFinancialServiceSchema,
  type CreateFinancialServicePayload,
} from "../../validators/financial";
import {
  DISCOUNT_ABOVE_CAP_MESSAGE,
  DISCOUNT_ABOVE_TOTAL_MESSAGE,
  DISCOUNT_GIVEN_EXPENSE_CATEGORY,
  DISCOUNT_NEEDS_PAYMENTS_MESSAGE,
  DISCOUNT_NOT_ALLOWED_MESSAGE,
} from "../../validators/discount";
import {
  snapshotLedgers,
  ledgerDeltas,
  expectPostings,
  type LedgerSnapshot,
} from "../testHelpers/postingAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL = fs.readFileSync(
  path.join(REPO_ROOT, "electron-app/create_db.sql"),
  "utf-8",
);
const RATE = 89_500;

let db: Database.Database;
let repo: FinancialServiceRepository;

function resetAll(): void {
  resetFinancialServiceRepository();
  resetTransactionRepository();
  resetSupplierRepository();
  resetPartnerRepository();
  resetDebtRepository();
  resetDebtService();
  resetClientRepository();
  resetExpenseRepository();
}

beforeEach(() => {
  resetAll();
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  initDatabase(db);
  runMigrations(db);
  initFixedTenantContext(1);
  const seed = db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  for (const [d, c, b] of [
    ["General", "USD", 10_000],
    ["General", "LBP", 900_000_000],
    ["OMT_System", "USD", 10_000],
    ["OMT_System", "LBP", 900_000_000],
  ] as const)
    seed.run(d, c, b);
  repo = new FinancialServiceRepository();
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  db.close();
});

function parse(p: CreateFinancialServicePayload): CreateFinancialServiceData {
  return createFinancialServiceSchema.parse(p) as CreateFinancialServiceData;
}

function create(p: CreateFinancialServicePayload): number {
  return repo.createTransaction({ exchangeRate: RATE, ...parse(p) }).id;
}

/** Straight to the repository, skipping Zod (offline replay does). */
function createRaw(p: CreateFinancialServicePayload): number {
  return repo.createTransaction({
    exchangeRate: RATE,
    ...(p as CreateFinancialServiceData),
  }).id;
}

function txnOf(fsId: number): {
  id: number;
  profit_usd: number;
  profit_lbp: number;
  metadata_json: string | null;
} {
  return db
    .prepare(
      `SELECT id, profit_usd, profit_lbp, metadata_json FROM transactions
        WHERE source_table = 'financial_services' AND source_id = ? AND reverses_id IS NULL`,
    )
    .get(fsId) as {
    id: number;
    profit_usd: number;
    profit_lbp: number;
    metadata_json: string | null;
  };
}

function fsRow(fsId: number) {
  return db
    .prepare(
      `SELECT amount, commission, omt_fee, whish_fee FROM financial_services WHERE id = ?`,
    )
    .get(fsId);
}

type ExpenseRow = {
  id: number;
  category: string;
  amount_usd: number;
  amount_lbp: number;
  source_ref_table: string;
  source_ref_id: number;
};

function discountExpenses(fsId: number): ExpenseRow[] {
  return db
    .prepare(
      `SELECT id, category, amount_usd, amount_lbp, source_ref_table, source_ref_id
         FROM expenses WHERE source_ref_table = 'financial_services' AND source_ref_id = ?`,
    )
    .all(fsId) as ExpenseRow[];
}

function expenseTxnStatus(expenseId: number): string {
  return (
    db
      .prepare(
        `SELECT status FROM transactions WHERE source_table = 'expenses' AND source_id = ? AND reverses_id IS NULL`,
      )
      .get(expenseId) as { status: string }
  ).status;
}

function countTxns(): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get() as { n: number }
  ).n;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function round(map: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) {
    const r = r2(v);
    if (r !== 0) out[k] = r;
  }
  return out;
}

function runOnce(p: CreateFinancialServicePayload) {
  const before: LedgerSnapshot = snapshotLedgers(db);
  const fsId = create(p);
  const deltas = ledgerDeltas(before, snapshotLedgers(db));
  return { before, fsId, deltas, txn: txnOf(fsId) };
}

function expectRefused(
  p: CreateFinancialServicePayload,
  message: string,
): void {
  // Schema (both transports) …
  const parsed = createFinancialServiceSchema.safeParse(p);
  expect(parsed.success).toBe(false);
  if (!parsed.success) {
    expect(parsed.error.issues.map((i) => i.message)).toContain(message);
  }
  // … and the repository (offline replay skips Zod).
  const before = snapshotLedgers(db);
  const n = countTxns();
  expect(() => createRaw(p)).toThrow(message);
  expect(countTxns()).toBe(n);
  expectPostings(before, snapshotLedgers(db), {});
}

// Western Union $400 + $15 fee (the owner's example).
const wuSend: CreateFinancialServicePayload = {
  provider: "OMT",
  serviceType: "SEND",
  omtServiceType: "WESTERN_UNION",
  amount: 400,
  currency: "USD",
  omtFee: 15,
  tender_exchange_rate: RATE,
};

describe("LIRA-365 — OMT system SEND with a discount", () => {
  it("$400 + $15 − $2, cash $413 → drawer +413, OMT owed 415, one $2 'Discount given' expense", () => {
    const a = runOnce({
      ...wuSend,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 415 }],
    });
    const b = runOnce({
      ...wuSend,
      discount_amount: 2,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 413 }],
    });

    // Drawer: exactly $2 less than the undiscounted twin.
    expect(r2(b.deltas.drawers["OMT_System|USD"] ?? 0)).toBe(413);
    expect(r2(a.deltas.drawers["OMT_System|USD"] ?? 0)).toBe(415);
    // What is owed to OMT, the fee and the commission are untouched.
    expect(round(b.deltas.supplier)).toEqual(round(a.deltas.supplier));
    expect(fsRow(b.fsId)).toEqual(fsRow(a.fsId));
    expect(r2(b.txn.profit_usd)).toBe(r2(a.txn.profit_usd));

    // One books-only, auto, linked expense for the discount.
    const exp = discountExpenses(b.fsId);
    expect(exp).toHaveLength(1);
    expect(exp[0]).toMatchObject({
      category: DISCOUNT_GIVEN_EXPENSE_CATEGORY,
      amount_usd: 2,
      amount_lbp: 0,
    });
    expect(discountExpenses(a.fsId)).toHaveLength(0);

    // The details show the discount (FR-010).
    const details = JSON.parse(b.txn.metadata_json ?? "{}").details;
    expect(details.discount).toEqual({ amount: 2, currency: "USD" });
  });

  it("LBP send: a 450,000 LBP discount (the cap) is accepted", () => {
    const b = runOnce({
      provider: "OMT",
      serviceType: "SEND",
      omtServiceType: "INTRA",
      amount: 9_000_000,
      currency: "LBP",
      omtFee: 300_000,
      tender_exchange_rate: RATE,
      discount_amount: 450_000,
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 8_850_000 }],
    });
    expect(Math.round(b.deltas.drawers["OMT_System|LBP"] ?? 0)).toBe(
      8_850_000,
    );
    expect(discountExpenses(b.fsId)[0]).toMatchObject({
      amount_usd: 0,
      amount_lbp: 450_000,
    });
  });

  it("void: drawer, supplier ledger and the expense all go back (rule 20)", () => {
    const before = snapshotLedgers(db);
    const fsId = create({
      ...wuSend,
      discount_amount: 2,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 413 }],
    });
    const expenseId = discountExpenses(fsId)[0]!.id;
    getTransactionRepository().voidTransaction(txnOf(fsId).id, 1);
    expectPostings(before, snapshotLedgers(db), {});
    expect(expenseTxnStatus(expenseId)).toBe("VOIDED");
  });

  it("refund: the customer gets back $413 and the expense is voided", () => {
    const before = snapshotLedgers(db);
    const fsId = create({
      ...wuSend,
      discount_amount: 2,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 413 }],
    });
    const expenseId = discountExpenses(fsId)[0]!.id;
    getTransactionRepository().refundTransaction(txnOf(fsId).id, 1);
    expectPostings(before, snapshotLedgers(db), {});
    expect(expenseTxnStatus(expenseId)).toBe("VOIDED");
  });

  it("part on the customer's account: the debt is the discounted unpaid part", () => {
    const clientId = Number(
      db
        .prepare(
          `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Rami', '03111222')`,
        )
        .run().lastInsertRowid,
    );
    const b = runOnce({
      ...wuSend,
      discount_amount: 2,
      clientId,
      clientName: "Rami",
      phoneNumber: "03111222",
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 400 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 13 },
      ],
    });
    expect(r2(b.deltas.drawers["OMT_System|USD"] ?? 0)).toBe(400);
    expect(r2(b.deltas.debt[`${clientId}|USD`] ?? 0)).toBe(13);
  });
});

describe("LIRA-365 — where a discount is refused", () => {
  const paid = (amount: number) => [
    { method: "CASH", currencyCode: "USD", amount },
  ];

  it("above $5", () => {
    expectRefused(
      { ...wuSend, discount_amount: 6, payments: paid(409) },
      DISCOUNT_ABOVE_CAP_MESSAGE,
    );
  });

  it("above 450,000 LBP", () => {
    expectRefused(
      {
        provider: "OMT",
        serviceType: "SEND",
        omtServiceType: "INTRA",
        amount: 9_000_000,
        currency: "LBP",
        omtFee: 300_000,
        discount_amount: 500_000,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 8_800_000 }],
      },
      DISCOUNT_ABOVE_CAP_MESSAGE,
    );
  });

  it("on a RECEIVE", () => {
    expectRefused(
      {
        provider: "OMT",
        serviceType: "RECEIVE",
        omtServiceType: "WESTERN_UNION",
        amount: 400,
        currency: "USD",
        omtFee: 15,
        discount_amount: 2,
        payments: paid(400),
      },
      DISCOUNT_NOT_ALLOWED_MESSAGE,
    );
  });

  it("for a partner (FOR)", () => {
    const partnerId = Number(
      db
        .prepare(`INSERT INTO partners (tenant_id, name) VALUES (1, 'P1')`)
        .run().lastInsertRowid,
    );
    expectRefused(
      {
        ...wuSend,
        partnerId,
        partnerMode: "FOR",
        discount_amount: 2,
        payments: paid(413),
      },
      DISCOUNT_NOT_ALLOWED_MESSAGE,
    );
  });

  it("in a customer session (deferPayment)", () => {
    expectRefused(
      { ...wuSend, deferPayment: true, discount_amount: 2 },
      DISCOUNT_NOT_ALLOWED_MESSAGE,
    );
  });

  it("on an app transfer (OMT_APP)", () => {
    expectRefused(
      {
        provider: "OMT_APP",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        discount_amount: 1,
        payments: paid(99),
      },
      DISCOUNT_NOT_ALLOWED_MESSAGE,
    );
  });

  it("without payment lines (legacy single payment)", () => {
    expectRefused(
      { ...wuSend, paidByMethod: "CASH", discount_amount: 2 },
      DISCOUNT_NEEDS_PAYMENTS_MESSAGE,
    );
  });

  it("discount + waive above the cap together", () => {
    expectRefused(
      {
        ...wuSend,
        discount_amount: 4,
        customer_waived_amount: 2,
        payments: paid(411),
      },
      DISCOUNT_ABOVE_CAP_MESSAGE,
    );
  });

  it("as big as the whole send", () => {
    expectRefused(
      {
        provider: "OMT",
        serviceType: "SEND",
        omtServiceType: "INTRA",
        amount: 3,
        currency: "USD",
        omtFee: 1,
        discount_amount: 4,
        payments: paid(0.01),
      },
      DISCOUNT_ABOVE_TOTAL_MESSAGE,
    );
  });
});
