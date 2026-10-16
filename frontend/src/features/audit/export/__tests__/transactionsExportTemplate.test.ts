/**
 * Owner decision 2026-10-16 — the Transactions export template: Excel with
 * Summary + Transactions + Payments + Details sheets, a PDF report grouped
 * by day. Built from the REAL shop-day rows (rule 24) and read back from
 * the written .xlsx bytes (rule 28).
 *
 * In / Out are the row's own money legs (what physically moved through a
 * drawer), summed per currency by the leg's direction. The totals are
 * cross-checked against Σ `signed_amount` straight from the fixture — a
 * second method that never goes through the template (fable-brain §4).
 *
 * Written before the template existed and seen failing (rule 17).
 */
import * as XLSX from "xlsx";
import {
  buildPdfReportBody,
  writeTemplateWorkbook,
  type ExportSheetSpec,
  type ExportTableBlock,
  type PdfReport,
} from "@liratek/ui";
import { shopDayRow } from "../../__fixtures__/shopDayRows";
import type { TransactionRow } from "../../hooks/useTransactionRows";
import {
  keyDetailsText,
  rowMoney,
  transactionsExportTemplate,
  type TransactionsExportOptions,
} from "../transactionsExportTemplate";

const ALL_IDS = [
  10895, 10896, 10898, 10901, 10903, 10908, 10911, 10913, 10925, 10927, 10928,
  10929, 10930, 10932, 10933, 10934, 10935, 10937, 10938, 10939, 10941, 10943,
  10944, 10945, 10946, 10949,
];

// The flags core's `getRecent` adds since the shop-day fix (the fixture
// rows were captured before it), as TransactionsViewer.shopDayFixes does.
const SERVER_FLAGS: Record<number, Partial<TransactionRow>> = {
  10939: { item_refund_of_id: 10895 },
  10895: { item_refunded: true, item_refund_remaining: true },
};

const rows = (): TransactionRow[] =>
  ALL_IDS.map((id) => ({ ...shopDayRow(id), ...SERVER_FLAGS[id] }));

function options(isAdmin: boolean): TransactionsExportOptions {
  return {
    isAdmin,
    methodLabelByCode: new Map([["CASH", "Cash"]]),
    shopName: "Test Shop",
    exportedBy: isAdmin ? "Admin" : "cashier",
    filters: { from: "2026-10-16", to: "2026-10-16", search: "", types: [] },
  };
}

const NOW = new Date(2026, 9, 16, 18, 0);

function excel(isAdmin = false, input = rows()): ExportSheetSpec[] {
  return transactionsExportTemplate(options(isAdmin)).excel({
    rows: input,
    now: NOW,
  });
}

function workbook(isAdmin = false, input = rows()): XLSX.WorkBook {
  return XLSX.read(writeTemplateWorkbook(excel(isAdmin, input)), {
    type: "array",
    cellNF: true,
  });
}

function aoa(wb: XLSX.WorkBook, sheet: string): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet]!, {
    header: 1,
    defval: null,
    raw: true,
  });
}

/** The Transactions sheet as objects keyed by header, data rows only. */
function txnRecords(wb: XLSX.WorkBook): Record<string, unknown>[] {
  const [header, ...body] = aoa(wb, "Transactions");
  const records = body.map((r) =>
    Object.fromEntries((header as string[]).map((h, i) => [h, r[i]])),
  );
  return records.filter((r) => typeof r["#"] === "number");
}

function txn(wb: XLSX.WorkBook, id: number): Record<string, unknown> {
  const r = txnRecords(wb).find((x) => x["#"] === id);
  if (!r) throw new Error(`no row #${id}`);
  return r;
}

const close = (a: unknown, b: number, digits = 2) =>
  expect(Number(a ?? 0)).toBeCloseTo(b, digits);

