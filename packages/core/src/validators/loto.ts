import { z } from "zod";

/**
 * Loto validation schemas — the write-path contracts for loto money flows.
 *
 * Shared by the Electron IPC handlers (electron-app/handlers/lotoHandlers.ts,
 * via re-exports in electron-app/schemas/index.ts) and the REST routes
 * (backend/src/api/loto.ts) — ONE schema per payload, two transports
 * (CLAUDE.md rule 14).
 *
 * NOTE: no .transform() anywhere — it breaks validatePayload's generic
 * inference on the Electron side; is_winner is normalized in the handlers.
 */

export const lotoSellSchema = z.object({
  ticket_number: z.string().optional(),
  sale_amount: z.number().positive(),
  // Structured legs in the currency the customer ACTUALLY paid (a 500,000 LBP
  // ticket paid with $5 books General +5 USD, not +500,000 LBP).
  payments: z
    .array(
      z.object({
        method: z.string().min(1),
        currencyCode: z.string().min(1),
        amount: z.number(),
        direction: z.enum(["IN", "OUT"]).optional(),
      }),
    )
    .optional(),
  commission_rate: z.number().optional(),
  is_winner: z.boolean().optional(),
  prize_amount: z.number().optional(),
  sale_date: z.string().optional(),
  payment_method: z.string().optional(),
  currency: z.string().optional(),
  note: z.string().optional(),
  transaction_time: z.string().optional(),
  clientId: z.number().int().positive().nullable().optional(),
  clientName: z.string().optional(),
});

export const lotoCashPrizeSchema = z.object({
  ticket_number: z.string(),
  prize_amount: z.number().positive(),
  prize_date: z.string().optional(),
  customer_name: z.string().optional(),
  note: z.string().optional(),
});

/** loto ticket update payload — sale/commission edits feed checkpoint
 *  settlement math, so malformed values must be rejected here. */
export const lotoTicketUpdateSchema = z.object({
  ticket_number: z.string().min(1).optional(),
  sale_amount: z.number().positive().optional(),
  commission_rate: z.number().nonnegative().optional(),
  commission_amount: z.number().nonnegative().optional(),
  // Boolean accepted for caller convenience; handlers normalize to 0/1
  // (a .transform() here breaks validatePayload's generic inference).
  is_winner: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
  prize_amount: z.number().nonnegative().optional(),
  prize_paid_date: z.string().optional(),
  payment_method: z.string().optional(),
  currency: z.string().optional(),
  note: z.string().optional(),
});

export const lotoFeeSchema = z.object({
  fee_amount: z.number().positive(),
  fee_month: z.string().min(1),
  fee_year: z.number().int().positive(),
  recorded_date: z.string().optional(),
  note: z.string().optional(),
});

export const lotoCheckpointCreateSchema = z.object({
  checkpoint_date: z.string().min(1),
  period_start: z.string().min(1),
  period_end: z.string().min(1),
  note: z.string().optional(),
});

const checkpointPaymentSchema = z.object({
  method: z.string().min(1),
  currency_code: z.string().min(1),
  amount: z.number(),
  direction: z.enum(["IN", "OUT"]).optional(),
});

export const lotoCheckpointSettleSchema = z.object({
  id: z.number().int().positive(),
  totalSales: z.number().nonnegative(),
  totalCommission: z.number().nonnegative(),
  totalPrizes: z.number().nonnegative(),
  totalCashPrizes: z.number().optional(),
  settledAt: z.string().optional(),
  payments: z.array(checkpointPaymentSchema).optional(),
});

export const lotoCheckpointsSettleBatchSchema = z.object({
  checkpointIds: z
    .array(z.number().int().positive())
    .min(1, "At least one checkpoint required"),
  totalSales: z.number().nonnegative(),
  totalCommission: z.number().nonnegative(),
  settledAt: z.string().optional(),
  payment: z
    .object({
      method: z.string().min(1),
      drawer_name: z.string().min(1),
      currency_code: z.string().min(1),
      amount: z.number(), // can be negative (we pay out)
    })
    .optional(),
});

export type LotoSellInput = z.infer<typeof lotoSellSchema>;
export type LotoCashPrizeInput = z.infer<typeof lotoCashPrizeSchema>;
export type LotoTicketUpdateInput = z.infer<typeof lotoTicketUpdateSchema>;
export type LotoFeeInput = z.infer<typeof lotoFeeSchema>;
export type LotoCheckpointCreateInput = z.infer<
  typeof lotoCheckpointCreateSchema
>;
export type LotoCheckpointSettleInput = z.infer<
  typeof lotoCheckpointSettleSchema
>;
export type LotoCheckpointsSettleBatchInput = z.infer<
  typeof lotoCheckpointsSettleBatchSchema
>;
