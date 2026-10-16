/**
 * Export templates — one shared engine, one template per table (owner
 * decision 2026-10-16).
 *
 * A page that wants a designed export passes `DataTable` an
 * `exportTemplate`: what sheets to write (Excel) and what report to print
 * (PDF), built from the table's rows. This module turns that description
 * into files. A table WITHOUT a template never reaches this module — it
 * keeps `tableExport.ts`'s plain export, unchanged.
 *
 * Excel (SheetJS CE 0.18.5, the installed `xlsx`):
 *   - written natively: real number cells with number formats (`z`), real
 *     dates (Excel day numbers + a date format), column widths (`!cols`),
 *     filters (`!autofilter`), totals rows with a `SUBTOTAL` formula plus
 *     its cached value.
 *   - NOT written by CE: frozen panes and any cell styling (bold, fills,
 *     font colours). `patchWorkbookXml` adds those after SheetJS has
 *     written the file, by editing two XML parts inside the zip with the
 *     zip reader/writer `xlsx` itself ships (`XLSX.CFB`) — no new
 *     dependency. It only ever ADDS a `<pane>`, fonts, one fill and style
 *     variants; if a future `xlsx` writes different XML the patch finds
 *     nothing to change and the file stays valid, just plainer (the engine
 *     test then fails on the missing bold / pane).
 *
 * PDF (jsPDF + jspdf-autotable): a landscape A4 report — title block,
 * summary boxes, a body grouped (e.g. by day) with a group header row per
 * group, each item a bold main line plus a small grey line under it, In
 * green / Out red, struck rows, and "Page x of y" on every page.
 */
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable, { type CellInput, type RowInput } from "jspdf-autotable";
import { saveAs } from "file-saver";

/* ------------------------------------------------------------------ */
/*  Template types                                                     */
/* ------------------------------------------------------------------ */

export type ExportCellValue = string | number | Date | null | undefined;

export type ExportColumnType =
  | "text"
  | "integer"
  | "number"
  | "money"
  | "date"
  | "time"
  | "datetime";

export interface ExportColumn<S> {
  header: string;
  value: (row: S) => ExportCellValue;
  /** Default "text". */
  type?: ExportColumnType;
  /** For "money": the column's currency, or each row's own. */
  currency?: string | ((row: S) => string);
  /** Width in characters; default: fitted to the content (10–50). */
  width?: number;
  /** Sum this column in the totals row(s) under the data. */
  total?: boolean;
}

/** How a data row looks: `muted` = grey text, `strike` = grey + struck. */
export type ExportRowStyle = "muted" | "strike";

/** One written cell: its value and how to format it. */
export interface ExportCell {
  value: ExportCellValue;
  type: ExportColumnType;
  currency?: string;
  /** A totals cell Excel should re-add from the visible rows (SUBTOTAL). */
  sumFormula?: boolean;
}

/** A table on a sheet: header row, data rows, totals rows. */
export interface ExportTableBlock {
  kind: "table";
  title?: string;
  headers: string[];
  widths: (number | null)[];
  rows: { cells: ExportCell[]; style: ExportRowStyle | null }[];
  /** One row per currency when a total column has per-row currencies. */
  totals: ExportCell[][];
  autoFilter: boolean;
  freezeHeader: boolean;
}

/** Label / value pairs, e.g. a report header. */
export interface ExportFactsBlock {
  kind: "facts";
  title?: string;
  rows: { label: string; cell: ExportCell }[];
}

export type ExportBlock = ExportTableBlock | ExportFactsBlock;

/** One worksheet: its blocks, top to bottom, a blank row between them. */
export interface ExportSheetSpec {
  name: string;
  blocks: ExportBlock[];
}

export interface PdfCellSpec {
  text: string;
  /** In = green, Out = red. */
  tone?: "in" | "out";
  bold?: boolean;
  align?: "left" | "right" | "center";
}

export type PdfCell = string | PdfCellSpec;

