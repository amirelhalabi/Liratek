/**
 * LIRA-369 — variant table (rule 28d): every currency pair the Exchange page
 * trades × how the shop pays out (cash / account / split) × how the customer
 * pays (cash / account / split). Each payload goes through the shared schema
 * (`exchangeSubmitSchema`, the one IPC and REST validate with) and the real
 * writer, then is voided. Checked for every variant:
 *  - accepted;
 *  - money moved = what the lines say, per currency (drawers for cash, the
 *    client's account for account lines, converted to USD at the typed rate
 *    for a currency other than USD/LBP);
 *  - void brings every drawer, the client's account and the profit back.
 */
import type Database from "better-sqlite3";
import {
  ExchangeRepository,
  type CreateExchangeData,
} from "../ExchangeRepository";
import { getTransactionRepository } from "../TransactionRepository";
import { getExchangeLotRepository } from "../ExchangeLotRepository";
import { exchangeSubmitSchema } from "../../validators/exchange";
import {
  CLIENT_ID,
  delta,
  setupExchangeDb,
  snapshot,
  teardownExchangeDb,
  unifiedExchangeTxnId,
} from "../testHelpers/exchangeCustomerPaysDb";

let db: Database.Database;

beforeEach(() => {
  db = setupExchangeDb();
  getExchangeLotRepository().createLot({
    currencyCode: "EUR",
    sourceType: "EXCHANGE_BUY",
    sourceTable: "exchange_transactions",
    sourceId: 9999,
    qty: 10_000,
    unitCostUsd: 1.05,
    acquiredAt: "2026-10-01 10:00:00",
  });
});
afterEach(() => teardownExchangeDb(db));

interface Pair {
  name: string;
  from: string;
  to: string;
  amountIn: number;
  amountOut: number;
  leg1Rate: number;
  /** USD value of one unit of a non-USD/LBP side (the seeded typed rate). */
  unitUsd: Partial<Record<string, number>>;
  extra?: Partial<CreateExchangeData>;
}

const PAIRS: Pair[] = [
  { name: "LBP→USD", from: "LBP", to: "USD", amountIn: 89_500_000, amountOut: 1000, leg1Rate: 89_500, unitUsd: {} },
  { name: "USD→LBP", from: "USD", to: "LBP", amountIn: 1000, amountOut: 89_000_000, leg1Rate: 89_000, unitUsd: {} },
  { name: "USD→EUR", from: "USD", to: "EUR", amountIn: 110, amountOut: 100, leg1Rate: 1.1, unitUsd: { EUR: 1.1 } },
  { name: "EUR→USD", from: "EUR", to: "USD", amountIn: 100, amountOut: 105, leg1Rate: 1.05, unitUsd: { EUR: 1.05 } },
  // Cross trades via USD. `unitUsd` is what the page seeds: the leg's USD
  // amount ÷ that side's quantity (exchangeUnitUsd).
  {
    name: "EUR→LBP via USD", from: "EUR", to: "LBP", amountIn: 100, amountOut: 10_382_000, leg1Rate: 1.16,
    unitUsd: { EUR: 116 / 100 },
    extra: { leg2Rate: 89_500, leg2MarketRate: 89_500, leg2ProfitUsd: 0, viaCurrency: "USD" },
  },
  {
    name: "LBP→EUR via USD", from: "LBP", to: "EUR", amountIn: 47_250_000, amountOut: 500, leg1Rate: 90_000,
    unitUsd: { EUR: 525 / 500 },
    extra: { leg2Rate: 1.05, leg2MarketRate: 1.05, leg2ProfitUsd: 0, viaCurrency: "USD" },
  },
];

type Way = "cash" | "account" | "split";
const WAYS: Way[] = ["cash", "account", "split"];

const isAccountCurrency = (c: string) => c === "USD" || c === "LBP";

function lines(way: Way, currency: string, total: number) {
  const cash = { method: "CASH", currencyCode: currency };
  const acct = { method: "CUSTOMER_ACCOUNT", currencyCode: currency };
  if (way === "cash") return [{ ...cash, amount: total }];
  if (way === "account") return [{ ...acct, amount: total }];
  const part = currency === "LBP" ? Math.round(total * 0.6) : Math.round(total * 60) / 100;
  return [
    { ...cash, amount: part },
    { ...acct, amount: total - part },
  ];
}

