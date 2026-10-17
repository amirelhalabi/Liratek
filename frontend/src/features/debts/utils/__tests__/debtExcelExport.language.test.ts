/**
 * LIRA-331 T054 (FR-024) — the accounts export writes its headings in the
 * exporting user's language, while everything the import reads back stays
 * the same: numbers are numeric cells, the "List Name" sheet and its NAME
 * header, the TOTAL footer markers the import skips, and the row
 * descriptions (re-imported as notes).
 *
 * The headings come from `debtExportHeadings(t)`, the same function the
 * Accounts page calls.
 */
import * as XLSX from "xlsx";
import type { DebtLedgerEntity } from "@liratek/ui";
import { i18n, loadLanguage } from "@/i18n/setup";
import {
  buildDebtExportWorkbook,
  debtExportHeadings,
  ENGLISH_EXPORT_HEADINGS,
  type DebtExportClient,
} from "../debtExcelExport";

function entry(
  id: number,
  over: Partial<DebtLedgerEntity> & {
    transaction_type: string;
    created_at: string;
  },
): DebtLedgerEntity {
  return {
    id,
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

const client: DebtExportClient = {
  name: "Language Demo",
  phone: "03999222",
  history: [
    entry(1, {
      transaction_type: "Manual Debt",
      created_at: "2026-10-01 09:00:00",
      amount_usd: 12.5,
      amount_lbp: 500_000,
      note: "opening",
    }),
    entry(2, {
      transaction_type: "CREDIT_DEPOSIT",
      created_at: "2026-10-02 09:00:00",
      amount_usd: -5,
    }),
    entry(3, {
      transaction_type: "Repayment",
      created_at: "2026-10-03 09:00:00",
      amount_lbp: -200_000,
      note: "paid at counter",
      is_refunded: 1,
    }),
  ],
};

function roundTrip(lang: "en" | "ar"): XLSX.WorkBook {
  const headings = debtExportHeadings(i18n.getFixedT(lang, "debts"));
  const buf = XLSX.write(buildDebtExportWorkbook([client], headings), {
    bookType: "xlsx",
    type: "array",
  });
  return XLSX.read(buf, { type: "array", cellDates: true });
}

/** Every cell of a sheet as { address: { t, v } }, formulas dropped. */
function cells(ws: XLSX.WorkSheet): Record<string, { t: string; v: unknown }> {
  const out: Record<string, { t: string; v: unknown }> = {};
  for (const [addr, cell] of Object.entries(ws)) {
    if (addr.startsWith("!")) continue;
    const c = cell as XLSX.CellObject;
    out[addr] = {
      t: c.t,
      v: c.v instanceof Date ? c.v.toISOString() : c.v,
    };
  }
  return out;
}

const HEADING_CELLS = [
  "A1",
  "C1",
  "A2",
  "B2",
  "C2",
  "D2",
  "F2",
  "G2",
  "H2",
  "I2",
];

beforeAll(async () => {
  await loadLanguage("ar");
});

describe("accounts export — headings follow the language (LIRA-331)", () => {
  it("English headings are the import template's, byte for byte", () => {
    expect(debtExportHeadings(i18n.getFixedT("en", "debts"))).toEqual(
      ENGLISH_EXPORT_HEADINGS,
    );
  });

  it("Arabic headings are Arabic, with Western digits only", () => {
    const ar = debtExportHeadings(i18n.getFixedT("ar", "debts"));
    for (const [key, value] of Object.entries(ar)) {
      expect([key, /[؀-ۿ]/.test(value)]).toEqual([key, true]);
      expect(value).not.toMatch(/[٠-٩]/);
    }
  });

  it("only the headings differ: numbers, markers and descriptions are identical", () => {
    const en = roundTrip("en");
    const ar = roundTrip("ar");
    expect(ar.SheetNames).toEqual(en.SheetNames);

    // The List Name sheet is read by the import: unchanged.
    expect(cells(ar.Sheets["List Name"]!)).toEqual(
      cells(en.Sheets["List Name"]!),
    );

    const enPage = cells(en.Sheets[en.SheetNames[1]!]!);
    const arPage = cells(ar.Sheets[ar.SheetNames[1]!]!);
    expect(Object.keys(arPage).sort()).toEqual(Object.keys(enPage).sort());

    const balanceLabels = Object.keys(enPage).filter((a) =>
      String(enPage[a]!.v).startsWith("Balance Remaining"),
    );
    expect(balanceLabels).toHaveLength(2);
    const translated = new Set([...HEADING_CELLS, ...balanceLabels]);

    for (const addr of Object.keys(enPage)) {
      if (translated.has(addr)) {
        expect(arPage[addr]!.v).not.toEqual(enPage[addr]!.v);
      } else {
        expect([addr, arPage[addr]]).toEqual([addr, enPage[addr]]);
      }
    }

    // Numbers stay numeric cells in Arabic.
    const numeric = Object.entries(arPage).filter(([, c]) => c.t === "n");
    expect(numeric.length).toBeGreaterThanOrEqual(6);
    expect(numeric.map(([, c]) => typeof c.v)).toEqual(
      numeric.map(() => "number"),
    );

    // The import skips the footer by the word "total": still there.
    const footer = Object.values(arPage)
      .map((c) => String(c.v))
      .filter((v) => v.toLowerCase().includes("total"));
    expect(footer).toEqual(["TOTAL ON ACCOUNT", "TOTAL PAID"]);
  });
});