export interface PdfItem {
  /** The main line, one cell per report column (bold by default). */
  cells: PdfCell[];
  /** A small grey line under the main line, across the columns. */
  sub?: string;
  /** Grey text. */
  muted?: boolean;
  /** Grey and struck through (e.g. voided). */
  strike?: boolean;
}

export interface PdfGroup {
  label: string;
  /** Right-hand text on the group header row, e.g. the day's totals. */
  totals?: string;
  items: PdfItem[];
}

export interface PdfSummaryBox {
  title: string;
  head: string[];
  rows: string[][];
  /** Columns drawn right-aligned (numbers). Default: all but the first. */
  numericColumns?: number[];
}

export interface PdfReport {
  title: string;
  /** Lines under the title (shop, period, filters, printed by/at). */
  headerLines: string[];
  summary: PdfSummaryBox[];
  columns: { header: string; width?: number; align?: "left" | "right" }[];
  groups: PdfGroup[];
  orientation?: "landscape" | "portrait";
}

/** What the engine hands a template: the table's rows as exported (its
 *  current filter and sort, every page) and the export moment. Anything
 *  else a template needs (filters, user, shop) it takes when it is built. */
export interface ExportTemplateContext<R> {
  rows: R[];
  now: Date;
}

export interface ExportTemplate<R> {
  excel: (ctx: ExportTemplateContext<R>) => ExportSheetSpec[];
  pdf: (ctx: ExportTemplateContext<R>) => PdfReport;
}

/* ------------------------------------------------------------------ */
/*  Building blocks                                                    */
/* ------------------------------------------------------------------ */

const CURRENCY_DECIMALS: Record<string, number> = { LBP: 0 };
const CURRENCY_PREFIX: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
};

export function currencyDecimals(currency: string): number {
  return CURRENCY_DECIMALS[currency] ?? 2;
}

/** Excel number format for a currency: `"$"#,##0.00`, `#,##0" LBP"`. */
export function moneyFormat(currency: string): string {
  const decimals = currencyDecimals(currency);
  const digits = decimals > 0 ? `#,##0.${"0".repeat(decimals)}` : "#,##0";
  const prefix = CURRENCY_PREFIX[currency];
  return prefix ? `"${prefix}"${digits}` : `${digits}" ${currency}"`;
}

export function roundMoney(value: number, currency: string): number {
  const f = 10 ** currencyDecimals(currency);
  return Math.round((value + Number.EPSILON) * f) / f;
}

function isBlank(v: ExportCellValue): boolean {
  return v === null || v === undefined || v === "";
}