describe("Transactions export — workbook shape", () => {
  it("has Summary, Transactions, Payments and Details sheets", () => {
    expect(workbook().SheetNames).toEqual([
      "Summary",
      "Transactions",
      "Payments",
      "Details",
    ]);
  });

  it("Transactions: one row per transaction with the agreed columns", () => {
    const wb = workbook();
    expect(aoa(wb, "Transactions")[0]).toEqual([
      "Date",
      "Time",
      "#",
      "Type",
      "Client",
      "Phone",
      "Summary",
      "Amount",
      "In USD",
      "Out USD",
      "In LBP",
      "Out LBP",
      "Method",
      "User",
      "Status",
      "Key details",
    ]);
    expect(txnRecords(wb).map((r) => r["#"])).toEqual(ALL_IDS);
  });

  it("money cells are numbers with the currency's format", () => {
    const ws = workbook().Sheets.Transactions!;
    // Row 2 = #10895 (first exported row).
    expect(ws.I2).toMatchObject({ t: "n", v: 700, z: '"$"#,##0.00' });
    expect(ws.K2).toMatchObject({ t: "n", v: 11500000, z: '#,##0" LBP"' });
    expect(ws.A2.t).toBe("n");
    expect(ws.A2.z).toBe("dd mmm yyyy");
  });

  it("header frozen, filter on the data, totals row after it", () => {
    const ws = workbook().Sheets.Transactions!;
    const last = ALL_IDS.length + 1;
    expect(ws["!autofilter"]).toEqual({ ref: `A1:P${last}` });
    expect(ws[`A${last + 1}`].v).toBe("Total");
    expect(ws[`I${last + 1}`].f).toBe(`SUBTOTAL(109,I2:I${last})`);
  });
});

describe("Transactions export — In / Out per transaction", () => {
  it("a sale: what the customer paid in, the change out", () => {
    const r = txn(workbook(), 10895);
    close(r["In USD"], 700);
    close(r["In LBP"], 11500000, 0);
    close(r["Out USD"], 6);
    close(r["Out LBP"], 20000, 0);
    expect(r.Amount).toBe("$823");
  });

  it("a payout (supplier payment) is Out only", () => {
    const r = txn(workbook(), 10941);
    expect(r["In USD"]).toBeNull();
    close(r["Out USD"], 80);
  });

  it("an item refund, legs rounded to the currency", () => {
    const r = txn(workbook(), 10939);
    expect(r["Out USD"]).toBe(679.59);
    expect(r["Out LBP"]).toBe(11164642);
    expect(r["In USD"]).toBe(5.83);
    expect(r["In LBP"]).toBe(19417);
  });

  it("a write-off moves no money: blank, not 0", () => {
    const r = txn(workbook(), 10938);
    for (const k of ["In USD", "Out USD", "In LBP", "Out LBP"]) {
      expect(r[k]).toBeNull();
    }
  });

  it("a session member carries its basket's pooled payment once", () => {
    const r = txn(workbook(), 10913);
    close(r["In USD"], 20);
    close(r["In LBP"], 170000, 0);
  });

  it("a checkpoint's counted totals are never money In / Out", () => {
    const cp = {
      ...shopDayRow(10941),
      id: 1,
      type: "CHECKPOINT",
      amount_usd: 500,
      amount_lbp: 9000000,
      payments: [],
    } as TransactionRow;
    expect(rowMoney(cp, null)).toEqual({ in: {}, out: {} });
  });

  it("a voided sale and its void cancel out per currency", () => {
    const wb = workbook();
    const voided = txn(wb, 10896);
    const reversal = txn(wb, 10934);
    for (const c of ["USD", "LBP"]) {
      const net =
        Number(voided[`In ${c}`] ?? 0) -
        Number(voided[`Out ${c}`] ?? 0) +
        Number(reversal[`In ${c}`] ?? 0) -
        Number(reversal[`Out ${c}`] ?? 0);
      expect(net).toBe(0);
    }
    expect(voided.Status).toBe("Voided");
  });

  it("other currencies get their own In / Out columns only when present", () => {
    const topup = {
      ...shopDayRow(10941),
      id: 2,
      type: "DRAWER_TOPUP",
      amount_usd: 0,
      amount_lbp: 0,
      payments: [],
      metadata_json: JSON.stringify({
        extra_currencies: [{ currency_code: "EUR", amount: 40 }],
      }),
    } as TransactionRow;
    const wb = workbook(false, [shopDayRow(10941), topup]);
    const header = aoa(wb, "Transactions")[0] as string[];
    expect(header).toContain("In EUR");
    expect(header).toContain("Out EUR");
    expect(txn(wb, 2)["In EUR"]).toBe(40);
    expect(aoa(workbook(), "Transactions")[0]).not.toContain("In EUR");
  });
});

