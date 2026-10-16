/**
 * Owner decision 2026-10-16 — the shared export-template engine
 * (packages/ui/src/utils/exportTemplate.ts): a page describes its sheets and
 * its PDF report; the engine writes real Excel cells (numbers with formats,
 * dates, widths, totals, frozen header, filter) and a grouped PDF report.
 *
 * Runs the REAL builders and reads the bytes back (rule 28). Written before
 * the engine existed and seen failing (rule 17).
 */
import * as XLSX from "xlsx";
import {
  buildPdfReportBody,
  exportFacts,
  exportTable,
  renderPdfReport,
  writeTemplateWorkbook,
  type ExportSheetSpec,
  type PdfReport,
} from "../../../../../packages/ui/src/utils/exportTemplate";

interface Row {
  id: number;
  when: Date;
  name: string;
  inUsd: number | null;
  inLbp: number | null;
  currency: string;
  amount: number;
  voided?: boolean;
}

const ROWS: Row[] = [
  {
    id: 7,
    when: new Date(2026, 9, 16, 9, 30),
    name: "Sale",
    inUsd: 10.126,
    inLbp: 150000,
    currency: "USD",
    amount: 4,
  },
  {
    id: 8,
    when: new Date(2026, 9, 16, 11, 5),
    name: "Voided sale",
    inUsd: 5,
    inLbp: null,
    currency: "LBP",
    amount: 90000,
    voided: true,
  },
];

function sheets(): ExportSheetSpec[] {
  return [
    {
      name: "Summary",
      blocks: [
        exportFacts("Report", [
          ["Period", "16 Oct 2026"],
          ["Rows", 2, { type: "integer" }],
        ]),
      ],
    },
    {
      name: "Rows",
      blocks: [
        exportTable<Row>({
          rows: ROWS,
          freezeHeader: true,
          autoFilter: true,
          rowStyle: (r) => (r.voided ? "strike" : null),
          columns: [
            { header: "#", value: (r) => r.id, type: "integer", width: 6 },
            { header: "Date", value: (r) => r.when, type: "date" },
            { header: "Name", value: (r) => r.name, width: 20 },
            {
              header: "In USD",
              value: (r) => r.inUsd,
              type: "money",
              currency: "USD",
              total: true,
            },
            {
              header: "In LBP",
              value: (r) => r.inLbp,
              type: "money",
              currency: "LBP",
              total: true,
            },
            {
              header: "Amount",
              value: (r) => r.amount,
              type: "money",
              currency: (r) => r.currency,
              total: true,
            },
          ],
        }),
      ],
    },
  ];
}

function readBack(): XLSX.WorkBook {
  return XLSX.read(writeTemplateWorkbook(sheets()), {
    type: "array",
    cellNF: true,
    cellStyles: true,
  });
}

function rawXml(path: string): string {
  const cfb = XLSX.CFB.read(writeTemplateWorkbook(sheets()), { type: "array" });
  const file = XLSX.CFB.find(cfb, path);
  if (!file) throw new Error(`no ${path}`);
  return Buffer.from(file.content as Uint8Array).toString("utf8");
}