/** A table block from rows + column specs (totals computed here). */
export function exportTable<S>(spec: {
  title?: string;
  rows: S[];
  columns: ExportColumn<S>[];
  autoFilter?: boolean;
  freezeHeader?: boolean;
  rowStyle?: (row: S) => ExportRowStyle | null;
  totalsLabel?: string;
}): ExportTableBlock {
  const { columns } = spec;
  const cellOf = (col: ExportColumn<S>, row: S): ExportCell => {
    const type = col.type ?? "text";
    const currency =
      typeof col.currency === "function" ? col.currency(row) : col.currency;
    let value = col.value(row);
    if (type === "money" && typeof value === "number" && currency) {
      value = roundMoney(value, currency);
    }
    return currency ? { value, type, currency } : { value, type };
  };
  const rows = spec.rows.map((row) => ({
    cells: columns.map((c) => cellOf(c, row)),
    style: spec.rowStyle?.(row) ?? null,
  }));

  const totals: ExportCell[][] = [];
  if (columns.some((c) => c.total)) {
    // Currencies of the per-row-currency total columns, first seen first.
    const mixed: string[] = [];
    columns.forEach((c, i) => {
      if (!c.total || typeof c.currency !== "function") return;
      for (const r of rows) {
        const cur = r.cells[i]!.currency;
        if (cur && !mixed.includes(cur)) mixed.push(cur);
      }
    });
    const lines = Math.max(1, mixed.length);
    const label = spec.totalsLabel ?? "Total";
    for (let line = 0; line < lines; line++) {
      const lineCurrency = mixed[line];
      totals.push(
        columns.map((c, i): ExportCell => {
          if (i === 0 && !c.total) {
            return {
              value: line === 0 ? label : `${label} ${lineCurrency ?? ""}`,
              type: "text",
            };
          }
          if (!c.total) return { value: null, type: "text" };
          const type = c.type ?? "number";
          if (typeof c.currency === "function") {
            if (!lineCurrency) return { value: null, type };
            let sum = 0;
            for (const r of rows) {
              const cell = r.cells[i]!;
              if (
                cell.currency === lineCurrency &&
                typeof cell.value === "number"
              )
                sum += cell.value;
            }
            return {
              value: roundMoney(sum, lineCurrency),
              type,
              currency: lineCurrency,
            };
          }
          if (line > 0) return { value: null, type };
          let sum = 0;
          for (const r of rows) {
            const v = r.cells[i]!.value;
            if (typeof v === "number") sum += v;
          }
          const currency = c.currency;
          return currency
            ? {
                value: roundMoney(sum, currency),
                type,
                currency,
                sumFormula: true,
              }
            : { value: sum, type, sumFormula: true };
        }),
      );
    }
  }

  return {
    kind: "table",
    ...(spec.title ? { title: spec.title } : {}),
    headers: columns.map((c) => c.header),
    widths: columns.map((c) => c.width ?? null),
    rows,
    totals,
    autoFilter: spec.autoFilter ?? false,
    freezeHeader: spec.freezeHeader ?? false,
  };
}

/** A facts block: `[label, value, { type, currency }?]` per line. */
export function exportFacts(
  title: string | undefined,
  rows: Array<
    [string, ExportCellValue, { type?: ExportColumnType; currency?: string }?]
  >,
): ExportFactsBlock {
  return {
    kind: "facts",
    ...(title ? { title } : {}),
    rows: rows.map(([label, value, opts]) => {
      const type =
        opts?.type ??
        (value instanceof Date
          ? "datetime"
          : typeof value === "number"
            ? "number"
            : "text");
      return {
        label,
        cell: opts?.currency
          ? { value, type, currency: opts.currency }
          : { value, type },
      };
    }),
  };
}

/* ------------------------------------------------------------------ */
/*  Excel                                                              */
/* ------------------------------------------------------------------ */

/** Excel's day number for the date as the user sees it (local time). */
function excelSerial(d: Date): number {
  const utc = Date.UTC(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
  );
  return (utc - Date.UTC(1899, 11, 30)) / 86_400_000;
}

const DATE_FORMATS: Partial<Record<ExportColumnType, string>> = {
  date: "dd mmm yyyy",
  time: "hh:mm",
  datetime: "dd mmm yyyy hh:mm",
  integer: "0",
  number: "#,##0.##",
};

function toSheetCell(cell: ExportCell): XLSX.CellObject | null {
  const { value, type } = cell;
  if (isBlank(value)) return null;
  if (value instanceof Date) {
    const serial = excelSerial(value);
    const v =
      type === "date"
        ? Math.floor(serial)
        : type === "time"
          ? serial - Math.floor(serial)
          : serial;
    return { t: "n", v, z: DATE_FORMATS[type] ?? DATE_FORMATS.datetime! };
  }
  if (typeof value === "number") {
    if (type === "money") {
      return { t: "n", v: value, z: moneyFormat(cell.currency ?? "USD") };
    }
    const z = DATE_FORMATS[type];
    return z ? { t: "n", v: value, z } : { t: "n", v: value };
  }
  return { t: "s", v: String(value) };
}

/** Style variants the post-write patch applies to whole rows. */
export type RowVariant = "title" | "header" | "bold" | "muted" | "strike";

