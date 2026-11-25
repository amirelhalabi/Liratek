/**
 * LIRA-400 phase 2 — payment-method fee on the Exchange "Customer pays"
 * lines (a wallet line the customer pays in with, e.g. Whish).
 *
 * Money contract (specs/400-payment-method-fee/spec.md, same as phase 1):
 *  - the fee goes into the line method's own drawer (amount + fee), never
 *    General; what the customer owes for the exchange (amountIn) and the
 *    exchange's own margin are unchanged;
 *  - it is profit in the line's currency, on the Payment Method Fees line;
 *  - VOID nets every drawer and the fee profit to 0, per currency;
 *  - the server refuses a fee on cash / customer-account lines and above
 *    the line amount;
 *  - the shared "Customer pays" writer still refuses a fee from any other
 *    screen (Whish/OMT App receive, Binance) — those have no "+ fee" yet.
 *
 * Every payload is parsed by the REAL schema both transports use
 * (`exchangeSubmitSchema` — rule 24: the keys are the schema's own) and
 * handed to the REAL service (`addDirectTransaction`, what the IPC handler
 * and the REST route call).
 *
 * Rule 17: written and run BEFORE the change. Recorded failure: the schema
 * stripped `feeAmount`, so Whish_App moved by the price only, Profits showed
 * no fee, and every refusal case was accepted.
 */
import type Database from "better-sqlite3";
import { exchangeSubmitSchema } from "../../validators/exchange";
import { ExchangeService } from "../../services/ExchangeService";
import {
  ExchangeRepository,
  type CreateExchangeData,
} from "../ExchangeRepository";
import { getTransactionRepository } from "../TransactionRepository";
import { ProfitService } from "../../services/ProfitService";
import { ProfitRepository, resetProfitRepository } from "../ProfitRepository";
import { bookCustomerLegs } from "../moneyPosting";
import {
  CLIENT_ID,
  US1_BASE,
  US1_MARGIN,
  setupExchangeDb,
  teardownExchangeDb,
  unifiedExchangeTxnId,
} from "../testHelpers/exchangeCustomerPaysDb";

let db: Database.Database;

beforeEach(() => {
  resetProfitRepository();
  db = setupExchangeDb();
});
afterEach(() => {
  resetProfitRepository();
  teardownExchangeDb(db);
});

const FROM = "2000-01-01";
const TO = "2100-01-01";
const OWNER = 1;

type Json = Record<string, unknown>;

const DRAWERS: Array<[string, string]> = [
  ["General", "USD"],
  ["General", "LBP"],
  ["Whish_App", "USD"],
  ["Whish_App", "LBP"],
  ["OMT_App", "LBP"],
];

function snap(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [d, c] of DRAWERS) {
    const row = db
      .prepare(
        `SELECT balance FROM drawer_balances WHERE tenant_id = 1 AND drawer_name = ? AND currency_code = ?`,
      )
      .get(d, c) as { balance: number } | undefined;
    out[`${d}/${c}`] = row?.balance ?? 0;
  }
  return out;
}

function delta(before: Record<string, number>): Record<string, number> {
  const after = snap();
  const out: Record<string, number> = {};
  for (const k of Object.keys(after)) {
    const v = Math.round((after[k]! - before[k]!) * 100) / 100;
    if (v !== 0) out[k] = v;
  }
  return out;
}

function pmFee(): { usd: number; lbp: number } {
  const s = new ProfitService(new ProfitRepository()).getSummary(FROM, TO);
  return {
    usd: Math.round(s.financial_services.pm_fee_usd * 100) / 100,
    lbp: Math.round(s.financial_services.pm_fee_lbp),
  };
}

/** An Exchange as the page sends it: through the real schema + service. */
function exchange(
  customerPayments: Json[],
  extra: Json = {},
): { success: boolean; error?: string; txnId?: number } {
  const raw: Json = { ...US1_BASE, customerPayments, ...extra };
  const parsed = exchangeSubmitSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message };
  }
  const r = new ExchangeService(new ExchangeRepository()).addDirectTransaction(
    parsed.data as CreateExchangeData,
  );
  if (!r.success) return { success: false, error: r.error };
  return { success: true, txnId: unifiedExchangeTxnId(db, r.id!) };
}

