import { z } from "zod";
import { idSchema } from "./common.js";
import { counterpartyDiscountInputSchema } from "./counterparty.js";

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

// CQ-11 — a single split-settlement leg (MultiPaymentInput on the Partners
// page): "settle $100 as $60 CASH + $40 OMT". Deliberately NOT the same shape
// as the sales/recharge payment-leg contract (utils/payments.ts) — there is
// no `direction` field because a partner settlement never carries a
// return/change leg, only money moving one way.
const partnerSettlementLegSchema = z.object({
  method: z.string().min(1),
  currency_code: z.string().min(1),
  amount: z.number().positive(),
});

// Settle a partner balance (money — writes a SETTLEMENT partner_ledger entry;
// direction is computed server-side from the current balance).
export const partnerSettleSchema = z
  .object({
    partnerId: idSchema,
    amount: z.number().positive(),
    currency: z.string().min(1),
    settlementMethod: z.string().min(1),
    notes: z.string().optional(),
    // CQ-10: a settlement may bundle a forgiven remainder ("owed X, paid Y,
    // discount Z") — posts its OWN 'DISCOUNT' partner_ledger entry (same
    // direction as the settlement) + COUNTERPARTY_DISCOUNT transaction
    // (PartnerService.settle). partner_ledger is one-currency-per-row, so only
    // the side matching `currency` above is honored — PartnerService.settle
    // rejects a discount that supplies BOTH amount_usd AND amount_lbp
    // (ambiguous which currency it belongs to) rather than silently drop one.
    discount: counterpartyDiscountInputSchema.optional(),
    // CQ-11 — split-leg settlement (e.g. $60 CASH + $40 OMT), backing the
    // shared MultiPaymentInput settle modal. When present it SUPERSEDES
    // settlementMethod for money movement (PartnerRepository writes N
    // payments rows + N drawer deltas instead of one) — but
    // `settlementMethod` is still required and still stamped on the
    // partner_ledger row itself; omitting `payments` entirely keeps the
    // legacy single-leg behavior byte-identical.
    payments: z.array(partnerSettlementLegSchema).min(1).optional(),
  })
  .refine(
    (d) =>
      !d.payments ||
      d.payments.every((leg) => leg.currency_code === d.currency),
    {
      message:
        "Every payment leg's currency_code must match the settlement currency — multi-currency settles stay one-settle-per-currency",
      path: ["payments"],
    },
  )
  .refine(
    (d) =>
      !d.payments ||
      Math.abs(
        d.payments.reduce((sum, leg) => sum + leg.amount, 0) - d.amount,
      ) <= 0.005,
    {
      message: "Payment legs must sum to the settlement amount",
      path: ["payments"],
    },
  )
  .refine(
    (d) =>
      !d.payments || !d.payments.some((leg) => leg.method === "CLIENT_ACCOUNT"),
    {
      message:
        "CLIENT_ACCOUNT settles no money — it cannot appear as a split payment leg; use settlementMethod alone for account settlements",
      path: ["payments"],
    },
  )
  .refine((d) => !(d.payments && d.settlementMethod === "CLIENT_ACCOUNT"), {
    message:
      "A CLIENT_ACCOUNT settlement moves no money and cannot be combined with split payment legs",
    path: ["payments"],
  });

// CQ-10 (D4: admin-only on both transports) — standalone write-off: forgive
// part of a partner balance with NO settlement attached. Mirrors the fixed
// {amount_usd, amount_lbp, reason?} discount contract, but — like
// partnerSettleSchema's `discount` — partner_ledger can only book ONE
// currency per call; PartnerService.writeOff rejects supplying both.
export const partnerWriteOffSchema = z
  .object({
    partnerId: idSchema,
    amount_usd: z.number().nonnegative().default(0),
    amount_lbp: z.number().nonnegative().default(0),
    reason: z.string().optional(),
  })
  .refine((d) => d.amount_usd > 0 || d.amount_lbp > 0, {
    message: "At least one amount (USD or LBP) must be greater than 0",
  });

export type PartnerCreateInput = z.infer<typeof partnerCreateSchema>;
export type PartnerUpdateInput = z.infer<typeof partnerUpdateSchema>;
export type PartnerRecordTransactionInput = z.infer<
  typeof partnerRecordTransactionSchema
>;
export type PartnerSettleInput = z.infer<typeof partnerSettleSchema>;
export type PartnerWriteOffInput = z.infer<typeof partnerWriteOffSchema>;
