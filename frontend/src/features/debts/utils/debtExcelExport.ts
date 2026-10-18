import type * as XLSX from "xlsx";
import type { ApiAdapter, DebtLedgerEntity } from "@liratek/ui";

/**
 * Ledger types shown on the Payments (right) side of a client's account on
 * the Debts page — everything else is a Purchase (left side). One definition
 * for the page's two history tables. (The Excel export splits by sign
 * instead — see `buildClientSheet` — because the import only reads amounts
 * above zero.)
 *
 * CREDIT_DEPOSIT reduces what the client owes (or raises the shop's debt to
 * the client) → payment side. CREDIT_USED charges against credit → purchase.
 */
export const PAYMENT_LEDGER_TYPES: ReadonlySet<string> = new Set([
  "Repayment",
  "CREDIT_DEPOSIT",
]);

export function isPaymentLedgerType(type: string): boolean {
  return PAYMENT_LEDGER_TYPES.has(type);
}

/**
 * Custom document property our export stamps on the workbook. The import
 * trusts a file's dates only when it carries this marker: the shop's old
 * handwritten ledgers hold mistyped dates, so for them every row keeps the
 * "yesterday" stamp it has always had.
 */
export const EXPORT_MARKER_PROP = "LiraTekAccountsExport";
export const EXPORT_MARKER_VERSION = "1";

export function isLiraTekAccountsExport(wb: XLSX.WorkBook): boolean {
  const props = wb.Custprops as Record<string, unknown> | undefined;
  return props?.[EXPORT_MARKER_PROP] === EXPORT_MARKER_VERSION;
}

/**
 * The real time of an exported row, as an ISO string for the import, or null
 * when the cell holds no usable date. Excel stores times as fractions of a
 * day, so they come back a millisecond off — rounded to the second here,
 * which keeps the import's same-row duplicate check exact.
 */
export function exportedRowDate(cell: unknown): string | null {
  if (!(cell instanceof Date) || Number.isNaN(cell.getTime())) return null;
  return new Date(Math.round(cell.getTime() / 1000) * 1000).toISOString();
}

export interface DebtExportClient {
  name: string;
  phone: string;
  history: DebtLedgerEntity[];
}

/** What the same-shop check needs from one parsed client page. */
export interface ImportedPageForShopCheck {
  phone: string;
  entries: {
    amount_usd: number;
    amount_lbp: number;
    type: "debt" | "payment";
  }[];
}

/** What the same-shop check needs from this shop's account list. */
export interface ShopBalanceForShopCheck {
  phone_number: string | null;
  total_debt_usd: number;
  total_debt_lbp: number;
}

const digitsOnly = (raw: string | null | undefined) =>
  String(raw ?? "").replace(/\D/g, "");

/**
 * True when importing this exported file here would add balances the shop
 * already holds — i.e. it is being imported back into the shop it came from
 * (or one that already received it). The import writes new "Imported Debt"
 * rows that never match the shop's original rows, so going ahead would double
 * every one of those clients' balances.
 *
 * Test: of the file's clients with a non-zero balance, at least half are
 * found here by phone with the SAME balance in both currencies. A genuinely
 * new shop matches none. A shop that moved on since the export (a few
 * clients paid or bought more) still matches most of them.
 */
export function looksLikeSameShop(
  pages: ImportedPageForShopCheck[],
  shopBalances: ShopBalanceForShopCheck[],
): boolean {
  const byPhone = new Map<string, ShopBalanceForShopCheck>();
  for (const b of shopBalances) {
    const phone = digitsOnly(b.phone_number);
    if (phone) byPhone.set(phone, b);
  }

  let withBalance = 0;
  let matching = 0;
  for (const page of pages) {
    let usd = 0;
    let lbp = 0;
    for (const e of page.entries) {
      const sign = e.type === "payment" ? -1 : 1;
      usd += sign * e.amount_usd;
      lbp += sign * e.amount_lbp;
    }
    if (Math.abs(usd) < 0.005 && Math.abs(lbp) < 0.5) continue;
    withBalance++;
    const here = byPhone.get(digitsOnly(page.phone));
    if (
      here &&
      Math.abs(here.total_debt_usd - usd) < 0.005 &&
      Math.abs(here.total_debt_lbp - lbp) < 0.5
    ) {
      matching++;
    }
  }
  return matching > 0 && matching * 2 >= withBalance;
}

/**
 * Every client with account history and that history, ready for
 * `buildDebtExportWorkbook`, sorted by name.
 */
export async function loadAccountsForExport(
  api: Pick<ApiAdapter, "getDebtors" | "getAllDebtHistory">,
): Promise<DebtExportClient[]> {
  // TWO requests for the whole shop. One history request per client made
  // ~400 web requests for a real shop, past the API's per-user rate limit.
  const [allDebtors, allHistory] = await Promise.all([
    api.getDebtors(),
    api.getAllDebtHistory(),
  ]);
  const byClient = new Map<number, DebtLedgerEntity[]>();
  for (const row of allHistory ?? []) {
    const list = byClient.get(row.client_id);
    if (list) list.push(row);
    else byClient.set(row.client_id, [row]);
  }
  return allDebtors
    .map((d) => ({
      name: d.full_name,
      phone: d.phone_number ?? "",
      history: byClient.get(d.id) ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
