/**
 * LIRA-321 T041/T043 — Binance cash-out (RECEIVE): the customer pays the
 * USDT transfer (and the fee, when paid separately) in several lines
 * (`customerPayments`), next to the unchanged payout.
 *
 * spec.md US4 — 100 USDT cash-out paid to the customer as $100 USD cash,
 * $2 fee paid separately:
 *   1. Binance 100 USDT + Cash $2           → Binance +100 USDT, USD cash −98
 *   2. Binance 80 USDT + Cash $20 + Cash $2  → Binance +80 USDT, USD cash −78
 *   3. Binance 80 USDT + Cash $2 + Account $20 → Binance +80, USD −98, owes $20
 *   4. Binance 80 USDT + Cash $2 + Account 20 USDT → owes $20 (1 USDT = $1)
 * plus the forgive case (WAIVED_SHORTFALL sibling, FR-012) and spec US5:
 * void and refund of each net every ledger, debt and profit to 0.
 *
 * The Binance line is stored with method = BINANCE in USDT on the Binance
 * drawer — exactly like today's single inflow row (research R7). Cash lines
 * are USD/LBP; a USDT cash line or a non-USDT Binance line is refused (it
 * would open a General|USDT or a Binance|USD balance).
 *
 * Real schema: `electron-app/create_db.sql` + migrations, fresh per case.
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
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetProfitRepository } from "../ProfitRepository";
import {
  getProfitService,
  resetProfitService,
} from "../../services/ProfitService";
import { createFinancialServiceSchema } from "../../validators/financial";
import { CUSTOMER_LEGS_OVERPAID_MESSAGE } from "../moneyPosting";
import {
  snapshotLedgers,
  expectPostings,
  ledgerDeltas,
} from "../testHelpers/postingAssert";
import { walletReceiveAmounts } from "../../utils/walletReceivePayout";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf-8",
);

const RATE = 89_500;
const CLIENT_ID = 1;
const FROM = "2000-01-01";
const TO = "2100-12-31";

let db: Database.Database;

function resetAll(): void {
  resetFinancialServiceRepository();
  resetTransactionRepository();
  resetSupplierRepository();
  resetPartnerRepository();
  resetDebtRepository();
  resetDebtService();
  resetClientRepository();
  resetPaymentMethodRepository();
  resetProfitRepository();
  resetProfitService();
}

beforeEach(() => {
  resetAll();
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  initDatabase(db);
  runMigrations(db);
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  db.prepare(
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (?, 1, 'Rami', '70111222')`,
  ).run(CLIENT_ID);
  const seed = db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  for (const [d, c, b] of [
    ["General", "USD", 10_000],
    ["General", "LBP", 900_000_000],
    ["Binance", "USDT", 10_000],
  ] as const)
    seed.run(d, c, b);
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

// ─── helpers ────────────────────────────────────────────────────────────────

type Line = { method: string; currencyCode: string; amount: number };
const L = (method: string, amount: number, currencyCode = "USD"): Line => ({
  method,
  currencyCode,
  amount,
});
const B = (amount: number): Line => L("BINANCE", amount, "USDT");

/** 100 USDT cash-out, $2 fee paid separately, $100 USD cash payout. */
function binanceReceive(
  over: Partial<CreateFinancialServiceData> & Record<string, unknown> = {},
): CreateFinancialServiceData {
  return {
    provider: "BINANCE",
    serviceType: "RECEIVE",
    amount: 100,
    currency: "USDT",
    commission: 2,
    includingFees: false,
    payments: [L("CASH", 100)],
    cashoutMethod: "CASH",
    feeCollectedSeparately: true,
    ...over,
  } as CreateFinancialServiceData;
}

function create(data: CreateFinancialServiceData): number {
  const r = new FinancialServiceRepository().createTransaction({
    exchangeRate: RATE,
    ...data,
  } as Parameters<FinancialServiceRepository["createTransaction"]>[0]);
  return r.id;
}

function txnOf(fsId: number): {
  id: number;
  profit_usd: number;
  profit_lbp: number;
} {
  return db
    .prepare(
      `SELECT id, profit_usd, profit_lbp FROM transactions
        WHERE source_table = 'financial_services' AND source_id = ?
          AND reverses_id IS NULL`,
    )
    .get(fsId) as { id: number; profit_usd: number; profit_lbp: number };
}

