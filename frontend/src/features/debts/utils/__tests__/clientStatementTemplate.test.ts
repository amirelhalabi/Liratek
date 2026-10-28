/**
 * LIRA-350 (review C14) — the client statement export: the client's name and
 * phone at the top, the balance and totals per currency, the purchases AND
 * the payments, date and time in their own columns, amounts as real numbers
 * (Excel can add them), each row's client line, a PDF with no "→" garbage,
 * and a file name with the client's name.
 */
import {
  buildPdfReportBody,
  pdfText,
  type ExportFactsBlock,
  type ExportTableBlock,
} from "@liratek/ui";
import type { DebtLedgerEntity } from "@liratek/ui";
import { buildClientDebtDetails } from "@liratek/core";
import {
  buildClientStatementTemplate,
  statementFilename,
} from "../clientStatementTemplate";

const row = (o: Partial<DebtLedgerEntity>): DebtLedgerEntity => ({
  id: 1,
  client_id: 9927,
  transaction_id: 1,
  transaction_type: "Exchange Debt",
  amount_usd: 0,
  amount_lbp: 0,
  note: null,
  created_at: "2026-10-26 22:22:26",
  created_by: null,
  session_id: null,
  ...o,
});

const purchases = [
  row({
    id: 10,
    amount_usd: 10,
    note: "Exchange USD → LBP",
    client_details: {
      kind: "exchange",
      ref: null,
      line: "$20 → 1,780,000 LBP @ 89,000, paid $10, $10 on account",
      fields: [],
      items: [],
      payments: [],
      onAccount: { usd: 10, lbp: 0 },
      note: null,
    },
  }),
  row({
    id: 11,
    transaction_type: "Loto Debt",
    amount_lbp: 200000,
    note: "Loto",
  }),
];
const payments = [
  row({
    id: 20,
    transaction_type: "Repayment",
    amount_usd: -5,
    note: "Cash repayment",
    // Built by the real core builder from a repayment's saved data.
    client_details: buildClientDebtDetails({
      ledger: {
        transaction_type: "Repayment",
        amount_usd: -5,
        amount_lbp: 0,
        note: "Cash repayment",
      },
      tx: {
        id: 30,
        type: "DEBT_REPAYMENT",
        summary: "Debt repayment: $5",
        metadata_json: JSON.stringify({
          payment_snapshot: {
            lines: [
              { method: "CASH", currency: "USD", amount: 5, direction: "IN" },
            ],
          },
        }),
        amount_usd: 5,
        amount_lbp: 0,
      },
    }),
  }),
];

const LABELS = {
  title: "Account statement",
  client: "Client",
  phone: "Phone",
  printed: "Printed",
  balance: "Balance",
  purchases: "Purchases & charges",
  payments: "Payments",
  date: "Date",
  time: "Time",
  description: "Description",
  total: "Total",
  totalCharged: "Total charged",
  totalPaid: "Total paid",
};

function build() {
  return buildClientStatementTemplate({
    client: { full_name: "Review Client 26-10", phone_number: "03261026" },
    purchases,
    payments,
    balance: { usd: 5, lbp: 200000 },
    labels: LABELS,
    formatDate: (d) => `D${d.getUTCDate()}`,
    formatTime: (d) => `T${d.getUTCHours()}`,
  });
}

