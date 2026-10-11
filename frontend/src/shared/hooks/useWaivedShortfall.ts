import { useCallback, useState } from "react";
import type { PaymentLine } from "@liratek/ui";

/** Per-currency amount the cashier waived (LIRA-310). */
export interface WaivedAmounts {
  usd: number;
  lbp: number;
}

const NONE: WaivedAmounts = { usd: 0, lbp: 0 };

/** Content key of the payment lines (method, currency, amount) — two arrays
 *  with the same lines are the same payment. */
function linesKey(lines: PaymentLine[]): string {
  return lines
    .map((l) => `${l.method}:${l.currencyCode}:${l.amount}`)
    .join("|");
}

/**
 * LIRA-310 — the Waive state for a settlement page whose waived gap is sent
 * to the server as its own field (supplier `discount`, LOTO `discount_lbp`),
 * rather than folded into a discount the page already has.
 *
 * Feed `onWaiveRemaining` to `MultiPaymentInput`; it stores the per-currency
 * remainder MPI hands back (its second argument). The waive belongs to the
 * payment it was tapped on: it reads as zero again as soon as the payment
 * lines change, or `resetKey` (selection / direction / total) changes —
 * so a stale waive can never be sent with a different payment.
 */
export function useWaivedShortfall(lines: PaymentLine[], resetKey: string) {
  const [state, setState] = useState<{
    waived: WaivedAmounts;
    linesKey: string;
    resetKey: string;
  } | null>(null);

  const key = linesKey(lines);
  const waived =
    state && state.linesKey === key && state.resetKey === resetKey
      ? state.waived
      : NONE;

  const onWaiveRemaining = useCallback(
    (
      _amount: number,
      remainingByCurrency: Array<{ currency: string; amount: number }>,
    ) => {
      let usd = 0;
      let lbp = 0;
      for (const m of remainingByCurrency) {
        if (m.currency === "USD") usd += m.amount;
        else if (m.currency === "LBP") lbp += m.amount;
      }
      setState({
        waived: {
          usd: Math.round(usd * 100) / 100,
          lbp: Math.round(lbp),
        },
        linesKey: key,
        resetKey,
      });
    },
    [key, resetKey],
  );

  const clear = useCallback(() => setState(null), []);

  return {
    waived,
    hasWaive: waived.usd > 0 || waived.lbp > 0,
    onWaiveRemaining,
    clear,
  };
}