const accountPart = (ls: Array<{ method: string; amount: number }>) =>
  ls.filter((l) => l.method === "CUSTOMER_ACCOUNT").reduce((s, l) => s + l.amount, 0);
const cashPart = (ls: Array<{ method: string; amount: number }>) =>
  ls.filter((l) => l.method === "CASH").reduce((s, l) => s + l.amount, 0);

const cases = PAIRS.flatMap((p) =>
  WAYS.flatMap((payout) => WAYS.map((customer) => ({ p, payout, customer }))),
);

describe.each(cases)("$p.name · payout $payout · customer $customer", ({ p, payout, customer }) => {
  it("is accepted, moves what the lines say, and void nets to 0", () => {
    const payments = lines(payout, p.to, p.amountOut);
    const customerPayments = lines(customer, p.from, p.amountIn);
    const payoutConverts = !isAccountCurrency(p.to) && accountPart(payments) > 0;
    const customerConverts = !isAccountCurrency(p.from) && accountPart(customerPayments) > 0;
    const payload = {
      fromCurrency: p.from,
      toCurrency: p.to,
      amountIn: p.amountIn,
      amountOut: p.amountOut,
      leg1Rate: p.leg1Rate,
      leg1MarketRate: p.leg1Rate,
      leg1ProfitUsd: 0,
      totalProfitUsd: 0,
      clientId: CLIENT_ID,
      customerPayments,
      payments,
      ...(payoutConverts ? { payout_account_usd_rate: p.unitUsd[p.to] } : {}),
      ...(customerConverts ? { customer_account_usd_rate: p.unitUsd[p.from] } : {}),
      ...p.extra,
    };
    const parsed = exchangeSubmitSchema.safeParse(payload);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);

    const before = snapshot(db);
    const { id } = new ExchangeRepository().createTransaction(
      parsed.success ? (parsed.data as CreateExchangeData) : (payload as CreateExchangeData),
    );
    const d = delta(before, snapshot(db));

    // Drawers: only the cash lines.
    const drawerOf = (c: string) => (c === "USD" ? d.generalUsd : c === "LBP" ? d.generalLbp : d.generalEur);
    expect(drawerOf(p.from)).toBeCloseTo(cashPart(customerPayments), 2);
    expect(drawerOf(p.to)).toBeCloseTo(-cashPart(payments), 2);

    // The client's account: debt for the customer side, credit for the payout.
    const toAccount = (c: string, amount: number) =>
      isAccountCurrency(c)
        ? { usd: c === "USD" ? amount : 0, lbp: c === "LBP" ? amount : 0 }
        : { usd: Math.round(amount * (p.unitUsd[c] as number) * 100) / 100, lbp: 0 };
    const owes = toAccount(p.from, accountPart(customerPayments));
    const credit = toAccount(p.to, accountPart(payments));
    expect(d.balanceUsd).toBeCloseTo(owes.usd - credit.usd, 2);
    expect(d.balanceLbp).toBeCloseTo(owes.lbp - credit.lbp, 0);

    // The seeded rate is the trade's own value: when every side outside
    // USD/LBP is wholly on the account, nothing is sold or bought, so no
    // margin appears (a mismatch between the page's seed and the server's
    // per-unit value would show here as a phantom profit or loss).
    const fullyOnAccount = (c: string, ls: Array<{ method: string; amount: number }>, total: number) =>
      isAccountCurrency(c) || Math.abs(accountPart(ls) - total) < 1e-9;
    if (
      (!isAccountCurrency(p.from) || !isAccountCurrency(p.to)) &&
      fullyOnAccount(p.from, customerPayments, p.amountIn) &&
      fullyOnAccount(p.to, payments, p.amountOut)
    ) {
      expect(d.profitUsd).toBeCloseTo(0, 2);
    }

    getTransactionRepository().voidTransaction(unifiedExchangeTxnId(db, id), 1);
    // The client's whole balance, not the helper's Exchange-Debt-only view:
    // that view also counts the reversal of a payout credit on the same
    // exchange, which is not a debt.
    const { debtUsd: _du, debtLbp: _dl, ...after } = delta(before, snapshot(db));
    expect(after).toEqual({
      generalUsd: 0,
      generalLbp: 0,
      generalEur: 0,
      balanceUsd: 0,
      balanceLbp: 0,
      profitUsd: 0,
      profitLbp: 0,
    });
  });
});
