/**
 * LIRA-350 (review C14) — a client's account statement, as the Excel / PDF
 * export of the Accounts page's tables: the shop can hand it to the client.
 *
 *  Excel — one "Statement" sheet: the client's name and phone, the date it
 *  was printed and the balance per currency; then Purchases & charges and
 *  Payments, each row with its date and time in their own columns, the
 *  row's client line (core's `client_details.line`, the same words the page
 *  shows — rule 14) and its USD / LBP amounts as real numbers with a totals
 *  row.
 *  PDF — the same, as a report: title with the client, phone line, a
 *  summary box per currency, and the two sections. The shared engine's
 *  `pdfText` turns "→" and other characters Helvetica cannot draw into
 *  plain ones.
 *
 * Pure: rows and words in, template out. Dates are formatted by the page's
 * own formatters (passed in), so the PDF reads in the user's language.
 */
import {
  exportFacts,
  exportTable,
  type DebtLedgerEntity,
  type ExportTemplate,
  type PdfItem,
} from "@liratek/ui";
import { clientMoney } from "@liratek/core";
import { parseDbDate } from "@/shared/utils/parseDbDate";

export interface ClientStatementLabels {
  title: string;
  client: string;
  phone: string;
  printed: string;
  balance: string;
  purchases: string;
  payments: string;
  date: string;
  time: string;
  description: string;
  total: string;
  totalCharged: string;
  totalPaid: string;
}

export interface ClientStatementInput {
  client: { full_name: string; phone_number: string | null };
  purchases: DebtLedgerEntity[];
  payments: DebtLedgerEntity[];
  /** The client's balance (the ledger's own sum), per currency. */
  balance: { usd: number; lbp: number };
  labels: ClientStatementLabels;
  formatDate: (d: Date) => string;
  formatTime: (d: Date) => string;
}

/** What a row says: the client line, else its stored note. */
export function statementDescription(row: DebtLedgerEntity): string {
  return row.client_details?.line || row.note || row.transaction_type;
}

/** "statement-Review-Client-26-10" — no characters a file system refuses. */
export function statementFilename(name: string): string {
  const safe = name
    .replace(/[\\/:*?"<>|]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return `statement${safe ? `-${safe}` : ""}`;
}

const amountText = (n: number, currency: "USD" | "LBP"): string =>
  Math.abs(n) > (currency === "USD" ? 0.004 : 0.5)
    ? clientMoney(n, currency)
    : "";

export function buildClientStatementTemplate(
  input: ClientStatementInput,
): ExportTemplate<DebtLedgerEntity> {
  const { labels: L, client } = input;
  // Payments are stored negative (they lower the balance); a statement
  // lists what was paid, so as positive amounts.
  const paid = (r: DebtLedgerEntity, c: "usd" | "lbp") =>
    -(c === "usd" ? r.amount_usd : r.amount_lbp);
  const sum = (rows: DebtLedgerEntity[], f: (r: DebtLedgerEntity) => number) =>
    rows.reduce((s, r) => s + f(r), 0);
  const charged = {
    usd: sum(input.purchases, (r) => r.amount_usd),
    lbp: sum(input.purchases, (r) => r.amount_lbp),
  };
  const paidTotals = {
    usd: sum(input.payments, (r) => paid(r, "usd")),
    lbp: sum(input.payments, (r) => paid(r, "lbp")),
  };

  const section = (
    title: string,
    rows: DebtLedgerEntity[],
    usd: (r: DebtLedgerEntity) => number,
    lbp: (r: DebtLedgerEntity) => number,
  ) =>
    exportTable<DebtLedgerEntity>({
      title,
      rows,
      totalsLabel: L.total,
      columns: [
        {
          header: L.date,
          type: "date",
          value: (r) => parseDbDate(r.created_at),
        },
        {
          header: L.time,
          type: "time",
          value: (r) => parseDbDate(r.created_at),
        },
        {
          header: L.description,
          value: statementDescription,
          width: 70,
        },
        {
          header: "USD",
          type: "money",
          currency: "USD",
          total: true,
          value: (r) => usd(r),
        },
        {
          header: "LBP",
          type: "money",
          currency: "LBP",
          total: true,
          value: (r) => lbp(r),
        },
      ],
    });

  const pdfItems = (
    rows: DebtLedgerEntity[],
    usd: (r: DebtLedgerEntity) => number,
    lbp: (r: DebtLedgerEntity) => number,
  ): PdfItem[] =>
    rows.map((r) => {
      const d = parseDbDate(r.created_at);
      return {
        cells: [
          { text: input.formatDate(d), bold: false },
          { text: input.formatTime(d), bold: false },
          { text: statementDescription(r), bold: false },
          { text: amountText(usd(r), "USD"), align: "right" },
          { text: amountText(lbp(r), "LBP"), align: "right" },
        ],
      };
    });

  const totalsText = (v: { usd: number; lbp: number }) =>
    [amountText(v.usd, "USD"), amountText(v.lbp, "LBP")]
      .filter(Boolean)
      .join(" + ") || clientMoney(0, "USD");

  return {
    excel: ({ now }) => [
      {
        name: "Statement",
        blocks: [
          exportFacts(L.title, [
            [L.client, client.full_name],
            [L.phone, client.phone_number ?? ""],
            [L.printed, now, { type: "datetime" }],
            [
              `${L.balance} USD`,
              input.balance.usd,
              { type: "money", currency: "USD" },
            ],
            [
              `${L.balance} LBP`,
              input.balance.lbp,
              { type: "money", currency: "LBP" },
            ],
          ]),
          section(
            L.purchases,
            input.purchases,
            (r) => r.amount_usd,
            (r) => r.amount_lbp,
          ),
          section(
            L.payments,
            input.payments,
            (r) => paid(r, "usd"),
            (r) => paid(r, "lbp"),
          ),
        ],
      },
    ],
    pdf: ({ now }) => ({
      title: `${L.title} — ${client.full_name}`,
      headerLines: [
        `${L.phone}: ${client.phone_number ?? "—"}`,
        `${L.printed}: ${input.formatDate(now)} ${input.formatTime(now)}`,
      ],
      summary: [
        {
          title: L.balance,
          head: ["", "USD", "LBP"],
          rows: [
            [
              L.totalCharged,
              amountText(charged.usd, "USD") || "-",
              amountText(charged.lbp, "LBP") || "-",
            ],
            [
              L.totalPaid,
              amountText(paidTotals.usd, "USD") || "-",
              amountText(paidTotals.lbp, "LBP") || "-",
            ],
            [
              L.balance,
              clientMoney(input.balance.usd, "USD"),
              clientMoney(input.balance.lbp, "LBP"),
            ],
          ],
        },
      ],
      columns: [
        { header: L.date, width: 70 },
        { header: L.time, width: 55 },
        { header: L.description },
        { header: "USD", width: 75, align: "right" },
        { header: "LBP", width: 95, align: "right" },
      ],
      groups: [
        {
          label: L.purchases,
          totals: totalsText(charged),
          items: pdfItems(
            input.purchases,
            (r) => r.amount_usd,
            (r) => r.amount_lbp,
          ),
        },
        {
          label: L.payments,
          totals: totalsText(paidTotals),
          items: pdfItems(
            input.payments,
            (r) => paid(r, "usd"),
            (r) => paid(r, "lbp"),
          ),
        },
      ],
      orientation: "portrait",
    }),
  };
}
