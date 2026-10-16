import * as XLSX from "xlsx";
import type { DebtLedgerEntity } from "@liratek/ui";
import {
  buildDebtExportWorkbook,
  isPaymentLedgerType,
  type DebtExportClient,
} from "../debtExcelExport";

let nextId = 1;
function entry(
  over: Partial<DebtLedgerEntity> & {
    transaction_type: string;
    created_at: string;
  },
): DebtLedgerEntity {
  return {
    id: nextId++,
    client_id: 1,
    transaction_id: null,
    amount_usd: 0,
    amount_lbp: 0,
    note: null,
    created_by: null,
    session_id: null,
    ...over,
  };
}

/** Write then read back, so the test sees what Excel would open. */
function roundTrip(clients: DebtExportClient[]): XLSX.WorkBook {
  const buf = XLSX.write(buildDebtExportWorkbook(clients), {
    bookType: "xlsx",
    type: "array",
  });
  return XLSX.read(buf, { type: "array", cellDates: true });
}

function rowsOf(wb: XLSX.WorkBook, sheet: string): unknown[][] {
  return XLSX.utils.sheet_to_json(wb.Sheets[sheet]!, {
    header: 1,
    defval: "",
    raw: true,
  });
}

const sara: DebtExportClient = {
  name: "SARA/ZOHAIR BOU ISMAIL",
  phone: "71475799",
  history: [
    // Out of order on purpose — the export sorts oldest first.
    entry({
      transaction_type: "Repayment",
      created_at: "2025-11-25 10:00:00",
      amount_lbp: -2_280_000,
      note: "paid by hweli",
    }),
    entry({
      transaction_type: "Recharge Debt",
      created_at: "2025-11-15 09:00:00",
      amount_lbp: 520_000,
      note: "5$ MTC",
    }),
    entry({
      transaction_type: "Manual Debt",
      created_at: "2025-06-10 09:00:00",
      amount_usd: 12,
      amount_lbp: 500_000,
      note: "CARTE + W2W",
    }),
    entry({
      transaction_type: "Repayment",
      created_at: "2025-10-27 10:00:00",
      amount_usd: -12,
      amount_lbp: -800_000,
      note: "paid by sara",
    }),
  ],
};

describe("buildDebtExportWorkbook — the debt import template", () => {
  it("starts with a List Name sheet of NAME | Phone", () => {
    const wb = roundTrip([sara]);
    expect(wb.SheetNames[0]).toBe("List Name");
    expect(rowsOf(wb, "List Name")).toEqual([
      ["NAME", "Phone "],
      ["SARA/ZOHAIR BOU ISMAIL", "71475799"],
    ]);
  });

  it("lays a client page out as the import reads it", () => {
    const wb = roundTrip([sara]);
    // "/" is not allowed in a sheet name; the real name stays in B1.
    expect(wb.SheetNames[1]).toBe("SARA ZOHAIR BOU ISMAIL");
    const rows = rowsOf(wb, "SARA ZOHAIR BOU ISMAIL");

    expect(rows[0]!.slice(0, 4)).toEqual([
      "CUSTOMER NAME :",
      "SARA/ZOHAIR BOU ISMAIL",
      "mobile # ",
      "71475799",
    ]);
    expect(rows[1]).toEqual([
      "DATE",
      "USD",
      "LBP",
      "DESCRIPTION",
      "",
      "DATE",
      "PAID IN USD",
      "PAID IN LBP",
      "DESCRIPTION",
    ]);

    // Purchases left (oldest first), payments right as positive amounts.
    expect(rows[2]!.slice(1, 4)).toEqual([
      12,
      500_000,
      "Manual Debt — CARTE + W2W",
    ]);
    expect(rows[2]!.slice(6, 9)).toEqual([12, 800_000, "paid by sara"]);
    expect(rows[3]!.slice(1, 4)).toEqual([
      "",
      520_000,
      "Recharge Debt — 5$ MTC",
    ]);
    expect(rows[3]!.slice(6, 9)).toEqual(["", 2_280_000, "paid by hweli"]);
    expect(rows[2]![0]).toBeInstanceOf(Date);
  });

  it("ends with totals and a balance equal to the ledger's own sum", () => {
    const wb = roundTrip([sara]);
    const rows = rowsOf(wb, "SARA ZOHAIR BOU ISMAIL");
    const total = rows.find((r) => r[0] === "TOTAL ON ACCOUNT")!;
    expect(total.slice(1, 3)).toEqual([12, 1_020_000]);
    expect(total[5]).toBe("TOTAL PAID");
    expect(total.slice(6, 8)).toEqual([12, 3_080_000]);

    const balUsd = rows.find((r) => r[3] === "Balance Remaining in USD")!;
    const balLbp = rows.find((r) => r[3] === "Balance Remaining in LBP")!;
    const ledgerUsd = sara.history.reduce((s, e) => s + e.amount_usd, 0);
    const ledgerLbp = sara.history.reduce((s, e) => s + e.amount_lbp, 0);
    expect(balUsd[4]).toBe(ledgerUsd); // 0
    expect(balLbp[4]).toBe(ledgerLbp); // −2,060,000: the client is in credit

    // Live formulas, so edits in Excel recalculate.
    const ws = wb.Sheets["SARA ZOHAIR BOU ISMAIL"]!;
    const totalRow = rows.indexOf(total) + 1;
    expect(ws[`B${totalRow}`]?.f).toBe("SUM(B3:B4)");
  });

  it("keeps sheet names unique, short, and clear of names the import skips", () => {
    const long = "A".repeat(40);
    const wb = roundTrip([
      { name: "Ali", phone: "", history: [] },
      { name: "ali", phone: "", history: [] },
      { name: long, phone: "", history: [] },
      { name: long, phone: "", history: [] },
      { name: "Sheet1", phone: "", history: [] },
      { name: "List Name", phone: "", history: [] },
      { name: "NAME (old)", phone: "", history: [] },
    ]);
    const names = wb.SheetNames.slice(1);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    expect(names.every((n) => n.length <= 31)).toBe(true);
    expect(names).not.toContain("Sheet1");
    expect(names.filter((n) => n.toLowerCase() === "list name")).toEqual([]);
    expect(names.some((n) => n.startsWith("NAME ("))).toBe(false);
  });
});

describe("isPaymentLedgerType", () => {
  it("puts repayments and credit deposits on the paid side only", () => {
    expect(isPaymentLedgerType("Repayment")).toBe(true);
    expect(isPaymentLedgerType("CREDIT_DEPOSIT")).toBe(true);
    expect(isPaymentLedgerType("CREDIT_USED")).toBe(false);
    expect(isPaymentLedgerType("Sale Debt")).toBe(false);
  });
});
