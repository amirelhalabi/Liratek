/**
 * LIRA-321 — the shared "Customer pays" fragment for payout screens
 * (Exchange, Whish App / OMT App receive, Binance cash-out).
 *
 * One definition (rule 14) spread into each screen's write schema, so both
 * transports validate the same shape (rule 19) and adapters derive their
 * payload type from it (rule 21). Shape only: the balance rules (no overpay,
 * shortfall covered by a CUSTOMER_ACCOUNT line or a capped forgive, client
 * required for an account line) are enforced server-side by
 * `bookCustomerLegs` (repositories/moneyPosting.ts).
 *
 * Pure zod leaf — reachable from `browser.ts` via the validators barrel, so
 * it must never import a Node built-in or anything that reaches one (rule 29).
 */
import { z } from "zod";

/** One line the customer hands over on the money-in side. */
export const customerLegSchema = z.object({
  method: z.string().min(1),
  currencyCode: z.string().min(1),
  amount: z.number().positive(),
});

/**
 * The optional keys a payout screen's schema spreads in. "Forgive" on screen
 * is "waived" in code and payloads — the same thing; the amount is in the
 * screen's expected currency.
 */
export const customerPaymentsField = {
  customerPayments: z.array(customerLegSchema).min(1).optional(),
  customer_waived_amount: z.number().min(0).optional(),
};

export type CustomerLegInput = z.input<typeof customerLegSchema>;
export type CustomerLeg = z.output<typeof customerLegSchema>;

const customerPaymentsFieldSchema = z.object(customerPaymentsField);
export type CustomerPaymentsFieldInput = z.input<
  typeof customerPaymentsFieldSchema
>;