/** Where each sheet needs a frozen pane / styled rows (1-based rows). */
export interface SheetLayout {
  freezeRows: number;
  rowVariants: Map<number, RowVariant>;
}

function textWidth(cell: ExportCell): number {
  const { value, type } = cell;
  if (isBlank(value)) return 0;
  if (value instanceof Date) return type === "time" ? 6 : 17;
  if (typeof value === "number") {
    return value.toLocaleString("en-US").length + (type === "money" ? 5 : 1);
  }
  return Math.max(
    ...String(value)
      .split("\n")
      .map((l) => l.length),
  );
}

/** The workbook SheetJS writes + the layout the patch then applies. */
export function buildTemplateWorkbook(sheets: ExportSheetSpec[]): {
  workbook: XLSX.WorkBook;
  layouts: SheetLayout[];
} {
  const workbook = XLSX.utils.book_new();
  const layouts: SheetLayout[] = [];

  for (const sheet of sheets) {
    const ws: XLSX.WorkSheet = {};
    const layout: SheetLayout = { freezeRows: 0, rowVariants: new Map() };
    const widths: number[] = [];
    const fixedWidths: (number | null)[] = [];
    let r = 0; // 0-based row cursor
    let maxCol = 0;

    const put = (row: number, col: number, cell: ExportCell) => {
      const c = toSheetCell(cell);
      maxCol = Math.max(maxCol, col);
      widths[col] = Math.max(widths[col] ?? 0, textWidth(cell));
      if (c) ws[XLSX.utils.encode_cell({ r: row, c: col })] = c;
    };
    const putRow = (cells: ExportCell[], variant: RowVariant | null) => {
      cells.forEach((cell, c) => put(r, c, cell));
      if (variant) layout.rowVariants.set(r + 1, variant);
      r += 1;
    };
    const text = (value: string): ExportCell => ({ value, type: "text" });

    sheet.blocks.forEach((block, b) => {
      if (b > 0) r += 1; // a blank row between blocks
      if (block.title) putRow([text(block.title)], "title");
      if (block.kind === "facts") {
        for (const f of block.rows) putRow([text(f.label), f.cell], null);
        return;
      }
      block.widths.forEach((w, c) => {
        if (w !== null) fixedWidths[c] = Math.max(fixedWidths[c] ?? 0, w);
      });
      const headerRow = r;
      putRow(block.headers.map(text), "header");
      if (block.freezeHeader && layout.freezeRows === 0) {
        layout.freezeRows = headerRow + 1;
      }
      const firstData = r;
      for (const row of block.rows) putRow(row.cells, row.style);
      const lastData = r - 1;
      if (block.autoFilter && !ws["!autofilter"]) {
        ws["!autofilter"] = {
          ref: XLSX.utils.encode_range({
            s: { r: headerRow, c: 0 },
            e: {
              r: Math.max(lastData, headerRow),
              c: block.headers.length - 1,
            },
          }),
        };
      }
      for (const cells of block.totals) {
        cells.forEach((cell, c) => {
          put(r, c, cell);
          // A single-currency total re-adds the VISIBLE rows when the
          // reader filters (SUBTOTAL 109); its cached value is the sum.
          const sheetCell = ws[XLSX.utils.encode_cell({ r, c })] as
            | XLSX.CellObject
            | undefined;
          if (
            cell.sumFormula &&
            sheetCell &&
            sheetCell.t === "n" &&
            lastData >= firstData
          ) {
            const col = XLSX.utils.encode_col(c);
            sheetCell.f = `SUBTOTAL(109,${col}${firstData + 1}:${col}${lastData + 1})`;
          }
        });
        layout.rowVariants.set(r + 1, "bold");
        r += 1;
      }
    });

    ws["!ref"] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: Math.max(r - 1, 0), c: maxCol },
    });
    ws["!cols"] = widths.map((w, c) => ({
      wch: fixedWidths[c] ?? Math.min(Math.max(w + 2, 10), 50),
    }));
    XLSX.utils.book_append_sheet(workbook, ws, sheet.name);
    layouts.push(layout);
  }
  return { workbook, layouts };
}

