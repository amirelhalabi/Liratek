import { z } from "zod";
import { transactionTimeSchema } from "./common.js";

/**
 * Custom Service validation schemas
 */

export const createCustomServiceSchema = z
  .object({
    description: z.string().min(1, "Description is required").max(500),
    cost_usd: z.coerce.number().min(0).default(0),
    cost_lbp: z.coerce.number().min(0).default(0),
    price_usd: z.coerce.number().min(0).default(0),
    price_lbp: z.coerce.number().min(0).default(0),
    paid_by: z.string().min(1).default("CASH"),
    status: z.enum(["pending", "completed"]).default("completed"),
    client_id: z.coerce.number().int().positive().optional(),
    client_name: z.string().max(255).optional(),
    phone_number: z.string().max(50).optional(),
    note: z.string().max(1000).optional(),
    category: z.string().max(100).optional(),
    transaction_time: transactionTimeSchema,
    voucher_code: z.string().optional(),
    // Structured payment legs in the currency the customer ACTUALLY paid
    // (split payments, pay-in-other-currency, and change/return legs). Snake
    // case — the form serializes with toSnakeLegs.
    payments: z
      .array(
        z.object({
          method: z.string().min(1),
          currency_code: z.string().min(1),
          amount: z.number(),
          voucher_code: z.string().optional(),
          direction: z.enum(["IN", "OUT"]).optional(),
        }),
      )
      .optional(),
    // Session-basket deferred payment mode: basket owns the customer-cash price
    // inflow + debt; the shop's own cost outflow (General drawer) is still booked.
    deferPayment: z.boolean().optional(),
    // Operator-edited USD↔LBP rate of record, threaded by the session checkout so
    // the unified transaction stores it (the viewer's "@ <rate>" + USD/LBP display).
    exchange_rate: z.coerce.number().positive().optional(),
  })
  .refine(
    (data) =>
      data.cost_usd > 0 ||
      data.cost_lbp > 0 ||
      data.price_usd > 0 ||
      data.price_lbp > 0,
    {
      message: "At least one cost or price must be greater than 0",
    },
  )
  .refine((data) => data.paid_by !== "CUSTOMER_ACCOUNT" || data.client_id, {
    message: "A client is required when payment method is Customer Account",
  })
  .refine(
    (data) =>
      data.paid_by !== "GIFT_CARD" ||
      (data.voucher_code != null && data.voucher_code.trim().length > 0),
    {
      message: "A voucher code is required when paying by Gift Card",
    },
  );

export type CreateCustomServiceInput = z.infer<
  typeof createCustomServiceSchema
>;
