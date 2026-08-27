import { z } from "zod";
import { positiveDecimalSchema, transactionTimeSchema } from "./common.js";

/**
 * Drawer Cash-Out validation schema.
 *
 * Mirrors the Drawer Top-Up validator shape (amount_usd/amount_lbp using the
 * shared `positiveDecimalSchema`, `transaction_time` using the shared
 * `transactionTimeSchema`) — see expense.ts/financial.ts for the same reused
 * pair. `notes` is required (unlike Drawer Top-Up's optional notes): a cash
 * withdrawal that is neither an expense nor a transfer needs a stated reason
 * for the audit trail.
 *
 * `extra_currencies` (GENERAL_DRAWER_UNRESTRICTED.md Phase 4 review finding):
 * DRAWER_TOPUP is permanently non-reversible (constants/transactionTypes.ts
 * `NON_REVERSIBLE_TRANSACTION_TYPES`), and its documented rule-20 reversal
 * owner is "an opposite manual entry" — a Drawer Cash-Out. Before this field
 * existed, that manual correction path could only express USD/LBP, so a
 * mistaken non-USD/LBP General top-up (e.g. EUR via `extra_currencies` on
 * Drawer Top-Up) had NO way to be corrected through the app at all. Mirrors
 * Drawer Top-Up's `extra_currencies` shape minus the lot cost-basis fields
 * (`acquisition_usd_per_unit`/`market_usd_per_unit_hint`) — a cash-out never
 * creates an `exchange_lots` row, so it has no cost basis to record. It also
 * never adjusts an existing lot's `remaining_qty` (that is Q15's job, via
 * `ExchangeLotRepository.adjust`, a deliberately separate, money-free
 * correction) — correcting a mistaken foreign-currency top-up is therefore a
 * two-step manual process: this cash-out fixes `drawer_balances`/`payments`,
 * and a Q15 write-off fixes the lot ledger, exactly mirroring how any other
 * wrong-lot-rate correction already works.
 */
export const createDrawerCashoutSchema = z
  .object({
    amount_usd: positiveDecimalSchema.default(0),
    amount_lbp: positiveDecimalSchema.default(0),
    extra_currencies: z
      .array(
        z.object({
          currency_code: z.string().trim().min(1).max(10),
          amount: z.number().positive(),
        }),
      )
      .optional(),
    notes: z.string().trim().min(1, "A reason is required").max(500),
    transaction_time: transactionTimeSchema,
  })
  .refine(
    (d) =>
      d.amount_usd > 0 ||
      d.amount_lbp > 0 ||
      (d.extra_currencies?.some((e) => e.amount > 0) ?? false),
    {
      message:
        "At least one amount (USD, LBP, or another currency) must be greater than zero.",
    },
  )
  .refine(
    (d) => {
      const codes = (d.extra_currencies ?? []).map((e) =>
        e.currency_code.toUpperCase(),
      );
      return new Set(codes).size === codes.length;
    },
    { message: "Duplicate currency in extra_currencies." },
  );

export type CreateDrawerCashoutInput = z.infer<
  typeof createDrawerCashoutSchema
>;