function paymentRows(txnId: number) {
  return db
    .prepare(
      `SELECT method, drawer_name, currency_code, amount FROM payments
        WHERE transaction_id = ? AND amount != 0 ORDER BY id`,
    )
    .all(txnId) as {
    method: string;
    drawer_name: string;
    currency_code: string;
    amount: number;
  }[];
}

function waivedSiblings() {
  return db
    .prepare(
      `SELECT status, profit_usd, profit_lbp, source_table, source_id, metadata_json
         FROM transactions
        WHERE type = 'WAIVED_SHORTFALL' AND reverses_id IS NULL ORDER BY id`,
    )
    .all() as {
    status: string;
    profit_usd: number;
    profit_lbp: number;
    source_table: string;
    source_id: number;
    metadata_json: string;
  }[];
}

/** Σ profit over ACTIVE transactions, per currency. */
function profit(): { usd: number; lbp: number } {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(profit_usd), 0) AS usd, COALESCE(SUM(profit_lbp), 0) AS lbp
         FROM transactions WHERE status = 'ACTIVE'`,
    )
    .get() as { usd: number; lbp: number };
  return {
    usd: Math.round(r.usd * 1e6) / 1e6,
    lbp: Math.round(r.lbp * 1e6) / 1e6,
  };
}

function openDebt(): number {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd FROM debt_ledger
        WHERE client_id = ? AND COALESCE(is_refunded, 0) = 0`,
    )
    .get(CLIENT_ID) as { usd: number };
  return Math.round(r.usd * 1e6) / 1e6;
}

// ─── spec US4 scenarios 1–4 ─────────────────────────────────────────────────