/* ── Post-write patch: frozen header + bold / grey / struck rows ──── */

interface CfbEntry {
  content: Uint8Array;
  size: number;
}
interface CfbApi {
  read(data: Uint8Array, opts: { type: "array" }): object;
  find(container: object, path: string): CfbEntry | null;
  write(
    container: object,
    opts: { type: "array"; fileType: "zip"; compression: boolean },
  ): ArrayLike<number>;
}
// `xlsx` ships its zip reader/writer as `XLSX.CFB`, typed `any` upstream;
// this is the narrow slice of it the patch uses.
// The ESM build Vite bundles (`xlsx.mjs`) and the CommonJS build jest loads
// both expose it; if a build ever does not, the patch is skipped (below).
const CFB = (XLSX as unknown as { CFB?: CfbApi }).CFB;

const BOLD_ON = "<b/>";
const GREY = '<color rgb="FF6B7280"/>';
/** Font index (appended after CE's one default font) and fill per variant. */
const VARIANTS: { variant: RowVariant; font: string; fill: boolean }[] = [
  { variant: "title", font: `${BOLD_ON}<sz val="14"/>`, fill: false },
  { variant: "header", font: `${BOLD_ON}<sz val="12"/>`, fill: true },
  { variant: "bold", font: `${BOLD_ON}<sz val="12"/>`, fill: false },
  { variant: "muted", font: `<sz val="12"/>${GREY}`, fill: false },
  { variant: "strike", font: `<strike/><sz val="12"/>${GREY}`, fill: false },
];

function patchStyles(xml: string): { xml: string; baseCount: number } | null {
  const fontsM = /<fonts count="(\d+)">([\s\S]*?)<\/fonts>/.exec(xml);
  const fillsM = /<fills count="(\d+)">([\s\S]*?)<\/fills>/.exec(xml);
  const xfsM = /<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/.exec(xml);
  if (!fontsM || !fillsM || !xfsM) return null;
  const fontCount = Number(fontsM[1]);
  const fillCount = Number(fillsM[1]);
  const baseXfs = xfsM[2]!.match(/<xf [^>]*\/>/g) ?? [];
  if (baseXfs.length === 0) return null;

  const tail =
    '<color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/>';
  const fonts = VARIANTS.map((v) =>
    v.font.includes(GREY)
      ? `<font>${v.font}<name val="Calibri"/><family val="2"/><scheme val="minor"/></font>`
      : `<font>${v.font}${tail}</font>`,
  );
  const headerFill =
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill>';
  const variantXfs = VARIANTS.flatMap((v, k) =>
    baseXfs.map((xf) =>
      xf
        .replace(/fontId="\d+"/, `fontId="${fontCount + k}"`)
        .replace(/fillId="\d+"/, `fillId="${v.fill ? fillCount : 0}"`)
        .replace(/\/>$/, ' applyFont="1" applyFill="1"/>'),
    ),
  );
  const out = xml
    .replace(
      fontsM[0],
      `<fonts count="${fontCount + fonts.length}">${fontsM[2]}${fonts.join("")}</fonts>`,
    )
    .replace(
      fillsM[0],
      `<fills count="${fillCount + 1}">${fillsM[2]}${headerFill}</fills>`,
    )
    .replace(
      xfsM[0],
      `<cellXfs count="${baseXfs.length * (1 + VARIANTS.length)}">${baseXfs.join("")}${variantXfs.join("")}</cellXfs>`,
    );
  return { xml: out, baseCount: baseXfs.length };
}

