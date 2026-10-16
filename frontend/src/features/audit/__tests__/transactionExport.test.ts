/**
 * Owner decision 2026-10-16 — every Transactions export carries each
 * transaction's details: a "Details" text per row, a "Details" sheet (one
 * row per saved field) and a "Payments" sheet (one row per payment line).
 * All three come from the Details panel's own derivation
 * (`buildTransactionDetailsView`), so the export shows exactly what the panel
 * shows — costs only for admins.
 *
 * Written before the builders and seen failing (rule 17).
 */
import {
  DETAILS_SHEET_HEADERS,
  PAYMENTS_SHEET_HEADERS,
  detailsLineText,
  detailsSheetRows,
  paymentsSheetRows,
  transactionExtraSheets,
  type ExportContext,
} from "../transactionExport";
import type { TransactionRow } from "../hooks/useTransactionRows";

function row(overrides: Partial<TransactionRow>): TransactionRow {
  return {
    id: 1,
    type: "SALE",
    status: "ACTIVE",
    source_table: "sales",
    source_id: 1,
    user_id: 1,
    amount_usd: 0,
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

const labels: Record<string, string> = { CASH: "Cash", OMT_WALLET: "OMT" };
const staff: ExportContext = {
  isAdmin: false,
  methodLabel: (c) => labels[c] ?? c,
};
const admin: ExportContext = { ...staff, isAdmin: true };

const omtRow = row({
  id: 701,
  type: "FINANCIAL_SERVICE",
  summary: "OMT receive",
  metadata_json: JSON.stringify({
    details: {
      v: 1,
      kind: "omt_whish_transfer",
      serviceType: "CASH_TO_BUSINESS",
      reference: "R-123",
      sender: { name: "Ali Saad", phone: "70123456" },
      omtFee: 5,
      currency: "USD",
      commissionUsd: 1.25,
    },
    payment_snapshot: {
      lines: [
        { method: "CASH", currency: "USD", amount: 100, direction: "OUT" },
        {
          method: "OMT_WALLET",
          currency: "USD",
          amount: 5,
          direction: "IN",
          note: "fee",
        },
      ],
      change_returned: [{ method: "CASH", currency: "LBP", amount: 45000 }],
      kept: { usd: 0, lbp: 5000 },
      session_id: 12,
    },
  }),
});

const saleRow = row({
  id: 702,
  summary: "Sale #77",
  metadata_json: JSON.stringify({
    details: {
      v: 1,
      kind: "pos_sale",
      items: [
        { name: "iPhone 13", imei: "350000000000001", unitCost: 412.5 },
        { name: "Case", unitPrice: 6 },
      ],
    },
  }),
});

const legacyRow = row({
  id: 703,
  type: "RECHARGE",
  summary: "MTC card",
  metadata_json: JSON.stringify({ provider: "MTC", cost_usd: 3.75 }),
});

const emptyRow = row({ id: 704, summary: "Old sale" });

const reversalRow = row({
  id: 705,
  type: "REFUND",
  status: "VOIDED",
  reverses_id: 504,
  returned_credits_usd: -3,
  summary: "Refund",
});

describe("detailsLineText — one readable line per row", () => {
  it("joins the panel's fields as 'Field: value' with ' · '", () => {
    expect(detailsLineText(omtRow, staff)).toBe(
      "Service type: Cash to business · Reference: R-123 · Sender: Ali Saad · 70123456 · OMT fee: $5.00 · Currency: USD",
    );
  });

  it("an admin also gets the cost fields", () => {
    expect(detailsLineText(omtRow, admin)).toContain("Commission USD: $1.25");
    expect(detailsLineText(omtRow, staff)).not.toContain("1.25");
  });

  it("array items read 'Item 1 · Field: value'", () => {
    const text = detailsLineText(saleRow, staff);
    expect(text).toContain("Item 1 · Name: iPhone 13");
    expect(text).toContain("Item 1 · IMEI: 350000000000001");
    expect(text).toContain("Item 2 · Name: Case");
    expect(text).not.toContain("412");
  });

  it("an older row shows its saved keys the same way", () => {
    expect(detailsLineText(legacyRow, staff)).toBe("Provider: MTC");
    expect(detailsLineText(legacyRow, admin)).toBe(
      "Provider: MTC · Cost USD: $3.75",
    );
  });

  it("a row with nothing saved is empty", () => {
    expect(detailsLineText(emptyRow, staff)).toBe("");
  });

  it("status, reversal and returned credits lead the line when they apply", () => {
    expect(detailsLineText(reversalRow, staff)).toBe(
      "Status: Voided · Reverses: #504 · Returned credits: −$3",
    );
  });
});

describe("detailsSheetRows — one row per field", () => {
  it("has the agreed headers", () => {
    expect(DETAILS_SHEET_HEADERS).toEqual([
      "Txn #",
      "Time",
      "Type",
      "Section",
      "Field",
      "Value",
    ]);
  });

  it("lists every field with its section, items one row per field", () => {
    const rows = detailsSheetRows([omtRow, saleRow, legacyRow], staff);
    expect(rows).toContainEqual([
      "701",
      "16 Oct 2026, 12:30",
      expect.any(String),
      "Details",
      "Sender",
      "Ali Saad · 70123456",
    ]);
    expect(rows).toContainEqual([
      "702",
      "16 Oct 2026, 12:30",
      expect.any(String),
      "Details",
      "Item 1 · IMEI",
      "350000000000001",
    ]);
    expect(rows).toContainEqual([
      "703",
      "16 Oct 2026, 12:30",
      expect.any(String),
      "Other saved data",
      "Provider",
      "MTC",
    ]);
  });

  it("status facts go in a 'Transaction' section", () => {
    const rows = detailsSheetRows([reversalRow], staff);
    expect(rows.map((r) => [r[3], r[4], r[5]])).toEqual([
      ["Transaction", "Status", "Voided"],
      ["Transaction", "Reverses", "#504"],
      ["Transaction", "Returned credits", "−$3"],
    ]);
  });

  it("a row with nothing saved adds no rows", () => {
    expect(detailsSheetRows([emptyRow], staff)).toEqual([]);
  });
});

describe("paymentsSheetRows — one row per payment line", () => {
  it("has the agreed headers", () => {
    expect(PAYMENTS_SHEET_HEADERS).toEqual([
      "Txn #",
      "Time",
      "Type",
      "Kind",
      "In/Out",
      "Method",
      "Currency",
      "Amount",
      "Note",
    ]);
  });

  it("lines, change returned, kept change and the session", () => {
    const rows = paymentsSheetRows([omtRow], staff).map((r) => r.slice(3));
    expect(rows).toEqual([
      ["line", "Out", "Cash", "USD", "$100.00", ""],
      ["line", "In", "OMT", "USD", "$5.00", "fee"],
      ["change returned", "Out", "Cash", "LBP", "45,000 LBP", ""],
      ["kept", "", "", "LBP", "5,000 LBP", ""],
      ["paid in session", "", "", "", "", "Session #12"],
    ]);
  });

  it("rows with no payment snapshot add nothing", () => {
    expect(paymentsSheetRows([emptyRow, legacyRow], staff)).toEqual([]);
  });
});

describe("cost hiding across every sheet", () => {
  const allCells = (ctx: ExportContext) =>
    transactionExtraSheets([omtRow, saleRow, legacyRow], ctx)
      .flatMap((s) => s.rows.flat())
      .concat([omtRow, saleRow, legacyRow].map((r) => detailsLineText(r, ctx)))
      .join("\n");

  it("staff: no cost value appears anywhere", () => {
    const text = allCells(staff);
    expect(text).not.toMatch(/412\.5|1\.25|3\.75/);
  });

  it("admin: the cost values are there", () => {
    const text = allCells(admin);
    expect(text).toMatch(/412\.5/);
    expect(text).toMatch(/\$1\.25/);
    expect(text).toMatch(/\$3\.75/);
  });

  it("the sheets are named Details and Payments", () => {
    expect(transactionExtraSheets([omtRow], staff).map((s) => s.name)).toEqual([
      "Details",
      "Payments",
    ]);
  });
});
