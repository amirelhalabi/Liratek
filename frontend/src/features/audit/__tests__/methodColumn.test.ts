/**
 * Owner decision 2026-10-16 — the Method column names how the MAIN money
 * moved: on a row whose money comes in (a sale), what the customer paid
 * with; on a payout (an OMT / Whish / Binance receive), how the payout left.
 * Change and fee legs never count. A session item with no legs of its own
 * shows its session. ONE function (`methodText` / `methodBrand`) feeds the
 * screen cell, the export, the sort and the brand icon.
 *
 * Table-driven, legs shaped like `TransactionRepository.getRecent` returns
 * them (`direction`, `amount`, `signed_amount`, `currency_code`, `method`,
 * `drawer_name`). Written before the change and seen failing (rule 17).
 */
import { methodBrand, methodText } from "../transactionCellText";
import type { TransactionRow } from "../hooks/useTransactionRows";

type Leg = NonNullable<TransactionRow["payments"]>[number];

function leg(
  direction: "in" | "out",
  method: string,
  amount: number,
  currency_code = "USD",
  drawer_name = "General",
): Leg {
  return {
    direction,
    method,
    amount,
    signed_amount: direction === "in" ? amount : -amount,
    currency_code,
    drawer_name,
  };
}

function row(overrides: Partial<TransactionRow>): TransactionRow {
  return {
    id: 1,
    type: "SALE",
    status: "ACTIVE",
    source_table: "sales",
    source_id: 1,
    user_id: 1,
    amount_usd: 10,
    amount_lbp: 0,
    exchange_rate: 89500,
    client_id: null,
    reverses_id: null,
    summary: null,
    metadata_json: null,
    device_id: null,
    created_at: "2026-10-16 09:30:00",
    username: "cashier",
    client_name: null,
    session_id: null,
    reversed_by_id: null,
    payments: [],
    ...overrides,
  } as TransactionRow;
}

const receive = (provider: string) =>
  JSON.stringify({ service_type: "RECEIVE", provider });

const labels = new Map([
  ["CASH", "Cash"],
  ["OMT_WALLET", "OMT Wallet"],
  ["WHISH_WALLET", "Whish Wallet"],
  ["BINANCE", "Binance"],
]);

const cases: {
  name: string;
  row: TransactionRow;
  method: string;
  brand: string | null;
}[] = [
  {
    name: "POS sale, cash with change back",
    row: row({
      payments: [leg("in", "CASH", 10), leg("out", "CASH", 0.5)],
    }),
    method: "Cash",
    brand: null,
  },
  {
    name: "POS sale, split cash + OMT wallet",
    row: row({
      payments: [
        leg("in", "CASH", 6),
        leg("in", "OMT_WALLET", 4, "USD", "OMT_App"),
      ],
    }),
    method: "Cash + OMT Wallet",
    brand: null,
  },
  {
    name: "Whish system receive: cash payout, cash fee in",
    row: row({
      type: "FINANCIAL_SERVICE",
      source_table: "financial_services",
      metadata_json: receive("WHISH_SYSTEM"),
      payments: [leg("out", "CASH", 100), leg("in", "CASH", 5)],
    }),
    method: "Cash",
    brand: null,
  },
  {
    name: "OMT receive: cash payout, fee paid in by OMT wallet",
    row: row({
      type: "FINANCIAL_SERVICE",
      source_table: "financial_services",
      metadata_json: receive("OMT_SYSTEM"),
      payments: [
        leg("out", "CASH", 100),
        leg("in", "OMT_WALLET", 5, "USD", "OMT_App"),
      ],
    }),
    method: "Cash",
    brand: null,
  },
  {
    name: "Binance cash-out: the USDT side never reaches the row, cash out",
    row: row({
      type: "FINANCIAL_SERVICE",
      source_table: "financial_services",
      metadata_json: receive("BINANCE"),
      payments: [leg("out", "CASH", 95), leg("in", "CASH", 2)],
    }),
    method: "Cash",
    brand: null,
  },
  {
    name: "Whish receive paid out by Whish wallet, fee in cash",
    row: row({
      type: "FINANCIAL_SERVICE",
      source_table: "financial_services",
      metadata_json: receive("WHISH"),
      payments: [
        leg("out", "WHISH_WALLET", 100, "USD", "Whish_App"),
        leg("in", "CASH", 5),
      ],
    }),
    method: "Whish Wallet",
    brand: "WHISH",
  },
  {
    name: "void of an OMT receive: the payout coming back is the main money",
    row: row({
      type: "FINANCIAL_SERVICE",
      source_table: "financial_services",
      metadata_json: receive("OMT_SYSTEM"),
      reverses_id: 9,
      status: "ACTIVE",
      payments: [
        leg("in", "CASH", 100),
        leg("out", "OMT_WALLET", 5, "USD", "OMT_App"),
      ],
    }),
    method: "Cash",
    brand: null,
  },
  {
    name: "expense",
    row: row({
      type: "EXPENSE",
      source_table: "expenses",
      payments: [leg("out", "CASH", 20)],
    }),
    method: "Cash",
    brand: null,
  },
  {
    name: "supplier payment by Whish wallet",
    row: row({
      type: "SUPPLIER_PAYMENT",
      source_table: "supplier_ledger",
      metadata_json: JSON.stringify({ counterparty: { flow: "OUT" } }),
      payments: [leg("out", "WHISH_WALLET", 300, "USD", "Whish_App")],
    }),
    method: "Whish Wallet",
    brand: "WHISH",
  },
  {
    name: "Loto cash prize",
    row: row({
      type: "LOTO_CASH_PRIZE",
      source_table: "loto_cash_prizes",
      payments: [leg("out", "CASH", 50)],
    }),
    method: "Cash",
    brand: null,
  },
  {
    name: "session item with no legs of its own",
    row: row({ type: "LOTO", source_table: "loto_tickets", session_id: 42 }),
    method: "Session #42",
    brand: null,
  },
  {
    name: "checkpoint",
    row: row({
      type: "CHECKPOINT",
      source_table: "drawer_checkpoints",
      payments: [leg("in", "CHECKPOINT_ADJUSTMENT", 3)],
    }),
    method: "—",
    brand: null,
  },
  {
    name: "a row with no legs outside a session keeps today's dash",
    row: row({ type: "MAINTENANCE", source_table: "maintenance" }),
    method: "—",
    brand: null,
  },
];

describe("Method column — the main money's method", () => {
  it.each(cases)("$name → $method", ({ row: r, method, brand }) => {
    expect(methodText(r, labels)).toBe(method);
    expect(methodBrand(r)).toBe(brand);
  });
});