describe("Binance RECEIVE with customerPayments (spec US4)", () => {
  it("1. Binance 100 USDT + Cash $2 fee → Binance +100 USDT, USD cash −98", () => {
    const before = snapshotLedgers(db);
    create(binanceReceive({ customerPayments: [B(100), L("CASH", 2)] }));
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "Binance|USDT": 100, "General|USD": -98 },
    });
  });

  it("2. Binance 80 USDT + Cash $20 + Cash $2 fee → Binance +80 USDT, USD cash −78", () => {
    const before = snapshotLedgers(db);
    create(
      binanceReceive({
        customerPayments: [B(80), L("CASH", 20), L("CASH", 2)],
      }),
    );
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "Binance|USDT": 80, "General|USD": -78 },
    });
  });

  it("3. linked client: Binance 80 USDT + Cash $2 + Account $20 → Binance +80, USD cash −98, owes $20 (Service Debt)", () => {
    const before = snapshotLedgers(db);
    const fsId = create(
      binanceReceive({
        clientId: CLIENT_ID,
        customerPayments: [B(80), L("CASH", 2), L("CUSTOMER_ACCOUNT", 20)],
      }),
    );
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "Binance|USDT": 80, "General|USD": -98 },
      debt: { [`${CLIENT_ID}|USD`]: 20 },
    });
    const debt = db
      .prepare(
        `SELECT transaction_type, transaction_id FROM debt_ledger WHERE client_id = ?`,
      )
      .all(CLIENT_ID);
    expect(debt).toEqual([
      { transaction_type: "Service Debt", transaction_id: txnOf(fsId).id },
    ]);
  });

  it("4. an account line in USDT is owed in USD 1:1 (20 USDT → $20)", () => {
    const before = snapshotLedgers(db);
    create(
      binanceReceive({
        clientId: CLIENT_ID,
        customerPayments: [
          B(80),
          L("CASH", 2),
          L("CUSTOMER_ACCOUNT", 20, "USDT"),
        ],
      }),
    );
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "Binance|USDT": 80, "General|USD": -98 },
      debt: { [`${CLIENT_ID}|USD`]: 20 },
    });
  });

  it("forgive: Binance 98 USDT + Cash $2, $2 forgiven → Binance +98, USD −98; −$2 on the Waived line (FR-012)", () => {
    const before = snapshotLedgers(db);
    const fsId = create(
      binanceReceive({
        customerPayments: [B(98), L("CASH", 2)],
        customer_waived_amount: 2,
      }),
    );
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "Binance|USDT": 98, "General|USD": -98 },
    });
    const sib = waivedSiblings();
    expect(sib).toHaveLength(1);
    expect(sib[0]).toMatchObject({
      status: "ACTIVE",
      profit_usd: -2,
      profit_lbp: 0,
      source_table: "transactions",
      source_id: txnOf(fsId).id,
    });
    const meta = JSON.parse(sib[0].metadata_json);
    expect(meta.is_auto).toBe(true);
    expect(meta.financial_service_id).toBe(fsId);
    expect(getProfitService().getSummary(FROM, TO).waived.profit_usd).toBe(-2);
  });

  it("fee deducted (not paid separately): Binance 100 USDT alone, payout $98 → Binance +100, USD −98", () => {
    const before = snapshotLedgers(db);
    create(
      binanceReceive({
        feeCollectedSeparately: undefined,
        payments: [L("CASH", 98)],
        customerPayments: [B(100)],
      }),
    );
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "Binance|USDT": 100, "General|USD": -98 },
    });
  });

  it("an LBP cash line converts at the rate: Binance 80 USDT + 1,790,000 LBP ($20) + Cash $2", () => {
    const before = snapshotLedgers(db);
    create(
      binanceReceive({
        customerPayments: [B(80), L("CASH", 1_790_000, "LBP"), L("CASH", 2)],
      }),
    );
    expectPostings(before, snapshotLedgers(db), {
      drawers: {
        "Binance|USDT": 80,
        "General|LBP": 1_790_000,
        "General|USD": -98,
      },
    });
  });

  it("the Binance line is stored as method BINANCE, USDT, on the Binance drawer (same as today's single row)", () => {
    const fsId = create(
      binanceReceive({ customerPayments: [B(80), L("CASH", 22)] }),
    );
    const rows = paymentRows(txnOf(fsId).id).filter(
      (r) => r.drawer_name === "Binance",
    );
    expect(rows).toEqual([
      {
        method: "BINANCE",
        drawer_name: "Binance",
        currency_code: "USDT",
        amount: 80,
      },
    ]);
  });

  it("refuses a Binance line that is not in USDT", () => {
    expect(() =>
      create(
        binanceReceive({ customerPayments: [L("BINANCE", 100), L("CASH", 2)] }),
      ),
    ).toThrow(/USDT/);
  });

  it("refuses a non-Binance line in USDT (no General|USDT balance)", () => {
    expect(() =>
      create(
        binanceReceive({
          customerPayments: [B(80), L("CASH", 22, "USDT")],
        }),
      ),
    ).toThrow(/USDT/);
  });

  it("refuses an account line in LBP (the shortfall is owed in USD)", () => {
    expect(() =>
      create(
        binanceReceive({
          clientId: CLIENT_ID,
          customerPayments: [
            B(80),
            L("CASH", 2),
            L("CUSTOMER_ACCOUNT", 1_790_000, "LBP"),
          ],
        }),
      ),
    ).toThrow(/in USD/);
  });

  it("refuses lines that add up to more than transfer + fee", () => {
    expect(() =>
      create(binanceReceive({ customerPayments: [B(100), L("CASH", 5)] })),
    ).toThrow(CUSTOMER_LEGS_OVERPAID_MESSAGE);
  });

  it("without customerPayments the single Binance row books exactly as today (FR-018)", () => {
    const before = snapshotLedgers(db);
    const fsId = create(
      binanceReceive({
        feeCollectedSeparately: undefined,
        payments: [L("CASH", 98)],
      }),
    );
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "Binance|USDT": 100, "General|USD": -98 },
    });
    expect(
      paymentRows(txnOf(fsId).id).filter((r) => r.drawer_name === "Binance"),
    ).toEqual([
      {
        method: "BINANCE",
        drawer_name: "Binance",
        currency_code: "USDT",
        amount: 100,
      },
    ]);
  });

  it("the payload survives the shared schema (rule 24: field names from the schema)", () => {
    const parsed = createFinancialServiceSchema.parse({
      provider: "BINANCE",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USDT",
      commission: 2,
      payments: [L("CASH", 100)],
      cashoutMethod: "CASH",
      clientId: CLIENT_ID,
      feeCollectedSeparately: true,
      customerPayments: [B(80), L("CASH", 2), L("CUSTOMER_ACCOUNT", 20)],
      customer_waived_amount: 0,
    });
    expect(parsed.customerPayments).toEqual([
      B(80),
      L("CASH", 2),
      L("CUSTOMER_ACCOUNT", 20),
    ]);
    expect(parsed.feeCollectedSeparately).toBe(true);
    expect(parsed.customer_waived_amount).toBe(0);
    const before = snapshotLedgers(db);
    create(parsed as unknown as CreateFinancialServiceData);
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "Binance|USDT": 80, "General|USD": -98 },
      debt: { [`${CLIENT_ID}|USD`]: 20 },
    });
  });
});

