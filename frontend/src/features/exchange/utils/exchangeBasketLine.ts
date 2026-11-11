import {
  EXCHANGE_CART_CHANNEL,
  sessionExchangeCartAmount,
  type ExchangeSubmitPayload,
} from "@liratek/core";
import type { CartItem } from "@/features/sessions/types/cart";

/**
 * LIRA-380 — the keys a basket line never carries: the basket's one payment
 * takes and pays the money, so a line with its own payment lines, account
 * line, discount, kept change, round-up, added change or partner is refused
 * at checkout (ExchangeRepository `_assertDeferredShape`).
 */
const PAYMENT_SIDE_KEYS = [
  "payments",
  "customerPayments",
  "customer_waived_amount",
  "kept_change_usd",
  "kept_change_lbp",
  "rounding_given_usd",
  "rounding_given_lbp",
  "added_change_usd",
  "added_change_lbp",
  "tender_exchange_rate",
  "customer_account_usd_rate",
  "payout_account_usd_rate",
  "partnerId",
  "partnerMode",
] as const satisfies ReadonlyArray<keyof ExchangeSubmitPayload>;

/** "8,950,000" / "100" / "1.08" — stored label text, so a fixed locale. */
function num(n: number): string {
  // i18n-exempt: stored basket label (data sent to the server), fixed locale
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function money(amount: number, currency: string): string {
  if (currency === "USD") return `$${num(amount)}`;
  return `${num(amount)} ${currency}`;
}

/**
 * LIRA-380 — the basket line for an exchange made while a customer session is
 * open. Takes the SAME payload the page sends for a walk-in exchange (rule 22:
 * the mode decides where the payload goes, never a second object literal) and
 * keeps only the exchange itself. The label shows the exchange's own rate,
 * which no later rate changes ("Exchange $100 → 8,950,000 LBP @ 89,500").
 */
export function exchangeBasketLine(
  payload: ExchangeSubmitPayload,
): Omit<CartItem, "id"> {
  const formData: Record<string, unknown> = { ...payload };
  for (const key of PAYMENT_SIDE_KEYS) delete formData[key];
  const rates = [payload.leg1Rate, payload.leg2Rate]
    .filter((r): r is number => typeof r === "number" && r > 0)
    .map(num)
    .join(" / ");
  const { amount, currency } = sessionExchangeCartAmount(formData);
  return {
    module: "exchange",
    // i18n-exempt: stored text sent to server (session basket item label)
    label: `Exchange ${money(payload.amountIn, payload.fromCurrency)} → ${money(payload.amountOut, payload.toCurrency)} @ ${rates}`,
    amount,
    currency,
    ipcChannel: EXCHANGE_CART_CHANNEL,
    formData,
  };
}
