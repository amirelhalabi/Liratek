/**
 * LIRA-321 T032/T037 — Whish App / OMT App RECEIVE: the customer pays the
 * transfer (and, on Whish App with the fee paid separately, the fee) in
 * several lines (`customerPayments`), next to the unchanged payout.
 *
 * spec.md US3 — all: $100 cash-out paid to the customer in USD cash, $5 fee
 * paid separately:
 *   1. Whish $100 + Cash $5            → Whish_App +100, USD cash −95
 *   2. (a) Whish $90 + OMT $10 + Cash $5 → Whish_App +90, OMT_App +10, USD −95
 *   3. (b) Whish $90 + Cash $10 + Cash $5 → Whish_App +90, USD −85
 *   4. (c) Whish $90 + Cash $5 + Account $10 → Whish_App +90, USD −95, debt $10
 *   US3.6 OMT App: transfer only, any fee still refused (D1).
 *
 * A line paid into the provider's OWN wallet is stored with method = the
 * provider code (WHISH_APP / OMT_APP), so it stays an internal leg exactly
 * like today's single inflow row (research R7).
 *
 * Real schema: `electron-app/create_db.sql` + migrations, fresh per case —
 * a hand-rolled schema without `payment_methods` hides the method checks.
 * Every ledger is compared in full (`expectPostings`): an unexpected posting
 * fails as loudly as a missing one.
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
  INTERNAL_LEG_METHODS,
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetDebtService } from "../../services/DebtService";
import { resetClientRepository } from "../ClientRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import {
  OMT_RECEIVE_NO_FEE_MESSAGE,
  createFinancialServiceSchema,
} from "../../validators/financial";
import {
  buildWalletTransferPayload,
  calculateOmtWhishAppFees,
} from "../../utils/walletTransfer";
import { CUSTOMER_LEGS_OVERPAID_MESSAGE } from "../moneyPosting";
import { isDrawerAffectingMethod } from "../../utils/payments";
import { resetProfitRepository } from "../ProfitRepository";
import {
  getProfitService,
  resetProfitService,
} from "../../services/ProfitService";
import {
  snapshotLedgers,
  expectPostings,
  ledgerDeltas,
} from "../testHelpers/postingAssert";

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf-8",
);

const RATE = 89_500;
const CLIENT_ID = 1;

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
    ["Whish_App", "USD", 10_000],
    ["OMT_App", "USD", 10_000],
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

/** Whish App $100 cash-out, $5 fee paid separately, $100 USD cash payout. */
function whishReceive(
  over: Partial<CreateFinancialServiceData> & Record<string, unknown>,
): CreateFinancialServiceData {
  return {
    provider: "WHISH_APP",
    serviceType: "RECEIVE",
    amount: 100,
    currency: "USD",
    commission: 5,
    whishFee: 5,
    includingFees: false,
    payments: [L("CASH", 100)],
    cashoutMethod: "CASH",
    feeCollectedSeparately: true,
    ...over,
  } as CreateFinancialServiceData;
}