function feeRows(
  txnId: number,
): Array<{ method: string; amount: number; fee_amount: number }> {
  return db
    .prepare(
      `SELECT method, amount, fee_amount FROM payments WHERE transaction_id = ? AND fee_amount <> 0 ORDER BY id`,
    )
    .all(txnId) as Array<{
    method: string;
    amount: number;
    fee_amount: number;
  }>;
}

describe("LIRA-400 — Exchange customer pays by wallet with a fee", () => {
  it("Whish 89,500,000 LBP + 500,000 fee: Whish +90M, General USD −1,000, fee line 500,000 LBP, margin unchanged", () => {
    const before = snap();
    const r = exchange([
      {
        method: "WHISH",
        currencyCode: "LBP",
        amount: 89_500_000,
        feeAmount: 500_000,
      },
    ]);
    expect(r).toMatchObject({ success: true });
    expect(delta(before)).toEqual({
      "Whish_App/LBP": 90_000_000,
      "General/USD": -1_000,
    });
    expect(feeRows(r.txnId!)).toEqual([
      { method: "WHISH", amount: 90_000_000, fee_amount: 500_000 },
    ]);
    expect(pmFee()).toEqual({ usd: 0, lbp: 500_000 });
    const t = db
      .prepare(`SELECT profit_usd, profit_lbp FROM transactions WHERE id = ?`)
      .get(r.txnId) as { profit_usd: number; profit_lbp: number };
    expect(t.profit_usd).toBeCloseTo(US1_MARGIN, 6);
    expect(t.profit_lbp).toBe(0);
  });

  it("split cash + wallet: only the wallet line carries the fee", () => {
    const before = snap();
    const r = exchange([
      { method: "CASH", currencyCode: "LBP", amount: 44_500_000 },
      {
        method: "WHISH",
        currencyCode: "LBP",
        amount: 45_000_000,
        feeAmount: 450_000,
      },
    ]);
    expect(r).toMatchObject({ success: true });
    expect(delta(before)).toEqual({
      "General/LBP": 44_500_000,
      "Whish_App/LBP": 45_450_000,
      "General/USD": -1_000,
    });
    expect(pmFee()).toEqual({ usd: 0, lbp: 450_000 });
  });

  it("void nets every drawer and the fee profit to 0", () => {
    const before = snap();
    const r = exchange([
      {
        method: "WHISH",
        currencyCode: "LBP",
        amount: 89_500_000,
        feeAmount: 500_000,
      },
    ]);
    expect(r).toMatchObject({ success: true });
    getTransactionRepository().voidTransaction(r.txnId!, OWNER);
    expect(delta(before)).toEqual({});
    expect(pmFee()).toEqual({ usd: 0, lbp: 0 });
  });

  it.each([
    [
      "cash",
      [
        {
          method: "CASH",
          currencyCode: "LBP",
          amount: 89_500_000,
          feeAmount: 500_000,
        },
      ],
      {},
    ],
    [
      "a customer-account line",
      [
        { method: "WHISH", currencyCode: "LBP", amount: 89_000_000 },
        {
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "LBP",
          amount: 500_000,
          feeAmount: 10_000,
        },
      ],
      { clientId: CLIENT_ID },
    ],
    [
      "a fee above the line amount",
      [
        { method: "CASH", currencyCode: "LBP", amount: 89_000_000 },
        {
          method: "WHISH",
          currencyCode: "LBP",
          amount: 500_000,
          feeAmount: 600_000,
        },
      ],
      {},
    ],
    [
      "a negative fee",
      [
        {
          method: "WHISH",
          currencyCode: "LBP",
          amount: 89_500_000,
          feeAmount: -1,
        },
      ],
      {},
    ],
  ])("refuses %s", (_label, legs, extra) => {
    const before = snap();
    const r = exchange(legs as Json[], extra as Json);
    expect(r.success).toBe(false);
    expect(delta(before)).toEqual({});
  });
});

describe("LIRA-400 — the shared Customer pays writer stays fee-free for other screens", () => {
  it("bookCustomerLegs without allowLegFees refuses a leg carrying a fee", () => {
    expect(() =>
      bookCustomerLegs(db, {
        legs: [
          {
            method: "WHISH",
            currencyCode: "USD",
            amount: 10,
            feeAmount: 1,
          } as never,
        ],
        expected: { amount: 10, currency: "USD" },
        rate: 89_500,
        debtType: "Exchange Debt",
        transactionId: 1,
        drawerFor: () => "Whish_App",
        tenantId: 1,
      }),
    ).toThrow(/fee/i);
  });
});