// ─── spec US5 — void and refund net to 0 ────────────────────────────────────

const CASES: Array<[string, Record<string, unknown>]> = [
  ["US4.1 Binance 100 + Cash 2", { customerPayments: [B(100), L("CASH", 2)] }],
  [
    "US4.2 Binance 80 + Cash 20 + Cash 2",
    { customerPayments: [B(80), L("CASH", 20), L("CASH", 2)] },
  ],
  [
    "US4.3 Binance 80 + Cash 2 + Account $20",
    {
      clientId: CLIENT_ID,
      customerPayments: [B(80), L("CASH", 2), L("CUSTOMER_ACCOUNT", 20)],
    },
  ],
  [
    "US4.4 Binance 80 + Cash 2 + Account 20 USDT",
    {
      clientId: CLIENT_ID,
      customerPayments: [
        B(80),
        L("CASH", 2),
        L("CUSTOMER_ACCOUNT", 20, "USDT"),
      ],
    },
  ],
  [
    "forgive Binance 98 + Cash 2, $2 forgiven",
    { customerPayments: [B(98), L("CASH", 2)], customer_waived_amount: 2 },
  ],
];

describe.each(CASES)("%s — undo (spec US5)", (_name, over) => {
  function createTxn(): number {
    return txnOf(create(binanceReceive(over))).id;
  }

  it("void nets every ledger, the debt and the profit to 0", () => {
    const before = snapshotLedgers(db);
    const profitBefore = profit();
    getTransactionRepository().voidTransaction(createTxn(), 1);
    expectPostings(before, snapshotLedgers(db), {});
    expect(openDebt()).toBe(0);
    expect(profit()).toEqual(profitBefore);
    const sibs = waivedSiblings();
    expect(sibs).toHaveLength(over.customer_waived_amount ? 1 : 0);
    expect(sibs.every((r) => r.status === "VOIDED")).toBe(true);
  });

  it("refund nets every ledger, the debt and the profit to 0", () => {
    const before = snapshotLedgers(db);
    const profitBefore = profit();
    getTransactionRepository().refundTransaction(createTxn(), 1);
    expectPostings(before, snapshotLedgers(db), {});
    expect(openDebt()).toBe(0);
    expect(profit()).toEqual(profitBefore);
    const sibs = waivedSiblings();
    expect(sibs).toHaveLength(over.customer_waived_amount ? 1 : 0);
    expect(sibs.every((r) => r.status === "VOIDED")).toBe(true);
  });
});

// ─── LIRA-321 follow-up — default "Sender" fee mode (fee added on top) ──────
//
// 100 USDT cash-out, $2 fee added to the transfer (NOT feeIncluded, NOT paid
// separately): USDT in = 102, payout = $100, fee profit $2. The frontend
// seeds ONE Binance line for the whole inflow and sends no fee flag. FR-018:
// no change made to the customer section ⇒ booked exactly as today.
//
// Binance has no shared payload builder (buildWalletTransferPayload is
// OMT App / Whish App only), so the body mirrors the page's submit
// (Recharge/index.tsx handleCryptoSubmit + utils/cryptoAmounts.ts: amount =
// USDT in, commission = fee) with the amounts taken from the SAME core
// helper the page and the repository use (`walletReceiveAmounts`), then
// parsed through the shared schema — the handler's path.