/** OMT App $100 cash-out — no fee (D1), $100 USD cash payout. */
function omtReceive(
  over: Partial<CreateFinancialServiceData> & Record<string, unknown>,
): CreateFinancialServiceData {
  return {
    provider: "OMT_APP",
    serviceType: "RECEIVE",
    amount: 100,
    currency: "USD",
    commission: 0,
    includingFees: false,
    payments: [L("CASH", 100)],
    cashoutMethod: "CASH",
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

const FROM = "2000-01-01";
const TO = "2100-12-31";

function summary() {
  resetProfitRepository();
  resetProfitService();
  return getProfitService().getSummary(FROM, TO);
}

function waivedRows() {
  return db
    .prepare(
      `SELECT amount_usd, amount_lbp, profit_usd, profit_lbp, source_table,
              source_id, client_id, status, metadata_json
         FROM transactions WHERE type = 'WAIVED_SHORTFALL' ORDER BY id`,
    )
    .all() as {
    amount_usd: number;
    amount_lbp: number;
    profit_usd: number;
    profit_lbp: number;
    source_table: string;
    source_id: number;
    client_id: number | null;
    status: string;
    metadata_json: string;
  }[];
}

function paymentRows(txnId: number) {
  return db
    .prepare(
      `SELECT method, drawer_name, currency_code, amount FROM payments
        WHERE transaction_id = ? ORDER BY id`,
    )
    .all(txnId) as {
    method: string;
    drawer_name: string;
    currency_code: string;
    amount: number;
  }[];
}

// ─── spec US3 scenarios 1–4 (Whish App) ─────────────────────────────────────

describe("Whish App RECEIVE with customerPayments (spec US3)", () => {
  it("1. Whish $100 + Cash $5 fee → Whish_App +100, USD cash −95", () => {
    const before = snapshotLedgers(db);
    const fsId = create(
      whishReceive({ customerPayments: [L("WHISH", 100), L("CASH", 5)] }),
    );
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "Whish_App|USD": 100, "General|USD": -95 },
    });
    expect(txnOf(fsId).profit_usd).toBe(5);
  });

  it("2. (a) Whish $90 + OMT $10 + Cash $5 → Whish_App +90, OMT_App +10, USD cash −95, no debt", () => {
    const before = snapshotLedgers(db);
    create(
      whishReceive({
        customerPayments: [L("WHISH", 90), L("OMT", 10), L("CASH", 5)],
      }),
    );
    expectPostings(before, snapshotLedgers(db), {
      drawers: {
        "Whish_App|USD": 90,
        "OMT_App|USD": 10,
        "General|USD": -95,
      },
    });
  });

  it("3. (b) Whish $90 + Cash $10 + Cash $5 → Whish_App +90, USD cash −85", () => {
    const before = snapshotLedgers(db);
    create(
      whishReceive({
        customerPayments: [L("WHISH", 90), L("CASH", 10), L("CASH", 5)],
      }),
    );
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "Whish_App|USD": 90, "General|USD": -85 },
    });
  });

  it("4. (c) linked client: Whish $90 + Cash $5 + Account $10 → Whish_App +90, USD cash −95, owes $10 (Service Debt)", () => {
    const before = snapshotLedgers(db);
    const fsId = create(
      whishReceive({
        clientId: CLIENT_ID,
        customerPayments: [
          L("WHISH", 90),
          L("CASH", 5),
          L("CUSTOMER_ACCOUNT", 10),
        ],
      }),
    );
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "Whish_App|USD": 90, "General|USD": -95 },
      debt: { [`${CLIENT_ID}|USD`]: 10 },
    });
    const debt = db
      .prepare(
        `SELECT transaction_type, transaction_id FROM debt_ledger WHERE client_id = ?`,
      )
      .all(CLIENT_ID) as { transaction_type: string; transaction_id: number }[];
    expect(debt).toEqual([
      { transaction_type: "Service Debt", transaction_id: txnOf(fsId).id },
    ]);
    // US3.5: owing $10 does not change the $5 fee profit.
    expect(txnOf(fsId).profit_usd).toBe(5);
  });

  it("forgive: Whish $98 + Cash $5, $2 forgiven → Whish_App +98, USD cash −95; fee profit stays $5, −$2 on the Profits Waived line (FR-012)", () => {
    const before = snapshotLedgers(db);
    const grossBefore = summary().totals.gross_profit_usd;
    const fsId = create(
      whishReceive({
        clientId: CLIENT_ID,
        customerPayments: [L("WHISH", 98), L("CASH", 5)],
        customer_waived_amount: 2,
      }),
    );
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "Whish_App|USD": 98, "General|USD": -95 },
    });
    // The fee row keeps the FULL fee; the forgiven part is its own row.
    const parent = txnOf(fsId);
    expect(parent.profit_usd).toBe(5);
    const waived = waivedRows();
    expect(waived).toHaveLength(1);
    expect(waived[0]).toMatchObject({
      amount_usd: 0,
      amount_lbp: 0,
      profit_usd: -2,
      profit_lbp: 0,
      source_table: "transactions",
      source_id: parent.id,
      client_id: CLIENT_ID,
      status: "ACTIVE",
    });
    const meta = JSON.parse(waived[0].metadata_json);
    expect(meta.is_auto).toBe(true);
    expect(meta.financial_service_id).toBe(fsId);
    // Profits page: −$2 on the Waived line, and the total moves by fee − 2
    // (the forgive is neither dropped nor counted twice).
    const s = summary();
    expect(s.waived.profit_usd).toBe(-2);
    expect(s.waived.count).toBe(1);
    expect(s.totals.gross_profit_usd - grossBefore).toBeCloseTo(3, 6);
  });

  it("forgive in LBP: an LBP Whish App receive forgives 100,000 LBP → −100,000 LBP on the Waived line, fee profit untouched", () => {
    db.prepare(
      `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'Whish_App', 'LBP', 900000000)`,
    ).run();
    const fsId = create(
      whishReceive({
        amount: 9_000_000,
        currency: "LBP",
        commission: 450_000,
        whishFee: 450_000,
        payments: [L("CASH", 9_000_000, "LBP")],
        customerPayments: [
          L("WHISH", 8_900_000, "LBP"),
          L("CASH", 450_000, "LBP"),
        ],
        customer_waived_amount: 100_000,
      }),
    );
    expect(txnOf(fsId).profit_lbp).toBe(450_000);
    const waived = waivedRows();
    expect(waived).toHaveLength(1);
    expect(waived[0]).toMatchObject({ profit_usd: 0, profit_lbp: -100_000 });
    expect(summary().waived.profit_lbp).toBe(-100_000);
  });

  it("fee deducted (not paid separately): Whish $100 alone, payout $95 → Whish_App +100, USD cash −95", () => {
    const before = snapshotLedgers(db);
    create(
      whishReceive({
        includingFees: true,
        feeCollectedSeparately: undefined,
        payments: [L("CASH", 95)],
        customerPayments: [L("WHISH", 100)],
      }),
    );
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "Whish_App|USD": 100, "General|USD": -95 },
    });
  });

  it("the Whish wallet line is stored with method WHISH_APP (internal leg); an OMT line keeps its own method", () => {
    const fsId = create(
      whishReceive({
        customerPayments: [L("WHISH", 90), L("OMT", 10), L("CASH", 5)],
      }),
    );
    const rows = paymentRows(txnOf(fsId).id);
    // The zero-amount COMMISSION reporting row is unchanged (not a line).
    const wallet = rows.filter(
      (r) => r.drawer_name === "Whish_App" && r.amount !== 0,
    );
    expect(wallet).toEqual([
      {
        method: "WHISH_APP",
        drawer_name: "Whish_App",
        currency_code: "USD",
        amount: 90,
      },
    ]);
    expect(INTERNAL_LEG_METHODS.has(wallet[0].method)).toBe(true);
    expect(rows.filter((r) => r.drawer_name === "OMT_App")).toEqual([
      {
        method: "OMT",
        drawer_name: "OMT_App",
        currency_code: "USD",
        amount: 10,
      },
    ]);
    expect(INTERNAL_LEG_METHODS.has("OMT")).toBe(false);
  });

  it("WHISH_APP is not a payment method — why the line keeps WHISH and only the stored row says WHISH_APP", () => {
    expect(isDrawerAffectingMethod("WHISH_APP")).toBe(false);
    expect(isDrawerAffectingMethod("WHISH")).toBe(true);
  });

  it("mixed currencies convert at the sheet's tender rate: Whish $50 + 4,922,500 LBP cash ($55 at 89,500) + nothing owed", () => {
    const before = snapshotLedgers(db);
    create(
      whishReceive({
        // Server rate 90,000 (sell); the sheet converted at 89,500 (buy).
        exchangeRate: 90_000,
        tender_exchange_rate: 89_500,
        customerPayments: [L("WHISH", 50), L("CASH", 4_922_500, "LBP")],
      }),
    );
    expectPostings(before, snapshotLedgers(db), {
      drawers: {
        "Whish_App|USD": 50,
        "General|LBP": 4_922_500,
        "General|USD": -100,
      },
    });
  });

  it("refuses feeCollectedSeparately with includingFees (the fee cannot be both deducted and paid)", () => {
    expect(() =>
      create(
        whishReceive({
          includingFees: true,
          customerPayments: [L("WHISH", 100), L("CASH", 5)],
        }),
      ),
    ).toThrow(/includingFees/);
  });

  it("refuses customerPayments together with feePayments", () => {
    expect(() =>
      create(
        whishReceive({
          customerPayments: [L("WHISH", 100), L("CASH", 5)],
          feePayments: [L("CASH", 5)],
        }),
      ),
    ).toThrow(/customerPayments/);
  });

  it("refuses lines that add up to more than transfer + fee", () => {
    expect(() =>
      create(
        whishReceive({ customerPayments: [L("WHISH", 100), L("CASH", 10)] }),
      ),
    ).toThrow(CUSTOMER_LEGS_OVERPAID_MESSAGE);
  });

  it("refuses an account line with no client", () => {
    expect(() =>
      create(
        whishReceive({
          customerPayments: [
            L("WHISH", 90),
            L("CASH", 5),
            L("CUSTOMER_ACCOUNT", 10),
          ],
        }),
      ),
    ).toThrow(/client/i);
  });

  it("without customerPayments the single provider row books exactly as today (FR-018)", () => {
    const before = snapshotLedgers(db);
    const fsId = create(
      whishReceive({
        feeCollectedSeparately: undefined,
        payments: [L("CASH", 95)],
      }),
    );
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "Whish_App|USD": 100, "General|USD": -95 },
    });
    const rows = paymentRows(txnOf(fsId).id).filter(
      (r) => r.drawer_name === "Whish_App" && r.amount !== 0,
    );
    expect(rows).toEqual([
      {
        method: "WHISH_APP",
        drawer_name: "Whish_App",
        currency_code: "USD",
        amount: 100,
      },
    ]);
  });
});

