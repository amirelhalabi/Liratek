import type { RechargeHistoryEntry } from "@/api/backendApi";
import type { FinancialTransaction } from "../types";

/** A `recharges` history row, plus the columns the repository adds. */
type RechargeHistoryRow = RechargeHistoryEntry & {
  is_refunded?: number | null;
  refunded_at?: string | null;
  profit_pending?: number | boolean | null;
};

/**
 * One MTC/Alfa `recharges` row as the shared History window's row. Used by
 * the Recharge page's history load and by the History window's full load,
 * so both build the row the same way.
 */
export function toTelecomHistoryRow(
  r: RechargeHistoryRow,
): FinancialTransaction {
  return {
    id: r.id,
    provider: r.carrier,
    service_type: "SEND",
    recharge_type: r.recharge_type,
    amount: r.amount,
    currency: r.currency_code || "USD",
    cost: r.cost,
    commission: r.price - r.cost,
    ...(r.client_name != null ? { client_name: r.client_name } : {}),
    phone_number: r.phone_number ?? null,
    ...(r.note != null ? { note: r.note } : {}),
    edited_by: r.edited_by ?? null,
    edited_at: r.edited_at ?? null,
    default_price_to_client: r.default_price_to_client ?? null,
    ...(r.paid_by ? { paid_by: r.paid_by } : {}),
    ...(r.phone_number ? { reference_number: r.phone_number } : {}),
    created_at: r.created_at,
    // LIRA-185 #6: RechargeRepository.getHistory projects these (LIRA-131);
    // without them HistoryModal never showed a refunded MTC/Alfa sale as
    // refunded.
    is_refunded: r.is_refunded ?? 0,
    refunded_at: r.refunded_at ?? null,
    // LIRA-185 #4: unpaid account sale — History labels its profit
    // "pending until paid" (same rule as the Profits page).
    profit_pending: Boolean(r.profit_pending),
  };
}

/** Rows that are not a customer sale: drawer top-ups, credit buy-backs and
 *  the shop using its own line. Left out of the History totals. */
const NOT_A_SALE = new Set(["TOP_UP", "CREDIT_BUYBACK", "SHOP_LINE_USE"]);

/**
 * The History window's total for one MTC/Alfa row: the price the customer
 * paid (cost + profit, in the row's currency). Non-sale rows count 0.
 */
export function telecomSaleTotal(tx: FinancialTransaction): {
  usd: number;
  lbp: number;
} {
  if (tx.recharge_type && NOT_A_SALE.has(tx.recharge_type)) {
    return { usd: 0, lbp: 0 };
  }
  const price = (tx.cost ?? 0) + tx.commission;
  return tx.currency === "LBP"
    ? { usd: 0, lbp: price }
    : tx.currency === "USD"
      ? { usd: price, lbp: 0 }
      : { usd: 0, lbp: 0 };
}
