import { z } from "zod";
import { clientDayInputSchema, localDayFormatSchema } from "./common.js";
import {
  isPhoneShapedTerm,
  normalizeLebanesePhone,
} from "../utils/phoneNumber.js";

/**
 * LIRA-312 — a MTC/Alfa card recharged onto the WRONG number from
 * iPick/Katsh/Whish App. Shared by the Electron IPC handlers
 * (`electron-app/handlers/wrongNumberHandlers.ts`, re-exported via
 * `electron-app/schemas/index.ts`) and the REST routes
 * (`backend/src/api/wrongNumbers.ts`) — CLAUDE.md rules 14 and 21.
 * Contract: `specs/312-wrong-number-recharge/contracts/wrong-number.md`.
 */

export const WRONG_NUMBER_PROVIDERS = ["iPick", "Katsh", "WHISH_APP"] as const;
export const wrongNumberProviderSchema = z.enum(WRONG_NUMBER_PROVIDERS);
export type WrongNumberProvider = z.infer<typeof wrongNumberProviderSchema>;

export const WRONG_NUMBER_STATUSES = [
  "WAITING",
  "PARTLY_RECOVERED",
  "RECOVERED",
  "VOIDED",
] as const;
export type WrongNumberStatus = (typeof WRONG_NUMBER_STATUSES)[number];

/** The expense category a wrong-number card is booked under. Defined once
 *  here (browser-reachable) so the server and the Transactions page's
 *  "Credits…" gate read the same string (rule 14). */
export const WRONG_NUMBER_EXPENSE_CATEGORY = "Wrong number card";

/**
 * Whether a `FINANCIAL_SERVICE` row is a catalog card sale a wrong number can
 * be recorded against — defined once (rule 14) for the server check and the
 * Transactions page's "Wrong number…" button. A catalog cart (Katsh/iPick
 * cart, Whish App / OMT App item cart) is a SEND with a catalog cost; a Katsh
 * or iPick bill is a BILL, and a wallet transfer carries no cost — neither is
 * a card. Reads the row's parsed `metadata_json`.
 */
export function isWrongNumberCardSale(
  meta: Record<string, unknown>,
): meta is Record<string, unknown> & { provider: WrongNumberProvider } {
  return (
    typeof meta.provider === "string" &&
    (WRONG_NUMBER_PROVIDERS as readonly string[]).includes(meta.provider) &&
    meta.service_type === "SEND" &&
    Number(meta.cost) > 0
  );
}

/** A Lebanese phone number typed in any everyday form. */
const phoneSchema = z
  .string()
  .trim()
  .min(1, "Enter the number")
  .max(30)
  .refine(
    (v) => isPhoneShapedTerm(v) && normalizeLebanesePhone(v).length >= 7,
    "Enter a phone number",
  );

/** USD credit amounts arrive with at most cents. */
const creditsUsdSchema = z
  .number()
  .positive("Enter the credits that arrived")
  .max(1000);

// =============================================================================
// Writes
// =============================================================================

/** Record a wrong-number card (path A from Expenses, path B from a sale). */
export const recordWrongNumberSchema = z
  .object({
    provider: wrongNumberProviderSchema,
    /** The MTC/Alfa card of that provider that was sent to the wrong number. */
    mobile_service_item_id: z.number().int().positive(),
    wrong_number: phoneSchema,
    /** The customer's real number (required on a saved sale). */
    right_number: phoneSchema.optional(),
    /** Path B: the ACTIVE card sale this wrong recharge belongs to. */
    sale_transaction_id: z.number().int().positive().optional(),
    /** Optional first credits entry, when they already came back. */
    credits_received: z
      .object({
        amount_usd: creditsUsdSchema,
        carrier_line_id: z.number().int().positive(),
      })
      .optional(),
    /** The shop's own day (rule 27). */
    expense_date: localDayFormatSchema,
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.sale_transaction_id !== undefined && d.right_number === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["right_number"],
        message: "Enter the customer's right number",
      });
    }
  });

export type RecordWrongNumberInput = z.input<typeof recordWrongNumberSchema>;
export type RecordWrongNumberData = z.output<typeof recordWrongNumberSchema>;

/** Credits sent back for a wrong-number card, on a chosen shop line. */
export const wrongNumberCreditsSchema = z.object({
  wrong_number_card_id: z.number().int().positive(),
  amount_usd: creditsUsdSchema,
  carrier_line_id: z.number().int().positive(),
  client_day: clientDayInputSchema,
});

export type WrongNumberCreditsInput = z.input<typeof wrongNumberCreditsSchema>;
export type WrongNumberCreditsData = z.output<typeof wrongNumberCreditsSchema>;

// =============================================================================
// Reads
// =============================================================================

/** One object: the whole IPC arg and the REST query (ids arrive as strings
 *  on REST, so they are coerced). */
export const listWrongNumbersQuerySchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  sale_transaction_id: z.coerce.number().int().positive().optional(),
  expense_transaction_id: z.coerce.number().int().positive().optional(),
  status: z.enum(WRONG_NUMBER_STATUSES).optional(),
});

export type ListWrongNumbersQueryInput = z.input<
  typeof listWrongNumbersQuerySchema
>;
export type ListWrongNumbersQuery = z.output<typeof listWrongNumbersQuerySchema>;
