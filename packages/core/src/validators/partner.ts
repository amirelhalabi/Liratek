import { z } from "zod";
import { idSchema } from "./common.js";

/**
 * Partner System validation schemas (LIRA-037).
 *
 * Shared by the REST routes (`backend/src/api/partners.ts`) so partner
 * config + ledger writes are validated over the web transport. The Electron
 * IPC handlers historically passed straight to the service without Zod; these
 * schemas are the single source of truth for the REST surface.
 *
 * NOTE: none of the write schemas carry `userId` — the ledger actor is
 * injected server-side from the authenticated JWT, never trusted from the
 * client (a spoofed actor would mis-attribute a money-moving ledger entry).
 */

// Mirrors CreateLedgerEntryData["transaction_type"] in PartnerRepository —
// the FULL union, not the narrower 7-value handler interface, so valid
// FOR_*/THROUGH_*/WHISH_TOPUP ledger writes are never silently rejected.
const partnerTransactionTypeSchema = z.enum([
  "OMT_SEND",
  "OMT_RECEIVE",
  "WHISH_SEND",
  "WHISH_RECEIVE",
  "THROUGH_OMT_SEND",
  "THROUGH_OMT_RECEIVE",
  "THROUGH_WHISH_SEND",
  "THROUGH_WHISH_RECEIVE",
  "FOR_OMT_SEND",
  "FOR_OMT_RECEIVE",
  "FOR_WHISH_SEND",
  "FOR_WHISH_RECEIVE",
  "CUSTOM_SERVICE",
  "WHISH_TOPUP",
  "SETTLEMENT",
  "ADJUSTMENT",
]);

// Create a partner (config record — no money movement).
export const partnerCreateSchema = z.object({
  name: z.string().min(1, "Partner name is required"),
  phone: z.string().nullish(),
  notes: z.string().nullish(),
  system_association: z.string().nullish(),
});

// Update a partner (config record). All fields optional.
export const partnerUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().nullish(),
  notes: z.string().nullish(),
  is_active: z.number().int().optional(),
  system_association: z.string().nullish(),
});

// Record a manual partner ledger entry (money — writes partner_ledger).
export const partnerRecordTransactionSchema = z.object({
  partnerId: idSchema,
  transactionType: partnerTransactionTypeSchema.optional(),
  referenceTable: z.string().optional(),
  referenceId: z.number().int().positive().optional(),
  amount: z.number().positive(),
  currency: z.string().min(1),
  direction: z.enum(["DEBIT", "CREDIT"]),
  notes: z.string().optional(),
  /** PFT-7b: "cash moved" — the entry is a physical cash event; the drawer
   *  moves with it (PARTNER_PAYMENT txn) and settlement coverage applies. */
  moveCash: z.boolean().optional(),
});

// Settle a partner balance (money — writes a SETTLEMENT partner_ledger entry;
// direction is computed server-side from the current balance).
export const partnerSettleSchema = z.object({
  partnerId: idSchema,
  amount: z.number().positive(),
  currency: z.string().min(1),
  settlementMethod: z.string().min(1),
  notes: z.string().optional(),
});

export type PartnerCreateInput = z.infer<typeof partnerCreateSchema>;
export type PartnerUpdateInput = z.infer<typeof partnerUpdateSchema>;
export type PartnerRecordTransactionInput = z.infer<
  typeof partnerRecordTransactionSchema
>;
export type PartnerSettleInput = z.infer<typeof partnerSettleSchema>;