// ─── US3.6 — OMT App (no fee, D1) ───────────────────────────────────────────

describe("OMT App RECEIVE with customerPayments (spec US3.6)", () => {
  it("OMT $60 + Whish $40 → OMT_App +60 (method OMT_APP), Whish_App +40, USD cash −100", () => {
    const before = snapshotLedgers(db);
    const fsId = create(
      omtReceive({ customerPayments: [L("OMT", 60), L("WHISH", 40)] }),
    );
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "OMT_App|USD": 60, "Whish_App|USD": 40, "General|USD": -100 },
    });
    const rows = paymentRows(txnOf(fsId).id);
    expect(rows.find((r) => r.drawer_name === "OMT_App")?.method).toBe(
      "OMT_APP",
    );
    expect(rows.find((r) => r.drawer_name === "Whish_App")?.method).toBe(
      "WHISH",
    );
  });

  it("(c) mirror: OMT $90 + Account $10 → OMT_App +90, USD cash −100, owes $10", () => {
    const before = snapshotLedgers(db);
    create(
      omtReceive({
        clientId: CLIENT_ID,
        customerPayments: [L("OMT", 90), L("CUSTOMER_ACCOUNT", 10)],
      }),
    );
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "OMT_App|USD": 90, "General|USD": -100 },
      debt: { [`${CLIENT_ID}|USD`]: 10 },
    });
  });

  it("expected is the transfer only: OMT $100 + Cash $5 is an overpay", () => {
    expect(() =>
      create(omtReceive({ customerPayments: [L("OMT", 100), L("CASH", 5)] })),
    ).toThrow(CUSTOMER_LEGS_OVERPAID_MESSAGE);
  });

  it("any fee is still refused (D1)", () => {
    expect(() =>
      create(omtReceive({ commission: 2, customerPayments: [L("OMT", 100)] })),
    ).toThrow(OMT_RECEIVE_NO_FEE_MESSAGE);
  });

  it("feeCollectedSeparately is refused (D1 — nothing to collect)", () => {
    expect(() =>
      create(
        omtReceive({
          feeCollectedSeparately: true,
          customerPayments: [L("OMT", 100)],
        }),
      ),
    ).toThrow(OMT_RECEIVE_NO_FEE_MESSAGE);
  });
});

