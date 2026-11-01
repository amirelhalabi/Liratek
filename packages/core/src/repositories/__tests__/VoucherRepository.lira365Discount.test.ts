/**
 * LIRA-365 US3 (T024) — a discount on a voucher sale.
 *
 * A $50 voucher sold for $48 (owner decision 2026-10-31, research R5):
 *   - the VOUCHER_SALE row records what was PAID ($48); the voucher keeps its
 *     $50 face value (it is still worth $50 when used);
 *   - the $2 is the shop's cost: ONE books-only, auto "Discount given"
 *     expense linked to the voucher (`source_ref_table = 'vouchers'`);
 *   - `details.discount` records it (FR-010);
 *   - the cap is the shortfall cap ($5 / 450,000 LBP), and the discount must
 *     be less than the face value — refused by the schema (both transports)
 *     AND by the repository (offline replay skips Zod);
 *   - `cancelWithRefund` (the reversal owner, rule 20) refunds what was paid
 *     and voids the expense: drawer, debt and expenses net 0 per currency.
 *
 * Payloads are parsed through `voucherCreateSchema` (rule 24): before the
 * schema knew `discount_amount`, Zod stripped it and every case here failed
 * on behaviour, not on a compile error (rule 17, rule 28a).
 */
import type Database from "better-sqlite3";
import {
  installVoucherSaleDb,
  uninstallVoucherSaleDb,
  voucherTxns,
  paymentsOf,
  debtRowsOf,
  OWNER,
  RATE,
} from "../testHelpers/voucherSaleDb";
import {
  snapshotLedgers,
  ledgerDeltas,
  expectPostings,
} from "../testHelpers/postingAssert";
import {
  getVoucherService,
  type CreateVoucherInput,
} from "../../services/VoucherService";
import { getVoucherRepository } from "../VoucherRepository";
import { resetExpenseRepository } from "../ExpenseRepository";
import {
  voucherCreateSchema,
  type VoucherCreatePayload,
  type VoucherCancelInput,
} from "../../validators/voucher";
import {
  DISCOUNT_ABOVE_CAP_MESSAGE,
  DISCOUNT_ABOVE_TOTAL_MESSAGE,
  DISCOUNT_GIVEN_EXPENSE_CATEGORY,
} from "../../validators/discount";

type SaleLeg = NonNullable<VoucherCreatePayload["payments"]>[number];

let db: Database.Database;
beforeEach(() => {
  db = installVoucherSaleDb();
  resetExpenseRepository();
});
afterEach(() => {
  resetExpenseRepository();
  uninstallVoucherSaleDb(db);
});

const cash = (
  currency_code: "USD" | "LBP",
  amount: number,
  direction?: "OUT",
): SaleLeg => ({
  method: "CASH",
  currency_code,
  amount,
  ...(direction ? { direction } : {}),
});
const onAccount = (currency_code: "USD" | "LBP", amount: number): SaleLeg => ({
  method: "CUSTOMER_ACCOUNT",
  currency_code,
  amount,
});

/** Parsed through the schema exactly as both transports do. */
function sell(payload: Record<string, unknown>) {
  const parsed = voucherCreateSchema.parse({
    clientId: OWNER,
    exchange_rate: RATE,
    ...payload,
  });
  return getVoucherService().createVoucher(
    parsed as unknown as CreateVoucherInput,
    1,
  );
}

type ExpenseRow = {
  id: number;
  category: string;
  amount_usd: number;
  amount_lbp: number;
  source_ref_table: string;
  source_ref_id: number;
};

