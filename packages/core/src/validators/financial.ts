import { z } from "zod";
import { positiveDecimalSchema, currencyCodeSchema } from "./common.js";

/**
 * Financial services validation schemas (OMT, WHISH, iPick, Katsh, Binance, etc.)
 */

// OMT/WHISH Money Transfer & iPick/Katsh/WishApp/Binance services
export const createFinancialServiceSchema = z
  .object({
    provider: z.enum([
      "OMT",
      "WHISH",
      "iPick",
      "Katsh",
      "WISH_APP",
      "OMT_APP",
      "BOB",
      "OTHER",
      "BINANCE",
    ]),
    serviceType: z.enum(["SEND", "RECEIVE"]),
    amount: positiveDecimalSchema,
    currency: currencyCodeSchema.default("USD"),
    commission: positiveDecimalSchema.default(0),
    cost: z.number().min(0).optional(),
    price: z.number().min(0).optional(),
    paidByMethod: z.string().optional(),
    clientId: z.number().int().positive().optional(),
    clientName: z.string().max(255).optional(),
    referenceNumber: z.string().max(100).optional(),
    phoneNumber: z.string().max(30).optional(),
    omtServiceType: z
      .enum([
        "INTRA",
        "WESTERN_UNION",
        "CASH_TO_BUSINESS",
        "CASH_TO_GOV",
        "OMT_WALLET",
        "OMT_CARD",
        "OGERO_MECANIQUE",
        "ONLINE_BROKERAGE",
      ])
      .optional(),
    itemKey: z.string().max(255).optional(),
    itemCategory: z.string().max(500).optional(),
    note: z.string().max(500).optional(),
    // New fields for fee calculation
    omtFee: positiveDecimalSchema.optional(), // Fee charged by OMT (user-entered or auto-looked-up)
    /** Fee charged by WHISH (user-entered or auto-looked-up from WHISH_FEE_TIERS) */
    whishFee: positiveDecimalSchema.optional(),
    profitRate: z.number().min(0.001).max(0.004).optional(), // For ONLINE_BROKERAGE (0.1%-0.4%)
    payFee: z.boolean().optional(), // For BINANCE: charge fee to customer
    /** For SEND: true = fee already deducted from amount by frontend (amount is net sent amount) */
    includingFees: z.boolean().optional(),
    /**
     * Surcharge collected from customer for paying via non-cash method (e.g. WHISH Wallet, Binance).
     * This is the shop's immediately realized profit. Only applies to SEND with non-cash paidByMethod.
     */
    paymentMethodFee: z.number().min(0).optional(),
    /**
     * Rate used to calculate paymentMethodFee (e.g. 0.01 = 1%).
     * Stored for audit purposes.
     */
    paymentMethodFeeRate: z.number().min(0).max(0.1).optional(),
    /** Multi-payment support */
    payments: z
      .array(
        z.object({
          method: z.string(),
          currencyCode: z.string(),
          amount: z.number().positive(),
        }),
      )
      .optional(),
  })
  .refine(
    (data) => {
      // If paying by DEBT, clientId is required
      if (data.paidByMethod === "DEBT" && !data.clientId) {
        return false;
      }
      return true;
    },
    {
      message: "Client is required when paying by DEBT",
      path: ["clientId"],
    },
  )
  .refine(
    (data) => {
      // For OMT services (except OMT_WALLET and ONLINE_BROKERAGE), omtFee is optional
      // when the service type has a fee lookup table (INTRA, WESTERN_UNION).
      // For other service types (CASH_TO_BUSINESS, CASH_TO_GOV, OMT_CARD, OGERO_MECANIQUE),
      // the fee must be entered manually.
      const hasFeeLookupTable =
        data.omtServiceType === "INTRA" ||
        data.omtServiceType === "WESTERN_UNION";

      if (
        data.provider === "OMT" &&
        data.omtServiceType &&
        data.omtServiceType !== "OMT_WALLET" &&
        data.omtServiceType !== "ONLINE_BROKERAGE" &&
        !hasFeeLookupTable &&
        !data.omtFee
      ) {
        return false;
      }
      return true;
    },
    {
      message: "OMT fee is required for this service type",
      path: ["omtFee"],
    },
  )
  .refine(
    (data) => {
      // For BINANCE with payFee=true, omtServiceType is required to calculate fee
      if (data.provider === "BINANCE" && data.payFee && !data.omtServiceType) {
        return false;
      }
      return true;
    },
    {
      message: "Service type is required when charging fee",
      path: ["omtServiceType"],
    },
  );

// Query financial services history
export const getFinancialServicesSchema = z.object({
  provider: z
    .enum([
      "OMT",
      "WHISH",
      "iPick",
      "Katsh",
      "WISH_APP",
      "OMT_APP",
      "BOB",
      "OTHER",
      "BINANCE",
    ])
    .optional(),
  limit: z.coerce.number().int().positive().max(1000).default(50),
});

export type CreateFinancialServiceInput = z.infer<
  typeof createFinancialServiceSchema
>;
export type GetFinancialServicesInput = z.infer<
  typeof getFinancialServicesSchema
>;