// ─── where customerPayments is not allowed (never silently ignored) ─────────

describe("customerPayments is refused, never dropped, outside a walk-in app RECEIVE", () => {
  it.each<[string, Partial<CreateFinancialServiceData>]>([
    ["a SEND", { serviceType: "SEND" }],
    ["a session item", { deferPayment: true }],
  ])("refuses customerPayments on %s", (_n, over) => {
    expect(() =>
      create(
        whishReceive({
          ...over,
          customerPayments: [L("WHISH", 100), L("CASH", 5)],
        }),
      ),
    ).toThrow(/customerPayments/);
  });

  it("refuses customer_waived_amount without customerPayments", () => {
    expect(() =>
      create(
        whishReceive({
          feeCollectedSeparately: undefined,
          payments: [L("CASH", 95)],
          customer_waived_amount: 2,
        }),
      ),
    ).toThrow(/customerPayments/);
  });
});

// ─── LIRA-321 follow-up — default "Sender" fee mode, EXACT frontend payload ──
//
// The default mode ("Sender — fee added to the transfer": NOT includingFees,
// NOT paid separately) now ALSO sends `customerPayments`: ONE own-wallet line
// for the whole wallet inflow (transfer + fee on top) and no fee flag. FR-018:
// no change made to the customer section ⇒ booked exactly as today (no
// `customerPayments`). The body is built by the SAME shared builder the form
// uses (`buildWalletTransferPayload`, fed by `calculateOmtWhishAppFees`) and
// parsed through the shared schema — the handler's path — so it cannot drift.