function patchSheet(
  xml: string,
  layout: SheetLayout,
  baseCount: number,
): string {
  let out = xml;
  if (layout.freezeRows > 0) {
    const n = layout.freezeRows;
    out = out.replace(
      /<sheetView workbookViewId="0"\/>/,
      `<sheetView workbookViewId="0"><pane ySplit="${n}" topLeftCell="A${n + 1}" activePane="bottomLeft" state="frozen"/></sheetView>`,
    );
  }
  if (baseCount === 0 || layout.rowVariants.size === 0) return out;
  return out.replace(
    /<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g,
    (whole, rowNum: string, attrs: string, body: string) => {
      const variant = layout.rowVariants.get(Number(rowNum));
      if (!variant) return whole;
      const k = VARIANTS.findIndex((v) => v.variant === variant) + 1;
      const cells = body.replace(
        /<c r="([A-Z]+\d+)"([^>]*?)(\/?)>/g,
        (_c, ref: string, cAttrs: string, selfClose: string) => {
          const s = /\ss="(\d+)"/.exec(cAttrs);
          const base = s ? Number(s[1]) : 0;
          const rest = cAttrs.replace(/\ss="\d+"/, "");
          return `<c r="${ref}" s="${base + k * baseCount}"${rest}${selfClose}>`;
        },
      );
      return `<row r="${rowNum}"${attrs}>${cells}</row>`;
    },
  );
}

/** Add the frozen panes and row styles SheetJS CE cannot write. */
export function patchWorkbookXml(
  bytes: Uint8Array,
  layouts: SheetLayout[],
): Uint8Array<ArrayBuffer> {
  // Best effort: a file without the frozen header / bold rows beats no
  // file at all.
  if (!CFB) return Uint8Array.from(bytes);
  try {
    return applyPatch(CFB, bytes, layouts);
  } catch {
    return Uint8Array.from(bytes);
  }
}

function applyPatch(
  cfb: CfbApi,
  bytes: Uint8Array,
  layouts: SheetLayout[],
): Uint8Array<ArrayBuffer> {
  const zip = cfb.read(bytes, { type: "array" });
  const setText = (entry: CfbEntry, text: string) => {
    entry.content = new TextEncoder().encode(text);
    entry.size = entry.content.length;
  };
  const decode = (entry: CfbEntry) => new TextDecoder().decode(entry.content);

  const stylesEntry = cfb.find(zip, "/xl/styles.xml");
  let baseCount = 0;
  if (stylesEntry) {
    const patched = patchStyles(decode(stylesEntry));
    if (patched) {
      setText(stylesEntry, patched.xml);
      baseCount = patched.baseCount;
    }
  }
  layouts.forEach((layout, i) => {
    const entry = cfb.find(zip, `/xl/worksheets/sheet${i + 1}.xml`);
    if (entry) setText(entry, patchSheet(decode(entry), layout, baseCount));
  });
  return Uint8Array.from(
    cfb.write(zip, { type: "array", fileType: "zip", compression: true }),
  );
}

/** The finished .xlsx bytes for a template's sheets. */
export function writeTemplateWorkbook(
  sheets: ExportSheetSpec[],
): Uint8Array<ArrayBuffer> {
  const { workbook, layouts } = buildTemplateWorkbook(sheets);
  const raw = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as
    | ArrayBuffer
    | Uint8Array;
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  return patchWorkbookXml(bytes, layouts);
}

/* ------------------------------------------------------------------ */
/*  PDF                                                                */
/* ------------------------------------------------------------------ */

/**
 * jsPDF's built-in Helvetica only has the WinAnsi characters; others
 * print as garbage. Swap the few the app's formatters use.
 */
export function pdfText(s: string): string {
  return s
    .replace(/[−–—]/g, "-")
    .replace(/→/g, "->")
    .replace(/↩\s*/g, "")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\u00A0-\u00FF\u20AC\n]/g, "");
}