describe("Binance default Sender fee mode (FR-018)", () => {
  const FEE = 2;
  const sender = walletReceiveAmounts({ walletInflow: 100 + FEE, fee: FEE });

  /** `lines`: null = today's shape (no customerPayments); [] = the seeded
   *  single Binance line; otherwise the cashier's lines. */
  function senderBody(
    lines: Line[] | null,
    clientId?: number,
  ): CreateFinancialServiceData {
    const body = {
      provider: "BINANCE",
      serviceType: "RECEIVE",
      amount: 100 + FEE,
      currency: "USDT",
      ...(clientId ? { clientId } : {}),
      clientName: "Rami",
      referenceNumber: "",
      commission: sender.commission,
      paidByMethod: "CASH",
      payments: [L("CASH", sender.payout)],
      tender_exchange_rate: RATE,
      ...(lines === null
        ? {}
        : { customerPayments: lines.length > 0 ? lines : [B(100 + FEE)] }),
    };
    return createFinancialServiceSchema.parse(
      body,
    ) as unknown as CreateFinancialServiceData;
  }

  it("the seeded Binance line books exactly like today's single inflow row", () => {
    expect(sender.payout).toBe(100);
    const gross = () =>
      getProfitService().getSummary(FROM, TO).totals.gross_profit_usd;
    const g0 = gross();
    const b0 = snapshotLedgers(db);
    const todayId = create(senderBody(null));
    const today = ledgerDeltas(b0, snapshotLedgers(db));
    resetProfitRepository();
    resetProfitService();
    const g1 = gross();
    expectPostings(b0, snapshotLedgers(db), {
      drawers: { "Binance|USDT": 102, "General|USD": -100 },
    });

    const b1 = snapshotLedgers(db);
    const nowId = create(senderBody([]));
    expectPostings(b1, snapshotLedgers(db), {
      drawers: { "Binance|USDT": 102, "General|USD": -100 },
    });
    expect(ledgerDeltas(b1, snapshotLedgers(db))).toEqual(today);

    // Same profit as today. (A USDT row's own stamp is 0 by design — the
    // commission term only stamps USD/LBP — so the Profits page delta is
    // compared too.)
    resetProfitRepository();
    resetProfitService();
    const g2 = gross();
    expect(g1 - g0).toBeCloseTo(FEE, 6);
    expect(g2 - g1).toBeCloseTo(g1 - g0, 6);
    expect(txnOf(nowId).profit_usd).toBe(txnOf(todayId).profit_usd);
    expect(txnOf(nowId).profit_lbp).toBe(txnOf(todayId).profit_lbp);
    const binanceRows = (fsId: number) =>
      paymentRows(txnOf(fsId).id).filter((r) => r.drawer_name === "Binance");
    expect(binanceRows(nowId)).toEqual(binanceRows(todayId));
    expect(binanceRows(nowId)).toEqual([
      {
        method: "BINANCE",
        drawer_name: "Binance",
        currency_code: "USDT",
        amount: 102,
      },
    ]);
    expect(waivedSiblings()).toEqual([]);
  });

  it("part left on the account: Binance 82 USDT + Account $20 → Binance +82, USD cash −100, owes $20, fee $2 booked", () => {
    const before = snapshotLedgers(db);
    const fsId = create(
      senderBody([B(82), L("CUSTOMER_ACCOUNT", 20)], CLIENT_ID),
    );
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "Binance|USDT": 82, "General|USD": -100 },
      debt: { [`${CLIENT_ID}|USD`]: 20 },
    });
    // Owing part of the transfer does not change the fee booked.
    expect(
      (
        db
          .prepare(`SELECT commission FROM financial_services WHERE id = ?`)
          .get(fsId) as { commission: number }
      ).commission,
    ).toBe(FEE);
  });

  it.each<[string, Line[], number | undefined]>([
    ["seeded Binance line", [], undefined],
    ["Binance 82 USDT + Account $20", [B(82), L("CUSTOMER_ACCOUNT", 20)], CLIENT_ID],
  ])("%s — void nets every ledger, the debt and the profit to 0", (_n, lines, clientId) => {
    const before = snapshotLedgers(db);
    const profitBefore = profit();
    const fsId = create(senderBody(lines, clientId));
    getTransactionRepository().voidTransaction(txnOf(fsId).id, 1);
    expectPostings(before, snapshotLedgers(db), {});
    expect(openDebt()).toBe(0);
    expect(profit()).toEqual(profitBefore);
  });
});
