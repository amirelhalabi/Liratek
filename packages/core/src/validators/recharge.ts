import { z } from "zod";
import {
  positiveDecimalSchema,
  phoneNumberSchema,
  transactionTimeSchema,
} from "./common.js";

/**
 * Recharge validation schemas (MTC, Alfa)
 */

export const createRechargeSchema = z.object({
  provider: z.enum(["MTC", "Alfa"]),
  type: z.enum(["CREDIT_TRANSFER", "VOUCHER", "DAYS"]),
  amount: positiveDecimalSchema,
  cost: z.number().min(0).default(0),
  price: positiveDecimalSchema,
  currency: z.string().min(1).default("USD"),
  phoneNumber: phoneNumberSchema.optional(),
  paid_by_method: z.string().min(1).default("CASH"),
  clientId: z.number().int().positive().optional(),
  note: z.string().max(500).optional(),
  // T3 keep-change (docs/plans/done_plans/T3_KEEP_CHANGE_PLAN.md KC-3): kept (not
  // returned) change per currency → added to the transaction's profit stamp.
  kept_change_usd: z.number().nonnegative().optional(),
  kept_change_lbp: z.number().nonnegative().optional(),
  transaction_time: transactionTimeSchema,
  // PFT-3a (Partner FOR-Transactions): the unpaid remainder routes to
  // partner_ledger instead of the client's debt_ledger when set. Only "FOR"
  // is valid for recharges.
  partnerId: z.number().int().positive().optional(),
  partnerMode: z.enum(["FOR"]).optional(),
  // Payment-Legs Integrity plan (false-reject fix, 2026-07-2x): the USD→LBP
  // rate MultiPaymentInput actually converted the customer's tender at (may
  // differ from the stamped sell-rate-of-record — see RechargeRepository's
  // `tender_exchange_rate` doc). Used ONLY for leg reconciliation, never to
  // stamp `transactions.exchange_rate`. NOTE: this schema has no `payments`
  // field yet (REST /api/recharge/process doesn't accept multi-payment legs
  // — a separate, pre-existing parity gap, see WEB_PARITY_ROADMAP.md), so
  // this field is inert over REST until that gap closes; added here so the
  // desktop IPC schema (electron-app/schemas/index.ts's RechargeSchema,
  // which DOES have `payments`) has a canonical source to mirror.
  tender_exchange_rate: z.number().positive().optional(),
});

export const getRechargeStockSchema = z.object({
  // No parameters needed - empty schema for consistency
});

export type CreateRechargeInput = z.infer<typeof createRechargeSchema>;
export type GetRechargeStockInput = z.infer<typeof getRechargeStockSchema>;
