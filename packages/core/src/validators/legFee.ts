import { z } from "zod";
import { legFeeShapeError } from "../utils/legFee.js";

/**
 * LIRA-400 — the payment-method fee key on a payment leg, and the schema-level
 * checks that need no method table (0 ≤ fee ≤ amount, never on a change/OUT
 * leg, never on CASH / CUSTOMER_ACCOUNT / GIFT_CARD). The drawer-based
 * cash-family check runs in the repository (`assertLegFeesAllowed`), which
 * both transports reach. One rule, `legFeeShapeError` (rule 14).
 *
 * The key follows each schema's own casing (rule 24): `fee_amount` on the
 * snake_case POS leg, `feeAmount` on the camelCase recharge / repayment legs.
 */
export const legFeeAmountSchema = z.number().finite().optional();

type FeeLeg = {
  method: string;
  amount: number;
  direction?: "IN" | "OUT" | undefined;
};

export function refineLegFees<K extends "fee_amount" | "feeAmount">(
  feeKey: K,
) {
  return (
    legs: Array<FeeLeg & { [P in K]?: number | undefined }> | undefined,
    ctx: z.RefinementCtx,
  ): void => {
    (legs ?? []).forEach((leg, i) => {
      const fee = leg[feeKey] ?? 0;
      const error = legFeeShapeError({
        method: leg.method,
        amount: leg.amount,
        fee,
        direction: leg.direction,
      });
      if (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: error,
          path: [i, feeKey],
        });
      }
    });
  };
}