describe("Transactions export — totals, by a second method", () => {
  /** Σ signed_amount over every leg the rows carry (a session's pool once). */
  function signedNet(input: TransactionRow[]): Record<string, number> {
    const net: Record<string, number> = {};
    const seenSessions = new Set<number>();
    for (const r of input) {
      const legs = [...(r.payments ?? [])];
      if (r.session_id != null && !seenSessions.has(r.session_id)) {
        if (r.session_payments?.length) {
          seenSessions.add(r.session_id);
          legs.push(...r.session_payments);
        }
      }
      for (const l of legs) {
        net[l.currency_code] = (net[l.currency_code] ?? 0) + l.signed_amount;
      }
    }
    return net;
  }

  it("Σ(In − Out) on the totals row = Σ signed leg amounts per currency", () => {
    const ws = workbook().Sheets.Transactions!;
    const t = ALL_IDS.length + 2;
    const net = signedNet(rows());
    expect(Number(ws[`I${t}`].v) - Number(ws[`J${t}`].v)).toBeCloseTo(
      net.USD!,
      1,
    );
    expect(Number(ws[`K${t}`].v) - Number(ws[`L${t}`].v)).toBeCloseTo(
      net.LBP!,
      -1,
    );
  });

  it("the totals row is the sum of the cells above it (as Excel would add)", () => {
    const wb = workbook();
    const recs = txnRecords(wb);
    const ws = wb.Sheets.Transactions!;
    const t = ALL_IDS.length + 2;
    for (const [col, key] of [
      ["I", "In USD"],
      ["J", "Out USD"],
      ["K", "In LBP"],
      ["L", "Out LBP"],
    ] as const) {
      const sum = recs.reduce((s, r) => s + Number(r[key] ?? 0), 0);
      expect(Number(ws[`${col}${t}`].v)).toBeCloseTo(sum, 6);
    }
  });

  it("Summary: In / Out / Net per currency agree with the Transactions totals", () => {
    const wb = workbook();
    const ws = wb.Sheets.Transactions!;
    const t = ALL_IDS.length + 2;
    const summary = aoa(wb, "Summary");
    const usd = summary.find((r) => r[0] === "USD")!;
    const lbp = summary.find((r) => r[0] === "LBP")!;
    expect(usd.slice(1, 4)).toEqual([
      ws[`I${t}`].v,
      ws[`J${t}`].v,
      Math.round((Number(ws[`I${t}`].v) - Number(ws[`J${t}`].v)) * 100) / 100,
    ]);
    expect(lbp.slice(1, 4)).toEqual([
      ws[`K${t}`].v,
      ws[`L${t}`].v,
      Number(ws[`K${t}`].v) - Number(ws[`L${t}`].v),
    ]);
  });

  it("Summary: the by-type counts add up to every exported transaction", () => {
    const sheet = excel().find((s) => s.name === "Summary")!;
    const byType = sheet.blocks.find(
      (b): b is ExportTableBlock => b.kind === "table" && b.title === "By type",
    )!;
    const counts = byType.rows.map((r) => Number(r.cells[1]!.value));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(ALL_IDS.length);
    const summary = aoa(workbook(), "Summary");
    expect(
      summary.some((r) => r[0] === "Exported by" && r[1] === "cashier"),
    ).toBe(true);
    expect(
      summary.some((r) => r[0] === "Period" && r[1] === "16 Oct 2026"),
    ).toBe(true);
  });
});