describe("client statement export (LIRA-350, C14)", () => {
  it("Excel: name + phone header, balance per currency, purchases and payments with numeric money and separate date/time", () => {
    const sheets = build().excel({ rows: purchases, now: new Date() });
    expect(sheets).toHaveLength(1);
    const blocks = sheets[0]!.blocks;
    const facts = blocks[0] as ExportFactsBlock;
    expect(facts.rows.map((r) => [r.label, r.cell.value])).toEqual(
      expect.arrayContaining([
        ["Client", "Review Client 26-10"],
        ["Phone", "03261026"],
        ["Balance USD", 5],
        ["Balance LBP", 200000],
      ]),
    );
    const buys = blocks[1] as ExportTableBlock;
    expect(buys.title).toBe("Purchases & charges");
    expect(buys.headers).toEqual(["Date", "Time", "Description", "USD", "LBP"]);
    expect(buys.rows[0]!.cells.map((c) => c.type)).toEqual([
      "date",
      "time",
      "text",
      "money",
      "money",
    ]);
    expect(buys.rows[0]!.cells[2]!.value).toBe(
      "$20 → 1,780,000 LBP @ 89,000, paid $10, $10 on account",
    );
    expect(buys.rows[0]!.cells[3]!.value).toBe(10);
    expect(buys.totals[0]!.map((c) => c.value)).toEqual([
      "Total",
      null,
      null,
      10,
      200000,
    ]);
    const pays = blocks[2] as ExportTableBlock;
    expect(pays.title).toBe("Payments");
    expect(pays.rows[0]!.cells[2]!.value).toBe("Debt repayment: $5");
    expect(pays.rows[0]!.cells[3]!.value).toBe(5);
  });

  it("PDF: title with the client, phone line, summary per currency, both sections, no '→' left for Helvetica", () => {
    const report = build().pdf({ rows: purchases, now: new Date() });
    expect(report.title).toBe("Account statement — Review Client 26-10");
    expect(report.headerLines[0]).toBe("Phone: 03261026");
    expect(report.columns.map((c) => c.header)).toEqual([
      "Date",
      "Time",
      "Description",
      "USD",
      "LBP",
    ]);
    expect(report.groups.map((g) => g.label)).toEqual([
      "Purchases & charges",
      "Payments",
    ]);
    const { body } = buildPdfReportBody(report);
    const text = JSON.stringify(body);
    expect(text).not.toContain("→");
    expect(text).toContain("$20 -> 1,780,000 LBP @ 89,000");
    expect(pdfText("a → b")).toBe("a -> b");
  });

  it("file name carries the client's name, safely", () => {
    expect(statementFilename("Review Client 26-10")).toBe(
      "statement-Review-Client-26-10",
    );
    expect(statementFilename('a/b:c*?"<>|')).toBe("statement-a-b-c");
  });
});

describe("client statement — a voided charge, its cancellation and the re-entry (2026-10-28)", () => {
  const LINE = "OMT send 5,630,000 LBP";
  const details = {
    kind: "transfer" as const,
    ref: null,
    line: LINE,
    fields: [],
    items: [],
    payments: [],
    onAccount: { usd: 0, lbp: 5630000 },
    note: null,
  };
  const rows = [
    row({
      id: 181570,
      transaction_id: 13435,
      transaction_type: "Service Debt",
      amount_lbp: 5630000,
      client_details: details,
    }),
    row({
      id: 181569,
      transaction_id: 12708,
      transaction_type: "Refund Reversal",
      amount_lbp: -5630000,
      note: "Debt cancelled by refund/void",
      client_details: details,
    }),
    row({
      id: 181456,
      transaction_id: 12708,
      transaction_type: "Service Debt",
      amount_lbp: 5630000,
      client_details: details,
    }),
  ];

  it("marks the voided charge and words the reversal as its cancellation; the total stays the balance", () => {
    const sheets = buildClientStatementTemplate({
      client: { full_name: "SouheiL SALIM Kerbaj", phone_number: null },
      purchases: rows,
      payments: [],
      balance: { usd: 0, lbp: 5630000 },
      labels: {
        ...LABELS,
        voided: "Voided",
        cancelledLine: (line: string) => `Cancelled: ${line}`,
      },
      formatDate: (d) => `D${d.getUTCDate()}`,
      formatTime: (d) => `T${d.getUTCHours()}`,
    }).excel({ rows, now: new Date() });
    const buys = sheets[0]!.blocks[1] as ExportTableBlock;
    expect(
      buys.rows.map((r) => [r.cells[2]!.value, r.cells[4]!.value]),
    ).toEqual([
      [LINE, 5630000],
      [`Cancelled: ${LINE}`, -5630000],
      [`${LINE} (Voided)`, 5630000],
    ]);
    expect(buys.totals[0]![4]!.value).toBe(5630000);
  });
});