const GREEN: [number, number, number] = [21, 128, 61];
const RED: [number, number, number] = [185, 28, 28];
const INK: [number, number, number] = [17, 24, 39];
const GREY_TEXT: [number, number, number] = [107, 114, 128];
const MUTED_TEXT: [number, number, number] = [156, 163, 175];

export interface PdfRowMeta {
  kind: "group" | "item" | "sub";
  strike?: boolean;
}

/** The autotable body for a report — separate so it can be tested. */
export function buildPdfReportBody(report: PdfReport): {
  body: RowInput[];
  meta: PdfRowMeta[];
} {
  const n = report.columns.length;
  const body: RowInput[] = [];
  const meta: PdfRowMeta[] = [];
  for (const group of report.groups) {
    const labelSpan = group.totals ? Math.max(1, Math.ceil(n / 2)) : n;
    const groupRow: CellInput[] = [
      {
        content: pdfText(group.label),
        colSpan: labelSpan,
        styles: {
          fontStyle: "bold",
          fontSize: 9,
          fillColor: [229, 231, 235],
          textColor: INK,
        },
      },
    ];
    if (group.totals) {
      groupRow.push({
        content: pdfText(group.totals),
        colSpan: n - labelSpan,
        styles: {
          fontStyle: "bold",
          fontSize: 8,
          halign: "right",
          fillColor: [229, 231, 235],
          textColor: INK,
        },
      });
    }
    body.push(groupRow);
    meta.push({ kind: "group" });

    for (const item of group.items) {
      const grey = item.muted || item.strike;
      // The sub line hangs off the item's first cell (rowSpan 2): autotable
      // keeps a row-spanned pair on one page, so a sub line never lands on
      // the next page without its transaction.
      const lead = item.sub && n > 2 ? 1 : 0;
      body.push(
        item.cells.map((cell, i): CellInput => {
          const spec: PdfCellSpec =
            typeof cell === "string" ? { text: cell } : cell;
          const color = grey
            ? MUTED_TEXT
            : spec.tone === "in"
              ? GREEN
              : spec.tone === "out"
                ? RED
                : INK;
          const align = spec.align ?? report.columns[i]?.align;
          return {
            content: pdfText(spec.text),
            ...(i === 0 && lead ? { rowSpan: 2 } : {}),
            styles: {
              fontStyle: spec.bold === false ? "normal" : "bold",
              textColor: color,
              fillColor: [255, 255, 255],
              cellPadding: {
                top: 3,
                right: 4,
                bottom: item.sub ? 0 : 3,
                left: 4,
              },
              ...(align ? { halign: align } : {}),
            },
          };
        }),
      );
      meta.push(
        item.strike ? { kind: "item", strike: true } : { kind: "item" },
      );
      if (item.sub) {
        const subRow: CellInput[] = [];
        subRow.push({
          content: pdfText(item.sub),
          colSpan: n - lead,
          styles: {
            fontSize: 7,
            fontStyle: "normal",
            textColor: grey ? MUTED_TEXT : GREY_TEXT,
            fillColor: [255, 255, 255],
            cellPadding: { top: 0, right: 4, bottom: 4, left: 4 },
          },
        });
        body.push(subRow);
        meta.push({ kind: "sub" });
      }
    }
  }
  return { body, meta };
}