function discountExpenses(voucherId: number): ExpenseRow[] {
  return db
    .prepare(
      `SELECT id, category, amount_usd, amount_lbp, source_ref_table, source_ref_id
         FROM expenses WHERE source_ref_table = 'vouchers' AND source_ref_id = ?`,
    )
    .all(voucherId) as ExpenseRow[];
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

/** Expenses that still count (their transaction is ACTIVE), per currency. */
function activeExpenseTotals(): { usd: number; lbp: number } {
  return db
    .prepare(
      `SELECT COALESCE(SUM(e.amount_usd), 0) AS usd, COALESCE(SUM(e.amount_lbp), 0) AS lbp
         FROM expenses e
         JOIN transactions t ON t.source_table = 'expenses' AND t.source_id = e.id
          AND t.reverses_id IS NULL
        WHERE t.status = 'ACTIVE'`,
    )
    .get() as { usd: number; lbp: number };
}

function cancel(id: number, input: VoucherCancelInput) {
  return getVoucherService().cancelVoucher(id, input, 1);
}

describe("LIRA-365 US3 — a discounted voucher sale", () => {
  it("$50 voucher, $2 discount, $48 cash: sale = $48, voucher = $50, one $2 'Discount given'", () => {
    const before = snapshotLedgers(db);
    const res = sell({
      amount: 50,
      currency: "USD",
      discount_amount: 2,
      payments: [cash("USD", 48)],
    });
    expect(res.error).toBeUndefined();
    expect(res.success).toBe(true);
    const voucher = res.voucher!;
    expect(voucher.amount).toBe(50);

    const [sale] = voucherTxns(db, voucher.id, "VOUCHER_SALE");
    expect(sale).toMatchObject({ amount_usd: 48, amount_lbp: 0 });
    expect(paymentsOf(db, sale!.id).map((p) => p.amount)).toEqual([48]);
    expect(ledgerDeltas(before, snapshotLedgers(db)).drawers).toEqual({
      "General|USD": 48,
    });

    const exp = discountExpenses(voucher.id);
    expect(exp).toHaveLength(1);
    expect(exp[0]).toMatchObject({
      category: DISCOUNT_GIVEN_EXPENSE_CATEGORY,
      amount_usd: 2,
      amount_lbp: 0,
    });
    // Books-only: the expense moved no drawer (the deltas above are +48 only).

    const details = JSON.parse(sale!.metadata_json ?? "{}").details;
    expect(details.discount).toEqual({ amount: 2, currency: "USD" });

    // The voucher is still worth $50 when used.
    expect(getVoucherRepository().findByIdOrFail(voucher.id).amount).toBe(50);
  });

  it("no legs sent: the one default CASH leg is what was paid ($48)", () => {
    const before = snapshotLedgers(db);
    const res = sell({ amount: 50, currency: "USD", discount_amount: 2 });
    expect(res.success).toBe(true);
    expect(ledgerDeltas(before, snapshotLedgers(db)).drawers).toEqual({
      "General|USD": 48,
    });
  });

  it("legs for the full $50 with a $2 discount are refused (they must cover $48)", () => {
    const res = sell({
      amount: 50,
      currency: "USD",
      discount_amount: 2,
      payments: [cash("USD", 50)],
    });
    expect(res.success).toBe(false);
  });

  it("LBP voucher: 450,000 LBP discount (the cap) is accepted", () => {
    const res = sell({
      amount: 4_500_000,
      currency: "LBP",
      discount_amount: 450_000,
      payments: [cash("LBP", 4_050_000)],
    });
    expect(res.error).toBeUndefined();
    const [sale] = voucherTxns(db, res.voucher!.id, "VOUCHER_SALE");
    expect(sale).toMatchObject({ amount_usd: 0, amount_lbp: 4_050_000 });
    expect(discountExpenses(res.voucher!.id)[0]).toMatchObject({
      amount_usd: 0,
      amount_lbp: 450_000,
    });
  });

  it.each([
    ["above the cap ($6)", 50, 6, DISCOUNT_ABOVE_CAP_MESSAGE],
    ["the whole face value ($5 on a $5 voucher)", 5, 5, DISCOUNT_ABOVE_TOTAL_MESSAGE],
  ])("refused %s — by the schema and by the repository", (_l, amount, discount, message) => {
    const parsed = voucherCreateSchema.safeParse({
      clientId: OWNER,
      amount,
      currency: "USD",
      discount_amount: discount,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((i) => i.message)).toContain(message);
    }

    const before = snapshotLedgers(db);
    expect(() =>
      getVoucherRepository().sellVoucher(
        {
          code: "GIFT-TEST-0001",
          client_id: OWNER,
          client_name: "Jane Owner",
          client_phone: "70111222",
          amount,
          currency_code: "USD",
          expiry_date: null,
          note: null,
          created_by: 1,
          discount_amount: discount,
        },
        [cash("USD", amount - discount)],
      ),
    ).toThrow(message);
    expectPostings(before, snapshotLedgers(db), {});
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM vouchers`).get() as { n: number })
        .n,
    ).toBe(0);
  });
});

describe("LIRA-365 US3 — cancel refunds what was paid and voids the expense (rule 20)", () => {
  it("cash sale: refund $48, expense voided, every ledger nets 0", () => {
    const before = snapshotLedgers(db);
    const expBefore = activeExpenseTotals();
    const res = sell({
      amount: 50,
      currency: "USD",
      discount_amount: 2,
      payments: [cash("USD", 48)],
    });
    const id = res.voucher!.id;
    const expenseId = discountExpenses(id)[0]!.id;

    const out = cancel(id, { payments: [{ method: "CASH", currency_code: "USD", amount: 48 }] });
    expect(out.error).toBeUndefined();
    expect(out.refunded).toEqual({
      cash: { usd: 48, lbp: 0 },
      toAccount: { usd: 0, lbp: 0 },
    });
    expectPostings(before, snapshotLedgers(db), {});
    expect(expenseTxnStatus(expenseId)).toBe("VOIDED");
    expect(activeExpenseTotals()).toEqual(expBefore);
  });

  it("$38 cash + $10 on account: refund $38 cash, $10 back to the account, expense voided, nets 0", () => {
    const before = snapshotLedgers(db);
    const expBefore = activeExpenseTotals();
    const res = sell({
      amount: 50,
      currency: "USD",
      discount_amount: 2,
      payments: [cash("USD", 38), onAccount("USD", 10)],
    });
    expect(res.error).toBeUndefined();
    const id = res.voucher!.id;
    const [sale] = voucherTxns(db, id, "VOUCHER_SALE");
    expect(sale).toMatchObject({ amount_usd: 48 });
    expect(
      debtRowsOf(db, sale!.id).filter((d) => d.transaction_type === "Voucher Debt"),
    ).toEqual([
      expect.objectContaining({ amount_usd: 10, amount_lbp: 0 }),
    ]);
    const expenseId = discountExpenses(id)[0]!.id;

    const out = cancel(id, {});
    expect(out.error).toBeUndefined();
    expect(out.refunded).toEqual({
      cash: { usd: 38, lbp: 0 },
      toAccount: { usd: 10, lbp: 0 },
    });
    expectPostings(before, snapshotLedgers(db), {});
    expect(expenseTxnStatus(expenseId)).toBe("VOIDED");
    expect(activeExpenseTotals()).toEqual(expBefore);
  });

  it("LBP sale: cancel nets 0 in LBP and voids the 450,000 LBP expense", () => {
    const before = snapshotLedgers(db);
    const expBefore = activeExpenseTotals();
    const res = sell({
      amount: 4_500_000,
      currency: "LBP",
      discount_amount: 450_000,
      payments: [cash("LBP", 4_050_000)],
    });
    const id = res.voucher!.id;
    const out = cancel(id, {});
    expect(out.error).toBeUndefined();
    expectPostings(before, snapshotLedgers(db), {});
    expect(activeExpenseTotals()).toEqual(expBefore);
  });
});
