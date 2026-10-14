/**
 * LIRA-321 (FR-012, rule 14) — the ONE writer of a forgiven "Customer pays"
 * leftover: the LIRA-310 WAIVED_SHORTFALL shape (amount 0, profit −forgiven,
 * in its own currency; USDT as USD; a third currency as its USD value). The
 * Profits page shows it on its own "Waived" line
 * (`ProfitRepository.waivedShortfallSource`), never inside the parent's
 * profit stamp, so a forgive reads the same on every screen that offers one
 * (Exchange, Whish App / OMT App receive, Binance cash-out).
 *
 * Linked to the PARENT unified transaction (`source_table = 'transactions'`,
 * `source_id` = parent id) — never to the module's own table, because
 * `getBySourceId(<module table>, id)` returns the newest ACTIVE row of that
 * source, which must stay the parent.
 *
 * Rule 26: the row is written by the system as a side effect of the parent,
 * so `metadata_json.is_auto = true` — derived HERE from that link, never
 * passed by a caller.
 *
 * Reversal owner (rule 20): the parent's void/refund —
 * `TransactionRepository._cascadeWaivedShortfallSiblingVoid`, which matches
 * any parent type. The row is NON_REVERSIBLE on its own.
 *
 * Server-only (reaches the database): never import it from `browser.ts`
 * (rule 29).
 */
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import { formatMoneyAmount } from "../utils/formatMoney.js";

export interface ForgivenShortfallSiblingInput {
  /** The parent unified transaction (EXCHANGE, FINANCIAL_SERVICE, …). */
  parentTxnId: number;
  /** Forgiven amount, in `currency` (> 0; callers skip the call at 0). */
  forgiven: number;
  /** The forgiven amount's currency (USD, USDT, LBP, or a third one). */
  currency: string;
  /** USD per 1 unit of `currency` — used only for a third currency. */
  usdPerUnit: number;
  /** Stamped on the row's `exchange_rate`, like the parent's. */
  exchangeRate: number;
  clientId: number | null;
  clientName: string | null;
  userId: number;
  /** Shown in the summary: "Forgiven (<label>): <amount>". */
  label: string;
  /** Extra metadata keys naming the parent's module row (e.g. exchange_id). */
  metadata?: Record<string, string | number | null>;
  transactionTime?: string;
}

/** Profit of the sibling, per currency (negative): one definition. */
export function forgivenShortfallProfit(
  forgiven: number,
  currency: string,
  usdPerUnit: number,
): { usd: number; lbp: number } {
  if (currency === "LBP") return { usd: 0, lbp: -forgiven };
  if (currency === "USD" || currency === "USDT") {
    return { usd: -forgiven, lbp: 0 };
  }
  return { usd: -forgiven * usdPerUnit, lbp: 0 };
}

export function bookForgivenShortfallSibling(
  input: ForgivenShortfallSiblingInput,
): number {
  const { forgiven, currency } = input;
  const profit = forgivenShortfallProfit(forgiven, currency, input.usdPerUnit);
  return getTransactionRepository().createTransaction({
    type: TRANSACTION_TYPES.WAIVED_SHORTFALL,
    source_table: "transactions",
    source_id: input.parentTxnId,
    user_id: input.userId,
    amount_usd: 0,
    amount_lbp: 0,
    profit_usd: profit.usd,
    profit_lbp: profit.lbp,
    exchange_rate: input.exchangeRate,
    client_id: input.clientId,
    client_name: input.clientName,
    summary: `Forgiven (${input.label}): ${formatMoneyAmount(forgiven, currency)}`,
    metadata_json: {
      // Rule 26 — derived from the parent link this writer always sets.
      is_auto: true,
      parent_transaction_id: input.parentTxnId,
      ...(input.metadata ?? {}),
      waived_amount: forgiven,
      waived_currency: currency,
      waived_usd: -profit.usd,
      waived_lbp: -profit.lbp,
    },
    transaction_time: input.transactionTime,
  });
}