/** Excel's day number by a second method: whole days since 1899-12-30. */
function excelDay(y: number, m: number, d: number): number {
  return (Date.UTC(y, m, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

describe("export template → Excel", () => {
  it("writes the template's sheets in order", () => {
    expect(readBack().SheetNames).toEqual(["Summary", "Rows"]);
  });

  it("money is a real number, rounded to the currency, with its format", () => {
    const ws = readBack().Sheets.Rows!;
    expect(ws.D2).toMatchObject({ t: "n", v: 10.13, z: '"$"#,##0.00' });
    expect(ws.E2).toMatchObject({ t: "n", v: 150000, z: '#,##0" LBP"' });
    // A per-row currency column formats each cell by its own currency.
    expect(ws.F3).toMatchObject({ t: "n", v: 90000, z: '#,##0" LBP"' });
    // Empty money stays empty, not 0.
    expect(ws.E3).toBeUndefined();
  });

  it("dates are real dates", () => {
    const ws = readBack().Sheets.Rows!;
    expect(ws.B2.t).toBe("n");
    expect(Math.floor(ws.B2.v as number)).toBe(excelDay(2026, 9, 16));
    expect(ws.B2.z).toBe("dd mmm yyyy");
  });

  it("a totals row under the data: fixed-currency columns sum, per-currency rows for a mixed column", () => {
    const ws = readBack().Sheets.Rows!;
    expect(ws.A4.v).toBe("Total");
    expect(ws.D4).toMatchObject({ t: "n", v: 15.13 });
    expect(ws.D4.f).toBe("SUBTOTAL(109,D2:D3)");
    expect(ws.E4).toMatchObject({ t: "n", v: 150000 });
    // The mixed column: one total per currency, never summed across them.
    expect(ws.F4).toMatchObject({ v: 4, z: '"$"#,##0.00' });
    expect(ws.A5.v).toBe("Total LBP");
    expect(ws.F5).toMatchObject({ v: 90000, z: '#,##0" LBP"' });
  });

  it("filter covers header → last data row (not the totals); widths set", () => {
    const ws = readBack().Sheets.Rows!;
    expect(ws["!autofilter"]).toEqual({ ref: "A1:F3" });
    expect(ws["!cols"]?.[0]?.wch).toBe(6);
    expect(ws["!cols"]?.[2]?.wch).toBe(20);
  });

  it("the header row is frozen on the table sheet only", () => {
    expect(rawXml("/xl/worksheets/sheet2.xml")).toContain(
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>',
    );
    expect(rawXml("/xl/worksheets/sheet1.xml")).not.toContain("<pane");
  });

  it("header and totals are bold; a struck row is grey and struck", () => {
    const styles = rawXml("/xl/styles.xml");
    const fonts = [...styles.matchAll(/<font>(.*?)<\/font>/g)].map((m) => m[1]);
    const xfs = [
      ...styles.matchAll(/<cellXfs[^>]*>(.*)<\/cellXfs>/g),
    ][0]![1]!.match(/<xf [^>]*\/>/g)!;
    const fontOf = (cellRef: string, sheetXml: string) => {
      const m = new RegExp(`<c r="${cellRef}"(?: [^>]*?)? s="(\\d+)"`).exec(
        sheetXml,
      );
      const s = m ? Number(m[1]) : 0;
      const fontId = Number(/fontId="(\d+)"/.exec(xfs[s]!)![1]);
      return fonts[fontId]!;
    };
    const sheet = rawXml("/xl/worksheets/sheet2.xml");
    expect(fontOf("A1", sheet)).toContain("<b/>");
    expect(fontOf("D4", sheet)).toContain("<b/>");
    expect(fontOf("A3", sheet)).toContain("<strike/>");
    expect(fontOf("A2", sheet)).not.toMatch(/<b\/>|<strike\/>/);
    // The money cell keeps its number format after the font change.
    expect(readBack().Sheets.Rows!.D3.z).toBe('"$"#,##0.00');
  });

  it("a facts block writes label / value pairs, values typed", () => {
    const ws = readBack().Sheets.Summary!;
    expect(ws.A1.v).toBe("Report");
    expect(ws.A2.v).toBe("Period");
    expect(ws.B2.v).toBe("16 Oct 2026");
    expect(ws.B3).toMatchObject({ t: "n", v: 2 });
  });
});

const REPORT: PdfReport = {
  title: "Things — 16 Oct 2026",
  headerLines: ["Test Shop", "Printed by ali"],
  summary: [{ title: "Money", head: ["", "In"], rows: [["USD", "$15.13"]] }],
  columns: [{ header: "Time" }, { header: "What" }, { header: "Amount" }],
  groups: [
    {
      label: "Fri 16 Oct 2026",
      totals: "In $15.13",
      items: [
        {
          cells: ["09:30", "Sale", { text: "$10.13", tone: "in" }],
          sub: "Items: cable",
        },
        {
          cells: ["11:05", "Voided sale", { text: "$5", tone: "out" }],
          strike: true,
        },
        { cells: ["12:00", "Expense", { text: "$3", tone: "out" }] },
      ],
    },
  ],
};

describe("export template → PDF", () => {
  it("a group header row, then each item's bold main line and grey sub line", () => {
    const { body, meta } = buildPdfReportBody(REPORT);
    expect(meta.map((m) => m.kind)).toEqual([
      "group",
      "item",
      "sub",
      "item",
      "item",
    ]);
    const group = body[0] as { content: string; colSpan: number }[];
    expect(group.map((c) => c.content)).toEqual([
      "Fri 16 Oct 2026",
      "In $15.13",
    ]);
    expect(group.reduce((n, c) => n + c.colSpan, 0)).toBe(3);
    const main = body[1] as {
      content: string;
      styles: { fontStyle?: string };
    }[];
    expect(main.map((c) => c.content)).toEqual(["09:30", "Sale", "$10.13"]);
    expect(main[1]!.styles.fontStyle).toBe("bold");
    const sub = body[2] as { content: string; colSpan: number }[];
    expect(sub.map((c) => c.content)).toEqual(["Items: cable"]);
    // The item's first cell spans both lines (keeps them on one page); the
    // sub line fills the rest of the width.
    expect((body[1] as { rowSpan?: number }[])[0]!.rowSpan).toBe(2);
    expect(sub[0]!.colSpan).toBe(2);
    expect(meta[3]!.strike).toBe(true);
  });

  it("In is green, Out red", () => {
    const { body } = buildPdfReportBody(REPORT);
    const inCell = (body[1] as { styles: { textColor: number[] } }[])[2]!;
    const outCell = (body[4] as { styles: { textColor: number[] } }[])[2]!;
    const struck = (body[3] as { styles: { textColor: number[] } }[])[2]!;
    // A struck (voided) row is grey whatever its direction.
    expect(Math.min(...struck.styles.textColor)).toBeGreaterThan(140);
    expect(inCell.styles.textColor[1]).toBeGreaterThan(
      inCell.styles.textColor[0]!,
    );
    expect(outCell.styles.textColor[0]).toBeGreaterThan(
      outCell.styles.textColor[1]!,
    );
  });

  it("renders a landscape A4 with the title and a page x of y footer", () => {
    const doc = renderPdfReport(REPORT);
    const size = doc.internal.pageSize;
    expect(size.getWidth()).toBeGreaterThan(size.getHeight());
    const text = doc.output();
    expect(text).toContain("Things - 16 Oct 2026");
    expect(text).toContain(`Page 1 of ${doc.getNumberOfPages()}`);
  });
});