describe("Transactions export — Payments sheet", () => {
  function paymentRows(id: number): Record<string, unknown>[] {
    const [header, ...body] = aoa(workbook(), "Payments");
    return body
      .map((r) =>
        Object.fromEntries((header as string[]).map((h, i) => [h, r[i]])),
      )
      .filter((r) => r["Txn #"] === id);
  }

  it("has the agreed columns", () => {
    expect(aoa(workbook(), "Payments")[0]).toEqual([
      "Txn #",
      "Date",
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

  it("a supplier payment's money goes Out", () => {
    expect(
      paymentRows(10941).map((r) => [r.Kind, r["In/Out"], r.Amount]),
    ).toEqual([["line", "Out", 80]]);
  });

  it("an expense: paid out, change received back, change they kept", () => {
    expect(
      paymentRows(10933).map((r) => [
        r.Kind,
        r["In/Out"],
        r.Currency,
        r.Amount,
      ]),
    ).toEqual([
      ["line", "Out", "USD", 20],
      ["change received", "In", "USD", 1],
      ["kept by them", null, "USD", 0.5],
    ]);
  });

  it("a sale: paid lines in, change returned out, method labelled", () => {
    expect(
      paymentRows(10895).map((r) => [r.Kind, r["In/Out"], r.Method, r.Amount]),
    ).toEqual([
      ["line", "In", "Cash", 700],
      ["line", "In", "Cash", 11500000],
      ["change returned", "Out", "Cash", 6],
      ["change returned", "Out", "Cash", 20000],
    ]);
  });

  it("a refund's legs are reversal lines", () => {
    expect(paymentRows(10939).every((r) => r.Kind === "reversal")).toBe(true);
  });
});

describe("Transactions export — key details", () => {
  const ctx = { isAdmin: false, methodLabel: (c: string) => c };

  it("a POS sale names its items with IMEI", () => {
    const text = keyDetailsText(shopDayRow(10895), ctx);
    expect(text).toContain("iPhone 15 128GB");
    expect(text).toContain("356938035643809");
  });

  it("an exchange reads given → got", () => {
    expect(keyDetailsText(shopDayRow(10930), ctx)).toContain(
      "€50.00 → 5,162,000 LBP",
    );
  });

  it("a void names what it reverses", () => {
    expect(keyDetailsText(shopDayRow(10934), ctx)).toContain("Reverses #10896");
  });

  it("an OMT transfer: service type and reference", () => {
    const text = keyDetailsText(shopDayRow(10901), ctx);
    expect(text).toContain("Cash to business");
    expect(text).toContain("C2B-889120");
  });

  it("a partner settlement names the partner; a repair its device", () => {
    expect(keyDetailsText(shopDayRow(10943), ctx)).toContain(
      "Flow Partner 7619",
    );
    expect(keyDetailsText(shopDayRow(10928), ctx)).toContain(
      "iPhone 13 Pro Max",
    );
  });
});

describe("Transactions export — staff never see costs", () => {
  function allText(wb: XLSX.WorkBook): string {
    return wb.SheetNames.map((n) =>
      aoa(wb, n)
        .map((r) => r.join("|"))
        .join("\n"),
    ).join("\n");
  }
  function pdfText(isAdmin: boolean): string {
    const report: PdfReport = transactionsExportTemplate(options(isAdmin)).pdf({
      rows: rows(),
      now: NOW,
    });
    return JSON.stringify(report);
  }

  it("staff: no unit cost (690) or commission anywhere, Excel or PDF", () => {
    const text = allText(workbook(false));
    expect(text).not.toMatch(/unit ?cost/i);
    expect(text).not.toContain("690");
    expect(text).not.toMatch(/commission/i);
    expect(pdfText(false)).not.toMatch(/unit ?cost|commission|690/i);
  });

  it("admin: the Details sheet shows the unit cost", () => {
    const text = allText(workbook(true));
    expect(text).toMatch(/Unit cost/);
    expect(text).toContain("690");
  });
});

describe("Transactions export — PDF report", () => {
  function report(): PdfReport {
    return transactionsExportTemplate(options(false)).pdf({
      rows: rows(),
      now: NOW,
    });
  }

  it("title, period, shop, printed by", () => {
    const r = report();
    expect(r.title).toBe("Transactions — 16 Oct 2026");
    expect(r.headerLines.join(" ")).toContain("Test Shop");
    expect(r.headerLines.join(" ")).toContain("cashier");
    expect(r.orientation).toBe("landscape");
  });

  it("summary box: In / Out / Net per currency, and count per type", () => {
    const [money, types] = report().summary;
    expect(money!.head).toEqual(["Currency", "In", "Out", "Net"]);
    expect(money!.rows.map((r) => r[0])).toEqual(["USD", "LBP"]);
    const count = types!.rows.reduce(
      (n, r) => n + Number(r[1]) + Number(r[3] || 0),
      0,
    );
    expect(count).toBe(ALL_IDS.length);
  });

  it("grouped by day; each item: bold line with #id, grey key-details line", () => {
    const r = report();
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.label).toContain("16 Oct 2026");
    expect(r.groups[0]!.totals).toContain("In");
    const sale = r.groups[0]!.items.find((i) =>
      JSON.stringify(i.cells).includes("#10895"),
    )!;
    expect(sale.sub).toContain("iPhone 15 128GB");
    expect(JSON.stringify(sale.cells)).toContain("PARTLY REFUNDED");
    const { meta } = buildPdfReportBody(r);
    expect(meta.filter((m) => m.kind === "item")).toHaveLength(ALL_IDS.length);
  });

  it("voided rows are struck; payouts read Out in red", () => {
    const items = report().groups[0]!.items;
    const voided = items.find((i) =>
      JSON.stringify(i.cells).includes("#10896"),
    )!;
    expect(voided.strike).toBe(true);
    const payout = items.find((i) =>
      JSON.stringify(i.cells).includes("#10941"),
    )!;
    expect(JSON.stringify(payout.cells)).toContain('"tone":"out"');
  });
});
