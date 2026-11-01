/**
 * LIRA-366 T030 — the note typed on the voucher sale form travels as
 * `typedNote` and lands in every copy: the voucher's own `note` column,
 * the sale's `details.note`, and the customer's debt note when part is put
 * on account (`"Voucher sold <code> — <typed>"`). Vouchers have no edit
 * path, so the note is a snapshot taken at sale time.
 *
 * Payloads go through the real `voucherCreateSchema` (rule 24) and the real
 * service. Rule 17: seen failing before the voucher path read `typedNote`.
 */
import type Database from "better-sqlite3";
import {
  installVoucherSaleDb,
  uninstallVoucherSaleDb,
  voucherTxns,
  OWNER,
} from "../testHelpers/voucherSaleDb";
import { readTypedNoteCopies } from "../testHelpers/typedNoteAssert";
import { snapshotLedgers, expectPostings } from "../testHelpers/postingAssert";
import { getVoucherService } from "../../services/VoucherService";
import {
  voucherCreateSchema,
  type VoucherCreatePayload,
} from "../../validators/voucher";

let db: Database.Database;
beforeEach(() => {
  db = installVoucherSaleDb();
});
afterEach(() => {
  jest.restoreAllMocks();
  uninstallVoucherSaleDb(db);
});

function sell(payload: VoucherCreatePayload) {
  return getVoucherService().createVoucher(
    voucherCreateSchema.parse(payload),
    1,
  );
}

const noteColumn = (id: number) =>
  (
    db.prepare(`SELECT note FROM vouchers WHERE id = ?`).get(id) as {
      note: string | null;
    }
  ).note;

describe("LIRA-366 — voucher sale typed note", () => {
  it("$50: $30 cash + $20 on account, note 'rest on Monday' → all three copies", () => {
    const before = snapshotLedgers(db);
    const res = sell({
      clientId: OWNER,
      amount: 50,
      currency: "USD",
      typedNote: "  rest on Monday ",
      payments: [
        { method: "CASH", currency_code: "USD", amount: 30 },
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 20 },
      ],
    });
    expect(res.success).toBe(true);
    // Money unchanged by the note.
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": 30 },
      debt: { [`${OWNER}|USD`]: 20 },
    });

    const voucher = res.voucher!;
    const [sale] = voucherTxns(db, voucher.id, "VOUCHER_SALE");
    expect(noteColumn(voucher.id)).toBe("rest on Monday");
    expect(readTypedNoteCopies(db, sale.id)).toEqual({
      detailsNote: "rest on Monday",
      debtNotes: [`Voucher sold ${voucher.code} — rest on Monday`],
    });
  });

  it("no typed note → no details.note, debt note is the system note only", () => {
    const res = sell({
      clientId: OWNER,
      amount: 50,
      currency: "USD",
      typedNote: "   ",
      payments: [
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 50 },
      ],
    });
    expect(res.success).toBe(true);
    const voucher = res.voucher!;
    const [sale] = voucherTxns(db, voucher.id, "VOUCHER_SALE");
    expect(noteColumn(voucher.id)).toBeNull();
    expect(readTypedNoteCopies(db, sale.id)).toEqual({
      detailsNote: undefined,
      debtNotes: [`Voucher sold ${voucher.code}`],
    });
  });

  it("an old caller still sending `note` keeps working (offline / cached build)", () => {
    const res = sell({
      clientId: OWNER,
      amount: 50,
      currency: "USD",
      note: "for his son",
      payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
    });
    expect(res.success).toBe(true);
    const voucher = res.voucher!;
    const [sale] = voucherTxns(db, voucher.id, "VOUCHER_SALE");
    expect(noteColumn(voucher.id)).toBe("for his son");
    expect(readTypedNoteCopies(db, sale.id).detailsNote).toBe("for his son");
  });
});
