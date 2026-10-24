/**
 * LIRA-339 T011 — rule 28(d) variant table: every tender shape a voucher sale
 * can take, built as the Vouchers page sends it, through the REAL
 * `VoucherService.createVoucher` on the real schema. Each row must be
 * accepted, and the drawer / customer-account deltas must equal the legs.
 */
import type Database from "better-sqlite3";
import {
  installVoucherSaleDb,
  uninstallVoucherSaleDb,
  voucherTxns,
  OWNER,
  RATE,
} from "../../repositories/testHelpers/voucherSaleDb";
import {
  snapshotLedgers,
  expectPostings,
  type LedgerBalances,
} from "../../repositories/testHelpers/postingAssert";
import { getVoucherService } from "../VoucherService";
import { paymentMethodToDrawerName } from "../../utils/payments";
import type { VoucherCreateInput } from "../../validators/voucher";

type SaleLeg = NonNullable<VoucherCreateInput["payments"]>[number];

interface Variant {
  name: string;
  currency: "USD" | "LBP";
  amount: number;
  payments?: SaleLeg[];
  drawers: () => LedgerBalances;
  debt?: LedgerBalances;
}

const LBP_VOUCHER = 900_000;

const VARIANTS: Variant[] = [
  {
    name: "USD voucher, USD cash exact",
    currency: "USD",
    amount: 50,
    payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
    drawers: () => ({ "General|USD": 50 }),
  },
  {
    name: "USD voucher, LBP cash at the stamped rate",
    currency: "USD",
    amount: 50,
    payments: [{ method: "CASH", currency_code: "LBP", amount: 50 * RATE }],
    drawers: () => ({ "General|LBP": 50 * RATE }),
  },
  {
    name: "USD voucher, split CASH + WHISH",
    currency: "USD",
    amount: 50,
    payments: [
      { method: "CASH", currency_code: "USD", amount: 20 },
      { method: "WHISH", currency_code: "USD", amount: 30 },
    ],
    drawers: () => ({
      "General|USD": 20,
      [`${paymentMethodToDrawerName("WHISH")}|USD`]: 30,
    }),
  },
  {
    name: "USD voucher, overpaid with change",
    currency: "USD",
    amount: 50,
    payments: [
      { method: "CASH", currency_code: "USD", amount: 60 },
      { method: "CASH", currency_code: "USD", amount: 10, direction: "OUT" },
    ],
    drawers: () => ({ "General|USD": 50 }),
  },
  {
    name: "LBP voucher, LBP exact",
    currency: "LBP",
    amount: LBP_VOUCHER,
    payments: [{ method: "CASH", currency_code: "LBP", amount: LBP_VOUCHER }],
    drawers: () => ({ "General|LBP": LBP_VOUCHER }),
  },
  {
    name: "LBP voucher, paid in USD with LBP change",
    currency: "LBP",
    amount: LBP_VOUCHER,
    payments: [
      { method: "CASH", currency_code: "USD", amount: 20 },
      {
        method: "CASH",
        currency_code: "LBP",
        amount: 20 * RATE - LBP_VOUCHER,
        direction: "OUT",
      },
    ],
    drawers: () => ({
      "General|USD": 20,
      "General|LBP": -(20 * RATE - LBP_VOUCHER),
    }),
  },
  {
    name: "USD voucher, no legs (fallback CASH in the voucher currency)",
    currency: "USD",
    amount: 50,
    drawers: () => ({ "General|USD": 50 }),
  },
  {
    name: "LBP voucher, no legs (fallback CASH in the voucher currency)",
    currency: "LBP",
    amount: LBP_VOUCHER,
    drawers: () => ({ "General|LBP": LBP_VOUCHER }),
  },
  {
    name: "USD voucher, all on account",
    currency: "USD",
    amount: 50,
    payments: [
      { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 50 },
    ],
    drawers: () => ({}),
    debt: { [`${OWNER}|USD`]: 50 },
  },
  {
    name: "LBP voucher, all on account",
    currency: "LBP",
    amount: LBP_VOUCHER,
    payments: [
      { method: "CUSTOMER_ACCOUNT", currency_code: "LBP", amount: LBP_VOUCHER },
    ],
    drawers: () => ({}),
    debt: { [`${OWNER}|LBP`]: LBP_VOUCHER },
  },
  {
    name: "USD voucher, split cash + account",
    currency: "USD",
    amount: 50,
    payments: [
      { method: "CASH", currency_code: "USD", amount: 20 },
      { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 30 },
    ],
    drawers: () => ({ "General|USD": 20 }),
    debt: { [`${OWNER}|USD`]: 30 },
  },
];

let db: Database.Database;
beforeEach(() => {
  db = installVoucherSaleDb();
});
afterEach(() => uninstallVoucherSaleDb(db));

describe("T011 — voucher sale variants", () => {
  it.each(VARIANTS.map((v) => [v.name, v] as const))("%s", (_name, v) => {
    const before = snapshotLedgers(db);
    const res = getVoucherService().createVoucher(
      {
        clientId: OWNER,
        amount: v.amount,
        currency: v.currency,
        exchange_rate: RATE,
        ...(v.payments ? { payments: v.payments } : {}),
      },
      1,
    );
    expect(res.error).toBeUndefined();
    expect(res.success).toBe(true);
    expect(voucherTxns(db, res.voucher!.id, "VOUCHER_SALE")).toHaveLength(1);
    expectPostings(before, snapshotLedgers(db), {
      drawers: v.drawers(),
      ...(v.debt ? { debt: v.debt } : {}),
    });
  });
});