describe("default Sender fee mode — the frontend's exact payload (FR-018)", () => {
  type AppProvider = "WHISH_APP" | "OMT_APP";

  /** The body OmtWhishAppTransferForm.handleSubmit builds for a $100 USD
   *  RECEIVE in the default fee mode, paid out in USD cash. `lines`
   *  overrides the seeded "Customer pays" lines; `null` = the old shape
   *  (no customerPayments at all — today's booking). */
  function senderBody(
    provider: AppProvider,
    lines: Line[] | null,
    clientId?: number,
  ): CreateFinancialServiceData {
    const f = calculateOmtWhishAppFees({
      activeProvider: provider,
      serviceType: "RECEIVE",
      currency: "USD",
      parsedAmount: 100,
      manualFee: provider === "WHISH_APP" ? "5" : "",
      includingFees: false,
      feeCollectedSeparately: false,
    });
    const seed = [
      {
        method: provider === "WHISH_APP" ? "WHISH" : "OMT",
        currencyCode: "USD",
        amount: f.walletAmount,
      },
    ];
    const body = buildWalletTransferPayload({
      provider,
      serviceType: "RECEIVE",
      currency: "USD",
      fees: f,
      includingFees: false,
      client: { id: clientId ?? null, name: "Rami", phone: "70111222" },
      paidByMethod: "CASH",
      payments: [{ method: "CASH", currencyCode: "USD", amount: f.totalAmount }],
      tenderExchangeRate: RATE,
      cashoutMethod: "CASH",
      ...(lines === null
        ? {}
        : {
            customerPayments: lines.length > 0 ? lines : seed,
            feeCollectedSeparately: false,
            customerWaivedAmount: 0,
          }),
    });
    return createFinancialServiceSchema.parse(
      body,
    ) as unknown as CreateFinancialServiceData;
  }

  function ownWalletRows(fsId: number) {
    return paymentRows(txnOf(fsId).id).filter(
      (r) =>
        (r.drawer_name === "Whish_App" || r.drawer_name === "OMT_App") &&
        r.amount !== 0,
    );
  }

  /** Σ profit over ACTIVE transactions, per currency. */
  function activeProfit(): { usd: number; lbp: number } {
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

  it.each<[AppProvider, string, number, number]>([
    // provider, drawer, wallet inflow (transfer + fee on top), fee
    ["WHISH_APP", "Whish_App", 105, 5],
    ["OMT_APP", "OMT_App", 100, 0],
  ])(
    "%s: the seeded own-wallet line books exactly like today's single inflow row",
    (provider, drawer, inflow, fee) => {
      // Today: no customerPayments.
      const b0 = snapshotLedgers(db);
      const todayId = create(senderBody(provider, null));
      const today = ledgerDeltas(b0, snapshotLedgers(db));
      expectPostings(b0, snapshotLedgers(db), {
        drawers: { [`${drawer}|USD`]: inflow, "General|USD": -100 },
      });

      // The frontend's payload now: one own-wallet line, no fee flag.
      const body = senderBody(provider, []);
      expect(body.customerPayments).toEqual([
        {
          method: provider === "WHISH_APP" ? "WHISH" : "OMT",
          currencyCode: "USD",
          amount: inflow,
        },
      ]);
      expect(body.feeCollectedSeparately).toBeUndefined();
      expect(body.customer_waived_amount).toBeUndefined();
      const b1 = snapshotLedgers(db);
      const nowId = create(body);
      expectPostings(b1, snapshotLedgers(db), {
        drawers: { [`${drawer}|USD`]: inflow, "General|USD": -100 },
      });
      expect(ledgerDeltas(b1, snapshotLedgers(db))).toEqual(today);

      // Same profit, same stored own-wallet row (internal-leg method).
      expect(txnOf(nowId).profit_usd).toBe(fee);
      expect(txnOf(nowId).profit_usd).toBe(txnOf(todayId).profit_usd);
      expect(txnOf(nowId).profit_lbp).toBe(txnOf(todayId).profit_lbp);
      expect(ownWalletRows(nowId)).toEqual(ownWalletRows(todayId));
      expect(ownWalletRows(nowId)).toEqual([
        {
          method: provider,
          drawer_name: drawer,
          currency_code: "USD",
          amount: inflow,
        },
      ]);
      expect(waivedRows()).toEqual([]);
    },
  );

  it("Whish App, part left on the account: Whish $95 + Account $10 → Whish_App +95, USD cash −100, owes $10, fee profit $5", () => {
    const before = snapshotLedgers(db);
    const fsId = create(
      senderBody(
        "WHISH_APP",
        [L("WHISH", 95), L("CUSTOMER_ACCOUNT", 10)],
        CLIENT_ID,
      ),
    );
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "Whish_App|USD": 95, "General|USD": -100 },
      debt: { [`${CLIENT_ID}|USD`]: 10 },
    });
    expect(txnOf(fsId).profit_usd).toBe(5);
  });

  it.each<[string, AppProvider, Line[], number | undefined]>([
    ["Whish App, seeded line", "WHISH_APP", [], undefined],
    ["OMT App, seeded line", "OMT_APP", [], undefined],
    [
      "Whish App, Whish $95 + Account $10",
      "WHISH_APP",
      [L("WHISH", 95), L("CUSTOMER_ACCOUNT", 10)],
      CLIENT_ID,
    ],
  ])("%s — void nets every ledger, the debt and the profit to 0", (_n, provider, lines, clientId) => {
    const before = snapshotLedgers(db);
    const profitBefore = activeProfit();
    const fsId = create(senderBody(provider, lines, clientId));
    getTransactionRepository().voidTransaction(txnOf(fsId).id, 1);
    expectPostings(before, snapshotLedgers(db), {});
    expect(activeProfit()).toEqual(profitBefore);
  });
});
