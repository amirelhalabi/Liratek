import { BALANCE_EPS } from "@liratek/ui";

/**
 * Owner decision D3 (2026-10-06): the Dashboard "Pending Settlement" banner
 * covers what still has to be settled in EVERY ledger, not only suppliers.
 * This turns `partners.getAllBalances()` rows into the banner's partner lines.
 *
 * Sign convention (`PartnerRepository.getBalances`, same as the Partners
 * page): balance = SUM(DEBIT) - SUM(CREDIT). Positive means the partner owes
 * the shop; negative means the shop owes the partner.
 */

export type PartnerSettlementCurrency = "USD" | "LBP" | "USDT";

export interface PartnerBalanceRow {
  id: number;
  name: string;
  usd: number;
  lbp: number;
  usdt?: number;
}

export interface PartnerSettlementAmount {
  currency: PartnerSettlementCurrency;
  /** Always positive — the direction is carried by which list it sits in. */
  amount: number;
}

export interface PartnerSettlementLine {
  id: number;
  name: string;
  /** Currencies where the shop owes the partner (balance < 0). */
  youOwe: PartnerSettlementAmount[];
  /** Currencies where the partner owes the shop (balance > 0). */
  owesYou: PartnerSettlementAmount[];
}

const CURRENCIES: ReadonlyArray<{
  currency: PartnerSettlementCurrency;
  pick: (r: PartnerBalanceRow) => number;
}> = [
  { currency: "USD", pick: (r) => r.usd },
  { currency: "LBP", pick: (r) => r.lbp },
  { currency: "USDT", pick: (r) => r.usdt ?? 0 },
];

/**
 * One line per partner with a non-zero balance in any currency. A value
 * within `BALANCE_EPS` (the same threshold the Partners page uses) counts
 * as settled. Non-numeric / malformed values read as 0 rather than NaN.
 */
export function buildPartnerSettlementLines(
  rows: ReadonlyArray<PartnerBalanceRow>,
): PartnerSettlementLine[] {
  const lines: PartnerSettlementLine[] = [];
  for (const row of rows) {
    const youOwe: PartnerSettlementAmount[] = [];
    const owesYou: PartnerSettlementAmount[] = [];
    for (const { currency, pick } of CURRENCIES) {
      const raw = Number(pick(row));
      const value = Number.isFinite(raw) ? raw : 0;
      if (value > BALANCE_EPS) owesYou.push({ currency, amount: value });
      else if (value < -BALANCE_EPS) youOwe.push({ currency, amount: -value });
    }
    if (youOwe.length > 0 || owesYou.length > 0) {
      lines.push({ id: row.id, name: row.name, youOwe, owesYou });
    }
  }
  return lines;
}
