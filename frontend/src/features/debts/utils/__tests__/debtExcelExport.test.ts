import * as XLSX from "xlsx";
import type { DebtLedgerEntity } from "@liratek/ui";
import {
  buildDebtExportWorkbook,
  SPARE_ROWS,
  writeDebtExportFile,
} from "../debtExcelWorkbook";
import {
  exportedRowDate,
  isLiraTekAccountsExport,
  isPaymentLedgerType,
  looksLikeSameShop,
  type DebtExportClient,
  type ImportedPageForShopCheck,
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
  it("starts with a List Name sheet: NAME | Phone, then live balances", () => {
    const wb = roundTrip([sara]);
    expect(wb.SheetNames[0]).toBe("List Name");
    expect(rowsOf(wb, "List Name")).toEqual([
      ["NAME", "Phone ", "Balance USD", "Balance LBP"],
      ["SARA/ZOHAIR BOU ISMAIL", "71475799", 0, -2_060_000],
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
    // The range reaches over the spare rows (2 entries + SPARE_ROWS).
    expect(ws[`B${totalRow}`]?.f).toBe(`SUM(B3:B${4 + SPARE_ROWS})`);
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

describe("List Name links", () => {
  it("links every name to its own page, even when the sheet name was cleaned", () => {
    const long = "Abou/Ali Very Long Customer Name Number";
    const wb = roundTrip([
      { name: "Ali O'Neil", phone: "70111111", history: [] },
      { name: `${long} One`, phone: "70222222", history: [] },
      { name: `${long} Two`, phone: "70333333", history: [] },
      { name: "List Name", phone: "70444444", history: [] },
    ]);
    const list = wb.Sheets["List Name"]!;
    for (let row = 2; row <= 5; row++) {
      const cell = list[`A${row}`]!;
      const target = cell.l?.Target ?? "";
      const m = /^#'(.+)'!A1$/.exec(target);
      expect(m).not.toBeNull();
      const sheet = m![1]!.replace(/''/g, "'");
      expect(wb.SheetNames).toContain(sheet);
      // The linked page is this client's page.
      expect(wb.Sheets[sheet]!.B1?.v).toBe(cell.v);
    }
  });

  it("every client page links back to the list from F1", () => {
    const wb = roundTrip([
      sara,
      { name: "Ali", phone: "70111111", history: [] },
    ]);
    for (const name of wb.SheetNames.slice(1)) {
      const f1 = wb.Sheets[name]!.F1;
      expect(f1?.v).toBe("← Back to list");
      expect(f1?.l?.Target).toBe("#'List Name'!A1");
    }
  });

  it("keeps the list readable by the import: plain names in column A", () => {
    const wb = roundTrip([sara]);
    // The import reads columns A and B only.
    expect(rowsOf(wb, "List Name")[1]!.slice(0, 2)).toEqual([
      "SARA/ZOHAIR BOU ISMAIL",
      "71475799",
    ]);
  });
});

describe("keeps working like the shop's own workbook", () => {
  const SHEET = "SARA ZOHAIR BOU ISMAIL";

  it("leaves SPARE_ROWS empty rows inside the totals, so a line typed later counts", () => {
    const wb = roundTrip([sara]);
    const ws = wb.Sheets[SHEET]!;
    const rows = rowsOf(wb, SHEET);
    const totalRow = rows.findIndex((r) => r[0] === "TOTAL ON ACCOUNT") + 1;
    // 2 entry rows, then the spare rows, then the totals.
    expect(totalRow).toBe(3 + 2 + SPARE_ROWS);
    for (const col of ["B", "C", "G", "H"]) {
      expect(ws[`${col}${totalRow}`]?.f).toBe(
        `SUM(${col}3:${col}${totalRow - 1})`,
      );
    }
    // The spare rows are empty: nothing in them for the import to read.
    for (let r = 5; r < totalRow; r++) {
      expect(rows[r - 1]!.filter((v) => v !== "")).toEqual([]);
    }
  });

  it("balances sit 7 and 9 rows under the totals, merged across E:F", () => {
    const wb = roundTrip([sara]);
    const ws = wb.Sheets[SHEET]!;
    const rows = rowsOf(wb, SHEET);
    const totalRow = rows.findIndex((r) => r[0] === "TOTAL ON ACCOUNT") + 1;
    expect(rows[totalRow + 7 - 1]![3]).toBe("Balance Remaining in USD");
    expect(rows[totalRow + 9 - 1]![3]).toBe("Balance Remaining in LBP");
    expect(ws[`E${totalRow + 7}`]?.f).toBe(`B${totalRow}-G${totalRow}`);
    expect(ws["!merges"]).toEqual(
      expect.arrayContaining([
        { s: { r: totalRow + 6, c: 4 }, e: { r: totalRow + 6, c: 5 } },
        { s: { r: totalRow + 8, c: 4 }, e: { r: totalRow + 8, c: 5 } },
      ]),
    );
  });

  it("List Name balances are formulas pointing at each page's balance", () => {
    const wb = roundTrip([sara]);
    const list = wb.Sheets["List Name"]!;
    const rows = rowsOf(wb, SHEET);
    const totalRow = rows.findIndex((r) => r[0] === "TOTAL ON ACCOUNT") + 1;
    expect(list.C2?.f).toBe(`'${SHEET}'!E${totalRow + 7}`);
    expect(list.D2?.f).toBe(`'${SHEET}'!E${totalRow + 9}`);
  });

  it("carries the shop's look: Calibri 16, grey labels, yellow totals, $ / LBP formats, borders", () => {
    const wb = buildDebtExportWorkbook([sara]);
    const ws = wb.Sheets[SHEET]!;
    const style = (a: string) =>
      (ws[a] as { s?: Record<string, any> } | undefined)?.s ?? {};
    expect(style("A2").fill?.fgColor?.rgb).toBe("BFBFBF");
    expect(style("A2").font).toMatchObject({ name: "Calibri", sz: 16 });
    expect(style("B3").numFmt).toContain('"$"');
    expect(style("C3").numFmt).toContain("[$LBP]");
    expect(style("A3").numFmt).toBe("m/d/yy");
    expect(style("B5").border?.left?.style).toBe("thin"); // a spare row
    const rows = rowsOf(roundTrip([sara]), SHEET);
    const totalRow = rows.findIndex((r) => r[0] === "TOTAL ON ACCOUNT") + 1;
    expect(style(`A${totalRow}`).fill?.fgColor?.rgb).toBe("FFFF00");
  });

  it("the written file keeps the styles (fills, borders, formats)", () => {
    const bytes = new Uint8Array(
      writeDebtExportFile(buildDebtExportWorkbook([sara])),
    );
    const styles = XLSX.CFB.find(
      XLSX.CFB.read(bytes, { type: "array" }),
      "/xl/styles.xml",
    );
    const xml = new TextDecoder().decode(styles!.content as Uint8Array);
    expect(xml).toContain("FFFF00");
    expect(xml).toContain("BFBFBF");
    expect(xml).toContain('style="thin"');
    expect(xml).toContain("[$LBP]");
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

describe("re-importing an export", () => {
  const SHEET = "Refund Client";
  const refundClient: DebtExportClient = {
    name: SHEET,
    phone: "70111222",
    history: [
      entry({
        transaction_type: "Sale Debt",
        created_at: "2025-11-01 08:00:00",
        amount_usd: 70,
        note: "Sale #12",
      }),
      // A refund is a NEGATIVE purchase in the ledger.
      entry({
        transaction_type: "Sale Debt",
        created_at: "2025-11-02 08:00:00",
        amount_usd: -20,
        note: "Refund of Sale #12",
      }),
      // Mixed signs in one row: +$5 owed, 100,000 LBP back.
      entry({
        transaction_type: "Manual Debt",
        created_at: "2025-11-03 08:00:00",
        amount_usd: 5,
        amount_lbp: -100_000,
        note: "swap",
      }),
      entry({
        transaction_type: "Imported Debt",
        created_at: "2025-10-01 08:00:00",
        amount_lbp: 300_000,
        note: "old sheet",
      }),
    ],
  };

  it("never writes a negative amount — refunds land on the paid side", () => {
    const rows = rowsOf(roundTrip([refundClient]), SHEET);
    const body = rows.slice(2, 6);
    for (const r of body) {
      for (const i of [1, 2, 6, 7]) {
        if (typeof r[i] === "number") expect(r[i]).toBeGreaterThan(0);
      }
    }
    const paid = body.filter((r) => r[8] !== "").map((r) => r.slice(6, 9));
    expect(paid).toEqual([
      [20, "", "Refund of Sale #12"],
      ["", 100_000, "Manual Debt — swap"],
    ]);
  });

  it("keeps the balance equal to the ledger's own sum", () => {
    const rows = rowsOf(roundTrip([refundClient]), SHEET);
    const balUsd = rows.find((r) => r[3] === "Balance Remaining in USD")!;
    const balLbp = rows.find((r) => r[3] === "Balance Remaining in LBP")!;
    expect(balUsd[4]).toBe(70 - 20 + 5);
    expect(balLbp[4]).toBe(300_000 - 100_000);
  });

  it("does not re-label imported rows", () => {
    const rows = rowsOf(roundTrip([refundClient]), SHEET);
    expect(rows[2]!.slice(2, 4)).toEqual([300_000, "old sheet"]);
  });

  it("marks the file as ours and gives back each row's exact time", () => {
    const wb = roundTrip([refundClient]);
    expect(isLiraTekAccountsExport(wb)).toBe(true);
    const rows = rowsOf(wb, SHEET);
    expect(exportedRowDate(rows[2]![0])).toBe("2025-10-01T08:00:00.000Z");
    expect(exportedRowDate(rows[2]![5])).toBe("2025-11-02T08:00:00.000Z");
  });

  it("does not treat a handwritten sheet as ours", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["x"]]), "A");
    const back = XLSX.read(
      XLSX.write(wb, { bookType: "xlsx", type: "array" }),
      {
        type: "array",
      },
    );
    expect(isLiraTekAccountsExport(back)).toBe(false);
    expect(exportedRowDate("15/11/2025")).toBeNull();
    expect(exportedRowDate("")).toBeNull();
  });
});

describe("looksLikeSameShop", () => {
  const page = (
    phone: string,
    usd: number,
    lbp = 0,
  ): ImportedPageForShopCheck => ({
    phone,
    entries: [
      { amount_usd: usd + 10, amount_lbp: lbp, type: "debt" },
      { amount_usd: 10, amount_lbp: 0, type: "payment" },
    ],
  });
  const here = (phone: string, usd: number, lbp = 0) => ({
    phone_number: phone,
    total_debt_usd: usd,
    total_debt_lbp: lbp,
  });
  const file = [
    page("70111111", 50),
    page("71/222222", 20, 500_000),
    page("76333333", 5),
  ];

  it("is false for a new shop", () => {
    expect(looksLikeSameShop(file, [])).toBe(false);
  });

  it("is true for the shop the file came from (phones compared as digits)", () => {
    expect(
      looksLikeSameShop(file, [
        here("70 111 111", 50),
        here("71222222", 20, 500_000),
        here("76333333", 5),
      ]),
    ).toBe(true);
  });

  it("is still true after a few clients moved on since the export", () => {
    expect(
      looksLikeSameShop(file, [
        here("70111111", 50),
        here("71222222", 20, 500_000),
        here("76333333", 0),
      ]),
    ).toBe(true);
  });

  it("is false when only a minority of balances match", () => {
    expect(
      looksLikeSameShop(file, [here("70111111", 50), here("71222222", 3)]),
    ).toBe(false);
  });

  it("ignores clients whose file balance is zero", () => {
    expect(
      looksLikeSameShop([page("70111111", 0)], [here("70111111", 0)]),
    ).toBe(false);
  });
});

describe("buildDebtExportWorkbook — a voided charge, its cancellation and the re-entry (2026-10-28)", () => {
  const client: DebtExportClient = {
    name: "SouheiL SALIM Kerbaj",
    phone: "70000000",
    history: [
      entry({
        transaction_type: "Service Debt",
        transaction_id: 12708,
        created_at: "2026-10-25 08:41:21",
        amount_lbp: 5_630_000,
        note: "OMT send",
      }),
      entry({
        transaction_type: "Refund Reversal",
        transaction_id: 12708,
        created_at: "2026-10-27 23:06:07",
        amount_lbp: -5_630_000,
        note: "Debt cancelled by refund/void",
      }),
      entry({
        transaction_type: "Service Debt",
        transaction_id: 13435,
        created_at: "2026-10-27 23:33:57",
        amount_lbp: 5_630_000,
        note: "OMT send",
      }),
    ],
  };

  it("marks the voided charge and names the cancellation; the balance stays the ledger's sum", () => {
    const rows = rowsOf(roundTrip([client]), "SouheiL SALIM Kerbaj");
    expect(rows[2]!.slice(2, 4)).toEqual([
      5_630_000,
      "Service Debt — OMT send (voided)",
    ]);
    expect(rows[3]!.slice(2, 4)).toEqual([
      5_630_000,
      "Service Debt — OMT send",
    ]);
    // The cancellation stays a positive paid-side figure: the import reads
    // only amounts above zero (see "never writes a negative amount").
    expect(rows[2]!.slice(7, 9)).toEqual([
      5_630_000,
      "Cancelled: Service Debt — OMT send",
    ]);
    const bal = rows.find((r) => r[3] === "Balance Remaining in LBP")!;
    expect(bal[4]).toBe(5_630_000);
  });
});
