/**
 * Shop-day fix (owner decision Q1, 2026-10-16) — every payment-snapshot
 * line records the way the money ACTUALLY moved for the shop's drawer:
 *   - the customer pays the shop → IN;
 *   - the shop pays out (prize, pickup, expense, supplier / partner payment,
 *     debt cash-out, transfer payout, top-up from a client) → OUT;
 *   - change handed back on a sale → OUT;
 *   - change a vendor / supplier hands back on a payout → IN;
 *   - a fee collected, or what the customer hands over on a cash-out → IN.
 *
 * Before the fix a payout leg was written as IN (the leg's booking default),
 * so the Details panel showed "In $98" for cash the shop handed out.
 *
 * Each case feeds the builder exactly the inputs its repository passes
 * (the flow and the legs as booked). The repository-level proof is the
 * T036 hook in every `*.details.test.ts`: it now compares each snapshot
 * line's direction with the SIGN of the `payments` row the flow booked.
 *
 * Rule 17: run against the unfixed builder (which ignored `flow`; jest
 * transpiles without type-checking) and seen failing on every payout row
 * before the fix.
 */
import { buildPaymentSnapshot } from "../paymentSnapshot";
import { paymentSnapshotSchema } from "../../validators/transactionDetails";

type Dir = "IN" | "OUT";

interface Case {
  flow: string;
  input: Parameters<typeof buildPaymentSnapshot>[0];
  /** Expected direction of each line, in line order. */
  directions: Dir[];
}

const cash = (
  currencyCode: string,
  amount: number,
  direction?: "OUT",
): {
  method: string;
  currencyCode: string;
  amount: number;
  direction?: "OUT";
} => ({
  method: "CASH",
  currencyCode,
  amount,
  ...(direction ? { direction } : {}),
});

const CASES: Case[] = [
  {
    flow: "POS sale paid $50 + 900,000 LBP, 100,000 LBP change back",
    input: {
      flow: "IN",
      payments: [
        cash("USD", 50),
        { method: "WHISH", currencyCode: "LBP", amount: 900000 },
        cash("LBP", 100000, "OUT"),
      ],
    },
    directions: ["IN", "IN", "OUT"],
  },
  {
    flow: "expense: $20 handed to the vendor, $1 back",
    input: {
      flow: "PAYOUT",
      payments: [cash("USD", 20), cash("USD", 1, "OUT")],
      keptChange: { usd: 0.5 },
    },
    directions: ["OUT", "IN"],
  },
  {
    flow: "supplier PAY $80 cash, $5 change back",
    input: {
      flow: "PAYOUT",
      payments: [cash("USD", 80), cash("USD", 5, "OUT")],
    },
    directions: ["OUT", "IN"],
  },
  {
    flow: "partner SETTLE (shop pays) split $200 cash + $100 Whish",
    input: {
      flow: "PAYOUT",
      payments: [
        cash("USD", 200),
        { method: "WHISH", currency_code: "USD", amount: 100 },
      ],
    },
    directions: ["OUT", "OUT"],
  },
  {
    flow: "partner SETTLE (partner pays the shop) $50 cash",
    input: { flow: "IN", payments: [cash("USD", 50)] },
    directions: ["IN"],
  },
  {
    flow: "debt cash-out: $30 cash advance",
    input: { flow: "PAYOUT", payments: [cash("USD", 30)] },
    directions: ["OUT"],
  },
  {
    flow: "debt repayment: $25 cash",
    input: { flow: "IN", payments: [cash("USD", 25)] },
    directions: ["IN"],
  },
  {
    flow: "loto cash prize 2,000,000 LBP",
    input: { flow: "PAYOUT", payments: [cash("LBP", 2000000)] },
    directions: ["OUT"],
  },
  {
    flow: "hold money: deposit $200 + 1,000,000 LBP",
    input: {
      flow: "IN",
      payments: [cash("USD", 200), cash("LBP", 1000000)],
    },
    directions: ["IN", "IN"],
  },
  {
    flow: "hold money: pickup $100 + 1,000,000 LBP",
    input: {
      flow: "PAYOUT",
      payments: [cash("USD", 100), cash("LBP", 1000000)],
    },
    directions: ["OUT", "OUT"],
  },
  {
    flow: "Whish system RECEIVE: $98 paid out, $2 fee collected",
    input: {
      flow: "PAYOUT",
      payments: [cash("USD", 98)],
      feePayments: [cash("USD", 2)],
    },
    directions: ["OUT", "IN"],
  },
  {
    flow: "Binance cash-out: $147 paid out, customer sends 150 USDT",
    input: {
      flow: "PAYOUT",
      payments: [cash("USD", 147)],
      customerPayments: [
        { method: "BINANCE", currencyCode: "USDT", amount: 150 },
      ],
    },
    directions: ["OUT", "IN"],
  },
  {
    flow: "Whish App top-up from a client: $97 paid out",
    input: { flow: "PAYOUT", payments: [cash("USD", 97)] },
    directions: ["OUT"],
  },
  {
    flow: "account settlement paying in USD and collecting in LBP (per-leg flow)",
    input: {
      flow: "PAYOUT",
      payments: [
        { ...cash("USD", 100), flow: "PAYOUT" },
        { ...cash("LBP", 500000), flow: "IN" },
        { ...cash("LBP", 50000, "OUT"), flow: "IN" },
      ],
    },
    directions: ["OUT", "IN", "OUT"],
  },
];

describe("buildPaymentSnapshot — each line records how the money moved (shop-day Q1)", () => {
  it.each(CASES.map((c) => [c.flow, c] as const))("%s", (_name, c) => {
    const snapshot = buildPaymentSnapshot(c.input);
    expect(paymentSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot?.lines.map((l) => l.direction)).toEqual(c.directions);
  });

  it("lists the change handed back separately on a sale, and the change a vendor hands back on a payout", () => {
    const sale = buildPaymentSnapshot({
      flow: "IN",
      payments: [cash("USD", 20), cash("USD", 5, "OUT")],
    });
    expect(sale?.change_returned).toEqual([
      { method: "CASH", currency: "USD", amount: 5 },
    ]);
    const expense = buildPaymentSnapshot({
      flow: "PAYOUT",
      payments: [cash("USD", 20), cash("USD", 1, "OUT")],
    });
    expect(expense?.change_returned).toEqual([
      { method: "CASH", currency: "USD", amount: 1 },
    ]);
  });
});