/** Draw the whole report — separate from saving so it can be tested. */
export function renderPdfReport(report: PdfReport): jsPDF {
  const doc = new jsPDF({
    orientation: report.orientation ?? "landscape",
    unit: "pt",
    format: "a4",
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 30;

  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(pdfText(report.title), margin, 36);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GREY_TEXT);
  let y = 50;
  for (const line of report.headerLines) {
    doc.text(pdfText(line), margin, y);
    y += 11;
  }

  // Summary boxes side by side.
  let summaryBottom = y;
  if (report.summary.length > 0) {
    const gap = 12;
    const boxWidth =
      (pageWidth - 2 * margin - gap * (report.summary.length - 1)) /
      report.summary.length;
    report.summary.forEach((box, i) => {
      const alignOf = (j: number): "left" | "right" =>
        (box.numericColumns ? box.numericColumns.includes(j) : j > 0)
          ? "right"
          : "left";
      autoTable(doc, {
        startY: y + 4,
        margin: { left: margin + i * (boxWidth + gap), right: margin },
        tableWidth: boxWidth,
        head: [
          [
            {
              content: pdfText(box.title),
              colSpan: box.head.length,
              styles: {
                halign: "left",
                fillColor: [31, 41, 55],
                textColor: [255, 255, 255],
              },
            },
          ],
          box.head.map((h, j) => ({
            content: pdfText(h),
            styles: { halign: alignOf(j) },
          })),
        ],
        body: box.rows.map((row) =>
          row.map((c, j) => ({
            content: pdfText(c),
            styles: { halign: alignOf(j) },
          })),
        ),
        theme: "grid",
        styles: { fontSize: 7.5, cellPadding: 2.5, lineColor: [229, 231, 235] },
        headStyles: {
          fillColor: [243, 244, 246],
          textColor: INK,
          fontStyle: "bold",
        },
        pageBreak: "avoid",
      });
      const last = (doc as unknown as { lastAutoTable?: { finalY: number } })
        .lastAutoTable;
      summaryBottom = Math.max(summaryBottom, last?.finalY ?? y);
    });
  }

  const { body, meta } = buildPdfReportBody(report);
  autoTable(doc, {
    startY: summaryBottom + 14,
    head: [
      report.columns.map((c) => ({
        content: pdfText(c.header),
        styles: c.align ? { halign: c.align } : {},
      })),
    ],
    body,
    columnStyles: Object.fromEntries(
      report.columns.map((c, i) => [i, c.width ? { cellWidth: c.width } : {}]),
    ),
    styles: { fontSize: 8, cellPadding: 3, overflow: "linebreak" },
    headStyles: {
      fillColor: [31, 41, 55],
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    margin: { left: margin, right: margin, bottom: 36 },
    didDrawCell: (data) => {
      if (data.section !== "body") return;
      if (!meta[data.row.index]?.strike) return;
      // One line through each line of text (a wrapped summary has two).
      const { cell } = data;
      const fontSize = cell.styles.fontSize;
      doc.setFontSize(fontSize);
      doc.setFont("helvetica", cell.styles.fontStyle);
      const lineHeight = fontSize * doc.getLineHeightFactor();
      const top = cell.y + cell.padding("top");
      doc.setDrawColor(...MUTED_TEXT);
      doc.setLineWidth(0.6);
      cell.text.forEach((line, k) => {
        const text = line.trim();
        if (!text) return;
        const width = Math.min(doc.getTextWidth(text), cell.width - 8);
        const x =
          cell.styles.halign === "right"
            ? cell.x + cell.width - cell.padding("right") - width
            : cell.x + cell.padding("left");
        const y = top + lineHeight * k + fontSize * 0.55;
        doc.line(x, y, x + width, y);
      });
    },
  });

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GREY_TEXT);
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.text(pdfText(report.title), margin, pageHeight - 16);
    doc.text(`Page ${p} of ${pages}`, pageWidth - margin, pageHeight - 16, {
      align: "right",
    });
  }
  return doc;
}

/* ------------------------------------------------------------------ */
/*  Save                                                               */
/* ------------------------------------------------------------------ */

export function exportTemplateToExcel<R>(
  template: ExportTemplate<R>,
  ctx: ExportTemplateContext<R>,
  filename: string,
): void {
  const bytes = writeTemplateWorkbook(template.excel(ctx));
  saveAs(
    new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${filename}.xlsx`,
  );
}

export function exportTemplateToPdf<R>(
  template: ExportTemplate<R>,
  ctx: ExportTemplateContext<R>,
  filename: string,
): void {
  renderPdfReport(template.pdf(ctx)).save(`${filename}.pdf`);
}
