import { z } from "zod";
import {
  positiveDecimalSchema,
  positiveIntegerSchema,
  optionalPhoneNumberSchema,
  transactionTimeSchema,
} from "./common.js";
import { normalizeLineNumber } from "../utils/phoneNumber.js";

/**
 * Maintenance job validation schemas
 */

/**
 * The ONE maintenance phone normaliser (rule 14): the save schema stores the
 * typed phone in this form, and `MaintenanceRepository.findOrCreateClient`
 * matches existing clients by it — normalising BOTH the typed phone and each
 * client's stored free-text `phone_number` — so "03 123 456",
 * "+961 3 123 456" and "03123456" are the same line. Returns `""` for a
 * blank input; callers must treat `""` as "no phone", never as a match.
 */
export function normalizeMaintenancePhone(
  raw: string | null | undefined,
): string {
  if (!raw) return "";
  return normalizeLineNumber(raw).replace(/[\s\-.()]/g, "");
}

const paymentLineSchema = z.object({
  method: z.string().min(1),
  currency_code: z.string().min(1),
  amount: z.number(),
});

const maintenancePartSchema = z.object({
  id: positiveIntegerSchema.optional(),
  product_id: positiveIntegerSchema,
  quantity: positiveIntegerSchema,
  unit_price_usd: z.number().min(0).optional(),
});

export const saveMaintenanceJobSchema = z.object({
  id: positiveIntegerSchema.optional(), // For updates
  device_name: z.string().min(1).max(255),
  client_id: positiveIntegerSchema.optional(),
  client_name: z.string().max(255).optional(),
  // Blank is a valid "no phone left" state — the maintenance form always
  // sends `""` (never omits the key) when the field is empty. See
  // `optionalPhoneNumberSchema`'s doc comment / recharge.ts's identical note.
  //
  // LIRA-246b: a phone typed "03 123 456" or "+961 3 654 321" (both formats
  // the live form accepts) was rejected outright by `optionalPhoneNumberSchema`
  // (`/^\+?[0-9]{8,15}$/`, no tolerance for spaces) with "Invalid phone number
  // format" — on REST this 400'd before the service ever ran. Normalize with
  // `normalizeLineNumber` (the "keep the leading 0" canonical-storage
  // normalizer, note #13) BEFORE the regex check, via `.transform().pipe(...)`
  // — an empty string / undefined pass through unchanged (falsy guard below),
  // so `optionalPhoneNumberSchema`'s blank/omitted cases are untouched.
  //
  // LIRA-263: a reopened job now pre-fills its Phone field from the linked
  // client's stored `phone_number` (MaintenanceRepository.getJobs), and
  // other modules store that number as free text — so the value coming back
  // can carry formatting `normalizeLineNumber` leaves alone (it returns
  // anything that isn't a 7/8-digit Lebanese local number unchanged, spaces
  // and all: "961 70 123 456", "+44 20 7946 0958", "(03) 123456"). Strip
  // spaces, dashes, dots and brackets afterwards so formatting alone never
  // makes a resave of that job fail "Invalid phone number format". Digits
  // and a leading "+" are untouched; anything else still fails the regex.
  client_phone: z
    .string()
    .optional()
    .transform((v) => (v ? normalizeMaintenancePhone(v) : v))
    .pipe(optionalPhoneNumberSchema),
  issue_description: z.string().max(1000).optional(),
  cost_usd: z.number().min(0).optional(),
  price_usd: positiveDecimalSchema,
  cost_lbp: z.number().min(0).optional(),
  price_lbp: z.number().min(0).optional(),
  currency: z.enum(["USD", "LBP"]).optional().default("USD"),
  discount_usd: z.number().min(0).optional(),
  final_amount_usd: positiveDecimalSchema.optional(),
  final_amount_lbp: z.number().min(0).optional(),
  paid_usd: z.number().min(0).optional(),
  paid_lbp: z.number().min(0).optional(),
  exchange_rate: z.number().min(0).optional(),
  status: z
    .enum(["Received", "In_Progress", "Ready", "Delivered", "Delivered_Paid"])
    .default("Received"),
  paid_by: z.string().optional(),
  note: z.string().max(1000).optional(),
  payments: z.array(paymentLineSchema).optional(),
  change_given_usd: z.number().min(0).optional(),
  change_given_lbp: z.number().min(0).optional(),
  // T3 keep-change (docs/plans/done_plans/T3_KEEP_CHANGE_PLAN.md KC-3): kept (not
  // returned) change per currency → added to the transaction's profit stamp.
  kept_change_usd: z.number().nonnegative().optional(),
  kept_change_lbp: z.number().nonnegative().optional(),
  transaction_time: transactionTimeSchema,
  // MUST stay .optional() with NO .default([]) — an omitted `parts` key means
  // "leave the job's parts untouched", and a default of [] would turn every
  // legacy payload (and every status-transition resave, which sends no parts
  // key) into "delete all parts", silently wiping parts and leaking stock.
  parts: z.array(maintenancePartSchema).optional(),
});

export const getMaintenanceJobsSchema = z.object({
  status: z
    .enum([
      "All",
      "Received",
      "In_Progress",
      "Ready",
      "Delivered",
      "Delivered_Paid",
    ])
    .optional(),
});

export const getMaintenanceStatusHistorySchema = z.object({
  id: positiveIntegerSchema,
});

export type SaveMaintenanceJobInput = z.infer<typeof saveMaintenanceJobSchema>;
/** What a caller SENDS to `maintenance:save` / `POST /api/maintenance/jobs`
 *  (pre-parse, so defaulted keys are optional) — the adapter payload type
 *  (CLAUDE.md rule 21). Type-only, reachable from `browser.ts` via
 *  `validators/index.ts` (rule 29). */
export type SaveMaintenanceJobPayload = z.input<
  typeof saveMaintenanceJobSchema
>;
export type GetMaintenanceJobsInput = z.infer<typeof getMaintenanceJobsSchema>;
export type GetMaintenanceStatusHistoryInput = z.infer<
  typeof getMaintenanceStatusHistorySchema
>;
